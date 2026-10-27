/** Explicit state, presentation services, and session callbacks borrowed by the build coordinator. */
export interface PreviewPanelBuildScope {
  /** Releases the current document lease and resets its pending runtime ownership. */
  readonly releaseCurrentArtifact: () => void;
  /** Host panel, compiler, artifact, and log services borrowed from the owning session. */
  readonly options: import('./previewPanelSessionTypes').PreviewPanelSessionOptions;
  /** Reads the current pinned document URI when asynchronous work needs it. */
  readonly documentUri: () => import('vscode').Uri;
  /** Clears execution tracking only for the matching monotonically increasing build revision. */
  readonly clearBuildExecution: (requestedRevision: number) => void;
  /** Reports whether a captured build revision still owns the live session. */
  readonly isCurrentRevision: (requestedRevision: number) => boolean;
  /** Records bounded timing and build milestones without taking resource ownership. */
  readonly performanceTrace: import('./previewPerformanceTrace').PreviewPerformanceTrace;
  /** Displays target resolution feedback for the matching revision. */
  readonly renderTargetIssue: (
    issue: import('./activePreviewTarget').PreviewTargetIssue,
    requestedRevision: number,
  ) => void;
  /** Matches a changed document against the pinned target and its lexical path identity. */
  readonly targetsDocument: (documentPath: string) => boolean;
  /** Owns pending route choices and their acknowledged selection status. */
  readonly inspectorRouteSelection: import('./previewPanelRouteSelection').PreviewPanelRouteSelection;
  /** Owns pending page-candidate choices and their browser acknowledgement state. */
  readonly inspectorPageCandidateSelection: import('./previewPanelPageCandidateSelection').PreviewPanelPageCandidateSelection;
  /** Renders one revision-scoped stage, optionally preserving the prepared fallback document. */
  readonly renderProgress: (
    requestedRevision: number,
    documentName: string,
    stage:
      | 'resolving-target'
      | 'analyzing-project'
      | 'discovering-components'
      | 'preparing-runtime'
      | 'bundling-modules'
      | 'acquiring-dependencies'
      | 'publishing-artifacts'
      | 'loading-preview'
      | 'ready',
    fallbackHtml?: string,
  ) => void;
  /** Retains foreground and enrichment preparation state across build attempts. */
  readonly preparationState: import('./previewPanelPreparationState').PreviewPanelPreparationState;
  /** Releases one content-addressed artifact lease by its hash. */
  readonly releaseArtifact: (contentHash: string) => void;
  /** Coordinates exact Inspector selection requests and runtime outcomes. */
  readonly inspectorSelection: import('./previewPanelInspectorSelectionController').PreviewPanelInspectorSelectionController;
  /** Publishes a prepared artifact and returns its pending browser application handle. */
  readonly commitPreparedPreview: (
    documentName: string,
    preparedPreview: import('../domain/preview').PreparedPreview,
    requestedRevision: number,
    origin?: import('./previewPreparedApplication').PreviewPreparedApplicationOrigin,
  ) => import('./previewPreparedApplication').PreviewPreparedApplicationHandle;
  /** Associates a prepared application with the foreground request that owns it. */
  readonly bindPreparedForegroundApplication: (
    handle: import('./previewPreparedApplication').PreviewPreparedApplicationHandle,
    origin: import('./previewPreparedApplication').PreviewPreparedApplicationOrigin,
  ) => void;
  /** Settles an acknowledged application at its displayed runtime revision. */
  readonly settlePreparedApplication: (
    applicationId: string,
    origin: import('./previewPreparedApplication').PreviewPreparedApplicationOrigin,
    displayedRevision: number,
  ) => void;
  /** Mutable session state shared with the coordinator; the session owns its lifetime. */
  readonly state: import('./previewPanelSessionState').PreviewPanelSessionMutableState;
  /** Formats only validated frontier mismatch evidence for diagnostic logs. */
  readonly formatFrontierMismatchEvidenceSuffix: (error: unknown) => string;
  /** Rolls back an unacknowledged selection belonging to the specified build and application. */
  readonly rollbackInspectorSelection: (
    buildRevision: number,
    reason: import('./previewInspectorSelectionStatusProtocol').PreviewInspectorSelectionFailureReason,
    applicationId?: string,
    displayedRevision?: number,
  ) => void;
  /** Displays a recoverable failure for one current build revision. */
  readonly renderRetryableError: (
    errorState: { readonly details?: string; readonly message: string; readonly title: string },
    revision: number,
  ) => void;
  /** Tracks user retry choices and their captured target revision. */
  readonly retryController: import('./previewPanelRetryController').PreviewPanelRetryController;
  /** Absolute pinned target path used for diagnostics and artifact lifetime tracking. */
  readonly targetPath: string;
  /** Verifies target-scoped authenticated source-navigation gestures. */
  readonly inspectorSourceGesture: import('./previewInspectorGestureGate').PreviewInspectorGestureGate;
  /** Replaces directory subscriptions with the newly admitted dependency directories. */
  readonly replaceDirectoryWatchers: (nextDirectories: ReadonlySet<string>) => void;
  /** Starts the bounded browser acknowledgement timer for one prepared runtime token. */
  readonly startInitialRuntimeWatchdog: (
    artifactHash: string,
    runtimeToken: string,
    revision: number,
    origin?: import('./previewPreparedApplication').PreviewPreparedApplicationOrigin,
    applicationId?: string,
  ) => void;
  /** Releases obsolete document leases after the next application owns the panel. */
  readonly releaseSupersededDocumentArtifacts: (previousArtifactHash: string) => void;
  /** Sends the next artifact through the current document and returns its application identifier. */
  readonly postHotReload: (
    previousArtifactHash: string,
    nextArtifactHash: string,
    scriptUri: string,
    stylesheetUri: string | undefined,
    fallbackHtml: string,
    requestedRevision: number,
    runtimeToken: string,
    origin: import('./previewPreparedApplication').PreviewPreparedApplicationOrigin,
  ) => string;
  /** Coalesces progress updates while retaining the active revision and document state. */
  readonly progressGate: import('./previewProgressGate').PreviewProgressGate;
  /** Posts bounded selection status updates to the current Inspector runtime. */
  readonly publishInspectorSelectionStatuses: (
    statuses: readonly import('./previewInspectorSelectionStatusProtocol').PreviewInspectorSelectionStatusMessage[],
  ) => void;
  /** Restores the prepared fallback document when the current revision needs a full reload. */
  readonly replaceWithProgressFallback: (requestedRevision: number, fallbackHtml: string) => void;
}
