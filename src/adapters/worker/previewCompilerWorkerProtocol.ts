/**
 * Defines the structured-clone protocol between the VS Code extension host and compiler worker.
 * Only domain requests, bundles, progress stages, and serializable errors cross this boundary;
 * VS Code objects, esbuild contexts, callbacks, and AbortSignals remain in their owning thread.
 */
import {
  PreviewCompilationError,
  PreviewRouteExecutionPlanInvariantError,
  type PreviewBuildRequest,
  type PreviewBundle,
  type PreviewDiagnostic,
  type PreviewRouteExecutionPlanInvariantEvidence,
} from '../../domain/preview';
import {
  isPreviewBuildCancellation,
  isPreviewFrontierMismatchEvidence,
  isPreviewBuildStall,
  PreviewBuildCancelledError,
  PreviewBuildStalledError,
  type PreviewBuildStallReason,
  type PreviewFrontierMismatchEvidence,
} from '../../domain/previewBuildExecution';
import type { PreviewProgressStage } from '../../domain/previewProgress';
import type { PreviewCompilerActivity } from '../../domain/previewCompilerActivity';
import type {
  PreviewCompleteRouteInventoryTelemetryEvent,
  PreviewInspectorCompleteRouteInventory,
  PreviewInspectorCompleteRouteInventoryLimits,
} from '../esbuild/inspector/previewInspectorCompleteRouteInventory';
import { PREVIEW_INSPECTOR_BUNDLE_DIAGNOSTIC_FIELD_NAMES } from '../esbuild/inspector/previewInspectorBundleDiagnostics';
import type { PreviewInspectorBundleDiagnostics } from '../esbuild/inspector/previewInspectorBundleDiagnostics';
import {
  PREVIEW_COMPLETE_ROUTE_INVENTORY_TELEMETRY_MAXIMUM_EVENTS,
  PREVIEW_COMPLETE_ROUTE_INVENTORY_TELEMETRY_POLICY_VERSION,
} from '../esbuild/inspector/previewInspectorCompleteRouteInventory';

/** Starts one immutable compilation in the background worker. */
export interface PreviewCompilerWorkerCompileRequest {
  /** Monotonic client-owned identity used for progress, cancellation, and settlement. */
  readonly id: number;
  /** Serializable source snapshot and build policy consumed by the compiler adapter. */
  readonly request: PreviewBuildRequest;
  /** Protocol discriminator. */
  readonly type: 'compile';
}

/** Cancels an active or queued compilation without stopping the shared worker. */
export interface PreviewCompilerWorkerCancelRequest {
  /** Compile request identity that no longer owns a live panel revision. */
  readonly id: number;
  /** Protocol discriminator. */
  readonly type: 'cancel';
}

/** Requests ordered compiler disposal and worker shutdown. */
export interface PreviewCompilerWorkerShutdownRequest {
  /** Protocol discriminator. */
  readonly type: 'shutdown';
}

/** Runs one complete inert route inventory before the dedicated worker releases its compiler. */
export interface PreviewCompilerWorkerInventoryRequest {
  readonly limits?: Partial<PreviewInspectorCompleteRouteInventoryLimits>;
  readonly request: PreviewBuildRequest;
  readonly type: 'collect-complete-route-inventory';
}

/** Every message accepted by the compiler worker. */
export type PreviewCompilerWorkerRequest =
  | PreviewCompilerWorkerCancelRequest
  | PreviewCompilerWorkerCompileRequest
  | PreviewCompilerWorkerInventoryRequest
  | PreviewCompilerWorkerShutdownRequest;

/** Reports one monotonic compiler milestone without moving callbacks across threads. */
export interface PreviewCompilerWorkerProgressResponse {
  /** Optional bounded compiler activity; it does not advance the watchdog by itself. */
  readonly activity?: PreviewCompilerActivity;
  /** Owning compile request identity. */
  readonly id: number;
  /** Domain progress stage rendered by the pinned panel. */
  readonly stage: PreviewProgressStage;
  /** Protocol discriminator. */
  readonly type: 'progress';
}

/** Confirms that a queued request now owns the serialized compiler and its watchdog may start. */
export interface PreviewCompilerWorkerStartedResponse {
  /** Owning compile request identity. */
  readonly id: number;
  /** Protocol discriminator. */
  readonly type: 'started';
}

/** Returns one completed in-memory bundle to the extension host. */
export interface PreviewCompilerWorkerSuccessResponse {
  /** Browser bundle whose byte buffers are transferred rather than copied. */
  readonly bundle: PreviewBundle;
  /** Owning compile request identity. */
  readonly id: number;
  /** Protocol discriminator. */
  readonly type: 'success';
}

/** Serializable error representation that preserves domain cancellation and diagnostics. */
export interface PreviewCompilerWorkerSerializedError {
  /** Structured build diagnostics retained for PreviewCompilationError reconstruction. */
  readonly diagnostics: readonly PreviewDiagnostic[];
  /** Error category required by main-thread orchestration. */
  readonly kind: 'cancelled' | 'compilation' | 'stalled' | 'unexpected';
  /** Last worker milestone retained when a host watchdog produced the failure. */
  readonly lastStage?: PreviewProgressStage;
  /** Last bounded compiler activity observed before a watchdog/resource failure. */
  readonly activity?: PreviewCompilerActivity;
  /** Human-readable error message. */
  readonly message: string;
  /** Original error name used only for diagnostics. */
  readonly name: string;
  /** Absolute target used to prevent a resource failure from being retried as a source error. */
  readonly target?: string;
  /** Bounded watchdog duration when known by the worker-side failure. */
  readonly elapsedMs?: number;
  /** Optional background stack included in the reconstructed cause. */
  readonly stack?: string;
  /** Resource boundary used to explain why the graph is not immediately retried. */
  readonly stallReason?: PreviewBuildStallReason;
  /** Valid bounded frontier evidence retained only for frontier stalls. */
  readonly frontierMismatchEvidence?: PreviewFrontierMismatchEvidence;
  /** Bounded campaign route-plan evidence retained only for an invariant failure. */
  readonly routeExecutionPlanInvariantEvidence?: PreviewRouteExecutionPlanInvariantEvidence;
}

/** Rejects one compile request with a domain-preserving serialized failure. */
export interface PreviewCompilerWorkerFailureResponse {
  /** Serialized background failure. */
  readonly error: PreviewCompilerWorkerSerializedError;
  /** Owning compile request identity. */
  readonly id: number;
  /** Protocol discriminator. */
  readonly type: 'failure';
}

/** Confirms that native esbuild state has been stopped before thread termination. */
export interface PreviewCompilerWorkerShutdownResponse {
  /** Protocol discriminator. */
  readonly type: 'shutdown-complete';
}

/** Route-worker messages returned to the restartable compiler client. */
export type PreviewCompilerRouteWorkerResponse =
  | PreviewCompilerWorkerFailureResponse
  | PreviewCompilerWorkerProgressResponse
  | PreviewCompilerWorkerShutdownResponse
  | PreviewCompilerWorkerStartedResponse
  | PreviewCompilerWorkerSuccessResponse;

export type PreviewCompleteRouteInventoryWorkerFailureCode =
  'preview-inventory-cancelled' | 'preview-inventory-failed';

/** Returns one complete structured-cloneable inventory after compiler shutdown. */
export interface PreviewCompilerWorkerInventorySuccessResponse {
  readonly inventory: PreviewInspectorCompleteRouteInventory;
  readonly type: 'complete-route-inventory-success';
}

/** Returns a stable one-shot inventory failure after compiler shutdown. */
export interface PreviewCompilerWorkerInventoryFailureResponse {
  readonly error: {
    readonly code: PreviewCompleteRouteInventoryWorkerFailureCode;
    readonly message: string;
  };
  readonly type: 'complete-route-inventory-failure';
}

/** Observational progress that never settles or extends the one-shot inventory watchdog. */
export interface PreviewCompilerWorkerInventoryProgressResponse {
  readonly event: PreviewCompleteRouteInventoryTelemetryEvent;
  readonly type: 'complete-route-inventory-progress';
}

export type PreviewCompleteRouteInventoryWorkerResponse =
  | PreviewCompilerWorkerInventoryFailureResponse
  | PreviewCompilerWorkerInventoryProgressResponse
  | PreviewCompilerWorkerInventorySuccessResponse;

/** Every message returned by either compiler worker mode. */
export type PreviewCompilerWorkerResponse =
  PreviewCompilerRouteWorkerResponse | PreviewCompleteRouteInventoryWorkerResponse;

/**
 * Converts an unknown worker-side failure into a structured-clone-safe representation.
 *
 * @param error Failure raised by compilation or worker orchestration.
 * @param signal Active request signal used to recognize opaque adapter cancellation failures.
 * @returns Serializable error retaining domain diagnostics when available.
 */
export function serializePreviewCompilerWorkerError(
  error: unknown,
  signal?: AbortSignal,
  target?: string,
): PreviewCompilerWorkerSerializedError {
  if (isPreviewBuildCancellation(error, signal)) {
    return {
      diagnostics: [],
      kind: 'cancelled',
      message:
        error instanceof Error ? error.message : 'The background preview build was cancelled.',
      name: error instanceof Error ? error.name : 'PreviewBuildCancelledError',
      ...(error instanceof Error && error.stack !== undefined ? { stack: error.stack } : {}),
    };
  }
  if (isPreviewBuildStall(error) || isNativeCompilerResourceFailure(error)) {
    return {
      diagnostics: [],
      elapsedMs: isPreviewBuildStall(error) ? error.elapsedMs : 0,
      kind: 'stalled',
      ...(isPreviewBuildStall(error) && error.lastStage !== undefined
        ? { lastStage: error.lastStage }
        : {}),
      ...(isPreviewBuildStall(error) && error.activity !== undefined
        ? { activity: error.activity }
        : {}),
      ...(isPreviewBuildStall(error) &&
      error.reason === 'frontier-mismatch' &&
      isPreviewFrontierMismatchEvidence(error.frontierMismatchEvidence)
        ? { frontierMismatchEvidence: error.frontierMismatchEvidence }
        : {}),
      message: error instanceof Error ? error.message : String(error),
      name: error instanceof Error ? error.name : 'PreviewBuildStalledError',
      stallReason: isPreviewBuildStall(error) ? error.reason : 'native-service',
      target: isPreviewBuildStall(error) ? error.target : (target ?? 'background esbuild service'),
      ...(error instanceof Error && error.stack !== undefined ? { stack: error.stack } : {}),
    };
  }
  if (error instanceof PreviewCompilationError) {
    return {
      diagnostics: error.diagnostics,
      kind: 'compilation',
      message: error.message,
      name: error.name,
      ...(error instanceof PreviewRouteExecutionPlanInvariantError
        ? { routeExecutionPlanInvariantEvidence: error.evidence }
        : {}),
      ...(error.stack === undefined ? {} : { stack: error.stack }),
    };
  }
  return {
    diagnostics: [],
    kind: 'unexpected',
    message: error instanceof Error ? error.message : String(error),
    name: error instanceof Error ? error.name : 'Error',
    ...(error instanceof Error && error.stack !== undefined ? { stack: error.stack } : {}),
  };
}

/**
 * Reconstructs a worker failure as the same domain error expected by panel orchestration.
 *
 * @param serialized Structured-clone-safe worker error.
 * @returns Cancellation or compilation error with a background-stack cause.
 */
export function deserializePreviewCompilerWorkerError(
  serialized: PreviewCompilerWorkerSerializedError,
): Error {
  if (serialized.kind === 'cancelled') {
    return new PreviewBuildCancelledError();
  }
  if (serialized.kind === 'stalled') {
    const stalled = new PreviewBuildStalledError(
      serialized.target ?? 'background esbuild service',
      serialized.lastStage,
      serialized.elapsedMs ?? 0,
      serialized.stallReason ?? 'watchdog',
      serialized.activity,
      serialized.stallReason === 'frontier-mismatch' &&
        isPreviewFrontierMismatchEvidence(serialized.frontierMismatchEvidence)
        ? serialized.frontierMismatchEvidence
        : undefined,
    );
    if (serialized.stack !== undefined) stalled.stack = serialized.stack;
    return stalled;
  }
  const cause = new Error(serialized.message);
  cause.name = serialized.name;
  if (serialized.stack !== undefined) {
    cause.stack = serialized.stack;
  }
  const diagnostics =
    serialized.kind === 'compilation'
      ? serialized.diagnostics
      : [
          {
            message: `Background compiler failure: ${serialized.message}`,
            severity: 'error' as const,
          },
        ];
  if (serialized.routeExecutionPlanInvariantEvidence !== undefined) {
    const invariant = new PreviewRouteExecutionPlanInvariantError(
      serialized.routeExecutionPlanInvariantEvidence,
    );
    if (serialized.stack !== undefined) invariant.stack = serialized.stack;
    return invariant;
  }
  return new PreviewCompilationError(serialized.message, diagnostics, cause);
}

/** Recognizes native esbuild service termination that must not trigger a second full graph build. */
function isNativeCompilerResourceFailure(error: unknown): boolean {
  if (!(error instanceof Error)) return false;
  return /(?:the service (?:was stopped|is no longer running)|write EPIPE|broken pipe|(?:fatal error|runtime): out of memory|cannot allocate memory)/iu.test(
    `${error.name}: ${error.message}`,
  );
}

/**
 * Collects unique transferable bundle buffers so large graphs are moved without a second copy.
 *
 * @param bundle Completed worker-owned browser bundle.
 * @returns Unique ArrayBuffers accepted by Node's transfer list.
 */
export function collectPreviewBundleTransferList(bundle: PreviewBundle): readonly ArrayBuffer[] {
  const buffers = new Set<ArrayBuffer>();
  for (const bytes of [
    bundle.javascript,
    ...(bundle.stylesheet === undefined ? [] : [bundle.stylesheet]),
    ...bundle.chunks.map((chunk) => chunk.contents),
  ]) {
    if (bytes.buffer instanceof ArrayBuffer) {
      buffers.add(bytes.buffer);
    }
  }
  return [...buffers];
}

/** Reports whether an untrusted thread message has one recognized response discriminator. */
export function isPreviewCompilerWorkerResponse(
  value: unknown,
): value is PreviewCompilerRouteWorkerResponse {
  if (typeof value !== 'object' || value === null || !('type' in value)) {
    return false;
  }
  const type = value.type;
  if (type === 'shutdown-complete') {
    return true;
  }
  return (
    (type === 'started' || type === 'progress' || type === 'success' || type === 'failure') &&
    'id' in value &&
    typeof value.id === 'number' &&
    Number.isSafeInteger(value.id)
  );
}

/** Validates an untrusted inventory worker response before trusting its payload. */
export function isPreviewCompleteRouteInventoryWorkerResponse(
  value: unknown,
  previousEvent?: PreviewCompleteRouteInventoryTelemetryEvent,
): value is PreviewCompleteRouteInventoryWorkerResponse {
  if (typeof value !== 'object' || value === null || !('type' in value)) return false;
  if (value.type === 'complete-route-inventory-progress') {
    return (
      Object.keys(value).length === 2 &&
      'event' in value &&
      isPreviewCompleteRouteInventoryTelemetryEvent(value.event, previousEvent)
    );
  }
  if (value.type === 'complete-route-inventory-success') {
    return 'inventory' in value && isCompleteRouteInventory(value.inventory);
  }
  if (value.type !== 'complete-route-inventory-failure' || !('error' in value)) return false;
  const error = value.error;
  return (
    typeof error === 'object' &&
    error !== null &&
    'code' in error &&
    (error.code === 'preview-inventory-cancelled' || error.code === 'preview-inventory-failed') &&
    'message' in error &&
    typeof error.message === 'string'
  );
}

/** Validates the exact bounded event shape and monotonic relationship to its predecessor. */
export function isPreviewCompleteRouteInventoryTelemetryEvent(
  value: unknown,
  previousEvent?: PreviewCompleteRouteInventoryTelemetryEvent,
): value is PreviewCompleteRouteInventoryTelemetryEvent {
  if (!isRecord(value)) return false;
  const phase = value.phase;
  const transition = value.transition;
  const baseNames = [
    'cpuSystemMicros',
    'cpuUserMicros',
    'elapsedMs',
    'heapUsedBytes',
    'phase',
    'rssBytes',
    'sequence',
    'transition',
    'version',
  ];
  const counterNames = selectTelemetryCounterNames(phase);
  const bundleDiagnosticsRequired =
    phase === 'execution-frontier-bundle' && transition === 'complete';
  const eventNames = bundleDiagnosticsRequired ? [...baseNames, 'bundleDiagnostics'] : baseNames;
  if (
    counterNames === undefined ||
    !Object.keys(value).every((name) => eventNames.includes(name) || counterNames.includes(name)) ||
    !counterNames.every((name) => name in value) ||
    bundleDiagnosticsRequired !== 'bundleDiagnostics' in value ||
    value.version !== PREVIEW_COMPLETE_ROUTE_INVENTORY_TELEMETRY_POLICY_VERSION ||
    !isPositiveSafeInteger(value.sequence) ||
    value.sequence > PREVIEW_COMPLETE_ROUTE_INVENTORY_TELEMETRY_MAXIMUM_EVENTS ||
    !isNonNegativeSafeInteger(value.elapsedMs) ||
    !isNonNegativeSafeInteger(value.heapUsedBytes) ||
    !isNonNegativeSafeInteger(value.rssBytes) ||
    !isNonNegativeSafeInteger(value.cpuUserMicros) ||
    !isNonNegativeSafeInteger(value.cpuSystemMicros) ||
    !isValidTelemetryTransition(phase, transition)
  ) {
    return false;
  }
  if (bundleDiagnosticsRequired && !isPreviewInspectorBundleDiagnostics(value.bundleDiagnostics)) {
    return false;
  }
  for (const name of counterNames) {
    if (!isNonNegativeSafeInteger(value[name])) return false;
  }
  const event = value as unknown as PreviewCompleteRouteInventoryTelemetryEvent;
  const prefixCounters = selectTelemetryPrefixCounterValues(event);
  if (
    (phase === 'enumerate-branches' || phase === 'replay-branches') &&
    (prefixCounters === undefined ||
      prefixCounters[0] !== prefixCounters[1] + prefixCounters[2] ||
      prefixCounters[3] > prefixCounters[1] ||
      (transition === 'start' && prefixCounters.some((counter) => counter !== 0)))
  ) {
    return false;
  }
  if (phase === 'replay-branches') {
    const replayCompleted = event.replayCompleted;
    const replayTotal = event.replayTotal;
    if (
      replayCompleted === undefined ||
      replayTotal === undefined ||
      replayCompleted > replayTotal ||
      (transition === 'start' && replayCompleted !== 0)
    ) {
      return false;
    }
  }
  if (isExecutionTelemetryPhase(phase)) {
    const routeOrdinal = event.routeOrdinal;
    const executionPlanTotal = event.executionPlanTotal;
    const executionPlanCompleted = event.executionPlanCompleted;
    const expectedCompleted =
      phase === 'execution-frontier-plan' && transition === 'complete'
        ? routeOrdinal
        : (routeOrdinal ?? 0) - 1;
    if (
      routeOrdinal === undefined ||
      executionPlanTotal === undefined ||
      executionPlanCompleted === undefined ||
      routeOrdinal === 0 ||
      routeOrdinal > executionPlanTotal ||
      executionPlanCompleted !== expectedCompleted
    ) {
      return false;
    }
  }
  if (previousEvent === undefined) return event.sequence === 1;
  if (
    event.sequence !== previousEvent.sequence + 1 ||
    event.elapsedMs < previousEvent.elapsedMs ||
    event.cpuUserMicros < previousEvent.cpuUserMicros ||
    event.cpuSystemMicros < previousEvent.cpuSystemMicros
  ) {
    return false;
  }
  if (event.phase === previousEvent.phase && prefixCounters !== undefined) {
    const previousPrefixCounters = selectTelemetryPrefixCounterValues(previousEvent);
    if (
      previousPrefixCounters === undefined ||
      prefixCounters.some((counter, index) => counter < previousPrefixCounters[index]!)
    ) {
      return false;
    }
  }
  for (const name of [
    'analysisPasses',
    'queuedSelections',
    'discoveredBranches',
    'replayCompleted',
    'executionPlanCompleted',
    'routeOrdinal',
  ] as const) {
    const current = event[name];
    const previous = previousEvent[name];
    if (current !== undefined && previous !== undefined && current < previous) {
      return false;
    }
  }
  if (
    event.replayTotal !== undefined &&
    previousEvent.replayTotal !== undefined &&
    event.replayTotal !== previousEvent.replayTotal
  ) {
    return false;
  }
  return !(
    event.executionPlanTotal !== undefined &&
    previousEvent.executionPlanTotal !== undefined &&
    event.executionPlanTotal !== previousEvent.executionPlanTotal
  );
}

/** Rejects every non-canonical nested key, scalar, version, and counter relationship. */
function isPreviewInspectorBundleDiagnostics(value: unknown): boolean {
  if (!isRecord(value)) return false;
  const names = Object.keys(value);
  if (
    names.length !== PREVIEW_INSPECTOR_BUNDLE_DIAGNOSTIC_FIELD_NAMES.length ||
    !names.every((name) =>
      PREVIEW_INSPECTOR_BUNDLE_DIAGNOSTIC_FIELD_NAMES.includes(
        name as (typeof PREVIEW_INSPECTOR_BUNDLE_DIAGNOSTIC_FIELD_NAMES)[number],
      ),
    ) ||
    !PREVIEW_INSPECTOR_BUNDLE_DIAGNOSTIC_FIELD_NAMES.every((name) => name in value)
  ) {
    return false;
  }
  for (const name of PREVIEW_INSPECTOR_BUNDLE_DIAGNOSTIC_FIELD_NAMES) {
    if (!isNonNegativeSafeInteger(value[name])) return false;
  }
  const diagnostics = value as unknown as PreviewInspectorBundleDiagnostics;
  return (
    diagnostics.diagnosticsVersion === 1 &&
    diagnostics.sliceRequestCount ===
      diagnostics.sliceComputationCount + diagnostics.sliceHitCount &&
    diagnostics.inventoryRequestCount ===
      diagnostics.inventoryComputationCount + diagnostics.inventoryHitCount &&
    diagnostics.inventoryReadRequestCount >= diagnostics.inventoryReadPathCacheHitCount &&
    diagnostics.queueSortCount === diagnostics.queueIterationCount &&
    (diagnostics.queueIterationCount === 0
      ? diagnostics.queuePeakLength === 0
      : diagnostics.queuePeakLength > 0)
  );
}

/** Returns the exact counter fields permitted for one source-general telemetry phase. */
function selectTelemetryCounterNames(phase: unknown): readonly string[] | undefined {
  if (phase === 'enumerate-branches') {
    return [
      'analysisPasses',
      'queuedSelections',
      'discoveredBranches',
      'enumerationPrefixRequestCount',
      'enumerationPrefixComputationCount',
      'enumerationPrefixHitCount',
      'enumerationPrefixEntryCount',
    ];
  }
  if (phase === 'replay-branches') {
    return [
      'replayCompleted',
      'replayTotal',
      'replayPrefixRequestCount',
      'replayPrefixComputationCount',
      'replayPrefixHitCount',
      'replayPrefixEntryCount',
    ];
  }
  if (isExecutionTelemetryPhase(phase)) {
    return ['executionPlanCompleted', 'executionPlanTotal', 'routeOrdinal'];
  }
  return [
    'prepare-source-index',
    'prepare-target-usage',
    'finalize-inventory',
    'shutdown',
  ].includes(String(phase))
    ? []
    : undefined;
}

/** Returns request, computation, hit, and entry counters for one applicable prefix phase. */
function selectTelemetryPrefixCounterValues(
  event: PreviewCompleteRouteInventoryTelemetryEvent,
): readonly [number, number, number, number] | undefined {
  const values =
    event.phase === 'enumerate-branches'
      ? [
          event.enumerationPrefixRequestCount,
          event.enumerationPrefixComputationCount,
          event.enumerationPrefixHitCount,
          event.enumerationPrefixEntryCount,
        ]
      : event.phase === 'replay-branches'
        ? [
            event.replayPrefixRequestCount,
            event.replayPrefixComputationCount,
            event.replayPrefixHitCount,
            event.replayPrefixEntryCount,
          ]
        : undefined;
  return values?.every(isNonNegativeSafeInteger) === true
    ? (values as unknown as readonly [number, number, number, number])
    : undefined;
}

/** Limits start/checkpoint/complete to the transitions defined for each phase family. */
function isValidTelemetryTransition(phase: unknown, transition: unknown): boolean {
  if (phase === 'enumerate-branches' || phase === 'replay-branches') {
    return transition === 'start' || transition === 'checkpoint' || transition === 'complete';
  }
  if (phase === 'shutdown') return transition === 'start';
  return (
    selectTelemetryCounterNames(phase) !== undefined &&
    (transition === 'start' || transition === 'complete')
  );
}

/** Recognizes the eleven separately instrumented real execution-planner boundaries. */
function isExecutionTelemetryPhase(
  phase: unknown,
): phase is
  | 'execution-shared-context'
  | 'execution-route-usage'
  | 'execution-frontier-style'
  | 'execution-frontier-globals'
  | 'execution-frontier-plan'
  | 'execution-frontier-candidates'
  | 'execution-frontier-bundle'
  | 'execution-frontier-ownership'
  | 'execution-frontier-target-contract'
  | 'execution-frontier-root-contract'
  | 'execution-frontier-artifact' {
  return [
    'execution-shared-context',
    'execution-route-usage',
    'execution-frontier-style',
    'execution-frontier-globals',
    'execution-frontier-plan',
    'execution-frontier-candidates',
    'execution-frontier-bundle',
    'execution-frontier-ownership',
    'execution-frontier-target-contract',
    'execution-frontier-root-contract',
    'execution-frontier-artifact',
  ].includes(String(phase));
}

/** Validates every request discriminator and its minimum structured-clone contract. */
export function isPreviewCompilerWorkerRequest(
  value: unknown,
): value is PreviewCompilerWorkerRequest {
  if (typeof value !== 'object' || value === null || !('type' in value)) return false;
  if (value.type === 'shutdown') return true;
  if (value.type === 'cancel') {
    return 'id' in value && typeof value.id === 'number' && Number.isSafeInteger(value.id);
  }
  if (value.type === 'compile') {
    return (
      'id' in value &&
      typeof value.id === 'number' &&
      Number.isSafeInteger(value.id) &&
      'request' in value &&
      isPreviewWorkerBuildRequest(value.request)
    );
  }
  return (
    value.type === 'collect-complete-route-inventory' &&
    'request' in value &&
    isPreviewWorkerBuildRequest(value.request) &&
    (!('limits' in value) || value.limits === undefined || isPartialInventoryLimits(value.limits))
  );
}

/** Checks the stable scalar fields required before an untrusted request reaches the compiler. */
function isPreviewWorkerBuildRequest(value: unknown): value is PreviewBuildRequest {
  return (
    typeof value === 'object' &&
    value !== null &&
    'dependencySnapshots' in value &&
    Array.isArray(value.dependencySnapshots) &&
    'documentPath' in value &&
    typeof value.documentPath === 'string' &&
    'sourceText' in value &&
    typeof value.sourceText === 'string' &&
    'workspaceRoot' in value &&
    typeof value.workspaceRoot === 'string' &&
    'language' in value &&
    (value.language === 'js' ||
      value.language === 'jsx' ||
      value.language === 'ts' ||
      value.language === 'tsx')
  );
}

/** Validates every top-level inventory field before the host trusts worker output. */
function isCompleteRouteInventory(value: unknown): value is PreviewInspectorCompleteRouteInventory {
  if (!isRecord(value)) return false;
  const counts = value.counts;
  const limits = value.limits;
  const owner = value.owner;
  const replayPolicy = value.replayPolicy;
  return (
    value.version === 4 &&
    value.predecessorVersion === 3 &&
    typeof value.complete === 'boolean' &&
    typeof value.truncated === 'boolean' &&
    isNonNegativeSafeInteger(value.analysisPasses) &&
    isNonNegativeSafeInteger(value.replayPasses) &&
    Array.isArray(value.dependencyPaths) &&
    value.dependencyPaths.every((dependencyPath) => typeof dependencyPath === 'string') &&
    Array.isArray(value.entries) &&
    value.entries.every(
      (entry) =>
        isRecord(entry) &&
        typeof entry.id === 'string' &&
        (entry.disposition === 'duplicate' ||
          entry.disposition === 'runnable' ||
          entry.disposition === 'unresolved'),
    ) &&
    isCompleteRouteInventoryCounts(counts) &&
    isCompleteRouteInventoryLimits(limits) &&
    isRecord(owner) &&
    typeof owner.exportName === 'string' &&
    typeof owner.sourcePath === 'string' &&
    isRecord(replayPolicy) &&
    replayPolicy.version === 4 &&
    replayPolicy.predecessorVersion === 3 &&
    typeof replayPolicy.digest === 'string'
  );
}

/** Checks the four exact integer inventory totals. */
function isCompleteRouteInventoryCounts(value: unknown): boolean {
  if (!isRecord(value)) return false;
  return (
    isNonNegativeSafeInteger(value.duplicate) &&
    isNonNegativeSafeInteger(value.runnable) &&
    isNonNegativeSafeInteger(value.total) &&
    isNonNegativeSafeInteger(value.unresolved)
  );
}

/** Checks exact positive traversal limits or their optional request subset. */
function isCompleteRouteInventoryLimits(value: unknown): boolean {
  if (!isRecord(value)) return false;
  return (
    isPositiveSafeInteger(value.maximumAnalysisPasses) &&
    isPositiveSafeInteger(value.maximumBranches) &&
    isPositiveSafeInteger(value.maximumDepth)
  );
}

/** Validates only supplied inventory-limit keys on an incoming request. */
function isPartialInventoryLimits(value: unknown): boolean {
  if (!isRecord(value)) return false;
  const names = ['maximumAnalysisPasses', 'maximumBranches', 'maximumDepth'];
  return (
    Object.keys(value).every((name) => names.includes(name)) &&
    names.every((name) => !(name in value) || isPositiveSafeInteger(value[name]))
  );
}

/** Narrows untrusted structured-clone objects before field access. */
function isRecord(value: unknown): value is Readonly<Record<string, unknown>> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** Accepts bounded counter values including zero. */
function isNonNegativeSafeInteger(value: unknown): value is number {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0;
}

/** Accepts traversal limits that can execute at least one unit of work. */
function isPositiveSafeInteger(value: unknown): value is number {
  return isNonNegativeSafeInteger(value) && value > 0;
}
