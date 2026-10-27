/** Covers graphMemo behavior for previewInspectorBundleFrontier. */
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

describe('preparePreviewInspectorBundleFrontier', () => {
  it('keys v2 closure templates exactly while rebuilding candidate-specific identity', async () => {
    const workspaceRoot = '/workspace';
    const targetPath = '/workspace/Target.tsx';
    const pagePath = '/workspace/Page.tsx';
    const optionalPath = '/workspace/Optional.tsx';
    const runtimePath = '/workspace/runtime.ts';
    const sourceText =
      'const Inner = () => null; export const Target = Inner; export const Other = Inner;';
    const policy = createPreviewCompilerFrontierPolicy('fast');
    if (policy === undefined) throw new Error('Expected the automatic fast frontier policy.');
    const surface = (
      sourcePath: string,
      exportName: string,
      strategy: PreviewInspectorPageExecutionCandidate['criticalSurfaces'][number]['strategy'],
      overrides: Record<string, unknown> = {},
    ): PreviewInspectorPageExecutionCandidate['criticalSurfaces'][number] => ({
      bypassedWrapperNames: [],
      exportName,
      id: `${sourcePath}-${exportName}`,
      omittedTopLevelEffectCount: 0,
      sourcePath,
      strategy,
      watchSourcePaths: [sourcePath],
      ...overrides,
    });
    const baseCriticalSurfaces = [
      surface(targetPath, 'Target', 'selected-export-slice'),
      surface(pagePath, 'Other', 'authentic-module-export'),
    ];
    const pageSurface = baseCriticalSurfaces[1];
    if (pageSurface === undefined) throw new Error('Expected the page surface fixture.');
    const baseOptionalSurfaces = [surface(optionalPath, 'Other', 'selected-route-surface')];
    const candidate = (
      id: string,
      criticalSurfaces = baseCriticalSurfaces,
      optionalSurfaces = baseOptionalSurfaces,
      overrides: Record<string, unknown> = {},
    ): PreviewInspectorPageExecutionCandidate =>
      ({
        browserCandidate: { id: 'browser' },
        compositionEdges: [],
        criticalSurfaces,
        evidenceSourcePaths: [],
        executionRootContract: {
          exportName: 'Other',
          sourcePath: pagePath,
          surfaceId: 'page-root',
        },
        executionRootSurfaceId: 'page-root',
        fidelity: 'page-sliced',
        id,
        optionalSurfaces,
        routeRecipe: { kind: 'generic-memory-location', pathname: `/${id}` },
        runtimeTargetContract: {
          exportName: 'Target',
          sourcePath: targetPath,
          surfaceId: 'runtime-target',
        },
        runtimeTargetSurfaceId: 'runtime-target',
        watchSourcePaths: [],
        ...overrides,
      }) as unknown as PreviewInspectorPageExecutionCandidate;
    const basePlan = {
      edges: [],
      pageCandidates: [],
      root: { exportName: 'Other', sourcePath: pagePath },
      shallowVisualPaths: [
        {
          exportName: 'Other',
          importerPath: pagePath,
          moduleSpecifier: './Optional',
          occurrenceStart: 1,
          relation: 'jsx-child',
          sourcePath: optionalPath,
        },
      ],
      target: { exportName: 'Target', sourcePath: targetPath },
    } as unknown as PreviewInspectorAncestorPlan;
    const memo = createPreviewInspectorBundleSourceInventoryMemo();
    const run = (
      executionCandidate: PreviewInspectorPageExecutionCandidate,
      overrides: Partial<Parameters<typeof preparePreviewInspectorBundleFrontier>[0]> = {},
      sourceInventoryMemo: PreviewInspectorBundleSourceInventoryMemo | false = memo,
    ): ReturnType<typeof preparePreviewInspectorBundleFrontier> =>
      preparePreviewInspectorBundleFrontier({
        executionCandidate,
        plan: basePlan,
        policy,
        readSource: () => Promise.resolve(sourceText),
        resolveModule: () => undefined,
        runtimeCompanionSourcePaths: [runtimePath],
        ...(sourceInventoryMemo === false ? {} : { sourceInventoryMemo }),
        workspaceRoot,
        ...overrides,
      });

    const firstCandidate = candidate('first');
    const identityOnlyCritical = baseCriticalSurfaces.map((item) => ({
      ...item,
      bypassedWrapperNames: ['changed'],
      id: `${item.id}-changed`,
      omittedTopLevelEffectCount: 99,
      watchSourcePaths: ['/workspace/changed-watch.ts'],
    }));
    const identityOnlyOptional = baseOptionalSurfaces.map((item) => ({
      ...item,
      id: `${item.id}-changed`,
      watchSourcePaths: ['/workspace/changed-optional-watch.ts'],
    }));
    const secondCandidate = candidate('second', identityOnlyCritical, identityOnlyOptional, {
      browserCandidate: { id: 'changed-browser' },
      compositionEdges: [{ id: 'changed-edge' }],
      evidenceSourcePaths: ['/workspace/evidence.ts'],
      executionRootContract: {
        exportName: 'ContractOnly',
        sourcePath: '/workspace/contract.ts',
        surfaceId: 'changed-root',
      },
      executionRootSurfaceId: 'changed-root',
      fidelity: 'target-only',
      runtimeTargetContract: {
        exportName: 'ContractOnly',
        sourcePath: '/workspace/contract.ts',
        surfaceId: 'changed-target',
      },
      runtimeTargetSurfaceId: 'changed-target',
      watchSourcePaths: ['/workspace/watch.ts'],
    });
    const first = await run(firstCandidate);
    const changedPolicy = { ...policy, mode: 'corridor' } as const;
    const secondUncached = await run(secondCandidate, { policy: changedPolicy }, false);
    const second = await run(secondCandidate, { policy: changedPolicy });
    expect(JSON.stringify(second)).toBe(JSON.stringify(secondUncached));
    expect(second.frontier.executionCandidateId).toBe('second');
    expect(second.frontier.identity).not.toBe(first.frontier.identity);
    expect(memo.getClosureStatistics()).toEqual({
      closureComputations: 1,
      closureEntries: 1,
      closureHits: 1,
      closureRequests: 2,
      released: false,
    });
    for (const value of [
      second.frontier,
      second.frontier.summary,
      second.frontier.authenticSourcePaths,
      second.frontier.exactSourcePaths,
      second.frontier.packageDemandSourcePaths,
      second.frontier.projectedEdges,
      second.frontier.sourceKinds,
    ])
      expect(Object.isFrozen(value)).toBe(true);

    await run(candidate('reordered', [...baseCriticalSurfaces].reverse()));
    const misses: Parameters<typeof run>[] = [
      [
        candidate('shallow-export-and-occurrence'),
        {
          plan: {
            ...basePlan,
            shallowVisualPaths: [
              { ...basePlan.shallowVisualPaths?.[0], exportName: 'Target', occurrenceStart: 99 },
            ],
          } as never,
        },
      ],
      [candidate('workspace'), { workspaceRoot: '/' }],
      [candidate('runtime'), { runtimeCompanionSourcePaths: ['/workspace/runtime-2.ts'] }],
      [
        candidate('critical-path', [
          surface('/workspace/Other.tsx', 'Target', 'selected-export-slice'),
          pageSurface,
        ]),
      ],
      [
        candidate('critical-export', [
          surface(targetPath, 'Other', 'selected-export-slice'),
          pageSurface,
        ]),
      ],
      [
        candidate('critical-strategy', [
          surface(targetPath, 'Target', 'authentic-module-export'),
          pageSurface,
        ]),
      ],
      [
        candidate('critical-local', [
          surface(targetPath, 'Target', 'selected-export-slice', { localName: 'Inner' }),
          pageSurface,
        ]),
      ],
      [
        candidate('critical-wrappers', [
          surface(targetPath, 'Target', 'selected-export-slice', {
            preservedWrapperKinds: ['memo'],
          }),
          pageSurface,
        ]),
      ],
      [
        candidate('optional-path', baseCriticalSurfaces, [
          surface('/workspace/Optional2.tsx', 'Other', 'selected-route-surface'),
        ]),
      ],
      [
        candidate('optional-export', baseCriticalSurfaces, [
          surface(optionalPath, 'Target', 'selected-route-surface'),
        ]),
      ],
      [
        candidate('optional-strategy', baseCriticalSurfaces, [
          surface(optionalPath, 'Other', 'authentic-module-export'),
        ]),
      ],
      [
        candidate('shallow-importer'),
        {
          plan: {
            ...basePlan,
            shallowVisualPaths: [{ ...basePlan.shallowVisualPaths?.[0], importerPath: targetPath }],
          } as never,
        },
      ],
      [
        candidate('shallow-source'),
        {
          plan: {
            ...basePlan,
            shallowVisualPaths: [{ ...basePlan.shallowVisualPaths?.[0], sourcePath: targetPath }],
          } as never,
        },
      ],
      [candidate('critical-multiset', [...baseCriticalSurfaces, pageSurface])],
    ];
    for (const arguments_ of misses) await run(...arguments_);
    expect(memo.getClosureStatistics()).toEqual({
      closureComputations: 15,
      closureEntries: 15,
      closureHits: 2,
      closureRequests: 17,
      released: false,
    });
  });

  it('reuses rooted graphs, blocker-sensitive proposals, nodes, and dynamic resolutions across closure misses', async () => {
    const workspaceRoot = '/workspace';
    const routeAPath = '/workspace/RouteA.tsx';
    const routeCPath = '/workspace/RouteC.tsx';
    const optionalPath = '/workspace/Optional.tsx';
    const leftPath = '/workspace/Left.ts';
    const rightPath = '/workspace/Right.ts';
    const sharedPath = '/workspace/Shared.ts';
    const dynamicPath = '/workspace/Dynamic.tsx';
    const sources = new Map<string, string>([
      [routeAPath, 'export const RouteA = () => null;'],
      [routeCPath, 'export const RouteC = () => null;'],
      [
        optionalPath,
        [
          "import './Left';",
          "import './Right';",
          "void import('./Dynamic');",
          'export const Optional = () => null;',
        ].join('\n'),
      ],
      [leftPath, "import './Shared'; import 'large-package'; export const left = true;"],
      [rightPath, "import './Shared'; export const right = true;"],
      [sharedPath, 'export const shared = true;'],
      [dynamicPath, "import './Shared'; export default function Dynamic() { return null; }"],
    ]);
    const resolutions = new Map<string, string>([
      [`${optionalPath}\0./Left`, leftPath],
      [`${optionalPath}\0./Right`, rightPath],
      [`${optionalPath}\0./Dynamic`, dynamicPath],
      [`${leftPath}\0./Shared`, sharedPath],
      [`${rightPath}\0./Shared`, sharedPath],
      [`${dynamicPath}\0./Shared`, sharedPath],
    ]);
    const policy = createPreviewCompilerFrontierPolicy('fast');
    if (policy === undefined) throw new Error('Expected the automatic fast frontier policy.');
    const memo = createPreviewInspectorBundleSourceInventoryMemo();
    const cachedReads: string[] = [];
    const cachedResolutions: string[] = [];
    const candidate = (
      id: string,
      exactPath: string,
      exportName: string,
    ): PreviewInspectorPageExecutionCandidate =>
      ({
        browserCandidate: { id: 'browser' },
        compositionEdges: [],
        criticalSurfaces: [
          {
            bypassedWrapperNames: [],
            exportName,
            id: `${id}-critical`,
            omittedTopLevelEffectCount: 0,
            sourcePath: exactPath,
            strategy: 'authentic-module-export',
            watchSourcePaths: [exactPath],
          },
        ],
        evidenceSourcePaths: [],
        fidelity: 'target-contextual',
        id,
        optionalSurfaces: [
          {
            bypassedWrapperNames: [],
            exportName: 'Optional',
            id: `${id}-optional`,
            omittedTopLevelEffectCount: 0,
            sourcePath: optionalPath,
            strategy: 'selected-route-surface',
            watchSourcePaths: [optionalPath],
          },
        ],
        watchSourcePaths: [exactPath, optionalPath],
      }) as never;
    const run = (
      id: string,
      exactPath: string,
      exportName: string,
      sourceInventoryMemo: PreviewInspectorBundleSourceInventoryMemo | false,
      bundleDiagnostics?: ReturnType<typeof createPreviewInspectorBundleDiagnosticsCollector>,
    ): ReturnType<typeof preparePreviewInspectorBundleFrontier> =>
      preparePreviewInspectorBundleFrontier({
        executionCandidate: candidate(id, exactPath, exportName),
        plan: {
          edges: [],
          pageCandidates: [],
          root: { exportName, sourcePath: exactPath },
          target: { exportName, sourcePath: exactPath },
        } as never,
        policy,
        readSource: (sourcePath) => {
          if (sourceInventoryMemo !== false) cachedReads.push(sourcePath);
          return Promise.resolve(sources.get(sourcePath));
        },
        resolveModule: (specifier, importer) => {
          if (sourceInventoryMemo !== false) cachedResolutions.push(`${importer}\0${specifier}`);
          return resolutions.get(`${importer}\0${specifier}`);
        },
        ...(bundleDiagnostics === undefined ? {} : { bundleDiagnostics }),
        ...(sourceInventoryMemo === false ? {} : { sourceInventoryMemo }),
        workspaceRoot,
      });
    const routes = [
      ['route-a', routeAPath, 'RouteA'],
      ['route-blocking-shared', sharedPath, 'shared'],
      ['route-c', routeCPath, 'RouteC'],
    ] as const;
    const diagnostics = createPreviewInspectorBundleDiagnosticsCollector(true);
    if (diagnostics === undefined) throw new Error('Expected bundle diagnostics.');
    const cached = [];
    for (const [index, [id, exactPath, exportName]] of routes.entries()) {
      const uncached = await run(id, exactPath, exportName, false);
      const result = await run(
        id,
        exactPath,
        exportName,
        memo,
        index === routes.length - 1 ? diagnostics : undefined,
      );
      expect(JSON.stringify(result)).toBe(JSON.stringify(uncached));
      cached.push(result);
    }
    expect(new Set(cached.map((result) => result.frontier.identity)).size).toBe(3);
    expect(cached[0]?.frontier.sourceKinds?.[sharedPath]).toBe('optional-support');
    expect(cached[1]?.frontier.sourceKinds?.[sharedPath]).toBe('critical-surface');
    expect(cached[2]?.frontier.sourceKinds?.[sharedPath]).toBe('optional-support');
    expect(cached[0]?.frontier.packageDemandSourcePaths).toEqual([leftPath]);
    expect(cachedReads).toEqual([
      routeAPath,
      optionalPath,
      leftPath,
      rightPath,
      sharedPath,
      dynamicPath,
      routeCPath,
    ]);
    expect(cachedResolutions).toHaveLength(7);
    expect(memo.getClosureStatistics()).toEqual({
      closureComputations: 3,
      closureEntries: 3,
      closureHits: 0,
      closureRequests: 3,
      released: false,
    });
    expect(memo.getGraphStatistics()).toEqual({
      dynamicResolutionComputations: 1,
      dynamicResolutionEntries: 1,
      dynamicResolutionHits: 2,
      dynamicResolutionRequests: 3,
      proposalComputations: 3,
      proposalEntries: 3,
      proposalHits: 3,
      proposalRequests: 6,
      released: false,
      resolvedNodeComputations: 7,
      resolvedNodeEntries: 7,
      resolvedNodeHits: 1,
      resolvedNodeRequests: 8,
      rootedGraphComputations: 2,
      rootedGraphEntries: 2,
      rootedGraphHits: 4,
      rootedGraphRequests: 6,
    });
    expect(diagnostics.snapshot()).toMatchObject({
      edgeVisitCount: 0,
      frontierCount: 1,
      inventoryComputationCount: 1,
      inventoryReadRequestCount: 1,
      optionalClosureProbeCount: 2,
      rawSourceReadCount: 1,
      resolveModuleCount: 0,
    });
  });

  it('coalesces and retries every graph cache layer and blocks late publication after release', async () => {
    const memo = createPreviewInspectorBundleSourceInventoryMemo();
    const node = Object.freeze({
      byteLength: 1,
      edges: Object.freeze([]),
      representationKey: 'node-representation',
      sourcePath: '/workspace/Node.ts',
      staticEdges: Object.freeze([]),
    });
    const graph = Object.freeze({
      entries: Object.freeze([
        Object.freeze({
          node,
          representationKey: node.representationKey,
          sourcePath: node.sourcePath,
        }),
      ]),
      identity: 'rooted-graph',
      reachableSourcePaths: Object.freeze([node.sourcePath]),
      rootRepresentationKey: node.representationKey,
      rootSourcePath: node.sourcePath,
    });
    const proposal = Object.freeze({
      authoredEdgeCount: 0,
      packageDemandPaths: Object.freeze([]),
      sourceBytes: 1,
      sourcePaths: Object.freeze([node.sourcePath]),
      supportPaths: Object.freeze([]),
    });
    let continuePending!: () => void;
    const gate = new Promise<void>((resolve) => {
      continuePending = resolve;
    });
    const nodeCompute = vi.fn(async () => {
      await gate;
      return node;
    });
    const firstNode = memo.collectResolvedSourceNode('node', nodeCompute);
    const secondNode = memo.collectResolvedSourceNode('node', nodeCompute);
    const firstGraph = memo.collectRootedOptionalGraph(
      'root',
      'context',
      () => true,
      async () => {
        await gate;
        return graph;
      },
    );
    const secondGraph = memo.collectRootedOptionalGraph(
      'root',
      'context',
      () => true,
      () => Promise.resolve(graph),
    );
    const firstProposal = memo.collectOptionalProposal('proposal', async () => {
      await gate;
      return proposal;
    });
    const secondProposal = memo.collectOptionalProposal('proposal', () =>
      Promise.resolve(proposal),
    );
    continuePending();
    expect(await secondNode).toBe(await firstNode);
    expect(await secondGraph).toBe(await firstGraph);
    expect(await secondProposal).toBe(await firstProposal);
    expect(nodeCompute).toHaveBeenCalledTimes(1);

    await expect(
      memo.collectResolvedSourceNode('retry-node', () =>
        Promise.reject(new Error('node-cancelled')),
      ),
    ).rejects.toThrow('node-cancelled');
    await expect(
      memo.collectResolvedSourceNode('retry-node', () => Promise.resolve(node)),
    ).resolves.toBe(node);
    await expect(
      memo.collectRootedOptionalGraph(
        'retry-root',
        'context',
        () => true,
        () => Promise.reject(new Error('graph-cancelled')),
      ),
    ).rejects.toThrow('graph-cancelled');
    await expect(
      memo.collectRootedOptionalGraph(
        'retry-root',
        'context',
        () => true,
        () => Promise.resolve(graph),
      ),
    ).resolves.toBe(graph);
    await expect(
      memo.collectOptionalProposal('retry-proposal', () =>
        Promise.reject(new Error('proposal-cancelled')),
      ),
    ).rejects.toThrow('proposal-cancelled');
    await expect(
      memo.collectOptionalProposal('retry-proposal', () => Promise.resolve(proposal)),
    ).resolves.toBe(proposal);
    expect(
      memo.collectDynamicResolution('dynamic', () => ({ targetPath: node.sourcePath })),
    ).toEqual({ targetPath: node.sourcePath });
    expect(memo.collectDynamicResolution('dynamic', () => ({}))).toEqual({
      targetPath: node.sourcePath,
    });
    expect(memo.getGraphStatistics()).toEqual({
      dynamicResolutionComputations: 1,
      dynamicResolutionEntries: 1,
      dynamicResolutionHits: 1,
      dynamicResolutionRequests: 2,
      proposalComputations: 3,
      proposalEntries: 2,
      proposalHits: 1,
      proposalRequests: 4,
      released: false,
      resolvedNodeComputations: 3,
      resolvedNodeEntries: 2,
      resolvedNodeHits: 1,
      resolvedNodeRequests: 4,
      rootedGraphComputations: 3,
      rootedGraphEntries: 2,
      rootedGraphHits: 1,
      rootedGraphRequests: 4,
    });

    const releasedMemo = createPreviewInspectorBundleSourceInventoryMemo();
    let finishReleased!: () => void;
    const releasedGate = new Promise<void>((resolve) => {
      finishReleased = resolve;
    });
    const pendingNode = releasedMemo.collectResolvedSourceNode('late-node', async () => {
      await releasedGate;
      return node;
    });
    const pendingGraph = releasedMemo.collectRootedOptionalGraph(
      'late-root',
      'context',
      () => true,
      async () => {
        await releasedGate;
        return graph;
      },
    );
    const pendingProposal = releasedMemo.collectOptionalProposal('late-proposal', async () => {
      await releasedGate;
      return proposal;
    });
    releasedMemo.release();
    releasedMemo.release();
    finishReleased();
    await expect(pendingNode).resolves.toBe(node);
    await expect(pendingGraph).resolves.toBe(graph);
    await expect(pendingProposal).resolves.toBe(proposal);
    expect(releasedMemo.getGraphStatistics()).toMatchObject({
      dynamicResolutionEntries: 0,
      proposalEntries: 0,
      released: true,
      resolvedNodeEntries: 0,
      rootedGraphEntries: 0,
    });
    await expect(
      releasedMemo.collectResolvedSourceNode('after-release', () => Promise.resolve(node)),
    ).rejects.toThrow('memo was already released');
    expect(() => releasedMemo.collectDynamicResolution('after-release', () => ({}))).toThrow(
      'memo was already released',
    );
  });
});
