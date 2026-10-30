/** Real ZIP reads must share directory work without reusing changed bytes or leaking descriptors. */
import { createWriteStream } from 'node:fs';
import { mkdir, mkdtemp, rename, rm, stat, utimes, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { pipeline } from 'node:stream/promises';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ZipFile } from 'yazl';
import { PreviewProjectFileAnalysisCache } from '../../../src/adapters/esbuild/previewProjectFileAnalysisCache';

const directoryReads = vi.hoisted(() => ({ count: 0, opened: 0, closed: 0 }));
vi.mock('yauzl', async (importOriginal) => {
  const actual = await importOriginal<typeof import('yauzl')>();
  return {
    ...actual,
    openPromise: async (...args: Parameters<typeof actual.openPromise>) => {
      const archive = await actual.openPromise(...args);
      directoryReads.opened += 1;
      const read = archive.readEntry.bind(archive);
      const close = archive.close.bind(archive);
      let closed = false;
      archive.readEntry = () => {
        directoryReads.count += 1;
        read();
      };
      archive.close = () => {
        if (!closed) directoryReads.closed += 1;
        closed = true;
        close();
      };
      return archive;
    },
  };
});

const roots: string[] = [];
beforeEach(() => Object.assign(directoryReads, { count: 0, opened: 0, closed: 0 }));
afterEach(async () => {
  expect(directoryReads.closed).toBe(directoryReads.opened);
  await Promise.all(roots.splice(0).map((root) => rm(root, { force: true, recursive: true })));
});

describe('compiler-owned Yarn archive directory reuse', () => {
  it('reuses already scanned entries for different source files, including compressed Unicode', async () => {
    const fixture = await createArchive(true);
    const cache = new PreviewProjectFileAnalysisCache();
    const last = await cache.readSource({ sourcePath: fixture.source(63), maximumBytes: 1024 });
    expect(last?.sourceText).toBe('export const value = "한글 63";');
    const scanned = directoryReads.count;
    for (let index = 0; index < 32; index += 1) {
      const result = await cache.readSource({
        sourcePath: fixture.source(index),
        maximumBytes: 1024,
      });
      expect(result?.sourceText).toBe(`export const value = "한글 ${index.toString()}";`);
    }
    expect(directoryReads.count).toBe(scanned);
  });

  it('shares overlapping searches instead of scanning a directory once per requested module', async () => {
    const fixture = await createArchive();
    const cache = new PreviewProjectFileAnalysisCache();
    const results = await Promise.all(
      Array.from({ length: 32 }, (_, index) =>
        cache.readSource({ sourcePath: fixture.source(32 + index), maximumBytes: 1024 }),
      ),
    );
    expect(results.every((result) => result?.sourceText.includes('한글'))).toBe(true);
    expect(directoryReads.count).toBeLessThan(64 * 3);
  });

  it('keeps each caller byte limit and clears retained offsets with compiler source state', async () => {
    const fixture = await createArchive();
    const cache = new PreviewProjectFileAnalysisCache();
    await cache.readSource({ sourcePath: fixture.source(63), maximumBytes: 1024 });
    expect(
      await cache.readSource({ sourcePath: fixture.source(0), maximumBytes: 4 }),
    ).toBeUndefined();
    expect(
      (await cache.readSource({ sourcePath: fixture.source(0), maximumBytes: 1024 }))?.sourceText,
    ).toBe('export const value = "한글 0";');
    const before = directoryReads.count;
    cache.clear();
    expect(
      (await cache.readSource({ sourcePath: fixture.source(1), maximumBytes: 1024 }))?.sourceText,
    ).toBe('export const value = "한글 1";');
    expect(directoryReads.count).toBeGreaterThan(before);
  });

  it('invalidates offsets and text after a same-size archive replacement with the original mtime', async () => {
    const fixture = await createArchive();
    const cache = new PreviewProjectFileAnalysisCache();
    const first = await cache.readSource({ sourcePath: fixture.source(0), maximumBytes: 1024 });
    const metadata = await stat(fixture.archive);
    await writeArchive(fixture.archive + '.next', '변경');
    await utimes(fixture.archive + '.next', metadata.atime, metadata.mtime);
    await rename(fixture.archive + '.next', fixture.archive);
    expect((await stat(fixture.archive)).size).toBe(metadata.size);
    const changed = await cache.readSource({ sourcePath: fixture.source(0), maximumBytes: 1024 });
    expect(changed?.sourceText).toBe('export const value = "변경 0";');
    expect(changed?.fingerprint).not.toBe(first?.fingerprint);
  });

  it('returns no source for missing, corrupt, or removed archives and can read a repaired one', async () => {
    const fixture = await createArchive();
    const cache = new PreviewProjectFileAnalysisCache();
    expect(
      await cache.readSource({ sourcePath: fixture.source(99), maximumBytes: 1024 }),
    ).toBeUndefined();
    await writeFile(fixture.archive, 'corrupt zip');
    expect(
      await cache.readSource({ sourcePath: fixture.source(0), maximumBytes: 1024 }),
    ).toBeUndefined();
    await writeArchive(fixture.archive, '복구');
    expect(
      (await cache.readSource({ sourcePath: fixture.source(0), maximumBytes: 1024 }))?.sourceText,
    ).toBe('export const value = "복구 0";');
    await rm(fixture.archive);
    expect(
      await cache.readSource({ sourcePath: fixture.source(0), maximumBytes: 1024 }),
    ).toBeUndefined();
  });
});

/** Creates a small real compressed package without executing any contained module. */
async function createArchive(
  compress = false,
): Promise<{ archive: string; source: (index: number) => string }> {
  const root = await mkdtemp(path.join(tmpdir(), 'preview-yarn-index-'));
  roots.push(root);
  const archive = path.join(root, '.yarn/cache/package.zip');
  await mkdir(path.dirname(archive), { recursive: true });
  await writeArchive(archive, '한글', compress);
  const fixedTime = new Date('2026-01-01T00:00:00Z');
  await utimes(archive, fixedTime, fixedTime);
  return {
    archive,
    source: (index) => path.join(archive, `node_modules/fixture/${index.toString()}.js`),
  };
}

/** Keeps the source lengths and ZIP layout equal when replacing archive content. */
async function writeArchive(archive: string, label: string, compress = false): Promise<void> {
  const zip = new ZipFile();
  for (let index = 0; index < 64; index += 1) {
    zip.addBuffer(
      Buffer.from(`export const value = "${label} ${index.toString()}";`),
      `node_modules/fixture/${index.toString()}.js`,
      { compress },
    );
  }
  zip.end();
  await pipeline(zip.outputStream, createWriteStream(archive));
}
