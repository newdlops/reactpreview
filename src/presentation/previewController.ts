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
  resolvePreviewTarget,
  resolveWorkspacePreviewTarget,
  type PreviewTargetIssue,
  type ResolvedPreviewTarget,
} from './activePreviewTarget';
import { PreviewInspectorCompanionPanel } from './previewInspectorCompanionPanel';
import type { PreviewInspectorNeuralModel } from './previewInspectorNeuralModelProtocol';
import {
  PreviewInspectorNeuralModelStore,
  type PreviewInspectorNeuralModelState,
} from './previewInspectorNeuralModelStore';
import { PreviewPanelSession } from './previewPanelSession';
import { createPreviewPanelTitle } from './previewPanelTitle';

const PAGE_CONTEXT_TARGET_KEY = 'reactPreview.pageContextTarget';
const PAGE_CONTEXT_TARGET_VERSION = 1;
const PAGE_CONTEXT_EXTENSIONS = ['js', 'jsx', 'ts', 'tsx', 'mjs', 'cjs', 'mts', 'cts'];

interface PreviewWorkspaceState {
  get(key: string): unknown;
  update(key: string, value: unknown): Thenable<void>;
}

/** Returns whether a workspace-state value has the exact durable target schema. */
function isStoredTarget(value: unknown): value is { readonly uri: string; readonly version: 1 } {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return false;
  const record = value as Record<string, unknown>;
  return (
    Object.keys(record).length === 2 &&
    record.version === 1 &&
    typeof record.uri === 'string' &&
    record.uri.length > 0
  );
}

/** Extension-scoped manager for any number of file-pinned React preview tabs. */
export class PreviewController implements vscode.Disposable {
  private lastFocusedSession: PreviewPanelSession | undefined;
  private disposed = false;
  private readonly extensionDisposables: vscode.Disposable[] = [];
  private readonly neuralModelStore: PreviewInspectorNeuralModelStore;
  private sharedInspectorNeuralModel: PreviewInspectorNeuralModel | undefined;
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
    private readonly workspaceState: PreviewWorkspaceState,
    neuralModelState: PreviewInspectorNeuralModelState = workspaceState,
  ) {
    this.neuralModelStore = new PreviewInspectorNeuralModelStore(neuralModelState, log);
    this.extensionDisposables.push(
      vscode.window.onDidChangeVisibleTextEditors(this.handleVisibleTextEditorsChanged.bind(this)),
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

    if (renderMode === 'component') {
      const target = resolveActivePreviewTarget();
      if ('title' in target) await this.showTargetIssue(target);
      else this.openTarget(target, renderMode);
      return;
    }
    await this.openPageContext();
  }

  /** Resolves, persists, then opens one page-context target. */
  private async openPageContext(): Promise<void> {
    let target: PreviewTargetIssue | ResolvedPreviewTarget | undefined;
    const activeEditor = vscode.window.activeTextEditor;
    if (activeEditor !== undefined) {
      target = resolvePreviewTarget(activeEditor.document);
    } else {
      const session =
        [...this.sessions].find((candidate) => candidate.isActive) ??
        (this.lastFocusedSession !== undefined && this.sessions.has(this.lastFocusedSession)
          ? this.lastFocusedSession
          : undefined);
      if (session !== undefined) target = await resolvePinnedPreviewTarget(session.documentUri);
      else target = await this.resolveDurableOrPick();
    }
    if (target === undefined) return;
    if ('title' in target) return this.showTargetIssue(target);
    try {
      await this.workspaceState.update(PAGE_CONTEXT_TARGET_KEY, {
        uri: target.documentUri.toString(true),
        version: PAGE_CONTEXT_TARGET_VERSION,
      });
    } catch (cause) {
      throw new Error(
        'React Preview could not remember the selected page-context target. No preview was opened.',
        { cause },
      );
    }
    this.openTarget(target, 'page-inspector');
  }

  /** Resolves durable state when valid, otherwise prompts once with the native picker. */
  private async resolveDurableOrPick(): Promise<
    PreviewTargetIssue | ResolvedPreviewTarget | undefined
  > {
    const value = this.workspaceState.get(PAGE_CONTEXT_TARGET_KEY);
    if (isStoredTarget(value)) {
      let uri: vscode.Uri | undefined;
      try {
        uri = vscode.Uri.parse(value.uri, true);
      } catch {
        uri = undefined;
      }
      if (uri !== undefined) {
        const durable = await resolveWorkspacePreviewTarget(uri);
        if (!('title' in durable)) return durable;
      }
    }
    const selections = await vscode.window.showOpenDialog({
      canSelectFiles: true,
      canSelectFolders: false,
      canSelectMany: false,
      openLabel: 'Open in React Page Context',
      filters: { 'JavaScript / TypeScript': PAGE_CONTEXT_EXTENSIONS },
    });
    if (selections === undefined || selections.length === 0) return undefined;
    if (selections.length !== 1)
      return {
        title: 'Select one preview target',
        message: 'Choose exactly one supported source file for the page-context preview.',
      };
    const selected = selections[0];
    if (selected === undefined) return undefined;
    return resolveWorkspacePreviewTarget(selected);
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
      artifactResourceRoot: this.resourceRoot,
      buildPreview: this.buildPreview,
      callbacks: {
        onDidDispose: this.handleSessionDisposed.bind(this),
        onDidFocus: this.handleSessionFocused.bind(this),
        onDidSynchronizeNeuralModel: this.handleNeuralModelSynchronization.bind(this),
      },
      initialTarget: target,
      log: this.log,
      panel,
      renderMode,
      resolveTarget: resolvePinnedPreviewTarget,
    });
    this.sessions.add(session);
    this.lastFocusedSession = session;
    if (renderMode === 'page-inspector') {
      PreviewInspectorCompanionPanel.attach({
        documentName: panel.title,
        log: this.log,
        openSource: session.openInspectorCompanionSource.bind(session),
        previewPanel: panel,
      });
    }
    session.start();
  }

  /** Merges learning without waking retained hidden webviews in the shared renderer process. */
  private handleNeuralModelSynchronization(
    source: PreviewPanelSession,
    model: PreviewInspectorNeuralModel,
    runtimeRevision: number,
  ): void {
    void this.neuralModelStore
      .synchronize(model)
      .then((sharedModel) => {
        if (this.disposed) return;
        this.sharedInspectorNeuralModel = sharedModel;
        for (const session of this.sessions) {
          if (session === source)
            session.applySharedInspectorNeuralModel(sharedModel, runtimeRevision);
          else if (session.isActive) session.applySharedInspectorNeuralModel(sharedModel);
        }
      })
      .catch((error: unknown) => {
        this.log.debug('Could not synchronize the shared React Inspector neural model.', error);
      });
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

  /** Fans one window-level visibility event into each session-owned source decoration. */
  private handleVisibleTextEditorsChanged(editors: readonly vscode.TextEditor[]): void {
    for (const session of this.sessions) session.refreshInspectorSourceDecoration(editors);
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
        event.affectsConfiguration('reactPreview.maxOutputSizeMiB', session.documentUri) ||
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
      if (this.sharedInspectorNeuralModel !== undefined) {
        session.applySharedInspectorNeuralModel(this.sharedInspectorNeuralModel);
      }
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
