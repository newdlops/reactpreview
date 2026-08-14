/** Verifies that VirtualPage planning mounts page content without discarding application context. */
import { describe, expect, it } from 'vitest';
import type { PreviewInspectorPageCandidate } from '../../../../src/adapters/esbuild/inspector';
import type { PreviewRenderChainCandidate } from '../../../../src/adapters/esbuild/renderGraph';
import {
  createPreviewInspectorVirtualPageCandidates,
  selectPreviewInspectorVirtualPageContentCandidate,
} from '../../../../src/adapters/esbuild/inspector/previewInspectorVirtualPagePlan';
import { selectPreviewInspectorExecutableCandidate } from '../../../../src/adapters/esbuild/inspector/previewInspectorExecutableCandidateSelection';
import { expandPreviewInspectorRouteChoiceCandidates } from '../../../../src/adapters/esbuild/inspector/previewInspectorRouteChoiceCandidates';
import type { PreviewInspectorOneHopVisualPath } from '../../../../src/adapters/esbuild/inspector/previewInspectorShallowVisualTypes';

const TARGET_PATH = '/workspace/features/TargetPanel.tsx';
const PAGE_PATH = '/workspace/pages/dashboard-page.tsx';
const APP_PATH = '/workspace/application/App.tsx';

/** One shared inner-to-outer path proving that every candidate belongs to the same authored page. */
const RENDER_PATH: PreviewRenderChainCandidate = {
  entryPoint: {
    kind: 'create-root',
    occurrenceStart: 10,
    sourcePath: '/workspace/main.tsx',
    wrapperNames: [],
  },
  id: 'target-to-entry',
  steps: [
    {
      certainty: 'confirmed',
      kind: 'component-render',
      label: 'TargetPanel',
      occurrenceStart: 10,
      sourcePath: TARGET_PATH,
      wrapperNames: [],
    },
    {
      certainty: 'confirmed',
      kind: 'route-branch',
      label: 'DashboardPage',
      occurrenceStart: 20,
      sourcePath: PAGE_PATH,
      wrapperNames: [],
    },
    {
      certainty: 'confirmed',
      kind: 'component-render',
      label: 'Application',
      occurrenceStart: 30,
      sourcePath: APP_PATH,
      wrapperNames: ['GlobalBoundary'],
    },
  ],
};

/** Creates a complete candidate while keeping role and checkpoint signals explicit per test. */
function createCandidate(
  overrides: Partial<PreviewInspectorPageCandidate>,
): PreviewInspectorPageCandidate {
  return {
    complete: false,
    dependencyPaths: [],
    edges: [],
    id: 'candidate',
    renderPath: RENDER_PATH,
    root: { exportName: 'default', sourcePath: TARGET_PATH },
    rootAutomaticProps: {},
    rootOwnsRouter: false,
    rootStepIndex: 0,
    stopReason: 'render-path-checkpoint',
    targetAutomaticProps: {},
    ...overrides,
  };
}

/** Reads one required shared fixture step without weakening the production types in test data. */
function readRenderPathStep(index: number): PreviewRenderChainCandidate['steps'][number] {
  const step = RENDER_PATH.steps[index];
  if (step === undefined) {
    throw new Error(`Missing shared render-path step at index ${index.toString()}.`);
  }
  return step;
}

describe('PreviewInspectorVirtualPagePlan', () => {
  /** Replaces a bootstrap-heavy application root with the concrete page on the same exact path. */
  it('selects a concrete page checkpoint before applying the first-paint candidate cap', () => {
    const application = createCandidate({
      complete: true,
      id: 'application-root',
      root: { exportName: 'App', sourcePath: APP_PATH },
      rootOwnsRouter: true,
      rootStepIndex: 2,
      stopReason: 'root-reached',
    });
    const page = createCandidate({
      id: 'page-checkpoint',
      root: { exportName: 'DashboardPage', sourcePath: PAGE_PATH },
      rootAutomaticProps: { companyId: 'companyId' },
      rootStepIndex: 1,
    });

    const virtualPages = createPreviewInspectorVirtualPageCandidates([application, page], 1, [
      {
        exportName: 'ApplicationLayout',
        importerPath: APP_PATH,
        importKind: 'static',
        localEdges: [],
        moduleSpecifier: './ApplicationLayout',
        occurrenceStart: 40,
        relation: 'sibling',
        renderedLocalName: 'ApplicationLayout',
        renderBoundaryStart: 30,
        selectedChildPath: PAGE_PATH,
        sourcePath: '/workspace/application/ApplicationLayout.tsx',
      },
      {
        exportName: 'ErrorFallback',
        importerPath: APP_PATH,
        importKind: 'static',
        localEdges: [],
        moduleSpecifier: './ErrorFallback',
        occurrenceStart: 41,
        relation: 'sibling',
        renderedLocalName: 'ErrorFallback',
        renderBoundaryStart: 30,
        selectedChildPath: PAGE_PATH,
        sourcePath: '/workspace/application/ErrorFallback.tsx',
      },
      {
        exportName: 'PageOwnedLayout',
        importerPath: PAGE_PATH,
        importKind: 'static',
        localEdges: [],
        moduleSpecifier: './PageOwnedLayout',
        occurrenceStart: 42,
        relation: 'wrapper',
        renderedLocalName: 'PageOwnedLayout',
        renderBoundaryStart: 30,
        selectedChildPath: TARGET_PATH,
        sourcePath: '/workspace/pages/PageOwnedLayout.tsx',
      },
    ]);

    expect(virtualPages).toHaveLength(1);
    expect(virtualPages[0]?.authoredCandidate.root).toEqual(application.root);
    expect(virtualPages[0]?.contentCandidate.root).toEqual(page.root);
    expect(virtualPages[0]?.browserCandidate).toMatchObject({
      id: 'application-root',
      root: page.root,
      rootAutomaticProps: { companyId: 'companyId' },
      rootOwnsRouter: false,
      rootStepIndex: 1,
    });
    expect(virtualPages[0]?.recipe).toMatchObject({
      authoredRoot: application.root,
      bypassedStepCount: 1,
      contentRoot: page.root,
      mode: 'static-page-checkpoint',
      renderPathId: 'target-to-entry',
    });
    expect(virtualPages[0]?.recipe.omittedOuterPath).toEqual([
      expect.objectContaining({ label: 'Application', wrapperNames: ['GlobalBoundary'] }),
    ]);
    expect(virtualPages[0]?.recipe.shells).toEqual([
      {
        importerPath: APP_PATH,
        relation: 'wrapper',
        root: {
          exportName: 'ApplicationLayout',
          sourcePath: '/workspace/application/ApplicationLayout.tsx',
        },
      },
    ]);
  });

  /**
   * Route promotion drops the authored candidate's root index because it belongs to another root.
   * The promoted page still has one exact position on the shared path; descendants below that
   * position are content slots, not wrappers around the whole page.
   */
  it('does not wrap a promoted route page with descendants below its recovered path boundary', () => {
    const issueListPath = '/workspace/project/IssueList.tsx';
    const issueListFramePath = '/workspace/project/IssueListFrame.tsx';
    const applicationFramePath = '/workspace/application/ApplicationFrame.tsx';
    const renderPath: PreviewRenderChainCandidate = {
      ...RENDER_PATH,
      id: 'issue-through-promoted-route-page',
      steps: [
        readRenderPathStep(0),
        {
          certainty: 'confirmed',
          invocation: {
            calleeName: 'IssueList',
            mode: 'jsx',
            sourcePath: PAGE_PATH,
          },
          kind: 'component-render',
          label: 'IssueList',
          occurrenceStart: 15,
          sourcePath: issueListPath,
          wrapperNames: [],
        },
        readRenderPathStep(1),
        readRenderPathStep(2),
      ],
    };
    const application = createCandidate({
      complete: true,
      id: 'application-with-promoted-project-route',
      renderPath,
      root: { exportName: 'App', sourcePath: APP_PATH },
      rootOwnsRouter: true,
      rootStepIndex: 3,
      routeLocation: {
        componentExportName: 'DashboardPage',
        componentName: 'DashboardPage',
        componentSourcePath: PAGE_PATH,
        dependencyPaths: [APP_PATH, PAGE_PATH],
        evidenceKind: 'route-jsx',
        pathname: '/project',
        pattern: '/project',
        routeMounts: [],
        sourcePath: APP_PATH,
      },
      stopReason: 'root-reached',
    });
    const visualPath = (
      exportName: string,
      importerPath: string,
      sourcePath: string,
    ): PreviewInspectorOneHopVisualPath => ({
      exportName,
      importerPath,
      importKind: 'static',
      localEdges: [],
      moduleSpecifier: `./${exportName}`,
      occurrenceStart: 40,
      relation: 'wrapper',
      renderedLocalName: exportName,
      renderBoundaryStart: 20,
      selectedChildPath: TARGET_PATH,
      sourcePath,
    });

    const [virtualPage] = createPreviewInspectorVirtualPageCandidates([application], 1, [
      visualPath('IssueListFrame', issueListPath, issueListFramePath),
      visualPath('ApplicationFrame', APP_PATH, applicationFramePath),
    ]);

    expect(virtualPage?.contentCandidate).toMatchObject({
      root: { exportName: 'DashboardPage', sourcePath: PAGE_PATH },
    });
    expect(virtualPage?.contentCandidate.rootStepIndex).toBeUndefined();
    expect(virtualPage?.recipe.omittedOuterPath).toEqual([
      expect.objectContaining({ label: 'Application', sourcePath: APP_PATH }),
    ]);
    expect(virtualPage?.recipe.shells).toEqual([
      {
        importerPath: APP_PATH,
        relation: 'owner',
        root: { exportName: 'App', sourcePath: APP_PATH },
      },
    ]);
  });

  /**
   * Reconstructs the full JSX frame rather than retaining only components named Layout or Shell.
   * Authored visual wrappers contain before/after siblings, while infrastructure providers and
   * alternate error UI remain authentic or inactive instead of becoming detached shells.
   */
  it('keeps visual wrappers and ordinary page siblings around the selected content slot', () => {
    const application = createCandidate({
      complete: true,
      id: 'application-root',
      root: { exportName: 'App', sourcePath: APP_PATH },
      rootStepIndex: 2,
      stopReason: 'root-reached',
    });
    const page = createCandidate({
      id: 'page-checkpoint',
      root: { exportName: 'DashboardPage', sourcePath: PAGE_PATH },
      rootStepIndex: 1,
    });
    const visualPath = (
      exportName: string,
      occurrenceStart: number,
      relation: 'component-prop' | 'sibling' | 'wrapper',
      sourcePath: string,
    ): PreviewInspectorOneHopVisualPath => ({
      exportName,
      importerPath: APP_PATH,
      importKind: 'static' as const,
      localEdges: [],
      moduleSpecifier: `./${exportName}`,
      occurrenceStart,
      relation,
      renderedLocalName: exportName,
      renderBoundaryStart: 10,
      selectedChildPath: PAGE_PATH,
      selectedOccurrenceStart: 50,
      sourcePath,
    });

    const [virtualPage] = createPreviewInspectorVirtualPageCandidates([application, page], 1, [
      visualPath('PageFrame', 20, 'wrapper', '/workspace/application/PageFrame.tsx'),
      visualPath('PrimaryNavigation', 30, 'sibling', '/workspace/application/Nav.tsx'),
      visualPath('PageTools', 40, 'component-prop', '/workspace/application/PageTools.tsx'),
      visualPath('PageFooter', 70, 'sibling', '/workspace/application/Footer.tsx'),
      visualPath('ErrorFallback', 80, 'sibling', '/workspace/application/ErrorFallback.tsx'),
    ]);

    expect(virtualPage?.recipe.shells).toEqual([
      {
        importerPath: APP_PATH,
        relation: 'wrapper',
        root: {
          exportName: 'PageFrame',
          sourcePath: '/workspace/application/PageFrame.tsx',
        },
      },
      {
        importerPath: APP_PATH,
        placement: 'before',
        relation: 'sibling',
        root: {
          exportName: 'PrimaryNavigation',
          sourcePath: '/workspace/application/Nav.tsx',
        },
      },
      {
        importerPath: APP_PATH,
        placement: 'after',
        relation: 'sibling',
        root: {
          exportName: 'PageFooter',
          sourcePath: '/workspace/application/Footer.tsx',
        },
      },
    ]);
  });

  /**
   * Route factories commonly keep many mutually exclusive page endpoints in one object/callback.
   * Their imports share an owner with genuine page chrome, so exact candidate identity and the
   * final semantic role must prevent alternate pages from becoming simultaneous visual siblings.
   */
  it('keeps page chrome but excludes competing endpoints from a route catalog', () => {
    const application = createCandidate({
      complete: true,
      id: 'application-root',
      root: { exportName: 'App', sourcePath: APP_PATH },
      rootStepIndex: 2,
      stopReason: 'root-reached',
    });
    const selectedPage = createCandidate({
      id: 'selected-page',
      root: { exportName: 'DashboardPage', sourcePath: PAGE_PATH },
      rootStepIndex: 1,
    });
    const reportsPath = '/workspace/pages/reports.tsx';
    const reportsPage = createCandidate({
      id: 'reports-page',
      root: { exportName: 'Reports', sourcePath: reportsPath },
      rootStepIndex: 1,
    });
    const visualPath = (
      exportName: string,
      sourcePath: string,
      occurrenceStart: number,
    ): PreviewInspectorOneHopVisualPath => ({
      exportName,
      importerPath: APP_PATH,
      importKind: 'static',
      localEdges: [],
      moduleSpecifier: `./${exportName}`,
      occurrenceStart,
      relation: 'sibling',
      renderedLocalName: exportName,
      renderBoundaryStart: 10,
      selectedChildPath: PAGE_PATH,
      selectedOccurrenceStart: 50,
      sourcePath,
    });

    const [virtualPage] = createPreviewInspectorVirtualPageCandidates(
      [application, selectedPage, reportsPage],
      1,
      [
        visualPath('PrimaryNavigation', '/workspace/application/PrimaryNavigation.tsx', 20),
        visualPath('Reports', reportsPath, 30),
        visualPath('UserSettingsPage', '/workspace/pages/user-settings.tsx', 40),
        visualPath('PageAction', '/workspace/application/PageAction.tsx', 60),
      ],
    );

    expect(virtualPage?.recipe.shells.map((shell) => shell.root.exportName)).toEqual([
      'PrimaryNavigation',
      'PageAction',
    ]);
  });

  /**
   * A route factory may receive its selected page and JSX-producing layout callback separately.
   * The callback owner must run intact so injected routes and function-child contracts survive.
   */
  it('promotes the nearest route-factory render callback into an authentic owner shell', () => {
    const factoryPath = '/workspace/application/PortalApp.tsx';
    const renderPath: PreviewRenderChainCandidate = {
      ...RENDER_PATH,
      id: 'route-factory-corridor',
      steps: [
        readRenderPathStep(0),
        readRenderPathStep(1),
        {
          certainty: 'conditional',
          kind: 'route-branch',
          label: 'PortalApp',
          occurrenceStart: 25,
          sourcePath: factoryPath,
          wrapperNames: [],
        },
        readRenderPathStep(2),
      ],
    };
    const application = createCandidate({
      complete: true,
      id: 'application-with-route-factory',
      renderPath,
      root: { exportName: 'App', sourcePath: APP_PATH },
      rootStepIndex: 3,
      stopReason: 'root-reached',
    });
    const page = createCandidate({
      id: 'page-inside-route-factory',
      renderPath,
      root: { exportName: 'DashboardPage', sourcePath: PAGE_PATH },
      rootStepIndex: 1,
    });

    const [virtualPage] = createPreviewInspectorVirtualPageCandidates([application, page], 1, [
      {
        exportName: 'PortalLayout',
        importerPath: factoryPath,
        importKind: 'static',
        invocation: {
          calleeName: 'QueryRenderer',
          mode: 'render-prop',
          slotName: 'children',
        },
        localEdges: [],
        moduleSpecifier: './PortalLayout',
        occurrenceStart: 40,
        relation: 'component-prop',
        renderedLocalName: 'PortalLayout',
        renderBoundaryStart: 20,
        selectedChildPath: PAGE_PATH,
        sourcePath: '/workspace/application/PortalLayout.tsx',
      },
    ]);

    expect(virtualPage?.recipe.shells).toEqual([
      {
        importerPath: factoryPath,
        relation: 'owner',
        root: { exportName: 'PortalApp', sourcePath: factoryPath },
      },
    ]);
  });

  /**
   * A route owner can wrap its injected page routes without exposing the callback as a nested
   * render-prop invocation. Flattening only the importable layout drops local provider/HOC
   * boundaries that feed navigation, drawers, and overlay coordinators inside that layout.
   */
  it('keeps a structural route owner instead of flattening its local provider boundary', () => {
    const factoryPath = '/workspace/application/CompanyPortalApp.tsx';
    const renderPath: PreviewRenderChainCandidate = {
      ...RENDER_PATH,
      id: 'structural-route-owner-corridor',
      steps: [
        readRenderPathStep(0),
        readRenderPathStep(1),
        {
          certainty: 'conditional',
          kind: 'route-branch',
          label: 'CompanyPortalApp',
          occurrenceStart: 25,
          sourcePath: factoryPath,
          wrapperNames: [],
        },
        readRenderPathStep(2),
      ],
    };
    const application = createCandidate({
      complete: true,
      id: 'application-with-structural-route-owner',
      renderPath,
      root: { exportName: 'App', sourcePath: APP_PATH },
      rootStepIndex: 3,
      stopReason: 'root-reached',
    });
    const page = createCandidate({
      id: 'page-inside-structural-route-owner',
      renderPath,
      root: { exportName: 'DashboardPage', sourcePath: PAGE_PATH },
      rootStepIndex: 1,
    });

    const [virtualPage] = createPreviewInspectorVirtualPageCandidates([application, page], 1, [
      {
        exportName: 'CompanyPortalLayout',
        importerPath: factoryPath,
        importKind: 'static',
        localEdges: [],
        moduleSpecifier: './CompanyPortalLayout',
        occurrenceStart: 40,
        relation: 'sibling',
        renderedLocalName: 'CompanyPortalLayout',
        renderBoundaryStart: 20,
        selectedChildPath: PAGE_PATH,
        sourcePath: '/workspace/application/CompanyPortalLayout.tsx',
      },
      {
        exportName: 'CommandOverlay',
        importerPath: factoryPath,
        importKind: 'static',
        localEdges: [],
        moduleSpecifier: './CommandOverlay',
        occurrenceStart: 50,
        relation: 'sibling',
        renderedLocalName: 'CommandOverlay',
        renderBoundaryStart: 20,
        selectedChildPath: PAGE_PATH,
        sourcePath: '/workspace/application/CommandOverlay.tsx',
      },
    ]);

    expect(virtualPage?.recipe.shells).toEqual([
      {
        importerPath: factoryPath,
        relation: 'owner',
        root: { exportName: 'CompanyPortalApp', sourcePath: factoryPath },
      },
    ]);
  });

  /** Prefers the selected catalog's exact inner owner over an outer app with similar page chrome. */
  it('keeps the exact nested route owner ahead of an outer structural shell', () => {
    const companyOwnerPath = '/workspace/application/CompanyOwnerApp.tsx';
    const featureOwnerPath = '/workspace/features/FeatureApp.tsx';
    const renderPath: PreviewRenderChainCandidate = {
      ...RENDER_PATH,
      id: 'nested-exact-route-owner',
      steps: [
        readRenderPathStep(0),
        readRenderPathStep(1),
        {
          certainty: 'conditional',
          kind: 'route-branch',
          label: 'FeatureApp',
          occurrenceStart: 25,
          sourcePath: featureOwnerPath,
          wrapperNames: [],
        },
        {
          certainty: 'conditional',
          kind: 'route-branch',
          label: 'CompanyOwnerApp',
          occurrenceStart: 30,
          sourcePath: companyOwnerPath,
          wrapperNames: [],
        },
        readRenderPathStep(2),
      ],
    };
    const routeLocation = {
      componentName: 'DashboardPage',
      dependencyPaths: [featureOwnerPath, PAGE_PATH],
      evidenceKind: 'route-catalog' as const,
      pathname: '/company/1/feature/dashboard',
      pattern: '/company/:companyId(\\d+)/feature/dashboard',
      sourcePath: featureOwnerPath,
    };
    const application = createCandidate({
      complete: true,
      id: 'nested-owner-application',
      renderPath,
      root: { exportName: 'App', sourcePath: APP_PATH },
      rootStepIndex: 4,
      routeLocation,
      stopReason: 'root-reached',
    });
    const featureOwner = createCandidate({
      id: 'nested-feature-owner',
      renderPath,
      root: { exportName: 'FeatureApp', sourcePath: featureOwnerPath },
      rootStepIndex: 2,
      routeLocation,
    });
    const page = createCandidate({
      id: 'nested-owner-page',
      renderPath,
      root: { exportName: 'DashboardPage', sourcePath: PAGE_PATH },
      rootStepIndex: 1,
      routeLocation,
    });

    const [virtualPage] = createPreviewInspectorVirtualPageCandidates(
      [application, featureOwner, page],
      1,
      [
        {
          exportName: 'CompanyPortalLayout',
          importerPath: companyOwnerPath,
          importKind: 'static',
          localEdges: [],
          moduleSpecifier: './CompanyPortalLayout',
          occurrenceStart: 40,
          relation: 'sibling',
          renderedLocalName: 'CompanyPortalLayout',
          renderBoundaryStart: 20,
          selectedChildPath: PAGE_PATH,
          sourcePath: '/workspace/application/CompanyPortalLayout.tsx',
        },
      ],
    );

    expect(virtualPage?.contentCandidate).toBe(page);
    expect(virtualPage?.recipe.shells.filter((shell) => shell.relation === 'owner')).toEqual([
      {
        importerPath: featureOwnerPath,
        relation: 'owner',
        root: { exportName: 'FeatureApp', sourcePath: featureOwnerPath },
      },
    ]);
    expect(
      virtualPage?.recipe.shells
        .filter((shell) => shell.relation === 'owner')
        .map((shell) => shell.root.sourcePath),
    ).not.toContain(companyOwnerPath);
  });

  /** Does not mistake a same-file route registry object for the exported application owner. */
  it('keeps a proven route owner ahead of an unexported same-file catalog', () => {
    const routeOwnerPath = '/workspace/application/InvestorApp.tsx';
    const renderPath: PreviewRenderChainCandidate = {
      ...RENDER_PATH,
      id: 'same-file-route-catalog',
      steps: [
        readRenderPathStep(0),
        readRenderPathStep(1),
        {
          certainty: 'conditional',
          kind: 'route-branch',
          label: 'IrPages',
          occurrenceStart: 25,
          sourcePath: routeOwnerPath,
          wrapperNames: [],
        },
        {
          certainty: 'confirmed',
          kind: 'value-flow',
          label: 'VcmInvestorGpApp',
          occurrenceStart: 30,
          sourcePath: routeOwnerPath,
          wrapperNames: [],
        },
        readRenderPathStep(2),
      ],
    };
    const routeLocation = {
      componentName: 'DashboardPage',
      dependencyPaths: [routeOwnerPath, PAGE_PATH],
      evidenceKind: 'route-catalog' as const,
      pathname: '/investor/ir',
      pattern: '/investor/ir',
      sourcePath: routeOwnerPath,
    };
    const application = createCandidate({
      complete: true,
      id: 'catalog-application',
      renderPath,
      root: { exportName: 'App', sourcePath: APP_PATH },
      rootStepIndex: 4,
      routeLocation,
      stopReason: 'root-reached',
    });
    const routeOwner = createCandidate({
      id: 'catalog-route-owner',
      renderPath,
      root: { exportName: 'VcmInvestorGpApp', sourcePath: routeOwnerPath },
      rootStepIndex: 3,
      routeLocation,
    });
    const page = createCandidate({
      id: 'catalog-page',
      renderPath,
      root: { exportName: 'DashboardPage', sourcePath: PAGE_PATH },
      rootStepIndex: 1,
      routeLocation,
    });

    const [virtualPage] = createPreviewInspectorVirtualPageCandidates(
      [application, routeOwner, page],
      1,
    );

    expect(virtualPage?.contentCandidate).toBe(page);
    expect(virtualPage?.recipe.shells.filter((shell) => shell.relation === 'owner')).toEqual([
      {
        importerPath: routeOwnerPath,
        relation: 'owner',
        root: { exportName: 'VcmInvestorGpApp', sourcePath: routeOwnerPath },
      },
    ]);
    expect(virtualPage?.recipe.shells.map((shell) => shell.root.exportName)).not.toContain(
      'IrPages',
    );
  });

  /** Rejects mutually exclusive route-layout siblings instead of stacking every catalog branch. */
  it('omits ambiguous sibling layouts owned by the same route catalog', () => {
    const application = createCandidate({
      complete: true,
      id: 'application-root',
      root: { exportName: 'App', sourcePath: APP_PATH },
      rootStepIndex: 2,
      stopReason: 'root-reached',
    });
    const page = createCandidate({
      id: 'page-checkpoint',
      root: { exportName: 'DashboardPage', sourcePath: PAGE_PATH },
      rootStepIndex: 1,
    });
    const visualPath = (exportName: string): PreviewInspectorOneHopVisualPath => ({
      exportName,
      importerPath: APP_PATH,
      importKind: 'static',
      localEdges: [],
      moduleSpecifier: `./${exportName}`,
      occurrenceStart: 20,
      relation: 'sibling',
      renderedLocalName: exportName,
      renderBoundaryStart: 10,
      selectedChildPath: PAGE_PATH,
      selectedOccurrenceStart: 50,
      sourcePath: `/workspace/application/${exportName}.tsx`,
    });

    const [virtualPage] = createPreviewInspectorVirtualPageCandidates([application, page], 1, [
      visualPath('PublicLayout'),
      visualPath('AuthenticatedLayout'),
    ]);

    expect(virtualPage?.recipe.shells).toEqual([]);
  });

  /** Retains every proven wrapper shell; shell composition no longer stops at four graph hops. */
  it('keeps all statically proven VirtualPage shells', () => {
    const application = createCandidate({
      complete: true,
      id: 'application-root',
      root: { exportName: 'App', sourcePath: APP_PATH },
      rootStepIndex: 2,
      stopReason: 'root-reached',
    });
    const page = createCandidate({
      id: 'page-checkpoint',
      root: { exportName: 'DashboardPage', sourcePath: PAGE_PATH },
      rootStepIndex: 1,
    });
    const shellNames = [
      'FirstLayout',
      'SecondLayout',
      'ThirdLayout',
      'FourthLayout',
      'FifthLayout',
      'SixthLayout',
    ];
    const [virtualPage] = createPreviewInspectorVirtualPageCandidates(
      [application, page],
      1,
      shellNames.map((shellName, index) => ({
        exportName: shellName,
        importerPath: APP_PATH,
        importKind: 'static' as const,
        localEdges: [],
        moduleSpecifier: `./${shellName}`,
        occurrenceStart: index,
        relation: 'wrapper' as const,
        renderedLocalName: shellName,
        renderBoundaryStart: 0,
        selectedChildPath: PAGE_PATH,
        sourcePath: `/workspace/application/${shellName}.tsx`,
      })),
    );

    expect(virtualPage?.recipe.shells).toHaveLength(shellNames.length);
    expect(virtualPage?.recipe.shells.map((shell) => shell.root.exportName)).toEqual(shellNames);
  });

  /** Keeps distinct caller pages even when they render the same selected component export. */
  it('creates one selectable VirtualPage per independent consuming page path', () => {
    const staffPagePath = '/workspace/pages/staff-page.tsx';
    const staffAppPath = '/workspace/application/StaffApp.tsx';
    const staffRenderPath: PreviewRenderChainCandidate = {
      ...RENDER_PATH,
      id: 'target-to-staff-entry',
      steps: [
        readRenderPathStep(0),
        {
          ...readRenderPathStep(1),
          label: 'StaffPage',
          sourcePath: staffPagePath,
        },
        {
          ...readRenderPathStep(2),
          label: 'StaffApp',
          sourcePath: staffAppPath,
        },
      ],
    };
    const application = createCandidate({
      complete: true,
      id: 'public-application',
      root: { exportName: 'App', sourcePath: APP_PATH },
      rootStepIndex: 2,
      stopReason: 'root-reached',
    });
    const publicPage = createCandidate({
      id: 'public-page',
      root: { exportName: 'DashboardPage', sourcePath: PAGE_PATH },
      rootStepIndex: 1,
    });
    const staffApplication = createCandidate({
      complete: true,
      id: 'staff-application',
      renderPath: staffRenderPath,
      root: { exportName: 'StaffApp', sourcePath: staffAppPath },
      rootStepIndex: 2,
      stopReason: 'root-reached',
    });
    const staffPage = createCandidate({
      id: 'staff-page',
      renderPath: staffRenderPath,
      root: { exportName: 'StaffPage', sourcePath: staffPagePath },
      rootStepIndex: 1,
    });

    const virtualPages = createPreviewInspectorVirtualPageCandidates([
      application,
      publicPage,
      staffApplication,
      staffPage,
    ]);

    expect(virtualPages).toHaveLength(2);
    expect(virtualPages.map((candidate) => candidate.browserCandidate.id)).toEqual([
      'public-application',
      'staff-application',
    ]);
    expect(virtualPages.map((candidate) => candidate.recipe.contentRoot.sourcePath)).toEqual([
      PAGE_PATH,
      staffPagePath,
    ]);
  });

  it('disambiguates colliding VirtualPage candidate identities', () => {
    const hrmPortalPath = '/workspace/hrm/HrmPortalApp.tsx';
    const hrmRenderPath: PreviewRenderChainCandidate = {
      ...RENDER_PATH,
      id: 'target-to-hrm-portal',
      steps: [
        readRenderPathStep(0),
        {
          ...readRenderPathStep(1),
          label: 'HrmPortalApp',
          sourcePath: hrmPortalPath,
        },
      ],
    };
    const appRouteOwner = createCandidate({
      complete: true,
      id: 'shared-browser-id',
      root: { exportName: 'App', sourcePath: APP_PATH },
      rootStepIndex: 2,
      stopReason: 'root-reached',
    });
    const hrmPortalProjection = createCandidate({
      id: 'shared-browser-id',
      renderPath: hrmRenderPath,
      root: { exportName: 'HrmPortalApp', sourcePath: hrmPortalPath },
      rootStepIndex: 1,
    });
    const unrelated = createCandidate({
      id: 'unambiguous-browser-id',
      renderPath: { ...RENDER_PATH, id: 'target-to-unrelated-page' },
      root: { exportName: 'UnrelatedPage', sourcePath: '/workspace/pages/UnrelatedPage.tsx' },
      rootStepIndex: 1,
    });

    const candidates = [appRouteOwner, hrmPortalProjection, unrelated];
    const capped = createPreviewInspectorVirtualPageCandidates(candidates, 2);
    const uncapped = createPreviewInspectorVirtualPageCandidates(candidates, 3);
    const cappedIds = capped.map((candidate) => candidate.browserCandidate.id);
    const uncappedIds = uncapped.map((candidate) => candidate.browserCandidate.id);

    expect(cappedIds).toHaveLength(2);
    expect(new Set(cappedIds).size).toBe(2);
    expect(cappedIds).toEqual(uncappedIds.slice(0, 2));
    expect(cappedIds.every((id) => id.startsWith('shared-browser-id:virtual-page-'))).toBe(true);
    expect(uncapped[2]?.browserCandidate.id).toBe('unambiguous-browser-id');
    const selected = selectPreviewInspectorExecutableCandidate(uncapped, cappedIds[1]);
    expect(selected?.active.contentCandidate.root).toEqual(hrmPortalProjection.root);
  });

  /**
   * Retains a layout on the exact corridor and lets that owner render its own Header only once.
   */
  it('promotes an omitted render-path layout into the generated shell recipe', () => {
    const layoutPath = '/workspace/application/RootLayout.tsx';
    const renderPath: PreviewRenderChainCandidate = {
      ...RENDER_PATH,
      id: 'layout-corridor',
      steps: [
        readRenderPathStep(0),
        readRenderPathStep(1),
        {
          certainty: 'confirmed',
          kind: 'component-render',
          label: 'RootLayout',
          occurrenceStart: 25,
          sourcePath: layoutPath,
          wrapperNames: [],
        },
        readRenderPathStep(2),
      ],
    };
    const application = createCandidate({
      complete: true,
      id: 'application-with-layout',
      renderPath,
      root: { exportName: 'App', sourcePath: APP_PATH },
      rootStepIndex: 3,
      stopReason: 'root-reached',
    });
    const page = createCandidate({
      id: 'page-under-layout',
      renderPath,
      root: { exportName: 'DashboardPage', sourcePath: PAGE_PATH },
      rootStepIndex: 1,
    });
    const layout = createCandidate({
      id: 'default-exported-layout',
      renderPath,
      root: { exportName: 'default', sourcePath: layoutPath },
      rootStepIndex: 2,
    });

    const [virtualPage] = createPreviewInspectorVirtualPageCandidates(
      [application, page, layout],
      1,
      [
        {
          exportName: 'Header',
          importerPath: layoutPath,
          importKind: 'static',
          localEdges: [],
          moduleSpecifier: './Header',
          occurrenceStart: 10,
          relation: 'sibling',
          renderedLocalName: 'Header',
          renderBoundaryStart: 0,
          selectedChildPath: PAGE_PATH,
          selectedOccurrenceStart: 20,
          sourcePath: '/workspace/application/Header.tsx',
        },
      ],
    );

    expect(virtualPage?.recipe.shells).toEqual([
      {
        importerPath: layoutPath,
        relation: 'owner',
        root: { exportName: 'default', sourcePath: layoutPath },
      },
    ]);
  });

  /** Prefers a concrete TSX page implementation over a re-export-only index checkpoint. */
  it('uses semantic page roles and concrete source files for the live content root', () => {
    const application = createCandidate({
      complete: true,
      root: { exportName: 'Application', sourcePath: APP_PATH },
      rootStepIndex: 2,
      stopReason: 'root-reached',
    });
    const barrel = createCandidate({
      root: { exportName: 'DashboardPage', sourcePath: '/workspace/pages/index.ts' },
      rootStepIndex: 1,
    });
    const concretePage = createCandidate({
      root: { exportName: 'UnstyledDashboardPage', sourcePath: PAGE_PATH },
      rootStepIndex: 1,
    });

    expect(
      selectPreviewInspectorVirtualPageContentCandidate(
        [application, barrel, concretePage],
        application,
      ),
    ).toBe(concretePage);
  });

  /** Keeps a framework filesystem recipe intact because it already supplies implicit layouts. */
  it('does not replace a Next App filesystem page with a generic checkpoint', () => {
    const nextPage = createCandidate({
      complete: true,
      nextAppLayoutChain: [
        { exportName: 'default', params: {}, sourcePath: '/workspace/app/layout.tsx' },
      ],
      root: { exportName: 'default', sourcePath: '/workspace/app/dashboard/page.tsx' },
      routeLocation: {
        componentName: 'NextAppPage',
        evidenceKind: 'next-app-filesystem',
        params: {},
        pathname: '/dashboard',
        pattern: '/dashboard',
        searchParams: {},
        sourcePath: '/workspace/app/dashboard/page.tsx',
      },
      rootStepIndex: 1,
    });
    const nearbyPage = createCandidate({
      root: { exportName: 'DashboardPage', sourcePath: PAGE_PATH },
      rootStepIndex: 0,
    });

    const selected = createPreviewInspectorVirtualPageCandidates([nextPage, nearbyPage], 1)[0];

    expect(selected?.contentCandidate).toBe(nextPage);
    expect(selected?.recipe.mode).toBe('next-app-filesystem');
  });

  /** Keeps every route-factory page choice while collapsing redundant roots on the same path. */
  it('emits one selectable VirtualPage per route choice', () => {
    const application = createCandidate({
      complete: true,
      id: 'application-root',
      root: { exportName: 'FeatureApp', sourcePath: APP_PATH },
      rootOwnsRouter: false,
      rootStepIndex: 2,
      stopReason: 'root-reached',
    });
    const checkpoint = createCandidate({
      id: 'feature-checkpoint',
      root: { exportName: 'FeatureApp', sourcePath: PAGE_PATH },
      rootStepIndex: 1,
    });
    const routeChoices = [
      {
        componentName: 'DashboardPage',
        dependencyPaths: ['/workspace/pages.json'],
        evidenceKind: 'route-catalog' as const,
        pathname: '/workspace/1/feature',
        pattern: '/workspace/:workspaceId(\\d+)/feature',
        sourcePath: '/workspace/pages.json',
      },
      {
        componentName: 'SettingsPage',
        dependencyPaths: ['/workspace/pages.json'],
        evidenceKind: 'route-catalog' as const,
        pathname: '/workspace/1/feature/settings',
        pattern: '/workspace/:workspaceId(\\d+)/feature/settings',
        sourcePath: '/workspace/pages.json',
      },
    ];
    const expanded = expandPreviewInspectorRouteChoiceCandidates(
      [application, checkpoint],
      routeChoices,
    );

    const virtualPages = createPreviewInspectorVirtualPageCandidates(expanded);

    expect(virtualPages).toHaveLength(2);
    expect(
      virtualPages.map((candidate) => ({
        componentName: candidate.browserCandidate.routeLocation?.componentName,
        pathname: candidate.browserCandidate.routeLocation?.pathname,
      })),
    ).toEqual([
      { componentName: 'DashboardPage', pathname: '/workspace/1/feature' },
      { componentName: 'SettingsPage', pathname: '/workspace/1/feature/settings' },
    ]);
    expect(virtualPages[0]?.browserCandidate.dependencyPaths).toContain('/workspace/pages.json');
  });

  /** Keeps the proven route factory owner when a resolved descendant has no reverse-path proof. */
  it('keeps a route-factory owner when a resolved descendant lacks reverse-path proof', () => {
    const application = createCandidate({
      complete: true,
      id: 'application-root',
      root: { exportName: 'Application', sourcePath: APP_PATH },
      rootOwnsRouter: true,
      rootStepIndex: 2,
      stopReason: 'root-reached',
    });
    const routeLocation = {
      componentExportName: 'DashboardPage',
      componentName: 'DashboardPage',
      componentSourcePath: PAGE_PATH,
      dependencyPaths: [APP_PATH, PAGE_PATH],
      evidenceKind: 'route-jsx' as const,
      pathname: '/dashboard',
      pattern: '/dashboard',
      routeMounts: [
        {
          basePath: '/',
          exportName: 'Application',
          hasWildcardFallback: false,
          routeSlotCount: 1,
          sourcePath: APP_PATH,
        },
      ],
      sourcePath: APP_PATH,
    };

    const expanded = expandPreviewInspectorRouteChoiceCandidates([application], [routeLocation]);

    expect(expanded).toHaveLength(1);
    expect(expanded[0]).toMatchObject({
      complete: true,
      dependencyPaths: [APP_PATH, PAGE_PATH],
      edges: application.edges,
      root: application.root,
      rootAutomaticProps: application.rootAutomaticProps,
      rootOwnsRouter: true,
      routeLocation,
      stopReason: 'root-reached',
    });
    expect(expanded.map((candidate) => candidate.root)).not.toContainEqual({
      exportName: 'DashboardPage',
      sourcePath: PAGE_PATH,
    });

    const [virtualPage] = createPreviewInspectorVirtualPageCandidates(expanded);

    expect(virtualPage?.contentCandidate.root).toEqual(application.root);
    expect(virtualPage?.browserCandidate.root).toEqual(application.root);
    expect(virtualPage?.browserCandidate.routeLocation).toBe(routeLocation);
    expect(virtualPage?.browserCandidate.routeLocation?.pathname).toBe('/dashboard');
  });

  /**
   * A route choice attached to shared page chrome describes only the outer corridor. Executing its
   * application owner can stop at an unrelated route gate before the selected panel ever mounts.
   */
  it('keeps the nearest shared-surface checkpoint outside the selected route leaf', () => {
    const selectedPanelPath = '/workspace/features/SelectedPanel.tsx';
    const contentAndPanelPath = '/workspace/layout/ContentAndPanel.tsx';
    const featureRoutePath = '/workspace/routes/FeatureRoute.tsx';
    const renderPath: PreviewRenderChainCandidate = {
      ...RENDER_PATH,
      id: 'shared-panel-through-route',
      steps: [
        {
          certainty: 'confirmed',
          kind: 'component-render',
          label: 'SelectedPanel',
          occurrenceStart: 10,
          sourcePath: selectedPanelPath,
          wrapperNames: [],
        },
        {
          certainty: 'confirmed',
          kind: 'component-render',
          label: 'ContentAndPanel',
          occurrenceStart: 20,
          sourcePath: contentAndPanelPath,
          wrapperNames: [],
        },
        {
          certainty: 'conditional',
          kind: 'route-branch',
          label: 'FeatureRoute',
          occurrenceStart: 30,
          sourcePath: featureRoutePath,
          wrapperNames: [],
        },
        {
          certainty: 'confirmed',
          kind: 'component-render',
          label: 'Application',
          occurrenceStart: 40,
          sourcePath: APP_PATH,
          wrapperNames: [],
        },
      ],
    };
    const routeLocation = {
      componentExportName: 'FeatureRoute',
      componentName: 'FeatureRoute',
      componentSourcePath: featureRoutePath,
      dependencyPaths: [APP_PATH, featureRoutePath],
      evidenceKind: 'route-jsx' as const,
      pathname: '/feature',
      pattern: '/feature',
      routeMounts: [
        {
          basePath: '/',
          exportName: 'Application',
          hasWildcardFallback: false,
          routeSlotCount: 1,
          sourcePath: APP_PATH,
        },
      ],
      sourcePath: APP_PATH,
    };
    const application = createCandidate({
      complete: true,
      id: 'shared-panel-application',
      renderPath,
      root: { exportName: 'Application', sourcePath: APP_PATH },
      rootOwnsRouter: true,
      rootStepIndex: 3,
      routeLocation,
      stopReason: 'root-reached',
      target: { exportName: 'FeatureRoute', sourcePath: featureRoutePath },
    });
    const contentAndPanel = createCandidate({
      id: 'shared-panel-checkpoint',
      renderPath,
      root: { exportName: 'ContentAndPanel', sourcePath: contentAndPanelPath },
      rootStepIndex: 1,
      routeLocation,
      target: { exportName: 'FeatureRoute', sourcePath: featureRoutePath },
    });
    const featureRoute = createCandidate({
      id: 'shared-panel-route-leaf',
      renderPath,
      root: { exportName: 'FeatureRoute', sourcePath: featureRoutePath },
      rootStepIndex: 2,
      routeLocation,
      target: { exportName: 'FeatureRoute', sourcePath: featureRoutePath },
    });

    expect(
      selectPreviewInspectorVirtualPageContentCandidate(
        [application, featureRoute, contentAndPanel],
        featureRoute,
      ),
    ).toBe(contentAndPanel);

    const [virtualPage] = createPreviewInspectorVirtualPageCandidates(
      [application, featureRoute, contentAndPanel],
      1,
    );

    expect(virtualPage?.contentCandidate).toBe(contentAndPanel);
    expect(virtualPage?.browserCandidate.root).toEqual(contentAndPanel.root);
    expect(virtualPage?.browserCandidate.routeLocation).toEqual({
      ...routeLocation,
      elementWrappers: [],
      routeMounts: [],
    });
  });

  /** Keeps the inner route owner when the selected component is proven below its concrete page. */
  it('keeps a route owner for a target reached through the selected page invocation', () => {
    const featureAppPath = '/workspace/routes/FeatureApp.tsx';
    const renderPath: PreviewRenderChainCandidate = {
      ...RENDER_PATH,
      id: 'selected-page-descendant',
      steps: [
        {
          ...readRenderPathStep(0),
          invocation: {
            calleeName: 'TargetPanel',
            mode: 'jsx',
            sourcePath: PAGE_PATH,
          },
        },
        readRenderPathStep(1),
        {
          certainty: 'conditional',
          kind: 'route-branch',
          label: 'FeatureApp',
          occurrenceStart: 25,
          sourcePath: featureAppPath,
          wrapperNames: [],
        },
        readRenderPathStep(2),
      ],
    };
    const routeLocation = {
      componentExportName: 'DashboardPage',
      componentName: 'DashboardPage',
      componentSourcePath: PAGE_PATH,
      dependencyPaths: [featureAppPath, PAGE_PATH],
      evidenceKind: 'route-catalog' as const,
      pathname: '/company/1/feature/dashboard',
      pattern: '/company/:companyId(\\d+)/feature/dashboard',
      routeMounts: [
        {
          basePath: '/company/:companyId(\\d+)/feature',
          contextOrigin: 'virtual-page-owner' as const,
          contextPattern: '/company/:companyId(\\d+)/feature/*',
          exportName: 'FeatureApp',
          hasWildcardFallback: true,
          routeSlotCount: 2,
          sourcePath: featureAppPath,
        },
      ],
      sourcePath: featureAppPath,
    };
    const application = createCandidate({
      complete: true,
      id: 'selected-page-application',
      renderPath,
      root: { exportName: 'Application', sourcePath: APP_PATH },
      rootOwnsRouter: true,
      rootStepIndex: 3,
      routeLocation,
      stopReason: 'root-reached',
    });
    const featureApp = createCandidate({
      id: 'selected-page-feature-app',
      renderPath,
      root: { exportName: 'FeatureApp', sourcePath: featureAppPath },
      rootStepIndex: 2,
      routeLocation,
    });
    const page = createCandidate({
      id: 'selected-page-checkpoint',
      renderPath,
      root: { exportName: 'DashboardPage', sourcePath: PAGE_PATH },
      rootStepIndex: 1,
      routeLocation,
    });

    const [virtualPage] = createPreviewInspectorVirtualPageCandidates([
      application,
      featureApp,
      page,
    ]);

    expect(virtualPage?.contentCandidate).toBe(featureApp);
    expect(virtualPage?.browserCandidate.root).toEqual(featureApp.root);
    const retainedRouteLocation = virtualPage?.browserCandidate.routeLocation;
    expect(
      retainedRouteLocation !== undefined && 'routeMounts' in retainedRouteLocation
        ? retainedRouteLocation.routeMounts
        : undefined,
    ).toEqual(routeLocation.routeMounts);
  });

  it('mounts a direct nested route owner instead of its detached child page', () => {
    const ownerPath = '/workspace/routes/NestedOwner.tsx';
    const routeLeafRenderPath: PreviewRenderChainCandidate = {
      ...RENDER_PATH,
      id: 'nested-route-leaf',
      steps: [
        {
          ...readRenderPathStep(0),
          label: 'ChildPage',
          sourcePath: PAGE_PATH,
        },
        {
          ...readRenderPathStep(1),
          label: 'NestedOwner',
          sourcePath: ownerPath,
        },
      ],
    };
    const child = createCandidate({
      id: 'nested-child',
      renderPath: routeLeafRenderPath,
      root: { exportName: 'default', sourcePath: PAGE_PATH },
      routeLocation: {
        componentExportName: 'default',
        componentName: 'ChildPage',
        componentSourcePath: PAGE_PATH,
        dependencyPaths: [ownerPath, PAGE_PATH],
        evidenceKind: 'route-jsx',
        pathname: '/root/child',
        pattern: '/root/child',
        routeMounts: [
          {
            basePath: '/root',
            exportName: 'default',
            hasWildcardFallback: false,
            routeSlotCount: 1,
            sourcePath: ownerPath,
          },
        ],
        sourcePath: ownerPath,
      },
    });
    const owner = createCandidate({
      id: 'nested-owner',
      renderPath: routeLeafRenderPath,
      root: { exportName: 'default', sourcePath: ownerPath },
      rootOwnsRouter: false,
    });

    const [virtualPage] = createPreviewInspectorVirtualPageCandidates([child, owner]);

    expect(virtualPage?.contentCandidate).toBe(owner);
    expect(virtualPage?.browserCandidate).toMatchObject({
      root: owner.root,
      routeMountBasePath: '/root',
      routeSlotCount: 1,
      wildcardFallbackPresent: false,
    });
  });

  /** Falls back to the authored root when no shared static render path proves a safer body. */
  it('retains an independently discovered authored candidate', () => {
    const standalone = createCandidate({
      root: { exportName: 'Widget', sourcePath: '/workspace/Widget.tsx' },
    });

    const selected = createPreviewInspectorVirtualPageCandidates([standalone], 1)[0];

    expect(selected?.contentCandidate).toBe(standalone);
    expect(selected?.recipe.mode).toBe('authored-root');
  });
});
