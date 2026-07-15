/**
 * Resolves the active VS Code editor into an immutable preview request or a recoverable issue.
 * Keeping validation outside the panel controller separates workspace policy from lifecycle,
 * debounce, and asynchronous rendering concerns.
 */
import path from 'node:path';
import * as vscode from 'vscode';
import type { PreviewBuildRequest, PreviewSourceSnapshot } from '../domain/preview';
import { getPreviewSourceLanguage } from '../domain/previewTarget';

const SUPPORTED_DOCUMENT_SCHEMES = new Set(['file', 'vscode-remote']);

/** Successfully resolved active editor and immutable build request. */
export interface ResolvedPreviewTarget {
  /** Active editor filename displayed in the panel. */
  readonly documentName: string;
  /** Immutable request passed through the application layer. */
  readonly request: PreviewBuildRequest;
}

/** Recoverable reason why the current editor cannot be previewed. */
export interface PreviewTargetIssue {
  /** User-facing explanation with a suggested recovery action. */
  readonly message: string;
  /** Short heading used by notifications or the panel error state. */
  readonly title: string;
}

/**
 * Validates trust, editor presence, storage scheme, extension, and workspace resolution.
 *
 * @returns Valid current-document request or an issue suitable for safe display.
 */
export function resolveActivePreviewTarget(): PreviewTargetIssue | ResolvedPreviewTarget {
  if (!vscode.workspace.isTrusted) {
    return {
      message: 'Trust this workspace before executing its React source in a preview.',
      title: 'Workspace trust is required',
    };
  }

  const editor = vscode.window.activeTextEditor;
  if (editor === undefined) {
    return {
      message: 'Open a .tsx, .jsx, .ts, or .js component and try again.',
      title: 'No active editor',
    };
  }

  const document = editor.document;
  if (document.isUntitled || !SUPPORTED_DOCUMENT_SCHEMES.has(document.uri.scheme)) {
    return {
      message: 'Save the component in a filesystem-backed workspace before previewing it.',
      title: 'Unsupported document',
    };
  }

  const language = getPreviewSourceLanguage(document.fileName);
  if (language === undefined) {
    return {
      message: 'The initial preview supports .tsx, .jsx, .ts, and .js files.',
      title: 'Unsupported file type',
    };
  }

  const workspaceFolder = vscode.workspace.getWorkspaceFolder(document.uri);
  const workspaceRoot = workspaceFolder?.uri.fsPath ?? path.dirname(document.fileName);
  const configuredTsconfig = vscode.workspace
    .getConfiguration('reactPreview', document.uri)
    .get<string>('tsconfig', '')
    .trim();
  const baseRequest = {
    dependencySnapshots: collectDirtyDependencySnapshots(document, workspaceFolder),
    documentPath: document.fileName,
    language,
    sourceText: document.getText(),
    workspaceRoot,
  };
  return {
    documentName: path.basename(document.fileName),
    request:
      configuredTsconfig.length === 0
        ? baseRequest
        : {
            ...baseRequest,
            tsconfigPath: path.resolve(workspaceRoot, configuredTsconfig),
          },
  };
}

/**
 * Captures dirty source documents in the active workspace for reachable-import overlay.
 * Supplying a snapshot does not include it in the bundle: esbuild still loads only files reached
 * from the selected component's runtime graph.
 *
 * @param activeDocument Current preview target already represented by the request's primary fields.
 * @param activeWorkspace Workspace folder that bounds related dirty editor documents.
 * @returns Immutable dirty dependency snapshots with supported source extensions.
 */
function collectDirtyDependencySnapshots(
  activeDocument: vscode.TextDocument,
  activeWorkspace: vscode.WorkspaceFolder | undefined,
): readonly PreviewSourceSnapshot[] {
  const activeWorkspaceKey = activeWorkspace?.uri.toString(true);
  return vscode.workspace.textDocuments.flatMap((document) => {
    if (
      document === activeDocument ||
      !document.isDirty ||
      document.isUntitled ||
      !SUPPORTED_DOCUMENT_SCHEMES.has(document.uri.scheme)
    ) {
      return [];
    }

    const workspaceKey = vscode.workspace.getWorkspaceFolder(document.uri)?.uri.toString(true);
    const language = getPreviewSourceLanguage(document.fileName);
    if (workspaceKey !== activeWorkspaceKey || language === undefined) {
      return [];
    }

    return [
      {
        documentPath: document.fileName,
        language,
        sourceText: document.getText(),
      },
    ];
  });
}
