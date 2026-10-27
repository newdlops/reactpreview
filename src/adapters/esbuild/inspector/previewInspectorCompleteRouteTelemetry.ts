/** Bounded complete-route telemetry policy and checkpoint emission. */
import { createHash } from 'node:crypto';
import { PREVIEW_INSPECTOR_BUNDLE_DIAGNOSTIC_FIELD_NAMES } from './previewInspectorBundleDiagnostics';
import type {
  PreviewCompleteRouteInventoryTelemetryEmitter,
  PreviewCompleteRouteInventoryTelemetryEvent,
  PreviewCompleteRouteInventoryTelemetryEventDraft,
  PreviewCompleteRouteInventoryTelemetryObserver,
} from './previewInspectorCompleteRouteModel';

export const DENSE_EXECUTION_TELEMETRY_ORDINAL_LIMIT = 64;

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
