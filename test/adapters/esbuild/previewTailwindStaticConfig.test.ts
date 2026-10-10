/** Verifies that Tailwind v2/v3 configuration is recovered as data without executing it. */
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { readPreviewTailwindStaticConfig } from '../../../src/adapters/esbuild/previewTailwindStaticConfig';

const temporaryRoots: string[] = [];
const TAILWIND_DATA: Readonly<Record<string, unknown>> = {
  'tailwindcss/colors': { teal: { 500: '#14b8a6' }, white: '#fff' },
  'tailwindcss/defaultTheme': { fontFamily: { sans: ['ui-sans-serif', 'system-ui'] } },
};

afterEach(async () => {
  await Promise.all(
    temporaryRoots.splice(0).map((root) => rm(root, { force: true, recursive: true })),
  );
});

describe('readPreviewTailwindStaticConfig', () => {
  /** Follows CommonJS bindings, Tailwind data modules, and a directory token module. */
  it('evaluates a CommonJS configuration with local tokens and Tailwind colors', async () => {
    const root = await createProject({
      'tailwind.config.js': [
        "const colors = require('tailwindcss/colors');",
        "const { fontFamily } = require('tailwindcss/defaultTheme');",
        "const tokens = require('./tokens');",
        "const radius = '6px';",
        'globalThis.__previewTailwindConfigExecuted = true;',
        'module.exports = {',
        "  content: ['./src/**/*.tsx'],",
        "  darkMode: ['class', '[data-theme=\"dark\"]'],",
        '  theme: {',
        '    extend: {',
        '      colors: { ...tokens.palette, accent: colors.teal[500], white: colors.white },',
        "      fontFamily: { sans: ['Hanken Grotesk', ...fontFamily.sans] },",
        '      borderRadius: { card: `calc(${radius} * 2)` },',
        '      spacing: ({ theme }) => theme("size"),',
        '    },',
        '  },',
        "  plugins: [require('@tailwindcss/forms')],",
        '};',
      ].join('\n'),
      'tokens/index.js': "module.exports = { palette: { s400: '#5f6b7a', s200: '#e7ebef' } };",
    });

    const result = readPreviewTailwindStaticConfig(root, readTailwindData);

    expect(result?.config).toEqual({
      darkMode: ['class', '[data-theme="dark"]'],
      theme: {
        extend: {
          borderRadius: { card: 'calc(6px * 2)' },
          colors: { accent: '#14b8a6', s200: '#e7ebef', s400: '#5f6b7a', white: '#fff' },
          fontFamily: { sans: ['Hanken Grotesk', 'ui-sans-serif', 'system-ui'] },
        },
      },
    });
    expect(result?.skipped).toEqual(['config.theme.extend.spacing', 'config.plugins']);
    expect(result?.dependencyPaths).toEqual([
      path.join(root, 'tailwind.config.js'),
      path.join(root, 'tokens', 'index.js'),
    ]);
    expect(Reflect.get(globalThis, '__previewTailwindConfigExecuted')).toBeUndefined();
  });

  /** Unwraps `satisfies`/`as`, named token imports, regular expressions, and empty arrays. */
  it('evaluates a TypeScript configuration with ESM imports', async () => {
    const root = await createProject({
      'design/tokens.ts': [
        "export const brand = { DEFAULT: '#2563eb', dark: '#1e40af' } as const;",
        'export const shadows = { card: "0 1px 2px rgb(0 0 0 / 0.08)" };',
      ].join('\n'),
      'tailwind.config.ts': [
        "import type { Config } from 'tailwindcss';",
        "import colors from 'tailwindcss/colors';",
        "import { brand, shadows as boxShadow } from './design/tokens';",
        'export default {',
        "  content: ['./index.html'],",
        "  prefix: 'tw-',",
        '  safelist: [{ pattern: /^bg-brand-(dark|light)$/u }],',
        '  theme: { extend: { colors: { brand, teal: colors.teal }, boxShadow } },',
        '  plugins: [],',
        '  presets: [],',
        '} satisfies Config;',
      ].join('\n'),
    });

    const result = readPreviewTailwindStaticConfig(root, readTailwindData);

    expect(result?.config).toEqual({
      prefix: 'tw-',
      presets: [],
      safelist: [{ pattern: /^bg-brand-(dark|light)$/u }],
      theme: {
        extend: {
          boxShadow: { card: '0 1px 2px rgb(0 0 0 / 0.08)' },
          colors: { brand: { DEFAULT: '#2563eb', dark: '#1e40af' }, teal: { 500: '#14b8a6' } },
        },
      },
    });
    expect(result?.skipped).toEqual([]);
  });

  /** Admits a local data-only preset but still reports the plugin it lists. */
  it('keeps data from a local preset and reports its plugins', async () => {
    const root = await createProject({
      'preset.cjs': [
        'module.exports = {',
        "  theme: { colors: { ink: '#111' } },",
        "  plugins: [require('tailwindcss-animate')],",
        '};',
      ].join('\n'),
      'tailwind.config.cjs': "module.exports = { presets: [require('./preset.cjs')] };",
    });

    const result = readPreviewTailwindStaticConfig(root, readTailwindData);

    expect(result?.config).toEqual({ presets: [{ theme: { colors: { ink: '#111' } } }] });
    expect(result?.skipped).toEqual(['config.presets[].plugins']);
  });

  /** Terminates on mutually recursive token modules instead of overflowing the stack. */
  it('treats cyclic bindings as unknown', async () => {
    const root = await createProject({
      'a.js': "const b = require('./b'); module.exports = { colors: b.colors };",
      'b.js': "const a = require('./a'); module.exports = { colors: a.colors };",
      'tailwind.config.js': [
        "const a = require('./a');",
        'const loop = loop;',
        "module.exports = { theme: { colors: a.colors, spacing: loop, opacity: { 50: '0.5' } } };",
      ].join('\n'),
    });

    const result = readPreviewTailwindStaticConfig(root, readTailwindData);

    expect(result?.config).toEqual({ theme: { opacity: { 50: '0.5' } } });
    expect(result?.skipped).toContain('config.theme.colors');
    expect(result?.skipped).toContain('config.theme.spacing');
  });

  /** Follows monorepo token modules inside the workspace but never reads outside it. */
  it('reads token modules only inside the workspace boundary', async () => {
    const workspace = await createProject({
      'apps/web/tailwind.config.js': [
        "const shared = require('../../packages/tokens/colors.json');",
        'module.exports = { theme: { colors: shared } };',
      ].join('\n'),
      'packages/tokens/colors.json': '{ "ink": "#111" }',
    });
    const styleRoot = path.join(workspace, 'apps', 'web');

    expect(readPreviewTailwindStaticConfig(styleRoot, readTailwindData, workspace)?.config).toEqual(
      { theme: { colors: { ink: '#111' } } },
    );
    expect(readPreviewTailwindStaticConfig(styleRoot, readTailwindData, styleRoot)).toEqual({
      config: { theme: {} },
      dependencyPaths: [path.join(styleRoot, 'tailwind.config.js')],
      skipped: ['config.theme.colors'],
    });
  });

  /** Leaves Tailwind defaults when no configuration exists or it exports a function. */
  it('returns undefined without a data configuration', async () => {
    const empty = await createProject({});
    const functional = await createProject({
      'tailwind.config.js': 'module.exports = () => ({ theme: {} });',
    });

    expect(readPreviewTailwindStaticConfig(empty, readTailwindData)).toBeUndefined();
    expect(readPreviewTailwindStaticConfig(functional, readTailwindData)).toBeUndefined();
  });
});

/** Stands in for Tailwind's own data modules, which the adapter loads from the running package. */
function readTailwindData(specifier: string): unknown {
  if (!Object.hasOwn(TAILWIND_DATA, specifier)) throw new Error(`Unexpected ${specifier}`);
  return TAILWIND_DATA[specifier];
}

/** Writes one isolated project whose files are only ever read, never imported. */
async function createProject(files: Readonly<Record<string, string>>): Promise<string> {
  const root = await mkdtemp(path.join(tmpdir(), 'react-preview-tailwind-config-'));
  temporaryRoots.push(root);
  for (const [relativePath, text] of Object.entries(files)) {
    const filePath = path.join(root, relativePath);
    await mkdir(path.dirname(filePath), { recursive: true });
    await writeFile(filePath, text, 'utf8');
  }
  return root;
}
