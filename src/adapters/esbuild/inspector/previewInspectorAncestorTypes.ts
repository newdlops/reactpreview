/**
 * Public immutable contracts shared by Page Inspector ancestry planning and bridge generation.
 * Keeping these data-only shapes separate prevents the bounded graph algorithm from growing into
 * a monolithic file while preserving a single explicit module boundary for browser-safe metadata.
 */
import type { PreviewParentSliceStaticProps } from '../parentSlice';
import type {
  PreviewRenderChainCandidate,
  PreviewRenderChainPlan,
  PreviewRenderChainPlansByExport,
} from '../renderGraph';
import type { PreviewInferredExportProps } from '../staticResources/reactExportPropInference';
import type { PreviewInspectorRouteLocation } from './previewInspectorRouteLocation';

/** Importable component identity retained without loading its module in the extension host. */
export interface PreviewInspectorComponentReference {
  /** Runtime export name, including the string `default`. */
  readonly exportName: string;
  /** Absolute authored source path containing the export. */
  readonly sourcePath: string;
}

/** One proven child-to-owner relationship in the selected inspector ancestry. */
export interface PreviewInspectorAncestorEdge {
  /** Import spelling used at this exact occurrence; aliases identify the same child value. */
  readonly child: PreviewInspectorComponentReference;
  /** Primitive props statically visible on the child occurrence. */
  readonly childAutomaticProps: PreviewParentSliceStaticProps;
  /** Number of source-private component owners crossed before reaching `owner`. */
  readonly localOwnerDepth: number;
  /** Private owner names crossed in inner-to-outer order for diagnostics. */
  readonly localOwnerNames: readonly string[];
  /** Source offset of the selected imported child JSX occurrence. */
  readonly occurrenceStart: number;
  /** Nearest importable authored owner containing the child occurrence. */
  readonly owner: PreviewInspectorComponentReference;
}

/** Why reverse owner discovery stopped at the returned importable root. */
export type PreviewInspectorAncestorStopReason =
  | 'cycle'
  | 'depth-limit'
  | 'non-component-owner'
  | 'private-owner'
  | 'render-path-checkpoint'
  | 'root-reached';

/** One independently mountable caller path offered by Page Inspector. */
export interface PreviewInspectorPageCandidate {
  /** `true` when reverse owner discovery reached the outermost package-local usage. */
  readonly complete: boolean;
  /** Files that prove this candidate and should invalidate it during hot reload. */
  readonly dependencyPaths: readonly string[];
  /** Child-to-owner relationships specific to this caller path. */
  readonly edges: readonly PreviewInspectorAncestorEdge[];
  /** Stable render-graph identity used to persist user selection across rebuilds. */
  readonly id: string;
  /** Exact static target-to-entry path that guided this candidate, when one was proven. */
  readonly renderPath?: PreviewRenderChainCandidate;
  /** Importable authored component mounted as this candidate's page root. */
  readonly root: PreviewInspectorComponentReference;
  /** Primitive root props observed at the selected caller occurrence. */
  readonly rootAutomaticProps: PreviewParentSliceStaticProps;
  /** Neutral root props inferred from the root component's local type and usage evidence. */
  readonly rootInference?: PreviewInferredExportProps;
  /** Whether this independently mounted root's target-facing branch creates its own Router. */
  readonly rootOwnsRouter: boolean;
  /** Exact static route used to reproduce this detached root's authored page branch. */
  readonly routeLocation?: PreviewInspectorRouteLocation;
  /** Render-step index used to explain path-derived roots in the browser selector. */
  readonly rootStepIndex?: number;
  /** Honest reason an incomplete candidate could not be promoted farther. */
  readonly stopReason: PreviewInspectorAncestorStopReason;
  /** Primitive target props observed within this exact caller path. */
  readonly targetAutomaticProps: PreviewParentSliceStaticProps;
}

/** Immutable recipe for mounting one real ancestor and instrumenting its nested target. */
export interface PreviewInspectorAncestorPlan {
  /** `true` only when the scan reached an export with no further package-local usage. */
  readonly complete: boolean;
  /** Files selected by ancestry, route evidence, and therefore relevant to hot reload. */
  readonly dependencyPaths: readonly string[];
  /** Proven import relationships ordered from selected target toward mounted root. */
  readonly edges: readonly PreviewInspectorAncestorEdge[];
  /** Ranked independently selectable page contexts; the first candidate is the default. */
  readonly pageCandidates: readonly PreviewInspectorPageCandidate[];
  /** Actual authored export imported by the Page Inspector entry. */
  readonly root: PreviewInspectorComponentReference;
  /** Props usable when a private owner prevents mounting the next outer component. */
  readonly rootAutomaticProps: PreviewParentSliceStaticProps;
  /** Static application structure discovered independently from the conservative mount root. */
  readonly renderChain: PreviewRenderChainPlan;
  /** Entry-to-target plans for every explicit component export in the selected source file. */
  readonly renderChainsByExport: PreviewRenderChainPlansByExport;
  /** Stable explanation shown when the ancestry is necessarily partial. */
  readonly stopReason: PreviewInspectorAncestorStopReason;
  /** Original selected export that nested instrumentation must intercept. */
  readonly target: PreviewInspectorComponentReference;
  /** Primitive props observed at the first selected target occurrence, if any. */
  readonly targetAutomaticProps: PreviewParentSliceStaticProps;
}

/** Lazily supplies current editor-or-disk source under caller-owned package and byte budgets. */
export type ReadPreviewInspectorSource = (sourcePath: string) => Promise<string | undefined>;

/** Resolves aliases that cannot be proven by lexical suffix matching alone. */
export type ReadPreviewInspectorAcceptedSpecifiers = (
  target: PreviewInspectorComponentReference,
) => readonly string[];
