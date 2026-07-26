/** Mutable-work identities shared by the lifecycle methods of one pinned preview panel session. */
import type { PreviewPreparedApplicationOrigin } from './previewPreparedApplication';

/** Full-document runtime waiting for its exact local ESM entry to acknowledge startup. */
export interface PendingPreviewInitialRuntime {
  /** Opaque application identity used to settle only this browser bootstrap. */
  readonly applicationId: string;
  /** Artifact displayed by the complete webview document. */
  readonly artifactHash: string;
  /** Foreground or background work that owns this browser bootstrap. */
  readonly origin: PreviewPreparedApplicationOrigin;
  /** Opaque token embedded in the same complete document. */
  readonly runtimeToken: string;
  /** Session revision that produced the document. */
  readonly revision: number;
  /** Safety timer that converts a stalled browser bootstrap into a recoverable diagnostic. */
  readonly timeout: ReturnType<typeof setTimeout>;
}

/** Abort controller exclusively owned by the newest scheduled or active session revision. */
export interface ActivePreviewBuildExecution {
  /** Controller propagated through target resolution, analysis, native build, and publication. */
  readonly controller: AbortController;
  /** Session-local revision that exclusively owns the controller. */
  readonly revision: number;
}

/** Latest revision waiting on an older request that is applying the exact same artifact bytes. */
export interface PendingSamePreviewArtifactRevision {
  /** Opaque application identity for the newer revision sharing a browser transfer. */
  readonly applicationId: string;
  /** Shared bundle identity whose existing browser transfer also satisfies this revision. */
  readonly artifactHash: string;
  /** Stable target label used to close only this revision's progress indicator. */
  readonly documentName: string;
  /** Foreground or background work that owns the shared application. */
  readonly origin: PreviewPreparedApplicationOrigin;
  /** Newest session revision waiting for the shared browser result. */
  readonly revision: number;
}

/** One host-authorized retry action exposed by a recoverable static or bootstrap failure. */
export interface PendingPreviewRetry {
  /** Exact panel revision that owns the recovery action. */
  readonly revision: number;
  /** Opaque token that must match the error document's button message. */
  readonly token: string;
}
