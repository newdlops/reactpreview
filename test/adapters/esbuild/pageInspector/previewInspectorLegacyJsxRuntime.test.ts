/** Proves Page Inspector can compile JSX against React 16's classic public runtime surface. */
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { build } from 'esbuild';
import { afterEach, describe, expect, it } from 'vitest';
import { createPreviewInspectorRuntimePlugin } from '../../../../src/adapters/esbuild/pageInspector/previewInspectorRuntimePlugin';

const temporaryRoots: string[] = [];

afterEach(async () => {
  await Promise.all(
    temporaryRoots.splice(0).map((root) => rm(root, { force: true, recursive: true })),
  );
});

describe('Page Inspector legacy React JSX runtime', () => {
  it('falls back to createElement only when React resolves but jsx-dev-runtime does not', async () => {
    const projectRoot = await mkdtemp(path.join(os.tmpdir(), 'react-preview-react16-jsx-'));
    temporaryRoots.push(projectRoot);
    const reactRoot = path.join(projectRoot, 'node_modules', 'react');
    await mkdir(reactRoot, { recursive: true });
    await Promise.all([
      writeFile(
        path.join(reactRoot, 'package.json'),
        JSON.stringify({ main: 'index.js', name: 'react', version: '16.12.0' }),
        'utf8',
      ),
      writeFile(
        path.join(reactRoot, 'index.js'),
        'export const Fragment = Symbol.for("react.fragment"); export function createElement() {} export function createContext() { return {}; } export function forwardRef(value) { return value; } export function useContext() {} export function useMemo(value) { return value(); } export function useRef() { return {}; }',
        'utf8',
      ),
    ]);

    const result = await build({
      absWorkingDir: projectRoot,
      bundle: true,
      format: 'esm',
      jsx: 'automatic',
      jsxDev: true,
      logLevel: 'silent',
      plugins: [createPreviewInspectorRuntimePlugin({ projectRoot })],
      stdin: {
        contents: 'export const LegacyView = () => <main>React 16</main>;',
        loader: 'jsx',
        resolveDir: projectRoot,
        sourcefile: path.join(projectRoot, 'LegacyView.jsx'),
      },
      write: false,
    });

    const [outputFile] = result.outputFiles;
    if (outputFile === undefined) throw new Error('Expected an in-memory Page Inspector bundle.');
    const output = outputFile.text;
    expect(output).toContain('classicJsxDEV');
    expect(output).toContain('return createElement(type, createClassicConfig');
    expect(output).not.toContain('react/jsx-dev-runtime');
  });
});
