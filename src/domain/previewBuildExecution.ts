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
