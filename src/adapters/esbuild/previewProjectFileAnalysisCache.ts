/**
 * Retains bounded file snapshots and syntax-only React render facts across preview rebuilds.
 * Disk entries are identified by normalized path, modification time, and size; unsaved editor
 * entries hash exact UTF-16 text. Pending checks and reads share work only for equal byte ceilings.
 * Superseded reads cannot restore cleared facts or overwrite newer editor snapshots.
 * Only the changed file loses its module/import facts, allowing a
 * target edit to reuse the rest of a large monorepo's static analysis safely.
 */
import { createHash } from 'node:crypto';
import { open, stat } from 'node:fs/promises';
import path from 'node:path';
import { PreviewYarnZipEntryCache } from './previewYarnZipEntryCache';
import {
  analyzePreviewRenderSource,
  collectPreviewRenderModuleSpecifiers,
  type PreviewRenderSourceAnalysis,
} from './renderGraph/previewRenderSourceAnalysis';
import {
  readPreviewYarnZipArchiveFingerprint,
  readPreviewYarnZipSource,
} from './previewYarnZipSource';

const MAX_CACHED_SOURCE_FILES = 16_384;
const MAX_CACHED_SOURCE_BYTES = 128 * 1024 * 1024;
const MAX_CACHED_ANALYSIS_FILES = 16_384;

/** One immutable source snapshot returned to byte-bounded project analyzers. */
export interface PreviewProjectSourceRecord {
  /** UTF-8 byte count charged against the caller's existing analysis budget. */
  readonly byteLength: number;
  /** Absolute normalized authored module path. */
  readonly filePath: string;
  /** Opaque disk metadata or editor-content identity used only by this cache. */
  readonly fingerprint: string;
  /** Current source text, never evaluated by the extension host. */
  readonly sourceText: string;
}

/** Cached source plus the metadata needed to revalidate its exact storage origin. */
type SourceCacheEntry =
  | {
      readonly origin: 'disk' | 'snapshot';
      readonly record: PreviewProjectSourceRecord;
    }
  | {
      readonly archiveFingerprint: string;
      readonly archivePath: string;
      readonly origin: 'yarn-zip';
      readonly record: PreviewProjectSourceRecord;
    };

/** One file's AST-derived facts keyed by the exact source fingerprint that produced them. */
interface RenderAnalysisCacheEntry {
  readonly analysis: PreviewRenderSourceAnalysis;
  readonly fingerprint: string;
}

/** One file's lightweight literal import index keyed by exact source fingerprint. */
interface ImportFactsCacheEntry {
  readonly fingerprint: string;
  readonly moduleSpecifiers: readonly string[];
}

/** Inputs for reading one source while preserving the caller's established file-size ceiling. */
export interface ReadPreviewProjectSourceOptions {
  /** Maximum accepted UTF-8 or disk byte length. */
  readonly maximumBytes: number;
  /** Unsaved text that takes precedence over the filesystem when present. */
  readonly snapshotText?: string;
  /** Absolute authored source path. */
  readonly sourcePath: string;
}

/**
 * Compiler-lifetime, file-granular cache for source text, module facts, and literal import facts.
 *
 * Source and analysis maps use insertion order as an LRU approximation. Source bytes remain under
 * the same 128 MiB ceiling as one full usage scan, and analysis entries contain primitives only;
 * no TypeScript AST or application value is retained between builds.
 */
export class PreviewProjectFileAnalysisCache {
  private readonly importFactsByPath = new Map<string, ImportFactsCacheEntry>();
  private readonly pendingSourceReads = new Map<string, Promise<SourceCacheEntry | undefined>>();
  /** Latest unfinished validation/read; removed on completion, editor replacement, or clear. */
  private readonly sourceReadOwners = new Map<string, Promise<SourceCacheEntry | undefined>>();
  private readonly renderAnalysisByPath = new Map<string, RenderAnalysisCacheEntry>();
  private readonly sourceByPath = new Map<string, SourceCacheEntry>();
  private retainedSourceBytes = 0;
  private readonly yarnZipEntries = new PreviewYarnZipEntryCache();

  /**
   * Reads a current editor snapshot or disk file and reuses text when its identity is unchanged.
   *
   * @param options Path, optional snapshot, and existing per-file byte limit.
   * @returns Immutable current text, or `undefined` for inaccessible/oversized files.
   */
  public async readSource(
    options: ReadPreviewProjectSourceOptions,
  ): Promise<PreviewProjectSourceRecord | undefined> {
    const normalizedPath = path.normalize(options.sourcePath);
    if (options.snapshotText !== undefined) {
      return this.readSnapshot(normalizedPath, options.snapshotText, options.maximumBytes);
    }

    return this.readPendingSource(normalizedPath, options.maximumBytes);
  }

  /**
   * Returns cached AST-derived render facts or parses only this changed source module.
   *
   * @param sourcePath Absolute authored path used as the per-file cache key.
   * @param sourceText Current text previously supplied by the byte-bounded reader.
   * @returns Immutable module/value-flow and ReactDOM entry evidence.
   */
  public analyzeRenderSource(sourcePath: string, sourceText: string): PreviewRenderSourceAnalysis {
    const normalizedPath = path.normalize(sourcePath);
    const fingerprint = this.readSourceFingerprint(normalizedPath, sourceText);
    const cached = this.renderAnalysisByPath.get(normalizedPath);
    if (cached?.fingerprint === fingerprint) {
      refreshMapEntry(this.renderAnalysisByPath, normalizedPath, cached);
      return cached.analysis;
    }
    const analysis = analyzePreviewRenderSource(normalizedPath, sourceText);
    this.renderAnalysisByPath.set(normalizedPath, { analysis, fingerprint });
    trimOldestEntries(this.renderAnalysisByPath, MAX_CACHED_ANALYSIS_FILES);
    return analysis;
  }

  /**
   * Returns one file's cached literal dependency list for coarse forward/reverse graph indexes.
   *
   * @param sourcePath Absolute authored path used as the per-file cache key.
   * @param sourceText Current text previously supplied by the byte-bounded reader.
   * @returns Immutable clean module specifiers in authored order.
   */
  public collectModuleSpecifiers(sourcePath: string, sourceText: string): readonly string[] {
    const normalizedPath = path.normalize(sourcePath);
    const fingerprint = this.readSourceFingerprint(normalizedPath, sourceText);
    const cached = this.importFactsByPath.get(normalizedPath);
    if (cached?.fingerprint === fingerprint) {
      refreshMapEntry(this.importFactsByPath, normalizedPath, cached);
      return cached.moduleSpecifiers;
    }
    const moduleSpecifiers = collectPreviewRenderModuleSpecifiers(normalizedPath, sourceText);
    this.importFactsByPath.set(normalizedPath, { fingerprint, moduleSpecifiers });
    trimOldestEntries(this.importFactsByPath, MAX_CACHED_ANALYSIS_FILES);
    return moduleSpecifiers;
  }

  /** Removes all retained text and inert facts during compiler shutdown. */
  public clear(): void {
    this.importFactsByPath.clear();
    this.pendingSourceReads.clear();
    this.sourceReadOwners.clear();
    this.renderAnalysisByPath.clear();
    this.sourceByPath.clear();
    this.retainedSourceBytes = 0;
    this.yarnZipEntries.clear();
  }

  /** Creates or reuses an editor-content record without consulting stale disk metadata. */
  private readSnapshot(
    sourcePath: string,
    sourceText: string,
    maximumBytes: number,
  ): PreviewProjectSourceRecord | undefined {
    this.sourceReadOwners.delete(sourcePath);
    const cached = this.sourceByPath.get(sourcePath);
    if (
      cached?.origin === 'snapshot' &&
      cached.record.sourceText === sourceText &&
      cached.record.byteLength <= maximumBytes
    ) {
      refreshMapEntry(this.sourceByPath, sourcePath, cached);
      return cached.record;
    }
    const byteLength = Buffer.byteLength(sourceText, 'utf8');
    if (byteLength > maximumBytes) {
      this.deleteSource(sourcePath);
      return undefined;
    }
    const fingerprint = createSnapshotFingerprint(sourceText);
    if (cached?.origin === 'snapshot' && cached.record.fingerprint === fingerprint) {
      refreshMapEntry(this.sourceByPath, sourcePath, cached);
      return cached.record;
    }
    const record = Object.freeze({ byteLength, filePath: sourcePath, fingerprint, sourceText });
    this.storeSource(sourcePath, { origin: 'snapshot', record });
    return record;
  }

  /**
   * Owns the entire metadata/read operation before its first await and shares equal ceilings.
   * A superseded validation still returns to its caller, but cannot take ownership from a newer
   * operation, refresh/delete its cache entry, or remove its pending read after completion.
   */
  private async readPendingSource(
    sourcePath: string,
    maximumBytes: number,
  ): Promise<PreviewProjectSourceRecord | undefined> {
    const pendingKey = `${sourcePath}\0${maximumBytes.toString()}`;
    const pending = this.pendingSourceReads.get(pendingKey);
    if (pending !== undefined && this.sourceReadOwners.get(sourcePath) === pending) {
      return (await pending)?.record;
    }
    const expectedSource = this.sourceByPath.get(sourcePath);
    const readPromise = this.loadCurrentSource(sourcePath, maximumBytes, expectedSource);
    this.pendingSourceReads.set(pendingKey, readPromise);
    this.sourceReadOwners.set(sourcePath, readPromise);
    try {
      const entry = await readPromise;
      if (
        this.pendingSourceReads.get(pendingKey) === readPromise &&
        this.sourceReadOwners.get(sourcePath) === readPromise &&
        this.sourceByPath.get(sourcePath) === expectedSource
      ) {
        if (entry === undefined) this.deleteSource(sourcePath);
        else if (entry === expectedSource) refreshMapEntry(this.sourceByPath, sourcePath, entry);
        else this.storeSource(sourcePath, entry);
      }
      return entry?.record;
    } finally {
      if (this.pendingSourceReads.get(pendingKey) === readPromise) {
        this.pendingSourceReads.delete(pendingKey);
      }
      if (this.sourceReadOwners.get(sourcePath) === readPromise) {
        this.sourceReadOwners.delete(sourcePath);
      }
    }
  }

  /**
   * Rechecks saved identities without mutating cache ownership across asynchronous boundaries.
   * Cold and editor-to-disk reads open directly; the handle still checks file kind and byte size.
   * Completed validations are never retained, so the next sequential call observes new edits.
   */
  private async loadCurrentSource(
    sourcePath: string,
    maximumBytes: number,
    cached: SourceCacheEntry | undefined,
  ): Promise<SourceCacheEntry | undefined> {
    if (cached?.origin === 'yarn-zip') {
      const archiveFingerprint = await readPreviewYarnZipArchiveFingerprint(cached.archivePath);
      if (
        archiveFingerprint === cached.archiveFingerprint &&
        cached.record.byteLength <= maximumBytes
      ) {
        return cached;
      }
    } else if (cached?.origin === 'disk') {
      try {
        const metadata = await stat(sourcePath);
        if (!metadata.isFile() || metadata.size > maximumBytes) return undefined;
        if (
          cached.record.fingerprint === createDiskFingerprint(metadata.mtimeMs, metadata.size) &&
          cached.record.byteLength <= maximumBytes
        ) {
          return cached;
        }
      } catch {
        return undefined;
      }
    }
    return this.loadStoredSource(sourcePath, maximumBytes);
  }

  /** Opens and reads one changed disk file while guarding against oversized or non-file entries. */
  private async loadDiskSource(
    sourcePath: string,
    maximumBytes: number,
  ): Promise<PreviewProjectSourceRecord | undefined> {
    try {
      const sourceHandle = await open(sourcePath, 'r');
      try {
        const metadata = await sourceHandle.stat();
        if (!metadata.isFile() || metadata.size > maximumBytes) {
          return undefined;
        }
        const sourceText = await sourceHandle.readFile({ encoding: 'utf8' });
        const byteLength = Buffer.byteLength(sourceText, 'utf8');
        return byteLength <= maximumBytes
          ? Object.freeze({
              byteLength,
              filePath: sourcePath,
              fingerprint: createDiskFingerprint(metadata.mtimeMs, metadata.size),
              sourceText,
            })
          : undefined;
      } finally {
        await sourceHandle.close();
      }
    } catch {
      return undefined;
    }
  }

  /** Falls back to an inert Yarn cache entry only when the native filesystem path is virtual. */
  private async loadStoredSource(
    sourcePath: string,
    maximumBytes: number,
  ): Promise<SourceCacheEntry | undefined> {
    const diskRecord = await this.loadDiskSource(sourcePath, maximumBytes);
    if (diskRecord !== undefined) return { origin: 'disk', record: diskRecord };
    const archiveRecord = await readPreviewYarnZipSource(
      sourcePath,
      maximumBytes,
      this.yarnZipEntries,
    );
    return archiveRecord === undefined
      ? undefined
      : {
          archiveFingerprint: archiveRecord.archiveFingerprint,
          archivePath: archiveRecord.archivePath,
          origin: 'yarn-zip',
          record: Object.freeze({
            byteLength: archiveRecord.byteLength,
            filePath: sourcePath,
            fingerprint: archiveRecord.fingerprint,
            sourceText: archiveRecord.sourceText,
          }),
        };
  }

  /** Reads the already-known source identity, hashing only direct uncached caller text. */
  private readSourceFingerprint(sourcePath: string, sourceText: string): string {
    const cachedSource = this.sourceByPath.get(sourcePath);
    return cachedSource?.record.sourceText === sourceText
      ? cachedSource.record.fingerprint
      : createSnapshotFingerprint(sourceText);
  }

  /** Inserts one source record while enforcing entry and aggregate byte ceilings. */
  private storeSource(sourcePath: string, entry: SourceCacheEntry): void {
    this.deleteSource(sourcePath);
    this.sourceByPath.set(sourcePath, entry);
    this.retainedSourceBytes += entry.record.byteLength;
    while (
      this.sourceByPath.size > MAX_CACHED_SOURCE_FILES ||
      this.retainedSourceBytes > MAX_CACHED_SOURCE_BYTES
    ) {
      const oldestPath = this.sourceByPath.keys().next().value;
      if (oldestPath === undefined) {
        break;
      }
      this.deleteSource(oldestPath);
    }
  }

  /** Deletes one source record and updates the aggregate retained-byte counter. */
  private deleteSource(sourcePath: string): void {
    this.sourceReadOwners.delete(sourcePath);
    const existing = this.sourceByPath.get(sourcePath);
    if (existing !== undefined) {
      this.retainedSourceBytes -= existing.record.byteLength;
      this.sourceByPath.delete(sourcePath);
    }
  }
}

/** Encodes stable disk metadata without reading or hashing unchanged source text. */
function createDiskFingerprint(modifiedAt: number, size: number): string {
  return `disk:${modifiedAt.toString()}:${size.toString()}`;
}

/** Hashes exact UTF-16 editor text so distinct unpaired characters cannot share source facts. */
function createSnapshotFingerprint(sourceText: string): string {
  return `snapshot:${createHash('sha256').update(sourceText, 'utf16le').digest('hex')}`;
}

/** Refreshes insertion order so active file facts remain resident under bounded LRU eviction. */
function refreshMapEntry<Key, Value>(cache: Map<Key, Value>, key: Key, value: Value): void {
  cache.delete(key);
  cache.set(key, value);
}

/** Removes oldest file-granular facts until the configured entry ceiling is respected. */
function trimOldestEntries<Key, Value>(cache: Map<Key, Value>, maximum: number): void {
  while (cache.size > maximum) {
    const oldestKey = cache.keys().next().value;
    if (oldestKey === undefined) {
      return;
    }
    cache.delete(oldestKey);
  }
}
