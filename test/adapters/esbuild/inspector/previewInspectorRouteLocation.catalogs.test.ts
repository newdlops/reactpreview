/** Covers catalogs behavior for previewInspectorRouteLocation. */
/** Verifies authored-source previewInspectorRouteLocation invariants. */
import { describe, expect, it } from 'vitest';

import {
  collectPreviewInspectorDirectRouteChoices,
  collectPreviewInspectorRouteBranchPlan,
  collectPreviewInspectorRouteLocation,
  collectPreviewInspectorRouteLocationInventory,
  type CollectPreviewInspectorRouteLocationOptions,
} from '../../../../src/adapters/esbuild/inspector';

import { APP_PATH, createRenderChain } from './previewInspectorRouteLocationFixtures';

describe('collectPreviewInspectorRouteLocation', () => {
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
