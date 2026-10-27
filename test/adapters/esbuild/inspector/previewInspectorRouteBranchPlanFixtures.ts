/** Shared deterministic fixtures for previewInspectorRouteBranchPlan regression scenarios. */
import path from 'node:path';
import { collectPreviewInspectorRouteBranchPlan } from '../../../../src/adapters/esbuild/inspector';
import type { PreviewRenderChainPlan } from '../../../../src/adapters/esbuild/renderGraph';

export const APP_PATH = '/workspace/src/App.tsx';

export const ROUTER_PATH = '/workspace/src/router.tsx';

export const FEATURE_PATH = '/workspace/src/feature/FeatureApp.tsx';

export const FEATURE_ROUTER_PATH = '/workspace/src/feature/router.tsx';

export const SETTINGS_PATH = '/workspace/src/feature/SettingsPage.tsx';

export const DASHBOARD_PATH = '/workspace/src/feature/DashboardPage.tsx';

export const ABOUT_PATH = '/workspace/src/AboutPage.tsx';

/** Creates an entry-connected App target without involving filesystem discovery. */
export function createAppRenderChain(): PreviewRenderChainPlan {
  return {
    dependencyPaths: [APP_PATH],
    paths: [
      {
        entryPoint: {
          kind: 'create-root',
          occurrenceStart: 1,
          sourcePath: APP_PATH,
          wrapperNames: [],
        },
        id: 'app-entry',
        steps: [
          {
            certainty: 'confirmed',
            kind: 'component-render',
            label: 'App',
            occurrenceStart: 10,
            sourcePath: APP_PATH,
            wrapperNames: [],
          },
        ],
      },
    ],
    reachability: 'entry-connected',
    target: { exportName: 'default', sourcePath: APP_PATH },
    truncated: false,
  };
}

/** Builds the nested RouterProvider fixture shared by metadata and branch tests. */
export function createNestedRouterSources(): Readonly<Record<string, string>> {
  return {
    [APP_PATH]: [
      'import { RouterProvider } from "react-router-dom";',
      'import { router } from "./router";',
      'export default function App() { return <RouterProvider router={router} />; }',
    ].join('\n'),
    [ROUTER_PATH]: [
      'import { createBrowserRouter } from "react-router-dom";',
      'import FeatureApp from "./feature/FeatureApp";',
      'import AboutPage from "./AboutPage";',
      'export const router = createBrowserRouter([',
      '  { path: "/feature/*", element: <FeatureApp /> },',
      '  { path: "/about", element: <AboutPage /> },',
      ']);',
    ].join('\n'),
    [FEATURE_PATH]: [
      'import { RouterProvider } from "react-router-dom";',
      'import { featureRouter } from "./router";',
      'export default function FeatureApp() {',
      '  return <RouterProvider router={featureRouter} />;',
      '}',
    ].join('\n'),
    [FEATURE_ROUTER_PATH]: [
      'import { createMemoryRouter } from "react-router-dom";',
      'import SettingsPage from "./SettingsPage";',
      'import DashboardPage from "./DashboardPage";',
      'export const featureRouter = createMemoryRouter([',
      '  { path: "settings", element: <SettingsPage /> },',
      '  { path: "dashboard", element: <DashboardPage /> },',
      ']);',
    ].join('\n'),
    [SETTINGS_PATH]: 'export default function SettingsPage() { return <main>settings</main>; }',
    [DASHBOARD_PATH]: 'export default function DashboardPage() { return <main>home</main>; }',
    [ABOUT_PATH]: 'export default function AboutPage() { return <main>about</main>; }',
  };
}

/** Resolves only the literal module specifiers authored by the fixture. */
export function resolveFixtureModule(
  moduleSpecifier: string,
  consumerPath: string,
): string | undefined {
  const key = `${consumerPath}\0${moduleSpecifier}`;
  return new Map([
    [`${APP_PATH}\0./router`, ROUTER_PATH],
    [`${ROUTER_PATH}\0./feature/FeatureApp`, FEATURE_PATH],
    [`${ROUTER_PATH}\0./AboutPage`, ABOUT_PATH],
    [`${FEATURE_PATH}\0./router`, FEATURE_ROUTER_PATH],
    [`${FEATURE_ROUTER_PATH}\0./SettingsPage`, SETTINGS_PATH],
    [`${FEATURE_ROUTER_PATH}\0./DashboardPage`, DASHBOARD_PATH],
  ]).get(key);
}

/** Builds the nested owner shape used by terminal wildcard shadowing coverage. */
export async function collectNestedTerminalWildcardPlan(
  includeRootRedirect: boolean,
  selection?: Parameters<typeof collectPreviewInspectorRouteBranchPlan>[0]['selection'],
): Promise<Awaited<ReturnType<typeof collectPreviewInspectorRouteBranchPlan>>> {
  const cmeAppPath = '/workspace/src/CmeApp.tsx';
  const redirectPath = '/workspace/src/CmeRootRedirect.tsx';
  const notFoundPath = '/workspace/src/NotFoundStatus.tsx';
  const sources: Readonly<Record<string, string>> = {
    [APP_PATH]: [
      'import { Route, Routes } from "react-router-dom";',
      'import CmeApp from "./CmeApp";',
      'export default function App() {',
      '  return <Routes><Route path="/cme/:companyManagingEntityId(\\\\d+)/*" element={<CmeApp />} /></Routes>;',
      '}',
    ].join('\n'),
    [cmeAppPath]: [
      'import { Outlet, Route, Routes } from "react-router-dom";',
      'import CmeRootRedirect from "./CmeRootRedirect";',
      'import NotFoundStatus from "./NotFoundStatus";',
      'export default function CmeApp() {',
      '  return <Routes><Route element={<Outlet />}>',
      ...(includeRootRedirect ? ['    <Route path="/" element={<CmeRootRedirect />} />'] : []),
      '    <Route path="*" element={<NotFoundStatus />} />',
      '  </Route></Routes>;',
      '}',
    ].join('\n'),
    [redirectPath]: [
      'import { Navigate } from "react-router-dom";',
      'export default function CmeRootRedirect() {',
      '  return <Navigate replace to="/cme/list" />;',
      '}',
    ].join('\n'),
    [notFoundPath]: 'export default function NotFoundStatus() { return <main>not found</main>; }',
  };
  const resolution = new Map([
    [`${APP_PATH}\0./CmeApp`, cmeAppPath],
    [`${cmeAppPath}\0./CmeRootRedirect`, redirectPath],
    [`${cmeAppPath}\0./NotFoundStatus`, notFoundPath],
  ]);

  return collectPreviewInspectorRouteBranchPlan({
    documentPath: APP_PATH,
    exportName: 'default',
    readSource: (sourcePath) => Promise.resolve(sources[path.normalize(sourcePath)]),
    renderChain: createAppRenderChain(),
    resolveModule: (moduleSpecifier, consumerPath) =>
      resolution.get(`${path.normalize(consumerPath)}\0${moduleSpecifier}`),
    ...(selection === undefined ? {} : { selection }),
    sourcePaths: Object.freeze(Object.keys(sources)),
  });
}
