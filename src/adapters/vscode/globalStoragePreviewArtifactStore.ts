/**
 * Publishes preview bundles under a session-specific VS Code global-storage directory.
 * The adapter exposes only serialized URI strings through the application port, while its public
 * `resourceRoot` lets the composition root grant the webview the narrowest local-resource scope.
 */
import { createHash, randomUUID } from 'node:crypto';
import * as vscode from 'vscode';
import type { PreviewArtifactStore } from '../../application/previewArtifactStore';
import type { PreviewBundle, StoredPreviewArtifact } from '../../domain/preview';

/** VS Code filesystem-backed store for cache-busted browser preview artifacts. */
export class GlobalStoragePreviewArtifactStore implements PreviewArtifactStore, vscode.Disposable {
  /** Directory that should be used as the webview's sole generated local-resource root. */
  public readonly resourceRoot: vscode.Uri;

  private disposed = false;
  private operationQueue: Promise<void> = Promise.resolve();
  private publicationSequence = 0;
  private readonly publicationSequenceByHash = new Map<string, number>();
  private shutdownPromise: Promise<void> | undefined;

  /**
   * Creates an isolated artifact session so parallel extension windows cannot delete each other.
   *
   * @param globalStorageUri VS Code-managed extension storage root.
   * @param log Diagnostic channel used for best-effort cleanup failures.
   */
  public constructor(
    globalStorageUri: vscode.Uri,
    private readonly log: vscode.LogOutputChannel,
  ) {
    this.resourceRoot = vscode.Uri.joinPath(globalStorageUri, 'preview-cache', randomUUID());
  }

  /**
   * Writes a complete hashed revision before exposing its URIs without deleting other revisions.
   * Cleanup waits for the controller to confirm which asynchronous build actually became current.
   *
   * @param bundle In-memory JavaScript and optional stylesheet from the compiler.
   * @returns Serialized local locations suitable for later `webview.asWebviewUri` conversion.
   */
  public publish(bundle: PreviewBundle): Promise<StoredPreviewArtifact> {
    if (this.disposed) {
      return Promise.reject(new Error('The React preview artifact session is already closed.'));
    }

    const contentHash = createContentHash(bundle);
    const publicationSequence = ++this.publicationSequence;
    this.publicationSequenceByHash.set(contentHash, publicationSequence);

    return this.enqueueOperation(async () => this.writeBundle(contentHash, bundle));
  }

  /**
   * Writes one complete bundle while the store's mutation queue excludes prune and shutdown work.
   *
   * @param contentHash Deterministic directory name calculated before the operation was queued.
   * @param bundle In-memory JavaScript and optional CSS to publish.
   * @returns Serialized locations for the completed artifact set.
   */
  private async writeBundle(
    contentHash: string,
    bundle: PreviewBundle,
  ): Promise<StoredPreviewArtifact> {
    const revisionDirectory = vscode.Uri.joinPath(this.resourceRoot, contentHash);
    const scriptUri = vscode.Uri.joinPath(revisionDirectory, 'entry.js');

    await vscode.workspace.fs.createDirectory(revisionDirectory);
    await vscode.workspace.fs.writeFile(scriptUri, bundle.javascript);

    const stylesheetUri = await this.writeStylesheet(revisionDirectory, bundle.stylesheet);
    const baseArtifact = {
      contentHash,
      scriptLocation: scriptUri.toString(true),
    };

    return stylesheetUri === undefined
      ? baseArtifact
      : { ...baseArtifact, stylesheetLocation: stylesheetUri.toString(true) };
  }

  /**
   * Removes every hash directory except the revision confirmed as current by the controller.
   * A stale build may publish after this method, but it cannot remove the retained current files and
   * will be cleaned by the next committed revision or session disposal.
   *
   * @param contentHash Hash-directory name that must remain available to the current webview.
   */
  public async pruneExcept(contentHash: string): Promise<void> {
    if (this.disposed) {
      return;
    }

    const retainedSequence = this.publicationSequenceByHash.get(contentHash);
    if (retainedSequence === undefined) {
      this.log.debug(`Cannot retain unknown React preview artifact ${contentHash}.`);
      return;
    }

    await this.enqueueOperation(async () => {
      try {
        const entries = await vscode.workspace.fs.readDirectory(this.resourceRoot);
        const removableEntries = entries.filter(([entryName, fileType]) => {
          const entrySequence = this.publicationSequenceByHash.get(entryName) ?? 0;
          return (
            fileType === vscode.FileType.Directory &&
            entryName !== contentHash &&
            entrySequence <= retainedSequence
          );
        });

        for (const [entryName] of removableEntries) {
          await this.deleteDirectory(vscode.Uri.joinPath(this.resourceRoot, entryName));
          this.publicationSequenceByHash.delete(entryName);
        }
      } catch (error) {
        this.log.debug('Could not prune superseded React preview artifacts.', error);
      }
    });
  }

  /**
   * Schedules ordered removal of all files created by this extension-window session.
   * Callers that control extension deactivation should await `shutdown()` for guaranteed completion.
   */
  public dispose(): void {
    void this.shutdown();
  }

  /**
   * Rejects future publications, waits for already queued mutations, and removes the session cache.
   * Repeated calls share one promise so context disposal and explicit deactivation remain idempotent.
   *
   * @returns Promise resolved after the session directory has been removed or cleanup was logged.
   */
  public shutdown(): Promise<void> {
    if (this.shutdownPromise !== undefined) {
      return this.shutdownPromise;
    }

    this.disposed = true;
    this.shutdownPromise = this.enqueueOperation(async () => {
      await this.deleteDirectory(this.resourceRoot);
      this.publicationSequenceByHash.clear();
    });
    return this.shutdownPromise;
  }

  /**
   * Writes a stylesheet only when esbuild emitted one for the current component graph.
   *
   * @param revisionDirectory Hash-specific output directory.
   * @param stylesheet Optional stylesheet bytes.
   * @returns Written stylesheet URI or `undefined` when the bundle contains no CSS.
   */
  private async writeStylesheet(
    revisionDirectory: vscode.Uri,
    stylesheet: Uint8Array | undefined,
  ): Promise<vscode.Uri | undefined> {
    if (stylesheet === undefined) {
      return undefined;
    }

    const stylesheetUri = vscode.Uri.joinPath(revisionDirectory, 'entry.css');
    await vscode.workspace.fs.writeFile(stylesheetUri, stylesheet);
    return stylesheetUri;
  }

  /**
   * Removes one generated directory without surfacing cleanup failures to preview users.
   *
   * @param directoryUri Generated directory to remove recursively.
   * @returns A promise that always resolves after deletion succeeds or is logged.
   */
  private async deleteDirectory(directoryUri: vscode.Uri): Promise<void> {
    try {
      await vscode.workspace.fs.delete(directoryUri, { recursive: true, useTrash: false });
    } catch (error) {
      this.log.debug(`Could not remove preview cache ${directoryUri.toString(true)}.`, error);
    }
  }

  /**
   * Serializes every filesystem mutation and keeps the queue usable after an operation rejects.
   * Publication sequence metadata is recorded before enqueueing, so an older prune can recognize and
   * preserve a newer artifact even when that artifact's write is waiting behind the prune operation.
   *
   * @param operation Asynchronous filesystem mutation that must not overlap another store mutation.
   * @returns Promise carrying the operation's original result or rejection.
   */
  private enqueueOperation<Result>(operation: () => Promise<Result>): Promise<Result> {
    const result = this.operationQueue.then(operation, operation);
    this.operationQueue = result.then(
      () => undefined,
      () => undefined,
    );
    return result;
  }
}

/**
 * Computes a short deterministic revision digest over JavaScript and optional stylesheet bytes.
 *
 * @param bundle Compiled bytes whose identity should be stable across equivalent rebuilds.
 * @returns Sixteen hexadecimal characters used as a cache-busting directory name.
 */
function createContentHash(bundle: PreviewBundle): string {
  const hash = createHash('sha256');
  hash.update(bundle.javascript);
  hash.update('\0react-preview-stylesheet\0');
  if (bundle.stylesheet !== undefined) {
    hash.update(bundle.stylesheet);
  }

  return hash.digest('hex').slice(0, 16);
}
