/** Shared deterministic fixtures and race controls for esbuildPreviewCompleteRouteInventory.test.ts. */
import { fileURLToPath } from 'node:url';
import { expect } from 'vitest';
import { EsbuildPreviewCompiler } from '../../../src/adapters/esbuild/esbuildPreviewCompiler';
import type { PreviewInspectorBundleSourceInventoryMemo } from '../../../src/adapters/esbuild/inspector/previewInspectorBundleFrontier';
import type { PreviewResolutionConfinementPathMemo } from '../../../src/adapters/esbuild/previewResolutionConfinement';
import type { PreviewStaticModuleResolutionMemo } from '../../../src/adapters/esbuild/previewStaticModuleResolver';
import { type PreviewBuildExecutionContext } from '../../../src/domain/previewBuildExecution';
import type { PreviewCompilerBundleFrontierActivity } from '../../../src/domain/previewCompilerActivity';

export const REPOSITORY_ROOT = fileURLToPath(new URL('../../../', import.meta.url));

/** Verifies that one request memo retained useful work and released every cache layer. */
export function expectReleasedRequestMemo(
  memo: PreviewInspectorBundleSourceInventoryMemo | undefined,
  reused: boolean,
): void {
  if (memo === undefined) throw new Error('Expected an execution-planning request memo.');
  expect(memo.getStatistics()).toMatchObject({ entries: 0, released: true });
  expect(memo.getSliceStatistics()).toMatchObject({ sliceEntries: 0, released: true });
  const closures = memo.getClosureStatistics();
  expect(closures).toMatchObject({ closureEntries: 0, released: true });
  const graph = memo.getGraphStatistics();
  expect([
    graph.dynamicResolutionEntries,
    graph.proposalEntries,
    graph.resolvedNodeEntries,
    graph.rootedGraphEntries,
    graph.released,
  ]).toEqual([0, 0, 0, 0, true]);
  expect(graph.resolvedNodeComputations).toBeGreaterThan(0);
  expect(graph.resolvedNodeRequests).toBe(graph.resolvedNodeComputations + graph.resolvedNodeHits);
  if (reused)
    expect(
      closures.closureHits +
        graph.dynamicResolutionHits +
        graph.proposalHits +
        graph.resolvedNodeHits +
        graph.rootedGraphHits,
    ).toBeGreaterThan(0);
}

/** Exposes only the inventory owner used by these deterministic planner failure injections. */
export function inventoryInternals(compiler: EsbuildPreviewCompiler): Record<string, unknown> {
  return (compiler as unknown as { readonly routeInventory: Record<string, unknown> })
    .routeInventory;
}

/** Verifies common successful-only resolution/path memo accounting after request release. */
export function expectReleasedReusableMemo(
  memo: PreviewResolutionConfinementPathMemo | PreviewStaticModuleResolutionMemo,
  reused: boolean,
): void {
  const statistics = memo.getStatistics();
  expect(statistics).toMatchObject({ entries: 0, released: true });
  expect(statistics.requests).toBe(statistics.computations + statistics.hits);
  if (reused) expect(statistics.hits).toBeGreaterThan(0);
}

/** Captures each distinct final-frontier activity emitted by a real compiler invocation. */
export function createFrontierActivityContext(
  activities: PreviewCompilerBundleFrontierActivity[],
): PreviewBuildExecutionContext {
  return {
    reportProgress: (stage, activity) => {
      void stage;
      if (activity?.kind !== 'bundle-frontier') return;
      if (activities.at(-1) !== activity) activities.push(activity);
    },
  };
}
