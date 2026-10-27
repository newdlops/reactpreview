/** Generic, non-executable factory/Provider sources for route-owner default-selection regression. */
import path from 'node:path';
import type { CollectPreviewInspectorRouteBranchPlanOptions } from '../../../../src/adapters/esbuild/inspector/previewInspectorRouteBranchPlan';
import type { PreviewRenderChainPlan } from '../../../../src/adapters/esbuild/renderGraph';

const root = '/workspace/src';
const sources: Record<string, string> = {
  [`${root}/root-app.tsx`]: [
    'import { createModule } from "./make-module";',
    'import { AreaApp } from "./area-app";',
    'export const RootApp = createModule("/root", {}, [AreaApp], ({ pageRoutes, moduleRoutes }) => <Routes>{pageRoutes}{moduleRoutes}</Routes>);',
  ].join('\n'),
  [`${root}/area-app.tsx`]: [
    'import { createModule } from "./make-module";',
    'import { DetailApp } from "./detail-app";',
    'export const AreaApp = createModule("/root/:areaId(\\\\d+)", {}, [DetailApp], ({ pageRoutes, moduleRoutes }) => <Routes>{pageRoutes}{moduleRoutes}</Routes>);',
  ].join('\n'),
  [`${root}/detail-app.tsx`]: [
    'import { createModule } from "./make-module";',
    'import { PreviewPage } from "./preview-page";',
    'import { EditPage } from "./edit-page";',
    'import { DetailProvider } from "./detail-provider";',
    'export const DetailApp = createModule("/root/:areaId(\\\\d+)/detail/:kind/:detailId(\\\\d+)", { PreviewPage, EditPage }, [], ({ pageRoutes }) => <DetailProvider><Routes>{pageRoutes}<Route path="*" element={<NotFound />} /></Routes></DetailProvider>);',
  ].join('\n'),
  [`${root}/detail-provider.tsx`]:
    'export function DetailProvider({ children }) { return <Context.Provider value={{}}>{children}</Context.Provider>; }',
  [`${root}/preview-page.tsx`]: 'export const PreviewPage = () => <main>preview</main>;',
  [`${root}/edit-page.tsx`]: 'export const EditPage = () => <main>edit</main>;',
  [`${root}/make-module.ts`]: [
    'import { createModuleBase } from "./make-module-base";',
    'import { pageMap } from "./page-map";',
    'export const createModule = createModuleBase(pageMap);',
  ].join('\n'),
  [`${root}/make-module-base.tsx`]: [
    'export const createModuleBase = (catalog) => (basePath, pages, modules, Component) =>',
    '  withProps({ pageRoutes: Object.entries(pages).map(([name, Page]) => <Route />), moduleRoutes: modules.map((App) => <Route />) })(Component);',
  ].join('\n'),
  [`${root}/page-map.ts`]:
    'import pages from "./pages.json"; export const pageMap = invert(pages);',
  [`${root}/pages.json`]: JSON.stringify({
    root: {
      ':areaId(\\d+)': {
        detail: { ':kind': { ':detailId(\\d+)': { preview: 'PreviewPage', edit: 'EditPage' } } },
      },
    },
  }),
};
const resolveModule = (specifier: string, importer: string): string | undefined => {
  const base = path.resolve(path.dirname(importer), specifier);
  return ['', '.ts', '.tsx', '.json']
    .map((suffix) => base + suffix)
    .find((candidate) => Object.hasOwn(sources, candidate));
};
const sourcePaths = Object.keys(sources);
const readSource = (candidate: string): Promise<string | undefined> =>
  Promise.resolve(sources[candidate]);
const chain: PreviewRenderChainPlan = {
  dependencyPaths: sourcePaths,
  paths: [
    {
      id: 'synthetic-source-only-provider-chain',
      steps: (
        [
          ['DetailProvider', 'detail-provider.tsx'],
          ['DetailApp', 'detail-app.tsx'],
          ['AreaApp', 'area-app.tsx'],
          ['RootApp', 'root-app.tsx'],
        ] as const
      ).map(([label, basename]) => ({
        certainty: 'conditional' as const,
        kind: 'component-render' as const,
        label,
        occurrenceStart: 0,
        sourcePath: `${root}/${basename}`,
        wrapperNames: [],
      })),
    },
  ],
  reachability: 'entry-unreachable',
  stopReason: 'entry-not-found',
  target: { exportName: 'DetailProvider', sourcePath: `${root}/detail-provider.tsx` },
  truncated: false,
};
/** Absolute virtual source root shared only by these deterministic fixtures. */
export const FACTORY_ROUTE_SOURCE_ROOT = root;

/** Creates source-only planner inputs without importing or evaluating fixture application code. */
export function createFactoryProviderRouteOptions(): CollectPreviewInspectorRouteBranchPlanOptions {
  return {
    documentPath: `${root}/detail-provider.tsx`,
    exportName: 'DetailProvider',
    renderChain: chain,
    readSource,
    resolveModule,
    sourcePaths,
  };
}
