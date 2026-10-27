/** Covers representations behavior for previewInspectorBundleFrontier. */
/** Verifies authored-source previewInspectorBundleFrontier invariants. */

import { describe, expect, it, vi } from 'vitest';

import { createPreviewCompilerFrontierPolicy } from '../../../../src/domain/previewCompilerFrontier';

import {
  createPreviewInspectorBundleSourceInventoryMemo,
  preparePreviewInspectorBundleFrontier,
} from '../../../../src/adapters/esbuild/inspector/previewInspectorBundleFrontier';

import {
  collectPreviewInspectorBundleOptionalClosure,
  type PreviewInspectorBundleResolvedSourceNode,
  type PreviewInspectorBundleResolvedStaticEdge,
} from '../../../../src/adapters/esbuild/inspector/previewInspectorBundleSourceInventoryMemo';

import type { PreviewInspectorAncestorPlan } from '../../../../src/adapters/esbuild/inspector/previewInspectorAncestorPlan';

import type { PreviewInspectorPageExecutionCandidate } from '../../../../src/adapters/esbuild/inspector/previewInspectorPageExecutionTypes';

describe('preparePreviewInspectorBundleFrontier', () => {
  it('isolates authentic, selected, local-wrapper, and multi-slice resolved representations', async () => {
    const sourcePath = '/workspace/Page.tsx';
    const sourceText = [
      'const Inner = () => null;',
      'const Other = () => null;',
      'export const Page = Inner;',
      'export const OtherPage = Other;',
    ].join('\n');
    const policy = createPreviewCompilerFrontierPolicy('fast');
    if (policy === undefined) throw new Error('Expected the automatic fast frontier policy.');
    const memo = createPreviewInspectorBundleSourceInventoryMemo();
    let reads = 0;
    const surface = (
      id: string,
      exportName: string,
      strategy: 'authentic-module-export' | 'inner-local-component-slice' | 'selected-export-slice',
      localName?: string,
      preservedWrapperKinds: readonly ('forward-ref' | 'memo' | 'styled')[] = [],
    ): PreviewInspectorPageExecutionCandidate['criticalSurfaces'][number] => ({
      bypassedWrapperNames: [],
      exportName,
      id,
      ...(localName === undefined ? {} : { localName }),
      omittedTopLevelEffectCount: 0,
      preservedWrapperKinds,
      sourcePath,
      strategy,
      watchSourcePaths: [sourcePath],
    });
    const shapes = [
      [surface('authentic', 'Page', 'authentic-module-export')],
      [surface('selected-page', 'Page', 'selected-export-slice')],
      [surface('selected-other', 'OtherPage', 'selected-export-slice')],
      [surface('local', 'Page', 'inner-local-component-slice', 'Inner')],
      [
        surface('local-wrappers', 'Page', 'inner-local-component-slice', 'Inner', [
          'memo',
          'styled',
        ]),
      ],
      [
        surface('local-reordered', 'Page', 'inner-local-component-slice', 'Inner', [
          'styled',
          'memo',
        ]),
      ],
      [
        surface('multi-page', 'Page', 'selected-export-slice'),
        surface('multi-other', 'OtherPage', 'selected-export-slice'),
      ],
    ] as const;
    const results = [];
    for (const [index, criticalSurfaces] of shapes.entries()) {
      results.push(
        await preparePreviewInspectorBundleFrontier({
          executionCandidate: {
            browserCandidate: { id: 'browser' },
            compositionEdges: [],
            criticalSurfaces,
            evidenceSourcePaths: [],
            fidelity: 'page-sliced',
            id: `representation-${index.toString()}`,
            optionalSurfaces: [],
            watchSourcePaths: [sourcePath],
          } as never,
          plan: {
            edges: [],
            pageCandidates: [],
            root: { exportName: 'Page', sourcePath },
            target: { exportName: 'Page', sourcePath },
          } as never,
          policy,
          readSource: () => {
            reads += 1;
            return Promise.resolve(sourceText);
          },
          resolveModule: () => undefined,
          sourceInventoryMemo: memo,
          workspaceRoot: '/workspace',
        }),
      );
    }
    expect(reads).toBe(shapes.length);
    expect(results.slice(0, -1).every((result) => !result.rejected)).toBe(true);
    expect(results.at(-1)).toMatchObject({
      frontier: { summary: { truncationReasons: ['slice-unavailable'] } },
      rejected: true,
    });
    expect(memo.getGraphStatistics()).toMatchObject({
      resolvedNodeComputations: shapes.length,
      resolvedNodeEntries: shapes.length,
      resolvedNodeHits: 0,
      resolvedNodeRequests: shapes.length,
    });
    expect(memo.getSliceStatistics()).toMatchObject({
      sliceComputations: 5,
      sliceEntries: 5,
      sliceHits: 0,
      sliceRequests: 5,
    });
  });

  it('keeps a cached structural failure invisible behind the current relevant blocker', async () => {
    const rootPath = '/workspace/Root.ts';
    const blockerPath = '/workspace/Blocker.ts';
    const failedPath = '/workspace/Failed.ts';
    const edge = (identity: string, targetPath: string): PreviewInspectorBundleResolvedStaticEdge =>
      Object.freeze({ identity, kind: 'authored' as const, targetPath });
    const nodes = new Map<string, PreviewInspectorBundleResolvedSourceNode>([
      [
        rootPath,
        Object.freeze({
          byteLength: 1,
          edges: Object.freeze([]),
          representationKey: rootPath,
          sourcePath: rootPath,
          staticEdges: Object.freeze([edge('root-blocker', blockerPath)]),
        }),
      ],
      [
        blockerPath,
        Object.freeze({
          byteLength: 1,
          edges: Object.freeze([]),
          representationKey: blockerPath,
          sourcePath: blockerPath,
          staticEdges: Object.freeze([edge('blocker-failed', failedPath)]),
        }),
      ],
      [
        failedPath,
        Object.freeze({
          byteLength: 0,
          edges: Object.freeze([]),
          failure: 'exact-source-unreadable' as const,
          representationKey: failedPath,
          sourcePath: failedPath,
          staticEdges: Object.freeze([]),
        }),
      ],
    ]);
    const memo = createPreviewInspectorBundleSourceInventoryMemo();
    const readNode = vi.fn(
      (sourcePath: string): Promise<PreviewInspectorBundleResolvedSourceNode> => {
        const node = nodes.get(sourcePath);
        return node === undefined
          ? Promise.reject(new Error(`Missing node fixture: ${sourcePath}`))
          : Promise.resolve(node);
      },
    );
    const collect = (
      blockedSourcePaths: ReadonlySet<string>,
    ): ReturnType<typeof collectPreviewInspectorBundleOptionalClosure> =>
      collectPreviewInspectorBundleOptionalClosure({
        blockedSourcePaths,
        diagnostics: undefined,
        getRepresentationKey: (sourcePath) => sourcePath,
        memo,
        pendingContextKey: 'context',
        readNode,
        rootPath,
      });
    const blocked = await collect(new Set([blockerPath]));
    expect(blocked.proposal).toEqual({
      authoredEdgeCount: 1,
      packageDemandPaths: [],
      sourceBytes: 1,
      sourcePaths: [rootPath],
      supportPaths: [],
    });
    expect(Object.isFrozen(blocked.graph)).toBe(true);
    expect(Object.isFrozen(blocked.proposal)).toBe(true);
    expect((await collect(new Set())).proposal).toBe('exact-source-unreadable');
    expect((await collect(new Set())).proposal).toBe('exact-source-unreadable');
    expect(readNode).toHaveBeenCalledTimes(3);
    expect(memo.getGraphStatistics()).toMatchObject({
      proposalComputations: 2,
      proposalEntries: 2,
      proposalHits: 1,
      proposalRequests: 3,
      rootedGraphComputations: 1,
      rootedGraphEntries: 1,
      rootedGraphHits: 2,
      rootedGraphRequests: 3,
    });
  });

  it('coalesces pending closure work, retries errors, and cannot publish after release', async () => {
    const memo = createPreviewInspectorBundleSourceInventoryMemo();
    const template = Object.freeze({ marker: 'template' });
    let continuePending!: () => void;
    const gate = new Promise<void>((resolve) => {
      continuePending = resolve;
    });
    let computations = 0;
    const compute = async (): Promise<never> => {
      computations += 1;
      await gate;
      return template as never;
    };
    const first = memo.collectSourceClosure('pending', compute);
    const second = memo.collectSourceClosure('pending', compute);
    expect(computations).toBe(1);
    expect(memo.getClosureStatistics()).toEqual({
      closureComputations: 1,
      closureEntries: 0,
      closureHits: 1,
      closureRequests: 2,
      released: false,
    });
    continuePending();
    expect(await second).toBe(await first);
    expect(memo.getClosureStatistics().closureEntries).toBe(1);

    let attempts = 0;
    await expect(
      memo.collectSourceClosure('retry', () => {
        attempts += 1;
        return Promise.reject(new Error('cancelled computation'));
      }),
    ).rejects.toThrow('cancelled computation');
    await expect(
      memo.collectSourceClosure('retry', () => {
        attempts += 1;
        return Promise.resolve(template as never);
      }),
    ).resolves.toBe(template);
    expect(attempts).toBe(2);
    expect(memo.getClosureStatistics()).toEqual({
      closureComputations: 3,
      closureEntries: 2,
      closureHits: 1,
      closureRequests: 4,
      released: false,
    });

    const releasedMemo = createPreviewInspectorBundleSourceInventoryMemo();
    let finishReleased!: () => void;
    const releasedGate = new Promise<void>((resolve) => {
      finishReleased = resolve;
    });
    const pending = releasedMemo.collectSourceClosure('released', async () => {
      await releasedGate;
      return template as never;
    });
    releasedMemo.release();
    releasedMemo.release();
    finishReleased();
    await expect(pending).resolves.toBe(template);
    expect(releasedMemo.getClosureStatistics()).toEqual({
      closureComputations: 1,
      closureEntries: 0,
      closureHits: 0,
      closureRequests: 1,
      released: true,
    });
    await expect(releasedMemo.collectSourceClosure('released', compute)).rejects.toThrow(
      'memo was already released',
    );
  });

  it('reuses a structural rejection but materializes each current candidate', async () => {
    const sourcePath = '/workspace/Missing.tsx';
    const policy = createPreviewCompilerFrontierPolicy('fast');
    if (policy === undefined) throw new Error('Expected the automatic fast frontier policy.');
    const memo = createPreviewInspectorBundleSourceInventoryMemo();
    let reads = 0;
    const run = (id: string): ReturnType<typeof preparePreviewInspectorBundleFrontier> =>
      preparePreviewInspectorBundleFrontier({
        executionCandidate: {
          browserCandidate: { id: 'browser' },
          compositionEdges: [],
          criticalSurfaces: [
            {
              bypassedWrapperNames: [],
              exportName: 'Missing',
              id: 'surface',
              omittedTopLevelEffectCount: 0,
              sourcePath,
              strategy: 'authentic-module-export',
              watchSourcePaths: [sourcePath],
            },
          ],
          evidenceSourcePaths: [],
          fidelity: 'target-only',
          id,
          optionalSurfaces: [],
          watchSourcePaths: [],
        } as never,
        plan: {
          edges: [],
          pageCandidates: [],
          root: { exportName: 'Missing', sourcePath },
          target: { exportName: 'Missing', sourcePath },
        } as never,
        policy,
        readSource: () => {
          reads += 1;
          return Promise.resolve(undefined);
        },
        resolveModule: () => undefined,
        sourceInventoryMemo: memo,
        workspaceRoot: '/workspace',
      });
    const first = await run('first-rejection');
    const second = await run('second-rejection');
    expect(first.rejected).toBe(true);
    expect(JSON.stringify(first.frontier.summary)).toBe(JSON.stringify(second.frontier.summary));
    expect(second.frontier.executionCandidateId).toBe('second-rejection');
    expect(second.frontier.identity).not.toBe(first.frontier.identity);
    expect(reads).toBe(1);
    expect(memo.getClosureStatistics()).toEqual({
      closureComputations: 1,
      closureEntries: 1,
      closureHits: 1,
      closureRequests: 2,
      released: false,
    });
  });

  it('shares an exact source parse failure without changing its rejection', async () => {
    const sourcePath = '/workspace/Target.tsx';
    const sourceText = 'export const Target = ;';
    const policy = createPreviewCompilerFrontierPolicy('fast');
    if (policy === undefined) throw new Error('Expected the automatic fast frontier policy.');
    const memo = createPreviewInspectorBundleSourceInventoryMemo();
    const run = (): ReturnType<typeof preparePreviewInspectorBundleFrontier> =>
      preparePreviewInspectorBundleFrontier({
        plan: {
          edges: [],
          pageCandidates: [],
          root: { exportName: 'Target', sourcePath },
          target: { exportName: 'Target', sourcePath },
        } as unknown as PreviewInspectorAncestorPlan,
        policy,
        readSource: () => Promise.resolve(sourceText),
        resolveModule: () => undefined,
        sourceInventoryMemo: memo,
        workspaceRoot: '/workspace',
      });

    const first = await run();
    const second = await run();
    expect(JSON.stringify(second)).toBe(JSON.stringify(first));
    expect(first).toMatchObject({
      frontier: { summary: { truncationReasons: ['source-parse-failure'] } },
      rejected: true,
    });
    expect(memo.getStatistics()).toEqual({
      computations: 1,
      entries: 1,
      hits: 1,
      released: false,
      requests: 2,
    });
  });
});
