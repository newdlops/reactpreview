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
  private readonly referenceCountByHash = new Map<string, number>();
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
   * Writes a complete hashed revision and acquires one ownership reference after the write succeeds.
   *
   * @param bundle In-memory JavaScript and optional stylesheet from the compiler.
   * @returns Serialized local locations suitable for later `webview.asWebviewUri` conversion.
   */
  public publish(bundle: PreviewBundle): Promise<StoredPreviewArtifact> {
    if (this.disposed) {
      return Promise.reject(new Error('The React preview artifact session is already closed.'));
    }

    const contentHash = createContentHash(bundle);
    return this.enqueueOperation(async () => {
      const currentReferences = this.referenceCountByHash.get(contentHash) ?? 0;
      if (currentReferences > 0) {
        this.referenceCountByHash.set(contentHash, currentReferences + 1);
        return this.describeBundle(contentHash, bundle.stylesheet !== undefined);
      }

      let artifact: StoredPreviewArtifact;
      try {
        artifact = await this.writeBundle(contentHash, bundle);
      } catch (error) {
        await this.deleteDirectory(vscode.Uri.joinPath(this.resourceRoot, contentHash));
        throw error;
      }
      this.referenceCountByHash.set(contentHash, currentReferences + 1);
      return artifact;
    });
  }

  /**
   * Writes one complete bundle while the store's mutation queue excludes release and shutdown work.
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

    await vscode.workspace.fs.createDirectory(revisionDirectory);
    await vscode.workspace.fs.writeFile(
      vscode.Uri.joinPath(revisionDirectory, 'entry.js'),
      bundle.javascript,
    );

    const stylesheetUri = await this.writeStylesheet(revisionDirectory, bundle.stylesheet);
    return this.describeBundle(contentHash, stylesheetUri !== undefined);
  }

  /**
   * Recreates stable artifact locations for a newly written or already shared content hash.
   *
   * @param contentHash Deterministic hash-directory name.
   * @param hasStylesheet Whether this content identity includes a CSS output.
   * @returns Opaque local locations without touching the filesystem.
   */
  private describeBundle(contentHash: string, hasStylesheet: boolean): StoredPreviewArtifact {
    const revisionDirectory = vscode.Uri.joinPath(this.resourceRoot, contentHash);
    const baseArtifact = {
      contentHash,
      scriptLocation: vscode.Uri.joinPath(revisionDirectory, 'entry.js').toString(true),
    };
    return hasStylesheet
      ? {
          ...baseArtifact,
          stylesheetLocation: vscode.Uri.joinPath(revisionDirectory, 'entry.css').toString(true),
        }
      : baseArtifact;
  }

  /**
   * Releases one published ownership reference and deletes the directory after its final owner.
   * All mutations share the store queue, so a concurrent publish cannot race a zero-count deletion.
   *
   * @param contentHash Hash-directory name no longer needed by one preview revision.
   */
  public async release(contentHash: string): Promise<void> {
    if (this.disposed) {
      return;
    }

    await this.enqueueOperation(async () => {
      const currentReferences = this.referenceCountByHash.get(contentHash);
      if (currentReferences === undefined) {
        this.log.debug(`Cannot release unknown React preview artifact ${contentHash}.`);
        return;
      }

      if (currentReferences > 1) {
        this.referenceCountByHash.set(contentHash, currentReferences - 1);
        return;
      }

      this.referenceCountByHash.delete(contentHash);
      await this.deleteDirectory(vscode.Uri.joinPath(this.resourceRoot, contentHash));
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
      this.referenceCountByHash.clear();
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
   * Reference counts are updated inside the same queue so publish and release stay atomic.
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
