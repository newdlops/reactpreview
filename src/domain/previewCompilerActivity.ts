/** Finite compiler telemetry safe to send across the worker protocol and write to logs. */
import type { PreviewPreparationMode } from './preview';
import type { PreviewCompilerFrontierReason } from './previewCompilerFrontier';

export type PreviewCompilerDiscoveryScope = 'selected-corridor' | 'workspace';

export interface PreviewCompilerGraphSummary {
  readonly analysisCandidateCount: number;
  readonly corridorSourceCount: number;
  readonly dependencySnapshotCount: number;
  readonly discoveryScope: PreviewCompilerDiscoveryScope;
  readonly discoveryTruncated: boolean;
  readonly executableCandidateCount: 0 | 1;
  readonly preparationMode: PreviewPreparationMode;
  readonly styleSnapshotCount: number;
}

export interface PreviewCompilerGraphPlanActivity extends PreviewCompilerGraphSummary {
  readonly kind: 'graph-plan';
}

export interface PreviewCompilerNativeBuildActivity extends PreviewCompilerGraphSummary {
  readonly contextAction: 'create' | 'dispose' | 'one-shot' | 'replace' | 'reuse';
  readonly kind: 'native-build';
  readonly pass: 1 | 2;
  readonly phase:
    'creating-context' | 'processing-output' | 'rebuilding' | 'retiring-previous-context';
}

/** Immutable preflight result for the automatic authored module frontier. */
export interface PreviewCompilerBundleFrontierActivity extends PreviewCompilerGraphSummary {
  readonly authoredEdgeCount: number;
  readonly exactModuleCount: number;
  readonly frontierSourceBytes: number;
  readonly graphAdmission: 'unbounded';
  readonly kind: 'bundle-frontier';
  readonly maximumDepth: number;
  readonly optionalComponentCount: number;
  readonly packageDemandSourceCount: number;
  readonly phase: 'planned' | 'rejected';
  readonly preparationMode: Extract<PreviewPreparationMode, 'fast' | 'corridor'>;
  readonly projectedEdgeCount: number;
  readonly supportModuleCount: number;
  readonly totalAuthoredModuleCount: number;
  readonly truncated: boolean;
  readonly truncationReasons: readonly PreviewCompilerFrontierReason[];
  /** Present when Frontier v2 selected a concrete Page Execution Slice. */
  readonly pageExecution?: {
    readonly candidateFidelity:
      | 'page-authentic'
      | 'page-sliced'
      | 'route-page-authentic'
      | 'route-page-sliced'
      | 'target-contextual'
      | 'target-only';
    readonly candidateId: string;
    readonly disposition: 'accepted-unbounded' | 'rejected-structural';
    readonly selectedCriticalSurfaceCount: number;
  };
}

export type PreviewCompilerActivity =
  | PreviewCompilerBundleFrontierActivity
  | PreviewCompilerGraphPlanActivity
  | PreviewCompilerNativeBuildActivity;

/** Rejects non-finite or imprecise protocol values before they can reach UI or logs. */
export function isPreviewCompilerActivity(value: unknown): value is PreviewCompilerActivity {
  if (value === null || typeof value !== 'object') return false;
  const activity = value as Record<string, unknown>;
  const numeric = [
    activity.analysisCandidateCount,
    activity.corridorSourceCount,
    activity.dependencySnapshotCount,
    activity.styleSnapshotCount,
  ];
  if (!numeric.every(isNonNegativeSafeInteger)) return false;
  if (
    activity.kind !== 'bundle-frontier' &&
    activity.kind !== 'graph-plan' &&
    activity.kind !== 'native-build'
  )
    return false;
  if (activity.discoveryScope !== 'selected-corridor' && activity.discoveryScope !== 'workspace')
    return false;
  if (
    activity.preparationMode !== 'fast' &&
    activity.preparationMode !== 'corridor' &&
    activity.preparationMode !== 'full'
  )
    return false;
  if (activity.executableCandidateCount !== 0 && activity.executableCandidateCount !== 1)
    return false;
  if (typeof activity.discoveryTruncated !== 'boolean') return false;
  if (activity.kind === 'bundle-frontier') return isPreviewCompilerBundleFrontierActivity(activity);
  return (
    activity.kind === 'graph-plan' ||
    ((activity.contextAction === 'create' ||
      activity.contextAction === 'dispose' ||
      activity.contextAction === 'one-shot' ||
      activity.contextAction === 'replace' ||
      activity.contextAction === 'reuse') &&
      (activity.pass === 1 || activity.pass === 2) &&
      (activity.phase === 'creating-context' ||
        activity.phase === 'processing-output' ||
        activity.phase === 'rebuilding' ||
        activity.phase === 'retiring-previous-context'))
  );
}

/** Validates automatic-frontier activity before it crosses worker protocol boundaries. */
function isPreviewCompilerBundleFrontierActivity(activity: Record<string, unknown>): boolean {
  const counts = [
    activity.authoredEdgeCount,
    activity.exactModuleCount,
    activity.maximumDepth,
    activity.optionalComponentCount,
    activity.packageDemandSourceCount,
    activity.projectedEdgeCount,
    activity.supportModuleCount,
    activity.totalAuthoredModuleCount,
  ];
  return (
    activity.discoveryScope === 'selected-corridor' &&
    (activity.preparationMode === 'fast' || activity.preparationMode === 'corridor') &&
    counts.every(isNonNegativeSafeInteger) &&
    isNonNegativeSafeInteger(activity.frontierSourceBytes) &&
    activity.graphAdmission === 'unbounded' &&
    (activity.phase === 'planned' || activity.phase === 'rejected') &&
    typeof activity.truncated === 'boolean' &&
    Array.isArray(activity.truncationReasons) &&
    activity.truncationReasons.length <= 16 &&
    activity.truncationReasons.every(isPreviewCompilerFrontierReason) &&
    (activity.pageExecution === undefined ||
      isPreviewCompilerPageExecutionActivity(activity.pageExecution))
  );
}

/** Validates Page Execution selector fields without exposing source paths. */
function isPreviewCompilerPageExecutionActivity(value: unknown): boolean {
  if (value === null || typeof value !== 'object') return false;
  const pageExecution = value as Record<string, unknown>;
  return (
    typeof pageExecution.candidateId === 'string' &&
    pageExecution.candidateId.length > 0 &&
    pageExecution.candidateId.length <= 128 &&
    [
      'page-authentic',
      'page-sliced',
      'route-page-authentic',
      'route-page-sliced',
      'target-contextual',
      'target-only',
    ].includes(pageExecution.candidateFidelity as string) &&
    ['accepted-unbounded', 'rejected-structural'].includes(pageExecution.disposition as string) &&
    isNonNegativeSafeInteger(pageExecution.selectedCriticalSurfaceCount)
  );
}

/** Accepts every exactly representable non-negative integer without an arbitrary graph ceiling. */
function isNonNegativeSafeInteger(value: unknown): value is number {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0;
}

/** Restricts serialized frontier reasons to the domain-owned closed union. */
function isPreviewCompilerFrontierReason(value: unknown): value is PreviewCompilerFrontierReason {
  return (
    typeof value === 'string' &&
    [
      'exact-source-unreadable',
      'source-parse-failure',
      'slice-unavailable',
      'frontier-mismatch',
    ].includes(value)
  );
}
