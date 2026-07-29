import { describe, expect, it } from 'vitest';
import ts from 'typescript';
import {
  collectPreviewInspectorDirectRouteChoices,
  collectPreviewInspectorRouteBranchPlan,
  collectPreviewInspectorRouteLocationInventory,
} from '../../../../src/adapters/esbuild/inspector';
import type { PreviewRenderChainPlan } from '../../../../src/adapters/esbuild/renderGraph';
import {
  materializePreviewInspectorRouteBasePath,
  readPreviewInspectorRouteBasePathReference,
} from '../../../../src/adapters/esbuild/inspector/previewInspectorRoutePathMetadata';

const APP_PATH = '/workspace/app/App.tsx';
const COMPANY_PATH = '/workspace/app/CompanyApp.tsx';
const FEATURE_PATH = '/workspace/app/FeatureApp.tsx';

describe('application route patterns', () => {
  it('accepts only exact static base-path expressions and factory exports', async () => {
    const expression = (text: string): ts.Expression => {
      const source = ts.createSourceFile(
        'fixture.tsx',
        `const value = ${text};`,
        ts.ScriptTarget.Latest,
        true,
        ts.ScriptKind.TSX,
      );
      const statement = source.statements[0];
      if (statement === undefined) throw new Error('Fixture declaration missing.');
      if (!ts.isVariableStatement(statement)) throw new Error('Fixture declaration missing.');
      const initializer = statement.declarationList.declarations[0]?.initializer;
      if (initializer === undefined) throw new Error('Fixture expression missing.');
      return initializer;
    };
    const component = { exportName: 'FeatureApp', sourcePath: FEATURE_PATH };
    expect(
      readPreviewInspectorRouteBasePathReference(
        expression('normalize("/a" + ("/b" + FeatureApp.basePath) + "/*")'),
        component,
        'FeatureApp',
      ),
    ).toMatchObject({ prefix: '/a/b', suffix: '/*' });
    expect(
      readPreviewInspectorRouteBasePathReference(
        expression('( "/a" + "/b" ) + FeatureApp.basePath + ( "/c" + "/d" )'),
        component,
        'FeatureApp',
      ),
    ).toMatchObject({ prefix: '/a/b', suffix: '/c/d' });
    for (const value of [
      '"/" + normalize(FeatureApp.basePath)',
      '`${FeatureApp.basePath}/${suffix}`',
      '`${FeatureApp.basePath}${Other.basePath}`',
      'FeatureApp["basePath"]',
      'normalize(FeatureApp.basePath, "/*")',
      'buildPath()',
    ])
      expect(
        readPreviewInspectorRouteBasePathReference(expression(value), component, 'FeatureApp'),
      ).toBeUndefined();

    const sources: Record<string, string> = {
      '/named.tsx': 'export const FeatureApp = createAppModule("/named");',
      '/default.tsx': 'const FeatureApp = createAppModule("/default"); export default FeatureApp;',
      '/direct-default.tsx': 'export default createAppModule("/direct");',
      '/same-file.tsx': 'const LocalApp = createAppModule("/local");',
      '/missing.tsx': 'export const Other = createAppModule("/other");',
      '/ambiguous.tsx':
        'export const FeatureApp = createAppModule("/one"); const Other = createAppModule("/two"); export { Other as FeatureApp };',
      '/broken.tsx': 'export const FeatureApp = createAppModule(',
    };
    const materialize = (sourcePath: string, exportName: string): Promise<string | undefined> =>
      materializePreviewInspectorRouteBasePath(
        { exportName, prefix: '', sourcePath, suffix: '/*' },
        (candidate) => Promise.resolve(sources[candidate]),
      );
    await expect(materialize('/named.tsx', 'FeatureApp')).resolves.toBe('/named/*');
    await expect(materialize('/default.tsx', 'default')).resolves.toBe('/default/*');
    await expect(materialize('/direct-default.tsx', 'default')).resolves.toBe('/direct/*');
    await expect(
      materializePreviewInspectorRouteBasePath(
        {
          exportName: 'LocalApp',
          ownerSourcePath: '/same-file.tsx',
          prefix: '',
          sourcePath: '/same-file.tsx',
          suffix: '/*',
        },
        (candidate) => Promise.resolve(sources[candidate]),
        '/same-file.tsx',
      ),
    ).resolves.toBe('/local/*');
    await expect(materialize('/missing.tsx', 'FeatureApp')).resolves.toBeUndefined();
    await expect(materialize('/ambiguous.tsx', 'FeatureApp')).resolves.toBeUndefined();
    await expect(materialize('/broken.tsx', 'FeatureApp')).resolves.toBeUndefined();
  });

  it('retains exact route base metadata', async () => {
    const sources = {
      [APP_PATH]: [
        'import { createBrowserRouter } from "react-router-dom";',
        'import { CompanyApp } from "./CompanyApp";',
        'import { FeatureApp } from "./FeatureApp";',
        'const OtherApp = CompanyApp;',
        'const routes = <Routes>',
        '  <Route path="/dynamic"><Route path={buildPath()} element={<FeatureApp />} /></Route>',
        '  <Route path={normalize(`${CompanyApp.basePath}/*`)} element={<CompanyApp />} />',
        '  <Route path={normalize(`${OtherApp.basePath}/*`)} element={<CompanyApp />} />',
        '  <Route path={normalize(`${FeatureApp.basePath}`)} element={<FeatureApp />} />',
        '  <Route path="/" element={<FeatureApp />} />',
        '  <Route path={"/feature"} element={<FeatureApp />} />',
        '  <Route path={normalize(`/first${FeatureApp.basePath}/*`)} element={<FeatureApp />} />',
        '  <Route path={normalize(`${FeatureApp.basePath}/second/*`)} element={<FeatureApp />} />',
        '</Routes>;',
        'const objectRoutes = [',
        '  { path: normalize(`${FeatureApp.basePath}/*`), Component: FeatureApp },',
        '  { path: buildPath(), Component: FeatureApp },',
        '];',
        'const router = createBrowserRouter(objectRoutes);',
      ].join('\n'),
      [COMPANY_PATH]: 'export const CompanyApp = createAppModule("/company");',
      [FEATURE_PATH]: 'export const FeatureApp = createAppModule("/feature");',
    };
    const inventory = await collectPreviewInspectorDirectRouteChoices({
      readSource: (sourcePath) => Promise.resolve(sources[sourcePath as keyof typeof sources]),
      resolveModule: (specifier, sourcePath) =>
        specifier === './CompanyApp' && sourcePath === APP_PATH
          ? COMPANY_PATH
          : specifier === './FeatureApp' && sourcePath === APP_PATH
            ? FEATURE_PATH
            : undefined,
      sourcePath: APP_PATH,
      sourceText: sources[APP_PATH],
    });

    const company = inventory.choices.find((choice) => choice.componentName === 'CompanyApp');
    const featureChoices = inventory.choices.filter(
      (choice) => choice.componentName === 'FeatureApp',
    );
    expect(company).toMatchObject({
      pathResolution: 'unresolved',
      routeBasePath: {
        exportName: 'CompanyApp',
        sourcePath: COMPANY_PATH,
        prefix: '',
        suffix: '/*',
      },
    });
    expect(
      featureChoices.some(
        (choice) =>
          choice.pathResolution === 'unresolved' &&
          choice.pattern === '/' &&
          choice.routeBasePath?.sourcePath === FEATURE_PATH,
      ),
    ).toBe(true);
    expect(
      featureChoices.some(
        (choice) =>
          choice.pathResolution === 'resolved' &&
          choice.pattern === '/' &&
          choice.routeBasePath === undefined,
      ),
    ).toBe(true);
    expect(
      featureChoices.some(
        (choice) =>
          choice.pathResolution === 'unresolved' &&
          choice.pattern === '/dynamic' &&
          choice.routeBasePath === undefined,
      ),
    ).toBe(true);
    expect(featureChoices.some((choice) => choice.routeBasePath?.prefix === '/first')).toBe(true);
    expect(featureChoices.some((choice) => choice.routeBasePath?.suffix === '/second/*')).toBe(
      true,
    );
    expect(
      featureChoices.some(
        (choice) => choice.pathResolution === 'resolved' && choice.pattern === '/feature',
      ),
    ).toBe(true);
    expect(
      featureChoices.filter(
        (choice) => choice.pathResolution === 'unresolved' && choice.routeBasePath !== undefined,
      ).length,
    ).toBeGreaterThan(1);
    expect(
      featureChoices.some(
        (choice) =>
          choice.pathResolution === 'resolved' &&
          choice.pattern === '/feature' &&
          choice.routeBasePath === undefined,
      ),
    ).toBe(true);
    expect(
      featureChoices.some(
        (choice) =>
          choice.pathResolution === 'unresolved' &&
          choice.routeBasePath?.sourcePath === FEATURE_PATH,
      ),
    ).toBe(true);
  });

  it('retains namespace and same-file base metadata without accepting unrelated receivers', async () => {
    const sourceText = [
      'import * as Feature from "./FeatureApp";',
      'const LocalApp = createAppModule("/local");',
      'const routes = <Routes>',
      ' <Route path={normalize(`${Feature.FeatureApp.basePath}/*`)} element={<Feature.FeatureApp />} />',
      ' <Route path={normalize(`${LocalApp.basePath}/*`)} element={<LocalApp />} />',
      ' <Route path={normalize(`${Feature.Other.basePath}/*`)} element={<Feature.FeatureApp />} />',
      '</Routes>;',
    ].join('\n');
    const inventory = await collectPreviewInspectorDirectRouteChoices({
      readSource: () => Promise.resolve(undefined),
      resolveModule: (specifier) => (specifier === './FeatureApp' ? FEATURE_PATH : undefined),
      sourcePath: APP_PATH,
      sourceText,
    });
    expect(
      inventory.choices.some(
        (choice) =>
          choice.componentName === 'FeatureApp' &&
          choice.routeBasePath?.sourcePath === FEATURE_PATH,
      ),
    ).toBe(true);
    expect(
      inventory.choices.some(
        (choice) =>
          choice.componentName === 'LocalApp' && choice.routeBasePath?.sourcePath === APP_PATH,
      ),
    ).toBe(true);
    expect(
      inventory.choices.filter(
        (choice) => choice.componentName === 'FeatureApp' && choice.routeBasePath !== undefined,
      ),
    ).toHaveLength(1);
  });

  it('discovers direct registries and materializes same-component factory bases', async () => {
    const pageMapPath = '/workspace/app/pages-map.ts';
    const catalogPath = '/workspace/app/pages.json';
    const publicPagePath = '/workspace/app/PublicPage.tsx';
    const sources = {
      [APP_PATH]: [
        'import { RouterProvider, createBrowserRouter, createRoutesFromElements } from "react-router-dom";',
        'import { CompanyApp } from "./CompanyApp";',
        'import { PublicPage } from "./PublicPage";',
        'import { pageNamePathMap } from "./pages-map";',
        'const publicRoutes = [<Route path="/public-array" Component={PublicPage} />];',
        'const mobileRouter = createBrowserRouter([{ path: "/mobile", Component: PublicPage }]);',
        'const objectRouter = createBrowserRouter([{ path: "/object", component: PublicPage }]);',
        'const elementRouter = createBrowserRouter(createRoutesFromElements(<Route path="/elements" Component={PublicPage} />));',
        'const conditionalRouter = flag ? mobileRouter : objectRouter;',
        'export function App() {',
        '  return <Routes>',
        '    <Route element={<Guard><Layout /></Guard>}>',
        '      {publicRoutes}',
        '    {flag ? <Route path="/conditional" Component={PublicPage} /> : null}',
        '    <Route path="/same"><Route index Component={PublicPage}/><Route path="*" Component={PublicPage}/></Route>',
        '    <Route path={pageNamePathMap["PublicPage"]} element={<PublicPage />} />',
        '    <Route path={getPagePath("PublicPage", {})} Component={PublicPage} />',
        '    <Route path={normalize(`${CompanyApp.basePath}/*`)} element={<CompanyApp />} />',
        '    <Route path="*" element={<Fallback />} />',
        '    </Route>',
        '    <Route path="*" element={<SecondFallback />} />',
        '  </Routes>;',
        '  <RouterProvider router={conditionalRouter} />;',
        '}',
      ].join('\n'),
      [COMPANY_PATH]: 'export const CompanyApp = createAppModule("/company");',
      [publicPagePath]: 'export const PublicPage = () => <main />;',
      [pageMapPath]: 'import pages from "./pages.json"; export const pageNamePathMap = pages;',
      [catalogPath]: JSON.stringify({ public: 'PublicPage' }),
    };
    const renderChain: PreviewRenderChainPlan = {
      dependencyPaths: [APP_PATH],
      paths: [
        {
          entryPoint: {
            kind: 'create-root',
            occurrenceStart: 0,
            sourcePath: APP_PATH,
            wrapperNames: [],
          },
          id: 'app',
          steps: [
            {
              certainty: 'confirmed',
              kind: 'component-render',
              label: 'App',
              occurrenceStart: 0,
              sourcePath: APP_PATH,
              wrapperNames: [],
            },
          ],
        },
      ],
      reachability: 'entry-connected',
      target: { exportName: 'App', sourcePath: APP_PATH },
      truncated: false,
    };
    const resolveModule = (specifier: string, sourcePath: string): string | undefined => {
      if (sourcePath !== APP_PATH)
        return specifier === './pages.json' && sourcePath === pageMapPath ? catalogPath : undefined;
      return (
        {
          './CompanyApp': COMPANY_PATH,
          './PublicPage': publicPagePath,
          './pages-map': pageMapPath,
        } as Record<string, string | undefined>
      )[specifier];
    };
    const reads: string[] = [];
    const options = {
      documentPath: APP_PATH,
      exportName: 'App',
      readSource: (sourcePath: string) => {
        reads.push(sourcePath);
        return Promise.resolve(sources[sourcePath as keyof typeof sources]);
      },
      renderChain,
      resolveModule,
      sourcePaths: [APP_PATH],
    };
    const inventory = await collectPreviewInspectorRouteLocationInventory(options);
    expect(inventory.choices).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          componentName: 'CompanyApp',
          pattern: '/company/*',
          componentSourcePath: COMPANY_PATH,
        }),
        expect.objectContaining({
          componentName: 'PublicPage',
          pattern: '/public',
          componentSourcePath: publicPagePath,
        }),
      ]),
    );
    expect(inventory.primary?.pattern).not.toBe('/*');
    expect(inventory.choices).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ componentName: 'PublicPage', pattern: '/public-array' }),
        expect.objectContaining({ componentName: 'PublicPage', pattern: '/mobile' }),
        expect.objectContaining({ componentName: 'PublicPage', pattern: '/object' }),
        expect.objectContaining({ componentName: 'PublicPage', pattern: '/elements' }),
        expect.objectContaining({ componentName: 'PublicPage', pattern: '/conditional' }),
        expect.objectContaining({ componentName: 'PublicPage', pattern: '/same' }),
        expect.objectContaining({ componentName: 'PublicPage', pattern: '/same/*' }),
      ]),
    );
    expect(inventory.choices.map((choice) => `${choice.componentName}:${choice.pattern}`)).toEqual(
      expect.arrayContaining([
        'PublicPage:/public-array',
        'PublicPage:/public',
        'PublicPage:/mobile',
        'PublicPage:/object',
        'CompanyApp:/company/*',
        'Fallback:/*',
        'SecondFallback:/*',
      ]),
    );
    const company = inventory.choices.find((choice) => choice.componentName === 'CompanyApp');
    expect(company?.componentSourcePath).toBe(COMPANY_PATH);
    expect(company?.dependencyPaths).toEqual(expect.arrayContaining([APP_PATH]));
    const catalog = inventory.choices.find((choice) => choice.pattern === '/public');
    expect(catalog?.dependencyPaths).toEqual(expect.arrayContaining([pageMapPath, catalogPath]));
    expect(inventory.choices.map((choice) => choice.componentName)).not.toEqual(
      expect.arrayContaining(['Guard', 'Layout']),
    );
    expect(reads).not.toContain(publicPagePath);
    const priorityBoundary = await collectPreviewInspectorRouteLocationInventory({
      ...options,
      sourcePaths: [
        APP_PATH,
        ...Array.from(
          { length: 48 },
          (_, index) => `/workspace/other/${String(index)}/pages-map.ts`,
        ),
      ],
    });
    expect(priorityBoundary.choices).toEqual(
      expect.arrayContaining([expect.objectContaining({ pattern: '/public' })]),
    );
    const automatic = await collectPreviewInspectorRouteBranchPlan(options);
    expect(automatic.selectedBranchId).toBeDefined();
    expect(automatic.primary?.pattern).not.toBe('/*');
    const companyBranch = automatic.branches.find((branch) => branch.pattern === '/company/*');
    if (companyBranch === undefined) throw new Error('Expected CompanyApp branch.');
    const explicit = await collectPreviewInspectorRouteBranchPlan({
      ...options,
      selection: companyBranch.selectionPath,
    });
    expect(explicit.selectionResolution).toBe('exact');
    expect(explicit.activeLocation?.pattern).toBe('/company/*');
    const catalogBranch = automatic.branches.find(
      (branch) => branch.componentName === 'PublicPage' && branch.pattern === '/public',
    );
    if (catalogBranch === undefined) throw new Error('Expected catalog branch.');
    const explicitCatalog = await collectPreviewInspectorRouteBranchPlan({
      ...options,
      selection: catalogBranch.selectionPath,
    });
    expect(explicitCatalog.selectionResolution).toBe('exact');
    expect(explicitCatalog.activeLocation).toMatchObject({
      componentName: 'PublicPage',
      pattern: '/public',
    });
  });

  it('fails closed for missing, malformed, dynamic, and route-less location evidence', async () => {
    const renderChain: PreviewRenderChainPlan = {
      dependencyPaths: [APP_PATH],
      paths: [
        {
          entryPoint: {
            kind: 'create-root',
            occurrenceStart: 0,
            sourcePath: APP_PATH,
            wrapperNames: [],
          },
          id: 'failure',
          steps: [
            {
              certainty: 'confirmed',
              kind: 'component-render',
              label: 'App',
              occurrenceStart: 0,
              sourcePath: APP_PATH,
              wrapperNames: [],
            },
          ],
        },
      ],
      reachability: 'entry-connected',
      target: { exportName: 'App', sourcePath: APP_PATH },
      truncated: false,
    };
    const collect = (
      sourceText: string | undefined,
    ): ReturnType<typeof collectPreviewInspectorRouteLocationInventory> =>
      collectPreviewInspectorRouteLocationInventory({
        documentPath: APP_PATH,
        exportName: 'App',
        readSource: (sourcePath) =>
          Promise.resolve(sourcePath === APP_PATH ? sourceText : undefined),
        renderChain,
        sourcePaths: [APP_PATH],
      });
    await expect(collect(undefined)).resolves.toMatchObject({ choices: [] });
    await expect(collect('export function App() { return <main />; }')).resolves.toMatchObject({
      choices: [],
    });
    const dynamic = await collect(
      'export function App(){ return <Routes><Route path={buildPath()} element={<App/>}/><Route path="*" element={<App/>}/></Routes>; }',
    );
    expect(dynamic.choices).toEqual(
      expect.arrayContaining([expect.objectContaining({ pattern: '/*' })]),
    );
    expect(dynamic.choices).not.toEqual(
      expect.arrayContaining([expect.objectContaining({ pattern: '/' })]),
    );
    const literal = await collect(
      'export function App(){ return <Routes><Route path="/literal" element={<App/>}/><Route path="*" element={<Fallback/>}/></Routes>; }',
    );
    expect(literal.choices.map((choice) => choice.pattern)).toEqual(
      expect.arrayContaining(['/literal', '/*']),
    );
    const nonFactory = await collect(
      'const FeatureApp = () => <main/>; export function App(){ return <Routes><Route path={normalize(`${FeatureApp.basePath}/*`)} element={<FeatureApp/>}/><Route path="*" element={<Fallback/>}/></Routes>; }',
    );
    expect(nonFactory.choices.map((choice) => choice.pattern)).toEqual(['/*']);
    const malformedCatalog = await collect(
      'import pages from "./pages-map"; export function App(){ return <Routes><Route path={pages["App"]} element={<App/>}/><Route path="*" element={<Fallback/>}/></Routes>; }',
    );
    expect(malformedCatalog.choices.map((choice) => choice.pattern)).toEqual(['/*']);

    const registryPath = '/workspace/app/pages-map.ts';
    const catalogPath = '/workspace/app/pages.json';
    const registryApp =
      'import map from "./pages-map"; export function App(){ return <Routes><Route path={map["App"]} element={<App/>}/><Route path="/literal" element={<App/>}/><Route path="*" element={<Fallback/>}/></Routes>; }';
    const registryOptions = (
      sources: Readonly<Record<string, string | undefined>>,
    ): ReturnType<typeof collectPreviewInspectorRouteLocationInventory> =>
      collectPreviewInspectorRouteLocationInventory({
        documentPath: APP_PATH,
        exportName: 'App',
        readSource: (sourcePath) => Promise.resolve(sources[sourcePath]),
        renderChain,
        resolveModule: (specifier, sourcePath) =>
          specifier === './pages-map' && sourcePath === APP_PATH
            ? registryPath
            : specifier === './pages.json' && sourcePath === registryPath
              ? catalogPath
              : undefined,
        sourcePaths: [APP_PATH],
      });
    const unreadableRegistry = await registryOptions({ [APP_PATH]: registryApp });
    expect(unreadableRegistry.choices.map((choice) => choice.pattern)).toEqual(
      expect.arrayContaining(['/literal', '/*']),
    );
    expect(unreadableRegistry.choices.map((choice) => choice.pattern)).not.toContain('/app');
    const malformedJson = await registryOptions({
      [APP_PATH]: registryApp,
      [registryPath]: 'import map from "./pages.json"; export default map;',
      [catalogPath]: '{ invalid json',
    });
    expect(malformedJson.choices.map((choice) => choice.pattern)).toEqual(
      expect.arrayContaining(['/literal', '/*']),
    );
    expect(malformedJson.choices.map((choice) => choice.pattern)).not.toContain('/app');
    const ambiguousPath = '/workspace/app/AmbiguousApp.tsx';
    const ambiguous = await collectPreviewInspectorRouteLocationInventory({
      documentPath: APP_PATH,
      exportName: 'App',
      readSource: (sourcePath) =>
        Promise.resolve(
          sourcePath === APP_PATH
            ? 'import { AmbiguousApp } from "./AmbiguousApp"; export function App(){ return <Routes><Route path={normalize(`${AmbiguousApp.basePath}/*`)} element={<AmbiguousApp/>}/><Route path="/literal" element={<App/>}/><Route path="*" element={<Fallback/>}/></Routes>; }'
            : sourcePath === ambiguousPath
              ? 'export const AmbiguousApp = createAppModule("/one"); const Another = createAppModule("/two"); export { Another as AmbiguousApp };'
              : undefined,
        ),
      renderChain,
      resolveModule: (specifier) => (specifier === './AmbiguousApp' ? ambiguousPath : undefined),
      sourcePaths: [APP_PATH],
    });
    expect(ambiguous.choices.map((choice) => choice.pattern)).toEqual(
      expect.arrayContaining(['/literal', '/*']),
    );
    expect(ambiguous.choices.map((choice) => choice.pattern)).not.toContain('/one/*');
  });

  it('caps candidates across separately analyzed router sources', async () => {
    const firstPath = '/workspace/app/first-router.ts';
    const secondPath = '/workspace/app/second-router.ts';
    const routes = (prefix: string, count: number): string =>
      Array.from(
        { length: count },
        (_, index) => `{ path: "${prefix}${String(index)}", Component: Page${String(index)} }`,
      ).join(',');
    const sources: Record<string, string> = {
      [APP_PATH]: [
        'import { RouterProvider } from "react-router-dom";',
        'import { firstRouter } from "./first-router";',
        'import { secondRouter } from "./second-router";',
        'export function App(){ return <><RouterProvider router={firstRouter}/><RouterProvider router={secondRouter}/></>; }',
      ].join('\n'),
      [firstPath]: `import { createBrowserRouter } from "react-router-dom"; export const firstRouter = createBrowserRouter([${routes('/first-', 4096)}]);`,
      [secondPath]: `import { createBrowserRouter } from "react-router-dom"; export const secondRouter = createBrowserRouter([${routes('/second-', 8)}]);`,
    };
    const inventory = await collectPreviewInspectorRouteLocationInventory({
      documentPath: APP_PATH,
      exportName: 'App',
      readSource: (sourcePath) => Promise.resolve(sources[sourcePath]),
      renderChain: {
        dependencyPaths: [APP_PATH],
        paths: [],
        reachability: 'entry-connected',
        target: { exportName: 'App', sourcePath: APP_PATH },
        truncated: false,
      },
      resolveModule: (specifier, sourcePath) =>
        sourcePath === APP_PATH && specifier === './first-router'
          ? firstPath
          : sourcePath === APP_PATH && specifier === './second-router'
            ? secondPath
            : undefined,
      sourcePaths: [APP_PATH],
    });
    expect(inventory.choices).toHaveLength(4096);
    expect(inventory.choices.map((choice) => choice.pattern)).not.toContain('/second-0');
  });
});
