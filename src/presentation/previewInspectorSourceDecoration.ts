/**
 * Mirrors the Page Inspector tree selection and passive JSX branch inventory into already-visible
 * source editors without opening documents, changing focus, or moving code scroll positions. The
 * panel-owned service retains authorized pending marks so a controller-level visible-editor event
 * can apply them later, while independent revision and sequence checks reject delayed messages.
 */
import * as vscode from 'vscode';
import { canonicalizeExistingPath } from '../shared/pathIdentity';
import type {
  PreviewInspectorBranchSourceDecorationRequest,
  PreviewInspectorBranchSourceLocation,
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

/** One graph-authorized JSX branch location retained without filesystem or editor capabilities. */
interface AuthorizedPreviewInspectorBranchSource {
  readonly location: PreviewInspectorBranchSourceLocation;
  readonly sourceIdentity: string;
}

/** Authorized passive branch inventory retained while its source editor is not visible. */
interface PendingPreviewInspectorBranchDecorations {
  readonly log: Pick<vscode.LogOutputChannel, 'debug'>;
  readonly pinnedDocumentUri: vscode.Uri;
  readonly sources: readonly AuthorizedPreviewInspectorBranchSource[];
}

/** Editor and style that currently own the visible source mark. */
interface AppliedPreviewInspectorSourceDecoration {
  readonly decorationType: vscode.TextEditorDecorationType;
  readonly editor: vscode.TextEditor;
}

/** Coordinate-only contract shared by selected-component and passive-branch decoration ranges. */
type PreviewInspectorDecorationLocation = Pick<
  PreviewInspectorBranchSourceLocation,
  'column' | 'line' | 'occurrenceStart'
>;

/**
 * Owns one preview session's selected-source mark plus its passive Boolean branch marks. A controller
 * may fan one global visible-editor event into `applyVisibleEditors`; the service itself registers no
 * global listeners, preventing N preview tabs from multiplying VS Code subscriptions.
 */
export class PreviewInspectorSourceDecoration implements vscode.Disposable {
  private applied: AppliedPreviewInspectorSourceDecoration | undefined;
  private appliedBranches: AppliedPreviewInspectorSourceDecoration[] = [];
  private approximateDecorationType: vscode.TextEditorDecorationType | undefined;
  private branchDecorationType: vscode.TextEditorDecorationType | undefined;
  private disposed = false;
  private exactDecorationType: vscode.TextEditorDecorationType | undefined;
  private latestBranchSequence = 0;
  private latestSequence = 0;
  private pending: PendingPreviewInspectorSourceDecoration | undefined;
  private pendingBranches: PendingPreviewInspectorBranchDecorations | undefined;

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
      this.clearSelection();
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
   * Replaces the passive yellow annotations for every source-backed current-file JSX branch.
   *
   * The browser supplies only bounded coordinates. Each location must also belong to the committed
   * bundle graph before it can be retained, and an unauthorized batch cannot consume ordering state.
   *
   * @param request Parsed branch inventory from the Inspector runtime.
   * @param context Current panel graph, revision, provider identity, and diagnostics boundary.
   */
  public decorateBranches(
    request: PreviewInspectorBranchSourceDecorationRequest,
    context: PreviewInspectorSourceDecorationContext,
  ): void {
    if (this.disposed || !context.enabled) return;
    if (request.runtimeRevision !== context.currentRuntimeRevision) {
      context.log.debug(
        `Ignored React Inspector branch decorations from stale runtime revision ${request.runtimeRevision.toString()}; current revision is ${context.currentRuntimeRevision.toString()}.`,
      );
      return;
    }
    if (request.sequence <= this.latestBranchSequence) {
      context.log.debug(
        `Ignored reordered React Inspector branch decoration sequence ${request.sequence.toString()}.`,
      );
      return;
    }
    const sources = request.sources.flatMap((location) => {
      const sourceIdentity = resolveAuthorizedPreviewInspectorSourceIdentity(
        location.sourcePath,
        context.dependencyPaths,
      );
      if (sourceIdentity !== undefined) return [{ location, sourceIdentity }];
      context.log.debug(
        `Ignored React Inspector branch decoration outside the committed bundle graph: ${location.sourcePath}`,
      );
      return [];
    });
    if (request.sources.length > 0 && sources.length === 0) return;
    this.latestBranchSequence = request.sequence;
    this.clearAppliedBranchDecorations();
    this.pendingBranches =
      sources.length === 0
        ? undefined
        : Object.freeze({
            log: context.log,
            pinnedDocumentUri: context.pinnedDocumentUri,
            sources: Object.freeze(sources),
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
    if (this.disposed) return;
    this.applySelectedSource(editors);
    this.applyBranchSources(editors);
  }

  /** Applies the current tree selection to the first matching visible editor without revealing it. */
  private applySelectedSource(editors: readonly vscode.TextEditor[]): void {
    if (this.pending === undefined) return;
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

  /** Applies every retained branch line to all matching visible split editors in one bounded pass. */
  private applyBranchSources(editors: readonly vscode.TextEditor[]): void {
    this.clearAppliedBranchDecorations();
    const pending = this.pendingBranches;
    if (pending === undefined) return;
    const decorationType = this.getBranchDecorationType();
    for (const editor of editors) {
      if (!this.hasMatchingProvider(editor, pending.pinnedDocumentUri)) continue;
      const sourceIdentity = canonicalizeExistingPath(editor.document.fileName);
      const locations = pending.sources.filter(
        (candidate) => candidate.sourceIdentity === sourceIdentity,
      );
      if (locations.length === 0) continue;
      const seenRanges = new Set<string>();
      const decorations = locations.flatMap(({ location }) => {
        const key = [
          String(location.line ?? ''),
          String(location.column ?? ''),
          String(location.occurrenceStart ?? ''),
        ].join(':');
        if (seenRanges.has(key)) return [];
        seenRanges.add(key);
        return [
          {
            hoverMessage: 'React Page Inspector: JSX ON/OFF branch',
            range: createPreviewInspectorDecorationRange(editor.document, location),
          },
        ];
      });
      try {
        editor.setDecorations(decorationType, decorations);
        this.appliedBranches.push({ decorationType, editor });
      } catch (error) {
        pending.log.debug('Could not decorate React Inspector JSX branches.', error);
      }
    }
  }

  /**
   * Invalidates a selected source after its document changes. The most recent sequence remains
   * consumed so a delayed pre-edit browser message cannot restore obsolete authored coordinates.
   *
   * @param documentPath Filesystem path emitted by the controller's document-change event.
   */
  public invalidateDocument(documentPath: string): void {
    const sourceIdentity = canonicalizeExistingPath(documentPath);
    const selectionMatches = sourceIdentity === this.pending?.sourceIdentity;
    const branchMatches =
      this.pendingBranches?.sources.some((source) => source.sourceIdentity === sourceIdentity) ===
      true;
    if (!selectionMatches && !branchMatches) return;
    this.clear();
  }

  /** Clears the currently visible mark and any selection waiting for an editor to become visible. */
  public clear(): void {
    this.clearSelection();
    this.clearBranches();
  }

  /** Removes the visible mark and releases lazily-created VS Code decoration resources once. */
  public dispose(): void {
    if (this.disposed) return;
    this.clear();
    this.disposed = true;
    this.exactDecorationType?.dispose();
    this.approximateDecorationType?.dispose();
    this.branchDecorationType?.dispose();
    this.exactDecorationType = undefined;
    this.approximateDecorationType = undefined;
    this.branchDecorationType = undefined;
  }

  /** Matches canonical source identity while preserving the pinned local or remote URI provider. */
  private isMatchingEditor(
    editor: vscode.TextEditor,
    pending: PendingPreviewInspectorSourceDecoration,
  ): boolean {
    return (
      this.hasMatchingProvider(editor, pending.pinnedDocumentUri) &&
      canonicalizeExistingPath(editor.document.fileName) === pending.sourceIdentity
    );
  }

  /** Preserves local/remote URI provider identity before comparing canonical filesystem paths. */
  private hasMatchingProvider(editor: vscode.TextEditor, pinnedDocumentUri: vscode.Uri): boolean {
    return (
      editor.document.uri.scheme === pinnedDocumentUri.scheme &&
      editor.document.uri.authority === pinnedDocumentUri.authority
    );
  }

  /** Clears only the interactive tree selection while retaining passive JSX branch marks. */
  private clearSelection(): void {
    this.clearAppliedDecoration();
    this.pending = undefined;
  }

  /** Clears only the passive JSX branch inventory and its visible marks. */
  private clearBranches(): void {
    this.clearAppliedBranchDecorations();
    this.pendingBranches = undefined;
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

  /** Removes yellow branch marks from every visible split editor without disposing their style. */
  private clearAppliedBranchDecorations(): void {
    for (const applied of this.appliedBranches) {
      try {
        applied.editor.setDecorations(applied.decorationType, []);
      } catch {
        // A split editor may disappear between visibility notification and branch cleanup.
      }
    }
    this.appliedBranches = [];
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

  /** Lazily creates the passive yellow whole-line style shared by all JSX ON/OFF decisions. */
  private getBranchDecorationType(): vscode.TextEditorDecorationType {
    this.branchDecorationType ??= vscode.window.createTextEditorDecorationType({
      backgroundColor: new vscode.ThemeColor('editor.findMatchHighlightBackground'),
      isWholeLine: true,
      overviewRulerColor: new vscode.ThemeColor('editorWarning.foreground'),
      overviewRulerLane: vscode.OverviewRulerLane.Right,
    });
    return this.branchDecorationType;
  }
}

/** Converts one-based authored coordinates or a graph offset into a current-buffer-safe range. */
function createPreviewInspectorDecorationRange(
  document: vscode.TextDocument,
  request: PreviewInspectorDecorationLocation,
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
