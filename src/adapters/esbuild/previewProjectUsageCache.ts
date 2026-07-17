/**
 * Caches bounded package source inventories and real JSX prop evidence across preview builds.
 * A monorepo package is the semantic cache unit, while its containing VS Code workspace remains
 * the security boundary. The cache stores inert paths, primitive props, wrapper recipes, and file
 * metadata only; application modules are never imported or executed by this host-side layer.
 */
import { createHash } from 'node:crypto';
import { stat } from 'node:fs/promises';
import path from 'node:path';
import { throwIfPreviewBuildCancelled } from '../../domain/previewBuildExecution';
import { PreviewProjectFileAnalysisCache } from './previewProjectFileAnalysisCache';
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

/** Public discovery input with compiler-owned inventory and file caches deliberately hidden. */
type PreviewProjectUsageDiscoveryOptions = Omit<
  PreviewTargetUsagePropsOptions,
  'analysisCache' | 'sourcePaths'
>;

/** Filesystem identity used to invalidate a positive usage result after its consumer changes. */
interface DependencyStamp {
  /** Last modification time exposed by the host filesystem. */
  readonly modifiedAt: number;
  /** Absolute consumer path whose literal props were selected. */
  readonly sourcePath: string;
  /** File length catches changes on filesystems with coarse modification timestamps. */
  readonly size: number;
}

/** Immutable package source inventory plus a stable path-set fingerprint for precise invalidation. */
interface SourceInventorySnapshot {
  /** Hash of ordered normalized source paths; unchanged refreshes preserve positive evidence. */
  readonly fingerprint: string;
  /** Stable, bounded package-local source paths shared by concurrent preview requests. */
  readonly sourcePaths: readonly string[];
}

/** Reusable package inventory promise and the time at which directory enumeration began. */
interface SourceInventoryCacheEntry {
  /** Check time used to admit newly created source files after a short hot-reload window. */
  readonly checkedAt: number;
  /** Signal owning an unfinished enumeration; cleared when later revisions may reuse the result. */
  ownerSignal: AbortSignal | undefined;
  /** Paths and fingerprint shared by concurrent preview requests. */
  readonly snapshot: Promise<SourceInventorySnapshot>;
}

/** Cached target evidence together with the consumer metadata that proves it remains current. */
interface UsageResultCacheEntry {
  /** Creation time used only for short-lived negative results that have no dependency stamp. */
  readonly createdAt: number;
  /** Consumer file metadata captured after static usage discovery completed. */
  readonly dependencyStamps: readonly DependencyStamp[];
  /** Source inventory identity used to invalidate only when files are created or removed. */
  readonly inventoryFingerprint: string;
  /** Primitive JSX props, parent slices, and exact dependency paths returned to the compiler. */
  readonly result: PreviewTargetUsageProps;
  /** Exact current editor target identity kept outside the stable target cache key. */
  readonly targetSourceFingerprint?: string;
}

/** Optional clock injection keeps expiry behavior deterministic without exposing mutable internals. */
export interface PreviewProjectUsageCacheOptions {
  /** Optional file cache injection used by deterministic cache identity tests. */
  readonly fileAnalysisCache?: PreviewProjectFileAnalysisCache;
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
  private readonly fileAnalysisCache: PreviewProjectFileAnalysisCache;
  private readonly now: () => number;
  private readonly sourceInventories = new Map<string, SourceInventoryCacheEntry>();
  private readonly usageResults = new Map<string, UsageResultCacheEntry>();

  /** Creates an empty cache owned by one compiler instance. */
  public constructor(options: PreviewProjectUsageCacheOptions = {}) {
    this.fileAnalysisCache = options.fileAnalysisCache ?? new PreviewProjectFileAnalysisCache();
    this.now = options.now ?? Date.now;
  }

  /**
   * Returns real JSX props and wrapper branches while their source evidence remains current.
   *
   * @param options Target, export, snapshot, package, and workspace identities for one build.
   * @returns Static props, parent render slices, and consumer paths used for hot reload routing.
   */
  public async discover(
    options: PreviewProjectUsageDiscoveryOptions,
  ): Promise<PreviewTargetUsageProps> {
    throwIfPreviewBuildCancelled(options.signal);
    const inventory = await this.getSourceInventory(
      options.workspaceRoot,
      options.projectRoot,
      options.signal,
    );
    const usageKey = createUsageResultKey(options);
    const cachedResult = this.usageResults.get(usageKey);
    if (
      cachedResult !== undefined &&
      (await this.isUsageResultCurrent(cachedResult, options, inventory.fingerprint))
    ) {
      refreshMapEntry(this.usageResults, usageKey, cachedResult);
      return cachedResult.result;
    }
    this.usageResults.delete(usageKey);

    const result = await discoverPreviewTargetUsageProps({
      ...options,
      analysisCache: this.fileAnalysisCache,
      sourcePaths: inventory.sourcePaths,
    });
    throwIfPreviewBuildCancelled(options.signal);
    const dependencyStamps = await readDependencyStamps(
      [
        ...new Set([
          ...result.dependencyPaths,
          options.documentPath,
          ...(options.tsconfigPath === undefined ? [] : [options.tsconfigPath]),
        ]),
      ],
      options.signal,
    );
    const cacheEntry = {
      createdAt: this.now(),
      dependencyStamps,
      inventoryFingerprint: inventory.fingerprint,
      result,
      ...(options.sourceText === undefined
        ? {}
        : { targetSourceFingerprint: createSourceTextFingerprint(options.sourceText) }),
    } satisfies UsageResultCacheEntry;
    this.usageResults.set(usageKey, cacheEntry);
    trimOldestEntries(this.usageResults, MAX_CACHED_TARGETS);
    return result;
  }

  /** Removes retained inventories and evidence during extension/compiler shutdown. */
  public clear(): void {
    this.fileAnalysisCache.clear();
    this.sourceInventories.clear();
    this.usageResults.clear();
  }

  /**
   * Returns one short-lived package source inventory shared by usage and runtime-evidence scans.
   *
   * Exposing the immutable path list avoids enumerating a large monorepo package twice when the
   * compiler needs both reverse React ownership and application-bootstrap global declarations.
   * File contents remain outside this cache and are still read through each bounded analyzer.
   *
   * @param workspaceRoot Trusted workspace containing the selected package.
   * @param projectRoot Nearest package root whose authored source should be enumerated.
   * @returns Stable package-owned source paths, shared across concurrent callers and preview tabs.
   */
  public async getSourcePaths(
    workspaceRoot: string,
    projectRoot: string,
    signal?: AbortSignal,
  ): Promise<readonly string[]> {
    return (await this.getSourceInventory(workspaceRoot, projectRoot, signal)).sourcePaths;
  }

  /**
   * Refreshes package paths after the short discovery window while preserving a stable fingerprint.
   * An unchanged directory listing therefore does not evict valid props or render chains merely
   * because five seconds elapsed; creation/removal changes the fingerprint and invalidates them.
   */
  private async getSourceInventory(
    workspaceRoot: string,
    projectRoot: string,
    signal?: AbortSignal,
  ): Promise<SourceInventorySnapshot> {
    throwIfPreviewBuildCancelled(signal);
    const inventoryKey = createPackageCacheKey(workspaceRoot, projectRoot);
    const currentTime = this.now();
    const cachedInventory = this.sourceInventories.get(inventoryKey);
    if (
      cachedInventory !== undefined &&
      (cachedInventory.ownerSignal === undefined || cachedInventory.ownerSignal === signal) &&
      currentTime - cachedInventory.checkedAt <= SOURCE_INVENTORY_TTL_MILLISECONDS
    ) {
      refreshMapEntry(this.sourceInventories, inventoryKey, cachedInventory);
      return cachedInventory.snapshot;
    }

    const snapshot = collectPreviewTargetUsageSourcePaths({
      projectRoot,
      ...(signal === undefined ? {} : { signal }),
      workspaceRoot,
    }).then((sourcePaths) =>
      Object.freeze({
        fingerprint: createSourceInventoryFingerprint(sourcePaths),
        sourcePaths: Object.freeze([...sourcePaths]),
      }),
    );
    const nextInventory: SourceInventoryCacheEntry = {
      checkedAt: currentTime,
      ownerSignal: signal,
      snapshot,
    };
    void snapshot.then(
      () => {
        nextInventory.ownerSignal = undefined;
      },
      () => undefined,
    );
    this.sourceInventories.set(inventoryKey, nextInventory);
    trimOldestEntries(this.sourceInventories, MAX_CACHED_PACKAGES);
    try {
      return await snapshot;
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
    options: PreviewProjectUsageDiscoveryOptions,
    inventoryFingerprint: string,
  ): Promise<boolean> {
    throwIfPreviewBuildCancelled(options.signal);
    if (cached.inventoryFingerprint !== inventoryFingerprint) {
      return false;
    }
    if (
      cached.targetSourceFingerprint !==
      (options.sourceText === undefined
        ? undefined
        : createSourceTextFingerprint(options.sourceText))
    ) {
      return false;
    }
    const zeroEdgeInspectorPlan = cached.result.inspectorPlan?.edges.length === 0;
    const provisionalRenderChain = Object.values(cached.result.renderChainsByExport ?? {}).some(
      (plan) => plan.reachability === 'entry-unreachable' || plan.truncated,
    );
    if (
      (zeroEdgeInspectorPlan || provisionalRenderChain) &&
      options.snapshots.some((snapshot) => isPathInside(options.projectRoot, snapshot.documentPath))
    ) {
      return false;
    }

    if (cached.result.dependencyPaths.length === 0) {
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
      options.signal,
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

/** Hashes the ordered normalized package path set without reading any source contents. */
function createSourceInventoryFingerprint(sourcePaths: readonly string[]): string {
  const hash = createHash('sha256');
  for (const sourcePath of sourcePaths) {
    hash.update(path.normalize(sourcePath));
    hash.update('\0');
  }
  return hash.digest('hex');
}

/** Uses stable target/configuration identity while source fingerprints invalidate values in place. */
function createUsageResultKey(options: PreviewProjectUsageDiscoveryOptions): string {
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

/** Hashes current editor text without embedding every hot revision into the bounded map key. */
function createSourceTextFingerprint(sourceText: string): string {
  return createHash('sha256').update(sourceText).digest('hex');
}

/** Reads stable metadata for selected consumers; an inaccessible dependency invalidates the cache. */
async function readDependencyStamps(
  dependencyPaths: readonly string[],
  signal?: AbortSignal,
): Promise<readonly DependencyStamp[]> {
  throwIfPreviewBuildCancelled(signal);
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
  throwIfPreviewBuildCancelled(signal);
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
