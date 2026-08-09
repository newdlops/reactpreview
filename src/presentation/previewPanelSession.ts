/* eslint-disable jsdoc/require-jsdoc */
import * as vscode from 'vscode';
import type { PreparedPreview } from '../domain/preview';
import {
  isPreviewBuildCancellation,
  isPreviewBuildStall,
  isPreviewFrontierMismatchEvidence,
} from '../domain/previewBuildExecution';
import {
  formatPreviewCompilerActivity,
  formatPreviewFrontierMismatchEvidence,
} from './previewCompilerActivityLog';
import type { PreviewProgressStage } from '../domain/previewProgress';
import { canonicalizeExistingPath, createExistingPathIdentitySet } from '../shared/pathIdentity';
import type { PreviewTargetIssue, ResolvedPreviewTarget } from './activePreviewTarget';
import { describeBuildFailure, formatDiagnostic } from './previewFailure';
import { PreviewContextEnrichmentCoordinator } from './previewContextEnrichment';
import { createPreviewPanelTitle } from './previewPanelTitle';
import { PreviewPanelRouteSelection } from './previewPanelRouteSelection';
import { PreviewPanelPageCandidateSelection } from './previewPanelPageCandidateSelection';
import { PreviewPanelRetryController } from './previewPanelRetryController';
import { PreviewPanelPreparationState } from './previewPanelPreparationState';
import { PreviewPanelInspectorSelectionController } from './previewPanelInspectorSelectionController';
import { PreviewPerformanceTrace } from './previewPerformanceTrace';
import { preparePreviewFirstPaint } from './previewFirstPaint';
import {
  createHotReloadScriptUri,
  createPreviewHotReloadCancellation,
  type PendingPreviewHotReload,
} from './previewHotReloadProtocol';
import { handlePreviewPanelRuntimeAcknowledgement } from './previewPanelRuntimeAcknowledgement';
import { readPreviewRetryRequest } from './previewRetryProtocol';
import type { PreviewInspectorCompanionOpenSourceRequest } from './previewInspectorCompanionProtocol';
import { handlePreviewInspectorHostMessage } from './previewInspectorHostMessage';
import { handlePreviewInspectorCompanionSourceNavigation } from './previewInspectorSourceNavigation';
import { PreviewInspectorSourceDecoration } from './previewInspectorSourceDecoration';
import { PreviewInspectorGestureGate } from './previewInspectorGestureGate';
import { createPreviewProgressMessage } from './previewProgress';
import type {
  PreviewPreparedApplicationHandle,
  PreviewPreparedApplicationOrigin,
} from './previewPreparedApplication';
import type { PreviewInspectorPageCandidateSelectionRequest } from './previewInspectorPageCandidateSelectionProtocol';
import type { PreviewInspectorPageExecutionRetryRequest } from './previewInspectorPageExecutionRetryProtocol';
import type { PreviewInspectorRouteSelectionRequest } from './previewInspectorRouteSelectionProtocol';
import type { PreviewInspectorSelectionStatusMessage } from './previewInspectorSelectionStatusProtocol';
import type { PreviewRuntimeHealthMessage } from './previewRuntimeHealthProtocol';
import { PreviewProgressGate } from './previewProgressGate';
import type {
  ActivePreviewBuildExecution,
  PendingPreviewInitialRuntime,
  PendingSamePreviewArtifactRevision,
} from './previewPanelSessionState';
import type { PreviewPanelSessionOptions } from './previewPanelSessionTypes';
import {
  disposePreviewResources,
  isPreviewPathInside,
  rememberPreviewFailureDependencies,
  replacePreviewDirectoryWatchers,
} from './previewPanelSessionUtilities';
import { createPreviewHtml } from './webview/previewHtml';
export type {
  PinnedPreviewTargetResolver,
  PreviewBuildService,
  PreviewPanelSessionCallbacks,
  PreviewPanelSessionOptions,
} from './previewPanelSessionTypes';
// prettier-ignore
export class PreviewPanelSession implements vscode.Disposable {
  public readonly targetPath: string;
  private artifactHash: string | undefined;
  private activeBuildExecution: ActivePreviewBuildExecution | undefined;
  private readonly contextEnrichment: PreviewContextEnrichmentCoordinator;
  private dependencies: Set<string>;
  private dependencyDirectories = new Set<string>();
  private readonly directoryWatcherDisposables = new Map<string, vscode.Disposable[]>();
  private disposed = false;
  private disposalNotified = false;
  private displayedArtifactHash: string | undefined;
  private displayedRuntimeRevision = 0;
  private moduleImportMapIdentity: string | undefined;
  private readonly preparationState = new PreviewPanelPreparationState();
  private readonly inspectorRouteSelection = new PreviewPanelRouteSelection();
  private readonly inspectorPageCandidateSelection = new PreviewPanelPageCandidateSelection();
  private readonly inspectorSelection = new PreviewPanelInspectorSelectionController();
  private readonly inspectorSourceDecoration = new PreviewInspectorSourceDecoration();
  private readonly inspectorSourceGesture = new PreviewInspectorGestureGate();
  private readonly panelDisposables: vscode.Disposable[] = [];
  private readonly pendingHotReloads = new Map<string, PendingPreviewHotReload>();
  private readonly pendingContextEnrichmentInputs = new Map<
    string,
    {
      readonly artifactHash: string;
      readonly signal: AbortSignal;
      readonly target: ResolvedPreviewTarget;
    }
  >();
  private readonly performanceTrace: PreviewPerformanceTrace;
  private readonly progressGate = new PreviewProgressGate();
  private pendingInitialRuntime: PendingPreviewInitialRuntime | undefined;
  private readonly retryController = new PreviewPanelRetryController();
  private pendingSameArtifactRevision: PendingSamePreviewArtifactRevision | undefined;
  private refreshTimer: ReturnType<typeof setTimeout> | undefined;
  private revision = 0;
  private hotReloadSequence = 0;
  private verifiedTargetOutputArtifactHash: string | undefined;
  public constructor(private readonly options: PreviewPanelSessionOptions) {
    this.targetPath = canonicalizeExistingPath(options.initialTarget.request.documentPath);
    this.dependencies = createExistingPathIdentitySet([options.initialTarget.request.documentPath]);
    this.performanceTrace = new PreviewPerformanceTrace((trace) => {
      this.options.log.debug(`React preview performance ${JSON.stringify(trace)}`);
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
          if (handle.disposition === 'already-displayed') this.preparationState.markCorridorCommitted();
        },
        isCurrent: this.isCurrentRevision.bind(this),
        reportFailure: (error, target, revision) => {
          const failure = describeBuildFailure(error);
          this.options.log.warn(
            `Selected-context React preview enrichment failed; fast preview retained. Target: ${target.request.documentPath}; mode: ${this.options.renderMode}.${failure.details === undefined ? '' : `\n${failure.details}`}${this.formatFrontierMismatchEvidenceSuffix(error)}`,
            error,
          );
          this.performanceTrace.finish('failed', revision);
          rememberPreviewFailureDependencies(this.dependencies, error, target.request.workspaceRoot);
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
    this.panelDisposables.push(
      this.inspectorSourceDecoration,
      options.panel.onDidDispose(this.handlePanelDisposed.bind(this)),
      options.panel.onDidChangeViewState(this.handleViewStateChanged.bind(this)),
      options.panel.webview.onDidReceiveMessage(this.handleWebviewMessage.bind(this)),
    );
  }
  public get documentUri(): vscode.Uri {
    return this.options.initialTarget.documentUri;
  }
  public get isActive(): boolean {
    return !this.disposed && this.options.panel.active;
  }
  public start(): void {
    this.scheduleRefresh(true, this.options.initialTarget);
  }
  public refresh(): void {
    this.scheduleRefresh(true);
  }
  public refreshForDocument(documentPath: string): boolean {
    const canonicalDocumentPath = canonicalizeExistingPath(documentPath);
    const belongsToWatchedDirectory = [...this.dependencyDirectories].some((directoryPath) => isPreviewPathInside(directoryPath, canonicalDocumentPath));
    if (this.disposed || (!this.dependencies.has(canonicalDocumentPath) && !belongsToWatchedDirectory)) {
      return false;
    }
    this.inspectorSourceDecoration.invalidateDocument(canonicalDocumentPath);
    this.scheduleRefresh(false);
    return true;
  }
  public refreshForConfiguration(): void {
    this.scheduleRefresh(false);
  }
  public targetsDocument(documentPath: string): boolean {
    return this.targetPath === canonicalizeExistingPath(documentPath);
  }
  public refreshInspectorSourceDecoration(editors: readonly vscode.TextEditor[]): void {
    this.inspectorSourceDecoration.applyVisibleEditors(editors);
  }
  public openInspectorCompanionSource(request: PreviewInspectorCompanionOpenSourceRequest): void {
    handlePreviewInspectorCompanionSourceNavigation(request, {
      dependencyPaths: this.dependencies,
      enabled: this.options.renderMode === 'page-inspector',
      gestureGate: this.inspectorSourceGesture,
      log: this.options.log,
      panelViewColumn: this.options.panel.viewColumn,
      pinnedDocumentUri: this.documentUri,
    });
  }
  public dispose(): void {
    if (this.disposed) {
      return;
    }
    this.finishDisposal();
    this.options.panel.dispose();
    this.notifyDisposed();
  }
  private scheduleRefresh(immediate: boolean, capturedTarget?: ResolvedPreviewTarget, preservesInspectorSelection = false): void {
    if (this.disposed) {
      return;
    }
    if (!preservesInspectorSelection) {
      const cancelled = this.inspectorSelection.cancelForRefresh('cancelled-by-refresh', this.displayedRuntimeRevision);
      if (cancelled?.status !== undefined) this.publishInspectorSelectionStatuses([cancelled.status]);
      this.inspectorRouteSelection.rollback();
      this.inspectorPageCandidateSelection.rollback();
      this.preparationState.rollbackSelection();
    }
    this.cancelActiveBuild();
    this.performanceTrace.finish('cancelled');
    this.clearRefreshTimer();
    const requestedRevision = ++this.revision;
    const controller = new AbortController();
    this.activeBuildExecution = { controller, revision: requestedRevision };
    this.renderProgress(requestedRevision, capturedTarget?.documentName ?? this.options.initialTarget.documentName, 'resolving-target');
    this.publishInspectorSelectionStatuses(this.inspectorSelection.reportProgress(requestedRevision, 'resolving-target', this.displayedRuntimeRevision));
    if (immediate) {
      void this.rebuild(requestedRevision, controller.signal, capturedTarget);
      return;
    }
    this.refreshTimer = setTimeout(() => {
      this.refreshTimer = undefined;
      void this.rebuild(requestedRevision, controller.signal);
    }, this.getUpdateDelay());
  }
  private async rebuild(requestedRevision: number, signal: AbortSignal, capturedTarget?: ResolvedPreviewTarget): Promise<void> {
    let target: PreviewTargetIssue | ResolvedPreviewTarget;
    let awaitingBrowserApplication = false;
    try {
      target = capturedTarget ?? (await this.options.resolveTarget(this.documentUri, signal));
    } catch (error) {
      if (isPreviewBuildCancellation(error, signal)) {
        this.clearBuildExecution(requestedRevision);
        return;
      }
      if (!this.isCurrentRevision(requestedRevision)) {
        this.clearBuildExecution(requestedRevision);
        return;
      }
      this.options.log.error('React preview target resolution failed.', error);
      this.performanceTrace.finish('failed', requestedRevision);
      this.renderTargetIssue(
        {
          message: 'The pinned source file could not be reopened. Check the file and refresh this preview.',
          title: 'Preview target unavailable',
        },
        requestedRevision,
      );
      this.clearBuildExecution(requestedRevision);
      return;
    }
    if (!this.isCurrentRevision(requestedRevision)) {
      this.clearBuildExecution(requestedRevision);
      return;
    }
    if (signal.aborted) {
      this.clearBuildExecution(requestedRevision);
      return;
    }
    if ('title' in target) {
      this.performanceTrace.finish('failed', requestedRevision);
      this.renderTargetIssue(target, requestedRevision);
      this.clearBuildExecution(requestedRevision);
      return;
    }
    if (!this.targetsDocument(target.request.documentPath)) {
      this.performanceTrace.finish('failed', requestedRevision);
      this.renderTargetIssue(
        {
          message: 'The pinned preview target changed identity and was not followed.',
          title: 'Preview target changed',
        },
        requestedRevision,
      );
      this.clearBuildExecution(requestedRevision);
      return;
    }
    const routeTarget = this.inspectorRouteSelection.applyTo(target);
    const buildTarget = this.inspectorRouteSelection.isPendingSelection ? routeTarget : this.inspectorPageCandidateSelection.applyTo(routeTarget);
    this.options.panel.title = createPreviewPanelTitle(buildTarget.request.documentPath);
    try {
      const firstPaint = await preparePreviewFirstPaint({
        buildPreview: this.options.buildPreview,
        context: {
          reportProgress: (stage, activity) => {
            if (activity !== undefined)
              this.options.log.debug(formatPreviewCompilerActivity(activity));
            this.renderProgress(requestedRevision, target.documentName, stage);
          },
          signal,
        },
        preparationMode: this.preparationState.current,
        renderMode: this.options.renderMode,
        request: buildTarget.request,
      });
      const preparedPreview = firstPaint.preparedPreview;
      if (!this.isCurrentRevision(requestedRevision)) {
        this.releaseArtifact(preparedPreview.artifact.contentHash);
        this.inspectorRouteSelection.rollback();
        this.preparationState.rollbackSelection();
        return;
      }
      try {
        this.renderProgress(requestedRevision, target.documentName, 'loading-preview');
        const interactionId = this.inspectorSelection.currentBuildRevision() === requestedRevision ? this.inspectorSelection.currentInteractionId() : undefined;
        const origin: PreviewPreparedApplicationOrigin = {
          buildRevision: requestedRevision,
          ...(interactionId === undefined ? {} : { interactionId }),
          kind: 'foreground',
          requiresContextEnrichment: firstPaint.requiresContextEnrichment,
        };
        const handle = this.commitPreparedPreview(target.documentName, preparedPreview, requestedRevision, origin);
        this.bindPreparedForegroundApplication(handle, origin);
        if (handle.disposition === 'already-displayed') {
          this.settlePreparedApplication(handle.applicationId, origin, requestedRevision);
        } else {
          awaitingBrowserApplication = true;
          if (origin.requiresContextEnrichment) {
            this.pendingContextEnrichmentInputs.set(handle.applicationId, {
              artifactHash: preparedPreview.artifact.contentHash,
              signal,
              target: buildTarget,
            });
          }
        }
      } catch (error) {
        this.releaseArtifact(preparedPreview.artifact.contentHash);
        throw error;
      }
    } catch (error) {
      if (isPreviewBuildCancellation(error, signal)) {
        this.inspectorRouteSelection.rollback();
        this.preparationState.rollbackSelection();
        return;
      }
      if (!this.isCurrentRevision(requestedRevision)) {
        this.inspectorRouteSelection.rollback();
        this.preparationState.rollbackSelection();
        return;
      }
      const failure = describeBuildFailure(error);
      if (isPreviewBuildStall(error) && error.activity !== undefined)
        this.options.log.debug(formatPreviewCompilerActivity(error.activity));
      this.options.log.error(
        `React preview build failed; retaining the last good preview. Target: ${target.request.documentPath}; mode: ${this.options.renderMode}.${failure.details === undefined ? '' : `\n${failure.details}`}${this.formatFrontierMismatchEvidenceSuffix(error)}`,
        error,
      );
      this.performanceTrace.finish('failed', requestedRevision);
      this.rollbackInspectorSelection(requestedRevision, 'build-failed');
      rememberPreviewFailureDependencies(this.dependencies, error, target.request.workspaceRoot);
      if (this.artifactHash === undefined) {
        this.renderRetryableError(
          {
            message: failure.message,
            title: 'Preview build failed',
            ...(failure.details === undefined ? {} : { details: failure.details }),
          },
          requestedRevision,
        );
      } else {
        this.renderProgress(requestedRevision, target.documentName, 'ready');
      }
    } finally {
      if (!awaitingBrowserApplication) this.clearBuildExecution(requestedRevision);
    }
  }
  private formatFrontierMismatchEvidenceSuffix(error: unknown): string {
    return isPreviewBuildStall(error) && error.reason === 'frontier-mismatch' && isPreviewFrontierMismatchEvidence(error.frontierMismatchEvidence) ? `\n${formatPreviewFrontierMismatchEvidence(error.frontierMismatchEvidence)}` : '';
  }
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
    this.retryController.clear();
    const nextDependencies = createExistingPathIdentitySet([this.targetPath, ...preparedPreview.dependencies]);
    this.inspectorSourceGesture.configure(preparedPreview.inspectorSourceGestureSecret);
    const nextDependencyDirectories = new Set(preparedPreview.watchDirectories.map(canonicalizeExistingPath));
    for (const diagnostic of preparedPreview.diagnostics) {
      this.options.log.warn(formatDiagnostic(diagnostic));
    }
    const publishedScriptUri = this.options.panel.webview
      .asWebviewUri(vscode.Uri.parse(preparedPreview.artifact.scriptLocation, true))
      .toString(true);
    const scriptUri = createHotReloadScriptUri(
      publishedScriptUri,
      requestedRevision,
      preparedPreview.artifact.contentHash,
    );
    const stylesheetLocation = preparedPreview.artifact.stylesheetLocation;
    const stylesheetUri =
      stylesheetLocation === undefined ? undefined : this.options.panel.webview.asWebviewUri(vscode.Uri.parse(stylesheetLocation, true)).toString(true);
    const publicAssetUri =
      preparedPreview.publicAssetRoot === undefined
        ? undefined
        : this.documentUri.with({
            path: vscode.Uri.file(preparedPreview.publicAssetRoot).path,
          });
    if (this.options.artifactResourceRoot !== undefined) {
      this.options.panel.webview.options = {
        ...this.options.panel.webview.options,
        localResourceRoots:
          publicAssetUri === undefined
            ? [this.options.artifactResourceRoot]
            : [this.options.artifactResourceRoot, publicAssetUri],
      };
    }
    const publicAssetBaseUri =
      publicAssetUri === undefined
        ? undefined
        : `${this.options.panel.webview
            .asWebviewUri(publicAssetUri)
            .toString(true)
            .replace(/\/+$/u, '')}/`;
    const moduleImports = preparedPreview.artifact.moduleImports?.map(
      ({ scriptLocation, specifier }) => ({
        specifier,
        uri: this.options.panel.webview
          .asWebviewUri(vscode.Uri.parse(scriptLocation, true))
          .toString(true),
      }),
    );
    const nextModuleImportMapIdentity = createModuleImportMapIdentity(moduleImports);
    const baseState = {
      documentName,
      kind: 'ready' as const,
      ...(moduleImports === undefined ? {} : { moduleImports }),
      runtimeRevision: requestedRevision,
      runtimeToken: `${requestedRevision.toString()}:${preparedPreview.artifact.contentHash}`,
      scriptUri,
      ...(preparedPreview.publicApplicationOrigin === undefined
        ? {}
        : { publicApplicationOrigin: preparedPreview.publicApplicationOrigin }),
      ...(publicAssetBaseUri === undefined ? {} : { publicAssetBaseUri }),
    };
    const nextHtml = createPreviewHtml(
      this.options.panel.webview.cspSource,
      stylesheetUri === undefined
        ? baseState
        : {
            ...baseState,
            stylesheetUri,
          },
    );
    const previousArtifactHash = this.artifactHash;
    if (previousArtifactHash === preparedPreview.artifact.contentHash) {
      this.dependencies = nextDependencies;
      this.dependencyDirectories = nextDependencyDirectories;
      this.replaceDirectoryWatchers(nextDependencyDirectories);
      this.releaseArtifact(preparedPreview.artifact.contentHash);
      const awaitsSharedRuntime =
        this.pendingInitialRuntime?.artifactHash === previousArtifactHash ||
        [...this.pendingHotReloads.values()].some((pending) => pending.nextArtifactHash === previousArtifactHash);
      if (awaitsSharedRuntime) {
        const sharedInitialRuntime = this.pendingInitialRuntime?.artifactHash === previousArtifactHash ? this.pendingInitialRuntime : undefined;
        const sharedApplication =
          sharedInitialRuntime ?? [...this.pendingHotReloads.values()].find((pending) => pending.nextArtifactHash === previousArtifactHash);
        if (sharedApplication === undefined) throw new Error('Missing shared preview application.');
        this.pendingSameArtifactRevision = {
          applicationId: sharedApplication.applicationId,
          artifactHash: previousArtifactHash,
          documentName,
          origin,
          revision: requestedRevision,
        };
        return {
          applicationId: sharedApplication.applicationId,
          disposition: sharedInitialRuntime === undefined ? 'awaiting-hot-reload' : 'awaiting-runtime',
        };
      } else {
        this.renderProgress(requestedRevision, documentName, 'ready', nextHtml);
      }
      return {
        applicationId: `displayed:${previousArtifactHash}`,
        disposition: 'already-displayed',
      };
    }
    const requiresDocumentNavigation =
      previousArtifactHash === undefined ||
      this.moduleImportMapIdentity !== nextModuleImportMapIdentity;
    const hotScriptUri = requiresDocumentNavigation ? undefined : scriptUri;
    if (requiresDocumentNavigation) {
      // Do not accept the incoming lease until VS Code accepts the initial complete document.
      this.options.panel.webview.html = nextHtml;
    }
    this.dependencies = nextDependencies;
    this.dependencyDirectories = nextDependencyDirectories;
    this.artifactHash = preparedPreview.artifact.contentHash;
    this.replaceDirectoryWatchers(nextDependencyDirectories);
    if (requiresDocumentNavigation) {
      this.moduleImportMapIdentity = nextModuleImportMapIdentity;
      this.startInitialRuntimeWatchdog(preparedPreview.artifact.contentHash, baseState.runtimeToken, requestedRevision, origin);
      if (previousArtifactHash !== undefined) {
        this.options.log.debug('React preview replaced the webview document because its browser import map changed.');
        this.releaseSupersededDocumentArtifacts(previousArtifactHash);
      }
      return { applicationId: baseState.runtimeToken, disposition: 'awaiting-runtime' };
    }
    if (previousArtifactHash !== undefined && hotScriptUri !== undefined) {
      const applicationId = this.postHotReload(
        previousArtifactHash,
        preparedPreview.artifact.contentHash,
        hotScriptUri,
        stylesheetUri,
        nextHtml,
        requestedRevision,
        baseState.runtimeToken,
        origin,
      );
      return { applicationId, disposition: 'awaiting-hot-reload' };
    }
    return { applicationId: baseState.runtimeToken, disposition: 'awaiting-runtime' };
  }
  private releaseSupersededDocumentArtifacts(previousArtifactHash: string): void {
    const artifactHashes = new Set([previousArtifactHash]);
    for (const pending of this.pendingHotReloads.values()) {
      clearTimeout(pending.timeout);
      artifactHashes.add(pending.previousArtifactHash);
    }
    this.pendingHotReloads.clear();
    this.pendingSameArtifactRevision = undefined;
    for (const artifactHash of artifactHashes) {
      if (artifactHash !== this.artifactHash) this.releaseArtifact(artifactHash);
    }
  }
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
    this.hotReloadSequence += 1;
    const token = `${this.hotReloadSequence.toString()}:${nextArtifactHash}`;
    const timeout = setTimeout(() => {
      this.finishHotReload(token, fallbackHtml, 'navigate');
    }, 30_000);
    this.pendingHotReloads.set(token, {
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
  private renderProgress(requestedRevision: number, documentName: string, stage: PreviewProgressStage, fallbackHtml?: string): void {
    if (!this.isCurrentRevision(requestedRevision) || !this.progressGate.accept(requestedRevision, stage)) {
      return;
    }
    this.performanceTrace.transition(requestedRevision, documentName, stage);
    this.publishInspectorSelectionStatuses(this.inspectorSelection.reportProgress(requestedRevision, stage, this.displayedRuntimeRevision));
    if (this.artifactHash === undefined) {
      if (stage === 'ready') {
        return;
      }
      try {
        this.options.panel.webview.html = createPreviewHtml(this.options.panel.webview.cspSource, {
          documentName,
          kind: 'loading',
          stage,
        });
      } catch (error) {
        this.options.log.debug('Could not update initial React preview progress.', error);
      }
      return;
    }
    try {
      const delivery = this.options.panel.webview.postMessage(createPreviewProgressMessage(stage, requestedRevision));
      void Promise.resolve(delivery).then(
        (delivered) => {
          if (!delivered && fallbackHtml !== undefined) {
            this.replaceWithProgressFallback(requestedRevision, fallbackHtml);
          }
        },
        (error: unknown) => {
          this.options.log.debug('Could not update React preview progress.', error);
          if (fallbackHtml !== undefined) {
            this.replaceWithProgressFallback(requestedRevision, fallbackHtml);
          }
        },
      );
    } catch (error) {
      this.options.log.debug('Could not post React preview progress.', error);
      if (fallbackHtml !== undefined) {
        this.replaceWithProgressFallback(requestedRevision, fallbackHtml);
      }
    }
  }
  private handleWebviewMessage(message: unknown): void {
    const retry = readPreviewRetryRequest(message);
    if (retry !== undefined) {
      this.handleRetryRequest(retry);
      return;
    }
    if (
      handlePreviewInspectorHostMessage(message, {
        currentRuntimeRevision: this.displayedRuntimeRevision,
        dependencyPaths: this.dependencies,
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
      getInitialRuntime: () => this.pendingInitialRuntime,
      getPendingHotReload: (token) => this.pendingHotReloads.get(token),
      getSameArtifactRevision: () => this.pendingSameArtifactRevision,
      releaseCurrentArtifact: this.releaseCurrentArtifact.bind(this),
      renderReady: (revision, documentName) => { this.renderProgress(revision, documentName, 'ready'); },
      renderRetryableRuntimeFailure: (revision) =>
        { this.renderRetryableError(
          {
            message: 'The generated preview runtime failed before it could render. Retry this preview.',
            title: 'Preview runtime failed',
          },
          revision,
        ); },
      resolveSettlementRevision: this.resolveRuntimeSettlementRevision.bind(this),
      setDisplayedRuntimeRevision: (revision) => {
        this.displayedRuntimeRevision = revision;
      },
      settlePreparedApplication: this.settlePreparedApplication.bind(this),
    });
  }
  private retainVerifiedTargetOutput(health: PreviewRuntimeHealthMessage): void {
    const artifactId = health.artifactId;
    if (artifactId === undefined) return;
    const pendingReplacement = [...this.pendingHotReloads.entries()].find(
      ([, pending]) =>
        pending.origin.kind === 'context-enrichment' &&
        pending.previousArtifactHash === artifactId &&
        pending.runtimeRevision === health.runtimeRevision,
    );
    const isDisplayedArtifact = artifactId === this.displayedArtifactHash;
    if (!isDisplayedArtifact && pendingReplacement === undefined) {
      this.options.log.warn(
        `React preview observed blocker-free target output from an uncorrelated artifact; optional work was not cancelled. Target: ${this.targetPath}; observed artifact: ${artifactId}; displayed artifact: ${this.displayedArtifactHash ?? 'none'}.`,
      );
      return;
    }
    if (this.verifiedTargetOutputArtifactHash !== artifactId) {
      this.verifiedTargetOutputArtifactHash = artifactId;
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
          this.options.log.debug('React preview context-enrichment cancellation delivery failed.', error);
        },
      );
    } catch (error) {
      this.options.log.debug('Could not post React preview context-enrichment cancellation.', error);
    }
  }
  private selectInspectorRoute(request: PreviewInspectorRouteSelectionRequest): void {
    const admission = this.inspectorSelection.beginRoute(request, this.revision + 1);
    this.publishInspectorSelectionStatuses(admission.statuses);
    if (!admission.shouldBuild) return;
    if (!this.inspectorRouteSelection.begin(request.selectionPath)) {
      this.rollbackInspectorSelection(this.revision + 1, 'already-active');
      return;
    }
    this.preparationState.beginSelection();
    this.contextEnrichment.cancel();
    this.scheduleRefresh(true, undefined, true);
  }
  private bindPreparedForegroundApplication(handle: PreviewPreparedApplicationHandle, origin: PreviewPreparedApplicationOrigin): void {
    if (origin.kind !== 'foreground' || origin.interactionId === undefined) return;
    const binding = this.inspectorSelection.bindPreparedApplication(origin.buildRevision, handle.applicationId, this.displayedRuntimeRevision);
    if (binding.status !== undefined) this.publishInspectorSelectionStatuses([binding.status]);
  }
  private settlePreparedApplication(applicationId: string, origin: PreviewPreparedApplicationOrigin, displayedRevision: number): void {
    if (origin.kind === 'context-enrichment') {
      this.preparationState.markCorridorCommitted();
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
    const enrichmentInput = this.pendingContextEnrichmentInputs.get(applicationId);
    this.pendingContextEnrichmentInputs.delete(applicationId);
    this.clearBuildExecution(origin.buildRevision);
    if (
      origin.requiresContextEnrichment &&
      enrichmentInput !== undefined &&
      this.isCurrentRevision(origin.buildRevision) &&
      this.verifiedTargetOutputArtifactHash !== enrichmentInput.artifactHash
    ) {
      this.contextEnrichment.startAfterCommittedFast(enrichmentInput.target, enrichmentInput.artifactHash, origin.buildRevision, enrichmentInput.signal);
    }
  }
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
    this.pendingContextEnrichmentInputs.delete(applicationId);
    this.clearBuildExecution(origin.buildRevision);
    this.rollbackInspectorSelection(origin.buildRevision, reason, applicationId, displayedRevision);
  }
  private rollbackInspectorSelection(
    buildRevision: number,
    reason: import('./previewInspectorSelectionStatusProtocol').PreviewInspectorSelectionFailureReason,
    applicationId?: string,
    displayedRevision = this.displayedRuntimeRevision,
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
  private publishInspectorSelectionStatuses(statuses: readonly PreviewInspectorSelectionStatusMessage[]): void {
    for (const status of statuses) {
      try {
        void this.options.panel.webview.postMessage(status);
      } catch (error) {
        this.options.log.debug('Could not post React Inspector selection status.', error);
      }
    }
  }
  private selectInspectorPageCandidate(request: PreviewInspectorPageCandidateSelectionRequest): void {
    const admission = this.inspectorSelection.beginPageCandidate(request, this.revision + 1);
    this.publishInspectorSelectionStatuses(admission.statuses);
    if (!admission.shouldBuild) return;
    if (!this.inspectorPageCandidateSelection.begin(request.candidateId)) {
      this.rollbackInspectorSelection(this.revision + 1, 'already-active');
      return;
    }
    this.preparationState.beginSelection();
    this.contextEnrichment.cancel();
    this.scheduleRefresh(true, undefined, true);
  }
  private selectInspectorPageExecutionRetry(
    request: PreviewInspectorPageExecutionRetryRequest,
  ): void {
    if (this.inspectorPageCandidateSelection.current() !== request.candidateId) return;
    const admission = this.inspectorSelection.beginPageCandidate(
      {
        candidateId: request.candidateId,
        interactionId: request.interactionId,
        runtimeRevision: request.runtimeRevision,
        type: 'react-preview-inspector-page-candidate-selected',
      },
      this.revision + 1,
    );
    this.publishInspectorSelectionStatuses(admission.statuses);
    if (!admission.shouldBuild) return;
    if (!this.inspectorPageCandidateSelection.beginExecutionCandidate(request.executionCandidateId)) {
      this.rollbackInspectorSelection(this.revision + 1, 'already-active');
      return;
    }
    this.preparationState.beginSelection();
    this.contextEnrichment.cancel();
    this.scheduleRefresh(true, undefined, true);
  }
  private handleRetryRequest(retry: { readonly revision: number; readonly token: string }): void {
    if (this.disposed || !this.retryController.accept(retry)) {
      this.options.log.debug('Ignored a stale or malformed React preview retry request.');
      return;
    }
    // Retry starts from the narrow fast pass; selected-context enrichment can resume after commit.
    this.preparationState.resetForRetry();
    this.scheduleRefresh(true);
  }
  private renderRetryableError(errorState: { readonly details?: string; readonly message: string; readonly title: string }, revision: number): void {
    const retry = this.retryController.create(revision);
    try {
      this.options.panel.webview.html = createPreviewHtml(this.options.panel.webview.cspSource, {
        kind: 'error',
        message: errorState.message,
        retry,
        title: errorState.title,
        ...(errorState.details === undefined ? {} : { details: errorState.details }),
      });
    } catch (error) {
      this.options.log.debug('Could not render a retryable React preview error.', error);
    }
  }
  private finishHotReload(token: string, fallbackHtml: string | undefined, outcome: 'applied' | 'navigate' | 'retained' | 'undelivered'): void {
    const pending = this.pendingHotReloads.get(token);
    if (pending === undefined) {
      return;
    }
    this.pendingHotReloads.delete(token);
    clearTimeout(pending.timeout);
    if (outcome === 'applied') this.displayedArtifactHash = pending.nextArtifactHash;
    const retainedPriorTree = outcome === 'retained' || (outcome === 'undelivered' && this.artifactHash !== pending.nextArtifactHash);
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
        this.renderProgress(pending.runtimeRevision, this.options.initialTarget.documentName, 'ready');
      }
      return;
    }
    const shouldReplaceDocument =
      (outcome === 'navigate' || outcome === 'undelivered') && fallbackHtml !== undefined && !this.disposed && this.artifactHash === pending.nextArtifactHash;
    if (shouldReplaceDocument) {
      try {
        this.options.panel.webview.html = fallbackHtml;
        this.startInitialRuntimeWatchdog(pending.nextArtifactHash, pending.runtimeToken, pending.runtimeRevision, pending.origin, pending.applicationId);
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
        this.renderProgress(pending.runtimeRevision, this.options.initialTarget.documentName, 'ready');
        return;
      }
    }
    this.releaseArtifact(pending.previousArtifactHash);
  }
  private retainPreviousHotReloadArtifact(pending: PendingPreviewHotReload): void {
    const successor = [...this.pendingHotReloads.values()].find((candidate) => candidate.previousArtifactHash === pending.nextArtifactHash);
    if (successor !== undefined) {
      successor.previousArtifactHash = pending.previousArtifactHash;
      this.releaseArtifact(pending.nextArtifactHash);
      return;
    }
    if (this.artifactHash === pending.nextArtifactHash) {
      this.artifactHash = pending.previousArtifactHash;
      this.releaseArtifact(pending.nextArtifactHash);
      return;
    }
    this.releaseArtifact(pending.previousArtifactHash);
  }
  private resolveRuntimeSettlementRevision(artifactHash: string, fallbackRevision: number, ready: boolean): number {
    const pending = this.pendingSameArtifactRevision;
    if (pending?.artifactHash !== artifactHash || !this.isCurrentRevision(pending.revision) || this.artifactHash !== artifactHash) {
      return fallbackRevision;
    }
    this.pendingSameArtifactRevision = undefined;
    if (ready) {
      this.renderProgress(pending.revision, pending.documentName, 'ready');
    }
    return pending.revision;
  }
  private replaceDirectoryWatchers(nextDirectories: ReadonlySet<string>): void {
    replacePreviewDirectoryWatchers({
      directories: nextDirectories,
      disposablesByPath: this.directoryWatcherDisposables,
      log: this.options.log,
      onResource: (resource) => {
        this.refreshForDocument(resource.fsPath);
      },
      pinnedUri: this.documentUri,
    });
  }
  private renderTargetIssue(issue: PreviewTargetIssue, requestedRevision: number): void {
    if (this.artifactHash !== undefined) {
      this.options.log.warn(`${issue.title}: ${issue.message} Last good preview retained.`);
      this.renderProgress(requestedRevision, this.options.initialTarget.documentName, 'ready');
      return;
    }
    this.options.panel.webview.html = createPreviewHtml(this.options.panel.webview.cspSource, {
      kind: 'error',
      message: issue.message,
      title: issue.title,
    });
    this.releaseCurrentArtifact();
  }
  private handlePanelDisposed(): void {
    this.finishDisposal();
    this.notifyDisposed();
  }
  private handleViewStateChanged(): void {
    if (this.isActive) {
      this.options.callbacks.onDidFocus(this);
    }
  }
  private isCurrentRevision(requestedRevision: number): boolean {
    return !this.disposed && requestedRevision === this.revision;
  }
  private cancelActiveBuild(): void {
    const activeBuild = this.activeBuildExecution;
    this.activeBuildExecution = undefined;
    this.contextEnrichment.cancel();
    this.pendingSameArtifactRevision = undefined;
    this.pendingContextEnrichmentInputs.clear();
    activeBuild?.controller.abort();
  }
  private clearBuildExecution(requestedRevision: number): void {
    if (this.activeBuildExecution?.revision === requestedRevision) {
      this.activeBuildExecution = undefined;
    }
  }
  private getUpdateDelay(): number {
    const configuredDelay = vscode.workspace.getConfiguration('reactPreview', this.documentUri).get<number>('updateDelay', 300);
    return Math.min(2000, Math.max(100, configuredDelay));
  }
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
    this.displayedArtifactHash = artifactHash;
    this.displayedRuntimeRevision = revision;
    this.clearInitialRuntimeWatchdog();
    const timeout = setTimeout(() => {
      const pending = this.pendingInitialRuntime;
      if (
        pending?.artifactHash !== artifactHash ||
        pending.runtimeToken !== runtimeToken ||
        pending.revision !== revision ||
        this.disposed ||
        this.artifactHash !== artifactHash
      ) {
        return;
      }
      this.pendingInitialRuntime = undefined;
      this.contextEnrichment.cancel();
      this.failPreparedApplication(applicationId, origin, 'runtime-timeout', revision);
      this.clearBuildExecution(this.revision);
      this.performanceTrace.finish('failed', revision);
      this.releaseCurrentArtifact();
      try {
        this.renderRetryableError(
          {
            message: 'The generated browser modules did not start. Retry after checking the webview console and local dependencies.',
            title: 'Preview runtime did not start',
          },
          revision,
        );
      } catch (error) {
        this.options.log.debug('Could not render the React preview startup timeout.', error);
      }
    }, 30_000);
    this.pendingInitialRuntime = {
      applicationId,
      artifactHash,
      origin,
      revision,
      runtimeToken,
      timeout,
    };
  }
  private clearInitialRuntimeWatchdog(): void {
    if (this.pendingInitialRuntime === undefined) {
      return;
    }
    clearTimeout(this.pendingInitialRuntime.timeout);
    this.pendingInitialRuntime = undefined;
  }
  private replaceWithProgressFallback(requestedRevision: number, fallbackHtml: string): void {
    if (!this.isCurrentRevision(requestedRevision) || this.artifactHash === undefined) {
      return;
    }
    try {
      this.options.panel.webview.html = fallbackHtml;
      const runtimeToken = `${requestedRevision.toString()}:${this.artifactHash}`;
      this.startInitialRuntimeWatchdog(this.artifactHash, runtimeToken, requestedRevision);
    } catch (error) {
      this.options.log.debug('Could not recover an undelivered React preview status.', error);
    }
  }
  private clearRefreshTimer(): void {
    if (this.refreshTimer !== undefined) {
      clearTimeout(this.refreshTimer);
      this.refreshTimer = undefined;
    }
  }
  private finishDisposal(): void {
    if (this.disposed) {
      return;
    }
    this.disposed = true;
    this.cancelActiveBuild();
    this.performanceTrace.finish('cancelled');
    this.revision += 1;
    this.clearRefreshTimer();
    disposePreviewResources(this.panelDisposables);
    for (const disposables of this.directoryWatcherDisposables.values()) {
      disposePreviewResources(disposables);
    }
    this.directoryWatcherDisposables.clear();
    this.releaseCurrentArtifact();
  }
  private notifyDisposed(): void {
    if (this.disposalNotified) {
      return;
    }
    this.disposalNotified = true;
    this.options.callbacks.onDidDispose(this);
  }
  private releaseCurrentArtifact(): void {
    this.clearInitialRuntimeWatchdog();
    this.pendingSameArtifactRevision = undefined;
    this.retryController.clear();
    this.displayedArtifactHash = undefined;
    this.moduleImportMapIdentity = undefined;
    const contentHash = this.artifactHash;
    this.artifactHash = undefined;
    if (contentHash !== undefined) {
      this.releaseArtifact(contentHash);
    }
    for (const pending of this.pendingHotReloads.values()) {
      clearTimeout(pending.timeout);
      this.releaseArtifact(pending.previousArtifactHash);
    }
    this.pendingHotReloads.clear();
  }
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

function createModuleImportMapIdentity(
  moduleImports: readonly { readonly specifier: string; readonly uri: string }[] | undefined,
): string {
  return JSON.stringify(
    [...(moduleImports ?? [])]
      .sort((left, right) =>
        left.specifier === right.specifier
          ? left.uri.localeCompare(right.uri)
          : left.specifier.localeCompare(right.specifier),
      )
      .map(({ specifier, uri }) => [specifier, uri]),
  );
}
