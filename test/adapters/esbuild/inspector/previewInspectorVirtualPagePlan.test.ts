/** Covers checkpoints behavior for previewInspectorVirtualPagePlan. */
/** Verifies authored-source previewInspectorVirtualPagePlan invariants. */
import { describe, expect, it } from 'vitest';

import type { PreviewInspectorPageCandidate } from '../../../../src/adapters/esbuild/inspector';

import type { PreviewRenderChainCandidate } from '../../../../src/adapters/esbuild/renderGraph';

import { createPreviewInspectorVirtualPageCandidates } from '../../../../src/adapters/esbuild/inspector/previewInspectorVirtualPagePlan';

import type { PreviewInspectorOneHopVisualPath } from '../../../../src/adapters/esbuild/inspector/previewInspectorShallowVisualTypes';

import {
  APP_PATH,
  PAGE_PATH,
  RENDER_PATH,
  TARGET_PATH,
  createCandidate,
  readRenderPathStep,
} from './previewInspectorVirtualPagePlanFixtures';

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
        {
          certainty: 'confirmed',
          invocation: {
            calleeName: 'DashboardPageContent',
            mode: 'jsx',
            sourcePath: PAGE_PATH,
          },
          kind: 'component-render',
          label: 'DashboardPageContent',
          occurrenceStart: 18,
          sourcePath: PAGE_PATH,
          wrapperNames: ['DashboardFrame'],
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
      rootStepIndex: 4,
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

  it('recovers a promoted implementation boundary through its route barrel identity', () => {
    const barrelPath = '/workspace/pages/dashboard/index.ts';
    const issueListPath = '/workspace/project/IssueList.tsx';
    const renderPath: PreviewRenderChainCandidate = {
      ...RENDER_PATH,
      id: 'route-barrel-to-page-implementation',
      steps: [
        readRenderPathStep(0),
        {
          certainty: 'confirmed',
          invocation: { calleeName: 'IssueList', mode: 'jsx', sourcePath: PAGE_PATH },
          kind: 'component-render',
          label: 'IssueList',
          occurrenceStart: 15,
          sourcePath: issueListPath,
          wrapperNames: [],
        },
        {
          certainty: 'confirmed',
          invocation: {
            calleeName: 'DashboardPageContent',
            mode: 'jsx',
            sourcePath: PAGE_PATH,
          },
          kind: 'component-render',
          label: 'DashboardPageContent',
          occurrenceStart: 18,
          sourcePath: PAGE_PATH,
          wrapperNames: ['DashboardFrame'],
        },
        {
          certainty: 'confirmed',
          kind: 'react-lazy',
          label: 'DashboardPage',
          occurrenceStart: 20,
          sourcePath: PAGE_PATH,
          wrapperNames: [],
        },
        {
          certainty: 'confirmed',
          kind: 'route-branch',
          label: 'DashboardPage',
          occurrenceStart: 25,
          sourcePath: barrelPath,
          wrapperNames: [],
        },
        readRenderPathStep(2),
      ],
    };
    const routeLocation = {
      componentExportName: 'DashboardPage',
      componentName: 'DashboardPage',
      componentSourcePath: barrelPath,
      componentSourcePaths: [barrelPath],
      dependencyPaths: [APP_PATH, PAGE_PATH, barrelPath],
      evidenceKind: 'route-catalog' as const,
      pathname: '/project',
      pattern: '/project',
      routeMounts: [],
      sourcePath: APP_PATH,
    };
    const application = createCandidate({
      complete: true,
      id: 'barrel-application',
      renderPath,
      root: { exportName: 'App', sourcePath: APP_PATH },
      rootOwnsRouter: true,
      rootStepIndex: 5,
      routeLocation,
      stopReason: 'root-reached',
    });
    const { rootStepIndex: omittedRootStepIndex, ...implementationBase } = createCandidate({
      id: 'barrel-implementation',
      renderPath,
      root: { exportName: 'default', sourcePath: PAGE_PATH },
      routeLocation,
    });
    void omittedRootStepIndex;
    const implementation = implementationBase as PreviewInspectorPageCandidate;

    const [virtualPage] = createPreviewInspectorVirtualPageCandidates(
      [application, implementation],
      1,
      [
        {
          exportName: 'IssueListFrame',
          importerPath: issueListPath,
          importKind: 'static',
          localEdges: [],
          moduleSpecifier: './IssueListFrame',
          occurrenceStart: 40,
          relation: 'wrapper',
          renderedLocalName: 'IssueListFrame',
          renderBoundaryStart: 20,
          selectedChildPath: TARGET_PATH,
          sourcePath: '/workspace/project/IssueListFrame.tsx',
        },
      ],
    );

    expect(virtualPage?.contentCandidate.root).toEqual({
      exportName: 'default',
      sourcePath: PAGE_PATH,
    });
    expect(virtualPage?.recipe.omittedOuterPath.map((step) => step.label)).toEqual([
      'Application',
      'DashboardPage',
    ]);
    expect(virtualPage?.recipe.shells).not.toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          root: expect.objectContaining({ exportName: 'IssueListFrame' }) as unknown,
        }),
      ]),
    );
  });
});
