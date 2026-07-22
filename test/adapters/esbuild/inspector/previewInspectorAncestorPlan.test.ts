/** Verifies bounded real-owner discovery for the Page Inspector mount mode. */
import { describe, expect, it } from 'vitest';
import { createPreviewInspectorAncestorPlan } from '../../../../src/adapters/esbuild/inspector';

const TARGET_PATH = '/workspace/packages/application/src/Target.tsx';
const CARD_PATH = '/workspace/packages/application/src/Card.tsx';
const PAGE_PATH = '/workspace/packages/application/src/Page.tsx';
const APP_PATH = '/workspace/packages/application/src/App.tsx';

/** Creates a snapshot-aware source callback over a small immutable fixture graph. */
function createSourceReader(
  sources: Readonly<Record<string, string>>,
): (sourcePath: string) => Promise<string | undefined> {
  return (sourcePath) => Promise.resolve(sources[sourcePath]);
}

describe('createPreviewInspectorAncestorPlan', () => {
  /** Restores Next Pages `_app` even though the framework never imports the selected page from it. */
  it('attaches the implicit Next Pages app shell and filesystem pathname', async () => {
    const pagePath = '/workspace/projects/driver-web/pages/callBlock/index.tsx';
    const appPath = '/workspace/projects/driver-web/pages/_app.tsx';
    const sources = {
      [pagePath]: 'export default function CallBlockPage() { return <main />; }',
      [appPath]: [
        'export default function App({ Component, pageProps }) {',
        '  return <div><header /><aside /><Component {...pageProps} /></div>;',
        '}',
      ].join('\n'),
    };

    const plan = await createPreviewInspectorAncestorPlan({
      documentPath: pagePath,
      exportName: 'default',
      readSource: createSourceReader(sources),
      sourcePaths: Object.keys(sources),
    });

    expect(plan.pageCandidates[0]).toMatchObject({
      complete: true,
      nextPagesShell: { app: { exportName: 'default', sourcePath: appPath } },
      routeLocation: {
        evidenceKind: 'next-pages-filesystem',
        pathname: '/callBlock',
        pattern: '/callBlock',
      },
      stopReason: 'root-reached',
    });
    expect(plan.dependencyPaths).toEqual([appPath, pagePath]);
  });

  /** Uses a finite server-side registry key instead of an invalid dynamic parameter placeholder. */
  it('refines a Next Pages dynamic pathname from static guard evidence', async () => {
    const pagePath = '/workspace/projects/web/pages/hotels/[hotelName]/callTada.tsx';
    const appPath = '/workspace/projects/web/pages/_app.tsx';
    const guardPath = '/workspace/projects/web/lib/guard.ts';
    const constantsPath = '/workspace/projects/web/lib/constants.ts';
    const sources = {
      [pagePath]: [
        "import { guardPage } from '../../../lib/guard';",
        'export default function CallTada({ hotelName }) { return <main>{hotelName}</main>; }',
        'export const getServerSideProps = guardPage();',
      ].join('\n'),
      [appPath]: 'export default function App({ Component }) { return <Component />; }',
      [guardPath]: [
        "import { HOTELS } from './constants';",
        'export const guardPage = () => async ({ query }) => {',
        '  const hotelName = query.hotelName as string;',
        '  return Object.keys(HOTELS).includes(hotelName)',
        '    ? { props: { hotelName } } : { notFound: true };',
        '};',
      ].join('\n'),
      [constantsPath]: 'export const HOTELS = { testHotel: {}, anotherHotel: {} };',
    };

    const plan = await createPreviewInspectorAncestorPlan({
      documentPath: pagePath,
      exportName: 'default',
      readSource: createSourceReader(sources),
      sourcePaths: Object.keys(sources),
    });

    expect(plan.pageCandidates[0]?.routeLocation).toMatchObject({
      pathname: '/hotels/testHotel/callTada',
      pattern: '/hotels/[hotelName]/callTada',
    });
    expect(plan.dependencyPaths).toEqual(
      expect.arrayContaining([appPath, constantsPath, guardPath, pagePath]),
    );
  });

  /** Uses a real route leaf when the selected file is the framework-injected `_app` wrapper. */
  it('previews a selected Next Pages app through the root index page', async () => {
    const appPath = '/workspace/projects/driver-web/pages/_app.tsx';
    const indexPath = '/workspace/projects/driver-web/pages/index.tsx';
    const nestedPath = '/workspace/projects/driver-web/pages/account/index.tsx';
    const apiPath = '/workspace/projects/driver-web/pages/api/session.ts';
    const sources = {
      [appPath]: [
        'export default function App({ Component, pageProps }) {',
        '  return <div><header /><Component {...pageProps} /></div>;',
        '}',
      ].join('\n'),
      [indexPath]: 'export default function HomePage() { return <main>home</main>; }',
      [nestedPath]: 'export default function AccountPage() { return <main>account</main>; }',
      [apiPath]: 'export default function handler() { return undefined; }',
    };

    const plan = await createPreviewInspectorAncestorPlan({
      documentPath: appPath,
      exportName: 'default',
      readSource: createSourceReader(sources),
      sourcePaths: Object.keys(sources),
    });

    expect(plan.target).toEqual({ exportName: 'default', sourcePath: appPath });
    expect(plan.pageCandidates).toHaveLength(2);
    expect(plan.pageCandidates[0]).toMatchObject({
      complete: true,
      nextPagesShell: {
        app: { exportName: 'default', sourcePath: appPath },
        routeLocation: {
          evidenceKind: 'next-pages-filesystem',
          pathname: '/',
          sourcePath: indexPath,
        },
      },
      root: { exportName: 'default', sourcePath: indexPath },
      stopReason: 'root-reached',
    });
    expect(plan.pageCandidates[0]?.nextPagesShell?.syntheticPage).toBeUndefined();
    expect(plan.pageCandidates[1]).toMatchObject({
      nextPagesShell: {
        routeLocation: { pathname: '/account', sourcePath: nestedPath },
      },
      root: { exportName: 'default', sourcePath: nestedPath },
    });
    expect(plan.dependencyPaths).toEqual(expect.arrayContaining([appPath, indexPath]));
  });

  /** Keeps `_app` mountable without recursive self-composition when no real route page exists. */
  it('uses a synthetic page for a selected Next Pages app without a safe leaf', async () => {
    const appPath = '/workspace/projects/driver-web/pages/_app.tsx';
    const apiPath = '/workspace/projects/driver-web/pages/api/session.ts';
    const errorPath = '/workspace/projects/driver-web/pages/500.tsx';
    const documentPath = '/workspace/projects/driver-web/pages/_document.tsx';
    const sources = {
      [appPath]: [
        'export default function App({ Component }) {',
        '  return <div><aside /><Component /></div>;',
        '}',
      ].join('\n'),
      [apiPath]: 'export default function handler() { return undefined; }',
      [errorPath]: 'export default function ErrorPage() { return <main />; }',
      [documentPath]: 'export default function Document() { return <html />; }',
    };

    const plan = await createPreviewInspectorAncestorPlan({
      documentPath: appPath,
      exportName: 'default',
      readSource: createSourceReader(sources),
      sourcePaths: Object.keys(sources),
    });

    expect(plan.pageCandidates).toHaveLength(1);
    expect(plan.pageCandidates[0]).toMatchObject({
      nextPagesShell: {
        app: { exportName: 'default', sourcePath: appPath },
        routeLocation: {
          evidenceKind: 'next-pages-synthetic',
          pathname: '/',
          sourcePath: appPath,
        },
        syntheticPage: true,
      },
      root: { exportName: 'default', sourcePath: appPath },
    });
  });

  /** Crosses a conventional HOC export so shared shell UI receives a real consuming page. */
  it('reaches Pages Router leaves through a private app shell and default HOC export', async () => {
    const targetPath = '/workspace/shared/ui/src/ResetStyle.tsx';
    const barrelPath = '/workspace/shared/ui/src/index.ts';
    const appPath = '/workspace/apps/web/pages/_app.tsx';
    const pagePath = '/workspace/apps/web/pages/home.tsx';
    const templateAppPath = '/workspace/projects/__templates__/starter/pages/_app.tsx';
    const sources = {
      [targetPath]: 'export function ResetStyle() { return <style />; }',
      [barrelPath]: "export * from './ResetStyle';",
      [appPath]: [
        "import { ResetStyle } from '@workspace/ui';",
        'function AppShell({ Component }) { return <><ResetStyle /><Component /></>; }',
        'function MyApp(props) { return <AppShell {...props} />; }',
        'export default withStore(MyApp);',
      ].join('\n'),
      [pagePath]: 'export default function HomePage() { return <main>home</main>; }',
      [templateAppPath]: [
        "import { ResetStyle } from '@workspace/ui';",
        'export default function TemplateApp() { return <ResetStyle />; }',
      ].join('\n'),
    };
    const resolutions: Readonly<Record<string, string>> = {
      [`${appPath}\0@workspace/ui`]: barrelPath,
      [`${barrelPath}\0./ResetStyle`]: targetPath,
      [`${templateAppPath}\0@workspace/ui`]: barrelPath,
    };

    const plan = await createPreviewInspectorAncestorPlan({
      documentPath: targetPath,
      exportName: 'ResetStyle',
      matchesTargetImport: (specifier, consumerPath, expectedPath) =>
        resolutions[`${consumerPath}\0${specifier}`] === expectedPath,
      readSource: createSourceReader(sources),
      resolveModule: (specifier, consumerPath) => resolutions[`${consumerPath}\0${specifier}`],
      sourcePaths: Object.keys(sources),
    });

    expect(plan.pageCandidates[0]).toMatchObject({
      complete: true,
      nextPagesShell: {
        app: { exportName: 'default', sourcePath: appPath },
        routeLocation: { pathname: '/home', sourcePath: pagePath },
      },
      root: { exportName: 'default', sourcePath: pagePath },
      stopReason: 'root-reached',
    });
    expect(plan.pageCandidates[0]?.edges[0]).toMatchObject({
      child: { exportName: 'ResetStyle', sourcePath: barrelPath },
      localOwnerNames: ['AppShell'],
      owner: { exportName: 'default', sourcePath: appPath },
    });
  });

  /** Restores Next's implicit layout wrappers, which cannot appear in the JavaScript import graph. */
  it('attaches the App Router layout chain and filesystem pathname to a page candidate', async () => {
    const pagePath = '/workspace/packages/web/src/app/(account)/profile/edit/page.tsx';
    const rootLayoutPath = '/workspace/packages/web/src/app/layout.tsx';
    const profileLayoutPath = '/workspace/packages/web/src/app/(account)/profile/layout.tsx';
    const unrelatedRegistryPath = '/workspace/packages/web/src/routes.tsx';
    const sources = {
      [pagePath]: 'export default function ProfileEditPage() { return <main />; }',
      [rootLayoutPath]: [
        'export default function RootLayout({ children }) {',
        '  return <html><body><nav />{children}</body></html>;',
        '}',
      ].join('\n'),
      [profileLayoutPath]: [
        'export default function ProfileLayout({ children }) {',
        '  return <section><header />{children}</section>;',
        '}',
      ].join('\n'),
      [unrelatedRegistryPath]:
        '<Routes><Route path="/wrong-profile" element={<ProfileEditPage />} /></Routes>',
    };

    const plan = await createPreviewInspectorAncestorPlan({
      documentPath: pagePath,
      exportName: 'default',
      readSource: createSourceReader(sources),
      sourcePaths: Object.keys(sources),
    });

    expect(plan.pageCandidates[0]).toMatchObject({
      complete: true,
      nextAppLayoutChain: [
        { exportName: 'default', sourcePath: rootLayoutPath },
        { exportName: 'default', sourcePath: profileLayoutPath },
      ],
      routeLocation: {
        evidenceKind: 'next-app-filesystem',
        pathname: '/profile/edit',
        pattern: '/profile/edit',
        sourcePath: pagePath,
      },
      root: { exportName: 'default', sourcePath: pagePath },
    });
    expect(plan.dependencyPaths).toEqual(
      [pagePath, profileLayoutPath, rootLayoutPath, unrelatedRegistryPath].sort(),
    );
  });

  /** Crosses the implicit layout children slot so layout-only helpers still mount in a real page. */
  it('selects a descendant App Router page for a component owned by a layout', async () => {
    const helperPath = '/workspace/apps/site/app/(view)/preview/font-variables.tsx';
    const rootLayoutPath = '/workspace/apps/site/app/layout.tsx';
    const previewLayoutPath = '/workspace/apps/site/app/(view)/preview/layout.tsx';
    const pagePath = '/workspace/apps/site/app/(view)/preview/[base]/[name]/page.tsx';
    const sources = {
      [helperPath]: 'export function PreviewFontVariables() { return null; }',
      [rootLayoutPath]:
        'export default function RootLayout({ children }) { return <html><body>{children}</body></html>; }',
      [previewLayoutPath]: [
        "import { PreviewFontVariables } from './font-variables';",
        'export default function PreviewLayout({ children }) {',
        '  return <section><PreviewFontVariables />{children}</section>;',
        '}',
      ].join('\n'),
      [pagePath]: [
        `const ITEMS = ['preview'] as const;`,
        'export function generateStaticParams() {',
        '  return ITEMS.map((name) => ({ base: "base", name }));',
        '}',
        'export default function PreviewPage() { return <main />; }',
      ].join('\n'),
    };

    const plan = await createPreviewInspectorAncestorPlan({
      documentPath: helperPath,
      exportName: 'PreviewFontVariables',
      readSource: createSourceReader(sources),
      sourcePaths: Object.keys(sources),
    });

    expect(plan.pageCandidates[0]).toMatchObject({
      complete: true,
      root: { exportName: 'default', sourcePath: pagePath },
      routeLocation: {
        evidenceKind: 'next-app-filesystem',
        pathname: '/preview/base/preview',
      },
      stopReason: 'root-reached',
    });
    expect(plan.pageCandidates[0]?.nextAppLayoutChain?.map((layout) => layout.sourcePath)).toEqual([
      rootLayoutPath,
      previewLayoutPath,
    ]);
    expect(plan.dependencyPaths).toEqual(
      [helperPath, pagePath, previewLayoutPath, rootLayoutPath].sort(),
    );
  });

  /** Mounts the outer real App so its page siblings and all nested target children remain active. */
  it('crosses exported and private owners to the actual package root', async () => {
    const sources = {
      [TARGET_PATH]: 'export const Target = () => <article />;',
      [CARD_PATH]: [
        "import { Target } from './Target';",
        'export function Card() {',
        '  return <section><aside /><Target tone="warm" /><footer /></section>;',
        '}',
      ].join('\n'),
      [PAGE_PATH]: [
        "import { Card } from './Card';",
        'const Body = () => <main><Card visible /></main>;',
        'export default function Page() {',
        '  return <div><nav /><Body /><footer /></div>;',
        '}',
      ].join('\n'),
      [APP_PATH]: [
        "import Page from './Page';",
        'export const App = () => <div><header /><Page /><aside /></div>;',
      ].join('\n'),
    };

    const plan = await createPreviewInspectorAncestorPlan({
      documentPath: TARGET_PATH,
      exportName: 'Target',
      readSource: createSourceReader(sources),
      sourcePaths: [PAGE_PATH, TARGET_PATH, APP_PATH, CARD_PATH],
    });

    expect(plan.complete).toBe(true);
    expect(plan.stopReason).toBe('root-reached');
    expect(plan.root).toEqual({ exportName: 'App', sourcePath: APP_PATH });
    expect(plan.targetAutomaticProps).toEqual({ tone: 'warm' });
    expect(plan.dependencyPaths).toEqual([APP_PATH, CARD_PATH, PAGE_PATH, TARGET_PATH]);
    expect(plan.edges).toMatchObject([
      {
        child: { exportName: 'Target', sourcePath: TARGET_PATH },
        childAutomaticProps: { tone: 'warm' },
        localOwnerDepth: 0,
        owner: { exportName: 'Card', sourcePath: CARD_PATH },
      },
      {
        child: { exportName: 'Card', sourcePath: CARD_PATH },
        childAutomaticProps: { visible: true },
        localOwnerDepth: 1,
        localOwnerNames: ['Body'],
        owner: { exportName: 'default', sourcePath: PAGE_PATH },
      },
      {
        child: { exportName: 'default', sourcePath: PAGE_PATH },
        childAutomaticProps: {},
        localOwnerDepth: 0,
        owner: { exportName: 'App', sourcePath: APP_PATH },
      },
    ]);
  });

  /** Dynamic project wrappers remain part of the real owner instead of blocking inspector ancestry. */
  it('traverses an owner even when pinpoint wrapper reconstruction is unsafe', async () => {
    const sources = {
      [TARGET_PATH]: 'export default function Target() { return <span />; }',
      [PAGE_PATH]: [
        "import Target from './Target';",
        "import { Form } from './Form';",
        'export function Page({ values }) {',
        '  return <Form initialValues={values}><Target enabled={false} /></Form>;',
        '}',
      ].join('\n'),
    };

    const plan = await createPreviewInspectorAncestorPlan({
      documentPath: TARGET_PATH,
      exportName: 'default',
      readSource: createSourceReader(sources),
      sourcePaths: Object.keys(sources),
    });

    expect(plan.complete).toBe(true);
    expect(plan.root).toEqual({ exportName: 'Page', sourcePath: PAGE_PATH });
    expect(plan.targetAutomaticProps).toEqual({ enabled: false });
    expect(plan.edges).toHaveLength(1);
  });

  /** Retains the last importable child and its observed props when the outer owner is private. */
  it('fails closed at an unexported terminal owner', async () => {
    const sources = {
      [TARGET_PATH]: 'export const Target = () => <div />;',
      [CARD_PATH]: [
        "import { Target } from './Target';",
        'const PrivateCard = () => <section><Target count={3} /></section>;',
      ].join('\n'),
    };

    const plan = await createPreviewInspectorAncestorPlan({
      documentPath: TARGET_PATH,
      exportName: 'Target',
      readSource: createSourceReader(sources),
      sourcePaths: Object.keys(sources),
    });

    expect(plan.complete).toBe(false);
    expect(plan.stopReason).toBe('private-owner');
    expect(plan.root).toEqual({ exportName: 'Target', sourcePath: TARGET_PATH });
    expect(plan.rootAutomaticProps).toEqual({ count: 3 });
    expect(plan.edges).toEqual([]);
  });

  /** Accepts a caller-proven monorepo package alias that lexical path suffixes cannot resolve. */
  it('uses project-aware accepted specifiers for a scoped workspace import', async () => {
    const monorepoTarget = '/workspace/packages/ui/src/components/Target.tsx';
    const monorepoPage = '/workspace/apps/web/src/Page.tsx';
    const sources = {
      [monorepoTarget]: 'export const Target = () => <div />;',
      [monorepoPage]: [
        "import { Target } from '@acme/ui-target';",
        'export default function Page() { return <Target />; }',
      ].join('\n'),
    };

    const plan = await createPreviewInspectorAncestorPlan({
      acceptedImportSpecifiers: (reference) =>
        reference.sourcePath === monorepoTarget ? ['@acme/ui-target'] : [],
      documentPath: monorepoTarget,
      exportName: 'Target',
      readSource: createSourceReader(sources),
      sourcePaths: Object.keys(sources),
    });

    expect(plan.root).toEqual({ exportName: 'default', sourcePath: monorepoPage });
    expect(plan.edges).toHaveLength(1);
  });

  /** Treats an application entry render call as evidence that the current export is the page root. */
  it('stops successfully at a top-level React render usage', async () => {
    const entryPath = '/workspace/packages/application/src/main.tsx';
    const sources = {
      [TARGET_PATH]: 'export function App() { return <main />; }',
      [entryPath]: [
        "import { createRoot } from 'react-dom/client';",
        "import { App } from './Target';",
        'createRoot(document.getElementById(\'root\')).render(<App locale="ko" />);',
      ].join('\n'),
    };

    const plan = await createPreviewInspectorAncestorPlan({
      documentPath: TARGET_PATH,
      exportName: 'App',
      readSource: createSourceReader(sources),
      sourcePaths: Object.keys(sources),
    });

    expect(plan.complete).toBe(true);
    expect(plan.stopReason).toBe('root-reached');
    expect(plan.root).toEqual({ exportName: 'App', sourcePath: TARGET_PATH });
    expect(plan.rootAutomaticProps).toEqual({ locale: 'ko' });
    expect(plan.renderChain.reachability).toBe('entry-connected');
    expect(plan.renderChain.paths[0]?.entryPoint).toMatchObject({
      kind: 'create-root',
      sourcePath: entryPath,
    });
    expect(plan.dependencyPaths).toContain(entryPath);
  });

  /** Keeps the last component root when an exported React Router configuration owns its JSX use. */
  it('does not promote route arrays or router objects as React component roots', async () => {
    const routesPath = '/workspace/packages/application/src/routes.tsx';
    const sources = {
      [TARGET_PATH]: 'export function Target() { return <button />; }',
      [PAGE_PATH]: [
        "import { Target } from './Target';",
        'export function Page() { return <main><Target /></main>; }',
      ].join('\n'),
      [routesPath]: [
        "import { Page } from './Page';",
        'export const routes = [{ path: "/dashboard", element: <Page locale="ko" /> }];',
      ].join('\n'),
    };

    const plan = await createPreviewInspectorAncestorPlan({
      documentPath: TARGET_PATH,
      exportName: 'Target',
      readSource: createSourceReader(sources),
      sourcePaths: Object.keys(sources),
    });

    expect(plan.complete).toBe(false);
    expect(plan.stopReason).toBe('non-component-owner');
    expect(plan.root).toEqual({ exportName: 'Page', sourcePath: PAGE_PATH });
    expect(plan.rootAutomaticProps).toEqual({ locale: 'ko' });
    expect(plan.edges).toHaveLength(1);
    expect(plan.dependencyPaths).toEqual([PAGE_PATH, TARGET_PATH, routesPath].sort());
  });

  /** Uses the full value-flow graph to resume after direct JSX ancestry stops at route data. */
  it('offers and selects a typed page checkpoint beyond a non-component owner', async () => {
    const routesPath = '/workspace/packages/application/src/meeting-routes.tsx';
    const entryPath = '/workspace/packages/application/src/main.tsx';
    const sources = {
      [TARGET_PATH]: 'export function Target() { return <button />; }',
      [PAGE_PATH]: [
        "import { Target } from './Target';",
        'export function AgendaField() { return <section><Target /></section>; }',
      ].join('\n'),
      [routesPath]: [
        "import { AgendaField } from './Page';",
        'const pageRoutes = [{ element: <AgendaField /> }];',
        'interface MeetingPageProps { companyId: string; }',
        'export function MeetingPage(props: MeetingPageProps) {',
        '  return <main data-company={props.companyId}>{pageRoutes[0]?.element}</main>;',
        '}',
      ].join('\n'),
      [entryPath]: [
        "import { createRoot } from 'react-dom/client';",
        "import { MeetingPage } from './meeting-routes';",
        'createRoot(document.getElementById(\'root\')).render(<MeetingPage companyId="real" />);',
      ].join('\n'),
    };

    const plan = await createPreviewInspectorAncestorPlan({
      documentPath: TARGET_PATH,
      exportName: 'Target',
      readSource: createSourceReader(sources),
      sourcePaths: Object.keys(sources),
    });

    expect(plan.root).toEqual({ exportName: 'MeetingPage', sourcePath: routesPath });
    expect(plan.pageCandidates.map((candidate) => candidate.root)).toContainEqual({
      exportName: 'AgendaField',
      sourcePath: PAGE_PATH,
    });
    expect(plan.pageCandidates[0]?.rootStepIndex).toBeTypeOf('number');
    expect(plan.pageCandidates[0]?.rootAutomaticProps).toEqual({ companyId: 'real' });
    expect(plan.pageCandidates[0]?.rootInference?.shape.properties).toMatchObject({
      companyId: { kind: 'string' },
    });
  });

  /** Keeps Router ownership local to each independently mountable page checkpoint. */
  it('distinguishes a detached routed page from the application root that owns its Router', async () => {
    const routerRootPath = '/workspace/packages/application/src/AppRouter.tsx';
    const entryPath = '/workspace/packages/application/src/main.tsx';
    const sources = {
      [TARGET_PATH]: [
        "import { useRoutes } from 'react-router-dom';",
        'export function Target() { useRoutes([]); return <button />; }',
      ].join('\n'),
      [PAGE_PATH]: [
        "import { Target } from './Target';",
        'export function Page() { return <main><Target /></main>; }',
      ].join('\n'),
      [routerRootPath]: [
        "import { MemoryRouter } from 'react-router-dom';",
        "import { Page } from './Page';",
        'export function AppRouter() { return <MemoryRouter><Page /></MemoryRouter>; }',
      ].join('\n'),
      [entryPath]: [
        "import { createRoot } from 'react-dom/client';",
        "import { AppRouter } from './AppRouter';",
        "createRoot(document.getElementById('root')).render(<AppRouter />);",
      ].join('\n'),
    };

    const plan = await createPreviewInspectorAncestorPlan({
      documentPath: TARGET_PATH,
      exportName: 'Target',
      readSource: createSourceReader(sources),
      sourcePaths: Object.keys(sources),
    });

    const routedPage = plan.pageCandidates.find(
      (candidate) => candidate.root.sourcePath === PAGE_PATH,
    );
    const applicationRoot = plan.pageCandidates.find(
      (candidate) => candidate.root.sourcePath === routerRootPath,
    );
    expect(routedPage?.rootOwnsRouter).toBe(false);
    expect(applicationRoot?.rootOwnsRouter).toBe(true);
    expect(plan.pageCandidates[0]?.root.sourcePath).toBe(routerRootPath);
    expect(plan.pageCandidates[0]?.complete).toBe(true);
  });

  /** Prefers an application page branch over an earlier lexical story/test usage. */
  it('ranks page ancestry ahead of tests, stories, and examples deterministically', async () => {
    const testPath = '/workspace/packages/application/src/__tests__/Target.test.tsx';
    const dashboardPath = '/workspace/packages/application/src/pages/DashboardPage.tsx';
    const sources = {
      [TARGET_PATH]: 'export const Target = () => <span />;',
      [testPath]: [
        "import { Target } from '../Target';",
        'export const TestHarness = () => <Target branch="test" />;',
      ].join('\n'),
      [dashboardPath]: [
        "import { Target } from '../Target';",
        'export const DashboardPage = () => <main><Target branch="page" /></main>;',
      ].join('\n'),
      [APP_PATH]: [
        "import { DashboardPage } from './pages/DashboardPage';",
        'export const App = () => <DashboardPage />;',
      ].join('\n'),
    };

    const plan = await createPreviewInspectorAncestorPlan({
      documentPath: TARGET_PATH,
      exportName: 'Target',
      readSource: createSourceReader(sources),
      sourcePaths: [testPath, TARGET_PATH, dashboardPath, APP_PATH],
    });

    expect(plan.root).toEqual({ exportName: 'App', sourcePath: APP_PATH });
    expect(plan.targetAutomaticProps).toEqual({ branch: 'page' });
    expect(plan.edges[0]?.owner).toEqual({
      exportName: 'DashboardPage',
      sourcePath: dashboardPath,
    });
    expect(plan.dependencyPaths).not.toContain(testPath);
  });

  /** Retains component factories when the selected JSX lies in a bounded HOC function argument. */
  it('accepts function-shaped memo and observer owners', async () => {
    const sources = {
      [TARGET_PATH]: 'export const Target = () => <span />;',
      [PAGE_PATH]: [
        "import { memo } from 'react';",
        "import { Target } from './Target';",
        'export const Page = memo(() => <main><Target /></main>);',
      ].join('\n'),
    };

    const plan = await createPreviewInspectorAncestorPlan({
      documentPath: TARGET_PATH,
      exportName: 'Target',
      readSource: createSourceReader(sources),
      sourcePaths: Object.keys(sources),
    });

    expect(plan.complete).toBe(true);
    expect(plan.root).toEqual({ exportName: 'Page', sourcePath: PAGE_PATH });
    expect(plan.edges).toHaveLength(1);
  });

  /** Promotes an inline component wrapped by the tagged-template styled-components factory. */
  it('accepts a styled-components tagged-template owner', async () => {
    const sources = {
      [TARGET_PATH]: 'export const Target = () => <span />;',
      [PAGE_PATH]: [
        "import styled from 'styled-components';",
        "import { Target } from './Target';",
        'export const Page = styled((props) => (',
        '  <main><Target {...props} /><aside>authored sibling</aside></main>',
        '))`min-height: 100vh;`;',
      ].join('\n'),
    };

    const plan = await createPreviewInspectorAncestorPlan({
      documentPath: TARGET_PATH,
      exportName: 'Target',
      readSource: createSourceReader(sources),
      sourcePaths: Object.keys(sources),
    });

    expect(plan.complete).toBe(true);
    expect(plan.stopReason).toBe('root-reached');
    expect(plan.root).toEqual({ exportName: 'Page', sourcePath: PAGE_PATH });
    expect(plan.edges).toHaveLength(1);
  });

  /** Keeps arbitrary tagged-template factories with inline JSX out of the React owner graph. */
  it('rejects a non-styled tagged-template factory containing target JSX', async () => {
    const metadataPath = '/workspace/packages/application/src/metadata.tsx';
    const sources = {
      [TARGET_PATH]: 'export const Target = () => <span />;',
      [metadataPath]: [
        "import { Target } from './Target';",
        'const metadataFactory = (render) => (parts) => ({ parts, render });',
        'export const Metadata = metadataFactory(() => (',
        '  <Target tone="metadata" />',
        '))`non-react metadata`;',
      ].join('\n'),
    };

    const plan = await createPreviewInspectorAncestorPlan({
      documentPath: TARGET_PATH,
      exportName: 'Target',
      readSource: createSourceReader(sources),
      sourcePaths: Object.keys(sources),
    });

    expect(plan.complete).toBe(false);
    expect(plan.stopReason).toBe('non-component-owner');
    expect(plan.root).toEqual({ exportName: 'Target', sourcePath: TARGET_PATH });
    expect(plan.rootAutomaticProps).toEqual({ tone: 'metadata' });
    expect(plan.edges).toEqual([]);
  });

  /** Crosses named and wildcard barrel exports while keeping them out of the React owner path. */
  it('discovers the real page through a bounded barrel re-export chain', async () => {
    const firstBarrelPath = '/workspace/packages/application/src/components/index.ts';
    const secondBarrelPath = '/workspace/packages/application/src/ui.ts';
    const sources = {
      [TARGET_PATH]: 'export function Target() { return <button />; }',
      [firstBarrelPath]: "export { Target } from '../Target';",
      [secondBarrelPath]: "export * from './components';",
      [PAGE_PATH]: [
        "import { Target } from './ui';",
        'export function Page() { return <main><Target label="barrel" /></main>; }',
      ].join('\n'),
    };

    const plan = await createPreviewInspectorAncestorPlan({
      documentPath: TARGET_PATH,
      exportName: 'Target',
      readSource: createSourceReader(sources),
      sourcePaths: Object.keys(sources),
    });

    expect(plan.root).toEqual({ exportName: 'Page', sourcePath: PAGE_PATH });
    expect(plan.targetAutomaticProps).toEqual({ label: 'barrel' });
    expect(plan.dependencyPaths).toEqual(
      [firstBarrelPath, PAGE_PATH, secondBarrelPath, TARGET_PATH].sort(),
    );
    expect(plan.edges).toHaveLength(1);
  });

  /** Treats a public React.lazy wrapper as a transparent reverse-import frontier. */
  it('traces JSX callers through a lazy re-export module', async () => {
    const lazyPath = '/workspace/packages/application/src/LazyTarget.tsx';
    const sources = {
      [TARGET_PATH]: 'export default function Target() { return <button />; }',
      [lazyPath]: [
        "import { lazy } from 'react';",
        "export const LazyTarget = lazy(() => import('./Target'));",
      ].join('\n'),
      [APP_PATH]: [
        "import { LazyTarget } from './LazyTarget';",
        'export function App() { return <main><LazyTarget audience="lazy" /></main>; }',
      ].join('\n'),
    };

    const plan = await createPreviewInspectorAncestorPlan({
      documentPath: TARGET_PATH,
      exportName: 'default',
      readSource: createSourceReader(sources),
      sourcePaths: Object.keys(sources),
    });

    expect(plan.root).toEqual({ exportName: 'App', sourcePath: APP_PATH });
    expect(plan.targetAutomaticProps).toEqual({ audience: 'lazy' });
    expect(plan.dependencyPaths).toEqual([APP_PATH, lazyPath, TARGET_PATH].sort());
    expect(plan.edges[0]?.child).toEqual({ exportName: 'LazyTarget', sourcePath: lazyPath });
  });

  /** Retains distinct entry-connected callers so the browser can mount either completed page. */
  it('returns independently selectable page roots for alternative application entries', async () => {
    const publicPagePath = '/workspace/packages/application/src/PublicPage.tsx';
    const staffPagePath = '/workspace/packages/application/src/StaffPage.tsx';
    const publicEntryPath = '/workspace/packages/application/src/public-main.tsx';
    const staffEntryPath = '/workspace/packages/application/src/staff-main.tsx';
    const sources = {
      [TARGET_PATH]: 'export function Target() { return <button>Shared action</button>; }',
      [publicPagePath]: [
        "import { Target } from './Target';",
        'export function PublicPage() { return <main><Target audience="public" /></main>; }',
      ].join('\n'),
      [staffPagePath]: [
        "import { Target } from './Target';",
        'export function StaffPage() { return <main><Target audience="staff" /></main>; }',
      ].join('\n'),
      [publicEntryPath]: [
        "import { createRoot } from 'react-dom/client';",
        "import { PublicPage } from './PublicPage';",
        "createRoot(document.getElementById('root')).render(<PublicPage />);",
      ].join('\n'),
      [staffEntryPath]: [
        "import { createRoot } from 'react-dom/client';",
        "import { StaffPage } from './StaffPage';",
        "createRoot(document.getElementById('root')).render(<StaffPage />);",
      ].join('\n'),
    };

    const plan = await createPreviewInspectorAncestorPlan({
      documentPath: TARGET_PATH,
      exportName: 'Target',
      readSource: createSourceReader(sources),
      sourcePaths: Object.keys(sources),
    });

    expect(plan.pageCandidates.map((candidate) => candidate.root)).toEqual([
      { exportName: 'PublicPage', sourcePath: publicPagePath },
      { exportName: 'StaffPage', sourcePath: staffPagePath },
    ]);
    expect(plan.pageCandidates.every((candidate) => candidate.renderPath?.entryPoint)).toBe(true);
    expect(plan.pageCandidates.map((candidate) => candidate.targetAutomaticProps)).toEqual([
      { audience: 'public' },
      { audience: 'staff' },
    ]);
  });

  /**
   * Carries the selected module's syntax-only JSX alternatives alongside the independently
   * discovered entry-to-target path without analyzing unrelated page modules for outcomes.
   */
  it('attaches target-local JSX return outcomes to the immutable ancestor plan', async () => {
    const sources = {
      [TARGET_PATH]: [
        'export function Target({ ready }) {',
        '  return ready ? <ReadyPanel><StatusBadge /></ReadyPanel> : <LoadingPanel />;',
        '}',
      ].join('\n'),
      [PAGE_PATH]: [
        "import { Target } from './Target';",
        'export default function Page() { return <main><Target ready /></main>; }',
      ].join('\n'),
    };

    const plan = await createPreviewInspectorAncestorPlan({
      documentPath: TARGET_PATH,
      exportName: 'Target',
      readSource: createSourceReader(sources),
      sourcePaths: Object.keys(sources),
    });

    expect(plan.renderOutcomesByExport).toMatchObject({
      Target: {
        exportName: 'Target',
        sourcePath: TARGET_PATH,
        truncated: false,
      },
    });
    expect(plan.renderOutcomesByExport?.Target?.outcomes).toHaveLength(2);
    expect(plan.renderOutcomesByExport?.Target?.outcomes).toMatchObject([
      {
        componentNames: ['ReadyPanel', 'StatusBadge'],
        conditions: [{ branch: 'truthy', expression: 'ready', kind: 'ternary' }],
        exportName: 'Target',
        kind: 'jsx',
      },
      {
        componentNames: ['LoadingPanel'],
        conditions: [{ branch: 'falsy', expression: 'ready', kind: 'ternary' }],
        exportName: 'Target',
        kind: 'jsx',
      },
    ]);
    expect(Object.isFrozen(plan.renderOutcomesByExport)).toBe(true);
  });

  /** Watches DFS-resolved child implementations so their edits invalidate the composed page. */
  it('adds expanded outcome component sources to ancestor-plan HMR dependencies', async () => {
    const layoutPath = '/workspace/packages/application/src/PageLayout.tsx';
    const headerPath = '/workspace/packages/application/src/Header.tsx';
    const sources = {
      [TARGET_PATH]: [
        "import { PageLayout } from './PageLayout';",
        'export function Target() { return <PageLayout />; }',
      ].join('\n'),
      [layoutPath]: [
        "import Header from './Header';",
        'export function PageLayout() { return <main><Header /></main>; }',
      ].join('\n'),
      [headerPath]: 'export default function Header() { return <header />; }',
    };

    const plan = await createPreviewInspectorAncestorPlan({
      documentPath: TARGET_PATH,
      exportName: 'Target',
      readSource: createSourceReader(sources),
      sourcePaths: Object.keys(sources),
    });

    expect(plan.renderOutcomesByExport?.Target?.outcomes[0]?.componentTree).toMatchObject([
      {
        name: 'PageLayout',
        sourcePath: TARGET_PATH,
        children: [{ name: 'Header', sourcePath: layoutPath }],
      },
    ]);
    expect(plan.dependencyPaths).toEqual([headerPath, layoutPath, TARGET_PATH].sort());
  });
});
