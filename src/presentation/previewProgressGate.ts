/**
 * Rejects regressive preparation milestones when a fast-build failure restarts work through the
 * complete discovery path under the same immutable panel revision. The browser uses an equivalent
 * guard for retained documents; this host-side gate also protects the initial full-screen loader.
 */
import { PREVIEW_PROGRESS_STAGES, type PreviewProgressStage } from '../domain/previewProgress';

/** Monotonic stage cursor owned by one preview panel session. */
export class PreviewProgressGate {
  private revision = -1;
  private stageIndex = -1;

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
      return true;
    }
    if (nextIndex < this.stageIndex) {
      return false;
    }
    this.stageIndex = nextIndex;
    return true;
  }
}
