/**
 * Owns one pinned preview panel and all mutable state that must never leak into another panel.
 * The session rebuilds only its captured document and dependency graph; panel focus changes update
 * manager bookkeeping but never select another editor or start compilation.
 */
import path from 'node:path';
import * as vscode from 'vscode';
import type { BuildPreview } from '../application/buildPreview';
import {
  PreviewCompilationError,
  type PreparedPreview,
  type PreviewRenderMode,
} from '../domain/preview';
import { canonicalizeExistingPath } from '../shared/pathIdentity';
import type { PreviewTargetIssue, ResolvedPreviewTarget } from './activePreviewTarget';
import { describeBuildFailure, formatDiagnostic } from './previewFailure';
import { createPreviewPanelTitle } from './previewPanelTitle';
import { createPreviewHtml } from './webview/previewHtml';

/** Application operations required by an independently testable panel session. */
export type PreviewBuildService = Pick<BuildPreview, 'execute' | 'releaseArtifact'>;

/** Resolves the latest snapshot for one immutable target URI. */
export type PinnedPreviewTargetResolver = (
  documentUri: vscode.Uri,
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

/** Artifact lease retained until the webview confirms a cache-busted hot module was imported. */
interface PendingHotReload {
  /** New artifact whose complete HTML may replace the document if this is still the latest build. */
  readonly nextArtifactHash: string;
  /** Previous artifact still needed while the browser imports the replacement entry. */
  readonly previousArtifactHash: string;
  /** Safety timer that falls back to a full document load if no browser acknowledgement arrives. */
  readonly timeout: ReturnType<typeof setTimeout>;
}

/** A single React preview tab pinned to one file for its complete lifetime. */
export class PreviewPanelSession implements vscode.Disposable {
  /** Canonical target identity used to route editor changes from the manager. */
  public readonly targetPath: string;

  private artifactHash: string | undefined;
  private dependencies: Set<string>;
  private dependencyDirectories = new Set<string>();
  private readonly directoryWatcherDisposables = new Map<string, vscode.Disposable[]>();
  private disposed = false;
  private disposalNotified = false;
  private readonly panelDisposables: vscode.Disposable[] = [];
  private readonly pendingHotReloads = new Map<string, PendingHotReload>();
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
      isPathInside(directoryPath, canonicalDocumentPath),
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

    this.clearRefreshTimer();
    const requestedRevision = ++this.revision;
    if (immediate) {
      void this.rebuild(requestedRevision, capturedTarget);
      return;
    }

    this.refreshTimer = setTimeout(() => {
      this.refreshTimer = undefined;
      void this.rebuild(requestedRevision);
    }, this.getUpdateDelay());
  }

  /**
   * Resolves and builds exactly one pinned target revision, then commits only if it remains current.
   *
   * @param requestedRevision Session-local revision captured before asynchronous work starts.
   * @param capturedTarget Optional target already resolved at panel creation.
   */
  private async rebuild(
    requestedRevision: number,
    capturedTarget?: ResolvedPreviewTarget,
  ): Promise<void> {
    let target: PreviewTargetIssue | ResolvedPreviewTarget;
    try {
      target = capturedTarget ?? (await this.options.resolveTarget(this.documentUri));
    } catch (error) {
      if (!this.isCurrentRevision(requestedRevision)) {
        return;
      }

      this.options.log.error('React preview target resolution failed.', error);
      this.renderTargetIssue({
        message:
          'The pinned source file could not be reopened. Check the file and refresh this preview.',
        title: 'Preview target unavailable',
      });
      return;
    }

    if (!this.isCurrentRevision(requestedRevision)) {
      return;
    }

    if ('title' in target) {
      this.renderTargetIssue(target);
      return;
    }

    if (!this.targetsDocument(target.request.documentPath)) {
      this.renderTargetIssue({
        message: 'The pinned preview target changed identity and was not followed.',
        title: 'Preview target changed',
      });
      return;
    }

    this.options.panel.title = createPreviewPanelTitle(target.request.documentPath);
    if (this.artifactHash === undefined) {
      this.options.panel.webview.html = createPreviewHtml(this.options.panel.webview.cspSource, {
        documentName: target.documentName,
        kind: 'loading',
      });
    }

    try {
      const preparedPreview = await this.options.buildPreview.execute({
        ...target.request,
        renderMode: this.options.renderMode,
      });
      if (!this.isCurrentRevision(requestedRevision)) {
        this.releaseArtifact(preparedPreview.artifact.contentHash);
        return;
      }

      try {
        this.commitPreparedPreview(target.documentName, preparedPreview);
      } catch (error) {
        this.releaseArtifact(preparedPreview.artifact.contentHash);
        throw error;
      }
    } catch (error) {
      if (!this.isCurrentRevision(requestedRevision)) {
        return;
      }

      this.options.log.error('React preview build failed.', error);
      this.rememberFailedDependencyLocations(error, target.request.workspaceRoot);
      const failure = describeBuildFailure(error);
      const errorState = {
        kind: 'error' as const,
        message: failure.message,
        title: 'Preview build failed',
      };
      this.options.panel.webview.html = createPreviewHtml(
        this.options.panel.webview.cspSource,
        failure.details === undefined ? errorState : { ...errorState, details: failure.details },
      );
      this.releaseCurrentArtifact();
    }
  }

  /**
   * Records source locations from a failed build so fixing an imported file retries this session.
   *
   * @param error Unknown compiler or publication failure.
   * @param workspaceRoot Absolute directory used by the failed resolver.
   */
  private rememberFailedDependencyLocations(error: unknown, workspaceRoot: string): void {
    if (!(error instanceof PreviewCompilationError)) {
      return;
    }

    for (const diagnostic of error.diagnostics) {
      const file = diagnostic.location?.file;
      if (file === undefined || file.startsWith('<')) {
        continue;
      }

      const absolutePath = path.isAbsolute(file) ? file : path.resolve(workspaceRoot, file);
      this.dependencies.add(canonicalizeExistingPath(absolutePath));
    }
  }

  /**
   * Updates this panel, replaces its dependency graph, and transfers its artifact lease.
   *
   * @param documentName Stable workspace-relative name shown in the ready state.
   * @param preparedPreview Published browser artifact and compiler metadata.
   */
  private commitPreparedPreview(documentName: string, preparedPreview: PreparedPreview): void {
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
      return;
    }

    if (previousArtifactHash === undefined) {
      // Do not accept the incoming lease until VS Code accepts the initial complete document.
      this.options.panel.webview.html = nextHtml;
    }
    this.dependencies = nextDependencies;
    this.dependencyDirectories = nextDependencyDirectories;
    this.artifactHash = preparedPreview.artifact.contentHash;
    this.replaceDirectoryWatchers(nextDependencyDirectories);
    if (previousArtifactHash !== undefined) {
      this.postHotReload(
        previousArtifactHash,
        preparedPreview.artifact.contentHash,
        scriptUri,
        stylesheetUri,
        nextHtml,
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
  ): void {
    this.hotReloadSequence += 1;
    const token = `${this.hotReloadSequence.toString()}:${nextArtifactHash}`;
    const timeout = setTimeout(() => {
      this.finishHotReload(token, fallbackHtml, true);
    }, 10_000);
    this.pendingHotReloads.set(token, {
      nextArtifactHash,
      previousArtifactHash,
      timeout,
    });

    let delivery: Thenable<boolean>;
    try {
      delivery = this.options.panel.webview.postMessage({
        scriptUri,
        ...(stylesheetUri === undefined ? {} : { stylesheetUri }),
        token,
        type: 'react-preview-hot-reload',
      });
    } catch (error) {
      this.options.log.debug('Could not post a React preview hot reload message.', error);
      this.finishHotReload(token, fallbackHtml, true);
      return;
    }
    void Promise.resolve(delivery).then(
      (delivered) => {
        if (!delivered) {
          this.finishHotReload(token, fallbackHtml, true);
        }
      },
      (error: unknown) => {
        this.options.log.debug('React preview hot reload delivery failed.', error);
        this.finishHotReload(token, fallbackHtml, true);
      },
    );
  }

  /** Accepts only acknowledgement messages emitted by the generated preview hot runtime. */
  private handleWebviewMessage(message: unknown): void {
    if (
      typeof message !== 'object' ||
      message === null ||
      !('type' in message) ||
      !('token' in message) ||
      typeof message.token !== 'string'
    ) {
      return;
    }
    if (
      message.type !== 'react-preview-hot-reload-ready' &&
      message.type !== 'react-preview-hot-reload-failed'
    ) {
      return;
    }
    this.finishHotReload(message.token, undefined, false);
  }

  /** Releases the previous revision after acknowledgement or a full-document fallback. */
  private finishHotReload(
    token: string,
    fallbackHtml: string | undefined,
    replaceDocument: boolean,
  ): void {
    const pending = this.pendingHotReloads.get(token);
    if (pending === undefined) {
      return;
    }
    this.pendingHotReloads.delete(token);
    clearTimeout(pending.timeout);
    const shouldReplaceDocument =
      replaceDocument &&
      fallbackHtml !== undefined &&
      !this.disposed &&
      this.artifactHash === pending.nextArtifactHash;
    if (shouldReplaceDocument) {
      try {
        this.options.panel.webview.html = fallbackHtml;
      } catch (error) {
        this.options.log.debug('Could not fall back from React preview hot reload.', error);
      }
    }
    this.releaseArtifact(pending.previousArtifactHash);
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
      disposeAll(disposables);
      this.directoryWatcherDisposables.delete(directoryPath);
    }

    for (const directoryPath of nextDirectories) {
      if (this.directoryWatcherDisposables.has(directoryPath)) {
        continue;
      }

      let newDisposables: vscode.Disposable[] = [];
      try {
        const directoryUri = createSiblingResourceUri(this.documentUri, directoryPath);
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
        disposeAll(newDisposables);
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
   */
  private renderTargetIssue(issue: PreviewTargetIssue): void {
    this.options.panel.webview.html = createPreviewHtml(this.options.panel.webview.cspSource, {
      kind: 'error',
      message: issue.message,
      title: issue.title,
    });
    this.releaseCurrentArtifact();
  }

  /**
   * Handles user-driven panel closure without affecting any sibling preview session.
   */
  private handlePanelDisposed(): void {
    this.finishDisposal();
    this.notifyDisposed();
  }

  /**
   * Updates manager focus bookkeeping only; changing webview visibility never starts a build.
   */
  private handleViewStateChanged(): void {
    if (this.isActive) {
      this.options.callbacks.onDidFocus(this);
    }
  }

  /** Returns whether an asynchronous result still belongs to this live session revision. */
  private isCurrentRevision(requestedRevision: number): boolean {
    return !this.disposed && requestedRevision === this.revision;
  }

  /** Reads the resource-scoped debounce setting for this pinned target. */
  private getUpdateDelay(): number {
    const configuredDelay = vscode.workspace
      .getConfiguration('reactPreview', this.documentUri)
      .get<number>('updateDelay', 300);
    return Math.min(2000, Math.max(100, configuredDelay));
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
    this.revision += 1;
    this.clearRefreshTimer();
    disposeAll(this.panelDisposables);
    for (const disposables of this.directoryWatcherDisposables.values()) {
      disposeAll(disposables);
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

/**
 * Reports whether a changed file is located at or below one statically watched directory.
 *
 * @param directoryPath Canonical directory recorded by resource discovery.
 * @param candidatePath Canonical document path from a VS Code event.
 * @returns `true` when the candidate can affect a glob rooted at the directory.
 */
function isPathInside(directoryPath: string, candidatePath: string): boolean {
  const relativePath = path.relative(directoryPath, candidatePath);
  return (
    relativePath.length === 0 || (!relativePath.startsWith('..') && !path.isAbsolute(relativePath))
  );
}

/**
 * Creates a URI for a filesystem sibling while retaining remote scheme and authority information.
 *
 * @param pinnedUri Original file or remote URI captured for this preview session.
 * @param resourcePath Absolute extension-host filesystem path to watch.
 * @returns Resource URI accepted as a VS Code relative-pattern base.
 */
function createSiblingResourceUri(pinnedUri: vscode.Uri, resourcePath: string): vscode.Uri {
  const fileUri = vscode.Uri.file(resourcePath);
  return pinnedUri.scheme === 'file'
    ? fileUri
    : pinnedUri.with({ fragment: '', path: fileUri.path, query: '' });
}

/**
 * Disposes one replaceable resource group while allowing every cleanup attempt to run.
 * VS Code disposables are cleanup boundaries, so an exceptional provider must not strand artifact
 * leases or prevent sibling watcher disposal during extension shutdown.
 *
 * @param disposables Panel listeners or watcher resources owned by one session.
 */
function disposeAll(disposables: readonly vscode.Disposable[]): void {
  for (const disposable of disposables) {
    try {
      disposable.dispose();
    } catch {
      // Cleanup remains best-effort so later resources and artifact leases are still released.
    }
  }
}
