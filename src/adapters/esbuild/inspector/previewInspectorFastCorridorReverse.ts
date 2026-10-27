/** Finds reverse authored import closure under deterministic read budgets. */
import path from 'node:path';
import ts from 'typescript';
import { throwIfPreviewBuildCancelled } from '../../../domain/previewBuildExecution';
import { analyzePreviewLocalParentSlices, createPreviewParentSlicePlan } from '../parentSlice';
import type { ResolvePreviewRenderGraphModule } from '../renderGraph/previewRenderGraphTypes';
import { collectPreviewDynamicImportInventory } from '../staticResources/previewDynamicImportInventory';
import type { ReadPreviewInspectorSource } from './previewInspectorAncestorTypes';
import {
  MAXIMUM_DYNAMIC_REVERSE_PATHS_PER_PIVOT,
  MAXIMUM_DYNAMIC_REVERSE_PIVOTS,
  MAXIMUM_FILES_PER_REVERSE_DIRECTORY,
  MAXIMUM_REVERSE_DIRECTORIES,
  MAXIMUM_REVERSE_FILES,
  MAXIMUM_TARGETED_REVERSE_FILES,
  MINIMUM_TARGETED_REVERSE_FILES,
  PAGE_SHELL_FILE_PATTERN,
  SOURCE_FILE_PATTERN,
  TARGETED_REVERSE_READ_BATCH_SIZE,
  type ReverseFrontier,
} from './previewInspectorFastCorridorModel';
import {
  collectSourceAncestorDirectories,
  isAdmittedSourcePath,
  isPathInside,
  readDirectory,
  scoreReverseCandidate,
} from './previewInspectorFastCorridorPaths';
import {
  selectPreviewInspectorFastReverseProbePaths,
  schedulePreviewInspectorFastReverseCandidatePaths,
  selectPreviewInspectorFastPageConsumerPaths,
  type PreviewInspectorFastPageCandidateIndex,
} from './previewInspectorFastPageCandidates';
import {
  collectPreviewInspectorFastResolvedImports,
  type PreviewInspectorFastResolvedImportEdge,
} from './previewInspectorFastResolvedImports';
import {
  analyzePreviewInspectorFastSemanticImports,
  arePreviewInspectorFastExportDemandsCompatible,
  type PreviewInspectorFastSemanticImport,
} from './previewInspectorFastSemanticImports';
import { collectPreviewInspectorRouteFactoryLocalExports } from './previewInspectorRouteFactoryLocalExports';
import { createPreviewInspectorStableMinPriorityQueue } from './previewInspectorStableMinPriorityQueue';

const MAXIMUM_CONCURRENT_DIRECTORY_SOURCE_READS = 8;

/** Builds a target-to-owner closure by reading only files beside the target and its ancestors. */
export async function collectReverseClosure(options: {
  readonly pageCandidateIndex?: PreviewInspectorFastPageCandidateIndex;
  readonly documentPath: string;
  readonly projectRoot: string;
  readonly readSource: ReadPreviewInspectorSource;
  readonly resolveModule: ResolvePreviewRenderGraphModule;
  readonly selectedAuxiliaryRoot?: string;
  readonly signal?: AbortSignal;
  readonly snapshotPaths: readonly string[];
  readonly targetExportName?: string;
  readonly selectedPageConsumerPaths: readonly string[];
  readonly targetedPagePaths: readonly string[];
  readonly workspaceRoot: string;
}): Promise<{
  readonly childByOwner: ReadonlyMap<string, string>;
  readonly pageProvenancePaths: ReadonlySet<string>;
  readonly paths: ReadonlySet<string>;
  readonly requiredExportsByPath: ReadonlyMap<string, readonly string[]>;
  readonly truncated: boolean;
}> {
  const paths = new Set<string>([options.documentPath]);
  const childByOwner = new Map<string, string>();
  const pageProvenancePaths = new Set<string>();
  const selectedPageConsumerPaths = new Set(
    options.selectedPageConsumerPaths.map((sourcePath) => path.normalize(sourcePath)),
  );
  const depthByPath = new Map<string, number>([[options.documentPath, 0]]);
  const pending = createPreviewInspectorStableMinPriorityQueue<ReverseFrontier>(
    [{ depth: 0, sourcePath: options.documentPath }],
    (left, right) => left.depth - right.depth,
  );
  const scannedDirectories = new Set<string>();
  const readCandidates = new Set<string>();
  const edgesByCandidate = new Map<string, readonly PreviewInspectorFastResolvedImportEdge[]>();
  const indexedCandidates = new Set<string>();
  const ownersByChildPath = new Map<string, PreviewInspectorFastResolvedImportEdge[]>();
  const requiredTargetExports = await collectFastLocalTargetExportDemands({
    documentPath: options.documentPath,
    readSource: options.readSource,
    ...(options.targetExportName === undefined
      ? {}
      : { targetExportName: options.targetExportName }),
  });
  const requiredExportsByPath = new Map<string, readonly string[]>([
    [options.documentPath, requiredTargetExports],
  ]);
  const semanticEdgesByCandidate = new Map<
    string,
    ReturnType<typeof analyzePreviewInspectorFastSemanticImports>
  >();
  const sourceTextByCandidate = new Map<string, string>();
  const pendingDynamicPivots = new Set<string>();
  const scheduledDynamicPivots = new Set<string>();
  const promotedDynamicPaths = new Set<string>();
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
    if (childDepth === undefined) return;
    const semanticEdge = readSemanticEdge(edge);
    const exactPageConsumer = selectedPageConsumerPaths.has(edge.ownerPath);
    const auxiliaryDynamicCarrier = isExactAuxiliaryDynamicCarrier(
      edge,
      options.selectedAuxiliaryRoot,
      sourceTextByCandidate.get(edge.ownerPath),
    );
    if (
      semanticEdge === undefined ||
      (semanticEdge.renderStrength < 1 && !exactPageConsumer && !auxiliaryDynamicCarrier) ||
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
    if (
      exactPageConsumer ||
      isLikelyProvisionalPageOwnerPath(edge.ownerPath, options.projectRoot)
    ) {
      pageProvenancePaths.add(edge.ownerPath);
    }
    depthByPath.set(edge.ownerPath, ownerDepth);
    childByOwner.set(edge.ownerPath, edge.childPath);
    requiredExportsByPath.set(edge.ownerPath, semanticEdge.ownerExportNames);
    pending.push({ depth: ownerDepth, sourcePath: edge.ownerPath });
    if (!scheduledDynamicPivots.has(edge.ownerPath)) pendingDynamicPivots.add(edge.ownerPath);
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

  /** Gives each closest discovered consumer a turn inside the unchanged six-pivot ceiling. */
  const promoteNextDynamicPivot = (): readonly string[] => {
    if (scheduledDynamicPivots.size >= MAXIMUM_DYNAMIC_REVERSE_PIVOTS) return [];
    const pivotPath = [...pendingDynamicPivots].sort(
      (left, right) => (depthByPath.get(left) ?? 0) - (depthByPath.get(right) ?? 0),
    )[0];
    if (pivotPath === undefined) return [];
    pendingDynamicPivots.delete(pivotPath);
    scheduledDynamicPivots.add(pivotPath);
    const reverseProbePaths =
      options.pageCandidateIndex?.selectReverseProbes(pivotPath) ??
      selectPreviewInspectorFastReverseProbePaths(
        options.snapshotPaths,
        options.projectRoot,
        pivotPath,
      );
    const pageConsumerPaths =
      options.pageCandidateIndex?.selectPageConsumers(pivotPath) ??
      selectPreviewInspectorFastPageConsumerPaths(
        options.snapshotPaths,
        options.projectRoot,
        pivotPath,
      );
    const probePaths = schedulePreviewInspectorFastReverseCandidatePaths(
      reverseProbePaths,
      pageConsumerPaths,
    );
    const promoted: string[] = [];
    for (const candidatePath of probePaths.slice(0, MAXIMUM_DYNAMIC_REVERSE_PATHS_PER_PIVOT)) {
      if (
        candidatePath === options.documentPath ||
        readCandidates.has(candidatePath) ||
        promotedDynamicPaths.has(candidatePath)
      )
        continue;
      promotedDynamicPaths.add(candidatePath);
      promoted.push(candidatePath);
    }
    return promoted;
  };

  /*
   * Page-shaped paths come from a cached identity-only inventory and are already ranked by target
   * affinity. Index them before nearby directory scanning can consume the read budget; this is what
   * lets one shared component retain several authored page owners in distant feature folders.
   */
  const targetedPagePaths = [...options.targetedPagePaths];
  const promotedPagePaths: string[] = [];
  let targetedOffset = 0;
  let promotedOffset = 0;
  let preferPromotedCandidates = false;
  targetedCandidates: while (
    targetedOffset < targetedPagePaths.length ||
    promotedOffset < promotedPagePaths.length
  ) {
    const hasPageProvenance = pageProvenancePaths.size > 0;
    const targetedLimit = hasPageProvenance
      ? MINIMUM_TARGETED_REVERSE_FILES
      : MAXIMUM_TARGETED_REVERSE_FILES;
    if (readCandidates.size >= targetedLimit) {
      truncated = true;
      break;
    }
    // A discovered owner may promote many nearby files. Alternate complete batches so those
    // descendants cannot displace every remaining original consumer before the read ceiling.
    const usePromotedCandidates: boolean =
      promotedOffset < promotedPagePaths.length &&
      (targetedOffset >= targetedPagePaths.length || preferPromotedCandidates);
    const candidates = usePromotedCandidates ? promotedPagePaths : targetedPagePaths;
    const offset = usePromotedCandidates ? promotedOffset : targetedOffset;
    const rawBatch = candidates.slice(
      offset,
      offset + Math.min(TARGETED_REVERSE_READ_BATCH_SIZE, targetedLimit - readCandidates.size),
    );
    const batchPaths = rawBatch.filter((candidatePath) => !readCandidates.has(candidatePath));
    if (usePromotedCandidates) promotedOffset += rawBatch.length;
    else targetedOffset += rawBatch.length;
    preferPromotedCandidates = !usePromotedCandidates;
    const batch = await Promise.all(
      batchPaths.map(async (candidatePath) => ({
        candidatePath,
        sourceText: await options.readSource(candidatePath),
      })),
    );
    for (const { candidatePath, sourceText } of batch) {
      readCandidates.add(candidatePath);
      if (sourceText === undefined) continue;
      sourceTextByCandidate.set(candidatePath, sourceText);
      const edges = collectPreviewInspectorFastResolvedImports(
        candidatePath,
        sourceText,
        options.resolveModule,
        options.workspaceRoot,
        {
          preferredPath: options.documentPath,
          requiredSourcePath: options.documentPath,
          ...(options.selectedAuxiliaryRoot === undefined
            ? {}
            : { selectedAuxiliaryRoot: options.selectedAuxiliaryRoot }),
        },
      );
      edgesByCandidate.set(candidatePath, edges);
      indexCandidateEdges(candidatePath, edges);
      if (pageProvenancePaths.size > 0 && readCandidates.size >= MINIMUM_TARGETED_REVERSE_FILES) {
        promotedPagePaths.push(...rawBatch.filter((sourcePath) => !readCandidates.has(sourcePath)));
        break targetedCandidates;
      }
    }
    promotedPagePaths.push(...promoteNextDynamicPivot());
  }

  while (
    readCandidates.size < MAXIMUM_REVERSE_FILES &&
    (pending.size > 0 ||
      promotedOffset < promotedPagePaths.length ||
      (scheduledDynamicPivots.size < MAXIMUM_DYNAMIC_REVERSE_PIVOTS &&
        pendingDynamicPivots.size > 0))
  ) {
    throwIfPreviewBuildCancelled(options.signal);
    const frontier = pending.popMinimum();
    if (frontier === undefined) {
      if (promotedOffset >= promotedPagePaths.length) {
        promotedPagePaths.push(...promoteNextDynamicPivot());
        continue;
      }
      const rawBatch = promotedPagePaths.slice(
        promotedOffset,
        promotedOffset +
          Math.min(
            MAXIMUM_CONCURRENT_DIRECTORY_SOURCE_READS,
            MAXIMUM_REVERSE_FILES - readCandidates.size,
          ),
      );
      const candidates = rawBatch.filter((candidatePath) => !readCandidates.has(candidatePath));
      promotedOffset += rawBatch.length;
      const sources = await Promise.allSettled(
        candidates.map(async (candidatePath) => {
          readCandidates.add(candidatePath);
          return options.readSource(candidatePath);
        }),
      );
      throwIfPreviewBuildCancelled(options.signal);
      for (const [index, candidatePath] of candidates.entries()) {
        const result = sources[index];
        if (result?.status === 'rejected') throw result.reason;
        const sourceText = result?.status === 'fulfilled' ? result.value : undefined;
        if (sourceText === undefined) continue;
        sourceTextByCandidate.set(candidatePath, sourceText);
        const edges = collectPreviewInspectorFastResolvedImports(
          candidatePath,
          sourceText,
          options.resolveModule,
          options.workspaceRoot,
          {
            preferredPath: options.documentPath,
            requiredSourcePath: options.documentPath,
            ...(options.selectedAuxiliaryRoot === undefined
              ? {}
              : { selectedAuxiliaryRoot: options.selectedAuxiliaryRoot }),
          },
        );
        edgesByCandidate.set(candidatePath, edges);
        indexCandidateEdges(candidatePath, edges);
      }
      continue;
    }
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
      const admittedCandidates = candidates.slice(0, MAXIMUM_FILES_PER_REVERSE_DIRECTORY);
      for (
        let offset = 0;
        offset < admittedCandidates.length;
        offset += MAXIMUM_CONCURRENT_DIRECTORY_SOURCE_READS
      ) {
        throwIfPreviewBuildCancelled(options.signal);
        const batch: {
          readonly candidatePath: string;
          readonly source: Promise<string | undefined> | undefined;
        }[] = [];
        for (const candidatePath of admittedCandidates.slice(
          offset,
          offset + MAXIMUM_CONCURRENT_DIRECTORY_SOURCE_READS,
        )) {
          if (readCandidates.size >= MAXIMUM_REVERSE_FILES) {
            truncated = true;
            break;
          }
          const needsRead = !edgesByCandidate.has(candidatePath);
          if (needsRead) readCandidates.add(candidatePath);
          batch.push({
            candidatePath,
            source: needsRead
              ? Promise.resolve().then(() => options.readSource(candidatePath))
              : undefined,
          });
        }
        // Read together, then admit in the unchanged candidate order. All started reads settle
        // before an error escapes; one rejected source cannot leave sibling I/O behind.
        const sources = await Promise.allSettled(
          batch.map(({ source }) => source ?? Promise.resolve(undefined)),
        );
        throwIfPreviewBuildCancelled(options.signal);
        for (const [index, { candidatePath, source }] of batch.entries()) {
          let edges = edgesByCandidate.get(candidatePath);
          if (source !== undefined) {
            const result = sources[index];
            if (result?.status === 'rejected') throw result.reason;
            const sourceText = result?.status === 'fulfilled' ? result.value : undefined;
            if (sourceText === undefined) continue;
            sourceTextByCandidate.set(candidatePath, sourceText);
            edges = collectPreviewInspectorFastResolvedImports(
              candidatePath,
              sourceText,
              options.resolveModule,
              options.workspaceRoot,
              {
                preferredPath: frontier.sourcePath,
                requiredSourcePath: options.documentPath,
                ...(options.selectedAuxiliaryRoot === undefined
                  ? {}
                  : { selectedAuxiliaryRoot: options.selectedAuxiliaryRoot }),
              },
            );
            edgesByCandidate.set(candidatePath, edges);
          }
          if (edges !== undefined) indexCandidateEdges(candidatePath, edges);
        }
        if (readCandidates.size >= MAXIMUM_REVERSE_FILES) {
          truncated ||= offset + batch.length < admittedCandidates.length;
          break;
        }
      }
    }
  }
  return Object.freeze({
    childByOwner,
    pageProvenancePaths,
    paths,
    requiredExportsByPath,
    truncated,
  });
}

/** Admits only a literal dynamic edge inside the explicitly selected auxiliary subtree. */
export function isExactAuxiliaryDynamicCarrier(
  edge: PreviewInspectorFastResolvedImportEdge,
  selectedAuxiliaryRoot: string | undefined,
  sourceText: string | undefined,
): boolean {
  if (
    selectedAuxiliaryRoot === undefined ||
    sourceText === undefined ||
    !isPathInside(selectedAuxiliaryRoot, edge.ownerPath)
  ) {
    return false;
  }
  const inventory = collectPreviewDynamicImportInventory(edge.ownerPath, sourceText);
  return inventory.reliable && inventory.specifiers.includes(edge.moduleSpecifier);
}

/** Recognizes a reverse-discovered page shell without requiring a package-wide path inventory. */
export function isLikelyProvisionalPageOwnerPath(sourcePath: string, projectRoot: string): boolean {
  if (!SOURCE_FILE_PATTERN.test(sourcePath) || !isPathInside(projectRoot, sourcePath)) return false;
  const relativeSegments = path.relative(projectRoot, sourcePath).split(path.sep).filter(Boolean);
  return (
    PAGE_SHELL_FILE_PATTERN.test(path.basename(sourcePath)) ||
    relativeSegments
      .slice(0, -1)
      .some((segment) =>
        /^(?:app|layouts?|pages?|routes?|routers?|screens?|shells?|templates?|views?)$/iu.test(
          segment,
        ),
      )
  );
}

/**
 * Admits an external owner that imports an exported same-module JSX owner of the selected target.
 *
 * The reverse corridor normally starts with the selected export demand itself. For
 * `Modal <- ModalButton (same module) <- Page`, however, the Page imports `ModalButton`, so an
 * import-only demand comparison cannot reach it. Parse only the selected source, retain the exact
 * selected export, exact immutable aliases of its local declaration, and bounded local JSX owner
 * exports. The full ancestor planner still re-proves component shape and every wrapper edge before
 * producing an executable plan. Mutable, foreign, type-only and evaluated exports add no aliases.
 */
export async function collectFastLocalTargetExportDemands(options: {
  readonly documentPath: string;
  readonly readSource: ReadPreviewInspectorSource;
  readonly targetExportName?: string;
}): Promise<readonly string[]> {
  const targetExportName = options.targetExportName;
  if (
    targetExportName === undefined ||
    !/^[$_\p{ID_Start}][$\u200C\u200D\p{ID_Continue}]*$/u.test(targetExportName)
  ) {
    return Object.freeze([targetExportName ?? '*']);
  }
  const sourceText = await options.readSource(options.documentPath);
  if (sourceText === undefined) return Object.freeze([targetExportName]);
  const sourceFile = ts.createSourceFile(
    options.documentPath,
    sourceText,
    ts.ScriptTarget.Latest,
    true,
    options.documentPath.toLowerCase().endsWith('x') ? ts.ScriptKind.TSX : ts.ScriptKind.TS,
  );
  const localExports = collectPreviewInspectorRouteFactoryLocalExports(sourceFile);
  const binding = localExports.get(targetExportName);
  const exportNames = new Set<string>([targetExportName]);
  if (binding !== undefined) {
    for (const [exportName, alias] of localExports) {
      if (alias.localName === binding.localName && alias.availableAfter === binding.availableAfter)
        exportNames.add(exportName);
    }
  }
  const localComponentName = binding?.localName ?? targetExportName;
  if (!sourceText.includes(`<${localComponentName}`)) return Object.freeze([...exportNames]);
  const analysis = analyzePreviewLocalParentSlices({
    consumerPath: options.documentPath,
    localComponentName,
    sourceText,
  });
  for (const slice of analysis.slices) {
    const plan = createPreviewParentSlicePlan({ directSlice: slice, sourceText });
    /*
     * Slice completeness describes whether the local owner can be mounted without its imported
     * wrappers; it does not weaken the exact same-module JSX ownership edge. Preserve that owner
     * as an import demand and let the ordinary ancestor planner re-prove every wrapper before it
     * publishes an executable page. Otherwise an imported Section/Provider around an exact local
     * target makes the fast reverse search forget the exported owner that real pages import.
     */
    for (const exportName of plan.ownerExportNames) {
      exportNames.add(exportName);
    }
  }
  return Object.freeze([...exportNames]);
}
