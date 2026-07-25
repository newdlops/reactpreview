/** Verifies that VirtualPage planning mounts page content without discarding application context. */
import { describe, expect, it } from 'vitest';
import type { PreviewInspectorPageCandidate } from '../../../../src/adapters/esbuild/inspector';
import type { PreviewRenderChainCandidate } from '../../../../src/adapters/esbuild/renderGraph';
import {
  createPreviewInspectorVirtualPageCandidates,
  selectPreviewInspectorVirtualPageContentCandidate,
} from '../../../../src/adapters/esbuild/inspector/previewInspectorVirtualPagePlan';
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
   * Reconstructs the full JSX frame rather than retaining only components named Layout or Shell.
   * Authored wrappers contain before/after siblings, while alternate error UI remains inactive.
   */
  it('keeps providers and ordinary page siblings around the selected content slot', () => {
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
      visualPath('PageProvider', 20, 'wrapper', '/workspace/application/PageProvider.tsx'),
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
          exportName: 'PageProvider',
          sourcePath: '/workspace/application/PageProvider.tsx',
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

    const [virtualPage] = createPreviewInspectorVirtualPageCandidates([application, page], 1, [
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
    ]);

    expect(virtualPage?.recipe.shells).toEqual([
      {
        importerPath: layoutPath,
        relation: 'owner',
        root: { exportName: 'RootLayout', sourcePath: layoutPath },
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
