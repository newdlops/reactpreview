/** Promotes exact JSX route owners while preserving selected target identity. */
import path from 'node:path';
import { createRenderPathPageCandidate } from './previewInspectorAncestorCandidates';
import {
  type CreatePreviewInspectorAncestorPlanOptions,
  createInspectorUsagePlanningContext,
} from './previewInspectorAncestorModel';
import type {
  PreviewInspectorAncestorEdge,
  PreviewInspectorComponentReference,
  PreviewInspectorPageCandidate,
} from './previewInspectorAncestorTypes';
import type { PreviewInspectorRouteLocation } from './previewInspectorRouteLocation';

/** Adds one exact owner checkpoint only when route JSX and ancestry agree within one render path. */
export async function finalizePreviewInspectorRouteJsxOwners(
  candidates: readonly PreviewInspectorPageCandidate[],
  options: CreatePreviewInspectorAncestorPlanOptions,
  sourcePaths: readonly string[],
  target: PreviewInspectorComponentReference,
): Promise<readonly PreviewInspectorPageCandidate[]> {
  type RouteJsxCandidate = PreviewInspectorPageCandidate & {
    readonly routeLocation: PreviewInspectorRouteLocation & { readonly evidenceKind: 'route-jsx' };
  };
  const finalized = [...candidates];
  const groups = new Map<string, PreviewInspectorPageCandidate[]>();
  for (const candidate of candidates) {
    const renderPathId = candidate.renderPath?.id;
    if (renderPathId === undefined) continue;
    const group = groups.get(renderPathId) ?? [];
    group.push(candidate);
    groups.set(renderPathId, group);
  }
  for (const group of groups.values()) {
    const eligible = group.filter((candidate): candidate is RouteJsxCandidate => {
      const location = candidate.routeLocation;
      return (
        location?.evidenceKind === 'route-jsx' &&
        (location.routeMounts?.length ?? 0) === 0 &&
        location.directRouteOwnerSourcePath === undefined
      );
    });
    const locations = new Map<string, PreviewInspectorRouteLocation>();
    for (const candidate of eligible) {
      const location = candidate.routeLocation;
      locations.set(
        JSON.stringify({
          sourcePath: path.normalize(location.sourcePath),
          componentSourcePath:
            location.componentSourcePath === undefined
              ? undefined
              : path.normalize(location.componentSourcePath),
          componentExportName: location.componentExportName,
          pathname: location.pathname,
          pattern: location.pattern,
        }),
        location,
      );
    }
    if (locations.size !== 1) continue;
    const location = [...locations.values()][0];
    if (location === undefined) continue;
    const ownerEdges = new Map<string, PreviewInspectorAncestorEdge>();
    for (const candidate of eligible) {
      for (const edge of candidate.edges) {
        if (
          path.normalize(edge.owner.sourcePath) !== path.normalize(location.sourcePath) ||
          path.normalize(edge.child.sourcePath) !== target.sourcePath ||
          edge.child.exportName !== target.exportName
        ) {
          continue;
        }
        const identity = [
          path.normalize(edge.owner.sourcePath),
          edge.owner.exportName,
          path.normalize(edge.child.sourcePath),
          edge.child.exportName,
        ].join('\u0000');
        ownerEdges.set(identity, edge);
      }
    }
    if (ownerEdges.size !== 1) continue;
    const edge = [...ownerEdges.values()][0];
    if (edge === undefined) continue;
    const renderPath = group[0]?.renderPath;
    if (renderPath === undefined) continue;
    const matchingSteps = renderPath.steps
      .map((step, index) => ({ step, index }))
      .filter(
        ({ step }) => path.normalize(step.sourcePath) === path.normalize(edge.owner.sourcePath),
      );
    if (matchingSteps.length !== 1) continue;
    const routeLocation = Object.freeze({
      ...location,
      directRouteOwnerSourcePath: path.normalize(edge.owner.sourcePath),
    });
    const withLocation = (
      candidate: PreviewInspectorPageCandidate,
    ): PreviewInspectorPageCandidate => Object.freeze({ ...candidate, routeLocation });
    const eligibleKeys = new Set<PreviewInspectorPageCandidate>(eligible);
    for (let index = 0; index < finalized.length; index += 1) {
      const candidate = finalized[index];
      if (candidate !== undefined && eligibleKeys.has(candidate)) {
        finalized[index] = withLocation(candidate);
      }
    }
    const rootStepIndex = matchingSteps[0]?.index;
    if (rootStepIndex === undefined) continue;
    const checkpointExists = finalized.some(
      (candidate) =>
        candidate.renderPath?.id === renderPath.id &&
        path.normalize(candidate.root.sourcePath) === path.normalize(edge.owner.sourcePath) &&
        candidate.root.exportName === edge.owner.exportName,
    );
    if (checkpointExists) continue;
    const base = eligible.find((candidate) =>
      candidate.edges.some(
        (candidateEdge) =>
          path.normalize(candidateEdge.owner.sourcePath) ===
            path.normalize(edge.owner.sourcePath) &&
          candidateEdge.owner.exportName === edge.owner.exportName &&
          path.normalize(candidateEdge.child.sourcePath) ===
            path.normalize(edge.child.sourcePath) &&
          candidateEdge.child.exportName === edge.child.exportName,
      ),
    );
    if (base === undefined) continue;
    const checkpoint = await createRenderPathPageCandidate({
      base: withLocation(base),
      options,
      planningContext: createInspectorUsagePlanningContext(options, sourcePaths),
      renderPathRoot: {
        outermost: false,
        reference: edge.owner,
        stepIndex: rootStepIndex,
      },
      routeLocation,
    });
    finalized.push(checkpoint);
  }
  return Object.freeze(finalized);
}
