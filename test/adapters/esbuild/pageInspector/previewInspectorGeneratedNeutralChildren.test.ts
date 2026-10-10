/** Verifies that the Page Inspector JSX adapter renders a generated-module neutral as nothing. */
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import vm from 'node:vm';
import { build } from 'esbuild';
import { afterEach, describe, expect, it } from 'vitest';
import { createPreviewInspectorRuntimePlugin } from '../../../../src/adapters/esbuild/pageInspector/previewInspectorRuntimePlugin';

const temporaryRoots: string[] = [];

afterEach(async () => {
  await Promise.all(
    temporaryRoots.splice(0).map((root) => rm(root, { force: true, recursive: true })),
  );
});

describe('Page Inspector generated neutral children', () => {
  /** `{driver.phone}` on a missing generated contract must not reach React as a function child. */
  it('replaces registered neutral children with null and keeps every other child', async () => {
    const projectRoot = await mkdtemp(path.join(os.tmpdir(), 'react-preview-neutral-child-'));
    temporaryRoots.push(projectRoot);
    const reactRoot = path.join(projectRoot, 'node_modules', 'react');
    await mkdir(reactRoot, { recursive: true });
    await Promise.all([
      writeFile(
        path.join(reactRoot, 'package.json'),
        JSON.stringify({ main: 'index.js', name: 'react', version: '16.12.0' }),
        'utf8',
      ),
      // A classic React surface: the adapter forwards automatic-JSX props to createElement.
      writeFile(
        path.join(reactRoot, 'index.js'),
        'export const Fragment = Symbol.for("react.fragment"); export function createElement(type, config) { return { type, config }; } export function createContext() { return {}; } export function forwardRef(value) { return value; } export function useContext() {} export function useMemo(value) { return value(); } export function useRef() { return {}; }',
        'utf8',
      ),
    ]);

    const result = await build({
      absWorkingDir: projectRoot,
      bundle: true,
      format: 'iife',
      globalName: 'NeutralChildren',
      jsx: 'automatic',
      jsxDev: true,
      logLevel: 'silent',
      plugins: [createPreviewInspectorRuntimePlugin({ projectRoot })],
      stdin: {
        contents: [
          "const key = Symbol.for('newdlops.react-file-preview.generated-neutral');",
          'const registry = globalThis[key] ?? (globalThis[key] = new WeakSet());',
          'const neutral = function ReactPreviewGeneratedContractNeutral() {};',
          'registry.add(neutral);',
          'const authoredCallback = () => "authored";',
          'export const single = () => <span>{neutral}</span>;',
          'export const mixed = () => <p>{neutral}{"text"}{authoredCallback}</p>;',
        ].join('\n'),
        loader: 'jsx',
        resolveDir: projectRoot,
        sourcefile: path.join(projectRoot, 'View.jsx'),
      },
      write: false,
    });
    const [outputFile] = result.outputFiles;
    if (outputFile === undefined) throw new Error('Expected an in-memory Page Inspector bundle.');
    const sandbox: Record<string, unknown> = {};
    sandbox.globalThis = sandbox;
    vm.runInNewContext(outputFile.text, sandbox);
    const views = sandbox.NeutralChildren as {
      readonly mixed: () => { readonly config: { readonly children: readonly unknown[] } };
      readonly single: () => { readonly config: { readonly children: unknown } };
    };

    expect(views.single().config.children).toBeNull();
    const mixed = views.mixed().config.children;
    expect(mixed[0]).toBeNull();
    expect(mixed[1]).toBe('text');
    // An authored function child is the application's own choice and is left to React.
    expect(typeof mixed[2]).toBe('function');
  });
});
