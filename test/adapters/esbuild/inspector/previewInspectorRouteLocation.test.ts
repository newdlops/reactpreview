/** Verifies syntax-only target route inference for detached application-shell previews. */
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  collectPreviewInspectorDirectRouteChoices,
  collectPreviewInspectorRouteBranchPlan,
  collectPreviewInspectorRouteLocation,
  collectPreviewInspectorRouteLocationInventory,
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
  targetExportName = 'default',
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
    target: { exportName: targetExportName, sourcePath: targetPath },
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
    exportName: renderChain.target.exportName,
    readSource: (sourcePath) => Promise.resolve(sources[sourcePath]),
    renderChain,
    resolveModule: (specifier, importer) => {
      if (!specifier.startsWith('.')) return undefined;
      const candidate = path.resolve(path.dirname(importer), specifier);
      return [candidate, `${candidate}.ts`, `${candidate}.tsx`, `${candidate}.json`].find(
        (sourcePath) => Object.hasOwn(sources, sourcePath),
      );
    },
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
  it('joins nested JSX Route paths and materializes semantic identifier parameters', async () => {
    const routesPath = '/workspace/application/src/routes.tsx';
    const sources = {
      [TARGET_PATH]:
        'export default function InvestmentContractAnalysisPage() { return <main />; }',
      [routesPath]: [
        'import InvestmentContractAnalysisPage from "./pages/investment-contract-analysis-page";',
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
      pathname: '/workspace/1/analysis',
      pattern: '/workspace/:workspaceId/analysis',
      sourcePath: routesPath,
    });
  });

  /** Prefers a target-near v5 child Route over the outer shell that merely owns `/patients`. */
  it('recognizes a component rendered as the child of a React Router v5 Route', async () => {
    const targetPath = '/workspace/application/src/patients/ViewCareGoal.tsx';
    const routesPath = '/workspace/application/src/HospitalRun.tsx';
    const sources = {
      [targetPath]: 'export default function ViewCareGoal() { return <form />; }',
      [routesPath]: [
        'import ViewCareGoal from "./patients/ViewCareGoal";',
        '<Switch>',
        '  <Route path="/patients" component={Patients} />',
        '  <Route path="/patients/:id/care-goals/:careGoalId">',
        '    <ViewCareGoal />',
        '  </Route>',
        '</Switch>',
      ].join('\n'),
    };
    const baseRenderChain = createRenderChain(routesPath, targetPath, 'ViewCareGoal');
    const basePath = baseRenderChain.paths[0];
    if (basePath === undefined) throw new Error('The route fixture requires one render path.');
    const renderChain: PreviewRenderChainPlan = {
      ...baseRenderChain,
      paths: [
        {
          ...basePath,
          steps: [
            {
              certainty: 'confirmed',
              kind: 'component-render',
              label: 'ViewCareGoal',
              occurrenceStart: 10,
              sourcePath: routesPath,
              wrapperNames: [],
            },
            {
              certainty: 'confirmed',
              kind: 'component-render',
              label: 'Patients',
              occurrenceStart: 30,
              sourcePath: routesPath,
              wrapperNames: [],
            },
          ],
        },
      ],
    };

    const location = await collectPreviewInspectorRouteLocation(
      createOptions(sources, renderChain),
    );

    expect(location).toMatchObject({
      componentName: 'ViewCareGoal',
      pathname: '/patients/1/care-goals/1',
      pattern: '/patients/:id/care-goals/:careGoalId',
      sourcePath: routesPath,
    });
  });

  /** Recovers the outer v5 route when the selected leaf is rendered inside its page component. */
  it('uses a proven routed render ancestor instead of the sibling catch-all route', async () => {
    const targetPath = '/workspace/application/src/Project/IssueCreate.tsx';
    const projectPath = '/workspace/application/src/Project/index.tsx';
    const routesPath = '/workspace/application/src/App/Routes.tsx';
    const pageErrorPath = '/workspace/application/src/PageError.tsx';
    const sources = {
      [targetPath]: 'export default function IssueCreate() { return <form />; }',
      [projectPath]: [
        'import IssueCreate from "./IssueCreate";',
        'export default function Project() {',
        '  return <Modal renderContent={() => <IssueCreate />} />;',
        '}',
      ].join('\n'),
      [routesPath]: [
        'import Project from "../Project/index";',
        'import PageError from "../PageError";',
        '<Switch>',
        '  <Route path="/project" component={Project} />',
        '  <Route component={PageError} />',
        '</Switch>;',
      ].join('\n'),
      [pageErrorPath]: 'export default function PageError() { return <main>error</main>; }',
    };
    const renderChain: PreviewRenderChainPlan = {
      dependencyPaths: [targetPath, projectPath, routesPath],
      paths: [
        {
          entryPoint: {
            kind: 'create-root',
            occurrenceStart: 100,
            sourcePath: routesPath,
            wrapperNames: [],
          },
          id: 'issue-create-path',
          steps: [
            {
              certainty: 'conditional',
              kind: 'route-branch',
              label: 'IssueCreate (default)',
              occurrenceStart: 20,
              sourcePath: targetPath,
              wrapperNames: ['Modal'],
            },
            {
              certainty: 'conditional',
              kind: 'route-branch',
              label: 'Project',
              occurrenceStart: 40,
              sourcePath: projectPath,
              wrapperNames: ['Route', 'Switch'],
            },
          ],
        },
      ],
      reachability: 'entry-connected',
      target: { exportName: 'default', sourcePath: targetPath },
      truncated: false,
    };

    const location = await collectPreviewInspectorRouteLocation(
      createOptions(sources, renderChain),
    );

    expect(location).toMatchObject({
      componentName: 'Project',
      componentSourcePath: projectPath,
      pathname: '/project',
      pattern: '/project',
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
        'import InvestmentContractAnalysisPage from "./pages/investment-contract-analysis-page";',
        'const FEATURE_BASE_PATH = "/company/:companyId(\\\\d+)/contracts";',
        'export const FeatureApp = createAppModule(',
        '  FEATURE_BASE_PATH,',
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
   * Expands a selected Provider/Routes factory owner into its catalog-backed visible page paths.
   *
   * The fixture mirrors the generic contract where a factory receives an absolute base, page-map
   * object, submodule array, and JSX wrapper callback; no factory implementation is executed.
   */
  it('keeps factory page choices unresolved without factory-to-catalog provenance', async () => {
    const routerPath = '/workspace/application/src/feature/feature-app.tsx';
    const dashboardPath = '/workspace/application/src/feature/dashboard-page.tsx';
    const settingsPath = '/workspace/application/src/feature/settings-page.tsx';
    const layoutPath = '/workspace/application/src/feature/feature-layout.tsx';
    const renderChain = createRenderChain(APP_PATH, routerPath, 'FeatureApp');
    const sources = {
      [routerPath]: [
        'import { DashboardPage } from "./dashboard-page";',
        'import { SettingsPage as LazySettingsPage } from "./settings-page";',
        'import { FeatureLayout } from "./feature-layout";',
        'const FEATURE_BASE_PATH = "/workspace/:workspaceId(\\\\d+)/feature";',
        'const featurePages = {',
        '  DashboardPage: compose(FeatureLayout, DashboardPage),',
        '  SettingsPage: LazySettingsPage,',
        '};',
        'export const FeatureApp = createAppModule(',
        '  FEATURE_BASE_PATH,',
        '  featurePages,',
        '  [],',
        '  ({ pageRoutes, subModuleRoutes }) => (',
        '    <Provider><Routes>{pageRoutes}{subModuleRoutes}</Routes></Provider>',
        '  ),',
        ');',
      ].join('\n'),
      [dashboardPath]: 'export function DashboardPage() { return <main />; }',
      [settingsPath]: 'export function SettingsPage() { return <main />; }',
      [layoutPath]:
        'export function FeatureLayout({ children }) { return <section>{children}</section>; }',
      [APP_PATH]:
        '<Routes><Route path="/workspace/:workspaceId/*" element={<FeatureApp />} /></Routes>',
      [PAGE_MAP_PATH]: 'import pages from "./pages.json"; export const pageMap = pages;',
      [PAGE_CATALOG_PATH]: JSON.stringify({
        workspace: {
          ':workspaceId(\\d+)': {
            feature: {
              index: 'DashboardPage',
              settings: 'SettingsPage',
            },
          },
        },
      }),
    };

    const inventory = await collectPreviewInspectorRouteLocationInventory({
      ...createOptions(sources, renderChain),
      exportName: 'FeatureApp',
      resolveModule: (moduleSpecifier) =>
        moduleSpecifier === './dashboard-page'
          ? dashboardPath
          : moduleSpecifier === './settings-page'
            ? settingsPath
            : moduleSpecifier === './feature-layout'
              ? layoutPath
              : undefined,
    });

    expect(inventory.primary).toMatchObject({
      componentName: 'FeatureApp',
      pathname: '/workspace/1/feature',
    });
    expect(inventory.choices).toEqual([]);
    expect(inventory.unresolvedFactoryRoutes).toBe(true);
    expect(inventory.unresolvedFactoryOptionNames).toEqual(['DashboardPage', 'SettingsPage']);
    expect(inventory.unresolvedFactoryOptions).toEqual([
      expect.objectContaining({
        availability: 'factory-contract-unresolved',
        componentName: 'DashboardPage',
        kind: 'page',
      }),
      expect.objectContaining({
        availability: 'factory-contract-unresolved',
        componentName: 'SettingsPage',
        kind: 'page',
      }),
    ]);
  });

  /** A direct default-exported factory has no local owner name but still owns selectable pages. */
  it('keeps default-exported factory choices unresolved without catalog provenance', async () => {
    const routerPath = '/workspace/application/src/feature/default-feature-app.tsx';
    const dashboardPath = '/workspace/application/src/feature/dashboard-page.tsx';
    const renderChain = createRenderChain(APP_PATH, routerPath, 'DefaultFeatureApp');
    const sources = {
      [routerPath]: [
        'import DashboardPage from "./dashboard-page";',
        'export default createAppModule(',
        '  "/workspace/:workspaceId(\\\\d+)/feature",',
        '  { DashboardPage },',
        '  [],',
        '  ({ pageRoutes }) => <Routes>{pageRoutes}</Routes>,',
        ');',
      ].join('\n'),
      [dashboardPath]: 'export default function DashboardPage() { return <main />; }',
      [APP_PATH]:
        '<Routes><Route path="/workspace/:workspaceId/*" element={<DefaultFeatureApp />} /></Routes>',
      [PAGE_MAP_PATH]: 'import pages from "./pages.json"; export const pageMap = pages;',
      [PAGE_CATALOG_PATH]: JSON.stringify({
        workspace: {
          ':workspaceId(\\d+)': {
            feature: {
              index: 'DashboardPage',
            },
          },
        },
      }),
    };

    const inventory = await collectPreviewInspectorRouteLocationInventory({
      ...createOptions(sources, renderChain),
      resolveModule: (moduleSpecifier) =>
        moduleSpecifier === './dashboard-page' ? dashboardPath : undefined,
    });

    expect(inventory.choices).toEqual([]);
    expect(inventory.unresolvedFactoryOptionNames).toEqual(['DashboardPage']);
  });

  /**
   * Uses a nested module's own base path when neither a JSON catalog nor an outer wildcard names
   * the selected descendant export directly.
   */
  it('promotes descendant factory base evidence when a catalog has no direct target leaf', async () => {
    const targetPath = '/workspace/application/src/modules/nested-panel.tsx';
    const nestedModulePath = '/workspace/application/src/modules/nested-module.tsx';
    const catalogMapPath = '/workspace/application/src/modules/pages-map.ts';
    const catalogPath = '/workspace/application/src/modules/pages.json';
    const baseRenderChain = createRenderChain(nestedModulePath, targetPath, 'NestedPanel');
    const basePath = baseRenderChain.paths[0];
    if (basePath === undefined) throw new Error('The route fixture requires one render path.');
    const renderChain: PreviewRenderChainPlan = {
      ...baseRenderChain,
      dependencyPaths: [APP_PATH, nestedModulePath, targetPath],
      paths: [
        {
          ...basePath,
          steps: [
            {
              certainty: 'confirmed',
              kind: 'component-render',
              label: 'NestedPanel',
              occurrenceStart: 10,
              sourcePath: targetPath,
              wrapperNames: [],
            },
            {
              certainty: 'confirmed',
              kind: 'component-render',
              label: 'NestedModule',
              occurrenceStart: 20,
              sourcePath: nestedModulePath,
              wrapperNames: [],
            },
            {
              certainty: 'confirmed',
              kind: 'component-render',
              label: 'ApplicationRouter',
              occurrenceStart: 30,
              sourcePath: APP_PATH,
              wrapperNames: [],
            },
          ],
        },
      ],
    };
    const sources = {
      [targetPath]: 'export function NestedPanel() { return <section />; }',
      [nestedModulePath]: [
        'const NESTED_BASE_PATH = "/workspace/:workspaceId/tools";',
        'export const NestedModule = defineFeatureModule(',
        '  NESTED_BASE_PATH,',
        '  {},',
        '  [],',
        '  ({ pageRoutes }) => <Shell>{pageRoutes}</Shell>,',
        ');',
      ].join('\n'),
      [APP_PATH]: [
        '<Routes>',
        '  <Route path="/*" element={<NestedModule />} />',
        '</Routes>',
      ].join('\n'),
      [catalogMapPath]: 'import pages from "./pages.json"; export default pages;',
      [catalogPath]: JSON.stringify({ workspace: { index: 'WorkspaceHomePage' } }),
    };

    const location = await collectPreviewInspectorRouteLocation(
      createOptions(sources, renderChain),
    );

    expect(location).toEqual({
      componentName: 'NestedModule',
      dependencyPaths: [APP_PATH, nestedModulePath].sort(),
      evidenceKind: 'route-jsx',
      pathname: '/workspace/1/tools',
      pattern: '/workspace/:workspaceId/tools',
      sourcePath: nestedModulePath,
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
        'import { PartnerStaffApp } from "./staff/partner-staff-app";',
        'const appRoutes = [',
        '  { path: "partner/:legalPartnerId/*", element: <PartnerStaffApp /> },',
        '  { path: "*", element: <NotFoundPage /> },',
        '];',
        'export default function App() { return useRoutes(appRoutes); }',
      ].join('\n'),
    };
    const renderChain = createRenderChain(
      APP_PATH,
      targetPath,
      'PartnerStaffApp',
      'PartnerStaffApp',
    );

    const location = await collectPreviewInspectorRouteLocation(
      createOptions(sources, renderChain),
    );

    expect(location).toMatchObject({
      componentExportName: 'PartnerStaffApp',
      componentName: 'PartnerStaffApp',
      componentSourcePath: targetPath,
      dependencyPaths: [APP_PATH, targetPath].sort(),
      evidenceKind: 'route-jsx',
      pathname: '/partner/1',
      pattern: '/partner/:legalPartnerId/*',
      routeMounts: [
        {
          basePath: '/partner/:legalPartnerId(\\d+)',
          exportName: 'PartnerStaffApp',
          hasWildcardFallback: false,
          routeSlotCount: 1,
          sourcePath: targetPath,
        },
      ],
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
        'import { WorkspaceShell } from "./workspace-shell";',
        'const routes = [',
        '  { path: "/workspace/:workspaceId/*", element: <WorkspaceShell /> },',
        '  { path: "/workspace/:workspaceId/dashboard", element: <Dashboard /> },',
        '];',
        'export default function App() { return useRoutes(routes); }',
      ].join('\n'),
    };
    const renderChain = createRenderChain(APP_PATH, targetPath, 'WorkspaceShell', 'WorkspaceShell');

    const location = await collectPreviewInspectorRouteLocation(
      createOptions(sources, renderChain),
    );

    expect(location).toMatchObject({
      pathname: '/workspace/1/dashboard',
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

  it('binds a dynamic direct route only to its imported registry export and JSON chain', async () => {
    const pagePath = '/workspace/application/src/BoundPage.tsx';
    const registryPath = '/workspace/application/src/route-registry.ts';
    const catalogPath = '/workspace/application/src/bound-routes.json';
    const unrelatedRegistryPath = '/workspace/application/src/unrelated-pages-map.ts';
    const unrelatedCatalogPath = '/workspace/application/src/unrelated-pages.json';
    const sources: Record<string, string> = {
      [APP_PATH]: [
        'import { createBrowserRouter } from "react-router-dom";',
        'import BoundPage from "./BoundPage";',
        'import { routeNamePathMap } from "./route-registry";',
        'const router = createBrowserRouter([{ path: normalize(routeNamePathMap["BoundPage"]), element: <BoundPage /> }]);',
        'export default function App() { return <RouterProvider router={router} />; }',
      ].join('\n'),
      [pagePath]: 'export default function BoundPage() { return <main />; }',
      [registryPath]: [
        'import rawRoutes from "./bound-routes.json";',
        'const pathNameMap = transform(rawRoutes);',
        'export const routeNamePathMap = invert(pathNameMap);',
      ].join('\n'),
      [catalogPath]: JSON.stringify({ exact: { index: 'BoundPage' } }),
      [unrelatedRegistryPath]: [
        'import rawRoutes from "./unrelated-pages.json";',
        'export const routeNamePathMap = invert(rawRoutes);',
      ].join('\n'),
      [unrelatedCatalogPath]: JSON.stringify({ wrong: { index: 'BoundPage' } }),
    };
    const resolveModule = (specifier: string, importer: string): string | undefined =>
      new Map([
        [`${APP_PATH}\0./BoundPage`, pagePath],
        [`${APP_PATH}\0./route-registry`, registryPath],
        [`${registryPath}\0./bound-routes.json`, catalogPath],
        [`${unrelatedRegistryPath}\0./unrelated-pages.json`, unrelatedCatalogPath],
      ]).get(`${importer}\0${specifier}`);
    const inventory = await collectPreviewInspectorRouteLocationInventory({
      documentPath: APP_PATH,
      exportName: 'default',
      readSource: (sourcePath) => Promise.resolve(sources[sourcePath]),
      renderChain: createRenderChain(APP_PATH, APP_PATH, 'App'),
      resolveModule,
      sourcePaths: [APP_PATH, registryPath, unrelatedRegistryPath],
    });

    expect(inventory.choices).toEqual([
      expect.objectContaining({
        componentExportName: 'default',
        componentName: 'BoundPage',
        componentSourcePath: pagePath,
        evidenceKind: 'route-catalog',
        pattern: '/exact',
        sourcePath: catalogPath,
      }),
    ]);
    expect(inventory.choices[0]?.dependencyPaths).toEqual(
      expect.arrayContaining([APP_PATH, pagePath, registryPath, catalogPath]),
    );
    expect(inventory.choices[0]?.dependencyPaths).not.toEqual(
      expect.arrayContaining([unrelatedRegistryPath, unrelatedCatalogPath]),
    );
    expect(inventory.choices[0]).toMatchObject({
      directRouteOwnerSourcePath: APP_PATH,
      routeMounts: [
        expect.objectContaining({
          exportName: 'default',
          sourcePath: APP_PATH,
        }),
      ],
      sourcePath: catalogPath,
    });
  });

  it('keeps an exact registry-member route unresolved when only an unrelated registry has its key', async () => {
    const pagePath = '/workspace/application/src/BoundPage.tsx';
    const registryPath = '/workspace/application/src/route-registry.ts';
    const catalogPath = '/workspace/application/src/bound-routes.json';
    const unrelatedRegistryPath = '/workspace/application/src/unrelated-pages-map.ts';
    const unrelatedCatalogPath = '/workspace/application/src/unrelated-pages.json';
    const sources: Record<string, string> = {
      [APP_PATH]: [
        'import { createBrowserRouter } from "react-router-dom";',
        'import BoundPage from "./BoundPage";',
        'import { routeNamePathMap } from "./route-registry";',
        'const router = createBrowserRouter([{ path: normalize(routeNamePathMap["BoundPage"]), element: <BoundPage /> }]);',
        'export default function App() { return <RouterProvider router={router} />; }',
      ].join('\n'),
      [pagePath]: 'export default function BoundPage() { return <main />; }',
      [registryPath]:
        'import rawRoutes from "./bound-routes.json"; export const routeNamePathMap = invert(rawRoutes);',
      [catalogPath]: JSON.stringify({ exact: { index: 'DifferentPage' } }),
      [unrelatedRegistryPath]:
        'import rawRoutes from "./unrelated-pages.json"; export const routeNamePathMap = invert(rawRoutes);',
      [unrelatedCatalogPath]: JSON.stringify({ wrong: { index: 'BoundPage' } }),
    };
    const resolveModule = (specifier: string, importer: string): string | undefined =>
      new Map([
        [`${APP_PATH}\0./BoundPage`, pagePath],
        [`${APP_PATH}\0./route-registry`, registryPath],
        [`${registryPath}\0./bound-routes.json`, catalogPath],
        [`${unrelatedRegistryPath}\0./unrelated-pages.json`, unrelatedCatalogPath],
      ]).get(`${importer}\0${specifier}`);
    const inventory = await collectPreviewInspectorRouteLocationInventory({
      documentPath: APP_PATH,
      exportName: 'default',
      readSource: (sourcePath) => Promise.resolve(sources[sourcePath]),
      renderChain: createRenderChain(APP_PATH, APP_PATH, 'App'),
      resolveModule,
      sourcePaths: [APP_PATH, registryPath, unrelatedRegistryPath],
    });

    expect(inventory.choices).toEqual([]);
    expect(inventory.unresolvedFactoryOptions).toEqual([
      expect.objectContaining({
        availability: 'catalog-unresolved',
        componentName: 'BoundPage',
        kind: 'direct',
      }),
    ]);
  });

  it('demotes conflicting same-public direct occurrences while retaining exact duplicates', async () => {
    const firstPath = '/workspace/application/src/first-page.tsx';
    const secondPath = '/workspace/application/src/second-page.tsx';
    const ambiguousSources: Record<string, string> = {
      [APP_PATH]: [
        'import * as First from "./first-page";',
        'import * as Second from "./second-page";',
        'export default function App() { return <Routes>',
        '  <Route path="/shared" element={<First.SharedPage />} />',
        '  <Route path="/shared" element={<Second.SharedPage />} />',
        '</Routes>; }',
      ].join('\n'),
      [firstPath]: 'export function SharedPage() { return <main />; }',
      [secondPath]: 'export function SharedPage() { return <main />; }',
    };
    const ambiguousInventory = await collectPreviewInspectorRouteLocationInventory({
      documentPath: APP_PATH,
      exportName: 'default',
      readSource: (sourcePath) => Promise.resolve(ambiguousSources[sourcePath]),
      renderChain: createRenderChain(APP_PATH, APP_PATH, 'App'),
      resolveModule: (specifier) =>
        specifier === './first-page'
          ? firstPath
          : specifier === './second-page'
            ? secondPath
            : undefined,
      sourcePaths: [APP_PATH],
    });

    expect(ambiguousInventory.choices).toEqual([]);
    expect(
      ambiguousInventory.unresolvedFactoryOptions?.map((option) => option.availability),
    ).toEqual(['route-provenance-ambiguous', 'route-provenance-ambiguous']);
    expect(
      new Set(
        ambiguousInventory.unresolvedFactoryOptions?.map((option) => option.occurrenceIdentity),
      ).size,
    ).toBe(2);

    const duplicateSources: Record<string, string> = {
      [APP_PATH]: [
        'import SharedPage from "./first-page";',
        'export default function App() { return <Routes>',
        '  <Route path="/shared" element={<SharedPage />} />',
        '  <Route path="/shared" element={<SharedPage />} />',
        '</Routes>; }',
      ].join('\n'),
      [firstPath]: 'export default function SharedPage() { return <main />; }',
    };
    const duplicateOptions: CollectPreviewInspectorRouteLocationOptions = {
      documentPath: APP_PATH,
      exportName: 'default',
      readSource: (sourcePath) => Promise.resolve(duplicateSources[sourcePath]),
      renderChain: createRenderChain(APP_PATH, APP_PATH, 'App'),
      resolveModule: (specifier) => (specifier === './first-page' ? firstPath : undefined),
      sourcePaths: [APP_PATH],
    };
    const duplicateInventory =
      await collectPreviewInspectorRouteLocationInventory(duplicateOptions);
    const duplicatePlan = await collectPreviewInspectorRouteBranchPlan(duplicateOptions);

    expect(duplicateInventory.choices).toHaveLength(1);
    expect(duplicateInventory.directRouteDuplicates).toHaveLength(1);
    expect(
      duplicatePlan.branches.filter((branch) => branch.duplicateOf !== undefined),
    ).toHaveLength(1);
  });

  it('does not correlate a dynamic direct route through a name-only catalog leaf', async () => {
    const pagePath = '/workspace/application/src/TerminalPage.tsx';
    const layoutPath = '/workspace/application/src/Shell.tsx';
    const mapPath = '/workspace/application/src/pages-map.ts';
    const catalogPath = '/workspace/application/src/pages.json';
    const appSource = [
      'import { RouterProvider, createBrowserRouter } from "react-router-dom";',
      'import Shell from "./Shell"; import TerminalPage from "./TerminalPage";',
      'const routePath = () => "/ignored";',
      'const router = createBrowserRouter([{ path: "/*", children: [{ path: routePath(), element: <Shell><TerminalPage /></Shell> }, { path: "*", element: <NotFound /> }] }]);',
      'export default function App() { return <RouterProvider router={router} />; }',
    ].join('\n');
    const sources: Record<string, string> = {
      [APP_PATH]: appSource,
      [pagePath]: 'export default function TerminalPage() { return <main />; }',
      [layoutPath]:
        'export default function Shell({ children }) { return <section>{children}</section>; }',
      [mapPath]: 'import pages from "./pages.json"; export default pages;',
      [catalogPath]: JSON.stringify({ concrete: { index: 'TerminalPage' } }),
    };
    const renderChain = createRenderChain(APP_PATH, APP_PATH, 'App');
    const options: CollectPreviewInspectorRouteLocationOptions = {
      documentPath: APP_PATH,
      exportName: 'default',
      readSource: (sourcePath) => Promise.resolve(sources[sourcePath]),
      renderChain,
      resolveModule: (specifier, importer) =>
        specifier === './TerminalPage' && importer === APP_PATH
          ? pagePath
          : specifier === './Shell' && importer === APP_PATH
            ? layoutPath
            : specifier === './pages.json' && importer === mapPath
              ? catalogPath
              : undefined,
      sourcePaths: [APP_PATH, mapPath],
    };
    const location = await collectPreviewInspectorRouteLocation(options);

    expect(location).toMatchObject({
      componentName: 'NotFound',
      evidenceKind: 'route-jsx',
      pattern: '/*',
    });
    expect(location?.componentName).not.toBe('TerminalPage');
    expect(location?.componentSourcePath).toBeUndefined();
    const plan = await collectPreviewInspectorRouteBranchPlan({ ...options });
    expect(plan.activeLocation).toMatchObject({
      componentName: 'NotFound',
      evidenceKind: 'route-jsx',
      pattern: '/*',
    });
    expect(plan.activeLocation?.componentName).not.toBe('TerminalPage');

    const noCatalogSources: Record<string, string> = {
      [APP_PATH]: appSource.replace(', { path: "*", element: <NotFound /> }', ''),
      [layoutPath]: sources[layoutPath] ?? '',
      [pagePath]: sources[pagePath] ?? '',
    };
    await expect(
      collectPreviewInspectorRouteLocation({
        ...options,
        readSource: (sourcePath) => Promise.resolve(noCatalogSources[sourcePath]),
        sourcePaths: [APP_PATH],
      }),
    ).resolves.toBeUndefined();
  });

  it('does not promote an unrelated contextual sibling when the target path is unresolved', async () => {
    const targetPath = '/workspace/application/src/TargetPage.tsx';
    const siblingPath = '/workspace/application/src/SiblingPage.tsx';
    const sources: Record<string, string> = {
      [APP_PATH]: [
        'import TargetPage from "./TargetPage";',
        'import SiblingPage from "./SiblingPage";',
        'const dynamicPath = () => "/target";',
        'export default function App() { return <Routes>',
        '  <Route path={dynamicPath()} element={<TargetPage />} />',
        '  <Route path="/sibling" element={<SiblingPage />} />',
        '</Routes>; }',
      ].join('\n'),
      [targetPath]: 'export default function TargetPage() { return <main />; }',
      [siblingPath]: 'export default function SiblingPage() { return <main />; }',
    };
    const inventory = await collectPreviewInspectorRouteLocationInventory({
      documentPath: targetPath,
      exportName: 'default',
      readSource: (sourcePath) => Promise.resolve(sources[sourcePath]),
      renderChain: createRenderChain(APP_PATH, targetPath, 'TargetPage'),
      resolveModule: (specifier) =>
        specifier === './TargetPage'
          ? targetPath
          : specifier === './SiblingPage'
            ? siblingPath
            : undefined,
      sourcePaths: [APP_PATH],
    });

    expect(inventory.primary).toBeUndefined();
    expect(inventory.choices).toEqual([]);
    expect(inventory.unresolvedFactoryOptions).toBeUndefined();
    expect(inventory.directRouteDuplicates).toBeUndefined();
  });

  it('omits an unresolved aggregate leaf and its pathless boundary without a catalog', async () => {
    const terminalPath = '/workspace/application/src/TerminalPage.tsx';
    const layoutPath = '/workspace/application/src/TerminalLayout.tsx';
    const sourceText = [
      'import TerminalPage from "./TerminalPage";',
      'import TerminalLayout from "./TerminalLayout";',
      'const dynamicPath = () => "/terminal";',
      'const routeNodes = [<Route path={dynamicPath()} element={<TerminalLayout><TerminalPage /></TerminalLayout>} />];',
      'export default function App() {',
      '  return <Routes><Route path="/*"><Route element={<AccessBoundary />}>{routeNodes}</Route></Route></Routes>;',
      '}',
    ].join('\n');
    const sources: Record<string, string> = {
      [APP_PATH]: sourceText,
      [terminalPath]: 'export default function TerminalPage() { return <main />; }',
      [layoutPath]:
        'export default function TerminalLayout({ children }) { return <section>{children}</section>; }',
    };
    const resolveModule = (moduleSpecifier: string, consumerPath: string): string | undefined =>
      new Map([
        [`${APP_PATH}\0./TerminalPage`, terminalPath],
        [`${APP_PATH}\0./TerminalLayout`, layoutPath],
      ]).get(`${consumerPath}\0${moduleSpecifier}`);
    const directInventory = await collectPreviewInspectorDirectRouteChoices({
      readSource: (sourcePath) => Promise.resolve(sources[sourcePath]),
      resolveModule,
      sourcePath: APP_PATH,
      sourceText,
    });
    const location = await collectPreviewInspectorRouteLocation({
      documentPath: APP_PATH,
      exportName: 'default',
      readSource: (sourcePath) => Promise.resolve(sources[sourcePath]),
      renderChain: createRenderChain(APP_PATH, APP_PATH, 'App'),
      resolveModule,
      sourcePaths: [APP_PATH],
    });

    expect(directInventory.choices.map((choice) => choice.componentName)).not.toEqual(
      expect.arrayContaining(['AccessBoundary', 'TerminalPage']),
    );
    expect(directInventory.choices.some((choice) => choice.pattern === '/*')).toBe(false);
    expect(directInventory.choices.some((choice) => choice.pattern === '/preview')).toBe(false);
    expect(location).toBeUndefined();
  });

  it('keeps same-component index and splat choices separate at their shared base pathname', async () => {
    const checkoutPath = '/workspace/application/src/CheckoutTestPage.tsx';
    const designSystemPath = '/workspace/application/src/DesignSystemPage.tsx';
    const missingPath = '/workspace/application/src/MissingPage.tsx';
    const rootLayoutPath = '/workspace/application/src/RootLayout.tsx';
    const guardPath = '/workspace/application/src/Guard.tsx';
    const sources: Record<string, string> = {
      [APP_PATH]: [
        'import CheckoutTestPage from "./CheckoutTestPage";',
        'import DesignSystemPage from "./DesignSystemPage";',
        'import MissingPage from "./MissingPage";',
        'import RootLayout from "./RootLayout";',
        'import Guard from "./Guard";',
        '<Routes><Route path="/*" element={<RootLayout />}><Route element={<Guard />}><Route path="checkout-test" element={<CheckoutTestPage />} /><Route path="design-system/*" element={<DesignSystemPage />} /><Route index element={<MissingPage />} /></Route><Route path="*" element={<MissingPage />} /></Route></Routes>;',
      ].join('\n'),
      [checkoutPath]: 'export default function CheckoutTestPage() { return <main />; }',
      [designSystemPath]: 'export default function DesignSystemPage() { return <main />; }',
      [missingPath]: 'export default function MissingPage() { return <main />; }',
      [rootLayoutPath]: 'export default function RootLayout() { return <main />; }',
      [guardPath]: 'export default function Guard() { return <main />; }',
    };
    const resolveModule = (moduleSpecifier: string, consumerPath: string): string | undefined =>
      new Map([
        [`${APP_PATH}\0./CheckoutTestPage`, checkoutPath],
        [`${APP_PATH}\0./DesignSystemPage`, designSystemPath],
        [`${APP_PATH}\0./MissingPage`, missingPath],
        [`${APP_PATH}\0./RootLayout`, rootLayoutPath],
        [`${APP_PATH}\0./Guard`, guardPath],
      ]).get(`${consumerPath}\0${moduleSpecifier}`);
    const options: CollectPreviewInspectorRouteLocationOptions = {
      documentPath: APP_PATH,
      exportName: 'default',
      readSource: (sourcePath) => Promise.resolve(sources[sourcePath]),
      renderChain: createRenderChain(APP_PATH, APP_PATH, 'App'),
      resolveModule,
      sourcePaths: [APP_PATH],
    };

    const inventory = await collectPreviewInspectorRouteLocationInventory(options);
    expect(inventory.choices.map((choice) => choice.componentName)).not.toEqual(
      expect.arrayContaining(['RootLayout', 'Guard']),
    );
    expect(inventory.choices.map((choice) => choice.pattern)).toEqual(
      expect.arrayContaining(['/checkout-test', '/design-system/*', '/', '/*']),
    );
    expect(inventory.choices.some((choice) => choice.pattern.startsWith('/*/'))).toBe(false);
    expect(
      inventory.choices.filter(
        (choice) => choice.componentName === 'MissingPage' && choice.pathname === '/',
      ),
    ).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ pattern: '/' }),
        expect.objectContaining({ pattern: '/*' }),
      ]),
    );

    const automaticPlan = await collectPreviewInspectorRouteBranchPlan(options);
    expect(automaticPlan.selectionResolution).toBe('automatic');
    expect(automaticPlan.activeLocation).toMatchObject({
      componentName: 'CheckoutTestPage',
      pathname: '/checkout-test',
      pattern: '/checkout-test',
    });
    expect(automaticPlan.activeLocation?.componentName).not.toBe('MissingPage');

    const explicitPlan = await collectPreviewInspectorRouteBranchPlan({
      ...options,
      selection: [{ componentName: 'DesignSystemPage', pattern: '/design-system/*' }],
    });
    expect(explicitPlan.selectionResolution).toBe('exact');
    expect(explicitPlan.activeLocation).toMatchObject({
      componentName: 'DesignSystemPage',
      pathname: '/design-system',
      pattern: '/design-system/*',
    });
    expect(explicitPlan.branches).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          componentName: 'MissingPage',
          pathname: '/preview',
          pattern: '/*',
        }),
      ]),
    );
  });
});
