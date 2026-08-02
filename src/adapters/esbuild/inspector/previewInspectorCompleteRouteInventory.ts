/* eslint-disable max-lines -- Complete-inventory telemetry must remain beside its frozen result contract. */
/**
 * Enumerates every statically selectable React Router leaf below one route owner.
 *
 * The existing branch planner deliberately expands only one selected branch per pass. This module
 * drives that planner with a bounded queue, preserving its exact selection semantics while keeping
 * application modules inert. Intermediate router owners are retained as duplicate aliases of their
 * concrete descendant routes; choices that cannot be proven safe remain explicit unresolved rows.
 */
import { createHash } from 'node:crypto';
import path from 'node:path';
import type {
  PreviewInspectorRouteSelectionStep,
  PreviewRouteExecutionPlanArtifact,
} from '../../../domain/preview';
import type { PreviewRenderChainPlan, ResolvePreviewRenderGraphModule } from '../renderGraph';
import {
  collectPreviewInspectorRouteBranchPlan,
  createPreviewInspectorRouteOwnerLocationInventoryMemo,
  createPreviewInspectorRouteBranchSelectionPrefixProvider,
  type PreviewInspectorRouteBranch,
  type PreviewInspectorRouteBranchPlan,
  type PreviewInspectorRouteOwnerLocationInventoryMemo,
} from './previewInspectorRouteBranchPlan';
import { createPreviewInspectorRouteBranchId } from './previewInspectorRouteBranchIdentity';
import { collectPreviewInspectorRouteParameterValues } from './previewInspectorRoutePattern';
import {
  PREVIEW_INSPECTOR_BUNDLE_DIAGNOSTIC_FIELD_NAMES,
  type PreviewInspectorBundleDiagnostics,
} from './previewInspectorBundleDiagnostics';

const DEFAULT_MAXIMUM_ANALYSIS_PASSES = 4_096;
const DEFAULT_MAXIMUM_BRANCHES = 8_192;
const DEFAULT_MAXIMUM_DEPTH = 64;
const DENSE_EXECUTION_TELEMETRY_ORDINAL_LIMIT = 64;
export const PREVIEW_COMPLETE_ROUTE_INVENTORY_TELEMETRY_POLICY_VERSION = 4;
export const PREVIEW_COMPLETE_ROUTE_INVENTORY_TELEMETRY_COMPUTED_MAXIMUM_EVENTS = 1_600;
export const PREVIEW_COMPLETE_ROUTE_INVENTORY_TELEMETRY_MAXIMUM_EVENTS = 1_664;
export const PREVIEW_COMPLETE_ROUTE_INVENTORY_TELEMETRY_POLICY = Object.freeze({
  bundleDiagnostics: Object.freeze({
    diagnosticsVersion: 1,
    durationSemantics: 'inclusive-overlapping-microseconds-not-a-sum-partition',
    fieldNames: PREVIEW_INSPECTOR_BUNDLE_DIAGNOSTIC_FIELD_NAMES,
    placement: 'execution-frontier-bundle-complete-only',
    relationships: Object.freeze([
      'sliceRequestCount=sliceComputationCount+sliceHitCount',
      'inventoryRequestCount=inventoryComputationCount+inventoryHitCount',
      'inventoryReadRequestCount>=inventoryReadPathCacheHitCount',
      'queueSortCount=queueIterationCount',
      'queueIterationCount=0 iff queuePeakLength=0',
    ]),
    required: true,
    scalarContract: 'nonnegative-safe-integer',
  }),
  cacheKeyParticipation: false,
  checkpointPolicy: 'ordinal-one-powers-of-two-and-final',
  computedMaximumEvents: PREVIEW_COMPLETE_ROUTE_INVENTORY_TELEMETRY_COMPUTED_MAXIMUM_EVENTS,
  counterFields: Object.freeze([
    'analysisPasses',
    'queuedSelections',
    'discoveredBranches',
    'replayCompleted',
    'replayTotal',
    'executionPlanCompleted',
    'executionPlanTotal',
    'routeOrdinal',
    'enumerationPrefixRequestCount',
    'enumerationPrefixComputationCount',
    'enumerationPrefixHitCount',
    'enumerationPrefixEntryCount',
    'replayPrefixRequestCount',
    'replayPrefixComputationCount',
    'replayPrefixHitCount',
    'replayPrefixEntryCount',
  ]),
  denseExecutionOrdinalLimit: DENSE_EXECUTION_TELEMETRY_ORDINAL_LIMIT,
  digestParticipation: false,
  elapsedMs: 'monotonic',
  executionCheckpointPolicy: 'every-ordinal-one-through-64-then-powers-of-two-and-final',
  inventoryParticipation: false,
  maximumEvents: PREVIEW_COMPLETE_ROUTE_INVENTORY_TELEMETRY_MAXIMUM_EVENTS,
  observationalOnly: true,
  phases: Object.freeze([
    'prepare-source-index',
    'prepare-target-usage',
    'enumerate-branches',
    'replay-branches',
    'execution-shared-context',
    'execution-route-usage',
    'execution-frontier-style',
    'execution-frontier-globals',
    'execution-frontier-plan',
    'execution-frontier-candidates',
    'execution-frontier-bundle',
    'execution-frontier-ownership',
    'execution-frontier-target-contract',
    'execution-frontier-root-contract',
    'execution-frontier-artifact',
    'finalize-inventory',
    'shutdown',
  ]),
  payloadExcludes: Object.freeze([
    'application-names',
    'component-export-names',
    'environment-values',
    'errors',
    'filenames',
    'module-specifiers',
    'raw-paths',
    'route-identities',
    'selection-contents',
    'source-text',
  ]),
  resourceFields: Object.freeze(['heapUsedBytes', 'rssBytes', 'cpuUserMicros', 'cpuSystemMicros']),
  sequence: 'strictly-monotonic-starting-at-one',
  transitions: Object.freeze(['start', 'checkpoint', 'complete']),
  watchdogExtension: false,
  workerMessages: 'observational-only',
  version: PREVIEW_COMPLETE_ROUTE_INVENTORY_TELEMETRY_POLICY_VERSION,
});
export const PREVIEW_COMPLETE_ROUTE_INVENTORY_TELEMETRY_POLICY_DIGEST = createHash('sha256')
  .update(JSON.stringify(PREVIEW_COMPLETE_ROUTE_INVENTORY_TELEMETRY_POLICY))
  .digest('hex');
export const PREVIEW_COMPLETE_ROUTE_REPLAY_POLICY_VERSION = 4;
export const PREVIEW_COMPLETE_ROUTE_REPLAY_POLICY_DIGEST = createHash('sha256')
  .update(
    JSON.stringify({
      canonicalComposition: true,
      ambiguityDemotion: true,
      boundRegistryChainAuthority: true,
      contextualDirectRouteAuthority: 'exact-component-source-export',
      directRouteOccurrencePartition: 'total-disjoint',
      duplicateRequiresExactTarget: true,
      exactOccurrenceAssociation: true,
      exactFields: [
        'branch-id',
        'selection',
        'owner',
        'owner-chain',
        'source-export',
        'pattern',
        'pathname',
        'parameters',
        'execution-root',
        'runtime-target',
      ],
      fallbackIsRunnable: false,
      losslessUnresolvedAccounting: true,
      nameOnlyCatalogJoins: false,
      ownedContextualDirectRouteScope: true,
      rankingIdentityAuthority: 'order-only',
      runnableAuthority: 'real-fast-context-canonical-execution-plan',
      version: PREVIEW_COMPLETE_ROUTE_REPLAY_POLICY_VERSION,
    }),
  )
  .digest('hex');

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

type PreviewInspectorProvisionalRouteEntry =
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
type PreviewCompleteRouteInventoryTelemetryEventDraftBase = Omit<
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

/** Stable overflow terminal; the profiler must stop instead of silently truncating events. */
export class PreviewCompleteRouteInventoryTelemetryOverflowError extends Error {
  public override readonly name = 'PreviewCompleteRouteInventoryTelemetryOverflowError';

  /** Creates the stable overflow terminal without carrying source-derived context. */
  public constructor() {
    super(
      `Complete route inventory telemetry exceeded ${PREVIEW_COMPLETE_ROUTE_INVENTORY_TELEMETRY_MAXIMUM_EVENTS.toString()} events.`,
    );
  }
}

/** Creates one bounded source-general emitter; observer exceptions are deliberately isolated. */
export function createPreviewCompleteRouteInventoryTelemetryEmitter(
  observer: PreviewCompleteRouteInventoryTelemetryObserver | undefined,
): PreviewCompleteRouteInventoryTelemetryEmitter | undefined {
  if (observer === undefined) return undefined;
  const startedAt = process.hrtime.bigint();
  let sequence = 0;
  return Object.freeze({
    emit(draft: PreviewCompleteRouteInventoryTelemetryEventDraft): void {
      if (sequence >= PREVIEW_COMPLETE_ROUTE_INVENTORY_TELEMETRY_MAXIMUM_EVENTS) {
        throw new PreviewCompleteRouteInventoryTelemetryOverflowError();
      }
      sequence += 1;
      const memory = process.memoryUsage();
      const resources = process.resourceUsage();
      const event = Object.freeze({
        ...draft,
        cpuSystemMicros: resources.systemCPUTime,
        cpuUserMicros: resources.userCPUTime,
        elapsedMs: Number((process.hrtime.bigint() - startedAt) / 1_000_000n),
        heapUsedBytes: memory.heapUsed,
        rssBytes: memory.rss,
        sequence,
        version: PREVIEW_COMPLETE_ROUTE_INVENTORY_TELEMETRY_POLICY_VERSION,
      }) satisfies PreviewCompleteRouteInventoryTelemetryEvent;
      try {
        observer(event);
      } catch {
        // Telemetry is observational and cannot affect inventory results or cleanup.
      }
    },
  });
}

/** Samples work at one, powers of two, and the final positive ordinal. */
export function isPreviewCompleteRouteInventoryTelemetryCheckpoint(
  ordinal: number,
  finalOrdinal: number,
): boolean {
  return (
    ordinal > 0 &&
    (ordinal === 1 ||
      ordinal === finalOrdinal ||
      (Number.isSafeInteger(ordinal) && (ordinal & (ordinal - 1)) === 0))
  );
}

/** Samples every execution route through 64, then powers of two and the final ordinal. */
export function isPreviewCompleteRouteInventoryExecutionTelemetryCheckpoint(
  ordinal: number,
  finalOrdinal: number,
): boolean {
  return (
    Number.isSafeInteger(ordinal) &&
    ordinal > 0 &&
    (ordinal <= DENSE_EXECUTION_TELEMETRY_ORDINAL_LIMIT ||
      isPreviewCompleteRouteInventoryTelemetryCheckpoint(ordinal, finalOrdinal))
  );
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

type PreviewInspectorExactReplayedRouteEntry =
  | PreviewInspectorPlanlessRunnableRoute
  | PreviewInspectorCompleteUnresolvedRoute
  | PreviewInspectorCompleteDuplicateRoute;

interface ObservedBranch {
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

/**
 * Expands every selectable branch sequentially until all leaves are classified or a limit is hit.
 */
export async function collectPreviewInspectorCompleteRouteInventory(
  options: CollectPreviewInspectorCompleteRouteInventoryOptions,
): Promise<PreviewInspectorCompleteRouteInventory> {
  const limits = normalizeLimits(options.limits);
  const rootOwner = freezeOwner(options.documentPath, options.exportName);
  const branches = new Map<string, ObservedBranch>();
  const dependencyPaths = new Set<string>([rootOwner.sourcePath]);
  const queuedSelections = new Set<string>();
  const queue: (readonly PreviewInspectorRouteSelectionStep[])[] = [];
  let analysisPasses = 0;
  let truncated = false;
  const ownerLocationInventoryMemo = createPreviewInspectorRouteOwnerLocationInventoryMemo({
    readSource: options.readSource,
    ...(options.resolveModule === undefined ? {} : { resolveModule: options.resolveModule }),
    renderChain: options.renderChain,
    sourcePaths: options.sourcePaths,
  });
  const enumerationPrefixProvider = createPreviewInspectorRouteBranchSelectionPrefixProvider();

  try {
    options.telemetry?.emit({
      analysisPasses: 0,
      discoveredBranches: 0,
      ...enumerationPrefixCounters(enumerationPrefixProvider),
      phase: 'enumerate-branches',
      queuedSelections: 0,
      transition: 'start',
    });
    enqueue(Object.freeze([]));
    while (queue.length > 0) {
      if (analysisPasses >= limits.maximumAnalysisPasses) {
        truncated = true;
        break;
      }
      const selection = queue.shift();
      if (selection === undefined) break;
      analysisPasses += 1;
      const plan = await collectPreviewInspectorRouteBranchPlan({
        documentPath: rootOwner.sourcePath,
        exportName: rootOwner.exportName,
        ownerLocationInventoryMemo,
        readSource: options.readSource,
        ...(options.resolveModule === undefined ? {} : { resolveModule: options.resolveModule }),
        renderChain: options.renderChain,
        selectionPrefixProvider: enumerationPrefixProvider,
        ...(selection.length === 0 ? {} : { selection }),
        sourcePaths: options.sourcePaths,
      });
      for (const dependencyPath of plan.dependencyPaths) {
        dependencyPaths.add(path.normalize(dependencyPath));
      }
      for (const branch of plan.branches) {
        const existing = branches.get(branch.id);
        if (existing === undefined) {
          if (branches.size >= limits.maximumBranches) {
            truncated = true;
            continue;
          }
          branches.set(branch.id, {
            branch,
            owner: inferBranchOwner(branch, plan.branches, branches, rootOwner),
          });
        } else if (
          branch.childState === 'expanded' ||
          (branch.childState === 'leaf' && existing.branch.childState === 'unknown')
        ) {
          existing.branch = branch;
        }
        if (
          branch.selectable === true &&
          branch.childState === 'unknown' &&
          branch.selectionPath.length <= limits.maximumDepth
        ) {
          enqueue(branch.selectionPath);
        } else if (
          branch.selectable === true &&
          branch.childState === 'unknown' &&
          branch.selectionPath.length > limits.maximumDepth
        ) {
          truncated = true;
        }
      }
      if (
        isPreviewCompleteRouteInventoryTelemetryCheckpoint(
          analysisPasses,
          limits.maximumAnalysisPasses,
        )
      ) {
        options.telemetry?.emit({
          analysisPasses,
          discoveredBranches: branches.size,
          ...enumerationPrefixCounters(enumerationPrefixProvider),
          phase: 'enumerate-branches',
          queuedSelections: queuedSelections.size,
          transition: 'checkpoint',
        });
      }
    }
    if (
      analysisPasses > 0 &&
      !isPreviewCompleteRouteInventoryTelemetryCheckpoint(
        analysisPasses,
        limits.maximumAnalysisPasses,
      )
    ) {
      options.telemetry?.emit({
        analysisPasses,
        discoveredBranches: branches.size,
        ...enumerationPrefixCounters(enumerationPrefixProvider),
        phase: 'enumerate-branches',
        queuedSelections: queuedSelections.size,
        transition: 'checkpoint',
      });
    }
    options.telemetry?.emit({
      analysisPasses,
      discoveredBranches: branches.size,
      ...enumerationPrefixCounters(enumerationPrefixProvider),
      phase: 'enumerate-branches',
      queuedSelections: queuedSelections.size,
      transition: 'complete',
    });
  } finally {
    enumerationPrefixProvider.release();
    ownerLocationInventoryMemo.release();
  }

  const ordered = [...branches.values()].sort(compareObservedBranches);
  const provisionalEntries = Object.freeze(
    ordered.map(({ branch, owner }) =>
      classifyBranch(branch, owner, ordered, rootOwner, truncated),
    ),
  );
  const replayOwnerLocationInventoryMemo = createPreviewInspectorRouteOwnerLocationInventoryMemo({
    readSource: options.readSource,
    ...(options.resolveModule === undefined ? {} : { resolveModule: options.resolveModule }),
    renderChain: options.renderChain,
    sourcePaths: options.sourcePaths,
  });
  const replayPrefixProvider = createPreviewInspectorRouteBranchSelectionPrefixProvider();
  let replayed: Awaited<ReturnType<typeof applyExactReplayDispositions>>;
  try {
    replayed = await applyExactReplayDispositions(
      provisionalEntries,
      options,
      rootOwner,
      dependencyPaths,
      replayOwnerLocationInventoryMemo,
      replayPrefixProvider,
      options.telemetry,
    );
  } finally {
    replayPrefixProvider.release();
    replayOwnerLocationInventoryMemo.release();
  }
  const entries = await applyExecutionPlanDispositions(replayed.entries, options);
  options.telemetry?.emit({
    phase: 'finalize-inventory',
    transition: 'start',
  });
  const counts = Object.freeze({
    duplicate: entries.filter((entry) => entry.disposition === 'duplicate').length,
    runnable: entries.filter((entry) => entry.disposition === 'runnable').length,
    total: entries.length,
    unresolved: entries.filter((entry) => entry.disposition === 'unresolved').length,
  });
  const inventory = Object.freeze({
    analysisPasses,
    complete: !truncated,
    counts,
    dependencyPaths: Object.freeze([...dependencyPaths].sort()),
    entries,
    limits,
    owner: rootOwner,
    predecessorVersion: 3 as const,
    replayPasses: replayed.replayPasses,
    replayPolicy: Object.freeze({
      digest: PREVIEW_COMPLETE_ROUTE_REPLAY_POLICY_DIGEST,
      predecessorVersion: 3 as const,
      version: PREVIEW_COMPLETE_ROUTE_REPLAY_POLICY_VERSION,
    }),
    truncated,
    version: 4 as const,
  });
  options.telemetry?.emit({
    phase: 'finalize-inventory',
    transition: 'complete',
  });
  return inventory;

  /** Enqueues one public selection exactly once in stable breadth-first order. */
  function enqueue(selection: readonly PreviewInspectorRouteSelectionStep[]): void {
    const frozen = Object.freeze(
      selection.map((step) =>
        Object.freeze({ componentName: step.componentName, pattern: step.pattern }),
      ),
    );
    const identity = JSON.stringify(frozen);
    if (queuedSelections.has(identity)) return;
    queuedSelections.add(identity);
    queue.push(frozen);
  }
}

/**
 * Replays one frozen runnable entry with the same inert compiler inputs used by inventory analysis.
 */
export async function replayPreviewInspectorCompleteRouteEntry(
  options: Omit<CollectPreviewInspectorCompleteRouteInventoryOptions, 'prepareExecutionPlan'>,
  entry: PreviewInspectorCompleteRouteBaseEntry,
): Promise<PreviewInspectorExactRouteReplayResult> {
  const rootOwner = freezeOwner(options.documentPath, options.exportName);
  const plan = await collectPreviewInspectorRouteBranchPlan({
    documentPath: rootOwner.sourcePath,
    exportName: rootOwner.exportName,
    readSource: options.readSource,
    ...(options.resolveModule === undefined ? {} : { resolveModule: options.resolveModule }),
    renderChain: options.renderChain,
    selection: entry.selection,
    sourcePaths: options.sourcePaths,
  });
  return correlateExactReplay(entry, plan, rootOwner);
}

/** Replays every provisional runnable and demotes any identity that is not exact. */
async function applyExactReplayDispositions(
  provisionalEntries: readonly PreviewInspectorProvisionalRouteEntry[],
  options: CollectPreviewInspectorCompleteRouteInventoryOptions,
  rootOwner: PreviewInspectorCompleteRouteOwner,
  dependencyPaths: Set<string>,
  ownerLocationInventoryMemo: PreviewInspectorRouteOwnerLocationInventoryMemo,
  prefixProvider: ReturnType<typeof createPreviewInspectorRouteBranchSelectionPrefixProvider>,
  telemetry: PreviewCompleteRouteInventoryTelemetryEmitter | undefined,
): Promise<{
  readonly entries: readonly PreviewInspectorExactReplayedRouteEntry[];
  readonly replayPasses: number;
}> {
  const exactRunnables = new Map<string, PreviewInspectorPlanlessRunnableRoute>();
  const replacements = new Map<string, PreviewInspectorExactReplayedRouteEntry>();
  let replayPasses = 0;
  const replayTotal = provisionalEntries.filter(
    (entry) => entry.disposition === 'runnable' || entry.disposition === 'duplicate',
  ).length;
  telemetry?.emit({
    phase: 'replay-branches',
    ...replayPrefixCounters(prefixProvider),
    replayCompleted: 0,
    replayTotal,
    transition: 'start',
  });
  for (const entry of provisionalEntries) {
    if (entry.disposition !== 'runnable') continue;
    replayPasses += 1;
    const plan = await collectReplayPlan(
      options,
      rootOwner,
      entry.selection,
      ownerLocationInventoryMemo,
      prefixProvider,
    );
    collectReplayDependencies(plan, dependencyPaths);
    const result = correlateExactReplay(entry, plan, rootOwner);
    if (result.exact) {
      const runnable = Object.freeze({
        ...entry,
        replay: result.replay,
      }) satisfies PreviewInspectorPlanlessRunnableRoute;
      exactRunnables.set(entry.id, runnable);
      replacements.set(entry.id, runnable);
    } else {
      replacements.set(
        entry.id,
        Object.freeze({
          ...freezeUnresolvedBase(entry),
          disposition: 'unresolved' as const,
          reason: result.reason,
        }),
      );
    }
    emitReplayCheckpoint();
  }
  for (const entry of provisionalEntries) {
    if (entry.disposition !== 'duplicate') continue;
    replayPasses += 1;
    const plan = await collectReplayPlan(
      options,
      rootOwner,
      entry.selection,
      ownerLocationInventoryMemo,
      prefixProvider,
    );
    collectReplayDependencies(plan, dependencyPaths);
    const target =
      plan.selectionResolution === 'exact' && plan.selectedBranchId !== undefined
        ? exactRunnables.get(plan.selectedBranchId)
        : undefined;
    if (target !== undefined) {
      const targetReplay = correlateExactReplay(target, plan, rootOwner);
      if (targetReplay.exact) {
        replacements.set(
          entry.id,
          Object.freeze({
            ...entry,
            duplicateOf: target.id,
            replay: targetReplay.replay,
          }),
        );
        emitReplayCheckpoint();
        continue;
      }
    }
    replacements.set(
      entry.id,
      Object.freeze({
        ...freezeUnresolvedBase(entry),
        disposition: 'unresolved' as const,
        reason: 'exact-replay-target-unavailable' as const,
      }),
    );
    emitReplayCheckpoint();
  }
  const result = Object.freeze({
    entries: Object.freeze(
      provisionalEntries.map((entry): PreviewInspectorExactReplayedRouteEntry => {
        const replacement = replacements.get(entry.id);
        if (replacement !== undefined) return replacement;
        if (entry.disposition === 'unresolved') return entry;
        throw new Error(`Exact route replay did not classify provisional branch: ${entry.id}`);
      }),
    ),
    replayPasses,
  });
  telemetry?.emit({
    phase: 'replay-branches',
    ...replayPrefixCounters(prefixProvider),
    replayCompleted: replayPasses,
    replayTotal,
    transition: 'complete',
  });
  return result;

  /** Emits one replay checkpoint without changing replay ordering or classification. */
  function emitReplayCheckpoint(): void {
    if (!isPreviewCompleteRouteInventoryTelemetryCheckpoint(replayPasses, replayTotal)) return;
    telemetry?.emit({
      phase: 'replay-branches',
      ...replayPrefixCounters(prefixProvider),
      replayCompleted: replayPasses,
      replayTotal,
      transition: 'checkpoint',
    });
  }
}

/** Promotes only routes proven by the real fast compiler planner; failures remain accounted. */
async function applyExecutionPlanDispositions(
  replayedEntries: readonly PreviewInspectorExactReplayedRouteEntry[],
  options: CollectPreviewInspectorCompleteRouteInventoryOptions,
): Promise<readonly PreviewInspectorCompleteRouteEntry[]> {
  const entries: PreviewInspectorCompleteRouteEntry[] = [];
  const executionPlanTotal = replayedEntries.filter(
    (entry) => entry.disposition === 'runnable',
  ).length;
  let routeOrdinal = 0;
  for (const entry of replayedEntries) {
    if (entry.disposition !== 'runnable') {
      entries.push(entry);
      continue;
    }
    routeOrdinal += 1;
    const executionPlan = await options.prepareExecutionPlan(
      entry,
      Object.freeze({ routeOrdinal, total: executionPlanTotal }),
    );
    if (executionPlan === undefined) {
      entries.push(
        Object.freeze({
          ...freezeUnresolvedBase(entry),
          disposition: 'unresolved' as const,
          reason: 'execution-plan-unavailable' as const,
        }),
      );
      continue;
    }
    entries.push(
      Object.freeze({
        ...entry,
        executionPlan,
      }),
    );
  }
  return Object.freeze(entries);
}

/** Collects one inert branch plan for an exact public route selection. */
async function collectReplayPlan(
  options: CollectPreviewInspectorCompleteRouteInventoryOptions,
  rootOwner: PreviewInspectorCompleteRouteOwner,
  selection: readonly PreviewInspectorRouteSelectionStep[],
  ownerLocationInventoryMemo: PreviewInspectorRouteOwnerLocationInventoryMemo,
  selectionPrefixProvider: ReturnType<
    typeof createPreviewInspectorRouteBranchSelectionPrefixProvider
  >,
): Promise<PreviewInspectorRouteBranchPlan> {
  return collectPreviewInspectorRouteBranchPlan({
    documentPath: rootOwner.sourcePath,
    exportName: rootOwner.exportName,
    ownerLocationInventoryMemo,
    readSource: options.readSource,
    ...(options.resolveModule === undefined ? {} : { resolveModule: options.resolveModule }),
    renderChain: options.renderChain,
    selection,
    selectionPrefixProvider,
    sourcePaths: options.sourcePaths,
  });
}

/** Captures phase-local enumeration statistics immediately before one telemetry emission. */
function enumerationPrefixCounters(
  provider: ReturnType<typeof createPreviewInspectorRouteBranchSelectionPrefixProvider>,
): Pick<
  PreviewCompleteRouteInventoryTelemetryEvent,
  | 'enumerationPrefixComputationCount'
  | 'enumerationPrefixEntryCount'
  | 'enumerationPrefixHitCount'
  | 'enumerationPrefixRequestCount'
> {
  const statistics = provider.getStatistics();
  return {
    enumerationPrefixComputationCount: statistics.computations,
    enumerationPrefixEntryCount: statistics.entries,
    enumerationPrefixHitCount: statistics.hits,
    enumerationPrefixRequestCount: statistics.requests,
  };
}

/** Captures phase-local replay statistics immediately before one telemetry emission. */
function replayPrefixCounters(
  provider: ReturnType<typeof createPreviewInspectorRouteBranchSelectionPrefixProvider>,
): Pick<
  PreviewCompleteRouteInventoryTelemetryEvent,
  | 'replayPrefixComputationCount'
  | 'replayPrefixEntryCount'
  | 'replayPrefixHitCount'
  | 'replayPrefixRequestCount'
> {
  const statistics = provider.getStatistics();
  return {
    replayPrefixComputationCount: statistics.computations,
    replayPrefixEntryCount: statistics.entries,
    replayPrefixHitCount: statistics.hits,
    replayPrefixRequestCount: statistics.requests,
  };
}

/** Correlates a provisional entry to one independently selected exact branch identity. */
function correlateExactReplay(
  entry: PreviewInspectorCompleteRouteBaseEntry,
  plan: PreviewInspectorRouteBranchPlan,
  rootOwner: PreviewInspectorCompleteRouteOwner,
): PreviewInspectorExactRouteReplayResult {
  if (plan.selectionResolution !== 'exact') {
    return Object.freeze({ exact: false, reason: 'exact-replay-non-exact-selection' });
  }
  const selected =
    plan.selectedBranchId === undefined
      ? undefined
      : plan.branches.find((branch) => branch.id === plan.selectedBranchId);
  const active = plan.activeLocation;
  const parent =
    selected?.parentId === undefined
      ? undefined
      : plan.branches.find((branch) => branch.id === selected.parentId);
  const owner =
    selected?.depth === 0 || parent?.sourcePath === undefined
      ? rootOwner
      : freezeOwner(parent.sourcePath, parent.exportName ?? 'default');
  const exportName = selected?.exportName;
  const sourcePath = selected?.sourcePath;
  const parameters =
    selected === undefined
      ? Object.freeze({})
      : collectPreviewInspectorRouteParameterValues(selected.pattern, selected.pathname);
  if (
    selected === undefined ||
    active === undefined ||
    exportName === undefined ||
    sourcePath === undefined
  ) {
    return Object.freeze({ exact: false, reason: 'exact-replay-identity-mismatch' });
  }
  const exact =
    plan.selectedBranchId === entry.id &&
    selected.id === createPreviewInspectorRouteBranchId(entry.selection) &&
    sameSelection(selected.selectionPath, entry.selection) &&
    selected.componentName === entry.componentName &&
    selected.pattern === entry.pattern &&
    selected.pathname === entry.pathname &&
    sameOwner(owner, entry.owner) &&
    exportName === entry.exportName &&
    entry.sourcePath !== undefined &&
    path.normalize(sourcePath) === path.normalize(entry.sourcePath) &&
    active.componentName === entry.componentName &&
    active.componentExportName === exportName &&
    active.componentSourcePath !== undefined &&
    path.normalize(active.componentSourcePath) === path.normalize(sourcePath) &&
    active.pattern === entry.pattern &&
    active.pathname === entry.pathname &&
    sameRecord(parameters, entry.parameters);
  if (!exact) {
    return Object.freeze({ exact: false, reason: 'exact-replay-identity-mismatch' });
  }
  const executionRoot = plan.executionRoot;
  const ownerChain = freezeReplayOwnerChain(active, executionRoot, rootOwner);
  return Object.freeze({
    exact: true,
    replay: Object.freeze({
      branchId: selected.id,
      componentName: selected.componentName,
      executionRoot: Object.freeze({
        basePattern: executionRoot?.basePattern ?? '/',
        exportName: executionRoot?.exportName ?? rootOwner.exportName,
        sourcePath: path.normalize(executionRoot?.sourcePath ?? rootOwner.sourcePath),
      }),
      exportName,
      owner,
      ownerChain,
      parameters,
      pathname: selected.pathname,
      pattern: selected.pattern,
      policyDigest: PREVIEW_COMPLETE_ROUTE_REPLAY_POLICY_DIGEST,
      routeSelectionResolution: 'exact' as const,
      runtimeTarget: freezeOwner(sourcePath, exportName),
      selection: freezeSelection(selected.selectionPath),
      sourcePath: path.normalize(sourcePath),
      version: 1 as const,
    }),
  });
}

/** Freezes exact route mounts, falling back only to the proven execution root. */
function freezeReplayOwnerChain(
  active: NonNullable<PreviewInspectorRouteBranchPlan['activeLocation']>,
  executionRoot: PreviewInspectorRouteBranchPlan['executionRoot'],
  rootOwner: PreviewInspectorCompleteRouteOwner,
): PreviewInspectorExactRouteReplay['ownerChain'] {
  const mounts = (active.routeMounts ?? []).map((mount) =>
    Object.freeze({
      basePattern: mount.basePath,
      exportName: mount.exportName,
      sourcePath: path.normalize(mount.sourcePath),
    }),
  );
  if (mounts.length > 0) return Object.freeze(mounts);
  return Object.freeze([
    Object.freeze({
      basePattern: executionRoot?.basePattern ?? '/',
      exportName: executionRoot?.exportName ?? rootOwner.exportName,
      sourcePath: path.normalize(executionRoot?.sourcePath ?? rootOwner.sourcePath),
    }),
  ]);
}

/** Adds normalized replay dependencies to the complete inventory manifest. */
function collectReplayDependencies(
  plan: PreviewInspectorRouteBranchPlan,
  dependencyPaths: Set<string>,
): void {
  for (const dependencyPath of plan.dependencyPaths) {
    dependencyPaths.add(path.normalize(dependencyPath));
  }
}

/** Retains only immutable route facts when a provisional route is demoted. */
function freezeUnresolvedBase(
  entry: PreviewInspectorCompleteRouteBaseEntry,
): PreviewInspectorCompleteRouteBaseEntry {
  return Object.freeze({
    id: entry.id,
    componentName: entry.componentName,
    ...(entry.exportName === undefined ? {} : { exportName: entry.exportName }),
    owner: entry.owner,
    parameters: entry.parameters,
    pathname: entry.pathname,
    pattern: entry.pattern,
    selection: entry.selection,
    ...(entry.sourcePath === undefined ? {} : { sourcePath: entry.sourcePath }),
  });
}

/** Freezes one public route selection without parser-owned data. */
function freezeSelection(
  selection: readonly PreviewInspectorRouteSelectionStep[],
): readonly PreviewInspectorRouteSelectionStep[] {
  return Object.freeze(
    selection.map((step) =>
      Object.freeze({ componentName: step.componentName, pattern: step.pattern }),
    ),
  );
}

/** Compares complete route selections in authored order. */
function sameSelection(
  left: readonly PreviewInspectorRouteSelectionStep[],
  right: readonly PreviewInspectorRouteSelectionStep[],
): boolean {
  return (
    left.length === right.length &&
    left.every((step, index) => {
      const counterpart = right.at(index);
      return (
        step.componentName === counterpart?.componentName && step.pattern === counterpart.pattern
      );
    })
  );
}

/** Compares normalized source/export owner identities. */
function sameOwner(
  left: PreviewInspectorCompleteRouteOwner,
  right: PreviewInspectorCompleteRouteOwner,
): boolean {
  return (
    left.exportName === right.exportName &&
    path.normalize(left.sourcePath) === path.normalize(right.sourcePath)
  );
}

/** Compares deterministic route parameter records. */
function sameRecord(
  left: Readonly<Record<string, string>>,
  right: Readonly<Record<string, string>>,
): boolean {
  const leftEntries = Object.entries(left).sort(([a], [b]) => a.localeCompare(b));
  const rightEntries = Object.entries(right).sort(([a], [b]) => a.localeCompare(b));
  return JSON.stringify(leftEntries) === JSON.stringify(rightEntries);
}

/** Attributes a nested choice to the component selected directly above its depth. */
function inferBranchOwner(
  branch: PreviewInspectorRouteBranch,
  currentBranches: readonly PreviewInspectorRouteBranch[],
  observed: ReadonlyMap<string, ObservedBranch>,
  rootOwner: PreviewInspectorCompleteRouteOwner,
): PreviewInspectorCompleteRouteOwner {
  if (branch.depth === 0 || branch.parentId === undefined) return rootOwner;
  const parent = currentBranches.find((candidate) => candidate.id === branch.parentId);
  const previousParent = observed.get(branch.parentId)?.branch;
  const ownerBranch = parent ?? previousParent;
  return ownerBranch?.sourcePath === undefined
    ? rootOwner
    : freezeOwner(ownerBranch.sourcePath, ownerBranch.exportName ?? 'default');
}

/** Converts branch-planner states to the campaign's exhaustive accounting categories. */
function classifyBranch(
  branch: PreviewInspectorRouteBranch,
  owner: PreviewInspectorCompleteRouteOwner,
  observed: readonly ObservedBranch[],
  rootOwner: PreviewInspectorCompleteRouteOwner,
  traversalTruncated: boolean,
): PreviewInspectorProvisionalRouteEntry {
  const base = freezeBaseEntry(branch, owner);
  if (branch.duplicateOf !== undefined) {
    return Object.freeze({
      ...base,
      disposition: 'duplicate' as const,
      duplicateOf: branch.duplicateOf,
      reason: 'exact-semantic-route' as const,
    });
  }
  if (branch.childState === 'expanded') {
    const descendant = observed
      .map((item) => item.branch)
      .filter(
        (candidate) =>
          candidate.id !== branch.id &&
          candidate.childState === 'leaf' &&
          selectionStartsWith(candidate.selectionPath, branch.selectionPath),
      )
      .sort(compareBranches)[0];
    if (descendant !== undefined) {
      return Object.freeze({
        ...base,
        disposition: 'duplicate' as const,
        duplicateOf: descendant.id,
        reason: 'expanded-owner' as const,
      });
    }
  }
  const availability = branch.availability;
  if (availability !== undefined) {
    return Object.freeze({
      ...base,
      disposition: 'unresolved' as const,
      reason: availability,
    });
  }
  if (branch.childState === 'leaf' && branch.sourcePath !== undefined) {
    return Object.freeze({ ...base, disposition: 'runnable' as const });
  }
  return Object.freeze({
    ...base,
    disposition: 'unresolved' as const,
    reason:
      traversalTruncated && branch.childState === 'unknown'
        ? 'analysis-limit'
        : branch.sourcePath === undefined
          ? 'component-unresolved'
          : branchCreatesOwnerCycle(branch, observed, rootOwner)
            ? 'cyclic-owner'
            : 'nested-owner-unproven',
  });
}

/** Preserves the exact compiler selection while deriving deterministic parameter evidence. */
function freezeBaseEntry(
  branch: PreviewInspectorRouteBranch,
  owner: PreviewInspectorCompleteRouteOwner,
): PreviewInspectorCompleteRouteBaseEntry {
  return Object.freeze({
    id: branch.id,
    componentName: branch.componentName,
    ...(branch.exportName === undefined ? {} : { exportName: branch.exportName }),
    owner,
    parameters: collectPreviewInspectorRouteParameterValues(branch.pattern, branch.pathname),
    pathname: branch.pathname,
    pattern: branch.pattern,
    selection: Object.freeze(
      branch.selectionPath.map((step) =>
        Object.freeze({ componentName: step.componentName, pattern: step.pattern }),
      ),
    ),
    ...(branch.sourcePath === undefined ? {} : { sourcePath: path.normalize(branch.sourcePath) }),
  });
}

/** Detects only exact owner identity repetition; no source is evaluated to guess recursion. */
function branchCreatesOwnerCycle(
  branch: PreviewInspectorRouteBranch,
  observed: readonly ObservedBranch[],
  rootOwner: PreviewInspectorCompleteRouteOwner,
): boolean {
  if (branch.sourcePath === undefined) return false;
  const sourcePath = path.normalize(branch.sourcePath);
  if (sourcePath === rootOwner.sourcePath) return true;
  return observed.some(
    (candidate) =>
      candidate.branch.id !== branch.id &&
      candidate.branch.sourcePath !== undefined &&
      path.normalize(candidate.branch.sourcePath) === sourcePath &&
      selectionStartsWith(branch.selectionPath, candidate.branch.selectionPath),
  );
}

/** Detects whether a deeper selection extends one already observed owner selection. */
function selectionStartsWith(
  candidate: readonly PreviewInspectorRouteSelectionStep[],
  prefix: readonly PreviewInspectorRouteSelectionStep[],
): boolean {
  return (
    candidate.length > prefix.length &&
    prefix.every((step, index) => {
      const counterpart = candidate.at(index);
      return (
        step.componentName === counterpart?.componentName && step.pattern === counterpart.pattern
      );
    })
  );
}

/** Orders observed branches by their immutable public branch identity. */
function compareObservedBranches(left: ObservedBranch, right: ObservedBranch): number {
  return compareBranches(left.branch, right.branch);
}

/** Orders branches by depth, pattern, component, and stable identifier. */
function compareBranches(
  left: PreviewInspectorRouteBranch,
  right: PreviewInspectorRouteBranch,
): number {
  return (
    left.selectionPath.length - right.selectionPath.length ||
    left.pattern.localeCompare(right.pattern) ||
    left.componentName.localeCompare(right.componentName) ||
    left.id.localeCompare(right.id)
  );
}

/** Freezes one normalized route owner. */
function freezeOwner(sourcePath: string, exportName: string): PreviewInspectorCompleteRouteOwner {
  return Object.freeze({ exportName, sourcePath: path.normalize(sourcePath) });
}

/** Applies safe positive inventory bounds to every analysis dimension. */
function normalizeLimits(
  limits: Partial<PreviewInspectorCompleteRouteInventoryLimits> | undefined,
): PreviewInspectorCompleteRouteInventoryLimits {
  return Object.freeze({
    maximumAnalysisPasses: normalizeLimit(
      limits?.maximumAnalysisPasses,
      DEFAULT_MAXIMUM_ANALYSIS_PASSES,
    ),
    maximumBranches: normalizeLimit(limits?.maximumBranches, DEFAULT_MAXIMUM_BRANCHES),
    maximumDepth: normalizeLimit(limits?.maximumDepth, DEFAULT_MAXIMUM_DEPTH),
  });
}

/** Normalizes one optional positive safe-integer bound. */
function normalizeLimit(value: number | undefined, fallback: number): number {
  return value === undefined || !Number.isSafeInteger(value) || value < 1 ? fallback : value;
}
