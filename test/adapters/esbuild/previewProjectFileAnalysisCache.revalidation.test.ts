/** Checks whole-read ownership and shared metadata validation without filesystem timing races. */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { PreviewProjectFileAnalysisCache } from '../../../src/adapters/esbuild/previewProjectFileAnalysisCache';

const disk = vi.hoisted(() => ({ open: vi.fn(), stat: vi.fn() }));
const zip = vi.hoisted(() => ({ read: vi.fn(), fingerprint: vi.fn() }));
vi.mock('node:fs/promises', async (importOriginal) => ({
  ...(await importOriginal<typeof import('node:fs/promises')>()),
  open: disk.open,
  stat: disk.stat,
}));
vi.mock('../../../src/adapters/esbuild/previewYarnZipSource', () => ({
  readPreviewYarnZipSource: zip.read,
  readPreviewYarnZipArchiveFingerprint: zip.fingerprint,
}));

const sourcePath = '/workspace/src/Page.tsx';
const oldText = 'export const Page = () => "old";';
const newText = 'export const Page = () => "new";';

/** Explicit completion gates avoid sleeps and real filesystem races. */
interface Gate<T> {
  readonly promise: Promise<T>;
  readonly resolve: (value: T) => void;
  readonly reject: (error: Error) => void;
}

describe('PreviewProjectFileAnalysisCache metadata revalidation', () => {
  beforeEach(() => {
    disk.stat.mockResolvedValue(metadata());
    zip.read.mockResolvedValue(undefined);
  });

  it.each(['unchanged', 'changed', 'missing', 'directory', 'oversized'] as const)(
    'shares concurrent equal-ceiling checks when the disk is %s',
    async (outcome) => {
      const cache = new PreviewProjectFileAnalysisCache();
      const original = readable(oldText);
      const changed = readable(newText, 2);
      disk.open.mockResolvedValueOnce(original).mockResolvedValueOnce(changed);
      const first = await cache.readSource({ sourcePath, maximumBytes: 1024 });
      const checked = gate<ReturnType<typeof metadata>>();
      disk.stat.mockReturnValueOnce(checked.promise);

      const reads = Array.from({ length: 3 }, () =>
        cache.readSource({ sourcePath, maximumBytes: 1024 }),
      );
      if (outcome === 'missing') checked.reject(new Error('File removed'));
      else if (outcome === 'changed') checked.resolve(metadata(2));
      else if (outcome === 'directory') checked.resolve({ ...metadata(), isFile: () => false });
      else if (outcome === 'oversized') checked.resolve({ ...metadata(), size: 2048 });
      else checked.resolve(metadata());
      const results = await Promise.all(reads);

      expect(disk.stat).toHaveBeenCalledTimes(1);
      expect(results[1]).toBe(results[0]);
      expect(results[2]).toBe(results[0]);
      if (outcome === 'unchanged') expect(results[0]).toBe(first);
      else if (outcome === 'changed') expect(results[0]?.sourceText).toBe(newText);
      else expect(results[0]).toBeUndefined();
      expect(original.close).toHaveBeenCalledTimes(1);
      expect(disk.open).toHaveBeenCalledTimes(outcome === 'changed' ? 2 : 1);
    },
  );

  it.each(['clear', 'oversized snapshot'] as const)(
    'does not let an old metadata check take ownership after %s',
    async (invalidation) => {
      const cache = new PreviewProjectFileAnalysisCache();
      const currentText = gate<string>();
      const currentStarted = gate<undefined>();
      const current = readable(newText, 3);
      current.readFile.mockImplementation(() => {
        currentStarted.resolve(undefined);
        return currentText.promise;
      });
      const older = readable(oldText, 2);
      disk.open
        .mockResolvedValueOnce(readable(oldText))
        .mockResolvedValueOnce(current)
        .mockResolvedValueOnce(older);
      await cache.readSource({ sourcePath, maximumBytes: 1024 });
      const oldStamp = gate<ReturnType<typeof metadata>>();
      disk.stat.mockReturnValueOnce(oldStamp.promise);
      const stale = cache.readSource({ sourcePath, maximumBytes: 1024 });
      if (invalidation === 'clear') cache.clear();
      else {
        await cache.readSource({ sourcePath, maximumBytes: 4, snapshotText: newText });
      }

      const fresh = cache.readSource({ sourcePath, maximumBytes: 1024 });
      await currentStarted.promise;
      oldStamp.resolve(metadata(2));
      expect((await stale)?.sourceText).toBe(oldText);
      const joined = cache.readSource({ sourcePath, maximumBytes: 1024 });
      currentText.resolve(newText);
      const [accepted, shared] = await Promise.all([fresh, joined]);
      expect(shared).toBe(accepted);
      expect(shared?.sourceText).toBe(newText);
      disk.stat.mockResolvedValue(metadata(3));
      expect(await cache.readSource({ sourcePath, maximumBytes: 1024 })).toBe(accepted);
      expect(disk.open).toHaveBeenCalledTimes(3);
      expect(current.close).toHaveBeenCalledTimes(1);
      expect(older.close).toHaveBeenCalledTimes(1);
    },
  );

  it('revalidates sequential callers so an edit after a shared check is visible', async () => {
    const cache = new PreviewProjectFileAnalysisCache();
    disk.open.mockResolvedValueOnce(readable(oldText)).mockResolvedValueOnce(readable(newText, 2));
    await cache.readSource({ sourcePath, maximumBytes: 1024 });
    const unchanged = await Promise.all([
      cache.readSource({ sourcePath, maximumBytes: 1024 }),
      cache.readSource({ sourcePath, maximumBytes: 1024 }),
    ]);
    disk.stat.mockResolvedValue(metadata(2));
    const updated = await cache.readSource({ sourcePath, maximumBytes: 1024 });
    expect(unchanged[0]).toBe(unchanged[1]);
    expect(updated?.sourceText).toBe(newText);
    expect(disk.stat).toHaveBeenCalledTimes(2);
    expect(disk.open).toHaveBeenCalledTimes(2);
  });

  it('does not share a larger caller ceiling with a concurrent smaller caller', async () => {
    const cache = new PreviewProjectFileAnalysisCache();
    disk.open.mockResolvedValueOnce(readable(oldText)).mockResolvedValueOnce(readable(newText));
    await cache.readSource({ sourcePath, maximumBytes: 1024 });
    const checked = gate<ReturnType<typeof metadata>>();
    disk.stat.mockReturnValueOnce(checked.promise);
    const smaller = cache.readSource({ sourcePath, maximumBytes: 4 });
    const larger = cache.readSource({ sourcePath, maximumBytes: 1024 });
    expect((await larger)?.sourceText).toBe(oldText);
    checked.resolve(metadata());
    expect(await smaller).toBeUndefined();
    expect((await cache.readSource({ sourcePath, maximumBytes: 1024 }))?.sourceText).toBe(oldText);
    expect(disk.stat).toHaveBeenCalledTimes(3);
    expect(disk.open).toHaveBeenCalledTimes(1);
  });

  it('shares archive validation without retaining a completed check across archive changes', async () => {
    const cache = new PreviewProjectFileAnalysisCache();
    disk.open.mockRejectedValue(new Error('Virtual archive member'));
    zip.read.mockResolvedValueOnce(archiveRecord(oldText, 'old'));
    const first = await cache.readSource({ sourcePath, maximumBytes: 1024 });
    const checked = gate<string>();
    zip.fingerprint.mockReturnValueOnce(checked.promise);
    const reads = Array.from({ length: 3 }, () =>
      cache.readSource({ sourcePath, maximumBytes: 1024 }),
    );
    checked.resolve('old');
    expect(await Promise.all(reads)).toEqual([first, first, first]);
    expect(zip.fingerprint).toHaveBeenCalledTimes(1);
    zip.fingerprint.mockResolvedValue('changed');
    zip.read.mockResolvedValueOnce(archiveRecord(newText, 'changed'));
    const changed = await cache.readSource({ sourcePath, maximumBytes: 1024 });
    expect(changed?.sourceText).toBe(newText);
    expect(changed).not.toBe(first);
    expect(zip.read).toHaveBeenCalledTimes(2);
    expect(zip.fingerprint).toHaveBeenCalledTimes(2);
  });

  it('does not let a pre-clear archive check take over a new archive read', async () => {
    const cache = new PreviewProjectFileAnalysisCache();
    disk.open.mockRejectedValue(new Error('Virtual archive member'));
    const current = gate<ReturnType<typeof archiveRecord>>();
    const started = gate<undefined>();
    zip.read
      .mockResolvedValueOnce(archiveRecord(oldText, 'old'))
      .mockImplementationOnce(() => {
        started.resolve(undefined);
        return current.promise;
      })
      .mockResolvedValueOnce(archiveRecord(oldText, 'older'));
    await cache.readSource({ sourcePath, maximumBytes: 1024 });
    const oldStamp = gate<string>();
    zip.fingerprint.mockReturnValueOnce(oldStamp.promise);
    const stale = cache.readSource({ sourcePath, maximumBytes: 1024 });
    cache.clear();
    const fresh = cache.readSource({ sourcePath, maximumBytes: 1024 });
    await started.promise;
    oldStamp.resolve('older');
    expect((await stale)?.sourceText).toBe(oldText);
    const joined = cache.readSource({ sourcePath, maximumBytes: 1024 });
    current.resolve(archiveRecord(newText, 'new'));
    const [accepted, shared] = await Promise.all([fresh, joined]);
    expect(shared).toBe(accepted);
    expect(shared?.sourceText).toBe(newText);
    zip.fingerprint.mockResolvedValue('new');
    expect(await cache.readSource({ sourcePath, maximumBytes: 1024 })).toBe(accepted);
    expect(zip.read).toHaveBeenCalledTimes(3);
  });
});

/** Builds a manually completed promise without scheduling any recurring work. */
function gate<T>(): Gate<T> {
  let resolve!: (value: T) => void;
  let reject!: (error: Error) => void;
  const promise = new Promise<T>((accept, decline) => {
    resolve = accept;
    reject = decline;
  });
  return { promise, resolve, reject };
}

/** Models equal-length disk revisions with an explicit metadata generation. */
function metadata(mtimeMs = 1): { isFile: () => boolean; mtimeMs: number; size: number } {
  return { isFile: () => true, mtimeMs, size: Buffer.byteLength(oldText) };
}

/** Supplies an inert archive identity; actual zip parsing remains covered by the real-archive suite. */
function archiveRecord(
  sourceText: string,
  fingerprint: string,
): {
  readonly archiveFingerprint: string;
  readonly archivePath: string;
  readonly byteLength: number;
  readonly fingerprint: string;
  readonly sourceText: string;
} {
  return {
    archiveFingerprint: fingerprint,
    archivePath: '/workspace/.yarn/cache/package.zip',
    byteLength: Buffer.byteLength(sourceText),
    fingerprint,
    sourceText,
  };
}

/** Observes handle ownership and guarantees that the simulated source stays inert. */
function readable(
  text: string,
  modifiedAt = 1,
): {
  readonly stat: ReturnType<typeof vi.fn<() => Promise<ReturnType<typeof metadata>>>>;
  readonly readFile: ReturnType<typeof vi.fn<() => Promise<string>>>;
  readonly close: ReturnType<typeof vi.fn<() => Promise<void>>>;
} {
  return {
    stat: vi
      .fn<() => Promise<ReturnType<typeof metadata>>>()
      .mockResolvedValue(metadata(modifiedAt)),
    readFile: vi.fn<() => Promise<string>>().mockResolvedValue(text),
    close: vi.fn<() => Promise<void>>().mockResolvedValue(undefined),
  };
}
