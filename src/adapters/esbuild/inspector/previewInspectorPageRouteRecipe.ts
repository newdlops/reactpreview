/** Creates selected-route recipes without importing registries or executing authored loaders. */
import path from 'node:path';
import type {
  PreviewInspectorComponentReference,
  PreviewInspectorPageCandidate,
} from './previewInspectorAncestorTypes';
import type {
  PreviewInspectorMountSurface,
  PreviewInspectorRouteExecutionRecipe,
} from './previewInspectorPageExecutionTypes';
import type { PreviewInspectorVirtualPageCandidate } from './previewInspectorVirtualPagePlan';
import { collectPreviewInspectorRouteParameterValues } from './previewInspectorRoutePattern';
import { sameSurfaceReference } from './previewInspectorPageExecutionContracts';
import {
  deduplicateSurfaces,
  doesPreviewInspectorSurfaceOwnRouter,
  readRouteRuntime,
  readReactRouterRuntime,
} from './previewInspectorPageExecutionSurfaceEvidence';

/** Builds a loader-free selected-route recipe from admitted surfaces and exact mount evidence. */
export function createRouteRecipe(
  candidate: PreviewInspectorPageCandidate,
  routeSurfaces: readonly PreviewInspectorMountSurface[],
  pageSurface: PreviewInspectorMountSurface,
  targetSurface: PreviewInspectorMountSurface,
  derivedOwnerRouteSurface?: PreviewInspectorMountSurface,
  overlaySiblingPageSurface?: PreviewInspectorMountSurface,
): PreviewInspectorRouteExecutionRecipe | undefined {
  const location = candidate.routeLocation;
  if (location === undefined) return undefined;
  const routeRuntime = readRouteRuntime(location);
  const routeMountEvidence = 'routeMounts' in location ? (location.routeMounts ?? []) : [];
  const contentRootPath = path.normalize(pageSurface.sourcePath);
  const retainsNestedRouteOwner = routeMountEvidence.some(
    (mount) =>
      mount.contextPattern !== undefined &&
      path.normalize(mount.sourcePath) === contentRootPath &&
      mount.exportName === pageSurface.exportName,
  );
  const runtimeTargetReference = candidate.target;
  if (runtimeTargetReference === undefined) {
    throw new TypeError(
      'Page Execution route recipe does not have a compiler-owned runtime target.',
    );
  }
  const admittedSurfaces = deduplicateSurfaces([
    ...routeSurfaces,
    ...(derivedOwnerRouteSurface === undefined ? [] : [derivedOwnerRouteSurface]),
    pageSurface,
    ...(overlaySiblingPageSurface === undefined ? [] : [overlaySiblingPageSurface]),
    targetSurface,
  ]);
  const runtimeTargetSurfaces = admittedSurfaces.filter((surface) =>
    sameSurfaceReference(surface, runtimeTargetReference),
  );
  if (runtimeTargetSurfaces.length !== 1) {
    throw new TypeError(
      'Page Execution route recipe runtime target is not one unique admitted surface.',
    );
  }
  const runtimeTargetSurface = runtimeTargetSurfaces[0];
  if (runtimeTargetSurface === undefined) {
    throw new TypeError('Page Execution route recipe does not have an admitted runtime target.');
  }
  const retainedMountSurfaces = routeMountEvidence.map((mount) =>
    admittedSurfaces.find(
      (surface) =>
        path.normalize(surface.sourcePath) === path.normalize(mount.sourcePath) &&
        surface.exportName === mount.exportName,
    ),
  );
  const mounts =
    routeSurfaces.length > 0 || retainsNestedRouteOwner || derivedOwnerRouteSurface !== undefined
      ? routeMountEvidence.map((mount, index) =>
          Object.freeze({
            basePath: mount.basePath,
            childSurfaceId:
              retainedMountSurfaces[index + 1]?.id ??
              overlaySiblingPageSurface?.id ??
              runtimeTargetSurface.id,
            ...(mount.contextOrigin === undefined ? {} : { contextOrigin: mount.contextOrigin }),
            ...(mount.contextPattern === undefined ? {} : { contextPattern: mount.contextPattern }),
            hasWildcardFallback: mount.hasWildcardFallback,
            ...(retainedMountSurfaces[index] === undefined
              ? {}
              : { parentSurfaceId: retainedMountSurfaces[index].id }),
            pattern: location.pattern,
          }),
        )
      : [];
  // An App previewed by itself renders the `<Routes>` declaring the selected branch. A generated
  // parent Route at that exact path stops matching once an authored `<Navigate>` leaves the branch
  // (a signed-in App redirecting `/reset-password` to `/dashboard`), which unmounts the whole App.
  const contentRootOwnsRoutes =
    mounts.length === 0 &&
    routeSurfaces.length === 0 &&
    derivedOwnerRouteSurface === undefined &&
    path.normalize(location.sourcePath) === contentRootPath;
  const routeExecutionRoot = routeSurfaces[0];
  const executionRootOwnsRouter =
    routeExecutionRoot === undefined || sameSurfaceReference(routeExecutionRoot, candidate.root)
      ? candidate.rootOwnsRouter
      : (doesPreviewInspectorSurfaceOwnRouter(routeExecutionRoot) ?? false);
  return Object.freeze({
    ...(contentRootOwnsRoutes ? { contentRootOwnsRoutes: true as const } : {}),
    kind: routeRuntime.kind,
    loaderPolicy: 'never-execute',
    mounts: Object.freeze(mounts),
    params: Object.freeze(
      'params' in location
        ? { ...location.params }
        : collectPreviewInspectorRouteParameterValues(location.pattern, location.pathname),
    ),
    pattern: location.pattern,
    pathname: location.pathname,
    rootOwnsRouter: executionRootOwnsRouter,
    ...(routeRuntime.routerModuleSpecifier === undefined
      ? {}
      : { routerModuleSpecifier: routeRuntime.routerModuleSpecifier }),
    searchParams: Object.freeze('searchParams' in location ? { ...location.searchParams } : {}),
    targetRole: 'element',
  });
}

/**
 * Recreates a data-router error boundary only for an exact authored `errorElement` slot.
 * A normal MemoryRouter cannot provide `useRouteError()`, while importing the application router
 * would execute its complete route registry and unrelated initialization.
 */
export function createRouteErrorElementRecipe(
  virtualPage: PreviewInspectorVirtualPageCandidate,
  target: PreviewInspectorComponentReference,
): PreviewInspectorRouteExecutionRecipe | undefined {
  const normalizedTargetPath = path.normalize(target.sourcePath);
  const ownsErrorSlot = virtualPage.recipe.omittedOuterPath.some(
    (step) =>
      step.slotName === 'errorElement' &&
      step.label === target.exportName &&
      path.normalize(step.sourcePath) === normalizedTargetPath,
  );
  if (!ownsErrorSlot) return undefined;
  const runtime = readReactRouterRuntime([
    normalizedTargetPath,
    ...virtualPage.recipe.omittedOuterPath.map((step) => step.sourcePath),
  ]);
  if (runtime.kind !== 'react-router-v6' || runtime.routerModuleSpecifier === undefined) {
    return undefined;
  }
  return Object.freeze({
    kind: runtime.kind,
    loaderPolicy: 'never-execute',
    mounts: Object.freeze([]),
    params: Object.freeze({}),
    pattern: '*',
    pathname: '/',
    rootOwnsRouter: false,
    routerModuleSpecifier: runtime.routerModuleSpecifier,
    searchParams: Object.freeze({}),
    targetRole: 'error-element',
  });
}
