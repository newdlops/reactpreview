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
  chunks: [],
  dependencies: [],
  diagnostics: [],
  javascript: new TextEncoder().encode('first revision'),
  watchDirectories: [],
};

const SECOND_BUNDLE: PreviewBundle = {
  chunks: [],
  dependencies: [],
  diagnostics: [],
  javascript: new TextEncoder().encode('second revision'),
  watchDirectories: [],
};

const CHUNKED_BUNDLE: PreviewBundle = {
  ...FIRST_BUNDLE,
  chunks: [
    {
      contents: new TextEncoder().encode('export const later = true;'),
      relativePath: 'chunks/z-later.js',
    },
    {
      contents: new TextEncoder().encode('export const nested = true;'),
      relativePath: 'chunks/routes/nested.js',
    },
  ],
};

afterEach(() => {
  vi.clearAllMocks();
});

describe('GlobalStoragePreviewArtifactStore', () => {
  /** Preserves nested esbuild output paths so relative dynamic imports resolve in the webview. */
  it('writes auxiliary chunks below their hash revision in lexical order', async () => {
    const store = createStore();

    const artifact = await store.publish(CHUNKED_BUNDLE);

    expect(vscodeFileSystem.writeFile.mock.calls.map((call) => String(call[0]))).toEqual([
      expect.stringContaining(`${artifact.contentHash}/entry.js`),
      expect.stringContaining(`${artifact.contentHash}/chunks/routes/nested.js`),
      expect.stringContaining(`${artifact.contentHash}/chunks/z-later.js`),
    ]);
    expect(vscodeFileSystem.createDirectory.mock.calls.map((call) => String(call[0]))).toEqual([
      expect.stringMatching(new RegExp(`${artifact.contentHash}$`, 'u')),
      expect.stringContaining(`${artifact.contentHash}/chunks/routes`),
      expect.stringContaining(`${artifact.contentHash}/chunks`),
    ]);
    expect(artifact.scriptLocation).toContain(`${artifact.contentHash}/entry.js`);
    expect(artifact).not.toHaveProperty('stylesheetLocation');
  });

  /** Makes chunk order irrelevant while retaining both paths and bytes in the content identity. */
  it('hashes sorted chunk paths and contents', async () => {
    const store = createStore();
    const firstArtifact = await store.publish(CHUNKED_BUNDLE);
    const reorderedArtifact = await store.publish({
      ...CHUNKED_BUNDLE,
      chunks: [...CHUNKED_BUNDLE.chunks].reverse(),
    });
    const changedBytesArtifact = await store.publish({
      ...CHUNKED_BUNDLE,
      chunks: CHUNKED_BUNDLE.chunks.map((chunk, index) =>
        index === 0
          ? { ...chunk, contents: new TextEncoder().encode('export const later = false;') }
          : chunk,
      ),
    });
    const changedPathArtifact = await store.publish({
      ...CHUNKED_BUNDLE,
      chunks: CHUNKED_BUNDLE.chunks.map((chunk, index) =>
        index === 0 ? { ...chunk, relativePath: 'chunks/a-later.js' } : chunk,
      ),
    });

    expect(reorderedArtifact.contentHash).toBe(firstArtifact.contentHash);
    expect(changedBytesArtifact.contentHash).not.toBe(firstArtifact.contentHash);
    expect(changedPathArtifact.contentHash).not.toBe(firstArtifact.contentHash);
    expect(vscodeFileSystem.writeFile).toHaveBeenCalledTimes(9);
  });

  /** Rejects every non-portable or escaping path before creating an artifact revision. */
  it.each([
    '/chunks/absolute.js',
    'chunks\\windows.js',
    'chunks/../escape.js',
    'chunks/./same.js',
    'chunks//empty.js',
    'chunks/not-javascript.css',
    'outside/module.js',
    'chunks/nul\0byte.js',
  ])('rejects unsafe auxiliary chunk path %j', async (relativePath) => {
    const store = createStore();
    const invalidBundle: PreviewBundle = {
      ...FIRST_BUNDLE,
      chunks: [{ contents: new Uint8Array(), relativePath }],
    };

    await expect(store.publish(invalidBundle)).rejects.toThrow('Invalid React preview chunk path');

    expect(vscodeFileSystem.createDirectory).not.toHaveBeenCalled();
    expect(vscodeFileSystem.writeFile).not.toHaveBeenCalled();
    expect(vscodeFileSystem.delete).not.toHaveBeenCalled();
  });

  /** Prevents colliding output identities and bounds filesystem fan-out per preview revision. */
  it('rejects duplicate paths and more than 128 chunks', async () => {
    const store = createStore();
    const duplicateBundle: PreviewBundle = {
      ...FIRST_BUNDLE,
      chunks: [
        { contents: new Uint8Array([1]), relativePath: 'chunks/shared.js' },
        { contents: new Uint8Array([2]), relativePath: 'chunks/shared.js' },
      ],
    };
    const oversizedBundle: PreviewBundle = {
      ...FIRST_BUNDLE,
      chunks: Array.from({ length: 129 }, (_, index) => ({
        contents: new Uint8Array(),
        relativePath: `chunks/${index.toString()}.js`,
      })),
    };

    await expect(store.publish(duplicateBundle)).rejects.toThrow(
      'Duplicate React preview chunk path',
    );
    await expect(store.publish(oversizedBundle)).rejects.toThrow('at most 128 auxiliary chunks');

    expect(vscodeFileSystem.createDirectory).not.toHaveBeenCalled();
    expect(vscodeFileSystem.writeFile).not.toHaveBeenCalled();
  });

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

  /** Removes entry bytes and parent directories when an auxiliary-file write fails mid-publication. */
  it('cleans a partially written new artifact after chunk publication failure', async () => {
    const store = createStore();
    vscodeFileSystem.writeFile
      .mockResolvedValueOnce(undefined)
      .mockRejectedValueOnce(new Error('simulated chunk write failure'));

    await expect(
      store.publish({
        ...FIRST_BUNDLE,
        chunks: [
          {
            contents: new TextEncoder().encode('failed chunk'),
            relativePath: 'chunks/failed.js',
          },
        ],
      }),
    ).rejects.toThrow('simulated chunk write failure');

    expect(vscodeFileSystem.writeFile).toHaveBeenCalledTimes(2);
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
