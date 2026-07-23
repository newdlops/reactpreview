/**
 * Specifies shallow Page Inspector context at the emitted JavaScript artifact boundary.
 *
 * Source-inventory tests can prove that a candidate was found, but they cannot prove that esbuild
 * avoided traversing the candidate's deeper implementation. These fixtures inspect the entry and
 * every emitted chunk together: direct page chrome must remain visible while second-hop children,
 * unused imports, and inactive route applications stay outside the first-paint artifact.
 */
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { EsbuildPreviewCompiler } from '../../../src/adapters/esbuild/esbuildPreviewCompiler';

const REPOSITORY_ROOT = fileURLToPath(new URL('../../../', import.meta.url));

/** One authored module written relative to a temporary application root. */
interface FixtureSource {
  readonly relativePath: string;
  readonly sourceText: string;
}

/** Writes one fixture module while preserving ordinary filesystem discovery semantics. */
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

/**
 * Compiles one fast Page Inspector artifact and returns all JavaScript output as searchable text.
 *
 * Each compiler is shut down before the temporary package is removed so persistent esbuild
 * contexts cannot retain deleted fixture paths between assertions.
 */
async function compileFastPageArtifact(options: {
  readonly fixtureName: string;
  readonly sources: readonly FixtureSource[];
  readonly targetRelativePath: string;
  readonly targetSource: string;
}): Promise<string> {
  const projectRoot = await mkdtemp(
    path.join(REPOSITORY_ROOT, `test/fixtures/${options.fixtureName}-`),
  );
  const compiler = new EsbuildPreviewCompiler();
  try {
    await writeFile(path.join(projectRoot, 'package.json'), '{"private":true}', 'utf8');
    await Promise.all(
      options.sources.map(({ relativePath, sourceText }) =>
        writeSource(projectRoot, relativePath, sourceText),
      ),
    );
    const targetPath = await writeSource(
      projectRoot,
      options.targetRelativePath,
      options.targetSource,
    );
    const bundle = await compiler.compile({
      dependencySnapshots: [],
      documentPath: targetPath,
      language: 'tsx',
      preparationMode: 'fast',
      renderMode: 'page-inspector',
      sourceText: options.targetSource,
      useStorybookPreview: false,
      workspaceRoot: projectRoot,
    });
    const buildErrors = bundle.diagnostics.filter((diagnostic) => diagnostic.severity === 'error');
    if (buildErrors.length > 0) {
      throw new Error(buildErrors.map((diagnostic) => diagnostic.message).join('\n'));
    }
    return Buffer.concat([
      Buffer.from(bundle.javascript),
      ...bundle.chunks.map((chunk) => Buffer.from(chunk.contents)),
    ]).toString('utf8');
  } finally {
    await compiler.shutdown();
    await rm(projectRoot, { force: true, recursive: true });
  }
}

/** Shared semantic ReactDOM entry used by every generic React fixture. */
const MAIN_SOURCE = [
  "import { createRoot } from 'react-dom/client';",
  "import App from './App';",
  'createRoot(document.body).render(<App />);',
].join('\n');

/** Shared selected page keeps the editor target one import edge below the page shell. */
const SELECTED_PAGE_SOURCE = [
  "import Target from './Target';",
  'export default function SelectedPage() {',
  '  return <main>SHALLOW_SELECTED_PAGE_MARKER<Target /></main>;',
  '}',
].join('\n');

/** Shared target marker proves that the selected file itself remains in every emitted artifact. */
const TARGET_SOURCE =
  'export default function Target() { return <article>SHALLOW_TARGET_MARKER</article>; }';

/** Creates many independently projectable route leaves whose module bodies must never be emitted. */
function createInactiveRouteSources(count: number): readonly FixtureSource[] {
  return Array.from({ length: count }, (_, index) => ({
    relativePath: `src/routes/InactiveRoute${index.toString()}.tsx`,
    sourceText: [
      `export default function InactiveRoute${index.toString()}() {`,
      `  return <main>SHALLOW_INACTIVE_ROUTE_${index.toString()}</main>;`,
      '}',
    ].join('\n'),
  }));
}

describe('EsbuildPreviewCompiler shallow fast page-shell artifact', () => {
  /**
   * RootLayout is on the selected route corridor. Header and Sidebar are its direct JSX siblings,
   * while Header's child is a second hop. Forty-nine inactive leaves exercise static route
   * projection above the layout without allowing an unrelated page marker into any output chunk.
   */
  it('emits direct layout chrome but omits deeper, unused, and inactive modules', async () => {
    const inactiveCount = 49;
    const inactiveSources = createInactiveRouteSources(inactiveCount);
    const javascript = await compileFastPageArtifact({
      fixtureName: 'fast-shallow-static-shell',
      sources: [
        { relativePath: 'src/main.tsx', sourceText: MAIN_SOURCE },
        {
          relativePath: 'src/App.tsx',
          sourceText: [
            "import { createBrowserRouter, createRoutesFromElements, Route, RouterProvider } from './router-runtime';",
            "import RootLayout from './RootLayout';",
            ...Array.from(
              { length: inactiveCount },
              (_, index) =>
                `import InactiveRoute${index.toString()} from './routes/InactiveRoute${index.toString()}';`,
            ),
            'const router = createBrowserRouter(createRoutesFromElements(',
            '<Route>',
            '  <Route path="selected" element={<RootLayout />} />',
            ...Array.from(
              { length: inactiveCount },
              (_, index) =>
                `  <Route path="inactive-${index.toString()}" element={<InactiveRoute${index.toString()} />} />`,
            ),
            '</Route>));',
            'export default function App() { return <RouterProvider router={router} />; }',
          ].join('\n'),
        },
        {
          relativePath: 'src/router-runtime.tsx',
          sourceText: [
            'export function Route({ element, children }) { return element ?? children ?? null; }',
            'export function createRoutesFromElements(value) { return value; }',
            'export function createBrowserRouter(routes) { return { routes }; }',
            'export function RouterProvider({ router }) { return router.routes; }',
          ].join('\n'),
        },
        {
          relativePath: 'src/RootLayout.tsx',
          sourceText: [
            "import Header from './shell/Header';",
            "import Sidebar from './shell/Sidebar';",
            "import UnusedPanel from './shell/UnusedPanel';",
            "import SelectedPage from './SelectedPage';",
            'export default function RootLayout() {',
            '  return <div><Header /><Sidebar /><SelectedPage /></div>;',
            '}',
          ].join('\n'),
        },
        {
          relativePath: 'src/shell/Header.tsx',
          sourceText: [
            "import DeepChild from './DeepChild';",
            'export default function Header() {',
            '  return <header>SHALLOW_HEADER_HOST_MARKER<DeepChild /></header>;',
            '}',
          ].join('\n'),
        },
        {
          relativePath: 'src/shell/DeepChild.tsx',
          sourceText:
            'export default function DeepChild() { return <span>SHALLOW_DEEP_CHILD_MARKER</span>; }',
        },
        {
          relativePath: 'src/shell/Sidebar.tsx',
          sourceText:
            'export default function Sidebar() { return <nav>SHALLOW_SIDEBAR_HOST_MARKER</nav>; }',
        },
        {
          relativePath: 'src/shell/UnusedPanel.tsx',
          sourceText:
            'export default function UnusedPanel() { return <aside>SHALLOW_UNUSED_MARKER</aside>; }',
        },
        { relativePath: 'src/SelectedPage.tsx', sourceText: SELECTED_PAGE_SOURCE },
        ...inactiveSources,
      ],
      targetRelativePath: 'src/Target.tsx',
      targetSource: TARGET_SOURCE,
    });

    expect({
      deepChild: javascript.includes('SHALLOW_DEEP_CHILD_MARKER'),
      headerHost: javascript.includes('SHALLOW_HEADER_HOST_MARKER'),
      inactiveRoute: javascript.includes('SHALLOW_INACTIVE_ROUTE_'),
      selectedPage: javascript.includes('SHALLOW_SELECTED_PAGE_MARKER'),
      sidebarHost: javascript.includes('SHALLOW_SIDEBAR_HOST_MARKER'),
      target: javascript.includes('SHALLOW_TARGET_MARKER'),
      unused: javascript.includes('SHALLOW_UNUSED_MARKER'),
    }).toEqual({
      deepChild: false,
      headerHost: true,
      inactiveRoute: false,
      selectedPage: true,
      sidebarHost: true,
      target: true,
      unused: false,
    });
  }, 15_000);

  /**
   * A directly rendered React.lazy header is page chrome, not an inactive route choice. Its own
   * implementation should be admitted shallowly without recursively admitting its child graph.
   */
  it('keeps a direct React.lazy header shallow', async () => {
    const javascript = await compileFastPageArtifact({
      fixtureName: 'fast-shallow-lazy-shell',
      sources: [
        { relativePath: 'src/main.tsx', sourceText: MAIN_SOURCE },
        {
          relativePath: 'src/App.tsx',
          sourceText:
            "import RootLayout from './RootLayout'; export default function App() { return <RootLayout />; }",
        },
        {
          relativePath: 'src/RootLayout.tsx',
          sourceText: [
            "import { lazy, Suspense } from 'react';",
            "import SelectedPage from './SelectedPage';",
            "const LazyHeader = lazy(() => import('./shell/LazyHeader'));",
            'export default function RootLayout() {',
            '  return <Suspense fallback={null}><LazyHeader /><SelectedPage /></Suspense>;',
            '}',
          ].join('\n'),
        },
        {
          relativePath: 'src/shell/LazyHeader.tsx',
          sourceText: [
            "import DeepChild from './LazyDeepChild';",
            'export default function LazyHeader() {',
            '  return <header>SHALLOW_LAZY_HEADER_HOST_MARKER<DeepChild /></header>;',
            '}',
          ].join('\n'),
        },
        {
          relativePath: 'src/shell/LazyDeepChild.tsx',
          sourceText:
            'export default function LazyDeepChild() { return <span>SHALLOW_LAZY_DEEP_MARKER</span>; }',
        },
        { relativePath: 'src/SelectedPage.tsx', sourceText: SELECTED_PAGE_SOURCE },
      ],
      targetRelativePath: 'src/Target.tsx',
      targetSource: TARGET_SOURCE,
    });

    expect({
      deepChild: javascript.includes('SHALLOW_LAZY_DEEP_MARKER'),
      headerHost: javascript.includes('SHALLOW_LAZY_HEADER_HOST_MARKER'),
      selectedPage: javascript.includes('SHALLOW_SELECTED_PAGE_MARKER'),
      target: javascript.includes('SHALLOW_TARGET_MARKER'),
    }).toEqual({
      deepChild: false,
      headerHost: true,
      selectedPage: true,
      target: true,
    });
  }, 15_000);

  /**
   * HOC transport changes the component value flow but not the desired artifact depth. The wrapped
   * host component remains visible while its implementation child stays outside first paint.
   */
  it('keeps an HOC-wrapped header shallow', async () => {
    const javascript = await compileFastPageArtifact({
      fixtureName: 'fast-shallow-hoc-shell',
      sources: [
        { relativePath: 'src/main.tsx', sourceText: MAIN_SOURCE },
        {
          relativePath: 'src/App.tsx',
          sourceText:
            "import RootLayout from './RootLayout'; export default function App() { return <RootLayout />; }",
        },
        {
          relativePath: 'src/RootLayout.tsx',
          sourceText: [
            "import Header from './shell/Header';",
            "import { withShellFrame } from './shell/withShellFrame';",
            "import SelectedPage from './SelectedPage';",
            'const FramedHeader = withShellFrame(Header);',
            'export default function RootLayout() {',
            '  return <><FramedHeader /><SelectedPage /></>;',
            '}',
          ].join('\n'),
        },
        {
          relativePath: 'src/shell/withShellFrame.tsx',
          sourceText:
            'export function withShellFrame(Component) { return function Frame() { return <section><Component /></section>; }; }',
        },
        {
          relativePath: 'src/shell/Header.tsx',
          sourceText: [
            "import DeepChild from './HocDeepChild';",
            'export default function Header() {',
            '  return <header>SHALLOW_HOC_HEADER_HOST_MARKER<DeepChild /></header>;',
            '}',
          ].join('\n'),
        },
        {
          relativePath: 'src/shell/HocDeepChild.tsx',
          sourceText:
            'export default function HocDeepChild() { return <span>SHALLOW_HOC_DEEP_MARKER</span>; }',
        },
        { relativePath: 'src/SelectedPage.tsx', sourceText: SELECTED_PAGE_SOURCE },
      ],
      targetRelativePath: 'src/Target.tsx',
      targetSource: TARGET_SOURCE,
    });

    expect({
      deepChild: javascript.includes('SHALLOW_HOC_DEEP_MARKER'),
      headerHost: javascript.includes('SHALLOW_HOC_HEADER_HOST_MARKER'),
      selectedPage: javascript.includes('SHALLOW_SELECTED_PAGE_MARKER'),
      target: javascript.includes('SHALLOW_TARGET_MARKER'),
    }).toEqual({
      deepChild: false,
      headerHost: true,
      selectedPage: true,
      target: true,
    });
  }, 15_000);

  /**
   * Component-prop transport is another direct render contract. The frame and supplied Header are
   * first-depth page context, but Header's own child remains beyond the shallow artifact boundary.
   */
  it('keeps a component-prop header shallow', async () => {
    const javascript = await compileFastPageArtifact({
      fixtureName: 'fast-shallow-component-prop-shell',
      sources: [
        { relativePath: 'src/main.tsx', sourceText: MAIN_SOURCE },
        {
          relativePath: 'src/App.tsx',
          sourceText:
            "import RootLayout from './RootLayout'; export default function App() { return <RootLayout />; }",
        },
        {
          relativePath: 'src/RootLayout.tsx',
          sourceText: [
            "import Header from './shell/Header';",
            "import ShellSlot from './shell/ShellSlot';",
            "import SelectedPage from './SelectedPage';",
            'export default function RootLayout() {',
            '  return <><ShellSlot component={Header} /><SelectedPage /></>;',
            '}',
          ].join('\n'),
        },
        {
          relativePath: 'src/shell/ShellSlot.tsx',
          sourceText:
            'export default function ShellSlot({ component: Component }) { return <section><Component /></section>; }',
        },
        {
          relativePath: 'src/shell/Header.tsx',
          sourceText: [
            "import DeepChild from './PropDeepChild';",
            'export default function Header() {',
            '  return <header>SHALLOW_PROP_HEADER_HOST_MARKER<DeepChild /></header>;',
            '}',
          ].join('\n'),
        },
        {
          relativePath: 'src/shell/PropDeepChild.tsx',
          sourceText:
            'export default function PropDeepChild() { return <span>SHALLOW_PROP_DEEP_MARKER</span>; }',
        },
        { relativePath: 'src/SelectedPage.tsx', sourceText: SELECTED_PAGE_SOURCE },
      ],
      targetRelativePath: 'src/Target.tsx',
      targetSource: TARGET_SOURCE,
    });

    expect({
      deepChild: javascript.includes('SHALLOW_PROP_DEEP_MARKER'),
      headerHost: javascript.includes('SHALLOW_PROP_HEADER_HOST_MARKER'),
      selectedPage: javascript.includes('SHALLOW_SELECTED_PAGE_MARKER'),
      target: javascript.includes('SHALLOW_TARGET_MARKER'),
    }).toEqual({
      deepChild: false,
      headerHost: true,
      selectedPage: true,
      target: true,
    });
  }, 15_000);

  /**
   * The current file is the inspection subject rather than omitted page chrome. Its imported
   * children therefore remain exact even though sibling shell roots stop after one project hop.
   */
  it('keeps imported descendants of the selected target exact', async () => {
    const javascript = await compileFastPageArtifact({
      fixtureName: 'fast-shallow-exact-target-child',
      sources: [
        { relativePath: 'src/main.tsx', sourceText: MAIN_SOURCE },
        {
          relativePath: 'src/App.tsx',
          sourceText: [
            "import SelectedPage from './SelectedPage';",
            'export default function App() { return <SelectedPage />; }',
          ].join('\n'),
        },
        { relativePath: 'src/SelectedPage.tsx', sourceText: SELECTED_PAGE_SOURCE },
        {
          relativePath: 'src/TargetChild.tsx',
          sourceText:
            'export default function TargetChild() { return <span>SHALLOW_EXACT_TARGET_CHILD_MARKER</span>; }',
        },
      ],
      targetRelativePath: 'src/Target.tsx',
      targetSource: [
        "import TargetChild from './TargetChild';",
        'export default function Target() {',
        '  return <article>SHALLOW_TARGET_WITH_CHILD_MARKER<TargetChild /></article>;',
        '}',
      ].join('\n'),
    });

    expect(javascript).toContain('SHALLOW_TARGET_WITH_CHILD_MARKER');
    expect(javascript).toContain('SHALLOW_EXACT_TARGET_CHILD_MARKER');
  }, 15_000);

  /**
   * A module used both as the selected-path wrapper and a sibling must remain exact. Exact transport
   * wins over shallow optimization so Provider/layout internals cannot disappear by source aliasing.
   */
  it('prioritizes an exact wrapper when the same module is also a shallow sibling', async () => {
    const javascript = await compileFastPageArtifact({
      fixtureName: 'fast-shallow-exact-wrapper-priority',
      sources: [
        { relativePath: 'src/main.tsx', sourceText: MAIN_SOURCE },
        {
          relativePath: 'src/App.tsx',
          sourceText: [
            "import Shell from './shell/Shell';",
            "import SelectedPage from './SelectedPage';",
            'export default function App() {',
            '  return <Shell><Shell /><SelectedPage /></Shell>;',
            '}',
          ].join('\n'),
        },
        {
          relativePath: 'src/shell/Shell.tsx',
          sourceText: [
            "import ShellContext from './ShellContext';",
            'export default function Shell(props) {',
            '  return <section>SHALLOW_EXACT_WRAPPER_MARKER<ShellContext />{props.children}</section>;',
            '}',
          ].join('\n'),
        },
        {
          relativePath: 'src/shell/ShellContext.tsx',
          sourceText:
            'export default function ShellContext() { return <aside>SHALLOW_EXACT_WRAPPER_CHILD_MARKER</aside>; }',
        },
        { relativePath: 'src/SelectedPage.tsx', sourceText: SELECTED_PAGE_SOURCE },
      ],
      targetRelativePath: 'src/Target.tsx',
      targetSource: TARGET_SOURCE,
    });

    expect(javascript).toContain('SHALLOW_EXACT_WRAPPER_MARKER');
    expect(javascript).toContain('SHALLOW_EXACT_WRAPPER_CHILD_MARKER');
    expect(javascript).toContain('SHALLOW_TARGET_MARKER');
  }, 15_000);
});
