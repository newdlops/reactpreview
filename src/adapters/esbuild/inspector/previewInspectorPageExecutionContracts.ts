/* eslint-disable jsdoc/require-jsdoc */
/** Freezes execution role identities and deterministic candidate contracts after surface admission. */
import { createHash } from 'node:crypto';
import path from 'node:path';
import type {
  PreviewInspectorComponentReference,
  PreviewInspectorPageCandidate,
} from './previewInspectorAncestorTypes';
import type {
  PreviewInspectorMountSurface,
  PreviewInspectorPageCompositionEdge,
  PreviewInspectorPageExecutionCandidate,
  PreviewInspectorPageFidelity,
  PreviewInspectorRouteExecutionRecipe,
} from './previewInspectorPageExecutionTypes';
import { doesPreviewInspectorSurfaceOwnRouter } from './previewInspectorPageExecutionSurfaceEvidence';

/** Freezes an exact execution graph and rejects missing root or target role surfaces. */
export function createCandidate(options: {
  readonly browserCandidate: PreviewInspectorPageCandidate;
  readonly compositionEdges: readonly PreviewInspectorPageCompositionEdge[];
  readonly criticalSurfaces: readonly PreviewInspectorMountSurface[];
  readonly evidenceSourcePaths: readonly string[];
  readonly fidelity: PreviewInspectorPageFidelity;
  readonly routeRecipe?: PreviewInspectorRouteExecutionRecipe;
  readonly standaloneTarget?: boolean;
  readonly targetPageTabKeys: readonly string[];
  readonly watchSourcePaths: readonly string[];
}): PreviewInspectorPageExecutionCandidate {
  const roles = derivePageExecutionRoles(options);
  const executionRootSurface = options.criticalSurfaces.find(
    (surface) => surface.id === roles.executionRootSurfaceId,
  );
  if (executionRootSurface === undefined) {
    throw new TypeError('Page Execution candidate is missing its execution-root surface.');
  }
  const runtimeTargetSurface = options.criticalSurfaces.find(
    (surface) => surface.id === roles.runtimeTargetSurfaceId,
  );
  if (runtimeTargetSurface === undefined) {
    throw new TypeError('Page Execution candidate is missing its runtime-target surface.');
  }
  const executionRootContract = createPageExecutionRoleContract(executionRootSurface);
  const runtimeTargetContract = createPageExecutionRoleContract(runtimeTargetSurface);
  const browserCandidate = createCandidateSpecificBrowserRoot(
    options.browserCandidate,
    executionRootSurface,
    options.routeRecipe,
  );
  const routeRecipe =
    options.routeRecipe === undefined
      ? undefined
      : Object.freeze({
          ...options.routeRecipe,
          rootOwnsRouter: browserCandidate.rootOwnsRouter,
        });
  const id = createCandidateId(
    browserCandidate.id,
    options.fidelity,
    options.criticalSurfaces,
    executionRootContract,
    runtimeTargetContract,
    browserCandidate.root,
    routeRecipe,
    options.standaloneTarget === true,
  );
  return Object.freeze({
    browserCandidate,
    compositionEdges: Object.freeze([...options.compositionEdges]),
    criticalSurfaces: Object.freeze([...options.criticalSurfaces]),
    evidenceSourcePaths: options.evidenceSourcePaths,
    executionRootContract,
    executionRootSurfaceId: roles.executionRootSurfaceId,
    fidelity: options.fidelity,
    id,
    optionalSurfaces: Object.freeze([]),
    ...(routeRecipe === undefined ? {} : { routeRecipe }),
    runtimeTargetContract,
    runtimeTargetSurfaceId: roles.runtimeTargetSurfaceId,
    standaloneTarget: options.standaloneTarget === true,
    targetPageTabKeys: options.targetPageTabKeys,
    watchSourcePaths: options.watchSourcePaths,
  });
}

/**
 * Pins browser-facing execution metadata to the candidate's actual admitted root without mutating
 * the reusable VirtualPage candidate that supplied route and authored provenance.
 */
function createCandidateSpecificBrowserRoot(
  candidate: PreviewInspectorPageCandidate,
  executionRootSurface: PreviewInspectorMountSurface,
  routeRecipe: PreviewInspectorRouteExecutionRecipe | undefined,
): PreviewInspectorPageCandidate {
  const pinnedRoot = Object.freeze({
    exportName: executionRootSurface.exportName,
    sourcePath: path.normalize(executionRootSurface.sourcePath),
  });
  if (sameSurfaceReference(executionRootSurface, candidate.root)) return candidate;
  const {
    rootInference: omittedRootInference,
    rootStepIndex: omittedRootStepIndex,
    routeMountBasePath: omittedRouteMountBasePath,
    routeSlotCount: omittedRouteSlotCount,
    wildcardFallbackPresent: omittedWildcardFallbackPresent,
    ...shared
  } = candidate;
  void omittedRootInference;
  void omittedRootStepIndex;
  void omittedRouteMountBasePath;
  void omittedRouteSlotCount;
  void omittedWildcardFallbackPresent;
  const location = candidate.routeLocation;
  const matchingMount =
    location !== undefined && 'routeMounts' in location
      ? location.routeMounts.find(
          (mount) =>
            path.normalize(mount.sourcePath) === pinnedRoot.sourcePath &&
            mount.exportName === pinnedRoot.exportName,
        )
      : undefined;
  const sourceRouterOwnership = doesPreviewInspectorSurfaceOwnRouter(executionRootSurface);
  const rootOwnsRouter =
    sourceRouterOwnership ??
    (routeRecipe?.mounts[0]?.parentSurfaceId === executionRootSurface.id
      ? routeRecipe.rootOwnsRouter
      : false);
  return Object.freeze({
    ...shared,
    complete: false,
    root: pinnedRoot,
    rootAutomaticProps: Object.freeze({}),
    rootOwnsRouter,
    ...(matchingMount === undefined
      ? {}
      : {
          routeMountBasePath: matchingMount.basePath,
          routeSlotCount: matchingMount.routeSlotCount,
          wildcardFallbackPresent: matchingMount.hasWildcardFallback,
        }),
    stopReason: 'render-path-checkpoint',
  });
}

function derivePageExecutionRoles(options: {
  readonly browserCandidate: PreviewInspectorPageCandidate;
  readonly compositionEdges: readonly PreviewInspectorPageCompositionEdge[];
  readonly criticalSurfaces: readonly PreviewInspectorMountSurface[];
  readonly routeRecipe?: PreviewInspectorRouteExecutionRecipe;
}): {
  readonly executionRootSurfaceId: string;
  readonly runtimeTargetSurfaceId: string;
} {
  const surfacesById = new Map<string, PreviewInspectorMountSurface>();
  for (const surface of options.criticalSurfaces) {
    if (surfacesById.has(surface.id)) {
      throw new TypeError(`Duplicate Page Execution surface id: ${surface.id}`);
    }
    surfacesById.set(surface.id, surface);
  }
  const childIds = new Set(
    options.compositionEdges
      .filter(
        (edge) =>
          edge.mode !== 'contains-authored-child' &&
          surfacesById.has(edge.parentSurfaceId) &&
          surfacesById.has(edge.childSurfaceId),
      )
      .map((edge) => edge.childSurfaceId),
  );
  const executionRootSurface =
    (options.routeRecipe?.mounts[0]?.parentSurfaceId === undefined
      ? undefined
      : surfacesById.get(options.routeRecipe.mounts[0].parentSurfaceId)) ??
    options.criticalSurfaces.find((surface) => !childIds.has(surface.id)) ??
    options.criticalSurfaces[0];
  const runtimeTargetReference = options.browserCandidate.target;
  if (runtimeTargetReference === undefined) {
    throw new TypeError('Page Execution candidate does not have a compiler-owned runtime target.');
  }
  const runtimeTargetSurfaces = options.criticalSurfaces.filter((surface) =>
    sameSurfaceReference(surface, runtimeTargetReference),
  );
  if (executionRootSurface === undefined) {
    throw new TypeError('Page Execution candidate is missing its execution-root surface.');
  }
  if (runtimeTargetSurfaces.length === 0) {
    throw new TypeError('Page Execution candidate is missing its runtime-target surface.');
  }
  if (runtimeTargetSurfaces.length > 1) {
    throw new TypeError('Page Execution candidate contains duplicate runtime-target surfaces.');
  }
  return Object.freeze({
    executionRootSurfaceId: executionRootSurface.id,
    runtimeTargetSurfaceId: runtimeTargetSurfaces[0]?.id ?? '',
  });
}

/** Keeps the first execution for each stable candidate identity. */
export function deduplicateCandidates(
  candidates: readonly PreviewInspectorPageExecutionCandidate[],
): readonly PreviewInspectorPageExecutionCandidate[] {
  const identities = new Set<string>();
  return candidates.filter((candidate) => {
    const identity = candidate.criticalSurfaces.map((surface) => surface.id).join('\0');
    if (identities.has(identity)) return false;
    identities.add(identity);
    return true;
  });
}

/** Hashes execution fidelity, role contracts, surfaces, and route input without mutable runtime state. */
function createCandidateId(
  browserCandidateId: string,
  fidelity: PreviewInspectorPageFidelity,
  surfaces: readonly PreviewInspectorMountSurface[],
  executionRootContract: PreviewInspectorPageExecutionCandidate['executionRootContract'],
  runtimeTargetContract: PreviewInspectorPageExecutionCandidate['runtimeTargetContract'],
  pinnedRoot: PreviewInspectorComponentReference,
  routeRecipe?: PreviewInspectorRouteExecutionRecipe,
  standaloneTarget = false,
): string {
  return createHash('sha256')
    .update(
      [
        browserCandidateId,
        fidelity,
        executionRootContract.surfaceId,
        path.normalize(executionRootContract.sourcePath),
        executionRootContract.exportName,
        runtimeTargetContract.surfaceId,
        path.normalize(runtimeTargetContract.sourcePath),
        runtimeTargetContract.exportName,
        path.normalize(pinnedRoot.sourcePath),
        pinnedRoot.exportName,
        standaloneTarget ? 'standalone-target' : '',
        ...surfaces.map((surface) => surface.id),
        routeRecipe === undefined ? '' : JSON.stringify(routeRecipe),
      ].join('\0'),
    )
    .digest('hex')
    .slice(0, 24);
}

function createPageExecutionRoleContract(
  surface: PreviewInspectorMountSurface,
): PreviewInspectorPageExecutionCandidate['executionRootContract'] {
  return Object.freeze({
    exportName: surface.exportName,
    sourcePath: path.normalize(surface.sourcePath),
    surfaceId: surface.id,
  });
}

/** Compares normalized source/export identity independently of generated surface IDs. */
export function isSameSurface(
  left: PreviewInspectorMountSurface,
  right: PreviewInspectorMountSurface,
): boolean {
  return left.sourcePath === right.sourcePath && left.exportName === right.exportName;
}

/** Checks an optional compiler reference without inferring an export. */
export function sameSurfaceReference(
  surface: Pick<PreviewInspectorMountSurface, 'exportName' | 'sourcePath'>,
  reference: PreviewInspectorComponentReference,
): boolean {
  return (
    surface.exportName === reference.exportName &&
    path.normalize(surface.sourcePath) === path.normalize(reference.sourcePath)
  );
}
