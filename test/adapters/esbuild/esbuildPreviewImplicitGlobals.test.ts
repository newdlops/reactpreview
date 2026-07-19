/**
 * Exercises implicit application globals through the complete preview compiler boundary.
 * The fixtures prove both project-wrapper evidence and the conservative same-name installed-package
 * fallback without loading an application entry point or executing a development server.
 */
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { EsbuildPreviewCompiler } from '../../../src/adapters/esbuild/esbuildPreviewCompiler';
import type { PreviewBundle } from '../../../src/domain/preview';

const PROJECT_ROOT = fileURLToPath(new URL('../../../', import.meta.url));

describe('EsbuildPreviewCompiler implicit application globals', () => {
  /** Prefers the configured wrapper named by ambient project evidence over a bare package guess. */
  it('injects an ambient-declared workspace wrapper before a reached child evaluates', async () => {
    const projectRoot = await createTemporaryProject('ambient-global-preview-');
    const sourceDirectory = path.join(projectRoot, 'src');
    const documentPath = path.join(sourceDirectory, 'Page.tsx');
    const childPath = path.join(sourceDirectory, 'Child.tsx');
    const declarationPath = path.join(sourceDirectory, 'global.d.ts');
    const wrapperPath = path.join(sourceDirectory, 'configured-dayjs.ts');
    const sourceText = [
      "import { Child } from './Child';",
      'export default function Page() { return <main><Child /></main>; }',
    ].join('\n');

    try {
      await mkdir(sourceDirectory, { recursive: true });
      await Promise.all([
        writeFile(documentPath, sourceText, 'utf8'),
        writeFile(
          childPath,
          [
            "const label = dayjs('ready');",
            'export function Child() { return <span>{label}</span>; }',
          ].join('\n'),
          'utf8',
        ),
        writeFile(
          declarationPath,
          [
            'declare global {',
            '  var dayjs: typeof import("./configured-dayjs").default;',
            '}',
            'export {};',
          ].join('\n'),
          'utf8',
        ),
        writeFile(
          wrapperPath,
          [
            "const configuredDayjs = (value: string) => 'WRAPPER_GLOBAL_MARKER:' + value;",
            'export default configuredDayjs;',
          ].join('\n'),
          'utf8',
        ),
      ]);

      const bundle = await new EsbuildPreviewCompiler().compile({
        dependencySnapshots: [],
        documentPath,
        language: 'tsx',
        sourceText,
        useStorybookPreview: false,
        workspaceRoot: projectRoot,
      });
      const javascript = decodeBundleJavascript(bundle);

      expect(javascript).toContain('WRAPPER_GLOBAL_MARKER');
      expect(javascript).toContain('from project bootstrap/ambient evidence');
      expect(bundle.dependencies).toEqual(
        expect.arrayContaining([declarationPath, wrapperPath, childPath]),
      );
    } finally {
      await rm(projectRoot, { force: true, recursive: true });
    }
  });

  /** Reuses a project process/browser import proven by the app's unexecuted self-fallback bootstrap. */
  it('injects an exact process browser module from runtime bootstrap evidence', async () => {
    const projectRoot = await createTemporaryProject('process-bootstrap-global-preview-', {
      process: '1.0.0',
    });
    const sourceDirectory = path.join(projectRoot, 'src');
    const processDirectory = path.join(projectRoot, 'node_modules', 'process');
    const documentPath = path.join(sourceDirectory, 'ProcessPage.tsx');
    const childPath = path.join(sourceDirectory, 'ProcessChild.tsx');
    const bootstrapPath = path.join(sourceDirectory, 'index.ts');
    const processBrowserPath = path.join(processDirectory, 'browser.js');
    const sourceText = [
      "import { ProcessChild } from './ProcessChild';",
      'export default function ProcessPage() { return <main><ProcessChild /></main>; }',
    ].join('\n');

    try {
      await Promise.all([
        mkdir(sourceDirectory, { recursive: true }),
        mkdir(processDirectory, { recursive: true }),
      ]);
      await Promise.all([
        writeFile(documentPath, sourceText, 'utf8'),
        writeFile(
          childPath,
          [
            'const processMarker = process.previewMarker;',
            'export function ProcessChild() { return <span>{processMarker}</span>; }',
          ].join('\n'),
          'utf8',
        ),
        writeFile(
          bootstrapPath,
          [
            "import process from 'process/browser';",
            'window.process = window.process || process;',
            "throw new Error('BOOTSTRAP_MUST_NOT_EXECUTE');",
          ].join('\n'),
          'utf8',
        ),
        writeFile(
          path.join(processDirectory, 'package.json'),
          JSON.stringify({ browser: './browser.js', main: './browser.js', name: 'process' }),
          'utf8',
        ),
        writeFile(
          processBrowserPath,
          "module.exports = { platform: 'browser', previewMarker: 'PROJECT_PROCESS_MARKER' };",
          'utf8',
        ),
      ]);

      const bundle = await new EsbuildPreviewCompiler().compile({
        dependencySnapshots: [],
        documentPath,
        language: 'tsx',
        sourceText,
        useStorybookPreview: false,
        workspaceRoot: projectRoot,
      });
      const javascript = decodeBundleJavascript(bundle);

      expect(javascript).toContain('PROJECT_PROCESS_MARKER');
      expect(javascript).toContain('from project bootstrap/ambient evidence');
      expect(javascript).not.toContain('BOOTSTRAP_MUST_NOT_EXECUTE');
      expect(bundle.dependencies).toEqual(
        expect.arrayContaining([bootstrapPath, childPath, processBrowserPath]),
      );
    } finally {
      await rm(projectRoot, { force: true, recursive: true });
    }
  });

  /** Page Inspector keeps exact app-entry globals even when the entry is outside the render chain. */
  it('injects conventional bootstrap globals into a page-inspector graph', async () => {
    const projectRoot = await createTemporaryProject('page-inspector-bootstrap-global-preview-');
    const sourceDirectory = path.join(projectRoot, 'src');
    const documentPath = path.join(sourceDirectory, 'Target.tsx');
    const pagePath = path.join(sourceDirectory, 'Page.tsx');
    const bootstrapPath = path.join(sourceDirectory, 'index.tsx');
    const wrapperPath = path.join(sourceDirectory, 'decimal.ts');
    const sourceText = 'export function Target() { return <span>{decimal(2)}</span>; }';

    try {
      await mkdir(sourceDirectory, { recursive: true });
      await Promise.all([
        writeFile(documentPath, sourceText, 'utf8'),
        writeFile(
          pagePath,
          [
            "import { Target } from './Target';",
            'export default function Page() { return <main><Target /></main>; }',
          ].join('\n'),
          'utf8',
        ),
        writeFile(
          bootstrapPath,
          [
            "import decimalValue from './decimal';",
            'globalThis.decimal = decimalValue;',
            "throw new Error('PAGE_BOOTSTRAP_MUST_NOT_EXECUTE');",
          ].join('\n'),
          'utf8',
        ),
        writeFile(
          wrapperPath,
          "export default (value: number) => 'PAGE_DECIMAL_MARKER:' + value;",
          'utf8',
        ),
      ]);

      const bundle = await new EsbuildPreviewCompiler().compile({
        dependencySnapshots: [],
        documentPath,
        language: 'tsx',
        renderMode: 'page-inspector',
        sourceText,
        useStorybookPreview: false,
        workspaceRoot: projectRoot,
      });
      const javascript = decodeBundleJavascript(bundle);

      expect(javascript).toContain('PAGE_DECIMAL_MARKER');
      expect(javascript).toContain('from project bootstrap/ambient evidence');
      expect(javascript).not.toContain('PAGE_BOOTSTRAP_MUST_NOT_EXECUTE');
      expect(bundle.dependencies).toEqual(
        expect.arrayContaining([bootstrapPath, wrapperPath, pagePath]),
      );
    } finally {
      await rm(projectRoot, { force: true, recursive: true });
    }
  });

  /** Rebuilds once only after the reached graph proves a free exact-name installed dependency. */
  it('injects an exact installed package for a reached free identifier', async () => {
    const projectRoot = await createTemporaryProject('package-global-preview-', {
      clock: '1.0.0',
    });
    const sourceDirectory = path.join(projectRoot, 'src');
    const packageDirectory = path.join(projectRoot, 'node_modules', 'clock');
    const documentPath = path.join(sourceDirectory, 'ClockPage.tsx');
    const sourceText = [
      "const label = clock('ready');",
      'export default function ClockPage() { return <main>{label}</main>; }',
    ].join('\n');

    try {
      await Promise.all([
        mkdir(sourceDirectory, { recursive: true }),
        mkdir(packageDirectory, { recursive: true }),
      ]);
      await Promise.all([
        writeFile(documentPath, sourceText, 'utf8'),
        writeFile(
          path.join(packageDirectory, 'package.json'),
          JSON.stringify({ main: 'index.js', name: 'clock', version: '1.0.0' }),
          'utf8',
        ),
        writeFile(
          path.join(packageDirectory, 'index.js'),
          "module.exports = (value) => 'PACKAGE_GLOBAL_MARKER:' + value;",
          'utf8',
        ),
      ]);

      const bundle = await new EsbuildPreviewCompiler().compile({
        dependencySnapshots: [],
        documentPath,
        language: 'tsx',
        sourceText,
        useStorybookPreview: false,
        workspaceRoot: projectRoot,
      });
      const javascript = decodeBundleJavascript(bundle);

      expect(javascript).toContain('PACKAGE_GLOBAL_MARKER');
      expect(javascript).toContain('from exact installed-package fallback');
      expect(bundle.dependencies).toContain(path.join(packageDirectory, 'package.json'));
    } finally {
      await rm(projectRoot, { force: true, recursive: true });
    }
  });
});

/** Creates one nearest-package workspace beneath this repository's installed React packages. */
async function createTemporaryProject(
  prefix: string,
  dependencies: Readonly<Record<string, string>> = {},
): Promise<string> {
  const projectRoot = await mkdtemp(path.join(PROJECT_ROOT, `test/fixtures/${prefix}`));
  await writeFile(
    path.join(projectRoot, 'package.json'),
    JSON.stringify({ dependencies, private: true }),
    'utf8',
  );
  return projectRoot;
}

/** Decodes the entry and lazy chunks because injected modules can live in split output files. */
function decodeBundleJavascript(bundle: PreviewBundle): string {
  const decoder = new TextDecoder();
  return [bundle.javascript, ...bundle.chunks.map((chunk) => chunk.contents)]
    .map((contents) => decoder.decode(contents))
    .join('\n');
}
