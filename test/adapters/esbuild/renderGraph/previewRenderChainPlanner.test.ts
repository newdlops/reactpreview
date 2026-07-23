/** Verifies static export-to-entry traversal across lazy, route, value-flow, and monorepo edges. */
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  createPreviewRenderChainPlan,
  createPreviewRenderChainPlans,
} from '../../../../src/adapters/esbuild/renderGraph';

const ROOT = '/workspace/apps/web/src';
const TARGET_PATH = `${ROOT}/pages/SelectedPage.tsx`;
const PAGES_PATH = `${ROOT}/pages/index.ts`;
const APP_PATH = `${ROOT}/App.tsx`;
const ENTRY_PATH = `${ROOT}/index.tsx`;
const LAYOUTS_PATH = `${ROOT}/layouts.tsx`;

/** Creates a source reader and exact extension/index-aware resolver over one immutable fixture. */
function createFixture(sources: Readonly<Record<string, string>>): {
  readonly readSource: (sourcePath: string) => Promise<string | undefined>;
  readonly resolveModule: (specifier: string, consumerPath: string) => string | undefined;
} {
  const sourcePaths = Object.keys(sources);
  const byStem = new Map<string, string>();
  for (const sourcePath of sourcePaths) {
    byStem.set(removeSourceExtension(sourcePath), sourcePath);
    if (path.basename(sourcePath).startsWith('index.')) {
      byStem.set(path.dirname(sourcePath), sourcePath);
    }
  }
  return {
    readSource: (sourcePath) => Promise.resolve(sources[sourcePath]),
    resolveModule: (specifier, consumerPath) => {
      if (!specifier.startsWith('.')) {
        return undefined;
      }
      return byStem.get(removeSourceExtension(path.resolve(path.dirname(consumerPath), specifier)));
    },
  };
}

/** Removes authored JS/TS source extensions for conventional resolver fixture matching. */
function removeSourceExtension(sourcePath: string): string {
  return sourcePath.replace(/\.[cm]?[jt]sx?$/u, '');
}

describe('createPreviewRenderChainPlan', () => {
  /** Parses one inventory once while retaining independent entry reachability for every export. */
  it('discovers all current-file exports through one shared graph index', async () => {
    const primaryEntry = `${ROOT}/primary-entry.tsx`;
    const secondaryEntry = `${ROOT}/secondary-entry.tsx`;
    const sources = {
      [TARGET_PATH]: [
        'export const Primary = () => <article>primary</article>;',
        'export const Secondary = () => <article>secondary</article>;',
        'export const Orphan = () => <article>orphan</article>;',
      ].join('\n'),
      [primaryEntry]: [
        "import { createRoot } from 'react-dom/client';",
        "import { Primary } from './pages/SelectedPage';",
        'createRoot(document.body).render(<Primary />);',
      ].join('\n'),
      [secondaryEntry]: [
        "import { createRoot } from 'react-dom/client';",
        "import { Secondary } from './pages/SelectedPage';",
        'createRoot(document.body).render(<Secondary />);',
      ].join('\n'),
    };
    const fixture = createFixture(sources);
    const readCountByPath = new Map<string, number>();

    const plans = await createPreviewRenderChainPlans({
      documentPath: TARGET_PATH,
      exportNames: ['Primary', 'Secondary', 'Orphan'],
      readSource: async (sourcePath) => {
        readCountByPath.set(sourcePath, (readCountByPath.get(sourcePath) ?? 0) + 1);
        return fixture.readSource(sourcePath);
      },
      resolveModule: fixture.resolveModule,
      sourcePaths: Object.keys(sources),
    });

    expect(Object.keys(plans)).toEqual(['Primary', 'Secondary', 'Orphan']);
    expect(plans.Primary?.paths[0]?.entryPoint?.sourcePath).toBe(primaryEntry);
    expect(plans.Secondary?.paths[0]?.entryPoint?.sourcePath).toBe(secondaryEntry);
    expect(plans.Orphan?.reachability).toBe('entry-unreachable');
    expect([...readCountByPath.values()]).toEqual([1, 1, 1]);
  });

  /** Keeps a selected page fast when an unrelated sibling export has no application owner. */
  it('does not widen a proven primary entry slice for an orphan secondary export', async () => {
    const sources: Record<string, string> = {
      [TARGET_PATH]: [
        'export const Primary = () => <article>primary</article>;',
        'export const Orphan = () => <article>orphan</article>;',
      ].join('\n'),
      [ENTRY_PATH]: [
        "import { createRoot } from 'react-dom/client';",
        "import { Primary } from './pages/SelectedPage';",
        'createRoot(document.body).render(<Primary />);',
      ].join('\n'),
    };
    for (let index = 0; index < 128; index += 1) {
      sources[`${ROOT}/noise/Feature${index.toString()}.tsx`] =
        `export const Feature${index.toString()} = () => <aside />;`;
    }
    const fixture = createFixture(sources);
    const readPaths: string[] = [];

    const plans = await createPreviewRenderChainPlans({
      documentPath: TARGET_PATH,
      exportNames: ['Primary', 'Orphan'],
      primaryExportName: 'Primary',
      readSource: async (sourcePath) => {
        readPaths.push(sourcePath);
        return fixture.readSource(sourcePath);
      },
      resolveModule: fixture.resolveModule,
      sourcePaths: Object.keys(sources),
    });

    expect(plans.Primary?.reachability).toBe('entry-connected');
    expect(plans.Orphan?.reachability).toBe('entry-unreachable');
    expect(readPaths.filter((sourcePath) => sourcePath.includes('/noise/'))).toEqual([]);
  });

  /** Keeps one export's depth cutoff from contaminating a short sibling export search. */
  it('isolates bounded traversal state between exports sharing the graph', async () => {
    const sources: Record<string, string> = {
      [TARGET_PATH]: [
        'export const Deep = () => <article>deep</article>;',
        'export const Shallow = () => <article>shallow</article>;',
      ].join('\n'),
      [ENTRY_PATH]: [
        "import { createRoot } from 'react-dom/client';",
        "import { Shallow } from './pages/SelectedPage';",
        'createRoot(document.body).render(<Shallow />);',
      ].join('\n'),
    };
    let childImport = "import { Deep } from './pages/SelectedPage';";
    let childName = 'Deep';
    for (let index = 0; index < 34; index += 1) {
      const ownerName = `DeepOwner${index.toString()}`;
      const ownerPath = `${ROOT}/DeepOwner${index.toString()}.tsx`;
      sources[ownerPath] = [
        childImport,
        `export const ${ownerName} = () => <${childName} />;`,
      ].join('\n');
      childImport = `import { ${ownerName} } from './DeepOwner${index.toString()}';`;
      childName = ownerName;
    }
    sources[`${ROOT}/deep-entry.tsx`] = [
      "import { createRoot } from 'react-dom/client';",
      childImport,
      `createRoot(document.body).render(<${childName} />);`,
    ].join('\n');
    const fixture = createFixture(sources);

    const plans = await createPreviewRenderChainPlans({
      documentPath: TARGET_PATH,
      exportNames: ['Deep', 'Shallow'],
      ...fixture,
      sourcePaths: Object.keys(sources),
    });

    expect(plans.Deep).toMatchObject({
      reachability: 'entry-unreachable',
      stopReason: 'graph-limit',
      truncated: true,
    });
    expect(plans.Shallow).toMatchObject({ reachability: 'entry-connected', truncated: false });
  });

  /** Aligns the render graph with the gallery's support for anonymous default declarations. */
  it('connects an anonymous default component declaration to its entry', async () => {
    const sources = {
      [TARGET_PATH]: 'export default function () { return <article />; }',
      [ENTRY_PATH]: [
        "import { createRoot } from 'react-dom/client';",
        "import SelectedPage from './pages/SelectedPage';",
        'createRoot(document.body).render(<SelectedPage />);',
      ].join('\n'),
    };
    const fixture = createFixture(sources);

    const plan = await createPreviewRenderChainPlan({
      documentPath: TARGET_PATH,
      exportName: 'default',
      ...fixture,
      sourcePaths: Object.keys(sources),
    });

    expect(plan.reachability).toBe('entry-connected');
    expect(plan.paths[0]?.steps.map((step) => step.label)).toEqual([
      'default',
      'create-root entry',
    ]);
  });

  /** Aligns static entry discovery with the gallery's supported CommonJS default assignment. */
  it('connects a CommonJS default component assignment to an ESM consumer entry', async () => {
    const commonJsTarget = `${ROOT}/pages/CommonJsPage.jsx`;
    const sources = {
      [commonJsTarget]: 'module.exports = function CommonJsPage() { return <article />; };',
      [ENTRY_PATH]: [
        "import { createRoot } from 'react-dom/client';",
        "import CommonJsPage from './pages/CommonJsPage';",
        'createRoot(document.body).render(<CommonJsPage />);',
      ].join('\n'),
    };
    const fixture = createFixture(sources);

    const plan = await createPreviewRenderChainPlan({
      documentPath: commonJsTarget,
      exportName: 'default',
      ...fixture,
      sourcePaths: Object.keys(sources),
    });

    expect(plan.reachability).toBe('entry-connected');
    expect(plan.paths[0]?.steps[0]?.label).toBe('CommonJsPage (default)');
  });

  /** Keeps nested HOC factories as explicit React invocation evidence on the target edge. */
  it('preserves memo and forwardRef wrappers between a component and its page owner', async () => {
    const hocPath = `${ROOT}/hocs.tsx`;
    const ownerPath = `${ROOT}/HocPage.tsx`;
    const sources = {
      [TARGET_PATH]: 'export const SelectedPage = () => <article />;',
      [hocPath]:
        'export const compose = (...wrappers) => (value) => value; export const withAuth = (value) => value;',
      [ownerPath]: [
        "import { forwardRef, memo } from 'react';",
        "import { compose, withAuth } from './hocs';",
        "import { SelectedPage } from './pages/SelectedPage';",
        'export const HocPage = compose(withAuth)(memo(forwardRef(SelectedPage)));',
      ].join('\n'),
      [ENTRY_PATH]: [
        "import { createRoot } from 'react-dom/client';",
        "import { HocPage } from './HocPage';",
        'createRoot(document.body).render(<HocPage />);',
      ].join('\n'),
    };
    const fixture = createFixture(sources);

    const plan = await createPreviewRenderChainPlan({
      documentPath: TARGET_PATH,
      exportName: 'SelectedPage',
      ...fixture,
      sourcePaths: Object.keys(sources),
    });

    expect(plan.reachability).toBe('entry-connected');
    expect(plan.paths[0]?.steps[0]?.invocation).toEqual({
      calleeName: 'compose',
      factoryNames: ['forwardRef', 'memo', 'compose'],
      mode: 'forward-ref',
      sourcePath: ownerPath,
    });
    expect(plan.paths[0]?.steps[0]?.evidenceSourcePaths).toEqual([hocPath]);
  });

  /** Distinguishes component, polymorphic, and render props instead of flattening them to values. */
  it('preserves component-valued JSX prop slots as separate candidate edges', async () => {
    const ownerPath = `${ROOT}/SlotPage.tsx`;
    const sources = {
      [TARGET_PATH]: 'export const SelectedPage = () => <article />;',
      [ownerPath]: [
        "import { memo } from 'react';",
        "import { SelectedPage } from './pages/SelectedPage';",
        'const Slot = (props) => <main />;',
        'export const SlotPage = () => (',
        '  <Slot component={memo(SelectedPage)} as={SelectedPage} renderItem={SelectedPage} />',
        ');',
      ].join('\n'),
      [ENTRY_PATH]: [
        "import { createRoot } from 'react-dom/client';",
        "import { SlotPage } from './SlotPage';",
        'createRoot(document.body).render(<SlotPage />);',
      ].join('\n'),
    };
    const fixture = createFixture(sources);

    const plan = await createPreviewRenderChainPlan({
      documentPath: TARGET_PATH,
      exportName: 'SelectedPage',
      ...fixture,
      sourcePaths: Object.keys(sources),
    });

    const invocations = plan.paths
      .map((candidate) => candidate.steps[0]?.invocation)
      .filter((invocation) => invocation !== undefined);
    expect(invocations).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ mode: 'component-prop', slotName: 'component' }),
        expect.objectContaining({ mode: 'polymorphic-prop', slotName: 'as' }),
        expect.objectContaining({ mode: 'render-prop', slotName: 'renderItem' }),
      ]),
    );
    expect(invocations.find((invocation) => invocation.slotName === 'component')).toMatchObject({
      factoryNames: ['memo'],
    });
  });

  /** Marks an inline JSX child callback as a deferred render contract owned by its receiver. */
  it('preserves inline render-function children as render-prop edges', async () => {
    const ownerPath = `${ROOT}/QueryPage.tsx`;
    const sources = {
      [TARGET_PATH]: 'export const SelectedPage = () => <article />;',
      [ownerPath]: [
        "import { SelectedPage } from './pages/SelectedPage';",
        'const QueryRenderer = ({ children }) => children({ data: {} });',
        'export const QueryPage = () => (',
        '  <QueryRenderer>{(result) => result.data && <SelectedPage />}</QueryRenderer>',
        ');',
      ].join('\n'),
      [ENTRY_PATH]: [
        "import { createRoot } from 'react-dom/client';",
        "import { QueryPage } from './QueryPage';",
        'createRoot(document.body).render(<QueryPage />);',
      ].join('\n'),
    };
    const fixture = createFixture(sources);

    const plan = await createPreviewRenderChainPlan({
      documentPath: TARGET_PATH,
      exportName: 'SelectedPage',
      ...fixture,
      sourcePaths: Object.keys(sources),
    });

    expect(plan.paths[0]?.steps[0]?.invocation).toEqual({
      calleeName: 'QueryRenderer',
      mode: 'render-prop',
      slotName: 'children',
      sourcePath: ownerPath,
    });
  });

  /** Crosses the same lazy page, route array, router object, app lazy map, and entry used by large apps. */
  it('finds the application entry through lazy and route configuration value flow', async () => {
    const sources = {
      [TARGET_PATH]: 'export default function SelectedPage() { return <article />; }',
      [PAGES_PATH]: [
        "import { lazy } from 'react';",
        "export const SelectedPage = lazy(() => import('./SelectedPage'));",
      ].join('\n'),
      [APP_PATH]: [
        "import { SelectedPage } from './pages';",
        "import { Route, RouterProvider, createBrowserRouter, createRoutesFromElements } from 'react-router-dom';",
        "import { Layout, RootLayout } from './layouts';",
        'const publicRoutes = [',
        '  <Route path="selected" element={<Layout><SelectedPage /></Layout>} />,',
        '];',
        'const router = createBrowserRouter(createRoutesFromElements(',
        '  <Route element={<RootLayout />}>{publicRoutes}</Route>,',
        '));',
        'export default function AppRouter() {',
        '  return <RouterProvider router={router} />;',
        '}',
      ].join('\n'),
      [LAYOUTS_PATH]: [
        'export const Layout = ({ children }) => <section>{children}</section>;',
        'export const RootLayout = () => <main />;',
      ].join('\n'),
      [ENTRY_PATH]: [
        "import { lazy } from 'react';",
        "import { createRoot } from 'react-dom/client';",
        "import { Boundary } from './Boundary';",
        "const LegalApp = lazy(() => import('./App'));",
        'const BUILD_TARGETS = { legal: LegalApp };',
        'const LoadableApp = BUILD_TARGETS[window.service];',
        "createRoot(document.getElementById('root')).render(",
        '  <Boundary><LoadableApp /></Boundary>,',
        ');',
      ].join('\n'),
    };
    const fixture = createFixture(sources);

    const plan = await createPreviewRenderChainPlan({
      documentPath: TARGET_PATH,
      exportName: 'default',
      ...fixture,
      sourcePaths: Object.keys(sources),
    });

    expect(plan.reachability).toBe('entry-connected');
    expect(plan.stopReason).toBeUndefined();
    expect(plan.paths).toHaveLength(1);
    expect(plan.paths[0]?.entryPoint).toMatchObject({
      kind: 'create-root',
      sourcePath: ENTRY_PATH,
    });
    expect(plan.paths[0]?.steps.map((step) => step.label)).toEqual([
      'SelectedPage (default)',
      'SelectedPage',
      'publicRoutes',
      'router',
      'AppRouter',
      'LegalApp',
      'BUILD_TARGETS',
      'LoadableApp',
      'create-root entry',
    ]);
    expect(plan.paths[0]?.steps.map((step) => step.kind)).toContain('react-lazy');
    expect(plan.paths[0]?.steps.map((step) => step.kind)).toContain('route-branch');
    expect(
      plan.paths[0]?.steps.find((step) => step.label === 'SelectedPage')?.wrapperNames,
    ).toEqual(['Layout', 'Route']);
    expect(
      plan.paths[0]?.steps.find((step) => step.label === 'SelectedPage')?.evidenceSourcePaths,
    ).toEqual([LAYOUTS_PATH]);
    expect(
      plan.paths[0]?.steps.find((step) => step.label === 'publicRoutes')?.wrapperNames,
    ).toEqual(['RootLayout', 'Route']);
    expect(plan.dependencyPaths).toEqual(
      [APP_PATH, ENTRY_PATH, LAYOUTS_PATH, PAGES_PATH, TARGET_PATH].sort(),
    );
  });

  /** Uses complete entry reachability before lexical/story filename scoring when branches compete. */
  it('ranks an entry-connected page ahead of a disconnected story owner', async () => {
    const pagePath = `${ROOT}/DashboardPage.tsx`;
    const storyPath = `${ROOT}/SelectedPage.stories.tsx`;
    const sources = {
      [TARGET_PATH]: 'export const SelectedPage = () => <article />;',
      [pagePath]: [
        "import { SelectedPage } from './pages/SelectedPage';",
        'export const DashboardPage = () => <SelectedPage />;',
      ].join('\n'),
      [storyPath]: [
        "import { SelectedPage } from './pages/SelectedPage';",
        'export const Story = () => <SelectedPage />;',
      ].join('\n'),
      [ENTRY_PATH]: [
        "import { createRoot } from 'react-dom/client';",
        "import { DashboardPage } from './DashboardPage';",
        'createRoot(document.body).render(<DashboardPage />);',
      ].join('\n'),
    };
    const fixture = createFixture(sources);

    const plan = await createPreviewRenderChainPlan({
      documentPath: TARGET_PATH,
      exportName: 'SelectedPage',
      ...fixture,
      sourcePaths: Object.keys(sources),
    });

    expect(plan.reachability).toBe('entry-connected');
    expect(plan.paths[0]?.steps.map((step) => step.sourcePath)).toContain(pagePath);
    expect(plan.paths[0]?.steps.map((step) => step.sourcePath)).not.toContain(storyPath);
  });

  /** Uses graph distance once both alternatives are proven application entries. */
  it('selects the shortest non-fixture application-entry path first', async () => {
    const shortEntryPath = `${ROOT}/short-main.tsx`;
    const longEntryPath = `${ROOT}/long-main.tsx`;
    const shellPath = `${ROOT}/Shell.tsx`;
    const pagePath = `${ROOT}/pages/LongPage.tsx`;
    const sources = {
      [TARGET_PATH]: 'export const SelectedPage = () => <article />;',
      [shortEntryPath]: [
        "import { createRoot } from 'react-dom/client';",
        "import { SelectedPage } from './pages/SelectedPage';",
        'createRoot(document.body).render(<SelectedPage />);',
      ].join('\n'),
      [longEntryPath]: [
        "import { createRoot } from 'react-dom/client';",
        "import { Shell } from './Shell';",
        'createRoot(document.body).render(<Shell />);',
      ].join('\n'),
      [shellPath]: [
        "import { LongPage } from './pages/LongPage';",
        'export const Shell = () => <LongPage />;',
      ].join('\n'),
      [pagePath]: [
        "import { SelectedPage } from './SelectedPage';",
        'export const LongPage = () => <SelectedPage />;',
      ].join('\n'),
    };
    const fixture = createFixture(sources);

    const plan = await createPreviewRenderChainPlan({
      documentPath: TARGET_PATH,
      exportName: 'SelectedPage',
      ...fixture,
      sourcePaths: Object.keys(sources),
    });

    expect(plan.paths[0]?.entryPoint?.sourcePath).toBe(shortEntryPath);
    expect(plan.paths[0]?.steps.map((step) => step.label)).toEqual([
      'SelectedPage',
      'create-root entry',
    ]);
  });

  /** Preserves distinct executable applications instead of silently choosing one monorepo entry. */
  it('reports ambiguity and retains multiple proven application entries', async () => {
    const firstEntry = '/workspace/apps/first/src/main.tsx';
    const secondEntry = '/workspace/apps/second/src/main.tsx';
    const sources = {
      [TARGET_PATH]: 'export function SelectedPage() { return <article />; }',
      [firstEntry]: [
        "import { createRoot } from 'react-dom/client';",
        "import { SelectedPage } from '../../../apps/web/src/pages/SelectedPage';",
        'createRoot(document.body).render(<SelectedPage />);',
      ].join('\n'),
      [secondEntry]: [
        "import { hydrateRoot } from 'react-dom/client';",
        "import { SelectedPage } from '../../../apps/web/src/pages/SelectedPage';",
        'hydrateRoot(document.body, <SelectedPage />);',
      ].join('\n'),
    };
    const fixture = createFixture(sources);

    const plan = await createPreviewRenderChainPlan({
      documentPath: TARGET_PATH,
      exportName: 'SelectedPage',
      ...fixture,
      sourcePaths: Object.keys(sources),
    });

    expect(plan.reachability).toBe('ambiguous');
    expect(plan.paths.map((candidate) => candidate.entryPoint?.sourcePath).sort()).toEqual([
      firstEntry,
      secondEntry,
    ]);
  });

  /** Distinguishes an orphan export from a semantic ReactDOM root reached with zero component owners. */
  it('marks an unused export entry-unreachable and keeps a standalone partial path', async () => {
    const sources = {
      [TARGET_PATH]: 'export default function SelectedPage() { return <article />; }',
      [ENTRY_PATH]: [
        "import { createRoot } from 'react-dom/client';",
        'const OtherApp = () => <main />;',
        'createRoot(document.body).render(<OtherApp />);',
      ].join('\n'),
    };
    const fixture = createFixture(sources);

    const plan = await createPreviewRenderChainPlan({
      documentPath: TARGET_PATH,
      exportName: 'default',
      ...fixture,
      sourcePaths: Object.keys(sources),
    });

    expect(plan.reachability).toBe('entry-unreachable');
    expect(plan.stopReason).toBe('entry-unreachable');
    expect(plan.paths[0]?.entryPoint).toBeUndefined();
    expect(plan.paths[0]?.steps.map((step) => step.label)).toEqual(['SelectedPage (default)']);
  });

  /** Falls back when a likely entry imports the target but does not actually render that value. */
  it('uses the reverse graph when the entry-first import path is not a render path', async () => {
    const hiddenEntryPath = `${ROOT}/ApplicationBootstrap.tsx`;
    const sources = {
      [TARGET_PATH]: 'export default function SelectedPage() { return <article />; }',
      [ENTRY_PATH]: [
        "import { createRoot } from 'react-dom/client';",
        "import SelectedPage from './pages/SelectedPage';",
        'const OtherPage = () => <main />;',
        'void SelectedPage;',
        'createRoot(document.body).render(<OtherPage />);',
      ].join('\n'),
      [hiddenEntryPath]: [
        "import { createRoot } from 'react-dom/client';",
        "import SelectedPage from './pages/SelectedPage';",
        'createRoot(document.body).render(<SelectedPage />);',
      ].join('\n'),
    };
    const fixture = createFixture(sources);

    const plan = await createPreviewRenderChainPlan({
      documentPath: TARGET_PATH,
      exportName: 'default',
      ...fixture,
      sourcePaths: Object.keys(sources),
    });

    expect(plan.reachability).toBe('entry-connected');
    expect(plan.paths[0]?.entryPoint?.sourcePath).toBe(hiddenEntryPath);
  });

  /** Falls back to exact project resolution for an arbitrary monorepo alias, then resumes cheaply. */
  it('connects a shared-package export through a non-suffix tsconfig alias', async () => {
    const sharedTarget = '/workspace/packages/ui/src/Target.tsx';
    const appPage = '/workspace/apps/web/src/Page.tsx';
    const appEntry = '/workspace/apps/web/src/main.tsx';
    const sources = {
      [sharedTarget]: 'export const Target = () => <article />;',
      [appPage]: [
        "import { Target } from '@acme/design-surface';",
        'export const Page = () => <main><Target /></main>;',
      ].join('\n'),
      [appEntry]: [
        "import { createRoot } from 'react-dom/client';",
        "import { Page } from './Page';",
        'createRoot(document.body).render(<Page />);',
      ].join('\n'),
    };
    const fixture = createFixture(sources);

    const plan = await createPreviewRenderChainPlan({
      documentPath: sharedTarget,
      exportName: 'Target',
      readSource: fixture.readSource,
      resolveModule: (specifier, consumerPath) =>
        specifier === '@acme/design-surface'
          ? sharedTarget
          : fixture.resolveModule(specifier, consumerPath),
      sourcePaths: Object.keys(sources),
    });

    expect(plan.reachability).toBe('entry-connected');
    expect(plan.paths[0]?.steps.map((step) => step.label)).toEqual([
      'Target',
      'Page',
      'create-root entry',
    ]);
  });

  /** Preserves the exact named export selected by a common React.lazy `.then` adapter. */
  it('follows a named export selected by a lazy loader adapter', async () => {
    const namedTarget = `${ROOT}/NamedTarget.tsx`;
    const lazyPage = `${ROOT}/LazyPage.tsx`;
    const sources = {
      [namedTarget]: 'export const NamedTarget = () => <article />;',
      [lazyPage]: [
        "import { lazy } from 'react';",
        'export const LazyTarget = lazy(() =>',
        "  import('./NamedTarget').then((module) => ({ default: module.NamedTarget })),",
        ');',
      ].join('\n'),
      [ENTRY_PATH]: [
        "import { createRoot } from 'react-dom/client';",
        "import { LazyTarget } from './LazyPage';",
        'createRoot(document.body).render(<LazyTarget />);',
      ].join('\n'),
    };
    const fixture = createFixture(sources);

    const plan = await createPreviewRenderChainPlan({
      documentPath: namedTarget,
      exportName: 'NamedTarget',
      ...fixture,
      sourcePaths: Object.keys(sources),
    });

    expect(plan.reachability).toBe('entry-connected');
    expect(plan.paths[0]?.steps.map((step) => step.kind)).toContain('react-lazy');
    expect(plan.paths[0]?.steps.map((step) => step.label)).toEqual([
      'NamedTarget',
      'LazyTarget',
      'create-root entry',
    ]);
  });
});
