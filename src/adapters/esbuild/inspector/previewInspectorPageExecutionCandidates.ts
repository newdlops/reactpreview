/* eslint-disable jsdoc/require-jsdoc */
/** Creates bounded Page Execution Slice candidates from one selected browser path. */
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import ts from 'typescript';
import type { PreviewInspectorAncestorPlan } from './previewInspectorAncestorPlan';
import type {
  PreviewInspectorComponentReference,
  PreviewInspectorPageCandidate,
} from './previewInspectorAncestorTypes';
import type { PreviewRenderChainCandidate } from '../renderGraph';
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
  const shellSurfaces = selectRouteAwareShellSurfaces(
    unmountedBrowserCandidate,
    virtualPage,
    discoveredShellSurfaces,
    derivedOwnerRouteMount,
    [...routeSurfaces, ...routeElementSurfaces, ...frameworkSurfaces],
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

const PREVIEW_INSPECTOR_TRANSIENT_SURFACE_WORDS = new Set([
  'fallback',
  'loader',
  'loading',
  'pending',
  'placeholder',
  'progress',
  'shimmer',
  'skeleton',
  'spinner',
]);

/**
 * Promotes the nearest importable loading-state owner on the exact selected path. The target must
 * itself be transient, which prevents ordinary components nested beneath an unrelated spinner or
 * progress indicator from silently changing their execution root.
 */
function createTransientContextSurface(
  renderPath: PreviewRenderChainCandidate | undefined,
  browserCandidate: PreviewInspectorPageCandidate,
  target: PreviewInspectorComponentReference,
): PreviewInspectorMountSurface | undefined {
  if (renderPath === undefined || !hasTransientSurfaceWord(target.exportName)) return undefined;
  const normalizedTargetPath = path.normalize(target.sourcePath);
  const exactRootStepIndex = renderPath.steps.findIndex(
    (step) =>
      path.normalize(step.sourcePath) === path.normalize(browserCandidate.root.sourcePath) &&
      normalizeRenderStepExportName(step.label) === browserCandidate.root.exportName,
  );
  const corridorEnd =
    browserCandidate.rootStepIndex ??
    (exactRootStepIndex >= 0 ? exactRootStepIndex : renderPath.steps.length - 1);
  for (let index = 1; index <= corridorEnd; index += 1) {
    const step = renderPath.steps[index];
    if (step === undefined || !hasTransientSurfaceWord(step.label)) continue;
    const exportName = normalizeRenderStepExportName(step.label);
    const sourcePath = path.normalize(step.sourcePath);
    if (
      exportName === undefined ||
      (sourcePath === normalizedTargetPath && exportName === target.exportName) ||
      !sourceExportsRuntimeValue(sourcePath, exportName)
    ) {
      continue;
    }
    return createAuthenticSurface(Object.freeze({ exportName, sourcePath }), 'transient-context');
  }
  return undefined;
}

function hasTransientSurfaceWord(name: string): boolean {
  const words = name
    .replace(/([a-z0-9])([A-Z])/gu, '$1 $2')
    .split(/[^A-Za-z0-9]+/u)
    .map((word) => word.toLowerCase());
  return words.some((word) => PREVIEW_INSPECTOR_TRANSIENT_SURFACE_WORDS.has(word));
}

function normalizeRenderStepExportName(label: string): string | undefined {
  if (label === '@default') return 'default';
  return /^[$A-Z_a-z][$0-9A-Z_a-z]*$/u.test(label) ? label : undefined;
}

/** Fails closed for local-only declarations and type-only exports. */
function sourceExportsRuntimeValue(sourcePath: string, exportName: string): boolean {
  const sourceText = readSource(sourcePath);
  if (sourceText === undefined) return false;
  const sourceFile = ts.createSourceFile(
    sourcePath,
    sourceText,
    ts.ScriptTarget.Latest,
    true,
    sourcePath.endsWith('.tsx') || sourcePath.endsWith('.jsx')
      ? ts.ScriptKind.TSX
      : ts.ScriptKind.TS,
  );
  const hasModifier = (node: ts.Node, kind: ts.SyntaxKind): boolean =>
    (ts.canHaveModifiers(node) ? ts.getModifiers(node) : undefined)?.some(
      (modifier) => modifier.kind === kind,
    ) === true;
  for (const statement of sourceFile.statements) {
    if (ts.isExportAssignment(statement)) {
      if (exportName === 'default' && !statement.isExportEquals) return true;
      continue;
    }
    if (
      (ts.isFunctionDeclaration(statement) || ts.isClassDeclaration(statement)) &&
      hasModifier(statement, ts.SyntaxKind.ExportKeyword)
    ) {
      if (exportName === 'default' && hasModifier(statement, ts.SyntaxKind.DefaultKeyword)) {
        return true;
      }
      if (statement.name?.text === exportName) return true;
      continue;
    }
    if (
      ts.isVariableStatement(statement) &&
      hasModifier(statement, ts.SyntaxKind.ExportKeyword) &&
      statement.declarationList.declarations.some(
        (declaration) => ts.isIdentifier(declaration.name) && declaration.name.text === exportName,
      )
    ) {
      return true;
    }
    if (
      ts.isExportDeclaration(statement) &&
      !statement.isTypeOnly &&
      statement.exportClause !== undefined &&
      ts.isNamedExports(statement.exportClause) &&
      statement.exportClause.elements.some(
        (element) => !element.isTypeOnly && element.name.text === exportName,
      )
    ) {
      return true;
    }
  }
  return false;
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

const PREVIEW_INSPECTOR_TARGET_PAGE_TAB_KEY_LIMIT = 8;
const PREVIEW_INSPECTOR_TARGET_PAGE_TAB_WRAPPERS = new Set(['TabItem', 'TabPane', 'TabPanel']);

/**
 * Reads only literal event keys from exact JSX ancestors retained by the selected render path.
 * Dynamic keys and merely adjacent tabs fail closed instead of becoming browser actions.
 */
function collectPreviewInspectorTargetPageTabKeys(
  renderPath: PreviewInspectorPageCandidate['renderPath'],
): readonly string[] {
  if (renderPath === undefined) return Object.freeze([]);
  const innerToOuterKeys: string[] = [];
  for (const step of renderPath.steps) {
    if (
      step.invocation?.mode !== 'jsx' ||
      !step.wrapperNames.some((name) =>
        PREVIEW_INSPECTOR_TARGET_PAGE_TAB_WRAPPERS.has(name.split('.').at(-1) ?? ''),
      )
    ) {
      continue;
    }
    const sourcePath = step.invocation.sourcePath ?? step.sourcePath;
    const sourceText = readSource(sourcePath);
    if (
      sourceText === undefined ||
      step.occurrenceStart < 0 ||
      step.occurrenceStart >= sourceText.length
    ) {
      continue;
    }
    const sourceFile = ts.createSourceFile(
      sourcePath,
      sourceText,
      ts.ScriptTarget.Latest,
      true,
      ts.ScriptKind.TSX,
    );
    let current = findDeepestPreviewInspectorNodeAtPosition(sourceFile, step.occurrenceStart);
    while (!ts.isSourceFile(current)) {
      if (ts.isJsxElement(current)) {
        const tagName = current.openingElement.tagName.getText(sourceFile).split('.').at(-1) ?? '';
        if (
          PREVIEW_INSPECTOR_TARGET_PAGE_TAB_WRAPPERS.has(tagName) &&
          step.wrapperNames.some((name) => name.split('.').at(-1) === tagName)
        ) {
          const eventKey = readPreviewInspectorStaticJsxStringAttribute(
            current.openingElement.attributes,
            'eventKey',
          );
          if (eventKey !== undefined) innerToOuterKeys.push(eventKey);
        }
      }
      current = current.parent;
    }
  }
  const keys = [...new Set(innerToOuterKeys.reverse())].slice(
    0,
    PREVIEW_INSPECTOR_TARGET_PAGE_TAB_KEY_LIMIT,
  );
  return Object.freeze(keys);
}

/** Finds the narrowest parsed node that contains one analyzer-owned occurrence offset. */
function findDeepestPreviewInspectorNodeAtPosition(node: ts.Node, position: number): ts.Node {
  let match = node;
  node.forEachChild((child) => {
    if (child.getFullStart() <= position && position < child.getEnd()) {
      match = findDeepestPreviewInspectorNodeAtPosition(child, position);
    }
  });
  return match;
}

/** Accepts string literals and no-substitution template literals, never evaluated expressions. */
function readPreviewInspectorStaticJsxStringAttribute(
  attributes: ts.JsxAttributes,
  attributeName: string,
): string | undefined {
  for (const property of attributes.properties) {
    if (
      !ts.isJsxAttribute(property) ||
      !ts.isIdentifier(property.name) ||
      property.name.text !== attributeName
    ) {
      continue;
    }
    const initializer = property.initializer;
    const value =
      initializer !== undefined && ts.isStringLiteral(initializer)
        ? initializer.text
        : initializer !== undefined &&
            ts.isJsxExpression(initializer) &&
            initializer.expression !== undefined &&
            (ts.isStringLiteral(initializer.expression) ||
              ts.isNoSubstitutionTemplateLiteral(initializer.expression))
          ? initializer.expression.text
          : undefined;
    return value !== undefined && value.length > 0 && value.length <= 128 ? value : undefined;
  }
  return undefined;
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
 * Keeps selected-path layout wrappers when a nested route owner supplies the live page body.
 *
 * Route surfaces already reproduce Router/Route composition, so sibling shells remain excluded
 * here. A wrapper recipe is different: it is inert one-hop evidence that the authored outer app
 * placed a layout, frame, or chrome component around this exact nested owner. Dropping it turns a
 * valid Page Context into the leaf page alone even though the compiler already proved the shell.
 */
function selectRouteAwareShellSurfaces(
  candidate: PreviewInspectorPageCandidate,
  virtualPage: PreviewInspectorVirtualPageCandidate,
  discoveredShellSurfaces: readonly PreviewInspectorMountSurface[],
  derivedOwnerRouteMount: PreviewInspectorDerivedOwnerRouteMount | undefined,
  routeCompositionSurfaces: readonly PreviewInspectorMountSurface[],
): readonly PreviewInspectorMountSurface[] {
  if (candidate.routeLocation === undefined) return discoveredShellSurfaces;
  const routeCompositionIdentities = new Set(
    routeCompositionSurfaces.map(createSurfaceReferenceKey),
  );
  const ownerIdentity =
    derivedOwnerRouteMount === undefined
      ? undefined
      : createSurfaceReferenceKey(derivedOwnerRouteMount.surface);
  return Object.freeze(
    discoveredShellSurfaces.filter((surface) => {
      const identity = createSurfaceReferenceKey(surface);
      if (identity === ownerIdentity) return true;
      const recipe = findVirtualPageShellRecipe(virtualPage, surface)?.shell;
      return recipe?.relation === 'wrapper' && !routeCompositionIdentities.has(identity);
    }),
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
    targetRole: 'element',
  });
}

/**
 * Recreates a data-router error boundary only for an exact authored `errorElement` slot.
 * A normal MemoryRouter cannot provide `useRouteError()`, while importing the application router
 * would execute its complete route registry and unrelated initialization.
 */
function createRouteErrorElementRecipe(
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
  return readReactRouterRuntime(sources);
}

/** Reads the exact React Router package and generation from bounded authored sources. */
function readReactRouterRuntime(
  sources: readonly string[],
): Pick<PreviewInspectorRouteExecutionRecipe, 'kind' | 'routerModuleSpecifier'> {
  const sourceEntries = sources.flatMap((sourcePath) => {
    const sourceText = readSource(sourcePath);
    return sourceText === undefined ? [] : [{ sourcePath, sourceText }];
  });
  const evidence = collectReactRouterImportEvidence(sourceEntries);
  const routerModuleSpecifier = evidence.moduleSpecifiers.has('react-router-dom')
    ? 'react-router-dom'
    : evidence.moduleSpecifiers.has('react-router')
      ? 'react-router'
      : undefined;
  if (routerModuleSpecifier === undefined) return { kind: 'generic-memory-location' };
  if (
    [
      'Routes',
      'RouterProvider',
      'useRoutes',
      'createBrowserRouter',
      'createHashRouter',
      'createMemoryRouter',
    ].some((binding) => evidence.importedExports.has(binding))
  )
    return { kind: 'react-router-v6', routerModuleSpecifier };
  if (
    ['Switch', 'withRouter'].some((binding) => evidence.importedExports.has(binding)) ||
    sourceEntries.some(({ sourceText }) => /\b(?:component|render)\s*=/u.test(sourceText))
  )
    return { kind: 'react-router-v5', routerModuleSpecifier };
  return { kind: 'generic-memory-location' };
}

/** Reads only bindings imported from React Router, excluding unrelated local names such as Routes. */
function collectReactRouterImportEvidence(
  sources: readonly { readonly sourcePath: string; readonly sourceText: string }[],
): {
  readonly importedExports: ReadonlySet<string>;
  readonly moduleSpecifiers: ReadonlySet<string>;
} {
  const importedExports = new Set<string>();
  const moduleSpecifiers = new Set<string>();
  for (const { sourcePath, sourceText } of sources) {
    const sourceFile = ts.createSourceFile(
      sourcePath,
      sourceText,
      ts.ScriptTarget.Latest,
      true,
      sourcePath.toLowerCase().endsWith('x') ? ts.ScriptKind.TSX : ts.ScriptKind.TS,
    );
    const namespaceBindings = new Set<string>();
    for (const statement of sourceFile.statements) {
      if (
        !ts.isImportDeclaration(statement) ||
        !ts.isStringLiteralLike(statement.moduleSpecifier) ||
        !['react-router', 'react-router-dom'].includes(statement.moduleSpecifier.text)
      ) {
        continue;
      }
      moduleSpecifiers.add(statement.moduleSpecifier.text);
      const namedBindings = statement.importClause?.namedBindings;
      if (namedBindings === undefined) continue;
      if (ts.isNamespaceImport(namedBindings)) {
        namespaceBindings.add(namedBindings.name.text);
        continue;
      }
      for (const element of namedBindings.elements) {
        importedExports.add(element.propertyName?.text ?? element.name.text);
      }
    }
    if (namespaceBindings.size === 0) continue;
    const visit = (node: ts.Node): void => {
      if (
        ts.isPropertyAccessExpression(node) &&
        ts.isIdentifier(node.expression) &&
        namespaceBindings.has(node.expression.text)
      ) {
        importedExports.add(node.name.text);
      }
      ts.forEachChild(node, visit);
    };
    visit(sourceFile);
  }
  return { importedExports, moduleSpecifiers };
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

function createCandidate(options: {
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
