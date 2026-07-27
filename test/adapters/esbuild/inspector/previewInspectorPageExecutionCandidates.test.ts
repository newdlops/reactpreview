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
      rootOwnsRouter: true,
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
    expect(candidates.every((item) => item.routeRecipe?.pathname === '/selected/42')).toBe(true);
    expect(candidates.every((item) => item.routeRecipe?.rootOwnsRouter === true)).toBe(true);
  });

  it('uses the live VirtualPage checkpoint ownership after omitting an authored app router', () => {
    const renderPath: PreviewRenderChainCandidate = {
      entryPoint: {
        kind: 'create-root',
        occurrenceStart: 4,
        sourcePath: '/workspace/main.tsx',
        wrapperNames: [],
      },
      id: 'virtual-page-path',
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
          kind: 'component-render',
          label: 'AppRouter',
          occurrenceStart: 3,
          sourcePath: APP,
          wrapperNames: [],
        },
      ],
    };
    const routeLocation = {
      componentName: 'SelectedPage',
      dependencyPaths: [],
      evidenceKind: 'route-jsx' as const,
      pathname: '/selected',
      pattern: '/selected',
      routeMounts: [],
      sourcePath: APP,
    };
    const authoredApp = {
      complete: true,
      dependencyPaths: [TARGET, PAGE, APP],
      edges: [],
      id: 'app-root',
      renderPath,
      root: { exportName: 'default', sourcePath: APP },
      rootAutomaticProps: {},
      rootOwnsRouter: true,
      rootStepIndex: 2,
      routeLocation,
      stopReason: 'root-reached',
      targetAutomaticProps: {},
    } as PreviewInspectorPageCandidate;
    const contentPage = {
      ...authoredApp,
      complete: false,
      id: 'page-checkpoint',
      root: { exportName: 'SelectedPage', sourcePath: PAGE },
      rootOwnsRouter: false,
      rootStepIndex: 1,
      stopReason: 'render-path-checkpoint',
    } as PreviewInspectorPageCandidate;
    const plan = {
      pageCandidates: [authoredApp, contentPage],
      renderChain: { paths: [renderPath] },
      renderChainsByExport: { Target: { paths: [renderPath] } },
      target: { exportName: 'Target', sourcePath: TARGET },
    } as unknown as PreviewInspectorAncestorPlan;

    const candidates = createPreviewInspectorPageExecutionCandidates({
      plan,
      selectedPageCandidateId: 'app-root',
    });

    expect(candidates[0]?.browserCandidate.root.sourcePath).toBe(PAGE);
    expect(candidates[0]?.routeRecipe?.rootOwnsRouter).toBe(false);
    expect(candidates[0]?.criticalSurfaces.map((surface) => surface.sourcePath)).not.toContain(APP);
  });

  /** Keeps inline route wrappers around a detached leaf without executing the application Router. */
  it('composes a resolved route page inside its authored element wrappers', () => {
    const routeLocation = {
      componentExportName: 'default',
      componentName: 'SelectedPage',
      componentSourcePath: PAGE,
      dependencyPaths: [APP, ROUTE, PAGE],
      elementWrappers: [
        {
          componentName: 'RouteLayout',
          exportName: 'default',
          sourcePath: ROUTE,
        },
      ],
      evidenceKind: 'route-jsx' as const,
      pathname: '/selected',
      pattern: '/selected',
      routeMounts: [
        {
          basePath: '/selected',
          exportName: 'RouteOwner',
          hasWildcardFallback: true,
          routeSlotCount: 1,
          sourcePath: APP,
        },
      ],
      sourcePath: APP,
    };
    const routePage = {
      complete: true,
      dependencyPaths: [APP, ROUTE, PAGE],
      edges: [],
      id: 'detached-route-leaf',
      root: { exportName: 'default', sourcePath: PAGE },
      rootAutomaticProps: {},
      rootOwnsRouter: false,
      routeLocation,
      stopReason: 'render-path-checkpoint',
      targetAutomaticProps: {},
    } as PreviewInspectorPageCandidate;
    const plan = {
      pageCandidates: [routePage],
      renderChain: { paths: [] },
      renderChainsByExport: {},
      target: { exportName: 'Target', sourcePath: TARGET },
    } as unknown as PreviewInspectorAncestorPlan;

    const candidates = createPreviewInspectorPageExecutionCandidates({ plan });
    const authentic = candidates[0];

    expect(candidates.map((candidate) => candidate.fidelity)).toEqual([
      'page-authentic',
      'page-sliced',
      'target-only',
    ]);
    expect(authentic?.criticalSurfaces).toEqual([
      expect.objectContaining({
        exportName: 'default',
        sourcePath: ROUTE,
        strategy: 'selected-export-slice',
      }),
      expect.objectContaining({
        exportName: 'default',
        sourcePath: PAGE,
        strategy: 'authentic-module-export',
      }),
    ]);
    expect(authentic?.compositionEdges).toEqual([
      expect.objectContaining({
        mode: 'children-slot',
        placementIndex: 0,
      }),
    ]);
    expect(authentic?.routeRecipe).toMatchObject({
      loaderPolicy: 'never-execute',
      mounts: [],
      pathname: '/selected',
      rootOwnsRouter: false,
    });
    expect(authentic?.criticalSurfaces.map((surface) => surface.sourcePath)).not.toContain(APP);
    expect(authentic?.criticalSurfaces.map((surface) => surface.sourcePath)).not.toContain(TARGET);
  });

  it('preserves known generic route state when no authored route mount can be recovered', () => {
    const page = {
      complete: false,
      dependencyPaths: [PAGE],
      edges: [],
      id: 'selected',
      root: { exportName: 'Page', sourcePath: PAGE },
      rootAutomaticProps: {},
      rootOwnsRouter: false,
      routeLocation: {
        componentName: 'Page',
        dependencyPaths: [],
        evidenceKind: 'route-jsx',
        pathname: '/known/path',
        pattern: '/known/path',
        routeMounts: [],
        sourcePath: PAGE,
      },
      stopReason: 'render-path-checkpoint',
      targetAutomaticProps: {},
    } as PreviewInspectorPageCandidate;
    const plan = {
      pageCandidates: [page],
      renderChain: { paths: [] },
      renderChainsByExport: {},
      target: { exportName: 'Target', sourcePath: TARGET },
    } as unknown as PreviewInspectorAncestorPlan;

    const candidates = createPreviewInspectorPageExecutionCandidates({ plan });

    expect(candidates.map((candidate) => candidate.fidelity)).toEqual([
      'page-authentic',
      'page-sliced',
      'target-only',
    ]);
    expect(candidates.every((candidate) => candidate.routeRecipe?.pathname === '/known/path')).toBe(
      true,
    );
    expect(candidates.every((candidate) => candidate.routeRecipe?.rootOwnsRouter === false)).toBe(
      true,
    );
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
    ).toEqual(all);
  });
});
