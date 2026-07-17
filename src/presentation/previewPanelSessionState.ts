/** Mutable-work identities shared by the lifecycle methods of one pinned preview panel session. */

/** Full-document runtime waiting for its exact local ESM entry to acknowledge startup. */
export interface PendingPreviewInitialRuntime {
  /** Artifact displayed by the complete webview document. */
  readonly artifactHash: string;
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
  /** Shared bundle identity whose existing browser transfer also satisfies this revision. */
  readonly artifactHash: string;
  /** Stable target label used to close only this revision's progress indicator. */
  readonly documentName: string;
  /** Newest session revision waiting for the shared browser result. */
  readonly revision: number;
}
