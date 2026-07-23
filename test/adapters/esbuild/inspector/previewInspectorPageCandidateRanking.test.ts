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
});
