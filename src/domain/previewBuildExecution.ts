/**
 * Defines cancellation and performance data shared by preview orchestration boundaries.
 * The types deliberately depend only on platform `AbortSignal` and domain progress stages, which
 * lets VS Code sessions, compiler adapters, and tests cooperate without importing one another.
 */
import type { PreviewProgressReporter, PreviewProgressStage } from './previewProgress';

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
  'cancel-timeout' | 'memory' | 'native-service' | 'queue-capacity' | 'watchdog';

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
