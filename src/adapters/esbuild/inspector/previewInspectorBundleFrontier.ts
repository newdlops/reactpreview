/** Creates the deterministic authored import closure before esbuild resolution. */
import path from 'node:path';
import type {
  PreviewCompilerFrontierPolicy,
  PreviewCompilerFrontierReason,
} from '../../../domain/previewCompilerFrontier';
import type { PreviewInspectorAncestorPlan } from './previewInspectorAncestorPlan';
import type {
  PreviewInspectorMountSurface,
  PreviewInspectorPageExecutionCandidate,
} from './previewInspectorPageExecutionTypes';
import { collectPreviewInspectorRuntimeImportInventory } from './previewInspectorRuntimeImportInventory';
import {
  createPreviewInspectorLocalComponentSlice,
  createPreviewInspectorSelectedExportSlice,
  type PreviewInspectorMountSurfaceSliceResult,
} from './previewInspectorMountSurfaceSlice';
import { collectPreviewInspectorShallowProjectionInventory } from './previewInspectorShallowProjection';
import type { PreviewInspectorBundleDiagnosticsCollector } from './previewInspectorBundleDiagnostics';
import {
  createPreviewInspectorBundleFrontierIdentity,
  PREVIEW_INSPECTOR_BUNDLE_FRONTIER_FORMAT_VERSION,
  PREVIEW_INSPECTOR_PAGE_EXECUTION_FRONTIER_FORMAT_VERSION,
  sortPreviewInspectorBundleFrontierReasons,
} from './previewInspectorBundleFrontierFinalization';
import { createPreviewInspectorStableMinPriorityQueue } from './previewInspectorStableMinPriorityQueue';
import {
  collectPreviewInspectorBundleOptionalClosure,
  collectPreviewInspectorBundleSourceInventory,
  type PreviewInspectorBundleDynamicResolution,
  type PreviewInspectorBundleResolvedNodeFailure,
  type PreviewInspectorBundleResolvedSourceNode,
  type PreviewInspectorBundleResolvedStaticEdge,
  type PreviewInspectorBundleSourceClosureTemplate,
  type PreviewInspectorBundleSourceInventoryMemo,
  type PreviewInspectorBundleSourceInventoryResult,
} from './previewInspectorBundleSourceInventoryMemo';
import type {
  PreviewInspectorBundleFrontier,
  PreviewInspectorProjectedEdge,
  PreviewInspectorRuntimeImportEdge,
} from './previewInspectorBundleFrontierTypes';
export {
  createPreviewInspectorBundleSourceInventoryMemo,
  type PreviewInspectorBundleSourceClosureMemoStatistics,
  type PreviewInspectorBundleGraphMemoStatistics,
  type PreviewInspectorBundleSourceInventoryMemo,
  type PreviewInspectorBundleSourceInventoryMemoStatistics,
  type PreviewInspectorBundleSurfaceSliceMemoStatistics,
} from './previewInspectorBundleSourceInventoryMemo';
const SOURCE_MODULE_PATTERN = /(?:\.d)?\.[cm]?[jt]sx?$/iu;
const STYLE_OR_ASSET_PATTERN =
  /\.(?:css|less|sass|scss|svg|png|jpe?g|gif|webp|avif|woff2?|ttf|eot)$/iu;
export interface PreparePreviewInspectorBundleFrontierOptions {
  readonly bundleDiagnostics?: PreviewInspectorBundleDiagnosticsCollector;
  /** Runtime bridge modules that the generated execution entry evaluates beside selected surfaces. */
  readonly runtimeCompanionSourcePaths?: readonly string[];
  /** A frozen Page Execution candidate switches exact admission from broad evidence to surfaces. */
  readonly executionCandidate?: PreviewInspectorPageExecutionCandidate;
  readonly plan: PreviewInspectorAncestorPlan;
  readonly policy: PreviewCompilerFrontierPolicy;
  readonly readSource: (sourcePath: string) => Promise<string | undefined>;
  /** Page selection accounts only shared-cache misses upstream to avoid duplicate raw-read counts. */
  readonly rawSourceReadAccounting?: 'upstream-page-cache';
  readonly resolveModule: (specifier: string, importer: string) => string | undefined;
  /** Request-owned reuse of only exact source-inventory analysis. */
  readonly sourceInventoryMemo?: PreviewInspectorBundleSourceInventoryMemo;
  readonly workspaceRoot: string;
}
export interface PreparedPreviewInspectorBundleFrontier {
  readonly frontier: PreviewInspectorBundleFrontier;
  readonly rejected: boolean;
}
interface FrontierSourceQueueItem {
  readonly depth: number;
  readonly kind: 'exact' | 'optional-component' | 'optional-support' | 'support';
  readonly optionalEdge?: Omit<PreviewInspectorProjectedEdge, 'reason'>;
  readonly sourcePath: string;
}
type AdmittedKind = FrontierSourceQueueItem['kind'];
/** Builds the same frontier for equal source snapshots regardless of resolve callback timing. */
export async function preparePreviewInspectorBundleFrontier(
  options: PreparePreviewInspectorBundleFrontierOptions,
): Promise<PreparedPreviewInspectorBundleFrontier> {
  const diagnostics = options.bundleDiagnostics;
  diagnostics?.recordFrontier();
  const collectTemplate = (): Promise<PreviewInspectorBundleSourceClosureTemplate> =>
    collectPreviewInspectorBundleSourceClosureTemplate(options);
  const template =
    options.executionCandidate === undefined || options.sourceInventoryMemo === undefined
      ? await collectTemplate()
      : await options.sourceInventoryMemo.collectSourceClosure(
          createPreviewInspectorBundleSourceClosureKey(options),
          collectTemplate,
        );
  return materializePreviewInspectorBundleFrontier(options, template);
}
/** Collects route-invariant authored closure data without retaining candidate identity. */
async function collectPreviewInspectorBundleSourceClosureTemplate(
  options: PreparePreviewInspectorBundleFrontierOptions,
): Promise<PreviewInspectorBundleSourceClosureTemplate> {
  const diagnostics = options.bundleDiagnostics;
  const checkAuthoredPath = (sourcePath: string): boolean =>
    diagnostics === undefined
      ? isAuthoredPath(options.workspaceRoot, sourcePath)
      : diagnostics.measureAuthoredPathCheck(() =>
          isAuthoredPath(options.workspaceRoot, sourcePath),
        );
  const resolveModule = (specifier: string, importer: string): string | undefined =>
    diagnostics === undefined
      ? options.resolveModule(specifier, importer)
      : diagnostics.measureResolveModule(() => options.resolveModule(specifier, importer));
  const readRawSource = (sourcePath: string): Promise<string | undefined> =>
    diagnostics === undefined || options.rawSourceReadAccounting === 'upstream-page-cache'
      ? options.readSource(sourcePath)
      : diagnostics.measureRawSourceRead(() => options.readSource(sourcePath));
  const authenticInventorySourcePaths = collectAuthenticInventorySourcePaths(options);
  const pending: FrontierSourceQueueItem[] = [
    ...collectExactSeedPaths(options.plan, options.executionCandidate),
    ...(options.runtimeCompanionSourcePaths ?? []),
  ]
    .filter(checkAuthoredPath)
    .map((sourcePath) => ({ depth: 0, kind: 'exact', sourcePath }));
  const projectedEdges: PreviewInspectorProjectedEdge[] = [];
  const optionalExportsByPath = new Map<string, Set<string>>();
  const optionalIdentities = new Set<string>();
  for (const visualPath of options.executionCandidate === undefined
    ? [...(options.plan.shallowVisualPaths ?? [])].sort(compareVisualPaths)
    : []) {
    if (visualPath.relation === 'route-alternative' || !checkAuthoredPath(visualPath.sourcePath))
      continue;
    const sourcePath = path.normalize(visualPath.sourcePath);
    const edge = Object.freeze({
      exportNames: Object.freeze([visualPath.exportName]),
      importerPath: path.normalize(visualPath.importerPath),
      moduleSpecifier: visualPath.moduleSpecifier,
      occurrenceStart: visualPath.occurrenceStart,
      runtimeHookExportNames: Object.freeze([]),
      targetPath: sourcePath,
    });
    const identity = `${sourcePath}\0${visualPath.exportName}`;
    if (optionalIdentities.has(identity)) continue;
    optionalIdentities.add(identity);
    const exports = optionalExportsByPath.get(sourcePath) ?? new Set<string>();
    exports.add(visualPath.exportName);
    optionalExportsByPath.set(sourcePath, exports);
    pending.push({ depth: 1, kind: 'optional-component', optionalEdge: edge, sourcePath });
  }
  for (const reference of options.executionCandidate === undefined
    ? collectExactVisualRoots(options.plan)
    : []) {
    await collectExactVisualAdmissions(
      reference,
      optionalExportsByPath,
      optionalIdentities,
      pending,
      readRawSource,
      resolveModule,
      checkAuthoredPath,
    );
  }
  const authenticRuntimeTargetSurface = options.executionCandidate?.criticalSurfaces.find(
    (surface) =>
      surface.id === options.executionCandidate?.runtimeTargetSurfaceId &&
      surface.strategy === 'authentic-module-export',
  );
  if (authenticRuntimeTargetSurface !== undefined) {
    await collectExactVisualAdmissions(
      authenticRuntimeTargetSurface,
      optionalExportsByPath,
      optionalIdentities,
      pending,
      readRawSource,
      resolveModule,
      checkAuthoredPath,
      'dynamic-import',
    );
  }
  for (const surface of options.executionCandidate?.optionalSurfaces ?? []) {
    const sourcePath = path.normalize(surface.sourcePath);
    if (!checkAuthoredPath(sourcePath)) continue;
    const identity = `${sourcePath}\0${surface.exportName}`;
    if (optionalIdentities.has(identity)) continue;
    optionalIdentities.add(identity);
    const edge = Object.freeze({
      exportNames: Object.freeze([surface.exportName]),
      importerPath: sourcePath,
      moduleSpecifier: surface.sourcePath,
      occurrenceStart: 0,
      runtimeHookExportNames: Object.freeze([]),
      targetPath: sourcePath,
    });
    optionalExportsByPath.set(sourcePath, new Set(edge.exportNames));
    pending.push({ depth: 1, kind: 'optional-component', optionalEdge: edge, sourcePath });
  }
  const queue = createPreviewInspectorStableMinPriorityQueue(pending, compareQueueItems);
  const graphMemo =
    options.executionCandidate === undefined ? undefined : options.sourceInventoryMemo;
  const sourceCache = new Map<string, Promise<PreviewInspectorBundleResolvedSourceNode>>();
  const admittedKinds = new Map<string, AdmittedKind>();
  const packageDemandPaths = new Set<string>();
  const reasons = new Set<PreviewCompilerFrontierReason>();
  let authoredEdgeCount = 0;
  let maximumDepth = 0;
  let sourceBytes = 0;
  const processedStaticEdges = new Set<string>();
  const readNode = (sourcePath: string): Promise<PreviewInspectorBundleResolvedSourceNode> => {
    const normalizedSourcePath = path.normalize(sourcePath);
    const representationKey = createResolvedNodeRepresentationKey(
      options,
      authenticInventorySourcePaths,
      normalizedSourcePath,
    );
    const cached = sourceCache.get(representationKey);
    if (cached !== undefined) {
      diagnostics?.recordInventoryRead(true);
      return cached;
    }
    const compute = async (): Promise<PreviewInspectorBundleResolvedSourceNode> => {
      diagnostics?.recordInventoryRead(false);
      const sourceText = await readRawSource(normalizedSourcePath);
      if (sourceText === undefined)
        return createResolvedNodeFailure(
          normalizedSourcePath,
          representationKey,
          'exact-source-unreadable',
        );
      const slicedSurfaces = collectSlicedSurfaces(
        options.executionCandidate,
        normalizedSourcePath,
      );
      if (slicedSurfaces !== undefined && slicedSurfaces.length > 1)
        return createResolvedNodeFailure(
          normalizedSourcePath,
          representationKey,
          'slice-unavailable',
        );
      const slicedSurface = slicedSurfaces?.[0];
      let slice: PreviewInspectorMountSurfaceSliceResult | undefined;
      if (slicedSurface !== undefined) {
        const before = diagnostics && options.sourceInventoryMemo?.getSliceStatistics();
        const collectSlice = (): PreviewInspectorMountSurfaceSliceResult =>
          slicedSurface.strategy === 'inner-local-component-slice' &&
          slicedSurface.localName !== undefined
            ? (options.sourceInventoryMemo?.collectLocalComponentSlice(
                normalizedSourcePath,
                sourceText,
                slicedSurface.localName,
                slicedSurface.preservedWrapperKinds ?? [],
              ) ??
              createPreviewInspectorLocalComponentSlice({
                localName: slicedSurface.localName,
                preservedWrapperKinds: slicedSurface.preservedWrapperKinds ?? [],
                sourcePath: normalizedSourcePath,
                sourceText,
              }))
            : (options.sourceInventoryMemo?.collectSelectedExportSlice(
                normalizedSourcePath,
                sourceText,
                slicedSurface.exportName,
              ) ??
              createPreviewInspectorSelectedExportSlice({
                exportName: slicedSurface.exportName,
                sourcePath: normalizedSourcePath,
                sourceText,
              }));
        slice =
          diagnostics === undefined ? collectSlice() : diagnostics.measureSliceLookup(collectSlice);
        const after = diagnostics && options.sourceInventoryMemo?.getSliceStatistics();
        diagnostics?.recordSliceMemoDelta(
          before === undefined || after === undefined
            ? { computations: 1, hits: 0, requests: 1 }
            : {
                computations: after.sliceComputations - before.sliceComputations,
                hits: after.sliceHits - before.sliceHits,
                requests: after.sliceRequests - before.sliceRequests,
              },
        );
      }
      if (slicedSurface !== undefined && slice?.kind !== 'success')
        return createResolvedNodeFailure(
          normalizedSourcePath,
          representationKey,
          'slice-unavailable',
        );
      const inventorySource = authenticInventorySourcePaths.has(normalizedSourcePath)
        ? sourceText
        : slice?.kind === 'success'
          ? slice.slice.contents
          : sourceText;
      const before = diagnostics && options.sourceInventoryMemo?.getStatistics();
      const collectInventory = (): PreviewInspectorBundleSourceInventoryResult =>
        options.sourceInventoryMemo?.collect(normalizedSourcePath, inventorySource) ??
        collectPreviewInspectorBundleSourceInventory(normalizedSourcePath, inventorySource);
      const inventory =
        diagnostics === undefined
          ? collectInventory()
          : diagnostics.measureInventoryLookup(collectInventory);
      const after = diagnostics && options.sourceInventoryMemo?.getStatistics();
      diagnostics?.recordInventoryMemoDelta(
        before === undefined || after === undefined
          ? { computations: 1, hits: 0, requests: 1 }
          : {
              computations: after.computations - before.computations,
              hits: after.hits - before.hits,
              requests: after.requests - before.requests,
            },
      );
      if (typeof inventory === 'string')
        return createResolvedNodeFailure(normalizedSourcePath, representationKey, inventory);
      const staticEdges: PreviewInspectorBundleResolvedStaticEdge[] = [];
      for (const edge of inventory.edges) {
        diagnostics?.recordEdgeVisit();
        if (edge.kind === 'dynamic-import' || STYLE_OR_ASSET_PATTERN.test(edge.moduleSpecifier))
          continue;
        const identity = createRuntimeEdgeIdentity(normalizedSourcePath, edge);
        const resolved = resolveModule(edge.moduleSpecifier, normalizedSourcePath);
        if (resolved !== undefined && checkAuthoredPath(resolved)) {
          staticEdges.push(
            Object.freeze({
              identity,
              kind: 'authored' as const,
              targetPath: path.normalize(resolved),
            }),
          );
          continue;
        }
        if (normalizeBarePackageSpecifier(edge.moduleSpecifier) !== undefined)
          staticEdges.push(Object.freeze({ identity, kind: 'package-demand' as const }));
      }
      return Object.freeze({
        byteLength: inventory.byteLength,
        edges: inventory.edges,
        representationKey,
        sourcePath: normalizedSourcePath,
        staticEdges: Object.freeze(staticEdges),
      });
    };
    const read = graphMemo?.collectResolvedSourceNode(representationKey, compute) ?? compute();
    sourceCache.set(representationKey, read);
    return read;
  };
  const resolveDynamicEdge = (
    node: PreviewInspectorBundleResolvedSourceNode,
    edge: PreviewInspectorRuntimeImportEdge,
  ): PreviewInspectorBundleDynamicResolution => {
    const key = `${node.representationKey}\0${createRuntimeEdgeIdentity(node.sourcePath, edge)}`;
    const compute = (): PreviewInspectorBundleDynamicResolution => {
      const resolved = resolveModule(edge.moduleSpecifier, node.sourcePath);
      return Object.freeze(
        resolved !== undefined && checkAuthoredPath(resolved)
          ? { targetPath: path.normalize(resolved) }
          : {},
      );
    };
    return graphMemo?.collectDynamicResolution(key, compute) ?? compute();
  };
  while (queue.size > 0) {
    diagnostics?.recordQueueIteration(queue.size);
    const item =
      diagnostics === undefined
        ? queue.popMinimum()
        : diagnostics.measureQueueSort(() => queue.popMinimum());
    if (item === undefined || admittedKinds.has(item.sourcePath)) continue;
    if (item.kind === 'optional-component') {
      const collectProposal = (): ReturnType<typeof collectPreviewInspectorBundleOptionalClosure> =>
        collectPreviewInspectorBundleOptionalClosure({
          blockedSourcePaths: new Set(admittedKinds.keys()),
          diagnostics,
          getRepresentationKey: (sourcePath) =>
            createResolvedNodeRepresentationKey(options, authenticInventorySourcePaths, sourcePath),
          memo: graphMemo,
          pendingContextKey: createResolvedNodeRepresentationContextKey(
            options,
            authenticInventorySourcePaths,
          ),
          readNode,
          rootPath: item.sourcePath,
        });
      const collected =
        diagnostics === undefined
          ? await collectProposal()
          : await diagnostics.measureOptionalClosure(collectProposal);
      const { graph, proposal } = collected;
      if (typeof proposal === 'string') {
        appendProjection(projectedEdges, item, proposal);
        continue;
      }
      for (const sourcePath of proposal.sourcePaths)
        admittedKinds.set(
          sourcePath,
          sourcePath === item.sourcePath ? 'optional-component' : 'optional-support',
        );
      for (const sourcePath of proposal.supportPaths) {
        if (sourcePath !== item.sourcePath && admittedKinds.get(sourcePath) !== 'exact')
          admittedKinds.set(sourcePath, 'optional-support');
      }
      authoredEdgeCount += proposal.authoredEdgeCount;
      sourceBytes += proposal.sourceBytes;
      for (const sourcePath of proposal.packageDemandPaths) packageDemandPaths.add(sourcePath);
      maximumDepth = Math.max(maximumDepth, item.depth);
      const rootNode = graph.entries.find((entry) => entry.sourcePath === item.sourcePath)?.node;
      if (rootNode !== undefined && rootNode.failure === undefined) {
        for (const edge of rootNode.edges) {
          if (graphMemo === undefined) diagnostics?.recordEdgeVisit();
          if (edge.kind !== 'dynamic-import') continue;
          const resolution = resolveDynamicEdge(rootNode, edge);
          if (resolution.targetPath === undefined) continue;
          const sourcePath = resolution.targetPath;
          const identity = `${sourcePath}\0default`;
          const edgeRecord = Object.freeze({
            exportNames: Object.freeze(
              edge.importedNames.length === 0 ? ['default'] : edge.importedNames,
            ),
            importerPath: item.sourcePath,
            moduleSpecifier: edge.moduleSpecifier,
            occurrenceStart: edge.occurrenceStart,
            runtimeHookExportNames: Object.freeze([]),
            targetPath: sourcePath,
          });
          if (optionalIdentities.has(identity) || admittedKinds.has(sourcePath)) continue;
          optionalIdentities.add(identity);
          optionalExportsByPath.set(sourcePath, new Set(edgeRecord.exportNames));
          queue.push({
            depth: item.depth + 1,
            kind: 'optional-component',
            optionalEdge: edgeRecord,
            sourcePath,
          });
        }
      }
      continue;
    }
    const node = await readNode(item.sourcePath);
    if (node.failure !== undefined) {
      reasons.add(node.failure);
      continue;
    }
    admittedKinds.set(item.sourcePath, item.kind);
    maximumDepth = Math.max(maximumDepth, item.depth);
    sourceBytes += node.byteLength;
    for (const edge of node.edges) {
      if (edge.kind !== 'dynamic-import' || options.executionCandidate === undefined) continue;
      const resolution = resolveDynamicEdge(node, edge);
      if (
        resolution.targetPath !== undefined &&
        isSelectedDynamicVisualPath(options.plan, item.sourcePath, resolution.targetPath)
      ) {
        const edgeIdentity = createRuntimeEdgeIdentity(item.sourcePath, edge);
        if (!processedStaticEdges.has(edgeIdentity)) {
          processedStaticEdges.add(edgeIdentity);
          authoredEdgeCount += 1;
          queue.push({
            depth: item.depth + 1,
            kind: 'support',
            sourcePath: resolution.targetPath,
          });
        }
      }
    }
    for (const edge of node.staticEdges) {
      if (processedStaticEdges.has(edge.identity)) continue;
      processedStaticEdges.add(edge.identity);
      if (edge.kind === 'package-demand') {
        packageDemandPaths.add(item.sourcePath);
        continue;
      }
      authoredEdgeCount += 1;
      // A proven rendered child owns an optional transaction; treating its static import as
      // mandatory support would bypass projection and expand every modal/form subtree eagerly.
      if (edge.targetPath !== undefined && !optionalExportsByPath.has(edge.targetPath)) {
        queue.push({
          depth: item.depth + 1,
          kind: 'support',
          sourcePath: edge.targetPath,
        });
      }
    }
  }
  const authenticSourcePaths = Object.freeze([...admittedKinds.keys()].sort());
  const exactSourcePaths = Object.freeze(
    authenticSourcePaths.filter((sourcePath) => admittedKinds.get(sourcePath) === 'exact'),
  );
  const optionalSourcePaths = authenticSourcePaths.filter(
    (sourcePath) => admittedKinds.get(sourcePath) === 'optional-component',
  );
  const packageDemandSourcePaths = Object.freeze([...packageDemandPaths].sort());
  const truncationReasons = Object.freeze(sortPreviewInspectorBundleFrontierReasons(reasons));
  const summary = Object.freeze({
    authoredEdgeCount,
    exactModuleCount: exactSourcePaths.length,
    maximumDepth,
    optionalComponentCount: optionalSourcePaths.length,
    packageDemandSourceCount: packageDemandSourcePaths.length,
    projectedEdgeCount: projectedEdges.length,
    sourceBytes,
    supportModuleCount:
      countKinds(admittedKinds, 'support') + countKinds(admittedKinds, 'optional-support'),
    totalAuthoredModuleCount: authenticSourcePaths.length,
    truncationReasons,
  });
  return Object.freeze({
    authenticComponentExports: Object.freeze(
      optionalSourcePaths.map((sourcePath) =>
        Object.freeze({
          exportNames: Object.freeze([...(optionalExportsByPath.get(sourcePath) ?? [])].sort()),
          runtimeHookExportNames: Object.freeze([]),
          sourcePath,
        }),
      ),
    ),
    authenticSourcePaths,
    exactSourcePaths,
    packageDemandSourcePaths,
    projectedEdges: Object.freeze([...projectedEdges].sort(compareProjectedEdges)),
    rejected: truncationReasons.length > 0,
    sourceKinds: Object.freeze(
      Object.fromEntries(
        [...admittedKinds.entries()].map(([sourcePath, kind]) => [
          sourcePath,
          kind === 'exact'
            ? ('critical-surface' as const)
            : kind === 'optional-component'
              ? ('optional-surface' as const)
              : kind === 'optional-support'
                ? ('optional-support' as const)
                : ('critical-support' as const),
        ]),
      ),
    ),
    summary,
  });
}
/** Rebuilds candidate-specific identity and transport around one immutable closure template. */
function materializePreviewInspectorBundleFrontier(
  options: PreparePreviewInspectorBundleFrontierOptions,
  template: PreviewInspectorBundleSourceClosureTemplate,
): PreparedPreviewInspectorBundleFrontier {
  const diagnostics = options.bundleDiagnostics;
  const finalize = (): PreparedPreviewInspectorBundleFrontier => {
    const collectIdentity = (): string =>
      createPreviewInspectorBundleFrontierIdentity(
        options.policy,
        options.executionCandidate,
        template.authenticSourcePaths,
        template.exactSourcePaths,
        template.packageDemandSourcePaths,
        template.authenticComponentExports,
        template.projectedEdges,
        template.summary,
      );
    const identity =
      diagnostics === undefined
        ? collectIdentity()
        : diagnostics.measureFrontierIdentity(collectIdentity);
    return {
      frontier: Object.freeze({
        authenticComponentExports: template.authenticComponentExports,
        authenticSourcePaths: template.authenticSourcePaths,
        exactSourcePaths: template.exactSourcePaths,
        identity,
        packageDemandSourcePaths: template.packageDemandSourcePaths,
        projectedEdges: template.projectedEdges,
        summary: template.summary,
        version:
          options.executionCandidate === undefined
            ? PREVIEW_INSPECTOR_BUNDLE_FRONTIER_FORMAT_VERSION
            : PREVIEW_INSPECTOR_PAGE_EXECUTION_FRONTIER_FORMAT_VERSION,
        ...(options.executionCandidate === undefined
          ? {}
          : {
              executionCandidateId: options.executionCandidate.id,
              sourceKinds: template.sourceKinds,
            }),
      }),
      rejected: template.rejected,
    };
  };
  return diagnostics === undefined ? finalize() : diagnostics.measureFrontierFinalize(finalize);
}
/** Keys only immutable inputs that can change v2 authored closure traversal. */
function createPreviewInspectorBundleSourceClosureKey(
  options: PreparePreviewInspectorBundleFrontierOptions,
): string {
  const candidate = options.executionCandidate;
  if (candidate === undefined) throw new TypeError('Page Execution closure requires a candidate.');
  const sortRows = <Row extends readonly unknown[]>(rows: Row[]): Row[] =>
    rows.sort((left, right) => JSON.stringify(left).localeCompare(JSON.stringify(right)));
  return JSON.stringify([
    'preview-inspector-bundle-source-closure',
    1,
    PREVIEW_INSPECTOR_PAGE_EXECUTION_FRONTIER_FORMAT_VERSION,
    path.normalize(options.workspaceRoot),
    [...(options.runtimeCompanionSourcePaths ?? [])]
      .map((sourcePath) => path.normalize(sourcePath))
      .sort(),
    sortRows(
      candidate.criticalSurfaces.map(
        (surface) =>
          [
            path.normalize(surface.sourcePath),
            surface.exportName,
            surface.strategy,
            surface.localName ?? null,
            [...(surface.preservedWrapperKinds ?? [])],
          ] as const,
      ),
    ),
    sortRows(
      candidate.optionalSurfaces.map(
        (surface) =>
          [path.normalize(surface.sourcePath), surface.exportName, surface.strategy] as const,
      ),
    ),
    sortRows(
      (options.plan.shallowVisualPaths ?? [])
        .filter((visualPath) => visualPath.relation !== 'route-alternative')
        .map(
          (visualPath) =>
            [
              path.normalize(visualPath.importerPath),
              path.normalize(visualPath.sourcePath),
            ] as const,
        ),
    ),
  ]);
}
/** Identifies critical strategies evaluated through the generated virtual surface namespace. */
function isVirtualSliceSurface(surface: PreviewInspectorMountSurface): boolean {
  return (
    surface.strategy === 'selected-export-slice' ||
    surface.strategy === 'inner-local-component-slice'
  );
}
/** Selects only the virtual critical representations associated with one authored path. */
function collectSlicedSurfaces(
  candidate: PreviewInspectorPageExecutionCandidate | undefined,
  sourcePath: string,
): readonly PreviewInspectorMountSurface[] | undefined {
  return candidate?.criticalSurfaces.filter(
    (surface) =>
      isVirtualSliceSurface(surface) && path.normalize(surface.sourcePath) === sourcePath,
  );
}
/** Keys one path by the exact full, sliced, or multi-slice representation it evaluates. */
function createResolvedNodeRepresentationKey(
  options: PreparePreviewInspectorBundleFrontierOptions,
  authenticSourcePaths: ReadonlySet<string>,
  sourcePath: string,
): string {
  const normalizedSourcePath = path.normalize(sourcePath);
  const slicedSurfaces = collectSlicedSurfaces(options.executionCandidate, normalizedSourcePath);
  if (slicedSurfaces !== undefined && slicedSurfaces.length > 1) {
    const shapes = slicedSurfaces
      .map((surface) => [
        surface.exportName,
        surface.strategy,
        surface.localName ?? null,
        [...(surface.preservedWrapperKinds ?? [])],
      ])
      .sort((left, right) => JSON.stringify(left).localeCompare(JSON.stringify(right)));
    return JSON.stringify([
      'preview-inspector-bundle-resolved-node',
      1,
      normalizedSourcePath,
      'multi-slice-unavailable',
      shapes,
    ]);
  }
  const slicedSurface = slicedSurfaces?.[0];
  const representation =
    slicedSurface === undefined
      ? ['authentic-full-source']
      : slicedSurface.strategy === 'inner-local-component-slice' &&
          slicedSurface.localName !== undefined
        ? [
            'inner-local-slice',
            slicedSurface.localName,
            [...(slicedSurface.preservedWrapperKinds ?? [])],
          ]
        : ['selected-export-slice', slicedSurface.exportName];
  return JSON.stringify([
    'preview-inspector-bundle-resolved-node',
    1,
    normalizedSourcePath,
    slicedSurface === undefined || authenticSourcePaths.has(normalizedSourcePath)
      ? 'authentic-inventory'
      : 'slice-inventory',
    representation,
  ]);
}
/** Identifies only representation choices needed to coalesce identical pending rooted work. */
function createResolvedNodeRepresentationContextKey(
  options: PreparePreviewInspectorBundleFrontierOptions,
  authenticSourcePaths: ReadonlySet<string>,
): string {
  const sourcePaths = new Set(authenticSourcePaths);
  for (const surface of options.executionCandidate?.criticalSurfaces ?? [])
    sourcePaths.add(path.normalize(surface.sourcePath));
  return JSON.stringify(
    [...sourcePaths]
      .sort()
      .map((sourcePath) => [
        sourcePath,
        createResolvedNodeRepresentationKey(options, authenticSourcePaths, sourcePath),
      ]),
  );
}
/** Builds one deeply frozen structural-failure node without retaining an error. */
function createResolvedNodeFailure(
  sourcePath: string,
  representationKey: string,
  failure: PreviewInspectorBundleResolvedNodeFailure,
): PreviewInspectorBundleResolvedSourceNode {
  return Object.freeze({
    byteLength: 0,
    edges: Object.freeze([]),
    failure,
    representationKey,
    sourcePath,
    staticEdges: Object.freeze([]),
  });
}

/** Identifies one source-ordered runtime edge independently of route selection. */
function createRuntimeEdgeIdentity(
  sourcePath: string,
  edge: PreviewInspectorRuntimeImportEdge,
): string {
  return `${sourcePath}\0${edge.occurrenceStart.toString()}\0${edge.moduleSpecifier}`;
}
/** Collects sources already guaranteed to be evaluated as full authored modules. */
function collectAuthenticInventorySourcePaths(
  options: PreparePreviewInspectorBundleFrontierOptions,
): ReadonlySet<string> {
  const sourcePaths = new Set(
    (options.runtimeCompanionSourcePaths ?? []).map((sourcePath) => path.normalize(sourcePath)),
  );
  for (const surface of options.executionCandidate?.criticalSurfaces ?? []) {
    if (!isVirtualSliceSurface(surface)) sourcePaths.add(path.normalize(surface.sourcePath));
  }
  for (const surface of options.executionCandidate?.optionalSurfaces ?? []) {
    sourcePaths.add(path.normalize(surface.sourcePath));
  }
  return sourcePaths;
}
/** Requires existing one-hop render evidence before a dynamic import can enter a v2 slice. */
function isSelectedDynamicVisualPath(
  plan: PreviewInspectorAncestorPlan,
  importerPath: string,
  sourcePath: string,
): boolean {
  return (plan.shallowVisualPaths ?? []).some(
    (visualPath) =>
      path.normalize(visualPath.importerPath) === path.normalize(importerPath) &&
      path.normalize(visualPath.sourcePath) === path.normalize(sourcePath) &&
      visualPath.relation !== 'route-alternative',
  );
}
/** Promotes proven JSX children of an exact render root when broad plan evidence omits them. */
async function collectExactVisualAdmissions(
  reference: { readonly exportName: string; readonly sourcePath: string },
  optionalExportsByPath: Map<string, Set<string>>,
  optionalIdentities: Set<string>,
  pending: FrontierSourceQueueItem[],
  readSource: (sourcePath: string) => Promise<string | undefined>,
  resolveModule: (specifier: string, importer: string) => string | undefined,
  checkAuthoredPath: (sourcePath: string) => boolean,
  edgeKind: 'static' | 'dynamic-import' = 'static',
): Promise<void> {
  const importerPath = path.normalize(reference.sourcePath);
  const sourceText = await readSource(importerPath);
  if (sourceText === undefined) return;
  const inventory = collectPreviewInspectorRuntimeImportInventory(importerPath, sourceText);
  const projections = collectPreviewInspectorShallowProjectionInventory(
    importerPath,
    sourceText,
    new Set([reference.exportName]),
  );
  if (projections.truncated) return;
  for (const projection of projections.projectionsBySpecifier.values()) {
    const importEdge = inventory.find(
      (edge) =>
        (edgeKind === 'dynamic-import'
          ? edge.kind === 'dynamic-import'
          : edge.kind !== 'dynamic-import') && edge.moduleSpecifier === projection.moduleSpecifier,
    );
    if (importEdge === undefined) continue;
    const resolved = resolveModule(projection.moduleSpecifier, importerPath);
    if (resolved === undefined || !checkAuthoredPath(resolved)) continue;
    const sourcePath = path.normalize(resolved);
    const existingExports = optionalExportsByPath.get(sourcePath);
    if (existingExports !== undefined) {
      for (const exportName of projection.exportNames) existingExports.add(exportName);
      continue;
    }
    const identity = `${sourcePath}\0${projection.exportNames.join('\0')}`;
    const edge = Object.freeze({
      exportNames: Object.freeze([...projection.exportNames]),
      importerPath,
      moduleSpecifier: projection.moduleSpecifier,
      occurrenceStart: importEdge.occurrenceStart,
      runtimeHookExportNames: Object.freeze([...projection.runtimeHookExportNames]),
      targetPath: sourcePath,
    });
    if (optionalIdentities.has(identity)) continue;
    optionalIdentities.add(identity);
    optionalExportsByPath.set(sourcePath, new Set(projection.exportNames));
    pending.push({ depth: 1, kind: 'optional-component', optionalEdge: edge, sourcePath });
  }
}
/** Lists only named exports the generated VirtualPage can mount or compose as authored roots. */
function collectExactVisualRoots(
  plan: PreviewInspectorAncestorPlan,
): readonly { readonly exportName: string; readonly sourcePath: string }[] {
  const roots = new Map<string, { readonly exportName: string; readonly sourcePath: string }>();
  const add = (reference: { readonly exportName: string; readonly sourcePath: string }): void => {
    roots.set(`${path.normalize(reference.sourcePath)}\0${reference.exportName}`, {
      exportName: reference.exportName,
      sourcePath: path.normalize(reference.sourcePath),
    });
  };
  add(plan.target);
  add(plan.root);
  const active = plan.pageCandidates[0];
  if (active !== undefined) {
    add(active.root);
    if (active.target !== undefined) add(active.target);
    for (const edge of active.edges) {
      add(edge.child);
      add(edge.owner);
    }
  }
  return [...roots.values()].sort(
    (left, right) =>
      left.sourcePath.localeCompare(right.sourcePath) ||
      left.exportName.localeCompare(right.exportName),
  );
}
/** Records only an incoming optional edge, never a partially admitted component. */
function appendProjection(
  projections: PreviewInspectorProjectedEdge[],
  item: FrontierSourceQueueItem,
  reason: PreviewInspectorProjectedEdge['reason'],
): void {
  if (item.optionalEdge !== undefined)
    projections.push(Object.freeze({ ...item.optionalEdge, reason }));
}
/** Keeps exact closure ahead of optional transactions and preserves their source order. */
function compareQueueItems(left: FrontierSourceQueueItem, right: FrontierSourceQueueItem): number {
  return (
    queuePriority(left.kind) - queuePriority(right.kind) ||
    left.depth - right.depth ||
    (left.optionalEdge?.importerPath ?? '').localeCompare(right.optionalEdge?.importerPath ?? '') ||
    (left.optionalEdge?.occurrenceStart ?? 0) - (right.optionalEdge?.occurrenceStart ?? 0) ||
    left.sourcePath.localeCompare(right.sourcePath)
  );
}
/** Finishes mandatory exact closure before optional component transactions. */
function queuePriority(kind: FrontierSourceQueueItem['kind']): number {
  return kind === 'exact' ? 0 : kind === 'support' ? 1 : 2;
}
/** Counts current optional support entries; exact sources are deliberately never charged to it. */
function countKinds(kinds: ReadonlyMap<string, AdmittedKind>, kind: AdmittedKind): number {
  return [...kinds.values()].filter((value) => value === kind).length;
}
/** Preserves visual relation ordering before stable source/export tie breakers. */
function compareVisualPaths(
  left: NonNullable<PreviewInspectorAncestorPlan['shallowVisualPaths']>[number],
  right: NonNullable<PreviewInspectorAncestorPlan['shallowVisualPaths']>[number],
): number {
  return (
    visualRelationPriority(left.relation) - visualRelationPriority(right.relation) ||
    path.normalize(left.importerPath).localeCompare(path.normalize(right.importerPath)) ||
    left.renderBoundaryStart - right.renderBoundaryStart ||
    left.occurrenceStart - right.occurrenceStart ||
    path.normalize(left.sourcePath).localeCompare(path.normalize(right.sourcePath)) ||
    left.exportName.localeCompare(right.exportName)
  );
}
/** Keeps owner/wrapper paths ahead of sibling and component-prop alternatives. */
function visualRelationPriority(relation: string): number {
  return relation === 'wrapper'
    ? 0
    : relation === 'sibling'
      ? 1
      : relation === 'component-prop'
        ? 2
        : 3;
}
/** Sorts public projection records independently of source read or resolver completion timing. */
function compareProjectedEdges(
  left: PreviewInspectorProjectedEdge,
  right: PreviewInspectorProjectedEdge,
): number {
  return (
    left.importerPath.localeCompare(right.importerPath) ||
    left.occurrenceStart - right.occurrenceStart ||
    left.moduleSpecifier.localeCompare(right.moduleSpecifier)
  );
}
/** Selects only active structured Inspector evidence as exact authored seeds. */
function collectExactSeedPaths(
  plan: PreviewInspectorAncestorPlan,
  executionCandidate: PreviewInspectorPageExecutionCandidate | undefined,
): readonly string[] {
  if (executionCandidate !== undefined)
    return executionCandidate.criticalSurfaces.map((surface) => surface.sourcePath);
  const active = plan.pageCandidates[0];
  const paths = new Set<string>([plan.target.sourcePath, plan.root.sourcePath]);
  const addReference = (reference: { readonly sourcePath: string } | undefined): void => {
    if (reference !== undefined) paths.add(reference.sourcePath);
  };
  if (active !== undefined) {
    addReference(active.root);
    addReference(active.target);
    for (const edge of active.edges) {
      addReference(edge.child);
      addReference(edge.owner);
    }
    /* TODO(plan7 Phase 7/8): replace this broad compatibility inventory with the selected Page
     * Execution Candidate's critical and admitted optional surfaces. Until composition surfaces
     * are wired into the root plugin, retaining it keeps strict metafile membership sound. */
    for (const step of active.renderPath?.steps.slice(active.rootStepIndex ?? 0) ?? []) {
      paths.add(step.sourcePath);
      for (const evidencePath of step.evidenceSourcePaths ?? []) paths.add(evidencePath);
    }
    if (active.routeLocation !== undefined && 'routeMounts' in active.routeLocation) {
      for (const mount of active.routeLocation.routeMounts ?? []) paths.add(mount.sourcePath);
    }
    for (const layout of active.nextAppLayoutChain ?? []) paths.add(layout.sourcePath);
    addReference(active.nextPagesShell?.app);
    for (const contextPath of active.contextModule?.importPath ?? []) paths.add(contextPath);
  }
  for (const edge of plan.edges) {
    addReference(edge.child);
    addReference(edge.owner);
  }
  for (const contextPath of plan.contextModule?.importPath ?? []) paths.add(contextPath);
  return [...paths].map((sourcePath) => path.normalize(sourcePath)).sort();
}
/** Excludes installed dependencies and non-source resources from authored graph accounting. */
function isAuthoredPath(workspaceRoot: string, sourcePath: string): boolean {
  const relative = path.relative(path.normalize(workspaceRoot), path.normalize(sourcePath));
  return (
    relative.length > 0 &&
    !relative.startsWith(`..${path.sep}`) &&
    relative !== '..' &&
    !relative.split(path.sep).includes('node_modules') &&
    SOURCE_MODULE_PATTERN.test(sourcePath)
  );
}
/** Normalizes package subpaths so each package consumes one demand identity. */
function normalizeBarePackageSpecifier(specifier: string): string | undefined {
  if (specifier.startsWith('.') || specifier.startsWith('/') || specifier.startsWith('node:'))
    return undefined;
  const parts = specifier.split('/');
  return specifier.startsWith('@') ? parts.slice(0, 2).join('/') : parts[0];
}
