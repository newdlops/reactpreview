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
import {
  analyzePreviewRenderSource,
  collectPreviewRenderModuleSpecifiers,
} from '../renderGraph/previewRenderSourceAnalysis';
import type { ResolvePreviewRenderGraphModule } from '../renderGraph/previewRenderGraphTypes';
import { collectPreviewDynamicImportInventory } from '../staticResources/previewDynamicImportInventory';
import type { ReadPreviewInspectorSource } from './previewInspectorAncestorTypes';
import {
  collectPreviewInspectorAuxiliaryNextAppRoute,
  findPreviewInspectorSelectedAuxiliaryRoot,
} from './previewInspectorAuxiliaryNextAppRoute';

const MAXIMUM_ENTRY_DIRECTORIES = 96;
const MAXIMUM_ENTRY_FILES = 96;
const MAXIMUM_REVERSE_DEPTH = 8;
const MAXIMUM_REVERSE_DIRECTORIES = 48;
const MAXIMUM_FILES_PER_REVERSE_DIRECTORY = 192;
const MAXIMUM_REVERSE_FILES = 640;
const MAXIMUM_FORWARD_FILES = 768;
const MAXIMUM_FORWARD_DEPTH = 48;
const MAXIMUM_IMPORTS_PER_FILE = 256;
const MAXIMUM_PAGE_SUBTREE_FILES = 128;
const MAXIMUM_PAGE_SUBTREE_DEPTH = 8;
const MAXIMUM_FAST_DYNAMIC_IMPORTS = 8;
const MAXIMUM_FAST_ROUTE_IMPORTS = 48;
const MAXIMUM_TARGET_AFFINE_IMPORTS = 96;
const MAXIMUM_AFFINITY_MATCHED_IMPORTS = 24;
const MAXIMUM_TOTAL_SOURCE_BYTES = 16 * 1024 * 1024;
const SOURCE_FILE_PATTERN = /\.[cm]?[jt]sx?$/iu;
const ENTRY_FILE_PATTERN =
  /^(?:app|bootstrap|client|entry|index|init|main|mount|render|renderer|root|start)(?:[-_.].*)?\.[cm]?[jt]sx?$/iu;
const PAGE_SHELL_FILE_PATTERN =
  /(?:^|[-_.])(?:app|layout|page|route|router|screen|shell|template|view)(?:[-_.]|$)/iu;
const AUXILIARY_PATH_PATTERN =
  /(?:^|\/)(?:__tests__|tests?|stories?|storybook|examples?|demos?|fixtures?|mocks?|playgrounds?|sandboxes?|generated|dist|build|coverage)(?:\/|$)|\.(?:stories?|spec|test)\.[cm]?[jt]sx?$/iu;

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
  /** Corridor plus bounded JSX-oriented page subtree evidence. */
  readonly sourcePaths: readonly string[];
  /** Honest budget marker used by tests and future diagnostics. */
  readonly truncated: boolean;
}

/** One forward graph queue item, retaining its originating app-root evidence. */
interface ForwardCandidate {
  readonly depth: number;
  readonly rootPath: string;
  readonly semanticEntry: boolean;
  readonly sourcePath: string;
}

/** One target-side reverse frontier with the child it directly imports. */
interface ReverseFrontier {
  readonly depth: number;
  readonly sourcePath: string;
}

/** One resolved import edge retained without TypeScript nodes. */
interface ResolvedImportEdge {
  readonly childPath: string;
  /** Authored literal retained so broad dynamic registries can be pruned before extra resolution. */
  readonly moduleSpecifier: string;
  readonly ownerPath: string;
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

  const sourceReader = createBoundedSourceReader(options.readSource);
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
    readSource: sourceReader,
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
    readSource: sourceReader,
    resolveModule: options.resolveModule,
    reverseChildByOwner: reverse.childByOwner,
    reversePaths: reverse.paths,
    ...(options.signal === undefined ? {} : { signal: options.signal }),
    ...(selectedAuxiliaryRoot === undefined ? {} : { selectedAuxiliaryRoot }),
    workspaceRoot,
  });
  const importPath =
    forward?.importPath ?? selectProvisionalReversePath(documentPath, reverse.childByOwner);
  if (importPath.length < 2) return undefined;

  const boundedPath = await trimBroadRouteRegistryPrefix({
    importPath,
    readSource: sourceReader,
    resolveModule: options.resolveModule,
    ...(options.signal === undefined ? {} : { signal: options.signal }),
    ...(selectedAuxiliaryRoot === undefined ? {} : { selectedAuxiliaryRoot }),
    workspaceRoot,
  });
  // A central router that imports the selected component directly has no cheap authored shell
  // below it. Returning no plan lets the compiler use its existing direct-target first paint;
  // full enrichment may still restore the complete application router in the background.
  if (boundedPath.importPath.length < 2) return undefined;

  const subtree = await collectPageSubtree({
    importPath: boundedPath.importPath,
    readSource: sourceReader,
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
  readonly truncated: boolean;
}> {
  const paths = new Set<string>([options.documentPath]);
  const childByOwner = new Map<string, string>();
  const pending: ReverseFrontier[] = [{ depth: 0, sourcePath: options.documentPath }];
  const scannedDirectories = new Set<string>();
  const readCandidates = new Set<string>();
  const edgesByCandidate = new Map<string, readonly ResolvedImportEdge[]>();
  let truncated = false;

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
          edges = collectResolvedImports(
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
        for (const edge of edges) {
          if (!paths.has(edge.childPath) || paths.has(edge.ownerPath)) continue;
          paths.add(edge.ownerPath);
          childByOwner.set(edge.ownerPath, edge.childPath);
          pending.push({ depth: frontier.depth + 1, sourcePath: edge.ownerPath });
          break;
        }
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
        edges = collectResolvedImports(
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
      for (const edge of edges) {
        if (!paths.has(edge.childPath) || paths.has(edge.ownerPath)) continue;
        paths.add(edge.ownerPath);
        childByOwner.set(edge.ownerPath, edge.childPath);
        pending.push({ depth: frontier.depth + 1, sourcePath: edge.ownerPath });
        break;
      }
    }
  }
  return Object.freeze({ childByOwner, paths, truncated });
}

/** Walks imports from shallow app entries and stops at the first target-side meeting point. */
async function findForwardMeeting(options: {
  readonly documentPath: string;
  readonly entryPaths: readonly string[];
  readonly readSource: ReadPreviewInspectorSource;
  readonly resolveModule: ResolvePreviewRenderGraphModule;
  readonly reverseChildByOwner: ReadonlyMap<string, string>;
  readonly reversePaths: ReadonlySet<string>;
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
  const pending: ForwardCandidate[] = [];
  const parentByPath = new Map<string, string>();
  const visited = new Set<string>();
  const sourceByEntry = new Map<string, string>();
  let truncated = false;
  for (const entryPath of options.entryPaths) {
    const sourceText = await options.readSource(entryPath);
    if (sourceText === undefined) continue;
    sourceByEntry.set(entryPath, sourceText);
    pending.push({
      depth: 0,
      rootPath: entryPath,
      semanticEntry: hasSemanticReactEntry(entryPath, sourceText),
      sourcePath: entryPath,
    });
  }
  pending.sort(compareForwardCandidates);

  while (pending.length > 0 && visited.size < MAXIMUM_FORWARD_FILES) {
    throwIfPreviewBuildCancelled(options.signal);
    const current = pending.shift();
    if (current === undefined || visited.has(current.sourcePath)) continue;
    visited.add(current.sourcePath);
    if (options.reversePaths.has(current.sourcePath)) {
      return Object.freeze({
        importPath: Object.freeze(
          joinForwardAndReversePaths(
            current.sourcePath,
            current.rootPath,
            parentByPath,
            options.reverseChildByOwner,
          ),
        ),
        semanticEntry: current.semanticEntry,
        truncated,
      });
    }
    if (current.depth >= MAXIMUM_FORWARD_DEPTH) {
      truncated = true;
      continue;
    }
    const sourceText =
      sourceByEntry.get(current.sourcePath) ?? (await options.readSource(current.sourcePath));
    if (sourceText === undefined) continue;
    const edges = collectResolvedImports(
      current.sourcePath,
      sourceText,
      options.resolveModule,
      options.workspaceRoot,
      {
        preferredPath: options.documentPath,
        ...(options.selectedAuxiliaryRoot === undefined
          ? {}
          : { selectedAuxiliaryRoot: options.selectedAuxiliaryRoot }),
      },
    );
    if (edges.length > MAXIMUM_IMPORTS_PER_FILE) truncated = true;
    for (const edge of edges.slice(0, MAXIMUM_IMPORTS_PER_FILE)) {
      if (visited.has(edge.childPath)) continue;
      if (!parentByPath.has(edge.childPath)) parentByPath.set(edge.childPath, current.sourcePath);
      pending.push({
        depth: current.depth + 1,
        rootPath: current.rootPath,
        semanticEntry: current.semanticEntry,
        sourcePath: edge.childPath,
      });
    }
    pending.sort(compareForwardCandidates);
  }
  if (pending.length > 0) truncated = true;
  return undefined;
}

/** Adds static JSX-facing dependencies around the selected page root with a strict DFS budget. */
async function collectPageSubtree(options: {
  readonly importPath: readonly string[];
  readonly readSource: ReadPreviewInspectorSource;
  readonly resolveModule: ResolvePreviewRenderGraphModule;
  readonly selectedAuxiliaryRoot?: string;
  readonly signal?: AbortSignal;
  readonly workspaceRoot: string;
}): Promise<{ readonly sourcePaths: readonly string[]; readonly truncated: boolean }> {
  const corridor = new Set(options.importPath);
  const sourcePaths = new Set<string>();
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
    if (current === undefined || sourcePaths.has(current.sourcePath)) continue;
    sourcePaths.add(current.sourcePath);
    if (current.depth >= MAXIMUM_PAGE_SUBTREE_DEPTH) {
      truncated = true;
      continue;
    }
    const sourceText = await options.readSource(current.sourcePath);
    if (sourceText === undefined) continue;
    const dynamicInventory = collectPreviewDynamicImportInventory(current.sourcePath, sourceText);
    const broadDynamicSpecifiers =
      dynamicInventory.truncated ||
      dynamicInventory.specifiers.length > MAXIMUM_FAST_DYNAMIC_IMPORTS
        ? new Set(dynamicInventory.specifiers)
        : undefined;
    const children = collectResolvedImports(
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
        sourcePaths.has(childPath) ||
        (broadDynamicSpecifiers?.has(edge.moduleSpecifier) === true && !corridor.has(childPath)) ||
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
  for (const [index, sourcePath] of options.importPath.entries()) {
    if (index >= options.importPath.length - 1) break;
    throwIfPreviewBuildCancelled(options.signal);
    const sourceText = await options.readSource(sourcePath);
    if (sourceText === undefined || !hasBroadRouteRegistrySyntax(sourceText)) continue;
    const importCount = collectResolvedImports(
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
    if (importCount > MAXIMUM_FAST_ROUTE_IMPORTS) lastBroadRouterIndex = index;
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

/** Resolves literal imports and rejects dependencies outside the trusted authored workspace. */
function collectResolvedImports(
  ownerPath: string,
  sourceText: string,
  resolveModule: ResolvePreviewRenderGraphModule,
  workspaceRoot: string,
  options: {
    readonly preferredPath?: string;
    readonly selectedAuxiliaryRoot?: string;
  } = {},
): readonly ResolvedImportEdge[] {
  const edges: ResolvedImportEdge[] = [];
  const seen = new Set<string>();
  const specifiers = [...collectPreviewRenderModuleSpecifiers(ownerPath, sourceText)].sort(
    (left, right) =>
      scoreModuleSpecifierAffinity(options.preferredPath, right) -
        scoreModuleSpecifierAffinity(options.preferredPath, left) || left.localeCompare(right),
  );
  const highestAffinity = scoreModuleSpecifierAffinity(options.preferredPath, specifiers[0] ?? '');
  const maximumSpecifiers =
    highestAffinity > 0 ? MAXIMUM_AFFINITY_MATCHED_IMPORTS : MAXIMUM_TARGET_AFFINE_IMPORTS;
  for (const specifier of specifiers.slice(0, maximumSpecifiers)) {
    const resolvedPath = resolveModule(specifier, ownerPath);
    if (resolvedPath === undefined) continue;
    const childPath = path.normalize(resolvedPath);
    if (
      seen.has(childPath) ||
      !isProjectSourcePath(childPath, workspaceRoot) ||
      !isAdmittedSourcePath(childPath, workspaceRoot, options.selectedAuxiliaryRoot)
    ) {
      continue;
    }
    seen.add(childPath);
    edges.push(
      Object.freeze({
        childPath,
        moduleSpecifier: specifier,
        ownerPath: path.normalize(ownerPath),
      }),
    );
  }
  return Object.freeze(edges);
}

/**
 * Ranks literal imports before the resolver is called so a generated lazy registry remains cheap.
 *
 * Only lexical path suffixes participate: the target basename is strongest, followed by matching
 * parent segments. Unrelated specifiers preserve deterministic lexical order and are cut off before
 * thousands of sibling examples can trigger resolver work.
 */
function scoreModuleSpecifierAffinity(
  preferredPath: string | undefined,
  moduleSpecifier: string,
): number {
  if (preferredPath === undefined) return 0;
  const targetSegments = normalizePortablePath(preferredPath)
    .replace(SOURCE_FILE_PATTERN, '')
    .split('/')
    .filter(Boolean);
  const specifierSegments = normalizePortablePath(moduleSpecifier)
    .replace(SOURCE_FILE_PATTERN, '')
    .split('/')
    .filter((segment) => segment.length > 0 && segment !== '.' && segment !== '..');
  let suffixMatches = 0;
  while (
    suffixMatches < targetSegments.length &&
    suffixMatches < specifierSegments.length &&
    targetSegments.at(-1 - suffixMatches) === specifierSegments.at(-1 - suffixMatches)
  ) {
    suffixMatches += 1;
  }
  const basenameMatch =
    targetSegments.at(-1) !== undefined && targetSegments.at(-1) === specifierSegments.at(-1);
  return Number(basenameMatch) * 10_000 + suffixMatches * 1_000;
}

/** Reconstructs one root-to-meeting path and appends the reverse meeting-to-target chain. */
function joinForwardAndReversePaths(
  meetingPath: string,
  rootPath: string,
  parentByPath: ReadonlyMap<string, string>,
  childByOwner: ReadonlyMap<string, string>,
): readonly string[] {
  const forward = [meetingPath];
  let current = meetingPath;
  while (current !== rootPath) {
    const parent = parentByPath.get(current);
    if (parent === undefined || forward.includes(parent)) break;
    forward.push(parent);
    current = parent;
  }
  forward.reverse();
  const result = [...forward];
  current = meetingPath;
  let child = childByOwner.get(current);
  while (child !== undefined && !result.includes(child)) {
    result.push(child);
    current = child;
    child = childByOwner.get(current);
  }
  return result;
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

/** Memoizes source text and enforces one aggregate limit across both graph directions and DFS. */
function createBoundedSourceReader(
  readSource: ReadPreviewInspectorSource,
): ReadPreviewInspectorSource {
  const sourceByPath = new Map<string, Promise<string | undefined>>();
  let admittedBytes = 0;
  return (sourcePath) => {
    const normalizedPath = path.normalize(sourcePath);
    const cached = sourceByPath.get(normalizedPath);
    if (cached !== undefined) return cached;
    const pending = readSource(normalizedPath).then((sourceText) => {
      if (sourceText === undefined) return undefined;
      const byteLength = Buffer.byteLength(sourceText, 'utf8');
      if (admittedBytes + byteLength > MAXIMUM_TOTAL_SOURCE_BYTES) return undefined;
      admittedBytes += byteLength;
      return sourceText;
    });
    sourceByPath.set(normalizedPath, pending);
    return pending;
  };
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

/** Conventional filenames only seed traversal; later resolved imports prove every relationship. */
function isLikelyEntryPath(sourcePath: string, projectRoot: string): boolean {
  return (
    ENTRY_FILE_PATTERN.test(path.basename(sourcePath)) &&
    !isAuxiliarySourcePath(sourcePath, projectRoot)
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

/** Forward traversal processes semantic entries, shallow nodes, and page shells first. */
function compareForwardCandidates(left: ForwardCandidate, right: ForwardCandidate): number {
  return (
    Number(right.semanticEntry) - Number(left.semanticEntry) ||
    left.depth - right.depth ||
    Number(PAGE_SHELL_FILE_PATTERN.test(path.basename(right.sourcePath))) -
      Number(PAGE_SHELL_FILE_PATTERN.test(path.basename(left.sourcePath))) ||
    left.sourcePath.localeCompare(right.sourcePath)
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

/** Applies tooling-path demotion only inside this workspace, never to an ancestor directory name. */
function isAuxiliarySourcePath(sourcePath: string, workspaceRoot: string): boolean {
  return AUXILIARY_PATH_PATTERN.test(normalizePortableRelativePath(workspaceRoot, sourcePath));
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
    !isAuxiliarySourcePath(sourcePath, workspaceRoot) ||
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
