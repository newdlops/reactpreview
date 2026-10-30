/**
 * Shares bounded central-directory metadata inside one compiler's source cache.
 * Only inert entries are retained: callers own every ZIP handle and recheck archive identity before
 * and after reading bytes. Concurrent searches stop as soon as their requested entries are found;
 * a single early entry never causes an eager scan of the rest of a large archive.
 */
import type { Entry, ZipFile } from 'yauzl';

const MAXIMUM_ARCHIVES = 128;
const MAXIMUM_ENTRIES = 16_384;
const MAXIMUM_RETAINED_BYTES = 8 * 1024 * 1024;

/** One requested entry, settled only after the shared scanner no longer needs its owner's handle. */
interface EntryWaiter {
  readonly promise: Promise<Entry | undefined>;
  readonly resolve: (entry: Entry | undefined) => void;
  readonly reject: (error: Error) => void;
  entry?: Entry;
}

/** Counts outstanding names without allocating or traversing every waiter for each ZIP entry. */
interface EntrySearch {
  readonly requests: Map<string, EntryWaiter>;
  remaining: number;
  /** Late callers can join only while all entries before the scanner are still cached. */
  prefixCached: boolean;
}

/** One metadata generation; removed generations can finish readers but cannot repopulate storage. */
interface ArchiveEntries {
  readonly fingerprint: string;
  readonly entries: Map<string, Entry>;
  retainedBytes: number;
  /** Present only while a caller-owned ZIP is scanning for unresolved entry names. */
  pending?: EntrySearch;
}

/** Compiler-lifetime directory reuse that never caches source bytes or missing-entry answers. */
export class PreviewYarnZipEntryCache {
  private readonly archives = new Map<string, ArchiveEntries>();
  private retainedBytes = 0;
  private retainedEntries = 0;

  /** Releases metadata immediately; in-flight callers keep ownership of their already-open ZIPs. */
  public clear(): void {
    this.archives.clear();
    this.retainedBytes = 0;
    this.retainedEntries = 0;
  }

  /**
   * Finds one exact portable name using a caller-opened, size-validated archive.
   * The caller must keep its ZIP open until this promise settles and validate the archive again
   * after reading the returned entry. Scan errors reject only requests whose entry was not found.
   */
  public find(
    zipFile: ZipFile,
    archivePath: string,
    fingerprint: string,
    entryPath: string,
    maximumArchiveEntries: number,
  ): Promise<Entry | undefined> {
    const archive = this.selectArchive(archivePath, fingerprint);
    const cached = archive.entries.get(entryPath);
    if (cached !== undefined) return Promise.resolve(cached);
    const existing = archive.pending?.requests.get(entryPath);
    if (existing !== undefined) return existing.promise;
    let resolve!: EntryWaiter['resolve'];
    let reject!: EntryWaiter['reject'];
    const promise = new Promise<Entry | undefined>((accept, fail) => {
      resolve = accept;
      reject = fail;
    });
    const pending = archive.pending?.prefixCached
      ? archive.pending
      : { requests: new Map<string, EntryWaiter>(), remaining: 0, prefixCached: true };
    const startsScan = pending !== archive.pending;
    pending.requests.set(entryPath, { promise, resolve, reject });
    pending.remaining += 1;
    if (startsScan) {
      // Once metadata admission stops, an earlier uncached name needs its own scan from the start.
      archive.pending ??= pending;
      this.scan(zipFile, archivePath, archive, pending, maximumArchiveEntries);
    }
    return promise;
  }

  /** Selects a fresh metadata generation on replacement and bounds retained archive identities. */
  private selectArchive(archivePath: string, fingerprint: string): ArchiveEntries {
    const previous = this.archives.get(archivePath);
    if (previous?.fingerprint === fingerprint) return previous;
    if (previous !== undefined) this.forget(archivePath, previous);
    if (this.archives.size >= MAXIMUM_ARCHIVES) {
      const oldest = this.archives.entries().next().value;
      if (oldest !== undefined) this.forget(oldest[0], oldest[1]);
    }
    const archive: ArchiveEntries = { fingerprint, entries: new Map(), retainedBytes: 0 };
    this.archives.set(archivePath, archive);
    return archive;
  }

  /** Drops only accounting owned by this retained archive; outstanding readers settle separately. */
  private forget(archivePath: string, archive: ArchiveEntries): void {
    this.archives.delete(archivePath);
    this.retainedBytes -= archive.retainedBytes;
    this.retainedEntries -= archive.entries.size;
  }

  /** Counts raw storage conservatively and returns whether this entry is available to late readers. */
  private retain(archivePath: string, archive: ArchiveEntries, entry: Entry): boolean {
    if (this.archives.get(archivePath) !== archive) return false;
    if (archive.entries.has(entry.fileName)) return true;
    const buffers = new Set([
      entry.fileNameRaw.buffer,
      entry.fileCommentRaw.buffer,
      entry.extraFieldRaw.buffer,
    ]);
    const bytes =
      512 +
      2 * (entry.fileName.length + entry.fileComment.length) +
      entry.extraFields.length * 64 +
      [...buffers].reduce((sum, buffer) => sum + buffer.byteLength, 0);
    if (
      this.retainedEntries >= MAXIMUM_ENTRIES ||
      this.retainedBytes + bytes > MAXIMUM_RETAINED_BYTES
    )
      return false;
    archive.entries.set(entry.fileName, entry);
    archive.retainedBytes += bytes;
    this.retainedBytes += bytes;
    this.retainedEntries += 1;
    return true;
  }

  /** Runs one lazy scan for the current pending names without retaining or taking over the handle. */
  private scan(
    zipFile: ZipFile,
    archivePath: string,
    archive: ArchiveEntries,
    pending: EntrySearch,
    maximumArchiveEntries: number,
  ): void {
    let observedEntries = 0;
    let finished = false;
    const finish = (error?: Error): void => {
      if (finished) return;
      finished = true;
      zipFile.removeListener('entry', onEntry);
      zipFile.removeListener('end', onEnd);
      zipFile.removeListener('error', onError);
      if (archive.pending === pending) delete archive.pending;
      for (const waiter of pending.requests.values()) {
        if (waiter.entry !== undefined || error === undefined) waiter.resolve(waiter.entry);
        else waiter.reject(error);
      }
      pending.requests.clear();
    };
    const readNext = (): void => {
      try {
        zipFile.readEntry();
      } catch (error) {
        finish(error instanceof Error ? error : new Error(String(error)));
      }
    };
    const onEntry = (entry: Entry): void => {
      observedEntries += 1;
      if (observedEntries > maximumArchiveEntries) {
        finish();
        return;
      }
      if (!this.retain(archivePath, archive, entry)) pending.prefixCached = false;
      const waiter = pending.requests.get(entry.fileName);
      if (waiter !== undefined && waiter.entry === undefined) {
        waiter.entry = entry;
        pending.remaining -= 1;
      }
      if (pending.remaining === 0) finish();
      else readNext();
    };
    const onEnd = (): void => {
      finish();
    };
    const onError = (error: Error): void => {
      finish(error);
    };
    zipFile.on('entry', onEntry);
    zipFile.on('end', onEnd);
    zipFile.on('error', onError);
    readNext();
  }
}
