/**
 * Defines the structured-clone protocol between the VS Code extension host and compiler worker.
 * Only domain requests, bundles, progress stages, and serializable errors cross this boundary;
 * VS Code objects, esbuild contexts, callbacks, and AbortSignals remain in their owning thread.
 */
import {
  PreviewCompilationError,
  type PreviewBuildRequest,
  type PreviewBundle,
  type PreviewDiagnostic,
} from '../../domain/preview';
import {
  isPreviewBuildCancellation,
  isPreviewBuildStall,
  PreviewBuildCancelledError,
  PreviewBuildStalledError,
  type PreviewBuildStallReason,
} from '../../domain/previewBuildExecution';
import type { PreviewProgressStage } from '../../domain/previewProgress';

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

/** Every message accepted by the compiler worker. */
export type PreviewCompilerWorkerRequest =
  | PreviewCompilerWorkerCancelRequest
  | PreviewCompilerWorkerCompileRequest
  | PreviewCompilerWorkerShutdownRequest;

/** Reports one monotonic compiler milestone without moving callbacks across threads. */
export interface PreviewCompilerWorkerProgressResponse {
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

/** Every message returned by the compiler worker. */
export type PreviewCompilerWorkerResponse =
  | PreviewCompilerWorkerFailureResponse
  | PreviewCompilerWorkerProgressResponse
  | PreviewCompilerWorkerShutdownResponse
  | PreviewCompilerWorkerStartedResponse
  | PreviewCompilerWorkerSuccessResponse;

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
): value is PreviewCompilerWorkerResponse {
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
