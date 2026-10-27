/** Covers selection behavior for previewInspectorPageExecutionCandidates. */
/** Verifies authored-source previewInspectorPageExecutionCandidates invariants. */

import { describe, expect, it } from 'vitest';

import {
  createEligiblePreviewInspectorPageExecutionCandidates,
  createPreviewInspectorPageExecutionCandidates,
  resolvePreviewInspectorRuntimeOwnershipTarget,
  type PreviewInspectorAncestorPlan,
  type PreviewInspectorPageCandidate,
} from '../../../../src/adapters/esbuild/inspector';

import { PreviewCompilationError } from '../../../../src/domain/preview';

import type { PreviewRenderChainCandidate } from '../../../../src/adapters/esbuild/renderGraph';

import { APP, PAGE, ROUTE, TARGET } from './previewInspectorPageExecutionCandidatesFixtures';

describe('createPreviewInspectorPageExecutionCandidates', () => {
  it('retains an authenticated direct catalog owner around a detached selected route leaf', () => {
    const renderPath: PreviewRenderChainCandidate = {
      entryPoint: {
        kind: 'create-root',
        occurrenceStart: 3,
        sourcePath: '/workspace/main.tsx',
        wrapperNames: [],
      },
      id: 'catalog-route-path',
      steps: [
        {
          certainty: 'confirmed',
          kind: 'route-branch',
          label: 'SelectedPage',
          occurrenceStart: 1,
          sourcePath: PAGE,
          wrapperNames: [],
        },
        {
          certainty: 'confirmed',
          kind: 'component-render',
          label: 'AppRouter',
          occurrenceStart: 2,
          sourcePath: APP,
          wrapperNames: [],
        },
      ],
    };
    const routeLocation = {
      componentExportName: 'default',
      componentName: 'SelectedPage',
      componentSourcePath: PAGE,
      dependencyPaths: [APP, PAGE, '/workspace/pages.json'],
      directRouteOwnerSourcePath: APP,
      evidenceKind: 'route-catalog' as const,
      pathname: '/selected',
      pattern: '/selected',
      routeMounts: [
        {
          basePath: '/',
          exportName: 'default',
          hasWildcardFallback: false,
          routeSlotCount: 1,
          sourcePath: APP,
        },
      ],
      sourcePath: '/workspace/pages.json',
    };
    const authoredApp = {
      complete: true,
      dependencyPaths: [APP, PAGE, '/workspace/pages.json'],
      edges: [],
      id: 'catalog-app-root',
      renderPath,
      root: { exportName: 'default', sourcePath: APP },
      rootAutomaticProps: {},
      rootOwnsRouter: true,
      rootStepIndex: 1,
      routeLocation,
      stopReason: 'root-reached',
      targetAutomaticProps: {},
    } as PreviewInspectorPageCandidate;
    const contentPage = {
      ...authoredApp,
      complete: false,
      id: 'catalog-page-checkpoint',
      root: { exportName: 'default', sourcePath: PAGE },
      rootOwnsRouter: false,
      rootStepIndex: 0,
      stopReason: 'render-path-checkpoint',
    } as PreviewInspectorPageCandidate;
    const plan = {
      pageCandidates: [authoredApp, contentPage],
      renderChain: { paths: [renderPath] },
      renderChainsByExport: { default: { paths: [renderPath] } },
      target: { exportName: 'default', sourcePath: APP },
    } as unknown as PreviewInspectorAncestorPlan;

    const candidates = createPreviewInspectorPageExecutionCandidates({
      plan,
      selectedPageCandidateId: 'catalog-app-root',
      targetMode: 'selected-route-leaf',
    });

    expect(candidates.map((candidate) => candidate.fidelity)).toContain('route-page-authentic');
    expect(candidates[0]?.browserCandidate.root).toEqual({
      exportName: 'default',
      sourcePath: APP,
    });
    expect(candidates[0]?.routeRecipe?.mounts).toHaveLength(1);
    expect(typeof candidates[0]?.routeRecipe?.mounts[0]?.parentSurfaceId).toBe('string');
    expect(candidates[0]?.executionRootSurfaceId).not.toBe(candidates[0]?.runtimeTargetSurfaceId);
    expect(candidates.map((candidate) => candidate.fidelity)).not.toContain('target-only');
    const candidate = candidates[0];
    const evidenceMount = routeLocation.routeMounts[0];
    const recipeMount = candidate?.routeRecipe?.mounts[0];
    if (candidate === undefined || evidenceMount === undefined || recipeMount === undefined) {
      throw new Error('Expected one complete direct catalog-owner mount.');
    }
    const ownershipOptions = {
      analysisTarget: plan.target,
      candidate,
      diagnosticPath: APP,
      routeSelection: [{ componentName: 'SelectedPage', pattern: '/selected' }],
      routeSelectionResolution: 'exact' as const,
      selectedLeafSourceText:
        'export default function SelectedPage() { return <main>selected route</main>; }',
      targetMode: 'selected-route-leaf' as const,
    };
    expect(resolvePreviewInspectorRuntimeOwnershipTarget(ownershipOptions)).toEqual({
      exportName: 'default',
      sourcePath: PAGE,
    });

    const withEvidenceMount = (mount: typeof evidenceMount): typeof candidate => ({
      ...candidate,
      browserCandidate: {
        ...candidate.browserCandidate,
        routeLocation: {
          ...routeLocation,
          routeMounts: [mount],
        },
      },
    });
    for (const invalidCandidate of [
      withEvidenceMount({ ...evidenceMount, sourcePath: ROUTE }),
      withEvidenceMount({ ...evidenceMount, exportName: 'OtherApp' }),
      {
        ...candidate,
        routeRecipe: {
          ...candidate.routeRecipe,
          mounts: [{ ...recipeMount, contextPattern: '/unexpected/*' }],
        },
      },
    ]) {
      expect(() =>
        resolvePreviewInspectorRuntimeOwnershipTarget({
          ...ownershipOptions,
          candidate: invalidCandidate as never,
        }),
      ).toThrow(PreviewCompilationError);
    }
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
