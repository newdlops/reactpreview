/**
 * Rejects regressive preparation milestones when a fast-build failure restarts work through the
 * complete discovery path under the same immutable panel revision. The browser uses an equivalent
 * guard for retained documents; this host-side gate also protects the initial full-screen loader.
 */
import {
  PREVIEW_PROGRESS_STAGES,
  type PreviewProgressStage,
  type PreviewProgressTiming,
} from '../domain/previewProgress';

/** Monotonic stage cursor owned by one preview panel session. */
export class PreviewProgressGate {
  private revision = -1;
  private stageIndex = -1;
  private startedAt = 0;
  private stageStartedAt = 0;
  private finishedAt: number | undefined;
  private readonly durations = new Map<Exclude<PreviewProgressStage, 'ready'>, number>();

  /** Uses a monotonic clock without scheduling host timers or periodic webview messages. */
  public constructor(private readonly now: () => number = () => performance.now()) {}

  /** Identifies duplicate reports so an unchanged initial loading document need not reload. */
  public isCurrent(revision: number, stage: PreviewProgressStage): boolean {
    return this.revision === revision && this.stageIndex === PREVIEW_PROGRESS_STAGES.indexOf(stage);
  }

  /**
   * Accepts forward/equal milestones and resets automatically for a newer session revision.
   *
   * @param revision Non-negative session-local build revision.
   * @param stage Candidate lifecycle milestone.
   * @returns Whether presentation and performance tracing may observe the candidate.
   */
  public accept(revision: number, stage: PreviewProgressStage): boolean {
    const nextIndex = PREVIEW_PROGRESS_STAGES.indexOf(stage);
    if (revision < this.revision || nextIndex < 0) {
      return false;
    }
    if (revision > this.revision) {
      this.revision = revision;
      this.stageIndex = nextIndex;
      this.startedAt = this.now();
      this.stageStartedAt = this.startedAt;
      this.finishedAt = stage === 'ready' ? this.startedAt : undefined;
      this.durations.clear();
      return true;
    }
    if (nextIndex < this.stageIndex) {
      return false;
    }
    if (nextIndex > this.stageIndex) {
      const at = Math.max(this.stageStartedAt, this.now());
      const previous = PREVIEW_PROGRESS_STAGES[this.stageIndex];
      if (previous !== undefined && previous !== 'ready')
        this.durations.set(previous, at - this.stageStartedAt);
      this.stageStartedAt = at;
      if (stage === 'ready') this.finishedAt = at;
      this.stageIndex = nextIndex;
    }
    return true;
  }

  /** Captures current measured durations without resetting equal-stage activity reports. */
  public snapshot(revision: number): PreviewProgressTiming | undefined {
    if (revision !== this.revision) return undefined;
    const at = this.finishedAt ?? Math.max(this.stageStartedAt, this.now());
    const durations = new Map(this.durations);
    const current = PREVIEW_PROGRESS_STAGES[this.stageIndex];
    if (current !== undefined && current !== 'ready')
      durations.set(current, at - this.stageStartedAt);
    return {
      elapsedMs: at - this.startedAt,
      stages: [...durations].map(([stage, elapsedMs]) => ({ stage, elapsedMs })),
    };
  }
}
