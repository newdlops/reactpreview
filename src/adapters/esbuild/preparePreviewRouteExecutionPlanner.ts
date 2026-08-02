/** Shared real fast-context route planner used by inventory analysis and compilation. */
import type { PreviewBuildRequest, PreviewRouteExecutionPlanArtifact } from '../../domain/preview';
import {
  PreviewCompilationError,
  PreviewRouteExecutionPlanInvariantError,
} from '../../domain/preview';
import {
  PreviewBuildCancelledError,
  PreviewBuildStalledError,
} from '../../domain/previewBuildExecution';
import { canonicalizeExistingPath } from '../../shared/pathIdentity';
import {
  isPreviewCompleteRouteInventoryExecutionTelemetryCheckpoint,
  type PreviewCompleteRouteInventoryExecutionProgress,
  type PreviewCompleteRouteInventoryTelemetryEmitter,
  type PreviewCompleteRouteInventoryTelemetryPhase,
  type PreviewCompleteRouteInventoryTelemetryTransition,
} from './inspector/previewInspectorCompleteRouteInventory';
import {
  createEligiblePreviewInspectorPageExecutionCandidates,
  createPreviewInspectorExecutablePlan,
  createPreviewInspectorExecutionRootModuleContract,
  createPreviewInspectorTargetModuleContract,
  resolvePreviewInspectorRuntimeOwnershipTarget,
  resolvePreviewInspectorRuntimeTargetMode,
} from './inspector';
import type { PreviewInspectorAncestorPlan } from './inspector/previewInspectorAncestorTypes';
import type { PreviewInspectorExecutionRootModuleContract } from './inspector/previewInspectorExecutionRootModuleContract';
import {
  createPreviewInspectorBundleDiagnosticsCollector,
  type PreviewInspectorBundleDiagnostics,
  type PreviewInspectorBundleDiagnosticsClock,
} from './inspector/previewInspectorBundleDiagnostics';
import type { PreviewInspectorBundleSourceInventoryMemo } from './inspector/previewInspectorBundleFrontier';
import type { PreviewInspectorPageExecutionCandidate } from './inspector/previewInspectorPageExecutionTypes';
import type { PreviewInspectorTargetModuleContract } from './inspector/previewInspectorTargetModuleContract';
import {
  preparePreviewInspectorBundleExecution,
  type PreparedPreviewInspectorBundleExecution,
} from './preparePreviewInspectorBundleExecution';
import type { PreviewCompilerTargetSelection } from './previewImperativeEntryTarget';
import type { PreviewPreparationPolicy } from './previewPreparationPolicy';
import {
  assertPreviewRouteExecutionPlanArtifact,
  createPreviewRouteExecutionPlanArtifact,
  createPreviewRouteExecutionPlanningContext,
  createPreviewRouteExecutionPlanStructuralInvariantError,
} from './previewRouteExecutionPlan';
import type { PreviewTargetUsageProps } from './previewTargetUsageProps';

export interface PreparePreviewRouteExecutionPlannerOptions {
  /** Test-only clock seam; it is never read unless unchanged telemetry sampling enables diagnostics. */
  readonly bundleDiagnosticsClock?: PreviewInspectorBundleDiagnosticsClock;
  readonly contextDiscoveryTruncated: boolean;
  readonly policy: PreviewPreparationPolicy;
  readonly projectRoot: string;
  readonly readSource: (sourcePath: string) => Promise<string | undefined>;
  readonly request: PreviewBuildRequest;
  readonly resolveModule: (specifier: string, importer: string) => string | undefined;
  /** Required only while inventory is creating an artifact before a request can carry it. */
  readonly routeId?: string;
  readonly runtimeCompanionSourcePaths: readonly string[];
  readonly sourceInventoryMemo?: PreviewInspectorBundleSourceInventoryMemo;
  readonly styleSnapshotCount: number;
  readonly targetSelection: PreviewCompilerTargetSelection;
  readonly targetUsageProps: PreviewTargetUsageProps;
  readonly telemetry?: PreviewRouteExecutionTelemetryContext;
  readonly workspaceRoot: string;
}

/** Source-general execution counters shared by the eleven real planner boundaries. */
export interface PreviewRouteExecutionTelemetryContext {
  readonly emitter: PreviewCompleteRouteInventoryTelemetryEmitter;
  readonly progress: PreviewCompleteRouteInventoryExecutionProgress;
}

type PreviewRouteExecutionTelemetryPhase = Extract<
  PreviewCompleteRouteInventoryTelemetryPhase,
  | 'execution-frontier-globals'
  | 'execution-frontier-plan'
  | 'execution-frontier-style'
  | 'execution-frontier-artifact'
  | 'execution-frontier-bundle'
  | 'execution-frontier-candidates'
  | 'execution-frontier-ownership'
  | 'execution-frontier-root-contract'
  | 'execution-frontier-target-contract'
  | 'execution-route-usage'
  | 'execution-shared-context'
>;

type PreviewRouteExecutionTelemetryEventArguments =
  | readonly [
      phase: Exclude<PreviewRouteExecutionTelemetryPhase, 'execution-frontier-bundle'>,
      transition: Exclude<PreviewCompleteRouteInventoryTelemetryTransition, 'checkpoint'>,
    ]
  | readonly [phase: 'execution-frontier-bundle', transition: 'start'];

/** Emits only sampled route ordinals and advances completion at the final-plan boundary. */
export function emitPreviewRouteExecutionTelemetry(
  context: PreviewRouteExecutionTelemetryContext | undefined,
  ...eventArguments: PreviewRouteExecutionTelemetryEventArguments
): void {
  const [phase, transition] = eventArguments;
  if (
    context === undefined ||
    !isPreviewCompleteRouteInventoryExecutionTelemetryCheckpoint(
      context.progress.routeOrdinal,
      context.progress.total,
    )
  ) {
    return;
  }
  const counters = createExecutionTelemetryCounters(context, phase, transition);
  if (phase === 'execution-frontier-bundle') {
    context.emitter.emit({ ...counters, phase, transition });
    return;
  }
  context.emitter.emit({ ...counters, phase, transition });
}

/** Emits the sole payload-bearing event after successful sampled bundle preparation. */
export function emitPreviewRouteExecutionBundleCompleteTelemetry(
  context: PreviewRouteExecutionTelemetryContext,
  bundleDiagnostics: PreviewInspectorBundleDiagnostics,
): void {
  if (
    !isPreviewCompleteRouteInventoryExecutionTelemetryCheckpoint(
      context.progress.routeOrdinal,
      context.progress.total,
    )
  ) {
    return;
  }
  context.emitter.emit({
    ...createExecutionTelemetryCounters(context, 'execution-frontier-bundle', 'complete'),
    bundleDiagnostics,
    phase: 'execution-frontier-bundle',
    transition: 'complete',
  });
}

/** Preserves the existing scalar progress projection for every execution boundary. */
function createExecutionTelemetryCounters(
  context: PreviewRouteExecutionTelemetryContext,
  phase: PreviewRouteExecutionTelemetryPhase,
  transition: Exclude<PreviewCompleteRouteInventoryTelemetryTransition, 'checkpoint'>,
): {
  readonly executionPlanCompleted: number;
  readonly executionPlanTotal: number;
  readonly routeOrdinal: number;
} {
  return {
    executionPlanCompleted:
      phase === 'execution-frontier-plan' && transition === 'complete'
        ? context.progress.routeOrdinal
        : context.progress.routeOrdinal - 1,
    executionPlanTotal: context.progress.total,
    routeOrdinal: context.progress.routeOrdinal,
  };
}

export interface PreparedPreviewRouteExecutionPlanner {
  readonly activeInspectorPlan?: PreviewInspectorAncestorPlan;
  readonly artifact?: PreviewRouteExecutionPlanArtifact;
  readonly executionRootModuleContract?: PreviewInspectorExecutionRootModuleContract;
  readonly pageExecutionCandidates: readonly PreviewInspectorPageExecutionCandidate[];
  readonly preparedBundleExecution?: PreparedPreviewInspectorBundleExecution;
  readonly runtimeOwnershipTarget?: {
    readonly exportName: string;
    readonly sourcePath: string;
  };
  readonly selectedCandidate?: PreviewInspectorPageExecutionCandidate;
  readonly targetModuleContract?: PreviewInspectorTargetModuleContract;
}

/**
 * Recreates one route through the actual selected-corridor plan and frontier before esbuild.
 *
 * The returned candidate is the only candidate compilation may subsequently admit. Inventory uses
 * the same function analysis-only; this module never creates a build, evaluates application code,
 * starts a server/browser, or mutates source.
 */
export async function preparePreviewRouteExecutionPlanner(
  options: PreparePreviewRouteExecutionPlannerOptions,
): Promise<PreparedPreviewRouteExecutionPlanner> {
  emitPreviewRouteExecutionTelemetry(options.telemetry, 'execution-frontier-plan', 'start');
  const request = options.request;
  const analysisPlan = options.targetUsageProps.inspectorPlan;
  const expectedArtifact = request.routeExecutionPlan;
  let activeInspectorPlan: PreviewInspectorAncestorPlan | undefined;
  let candidates: readonly PreviewInspectorPageExecutionCandidate[] = [];
  const structuralInvariant = (
    mismatchField: string,
    reason: string,
    observedCandidateId?: string,
  ): PreviewRouteExecutionPlanInvariantError | undefined =>
    expectedArtifact === undefined
      ? undefined
      : createPreviewRouteExecutionPlanStructuralInvariantError({
          expectedArtifact,
          mismatchField,
          ...(observedCandidateId === undefined ? {} : { observedCandidateId }),
          observedResolution: activeInspectorPlan?.routeSelectionResolution ?? 'missing',
          reason,
        });
  const requiredStructuralInvariant = (
    artifact: PreviewRouteExecutionPlanArtifact,
    mismatchField: string,
    reason: string,
    observedCandidateId?: string,
  ): PreviewRouteExecutionPlanInvariantError =>
    createPreviewRouteExecutionPlanStructuralInvariantError({
      expectedArtifact: artifact,
      mismatchField,
      ...(observedCandidateId === undefined ? {} : { observedCandidateId }),
      observedResolution: activeInspectorPlan?.routeSelectionResolution ?? 'missing',
      reason,
    });
  emitPreviewRouteExecutionTelemetry(options.telemetry, 'execution-frontier-candidates', 'start');
  try {
    activeInspectorPlan =
      analysisPlan === undefined
        ? undefined
        : createPreviewInspectorExecutablePlan(analysisPlan, request.inspectorPageCandidateId);
    candidates =
      activeInspectorPlan === undefined
        ? []
        : createEligiblePreviewInspectorPageExecutionCandidates(
            analysisPlan ?? activeInspectorPlan,
            request.inspectorPageCandidateId,
            request.inspectorPageExecutionCandidateId,
            request.inspectorTargetMode,
          );
  } catch (error) {
    const invariant = structuralInvariant(
      'executionCandidateId',
      'the real fast compiler planner could not recreate the frozen route candidate',
    );
    if (invariant !== undefined && !preservesPlanExecutionFailure(error)) throw invariant;
    throw error;
  }
  if (expectedArtifact !== undefined && activeInspectorPlan === undefined) {
    throw requiredStructuralInvariant(
      expectedArtifact,
      'activeInspectorPlan',
      'the real fast compiler planner did not recreate an executable route plan',
    );
  }
  if (expectedArtifact !== undefined && activeInspectorPlan?.routeSelectionResolution !== 'exact') {
    throw requiredStructuralInvariant(
      expectedArtifact,
      'routeSelectionResolution',
      'the real fast compiler planner did not recreate the frozen exact route selection',
    );
  }
  if (
    expectedArtifact !== undefined &&
    request.inspectorPageExecutionCandidateId !== undefined &&
    !candidates.some((candidate) => candidate.id === request.inspectorPageExecutionCandidateId)
  ) {
    throw requiredStructuralInvariant(
      expectedArtifact,
      'executionCandidateId',
      'the requested Page Execution candidate is absent from the final frontier',
    );
  }
  if (
    expectedArtifact !== undefined &&
    request.inspectorPageCandidateId !== undefined &&
    !candidates.some(
      (candidate) => candidate.browserCandidate.id === request.inspectorPageCandidateId,
    )
  ) {
    throw requiredStructuralInvariant(
      expectedArtifact,
      'pageCandidateId',
      'the requested browser page candidate is absent from the final frontier',
    );
  }
  if (expectedArtifact !== undefined && candidates.length === 0) {
    throw requiredStructuralInvariant(
      expectedArtifact,
      'executionCandidateId',
      'the final Page Execution frontier did not contain the frozen route candidate',
    );
  }
  emitPreviewRouteExecutionTelemetry(
    options.telemetry,
    'execution-frontier-candidates',
    'complete',
  );
  emitPreviewRouteExecutionTelemetry(options.telemetry, 'execution-frontier-bundle', 'start');
  const bundleDiagnosticsEnabled =
    options.telemetry !== undefined &&
    isPreviewCompleteRouteInventoryExecutionTelemetryCheckpoint(
      options.telemetry.progress.routeOrdinal,
      options.telemetry.progress.total,
    );
  const bundleDiagnostics = createPreviewInspectorBundleDiagnosticsCollector(
    bundleDiagnosticsEnabled,
    options.bundleDiagnosticsClock,
  );
  let preparedBundleExecution: PreparedPreviewInspectorBundleExecution | undefined;
  try {
    preparedBundleExecution = await preparePreviewInspectorBundleExecution({
      analysisCandidateCount: analysisPlan?.pageCandidates.length ?? 0,
      runtimeCompanionSourcePaths: options.runtimeCompanionSourcePaths,
      corridorSourceCount: activeInspectorPlan?.dependencyPaths.length ?? 0,
      dependencySnapshotCount: request.dependencySnapshots.length,
      discoveryTruncated: options.contextDiscoveryTruncated,
      executablePlan: activeInspectorPlan,
      ...(activeInspectorPlan === undefined ? {} : { executionCandidates: candidates }),
      policy: options.policy,
      readSource: options.readSource,
      resolveModule: options.resolveModule,
      ...(options.sourceInventoryMemo === undefined
        ? {}
        : { sourceInventoryMemo: options.sourceInventoryMemo }),
      styleSnapshotCount: options.styleSnapshotCount,
      ...(bundleDiagnostics === undefined ? {} : { bundleDiagnostics }),
      workspaceRoot: options.workspaceRoot,
    });
    preparedBundleExecution?.throwIfRejected(request.documentPath);
  } catch (error) {
    const invariant = structuralInvariant(
      'frontierIdentity',
      'the final pre-esbuild frontier rejected the frozen route candidate',
      candidates[0]?.id,
    );
    if (invariant !== undefined && !preservesPlanExecutionFailure(error)) throw invariant;
    throw error;
  }
  const selectedCandidate = preparedBundleExecution?.executionCandidate ?? candidates[0];
  if (expectedArtifact !== undefined && preparedBundleExecution?.executionCandidate === undefined) {
    throw requiredStructuralInvariant(
      expectedArtifact,
      'executionCandidateId',
      'the final pre-esbuild frontier did not select one exact route candidate',
      selectedCandidate?.id,
    );
  }
  if (options.telemetry !== undefined && bundleDiagnostics !== undefined) {
    emitPreviewRouteExecutionBundleCompleteTelemetry(options.telemetry, bundleDiagnostics.snapshot());
  }
  emitPreviewRouteExecutionTelemetry(options.telemetry, 'execution-frontier-ownership', 'start');
  const analysisTarget = activeInspectorPlan?.target ?? analysisPlan?.target;
  const runtimeTargetMode = resolvePreviewInspectorRuntimeTargetMode(
    activeInspectorPlan,
    request.inspectorTargetMode,
  );
  let runtimeOwnershipTarget = analysisTarget;
  if (runtimeTargetMode !== undefined) {
    if (request.renderMode !== 'page-inspector' || analysisTarget === undefined) {
      const invariant = structuralInvariant(
        'runtimeTarget',
        'the final pre-esbuild planner did not reproduce an exact Page Inspector analysis target',
        selectedCandidate?.id,
      );
      if (invariant !== undefined) throw invariant;
      throw new PreviewCompilationError(
        'React Preview could not validate the selected route leaf for runtime ownership.',
        [
          {
            location: { column: 0, file: request.documentPath, line: 1 },
            message: 'Selected-route ownership requires an exact Page Inspector analysis target.',
            severity: 'error',
          },
        ],
      );
    }
    const selectedLeafPath = selectedCandidate?.browserCandidate.target?.sourcePath;
    const selectedLeafSourceText =
      selectedLeafPath === undefined ? undefined : await options.readSource(selectedLeafPath);
    try {
      runtimeOwnershipTarget = resolvePreviewInspectorRuntimeOwnershipTarget({
        analysisTarget,
        ...(selectedCandidate === undefined ? {} : { candidate: selectedCandidate }),
        diagnosticPath: request.documentPath,
        ...(request.inspectorRouteSelection === undefined
          ? {}
          : { routeSelection: request.inspectorRouteSelection }),
        ...(activeInspectorPlan?.routeSelectionResolution === undefined
          ? {}
          : { routeSelectionResolution: activeInspectorPlan.routeSelectionResolution }),
        ...(selectedLeafSourceText === undefined ? {} : { selectedLeafSourceText }),
        targetMode: runtimeTargetMode,
      });
    } catch (error) {
      const invariant = structuralInvariant(
        'runtimeTarget',
        'the final pre-esbuild planner could not validate frozen runtime ownership',
        selectedCandidate?.id,
      );
      if (invariant !== undefined && !preservesPlanExecutionFailure(error)) throw invariant;
      throw error;
    }
  }
  const runtimeTargetReference = runtimeOwnershipTarget ?? analysisTarget;
  if (expectedArtifact !== undefined && runtimeTargetReference === undefined) {
    throw requiredStructuralInvariant(
      expectedArtifact,
      'runtimeTarget',
      'the final pre-esbuild planner did not reproduce the frozen runtime target',
      selectedCandidate?.id,
    );
  }
  emitPreviewRouteExecutionTelemetry(options.telemetry, 'execution-frontier-ownership', 'complete');
  emitPreviewRouteExecutionTelemetry(
    options.telemetry,
    'execution-frontier-target-contract',
    'start',
  );
  const selectedTargetExportNames =
    runtimeTargetReference === undefined
      ? []
      : runtimeTargetMode === 'selected-route-leaf'
        ? [runtimeTargetReference.exportName]
        : Object.keys((analysisPlan ?? activeInspectorPlan)?.renderChainsByExport ?? {});
  const targetModuleSourceText =
    runtimeTargetReference === undefined
      ? undefined
      : await options.readSource(runtimeTargetReference.sourcePath);
  if (
    runtimeTargetReference !== undefined &&
    request.renderMode === 'page-inspector' &&
    targetModuleSourceText === undefined
  ) {
    const invariant = structuralInvariant(
      'targetRoleContract',
      'the final pre-esbuild planner could not read the frozen runtime target',
      selectedCandidate?.id,
    );
    if (invariant !== undefined) throw invariant;
    throw new PreviewCompilationError(
      'React Preview could not read the exact runtime ownership target.',
      [
        {
          location: { column: 0, file: runtimeTargetReference.sourcePath, line: 1 },
          message: 'The prepared target module source is unavailable.',
          severity: 'error',
        },
      ],
    );
  }
  let targetModuleContract: PreviewInspectorTargetModuleContract | undefined;
  try {
    targetModuleContract =
      runtimeTargetReference === undefined ||
      request.renderMode !== 'page-inspector' ||
      targetModuleSourceText === undefined
        ? undefined
        : createPreviewInspectorTargetModuleContract({
            preparedSourceText: options.targetSelection.prepareSource(
              canonicalizeExistingPath(runtimeTargetReference.sourcePath),
              targetModuleSourceText,
            ),
            selectedExportNames: selectedTargetExportNames,
            sourcePath: runtimeTargetReference.sourcePath,
          });
  } catch (error) {
    const invariant = structuralInvariant(
      'targetRoleContract',
      'the final pre-esbuild planner could not reproduce the frozen target contract',
      selectedCandidate?.id,
    );
    if (invariant !== undefined && !preservesPlanExecutionFailure(error)) throw invariant;
    throw error;
  }
  emitPreviewRouteExecutionTelemetry(
    options.telemetry,
    'execution-frontier-target-contract',
    'complete',
  );
  emitPreviewRouteExecutionTelemetry(
    options.telemetry,
    'execution-frontier-root-contract',
    'start',
  );
  const executionRootRole = selectedCandidate?.executionRootContract;
  if (expectedArtifact !== undefined && executionRootRole === undefined) {
    throw requiredStructuralInvariant(
      expectedArtifact,
      'executionRoot',
      'the final pre-esbuild planner did not reproduce the frozen execution root',
      selectedCandidate?.id,
    );
  }
  const executionRootSourceText =
    executionRootRole === undefined
      ? undefined
      : await options.readSource(executionRootRole.sourcePath);
  if (executionRootRole !== undefined && executionRootSourceText === undefined) {
    const invariant = structuralInvariant(
      'rootRoleContract',
      'the final pre-esbuild planner could not read the frozen execution root',
      selectedCandidate?.id,
    );
    if (invariant !== undefined) throw invariant;
    throw new PreviewCompilationError(
      'React Preview could not read the exact PageExecution root.',
      [
        {
          location: { column: 0, file: executionRootRole.sourcePath, line: 1 },
          message: 'The prepared execution-root module source is unavailable.',
          severity: 'error',
        },
      ],
    );
  }
  let executionRootModuleContract: PreviewInspectorExecutionRootModuleContract | undefined;
  try {
    executionRootModuleContract =
      executionRootRole === undefined || executionRootSourceText === undefined
        ? undefined
        : createPreviewInspectorExecutionRootModuleContract({
            exportName: executionRootRole.exportName,
            preparedSourceText: options.targetSelection.prepareSource(
              canonicalizeExistingPath(executionRootRole.sourcePath),
              executionRootSourceText,
            ),
            sourcePath: executionRootRole.sourcePath,
            surfaceId: executionRootRole.surfaceId,
          });
  } catch (error) {
    const invariant = structuralInvariant(
      'rootRoleContract',
      'the final pre-esbuild planner could not reproduce the frozen root contract',
      selectedCandidate?.id,
    );
    if (invariant !== undefined && !preservesPlanExecutionFailure(error)) throw invariant;
    throw error;
  }
  emitPreviewRouteExecutionTelemetry(
    options.telemetry,
    'execution-frontier-root-contract',
    'complete',
  );
  emitPreviewRouteExecutionTelemetry(options.telemetry, 'execution-frontier-artifact', 'start');
  const routeId = options.routeId ?? request.routeExecutionPlan?.routeId;
  let artifact: PreviewRouteExecutionPlanArtifact | undefined;
  if (
    routeId !== undefined &&
    activeInspectorPlan !== undefined &&
    selectedCandidate !== undefined &&
    targetModuleContract !== undefined &&
    executionRootModuleContract !== undefined &&
    preparedBundleExecution !== undefined
  ) {
    artifact = createPreviewRouteExecutionPlanArtifact({
      candidate: selectedCandidate,
      executionRootModuleContract,
      frontierIdentity: preparedBundleExecution.prepared.frontier.identity,
      plan: activeInspectorPlan,
      planningContext: createPreviewRouteExecutionPlanningContext({
        preparationPolicy: options.policy,
        projectRoot: options.projectRoot,
        request,
      }),
      routeId,
      targetModuleContract,
    });
  }
  if (request.routeExecutionPlan !== undefined) {
    if (artifact === undefined) {
      throw createPreviewRouteExecutionPlanStructuralInvariantError({
        expectedArtifact: request.routeExecutionPlan,
        mismatchField: 'artifact',
        ...(selectedCandidate === undefined ? {} : { observedCandidateId: selectedCandidate.id }),
        observedResolution: activeInspectorPlan?.routeSelectionResolution ?? 'missing',
        reason: 'the final pre-esbuild planner did not produce a complete route artifact',
      });
    }
    assertPreviewRouteExecutionPlanArtifact(
      request.routeExecutionPlan,
      artifact,
      activeInspectorPlan?.routeSelectionResolution,
    );
  }
  const result = Object.freeze({
    ...(activeInspectorPlan === undefined ? {} : { activeInspectorPlan }),
    ...(artifact === undefined ? {} : { artifact }),
    ...(executionRootModuleContract === undefined ? {} : { executionRootModuleContract }),
    pageExecutionCandidates: Object.freeze(
      selectedCandidate === undefined ? [] : [selectedCandidate],
    ),
    ...(preparedBundleExecution === undefined ? {} : { preparedBundleExecution }),
    ...(runtimeOwnershipTarget === undefined ? {} : { runtimeOwnershipTarget }),
    ...(selectedCandidate === undefined ? {} : { selectedCandidate }),
    ...(targetModuleContract === undefined ? {} : { targetModuleContract }),
  });
  emitPreviewRouteExecutionTelemetry(options.telemetry, 'execution-frontier-artifact', 'complete');
  emitPreviewRouteExecutionTelemetry(options.telemetry, 'execution-frontier-plan', 'complete');
  return result;
}

/** Preserves genuine cancellation/resource failures and already-typed invariant evidence. */
function preservesPlanExecutionFailure(error: unknown): boolean {
  return (
    error instanceof PreviewBuildCancelledError ||
    error instanceof PreviewRouteExecutionPlanInvariantError ||
    (error instanceof PreviewBuildStalledError &&
      error.reason !== 'candidate-unavailable' &&
      error.reason !== 'frontier-mismatch')
  );
}
