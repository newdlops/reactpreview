/** Checks closure memo isolation when identical source exports receive different execution roles. */
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { createPreviewCompilerFrontierPolicy } from '../../../../src/domain/previewCompilerFrontier';
import type { PreviewInspectorAncestorPlan } from '../../../../src/adapters/esbuild/inspector/previewInspectorAncestorPlan';
import {
  createPreviewInspectorBundleSourceInventoryMemo,
  preparePreviewInspectorBundleFrontier,
  type PreviewInspectorBundleSourceInventoryMemo,
} from '../../../../src/adapters/esbuild/inspector/previewInspectorBundleFrontier';
import type { PreviewInspectorPageExecutionCandidate } from '../../../../src/adapters/esbuild/inspector/previewInspectorPageExecutionTypes';

/** Gives one possible execution root a lazy child that ordinary exact-source admission omits. */
function createRoleFixture(): (
  rootName: string,
  targetName: string,
  memo?: PreviewInspectorBundleSourceInventoryMemo,
  renameSurfaceIds?: boolean,
) => ReturnType<typeof preparePreviewInspectorBundleFrontier> {
  const sources = new Map([
    [
      '/workspace/A.tsx',
      "import { lazy } from 'react'; const Child = lazy(() => import('./Child')); export function A() { return <Child />; }",
    ],
    ['/workspace/B.tsx', 'export function B() { return null; }'],
    ['/workspace/Target.tsx', 'export function Target() { return null; }'],
    ['/workspace/Child.tsx', 'export default function Child() { return <main>child</main>; }'],
  ]);
  const policy = createPreviewCompilerFrontierPolicy('fast');
  if (policy === undefined) throw new Error('Expected the automatic fast frontier policy.');
  return (rootName, targetName, sourceInventoryMemo, renameSurfaceIds = false) => {
    const criticalSurfaces = ['A', 'B', 'Target'].map((name) => ({
      bypassedWrapperNames: [],
      exportName: name,
      id: `${name}${renameSurfaceIds ? '-renamed' : ''}`,
      omittedTopLevelEffectCount: 0,
      sourcePath: `/workspace/${name}.tsx`,
      strategy: 'authentic-module-export' as const,
      watchSourcePaths: [],
    }));
    const root = criticalSurfaces.find((surface) => surface.exportName === rootName);
    const target = criticalSurfaces.find((surface) => surface.exportName === targetName);
    if (root === undefined || target === undefined) throw new Error('Expected both role surfaces.');
    const executionCandidate: PreviewInspectorPageExecutionCandidate = {
      browserCandidate: {
        id: 'shared-browser',
        root: { exportName: root.exportName, sourcePath: root.sourcePath },
      } as PreviewInspectorPageExecutionCandidate['browserCandidate'],
      compositionEdges: [],
      criticalSurfaces,
      evidenceSourcePaths: [],
      executionRootContract: {
        exportName: root.exportName,
        sourcePath: root.sourcePath,
        surfaceId: root.id,
      },
      executionRootSurfaceId: root.id,
      fidelity: 'page-authentic',
      id: `${root.id}:${target.id}`,
      optionalSurfaces: [],
      runtimeTargetContract: {
        exportName: target.exportName,
        sourcePath: target.sourcePath,
        surfaceId: target.id,
      },
      runtimeTargetSurfaceId: target.id,
      watchSourcePaths: [],
    };
    const plan = {
      edges: [],
      pageCandidates: [],
      root: { exportName: 'B', sourcePath: '/workspace/B.tsx' },
      target: { exportName: 'Target', sourcePath: '/workspace/Target.tsx' },
    } as unknown as PreviewInspectorAncestorPlan;
    return preparePreviewInspectorBundleFrontier({
      executionCandidate,
      plan,
      policy,
      readSource: (sourcePath) => Promise.resolve(sources.get(sourcePath)),
      resolveModule: (specifier, importer) => {
        if (!specifier.startsWith('.')) return undefined;
        const resolved = `${path.resolve(path.dirname(importer), specifier)}.tsx`;
        return sources.has(resolved) ? resolved : undefined;
      },
      ...(sourceInventoryMemo === undefined ? {} : { sourceInventoryMemo }),
      workspaceRoot: '/workspace',
    });
  };
}

describe('Page Execution role closure memo', () => {
  it.each(['execution root', 'runtime target'] as const)(
    'recomputes lazy visual admission when the %s changes',
    async (role) => {
      const prepare = createRoleFixture();
      const memo = createPreviewInspectorBundleSourceInventoryMemo();
      const first =
        role === 'execution root'
          ? await prepare('A', 'Target', memo)
          : await prepare('B', 'A', memo);
      const expected = await prepare('B', 'Target');
      const actual = await prepare('B', 'Target', memo);

      expect(first.rejected).toBe(false);
      expect(expected.rejected).toBe(false);
      expect(first.frontier.authenticSourcePaths).toContain('/workspace/Child.tsx');
      expect(expected.frontier.authenticSourcePaths).not.toContain('/workspace/Child.tsx');
      expect(actual).toEqual(expected);
      expect(await prepare('B', 'Target', memo, true)).toEqual(
        await prepare('B', 'Target', undefined, true),
      );
      expect(memo.getClosureStatistics()).toMatchObject({ closureComputations: 2, closureHits: 1 });
      memo.release();
    },
  );
});
