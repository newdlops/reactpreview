/** Derives the runtime-only Inspector ownership identity from compiler-validated route evidence. */
import path from 'node:path';
import {
  PreviewCompilationError,
  type PreviewInspectorRouteSelectionStep,
  type PreviewInspectorTargetMode,
} from '../../../domain/preview';
import { selectPreviewTargetExports } from '../previewTargetExports';
import type {
  PreviewInspectorAncestorPlan,
  PreviewInspectorComponentReference,
} from './previewInspectorAncestorTypes';
import type { PreviewInspectorPageExecutionCandidate } from './previewInspectorPageExecutionTypes';

/** Keeps active-document ownership unless the caller explicitly requests route-leaf ownership. */
export function resolvePreviewInspectorRuntimeTargetMode(
  _plan: PreviewInspectorAncestorPlan | undefined,
  requestedMode: PreviewInspectorTargetMode | undefined,
): PreviewInspectorTargetMode | undefined {
  /*
   * Automatic route selection chooses the page context, not a different file to validate. A
   * nested selected component can legitimately sit below that route leaf; silently promoting the
   * leaf makes a fully rendered page report success while never proving the active file mounted.
   * Explicit route-leaf inspection remains available through the caller-owned target mode.
   */
  return requestedMode;
}

export interface ResolvePreviewInspectorRuntimeOwnershipTargetOptions {
  /** Original request target retained for analysis, diagnostics, snapshots, and request identity. */
  readonly analysisTarget: PreviewInspectorComponentReference;
  /** Final compiler-selected Page Execution candidate after frontier validation. */
  readonly candidate?: PreviewInspectorPageExecutionCandidate;
  /** Original active document used to anchor bounded compiler diagnostics. */
  readonly diagnosticPath: string;
  /** Exact compiler-owned route selection resolution for the active analysis plan. */
  readonly routeSelectionResolution?: 'automatic' | 'exact' | 'fallback';
  /** Public route selection identities; these never contain a filesystem leaf identity. */
  readonly routeSelection?: readonly PreviewInspectorRouteSelectionStep[];
  /** Current compiler-read source for the derived route leaf. */
  readonly selectedLeafSourceText?: string;
  /** Omitted for ordinary active-document ownership. */
  readonly targetMode?: PreviewInspectorTargetMode;
}

/**
 * Returns active-document ownership by default and fails closed for an unproven selected leaf.
 *
 * The selected source/export must agree across the Page Execution browser target, content root,
 * and an admitted authentic route surface. The compiler then re-reads the source and confirms that
 * exact runtime export without accepting any caller-supplied module identity.
 */
export function resolvePreviewInspectorRuntimeOwnershipTarget(
  options: ResolvePreviewInspectorRuntimeOwnershipTargetOptions,
): PreviewInspectorComponentReference {
  if (options.targetMode === undefined) return options.analysisTarget;
  if (
    options.routeSelectionResolution === 'exact' &&
    (options.routeSelection === undefined || options.routeSelection.length === 0)
  ) {
    return failSelectedRouteOwnership(options, 'does not contain a non-empty route selection');
  }
  if (
    options.routeSelectionResolution !== 'exact' &&
    options.routeSelectionResolution !== 'automatic'
  ) {
    return failSelectedRouteOwnership(
      options,
      'was not recreated as an exact compiler-owned route selection',
    );
  }
  const candidate = options.candidate;
  if (candidate === undefined) {
    return failSelectedRouteOwnership(
      options,
      'does not have a validated Page Execution candidate',
    );
  }
  const target = candidate.browserCandidate.target;
  const contentRoot = candidate.browserCandidate.root;
  const surfaceIds = candidate.criticalSurfaces.map((surface) => surface.id);
  const executionRoots = candidate.criticalSurfaces.filter(
    (surface) => surface.id === candidate.executionRootSurfaceId,
  );
  const runtimeTargets = candidate.criticalSurfaces.filter(
    (surface) => surface.id === candidate.runtimeTargetSurfaceId,
  );
  if (target === undefined) {
    return failSelectedRouteOwnership(
      options,
      'does not have a compiler-owned browser target identity',
    );
  }
  if (executionRoots.length === 0) {
    return failSelectedRouteOwnership(options, 'is missing its execution-root surface');
  }
  if (executionRoots.length > 1) {
    return failSelectedRouteOwnership(options, 'contains duplicate execution-root surfaces');
  }
  if (!sameComponentReference(executionRoots[0] ?? contentRoot, contentRoot)) {
    return failSelectedRouteOwnership(
      options,
      'has a candidate root that does not match its execution-root surface',
    );
  }
  if (runtimeTargets.length === 0) {
    return failSelectedRouteOwnership(options, 'is missing its runtime-target surface');
  }
  if (runtimeTargets.length > 1) {
    return failSelectedRouteOwnership(options, 'contains duplicate runtime-target surfaces');
  }
  if (new Set(surfaceIds).size !== surfaceIds.length) {
    return failSelectedRouteOwnership(options, 'contains duplicate critical surface ids');
  }
  if (!sameComponentReference(runtimeTargets[0] ?? contentRoot, target)) {
    return failSelectedRouteOwnership(
      options,
      'has a runtime-target leaf whose source or export does not match the browser target',
    );
  }
  if (sameComponentReference(target, contentRoot)) {
    if (candidate.executionRootSurfaceId !== candidate.runtimeTargetSurfaceId) {
      return failSelectedRouteOwnership(
        options,
        'separates execution and runtime roles without a distinct nested owner',
      );
    }
  } else {
    const mountFailure = validateNestedMountChain(
      options,
      candidate,
      executionRoots[0],
      runtimeTargets[0],
    );
    if (mountFailure !== undefined) return failSelectedRouteOwnership(options, mountFailure);
  }
  if (options.selectedLeafSourceText === undefined) {
    return failSelectedRouteOwnership(options, 'could not read the selected route leaf source');
  }
  const exportNames = selectPreviewTargetExports(
    target.sourcePath,
    options.selectedLeafSourceText,
  ).flatMap((slot) => (slot.kind === 'explicit' ? [slot.exportName] : []));
  if (!exportNames.includes(target.exportName)) {
    return failSelectedRouteOwnership(
      options,
      'could not validate the selected route leaf export from current source',
    );
  }
  return Object.freeze({ exportName: target.exportName, sourcePath: target.sourcePath });
}

/** Validates that compiler route evidence connects the execution root to the runtime leaf. */
function validateNestedMountChain(
  options: ResolvePreviewInspectorRuntimeOwnershipTargetOptions,
  candidate: PreviewInspectorPageExecutionCandidate,
  executionRoot: PreviewInspectorPageExecutionCandidate['criticalSurfaces'][number] | undefined,
  runtimeTarget: PreviewInspectorPageExecutionCandidate['criticalSurfaces'][number] | undefined,
): string | undefined {
  const location = candidate.browserCandidate.routeLocation;
  const recipe = candidate.routeRecipe;
  const evidenceMounts =
    location !== undefined && 'routeMounts' in location ? (location.routeMounts ?? []) : [];
  const mounts = recipe?.mounts ?? [];
  if (
    executionRoot === undefined ||
    runtimeTarget === undefined ||
    location === undefined ||
    recipe === undefined ||
    mounts.length === 0 ||
    mounts.length !== evidenceMounts.length ||
    recipe.pattern !== location.pattern ||
    recipe.pathname !== location.pathname
  ) {
    return 'does not have one complete compiler-owned nested mount chain';
  }
  const routeSelection = options.routeSelection ?? [];
  const contextualMountCount = mounts.filter(
    (mount) => mount.contextPattern !== undefined && mount.contextOrigin !== 'virtual-page-owner',
  ).length;
  // Selecting a proven route-owner prefix is exact even when the planner descends automatically
  // through that owner's deterministic default children to obtain visible runtime output.
  if (
    options.routeSelectionResolution === 'exact' &&
    (routeSelection.length > contextualMountCount + 1 ||
      (routeSelection.length === contextualMountCount + 1 &&
        routeSelection.at(-1)?.pattern !== location.pattern))
  ) {
    return 'does not preserve the exact nested route selection';
  }
  let currentSurfaceId = executionRoot.id;
  const visited = new Set([currentSurfaceId]);
  let routeSelectionIndex = 0;
  for (let index = 0; index < mounts.length; index += 1) {
    const mount = mounts[index];
    const evidence = evidenceMounts[index];
    if (mount === undefined || evidence === undefined || mount.parentSurfaceId === undefined) {
      return 'contains an incomplete nested mount edge';
    }
    const parentSurface = candidate.criticalSurfaces.find(
      (surface) => surface.id === mount.parentSurfaceId,
    );
    if (
      mount.parentSurfaceId !== currentSurfaceId ||
      parentSurface === undefined ||
      mount.childSurfaceId === mount.parentSurfaceId ||
      visited.has(mount.childSurfaceId) ||
      mount.contextOrigin !== evidence.contextOrigin ||
      mount.contextPattern !== evidence.contextPattern ||
      mount.basePath !== evidence.basePath ||
      mount.hasWildcardFallback !== evidence.hasWildcardFallback ||
      mount.pattern !== recipe.pattern ||
      path.normalize(parentSurface.sourcePath) !== path.normalize(evidence.sourcePath) ||
      parentSurface.exportName !== evidence.exportName ||
      (options.routeSelectionResolution === 'exact' &&
        mount.contextPattern !== undefined &&
        mount.contextOrigin !== 'virtual-page-owner' &&
        routeSelectionIndex < routeSelection.length &&
        routeSelection[routeSelectionIndex]?.pattern !== mount.contextPattern)
    ) {
      return 'contains a mismatched, cyclic, ambiguous, or reordered nested mount edge';
    }
    if (mount.contextPattern !== undefined && mount.contextOrigin !== 'virtual-page-owner') {
      routeSelectionIndex += 1;
    }
    visited.add(mount.childSurfaceId);
    currentSurfaceId = mount.childSurfaceId;
  }
  return currentSurfaceId === runtimeTarget.id
    ? undefined
    : 'does not terminate its nested mount chain at the selected runtime target';
}

/** Compares normalized compiler-owned source/export identities. */
function sameComponentReference(
  left: PreviewInspectorComponentReference,
  right: PreviewInspectorComponentReference,
): boolean {
  return (
    left.exportName === right.exportName &&
    path.normalize(left.sourcePath) === path.normalize(right.sourcePath)
  );
}

/** Raises a bounded diagnostic when selected-route ownership cannot be proven. */
function failSelectedRouteOwnership(
  options: ResolvePreviewInspectorRuntimeOwnershipTargetOptions,
  reason: string,
): never {
  const message = `Selected-route ownership ${reason}.`;
  throw new PreviewCompilationError(
    `React Preview could not validate the selected route leaf for runtime ownership: ${reason}.`,
    [
      {
        location: { column: 0, file: options.diagnosticPath, line: 1 },
        message,
        notes: [
          'Choose a statically resolved route whose Page Execution leaf and content root agree.',
        ],
        severity: 'error',
      },
    ],
  );
}
