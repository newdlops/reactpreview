/**
 * Manages independent pinned preview sessions for one VS Code extension window.
 * Global editor events are routed by each session's dependency graph; active-editor changes are
 * intentionally ignored so focusing a webview can never retarget or rebuild an existing preview.
 */
import * as vscode from 'vscode';
import type { BuildPreview } from '../application/buildPreview';
import type { PreviewRenderMode } from '../domain/preview';
import {
  resolveActivePreviewTarget,
  resolvePinnedPreviewTarget,
  type PreviewTargetIssue,
  type ResolvedPreviewTarget,
} from './activePreviewTarget';
import { PreviewPanelSession } from './previewPanelSession';
import { createPreviewPanelTitle } from './previewPanelTitle';

/** Extension-scoped manager for any number of file-pinned React preview tabs. */
export class PreviewController implements vscode.Disposable {
  private lastFocusedSession: PreviewPanelSession | undefined;
  private disposed = false;
  private readonly extensionDisposables: vscode.Disposable[] = [];
  private readonly sessions = new Set<PreviewPanelSession>();

  /**
   * Creates a manager and subscribes once to events shared by every preview panel.
   *
   * @param buildPreview Application use case shared by isolated panel sessions.
   * @param resourceRoot Session directory every webview may load generated resources from.
   * @param log Extension log channel shared by all sessions.
   */
  public constructor(
    private readonly buildPreview: BuildPreview,
    private readonly resourceRoot: vscode.Uri,
    private readonly log: vscode.LogOutputChannel,
  ) {
    this.extensionDisposables.push(
      vscode.workspace.onDidChangeTextDocument(this.handleDocumentChanged.bind(this)),
      vscode.workspace.onDidSaveTextDocument(this.handleDocumentSaved.bind(this)),
      vscode.workspace.onDidChangeConfiguration(this.handleConfigurationChanged.bind(this)),
    );
  }

  /**
   * Captures the current source once and always creates a new independently pinned preview tab.
   *
   * @returns Promise resolved after validation and initial build scheduling.
   */
  public async open(renderMode: PreviewRenderMode = 'component'): Promise<void> {
    if (this.disposed) {
      return;
    }

    const target = resolveActivePreviewTarget();
    if ('title' in target) {
      await this.showTargetIssue(target);
      return;
    }

    this.openTarget(target, renderMode);
  }

  /**
   * Refreshes the focused preview, a panel matching the active source, or opens a new one.
   * Existing sessions always rebuild their original URI and are never retargeted by this command.
   *
   * @returns Promise resolved after refresh or open scheduling.
   */
  public async refresh(): Promise<void> {
    if (this.disposed) {
      return;
    }

    const focusedSession = [...this.sessions].find((session) => session.isActive);
    if (focusedSession !== undefined) {
      focusedSession.refresh();
      return;
    }

    const target = resolveActivePreviewTarget();
    if (!('title' in target)) {
      const matchingSession = this.findNewestSessionForTarget(target.request.documentPath);
      if (matchingSession === undefined) {
        this.openTarget(target, 'page-inspector');
      } else {
        matchingSession.refresh();
      }
      return;
    }

    if (this.lastFocusedSession !== undefined && this.sessions.has(this.lastFocusedSession)) {
      this.lastFocusedSession.refresh();
      return;
    }

    await this.showTargetIssue(target);
  }

  /** Closes every panel and removes extension-wide workspace listeners. */
  public dispose(): void {
    if (this.disposed) {
      return;
    }

    this.disposed = true;
    const liveSessions = [...this.sessions];
    this.sessions.clear();
    this.lastFocusedSession = undefined;
    for (const session of liveSessions) {
      session.dispose();
    }
    for (const disposable of this.extensionDisposables) {
      disposable.dispose();
    }
  }

  /**
   * Creates a dedicated webview and session from the already validated immutable target.
   *
   * @param target Target captured at the command boundary before webview focus can change editors.
   */
  private openTarget(target: ResolvedPreviewTarget, renderMode: PreviewRenderMode): void {
    const panel = vscode.window.createWebviewPanel(
      'reactPreview.currentFile',
      createPreviewPanelTitle(target.request.documentPath),
      vscode.ViewColumn.Beside,
      {
        enableScripts: true,
        localResourceRoots: [this.resourceRoot],
        retainContextWhenHidden: true,
      },
    );
    const session = new PreviewPanelSession({
      buildPreview: this.buildPreview,
      callbacks: {
        onDidDispose: this.handleSessionDisposed.bind(this),
        onDidFocus: this.handleSessionFocused.bind(this),
      },
      initialTarget: target,
      log: this.log,
      panel,
      renderMode,
      resolveTarget: resolvePinnedPreviewTarget,
    });
    this.sessions.add(session);
    this.lastFocusedSession = session;
    session.start();
  }

  /**
   * Routes an unsaved edit only to sessions whose pinned target or last graph contains the file.
   *
   * @param event VS Code text-document change event.
   */
  private handleDocumentChanged(event: vscode.TextDocumentChangeEvent): void {
    for (const session of this.sessions) {
      session.refreshForDocument(event.document.fileName);
    }
  }

  /**
   * Routes a save only to sessions whose pinned target or last graph contains the file.
   *
   * @param document Document that VS Code finished saving.
   */
  private handleDocumentSaved(document: vscode.TextDocument): void {
    for (const session of this.sessions) {
      session.refreshForDocument(document.fileName);
    }
  }

  /**
   * Rebuilds only sessions affected by resource-scoped compiler or debounce configuration changes.
   *
   * @param event VS Code configuration change event.
   */
  private handleConfigurationChanged(event: vscode.ConfigurationChangeEvent): void {
    for (const session of this.sessions) {
      const affectsSession =
        event.affectsConfiguration('reactPreview.updateDelay', session.documentUri) ||
        event.affectsConfiguration('reactPreview.tsconfig', session.documentUri) ||
        event.affectsConfiguration('reactPreview.setupFile', session.documentUri) ||
        event.affectsConfiguration('reactPreview.useStorybookPreview', session.documentUri);
      if (affectsSession) {
        session.refreshForConfiguration();
      }
    }
  }

  /** Records the focused session without compiling or changing its pinned target. */
  private handleSessionFocused(session: PreviewPanelSession): void {
    if (this.sessions.has(session)) {
      this.lastFocusedSession = session;
    }
  }

  /** Removes one user-closed session while preserving every sibling panel. */
  private handleSessionDisposed(session: PreviewPanelSession): void {
    this.sessions.delete(session);
    if (this.lastFocusedSession === session) {
      this.lastFocusedSession = undefined;
    }
  }

  /**
   * Finds the most recently created panel pinned to an active source editor path.
   *
   * @param documentPath Active text-document path selected by the refresh command.
   * @returns Matching live session or `undefined` when refresh should open a new panel.
   */
  private findNewestSessionForTarget(documentPath: string): PreviewPanelSession | undefined {
    return [...this.sessions].reverse().find((session) => session.targetsDocument(documentPath));
  }

  /**
   * Presents a target validation issue at the command edge without mutating existing panels.
   *
   * @param issue Recoverable active-editor problem.
   */
  private async showTargetIssue(issue: PreviewTargetIssue): Promise<void> {
    await vscode.window.showWarningMessage(`${issue.title}: ${issue.message}`);
  }
}
