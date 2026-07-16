/**
 * Exercises the real runtime compiler against project React, TSX, CSS, and unsaved source text.
 * These tests ensure the no-server build path works before a VS Code extension host is involved.
 */
import { mkdir, mkdtemp, readFile, rm, symlink, truncate, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { EsbuildPreviewCompiler } from '../../../src/adapters/esbuild/esbuildPreviewCompiler';
import { PreviewCompilationError, type PreviewBundle } from '../../../src/domain/preview';
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
    expect(bundle.chunks.length).toBeGreaterThan(0);
    expect(new TextDecoder().decode(bundle.javascript)).toContain('./chunks/');
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
    const javascript = decodeBundleJavascript(bundle);

    expect(javascript).toContain('Unsaved editor snapshot');
    expect(javascript).not.toContain('Saved fixture source');
  });

  /** Applies project-source transforms to uppercase extensions accepted by the domain policy. */
  it('bundles a target with an uppercase TSX extension', async () => {
    const temporaryDirectory = await mkdtemp(
      path.join(PROJECT_ROOT, 'test/fixtures/uppercase-source-preview-'),
    );
    const documentPath = path.join(temporaryDirectory, 'Preview.TSX');
    const sourceText = 'export default function Preview() { return <p>Uppercase TSX source</p>; }';

    try {
      await writeFile(documentPath, sourceText, 'utf8');
      const bundle = await new EsbuildPreviewCompiler().compile({
        dependencySnapshots: [],
        documentPath,
        language: 'tsx',
        sourceText,
        workspaceRoot: PROJECT_ROOT,
      });

      expect(decodeBundleJavascript(bundle)).toContain('Uppercase TSX source');
    } finally {
      await rm(temporaryDirectory, { force: true, recursive: true });
    }
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
      const javascript = decodeBundleJavascript(bundle);

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
      const javascript = decodeBundleJavascript(bundle);
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
      const javascript = decodeBundleJavascript(bundle);

      expect(javascript).toContain('Unsaved dependency snapshot');
      expect(javascript).not.toContain('Saved dependency source');
      expect(javascript).not.toContain('UNREACHABLE_DIRTY_SOURCE');
      expect(bundle.dependencies).toContain(childPath);
      expect(bundle.dependencies).not.toContain(unrelatedPath);
    } finally {
      await rm(temporaryDirectory, { force: true, recursive: true });
    }
  });

  /** Enables a project-owned MemoryRouter when only a reached child imports a router hook. */
  it('adapts to a child-only React Router requirement from the bundled graph', async () => {
    const temporaryDirectory = await mkdtemp(
      path.join(PROJECT_ROOT, 'test/fixtures/child-router-preview-'),
    );
    const sourceDirectory = path.join(temporaryDirectory, 'src');
    const documentPath = path.join(sourceDirectory, 'Preview.tsx');
    const childPath = path.join(sourceDirectory, 'Child.tsx');
    const sourceText = [
      "import Child from './Child';",
      'export default function Preview() { return <Child />; }',
    ].join('\n');

    try {
      await mkdir(sourceDirectory, { recursive: true });
      await installCompilerFakeRouterPackage(temporaryDirectory);
      await Promise.all([
        writeFile(documentPath, sourceText, 'utf8'),
        writeFile(
          childPath,
          [
            "import { useLocation } from 'react-router-dom';",
            'export default function Child() { return <p>{useLocation().pathname}</p>; }',
          ].join('\n'),
          'utf8',
        ),
      ]);

      const bundle = await new EsbuildPreviewCompiler().compile({
        dependencySnapshots: [],
        documentPath,
        language: 'tsx',
        sourceText,
        workspaceRoot: temporaryDirectory,
      });
      const javascript = decodeBundleJavascript(bundle);

      expect(javascript).toContain('AUTOMATIC_ROUTER_BOUNDARY_ENABLED = true');
      expect(javascript).toContain('active: graph-required MemoryRouter');
      expect(javascript).not.toContain(
        'not requested: no unowned target-reachable React Router consumer was detected',
      );
      expect(bundle.dependencies).toContain(childPath);
    } finally {
      await rm(temporaryDirectory, { force: true, recursive: true });
    }
  });

  /** Uses graph provider evidence instead of setup presence when avoiding an outer router. */
  it('keeps a setup-owned router without adding a second automatic boundary', async () => {
    const temporaryDirectory = await mkdtemp(
      path.join(PROJECT_ROOT, 'test/fixtures/setup-router-preview-'),
    );
    const sourceDirectory = path.join(temporaryDirectory, 'src');
    const setupDirectory = path.join(temporaryDirectory, '.react-preview');
    const documentPath = path.join(sourceDirectory, 'Preview.tsx');
    const childPath = path.join(sourceDirectory, 'Child.tsx');
    const setupPath = path.join(setupDirectory, 'setup.tsx');
    const sourceText = [
      "import Child from './Child';",
      'export default function Preview() { return <Child />; }',
    ].join('\n');

    try {
      await Promise.all([
        mkdir(sourceDirectory, { recursive: true }),
        mkdir(setupDirectory, { recursive: true }),
      ]);
      await installCompilerFakeRouterPackage(temporaryDirectory);
      await Promise.all([
        writeFile(documentPath, sourceText, 'utf8'),
        writeFile(
          childPath,
          "import { useLocation } from 'react-router-dom'; export default function Child() { return <p>{useLocation().pathname}</p>; }",
          'utf8',
        ),
        writeFile(
          setupPath,
          [
            "import { BrowserRouter } from 'react-router-dom';",
            'export function PreviewProviders({ children }) {',
            '  return <BrowserRouter>{children}</BrowserRouter>;',
            '}',
          ].join('\n'),
          'utf8',
        ),
      ]);

      const bundle = await new EsbuildPreviewCompiler().compile({
        dependencySnapshots: [],
        documentPath,
        language: 'tsx',
        sourceText,
        workspaceRoot: temporaryDirectory,
      });
      const javascript = decodeBundleJavascript(bundle);

      expect(javascript).toContain(
        'not applied: an existing target-reachable Router provider was detected',
      );
      expect(javascript).toContain('AUTOMATIC_ROUTER_BOUNDARY_ENABLED = false');
      expect(bundle.dependencies).toContain(setupPath);
    } finally {
      await rm(temporaryDirectory, { force: true, recursive: true });
    }
  });

  /** Keeps component dependencies and side effects while pruning lowercase helper exports. */
  it('tree-shakes exports that cannot become gallery components', async () => {
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
      const javascript = decodeBundleJavascript(bundle);

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

  /** Produces a valid empty gallery when a module has no component-shaped direct exports. */
  it('bundles files without default or PascalCase component exports', async () => {
    const compiler = new EsbuildPreviewCompiler();
    const bundle = await compiler.compile({
      dependencySnapshots: [],
      documentPath: FIXTURE_PATH,
      language: 'tsx',
      sourceText: 'export const namedOnly = 1;',
      workspaceRoot: PROJECT_ROOT,
    });
    const javascript = decodeBundleJavascript(bundle);

    expect(javascript).toContain(
      'This file has no direct default or PascalCase component exports to preview.',
    );
  });

  /**
   * Expands common Vite/Webpack resource syntax into a finite graph while retaining dirty matches.
   */
  it('discovers bounded framework resource macros and dynamic assets', async () => {
    const temporaryDirectory = await mkdtemp(
      path.join(PROJECT_ROOT, 'test/fixtures/static-resource-preview-'),
    );
    const pagesDirectory = path.join(temporaryDirectory, 'pages');
    const assetsDirectory = path.join(temporaryDirectory, 'assets');
    const publicDirectory = path.join(temporaryDirectory, 'public');
    const documentPath = path.join(temporaryDirectory, 'Preview.tsx');
    const pageAPath = path.join(pagesDirectory, 'PageA.tsx');
    const pageBPath = path.join(pagesDirectory, 'PageB.tsx');
    const excludedPagePath = path.join(pagesDirectory, 'Excluded.test.tsx');
    const imagePath = path.join(assetsDirectory, 'logo.png');
    const modelPath = path.join(assetsDirectory, 'scene.glb');
    const publicImagePath = path.join(publicDirectory, 'public-logo.png');
    const publicStylesheetPath = path.join(publicDirectory, 'public-base.css');
    const stylesheetPath = path.join(temporaryDirectory, 'preview.css');
    const sourceText = [
      "import './preview.css';",
      "const lazyPages = import.meta.glob(['./pages/*.tsx', '!./pages/*.test.tsx'], { import: 'default' });",
      "const eagerPages = import.meta.glob('./pages/*.tsx', { eager: true, import: 'default' });",
      "const pageContext = require.context('./pages', false, /Page[A-Z]\\.tsx$/);",
      "const pageName = 'PageA';",
      "const imageName = 'logo';",
      'const loadPage = () => import(`./pages/${pageName}.tsx`);',
      'const loadImage = () => import(`./assets/${imageName}.png?url`);',
      "import modelUrl from './assets/scene.glb?url';",
      "import markedImageUrl from './assets/logo.png?url#asset-fragment';",
      "const imageUrl = new URL('./assets/logo.png', import.meta.url).href;",
      "const bareImageUrl = new URL('assets/logo.png?cache=1#preview', import.meta.url).href;",
      "const publicUrl = new URL('/public-logo.png', import.meta.url).href;",
      "const environment = import.meta.env.DEV ? import.meta.env.MODE : 'production';",
      'export default function Preview() {',
      '  return <main data-env={environment} data-model={modelUrl} data-marked={markedImageUrl} data-image={imageUrl} data-bare-image={bareImageUrl} data-public={publicUrl} data-context={pageContext.keys().length} data-lazy={Object.keys(lazyPages).length} data-eager={Object.keys(eagerPages).length} onClick={() => { void loadPage(); void loadImage(); }} />;',
      '}',
    ].join('\n');

    try {
      await Promise.all([
        mkdir(pagesDirectory, { recursive: true }),
        mkdir(assetsDirectory, { recursive: true }),
        mkdir(publicDirectory, { recursive: true }),
      ]);
      await Promise.all([
        writeFile(path.join(temporaryDirectory, 'package.json'), '{"private":true}', 'utf8'),
        writeFile(documentPath, sourceText, 'utf8'),
        writeFile(
          pageAPath,
          'export default function PageA() { return <p>Saved glob Page A</p>; }',
          'utf8',
        ),
        writeFile(
          pageBPath,
          'export default function PageB() { return <p>Static glob Page B</p>; }',
          'utf8',
        ),
        writeFile(
          excludedPagePath,
          'export default function Excluded() { return <p>Excluded eager marker</p>; }',
          'utf8',
        ),
        writeFile(imagePath, new Uint8Array([1, 2, 3, 4])),
        writeFile(modelPath, new Uint8Array([5, 6, 7, 8])),
        writeFile(publicImagePath, new Uint8Array([9, 10, 11, 12])),
        writeFile(publicStylesheetPath, '.public-base-marker { color: rgb(1 2 3); }', 'utf8'),
        writeFile(
          stylesheetPath,
          "@import '/public-base.css';\n.preview { background: url('/public-logo.png'); }",
          'utf8',
        ),
      ]);

      const compiler = new EsbuildPreviewCompiler();
      const bundle = await compiler.compile({
        dependencySnapshots: [
          {
            documentPath: pageAPath,
            language: 'tsx',
            sourceText: 'export default function PageA() { return <p>Dirty glob Page A</p>; }',
          },
        ],
        documentPath,
        language: 'tsx',
        sourceText,
        workspaceRoot: temporaryDirectory,
      });
      const javascript = decodeBundleJavascript(bundle);
      const stylesheet = new TextDecoder().decode(bundle.stylesheet);

      expect(javascript).toContain('Dirty glob Page A');
      expect(javascript).not.toContain('Saved glob Page A');
      expect(javascript).toContain('Static glob Page B');
      expect(javascript).toContain('development');
      expect(javascript).not.toContain('import.meta.glob');
      expect(javascript).not.toMatch(/\brequire\.context\s*\(/u);
      expect(javascript).toContain('data:application/octet-stream');
      expect(javascript).toContain('#preview');
      expect(javascript).toContain('#asset-fragment');
      expect(javascript).not.toContain('?url#asset-fragment');
      expect(stylesheet).toContain('data:image/png');
      expect(stylesheet).toContain('.public-base-marker');
      expect(bundle.dependencies).toEqual(
        expect.arrayContaining([
          documentPath,
          imagePath,
          modelPath,
          pageAPath,
          pageBPath,
          publicImagePath,
          publicStylesheetPath,
          stylesheetPath,
        ]),
      );
      expect(bundle.watchDirectories).toEqual(
        expect.arrayContaining([assetsDirectory, pagesDirectory]),
      );
    } finally {
      await rm(temporaryDirectory, { force: true, recursive: true });
    }
  });

  /** Applies the same bounded AST discovery to MJS and CommonJS files reached through a package. */
  it('bundles finite dynamic resources from project modules and dependencies', async () => {
    const workspaceRoot = await mkdtemp(
      path.join(PROJECT_ROOT, 'test/fixtures/module-dialects-preview-'),
    );
    const packageRoot = path.join(workspaceRoot, 'node_modules', 'bounded-dependency');
    const localeDirectory = path.join(packageRoot, 'locale');
    const chunksDirectory = path.join(workspaceRoot, 'chunks');
    const documentPath = path.join(workspaceRoot, 'Preview.tsx');
    const loaderPath = path.join(workspaceRoot, 'loader.mjs');
    const chunkPath = path.join(chunksDirectory, 'feature.mjs');
    const localePath = path.join(localeDirectory, 'en.cjs');
    const packageEntryPath = path.join(packageRoot, 'index.cjs');
    const sourceText = [
      "import locale from 'bounded-dependency';",
      "import { loadChunk } from './loader.mjs';",
      'export default function Preview() {',
      '  return <button data-locale={locale} onClick={() => void loadChunk("feature")}>Modules</button>;',
      '}',
    ].join('\n');

    try {
      await Promise.all([
        mkdir(localeDirectory, { recursive: true }),
        mkdir(chunksDirectory, { recursive: true }),
      ]);
      await Promise.all([
        writeFile(documentPath, sourceText, 'utf8'),
        writeFile(
          loaderPath,
          "export const loadChunk = (name) => import('./chunks/' + name + '.mjs');",
          'utf8',
        ),
        writeFile(chunkPath, "export default 'MJS_DYNAMIC_RESOURCE';", 'utf8'),
        writeFile(
          path.join(packageRoot, 'package.json'),
          '{"name":"bounded-dependency","main":"index.cjs"}',
          'utf8',
        ),
        writeFile(
          packageEntryPath,
          "const language = 'en'; module.exports = module.require('./locale/' + language + '.cjs');",
          'utf8',
        ),
        writeFile(localePath, "module.exports = 'CJS_DYNAMIC_RESOURCE';", 'utf8'),
      ]);

      const bundle = await new EsbuildPreviewCompiler().compile({
        dependencySnapshots: [],
        documentPath,
        language: 'tsx',
        sourceText,
        workspaceRoot,
      });
      const javascript = decodeBundleJavascript(bundle);

      expect(javascript).toContain('MJS_DYNAMIC_RESOURCE');
      expect(javascript).toContain('CJS_DYNAMIC_RESOURCE');
      expect(bundle.dependencies).toEqual(
        expect.arrayContaining([chunkPath, loaderPath, localePath, packageEntryPath]),
      );
    } finally {
      await rm(workspaceRoot, { force: true, recursive: true });
    }
  });

  /** Rejects a public new-URL path before it can escape the workspace public directory. */
  it('rejects public asset traversal during static URL transformation', async () => {
    const temporaryDirectory = await mkdtemp(
      path.join(PROJECT_ROOT, 'test/fixtures/public-traversal-preview-'),
    );
    const documentPath = path.join(temporaryDirectory, 'Preview.tsx');
    const sourceText = [
      "const secretUrl = new URL('/../secret.txt', import.meta.url).href;",
      'export default function Preview() { return <span>{secretUrl}</span>; }',
    ].join('\n');

    try {
      await writeFile(documentPath, sourceText, 'utf8');
      const compiler = new EsbuildPreviewCompiler();

      await expect(
        compiler.compile({
          dependencySnapshots: [],
          documentPath,
          language: 'tsx',
          sourceText,
          workspaceRoot: temporaryDirectory,
        }),
      ).rejects.toThrow('must stay inside');
    } finally {
      await rm(temporaryDirectory, { force: true, recursive: true });
    }
  });

  /** Uses the nearest package boundary for a nested monorepo app's conventional public directory. */
  it('resolves public assets from the nearest package in a monorepo workspace', async () => {
    const workspaceRoot = await mkdtemp(
      path.join(PROJECT_ROOT, 'test/fixtures/monorepo-public-preview-'),
    );
    const projectRoot = path.join(workspaceRoot, 'apps', 'web');
    const sourceDirectory = path.join(projectRoot, 'src');
    const publicDirectory = path.join(projectRoot, 'public');
    const documentPath = path.join(sourceDirectory, 'Preview.tsx');
    const publicImagePath = path.join(publicDirectory, 'logo.png');
    const sourceText = [
      "const logoUrl = new URL('/logo.png', import.meta.url).href;",
      'export default function Preview() { return <img src={logoUrl} />; }',
    ].join('\n');

    try {
      await Promise.all([
        mkdir(sourceDirectory, { recursive: true }),
        mkdir(publicDirectory, { recursive: true }),
      ]);
      await Promise.all([
        writeFile(path.join(projectRoot, 'package.json'), '{"private":true}', 'utf8'),
        writeFile(documentPath, sourceText, 'utf8'),
        writeFile(publicImagePath, new Uint8Array([1, 2, 3])),
      ]);
      const bundle = await new EsbuildPreviewCompiler().compile({
        dependencySnapshots: [],
        documentPath,
        language: 'tsx',
        sourceText,
        workspaceRoot,
      });

      expect(bundle.dependencies).toContain(publicImagePath);
      expect(decodeBundleJavascript(bundle)).toContain('data:image/png');
    } finally {
      await rm(workspaceRoot, { force: true, recursive: true });
    }
  });

  /** Rejects a workspace-local asset symlink whose canonical target escapes the trusted workspace. */
  it.runIf(process.platform !== 'win32')(
    'rejects asset symlink traversal outside the workspace',
    async () => {
      const workspaceRoot = await mkdtemp(
        path.join(PROJECT_ROOT, 'test/fixtures/asset-boundary-preview-'),
      );
      const outsideRoot = await mkdtemp(
        path.join(PROJECT_ROOT, 'test/fixtures/asset-outside-preview-'),
      );
      const documentPath = path.join(workspaceRoot, 'Preview.tsx');
      const linkedAssetPath = path.join(workspaceRoot, 'secret.txt');
      const outsideAssetPath = path.join(outsideRoot, 'secret.txt');
      const sourceText = [
        "import secret from './secret.txt?raw';",
        'export default function Preview() { return <pre>{secret}</pre>; }',
      ].join('\n');

      try {
        await Promise.all([
          writeFile(documentPath, sourceText, 'utf8'),
          writeFile(outsideAssetPath, 'OUTSIDE_WORKSPACE_SECRET', 'utf8'),
        ]);
        await symlink(outsideAssetPath, linkedAssetPath, 'file');

        await expect(
          new EsbuildPreviewCompiler().compile({
            dependencySnapshots: [],
            documentPath,
            language: 'tsx',
            sourceText,
            workspaceRoot,
          }),
        ).rejects.toThrow('outside its trusted project boundary');
      } finally {
        await Promise.all([
          rm(workspaceRoot, { force: true, recursive: true }),
          rm(outsideRoot, { force: true, recursive: true }),
        ]);
      }
    },
  );

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
      const realDirectory = path.join(temporaryDirectory, 'real');
      const pagesDirectory = path.join(realDirectory, 'pages');
      const realDocumentPath = path.join(realDirectory, 'RealPreview.tsx');
      const linkedDocumentPath = path.join(temporaryDirectory, 'LinkedPreview.tsx');
      const savedSource = [
        "const pages = import.meta.glob('./pages/*.tsx', { eager: true });",
        'export default function SymlinkPreview() {',
        '  return <p data-pages={Object.keys(pages).length}>Saved symlink source</p>;',
        '}',
      ].join('\n');
      const unsavedSource = savedSource.replace('Saved symlink source', 'Unsaved symlink source');

      try {
        await mkdir(pagesDirectory, { recursive: true });
        await Promise.all([
          writeFile(realDocumentPath, savedSource, 'utf8'),
          writeFile(
            path.join(pagesDirectory, 'Page.tsx'),
            'export default function Page() { return <i>Symlink glob page</i>; }',
            'utf8',
          ),
        ]);
        await symlink(realDocumentPath, linkedDocumentPath, 'file');
        const compiler = new EsbuildPreviewCompiler();
        const bundle = await compiler.compile({
          dependencySnapshots: [],
          documentPath: linkedDocumentPath,
          language: 'tsx',
          sourceText: unsavedSource,
          workspaceRoot: PROJECT_ROOT,
        });
        const javascript = decodeBundleJavascript(bundle);

        expect(javascript).toContain('Unsaved symlink source');
        expect(javascript).not.toContain('Saved symlink source');
        expect(javascript).toContain('Symlink glob page');
        expect(bundle.watchDirectories).toContain(pagesDirectory);
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

/** Decodes the entry and every local lazy chunk when assertions inspect the complete render graph. */
function decodeBundleJavascript(bundle: PreviewBundle): string {
  const decoder = new TextDecoder();
  return [bundle.javascript, ...bundle.chunks.map((chunk) => chunk.contents)]
    .map((contents) => decoder.decode(contents))
    .join('\n');
}

/** Installs the smallest project-local React Router surface required by adaptive compiler tests. */
async function installCompilerFakeRouterPackage(projectRoot: string): Promise<void> {
  const packageDirectory = path.join(projectRoot, 'node_modules/react-router-dom');
  await mkdir(packageDirectory, { recursive: true });
  await Promise.all([
    writeFile(
      path.join(packageDirectory, 'package.json'),
      JSON.stringify({ exports: './index.js', name: 'react-router-dom', type: 'module' }),
      'utf8',
    ),
    writeFile(
      path.join(packageDirectory, 'index.js'),
      [
        'export function BrowserRouter({ children }) { return children; }',
        'export function MemoryRouter({ children }) { return children; }',
        "export function useLocation() { return { pathname: '/' }; }",
      ].join('\n'),
      'utf8',
    ),
  ]);
}
