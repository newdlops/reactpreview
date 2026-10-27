/** Covers surfaces behavior for previewInspectorPageExecutionCandidates. */
/** Verifies authored-source previewInspectorPageExecutionCandidates invariants. */
import { mkdtemp, rm, writeFile } from 'node:fs/promises';

import os from 'node:os';

import path from 'node:path';

import { describe, expect, it } from 'vitest';

import {
  createPreviewInspectorExecutionRootModuleContract,
  createPreviewInspectorPageExecutionCandidates,
  createPreviewInspectorPageExecutionSource,
  type PreviewInspectorAncestorPlan,
  type PreviewInspectorPageCandidate,
} from '../../../../src/adapters/esbuild/inspector';

import type { PreviewRenderChainCandidate } from '../../../../src/adapters/esbuild/renderGraph';

import { APP, PAGE, ROUTE, TARGET } from './previewInspectorPageExecutionCandidatesFixtures';

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
      rootAutomaticProps: { staleRoot: true },
      rootInference: {
        provenance: [{ kind: 'string', path: 'staleRoot', source: 'type' }],
        shape: {
          kind: 'object',
          properties: { staleRoot: { kind: 'string' } },
        },
      },
      rootOwnsRouter: true,
      rootStepIndex: 1,
      routeMountBasePath: '/stale',
      routeSlotCount: 99,
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
      rootOwnsRouter: false,
    });
    expect(candidates[0]?.criticalSurfaces.map((surface) => surface.sourcePath)).toEqual([
      ROUTE,
      PAGE,
      TARGET,
    ]);
    expect(candidates[0]?.criticalSurfaces.map((surface) => surface.sourcePath)).not.toContain(APP);
    expect(candidates.map((item) => item.browserCandidate.root.sourcePath)).toEqual([
      ROUTE,
      ROUTE,
      PAGE,
      PAGE,
      TARGET,
    ]);
    expect(
      candidates.every((item) => {
        const executionRoot = item.criticalSurfaces.find(
          (surface) => surface.id === item.executionRootSurfaceId,
        );
        return (
          executionRoot?.sourcePath === item.browserCandidate.root.sourcePath &&
          executionRoot.exportName === item.browserCandidate.root.exportName &&
          Object.isFrozen(item.browserCandidate)
        );
      }),
    ).toBe(true);
    expect(candidates[0]?.browserCandidate).toMatchObject({
      root: { exportName: 'RouteLayout', sourcePath: ROUTE },
      rootAutomaticProps: {},
      rootOwnsRouter: false,
      routeMountBasePath: '/',
      routeSlotCount: 1,
      wildcardFallbackPresent: true,
    });
    expect(candidates[0]?.browserCandidate.rootStepIndex).toBeUndefined();
    expect(candidates[0]?.browserCandidate.rootInference).toBeUndefined();
    expect(candidates[2]?.browserCandidate).toMatchObject({
      root: { exportName: 'SelectedPage', sourcePath: PAGE },
      rootAutomaticProps: { staleRoot: true },
      rootInference: candidate.rootInference,
      rootOwnsRouter: true,
      rootStepIndex: 1,
      routeMountBasePath: '/stale',
      routeSlotCount: 99,
      wildcardFallbackPresent: false,
    });
    expect(candidates.at(-1)?.browserCandidate).toMatchObject({
      root: { exportName: 'Target', sourcePath: TARGET },
      rootAutomaticProps: {},
      rootOwnsRouter: false,
    });
    expect(candidates.at(-1)?.browserCandidate.rootStepIndex).toBeUndefined();
    expect(candidates.at(-1)?.browserCandidate.rootInference).toBeUndefined();
    expect(candidates.at(-1)?.browserCandidate.routeMountBasePath).toBeUndefined();
    expect(candidate.root).toEqual({ exportName: 'SelectedPage', sourcePath: PAGE });
    expect(candidate.rootAutomaticProps).toEqual({ staleRoot: true });
    expect(candidate.rootStepIndex).toBe(1);
    expect(candidates[0]?.executionRootSurfaceId).toBe(candidates[0]?.criticalSurfaces[0]?.id);
    expect(
      candidates[0]?.criticalSurfaces.find(
        (surface) => surface.id === candidates[0]?.runtimeTargetSurfaceId,
      ),
    ).toMatchObject({ exportName: 'Target', sourcePath: TARGET });
    expect(candidates.at(-1)?.criticalSurfaces).toEqual([
      expect.objectContaining({ sourcePath: TARGET, strategy: 'authentic-module-export' }),
    ]);
    expect(candidates.every((item) => item.routeRecipe?.pathname === '/selected/42')).toBe(true);
    expect(candidates.map((item) => item.routeRecipe?.rootOwnsRouter)).toEqual([
      false,
      false,
      true,
      true,
      false,
    ]);
    const authenticRouteCandidate = candidates[0];
    if (authenticRouteCandidate === undefined) {
      throw new Error('Expected one authentic route candidate.');
    }
    const executionRoot = authenticRouteCandidate.criticalSurfaces.find(
      (surface) => surface.id === authenticRouteCandidate.executionRootSurfaceId,
    );
    if (executionRoot === undefined) throw new Error('Expected an execution-root surface.');
    const executionSource = createPreviewInspectorPageExecutionSource({
      candidate: authenticRouteCandidate,
      executionRootModuleContract: createPreviewInspectorExecutionRootModuleContract({
        exportName: executionRoot.exportName,
        preparedSourceText:
          executionRoot.exportName === 'default'
            ? 'export default function PreviewRouteRoot() { return null; }'
            : `export function ${executionRoot.exportName}() { return null; }`,
        sourcePath: executionRoot.sourcePath,
        surfaceId: executionRoot.id,
      }),
      target: plan.target,
    });
    expect(executionSource).not.toContain('PreviewInspectorContextualTargetFallback');
  });

  it('keeps the nearest complete loading surface before falling back to a transient primitive', async () => {
    const workspaceRoot = await mkdtemp(path.join(os.tmpdir(), 'react-preview-loading-surface-'));
    const targetPath = path.join(workspaceRoot, 'Skeleton.tsx');
    const loadingSurfacePath = path.join(workspaceRoot, 'DetailBottomSheetSkeleton.tsx');
    const pagePath = path.join(workspaceRoot, 'ExplorePage.tsx');
    try {
      await Promise.all([
        writeFile(
          targetPath,
          'export const Skeleton = ({ className = "" }) => <div className={className} />;',
        ),
        writeFile(
          loadingSurfacePath,
          [
            "import { Skeleton } from './Skeleton';",
            'export const DetailBottomSheetSkeleton = () => (',
            '  <section><Skeleton className="hero" /><Skeleton className="title" /></section>',
            ');',
          ].join('\n'),
        ),
        writeFile(
          pagePath,
          [
            "import { DetailBottomSheetSkeleton } from './DetailBottomSheetSkeleton';",
            'export const ExplorePage = () => <main><DetailBottomSheetSkeleton /></main>;',
          ].join('\n'),
        ),
      ]);
      const renderPath: PreviewRenderChainCandidate = {
        id: 'detail-bottom-sheet-loading-path',
        steps: [
          {
            certainty: 'confirmed',
            kind: 'component-render',
            label: 'Skeleton',
            occurrenceStart: 1,
            sourcePath: targetPath,
            wrapperNames: [],
          },
          {
            certainty: 'conditional',
            kind: 'component-render',
            label: 'DetailBottomSheetSkeleton',
            occurrenceStart: 2,
            sourcePath: loadingSurfacePath,
            wrapperNames: [],
          },
          {
            certainty: 'confirmed',
            kind: 'component-render',
            label: 'ExplorePage',
            occurrenceStart: 3,
            sourcePath: pagePath,
            wrapperNames: [],
          },
        ],
      };
      const page = {
        complete: true,
        dependencyPaths: [targetPath, loadingSurfacePath, pagePath],
        edges: [],
        id: 'explore-page',
        renderPath,
        root: { exportName: 'ExplorePage', sourcePath: pagePath },
        rootAutomaticProps: {},
        rootOwnsRouter: false,
        rootStepIndex: 2,
        stopReason: 'root-reached',
        targetAutomaticProps: {},
      } as PreviewInspectorPageCandidate;
      const plan = {
        pageCandidates: [page],
        renderChain: { paths: [renderPath] },
        renderChainsByExport: { Skeleton: { paths: [renderPath] } },
        target: { exportName: 'Skeleton', sourcePath: targetPath },
      } as unknown as PreviewInspectorAncestorPlan;

      const candidates = createPreviewInspectorPageExecutionCandidates({ plan });
      expect(candidates.map((candidate) => candidate.fidelity)).toEqual([
        'page-authentic',
        'page-sliced',
        'target-contextual',
        'target-only',
      ]);
      const contextual = candidates.find((candidate) => candidate.fidelity === 'target-contextual');
      expect(contextual?.browserCandidate.root).toEqual({
        exportName: 'DetailBottomSheetSkeleton',
        sourcePath: loadingSurfacePath,
      });
      expect(contextual?.standaloneTarget).toBe(false);
      expect(contextual?.criticalSurfaces).toEqual([
        expect.objectContaining({
          exportName: 'DetailBottomSheetSkeleton',
          sourcePath: loadingSurfacePath,
          strategy: 'authentic-module-export',
        }),
        expect.objectContaining({
          exportName: 'Skeleton',
          sourcePath: targetPath,
          strategy: 'authentic-module-export',
        }),
      ]);
      expect(contextual?.compositionEdges).toEqual([
        {
          childSurfaceId: contextual?.runtimeTargetSurfaceId,
          mode: 'contains-authored-child',
          parentSurfaceId: contextual?.executionRootSurfaceId,
          placementIndex: 0,
        },
      ]);
    } finally {
      await rm(workspaceRoot, { force: true, recursive: true });
    }
  });

  /**
   * A sliced route page intentionally omits a framework layout that can fail independently. Its
   * retained layout edge is provenance only and must not turn the authored page into an orphan,
   * otherwise role selection incorrectly promotes the primitive target to the execution root.
   */
  it('roots a framework-free page slice at the authored route page', () => {
    const targetPath = '/workspace/components/Skeleton.tsx';
    const pagePath = '/workspace/app/explore/page.tsx';
    const layoutPath = '/workspace/app/layout.tsx';
    const renderPath: PreviewRenderChainCandidate = {
      id: 'next-app-page-to-skeleton',
      steps: [
        {
          certainty: 'confirmed',
          kind: 'component-render',
          label: 'Skeleton',
          occurrenceStart: 1,
          sourcePath: targetPath,
          wrapperNames: [],
        },
        {
          certainty: 'confirmed',
          kind: 'component-render',
          label: 'ExplorePage',
          occurrenceStart: 2,
          sourcePath: pagePath,
          wrapperNames: [],
        },
      ],
    };
    const page = {
      complete: true,
      dependencyPaths: [targetPath, pagePath, layoutPath],
      edges: [],
      id: 'next-app-explore-page',
      nextAppLayoutChain: [{ exportName: 'default', params: {}, sourcePath: layoutPath }],
      renderPath,
      root: { exportName: 'default', sourcePath: pagePath },
      rootAutomaticProps: {},
      rootOwnsRouter: false,
      rootStepIndex: 1,
      routeLocation: {
        componentName: 'NextAppPage',
        evidenceKind: 'next-app-filesystem',
        params: {},
        pathname: '/explore',
        pattern: '/explore',
        searchParams: {},
        sourcePath: pagePath,
      },
      stopReason: 'root-reached',
      targetAutomaticProps: {},
    } as PreviewInspectorPageCandidate;
    const plan = {
      pageCandidates: [page],
      renderChain: { paths: [renderPath] },
      renderChainsByExport: { Skeleton: { paths: [renderPath] } },
      target: { exportName: 'Skeleton', sourcePath: targetPath },
    } as unknown as PreviewInspectorAncestorPlan;

    const candidates = createPreviewInspectorPageExecutionCandidates({ plan });
    const authentic = candidates.find((candidate) => candidate.fidelity === 'page-authentic');
    const sliced = candidates.find((candidate) => candidate.fidelity === 'page-sliced');

    expect(authentic?.browserCandidate.root).toEqual({
      exportName: 'default',
      sourcePath: layoutPath,
    });
    expect(sliced?.browserCandidate.root).toEqual({
      exportName: 'default',
      sourcePath: pagePath,
    });
    expect(sliced?.executionRootSurfaceId).toBe(
      sliced?.criticalSurfaces.find((surface) => surface.sourcePath === pagePath)?.id,
    );
    expect(sliced?.executionRootSurfaceId).not.toBe(sliced?.runtimeTargetSurfaceId);
  });
});
