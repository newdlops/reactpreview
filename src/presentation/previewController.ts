/**
 * Owns the VS Code panel lifecycle and translates editor events into revisioned preview builds.
 * Compilation and storage stay behind the BuildPreview use case; this class handles only VS Code
 * state, debounce, stale-result suppression, URI conversion, logging, and secure HTML rendering.
 */
import path from 'node:path';
import * as vscode from 'vscode';
import type { BuildPreview } from '../application/buildPreview';
import { PreviewCompilationError, type PreparedPreview } from '../domain/preview';
import { canonicalizeExistingPath } from '../shared/pathIdentity';
import { resolveActivePreviewTarget } from './activePreviewTarget';
import { describeBuildFailure, formatDiagnostic } from './previewFailure';
import { createPreviewHtml } from './webview/previewHtml';

/** VS Code-facing coordinator for the current-file React preview panel. */
export class PreviewController implements vscode.Disposable {
  private disposed = false;
  private readonly extensionDisposables: vscode.Disposable[] = [];
  private panel: vscode.WebviewPanel | undefined;
  private panelDisposables: vscode.Disposable[] = [];
  private refreshTimer: ReturnType<typeof setTimeout> | undefined;
  private revision = 0;
  private dependencies = new Set<string>();

  /**
   * Creates a controller and subscribes once to editor, save, and configuration changes.
   *
   * @param buildPreview Application use case for compilation and artifact publication.
   * @param resourceRoot Session directory the webview may load generated resources from.
   * @param log Extension log channel for warnings and detailed failures.
   */
  public constructor(
    private readonly buildPreview: BuildPreview,
    private readonly resourceRoot: vscode.Uri,
    private readonly log: vscode.LogOutputChannel,
  ) {
    this.extensionDisposables.push(
      vscode.window.onDidChangeActiveTextEditor(this.handleActiveEditorChanged.bind(this)),
      vscode.workspace.onDidChangeTextDocument(this.handleDocumentChanged.bind(this)),
      vscode.workspace.onDidSaveTextDocument(this.handleDocumentSaved.bind(this)),
      vscode.workspace.onDidChangeConfiguration(this.handleConfigurationChanged.bind(this)),
    );
  }

  /**
   * Opens a side panel for the current React source or reveals the existing panel.
   * Invalid, untitled, virtual, or untrusted targets are rejected before enabling webview scripts.
   *
   * @returns A promise resolved after validation and refresh scheduling complete.
   */
  public async open(): Promise<void> {
    if (this.disposed) {
      return;
    }

    const target = resolveActivePreviewTarget();
    if ('title' in target) {
      await vscode.window.showWarningMessage(`${target.title}: ${target.message}`);
      return;
    }

    if (this.panel === undefined) {
      this.panel = vscode.window.createWebviewPanel(
        'reactPreview.currentFile',
        'React Preview',
        vscode.ViewColumn.Beside,
        {
          enableScripts: true,
          localResourceRoots: [this.resourceRoot],
          retainContextWhenHidden: false,
        },
      );
      this.panelDisposables.push(this.panel.onDidDispose(this.handlePanelDisposed.bind(this)));
    } else {
      this.panel.reveal(vscode.ViewColumn.Beside, true);
    }

    this.scheduleRefresh(true);
  }

  /**
   * Rebuilds immediately when a panel exists, or follows the normal open flow otherwise.
   *
   * @returns A promise resolved after opening or scheduling the new build revision.
   */
  public async refresh(): Promise<void> {
    if (this.disposed) {
      return;
    }

    if (this.panel === undefined) {
      await this.open();
      return;
    }

    this.scheduleRefresh(true);
  }

  /**
   * Cancels pending timers, invalidates in-flight revisions, closes the panel, and removes listeners.
   */
  public dispose(): void {
    if (this.disposed) {
      return;
    }

    this.disposed = true;
    this.revision += 1;
    this.clearRefreshTimer();
    this.panel?.dispose();
    this.disposePanelListeners();
    for (const disposable of this.extensionDisposables) {
      disposable.dispose();
    }
  }

  /**
   * Follows the newly active editor whenever the preview panel remains open.
   */
  private handleActiveEditorChanged(): void {
    if (this.panel !== undefined) {
      this.scheduleRefresh(true);
    }
  }

  /**
   * Debounces unsaved edits to the active document so rapid typing does not queue excessive builds.
   *
   * @param event VS Code text-document change event.
   */
  private handleDocumentChanged(event: vscode.TextDocumentChangeEvent): void {
    const isActiveDocument = vscode.window.activeTextEditor?.document === event.document;
    const isImportedDependency = this.dependencies.has(
      canonicalizeExistingPath(event.document.fileName),
    );
    if (this.panel !== undefined && (isActiveDocument || isImportedDependency)) {
      this.scheduleRefresh(false);
    }
  }

  /**
   * Rebuilds when a saved file belongs to the last successful component dependency graph.
   *
   * @param document Document that VS Code finished saving.
   */
  private handleDocumentSaved(document: vscode.TextDocument): void {
    if (
      this.panel !== undefined &&
      this.dependencies.has(canonicalizeExistingPath(document.fileName))
    ) {
      this.scheduleRefresh(false);
    }
  }

  /**
   * Rebuilds after a setting changes the debounce policy or module-resolution context.
   *
   * @param event VS Code configuration change event.
   */
  private handleConfigurationChanged(event: vscode.ConfigurationChangeEvent): void {
    const affectsPreviewBuild =
      event.affectsConfiguration('reactPreview.updateDelay') ||
      event.affectsConfiguration('reactPreview.tsconfig');
    if (this.panel !== undefined && affectsPreviewBuild) {
      this.scheduleRefresh(false);
    }
  }

  /**
   * Clears controller state associated with a panel that the user closed.
   */
  private handlePanelDisposed(): void {
    this.revision += 1;
    this.clearRefreshTimer();
    this.panel = undefined;
    this.dependencies.clear();
    this.disposePanelListeners();
  }

  /**
   * Assigns a new monotonically increasing revision and starts it now or after configured debounce.
   *
   * @param immediate Whether to bypass the editor-change debounce delay.
   */
  private scheduleRefresh(immediate: boolean): void {
    if (this.disposed) {
      return;
    }

    this.clearRefreshTimer();
    const requestedRevision = ++this.revision;

    if (immediate) {
      void this.rebuild(requestedRevision);
      return;
    }

    this.refreshTimer = setTimeout(() => {
      this.refreshTimer = undefined;
      void this.rebuild(requestedRevision);
    }, this.getUpdateDelay());
  }

  /**
   * Builds one editor snapshot and commits it only if no newer revision superseded the request.
   *
   * @param requestedRevision Revision identity captured when the build was scheduled.
   * @returns A promise resolved after the successful, failed, or stale result is handled.
   */
  private async rebuild(requestedRevision: number): Promise<void> {
    const panel = this.panel;
    if (panel === undefined) {
      return;
    }

    const target = resolveActivePreviewTarget();
    if ('title' in target) {
      panel.webview.html = createPreviewHtml(panel.webview.cspSource, {
        kind: 'error',
        message: target.message,
        title: target.title,
      });
      return;
    }

    panel.title = `React Preview: ${target.documentName}`;
    panel.webview.html = createPreviewHtml(panel.webview.cspSource, {
      documentName: target.documentName,
      kind: 'loading',
    });

    try {
      const preparedPreview = await this.buildPreview.execute(target.request);
      if (!this.isCurrentRevision(requestedRevision, panel)) {
        return;
      }

      this.commitPreparedPreview(panel, target.documentName, preparedPreview);
    } catch (error) {
      if (!this.isCurrentRevision(requestedRevision, panel)) {
        return;
      }

      this.log.error('React preview build failed.', error);
      this.rememberFailedDependencyLocations(error, target.request.workspaceRoot);
      const failure = describeBuildFailure(error);
      const errorState = {
        kind: 'error' as const,
        message: failure.message,
        title: 'Preview build failed',
      };
      panel.webview.html = createPreviewHtml(
        panel.webview.cspSource,
        failure.details === undefined ? errorState : { ...errorState, details: failure.details },
      );
    }
  }

  /**
   * Retains source paths reported by a failed build so editing the broken imported file retries.
   * Relative compiler paths are interpreted from the same workspace root used for resolution.
   *
   * @param error Unknown compiler or publication failure.
   * @param workspaceRoot Absolute directory used as esbuild's working directory.
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
   * Converts stored locations, records dependency paths, logs warnings, and reloads the webview.
   *
   * @param panel Current panel that initiated the build.
   * @param documentName Display name for the prepared source document.
   * @param preparedPreview Published artifact and compiler metadata.
   */
  private commitPreparedPreview(
    panel: vscode.WebviewPanel,
    documentName: string,
    preparedPreview: PreparedPreview,
  ): void {
    this.dependencies = new Set(preparedPreview.dependencies.map(canonicalizeExistingPath));
    for (const diagnostic of preparedPreview.diagnostics) {
      this.log.warn(formatDiagnostic(diagnostic));
    }

    const scriptUri = panel.webview
      .asWebviewUri(vscode.Uri.parse(preparedPreview.artifact.scriptLocation, true))
      .toString(true);
    const stylesheetLocation = preparedPreview.artifact.stylesheetLocation;
    const baseState = {
      documentName,
      kind: 'ready' as const,
      scriptUri,
    };

    panel.webview.html = createPreviewHtml(
      panel.webview.cspSource,
      stylesheetLocation === undefined
        ? baseState
        : {
            ...baseState,
            stylesheetUri: panel.webview
              .asWebviewUri(vscode.Uri.parse(stylesheetLocation, true))
              .toString(true),
          },
    );
    void this.buildPreview.pruneArtifactsExcept(preparedPreview.artifact.contentHash);
  }

  /**
   * Confirms that an asynchronous result still belongs to the same live panel and latest revision.
   *
   * @param requestedRevision Revision captured before compilation began.
   * @param panel Panel captured before compilation began.
   * @returns `true` only when committing the result cannot overwrite newer UI state.
   */
  private isCurrentRevision(requestedRevision: number, panel: vscode.WebviewPanel): boolean {
    return requestedRevision === this.revision && panel === this.panel;
  }

  /**
   * Reads and clamps the user-configured debounce delay to the manifest's supported range.
   *
   * @returns Delay in milliseconds between 100 and 2,000.
   */
  private getUpdateDelay(): number {
    const configuredDelay = vscode.workspace
      .getConfiguration('reactPreview')
      .get<number>('updateDelay', 300);
    return Math.min(2000, Math.max(100, configuredDelay));
  }

  /**
   * Cancels the current debounce timer when a newer revision or disposal supersedes it.
   */
  private clearRefreshTimer(): void {
    if (this.refreshTimer !== undefined) {
      clearTimeout(this.refreshTimer);
      this.refreshTimer = undefined;
    }
  }

  /**
   * Disposes listeners tied to the current panel without affecting extension-wide editor events.
   */
  private disposePanelListeners(): void {
    for (const disposable of this.panelDisposables) {
      disposable.dispose();
    }
    this.panelDisposables = [];
  }
}
