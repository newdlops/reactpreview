/**
 * Narrows a broad Page Inspector analysis plan to the one caller path allowed to affect esbuild.
 *
 * The original plan remains the browser descriptor contract. This derived plan is only passed to
 * build-time plugins whose path sets control import traversal, stylesheet discovery, and package
 * peer resolution.
 */
import type { PreviewInspectorAncestorPlan } from './previewInspectorAncestorPlan';
import { createPreviewInspectorVirtualPageCandidates } from './previewInspectorVirtualPagePlan';
import { selectPreviewInspectorExecutableCandidate } from './previewInspectorExecutableCandidateSelection';

/**
 * Creates an active-candidate-only plugin plan without mutating analyzer-owned evidence.
 *
 * @param plan Full ranked static analysis result.
 * @param selectedPageCandidateId Optional persisted caller-path identity.
 * @returns A plan containing one candidate, or the original plan when no virtual page exists.
 */
export function createPreviewInspectorExecutablePlan(
  plan: PreviewInspectorAncestorPlan,
  selectedPageCandidateId: string | undefined,
  maximumShallowVisualPaths?: number,
): PreviewInspectorAncestorPlan {
  const candidates = createPreviewInspectorVirtualPageCandidates(
    plan.pageCandidates,
    plan.pageCandidates.length,
    plan.shallowVisualPaths ?? [],
  );
  const selection = selectPreviewInspectorExecutableCandidate(candidates, selectedPageCandidateId);
  if (selection === undefined) return plan;
  const active = selection.active.browserCandidate;
  const targetExportName = plan.target.exportName;
  const targetRenderChain = plan.renderChainsByExport[targetExportName] ?? plan.renderChain;
  const dependencyPaths = new Set([
    plan.target.sourcePath,
    active.root.sourcePath,
    ...active.dependencyPaths,
    ...(active.renderPath?.steps.flatMap((step) => [
      step.sourcePath,
      ...(step.evidenceSourcePaths ?? []),
    ]) ?? []),
  ]);
  const corridorPaths = new Set<string>([
    plan.target.sourcePath,
    active.root.sourcePath,
    ...active.dependencyPaths,
    ...(active.renderPath?.steps.flatMap((step) => [
      step.sourcePath,
      ...(step.evidenceSourcePaths ?? []),
    ]) ?? []),
  ]);
  const shallowVisualPaths = plan.shallowVisualPaths
    ?.filter(
      (item) => corridorPaths.has(item.importerPath) || corridorPaths.has(item.selectedChildPath),
    )
    .slice(0, maximumShallowVisualPaths);
  return Object.freeze({
    ...plan,
    complete: active.complete,
    dependencyPaths: Object.freeze([...dependencyPaths]),
    edges: Object.freeze([...active.edges]),
    pageCandidates: Object.freeze([active]),
    renderChain:
      active.renderPath === undefined
        ? targetRenderChain
        : Object.freeze({
            ...targetRenderChain,
            dependencyPaths: Object.freeze([...active.dependencyPaths]),
            paths: Object.freeze([active.renderPath]),
          }),
    renderChainsByExport: Object.freeze({ [targetExportName]: targetRenderChain }),
    ...(plan.renderOutcomesByExport?.[targetExportName] === undefined
      ? {}
      : {
          renderOutcomesByExport: Object.freeze({
            [targetExportName]: plan.renderOutcomesByExport[targetExportName],
          }),
        }),
    root: active.root,
    rootAutomaticProps: active.rootAutomaticProps,
    stopReason: active.stopReason,
    targetAutomaticProps: active.targetAutomaticProps,
    ...(shallowVisualPaths === undefined
      ? {}
      : { shallowVisualPaths: Object.freeze([...shallowVisualPaths]) }),
  });
}
