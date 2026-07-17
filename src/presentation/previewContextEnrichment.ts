/**
 * Defers complete application-context discovery until a fast preview revision reaches the browser.
 * This coordinator owns no VS Code objects; a panel session supplies small callbacks for progress,
 * commit, diagnostics, and revision ownership while the application service performs the build.
 */
import type { BuildPreview } from '../application/buildPreview';
import type { PreparedPreview, PreviewRenderMode } from '../domain/preview';
import { isPreviewBuildCancellation } from '../domain/previewBuildExecution';
import type { ResolvedPreviewTarget } from './activePreviewTarget';

/** Deferred full build waiting for the corresponding fast artifact to settle in the browser. */
interface PendingPreviewContextEnrichment {
  /** Fast artifact whose runtime acknowledgement unlocks the full pass. */
  readonly artifactHash: string;
  /** Session-local revision owning the immutable source snapshot. */
  readonly revision: number;
  /** Cancellation signal shared with the complete revision lifecycle. */
  readonly signal: AbortSignal;
  /** Pinned source target captured before either preparation pass. */
  readonly target: ResolvedPreviewTarget;
}

/** Integration callbacks that keep VS Code and panel state outside this orchestration helper. */
export interface PreviewContextEnrichmentCallbacks {
  /** Clears revision-owned execution state after the full pass settles. */
  readonly complete: (revision: number) => void;
  /** Commits one complete artifact after the fast browser revision has rendered. */
  readonly commit: (
    target: ResolvedPreviewTarget,
    preview: PreparedPreview,
    revision: number,
  ) => void;
  /** Reports whether an asynchronous result still belongs to the live panel revision. */
  readonly isCurrent: (revision: number) => boolean;
  /** Records a non-fatal enrichment failure while the fast preview remains visible. */
  readonly reportFailure: (error: unknown, target: ResolvedPreviewTarget, revision: number) => void;
}

/** Dependencies and immutable rendering policy for one panel-local coordinator. */
export interface PreviewContextEnrichmentOptions {
  /** Build use case used for full compilation and artifact lease release. */
  readonly buildPreview: Pick<BuildPreview, 'execute' | 'releaseArtifact'>;
  /** Session callbacks that own mutable presentation state. */
  readonly callbacks: PreviewContextEnrichmentCallbacks;
  /** Rendering mode retained from panel creation. */
  readonly renderMode: PreviewRenderMode;
}

/** Coordinates exactly one replaceable deferred full-context pass per preview session. */
export class PreviewContextEnrichmentCoordinator {
  private pending: PendingPreviewContextEnrichment | undefined;

  /** Creates a coordinator around explicit application and presentation boundaries. */
  public constructor(private readonly options: PreviewContextEnrichmentOptions) {}

  /**
   * Replaces any older pending pass and optionally starts immediately for an already-mounted tree.
   *
   * @param target Immutable pinned source snapshot used by the fast build.
   * @param artifactHash Fast artifact identity awaited from the browser runtime.
   * @param revision Owning panel revision.
   * @param signal Revision cancellation signal.
   * @param awaitsRuntimeSettlement Whether a startup or hot-swap acknowledgement is still pending.
   */
  public schedule(
    target: ResolvedPreviewTarget,
    artifactHash: string,
    revision: number,
    signal: AbortSignal,
    awaitsRuntimeSettlement: boolean,
  ): void {
    this.pending = { artifactHash, revision, signal, target };
    if (!awaitsRuntimeSettlement) {
      this.settle(artifactHash, revision);
    }
  }

  /** Starts the deferred full pass only for the exact fast artifact and owning revision. */
  public settle(artifactHash: string, revision: number): void {
    const pending = this.pending;
    if (pending?.artifactHash !== artifactHash || pending.revision !== revision) {
      return;
    }
    this.pending = undefined;
    void this.run(pending);
  }

  /** Drops a not-yet-started pass when a refresh, timeout, or panel disposal supersedes it. */
  public cancel(): void {
    this.pending = undefined;
  }

  /** Builds, validates revision ownership, and commits one non-blocking full-context artifact. */
  private async run(pending: PendingPreviewContextEnrichment): Promise<void> {
    try {
      const preparedPreview = await this.options.buildPreview.execute(
        {
          ...pending.target.request,
          preparationMode: 'full',
          renderMode: this.options.renderMode,
        },
        { signal: pending.signal },
      );
      if (!this.options.callbacks.isCurrent(pending.revision)) {
        await this.options.buildPreview.releaseArtifact(preparedPreview.artifact.contentHash);
        return;
      }
      try {
        this.options.callbacks.commit(pending.target, preparedPreview, pending.revision);
      } catch (error) {
        await this.options.buildPreview.releaseArtifact(preparedPreview.artifact.contentHash);
        throw error;
      }
    } catch (error) {
      if (
        !isPreviewBuildCancellation(error, pending.signal) &&
        this.options.callbacks.isCurrent(pending.revision)
      ) {
        this.options.callbacks.reportFailure(error, pending.target, pending.revision);
      }
    } finally {
      this.options.callbacks.complete(pending.revision);
    }
  }
}
