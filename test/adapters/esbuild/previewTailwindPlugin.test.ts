/** Verifies safe project-local Tailwind compilation, hot snapshots, and fail-soft CSS behavior. */
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { build, context, type BuildResult } from 'esbuild';
import { afterEach, describe, expect, it } from 'vitest';
import { createPreviewTailwindPlugin } from '../../../src/adapters/esbuild/previewTailwindPlugin';
import type { PreviewSourceSnapshot } from '../../../src/domain/preview';

const temporaryRoots: string[] = [];

afterEach(async () => {
  await Promise.all(
    temporaryRoots.splice(0).map((root) => rm(root, { force: true, recursive: true })),
  );
});

describe('createPreviewTailwindPlugin', () => {
  /** Compiles a Tailwind v4 entry and injects bounded candidates from unsaved TSX snapshots. */
  it('uses the exact v4 PostCSS adapter and refreshes dirty editor classes', async () => {
    const projectRoot = await createProject('tailwind-v4-');
    const stylesheetPath = path.join(projectRoot, 'src/globals.css');
    await mkdir(path.dirname(stylesheetPath), { recursive: true });
    await Promise.all([
      writeFile(stylesheetPath, "@import 'tailwindcss';\n@theme { --color-brand: red; }", 'utf8'),
      installFakePostcss(projectRoot),
      installFakeTailwindV4(projectRoot),
    ]);
    let snapshots: readonly PreviewSourceSnapshot[] = [
      createSnapshot(projectRoot, 'className="flex dirty-first"'),
    ];
    const buildContext = await context({
      absWorkingDir: projectRoot,
      bundle: true,
      entryPoints: [stylesheetPath],
      logLevel: 'silent',
      outdir: path.join(projectRoot, 'out'),
      plugins: [
        createPreviewTailwindPlugin({
          projectRoot,
          readSourceSnapshots: () => snapshots,
          workspaceRoot: projectRoot,
        }),
      ],
      write: false,
    });

    try {
      const first = await buildContext.rebuild();
      const firstCss = readCssOutput(first);
      expect(firstCss).toContain('.flex');
      expect(firstCss).toContain('.dirty-first');
      expect(firstCss).not.toContain('@tailwind');

      snapshots = [createSnapshot(projectRoot, 'className="flex dirty-second"')];
      const secondCss = readCssOutput(await buildContext.rebuild());
      expect(secondCss).toContain('.dirty-second');
      expect(secondCss).not.toContain('.dirty-first');
    } finally {
      await buildContext.dispose();
    }
  });

  /** Uses a v2/v3 package only with safe inline content instead of executing Tailwind config. */
  it('provides a configuration-free legacy PostCSS fallback', async () => {
    const projectRoot = await createProject('tailwind-v3-');
    const stylesheetPath = path.join(projectRoot, 'src/legacy.css');
    await mkdir(path.dirname(stylesheetPath), { recursive: true });
    await Promise.all([
      writeFile(stylesheetPath, '@tailwind utilities;', 'utf8'),
      installFakePostcss(projectRoot),
      installFakeLegacyTailwind(projectRoot),
    ]);
    const result = await buildStylesheet(projectRoot, stylesheetPath, [
      createSnapshot(projectRoot, 'className="legacy-dirty"'),
    ]);
    const css = readCssOutput(result);

    expect(css).toContain('.legacy-safe-baseline');
    expect(css).toContain('.raw-snapshot-true');
    expect(css).not.toContain('@tailwind');
    expect(result.warnings).toEqual([]);
  });

  /** Retains authored CSS and emits one concrete warning when no optional adapter is installed. */
  it('fails softly when the Tailwind compiler is unavailable', async () => {
    const projectRoot = await createProject('tailwind-missing-');
    const stylesheetPath = path.join(projectRoot, 'globals.css');
    await writeFile(
      stylesheetPath,
      '@tailwind utilities;\n.authored-fallback { display: block; }',
      'utf8',
    );
    const result = await buildStylesheet(projectRoot, stylesheetPath);

    expect(readCssOutput(result)).toContain('.authored-fallback');
    expect(result.warnings[0]?.text).toContain('No compatible project-local Tailwind');
  });

  /** Identifies zero-install PnP explicitly without executing its process-wide runtime hook. */
  it('explains the Yarn PnP zero-install adapter boundary', async () => {
    const projectRoot = await createProject('tailwind-pnp-');
    const stylesheetPath = path.join(projectRoot, 'globals.css');
    await Promise.all([
      writeFile(stylesheetPath, '@tailwind utilities;', 'utf8'),
      writeFile(path.join(projectRoot, '.pnp.cjs'), 'throw new Error("must not execute");', 'utf8'),
    ]);

    const result = await buildStylesheet(projectRoot, stylesheetPath);

    expect(result.warnings[0]?.text).toContain('Yarn PnP zero-install');
    expect(result.warnings[0]?.text).toContain('Unplug @tailwindcss/postcss');
  });

  /** Never invokes executable CSS directives or explicit source scans outside the workspace. */
  it('blocks unsafe Tailwind directives before loading project adapters', async () => {
    const projectRoot = await createProject('tailwind-unsafe-');
    const pluginPath = path.join(projectRoot, 'plugin.css');
    const sourcePath = path.join(projectRoot, 'outside-source.css');
    const importSourcePath = path.join(projectRoot, 'outside-import-source.css');
    const nestedRootPath = path.join(projectRoot, 'nested-root.css');
    const nestedStylePath = path.join(projectRoot, 'nested.css');
    const unquotedRootPath = path.join(projectRoot, 'unquoted-root.css');
    const malformedRootPath = path.join(projectRoot, 'malformed-root.css');
    await Promise.all([
      writeFile(pluginPath, "@tailwind utilities;\n@plugin './project-code.js';", 'utf8'),
      writeFile(sourcePath, "@tailwind utilities;\n@source '../../outside/**/*.tsx';", 'utf8'),
      writeFile(
        importSourcePath,
        "@import 'tailwindcss' source('../../outside/**/*.tsx');",
        'utf8',
      ),
      writeFile(nestedRootPath, "@import './nested.css';\n@tailwind utilities;", 'utf8'),
      writeFile(nestedStylePath, "@plugin './nested-project-code.js';", 'utf8'),
      writeFile(unquotedRootPath, '@import url(./nested.css);\n@tailwind utilities;', 'utf8'),
      writeFile(malformedRootPath, '@import url(./nested.css;\n@tailwind utilities;', 'utf8'),
      installFakePostcss(projectRoot),
      installFakeTailwindV4(projectRoot),
      installFakeTailwindCssStylePackage(projectRoot),
    ]);

    const pluginResult = await buildStylesheet(projectRoot, pluginPath);
    expect(readCssOutput(pluginResult)).not.toContain('.fake-v4-generated');
    expect(pluginResult.warnings[0]?.text).toContain('@plugin and @config');
    const sourceResult = await buildStylesheet(projectRoot, sourcePath);
    expect(readCssOutput(sourceResult)).not.toContain('.fake-v4-generated');
    expect(sourceResult.warnings[0]?.text).toContain('outside workspace-owned source');
    const importSourceResult = await buildStylesheet(projectRoot, importSourcePath);
    expect(readCssOutput(importSourceResult)).not.toContain('.fake-v4-generated');
    expect(importSourceResult.warnings[0]?.text).toContain('outside workspace-owned source');
    const nestedResult = await buildStylesheet(projectRoot, nestedRootPath);
    expect(readCssOutput(nestedResult)).not.toContain('.fake-v4-generated');
    expect(nestedResult.warnings[0]?.text).toContain('imported CSS contains @plugin');
    const unquotedResult = await buildStylesheet(projectRoot, unquotedRootPath);
    expect(readCssOutput(unquotedResult)).not.toContain('.fake-v4-generated');
    expect(unquotedResult.warnings[0]?.text).toContain('imported CSS contains @plugin');
    const malformedResult = await buildStylesheet(projectRoot, malformedRootPath);
    expect(readCssOutput(malformedResult)).not.toContain('.fake-v4-generated');
    expect(malformedResult.warnings[0]?.text).toContain('unterminated @import');
  });

  /** Keeps CSS Modules local naming after Tailwind transforms their declarations. */
  it('preserves the local-css loader for Tailwind CSS Modules', async () => {
    const projectRoot = await createProject('tailwind-module-');
    const entryPath = path.join(projectRoot, 'entry.js');
    const stylesheetPath = path.join(projectRoot, 'theme.module.css');
    await Promise.all([
      writeFile(
        entryPath,
        "import styles from './theme.module.css'; console.log(styles.generated);",
        'utf8',
      ),
      writeFile(stylesheetPath, '@apply flex;', 'utf8'),
      installFakePostcss(projectRoot),
      installFakeTailwindV4(projectRoot),
    ]);
    const result = await build({
      absWorkingDir: projectRoot,
      bundle: true,
      entryPoints: [entryPath],
      logLevel: 'silent',
      outdir: path.join(projectRoot, 'out'),
      plugins: [createPreviewTailwindPlugin({ projectRoot, workspaceRoot: projectRoot })],
      write: false,
    });

    expect(result.outputFiles.find((output) => output.path.endsWith('.js'))?.text).toMatch(
      /generated:\s*"theme_generated"/u,
    );
    expect(readCssOutput(result)).toContain('.theme_generated');
  });
});

/** Creates one isolated package and records it for deterministic cleanup. */
async function createProject(prefix: string): Promise<string> {
  const projectRoot = await mkdtemp(path.join(tmpdir(), `react-preview-${prefix}`));
  temporaryRoots.push(projectRoot);
  await writeFile(path.join(projectRoot, 'package.json'), '{"private":true}', 'utf8');
  return projectRoot;
}

/** Builds one stylesheet through the production adapter with optional dirty-source overlays. */
function buildStylesheet(
  projectRoot: string,
  stylesheetPath: string,
  snapshots: readonly PreviewSourceSnapshot[] = [],
): Promise<BuildResult> {
  return build({
    absWorkingDir: projectRoot,
    bundle: true,
    entryPoints: [stylesheetPath],
    logLevel: 'silent',
    outdir: path.join(projectRoot, 'out'),
    plugins: [
      createPreviewTailwindPlugin({
        projectRoot,
        readSourceSnapshots: () => snapshots,
        workspaceRoot: projectRoot,
      }),
    ],
    write: false,
  });
}

/** Reads the single emitted CSS artifact regardless of esbuild's entry naming. */
function readCssOutput(result: BuildResult): string {
  const stylesheet = result.outputFiles?.find((output) => output.path.endsWith('.css'));
  if (stylesheet === undefined) throw new Error('Expected a CSS output.');
  return stylesheet.text;
}

/** Creates one dirty TSX snapshot whose disk file intentionally does not need to exist. */
function createSnapshot(projectRoot: string, sourceText: string): PreviewSourceSnapshot {
  return {
    documentPath: path.join(projectRoot, 'src/DirtyPreview.tsx'),
    language: 'tsx',
    sourceText,
  };
}

/** Installs a tiny structural PostCSS implementation used by both fake Tailwind generations. */
async function installFakePostcss(projectRoot: string): Promise<void> {
  const packageRoot = path.join(projectRoot, 'node_modules/postcss');
  await mkdir(packageRoot, { recursive: true });
  await Promise.all([
    writeFile(
      path.join(packageRoot, 'package.json'),
      '{"name":"postcss","version":"8.4.0","main":"index.js"}',
      'utf8',
    ),
    writeFile(
      path.join(packageRoot, 'index.js'),
      [
        'module.exports = (plugins) => ({',
        '  process: async (source, options) => {',
        '    let result = { css: source, messages: [] };',
        '    for (const plugin of plugins) result = await plugin.transform(result.css, options);',
        '    return result;',
        '  },',
        '});',
      ].join('\n'),
      'utf8',
    ),
  ]);
}

/** Installs a v4 adapter and native scanner fixture mirroring UDT's package topology. */
async function installFakeTailwindV4(projectRoot: string): Promise<void> {
  const adapterRoot = path.join(projectRoot, 'node_modules/@tailwindcss/postcss');
  const oxideRoot = path.join(projectRoot, 'node_modules/@tailwindcss/oxide');
  await Promise.all([
    mkdir(adapterRoot, { recursive: true }),
    mkdir(oxideRoot, { recursive: true }),
  ]);
  await Promise.all([
    writeFile(
      path.join(adapterRoot, 'package.json'),
      '{"name":"@tailwindcss/postcss","version":"4.1.0","main":"index.js"}',
      'utf8',
    ),
    writeFile(
      path.join(adapterRoot, 'index.js'),
      [
        'let processorCreations = 0;',
        'module.exports = (adapterOptions) => {',
        '  processorCreations += 1;',
        '  if (processorCreations > 1) throw new Error("processor recreated");',
        '  return {',
        '  transform: async (source, options) => {',
        '    const inline = /@source inline\\("([^"]*)"\\)/.exec(source)?.[1] || "";',
        '    const classes = inline.split(/\\s+/).filter((value) => value.includes("dirty-")).map((value) => `.${value} { display: block; }`).join("\\n");',
        '    return {',
        '      css: `/* base:${adapterOptions.base}; inline:${inline} */\\n.fake-v4-generated,.generated,.flex { display: flex; }\\n${classes}`,',
        '      messages: [{ type: "dependency", file: options.from }],',
        '    };',
        '  },',
        '  };',
        '};',
      ].join('\n'),
      'utf8',
    ),
    writeFile(
      path.join(oxideRoot, 'package.json'),
      '{"name":"@tailwindcss/oxide","version":"4.1.0","main":"index.js"}',
      'utf8',
    ),
    writeFile(
      path.join(oxideRoot, 'index.js'),
      [
        'exports.Scanner = class Scanner {',
        '  scanFiles(inputs) {',
        '    return inputs.flatMap(({ content }) => content.match(/[a-z][a-z0-9-]*/g) || []);',
        '  }',
        '};',
      ].join('\n'),
      'utf8',
    ),
  ]);
}

/** Installs a Tailwind v3 fixture that exposes whether raw dirty content was supplied safely. */
async function installFakeLegacyTailwind(projectRoot: string): Promise<void> {
  const packageRoot = path.join(projectRoot, 'node_modules/tailwindcss');
  await mkdir(packageRoot, { recursive: true });
  await Promise.all([
    writeFile(
      path.join(packageRoot, 'package.json'),
      '{"name":"tailwindcss","version":"3.4.0","main":"index.js"}',
      'utf8',
    ),
    writeFile(
      path.join(packageRoot, 'index.js'),
      [
        'module.exports = (configuration) => ({',
        '  transform: async () => {',
        '    const raw = configuration.content.some((entry) => typeof entry === "object" && entry.raw.includes("legacy-dirty"));',
        '    return { css: `.legacy-safe-baseline,.raw-snapshot-${raw} { display: block; }`, messages: [] };',
        '  },',
        '});',
      ].join('\n'),
      'utf8',
    ),
  ]);
}

/** Installs a CSS-only Tailwind export so fail-soft import tests can finish normal esbuild output. */
async function installFakeTailwindCssStylePackage(projectRoot: string): Promise<void> {
  const packageRoot = path.join(projectRoot, 'node_modules/tailwindcss');
  await mkdir(packageRoot, { recursive: true });
  await Promise.all([
    writeFile(
      path.join(packageRoot, 'package.json'),
      '{"name":"tailwindcss","version":"4.1.0","exports":"./index.css"}',
      'utf8',
    ),
    writeFile(path.join(packageRoot, 'index.css'), '@layer utilities {}', 'utf8'),
  ]);
}
