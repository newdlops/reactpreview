import { describe, expect, it } from 'vitest';
import {
  createPreviewInspectorBundleDiagnosticsCollector,
  PREVIEW_INSPECTOR_BUNDLE_DIAGNOSTIC_FIELD_NAMES,
} from '../../../../src/adapters/esbuild/inspector/previewInspectorBundleDiagnostics';

describe('previewInspectorBundleDiagnostics', () => {
  it('collects exact frozen counters and inclusive fake-clock durations', async () => {
    const ticks = [
      0n,
      1_000n,
      4_000n,
      5_000n,
      9_000n,
      10_000n,
      16_000n,
      17_000n,
      24_000n,
      25_000n,
      33_000n,
      34_000n,
      43_000n,
      44_000n,
      54_000n,
      55_000n,
      66_000n,
      67_000n,
      79_000n,
      80_000n,
      93_000n,
      94_000n,
      108_000n,
      109_000n,
      124_000n,
    ];
    let clockReads = 0;
    const collector = createPreviewInspectorBundleDiagnosticsCollector(true, () => {
      const tick = ticks[clockReads];
      clockReads += 1;
      if (tick === undefined) throw new Error('Unexpected fake-clock read.');
      return tick;
    });
    if (collector === undefined) throw new Error('Expected enabled diagnostics.');

    collector.recordFrontier();
    collector.recordFrontier();
    await collector.measureRawSourceRead(() => Promise.resolve('source'));
    collector.recordInventoryRead(false);
    collector.recordInventoryRead(true);
    collector.measureSliceLookup(() => 'slice');
    collector.recordSliceMemoDelta({ computations: 2, hits: 3, requests: 5 });
    collector.measureInventoryLookup(() => 'inventory');
    collector.recordInventoryMemoDelta({ computations: 4, hits: 5, requests: 9 });
    collector.recordQueueIteration(2);
    collector.recordQueueIteration(5);
    collector.measureQueueSort(() => undefined);
    collector.recordEdgeVisit();
    await collector.measureOptionalClosure(() => Promise.resolve(undefined));
    collector.measureResolveModule(() => undefined);
    collector.measureAuthoredPathCheck(() => true);
    collector.measureFrontierFinalize(() =>
      collector.measureFrontierIdentity(() => 'identity'),
    );
    collector.measureCandidateSelection(() => undefined);

    const snapshot = collector.snapshot();
    expect(Object.keys(snapshot)).toEqual(PREVIEW_INSPECTOR_BUNDLE_DIAGNOSTIC_FIELD_NAMES);
    expect(snapshot).toEqual({
      diagnosticsVersion: 1,
      bundleMeasuredMicros: 94,
      frontierCount: 2,
      rawSourceReadCount: 1,
      rawSourceReadMicros: 3,
      inventoryReadRequestCount: 2,
      inventoryReadPathCacheHitCount: 1,
      sliceRequestCount: 5,
      sliceComputationCount: 2,
      sliceHitCount: 3,
      sliceLookupMicros: 4,
      inventoryRequestCount: 9,
      inventoryComputationCount: 4,
      inventoryHitCount: 5,
      inventoryLookupMicros: 6,
      queueIterationCount: 2,
      queuePeakLength: 5,
      queueSortCount: 1,
      queueSortMicros: 7,
      edgeVisitCount: 1,
      optionalClosureProbeCount: 1,
      optionalClosureMicros: 8,
      resolveModuleCount: 1,
      resolveModuleMicros: 9,
      authoredPathCheckCount: 1,
      authoredPathCheckMicros: 10,
      frontierFinalizeMicros: 24,
      frontierIdentityMicros: 1,
      candidateSelectionSortCount: 1,
      candidateSelectionMicros: 13,
    });
    expect(snapshot.frontierFinalizeMicros).toBeGreaterThan(snapshot.frontierIdentityMicros);
    expect(Object.isFrozen(snapshot)).toBe(true);
    expect(clockReads).toBe(22);
  });

  it('returns no collector and performs zero clock reads when disabled', () => {
    let clockReads = 0;
    expect(
      createPreviewInspectorBundleDiagnosticsCollector(false, () => {
        clockReads += 1;
        return 0n;
      }),
    ).toBeUndefined();
    expect(clockReads).toBe(0);
  });
});
