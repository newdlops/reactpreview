/** Preserves authored page inputs only for the exact compiler-proven unresolved factory root. */
import path from 'node:path';
import type { PreviewInspectorAncestorPlan } from './previewInspectorAncestorPlan';
import type { PreviewInspectorComponentReference } from './previewInspectorAncestorTypes';
import { sameSurfaceReference } from './previewInspectorPageExecutionContracts';
import type { PreviewInspectorPageExecutionCandidate } from './previewInspectorPageExecutionTypes';

/**
 * Reads an unresolved factory owner whose authored Routes must choose their own page at runtime.
 *
 * The root, current-file target, mount, and execution roles must agree on source/export identity.
 * A selected child, detached recovery, projected root, error slot, or different mount returns no
 * preservation capability. This function neither scans source nor imports/evaluates a factory.
 * Callers still enforce their existing authored-source and module/byte frontier budgets.
 *
 * @param plan Compiler-owned root/target and legacy candidate evidence.
 * @param executionCandidate Optional frozen execution whose admitted authentic root is authoritative.
 * @returns Exact source/export allowed to retain its page-map inputs, or undefined without proof.
 */
export function readPreviewInspectorUnresolvedRouteFactoryOwner(
  plan: PreviewInspectorAncestorPlan,
  executionCandidate?: PreviewInspectorPageExecutionCandidate,
): PreviewInspectorComponentReference | undefined {
  const candidate = executionCandidate?.browserCandidate ?? plan.pageCandidates[0];
  if (
    candidate?.target === undefined ||
    candidate.detachedTargetPlacement !== undefined ||
    !sameSurfaceReference(candidate.root, candidate.target) ||
    !sameSurfaceReference(candidate.root, plan.target)
  )
    return undefined;
  if (executionCandidate !== undefined) {
    const owner = executionCandidate.criticalSurfaces.find(
      (surface) =>
        surface.id === executionCandidate.executionRootSurfaceId &&
        surface.id === executionCandidate.runtimeTargetSurfaceId &&
        surface.strategy === 'authentic-module-export',
    );
    if (
      owner === undefined ||
      executionCandidate.standaloneTarget === true ||
      executionCandidate.routeRecipe?.targetRole === 'error-element' ||
      ![
        candidate.root,
        executionCandidate.executionRootContract,
        executionCandidate.runtimeTargetContract,
      ].every((reference) => sameSurfaceReference(owner, reference))
    )
      return undefined;
  }
  const location = candidate.routeLocation;
  if (
    location?.evidenceKind !== 'route-jsx' ||
    (location.componentSourcePath !== undefined &&
      !sameSurfaceReference(candidate.root, {
        exportName: location.componentExportName ?? 'default',
        sourcePath: location.componentSourcePath,
      })) ||
    !('routeMounts' in location)
  )
    return undefined;
  // An outer authored Route can name this same owner through `/feature/*`. It does not select
  // one page-map child, so the owner still needs its real inputs. Mount identity and slot evidence
  // remain mandatory; the source collector additionally checks the exact factory declaration.
  const proven = location.routeMounts.some(
    (mount) => mount.routeSlotCount > 0 && sameSurfaceReference(candidate.root, mount),
  );
  return proven
    ? Object.freeze({
        exportName: candidate.root.exportName,
        sourcePath: path.normalize(candidate.root.sourcePath),
      })
    : undefined;
}
