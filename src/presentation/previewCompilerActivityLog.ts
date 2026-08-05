/* eslint-disable jsdoc/require-jsdoc, @typescript-eslint/explicit-function-return-type, @typescript-eslint/no-non-null-assertion */
/** Formats bounded compiler activity for logs without leaking source text or paths. */
import type { PreviewCompilerActivity } from '../domain/previewCompilerActivity';
import type { PreviewFrontierMismatchEvidence } from '../domain/previewBuildExecution';
const FRONTIER_PREFIX = 'React Preview frontier mismatch evidence: ';
const FRONTIER_MAX = 2048;
export function formatPreviewFrontierMismatchEvidence(
  evidence: PreviewFrontierMismatchEvidence,
): string {
  const path = (
    value: { digest: string; workspaceRelativePath?: string },
    hashesOnly: boolean,
  ) => ({
    digest: value.digest,
    ...(hashesOnly || value.workspaceRelativePath === undefined
      ? {}
      : { workspaceRelativePath: value.workspaceRelativePath }),
  });
  const payload = (hashesOnly: boolean) =>
    evidence.cause === 'guard-escape'
      ? {
          cause: evidence.cause,
          source: path(evidence.source, hashesOnly),
          importer: path(evidence.importer!, hashesOnly),
          specifier: {
            digest: evidence.specifier!.digest,
            ...(hashesOnly || evidence.specifier!.value === undefined
              ? {}
              : { value: evidence.specifier!.value }),
          },
        }
      : evidence.cause === 'missing-execution-surface'
        ? {
            cause: evidence.cause,
            source: path(evidence.source, hashesOnly),
            surface: {
              identityDigest: evidence.surface!.identityDigest,
              strategy: evidence.surface!.strategy,
            },
          }
        : evidence.importer !== undefined && evidence.specifier !== undefined
          ? {
              cause: evidence.cause,
              source: path(evidence.source, hashesOnly),
              importer: path(evidence.importer, hashesOnly),
              specifier: {
                digest: evidence.specifier.digest,
                ...(hashesOnly || evidence.specifier.value === undefined
                  ? {}
                  : { value: evidence.specifier.value }),
              },
            }
          : { cause: evidence.cause, source: path(evidence.source, hashesOnly) };
  const full = FRONTIER_PREFIX + JSON.stringify(payload(false));
  return full.length <= FRONTIER_MAX ? full : FRONTIER_PREFIX + JSON.stringify(payload(true));
}

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
