/**
 * Defers complete application-context discovery until a fast preview revision reaches the browser.
 * This coordinator owns no VS Code objects; a panel session supplies small callbacks for progress,
 * commit, diagnostics, and revision ownership while the application service performs the build.
 */
import { createHash } from 'node:crypto';
import type { BuildPreview } from '../application/buildPreview';
import type { PreparedPreview, PreviewRenderMode } from '../domain/preview';
import { isPreviewBuildCancellation, isPreviewBuildStall } from '../domain/previewBuildExecution';
import type { ResolvedPreviewTarget } from './activePreviewTarget';

/** Deferred full build waiting for the corresponding fast artifact to settle in the browser. */
interface PendingPreviewContextEnrichment {
  /** Fast artifact whose runtime acknowledgement unlocks the full pass. */
  readonly artifactHash: string;
  /** Exact graph-policy identity used only for a bounded deterministic-stall backoff. */
  readonly resourceIdentity: string;
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
  /** One deterministic failure skipped once; the following explicit refresh may try again. */
  private failedResourceBackoff: { readonly resourceIdentity: string } | undefined;
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
    const resourceIdentity = createEnrichmentResourceIdentity(target);
    if (this.failedResourceBackoff?.resourceIdentity === resourceIdentity) {
      // Skip one identical deterministic retry, then clear the marker. This breaks immediate
      // refresh loops even when worker-local entry credentials changed the fast artifact hash.
      this.failedResourceBackoff = undefined;
      this.options.callbacks.complete(revision);
      return;
    }
    this.pending = { artifactHash, resourceIdentity, revision, signal, target };
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
      let schedulerRetryCount = 0;
      for (;;) {
        try {
          const preparedPreview = await this.options.buildPreview.execute(
            {
              ...pending.target.request,
              buildIntent: 'context-enrichment',
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
            this.failedResourceBackoff = undefined;
            return;
          } catch (error) {
            await this.options.buildPreview.releaseArtifact(preparedPreview.artifact.contentHash);
            throw error;
          }
        } catch (error) {
          const schedulerPreempted =
            isPreviewBuildCancellation(error, pending.signal) &&
            !pending.signal.aborted &&
            this.options.callbacks.isCurrent(pending.revision);
          if (schedulerPreempted && schedulerRetryCount < 1) {
            schedulerRetryCount += 1;
            continue;
          }
          throw error;
        }
      }
    } catch (error) {
      if (
        !isPreviewBuildCancellation(error, pending.signal) &&
        this.options.callbacks.isCurrent(pending.revision)
      ) {
        if (isDeterministicEnrichmentStall(error)) {
          this.failedResourceBackoff = {
            resourceIdentity: pending.resourceIdentity,
          };
        }
        this.options.callbacks.reportFailure(error, pending.target, pending.revision);
      }
    } finally {
      this.options.callbacks.complete(pending.revision);
    }
  }
}

/**
 * Creates an exact retry identity from the active editor snapshots without rescanning their text.
 * VS Code document versions are monotonic within an editor session, so requests carrying complete
 * version metadata hash only bounded paths, policies, and revisions. Programmatic requests that do
 * not carry versions retain the complete-text fallback and therefore the original invalidation
 * guarantee. Length prefixes keep both identity schemes and every field boundary unambiguous.
 */
function createEnrichmentResourceIdentity(target: ResolvedPreviewTarget): string {
  const request = target.request;
  const hash = createHash('sha256');
  const update = (value: string): void => {
    hash.update(value.length.toString());
    hash.update('\u0000');
    hash.update(value);
    hash.update('\u0000');
  };
  const usesEditorVersions =
    isExactDocumentVersion(request.documentVersion) &&
    request.dependencySnapshots.every((snapshot) =>
      isExactDocumentVersion(snapshot.documentVersion),
    );
  update(usesEditorVersions ? 'editor-version-identity:v1' : 'source-text-identity:v1');
  update(request.documentPath);
  update(
    usesEditorVersions && isExactDocumentVersion(request.documentVersion)
      ? request.documentVersion.toString()
      : request.sourceText,
  );
  update(request.workspaceRoot);
  update(request.setupModulePath ?? '');
  update(request.tsconfigPath ?? '');
  update(request.maxOutputMebibytes?.toString() ?? '');
  update(request.useStorybookPreview === true ? 'storybook:on' : 'storybook:off');
  for (const snapshot of request.dependencySnapshots) {
    update(snapshot.documentPath);
    update(snapshot.language);
    update(
      usesEditorVersions && isExactDocumentVersion(snapshot.documentVersion)
        ? snapshot.documentVersion.toString()
        : snapshot.sourceText,
    );
  }
  return hash.digest('hex');
}

/** Accepts only bounded integer revisions that can preserve exact equality through serialization. */
function isExactDocumentVersion(value: number | undefined): value is number {
  return value !== undefined && Number.isSafeInteger(value) && value >= 0;
}

/** Only deterministic graph-cost failures receive one bounded same-resource backoff. */
function isDeterministicEnrichmentStall(error: unknown): boolean {
  return (
    isPreviewBuildStall(error) &&
    (error.reason === 'memory' || error.reason === 'native-service' || error.reason === 'watchdog')
  );
}
