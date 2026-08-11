/**
 * Prepares the one final Inspector frontier shared by artifact authority and native compilation.
 */
import path from 'node:path';
import type { PreviewBuildRequest } from '../../domain/preview';
import {
  createEligiblePreviewInspectorPageExecutionCandidates,
  createPreviewInspectorExecutablePlan,
} from './inspector';
import type { PreviewInspectorAncestorPlan } from './inspector/previewInspectorAncestorTypes';
import type { PreviewInspectorBundleSourceInventoryMemo } from './inspector/previewInspectorBundleFrontier';
import type { PreviewInspectorPageExecutionCandidate } from './inspector/previewInspectorPageExecutionTypes';
import { inferPreviewInspectorPageExecutionRootProps } from './inspector/previewInspectorPageExecutionRootInference';
import {
  createPreviewGlobalPackageBridgeEvidencePolicy,
  type PreviewGlobalPackageBridgeEvidencePolicy,
} from './globalPackageBridge';
import type { PreviewImplicitGlobalEvidenceInventory } from './previewImplicitGlobalEvidence';
import type { PreviewImplicitGlobalEvidenceCache } from './previewImplicitGlobalEvidenceCache';
import { preparePreviewImplicitGlobalEvidence } from './previewFastImplicitGlobalEvidence';
import {
  createImplicitGlobalEvidenceCacheKey,
  MAXIMUM_PREVIEW_ROUTE_SOURCE_BYTES,
} from './previewCompilerDefaults';
import {
  preparePreviewInspectorBundleExecution,
  type PreparedPreviewInspectorBundleExecution,
} from './preparePreviewInspectorBundleExecution';
import { collectPreviewInspectorRuntimeCompanionPaths } from './previewImplicitGlobalRuntimeCompanions';
import type { PreviewPreparationPolicy } from './previewPreparationPolicy';
import type { PreviewCompilerTargetSelection } from './previewImperativeEntryTarget';
import {
  emitPreviewRouteExecutionTelemetry,
  preparePreviewRouteExecutionPlanner,
  type PreparedPreviewRouteExecutionPlanner,
  type PreviewRouteExecutionTelemetryContext,
} from './preparePreviewRouteExecutionPlanner';
import {
  completePreviewStyleContextTailwindCandidates,
  preparePreviewStyleContext,
  type PreparedPreviewStyleContext,
  type ReadPreviewStyleContextSource,
} from './preparePreviewStyleContext';
import type { PreviewStaticModuleResolver } from './previewStaticModuleResolver';
import type { PreviewTargetUsageProps } from './previewTargetUsageProps';
import type { PreviewThemeImportSelection } from './previewTargetExports';

export interface PreparePreviewRouteExecutionFinalFrontierOptions {
  readonly contextDiscoveryTruncated: boolean;
  readonly directThemeImport?: PreviewThemeImportSelection;
  readonly implicitGlobalEvidenceCache: PreviewImplicitGlobalEvidenceCache;
  readonly implicitGlobalSourcePaths: readonly string[];
  readonly inspectorExportName?: string;
  readonly policy: PreviewPreparationPolicy;
  readonly projectRoot: string;
  readonly readProjectSource: ReadPreviewStyleContextSource;
  readonly request: PreviewBuildRequest;
  readonly routeId?: string;
  readonly runtimeDependencyPaths: readonly string[];
  readonly runtimeSetupModulePath?: string;
  readonly signal?: AbortSignal;
  readonly sourceInventoryMemo?: PreviewInspectorBundleSourceInventoryMemo;
  readonly staticModuleResolver: PreviewStaticModuleResolver;
  readonly targetSelection: PreviewCompilerTargetSelection;
  readonly targetUsageProps: PreviewTargetUsageProps;
  readonly telemetry?: PreviewRouteExecutionTelemetryContext;
  readonly workspaceRoot: string;
}

export interface PreparedPreviewRouteExecutionFinalFrontier {
  readonly activeInspectorDependencyPaths: readonly string[];
  readonly activeInspectorPlan?: PreviewInspectorAncestorPlan;
  readonly globalBridgeEvidencePolicy: PreviewGlobalPackageBridgeEvidencePolicy;
  readonly implicitGlobalEvidence: PreviewImplicitGlobalEvidenceInventory;
  readonly pageExecutionCandidates: readonly PreviewInspectorPageExecutionCandidate[];
  readonly plannedRouteExecution?: PreparedPreviewRouteExecutionPlanner;
  readonly preparedBundleExecution?: PreparedPreviewInspectorBundleExecution;
  readonly primaryRenderPath?: NonNullable<
    PreviewInspectorAncestorPlan['pageCandidates'][number]['renderPath']
  >;
  readonly runtimeCompanionSourcePaths: readonly string[];
  readonly styleContext: PreparedPreviewStyleContext;
}

/**
 * Resolves style and runtime companions before preparing the final frontier exactly once.
 *
 * Inventory supplies `routeId`; compilation supplies `request.routeExecutionPlan`. Ordinary builds
 * supply neither and retain the existing artifact-free frontier and ownership behavior.
 */
export async function preparePreviewRouteExecutionFinalFrontier(
  options: PreparePreviewRouteExecutionFinalFrontierOptions,
): Promise<PreparedPreviewRouteExecutionFinalFrontier> {
  const request = options.request;
  const analysisPlan = options.targetUsageProps.inspectorPlan;
  const activeInspectorPlan =
    analysisPlan === undefined
      ? undefined
      : createPreviewInspectorExecutablePlan(analysisPlan, request.inspectorPageCandidateId);
  const rawPageExecutionCandidates =
    activeInspectorPlan === undefined
      ? []
      : createEligiblePreviewInspectorPageExecutionCandidates(
          analysisPlan ?? activeInspectorPlan,
          request.inspectorPageCandidateId,
          undefined,
          request.inspectorTargetMode,
        );
  const primaryRenderPath =
    activeInspectorPlan?.pageCandidates[0]?.renderPath ??
    analysisPlan?.renderChain.paths[0] ??
    (options.inspectorExportName === undefined
      ? undefined
      : options.targetUsageProps.renderChainsByExport?.[options.inspectorExportName]?.paths[0]);
  const activeInspectorDependencyPaths = activeInspectorPlan?.dependencyPaths ?? [];
  const applicationStyleRoots = collectPreviewApplicationStyleRoots(
    activeInspectorPlan?.pageCandidates ?? analysisPlan?.pageCandidates ?? [],
  );
  emitPreviewRouteExecutionTelemetry(options.telemetry, 'execution-frontier-style', 'start');
  const styleContext = await preparePreviewStyleContext({
    applicationStyleRoots,
    ...(options.directThemeImport === undefined
      ? {}
      : { directThemeImport: options.directThemeImport }),
    inspectorDependencyPaths: activeInspectorDependencyPaths,
    portalHostDependencyPaths:
      options.policy.discoveryScope === 'selected-corridor'
        ? activeInspectorDependencyPaths
        : options.targetUsageProps.dependencyPaths,
    projectRoot: options.projectRoot,
    styleEvidence: options.policy.styleEvidence,
    readSource: options.readProjectSource,
    ...(primaryRenderPath === undefined ? {} : { renderPath: primaryRenderPath }),
    ...(activeInspectorPlan?.pageCandidates[0] === undefined
      ? {}
      : {
          mountedRoot: {
            exportName: activeInspectorPlan.pageCandidates[0].root.exportName,
            sourcePath: activeInspectorPlan.pageCandidates[0].root.sourcePath,
            ...(activeInspectorPlan.pageCandidates[0].rootStepIndex === undefined
              ? {}
              : { rootStepIndex: activeInspectorPlan.pageCandidates[0].rootStepIndex }),
          },
        }),
    request,
    staticModuleResolver: options.staticModuleResolver,
    workspaceRoot: options.workspaceRoot,
  });
  emitPreviewRouteExecutionTelemetry(options.telemetry, 'execution-frontier-style', 'complete');
  const snapshotSourceByPath = styleContext.snapshotSourceByPath;
  emitPreviewRouteExecutionTelemetry(options.telemetry, 'execution-frontier-globals', 'start');
  const implicitGlobalEvidence = await preparePreviewImplicitGlobalEvidence({
    cache: options.implicitGlobalEvidenceCache,
    cacheKey: createImplicitGlobalEvidenceCacheKey(options.projectRoot, request.tsconfigPath),
    fallbackSourcePaths: options.implicitGlobalSourcePaths,
    fast: options.policy.mode === 'fast',
    inspectorDependencyPaths: options.targetUsageProps.dependencyPaths,
    pageInspector: request.renderMode === 'page-inspector',
    prioritizedSourcePath: primaryRenderPath?.entryPoint?.sourcePath,
    readSource: (sourcePath) => snapshotSourceByPath.get(path.normalize(sourcePath)),
    resolveModule: options.staticModuleResolver.resolve,
    runtimeDependencyPaths: options.runtimeDependencyPaths,
    ...(options.signal === undefined ? {} : { signal: options.signal }),
    snapshotSourceByPath,
  });
  emitPreviewRouteExecutionTelemetry(options.telemetry, 'execution-frontier-globals', 'complete');
  const globalBridgeEvidencePolicy =
    createPreviewGlobalPackageBridgeEvidencePolicy(implicitGlobalEvidence);
  const shouldPrepareArtifact =
    options.routeId !== undefined || request.routeExecutionPlan !== undefined;
  const baseRuntimeCompanionSourcePaths = collectPreviewInspectorRuntimeCompanionPaths({
    globalBridgePolicy: globalBridgeEvidencePolicy,
    globalStyleImports: styleContext.globalStyleImports,
    resolveModule: options.staticModuleResolver.resolve,
    ...(styleContext.themeImport === undefined ? {} : { themeImport: styleContext.themeImport }),
    themeImporterPath: request.documentPath,
  });
  const runtimeCompanionSourcePaths = Object.freeze(
    [
      ...new Set([
        ...baseRuntimeCompanionSourcePaths,
        ...(!shouldPrepareArtifact || options.runtimeSetupModulePath === undefined
          ? []
          : [path.normalize(options.runtimeSetupModulePath)]),
      ]),
    ].sort(),
  );
  const readFrontierSource = async (sourcePath: string): Promise<string | undefined> =>
    snapshotSourceByPath.get(path.normalize(sourcePath)) ??
    options.readProjectSource({
      maximumBytes: MAXIMUM_PREVIEW_ROUTE_SOURCE_BYTES,
      sourcePath,
    });
  const pageExecutionCandidates = await inferPreviewInspectorPageExecutionRootProps({
    candidates: rawPageExecutionCandidates,
    readSource: readFrontierSource,
    resolveModule: options.staticModuleResolver.resolve,
    snapshotSourceByPath,
    workspaceRoot: options.workspaceRoot,
  });
  const requestedPageExecutionCandidates =
    request.inspectorPageExecutionCandidateId === undefined
      ? pageExecutionCandidates
      : pageExecutionCandidates.filter(
          (candidate) => candidate.id === request.inspectorPageExecutionCandidateId,
        );
  const activePageExecutionCandidates =
    requestedPageExecutionCandidates.length === 0
      ? pageExecutionCandidates
      : requestedPageExecutionCandidates;
  const plannedRouteExecution = shouldPrepareArtifact
    ? await preparePreviewRouteExecutionPlanner({
        contextDiscoveryTruncated: options.contextDiscoveryTruncated,
        policy: options.policy,
        projectRoot: options.projectRoot,
        readSource: readFrontierSource,
        request,
        resolveModule: options.staticModuleResolver.resolve,
        ...(options.routeId === undefined ? {} : { routeId: options.routeId }),
        runtimeCompanionSourcePaths,
        ...(options.sourceInventoryMemo === undefined
          ? {}
          : { sourceInventoryMemo: options.sourceInventoryMemo }),
        styleSnapshotCount: styleContext.tailwindCandidateSnapshots.length,
        targetSelection: options.targetSelection,
        targetUsageProps: options.targetUsageProps,
        ...(options.telemetry === undefined ? {} : { telemetry: options.telemetry }),
        workspaceRoot: options.workspaceRoot,
      })
    : undefined;
  const preparedBundleExecution =
    plannedRouteExecution?.preparedBundleExecution ??
    (shouldPrepareArtifact
      ? undefined
      : await preparePreviewInspectorBundleExecution({
          analysisCandidateCount: analysisPlan?.pageCandidates.length ?? 0,
          runtimeCompanionSourcePaths,
          corridorSourceCount: activeInspectorDependencyPaths.length,
          dependencySnapshotCount: request.dependencySnapshots.length,
          discoveryTruncated: options.contextDiscoveryTruncated,
          executablePlan: activeInspectorPlan,
          ...(activeInspectorPlan === undefined
            ? {}
            : { executionCandidates: activePageExecutionCandidates }),
          policy: options.policy,
          readSource: readFrontierSource,
          resolveModule: options.staticModuleResolver.resolve,
          ...(options.sourceInventoryMemo === undefined
            ? {}
            : { sourceInventoryMemo: options.sourceInventoryMemo }),
          styleSnapshotCount: styleContext.tailwindCandidateSnapshots.length,
          workspaceRoot: options.workspaceRoot,
        }));
  const completedStyleContext =
    preparedBundleExecution === undefined
      ? styleContext
      : await completePreviewStyleContextTailwindCandidates({
          context: styleContext,
          readSource: async (readOptions) =>
            snapshotSourceByPath.get(path.normalize(readOptions.sourcePath)) ??
            options.readProjectSource(readOptions),
          sourcePaths: preparedBundleExecution.prepared.frontier.authenticSourcePaths,
        });
  return Object.freeze({
    activeInspectorDependencyPaths,
    ...(activeInspectorPlan === undefined ? {} : { activeInspectorPlan }),
    globalBridgeEvidencePolicy,
    implicitGlobalEvidence,
    pageExecutionCandidates: Object.freeze(pageExecutionCandidates),
    ...(plannedRouteExecution === undefined ? {} : { plannedRouteExecution }),
    ...(preparedBundleExecution === undefined ? {} : { preparedBundleExecution }),
    ...(primaryRenderPath === undefined ? {} : { primaryRenderPath }),
    runtimeCompanionSourcePaths,
    styleContext: completedStyleContext,
  });
}

/** Collects exact implicit framework wrappers that own app-level style declarations. */
function collectPreviewApplicationStyleRoots(
  pageCandidates: readonly NonNullable<PreviewInspectorAncestorPlan['pageCandidates'][number]>[],
): readonly { readonly exportName: string; readonly sourcePath: string }[] {
  const roots = new Map<string, { readonly exportName: string; readonly sourcePath: string }>();
  for (const candidate of pageCandidates) {
    const frameworkRoots = [
      ...(candidate.nextPagesShell === undefined ? [] : [candidate.nextPagesShell.app]),
      ...(candidate.nextAppLayoutChain ?? []),
    ];
    for (const root of frameworkRoots) {
      const normalizedPath = path.normalize(root.sourcePath);
      roots.set(JSON.stringify([normalizedPath, root.exportName]), {
        exportName: root.exportName,
        sourcePath: normalizedPath,
      });
    }
  }
  return Object.freeze(
    [...roots.values()].sort((left, right) => left.sourcePath.localeCompare(right.sourcePath)),
  );
}
