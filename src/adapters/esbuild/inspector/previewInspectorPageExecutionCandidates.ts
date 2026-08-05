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
import type { PreviewInspectorRouteMountEvidence } from './previewInspectorRouteLocationTypes';
import type { PreviewInspectorTargetMode } from '../../../domain/preview';
import { createPreviewInspectorPagePathSegments } from './previewInspectorPagePathSegments';
import { resolvePreviewReactLocalComponentSurface } from '../staticResources/previewReactLocalComponentSurface';
import { collectPreviewRouterRequirement } from '../previewRouterRequirement';
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
  PreviewInspectorPageFidelity,
  PreviewInspectorRouteExecutionRecipe,
} from './previewInspectorPageExecutionTypes';
import { collectPreviewInspectorRouteParameterValues } from './previewInspectorRoutePattern';

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
  const targetSurface = createAuthenticSurface(unmountedBrowserCandidate.target, 'target');
  const pageSurface = createAuthenticSurface(virtualPage.contentCandidate.root, 'page');
  const pageSlicedSurface = createSelectedExportSurface(virtualPage.contentCandidate.root, 'page');
  const pageLocalSurface = createLocalComponentSurface(virtualPage.contentCandidate.root, 'page');
  const detachedRouteLeaf =
    unmountedBrowserCandidate.detachedTargetPlacement === undefined &&
    isDetachedRouteLeaf(unmountedBrowserCandidate, options.plan.target);
  const detachedCatalogOwnerRetained = hasRetainedDetachedCatalogOwner(unmountedBrowserCandidate);
  const routeSurfaces =
    detachedRouteLeaf && !detachedCatalogOwnerRetained
      ? Object.freeze([])
      : createRouteSurfaces(unmountedBrowserCandidate);
  const routeElementSurfaces = createRouteElementSurfaces(unmountedBrowserCandidate);
  const frameworkSurfaces = createFrameworkSurfaces(unmountedBrowserCandidate);
  const shellSurfaces = createShellSurfaces(virtualPage);
  const derivedOwnerRouteMount = collectVirtualPageOwnerRouteMount(
    unmountedBrowserCandidate,
    virtualPage,
    shellSurfaces,
  );
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
    browserCandidate.detachedTargetPlacement === 'overlay-sibling'
      ? outerPageSurface
      : undefined,
  );
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
          browserCandidate.detachedTargetPlacement !== undefined
            ? outerPageSurface
            : pageSurface,
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
  const targetOnlyOmitsNestedOwner =
    options.targetMode === 'selected-route-leaf' && (routeRecipe?.mounts.length ?? 0) > 0;
  if (!targetOnlyOmitsNestedOwner) {
    candidates.push(
      createCandidate({
        browserCandidate,
        compositionEdges: [],
        criticalSurfaces: [detachedRouteLeaf ? pageSurface : targetSurface],
        evidenceSourcePaths,
        fidelity: 'target-only',
        ...(routeRecipe === undefined ? {} : { routeRecipe }),
        watchSourcePaths: (detachedRouteLeaf ? pageSurface : targetSurface).watchSourcePaths,
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
    deduplicateCandidates(topologyCandidates).map((candidate) =>
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
  const routeExecutionRoot = routeSurfaces[0];
  const executionRootOwnsRouter =
    routeExecutionRoot === undefined || sameSurfaceReference(routeExecutionRoot, candidate.root)
      ? candidate.rootOwnsRouter
      : (doesPreviewInspectorSurfaceOwnRouter(routeExecutionRoot) ?? false);
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
    rootOwnsRouter: executionRootOwnsRouter,
    ...(routeRuntime.routerModuleSpecifier === undefined
      ? {}
      : { routerModuleSpecifier: routeRuntime.routerModuleSpecifier }),
    searchParams: Object.freeze('searchParams' in location ? { ...location.searchParams } : {}),
  });
}

/**
 * Recomputes Router ownership for the live execution root after an authored app root is stripped.
 *
 * A selected route surface can live below an AppRouter that owns RouterProvider. Reusing the
 * authored root flag would omit the MemoryRouter even though the generated slice now begins at a
 * component that only consumes Route context.
 */
function doesPreviewInspectorSurfaceOwnRouter(
  surface: PreviewInspectorMountSurface,
): boolean | undefined {
  const sourceText = readSource(surface.sourcePath);
  if (sourceText === undefined) return undefined;
  return collectPreviewRouterRequirement(surface.sourcePath, sourceText).ownsRouter;
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
  if (
    /\b(?:Routes|RouterProvider|useRoutes|create(?:Browser|Hash|Memory)Router)\b/u.test(sourceText)
  )
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
  detachedTargetPlacement: PreviewInspectorPageCandidate['detachedTargetPlacement'],
): PreviewInspectorPageCompositionEdge | undefined {
  if (isSameSurface(pageSurface, targetSurface)) return undefined;
  return Object.freeze({
    childSurfaceId: targetSurface.id,
    mode:
      detachedTargetPlacement !== undefined
        ? 'sibling-after'
        : 'contains-authored-child',
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
      .filter((edge) => edge.mode !== 'contains-authored-child')
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
  executionRootContract: PreviewInspectorPageExecutionCandidate['executionRootContract'],
  runtimeTargetContract: PreviewInspectorPageExecutionCandidate['runtimeTargetContract'],
  pinnedRoot: PreviewInspectorComponentReference,
  routeRecipe?: PreviewInspectorRouteExecutionRecipe,
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

function isSameSurface(
  left: PreviewInspectorMountSurface,
  right: PreviewInspectorMountSurface,
): boolean {
  return left.sourcePath === right.sourcePath && left.exportName === right.exportName;
}

function sameSurfaceReference(
  surface: Pick<PreviewInspectorMountSurface, 'exportName' | 'sourcePath'>,
  reference: PreviewInspectorComponentReference,
): boolean {
  return (
    surface.exportName === reference.exportName &&
    path.normalize(surface.sourcePath) === path.normalize(reference.sourcePath)
  );
}
