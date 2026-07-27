/* eslint-disable jsdoc/require-jsdoc */
/** Creates bounded Page Execution Slice candidates from one selected browser path. */
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import type { PreviewInspectorAncestorPlan } from './previewInspectorAncestorPlan';
import type {
  PreviewInspectorComponentReference,
  PreviewInspectorPageCandidate,
} from './previewInspectorAncestorTypes';
import { createPreviewInspectorPagePathSegments } from './previewInspectorPagePathSegments';
import { resolvePreviewReactLocalComponentSurface } from '../staticResources/previewReactLocalComponentSurface';
import {
  createPreviewInspectorVirtualPageCandidates,
  type PreviewInspectorVirtualPageCandidate,
} from './previewInspectorVirtualPagePlan';
import type {
  PreviewInspectorMountSurface,
  PreviewInspectorPageCompositionEdge,
  PreviewInspectorPageExecutionCandidate,
  PreviewInspectorPageFidelity,
  PreviewInspectorRouteExecutionRecipe,
} from './previewInspectorPageExecutionTypes';
import { collectPreviewInspectorRouteParameterValues } from './previewInspectorRoutePattern';

export interface CreatePreviewInspectorPageExecutionCandidatesOptions {
  readonly plan: PreviewInspectorAncestorPlan;
  readonly selectedPageCandidateId?: string;
}

/**
 * Returns candidates in descending fidelity. Application-entry segments are intentionally never
 * converted into a surface, so increasing a source graph above the selected route cannot create a
 * new automatic executable root.
 */
export function createPreviewInspectorPageExecutionCandidates(
  options: CreatePreviewInspectorPageExecutionCandidatesOptions,
): readonly PreviewInspectorPageExecutionCandidate[] {
  const virtualPage = selectVirtualPageCandidate(options.plan, options.selectedPageCandidateId);
  if (virtualPage === undefined) return Object.freeze([]);
  const browserCandidate = virtualPage.browserCandidate;
  const segments = createPreviewInspectorPagePathSegments({
    candidate: browserCandidate,
    plan: options.plan,
  });
  const targetSurface = createAuthenticSurface(options.plan.target, 'target');
  const pageSurface = createAuthenticSurface(virtualPage.contentCandidate.root, 'page');
  const pageSlicedSurface = createSelectedExportSurface(virtualPage.contentCandidate.root, 'page');
  const pageLocalSurface = createLocalComponentSurface(virtualPage.contentCandidate.root, 'page');
  const detachedRouteLeaf = isDetachedRouteLeaf(browserCandidate, options.plan.target);
  const routeSurfaces = detachedRouteLeaf
    ? Object.freeze([])
    : createRouteSurfaces(browserCandidate);
  const routeElementSurfaces = createRouteElementSurfaces(browserCandidate);
  const frameworkSurfaces = createFrameworkSurfaces(browserCandidate);
  const shellSurfaces = createShellSurfaces(virtualPage);
  const contextualTargetSurfaces = detachedRouteLeaf ? [] : [targetSurface];
  const frameworkEdges = createFrameworkCompositionEdges(
    browserCandidate,
    frameworkSurfaces,
    pageSurface,
  );
  const slicedFrameworkEdges = createFrameworkCompositionEdges(
    browserCandidate,
    frameworkSurfaces,
    pageSlicedSurface,
  );
  const localFrameworkEdges =
    pageLocalSurface === undefined
      ? []
      : createFrameworkCompositionEdges(browserCandidate, frameworkSurfaces, pageLocalSurface);
  const routeRecipe = createRouteRecipe(browserCandidate, routeSurfaces, pageSurface);
  const shellEdges = createShellCompositionEdges(virtualPage, shellSurfaces, pageSurface);
  const outerPageSurface = readOuterPageSurface(shellSurfaces, shellEdges, pageSurface);
  const routeElementEdges = createRouteElementCompositionEdges(
    routeElementSurfaces,
    outerPageSurface,
  );
  const routeElementRoot = routeElementSurfaces[0] ?? outerPageSurface;
  const routeEdges = createRouteCompositionEdges(routeSurfaces, routeElementRoot);
  const pageTargetEdge = detachedRouteLeaf
    ? undefined
    : createPageTargetEdge(pageSurface, targetSurface);
  const slicedShellEdges = createShellCompositionEdges(
    virtualPage,
    shellSurfaces,
    pageSlicedSurface,
  );
  const slicedOuterPageSurface = readOuterPageSurface(
    shellSurfaces,
    slicedShellEdges,
    pageSlicedSurface,
  );
  const slicedRouteElementEdges = createRouteElementCompositionEdges(
    routeElementSurfaces,
    slicedOuterPageSurface,
  );
  const slicedRouteElementRoot = routeElementSurfaces[0] ?? slicedOuterPageSurface;
  const slicedRouteEdges = createRouteCompositionEdges(routeSurfaces, slicedRouteElementRoot);
  const slicedPageTargetEdge = detachedRouteLeaf
    ? undefined
    : createPageTargetEdge(pageSlicedSurface, targetSurface);
  const localShellEdges =
    pageLocalSurface === undefined
      ? []
      : createShellCompositionEdges(virtualPage, shellSurfaces, pageLocalSurface);
  const localOuterPageSurface =
    pageLocalSurface === undefined
      ? undefined
      : readOuterPageSurface(shellSurfaces, localShellEdges, pageLocalSurface);
  const localRouteElementEdges =
    localOuterPageSurface === undefined
      ? []
      : createRouteElementCompositionEdges(routeElementSurfaces, localOuterPageSurface);
  const localPageTargetEdge =
    pageLocalSurface === undefined || detachedRouteLeaf
      ? undefined
      : createPageTargetEdge(pageLocalSurface, targetSurface);
  const evidenceSourcePaths = Object.freeze(
    [...new Set(segments.flatMap((segment) => segment.evidenceSourcePaths))].sort(),
  );
  const watchSourcePaths = Object.freeze(
    [
      ...new Set([
        ...evidenceSourcePaths,
        ...routeSurfaces.flatMap((surface) => surface.watchSourcePaths),
        ...routeElementSurfaces.flatMap((surface) => surface.watchSourcePaths),
        ...shellSurfaces.flatMap((surface) => surface.watchSourcePaths),
        ...pageSurface.watchSourcePaths,
        ...targetSurface.watchSourcePaths,
      ]),
    ].sort(),
  );
  const candidates: PreviewInspectorPageExecutionCandidate[] = [];
  if (routeSurfaces.length > 0) {
    candidates.push(
      createCandidate({
        browserCandidate,
        compositionEdges: [
          ...routeEdges,
          ...routeElementEdges,
          ...frameworkEdges,
          ...shellEdges,
          ...(pageTargetEdge === undefined ? [] : [pageTargetEdge]),
        ],
        criticalSurfaces: deduplicateSurfaces([
          ...routeSurfaces,
          ...routeElementSurfaces,
          ...frameworkSurfaces,
          ...shellSurfaces,
          pageSurface,
          ...contextualTargetSurfaces,
        ]),
        evidenceSourcePaths,
        fidelity: 'route-page-authentic',
        ...(routeRecipe === undefined ? {} : { routeRecipe }),
        watchSourcePaths,
      }),
    );
    candidates.push(
      createCandidate({
        browserCandidate,
        compositionEdges: [
          ...slicedRouteEdges,
          ...slicedRouteElementEdges,
          ...slicedFrameworkEdges,
          ...slicedShellEdges,
          ...(slicedPageTargetEdge === undefined ? [] : [slicedPageTargetEdge]),
        ],
        criticalSurfaces: deduplicateSurfaces([
          ...routeSurfaces,
          ...routeElementSurfaces,
          ...frameworkSurfaces,
          ...shellSurfaces,
          pageSlicedSurface,
          ...contextualTargetSurfaces,
        ]),
        evidenceSourcePaths,
        fidelity: 'route-page-sliced',
        ...(routeRecipe === undefined ? {} : { routeRecipe }),
        watchSourcePaths,
      }),
    );
  }
  // A page can be the selected target itself while still requiring a proven shell or framework
  // surface.  Do not collapse that route/layout context to target-only merely because both leaves
  // share a module/export identity.
  if (
    !isSameSurface(pageSurface, targetSurface) ||
    routeElementSurfaces.length > 0 ||
    frameworkSurfaces.length > 0 ||
    shellSurfaces.length > 0
  ) {
    candidates.push(
      createCandidate({
        browserCandidate,
        compositionEdges: [
          ...routeElementEdges,
          ...frameworkEdges,
          ...shellEdges,
          ...(pageTargetEdge === undefined ? [] : [pageTargetEdge]),
        ],
        criticalSurfaces: deduplicateSurfaces([
          ...routeElementSurfaces,
          ...frameworkSurfaces,
          ...shellSurfaces,
          pageSurface,
          ...contextualTargetSurfaces,
        ]),
        evidenceSourcePaths,
        fidelity: 'page-authentic',
        ...(routeRecipe === undefined ? {} : { routeRecipe }),
        watchSourcePaths,
      }),
    );
    candidates.push(
      createCandidate({
        browserCandidate,
        compositionEdges: [
          ...slicedRouteElementEdges,
          ...slicedFrameworkEdges,
          ...slicedShellEdges,
          ...(slicedPageTargetEdge === undefined ? [] : [slicedPageTargetEdge]),
        ],
        criticalSurfaces: deduplicateSurfaces([
          ...routeElementSurfaces,
          ...shellSurfaces,
          pageSlicedSurface,
          ...contextualTargetSurfaces,
        ]),
        evidenceSourcePaths,
        fidelity: 'page-sliced',
        ...(routeRecipe === undefined ? {} : { routeRecipe }),
        watchSourcePaths,
      }),
    );
    if (pageLocalSurface !== undefined) {
      candidates.push(
        createCandidate({
          browserCandidate,
          compositionEdges: [
            ...localRouteElementEdges,
            ...localFrameworkEdges,
            ...localShellEdges,
            ...(localPageTargetEdge === undefined ? [] : [localPageTargetEdge]),
          ],
          criticalSurfaces: deduplicateSurfaces([
            ...routeElementSurfaces,
            ...shellSurfaces,
            ...frameworkSurfaces,
            pageLocalSurface,
            ...contextualTargetSurfaces,
          ]),
          evidenceSourcePaths,
          fidelity: 'target-contextual',
          ...(routeRecipe === undefined ? {} : { routeRecipe }),
          watchSourcePaths,
        }),
      );
    }
  }
  candidates.push(
    createCandidate({
      browserCandidate,
      compositionEdges: [],
      criticalSurfaces: [targetSurface],
      evidenceSourcePaths,
      fidelity: 'target-only',
      ...(routeRecipe === undefined ? {} : { routeRecipe }),
      watchSourcePaths: targetSurface.watchSourcePaths,
    }),
  );
  return Object.freeze(
    deduplicateCandidates(candidates).map((candidate) =>
      attachOptionalSurfaces(candidate, options.plan),
    ),
  );
}

/**
 * Carries only visually proven, non-route-alternative children into Frontier v2's optional
 * transaction. They are not composition edges: a candidate remains renderable when every one is
 * projected, while an admitted child can retain its authored dynamic/static closure.
 */
function attachOptionalSurfaces(
  candidate: PreviewInspectorPageExecutionCandidate,
  plan: PreviewInspectorAncestorPlan,
): PreviewInspectorPageExecutionCandidate {
  const criticalSourcePaths = new Set(
    candidate.criticalSurfaces.map((surface) => path.normalize(surface.sourcePath)),
  );
  const criticalIdentities = new Set(
    candidate.criticalSurfaces.map(
      (surface) => `${path.normalize(surface.sourcePath)}\0${surface.exportName}`,
    ),
  );
  const optionalSurfaces = (plan.shallowVisualPaths ?? [])
    .filter(
      (visualPath) =>
        visualPath.relation !== 'route-alternative' &&
        criticalSourcePaths.has(path.normalize(visualPath.importerPath)),
    )
    .sort(compareOptionalVisualPaths)
    .flatMap((visualPath) => {
      const reference = {
        exportName: visualPath.exportName,
        sourcePath: path.normalize(visualPath.sourcePath),
      };
      const identity = `${reference.sourcePath}\0${reference.exportName}`;
      return criticalIdentities.has(identity)
        ? []
        : [createModuleFallbackSurface(reference, 'optional')];
    });
  const identities = new Set<string>();
  const uniqueSurfaces = optionalSurfaces.filter((surface) => {
    const identity = `${surface.sourcePath}\0${surface.exportName}`;
    if (identities.has(identity)) return false;
    identities.add(identity);
    return true;
  });
  if (uniqueSurfaces.length === 0) return candidate;
  return Object.freeze({
    ...candidate,
    optionalSurfaces: Object.freeze(uniqueSurfaces),
    watchSourcePaths: Object.freeze(
      [
        ...new Set([
          ...candidate.watchSourcePaths,
          ...uniqueSurfaces.flatMap((surface) => surface.watchSourcePaths),
        ]),
      ].sort(),
    ),
  });
}

function compareOptionalVisualPaths(
  left: NonNullable<PreviewInspectorAncestorPlan['shallowVisualPaths']>[number],
  right: NonNullable<PreviewInspectorAncestorPlan['shallowVisualPaths']>[number],
): number {
  return (
    path.normalize(left.importerPath).localeCompare(path.normalize(right.importerPath)) ||
    left.occurrenceStart - right.occurrenceStart ||
    path.normalize(left.sourcePath).localeCompare(path.normalize(right.sourcePath)) ||
    left.exportName.localeCompare(right.exportName)
  );
}

function selectVirtualPageCandidate(
  plan: PreviewInspectorAncestorPlan,
  selectedPageCandidateId: string | undefined,
): PreviewInspectorVirtualPageCandidate | undefined {
  const virtualPages = createPreviewInspectorVirtualPageCandidates(
    plan.pageCandidates,
    plan.pageCandidates.length,
    plan.shallowVisualPaths ?? [],
  );
  return (
    (selectedPageCandidateId === undefined
      ? undefined
      : virtualPages.find(
          (candidate) => candidate.browserCandidate.id === selectedPageCandidateId,
        )) ?? virtualPages[0]
  );
}

function createAuthenticSurface(
  reference: PreviewInspectorComponentReference,
  prefix: string,
): PreviewInspectorMountSurface {
  const sourcePath = path.normalize(reference.sourcePath);
  return Object.freeze({
    bypassedWrapperNames: Object.freeze([]),
    exportName: reference.exportName,
    id: createSurfaceId(prefix, reference),
    omittedTopLevelEffectCount: 0,
    sourcePath,
    strategy: 'authentic-module-export',
    watchSourcePaths: Object.freeze([sourcePath]),
  });
}

/** Uses a virtual same-file closure for the selected page export; load-time parsing can fail closed. */
function createSelectedExportSurface(
  reference: PreviewInspectorComponentReference,
  prefix: string,
): PreviewInspectorMountSurface {
  const sourcePath = path.normalize(reference.sourcePath);
  return Object.freeze({
    bypassedWrapperNames: Object.freeze([]),
    exportName: reference.exportName,
    id: createSurfaceId(`${prefix}-slice`, reference),
    omittedTopLevelEffectCount: 0,
    sourcePath,
    strategy: 'selected-export-slice',
    watchSourcePaths: Object.freeze([sourcePath]),
  });
}

/** Reads a bounded same-file local HOC body; unknown wrappers remain outside automatic variants. */
function createLocalComponentSurface(
  reference: PreviewInspectorComponentReference,
  prefix: string,
): PreviewInspectorMountSurface | undefined {
  const sourceText = readSource(reference.sourcePath);
  if (sourceText === undefined) return undefined;
  const resolved = resolvePreviewReactLocalComponentSurface({
    exportName: reference.exportName,
    sourcePath: reference.sourcePath,
    sourceText,
  });
  if (resolved?.localName === undefined || resolved.bypassedWrapperNames.length === 0)
    return undefined;
  const sourcePath = path.normalize(reference.sourcePath);
  return Object.freeze({
    bypassedWrapperNames: resolved.bypassedWrapperNames,
    exportName: 'default',
    id: `${createSurfaceId(`${prefix}-local`, reference)}:${resolved.localName}`,
    localName: resolved.localName,
    omittedTopLevelEffectCount: 0,
    preservedWrapperKinds: resolved.preservedWrapperKinds,
    sourcePath,
    strategy: 'inner-local-component-slice',
    watchSourcePaths: Object.freeze([sourcePath]),
  });
}

/** Limits candidate analysis to the same source ceiling as Frontier v2. */
function readSource(sourcePath: string): string | undefined {
  try {
    const sourceText = readFileSync(sourcePath, 'utf8');
    return Buffer.byteLength(sourceText, 'utf8') <= 1024 * 1024 ? sourceText : undefined;
  } catch {
    return undefined;
  }
}

function createRouteSurfaces(
  candidate: PreviewInspectorPageCandidate,
): readonly PreviewInspectorMountSurface[] {
  const mounts =
    candidate.routeLocation !== undefined && 'routeMounts' in candidate.routeLocation
      ? (candidate.routeLocation.routeMounts ?? [])
      : [];
  const references = mounts.map((mount) => ({
    exportName: mount.exportName,
    sourcePath: mount.sourcePath,
  }));
  const seen = new Set<string>();
  return Object.freeze(
    references
      .filter((reference) => {
        const key = `${path.normalize(reference.sourcePath)}\0${reference.exportName}`;
        if (seen.has(key)) return false;
        seen.add(key);
        return (
          path.normalize(reference.sourcePath) !== path.normalize(candidate.root.sourcePath) ||
          reference.exportName !== candidate.root.exportName
        );
      })
      .map((reference) => createModuleFallbackSurface(reference, 'route')),
  );
}

/** Converts inline `<Layout><Page /></Layout>` route composition into isolated wrapper slices. */
function createRouteElementSurfaces(
  candidate: PreviewInspectorPageCandidate,
): readonly PreviewInspectorMountSurface[] {
  const location = candidate.routeLocation;
  const wrappers =
    location !== undefined && 'elementWrappers' in location ? (location.elementWrappers ?? []) : [];
  return deduplicateSurfaces(
    wrappers.map((wrapper) =>
      createSelectedExportSurface(
        { exportName: wrapper.exportName, sourcePath: wrapper.sourcePath },
        'route-element',
      ),
    ),
  );
}

/** Retains only framework-mandated implicit layouts or `_app` surfaces for legacy composition. */
function createFrameworkSurfaces(
  candidate: PreviewInspectorPageCandidate,
): readonly PreviewInspectorMountSurface[] {
  const references = [
    ...(candidate.nextAppLayoutChain ?? []).map((layout) => ({
      exportName: layout.exportName,
      sourcePath: layout.sourcePath,
    })),
    ...(candidate.nextPagesShell === undefined ? [] : [candidate.nextPagesShell.app]),
  ];
  return Object.freeze(
    references.map((reference) => createAuthenticSurface(reference, 'framework')),
  );
}

/**
 * Next layouts and Pages `_app` are framework-owned composition boundaries, rather than loose
 * imports.  Keeping their exact edge here lets the generic execution root mount the selected page
 * below the framework surface without importing an application entry or route registry.
 */
function createFrameworkCompositionEdges(
  candidate: PreviewInspectorPageCandidate,
  frameworkSurfaces: readonly PreviewInspectorMountSurface[],
  pageSurface: PreviewInspectorMountSurface,
): readonly PreviewInspectorPageCompositionEdge[] {
  if (frameworkSurfaces.length === 0) return Object.freeze([]);
  const isNextPages = candidate.nextPagesShell !== undefined;
  return Object.freeze(
    frameworkSurfaces.map((surface, index) =>
      Object.freeze({
        childSurfaceId: frameworkSurfaces[index + 1]?.id ?? pageSurface.id,
        mode: isNextPages ? ('component-prop-slot' as const) : ('next-layout-slot' as const),
        parentSurfaceId: surface.id,
        placementIndex: index,
        ...(isNextPages ? { slotName: 'Component' } : {}),
      }),
    ),
  );
}

/** Preserves the legacy VirtualPage shell inventory as exact Page Execution surfaces. */
function createShellSurfaces(
  virtualPage: PreviewInspectorVirtualPageCandidate,
): readonly PreviewInspectorMountSurface[] {
  return Object.freeze(
    virtualPage.recipe.shells.map((shell) => createModuleFallbackSurface(shell.root, 'shell')),
  );
}

/**
 * A route recipe may retain an imported local name when static evidence cannot prove whether the
 * authored module exports that name or its default. Keep that legacy-compatible uncertainty at the
 * mount boundary instead of turning a valid default-exported layout into a build failure.
 */
function createModuleFallbackSurface(
  reference: PreviewInspectorComponentReference,
  prefix: string,
): PreviewInspectorMountSurface {
  const sourcePath = path.normalize(reference.sourcePath);
  return Object.freeze({
    bypassedWrapperNames: Object.freeze([]),
    exportName: reference.exportName,
    id: createSurfaceId(prefix, reference),
    omittedTopLevelEffectCount: 0,
    sourcePath,
    strategy: 'selected-route-surface',
    watchSourcePaths: Object.freeze([sourcePath]),
  });
}

/**
 * Translates an already-proven VirtualPage recipe without re-inferring its JSX relationships.
 * Owner shells intentionally keep their authored descendants and merely record that fact here.
 */
function createShellCompositionEdges(
  virtualPage: PreviewInspectorVirtualPageCandidate,
  shellSurfaces: readonly PreviewInspectorMountSurface[],
  pageSurface: PreviewInspectorMountSurface,
): readonly PreviewInspectorPageCompositionEdge[] {
  const edges: PreviewInspectorPageCompositionEdge[] = [];
  let current = pageSurface;
  for (let index = shellSurfaces.length - 1; index >= 0; index -= 1) {
    const shell = shellSurfaces[index];
    const recipe = virtualPage.recipe.shells[index];
    if (shell === undefined || recipe === undefined) continue;
    if (recipe.relation === 'sibling') {
      edges.push(
        Object.freeze({
          childSurfaceId: shell.id,
          mode: recipe.placement === 'after' ? 'sibling-after' : 'sibling-before',
          parentSurfaceId: current.id,
          placementIndex: index,
        }),
      );
      continue;
    }
    edges.push(
      Object.freeze({
        childSurfaceId: current.id,
        mode: recipe.relation === 'owner' ? 'contains-authored-child' : 'children-slot',
        parentSurfaceId: shell.id,
        placementIndex: index,
      }),
    );
    current = shell;
  }
  return Object.freeze(edges);
}

/** Finds the live outer surface after wrapper/owner shell composition. */
function readOuterPageSurface(
  shellSurfaces: readonly PreviewInspectorMountSurface[],
  shellEdges: readonly PreviewInspectorPageCompositionEdge[],
  pageSurface: PreviewInspectorMountSurface,
): PreviewInspectorMountSurface {
  const childSurfaceIds = new Set(
    shellEdges
      .filter((edge) => edge.mode !== 'contains-authored-child')
      .map((edge) => edge.childSurfaceId),
  );
  return shellSurfaces.find((surface) => !childSurfaceIds.has(surface.id)) ?? pageSurface;
}

/** Composes statically authored inline route wrappers through the same `children` slots they used. */
function createRouteElementCompositionEdges(
  surfaces: readonly PreviewInspectorMountSurface[],
  pageSurface: PreviewInspectorMountSurface,
): readonly PreviewInspectorPageCompositionEdge[] {
  return Object.freeze(
    surfaces.map((surface, index) =>
      Object.freeze({
        childSurfaceId: surfaces[index + 1]?.id ?? pageSurface.id,
        mode: 'children-slot' as const,
        parentSurfaceId: surface.id,
        placementIndex: index,
      }),
    ),
  );
}

/** Identifies a route page discovered below the selected router owner, not around the editor target. */
function isDetachedRouteLeaf(
  candidate: PreviewInspectorPageCandidate,
  target: PreviewInspectorComponentReference,
): boolean {
  const location = candidate.routeLocation;
  if (location === undefined || !('componentSourcePath' in location)) {
    return false;
  }
  const leafExportName = location.componentExportName ?? 'default';
  return (
    path.normalize(candidate.root.sourcePath) === path.normalize(location.componentSourcePath) &&
    candidate.root.exportName === leafExportName &&
    (path.normalize(candidate.root.sourcePath) !== path.normalize(target.sourcePath) ||
      candidate.root.exportName !== target.exportName)
  );
}

/** Keeps one source/export identity in the execution import list. */
function deduplicateSurfaces(
  surfaces: readonly PreviewInspectorMountSurface[],
): readonly PreviewInspectorMountSurface[] {
  const identities = new Set<string>();
  return Object.freeze(
    surfaces.filter((surface) => {
      const identity = `${path.normalize(surface.sourcePath)}\0${surface.exportName}`;
      if (identities.has(identity)) return false;
      identities.add(identity);
      return true;
    }),
  );
}

function createRouteRecipe(
  candidate: PreviewInspectorPageCandidate,
  routeSurfaces: readonly PreviewInspectorMountSurface[],
  pageSurface: PreviewInspectorMountSurface,
): PreviewInspectorRouteExecutionRecipe | undefined {
  const location = candidate.routeLocation;
  if (location === undefined) return undefined;
  const routeRuntime = readRouteRuntime(location);
  const mounts =
    'routeMounts' in location && routeSurfaces.length > 0
      ? (location.routeMounts ?? []).map((mount, index) =>
          Object.freeze({
            basePath: mount.basePath,
            childSurfaceId: routeSurfaces[index + 1]?.id ?? pageSurface.id,
            hasWildcardFallback: mount.hasWildcardFallback,
            ...(routeSurfaces[index] === undefined
              ? {}
              : { parentSurfaceId: routeSurfaces[index].id }),
            pattern: location.pattern,
          }),
        )
      : [];
  return Object.freeze({
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
    rootOwnsRouter: candidate.rootOwnsRouter,
    ...(routeRuntime.routerModuleSpecifier === undefined
      ? {}
      : { routerModuleSpecifier: routeRuntime.routerModuleSpecifier }),
    searchParams: Object.freeze('searchParams' in location ? { ...location.searchParams } : {}),
  });
}

/** Distinguishes only statically authored v5/v6 route syntax; unknown routers stay generic. */
function readRouteRuntime(
  location: NonNullable<PreviewInspectorPageCandidate['routeLocation']>,
): Pick<PreviewInspectorRouteExecutionRecipe, 'kind' | 'routerModuleSpecifier'> {
  if (location.evidenceKind === 'next-app-filesystem') return { kind: 'next-app' };
  if (
    location.evidenceKind === 'next-pages-filesystem' ||
    location.evidenceKind === 'next-pages-synthetic'
  )
    return { kind: 'next-pages' };
  const sources = [
    location.sourcePath,
    ...('routeMounts' in location
      ? (location.routeMounts ?? []).map((mount) => mount.sourcePath)
      : []),
  ];
  const sourceText = sources
    .map(readSource)
    .filter((value): value is string => value !== undefined)
    .join('\n');
  const routerModuleSpecifier = /from\s*['"]react-router-dom['"]/u.test(sourceText)
    ? 'react-router-dom'
    : /from\s*['"]react-router['"]/u.test(sourceText)
      ? 'react-router'
      : undefined;
  if (routerModuleSpecifier === undefined) return { kind: 'generic-memory-location' };
  if (/\b(?:Routes|RouterProvider|create(?:Browser|Hash|Memory)Router)\b/u.test(sourceText))
    return { kind: 'react-router-v6', routerModuleSpecifier };
  if (/\b(?:Switch|withRouter)\b|\b(?:component|render)\s*=/u.test(sourceText))
    return { kind: 'react-router-v5', routerModuleSpecifier };
  return { kind: 'generic-memory-location' };
}

function createRouteCompositionEdges(
  routeSurfaces: readonly PreviewInspectorMountSurface[],
  pageSurface: PreviewInspectorMountSurface,
): readonly PreviewInspectorPageCompositionEdge[] {
  return Object.freeze(
    routeSurfaces.map((surface, index) =>
      Object.freeze({
        childSurfaceId: routeSurfaces[index + 1]?.id ?? pageSurface.id,
        mode: 'route-outlet' as const,
        parentSurfaceId: surface.id,
        placementIndex: index,
      }),
    ),
  );
}

function createPageTargetEdge(
  pageSurface: PreviewInspectorMountSurface,
  targetSurface: PreviewInspectorMountSurface,
): PreviewInspectorPageCompositionEdge | undefined {
  if (isSameSurface(pageSurface, targetSurface)) return undefined;
  return Object.freeze({
    childSurfaceId: targetSurface.id,
    mode: 'contains-authored-child',
    parentSurfaceId: pageSurface.id,
    placementIndex: 0,
  });
}

function createCandidate(options: {
  readonly browserCandidate: PreviewInspectorPageCandidate;
  readonly compositionEdges: readonly PreviewInspectorPageCompositionEdge[];
  readonly criticalSurfaces: readonly PreviewInspectorMountSurface[];
  readonly evidenceSourcePaths: readonly string[];
  readonly fidelity: PreviewInspectorPageFidelity;
  readonly routeRecipe?: PreviewInspectorRouteExecutionRecipe;
  readonly watchSourcePaths: readonly string[];
}): PreviewInspectorPageExecutionCandidate {
  const id = createCandidateId(
    options.browserCandidate.id,
    options.fidelity,
    options.criticalSurfaces,
    options.routeRecipe,
  );
  return Object.freeze({
    browserCandidate: options.browserCandidate,
    compositionEdges: Object.freeze([...options.compositionEdges]),
    criticalSurfaces: Object.freeze([...options.criticalSurfaces]),
    evidenceSourcePaths: options.evidenceSourcePaths,
    fidelity: options.fidelity,
    id,
    optionalSurfaces: Object.freeze([]),
    ...(options.routeRecipe === undefined ? {} : { routeRecipe: options.routeRecipe }),
    watchSourcePaths: options.watchSourcePaths,
  });
}

function deduplicateCandidates(
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

function createSurfaceId(prefix: string, reference: PreviewInspectorComponentReference): string {
  return `${prefix}:${createHash('sha256')
    .update(`${path.normalize(reference.sourcePath)}\0${reference.exportName}`)
    .digest('hex')
    .slice(0, 20)}`;
}

function createCandidateId(
  browserCandidateId: string,
  fidelity: PreviewInspectorPageFidelity,
  surfaces: readonly PreviewInspectorMountSurface[],
  routeRecipe?: PreviewInspectorRouteExecutionRecipe,
): string {
  return createHash('sha256')
    .update(
      [
        browserCandidateId,
        fidelity,
        ...surfaces.map((surface) => surface.id),
        routeRecipe === undefined ? '' : JSON.stringify(routeRecipe),
      ].join('\0'),
    )
    .digest('hex')
    .slice(0, 24);
}

function isSameSurface(
  left: PreviewInspectorMountSurface,
  right: PreviewInspectorMountSurface,
): boolean {
  return left.sourcePath === right.sourcePath && left.exportName === right.exportName;
}
