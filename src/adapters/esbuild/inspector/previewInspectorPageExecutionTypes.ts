/**
 * Immutable execution-only contracts for the bounded Page Inspector path.
 *
 * Ancestor plans retain broad application evidence for descriptors and route exploration. These
 * types deliberately keep that evidence separate from the small set of authored sources that an
 * automatic preview is allowed to evaluate.
 */
import type { PreviewRenderExportReference, PreviewRenderInvocation } from '../renderGraph';
import type { PreviewInspectorAncestorPlan } from './previewInspectorAncestorPlan';
import type { PreviewInspectorPageCandidate } from './previewInspectorAncestorTypes';

/** The semantic position of one source on the selected target-to-page path. */
export type PreviewInspectorPagePathSegmentRole =
  | 'target'
  | 'page-content'
  | 'route-element'
  | 'route-layout'
  | 'framework-layout'
  | 'provider'
  | 'page-chrome'
  | 'application-shell'
  | 'application-entry'
  | 'evidence-only';

/** One role-labelled piece of the selected page path, ordered from target toward the entry. */
export interface PreviewInspectorPagePathSegment {
  readonly certainty: 'conditional' | 'confirmed';
  readonly evidenceSourcePaths: readonly string[];
  readonly id: string;
  readonly indexFromTarget: number;
  readonly invocation?: PreviewRenderInvocation;
  readonly reference?: PreviewRenderExportReference;
  readonly role: PreviewInspectorPagePathSegmentRole;
  readonly sourcePath: string;
  readonly wrapperNames: readonly string[];
}

/** A generated surface is either authentic authored code or an exact local declaration slice. */
export type PreviewInspectorMountSurfaceStrategy =
  | 'authentic-module-export'
  | 'selected-export-slice'
  | 'inner-local-component-slice'
  | 'framework-page-surface'
  | 'selected-route-surface';

/** One importable React surface admitted into a Page Execution Slice. */
export interface PreviewInspectorMountSurface {
  readonly bypassedWrapperNames: readonly string[];
  readonly exportName: string;
  readonly id: string;
  readonly localName?: string;
  readonly omittedTopLevelEffectCount: number;
  readonly preservedWrapperKinds?: readonly ('forward-ref' | 'memo' | 'styled')[];
  readonly sourcePath: string;
  readonly strategy: PreviewInspectorMountSurfaceStrategy;
  readonly watchSourcePaths: readonly string[];
}

/** The only source-to-source composition relationships generated runtime may reproduce. */
export type PreviewInspectorPageCompositionMode =
  | 'contains-authored-child'
  | 'children-slot'
  | 'component-prop-slot'
  | 'render-prop-slot'
  | 'route-outlet'
  | 'next-layout-slot'
  | 'sibling-before'
  | 'sibling-after';

/** An exact, statically proven surface composition edge. */
export interface PreviewInspectorPageCompositionEdge {
  readonly childSurfaceId: string;
  readonly mode: PreviewInspectorPageCompositionMode;
  readonly parentSurfaceId: string;
  readonly placementIndex: number;
  readonly slotName?: string;
}

/** Route runtimes that can be represented without importing an entire application registry. */
export type PreviewInspectorRouteRuntimeKind =
  'generic-memory-location' | 'react-router-v5' | 'react-router-v6' | 'next-app' | 'next-pages';

/** One selected route mount in outer-to-inner runtime order. */
export interface PreviewInspectorRouteExecutionMount {
  readonly basePath: string;
  readonly childSurfaceId: string;
  /** Parent Route pattern required by a retained nested route owner such as a `useRoutes` shell. */
  readonly contextPattern?: string;
  readonly hasWildcardFallback: boolean;
  readonly parentSurfaceId?: string;
  readonly pattern: string;
}

/** Browser-safe selected-route input consumed by a generated mini route tree. */
export interface PreviewInspectorRouteExecutionRecipe {
  readonly kind: PreviewInspectorRouteRuntimeKind;
  readonly loaderPolicy: 'never-execute';
  readonly mounts: readonly PreviewInspectorRouteExecutionMount[];
  readonly params: Readonly<Record<string, string | readonly string[]>>;
  /** Authored selected-route pattern retained so generated routers can populate `useParams()`. */
  readonly pattern: string;
  readonly pathname: string;
  /** Prevents generated route execution from nesting a MemoryRouter around an authored router root. */
  readonly rootOwnsRouter: boolean;
  /** The selected route's project-owned React Router package, when a mini tree is used. */
  readonly routerModuleSpecifier?: 'react-router' | 'react-router-dom';
  readonly searchParams: Readonly<Record<string, string | readonly string[]>>;
}

/** Ordered fidelity candidates for one selected browser route identity. */
export type PreviewInspectorPageFidelity =
  | 'route-page-authentic'
  | 'route-page-sliced'
  | 'page-authentic'
  | 'page-sliced'
  | 'target-contextual'
  | 'target-only';

/** Exact compiler-owned role identity frozen before module export proof. */
export interface PreviewInspectorPageExecutionRoleContract {
  readonly exportName: string;
  readonly sourcePath: string;
  readonly surfaceId: string;
}

/** An executable route/page/target combination, without application-wide evidence imports. */
export interface PreviewInspectorPageExecutionCandidate {
  readonly browserCandidate: PreviewInspectorPageCandidate;
  readonly compositionEdges: readonly PreviewInspectorPageCompositionEdge[];
  readonly criticalSurfaces: readonly PreviewInspectorMountSurface[];
  readonly evidenceSourcePaths: readonly string[];
  /** Admitted authored shell/content root that remains mounted for execution context. */
  readonly executionRootContract: PreviewInspectorPageExecutionRoleContract;
  readonly executionRootSurfaceId: string;
  readonly fidelity: PreviewInspectorPageFidelity;
  readonly id: string;
  readonly optionalSurfaces: readonly PreviewInspectorMountSurface[];
  readonly routeRecipe?: PreviewInspectorRouteExecutionRecipe;
  /** Admitted selected leaf whose exact source/export is wrapped by the target facade. */
  readonly runtimeTargetContract: PreviewInspectorPageExecutionRoleContract;
  readonly runtimeTargetSurfaceId: string;
  readonly watchSourcePaths: readonly string[];
}

/** A reject or non-selected alternative retained only for diagnostics. */
export interface PreviewInspectorPageExecutionAlternativeSummary {
  readonly candidateId: string;
  readonly fidelity: PreviewInspectorPageFidelity;
  readonly reason?: string;
}

/** The immutable execution boundary selected once in compiler preparation. */
export interface PreviewInspectorPageExecutionPlan {
  readonly alternatives: readonly PreviewInspectorPageExecutionAlternativeSummary[];
  readonly browserCandidateId: string;
  readonly candidate: PreviewInspectorPageExecutionCandidate;
  readonly descriptorPlan: PreviewInspectorAncestorPlan;
  readonly executionIdentity: string;
  readonly version: 4;
}

/** Freezes arrays at the execution boundary without mutating analyzer-owned descriptor evidence. */
export function freezePreviewInspectorPageExecutionPlan(
  plan: PreviewInspectorPageExecutionPlan,
): PreviewInspectorPageExecutionPlan {
  const freezeSurface = (surface: PreviewInspectorMountSurface): PreviewInspectorMountSurface =>
    Object.freeze({
      ...surface,
      bypassedWrapperNames: Object.freeze([...surface.bypassedWrapperNames]),
      ...(surface.preservedWrapperKinds === undefined
        ? {}
        : { preservedWrapperKinds: Object.freeze([...surface.preservedWrapperKinds]) }),
      watchSourcePaths: Object.freeze([...surface.watchSourcePaths]),
    });
  const freezeRouteRecord = (
    record: Readonly<Record<string, string | readonly string[]>>,
  ): Readonly<Record<string, string | readonly string[]>> =>
    Object.freeze(
      Object.fromEntries(
        Object.entries(record).map(([key, value]) => [
          key,
          typeof value === 'string' ? value : Object.freeze([...value]),
        ]),
      ),
    );
  const freezeEdge = (
    edge: PreviewInspectorPageCompositionEdge,
  ): PreviewInspectorPageCompositionEdge => Object.freeze({ ...edge });
  const freezeRecipe = (
    recipe: PreviewInspectorRouteExecutionRecipe,
  ): PreviewInspectorRouteExecutionRecipe =>
    Object.freeze({
      ...recipe,
      mounts: Object.freeze(recipe.mounts.map((mount) => Object.freeze({ ...mount }))),
      params: freezeRouteRecord(recipe.params),
      searchParams: freezeRouteRecord(recipe.searchParams),
    });
  const candidate = Object.freeze({
    ...plan.candidate,
    compositionEdges: Object.freeze(plan.candidate.compositionEdges.map(freezeEdge)),
    criticalSurfaces: Object.freeze(plan.candidate.criticalSurfaces.map(freezeSurface)),
    evidenceSourcePaths: Object.freeze([...plan.candidate.evidenceSourcePaths]),
    executionRootContract: Object.freeze({ ...plan.candidate.executionRootContract }),
    optionalSurfaces: Object.freeze(plan.candidate.optionalSurfaces.map(freezeSurface)),
    ...(plan.candidate.routeRecipe === undefined
      ? {}
      : { routeRecipe: freezeRecipe(plan.candidate.routeRecipe) }),
    runtimeTargetContract: Object.freeze({ ...plan.candidate.runtimeTargetContract }),
    watchSourcePaths: Object.freeze([...plan.candidate.watchSourcePaths]),
  });
  return Object.freeze({
    ...plan,
    alternatives: Object.freeze(plan.alternatives.map((item) => Object.freeze({ ...item }))),
    candidate,
  });
}
