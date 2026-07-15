/**
 * Exercises the real runtime compiler against project React, TSX, CSS, and unsaved source text.
 * These tests ensure the no-server build path works before a VS Code extension host is involved.
 */
import { mkdir, mkdtemp, readFile, rm, symlink, truncate, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { EsbuildPreviewCompiler } from '../../../src/adapters/esbuild/esbuildPreviewCompiler';
import { PreviewCompilationError } from '../../../src/domain/preview';
import { canonicalizeExistingPath } from '../../../src/shared/pathIdentity';

const FIXTURE_PATH = fileURLToPath(new URL('../../fixtures/SamplePreview.tsx', import.meta.url));
const PROJECT_ROOT = fileURLToPath(new URL('../../../', import.meta.url));
const SAVED_SOURCE = await readFile(FIXTURE_PATH, 'utf8');

describe('EsbuildPreviewCompiler', () => {
  /** Bundles a default React export and emits imported CSS without writing into the project. */
  it('creates browser JavaScript and stylesheet artifacts', async () => {
    const compiler = new EsbuildPreviewCompiler();

    const bundle = await compiler.compile({
      dependencySnapshots: [],
      documentPath: FIXTURE_PATH,
      language: 'tsx',
      sourceText: SAVED_SOURCE,
      workspaceRoot: PROJECT_ROOT,
    });

    expect(bundle.javascript.byteLength).toBeGreaterThan(0);
    expect(bundle.stylesheet).toBeDefined();
    const stylesheet = new TextDecoder().decode(bundle.stylesheet);
    expect(stylesheet).toContain('.sample-card');
    expect(stylesheet).toMatch(/\.samplePreview_title|\.title/u);
    expect(bundle.dependencies).toContain(FIXTURE_PATH);
    expect(
      bundle.dependencies.filter((dependency) => dependency.includes('react-preview-entry')),
    ).toEqual([]);
  });

  /** Gives the active editor snapshot precedence over the fixture's saved filesystem contents. */
  it('uses unsaved current-document text', async () => {
    const compiler = new EsbuildPreviewCompiler();
    const unsavedSource = SAVED_SOURCE.replace('Saved fixture source', 'Unsaved editor snapshot');

    const bundle = await compiler.compile({
      dependencySnapshots: [],
      documentPath: FIXTURE_PATH,
      language: 'tsx',
      sourceText: unsavedSource,
      workspaceRoot: PROJECT_ROOT,
    });
    const javascript = new TextDecoder().decode(bundle.javascript);

    expect(javascript).toContain('Unsaved editor snapshot');
    expect(javascript).not.toContain('Saved fixture source');
  });

  /**
   * Resolves an extensionless circular import back to the same in-memory editor module.
   * Without alias unification, esbuild can bundle a second copy from the saved filesystem file.
   */
  it('does not duplicate saved source through an extensionless circular import', async () => {
    const temporaryDirectory = await mkdtemp(
      path.join(PROJECT_ROOT, 'test/fixtures/circular-preview-'),
    );
    const documentPath = path.join(temporaryDirectory, 'CyclePreview.tsx');
    const helperPath = path.join(temporaryDirectory, 'cycleHelper.ts');
    const savedSource = [
      "import { readEditorValue } from './cycleHelper';",
      "export const editorValue = 'Saved circular module';",
      'export default function CyclePreview() {',
      '  return <p>{readEditorValue()}</p>;',
      '}',
    ].join('\n');
    const helperSource = [
      "import { editorValue } from './CyclePreview';",
      'export function readEditorValue(): string {',
      '  return editorValue;',
      '}',
    ].join('\n');
    const unsavedSource = savedSource.replace('Saved circular module', 'Unsaved circular module');

    try {
      await Promise.all([
        writeFile(documentPath, savedSource, 'utf8'),
        writeFile(helperPath, helperSource, 'utf8'),
      ]);
      const compiler = new EsbuildPreviewCompiler();
      const bundle = await compiler.compile({
        dependencySnapshots: [],
        documentPath,
        language: 'tsx',
        sourceText: unsavedSource,
        workspaceRoot: PROJECT_ROOT,
      });
      const javascript = new TextDecoder().decode(bundle.javascript);

      expect(javascript).toContain('Unsaved circular module');
      expect(javascript).not.toContain('Saved circular module');
      expect(bundle.dependencies).toContain(documentPath);
      expect(bundle.dependencies).toContain(helperPath);
    } finally {
      await rm(temporaryDirectory, { force: true, recursive: true });
    }
  });

  /**
   * Follows a realistic render graph through aliases, a JSX-bearing `.js` component, CSS, raw
   * text, URL assets, and both common SVG component conventions without framework plugins.
   */
  it('bundles reachable reference components and render assets', async () => {
    const temporaryDirectory = await mkdtemp(
      path.join(PROJECT_ROOT, 'test/fixtures/smart-preview-'),
    );
    const sourceDirectory = path.join(temporaryDirectory, 'src');
    const componentDirectory = path.join(sourceDirectory, 'components');
    const assetDirectory = path.join(sourceDirectory, 'assets');
    const documentPath = path.join(sourceDirectory, 'Preview.tsx');
    const childPath = path.join(componentDirectory, 'Child.js');
    const stylesheetPath = path.join(sourceDirectory, 'preview.css');
    const svgPath = path.join(assetDirectory, 'preview.svg');
    const iconPath = path.join(assetDirectory, 'favicon.ICO');
    const rawTextPath = path.join(assetDirectory, 'message.txt');
    const tsconfigPath = path.join(temporaryDirectory, 'tsconfig.app.json');

    try {
      await Promise.all([
        mkdir(componentDirectory, { recursive: true }),
        mkdir(assetDirectory, { recursive: true }),
      ]);
      await Promise.all([
        writeFile(
          tsconfigPath,
          JSON.stringify({
            compilerOptions: {
              baseUrl: '.',
              jsx: 'react-jsx',
              paths: { '@/*': ['src/*'] },
            },
          }),
          'utf8',
        ),
        writeFile(
          documentPath,
          [
            "import Child from '@/components/Child';",
            "import iconUrl, { ReactComponent as NamedIcon } from '@/assets/preview.svg#preview-shape-js';",
            "import DefaultIcon from '@/assets/preview.svg?react';",
            "import rawMessage from '@/assets/message.txt?raw';",
            "import faviconUrl from '@/assets/favicon.ICO?url';",
            "import './preview.css';",
            'export default function Preview() {',
            '  return (',
            '    <main data-favicon={faviconUrl}>',
            '      <Child />',
            '      <img src={iconUrl} alt="URL icon" />',
            '      <NamedIcon alt="Named icon" />',
            '      <DefaultIcon alt="Default icon" />',
            '      <p>{rawMessage}</p>',
            '    </main>',
            '  );',
            '}',
          ].join('\n'),
          'utf8',
        ),
        writeFile(
          childPath,
          'export default function Child() { return <strong>Imported JS child</strong>; }',
          'utf8',
        ),
        writeFile(
          stylesheetPath,
          ".preview { background-image: url('./assets/preview.svg#preview-shape'); }",
          'utf8',
        ),
        writeFile(
          svgPath,
          '<svg xmlns="http://www.w3.org/2000/svg"><circle cx="5" cy="5" r="5" /></svg>',
          'utf8',
        ),
        writeFile(iconPath, new Uint8Array([0, 0, 1, 0])),
        writeFile(rawTextPath, 'Imported raw asset text', 'utf8'),
      ]);

      const sourceText = await readFile(documentPath, 'utf8');
      const compiler = new EsbuildPreviewCompiler();
      const bundle = await compiler.compile({
        dependencySnapshots: [],
        documentPath,
        language: 'tsx',
        sourceText,
        tsconfigPath,
        workspaceRoot: temporaryDirectory,
      });
      const javascript = new TextDecoder().decode(bundle.javascript);
      const stylesheet = new TextDecoder().decode(bundle.stylesheet);

      expect(javascript).toContain('Imported JS child');
      expect(javascript).toContain('Imported raw asset text');
      expect(javascript).toContain('data:image/svg+xml;base64,');
      expect(javascript).toContain('#preview-shape-js');
      expect(stylesheet).toContain('data:image/svg+xml');
      expect(bundle.dependencies).toEqual(
        expect.arrayContaining([
          childPath,
          documentPath,
          iconPath,
          rawTextPath,
          stylesheetPath,
          svgPath,
        ]),
      );
      expect(bundle.dependencies.some((dependency) => /[?#]/u.test(dependency))).toBe(false);
    } finally {
      await rm(temporaryDirectory, { force: true, recursive: true });
    }
  });

  /** Uses a dirty imported component snapshot without bundling its older saved filesystem text. */
  it('overlays unsaved reachable dependency documents', async () => {
    const temporaryDirectory = await mkdtemp(
      path.join(PROJECT_ROOT, 'test/fixtures/dirty-dependency-preview-'),
    );
    const documentPath = path.join(temporaryDirectory, 'Preview.tsx');
    const childPath = path.join(temporaryDirectory, 'Child.tsx');
    const unrelatedPath = path.join(temporaryDirectory, 'Unrelated.tsx');
    const sourceText = [
      "import Child from './Child';",
      'export default function Preview() { return <Child />; }',
    ].join('\n');
    const savedChild = 'export default function Child() { return <p>Saved dependency source</p>; }';
    const unsavedChild = savedChild.replace(
      'Saved dependency source',
      'Unsaved dependency snapshot',
    );

    try {
      await Promise.all([
        writeFile(documentPath, sourceText, 'utf8'),
        writeFile(childPath, savedChild, 'utf8'),
        writeFile(unrelatedPath, 'export default function Unrelated() { return null; }', 'utf8'),
      ]);
      const compiler = new EsbuildPreviewCompiler();
      const bundle = await compiler.compile({
        dependencySnapshots: [
          {
            documentPath: childPath,
            language: 'tsx',
            sourceText: unsavedChild,
          },
          {
            documentPath: unrelatedPath,
            language: 'tsx',
            sourceText:
              'export default function Unrelated() { return <p>UNREACHABLE_DIRTY_SOURCE</p>; }',
          },
        ],
        documentPath,
        language: 'tsx',
        sourceText,
        workspaceRoot: PROJECT_ROOT,
      });
      const javascript = new TextDecoder().decode(bundle.javascript);

      expect(javascript).toContain('Unsaved dependency snapshot');
      expect(javascript).not.toContain('Saved dependency source');
      expect(javascript).not.toContain('UNREACHABLE_DIRTY_SOURCE');
      expect(bundle.dependencies).toContain(childPath);
      expect(bundle.dependencies).not.toContain(unrelatedPath);
    } finally {
      await rm(temporaryDirectory, { force: true, recursive: true });
    }
  });

  /**
   * Keeps default-render dependencies and side effects while pruning an unused named-export graph.
   */
  it('tree-shakes target exports that cannot affect default rendering', async () => {
    const temporaryDirectory = await mkdtemp(
      path.join(PROJECT_ROOT, 'test/fixtures/minimal-graph-preview-'),
    );
    const documentPath = path.join(temporaryDirectory, 'Preview.tsx');
    const usedPath = path.join(temporaryDirectory, 'used.ts');
    const unusedPath = path.join(temporaryDirectory, 'unused.ts');
    const sideEffectPath = path.join(temporaryDirectory, 'sideEffect.ts');
    const sourceText = [
      "import './sideEffect';",
      "import { renderedText } from './used';",
      "export { unusedMarker } from './unused';",
      'export default function Preview() { return <p>{renderedText}</p>; }',
    ].join('\n');

    try {
      await Promise.all([
        writeFile(documentPath, sourceText, 'utf8'),
        writeFile(usedPath, "export const renderedText = 'RENDER_GRAPH_REQUIRED';", 'utf8'),
        writeFile(unusedPath, "export const unusedMarker = 'UNUSED_PRIVATE_GRAPH';", 'utf8'),
        writeFile(
          sideEffectPath,
          "globalThis.__previewSideEffect = 'SIDE_EFFECT_RETAINED';",
          'utf8',
        ),
      ]);
      const compiler = new EsbuildPreviewCompiler();
      const bundle = await compiler.compile({
        dependencySnapshots: [],
        documentPath,
        language: 'tsx',
        sourceText,
        workspaceRoot: PROJECT_ROOT,
      });
      const javascript = new TextDecoder().decode(bundle.javascript);

      expect(javascript).toContain('RENDER_GRAPH_REQUIRED');
      expect(javascript).toContain('SIDE_EFFECT_RETAINED');
      expect(javascript).not.toContain('UNUSED_PRIVATE_GRAPH');
    } finally {
      await rm(temporaryDirectory, { force: true, recursive: true });
    }
  });

  /** Converts syntax failures into domain errors with real paths instead of plugin namespaces. */
  it('reports invalid editor source as a PreviewCompilationError', async () => {
    const compiler = new EsbuildPreviewCompiler();

    try {
      await compiler.compile({
        dependencySnapshots: [],
        documentPath: FIXTURE_PATH,
        language: 'tsx',
        sourceText: 'export default function Broken( {',
        workspaceRoot: PROJECT_ROOT,
      });
      throw new Error('Expected invalid preview source to fail compilation.');
    } catch (error) {
      expect(error).toBeInstanceOf(PreviewCompilationError);
      if (!(error instanceof PreviewCompilationError)) {
        return;
      }

      expect(error.diagnostics[0]?.location?.file).toBe(FIXTURE_PATH);
      expect(JSON.stringify(error.diagnostics)).not.toContain('react-preview-snapshot:');
    }
  });

  /** Restores the target path when the default-only bridge reports a missing default export. */
  it('hides target bridge namespaces in missing-export diagnostics', async () => {
    const compiler = new EsbuildPreviewCompiler();

    try {
      await compiler.compile({
        dependencySnapshots: [],
        documentPath: FIXTURE_PATH,
        language: 'tsx',
        sourceText: 'export const namedOnly = 1;',
        workspaceRoot: PROJECT_ROOT,
      });
      throw new Error('Expected a preview without a default export to fail compilation.');
    } catch (error) {
      expect(error).toBeInstanceOf(PreviewCompilationError);
      if (!(error instanceof PreviewCompilationError)) {
        return;
      }

      expect(error.diagnostics[0]?.location?.file).toBe(FIXTURE_PATH);
      expect(JSON.stringify(error.diagnostics)).not.toContain('react-preview-target-bridge:');
    }
  });

  /** Rejects one oversized inline asset before reading and base64-encoding it into the bundle. */
  it('enforces the per-file inline asset budget', async () => {
    const temporaryDirectory = await mkdtemp(
      path.join(PROJECT_ROOT, 'test/fixtures/large-asset-preview-'),
    );
    const documentPath = path.join(temporaryDirectory, 'Preview.tsx');
    const assetPath = path.join(temporaryDirectory, 'large.png');
    const sourceText = [
      "import imageUrl from './large.png';",
      'export default function Preview() { return <img src={imageUrl} />; }',
    ].join('\n');

    try {
      await writeFile(documentPath, sourceText, 'utf8');
      await writeFile(assetPath, '');
      await truncate(assetPath, 5 * 1024 * 1024 + 1);
      const compiler = new EsbuildPreviewCompiler();

      await expect(
        compiler.compile({
          dependencySnapshots: [],
          documentPath,
          language: 'tsx',
          sourceText,
          workspaceRoot: PROJECT_ROOT,
        }),
      ).rejects.toThrow('5 MiB per-file safety limit');
    } finally {
      await rm(temporaryDirectory, { force: true, recursive: true });
    }
  });

  /** Enforces the aggregate budget even when esbuild resolves several assets concurrently. */
  it('enforces the aggregate inline asset budget across parallel resolutions', async () => {
    const temporaryDirectory = await mkdtemp(
      path.join(PROJECT_ROOT, 'test/fixtures/aggregate-asset-preview-'),
    );
    const documentPath = path.join(temporaryDirectory, 'Preview.tsx');
    const assetPaths = Array.from({ length: 5 }, (_, index) =>
      path.join(temporaryDirectory, `asset-${index.toString()}.png`),
    );
    const sourceText = [
      ...assetPaths.map(
        (_, index) => `import image${index.toString()} from './asset-${index.toString()}.png';`,
      ),
      `export default function Preview() { return <main>${assetPaths
        .map((_, index) => `<img src={image${index.toString()}} />`)
        .join('')}</main>; }`,
    ].join('\n');

    try {
      await writeFile(documentPath, sourceText, 'utf8');
      await Promise.all(assetPaths.map(async (assetPath) => writeFile(assetPath, '')));
      await Promise.all(assetPaths.map(async (assetPath) => truncate(assetPath, 5 * 1024 * 1024)));
      const compiler = new EsbuildPreviewCompiler();

      await expect(
        compiler.compile({
          dependencySnapshots: [],
          documentPath,
          language: 'tsx',
          sourceText,
          workspaceRoot: PROJECT_ROOT,
        }),
      ).rejects.toThrow('20 MiB aggregate safety limit');
    } finally {
      await rm(temporaryDirectory, { force: true, recursive: true });
    }
  });

  /**
   * Preserves the editor's symlink identity so esbuild cannot bypass an unsaved source overlay.
   */
  it.runIf(process.platform !== 'win32')(
    'uses unsaved source when the active document path is a symlink',
    async () => {
      const temporaryDirectory = await mkdtemp(
        path.join(PROJECT_ROOT, 'test/fixtures/symlink-preview-'),
      );
      const realDocumentPath = path.join(temporaryDirectory, 'RealPreview.tsx');
      const linkedDocumentPath = path.join(temporaryDirectory, 'LinkedPreview.tsx');
      const savedSource =
        'export default function SymlinkPreview() { return <p>Saved symlink source</p>; }';
      const unsavedSource = savedSource.replace('Saved symlink source', 'Unsaved symlink source');

      try {
        await writeFile(realDocumentPath, savedSource, 'utf8');
        await symlink(realDocumentPath, linkedDocumentPath, 'file');
        const compiler = new EsbuildPreviewCompiler();
        const bundle = await compiler.compile({
          dependencySnapshots: [],
          documentPath: linkedDocumentPath,
          language: 'tsx',
          sourceText: unsavedSource,
          workspaceRoot: PROJECT_ROOT,
        });
        const javascript = new TextDecoder().decode(bundle.javascript);

        expect(javascript).toContain('Unsaved symlink source');
        expect(javascript).not.toContain('Saved symlink source');
        expect(bundle.dependencies).toContain(linkedDocumentPath);
        expect(canonicalizeExistingPath(linkedDocumentPath)).toBe(
          canonicalizeExistingPath(realDocumentPath),
        );
      } finally {
        await rm(temporaryDirectory, { force: true, recursive: true });
      }
    },
  );
});
