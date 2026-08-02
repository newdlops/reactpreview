import { describe, expect, it } from 'vitest';
import {
  freezePreviewInspectorPageExecutionPlan,
  type PreviewInspectorPageExecutionPlan,
} from '../../../../src/adapters/esbuild/inspector';

describe('freezePreviewInspectorPageExecutionPlan', () => {
  it('keeps descriptor evidence separate from immutable executable and watch source sets', () => {
    const plan = {
      alternatives: [],
      browserCandidateId: 'route-a',
      candidate: {
        browserCandidate: { id: 'route-a' },
        compositionEdges: [
          {
            childSurfaceId: 'page',
            mode: 'children-slot',
            parentSurfaceId: 'layout',
            placementIndex: 0,
          },
        ],
        criticalSurfaces: [
          {
            bypassedWrapperNames: [],
            exportName: 'Page',
            id: 'page',
            omittedTopLevelEffectCount: 0,
            preservedWrapperKinds: ['memo'],
            sourcePath: '/workspace/Page.tsx',
            strategy: 'authentic-module-export',
            watchSourcePaths: ['/workspace/Page.tsx'],
          },
        ],
        evidenceSourcePaths: ['/workspace/main.tsx'],
        executionRootSurfaceId: 'page',
        fidelity: 'page-authentic',
        id: 'candidate-a',
        optionalSurfaces: [],
        routeRecipe: {
          kind: 'react-router-v6',
          loaderPolicy: 'never-execute',
          mounts: [],
          params: { scope: ['active', 'mine'] },
          pattern: '/agreements/:scope',
          pathname: '/agreements/preview',
          rootOwnsRouter: false,
          searchParams: {},
        },
        runtimeTargetSurfaceId: 'page',
        watchSourcePaths: ['/workspace/main.tsx', '/workspace/Page.tsx'],
      },
      descriptorPlan: { dependencyPaths: ['/workspace/main.tsx'] },
      executionIdentity: 'v4:candidate-a',
      version: 4,
    } as unknown as PreviewInspectorPageExecutionPlan;

    const frozen = freezePreviewInspectorPageExecutionPlan(plan);

    expect(frozen.candidate.evidenceSourcePaths).toEqual(['/workspace/main.tsx']);
    expect(frozen.candidate.criticalSurfaces[0]?.sourcePath).toBe('/workspace/Page.tsx');
    expect(frozen.candidate.routeRecipe?.loaderPolicy).toBe('never-execute');
    expect(frozen.candidate.executionRootSurfaceId).toBe('page');
    expect(frozen.candidate.runtimeTargetSurfaceId).toBe('page');
    expect(frozen.version).toBe(4);
    expect(Object.isFrozen(frozen)).toBe(true);
    expect(Object.isFrozen(frozen.candidate)).toBe(true);
    expect(Object.isFrozen(frozen.candidate.criticalSurfaces)).toBe(true);
    expect(Object.isFrozen(frozen.candidate.criticalSurfaces[0]?.preservedWrapperKinds)).toBe(true);
    expect(Object.isFrozen(frozen.candidate.routeRecipe?.mounts)).toBe(true);
    expect(Object.isFrozen(frozen.candidate.routeRecipe?.params.scope)).toBe(true);
    expect(Object.isFrozen(frozen.descriptorPlan)).toBe(false);
  });
});
