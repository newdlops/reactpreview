/**
 * Compiles project-owned MDX through a bounded, extension-controlled fallback pipeline.
 * Workspace configuration and plugins are never imported: standard MDX syntax, safe YAML
 * frontmatter, deterministic metadata, and React's classic component API are the entire contract.
 * Eager `?collection=name` imports become metadata-first modules so catalogs cannot compile hundreds
 * of unrelated document bodies and dependency trees while preparing one component preview.
 */
import { readFile, stat } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import path from 'node:path';
import { compile } from '@mdx-js/mdx';
import type { OnLoadArgs, OnLoadResult, Plugin } from 'esbuild';
import { canonicalizeExistingPath } from '../../shared/pathIdentity';
import { createPreviewBoundedWorkGate } from './previewBoundedWorkGate';
import {
  completePreviewMdxModuleSource,
  createEmptyPreviewMdxMetadata,
  createPreviewMdxClassicReactModuleSource,
  createPreviewMdxCollectionMetadataModuleSource,
  createPreviewMdxFrontmatterOnlyModuleSource,
  createPreviewMdxMetadataCollector,
  createPreviewMdxPlaceholderModuleSource,
  extractPreviewMdxDocument,
  type PreviewMdxDocument,
  type PreviewMdxFrontmatter,
  type PreviewMdxMetadata,
} from './previewMdxFallbackMetadata';

const PREVIEW_MDX_FILE_FILTER = /\.mdx$/i;
const MAX_PREVIEW_MDX_SOURCE_BYTES = 2 * 1024 * 1024;
const MAX_PREVIEW_MDX_AGGREGATE_SOURCE_BYTES = 32 * 1024 * 1024;
const MAX_PREVIEW_MDX_OUTPUT_BYTES = 8 * 1024 * 1024;
const MAX_PREVIEW_MDX_AGGREGATE_OUTPUT_BYTES = 96 * 1024 * 1024;
const MAX_PREVIEW_MDX_MODULES = 1_024;
const MAX_PREVIEW_MDX_CONCURRENCY = 4;
const MAX_PREVIEW_MDX_DIAGNOSTIC_LENGTH = 1_024;
const MAX_PREVIEW_MDX_CACHE_ENTRIES = 512;
const MAX_PREVIEW_MDX_CACHE_BYTES = 64 * 1024 * 1024;

/** Trusted filesystem boundary applied to every MDX module after symlink resolution. */
export interface PreviewMdxFallbackPluginOptions {
  /** Canonical VS Code workspace whose authored MDX files may be read and compiled. */
  readonly workspaceRoot: string;
}

/** Rebuild-local source and output accounting shared by concurrent esbuild load callbacks. */
interface PreviewMdxBuildBudget {
  /** Whether this rebuild already explained the bounded eager-collection shortcut. */
  collectionMetadataWarningEmitted: boolean;
  /** Number of distinct query-bearing MDX module loads admitted during this rebuild. */
  modules: number;
  /** Total compiled or placeholder JavaScript bytes emitted during this rebuild. */
  outputBytes: number;
  /** Total authored MDX bytes admitted during this rebuild. */
  sourceBytes: number;
}

/** Body policy selected only from the inert query suffix attached by the importing catalog. */
type PreviewMdxQueryMode = 'collection-metadata' | 'frontmatter-only' | 'full';

/** Result of admitting one source file under per-file and aggregate policy limits. */
interface PreviewMdxSourceAdmission {
  /** Human-readable fallback reason when the source body must not be read. */
  readonly fallbackReason?: string;
  /** Whether the module count and byte budget admitted the source for compilation. */
  readonly admitted: boolean;
}

/** One successful compiled or metadata-only module retained across hot rebuilds. */
interface PreviewMdxCompiledCacheEntry {
  /** Complete JavaScript module returned to esbuild on a cache hit. */
  readonly contents: string;
  /** Sanitized frontmatter retained for an output-budget placeholder. */
  readonly frontmatter: PreviewMdxFrontmatter;
  /** TOC/search metadata retained for an output-budget placeholder. */
  readonly metadata: PreviewMdxMetadata;
  /** UTF-8 JavaScript size used for both LRU accounting and build output policy. */
  readonly outputBytes: number;
  /** Non-fatal YAML diagnostics reproduced consistently on cache hits. */
  readonly warnings: readonly string[];
}

/** Bounded insertion-ordered cache scoped to one persistent compiler plugin instance. */
interface PreviewMdxCompiledModuleCache {
  /** Current total JavaScript bytes retained by cache entries. */
  totalBytes: number;
  /** Content-and-suffix keys in least-recently-used to most-recently-used order. */
  readonly entries: Map<string, PreviewMdxCompiledCacheEntry>;
}

/**
 * Creates an esbuild plugin for `.mdx` and query-suffixed `.mdx` modules in the trusted workspace.
 * Esbuild keeps the query in `OnLoadArgs.suffix`, so the ordinary file resolver remains authoritative
 * for aliases, Yarn PnP, and relative imports while this plugin owns only final source compilation.
 *
 * @param options Trusted workspace boundary; no project configuration path is accepted by design.
 * @returns Query-aware MDX loader with bounded concurrency and fail-soft document placeholders.
 */
export function createPreviewMdxFallbackPlugin(options: PreviewMdxFallbackPluginOptions): Plugin {
  const canonicalWorkspaceRoot = canonicalizeExistingPath(options.workspaceRoot);
  const budget = createPreviewMdxBuildBudget();
  const moduleLoadGate = createPreviewBoundedWorkGate(MAX_PREVIEW_MDX_CONCURRENCY);
  const moduleCache = createPreviewMdxCompiledModuleCache();

  return {
    name: 'react-preview-mdx-fallback',
    setup(build): void {
      /** Resets aggregate limits before an initial build or persistent-context rebuild starts. */
      build.onStart(() => {
        resetPreviewMdxBuildBudget(budget);
      });

      /**
       * Loads only file-namespace MDX that remains inside the canonical workspace after symlinks.
       * Compilation failures become warnings plus renderable placeholders so one documentation leaf
       * cannot prevent an unrelated page shell, header, or inspected component from appearing.
       */
      build.onLoad(
        { filter: PREVIEW_MDX_FILE_FILTER, namespace: 'file' },
        async (arguments_: OnLoadArgs): Promise<OnLoadResult> =>
          await moduleLoadGate.run(
            async () =>
              await loadPreviewMdxModule(arguments_, canonicalWorkspaceRoot, budget, moduleCache),
          ),
      );
    },
  };
}

/**
 * Reads, compiles, and completes one MDX module or returns a bounded static replacement.
 *
 * @param arguments_ Esbuild identity containing a query-free path and preserved suffix.
 * @param workspaceRoot Canonical workspace boundary used after symlink resolution.
 * @param budget Mutable rebuild-local resource accounting.
 * @param moduleCache Bounded content cache retained by a persistent esbuild plugin instance.
 * @returns JavaScript or JSX load result with dependency watching and non-fatal diagnostics.
 */
async function loadPreviewMdxModule(
  arguments_: OnLoadArgs,
  workspaceRoot: string,
  budget: PreviewMdxBuildBudget,
  moduleCache: PreviewMdxCompiledModuleCache,
): Promise<OnLoadResult> {
  const canonicalSourcePath = canonicalizeExistingPath(arguments_.path);
  if (!isPathInside(workspaceRoot, canonicalSourcePath)) {
    return {
      errors: [
        {
          text: `React Preview refused to compile MDX outside the trusted workspace: ${arguments_.path}`,
        },
      ],
    };
  }

  let sourceSize: number;
  try {
    const fileStat = await stat(canonicalSourcePath);
    if (!fileStat.isFile()) {
      return { errors: [{ text: `React Preview MDX source is not a file: ${arguments_.path}` }] };
    }
    sourceSize = fileStat.size;
  } catch (error) {
    return {
      errors: [
        {
          detail: error,
          text: `React Preview could not inspect MDX source: ${arguments_.path}`,
        },
      ],
    };
  }

  const admission = admitPreviewMdxSource(sourceSize, budget);
  const displayName = formatPreviewMdxWorkspacePath(canonicalSourcePath, workspaceRoot);
  if (!admission.admitted) {
    return createPreviewMdxPlaceholderLoadResult({
      budget,
      displayName,
      reason: admission.fallbackReason ?? 'MDX source was outside the bounded preview policy.',
      sourcePath: canonicalSourcePath,
    });
  }

  let sourceText: string;
  try {
    sourceText = await readFile(canonicalSourcePath, 'utf8');
  } catch (error) {
    return {
      errors: [
        {
          detail: error,
          text: `React Preview could not read MDX source: ${arguments_.path}`,
        },
      ],
    };
  }
  const readAdmission = reconcilePreviewMdxSourceBytesAfterRead(
    sourceSize,
    Buffer.byteLength(sourceText, 'utf8'),
    budget,
  );
  if (!readAdmission.admitted) {
    return createPreviewMdxPlaceholderLoadResult({
      budget,
      displayName,
      reason:
        readAdmission.fallbackReason ??
        'MDX source changed outside the bounded preview policy while it was read.',
      sourcePath: canonicalSourcePath,
    });
  }

  const queryMode = readPreviewMdxQueryMode(arguments_.suffix);
  const cacheKey = createPreviewMdxCacheKey(sourceText, arguments_.suffix);
  const cachedModule = readPreviewMdxCompiledModuleCache(moduleCache, cacheKey);
  if (cachedModule !== undefined) {
    const cachedResult = createPreviewMdxCompiledLoadResult({
      budget,
      cacheEntry: cachedModule,
      displayName,
      sourcePath: canonicalSourcePath,
    });
    return queryMode === 'collection-metadata'
      ? appendPreviewMdxCollectionMetadataWarning(cachedResult, budget)
      : cachedResult;
  }

  const document = extractPreviewMdxDocument(sourceText);
  if (queryMode !== 'full') {
    const metadata = createEmptyPreviewMdxMetadata();
    const cacheEntry = createPreviewMdxCompiledCacheEntry(
      queryMode === 'frontmatter-only'
        ? createPreviewMdxFrontmatterOnlyModuleSource(document.frontmatter)
        : createPreviewMdxCollectionMetadataModuleSource(document.frontmatter, displayName),
      document,
      metadata,
    );
    rememberPreviewMdxCompiledModule(moduleCache, cacheKey, cacheEntry);
    const metadataResult = createPreviewMdxCompiledLoadResult({
      budget,
      cacheEntry,
      displayName,
      sourcePath: canonicalSourcePath,
    });
    return queryMode === 'collection-metadata'
      ? appendPreviewMdxCollectionMetadataWarning(metadataResult, budget)
      : metadataResult;
  }

  const collector = createPreviewMdxMetadataCollector();
  try {
    const compiled = await compile(
      { path: canonicalSourcePath, value: document.bodyText },
      {
        development: false,
        format: 'mdx',
        jsx: true,
        outputFormat: 'program',
        remarkPlugins: [collector.remarkPlugin],
      },
    );
    const metadata = collector.readMetadata();
    const contents = completePreviewMdxModuleSource(
      createPreviewMdxClassicReactModuleSource(String(compiled.value)),
      document.frontmatter,
      metadata,
    );
    const cacheEntry = createPreviewMdxCompiledCacheEntry(contents, document, metadata);
    rememberPreviewMdxCompiledModule(moduleCache, cacheKey, cacheEntry);
    return createPreviewMdxCompiledLoadResult({
      budget,
      cacheEntry,
      displayName,
      sourcePath: canonicalSourcePath,
    });
  } catch (error) {
    return createPreviewMdxPlaceholderLoadResult({
      budget,
      displayName,
      document,
      metadata: collector.readMetadata(),
      reason: `Standard MDX compilation failed: ${describePreviewMdxFailure(error)}`,
      sourcePath: canonicalSourcePath,
    });
  }
}

/** Inputs used to admit one cached or newly compiled MDX module into the current build output. */
interface PreviewMdxCompiledLoadOptions {
  /** Rebuild-local output budget charged even when compilation was cached. */
  readonly budget: PreviewMdxBuildBudget;
  /** Immutable completed module and retained metadata. */
  readonly cacheEntry: PreviewMdxCompiledCacheEntry;
  /** Workspace-relative label used if output policy requires a placeholder. */
  readonly displayName: string;
  /** Canonical source dependency used for resolution and hot reload. */
  readonly sourcePath: string;
}

/**
 * Converts one completed cache entry to an esbuild result under the current rebuild output budget.
 *
 * @param options Cached module, current budget, and canonical source identity.
 * @returns Executable module or a metadata-preserving output-budget placeholder.
 */
function createPreviewMdxCompiledLoadResult(options: PreviewMdxCompiledLoadOptions): OnLoadResult {
  const outputPolicyReason = reservePreviewMdxOutput(
    options.cacheEntry.outputBytes,
    options.budget,
  );
  if (outputPolicyReason !== undefined) {
    return createPreviewMdxPlaceholderLoadResult({
      budget: options.budget,
      displayName: options.displayName,
      document: {
        bodyText: '',
        frontmatter: options.cacheEntry.frontmatter,
        warnings: options.cacheEntry.warnings,
      },
      metadata: options.cacheEntry.metadata,
      reason: outputPolicyReason,
      sourcePath: options.sourcePath,
    });
  }
  return {
    contents: options.cacheEntry.contents,
    loader: 'jsx',
    resolveDir: path.dirname(options.sourcePath),
    warnings: options.cacheEntry.warnings.map((warning) => ({ text: warning })),
    watchFiles: [options.sourcePath],
  };
}

/** Inputs used to create one renderable policy or compilation fallback load result. */
interface PreviewMdxPlaceholderLoadOptions {
  /** Rebuild output budget that also accounts for generated placeholders. */
  readonly budget: PreviewMdxBuildBudget;
  /** Workspace-relative source label rendered by the placeholder. */
  readonly displayName: string;
  /** Parsed document retained when reading was allowed. */
  readonly document?: PreviewMdxDocument;
  /** Syntax metadata retained when compilation progressed far enough to collect it. */
  readonly metadata?: PreviewMdxMetadata;
  /** Policy or syntax explanation surfaced as an esbuild warning and visible status text. */
  readonly reason: string;
  /** Canonical file dependency used for hot reload. */
  readonly sourcePath: string;
}

/**
 * Produces a standard esbuild load result for a static MDX placeholder.
 *
 * @param options Safe source identity, retained metadata, and fallback explanation.
 * @returns Classic-React module that keeps the page graph live and watches the original MDX file.
 */
function createPreviewMdxPlaceholderLoadResult(
  options: PreviewMdxPlaceholderLoadOptions,
): OnLoadResult {
  const document = options.document ?? {
    bodyText: '',
    frontmatter: Object.freeze({}),
    warnings: Object.freeze([]),
  };
  const metadata = options.metadata ?? createEmptyPreviewMdxMetadata();
  const reason = boundPreviewMdxDiagnostic(options.reason);
  const contents = createPreviewMdxPlaceholderModuleSource(
    options.displayName,
    reason,
    document.frontmatter,
    metadata,
  );
  options.budget.outputBytes += Buffer.byteLength(contents, 'utf8');
  return {
    contents,
    loader: 'js',
    resolveDir: path.dirname(options.sourcePath),
    warnings: [
      ...document.warnings.map((warning) => ({ text: warning })),
      { text: `React Preview used a static MDX fallback for ${options.displayName}: ${reason}` },
    ],
    watchFiles: [options.sourcePath],
  };
}

/** Creates zeroed accounting for one esbuild plugin instance. */
function createPreviewMdxBuildBudget(): PreviewMdxBuildBudget {
  return {
    collectionMetadataWarningEmitted: false,
    modules: 0,
    outputBytes: 0,
    sourceBytes: 0,
  };
}

/** Resets persistent-context accounting without replacing the object captured by callbacks. */
function resetPreviewMdxBuildBudget(budget: PreviewMdxBuildBudget): void {
  budget.collectionMetadataWarningEmitted = false;
  budget.modules = 0;
  budget.outputBytes = 0;
  budget.sourceBytes = 0;
}

/** Creates an empty LRU cache that intentionally survives `onStart` rebuild boundaries. */
function createPreviewMdxCompiledModuleCache(): PreviewMdxCompiledModuleCache {
  return { entries: new Map<string, PreviewMdxCompiledCacheEntry>(), totalBytes: 0 };
}

/** Creates an immutable cache value without retaining the potentially large MDX body text. */
function createPreviewMdxCompiledCacheEntry(
  contents: string,
  document: PreviewMdxDocument,
  metadata: PreviewMdxMetadata,
): PreviewMdxCompiledCacheEntry {
  return Object.freeze({
    contents,
    frontmatter: document.frontmatter,
    metadata,
    outputBytes: Buffer.byteLength(contents, 'utf8'),
    warnings: Object.freeze([...document.warnings]),
  });
}

/** Hashes exact source content and the full query/fragment suffix into one stable cache identity. */
function createPreviewMdxCacheKey(sourceText: string, suffix: string): string {
  return createHash('sha256').update(suffix).update('\0').update(sourceText).digest('hex');
}

/** Selects explicit metadata-only and bounded eager-collection requests from one inert suffix. */
function readPreviewMdxQueryMode(suffix: string): PreviewMdxQueryMode {
  const queryStart = suffix.indexOf('?');
  if (queryStart < 0) return 'full';
  const fragmentStart = suffix.indexOf('#', queryStart + 1);
  const queryText = suffix.slice(queryStart + 1, fragmentStart < 0 ? undefined : fragmentStart);
  const parameters = new URLSearchParams(queryText);
  if (parameters.get('only') === 'frontmatter') return 'frontmatter-only';
  if (!parameters.has('only') && (parameters.get('collection')?.trim().length ?? 0) > 0) {
    return 'collection-metadata';
  }
  return 'full';
}

/** Adds one rebuild-wide explanation without flooding eager catalogs with per-document warnings. */
function appendPreviewMdxCollectionMetadataWarning(
  result: OnLoadResult,
  budget: PreviewMdxBuildBudget,
): OnLoadResult {
  if (budget.collectionMetadataWarningEmitted) return result;
  budget.collectionMetadataWarningEmitted = true;
  return {
    ...result,
    warnings: [
      ...(result.warnings ?? []),
      {
        text: 'React Preview loaded eager MDX collection imports in metadata-first mode; document bodies and their project imports were skipped to keep the local catalog bounded.',
      },
    ],
  };
}

/** Reads and promotes one entry to the most-recently-used end of the insertion-ordered map. */
function readPreviewMdxCompiledModuleCache(
  cache: PreviewMdxCompiledModuleCache,
  key: string,
): PreviewMdxCompiledCacheEntry | undefined {
  const entry = cache.entries.get(key);
  if (entry === undefined) return undefined;
  cache.entries.delete(key);
  cache.entries.set(key, entry);
  return entry;
}

/** Inserts one compiled module and evicts least-recent entries under count and byte caps. */
function rememberPreviewMdxCompiledModule(
  cache: PreviewMdxCompiledModuleCache,
  key: string,
  entry: PreviewMdxCompiledCacheEntry,
): void {
  if (entry.outputBytes > MAX_PREVIEW_MDX_CACHE_BYTES) return;
  const existing = cache.entries.get(key);
  if (existing !== undefined) {
    cache.totalBytes -= existing.outputBytes;
    cache.entries.delete(key);
  }
  cache.entries.set(key, entry);
  cache.totalBytes += entry.outputBytes;
  while (
    cache.entries.size > MAX_PREVIEW_MDX_CACHE_ENTRIES ||
    cache.totalBytes > MAX_PREVIEW_MDX_CACHE_BYTES
  ) {
    const oldestKey = cache.entries.keys().next().value;
    if (oldestKey === undefined) break;
    const oldest = cache.entries.get(oldestKey);
    cache.entries.delete(oldestKey);
    cache.totalBytes = Math.max(0, cache.totalBytes - (oldest?.outputBytes ?? 0));
  }
}

/** Reserves module and source bytes atomically between asynchronous filesystem operations. */
function admitPreviewMdxSource(
  sourceBytes: number,
  budget: PreviewMdxBuildBudget,
): PreviewMdxSourceAdmission {
  budget.modules += 1;
  if (budget.modules > MAX_PREVIEW_MDX_MODULES) {
    return {
      admitted: false,
      fallbackReason: `The preview reached its ${MAX_PREVIEW_MDX_MODULES.toString()}-module MDX limit.`,
    };
  }
  if (sourceBytes > MAX_PREVIEW_MDX_SOURCE_BYTES) {
    return {
      admitted: false,
      fallbackReason: 'The MDX document exceeded the 2 MiB per-file preview limit.',
    };
  }
  if (budget.sourceBytes + sourceBytes > MAX_PREVIEW_MDX_AGGREGATE_SOURCE_BYTES) {
    return {
      admitted: false,
      fallbackReason: 'The preview reached its 32 MiB aggregate MDX source limit.',
    };
  }
  budget.sourceBytes += sourceBytes;
  return { admitted: true };
}

/**
 * Replaces the optimistic stat reservation with the bytes actually returned by `readFile`.
 * Editors can save through atomic rename while a build is running, so file metadata and content are
 * not one transaction. Rechecking both limits prevents a growing file from bypassing aggregate
 * accounting; a rejected read releases its former reservation just like an initially oversized file.
 */
function reconcilePreviewMdxSourceBytesAfterRead(
  reservedBytes: number,
  actualBytes: number,
  budget: PreviewMdxBuildBudget,
): PreviewMdxSourceAdmission {
  budget.sourceBytes = Math.max(0, budget.sourceBytes - reservedBytes);
  if (actualBytes > MAX_PREVIEW_MDX_SOURCE_BYTES) {
    return {
      admitted: false,
      fallbackReason:
        'The MDX document exceeded the 2 MiB per-file preview limit while being read.',
    };
  }
  if (budget.sourceBytes + actualBytes > MAX_PREVIEW_MDX_AGGREGATE_SOURCE_BYTES) {
    return {
      admitted: false,
      fallbackReason: 'The preview reached its 32 MiB aggregate MDX source limit while reading.',
    };
  }
  budget.sourceBytes += actualBytes;
  return { admitted: true };
}

/** Reserves generated JavaScript bytes and reports when a static placeholder is required instead. */
function reservePreviewMdxOutput(
  outputBytes: number,
  budget: PreviewMdxBuildBudget,
): string | undefined {
  if (outputBytes > MAX_PREVIEW_MDX_OUTPUT_BYTES) {
    return 'Compiled MDX exceeded the 8 MiB per-module output limit.';
  }
  if (budget.outputBytes + outputBytes > MAX_PREVIEW_MDX_AGGREGATE_OUTPUT_BYTES) {
    return 'The preview reached its 96 MiB aggregate MDX output limit.';
  }
  budget.outputBytes += outputBytes;
  return undefined;
}

/** Formats a source path without exposing filesystem content beyond its trusted workspace label. */
function formatPreviewMdxWorkspacePath(sourcePath: string, workspaceRoot: string): string {
  const relativePath = path.relative(workspaceRoot, sourcePath);
  return relativePath.length === 0 ? path.basename(sourcePath) : relativePath.replaceAll('\\', '/');
}

/** Checks canonical containment without accepting sibling paths that share a lexical prefix. */
function isPathInside(rootPath: string, candidatePath: string): boolean {
  const relativePath = path.relative(path.resolve(rootPath), path.resolve(candidatePath));
  return (
    relativePath.length === 0 ||
    (relativePath !== '..' &&
      !relativePath.startsWith(`..${path.sep}`) &&
      !path.isAbsolute(relativePath))
  );
}

/** Converts unknown compiler failures to one bounded, single-line warning. */
function describePreviewMdxFailure(error: unknown): string {
  return boundPreviewMdxDiagnostic(error instanceof Error ? error.message : String(error));
}

/** Removes control whitespace and truncates diagnostics retained in generated JavaScript. */
function boundPreviewMdxDiagnostic(value: string): string {
  const normalized = value.replace(/[\r\n\t]+/gu, ' ').trim();
  return normalized.length <= MAX_PREVIEW_MDX_DIAGNOSTIC_LENGTH
    ? normalized
    : `${normalized.slice(0, MAX_PREVIEW_MDX_DIAGNOSTIC_LENGTH - 1)}…`;
}
