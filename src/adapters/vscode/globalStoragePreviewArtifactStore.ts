/**
 * Publishes preview bundles into a session-specific, content-addressed VS Code storage tree.
 *
 * Entry modules live at the session root so esbuild's `./chunks/...` imports keep resolving after
 * publication. Unchanged entry, chunk, and stylesheet files retain stable URIs across revisions;
 * independent bundle leases hold shared-file references until hot reload or panel cleanup releases
 * the final owner. Filesystem work is bounded rather than serialized one file at a time.
 */
import { randomUUID } from 'node:crypto';
import * as vscode from 'vscode';
import type { PreviewArtifactStore } from '../../application/previewArtifactStore';
import type { PreviewBundle, StoredPreviewArtifact } from '../../domain/preview';
import {
  createPreviewArtifactPathIdentity,
  planPreviewArtifactLayout,
  type PlannedPreviewArtifactFile,
  type PreviewArtifactLayout,
} from './previewArtifactLayout';

/** Reduces local and remote publication round trips without opening unbounded filesystem work. */
const MAX_PARALLEL_ARTIFACT_IO = 16;

/** One portable path identity retained as a live file record or session-long URL tombstone. */
interface SharedArtifactFileRecord {
  /** Byte digest permanently associated with this browser URL for the complete session. */
  readonly contentDigest: string;
  /** Exact portable path retained to reject case aliases even when their digest is equal. */
  readonly relativePath: string;
  /** Number of distinct live artifact identities requiring the file; zero is a URL tombstone. */
  readonly references: number;
}

/** Byte-free file identity retained after publication so leases do not pin esbuild output buffers. */
interface PublishedArtifactFileIdentity {
  /** Full digest used to verify a later same-bundle or same-path publication. */
  readonly contentDigest: string;
  /** Session-relative file path used for reference release and deletion. */
  readonly relativePath: string;
}

/** Minimal immutable layout retained for URI reconstruction and shared-file release. */
interface PublishedArtifactLayout {
  /** Bundle identity used by the application lease contract. */
  readonly contentHash: string;
  /** Root-level content-addressed browser entry path. */
  readonly entryPath: string;
  /** Byte-free identities of every file required by this bundle. */
  readonly files: readonly PublishedArtifactFileIdentity[];
  /** Optional content-addressed stylesheet path. */
  readonly stylesheetPath?: string;
}

/** One application-level artifact lease and the shared layout it keeps reachable. */
interface PublishedArtifactRecord {
  /** Immutable files and browser entry locations associated with this bundle identity. */
  readonly layout: PublishedArtifactLayout;
  /** Number of panels or in-flight revisions that independently acquired this exact bundle. */
  readonly references: number;
}

/** Result of a bounded write batch, including files safe to remove after partial failure. */
interface SharedFileWriteResult {
  /** First write failure after every started worker has settled. */
  readonly error?: Error;
  /** Files whose required writes completed and are safe to remove after publication failure. */
  readonly writtenFiles: readonly PlannedPreviewArtifactFile[];
}

/** VS Code filesystem-backed store for cache-busted, reference-counted preview artifacts. */
export class GlobalStoragePreviewArtifactStore implements PreviewArtifactStore, vscode.Disposable {
  /** Directory that should be used as the webview's sole generated local-resource root. */
  public readonly resourceRoot: vscode.Uri;

  private readonly artifactByHash = new Map<string, PublishedArtifactRecord>();
  private disposed = false;
  private operationQueue: Promise<void> = Promise.resolve();
  private readonly sharedFileByIdentity = new Map<string, SharedArtifactFileRecord>();
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
   * Publishes missing shared files and acquires one application-level artifact lease atomically.
   *
   * Planning and validation happen before entering the mutation queue. The queue protects reference
   * counts and path collision checks, while the actual independent directory and file operations run
   * with a small concurrency bound to reduce publication latency on code-split applications.
   *
   * @param bundle In-memory entry, lazy JavaScript chunks, and optional aggregate stylesheet.
   * @returns Stable serialized locations suitable for `webview.asWebviewUri` conversion.
   */
  public publish(bundle: PreviewBundle): Promise<StoredPreviewArtifact> {
    if (this.disposed) {
      return Promise.reject(new Error('The React preview artifact session is already closed.'));
    }

    let layout: PreviewArtifactLayout;
    try {
      layout = planPreviewArtifactLayout(bundle);
    } catch (error) {
      return Promise.reject(
        error instanceof Error
          ? error
          : new TypeError('Invalid React preview artifact layout.', { cause: error }),
      );
    }

    return this.enqueueOperation(async () => {
      const publishedArtifact = this.artifactByHash.get(layout.contentHash);
      if (publishedArtifact !== undefined) {
        assertEquivalentLayouts(publishedArtifact.layout, layout);
        this.artifactByHash.set(layout.contentHash, {
          layout: publishedArtifact.layout,
          references: publishedArtifact.references + 1,
        });
        return this.describeLayout(publishedArtifact.layout);
      }

      this.assertSharedPathsAreCompatible(layout.files);
      const missingFiles = layout.files.filter((file) => this.requiresFileWrite(file));
      const writeResult = await this.writeMissingFiles(missingFiles);
      if (writeResult.error !== undefined) {
        await this.deleteFiles(writeResult.writtenFiles);
        throw writeResult.error;
      }

      this.acquireSharedFiles(layout.files);
      this.artifactByHash.set(layout.contentHash, {
        layout: createPublishedArtifactLayout(layout),
        references: 1,
      });
      return this.describeLayout(layout);
    });
  }

  /**
   * Rejects a browser URL ever associated with different bytes during this extension session.
   * Tombstones remain after file deletion because a retained webview's ESM module map is URL-keyed;
   * rewriting the same URL with new bytes could otherwise resurrect an obsolete lazy module.
   */
  private assertSharedPathsAreCompatible(files: readonly PlannedPreviewArtifactFile[]): void {
    for (const file of files) {
      const identity = createPreviewArtifactPathIdentity(file.relativePath);
      const sharedFile = this.sharedFileByIdentity.get(identity);
      if (sharedFile !== undefined && sharedFile.relativePath !== file.relativePath) {
        throw new TypeError(
          `React preview shared artifact paths collide on a portable filesystem: ${sharedFile.relativePath} and ${file.relativePath}`,
        );
      }
      if (sharedFile !== undefined && sharedFile.contentDigest !== file.contentDigest) {
        throw new TypeError(
          `React preview shared artifact path changed contents: ${file.relativePath}`,
        );
      }
    }
  }

  /**
   * Reports whether a new file or zero-reference tombstone requires a durable write before lease
   * acquisition. Live records already guarantee compatible bytes through the preceding assertion.
   *
   * @param file Validated file considered for the current bundle publication.
   * @returns `true` when no live shared filesystem file currently owns the portable identity.
   */
  private requiresFileWrite(file: PlannedPreviewArtifactFile): boolean {
    const identity = createPreviewArtifactPathIdentity(file.relativePath);
    return (this.sharedFileByIdentity.get(identity)?.references ?? 0) === 0;
  }

  /**
   * Creates required parent directories and writes only files absent from the session cache.
   * The batch waits for every worker before reporting failure so rollback never races a late write.
   */
  private async writeMissingFiles(
    files: readonly PlannedPreviewArtifactFile[],
  ): Promise<SharedFileWriteResult> {
    if (files.length === 0) {
      return { writtenFiles: [] };
    }

    const directories = collectParentDirectories(files);
    const directoryResult = await runBoundedOperations(
      directories,
      MAX_PARALLEL_ARTIFACT_IO,
      async (pathSegments) => {
        await vscode.workspace.fs.createDirectory(
          vscode.Uri.joinPath(this.resourceRoot, ...pathSegments),
        );
      },
    );
    if (directoryResult.error !== undefined) {
      return { error: directoryResult.error, writtenFiles: [] };
    }

    const writtenFiles: PlannedPreviewArtifactFile[] = [];
    const writeResult = await runBoundedOperations(
      files,
      MAX_PARALLEL_ARTIFACT_IO,
      async (file) => {
        await vscode.workspace.fs.writeFile(this.createFileUri(file.relativePath), file.contents);
        writtenFiles.push(file);
      },
    );
    return writeResult.error === undefined
      ? { writtenFiles }
      : { error: writeResult.error, writtenFiles };
  }

  /** Increments shared-file ownership after the complete missing-file batch succeeds. */
  private acquireSharedFiles(files: readonly PlannedPreviewArtifactFile[]): void {
    for (const file of files) {
      const identity = createPreviewArtifactPathIdentity(file.relativePath);
      const current = this.sharedFileByIdentity.get(identity);
      this.sharedFileByIdentity.set(identity, {
        contentDigest: file.contentDigest,
        relativePath: current?.relativePath ?? file.relativePath,
        references: (current?.references ?? 0) + 1,
      });
    }
  }

  /**
   * Recreates stable artifact locations for a newly written or already shared content identity.
   * No filesystem lookup is required because the immutable layout is retained with its lease.
   */
  private describeLayout(
    layout: Pick<PublishedArtifactLayout, 'contentHash' | 'entryPath' | 'stylesheetPath'>,
  ): StoredPreviewArtifact {
    const baseArtifact = {
      contentHash: layout.contentHash,
      scriptLocation: this.createFileUri(layout.entryPath).toString(true),
    };
    return layout.stylesheetPath === undefined
      ? baseArtifact
      : {
          ...baseArtifact,
          stylesheetLocation: this.createFileUri(layout.stylesheetPath).toString(true),
        };
  }

  /** Converts one already validated POSIX relative path into a session-local file URI. */
  private createFileUri(relativePath: string): vscode.Uri {
    return vscode.Uri.joinPath(this.resourceRoot, ...relativePath.split('/'));
  }

  /**
   * Returns one bundle lease and removes each shared file only after its final distinct artifact.
   * The old artifact remains leased until browser hot-reload acknowledgement, so dynamic imports
   * already in flight cannot lose chunks during a revision transition.
   *
   * @param contentHash Bundle identity returned by an earlier successful publication.
   */
  public async release(contentHash: string): Promise<void> {
    if (this.disposed) {
      return;
    }

    await this.enqueueOperation(async () => {
      const artifact = this.artifactByHash.get(contentHash);
      if (artifact === undefined) {
        this.log.debug(`Cannot release unknown React preview artifact ${contentHash}.`);
        return;
      }
      if (artifact.references > 1) {
        this.artifactByHash.set(contentHash, {
          layout: artifact.layout,
          references: artifact.references - 1,
        });
        return;
      }

      this.artifactByHash.delete(contentHash);
      const orphanedFiles: PublishedArtifactFileIdentity[] = [];
      for (const file of artifact.layout.files) {
        const identity = createPreviewArtifactPathIdentity(file.relativePath);
        const sharedFile = this.sharedFileByIdentity.get(identity);
        if (sharedFile === undefined) {
          this.log.debug(`Cannot release unknown React preview file ${file.relativePath}.`);
          continue;
        }
        if (sharedFile.references > 1) {
          this.sharedFileByIdentity.set(identity, {
            contentDigest: sharedFile.contentDigest,
            relativePath: sharedFile.relativePath,
            references: sharedFile.references - 1,
          });
        } else {
          this.sharedFileByIdentity.set(identity, {
            contentDigest: sharedFile.contentDigest,
            relativePath: sharedFile.relativePath,
            references: 0,
          });
          orphanedFiles.push(file);
        }
      }
      await this.deleteFiles(orphanedFiles);
    });
  }

  /** Schedules ordered cleanup; deactivation callers should await `shutdown()` when possible. */
  public dispose(): void {
    void this.shutdown();
  }

  /**
   * Rejects future publications, drains queued mutations, and removes the entire private session.
   * Repeated calls share one promise so context disposal and explicit deactivation are idempotent.
   */
  public shutdown(): Promise<void> {
    if (this.shutdownPromise !== undefined) {
      return this.shutdownPromise;
    }

    this.disposed = true;
    this.shutdownPromise = this.enqueueOperation(async () => {
      await this.deleteDirectory(this.resourceRoot);
      this.artifactByHash.clear();
      this.sharedFileByIdentity.clear();
    });
    return this.shutdownPromise;
  }

  /** Deletes shared files concurrently while converting cleanup failures into diagnostics. */
  private async deleteFiles(files: readonly PublishedArtifactFileIdentity[]): Promise<void> {
    await runBoundedOperations(files, MAX_PARALLEL_ARTIFACT_IO, async (file) => {
      const fileUri = this.createFileUri(file.relativePath);
      try {
        await vscode.workspace.fs.delete(fileUri, { recursive: false, useTrash: false });
      } catch (error) {
        this.log.debug(`Could not remove preview cache file ${fileUri.toString(true)}.`, error);
      }
    });
  }

  /** Removes the private session directory without surfacing best-effort cleanup failures. */
  private async deleteDirectory(directoryUri: vscode.Uri): Promise<void> {
    try {
      await vscode.workspace.fs.delete(directoryUri, { recursive: true, useTrash: false });
    } catch (error) {
      this.log.debug(`Could not remove preview cache ${directoryUri.toString(true)}.`, error);
    }
  }

  /**
   * Serializes reference-count mutations and keeps the queue usable after one operation rejects.
   * Independent I/O inside a publication remains bounded and parallel beneath this atomic boundary.
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

/** Collects unique parent directories in lexical order; the root is included for root-level entry. */
function collectParentDirectories(
  files: readonly PlannedPreviewArtifactFile[],
): readonly (readonly string[])[] {
  const directoryByPath = new Map<string, readonly string[]>();
  directoryByPath.set('', []);
  for (const file of files) {
    const segments = file.relativePath.split('/');
    segments.pop();
    if (segments.length > 0) {
      directoryByPath.set(segments.join('/'), segments);
    }
  }
  return [...directoryByPath.entries()]
    .sort(([left], [right]) => (left < right ? -1 : left > right ? 1 : 0))
    .map(([, segments]) => segments);
}

/** Result shared by bounded directory, write, and delete worker batches. */
interface BoundedOperationResult {
  /** First failure observed after all workers have settled. */
  readonly error?: Error;
}

/**
 * Runs independent asynchronous work with a fixed upper concurrency bound and waits for all workers.
 * Workers continue after an individual rejection so callers can safely roll back every completed
 * write without a later promise mutating the filesystem after rollback begins.
 */
async function runBoundedOperations<Item>(
  items: readonly Item[],
  maximumConcurrency: number,
  operation: (item: Item) => Promise<void>,
): Promise<BoundedOperationResult> {
  let nextIndex = 0;
  let firstError: Error | undefined;
  const workerCount = Math.min(maximumConcurrency, items.length);
  const workers = Array.from({ length: workerCount }, async () => {
    while (nextIndex < items.length) {
      const item = items[nextIndex];
      nextIndex += 1;
      if (item === undefined) {
        continue;
      }
      try {
        await operation(item);
      } catch (error) {
        firstError ??= normalizeOperationError(error);
      }
    }
  });
  await Promise.all(workers);
  return firstError === undefined ? {} : { error: firstError };
}

/** Converts arbitrary promise rejections into values legal and useful at a TypeScript throw site. */
function normalizeOperationError(error: unknown): Error {
  return error instanceof Error
    ? error
    : new Error('React preview artifact filesystem operation failed.', { cause: error });
}

/**
 * Defends the shortened application lease identity against an otherwise theoretical hash collision.
 * The full per-file digests remain the authoritative byte identities for shared storage paths.
 */
function assertEquivalentLayouts(
  published: PublishedArtifactLayout,
  candidate: PreviewArtifactLayout,
): void {
  const filesMatch =
    published.files.length === candidate.files.length &&
    published.files.every((file, index) => {
      const candidateFile = candidate.files[index];
      return (
        candidateFile?.relativePath === file.relativePath &&
        candidateFile.contentDigest === file.contentDigest
      );
    });
  if (
    published.entryPath !== candidate.entryPath ||
    published.stylesheetPath !== candidate.stylesheetPath ||
    !filesMatch
  ) {
    throw new TypeError(`React preview artifact identity collision: ${candidate.contentHash}`);
  }
}

/** Drops file contents after durable publication while preserving exact collision identities. */
function createPublishedArtifactLayout(layout: PreviewArtifactLayout): PublishedArtifactLayout {
  const baseLayout = {
    contentHash: layout.contentHash,
    entryPath: layout.entryPath,
    files: layout.files.map((file) => ({
      contentDigest: file.contentDigest,
      relativePath: file.relativePath,
    })),
  };
  return layout.stylesheetPath === undefined
    ? baseLayout
    : { ...baseLayout, stylesheetPath: layout.stylesheetPath };
}
