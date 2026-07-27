/** Formats bounded compiler activity for logs without leaking source text or paths. */
import type { PreviewCompilerActivity } from '../domain/previewCompilerActivity';

/** Formats one bounded activity record for diagnostic logging. */
export function formatPreviewCompilerActivity(activity: PreviewCompilerActivity): string {
  if (activity.kind === 'bundle-frontier') {
    const pageExecution =
      activity.pageExecution === undefined
        ? ''
        : `, candidate=${activity.pageExecution.candidateId}, fidelity=${activity.pageExecution.candidateFidelity}, admission=${activity.pageExecution.disposition}, surfaces=${activity.pageExecution.selectedCriticalSurfaceCount.toString()}`;
    return `Preview compiler frontier phase=${activity.phase}, graph-admission=${activity.graphAdmission}, exact=${activity.exactModuleCount.toString()}, optional-components=${activity.optionalComponentCount.toString()}, support=${activity.supportModuleCount.toString()}, total=${activity.totalAuthoredModuleCount.toString()}, edges=${activity.authoredEdgeCount.toString()}, projected=${activity.projectedEdgeCount.toString()}, bytes=${activity.frontierSourceBytes.toString()}, depth=${activity.maximumDepth.toString()}, package-demands=${activity.packageDemandSourceCount.toString()}, truncated=${activity.truncated ? 'yes' : 'no'}, reasons=${activity.truncationReasons.join(',') || 'none'}${pageExecution}.`;
  }
  const summary = `mode=${activity.preparationMode}, scope=${activity.discoveryScope}, candidates=${activity.analysisCandidateCount.toString()}, corridor=${activity.corridorSourceCount.toString()}, snapshots=${activity.dependencySnapshotCount.toString()}, styles=${activity.styleSnapshotCount.toString()}, truncated=${activity.discoveryTruncated ? 'yes' : 'no'}, graph-admission=unbounded`;
  return activity.kind === 'graph-plan'
    ? `Preview compiler graph plan: ${summary}.`
    : `Preview compiler native build (${activity.contextAction}/${activity.phase}, pass ${activity.pass.toString()}): ${summary}.`;
}
