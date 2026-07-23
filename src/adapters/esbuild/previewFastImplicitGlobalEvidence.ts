/**
 * Selects bounded implicit-global discovery for fast and fully enriched preview preparation.
 *
 * Fast Page Inspector already owns a small statically proven entry-to-target dependency corridor.
 * Scanning only that corridor recovers application-bootstrap assignments such as
 * `globalThis.utility = importedUtility` without recreating the package-wide inventory that fast
 * preparation intentionally avoids. Full preparation continues to use the shared evidence cache.
 */
import { open } from 'node:fs/promises';
import path from 'node:path';
import { throwIfPreviewBuildCancelled } from '../../domain/previewBuildExecution';
import {
  collectPreviewImplicitGlobalEvidence,
  type PreviewImplicitGlobalEvidenceInventory,
  type PreviewImplicitGlobalModuleResolver,
  type PreviewImplicitGlobalSourceReader,
} from './previewImplicitGlobalEvidence';
import type { PreviewImplicitGlobalEvidenceCache } from './previewImplicitGlobalEvidenceCache';
import { EMPTY_IMPLICIT_GLOBAL_EVIDENCE } from './previewCompilerDefaults';

const MAXIMUM_FAST_GLOBAL_FILES = 256;
const MAXIMUM_FAST_GLOBAL_CANDIDATES = 128;
const MAXIMUM_FAST_GLOBAL_FILE_BYTES = 4 * 1024 * 1024;
const MAXIMUM_FAST_GLOBAL_TOTAL_BYTES = 16 * 1024 * 1024;
const MAXIMUM_FAST_GLOBAL_PREFLIGHT_FILES = 256;
const MAXIMUM_CONCURRENT_FAST_GLOBAL_READS = 4;
const SOURCE_EXTENSION_PATTERN = /\.(?:[cm]?[jt]sx?)$/iu;
const BOOTSTRAP_FILE_STEM_PATTERN =
  /(?:^|[-_.])(?:app|bootstrap|client|entry|global|globals|index|main|polyfills?|root)(?:[-_.]|$)/iu;
const IMPLICIT_GLOBAL_MARKER_PATTERN = /\b(?:globalThis|window)\b|\bdeclare\s+(?:global|var)\b/u;
const AUXILIARY_PATH_PATTERN =
  /(?:^|[/\\])(?:__fixtures__|__mocks__|__tests__|demos?|examples?|fixtures?|mocks?|stories?|tests?)(?:[/\\]|$)|\.(?:spec|stories|story|test)\.[cm]?[jt]sx?$/iu;

/** Inputs shared by the fast bounded pass and existing full cached discovery. */
export interface PreparePreviewImplicitGlobalEvidenceOptions {
  /** Package/config identity retained only by the full evidence cache. */
  readonly cacheKey: string;
  /** Reusable full-preparation cache owned by the compiler instance. */
  readonly cache: PreviewImplicitGlobalEvidenceCache;
  /** Package inventory used when no exact Page Inspector corridor exists. */
  readonly fallbackSourcePaths: readonly string[];
  /** True only for the latency-bounded preparation path. */
  readonly fast: boolean;
  /** Exact entry/ancestor/target dependency corridor selected by static analysis. */
  readonly inspectorDependencyPaths: readonly string[];
  /** Statically proven ReactDOM entry file that must outrank generic filename candidates. */
  readonly prioritizedSourcePath: string | undefined;
  /** Whether the current renderer can use authored page-entry globals. */
  readonly pageInspector: boolean;
  /** Snapshot-aware source overlay; missing values fall back to bounded filesystem reads. */
  readonly readSource: PreviewImplicitGlobalSourceReader;
  /** Alias/workspace-aware resolver shared with the eventual esbuild invocation. */
  readonly resolveModule: PreviewImplicitGlobalModuleResolver;
  /** Full preparation runtime/setup watch inputs. */
  readonly runtimeDependencyPaths: readonly string[];
  /** Cancels stale revisions between bounded source batches. */
  readonly signal?: AbortSignal;
  /** Snapshot map required to validate full cached evidence. */
  readonly snapshotSourceByPath: ReadonlyMap<string, string>;
}

/**
 * Recovers only corridor-proven bootstrap globals in fast mode and preserves full-mode behavior.
 */
export async function preparePreviewImplicitGlobalEvidence(
  options: PreparePreviewImplicitGlobalEvidenceOptions,
): Promise<PreviewImplicitGlobalEvidenceInventory> {
  const usesInspectorCorridor =
    options.pageInspector && options.inspectorDependencyPaths.length > 0;
  if (options.fast) {
    if (!usesInspectorCorridor) return EMPTY_IMPLICIT_GLOBAL_EVIDENCE;
    const selectedSources = await selectFastImplicitGlobalSources(options);
    if (selectedSources.sourcePaths.length === 0) {
      return selectedSources.truncated
        ? markImplicitGlobalEvidenceTruncated(EMPTY_IMPLICIT_GLOBAL_EVIDENCE)
        : EMPTY_IMPLICIT_GLOBAL_EVIDENCE;
    }
    const inventory = await collectPreviewImplicitGlobalEvidence({
      maximumCandidates: MAXIMUM_FAST_GLOBAL_CANDIDATES,
      maximumFileBytes: MAXIMUM_FAST_GLOBAL_FILE_BYTES,
      maximumFiles: MAXIMUM_FAST_GLOBAL_FILES,
      maximumTotalBytes: MAXIMUM_FAST_GLOBAL_TOTAL_BYTES,
      readSource: selectedSources.readSource,
      resolveModule: options.resolveModule,
      ...(options.signal === undefined ? {} : { signal: options.signal }),
      sourcePaths: selectedSources.sourcePaths,
    });
    return selectedSources.truncated && !inventory.truncated
      ? markImplicitGlobalEvidenceTruncated(inventory)
      : inventory;
  }

  return options.cache.discover({
    cacheKey: options.cacheKey,
    readSource: options.readSource,
    resolveModule: options.resolveModule,
    ...(options.signal === undefined ? {} : { signal: options.signal }),
    snapshotSourceByPath: options.snapshotSourceByPath,
    sourcePaths: usesInspectorCorridor
      ? [...options.inspectorDependencyPaths, ...options.runtimeDependencyPaths]
      : options.fallbackSourcePaths,
  });
}

/** Cached preflight result prevents the evidence collector from reading selected files twice. */
interface SelectedFastImplicitGlobalSources {
  /** Marker-bearing bootstrap/ambient files admitted under the fast source count and byte budgets. */
  readonly sourcePaths: readonly string[];
  /** Reader serving preflight text before falling back to the caller for an unexpected path. */
  readonly readSource: PreviewImplicitGlobalSourceReader;
  /** Whether a preflight count, byte, or source-read boundary omitted possible stronger evidence. */
  readonly truncated: boolean;
}

/** One bounded source read that distinguishes absence from incomplete strong-evidence inspection. */
interface FastImplicitGlobalSourceRead {
  /** Current source text when the overlay or bounded file read completed safely. */
  readonly sourceText?: string;
  /** True when size, I/O, or a changing file prevented a complete read. */
  readonly truncated: boolean;
}

/**
 * Reduces a potentially broad Inspector dependency inventory before invoking the fail-closed
 * evidence collector. Exact ReactDOM entry points are inspected first, then conventional bootstrap
 * files by shallow-path affinity. Only files containing a global-assignment or declaration marker
 * cross into the TypeScript parser.
 */
async function selectFastImplicitGlobalSources(
  options: PreparePreviewImplicitGlobalEvidenceOptions,
): Promise<SelectedFastImplicitGlobalSources> {
  throwIfPreviewBuildCancelled(options.signal);
  const prioritizedPaths = normalizeSourcePaths(
    options.prioritizedSourcePath === undefined ? [] : [options.prioritizedSourcePath],
  );
  const priorityByPath = new Map(
    prioritizedPaths.map((sourcePath, index) => [sourcePath, prioritizedPaths.length - index]),
  );
  const rankedCandidates = normalizeSourcePaths(options.inspectorDependencyPaths)
    .filter(
      (sourcePath) =>
        priorityByPath.has(sourcePath) ||
        BOOTSTRAP_FILE_STEM_PATTERN.test(readSourceFileStem(sourcePath)),
    )
    .sort((left, right) => {
      const scoreDifference =
        scoreBootstrapCandidate(right, priorityByPath) -
        scoreBootstrapCandidate(left, priorityByPath);
      return scoreDifference === 0 ? left.localeCompare(right) : scoreDifference;
    });
  const candidates = rankedCandidates.slice(0, MAXIMUM_FAST_GLOBAL_PREFLIGHT_FILES);
  const sourceTextByPath = new Map<string, string>();
  const selectedPaths: string[] = [];
  let consumedBytes = 0;
  let truncated = rankedCandidates.length > candidates.length;

  for (
    let batchStart = 0;
    batchStart < candidates.length;
    batchStart += MAXIMUM_CONCURRENT_FAST_GLOBAL_READS
  ) {
    throwIfPreviewBuildCancelled(options.signal);
    const batchPaths = candidates.slice(
      batchStart,
      batchStart + MAXIMUM_CONCURRENT_FAST_GLOBAL_READS,
    );
    const batchSources = await Promise.all(
      batchPaths.map((sourcePath) => readFastImplicitGlobalSource(sourcePath, options.readSource)),
    );
    throwIfPreviewBuildCancelled(options.signal);
    for (const [batchIndex, source] of batchSources.entries()) {
      const sourcePath = batchPaths[batchIndex];
      truncated ||= source.truncated;
      const sourceText = source.sourceText;
      if (sourcePath === undefined || sourceText === undefined) continue;
      const sourceBytes = Buffer.byteLength(sourceText, 'utf8');
      if (consumedBytes + sourceBytes > MAXIMUM_FAST_GLOBAL_TOTAL_BYTES) {
        return createSelectedFastSources(selectedPaths, sourceTextByPath, options.readSource, true);
      }
      consumedBytes += sourceBytes;
      if (!IMPLICIT_GLOBAL_MARKER_PATTERN.test(sourceText)) continue;
      sourceTextByPath.set(sourcePath, sourceText);
      selectedPaths.push(sourcePath);
    }
  }
  return createSelectedFastSources(selectedPaths, sourceTextByPath, options.readSource, truncated);
}

/** Reads one preflight source through the snapshot overlay and a size-checked disk fallback. */
async function readFastImplicitGlobalSource(
  sourcePath: string,
  reader: PreviewImplicitGlobalSourceReader,
): Promise<FastImplicitGlobalSourceRead> {
  let overlayText: string | undefined;
  try {
    overlayText = await reader(sourcePath);
    if (overlayText !== undefined) {
      return Buffer.byteLength(overlayText, 'utf8') <= MAXIMUM_FAST_GLOBAL_FILE_BYTES
        ? { sourceText: overlayText, truncated: false }
        : { truncated: true };
    }
  } catch {
    return { truncated: true };
  }
  let handle: Awaited<ReturnType<typeof open>> | undefined;
  try {
    handle = await open(sourcePath, 'r');
    const metadata = await handle.stat();
    if (!metadata.isFile() || metadata.size > MAXIMUM_FAST_GLOBAL_FILE_BYTES) {
      return { truncated: true };
    }
    const buffer = Buffer.alloc(
      Math.min(MAXIMUM_FAST_GLOBAL_FILE_BYTES + 1, Math.max(metadata.size + 1, 1)),
    );
    let totalBytesRead = 0;
    while (totalBytesRead < buffer.byteLength) {
      const { bytesRead } = await handle.read(
        buffer,
        totalBytesRead,
        buffer.byteLength - totalBytesRead,
        totalBytesRead,
      );
      if (bytesRead === 0) break;
      totalBytesRead += bytesRead;
    }
    if (totalBytesRead > MAXIMUM_FAST_GLOBAL_FILE_BYTES || totalBytesRead > metadata.size) {
      return { truncated: true };
    }
    return {
      sourceText: buffer.subarray(0, totalBytesRead).toString('utf8'),
      truncated: false,
    };
  } catch {
    return { truncated: true };
  } finally {
    await handle?.close().catch(() => undefined);
  }
}

/** Normalizes caller-owned JavaScript/TypeScript paths without touching the filesystem. */
function normalizeSourcePaths(sourcePaths: readonly string[]): readonly string[] {
  return [...new Set(sourcePaths.map((sourcePath) => path.normalize(sourcePath)))].filter(
    (sourcePath) => path.isAbsolute(sourcePath) && SOURCE_EXTENSION_PATTERN.test(sourcePath),
  );
}

/** Removes source suffixes while retaining `.d` so ambient declaration names remain distinctive. */
function readSourceFileStem(sourcePath: string): string {
  return path.basename(sourcePath).replace(/\.[cm]?[jt]sx?$/iu, '');
}

/** Orders proven entries first, then shallow production bootstrap names ahead of auxiliaries. */
function scoreBootstrapCandidate(
  sourcePath: string,
  priorityByPath: ReadonlyMap<string, number>,
): number {
  const explicitPriority = priorityByPath.get(sourcePath);
  if (explicitPriority !== undefined) return 1_000_000 + explicitPriority;
  const stem = readSourceFileStem(sourcePath).toLocaleLowerCase('en-US');
  const stemScore =
    stem === 'index'
      ? 9_000
      : stem === 'main'
        ? 8_800
        : stem === 'bootstrap'
          ? 8_600
          : stem === 'entry'
            ? 8_400
            : stem === 'polyfill' || stem === 'polyfills'
              ? 8_200
              : stem === 'app'
                ? 8_000
                : stem === 'global' || stem === 'globals' || stem === 'global.d'
                  ? 7_800
                  : 7_000;
  const depthPenalty = sourcePath.split(/[\\/]/u).length * 12;
  const auxiliaryPenalty = AUXILIARY_PATH_PATTERN.test(sourcePath) ? 5_000 : 0;
  return stemScore - depthPenalty - auxiliaryPenalty;
}

/** Builds one cache-first reader whose fallback remains useful to direct collector callers. */
function createSelectedFastSources(
  sourcePaths: readonly string[],
  sourceTextByPath: ReadonlyMap<string, string>,
  fallbackReader: PreviewImplicitGlobalSourceReader,
  truncated: boolean,
): SelectedFastImplicitGlobalSources {
  return {
    readSource: (sourcePath) =>
      sourceTextByPath.get(path.normalize(sourcePath)) ?? fallbackReader(sourcePath),
    sourcePaths: Object.freeze([...sourcePaths]),
    truncated,
  };
}

/** Retains exact selected hints while preventing an incomplete fast scan from claiming coverage. */
function markImplicitGlobalEvidenceTruncated(
  inventory: PreviewImplicitGlobalEvidenceInventory,
): PreviewImplicitGlobalEvidenceInventory {
  return Object.freeze({ ...inventory, truncated: true });
}
