/** Creates the memoized exact source/slice reader used by one authored closure traversal. */
import path from 'node:path';
import { collectPreviewStyleSignals } from '../previewStyleInventory';
import { collectPreviewImportMetaGlobInventory } from '../staticResources/previewImportMetaGlobInventory';
import { STYLE_OR_ASSET_PATTERN } from './previewInspectorBundleFrontierModel';
import {
  collectSlicedSurfaces,
  createResolvedNodeFailure,
  createResolvedNodeRepresentationKey,
  createRuntimeEdgeIdentity,
} from './previewInspectorBundleRepresentations';
import { normalizeBarePackageSpecifier } from './previewInspectorBundleSeeds';
import {
  collectPreviewInspectorBundleSourceInventory,
  type PreviewInspectorBundleResolvedSourceNode,
  type PreviewInspectorBundleResolvedStaticEdge,
  type PreviewInspectorBundleSourceInventoryResult,
} from './previewInspectorBundleSourceInventoryMemo';
import {
  createPreviewInspectorLocalComponentSlice,
  createPreviewInspectorSelectedExportSlice,
  type PreviewInspectorMountSurfaceSliceResult,
} from './previewInspectorMountSurfaceSlice';
import {
  collectPreviewInspectorWholeModuleShallowProjectionInventory,
  collectPreviewInspectorRuntimeHookProjectionInventory,
  type PreviewInspectorShallowProjection,
} from './previewInspectorShallowProjection';
import { readPreviewInspectorSelectedRouteContent } from './previewInspectorSelectedRouteContent';
import { collectPreviewStaticRouteProjectionInventory } from './previewInspectorStaticRouteProjection';
import { readPreviewInspectorUnresolvedRouteFactoryOwner } from './previewInspectorUnresolvedRouteFactoryOwner';
/** Shared per-traversal maps and inert read/resolve boundaries retained by reference. */
interface PreviewInspectorBundleNodeReaderInputs {
  readonly options: import('./previewInspectorBundleFrontierModel').PreparePreviewInspectorBundleFrontierOptions;
  readonly authenticInventorySourcePaths: ReadonlySet<string>;
  readonly sourceCache: Map<
    string,
    Promise<
      import('./previewInspectorBundleSourceInventoryMemo').PreviewInspectorBundleResolvedSourceNode
    >
  >;
  readonly diagnostics:
    | import('./previewInspectorBundleDiagnostics').PreviewInspectorBundleDiagnosticsCollector
    | undefined;
  readonly readRawSource: (sourcePath: string) => Promise<string | undefined>;
  readonly resolveModule: (specifier: string, importer: string) => string | undefined;
  readonly checkAuthoredPath: (sourcePath: string) => boolean;
  readonly graphMemo:
    | import('./previewInspectorBundleSourceInventoryMemo').PreviewInspectorBundleSourceInventoryMemo
    | undefined;
}
/** Preserves pending-work coalescing, structural failures, and exact representation identities. */
export function createPreviewInspectorBundleNodeReader(
  inputs: PreviewInspectorBundleNodeReaderInputs,
): (
  sourcePath: string,
) => Promise<
  import('./previewInspectorBundleSourceInventoryMemo').PreviewInspectorBundleResolvedSourceNode
> {
  const selectedRouteContent = readPreviewInspectorSelectedRouteContent(
    inputs.options.executionCandidate,
  );
  const unresolvedFactoryOwner = readPreviewInspectorUnresolvedRouteFactoryOwner(
    inputs.options.plan,
    inputs.options.executionCandidate,
  );
  const readNode = (sourcePath: string): Promise<PreviewInspectorBundleResolvedSourceNode> => {
    const normalizedSourcePath = path.normalize(sourcePath);
    const representationKey = createResolvedNodeRepresentationKey(
      inputs.options,
      inputs.authenticInventorySourcePaths,
      normalizedSourcePath,
    );
    const cached = inputs.sourceCache.get(representationKey);
    if (cached !== undefined) {
      inputs.diagnostics?.recordInventoryRead(true);
      return cached;
    }
    const compute = async (): Promise<PreviewInspectorBundleResolvedSourceNode> => {
      inputs.diagnostics?.recordInventoryRead(false);
      const sourceText = await inputs.readRawSource(normalizedSourcePath);
      if (sourceText === undefined)
        return createResolvedNodeFailure(
          normalizedSourcePath,
          representationKey,
          'exact-source-unreadable',
        );
      const slicedSurfaces = collectSlicedSurfaces(
        inputs.options.executionCandidate,
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
        const before =
          inputs.diagnostics && inputs.options.sourceInventoryMemo?.getSliceStatistics();
        const collectSlice = (): PreviewInspectorMountSurfaceSliceResult =>
          slicedSurface.strategy === 'inner-local-component-slice' &&
          slicedSurface.localName !== undefined
            ? (inputs.options.sourceInventoryMemo?.collectLocalComponentSlice(
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
            : (inputs.options.sourceInventoryMemo?.collectSelectedExportSlice(
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
          inputs.diagnostics === undefined
            ? collectSlice()
            : inputs.diagnostics.measureSliceLookup(collectSlice);
        const after =
          inputs.diagnostics && inputs.options.sourceInventoryMemo?.getSliceStatistics();
        inputs.diagnostics?.recordSliceMemoDelta(
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
      const inventorySource = inputs.authenticInventorySourcePaths.has(normalizedSourcePath)
        ? sourceText
        : slice?.kind === 'success'
          ? slice.slice.contents
          : sourceText;
      const before = inputs.diagnostics && inputs.options.sourceInventoryMemo?.getStatistics();
      const collectInventory = (): PreviewInspectorBundleSourceInventoryResult =>
        inputs.options.sourceInventoryMemo?.collect(normalizedSourcePath, inventorySource) ??
        collectPreviewInspectorBundleSourceInventory(normalizedSourcePath, inventorySource);
      const inventory =
        inputs.diagnostics === undefined
          ? collectInventory()
          : inputs.diagnostics.measureInventoryLookup(collectInventory);
      const after = inputs.diagnostics && inputs.options.sourceInventoryMemo?.getStatistics();
      inputs.diagnostics?.recordInventoryMemoDelta(
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
      const runtimeHookProjections =
        slice === undefined
          ? collectPreviewInspectorRuntimeHookProjectionInventory(
              normalizedSourcePath,
              inventorySource,
            ).projectionsBySpecifier
          : new Map<string, PreviewInspectorShallowProjection>();
      const staticRouteInventory =
        slice === undefined
          ? collectPreviewStaticRouteProjectionInventory(
              normalizedSourcePath,
              inventorySource,
              unresolvedFactoryOwner,
            )
          : undefined;
      const routeContentProjections =
        selectedRouteContent?.sourcePath === normalizedSourcePath
          ? collectPreviewInspectorWholeModuleShallowProjectionInventory(
              normalizedSourcePath,
              inventorySource,
            ).projectionsBySpecifier
          : undefined;
      const staticEdges: PreviewInspectorBundleResolvedStaticEdge[] = [];
      for (const edge of inventory.edges) {
        inputs.diagnostics?.recordEdgeVisit();
        if (edge.kind === 'dynamic-import' || STYLE_OR_ASSET_PATTERN.test(edge.moduleSpecifier))
          continue;
        const identity = createRuntimeEdgeIdentity(normalizedSourcePath, edge);
        const resolved = inputs.resolveModule(edge.moduleSpecifier, normalizedSourcePath);
        if (resolved !== undefined && inputs.checkAuthoredPath(resolved)) {
          const runtimeHookProjection = runtimeHookProjections.get(edge.moduleSpecifier);
          const staticRouteProjection = staticRouteInventory?.projectionsBySpecifier.get(
            edge.moduleSpecifier,
          );
          const projection: PreviewInspectorShallowProjection | undefined =
            runtimeHookProjection ??
            routeContentProjections?.get(edge.moduleSpecifier) ??
            (staticRouteProjection === undefined
              ? undefined
              : {
                  exportNames: staticRouteProjection.exportNames,
                  moduleSpecifier: staticRouteProjection.moduleSpecifier,
                  ...(staticRouteProjection.neutralRouteBasePath === undefined
                    ? {}
                    : {
                        neutralRouteBasePath: staticRouteProjection.neutralRouteBasePath,
                      }),
                  runtimeHookExportNames: Object.freeze([]),
                });
          staticEdges.push(
            Object.freeze({
              identity,
              importedNames: Object.freeze([...edge.importedNames]),
              kind: 'authored' as const,
              moduleSpecifier: edge.moduleSpecifier,
              occurrenceStart: edge.occurrenceStart,
              ...(projection === undefined
                ? {}
                : {
                    projection: Object.freeze({
                      exportNames: Object.freeze([...projection.exportNames]),
                      moduleSpecifier: projection.moduleSpecifier,
                      ...(projection.neutralRouteBasePath === undefined
                        ? {}
                        : { neutralRouteBasePath: projection.neutralRouteBasePath }),
                      occurrenceStart: edge.occurrenceStart,
                      runtimeHookExportNames: Object.freeze([...projection.runtimeHookExportNames]),
                    }),
                  }),
              targetPath: path.normalize(resolved),
            }),
          );
          continue;
        }
        if (normalizeBarePackageSpecifier(edge.moduleSpecifier) !== undefined)
          staticEdges.push(
            Object.freeze({
              identity,
              importedNames: Object.freeze([...edge.importedNames]),
              kind: 'package-demand' as const,
              moduleSpecifier: edge.moduleSpecifier,
              occurrenceStart: edge.occurrenceStart,
            }),
          );
      }
      if (slice === undefined && inventorySource.includes('styled-components')) {
        for (const signal of collectPreviewStyleSignals(normalizedSourcePath, inventorySource)) {
          const resolved = inputs.resolveModule(signal.moduleSpecifier, normalizedSourcePath);
          if (resolved === undefined || !inputs.checkAuthoredPath(resolved)) continue;
          staticEdges.push(
            Object.freeze({
              compilerGeneratedSupport: true as const,
              identity: `${normalizedSourcePath}\0preview-generated-theme\0${signal.moduleSpecifier}\0${signal.exportName}`,
              importedNames: Object.freeze([signal.exportName]),
              kind: 'authored' as const,
              moduleSpecifier: signal.moduleSpecifier,
              occurrenceStart: 0,
              targetPath: path.normalize(resolved),
            }),
          );
        }
      }
      for (const reference of await collectPreviewImportMetaGlobInventory({
        projectRoot: inputs.options.projectRoot ?? inputs.options.workspaceRoot,
        sourcePath: normalizedSourcePath,
        sourceText: inventorySource,
        workspaceRoot: inputs.options.workspaceRoot,
      })) {
        const resolved = inputs.resolveModule(reference.moduleSpecifier, normalizedSourcePath);
        if (resolved === undefined || !inputs.checkAuthoredPath(resolved)) continue;
        staticEdges.push(
          Object.freeze({
            compilerGeneratedSupport: true as const,
            identity: `${normalizedSourcePath}\0preview-generated-import-meta-glob\0${reference.occurrenceStart.toString()}\0${reference.moduleSpecifier}`,
            importedNames: Object.freeze([]),
            kind: 'authored' as const,
            moduleSpecifier: reference.moduleSpecifier,
            occurrenceStart: reference.occurrenceStart,
            targetPath: path.normalize(resolved),
          }),
        );
      }
      return Object.freeze({
        byteLength: inventory.byteLength,
        edges: inventory.edges,
        representationKey,
        sourcePath: normalizedSourcePath,
        staticEdges: Object.freeze(staticEdges),
      });
    };
    const read =
      inputs.graphMemo?.collectResolvedSourceNode(representationKey, compute) ?? compute();
    inputs.sourceCache.set(representationKey, read);
    return read;
  };
  return readNode;
}
