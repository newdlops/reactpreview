/**
 * Owns the VS Code side of React Page Inspector source navigation. The browser may suggest a source
 * location, but this adapter opens it only when the normalized file belongs to the last successful
 * bundle graph of the requesting panel. This keeps arbitrary host files outside the webview's reach.
 */
import * as vscode from 'vscode';
import { canonicalizeExistingPath } from '../shared/pathIdentity';
import { createPreviewSiblingResourceUri } from './previewPanelSessionUtilities';
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

  const sourceIdentity = canonicalizeExistingPath(request.sourcePath);
  if (!context.dependencyPaths.has(sourceIdentity)) {
    context.log.debug(
      `Ignored React Inspector source outside the committed bundle graph: ${request.sourcePath}`,
    );
    return true;
  }

  void openPreviewInspectorSource(request, context).catch((error: unknown) => {
    context.log.debug(`Could not open React Inspector source ${request.sourcePath}.`, error);
  });
  return true;
}

/** Opens one authorized source and reveals its clamped authored location in a text editor. */
async function openPreviewInspectorSource(
  request: PreviewInspectorOpenSourceRequest,
  context: PreviewInspectorSourceNavigationContext,
): Promise<void> {
  const sourceUri = resolvePreviewInspectorSourceUri(request.sourcePath, context.pinnedDocumentUri);
  const document = await vscode.workspace.openTextDocument(sourceUri);
  const selection = createPreviewInspectorSourceSelection(document, request);
  const viewColumn = selectPreviewInspectorSourceColumn(
    request.sourcePath,
    context.panelViewColumn,
  );
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
function resolvePreviewInspectorSourceUri(sourcePath: string, pinnedUri: vscode.Uri): vscode.Uri {
  const sourceIdentity = canonicalizeExistingPath(sourcePath);
  const openDocument = vscode.workspace.textDocuments.find(
    (document) => canonicalizeExistingPath(document.fileName) === sourceIdentity,
  );
  return openDocument?.uri ?? createPreviewSiblingResourceUri(pinnedUri, sourcePath);
}

/** Converts one-based browser coordinates or a zero-based graph offset into a bounded editor range. */
function createPreviewInspectorSourceSelection(
  document: vscode.TextDocument,
  request: PreviewInspectorOpenSourceRequest,
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
  sourcePath: string,
  panelViewColumn: vscode.ViewColumn | undefined,
): vscode.ViewColumn {
  const sourceIdentity = canonicalizeExistingPath(sourcePath);
  const visibleEditors = vscode.window.visibleTextEditors;
  const matchingEditor = visibleEditors.find(
    (editor) => canonicalizeExistingPath(editor.document.fileName) === sourceIdentity,
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
