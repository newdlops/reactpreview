/** Filesystem and cleanup helpers shared by the event-routing edges of a pinned panel session. */
import path from 'node:path';
import * as vscode from 'vscode';
import { PreviewCompilationError } from '../domain/preview';
import { canonicalizeExistingPath } from '../shared/pathIdentity';

/** Reports whether a changed resource is equal to or nested below one static discovery root. */
export function isPreviewPathInside(directoryPath: string, candidatePath: string): boolean {
  const relativePath = path.relative(directoryPath, candidatePath);
  return (
    relativePath.length === 0 || (!relativePath.startsWith('..') && !path.isAbsolute(relativePath))
  );
}

/** Preserves remote scheme/authority while creating a sibling watcher base from a host path. */
export function createPreviewSiblingResourceUri(
  pinnedUri: vscode.Uri,
  resourcePath: string,
): vscode.Uri {
  const fileUri = vscode.Uri.file(resourcePath);
  return pinnedUri.scheme === 'file'
    ? fileUri
    : pinnedUri.with({ fragment: '', path: fileUri.path, query: '' });
}

/** Runs every best-effort cleanup even when one extension-provided disposable throws. */
export function disposePreviewResources(disposables: readonly vscode.Disposable[]): void {
  for (const disposable of disposables) {
    try {
      disposable.dispose();
    } catch {
      // Later listeners, watchers, and leases must still be released during extension shutdown.
    }
  }
}

/** Adds compiler diagnostic source locations so fixing a failed import retries the owning panel. */
export function rememberPreviewFailureDependencies(
  dependencies: Set<string>,
  error: unknown,
  workspaceRoot: string,
): void {
  if (!(error instanceof PreviewCompilationError)) {
    return;
  }
  for (const diagnostic of error.diagnostics) {
    const file = diagnostic.location?.file;
    if (file === undefined || file.startsWith('<')) {
      continue;
    }
    const absolutePath = path.isAbsolute(file) ? file : path.resolve(workspaceRoot, file);
    dependencies.add(canonicalizeExistingPath(absolutePath));
  }
}
