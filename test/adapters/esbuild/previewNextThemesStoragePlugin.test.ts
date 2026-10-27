/** Checks project-scoped next-themes storage without replacing provider behavior or other exports. */
import { build } from 'esbuild';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { createContext, runInContext } from 'node:vm';
import { describe, expect, it } from 'vitest';
import {
  createPreviewNextThemesStoragePlugin,
  createPreviewNextThemesStoragePrefix,
} from '../../../src/adapters/esbuild/previewNextThemesStoragePlugin';

describe('next-themes project storage', () => {
  it('keeps every authored provider option and re-exports the original hook instance', async () => {
    const root = await createFixture();
    try {
      const result = await runFixture(root, root);
      const prefix = createPreviewNextThemesStoragePrefix(root);
      expect(result).toEqual({
        defaultProps: {
          attribute: 'class',
          children: 'authored page',
          defaultTheme: 'light',
          disableTransitionOnChange: true,
          enableSystem: true,
          nonce: 'authored-nonce',
          storageKey: `${prefix}theme`,
        },
        customProps: {
          attribute: ['class', 'data-mode'],
          enableColorScheme: false,
          forcedTheme: 'dark',
          storageKey: `${prefix}appearance`,
          themes: ['day', 'night'],
          value: { night: 'dark' },
        },
        emptyKey: prefix,
        originalHookIdentity: true,
      });
    } finally {
      await rm(root, { force: true, recursive: true });
    }
  });

  it('uses the same key for one project and separate keys for projects sharing one package', async () => {
    const root = await createFixture();
    try {
      const a = path.join(root, 'project-a');
      const b = path.join(root, 'project-b');
      const first = await runFixture(root, a);
      const second = await runFixture(root, b);
      expect(first.defaultProps.storageKey).not.toBe(second.defaultProps.storageKey);
      expect(first.defaultProps.storageKey).toBe(
        `${createPreviewNextThemesStoragePrefix(path.join(a, 'nested', '..'))}theme`,
      );
      expect(first.defaultProps.storageKey).not.toContain(root);
    } finally {
      await rm(root, { force: true, recursive: true });
    }
  });

  it('does not invent a provider when the project has no installed next-themes package', async () => {
    const root = await mkdtemp(path.join(tmpdir(), 'react-preview-missing-next-themes-'));
    try {
      await expect(
        build({
          absWorkingDir: root,
          bundle: true,
          stdin: {
            contents: "import {ThemeProvider} from 'next-themes'; console.log(ThemeProvider);",
            resolveDir: root,
          },
          write: false,
          logLevel: 'silent',
          plugins: [createPreviewNextThemesStoragePlugin(root)],
        }),
      ).rejects.toThrow('Could not resolve "next-themes"');
    } finally {
      await rm(root, { force: true, recursive: true });
    }
  });
});

/** Narrow observable result from the installed-provider fixture. */
interface FixtureResult {
  readonly defaultProps: Record<string, unknown> & { readonly storageKey: string };
  readonly customProps: Record<string, unknown>;
  readonly emptyKey: string;
  readonly originalHookIdentity: boolean;
}

/** Creates inert installed-package fixtures so tests need no external application dependency. */
async function createFixture(): Promise<string> {
  const root = await mkdtemp(path.join(tmpdir(), 'react-preview-next-themes-storage-'));
  for (const name of ['react', 'next-themes']) {
    const directory = path.join(root, 'node_modules', name);
    await mkdir(directory, { recursive: true });
    await writeFile(
      path.join(directory, 'package.json'),
      JSON.stringify({ name, type: 'module', exports: './index.js' }),
    );
    await writeFile(
      path.join(directory, 'index.js'),
      name === 'react'
        ? 'export function createElement(type, props) { return type(props); }'
        : 'export const marker = {}; export function useTheme() { return marker; } export function ThemeProvider(props) { return props; }',
    );
  }
  return root;
}

/** Bundles the real facade and observes the untouched provider inputs and hook reference. */
async function runFixture(root: string, projectRoot: string): Promise<FixtureResult> {
  const entry = path.join(root, `consumer-${path.basename(projectRoot)}.js`);
  await writeFile(
    entry,
    `
import { ThemeProvider, useTheme, marker } from 'next-themes';
globalThis.result = {
 defaultProps: ThemeProvider({attribute:'class',defaultTheme:'light',enableSystem:true,disableTransitionOnChange:true,nonce:'authored-nonce',children:'authored page'}),
 customProps: ThemeProvider({storageKey:'appearance',forcedTheme:'dark',enableColorScheme:false,attribute:['class','data-mode'],themes:['day','night'],value:{night:'dark'}}),
 emptyKey: ThemeProvider({storageKey:''}).storageKey,
 originalHookIdentity: useTheme() === marker,
};`,
  );
  const result = await build({
    absWorkingDir: root,
    bundle: true,
    format: 'iife',
    platform: 'browser',
    write: false,
    logLevel: 'silent',
    plugins: [createPreviewNextThemesStoragePlugin(projectRoot)],
    entryPoints: [entry],
  });
  const context = createContext({});
  runInContext(result.outputFiles[0]?.text ?? '', context);
  return JSON.parse(JSON.stringify(context.result)) as FixtureResult;
}
