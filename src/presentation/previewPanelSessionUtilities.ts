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

/** Inputs for reconciling one panel's directory-scoped hot-reload watchers. */
export interface ReplacePreviewDirectoryWatchersOptions {
  /** Newly committed resource-discovery roots. */
  readonly directories: ReadonlySet<string>;
  /** Session-owned watcher groups keyed by their canonical directory path. */
  readonly disposablesByPath: Map<string, vscode.Disposable[]>;
  /** Output channel used only for recoverable watcher construction failures. */
  readonly log: vscode.LogOutputChannel;
  /** Receives changed, created, and deleted resources through one panel-local policy callback. */
  readonly onResource: (resource: vscode.Uri) => void;
  /** Pinned URI whose remote scheme and authority must be preserved. */
  readonly pinnedUri: vscode.Uri;
}

/**
 * Reconciles filesystem watchers without coupling watcher lifecycle to the panel build controller.
 *
 * Every removed directory is disposed first. Newly added roots share one callback across change,
 * create, and delete events so the caller remains responsible for dependency containment policy.
 */
export function replacePreviewDirectoryWatchers(
  options: ReplacePreviewDirectoryWatchersOptions,
): void {
  for (const [directoryPath, disposables] of options.disposablesByPath) {
    if (options.directories.has(directoryPath)) continue;
    disposePreviewResources(disposables);
    options.disposablesByPath.delete(directoryPath);
  }
  for (const directoryPath of options.directories) {
    if (options.disposablesByPath.has(directoryPath)) continue;
    let newDisposables: vscode.Disposable[] = [];
    try {
      const directoryUri = createPreviewSiblingResourceUri(options.pinnedUri, directoryPath);
      const watcher = vscode.workspace.createFileSystemWatcher(
        new vscode.RelativePattern(directoryUri, '**/*'),
      );
      newDisposables = [
        watcher,
        watcher.onDidChange(options.onResource),
        watcher.onDidCreate(options.onResource),
        watcher.onDidDelete(options.onResource),
      ];
      options.disposablesByPath.set(directoryPath, newDisposables);
    } catch (error) {
      disposePreviewResources(newDisposables);
      options.log.debug(
        `Could not watch React preview resource directory ${directoryPath}.`,
        error,
      );
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
