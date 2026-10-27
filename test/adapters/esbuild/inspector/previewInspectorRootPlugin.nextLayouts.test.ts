/** Covers nextLayouts behavior for previewInspectorRootPlugin. */
/** Verifies authored-source previewInspectorRootPlugin invariants. */
import { runInNewContext } from 'node:vm';

import { describe, expect, it } from 'vitest';

import { createPreviewInspectorRootSource } from '../../../../src/adapters/esbuild/inspector';

import {
  createPlan,
  PAGE_PATH,
  type NextAppCompatRecord,
} from './previewInspectorRootPluginFixtures';

describe('createPreviewInspectorRootSource', () => {
  /** Loads and composes implicit Next layouts root-to-leaf while preserving the page children. */
  it('wraps a Next App Router page in its filesystem layout chain', () => {
    const plan = createPlan({ exportName: 'default', sourcePath: PAGE_PATH });
    const candidate = plan.pageCandidates[0];
    if (candidate === undefined) throw new Error('Primary candidate fixture is missing.');
    const source = createPreviewInspectorRootSource({
      plan: {
        ...plan,
        pageCandidates: [
          {
            ...candidate,
            nextAppLayoutChain: [
              {
                exportName: 'default',
                params: {},
                sourcePath: '/workspace/application/layout.tsx',
              },
              {
                exportName: 'default',
                params: { accountId: 'accountId' },
                slotNames: ['modal'],
                sourcePath: '/workspace/application/account/layout.tsx',
              },
            ],
            routeLocation: {
              componentName: 'NextAppPage',
              evidenceKind: 'next-app-filesystem',
              pathname: '/account/accountId/profile',
              params: { accountId: 'accountId' },
              pattern: '/account/[accountId]/profile',
              searchParams: {},
              sourcePath: PAGE_PATH,
            },
          },
        ],
      },
    });

    expect(source).toContain("import * as React from 'react';");
    expect(source).toContain(
      "import { PreviewLayoutSegmentsContext as __reactPreviewNextLayoutSegmentsContext } from 'next/navigation';",
    );
    expect(source).toContain(
      'Promise.all([import("/workspace/application/Page.tsx"),import("/workspace/application/layout.tsx"),import("/workspace/application/account/layout.tsx")])',
    );
    expect(source).toContain('function __reactPreviewComposeNextAppPage');
    expect(source).toContain('Symbol.for("newdlops.react-file-preview.next-app-route")');
    expect(source).toContain('Symbol.for("newdlops.react-file-preview.next-app-control-signal")');
    expect(source).toContain('class __reactPreviewNextAppControlBoundary extends React.Component');
    expect(source).toContain('"data-react-preview-next-app-control": signal.kind');
    expect(source).toContain(
      '__reactPreviewInstallNextAppRoute(pathname, pageParamValues, searchParamValues)',
    );
    expect(source).toContain('function __reactPreviewCreateNextAppCompatRecord(source)');
    expect(source).toContain('function __reactPreviewAdaptNextComponent(Component)');
    expect(source).toContain('if (record.status === "pending") throw record.promise;');
    expect(source).toContain('function __reactPreviewCreateNextSlotProps(slotNames)');
    expect(source).toContain('"data-react-preview-next-slot": slotName, hidden: true');
    expect(source).toContain(
      "status: { configurable: false, enumerable: false, value: 'fulfilled' }",
    );
    expect(source).toContain(
      'const pageProps = Object.assign({}, props, { params: pageParams, searchParams });',
    );
    expect(source).toContain('[{},{"accountId":"accountId"}],');
    expect(source).toContain('[[],["modal"]])');
    expect(source).toContain('__reactPreviewNextLayoutSegmentsContext.Provider');
    expect(source).toContain('params: layoutParams[index]');
    expect(source).toContain('"evidenceKind":"next-app-filesystem"');
    expect(source).toContain('"params":{"accountId":"accountId"}');
  });

  /** Each layout hook receives only the active segments below its own filesystem boundary. */
  it('serializes layout-relative segment contexts for nested App Router shells', () => {
    const routePagePath = '/workspace/application/(account)/company/[companyId]/profile/page.tsx';
    const plan = createPlan({ exportName: 'default', sourcePath: routePagePath });
    const candidate = plan.pageCandidates[0];
    if (candidate === undefined) throw new Error('Primary candidate fixture is missing.');
    const source = createPreviewInspectorRootSource({
      plan: {
        ...plan,
        pageCandidates: [
          {
            ...candidate,
            nextAppLayoutChain: [
              {
                exportName: 'default',
                params: {},
                sourcePath: '/workspace/application/layout.tsx',
              },
              {
                exportName: 'default',
                params: {},
                sourcePath: '/workspace/application/(account)/layout.tsx',
              },
              {
                exportName: 'default',
                params: { companyId: 'acme' },
                slotNames: ['drawer'],
                sourcePath: '/workspace/application/(account)/company/[companyId]/layout.tsx',
              },
            ],
            routeLocation: {
              componentName: 'NextAppPage',
              evidenceKind: 'next-app-filesystem',
              pathname: '/company/acme/profile',
              params: { companyId: 'acme' },
              pattern: '/company/[companyId]/profile',
              searchParams: {},
              sourcePath: routePagePath,
            },
          },
        ],
      },
    });

    expect(source).toContain(
      '[{"segments":["company","acme","profile"],"slots":{}},{"segments":["company","acme","profile"],"slots":{}},{"segments":["profile"],"slots":{"drawer":[]}}]',
    );
  });

  /** Installs route props for an App page even when the project has no authored layout file. */
  it('composes a layout-free Next App Router page through the route runtime', () => {
    const plan = createPlan({ exportName: 'default', sourcePath: PAGE_PATH });
    const candidate = plan.pageCandidates[0];
    if (candidate === undefined) throw new Error('Primary candidate fixture is missing.');
    const source = createPreviewInspectorRootSource({
      plan: {
        ...plan,
        pageCandidates: [
          {
            ...candidate,
            nextAppLayoutChain: [],
            routeLocation: {
              componentName: 'NextAppPage',
              evidenceKind: 'next-app-filesystem',
              pathname: '/standalone/value',
              params: { slug: 'value' },
              pattern: '/standalone/[slug]',
              searchParams: {},
              sourcePath: PAGE_PATH,
            },
          },
        ],
      },
    });

    expect(source).toContain(
      'Promise.all([import("/workspace/application/Page.tsx")]).then((modules) => __reactPreviewComposeNextAppPage',
    );
    expect(source).toContain('"/standalone/value", {"slug":"value"}');
  });

  /** Keeps target instrumentation active when the selected file is an implicit layout wrapper. */
  it('imports a selected App Router layout through the target facade', () => {
    const layoutPath = '/workspace/application/account/layout.tsx';
    const plan = createPlan({ exportName: 'default', sourcePath: PAGE_PATH });
    const candidate = plan.pageCandidates[0];
    if (candidate === undefined) throw new Error('Primary candidate fixture is missing.');
    const source = createPreviewInspectorRootSource({
      plan: {
        ...plan,
        pageCandidates: [
          {
            ...candidate,
            nextAppLayoutChain: [
              {
                exportName: 'default',
                params: {},
                sourcePath: '/workspace/application/layout.tsx',
              },
              { exportName: 'default', params: {}, sourcePath: layoutPath },
            ],
            routeLocation: {
              componentName: 'NextAppPage',
              evidenceKind: 'next-app-filesystem',
              pathname: '/account/profile',
              params: {},
              pattern: '/account/profile',
              searchParams: {},
              sourcePath: PAGE_PATH,
            },
          },
        ],
        target: { exportName: 'default', sourcePath: layoutPath },
      },
    });

    expect(source).toContain(
      'Promise.all([import("/workspace/application/Page.tsx"),import("/workspace/application/layout.tsx"),import("react-preview:inspector-target-facade")])',
    );
    expect(source).not.toContain(`import(${JSON.stringify(layoutPath)})`);
  });

  /** Injects a Pages Router page through `_app.Component` so global shell UI remains authored. */
  it('wraps a Next Pages page in its implicit app component', () => {
    const plan = createPlan({ exportName: 'default', sourcePath: PAGE_PATH });
    const candidate = plan.pageCandidates[0];
    if (candidate === undefined) throw new Error('Primary candidate fixture is missing.');
    const appPath = '/workspace/application/pages/_app.tsx';
    const source = createPreviewInspectorRootSource({
      plan: {
        ...plan,
        dependencyPaths: [...plan.dependencyPaths, appPath],
        pageCandidates: [
          {
            ...candidate,
            nextPagesShell: {
              app: { exportName: 'default', sourcePath: appPath },
              routeLocation: {
                componentName: 'NextPagesPage',
                evidenceKind: 'next-pages-filesystem',
                pathname: '/callBlock',
                pattern: '/callBlock',
                sourcePath: PAGE_PATH,
              },
            },
            routeLocation: {
              componentName: 'NextPagesPage',
              evidenceKind: 'next-pages-filesystem',
              pathname: '/callBlock',
              pattern: '/callBlock',
              sourcePath: PAGE_PATH,
            },
          },
        ],
      },
    });

    expect(source).toContain("import * as React from 'react';");
    expect(source).toContain(
      "import __reactPreviewNextPagesRouter, { RouterContext as __reactPreviewNextPagesRouterContext } from 'next/router';",
    );
    expect(source).toContain(
      'Promise.all([import("/workspace/application/Page.tsx"),import("/workspace/application/pages/_app.tsx")])',
    );
    expect(source).toContain('function __reactPreviewComposeNextPagesPage');
    expect(source).toContain('Component: Page');
    expect(source).toContain('pageProps');
    expect(source).toContain('router: __reactPreviewNextPagesRouter');
    expect(source).toContain('__reactPreviewNextPagesRouterContext.Provider');
    expect(source).toContain('"evidenceKind":"next-pages-filesystem"');
  });

  /** Imports the selected `_app` through its facade while a real page supplies Component. */
  it('keeps selected Next Pages app instrumentation in an authored page composition', () => {
    const appPath = '/workspace/application/pages/_app.tsx';
    const plan = createPlan({ exportName: 'default', sourcePath: PAGE_PATH });
    const candidate = plan.pageCandidates[0];
    if (candidate === undefined) throw new Error('Primary candidate fixture is missing.');
    const source = createPreviewInspectorRootSource({
      plan: {
        ...plan,
        pageCandidates: [
          {
            ...candidate,
            nextPagesShell: {
              app: { exportName: 'default', sourcePath: appPath },
              routeLocation: {
                componentName: 'NextPagesPage',
                evidenceKind: 'next-pages-filesystem',
                pathname: '/',
                pattern: '/',
                sourcePath: PAGE_PATH,
              },
            },
            routeLocation: {
              componentName: 'NextPagesPage',
              evidenceKind: 'next-pages-filesystem',
              pathname: '/',
              pattern: '/',
              sourcePath: PAGE_PATH,
            },
          },
        ],
        target: { exportName: 'default', sourcePath: appPath },
      },
    });

    expect(source).toContain(
      'Promise.all([import("/workspace/application/Page.tsx"),import("react-preview:inspector-target-facade")])',
    );
    expect(source).toContain('Component: Page');
    expect(source).not.toContain('import("/workspace/application/pages/_app.tsx")');
  });

  /** Supplies a non-recursive host marker when `_app` is the package's only safe Pages module. */
  it('composes a selected Next Pages app with the synthetic page fallback', () => {
    const appPath = '/workspace/application/pages/_app.tsx';
    const plan = createPlan({ exportName: 'default', sourcePath: appPath });
    const candidate = plan.pageCandidates[0];
    if (candidate === undefined) throw new Error('Primary candidate fixture is missing.');
    const syntheticRoute = {
      componentName: 'NextPagesPage' as const,
      evidenceKind: 'next-pages-synthetic' as const,
      pathname: '/',
      pattern: '/',
      sourcePath: appPath,
    };
    const source = createPreviewInspectorRootSource({
      plan: {
        ...plan,
        pageCandidates: [
          {
            ...candidate,
            nextPagesShell: {
              app: { exportName: 'default', sourcePath: appPath },
              routeLocation: syntheticRoute,
              syntheticPage: true,
            },
            routeLocation: syntheticRoute,
          },
        ],
        target: { exportName: 'default', sourcePath: appPath },
      },
    });

    expect(source).toContain(
      'Promise.all([import("react-preview:inspector-target-facade")]).then((modules) => __reactPreviewComposeNextPagesPage(modules, "default", true))',
    );
    expect(source).toContain('function __reactPreviewSyntheticNextPagesPage()');
    expect(source).toContain("'data-react-preview-synthetic-next-page': 'true'");
    expect(source).toContain('const Page = authoredPage ?? __reactPreviewSyntheticNextPagesPage;');
  });

  /** Executes the emitted record helper so direct reads, await, and React `use()` metadata agree. */
  it('emits one stable route record compatible with legacy and promised Next props', async () => {
    const plan = createPlan({ exportName: 'default', sourcePath: PAGE_PATH });
    const candidate = plan.pageCandidates[0];
    if (candidate === undefined) throw new Error('Primary candidate fixture is missing.');
    const source = createPreviewInspectorRootSource({
      plan: {
        ...plan,
        pageCandidates: [
          {
            ...candidate,
            nextAppLayoutChain: [
              { exportName: 'default', params: {}, sourcePath: '/workspace/app/layout.tsx' },
            ],
            routeLocation: {
              componentName: 'NextAppPage',
              evidenceKind: 'next-app-filesystem',
              pathname: '/account/accountId',
              params: { accountId: 'accountId' },
              pattern: '/account/[accountId]',
              searchParams: {},
              sourcePath: PAGE_PATH,
            },
          },
        ],
      },
    });
    const helperStart = source.indexOf('function __reactPreviewCreateNextAppCompatRecord');
    const helperEnd = source.indexOf('/** Recreates Next App Router', helperStart);
    expect(helperStart).toBeGreaterThanOrEqual(0);
    expect(helperEnd).toBeGreaterThan(helperStart);
    const sandbox: { record?: NextAppCompatRecord } = {};
    runInNewContext(
      `${source.slice(helperStart, helperEnd)}\nrecord = __reactPreviewCreateNextAppCompatRecord({ accountId: 'accountId' });`,
      sandbox,
    );
    const record = sandbox.record;
    if (record === undefined) throw new Error('Generated Next route record was not created.');

    expect(record.accountId).toBe('accountId');
    expect(record.status).toBe('fulfilled');
    expect(record.value).toMatchObject({ accountId: 'accountId' });
    await expect(Promise.resolve(record)).resolves.toMatchObject({ accountId: 'accountId' });
  });
});
