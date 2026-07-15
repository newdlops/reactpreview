/**
 * Verifies reference-counted cache leases with a minimal in-memory VS Code filesystem.
 * The key invariant is that one preview cannot delete bytes still owned by another open panel.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import * as vscode from 'vscode';
import { GlobalStoragePreviewArtifactStore } from '../../../src/adapters/vscode/globalStoragePreviewArtifactStore';
import type { PreviewBundle } from '../../../src/domain/preview';

const vscodeFileSystem = vi.hoisted(() => ({
  createDirectory: vi.fn<(uri: unknown) => Promise<void>>().mockResolvedValue(undefined),
  delete: vi.fn<(uri: unknown, options: unknown) => Promise<void>>().mockResolvedValue(undefined),
  writeFile: vi
    .fn<(uri: unknown, contents: Uint8Array) => Promise<void>>()
    .mockResolvedValue(undefined),
}));

vi.mock('vscode', () => {
  /** Minimal URI implementation sufficient for storage-path composition and serialization. */
  class FakeUri {
    /**
     * Creates one immutable fake filesystem path.
     *
     * @param pathValue Normalized path represented by this URI.
     */
    public constructor(public readonly pathValue: string) {}

    /**
     * Joins path segments in the same deterministic style required by the storage adapter.
     *
     * @param base Base fake URI.
     * @param segments Child path segments.
     * @returns New fake URI for the joined path.
     */
    public static joinPath(base: FakeUri, ...segments: readonly string[]): FakeUri {
      return new FakeUri([base.pathValue, ...segments].join('/').replaceAll('//', '/'));
    }

    /**
     * Creates a fake file URI for a test root path.
     *
     * @param filePath Absolute test path.
     * @returns Fake URI containing the supplied path.
     */
    public static file(filePath: string): FakeUri {
      return new FakeUri(filePath);
    }

    /**
     * Serializes the fake path into a stable file URI.
     *
     * @returns File URI used by assertions and domain artifact locations.
     */
    public toString(): string {
      return `file://${this.pathValue}`;
    }
  }

  return {
    Uri: FakeUri,
    workspace: { fs: vscodeFileSystem },
  };
});

const FIRST_BUNDLE: PreviewBundle = {
  dependencies: [],
  diagnostics: [],
  javascript: new TextEncoder().encode('first revision'),
  watchDirectories: [],
};

const SECOND_BUNDLE: PreviewBundle = {
  dependencies: [],
  diagnostics: [],
  javascript: new TextEncoder().encode('second revision'),
  watchDirectories: [],
};

afterEach(() => {
  vi.clearAllMocks();
});

describe('GlobalStoragePreviewArtifactStore', () => {
  /**
   * Keeps both published hashes until the controller identifies the revision that actually won.
   */
  it('does not delete artifacts during publication', async () => {
    const store = createStore();

    await store.publish(FIRST_BUNDLE);
    await store.publish(SECOND_BUNDLE);

    expect(vscodeFileSystem.delete).not.toHaveBeenCalled();
  });

  /** Releases independent hashes without deleting an artifact still owned by another panel. */
  it('deletes only the released artifact directory', async () => {
    const store = createStore();
    const firstArtifact = await store.publish(FIRST_BUNDLE);
    const secondArtifact = await store.publish(SECOND_BUNDLE);

    await store.release(firstArtifact.contentHash);

    expect(vscodeFileSystem.delete).toHaveBeenCalledTimes(1);
    expect(String(vscodeFileSystem.delete.mock.calls[0]?.[0])).toContain(firstArtifact.contentHash);
    expect(String(vscodeFileSystem.delete.mock.calls[0]?.[0])).not.toContain(
      secondArtifact.contentHash,
    );
  });

  /** Keeps a shared content hash until every panel has returned its independently acquired lease. */
  it('reference-counts identical bundles across panels', async () => {
    const store = createStore();
    const firstArtifact = await store.publish(FIRST_BUNDLE);
    const sharedArtifact = await store.publish(FIRST_BUNDLE);

    expect(sharedArtifact.contentHash).toBe(firstArtifact.contentHash);
    expect(vscodeFileSystem.writeFile).toHaveBeenCalledTimes(1);
    await store.release(firstArtifact.contentHash);
    expect(vscodeFileSystem.delete).not.toHaveBeenCalled();

    await store.release(sharedArtifact.contentHash);
    expect(vscodeFileSystem.delete).toHaveBeenCalledTimes(1);
    expect(String(vscodeFileSystem.delete.mock.calls[0]?.[0])).toContain(firstArtifact.contentHash);
  });

  /** Removes a partial unowned hash directory when publication fails before acquiring its lease. */
  it('cleans a partially written new artifact after publication failure', async () => {
    const store = createStore();
    vscodeFileSystem.writeFile.mockRejectedValueOnce(new Error('simulated storage write failure'));

    await expect(store.publish(FIRST_BUNDLE)).rejects.toThrow('simulated storage write failure');

    expect(vscodeFileSystem.delete).toHaveBeenCalledTimes(1);
    expect(String(vscodeFileSystem.delete.mock.calls[0]?.[0])).toMatch(
      /preview-cache\/[^/]+\/[a-f0-9]{16}$/u,
    );
  });

  /** Waits for session deletion and rejects later writes that could recreate private source caches. */
  it('shuts down idempotently and rejects future publication', async () => {
    const store = createStore();
    await store.publish(FIRST_BUNDLE);

    const firstShutdown = store.shutdown();
    const secondShutdown = store.shutdown();
    await Promise.all([firstShutdown, secondShutdown]);

    expect(firstShutdown).toBe(secondShutdown);
    expect(vscodeFileSystem.delete).toHaveBeenCalledTimes(1);
    await expect(store.publish(SECOND_BUNDLE)).rejects.toThrow('already closed');
  });
});

/**
 * Creates a store with typed VS Code boundaries and a silent diagnostic channel.
 *
 * @returns Artifact store backed by the hoisted in-memory filesystem mock.
 */
function createStore(): GlobalStoragePreviewArtifactStore {
  const log = { debug: vi.fn() } as unknown as vscode.LogOutputChannel;
  return new GlobalStoragePreviewArtifactStore(vscode.Uri.file('/global-storage'), log);
}
