import path from 'node:path';
import type { PreviewBuildRequest } from '../../domain/preview';
import type {
  CollectPreviewInspectorCompleteRouteInventoryOptions,
  PreviewCompleteRouteInventoryTelemetryEmitter,
  PreviewInspectorCompleteRouteInventoryLimits,
} from './inspector/previewInspectorCompleteRouteInventory';
import {
  assertPreviewResolutionPath,
  type normalizePreviewResolutionConfinement,
} from './previewResolutionConfinement';
import type { PreviewCompilerTargetSelection } from './previewImperativeEntryTarget';
import type { PreviewProjectUsageCache } from './previewProjectUsageCache';
import { createPreviewStaticModuleResolver } from './previewStaticModuleResolver';
import { findPreviewProjectRoot } from './previewProjectRoot';

export interface PreparePreviewCompleteRouteInventoryAnalysisOptions {
  readonly cache: PreviewProjectUsageCache;
  readonly canonicalWorkspaceRoot: string;
  readonly documentPath: string;
  readonly exportName: string;
  readonly limits?: Partial<PreviewInspectorCompleteRouteInventoryLimits>;
  readonly request: PreviewBuildRequest;
  readonly resolutionConfinement: ReturnType<typeof normalizePreviewResolutionConfinement>;
  readonly targetSelection: PreviewCompilerTargetSelection;
  readonly telemetry?: PreviewCompleteRouteInventoryTelemetryEmitter;
}

/** Prepares one inert source/resolution context shared by inventory collection and exact replay. */
export async function preparePreviewCompleteRouteInventoryAnalysis(
  options: PreparePreviewCompleteRouteInventoryAnalysisOptions,
): Promise<Omit<CollectPreviewInspectorCompleteRouteInventoryOptions, 'prepareExecutionPlan'>> {
  const {
    cache,
    canonicalWorkspaceRoot,
    documentPath,
    exportName,
    request,
    resolutionConfinement,
    targetSelection,
  } = options;
  options.telemetry?.emit({
    phase: 'prepare-source-index',
    transition: 'start',
  });
  const projectRoot = await findPreviewProjectRoot(documentPath, canonicalWorkspaceRoot);
  const sourcePaths = await cache.getSourcePaths(canonicalWorkspaceRoot, projectRoot);
  options.telemetry?.emit({
    phase: 'prepare-source-index',
    transition: 'complete',
  });
  const baseResolver = createPreviewStaticModuleResolver({
    ...(request.tsconfigPath === undefined ? {} : { configuredTsconfigPath: request.tsconfigPath }),
    workspaceRoot: canonicalWorkspaceRoot,
  });
  const resolver =
    resolutionConfinement === undefined
      ? baseResolver
      : {
          ...baseResolver,
          resolve(moduleSpecifier: string, consumerPath: string) {
            assertPreviewResolutionPath(resolutionConfinement, consumerPath);
            const resolved = baseResolver.resolve(moduleSpecifier, consumerPath);
            if (resolved !== undefined) {
              assertPreviewResolutionPath(resolutionConfinement, resolved);
            }
            return resolved;
          },
        };
  options.telemetry?.emit({
    phase: 'prepare-target-usage',
    transition: 'start',
  });
  const targetUsage = await cache.discover({
    climbParentSlices: false,
    documentPath,
    exports: targetSelection.targetExports,
    inspectorExportName: exportName,
    projectRoot,
    snapshots: request.dependencySnapshots,
    sourceText: targetSelection.sourceText,
    ...(request.tsconfigPath === undefined ? {} : { tsconfigPath: request.tsconfigPath }),
    workspaceRoot: canonicalWorkspaceRoot,
  });
  options.telemetry?.emit({
    phase: 'prepare-target-usage',
    transition: 'complete',
  });
  const renderChain =
    targetUsage.inspectorPlan?.renderChainsByExport[exportName] ??
    targetUsage.renderChainsByExport?.[exportName] ??
    Object.freeze({
      dependencyPaths: Object.freeze([documentPath]),
      paths: Object.freeze([]),
      reachability: 'entry-unreachable' as const,
      stopReason: 'entry-not-found' as const,
      target: Object.freeze({ exportName, sourcePath: documentPath }),
      truncated: false,
    });
  const snapshotTextByPath = new Map(
    request.dependencySnapshots.map((snapshot) => [
      path.normalize(snapshot.documentPath),
      snapshot.sourceText,
    ]),
  );
  snapshotTextByPath.set(documentPath, targetSelection.sourceText);
  return Object.freeze({
    documentPath,
    exportName,
    ...(options.limits === undefined ? {} : { limits: options.limits }),
    readSource: async (sourcePath: string) => {
      if (resolutionConfinement !== undefined) {
        assertPreviewResolutionPath(resolutionConfinement, sourcePath);
      }
      const snapshotText = snapshotTextByPath.get(path.normalize(sourcePath));
      return cache.readSourceText({
        maximumBytes: 8 * 1_024 * 1_024,
        ...(snapshotText === undefined ? {} : { snapshotText }),
        sourcePath,
      });
    },
    renderChain,
    resolveModule: resolver.resolve,
    sourcePaths,
    ...(options.telemetry === undefined ? {} : { telemetry: options.telemetry }),
  });
}
