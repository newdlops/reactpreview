import { describe, expect, it } from 'vitest';
import { preparePreviewInspectorBundleExecution } from '../../../src/adapters/esbuild/preparePreviewInspectorBundleExecution';
import { createPreviewPreparationPolicy } from '../../../src/adapters/esbuild/previewPreparationPolicy';
import type { PreviewInspectorAncestorPlan } from '../../../src/adapters/esbuild/inspector/previewInspectorAncestorPlan';

describe('preparePreviewInspectorBundleExecution', () => {
  it('fails closed when every automatic Page Execution candidate exceeds its hard frontier', async () => {
    const targetPath = '/workspace/Target.tsx';
    await expect(
      preparePreviewInspectorBundleExecution({
        analysisCandidateCount: 1, corridorSourceCount: 1, dependencySnapshotCount: 0,
        discoveryTruncated: false,
        executablePlan: { edges: [], pageCandidates: [], root: { exportName: 'Target', sourcePath: targetPath }, target: { exportName: 'Target', sourcePath: targetPath } } as unknown as PreviewInspectorAncestorPlan,
        executionCandidates: [{ browserCandidate: { id: 'selected' }, compositionEdges: [], criticalSurfaces: [{ bypassedWrapperNames: [], exportName: 'Target', id: 'target', omittedTopLevelEffectCount: 0, sourcePath: targetPath, strategy: 'authentic-module-export', watchSourcePaths: [targetPath] }], evidenceSourcePaths: [], fidelity: 'target-only', id: 'target-only', optionalSurfaces: [], watchSourcePaths: [targetPath] }] as never,
        policy: createPreviewPreparationPolicy({ preparationMode: 'fast' }),
        readSource: () => Promise.resolve(`/*${'x'.repeat(1024 * 1024)}*/ export const Target = null;`),
        resolveModule: () => undefined, styleSnapshotCount: 0, workspaceRoot: '/workspace',
      }),
    ).rejects.toMatchObject({ reason: 'graph-budget', target: targetPath });
  });

  it('does not revive the v1 frontier when automatic Page Execution has no admissible candidate', async () => {
    const targetPath = '/workspace/Target.tsx';
    await expect(
      preparePreviewInspectorBundleExecution({
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
      }),
    ).rejects.toMatchObject({ reason: 'graph-budget', target: targetPath });
  });

  it('throws graph-budget after exposing rejected frontier activity to a direct compiler caller', async () => {
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
    expect(result.activity.phase).toBe('rejected');
    expect(() => {
      result.throwIfRejected(targetPath);
    }).toThrow('fixed graph budget');
  });
});
