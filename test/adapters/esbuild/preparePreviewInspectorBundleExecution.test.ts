import { describe, expect, it } from 'vitest';
import { preparePreviewInspectorBundleExecution } from '../../../src/adapters/esbuild/preparePreviewInspectorBundleExecution';
import { createPreviewPreparationPolicy } from '../../../src/adapters/esbuild/previewPreparationPolicy';
import { createPreviewInspectorBundleDiagnosticsCollector } from '../../../src/adapters/esbuild/inspector/previewInspectorBundleDiagnostics';
import type { PreviewInspectorAncestorPlan } from '../../../src/adapters/esbuild/inspector/previewInspectorAncestorPlan';
import { PreviewBuildStalledError } from '../../../src/domain/previewBuildExecution';

describe('preparePreviewInspectorBundleExecution', () => {
  it('admits a Page Execution candidate with a source beyond the former byte budget', async () => {
    const targetPath = '/workspace/Target.tsx';
    let clockMicros = 0n;
    const bundleDiagnostics = createPreviewInspectorBundleDiagnosticsCollector(true, () => {
      const now = clockMicros;
      clockMicros += 1_000n;
      return now;
    });
    if (bundleDiagnostics === undefined) throw new Error('Expected bundle diagnostics.');
    const result = await preparePreviewInspectorBundleExecution({
      analysisCandidateCount: 1,
      bundleDiagnostics,
      corridorSourceCount: 1,
      dependencySnapshotCount: 0,
      discoveryTruncated: false,
      executablePlan: {
        edges: [],
        pageCandidates: [],
        root: { exportName: 'Target', sourcePath: targetPath },
        target: { exportName: 'Target', sourcePath: targetPath },
      } as unknown as PreviewInspectorAncestorPlan,
      executionCandidates: [
        {
          browserCandidate: { id: 'selected' },
          compositionEdges: [],
          criticalSurfaces: [
            {
              bypassedWrapperNames: [],
              exportName: 'Target',
              id: 'target',
              omittedTopLevelEffectCount: 0,
              sourcePath: targetPath,
              strategy: 'authentic-module-export',
              watchSourcePaths: [targetPath],
            },
          ],
          evidenceSourcePaths: [],
          fidelity: 'target-only',
          id: 'target-only',
          optionalSurfaces: [],
          watchSourcePaths: [targetPath],
        },
      ] as never,
      policy: createPreviewPreparationPolicy({ preparationMode: 'fast' }),
      readSource: () =>
        Promise.resolve(`/*${'x'.repeat(1024 * 1024)}*/ export const Target = null;`),
      resolveModule: () => undefined,
      styleSnapshotCount: 0,
      workspaceRoot: '/workspace',
    });
    if (result === undefined) throw new Error('Expected an automatic frontier result.');
    expect(result.activity).toMatchObject({
      graphAdmission: 'unbounded',
      phase: 'planned',
      truncationReasons: [],
    });
    expect(() => {
      result.throwIfRejected(targetPath);
    }).not.toThrow();
    expect(bundleDiagnostics.snapshot()).toMatchObject({
      candidateSelectionSortCount: 1,
      frontierCount: 1,
      inventoryComputationCount: 1,
      inventoryReadRequestCount: 1,
      queueIterationCount: 1,
      queueSortCount: 1,
      rawSourceReadCount: 1,
      sliceRequestCount: 0,
    });
  });

  it('reuses request-local immutable frontier work across serial candidates', async () => {
    const targetPath = '/workspace/Target.tsx';
    let clockMicros = 0n;
    const bundleDiagnostics = createPreviewInspectorBundleDiagnosticsCollector(true, () => {
      const now = clockMicros;
      clockMicros += 1_000n;
      return now;
    });
    if (bundleDiagnostics === undefined) throw new Error('Expected bundle diagnostics.');
    const sharedSurface = {
      bypassedWrapperNames: [],
      exportName: 'Target',
      id: 'target',
      omittedTopLevelEffectCount: 0,
      sourcePath: targetPath,
      strategy: 'authentic-module-export',
      watchSourcePaths: [targetPath],
    } as const;
    const result = await preparePreviewInspectorBundleExecution({
      analysisCandidateCount: 2,
      bundleDiagnostics,
      corridorSourceCount: 1,
      dependencySnapshotCount: 0,
      discoveryTruncated: false,
      executablePlan: {
        edges: [],
        pageCandidates: [],
        root: { exportName: 'Target', sourcePath: targetPath },
        target: { exportName: 'Target', sourcePath: targetPath },
      } as unknown as PreviewInspectorAncestorPlan,
      executionCandidates: ['first', 'second'].map((id) => ({
        browserCandidate: { id: 'selected' },
        compositionEdges: [],
        criticalSurfaces: [sharedSurface],
        evidenceSourcePaths: [],
        fidelity: 'target-only',
        id,
        optionalSurfaces: [],
        watchSourcePaths: [targetPath],
      })) as never,
      policy: createPreviewPreparationPolicy({ preparationMode: 'fast' }),
      readSource: () => Promise.resolve('export const Target = null;'),
      resolveModule: () => undefined,
      styleSnapshotCount: 0,
      workspaceRoot: '/workspace',
    });

    if (result === undefined) throw new Error('Expected an automatic frontier result.');
    expect(result.executionCandidate?.id).toBe('first');
    expect(result.activity.pageExecution).toMatchObject({ candidateId: 'first' });
    expect(bundleDiagnostics.snapshot()).toMatchObject({
      frontierCount: 2,
      inventoryComputationCount: 1,
      queueIterationCount: 1,
    });
  });

  it('reports candidate-unavailable when automatic Page Execution has no candidate', async () => {
    const targetPath = '/workspace/Target.tsx';
    let caught: unknown;
    try {
      await preparePreviewInspectorBundleExecution({
        analysisCandidateCount: 1,
        corridorSourceCount: 1,
        dependencySnapshotCount: 0,
        discoveryTruncated: false,
        executablePlan: {
          edges: [],
          pageCandidates: [],
          root: { exportName: 'Target', sourcePath: targetPath },
          target: { exportName: 'Target', sourcePath: targetPath },
        } as unknown as PreviewInspectorAncestorPlan,
        executionCandidates: [],
        policy: createPreviewPreparationPolicy({ preparationMode: 'fast' }),
        readSource: () => Promise.resolve(undefined),
        resolveModule: () => undefined,
        styleSnapshotCount: 0,
        workspaceRoot: '/workspace',
      });
    } catch (error: unknown) {
      caught = error;
    }
    expect(caught).toBeInstanceOf(PreviewBuildStalledError);
    if (!(caught instanceof PreviewBuildStalledError)) return;
    expect(caught.reason).toBe('candidate-unavailable');
    expect(caught.target).toBe(targetPath);
    expect(caught.activity).toMatchObject({ executableCandidateCount: 0, kind: 'graph-plan' });
  });

  it('admits an unbounded legacy frontier when no Page Execution list is supplied', async () => {
    const targetPath = '/workspace/Target.tsx';
    let clockMicros = 0n;
    const bundleDiagnostics = createPreviewInspectorBundleDiagnosticsCollector(true, () => {
      const now = clockMicros;
      clockMicros += 1_000n;
      return now;
    });
    if (bundleDiagnostics === undefined) throw new Error('Expected bundle diagnostics.');
    const result = await preparePreviewInspectorBundleExecution({
      analysisCandidateCount: 1,
      bundleDiagnostics,
      corridorSourceCount: 1,
      dependencySnapshotCount: 0,
      discoveryTruncated: false,
      executablePlan: {
        edges: [],
        pageCandidates: [
          {
            dependencyPaths: [],
            edges: [],
            root: { exportName: 'Target', sourcePath: targetPath },
          },
        ],
        root: { exportName: 'Target', sourcePath: targetPath },
        target: { exportName: 'Target', sourcePath: targetPath },
      } as unknown as PreviewInspectorAncestorPlan,
      policy: createPreviewPreparationPolicy({ preparationMode: 'fast' }),
      readSource: () =>
        Promise.resolve(`/*${'x'.repeat(1024 * 1024)}*/ export const Target = null;`),
      resolveModule: () => undefined,
      styleSnapshotCount: 0,
      workspaceRoot: '/workspace',
    });

    if (result === undefined) throw new Error('Expected an automatic fast frontier.');
    expect(result.activity).toMatchObject({
      graphAdmission: 'unbounded',
      phase: 'planned',
      truncationReasons: [],
    });
    expect(() => {
      result.throwIfRejected(targetPath);
    }).not.toThrow();
    expect(bundleDiagnostics.snapshot()).toMatchObject({
      candidateSelectionSortCount: 0,
      frontierCount: 1,
      inventoryReadRequestCount: 1,
      rawSourceReadCount: 2,
    });
  });
});
