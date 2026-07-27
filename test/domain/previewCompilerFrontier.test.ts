import { describe, expect, it } from 'vitest';
import { isPreviewCompilerActivity } from '../../src/domain/previewCompilerActivity';
import { createPreviewCompilerFrontierPolicy } from '../../src/domain/previewCompilerFrontier';

describe('preview compiler frontier policy', () => {
  it('keeps automatic mode identity without a graph admission budget', () => {
    expect(createPreviewCompilerFrontierPolicy('fast')).toEqual({ mode: 'fast' });
    expect(createPreviewCompilerFrontierPolicy('corridor')).toEqual({ mode: 'corridor' });
    expect(createPreviewCompilerFrontierPolicy('full')).toBeUndefined();
  });

  it('accepts exact telemetry counters beyond the former protocol ceilings', () => {
    expect(
      isPreviewCompilerActivity({
        analysisCandidateCount: 2_000_000,
        authoredEdgeCount: 3_000_000,
        corridorSourceCount: 2_000_000,
        dependencySnapshotCount: 0,
        discoveryScope: 'selected-corridor',
        discoveryTruncated: false,
        exactModuleCount: 2_000_000,
        executableCandidateCount: 1,
        frontierSourceBytes: 2 * 1024 ** 3,
        graphAdmission: 'unbounded',
        kind: 'bundle-frontier',
        maximumDepth: 2_000_000,
        optionalComponentCount: 0,
        packageDemandSourceCount: 2_000_000,
        phase: 'planned',
        preparationMode: 'fast',
        projectedEdgeCount: 0,
        styleSnapshotCount: 0,
        supportModuleCount: 0,
        totalAuthoredModuleCount: 2_000_000,
        truncated: false,
        truncationReasons: [],
      }),
    ).toBe(true);
  });
});
