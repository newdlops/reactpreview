/** Keeps a compiler-selected route's child content distinct from current-file target ownership. */
import path from 'node:path';
import type { PreviewInspectorComponentReference } from './previewInspectorAncestorTypes';
import { sameSurfaceReference } from './previewInspectorPageExecutionContracts';
import type { PreviewInspectorPageExecutionCandidate } from './previewInspectorPageExecutionTypes';

/**
 * Returns the selected child below a contextual target, without changing execution or target roles.
 * Exact root/target surfaces already have their own admission rules. An authentic current-file
 * factory owner still needs its selected child; unrelated target-only recovery and error-slot
 * executions do not require the ordinary route element's body to be evaluated.
 */
export function readPreviewInspectorSelectedRouteContent(
  candidate: PreviewInspectorPageExecutionCandidate | undefined,
): PreviewInspectorComponentReference | undefined {
  if (candidate === undefined || candidate.routeRecipe?.targetRole === 'error-element')
    return undefined;
  if (candidate.fidelity.startsWith('target-') && !hasAuthenticTargetRouteOwner(candidate)) {
    return undefined;
  }
  const location = candidate.browserCandidate.routeLocation;
  if (
    location === undefined ||
    (location.evidenceKind !== 'route-catalog' && location.evidenceKind !== 'route-jsx') ||
    location.componentSourcePath === undefined
  )
    return undefined;
  const reference = {
    exportName: location.componentExportName ?? 'default',
    sourcePath: path.normalize(location.componentSourcePath),
  };
  return candidate.criticalSurfaces.some(
    (surface) =>
      path.normalize(surface.sourcePath) === reference.sourcePath &&
      surface.exportName === reference.exportName,
  )
    ? undefined
    : Object.freeze(reference);
}

/** Admits a child only beneath the same authentic root/target export with proven factory slots. */
function hasAuthenticTargetRouteOwner(candidate: PreviewInspectorPageExecutionCandidate): boolean {
  const owner = candidate.criticalSurfaces.find(
    (surface) =>
      surface.id === candidate.runtimeTargetSurfaceId &&
      surface.id === candidate.executionRootSurfaceId &&
      surface.strategy === 'authentic-module-export',
  );
  if (
    owner === undefined ||
    ![
      candidate.browserCandidate.root,
      candidate.executionRootContract,
      candidate.runtimeTargetContract,
    ].every((reference) => sameSurfaceReference(owner, reference))
  )
    return false;
  const location = candidate.browserCandidate.routeLocation;
  return (
    location !== undefined &&
    'routeMounts' in location &&
    location.routeMounts.some(
      (mount) => mount.routeSlotCount > 0 && sameSurfaceReference(owner, mount),
    )
  );
}
