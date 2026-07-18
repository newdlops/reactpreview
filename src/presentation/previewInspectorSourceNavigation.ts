/**
 * Owns the VS Code side of React Page Inspector source navigation. The browser may suggest a source
 * location, but this adapter opens it only when the normalized file belongs to the last successful
 * bundle graph of the requesting panel. This keeps arbitrary host files outside the webview's reach.
 */
import * as vscode from 'vscode';
import { canonicalizeExistingPath, normalizeLexicalPath } from '../shared/pathIdentity';
import type { PreviewInspectorGestureGate } from './previewInspectorGestureGate';
import { createPreviewSiblingResourceUri } from './previewPanelSessionUtilities';
import type { PreviewInspectorCompanionOpenSourceRequest } from './previewInspectorCompanionProtocol';
import {
  readPreviewInspectorOpenSourceRequest,
  type PreviewInspectorOpenSourceRequest,
} from './previewInspectorProtocol';

/** Host state needed to authorize and reveal one browser-selected component source. */
export interface PreviewInspectorSourceNavigationContext {
  /** Canonical source paths reached by the panel's last committed bundle. */
  readonly dependencyPaths: ReadonlySet<string>;
  /** Restricts the command to the explicit Page Inspector rendering mode. */
  readonly enabled: boolean;
  /** Panel-owned proof verifier that authenticates and consumes one trusted UI gesture. */
  readonly gestureGate: PreviewInspectorGestureGate;
  /** Diagnostics sink for denied or failed navigation without showing disruptive notifications. */
  readonly log: Pick<vscode.LogOutputChannel, 'debug'>;
  /** Column occupied by the webview, used to keep its component tree visible when possible. */
  readonly panelViewColumn: vscode.ViewColumn | undefined;
  /** Pinned source URI whose remote scheme and authority are reused for dependency paths. */
  readonly pinnedDocumentUri: vscode.Uri;
}

/**
 * Handles only a valid Inspector source request and leaves every other message to existing runtime
 * and hot-reload protocol readers. Recognized but unauthorized requests are consumed and logged so
 * they cannot trigger filesystem access or collide with future protocol handlers.
 *
 * @param value Untrusted structured-clone value received from the panel webview.
 * @param context Current graph allowlist, panel placement, URI scheme, and diagnostics boundary.
 * @returns `true` only when the value belonged to this protocol, whether accepted or denied.
 */
export function handlePreviewInspectorSourceNavigationMessage(
  value: unknown,
  context: PreviewInspectorSourceNavigationContext,
): boolean {
  const request = readPreviewInspectorOpenSourceRequest(value);
  if (request === undefined) {
    return false;
  }
  if (!context.enabled) {
    context.log.debug('Ignored React Inspector source navigation outside Page Inspector mode.');
    return true;
  }

  const sourceIdentity = resolveAuthorizedPreviewInspectorSourceIdentity(
    request.sourcePath,
    context.dependencyPaths,
  );
  if (sourceIdentity === undefined) {
    context.log.debug(
      `Ignored React Inspector source outside the committed bundle graph: ${request.sourcePath}`,
    );
    return true;
  }
  if (!context.gestureGate.consume(request)) {
    context.log.debug(
      'Ignored React Inspector source navigation without a fresh UI gesture proof.',
    );
    return true;
  }

  void openPreviewInspectorSource(request, sourceIdentity, context).catch((error: unknown) => {
    context.log.debug(`Could not open React Inspector source ${request.sourcePath}.`, error);
  });
  return true;
}

/**
 * Opens a companion-tab source click after applying the same render-mode and committed-graph
 * authorization as the preview-local HMAC path. The caller is the extension-owned companion
 * document, so its real user click replaces the preview webview's separate gesture proof.
 *
 * @param request Already syntax-bounded source coordinates from the companion protocol parser.
 * @param context Current preview graph and editor placement policy.
 */
export function handlePreviewInspectorCompanionSourceNavigation(
  request: PreviewInspectorCompanionOpenSourceRequest,
  context: PreviewInspectorSourceNavigationContext,
): void {
  if (!context.enabled) {
    context.log.debug('Ignored companion source navigation outside Page Inspector mode.');
    return;
  }
  const sourceIdentity = resolveAuthorizedPreviewInspectorSourceIdentity(
    request.sourcePath,
    context.dependencyPaths,
  );
  if (sourceIdentity === undefined) {
    context.log.debug(
      `Ignored companion source outside the committed bundle graph: ${request.sourcePath}`,
    );
    return;
  }
  void openPreviewInspectorSource(request, sourceIdentity, context).catch((error: unknown) => {
    context.log.debug(`Could not open companion Inspector source ${request.sourcePath}.`, error);
  });
}

/** Opens one authorized source and reveals its clamped authored location in a text editor. */
async function openPreviewInspectorSource(
  request: PreviewInspectorOpenSourceRequest | PreviewInspectorCompanionOpenSourceRequest,
  sourceIdentity: string,
  context: PreviewInspectorSourceNavigationContext,
): Promise<void> {
  const sourceUri = resolvePreviewInspectorSourceUri(
    request.sourcePath,
    sourceIdentity,
    context.pinnedDocumentUri,
  );
  const document = await vscode.workspace.openTextDocument(sourceUri);
  const selection = createPreviewInspectorSourceSelection(document, request);
  const viewColumn = selectPreviewInspectorSourceColumn(document, context.panelViewColumn);
  await vscode.window.showTextDocument(document, {
    preserveFocus: false,
    preview: true,
    viewColumn,
    ...(selection === undefined ? {} : { selection }),
  });
}

/**
 * Reuses an already open document URI when available, otherwise retaining the pinned target's remote
 * scheme and authority while substituting the selected dependency filesystem path.
 */
function resolvePreviewInspectorSourceUri(
  sourcePath: string,
  sourceIdentity: string,
  pinnedUri: vscode.Uri,
): vscode.Uri {
  const openDocument = vscode.workspace.textDocuments.find(
    (document) =>
      document.uri.scheme === pinnedUri.scheme &&
      document.uri.authority === pinnedUri.authority &&
      canonicalizeExistingPath(document.fileName) === sourceIdentity,
  );
  return openDocument?.uri ?? createPreviewSiblingResourceUri(pinnedUri, sourcePath);
}

/**
 * Requires an I/O-free lexical dependency match before following any symlink or filesystem path.
 * Runtime metadata is emitted from exact esbuild inputs, so an unrelated alias has no reason to be
 * canonicalized. The injectable canonicalizer exists only to prove this ordering in a unit test.
 */
export function resolveAuthorizedPreviewInspectorSourceIdentity(
  sourcePath: string,
  dependencyPaths: ReadonlySet<string>,
  canonicalize: (candidatePath: string) => string = canonicalizeExistingPath,
): string | undefined {
  if (!dependencyPaths.has(normalizeLexicalPath(sourcePath))) {
    return undefined;
  }
  const canonicalIdentity = canonicalize(sourcePath);
  return dependencyPaths.has(canonicalIdentity) ? canonicalIdentity : undefined;
}

/** Converts one-based browser coordinates or a zero-based graph offset into a bounded editor range. */
function createPreviewInspectorSourceSelection(
  document: vscode.TextDocument,
  request: PreviewInspectorOpenSourceRequest | PreviewInspectorCompanionOpenSourceRequest,
): vscode.Range | undefined {
  let position: vscode.Position | undefined;
  if (request.line !== undefined) {
    const line = Math.min(request.line - 1, Math.max(0, document.lineCount - 1));
    const maximumCharacter = document.lineAt(line).text.length;
    const character = Math.min((request.column ?? 1) - 1, maximumCharacter);
    position = new vscode.Position(line, character);
  } else if (request.occurrenceStart !== undefined) {
    position = document.positionAt(request.occurrenceStart);
  }
  return position === undefined ? undefined : new vscode.Range(position, position);
}

/**
 * Reuses a visible editor column for the exact source, then another code column, and finally chooses
 * a column that does not replace the Inspector webview whenever the current layout makes that known.
 */
function selectPreviewInspectorSourceColumn(
  document: vscode.TextDocument,
  panelViewColumn: vscode.ViewColumn | undefined,
): vscode.ViewColumn {
  const sourceIdentity = canonicalizeExistingPath(document.fileName);
  const visibleEditors = vscode.window.visibleTextEditors;
  const matchingEditor = visibleEditors.find(
    (editor) =>
      editor.document.uri.scheme === document.uri.scheme &&
      editor.document.uri.authority === document.uri.authority &&
      canonicalizeExistingPath(editor.document.fileName) === sourceIdentity,
  );
  if (matchingEditor?.viewColumn !== undefined) {
    return matchingEditor.viewColumn;
  }
  const otherEditor = visibleEditors.find(
    (editor) => editor.viewColumn !== undefined && editor.viewColumn !== panelViewColumn,
  );
  if (otherEditor?.viewColumn !== undefined) {
    return otherEditor.viewColumn;
  }
  return panelViewColumn === vscode.ViewColumn.One
    ? vscode.ViewColumn.Beside
    : vscode.ViewColumn.One;
}
