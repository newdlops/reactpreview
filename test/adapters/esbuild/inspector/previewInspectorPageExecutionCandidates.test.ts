import { describe, expect, it } from 'vitest';
import {
  createEligiblePreviewInspectorPageExecutionCandidates,
  createPreviewInspectorPageExecutionCandidates,
  type PreviewInspectorAncestorPlan,
  type PreviewInspectorPageCandidate,
} from '../../../../src/adapters/esbuild/inspector';
import type { PreviewRenderChainCandidate } from '../../../../src/adapters/esbuild/renderGraph';

const TARGET = '/workspace/Target.tsx';
const PAGE = '/workspace/SelectedPage.tsx';
const ROUTE = '/workspace/RouteLayout.tsx';
const APP = '/workspace/App.tsx';

describe('createPreviewInspectorPageExecutionCandidates', () => {
  it('tries selected route/page surfaces before smaller page and target-only slices', () => {
    const renderPath: PreviewRenderChainCandidate = {
      entryPoint: {
        kind: 'create-root',
        occurrenceStart: 10,
        sourcePath: '/workspace/main.tsx',
        wrapperNames: [],
      },
      id: 'route-path',
      steps: [
        {
          certainty: 'confirmed',
          kind: 'component-render',
          label: 'Target',
          occurrenceStart: 1,
          sourcePath: TARGET,
          wrapperNames: [],
        },
        {
          certainty: 'confirmed',
          kind: 'route-branch',
          label: 'SelectedPage',
          occurrenceStart: 2,
          sourcePath: PAGE,
          wrapperNames: [],
        },
        {
          certainty: 'confirmed',
          kind: 'route-branch',
          label: 'RouteLayout',
          occurrenceStart: 3,
          sourcePath: ROUTE,
          wrapperNames: [],
        },
        {
          certainty: 'confirmed',
          kind: 'component-render',
          label: 'App',
          occurrenceStart: 4,
          sourcePath: APP,
          wrapperNames: [],
        },
      ],
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
      rootStepIndex: 1,
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
    } as PreviewInspectorPageCandidate;
    const plan = {
      pageCandidates: [candidate],
      renderChain: { paths: [renderPath] },
      renderChainsByExport: { Target: { paths: [renderPath] } },
      target: { exportName: 'Target', sourcePath: TARGET },
    } as unknown as PreviewInspectorAncestorPlan;

    const candidates = createPreviewInspectorPageExecutionCandidates({ plan });

    expect(candidates.map((item) => item.fidelity)).toEqual([
      'route-page-authentic',
      'route-page-sliced',
      'page-authentic',
      'page-sliced',
      'target-only',
    ]);
    expect(candidates[0]?.routeRecipe).toMatchObject({
      kind: 'generic-memory-location',
      loaderPolicy: 'never-execute',
      pathname: '/selected/42',
    });
    expect(candidates[0]?.criticalSurfaces.map((surface) => surface.sourcePath)).toEqual([
      ROUTE,
      PAGE,
      TARGET,
    ]);
    expect(candidates[0]?.criticalSurfaces.map((surface) => surface.sourcePath)).not.toContain(APP);
    expect(candidates.at(-1)?.criticalSurfaces).toEqual([
      expect.objectContaining({ sourcePath: TARGET, strategy: 'authentic-module-export' }),
    ]);
  });

  it('honors a valid persisted browser candidate without converting an app root into a fallback', () => {
    const page = (id: string, sourcePath: string): PreviewInspectorPageCandidate => ({
      complete: false,
      dependencyPaths: [sourcePath],
      edges: [],
      id,
      root: { exportName: 'default', sourcePath },
      rootAutomaticProps: {},
      rootOwnsRouter: false,
      stopReason: 'render-path-checkpoint',
      targetAutomaticProps: {},
    });
    const first = page('first', '/workspace/FirstPage.tsx');
    const second = page('second', '/workspace/SecondPage.tsx');
    const plan = {
      pageCandidates: [first, second],
      renderChain: { paths: [] },
      renderChainsByExport: {},
      target: { exportName: 'Target', sourcePath: TARGET },
    } as unknown as PreviewInspectorAncestorPlan;

    const candidates = createPreviewInspectorPageExecutionCandidates({
      plan,
      selectedPageCandidateId: 'second',
    });

    expect(candidates[0]?.browserCandidate.id).toBe('second');
    expect(
      candidates.every((item) =>
        item.criticalSurfaces.every((surface) => surface.sourcePath !== APP),
      ),
    ).toBe(true);
  });

  it('narrows a retry request to one compiler-recreated execution candidate id', () => {
    const candidate = {
      complete: false,
      dependencyPaths: [PAGE],
      edges: [],
      id: 'selected',
      root: { exportName: 'default', sourcePath: PAGE },
      rootAutomaticProps: {},
      rootOwnsRouter: false,
      stopReason: 'render-path-checkpoint',
      targetAutomaticProps: {},
    } as PreviewInspectorPageCandidate;
    const plan = {
      pageCandidates: [candidate],
      renderChain: { paths: [] },
      renderChainsByExport: {},
      target: { exportName: 'Target', sourcePath: TARGET },
    } as unknown as PreviewInspectorAncestorPlan;
    const all = createEligiblePreviewInspectorPageExecutionCandidates(plan, undefined);
    const retry = createEligiblePreviewInspectorPageExecutionCandidates(
      plan,
      undefined,
      all.at(-1)?.id,
    );

    expect(retry).toHaveLength(1);
    expect(retry[0]?.id).toBe(all.at(-1)?.id);
    expect(
      createEligiblePreviewInspectorPageExecutionCandidates(plan, undefined, 'not-a-candidate'),
    ).toEqual([]);
  });
});
