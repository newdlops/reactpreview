/**
 * Discovers static props and pinpoint wrapper branches from real JSX target usages.
 * Parent-authored literals become low-priority automatic props, while a syntax-only ancestor path
 * restores structural components and styles without executing the complete parent or its siblings.
 */
import { open, readdir } from 'node:fs/promises';
import path from 'node:path';
import type { PreviewSourceSnapshot } from '../../domain/preview';
import { throwIfPreviewBuildCancelled } from '../../domain/previewBuildExecution';
import { createPreviewInspectorAncestorPlan, type PreviewInspectorAncestorPlan } from './inspector';
import {
  analyzePreviewParentSlices,
  climbPreviewParentSliceProject,
  createPreviewParentSlicePlan,
  type PreviewParentSlicePlan,
  type PreviewParentSlicePlansByExport,
} from './parentSlice';
import { createPreviewStaticModuleResolver } from './previewStaticModuleResolver';
import type { PreviewTargetExportSlot } from './previewTargetExports';
import { createPreviewRenderChainPlans, type PreviewRenderChainPlansByExport } from './renderGraph';
import {
  PreviewProjectFileAnalysisCache,
  type PreviewProjectSourceRecord,
} from './previewProjectFileAnalysisCache';

const MAX_SCANNED_SOURCE_FILES = 16_384;
const MAX_CONCURRENT_SOURCE_READS = 64;
const MAX_INDIVIDUAL_SOURCE_BYTES = 4 * 1024 * 1024;
const MAX_TOTAL_SOURCE_BYTES = 128 * 1024 * 1024;
const SOURCE_EXTENSION_PATTERN = /\.(?:[cm]?[jt]sx?)$/iu;
const IGNORED_DIRECTORY_NAMES = new Set([
  '.git',
  '.next',
  '.react-preview',
  '.tmp',
  '.turbo',
  '__generated__',
  'build',
  'coverage',
  'dist',
  'generated',
  'graphql-codegen',
  'node_modules',
  'out',
  'public',
]);

/** JSON-safe literal accepted from an inert JSX attribute initializer. */
export type PreviewStaticPropValue = boolean | number | string | null;

/** Static props associated with the exact runtime export name used by the target bridge. */
export type PreviewStaticPropsByExport = Readonly<
  Record<string, Readonly<Record<string, PreviewStaticPropValue>>>
>;

/** Result of bounded reverse-usage discovery and files that should trigger a later rebuild. */
export interface PreviewTargetUsageProps {
  /** Consumer source paths whose selected props or wrapper branch must trigger hot reload. */
  readonly dependencyPaths: readonly string[];
  /** Actual exported owner selected only for Page Inspector composition. */
  readonly inspectorPlan?: PreviewInspectorAncestorPlan;
  /** Config-aware aliases proven to resolve to the original Inspector target during discovery. */
  readonly inspectorTargetImportSpecifiers?: readonly string[];
  /** Static entry-to-target structure for every explicit export, populated in Inspector mode. */
  readonly renderChainsByExport?: PreviewRenderChainPlansByExport;
  /** Pinpoint wrapper recipes selected from real JSX branches for each explicit target export. */
  readonly parentSlicesByExport: PreviewParentSlicePlansByExport;
  /** First deterministic literal-prop example for each explicit target export. */
  readonly propsByExport: PreviewStaticPropsByExport;
}

/** Inputs required to search one trusted project without consulting framework configuration. */
export interface PreviewTargetUsagePropsOptions {
  /** Optional compiler-lifetime file cache; direct callers remain stateless when omitted. */
  readonly analysisCache?: PreviewProjectFileAnalysisCache;
  /** Whether exported owners may be followed across package source files; defaults to `true`. */
  readonly climbParentSlices?: boolean;
  /** Selected source module whose direct exports are being previewed. */
  readonly documentPath: string;
  /** Explicit component exports already admitted by the target export selector. */
  readonly exports: readonly PreviewTargetExportSlot[];
  /** Exact explicit export used to find one real page root; omitted outside Inspector mode. */
  readonly inspectorExportName?: string;
  /** Nearest package root bounding reverse usage discovery inside a larger workspace. */
  readonly projectRoot: string;
  /** Cancels stale package scans at directory, source-batch, and graph-traversal boundaries. */
  readonly signal?: AbortSignal;
  /** Current target editor text used by Inspector render-graph identity and cache invalidation. */
  readonly sourceText?: string;
  /** Unsaved editor documents that take precedence over their filesystem contents. */
  readonly snapshots: readonly PreviewSourceSnapshot[];
  /** Optional configured tsconfig/jsconfig; nearest trusted configs are discovered when omitted. */
  readonly tsconfigPath?: string;
  /** Optional cached package inventory; omitting it performs one bounded directory enumeration. */
  readonly sourcePaths?: readonly string[];
  /** Trusted workspace root that must contain both the package root and selected target. */
  readonly workspaceRoot: string;
}

/** Explicit roots used to build one reusable package source inventory. */
export interface PreviewTargetUsageSourceInventoryOptions {
  /** Nearest package root whose authored source files should be enumerated. */
  readonly projectRoot: string;
  /** Cancels a stale monorepo directory enumeration before another directory is entered. */
  readonly signal?: AbortSignal;
  /** Trusted workspace root that must contain the selected package root. */
  readonly workspaceRoot: string;
}

/** One source file and its current editor-or-disk text. */
type UsageSource = PreviewProjectSourceRecord;

/** Validated lexical roots used to prevent a package search from escaping its workspace. */
interface UsageSearchBoundary {
  readonly documentPath: string;
  readonly packageRoot: string;
  readonly workspaceRoot: string;
}

/**
 * Finds pure literal props and reproducible ancestor branches for imported target components.
 *
 * The search is deterministic, bounded, excludes generated and dependency directories, and never
 * follows calls or evaluates expressions. A dynamic imported wrapper becomes a hard upward barrier;
 * already proven inner frames remain usable. A file contributes only when its import resolves
 * lexically to the target or has a complete workspace-alias suffix matching the target path.
 */
export async function discoverPreviewTargetUsageProps(
  options: PreviewTargetUsagePropsOptions,
): Promise<PreviewTargetUsageProps> {
  throwIfPreviewBuildCancelled(options.signal);
  const explicitExportNames = options.exports.flatMap((slot) =>
    slot.kind === 'explicit' ? [slot.exportName] : [],
  );
  if (explicitExportNames.length === 0) {
    return { dependencyPaths: [], parentSlicesByExport: {}, propsByExport: {} };
  }

  const boundary = createUsageSearchBoundary(options);
  const moduleResolver = createPreviewStaticModuleResolver({
    ...(options.tsconfigPath === undefined ? {} : { configuredTsconfigPath: options.tsconfigPath }),
    workspaceRoot: boundary.workspaceRoot,
  });
  const inventoryPaths =
    options.sourcePaths ??
    (await collectPreviewTargetUsageSourcePaths({
      projectRoot: boundary.packageRoot,
      ...(options.signal === undefined ? {} : { signal: options.signal }),
      workspaceRoot: boundary.workspaceRoot,
    }));
  const sourcePaths = selectUsageSourcePaths(inventoryPaths, options.snapshots, boundary);
  const snapshotByPath = new Map(
    [
      ...options.snapshots,
      ...(options.sourceText === undefined
        ? []
        : [
            {
              documentPath: boundary.documentPath,
              language: readUsageSourceLanguage(boundary.documentPath),
              sourceText: options.sourceText,
            } satisfies PreviewSourceSnapshot,
          ]),
    ]
      .filter((snapshot) => isPathInside(boundary.packageRoot, snapshot.documentPath))
      .map((snapshot) => [path.normalize(snapshot.documentPath), snapshot] as const),
  );
  const propsByExport = new Map<string, Readonly<Record<string, PreviewStaticPropValue>>>();
  const propDependencyByExport = new Map<string, string>();
  const parentSliceByExport = new Map<string, PreviewParentSlicePlan>();
  const expectedExportNames = new Set(explicitExportNames);
  const usageSourceByPath = new Map<string, UsageSource>();
  const unavailableUsageSourcePaths = new Set<string>();
  let consumedBytes = 0;
  const shouldDiscoverInspector =
    options.inspectorExportName !== undefined &&
    explicitExportNames.includes(options.inspectorExportName);
  const analysisCache = options.analysisCache;

  /*
   * Entry discovery is the primary Inspector operation. Running it before literal-prop and parent
   * slice scans prevents those optional passes from consuming the shared source-byte budget first.
   * The target is seeded explicitly so a large alphabetical inventory cannot omit dirty editor text.
   */
  if (shouldDiscoverInspector) {
    await readCachedUsageSource(boundary.documentPath);
  }
  const renderChainsByExport = shouldDiscoverInspector
    ? await createPreviewRenderChainPlans({
        ...(analysisCache === undefined
          ? {}
          : {
              analyzeSource: (sourcePath: string, sourceText: string) =>
                analysisCache.analyzeRenderSource(sourcePath, sourceText),
              collectModuleSpecifiers: (sourcePath: string, sourceText: string) =>
                analysisCache.collectModuleSpecifiers(sourcePath, sourceText),
            }),
        documentPath: boundary.documentPath,
        exportNames: explicitExportNames,
        primaryExportName: options.inspectorExportName,
        readSource: readCachedUsageSource,
        resolveModule: moduleResolver.resolve,
        ...(options.signal === undefined ? {} : { signal: options.signal }),
        sourcePaths: [...sourcePaths, boundary.documentPath],
      })
    : undefined;
  const requiredUsageExportNames = new Set(
    shouldDiscoverInspector ? [options.inspectorExportName] : explicitExportNames,
  );
  const usageScanSourcePaths = [
    ...new Set([
      ...(options.inspectorExportName === undefined
        ? []
        : (renderChainsByExport?.[options.inspectorExportName]?.paths.flatMap((candidate) =>
            candidate.steps.map((step) => step.sourcePath),
          ) ?? [])),
      ...sourcePaths,
    ]),
  ].filter((sourcePath) => path.normalize(sourcePath) !== boundary.documentPath);

  scanBatches: for (
    let batchStart = 0;
    batchStart < usageScanSourcePaths.length;
    batchStart += MAX_CONCURRENT_SOURCE_READS
  ) {
    throwIfPreviewBuildCancelled(options.signal);
    const sourceBatch = await Promise.all(
      usageScanSourcePaths
        .slice(batchStart, batchStart + MAX_CONCURRENT_SOURCE_READS)
        .map(readCachedUsageSourceRecord),
    );
    throwIfPreviewBuildCancelled(options.signal);
    for (const usageSource of sourceBatch) {
      if (usageSource === undefined) {
        continue;
      }
      if (!mayContainUsage(usageSource.sourceText, boundary.documentPath)) {
        continue;
      }

      const analysis = analyzePreviewParentSlices({
        consumerPath: usageSource.filePath,
        matchesTargetImport: moduleResolver.matchesTarget,
        sourceText: usageSource.sourceText,
        targetExportNames: explicitExportNames,
        targetPath: boundary.documentPath,
      });
      for (const slice of analysis.slices) {
        if (!expectedExportNames.has(slice.targetExportName)) {
          continue;
        }
        if (
          !propsByExport.has(slice.targetExportName) &&
          Object.keys(slice.targetProps).length > 0
        ) {
          propsByExport.set(slice.targetExportName, slice.targetProps);
          propDependencyByExport.set(slice.targetExportName, usageSource.filePath);
        }

        const candidatePlan = createPreviewParentSlicePlan({
          directSlice: slice,
          sourceText: usageSource.sourceText,
        });
        const selectedPlan = parentSliceByExport.get(slice.targetExportName);
        if (
          selectedPlan === undefined ||
          (selectedPlan.frames.length === 0 &&
            (candidatePlan.frames.length > 0 || Object.keys(slice.targetProps).length > 0))
        ) {
          parentSliceByExport.set(slice.targetExportName, candidatePlan);
        }
      }
      if (
        [...requiredUsageExportNames].every((exportName) => {
          const plan = parentSliceByExport.get(exportName);
          return propsByExport.has(exportName) || (plan !== undefined && plan.frames.length > 0);
        })
      ) {
        break scanBatches;
      }
    }
  }

  if (options.climbParentSlices !== false) {
    for (const [exportName, initialPlan] of parentSliceByExport) {
      throwIfPreviewBuildCancelled(options.signal);
      const climbedPlan = await climbPreviewParentSliceProject({
        initialPlan,
        matchesTargetImport: moduleResolver.matchesTarget,
        readSource: readCachedUsageSource,
        ...(options.signal === undefined ? {} : { signal: options.signal }),
        sourcePaths,
      });
      parentSliceByExport.set(exportName, climbedPlan);
    }
  }

  const inspectorPlan =
    !shouldDiscoverInspector || renderChainsByExport === undefined
      ? undefined
      : await createPreviewInspectorAncestorPlan({
          documentPath: boundary.documentPath,
          exportName: options.inspectorExportName,
          matchesTargetImport: moduleResolver.matchesTarget,
          readSource: readCachedUsageSource,
          resolveModule: moduleResolver.resolve,
          renderChainsByExport,
          ...(options.signal === undefined ? {} : { signal: options.signal }),
          sourcePaths: [...sourcePaths, boundary.documentPath],
        });

  const dependencies = new Set<string>([
    ...propDependencyByExport.values(),
    ...[...parentSliceByExport.values()].flatMap((plan) =>
      plan.frames.length > 0 ? plan.dependencyPaths : [],
    ),
    ...(inspectorPlan?.dependencyPaths ?? []),
  ]);
  const inspectorTargetImportSpecifiers =
    inspectorPlan === undefined ? [] : moduleResolver.getMatchedSpecifiers(boundary.documentPath);
  return {
    dependencyPaths: [...dependencies].sort(),
    ...(inspectorPlan === undefined ? {} : { inspectorPlan }),
    ...(inspectorTargetImportSpecifiers.length === 0 ? {} : { inspectorTargetImportSpecifiers }),
    parentSlicesByExport: Object.fromEntries(parentSliceByExport),
    propsByExport: Object.fromEntries(propsByExport),
    ...(renderChainsByExport === undefined ? {} : { renderChainsByExport }),
  };

  /** Reuses one bounded source record across entry, prop, slice, and ancestor analysis passes. */
  async function readCachedUsageSourceRecord(sourcePath: string): Promise<UsageSource | undefined> {
    throwIfPreviewBuildCancelled(options.signal);
    const normalizedPath = path.normalize(sourcePath);
    const cachedSource = usageSourceByPath.get(normalizedPath);
    if (cachedSource !== undefined) {
      return cachedSource;
    }
    if (unavailableUsageSourcePaths.has(normalizedPath)) {
      return undefined;
    }
    const source = await readUsageSource(
      sourcePath,
      snapshotByPath.get(normalizedPath),
      analysisCache,
    );
    throwIfPreviewBuildCancelled(options.signal);
    if (source === undefined || consumedBytes + source.byteLength > MAX_TOTAL_SOURCE_BYTES) {
      unavailableUsageSourcePaths.add(normalizedPath);
      return undefined;
    }
    consumedBytes += source.byteLength;
    usageSourceByPath.set(normalizedPath, source);
    return source;
  }

  /** Adapts the shared source-record cache to graph and ancestor readers that need only text. */
  async function readCachedUsageSource(sourcePath: string): Promise<string | undefined> {
    return (await readCachedUsageSourceRecord(sourcePath))?.sourceText;
  }
}

/** Maps a selected target suffix to the snapshot loader identity used by disk/editor readers. */
function readUsageSourceLanguage(sourcePath: string): PreviewSourceSnapshot['language'] {
  const extension = path.extname(sourcePath).toLowerCase();
  if (extension === '.tsx') {
    return 'tsx';
  }
  if (extension === '.ts' || extension === '.mts' || extension === '.cts') {
    return 'ts';
  }
  return extension === '.jsx' ? 'jsx' : 'js';
}

/**
 * Enumerates one reusable, stable package inventory for compiler-level caching.
 *
 * The inventory deliberately includes every eligible target file. A later discovery call removes
 * its current target, which lets the compiler cache this array by `(workspaceRoot, projectRoot)` and
 * reuse it across multiple preview tabs and hot rebuilds in the same package.
 */
export async function collectPreviewTargetUsageSourcePaths(
  options: PreviewTargetUsageSourceInventoryOptions,
): Promise<readonly string[]> {
  throwIfPreviewBuildCancelled(options.signal);
  const boundary = createUsagePackageBoundary(options.workspaceRoot, options.projectRoot);
  return collectProjectSourcePaths(boundary.packageRoot, options.signal);
}

/**
 * Validates the workspace/package nesting contract before any directory is enumerated.
 *
 * The extension host canonicalizes these paths before calling the adapter. This additional lexical
 * check is intentionally fail-closed: a programming error must not turn a package-local reverse
 * lookup into an accidental scan of a monorepo sibling or a directory above the trusted workspace.
 */
function createUsageSearchBoundary(options: PreviewTargetUsagePropsOptions): UsageSearchBoundary {
  const packageBoundary = createUsagePackageBoundary(options.workspaceRoot, options.projectRoot);
  if (!path.isAbsolute(options.documentPath)) {
    throw new RangeError('Preview usage search boundaries and target path must be absolute.');
  }
  const documentPath = path.normalize(options.documentPath);
  if (!isPathInside(packageBoundary.packageRoot, documentPath)) {
    throw new RangeError('Preview usage target must remain inside the selected package root.');
  }
  return { documentPath, ...packageBoundary };
}

/** Validates the reusable package boundary without requiring any particular preview target. */
function createUsagePackageBoundary(
  workspacePath: string,
  packagePath: string,
): Omit<UsageSearchBoundary, 'documentPath'> {
  if (!path.isAbsolute(workspacePath) || !path.isAbsolute(packagePath)) {
    throw new RangeError('Preview usage workspace and package roots must be absolute.');
  }
  const workspaceRoot = path.normalize(workspacePath);
  const packageRoot = path.normalize(packagePath);
  if (!isPathInside(workspaceRoot, packageRoot)) {
    throw new RangeError('Preview usage package root must remain inside the workspace root.');
  }
  return { packageRoot, workspaceRoot };
}

/** Reports whether one absolute candidate is equal to or nested below an absolute root. */
function isPathInside(rootPath: string, candidatePath: string): boolean {
  const relativePath = path.relative(path.normalize(rootPath), path.normalize(candidatePath));
  return (
    relativePath.length === 0 ||
    (relativePath !== '..' &&
      !relativePath.startsWith(`..${path.sep}`) &&
      !path.isAbsolute(relativePath))
  );
}

/** Enumerates application source paths in stable order without traversing package or build output. */
async function collectProjectSourcePaths(
  packageRoot: string,
  signal?: AbortSignal,
): Promise<readonly string[]> {
  const pendingDirectories = [packageRoot];
  const sourcePaths: string[] = [];

  while (pendingDirectories.length > 0 && sourcePaths.length < MAX_SCANNED_SOURCE_FILES) {
    throwIfPreviewBuildCancelled(signal);
    const directoryPath = pendingDirectories.shift();
    if (directoryPath === undefined) {
      break;
    }
    let entries;
    try {
      entries = await readdir(directoryPath, { withFileTypes: true });
    } catch {
      continue;
    }
    throwIfPreviewBuildCancelled(signal);
    entries.sort((left, right) => left.name.localeCompare(right.name));
    for (const entry of entries) {
      if (entry.isSymbolicLink()) {
        continue;
      }
      const entryPath = path.join(directoryPath, entry.name);
      if (entry.isDirectory()) {
        if (!IGNORED_DIRECTORY_NAMES.has(entry.name)) {
          pendingDirectories.push(entryPath);
        }
      } else if (entry.isFile() && SOURCE_EXTENSION_PATTERN.test(entry.name)) {
        sourcePaths.push(entryPath);
        if (sourcePaths.length >= MAX_SCANNED_SOURCE_FILES) {
          break;
        }
      }
    }
    pendingDirectories.sort();
  }
  return sourcePaths.sort();
}

/**
 * Filters a cached or freshly enumerated inventory through the current package and target bounds.
 * Dirty snapshots are included as candidate consumers even when a newly created file has not yet
 * entered the compiler's cached disk inventory.
 */
function selectUsageSourcePaths(
  inventoryPaths: readonly string[],
  snapshots: readonly PreviewSourceSnapshot[],
  boundary: UsageSearchBoundary,
): readonly string[] {
  const selectedPaths = new Set<string>();
  const dirtyPaths = snapshots.map((snapshot) => snapshot.documentPath);
  for (const candidatePath of [...dirtyPaths, ...inventoryPaths]) {
    if (!path.isAbsolute(candidatePath)) {
      continue;
    }
    const normalizedPath = path.normalize(candidatePath);
    if (
      normalizedPath === boundary.documentPath ||
      !isPathInside(boundary.packageRoot, normalizedPath) ||
      !SOURCE_EXTENSION_PATTERN.test(path.basename(normalizedPath)) ||
      containsIgnoredPathSegment(boundary.packageRoot, normalizedPath)
    ) {
      continue;
    }
    selectedPaths.add(normalizedPath);
    if (selectedPaths.size >= MAX_SCANNED_SOURCE_FILES) {
      break;
    }
  }
  return [...selectedPaths].sort();
}

/** Rejects cached inventory entries that cross a directory excluded by fresh enumeration. */
function containsIgnoredPathSegment(packageRoot: string, sourcePath: string): boolean {
  const relativePath = path.relative(packageRoot, sourcePath);
  return relativePath
    .split(path.sep)
    .slice(0, -1)
    .some((segment) => IGNORED_DIRECTORY_NAMES.has(segment));
}

/** Reads one editor snapshot or bounded disk file without allowing a single giant source blob. */
async function readUsageSource(
  sourcePath: string,
  snapshot: PreviewSourceSnapshot | undefined,
  analysisCache?: PreviewProjectFileAnalysisCache,
): Promise<UsageSource | undefined> {
  if (analysisCache !== undefined) {
    return analysisCache.readSource({
      maximumBytes: MAX_INDIVIDUAL_SOURCE_BYTES,
      ...(snapshot === undefined ? {} : { snapshotText: snapshot.sourceText }),
      sourcePath,
    });
  }
  if (snapshot !== undefined) {
    const byteLength = Buffer.byteLength(snapshot.sourceText, 'utf8');
    return byteLength <= MAX_INDIVIDUAL_SOURCE_BYTES
      ? {
          byteLength,
          filePath: sourcePath,
          fingerprint: `uncached-snapshot:${byteLength.toString()}`,
          sourceText: snapshot.sourceText,
        }
      : undefined;
  }

  try {
    const sourceHandle = await open(sourcePath, 'r');
    try {
      const sourceStats = await sourceHandle.stat();
      if (!sourceStats.isFile() || sourceStats.size > MAX_INDIVIDUAL_SOURCE_BYTES) {
        return undefined;
      }
      const sourceText = await sourceHandle.readFile({ encoding: 'utf8' });
      const byteLength = Buffer.byteLength(sourceText, 'utf8');
      return byteLength <= MAX_INDIVIDUAL_SOURCE_BYTES
        ? {
            byteLength,
            filePath: sourcePath,
            fingerprint: `uncached-disk:${sourceStats.mtimeMs.toString()}:${sourceStats.size.toString()}`,
            sourceText,
          }
        : undefined;
    } finally {
      await sourceHandle.close();
    }
  } catch {
    return undefined;
  }
}

/** Cheap text gate that avoids parsing files without a component tag or plausible target import. */
function mayContainUsage(sourceText: string, documentPath: string): boolean {
  const targetStem = path.basename(documentPath).replace(SOURCE_EXTENSION_PATTERN, '');
  return sourceText.includes(targetStem) && sourceText.includes('<');
}
