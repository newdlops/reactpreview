/** Builds exact source and slice representation identities and deterministic queue ordering. */
import path from 'node:path';
import type { PreviewInspectorAncestorPlan } from './previewInspectorAncestorPlan';
import type {
  AdmittedKind,
  FrontierSourceQueueItem,
  PreparePreviewInspectorBundleFrontierOptions,
} from './previewInspectorBundleFrontierModel';
import type {
  PreviewInspectorProjectedEdge,
  PreviewInspectorRuntimeImportEdge,
} from './previewInspectorBundleFrontierTypes';
import {
  type PreviewInspectorBundleResolvedNodeFailure,
  type PreviewInspectorBundleResolvedSourceNode,
} from './previewInspectorBundleSourceInventoryMemo';
import type {
  PreviewInspectorMountSurface,
  PreviewInspectorPageExecutionCandidate,
} from './previewInspectorPageExecutionTypes';
import { readPreviewInspectorSelectedRouteContent } from './previewInspectorSelectedRouteContent';
import { readPreviewInspectorUnresolvedRouteFactoryOwner } from './previewInspectorUnresolvedRouteFactoryOwner';

/** Identifies critical strategies evaluated through the generated virtual surface namespace. */
export function isVirtualSliceSurface(surface: PreviewInspectorMountSurface): boolean {
  return (
    surface.strategy === 'selected-export-slice' ||
    surface.strategy === 'inner-local-component-slice'
  );
}

/** Selects only the virtual critical representations associated with one authored path. */
export function collectSlicedSurfaces(
  candidate: PreviewInspectorPageExecutionCandidate | undefined,
  sourcePath: string,
): readonly PreviewInspectorMountSurface[] | undefined {
  return candidate?.criticalSurfaces.filter(
    (surface) =>
      isVirtualSliceSurface(surface) && path.normalize(surface.sourcePath) === sourcePath,
  );
}

/** Keys source representations and resolved edges by their authored scope and Vite glob base. */
export function createResolvedNodeRepresentationKey(
  options: PreparePreviewInspectorBundleFrontierOptions,
  authenticSourcePaths: ReadonlySet<string>,
  sourcePath: string,
): string {
  const normalizedSourcePath = path.normalize(sourcePath);
  const selectedRouteContent = readPreviewInspectorSelectedRouteContent(options.executionCandidate);
  const unresolvedFactoryOwner = readPreviewInspectorUnresolvedRouteFactoryOwner(
    options.plan,
    options.executionCandidate,
  );
  const resolutionScope = [
    path.normalize(options.workspaceRoot),
    path.normalize(options.projectRoot ?? options.workspaceRoot),
    selectedRouteContent?.sourcePath === normalizedSourcePath
      ? selectedRouteContent.exportName
      : null,
    unresolvedFactoryOwner?.sourcePath === normalizedSourcePath
      ? unresolvedFactoryOwner.exportName
      : null,
  ];
  const slicedSurfaces = collectSlicedSurfaces(options.executionCandidate, normalizedSourcePath);
  if (slicedSurfaces !== undefined && slicedSurfaces.length > 1) {
    const shapes = slicedSurfaces
      .map((surface) => [
        surface.exportName,
        surface.strategy,
        surface.localName ?? null,
        [...(surface.preservedWrapperKinds ?? [])],
      ])
      .sort((left, right) => JSON.stringify(left).localeCompare(JSON.stringify(right)));
    return JSON.stringify([
      'preview-inspector-bundle-resolved-node',
      4,
      ...resolutionScope,
      normalizedSourcePath,
      'multi-slice-unavailable',
      shapes,
    ]);
  }
  const slicedSurface = slicedSurfaces?.[0];
  const representation =
    slicedSurface === undefined
      ? ['authentic-full-source']
      : slicedSurface.strategy === 'inner-local-component-slice' &&
          slicedSurface.localName !== undefined
        ? [
            'inner-local-slice',
            slicedSurface.localName,
            [...(slicedSurface.preservedWrapperKinds ?? [])],
          ]
        : ['selected-export-slice', slicedSurface.exportName];
  return JSON.stringify([
    'preview-inspector-bundle-resolved-node',
    4,
    ...resolutionScope,
    normalizedSourcePath,
    slicedSurface === undefined || authenticSourcePaths.has(normalizedSourcePath)
      ? 'authentic-inventory'
      : 'slice-inventory',
    representation,
  ]);
}

/** Identifies only representation choices needed to coalesce identical pending rooted work. */
export function createResolvedNodeRepresentationContextKey(
  options: PreparePreviewInspectorBundleFrontierOptions,
  authenticSourcePaths: ReadonlySet<string>,
): string {
  const sourcePaths = new Set(authenticSourcePaths);
  const selectedRouteContent = readPreviewInspectorSelectedRouteContent(options.executionCandidate);
  if (selectedRouteContent !== undefined) sourcePaths.add(selectedRouteContent.sourcePath);
  for (const surface of options.executionCandidate?.criticalSurfaces ?? [])
    sourcePaths.add(path.normalize(surface.sourcePath));
  return JSON.stringify(
    [...sourcePaths]
      .sort()
      .map((sourcePath) => [
        sourcePath,
        createResolvedNodeRepresentationKey(options, authenticSourcePaths, sourcePath),
      ]),
  );
}

/** Builds one deeply frozen structural-failure node without retaining an error. */
export function createResolvedNodeFailure(
  sourcePath: string,
  representationKey: string,
  failure: PreviewInspectorBundleResolvedNodeFailure,
): PreviewInspectorBundleResolvedSourceNode {
  return Object.freeze({
    byteLength: 0,
    edges: Object.freeze([]),
    failure,
    representationKey,
    sourcePath,
    staticEdges: Object.freeze([]),
  });
}

/** Identifies one source-ordered runtime edge independently of route selection. */
export function createRuntimeEdgeIdentity(
  sourcePath: string,
  edge: PreviewInspectorRuntimeImportEdge,
): string {
  return `${sourcePath}\0${edge.occurrenceStart.toString()}\0${edge.moduleSpecifier}`;
}

/** Collects sources already guaranteed to be evaluated as full authored modules. */
export function collectAuthenticInventorySourcePaths(
  options: PreparePreviewInspectorBundleFrontierOptions,
): ReadonlySet<string> {
  const sourcePaths = new Set(
    (options.runtimeCompanionSourcePaths ?? []).map((sourcePath) => path.normalize(sourcePath)),
  );
  for (const surface of options.executionCandidate?.criticalSurfaces ?? []) {
    if (!isVirtualSliceSurface(surface)) sourcePaths.add(path.normalize(surface.sourcePath));
  }
  for (const surface of options.executionCandidate?.optionalSurfaces ?? []) {
    sourcePaths.add(path.normalize(surface.sourcePath));
  }
  return sourcePaths;
}

/** Raises an already-discovered visual root without duplicating its immutable incoming edge. */
export function promotePendingPreviewInspectorComponent(
  pending: FrontierSourceQueueItem[],
  sourcePath: string,
  kind: Extract<
    FrontierSourceQueueItem['kind'],
    'optional-component' | 'page-shell-component' | 'target-component'
  >,
): void {
  const index = pending.findIndex((item) => item.sourcePath === sourcePath);
  const item = index < 0 ? undefined : pending[index];
  if (item === undefined || queuePriority(item.kind) <= queuePriority(kind)) return;
  pending[index] = { ...item, kind };
}

/** Records only an incoming optional edge, never a partially admitted component. */
export function appendProjection(
  projections: PreviewInspectorProjectedEdge[],
  item: FrontierSourceQueueItem,
  reason: PreviewInspectorProjectedEdge['reason'],
): void {
  if (item.optionalEdge !== undefined)
    projections.push(Object.freeze({ ...item.optionalEdge, reason }));
}

/** Keeps exact closure ahead of optional transactions and preserves their source order. */
export function compareQueueItems(
  left: FrontierSourceQueueItem,
  right: FrontierSourceQueueItem,
): number {
  return (
    queuePriority(left.kind) - queuePriority(right.kind) ||
    left.depth - right.depth ||
    (left.optionalEdge?.importerPath ?? '').localeCompare(right.optionalEdge?.importerPath ?? '') ||
    (left.optionalEdge?.occurrenceStart ?? 0) - (right.optionalEdge?.occurrenceStart ?? 0) ||
    left.sourcePath.localeCompare(right.sourcePath)
  );
}

/** Finishes mandatory exact closure before optional component transactions. */
export function queuePriority(kind: FrontierSourceQueueItem['kind']): number {
  return kind === 'exact'
    ? 0
    : kind === 'target-component'
      ? 1
      : kind === 'page-shell-component'
        ? 2
        : kind === 'support'
          ? 3
          : 4;
}

/** Counts current optional support entries; exact sources are deliberately never charged to it. */
export function countKinds(kinds: ReadonlyMap<string, AdmittedKind>, kind: AdmittedKind): number {
  return [...kinds.values()].filter((value) => value === kind).length;
}

/** Preserves visual relation ordering before stable source/export tie breakers. */
export function compareVisualPaths(
  left: NonNullable<PreviewInspectorAncestorPlan['shallowVisualPaths']>[number],
  right: NonNullable<PreviewInspectorAncestorPlan['shallowVisualPaths']>[number],
): number {
  return (
    visualRelationPriority(left.relation) - visualRelationPriority(right.relation) ||
    path.normalize(left.importerPath).localeCompare(path.normalize(right.importerPath)) ||
    left.renderBoundaryStart - right.renderBoundaryStart ||
    left.occurrenceStart - right.occurrenceStart ||
    path.normalize(left.sourcePath).localeCompare(path.normalize(right.sourcePath)) ||
    left.exportName.localeCompare(right.exportName)
  );
}

/** Keeps owner/wrapper paths ahead of sibling and component-prop alternatives. */
export function visualRelationPriority(relation: string): number {
  return relation === 'wrapper'
    ? 0
    : relation === 'sibling'
      ? 1
      : relation === 'component-prop'
        ? 2
        : 3;
}

/** Sorts public projection records independently of source read or resolver completion timing. */
export function compareProjectedEdges(
  left: PreviewInspectorProjectedEdge,
  right: PreviewInspectorProjectedEdge,
): number {
  return (
    left.importerPath.localeCompare(right.importerPath) ||
    left.occurrenceStart - right.occurrenceStart ||
    left.moduleSpecifier.localeCompare(right.moduleSpecifier)
  );
}
