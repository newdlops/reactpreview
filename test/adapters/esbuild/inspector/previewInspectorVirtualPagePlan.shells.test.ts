/** Covers shells behavior for previewInspectorVirtualPagePlan. */
/** Verifies authored-source previewInspectorVirtualPagePlan invariants. */
import { describe, expect, it } from 'vitest';

import type { PreviewRenderChainCandidate } from '../../../../src/adapters/esbuild/renderGraph';

import { createPreviewInspectorVirtualPageCandidates } from '../../../../src/adapters/esbuild/inspector/previewInspectorVirtualPagePlan';

import type { PreviewInspectorOneHopVisualPath } from '../../../../src/adapters/esbuild/inspector/previewInspectorShallowVisualTypes';

import {
  APP_PATH,
  PAGE_PATH,
  RENDER_PATH,
  createCandidate,
  readRenderPathStep,
} from './previewInspectorVirtualPagePlanFixtures';

describe('PreviewInspectorVirtualPagePlan', () => {
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
});
