/** Verifies syntax-only target route inference for detached application-shell previews. */
import { describe, expect, it } from 'vitest';
import {
  collectPreviewInspectorRouteLocation,
  type CollectPreviewInspectorRouteLocationOptions,
} from '../../../../src/adapters/esbuild/inspector';
import type { PreviewRenderChainPlan } from '../../../../src/adapters/esbuild/renderGraph';

const TARGET_PATH = '/workspace/application/src/pages/investment-contract-analysis-page.tsx';
const APP_PATH = '/workspace/application/src/App.tsx';
const PAGE_MAP_PATH = '/workspace/application/src/pages-map.ts';
const PAGE_CATALOG_PATH = '/workspace/application/src/pages.json';

/** Creates the smallest entry-connected graph needed by the route analyzer. */
function createRenderChain(
  stepSourcePath = APP_PATH,
  targetPath = TARGET_PATH,
  targetLabel = 'InvestmentContractAnalysisPage',
): PreviewRenderChainPlan {
  return {
    dependencyPaths: [TARGET_PATH, stepSourcePath],
    paths: [
      {
        entryPoint: {
          kind: 'create-root',
          occurrenceStart: 100,
          sourcePath: APP_PATH,
          wrapperNames: [],
        },
        id: 'analysis-page-path',
        steps: [
          {
            certainty: 'confirmed',
            kind: 'component-render',
            label: targetLabel,
            occurrenceStart: 20,
            sourcePath: stepSourcePath,
            wrapperNames: [],
          },
        ],
      },
    ],
    reachability: 'entry-connected',
    target: { exportName: 'default', sourcePath: targetPath },
    truncated: false,
  };
}

/** Creates a virtual, snapshot-like source reader without touching the host filesystem. */
function createOptions(
  sources: Readonly<Record<string, string>>,
  renderChain = createRenderChain(),
): CollectPreviewInspectorRouteLocationOptions {
  return {
    documentPath: renderChain.target.sourcePath,
    exportName: 'default',
    readSource: (sourcePath) => Promise.resolve(sources[sourcePath]),
    renderChain,
    sourcePaths: Object.keys(sources).filter((sourcePath) => !sourcePath.endsWith('.json')),
  };
}

describe('collectPreviewInspectorRouteLocation', () => {
  /** Mirrors a common generated page map where a guarded default export has a named local page. */
  it('reads a relative JSON page catalog and materializes dynamic parameters', async () => {
    const sources = {
      [TARGET_PATH]: [
        'function InvestmentContractAnalysisPage() { return <main />; }',
        'export default withGuard(InvestmentContractAnalysisPage);',
      ].join('\n'),
      [APP_PATH]: 'export function App() { return <main />; }',
      [PAGE_MAP_PATH]: 'import pages from "./pages.json"; export const pageMap = pages;',
      [PAGE_CATALOG_PATH]: JSON.stringify({
        company: {
          ':companyId(\\d+)': {
            'investment-contract-rtcc': { analysis: 'InvestmentContractAnalysisPage' },
          },
        },
      }),
    };

    const location = await collectPreviewInspectorRouteLocation(createOptions(sources));

    expect(location).toEqual({
      componentName: 'InvestmentContractAnalysisPage',
      dependencyPaths: [PAGE_CATALOG_PATH, PAGE_MAP_PATH].sort(),
      evidenceKind: 'route-catalog',
      pathname: '/company/1/investment-contract-rtcc/analysis',
      pattern: '/company/:companyId(\\d+)/investment-contract-rtcc/analysis',
      sourcePath: PAGE_CATALOG_PATH,
    });
  });

  /** Supports ordinary nested React Router JSX when a project has no static JSON route map. */
  it('joins nested JSX Route paths and uses a visible neutral string parameter', async () => {
    const routesPath = '/workspace/application/src/routes.tsx';
    const sources = {
      [TARGET_PATH]: 'export function InvestmentContractAnalysisPage() { return <main />; }',
      [routesPath]: [
        'const routes = <Routes>',
        '  <Route path="/workspace/:workspaceId">',
        '    <Route path="analysis" element={<InvestmentContractAnalysisPage />} />',
        '  </Route>',
        '</Routes>;',
      ].join('\n'),
    };
    const renderChain = createRenderChain(routesPath);

    const location = await collectPreviewInspectorRouteLocation(
      createOptions(sources, renderChain),
    );

    expect(location).toMatchObject({
      evidenceKind: 'route-jsx',
      pathname: '/workspace/preview/analysis',
      pattern: '/workspace/:workspaceId/analysis',
      sourcePath: routesPath,
    });
  });

  /** Composes a relative JSX route with the absolute base authored by an app-module factory. */
  it('prepends an enclosing application module base path to a relative Route', async () => {
    const routesPath = '/workspace/application/src/feature-app.tsx';
    const sources = {
      [TARGET_PATH]:
        'export default function InvestmentContractAnalysisPage() { return <main />; }',
      [routesPath]: [
        'export const FeatureApp = createAppModule(',
        '  "/company/:companyId(\\\\d+)/contracts",',
        '  {},',
        '  [],',
        '  () => <Routes>',
        '    <Route path="analysis-preview" element={<InvestmentContractAnalysisPage />} />',
        '  </Routes>,',
        ');',
      ].join('\n'),
    };
    const renderChain = createRenderChain(routesPath);

    const location = await collectPreviewInspectorRouteLocation(
      createOptions(sources, renderChain),
    );

    expect(location).toMatchObject({
      evidenceKind: 'route-jsx',
      pathname: '/company/1/contracts/analysis-preview',
      pattern: '/company/:companyId(\\d+)/contracts/analysis-preview',
      sourcePath: routesPath,
    });
  });

  /**
   * Merges an outer useRoutes splat with the selected app module's stricter factory base path.
   * This reproduces the partner application shape that previously became `/preview/preview`.
   */
  it('merges same-name parameter constraints across an object route and target base path', async () => {
    const targetPath = '/workspace/application/src/staff/partner-staff-app.tsx';
    const sources = {
      [targetPath]: [
        'export const PartnerStaffApp = createAppModule(',
        '  "/partner/:legalPartnerId(\\\\d+)",',
        '  {}, [], ({ pageRoutes }) => <Routes>{pageRoutes}</Routes>,',
        ');',
      ].join('\n'),
      [APP_PATH]: [
        'import { useRoutes } from "react-router-dom";',
        'const appRoutes = [',
        '  { path: "partner/:legalPartnerId/*", element: <PartnerStaffApp /> },',
        '  { path: "*", element: <NotFoundPage /> },',
        '];',
        'export default function App() { return useRoutes(appRoutes); }',
      ].join('\n'),
    };
    const renderChain = createRenderChain(APP_PATH, targetPath, 'PartnerStaffApp');

    const location = await collectPreviewInspectorRouteLocation(
      createOptions(sources, renderChain),
    );

    expect(location).toEqual({
      componentName: 'PartnerStaffApp',
      dependencyPaths: [APP_PATH, targetPath].sort(),
      evidenceKind: 'route-jsx',
      pathname: '/partner/1',
      pattern: '/partner/:legalPartnerId/*',
      sourcePath: APP_PATH,
    });
  });

  /** Uses a proven concrete child route instead of inventing a `preview` splat segment. */
  it('materializes an outer wildcard with a compatible concrete child route', async () => {
    const targetPath = '/workspace/application/src/workspace-shell.tsx';
    const sources = {
      [targetPath]: 'export function WorkspaceShell() { return <Outlet />; }',
      [APP_PATH]: [
        'import { useRoutes } from "react-router-dom";',
        'const routes = [',
        '  { path: "/workspace/:workspaceId/*", element: <WorkspaceShell /> },',
        '  { path: "/workspace/:workspaceId/dashboard", element: <Dashboard /> },',
        '];',
        'export default function App() { return useRoutes(routes); }',
      ].join('\n'),
    };
    const renderChain = createRenderChain(APP_PATH, targetPath, 'WorkspaceShell');

    const location = await collectPreviewInspectorRouteLocation(
      createOptions(sources, renderChain),
    );

    expect(location).toMatchObject({
      pathname: '/workspace/preview/dashboard',
      pattern: '/workspace/:workspaceId/*',
      sourcePath: APP_PATH,
    });
  });

  /** Ignores path-shaped component configuration that is not owned by a React Router API. */
  it('does not treat arbitrary path and element objects as route descriptors', async () => {
    const sources = {
      [TARGET_PATH]: 'export function InvestmentContractAnalysisPage() { return <main />; }',
      [APP_PATH]: [
        'const panel = {',
        '  path: "/misleading",',
        '  element: <InvestmentContractAnalysisPage />,',
        '};',
        'export default function App() { return <Shell panel={panel} />; }',
      ].join('\n'),
    };

    await expect(
      collectPreviewInspectorRouteLocation(createOptions(sources)),
    ).resolves.toBeUndefined();
  });

  /** Resolves a monorepo alias catalog before a broad ancestor wildcard can invent a preview URL. */
  it('prefers a target-local alias JSON page catalog in a large monorepo', async () => {
    const targetPath =
      '/workspace/application/src/staff/calendar-event/calendar-event-list-page.tsx';
    const staffPageMapPath = '/workspace/application/src/staff/pages-map.ts';
    const staffCatalogPath = '/workspace/application/src/staff/pages.json';
    const unrelatedRegistries = Object.fromEntries(
      Array.from({ length: 48 }, (_value, index) => {
        const prefix = String(index).padStart(2, '0');
        return [
          `/workspace/application/src/a${prefix}/pages-map.ts`,
          `import pages from "./pages.json"; export default pages;`,
        ];
      }),
    );
    const sources: Record<string, string> = {
      ...unrelatedRegistries,
      [targetPath]: 'export default function CalendarEventListPage() { return <main />; }',
      [APP_PATH]: [
        '<Routes>',
        '  <Route path="/preview/*" element={<CalendarEventListPage />} />',
        '</Routes>',
      ].join('\n'),
      [staffPageMapPath]: 'import pages from "staff/pages.json"; export const pageMap = pages;',
      [staffCatalogPath]: JSON.stringify({
        'calendar-event': { index: 'CalendarEventListPage' },
      }),
    };
    const renderChain = createRenderChain(APP_PATH, targetPath, 'CalendarEventListPage');

    const location = await collectPreviewInspectorRouteLocation({
      documentPath: targetPath,
      exportName: 'default',
      readSource: (sourcePath) => Promise.resolve(sources[sourcePath]),
      renderChain,
      resolveModule: (moduleSpecifier) =>
        moduleSpecifier === 'staff/pages.json' ? staffCatalogPath : undefined,
      sourcePaths: Object.keys(sources).filter((sourcePath) => !sourcePath.endsWith('.json')),
    });

    expect(location).toEqual({
      componentName: 'CalendarEventListPage',
      dependencyPaths: [APP_PATH, staffCatalogPath, staffPageMapPath].sort(),
      evidenceKind: 'route-catalog',
      pathname: '/calendar-event',
      pattern: '/calendar-event',
      sourcePath: staffCatalogPath,
    });
  });
});
