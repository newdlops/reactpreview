/** Covers factories behavior for previewInspectorRouteLocation. */
/** Verifies authored-source previewInspectorRouteLocation invariants. */
import { describe, expect, it } from 'vitest';

import {
  collectPreviewInspectorRouteLocation,
  collectPreviewInspectorRouteLocationInventory,
} from '../../../../src/adapters/esbuild/inspector';

import type { PreviewRenderChainPlan } from '../../../../src/adapters/esbuild/renderGraph';

import {
  APP_PATH,
  PAGE_CATALOG_PATH,
  PAGE_MAP_PATH,
  TARGET_PATH,
  createOptions,
  createRenderChain,
} from './previewInspectorRouteLocationFixtures';

describe('collectPreviewInspectorRouteLocation', () => {
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
});
