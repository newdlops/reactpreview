/* eslint-disable max-lines -- Generic prefix-parity fixtures share the route-planner harness. */
/** Verifies large, nested application route discovery without bundling unselected page modules. */
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  collectPreviewInspectorDirectRouteChoices,
  collectPreviewInspectorRouteBranchPlan,
} from '../../../../src/adapters/esbuild/inspector';
import {
  createPreviewInspectorRouteBranchSelectionPrefixProvider,
  createPreviewInspectorRouteOwnerLocationInventoryMemo,
  type PreviewInspectorRouteOwnerLocationInventoryMemo,
} from '../../../../src/adapters/esbuild/inspector/previewInspectorRouteBranchPlan';
import type { PreviewRenderChainPlan } from '../../../../src/adapters/esbuild/renderGraph';

const APP_PATH = '/workspace/src/App.tsx';
const ROUTER_PATH = '/workspace/src/router.tsx';
const FEATURE_PATH = '/workspace/src/feature/FeatureApp.tsx';
const FEATURE_ROUTER_PATH = '/workspace/src/feature/router.tsx';
const SETTINGS_PATH = '/workspace/src/feature/SettingsPage.tsx';
const DASHBOARD_PATH = '/workspace/src/feature/DashboardPage.tsx';
const ABOUT_PATH = '/workspace/src/AboutPage.tsx';

/** Creates an entry-connected App target without involving filesystem discovery. */
function createAppRenderChain(): PreviewRenderChainPlan {
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
function createNestedRouterSources(): Readonly<Record<string, string>> {
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
function resolveFixtureModule(moduleSpecifier: string, consumerPath: string): string | undefined {
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

describe('preview Inspector hierarchical route branches', () => {
  it('retains unresolved dynamic paths without treating ancestor context as exact evidence', async () => {
    const sourceText = [
      'import DynamicPage from "./DynamicPage";',
      'import ExactPage from "./ExactPage";',
      'const buildPath = () => "/dynamic";',
      'export const routes = <Route path="/*"><Route path={buildPath()} element={<DynamicPage />} /><Route path="exact" element={<ExactPage />} /><Route index element={<ExactPage />} /><Route path={buildPath()}><Route path="/absolute" element={<ExactPage />} /></Route></Route>;',
    ].join('\n');
    const inventory = await collectPreviewInspectorDirectRouteChoices({
      readSource: () => Promise.resolve(undefined),
      resolveModule: () => undefined,
      sourcePath: ROUTER_PATH,
      sourceText,
    });

    expect(inventory.choices).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          componentName: 'DynamicPage',
          pattern: '/*',
          pathResolution: 'unresolved',
        }),
        expect.objectContaining({
          componentName: 'ExactPage',
          pattern: '/exact',
          pathResolution: 'resolved',
        }),
        expect.objectContaining({
          componentName: 'ExactPage',
          pattern: '/absolute',
          pathResolution: 'resolved',
        }),
      ]),
    );
    expect(
      inventory.choices.some(
        (choice) => choice.pathResolution === 'resolved' && choice.pattern.startsWith('/*/'),
      ),
    ).toBe(false);
  });

  it('keeps object-route dynamic path descendants unresolved until an absolute literal resets them', async () => {
    const sourceText = [
      'import DynamicPage from "./DynamicPage";',
      'import ExactPage from "./ExactPage";',
      'import { createBrowserRouter } from "react-router-dom";',
      'const buildPath = () => "/dynamic";',
      'export const router = createBrowserRouter([{ path: "/*", children: [{ path: buildPath(), element: <DynamicPage /> }, { path: buildPath(), children: [{ children: [{ path: "relative", element: <DynamicPage /> }] }] }, { path: "/absolute", element: <ExactPage /> }, { path: "exact", element: <ExactPage /> }] }]);',
    ].join('\n');
    const inventory = await collectPreviewInspectorDirectRouteChoices({
      readSource: () => Promise.resolve(undefined),
      resolveModule: () => undefined,
      sourcePath: ROUTER_PATH,
      sourceText,
    });

    expect(inventory.choices).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          componentName: 'DynamicPage',
          pattern: '/*',
          pathResolution: 'unresolved',
        }),
        expect.objectContaining({
          componentName: 'DynamicPage',
          pattern: '/*/relative',
          pathResolution: 'unresolved',
        }),
        expect.objectContaining({
          componentName: 'ExactPage',
          pattern: '/absolute',
          pathResolution: 'resolved',
        }),
        expect.objectContaining({
          componentName: 'ExactPage',
          pattern: '/exact',
          pathResolution: 'resolved',
        }),
      ]),
    );
    expect(
      inventory.choices.some(
        (choice) => choice.pathResolution === 'resolved' && choice.pattern.startsWith('/*/'),
      ),
    ).toBe(false);
  });

  it('indexes hundreds of object routes as inert metadata', async () => {
    const pageImports = Array.from(
      { length: 320 },
      (_value, index) => `import Page${index.toString()} from "./pages/Page${index.toString()}";`,
    );
    const routeRecords = Array.from(
      { length: 320 },
      (_value, index) =>
        `{ path: "/area/${index.toString()}", element: <Page${index.toString()} /> },`,
    );
    const sourceText = [
      'import { createBrowserRouter } from "react-router-dom";',
      ...pageImports,
      'export const router = createBrowserRouter([',
      ...routeRecords,
      ']);',
    ].join('\n');

    const inventory = await collectPreviewInspectorDirectRouteChoices({
      readSource: () => Promise.resolve(undefined),
      resolveModule: (moduleSpecifier) => `/workspace/src/${moduleSpecifier.slice(2)}.tsx`,
      sourcePath: ROUTER_PATH,
      sourceText,
    });

    expect(inventory.choices).toHaveLength(320);
    expect(inventory.dependencyPaths).toEqual([ROUTER_PATH]);
    expect(inventory.choices[319]).toMatchObject({
      componentName: 'Page319',
      pattern: '/area/319',
    });
  });

  it('follows an imported RouterProvider config and recursively selects one nested leaf', async () => {
    const sources = createNestedRouterSources();
    const readPaths: string[] = [];
    const plan = await collectPreviewInspectorRouteBranchPlan({
      documentPath: APP_PATH,
      exportName: 'default',
      readSource: (sourcePath) => {
        readPaths.push(sourcePath);
        return Promise.resolve(sources[sourcePath]);
      },
      renderChain: createAppRenderChain(),
      resolveModule: resolveFixtureModule,
      selection: [
        { componentName: 'FeatureApp', pattern: '/feature/*' },
        { componentName: 'SettingsPage', pattern: '/feature/settings' },
      ],
      sourcePaths: Object.keys(sources),
    });

    expect(plan.activeLocation).toMatchObject({
      componentExportName: 'default',
      componentName: 'SettingsPage',
      componentSourcePath: SETTINGS_PATH,
      componentSourcePaths: [FEATURE_PATH, SETTINGS_PATH],
      pathname: '/feature/settings',
      pattern: '/feature/settings',
    });
    expect(plan.branches).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ componentName: 'FeatureApp', depth: 0, pattern: '/feature/*' }),
        expect.objectContaining({ componentName: 'AboutPage', depth: 0, pattern: '/about' }),
        expect.objectContaining({
          componentName: 'SettingsPage',
          depth: 1,
          pattern: '/feature/settings',
        }),
        expect.objectContaining({
          componentName: 'DashboardPage',
          depth: 1,
          pattern: '/feature/dashboard',
        }),
      ]),
    );
    expect(plan.dependencyPaths).toContain(ROUTER_PATH);
    expect(plan.dependencyPaths).toContain(FEATURE_ROUTER_PATH);
    expect(plan.dependencyPaths).toContain(SETTINGS_PATH);
    expect(plan.dependencyPaths).not.toContain(ABOUT_PATH);
    expect(plan.dependencyPaths).not.toContain(DASHBOARD_PATH);
    expect(readPaths).not.toContain(ABOUT_PATH);
    expect(readPaths).not.toContain(DASHBOARD_PATH);
    const settingsBranch = plan.branches.find(
      (branch) => branch.componentName === 'SettingsPage' && branch.pattern === '/feature/settings',
    );
    expect(settingsBranch?.selectionPath).toEqual([
      { componentName: 'FeatureApp', pattern: '/feature/*' },
      { componentName: 'SettingsPage', pattern: '/feature/settings' },
    ]);
  });

  it('retains a direct nested useRoutes owner while keeping sibling route metadata inert', async () => {
    const nestedOwnerPath = '/workspace/src/NestedOwner.tsx';
    const childPath = '/workspace/src/ChildPage.tsx';
    const siblingPath = '/workspace/src/SiblingPage.tsx';
    const sources: Readonly<Record<string, string>> = {
      [APP_PATH]: [
        'import { Routes, Route } from "react-router-dom";',
        'import NestedOwner from "./NestedOwner";',
        'import SiblingPage from "./SiblingPage";',
        'export default function App() {',
        '  return <Routes><Route path="/root/*" element={<NestedOwner />} /><Route path="/sibling" element={<SiblingPage />} /></Routes>;',
        '}',
      ].join('\n'),
      [nestedOwnerPath]: [
        'import { useRoutes } from "react-router-dom";',
        'import ChildPage from "./ChildPage";',
        'export default function NestedOwner() {',
        '  return useRoutes([{ path: "child", element: <ChildPage /> }]);',
        '}',
      ].join('\n'),
      [childPath]: 'export default function ChildPage() { return <main>child</main>; }',
      [siblingPath]: 'export default function SiblingPage() { return <main>sibling</main>; }',
    };
    const resolveModule = (moduleSpecifier: string, consumerPath: string): string | undefined =>
      new Map([
        [`${APP_PATH}\0./NestedOwner`, nestedOwnerPath],
        [`${APP_PATH}\0./SiblingPage`, siblingPath],
        [`${nestedOwnerPath}\0./ChildPage`, childPath],
      ]).get(`${consumerPath}\0${moduleSpecifier}`);

    const plan = await collectPreviewInspectorRouteBranchPlan({
      documentPath: APP_PATH,
      exportName: 'default',
      readSource: (sourcePath) => Promise.resolve(sources[sourcePath]),
      renderChain: createAppRenderChain(),
      resolveModule,
      selection: [
        { componentName: 'NestedOwner', pattern: '/root/*' },
        { componentName: 'ChildPage', pattern: '/root/child' },
      ],
      sourcePaths: Object.keys(sources),
    });

    expect(plan.activeLocation).toMatchObject({
      componentName: 'ChildPage',
      pathname: '/root/child',
      routeMounts: [
        {
          basePath: '/root',
          contextPattern: '/root/*',
          exportName: 'default',
          hasWildcardFallback: false,
          routeSlotCount: 1,
          sourcePath: nestedOwnerPath,
        },
      ],
    });
    expect(plan.branches).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ componentName: 'NestedOwner', pattern: '/root/*' }),
        expect.objectContaining({ componentName: 'ChildPage', pattern: '/root/child' }),
        expect.objectContaining({ componentName: 'SiblingPage', pattern: '/sibling' }),
      ]),
    );
  });

  it('reports the effective leaf when selecting an already-active parent resolves its default child', async () => {
    const sources = createNestedRouterSources();
    const plan = await collectPreviewInspectorRouteBranchPlan({
      documentPath: APP_PATH,
      exportName: 'default',
      readSource: (sourcePath) => Promise.resolve(sources[sourcePath]),
      renderChain: createAppRenderChain(),
      resolveModule: resolveFixtureModule,
      selection: [{ componentName: 'FeatureApp', pattern: '/feature/*' }],
      sourcePaths: Object.keys(sources),
    });

    const featureBranch = plan.branches.find(
      (branch) => branch.componentName === 'FeatureApp' && branch.pattern === '/feature/*',
    );
    const effectiveLeaf = plan.branches.find((branch) => branch.id === plan.selectedBranchId);

    expect(plan.selectionResolution).toBe('exact');
    expect(featureBranch).toMatchObject({ childState: 'expanded' });
    expect(effectiveLeaf).toMatchObject({ depth: 1, parentId: featureBranch?.id });
    expect(plan.selectedBranchId).toBe(effectiveLeaf?.id);
    expect(plan.selectedBranchId).not.toBe(featureBranch?.id);
  });

  /** Treats inline element layouts as composition and exposes only the terminal page as a leaf. */
  it('follows a wrapped route element to its actual page component', async () => {
    const layoutPath = '/workspace/src/RouteLayout.tsx';
    const pagePath = '/workspace/src/SelectedPage.tsx';
    const sources: Readonly<Record<string, string>> = {
      [APP_PATH]: [
        'import { createBrowserRouter, RouterProvider } from "react-router-dom";',
        'import RouteLayout from "./RouteLayout";',
        'import SelectedPage from "./SelectedPage";',
        'const router = createBrowserRouter([',
        '  { path: "/selected", element: <RouteLayout><SelectedPage /></RouteLayout> },',
        ']);',
        'export default function App() { return <RouterProvider router={router} />; }',
      ].join('\n'),
      [layoutPath]: [
        'export default function RouteLayout({ children }) {',
        '  return <section data-layout="route">{children}</section>;',
        '}',
      ].join('\n'),
      [pagePath]: 'export default function SelectedPage() { return <main>selected</main>; }',
    };
    const resolveModule = (moduleSpecifier: string, consumerPath: string): string | undefined =>
      new Map([
        [`${APP_PATH}\0./RouteLayout`, layoutPath],
        [`${APP_PATH}\0./SelectedPage`, pagePath],
      ]).get(`${consumerPath}\0${moduleSpecifier}`);

    const inventory = await collectPreviewInspectorDirectRouteChoices({
      readSource: (sourcePath) => Promise.resolve(sources[sourcePath]),
      resolveModule,
      sourcePath: APP_PATH,
      sourceText: sources[APP_PATH],
    });
    const plan = await collectPreviewInspectorRouteBranchPlan({
      documentPath: APP_PATH,
      exportName: 'default',
      readSource: (sourcePath) => Promise.resolve(sources[sourcePath]),
      renderChain: createAppRenderChain(),
      resolveModule,
      selection: [{ componentName: 'SelectedPage', pattern: '/selected' }],
      sourcePaths: Object.keys(sources),
    });

    expect(inventory.choices).toEqual([
      expect.objectContaining({
        componentName: 'SelectedPage',
        elementPath: [
          {
            componentName: 'RouteLayout',
            reference: { exportName: 'default', sourcePath: layoutPath },
          },
          {
            componentName: 'SelectedPage',
            reference: { exportName: 'default', sourcePath: pagePath },
          },
        ],
        pattern: '/selected',
        reference: { exportName: 'default', sourcePath: pagePath },
      }),
    ]);
    expect(plan.activeLocation).toMatchObject({
      componentExportName: 'default',
      componentName: 'SelectedPage',
      componentSourcePath: pagePath,
      elementWrappers: [
        {
          componentName: 'RouteLayout',
          exportName: 'default',
          sourcePath: layoutPath,
        },
      ],
      pathname: '/selected',
    });
    expect(plan.branches).toEqual([
      expect.objectContaining({
        childState: 'leaf',
        componentName: 'SelectedPage',
        depth: 0,
        pattern: '/selected',
      }),
    ]);
    expect(plan.branches.some((branch) => branch.componentName === 'RouteLayout')).toBe(false);
  });

  /** Route-owner analysis is cycle-bounded, not cut off by the former eight-level graph budget. */
  it('continues through more than eight nested route owners until the first leaf page', async () => {
    const ownerCount = 12;
    const ownerPaths = Array.from(
      { length: ownerCount },
      (_value, index) => `/workspace/src/Owner${index.toString()}.tsx`,
    );
    const sources: Record<string, string> = {
      [APP_PATH]: [
        'import { useRoutes } from "react-router-dom";',
        'import Owner0 from "./Owner0";',
        'export default function App() {',
        '  return useRoutes([{ path: "/level-0/*", element: <Owner0 /> }]);',
        '}',
      ].join('\n'),
    };
    const resolutions = new Map<string, string>([[`${APP_PATH}\0./Owner0`, ownerPaths[0] ?? '']]);
    for (let index = 0; index < ownerCount; index += 1) {
      const ownerPath = ownerPaths[index];
      if (ownerPath === undefined) continue;
      const nextPath = ownerPaths[index + 1];
      if (nextPath === undefined) {
        sources[ownerPath] =
          'export default function Owner11() { return <main>terminal page</main>; }';
        continue;
      }
      const nextName = `Owner${(index + 1).toString()}`;
      sources[ownerPath] = [
        'import { useRoutes } from "react-router-dom";',
        `import ${nextName} from "./${nextName}";`,
        `export default function Owner${index.toString()}() {`,
        `  return useRoutes([{ path: "level-${(index + 1).toString()}/*", element: <${nextName} /> }]);`,
        '}',
      ].join('\n');
      resolutions.set(`${ownerPath}\0./${nextName}`, nextPath);
    }

    const plan = await collectPreviewInspectorRouteBranchPlan({
      documentPath: APP_PATH,
      exportName: 'default',
      readSource: (sourcePath) => Promise.resolve(sources[sourcePath]),
      renderChain: createAppRenderChain(),
      resolveModule: (moduleSpecifier, consumerPath) =>
        resolutions.get(`${consumerPath}\0${moduleSpecifier}`),
      sourcePaths: Object.keys(sources),
    });
    const selected = plan.branches.find((branch) => branch.id === plan.selectedBranchId);

    expect(plan.branches).toHaveLength(ownerCount);
    expect(selected).toMatchObject({
      childState: 'leaf',
      componentName: 'Owner11',
      depth: ownerCount - 1,
    });
    expect(selected?.selectionPath).toHaveLength(ownerCount);
    expect(plan.activeLocation?.componentSourcePath).toBe(ownerPaths.at(-1));
  });

  /** Follows a router whose descriptor array is itself imported from a separate metadata module. */
  it('reads an imported route descriptor aggregate without reading its page module', async () => {
    const configPath = '/workspace/src/config-router.tsx';
    const routesPath = '/workspace/src/routes.tsx';
    const pagePath = '/workspace/src/ImportedRoutesPage.tsx';
    const sources: Readonly<Record<string, string>> = {
      [APP_PATH]: [
        'import { RouterProvider } from "react-router-dom";',
        'import { router } from "./config-router";',
        'export default function App() { return <RouterProvider router={router} />; }',
      ].join('\n'),
      [configPath]: [
        'import { createBrowserRouter } from "react-router-dom";',
        'import routes from "./routes";',
        'export const router = createBrowserRouter(routes);',
      ].join('\n'),
      [routesPath]: [
        'import ImportedRoutesPage from "./ImportedRoutesPage";',
        'export default [{ path: "/imported-routes", element: <ImportedRoutesPage /> }];',
      ].join('\n'),
      [pagePath]: 'export default function ImportedRoutesPage() { return <main>imported</main>; }',
    };
    const readPaths: string[] = [];
    const inventory = await collectPreviewInspectorDirectRouteChoices({
      readSource: (sourcePath) => {
        readPaths.push(sourcePath);
        return Promise.resolve(sources[sourcePath]);
      },
      resolveModule: (moduleSpecifier, consumerPath) =>
        new Map([
          [`${APP_PATH}\0./config-router`, configPath],
          [`${configPath}\0./routes`, routesPath],
          [`${routesPath}\0./ImportedRoutesPage`, pagePath],
        ]).get(`${consumerPath}\0${moduleSpecifier}`),
      sourcePath: APP_PATH,
      sourceText: sources[APP_PATH],
    });

    expect(inventory.choices).toEqual([
      expect.objectContaining({
        componentName: 'ImportedRoutesPage',
        pattern: '/imported-routes',
        reference: { exportName: 'default', sourcePath: pagePath },
      }),
    ]);
    expect(inventory.dependencyPaths).toEqual([APP_PATH, configPath, routesPath].sort());
    expect(readPaths).not.toContain(pagePath);
  });

  it('does not emit explicit route elements that own substantive JSX route children', async () => {
    const sourceText = [
      'const routeNodes = [<Route path={buildPath()} element={<DestinationPage />} />];',
      'const buildPath = () => "/destination";',
      'const comment = null;',
      '<Routes>',
      '  <Route path="/*">',
      '    <Route element={<AccessBoundary />}>{routeNodes}</Route>',
      '    <Route Component={InlineBoundary}><Route path="inline" element={<InlinePage />} /></Route>',
      '    <Route component={LowerBoundary}>{routeNodes}</Route>',
      '    <Route index element={<IndexBoundary />}><Route path="nested" element={<NestedIndexPage />} /></Route>',
      '    <Route index element={<IndexPage />}>{/* comment */}</Route>',
      '    <Route path="comment" element={<CommentPage />}>  {/* comment */}  </Route>',
      '    <Route path="self-closing" element={<SelfClosingPage />} />',
      '    <Route path="legacy"><LegacyPage /></Route>',
      '  </Route>',
      '</Routes>;',
    ].join('\n');
    const inventory = await collectPreviewInspectorDirectRouteChoices({
      readSource: () => Promise.resolve(undefined),
      resolveModule: () => undefined,
      sourcePath: ROUTER_PATH,
      sourceText,
    });

    expect(inventory.choices.map((choice) => choice.componentName)).not.toEqual(
      expect.arrayContaining([
        'AccessBoundary',
        'InlineBoundary',
        'LowerBoundary',
        'IndexBoundary',
      ]),
    );
    expect(inventory.choices).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          componentName: 'DestinationPage',
          pathResolution: 'unresolved',
        }),
        expect.objectContaining({ componentName: 'InlinePage', pattern: '/inline' }),
        expect.objectContaining({ componentName: 'NestedIndexPage', pattern: '/nested' }),
        expect.objectContaining({ componentName: 'IndexPage', pattern: '/' }),
        expect.objectContaining({ componentName: 'CommentPage', pattern: '/comment' }),
        expect.objectContaining({ componentName: 'SelfClosingPage', pattern: '/self-closing' }),
        expect.objectContaining({ componentName: 'LegacyPage', pattern: '/legacy' }),
      ]),
    );
    expect(
      inventory.choices.some(
        (choice) =>
          ['AccessBoundary', 'InlineBoundary', 'LowerBoundary', 'IndexBoundary'].includes(
            choice.componentName,
          ) && choice.pattern === '/*',
      ),
    ).toBe(false);
    expect(
      inventory.choices.some(
        (choice) => choice.pathResolution === 'resolved' && choice.pattern.startsWith('/*/'),
      ),
    ).toBe(false);
  });

  it('does not select a catalog leaf by name without exact catalog provenance', async () => {
    const terminalPath = '/workspace/src/TerminalPage.tsx';
    const layoutPath = '/workspace/src/TerminalLayout.tsx';
    const mapPath = '/workspace/src/pages-map.ts';
    const catalogPath = '/workspace/src/pages.json';
    const sources: Record<string, string> = {
      [APP_PATH]: [
        'import TerminalPage from "./TerminalPage";',
        'import TerminalLayout from "./TerminalLayout";',
        'const dynamicPath = () => "/terminal";',
        'const routeNodes = [',
        '  <Route path={dynamicPath()} element={<TerminalLayout><TerminalPage /></TerminalLayout>} />,',
        '  <Route path="*" element={<MissingPage />} />,',
        '];',
        'export default function App() {',
        '  return <Routes><Route path="/*"><Route element={<AccessBoundary />}>{routeNodes}</Route></Route></Routes>;',
        '}',
      ].join('\n'),
      [terminalPath]: 'export default function TerminalPage() { return <main />; }',
      [layoutPath]:
        'export default function TerminalLayout({ children }) { return <section>{children}</section>; }',
      [mapPath]: 'import pages from "./pages.json"; export default pages;',
      [catalogPath]: JSON.stringify({ concrete: { index: 'TerminalPage' } }),
    };
    const resolveModule = (moduleSpecifier: string, consumerPath: string): string | undefined =>
      new Map([
        [`${APP_PATH}\0./TerminalPage`, terminalPath],
        [`${APP_PATH}\0./TerminalLayout`, layoutPath],
        [`${mapPath}\0./pages.json`, catalogPath],
      ]).get(`${consumerPath}\0${moduleSpecifier}`);
    const plan = await collectPreviewInspectorRouteBranchPlan({
      documentPath: APP_PATH,
      exportName: 'default',
      readSource: (sourcePath) => Promise.resolve(sources[sourcePath]),
      renderChain: createAppRenderChain(),
      resolveModule,
      sourcePaths: [APP_PATH, mapPath],
    });
    const selected = plan.branches.find((branch) => branch.id === plan.selectedBranchId);

    expect(plan.activeLocation).toMatchObject({
      componentName: 'MissingPage',
      evidenceKind: 'route-jsx',
      pattern: '/*',
    });
    expect(plan.activeLocation?.componentName).not.toBe('TerminalPage');
    expect(plan.activeLocation?.componentSourcePath).toBeUndefined();
    expect(plan.branches.some((branch) => branch.componentName === 'AccessBoundary')).toBe(false);
    expect(
      plan.branches.some(
        (branch) =>
          branch.componentName === 'TerminalPage' && ['/*', '/preview'].includes(branch.pattern),
      ),
    ).toBe(false);
    expect(plan.selectionResolution).toBe('automatic');
    expect(selected).toMatchObject({ componentName: 'MissingPage', pattern: '/*' });
    expect(selected?.componentName).not.toBe('TerminalPage');
  });

  it('rematerializes a nested terminal wildcard shadowed by an exact root redirect', async () => {
    const plan = await collectNestedTerminalWildcardPlan(true);
    const redirect = plan.branches.find((branch) => branch.componentName === 'CmeRootRedirect');
    const notFound = plan.branches.find((branch) => branch.componentName === 'NotFoundStatus');

    expect(plan.activeLocation).toMatchObject({
      componentName: 'CmeRootRedirect',
      pathname: '/cme/1',
    });
    expect(redirect?.pathname).toBe('/cme/1');
    expect(notFound).toMatchObject({
      pathname: '/cme/1/preview',
      selectable: true,
    });
    expect(notFound?.pathname).not.toBe(redirect?.pathname);

    const selected = await collectNestedTerminalWildcardPlan(true, notFound?.selectionPath);
    expect(selected.selectionResolution).toBe('exact');
    expect(selected.activeLocation).toMatchObject({
      componentName: 'NotFoundStatus',
      pathname: '/cme/1/preview',
    });
  });

  it('preserves a nested terminal wildcard without an exact root sibling', async () => {
    const plan = await collectNestedTerminalWildcardPlan(false);
    const notFound = plan.branches.find((branch) => branch.componentName === 'NotFoundStatus');

    expect(plan.activeLocation).toMatchObject({
      componentName: 'NotFoundStatus',
      pathname: '/cme/1',
    });
    expect(notFound).toMatchObject({
      childState: 'leaf',
      pathname: '/cme/1',
      selectable: true,
    });
    expect(notFound?.pattern.endsWith('/*')).toBe(true);
  });

  it('memoizes exact owners while composing repeated parent mounts independently', async () => {
    const sharedOwnerPath = '/workspace/src/SharedOwner.tsx';
    const childPath = '/workspace/src/Child.tsx';
    const sources: Readonly<Record<string, string>> = {
      [APP_PATH]: [
        'import { Route, Routes } from "react-router-dom";',
        'import SharedOwner from "./SharedOwner";',
        'export default function App() {',
        '  return <Routes>',
        '    <Route path="/left/*" element={<SharedOwner />} />',
        '    <Route path="/right/*" element={<SharedOwner />} />',
        '  </Routes>;',
        '}',
      ].join('\n'),
      [sharedOwnerPath]: [
        'import { useRoutes } from "react-router-dom";',
        'import Child from "./Child";',
        'export default function SharedOwner() {',
        '  return useRoutes([{ path: "child", element: <Child /> }]);',
        '}',
        'export function NamedOwner() {',
        '  return useRoutes([{ path: "named", element: <Child /> }]);',
        '}',
      ].join('\n'),
      [childPath]: 'export default function Child() { return <main>child</main>; }',
    };
    const resolveModule = (moduleSpecifier: string, consumerPath: string): string | undefined =>
      new Map([
        [`${APP_PATH}\0./SharedOwner`, sharedOwnerPath],
        [`${sharedOwnerPath}\0./Child`, childPath],
      ]).get(`${consumerPath}\0${moduleSpecifier}`);
    const fixedOptions = Object.freeze({
      readSource: (sourcePath: string) => Promise.resolve(sources[path.normalize(sourcePath)]),
      renderChain: createAppRenderChain(),
      resolveModule,
      sourcePaths: Object.freeze(Object.keys(sources)),
    });
    const retainedMemo = createPreviewInspectorRouteOwnerLocationInventoryMemo(fixedOptions);
    const counts = { hits: 0, misses: 0, requests: 0 };
    const identities = new Set<string>();
    const countingMemo: PreviewInspectorRouteOwnerLocationInventoryMemo = Object.freeze({
      collect: (documentPath: string, exportName: string) => {
        counts.requests += 1;
        const identity = JSON.stringify([path.normalize(documentPath), exportName]);
        if (identities.has(identity)) {
          counts.hits += 1;
        } else {
          identities.add(identity);
          counts.misses += 1;
        }
        return retainedMemo.collect(documentPath, exportName);
      },
      release: () => {
        retainedMemo.release();
      },
    });
    const selections = [
      [
        { componentName: 'SharedOwner', pattern: '/left/*' },
        { componentName: 'Child', pattern: '/left/child' },
      ],
      [
        { componentName: 'SharedOwner', pattern: '/right/*' },
        { componentName: 'Child', pattern: '/right/child' },
      ],
    ] as const;
    const uncachedPlans = [];
    const cachedPlans = [];
    for (const selection of selections) {
      uncachedPlans.push(
        await collectPreviewInspectorRouteBranchPlan({
          ...fixedOptions,
          documentPath: APP_PATH,
          exportName: 'default',
          selection,
        }),
      );
      cachedPlans.push(
        await collectPreviewInspectorRouteBranchPlan({
          ...fixedOptions,
          documentPath: APP_PATH,
          exportName: 'default',
          ownerLocationInventoryMemo: countingMemo,
          selection,
        }),
      );
    }

    expect(JSON.stringify(cachedPlans)).toBe(JSON.stringify(uncachedPlans));
    expect(cachedPlans).toEqual(uncachedPlans);
    expect(counts).toEqual({ hits: 3, misses: 3, requests: 6 });
    expect(counts.requests).toBe(counts.hits + counts.misses);
    expect(counts.misses).toBe(identities.size);
    expect(counts.misses).toBeLessThan(6);
    expect(cachedPlans.map((plan) => plan.activeLocation?.pattern)).toEqual([
      '/left/child',
      '/right/child',
    ]);
    expect(cachedPlans[0]?.activeLocation?.routeMounts?.[0]?.basePath).toBe('/left');
    expect(cachedPlans[1]?.activeLocation?.routeMounts?.[0]?.basePath).toBe('/right');
    expect(cachedPlans.every((plan) => plan.dependencyPaths.includes(sharedOwnerPath))).toBe(true);
    expect(cachedPlans.every((plan) => plan.dependencyPaths.includes(childPath))).toBe(true);

    countingMemo.release();
    await expect(countingMemo.collect(APP_PATH, 'default')).rejects.toThrow(
      'owner-location inventory memo was already released',
    );

    let ownerReads = 0;
    const exportMemo = createPreviewInspectorRouteOwnerLocationInventoryMemo({
      ...fixedOptions,
      readSource: (sourcePath) => {
        if (path.normalize(sourcePath) === sharedOwnerPath) ownerReads += 1;
        return Promise.resolve(sources[path.normalize(sourcePath)]);
      },
    });
    const defaultInventory = await exportMemo.collect(sharedOwnerPath, 'default');
    const namedInventory = await exportMemo.collect(sharedOwnerPath, 'NamedOwner');
    const repeatedDefaultInventory = await exportMemo.collect(sharedOwnerPath, 'default');
    expect(repeatedDefaultInventory).toBe(defaultInventory);
    expect(namedInventory).not.toBe(defaultInventory);
    expect(ownerReads).toBe(2);
    exportMemo.release();
  });

  it('reuses only exact nonterminal prefixes while preserving complete plans byte-for-byte', async () => {
    const sources = createNestedRouterSources();
    const provider = createPreviewInspectorRouteBranchSelectionPrefixProvider();
    let phase: 'oracle' | 'retained' = 'oracle';
    const reads = { oracle: 0, retained: 0 };
    const resolutions = { oracle: 0, retained: 0 };
    const sharedOptions = {
      documentPath: APP_PATH,
      exportName: 'default',
      readSource: (sourcePath: string) => {
        reads[phase] += 1;
        return Promise.resolve(sources[sourcePath]);
      },
      renderChain: createAppRenderChain(),
      resolveModule: (moduleSpecifier: string, consumerPath: string) => {
        resolutions[phase] += 1;
        return resolveFixtureModule(moduleSpecifier, consumerPath);
      },
      sourcePaths: Object.keys(sources),
    };
    const selections = [
      [
        { componentName: 'FeatureApp', pattern: '/feature/*' },
        { componentName: 'SettingsPage', pattern: '/feature/settings' },
      ],
      [
        { componentName: 'FeatureApp', pattern: '/feature/*' },
        { componentName: 'DashboardPage', pattern: '/feature/dashboard' },
      ],
    ] as const;
    const oraclePlans = await Promise.all(
      selections.map((selection) =>
        collectPreviewInspectorRouteBranchPlan({ ...sharedOptions, selection }),
      ),
    );
    phase = 'retained';
    const retainedPlans = [];
    for (const selection of selections) {
      retainedPlans.push(
        await collectPreviewInspectorRouteBranchPlan({
          ...sharedOptions,
          selection,
          selectionPrefixProvider: provider,
        }),
      );
    }

    expect(retainedPlans).toEqual(oraclePlans);
    expect(JSON.stringify(retainedPlans)).toBe(JSON.stringify(oraclePlans));
    expect(reads.retained).toBeLessThan(reads.oracle);
    expect(resolutions.retained).toBeLessThan(resolutions.oracle);
    expect(provider.getStatistics()).toEqual({
      computations: 1,
      entries: 1,
      hits: 1,
      released: false,
      requests: 2,
    });
    expect(Object.isFrozen(retainedPlans[0]?.branches)).toBe(true);
    expect(retainedPlans[0]).toEqual(oraclePlans[0]);
    expect(retainedPlans[1]?.branches).not.toBe(retainedPlans[0]?.branches);
    expect(retainedPlans[1]?.branches[0]).not.toBe(retainedPlans[0]?.branches[0]);

    const uncacheableProvider = createPreviewInspectorRouteBranchSelectionPrefixProvider();
    const fallbackSelection = [
      { componentName: 'MissingOwner', pattern: '/missing/*' },
      { componentName: 'MissingLeaf', pattern: '/missing/leaf' },
    ];
    const fallbackOracle = await collectPreviewInspectorRouteBranchPlan({
      ...sharedOptions,
      selection: fallbackSelection,
    });
    for (let attempt = 0; attempt < 2; attempt += 1) {
      const fallback = await collectPreviewInspectorRouteBranchPlan({
        ...sharedOptions,
        selection: fallbackSelection,
        selectionPrefixProvider: uncacheableProvider,
      });
      expect(fallback).toEqual(fallbackOracle);
      expect(JSON.stringify(fallback)).toBe(JSON.stringify(fallbackOracle));
      expect(fallback.selectionResolution).toBe('fallback');
    }
    const finalSelection = [selections[0][0]];
    const finalOracle = await collectPreviewInspectorRouteBranchPlan({
      ...sharedOptions,
      selection: finalSelection,
    });
    const finalWithProvider = await collectPreviewInspectorRouteBranchPlan({
      ...sharedOptions,
      selection: finalSelection,
      selectionPrefixProvider: uncacheableProvider,
    });
    expect(finalWithProvider).toEqual(finalOracle);
    expect(uncacheableProvider.getStatistics()).toEqual({
      computations: 2,
      entries: 0,
      hits: 0,
      released: false,
      requests: 2,
    });

    const nonretainedProvider = createPreviewInspectorRouteBranchSelectionPrefixProvider();
    const nonretainedSelections = [
      undefined,
      [{ componentName: 'AboutPage', pattern: '/about' }],
      [{ componentName: 'FeatureApp', pattern: '/feature/*' }],
    ] as const;
    for (const selection of nonretainedSelections) {
      const oracle = await collectPreviewInspectorRouteBranchPlan({
        ...sharedOptions,
        ...(selection === undefined ? {} : { selection }),
      });
      const retained = await collectPreviewInspectorRouteBranchPlan({
        ...sharedOptions,
        ...(selection === undefined ? {} : { selection }),
        selectionPrefixProvider: nonretainedProvider,
      });
      expect(retained).toEqual(oracle);
      expect(JSON.stringify(retained)).toBe(JSON.stringify(oracle));
    }
    expect(nonretainedProvider.getStatistics()).toEqual({
      computations: 0,
      entries: 0,
      hits: 0,
      released: false,
      requests: 0,
    });

    provider.release();
    uncacheableProvider.release();
    nonretainedProvider.release();
    expect(provider.getStatistics().entries).toBe(0);
    expect(uncacheableProvider.getStatistics().entries).toBe(0);
  });

  it('preserves generic deep divergence, duplicate, unresolved, and export-sensitive plans', async () => {
    const ownerAPath = '/workspace/src/OwnerA.tsx';
    const ownerBPath = '/workspace/src/OwnerB.tsx';
    const sidesPath = '/workspace/src/Sides.tsx';
    const leafPath = '/workspace/src/DeepLeaf.tsx';
    const sources: Readonly<Record<string, string>> = {
      [APP_PATH]: [
        'import { Route, Routes } from "react-router-dom";',
        'import OwnerA from "./OwnerA";',
        'export default function App() {',
        '  return <Routes><Route path="/root/*" element={<OwnerA />} /></Routes>;',
        '}',
      ].join('\n'),
      [ownerAPath]: [
        'import { Route, Routes } from "react-router-dom";',
        'import OwnerB from "./OwnerB";',
        'export default function OwnerA() {',
        '  return <Routes><Route path="branch/*" element={<OwnerB />} /></Routes>;',
        '}',
      ].join('\n'),
      [ownerBPath]: [
        'import { Route, Routes } from "react-router-dom";',
        'import DefaultSide, { NamedSide } from "./Sides";',
        'const dynamicPath = getPath();',
        'export default function OwnerB() {',
        '  return <Routes>',
        '    <Route path="left/*" element={<DefaultSide />} />',
        '    <Route path="left/*" element={<DefaultSide />} />',
        '    <Route path="right/*" element={<NamedSide />} />',
        '    <Route path={dynamicPath} element={<UnknownPage />} />',
        '  </Routes>;',
        '}',
      ].join('\n'),
      [sidesPath]: [
        'import { Route, Routes } from "react-router-dom";',
        'import DeepLeaf from "./DeepLeaf";',
        'export default function DefaultSide() {',
        '  return <Routes><Route path="end" element={<DeepLeaf />} /></Routes>;',
        '}',
        'export function NamedSide() {',
        '  return <Routes><Route path="end" element={<DeepLeaf />} /></Routes>;',
        '}',
      ].join('\n'),
      [leafPath]: 'export default function DeepLeaf() { return <main>leaf</main>; }',
    };
    const resolutions = new Map([
      [`${APP_PATH}\0./OwnerA`, ownerAPath],
      [`${ownerAPath}\0./OwnerB`, ownerBPath],
      [`${ownerBPath}\0./Sides`, sidesPath],
      [`${sidesPath}\0./DeepLeaf`, leafPath],
    ]);
    let phase: 'oracle' | 'retained' = 'oracle';
    const readCounts = { oracle: 0, retained: 0 };
    const resolveCounts = { oracle: 0, retained: 0 };
    const options = {
      documentPath: APP_PATH,
      exportName: 'default',
      readSource: (sourcePath: string) => {
        readCounts[phase] += 1;
        return Promise.resolve(sources[sourcePath]);
      },
      renderChain: createAppRenderChain(),
      resolveModule: (moduleSpecifier: string, consumerPath: string) => {
        resolveCounts[phase] += 1;
        return resolutions.get(`${consumerPath}\0${moduleSpecifier}`);
      },
      sourcePaths: Object.keys(sources),
    };
    const selections = [
      [
        { componentName: 'OwnerA', pattern: '/root/*' },
        { componentName: 'OwnerB', pattern: '/root/branch/*' },
        { componentName: 'DefaultSide', pattern: '/root/branch/left/*' },
        { componentName: 'DeepLeaf', pattern: '/root/branch/left/end' },
      ],
      [
        { componentName: 'OwnerA', pattern: '/root/*' },
        { componentName: 'OwnerB', pattern: '/root/branch/*' },
        { componentName: 'NamedSide', pattern: '/root/branch/right/*' },
        { componentName: 'DeepLeaf', pattern: '/root/branch/right/end' },
      ],
    ] as const;
    const oraclePlans: Awaited<ReturnType<typeof collectPreviewInspectorRouteBranchPlan>>[] = [];
    for (const selection of selections) {
      oraclePlans.push(await collectPreviewInspectorRouteBranchPlan({ ...options, selection }));
    }
    phase = 'retained';
    const provider = createPreviewInspectorRouteBranchSelectionPrefixProvider();
    const retainedPlans: Awaited<ReturnType<typeof collectPreviewInspectorRouteBranchPlan>>[] = [];
    for (const selection of selections) {
      retainedPlans.push(
        await collectPreviewInspectorRouteBranchPlan({
          ...options,
          selection,
          selectionPrefixProvider: provider,
        }),
      );
    }

    retainedPlans.forEach((plan, index) => {
      expect(plan).toEqual(oraclePlans[index]);
      expect(JSON.stringify(plan)).toBe(JSON.stringify(oraclePlans[index]));
      expect(plan.branches.some((branch) => branch.componentName === 'UnknownPage')).toBe(true);
      expect(plan.branches.some((branch) => branch.duplicateOf !== undefined)).toBe(true);
    });
    const leftOwner = retainedPlans[0]?.branches.find(
      (branch) => branch.componentName === 'DefaultSide',
    );
    const rightOwner = retainedPlans[1]?.branches.find(
      (branch) => branch.componentName === 'NamedSide',
    );
    expect(leftOwner).toMatchObject({ exportName: 'default', sourcePath: sidesPath });
    expect(rightOwner).toMatchObject({ exportName: 'NamedSide', sourcePath: sidesPath });
    expect(provider.getStatistics()).toEqual({
      computations: 4,
      entries: 4,
      hits: 2,
      released: false,
      requests: 6,
    });
    expect(readCounts.retained).toBeLessThan(readCounts.oracle);
    expect(resolveCounts.retained).toBeLessThan(resolveCounts.oracle);
    expect(retainedPlans[1]?.branches).not.toBe(retainedPlans[0]?.branches);
    expect(retainedPlans[1]?.branches[0]).not.toBe(retainedPlans[0]?.branches[0]);
    provider.release();
    expect(provider.getStatistics().entries).toBe(0);
  });

  it('preserves cycle and rejection identity without retaining failed prefix work', async () => {
    const cyclePath = '/workspace/src/Cycle.tsx';
    const cycleSources: Readonly<Record<string, string>> = {
      [APP_PATH]: [
        'import { Route, Routes } from "react-router-dom";',
        'import Cycle from "./Cycle";',
        'export default function App() {',
        '  return <Routes><Route path="/cycle/*" element={<Cycle />} /></Routes>;',
        '}',
      ].join('\n'),
      [cyclePath]: [
        'import { Route, Routes } from "react-router-dom";',
        'import App from "./App";',
        'export default function Cycle() {',
        '  return <Routes><Route path="back/*" element={<App />} /></Routes>;',
        '}',
      ].join('\n'),
    };
    const selection = [
      { componentName: 'Cycle', pattern: '/cycle/*' },
      { componentName: 'App', pattern: '/cycle/back/*' },
    ];
    const fixedOptions = {
      documentPath: APP_PATH,
      exportName: 'default',
      readSource: (sourcePath: string) => Promise.resolve(cycleSources[sourcePath]),
      renderChain: createAppRenderChain(),
      resolveModule: (moduleSpecifier: string, consumerPath: string) =>
        new Map([
          [`${APP_PATH}\0./Cycle`, cyclePath],
          [`${cyclePath}\0./App`, APP_PATH],
        ]).get(`${consumerPath}\0${moduleSpecifier}`),
      selection,
      sourcePaths: Object.keys(cycleSources),
    };
    const oracle = await collectPreviewInspectorRouteBranchPlan(fixedOptions);
    const provider = createPreviewInspectorRouteBranchSelectionPrefixProvider();
    const retained = await collectPreviewInspectorRouteBranchPlan({
      ...fixedOptions,
      selectionPrefixProvider: provider,
    });
    const hit = await collectPreviewInspectorRouteBranchPlan({
      ...fixedOptions,
      selectionPrefixProvider: provider,
    });
    expect(retained).toEqual(oracle);
    expect(hit).toEqual(oracle);
    expect(JSON.stringify(retained)).toBe(JSON.stringify(oracle));
    expect(JSON.stringify(hit)).toBe(JSON.stringify(oracle));
    expect(provider.getStatistics()).toEqual({
      computations: 1,
      entries: 1,
      hits: 1,
      released: false,
      requests: 2,
    });

    const rejection = new Error('synthetic prefix computation rejection');
    const rejectingProvider = createPreviewInspectorRouteBranchSelectionPrefixProvider();
    const rejectingOptions = {
      ...fixedOptions,
      readSource: (sourcePath: string) =>
        sourcePath === APP_PATH
          ? Promise.reject(rejection)
          : Promise.resolve(cycleSources[sourcePath]),
      selectionPrefixProvider: rejectingProvider,
    };
    await expect(collectPreviewInspectorRouteBranchPlan(rejectingOptions)).rejects.toBe(rejection);
    await expect(collectPreviewInspectorRouteBranchPlan(rejectingOptions)).rejects.toBe(rejection);
    expect(rejectingProvider.getStatistics()).toEqual({
      computations: 2,
      entries: 0,
      hits: 0,
      released: false,
      requests: 2,
    });
    provider.release();
    rejectingProvider.release();
  });
});

/** Builds the nested owner shape used by terminal wildcard shadowing coverage. */
async function collectNestedTerminalWildcardPlan(
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
