/** Coordinates FastPageCorridor using bounded authored-source evidence. */
import path from 'node:path';
import { throwIfPreviewBuildCancelled } from '../../../domain/previewBuildExecution';
import {
  collectPreviewInspectorAuxiliaryNextAppRoute,
  findPreviewInspectorSelectedAuxiliaryRoot,
} from './previewInspectorAuxiliaryNextAppRoute';
import {
  collectPageSubtree,
  findForwardMeeting,
  trimBroadRouteRegistryPrefix,
} from './previewInspectorFastCorridorForward';
import {
  type CollectPreviewInspectorFastPageCorridorOptions,
  type PreviewInspectorFastPageCorridor,
  MAXIMUM_ENTRY_DIRECTORIES,
  MAXIMUM_ENTRY_FILES,
  MAXIMUM_ONE_HOP_CONTEXT_FILES,
} from './previewInspectorFastCorridorModel';
import {
  isLikelyEntryPath,
  isPathInside,
  isProjectSourcePath,
  isTraversableDirectory,
  readDirectory,
  scoreEntryPath,
  selectProvisionalReversePath,
} from './previewInspectorFastCorridorPaths';
import { collectReverseClosure } from './previewInspectorFastCorridorReverse';
import {
  schedulePreviewInspectorFastReverseCandidatePaths,
  createPreviewInspectorFastPageCandidateIndex,
} from './previewInspectorFastPageCandidates';
import { createPreviewInspectorFastSourceReaders } from './previewInspectorFastSourceReaders';
import { collectPreviewInspectorNextAppLayoutChain } from './previewInspectorNextAppLayoutChain';
import { collectPreviewInspectorOneHopContext } from './previewInspectorOneHopContext';

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
  const pageCandidateIndex = createPreviewInspectorFastPageCandidateIndex(
    snapshotPaths,
    projectRoot,
  );
  const pageConsumerPaths = pageCandidateIndex.selectPageConsumers(documentPath);
  const reverseProbePaths = pageCandidateIndex.selectReverseProbes(documentPath);
  const selectedPageConsumerPaths = [
    ...new Set([...(auxiliaryRoute?.pagePaths ?? []), ...pageConsumerPaths]),
  ];
  const reverseCandidatePaths = schedulePreviewInspectorFastReverseCandidatePaths(
    reverseProbePaths,
    selectedPageConsumerPaths,
  );
  const entryPaths = await collectLikelyEntryPaths({
    documentPath,
    projectRoot,
    ...(options.signal === undefined ? {} : { signal: options.signal }),
    snapshotPaths,
  });
  throwIfPreviewBuildCancelled(options.signal);

  const reverse = await collectReverseClosure({
    pageCandidateIndex,
    documentPath,
    projectRoot,
    readSource: sourceReaders.reverse,
    resolveModule: options.resolveModule,
    ...(options.signal === undefined ? {} : { signal: options.signal }),
    snapshotPaths,
    ...(selectedAuxiliaryRoot === undefined ? {} : { selectedAuxiliaryRoot }),
    selectedPageConsumerPaths,
    ...(options.targetExportName === undefined
      ? {}
      : { targetExportName: options.targetExportName }),
    targetedPagePaths: reverseCandidatePaths,
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
    forward?.importPath ??
    selectProvisionalReversePath(documentPath, reverse.childByOwner, reverse.pageProvenancePaths);
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
  const nextAppShell =
    nextAppPagePath === undefined
      ? undefined
      : collectPreviewInspectorNextAppLayoutChain({
          exportName: 'default',
          pagePath: nextAppPagePath,
          sourcePaths: snapshotPaths,
        });
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
          /*
           * The shortest meeting path determines first-paint ordering, but it is not the only
           * authored page that may consume the selected component. Preserve the complete bounded
           * reverse closure and every discovered semantic entry so the ordinary render planner can
           * produce independently selectable VirtualPages for sibling consumers.
           */
          ...reverse.paths,
          ...(forward?.semanticEntryPaths ?? []),
          ...subtree.sourcePaths,
          ...(auxiliaryRoute?.sourcePaths ?? []),
          /*
           * App Router layouts are filesystem-owned parents and therefore never appear in the
           * page's JavaScript import corridor. Retain only the convention-proven chain from the
           * already available package inventory so critical first paint imports the same global
           * CSS, Tailwind theme, document sizing, and nested layout wrappers as full enrichment.
           */
          ...(nextAppShell?.layouts.map((layout) => layout.sourcePath) ?? []),
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
export type {
  CollectPreviewInspectorFastPageCorridorOptions,
  PreviewInspectorFastPageCorridor,
} from './previewInspectorFastCorridorModel';
