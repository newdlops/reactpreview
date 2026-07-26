/** Prepares the frozen automatic Inspector frontier before native esbuild begins. */
import type { PreviewCompilerBundleFrontierActivity } from '../../domain/previewCompilerActivity';
import { PreviewBuildStalledError } from '../../domain/previewBuildExecution';
import type { PreviewInspectorAncestorPlan } from './inspector/previewInspectorAncestorPlan';
import type { PreviewInspectorPageExecutionCandidate } from './inspector/previewInspectorPageExecutionTypes';
import { preparePreviewInspectorPageExecutionSelection } from './inspector/previewInspectorPageFrontier';
import {
  preparePreviewInspectorBundleFrontier,
  type PreparedPreviewInspectorBundleFrontier,
} from './inspector/previewInspectorBundleFrontier';
import type { PreviewPreparationPolicy } from './previewPreparationPolicy';

export interface PreparedPreviewInspectorBundleExecution {
  readonly activity: PreviewCompilerBundleFrontierActivity;
  readonly executionCandidate?: PreviewInspectorPageExecutionCandidate;
  readonly prepared: PreparedPreviewInspectorBundleFrontier;
  readonly throwIfRejected: (target: string) => void;
}

export interface PreparePreviewInspectorBundleExecutionOptions {
  readonly additionalCriticalSourcePaths?: readonly string[];
  readonly analysisCandidateCount: number;
  readonly corridorSourceCount: number;
  readonly dependencySnapshotCount: number;
  readonly discoveryTruncated: boolean;
  readonly executablePlan: PreviewInspectorAncestorPlan | undefined;
  readonly executionCandidates?: readonly PreviewInspectorPageExecutionCandidate[];
  readonly policy: PreviewPreparationPolicy;
  readonly readSource: (sourcePath: string) => Promise<string | undefined>;
  readonly resolveModule: (specifier: string, importer: string) => string | undefined;
  readonly styleSnapshotCount: number;
  readonly workspaceRoot: string;
}

/** Returns no frontier for explicit full compatibility and no-candidate Inspector builds. */
export async function preparePreviewInspectorBundleExecution(
  options: PreparePreviewInspectorBundleExecutionOptions,
): Promise<PreparedPreviewInspectorBundleExecution | undefined> {
  if (options.policy.frontierPolicy === undefined || options.executablePlan === undefined)
    return undefined;
  // The automatic compiler always supplies this array. An empty result means no bounded Page
  // Execution Slice was proven (including an invalid persisted retry id), so never revive v1's
  // broad descriptor inventory as an implicit fallback.
  if (options.executionCandidates?.length === 0) {
    throw new PreviewBuildStalledError(
      options.executablePlan.target.sourcePath,
      'analyzing-project',
      0,
      'graph-budget',
    );
  }
  const selection = options.executionCandidates === undefined
    ? undefined
    : await preparePreviewInspectorPageExecutionSelection({
          candidates: options.executionCandidates,
          ...(options.additionalCriticalSourcePaths === undefined
            ? {}
            : { additionalCriticalSourcePaths: options.additionalCriticalSourcePaths }),
          plan: options.executablePlan,
          policy: options.policy.frontierPolicy,
          readSource: options.readSource,
          resolveModule: options.resolveModule,
          workspaceRoot: options.workspaceRoot,
        });
  // An automatic candidate set may be non-empty while every critical closure exceeds the hard
  // envelope. It must end before native bundling, never fall through to v1 broad evidence.
  if (options.executionCandidates !== undefined && selection === undefined) {
    throw new PreviewBuildStalledError(
      options.executablePlan.target.sourcePath,
      'analyzing-project',
      0,
      'graph-budget',
    );
  }
  const prepared = selection?.prepared ?? (await preparePreviewInspectorBundleFrontier({
      ...(options.additionalCriticalSourcePaths === undefined
        ? {}
        : { additionalCriticalSourcePaths: options.additionalCriticalSourcePaths }),
      plan: options.executablePlan,
      policy: options.policy.frontierPolicy,
      readSource: options.readSource,
      resolveModule: options.resolveModule,
      workspaceRoot: options.workspaceRoot,
    }));
  const summary = prepared.frontier.summary;
  const activity: PreviewCompilerBundleFrontierActivity = {
    analysisCandidateCount: options.analysisCandidateCount,
    authoredEdgeCount: summary.authoredEdgeCount,
    corridorSourceCount: options.corridorSourceCount,
    dependencySnapshotCount: options.dependencySnapshotCount,
    discoveryScope: 'selected-corridor',
    discoveryTruncated: options.discoveryTruncated,
    exactModuleCount: summary.exactModuleCount,
    executableCandidateCount: 1,
    frontierSourceBytes: summary.sourceBytes,
    kind: 'bundle-frontier',
    maximumDepth: summary.maximumDepth,
    optionalComponentCount: summary.optionalComponentCount,
    packageDemandSourceCount: summary.packageDemandSourceCount,
    phase: prepared.rejected ? 'rejected' : 'planned',
    preparationMode: options.policy.frontierPolicy.mode,
    projectedEdgeCount: summary.projectedEdgeCount,
    styleSnapshotCount: options.styleSnapshotCount,
    supportModuleCount: summary.supportModuleCount,
    totalAuthoredModuleCount: summary.totalAuthoredModuleCount,
    truncated: prepared.rejected,
    truncationReasons: summary.truncationReasons,
    ...(selection === undefined
      ? {}
      : {
          pageExecution: {
            candidateFidelity: selection.executionPlan.candidate.fidelity,
            candidateId: selection.executionPlan.candidate.id,
            disposition: selection.disposition,
            hardMaximumAuthoredEdges: options.policy.frontierPolicy.maximumAuthoredImportEdgeCount,
            hardMaximumAuthoredModules:
              options.policy.frontierPolicy.maximumTotalAuthoredModuleCount,
            selectedCriticalSurfaceCount: selection.executionPlan.candidate.criticalSurfaces.length,
            softMaximumAuthoredEdges:
              options.policy.frontierPolicy.softMaximumAuthoredImportEdgeCount,
            softMaximumAuthoredModules:
              options.policy.frontierPolicy.softMaximumTotalAuthoredModuleCount,
          },
        }),
  };
  return {
    activity,
    ...(selection === undefined ? {} : { executionCandidate: selection.executionPlan.candidate }),
    prepared,
    throwIfRejected: (target) => {
      if (prepared.rejected)
        throw new PreviewBuildStalledError(
          target,
          'analyzing-project',
          0,
          'graph-budget',
          activity,
        );
    },
  };
}
