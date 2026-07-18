/**
 * Owns the separate VS Code editor tab used by React Page Inspector controls.
 * The paired preview webview remains authoritative and executes project code exactly once; this
 * class only relays inert UI snapshots and bounded user interactions between the two webviews.
 */
import { randomBytes } from 'node:crypto';
import * as vscode from 'vscode';
import {
  isPreviewInspectorCompanionReady,
  isPreviewInspectorCompanionRevealRequest,
  readPreviewInspectorCompanionAction,
  readPreviewInspectorCompanionOpenSourceRequest,
  readPreviewInspectorCompanionSnapshot,
  type PreviewInspectorCompanionOpenSourceRequest,
  type PreviewInspectorCompanionSnapshot,
} from './previewInspectorCompanionProtocol';
import { disposePreviewResources } from './previewPanelSessionUtilities';
import { createPreviewInspectorCompanionHtml } from './webview/previewInspectorCompanionHtml';

/** Construction input for one companion bound permanently to one preview panel. */
export interface PreviewInspectorCompanionPanelOptions {
  /** Basename-only title inherited from the immutable preview panel target. */
  readonly documentName: string;
  /** Diagnostic sink shared with the owning preview session. */
  readonly log: Pick<vscode.LogOutputChannel, 'debug'>;
  /** Session-owned graph authorizer invoked only for a real click in the inert companion tab. */
  readonly openSource: (request: PreviewInspectorCompanionOpenSourceRequest) => void;
  /** Project-runtime webview whose Inspector UI is mirrored without a second bundle execution. */
  readonly previewPanel: vscode.WebviewPanel;
}

/** Lifecycle and message relay for one preview/Inspector tab pair. */
export class PreviewInspectorCompanionPanel implements vscode.Disposable {
  private disposed = false;
  private inspectorReady = false;
  private latestSnapshot: PreviewInspectorCompanionSnapshot | undefined;
  private readonly panel: vscode.WebviewPanel;
  private readonly disposables: vscode.Disposable[] = [];

  /**
   * Creates and attaches a companion tab, then returns focus to the unobscured preview renderer.
   *
   * @param options Stable preview panel, title, and log boundary.
   * @returns Live companion retained by its panel event subscriptions until either tab closes.
   */
  public static attach(
    options: PreviewInspectorCompanionPanelOptions,
  ): PreviewInspectorCompanionPanel {
    return new PreviewInspectorCompanionPanel(options);
  }

  /** Creates the inert companion document and installs directional message relays. */
  private constructor(private readonly options: PreviewInspectorCompanionPanelOptions) {
    this.panel = vscode.window.createWebviewPanel(
      'reactPreview.pageInspector',
      `Inspector · ${options.documentName}`,
      vscode.ViewColumn.Beside,
      {
        enableFindWidget: true,
        enableScripts: true,
        localResourceRoots: [],
        retainContextWhenHidden: true,
      },
    );
    this.panel.webview.html = createPreviewInspectorCompanionHtml({
      cspSource: this.panel.webview.cspSource,
      documentName: options.documentName,
      nonce: randomBytes(18).toString('base64url'),
    });
    this.disposables.push(
      options.previewPanel.onDidDispose(this.handlePreviewDisposed.bind(this)),
      options.previewPanel.webview.onDidReceiveMessage(this.handlePreviewMessage.bind(this)),
      this.panel.onDidDispose(this.handleInspectorDisposed.bind(this)),
      this.panel.webview.onDidReceiveMessage(this.handleInspectorMessage.bind(this)),
    );
    this.revealPreviewWithoutFocus();
  }

  /** Closes the companion and removes both webview relays without closing the preview panel. */
  public dispose(): void {
    if (this.disposed) {
      return;
    }
    this.disposed = true;
    disposePreviewResources(this.disposables);
    this.panel.dispose();
  }

  /** Accepts bounded mirror snapshots or an explicit wireframe-driven Inspector focus request. */
  private handlePreviewMessage(value: unknown): void {
    if (isPreviewInspectorCompanionRevealRequest(value)) {
      this.revealInspectorWithFocus();
      return;
    }
    const snapshot = readPreviewInspectorCompanionSnapshot(value);
    const previousSequence = this.latestSnapshot?.sequence ?? 0;
    const startsNewDocument = snapshot?.sequence === 1;
    if (snapshot === undefined || (!startsNewDocument && snapshot.sequence <= previousSequence)) {
      return;
    }
    this.latestSnapshot = snapshot;
    if (this.inspectorReady) {
      this.postSnapshot(snapshot);
    }
  }

  /** Replays retained state after reload and forwards only parsed user interactions to the preview. */
  private handleInspectorMessage(value: unknown): void {
    if (isPreviewInspectorCompanionReady(value)) {
      this.inspectorReady = true;
      if (this.latestSnapshot !== undefined) {
        this.postSnapshot(this.latestSnapshot);
      }
      return;
    }
    const sourceRequest = readPreviewInspectorCompanionOpenSourceRequest(value);
    if (sourceRequest !== undefined) {
      this.options.openSource(sourceRequest);
      return;
    }
    const action = readPreviewInspectorCompanionAction(value);
    if (action === undefined) {
      return;
    }
    try {
      void Promise.resolve(this.options.previewPanel.webview.postMessage(action)).catch(
        (error: unknown) => {
          this.options.log.debug('Could not forward a React Inspector companion action.', error);
        },
      );
    } catch (error) {
      this.options.log.debug('Could not post a React Inspector companion action.', error);
    }
  }

  /** Delivers one immutable snapshot while retaining it for a future companion document reload. */
  private postSnapshot(snapshot: PreviewInspectorCompanionSnapshot): void {
    try {
      void Promise.resolve(this.panel.webview.postMessage(snapshot)).catch((error: unknown) => {
        this.options.log.debug('Could not update the React Inspector companion tab.', error);
      });
    } catch (error) {
      this.options.log.debug('Could not post a React Inspector companion snapshot.', error);
    }
  }

  /** Closing the renderer invalidates the paired Inspector and its retained project-derived UI. */
  private handlePreviewDisposed(): void {
    this.dispose();
  }

  /** Closing only the Inspector detaches relays while deliberately leaving the renderer alive. */
  private handleInspectorDisposed(): void {
    if (this.disposed) {
      return;
    }
    this.disposed = true;
    disposePreviewResources(this.disposables);
  }

  /** Restores the renderer tab after creating its sibling without stealing editor keyboard focus. */
  private revealPreviewWithoutFocus(): void {
    try {
      this.options.previewPanel.reveal(this.options.previewPanel.viewColumn, true);
    } catch (error) {
      this.options.log.debug(
        'Could not restore the React preview tab after opening Inspector.',
        error,
      );
    }
  }

  /** Brings the paired Inspector editor tab forward after a renderer wireframe marker click. */
  private revealInspectorWithFocus(): void {
    try {
      this.panel.reveal(this.panel.viewColumn, false);
    } catch (error) {
      this.options.log.debug('Could not reveal the React Inspector companion tab.', error);
    }
  }
}
