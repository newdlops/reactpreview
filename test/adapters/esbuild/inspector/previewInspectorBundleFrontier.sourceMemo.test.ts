/** Covers sourceMemo behavior for previewInspectorBundleFrontier. */
/** Verifies authored-source previewInspectorBundleFrontier invariants. */

import { describe, expect, it, vi } from 'vitest';

import { createPreviewCompilerFrontierPolicy } from '../../../../src/domain/previewCompilerFrontier';

import {
  createPreviewInspectorBundleSourceInventoryMemo,
  preparePreviewInspectorBundleFrontier,
  type PreviewInspectorBundleSourceInventoryMemo,
} from '../../../../src/adapters/esbuild/inspector/previewInspectorBundleFrontier';

import { createPreviewInspectorBundleDiagnosticsCollector } from '../../../../src/adapters/esbuild/inspector/previewInspectorBundleDiagnostics';

import type { PreviewInspectorAncestorPlan } from '../../../../src/adapters/esbuild/inspector/previewInspectorAncestorPlan';

import type { PreviewInspectorPageExecutionCandidate } from '../../../../src/adapters/esbuild/inspector/previewInspectorPageExecutionTypes';

import {
  createPreviewInspectorLocalComponentSlice,
  createPreviewInspectorSelectedExportSlice,
} from '../../../../src/adapters/esbuild/inspector/previewInspectorMountSurfaceSlice';

describe('preparePreviewInspectorBundleFrontier', () => {
  it('reuses only exact selected-export and local-component slice operations', async () => {
    const sourcePath = '/workspace/Page.tsx';
    const changedPath = '/workspace/ChangedPage.tsx';
    const sourceText = [
      'const Inner = () => null;',
      'const Other = () => null;',
      'export const Page = Inner;',
      'export const OtherPage = Other;',
    ].join('\n');
    const changedSourceText = `${sourceText}\nexport const Changed = true;`;
    const memo = createPreviewInspectorBundleSourceInventoryMemo();

    const selected = memo.collectSelectedExportSlice(sourcePath, sourceText, 'Inner');
    const selectedAgain = memo.collectSelectedExportSlice(sourcePath, sourceText, 'Inner');
    const local = memo.collectLocalComponentSlice(sourcePath, sourceText, 'Inner', []);
    const localAgain = memo.collectLocalComponentSlice(sourcePath, sourceText, 'Inner', []);
    const changedPathSlice = memo.collectSelectedExportSlice(changedPath, sourceText, 'Inner');
    const changedTextSlice = memo.collectSelectedExportSlice(
      sourcePath,
      changedSourceText,
      'Inner',
    );
    const changedExportSlice = memo.collectSelectedExportSlice(sourcePath, sourceText, 'Other');
    const changedLocalSlice = memo.collectLocalComponentSlice(sourcePath, sourceText, 'Other', []);
    const memoWrapperSlice = memo.collectLocalComponentSlice(sourcePath, sourceText, 'Inner', [
      'memo',
    ]);
    const wrapperSequence = memo.collectLocalComponentSlice(sourcePath, sourceText, 'Inner', [
      'memo',
      'styled',
    ]);
    const changedWrapperSequence = memo.collectLocalComponentSlice(
      sourcePath,
      sourceText,
      'Inner',
      ['styled', 'memo'],
    );
    const failure = memo.collectSelectedExportSlice(sourcePath, sourceText, 'Missing');
    const failureAgain = memo.collectSelectedExportSlice(sourcePath, sourceText, 'Missing');

    expect(JSON.stringify(selectedAgain)).toBe(JSON.stringify(selected));
    expect(JSON.stringify(localAgain)).toBe(JSON.stringify(local));
    expect(JSON.stringify(selected)).toBe(
      JSON.stringify(
        createPreviewInspectorSelectedExportSlice({
          exportName: 'Inner',
          sourcePath,
          sourceText,
        }),
      ),
    );
    expect(JSON.stringify(local)).toBe(
      JSON.stringify(
        createPreviewInspectorLocalComponentSlice({
          localName: 'Inner',
          preservedWrapperKinds: [],
          sourcePath,
          sourceText,
        }),
      ),
    );
    expect(JSON.stringify(failure)).toBe(
      JSON.stringify(
        createPreviewInspectorSelectedExportSlice({
          exportName: 'Missing',
          sourcePath,
          sourceText,
        }),
      ),
    );
    expect(JSON.stringify(local)).not.toBe(JSON.stringify(selected));
    expect(changedWrapperSequence).not.toBe(wrapperSequence);
    expect(JSON.stringify(changedWrapperSequence)).toBe(JSON.stringify(wrapperSequence));
    expect(failureAgain).toBe(failure);
    for (const result of [
      selected,
      selectedAgain,
      local,
      localAgain,
      changedPathSlice,
      changedTextSlice,
      changedExportSlice,
      changedLocalSlice,
      memoWrapperSlice,
      wrapperSequence,
      changedWrapperSequence,
      failure,
      failureAgain,
    ]) {
      expect(Object.isFrozen(result)).toBe(true);
      if (result.kind === 'success') {
        expect(Object.isFrozen(result.slice)).toBe(true);
        expect(Object.isFrozen(result.slice.referencedLocalNames)).toBe(true);
      }
    }
    expect(memo.getSliceStatistics()).toEqual({
      released: false,
      sliceComputations: 10,
      sliceEntries: 10,
      sliceHits: 3,
      sliceRequests: 13,
    });

    const policy = createPreviewCompilerFrontierPolicy('fast');
    if (policy === undefined) throw new Error('Expected the automatic fast frontier policy.');
    const frontierMemo = createPreviewInspectorBundleSourceInventoryMemo();
    const sampledGetSliceStatistics = vi.fn(frontierMemo.getSliceStatistics);
    const sampledGetStatistics = vi.fn(frontierMemo.getStatistics);
    const sampledMemo: PreviewInspectorBundleSourceInventoryMemo = Object.freeze({
      ...frontierMemo,
      getSliceStatistics: sampledGetSliceStatistics,
      getStatistics: sampledGetStatistics,
    });
    let clockMicros = 0n;
    const bundleDiagnostics = createPreviewInspectorBundleDiagnosticsCollector(true, () => {
      const now = clockMicros;
      clockMicros += 1_000n;
      return now;
    });
    if (bundleDiagnostics === undefined) throw new Error('Expected bundle diagnostics.');
    const candidate = (
      strategy: 'inner-local-component-slice' | 'selected-export-slice',
      includeLocalName = true,
    ): PreviewInspectorPageExecutionCandidate =>
      ({
        browserCandidate: { id: 'selected' },
        compositionEdges: [],
        criticalSurfaces: [
          {
            bypassedWrapperNames: [],
            exportName: 'Inner',
            id: strategy,
            ...(strategy === 'inner-local-component-slice' && includeLocalName
              ? { localName: 'Inner' }
              : {}),
            omittedTopLevelEffectCount: 0,
            sourcePath,
            strategy,
            watchSourcePaths: [sourcePath],
          },
        ],
        evidenceSourcePaths: [],
        fidelity: 'target-only',
        id: strategy,
        optionalSurfaces: [],
        watchSourcePaths: [sourcePath],
      }) as unknown as PreviewInspectorPageExecutionCandidate;
    const prepareFrontier = (
      strategy: 'inner-local-component-slice' | 'selected-export-slice',
      withMemo: boolean,
      includeLocalName = true,
      sourceInventoryMemo: PreviewInspectorBundleSourceInventoryMemo = sampledMemo,
      withDiagnostics = withMemo,
      sourceReads?: string[],
      resolverCalls?: string[],
    ): ReturnType<typeof preparePreviewInspectorBundleFrontier> =>
      preparePreviewInspectorBundleFrontier({
        executionCandidate: candidate(strategy, includeLocalName),
        plan: {
          edges: [],
          pageCandidates: [],
          root: { exportName: 'Inner', sourcePath },
          target: { exportName: 'Inner', sourcePath },
        } as unknown as PreviewInspectorAncestorPlan,
        policy,
        readSource: (requestedPath) => {
          sourceReads?.push(requestedPath);
          return Promise.resolve(sourceText);
        },
        resolveModule: (specifier, importer) => {
          resolverCalls?.push(`${importer}\0${specifier}`);
          return undefined;
        },
        ...(withMemo ? { sourceInventoryMemo } : {}),
        ...(withDiagnostics ? { bundleDiagnostics } : {}),
        workspaceRoot: '/workspace',
      });
    const selectedFrontierWithoutMemo = await prepareFrontier('selected-export-slice', false);
    const selectedFrontierWithMemo = await prepareFrontier('selected-export-slice', true);
    const localFrontierWithoutMemo = await prepareFrontier('inner-local-component-slice', false);
    const localFrontierWithMemo = await prepareFrontier('inner-local-component-slice', true);
    expect(JSON.stringify(selectedFrontierWithMemo)).toBe(
      JSON.stringify(selectedFrontierWithoutMemo),
    );
    expect(JSON.stringify(localFrontierWithMemo)).toBe(JSON.stringify(localFrontierWithoutMemo));
    await prepareFrontier('selected-export-slice', true);
    await prepareFrontier('inner-local-component-slice', true);
    await prepareFrontier('inner-local-component-slice', true, false);
    expect(frontierMemo.getSliceStatistics()).toEqual({
      released: false,
      sliceComputations: 2,
      sliceEntries: 2,
      sliceHits: 0,
      sliceRequests: 2,
    });
    expect(sampledGetSliceStatistics).toHaveBeenCalledTimes(4);
    expect(sampledGetStatistics).toHaveBeenCalledTimes(4);
    const diagnosticsSnapshot = bundleDiagnostics.snapshot();
    expect(diagnosticsSnapshot).toMatchObject({
      authoredPathCheckCount: 3,
      authoredPathCheckMicros: 3,
      candidateSelectionMicros: 0,
      candidateSelectionSortCount: 0,
      edgeVisitCount: 0,
      frontierCount: 5,
      frontierFinalizeMicros: 15,
      frontierIdentityMicros: 5,
      inventoryComputationCount: 2,
      inventoryHitCount: 0,
      inventoryLookupMicros: 2,
      inventoryReadPathCacheHitCount: 0,
      inventoryReadRequestCount: 2,
      optionalClosureMicros: 0,
      optionalClosureProbeCount: 0,
      queueIterationCount: 3,
      queuePeakLength: 1,
      queueSortCount: 3,
      queueSortMicros: 3,
      rawSourceReadCount: 2,
      rawSourceReadMicros: 2,
      resolveModuleCount: 0,
      resolveModuleMicros: 0,
      sliceComputationCount: 2,
      sliceHitCount: 0,
      sliceLookupMicros: 2,
      sliceRequestCount: 2,
    });
    expect(diagnosticsSnapshot.sliceRequestCount).toBe(
      diagnosticsSnapshot.sliceComputationCount + diagnosticsSnapshot.sliceHitCount,
    );
    expect(diagnosticsSnapshot.inventoryRequestCount).toBe(
      diagnosticsSnapshot.inventoryComputationCount + diagnosticsSnapshot.inventoryHitCount,
    );

    const observerOffRealMemo = createPreviewInspectorBundleSourceInventoryMemo();
    const observerOffGetSliceStatistics = vi.fn(observerOffRealMemo.getSliceStatistics);
    const observerOffGetStatistics = vi.fn(observerOffRealMemo.getStatistics);
    const observerOffMemo: PreviewInspectorBundleSourceInventoryMemo = Object.freeze({
      ...observerOffRealMemo,
      getSliceStatistics: observerOffGetSliceStatistics,
      getStatistics: observerOffGetStatistics,
    });
    const baselineSourceReads: string[] = [];
    const baselineResolverCalls: string[] = [];
    const observerOffSourceReads: string[] = [];
    const observerOffResolverCalls: string[] = [];
    const observerOffBaseline = await prepareFrontier(
      'selected-export-slice',
      false,
      true,
      sampledMemo,
      false,
      baselineSourceReads,
      baselineResolverCalls,
    );
    const observerOffFrontier = await prepareFrontier(
      'selected-export-slice',
      true,
      true,
      observerOffMemo,
      false,
      observerOffSourceReads,
      observerOffResolverCalls,
    );
    expect(observerOffGetSliceStatistics).toHaveBeenCalledTimes(0);
    expect(observerOffGetStatistics).toHaveBeenCalledTimes(0);
    const observerOffSliceStatistics = observerOffRealMemo.getSliceStatistics();
    const observerOffInventoryStatistics = observerOffRealMemo.getStatistics();
    expect(observerOffSliceStatistics.sliceRequests).toBeGreaterThan(0);
    expect(observerOffInventoryStatistics.requests).toBeGreaterThan(0);
    expect(JSON.stringify(observerOffFrontier)).toBe(JSON.stringify(observerOffBaseline));
    expect(observerOffFrontier.frontier.identity).toBe(observerOffBaseline.frontier.identity);
    expect(observerOffFrontier.frontier.summary).toEqual(observerOffBaseline.frontier.summary);
    expect(observerOffFrontier.frontier.authenticSourcePaths).toEqual(
      observerOffBaseline.frontier.authenticSourcePaths,
    );
    expect(observerOffFrontier.frontier.exactSourcePaths).toEqual(
      observerOffBaseline.frontier.exactSourcePaths,
    );
    expect(observerOffFrontier.frontier.authenticComponentExports).toEqual(
      observerOffBaseline.frontier.authenticComponentExports,
    );
    expect(observerOffFrontier.frontier.sourceKinds).toEqual(
      observerOffBaseline.frontier.sourceKinds,
    );
    expect(observerOffFrontier.frontier.projectedEdges).toEqual(
      observerOffBaseline.frontier.projectedEdges,
    );
    expect(observerOffFrontier.frontier.summary.truncationReasons).toEqual(
      observerOffBaseline.frontier.summary.truncationReasons,
    );
    expect(observerOffSourceReads).toEqual(baselineSourceReads);
    expect(observerOffResolverCalls).toEqual(baselineResolverCalls);
    observerOffMemo.release();
    expect(observerOffRealMemo.getSliceStatistics().released).toBe(true);
    expect(observerOffRealMemo.getStatistics().released).toBe(true);

    frontierMemo.release();
    expect(frontierMemo.getSliceStatistics()).toEqual({
      released: true,
      sliceComputations: 2,
      sliceEntries: 0,
      sliceHits: 0,
      sliceRequests: 2,
    });

    memo.collect(sourcePath, sourceText);
    expect(memo.getStatistics()).toEqual({
      computations: 1,
      entries: 1,
      hits: 0,
      released: false,
      requests: 1,
    });
    memo.release();
    expect(memo.getStatistics()).toEqual({
      computations: 1,
      entries: 0,
      hits: 0,
      released: true,
      requests: 1,
    });
    expect(memo.getSliceStatistics()).toEqual({
      released: true,
      sliceComputations: 10,
      sliceEntries: 0,
      sliceHits: 3,
      sliceRequests: 13,
    });
    expect(() => memo.collect(sourcePath, sourceText)).toThrow('memo was already released');
    expect(() => memo.collectSelectedExportSlice(sourcePath, sourceText, 'Inner')).toThrow(
      'memo was already released',
    );
  });

  it('reuses only exact path-and-text source inventories and releases every retained entry', async () => {
    const workspaceRoot = '/workspace';
    const targetPath = '/workspace/Target.tsx';
    const changedPath = '/workspace/ChangedTarget.tsx';
    const helperPath = '/workspace/helper.ts';
    const sourceText = "import { helper } from './helper'; export const Target = () => helper;";
    const changedSourceText = `${sourceText}\nexport const changed = true;`;
    const sources = new Map<string, string>([
      [targetPath, sourceText],
      [changedPath, sourceText],
      [helperPath, 'export const helper = null;'],
    ]);
    const policy = createPreviewCompilerFrontierPolicy('fast');
    if (policy === undefined) throw new Error('Expected the automatic fast frontier policy.');
    const memo = createPreviewInspectorBundleSourceInventoryMemo();
    const createPlan = (sourcePath: string): PreviewInspectorAncestorPlan =>
      ({
        edges: [],
        pageCandidates: [],
        root: { exportName: 'Target', sourcePath },
        target: { exportName: 'Target', sourcePath },
      }) as unknown as PreviewInspectorAncestorPlan;
    const run = (
      sourcePath: string,
      sourceInventoryMemo = memo,
    ): ReturnType<typeof preparePreviewInspectorBundleFrontier> =>
      preparePreviewInspectorBundleFrontier({
        plan: createPlan(sourcePath),
        policy,
        readSource: (requestedPath) => Promise.resolve(sources.get(requestedPath)),
        resolveModule: (specifier, importer) =>
          specifier === './helper' && importer === sourcePath ? helperPath : undefined,
        sourceInventoryMemo,
        workspaceRoot,
      });
    const runWithoutMemo = (
      sourcePath: string,
    ): ReturnType<typeof preparePreviewInspectorBundleFrontier> =>
      preparePreviewInspectorBundleFrontier({
        plan: createPlan(sourcePath),
        policy,
        readSource: (requestedPath) => Promise.resolve(sources.get(requestedPath)),
        resolveModule: (specifier, importer) =>
          specifier === './helper' && importer === sourcePath ? helperPath : undefined,
        workspaceRoot,
      });

    const first = await run(targetPath);
    expect(memo.getStatistics()).toEqual({
      computations: 2,
      entries: 2,
      hits: 0,
      released: false,
      requests: 2,
    });
    const second = await run(targetPath);
    expect(JSON.stringify(second)).toBe(JSON.stringify(first));
    expect(JSON.stringify(first)).toBe(JSON.stringify(await runWithoutMemo(targetPath)));
    expect(memo.getStatistics()).toEqual({
      computations: 2,
      entries: 2,
      hits: 2,
      released: false,
      requests: 4,
    });

    sources.set(targetPath, changedSourceText);
    const changedText = await run(targetPath);
    expect(JSON.stringify(changedText)).toBe(JSON.stringify(await runWithoutMemo(targetPath)));
    expect(memo.getStatistics()).toEqual({
      computations: 3,
      entries: 3,
      hits: 3,
      released: false,
      requests: 6,
    });

    const changedPathResult = await run(changedPath);
    expect(JSON.stringify(changedPathResult)).toBe(
      JSON.stringify(await runWithoutMemo(changedPath)),
    );
    expect(memo.getStatistics()).toEqual({
      computations: 4,
      entries: 4,
      hits: 4,
      released: false,
      requests: 8,
    });
    expect(changedPathResult.frontier.authenticSourcePaths).toContain(changedPath);

    memo.release();
    expect(memo.getStatistics()).toEqual({
      computations: 4,
      entries: 0,
      hits: 4,
      released: true,
      requests: 8,
    });
    await expect(run(changedPath)).rejects.toThrow('memo was already released');
  });

  it('keeps unreadable and multiple-surface failures ahead of slice memo lookup', async () => {
    const sourcePath = '/workspace/Target.tsx';
    const policy = createPreviewCompilerFrontierPolicy('fast');
    if (policy === undefined) throw new Error('Expected the automatic fast frontier policy.');
    const memo = createPreviewInspectorBundleSourceInventoryMemo();
    const plan = {
      edges: [],
      pageCandidates: [],
      root: { exportName: 'Missing', sourcePath },
      target: { exportName: 'Missing', sourcePath },
    } as unknown as PreviewInspectorAncestorPlan;
    let reads = 0;
    const run = (
      sourceText: string | undefined,
      slicedSurfaceCount: number,
    ): ReturnType<typeof preparePreviewInspectorBundleFrontier> =>
      preparePreviewInspectorBundleFrontier({
        ...(slicedSurfaceCount > 0
          ? {
              executionCandidate: {
                browserCandidate: { id: 'selected' },
                compositionEdges: [],
                criticalSurfaces: Array.from({ length: slicedSurfaceCount }, (_, index) => ({
                  bypassedWrapperNames: [],
                  exportName: `Missing${index.toString()}`,
                  id: `missing-${index.toString()}`,
                  omittedTopLevelEffectCount: 0,
                  sourcePath,
                  strategy: 'selected-export-slice',
                  watchSourcePaths: [sourcePath],
                })),
                evidenceSourcePaths: [],
                fidelity: 'target-only',
                id: 'missing-slice',
                optionalSurfaces: [],
                watchSourcePaths: [sourcePath],
              } as unknown as PreviewInspectorPageExecutionCandidate,
            }
          : {}),
        plan,
        policy,
        readSource: () => {
          reads += 1;
          return Promise.resolve(sourceText);
        },
        resolveModule: () => undefined,
        sourceInventoryMemo: memo,
        workspaceRoot: '/workspace',
      });

    await expect(run(undefined, 0)).resolves.toMatchObject({
      frontier: { summary: { truncationReasons: ['exact-source-unreadable'] } },
      rejected: true,
    });
    await expect(run(undefined, 0)).resolves.toMatchObject({
      frontier: { summary: { truncationReasons: ['exact-source-unreadable'] } },
      rejected: true,
    });
    await expect(run('export const Other = null;', 2)).resolves.toMatchObject({
      frontier: { summary: { truncationReasons: ['slice-unavailable'] } },
      rejected: true,
    });
    await expect(run('export const Other = null;', 2)).resolves.toMatchObject({
      frontier: { summary: { truncationReasons: ['slice-unavailable'] } },
      rejected: true,
    });
    expect(memo.getSliceStatistics()).toEqual({
      released: false,
      sliceComputations: 0,
      sliceEntries: 0,
      sliceHits: 0,
      sliceRequests: 0,
    });
    await expect(run('export const Other = null;', 1)).resolves.toMatchObject({
      frontier: { summary: { truncationReasons: ['slice-unavailable'] } },
      rejected: true,
    });
    await expect(run('export const Other = null;', 1)).resolves.toMatchObject({
      frontier: { summary: { truncationReasons: ['slice-unavailable'] } },
      rejected: true,
    });
    expect(reads).toBe(6);
    expect(memo.getStatistics()).toEqual({
      computations: 0,
      entries: 0,
      hits: 0,
      released: false,
      requests: 0,
    });
    expect(memo.getSliceStatistics()).toEqual({
      released: false,
      sliceComputations: 1,
      sliceEntries: 1,
      sliceHits: 0,
      sliceRequests: 1,
    });
  });
});
