/**
 * Builds and searches a bounded static application render graph from a selected component export.
 * Top-level value flow is intentionally included so React.lazy maps, route arrays, router objects,
 * provider compositions, and conditional app selectors can connect the target to a proven ReactDOM
 * entry without importing the entry or running project bootstrap code.
 */
import { createHash } from 'node:crypto';
import path from 'node:path';
import { throwIfPreviewBuildCancelled } from '../../../domain/previewBuildExecution';
import { canonicalizeExistingPath } from '../../../shared/pathIdentity';
import {
  type PreviewRenderExportFact,
  type PreviewRenderImportFact,
  type PreviewRenderModuleFacts,
  type PreviewRenderValueFact,
} from './previewRenderModuleFacts';
import type {
  PreviewApplicationEntryPoint,
  PreviewRenderChainCandidate,
  PreviewRenderChainEdgeKind,
  PreviewRenderChainPlan,
  PreviewRenderChainPlansByExport,
  PreviewRenderChainStep,
  PreviewRenderExportReference,
  PreviewRenderInvocation,
  ResolvePreviewRenderGraphModule,
} from './previewRenderGraphTypes';
import {
  selectNearestPreviewRenderPackageSourcePaths,
  selectPreviewRenderRelevantSourcePaths,
} from './previewRenderSourceSelection';
import { selectPreviewRenderEntrySources } from './previewRenderEntrySourceSelection';
import {
  analyzePreviewRenderSource,
  collectPreviewRenderModuleSpecifiers,
  type AnalyzePreviewRenderSource,
  type CollectPreviewRenderModuleSpecifiers,
  type PreviewRenderSourceAnalysis,
} from './previewRenderSourceAnalysis';
import type {
  CreatePreviewRenderChainPlanOptions,
  CreatePreviewRenderChainPlansOptions,
} from './previewRenderChainPlannerOptions';

export type {
  CreatePreviewRenderChainPlanOptions,
  CreatePreviewRenderChainPlansOptions,
} from './previewRenderChainPlannerOptions';

const MAX_RENDER_CHAIN_VISITS = 4_096;
const MAX_RENDER_GRAPH_EDGES = 32_768;
const MAX_CONCURRENT_RENDER_SOURCE_READS = 64;

/** Internal graph node representing a declaration, re-export alias, or semantic entry. */
interface RenderGraphNode {
  readonly id: string;
  readonly label: string;
  readonly occurrenceStart: number;
  readonly sourcePath: string;
}

/** Directed child-to-owner relationship searched from selected export toward application entry. */
interface RenderGraphEdge {
  readonly certainty: 'confirmed' | 'conditional';
  readonly childId: string;
  /** Wrapper modules that participate in this evidence but are not value-flow owner nodes. */
  readonly evidenceSourcePaths: readonly string[];
  readonly kind: PreviewRenderChainEdgeKind;
  /** React-specific call-site semantics retained beyond the coarse graph relationship. */
  readonly invocation?: PreviewRenderInvocation;
  readonly occurrenceStart: number;
  readonly ownerId: string;
  readonly wrapperNames: readonly string[];
}

/** Module facts plus indexes that resolve local and public identities without reparsing source. */
interface IndexedRenderModule {
  readonly entryEvidence: PreviewRenderSourceAnalysis['entryEvidence'];
  readonly facts: PreviewRenderModuleFacts;
  readonly importByLocalName: ReadonlyMap<string, PreviewRenderImportFact>;
  readonly valueById: ReadonlyMap<string, PreviewRenderValueFact>;
  readonly valueByLocalName: ReadonlyMap<string, PreviewRenderValueFact>;
}

/** Parsed source modules plus an honest marker when the caller's bounded reader omitted a file. */
interface CollectedIndexedModules {
  readonly modules: ReadonlyMap<string, IndexedRenderModule>;
  readonly truncated: boolean;
}

/** Optional source-selection state shared by the entry-first pass and reverse-closure fallback. */
interface CollectIndexedModulesOptions {
  /** Source text already read while proving semantic entries and following their imports. */
  readonly preloadedSourceTextByPath?: ReadonlyMap<string, string>;
  /** Cancels stale source collection between bounded read and indexing batches. */
  readonly signal?: AbortSignal;
  /** True when the caller already supplied the exact source slice to parse. */
  readonly sourcePathsAreRelevant?: boolean;
  /** Selection limits that must remain visible in the public plan's truncation state. */
  readonly sourceSelectionTruncated?: boolean;
}

/** Mutable graph assembled entirely from inert syntax facts. */
interface RenderGraphIndex {
  edgeCount: number;
  readonly edgesByChildId: Map<string, RenderGraphEdge[]>;
  readonly entryByNodeId: Map<string, PreviewApplicationEntryPoint>;
  readonly modules: ReadonlyMap<string, IndexedRenderModule>;
  readonly nodes: Map<string, RenderGraphNode>;
  readonly resolveExportNodeIds: (sourcePath: string, exportName: string) => readonly string[];
  truncated: boolean;
}

/** One raw node/edge path accumulated before it is converted to the browser-safe plan contract. */
interface RawRenderPath {
  readonly edges: readonly RenderGraphEdge[];
  readonly entryPoint?: PreviewApplicationEntryPoint;
  readonly nodeIds: readonly string[];
}

/** Per-export traversal output; search limits must not leak between exports sharing one graph. */
interface RenderPathSearchResult {
  readonly paths: readonly RawRenderPath[];
  readonly truncated: boolean;
}

/**
 * Finds all bounded target-to-entry paths and ranks entry-connected candidates before partial roots.
 *
 * @param options Target identity, source inventory, reader, and exact static module resolver.
 * @returns Immutable plan kept separate from the Inspector's conservative executable mount root.
 */
export async function createPreviewRenderChainPlan(
  options: CreatePreviewRenderChainPlanOptions,
): Promise<PreviewRenderChainPlan> {
  const plans = await createPreviewRenderChainPlans({
    ...(options.analyzeSource === undefined ? {} : { analyzeSource: options.analyzeSource }),
    ...(options.collectModuleSpecifiers === undefined
      ? {}
      : { collectModuleSpecifiers: options.collectModuleSpecifiers }),
    documentPath: options.documentPath,
    exportNames: [options.exportName],
    readSource: options.readSource,
    resolveModule: options.resolveModule,
    ...(options.signal === undefined ? {} : { signal: options.signal }),
    sourcePaths: options.sourcePaths,
  });
  const plan = plans[options.exportName];
  if (plan === undefined) {
    throw new Error(`Render-chain plan was not produced for export: ${options.exportName}`);
  }
  return plan;
}

/**
 * Finds entry-to-target structure for all selected-file exports while parsing the source inventory
 * only once. Package-local results are retained when complete; only entry-unreachable exports are
 * retried against the wider monorepo inventory.
 *
 * @param options Current file, explicit exports, source reader, inventory, and exact resolver.
 * @returns Immutable JSON-safe record keyed by the exact runtime export names.
 */
export async function createPreviewRenderChainPlans(
  options: CreatePreviewRenderChainPlansOptions,
): Promise<PreviewRenderChainPlansByExport> {
  throwIfPreviewBuildCancelled(options.signal);
  assertRenderChainOptions(options);
  const planningOptions: CreatePreviewRenderChainPlansOptions = {
    ...options,
    readSource: memoizePreviewRenderSourceReader(options.readSource),
  };
  const sourcePaths = [
    ...new Set(options.sourcePaths.map((sourcePath) => path.normalize(sourcePath))),
  ].sort();
  const targets = options.exportNames.map((exportName) =>
    Object.freeze({
      exportName,
      sourcePath: path.normalize(options.documentPath),
    }),
  );
  const localSourcePaths = selectNearestPreviewRenderPackageSourcePaths(
    sourcePaths,
    path.normalize(options.documentPath),
  );
  if (localSourcePaths.length < sourcePaths.length) {
    const localPlans = await createRenderChainPlansForSources(
      planningOptions,
      targets,
      localSourcePaths,
    );
    const unresolvedTargets = selectFallbackTargets(targets, localPlans, options.primaryExportName);
    if (unresolvedTargets.length === 0) {
      return localPlans;
    }
    const workspacePlans = await createRenderChainPlansForSources(
      planningOptions,
      unresolvedTargets,
      sourcePaths,
    );
    return Object.freeze({ ...localPlans, ...workspacePlans });
  }
  return createRenderChainPlansForSources(planningOptions, targets, sourcePaths);
}

/** Memoizes fulfilled and unavailable reads across package, entry-first, and fallback passes. */
function memoizePreviewRenderSourceReader(
  readSource: CreatePreviewRenderChainPlanOptions['readSource'],
): CreatePreviewRenderChainPlanOptions['readSource'] {
  const resultByPath = new Map<string, Promise<string | undefined>>();
  return (sourcePath) => {
    const normalizedPath = path.normalize(sourcePath);
    const cached = resultByPath.get(normalizedPath);
    if (cached !== undefined) return cached;
    const result = readSource(normalizedPath);
    resultByPath.set(normalizedPath, result);
    return result;
  };
}

/** Builds one package/workspace graph, then performs only the cheap path search per target export. */
async function createRenderChainPlansForSources(
  options: CreatePreviewRenderChainPlansOptions,
  targets: readonly PreviewRenderExportReference[],
  sourcePaths: readonly string[],
): Promise<PreviewRenderChainPlansByExport> {
  const targetPath = path.normalize(options.documentPath);
  const entrySelection = await selectPreviewRenderEntrySources({
    ...(options.analyzeSource === undefined ? {} : { analyzeSource: options.analyzeSource }),
    ...(options.collectModuleSpecifiers === undefined
      ? {}
      : { collectModuleSpecifiers: options.collectModuleSpecifiers }),
    documentPath: targetPath,
    readSource: options.readSource,
    resolveModule: options.resolveModule,
    ...(options.signal === undefined ? {} : { signal: options.signal }),
    sourcePaths,
  });
  const connectedSourcePaths = entrySelection.connectedSourcePaths;
  if (connectedSourcePaths !== undefined) {
    if (
      options.preservePartialConsumers === true &&
      connectedSourcePaths.length < sourcePaths.length
    ) {
      return createPlansFromSelectedSources(sourcePaths, targets, false, entrySelection.truncated);
    }
    const entryPlans = await createPlansFromSelectedSources(
      connectedSourcePaths,
      targets,
      true,
      entrySelection.truncated,
    );
    const unresolvedTargets = selectFallbackTargets(targets, entryPlans, options.primaryExportName);
    if (unresolvedTargets.length === 0) return entryPlans;
    const fallbackPlans = await createPlansFromSelectedSources(
      sourcePaths,
      unresolvedTargets,
      false,
      false,
    );
    return Object.freeze({ ...entryPlans, ...fallbackPlans });
  }
  return createPlansFromSelectedSources(sourcePaths, targets, false, false);

  /** Parses one selected slice and performs cheap per-export searches over its shared graph. */
  async function createPlansFromSelectedSources(
    selectedSourcePaths: readonly string[],
    selectedTargets: readonly PreviewRenderExportReference[],
    sourcePathsAreRelevant: boolean,
    sourceSelectionTruncated: boolean,
  ): Promise<PreviewRenderChainPlansByExport> {
    const collectedModules = await collectIndexedModules(
      selectedSourcePaths,
      targetPath,
      options.readSource,
      options.resolveModule,
      options.analyzeSource ?? analyzePreviewRenderSource,
      options.collectModuleSpecifiers ?? collectPreviewRenderModuleSpecifiers,
      {
        preloadedSourceTextByPath: entrySelection.sourceTextByPath,
        ...(options.signal === undefined ? {} : { signal: options.signal }),
        sourcePathsAreRelevant,
        sourceSelectionTruncated,
      },
    );
    throwIfPreviewBuildCancelled(options.signal);
    const graph = createRenderGraphIndex(
      collectedModules.modules,
      options.resolveModule,
      collectedModules.truncated,
    );
    return Object.freeze(
      Object.fromEntries(
        selectedTargets.map((target) => [
          target.exportName,
          createRenderChainPlanFromGraph(graph, target),
        ]),
      ),
    );
  }
}

/**
 * Selects exports allowed to widen a small entry graph into a package/workspace-wide parse.
 * Gallery callers omit `primaryExportName` and preserve exhaustive legacy behavior. Page Inspector
 * supplies its selected export so secondary display metadata remains opportunistic and inexpensive.
 */
function selectFallbackTargets(
  targets: readonly PreviewRenderExportReference[],
  plans: PreviewRenderChainPlansByExport,
  primaryExportName: string | undefined,
): readonly PreviewRenderExportReference[] {
  return targets.filter(
    (target) =>
      plans[target.exportName]?.reachability === 'entry-unreachable' &&
      (primaryExportName === undefined || target.exportName === primaryExportName),
  );
}

/** Converts one already indexed graph into the immutable result for one exact current-file export. */
function createRenderChainPlanFromGraph(
  graph: RenderGraphIndex,
  target: PreviewRenderExportReference,
): PreviewRenderChainPlan {
  const targetNodeIds = graph.resolveExportNodeIds(target.sourcePath, target.exportName);
  const searchResults = targetNodeIds.map((targetNodeId) => searchRenderPaths(graph, targetNodeId));
  const rawPaths = searchResults.flatMap((result) => result.paths);
  const truncated = graph.truncated || searchResults.some((result) => result.truncated);
  const rankedPaths = rankRenderPaths(rawPaths);
  /*
   * Entry-unreachable paths are still distinct authored consumers. Route registries and framework
   * bootstraps are sometimes outside the available static inventory, so collapsing partial paths
   * to one would hide valid pages precisely when the selector is most useful.
   */
  const selectedPaths = rankedPaths;
  const paths = selectedPaths.map((rawPath) => freezeRenderChainCandidate(graph, target, rawPath));
  const entryIds = new Set(
    paths.flatMap((candidate) =>
      candidate.entryPoint === undefined
        ? []
        : [
            `${candidate.entryPoint.sourcePath}\0${candidate.entryPoint.occurrenceStart.toString()}`,
          ],
    ),
  );
  const reachability =
    entryIds.size > 1 ? 'ambiguous' : entryIds.size === 1 ? 'entry-connected' : 'entry-unreachable';
  const dependencies = new Set<string>([target.sourcePath]);
  for (const candidate of paths) {
    for (const step of candidate.steps) {
      dependencies.add(step.sourcePath);
    }
    if (candidate.entryPoint !== undefined) {
      dependencies.add(candidate.entryPoint.sourcePath);
    }
  }
  for (const rawPath of selectedPaths) {
    for (const edge of rawPath.edges) {
      for (const sourcePath of edge.evidenceSourcePaths) {
        dependencies.add(sourcePath);
      }
    }
  }

  return Object.freeze({
    dependencyPaths: Object.freeze([...dependencies].sort()),
    paths: Object.freeze(paths),
    reachability,
    ...(reachability === 'entry-unreachable'
      ? { stopReason: truncated ? ('graph-limit' as const) : ('entry-unreachable' as const) }
      : {}),
    target,
    truncated,
  });
}

/** Reads each source at most once for this planner and extracts both module and entry facts. */
async function collectIndexedModules(
  sourcePaths: readonly string[],
  targetPath: string,
  readSource: CreatePreviewRenderChainPlanOptions['readSource'],
  resolveModule: ResolvePreviewRenderGraphModule,
  analyzeSource: AnalyzePreviewRenderSource,
  collectModuleSpecifiers: CollectPreviewRenderModuleSpecifiers,
  options: CollectIndexedModulesOptions = {},
): Promise<CollectedIndexedModules> {
  const modules = new Map<string, IndexedRenderModule>();
  const selectedSourcePaths = new Set(sourcePaths.map((sourcePath) => path.normalize(sourcePath)));
  const sourceTextByPath = new Map(
    [...(options.preloadedSourceTextByPath ?? [])].filter(([sourcePath]) =>
      selectedSourcePaths.has(path.normalize(sourcePath)),
    ),
  );
  let truncated = options.sourceSelectionTruncated ?? false;
  for (let start = 0; start < sourcePaths.length; start += MAX_CONCURRENT_RENDER_SOURCE_READS) {
    throwIfPreviewBuildCancelled(options.signal);
    const batch = await Promise.all(
      sourcePaths
        .slice(start, start + MAX_CONCURRENT_RENDER_SOURCE_READS)
        .filter((sourcePath) => !sourceTextByPath.has(path.normalize(sourcePath)))
        .map(async (sourcePath) => ({ sourcePath, sourceText: await readSource(sourcePath) })),
    );
    throwIfPreviewBuildCancelled(options.signal);
    for (const { sourcePath, sourceText } of batch) {
      if (sourceText === undefined) {
        truncated = true;
        continue;
      }
      if (!sourceText.includes('import') && !sourceText.includes('export')) {
        continue;
      }
      sourceTextByPath.set(path.normalize(sourcePath), sourceText);
    }
  }
  const relevantSourcePaths = options.sourcePathsAreRelevant
    ? sourcePaths.map((sourcePath) => path.normalize(sourcePath))
    : selectPreviewRenderRelevantSourcePaths(
        sourceTextByPath,
        targetPath,
        resolveModule,
        collectModuleSpecifiers,
      );
  for (const sourcePath of relevantSourcePaths) {
    throwIfPreviewBuildCancelled(options.signal);
    const sourceText = sourceTextByPath.get(sourcePath);
    if (sourceText === undefined) {
      continue;
    }
    const analysis = analyzeSource(sourcePath, sourceText);
    const facts = analysis.moduleFacts;
    const indexedModule: IndexedRenderModule = {
      entryEvidence: analysis.entryEvidence,
      facts,
      importByLocalName: new Map(facts.imports.map((fact) => [fact.localName, fact])),
      valueById: new Map(facts.values.map((fact) => [fact.id, fact])),
      valueByLocalName: new Map(facts.values.map((fact) => [fact.localName, fact])),
    };
    modules.set(path.normalize(sourcePath), indexedModule);
    modules.set(path.normalize(canonicalizeExistingPath(sourcePath)), indexedModule);
  }
  return Object.freeze({ modules, truncated });
}

/** Builds declaration/value/import/lazy/entry edges and a recursive public-export resolver. */
function createRenderGraphIndex(
  modules: ReadonlyMap<string, IndexedRenderModule>,
  resolveModule: ResolvePreviewRenderGraphModule,
  sourceReadTruncated: boolean,
): RenderGraphIndex {
  const nodes = new Map<string, RenderGraphNode>();
  const edgesByChildId = new Map<string, RenderGraphEdge[]>();
  const entryByNodeId = new Map<string, PreviewApplicationEntryPoint>();
  const exportResolutionCache = new Map<string, readonly string[]>();
  const resolvingExports = new Set<string>();
  const graph: RenderGraphIndex = {
    edgeCount: 0,
    edgesByChildId,
    entryByNodeId,
    modules,
    nodes,
    resolveExportNodeIds,
    truncated: sourceReadTruncated,
  };

  const uniqueModules = [...new Set(modules.values())];
  for (const module of uniqueModules) {
    for (const value of module.facts.values) {
      nodes.set(value.id, {
        id: value.id,
        label: value.label,
        occurrenceStart: value.occurrenceStart,
        sourcePath: module.facts.sourcePath,
      });
    }
  }
  for (const module of uniqueModules) {
    addLocalAndImportEdges(graph, module, resolveModule);
    addLazyEdges(graph, module, resolveModule);
    addEntryEdges(graph, module, resolveModule);
  }
  return graph;

  /** Resolves one runtime export through declarations, imports, barrels, and wildcard barrels. */
  function resolveExportNodeIds(sourcePath: string, exportName: string): readonly string[] {
    const normalizedPath = path.normalize(sourcePath);
    const cacheKey = `${normalizedPath}\0${exportName}`;
    const cached = exportResolutionCache.get(cacheKey);
    if (cached !== undefined) {
      return cached;
    }
    if (resolvingExports.has(cacheKey)) {
      return [];
    }
    resolvingExports.add(cacheKey);
    const module = modules.get(normalizedPath);
    const selectedIds = new Set<string>();
    if (module !== undefined) {
      const exactFacts = module.facts.exports.filter((fact) => fact.exportName === exportName);
      for (const fact of exactFacts) {
        for (const nodeId of resolveExportFact(module, fact, exportName)) {
          selectedIds.add(nodeId);
        }
      }
      for (const fact of module.facts.exports.filter((candidate) => candidate.wildcard)) {
        for (const nodeId of resolveExportFact(module, fact, exportName)) {
          selectedIds.add(nodeId);
        }
      }
      if (selectedIds.size === 0) {
        const localFallback = module.valueByLocalName.get(exportName);
        if (localFallback !== undefined) {
          selectedIds.add(localFallback.id);
        }
      }
    }
    resolvingExports.delete(cacheKey);
    const result = Object.freeze([...selectedIds].sort());
    exportResolutionCache.set(cacheKey, result);
    return result;

    /** Resolves one export fact and materializes a barrel alias node when identity crosses a module. */
    function resolveExportFact(
      ownerModule: IndexedRenderModule,
      fact: PreviewRenderExportFact,
      requestedName: string,
    ): readonly string[] {
      if (fact.moduleSpecifier !== undefined) {
        const resolvedPath = resolveModule(fact.moduleSpecifier, ownerModule.facts.sourcePath);
        if (resolvedPath === undefined || !modules.has(path.normalize(resolvedPath))) {
          return [];
        }
        const childIds = resolveExportNodeIds(
          resolvedPath,
          fact.wildcard ? requestedName : (fact.reexportedName ?? requestedName),
        );
        return childIds.map((childId) =>
          materializeExportAlias(ownerModule.facts.sourcePath, fact, requestedName, childId),
        );
      }
      if (fact.localName === undefined) {
        return [];
      }
      const localValue = ownerModule.valueByLocalName.get(fact.localName);
      if (localValue !== undefined) {
        return [localValue.id];
      }
      const imported = ownerModule.importByLocalName.get(fact.localName);
      if (imported === undefined) {
        return [];
      }
      const resolvedPath = resolveModule(imported.moduleSpecifier, ownerModule.facts.sourcePath);
      if (resolvedPath === undefined || imported.importedName === '*') {
        return [];
      }
      return resolveExportNodeIds(resolvedPath, imported.importedName).map((childId) =>
        materializeExportAlias(ownerModule.facts.sourcePath, fact, requestedName, childId),
      );
    }
  }

  /** Adds a synthetic path-visible barrel node while preserving the underlying component identity. */
  function materializeExportAlias(
    sourcePath: string,
    fact: PreviewRenderExportFact,
    exportName: string,
    childId: string,
  ): string {
    const aliasId = `${sourcePath}\0@export:${exportName}\0${fact.occurrenceStart.toString()}`;
    if (!nodes.has(aliasId)) {
      nodes.set(aliasId, {
        id: aliasId,
        label: exportName,
        occurrenceStart: fact.occurrenceStart,
        sourcePath,
      });
      addGraphEdge(graph, {
        certainty: 'confirmed',
        childId,
        evidenceSourcePaths: Object.freeze([]),
        kind: 're-export',
        occurrenceStart: fact.occurrenceStart,
        ownerId: aliasId,
        wrapperNames: Object.freeze([]),
      });
    }
    return aliasId;
  }
}

/** Connects same-module declarations and resolved static imports to their outer declaration owners. */
function addLocalAndImportEdges(
  graph: RenderGraphIndex,
  module: IndexedRenderModule,
  resolveModule: ResolvePreviewRenderGraphModule,
): void {
  for (const fact of module.facts.localEdges) {
    const childValue = module.valueByLocalName.get(fact.childLocalName);
    const childIds =
      childValue === undefined
        ? resolveImportedLocal(module, fact.childLocalName, graph, resolveModule)
        : [childValue.id];
    for (const childId of childIds) {
      if (childId !== fact.ownerId) {
        addGraphEdge(graph, {
          ...fact,
          childId,
          evidenceSourcePaths: resolveWrapperSourcePaths(
            module,
            [...fact.wrapperNames, ...(fact.invocation?.factoryNames ?? [])],
            resolveModule,
          ),
        });
      }
    }
  }
}

/** Connects a dynamically imported component export to the declaration receiving React.lazy. */
function addLazyEdges(
  graph: RenderGraphIndex,
  module: IndexedRenderModule,
  resolveModule: ResolvePreviewRenderGraphModule,
): void {
  for (const fact of module.facts.lazyImports) {
    const resolvedPath = resolveModule(fact.moduleSpecifier, module.facts.sourcePath);
    if (resolvedPath === undefined) {
      continue;
    }
    for (const childId of graph.resolveExportNodeIds(resolvedPath, fact.importedName)) {
      addGraphEdge(graph, {
        certainty: 'conditional',
        childId,
        evidenceSourcePaths: Object.freeze([]),
        kind: 'react-lazy',
        occurrenceStart: fact.occurrenceStart,
        ownerId: fact.ownerId,
        wrapperNames: Object.freeze([]),
      });
    }
  }
}

/** Adds semantic entry nodes and connects every top-level render-argument value they reference. */
function addEntryEdges(
  graph: RenderGraphIndex,
  module: IndexedRenderModule,
  resolveModule: ResolvePreviewRenderGraphModule,
): void {
  for (const evidence of module.entryEvidence) {
    const entryNodeId = `${module.facts.sourcePath}\0@entry\0${evidence.occurrenceStart.toString()}`;
    const entryPoint: PreviewApplicationEntryPoint = Object.freeze({
      kind: evidence.kind,
      occurrenceStart: evidence.occurrenceStart,
      sourcePath: module.facts.sourcePath,
      wrapperNames: Object.freeze([...evidence.wrapperNames]),
    });
    graph.nodes.set(entryNodeId, {
      id: entryNodeId,
      label: `${evidence.kind} entry`,
      occurrenceStart: evidence.occurrenceStart,
      sourcePath: module.facts.sourcePath,
    });
    graph.entryByNodeId.set(entryNodeId, entryPoint);
    for (const localName of evidence.referencedLocalNames) {
      const value = module.valueByLocalName.get(localName);
      const childIds =
        value === undefined
          ? resolveImportedLocal(module, localName, graph, resolveModule)
          : [value.id];
      for (const childId of childIds) {
        addGraphEdge(graph, {
          certainty: 'confirmed',
          childId,
          evidenceSourcePaths: resolveWrapperSourcePaths(
            module,
            evidence.wrapperNames,
            resolveModule,
          ),
          kind: 'entry-render',
          occurrenceStart: evidence.occurrenceStart,
          ownerId: entryNodeId,
          wrapperNames: Object.freeze([...evidence.wrapperNames]),
        });
      }
    }
  }
}

/** Resolves project wrapper labels to authored modules for HMR and later mount-recipe expansion. */
function resolveWrapperSourcePaths(
  module: IndexedRenderModule,
  wrapperNames: readonly string[],
  resolveModule: ResolvePreviewRenderGraphModule,
): readonly string[] {
  const sourcePaths = new Set<string>();
  for (const wrapperName of wrapperNames) {
    const localName = wrapperName.split('.', 1)[0];
    if (localName === undefined) {
      continue;
    }
    if (module.valueByLocalName.has(localName)) {
      sourcePaths.add(module.facts.sourcePath);
      continue;
    }
    const imported = module.importByLocalName.get(localName);
    if (imported === undefined) {
      continue;
    }
    const resolvedPath = resolveModule(imported.moduleSpecifier, module.facts.sourcePath);
    if (
      resolvedPath !== undefined &&
      !resolvedPath.includes(`${path.sep}node_modules${path.sep}`)
    ) {
      sourcePaths.add(path.normalize(resolvedPath));
    }
  }
  return Object.freeze([...sourcePaths].sort());
}

/** Resolves a consumer-local ESM binding to one or more source export graph nodes. */
function resolveImportedLocal(
  module: IndexedRenderModule,
  localName: string,
  graph: RenderGraphIndex,
  resolveModule: ResolvePreviewRenderGraphModule,
): readonly string[] {
  const imported = module.importByLocalName.get(localName);
  if (imported === undefined || imported.importedName === '*') {
    return [];
  }
  const resolvedPath = resolveModule(imported.moduleSpecifier, module.facts.sourcePath);
  return resolvedPath === undefined
    ? []
    : graph.resolveExportNodeIds(resolvedPath, imported.importedName);
}

/** Inserts one edge under a global safety budget and removes exact duplicates deterministically. */
function addGraphEdge(graph: RenderGraphIndex, edge: RenderGraphEdge): void {
  if (graph.edgeCount >= MAX_RENDER_GRAPH_EDGES) {
    graph.truncated = true;
    return;
  }
  const existing = graph.edgesByChildId.get(edge.childId) ?? [];
  if (
    existing.some(
      (candidate) =>
        candidate.ownerId === edge.ownerId &&
        candidate.kind === edge.kind &&
        candidate.occurrenceStart === edge.occurrenceStart,
    )
  ) {
    return;
  }
  existing.push(Object.freeze(edge));
  graph.edgeCount += 1;
  existing.sort(compareGraphEdges);
  graph.edgesByChildId.set(edge.childId, existing);
}

/** Searches every branch iteratively, retaining entries and useful outermost partial roots. */
function searchRenderPaths(graph: RenderGraphIndex, targetNodeId: string): RenderPathSearchResult {
  const completed: RawRenderPath[] = [];
  const partial: RawRenderPath[] = [];
  const stack: {
    readonly edges: readonly RenderGraphEdge[];
    readonly nodeId: string;
    readonly nodeIds: readonly string[];
    readonly visited: ReadonlySet<string>;
  }[] = [
    {
      edges: [],
      nodeId: targetNodeId,
      nodeIds: [targetNodeId],
      visited: new Set([targetNodeId]),
    },
  ];
  let visitedNodeCount = 0;
  let truncated = false;

  /*
   * An explicit stack avoids turning authored component depth into the JavaScript call-stack
   * depth. No hop count truncates a valid page: only the aggregate visit budget protects the
   * extension host from a combinatorial graph, while per-path identities terminate cycles.
   */
  while (stack.length > 0) {
    if (visitedNodeCount >= MAX_RENDER_CHAIN_VISITS) {
      truncated = true;
      break;
    }
    const current = stack.pop();
    if (current === undefined) break;
    visitedNodeCount += 1;
    const entryPoint = graph.entryByNodeId.get(current.nodeId);
    if (entryPoint !== undefined) {
      completed.push({
        edges: current.edges,
        entryPoint,
        nodeIds: current.nodeIds,
      });
      continue;
    }
    const outgoing = (graph.edgesByChildId.get(current.nodeId) ?? []).filter(
      (edge) => !current.visited.has(edge.ownerId),
    );
    if (outgoing.length === 0) {
      partial.push({ edges: current.edges, nodeIds: current.nodeIds });
      continue;
    }
    for (const edge of [...outgoing].reverse()) {
      stack.push({
        edges: [...current.edges, edge],
        nodeId: edge.ownerId,
        nodeIds: [...current.nodeIds, edge.ownerId],
        visited: new Set([...current.visited, edge.ownerId]),
      });
    }
  }

  return Object.freeze({
    paths: Object.freeze(completed.length > 0 ? completed : partial),
    truncated,
  });
}

/** Ranks all unique proven entries first while demoting non-application fixture consumers. */
function rankRenderPaths(paths: readonly RawRenderPath[]): readonly RawRenderPath[] {
  const uniquePaths = new Map<string, RawRenderPath>();
  for (const candidate of paths) {
    const identity = serializeRawPath(candidate);
    if (!uniquePaths.has(identity)) uniquePaths.set(identity, candidate);
  }
  const uniqueCandidates = [...uniquePaths.values()];
  const applicationCandidates = uniqueCandidates.filter(
    (candidate) => !isPreviewRenderFixturePath(candidate),
  );
  const selectableCandidates =
    applicationCandidates.length > 0 ? applicationCandidates : uniqueCandidates;
  return selectableCandidates.sort((left, right) => {
    const entryDifference =
      Number(right.entryPoint !== undefined) - Number(left.entryPoint !== undefined);
    if (entryDifference !== 0) {
      return entryDifference;
    }
    const fixtureDifference =
      Number(isPreviewRenderFixturePath(left)) - Number(isPreviewRenderFixturePath(right));
    if (fixtureDifference !== 0) {
      return fixtureDifference;
    }
    const distanceDifference = left.nodeIds.length - right.nodeIds.length;
    if (distanceDifference !== 0) {
      return distanceDifference;
    }
    const sourceDifference = scoreRawPath(right) - scoreRawPath(left);
    if (sourceDifference !== 0) {
      return sourceDifference;
    }
    return serializeRawPath(left).localeCompare(serializeRawPath(right));
  });
}

/** Rejects development-only callers before comparing application-path distance. */
function isPreviewRenderFixturePath(path_: RawRenderPath): boolean {
  const sourceText = path_.nodeIds.join('/').replaceAll('\\', '/').toLowerCase();
  return /(?:__tests__|\.test\.|\.spec\.|\.stories\.|\/stories\/)/u.test(sourceText);
}

/** Gives semantically named application layouts and routes a final equal-distance tie-break. */
function scoreRawPath(path_: RawRenderPath): number {
  const sourceText = path_.nodeIds.join('/').replaceAll('\\', '/').toLowerCase();
  let score = path_.entryPoint === undefined ? 0 : 10_000;
  if (/(?:\/pages?\/|\/layouts?\/|\/routes?\/|\/app\.)/u.test(sourceText)) {
    score += 200;
  }
  return score;
}

/** Converts one internal path into immutable path-free labels plus build-only source identities. */
function freezeRenderChainCandidate(
  graph: RenderGraphIndex,
  target: PreviewRenderExportReference,
  rawPath: RawRenderPath,
): PreviewRenderChainCandidate {
  const steps: PreviewRenderChainStep[] = [];
  for (const [index, nodeId] of rawPath.nodeIds.entries()) {
    const node = graph.nodes.get(nodeId);
    if (node === undefined) {
      continue;
    }
    const edge = rawPath.edges[index];
    const invocation = edge?.invocation;
    const invocationSourcePath =
      edge === undefined ? undefined : graph.nodes.get(edge.ownerId)?.sourcePath;
    steps.push(
      Object.freeze({
        certainty: edge?.certainty ?? 'confirmed',
        evidenceSourcePaths: Object.freeze([...(edge?.evidenceSourcePaths ?? [])]),
        ...(invocation === undefined
          ? {}
          : {
              invocation: Object.freeze({
                ...invocation,
                ...(invocationSourcePath === undefined ? {} : { sourcePath: invocationSourcePath }),
              }),
            }),
        kind: edge?.kind ?? 'value-flow',
        label: index === 0 ? displayTargetName(target.exportName, node.label) : node.label,
        occurrenceStart: edge?.occurrenceStart ?? node.occurrenceStart,
        sourcePath: node.sourcePath,
        wrapperNames: Object.freeze([...(edge?.wrapperNames ?? [])]),
      }),
    );
  }
  return Object.freeze({
    id: createCandidateId(target, rawPath),
    ...(rawPath.entryPoint === undefined ? {} : { entryPoint: rawPath.entryPoint }),
    steps: Object.freeze(steps),
  });
}

/** Keeps a descriptive declaration name while making anonymous default exports understandable. */
function displayTargetName(exportName: string, declarationLabel: string): string {
  return exportName === 'default' && declarationLabel !== '@default'
    ? `${declarationLabel} (default)`
    : exportName === 'default'
      ? 'default'
      : declarationLabel;
}

/** Derives a compact stable candidate identity without exposing absolute paths to browser controls. */
function createCandidateId(target: PreviewRenderExportReference, path_: RawRenderPath): string {
  return createHash('sha256')
    .update(`${target.sourcePath}\0${target.exportName}\0${serializeRawPath(path_)}`)
    .digest('hex')
    .slice(0, 16);
}

/** Produces deterministic authored identity for ranking and stable IDs. */
function serializeRawPath(path_: RawRenderPath): string {
  return [
    path_.nodeIds.join('\u001f'),
    path_.edges
      .map(
        (edge) =>
          `${edge.kind}:${edge.invocation?.mode ?? ''}:${edge.invocation?.slotName ?? ''}:` +
          `${edge.occurrenceStart.toString()}:${edge.wrapperNames.join('>')}`,
      )
      .join('\u001f'),
  ].join('\u001e');
}

/** Stable ordering prevents source inventory enumeration order from changing the selected path. */
function compareGraphEdges(left: RenderGraphEdge, right: RenderGraphEdge): number {
  const ownerDifference = left.ownerId.localeCompare(right.ownerId);
  return ownerDifference !== 0 ? ownerDifference : left.occurrenceStart - right.occurrenceStart;
}

/** Rejects invalid public planner inputs before reading any workspace source. */
function assertRenderChainOptions(options: CreatePreviewRenderChainPlansOptions): void {
  if (!path.isAbsolute(options.documentPath)) {
    throw new RangeError('Preview render-chain target path must be absolute.');
  }
  if (options.exportNames.length === 0) {
    throw new TypeError('Preview render-chain target exports must not be empty.');
  }
  const uniqueExportNames = new Set(options.exportNames);
  if (
    uniqueExportNames.size !== options.exportNames.length ||
    options.exportNames.some((exportName) => exportName.length === 0 || exportName === '*')
  ) {
    throw new TypeError('Preview render-chain target exports must be unique and explicit.');
  }
  if (
    options.primaryExportName !== undefined &&
    !uniqueExportNames.has(options.primaryExportName)
  ) {
    throw new TypeError('Preview render-chain primary export must be one of the selected exports.');
  }
}
