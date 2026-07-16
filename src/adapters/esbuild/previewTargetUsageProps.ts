/**
 * Discovers static props and pinpoint wrapper branches from real JSX target usages.
 * Parent-authored literals become low-priority automatic props, while a syntax-only ancestor path
 * restores structural components and styles without executing the complete parent or its siblings.
 */
import { open, readdir } from 'node:fs/promises';
import path from 'node:path';
import type { PreviewSourceSnapshot } from '../../domain/preview';
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

const MAX_SCANNED_SOURCE_FILES = 16_384;
const MAX_CONCURRENT_SOURCE_READS = 16;
const MAX_INDIVIDUAL_SOURCE_BYTES = 4 * 1024 * 1024;
const MAX_TOTAL_SOURCE_BYTES = 128 * 1024 * 1024;
const SOURCE_EXTENSION_PATTERN = /\.(?:[cm]?[jt]sx?)$/iu;
const IGNORED_DIRECTORY_NAMES = new Set([
  '.git',
  '.next',
  '.react-preview',
  '.turbo',
  'build',
  'coverage',
  'dist',
  'node_modules',
  'out',
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
  /** Actual exported owner selected only for the opt-in Page Inspector mode. */
  readonly inspectorPlan?: PreviewInspectorAncestorPlan;
  /** Config-aware aliases proven to resolve to the original Inspector target during discovery. */
  readonly inspectorTargetImportSpecifiers?: readonly string[];
  /** Pinpoint wrapper recipes selected from real JSX branches for each explicit target export. */
  readonly parentSlicesByExport: PreviewParentSlicePlansByExport;
  /** First deterministic literal-prop example for each explicit target export. */
  readonly propsByExport: PreviewStaticPropsByExport;
}

/** Inputs required to search one trusted project without consulting framework configuration. */
export interface PreviewTargetUsagePropsOptions {
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
  /** Trusted workspace root that must contain the selected package root. */
  readonly workspaceRoot: string;
}

/** One source file and its current editor-or-disk text. */
interface UsageSource {
  /** UTF-8 byte count charged against the aggregate reverse-search budget. */
  readonly byteLength: number;
  readonly filePath: string;
  readonly sourceText: string;
}

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
      workspaceRoot: boundary.workspaceRoot,
    }));
  const sourcePaths = selectUsageSourcePaths(inventoryPaths, options.snapshots, boundary);
  const snapshotByPath = new Map(
    options.snapshots
      .filter((snapshot) => isPathInside(boundary.packageRoot, snapshot.documentPath))
      .map((snapshot) => [path.normalize(snapshot.documentPath), snapshot] as const),
  );
  const propsByExport = new Map<string, Readonly<Record<string, PreviewStaticPropValue>>>();
  const propDependencyByExport = new Map<string, string>();
  const parentSliceByExport = new Map<string, PreviewParentSlicePlan>();
  const expectedExportNames = new Set(explicitExportNames);
  const usageSourceByPath = new Map<string, UsageSource>();
  let consumedBytes = 0;

  scanBatches: for (
    let batchStart = 0;
    batchStart < sourcePaths.length;
    batchStart += MAX_CONCURRENT_SOURCE_READS
  ) {
    const sourceBatch = await readUsageSourceBatch(
      sourcePaths.slice(batchStart, batchStart + MAX_CONCURRENT_SOURCE_READS),
      snapshotByPath,
    );
    for (const usageSource of sourceBatch) {
      if (usageSource === undefined) {
        continue;
      }
      if (consumedBytes + usageSource.byteLength > MAX_TOTAL_SOURCE_BYTES) {
        break scanBatches;
      }
      consumedBytes += usageSource.byteLength;
      usageSourceByPath.set(path.normalize(usageSource.filePath), usageSource);
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
        [...expectedExportNames].every((exportName) => {
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
      const climbedPlan = await climbPreviewParentSliceProject({
        initialPlan,
        matchesTargetImport: moduleResolver.matchesTarget,
        readSource: readCachedUsageSource,
        sourcePaths,
      });
      parentSliceByExport.set(exportName, climbedPlan);
    }
  }

  const inspectorPlan =
    options.inspectorExportName === undefined ||
    !explicitExportNames.includes(options.inspectorExportName)
      ? undefined
      : await createPreviewInspectorAncestorPlan({
          documentPath: boundary.documentPath,
          exportName: options.inspectorExportName,
          matchesTargetImport: moduleResolver.matchesTarget,
          readSource: readCachedUsageSource,
          sourcePaths,
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
  };

  /** Reuses bounded snapshot-or-disk text across slice and Inspector reverse traversals. */
  async function readCachedUsageSource(sourcePath: string): Promise<string | undefined> {
    const normalizedPath = path.normalize(sourcePath);
    const cachedSource = usageSourceByPath.get(normalizedPath);
    if (cachedSource !== undefined) {
      return cachedSource.sourceText;
    }
    const source = await readUsageSource(sourcePath, snapshotByPath.get(normalizedPath));
    if (source === undefined || consumedBytes + source.byteLength > MAX_TOTAL_SOURCE_BYTES) {
      return undefined;
    }
    consumedBytes += source.byteLength;
    usageSourceByPath.set(normalizedPath, source);
    return source.sourceText;
  }
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
  const boundary = createUsagePackageBoundary(options.workspaceRoot, options.projectRoot);
  return collectProjectSourcePaths(boundary.packageRoot);
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
async function collectProjectSourcePaths(packageRoot: string): Promise<readonly string[]> {
  const pendingDirectories = [packageRoot];
  const sourcePaths: string[] = [];

  while (pendingDirectories.length > 0 && sourcePaths.length < MAX_SCANNED_SOURCE_FILES) {
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
  for (const candidatePath of [
    ...inventoryPaths,
    ...snapshots.map((snapshot) => snapshot.documentPath),
  ]) {
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
  }
  return [...selectedPaths].sort().slice(0, MAX_SCANNED_SOURCE_FILES);
}

/** Rejects cached inventory entries that cross a directory excluded by fresh enumeration. */
function containsIgnoredPathSegment(packageRoot: string, sourcePath: string): boolean {
  const relativePath = path.relative(packageRoot, sourcePath);
  return relativePath
    .split(path.sep)
    .slice(0, -1)
    .some((segment) => IGNORED_DIRECTORY_NAMES.has(segment));
}

/**
 * Reads one stable path batch with a hard concurrency ceiling.
 *
 * `Promise.all` is deliberately scoped to at most `MAX_CONCURRENT_SOURCE_READS` paths by the
 * caller. Results preserve path order even when storage completes out of order, so the selected
 * first authored usage remains deterministic across SSDs, remote workspaces, and CI filesystems.
 */
async function readUsageSourceBatch(
  sourcePaths: readonly string[],
  snapshotByPath: ReadonlyMap<string, PreviewSourceSnapshot>,
): Promise<readonly (UsageSource | undefined)[]> {
  return Promise.all(
    sourcePaths.map((sourcePath) =>
      readUsageSource(sourcePath, snapshotByPath.get(path.normalize(sourcePath))),
    ),
  );
}

/** Reads one editor snapshot or bounded disk file without allowing a single giant source blob. */
async function readUsageSource(
  sourcePath: string,
  snapshot: PreviewSourceSnapshot | undefined,
): Promise<UsageSource | undefined> {
  if (snapshot !== undefined) {
    const byteLength = Buffer.byteLength(snapshot.sourceText, 'utf8');
    return byteLength <= MAX_INDIVIDUAL_SOURCE_BYTES
      ? { byteLength, filePath: sourcePath, sourceText: snapshot.sourceText }
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
        ? { byteLength, filePath: sourcePath, sourceText }
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
