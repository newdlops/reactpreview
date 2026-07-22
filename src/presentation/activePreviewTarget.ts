/**
 * Resolves the active VS Code editor into an immutable preview request or a recoverable issue.
 * Keeping validation outside the panel controller separates workspace policy from lifecycle,
 * debounce, and asynchronous rendering concerns.
 */
import path from 'node:path';
import * as vscode from 'vscode';
import type { PreviewBuildRequest, PreviewSourceSnapshot } from '../domain/preview';
import {
  DEFAULT_PREVIEW_OUTPUT_MEBIBYTES,
  normalizePreviewOutputMebibytes,
} from '../domain/previewOutputPolicy';
import { getPreviewSourceLanguage } from '../domain/previewTarget';

const SUPPORTED_DOCUMENT_SCHEMES = new Set(['file', 'vscode-remote']);

/** Successfully resolved active editor and immutable build request. */
export interface ResolvedPreviewTarget {
  /** Immutable URI used to reopen the same target without consulting the active editor. */
  readonly documentUri: vscode.Uri;
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
  const editor = vscode.window.activeTextEditor;
  if (editor === undefined) {
    return {
      message: 'Open a JS, JSX, TS, or TSX component file and try again.',
      title: 'No active editor',
    };
  }

  return resolvePreviewTarget(editor.document);
}

/**
 * Reopens and resolves one pinned document URI without reading the global active editor.
 *
 * @param documentUri Immutable resource captured when its preview panel was created.
 * @returns Latest document snapshot or a recoverable target issue for that same resource.
 */
export async function resolvePinnedPreviewTarget(
  documentUri: vscode.Uri,
): Promise<PreviewTargetIssue | ResolvedPreviewTarget> {
  try {
    const document = await vscode.workspace.openTextDocument(documentUri);
    return resolvePreviewTarget(document);
  } catch {
    return {
      message: `The pinned preview target could not be reopened: ${documentUri.fsPath}`,
      title: 'Preview target unavailable',
    };
  }
}

/**
 * Validates and snapshots an explicit document while preserving its identity for later rebuilds.
 *
 * @param document File-backed React source selected at the command boundary.
 * @returns Immutable build request and pinned URI, or an actionable validation issue.
 */
export function resolvePreviewTarget(
  document: vscode.TextDocument,
): PreviewTargetIssue | ResolvedPreviewTarget {
  if (!vscode.workspace.isTrusted) {
    return {
      message: 'Trust this workspace before executing its React source in a preview.',
      title: 'Workspace trust is required',
    };
  }

  if (document.isUntitled || !SUPPORTED_DOCUMENT_SCHEMES.has(document.uri.scheme)) {
    return {
      message: 'Save the component in a filesystem-backed workspace before previewing it.',
      title: 'Unsupported document',
    };
  }

  const language = getPreviewSourceLanguage(document.fileName);
  if (language === undefined) {
    return {
      message: 'React Preview supports JS/JSX/TS/TSX files and their MJS/CJS/MTS/CTS variants.',
      title: 'Unsupported file type',
    };
  }

  const workspaceFolder = vscode.workspace.getWorkspaceFolder(document.uri);
  const workspaceRoot = workspaceFolder?.uri.fsPath ?? path.dirname(document.fileName);
  const workspaceRelativeName = path.relative(workspaceRoot, document.fileName);
  const previewConfiguration = vscode.workspace.getConfiguration('reactPreview', document.uri);
  const configuredSetupFile = previewConfiguration.get<string>('setupFile', '').trim();
  const configuredTsconfig = previewConfiguration.get<string>('tsconfig', '').trim();
  const maxOutputMebibytes = normalizePreviewOutputMebibytes(
    previewConfiguration.get<number>('maxOutputSizeMiB', DEFAULT_PREVIEW_OUTPUT_MEBIBYTES),
  );
  const useStorybookPreview = previewConfiguration.get<boolean>('useStorybookPreview', true);
  const baseRequest = {
    dependencySnapshots: collectDirtyDependencySnapshots(document, workspaceFolder),
    documentPath: document.fileName,
    documentVersion: document.version,
    language,
    maxOutputMebibytes,
    sourceText: document.getText(),
    useStorybookPreview,
    workspaceRoot,
  };
  return {
    documentName:
      workspaceRelativeName.length === 0 || workspaceRelativeName.startsWith('..')
        ? path.basename(document.fileName)
        : workspaceRelativeName,
    documentUri: document.uri,
    request: {
      ...baseRequest,
      ...(configuredSetupFile.length === 0
        ? {}
        : { setupModulePath: path.resolve(workspaceRoot, configuredSetupFile) }),
      ...(configuredTsconfig.length === 0
        ? {}
        : { tsconfigPath: path.resolve(workspaceRoot, configuredTsconfig) }),
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
        documentVersion: document.version,
        language,
        sourceText: document.getText(),
      },
    ];
  });
}
