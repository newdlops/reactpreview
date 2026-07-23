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
          "import { pagesMap } from './config/pages-map';",
          'void pagesMap;',
          'export default function App() { return <Layout><ReportPage /></Layout>; }',
        ].join('\n'),
      ),
      writeSource(
        projectRoot,
        'src/config/pages-map.ts',
        'export const pagesMap = { report: "/report" };',
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
      expect.arrayContaining(['Layout.tsx', 'Header.tsx', 'Sidebar.tsx', 'pages-map.ts']),
    );
  });

  /**
   * A wide application registry can place hundreds of shallow siblings ahead of the selected
   * branch. The entry walk must use target-side affinity instead of exhausting its bounded budget
   * in breadth-first order.
   */
  it('finds a deep target-affine entry corridor before wide sibling branches exhaust the budget', async () => {
    const projectRoot = await mkdtemp(path.join(os.tmpdir(), 'fast-page-best-first-'));
    temporaryRoots.push(projectRoot);
    const mainPath = await writeSource(
      projectRoot,
      'src/main.tsx',
      [
        "import { createRoot } from 'react-dom/client';",
        "import App from './App';",
        'createRoot(document.body).render(<App />);',
      ].join('\n'),
    );
    const appPath = path.join(projectRoot, 'src/App.tsx');
    const bridgeOnePath = path.join(projectRoot, 'src/features/selected-flow/BridgeOne.ts');
    const bridgeTwoPath = path.join(projectRoot, 'src/features/selected-flow/deeper/BridgeTwo.ts');
    const targetPath = path.join(projectRoot, 'src/features/selected/Target.tsx');
    const sourceByPath = new Map<string, string>([
      [
        mainPath,
        [
          "import { createRoot } from 'react-dom/client';",
          "import App from './App';",
          'createRoot(document.body).render(<App />);',
        ].join('\n'),
      ],
      [
        appPath,
        [
          ...Array.from(
            { length: 80 },
            (_, index) => `import './a-decoys/group-${index.toString()}/Branch';`,
          ),
          "import './features/selected-flow/BridgeOne';",
          'export default function App() { return null; }',
        ].join('\n'),
      ],
      [bridgeOnePath, "import './deeper/BridgeTwo'; export const bridgeOne = true;"],
      [bridgeTwoPath, "import '../../selected/Target'; export const bridgeTwo = true;"],
      [targetPath, 'export default function Target() { return <main>Target</main>; }'],
    ]);
    for (let groupIndex = 0; groupIndex < 80; groupIndex += 1) {
      const branchPath = path.join(
        projectRoot,
        `src/a-decoys/group-${groupIndex.toString()}/Branch.ts`,
      );
      sourceByPath.set(
        branchPath,
        [
          ...Array.from(
            { length: 10 },
            (_, leafIndex) => `import './Leaf${leafIndex.toString()}';`,
          ),
          'export const branch = true;',
        ].join('\n'),
      );
      for (let leafIndex = 0; leafIndex < 10; leafIndex += 1) {
        sourceByPath.set(
          path.join(
            projectRoot,
            `src/a-decoys/group-${groupIndex.toString()}/Leaf${leafIndex.toString()}.ts`,
          ),
          'export const leaf = true;',
        );
      }
    }
    const sourcePaths = [...sourceByPath.keys()];
    const resolveModule = createFixtureResolver(sourcePaths);
    let sourceReadCount = 0;

    const corridor = await collectPreviewInspectorFastPageCorridor({
      documentPath: targetPath,
      projectRoot,
      readSource: (sourcePath) => {
        sourceReadCount += 1;
        return Promise.resolve(sourceByPath.get(path.normalize(sourcePath)));
      },
      resolveModule,
      workspaceRoot: projectRoot,
    });

    expect(corridor?.entryConnected).toBe(true);
    expect(corridor?.importPath.map((sourcePath) => path.basename(sourcePath))).toEqual([
      'main.tsx',
      'App.tsx',
      'BridgeOne.ts',
      'BridgeTwo.ts',
      'Target.tsx',
    ]);
    expect(sourceReadCount).toBeLessThan(40);
  });

  /**
   * Reverse candidates are ranked for relevance rather than topological order. Cached upstream
   * edges must activate when a later candidate proves their child reaches the selected target.
   */
  it('propagates reverse ownership through candidates read before their children become reachable', async () => {
    const projectRoot = await mkdtemp(path.join(os.tmpdir(), 'fast-page-reverse-fixpoint-'));
    temporaryRoots.push(projectRoot);
    const sources = await Promise.all([
      writeSource(
        projectRoot,
        'src/main.tsx',
        [
          "import { createRoot } from 'react-dom/client';",
          "import Feature from './feature';",
          'createRoot(document.body).render(<Feature />);',
        ].join('\n'),
      ),
      writeSource(
        projectRoot,
        'src/feature/index.tsx',
        "export { default } from './FeaturePanel';",
      ),
      writeSource(
        projectRoot,
        'src/feature/FeaturePanel.tsx',
        "import Target from './Target'; export default function FeaturePanel() { return <Target />; }",
      ),
      writeSource(
        projectRoot,
        'src/feature/Target.tsx',
        'export default function Target() { return <main>Target</main>; }',
      ),
    ]);
    const targetPath = path.join(projectRoot, 'src/feature/Target.tsx');

    const corridor = await collectPreviewInspectorFastPageCorridor({
      documentPath: targetPath,
      projectRoot,
      readSource: (sourcePath) => readFile(sourcePath, 'utf8').catch(() => undefined),
      resolveModule: createFixtureResolver(sources),
      workspaceRoot: projectRoot,
    });

    expect(corridor?.entryConnected).toBe(true);
    expect(corridor?.importPath.map((sourcePath) => path.basename(sourcePath))).toEqual([
      'main.tsx',
      'index.tsx',
      'FeaturePanel.tsx',
      'Target.tsx',
    ]);
  });

  /**
   * The selected component name can differ from its page owner. Reverse-owner affinity must rank
   * that page import before a registry's lexical resolver cutoff discards it.
   */
  it('uses reverse page owners to retain the selected branch in a very wide import registry', async () => {
    const projectRoot = await mkdtemp(path.join(os.tmpdir(), 'fast-page-owner-affinity-'));
    temporaryRoots.push(projectRoot);
    const decoySources = await Promise.all(
      Array.from({ length: 120 }, (_, index) =>
        writeSource(
          projectRoot,
          `src/pages/Choice${index.toString().padStart(3, '0')}.ts`,
          `export const choice${index.toString()} = true;`,
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
            ...decoySources.map(
              (_, index) => `import './pages/Choice${index.toString().padStart(3, '0')}';`,
            ),
            "import SelectedPage from './pages/SelectedPage';",
            'export default function App() { return <SelectedPage />; }',
          ].join('\n'),
        ),
        writeSource(
          projectRoot,
          'src/pages/SelectedPage.tsx',
          "import TargetWidget from './TargetWidget'; export default function SelectedPage() { return <TargetWidget />; }",
        ),
        writeSource(
          projectRoot,
          'src/pages/TargetWidget.tsx',
          'export default function TargetWidget() { return <main>Target</main>; }',
        ),
      ])),
      ...decoySources,
    ];
    const targetPath = path.join(projectRoot, 'src/pages/TargetWidget.tsx');

    const corridor = await collectPreviewInspectorFastPageCorridor({
      documentPath: targetPath,
      projectRoot,
      readSource: (sourcePath) => readFile(sourcePath, 'utf8').catch(() => undefined),
      resolveModule: createFixtureResolver(sources),
      workspaceRoot: projectRoot,
    });

    expect(corridor?.entryConnected).toBe(true);
    expect(corridor?.importPath.map((sourcePath) => path.basename(sourcePath))).toEqual([
      'main.tsx',
      'App.tsx',
      'SelectedPage.tsx',
      'TargetWidget.tsx',
    ]);
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

  /** A projected majority retains the app shell while one mixed-use sibling remains authentic. */
  it('preserves a high-fanout React Router prefix with a bounded authentic minority', async () => {
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
            'void Sibling0;',
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

    expect(corridor?.entryConnected).toBe(true);
    expect(corridor?.importPath.map((sourcePath) => path.basename(sourcePath))).toEqual([
      'main.tsx',
      'App.tsx',
      'SelectedPage.tsx',
      'Target.tsx',
    ]);
    expect(corridor?.sourcePaths).toContain(path.join(projectRoot, 'src/pages/Sibling0.tsx'));
    expect(corridor?.sourcePaths).not.toContain(path.join(projectRoot, 'src/pages/Sibling1.tsx'));
  });

  /** Shape-proven page factories prune choices without requiring a React Router API name. */
  it('keeps factory-authored layout evidence while excluding off-path component choices', async () => {
    const projectRoot = await mkdtemp(path.join(os.tmpdir(), 'fast-page-factory-'));
    temporaryRoots.push(projectRoot);
    const siblingPaths = Array.from({ length: 49 }, (_, index) =>
      path.join(projectRoot, `src/pages/Sibling${index.toString()}.tsx`),
    );
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
          "import Layout from './Layout';",
          "import SelectedPage from './pages/SelectedPage';",
          ...siblingPaths.map(
            (_, index) =>
              `import Sibling${index.toString()} from './pages/Sibling${index.toString()}';`,
          ),
          'const page = createPageRegistry("/base", {',
          'selected: SelectedPage,',
          ...siblingPaths.map(
            (_, index) => `sibling${index.toString()}: Sibling${index.toString()},`,
          ),
          '}, [], () => <Layout />);',
          'export default function App() { return <>{page}</>; }',
        ].join('\n'),
      ),
      writeSource(
        projectRoot,
        'src/Layout.tsx',
        'export default function Layout() { return <main>Layout</main>; }',
      ),
      writeSource(
        projectRoot,
        'src/pages/SelectedPage.tsx',
        "import Target from './Target'; export default function SelectedPage() { return <Target />; }",
      ),
      writeSource(
        projectRoot,
        'src/pages/Target.tsx',
        'export default function Target() { return <article>Target</article>; }',
      ),
      ...siblingPaths.map((_, index) =>
        writeSource(
          projectRoot,
          `src/pages/Sibling${index.toString()}.tsx`,
          `export default function Sibling${index.toString()}() { return null; }`,
        ),
      ),
    ]);
    const targetPath = path.join(projectRoot, 'src/pages/Target.tsx');

    const corridor = await collectPreviewInspectorFastPageCorridor({
      documentPath: targetPath,
      projectRoot,
      readSource: (sourcePath) => readFile(sourcePath, 'utf8').catch(() => undefined),
      resolveModule: createFixtureResolver(sources),
      workspaceRoot: projectRoot,
    });

    expect(corridor?.entryConnected).toBe(true);
    expect(corridor?.sourcePaths).toContain(path.join(projectRoot, 'src/Layout.tsx'));
    expect(corridor?.sourcePaths.some((sourcePath) => sourcePath.includes('Sibling'))).toBe(false);
  });

  /** A registry dominated by mixed-use branches keeps the conservative page-local trim. */
  it('trims a broad router prefix when most off-path route imports are unsafe to project', async () => {
    const projectRoot = await mkdtemp(path.join(os.tmpdir(), 'fast-page-unsafe-router-'));
    temporaryRoots.push(projectRoot);
    const mainPath = await writeSource(
      projectRoot,
      'src/main.tsx',
      [
        "import { createRoot } from 'react-dom/client';",
        "import App from './App';",
        'createRoot(document.body).render(<App />);',
      ].join('\n'),
    );
    const appPath = path.join(projectRoot, 'src/App.tsx');
    const selectedPagePath = path.join(projectRoot, 'src/pages/SelectedPage.tsx');
    const targetPath = path.join(projectRoot, 'src/pages/Target.tsx');
    const siblingPaths = Array.from({ length: 49 }, (_, index) =>
      path.join(projectRoot, `src/pages/Sibling${index.toString()}.tsx`),
    );
    const sourceByPath = new Map<string, string>([
      [
        mainPath,
        [
          "import { createRoot } from 'react-dom/client';",
          "import App from './App';",
          'createRoot(document.body).render(<App />);',
        ].join('\n'),
      ],
      [
        appPath,
        [
          "import { createBrowserRouter, createRoutesFromElements, Route, RouterProvider } from 'react-router-dom';",
          "import SelectedPage from './pages/SelectedPage';",
          ...siblingPaths.map(
            (_, index) =>
              `import Sibling${index.toString()} from './pages/Sibling${index.toString()}';`,
          ),
          ...Array.from({ length: 40 }, (_, index) => `void Sibling${index.toString()};`),
          'const router = createBrowserRouter(createRoutesFromElements(<Route>',
          '<Route path="selected" element={<SelectedPage />} />',
          ...siblingPaths.map(
            (_, index) =>
              `<Route path="sibling-${index.toString()}" element={<Sibling${index.toString()} />} />`,
          ),
          '</Route>));',
          'export default function App() { return <RouterProvider router={router} />; }',
        ].join('\n'),
      ],
      [
        selectedPagePath,
        "import Target from './Target'; export default function SelectedPage() { return <Target />; }",
      ],
      [targetPath, 'export default function Target() { return <main>Target</main>; }'],
      ...siblingPaths.map(
        (sourcePath, index) =>
          [
            sourcePath,
            `export default function Sibling${index.toString()}() { return null; }`,
          ] as const,
      ),
    ]);

    const corridor = await collectPreviewInspectorFastPageCorridor({
      documentPath: targetPath,
      projectRoot,
      readSource: (sourcePath) => Promise.resolve(sourceByPath.get(path.normalize(sourcePath))),
      resolveModule: createFixtureResolver([...sourceByPath.keys()]),
      workspaceRoot: projectRoot,
    });

    expect(corridor?.entryConnected).toBe(false);
    expect(corridor?.truncated).toBe(true);
    expect(corridor?.importPath.map((sourcePath) => path.basename(sourcePath))).toEqual([
      'SelectedPage.tsx',
      'Target.tsx',
    ]);
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
