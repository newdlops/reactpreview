/**
 * Mirrors the Page Inspector tree selection into an already-visible source editor without opening
 * documents, changing editor focus, or moving the user's code scroll position. The panel-owned
 * service retains one authorized pending selection so a controller-level visible-editor event can
 * apply it later, while revision and sequence checks reject delayed browser messages.
 */
import * as vscode from 'vscode';
import { canonicalizeExistingPath } from '../shared/pathIdentity';
import type {
  PreviewInspectorSourceSelectionLocationRequest,
  PreviewInspectorSourceSelectionRequest,
} from './previewInspectorProtocol';
import { resolveAuthorizedPreviewInspectorSourceIdentity } from './previewInspectorSourceNavigation';

/** Immutable host state used to authorize one webview-owned tree selection. */
export interface PreviewInspectorSourceDecorationContext {
  /** Revision currently committed in the requesting panel rather than merely building in flight. */
  readonly currentRuntimeRevision: number;
  /** Canonical and lexical source paths reached by the panel's committed bundle graph. */
  readonly dependencyPaths: ReadonlySet<string>;
  /** Restricts decoration messages to Page Inspector rendering mode. */
  readonly enabled: boolean;
  /** Quiet diagnostic sink for denied, stale, or editor-disposal races. */
  readonly log: Pick<vscode.LogOutputChannel, 'debug'>;
  /** Pinned URI whose scheme and authority identify the matching workspace provider. */
  readonly pinnedDocumentUri: vscode.Uri;
}

/** Authorized selection retained while its source editor is not visible. */
interface PendingPreviewInspectorSourceDecoration {
  readonly log: Pick<vscode.LogOutputChannel, 'debug'>;
  readonly pinnedDocumentUri: vscode.Uri;
  readonly request: PreviewInspectorSourceSelectionLocationRequest;
  readonly sourceIdentity: string;
}

/** Editor and style that currently own the visible source mark. */
interface AppliedPreviewInspectorSourceDecoration {
  readonly decorationType: vscode.TextEditorDecorationType;
  readonly editor: vscode.TextEditor;
}

/**
 * Owns a single preview session's source mark and pending tree selection. A controller may fan one
 * global visible-editor event into `applyVisibleEditors`; the service itself registers no global
 * listeners, preventing N preview tabs from multiplying VS Code subscriptions.
 */
export class PreviewInspectorSourceDecoration implements vscode.Disposable {
  private applied: AppliedPreviewInspectorSourceDecoration | undefined;
  private approximateDecorationType: vscode.TextEditorDecorationType | undefined;
  private disposed = false;
  private exactDecorationType: vscode.TextEditorDecorationType | undefined;
  private latestSequence = 0;
  private pending: PendingPreviewInspectorSourceDecoration | undefined;

  /**
   * Accepts one parsed tree selection after checking render mode, committed revision, monotonic
   * order, and the exact dependency graph. A clear envelope removes both visible and pending marks.
   *
   * @param request Syntactically bounded source selection from the preview protocol.
   * @param context Current panel graph, revision, provider identity, and diagnostics boundary.
   */
  public select(
    request: PreviewInspectorSourceSelectionRequest,
    context: PreviewInspectorSourceDecorationContext,
  ): void {
    if (this.disposed || !context.enabled) return;
    if (request.runtimeRevision !== context.currentRuntimeRevision) {
      context.log.debug(
        `Ignored React Inspector source selection from stale runtime revision ${request.runtimeRevision.toString()}; current revision is ${context.currentRuntimeRevision.toString()}.`,
      );
      return;
    }
    if (request.sequence <= this.latestSequence) {
      context.log.debug(
        `Ignored reordered React Inspector source selection sequence ${request.sequence.toString()}.`,
      );
      return;
    }
    if (request.sourcePath === undefined) {
      this.latestSequence = request.sequence;
      this.clear();
      return;
    }

    const sourceIdentity = resolveAuthorizedPreviewInspectorSourceIdentity(
      request.sourcePath,
      context.dependencyPaths,
    );
    if (sourceIdentity === undefined) {
      context.log.debug(
        `Ignored React Inspector source decoration outside the committed bundle graph: ${request.sourcePath}`,
      );
      return;
    }
    this.latestSequence = request.sequence;
    this.clearAppliedDecoration();
    this.pending = Object.freeze({
      log: context.log,
      pinnedDocumentUri: context.pinnedDocumentUri,
      request,
      sourceIdentity,
    });
    this.applyVisibleEditors();
  }

  /**
   * Applies the retained selection to the matching already-visible editor. Calling this method from
   * one controller-level visibility listener lets a later manual source open receive the pending
   * mark without this service ever invoking `showTextDocument` or stealing focus.
   *
   * @param editors Current visible code editors; injectable for deterministic unit tests.
   */
  public applyVisibleEditors(
    editors: readonly vscode.TextEditor[] = vscode.window.visibleTextEditors,
  ): void {
    if (this.disposed || this.pending === undefined) return;
    const pending = this.pending;
    const editor = editors.find((candidate) => this.isMatchingEditor(candidate, pending));
    this.clearAppliedDecoration();
    if (editor === undefined) return;

    const approximate =
      pending.request.approximate === true ||
      (pending.request.line === undefined && pending.request.occurrenceStart === undefined);
    const decorationType = approximate
      ? this.getApproximateDecorationType()
      : this.getExactDecorationType();
    const range = createPreviewInspectorDecorationRange(editor.document, pending.request);
    try {
      editor.setDecorations(decorationType, [
        {
          hoverMessage: approximate
            ? 'React Page Inspector: inferred component source'
            : 'React Page Inspector: selected component source',
          range,
        },
      ]);
      this.applied = { decorationType, editor };
    } catch (error) {
      pending.log.debug('Could not decorate the selected React Inspector source.', error);
    }
  }

  /**
   * Invalidates a selected source after its document changes. The most recent sequence remains
   * consumed so a delayed pre-edit browser message cannot restore obsolete authored coordinates.
   *
   * @param documentPath Filesystem path emitted by the controller's document-change event.
   */
  public invalidateDocument(documentPath: string): void {
    if (canonicalizeExistingPath(documentPath) !== this.pending?.sourceIdentity) {
      return;
    }
    this.clear();
  }

  /** Clears the currently visible mark and any selection waiting for an editor to become visible. */
  public clear(): void {
    this.clearAppliedDecoration();
    this.pending = undefined;
  }

  /** Removes the visible mark and releases lazily-created VS Code decoration resources once. */
  public dispose(): void {
    if (this.disposed) return;
    this.clear();
    this.disposed = true;
    this.exactDecorationType?.dispose();
    this.approximateDecorationType?.dispose();
    this.exactDecorationType = undefined;
    this.approximateDecorationType = undefined;
  }

  /** Matches canonical source identity while preserving the pinned local or remote URI provider. */
  private isMatchingEditor(
    editor: vscode.TextEditor,
    pending: PendingPreviewInspectorSourceDecoration,
  ): boolean {
    return (
      editor.document.uri.scheme === pending.pinnedDocumentUri.scheme &&
      editor.document.uri.authority === pending.pinnedDocumentUri.authority &&
      canonicalizeExistingPath(editor.document.fileName) === pending.sourceIdentity
    );
  }

  /** Removes the prior editor mark without disposing the reusable exact or approximate style. */
  private clearAppliedDecoration(): void {
    if (this.applied === undefined) return;
    try {
      this.applied.editor.setDecorations(this.applied.decorationType, []);
    } catch {
      // A text editor may disappear between visibility notification and cleanup; disposal is enough.
    }
    this.applied = undefined;
  }

  /** Lazily creates the solid yellow exact-source style only after the first visible match. */
  private getExactDecorationType(): vscode.TextEditorDecorationType {
    this.exactDecorationType ??= vscode.window.createTextEditorDecorationType({
      backgroundColor: new vscode.ThemeColor('editor.findMatchHighlightBackground'),
      borderColor: new vscode.ThemeColor('editorWarning.foreground'),
      borderStyle: 'solid',
      borderWidth: '0 0 0 3px',
      isWholeLine: true,
      overviewRulerColor: new vscode.ThemeColor('editorWarning.foreground'),
      overviewRulerLane: vscode.OverviewRulerLane.Center,
    });
    return this.exactDecorationType;
  }

  /** Lazily creates a dashed informational style that distinguishes inferred source locations. */
  private getApproximateDecorationType(): vscode.TextEditorDecorationType {
    this.approximateDecorationType ??= vscode.window.createTextEditorDecorationType({
      backgroundColor: new vscode.ThemeColor('editor.wordHighlightBackground'),
      borderColor: new vscode.ThemeColor('editorInfo.foreground'),
      borderStyle: 'dashed',
      borderWidth: '0 0 0 3px',
      isWholeLine: true,
      overviewRulerColor: new vscode.ThemeColor('editorInfo.foreground'),
      overviewRulerLane: vscode.OverviewRulerLane.Center,
    });
    return this.approximateDecorationType;
  }
}

/** Converts one-based authored coordinates or a graph offset into a current-buffer-safe range. */
function createPreviewInspectorDecorationRange(
  document: vscode.TextDocument,
  request: PreviewInspectorSourceSelectionLocationRequest,
): vscode.Range {
  if (request.line !== undefined) {
    const line = Math.min(request.line - 1, Math.max(0, document.lineCount - 1));
    const maximumCharacter = document.lineAt(line).text.length;
    const character = Math.min((request.column ?? 1) - 1, maximumCharacter);
    const position = new vscode.Position(line, character);
    return new vscode.Range(position, position);
  }
  if (request.occurrenceStart !== undefined) {
    const position = document.positionAt(request.occurrenceStart);
    return new vscode.Range(position, position);
  }
  const position = new vscode.Position(0, 0);
  return new vscode.Range(position, position);
}
