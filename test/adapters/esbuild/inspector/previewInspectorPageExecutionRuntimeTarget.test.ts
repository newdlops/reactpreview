/**
 * Verifies that every Page Execution candidate keeps an authentic runtime-target surface: the
 * target always loads through the target facade, so a candidate whose target role is a slice of
 * that same export could never put the slice in its graph and would fail frontier verification.
 */
import { describe, expect, it } from 'vitest';
import {
  createPreviewInspectorPageExecutionCandidates,
  type PreviewInspectorAncestorPlan,
  type PreviewInspectorPageCandidate,
} from '../../../../src/adapters/esbuild/inspector';
import type { PreviewRenderChainCandidate } from '../../../../src/adapters/esbuild/renderGraph';

const TARGET = '/workspace/Target.tsx';
const PAGE = '/workspace/SelectedPage.tsx';
const ROUTE = '/workspace/RouteLayout.tsx';
const APP = '/workspace/App.tsx';
const SLICE_STRATEGIES = new Set(['selected-export-slice', 'inner-local-component-slice']);

describe('Page Execution runtime target', () => {
  /** A component inside the page keeps the sliced page variants as alternatives. */
  it('keeps sliced page variants for a component target', () => {
    const candidates = createPreviewInspectorPageExecutionCandidates({
      plan: createPlan({ exportName: 'Target', sourcePath: TARGET }),
    });

    expect(candidates.map((candidate) => candidate.fidelity)).toEqual([
      'route-page-authentic',
      'route-page-sliced',
      'page-authentic',
      'page-sliced',
      'target-only',
    ]);
    expect(candidates.every(hasAuthenticRuntimeTarget)).toBe(true);
  });

  /** A page that is itself the target never offers a slice of its own export as the target. */
  it('omits sliced variants whose runtime target would be the sliced page', () => {
    const candidates = createPreviewInspectorPageExecutionCandidates({
      plan: createPlan({ exportName: 'SelectedPage', sourcePath: PAGE }),
    });

    expect(candidates.map((candidate) => candidate.fidelity)).not.toContain('route-page-sliced');
    expect(candidates.map((candidate) => candidate.fidelity)).not.toContain('page-sliced');
    expect(candidates.map((candidate) => candidate.fidelity)).toContain('route-page-authentic');
    expect(candidates.every(hasAuthenticRuntimeTarget)).toBe(true);
  });
});

/** Reports whether the candidate's runtime-target role is held by an authentic surface. */
function hasAuthenticRuntimeTarget(candidate: {
  readonly criticalSurfaces: readonly { readonly id: string; readonly strategy: string }[];
  readonly runtimeTargetSurfaceId: string;
}): boolean {
  const target = candidate.criticalSurfaces.find(
    (surface) => surface.id === candidate.runtimeTargetSurfaceId,
  );
  return target !== undefined && !SLICE_STRATEGIES.has(target.strategy);
}

/** Builds a routed page (RouteLayout > SelectedPage) whose render path ends at the given target. */
function createPlan(target: {
  readonly exportName: string;
  readonly sourcePath: string;
}): PreviewInspectorAncestorPlan {
  const pageIsTarget = target.sourcePath === PAGE;
  const steps = [
    ...(pageIsTarget ? [] : [step('component-render', 'Target', TARGET, 1)]),
    step('route-branch', 'SelectedPage', PAGE, 2),
    step('route-branch', 'RouteLayout', ROUTE, 3),
    step('component-render', 'App', APP, 4),
  ];
  const renderPath: PreviewRenderChainCandidate = {
    entryPoint: {
      kind: 'create-root',
      occurrenceStart: 10,
      sourcePath: '/workspace/main.tsx',
      wrapperNames: [],
    },
    id: 'route-path',
    steps,
  };
  const candidate = {
    complete: true,
    dependencyPaths: [TARGET, PAGE, ROUTE, APP],
    edges: [],
    id: 'selected',
    renderPath,
    root: { exportName: 'SelectedPage', sourcePath: PAGE },
    rootAutomaticProps: {},
    rootOwnsRouter: true,
    rootStepIndex: pageIsTarget ? 0 : 1,
    routeLocation: {
      componentName: 'SelectedPage',
      dependencyPaths: [ROUTE],
      evidenceKind: 'route-jsx',
      pathname: '/selected/42',
      pattern: '/selected/:id',
      routeMounts: [
        {
          basePath: '/',
          exportName: 'RouteLayout',
          hasWildcardFallback: true,
          routeSlotCount: 1,
          sourcePath: ROUTE,
        },
      ],
      sourcePath: ROUTE,
    },
    stopReason: 'root-reached',
    targetAutomaticProps: {},
    wildcardFallbackPresent: false,
  } as PreviewInspectorPageCandidate;
  return {
    pageCandidates: [candidate],
    renderChain: { paths: [renderPath] },
    renderChainsByExport: { [target.exportName]: { paths: [renderPath] } },
    target,
  } as unknown as PreviewInspectorAncestorPlan;
}

/** Creates one confirmed render-path step. */
function step(
  kind: 'component-render' | 'route-branch',
  label: string,
  sourcePath: string,
  occurrenceStart: number,
): PreviewRenderChainCandidate['steps'][number] {
  return { certainty: 'confirmed', kind, label, occurrenceStart, sourcePath, wrapperNames: [] };
}
