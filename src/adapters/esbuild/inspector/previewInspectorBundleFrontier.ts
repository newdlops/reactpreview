import { preparePreviewInspectorBundleInitialSeeds } from './previewInspectorBundleInitialSeeds';
import { createPreviewInspectorBundleNodeReader } from './previewInspectorBundleNodeReader';
/** Coordinates source-closure traversal and candidate-specific bundle frontier materialization. */
import path from 'node:path';
import type { PreviewCompilerFrontierReason } from '../../../domain/previewCompilerFrontier';
import { collectPreviewDynamicImportInventory } from '../staticResources/previewDynamicImportInventory';
import { sortPreviewInspectorBundleFrontierReasons } from './previewInspectorBundleFrontierFinalization';
import {
  MAXIMUM_SMALL_PAGE_SHELL_DYNAMIC_IMPORTS,
  type AdmittedKind,
  type PreparePreviewInspectorBundleFrontierOptions,
  type PreparedPreviewInspectorBundleFrontier,
} from './previewInspectorBundleFrontierModel';
import type { PreviewInspectorRuntimeImportEdge } from './previewInspectorBundleFrontierTypes';
import {
  createPreviewInspectorBundleSourceClosureKey,
  materializePreviewInspectorBundleFrontier,
} from './previewInspectorBundleMaterialization';
import {
  appendProjection,
  compareProjectedEdges,
  compareQueueItems,
  countKinds,
  createResolvedNodeRepresentationContextKey,
  createResolvedNodeRepresentationKey,
  createRuntimeEdgeIdentity,
  isVirtualSliceSurface,
} from './previewInspectorBundleRepresentations';
import { isAuthoredPath, isSelectedDynamicVisualPath } from './previewInspectorBundleSeeds';
import {
  collectPreviewInspectorBundleOptionalClosure,
  type PreviewInspectorBundleDynamicResolution,
  type PreviewInspectorBundleResolvedSourceNode,
  type PreviewInspectorBundleSourceClosureTemplate,
} from './previewInspectorBundleSourceInventoryMemo';
import {
  createPreviewInspectorLocalComponentSlice,
  createPreviewInspectorSelectedExportSlice,
} from './previewInspectorMountSurfaceSlice';
import { matchesPreviewInspectorRouteParameterBranch } from './previewInspectorRouteParameterBranch';
import { collectPreviewInspectorRuntimeImportInventory } from './previewInspectorRuntimeImportInventory';
import {
  collectPreviewInspectorShallowProjectionInventory,
  collectPreviewInspectorWholeModuleShallowProjectionInventory,
  type PreviewInspectorShallowProjection,
  type PreviewInspectorShallowProjectionInventory,
} from './previewInspectorShallowProjection';
import { createPreviewInspectorStableMinPriorityQueue } from './previewInspectorStableMinPriorityQueue';
import { collectPreviewStaticRouteProjectionInventory } from './previewInspectorStaticRouteProjection';
import { readPreviewInspectorUnresolvedRouteFactoryOwner } from './previewInspectorUnresolvedRouteFactoryOwner';
import { createPreviewInspectorLocalUiHookAdmission } from './previewInspectorLocalUiHookAdmission';

export type {
  PreparePreviewInspectorBundleFrontierOptions,
  PreparedPreviewInspectorBundleFrontier,
} from './previewInspectorBundleFrontierModel';
export {
  createPreviewInspectorBundleSourceInventoryMemo,
  type PreviewInspectorBundleGraphMemoStatistics,
  type PreviewInspectorBundleSourceClosureMemoStatistics,
  type PreviewInspectorBundleSourceInventoryMemo,
  type PreviewInspectorBundleSourceInventoryMemoStatistics,
  type PreviewInspectorBundleSurfaceSliceMemoStatistics,
} from './previewInspectorBundleSourceInventoryMemo';

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

/** Collects reusable authored closure data without retaining candidate identity. */
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
  const retainLocalUiHook = createPreviewInspectorLocalUiHookAdmission(readRawSource);
  const {
    pending,
    authenticInventorySourcePaths,
    projectedEdges,
    optionalExportsByPath,
    optionalIdentities,
    exactSeedPaths,
    selectedRouteParameterGroups,
  } = await preparePreviewInspectorBundleInitialSeeds({
    options,
    checkAuthoredPath,
    readRawSource,
    resolveModule,
  });
  const queue = createPreviewInspectorStableMinPriorityQueue(pending, compareQueueItems);
  const graphMemo =
    options.executionCandidate === undefined ? undefined : options.sourceInventoryMemo;
  const sourceCache = new Map<string, Promise<PreviewInspectorBundleResolvedSourceNode>>();
  const unresolvedFactoryOwner = readPreviewInspectorUnresolvedRouteFactoryOwner(
    options.plan,
    options.executionCandidate,
  );
  const wholeModuleProjectionCache = new Map<
    string,
    Promise<PreviewInspectorShallowProjectionInventory>
  >();
  const admittedKinds = new Map<string, AdmittedKind>();
  const packageDemandPaths = new Set<string>();
  const reasons = new Set<PreviewCompilerFrontierReason>();
  let authoredEdgeCount = 0;
  let maximumDepth = 0;
  let sourceBytes = 0;
  const processedStaticEdges = new Set<string>();
  const readNode = createPreviewInspectorBundleNodeReader({
    options,
    authenticInventorySourcePaths,
    sourceCache,
    diagnostics,
    readRawSource,
    resolveModule,
    checkAuthoredPath,
    graphMemo,
  });
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
  const readWholeModuleProjections = (
    sourcePath: string,
  ): Promise<PreviewInspectorShallowProjectionInventory> => {
    const normalizedSourcePath = path.normalize(sourcePath);
    const retained = wholeModuleProjectionCache.get(normalizedSourcePath);
    if (retained !== undefined) return retained;
    const pending = readRawSource(normalizedSourcePath).then((sourceText) =>
      sourceText === undefined
        ? Object.freeze({
            projectionsBySpecifier: new Map(),
            truncated: true,
          })
        : collectPreviewInspectorWholeModuleShallowProjectionInventory(
            normalizedSourcePath,
            sourceText,
          ),
    );
    wholeModuleProjectionCache.set(normalizedSourcePath, pending);
    return pending;
  };
  while (queue.size > 0) {
    diagnostics?.recordQueueIteration(queue.size);
    const item =
      diagnostics === undefined
        ? queue.popMinimum()
        : diagnostics.measureQueueSort(() => queue.popMinimum());
    if (item === undefined || admittedKinds.has(item.sourcePath)) continue;
    if (
      (item.kind === 'page-shell-component' || item.kind === 'target-component') &&
      options.executionCandidate !== undefined
    ) {
      const node = await readNode(item.sourcePath);
      if (node.failure !== undefined) {
        appendProjection(projectedEdges, item, node.failure);
        continue;
      }
      if (
        item.optionalEdge !== undefined &&
        (admittedKinds.size + 1 > options.policy.maximumAuthoredModules ||
          sourceBytes + node.byteLength > options.policy.maximumSourceBytes)
      ) {
        appendProjection(projectedEdges, item, 'budget-projection');
        continue;
      }
      admittedKinds.set(item.sourcePath, item.kind);
      maximumDepth = Math.max(maximumDepth, item.depth);
      sourceBytes += node.byteLength;
      const sourceText = await readRawSource(item.sourcePath);
      const shallowInventory =
        sourceText === undefined
          ? undefined
          : collectPreviewInspectorShallowProjectionInventory(
              item.sourcePath,
              sourceText,
              optionalExportsByPath.get(item.sourcePath) ?? new Set(['default']),
            );
      const shallowProjections =
        shallowInventory === undefined || shallowInventory.truncated
          ? new Map<string, PreviewInspectorShallowProjection>()
          : shallowInventory.projectionsBySpecifier;
      const pageShellRouteOnlySpecifiers =
        item.kind === 'page-shell-component' && sourceText !== undefined
          ? collectPreviewStaticRouteProjectionInventory(
              item.sourcePath,
              sourceText,
              unresolvedFactoryOwner,
            ).projectionsBySpecifier
          : undefined;
      const pageShellDynamicInventory =
        item.kind === 'page-shell-component' && sourceText !== undefined
          ? collectPreviewDynamicImportInventory(item.sourcePath, sourceText)
          : undefined;
      const hasBroadPageShellDynamicRegistry =
        pageShellDynamicInventory !== undefined &&
        (!pageShellDynamicInventory.reliable ||
          pageShellDynamicInventory.truncated ||
          pageShellDynamicInventory.specifiers.length > MAXIMUM_SMALL_PAGE_SHELL_DYNAMIC_IMPORTS);
      const enqueueShallowTarget = (
        targetPath: string,
        moduleSpecifier: string,
        occurrenceStart: number,
        edgeKind: 'static' | 'dynamic-import',
      ): boolean => {
        const projection = shallowProjections.get(moduleSpecifier);
        if (projection === undefined) return false;
        if (
          item.kind === 'page-shell-component' &&
          edgeKind === 'static' &&
          pageShellRouteOnlySpecifiers?.has(moduleSpecifier) === true
        ) {
          return false;
        }
        const normalizedTarget = path.normalize(targetPath);
        const existingExports = optionalExportsByPath.get(normalizedTarget);
        if (existingExports !== undefined) {
          for (const exportName of projection.exportNames) existingExports.add(exportName);
          return true;
        }
        optionalExportsByPath.set(normalizedTarget, new Set(projection.exportNames));
        const identity = `${normalizedTarget}\0${projection.exportNames.join('\0')}`;
        if (!optionalIdentities.has(identity) && !admittedKinds.has(normalizedTarget)) {
          optionalIdentities.add(identity);
          queue.push({
            depth: item.depth + 1,
            kind:
              item.kind === 'target-component'
                ? 'target-component'
                : item.kind === 'page-shell-component'
                  ? 'page-shell-component'
                  : 'optional-component',
            optionalEdge: Object.freeze({
              exportNames: Object.freeze([...projection.exportNames]),
              importerPath: item.sourcePath,
              moduleSpecifier,
              occurrenceStart,
              runtimeHookExportNames: Object.freeze([...projection.runtimeHookExportNames]),
              targetPath: normalizedTarget,
            }),
            sourcePath: normalizedTarget,
          });
        }
        return true;
      };
      for (const edge of node.edges) {
        if (edge.kind !== 'dynamic-import') continue;
        const resolution = resolveDynamicEdge(node, edge);
        if (resolution.targetPath === undefined) continue;
        if (
          item.kind === 'page-shell-component' &&
          hasBroadPageShellDynamicRegistry &&
          !isSelectedDynamicVisualPath(options.plan, item.sourcePath, resolution.targetPath)
        ) {
          continue;
        }
        const edgeIdentity = createRuntimeEdgeIdentity(item.sourcePath, edge);
        if (processedStaticEdges.has(edgeIdentity)) continue;
        if (
          enqueueShallowTarget(
            resolution.targetPath,
            edge.moduleSpecifier,
            edge.occurrenceStart,
            'dynamic-import',
          )
        ) {
          processedStaticEdges.add(edgeIdentity);
          authoredEdgeCount += 1;
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
        if (edge.targetPath === undefined) continue;
        if (edge.compilerGeneratedSupport === true) {
          queue.push({
            depth: item.depth + 1,
            kind: 'support',
            sourcePath: edge.targetPath,
          });
          continue;
        }
        if (await retainLocalUiHook(edge)) {
          queue.push({ depth: item.depth + 1, kind: 'support', sourcePath: edge.targetPath });
          continue;
        }
        if (
          edge.moduleSpecifier !== undefined &&
          edge.occurrenceStart !== undefined &&
          enqueueShallowTarget(
            edge.targetPath,
            edge.moduleSpecifier,
            edge.occurrenceStart,
            'static',
          )
        ) {
          continue;
        }
        if (edge.projection !== undefined && !exactSeedPaths.has(edge.targetPath)) {
          projectedEdges.push(
            Object.freeze({
              ...edge.projection,
              importerPath: item.sourcePath,
              reason: 'budget-projection' as const,
              targetPath: edge.targetPath,
            }),
          );
          continue;
        }
        /*
         * A path-level optional reservation belongs to another rendered importer and does not
         * satisfy this authentic module's unprojectable static import. If that earlier optional
         * demand is later projected away, suppressing the support edge here leaves esbuild with a
         * real authored import outside the frozen frontier. Queue mandatory support until the
         * target is actually admitted; duplicate queue entries collapse at admission time.
         */
        if (!admittedKinds.has(edge.targetPath)) {
          queue.push({
            depth: item.depth + 1,
            kind: 'optional-support',
            sourcePath: edge.targetPath,
          });
        }
      }
      continue;
    }
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
      const newSourceCount = proposal.sourcePaths.filter(
        (sourcePath) => !admittedKinds.has(sourcePath),
      ).length;
      if (
        item.optionalEdge !== undefined &&
        (admittedKinds.size + newSourceCount > options.policy.maximumAuthoredModules ||
          sourceBytes + proposal.sourceBytes > options.policy.maximumSourceBytes)
      ) {
        appendProjection(projectedEdges, item, 'budget-projection');
        continue;
      }
      for (const sourcePath of proposal.sourcePaths) {
        if (admittedKinds.has(sourcePath)) continue;
        admittedKinds.set(
          sourcePath,
          sourcePath === item.sourcePath ? 'optional-component' : 'optional-support',
        );
      }
      for (const sourcePath of proposal.supportPaths) {
        if (sourcePath !== item.sourcePath && !admittedKinds.has(sourcePath))
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
      for (const sourcePath of [...proposal.supportPaths].sort()) {
        const supportNode = graph.entries.find((entry) => entry.sourcePath === sourcePath)?.node;
        if (supportNode === undefined || supportNode.failure !== undefined) continue;
        const dynamicImportEdges = supportNode.edges.filter(
          (edge) => edge.kind === 'dynamic-import',
        );
        const selectedDynamicEdgeIdentities = new Set(
          dynamicImportEdges
            .filter((edge) => {
              const resolution = resolveDynamicEdge(supportNode, edge);
              return (
                resolution.targetPath !== undefined &&
                (isSelectedDynamicVisualPath(options.plan, sourcePath, resolution.targetPath) ||
                  matchesPreviewInspectorRouteParameterBranch(
                    edge.moduleSpecifier,
                    selectedRouteParameterGroups,
                  ))
              );
            })
            .map((edge) => createRuntimeEdgeIdentity(sourcePath, edge)),
        );
        const retainSmallSupportDynamicClosure =
          selectedDynamicEdgeIdentities.size === 0 &&
          new Set(dynamicImportEdges.map((edge) => edge.moduleSpecifier)).size <=
            MAXIMUM_SMALL_PAGE_SHELL_DYNAMIC_IMPORTS;
        for (const edge of dynamicImportEdges) {
          const resolution = resolveDynamicEdge(supportNode, edge);
          const edgeIdentity = createRuntimeEdgeIdentity(sourcePath, edge);
          if (
            resolution.targetPath === undefined ||
            (!selectedDynamicEdgeIdentities.has(edgeIdentity) &&
              !retainSmallSupportDynamicClosure) ||
            processedStaticEdges.has(edgeIdentity)
          )
            continue;
          processedStaticEdges.add(edgeIdentity);
          authoredEdgeCount += 1;
          queue.push({
            depth: item.depth + 1,
            kind: 'support',
            sourcePath: resolution.targetPath,
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
    const dynamicImportEdges = node.edges.filter((edge) => edge.kind === 'dynamic-import');
    const selectedDynamicEdgeIdentities =
      options.executionCandidate === undefined
        ? new Set<string>()
        : new Set(
            dynamicImportEdges
              .filter((edge) => {
                const resolution = resolveDynamicEdge(node, edge);
                return (
                  resolution.targetPath !== undefined &&
                  (isSelectedDynamicVisualPath(
                    options.plan,
                    item.sourcePath,
                    resolution.targetPath,
                  ) ||
                    matchesPreviewInspectorRouteParameterBranch(
                      edge.moduleSpecifier,
                      selectedRouteParameterGroups,
                    ))
                );
              })
              .map((edge) => createRuntimeEdgeIdentity(item.sourcePath, edge)),
          );
    const retainSmallSupportDynamicClosure =
      options.executionCandidate !== undefined &&
      selectedDynamicEdgeIdentities.size === 0 &&
      (item.kind === 'support' || item.kind === 'optional-support') &&
      new Set(dynamicImportEdges.map((edge) => edge.moduleSpecifier)).size <=
        MAXIMUM_SMALL_PAGE_SHELL_DYNAMIC_IMPORTS;
    for (const edge of dynamicImportEdges) {
      if (options.executionCandidate === undefined) continue;
      const resolution = resolveDynamicEdge(node, edge);
      if (
        resolution.targetPath !== undefined &&
        (selectedDynamicEdgeIdentities.has(createRuntimeEdgeIdentity(item.sourcePath, edge)) ||
          retainSmallSupportDynamicClosure)
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
      if (edge.targetPath !== undefined && (await retainLocalUiHook(edge))) {
        queue.push({ depth: item.depth + 1, kind: 'support', sourcePath: edge.targetPath });
        continue;
      }
      if (edge.compilerGeneratedSupport === true && edge.targetPath !== undefined) {
        queue.push({
          depth: item.depth + 1,
          kind: 'support',
          sourcePath: edge.targetPath,
        });
        continue;
      }
      // A proven rendered child owns an optional transaction; treating its static import as
      // mandatory support would bypass projection and expand every modal/form subtree eagerly.
      if (
        edge.targetPath !== undefined &&
        !optionalExportsByPath.has(edge.targetPath) &&
        edge.projection !== undefined &&
        !exactSeedPaths.has(edge.targetPath)
      ) {
        projectedEdges.push(
          Object.freeze({
            ...edge.projection,
            importerPath: item.sourcePath,
            reason: 'budget-projection' as const,
            targetPath: edge.targetPath,
          }),
        );
        continue;
      }
      if (
        edge.targetPath !== undefined &&
        optionalExportsByPath.has(edge.targetPath) &&
        !admittedKinds.has(edge.targetPath)
      ) {
        const projection =
          edge.moduleSpecifier === undefined
            ? undefined
            : (await readWholeModuleProjections(item.sourcePath)).projectionsBySpecifier.get(
                edge.moduleSpecifier,
              );
        if (projection !== undefined && edge.occurrenceStart !== undefined) {
          projectedEdges.push(
            Object.freeze({
              ...projection,
              importerPath: item.sourcePath,
              occurrenceStart: edge.occurrenceStart,
              reason: 'budget-projection' as const,
              targetPath: edge.targetPath,
            }),
          );
        } else {
          // One path-level optional reservation cannot discard another authentic importer's
          // unprojectable demand. Admit the shared target so the fail-closed guard stays exact.
          queue.push({
            depth: item.depth + 1,
            kind: 'support',
            sourcePath: edge.targetPath,
          });
        }
        continue;
      }
      if (edge.targetPath !== undefined && !optionalExportsByPath.has(edge.targetPath)) {
        queue.push({
          depth: item.depth + 1,
          kind: 'support',
          sourcePath: edge.targetPath,
        });
      }
    }
  }
  const slicedExecutionRoot = options.executionCandidate?.criticalSurfaces.find(
    (surface) =>
      surface.id === options.executionCandidate?.executionRootSurfaceId &&
      isVirtualSliceSurface(surface),
  );
  if (slicedExecutionRoot !== undefined) {
    interface PhaseTwoItem {
      readonly depth: number;
      readonly exportNames?: readonly string[];
      readonly importerPath: string;
      readonly kind: 'component' | 'support';
      readonly occurrenceStart: number;
      readonly sourcePath: string;
    }
    const comparePhaseTwoItems = (left: PhaseTwoItem, right: PhaseTwoItem): number =>
      left.depth - right.depth ||
      (left.kind === 'component' ? 0 : 1) - (right.kind === 'component' ? 0 : 1) ||
      left.importerPath.localeCompare(right.importerPath) ||
      left.occurrenceStart - right.occurrenceStart ||
      left.sourcePath.localeCompare(right.sourcePath) ||
      (left.exportNames ?? []).join('\0').localeCompare((right.exportNames ?? []).join('\0'));
    const phaseTwoQueue = createPreviewInspectorStableMinPriorityQueue<PhaseTwoItem>(
      [],
      comparePhaseTwoItems,
    );
    const componentExpansions = new Set<string>();
    const phaseTwoQueuedComponents = new Set<string>();
    const phaseTwoQueuedSupport = new Set<string>();
    let phaseTwoFailure = false;
    const queueComponent = (
      sourcePath: string,
      exportNames: readonly string[],
      depth: number,
      importerPath: string,
      occurrenceStart: number,
    ): void => {
      const normalizedPath = path.normalize(sourcePath);
      const names = [...new Set(exportNames)].sort();
      const identity = `${normalizedPath}\0${names.join('\0')}`;
      if (phaseTwoQueuedComponents.has(identity) || componentExpansions.has(identity)) return;
      phaseTwoQueuedComponents.add(identity);
      phaseTwoQueue.push({
        depth,
        exportNames: Object.freeze(names),
        importerPath,
        kind: 'component',
        occurrenceStart,
        sourcePath: normalizedPath,
      });
    };
    const queueSupport = (
      sourcePath: string,
      depth: number,
      importerPath: string,
      occurrenceStart: number,
    ): void => {
      const normalizedPath = path.normalize(sourcePath);
      if (admittedKinds.has(normalizedPath) || phaseTwoQueuedSupport.has(normalizedPath)) return;
      phaseTwoQueuedSupport.add(normalizedPath);
      phaseTwoQueue.push({
        depth,
        importerPath,
        kind: 'support',
        occurrenceStart,
        sourcePath: normalizedPath,
      });
    };
    queueComponent(
      slicedExecutionRoot.sourcePath,
      [slicedExecutionRoot.exportName],
      0,
      path.normalize(slicedExecutionRoot.sourcePath),
      0,
    );
    while (phaseTwoQueue.size > 0 && !phaseTwoFailure) {
      const item = phaseTwoQueue.popMinimum();
      if (item === undefined) continue;
      const node = await readNode(item.sourcePath);
      if (node.failure !== undefined) {
        reasons.add(node.failure);
        phaseTwoFailure = true;
        continue;
      }
      if (item.kind === 'support') {
        if (!admittedKinds.has(item.sourcePath)) {
          if (
            admittedKinds.size + 1 > options.policy.maximumAuthoredModules ||
            sourceBytes + node.byteLength > options.policy.maximumSourceBytes
          ) {
            reasons.add('frontier-mismatch');
            phaseTwoFailure = true;
            continue;
          }
          admittedKinds.set(item.sourcePath, 'optional-support');
          sourceBytes += node.byteLength;
          maximumDepth = Math.max(maximumDepth, item.depth);
        }
        for (const edge of node.staticEdges) {
          if (edge.kind === 'package-demand') {
            packageDemandPaths.add(item.sourcePath);
            continue;
          }
          if (edge.targetPath === undefined) continue;
          if (!processedStaticEdges.has(edge.identity)) {
            processedStaticEdges.add(edge.identity);
            authoredEdgeCount += 1;
          }
          queueSupport(edge.targetPath, item.depth + 1, item.sourcePath, edge.occurrenceStart ?? 0);
        }
        continue;
      }
      const exportNames = item.exportNames ?? [];
      const expansionIdentity = `${item.sourcePath}\0${exportNames.join('\0')}`;
      if (componentExpansions.has(expansionIdentity)) continue;
      componentExpansions.add(expansionIdentity);
      const recordedExports = optionalExportsByPath.get(item.sourcePath) ?? new Set<string>();
      for (const exportName of exportNames) recordedExports.add(exportName);
      optionalExportsByPath.set(item.sourcePath, recordedExports);
      if (!admittedKinds.has(item.sourcePath)) {
        if (
          admittedKinds.size + 1 > options.policy.maximumAuthoredModules ||
          sourceBytes + node.byteLength > options.policy.maximumSourceBytes
        ) {
          reasons.add('frontier-mismatch');
          phaseTwoFailure = true;
          continue;
        }
        admittedKinds.set(item.sourcePath, 'page-shell-component');
        sourceBytes += node.byteLength;
        maximumDepth = Math.max(maximumDepth, item.depth);
      }
      const sourceText = await readRawSource(item.sourcePath);
      if (sourceText === undefined) {
        reasons.add('exact-source-unreadable');
        phaseTwoFailure = true;
        continue;
      }
      const representation =
        item.sourcePath === path.normalize(slicedExecutionRoot.sourcePath)
          ? slicedExecutionRoot.strategy === 'inner-local-component-slice' &&
            slicedExecutionRoot.localName !== undefined
            ? createPreviewInspectorLocalComponentSlice({
                localName: slicedExecutionRoot.localName,
                preservedWrapperKinds: slicedExecutionRoot.preservedWrapperKinds ?? [],
                sourcePath: item.sourcePath,
                sourceText,
              })
            : createPreviewInspectorSelectedExportSlice({
                exportName: slicedExecutionRoot.exportName,
                sourcePath: item.sourcePath,
                sourceText,
              })
          : undefined;
      if (representation !== undefined && representation.kind !== 'success') {
        reasons.add('slice-unavailable');
        phaseTwoFailure = true;
        continue;
      }
      const inventorySource =
        representation?.kind === 'success' ? representation.slice.contents : sourceText;
      const projections = collectPreviewInspectorShallowProjectionInventory(
        item.sourcePath,
        inventorySource,
        new Set(exportNames),
      );
      if (projections.truncated) {
        reasons.add('frontier-mismatch');
        phaseTwoFailure = true;
        continue;
      }
      const runtimeEdges = collectPreviewInspectorRuntimeImportInventory(
        item.sourcePath,
        inventorySource,
      );
      for (const projection of projections.projectionsBySpecifier.values()) {
        const edge = runtimeEdges.find(
          (candidate) => candidate.moduleSpecifier === projection.moduleSpecifier,
        );
        if (edge === undefined) continue;
        const resolved = resolveModule(projection.moduleSpecifier, item.sourcePath);
        if (resolved === undefined || !checkAuthoredPath(resolved)) {
          if (
            projection.moduleSpecifier.startsWith('.') ||
            path.isAbsolute(projection.moduleSpecifier)
          ) {
            reasons.add('frontier-mismatch');
            phaseTwoFailure = true;
            break;
          }
          continue;
        }
        queueComponent(
          path.normalize(resolved),
          projection.exportNames,
          item.depth + 1,
          item.sourcePath,
          edge.occurrenceStart,
        );
      }
      if (phaseTwoFailure) continue;
      for (const edge of node.staticEdges) {
        if (edge.kind === 'package-demand') {
          packageDemandPaths.add(item.sourcePath);
          continue;
        }
        if (edge.targetPath === undefined) continue;
        if (!processedStaticEdges.has(edge.identity)) {
          processedStaticEdges.add(edge.identity);
          authoredEdgeCount += 1;
        }
        if (
          edge.moduleSpecifier !== undefined &&
          projections.projectionsBySpecifier.has(edge.moduleSpecifier)
        )
          continue;
        queueSupport(edge.targetPath, item.depth + 1, item.sourcePath, edge.occurrenceStart ?? 0);
      }
    }
  }
  const authenticSourcePaths = Object.freeze([...admittedKinds.keys()].sort());
  const exactSourcePaths = Object.freeze(
    authenticSourcePaths.filter((sourcePath) => admittedKinds.get(sourcePath) === 'exact'),
  );
  const optionalSourcePaths = authenticSourcePaths.filter(
    (sourcePath) =>
      admittedKinds.get(sourcePath) === 'optional-component' ||
      admittedKinds.get(sourcePath) === 'page-shell-component' ||
      admittedKinds.get(sourcePath) === 'target-component',
  );
  // A component demand can be admitted through an exact closure as support.
  // Keep its recorded export contract even when that admission class is not
  // itself optional: the frozen corridor needs it only to project one proven
  // child edge, never to expand frontier membership.
  const authenticComponentSourcePaths = authenticSourcePaths.filter((sourcePath) =>
    optionalExportsByPath.has(sourcePath),
  );
  const effectiveProjectedEdges = projectedEdges.filter(
    (edge) => edge.targetPath === undefined || !admittedKinds.has(edge.targetPath),
  );
  const packageDemandSourcePaths = Object.freeze([...packageDemandPaths].sort());
  const truncationReasons = Object.freeze(sortPreviewInspectorBundleFrontierReasons(reasons));
  const boundedProjectionCount = effectiveProjectedEdges.filter(
    (edge) => edge.reason === 'budget-projection',
  ).length;
  const summary = Object.freeze({
    authoredEdgeCount,
    ...(boundedProjectionCount === 0 ? {} : { boundedProjectionCount }),
    exactModuleCount: exactSourcePaths.length,
    maximumDepth,
    optionalComponentCount: optionalSourcePaths.length,
    packageDemandSourceCount: packageDemandSourcePaths.length,
    projectedEdgeCount: effectiveProjectedEdges.length,
    sourceBytes,
    supportModuleCount:
      countKinds(admittedKinds, 'support') + countKinds(admittedKinds, 'optional-support'),
    totalAuthoredModuleCount: authenticSourcePaths.length,
    truncationReasons,
  });
  return Object.freeze({
    authenticComponentExports: Object.freeze(
      authenticComponentSourcePaths.map((sourcePath) =>
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
    projectedEdges: Object.freeze([...effectiveProjectedEdges].sort(compareProjectedEdges)),
    rejected: truncationReasons.length > 0,
    sourceKinds: Object.freeze(
      Object.fromEntries(
        [...admittedKinds.entries()].map(([sourcePath, kind]) => [
          sourcePath,
          kind === 'exact'
            ? ('critical-surface' as const)
            : kind === 'optional-component' ||
                kind === 'page-shell-component' ||
                kind === 'target-component'
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
