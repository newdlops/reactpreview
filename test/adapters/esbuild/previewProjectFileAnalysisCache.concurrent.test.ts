/** Verifies that superseded asynchronous reads cannot restore or overwrite current source facts. */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { PreviewProjectFileAnalysisCache } from '../../../src/adapters/esbuild/previewProjectFileAnalysisCache';

const disk = vi.hoisted(() => ({ open: vi.fn(), stat: vi.fn() }));
vi.mock('node:fs/promises', async (importOriginal) => ({
  ...(await importOriginal<typeof import('node:fs/promises')>()),
  open: disk.open,
  stat: disk.stat,
}));

const sourcePath = '/workspace/src/Page.tsx';
const oldText = 'export const Page = () => "old";';
const newText = 'export const Page = () => "new";';

/** A deterministic completion gate that does not schedule timers or perform filesystem writes. */
interface CompletionGate<T> {
  readonly promise: Promise<T>;
  readonly resolve: (value: T) => void;
  readonly reject: (reason: unknown) => void;
}

/** One simulated handle with explicit visibility into when reading begins and finishes. */
interface DiskObservation {
  readonly started: CompletionGate<undefined>;
  readonly contents: CompletionGate<string>;
  readonly handle: {
    readonly stat: () => Promise<ReturnType<typeof metadata>>;
    readonly readFile: () => Promise<string>;
    readonly close: () => Promise<void>;
  };
}

describe('PreviewProjectFileAnalysisCache concurrent reads', () => {
  beforeEach(() => {
    disk.stat.mockResolvedValue(metadata(oldText));
  });

  /** Keeps post-clear callers joined to the new pending read when an older read settles. */
  it.each(['resolve', 'reject'] as const)(
    'preserves a new shared read after the previous generation %ss',
    async (completion) => {
      const cache = new PreviewProjectFileAnalysisCache();
      const previous = observeDisk(oldText);
      const current = observeDisk(newText);
      disk.open.mockResolvedValueOnce(previous.handle).mockResolvedValueOnce(current.handle);

      const oldRead = cache.readSource({ sourcePath, maximumBytes: 1024 });
      await previous.started.promise;
      cache.clear();
      const newRead = cache.readSource({ sourcePath, maximumBytes: 1024 });
      await current.started.promise;
      if (completion === 'resolve') previous.contents.resolve(oldText);
      else previous.contents.reject(new Error('Superseded read failed'));
      await oldRead;

      const joinedRead = cache.readSource({ sourcePath, maximumBytes: 1024 });
      current.contents.resolve(newText);
      const [fresh, joined] = await Promise.all([newRead, joinedRead]);

      expect(joined?.sourceText).toBe(newText);
      expect(joined).toBe(fresh);
      expect(disk.open).toHaveBeenCalledTimes(2);
      expect(previous.handle.close).toHaveBeenCalledTimes(1);
      expect(current.handle.close).toHaveBeenCalledTimes(1);
    },
  );

  /** A completed pre-clear read must not silently repopulate a cache owned by later revisions. */
  it('reads again after a pending read finishes beyond clear', async () => {
    const cache = new PreviewProjectFileAnalysisCache();
    const previous = observeDisk(oldText);
    const current = observeDisk(newText);
    disk.open.mockResolvedValueOnce(previous.handle).mockResolvedValueOnce(current.handle);
    const pending = cache.readSource({ sourcePath, maximumBytes: 1024 });
    await previous.started.promise;
    cache.clear();
    previous.contents.resolve(oldText);
    expect((await pending)?.sourceText).toBe(oldText);

    current.contents.resolve(newText);
    expect((await cache.readSource({ sourcePath, maximumBytes: 1024 }))?.sourceText).toBe(newText);
    expect(disk.open).toHaveBeenCalledTimes(2);
  });

  /** A dirty overlay registered during a cold disk read remains authoritative in the cache. */
  it('keeps a newer snapshot when a cold disk read completes late', async () => {
    const cache = new PreviewProjectFileAnalysisCache();
    const previous = observeDisk(oldText);
    const current = observeDisk(newText);
    disk.open.mockResolvedValueOnce(previous.handle).mockResolvedValueOnce(current.handle);
    const pending = cache.readSource({ sourcePath, maximumBytes: 1024 });
    await previous.started.promise;
    await cache.readSource({ sourcePath, maximumBytes: 1024, snapshotText: newText });
    previous.contents.resolve(oldText);
    expect((await pending)?.sourceText).toBe(oldText);

    // A caller explicitly returning to disk must recheck it after an editor snapshot.
    current.contents.resolve(newText);
    expect((await cache.readSource({ sourcePath, maximumBytes: 1024 }))?.sourceText).toBe(newText);
    expect(disk.open).toHaveBeenCalledTimes(2);
  });

  /** Removing a newer oversized snapshot must not make an older pending read current again. */
  it('does not restore an old read after a newer snapshot exceeds a tighter ceiling', async () => {
    const cache = new PreviewProjectFileAnalysisCache();
    const previous = observeDisk(oldText);
    const current = observeDisk(newText);
    disk.open.mockResolvedValueOnce(previous.handle).mockResolvedValueOnce(current.handle);
    const pending = cache.readSource({ sourcePath, maximumBytes: 1024 });
    await previous.started.promise;
    await cache.readSource({ sourcePath, maximumBytes: 1024, snapshotText: newText });
    expect(
      await cache.readSource({ sourcePath, maximumBytes: 4, snapshotText: newText }),
    ).toBeUndefined();
    previous.contents.resolve(oldText);
    await pending;

    current.contents.resolve(newText);
    expect((await cache.readSource({ sourcePath, maximumBytes: 1024 }))?.sourceText).toBe(newText);
    expect(disk.open).toHaveBeenCalledTimes(2);
  });

  /** A slow metadata cache hit cannot put an older disk entry back over a dirty editor overlay. */
  it('keeps a newer snapshot while an unchanged disk stamp is being checked', async () => {
    const cache = new PreviewProjectFileAnalysisCache();
    const previous = observeDisk(oldText);
    const current = observeDisk(newText);
    disk.open.mockResolvedValueOnce(previous.handle).mockResolvedValueOnce(current.handle);
    previous.contents.resolve(oldText);
    await cache.readSource({ sourcePath, maximumBytes: 1024 });

    const checked = deferred<ReturnType<typeof metadata>>();
    const started = deferred<undefined>();
    disk.stat.mockImplementationOnce(() => {
      started.resolve(undefined);
      return checked.promise;
    });
    const pending = cache.readSource({ sourcePath, maximumBytes: 1024 });
    await started.promise;
    await cache.readSource({ sourcePath, maximumBytes: 1024, snapshotText: newText });
    checked.resolve(metadata(oldText));
    expect((await pending)?.sourceText).toBe(oldText);

    current.contents.resolve(newText);
    expect((await cache.readSource({ sourcePath, maximumBytes: 1024 }))?.sourceText).toBe(newText);
    expect(disk.open).toHaveBeenCalledTimes(2);
  });

  /** A stale metadata result, including failure, cannot discard a newer editor-owned record. */
  it.each(['changed', 'missing', 'oversized'] as const)(
    'keeps a newer snapshot after a disk stamp becomes %s',
    async (outcome) => {
      const cache = new PreviewProjectFileAnalysisCache();
      const previous = observeDisk(oldText);
      const current = observeDisk(newText);
      disk.open.mockResolvedValueOnce(previous.handle).mockResolvedValueOnce(current.handle);
      previous.contents.resolve(oldText);
      current.contents.resolve(newText);
      await cache.readSource({ sourcePath, maximumBytes: 1024 });
      const checked = deferred<ReturnType<typeof metadata>>();
      const started = deferred<undefined>();
      disk.stat.mockImplementationOnce(() => {
        started.resolve(undefined);
        return checked.promise;
      });
      const pending = cache.readSource({ sourcePath, maximumBytes: 1024 });
      await started.promise;
      const snapshot = await cache.readSource({
        sourcePath,
        maximumBytes: 1024,
        snapshotText: newText,
      });
      if (outcome === 'missing') checked.reject(new Error('File removed'));
      else if (outcome === 'oversized') checked.resolve({ ...metadata(oldText), size: 2048 });
      else checked.resolve({ ...metadata(oldText), mtimeMs: 2 });
      await pending;

      expect(
        await cache.readSource({ sourcePath, maximumBytes: 1024, snapshotText: newText }),
      ).toBe(snapshot);
    },
  );
});

/** Provides deterministic completion order without timers or a real filesystem race. */
function deferred<T>(): CompletionGate<T> {
  let resolve!: (value: T) => void;
  let reject!: (reason: unknown) => void;
  const promise = new Promise<T>((accept, decline) => {
    resolve = accept;
    reject = decline;
  });
  return { promise, resolve, reject };
}

/** Returns the unchanged byte and modification stamp used by the simulated disk handles. */
function metadata(sourceText: string): { isFile: () => boolean; mtimeMs: number; size: number } {
  return { isFile: () => true, mtimeMs: 1, size: Buffer.byteLength(sourceText, 'utf8') };
}

/** Models a readable handle whose contents can finish after cache invalidation or a newer read. */
function observeDisk(sourceText: string): DiskObservation {
  const started = deferred<undefined>();
  const contents = deferred<string>();
  return {
    started,
    contents,
    handle: {
      stat: vi.fn().mockResolvedValue(metadata(sourceText)),
      readFile: vi.fn(() => {
        started.resolve(undefined);
        return contents.promise;
      }),
      close: vi.fn().mockResolvedValue(undefined),
    },
  };
}
