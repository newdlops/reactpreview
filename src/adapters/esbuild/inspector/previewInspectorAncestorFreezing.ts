/**
 * Converts mutable Page Inspector traversal state into immutable browser-facing contracts.
 * Keeping allocation and normalization outside the graph search makes the planner easier to read
 * and ensures every candidate uses the same dependency sorting and optional-field semantics.
 */
import type { PreviewParentSliceStaticProps } from '../parentSlice';
import type {
  PreviewRenderChainCandidate,
  PreviewRenderChainPlan,
  PreviewRenderChainPlansByExport,
} from '../renderGraph';
import type { PreviewInferredExportProps } from '../staticResources/reactExportPropInference';
import type { PreviewReactRenderOutcomePlan } from '../staticResources/previewReactRenderOutcomes';
import type {
  PreviewInspectorNextAppLayoutReference,
  PreviewInspectorNextAppRouteLocation,
} from './previewInspectorNextAppLayoutChain';
import type {
  PreviewInspectorNextPagesRouteLocation,
  PreviewInspectorNextPagesShell,
} from './previewInspectorNextPagesShell';
import type { PreviewInspectorRouteLocation } from './previewInspectorRouteLocation';
import type {
  PreviewInspectorAncestorEdge,
  PreviewInspectorAncestorPlan,
  PreviewInspectorAncestorStopReason,
  PreviewInspectorComponentReference,
  PreviewInspectorModuleContextReference,
  PreviewInspectorPageCandidate,
} from './previewInspectorAncestorTypes';

/** Mutable traversal values accepted immediately before one page candidate is published. */
export interface FreezePreviewInspectorPageCandidateOptions {
  readonly complete: boolean;
  readonly dependencies: ReadonlySet<string>;
  readonly edges: readonly PreviewInspectorAncestorEdge[];
  readonly id: string;
  readonly renderPath: PreviewRenderChainCandidate | undefined;
  readonly root: PreviewInspectorComponentReference;
  readonly rootAutomaticProps: PreviewParentSliceStaticProps;
  readonly rootInference?: PreviewInferredExportProps;
  readonly nextAppLayoutChain?: readonly PreviewInspectorNextAppLayoutReference[];
  readonly nextPagesShell?: PreviewInspectorNextPagesShell;
  readonly rootOwnsRouter: boolean;
  readonly rootStepIndex?: number;
  readonly routeLocation?:
    | PreviewInspectorRouteLocation
    | PreviewInspectorNextAppRouteLocation
    | PreviewInspectorNextPagesRouteLocation;
  readonly stopReason: PreviewInspectorAncestorStopReason;
  readonly targetAutomaticProps: PreviewParentSliceStaticProps;
}

/** Freezes one selectable page candidate without retaining mutable traversal collections. */
export function freezePreviewInspectorPageCandidate(
  options: FreezePreviewInspectorPageCandidateOptions,
): PreviewInspectorPageCandidate {
  return Object.freeze({
    complete: options.complete,
    dependencyPaths: Object.freeze([...options.dependencies].sort()),
    edges: Object.freeze([...options.edges]),
    id: options.id,
    ...(options.renderPath === undefined ? {} : { renderPath: options.renderPath }),
    root: options.root,
    rootAutomaticProps: options.rootAutomaticProps,
    ...(options.rootInference === undefined ? {} : { rootInference: options.rootInference }),
    ...(options.nextAppLayoutChain === undefined
      ? {}
      : { nextAppLayoutChain: Object.freeze([...options.nextAppLayoutChain]) }),
    ...(options.nextPagesShell === undefined ? {} : { nextPagesShell: options.nextPagesShell }),
    rootOwnsRouter: options.rootOwnsRouter,
    ...(options.rootStepIndex === undefined ? {} : { rootStepIndex: options.rootStepIndex }),
    ...(options.routeLocation === undefined ? {} : { routeLocation: options.routeLocation }),
    stopReason: options.stopReason,
    targetAutomaticProps: options.targetAutomaticProps,
  });
}

/** Mutable traversal values accepted immediately before the complete plan is published. */
export interface FreezePreviewInspectorAncestorPlanOptions {
  readonly complete: boolean;
  readonly contextModule?: PreviewInspectorModuleContextReference;
  readonly dependencies: ReadonlySet<string>;
  readonly edges: readonly PreviewInspectorAncestorEdge[];
  readonly pageCandidates: readonly PreviewInspectorPageCandidate[];
  readonly root: PreviewInspectorComponentReference;
  readonly rootAutomaticProps: PreviewParentSliceStaticProps;
  readonly renderChain: PreviewRenderChainPlan;
  readonly renderChainsByExport: PreviewRenderChainPlansByExport;
  readonly renderOutcomesByExport: Readonly<Record<string, PreviewReactRenderOutcomePlan>>;
  readonly stopReason: PreviewInspectorAncestorStopReason;
  readonly target: PreviewInspectorComponentReference;
  readonly targetAutomaticProps: PreviewParentSliceStaticProps;
}

/** Freezes one successful or safely partial plan without retaining parser nodes/source text. */
export function freezePreviewInspectorAncestorPlan(
  options: FreezePreviewInspectorAncestorPlanOptions,
): PreviewInspectorAncestorPlan {
  return Object.freeze({
    complete: options.complete,
    ...(options.contextModule === undefined ? {} : { contextModule: options.contextModule }),
    dependencyPaths: Object.freeze([...options.dependencies].sort()),
    edges: Object.freeze([...options.edges]),
    pageCandidates: Object.freeze([...options.pageCandidates]),
    root: options.root,
    rootAutomaticProps: options.rootAutomaticProps,
    renderChain: options.renderChain,
    renderChainsByExport: options.renderChainsByExport,
    renderOutcomesByExport: options.renderOutcomesByExport,
    stopReason: options.stopReason,
    target: options.target,
    targetAutomaticProps: options.targetAutomaticProps,
  });
}
