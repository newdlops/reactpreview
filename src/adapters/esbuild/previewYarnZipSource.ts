/** Reads bounded source entries from Yarn Plug'n'Play cache archives without executing `.pnp.cjs`. */
import { stat } from 'node:fs/promises';
import path from 'node:path';
import { openPromise, type Entry, type ZipFile } from 'yauzl';

const MAXIMUM_ARCHIVE_BYTES = 1024 * 1024 * 1024;
const MAXIMUM_ARCHIVE_ENTRIES = 100_000;
const YARN_CACHE_SEGMENT = `${path.sep}.yarn${path.sep}cache${path.sep}`;
const ZIP_ENTRY_SEPARATOR_PATTERN = /[\\/]/u;

/** Immutable source and archive identities suitable for the project file cache. */
export interface PreviewYarnZipSourceRecord {
  readonly archiveFingerprint: string;
  readonly archivePath: string;
  readonly byteLength: number;
  readonly fingerprint: string;
  readonly sourceText: string;
}

/** Reads one exact Yarn cache entry under the caller's existing uncompressed byte ceiling. */
export async function readPreviewYarnZipSource(
  sourcePath: string,
  maximumBytes: number,
): Promise<PreviewYarnZipSourceRecord | undefined> {
  const location = parseYarnZipSourcePath(sourcePath);
  if (location === undefined || maximumBytes < 0) return undefined;
  const before = await readArchiveMetadata(location.archivePath);
  if (before === undefined) return undefined;

  let zipFile: ZipFile | undefined;
  try {
    zipFile = await openPromise(location.archivePath, {
      autoClose: false,
      lazyEntries: true,
      strictFileNames: true,
      validateEntrySizes: true,
    });
    if (zipFile.entryCount > MAXIMUM_ARCHIVE_ENTRIES) return undefined;
    const entry = await findExactEntry(zipFile, location.entryPath);
    if (entry === undefined || entry.uncompressedSize > maximumBytes) return undefined;
    const sourceBuffer = await readEntryBytes(zipFile, entry, maximumBytes);
    if (sourceBuffer === undefined) return undefined;
    const after = await readArchiveMetadata(location.archivePath);
    if (after?.fingerprint !== before.fingerprint) return undefined;
    return Object.freeze({
      archiveFingerprint: before.fingerprint,
      archivePath: location.archivePath,
      byteLength: sourceBuffer.byteLength,
      fingerprint: `${before.fingerprint}:entry:${entry.crc32.toString(16)}:${entry.uncompressedSize.toString()}`,
      sourceText: sourceBuffer.toString('utf8'),
    });
  } catch {
    return undefined;
  } finally {
    zipFile?.close();
  }
}

/** Returns a cheap cache identity for one already-proven Yarn archive. */
export async function readPreviewYarnZipArchiveFingerprint(
  archivePath: string,
): Promise<string | undefined> {
  return (await readArchiveMetadata(archivePath))?.fingerprint;
}

/** Accepts only Yarn's physical cache shape and one package-owned node_modules entry. */
function parseYarnZipSourcePath(
  sourcePath: string,
): { readonly archivePath: string; readonly entryPath: string } | undefined {
  const normalizedPath = path.normalize(sourcePath);
  if (!path.isAbsolute(normalizedPath) || !normalizedPath.includes(YARN_CACHE_SEGMENT)) {
    return undefined;
  }
  const lowerPath = normalizedPath.toLowerCase();
  const markerIndex = lowerPath.indexOf(`.zip${path.sep}node_modules${path.sep}`);
  if (markerIndex < 0) return undefined;
  const archivePath = normalizedPath.slice(0, markerIndex + 4);
  const entryPath = normalizedPath
    .slice(markerIndex + 5)
    .split(ZIP_ENTRY_SEPARATOR_PATTERN)
    .join('/');
  return entryPath.startsWith('node_modules/') && entryPath.length > 'node_modules/'.length
    ? { archivePath, entryPath }
    : undefined;
}

/** Reads stable outer-archive metadata without opening any embedded entry. */
async function readArchiveMetadata(
  archivePath: string,
): Promise<{ readonly fingerprint: string } | undefined> {
  try {
    const metadata = await stat(archivePath);
    return metadata.isFile() && metadata.size <= MAXIMUM_ARCHIVE_BYTES
      ? { fingerprint: `yarn-zip:${metadata.mtimeMs.toString()}:${metadata.size.toString()}` }
      : undefined;
  } catch {
    return undefined;
  }
}

/** Scans bounded central-directory metadata until one exact portable path is found. */
function findExactEntry(zipFile: ZipFile, entryPath: string): Promise<Entry | undefined> {
  return new Promise((resolve, reject) => {
    let observedEntries = 0;
    const cleanup = (): void => {
      zipFile.removeListener('entry', onEntry);
      zipFile.removeListener('end', onEnd);
      zipFile.removeListener('error', onError);
    };
    const finish = (entry: Entry | undefined): void => {
      cleanup();
      resolve(entry);
    };
    const onEnd = (): void => {
      finish(undefined);
    };
    const onError = (error: Error): void => {
      cleanup();
      reject(error);
    };
    const onEntry = (entry: Entry): void => {
      observedEntries += 1;
      if (observedEntries > MAXIMUM_ARCHIVE_ENTRIES) {
        finish(undefined);
      } else if (entry.fileName === entryPath) {
        finish(entry);
      } else {
        zipFile.readEntry();
      }
    };
    zipFile.on('entry', onEntry);
    zipFile.on('end', onEnd);
    zipFile.on('error', onError);
    zipFile.readEntry();
  });
}

/** Buffers one validated source entry while enforcing the caller's limit during decompression. */
async function readEntryBytes(
  zipFile: ZipFile,
  entry: Entry,
  maximumBytes: number,
): Promise<Buffer | undefined> {
  const chunks: Buffer[] = [];
  let byteLength = 0;
  const stream = await zipFile.openReadStreamPromise(entry);
  for await (const chunk of stream) {
    const bytes = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk as Uint8Array);
    byteLength += bytes.byteLength;
    if (byteLength > maximumBytes) {
      stream.destroy();
      return undefined;
    }
    chunks.push(bytes);
  }
  return byteLength === entry.uncompressedSize ? Buffer.concat(chunks, byteLength) : undefined;
}
