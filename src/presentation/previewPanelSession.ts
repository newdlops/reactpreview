import * as vscode from 'vscode';
import type { PreparedPreview } from '../domain/preview';
import type { PreviewProgressStage } from '../domain/previewProgress';
import { canonicalizeExistingPath, createExistingPathIdentitySet } from '../shared/pathIdentity';
import type { PreviewTargetIssue, ResolvedPreviewTarget } from './activePreviewTarget';
import { formatPreviewFrontierMismatchEvidenceSuffix } from './previewCompilerActivityLog';
import { PreviewContextEnrichmentCoordinator } from './previewContextEnrichment';
import { describeBuildFailure } from './previewFailure';
import {
  createPreviewHotReloadCancellation,
  type PendingPreviewHotReload,
} from './previewHotReloadProtocol';
import type { PreviewInspectorCompanionOpenSourceRequest } from './previewInspectorCompanionProtocol';
import { PreviewInspectorGestureGate } from './previewInspectorGestureGate';
import { handlePreviewInspectorHostMessage } from './previewInspectorHostMessage';
import {
  createPreviewInspectorNeuralModelSnapshot,
  type PreviewInspectorNeuralModel,
} from './previewInspectorNeuralModelProtocol';
import type { PreviewInspectorPageCandidateSelectionRequest } from './previewInspectorPageCandidateSelectionProtocol';
import type { PreviewInspectorPageExecutionRetryRequest } from './previewInspectorPageExecutionRetryProtocol';
import type { PreviewInspectorRouteSelectionRequest } from './previewInspectorRouteSelectionProtocol';
import type { PreviewInspectorSelectionStatusMessage } from './previewInspectorSelectionStatusProtocol';
import { PreviewInspectorSourceDecoration } from './previewInspectorSourceDecoration';
import { handlePreviewInspectorCompanionSourceNavigation } from './previewInspectorSourceNavigation';
import {
  commitPreparedPanelPreview,
  rebuildPreviewPanelSession,
  renderPreviewPanelProgress,
} from './previewPanelBuildCoordinator';
import type { PreviewPanelBuildScope } from './previewPanelBuildScope';
import { PreviewPanelInspectorSelectionController } from './previewPanelInspectorSelectionController';
import { PreviewPanelPageCandidateSelection } from './previewPanelPageCandidateSelection';
import { PreviewPanelPreparationState } from './previewPanelPreparationState';
import { PreviewPanelRetryController } from './previewPanelRetryController';
import { PreviewPanelRouteSelection } from './previewPanelRouteSelection';
import { handlePreviewPanelRuntimeAcknowledgement } from './previewPanelRuntimeAcknowledgement';
import { createPreviewPanelSessionState } from './previewPanelSessionState';
import type { PreviewPanelSessionOptions } from './previewPanelSessionTypes';
import {
  disposePreviewResources,
  isPreviewPathInside,
  readPreviewPanelUpdateDelay,
  rememberPreviewFailureDependencies,
  replacePreviewDirectoryWatchers,
} from './previewPanelSessionUtilities';
import {
  postPreviewPanelSelectionStatuses,
  renderPreviewPanelRetryableError,
  renderPreviewPanelTargetIssue,
} from './previewPanelStatusRendering';
import { PreviewPerformanceTrace } from './previewPerformanceTrace';
import type {
  PreviewPreparedApplicationHandle,
  PreviewPreparedApplicationOrigin,
} from './previewPreparedApplication';
import { PreviewProgressGate } from './previewProgressGate';
import { readPreviewRetryRequest } from './previewRetryProtocol';
import type { PreviewRuntimeHealthMessage } from './previewRuntimeHealthProtocol';
export type {
  PinnedPreviewTargetResolver,
  PreviewBuildService,
  PreviewPanelSessionCallbacks,
  PreviewPanelSessionOptions,
} from './previewPanelSessionTypes';
/** Owns one pinned panel, its host events, publication state, and final resource disposal. */
export class PreviewPanelSession implements vscode.Disposable {
  private readonly buildScope: PreviewPanelBuildScope;

  private readonly state = createPreviewPanelSessionState();

  public readonly targetPath: string;
  private readonly contextEnrichment: PreviewContextEnrichmentCoordinator;
  private readonly preparationState: PreviewPanelPreparationState;
  private readonly inspectorRouteSelection = new PreviewPanelRouteSelection();
  private readonly inspectorPageCandidateSelection = new PreviewPanelPageCandidateSelection();
  private readonly inspectorSelection = new PreviewPanelInspectorSelectionController();
  private readonly inspectorSourceDecoration = new PreviewInspectorSourceDecoration();
  private readonly inspectorSourceGesture = new PreviewInspectorGestureGate();
  private readonly performanceTrace: PreviewPerformanceTrace;
  private readonly progressGate = new PreviewProgressGate();
  private readonly retryController = new PreviewPanelRetryController();
  /** Pins source identity, creates session-owned coordinators, and registers host listeners after build capabilities are ready. */
  public constructor(private readonly options: PreviewPanelSessionOptions) {
    this.preparationState = new PreviewPanelPreparationState(options.renderMode);
    this.targetPath = canonicalizeExistingPath(options.initialTarget.request.documentPath);
    this.state.dependencies = createExistingPathIdentitySet([
      options.initialTarget.request.documentPath,
    ]);
    this.performanceTrace = new PreviewPerformanceTrace((trace) => {
      const message = `React preview performance ${JSON.stringify(trace)}`;
      if (trace.durationMs >= 10_000) this.options.log.info(message);
      else this.options.log.debug(message);
    });
    this.contextEnrichment = new PreviewContextEnrichmentCoordinator({
      buildPreview: options.buildPreview,
      callbacks: {
        complete: this.clearBuildExecution.bind(this),
        commit: (target, preview, revision) => {
          const handle = this.commitPreparedPreview(target.documentName, preview, revision, {
            kind: 'context-enrichment',
            owningRevision: revision,
          });
          if (handle.disposition === 'already-displayed') {
            this.preparationState.tryMarkCorridorCommitted();
          }
        },
        isCurrent: this.isCurrentRevision.bind(this),
        reportFailure: (error, target, revision) => {
          const failure = describeBuildFailure(error);
          this.options.log.warn(
            `Selected-context React preview enrichment failed; fast preview retained. Target: ${target.request.documentPath}; mode: ${this.options.renderMode}.${failure.details === undefined ? '' : `\n${failure.details}`}${formatPreviewFrontierMismatchEvidenceSuffix(error)}`,
            error,
          );
          this.performanceTrace.finish('failed', revision);
          rememberPreviewFailureDependencies(
            this.state.dependencies,
            error,
            target.request.workspaceRoot,
          );
          this.renderProgress(revision, target.documentName, 'ready');
        },
        reportSuppressed: (target, revision, retryAfterMs) => {
          const retryMinutes = Math.max(1, Math.ceil(retryAfterMs / 60_000));
          this.options.log.info(
            `Selected-context React preview enrichment skipped for an unchanged graph after a prior resource stall. Fast preview retained. Target: ${target.request.documentPath}; mode: ${this.options.renderMode}; retry window: approximately ${retryMinutes.toString()} minute(s). Edit the target or a captured dependency to retry immediately.`,
          );
          this.renderProgress(revision, target.documentName, 'ready');
        },
      },
      renderMode: options.renderMode,
    });
    this.buildScope = {
      releaseCurrentArtifact: this.releaseCurrentArtifact.bind(this),
      options: this.options,
      documentUri: () => this.documentUri,
      clearBuildExecution: this.clearBuildExecution.bind(this),
      isCurrentRevision: this.isCurrentRevision.bind(this),
      performanceTrace: this.performanceTrace,
      renderTargetIssue: this.renderTargetIssue.bind(this),
      targetsDocument: this.targetsDocument.bind(this),
      inspectorRouteSelection: this.inspectorRouteSelection,
      inspectorPageCandidateSelection: this.inspectorPageCandidateSelection,
      renderProgress: this.renderProgress.bind(this),
      preparationState: this.preparationState,
      releaseArtifact: this.releaseArtifact.bind(this),
      inspectorSelection: this.inspectorSelection,
      commitPreparedPreview: this.commitPreparedPreview.bind(this),
      bindPreparedForegroundApplication: this.bindPreparedForegroundApplication.bind(this),
      settlePreparedApplication: this.settlePreparedApplication.bind(this),
      state: this.state,
      formatFrontierMismatchEvidenceSuffix: formatPreviewFrontierMismatchEvidenceSuffix,
      rollbackInspectorSelection: this.rollbackInspectorSelection.bind(this),
      renderRetryableError: this.renderRetryableError.bind(this),
      retryController: this.retryController,
      targetPath: this.targetPath,
      inspectorSourceGesture: this.inspectorSourceGesture,
      replaceDirectoryWatchers: this.replaceDirectoryWatchers.bind(this),
      startInitialRuntimeWatchdog: this.startInitialRuntimeWatchdog.bind(this),
      releaseSupersededDocumentArtifacts: this.releaseSupersededDocumentArtifacts.bind(this),
      postHotReload: this.postHotReload.bind(this),
      progressGate: this.progressGate,
      publishInspectorSelectionStatuses: this.publishInspectorSelectionStatuses.bind(this),
      replaceWithProgressFallback: this.replaceWithProgressFallback.bind(this),
    };
    this.state.panelDisposables.push(
      this.inspectorSourceDecoration,
      options.panel.onDidDispose(this.handlePanelDisposed.bind(this)),
      options.panel.onDidChangeViewState(this.handleViewStateChanged.bind(this)),
      options.panel.webview.onDidReceiveMessage(this.handleWebviewMessage.bind(this)),
    );
  }
  /** Returns the pinned document URI independently of the currently active editor. */
  public get documentUri(): vscode.Uri {
    return this.options.initialTarget.documentUri;
  }
  /** Reports whether this live session owns the focused preview panel. */
  public get isActive(): boolean {
    return !this.state.disposed && this.options.panel.active;
  }
  /** Queues the initial pinned-source build without waiting for an editor change. */
  public start(): void {
    this.scheduleRefresh(true, this.options.initialTarget);
  }
  /** Requests a fresh pinned-source build immediately. */
  public refresh(): void {
    this.scheduleRefresh(true);
  }
  /** Returns whether a changed canonical file invalidates this preview and schedules its rebuild. */
  public refreshForDocument(documentPath: string): boolean {
    const canonicalDocumentPath = canonicalizeExistingPath(documentPath);
    const belongsToWatchedDirectory = [...this.state.dependencyDirectories].some((directoryPath) =>
      isPreviewPathInside(directoryPath, canonicalDocumentPath),
    );
    if (
      this.state.disposed ||
      (!this.state.dependencies.has(canonicalDocumentPath) && !belongsToWatchedDirectory)
    ) {
      return false;
    }
    this.inspectorSourceDecoration.invalidateDocument(canonicalDocumentPath);
    this.scheduleRefresh(false);
    return true;
  }
  /** Invalidates preparation state after resource-scoped preview configuration changes. */
  public refreshForConfiguration(): void {
    this.scheduleRefresh(false);
  }
  /** Compares a candidate path with the canonical identity pinned by this session. */
  public targetsDocument(documentPath: string): boolean {
    return this.targetPath === canonicalizeExistingPath(documentPath);
  }
  /** Updates compiler-owned source highlights across the supplied visible editors. */
  public refreshInspectorSourceDecoration(editors: readonly vscode.TextEditor[]): void {
    this.inspectorSourceDecoration.applyVisibleEditors(editors);
  }
  /** Routes an authenticated companion-source navigation request through the existing host boundary. */
  public openInspectorCompanionSource(request: PreviewInspectorCompanionOpenSourceRequest): void {
    handlePreviewInspectorCompanionSourceNavigation(request, {
      dependencyPaths: this.state.dependencies,
      enabled: this.options.renderMode === 'page-inspector',
      gestureGate: this.inspectorSourceGesture,
      log: this.options.log,
      panelViewColumn: this.options.panel.viewColumn,
      pinnedDocumentUri: this.documentUri,
    });
  }
  /** Publishes a bounded shared learning snapshot to this Inspector webview. */
  public applySharedInspectorNeuralModel(
    model: PreviewInspectorNeuralModel,
    runtimeRevision = this.state.displayedRuntimeRevision,
  ): void {
    if (this.state.disposed || this.options.renderMode !== 'page-inspector') return;
    try {
      const delivery = this.options.panel.webview.postMessage(
        createPreviewInspectorNeuralModelSnapshot(runtimeRevision, model),
      );
      void Promise.resolve(delivery).catch((error: unknown) => {
        this.options.log.debug(
          'Could not synchronize the shared React Inspector neural model.',
          error,
        );
      });
    } catch (error) {
      this.options.log.debug('Could not post the shared React Inspector neural model.', error);
    }
  }
  /** Disposes the panel and releases its builds, watchers, timers, and artifact leases exactly once. */
  public dispose(): void {
    if (this.state.disposed) {
      return;
    }
    this.finishDisposal();
    this.options.panel.dispose();
    this.notifyDisposed();
  }
  /** Invalidates older work and starts the captured target immediately or after the configured debounce. */
  private scheduleRefresh(
    immediate: boolean,
    capturedTarget?: ResolvedPreviewTarget,
    preservesInspectorSelection = false,
  ): void {
    if (this.state.disposed) {
      return;
    }
    if (!preservesInspectorSelection) {
      const cancelled = this.inspectorSelection.cancelForRefresh(
        'cancelled-by-refresh',
        this.state.displayedRuntimeRevision,
      );
      if (cancelled?.status !== undefined)
        this.publishInspectorSelectionStatuses([cancelled.status]);
      this.inspectorRouteSelection.rollback();
      this.inspectorPageCandidateSelection.rollback();
      this.preparationState.rollbackSelection();
    }
    this.cancelActiveBuild();
    this.performanceTrace.finish('cancelled');
    this.clearRefreshTimer();
    const requestedRevision = ++this.state.revision;
    const controller = new AbortController();
    this.state.activeBuildExecution = { controller, revision: requestedRevision };
    this.renderProgress(
      requestedRevision,
      capturedTarget?.documentName ?? this.options.initialTarget.documentName,
      'resolving-target',
    );
    this.publishInspectorSelectionStatuses(
      this.inspectorSelection.reportProgress(
        requestedRevision,
        'resolving-target',
        this.state.displayedRuntimeRevision,
      ),
    );
    if (immediate) {
      void this.rebuild(requestedRevision, controller.signal, capturedTarget);
      return;
    }
    this.state.refreshTimer = setTimeout(() => {
      this.state.refreshTimer = undefined;
      void this.rebuild(requestedRevision, controller.signal);
    }, readPreviewPanelUpdateDelay(this.documentUri));
  }
  /** Delegates cancellable target resolution and publication while retaining session-owned resource lifetimes. */
  private async rebuild(
    requestedRevision: number,
    signal: AbortSignal,
    capturedTarget?: ResolvedPreviewTarget,
  ): Promise<void> {
    return rebuildPreviewPanelSession(this.buildScope, requestedRevision, signal, capturedTarget);
  }
  /** Admits prepared artifact bytes to browser application without committing unacknowledged selection state. */
  private commitPreparedPreview(
    documentName: string,
    preparedPreview: PreparedPreview,
    requestedRevision: number,
    origin: PreviewPreparedApplicationOrigin = {
      buildRevision: requestedRevision,
      kind: 'foreground',
      requiresContextEnrichment: false,
    },
  ): PreviewPreparedApplicationHandle {
    return commitPreparedPanelPreview(
      this.buildScope,
      documentName,
      preparedPreview,
      requestedRevision,
      origin,
    );
  }
  /** Releases superseded document leases only after their browser transfer is no longer pending. */
  private releaseSupersededDocumentArtifacts(previousArtifactHash: string): void {
    const artifactHashes = new Set([previousArtifactHash]);
    for (const pending of this.state.pendingHotReloads.values()) {
      clearTimeout(pending.timeout);
      artifactHashes.add(pending.previousArtifactHash);
    }
    this.state.pendingHotReloads.clear();
    this.state.pendingSameArtifactRevision = undefined;
    for (const artifactHash of artifactHashes) {
      if (artifactHash !== this.state.artifactHash) this.releaseArtifact(artifactHash);
    }
  }
  /** Posts an exact revision-scoped module update and retains its previous artifact until acknowledgement. */
  private postHotReload(
    previousArtifactHash: string,
    nextArtifactHash: string,
    scriptUri: string,
    stylesheetUri: string | undefined,
    fallbackHtml: string,
    requestedRevision: number,
    runtimeToken: string,
    origin: PreviewPreparedApplicationOrigin,
  ): string {
    this.state.hotReloadSequence += 1;
    const token = `${this.state.hotReloadSequence.toString()}:${nextArtifactHash}`;
    const timeout = setTimeout(() => {
      this.finishHotReload(token, fallbackHtml, 'navigate');
    }, 30_000);
    this.state.pendingHotReloads.set(token, {
      applicationId: token,
      fallbackHtml,
      nextArtifactHash,
      origin,
      previousArtifactHash,
      runtimeRevision: requestedRevision,
      runtimeToken,
      timeout,
    });
    let delivery: Thenable<boolean>;
    try {
      delivery = this.options.panel.webview.postMessage({
        pageContextFrontierId: this.inspectorPageCandidateSelection.currentFrontierId(),
        revision: requestedRevision,
        scriptUri,
        ...(stylesheetUri === undefined ? {} : { stylesheetUri }),
        token,
        type: 'react-preview-hot-reload',
      });
    } catch (error) {
      this.options.log.debug('Could not post a React preview hot reload message.', error);
      this.finishHotReload(token, fallbackHtml, 'undelivered');
      return token;
    }
    void Promise.resolve(delivery).then(
      (delivered) => {
        if (!delivered) {
          this.finishHotReload(token, fallbackHtml, 'undelivered');
        }
      },
      (error: unknown) => {
        this.options.log.debug('React preview hot reload delivery failed.', error);
        this.finishHotReload(token, fallbackHtml, 'undelivered');
      },
    );
    return token;
  }
  /** Publishes revision-scoped progress through the shared gate and guarded fallback delivery. */
  private renderProgress(
    requestedRevision: number,
    documentName: string,
    stage: PreviewProgressStage,
    fallbackHtml?: string,
  ): void {
    renderPreviewPanelProgress(
      this.buildScope,
      requestedRevision,
      documentName,
      stage,
      fallbackHtml,
    );
  }
  /** Validates runtime and Inspector messages before applying host-side effects. */
  private handleWebviewMessage(message: unknown): void {
    const retry = readPreviewRetryRequest(message);
    if (retry !== undefined) {
      this.handleRetryRequest(retry);
      return;
    }
    if (
      handlePreviewInspectorHostMessage(message, {
        currentRuntimeRevision: this.state.displayedRuntimeRevision,
        expectedNeuralRuntimeRevision: this.state.revision,
        dependencyPaths: this.state.dependencies,
        enabled: this.options.renderMode === 'page-inspector',
        expectedPreviewCommand:
          this.options.renderMode === 'page-inspector' ? 'page-inspector' : 'direct-preview',
        gestureGate: this.inspectorSourceGesture,
        log: this.options.log,
        panelViewColumn: this.options.panel.viewColumn,
        pinnedDocumentUri: this.documentUri,
        selectRoute: this.selectInspectorRoute.bind(this),
        selectPageCandidate: this.selectInspectorPageCandidate.bind(this),
        selectPageExecutionRetry: this.selectInspectorPageExecutionRetry.bind(this),
        settleVerifiedTargetOutput: this.retainVerifiedTargetOutput.bind(this),
        sourceDecoration: this.inspectorSourceDecoration,
        synchronizeNeuralResidualModel: (model, runtimeRevision) => {
          this.options.callbacks.onDidSynchronizeNeuralModel?.(this, model, runtimeRevision);
        },
        targetPath: this.targetPath,
      })
    ) {
      return;
    }
    void handlePreviewPanelRuntimeAcknowledgement(message, {
      cancelContextEnrichment: this.contextEnrichment.cancel.bind(this.contextEnrichment),
      clearInitialRuntimeWatchdog: this.clearInitialRuntimeWatchdog.bind(this),
      documentName: this.options.initialTarget.documentName,
      failPreparedApplication: this.failPreparedApplication.bind(this),
      finishHotReload: this.finishHotReload.bind(this),
      finishTrace: this.performanceTrace.finish.bind(this.performanceTrace),
      getInitialRuntime: () => this.state.pendingInitialRuntime,
      getPendingHotReload: (token) => this.state.pendingHotReloads.get(token),
      getSameArtifactRevision: () => this.state.pendingSameArtifactRevision,
      releaseCurrentArtifact: this.releaseCurrentArtifact.bind(this),
      renderReady: (revision, documentName) => {
        this.renderProgress(revision, documentName, 'ready');
      },
      renderRetryableRuntimeFailure: (revision) => {
        this.renderRetryableError(
          {
            message:
              'The generated preview runtime failed before it could render. Retry this preview.',
            title: 'Preview runtime failed',
          },
          revision,
        );
      },
      resolveSettlementRevision: this.resolveRuntimeSettlementRevision.bind(this),
      setDisplayedRuntimeRevision: (revision) => {
        this.state.displayedRuntimeRevision = revision;
      },
      settlePreparedApplication: this.settlePreparedApplication.bind(this),
    });
  }
  /** Retains authenticated target-output evidence only for the matching displayed artifact. */
  private retainVerifiedTargetOutput(health: PreviewRuntimeHealthMessage): void {
    const artifactId = health.artifactId;
    if (artifactId === undefined) return;
    const pendingReplacement = [...this.state.pendingHotReloads.entries()].find(
      ([, pending]) =>
        pending.origin.kind === 'context-enrichment' &&
        pending.previousArtifactHash === artifactId &&
        pending.runtimeRevision === health.runtimeRevision,
    );
    const isDisplayedArtifact = artifactId === this.state.displayedArtifactHash;
    if (!isDisplayedArtifact && pendingReplacement === undefined) {
      this.options.log.warn(
        `React preview observed blocker-free target output from an uncorrelated artifact; optional work was not cancelled. Target: ${this.targetPath}; observed artifact: ${artifactId}; displayed artifact: ${this.state.displayedArtifactHash ?? 'none'}.`,
      );
      return;
    }
    if (this.state.verifiedTargetOutputArtifactHash !== artifactId) {
      this.state.verifiedTargetOutputArtifactHash = artifactId;
      this.options.log.info(
        `React preview retained verified target output and cancelled optional context enrichment. Target: ${this.targetPath}.`,
      );
    }
    this.contextEnrichment.cancel();
    if (pendingReplacement === undefined) return;
    const [token, pending] = pendingReplacement;
    try {
      const delivery = this.options.panel.webview.postMessage(
        createPreviewHotReloadCancellation(pending.runtimeRevision, token),
      );
      void Promise.resolve(delivery).then(
        (delivered) => {
          if (!delivered) {
            this.options.log.warn(
              `React preview could not cancel optional context enrichment before browser commit. Target: ${this.targetPath}.`,
            );
          }
        },
        (error: unknown) => {
          this.options.log.debug(
            'React preview context-enrichment cancellation delivery failed.',
            error,
          );
        },
      );
    } catch (error) {
      this.options.log.debug(
        'Could not post React preview context-enrichment cancellation.',
        error,
      );
    }
  }
  /** Stages a route interaction and rebuilds without discarding the last committed selection. */
  private selectInspectorRoute(request: PreviewInspectorRouteSelectionRequest): void {
    const admission = this.inspectorSelection.beginRoute(request, this.state.revision + 1);
    this.publishInspectorSelectionStatuses(admission.statuses);
    if (!admission.shouldBuild) return;
    if (!this.inspectorRouteSelection.begin(request.selectionPath)) {
      this.rollbackInspectorSelection(this.state.revision + 1, 'already-active');
      return;
    }
    this.preparationState.beginSelection();
    this.contextEnrichment.cancel();
    this.scheduleRefresh(true, undefined, true);
  }
  /** Binds an admitted browser application to the foreground interaction that requested it. */
  private bindPreparedForegroundApplication(
    handle: PreviewPreparedApplicationHandle,
    origin: PreviewPreparedApplicationOrigin,
  ): void {
    if (origin.kind !== 'foreground' || origin.interactionId === undefined) return;
    const binding = this.inspectorSelection.bindPreparedApplication(
      origin.buildRevision,
      handle.applicationId,
      this.state.displayedRuntimeRevision,
    );
    if (binding.status !== undefined) this.publishInspectorSelectionStatuses([binding.status]);
  }
  /** Commits matching browser acknowledgement and starts eligible deferred context enrichment. */
  private settlePreparedApplication(
    applicationId: string,
    origin: PreviewPreparedApplicationOrigin,
    displayedRevision: number,
  ): void {
    if (origin.kind === 'context-enrichment') {
      if (!this.preparationState.tryMarkCorridorCommitted()) {
        this.options.log.debug(
          'Ignored a stale React preview context-enrichment settlement during branch selection.',
        );
        return;
      }
      this.renderProgress(displayedRevision, this.options.initialTarget.documentName, 'ready');
      return;
    }
    if (origin.interactionId !== undefined) {
      const terminal = this.inspectorSelection.commitApplication(applicationId, displayedRevision);
      if (terminal.committed) {
        if (this.inspectorRouteSelection.isPendingSelection) {
          this.inspectorRouteSelection.commit();
          this.inspectorPageCandidateSelection.clear();
        } else {
          this.inspectorPageCandidateSelection.commit();
        }
        this.preparationState.commitSelection();
      }
      if (terminal.status !== undefined) this.publishInspectorSelectionStatuses([terminal.status]);
    } else {
      this.inspectorRouteSelection.commit();
      this.inspectorPageCandidateSelection.commit();
      this.preparationState.commitSelection();
    }
    this.renderProgress(displayedRevision, this.options.initialTarget.documentName, 'ready');
    const enrichmentInput = this.state.pendingContextEnrichmentInputs.get(applicationId);
    this.state.pendingContextEnrichmentInputs.delete(applicationId);
    this.clearBuildExecution(origin.buildRevision);
    if (
      origin.requiresContextEnrichment &&
      enrichmentInput !== undefined &&
      this.isCurrentRevision(origin.buildRevision) &&
      this.state.verifiedTargetOutputArtifactHash !== enrichmentInput.artifactHash
    ) {
      this.contextEnrichment.startAfterCommittedFast(
        enrichmentInput.target,
        enrichmentInput.artifactHash,
        origin.buildRevision,
        enrichmentInput.signal,
      );
    }
  }
  /** Releases failed application inputs and rolls selection back to its committed state. */
  private failPreparedApplication(
    applicationId: string,
    origin: PreviewPreparedApplicationOrigin,
    reason: import('./previewInspectorSelectionStatusProtocol').PreviewInspectorSelectionFailureReason,
    displayedRevision: number,
  ): void {
    if (origin.kind === 'context-enrichment') {
      this.renderProgress(displayedRevision, this.options.initialTarget.documentName, 'ready');
      return;
    }
    this.state.pendingContextEnrichmentInputs.delete(applicationId);
    this.clearBuildExecution(origin.buildRevision);
    this.rollbackInspectorSelection(origin.buildRevision, reason, applicationId, displayedRevision);
  }
  /** Restores committed route and page identities and emits the matching terminal status. */
  private rollbackInspectorSelection(
    buildRevision: number,
    reason: import('./previewInspectorSelectionStatusProtocol').PreviewInspectorSelectionFailureReason,
    applicationId?: string,
    displayedRevision = this.state.displayedRuntimeRevision,
  ): void {
    const terminal =
      applicationId === undefined
        ? this.inspectorSelection.failBuild(buildRevision, reason, displayedRevision)
        : this.inspectorSelection.failApplication(applicationId, reason, displayedRevision);
    this.inspectorRouteSelection.rollback();
    this.inspectorPageCandidateSelection.rollback();
    this.preparationState.rollbackSelection();
    if (terminal.status !== undefined) this.publishInspectorSelectionStatuses([terminal.status]);
  }
  /** Posts bounded interaction statuses and logs synchronous delivery failures. */
  private publishInspectorSelectionStatuses(
    statuses: readonly PreviewInspectorSelectionStatusMessage[],
  ): void {
    postPreviewPanelSelectionStatuses(this.buildScope, statuses);
  }
  /** Stages an authenticated page candidate and schedules its exact rebuild. */
  private selectInspectorPageCandidate(
    request: PreviewInspectorPageCandidateSelectionRequest,
  ): void {
    const admission = this.inspectorSelection.beginPageCandidate(request, this.state.revision + 1);
    this.publishInspectorSelectionStatuses(admission.statuses);
    if (!admission.shouldBuild) return;
    if (!this.inspectorPageCandidateSelection.begin(request.candidateId)) {
      this.rollbackInspectorSelection(this.state.revision + 1, 'already-active');
      return;
    }
    this.preparationState.beginSelection();
    this.contextEnrichment.cancel();
    this.scheduleRefresh(true, undefined, true);
  }
  /** Pins a compiler-recreated execution identity within the requested page candidate. */
  private selectInspectorPageExecutionRetry(
    request: PreviewInspectorPageExecutionRetryRequest,
  ): void {
    const currentCandidateId = this.inspectorPageCandidateSelection.current();
    if (currentCandidateId !== undefined && currentCandidateId !== request.candidateId) return;
    const admission = this.inspectorSelection.beginPageCandidate(
      {
        candidateId: request.candidateId,
        interactionId: request.interactionId,
        runtimeRevision: request.runtimeRevision,
        type: 'react-preview-inspector-page-candidate-selected',
      },
      this.state.revision + 1,
    );
    this.publishInspectorSelectionStatuses(admission.statuses);
    if (!admission.shouldBuild) return;
    if (
      !this.inspectorPageCandidateSelection.beginExecutionCandidate(
        request.executionCandidateId,
        request.candidateId,
        request.restore === true,
      )
    ) {
      this.rollbackInspectorSelection(this.state.revision + 1, 'already-active');
      return;
    }
    this.preparationState.beginSelection();
    this.contextEnrichment.cancel();
    this.scheduleRefresh(true, undefined, true);
  }
  /** Rejects stale retry tokens and restarts preparation from the narrow fast pass. */
  private handleRetryRequest(retry: { readonly revision: number; readonly token: string }): void {
    if (this.state.disposed || !this.retryController.accept(retry)) {
      this.options.log.debug('Ignored a stale or malformed React preview retry request.');
      return;
    }
    // Retry starts from the narrow fast pass; selected-context enrichment can resume after commit.
    this.preparationState.resetForRetry();
    this.scheduleRefresh(true);
  }
  /** Renders an escaped recoverable diagnostic with a revision-bound host retry token. */
  private renderRetryableError(
    errorState: { readonly details?: string; readonly message: string; readonly title: string },
    revision: number,
  ): void {
    renderPreviewPanelRetryableError(this.buildScope, errorState, revision);
  }
  /** Settles one transfer, retaining the previous tree or admitting its guarded document fallback. */
  private finishHotReload(
    token: string,
    fallbackHtml: string | undefined,
    outcome: 'applied' | 'navigate' | 'retained' | 'undelivered',
  ): void {
    const pending = this.state.pendingHotReloads.get(token);
    if (pending === undefined) {
      return;
    }
    this.state.pendingHotReloads.delete(token);
    clearTimeout(pending.timeout);
    if (outcome === 'applied') this.state.displayedArtifactHash = pending.nextArtifactHash;
    const retainedPriorTree =
      outcome === 'retained' ||
      (outcome === 'undelivered' && this.state.artifactHash !== pending.nextArtifactHash);
    if (retainedPriorTree) {
      this.retainPreviousHotReloadArtifact(pending);
      if (outcome === 'undelivered') {
        this.contextEnrichment.cancel();
        this.failPreparedApplication(
          pending.applicationId,
          pending.origin,
          'message-undelivered',
          pending.runtimeRevision,
        );
        this.renderProgress(
          pending.runtimeRevision,
          this.options.initialTarget.documentName,
          'ready',
        );
      }
      return;
    }
    const shouldReplaceDocument =
      (outcome === 'navigate' || outcome === 'undelivered') &&
      fallbackHtml !== undefined &&
      !this.state.disposed &&
      this.state.artifactHash === pending.nextArtifactHash;
    if (shouldReplaceDocument) {
      try {
        this.options.panel.webview.html = fallbackHtml;
        this.startInitialRuntimeWatchdog(
          pending.nextArtifactHash,
          pending.runtimeToken,
          pending.runtimeRevision,
          pending.origin,
          pending.applicationId,
        );
      } catch (error) {
        this.options.log.debug('Could not fall back from React preview hot reload.', error);
        this.retainPreviousHotReloadArtifact(pending);
        this.contextEnrichment.cancel();
        this.failPreparedApplication(
          pending.applicationId,
          pending.origin,
          outcome === 'undelivered' ? 'message-undelivered' : 'hot-reload-timeout',
          pending.runtimeRevision,
        );
        this.renderProgress(
          pending.runtimeRevision,
          this.options.initialTarget.documentName,
          'ready',
        );
        return;
      }
    }
    this.releaseArtifact(pending.previousArtifactHash);
  }
  /** Restores the prior visible artifact lease after an unsuccessful module update. */
  private retainPreviousHotReloadArtifact(pending: PendingPreviewHotReload): void {
    const successor = [...this.state.pendingHotReloads.values()].find(
      (candidate) => candidate.previousArtifactHash === pending.nextArtifactHash,
    );
    if (successor !== undefined) {
      successor.previousArtifactHash = pending.previousArtifactHash;
      this.releaseArtifact(pending.nextArtifactHash);
      return;
    }
    if (this.state.artifactHash === pending.nextArtifactHash) {
      this.state.artifactHash = pending.previousArtifactHash;
      this.releaseArtifact(pending.nextArtifactHash);
      return;
    }
    this.releaseArtifact(pending.previousArtifactHash);
  }
  /** Resolves identical-byte applications to the newest still-owned waiting revision. */
  private resolveRuntimeSettlementRevision(
    artifactHash: string,
    fallbackRevision: number,
    ready: boolean,
  ): number {
    const pending = this.state.pendingSameArtifactRevision;
    if (
      pending?.artifactHash !== artifactHash ||
      !this.isCurrentRevision(pending.revision) ||
      this.state.artifactHash !== artifactHash
    ) {
      return fallbackRevision;
    }
    this.state.pendingSameArtifactRevision = undefined;
    if (ready) {
      this.renderProgress(pending.revision, pending.documentName, 'ready');
    }
    return pending.revision;
  }
  /** Replaces dependency-directory listeners without writing to the workspace. */
  private replaceDirectoryWatchers(nextDirectories: ReadonlySet<string>): void {
    replacePreviewDirectoryWatchers({
      directories: nextDirectories,
      disposablesByPath: this.state.directoryWatcherDisposables,
      log: this.options.log,
      onResource: (resource) => {
        this.refreshForDocument(resource.fsPath);
      },
      pinnedUri: this.documentUri,
    });
  }
  /** Retains the last good preview or renders the first pinned-target diagnostic. */
  private renderTargetIssue(issue: PreviewTargetIssue, requestedRevision: number): void {
    renderPreviewPanelTargetIssue(this.buildScope, issue, requestedRevision);
  }
  /** Completes resource cleanup and notifies the owning controller once. */
  private handlePanelDisposed(): void {
    this.finishDisposal();
    this.notifyDisposed();
  }
  /** Forwards focus only while this panel is active and undisposed. */
  private handleViewStateChanged(): void {
    if (this.isActive) {
      this.options.callbacks.onDidFocus(this);
    }
  }
  /** Rejects publication from disposed or superseded session revisions. */
  private isCurrentRevision(requestedRevision: number): boolean {
    return !this.state.disposed && requestedRevision === this.state.revision;
  }
  /** Aborts owned work and clears stale same-artifact and enrichment inputs. */
  private cancelActiveBuild(): void {
    const activeBuild = this.state.activeBuildExecution;
    this.state.activeBuildExecution = undefined;
    this.contextEnrichment.cancel();
    this.state.pendingSameArtifactRevision = undefined;
    this.state.pendingContextEnrichmentInputs.clear();
    activeBuild?.controller.abort();
  }
  /** Releases the active controller only when its owning revision matches. */
  private clearBuildExecution(requestedRevision: number): void {
    if (this.state.activeBuildExecution?.revision === requestedRevision) {
      this.state.activeBuildExecution = undefined;
    }
  }
  /** Bounds startup to 30 seconds and fails only the matching artifact, token, and revision. */
  private startInitialRuntimeWatchdog(
    artifactHash: string,
    runtimeToken: string,
    revision: number,
    origin: PreviewPreparedApplicationOrigin = {
      buildRevision: revision,
      kind: 'foreground',
      requiresContextEnrichment: false,
    },
    applicationId = runtimeToken,
  ): void {
    this.state.displayedArtifactHash = artifactHash;
    this.state.displayedRuntimeRevision = revision;
    this.clearInitialRuntimeWatchdog();
    const timeout = setTimeout(() => {
      const pending = this.state.pendingInitialRuntime;
      if (
        pending?.artifactHash !== artifactHash ||
        pending.runtimeToken !== runtimeToken ||
        pending.revision !== revision ||
        this.state.disposed ||
        this.state.artifactHash !== artifactHash
      ) {
        return;
      }
      this.state.pendingInitialRuntime = undefined;
      this.contextEnrichment.cancel();
      this.failPreparedApplication(applicationId, origin, 'runtime-timeout', revision);
      this.clearBuildExecution(this.state.revision);
      this.performanceTrace.finish('failed', revision);
      this.releaseCurrentArtifact();
      try {
        this.renderRetryableError(
          {
            message:
              'The generated browser modules did not start. Retry after checking the webview console and local dependencies.',
            title: 'Preview runtime did not start',
          },
          revision,
        );
      } catch (error) {
        this.options.log.debug('Could not render the React preview startup timeout.', error);
      }
    }, 30_000);
    this.state.pendingInitialRuntime = {
      applicationId,
      artifactHash,
      origin,
      revision,
      runtimeToken,
      timeout,
    };
  }
  /** Cancels the owned bootstrap timer and forgets its pending application. */
  private clearInitialRuntimeWatchdog(): void {
    if (this.state.pendingInitialRuntime === undefined) {
      return;
    }
    clearTimeout(this.state.pendingInitialRuntime.timeout);
    this.state.pendingInitialRuntime = undefined;
  }
  /** Recovers failed progress delivery only while the same revision still owns the artifact. */
  private replaceWithProgressFallback(requestedRevision: number, fallbackHtml: string): void {
    if (!this.isCurrentRevision(requestedRevision) || this.state.artifactHash === undefined) {
      return;
    }
    try {
      this.options.panel.webview.html = fallbackHtml;
      const runtimeToken = `${requestedRevision.toString()}:${this.state.artifactHash}`;
      this.startInitialRuntimeWatchdog(this.state.artifactHash, runtimeToken, requestedRevision);
    } catch (error) {
      this.options.log.debug('Could not recover an undelivered React preview status.', error);
    }
  }
  /** Cancels the owned debounce timer and clears its handle. */
  private clearRefreshTimer(): void {
    if (this.state.refreshTimer !== undefined) {
      clearTimeout(this.state.refreshTimer);
      this.state.refreshTimer = undefined;
    }
  }
  /** Invalidates publication and releases every session-owned listener, build, and artifact lease. */
  private finishDisposal(): void {
    if (this.state.disposed) {
      return;
    }
    this.state.disposed = true;
    this.cancelActiveBuild();
    this.performanceTrace.finish('cancelled');
    this.state.revision += 1;
    this.clearRefreshTimer();
    disposePreviewResources(this.state.panelDisposables);
    for (const disposables of this.state.directoryWatcherDisposables.values()) {
      disposePreviewResources(disposables);
    }
    this.state.directoryWatcherDisposables.clear();
    this.releaseCurrentArtifact();
  }
  /** Notifies the owning controller exactly once across competing disposal paths. */
  private notifyDisposed(): void {
    if (this.state.disposalNotified) {
      return;
    }
    this.state.disposalNotified = true;
    this.options.callbacks.onDidDispose(this);
  }
  /** Releases current and pending prior leases and resets per-document retry and import identities. */
  private releaseCurrentArtifact(): void {
    this.clearInitialRuntimeWatchdog();
    this.state.pendingSameArtifactRevision = undefined;
    this.retryController.clear();
    this.state.displayedArtifactHash = undefined;
    this.state.moduleImportMapIdentity = undefined;
    const contentHash = this.state.artifactHash;
    this.state.artifactHash = undefined;
    if (contentHash !== undefined) {
      this.releaseArtifact(contentHash);
    }
    for (const pending of this.state.pendingHotReloads.values()) {
      clearTimeout(pending.timeout);
      this.releaseArtifact(pending.previousArtifactHash);
    }
    this.state.pendingHotReloads.clear();
  }
  /** Releases a published artifact lease while containing synchronous and asynchronous adapter errors. */
  private releaseArtifact(contentHash: string): void {
    try {
      void this.options.buildPreview.releaseArtifact(contentHash).catch((error: unknown) => {
        this.options.log.debug(`Could not release React preview artifact ${contentHash}.`, error);
      });
    } catch (error) {
      this.options.log.debug(`Could not release React preview artifact ${contentHash}.`, error);
    }
  }
}
