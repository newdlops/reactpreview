/**
 * Caches bounded package source inventories and real JSX prop evidence across preview builds.
 * A monorepo package is the semantic cache unit, while its containing VS Code workspace remains
 * the security boundary. The cache stores inert paths, primitive props, wrapper recipes, and file
 * metadata only; application modules are never imported or executed by this host-side layer.
 */
import { stat } from 'node:fs/promises';
import path from 'node:path';
import {
  collectPreviewTargetUsageSourcePaths,
  discoverPreviewTargetUsageProps,
  type PreviewTargetUsageProps,
  type PreviewTargetUsagePropsOptions,
} from './previewTargetUsageProps';

const MAX_CACHED_PACKAGES = 16;
const MAX_CACHED_TARGETS = 256;
const SOURCE_INVENTORY_TTL_MILLISECONDS = 5_000;
const NEGATIVE_USAGE_TTL_MILLISECONDS = 5_000;
/** A target-only Inspector root is provisional because a new authored parent may appear later. */
const ZERO_EDGE_INSPECTOR_TTL_MILLISECONDS = 5_000;

/** Filesystem identity used to invalidate a positive usage result after its consumer changes. */
interface DependencyStamp {
  /** Last modification time exposed by the host filesystem. */
  readonly modifiedAt: number;
  /** Absolute consumer path whose literal props were selected. */
  readonly sourcePath: string;
  /** File length catches changes on filesystems with coarse modification timestamps. */
  readonly size: number;
}

/** Reusable package inventory promise and the time at which directory enumeration began. */
interface SourceInventoryCacheEntry {
  /** Creation time used to admit newly created source files after a short hot-reload window. */
  readonly createdAt: number;
  /** Stable, bounded package-local source paths shared by concurrent preview requests. */
  readonly sourcePaths: Promise<readonly string[]>;
}

/** Cached target evidence together with the consumer metadata that proves it remains current. */
interface UsageResultCacheEntry {
  /** Creation time used only for short-lived negative results that have no dependency stamp. */
  readonly createdAt: number;
  /** Consumer file metadata captured after static usage discovery completed. */
  readonly dependencyStamps: readonly DependencyStamp[];
  /** Primitive JSX props, parent slices, and exact dependency paths returned to the compiler. */
  readonly result: PreviewTargetUsageProps;
}

/** Optional clock injection keeps expiry behavior deterministic without exposing mutable internals. */
export interface PreviewProjectUsageCacheOptions {
  /** Returns a monotonically comparable millisecond value; defaults to `Date.now`. */
  readonly now?: () => number;
}

/**
 * Project-lifetime cache for package source discovery and target-specific JSX prop evidence.
 *
 * Positive results survive while the exact consumer files retain their size and modification
 * timestamp. Negative results and directory inventories expire quickly so a newly created parent
 * usage can be discovered on a later refresh. Dirty editor snapshots bypass a matching cached
 * consumer and are always passed to the syntax-only discovery implementation.
 */
export class PreviewProjectUsageCache {
  private readonly now: () => number;
  private readonly sourceInventories = new Map<string, SourceInventoryCacheEntry>();
  private readonly usageResults = new Map<string, UsageResultCacheEntry>();

  /** Creates an empty cache owned by one compiler instance. */
  public constructor(options: PreviewProjectUsageCacheOptions = {}) {
    this.now = options.now ?? Date.now;
  }

  /**
   * Returns real JSX props and wrapper branches while their source evidence remains current.
   *
   * @param options Target, export, snapshot, package, and workspace identities for one build.
   * @returns Static props, parent render slices, and consumer paths used for hot reload routing.
   */
  public async discover(
    options: Omit<PreviewTargetUsagePropsOptions, 'sourcePaths'>,
  ): Promise<PreviewTargetUsageProps> {
    const usageKey = createUsageResultKey(options);
    const cachedResult = this.usageResults.get(usageKey);
    if (cachedResult !== undefined && (await this.isUsageResultCurrent(cachedResult, options))) {
      refreshMapEntry(this.usageResults, usageKey, cachedResult);
      return cachedResult.result;
    }
    this.usageResults.delete(usageKey);

    const sourcePaths = await this.getSourceInventory(options.workspaceRoot, options.projectRoot);
    const result = await discoverPreviewTargetUsageProps({ ...options, sourcePaths });
    const dependencyStamps = await readDependencyStamps(result.dependencyPaths);
    const cacheEntry = {
      createdAt: this.now(),
      dependencyStamps,
      result,
    } satisfies UsageResultCacheEntry;
    this.usageResults.set(usageKey, cacheEntry);
    trimOldestEntries(this.usageResults, MAX_CACHED_TARGETS);
    return result;
  }

  /** Removes retained inventories and evidence during extension/compiler shutdown. */
  public clear(): void {
    this.sourceInventories.clear();
    this.usageResults.clear();
  }

  /** Returns one short-lived package source inventory shared by tabs and concurrent first builds. */
  private async getSourceInventory(
    workspaceRoot: string,
    projectRoot: string,
  ): Promise<readonly string[]> {
    const inventoryKey = createPackageCacheKey(workspaceRoot, projectRoot);
    const currentTime = this.now();
    const cachedInventory = this.sourceInventories.get(inventoryKey);
    if (
      cachedInventory !== undefined &&
      currentTime - cachedInventory.createdAt <= SOURCE_INVENTORY_TTL_MILLISECONDS
    ) {
      refreshMapEntry(this.sourceInventories, inventoryKey, cachedInventory);
      return cachedInventory.sourcePaths;
    }

    const sourcePaths = collectPreviewTargetUsageSourcePaths({ projectRoot, workspaceRoot });
    const nextInventory = { createdAt: currentTime, sourcePaths };
    this.sourceInventories.set(inventoryKey, nextInventory);
    trimOldestEntries(this.sourceInventories, MAX_CACHED_PACKAGES);
    try {
      return await sourcePaths;
    } catch (error) {
      if (this.sourceInventories.get(inventoryKey) === nextInventory) {
        this.sourceInventories.delete(inventoryKey);
      }
      throw error;
    }
  }

  /** Checks expiry, dirty snapshots, and filesystem metadata for one target usage result. */
  private async isUsageResultCurrent(
    cached: UsageResultCacheEntry,
    options: Omit<PreviewTargetUsagePropsOptions, 'sourcePaths'>,
  ): Promise<boolean> {
    const zeroEdgeInspectorPlan = cached.result.inspectorPlan?.edges.length === 0;
    if (
      zeroEdgeInspectorPlan &&
      (this.now() - cached.createdAt > ZERO_EDGE_INSPECTOR_TTL_MILLISECONDS ||
        options.snapshots.some((snapshot) =>
          isPathInside(options.projectRoot, snapshot.documentPath),
        ))
    ) {
      return false;
    }

    if (cached.dependencyStamps.length === 0) {
      return this.now() - cached.createdAt <= NEGATIVE_USAGE_TTL_MILLISECONDS;
    }

    const dirtyPaths = new Set(
      options.snapshots.map((snapshot) => path.normalize(snapshot.documentPath)),
    );
    if (cached.dependencyStamps.some((stamp) => dirtyPaths.has(stamp.sourcePath))) {
      return false;
    }
    const currentStamps = await readDependencyStamps(
      cached.dependencyStamps.map((stamp) => stamp.sourcePath),
    );
    return haveEqualDependencyStamps(cached.dependencyStamps, currentStamps);
  }
}

/** Reports whether a source snapshot remains inside the nearest package cache boundary. */
function isPathInside(rootPath: string, candidatePath: string): boolean {
  const relativePath = path.relative(path.normalize(rootPath), path.normalize(candidatePath));
  return (
    relativePath.length === 0 ||
    (relativePath !== '..' &&
      !relativePath.startsWith(`..${path.sep}`) &&
      !path.isAbsolute(relativePath))
  );
}

/** Builds a stable monorepo package key without relying on platform-specific separator spelling. */
function createPackageCacheKey(workspaceRoot: string, projectRoot: string): string {
  return `${path.normalize(workspaceRoot)}\0${path.normalize(projectRoot)}`;
}

/** Includes target and ordered explicit export identity so source edits cannot reuse wrong props. */
function createUsageResultKey(
  options: Omit<PreviewTargetUsagePropsOptions, 'sourcePaths'>,
): string {
  const exportKey = options.exports
    .map((slot) =>
      slot.kind === 'explicit' ? `explicit:${slot.exportName}:${slot.displayName}` : 'wildcard',
    )
    .join('|');
  const climbKey = options.climbParentSlices === false ? 'direct-only' : 'cross-module';
  const inspectorKey = options.inspectorExportName ?? 'no-inspector-root';
  const tsconfigKey =
    options.tsconfigPath === undefined ? 'nearest-config' : path.normalize(options.tsconfigPath);
  return `${createPackageCacheKey(options.workspaceRoot, options.projectRoot)}\0${path.normalize(options.documentPath)}\0${exportKey}\0${climbKey}\0${inspectorKey}\0${tsconfigKey}`;
}

/** Reads stable metadata for selected consumers; an inaccessible dependency invalidates the cache. */
async function readDependencyStamps(
  dependencyPaths: readonly string[],
): Promise<readonly DependencyStamp[]> {
  const stamps = await Promise.all(
    dependencyPaths.map(async (sourcePath): Promise<DependencyStamp | undefined> => {
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
  return stamps.filter((stamp): stamp is DependencyStamp => stamp !== undefined);
}

/** Compares complete ordered dependency metadata, treating a removed file as invalid evidence. */
function haveEqualDependencyStamps(
  previous: readonly DependencyStamp[],
  current: readonly DependencyStamp[],
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

/** Refreshes insertion order so bounded maps evict the least recently used package or target. */
function refreshMapEntry<Key, Value>(cache: Map<Key, Value>, key: Key, value: Value): void {
  cache.delete(key);
  cache.set(key, value);
}

/** Evicts oldest insertion-ordered entries until one compiler stays within its memory budget. */
function trimOldestEntries<Key, Value>(cache: Map<Key, Value>, maximum: number): void {
  while (cache.size > maximum) {
    const oldestKey = cache.keys().next().value;
    if (oldestKey === undefined) {
      return;
    }
    cache.delete(oldestKey);
  }
}
