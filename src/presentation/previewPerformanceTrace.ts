/**
 * Measures visible preview preparation stages and emits compact structured duration records.
 * This presentation helper owns mutable timing state so the panel session stays focused on build,
 * artifact, and webview lifecycle orchestration.
 */
import type {
  PreviewStageDurationTrace,
  PreviewStageTraceOutcome,
} from '../domain/previewBuildExecution';
import type { PreviewProgressStage } from '../domain/previewProgress';

/** Active monotonic interval for one visible stage of one session revision. */
interface ActiveProgressTiming {
  /** Human-readable workspace-relative target correlated with this timing. */
  readonly target: string;
  /** Session-local revision that emitted the stage. */
  readonly revision: number;
  /** Wall-clock start used only for diagnostic measurement. */
  readonly startedAt: number;
  /** Current preparation stage whose duration ends at the next transition. */
  readonly stage: PreviewProgressStage;
}

/** Receives one immutable timing record for logging or test observation. */
export type PreviewStageTraceReporter = (trace: PreviewStageDurationTrace) => void;

/** Keeps one current interval and turns monotonic progress events into structured durations. */
export class PreviewPerformanceTrace {
  private activeTiming: ActiveProgressTiming | undefined;

  /**
   * Creates an isolated recorder for one panel session.
   *
   * @param report Destination invoked once whenever an interval reaches a terminal boundary.
   * @param now Injectable wall clock retained for deterministic tests.
   */
  public constructor(
    private readonly report: PreviewStageTraceReporter,
    private readonly now: () => number = Date.now,
  ) {}

  /**
   * Completes the preceding interval and begins the requested stage when it is not steady state.
   * Duplicate stage reports do not reset timing, preserving the full cost of repeated sub-steps.
   */
  public transition(revision: number, target: string, stage: PreviewProgressStage): void {
    if (this.activeTiming?.revision === revision && this.activeTiming.stage === stage) {
      return;
    }
    if (this.activeTiming !== undefined) {
      this.emit(this.activeTiming.revision === revision ? 'completed' : 'cancelled');
    }
    if (stage !== 'ready') {
      this.activeTiming = { revision, stage, startedAt: this.now(), target };
    }
  }

  /**
   * Completes the current interval after runtime startup, failure, disposal, or supersession.
   *
   * @param outcome Terminal status attached to the recorded interval.
   * @param revision Optional guard that prevents stale browser messages ending newer work.
   */
  public finish(outcome: PreviewStageTraceOutcome, revision?: number): void {
    if (
      this.activeTiming === undefined ||
      (revision !== undefined && this.activeTiming.revision !== revision)
    ) {
      return;
    }
    this.emit(outcome);
  }

  /** Emits and clears one active interval before any consumer callback can re-enter the recorder. */
  private emit(outcome: PreviewStageTraceOutcome): void {
    const timing = this.activeTiming;
    if (timing === undefined) {
      return;
    }
    this.activeTiming = undefined;
    this.report({
      durationMs: Math.max(0, Math.round(this.now() - timing.startedAt)),
      outcome,
      revision: timing.revision,
      stage: timing.stage,
      target: timing.target,
    });
  }
}
