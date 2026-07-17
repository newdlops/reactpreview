/**
 * Defines the inert application render graph shared by build-time discovery and Page Inspector.
 * The graph records structural evidence only: project modules are never imported or evaluated in
 * the extension host, and a discovered application entry is deliberately kept separate from the
 * component export that is safe to mount inside the preview webview.
 */

/** Stable identity of one authored export used as a render-chain seed or public component node. */
export interface PreviewRenderExportReference {
  /** Runtime export spelling, including the string `default`. */
  readonly exportName: string;
  /** Absolute source module containing the export. */
  readonly sourcePath: string;
}

/** Synchronous project-aware resolution shared by coarse source selection and the exact graph. */
export type ResolvePreviewRenderGraphModule = (
  moduleSpecifier: string,
  consumerPath: string,
) => string | undefined;

/** ReactDOM API that proves a source file is an executable browser entry rather than a filename guess. */
export type PreviewApplicationEntryKind = 'create-root' | 'hydrate-root' | 'legacy-render';

/** One statically proven ReactDOM mount site retained without executing its bootstrap module. */
export interface PreviewApplicationEntryPoint {
  /** Mount API whose import identity and call shape were both proven. */
  readonly kind: PreviewApplicationEntryKind;
  /** Source offset of the mount or render call, used for deterministic candidate identity. */
  readonly occurrenceStart: number;
  /** Absolute entry module path. */
  readonly sourcePath: string;
  /** Component-like JSX wrappers visible directly in the entry render argument. */
  readonly wrapperNames: readonly string[];
}

/** Semantic relationship by which one inner value reaches the next outer render owner. */
export type PreviewRenderChainEdgeKind =
  | 'component-render'
  | 'create-element'
  | 'react-lazy'
  | 're-export'
  | 'route-branch'
  | 'value-flow'
  | 'entry-render';

/** Confidence attached to syntax-only edges that may still be selected by a runtime condition. */
export type PreviewRenderChainCertainty = 'confirmed' | 'conditional';

/**
 * One inner-to-outer step in a candidate target-to-entry path.
 * `label` is intentionally path-free so the browser toolbar can explain the chain without exposing
 * local filesystem identities; `sourcePath` remains build metadata for HMR dependency tracking.
 */
export interface PreviewRenderChainStep {
  /** Whether the edge is unconditional syntax or belongs to a route/configuration branch. */
  readonly certainty: PreviewRenderChainCertainty;
  /** Relationship connecting this step to the following outer step. */
  readonly kind: PreviewRenderChainEdgeKind;
  /** Human-readable local declaration, export, route value, or entry label. */
  readonly label: string;
  /** Source offset of the evidence that created this step. */
  readonly occurrenceStart: number;
  /** Absolute authored path used only by build-time dependency and candidate identity logic. */
  readonly sourcePath: string;
  /** Nested component wrappers crossed at this occurrence, ordered inner-to-outer. */
  readonly wrapperNames: readonly string[];
}

/** One complete or partial target-to-entry path retained alongside equally valid alternatives. */
export interface PreviewRenderChainCandidate {
  /** Stable identity derived only from authored paths, offsets, and the selected target export. */
  readonly id: string;
  /** ReactDOM entry reached by this path; absent for a bounded partial application root. */
  readonly entryPoint?: PreviewApplicationEntryPoint;
  /** Inner-to-outer graph steps beginning at the selected target export. */
  readonly steps: readonly PreviewRenderChainStep[];
}

/** Explicit distinction between proven entry reachability and a standalone safe fallback. */
export type PreviewRenderChainReachability = 'entry-connected' | 'entry-unreachable' | 'ambiguous';

/** Why a render-chain search returned no proven application entry. */
export type PreviewRenderChainStopReason = 'entry-not-found' | 'entry-unreachable' | 'graph-limit';

/**
 * Immutable discovery result for one current-file export.
 * This object describes the real application structure, while the Inspector ancestor plan keeps
 * ownership of the conservative component export that is actually bundled and mounted.
 */
export interface PreviewRenderChainPlan {
  /** Every source file contributing to selected and alternative path evidence. */
  readonly dependencyPaths: readonly string[];
  /** Best entry-connected candidate first, followed by other bounded valid paths. */
  readonly paths: readonly PreviewRenderChainCandidate[];
  /** Entry reachability kept separate from the legacy ancestor planner's mount completeness. */
  readonly reachability: PreviewRenderChainReachability;
  /** Present only when no ReactDOM entry can be proven within the bounded graph. */
  readonly stopReason?: PreviewRenderChainStopReason;
  /** Current-file export used to seed this search. */
  readonly target: PreviewRenderExportReference;
  /** Whether a fixed graph/path budget may have omitted additional valid alternatives. */
  readonly truncated: boolean;
}

/**
 * Render-chain plans keyed by every explicit runtime export discovered in the selected file.
 * A plain immutable record keeps the result JSON-safe for the generated Inspector descriptor and
 * lets callers retain all export alternatives without rebuilding the shared application graph.
 */
export type PreviewRenderChainPlansByExport = Readonly<Record<string, PreviewRenderChainPlan>>;
