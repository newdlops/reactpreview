/** Owns request-local source analysis and successful Page Execution closure reuse. */
import path from 'node:path';
import ts from 'typescript';
import {
  createPreviewInspectorLocalComponentSlice,
  createPreviewInspectorSelectedExportSlice,
  type PreviewInspectorMountSurfaceSliceResult,
} from './previewInspectorMountSurfaceSlice';
import { collectPreviewInspectorRuntimeImportInventory } from './previewInspectorRuntimeImportInventory';
import type { PreviewInspectorBundleDiagnosticsCollector } from './previewInspectorBundleDiagnostics';
import { createPreviewInspectorStableMinPriorityQueue } from './previewInspectorStableMinPriorityQueue';
import type {
  PreviewInspectorBundleFrontier,
  PreviewInspectorRuntimeImportEdge,
} from './previewInspectorBundleFrontierTypes';

export interface PreviewInspectorBundleMemoizedSourceInventory {
  readonly byteLength: number;
  readonly edges: readonly PreviewInspectorRuntimeImportEdge[];
}

export type PreviewInspectorBundleSourceInventoryResult =
  PreviewInspectorBundleMemoizedSourceInventory | 'source-parse-failure';

export type PreviewInspectorBundleSourceClosureTemplate = Readonly<
  Pick<
    PreviewInspectorBundleFrontier,
    | 'authenticComponentExports'
    | 'authenticSourcePaths'
    | 'exactSourcePaths'
    | 'packageDemandSourcePaths'
    | 'projectedEdges'
    | 'summary'
  > & {
    readonly rejected: boolean;
    readonly sourceKinds: NonNullable<PreviewInspectorBundleFrontier['sourceKinds']>;
  }
>;

export type PreviewInspectorBundleResolvedNodeFailure =
  'exact-source-unreadable' | 'slice-unavailable' | 'source-parse-failure';

export interface PreviewInspectorBundleResolvedStaticEdge {
  /** Authored module loaded behind a compiler-generated runtime boundary such as theme discovery. */
  readonly compilerGeneratedSupport?: true;
  readonly identity: string;
  readonly importedNames?: readonly string[];
  readonly kind: 'authored' | 'package-demand';
  readonly moduleSpecifier?: string;
  readonly occurrenceStart?: number;
  /** Present only when the runtime plugin can synthesize this exact import without a guard escape. */
  readonly projection?: {
    readonly exportNames: readonly string[];
    readonly moduleSpecifier: string;
    readonly neutralRouteBasePath?: string;
    readonly occurrenceStart: number;
    readonly runtimeHookExportNames: readonly string[];
  };
  readonly targetPath?: string;
}

export interface PreviewInspectorBundleResolvedSourceNode {
  readonly byteLength: number;
  readonly edges: readonly PreviewInspectorRuntimeImportEdge[];
  readonly failure?: PreviewInspectorBundleResolvedNodeFailure;
  readonly representationKey: string;
  readonly sourcePath: string;
  readonly staticEdges: readonly PreviewInspectorBundleResolvedStaticEdge[];
}

export interface PreviewInspectorBundleRootedOptionalGraphEntry {
  readonly node: PreviewInspectorBundleResolvedSourceNode;
  readonly representationKey: string;
  readonly sourcePath: string;
}

export interface PreviewInspectorBundleRootedOptionalGraph {
  readonly entries: readonly PreviewInspectorBundleRootedOptionalGraphEntry[];
  readonly identity: string;
  readonly reachableSourcePaths: readonly string[];
  readonly rootRepresentationKey: string;
  readonly rootSourcePath: string;
}

export interface PreviewInspectorBundleOptionalProposal {
  readonly authoredEdgeCount: number;
  readonly packageDemandPaths: readonly string[];
  readonly sourceBytes: number;
  readonly sourcePaths: readonly string[];
  readonly supportPaths: readonly string[];
}

export type PreviewInspectorBundleOptionalProposalResult =
  PreviewInspectorBundleOptionalProposal | PreviewInspectorBundleResolvedNodeFailure;

export interface PreviewInspectorBundleCollectedOptionalClosure {
  readonly graph: PreviewInspectorBundleRootedOptionalGraph;
  readonly proposal: PreviewInspectorBundleOptionalProposalResult;
}

export interface PreviewInspectorBundleDynamicResolution {
  readonly targetPath?: string;
}

export interface PreviewInspectorBundleSourceInventoryMemoStatistics {
  readonly computations: number;
  readonly entries: number;
  readonly hits: number;
  readonly released: boolean;
  readonly requests: number;
}

export interface PreviewInspectorBundleSurfaceSliceMemoStatistics {
  readonly released: boolean;
  readonly sliceComputations: number;
  readonly sliceEntries: number;
  readonly sliceHits: number;
  readonly sliceRequests: number;
}

export interface PreviewInspectorBundleSourceClosureMemoStatistics {
  readonly closureComputations: number;
  readonly closureEntries: number;
  readonly closureHits: number;
  readonly closureRequests: number;
  readonly released: boolean;
}

export interface PreviewInspectorBundleGraphMemoStatistics {
  readonly dynamicResolutionComputations: number;
  readonly dynamicResolutionEntries: number;
  readonly dynamicResolutionHits: number;
  readonly dynamicResolutionRequests: number;
  readonly proposalComputations: number;
  readonly proposalEntries: number;
  readonly proposalHits: number;
  readonly proposalRequests: number;
  readonly released: boolean;
  readonly resolvedNodeComputations: number;
  readonly resolvedNodeEntries: number;
  readonly resolvedNodeHits: number;
  readonly resolvedNodeRequests: number;
  readonly rootedGraphComputations: number;
  readonly rootedGraphEntries: number;
  readonly rootedGraphHits: number;
  readonly rootedGraphRequests: number;
}

/** Request-scoped exact-text memo for context-free source inventory analysis. */
export interface PreviewInspectorBundleSourceInventoryMemo {
  readonly collect: (
    sourcePath: string,
    inventorySource: string,
  ) => PreviewInspectorBundleSourceInventoryResult;
  readonly collectLocalComponentSlice: (
    sourcePath: string,
    sourceText: string,
    localName: string,
    preservedWrapperKinds: readonly ('forward-ref' | 'memo' | 'styled')[],
  ) => PreviewInspectorMountSurfaceSliceResult;
  readonly collectSelectedExportSlice: (
    sourcePath: string,
    sourceText: string,
    exportName: string,
  ) => PreviewInspectorMountSurfaceSliceResult;
  readonly collectSourceClosure: (
    key: string,
    compute: () => Promise<PreviewInspectorBundleSourceClosureTemplate>,
  ) => Promise<PreviewInspectorBundleSourceClosureTemplate>;
  readonly collectResolvedSourceNode: (
    key: string,
    compute: () => Promise<PreviewInspectorBundleResolvedSourceNode>,
  ) => Promise<PreviewInspectorBundleResolvedSourceNode>;
  readonly collectRootedOptionalGraph: (
    rootRepresentationKey: string,
    pendingContextKey: string,
    isCompatible: (graph: PreviewInspectorBundleRootedOptionalGraph) => boolean,
    compute: () => Promise<PreviewInspectorBundleRootedOptionalGraph>,
  ) => Promise<PreviewInspectorBundleRootedOptionalGraph>;
  readonly collectOptionalProposal: (
    key: string,
    compute: () => Promise<PreviewInspectorBundleOptionalProposalResult>,
  ) => Promise<PreviewInspectorBundleOptionalProposalResult>;
  readonly collectDynamicResolution: (
    key: string,
    compute: () => PreviewInspectorBundleDynamicResolution,
  ) => PreviewInspectorBundleDynamicResolution;
  readonly getClosureStatistics: () => PreviewInspectorBundleSourceClosureMemoStatistics;
  readonly getGraphStatistics: () => PreviewInspectorBundleGraphMemoStatistics;
  readonly getSliceStatistics: () => PreviewInspectorBundleSurfaceSliceMemoStatistics;
  readonly getStatistics: () => PreviewInspectorBundleSourceInventoryMemoStatistics;
  readonly release: () => void;
}

/** Creates exact-key stores whose contents cannot survive request release. */
export function createPreviewInspectorBundleSourceInventoryMemo(): PreviewInspectorBundleSourceInventoryMemo {
  const inventoriesByPath = new Map<
    string,
    Map<string, PreviewInspectorBundleSourceInventoryResult>
  >();
  const sourceClosures = new Map<string, PreviewInspectorBundleSourceClosureTemplate>();
  const pendingSourceClosures = new Map<
    string,
    Promise<PreviewInspectorBundleSourceClosureTemplate>
  >();
  const resolvedSourceNodes = new Map<string, PreviewInspectorBundleResolvedSourceNode>();
  const pendingResolvedSourceNodes = new Map<
    string,
    Promise<PreviewInspectorBundleResolvedSourceNode>
  >();
  const rootedOptionalGraphs = new Map<string, PreviewInspectorBundleRootedOptionalGraph[]>();
  const pendingRootedOptionalGraphs = new Map<
    string,
    Promise<PreviewInspectorBundleRootedOptionalGraph>
  >();
  const optionalProposals = new Map<string, PreviewInspectorBundleOptionalProposalResult>();
  const pendingOptionalProposals = new Map<
    string,
    Promise<PreviewInspectorBundleOptionalProposalResult>
  >();
  const dynamicResolutions = new Map<string, PreviewInspectorBundleDynamicResolution>();
  const slicesByPath = new Map<
    string,
    Map<string, Map<string, PreviewInspectorMountSurfaceSliceResult>>
  >();
  let computations = 0;
  let closureComputations = 0;
  let closureHits = 0;
  let closureRequests = 0;
  let entries = 0;
  let dynamicResolutionComputations = 0;
  let dynamicResolutionHits = 0;
  let dynamicResolutionRequests = 0;
  let hits = 0;
  let proposalComputations = 0;
  let proposalHits = 0;
  let proposalRequests = 0;
  let released = false;
  let resolvedNodeComputations = 0;
  let resolvedNodeHits = 0;
  let resolvedNodeRequests = 0;
  let requests = 0;
  let rootedGraphComputations = 0;
  let rootedGraphHits = 0;
  let rootedGraphRequests = 0;
  let sliceComputations = 0;
  let sliceEntries = 0;
  let sliceHits = 0;
  let sliceRequests = 0;
  const assertActive = (): void => {
    if (released)
      throw new Error('Preview Inspector bundle source-inventory memo was already released.');
  };
  const collectSurfaceSlice = (
    sourcePath: string,
    sourceText: string,
    operationKey: string,
    compute: (normalizedSourcePath: string) => PreviewInspectorMountSurfaceSliceResult,
  ): PreviewInspectorMountSurfaceSliceResult => {
    assertActive();
    sliceRequests += 1;
    const normalizedSourcePath = path.normalize(sourcePath);
    const slicesBySource = slicesByPath.get(normalizedSourcePath);
    const slicesByOperation = slicesBySource?.get(sourceText);
    const cached = slicesByOperation?.get(operationKey);
    if (cached !== undefined) {
      sliceHits += 1;
      return cached;
    }
    sliceComputations += 1;
    const slice = compute(normalizedSourcePath);
    const destinationBySource =
      slicesBySource ?? new Map<string, Map<string, PreviewInspectorMountSurfaceSliceResult>>();
    const destinationByOperation =
      slicesByOperation ?? new Map<string, PreviewInspectorMountSurfaceSliceResult>();
    destinationByOperation.set(operationKey, slice);
    if (slicesByOperation === undefined)
      destinationBySource.set(sourceText, destinationByOperation);
    if (slicesBySource === undefined) slicesByPath.set(normalizedSourcePath, destinationBySource);
    sliceEntries += 1;
    return slice;
  };
  return Object.freeze({
    collect(
      sourcePath: string,
      inventorySource: string,
    ): PreviewInspectorBundleSourceInventoryResult {
      assertActive();
      requests += 1;
      const normalizedSourcePath = path.normalize(sourcePath);
      const inventoriesBySource = inventoriesByPath.get(normalizedSourcePath);
      const cached = inventoriesBySource?.get(inventorySource);
      if (cached !== undefined) {
        hits += 1;
        return cached;
      }
      computations += 1;
      const inventory = collectPreviewInspectorBundleSourceInventory(
        normalizedSourcePath,
        inventorySource,
      );
      const destination =
        inventoriesBySource ?? new Map<string, PreviewInspectorBundleSourceInventoryResult>();
      destination.set(inventorySource, inventory);
      if (inventoriesBySource === undefined)
        inventoriesByPath.set(normalizedSourcePath, destination);
      entries += 1;
      return inventory;
    },
    async collectSourceClosure(
      key: string,
      compute: () => Promise<PreviewInspectorBundleSourceClosureTemplate>,
    ): Promise<PreviewInspectorBundleSourceClosureTemplate> {
      assertActive();
      closureRequests += 1;
      const retained = sourceClosures.get(key);
      if (retained !== undefined) {
        closureHits += 1;
        return retained;
      }
      const active = pendingSourceClosures.get(key);
      if (active !== undefined) {
        closureHits += 1;
        return active;
      }
      closureComputations += 1;
      const operation = compute()
        .then((template) => {
          if (pendingSourceClosures.get(key) === operation) sourceClosures.set(key, template);
          return template;
        })
        .finally(() => {
          if (pendingSourceClosures.get(key) === operation) pendingSourceClosures.delete(key);
        });
      pendingSourceClosures.set(key, operation);
      return operation;
    },
    async collectResolvedSourceNode(
      key: string,
      compute: () => Promise<PreviewInspectorBundleResolvedSourceNode>,
    ): Promise<PreviewInspectorBundleResolvedSourceNode> {
      assertActive();
      resolvedNodeRequests += 1;
      const retained = resolvedSourceNodes.get(key);
      if (retained !== undefined) {
        resolvedNodeHits += 1;
        return retained;
      }
      const active = pendingResolvedSourceNodes.get(key);
      if (active !== undefined) {
        resolvedNodeHits += 1;
        return active;
      }
      resolvedNodeComputations += 1;
      const operation = compute()
        .then((node) => {
          if (pendingResolvedSourceNodes.get(key) === operation) resolvedSourceNodes.set(key, node);
          return node;
        })
        .finally(() => {
          if (pendingResolvedSourceNodes.get(key) === operation)
            pendingResolvedSourceNodes.delete(key);
        });
      pendingResolvedSourceNodes.set(key, operation);
      return operation;
    },
    async collectRootedOptionalGraph(
      rootRepresentationKey: string,
      pendingContextKey: string,
      isCompatible: (graph: PreviewInspectorBundleRootedOptionalGraph) => boolean,
      compute: () => Promise<PreviewInspectorBundleRootedOptionalGraph>,
    ): Promise<PreviewInspectorBundleRootedOptionalGraph> {
      assertActive();
      rootedGraphRequests += 1;
      const retained = rootedOptionalGraphs.get(rootRepresentationKey)?.find(isCompatible);
      if (retained !== undefined) {
        rootedGraphHits += 1;
        return retained;
      }
      const pendingKey = `${rootRepresentationKey}\0${pendingContextKey}`;
      const active = pendingRootedOptionalGraphs.get(pendingKey);
      if (active !== undefined) {
        rootedGraphHits += 1;
        return active;
      }
      rootedGraphComputations += 1;
      const operation = compute()
        .then((graph) => {
          if (pendingRootedOptionalGraphs.get(pendingKey) !== operation) return graph;
          const destination = rootedOptionalGraphs.get(rootRepresentationKey) ?? [];
          const existing = destination.find(isCompatible);
          if (existing !== undefined) return existing;
          destination.push(graph);
          if (!rootedOptionalGraphs.has(rootRepresentationKey))
            rootedOptionalGraphs.set(rootRepresentationKey, destination);
          return graph;
        })
        .finally(() => {
          if (pendingRootedOptionalGraphs.get(pendingKey) === operation)
            pendingRootedOptionalGraphs.delete(pendingKey);
        });
      pendingRootedOptionalGraphs.set(pendingKey, operation);
      return operation;
    },
    async collectOptionalProposal(
      key: string,
      compute: () => Promise<PreviewInspectorBundleOptionalProposalResult>,
    ): Promise<PreviewInspectorBundleOptionalProposalResult> {
      assertActive();
      proposalRequests += 1;
      const retained = optionalProposals.get(key);
      if (retained !== undefined) {
        proposalHits += 1;
        return retained;
      }
      const active = pendingOptionalProposals.get(key);
      if (active !== undefined) {
        proposalHits += 1;
        return active;
      }
      proposalComputations += 1;
      const operation = compute()
        .then((proposal) => {
          if (pendingOptionalProposals.get(key) === operation) optionalProposals.set(key, proposal);
          return proposal;
        })
        .finally(() => {
          if (pendingOptionalProposals.get(key) === operation) pendingOptionalProposals.delete(key);
        });
      pendingOptionalProposals.set(key, operation);
      return operation;
    },
    collectDynamicResolution(
      key: string,
      compute: () => PreviewInspectorBundleDynamicResolution,
    ): PreviewInspectorBundleDynamicResolution {
      assertActive();
      dynamicResolutionRequests += 1;
      const retained = dynamicResolutions.get(key);
      if (retained !== undefined) {
        dynamicResolutionHits += 1;
        return retained;
      }
      dynamicResolutionComputations += 1;
      const resolution = compute();
      if (!released) dynamicResolutions.set(key, resolution);
      return resolution;
    },
    collectLocalComponentSlice(
      sourcePath: string,
      sourceText: string,
      localName: string,
      preservedWrapperKinds: readonly ('forward-ref' | 'memo' | 'styled')[],
    ): PreviewInspectorMountSurfaceSliceResult {
      return collectSurfaceSlice(
        sourcePath,
        sourceText,
        JSON.stringify(['local-component', localName, preservedWrapperKinds]),
        (normalizedSourcePath) =>
          createPreviewInspectorLocalComponentSlice({
            localName,
            preservedWrapperKinds,
            sourcePath: normalizedSourcePath,
            sourceText,
          }),
      );
    },
    collectSelectedExportSlice(
      sourcePath: string,
      sourceText: string,
      exportName: string,
    ): PreviewInspectorMountSurfaceSliceResult {
      return collectSurfaceSlice(
        sourcePath,
        sourceText,
        JSON.stringify(['selected-export', exportName]),
        (normalizedSourcePath) =>
          createPreviewInspectorSelectedExportSlice({
            exportName,
            sourcePath: normalizedSourcePath,
            sourceText,
          }),
      );
    },
    getClosureStatistics(): PreviewInspectorBundleSourceClosureMemoStatistics {
      return Object.freeze({
        closureComputations,
        closureEntries: sourceClosures.size,
        closureHits,
        closureRequests,
        released,
      });
    },
    getGraphStatistics(): PreviewInspectorBundleGraphMemoStatistics {
      return Object.freeze({
        dynamicResolutionComputations,
        dynamicResolutionEntries: dynamicResolutions.size,
        dynamicResolutionHits,
        dynamicResolutionRequests,
        proposalComputations,
        proposalEntries: optionalProposals.size,
        proposalHits,
        proposalRequests,
        released,
        resolvedNodeComputations,
        resolvedNodeEntries: resolvedSourceNodes.size,
        resolvedNodeHits,
        resolvedNodeRequests,
        rootedGraphComputations,
        rootedGraphEntries: [...rootedOptionalGraphs.values()].reduce(
          (total, graphs) => total + graphs.length,
          0,
        ),
        rootedGraphHits,
        rootedGraphRequests,
      });
    },
    getSliceStatistics(): PreviewInspectorBundleSurfaceSliceMemoStatistics {
      return Object.freeze({
        released,
        sliceComputations,
        sliceEntries,
        sliceHits,
        sliceRequests,
      });
    },
    getStatistics(): PreviewInspectorBundleSourceInventoryMemoStatistics {
      return Object.freeze({ computations, entries, hits, released, requests });
    },
    release(): void {
      if (released) return;
      sourceClosures.clear();
      pendingSourceClosures.clear();
      resolvedSourceNodes.clear();
      pendingResolvedSourceNodes.clear();
      rootedOptionalGraphs.clear();
      pendingRootedOptionalGraphs.clear();
      optionalProposals.clear();
      pendingOptionalProposals.clear();
      dynamicResolutions.clear();
      for (const inventoriesBySource of inventoriesByPath.values()) inventoriesBySource.clear();
      inventoriesByPath.clear();
      for (const slicesBySource of slicesByPath.values()) {
        for (const slicesByOperation of slicesBySource.values()) slicesByOperation.clear();
        slicesBySource.clear();
      }
      slicesByPath.clear();
      entries = 0;
      sliceEntries = 0;
      released = true;
    },
  });
}

/** Computes the context-free source inventory shared by exact path and source text. */
export function collectPreviewInspectorBundleSourceInventory(
  normalizedSourcePath: string,
  inventorySource: string,
): PreviewInspectorBundleSourceInventoryResult {
  const byteLength = Buffer.byteLength(inventorySource, 'utf8');
  if (hasSourceParseFailure(normalizedSourcePath, inventorySource)) return 'source-parse-failure';
  return Object.freeze({
    byteLength,
    edges: collectPreviewInspectorRuntimeImportInventory(normalizedSourcePath, inventorySource),
  });
}

/** Reuses one rooted graph and the exact proposal for its currently relevant blockers. */
export async function collectPreviewInspectorBundleOptionalClosure(options: {
  readonly blockedSourcePaths: ReadonlySet<string>;
  readonly diagnostics: PreviewInspectorBundleDiagnosticsCollector | undefined;
  readonly getRepresentationKey: (sourcePath: string) => string;
  readonly memo: PreviewInspectorBundleSourceInventoryMemo | undefined;
  readonly pendingContextKey: string;
  readonly readNode: (sourcePath: string) => Promise<PreviewInspectorBundleResolvedSourceNode>;
  readonly rootPath: string;
}): Promise<PreviewInspectorBundleCollectedOptionalClosure> {
  if (options.memo === undefined) return collectDirectOptionalClosure(options);
  const rootRepresentationKey = options.getRepresentationKey(options.rootPath);
  const isCompatible = (graph: PreviewInspectorBundleRootedOptionalGraph): boolean =>
    graph.entries.every(
      (entry) => options.getRepresentationKey(entry.sourcePath) === entry.representationKey,
    );
  const graph = await options.memo.collectRootedOptionalGraph(
    rootRepresentationKey,
    options.pendingContextKey,
    isCompatible,
    () => collectRootedOptionalGraph(options, rootRepresentationKey),
  );
  const reachablePaths = new Set(graph.reachableSourcePaths);
  const blockers = [...options.blockedSourcePaths]
    .filter((sourcePath) => reachablePaths.has(sourcePath))
    .sort();
  const proposalKey = JSON.stringify([
    'preview-inspector-bundle-optional-proposal',
    1,
    graph.identity,
    blockers,
  ]);
  const proposal = await options.memo.collectOptionalProposal(proposalKey, () =>
    Promise.resolve(assembleOptionalProposal(graph, new Set(blockers), options.diagnostics)),
  );
  return { graph, proposal };
}

/** Builds a route-independent rooted static graph from reusable resolved nodes. */
async function collectRootedOptionalGraph(
  options: {
    readonly diagnostics: PreviewInspectorBundleDiagnosticsCollector | undefined;
    readonly readNode: (sourcePath: string) => Promise<PreviewInspectorBundleResolvedSourceNode>;
    readonly rootPath: string;
  },
  rootRepresentationKey: string,
): Promise<PreviewInspectorBundleRootedOptionalGraph> {
  const queue = createPreviewInspectorStableMinPriorityQueue(
    [options.rootPath],
    compareSourcePaths,
  );
  const visited = new Set<string>();
  const entries: PreviewInspectorBundleRootedOptionalGraphEntry[] = [];
  while (queue.size > 0) {
    options.diagnostics?.recordQueueIteration(queue.size);
    const sourcePath =
      options.diagnostics === undefined
        ? queue.popMinimum()
        : options.diagnostics.measureQueueSort(() => queue.popMinimum());
    if (sourcePath === undefined || visited.has(sourcePath)) continue;
    visited.add(sourcePath);
    const node = await options.readNode(sourcePath);
    entries.push(
      Object.freeze({
        node,
        representationKey: node.representationKey,
        sourcePath,
      }),
    );
    if (node.failure !== undefined) continue;
    for (const edge of node.staticEdges) {
      if (edge.kind === 'authored' && edge.targetPath !== undefined) queue.push(edge.targetPath);
    }
  }
  entries.sort((left, right) => left.sourcePath.localeCompare(right.sourcePath));
  const identity = JSON.stringify([
    'preview-inspector-bundle-rooted-optional-graph',
    1,
    rootRepresentationKey,
    entries.map((entry) => [entry.sourcePath, entry.representationKey]),
  ]);
  return Object.freeze({
    entries: Object.freeze(entries),
    identity,
    reachableSourcePaths: Object.freeze(entries.map((entry) => entry.sourcePath)),
    rootRepresentationKey,
    rootSourcePath: options.rootPath,
  });
}

/** Preserves the original one-pass optional traversal when graph reuse is unavailable. */
async function collectDirectOptionalClosure(options: {
  readonly blockedSourcePaths: ReadonlySet<string>;
  readonly diagnostics: PreviewInspectorBundleDiagnosticsCollector | undefined;
  readonly readNode: (sourcePath: string) => Promise<PreviewInspectorBundleResolvedSourceNode>;
  readonly rootPath: string;
}): Promise<PreviewInspectorBundleCollectedOptionalClosure> {
  const queue = createPreviewInspectorStableMinPriorityQueue(
    [options.rootPath],
    compareSourcePaths,
  );
  const entries = new Map<string, PreviewInspectorBundleResolvedSourceNode>();
  const sourcePaths = new Set<string>();
  const supportPaths = new Set<string>();
  const packageDemandPaths = new Set<string>();
  let authoredEdgeCount = 0;
  let sourceBytes = 0;
  while (queue.size > 0) {
    options.diagnostics?.recordQueueIteration(queue.size);
    const sourcePath =
      options.diagnostics === undefined
        ? queue.popMinimum()
        : options.diagnostics.measureQueueSort(() => queue.popMinimum());
    if (
      sourcePath === undefined ||
      options.blockedSourcePaths.has(sourcePath) ||
      sourcePaths.has(sourcePath)
    )
      continue;
    const node = await options.readNode(sourcePath);
    entries.set(sourcePath, node);
    if (node.failure !== undefined)
      return {
        graph: freezeRootedOptionalGraph(options.rootPath, entries),
        proposal: node.failure,
      };
    sourcePaths.add(sourcePath);
    sourceBytes += node.byteLength;
    if (sourcePath !== options.rootPath) supportPaths.add(sourcePath);
    for (const edge of node.staticEdges) {
      if (edge.kind === 'package-demand') packageDemandPaths.add(sourcePath);
      else if (edge.targetPath !== undefined) {
        authoredEdgeCount += 1;
        queue.push(edge.targetPath);
      }
    }
  }
  return {
    graph: freezeRootedOptionalGraph(options.rootPath, entries),
    proposal: freezeOptionalProposal(
      authoredEdgeCount,
      packageDemandPaths,
      sourceBytes,
      sourcePaths,
      supportPaths,
    ),
  };
}

/** Replays the blocker-sensitive lexicographic proposal over one immutable graph. */
function assembleOptionalProposal(
  graph: PreviewInspectorBundleRootedOptionalGraph,
  blockers: ReadonlySet<string>,
  diagnostics: PreviewInspectorBundleDiagnosticsCollector | undefined,
): PreviewInspectorBundleOptionalProposalResult {
  const queue = createPreviewInspectorStableMinPriorityQueue(
    [graph.rootSourcePath],
    compareSourcePaths,
  );
  const entries = new Map(graph.entries.map((entry) => [entry.sourcePath, entry.node]));
  const sourcePaths = new Set<string>();
  const supportPaths = new Set<string>();
  const packageDemandPaths = new Set<string>();
  let authoredEdgeCount = 0;
  let sourceBytes = 0;
  while (queue.size > 0) {
    diagnostics?.recordQueueIteration(queue.size);
    const sourcePath =
      diagnostics === undefined
        ? queue.popMinimum()
        : diagnostics.measureQueueSort(() => queue.popMinimum());
    if (sourcePath === undefined || blockers.has(sourcePath) || sourcePaths.has(sourcePath))
      continue;
    const node = entries.get(sourcePath);
    if (node === undefined) continue;
    if (node.failure !== undefined) return node.failure;
    sourcePaths.add(sourcePath);
    sourceBytes += node.byteLength;
    if (sourcePath !== graph.rootSourcePath) supportPaths.add(sourcePath);
    for (const edge of node.staticEdges) {
      if (edge.kind === 'package-demand') packageDemandPaths.add(sourcePath);
      else if (edge.targetPath !== undefined) {
        authoredEdgeCount += 1;
        queue.push(edge.targetPath);
      }
    }
  }
  return freezeOptionalProposal(
    authoredEdgeCount,
    packageDemandPaths,
    sourceBytes,
    sourcePaths,
    supportPaths,
  );
}

/** Freezes one proposal without retaining mutable traversal collections. */
function freezeOptionalProposal(
  authoredEdgeCount: number,
  packageDemandPaths: ReadonlySet<string>,
  sourceBytes: number,
  sourcePaths: ReadonlySet<string>,
  supportPaths: ReadonlySet<string>,
): PreviewInspectorBundleOptionalProposal {
  return Object.freeze({
    authoredEdgeCount,
    packageDemandPaths: Object.freeze([...packageDemandPaths].sort()),
    sourceBytes,
    sourcePaths: Object.freeze([...sourcePaths].sort()),
    supportPaths: Object.freeze([...supportPaths].sort()),
  });
}

/** Freezes directly visited nodes into the rooted graph transport shape. */
function freezeRootedOptionalGraph(
  rootPath: string,
  nodes: ReadonlyMap<string, PreviewInspectorBundleResolvedSourceNode>,
): PreviewInspectorBundleRootedOptionalGraph {
  const entries = [...nodes.entries()]
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([sourcePath, node]) =>
      Object.freeze({ representationKey: node.representationKey, sourcePath, node }),
    );
  return Object.freeze({
    entries: Object.freeze(entries),
    identity: JSON.stringify(entries.map((entry) => [entry.sourcePath, entry.representationKey])),
    reachableSourcePaths: Object.freeze(entries.map((entry) => entry.sourcePath)),
    rootRepresentationKey: nodes.get(rootPath)?.representationKey ?? '',
    rootSourcePath: rootPath,
  });
}

/** Orders source paths exactly as the legacy optional queue's default string sort. */
function compareSourcePaths(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

/** Detects syntax failures before native esbuild begins bundling. */
function hasSourceParseFailure(sourcePath: string, sourceText: string): boolean {
  const sourceFile = ts.createSourceFile(
    sourcePath,
    sourceText,
    ts.ScriptTarget.Latest,
    true,
    sourcePath.toLowerCase().endsWith('x') ? ts.ScriptKind.TSX : ts.ScriptKind.TS,
  );
  return (
    ((sourceFile as ts.SourceFile & { readonly parseDiagnostics?: readonly ts.Diagnostic[] })
      .parseDiagnostics?.length ?? 0) > 0
  );
}
