/** Formats bounded compiler activity for logs without leaking source text or paths. */
import type { PreviewCompilerActivity } from '../domain/previewCompilerActivity';

/** Formats one bounded activity record for diagnostic logging. */
export function formatPreviewCompilerActivity(activity: PreviewCompilerActivity): string {
  if (activity.kind === 'bundle-frontier') {
    return `Preview compiler frontier phase=${activity.phase}, exact=${activity.exactModuleCount.toString()}, optional-components=${activity.optionalComponentCount.toString()}, support=${activity.supportModuleCount.toString()}, total=${activity.totalAuthoredModuleCount.toString()}, edges=${activity.authoredEdgeCount.toString()}, projected=${activity.projectedEdgeCount.toString()}, bytes=${activity.frontierSourceBytes.toString()}, depth=${activity.maximumDepth.toString()}, package-demands=${activity.packageDemandSourceCount.toString()}, truncated=${activity.truncated ? 'yes' : 'no'}, reasons=${activity.truncationReasons.join(',') || 'none'}.`;
  }
  const frontier =
    activity.frontier === undefined
      ? 'frontier=full'
      : `frontier=${activity.frontier.rejected ? 'rejected' : 'admitted'}/${activity.frontier.maximumTotalModules.toString()}${activity.frontier.reasons.length === 0 ? '' : `:${activity.frontier.reasons.join(',')}`}`;
  const summary = `mode=${activity.preparationMode}, scope=${activity.discoveryScope}, candidates=${activity.analysisCandidateCount.toString()}, corridor=${activity.corridorSourceCount.toString()}, snapshots=${activity.dependencySnapshotCount.toString()}, styles=${activity.styleSnapshotCount.toString()}, truncated=${activity.discoveryTruncated ? 'yes' : 'no'}, ${frontier}`;
  return activity.kind === 'graph-plan'
    ? `Preview compiler graph plan: ${summary}.`
    : `Preview compiler native build (${activity.contextAction}/${activity.phase}, pass ${activity.pass.toString()}): ${summary}.`;
}
