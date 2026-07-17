/** Owns one pinned panel whose target, builds, leases, and focus state never leak to another tab. */
import * as vscode from 'vscode';
import type { BuildPreview } from '../application/buildPreview';
import type { PreparedPreview, PreviewRenderMode } from '../domain/preview';
import { isPreviewBuildCancellation } from '../domain/previewBuildExecution';
import type { PreviewProgressStage } from '../domain/previewProgress';
import { canonicalizeExistingPath } from '../shared/pathIdentity';
import type { PreviewTargetIssue, ResolvedPreviewTarget } from './activePreviewTarget';
import { describeBuildFailure, formatDiagnostic } from './previewFailure';
import { PreviewContextEnrichmentCoordinator } from './previewContextEnrichment';
import { createPreviewPanelTitle } from './previewPanelTitle';
import { PreviewPerformanceTrace } from './previewPerformanceTrace';
import { preparePreviewFirstPaint } from './previewFirstPaint';
import {
  createHotReloadScriptUri,
  readPreviewHotReloadAcknowledgement,
  type PendingPreviewHotReload,
} from './previewHotReloadProtocol';
import { handlePreviewInspectorSourceNavigationMessage } from './previewInspectorSourceNavigation';
import { createPreviewProgressMessage } from './previewProgress';
import { PreviewProgressGate } from './previewProgressGate';
import type {
  ActivePreviewBuildExecution,
  PendingPreviewInitialRuntime,
  PendingSamePreviewArtifactRevision,
} from './previewPanelSessionState';
import {
  createPreviewSiblingResourceUri,
  disposePreviewResources,
  isPreviewPathInside,
  rememberPreviewFailureDependencies,
} from './previewPanelSessionUtilities';
import { createPreviewHtml } from './webview/previewHtml';
/** Application operations required by an independently testable panel session. */
export type PreviewBuildService = Pick<BuildPreview, 'execute' | 'releaseArtifact'>;
/** Resolves the latest snapshot for one immutable target URI. */
export type PinnedPreviewTargetResolver = (
  documentUri: vscode.Uri,
  signal?: AbortSignal,
) => Promise<PreviewTargetIssue | ResolvedPreviewTarget>;
/** Manager callbacks that contain no session implementation details. */
export interface PreviewPanelSessionCallbacks {
  /** Records that the user focused this panel without requesting a rebuild. */
  readonly onDidFocus: (session: PreviewPanelSession) => void;
  /** Removes the independently disposed panel from the manager. */
  readonly onDidDispose: (session: PreviewPanelSession) => void;
}
/** Construction dependencies and initial immutable target for one panel. */
export interface PreviewPanelSessionOptions {
  /** Application use case that publishes and releases reference-counted artifacts. */
  readonly buildPreview: PreviewBuildService;
  /** Manager notifications for focus and disposal only. */
  readonly callbacks: PreviewPanelSessionCallbacks;
  /** Snapshot captured before creating the panel, preventing an open-time editor race. */
  readonly initialTarget: ResolvedPreviewTarget;
  /** Diagnostic channel shared by all sessions in the extension window. */
  readonly log: vscode.LogOutputChannel;
  /** Dedicated webview panel owned exclusively by this session. */
  readonly panel: vscode.WebviewPanel;
  /** Immutable rendering policy retained by every manual and automatic rebuild. */
  readonly renderMode: PreviewRenderMode;
  /** Pinned resolver that never consults the active editor. */
  readonly resolveTarget: PinnedPreviewTargetResolver;
}
/** A single React preview tab pinned to one file for its complete lifetime. */
export class PreviewPanelSession implements vscode.Disposable {
  /** Canonical target identity used to route editor changes from the manager. */
  public readonly targetPath: string;
  private artifactHash: string | undefined;
  private activeBuildExecution: ActivePreviewBuildExecution | undefined;
  private readonly contextEnrichment: PreviewContextEnrichmentCoordinator;
  private dependencies: Set<string>;
  private dependencyDirectories = new Set<string>();
  private readonly directoryWatcherDisposables = new Map<string, vscode.Disposable[]>();
  private disposed = false;
  private disposalNotified = false;
  private hasCompleteContext = false;
  private readonly panelDisposables: vscode.Disposable[] = [];
  private readonly pendingHotReloads = new Map<string, PendingPreviewHotReload>();
  private readonly performanceTrace: PreviewPerformanceTrace;
  private readonly progressGate = new PreviewProgressGate();
  private pendingInitialRuntime: PendingPreviewInitialRuntime | undefined;
  private pendingSameArtifactRevision: PendingSamePreviewArtifactRevision | undefined;
  private refreshTimer: ReturnType<typeof setTimeout> | undefined;
  private revision = 0;
  private hotReloadSequence = 0;
  /**
   * Captures the immutable target and subscribes only to events emitted by this panel.
   *
   * @param options Explicit dependencies and initial target snapshot.
   */
  public constructor(private readonly options: PreviewPanelSessionOptions) {
    this.targetPath = canonicalizeExistingPath(options.initialTarget.request.documentPath);
    this.dependencies = new Set([this.targetPath]);
    this.performanceTrace = new PreviewPerformanceTrace((trace) => {
      this.options.log.debug(`React preview performance ${JSON.stringify(trace)}`);
    });
    this.contextEnrichment = new PreviewContextEnrichmentCoordinator({
      buildPreview: options.buildPreview,
      callbacks: {
        complete: this.clearBuildExecution.bind(this),
        commit: (target, preview, revision) => {
          this.renderProgress(revision, target.documentName, 'loading-preview');
          this.commitPreparedPreview(target.documentName, preview, revision);
          this.hasCompleteContext = true;
        },
        isCurrent: this.isCurrentRevision.bind(this),
        reportFailure: (error, target, revision) => {
          this.options.log.warn(
            'Full React preview context enrichment failed; fast preview retained.',
            error,
          );
          this.performanceTrace.finish('failed', revision);
          rememberPreviewFailureDependencies(
            this.dependencies,
            error,
            target.request.workspaceRoot,
          );
          this.renderProgress(revision, target.documentName, 'ready');
        },
      },
      renderMode: options.renderMode,
    });
    this.panelDisposables.push(
      options.panel.onDidDispose(this.handlePanelDisposed.bind(this)),
      options.panel.onDidChangeViewState(this.handleViewStateChanged.bind(this)),
      options.panel.webview.onDidReceiveMessage(this.handleWebviewMessage.bind(this)),
    );
  }

  /** Immutable URI captured when this preview panel was created. */
  public get documentUri(): vscode.Uri {
    return this.options.initialTarget.documentUri;
  }

  /** Whether this panel currently owns editor focus. */
  public get isActive(): boolean {
    return !this.disposed && this.options.panel.active;
  }

  /** Starts the first build from the exact target snapshot validated before panel creation. */
  public start(): void {
    this.scheduleRefresh(true, this.options.initialTarget);
  }

  /** Rebuilds this session's pinned file immediately without consulting another editor. */
  public refresh(): void {
    this.scheduleRefresh(true);
  }

  /**
   * Schedules a debounced rebuild only when a changed file belongs to this session's graph.
   *
   * @param documentPath Filesystem path emitted by a VS Code document event.
   * @returns `true` when this session accepted the event.
   */
  public refreshForDocument(documentPath: string): boolean {
    const canonicalDocumentPath = canonicalizeExistingPath(documentPath);
    const belongsToWatchedDirectory = [...this.dependencyDirectories].some((directoryPath) =>
      isPreviewPathInside(directoryPath, canonicalDocumentPath),
    );
    if (
      this.disposed ||
      (!this.dependencies.has(canonicalDocumentPath) && !belongsToWatchedDirectory)
    ) {
      return false;
    }

    this.scheduleRefresh(false);
    return true;
  }

  /** Schedules a normal rebuild after resource-scoped compiler configuration changes. */
  public refreshForConfiguration(): void {
    this.scheduleRefresh(false);
  }

  /**
   * Reports whether a source-editor command refers to this immutable target.
   *
   * @param documentPath Candidate active editor path.
   * @returns `true` only for this panel's original target identity.
   */
  public targetsDocument(documentPath: string): boolean {
    return this.targetPath === canonicalizeExistingPath(documentPath);
  }

  /**
   * Invalidates work, closes this panel, releases its artifact lease, and removes listeners.
   */
  public dispose(): void {
    if (this.disposed) {
      return;
    }

    this.finishDisposal();
    this.options.panel.dispose();
    this.notifyDisposed();
  }

  /**
   * Assigns a session-local revision and starts it immediately or after the configured debounce.
   *
   * @param immediate Whether to bypass the editor-change delay.
   * @param capturedTarget Optional open-time target that avoids a second active-editor lookup.
   */
  private scheduleRefresh(immediate: boolean, capturedTarget?: ResolvedPreviewTarget): void {
    if (this.disposed) {
      return;
    }

    this.cancelActiveBuild();
    this.performanceTrace.finish('cancelled');
    this.clearRefreshTimer();
    const requestedRevision = ++this.revision;
    const controller = new AbortController();
    this.activeBuildExecution = { controller, revision: requestedRevision };
    this.renderProgress(
      requestedRevision,
      capturedTarget?.documentName ?? this.options.initialTarget.documentName,
      'resolving-target',
    );
    if (immediate) {
      void this.rebuild(requestedRevision, controller.signal, capturedTarget);
      return;
    }

    this.refreshTimer = setTimeout(() => {
      this.refreshTimer = undefined;
      void this.rebuild(requestedRevision, controller.signal);
    }, this.getUpdateDelay());
  }

  /**
   * Resolves and builds exactly one pinned target revision, then commits only if it remains current.
   *
   * @param requestedRevision Session-local revision captured before asynchronous work starts.
   * @param signal Cancellation signal aborted as soon as a newer refresh supersedes this revision.
   * @param capturedTarget Optional target already resolved at panel creation.
   */
  private async rebuild(
    requestedRevision: number,
    signal: AbortSignal,
    capturedTarget?: ResolvedPreviewTarget,
  ): Promise<void> {
    let target: PreviewTargetIssue | ResolvedPreviewTarget;
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
          message:
            'The pinned source file could not be reopened. Check the file and refresh this preview.',
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

    this.options.panel.title = createPreviewPanelTitle(target.request.documentPath);

    let contextEnrichmentPending = false;
    try {
      const firstPaint = await preparePreviewFirstPaint({
        buildPreview: this.options.buildPreview,
        context: {
          reportProgress: (stage) => {
            this.renderProgress(requestedRevision, target.documentName, stage);
          },
          signal,
        },
        preferFast: !this.hasCompleteContext,
        renderMode: this.options.renderMode,
        request: target.request,
      });
      const preparedPreview = firstPaint.preparedPreview;
      if (!this.isCurrentRevision(requestedRevision)) {
        this.releaseArtifact(preparedPreview.artifact.contentHash);
        return;
      }

      try {
        this.renderProgress(requestedRevision, target.documentName, 'loading-preview');
        this.commitPreparedPreview(target.documentName, preparedPreview, requestedRevision);
        if (firstPaint.requiresContextEnrichment) {
          contextEnrichmentPending = true;
          const artifactHash = preparedPreview.artifact.contentHash;
          const awaitsRuntimeSettlement =
            this.pendingInitialRuntime?.artifactHash === artifactHash ||
            [...this.pendingHotReloads.values()].some(
              (pending) => pending.nextArtifactHash === artifactHash,
            );
          this.contextEnrichment.schedule(
            target,
            artifactHash,
            requestedRevision,
            signal,
            awaitsRuntimeSettlement,
          );
        } else {
          this.hasCompleteContext = true;
        }
      } catch (error) {
        this.releaseArtifact(preparedPreview.artifact.contentHash);
        throw error;
      }
    } catch (error) {
      if (isPreviewBuildCancellation(error, signal)) {
        return;
      }
      if (!this.isCurrentRevision(requestedRevision)) {
        return;
      }

      this.options.log.error('React preview build failed; retaining the last good preview.', error);
      this.performanceTrace.finish('failed', requestedRevision);
      rememberPreviewFailureDependencies(this.dependencies, error, target.request.workspaceRoot);
      const failure = describeBuildFailure(error);
      const errorState = {
        kind: 'error' as const,
        message: failure.message,
        title: 'Preview build failed',
      };
      if (this.artifactHash === undefined) {
        this.options.panel.webview.html = createPreviewHtml(
          this.options.panel.webview.cspSource,
          failure.details === undefined ? errorState : { ...errorState, details: failure.details },
        );
      } else {
        this.renderProgress(requestedRevision, target.documentName, 'ready');
      }
    } finally {
      if (!contextEnrichmentPending) {
        this.clearBuildExecution(requestedRevision);
      }
    }
  }

  /**
   * Updates this panel, replaces its dependency graph, and transfers its artifact lease.
   *
   * @param documentName Stable workspace-relative name shown in the ready state.
   * @param preparedPreview Published browser artifact and compiler metadata.
   * @param requestedRevision Current session revision used by retained progress and reload messages.
   */
  private commitPreparedPreview(
    documentName: string,
    preparedPreview: PreparedPreview,
    requestedRevision: number,
  ): void {
    const nextDependencies = new Set([
      this.targetPath,
      ...preparedPreview.dependencies.map(canonicalizeExistingPath),
    ]);
    const nextDependencyDirectories = new Set(
      preparedPreview.watchDirectories.map(canonicalizeExistingPath),
    );
    for (const diagnostic of preparedPreview.diagnostics) {
      this.options.log.warn(formatDiagnostic(diagnostic));
    }

    const scriptUri = this.options.panel.webview
      .asWebviewUri(vscode.Uri.parse(preparedPreview.artifact.scriptLocation, true))
      .toString(true);
    const stylesheetLocation = preparedPreview.artifact.stylesheetLocation;
    const stylesheetUri =
      stylesheetLocation === undefined
        ? undefined
        : this.options.panel.webview
            .asWebviewUri(vscode.Uri.parse(stylesheetLocation, true))
            .toString(true);
    const baseState = {
      documentName,
      kind: 'ready' as const,
      runtimeRevision: requestedRevision,
      runtimeToken: `${requestedRevision.toString()}:${preparedPreview.artifact.contentHash}`,
      scriptUri,
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
        [...this.pendingHotReloads.values()].some(
          (pending) => pending.nextArtifactHash === previousArtifactHash,
        );
      if (awaitsSharedRuntime) {
        this.pendingSameArtifactRevision = {
          artifactHash: previousArtifactHash,
          documentName,
          revision: requestedRevision,
        };
      } else {
        this.renderProgress(requestedRevision, documentName, 'ready', nextHtml);
      }
      return;
    }
    const hotScriptUri =
      previousArtifactHash === undefined
        ? undefined
        : createHotReloadScriptUri(
            scriptUri,
            requestedRevision,
            preparedPreview.artifact.contentHash,
          );

    if (previousArtifactHash === undefined) {
      // Do not accept the incoming lease until VS Code accepts the initial complete document.
      this.options.panel.webview.html = nextHtml;
      this.startInitialRuntimeWatchdog(
        preparedPreview.artifact.contentHash,
        baseState.runtimeToken,
        requestedRevision,
      );
    }
    this.dependencies = nextDependencies;
    this.dependencyDirectories = nextDependencyDirectories;
    this.artifactHash = preparedPreview.artifact.contentHash;
    this.replaceDirectoryWatchers(nextDependencyDirectories);
    if (previousArtifactHash !== undefined && hotScriptUri !== undefined) {
      this.postHotReload(
        previousArtifactHash,
        preparedPreview.artifact.contentHash,
        hotScriptUri,
        stylesheetUri,
        nextHtml,
        requestedRevision,
        baseState.runtimeToken,
      );
    }
  }

  /**
   * Sends a cache-busted ESM/CSS replacement while retaining the current webview document.
   * The previous artifact lease remains valid until the browser acknowledges import completion.
   */
  private postHotReload(
    previousArtifactHash: string,
    nextArtifactHash: string,
    scriptUri: string,
    stylesheetUri: string | undefined,
    fallbackHtml: string,
    requestedRevision: number,
    runtimeToken: string,
  ): void {
    this.hotReloadSequence += 1;
    const token = `${this.hotReloadSequence.toString()}:${nextArtifactHash}`;
    const timeout = setTimeout(() => {
      this.finishHotReload(token, fallbackHtml, 'navigate');
    }, 30_000);
    this.pendingHotReloads.set(token, {
      fallbackHtml,
      nextArtifactHash,
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
      return;
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
  }

  /**
   * Shows one monotonic preparation milestone for the current revision only. Initial builds replace
   * their inert loading document; hot builds preserve the existing React tree and use its isolated
   * Shadow DOM status listener.
   */
  private renderProgress(
    requestedRevision: number,
    documentName: string,
    stage: PreviewProgressStage,
    fallbackHtml?: string,
  ): void {
    if (
      !this.isCurrentRevision(requestedRevision) ||
      !this.progressGate.accept(requestedRevision, stage)
    ) {
      return;
    }
    this.performanceTrace.transition(requestedRevision, documentName, stage);
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
      const delivery = this.options.panel.webview.postMessage(
        createPreviewProgressMessage(stage, requestedRevision),
      );
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

  /** Accepts only acknowledgement messages emitted by the generated preview hot runtime. */
  private handleWebviewMessage(message: unknown): void {
    if (
      handlePreviewInspectorSourceNavigationMessage(message, {
        dependencyPaths: this.dependencies,
        enabled: this.options.renderMode === 'page-inspector',
        log: this.options.log,
        panelViewColumn: this.options.panel.viewColumn,
        pinnedDocumentUri: this.documentUri,
      })
    ) {
      return;
    }
    if (
      typeof message === 'object' &&
      message !== null &&
      'type' in message &&
      (message.type === 'react-preview-runtime-ready' ||
        message.type === 'react-preview-runtime-failed') &&
      'token' in message &&
      typeof message.token === 'string' &&
      message.token === this.pendingInitialRuntime?.runtimeToken &&
      'revision' in message &&
      typeof message.revision === 'number' &&
      Number.isSafeInteger(message.revision) &&
      message.revision === this.pendingInitialRuntime.revision
    ) {
      const settledRuntime = this.pendingInitialRuntime;
      const settlementRevision = this.resolveRuntimeSettlementRevision(
        settledRuntime.artifactHash,
        settledRuntime.revision,
        message.type === 'react-preview-runtime-ready',
      );
      this.performanceTrace.finish(
        message.type === 'react-preview-runtime-ready' ? 'completed' : 'failed',
        settlementRevision,
      );
      this.clearInitialRuntimeWatchdog();
      this.contextEnrichment.settle(settledRuntime.artifactHash, settlementRevision);
      return;
    }
    const acknowledgement = readPreviewHotReloadAcknowledgement(message);
    if (acknowledgement === undefined) {
      return;
    }
    const pending = this.pendingHotReloads.get(acknowledgement.token);
    if (acknowledgement.revision !== pending?.runtimeRevision) {
      return;
    }
    const settlesWithoutNavigation = acknowledgement.applied || acknowledgement.retainedPrevious;
    const settlementRevision = settlesWithoutNavigation
      ? this.resolveRuntimeSettlementRevision(
          pending.nextArtifactHash,
          pending.runtimeRevision,
          acknowledgement.applied,
        )
      : pending.runtimeRevision;
    this.performanceTrace.finish(
      acknowledgement.applied ? 'completed' : 'failed',
      settlementRevision,
    );
    this.finishHotReload(
      acknowledgement.token,
      acknowledgement.applied ? undefined : pending.fallbackHtml,
      acknowledgement.retainedPrevious
        ? 'retained'
        : acknowledgement.applied
          ? 'applied'
          : 'navigate',
    );
    if (settlesWithoutNavigation) {
      this.contextEnrichment.settle(pending.nextArtifactHash, settlementRevision);
    }
  }

  /** Reconciles artifact ownership after browser application, retained failure, or navigation. */
  private finishHotReload(
    token: string,
    fallbackHtml: string | undefined,
    outcome: 'applied' | 'navigate' | 'retained' | 'undelivered',
  ): void {
    const pending = this.pendingHotReloads.get(token);
    if (pending === undefined) {
      return;
    }
    this.pendingHotReloads.delete(token);
    clearTimeout(pending.timeout);
    if (
      outcome === 'retained' ||
      (outcome === 'undelivered' && this.artifactHash !== pending.nextArtifactHash)
    ) {
      this.retainPreviousHotReloadArtifact(pending);
      return;
    }
    const shouldReplaceDocument =
      (outcome === 'navigate' || outcome === 'undelivered') &&
      fallbackHtml !== undefined &&
      !this.disposed &&
      this.artifactHash === pending.nextArtifactHash;
    if (shouldReplaceDocument) {
      try {
        this.options.panel.webview.html = fallbackHtml;
        this.startInitialRuntimeWatchdog(
          pending.nextArtifactHash,
          pending.runtimeToken,
          pending.runtimeRevision,
        );
      } catch (error) {
        this.options.log.debug('Could not fall back from React preview hot reload.', error);
        this.retainPreviousHotReloadArtifact(pending);
        return;
      }
    }
    this.releaseArtifact(pending.previousArtifactHash);
  }

  /**
   * Rolls a failed prepared revision out of an in-flight artifact chain without double-releasing a
   * lease. A direct successor inherits the last displayed predecessor; otherwise ownership moves
   * back to the predecessor only when this failed revision is still the session's newest artifact.
   */
  private retainPreviousHotReloadArtifact(pending: PendingPreviewHotReload): void {
    const successor = [...this.pendingHotReloads.values()].find(
      (candidate) => candidate.previousArtifactHash === pending.nextArtifactHash,
    );
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

  /** Maps a shared older browser request onto the newest revision waiting for identical bytes. */
  private resolveRuntimeSettlementRevision(
    artifactHash: string,
    fallbackRevision: number,
    ready: boolean,
  ): number {
    const pending = this.pendingSameArtifactRevision;
    if (
      pending?.artifactHash !== artifactHash ||
      !this.isCurrentRevision(pending.revision) ||
      this.artifactHash !== artifactHash
    ) {
      return fallbackRevision;
    }
    this.pendingSameArtifactRevision = undefined;
    if (ready) {
      this.renderProgress(pending.revision, pending.documentName, 'ready');
    }
    return pending.revision;
  }

  /**
   * Reconciles filesystem watchers so glob additions, deletions, renames, and external writes rebuild
   * only the session whose static discovery root contains the changed resource.
   *
   * @param nextDirectories Canonical discovery roots from the newly committed bundle.
   */
  private replaceDirectoryWatchers(nextDirectories: ReadonlySet<string>): void {
    for (const [directoryPath, disposables] of this.directoryWatcherDisposables) {
      if (nextDirectories.has(directoryPath)) {
        continue;
      }
      disposePreviewResources(disposables);
      this.directoryWatcherDisposables.delete(directoryPath);
    }

    for (const directoryPath of nextDirectories) {
      if (this.directoryWatcherDisposables.has(directoryPath)) {
        continue;
      }

      let newDisposables: vscode.Disposable[] = [];
      try {
        const directoryUri = createPreviewSiblingResourceUri(this.documentUri, directoryPath);
        const watcher = vscode.workspace.createFileSystemWatcher(
          new vscode.RelativePattern(directoryUri, '**/*'),
        );
        const handleResource = this.handleWatchedResourceChanged.bind(this);
        newDisposables = [watcher];
        newDisposables.push(watcher.onDidChange(handleResource));
        newDisposables.push(watcher.onDidCreate(handleResource));
        newDisposables.push(watcher.onDidDelete(handleResource));
        this.directoryWatcherDisposables.set(directoryPath, newDisposables);
      } catch (error) {
        disposePreviewResources(newDisposables);
        this.options.log.debug(
          `Could not watch React preview resource directory ${directoryPath}.`,
          error,
        );
      }
    }
  }

  /** Routes one filesystem watcher event through the same dependency-directory containment policy. */
  private handleWatchedResourceChanged(resource: vscode.Uri): void {
    this.refreshForDocument(resource.fsPath);
  }

  /**
   * Shows a pinned-target validation error and releases bytes no longer referenced by the panel.
   *
   * @param issue Recoverable target resolution failure.
   * @param requestedRevision Revision whose retained progress indicator must be closed.
   */
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

  /** Handles user-driven panel closure without affecting any sibling preview session. */
  private handlePanelDisposed(): void {
    this.finishDisposal();
    this.notifyDisposed();
  }

  /** Updates focus bookkeeping only; changing webview visibility never starts a build. */
  private handleViewStateChanged(): void {
    if (this.isActive) {
      this.options.callbacks.onDidFocus(this);
    }
  }

  /** Returns whether an asynchronous result still belongs to this live session revision. */
  private isCurrentRevision(requestedRevision: number): boolean {
    return !this.disposed && requestedRevision === this.revision;
  }

  /** Aborts and forgets the previously scheduled or running build before accepting newer work. */
  private cancelActiveBuild(): void {
    const activeBuild = this.activeBuildExecution;
    this.activeBuildExecution = undefined;
    this.contextEnrichment.cancel();
    this.pendingSameArtifactRevision = undefined;
    activeBuild?.controller.abort();
  }

  /** Clears the controller only when completion belongs to the same active session revision. */
  private clearBuildExecution(requestedRevision: number): void {
    if (this.activeBuildExecution?.revision === requestedRevision) {
      this.activeBuildExecution = undefined;
    }
  }

  /** Reads the resource-scoped debounce setting for this pinned target. */
  private getUpdateDelay(): number {
    const configuredDelay = vscode.workspace
      .getConfiguration('reactPreview', this.documentUri)
      .get<number>('updateDelay', 300);
    return Math.min(2000, Math.max(100, configuredDelay));
  }

  /** Starts a bounded wait for an entry module that can fail before its own error UI executes. */
  private startInitialRuntimeWatchdog(
    artifactHash: string,
    runtimeToken: string,
    revision: number,
  ): void {
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
      this.clearBuildExecution(this.revision);
      this.performanceTrace.finish('failed', revision);
      try {
        this.options.panel.webview.html = createPreviewHtml(this.options.panel.webview.cspSource, {
          kind: 'error',
          message:
            'The generated browser modules did not start. Refresh after checking the webview console and local dependencies.',
          title: 'Preview runtime did not start',
        });
      } catch (error) {
        this.options.log.debug('Could not render the React preview startup timeout.', error);
      }
      this.releaseCurrentArtifact();
    }, 30_000);
    this.pendingInitialRuntime = { artifactHash, revision, runtimeToken, timeout };
  }

  /** Clears a full-document startup timer after the generated entry reports ready or failed. */
  private clearInitialRuntimeWatchdog(): void {
    if (this.pendingInitialRuntime === undefined) {
      return;
    }
    clearTimeout(this.pendingInitialRuntime.timeout);
    this.pendingInitialRuntime = undefined;
  }

  /** Reloads a same-hash document only when its terminal progress message was not delivered. */
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

  /** Cancels this session's pending debounce timer. */
  private clearRefreshTimer(): void {
    if (this.refreshTimer !== undefined) {
      clearTimeout(this.refreshTimer);
      this.refreshTimer = undefined;
    }
  }

  /** Marks the session disposed, invalidates builds, and releases owned resources exactly once. */
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

  /** Notifies the manager once regardless of whether code or the user closed the panel. */
  private notifyDisposed(): void {
    if (this.disposalNotified) {
      return;
    }

    this.disposalNotified = true;
    this.options.callbacks.onDidDispose(this);
  }

  /** Releases displayed and in-flight hot-reload artifact leases and clears local ownership. */
  private releaseCurrentArtifact(): void {
    this.clearInitialRuntimeWatchdog();
    this.pendingSameArtifactRevision = undefined;
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

  /**
   * Returns one artifact lease and logs an unexpected storage failure without an unhandled promise.
   *
   * @param contentHash Published content digest no longer owned by this session.
   */
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
