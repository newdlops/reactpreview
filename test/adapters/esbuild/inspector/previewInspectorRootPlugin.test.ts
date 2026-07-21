/** Verifies that an ancestor plan becomes the existing browser target descriptor contract. */
import { runInNewContext } from 'node:vm';
import { describe, expect, it } from 'vitest';
import {
  createPreviewInspectorRootSource,
  type PreviewInspectorAncestorPlan,
} from '../../../../src/adapters/esbuild/inspector';

const TARGET_PATH = '/workspace/application/Target.tsx';
const PAGE_PATH = '/workspace/application/Page.tsx';
const ALTERNATE_PAGE_PATH = '/workspace/application/AlternatePage.tsx';

/** Narrow observable surface of the generated legacy-and-Next-15 compatible route record. */
interface NextAppCompatRecord extends PromiseLike<Readonly<Record<string, unknown>>> {
  readonly accountId: string;
  readonly status: 'fulfilled';
  readonly value: Readonly<Record<string, unknown>>;
}

/** Creates the minimum immutable plan used by source-generation assertions. */
function createPlan(root: PreviewInspectorAncestorPlan['root']): PreviewInspectorAncestorPlan {
  const renderChain = {
    dependencyPaths: [PAGE_PATH, TARGET_PATH],
    paths: [],
    reachability: 'entry-unreachable' as const,
    stopReason: 'entry-unreachable' as const,
    target: { exportName: 'Target', sourcePath: TARGET_PATH },
    truncated: false,
  };
  const edges = [
    {
      child: { exportName: 'Target', sourcePath: TARGET_PATH },
      childAutomaticProps: { enabled: true },
      localOwnerDepth: 0,
      localOwnerNames: [],
      occurrenceStart: 42,
      owner: { exportName: 'Page', sourcePath: PAGE_PATH },
    },
  ];
  const pageCandidate = {
    complete: true,
    dependencyPaths: [PAGE_PATH, TARGET_PATH],
    edges,
    id: 'candidate-page',
    root,
    rootAutomaticProps: { route: '/preview' },
    rootInference: {
      provenance: [{ kind: 'string' as const, path: 'companyId', source: 'type' as const }],
      shape: {
        kind: 'object' as const,
        properties: { companyId: { kind: 'string' as const } },
      },
    },
    rootOwnsRouter: false,
    rootStepIndex: 3,
    routeLocation: {
      componentName: 'Target',
      dependencyPaths: ['/workspace/application/pages.json'],
      evidenceKind: 'route-catalog' as const,
      pathname: '/company/1/target',
      pattern: '/company/:companyId(\\d+)/target',
      sourcePath: '/workspace/application/pages.json',
    },
    stopReason: 'root-reached' as const,
    targetAutomaticProps: { enabled: true },
  };
  return {
    ...pageCandidate,
    renderChain,
    renderChainsByExport: { Target: renderChain },
    pageCandidates: [pageCandidate],
    target: { exportName: 'Target', sourcePath: TARGET_PATH },
  };
}

describe('createPreviewInspectorRootSource', () => {
  /** Imports an actual named owner and exposes ancestry plus editable target/root props. */
  it('emits one real-owner descriptor for the unchanged preview browser entry', () => {
    const source = createPreviewInspectorRootSource({
      displayName: 'Target inspector',
      plan: createPlan({ exportName: 'Page', sourcePath: PAGE_PATH }),
      targetInference: {
        provenance: [{ kind: 'object', path: 'field', source: 'usage' }],
        shape: { kind: 'object', properties: { field: { kind: 'object', properties: {} } } },
      },
    });

    expect(source).toContain(
      'load: () => import("/workspace/application/Page.tsx").then((module) => module["Page"])',
    );
    expect(source).toContain(
      'directTarget: true, id: "direct-target:Target", targetExportName: "Target", load: () => import("react-preview:inspector-direct-target/Target").then((module) => module.default)',
    );
    expect(source).toContain('"rootAutomaticProps":{"route":"/preview"}');
    expect(source).toContain('"rootInferredPropShape":{"kind":"object"');
    expect(source).toContain('"rootInferredProps":[{"kind":"string","path":"companyId"');
    expect(source).toContain('"rootOwnsRouter":false');
    expect(source).toContain('"rootStepIndex":3');
    expect(source).toContain('"pathname":"/company/1/target"');
    expect(source).toContain('"evidenceKind":"route-catalog"');
    expect(source).toContain('"pageCandidates":[{"complete":true');
    expect(source).toContain('"targetAutomaticProps":{"enabled":true}');
    expect(source).toContain('"targetInferredPropShape":{"kind":"object"');
    expect(source).toContain('"targetInferredProps":[{"kind":"object","path":"field"');
    expect(source).toContain('"renderChain":{"dependencyPaths"');
    expect(source).toContain('"renderChainsByExport":{"Target"');
    expect(source).toContain('"reachability":"entry-unreachable"');
    expect(source).toContain('"displayName":"Target inspector"');
    expect(source).toContain('"stopReason":"root-reached"');
    expect(source).toContain('export const previewTheme = undefined;');
    expect(source).toContain('export const previewGlobalStyles = Object.freeze([]);');
  });

  /** Uses the direct facade when the target itself is the best importable mount root. */
  it('keeps direct-root target instrumentation active', () => {
    const source = createPreviewInspectorRootSource({
      plan: createPlan({ exportName: 'Target', sourcePath: TARGET_PATH }),
      targetInference: {
        provenance: [{ kind: 'object', path: 'field', source: 'usage' }],
        shape: { kind: 'object', properties: { field: { kind: 'object', properties: {} } } },
      },
    });

    expect(source).toContain(
      'load: () => import("react-preview:inspector-target-facade").then((module) => module["Target"])',
    );
    expect(source).toContain('"inferredPropShape":{"kind":"object"');
    expect(source).toContain('"targetInferredProps":[{"kind":"object","path":"field"');
  });

  /** Imports only the exact static theme eagerly while retaining every authored page root lazily. */
  it('exposes a page-corridor theme before lazy candidate rendering begins', () => {
    const source = createPreviewInspectorRootSource({
      plan: createPlan({ exportName: 'Page', sourcePath: PAGE_PATH }),
      themeImport: { exportName: 'theme', moduleSpecifier: '/workspace/theme.ts' },
    });

    expect(source).toContain(
      'import { theme as __reactPreviewInspectorTheme } from "/workspace/theme.ts";',
    );
    expect(source).toContain('export const previewTheme = __reactPreviewInspectorTheme;');
    expect(source).toContain('load: () => import("/workspace/application/Page.tsx")');
  });

  /** Eagerly exposes only proven app-wrapper global styles for composition under the exact theme. */
  it('exports recovered app-level global style components', () => {
    const source = createPreviewInspectorRootSource({
      globalStyleImports: [
        { exportName: 'GlobalStyle', moduleSpecifier: '/workspace/global-style.tsx' },
        { exportName: 'default', moduleSpecifier: '/workspace/reset.tsx' },
      ],
      plan: createPlan({ exportName: 'Page', sourcePath: PAGE_PATH }),
    });

    expect(source).toContain(
      'import { GlobalStyle as __reactPreviewInspectorGlobalStyle0 } from "/workspace/global-style.tsx";',
    );
    expect(source).toContain(
      'import { default as __reactPreviewInspectorGlobalStyle1 } from "/workspace/reset.tsx";',
    );
    expect(source).toContain(
      'export const previewGlobalStyles = Object.freeze([__reactPreviewInspectorGlobalStyle0,__reactPreviewInspectorGlobalStyle1]);',
    );
  });

  /** Emits every alternative behind its own dynamic import and keeps the first path as metadata. */
  it('keeps alternative authored page roots lazy and independently selectable', () => {
    const primaryPlan = createPlan({ exportName: 'Page', sourcePath: PAGE_PATH });
    const primaryCandidate = primaryPlan.pageCandidates[0];
    if (primaryCandidate === undefined) throw new Error('Primary candidate fixture is missing.');
    const alternateCandidate = {
      ...primaryCandidate,
      id: 'candidate-alternate',
      root: { exportName: 'AlternatePage', sourcePath: ALTERNATE_PAGE_PATH },
      rootAutomaticProps: { route: '/alternate' },
    };
    const source = createPreviewInspectorRootSource({
      plan: {
        ...primaryPlan,
        dependencyPaths: [...primaryPlan.dependencyPaths, ALTERNATE_PAGE_PATH],
        pageCandidates: [...primaryPlan.pageCandidates, alternateCandidate],
      },
    });

    expect(source).toContain(
      'import("/workspace/application/Page.tsx").then((module) => module["Page"])',
    );
    expect(source).toContain(
      'import("/workspace/application/AlternatePage.tsx").then((module) => module["AlternatePage"])',
    );
    expect(source).not.toContain('import __reactPreviewInspectorRoot');
    expect(source).toContain(
      'api.createPageCandidateElement(__reactPreviewInspectorCandidates, props)',
    );
    expect(source).toContain('"id":"candidate-alternate"');
  });

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
      'Promise.all([import("/workspace/application/Page.tsx"),import("/workspace/application/layout.tsx"),import("/workspace/application/account/layout.tsx")])',
    );
    expect(source).toContain('function __reactPreviewComposeNextAppPage');
    expect(source).toContain('function __reactPreviewCreateNextAppCompatRecord(source)');
    expect(source).toContain(
      "status: { configurable: false, enumerable: false, value: 'fulfilled' }",
    );
    expect(source).toContain(
      'const pageProps = Object.assign({ params: pageParams, searchParams }, props);',
    );
    expect(source).toContain('[{},{"accountId":"accountId"}])');
    expect(source).toContain('params: layoutParams[index]');
    expect(source).toContain('"evidenceKind":"next-app-filesystem"');
    expect(source).toContain('"params":{"accountId":"accountId"}');
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

  /** Registers every proven current-file component without evaluating it in page-flow mode. */
  it('emits independent lazy definitions for the complete current-file export inventory', () => {
    const plan = createPlan({ exportName: 'Page', sourcePath: PAGE_PATH });
    const secondaryChain = {
      ...plan.renderChain,
      target: { exportName: 'SecondaryCard', sourcePath: TARGET_PATH },
    };
    const source = createPreviewInspectorRootSource({
      plan: {
        ...plan,
        renderChainsByExport: {
          ...plan.renderChainsByExport,
          SecondaryCard: secondaryChain,
        },
      },
    });

    expect(source).toContain('direct-target:Target');
    expect(source).toContain('direct-target:SecondaryCard');
    expect(source).toContain('react-preview:inspector-direct-target/SecondaryCard');
    expect(source).not.toContain('direct-target:*');
  });

  /**
   * Parses the emitted descriptor JSON to prove static JSX choices cross the extension-host to
   * webview boundary with condition, source, and component-tree evidence intact.
   */
  it('serializes target render outcomes into the browser descriptor', () => {
    const plan = createPlan({ exportName: 'Page', sourcePath: PAGE_PATH });
    const source = createPreviewInspectorRootSource({
      plan: {
        ...plan,
        renderOutcomesByExport: {
          Target: {
            exportName: 'Target',
            outcomes: [
              {
                column: 10,
                componentNames: ['ReadyPanel', 'StatusBadge'],
                componentTree: [
                  {
                    children: [{ children: [], column: 24, line: 12, name: 'StatusBadge' }],
                    column: 10,
                    line: 12,
                    name: 'ReadyPanel',
                  },
                ],
                conditions: [
                  {
                    branch: 'truthy',
                    column: 7,
                    expression: 'ready',
                    id: 'condition-ready',
                    kind: 'if',
                    label: 'truthy',
                    line: 11,
                    selectable: true,
                    sourcePath: TARGET_PATH,
                  },
                ],
                exportName: 'Target',
                id: 'outcome-ready',
                kind: 'jsx',
                label: '<ReadyPanel>',
                line: 12,
                sourcePath: TARGET_PATH,
              },
            ],
            sourcePath: TARGET_PATH,
            truncated: false,
          },
        },
      },
    });
    const descriptorPrefix = 'const __reactPreviewInspectorDescriptor = ';
    const descriptorStart = source.indexOf(descriptorPrefix);
    const descriptorEnd = source.indexOf(';\n', descriptorStart);
    expect(descriptorStart).toBeGreaterThanOrEqual(0);
    expect(descriptorEnd).toBeGreaterThan(descriptorStart);
    const descriptor = JSON.parse(
      source.slice(descriptorStart + descriptorPrefix.length, descriptorEnd),
    ) as {
      readonly inspector?: {
        readonly renderOutcomesByExport?: Readonly<Record<string, unknown>>;
      };
    };

    expect(descriptor.inspector?.renderOutcomesByExport).toMatchObject({
      Target: {
        exportName: 'Target',
        outcomes: [
          {
            componentNames: ['ReadyPanel', 'StatusBadge'],
            componentTree: [
              {
                children: [{ name: 'StatusBadge' }],
                name: 'ReadyPanel',
              },
            ],
            conditions: [
              {
                branch: 'truthy',
                expression: 'ready',
                kind: 'if',
                sourcePath: TARGET_PATH,
              },
            ],
            id: 'outcome-ready',
            sourcePath: TARGET_PATH,
          },
        ],
        sourcePath: TARGET_PATH,
        truncated: false,
      },
    });
  });
});
