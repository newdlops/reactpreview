/* eslint-disable jsdoc/require-jsdoc, @typescript-eslint/explicit-function-return-type */
/**
 * Defines cancellation and performance data shared by preview orchestration boundaries.
 * The types deliberately depend only on platform `AbortSignal` and domain progress stages, which
 * lets VS Code sessions, compiler adapters, and tests cooperate without importing one another.
 */
import type { PreviewProgressReporter, PreviewProgressStage } from './previewProgress';
import type { PreviewCompilerActivity } from './previewCompilerActivity';

/** Optional controls attached to one immutable preview build without changing its source request. */
export interface PreviewBuildExecutionContext {
  /** Receives monotonic preparation milestones for the build's owning session revision. */
  readonly reportProgress?: PreviewProgressReporter;
  /** Cancels work whose result can no longer be committed by the requesting preview session. */
  readonly signal?: AbortSignal;
}

/** Terminal reason recorded for the final measured portion of one preparation stage. */
export type PreviewStageTraceOutcome = 'cancelled' | 'completed' | 'failed';

/** Structured duration record emitted to the extension log for performance diagnosis. */
export interface PreviewStageDurationTrace {
  /** Wall-clock milliseconds spent in this stage, rounded to an integer for stable logging. */
  readonly durationMs: number;
  /** Whether the stage advanced normally, failed, or was superseded by a newer revision. */
  readonly outcome: PreviewStageTraceOutcome;
  /** Session-local revision that owns the measurement. */
  readonly revision: number;
  /** Preparation stage whose active interval was measured. */
  readonly stage: PreviewProgressStage;
  /** Workspace-relative target name used to correlate traces without exposing generated paths. */
  readonly target: string;
}

/** Domain error used when work observes that its preview revision is no longer wanted. */
export class PreviewBuildCancelledError extends Error {
  /** Creates a recognizable cancellation that presentation code may suppress safely. */
  public constructor() {
    super('The React preview build was superseded by a newer revision.');
    this.name = 'PreviewBuildCancelledError';
  }
}

/** Resource boundary that prevented a background compilation from completing normally. */
export type PreviewBuildStallReason =
  | 'cancel-timeout'
  | 'candidate-unavailable'
  | 'frontier-mismatch'
  | 'memory'
  | 'native-service'
  | 'queue-capacity'
  | 'watchdog';

export type PreviewFrontierMismatchCause =
  'guard-escape' | 'unexpected-metafile-input' | 'missing-execution-surface';
export interface PreviewFrontierMismatchPathEvidence {
  readonly digest: string;
  readonly workspaceRelativePath?: string;
}
export interface PreviewFrontierMismatchSpecifierEvidence {
  readonly digest: string;
  readonly value?: string;
}
export interface PreviewFrontierMismatchSurfaceEvidence {
  readonly identityDigest: string;
  readonly strategy: string;
}
export interface PreviewFrontierMismatchEvidence {
  readonly cause: PreviewFrontierMismatchCause;
  readonly source: PreviewFrontierMismatchPathEvidence;
  readonly importer?: PreviewFrontierMismatchPathEvidence;
  readonly specifier?: PreviewFrontierMismatchSpecifierEvidence;
  readonly surface?: PreviewFrontierMismatchSurfaceEvidence;
}
const DIGEST = /^[a-f0-9]{16}$/u;
const SAFE_PATH = (value: string) =>
  value.length > 0 &&
  value.length <= 512 &&
  !/[\\\x00-\x1f\x7f]/u.test(value) &&
  !/^(?:\/|[A-Za-z]:[\\/])/u.test(value) &&
  value.split('/').every((part) => part !== '' && part !== '.' && part !== '..');
const SAFE_SPECIFIER = (value: string) =>
  value.length > 0 &&
  value.length <= 256 &&
  !/[\\\x00-\x1f\x7f]/u.test(value) &&
  !/^(?:\/|[A-Za-z]:[\\/]|[A-Za-z][A-Za-z0-9+.-]*:)/u.test(value);
function record(value: unknown): value is Record<string, unknown> {
  return (
    typeof value === 'object' &&
    value !== null &&
    !Array.isArray(value) &&
    Object.getPrototypeOf(value) === Object.prototype
  );
}
function keys(value: Record<string, unknown>, expected: readonly string[]): boolean {
  return (
    Object.keys(value).length === expected.length &&
    expected.every((key) => Object.hasOwn(value, key))
  );
}
function pathEvidence(value: unknown): boolean {
  return (
    record(value) &&
    Object.keys(value).every((key) => key === 'digest' || key === 'workspaceRelativePath') &&
    typeof value.digest === 'string' &&
    DIGEST.test(value.digest) &&
    (!Object.hasOwn(value, 'workspaceRelativePath') ||
      (typeof value.workspaceRelativePath === 'string' && SAFE_PATH(value.workspaceRelativePath)))
  );
}
function specifierEvidence(value: unknown): boolean {
  return (
    record(value) &&
    Object.keys(value).every((key) => key === 'digest' || key === 'value') &&
    typeof value.digest === 'string' &&
    DIGEST.test(value.digest) &&
    (!Object.hasOwn(value, 'value') ||
      (typeof value.value === 'string' && SAFE_SPECIFIER(value.value)))
  );
}
function surfaceEvidence(value: unknown): boolean {
  return (
    record(value) &&
    keys(value, ['identityDigest', 'strategy']) &&
    typeof value.identityDigest === 'string' &&
    DIGEST.test(value.identityDigest) &&
    typeof value.strategy === 'string' &&
    /^[a-z][a-z0-9-]{0,63}$/u.test(value.strategy)
  );
}
export function isPreviewFrontierMismatchEvidence(
  value: unknown,
): value is PreviewFrontierMismatchEvidence {
  if (!record(value) || !pathEvidence(value.source)) return false;
  if (value.cause === 'guard-escape')
    return (
      keys(value, ['cause', 'source', 'importer', 'specifier']) &&
      pathEvidence(value.importer) &&
      specifierEvidence(value.specifier)
    );
  if (value.cause === 'unexpected-metafile-input') return keys(value, ['cause', 'source']);
  return (
    value.cause === 'missing-execution-surface' &&
    keys(value, ['cause', 'source', 'surface']) &&
    surfaceEvidence(value.surface)
  );
}

/**
 * Domain error raised when a background compiler stops making a bounded build complete.
 * Keeping this distinct from a normal source compilation error prevents first-paint orchestration
 * from immediately repeating the same memory-heavy graph through its full fallback path.
 */
export class PreviewBuildStalledError extends Error {
  /** Creates an actionable failure retaining the last milestone observed by the host. */
  public constructor(
    public readonly target: string,
    public readonly lastStage: PreviewProgressStage | undefined,
    public readonly elapsedMs: number,
    public readonly reason: PreviewBuildStallReason = 'watchdog',
    public readonly activity?: PreviewCompilerActivity,
    public readonly frontierMismatchEvidence?: PreviewFrontierMismatchEvidence,
  ) {
    const stageMessage = lastStage === undefined ? 'before its first milestone' : `at ${lastStage}`;
    super(createPreviewBuildStallMessage(reason, target, stageMessage, elapsedMs));
    this.name = 'PreviewBuildStalledError';
  }
}

/** Produces an accurate recovery message for watchdog, queue, memory, and native-service limits. */
function createPreviewBuildStallMessage(
  reason: PreviewBuildStallReason,
  target: string,
  stageMessage: string,
  elapsedMs: number,
): string {
  if (reason === 'queue-capacity') {
    return `React preview compilation was not started because the background queue reached its safe capacity for ${target}. Wait for an active preview or close stale preview tabs before refreshing.`;
  }
  if (reason === 'memory') {
    return `Background React preview compilation exceeded its isolated memory budget ${stageMessage} for ${target}. The compiler worker was restarted before the process could exhaust system memory.`;
  }
  if (reason === 'frontier-mismatch') {
    return `Selected-context React preview compilation produced authored inputs outside its verified module frontier for ${target}. The build was discarded so a stale or inconsistent slice cannot replace the last good preview.`;
  }
  if (reason === 'candidate-unavailable') {
    return `Selected-context React preview compilation could not prove a renderable page or target candidate for ${target}. The last good preview remains available until its inputs change.`;
  }
  if (reason === 'native-service') {
    return `The isolated esbuild service stopped ${stageMessage} for ${target}. The build was not retried with the same graph so system memory can recover.`;
  }
  if (reason === 'cancel-timeout') {
    return `A cancelled React preview did not release its compiler within ${elapsedMs.toString()} ms. The isolated worker was restarted before newer previews could overlap its native graph.`;
  }
  return `Background React preview compilation stalled ${stageMessage} after ${elapsedMs.toString()} ms for ${target}. The isolated compiler was restarted to protect editor responsiveness and system memory.`;
}

/**
 * Throws a stable domain cancellation when the supplied execution has been aborted.
 * Calling this at asynchronous boundaries prevents stale work from entering the next side effect.
 *
 * @param signal Optional cancellation signal owned by the preview panel session.
 */
export function throwIfPreviewBuildCancelled(signal?: AbortSignal): void {
  if (signal?.aborted === true) {
    throw new PreviewBuildCancelledError();
  }
}

/**
 * Identifies both the domain cancellation and adapter-native `AbortError` failures.
 * An already-aborted signal takes precedence because an adapter may reject with an opaque reason.
 *
 * @param error Unknown failure returned by target resolution, compilation, or publication.
 * @param signal Optional owning execution signal.
 * @returns Whether the failure represents intentional supersession rather than a user error.
 */
export function isPreviewBuildCancellation(error: unknown, signal?: AbortSignal): boolean {
  if (signal?.aborted === true || error instanceof PreviewBuildCancelledError) {
    return true;
  }
  return error instanceof Error && error.name === 'AbortError';
}

/** Identifies a watchdog termination without classifying ordinary project build failures as stalls. */
export function isPreviewBuildStall(error: unknown): error is PreviewBuildStalledError {
  return (
    error instanceof PreviewBuildStalledError ||
    (error instanceof Error && error.name === 'PreviewBuildStalledError')
  );
}
