/**
 * Defines conservative one-hop page-shell context around a proven fast entry-to-target corridor.
 *
 * These fixtures distinguish JSX that visibly shares the selected render branch from imports that
 * merely coexist in the same module. They also protect traversal fairness: an early, deep sibling
 * subtree must not consume the complete first-paint budget before a later corridor step contributes
 * its direct header, breadcrumb, or navigation sibling.
 */
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import {
  collectPreviewInspectorFastPageCorridor,
  type PreviewInspectorFastPageCorridor,
} from '../../../../src/adapters/esbuild/inspector/previewInspectorFastPageCorridor';
import { collectPreviewInspectorOneHopContext } from '../../../../src/adapters/esbuild/inspector/previewInspectorOneHopContext';

const temporaryRoots: string[] = [];

/** Removes every generated application tree, including fixtures from an interrupted assertion. */
afterEach(async () => {
  await Promise.all(
    temporaryRoots.splice(0).map((rootPath) => rm(rootPath, { force: true, recursive: true })),
  );
});

/** Writes one authored fixture and returns its normalized absolute source identity. */
async function writeSource(
  rootPath: string,
  relativePath: string,
  sourceText: string,
): Promise<string> {
  const sourcePath = path.join(rootPath, relativePath);
  await mkdir(path.dirname(sourcePath), { recursive: true });
  await writeFile(sourcePath, sourceText, 'utf8');
  return path.normalize(sourcePath);
}

/** Resolves only fixture-owned relative requests through ordinary TS/TSX and barrel suffixes. */
function createFixtureResolver(sourcePaths: readonly string[]) {
  const knownPaths = new Set(sourcePaths.map((sourcePath) => path.normalize(sourcePath)));
  return (moduleSpecifier: string, importerPath: string): string | undefined => {
    if (!moduleSpecifier.startsWith('.')) return undefined;
    const candidate = path.resolve(path.dirname(importerPath), moduleSpecifier);
    return [
      candidate,
      `${candidate}.tsx`,
      `${candidate}.ts`,
      path.join(candidate, 'index.tsx'),
      path.join(candidate, 'index.ts'),
    ]
      .map((sourcePath) => path.normalize(sourcePath))
      .find((sourcePath) => knownPaths.has(sourcePath));
  };
}

/** Runs the production bounded corridor against current disk snapshots. */
async function collectFixtureCorridor(
  projectRoot: string,
  targetPath: string,
  sourcePaths: readonly string[],
): Promise<PreviewInspectorFastPageCorridor | undefined> {
  return collectPreviewInspectorFastPageCorridor({
    documentPath: targetPath,
    projectRoot,
    readSource: (sourcePath) => readFile(sourcePath, 'utf8').catch(() => undefined),
    resolveModule: createFixtureResolver(sourcePaths),
    workspaceRoot: projectRoot,
  });
}

describe('fast Page Inspector one-hop page context', () => {
  /** Providers and visible chrome in the same authored return belong to the page context. */
  it('keeps direct provider and header siblings beside the selected page', async () => {
    const projectRoot = await mkdtemp(path.join(os.tmpdir(), 'fast-one-hop-shell-'));
    temporaryRoots.push(projectRoot);
    const sourcePaths = await Promise.all([
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
          "import PageProvider from './shell/PageProvider';",
          "import Header from './shell/Header';",
          "import UnusedPanel from './shell/UnusedPanel';",
          "import SelectedPage from './page/SelectedPage';",
          'void UnusedPanel;',
          'export default function App() {',
          '  return <PageProvider><Header /><SelectedPage /></PageProvider>;',
          '}',
        ].join('\n'),
      ),
      writeSource(
        projectRoot,
        'src/shell/PageProvider.tsx',
        'export default function PageProvider({ children }) { return <section>{children}</section>; }',
      ),
      writeSource(
        projectRoot,
        'src/shell/Header.tsx',
        'export default function Header() { return <header>Header</header>; }',
      ),
      writeSource(
        projectRoot,
        'src/shell/UnusedPanel.tsx',
        'export default function UnusedPanel() { return <aside>Unused</aside>; }',
      ),
      writeSource(
        projectRoot,
        'src/page/SelectedPage.tsx',
        "import Target from './Target'; export default function SelectedPage() { return <Target />; }",
      ),
      writeSource(
        projectRoot,
        'src/page/Target.tsx',
        'export default function Target() { return <main>Selected</main>; }',
      ),
    ]);
    const targetPath = path.join(projectRoot, 'src/page/Target.tsx');

    const corridor = await collectFixtureCorridor(projectRoot, targetPath, sourcePaths);

    expect(corridor?.entryConnected).toBe(true);
    expect(corridor?.sourcePaths).toContain(path.join(projectRoot, 'src/shell/PageProvider.tsx'));
    expect(corridor?.sourcePaths).toContain(path.join(projectRoot, 'src/shell/Header.tsx'));
  });

  /**
   * The focused classifier distinguishes rendered bindings from inventory-only imports. The broad
   * source inventory may retain the latter for later planning, but it must not consume the fair
   * direct-JSX sibling allowance.
   */
  it('does not select an unused imported binding as direct JSX context', async () => {
    const appPath = '/workspace/App.tsx';
    const pagePath = '/workspace/Page.tsx';
    const providerPath = '/workspace/PageProvider.tsx';
    const headerPath = '/workspace/Header.tsx';
    const unusedPath = '/workspace/UnusedPanel.tsx';
    const sourceByPath = new Map<string, string>([
      [
        appPath,
        [
          "import PageProvider from './PageProvider';",
          "import Header from './Header';",
          "import UnusedPanel from './UnusedPanel';",
          "import Page from './Page';",
          'void UnusedPanel;',
          'export default function App() {',
          '  return <PageProvider><Header /><Page /></PageProvider>;',
          '}',
        ].join('\n'),
      ],
      [pagePath, 'export default function Page() { return <main>Page</main>; }'],
    ]);

    const context = await collectPreviewInspectorOneHopContext({
      importPath: [appPath, pagePath],
      maximumFiles: 8,
      readSource: (sourcePath) => Promise.resolve(sourceByPath.get(path.normalize(sourcePath))),
      resolveModule: createFixtureResolver([
        appPath,
        pagePath,
        providerPath,
        headerPath,
        unusedPath,
      ]),
      workspaceRoot: '/workspace',
    });

    expect(context.sourcePaths).toEqual([providerPath, headerPath]);
    expect(context.sourcePaths).not.toContain(unusedPath);
  });

  /**
   * A fanout cap is a latency feature, not proof of completeness. Every omitted visible sibling
   * must leave the corridor provisional so full enrichment can replace the first-paint shell.
   */
  it('marks a capped direct JSX sibling fanout as truncated', async () => {
    const projectRoot = await mkdtemp(path.join(os.tmpdir(), 'fast-one-hop-fanout-'));
    temporaryRoots.push(projectRoot);
    const siblingCount = 110;
    const siblingPaths = await Promise.all(
      Array.from({ length: siblingCount }, (_, index) =>
        writeSource(
          projectRoot,
          `src/siblings/Sibling${index.toString().padStart(3, '0')}.tsx`,
          `export default function Sibling${index.toString()}() { return <aside>Sibling</aside>; }`,
        ),
      ),
    );
    const sourcePaths = [
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
            "import SelectedPage from './page/SelectedPage';",
            ...Array.from(
              { length: siblingCount },
              (_, index) =>
                `import Sibling${index.toString()} from './siblings/Sibling${index.toString().padStart(3, '0')}';`,
            ),
            'export default function App() { return <>',
            '<SelectedPage />',
            ...Array.from({ length: siblingCount }, (_, index) => `<Sibling${index.toString()} />`),
            '</>; }',
          ].join('\n'),
        ),
        writeSource(
          projectRoot,
          'src/page/SelectedPage.tsx',
          "import Target from './Target'; export default function SelectedPage() { return <Target />; }",
        ),
        writeSource(
          projectRoot,
          'src/page/Target.tsx',
          'export default function Target() { return <main>Selected</main>; }',
        ),
      ])),
      ...siblingPaths,
    ];
    const targetPath = path.join(projectRoot, 'src/page/Target.tsx');

    const corridor = await collectFixtureCorridor(projectRoot, targetPath, sourcePaths);
    const admittedSiblings =
      corridor?.sourcePaths.filter((sourcePath) => path.basename(sourcePath).startsWith('Sibling'))
        .length ?? 0;

    expect(corridor?.entryConnected).toBe(true);
    expect(admittedSiblings).toBeLessThan(siblingCount);
    expect(corridor?.truncated).toBe(true);
  });

  /**
   * Work is reserved per corridor step. Recursively expanding an early visible sibling must not
   * starve a breadcrumb rendered directly beside the selected child several path steps later.
   */
  it('retains later direct JSX siblings after an early branch exhausts recursive DFS breadth', async () => {
    const projectRoot = await mkdtemp(path.join(os.tmpdir(), 'fast-one-hop-fairness-'));
    temporaryRoots.push(projectRoot);
    const firstLevelCount = 95;
    const secondLevelCount = 96;
    const firstLevelPaths = await Promise.all(
      Array.from({ length: firstLevelCount }, (_, index) =>
        writeSource(
          projectRoot,
          `src/branches/FirstLeaf${index.toString().padStart(3, '0')}.tsx`,
          `export default function FirstLeaf${index.toString()}() { return <i>First</i>; }`,
        ),
      ),
    );
    const secondLevelPaths = await Promise.all(
      Array.from({ length: secondLevelCount }, (_, index) =>
        writeSource(
          projectRoot,
          `src/branches/SecondLeaf${index.toString().padStart(3, '0')}.tsx`,
          `export default function SecondLeaf${index.toString()}() { return <i>Second</i>; }`,
        ),
      ),
    );
    const sourcePaths = [
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
            "import ExplosiveBranch from './branches/AExplosiveBranch';",
            "import SelectedPage from './page/SelectedPage';",
            'export default function App() { return <><ExplosiveBranch /><SelectedPage /></>; }',
          ].join('\n'),
        ),
        writeSource(
          projectRoot,
          'src/branches/AExplosiveBranch.tsx',
          [
            "import DeepBranch from './BDeepBranch';",
            ...Array.from(
              { length: firstLevelCount },
              (_, index) =>
                `import FirstLeaf${index.toString()} from './FirstLeaf${index.toString().padStart(3, '0')}';`,
            ),
            'export default function ExplosiveBranch() { return <><DeepBranch />',
            ...Array.from(
              { length: firstLevelCount },
              (_, index) => `<FirstLeaf${index.toString()} />`,
            ),
            '</>; }',
          ].join('\n'),
        ),
        writeSource(
          projectRoot,
          'src/branches/BDeepBranch.tsx',
          [
            ...Array.from(
              { length: secondLevelCount },
              (_, index) =>
                `import SecondLeaf${index.toString()} from './SecondLeaf${index.toString().padStart(3, '0')}';`,
            ),
            'export default function DeepBranch() { return <>',
            ...Array.from(
              { length: secondLevelCount },
              (_, index) => `<SecondLeaf${index.toString()} />`,
            ),
            '</>; }',
          ].join('\n'),
        ),
        writeSource(
          projectRoot,
          'src/page/SelectedPage.tsx',
          [
            "import Breadcrumb from './Breadcrumb';",
            "import Target from './Target';",
            'export default function SelectedPage() { return <><Breadcrumb /><Target /></>; }',
          ].join('\n'),
        ),
        writeSource(
          projectRoot,
          'src/page/Breadcrumb.tsx',
          'export default function Breadcrumb() { return <nav>Breadcrumb</nav>; }',
        ),
        writeSource(
          projectRoot,
          'src/page/Target.tsx',
          'export default function Target() { return <main>Selected</main>; }',
        ),
      ])),
      ...firstLevelPaths,
      ...secondLevelPaths,
    ];
    const targetPath = path.join(projectRoot, 'src/page/Target.tsx');

    const corridor = await collectFixtureCorridor(projectRoot, targetPath, sourcePaths);

    expect(corridor?.entryConnected).toBe(true);
    expect(corridor?.sourcePaths).toContain(path.join(projectRoot, 'src/page/Breadcrumb.tsx'));
  });

  /**
   * Inactive route leaves are choices, not page chrome. The selected route and its parent layout
   * remain authentic while a sibling page is omitted even though all three are JSX imports.
   */
  it('keeps a route layout but excludes an inactive leaf route sibling', async () => {
    const projectRoot = await mkdtemp(path.join(os.tmpdir(), 'fast-one-hop-routes-'));
    temporaryRoots.push(projectRoot);
    const sourcePaths = await Promise.all([
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
          "import PageLayout from './routes/PageLayout';",
          "import SelectedPage from './routes/SelectedPage';",
          "import InactivePage from './routes/InactivePage';",
          'const router = createBrowserRouter(createRoutesFromElements(',
          '<Route element={<PageLayout />}>',
          '  <Route path="selected" element={<SelectedPage />} />',
          '  <Route path="inactive" element={<InactivePage />} />',
          '</Route>));',
          'export default function App() { return <RouterProvider router={router} />; }',
        ].join('\n'),
      ),
      writeSource(
        projectRoot,
        'src/routes/PageLayout.tsx',
        'export default function PageLayout({ children }) { return <section>{children}</section>; }',
      ),
      writeSource(
        projectRoot,
        'src/routes/SelectedPage.tsx',
        "import Target from './Target'; export default function SelectedPage() { return <Target />; }",
      ),
      writeSource(
        projectRoot,
        'src/routes/InactivePage.tsx',
        'export default function InactivePage() { return <main>Inactive</main>; }',
      ),
      writeSource(
        projectRoot,
        'src/routes/Target.tsx',
        'export default function Target() { return <main>Selected</main>; }',
      ),
    ]);
    const targetPath = path.join(projectRoot, 'src/routes/Target.tsx');

    const corridor = await collectFixtureCorridor(projectRoot, targetPath, sourcePaths);

    expect(corridor?.entryConnected).toBe(true);
    expect(corridor?.sourcePaths).toContain(path.join(projectRoot, 'src/routes/PageLayout.tsx'));
    expect(corridor?.sourcePaths).not.toContain(
      path.join(projectRoot, 'src/routes/InactivePage.tsx'),
    );
  });
});
