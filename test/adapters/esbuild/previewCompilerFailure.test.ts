import { describe, expect, it, vi } from 'vitest';
import { resolvePreviewCompilerFailure } from '../../../src/adapters/esbuild/previewCompilerFailure';
import type { PreviewDependencyResolutionHintPlan } from '../../../src/adapters/esbuild/previewMissingDependencyRequirements';
import { PreviewBuildStalledError } from '../../../src/domain/previewBuildExecution';

describe('resolvePreviewCompilerFailure', () => {
  it('converts a frozen-frontier guard error to frontier-mismatch without dependency recovery', async () => {
    const tryAcquireMissingDependencies = vi.fn(() => Promise.resolve(undefined));

    await expect(
      resolvePreviewCompilerFailure({
        buildSignal: new AbortController().signal,
        dependencyAcquisitionAttempted: false,
        error: {
          errors: [
            {
              text: 'React Preview frontier mismatch: ./Unexpected escaped the planned authored bundle.',
            },
          ],
          warnings: [],
        },
        retryCompilation: vi.fn(),
        target: '/workspace/Target.tsx',
        tryAcquireMissingDependencies,
      }),
    ).rejects.toMatchObject({
      reason: 'frontier-mismatch',
      target: '/workspace/Target.tsx',
    });
    expect(tryAcquireMissingDependencies).not.toHaveBeenCalled();
  });

  it('preserves a post-build frontier verifier mismatch activity', async () => {
    const activity = {
      analysisCandidateCount: 1,
      authoredEdgeCount: 2,
      corridorSourceCount: 2,
      dependencySnapshotCount: 0,
      discoveryScope: 'selected-corridor' as const,
      discoveryTruncated: false,
      exactModuleCount: 1,
      executableCandidateCount: 1 as const,
      frontierSourceBytes: 32,
      graphAdmission: 'unbounded' as const,
      kind: 'bundle-frontier' as const,
      maximumDepth: 1,
      optionalComponentCount: 1,
      packageDemandSourceCount: 0,
      phase: 'planned' as const,
      preparationMode: 'fast' as const,
      projectedEdgeCount: 0,
      styleSnapshotCount: 0,
      supportModuleCount: 0,
      totalAuthoredModuleCount: 2,
      truncated: false,
      truncationReasons: [],
    };
    const error = new PreviewBuildStalledError(
      '/workspace/Target.tsx',
      'bundling-modules',
      0,
      'frontier-mismatch',
      activity,
    );

    await expect(
      resolvePreviewCompilerFailure({
        buildSignal: new AbortController().signal,
        dependencyAcquisitionAttempted: false,
        error,
        retryCompilation: vi.fn(),
        target: '/workspace/Target.tsx',
        tryAcquireMissingDependencies: vi.fn(() => Promise.resolve(undefined)),
      }),
    ).rejects.toBe(error);
  });

  /** The retry skips the preflight, so a contract the failed build applied must survive it. */
  it('keeps the applied preflight contracts on the acquisition retry', async () => {
    const score = {
      action: 'facade-package-contract' as const,
      featureVector: [],
      modelScore: 0.5,
      selectionScore: 0.9,
      updates: 0,
    };
    const plan = (
      overrides: Partial<PreviewDependencyResolutionHintPlan>,
    ): PreviewDependencyResolutionHintPlan => ({
      facadeCandidates: [],
      facadeSourcePaths: [],
      packageCandidates: [],
      packageContractCandidates: [],
      packageNames: [],
      styleCandidates: [],
      version: 4,
      ...overrides,
    });
    const applied = plan({
      packageContractCandidates: [
        {
          moduleSpecifier: 'axios',
          packageName: 'axios',
          score,
          sourcePath: '/workspace/src/lib/envClient.ts',
        },
      ],
    });
    const acquired = plan({ packageNames: ['xlsx'] });
    const retryCompilation = vi.fn(() => Promise.resolve({} as never));

    await resolvePreviewCompilerFailure({
      appliedHints: applied,
      buildSignal: new AbortController().signal,
      dependencyAcquisitionAttempted: false,
      error: { errors: [{ text: 'Could not resolve "xlsx"' }], warnings: [] },
      retryCompilation,
      target: '/workspace/src/Target.tsx',
      tryAcquireMissingDependencies: () => Promise.resolve(acquired),
    });

    expect(retryCompilation).toHaveBeenCalledWith(
      expect.objectContaining({
        packageContractCandidates: applied.packageContractCandidates,
        packageNames: ['xlsx'],
      }),
    );
  });
});
