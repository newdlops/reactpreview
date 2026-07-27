import { describe, expect, it } from 'vitest';
import { preparePreviewInspectorBundleExecution } from '../../../src/adapters/esbuild/preparePreviewInspectorBundleExecution';
import { createPreviewPreparationPolicy } from '../../../src/adapters/esbuild/previewPreparationPolicy';
import type { PreviewInspectorAncestorPlan } from '../../../src/adapters/esbuild/inspector/previewInspectorAncestorPlan';
import { PreviewBuildStalledError } from '../../../src/domain/previewBuildExecution';

describe('preparePreviewInspectorBundleExecution', () => {
  it('admits a Page Execution candidate with a source beyond the former byte budget', async () => {
    const targetPath = '/workspace/Target.tsx';
    const result = await preparePreviewInspectorBundleExecution({
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
    const result = await preparePreviewInspectorBundleExecution({
      analysisCandidateCount: 1,
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
  });
});
