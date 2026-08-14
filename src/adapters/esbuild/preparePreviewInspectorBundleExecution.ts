/** Prepares the frozen automatic Inspector frontier before native esbuild begins. */
import type {
  PreviewCompilerBundleFrontierActivity,
  PreviewCompilerGraphPlanActivity,
} from '../../domain/previewCompilerActivity';
import { PreviewBuildStalledError } from '../../domain/previewBuildExecution';
import type { PreviewInspectorAncestorPlan } from './inspector/previewInspectorAncestorPlan';
import type { PreviewInspectorBundleDiagnosticsCollector } from './inspector/previewInspectorBundleDiagnostics';
import type { PreviewInspectorPageExecutionCandidate } from './inspector/previewInspectorPageExecutionTypes';
import { preparePreviewInspectorPageExecutionSelection } from './inspector/previewInspectorPageFrontier';
import {
  createPreviewInspectorBundleSourceInventoryMemo,
  preparePreviewInspectorBundleFrontier,
  type PreviewInspectorBundleSourceInventoryMemo,
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
  readonly runtimeCompanionSourcePaths?: readonly string[];
  readonly analysisCandidateCount: number;
  readonly bundleDiagnostics?: PreviewInspectorBundleDiagnosticsCollector;
  readonly corridorSourceCount: number;
  readonly dependencySnapshotCount: number;
  readonly discoveryTruncated: boolean;
  readonly executablePlan: PreviewInspectorAncestorPlan | undefined;
  readonly executionCandidates?: readonly PreviewInspectorPageExecutionCandidate[];
  readonly policy: PreviewPreparationPolicy;
  readonly projectRoot?: string;
  readonly readSource: (sourcePath: string) => Promise<string | undefined>;
  readonly resolveModule: (specifier: string, importer: string) => string | undefined;
  readonly sourceInventoryMemo?: PreviewInspectorBundleSourceInventoryMemo;
  readonly styleSnapshotCount: number;
  readonly workspaceRoot: string;
}

/** Returns no frontier for explicit full compatibility and no-candidate Inspector builds. */
export async function preparePreviewInspectorBundleExecution(
  options: PreparePreviewInspectorBundleExecutionOptions,
): Promise<PreparedPreviewInspectorBundleExecution | undefined> {
  if (options.policy.frontierPolicy === undefined || options.executablePlan === undefined)
    return undefined;
  // The automatic compiler always supplies this array. An empty result means no Page
  // Execution Slice was proven (including an invalid persisted retry id), so never revive v1's
  // broad descriptor inventory as an implicit fallback.
  if (options.executionCandidates?.length === 0) {
    const activity: PreviewCompilerGraphPlanActivity = {
      analysisCandidateCount: options.analysisCandidateCount,
      corridorSourceCount: options.corridorSourceCount,
      dependencySnapshotCount: options.dependencySnapshotCount,
      discoveryScope: 'selected-corridor',
      discoveryTruncated: options.discoveryTruncated,
      executableCandidateCount: 0,
      kind: 'graph-plan',
      preparationMode: options.policy.mode,
      styleSnapshotCount: options.styleSnapshotCount,
    };
    throw new PreviewBuildStalledError(
      options.executablePlan.target.sourcePath,
      'analyzing-project',
      0,
      'candidate-unavailable',
      activity,
    );
  }
  const ownedSourceInventoryMemo =
    options.executionCandidates === undefined || options.sourceInventoryMemo !== undefined
      ? undefined
      : createPreviewInspectorBundleSourceInventoryMemo();
  const sourceInventoryMemo = options.sourceInventoryMemo ?? ownedSourceInventoryMemo;
  try {
    const selectionResult =
      options.executionCandidates === undefined
        ? undefined
        : await preparePreviewInspectorPageExecutionSelection({
          candidates: options.executionCandidates,
          ...(options.bundleDiagnostics === undefined
            ? {}
            : { bundleDiagnostics: options.bundleDiagnostics }),
          ...(options.runtimeCompanionSourcePaths === undefined
            ? {}
            : { runtimeCompanionSourcePaths: options.runtimeCompanionSourcePaths }),
          plan: options.executablePlan,
          policy: options.policy.frontierPolicy,
          ...(options.projectRoot === undefined ? {} : { projectRoot: options.projectRoot }),
          readSource: options.readSource,
          resolveModule: options.resolveModule,
          ...(sourceInventoryMemo === undefined
            ? {}
            : { sourceInventoryMemo }),
          workspaceRoot: options.workspaceRoot,
        });
    const selection = selectionResult?.kind === 'selected' ? selectionResult : undefined;
    const rejectedSelection = selectionResult?.kind === 'rejected' ? selectionResult : undefined;
    const pageExecutionCandidate =
      selection === undefined ? rejectedSelection?.candidate : selection.executionPlan.candidate;
    const prepared =
      selectionResult?.prepared ??
      (await preparePreviewInspectorBundleFrontier({
      ...(options.runtimeCompanionSourcePaths === undefined
        ? {}
        : { runtimeCompanionSourcePaths: options.runtimeCompanionSourcePaths }),
      plan: options.executablePlan,
      policy: options.policy.frontierPolicy,
      ...(options.projectRoot === undefined ? {} : { projectRoot: options.projectRoot }),
      ...(options.bundleDiagnostics === undefined
        ? {}
        : { bundleDiagnostics: options.bundleDiagnostics }),
      readSource: options.readSource,
      resolveModule: options.resolveModule,
      ...(sourceInventoryMemo === undefined
        ? {}
        : { sourceInventoryMemo }),
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
    graphAdmission:
      (summary.boundedProjectionCount ?? 0) > 0 ? 'bounded-projection' : 'unbounded',
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
    ...(pageExecutionCandidate === undefined
      ? {}
      : {
          pageExecution: {
            candidateFidelity: pageExecutionCandidate.fidelity,
            candidateId: pageExecutionCandidate.id,
            disposition: selectionResult?.disposition ?? 'rejected-structural',
            selectedCriticalSurfaceCount: pageExecutionCandidate.criticalSurfaces.length,
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
          'candidate-unavailable',
          activity,
        );
    },
    };
  } finally {
    ownedSourceInventoryMemo?.release();
  }
}
