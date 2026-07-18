/**
 * Declares construction boundaries for one independently testable preview panel session.
 * Keeping these contracts separate leaves the session implementation below the project file-size
 * ceiling while preserving explicit application, manager, target, and VS Code adapter boundaries.
 */
import type * as vscode from 'vscode';
import type { BuildPreview } from '../application/buildPreview';
import type { PreviewRenderMode } from '../domain/preview';
import type { PreviewTargetIssue, ResolvedPreviewTarget } from './activePreviewTarget';
import type { PreviewPanelSession } from './previewPanelSession';

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
