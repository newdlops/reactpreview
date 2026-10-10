/**
 * Guards the Tailwind 4.0 regression found by the release matrix: unsaved-editor candidates were
 * appended as `@source inline(...)`, which 4.0 rejects, and the fail-soft stylesheet then kept an
 * unresolvable `@import "tailwindcss"` that failed the whole preview build.
 */
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { build } from 'esbuild';
import { afterEach, describe, expect, it } from 'vitest';
import { createPreviewTailwindPlugin } from '../../../src/adapters/esbuild/previewTailwindPlugin';

const temporaryRoots: string[] = [];

afterEach(async () => {
  await Promise.all(
    temporaryRoots.splice(0).map((root) => rm(root, { force: true, recursive: true })),
  );
});

describe('Tailwind v4 release compatibility', () => {
  /** Tailwind 4.0 compiles with its own file scan instead of `@source inline`, also when bounded. */
  it('does not append inline sources or disable the scan for Tailwind 4.0', async () => {
    for (const bounded of [false, true]) {
      const { css, warnings } = await buildFixture('4.0.17', false, bounded);

      expect(css).toContain('.v4-generated');
      expect(warnings).toEqual([]);
    }
  });

  /** A failed compile keeps the authored CSS but drops the import esbuild cannot resolve. */
  it('omits an unresolvable tailwindcss import when compilation fails', async () => {
    const { css, warnings } = await buildFixture('4.1.0', true);

    expect(css).toContain('.authored');
    expect(css).not.toContain('@import');
    expect(warnings).toEqual([
      expect.stringContaining(
        'Tailwind compilation failed and the original stylesheet was retained',
      ),
    ]);
  });
});

/**
 * Builds `@import "tailwindcss"` with a fake v4 adapter that rejects `@source inline` like 4.0
 * (or always fails), installed only as a managed fallback so the project cannot resolve it itself.
 */
async function buildFixture(
  version: string,
  alwaysFail: boolean,
  boundedSourceDiscovery = false,
): Promise<{ readonly css: string; readonly warnings: readonly string[] }> {
  const projectRoot = await mkdtemp(path.join(tmpdir(), 'react-preview-tailwind-v4-'));
  temporaryRoots.push(projectRoot);
  const modules = path.join(projectRoot, 'managed', 'node_modules');
  const adapterRoot = path.join(modules, '@tailwindcss', 'postcss');
  await Promise.all([
    mkdir(path.join(projectRoot, 'src'), { recursive: true }),
    mkdir(adapterRoot, { recursive: true }),
    mkdir(path.join(modules, 'postcss'), { recursive: true }),
    mkdir(path.join(modules, 'tailwindcss'), { recursive: true }),
  ]);
  await Promise.all([
    writeFile(path.join(projectRoot, 'package.json'), '{"private":true}', 'utf8'),
    writeFile(
      path.join(projectRoot, 'src', 'index.css'),
      '@import "tailwindcss";\n.authored { color: red; }',
      'utf8',
    ),
    writeFile(
      path.join(modules, 'postcss', 'package.json'),
      '{"name":"postcss","version":"8.4.0","main":"index.js"}',
      'utf8',
    ),
    writeFile(
      path.join(modules, 'postcss', 'index.js'),
      'module.exports = (plugins) => ({ process: async (source, options) => { let result = { css: source, messages: [] }; for (const plugin of plugins) result = await plugin.transform(result.css, options); return result; } });',
      'utf8',
    ),
    writeFile(
      path.join(modules, 'tailwindcss', 'package.json'),
      JSON.stringify({ exports: { '.': { style: './index.css' } }, name: 'tailwindcss', version }),
      'utf8',
    ),
    writeFile(path.join(modules, 'tailwindcss', 'index.css'), '', 'utf8'),
    writeFile(
      path.join(adapterRoot, 'package.json'),
      JSON.stringify({ main: 'index.js', name: '@tailwindcss/postcss', version }),
      'utf8',
    ),
    writeFile(
      path.join(adapterRoot, 'index.js'),
      [
        'module.exports = () => ({',
        '  transform: async (source) => {',
        `    if (${String(alwaysFail)}) throw new Error("compile failed");`,
        '    if (source.includes("@source inline")) throw new Error("`@source` paths must be quoted.");',
        '    if (source.includes("source(none)")) return { css: ".nothing-scanned {}", messages: [] };',
        '    return { css: ".v4-generated { display: flex; }", messages: [] };',
        '  },',
        '});',
      ].join('\n'),
      'utf8',
    ),
  ]);
  await mkdir(path.join(modules, '@tailwindcss', 'oxide'), { recursive: true });
  await Promise.all([
    writeFile(
      path.join(modules, '@tailwindcss', 'oxide', 'package.json'),
      '{"name":"@tailwindcss/oxide","version":"4.0.17","main":"index.js"}',
      'utf8',
    ),
    writeFile(
      path.join(modules, '@tailwindcss', 'oxide', 'index.js'),
      'exports.Scanner = class Scanner { scanFiles(inputs) { return inputs.flatMap(({ content }) => content.match(/[a-z][a-z0-9-]*/g) || []); } };',
      'utf8',
    ),
  ]);
  const result = await build({
    absWorkingDir: projectRoot,
    bundle: true,
    entryPoints: [path.join(projectRoot, 'src', 'index.css')],
    logLevel: 'silent',
    outdir: path.join(projectRoot, 'out'),
    plugins: [
      createPreviewTailwindPlugin({
        boundedSourceDiscovery,
        fallbackNodeModulesPaths: [modules],
        projectRoot,
        readSourceSnapshots: () => [
          {
            documentPath: path.join(projectRoot, 'src', 'Card.tsx'),
            language: 'tsx',
            sourceText: 'export const Card = () => <div className="flex dirty-class" />;',
          },
        ],
        workspaceRoot: projectRoot,
      }),
    ],
    write: false,
  });
  return {
    css: result.outputFiles.find((file) => file.path.endsWith('.css'))?.text ?? '',
    warnings: result.warnings.map((warning) => warning.text),
  };
}
