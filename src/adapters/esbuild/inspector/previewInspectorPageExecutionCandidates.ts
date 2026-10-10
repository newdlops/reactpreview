/* eslint-disable jsdoc/require-jsdoc */
/** Creates bounded Page Execution Slice candidates from one selected browser path. */
import path from 'node:path';
import type { PreviewInspectorAncestorPlan } from './previewInspectorAncestorPlan';
import type {
  PreviewInspectorComponentReference,
  PreviewInspectorPageCandidate,
} from './previewInspectorAncestorTypes';
import type { PreviewInspectorRouteMountEvidence } from './previewInspectorRouteLocationTypes';
import type { PreviewInspectorTargetMode } from '../../../domain/preview';
import { createPreviewInspectorPagePathSegments } from './previewInspectorPagePathSegments';
import { collectPreviewInspectorRouteFactoryChoices } from './previewInspectorRouteFactoryChoices';
import {
  localizePreviewInspectorRoutePathname,
  relativizePreviewInspectorRoutePattern,
} from './previewInspectorRoutePatternMatch';
import {
  createPreviewInspectorVirtualPageCandidates,
  type PreviewInspectorVirtualPageCandidate,
} from './previewInspectorVirtualPagePlan';
import type {
  PreviewInspectorMountSurface,
  PreviewInspectorPageCompositionEdge,
  PreviewInspectorPageExecutionCandidate,
} from './previewInspectorPageExecutionTypes';
import { selectPreviewInspectorRouteShellSurfaces } from './previewInspectorRouteShellSelection';

import {
  createAuthenticSurface,
  createSelectedExportSurface,
  createLocalComponentSurface,
  createTransientContextSurface,
  readSource,
  collectPreviewInspectorTargetPageTabKeys,
  createModuleFallbackSurface,
  deduplicateSurfaces,
} from './previewInspectorPageExecutionSurfaceEvidence';
import {
  createCandidate,
  deduplicateCandidates,
  isSameSurface,
} from './previewInspectorPageExecutionContracts';
import {
  createRouteRecipe,
  createRouteErrorElementRecipe,
} from './previewInspectorPageRouteRecipe';

export interface CreatePreviewInspectorPageExecutionCandidatesOptions {
  readonly plan: PreviewInspectorAncestorPlan;
  readonly selectedPageCandidateId?: string;
  readonly targetMode?: PreviewInspectorTargetMode;
}

interface PreviewInspectorDerivedOwnerRouteMount {
  readonly evidence: PreviewInspectorRouteMountEvidence;
  readonly surface: PreviewInspectorMountSurface;
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
  const unmountedBrowserCandidate = attachCompilerOwnedRuntimeTarget(
    virtualPage,
    options.plan.target,
    options.targetMode,
  );
  const segments = createPreviewInspectorPagePathSegments({
    candidate: unmountedBrowserCandidate,
    plan: options.plan,
  });
  const renderPath =
    unmountedBrowserCandidate.renderPath ??
    options.plan.renderChainsByExport[options.plan.target.exportName]?.paths[0] ??
    options.plan.renderChain.paths[0];
  const targetPageTabKeys = collectPreviewInspectorTargetPageTabKeys(renderPath);
  const targetSurface = createAuthenticSurface(unmountedBrowserCandidate.target, 'target');
  const standaloneTarget =
    options.plan.renderChain.reachability === 'entry-unreachable' &&
    !options.plan.renderChain.truncated;
  const pageSurface = createAuthenticSurface(virtualPage.contentCandidate.root, 'page');
  const pageSlicedSurface = createSelectedExportSurface(virtualPage.contentCandidate.root, 'page');
  const pageLocalSurface = createLocalComponentSurface(virtualPage.contentCandidate.root, 'page');
  const transientContextSurface = createTransientContextSurface(
    renderPath,
    unmountedBrowserCandidate,
    unmountedBrowserCandidate.target,
  );
  const isRouteLeafDetachedFromTarget =
    unmountedBrowserCandidate.detachedTargetPlacement === undefined &&
    isDetachedRouteLeaf(unmountedBrowserCandidate, options.plan.target);
  const retainsRenderedTargetWithinRouteLeaf =
    isRouteLeafDetachedFromTarget &&
    hasProvenNestedRouteTarget(unmountedBrowserCandidate, options.plan.target);
  const detachedRouteLeaf = isRouteLeafDetachedFromTarget && !retainsRenderedTargetWithinRouteLeaf;
  const detachedCatalogOwnerRetained = hasRetainedDetachedCatalogOwner(unmountedBrowserCandidate);
  const routeSurfaces =
    detachedRouteLeaf && !detachedCatalogOwnerRetained
      ? Object.freeze([])
      : createRouteSurfaces(unmountedBrowserCandidate);
  const routeElementSurfaces = createRouteElementSurfaces(unmountedBrowserCandidate);
  const frameworkSurfaces = createFrameworkSurfaces(unmountedBrowserCandidate);
  const discoveredShellSurfaces = createShellSurfaces(virtualPage);
  const derivedOwnerRouteMount = collectVirtualPageOwnerRouteMount(
    unmountedBrowserCandidate,
    virtualPage,
    discoveredShellSurfaces,
  );
  const shellSurfaces =
    unmountedBrowserCandidate.routeLocation === undefined
      ? discoveredShellSurfaces
      : selectPreviewInspectorRouteShellSurfaces({
          hasAuthoredRouteOwner: routeSurfaces.length > 0,
          ...(derivedOwnerRouteMount === undefined
            ? {}
            : { ownerSurface: derivedOwnerRouteMount.surface }),
          routeCompositionSurfaces: [
            ...routeSurfaces,
            ...routeElementSurfaces,
            ...frameworkSurfaces,
          ],
          shells: virtualPage.recipe.shells,
          surfaces: discoveredShellSurfaces,
        });
  const browserCandidate = attachVirtualPageOwnerRouteMount(
    unmountedBrowserCandidate,
    derivedOwnerRouteMount,
  );
  const contextualTargetSurfaces =
    detachedRouteLeaf && !detachedCatalogOwnerRetained ? [] : [targetSurface];
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
  const shellEdges = createShellCompositionEdges(virtualPage, shellSurfaces, pageSurface);
  const outerPageSurface = readOuterPageSurface(shellSurfaces, shellEdges, pageSurface);
  const routeRecipe = createRouteRecipe(
    browserCandidate,
    routeSurfaces,
    pageSurface,
    targetSurface,
    derivedOwnerRouteMount?.surface,
    browserCandidate.detachedTargetPlacement === 'overlay-sibling' ? outerPageSurface : undefined,
  );
  const routeErrorElementRecipe = createRouteErrorElementRecipe(virtualPage, options.plan.target);
  const routeElementEdges = createRouteElementCompositionEdges(
    routeElementSurfaces,
    outerPageSurface,
  );
  const routeElementRoot = routeElementSurfaces[0] ?? outerPageSurface;
  const routeEdges = createRouteCompositionEdges(routeSurfaces, routeElementRoot);
  const pageTargetEdge =
    detachedRouteLeaf && !detachedCatalogOwnerRetained
      ? undefined
      : createPageTargetEdge(
          browserCandidate.detachedTargetPlacement !== undefined ? outerPageSurface : pageSurface,
          targetSurface,
          browserCandidate.detachedTargetPlacement,
        );
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
  const slicedPageTargetEdge =
    detachedRouteLeaf && !detachedCatalogOwnerRetained
      ? undefined
      : createPageTargetEdge(
          browserCandidate.detachedTargetPlacement !== undefined
            ? slicedOuterPageSurface
            : pageSlicedSurface,
          targetSurface,
          browserCandidate.detachedTargetPlacement,
        );
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
    pageLocalSurface === undefined || (detachedRouteLeaf && !detachedCatalogOwnerRetained)
      ? undefined
      : createPageTargetEdge(
          browserCandidate.detachedTargetPlacement !== undefined
            ? (localOuterPageSurface ?? pageLocalSurface)
            : pageLocalSurface,
          targetSurface,
          browserCandidate.detachedTargetPlacement,
        );
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
        targetPageTabKeys,
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
        targetPageTabKeys,
        watchSourcePaths,
      }),
    );
  }
  // A page can be the selected target itself while still requiring a proven shell or framework
  // surface.  Do not collapse that route/layout context to target-only merely because both leaves
  // share a module/export identity.
  if (
    (!detachedRouteLeaf || detachedCatalogOwnerRetained) &&
    (!isSameSurface(pageSurface, targetSurface) ||
      routeElementSurfaces.length > 0 ||
      frameworkSurfaces.length > 0 ||
      shellSurfaces.length > 0)
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
        targetPageTabKeys,
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
        targetPageTabKeys,
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
          targetPageTabKeys,
          watchSourcePaths,
        }),
      );
    }
  }
  if (routeErrorElementRecipe !== undefined) {
    candidates.push(
      createCandidate({
        browserCandidate,
        compositionEdges: [],
        criticalSurfaces: [targetSurface],
        evidenceSourcePaths,
        fidelity: 'target-contextual',
        routeRecipe: routeErrorElementRecipe,
        targetPageTabKeys,
        watchSourcePaths: targetSurface.watchSourcePaths,
      }),
    );
  }
  // A transient primitive such as Skeleton is rarely a complete screen by itself. When the
  // selected authored path proves a nearest exported loading surface, retain that whole surface as
  // the final contextual fallback before reducing execution to the primitive target alone.
  if (transientContextSurface !== undefined) {
    const transientTargetEdge = createPageTargetEdge(
      transientContextSurface,
      targetSurface,
      undefined,
    );
    candidates.push(
      createCandidate({
        browserCandidate,
        compositionEdges: transientTargetEdge === undefined ? [] : [transientTargetEdge],
        criticalSurfaces: deduplicateSurfaces([transientContextSurface, targetSurface]),
        evidenceSourcePaths: Object.freeze(
          [...new Set([...evidenceSourcePaths, transientContextSurface.sourcePath])].sort(),
        ),
        fidelity: 'target-contextual',
        targetPageTabKeys,
        watchSourcePaths: Object.freeze(
          [
            ...new Set([
              ...watchSourcePaths,
              ...transientContextSurface.watchSourcePaths,
              ...targetSurface.watchSourcePaths,
            ]),
          ].sort(),
        ),
      }),
    );
  }
  const targetOnlyOmitsNestedOwner =
    options.targetMode === 'selected-route-leaf' && (routeRecipe?.mounts.length ?? 0) > 0;
  if (!targetOnlyOmitsNestedOwner) {
    candidates.push(
      createCandidate({
        browserCandidate,
        compositionEdges: [],
        criticalSurfaces: [targetSurface],
        evidenceSourcePaths,
        fidelity: 'target-only',
        ...(routeRecipe === undefined ? {} : { routeRecipe }),
        standaloneTarget,
        targetPageTabKeys,
        watchSourcePaths: targetSurface.watchSourcePaths,
      }),
    );
  }
  const topologyCandidates =
    options.targetMode === 'selected-route-leaf'
      ? candidates.filter(
          (candidate) =>
            candidate.executionRootSurfaceId === candidate.runtimeTargetSurfaceId ||
            (candidate.routeRecipe?.mounts.length ?? 0) > 0,
        )
      : candidates;
  return Object.freeze(
    deduplicateCandidates(topologyCandidates.filter(hasAuthenticRuntimeTarget)).map((candidate) =>
      attachOptionalSurfaces(candidate, options.plan),
    ),
  );
}

/**
 * Rejects a candidate whose runtime-target role is a virtual slice. The target always loads through
 * the target facade, so a slice of that same export never enters the graph and frontier
 * verification discards the build; a page that is itself the target yields such sliced variants.
 */
function hasAuthenticRuntimeTarget(candidate: PreviewInspectorPageExecutionCandidate): boolean {
  const target = candidate.criticalSurfaces.find(
    (surface) => surface.id === candidate.runtimeTargetSurfaceId,
  );
  return (
    target?.strategy !== 'selected-export-slice' &&
    target?.strategy !== 'inner-local-component-slice'
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

/**
 * Preserves the exact route leaf selected by compiler-owned route evidence across VirtualPage
 * checkpoint replacement. The analysis target remains the exact non-route fallback; an execution
 * candidate never silently converts its content owner into the runtime target.
 */
function attachCompilerOwnedRuntimeTarget(
  virtualPage: PreviewInspectorVirtualPageCandidate,
  analysisTarget: PreviewInspectorComponentReference,
  targetMode: PreviewInspectorTargetMode | undefined,
): PreviewInspectorPageCandidate & { readonly target: PreviewInspectorComponentReference } {
  const location = virtualPage.browserCandidate.routeLocation;
  const routeLocation =
    location?.evidenceKind === 'route-catalog' || location?.evidenceKind === 'route-jsx'
      ? location
      : undefined;
  const componentSourcePath = routeLocation?.componentSourcePath;
  const routeTarget =
    componentSourcePath === undefined
      ? undefined
      : Object.freeze({
          exportName: routeLocation?.componentExportName ?? 'default',
          sourcePath: path.normalize(componentSourcePath),
        });
  const selectedRouteTarget =
    routeTarget ?? virtualPage.authoredCandidate.target ?? virtualPage.browserCandidate.target;
  if (targetMode === 'selected-route-leaf' && selectedRouteTarget === undefined) {
    throw new TypeError(
      'Page Execution candidate does not have an exact compiler-owned selected route target.',
    );
  }
  const target = targetMode === 'selected-route-leaf' ? selectedRouteTarget : analysisTarget;
  if (target === undefined) {
    throw new TypeError('Page Execution candidate does not have a compiler-owned runtime target.');
  }
  return Object.freeze({
    ...virtualPage.browserCandidate,
    target: Object.freeze({
      exportName: target.exportName,
      sourcePath: path.normalize(target.sourcePath),
    }),
  });
}

function createRouteSurfaces(
  candidate: PreviewInspectorPageCandidate,
): readonly PreviewInspectorMountSurface[] {
  const mounts =
    candidate.routeLocation !== undefined && 'routeMounts' in candidate.routeLocation
      ? (candidate.routeLocation.routeMounts ?? [])
      : [];
  const seen = new Set<string>();
  return Object.freeze(
    mounts
      .filter((mount) => {
        const key = `${path.normalize(mount.sourcePath)}\0${mount.exportName}`;
        if (seen.has(key)) return false;
        seen.add(key);
        const matchesCandidateRoot =
          path.normalize(mount.sourcePath) === path.normalize(candidate.root.sourcePath) &&
          mount.exportName === candidate.root.exportName;
        return !matchesCandidateRoot || isRetainedDetachedCatalogOwnerMount(candidate, mount);
      })
      .map((mount) => createModuleFallbackSurface(mount, 'route')),
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
 * Recovers the outer Route context from the exact authentic factory owner already selected as a
 * VirtualPage shell. A leaf catalog can name an inner owner while the rendered composition begins
 * at an outer factory shell; mounting that shell at the inner base makes its relative Routes miss.
 */
function collectVirtualPageOwnerRouteMount(
  candidate: PreviewInspectorPageCandidate,
  virtualPage: PreviewInspectorVirtualPageCandidate,
  shellSurfaces: readonly PreviewInspectorMountSurface[],
): PreviewInspectorDerivedOwnerRouteMount | undefined {
  const location = candidate.routeLocation;
  if (
    location === undefined ||
    (location.evidenceKind !== 'route-catalog' && location.evidenceKind !== 'route-jsx')
  ) {
    return undefined;
  }
  for (let index = virtualPage.recipe.shells.length - 1; index >= 0; index -= 1) {
    const shell = virtualPage.recipe.shells[index];
    const surface = shellSurfaces[index];
    if (shell?.relation !== 'owner' || surface === undefined) continue;
    const sourceText = readSource(surface.sourcePath);
    if (sourceText === undefined) continue;
    const owner = collectPreviewInspectorRouteFactoryChoices({
      sourcePath: surface.sourcePath,
      sourceText,
      targetIdentities: new Set([surface.exportName]),
    }).owner;
    if (
      owner === undefined ||
      owner.routeSlotCount === 0 ||
      path.normalize(owner.sourcePath) !== path.normalize(surface.sourcePath) ||
      owner.exportName !== surface.exportName ||
      relativizePreviewInspectorRoutePattern(owner.basePath, location.pattern) === undefined ||
      localizePreviewInspectorRoutePathname(owner.basePath, location.pathname) === undefined
    ) {
      continue;
    }
    return Object.freeze({
      evidence: Object.freeze({
        basePath: owner.basePath,
        contextOrigin: 'virtual-page-owner' as const,
        contextPattern: createVirtualPageOwnerContextPattern(owner.basePath),
        exportName: owner.exportName,
        hasWildcardFallback: owner.hasWildcardFallback,
        routeSlotCount: owner.routeSlotCount,
        sourcePath: path.normalize(owner.sourcePath),
      }),
      surface,
    });
  }
  return undefined;
}

/** Adds a trailing splat so the owner's own relative Routes receive the unmatched child path. */
function createVirtualPageOwnerContextPattern(basePath: string): string {
  if (/(?:^|\/)\*$/u.test(basePath)) return basePath;
  const normalized = basePath === '/' ? '' : basePath.replace(/\/+$/u, '');
  return `${normalized}/*`;
}

/**
 * Publishes derived owner evidence on the compiler-owned browser candidate as well as the recipe.
 * Runtime ownership validation can therefore compare the generated mount against immutable input
 * evidence instead of trusting a PageExecution-only edge.
 */
function attachVirtualPageOwnerRouteMount(
  candidate: PreviewInspectorPageCandidate & {
    readonly target: PreviewInspectorComponentReference;
  },
  mount: PreviewInspectorDerivedOwnerRouteMount | undefined,
): PreviewInspectorPageCandidate & { readonly target: PreviewInspectorComponentReference } {
  if (mount === undefined) return candidate;
  const location = candidate.routeLocation;
  if (
    location === undefined ||
    (location.evidenceKind !== 'route-catalog' && location.evidenceKind !== 'route-jsx')
  ) {
    return candidate;
  }
  const sourcePath = path.normalize(mount.evidence.sourcePath);
  const dependencyPaths = Object.freeze(
    [...new Set([...candidate.dependencyPaths, sourcePath])].sort(),
  );
  return Object.freeze({
    ...candidate,
    dependencyPaths,
    routeLocation: Object.freeze({
      ...location,
      dependencyPaths: Object.freeze(
        [...new Set([...location.dependencyPaths, sourcePath])].sort(),
      ),
      routeMounts: Object.freeze([mount.evidence]),
    }),
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
  for (let surfaceIndex = shellSurfaces.length - 1; surfaceIndex >= 0; surfaceIndex -= 1) {
    const shell = shellSurfaces[surfaceIndex];
    if (shell === undefined) continue;
    const locatedRecipe = findVirtualPageShellRecipe(virtualPage, shell);
    if (locatedRecipe === undefined) continue;
    const { index, shell: recipe } = locatedRecipe;
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

/** Resolves a filtered execution surface back to its immutable VirtualPage relation and order. */
function findVirtualPageShellRecipe(
  virtualPage: PreviewInspectorVirtualPageCandidate,
  surface: PreviewInspectorMountSurface,
):
  | {
      readonly index: number;
      readonly shell: PreviewInspectorVirtualPageCandidate['recipe']['shells'][number];
    }
  | undefined {
  const identity = createSurfaceReferenceKey(surface);
  const index = virtualPage.recipe.shells.findIndex(
    (shell) => createSurfaceReferenceKey(shell.root) === identity,
  );
  const shell = virtualPage.recipe.shells[index];
  return index < 0 || shell === undefined ? undefined : Object.freeze({ index, shell });
}

/** Creates one normalized module/export identity for shell and surface comparisons. */
function createSurfaceReferenceKey(reference: PreviewInspectorComponentReference): string {
  return `${path.normalize(reference.sourcePath)}\0${reference.exportName}`;
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

/** Retains a selected route owner only when the exact target-to-entry chain crosses that owner. */
function hasProvenNestedRouteTarget(
  candidate: PreviewInspectorPageCandidate,
  target: PreviewInspectorComponentReference,
): boolean {
  const steps = candidate.renderPath?.steps;
  if (steps === undefined) return false;
  const targetPath = path.normalize(target.sourcePath);
  const routeRootPath = path.normalize(candidate.root.sourcePath);
  const targetStepIndex = steps.findIndex((step) => path.normalize(step.sourcePath) === targetPath);
  const routeRootStepIndex = steps.findIndex(
    (step, index) => index > targetStepIndex && path.normalize(step.sourcePath) === routeRootPath,
  );
  return targetStepIndex >= 0 && routeRootStepIndex > targetStepIndex;
}

/** Admits only the exact labeled JSX owner authenticated into retained route-mount evidence. */
function hasRetainedDetachedCatalogOwner(candidate: PreviewInspectorPageCandidate): boolean {
  const location = candidate.routeLocation;
  if (
    location?.evidenceKind !== 'route-catalog' ||
    typeof location.directRouteOwnerSourcePath !== 'string' ||
    !('routeMounts' in location)
  ) {
    return false;
  }
  return (location.routeMounts ?? []).some((mount) =>
    isRetainedDetachedCatalogOwnerMount(candidate, mount),
  );
}

/** Keeps the browser root only when the exact labeled catalog owner authenticated this mount. */
function isRetainedDetachedCatalogOwnerMount(
  candidate: PreviewInspectorPageCandidate,
  mount: { readonly exportName: string; readonly sourcePath: string },
): boolean {
  const location = candidate.routeLocation;
  return (
    location?.evidenceKind === 'route-catalog' &&
    typeof location.directRouteOwnerSourcePath === 'string' &&
    path.normalize(mount.sourcePath) === path.normalize(location.directRouteOwnerSourcePath)
  );
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
  detachedTargetPlacement: PreviewInspectorPageCandidate['detachedTargetPlacement'],
): PreviewInspectorPageCompositionEdge | undefined {
  if (isSameSurface(pageSurface, targetSurface)) return undefined;
  return Object.freeze({
    childSurfaceId: targetSurface.id,
    mode: detachedTargetPlacement !== undefined ? 'sibling-after' : 'contains-authored-child',
    parentSurfaceId: pageSurface.id,
    placementIndex: 0,
  });
}
