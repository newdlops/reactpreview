import { describe, expect, it } from 'vitest';
import { formatPreviewCompilerActivity } from '../../src/presentation/previewCompilerActivityLog';

describe('formatPreviewCompilerActivity', () => {
  it('formats bounded frontier counters without a source path', () => {
    const message = formatPreviewCompilerActivity({
      analysisCandidateCount: 3,
      authoredEdgeCount: 768,
      corridorSourceCount: 513,
      dependencySnapshotCount: 2,
      discoveryScope: 'selected-corridor',
      discoveryTruncated: false,
      exactModuleCount: 2,
      executableCandidateCount: 1,
      frontierSourceBytes: 10_240,
      graphAdmission: 'unbounded',
      kind: 'bundle-frontier',
      maximumDepth: 2,
      optionalComponentCount: 0,
      packageDemandSourceCount: 1,
      pageExecution: {
        candidateFidelity: 'page-authentic',
        candidateId: 'selected',
        disposition: 'accepted-unbounded',
        selectedCriticalSurfaceCount: 2,
      },
      phase: 'planned',
      preparationMode: 'fast',
      projectedEdgeCount: 0,
      styleSnapshotCount: 1,
      supportModuleCount: 305,
      totalAuthoredModuleCount: 307,
      truncated: false,
      truncationReasons: [],
    });

    expect(message).toContain('total=307');
    expect(message).toContain('edges=768');
    expect(message).toContain('graph-admission=unbounded');
    expect(message).not.toContain('limits=');
    expect(message).not.toContain('/workspace/');
  });
});
