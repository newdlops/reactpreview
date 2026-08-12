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
): PreviewInspectorAncestorPlan {
  const candidates = createPreviewInspectorVirtualPageCandidates(
    plan.pageCandidates,
    plan.pageCandidates.length,
    plan.shallowVisualPaths ?? [],
  );
  const selection = selectPreviewInspectorExecutableCandidate(candidates, selectedPageCandidateId);
  if (selection === undefined) return plan;
  const active = selection.active.browserCandidate;
  /*
   * Route-choice expansion may replace a candidate target with an importable route leaf before
   * VirtualPage selects its execution root. That leaf is page context, not current-file ownership.
   * A named-export scenario is allowed to change the export only when it still belongs to the
   * prepared target module and has an analyzed render chain there.
   */
  const authoredTarget = selection.active.authoredCandidate.target;
  const activeTarget =
    authoredTarget?.sourcePath === plan.target.sourcePath &&
    plan.renderChainsByExport[authoredTarget.exportName] !== undefined
      ? authoredTarget
      : plan.target;
  const targetExportName = activeTarget.exportName;
  const targetRenderChain = plan.renderChainsByExport[targetExportName] ?? plan.renderChain;
  const executableRenderChain =
    active.renderPath === undefined
      ? targetRenderChain
      : Object.freeze({
          ...targetRenderChain,
          dependencyPaths: Object.freeze([...active.dependencyPaths]),
          paths: Object.freeze([active.renderPath]),
        });
  const dependencyPaths = new Set([
    activeTarget.sourcePath,
    active.root.sourcePath,
    ...active.dependencyPaths,
    ...(active.renderPath?.steps.flatMap((step) => [
      step.sourcePath,
      ...(step.evidenceSourcePaths ?? []),
    ]) ?? []),
  ]);
  const corridorPaths = new Set<string>([
    activeTarget.sourcePath,
    active.root.sourcePath,
    ...active.dependencyPaths,
    ...(active.renderPath?.steps.flatMap((step) => [
      step.sourcePath,
      ...(step.evidenceSourcePaths ?? []),
    ]) ?? []),
  ]);
  const shallowVisualPaths = plan.shallowVisualPaths?.filter(
    (item) => corridorPaths.has(item.importerPath) || corridorPaths.has(item.selectedChildPath),
  );
  return Object.freeze({
    ...plan,
    complete: active.complete,
    dependencyPaths: Object.freeze([...dependencyPaths]),
    edges: Object.freeze([...active.edges]),
    pageCandidates: Object.freeze([active]),
    renderChain: executableRenderChain,
    renderChainsByExport: Object.freeze({ [targetExportName]: executableRenderChain }),
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
    target: activeTarget,
    targetAutomaticProps: active.targetAutomaticProps,
    ...(shallowVisualPaths === undefined
      ? {}
      : { shallowVisualPaths: Object.freeze([...shallowVisualPaths]) }),
  });
}
