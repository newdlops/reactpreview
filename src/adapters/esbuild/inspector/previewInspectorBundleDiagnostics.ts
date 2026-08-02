/** Fixed source-general counters emitted only on sampled bundle-complete telemetry. */
export interface PreviewInspectorBundleDiagnostics {
  readonly authoredPathCheckCount: number;
  readonly authoredPathCheckMicros: number;
  readonly bundleMeasuredMicros: number;
  readonly candidateSelectionMicros: number;
  readonly candidateSelectionSortCount: number;
  readonly diagnosticsVersion: 1;
  readonly edgeVisitCount: number;
  readonly frontierCount: number;
  readonly frontierFinalizeMicros: number;
  readonly frontierIdentityMicros: number;
  readonly inventoryComputationCount: number;
  readonly inventoryHitCount: number;
  readonly inventoryLookupMicros: number;
  readonly inventoryReadPathCacheHitCount: number;
  readonly inventoryReadRequestCount: number;
  readonly inventoryRequestCount: number;
  readonly optionalClosureMicros: number;
  readonly optionalClosureProbeCount: number;
  readonly queueIterationCount: number;
  readonly queuePeakLength: number;
  readonly queueSortCount: number;
  readonly queueSortMicros: number;
  readonly rawSourceReadCount: number;
  readonly rawSourceReadMicros: number;
  readonly resolveModuleCount: number;
  readonly resolveModuleMicros: number;
  readonly sliceComputationCount: number;
  readonly sliceHitCount: number;
  readonly sliceLookupMicros: number;
  readonly sliceRequestCount: number;
}

/** Canonical exact key order shared by the policy digest and strict worker validation. */
export const PREVIEW_INSPECTOR_BUNDLE_DIAGNOSTIC_FIELD_NAMES = Object.freeze([
  'diagnosticsVersion',
  'bundleMeasuredMicros',
  'frontierCount',
  'rawSourceReadCount',
  'rawSourceReadMicros',
  'inventoryReadRequestCount',
  'inventoryReadPathCacheHitCount',
  'sliceRequestCount',
  'sliceComputationCount',
  'sliceHitCount',
  'sliceLookupMicros',
  'inventoryRequestCount',
  'inventoryComputationCount',
  'inventoryHitCount',
  'inventoryLookupMicros',
  'queueIterationCount',
  'queuePeakLength',
  'queueSortCount',
  'queueSortMicros',
  'edgeVisitCount',
  'optionalClosureProbeCount',
  'optionalClosureMicros',
  'resolveModuleCount',
  'resolveModuleMicros',
  'authoredPathCheckCount',
  'authoredPathCheckMicros',
  'frontierFinalizeMicros',
  'frontierIdentityMicros',
  'candidateSelectionSortCount',
  'candidateSelectionMicros',
] as const satisfies readonly (keyof PreviewInspectorBundleDiagnostics)[]);

export type PreviewInspectorBundleDiagnosticsClock = () => bigint;

interface MemoDelta {
  readonly computations: number;
  readonly hits: number;
  readonly requests: number;
}

/** Narrow request-owned mutation surface; no application identity can enter the collector. */
export interface PreviewInspectorBundleDiagnosticsCollector {
  readonly measureAuthoredPathCheck: <Result>(operation: () => Result) => Result;
  readonly measureCandidateSelection: <Result>(operation: () => Result) => Result;
  readonly measureFrontierFinalize: <Result>(operation: () => Result) => Result;
  readonly measureFrontierIdentity: <Result>(operation: () => Result) => Result;
  readonly measureInventoryLookup: <Result>(operation: () => Result) => Result;
  readonly measureOptionalClosure: <Result>(operation: () => Promise<Result>) => Promise<Result>;
  readonly measureQueueSort: <Result>(operation: () => Result) => Result;
  readonly measureRawSourceRead: <Result>(operation: () => Promise<Result>) => Promise<Result>;
  readonly measureResolveModule: <Result>(operation: () => Result) => Result;
  readonly measureSliceLookup: <Result>(operation: () => Result) => Result;
  readonly recordEdgeVisit: () => void;
  readonly recordFrontier: () => void;
  readonly recordInventoryMemoDelta: (delta: MemoDelta) => void;
  readonly recordInventoryRead: (pathCacheHit: boolean) => void;
  readonly recordQueueIteration: (queueLength: number) => void;
  readonly recordSliceMemoDelta: (delta: MemoDelta) => void;
  readonly snapshot: () => PreviewInspectorBundleDiagnostics;
}

type MutableCounters = {
  -readonly [Key in keyof Omit<
    PreviewInspectorBundleDiagnostics,
    'bundleMeasuredMicros' | 'diagnosticsVersion'
  >]: number;
};

/** Creates no object and reads no clock unless the unchanged sampling policy enabled diagnostics. */
export function createPreviewInspectorBundleDiagnosticsCollector(
  enabled: boolean,
  clock: PreviewInspectorBundleDiagnosticsClock = process.hrtime.bigint,
): PreviewInspectorBundleDiagnosticsCollector | undefined {
  if (!enabled) return undefined;
  const startedAt = clock();
  const counters: MutableCounters = {
    authoredPathCheckCount: 0,
    authoredPathCheckMicros: 0,
    candidateSelectionMicros: 0,
    candidateSelectionSortCount: 0,
    edgeVisitCount: 0,
    frontierCount: 0,
    frontierFinalizeMicros: 0,
    frontierIdentityMicros: 0,
    inventoryComputationCount: 0,
    inventoryHitCount: 0,
    inventoryLookupMicros: 0,
    inventoryReadPathCacheHitCount: 0,
    inventoryReadRequestCount: 0,
    inventoryRequestCount: 0,
    optionalClosureMicros: 0,
    optionalClosureProbeCount: 0,
    queueIterationCount: 0,
    queuePeakLength: 0,
    queueSortCount: 0,
    queueSortMicros: 0,
    rawSourceReadCount: 0,
    rawSourceReadMicros: 0,
    resolveModuleCount: 0,
    resolveModuleMicros: 0,
    sliceComputationCount: 0,
    sliceHitCount: 0,
    sliceLookupMicros: 0,
    sliceRequestCount: 0,
  };
  const add = (name: keyof MutableCounters, amount = 1): void => {
    const normalizedAmount =
      Number.isSafeInteger(amount) && amount > 0 ? amount : amount === 0 ? 0 : 0;
    counters[name] = Math.min(Number.MAX_SAFE_INTEGER, counters[name] + normalizedAmount);
  };
  const measure = <Result>(
    durationName: keyof MutableCounters,
    operation: () => Result,
  ): Result => {
    const measurementStartedAt = clock();
    try {
      return operation();
    } finally {
      add(durationName, elapsedMicros(measurementStartedAt, clock()));
    }
  };
  const measureAsync = async <Result>(
    durationName: keyof MutableCounters,
    operation: () => Promise<Result>,
  ): Promise<Result> => {
    const measurementStartedAt = clock();
    try {
      return await operation();
    } finally {
      add(durationName, elapsedMicros(measurementStartedAt, clock()));
    }
  };
  const recordMemoDelta = (
    delta: MemoDelta,
    names: {
      readonly computations: keyof MutableCounters;
      readonly hits: keyof MutableCounters;
      readonly requests: keyof MutableCounters;
    },
  ): void => {
    add(names.requests, delta.requests);
    add(names.computations, delta.computations);
    add(names.hits, delta.hits);
  };
  return Object.freeze({
    measureAuthoredPathCheck<Result>(operation: () => Result): Result {
      add('authoredPathCheckCount');
      return measure('authoredPathCheckMicros', operation);
    },
    measureCandidateSelection<Result>(operation: () => Result): Result {
      add('candidateSelectionSortCount');
      return measure('candidateSelectionMicros', operation);
    },
    measureFrontierFinalize<Result>(operation: () => Result): Result {
      return measure('frontierFinalizeMicros', operation);
    },
    measureFrontierIdentity<Result>(operation: () => Result): Result {
      return measure('frontierIdentityMicros', operation);
    },
    measureInventoryLookup<Result>(operation: () => Result): Result {
      return measure('inventoryLookupMicros', operation);
    },
    measureOptionalClosure<Result>(operation: () => Promise<Result>): Promise<Result> {
      add('optionalClosureProbeCount');
      return measureAsync('optionalClosureMicros', operation);
    },
    measureQueueSort<Result>(operation: () => Result): Result {
      add('queueSortCount');
      return measure('queueSortMicros', operation);
    },
    measureRawSourceRead<Result>(operation: () => Promise<Result>): Promise<Result> {
      add('rawSourceReadCount');
      return measureAsync('rawSourceReadMicros', operation);
    },
    measureResolveModule<Result>(operation: () => Result): Result {
      add('resolveModuleCount');
      return measure('resolveModuleMicros', operation);
    },
    measureSliceLookup<Result>(operation: () => Result): Result {
      return measure('sliceLookupMicros', operation);
    },
    recordEdgeVisit(): void {
      add('edgeVisitCount');
    },
    recordFrontier(): void {
      add('frontierCount');
    },
    recordInventoryMemoDelta(delta: MemoDelta): void {
      recordMemoDelta(delta, {
        computations: 'inventoryComputationCount',
        hits: 'inventoryHitCount',
        requests: 'inventoryRequestCount',
      });
    },
    recordInventoryRead(pathCacheHit: boolean): void {
      add('inventoryReadRequestCount');
      if (pathCacheHit) add('inventoryReadPathCacheHitCount');
    },
    recordQueueIteration(queueLength: number): void {
      add('queueIterationCount');
      if (Number.isSafeInteger(queueLength) && queueLength > counters.queuePeakLength) {
        counters.queuePeakLength = queueLength;
      }
    },
    recordSliceMemoDelta(delta: MemoDelta): void {
      recordMemoDelta(delta, {
        computations: 'sliceComputationCount',
        hits: 'sliceHitCount',
        requests: 'sliceRequestCount',
      });
    },
    snapshot(): PreviewInspectorBundleDiagnostics {
      return Object.freeze({
        diagnosticsVersion: 1,
        bundleMeasuredMicros: elapsedMicros(startedAt, clock()),
        frontierCount: counters.frontierCount,
        rawSourceReadCount: counters.rawSourceReadCount,
        rawSourceReadMicros: counters.rawSourceReadMicros,
        inventoryReadRequestCount: counters.inventoryReadRequestCount,
        inventoryReadPathCacheHitCount: counters.inventoryReadPathCacheHitCount,
        sliceRequestCount: counters.sliceRequestCount,
        sliceComputationCount: counters.sliceComputationCount,
        sliceHitCount: counters.sliceHitCount,
        sliceLookupMicros: counters.sliceLookupMicros,
        inventoryRequestCount: counters.inventoryRequestCount,
        inventoryComputationCount: counters.inventoryComputationCount,
        inventoryHitCount: counters.inventoryHitCount,
        inventoryLookupMicros: counters.inventoryLookupMicros,
        queueIterationCount: counters.queueIterationCount,
        queuePeakLength: counters.queuePeakLength,
        queueSortCount: counters.queueSortCount,
        queueSortMicros: counters.queueSortMicros,
        edgeVisitCount: counters.edgeVisitCount,
        optionalClosureProbeCount: counters.optionalClosureProbeCount,
        optionalClosureMicros: counters.optionalClosureMicros,
        resolveModuleCount: counters.resolveModuleCount,
        resolveModuleMicros: counters.resolveModuleMicros,
        authoredPathCheckCount: counters.authoredPathCheckCount,
        authoredPathCheckMicros: counters.authoredPathCheckMicros,
        frontierFinalizeMicros: counters.frontierFinalizeMicros,
        frontierIdentityMicros: counters.frontierIdentityMicros,
        candidateSelectionSortCount: counters.candidateSelectionSortCount,
        candidateSelectionMicros: counters.candidateSelectionMicros,
      });
    },
  });
}

/** Converts a monotonic bigint delta to a nonnegative safe integer number of microseconds. */
function elapsedMicros(startedAt: bigint, finishedAt: bigint): number {
  if (finishedAt <= startedAt) return 0;
  const micros = (finishedAt - startedAt) / 1_000n;
  return micros > BigInt(Number.MAX_SAFE_INTEGER) ? Number.MAX_SAFE_INTEGER : Number(micros);
}
