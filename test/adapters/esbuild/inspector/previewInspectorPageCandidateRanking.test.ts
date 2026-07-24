/** Verifies that Page Inspector mounts concrete authored pages ahead of re-export-only barrels. */
import { describe, expect, it } from 'vitest';
import type { PreviewInspectorPageCandidate } from '../../../../src/adapters/esbuild/inspector';
import { rankPreviewInspectorPageCandidates } from '../../../../src/adapters/esbuild/inspector/previewInspectorPageCandidateRanking';

/** Creates the complete immutable candidate shape while keeping each ranking signal explicit. */
function createCandidate(
  overrides: Partial<PreviewInspectorPageCandidate>,
): PreviewInspectorPageCandidate {
  return {
    complete: true,
    dependencyPaths: [],
    edges: [],
    id: 'candidate',
    root: { exportName: 'default', sourcePath: '/workspace/pages/dashboard-page.tsx' },
    rootAutomaticProps: {},
    rootOwnsRouter: false,
    stopReason: 'root-reached',
    targetAutomaticProps: {},
    ...overrides,
  };
}

describe('rankPreviewInspectorPageCandidates', () => {
  /** Avoids a broad lazy barrel when the exact complete page is independently mountable. */
  it('prefers a complete concrete page over an incomplete index checkpoint', () => {
    const barrel = createCandidate({
      complete: false,
      id: 'lazy-barrel',
      renderPath: {
        id: 'render-path',
        steps: [
          {
            certainty: 'conditional',
            kind: 'react-lazy',
            label: 'DashboardPage',
            occurrenceStart: 0,
            sourcePath: '/workspace/pages/index.ts',
            wrapperNames: [],
          },
        ],
      },
      root: { exportName: 'DashboardPage', sourcePath: '/workspace/pages/index.ts' },
      rootStepIndex: 0,
      stopReason: 'render-path-checkpoint',
    });
    const concretePage = createCandidate({
      edges: [
        {
          child: { exportName: 'Panel', sourcePath: '/workspace/Panel.tsx' },
          childAutomaticProps: {},
          localOwnerDepth: 0,
          localOwnerNames: [],
          occurrenceStart: 0,
          owner: {
            exportName: 'default',
            sourcePath: '/workspace/pages/dashboard-page.tsx',
          },
        },
      ],
      id: 'concrete-page',
    });

    expect(rankPreviewInspectorPageCandidates([barrel, concretePage], 1)[0]?.id).toBe(
      'concrete-page',
    );
  });

  /** Retains a usable page body beside an app root even under the large-project two-item cap. */
  it('keeps the VirtualPage content checkpoint when app shells otherwise fill the cap', () => {
    const renderPath = {
      id: 'render-path',
      steps: [
        {
          certainty: 'confirmed' as const,
          kind: 'component-render' as const,
          label: 'TargetPanel',
          occurrenceStart: 0,
          sourcePath: '/workspace/TargetPanel.tsx',
          wrapperNames: [],
        },
        {
          certainty: 'confirmed' as const,
          kind: 'route-branch' as const,
          label: 'DashboardPage',
          occurrenceStart: 1,
          sourcePath: '/workspace/pages/dashboard-page.tsx',
          wrapperNames: [],
        },
        {
          certainty: 'confirmed' as const,
          kind: 'component-render' as const,
          label: 'CompanyApp',
          occurrenceStart: 2,
          sourcePath: '/workspace/CompanyApp.tsx',
          wrapperNames: [],
        },
        {
          certainty: 'confirmed' as const,
          kind: 'entry-render' as const,
          label: 'App',
          occurrenceStart: 3,
          sourcePath: '/workspace/App.tsx',
          wrapperNames: [],
        },
      ],
    };
    const app = createCandidate({
      id: 'app',
      renderPath,
      root: { exportName: 'App', sourcePath: '/workspace/App.tsx' },
      rootStepIndex: 3,
    });
    const companyApp = createCandidate({
      complete: false,
      id: 'company-app',
      renderPath,
      root: { exportName: 'CompanyApp', sourcePath: '/workspace/CompanyApp.tsx' },
      rootStepIndex: 2,
      stopReason: 'render-path-checkpoint',
    });
    const page = createCandidate({
      complete: false,
      id: 'page',
      renderPath,
      root: {
        exportName: 'DashboardPage',
        sourcePath: '/workspace/pages/dashboard-page.tsx',
      },
      rootStepIndex: 1,
      stopReason: 'render-path-checkpoint',
    });

    expect(
      rankPreviewInspectorPageCandidates([app, companyApp, page], 2).map((item) => item.id),
    ).toEqual(['app', 'page']);
  });
});
