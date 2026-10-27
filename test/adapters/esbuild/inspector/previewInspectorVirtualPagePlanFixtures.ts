/** Shared deterministic fixtures for previewInspectorVirtualPagePlan regression scenarios. */
import type { PreviewInspectorPageCandidate } from '../../../../src/adapters/esbuild/inspector';
import type { PreviewRenderChainCandidate } from '../../../../src/adapters/esbuild/renderGraph';

export const TARGET_PATH = '/workspace/features/TargetPanel.tsx';

export const PAGE_PATH = '/workspace/pages/dashboard-page.tsx';

export const APP_PATH = '/workspace/application/App.tsx';

/** One shared inner-to-outer path proving that every candidate belongs to the same authored page. */
export const RENDER_PATH: PreviewRenderChainCandidate = {
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
export function createCandidate(
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
export function readRenderPathStep(index: number): PreviewRenderChainCandidate['steps'][number] {
  const step = RENDER_PATH.steps[index];
  if (step === undefined) {
    throw new Error(`Missing shared render-path step at index ${index.toString()}.`);
  }
  return step;
}
