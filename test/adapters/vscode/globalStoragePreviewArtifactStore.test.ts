/**
 * Verifies content-addressed publication and reference-counted cache leases with a minimal VS Code
 * filesystem. The central invariant is that one revision cannot overwrite or remove bytes still
 * required by another open panel or in-flight hot reload.
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
    /** Creates one immutable fake filesystem path. */
    public constructor(public readonly pathValue: string) {}

    /** Joins child path segments using the portable form expected by the adapter. */
    public static joinPath(base: FakeUri, ...segments: readonly string[]): FakeUri {
      return new FakeUri([base.pathValue, ...segments].join('/').replaceAll('//', '/'));
    }

    /** Creates a fake file URI for a test root path. */
    public static file(filePath: string): FakeUri {
      return new FakeUri(filePath);
    }

    /** Serializes the fake path into a stable file URI. */
    public toString(): string {
      return `file://${this.pathValue}`;
    }
  }

  return { Uri: FakeUri, workspace: { fs: vscodeFileSystem } };
});

const FIRST_BUNDLE: PreviewBundle = {
  chunks: [],
  dependencies: [],
  diagnostics: [],
  javascript: encode('first revision'),
  watchDirectories: [],
};

const SECOND_BUNDLE: PreviewBundle = {
  chunks: [],
  dependencies: [],
  diagnostics: [],
  javascript: encode('second revision'),
  watchDirectories: [],
};

const SHARED_CHUNKS = [
  { contents: encode('export const later = true;'), relativePath: 'chunks/ZLATER123.js' },
  {
    contents: encode('export const nested = true;'),
    relativePath: 'chunks/routes/NESTED12.js',
  },
] as const;

const CHUNKED_BUNDLE: PreviewBundle = { ...FIRST_BUNDLE, chunks: SHARED_CHUNKS };

afterEach(() => {
  vi.clearAllMocks();
  vscodeFileSystem.createDirectory.mockResolvedValue(undefined);
  vscodeFileSystem.delete.mockResolvedValue(undefined);
  vscodeFileSystem.writeFile.mockResolvedValue(undefined);
});

describe('GlobalStoragePreviewArtifactStore', () => {
  /** Places the root entry beside the shared chunk tree so generated relative imports still work. */
  it('publishes chunks at stable session-root paths', async () => {
    const store = createStore();

    const artifact = await store.publish(CHUNKED_BUNDLE);
    const writtenPaths = vscodeFileSystem.writeFile.mock.calls.map((call) => String(call[0]));

    expect(writtenPaths).toEqual([
      expect.stringMatching(/\/entry-[a-f0-9]{64}\.js$/u),
      expect.stringContaining('/chunks/ZLATER123.js'),
      expect.stringContaining('/chunks/routes/NESTED12.js'),
    ]);
    expect(writtenPaths.every((filePath) => !filePath.includes(`/${artifact.contentHash}/`))).toBe(
      true,
    );
    expect(artifact.scriptLocation).toMatch(/\/entry-[a-f0-9]{64}\.js$/u);
    expect(artifact).not.toHaveProperty('stylesheetLocation');
  });

  /** Reuses unchanged chunks while a new entry revision receives its own stable entry digest. */
  it('writes shared chunks only once across different bundle revisions', async () => {
    const store = createStore();
    const firstArtifact = await store.publish(CHUNKED_BUNDLE);
    const secondArtifact = await store.publish({ ...SECOND_BUNDLE, chunks: SHARED_CHUNKS });

    expect(firstArtifact.contentHash).not.toBe(secondArtifact.contentHash);
    expect(firstArtifact.scriptLocation).not.toBe(secondArtifact.scriptLocation);
    expect(vscodeFileSystem.writeFile).toHaveBeenCalledTimes(4);
    expect(
      vscodeFileSystem.writeFile.mock.calls.filter(([uri]) => String(uri).includes('/chunks/')),
    ).toHaveLength(2);
  });

  /** Makes input chunk order irrelevant and returns the already published bundle lease. */
  it('hashes sorted chunk paths and contents', async () => {
    const store = createStore();
    const firstArtifact = await store.publish(CHUNKED_BUNDLE);
    const reorderedArtifact = await store.publish({
      ...CHUNKED_BUNDLE,
      chunks: [...CHUNKED_BUNDLE.chunks].reverse(),
    });
    const changedPathArtifact = await store.publish({
      ...CHUNKED_BUNDLE,
      chunks: CHUNKED_BUNDLE.chunks.map((chunk, index) =>
        index === 0 ? { ...chunk, relativePath: 'chunks/ALATER99.js' } : chunk,
      ),
    });

    expect(reorderedArtifact.contentHash).toBe(firstArtifact.contentHash);
    expect(changedPathArtifact.contentHash).not.toBe(firstArtifact.contentHash);
    expect(vscodeFileSystem.writeFile).toHaveBeenCalledTimes(4);
  });

  /** Refuses to overwrite a live shared URI when an invalid producer reuses it for new bytes. */
  it('rejects shared chunk path collisions', async () => {
    const store = createStore();
    await store.publish(CHUNKED_BUNDLE);

    await expect(
      store.publish({
        ...SECOND_BUNDLE,
        chunks: [
          {
            contents: encode('different bytes at an existing URI'),
            relativePath: SHARED_CHUNKS[0].relativePath,
          },
        ],
      }),
    ).rejects.toThrow('shared artifact path changed contents');

    expect(vscodeFileSystem.writeFile).toHaveBeenCalledTimes(3);
  });

  /** Rewrites deleted files when the same byte identities are acquired again after zero owners. */
  it('recreates same-digest files retained as zero-reference tombstones', async () => {
    const store = createStore();
    const firstArtifact = await store.publish(CHUNKED_BUNDLE);
    await store.release(firstArtifact.contentHash);
    vscodeFileSystem.writeFile.mockClear();

    const republishedArtifact = await store.publish(CHUNKED_BUNDLE);

    expect(republishedArtifact).toEqual(firstArtifact);
    expect(vscodeFileSystem.writeFile).toHaveBeenCalledTimes(3);
  });

  /** Never reuses a previously published module URL for new bytes after its file was deleted. */
  it('rejects different bytes at a tombstoned chunk path', async () => {
    const store = createStore();
    const firstArtifact = await store.publish(CHUNKED_BUNDLE);
    await store.release(firstArtifact.contentHash);
    vscodeFileSystem.writeFile.mockClear();

    await expect(
      store.publish({
        ...SECOND_BUNDLE,
        chunks: [
          {
            contents: encode('different bytes after final release'),
            relativePath: SHARED_CHUNKS[0].relativePath,
          },
        ],
      }),
    ).rejects.toThrow('shared artifact path changed contents');
    expect(vscodeFileSystem.writeFile).not.toHaveBeenCalled();
  });

  /** Rejects case aliases that address one physical file on Windows and default macOS volumes. */
  it('rejects portable path aliases across bundle identities', async () => {
    const store = createStore();
    await store.publish({
      ...FIRST_BUNDLE,
      chunks: [{ contents: encode('same bytes'), relativePath: 'chunks/CASEHASH.js' }],
    });
    vscodeFileSystem.writeFile.mockClear();

    await expect(
      store.publish({
        ...SECOND_BUNDLE,
        chunks: [{ contents: encode('same bytes'), relativePath: 'chunks/casehash.js' }],
      }),
    ).rejects.toThrow('collide on a portable filesystem');
    expect(vscodeFileSystem.writeFile).not.toHaveBeenCalled();
  });

  /** Rejects every non-portable or escaping path before creating a session resource directory. */
  it.each([
    '/chunks/absolute.js',
    'chunks\\windows.js',
    'chunks/../escape.js',
    'chunks/./same.js',
    'chunks//empty.js',
    'chunks/not-javascript.css',
    'outside/module.js',
    'chunks/nul\0byte.js',
    'chunks/query?mode.js',
    'chunks/fragment#section.js',
    'chunks/encoded%2Fslash.js',
    'chunks/white space.js',
    'chunks/NUL.js',
    'chunks/COM1/module.js',
    'chunks/routes./module.js',
    'chunks/유니코드.js',
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
        { contents: new Uint8Array([1]), relativePath: 'chunks/SHARED01.js' },
        { contents: new Uint8Array([2]), relativePath: 'chunks/SHARED01.js' },
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
    expect(vscodeFileSystem.writeFile).not.toHaveBeenCalled();
  });

  /** Rejects distinct spellings that collapse to one portable filesystem identity in one bundle. */
  it('rejects case-aliased duplicate chunk paths', async () => {
    const store = createStore();
    const aliasedBundle: PreviewBundle = {
      ...FIRST_BUNDLE,
      chunks: [
        { contents: new Uint8Array([1]), relativePath: 'chunks/CASEHASH.js' },
        { contents: new Uint8Array([2]), relativePath: 'chunks/casehash.js' },
      ],
    };

    await expect(store.publish(aliasedBundle)).rejects.toThrow(
      'chunk paths collide on a portable filesystem',
    );
    expect(vscodeFileSystem.writeFile).not.toHaveBeenCalled();
  });

  /** Gives unchanged entry JavaScript and CSS stable independent URIs across bundle identities. */
  it('deduplicates entry and stylesheet files by byte content', async () => {
    const store = createStore();
    const stylesheet = encode('.shared { color: green; }');
    const firstArtifact = await store.publish({ ...FIRST_BUNDLE, stylesheet });
    const secondArtifact = await store.publish({
      ...FIRST_BUNDLE,
      chunks: [{ contents: encode('export {};'), relativePath: 'chunks/EXTRA123.js' }],
      stylesheet,
    });

    expect(firstArtifact.contentHash).not.toBe(secondArtifact.contentHash);
    expect(firstArtifact.scriptLocation).toBe(secondArtifact.scriptLocation);
    expect(firstArtifact.stylesheetLocation).toBe(secondArtifact.stylesheetLocation);
    expect(firstArtifact.stylesheetLocation).toMatch(/\/styles\/[a-f0-9]{64}\.css$/u);
    expect(vscodeFileSystem.writeFile).toHaveBeenCalledTimes(3);
  });

  /** Gives a present zero-byte stylesheet a different lease identity from an absent stylesheet. */
  it('distinguishes empty and absent stylesheets in the bundle hash', async () => {
    const store = createStore();
    const absentStylesheet = await store.publish(FIRST_BUNDLE);
    const emptyStylesheet = await store.publish({
      ...FIRST_BUNDLE,
      stylesheet: new Uint8Array(),
    });

    expect(emptyStylesheet.contentHash).not.toBe(absentStylesheet.contentHash);
    expect(emptyStylesheet.scriptLocation).toBe(absentStylesheet.scriptLocation);
    expect(absentStylesheet).not.toHaveProperty('stylesheetLocation');
    expect(emptyStylesheet.stylesheetLocation).toMatch(/\/styles\/[a-f0-9]{64}\.css$/u);
    expect(vscodeFileSystem.writeFile).toHaveBeenCalledTimes(2);
  });

  /** Keeps only path and digest metadata after publication instead of retaining build byte arrays. */
  it('drops artifact file contents from retained lease layouts', async () => {
    const store = createStore();
    await store.publish(CHUNKED_BUNDLE);

    const retainedFiles = inspectRetainedArtifactFiles(store);

    expect(retainedFiles).toHaveLength(3);
    expect(retainedFiles.every((file) => !Object.hasOwn(file, 'contents'))).toBe(true);
    expect(
      retainedFiles.every(
        (file) => typeof file.contentDigest === 'string' && typeof file.relativePath === 'string',
      ),
    ).toBe(true);
  });

  /** Retains a shared chunk until every distinct artifact graph that reaches it has been released. */
  it('reference-counts shared files across artifact identities', async () => {
    const store = createStore();
    const sharedChunk = [SHARED_CHUNKS[0]];
    const firstArtifact = await store.publish({ ...FIRST_BUNDLE, chunks: sharedChunk });
    const secondArtifact = await store.publish({ ...SECOND_BUNDLE, chunks: sharedChunk });

    await store.release(firstArtifact.contentHash);
    expect(vscodeFileSystem.delete).toHaveBeenCalledTimes(1);
    expect(String(vscodeFileSystem.delete.mock.calls[0]?.[0])).toContain('/entry-');

    await store.release(secondArtifact.contentHash);
    const deletedPaths = vscodeFileSystem.delete.mock.calls.map((call) => String(call[0]));
    expect(deletedPaths).toHaveLength(3);
    expect(deletedPaths.filter((filePath) => filePath.includes('/chunks/'))).toHaveLength(1);
  });

  /** Keeps one exact bundle's shared files until every panel returns its independent lease. */
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
    expect(String(vscodeFileSystem.delete.mock.calls[0]?.[0])).toBe(firstArtifact.scriptLocation);
  });

  /** Rolls back only newly written files after a parallel publication failure. */
  it('cleans a partially written artifact after chunk publication failure', async () => {
    const store = createStore();
    vscodeFileSystem.writeFile
      .mockResolvedValueOnce(undefined)
      .mockRejectedValueOnce(new Error('simulated chunk write failure'));

    await expect(
      store.publish({
        ...FIRST_BUNDLE,
        chunks: [{ contents: encode('failed chunk'), relativePath: 'chunks/FAILED01.js' }],
      }),
    ).rejects.toThrow('simulated chunk write failure');

    expect(vscodeFileSystem.writeFile).toHaveBeenCalledTimes(2);
    expect(vscodeFileSystem.delete).toHaveBeenCalledTimes(1);
    expect(String(vscodeFileSystem.delete.mock.calls[0]?.[0])).toMatch(
      /preview-cache\/[^/]+\/entry-[a-f0-9]{64}\.js$/u,
    );
  });

  /** Starts more than one write while never exceeding the adapter's eight-worker I/O budget. */
  it('publishes independent files with bounded parallel writes', async () => {
    let activeWrites = 0;
    let maximumActiveWrites = 0;
    vscodeFileSystem.writeFile.mockImplementation(async () => {
      activeWrites += 1;
      maximumActiveWrites = Math.max(maximumActiveWrites, activeWrites);
      await Promise.resolve();
      activeWrites -= 1;
    });
    const store = createStore();
    const chunks = Array.from({ length: 20 }, (_, index) => ({
      contents: encode(`chunk ${index.toString()}`),
      relativePath: `chunks/HASH${index.toString().padStart(4, '0')}.js`,
    }));

    await store.publish({ ...FIRST_BUNDLE, chunks });

    expect(maximumActiveWrites).toBeGreaterThan(1);
    expect(maximumActiveWrites).toBeLessThanOrEqual(8);
  });

  /** Waits for root deletion and rejects later writes that could recreate private source caches. */
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

/** Encodes concise fixture source text into the production bundle byte representation. */
function encode(source: string): Uint8Array {
  return new TextEncoder().encode(source);
}

/** Creates a store with typed VS Code boundaries and a silent diagnostic channel. */
function createStore(): GlobalStoragePreviewArtifactStore {
  const log = { debug: vi.fn() } as unknown as vscode.LogOutputChannel;
  return new GlobalStoragePreviewArtifactStore(vscode.Uri.file('/global-storage'), log);
}

/** Minimal private retained-file surface inspected only to prevent large buffer regressions. */
interface RetainedArtifactFileInspection {
  /** Full digest needed for future collision checks. */
  readonly contentDigest: unknown;
  /** Session-relative path needed for release and URI reconstruction. */
  readonly relativePath: unknown;
}

/** Private store shape narrowed by the memory-retention regression test. */
interface RetainedArtifactStoreInspection {
  /** Published records whose layouts must contain identities but no `Uint8Array` contents. */
  readonly artifactByHash: ReadonlyMap<
    string,
    { readonly layout: { readonly files: readonly RetainedArtifactFileInspection[] } }
  >;
}

/** Reads byte-free retained file identities without exposing a production diagnostics API. */
function inspectRetainedArtifactFiles(
  store: GlobalStoragePreviewArtifactStore,
): readonly RetainedArtifactFileInspection[] {
  const inspection = store as unknown as RetainedArtifactStoreInspection;
  return [...inspection.artifactByHash.values()].flatMap((record) => record.layout.files);
}
