/**
 * Verifies CSS package-export adaptation independently from the larger preview compiler graph.
 * Tests keep JavaScript and CSS imports in one build so an accidental build-wide `style` condition
 * would immediately select the wrong package target and fail the JavaScript assertion.
 */
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { build, type OutputFile } from 'esbuild';
import { describe, expect, it } from 'vitest';
import { createPreviewAssetPlugin } from '../../../src/adapters/esbuild/previewAssetPlugin';

const PROJECT_ROOT = fileURLToPath(new URL('../../../', import.meta.url));

describe('createPreviewAssetPlugin CSS package exports', () => {
  /** Resolves `style` for CSS while the same bare package retains its normal ESM JavaScript export. */
  it('applies the style condition only to CSS import rules', async () => {
    const fixture = await createStylePackageFixture('preview-conditional-style');
    const watchDirectories: string[] = [];
    try {
      const outputFiles = await buildStylePackageFixture(fixture, (directoryPath) => {
        watchDirectories.push(directoryPath);
      });
      const javascript = readOutputText(outputFiles, '.js');
      const stylesheet = readOutputText(outputFiles, '.css');

      expect(javascript).toContain('JAVASCRIPT_PACKAGE_EXPORT_MARKER');
      expect(stylesheet).toContain('CSS_PACKAGE_STYLE_EXPORT_MARKER');
      expect(stylesheet).toContain('rgb(12, 34, 56)');
      expect(watchDirectories).toContain(fixture.packageRoot);
    } finally {
      await rm(fixture.root, { force: true, recursive: true });
    }
  });

  /** Keeps query-bearing style requests distinct inside the rebuild-local resolver cache. */
  it('preserves a separate suffix for each CSS package import', async () => {
    const fixture = await createStylePackageFixture('preview-style-query-cache');
    try {
      await writeFile(
        fixture.stylesheetPath,
        `@import "${fixture.packageName}?first";\n@import "${fixture.packageName}?second";`,
        'utf8',
      );

      const stylesheet = readOutputText(await buildStylePackageFixture(fixture), '.css');
      expect(stylesheet.match(/CSS_PACKAGE_STYLE_EXPORT_MARKER/gu)).toHaveLength(2);
    } finally {
      await rm(fixture.root, { force: true, recursive: true });
    }
  });

  /** Leaves an exact direct CSS subpath export to esbuild instead of claiming it as conditional. */
  it('does not reinterpret direct CSS package subpath exports', async () => {
    const fixture = await createStylePackageFixture('preview-direct-css-subpath');
    const manifestPath = path.join(fixture.packageRoot, 'package.json');
    try {
      const manifest = JSON.parse(await readFile(manifestPath, 'utf8')) as Record<string, unknown>;
      manifest.exports = {
        '.': {
          style: './theme.css',
          import: './index.js',
          default: './index.js',
        },
        './tokens.css': './tokens.css',
      };
      await Promise.all([
        writeFile(manifestPath, JSON.stringify(manifest), 'utf8'),
        writeFile(
          path.join(fixture.packageRoot, 'tokens.css'),
          '.direct-token { color: rgb(65, 43, 21); }',
          'utf8',
        ),
        writeFile(
          fixture.stylesheetPath,
          `@import "${fixture.packageName}/tokens.css";\n.local-rule { display: block; }`,
          'utf8',
        ),
      ]);

      const outputFiles = await buildStylePackageFixture(fixture);
      const stylesheet = readOutputText(outputFiles, '.css');
      expect(stylesheet).toContain('rgb(65, 43, 21)');
    } finally {
      await rm(fixture.root, { force: true, recursive: true });
    }
  });
});

/** Paths and package identity shared by one isolated resolver fixture. */
interface StylePackageFixture {
  /** JavaScript entry importing both the package runtime and local stylesheet. */
  readonly entryPath: string;
  /** Exact package name authored in JS and CSS imports. */
  readonly packageName: string;
  /** Installed fake package root containing its manifest and conditional targets. */
  readonly packageRoot: string;
  /** Temporary project boundary removed after each test. */
  readonly root: string;
  /** Local CSS file containing the bare package import rule. */
  readonly stylesheetPath: string;
}

/** Creates one installed package whose root export differs under `style` and `import`. */
async function createStylePackageFixture(packageName: string): Promise<StylePackageFixture> {
  const root = await mkdtemp(path.join(PROJECT_ROOT, 'test/fixtures/css-package-style-'));
  const packageRoot = path.join(root, 'node_modules', packageName);
  const entryPath = path.join(root, 'entry.js');
  const stylesheetPath = path.join(root, 'entry.css');
  await mkdir(packageRoot, { recursive: true });
  await Promise.all([
    writeFile(
      path.join(packageRoot, 'package.json'),
      JSON.stringify({
        exports: {
          style: './theme.css',
          import: './index.js',
          default: './index.js',
        },
        name: packageName,
        type: 'module',
      }),
      'utf8',
    ),
    writeFile(
      path.join(packageRoot, 'index.js'),
      "export default 'JAVASCRIPT_PACKAGE_EXPORT_MARKER';",
      'utf8',
    ),
    writeFile(
      path.join(packageRoot, 'theme.css'),
      '.CSS_PACKAGE_STYLE_EXPORT_MARKER { color: rgb(12, 34, 56); }',
      'utf8',
    ),
    writeFile(
      entryPath,
      `import packageValue from "${packageName}";\nimport './entry.css';\nconsole.log(packageValue);`,
      'utf8',
    ),
    writeFile(stylesheetPath, `@import "${packageName}";\n.local-rule { display: block; }`, 'utf8'),
  ]);
  return { entryPath, packageName, packageRoot, root, stylesheetPath };
}

/** Runs the production asset plugin with browser bundle defaults used by React Preview. */
async function buildStylePackageFixture(
  fixture: StylePackageFixture,
  registerWatchDirectory?: (directoryPath: string) => void,
): Promise<readonly OutputFile[]> {
  const result = await build({
    absWorkingDir: fixture.root,
    bundle: true,
    entryPoints: [fixture.entryPath],
    format: 'esm',
    outdir: path.join(fixture.root, 'out'),
    platform: 'browser',
    plugins: [
      createPreviewAssetPlugin({
        documentPath: fixture.entryPath,
        projectRoot: fixture.root,
        ...(registerWatchDirectory === undefined ? {} : { registerWatchDirectory }),
        workspaceRoot: fixture.root,
      }),
    ],
    write: false,
  });
  return result.outputFiles;
}

/** Selects one generated artifact by extension and decodes it as UTF-8 text. */
function readOutputText(
  outputFiles: readonly { readonly path: string; readonly text: string }[],
  extension: string,
): string {
  const output = outputFiles.find((candidate) => candidate.path.endsWith(extension));
  if (output === undefined) throw new Error(`Expected an esbuild ${extension} output file.`);
  return output.text;
}
