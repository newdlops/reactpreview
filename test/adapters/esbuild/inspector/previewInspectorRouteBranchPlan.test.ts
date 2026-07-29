/** Verifies large, nested application route discovery without bundling unselected page modules. */
import { describe, expect, it } from 'vitest';
import {
  collectPreviewInspectorDirectRouteChoices,
  collectPreviewInspectorRouteBranchPlan,
} from '../../../../src/adapters/esbuild/inspector';
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

  it('selects a catalog leaf instead of a pathless explicit route boundary', async () => {
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
      componentName: 'TerminalPage',
      componentSourcePath: terminalPath,
      componentSourcePaths: [terminalPath],
      evidenceKind: 'route-catalog',
      pathname: '/concrete',
      pattern: '/concrete',
      elementWrappers: [
        { componentName: 'TerminalLayout', exportName: 'default', sourcePath: layoutPath },
      ],
    });
    expect(plan.branches.some((branch) => branch.componentName === 'AccessBoundary')).toBe(false);
    expect(
      plan.branches.some(
        (branch) =>
          branch.componentName === 'TerminalPage' && ['/*', '/preview'].includes(branch.pattern),
      ),
    ).toBe(false);
    expect(plan.selectionResolution).toBe('automatic');
    expect(selected).toMatchObject({ componentName: 'TerminalPage', pattern: '/concrete' });
    expect(selected?.componentName).not.toBe('MissingPage');
  });
});
