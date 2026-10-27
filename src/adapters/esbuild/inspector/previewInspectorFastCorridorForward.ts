/** Finds forward entry meetings and exact page subtrees. */
import path from 'node:path';
import { throwIfPreviewBuildCancelled } from '../../../domain/previewBuildExecution';
import type { ResolvePreviewRenderGraphModule } from '../renderGraph/previewRenderGraphTypes';
import { collectPreviewDynamicImportInventory } from '../staticResources/previewDynamicImportInventory';
import type { ReadPreviewInspectorSource } from './previewInspectorAncestorTypes';
import {
  MAXIMUM_FAST_DYNAMIC_IMPORTS,
  MAXIMUM_FAST_ROUTE_IMPORTS,
  MAXIMUM_FORWARD_AFFINITY_PATHS,
  MAXIMUM_FORWARD_FILES,
  MAXIMUM_IMPORTS_PER_FILE,
  MAXIMUM_PAGE_SUBTREE_FILES,
  type PreviewBoundedFastImportPath,
} from './previewInspectorFastCorridorModel';
import {
  hasBroadRouteRegistrySyntax,
  hasSemanticReactEntry,
  isExpandablePageShellSource,
  isPageCompositionSource,
  isProjectSourcePath,
  scoreProvisionalRoot,
} from './previewInspectorFastCorridorPaths';
import { findPreviewInspectorFastForwardMeeting } from './previewInspectorFastForwardSearch';
import { collectPreviewInspectorFastResolvedImports } from './previewInspectorFastResolvedImports';
import { analyzePreviewInspectorFastRouteRegistry } from './previewInspectorFastRouteRegistry';
import { analyzePreviewInspectorFastSemanticImports } from './previewInspectorFastSemanticImports';
import { collectPreviewStaticRouteProjectionInventory } from './previewInspectorStaticRouteProjection';

/** Walks imports from shallow app entries and stops at the first target-side meeting point. */
export async function findForwardMeeting(options: {
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
      readonly semanticEntryPaths: readonly string[];
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
  const meeting = await findPreviewInspectorFastForwardMeeting({
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
    maximumFiles: MAXIMUM_FORWARD_FILES,
    reverseChildByOwner: options.reverseChildByOwner,
    reversePaths: options.reversePaths,
    reverseRequiredExports: options.reverseRequiredExports,
    ...(options.signal === undefined ? {} : { signal: options.signal }),
    workspaceRoot: options.workspaceRoot,
  });
  return meeting === undefined
    ? undefined
    : Object.freeze({
        ...meeting,
        semanticEntryPaths: Object.freeze(
          entries.filter((entry) => entry.semanticEntry).map((entry) => entry.sourcePath),
        ),
      });
}

/** Adds static JSX-facing dependencies around the selected page root with a file-budgeted DFS. */
export async function collectPageSubtree(options: {
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
  const pending = [rootPath];
  let truncated = false;
  while (pending.length > 0 && sourcePaths.size < MAXIMUM_PAGE_SUBTREE_FILES) {
    throwIfPreviewBuildCancelled(options.signal);
    const currentPath = pending.pop();
    if (currentPath === undefined || expandedPaths.has(currentPath)) continue;
    expandedPaths.add(currentPath);
    sourcePaths.add(currentPath);
    const sourceText = await options.readSource(currentPath);
    if (sourceText === undefined) {
      truncated = true;
      continue;
    }
    // One-hop modules stay authentic; only cheap planner recursion stops outside explicit shells.
    if (reservedSourcePaths.has(currentPath) && !isExpandablePageShellSource(currentPath)) {
      continue;
    }
    const dynamicInventory = collectPreviewDynamicImportInventory(currentPath, sourceText);
    const broadDynamicSpecifiers =
      dynamicInventory.truncated ||
      dynamicInventory.specifiers.length > MAXIMUM_FAST_DYNAMIC_IMPORTS
        ? new Set(dynamicInventory.specifiers)
        : undefined;
    const projectedRouteSpecifiers = sourceText.includes('import')
      ? collectPreviewStaticRouteProjectionInventory(currentPath, sourceText).projectionsBySpecifier
      : undefined;
    const sideEffectSpecifiers = new Set(
      [...sourceText.matchAll(/^\s*import\s*(["'])([^"'\r\n]+)\1\s*;?/gmu)].flatMap(
        (match) => match[2] ?? [],
      ),
    );
    const children = collectPreviewInspectorFastResolvedImports(
      currentPath,
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
        (corridor.has(currentPath) &&
          !corridor.has(childPath) &&
          /\.[cm]?[jt]sx$/iu.test(childPath) &&
          !reservedSourcePaths.has(childPath) &&
          !sideEffectSpecifiers.has(edge.moduleSpecifier)) ||
        (!corridor.has(childPath) && !isPageCompositionSource(childPath))
      ) {
        continue;
      }
      pending.push(childPath);
    }
  }
  if (pending.length > 0) truncated = true;
  return Object.freeze({ sourcePaths: Object.freeze([...sourcePaths]), truncated });
}

/**
 * Drops high-fanout React Router registries from the fast path while retaining page-local owners.
 *
 * Static route tables often import every application page eagerly. Importing one such table makes
 * esbuild traverse the whole product even though the target path below it is already known. The
 * cutoff requires both explicit router syntax and more than 48 resolved authored imports, then
 * starts at the following proven corridor module. Exact/full enrichment remains unchanged.
 */
export async function trimBroadRouteRegistryPrefix(options: {
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
