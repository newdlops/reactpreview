/** Verifies bounded generic entry-to-component discovery before full workspace enrichment. */
import { mkdtemp, readFile, rm, writeFile, mkdir } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { collectPreviewInspectorFastPageCorridor } from '../../../../src/adapters/esbuild/inspector/previewInspectorFastPageCorridor';
import { createPreviewInspectorNextAppModulePagePlan } from '../../../../src/adapters/esbuild/inspector/previewInspectorNextAppModulePagePlan';

const temporaryRoots: string[] = [];

/** Removes authored fixture directories after every assertion, including failing assertions. */
afterEach(async () => {
  await Promise.all(
    temporaryRoots.splice(0).map((rootPath) => rm(rootPath, { force: true, recursive: true })),
  );
});

/** Writes one source fixture while retaining normal disk directory discovery semantics. */
async function writeSource(
  rootPath: string,
  relativePath: string,
  sourceText: string,
): Promise<string> {
  const sourcePath = path.join(rootPath, relativePath);
  await mkdir(path.dirname(sourcePath), { recursive: true });
  await writeFile(sourcePath, sourceText, 'utf8');
  return sourcePath;
}

/** Resolves fixture-relative imports exactly enough to model the compiler's project resolver. */
function createFixtureResolver(sourcePaths: readonly string[]) {
  const sourcePathSet = new Set(sourcePaths.map((sourcePath) => path.normalize(sourcePath)));
  return (specifier: string, importerPath: string): string | undefined => {
    if (!specifier.startsWith('.')) return undefined;
    const candidate = path.resolve(path.dirname(importerPath), specifier);
    return [candidate, `${candidate}.tsx`, `${candidate}.ts`, path.join(candidate, 'index.tsx')]
      .map((sourcePath) => path.normalize(sourcePath))
      .find((sourcePath) => sourcePathSet.has(sourcePath));
  };
}

describe('collectPreviewInspectorFastPageCorridor', () => {
  it('meets entry and target searches, then retains page-shell siblings without a package inventory', async () => {
    const projectRoot = await mkdtemp(path.join(os.tmpdir(), 'fast-page-corridor-'));
    temporaryRoots.push(projectRoot);
    const sources = await Promise.all([
      writeSource(
        projectRoot,
        'src/main.tsx',
        [
          "import { createRoot } from 'react-dom/client';",
          "import App from './App';",
          'createRoot(document.body).render(<App />);',
        ].join('\n'),
      ),
      writeSource(
        projectRoot,
        'src/App.tsx',
        [
          "import Layout from './layout/Layout';",
          "import ReportPage from './features/report/ReportPage';",
          'export default function App() { return <Layout><ReportPage /></Layout>; }',
        ].join('\n'),
      ),
      writeSource(
        projectRoot,
        'src/layout/Layout.tsx',
        [
          "import Header from './Header';",
          "import Sidebar from './Sidebar';",
          'export default function Layout({ children }) {',
          '  return <><Header /><Sidebar /><main>{children}</main></>;',
          '}',
        ].join('\n'),
      ),
      writeSource(
        projectRoot,
        'src/layout/Header.tsx',
        'export default function Header() { return <header>Header</header>; }',
      ),
      writeSource(
        projectRoot,
        'src/layout/Sidebar.tsx',
        'export default function Sidebar() { return <nav>Sidebar</nav>; }',
      ),
      writeSource(
        projectRoot,
        'src/features/report/ReportPage.tsx',
        [
          "import TargetCard from './TargetCard';",
          'export default function ReportPage() { return <section><TargetCard /></section>; }',
        ].join('\n'),
      ),
      writeSource(
        projectRoot,
        'src/features/report/TargetCard.tsx',
        'export default function TargetCard() { return <article>Selected</article>; }',
      ),
    ]);
    const targetPath = path.join(projectRoot, 'src/features/report/TargetCard.tsx');

    const corridor = await collectPreviewInspectorFastPageCorridor({
      documentPath: targetPath,
      projectRoot,
      readSource: (sourcePath) => readFile(sourcePath, 'utf8').catch(() => undefined),
      resolveModule: createFixtureResolver(sources),
      workspaceRoot: projectRoot,
    });

    expect(corridor).toBeDefined();
    expect(corridor?.entryConnected).toBe(true);
    expect(corridor?.importPath.map((sourcePath) => path.basename(sourcePath))).toEqual([
      'main.tsx',
      'App.tsx',
      'ReportPage.tsx',
      'TargetCard.tsx',
    ]);
    expect(corridor?.sourcePaths.map((sourcePath) => path.basename(sourcePath))).toEqual(
      expect.arrayContaining(['Layout.tsx', 'Header.tsx', 'Sidebar.tsx']),
    );
  });

  it('returns a page-like reverse owner when no ReactDOM entry can be proven', async () => {
    const projectRoot = await mkdtemp(path.join(os.tmpdir(), 'fast-page-owner-'));
    temporaryRoots.push(projectRoot);
    const sources = await Promise.all([
      writeSource(
        projectRoot,
        'src/pages/SettingsPage.tsx',
        [
          "import PreferenceToggle from '../components/PreferenceToggle';",
          'export default function SettingsPage() { return <PreferenceToggle />; }',
        ].join('\n'),
      ),
      writeSource(
        projectRoot,
        'src/components/PreferenceToggle.tsx',
        'export default function PreferenceToggle() { return <button>Toggle</button>; }',
      ),
    ]);
    const targetPath = path.join(projectRoot, 'src/components/PreferenceToggle.tsx');

    const corridor = await collectPreviewInspectorFastPageCorridor({
      documentPath: targetPath,
      projectRoot,
      readSource: (sourcePath) => readFile(sourcePath, 'utf8').catch(() => undefined),
      resolveModule: createFixtureResolver(sources),
      workspaceRoot: projectRoot,
    });

    expect(corridor?.entryConnected).toBe(false);
    expect(corridor?.importPath.map((sourcePath) => path.basename(sourcePath))).toEqual([
      'SettingsPage.tsx',
      'PreferenceToggle.tsx',
    ]);
  });

  /** Test/story entry lookalikes must never outrank the authored application bootstrap. */
  it('excludes auxiliary app entry filenames from semantic entry seeding', async () => {
    const projectRoot = await mkdtemp(path.join(os.tmpdir(), 'fast-page-entry-'));
    temporaryRoots.push(projectRoot);
    const sources = await Promise.all([
      writeSource(
        projectRoot,
        'src/main.tsx',
        [
          "import { createRoot } from 'react-dom/client';",
          "import App from './App';",
          'createRoot(document.body).render(<App />);',
        ].join('\n'),
      ),
      writeSource(
        projectRoot,
        'src/app.test.tsx',
        [
          "import { createRoot } from 'react-dom/client';",
          "import Target from './Target';",
          'createRoot(document.body).render(<Target />);',
        ].join('\n'),
      ),
      writeSource(
        projectRoot,
        'src/App.tsx',
        "import Target from './Target'; export default function App() { return <Target />; }",
      ),
      writeSource(
        projectRoot,
        'src/Target.tsx',
        'export default function Target() { return <main>Target</main>; }',
      ),
    ]);
    const targetPath = path.join(projectRoot, 'src/Target.tsx');

    const corridor = await collectPreviewInspectorFastPageCorridor({
      documentPath: targetPath,
      projectRoot,
      readSource: (sourcePath) => readFile(sourcePath, 'utf8').catch(() => undefined),
      resolveModule: createFixtureResolver(sources),
      workspaceRoot: projectRoot,
    });

    expect(corridor?.importPath.map((sourcePath) => path.basename(sourcePath))).toEqual([
      'main.tsx',
      'App.tsx',
      'Target.tsx',
    ]);
    expect(corridor?.sourcePaths).not.toContain(path.join(projectRoot, 'src/app.test.tsx'));
  });

  /** Dormant error galleries may be page-like TSX, but are choices rather than page siblings. */
  it('does not expand broad dynamic fallback choices outside the proven corridor', async () => {
    const projectRoot = await mkdtemp(path.join(os.tmpdir(), 'fast-page-lazy-'));
    temporaryRoots.push(projectRoot);
    const lazySources = await Promise.all(
      Array.from({ length: 10 }, (_, index) =>
        writeSource(
          projectRoot,
          `src/fallbacks/Fallback${index.toString()}.tsx`,
          `export default function Fallback${index.toString()}() { return <p>Fallback</p>; }`,
        ),
      ),
    );
    const sources = [
      ...(await Promise.all([
        writeSource(
          projectRoot,
          'src/main.tsx',
          [
            "import { createRoot } from 'react-dom/client';",
            "import App from './App';",
            'createRoot(document.body).render(<App />);',
          ].join('\n'),
        ),
        writeSource(
          projectRoot,
          'src/App.tsx',
          [
            "import Target from './Target';",
            "import './create-fallback';",
            'export default function App() { return <Target />; }',
          ].join('\n'),
        ),
        writeSource(
          projectRoot,
          'src/Target.tsx',
          'export default function Target() { return <main>Target</main>; }',
        ),
        writeSource(
          projectRoot,
          'src/create-fallback.tsx',
          Array.from(
            { length: 10 },
            (_, index) =>
              `export const fallback${index.toString()} = () => import('./fallbacks/Fallback${index.toString()}');`,
          ).join('\n'),
        ),
      ])),
      ...lazySources,
    ];
    const targetPath = path.join(projectRoot, 'src/Target.tsx');

    const corridor = await collectPreviewInspectorFastPageCorridor({
      documentPath: targetPath,
      projectRoot,
      readSource: (sourcePath) => readFile(sourcePath, 'utf8').catch(() => undefined),
      resolveModule: createFixtureResolver(sources),
      workspaceRoot: projectRoot,
    });

    expect(corridor?.sourcePaths).toContain(path.join(projectRoot, 'src/create-fallback.tsx'));
    expect(corridor?.sourcePaths.some((sourcePath) => sourcePath.includes('/fallbacks/'))).toBe(
      false,
    );
  });

  /** First paint starts below a central eager router instead of bundling every route sibling. */
  it('trims a high-fanout React Router registry to the page-local proven path', async () => {
    const projectRoot = await mkdtemp(path.join(os.tmpdir(), 'fast-page-router-'));
    temporaryRoots.push(projectRoot);
    const siblingSources = await Promise.all(
      Array.from({ length: 49 }, (_, index) =>
        writeSource(
          projectRoot,
          `src/pages/Sibling${index.toString()}.tsx`,
          `export default function Sibling${index.toString()}() { return <p>Sibling</p>; }`,
        ),
      ),
    );
    const sources = [
      ...(await Promise.all([
        writeSource(
          projectRoot,
          'src/main.tsx',
          [
            "import { createRoot } from 'react-dom/client';",
            "import App from './App';",
            'createRoot(document.body).render(<App />);',
          ].join('\n'),
        ),
        writeSource(
          projectRoot,
          'src/App.tsx',
          [
            "import { createBrowserRouter, createRoutesFromElements, Route, RouterProvider } from 'react-router-dom';",
            "import SelectedPage from './pages/SelectedPage';",
            ...Array.from(
              { length: 49 },
              (_, index) =>
                `import Sibling${index.toString()} from './pages/Sibling${index.toString()}';`,
            ),
            'const router = createBrowserRouter(createRoutesFromElements(<Route><Route path="selected" element={<SelectedPage />} />',
            ...Array.from(
              { length: 49 },
              (_, index) =>
                `<Route path="sibling-${index.toString()}" element={<Sibling${index.toString()} />} />`,
            ),
            '</Route>));',
            'export default function App() { return <RouterProvider router={router} />; }',
          ].join('\n'),
        ),
        writeSource(
          projectRoot,
          'src/pages/SelectedPage.tsx',
          "import Target from './Target'; export default function SelectedPage() { return <Target />; }",
        ),
        writeSource(
          projectRoot,
          'src/pages/Target.tsx',
          'export default function Target() { return <main>Target</main>; }',
        ),
      ])),
      ...siblingSources,
    ];
    const targetPath = path.join(projectRoot, 'src/pages/Target.tsx');

    const corridor = await collectPreviewInspectorFastPageCorridor({
      documentPath: targetPath,
      projectRoot,
      readSource: (sourcePath) => readFile(sourcePath, 'utf8').catch(() => undefined),
      resolveModule: createFixtureResolver(sources),
      workspaceRoot: projectRoot,
    });

    expect(corridor?.entryConnected).toBe(false);
    expect(corridor?.truncated).toBe(true);
    expect(corridor?.importPath.map((sourcePath) => path.basename(sourcePath))).toEqual([
      'SelectedPage.tsx',
      'Target.tsx',
    ]);
    expect(corridor?.sourcePaths.some((sourcePath) => sourcePath.includes('Sibling'))).toBe(false);
  });

  /**
   * A selected example is auxiliary source, but its exact lazy registry and filesystem route are
   * authored page evidence. Target-affine ordering must find the leaf before resolving hundreds of
   * unrelated registry choices, and implicit layouts must accompany the proven page.
   */
  it('connects one auxiliary lazy leaf to its bounded Next App page and layouts', async () => {
    const projectRoot = await mkdtemp(path.join(os.tmpdir(), 'fast-page-next-example-'));
    temporaryRoots.push(projectRoot);
    const targetPath = await writeSource(
      projectRoot,
      'examples/base/button-demo.tsx',
      'export default function ButtonDemo() { return <button>Example</button>; }',
    );
    const decoyPaths = Array.from({ length: 300 }, (_, index) =>
      path.join(projectRoot, `examples/base/decoy-${index.toString()}.tsx`),
    );
    const registryPath = await writeSource(
      projectRoot,
      'examples/__components__.tsx',
      [
        ...decoyPaths.map(
          (_, index) =>
            `export const decoy${index.toString()} = () => import('./base/decoy-${index.toString()}');`,
        ),
        "export const selected = () => import('./base/button-demo');",
      ].join('\n'),
    );
    const pagePath = await writeSource(
      projectRoot,
      'app/(view)/examples/[base]/[name]/page.tsx',
      [
        "import { selected } from '../../../../../examples/__components__';",
        'export default function Page() { return <main>{String(selected)}</main>; }',
      ].join('\n'),
    );
    const rootLayoutPath = await writeSource(
      projectRoot,
      'app/layout.tsx',
      'export default function RootLayout({ children }) { return <html><body>{children}</body></html>; }',
    );
    const viewLayoutPath = await writeSource(
      projectRoot,
      'app/(view)/layout.tsx',
      'export default function ViewLayout({ children }) { return <section>{children}</section>; }',
    );
    const sourcePaths = [
      targetPath,
      registryPath,
      pagePath,
      rootLayoutPath,
      viewLayoutPath,
      ...decoyPaths,
    ];
    const fixtureResolver = createFixtureResolver(sourcePaths);
    let resolutionCount = 0;

    const corridor = await collectPreviewInspectorFastPageCorridor({
      documentPath: targetPath,
      projectRoot,
      readSource: (sourcePath) => readFile(sourcePath, 'utf8').catch(() => undefined),
      resolveModule: (specifier, importerPath) => {
        resolutionCount += 1;
        return fixtureResolver(specifier, importerPath);
      },
      workspaceRoot: projectRoot,
    });

    expect(corridor?.entryConnected).toBe(false);
    expect(corridor?.importPath).toEqual([pagePath, registryPath, targetPath]);
    expect(corridor?.sourcePaths).toEqual(
      expect.arrayContaining([pagePath, rootLayoutPath, viewLayoutPath]),
    );
    expect(resolutionCount).toBeLessThan(250);

    expect(corridor?.nextAppPagePath).toBe(pagePath);
    const plan =
      corridor === undefined
        ? undefined
        : await createPreviewInspectorNextAppModulePagePlan({
            componentTargetExportName: 'default',
            documentPath: targetPath,
            readSource: (sourcePath) => readFile(sourcePath, 'utf8').catch(() => undefined),
            resolveModule: fixtureResolver,
            sourcePaths: corridor.sourcePaths,
          });
    expect(plan?.pageCandidates.some((candidate) => candidate.root.sourcePath === pagePath)).toBe(
      true,
    );
    const routeLocation = plan?.pageCandidates[0]?.routeLocation;
    expect(routeLocation?.evidenceKind).toBe('next-app-filesystem');
    if (routeLocation?.evidenceKind !== 'next-app-filesystem') {
      throw new Error('Expected the proven auxiliary route to use Next App Router evidence.');
    }
    expect(routeLocation.params).toEqual({
      base: 'base',
      name: 'button-demo',
    });
    expect(plan?.target).toEqual({ exportName: 'default', sourcePath: targetPath });
    expect(plan?.contextModule).toBeUndefined();
    expect(plan?.renderChain.paths[0]?.steps.map((step) => step.sourcePath)).toEqual([
      targetPath,
      registryPath,
      pagePath,
    ]);
  });
});
