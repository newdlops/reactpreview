/** Covers identity behavior for previewInspectorVirtualPagePlan. */
/** Verifies authored-source previewInspectorVirtualPagePlan invariants. */
import { describe, expect, it } from 'vitest';

import type { PreviewRenderChainCandidate } from '../../../../src/adapters/esbuild/renderGraph';

import {
  createPreviewInspectorVirtualPageCandidates,
  selectPreviewInspectorVirtualPageContentCandidate,
} from '../../../../src/adapters/esbuild/inspector/previewInspectorVirtualPagePlan';

import { selectPreviewInspectorExecutableCandidate } from '../../../../src/adapters/esbuild/inspector/previewInspectorExecutableCandidateSelection';

import {
  APP_PATH,
  PAGE_PATH,
  RENDER_PATH,
  createCandidate,
  readRenderPathStep,
} from './previewInspectorVirtualPagePlanFixtures';

describe('PreviewInspectorVirtualPagePlan', () => {
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
});
