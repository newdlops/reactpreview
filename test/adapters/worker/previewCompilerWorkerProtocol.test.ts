/** Verifies error reconstruction and zero-copy bundle transfer-list selection. */
import { describe, expect, it } from 'vitest';
import {
  PreviewCompilationError,
  PreviewRouteExecutionPlanInvariantError,
} from '../../../src/domain/preview';
import {
  PreviewBuildCancelledError,
  PreviewBuildStalledError,
} from '../../../src/domain/previewBuildExecution';
import {
  PREVIEW_COMPLETE_ROUTE_INVENTORY_TELEMETRY_MAXIMUM_EVENTS,
  type PreviewCompleteRouteInventoryTelemetryEvent,
} from '../../../src/adapters/esbuild/inspector/previewInspectorCompleteRouteInventory';
import type { PreviewInspectorBundleDiagnostics } from '../../../src/adapters/esbuild/inspector/previewInspectorBundleDiagnostics';
import {
  collectPreviewBundleTransferList,
  deserializePreviewCompilerWorkerError,
  isPreviewCompleteRouteInventoryTelemetryEvent,
  isPreviewCompilerWorkerRequest,
  isPreviewCompleteRouteInventoryWorkerResponse,
  serializePreviewCompilerWorkerError,
} from '../../../src/adapters/worker/previewCompilerWorkerProtocol';

describe('previewCompilerWorkerProtocol', () => {
  /** Preserves structured compiler diagnostics and cancellation semantics across cloning. */
  it('round-trips domain failures', () => {
    const compilation = new PreviewCompilationError('broken import', [
      { message: 'Could not resolve x', severity: 'error' },
    ]);

    const reconstructed = deserializePreviewCompilerWorkerError(
      serializePreviewCompilerWorkerError(compilation),
    );
    expect(reconstructed).toBeInstanceOf(PreviewCompilationError);
    expect((reconstructed as PreviewCompilationError).diagnostics).toHaveLength(1);
    expect(
      deserializePreviewCompilerWorkerError(
        serializePreviewCompilerWorkerError(new PreviewBuildCancelledError()),
      ),
    ).toBeInstanceOf(PreviewBuildCancelledError);
  });

  /** Native service death is a resource stall so first paint never repeats the same heavy graph. */
  it('classifies esbuild service termination as a non-retriable stall', () => {
    const serialized = serializePreviewCompilerWorkerError(
      new Error('The service was stopped'),
      undefined,
      '/workspace/Target.tsx',
    );

    expect(serialized).toMatchObject({
      kind: 'stalled',
      stallReason: 'native-service',
      target: '/workspace/Target.tsx',
    });
    expect(deserializePreviewCompilerWorkerError(serialized)).toBeInstanceOf(
      PreviewBuildStalledError,
    );
  });

  /** Keeps bounded route-plan mismatch evidence intact across the worker structured-clone seam. */
  it('round-trips execution-plan invariant evidence', () => {
    const error = new PreviewRouteExecutionPlanInvariantError({
      expectedContextDigest: 'a'.repeat(64),
      expectedPlanDigest: 'b'.repeat(64),
      expectedPolicyDigest: 'c'.repeat(64),
      mismatchField: 'frontierIdentity',
      observedCandidateId: 'execution:alternate',
      observedContextDigest: 'd'.repeat(64),
      observedPlanDigest: 'e'.repeat(64),
      observedPolicyDigest: 'f'.repeat(64),
      observedResolution: 'exact',
      observedRootIdentity: '/workspace/App.tsx#default',
      observedTargetIdentity: '/workspace/Leaf.tsx#default',
      reason: 'the current fast compiler plan differs from the frozen artifact',
      requestedResolution: 'exact',
      routeId: 'route:alternate',
    });

    const serialized = serializePreviewCompilerWorkerError(error);
    expect(serialized).toMatchObject({
      kind: 'compilation',
      routeExecutionPlanInvariantEvidence: error.evidence,
    });
    const reconstructed = deserializePreviewCompilerWorkerError(serialized);
    expect(reconstructed).toBeInstanceOf(PreviewRouteExecutionPlanInvariantError);
    expect((reconstructed as PreviewRouteExecutionPlanInvariantError).evidence).toEqual(
      error.evidence,
    );
  });

  /** Selects every unique JavaScript, CSS, and lazy chunk ArrayBuffer exactly once. */
  it('collects transferable output buffers without duplication', () => {
    const shared = new Uint8Array([1, 2]);
    const stylesheet = new Uint8Array([3]);
    const transferList = collectPreviewBundleTransferList({
      chunks: [{ contents: shared, relativePath: 'chunks/a.js' }],
      dependencies: [],
      diagnostics: [],
      javascript: shared,
      stylesheet,
      watchDirectories: [],
    });

    expect(transferList).toEqual([shared.buffer, stylesheet.buffer]);
  });

  it('accepts only the exact one-shot inventory request and terminal response shapes', () => {
    const request = {
      request: {
        dependencySnapshots: [],
        documentPath: '/workspace/App.tsx',
        language: 'tsx',
        sourceText: 'export default function App() { return null; }',
        workspaceRoot: '/workspace',
      },
      type: 'collect-complete-route-inventory',
    };

    expect(isPreviewCompilerWorkerRequest(request)).toBe(true);
    expect(
      isPreviewCompilerWorkerRequest({
        ...request,
        request: { ...request.request, language: 'python' },
      }),
    ).toBe(false);
    expect(
      isPreviewCompleteRouteInventoryWorkerResponse({
        inventory: {
          analysisPasses: 1,
          complete: true,
          counts: { duplicate: 0, runnable: 0, total: 0, unresolved: 0 },
          dependencyPaths: [],
          entries: [],
          limits: { maximumAnalysisPasses: 1, maximumBranches: 1, maximumDepth: 1 },
          owner: { exportName: 'default', sourcePath: '/workspace/App.tsx' },
          predecessorVersion: 3,
          replayPasses: 0,
          replayPolicy: { digest: 'a'.repeat(64), predecessorVersion: 3, version: 4 },
          truncated: false,
          version: 4,
        },
        type: 'complete-route-inventory-success',
      }),
    ).toBe(true);
    expect(
      isPreviewCompleteRouteInventoryWorkerResponse({
        inventory: { entries: [], version: 4 },
        type: 'complete-route-inventory-success',
      }),
    ).toBe(false);
    expect(
      isPreviewCompleteRouteInventoryWorkerResponse({
        error: { code: 'preview-inventory-failed', message: 'inventory failed' },
        type: 'complete-route-inventory-failure',
      }),
    ).toBe(true);
    expect(
      isPreviewCompleteRouteInventoryWorkerResponse({
        error: { code: 'unknown', message: 'inventory failed' },
        type: 'complete-route-inventory-failure',
      }),
    ).toBe(false);
  });

  it('accepts exact inventory progress and rejects malformed or non-monotonic payloads', () => {
    const first = createTelemetryEvent({
      phase: 'prepare-source-index',
      sequence: 1,
      transition: 'start',
    });
    const second = createTelemetryEvent({
      elapsedMs: 1,
      phase: 'prepare-source-index',
      sequence: 2,
      transition: 'complete',
    });

    expect(isPreviewCompleteRouteInventoryTelemetryEvent(first)).toBe(true);
    expect(isPreviewCompleteRouteInventoryTelemetryEvent(second, first)).toBe(true);
    const internalPhases = [
      'execution-frontier-candidates',
      'execution-frontier-bundle',
      'execution-frontier-ownership',
      'execution-frontier-target-contract',
      'execution-frontier-root-contract',
      'execution-frontier-artifact',
    ] as const;
    for (const phase of internalPhases) {
      const start = createTelemetryEvent({
        executionPlanCompleted: 0,
        executionPlanTotal: 2,
        phase,
        routeOrdinal: 1,
        transition: 'start',
      });
      const complete = createTelemetryEvent({
        ...(phase === 'execution-frontier-bundle'
          ? { bundleDiagnostics: createBundleDiagnostics() }
          : {}),
        executionPlanCompleted: 0,
        executionPlanTotal: 2,
        phase,
        routeOrdinal: 1,
        transition: 'complete',
      });
      expect(isPreviewCompleteRouteInventoryTelemetryEvent(start)).toBe(true);
      expect(isPreviewCompleteRouteInventoryTelemetryEvent(complete)).toBe(true);
      expect(
        isPreviewCompleteRouteInventoryTelemetryEvent({
          ...complete,
          executionPlanCompleted: 1,
        }),
      ).toBe(false);
      expect(
        isPreviewCompleteRouteInventoryTelemetryEvent({
          ...complete,
          transition: 'checkpoint',
        }),
      ).toBe(false);
    }
    const bundleComplete = createTelemetryEvent({
      bundleDiagnostics: createBundleDiagnostics(),
      executionPlanCompleted: 0,
      executionPlanTotal: 2,
      phase: 'execution-frontier-bundle',
      routeOrdinal: 1,
      transition: 'complete',
    });
    expect(
      isPreviewCompleteRouteInventoryTelemetryEvent({
        ...bundleComplete,
        bundleDiagnostics: undefined,
      }),
    ).toBe(false);
    expect(
      isPreviewCompleteRouteInventoryTelemetryEvent({
        ...bundleComplete,
        transition: 'start',
      }),
    ).toBe(false);
    expect(
      isPreviewCompleteRouteInventoryTelemetryEvent({
        ...first,
        bundleDiagnostics: createBundleDiagnostics(),
      }),
    ).toBe(false);
    for (const bundleDiagnostics of [
      { ...createBundleDiagnostics(), diagnosticsVersion: 2 },
      { ...createBundleDiagnostics(), rawSourceReadCount: -1 },
      { ...createBundleDiagnostics(), rawSourceReadMicros: 1.5 },
      { ...createBundleDiagnostics(), edgeVisitCount: Number.MAX_SAFE_INTEGER + 1 },
      { ...createBundleDiagnostics(), sourcePath: '/workspace/private.tsx' },
      { ...createBundleDiagnostics(), routeId: 'private-route' },
      { ...createBundleDiagnostics(), candidateName: 'private-candidate' },
      { ...createBundleDiagnostics(), moduleSpecifier: './private' },
      { ...createBundleDiagnostics(), sliceRequestCount: 1 },
      { ...createBundleDiagnostics(), inventoryRequestCount: 1 },
      {
        ...createBundleDiagnostics(),
        inventoryReadPathCacheHitCount: 1,
        inventoryReadRequestCount: 0,
      },
      { ...createBundleDiagnostics(), queueIterationCount: 1, queueSortCount: 0 },
      {
        ...createBundleDiagnostics(),
        queueIterationCount: 1,
        queuePeakLength: 0,
        queueSortCount: 1,
      },
    ]) {
      expect(
        isPreviewCompleteRouteInventoryTelemetryEvent({
          ...bundleComplete,
          bundleDiagnostics,
        }),
      ).toBe(false);
    }
    const { frontierCount: _frontierCount, ...missingDiagnosticsKey } = createBundleDiagnostics();
    expect(
      isPreviewCompleteRouteInventoryTelemetryEvent({
        ...bundleComplete,
        bundleDiagnostics: missingDiagnosticsKey,
      }),
    ).toBe(false);
    const outerComplete = createTelemetryEvent({
      executionPlanCompleted: 1,
      executionPlanTotal: 2,
      phase: 'execution-frontier-plan',
      routeOrdinal: 1,
      transition: 'complete',
    });
    expect(isPreviewCompleteRouteInventoryTelemetryEvent(outerComplete)).toBe(true);
    expect(
      isPreviewCompleteRouteInventoryTelemetryEvent({
        ...outerComplete,
        executionPlanCompleted: 0,
      }),
    ).toBe(false);
    expect(
      isPreviewCompleteRouteInventoryWorkerResponse({
        event: first,
        type: 'complete-route-inventory-progress',
      }),
    ).toBe(true);
    expect(
      isPreviewCompleteRouteInventoryWorkerResponse(
        {
          event: { ...second, sourcePath: '/workspace/private.tsx' },
          type: 'complete-route-inventory-progress',
        },
        first,
      ),
    ).toBe(false);
    expect(
      isPreviewCompleteRouteInventoryTelemetryEvent({ ...second, sequence: first.sequence }, first),
    ).toBe(false);
    expect(
      isPreviewCompleteRouteInventoryTelemetryEvent({
        ...first,
        sequence: PREVIEW_COMPLETE_ROUTE_INVENTORY_TELEMETRY_MAXIMUM_EVENTS + 1,
      }),
    ).toBe(false);
    expect(
      isPreviewCompleteRouteInventoryTelemetryEvent({
        ...first,
        environment: { NODE_OPTIONS: '--inspect' },
      }),
    ).toBe(false);
    for (const malformed of [
      { ...first, phase: 'execution-frontier-unknown' },
      { ...first, routeId: 'private-route' },
      { ...first, selection: [{ pattern: '/private' }] },
      { ...first, sourcePath: '/workspace/private.tsx' },
      { ...first, transition: 'checkpoint' },
      { ...first, version: 1 },
      { ...first, version: 2 },
      { ...first, version: 3 },
    ]) {
      expect(isPreviewCompleteRouteInventoryTelemetryEvent(malformed)).toBe(false);
    }
    for (const nonMonotonic of [
      { ...second, cpuUserMicros: first.cpuUserMicros - 1 },
      { ...second, elapsedMs: first.elapsedMs - 1 },
    ]) {
      expect(isPreviewCompleteRouteInventoryTelemetryEvent(nonMonotonic, first)).toBe(false);
    }
  });

  it('validates exact v4 phase-local prefix counters and their independent relationships', () => {
    const enumerationStart = createTelemetryEvent({
      analysisPasses: 0,
      discoveredBranches: 0,
      enumerationPrefixComputationCount: 0,
      enumerationPrefixEntryCount: 0,
      enumerationPrefixHitCount: 0,
      enumerationPrefixRequestCount: 0,
      phase: 'enumerate-branches',
      queuedSelections: 0,
    });
    const enumerationCheckpoint = createTelemetryEvent({
      analysisPasses: 1,
      discoveredBranches: 2,
      elapsedMs: 1,
      enumerationPrefixComputationCount: 3,
      enumerationPrefixEntryCount: 2,
      enumerationPrefixHitCount: 1,
      enumerationPrefixRequestCount: 4,
      phase: 'enumerate-branches',
      queuedSelections: 2,
      sequence: 2,
      transition: 'checkpoint',
    });
    const replayStart = createTelemetryEvent({
      elapsedMs: 2,
      phase: 'replay-branches',
      replayCompleted: 0,
      replayPrefixComputationCount: 0,
      replayPrefixEntryCount: 0,
      replayPrefixHitCount: 0,
      replayPrefixRequestCount: 0,
      replayTotal: 2,
      sequence: 3,
    });
    const replayComplete = createTelemetryEvent({
      elapsedMs: 3,
      phase: 'replay-branches',
      replayCompleted: 2,
      replayPrefixComputationCount: 2,
      replayPrefixEntryCount: 1,
      replayPrefixHitCount: 1,
      replayPrefixRequestCount: 3,
      replayTotal: 2,
      sequence: 4,
      transition: 'complete',
    });

    expect(isPreviewCompleteRouteInventoryTelemetryEvent(enumerationStart)).toBe(true);
    expect(
      isPreviewCompleteRouteInventoryTelemetryEvent(enumerationCheckpoint, enumerationStart),
    ).toBe(true);
    expect(isPreviewCompleteRouteInventoryTelemetryEvent(replayStart, enumerationCheckpoint)).toBe(
      true,
    );
    expect(isPreviewCompleteRouteInventoryTelemetryEvent(replayComplete, replayStart)).toBe(true);
    const { enumerationPrefixEntryCount: _missing, ...missingEnumerationCounter } =
      enumerationStart;
    expect(isPreviewCompleteRouteInventoryTelemetryEvent(missingEnumerationCounter)).toBe(false);
    expect(
      isPreviewCompleteRouteInventoryTelemetryEvent({
        ...enumerationStart,
        replayPrefixRequestCount: 0,
      }),
    ).toBe(false);
    for (const name of [
      'enumerationPrefixRequestCount',
      'enumerationPrefixComputationCount',
      'enumerationPrefixHitCount',
      'enumerationPrefixEntryCount',
      'replayPrefixRequestCount',
      'replayPrefixComputationCount',
      'replayPrefixHitCount',
      'replayPrefixEntryCount',
    ]) {
      expect(
        isPreviewCompleteRouteInventoryTelemetryEvent({ [name]: 0, ...createTelemetryEvent() }),
      ).toBe(false);
    }
    for (const malformed of [
      { ...enumerationStart, enumerationPrefixRequestCount: 1 },
      { ...enumerationCheckpoint, enumerationPrefixRequestCount: 5 },
      { ...enumerationCheckpoint, enumerationPrefixEntryCount: 4 },
      { ...enumerationCheckpoint, enumerationPrefixHitCount: -1 },
      {
        ...enumerationCheckpoint,
        enumerationPrefixComputationCount: Number.MAX_SAFE_INTEGER + 1,
      },
      {
        ...enumerationCheckpoint,
        elapsedMs: 2,
        enumerationPrefixComputationCount: 2,
        enumerationPrefixEntryCount: 2,
        enumerationPrefixRequestCount: 3,
        sequence: 3,
      },
      { ...replayStart, replayPrefixHitCount: 1, replayPrefixRequestCount: 1 },
      { ...replayComplete, replayPrefixEntryCount: 3 },
    ]) {
      const previous =
        malformed.phase === 'enumerate-branches' && malformed.sequence === 3
          ? enumerationCheckpoint
          : undefined;
      expect(isPreviewCompleteRouteInventoryTelemetryEvent(malformed, previous)).toBe(false);
    }
  });
});

/** Creates one exact source-general progress event for protocol validation. */
function createTelemetryEvent(
  overrides: Partial<PreviewCompleteRouteInventoryTelemetryEvent> = {},
): PreviewCompleteRouteInventoryTelemetryEvent {
  return {
    cpuSystemMicros: 20,
    cpuUserMicros: 10,
    elapsedMs: 0,
    heapUsedBytes: 1_024,
    phase: 'prepare-source-index',
    rssBytes: 2_048,
    sequence: 1,
    transition: 'start',
    version: 4,
    ...overrides,
  };
}

/** Supplies the exact identity-free nested payload accepted only on bundle completion. */
function createBundleDiagnostics(): PreviewInspectorBundleDiagnostics {
  return {
    diagnosticsVersion: 1,
    bundleMeasuredMicros: 0,
    frontierCount: 0,
    rawSourceReadCount: 0,
    rawSourceReadMicros: 0,
    inventoryReadRequestCount: 0,
    inventoryReadPathCacheHitCount: 0,
    sliceRequestCount: 0,
    sliceComputationCount: 0,
    sliceHitCount: 0,
    sliceLookupMicros: 0,
    inventoryRequestCount: 0,
    inventoryComputationCount: 0,
    inventoryHitCount: 0,
    inventoryLookupMicros: 0,
    queueIterationCount: 0,
    queuePeakLength: 0,
    queueSortCount: 0,
    queueSortMicros: 0,
    edgeVisitCount: 0,
    optionalClosureProbeCount: 0,
    optionalClosureMicros: 0,
    resolveModuleCount: 0,
    resolveModuleMicros: 0,
    authoredPathCheckCount: 0,
    authoredPathCheckMicros: 0,
    frontierFinalizeMicros: 0,
    frontierIdentityMicros: 0,
    candidateSelectionSortCount: 0,
    candidateSelectionMicros: 0,
  };
}
