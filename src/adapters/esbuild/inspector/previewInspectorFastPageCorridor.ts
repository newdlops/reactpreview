/**
 * Discovers a small generic React application corridor for Page Inspector's first paint.
 *
 * A selected component and an application entry are two points in the same authored import graph.
 * Full Inspector enrichment can prove their relationship from a package-wide inventory, but doing
 * that before first paint makes a large repository feel as if the extension merely stopped. This
 * module instead performs a bounded meet-in-the-middle search: likely app entries walk imports
 * forward, while target-near files walk resolved imports backward. Once both sides meet, a small
 * JSX-oriented DFS adds the page shell's static siblings so layout, header, and navigation evidence
 * are available to the ordinary ancestor planner. Application modules are parsed as inert text and
 * are never imported or evaluated in the extension host.
 */
import { readdir } from 'node:fs/promises';
import type { Dirent } from 'node:fs';
import path from 'node:path';
import { throwIfPreviewBuildCancelled } from '../../../domain/previewBuildExecution';
import { analyzePreviewRenderSource } from '../renderGraph/previewRenderSourceAnalysis';
import type { ResolvePreviewRenderGraphModule } from '../renderGraph/previewRenderGraphTypes';
import { collectPreviewDynamicImportInventory } from '../staticResources/previewDynamicImportInventory';
import type { ReadPreviewInspectorSource } from './previewInspectorAncestorTypes';
import {
  collectPreviewInspectorAuxiliaryNextAppRoute,
  findPreviewInspectorSelectedAuxiliaryRoot,
} from './previewInspectorAuxiliaryNextAppRoute';
import { findPreviewInspectorFastForwardMeeting } from './previewInspectorFastForwardSearch';
import { analyzePreviewInspectorFastRouteRegistry } from './previewInspectorFastRouteRegistry';
import {
  collectPreviewInspectorFastResolvedImports,
  isPreviewInspectorFastAuxiliarySourcePath,
  type PreviewInspectorFastResolvedImportEdge,
} from './previewInspectorFastResolvedImports';
import { createPreviewInspectorFastSourceReaders } from './previewInspectorFastSourceReaders';
import { collectPreviewInspectorOneHopContext } from './previewInspectorOneHopContext';
import type { PreviewInspectorOneHopVisualPath } from './previewInspectorShallowVisualTypes';
import { collectPreviewStaticRouteProjectionInventory } from './previewInspectorStaticRouteProjection';
import {
  analyzePreviewInspectorFastSemanticImports,
  arePreviewInspectorFastExportDemandsCompatible,
  type PreviewInspectorFastSemanticImport,
} from './previewInspectorFastSemanticImports';

const MAXIMUM_ENTRY_DIRECTORIES = 96;
const MAXIMUM_ENTRY_FILES = 96;
const MAXIMUM_REVERSE_DEPTH = 8;
const MAXIMUM_REVERSE_DIRECTORIES = 48;
const MAXIMUM_FILES_PER_REVERSE_DIRECTORY = 192;
const MAXIMUM_REVERSE_FILES = 640;
const MAXIMUM_FORWARD_FILES = 768;
const MAXIMUM_FORWARD_DEPTH = 48;
const MAXIMUM_FORWARD_AFFINITY_PATHS = 16;
const MAXIMUM_IMPORTS_PER_FILE = 256;
const MAXIMUM_PAGE_SUBTREE_FILES = 128;
const MAXIMUM_PAGE_SUBTREE_DEPTH = 8;
const MAXIMUM_ONE_HOP_CONTEXT_FILES = 64;
const MAXIMUM_FAST_DYNAMIC_IMPORTS = 8;
const MAXIMUM_FAST_ROUTE_IMPORTS = 48;
const SOURCE_FILE_PATTERN = /\.[cm]?[jt]sx?$/iu;
const ENTRY_FILE_PATTERN =
  /^(?:app|bootstrap|client|entry|index|init|main|mount|render|renderer|root|start)(?:[-_.].*)?\.[cm]?[jt]sx?$/iu;
const PAGE_SHELL_FILE_PATTERN =
  /(?:^|[-_.])(?:apps?|layouts?|pages?|routes?|routers?|screens?|shells?|templates?|views?)(?:[-_.]|$)/iu;

/** Inputs for one bounded entry-to-target corridor discovery pass. */
export interface CollectPreviewInspectorFastPageCorridorOptions {
  /** Dirty editor files that may not yet exist in a directory listing. */
  readonly additionalSourcePaths?: Iterable<string>;
  /** Absolute component source selected by the editor command. */
  readonly documentPath: string;
  /** Nearest package root used for cheap conventional-entry enumeration. */
  readonly projectRoot: string;
  /** Snapshot-aware and byte-bounded source reader owned by the compiler cache. */
  readonly readSource: ReadPreviewInspectorSource;
  /** Exact alias-aware resolver shared with the eventual esbuild invocation. */
  readonly resolveModule: ResolvePreviewRenderGraphModule;
  /** Cancels stale traversal work before another editor revision can reuse it. */
  readonly signal?: AbortSignal;
  /** Trusted workspace boundary; resolved project modules may cross package roots inside it. */
  readonly workspaceRoot: string;
}

/** A small proven or provisional path passed to the existing Page Inspector ancestor planner. */
export interface PreviewInspectorFastPageCorridor {
  /** True only when a semantic ReactDOM entry reaches the target-side reverse closure. */
  readonly entryConnected: boolean;
  /** Entry/root-to-target import corridor in authored order. */
  readonly importPath: readonly string[];
  /** Proven auxiliary App Router page; absent for ordinary generic React corridors. */
  readonly nextAppPagePath?: string;
  /** Shallow visual import/value-flow evidence retained for later bounded bundler projection. */
  readonly shallowVisualPaths: readonly PreviewInspectorOneHopVisualPath[];
  /** Corridor plus bounded JSX-oriented page subtree evidence. */
  readonly sourcePaths: readonly string[];
  /** Honest budget marker used by tests and future diagnostics. */
  readonly truncated: boolean;
}

/** One target-side reverse frontier with the child it directly imports. */
interface ReverseFrontier {
  readonly depth: number;
  readonly sourcePath: string;
}

/**
 * Finds the shortest bounded generic page corridor without requesting a package source inventory.
 *
 * The returned path is evidence, not a promise that every runtime branch will mount. The normal
 * ancestor planner still validates JSX ownership, entry evidence, layouts, and routes. When no
 * semantic entry meets the reverse side, the furthest page-like target owner is returned as a
 * provisional root; this is preferable to a context-free component while full background
 * enrichment remains free to replace it with a stronger application path.
 */
export async function collectPreviewInspectorFastPageCorridor(
  options: CollectPreviewInspectorFastPageCorridorOptions,
): Promise<PreviewInspectorFastPageCorridor | undefined> {
  const documentPath = path.normalize(options.documentPath);
  const projectRoot = path.resolve(options.projectRoot);
  const workspaceRoot = path.resolve(options.workspaceRoot);
  if (!isPathInside(workspaceRoot, documentPath) || !isPathInside(workspaceRoot, projectRoot)) {
    return undefined;
  }

  const sourceReaders = createPreviewInspectorFastSourceReaders(options.readSource);
  const auxiliaryRoute = await collectPreviewInspectorAuxiliaryNextAppRoute({
    documentPath,
    projectRoot,
    ...(options.signal === undefined ? {} : { signal: options.signal }),
  });
  const selectedAuxiliaryRoot =
    auxiliaryRoute?.auxiliaryRootPath ??
    findPreviewInspectorSelectedAuxiliaryRoot(documentPath, projectRoot);
  const snapshotPaths = [...(options.additionalSourcePaths ?? [])]
    .map((sourcePath) => path.normalize(sourcePath))
    .filter((sourcePath) => isProjectSourcePath(sourcePath, workspaceRoot));
  const entryPaths = await collectLikelyEntryPaths({
    documentPath,
    projectRoot,
    ...(options.signal === undefined ? {} : { signal: options.signal }),
    snapshotPaths,
  });
  throwIfPreviewBuildCancelled(options.signal);

  const reverse = await collectReverseClosure({
    documentPath,
    projectRoot,
    readSource: sourceReaders.reverse,
    resolveModule: options.resolveModule,
    ...(options.signal === undefined ? {} : { signal: options.signal }),
    snapshotPaths,
    ...(selectedAuxiliaryRoot === undefined ? {} : { selectedAuxiliaryRoot }),
    targetedPagePaths: auxiliaryRoute?.pagePaths ?? [],
    workspaceRoot,
  });
  const forward = await findForwardMeeting({
    documentPath,
    entryPaths,
    readEntrySource: sourceReaders.entry,
    readSource: sourceReaders.forward,
    resolveModule: options.resolveModule,
    reverseChildByOwner: reverse.childByOwner,
    reversePaths: reverse.paths,
    reverseRequiredExports: reverse.requiredExportsByPath,
    ...(options.signal === undefined ? {} : { signal: options.signal }),
    ...(selectedAuxiliaryRoot === undefined ? {} : { selectedAuxiliaryRoot }),
    workspaceRoot,
  });
  const importPath =
    forward?.importPath ?? selectProvisionalReversePath(documentPath, reverse.childByOwner);
  if (importPath.length < 2) return undefined;

  const boundedPath = await trimBroadRouteRegistryPrefix({
    importPath,
    readSource: sourceReaders.forward,
    resolveModule: options.resolveModule,
    ...(options.signal === undefined ? {} : { signal: options.signal }),
    ...(selectedAuxiliaryRoot === undefined ? {} : { selectedAuxiliaryRoot }),
    workspaceRoot,
  });
  // A central router that imports the selected component directly has no cheap authored shell
  // below it. Returning no plan lets the compiler use its existing direct-target first paint;
  // full enrichment may still restore the complete application router in the background.
  if (boundedPath.importPath.length < 2) return undefined;

  const oneHopContext = await collectPreviewInspectorOneHopContext({
    importPath: boundedPath.importPath,
    maximumFiles: MAXIMUM_ONE_HOP_CONTEXT_FILES,
    readSource: sourceReaders.subtree,
    resolveModule: options.resolveModule,
    ...(options.signal === undefined ? {} : { signal: options.signal }),
    ...(selectedAuxiliaryRoot === undefined ? {} : { selectedAuxiliaryRoot }),
    workspaceRoot,
  });
  const subtree = await collectPageSubtree({
    importPath: boundedPath.importPath,
    readSource: sourceReaders.subtree,
    reservedSourcePaths: oneHopContext.sourcePaths,
    resolveModule: options.resolveModule,
    ...(options.signal === undefined ? {} : { signal: options.signal }),
    ...(selectedAuxiliaryRoot === undefined ? {} : { selectedAuxiliaryRoot }),
    workspaceRoot,
  });
  const nextAppPagePath = boundedPath.importPath[0];
  return Object.freeze({
    entryConnected: forward?.semanticEntry === true && !boundedPath.trimmed,
    importPath: Object.freeze(boundedPath.importPath),
    ...(nextAppPagePath !== undefined &&
    auxiliaryRoute?.pagePaths.includes(nextAppPagePath) === true
      ? { nextAppPagePath }
      : {}),
    shallowVisualPaths: oneHopContext.shallowVisualPaths,
    sourcePaths: Object.freeze(
      [
        ...new Set([
          ...boundedPath.importPath,
          ...subtree.sourcePaths,
          ...(auxiliaryRoute?.sourcePaths ?? []),
        ]),
      ].sort(),
    ),
    truncated:
      boundedPath.trimmed ||
      reverse.truncated ||
      (forward?.truncated ?? false) ||
      oneHopContext.truncated ||
      subtree.truncated,
  });
}

/** Enumerates shallow conventional entries, prioritizing the selected file's package ancestry. */
async function collectLikelyEntryPaths(options: {
  readonly documentPath: string;
  readonly projectRoot: string;
  readonly signal?: AbortSignal;
  readonly snapshotPaths: readonly string[];
}): Promise<readonly string[]> {
  const entries = new Set(
    options.snapshotPaths.filter((sourcePath) =>
      isLikelyEntryPath(sourcePath, options.projectRoot),
    ),
  );
  const queued = new Set<string>();
  const pending: { readonly depth: number; readonly directoryPath: string }[] = [];

  /** Adds one directory once and lets target ancestry win equal-depth traversal. */
  const enqueue = (directoryPath: string, depth: number): void => {
    const normalizedPath = path.normalize(directoryPath);
    if (queued.has(normalizedPath) || !isPathInside(options.projectRoot, normalizedPath)) return;
    queued.add(normalizedPath);
    pending.push({ depth, directoryPath: normalizedPath });
    pending.sort((left, right) => {
      const affinity =
        Number(isPathInside(right.directoryPath, options.documentPath)) -
        Number(isPathInside(left.directoryPath, options.documentPath));
      return affinity !== 0
        ? affinity
        : left.depth - right.depth || left.directoryPath.localeCompare(right.directoryPath);
    });
  };

  enqueue(options.projectRoot, 0);
  enqueue(path.join(options.projectRoot, 'src'), 0);
  enqueue(path.join(options.projectRoot, 'app'), 0);
  let visitedDirectories = 0;
  while (
    pending.length > 0 &&
    visitedDirectories < MAXIMUM_ENTRY_DIRECTORIES &&
    entries.size < MAXIMUM_ENTRY_FILES
  ) {
    throwIfPreviewBuildCancelled(options.signal);
    const current = pending.shift();
    if (current === undefined) break;
    visitedDirectories += 1;
    const directoryEntries = await readDirectory(current.directoryPath);
    for (const entry of directoryEntries) {
      if (entry.isFile()) {
        const sourcePath = path.join(current.directoryPath, entry.name);
        if (isLikelyEntryPath(sourcePath, options.projectRoot)) entries.add(sourcePath);
      }
    }
    if (current.depth >= 4) continue;
    for (const entry of directoryEntries) {
      if (entry.isDirectory() && isTraversableDirectory(entry.name)) {
        enqueue(path.join(current.directoryPath, entry.name), current.depth + 1);
      }
    }
  }
  return Object.freeze(
    [...entries]
      .filter((sourcePath) => path.normalize(sourcePath) !== options.documentPath)
      .sort(
        (left, right) => scoreEntryPath(right) - scoreEntryPath(left) || left.localeCompare(right),
      )
      .slice(0, MAXIMUM_ENTRY_FILES),
  );
}

/** Builds a target-to-owner closure by reading only files beside the target and its ancestors. */
async function collectReverseClosure(options: {
  readonly documentPath: string;
  readonly projectRoot: string;
  readonly readSource: ReadPreviewInspectorSource;
  readonly resolveModule: ResolvePreviewRenderGraphModule;
  readonly selectedAuxiliaryRoot?: string;
  readonly signal?: AbortSignal;
  readonly snapshotPaths: readonly string[];
  readonly targetedPagePaths: readonly string[];
  readonly workspaceRoot: string;
}): Promise<{
  readonly childByOwner: ReadonlyMap<string, string>;
  readonly paths: ReadonlySet<string>;
  readonly requiredExportsByPath: ReadonlyMap<string, readonly string[]>;
  readonly truncated: boolean;
}> {
  const paths = new Set<string>([options.documentPath]);
  const childByOwner = new Map<string, string>();
  const depthByPath = new Map<string, number>([[options.documentPath, 0]]);
  const pending: ReverseFrontier[] = [{ depth: 0, sourcePath: options.documentPath }];
  const scannedDirectories = new Set<string>();
  const readCandidates = new Set<string>();
  const edgesByCandidate = new Map<string, readonly PreviewInspectorFastResolvedImportEdge[]>();
  const indexedCandidates = new Set<string>();
  const ownersByChildPath = new Map<string, PreviewInspectorFastResolvedImportEdge[]>();
  const requiredExportsByPath = new Map<string, readonly string[]>([
    [options.documentPath, Object.freeze(['*'])],
  ]);
  const semanticEdgesByCandidate = new Map<
    string,
    ReturnType<typeof analyzePreviewInspectorFastSemanticImports>
  >();
  const sourceTextByCandidate = new Map<string, string>();
  let truncated = false;

  /** Parses React/export flow only when one raw edge is about to join the target-side closure. */
  const readSemanticEdge = (
    edge: PreviewInspectorFastResolvedImportEdge,
  ): PreviewInspectorFastSemanticImport | undefined => {
    let semanticEdges = semanticEdgesByCandidate.get(edge.ownerPath);
    if (semanticEdges === undefined) {
      const sourceText = sourceTextByCandidate.get(edge.ownerPath);
      const rawEdges = edgesByCandidate.get(edge.ownerPath);
      if (sourceText === undefined || rawEdges === undefined) return undefined;
      semanticEdges = analyzePreviewInspectorFastSemanticImports(
        edge.ownerPath,
        sourceText,
        rawEdges,
      );
      semanticEdgesByCandidate.set(edge.ownerPath, semanticEdges);
    }
    return semanticEdges.find((candidate) => candidate.childPath === edge.childPath);
  };

  /**
   * Connects an owner and immediately propagates through previously indexed upstream owners.
   *
   * Candidate files are intentionally read in page/index affinity order rather than dependency
   * order. An index may therefore be inspected before the page it imports is known to reach the
   * target. Retaining child-to-owner edges turns later discoveries into a bounded fixed point
   * without rescanning a directory or rereading source.
   */
  const connectOwner = (edge: PreviewInspectorFastResolvedImportEdge): void => {
    const childDepth = depthByPath.get(edge.childPath);
    if (childDepth === undefined || childDepth >= MAXIMUM_REVERSE_DEPTH) return;
    const semanticEdge = readSemanticEdge(edge);
    if (
      semanticEdge !== undefined &&
      !arePreviewInspectorFastExportDemandsCompatible(
        semanticEdge.requestedExportNames,
        requiredExportsByPath.get(edge.childPath),
      )
    ) {
      return;
    }
    const ownerDepth = childDepth + 1;
    const previousDepth = depthByPath.get(edge.ownerPath);
    if (previousDepth !== undefined && previousDepth <= ownerDepth) return;
    paths.add(edge.ownerPath);
    depthByPath.set(edge.ownerPath, ownerDepth);
    childByOwner.set(edge.ownerPath, edge.childPath);
    requiredExportsByPath.set(
      edge.ownerPath,
      semanticEdge?.ownerExportNames ?? Object.freeze(['*']),
    );
    pending.push({ depth: ownerDepth, sourcePath: edge.ownerPath });
    for (const upstreamEdge of ownersByChildPath.get(edge.ownerPath) ?? []) {
      connectOwner(upstreamEdge);
    }
  };

  /** Indexes resolved imports once, then activates the first edge whose child already reaches target. */
  const indexCandidateEdges = (
    candidatePath: string,
    edges: readonly PreviewInspectorFastResolvedImportEdge[],
  ): void => {
    if (indexedCandidates.has(candidatePath)) return;
    indexedCandidates.add(candidatePath);
    for (const edge of edges) {
      const owners = ownersByChildPath.get(edge.childPath) ?? [];
      owners.push(edge);
      ownersByChildPath.set(edge.childPath, owners);
    }
    for (const reachableEdge of edges.filter((edge) => paths.has(edge.childPath))) {
      connectOwner(reachableEdge);
    }
  };

  while (pending.length > 0 && readCandidates.size < MAXIMUM_REVERSE_FILES) {
    throwIfPreviewBuildCancelled(options.signal);
    const frontier = pending.shift();
    if (frontier === undefined || frontier.depth >= MAXIMUM_REVERSE_DEPTH) continue;
    const directories = collectSourceAncestorDirectories(
      path.dirname(frontier.sourcePath),
      options.projectRoot,
    );
    for (const directoryPath of directories) {
      if (scannedDirectories.size >= MAXIMUM_REVERSE_DIRECTORIES) {
        truncated = true;
        break;
      }
      if (scannedDirectories.has(directoryPath)) continue;
      scannedDirectories.add(directoryPath);
      const directoryEntries = await readDirectory(directoryPath);
      const diskCandidates = directoryEntries
        .filter((entry) => entry.isFile() && SOURCE_FILE_PATTERN.test(entry.name))
        .map((entry) => path.join(directoryPath, entry.name));
      /*
       * Feature targets commonly live in `components/` while their nearest JSX owner lives in a
       * sibling `pages/`, `screens/`, or `routes/` directory. Inspect only one direct semantic
       * sibling level; recursively walking every descendant here would recreate the cold full scan
       * this fast path exists to avoid.
       */
      for (const childDirectory of directoryEntries
        .filter(
          (entry) =>
            entry.isDirectory() &&
            /^(?:app|layouts?|pages?|routes?|screens?|shells?|views?)$/iu.test(entry.name),
        )
        .slice(0, 16)) {
        const childDirectoryPath = path.join(directoryPath, childDirectory.name);
        if (
          scannedDirectories.has(childDirectoryPath) ||
          scannedDirectories.size >= MAXIMUM_REVERSE_DIRECTORIES
        ) {
          truncated ||= scannedDirectories.size >= MAXIMUM_REVERSE_DIRECTORIES;
          continue;
        }
        scannedDirectories.add(childDirectoryPath);
        for (const childEntry of await readDirectory(childDirectoryPath)) {
          if (childEntry.isFile() && SOURCE_FILE_PATTERN.test(childEntry.name)) {
            diskCandidates.push(path.join(childDirectoryPath, childEntry.name));
          }
        }
      }
      const candidates = [
        ...new Set([
          ...diskCandidates,
          ...options.snapshotPaths.filter(
            (sourcePath) => path.dirname(sourcePath) === directoryPath,
          ),
        ]),
      ]
        .filter(
          (sourcePath) =>
            sourcePath !== options.documentPath &&
            isAdmittedSourcePath(sourcePath, options.projectRoot, options.selectedAuxiliaryRoot),
        )
        .sort(
          (left, right) =>
            scoreReverseCandidate(right, frontier.sourcePath) -
              scoreReverseCandidate(left, frontier.sourcePath) || left.localeCompare(right),
        );
      if (candidates.length > MAXIMUM_FILES_PER_REVERSE_DIRECTORY) truncated = true;
      for (const candidatePath of candidates.slice(0, MAXIMUM_FILES_PER_REVERSE_DIRECTORY)) {
        if (readCandidates.size >= MAXIMUM_REVERSE_FILES) {
          truncated = true;
          break;
        }
        let edges = edgesByCandidate.get(candidatePath);
        if (edges === undefined) {
          readCandidates.add(candidatePath);
          const sourceText = await options.readSource(candidatePath);
          if (sourceText === undefined) continue;
          sourceTextByCandidate.set(candidatePath, sourceText);
          edges = collectPreviewInspectorFastResolvedImports(
            candidatePath,
            sourceText,
            options.resolveModule,
            options.workspaceRoot,
            {
              preferredPath: frontier.sourcePath,
              ...(options.selectedAuxiliaryRoot === undefined
                ? {}
                : { selectedAuxiliaryRoot: options.selectedAuxiliaryRoot }),
            },
          );
          edgesByCandidate.set(candidatePath, edges);
        }
        indexCandidateEdges(candidatePath, edges);
      }
    }
    /*
     * App Router pages may be many filesystem levels away and do not import their layouts. The
     * target-affine route finder supplies only a handful of page candidates; re-checking their
     * cached edges after each newly discovered registry owner avoids a full `app` inventory.
     */
    for (const candidatePath of options.targetedPagePaths) {
      let edges = edgesByCandidate.get(candidatePath);
      if (edges === undefined) {
        if (readCandidates.size >= MAXIMUM_REVERSE_FILES) {
          truncated = true;
          break;
        }
        readCandidates.add(candidatePath);
        const sourceText = await options.readSource(candidatePath);
        if (sourceText === undefined) continue;
        sourceTextByCandidate.set(candidatePath, sourceText);
        edges = collectPreviewInspectorFastResolvedImports(
          candidatePath,
          sourceText,
          options.resolveModule,
          options.workspaceRoot,
          {
            preferredPath: frontier.sourcePath,
            ...(options.selectedAuxiliaryRoot === undefined
              ? {}
              : { selectedAuxiliaryRoot: options.selectedAuxiliaryRoot }),
          },
        );
        edgesByCandidate.set(candidatePath, edges);
      }
      indexCandidateEdges(candidatePath, edges);
    }
  }
  return Object.freeze({ childByOwner, paths, requiredExportsByPath, truncated });
}

/** Walks imports from shallow app entries and stops at the first target-side meeting point. */
async function findForwardMeeting(options: {
  readonly documentPath: string;
  readonly entryPaths: readonly string[];
  readonly readEntrySource: ReadPreviewInspectorSource;
  readonly readSource: ReadPreviewInspectorSource;
  readonly resolveModule: ResolvePreviewRenderGraphModule;
  readonly reverseChildByOwner: ReadonlyMap<string, string>;
  readonly reversePaths: ReadonlySet<string>;
  readonly reverseRequiredExports: ReadonlyMap<string, readonly string[]>;
  readonly selectedAuxiliaryRoot?: string;
  readonly signal?: AbortSignal;
  readonly workspaceRoot: string;
}): Promise<
  | {
      readonly importPath: readonly string[];
      readonly semanticEntry: boolean;
      readonly truncated: boolean;
    }
  | undefined
> {
  const entries: { readonly semanticEntry: boolean; readonly sourcePath: string }[] = [];
  const preferredPaths = [...options.reversePaths]
    .sort(
      (left, right) =>
        scoreProvisionalRoot(right) - scoreProvisionalRoot(left) || left.localeCompare(right),
    )
    .slice(0, MAXIMUM_FORWARD_AFFINITY_PATHS);
  for (const entryPath of options.entryPaths) {
    const sourceText = await options.readEntrySource(entryPath);
    if (sourceText === undefined) continue;
    entries.push({
      semanticEntry: hasSemanticReactEntry(entryPath, sourceText),
      sourcePath: entryPath,
    });
  }
  return findPreviewInspectorFastForwardMeeting({
    documentPath: options.documentPath,
    entries,
    getChildren: async (sourcePath) => {
      const sourceText = await options.readSource(sourcePath);
      if (sourceText === undefined) {
        return Object.freeze({ childEdges: Object.freeze([]), truncated: false });
      }
      const edges = collectPreviewInspectorFastResolvedImports(
        sourcePath,
        sourceText,
        options.resolveModule,
        options.workspaceRoot,
        {
          preferredPaths,
          ...(options.selectedAuxiliaryRoot === undefined
            ? {}
            : { selectedAuxiliaryRoot: options.selectedAuxiliaryRoot }),
        },
      );
      const boundedEdges = edges.slice(0, MAXIMUM_IMPORTS_PER_FILE);
      const semanticEdges = analyzePreviewInspectorFastSemanticImports(
        sourcePath,
        sourceText,
        boundedEdges,
      );
      return Object.freeze({
        childEdges: Object.freeze(
          semanticEdges.map((edge) =>
            Object.freeze({
              ownerExportNames: edge.ownerExportNames,
              renderStrength: edge.renderStrength,
              requestedExportNames: edge.requestedExportNames,
              sourcePath: edge.childPath,
            }),
          ),
        ),
        truncated: edges.length > MAXIMUM_IMPORTS_PER_FILE,
      });
    },
    maximumDepth: MAXIMUM_FORWARD_DEPTH,
    maximumFiles: MAXIMUM_FORWARD_FILES,
    reverseChildByOwner: options.reverseChildByOwner,
    reversePaths: options.reversePaths,
    reverseRequiredExports: options.reverseRequiredExports,
    ...(options.signal === undefined ? {} : { signal: options.signal }),
    workspaceRoot: options.workspaceRoot,
  });
}

/** Adds static JSX-facing dependencies around the selected page root with a strict DFS budget. */
async function collectPageSubtree(options: {
  readonly importPath: readonly string[];
  readonly readSource: ReadPreviewInspectorSource;
  readonly reservedSourcePaths: readonly string[];
  readonly resolveModule: ResolvePreviewRenderGraphModule;
  readonly selectedAuxiliaryRoot?: string;
  readonly signal?: AbortSignal;
  readonly workspaceRoot: string;
}): Promise<{ readonly sourcePaths: readonly string[]; readonly truncated: boolean }> {
  const corridor = new Set(options.importPath);
  const reservedSourcePaths = new Set(options.reservedSourcePaths);
  const sourcePaths = new Set(reservedSourcePaths);
  const expandedPaths = new Set<string>();
  const rootPath = options.importPath[0];
  if (rootPath === undefined) {
    return Object.freeze({ sourcePaths: Object.freeze([]), truncated: false });
  }
  const preferredPath = options.importPath.at(-1);
  const pending = [{ depth: 0, sourcePath: rootPath }];
  let truncated = false;
  while (pending.length > 0 && sourcePaths.size < MAXIMUM_PAGE_SUBTREE_FILES) {
    throwIfPreviewBuildCancelled(options.signal);
    const current = pending.pop();
    if (current === undefined || expandedPaths.has(current.sourcePath)) continue;
    expandedPaths.add(current.sourcePath);
    sourcePaths.add(current.sourcePath);
    if (current.depth >= MAXIMUM_PAGE_SUBTREE_DEPTH) {
      truncated = true;
      continue;
    }
    const sourceText = await options.readSource(current.sourcePath);
    if (sourceText === undefined) {
      truncated = true;
      continue;
    }
    // One-hop modules stay authentic; only cheap planner recursion stops outside explicit shells.
    if (
      reservedSourcePaths.has(current.sourcePath) &&
      !isExpandablePageShellSource(current.sourcePath)
    ) {
      continue;
    }
    const dynamicInventory = collectPreviewDynamicImportInventory(current.sourcePath, sourceText);
    const broadDynamicSpecifiers =
      dynamicInventory.truncated ||
      dynamicInventory.specifiers.length > MAXIMUM_FAST_DYNAMIC_IMPORTS
        ? new Set(dynamicInventory.specifiers)
        : undefined;
    const projectedRouteSpecifiers = sourceText.includes('import')
      ? collectPreviewStaticRouteProjectionInventory(current.sourcePath, sourceText)
          .projectionsBySpecifier
      : undefined;
    const sideEffectSpecifiers = new Set(
      [...sourceText.matchAll(/^\s*import\s*(["'])([^"'\r\n]+)\1\s*;?/gmu)].flatMap(
        (match) => match[2] ?? [],
      ),
    );
    const children = collectPreviewInspectorFastResolvedImports(
      current.sourcePath,
      sourceText,
      options.resolveModule,
      options.workspaceRoot,
      {
        ...(preferredPath === undefined ? {} : { preferredPath }),
        ...(options.selectedAuxiliaryRoot === undefined
          ? {}
          : { selectedAuxiliaryRoot: options.selectedAuxiliaryRoot }),
      },
    );
    for (const edge of [...children].reverse()) {
      const childPath = edge.childPath;
      if (
        expandedPaths.has(childPath) ||
        (broadDynamicSpecifiers?.has(edge.moduleSpecifier) === true && !corridor.has(childPath)) ||
        (projectedRouteSpecifiers?.has(edge.moduleSpecifier) === true &&
          !corridor.has(childPath)) ||
        (corridor.has(current.sourcePath) &&
          !corridor.has(childPath) &&
          /\.[cm]?[jt]sx$/iu.test(childPath) &&
          !reservedSourcePaths.has(childPath) &&
          !sideEffectSpecifiers.has(edge.moduleSpecifier)) ||
        (!corridor.has(childPath) && !isPageCompositionSource(childPath))
      ) {
        continue;
      }
      pending.push({ depth: current.depth + 1, sourcePath: childPath });
    }
  }
  if (pending.length > 0) truncated = true;
  return Object.freeze({ sourcePaths: Object.freeze([...sourcePaths]), truncated });
}

/** Result of removing an application-wide router that would defeat a target-first first paint. */
interface PreviewBoundedFastImportPath {
  /** Remaining page-local owner-to-target path. */
  readonly importPath: readonly string[];
  /** True when one or more application registry ancestors were deliberately deferred. */
  readonly trimmed: boolean;
}

/**
 * Drops high-fanout React Router registries from the fast path while retaining page-local owners.
 *
 * Static route tables often import every application page eagerly. Importing one such table makes
 * esbuild traverse the whole product even though the target path below it is already known. The
 * cutoff requires both explicit router syntax and more than 48 resolved authored imports, then
 * starts at the following proven corridor module. Exact/full enrichment remains unchanged.
 */
async function trimBroadRouteRegistryPrefix(options: {
  readonly importPath: readonly string[];
  readonly readSource: ReadPreviewInspectorSource;
  readonly resolveModule: ResolvePreviewRenderGraphModule;
  readonly selectedAuxiliaryRoot?: string;
  readonly signal?: AbortSignal;
  readonly workspaceRoot: string;
}): Promise<PreviewBoundedFastImportPath> {
  let lastBroadRouterIndex = -1;
  const preferredPath = options.importPath.at(-1);
  const corridorPaths = new Set(options.importPath.map((sourcePath) => path.normalize(sourcePath)));
  for (const [index, sourcePath] of options.importPath.entries()) {
    if (index >= options.importPath.length - 1) break;
    throwIfPreviewBuildCancelled(options.signal);
    const sourceText = await options.readSource(sourcePath);
    if (sourceText === undefined || !hasBroadRouteRegistrySyntax(sourceText)) continue;
    const importCount = collectPreviewInspectorFastResolvedImports(
      sourcePath,
      sourceText,
      options.resolveModule,
      options.workspaceRoot,
      {
        ...(preferredPath === undefined ? {} : { preferredPath }),
        ...(options.selectedAuxiliaryRoot === undefined
          ? {}
          : { selectedAuxiliaryRoot: options.selectedAuxiliaryRoot }),
      },
    ).length;
    const projection = analyzePreviewInspectorFastRouteRegistry({
      corridorPaths,
      isAdmittedSourcePath: (candidatePath) =>
        isProjectSourcePath(candidatePath, options.workspaceRoot),
      resolveModule: options.resolveModule,
      sourcePath,
      sourceText,
    });
    const isBroadRegistry =
      Math.max(importCount, projection.branchCount) > MAXIMUM_FAST_ROUTE_IMPORTS;
    if (isBroadRegistry && !projection.preservesAuthoredPrefix) lastBroadRouterIndex = index;
  }
  return lastBroadRouterIndex < 0
    ? Object.freeze({ importPath: options.importPath, trimmed: false })
    : Object.freeze({
        importPath: Object.freeze(options.importPath.slice(lastBroadRouterIndex + 1)),
        trimmed: true,
      });
}

/** Requires authored router construction evidence before import fanout can trim a path. */
function hasBroadRouteRegistrySyntax(sourceText: string): boolean {
  return (
    /<Route(?:\s|>)/u.test(sourceText) &&
    /\b(?:createBrowserRouter|createHashRouter|createMemoryRouter|createRoutesFromElements|RouterProvider)\b/u.test(
      sourceText,
    )
  );
}

/** Chooses the furthest page-like reverse owner when no conventional app entry reaches it. */
function selectProvisionalReversePath(
  documentPath: string,
  childByOwner: ReadonlyMap<string, string>,
): readonly string[] {
  const candidates = [...childByOwner.keys()].sort(
    (left, right) =>
      scoreProvisionalRoot(right) - scoreProvisionalRoot(left) || left.localeCompare(right),
  );
  for (const candidate of candidates) {
    const pathToTarget = [candidate];
    let current = candidate;
    let child = childByOwner.get(current);
    while (child !== undefined && !pathToTarget.includes(child)) {
      pathToTarget.push(child);
      current = child;
      child = childByOwner.get(current);
    }
    if (pathToTarget.at(-1) === documentPath) return pathToTarget;
  }
  return Object.freeze([documentPath]);
}

/** Lists direct source ancestors without walking unrelated descendant package trees. */
function collectSourceAncestorDirectories(
  startDirectory: string,
  projectRoot: string,
): readonly string[] {
  const directories: string[] = [];
  let current = path.normalize(startDirectory);
  const boundary = path.normalize(projectRoot);
  while (isPathInside(boundary, current)) {
    directories.push(current);
    if (current === boundary) break;
    const parent = path.dirname(current);
    if (parent === current) break;
    current = parent;
  }
  return Object.freeze(directories);
}

/** Semantic entry evidence comes from exact import/call analysis, never from filenames alone. */
function hasSemanticReactEntry(sourcePath: string, sourceText: string): boolean {
  return (
    sourceText.includes('react-dom') &&
    analyzePreviewRenderSource(sourcePath, sourceText).entryEvidence.length > 0
  );
}

/** Keeps direct page composition broad enough for headers/sidebar components but excludes helpers. */
function isPageCompositionSource(sourcePath: string): boolean {
  const portablePath = normalizePortablePath(sourcePath);
  return (
    /\.[cm]?[jt]sx$/iu.test(sourcePath) ||
    PAGE_SHELL_FILE_PATTERN.test(path.basename(sourcePath)) ||
    /(?:^|\/)(?:app|components?|layouts?|pages?|routes?|screens?|shells?|views?)(?:\/|$)/iu.test(
      portablePath,
    )
  );
}

/** Allows bounded legacy recursion only through explicitly named page/layout/shell composition. */
function isExpandablePageShellSource(sourcePath: string): boolean {
  const portablePath = normalizePortablePath(sourcePath);
  return (
    PAGE_SHELL_FILE_PATTERN.test(path.basename(sourcePath)) ||
    /(?:^|\/)(?:layouts?|shells?)(?:\/|$)/u.test(portablePath)
  );
}

/** Conventional filenames only seed traversal; later resolved imports prove every relationship. */
function isLikelyEntryPath(sourcePath: string, projectRoot: string): boolean {
  return (
    ENTRY_FILE_PATTERN.test(path.basename(sourcePath)) &&
    !isPreviewInspectorFastAuxiliarySourcePath(sourcePath, projectRoot)
  );
}

/** Entry ranking favors semantic conventions at shallow source roots and demotes auxiliaries. */
function scoreEntryPath(sourcePath: string): number {
  const portablePath = normalizePortablePath(sourcePath);
  const fileName = path.basename(sourcePath).toLowerCase();
  let score = /^(?:main|index)\.[cm]?[jt]sx?$/u.test(fileName) ? 500 : 300;
  if (/\/src\/[^/]+$/u.test(portablePath)) score += 300;
  if (fileName.startsWith('app.')) score += 100;
  return score - portablePath.split('/').length;
}

/** Reverse candidates prioritize page/layout/barrel owners near the active frontier. */
function scoreReverseCandidate(candidatePath: string, frontierPath: string): number {
  const fileName = path.basename(candidatePath);
  let score = PAGE_SHELL_FILE_PATTERN.test(fileName) ? 500 : 0;
  if (/^index\.[cm]?[jt]sx?$/iu.test(fileName)) score += 300;
  if (path.dirname(candidatePath) === path.dirname(frontierPath)) score += 100;
  return score - path.relative(path.dirname(frontierPath), candidatePath).split(path.sep).length;
}

/** Provisional roots prefer explicit page shells, then owners farther above the target directory. */
function scoreProvisionalRoot(sourcePath: string): number {
  return (
    (PAGE_SHELL_FILE_PATTERN.test(path.basename(sourcePath)) ? 1_000 : 0) -
    normalizePortablePath(sourcePath).split('/').length
  );
}

/** Rejects generated/build directories before any source read occurs. */
function isTraversableDirectory(directoryName: string): boolean {
  return (
    directoryName !== 'node_modules' &&
    !directoryName.startsWith('.') &&
    !/^(?:__tests__|tests?|stories?|storybook|examples?|demos?|fixtures?|mocks?|generated|dist|build|coverage)$/iu.test(
      directoryName,
    )
  );
}

/** Reads one directory fail-closed because disappearing hot-reload paths are ordinary. */
async function readDirectory(directoryPath: string): Promise<readonly Dirent[]> {
  try {
    return await readdir(directoryPath, { withFileTypes: true });
  } catch {
    return [];
  }
}

/** Confines traversal to authored JS/TS source below the trusted workspace. */
function isProjectSourcePath(sourcePath: string, workspaceRoot: string): boolean {
  const portablePath = normalizePortableRelativePath(workspaceRoot, sourcePath);
  return (
    SOURCE_FILE_PATTERN.test(sourcePath) &&
    isPathInside(workspaceRoot, sourcePath) &&
    !/(?:^|\/)(?:node_modules|\.yarn|\.pnpm)(?:\/|$)/u.test(portablePath)
  );
}

/**
 * Keeps normal tooling demotion while admitting only the selected example/demo subtree.
 *
 * The exact subtree is safe because every retained relationship still requires a resolved import
 * edge to the selected leaf. Sibling galleries remain excluded and cannot consume first-paint
 * traversal budgets.
 */
function isAdmittedSourcePath(
  sourcePath: string,
  workspaceRoot: string,
  selectedAuxiliaryRoot: string | undefined,
): boolean {
  return (
    !isPreviewInspectorFastAuxiliarySourcePath(sourcePath, workspaceRoot) ||
    (selectedAuxiliaryRoot !== undefined &&
      isPathInside(path.resolve(selectedAuxiliaryRoot), path.resolve(sourcePath)))
  );
}

/** Segment-aware containment prevents sibling path prefixes from crossing a trusted boundary. */
function isPathInside(rootPath: string, candidatePath: string): boolean {
  const relativePath = path.relative(path.resolve(rootPath), path.resolve(candidatePath));
  return (
    relativePath.length === 0 ||
    (relativePath !== '..' &&
      !relativePath.startsWith(`..${path.sep}`) &&
      !path.isAbsolute(relativePath))
  );
}

/** Normalizes matching-only paths without changing their filesystem identity. */
function normalizePortablePath(sourcePath: string): string {
  return sourcePath.replaceAll('\\', '/').toLowerCase();
}

/** Produces one workspace-relative path for semantic segment tests. */
function normalizePortableRelativePath(rootPath: string, sourcePath: string): string {
  return normalizePortablePath(path.relative(path.resolve(rootPath), path.resolve(sourcePath)));
}
