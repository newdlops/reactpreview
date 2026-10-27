/** Materializes candidate-specific frontier identities from shared source-closure templates. */
import path from 'node:path';
import {
  createPreviewInspectorBundleFrontierIdentity,
  PREVIEW_INSPECTOR_BUNDLE_FRONTIER_FORMAT_VERSION,
  PREVIEW_INSPECTOR_PAGE_EXECUTION_FRONTIER_FORMAT_VERSION,
} from './previewInspectorBundleFrontierFinalization';
import type {
  PreparedPreviewInspectorBundleFrontier,
  PreparePreviewInspectorBundleFrontierOptions,
} from './previewInspectorBundleFrontierModel';
import { compareVisualPaths } from './previewInspectorBundleRepresentations';
import { collectPreviewInspectorExecutionCorridorSeedPaths } from './previewInspectorBundleSeeds';
import { type PreviewInspectorBundleSourceClosureTemplate } from './previewInspectorBundleSourceInventoryMemo';
import { collectPreviewInspectorExecutionRouteParameterGroups } from './previewInspectorRouteParameterBranch';
import { readPreviewInspectorSelectedRouteContent } from './previewInspectorSelectedRouteContent';
import { readPreviewInspectorUnresolvedRouteFactoryOwner } from './previewInspectorUnresolvedRouteFactoryOwner';

/** Rebuilds candidate-specific identity and transport around one immutable closure template. */
export function materializePreviewInspectorBundleFrontier(
  options: PreparePreviewInspectorBundleFrontierOptions,
  template: PreviewInspectorBundleSourceClosureTemplate,
): PreparedPreviewInspectorBundleFrontier {
  const diagnostics = options.bundleDiagnostics;
  const finalize = (): PreparedPreviewInspectorBundleFrontier => {
    const collectIdentity = (): string =>
      createPreviewInspectorBundleFrontierIdentity(
        Object.freeze({ mode: options.policy.mode }),
        options.executionCandidate,
        template.authenticSourcePaths,
        template.exactSourcePaths,
        template.packageDemandSourcePaths,
        template.authenticComponentExports,
        template.projectedEdges,
        template.summary,
      );
    const identity =
      diagnostics === undefined
        ? collectIdentity()
        : diagnostics.measureFrontierIdentity(collectIdentity);
    return {
      frontier: Object.freeze({
        authenticComponentExports: template.authenticComponentExports,
        authenticSourcePaths: template.authenticSourcePaths,
        exactSourcePaths: template.exactSourcePaths,
        identity,
        packageDemandSourcePaths: template.packageDemandSourcePaths,
        projectedEdges: template.projectedEdges,
        summary: template.summary,
        version:
          options.executionCandidate === undefined
            ? PREVIEW_INSPECTOR_BUNDLE_FRONTIER_FORMAT_VERSION
            : PREVIEW_INSPECTOR_PAGE_EXECUTION_FRONTIER_FORMAT_VERSION,
        ...(options.executionCandidate === undefined
          ? {}
          : {
              executionCandidateId: options.executionCandidate.id,
              sourceKinds: template.sourceKinds,
            }),
      }),
      rejected: template.rejected,
    };
  };
  return diagnostics === undefined ? finalize() : diagnostics.measureFrontierFinalize(finalize);
}

/** Keys only immutable inputs that can change v2 authored closure traversal. */
export function createPreviewInspectorBundleSourceClosureKey(
  options: PreparePreviewInspectorBundleFrontierOptions,
): string {
  const candidate = options.executionCandidate;
  if (candidate === undefined) throw new TypeError('Page Execution closure requires a candidate.');
  const selectedRouteContent = readPreviewInspectorSelectedRouteContent(candidate);
  const unresolvedFactoryOwner = readPreviewInspectorUnresolvedRouteFactoryOwner(
    options.plan,
    candidate,
  );
  const sortRows = <Row extends readonly unknown[]>(rows: Row[]): Row[] =>
    rows.sort((left, right) => JSON.stringify(left).localeCompare(JSON.stringify(right)));
  return JSON.stringify([
    'preview-inspector-bundle-source-closure',
    5,
    PREVIEW_INSPECTOR_PAGE_EXECUTION_FRONTIER_FORMAT_VERSION,
    path.normalize(options.workspaceRoot),
    path.normalize(options.projectRoot ?? options.workspaceRoot),
    options.policy.maximumAuthoredModules,
    options.policy.maximumSourceBytes,
    [...(options.runtimeCompanionSourcePaths ?? [])]
      .map((sourcePath) => path.normalize(sourcePath))
      .sort(),
    sortRows(
      collectPreviewInspectorExecutionRouteParameterGroups(candidate).map((values) =>
        [...values].sort(),
      ),
    ),
    sortRows(
      candidate.criticalSurfaces.map(
        (surface) =>
          [
            path.normalize(surface.sourcePath),
            surface.exportName,
            surface.strategy,
            surface.localName ?? null,
            [...(surface.preservedWrapperKinds ?? [])],
            {
              executionRoot: surface.id === candidate.executionRootSurfaceId,
              runtimeTarget: surface.id === candidate.runtimeTargetSurfaceId,
            },
          ] as const,
      ),
    ),
    collectPreviewInspectorExecutionCorridorSeedPaths(options.plan, candidate),
    selectedRouteContent === undefined
      ? null
      : [selectedRouteContent.sourcePath, selectedRouteContent.exportName],
    unresolvedFactoryOwner === undefined
      ? null
      : [unresolvedFactoryOwner.sourcePath, unresolvedFactoryOwner.exportName],
    sortRows(
      candidate.optionalSurfaces.map(
        (surface) =>
          [path.normalize(surface.sourcePath), surface.exportName, surface.strategy] as const,
      ),
    ),
    [...(options.plan.shallowVisualPaths ?? [])]
      .sort(compareVisualPaths)
      .map(
        (visualPath) =>
          [
            path.normalize(visualPath.importerPath),
            path.normalize(visualPath.sourcePath),
            visualPath.exportName,
            visualPath.moduleSpecifier,
            visualPath.occurrenceStart,
            visualPath.relation,
            visualPath.renderBoundaryStart,
            visualPath.importKind,
          ] as const,
      ),
  ]);
}
