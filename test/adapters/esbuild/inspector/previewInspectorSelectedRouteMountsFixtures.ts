/** Models a source-backed factory checkpoint whose selected page needs an inner route owner. */
import { mkdir, realpath, writeFile } from 'node:fs/promises';
import path from 'node:path';
import type { PreviewInspectorRouteSelectionStep } from '../../../../src/domain/preview';
import type { PreviewInspectorAncestorPlan } from '../../../../src/adapters/esbuild/inspector/previewInspectorAncestorTypes';

type FixtureName =
  'RootApp' | 'AreaApp' | 'DetailApp' | 'DetailProvider' | 'PreviewPage' | 'RootLayout';

/** Inert compiler evidence and authored text; no fixture application module is imported. */
export interface SelectedRouteMountFixture {
  /** Canonical source identities shared by source readers, surfaces, and export validation. */
  readonly paths: Readonly<Record<FixtureName, string>>;
  /** Validated analyzer-stage shape for the shared current-file checkpoint and outer frame. */
  readonly plan: PreviewInspectorAncestorPlan;
  /** Exact root-relative route selection offered by this factory's public inventory. */
  readonly selection: readonly PreviewInspectorRouteSelectionStep[];
  /** Fixture source used by the prepared module contracts without evaluating a factory. */
  readonly sourceByPath: ReadonlyMap<string, string>;
}

/** Writes a bounded local source model matching the captured factory/VirtualPage role structure. */
export async function createSelectedRouteMountFixture(
  workspaceRoot: string,
): Promise<SelectedRouteMountFixture> {
  await mkdir(workspaceRoot, { recursive: true });
  const root = await realpath(workspaceRoot);
  const names: readonly FixtureName[] = [
    'RootApp',
    'AreaApp',
    'DetailApp',
    'DetailProvider',
    'PreviewPage',
    'RootLayout',
  ];
  const paths = Object.fromEntries(
    names.map((name) => [name, path.join(root, name + '.tsx')]),
  ) as Record<FixtureName, string>;
  const sources: Record<FixtureName, string> = {
    RootApp:
      'import { AreaApp } from "./AreaApp"; import { RootLayout } from "./RootLayout"; export const RootApp = createModule("/root", {}, [AreaApp], ({ pageRoutes, moduleRoutes }) => <RootLayout><Routes>{pageRoutes}{moduleRoutes}</Routes></RootLayout>);',
    AreaApp:
      'import { DetailApp } from "./DetailApp"; export const AreaApp = createModule("/root/:areaId(\\\\d+)", {}, [DetailApp], ({ pageRoutes, moduleRoutes }) => <main><Routes>{pageRoutes}{moduleRoutes}</Routes></main>);',
    DetailApp:
      'import { DetailProvider } from "./DetailProvider"; import { PreviewPage } from "./PreviewPage"; export const DetailApp = createModule("/root/:areaId(\\\\d+)/detail/:id(\\\\d+)", { PreviewPage }, [], ({ pageRoutes }) => <DetailProvider><Routes>{pageRoutes}</Routes></DetailProvider>);',
    DetailProvider:
      'export function DetailProvider({ children }) { return <Context.Provider value={{}}>{children}</Context.Provider>; }',
    PreviewPage: 'export function PreviewPage() { return <article>Selected page body</article>; }',
    RootLayout:
      'export function RootLayout({ children }) { return <div><header>Root navigation</header>{children}</div>; }',
  };
  for (const name of ['RootApp', 'AreaApp', 'DetailApp'] as const) {
    sources[name] = 'import { Routes } from "react-router-dom"; ' + sources[name];
  }
  const sourceByPath = new Map(names.map((name) => [paths[name], sources[name]]));
  await Promise.all([...sourceByPath].map(([sourcePath, source]) => writeFile(sourcePath, source)));
  const basePattern = String.raw`/root/:areaId(\d+)/detail/:id(\d+)`;
  const leafPattern = basePattern + '/preview';
  const routeLocation = {
    componentExportName: 'PreviewPage',
    componentName: 'PreviewPage',
    componentSourcePath: paths.PreviewPage,
    dependencyPaths: Object.values(paths),
    evidenceKind: 'route-catalog',
    pathname: '/root/1/detail/1/preview',
    pattern: leafPattern,
    sourcePath: paths.DetailApp,
    routeMounts: [
      {
        basePath: basePattern,
        contextPattern: basePattern,
        exportName: 'DetailApp',
        hasWildcardFallback: true,
        routeSlotCount: 1,
        sourcePath: paths.DetailApp,
      },
    ],
  };
  const renderPath = {
    id: 'source-backed-shared-checkpoint',
    entryPoint: {
      kind: 'create-root',
      occurrenceStart: 0,
      sourcePath: path.join(root, 'main.tsx'),
      wrapperNames: [],
    },
    steps: ['DetailProvider', 'DetailApp', 'AreaApp', 'RootApp'].map((name) => ({
      certainty: 'conditional',
      kind: 'route-branch',
      label: name,
      occurrenceStart: 0,
      sourcePath: paths[name as FixtureName],
      wrapperNames: [],
    })),
  };
  const common = {
    complete: true,
    dependencyPaths: Object.values(paths),
    edges: [],
    renderPath,
    rootAutomaticProps: {},
    rootOwnsRouter: false,
    routeLocation,
    stopReason: 'root-reached',
    targetAutomaticProps: {},
    target: { sourcePath: paths.PreviewPage, exportName: 'PreviewPage' },
  };
  const plan = {
    ...common,
    root: { sourcePath: paths.RootApp, exportName: 'RootApp' },
    target: { sourcePath: paths.DetailProvider, exportName: 'DetailProvider' },
    renderChain: {
      paths: [renderPath],
      dependencyPaths: Object.values(paths),
      reachability: 'entry-connected',
      truncated: false,
    },
    renderChainsByExport: {},
    pageCandidates: [
      {
        ...common,
        id: 'root-owner',
        rootStepIndex: 3,
        root: { sourcePath: paths.RootApp, exportName: 'RootApp' },
      },
      {
        ...common,
        id: 'area-checkpoint',
        complete: false,
        stopReason: 'render-path-checkpoint',
        rootStepIndex: 2,
        root: { sourcePath: paths.AreaApp, exportName: 'AreaApp' },
      },
    ],
    routeSelectionResolution: 'exact',
    shallowVisualPaths: [
      {
        exportName: 'RootLayout',
        importerPath: paths.RootApp,
        importKind: 'static',
        localEdges: [],
        moduleSpecifier: './RootLayout',
        occurrenceStart: sources.RootApp.indexOf('<RootLayout>'),
        relation: 'sibling',
        renderedLocalName: 'RootLayout',
        renderBoundaryStart: 0,
        selectedChildPath: paths.AreaApp,
        sourcePath: paths.RootLayout,
      },
    ],
  } as unknown as PreviewInspectorAncestorPlan;
  return {
    paths,
    plan,
    sourceByPath,
    selection: [
      { componentName: 'DetailApp', pattern: basePattern },
      { componentName: 'PreviewPage', pattern: leafPattern },
    ],
  };
}
