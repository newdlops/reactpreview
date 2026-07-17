/**
 * Reuses bounded application-global evidence across preview tabs and hot rebuilds.
 * The expensive first pass may inspect thousands of package source paths, while selected evidence
 * normally depends on only an ambient declaration, an entry assignment, and one wrapper module.
 */
import { stat } from 'node:fs/promises';
import path from 'node:path';
import { throwIfPreviewBuildCancelled } from '../../domain/previewBuildExecution';
import {
  collectPreviewImplicitGlobalEvidence,
  type PreviewImplicitGlobalEvidenceInventory,
  type PreviewImplicitGlobalEvidenceOptions,
} from './previewImplicitGlobalEvidence';

const EVIDENCE_CACHE_TTL_MILLISECONDS = 5_000;
const MAX_CACHED_EVIDENCE_PROJECTS = 16;

/** Filesystem identity used to invalidate selected declaration and wrapper evidence. */
interface EvidenceDependencyStamp {
  /** Last filesystem modification time when evidence discovery completed. */
  readonly modifiedAt: number;
  /** Canonical or normalized source/module evidence path. */
  readonly sourcePath: string;
  /** File length catches changes on filesystems with coarse timestamps. */
  readonly size: number;
}

/** Resolved evidence plus the exact editor overlays and disk metadata that established it. */
interface ResolvedEvidenceCacheValue {
  readonly dependencyStamps: readonly EvidenceDependencyStamp[];
  readonly inventory: PreviewImplicitGlobalEvidenceInventory;
  readonly snapshotTextByPath: ReadonlyMap<string, string>;
}

/** One shared in-flight or resolved package evidence scan. */
interface EvidenceCacheEntry {
  readonly createdAt: number;
  /** Signal that owns an unfinished scan; cleared once the value can safely serve later revisions. */
  ownerSignal: AbortSignal | undefined;
  readonly value: Promise<ResolvedEvidenceCacheValue>;
}

/** Discovery inputs augmented with a stable project/config key and current editor overlays. */
export interface PreviewImplicitGlobalEvidenceCacheOptions extends PreviewImplicitGlobalEvidenceOptions {
  /** Package root plus tsconfig identity; callers must keep distinct resolver policies separate. */
  readonly cacheKey: string;
  /** Current target/dependency snapshots keyed by normalized and canonical source identities. */
  readonly snapshotSourceByPath: ReadonlyMap<string, string>;
}

/**
 * Small LRU-like cache whose positive results are validated against selected files before reuse.
 * Negative and inventory-sensitive results expire quickly so newly authored bootstrap evidence is
 * discovered after refresh without broad directory watchers or project configuration execution.
 */
export class PreviewImplicitGlobalEvidenceCache {
  private readonly entries = new Map<string, EvidenceCacheEntry>();

  /**
   * Returns current evidence, sharing one first scan among concurrent panels.
   *
   * @param options Static scan inputs, project/config cache key, and unsaved source overlays.
   * @returns Bounded runtime-assignment and ambient-declaration evidence inventory.
   */
  public async discover(
    options: PreviewImplicitGlobalEvidenceCacheOptions,
  ): Promise<PreviewImplicitGlobalEvidenceInventory> {
    throwIfPreviewBuildCancelled(options.signal);
    const currentTime = Date.now();
    const cached = this.entries.get(options.cacheKey);
    if (
      cached !== undefined &&
      (cached.ownerSignal === undefined || cached.ownerSignal === options.signal)
    ) {
      const resolved = await cached.value;
      throwIfPreviewBuildCancelled(options.signal);
      if (
        currentTime - cached.createdAt <= EVIDENCE_CACHE_TTL_MILLISECONDS &&
        (await isEvidenceValueCurrent(resolved, options.snapshotSourceByPath, options.signal))
      ) {
        refreshEntry(this.entries, options.cacheKey, cached);
        return resolved.inventory;
      }
      this.entries.delete(options.cacheKey);
    }

    const entry: EvidenceCacheEntry = {
      createdAt: currentTime,
      ownerSignal: options.signal,
      value: discoverStampedEvidence(options),
    };
    void entry.value.then(
      () => {
        entry.ownerSignal = undefined;
      },
      () => undefined,
    );
    this.entries.set(options.cacheKey, entry);
    trimOldestEntries(this.entries, MAX_CACHED_EVIDENCE_PROJECTS);
    try {
      return (await entry.value).inventory;
    } catch (error) {
      if (this.entries.get(options.cacheKey) === entry) {
        this.entries.delete(options.cacheKey);
      }
      throw error;
    }
  }

  /** Removes retained paths, snapshots, and promises during compiler shutdown. */
  public clear(): void {
    this.entries.clear();
  }
}

/** Runs one evidence pass and captures only the selected dependency identities afterward. */
async function discoverStampedEvidence(
  options: PreviewImplicitGlobalEvidenceCacheOptions,
): Promise<ResolvedEvidenceCacheValue> {
  const inventory = await collectPreviewImplicitGlobalEvidence(options);
  throwIfPreviewBuildCancelled(options.signal);
  const dependencyStamps = await readDependencyStamps(inventory.dependencyPaths, options.signal);
  const snapshotTextByPath = new Map<string, string>();
  for (const dependencyPath of inventory.dependencyPaths) {
    const normalizedPath = path.normalize(dependencyPath);
    const snapshotText = options.snapshotSourceByPath.get(normalizedPath);
    if (snapshotText !== undefined) {
      snapshotTextByPath.set(normalizedPath, snapshotText);
    }
  }
  return { dependencyStamps, inventory, snapshotTextByPath };
}

/** Validates both saved metadata and the presence/content of selected editor snapshots. */
async function isEvidenceValueCurrent(
  value: ResolvedEvidenceCacheValue,
  snapshotSourceByPath: ReadonlyMap<string, string>,
  signal?: AbortSignal,
): Promise<boolean> {
  for (const dependencyPath of value.inventory.dependencyPaths) {
    throwIfPreviewBuildCancelled(signal);
    const normalizedPath = path.normalize(dependencyPath);
    if (value.snapshotTextByPath.get(normalizedPath) !== snapshotSourceByPath.get(normalizedPath)) {
      return false;
    }
  }
  const currentStamps = await readDependencyStamps(
    value.dependencyStamps.map((stamp) => stamp.sourcePath),
    signal,
  );
  return haveEqualDependencyStamps(value.dependencyStamps, currentStamps);
}

/** Reads regular-file metadata and omits inaccessible paths so removal invalidates the cache. */
async function readDependencyStamps(
  dependencyPaths: readonly string[],
  signal?: AbortSignal,
): Promise<readonly EvidenceDependencyStamp[]> {
  throwIfPreviewBuildCancelled(signal);
  const stamps = await Promise.all(
    dependencyPaths.map(async (sourcePath): Promise<EvidenceDependencyStamp | undefined> => {
      try {
        const metadata = await stat(sourcePath);
        return metadata.isFile()
          ? {
              modifiedAt: metadata.mtimeMs,
              size: metadata.size,
              sourcePath: path.normalize(sourcePath),
            }
          : undefined;
      } catch {
        return undefined;
      }
    }),
  );
  throwIfPreviewBuildCancelled(signal);
  return stamps.filter((stamp): stamp is EvidenceDependencyStamp => stamp !== undefined);
}

/** Compares complete ordered metadata so changed, removed, or replaced evidence cannot be reused. */
function haveEqualDependencyStamps(
  previous: readonly EvidenceDependencyStamp[],
  current: readonly EvidenceDependencyStamp[],
): boolean {
  return (
    previous.length === current.length &&
    previous.every((stamp, index) => {
      const candidate = current[index];
      return (
        stamp.sourcePath === candidate?.sourcePath &&
        stamp.modifiedAt === candidate.modifiedAt &&
        stamp.size === candidate.size
      );
    })
  );
}

/** Refreshes insertion order so the bounded map approximates least-recently-used eviction. */
function refreshEntry<Key, Value>(cache: Map<Key, Value>, key: Key, value: Value): void {
  cache.delete(key);
  cache.set(key, value);
}

/** Evicts oldest insertion-ordered projects until the fixed memory boundary is restored. */
function trimOldestEntries<Key, Value>(cache: Map<Key, Value>, maximum: number): void {
  while (cache.size > maximum) {
    const oldestKey = cache.keys().next().value;
    if (oldestKey === undefined) {
      return;
    }
    cache.delete(oldestKey);
  }
}
