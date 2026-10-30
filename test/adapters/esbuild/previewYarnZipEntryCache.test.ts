/** Controlled ZIP events verify scan ownership, early exit, invalidation, and memory admission. */
import { EventEmitter } from 'node:events';
import { describe, expect, it, vi, type Mock } from 'vitest';
import type { Entry, ZipFile } from 'yauzl';
import { PreviewYarnZipEntryCache } from '../../../src/adapters/esbuild/previewYarnZipEntryCache';

/** Event-only archive whose operations are bound mock functions, never detached reader methods. */
type ControlledArchive = Omit<ZipFile, 'readEntry' | 'close'> &
  EventEmitter & {
    readonly readEntry: Mock<() => void>;
    readonly close: Mock<() => void>;
  };

describe('Yarn ZIP directory scan lifetime', () => {
  it('keeps the scan owner pending until every concurrent name is found, then stops early', async () => {
    const cache = new PreviewYarnZipEntryCache();
    const owner = archive();
    const other = archive();
    let ownerSettled = false;
    const first = cache.find(owner, '/cache.zip', 'one', 'first.js', 100).then((entry) => {
      ownerSettled = true;
      return entry;
    });
    const second = cache.find(other, '/cache.zip', 'one', 'second.js', 100);
    owner.emit('entry', entry('first.js'));
    await Promise.resolve();
    expect(ownerSettled).toBe(false);
    const duplicate = cache.find(other, '/cache.zip', 'one', 'second.js', 100);
    owner.emit('entry', entry('second.js'));
    expect((await first)?.fileName).toBe('first.js');
    expect(await duplicate).toBe(await second);
    expect(owner.readEntry).toHaveBeenCalledTimes(2);
    expect(other.readEntry).not.toHaveBeenCalled();
    expect(owner.listenerCount('entry')).toBe(0);
    expect(owner.listenerCount('error')).toBe(0);
    expect(owner.close).not.toHaveBeenCalled();
  });

  it.each(['clear', 'replacement'] as const)(
    'does not restore old offsets after %s',
    async (change) => {
      const cache = new PreviewYarnZipEntryCache();
      const oldArchive = archive();
      const newArchive = archive();
      const oldRead = cache.find(oldArchive, '/cache.zip', 'one', 'page.js', 100);
      if (change === 'clear') cache.clear();
      const fingerprint = change === 'clear' ? 'one' : 'two';
      const newRead = cache.find(newArchive, '/cache.zip', fingerprint, 'page.js', 100);
      const current = entry('page.js', 2);
      newArchive.emit('entry', current);
      expect(await newRead).toBe(current);
      oldArchive.emit('entry', entry('page.js', 1));
      expect((await oldRead)?.crc32).toBe(1);
      expect(await cache.find(archive(), '/cache.zip', fingerprint, 'page.js', 100)).toBe(current);
    },
  );

  it('settles missing requests on errors while retaining already found valid entries', async () => {
    const cache = new PreviewYarnZipEntryCache();
    const zip = archive();
    const first = cache.find(zip, '/cache.zip', 'one', 'first.js', 100);
    const missing = cache.find(archive(), '/cache.zip', 'one', 'missing.js', 100);
    const rejected = expect(missing).rejects.toThrow('damaged directory');
    zip.emit('entry', entry('first.js'));
    zip.emit('error', new Error('damaged directory'));
    expect((await first)?.fileName).toBe('first.js');
    await rejected;
    expect(zip.eventNames()).toEqual([]);
    const next = archive();
    const retry = cache.find(next, '/cache.zip', 'one', 'missing.js', 100);
    next.emit('end');
    expect(await retry).toBeUndefined();
    expect(next.eventNames()).toEqual([]);
  });

  it('does not retain oversized entry metadata or let the scan exceed its entry ceiling', async () => {
    const cache = new PreviewYarnZipEntryCache();
    const large = { ...entry('large.js'), extraFieldRaw: Buffer.alloc(9 * 1024 * 1024) };
    for (let index = 0; index < 2; index += 1) {
      const zip = archive();
      const result = cache.find(zip, '/cache.zip', 'one', 'large.js', 100);
      zip.emit('entry', large);
      expect((await result)?.fileName).toBe('large.js');
      expect(zip.readEntry).toHaveBeenCalledTimes(1);
    }
    const zip = archive();
    const refused = cache.find(zip, '/cache.zip', 'one', 'later.js', 1);
    zip.emit('entry', entry('first.js'));
    zip.emit('entry', entry('later.js'));
    expect(await refused).toBeUndefined();
    expect(zip.eventNames()).toEqual([]);
  });

  it('finds an earlier uncached entry when a new caller arrives after the memory ceiling', async () => {
    const cache = new PreviewYarnZipEntryCache();
    const owner = archive();
    const other = archive();
    const large = { ...entry('large.js'), extraFieldRaw: Buffer.alloc(9 * 1024 * 1024) };
    const later = cache.find(owner, '/cache.zip', 'one', 'later.js', 100);
    owner.emit('entry', large);
    const earlier = cache.find(other, '/cache.zip', 'one', 'large.js', 100);
    other.emit('entry', large);
    owner.emit('entry', entry('later.js'));
    owner.emit('end');
    expect((await earlier)?.fileName).toBe('large.js');
    expect((await later)?.fileName).toBe('later.js');
    expect(other.readEntry).toHaveBeenCalledTimes(1);
    expect(owner.eventNames()).toEqual([]);
    expect(other.eventNames()).toEqual([]);
  });
});

/** A lazy event-only reader: ownership and decompression must remain with the source reader. */
function archive(): ControlledArchive {
  return Object.assign(new EventEmitter(), {
    entryCount: 100,
    readEntry: vi.fn<() => void>(),
    close: vi.fn<() => void>(),
    openReadStreamPromise: () => Promise.reject(new Error('Index must not open payload streams')),
  });
}

/** Inert metadata with independent byte buffers matching the ZIP library's decoded contract. */
function entry(fileName: string, crc32 = 0): Entry {
  return {
    fileName,
    crc32,
    uncompressedSize: 1,
    fileNameRaw: Buffer.from(fileName),
    fileComment: '',
    fileCommentRaw: Buffer.alloc(0),
    extraFieldRaw: Buffer.alloc(0),
    extraFields: [],
  };
}
