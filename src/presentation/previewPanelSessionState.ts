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

/** Shared mutable publication and resource identities for one pinned panel. */
export interface PreviewPanelSessionMutableState {
  /** Latest retained artifact owned by this panel, including an application awaiting acknowledgement. */
  artifactHash: string | undefined;
  /** Newest revision-owned cancellation controller, absent after settlement or cancellation. */
  activeBuildExecution: ActivePreviewBuildExecution | undefined;
  /** Canonical file identities whose edits invalidate this pinned preview. */
  dependencies: Set<string>;
  /** Canonical directory identities watched for newly created or removed dependencies. */
  dependencyDirectories: Set<string>;
  /** Directory watcher resources grouped by canonical watched path. */
  readonly directoryWatcherDisposables: Map<string, import('vscode').Disposable[]>;
  /** True from the first disposal transition; all later publication must be rejected. */
  disposed: boolean;
  /** Prevents duplicate host disposal callbacks when panel and session disposal race. */
  disposalNotified: boolean;
  /** Artifact whose document or hot update is currently being applied in the webview. */
  displayedArtifactHash: string | undefined;
  /** Monotonic host revision associated with the currently displayed browser application. */
  displayedRuntimeRevision: number;
  /** Canonical serialized import-map identity used to decide whether hot reload can retain the document. */
  moduleImportMapIdentity: string | undefined;
  /** Input frontier included in the last admitted browser application. */
  pageContextFrontierId: string | undefined;
  /** Panel listeners and decorations released exactly once during session disposal. */
  readonly panelDisposables: import('vscode').Disposable[];
  /** Unsettled browser applications indexed by opaque hot-reload token. */
  readonly pendingHotReloads: Map<
    string,
    import('./previewHotReloadProtocol').PendingPreviewHotReload
  >;
  /** Fast-preview inputs retained only until their owning application settles. */
  readonly pendingContextEnrichmentInputs: Map<
    string,
    {
      readonly artifactHash: string;
      readonly signal: AbortSignal;
      readonly target: import('./activePreviewTarget').ResolvedPreviewTarget;
    }
  >;
  /** Full-document bootstrap awaiting its matching runtime token and revision. */
  pendingInitialRuntime: PendingPreviewInitialRuntime | undefined;
  /** Newer revision sharing an already pending application of identical artifact bytes. */
  pendingSameArtifactRevision: PendingSamePreviewArtifactRevision | undefined;
  /** Owned debounce timer; absent when no scheduled refresh remains. */
  refreshTimer: NodeJS.Timeout | undefined;
  /** Monotonic session revision that invalidates superseded builds and browser acknowledgements. */
  revision: number;
  /** Monotonic counter used to create distinct hot-reload transfer tokens. */
  hotReloadSequence: number;
  /** Artifact whose current-file output was authenticated by browser runtime health. */
  verifiedTargetOutputArtifactHash: string | undefined;
}

/** Allocates fresh session-owned collections; no resources or host listeners are started here. */
export function createPreviewPanelSessionState(): PreviewPanelSessionMutableState {
  return {
    artifactHash: undefined,
    activeBuildExecution: undefined,
    dependencies: new Set<string>(),
    dependencyDirectories: new Set<string>(),
    directoryWatcherDisposables: new Map<string, import('vscode').Disposable[]>(),
    disposed: false,
    disposalNotified: false,
    displayedArtifactHash: undefined,
    displayedRuntimeRevision: 0,
    moduleImportMapIdentity: undefined,
    pageContextFrontierId: undefined,
    panelDisposables: [],
    pendingHotReloads: new Map<
      string,
      import('./previewHotReloadProtocol').PendingPreviewHotReload
    >(),
    pendingContextEnrichmentInputs: new Map<
      string,
      {
        readonly artifactHash: string;
        readonly signal: AbortSignal;
        readonly target: import('./activePreviewTarget').ResolvedPreviewTarget;
      }
    >(),
    pendingInitialRuntime: undefined,
    pendingSameArtifactRevision: undefined,
    refreshTimer: undefined,
    revision: 0,
    hotReloadSequence: 0,
    verifiedTargetOutputArtifactHash: undefined,
  };
}
