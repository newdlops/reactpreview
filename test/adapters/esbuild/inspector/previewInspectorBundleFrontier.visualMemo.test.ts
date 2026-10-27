/** Verifies closure reuse preserves lazy visual evidence and projected-edge diagnostics. */
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
import type { PreviewInspectorOneHopVisualPath } from '../../../../src/adapters/esbuild/inspector/previewInspectorShallowVisualTypes';

/** Keeps the source snapshot fixed while independent descriptor evidence changes. */
function createVisualFixture(firstSource: 'present' | 'missing' = 'present'): {
  readonly first: PreviewInspectorOneHopVisualPath;
  readonly alternate: PreviewInspectorOneHopVisualPath;
  readonly prepare: (
    visualPaths: readonly PreviewInspectorOneHopVisualPath[],
    memo?: PreviewInspectorBundleSourceInventoryMemo,
  ) => ReturnType<typeof preparePreviewInspectorBundleFrontier>;
} {
  const shellPath = '/workspace/Shell.tsx';
  const targetPath = '/workspace/Target.tsx';
  const firstPath = '/workspace/First.tsx';
  const secondPath = '/workspace/Second.tsx';
  const sources = new Map([
    [
      shellPath,
      [
        "import { lazy } from 'react'; import { Target } from './Target';",
        "const First = lazy(() => import('./First'));",
        "const Second = lazy(() => import('./Second'));",
        'export function Shell() { return <><First /><Target /><Second /></>; }',
      ].join('\n'),
    ],
    [targetPath, 'export function Target() { return null; }'],
    [firstPath, 'export default function First() { return <main>first</main>; }'],
    [secondPath, 'export default function Second() { return <main>second</main>; }'],
  ]);
  if (firstSource === 'missing') sources.delete(firstPath);
  const criticalSurfaces = ['Shell', 'Target'].map((name) => ({
    bypassedWrapperNames: [],
    exportName: name,
    id: name,
    omittedTopLevelEffectCount: 0,
    sourcePath: `/workspace/${name}.tsx`,
    strategy: 'authentic-module-export' as const,
    watchSourcePaths: [],
  }));
  const executionCandidate: PreviewInspectorPageExecutionCandidate = {
    browserCandidate: {
      id: 'selected',
    } as PreviewInspectorPageExecutionCandidate['browserCandidate'],
    compositionEdges: [],
    criticalSurfaces,
    evidenceSourcePaths: [],
    executionRootContract: { exportName: 'Shell', sourcePath: shellPath, surfaceId: 'Shell' },
    executionRootSurfaceId: 'Shell',
    fidelity: 'page-authentic',
    id: 'selected',
    optionalSurfaces: [
      {
        bypassedWrapperNames: [],
        exportName: 'default',
        id: 'first',
        omittedTopLevelEffectCount: 0,
        sourcePath: firstPath,
        strategy: 'authentic-module-export',
        watchSourcePaths: [],
      },
    ],
    runtimeTargetContract: { exportName: 'Target', sourcePath: targetPath, surfaceId: 'Target' },
    runtimeTargetSurfaceId: 'Target',
    watchSourcePaths: [],
  };
  const first: PreviewInspectorOneHopVisualPath = {
    exportName: 'default',
    importerPath: shellPath,
    importKind: 'static',
    localEdges: [],
    moduleSpecifier: './First',
    occurrenceStart: 10,
    relation: 'sibling',
    renderedLocalName: 'First',
    renderBoundaryStart: 0,
    selectedChildPath: targetPath,
    sourcePath: firstPath,
  };
  const alternate: PreviewInspectorOneHopVisualPath = {
    ...first,
    importKind: 'react-lazy',
    moduleSpecifier: './Second',
    occurrenceStart: 20,
    relation: 'route-alternative',
    renderedLocalName: 'Second',
    sourcePath: secondPath,
  };
  const policy = createPreviewCompilerFrontierPolicy('fast');
  if (policy === undefined) throw new Error('Expected the automatic fast frontier policy.');
  return {
    first,
    alternate,
    prepare: (shallowVisualPaths, sourceInventoryMemo) =>
      preparePreviewInspectorBundleFrontier({
        executionCandidate,
        plan: {
          edges: [],
          pageCandidates: [],
          root: { exportName: 'Shell', sourcePath: shellPath },
          shallowVisualPaths,
          target: { exportName: 'Target', sourcePath: targetPath },
        } as unknown as PreviewInspectorAncestorPlan,
        policy,
        readSource: (sourcePath) => Promise.resolve(sources.get(sourcePath)),
        resolveModule: (specifier, importer) => {
          if (!specifier.startsWith('.')) return undefined;
          const resolved = `${path.resolve(path.dirname(importer), specifier)}.tsx`;
          return sources.has(resolved) ? resolved : undefined;
        },
        ...(sourceInventoryMemo === undefined ? {} : { sourceInventoryMemo }),
        workspaceRoot: '/workspace',
      }),
  };
}

describe('Page Execution visual evidence closure memo', () => {
  it.each(['route alternative', 'exact lazy evidence'] as const)(
    'does not retain an earlier lazy branch after adding %s',
    async (evidence) => {
      const fixture = createVisualFixture();
      const memo = createPreviewInspectorBundleSourceInventoryMemo();
      const earlier = await fixture.prepare([fixture.first], memo);
      const changed =
        evidence === 'route alternative'
          ? [fixture.first, fixture.alternate]
          : [{ ...fixture.first, importKind: 'react-lazy' as const }];
      const expected = await fixture.prepare(changed);
      const actual = await fixture.prepare(changed, memo);

      expect(earlier.rejected).toBe(false);
      expect(expected.rejected).toBe(false);
      expect(earlier.frontier.authenticSourcePaths).toContain('/workspace/Second.tsx');
      expect(expected.frontier.authenticSourcePaths).not.toContain('/workspace/Second.tsx');
      expect(actual).toEqual(expected);
      expect(await fixture.prepare([...changed].reverse(), memo)).toEqual(expected);
      expect(memo.getClosureStatistics()).toMatchObject({ closureComputations: 2, closureHits: 1 });
      memo.release();
    },
  );

  it('retains current import spelling and source position when a visual edge is projected', async () => {
    const fixture = createVisualFixture('missing');
    const memo = createPreviewInspectorBundleSourceInventoryMemo();
    await fixture.prepare([fixture.first], memo);
    const changed = [{ ...fixture.first, moduleSpecifier: './FirstAlias', occurrenceStart: 99 }];
    const expected = await fixture.prepare(changed);
    const actual = await fixture.prepare(changed, memo);

    expect(
      expected.frontier.projectedEdges,
      JSON.stringify(expected.frontier.projectedEdges),
    ).toContainEqual(
      expect.objectContaining({
        moduleSpecifier: './FirstAlias',
        occurrenceStart: 99,
        targetPath: fixture.first.sourcePath,
      }),
    );
    expect(actual).toEqual(expected);
    memo.release();
  });
});
