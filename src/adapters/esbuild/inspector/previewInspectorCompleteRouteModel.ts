/** Frozen inventory identities, replay contracts, and bounded enumeration limits. */
import type {
  PreviewInspectorRouteSelectionStep,
  PreviewRouteExecutionPlanArtifact,
} from '../../../domain/preview';
import type { PreviewRenderChainPlan, ResolvePreviewRenderGraphModule } from '../renderGraph';
import { type PreviewInspectorBundleDiagnostics } from './previewInspectorBundleDiagnostics';
import { type PreviewInspectorRouteBranch } from './previewInspectorRouteBranchPlan';

export const DEFAULT_MAXIMUM_ANALYSIS_PASSES = 4_096;

export const DEFAULT_MAXIMUM_BRANCHES = 8_192;

export const DEFAULT_MAXIMUM_DEPTH = 64;

/** Explicit reason a discovered route cannot be executed safely. */
export type PreviewInspectorCompleteRouteUnresolvedReason =
  | 'analysis-limit'
  | 'catalog-unresolved'
  | 'component-unresolved'
  | 'cyclic-owner'
  | 'factory-contract-unresolved'
  | 'nested-owner-unproven'
  | 'route-provenance-ambiguous'
  | 'submodule-base-unresolved'
  | 'exact-replay-identity-mismatch'
  | 'exact-replay-non-exact-selection'
  | 'exact-replay-target-unavailable'
  | 'execution-plan-unavailable';

/** Root or nested module whose inert route configuration owns one inventory row. */
export interface PreviewInspectorCompleteRouteOwner {
  readonly exportName: string;
  readonly sourcePath: string;
}

/** Common immutable facts retained for every accounted route choice. */
export interface PreviewInspectorCompleteRouteBaseEntry {
  /** Stable branch identity derived from the complete public selection chain. */
  readonly id: string;
  readonly componentName: string;
  readonly exportName?: string;
  readonly owner: PreviewInspectorCompleteRouteOwner;
  readonly parameters: Readonly<Record<string, string>>;
  readonly pathname: string;
  readonly pattern: string;
  readonly selection: readonly PreviewInspectorRouteSelectionStep[];
  readonly sourcePath?: string;
}

/** Compiler-owned route identity returned only after an independent exact replay. */
export interface PreviewInspectorExactRouteReplay {
  readonly branchId: string;
  readonly componentName: string;
  readonly executionRoot: PreviewInspectorCompleteRouteOwner & {
    readonly basePattern: string;
  };
  readonly exportName: string;
  readonly owner: PreviewInspectorCompleteRouteOwner;
  readonly ownerChain: readonly (PreviewInspectorCompleteRouteOwner & {
    readonly basePattern: string;
  })[];
  readonly parameters: Readonly<Record<string, string>>;
  readonly pathname: string;
  readonly pattern: string;
  readonly policyDigest: string;
  readonly routeSelectionResolution: 'exact';
  readonly runtimeTarget: PreviewInspectorCompleteRouteOwner;
  readonly selection: readonly PreviewInspectorRouteSelectionStep[];
  readonly sourcePath: string;
  readonly version: 1;
}

/** One terminal choice that can be sent back to the real compiler unchanged. */
export interface PreviewInspectorCompleteRunnableRoute extends PreviewInspectorCompleteRouteBaseEntry {
  readonly disposition: 'runnable';
  readonly executionPlan: PreviewRouteExecutionPlanArtifact;
  readonly replay: PreviewInspectorExactRouteReplay;
}

/** One statically observed choice for which execution proof is incomplete. */
export interface PreviewInspectorCompleteUnresolvedRoute extends PreviewInspectorCompleteRouteBaseEntry {
  readonly disposition: 'unresolved';
  readonly reason: PreviewInspectorCompleteRouteUnresolvedReason;
}

/**
 * One non-terminal owner choice whose visible states are already represented by descendants.
 *
 * This avoids running a nested router's automatic default twice while still accounting for the
 * authored parent choice exactly once.
 */
export interface PreviewInspectorCompleteDuplicateRoute extends PreviewInspectorCompleteRouteBaseEntry {
  readonly disposition: 'duplicate';
  readonly duplicateOf: string;
  readonly reason: 'exact-semantic-route' | 'expanded-owner';
  readonly replay: PreviewInspectorExactRouteReplay;
}

/** Exactly one accounting outcome for every unique branch identity. */
export type PreviewInspectorCompleteRouteEntry =
  | PreviewInspectorCompleteRunnableRoute
  | PreviewInspectorCompleteUnresolvedRoute
  | PreviewInspectorCompleteDuplicateRoute;

export type PreviewInspectorProvisionalRouteEntry =
  | Omit<PreviewInspectorCompleteRunnableRoute, 'executionPlan' | 'replay'>
  | PreviewInspectorCompleteUnresolvedRoute
  | Omit<PreviewInspectorCompleteDuplicateRoute, 'replay'>;

/** Stable aggregate counts derived from the final ordered entry list. */
export interface PreviewInspectorCompleteRouteCounts {
  readonly duplicate: number;
  readonly runnable: number;
  readonly total: number;
  readonly unresolved: number;
}

/** Frozen result consumed by the compiler-to-browser campaign. */
export interface PreviewInspectorCompleteRouteInventory {
  readonly analysisPasses: number;
  readonly complete: boolean;
  readonly counts: PreviewInspectorCompleteRouteCounts;
  readonly dependencyPaths: readonly string[];
  readonly entries: readonly PreviewInspectorCompleteRouteEntry[];
  readonly limits: PreviewInspectorCompleteRouteInventoryLimits;
  readonly owner: PreviewInspectorCompleteRouteOwner;
  readonly predecessorVersion: 3;
  readonly replayPasses: number;
  readonly replayPolicy: {
    readonly digest: string;
    readonly predecessorVersion: 3;
    readonly version: 4;
  };
  readonly truncated: boolean;
  readonly version: 4;
}

/** Explicit traversal limits make incomplete inventories observable and testable. */
export interface PreviewInspectorCompleteRouteInventoryLimits {
  readonly maximumAnalysisPasses: number;
  readonly maximumBranches: number;
  readonly maximumDepth: number;
}

/** Source-general phase names emitted without carrying application-owned identities. */
export type PreviewCompleteRouteInventoryTelemetryPhase =
  | 'prepare-source-index'
  | 'prepare-target-usage'
  | 'enumerate-branches'
  | 'replay-branches'
  | 'execution-shared-context'
  | 'execution-route-usage'
  | 'execution-frontier-style'
  | 'execution-frontier-globals'
  | 'execution-frontier-plan'
  | 'execution-frontier-candidates'
  | 'execution-frontier-bundle'
  | 'execution-frontier-ownership'
  | 'execution-frontier-target-contract'
  | 'execution-frontier-root-contract'
  | 'execution-frontier-artifact'
  | 'finalize-inventory'
  | 'shutdown';

/** Bounded transition vocabulary shared by analysis, worker protocol, and profile persistence. */
export type PreviewCompleteRouteInventoryTelemetryTransition = 'start' | 'checkpoint' | 'complete';

/** Frozen progress event whose optional counters are present only for their applicable phase. */
export interface PreviewCompleteRouteInventoryTelemetryEvent {
  readonly analysisPasses?: number;
  readonly bundleDiagnostics?: PreviewInspectorBundleDiagnostics;
  readonly cpuSystemMicros: number;
  readonly cpuUserMicros: number;
  readonly discoveredBranches?: number;
  readonly elapsedMs: number;
  readonly enumerationPrefixComputationCount?: number;
  readonly enumerationPrefixEntryCount?: number;
  readonly enumerationPrefixHitCount?: number;
  readonly enumerationPrefixRequestCount?: number;
  readonly executionPlanCompleted?: number;
  readonly executionPlanTotal?: number;
  readonly heapUsedBytes: number;
  readonly phase: PreviewCompleteRouteInventoryTelemetryPhase;
  readonly queuedSelections?: number;
  readonly replayCompleted?: number;
  readonly replayPrefixComputationCount?: number;
  readonly replayPrefixEntryCount?: number;
  readonly replayPrefixHitCount?: number;
  readonly replayPrefixRequestCount?: number;
  readonly replayTotal?: number;
  readonly routeOrdinal?: number;
  readonly rssBytes: number;
  readonly sequence: number;
  readonly transition: PreviewCompleteRouteInventoryTelemetryTransition;
  /** Runtime validation accepts only the current policy version; legacy fixtures remain typable. */
  readonly version: 1 | 2 | 3 | 4;
}

/** Event fields supplied by instrumentation before monotonic/resource values are sampled. */
export type PreviewCompleteRouteInventoryTelemetryEventDraftBase = Omit<
  PreviewCompleteRouteInventoryTelemetryEvent,
  | 'bundleDiagnostics'
  | 'cpuSystemMicros'
  | 'cpuUserMicros'
  | 'elapsedMs'
  | 'heapUsedBytes'
  | 'rssBytes'
  | 'sequence'
  | 'version'
>;

/** Conditional draft contract makes the diagnostics payload impossible on every other event. */
export type PreviewCompleteRouteInventoryTelemetryEventDraft =
  PreviewCompleteRouteInventoryTelemetryEventDraftBase &
    (
      | {
          readonly bundleDiagnostics: PreviewInspectorBundleDiagnostics;
          readonly phase: 'execution-frontier-bundle';
          readonly transition: 'complete';
        }
      | {
          readonly bundleDiagnostics?: never;
          readonly phase: 'execution-frontier-bundle';
          readonly transition: Exclude<
            PreviewCompleteRouteInventoryTelemetryTransition,
            'complete'
          >;
        }
      | {
          readonly bundleDiagnostics?: never;
          readonly phase: Exclude<
            PreviewCompleteRouteInventoryTelemetryPhase,
            'execution-frontier-bundle'
          >;
        }
    );

/** Optional sink kept outside inventory identity, caching, and result construction. */
export type PreviewCompleteRouteInventoryTelemetryObserver = (
  event: PreviewCompleteRouteInventoryTelemetryEvent,
) => void;

/** Shared monotonic emitter threaded only through complete-inventory analysis. */
export interface PreviewCompleteRouteInventoryTelemetryEmitter {
  readonly emit: (event: PreviewCompleteRouteInventoryTelemetryEventDraft) => void;
}

/** Bounded execution work identity supplied without route IDs or selection contents. */
export interface PreviewCompleteRouteInventoryExecutionProgress {
  readonly routeOrdinal: number;
  readonly total: number;
}

/** Static inputs shared with the existing selected-branch planner. */
export interface CollectPreviewInspectorCompleteRouteInventoryOptions {
  readonly documentPath: string;
  readonly exportName: string;
  readonly limits?: Partial<PreviewInspectorCompleteRouteInventoryLimits>;
  /** Real fast compiler planner; absence is never promoted to runnable. */
  readonly prepareExecutionPlan: (
    entry: PreviewInspectorPlanlessRunnableRoute,
    progress: PreviewCompleteRouteInventoryExecutionProgress,
  ) => Promise<PreviewRouteExecutionPlanArtifact | undefined>;
  readonly readSource: (sourcePath: string) => Promise<string | undefined>;
  readonly renderChain: PreviewRenderChainPlan;
  readonly resolveModule?: ResolvePreviewRenderGraphModule;
  readonly sourcePaths: readonly string[];
  readonly telemetry?: PreviewCompleteRouteInventoryTelemetryEmitter;
}

/** Exact inert replay awaiting proof from the real fast compiler planning path. */
export type PreviewInspectorPlanlessRunnableRoute = Omit<
  PreviewInspectorCompleteRunnableRoute,
  'executionPlan'
>;

export type PreviewInspectorExactReplayedRouteEntry =
  | PreviewInspectorPlanlessRunnableRoute
  | PreviewInspectorCompleteUnresolvedRoute
  | PreviewInspectorCompleteDuplicateRoute;

export interface ObservedBranch {
  branch: PreviewInspectorRouteBranch;
  owner: PreviewInspectorCompleteRouteOwner;
}

export type PreviewInspectorExactRouteReplayResult =
  | {
      readonly exact: true;
      readonly replay: PreviewInspectorExactRouteReplay;
    }
  | {
      readonly exact: false;
      readonly reason: 'exact-replay-identity-mismatch' | 'exact-replay-non-exact-selection';
    };
