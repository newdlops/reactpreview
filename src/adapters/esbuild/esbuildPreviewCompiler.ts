/* eslint-disable jsdoc/require-jsdoc, max-lines -- Central compiler orchestration remains intentionally colocated. */
import { createHash, randomBytes } from 'node:crypto';
import path from 'node:path';
import ts from 'typescript';
import type { PreviewCompiler } from '../../application/previewCompiler';
import {
  PreviewCompilationError,
  type PreviewBuildRequest,
  type PreviewBundle,
  type PreviewDiagnostic,
  type PreviewRouteExecutionPlanArtifact,
} from '../../domain/preview';
import type { PreviewCompilerGraphSummary } from '../../domain/previewCompilerActivity';
// prettier-ignore
import { throwIfPreviewBuildCancelled, type PreviewBuildExecutionContext } from '../../domain/previewBuildExecution';
import { canonicalizeExistingPath } from '../../shared/pathIdentity';
import {
  EMPTY_MANAGED_ENVIRONMENT,
  PreviewManagedDependencyStore,
  type PreviewManagedDependencyEnvironment,
} from '../node/previewManagedDependencyStore';
import {
  findPreviewDependencySpecifier,
  readPreviewDependencyProfile,
} from '../node/previewDependencyProfile';
import { findPreviewYarnLockedPackageVersion } from '../node/previewYarnLockPlan';
import { createPreviewEntry } from './createPreviewEntry';
// prettier-ignore
import { createPreviewInspectorExecutionRootModuleContract, createPreviewInspectorPageExecutionBuildPlugin, createPreviewInspectorRootPlugin, createPreviewInspectorTargetModuleContract, createPreviewInspectorTargetPlugin, resolvePreviewInspectorRuntimeOwnershipTarget, resolvePreviewInspectorRuntimeTargetMode } from './inspector';
import { createPreviewInspectorCorridorPlugin } from './inspector/previewInspectorCorridorPlugin';
import {
  collectPreviewInspectorCompleteRouteInventory,
  createPreviewCompleteRouteInventoryTelemetryEmitter,
  PREVIEW_COMPLETE_ROUTE_REPLAY_POLICY_DIGEST,
  PREVIEW_COMPLETE_ROUTE_REPLAY_POLICY_VERSION,
  replayPreviewInspectorCompleteRouteEntry,
  type PreviewCompleteRouteInventoryExecutionProgress,
  type PreviewCompleteRouteInventoryTelemetryEmitter,
  type PreviewCompleteRouteInventoryTelemetryObserver,
  type PreviewInspectorCompleteRouteBaseEntry,
  type PreviewInspectorCompleteRouteInventory,
  type PreviewInspectorCompleteRouteInventoryLimits,
  type PreviewInspectorExactRouteReplayResult,
  type PreviewInspectorPlanlessRunnableRoute,
} from './inspector/previewInspectorCompleteRouteInventory';
import {
  createPreviewInspectorBundleSourceInventoryMemo,
  type PreviewInspectorBundleSourceInventoryMemo,
} from './inspector/previewInspectorBundleFrontier';
import { createInspectorSourceGestureSecret } from './previewInspectorSourceGestureSecret';
import { createPreviewInspectorRuntimePlugin } from './pageInspector';
import {
  isPreviewInspectorEffectControllerRenderOutcomePlan,
  isPreviewInspectorNavigationOnlyRenderOutcomePlan,
} from './pageInspector/previewInspectorTargetOutputRuntimeSource';
import { analyzePreviewReactRenderOutcomes } from './staticResources/previewReactRenderOutcomes';
// prettier-ignore
import { createPreviewGlobalPackageBridgePlugin, discoverPreviewGlobalPackageBridges, type PreviewGlobalPackageBridgePlan } from './globalPackageBridge';
import { createPreviewApolloBridgePlugin } from './previewApolloBridgePlugin';
import { prepareAutomaticPreviewSetupFallback } from './previewAutomaticSetupFallback';
import { forwardPreviewAbort } from './previewAbortForwarding';
import { PreviewAdaptiveBuildPlanCache } from './previewAdaptiveBuildPlanCache';
import { preparePreviewAdaptiveBuildSeed } from './previewAdaptiveBuildSeed';
import { createPreviewAssetPlugin } from './previewAssetPlugin';
import { createPreviewBuildPlanIdentity } from './previewBuildPlanIdentity';
import { createPreviewStyledComponentsCompilerPlan } from './previewStyledComponentsCompilerPlan';
// prettier-ignore
import { collectPreviewBuildDependencies, isBuildFailure, PREVIEW_OUTPUT_DIRECTORY_NAME, restorePrivateNamespaces, VIRTUAL_ENTRY_NAME } from './previewBuildResult';
import { resolvePreviewCompilerFailure } from './previewCompilerFailure';
// prettier-ignore
import { finalizePreviewCompilerBundle, type PreviewCompilerBuildExecution } from './previewCompilerBundleFinalizer';
import { shutdownPreviewCompiler } from './previewCompilerShutdown';
import { createPreviewContextBridgePlugin } from './previewContextBridgePlugin';
import { resolvePreviewContextCoverage } from './previewContextCoverage';
// prettier-ignore
import { EMPTY_RUNTIME_WATCH_INPUTS, createPreviewDocumentName, describeGlobalPackageBridgeStatus, haveEquivalentGlobalPackageBridges, haveEquivalentRouterSelections, mergePreviewWatchDirectories, requirePreviewSassBoundary, selectPreviewInitialRouterBuild, type PreviewRouterBuildSelection } from './previewCompilerDefaults';
import { PreviewDiagnosticEmissionCache } from './previewDiagnosticEmissionCache';
import type { EsbuildPreviewCompilerOptions } from './previewCompilerOptions';
import { createPreviewFormikBridgePlugin } from './previewFormikBridgePlugin';
import { createPreviewDragDropBridgePlugin } from './previewDragDropBridgePlugin';
import { collectPreviewDragDropRequirement } from './previewDragDropRequirement';
import { createPreviewDependencyResolutionHintPlugin } from './previewDependencyResolutionHintPlugin';
import {
  PreviewDependencyResolutionNeuralModel,
  type PreviewDependencyResolutionNeuralScore,
} from './previewDependencyResolutionNeuralModel';
import { createPreviewMissingSourceFallbackPlugin } from './previewMissingSourceFallbackPlugin';
import {
  createPreviewLegacyCommonJsGlobalDefines,
  discoverPreviewLegacyCommonJsGlobals,
} from './previewLegacyCommonJsGlobalDiscovery';
import { createPreviewManagedDependencyPeerPlugin } from './previewManagedDependencyPeerPlugin';
import { createPreviewLegacyNbindCspPlugin } from './previewLegacyNbindCspPlugin';
import { createPreviewMdxFallbackPlugin } from './previewMdxFallbackPlugin';
import {
  collectPreviewDependencyResolutionPreflightMessages,
  createPreviewRenderOnlyDependencyResolutionHintPlan,
  createPreviewDependencyResolutionHintPlan,
  mergePreviewDependencyResolutionHintPlans,
  tryAcquirePreviewMissingDependencies,
  type PreviewDependencyResolutionHintPlan,
  type PreviewMissingDependencyAcquisitionContext,
} from './previewMissingDependencyRequirements';
import { createPreviewNodeBuiltinPlugin } from './previewNodeBuiltinPlugin';
import { createPreviewParentSlicePlugin } from './previewParentSlicePlugin';
import { createPreviewPnpPeerDependencyPlugin } from './previewPnpPeerDependencyPlugin';
import { createPreviewYarnLibuiBridgePlugin } from './previewYarnLibuiBridgePlugin';
import {
  createPreviewImportMetaEnvironment,
  resolvePreviewPublicApplicationOrigin,
} from './previewPublicEnvironment';
import { findPreviewPublicAssetRoot } from './previewPublicAssetRoot';
import { createPreviewInstalledPackageExternalizationPlugin } from './previewInstalledPackageExternalizationPlugin';
import { preparePreviewCompilerTarget } from './previewImperativeEntryTarget';
import {
  createPreviewCompleteRouteUsageContext,
  preparePreviewCompilerUsage,
  type PreviewCompleteRouteUsageContext,
} from './preparePreviewCompilerUsage';
import { preparePreviewCompleteRouteInventoryAnalysis } from './preparePreviewCompleteRouteInventoryAnalysis';
import { preparePreviewRouteExecutionFinalFrontier } from './preparePreviewRouteExecutionFinalFrontier';
import { emitPreviewRouteExecutionTelemetry } from './preparePreviewRouteExecutionPlanner';
import { createPreviewPreparationPolicy } from './previewPreparationPolicy';
import { createPreviewInspectorFallbackDiagnostics } from './previewInspectorFallbackDiagnostic';
import {
  mergePreviewPortalHostIds,
  refinePreviewPortalHostsFromBuild,
} from './previewPortalHostBuildRefinement';
import { selectPreviewReactDomRootKind } from './previewReactDomRootRuntimeSource';
import { createPreviewReduxBridgePlugin } from './previewReduxBridgePlugin';
import { collectPreviewReduxAutomaticState } from './previewReduxAutomaticState';
import {
  assertPreviewResolutionPath,
  assertPreviewResolutionPaths,
  createPreviewResolutionConfinementPathMemo,
  createPreviewResolutionConfinementPlugin,
  normalizePreviewResolutionConfinement,
  type PreviewResolutionConfinementPathMemo,
} from './previewResolutionConfinement';
import { createPreviewCompilerOwnedNamespaceRegistry } from './previewOwnedNamespaceRegistry';
import {
  PREVIEW_IMPORT_META_ENV_DEFINE_INPUT,
  createPreviewSyntheticInputRegistry,
} from './previewSyntheticInputRegistry';
import { createPreviewRouterBridgePlugin } from './previewRouterBridgePlugin';
import { createPreviewRuntimeInstanceKey } from './previewRuntimeInstanceKey';
import { collectPreviewRouterRequirement } from './previewRouterRequirement';
import { PREVIEW_SOURCE_LOADERS } from './previewLoaderPolicy';
import { collectPreviewNextRuntimeEvidence as findNext } from './previewNextRuntimeEvidence';
import { findPreviewProjectRoot } from './previewProjectRoot';
import { PreviewProjectUsageCache } from './previewProjectUsageCache';
import { PreviewImplicitGlobalEvidenceCache } from './previewImplicitGlobalEvidenceCache';
import {
  PreviewIncrementalBuildCache,
  type PreviewIncrementalBuildActivityReporter,
  type PreviewIncrementalBuildOptions,
} from './previewIncrementalBuildCache';
import {
  createPreviewRuntimeWatchInputs,
  resolvePreviewRuntimeEnvironment,
  type PreviewRuntimeEnvironment,
} from './previewRuntimeEnvironment';
import {
  createPreviewSassPlugin,
  type PreviewSassBoundary,
  type PreviewSassPluginOptions,
} from './previewSassPlugin';
import { createPreviewSetupBridgePlugin } from './previewSetupBridgePlugin';
import {
  createPreviewStaticModuleResolutionMemo,
  createPreviewStaticModuleResolver,
  type PreviewStaticModuleResolutionMemo,
} from './previewStaticModuleResolver';
import { PreviewSetupFallbackBoundary } from './previewSetupFallbackBoundary';
import { PreviewSetupFailureCache } from './previewSetupFailureCache';
import { createPreviewTargetBridgePlugin } from './previewTargetBridgePlugin';
import { assertPreviewReactTarget } from './previewTargetRuntimeGuard';
import { createPreviewTailwindPlugin } from './previewTailwindPlugin';
import { selectPreviewThemeImport } from './previewTargetExports';
import { createPreviewThemeBridgePlugin } from './previewThemeBridgePlugin';
import { createPreviewThemeCandidatePlugin } from './previewThemeCandidatePlugin';
import { PreviewVendorModuleBuilder } from './previewVendorModuleBuilder';
import { shouldEscalatePreviewAncestorSearch } from './previewWorkspaceAncestorPolicy';
import { PreviewSourceTransformer } from './staticResources/previewSourceTransformer';
import { PreviewRuntimeHookChildPropDemandCatalogBuilder } from './staticResources/previewRuntimeHookChildPropDemand';
import { collectReactExportPropInference } from './staticResources/reactExportPropInference';
import { createPreviewTargetPropInferenceMemo } from './previewTargetPropInferenceMemo';
// prettier-ignore
import { createWorkspaceSourcePlugin, type MutableWorkspaceSourceState, type WorkspaceSourceCompilationState } from './workspaceSourcePlugin';
export type { EsbuildPreviewCompilerOptions } from './previewCompilerOptions';
export class EsbuildPreviewCompiler implements PreviewCompiler {
  private readonly activeBuildControllers = new Set<AbortController>();
  private readonly adaptiveBuildPlanCache = new PreviewAdaptiveBuildPlanCache();
  private disposed = false;
  private readonly implicitGlobalEvidenceCache = new PreviewImplicitGlobalEvidenceCache();
  private readonly projectUsageCache = new PreviewProjectUsageCache();
  private readonly incrementalBuildCache = new PreviewIncrementalBuildCache();
  private readonly diagnosticEmissionCache = new PreviewDiagnosticEmissionCache();
  private readonly dependencyResolutionNeuralModel = new PreviewDependencyResolutionNeuralModel();
  private readonly setupFailureCache = new PreviewSetupFailureCache();
  private readonly vendorModuleBuilder: PreviewVendorModuleBuilder;
  private readonly completeRouteInventoryCache = new Map<
    string,
    Promise<PreviewInspectorCompleteRouteInventory>
  >();
  private readonly inspectorGestureSeed = randomBytes(32);
  private readonly managedDependencyStore: PreviewManagedDependencyStore | undefined;
  private shutdownPromise: Promise<void> | undefined;
  public constructor(options: EsbuildPreviewCompilerOptions = {}) {
    this.vendorModuleBuilder = new PreviewVendorModuleBuilder(options.vendorModuleCacheBackend);
    this.managedDependencyStore =
      options.managedDependencyStoreRoot === undefined
        ? undefined
        : new PreviewManagedDependencyStore({
            ...(options.bundledNodeModulesPath === undefined
              ? {}
              : { bundledNodeModulesPath: options.bundledNodeModulesPath }),
            ...(options.lockedDependencyAcquirer === undefined
              ? {}
              : { lockedDependencyAcquirer: options.lockedDependencyAcquirer }),
            rootPath: options.managedDependencyStoreRoot,
          });
  }
  /**
   * Collects the frozen, compiler-verifiable route inventory used by sequential headless campaigns.
   *
   * This is intentionally an adapter capability rather than part of the framework-neutral compiler
   * port: ordinary previews never need to enumerate sibling routes.
   */
  public async collectCompleteRouteInventory(
    request: PreviewBuildRequest,
    limits?: Partial<PreviewInspectorCompleteRouteInventoryLimits>,
    signal?: AbortSignal,
    observer?: PreviewCompleteRouteInventoryTelemetryObserver,
  ): Promise<PreviewInspectorCompleteRouteInventory> {
    const telemetry = createPreviewCompleteRouteInventoryTelemetryEmitter(observer);
    let shutdownReported = false;
    const reportShutdown = (): void => {
      if (shutdownReported) return;
      shutdownReported = true;
      telemetry?.emit({
        phase: 'shutdown',
        transition: 'start',
      });
    };
    if (signal?.aborted === true) reportShutdown();
    signal?.addEventListener('abort', reportShutdown, { once: true });
    try {
      if (this.disposed) {
        throw new PreviewCompilationError('The React preview compiler is already closed.', []);
      }
      const canonicalWorkspaceRoot = canonicalizeExistingPath(request.workspaceRoot);
      const resolutionConfinement = normalizePreviewResolutionConfinement(request);
      const documentPath = canonicalizeExistingPath(request.documentPath);
      const targetSelection = preparePreviewCompilerTarget({
        ...request,
        documentPath,
        renderMode: 'page-inspector',
      });
      const exportName = targetSelection.inspectorExportName;
      if (exportName === undefined) {
        throw new PreviewCompilationError(
          'The selected module does not expose a statically inspectable React export.',
          [],
        );
      }
      const cacheKey = createHash('sha256')
        .update(canonicalWorkspaceRoot)
        .update('\0')
        .update(documentPath)
        .update('\0')
        .update(request.tsconfigPath ?? '')
        .update('\0')
        .update(targetSelection.sourceText)
        .update('\0')
        .update(JSON.stringify(request.dependencySnapshots))
        .update('\0')
        .update(JSON.stringify(limits ?? {}))
        .update('\0')
        .update(JSON.stringify(request.resolutionConfinement ?? {}))
        .update('\0')
        .update(PREVIEW_COMPLETE_ROUTE_REPLAY_POLICY_DIGEST)
        .update('\0')
        .update(PREVIEW_COMPLETE_ROUTE_REPLAY_POLICY_VERSION.toString())
        .digest('hex');
      const cached = this.completeRouteInventoryCache.get(cacheKey);
      if (cached !== undefined) return await cached;
      const pending = (async (): Promise<PreviewInspectorCompleteRouteInventory> => {
        let confinementPathMemo: PreviewResolutionConfinementPathMemo | undefined;
        let routeUsageContext: PreviewCompleteRouteUsageContext | undefined;
        let staticModuleResolutionMemo: PreviewStaticModuleResolutionMemo | undefined;
        let sourceInventoryMemo: PreviewInspectorBundleSourceInventoryMemo | undefined;
        try {
          const analysis = await preparePreviewCompleteRouteInventoryAnalysis({
            cache: this.projectUsageCache,
            canonicalWorkspaceRoot,
            documentPath,
            exportName,
            ...(limits === undefined ? {} : { limits }),
            request,
            resolutionConfinement,
            targetSelection,
            ...(telemetry === undefined ? {} : { telemetry }),
          });
          const inventory = await collectPreviewInspectorCompleteRouteInventory({
            ...analysis,
            prepareExecutionPlan: (entry, progress) => {
              sourceInventoryMemo ??= createPreviewInspectorBundleSourceInventoryMemo();
              staticModuleResolutionMemo ??= createPreviewStaticModuleResolutionMemo();
              if (resolutionConfinement !== undefined) {
                confinementPathMemo ??= createPreviewResolutionConfinementPathMemo();
                routeUsageContext ??= createPreviewCompleteRouteUsageContext();
              }
              return this.prepareCompleteRouteExecutionPlanArtifact(
                request,
                entry,
                progress,
                telemetry,
                sourceInventoryMemo,
                staticModuleResolutionMemo,
                confinementPathMemo,
                routeUsageContext,
              );
            },
          });
          assertPreviewResolutionPaths(resolutionConfinement, inventory.dependencyPaths);
          return inventory;
        } finally {
          routeUsageContext?.release();
          confinementPathMemo?.release();
          staticModuleResolutionMemo?.release();
          sourceInventoryMemo?.release();
        }
      })();
      this.completeRouteInventoryCache.set(cacheKey, pending);
      try {
        return await pending;
      } catch (error) {
        this.completeRouteInventoryCache.delete(cacheKey);
        throw error;
      }
    } finally {
      signal?.removeEventListener('abort', reportShutdown);
    }
  }

  /** Independently replays one frozen inventory identity with compiler-owned inert analysis. */
  public async replayCompleteRouteInventoryEntry(
    request: PreviewBuildRequest,
    entry: PreviewInspectorCompleteRouteBaseEntry,
  ): Promise<PreviewInspectorExactRouteReplayResult> {
    if (this.disposed) {
      throw new PreviewCompilationError('The React preview compiler is already closed.', []);
    }
    const canonicalWorkspaceRoot = canonicalizeExistingPath(request.workspaceRoot);
    const resolutionConfinement = normalizePreviewResolutionConfinement(request);
    const documentPath = canonicalizeExistingPath(request.documentPath);
    const targetSelection = preparePreviewCompilerTarget({
      ...request,
      documentPath,
      renderMode: 'page-inspector',
    });
    const exportName = targetSelection.inspectorExportName;
    if (exportName === undefined) {
      throw new PreviewCompilationError(
        'The selected module does not expose a statically inspectable React export.',
        [],
      );
    }
    const analysis = await preparePreviewCompleteRouteInventoryAnalysis({
      cache: this.projectUsageCache,
      canonicalWorkspaceRoot,
      documentPath,
      exportName,
      request,
      resolutionConfinement,
      targetSelection,
    });
    const result = await replayPreviewInspectorCompleteRouteEntry(analysis, entry);
    if (result.exact) {
      assertPreviewResolutionPaths(resolutionConfinement, [
        result.replay.executionRoot.sourcePath,
        result.replay.runtimeTarget.sourcePath,
        result.replay.sourcePath,
      ]);
    }
    return result;
  }

  /** Runs one provisional inventory row through the same real fast planner used by compilation. */
  private async prepareCompleteRouteExecutionPlanArtifact(
    request: PreviewBuildRequest,
    entry: PreviewInspectorPlanlessRunnableRoute,
    executionProgress: PreviewCompleteRouteInventoryExecutionProgress,
    telemetry: PreviewCompleteRouteInventoryTelemetryEmitter | undefined,
    sourceInventoryMemo: PreviewInspectorBundleSourceInventoryMemo,
    staticModuleResolutionMemo: PreviewStaticModuleResolutionMemo,
    confinementPathMemo: PreviewResolutionConfinementPathMemo | undefined,
    routeUsageContext: PreviewCompleteRouteUsageContext | undefined,
  ): Promise<PreviewRouteExecutionPlanArtifact | undefined> {
    const executionTelemetry =
      telemetry === undefined
        ? undefined
        : Object.freeze({ emitter: telemetry, progress: executionProgress });
    emitPreviewRouteExecutionTelemetry(executionTelemetry, 'execution-shared-context', 'start');
    const routeRequest: PreviewBuildRequest = Object.freeze({
      ...request,
      inspectorRouteSelection: Object.freeze(
        entry.selection.map((step) => Object.freeze({ ...step })),
      ),
      inspectorTargetMode: 'selected-route-leaf',
      preparationMode: 'fast',
      renderMode: 'page-inspector',
    });
    try {
      const canonicalWorkspaceRoot = canonicalizeExistingPath(routeRequest.workspaceRoot);
      const resolutionConfinement = normalizePreviewResolutionConfinement(routeRequest);
      const documentPath = canonicalizeExistingPath(routeRequest.documentPath);
      const projectRoot = await findPreviewProjectRoot(documentPath, canonicalWorkspaceRoot);
      const managedDependencyEnvironment: PreviewManagedDependencyEnvironment =
        (await this.managedDependencyStore?.prepare(projectRoot, canonicalWorkspaceRoot)) ??
        EMPTY_MANAGED_ENVIRONMENT;
      const dependencyProfile = managedDependencyEnvironment.profile;
      const nextEvidence = await findNext(dependencyProfile, projectRoot, routeRequest);
      const baseResolver = createPreviewStaticModuleResolver({
        ...(routeRequest.tsconfigPath === undefined
          ? {}
          : { configuredTsconfigPath: routeRequest.tsconfigPath }),
        fallbackNodeModulesPaths: managedDependencyEnvironment.nodeModulesPaths,
        workspaceRoot: canonicalWorkspaceRoot,
      });
      const resolveModule = (moduleSpecifier: string, consumerPath: string): string | undefined =>
        staticModuleResolutionMemo.resolve(moduleSpecifier, consumerPath, () =>
          baseResolver.resolve(moduleSpecifier, consumerPath),
        );
      const assertConfinedPath = (
        confinement: NonNullable<typeof resolutionConfinement>,
        candidatePath: string,
      ): string =>
        confinementPathMemo === undefined
          ? assertPreviewResolutionPath(confinement, candidatePath)
          : confinementPathMemo.assert(candidatePath, () =>
              assertPreviewResolutionPath(confinement, candidatePath),
            );
      const resolver =
        resolutionConfinement === undefined
          ? { ...baseResolver, resolve: resolveModule }
          : {
              ...baseResolver,
              resolve(moduleSpecifier: string, consumerPath: string) {
                assertConfinedPath(resolutionConfinement, consumerPath);
                const resolved = resolveModule(moduleSpecifier, consumerPath);
                if (resolved !== undefined) {
                  assertConfinedPath(resolutionConfinement, resolved);
                }
                return resolved;
              },
            };
      assertPreviewReactTarget(routeRequest, dependencyProfile, resolver);
      const targetSelection = preparePreviewCompilerTarget({
        ...routeRequest,
        documentPath,
      });
      const policy = createPreviewPreparationPolicy(routeRequest);
      const [runtimeEnvironment, runtimeWatchInputs] = await Promise.all([
        resolvePreviewRuntimeEnvironment({
          ...(routeRequest.setupModulePath === undefined
            ? {}
            : { configuredSetupPath: routeRequest.setupModulePath }),
          projectRoot,
          useStorybookPreview: policy.allowAutomaticStorybook,
          workspaceRoot: canonicalWorkspaceRoot,
        }),
        policy.collectRuntimeWatchInputs
          ? createPreviewRuntimeWatchInputs(projectRoot, canonicalWorkspaceRoot)
          : Promise.resolve(EMPTY_RUNTIME_WATCH_INPUTS),
      ]);
      emitPreviewRouteExecutionTelemetry(
        executionTelemetry,
        'execution-shared-context',
        'complete',
      );
      emitPreviewRouteExecutionTelemetry(executionTelemetry, 'execution-route-usage', 'start');
      const preparedUsage = await preparePreviewCompilerUsage({
        cache: this.projectUsageCache,
        discoveryScope: policy.discoveryScope,
        projectRoot,
        projectUsesNextRuntime: nextEvidence.routeContext,
        request: routeRequest,
        resolver,
        setupKind: runtimeEnvironment.setupKind,
        targetSelection,
        ...(routeUsageContext === undefined ? {} : { usageContext: routeUsageContext }),
        workspaceRoot: canonicalWorkspaceRoot,
      });
      emitPreviewRouteExecutionTelemetry(executionTelemetry, 'execution-route-usage', 'complete');
      const directThemeImport = selectPreviewThemeImport(routeRequest.sourceText);
      const finalFrontier = await preparePreviewRouteExecutionFinalFrontier({
        contextDiscoveryTruncated: preparedUsage.contextDiscoveryTruncated === true,
        ...(directThemeImport === undefined ? {} : { directThemeImport }),
        implicitGlobalEvidenceCache: this.implicitGlobalEvidenceCache,
        implicitGlobalSourcePaths: preparedUsage.implicitGlobalSourcePaths,
        ...(targetSelection.inspectorExportName === undefined
          ? {}
          : { inspectorExportName: targetSelection.inspectorExportName }),
        policy,
        projectRoot,
        readProjectSource: (options) => this.projectUsageCache.readSourceText(options),
        request: routeRequest,
        routeId: entry.id,
        runtimeDependencyPaths: runtimeWatchInputs.dependencyPaths,
        ...(runtimeEnvironment.setupModulePath === undefined
          ? {}
          : { runtimeSetupModulePath: runtimeEnvironment.setupModulePath }),
        staticModuleResolver: resolver,
        targetSelection,
        targetUsageProps: preparedUsage.packageTargetUsageProps,
        ...(executionTelemetry === undefined ? {} : { telemetry: executionTelemetry }),
        sourceInventoryMemo,
        workspaceRoot: canonicalWorkspaceRoot,
      });
      const artifact = finalFrontier.plannedRouteExecution?.artifact;
      if (artifact === undefined) return undefined;
      assertPreviewResolutionPaths(resolutionConfinement, [
        artifact.executionRoot.sourcePath,
        artifact.runtimeTarget.sourcePath,
        artifact.selectedBranch.sourcePath,
        artifact.rootRoleContract.sourcePath,
        artifact.targetRoleContract.sourcePath,
        ...artifact.ownerChain.map((owner) => owner.sourcePath),
      ]);
      return artifact;
    } catch (error) {
      if (error instanceof PreviewCompilationError) return undefined;
      throw error;
    }
  }

  public async compile(
    request: PreviewBuildRequest,
    context?: PreviewBuildExecutionContext,
    dependencyResolutionHints?: PreviewDependencyResolutionHintPlan,
  ): Promise<PreviewBundle> {
    if (this.disposed) {
      throw new PreviewCompilationError('The React preview compiler is already closed.', []);
    }
    const buildController = new AbortController();
    const detachCallerAbort = forwardPreviewAbort(context?.signal, buildController);
    this.activeBuildControllers.add(buildController);
    const buildSignal = buildController.signal;
    let acquisitionContext: PreviewMissingDependencyAcquisitionContext | undefined;
    let activeDependencyResolutionHints = dependencyResolutionHints;
    let dependencyRecoveryAttempted = dependencyResolutionHints !== undefined;
    let staticModuleResolutionMemo: PreviewStaticModuleResolutionMemo | undefined;
    const appliedDependencyHintScores = new Set<PreviewDependencyResolutionNeuralScore>();
    const recordDependencyHintBuildOutcome = (successful: boolean): void => {
      for (const score of appliedDependencyHintScores) {
        this.dependencyResolutionNeuralModel.recordOutcome(
          score,
          successful,
          successful ? 0.5 : 0.2,
        );
      }
      appliedDependencyHintScores.clear();
    };
    try {
      throwIfPreviewBuildCancelled(buildSignal);
      context?.reportProgress?.('discovering-components');
      const canonicalWorkspaceRoot = canonicalizeExistingPath(request.workspaceRoot);
      const resolutionConfinement = normalizePreviewResolutionConfinement(request);
      const inspectorSourceGestureSecret =
        request.renderMode === 'page-inspector'
          ? createInspectorSourceGestureSecret(this.inspectorGestureSeed, request.documentPath)
          : undefined;
      const projectRoot = await findPreviewProjectRoot(
        canonicalizeExistingPath(request.documentPath),
        canonicalWorkspaceRoot,
      );
      const managedDependencyEnvironment: PreviewManagedDependencyEnvironment =
        (await this.managedDependencyStore?.prepare(projectRoot, canonicalWorkspaceRoot)) ??
        EMPTY_MANAGED_ENVIRONMENT;
      const dependencyProfile = managedDependencyEnvironment.profile;
      const nextEvidence = await findNext(dependencyProfile, projectRoot, request);
      const baseStaticModuleResolver = createPreviewStaticModuleResolver({
        ...(request.tsconfigPath === undefined
          ? {}
          : { configuredTsconfigPath: request.tsconfigPath }),
        fallbackNodeModulesPaths: managedDependencyEnvironment.nodeModulesPaths,
        workspaceRoot: canonicalWorkspaceRoot,
      });
      const staticModuleResolver =
        resolutionConfinement === undefined
          ? baseStaticModuleResolver
          : {
              ...baseStaticModuleResolver,
              resolve(moduleSpecifier: string, consumerPath: string) {
                assertPreviewResolutionPath(resolutionConfinement, consumerPath);
                const resolved = baseStaticModuleResolver.resolve(moduleSpecifier, consumerPath);
                if (resolved !== undefined) {
                  assertPreviewResolutionPath(resolutionConfinement, resolved);
                }
                return resolved;
              },
            };
      acquisitionContext = {
        environment: managedDependencyEnvironment,
        projectRoot,
        readSource: (sourcePath) => {
          const normalizedPath = path.normalize(sourcePath);
          const snapshot = [
            ...request.dependencySnapshots,
            {
              documentPath: request.documentPath,
              language: request.language,
              sourceText: request.sourceText,
            },
          ].find((candidate) => path.normalize(candidate.documentPath) === normalizedPath);
          return (
            snapshot?.sourceText ??
            this.projectUsageCache.readSourceText({
              maximumBytes: 2 * 1024 * 1024,
              sourcePath,
            })
          );
        },
        reportAcquisition: () => context?.reportProgress?.('acquiring-dependencies'),
        resolveModule: staticModuleResolver.resolve,
        targetPath: request.documentPath,
        workspaceRoot: canonicalWorkspaceRoot,
      };
      const analysisResolutionMemo =
        request.renderMode === 'page-inspector'
          ? createPreviewStaticModuleResolutionMemo()
          : undefined;
      staticModuleResolutionMemo = analysisResolutionMemo;
      const analysisStaticModuleResolver =
        analysisResolutionMemo === undefined
          ? staticModuleResolver
          : resolutionConfinement === undefined
            ? {
                ...baseStaticModuleResolver,
                resolve(moduleSpecifier: string, consumerPath: string) {
                  return analysisResolutionMemo.resolve(moduleSpecifier, consumerPath, () =>
                    baseStaticModuleResolver.resolve(moduleSpecifier, consumerPath),
                  );
                },
              }
            : {
                ...baseStaticModuleResolver,
                resolve(moduleSpecifier: string, consumerPath: string) {
                  assertPreviewResolutionPath(resolutionConfinement, consumerPath);
                  const resolved = analysisResolutionMemo.resolve(
                    moduleSpecifier,
                    consumerPath,
                    () => baseStaticModuleResolver.resolve(moduleSpecifier, consumerPath),
                  );
                  if (resolved !== undefined) {
                    assertPreviewResolutionPath(resolutionConfinement, resolved);
                  }
                  return resolved;
                },
              };
      const collectTailwindCandidates =
        findPreviewDependencySpecifier(dependencyProfile, 'tailwindcss') !== undefined ||
        analysisStaticModuleResolver.resolve('tailwindcss', request.documentPath) !== undefined;
      const requiredTailwindCompilerPackage =
        dependencyProfile?.hasReusableLockEvidence === true &&
        findPreviewDependencySpecifier(dependencyProfile, '@tailwindcss/postcss') !== undefined
          ? '@tailwindcss/postcss'
          : undefined;
      assertPreviewReactTarget(request, dependencyProfile, analysisStaticModuleResolver);
      const targetSelection = preparePreviewCompilerTarget(request);
      const routerNeed = collectPreviewRouterRequirement(request.documentPath, request.sourceText);
      const targetExports = targetSelection.targetExports;
      const propInferenceSnapshotSourceByPath = new Map(
        [
          ...request.dependencySnapshots,
          {
            documentPath: request.documentPath,
            language: request.language,
            sourceText: request.sourceText,
          },
        ].map((snapshot) => [path.normalize(snapshot.documentPath), snapshot.sourceText] as const),
      );
      const readPropInferenceSource = (sourcePath: string): string | undefined =>
        propInferenceSnapshotSourceByPath.get(path.normalize(sourcePath)) ??
        ts.sys.readFile(sourcePath);
      const childPropDemandBuilder = new PreviewRuntimeHookChildPropDemandCatalogBuilder({
        readSource: readPropInferenceSource,
        resolveModule: analysisStaticModuleResolver.resolve,
        workspaceRoot: canonicalWorkspaceRoot,
      });
      const collectTargetInferredProps = createPreviewTargetPropInferenceMemo(
        (
          sourcePath: string,
          sourceText: string,
        ): ReturnType<typeof collectReactExportPropInference> =>
          collectReactExportPropInference(sourcePath, sourceText, {
            childPropDemands: childPropDemandBuilder.collect(sourcePath, sourceText),
            resolveImport: (moduleSpecifier, importerPath) => {
              const resolvedPath = analysisStaticModuleResolver.resolve(
                moduleSpecifier,
                importerPath,
              );
              const resolvedSourceText =
                resolvedPath === undefined ? undefined : readPropInferenceSource(resolvedPath);
              return resolvedPath === undefined || resolvedSourceText === undefined
                ? undefined
                : { sourcePath: resolvedPath, sourceText: resolvedSourceText };
            },
          }),
      );
      const inferredPropsByExport = collectTargetInferredProps(
        request.documentPath,
        request.sourceText,
      );
      const inspectorExportName = targetSelection.inspectorExportName;
      const themeImport = selectPreviewThemeImport(request.sourceText);
      const policy = createPreviewPreparationPolicy(request);
      const [runtimeEnvironment, runtimeWatchInputs] = await Promise.all([
        resolvePreviewRuntimeEnvironment({
          ...(request.setupModulePath === undefined
            ? {}
            : { configuredSetupPath: request.setupModulePath }),
          projectRoot,
          useStorybookPreview: policy.allowAutomaticStorybook,
          workspaceRoot: canonicalWorkspaceRoot,
        }),
        policy.collectRuntimeWatchInputs
          ? createPreviewRuntimeWatchInputs(projectRoot, canonicalWorkspaceRoot)
          : Promise.resolve(EMPTY_RUNTIME_WATCH_INPUTS),
      ]);
      const { contextDiscoveryTruncated, packageTargetUsageProps, implicitGlobalSourcePaths } =
        await preparePreviewCompilerUsage({
          cache: this.projectUsageCache,
          discoveryScope: policy.discoveryScope,
          projectRoot,
          projectUsesNextRuntime: nextEvidence.routeContext,
          request,
          resolver: analysisStaticModuleResolver,
          signal: buildSignal,
          setupKind: runtimeEnvironment.setupKind,
          targetSelection,
          workspaceRoot: canonicalWorkspaceRoot,
        });
      let targetUsageProps = packageTargetUsageProps;
      const packageHasFrameworkPageContext =
        packageTargetUsageProps.inspectorPlan?.pageCandidates.some(
          (candidate) => candidate.routeLocation?.evidenceKind === 'next-app-filesystem',
        ) === true;
      const packageHasEntryConnectedPage =
        inspectorExportName !== undefined &&
        packageTargetUsageProps.inspectorPlan?.contextModule === undefined &&
        packageTargetUsageProps.renderChainsByExport?.[inspectorExportName]?.paths.some(
          (candidate) => candidate.entryPoint !== undefined,
        ) === true;
      const requiresWorkspaceAncestorEscalation =
        policy.discoveryScope === 'workspace' &&
        request.renderMode === 'page-inspector' &&
        inspectorExportName !== undefined &&
        !targetSelection.isImperativeEntry &&
        packageTargetUsageProps.inspectorPlan?.contextModule === undefined &&
        !packageHasFrameworkPageContext &&
        !packageHasEntryConnectedPage &&
        (packageTargetUsageProps.inspectorPlan === undefined ||
          packageTargetUsageProps.inspectorPlan.edges.length === 0) &&
        (await shouldEscalatePreviewAncestorSearch(projectRoot, canonicalWorkspaceRoot));
      if (requiresWorkspaceAncestorEscalation) {
        targetUsageProps = await this.projectUsageCache.discover({
          documentPath: request.documentPath,
          exports: targetExports,
          inspectorExportName,
          projectRoot: canonicalWorkspaceRoot,
          ...(request.inspectorRouteSelection === undefined
            ? {}
            : { routeSelection: request.inspectorRouteSelection }),
          signal: buildSignal,
          snapshots: request.dependencySnapshots,
          sourceText: targetSelection.sourceText,
          ...(request.tsconfigPath === undefined ? {} : { tsconfigPath: request.tsconfigPath }),
          workspaceRoot: canonicalWorkspaceRoot,
        });
      }
      throwIfPreviewBuildCancelled(buildSignal);
      context?.reportProgress?.('preparing-runtime');
      let reactDomRootKind = selectPreviewReactDomRootKind(
        analysisStaticModuleResolver,
        request.documentPath,
      );
      if (reactDomRootKind === 'legacy') {
        const reactDomDependencyProfile =
          dependencyProfile ??
          (await readPreviewDependencyProfile(projectRoot, canonicalWorkspaceRoot));
        if (
          reactDomDependencyProfile?.dependencyPaths.some(
            (dependencyPath) => path.basename(dependencyPath) === 'yarn.lock',
          ) === true
        ) {
          const lockedRuntimeVersion = await findPreviewYarnLockedPackageVersion({
            packageName: 'react-dom',
            profile: reactDomDependencyProfile,
            projectRoot,
          });
          reactDomRootKind = selectPreviewReactDomRootKind(
            analysisStaticModuleResolver,
            request.documentPath,
            lockedRuntimeVersion,
          );
        }
      }
      const preparedSetupFallback = await prepareAutomaticPreviewSetupFallback({
        cache: this.setupFailureCache,
        dependencySnapshots: request.dependencySnapshots,
        documentName: createPreviewDocumentName(request),
        projectRoot,
        runtimeEnvironment,
        runtimeWatchInputs,
        signal: buildSignal,
        staticModuleResolver: analysisStaticModuleResolver,
        workspaceRoot: canonicalWorkspaceRoot,
      });
      const finalFrontier = await preparePreviewRouteExecutionFinalFrontier({
        collectTailwindCandidates,
        contextDiscoveryTruncated: contextDiscoveryTruncated === true,
        ...(themeImport === undefined ? {} : { directThemeImport: themeImport }),
        implicitGlobalEvidenceCache: this.implicitGlobalEvidenceCache,
        implicitGlobalSourcePaths,
        ...(inspectorExportName === undefined ? {} : { inspectorExportName }),
        policy,
        projectRoot,
        readProjectSource: (options) => this.projectUsageCache.readSourceText(options),
        request,
        runtimeDependencyPaths: runtimeWatchInputs.dependencyPaths,
        ...(runtimeEnvironment.setupModulePath === undefined
          ? {}
          : { runtimeSetupModulePath: runtimeEnvironment.setupModulePath }),
        signal: buildSignal,
        staticModuleResolver: analysisStaticModuleResolver,
        targetSelection,
        targetUsageProps,
        workspaceRoot: canonicalWorkspaceRoot,
      });
      const {
        activeInspectorDependencyPaths,
        activeInspectorPlan,
        globalBridgeEvidencePolicy,
        implicitGlobalEvidence,
        pageExecutionCandidates,
        plannedRouteExecution,
        preparedBundleExecution,
        styleContext,
      } = finalFrontier;
      if (plannedRouteExecution?.artifact !== undefined) {
        assertPreviewResolutionPaths(resolutionConfinement, [
          plannedRouteExecution.artifact.executionRoot.sourcePath,
          plannedRouteExecution.artifact.runtimeTarget.sourcePath,
          plannedRouteExecution.artifact.selectedBranch.sourcePath,
          plannedRouteExecution.artifact.rootRoleContract.sourcePath,
          plannedRouteExecution.artifact.targetRoleContract.sourcePath,
          ...plannedRouteExecution.artifact.ownerChain.map((owner) => owner.sourcePath),
        ]);
      }
      const {
        applicationStylesheetImports,
        documentShellEvidence,
        globalStyleImports,
        snapshotSourceByPath,
        themeImport: selectedThemeImport,
      } = styleContext;
      const automaticReduxState = await collectPreviewReduxAutomaticState({
        readSource: async (sourcePath) =>
          snapshotSourceByPath.get(path.normalize(sourcePath)) ??
          (await this.projectUsageCache.readSourceText({
            maximumBytes: 1024 * 1024,
            sourcePath,
          })),
        sourcePaths: [
          ...activeInspectorDependencyPaths,
          ...(preparedBundleExecution?.prepared.frontier.authenticSourcePaths ?? []),
        ],
      });
      let legacyCommonJsGlobalNames: readonly string[] = [];
      let portalHostIds = styleContext.portalHostIds;
      const activePageExecutionCandidate =
        preparedBundleExecution?.executionCandidate ?? pageExecutionCandidates[0];
      const criticalSurfaceSourcePaths = Object.freeze(
        [
          ...new Set(
            (activePageExecutionCandidate?.criticalSurfaces ?? []).map((surface) =>
              path.normalize(surface.sourcePath),
            ),
          ),
        ].sort(),
      );
      const compilerGraphSummary: PreviewCompilerGraphSummary = {
        analysisCandidateCount: targetUsageProps.inspectorPlan?.pageCandidates.length ?? 0,
        corridorSourceCount: activeInspectorDependencyPaths.length,
        dependencySnapshotCount: request.dependencySnapshots.length,
        discoveryScope: policy.discoveryScope,
        discoveryTruncated: contextDiscoveryTruncated === true,
        executableCandidateCount: activeInspectorPlan === undefined ? 0 : 1,
        preparationMode: policy.mode,
        styleSnapshotCount: styleContext.tailwindCandidateSnapshots.length,
      };
      context?.reportProgress?.('analyzing-project', {
        ...compilerGraphSummary,
        kind: 'graph-plan',
      });
      if (preparedBundleExecution !== undefined) {
        context?.reportProgress?.('analyzing-project', preparedBundleExecution.activity);
        preparedBundleExecution.throwIfRejected(request.documentPath);
      }
      if (activeDependencyResolutionHints === undefined && preparedBundleExecution !== undefined) {
        const preflightMessages = await collectPreviewDependencyResolutionPreflightMessages({
          readSource: async (sourcePath) =>
            snapshotSourceByPath.get(path.normalize(sourcePath)) ??
            (await this.projectUsageCache.readSourceText({
              maximumBytes: 2 * 1024 * 1024,
              sourcePath,
            })),
          resolveModule: analysisStaticModuleResolver.resolve,
          sourcePaths: [
            ...preparedBundleExecution.prepared.frontier.authenticSourcePaths,
            ...styleContext.tailwindCandidateSnapshots.map((snapshot) => snapshot.documentPath),
            ...applicationStylesheetImports.flatMap((selection) => {
              const resolved = analysisStaticModuleResolver.resolve(
                selection.moduleSpecifier,
                selection.importerPath,
              );
              if (resolved !== undefined) return [resolved];
              return selection.moduleSpecifier.startsWith('.')
                ? [path.resolve(path.dirname(selection.importerPath), selection.moduleSpecifier)]
                : [];
            }),
          ],
        });
        const preflightHints = await createPreviewDependencyResolutionHintPlan(
          preflightMessages,
          acquisitionContext,
          this.dependencyResolutionNeuralModel,
        );
        const hasRenderOnlyContracts =
          preflightHints.facadeSourcePaths.length > 0 ||
          preflightHints.packageContractCandidates.length > 0 ||
          preflightHints.styleCandidates.length > 0;
        if (hasRenderOnlyContracts) {
          activeDependencyResolutionHints =
            createPreviewRenderOnlyDependencyResolutionHintPlan(preflightHints);
        }
      }
      const analysisTarget = activeInspectorPlan?.target ?? targetUsageProps.inspectorPlan?.target;
      const runtimeTargetMode = resolvePreviewInspectorRuntimeTargetMode(
        activeInspectorPlan,
        request.inspectorTargetMode,
      );
      let runtimeOwnershipTarget = plannedRouteExecution?.runtimeOwnershipTarget ?? analysisTarget;
      if (plannedRouteExecution === undefined && runtimeTargetMode !== undefined) {
        if (request.renderMode !== 'page-inspector' || analysisTarget === undefined) {
          throw new PreviewCompilationError(
            'React Preview could not validate the selected route leaf for runtime ownership.',
            [
              {
                location: { column: 0, file: request.documentPath, line: 1 },
                message:
                  'Selected-route ownership requires an exact Page Inspector analysis target.',
                severity: 'error',
              },
            ],
          );
        }
        const selectedLeafPath = activePageExecutionCandidate?.browserCandidate.target?.sourcePath;
        const selectedLeafSourceText =
          selectedLeafPath === undefined
            ? undefined
            : (snapshotSourceByPath.get(path.normalize(selectedLeafPath)) ??
              (await this.projectUsageCache.readSourceText({
                maximumBytes: 1024 * 1024,
                sourcePath: selectedLeafPath,
              })));
        runtimeOwnershipTarget = resolvePreviewInspectorRuntimeOwnershipTarget({
          analysisTarget,
          ...(activePageExecutionCandidate === undefined
            ? {}
            : { candidate: activePageExecutionCandidate }),
          diagnosticPath: request.documentPath,
          ...(request.inspectorRouteSelection === undefined
            ? {}
            : { routeSelection: request.inspectorRouteSelection }),
          ...(activeInspectorPlan?.routeSelectionResolution === undefined
            ? {}
            : { routeSelectionResolution: activeInspectorPlan.routeSelectionResolution }),
          ...(selectedLeafSourceText === undefined ? {} : { selectedLeafSourceText }),
          targetMode: runtimeTargetMode,
        });
      }
      throwIfPreviewBuildCancelled(buildSignal);
      const runtimeTargetReference = runtimeOwnershipTarget ?? analysisTarget;
      const selectedTargetExportNames =
        runtimeTargetReference === undefined
          ? []
          : runtimeTargetMode === 'selected-route-leaf'
            ? [runtimeTargetReference.exportName]
            : Object.keys(
                (targetUsageProps.inspectorPlan ?? activeInspectorPlan)?.renderChainsByExport ?? {},
              );
      const targetModuleSourceText =
        runtimeTargetReference === undefined
          ? undefined
          : (snapshotSourceByPath.get(path.normalize(runtimeTargetReference.sourcePath)) ??
            (path.normalize(runtimeTargetReference.sourcePath) ===
            path.normalize(request.documentPath)
              ? request.sourceText
              : await this.projectUsageCache.readSourceText({
                  maximumBytes: 1024 * 1024,
                  sourcePath: runtimeTargetReference.sourcePath,
                })));
      if (
        runtimeTargetReference !== undefined &&
        request.renderMode === 'page-inspector' &&
        targetModuleSourceText === undefined
      ) {
        throw new PreviewCompilationError(
          'React Preview could not read the exact runtime ownership target.',
          [
            {
              location: {
                column: 0,
                file: runtimeTargetReference.sourcePath,
                line: 1,
              },
              message: 'The prepared target module source is unavailable.',
              severity: 'error',
            },
          ],
        );
      }
      const targetModuleContract =
        plannedRouteExecution?.targetModuleContract ??
        (runtimeTargetReference === undefined ||
        request.renderMode !== 'page-inspector' ||
        targetModuleSourceText === undefined
          ? undefined
          : createPreviewInspectorTargetModuleContract({
              preparedSourceText: targetSelection.prepareSource(
                canonicalizeExistingPath(runtimeTargetReference.sourcePath),
                targetModuleSourceText,
              ),
              selectedExportNames: selectedTargetExportNames,
              sourcePath: runtimeTargetReference.sourcePath,
            }));
      const localTargetModuleContract =
        targetModuleContract ??
        (request.renderMode !== 'page-inspector' || inspectorExportName === undefined
          ? undefined
          : createPreviewInspectorTargetModuleContract({
              preparedSourceText: targetSelection.sourceText,
              selectedExportNames: [inspectorExportName],
              sourcePath: request.documentPath,
            }));
      const localTargetModuleSourceText =
        targetModuleContract === undefined ? request.sourceText : targetModuleSourceText;
      const initialDragDropRequirement =
        localTargetModuleContract === undefined || localTargetModuleSourceText === undefined
          ? undefined
          : collectPreviewDragDropRequirement(
              localTargetModuleContract.sourcePath,
              localTargetModuleSourceText,
            );
      const runtimeTargetInferredPropsByExport =
        localTargetModuleContract === undefined || localTargetModuleSourceText === undefined
          ? inferredPropsByExport
          : collectTargetInferredProps(
              localTargetModuleContract.sourcePath,
              localTargetModuleSourceText,
            );
      const targetRenderOutcomePlans =
        localTargetModuleContract === undefined || localTargetModuleSourceText === undefined
          ? []
          : analyzePreviewReactRenderOutcomes(
              localTargetModuleContract.sourcePath,
              path.normalize(localTargetModuleContract.sourcePath) ===
                path.normalize(request.documentPath)
                ? targetSelection.sourceText
                : localTargetModuleSourceText,
            ).filter((plan) =>
              localTargetModuleContract.selectedExportNames.includes(plan.exportName),
            );
      const navigationOnlyTargetExportNames = targetRenderOutcomePlans
        .filter((plan) => isPreviewInspectorNavigationOnlyRenderOutcomePlan(plan))
        .map((plan) => plan.exportName);
      const effectControllerTargetExportNames = targetRenderOutcomePlans
        .filter((plan) => isPreviewInspectorEffectControllerRenderOutcomePlan(plan))
        .map((plan) => plan.exportName);
      const executionRootRole = activePageExecutionCandidate?.executionRootContract;
      const executionRootSourceText =
        executionRootRole === undefined
          ? undefined
          : (snapshotSourceByPath.get(path.normalize(executionRootRole.sourcePath)) ??
            (path.normalize(executionRootRole.sourcePath) === path.normalize(request.documentPath)
              ? request.sourceText
              : await this.projectUsageCache.readSourceText({
                  maximumBytes: 1024 * 1024,
                  sourcePath: executionRootRole.sourcePath,
                })));
      if (executionRootRole !== undefined && executionRootSourceText === undefined) {
        throw new PreviewCompilationError(
          'React Preview could not read the exact PageExecution root.',
          [
            {
              location: {
                column: 0,
                file: executionRootRole.sourcePath,
                line: 1,
              },
              message: 'The prepared execution-root module source is unavailable.',
              severity: 'error',
            },
          ],
        );
      }
      const executionRootModuleContract =
        plannedRouteExecution?.executionRootModuleContract ??
        (executionRootRole === undefined || executionRootSourceText === undefined
          ? undefined
          : createPreviewInspectorExecutionRootModuleContract({
              ...(activePageExecutionCandidate?.criticalSurfaces.find(
                (surface) => surface.id === executionRootRole.surfaceId,
              )?.strategy === 'selected-route-surface'
                ? { allowDefaultExportFallback: true }
                : {}),
              exportName: executionRootRole.exportName,
              preparedSourceText: targetSelection.prepareSource(
                canonicalizeExistingPath(executionRootRole.sourcePath),
                executionRootSourceText,
              ),
              sourcePath: executionRootRole.sourcePath,
              surfaceId: executionRootRole.surfaceId,
            }));
      const adaptiveBuildSeed = await preparePreviewAdaptiveBuildSeed({
        globalBridgeEvidencePolicy,
        nodeModulesPaths: managedDependencyEnvironment.nodeModulesPaths,
        projectRoot,
        readSource: (sourcePath) =>
          snapshotSourceByPath.get(path.normalize(sourcePath)) ??
          this.projectUsageCache.readSourceText({ maximumBytes: 1024 * 1024, sourcePath }),
        sourcePaths:
          preparedBundleExecution?.prepared.frontier.authenticSourcePaths ??
          activeInspectorDependencyPaths,
        staticModuleResolver: analysisStaticModuleResolver,
        workspaceRoot: canonicalWorkspaceRoot,
      });
      staticModuleResolutionMemo?.release();
      const createStorybookFallbackBoundary = (
        environment: PreviewRuntimeEnvironment,
      ): PreviewSetupFallbackBoundary | undefined =>
        environment.setupKind === 'storybook' && environment.setupModulePath !== undefined
          ? new PreviewSetupFallbackBoundary(
              environment.setupModulePath,
              projectRoot,
              canonicalWorkspaceRoot,
            )
          : undefined;
      let activeStorybookFallbackBoundary: PreviewSetupFallbackBoundary | undefined;
      const runBuild = async (
        environment: PreviewRuntimeEnvironment,
        routerSelection: PreviewRouterBuildSelection,
        globalPackagePlan: PreviewGlobalPackageBridgePlan,
        adaptivePass: 1 | 2,
        fallbackBoundary?: PreviewSetupFallbackBoundary,
      ): Promise<
        PreviewCompilerBuildExecution & {
          readonly referencedGlobalNames: readonly string[];
          readonly routerRequirement: ReturnType<PreviewSourceTransformer['getRouterRequirement']>;
        }
      > => {
        const styledComponentsCompilerPlan = createPreviewStyledComponentsCompilerPlan(
          styleContext.styledComponentsPlan,
        );
        const inspectorAnalysisPlan =
          request.renderMode === 'page-inspector' ? targetUsageProps.inspectorPlan : undefined;
        const inspectorPlan =
          request.renderMode === 'page-inspector' ? activeInspectorPlan : undefined;
        const activeParentSlices =
          request.renderMode !== 'page-inspector' && environment.setupKind === 'none'
            ? targetUsageProps.parentSlicesByExport
            : {};
        const sourceTransformer = new PreviewSourceTransformer({
          ...(findPreviewDependencySpecifier(dependencyProfile, 'ag-grid-enterprise') !== undefined
            ? { agGridModulePackage: 'enterprise' as const }
            : findPreviewDependencySpecifier(dependencyProfile, 'ag-grid-community') !== undefined
              ? { agGridModulePackage: 'community' as const }
              : {}),
          ...(criticalSurfaceSourcePaths.length === 0 ? {} : { criticalSurfaceSourcePaths }),
          deferDormantOverlayImports: policy.deferDormantOverlayImports,
          documentPath: canonicalizeExistingPath(
            runtimeTargetMode === 'selected-route-leaf'
              ? (runtimeOwnershipTarget?.sourcePath ?? request.documentPath)
              : request.documentPath,
          ),
          ...(activePageExecutionCandidate?.evidenceSourcePaths === undefined
            ? {}
            : {
                preservedDormantOverlaySourcePaths:
                  activePageExecutionCandidate.evidenceSourcePaths,
              }),
          selectiveDependencyPassThrough: policy.selectiveDependencyPassThrough,
          implicitPackageGlobalCandidateNames: globalPackagePlan.fallbackCandidateNames,
          implicitPackageGlobalResolver: staticModuleResolver,
          instrumentDataRequests: request.renderMode === 'page-inspector',
          instrumentGraphqlDocuments: request.renderMode === 'page-inspector',
          instrumentRenderConditions: request.renderMode === 'page-inspector',
          instrumentRuntimeEffectIsolation: request.renderMode === 'page-inspector',
          instrumentRuntimeHookFallbacks: request.renderMode === 'page-inspector',
          ...(localTargetModuleContract === undefined
            ? {}
            : {
                localTargetExportInstrumentation: {
                  metadataByExport: Object.fromEntries(
                    localTargetModuleContract.selectedExportNames.map((exportName) => {
                      const inference = runtimeTargetInferredPropsByExport[exportName];
                      return [
                        exportName,
                        {
                          compilerExportEvidence: true as const,
                          ...(effectControllerTargetExportNames.includes(exportName)
                            ? { effectControllerOutputCandidate: true as const }
                            : {}),
                          exportName,
                          facadeResolutionEvidence: true as const,
                          ...(inference === undefined
                            ? {}
                            : {
                                inferredPropShape: inference.shape,
                                inferredProps: inference.provenance,
                              }),
                          ...(navigationOnlyTargetExportNames.includes(exportName)
                            ? { intentionalNavigationOutput: true as const }
                            : {}),
                          preparedSourceDigest: localTargetModuleContract.preparedSourceDigest,
                          sourcePath: localTargetModuleContract.sourcePath,
                          ...(activePageExecutionCandidate?.fidelity === 'target-only'
                            ? { targetOnlyExecution: true as const }
                            : {}),
                        },
                      ];
                    }),
                  ),
                  sourcePath: localTargetModuleContract.sourcePath,
                },
              }),
          graphqlModuleResolver: staticModuleResolver,
          jsxRuntimeResolver: staticModuleResolver,
          projectRoot,
          projectUsesNextRuntime: nextEvidence.projectRuntime,
          projectUsesReactRuntime:
            findPreviewDependencySpecifier(dependencyProfile, 'react') !== undefined,
          readGraphqlSource: (sourcePath) => snapshotSourceByPath.get(path.normalize(sourcePath)),
          workspaceRoot: canonicalWorkspaceRoot,
        });
        const sourceCompilation: WorkspaceSourceCompilationState = {
          prepareSource: targetSelection.prepareSource,
          runtimeInstanceKey: createPreviewRuntimeInstanceKey(),
          snapshots: [
            {
              documentPath: request.documentPath,
              language: request.language,
              sourceText: request.sourceText,
            },
            ...request.dependencySnapshots,
            ...styleContext.tailwindCandidateSnapshots,
          ],
          transformer: sourceTransformer,
        };
        const sassOptions: PreviewSassPluginOptions = {
          projectRoot,
          workspaceRoot: canonicalWorkspaceRoot,
        };
        const oneShotSassBoundary =
          fallbackBoundary === undefined ? undefined : createPreviewSassPlugin(sassOptions);
        const entrySource = createPreviewEntry({
          documentName: createPreviewDocumentName(request),
          ...(documentShellEvidence === undefined
            ? {}
            : { documentShell: documentShellEvidence.shell }),
          globalNamespaces: environment.globalNamespaces,
          globalPackageBridgeStatus: describeGlobalPackageBridgeStatus(globalPackagePlan),
          publicEnvironment: environment.publicEnvironment,
          ...(inspectorSourceGestureSecret === undefined ? {} : { inspectorSourceGestureSecret }),
          reactDomRootKind,
          renderMode: request.renderMode ?? 'component',
          portalHostIds,
          setupKind: environment.setupKind,
          styleSheetManagerPlanEnabled: true,
        });
        const entryStrategy = styledComponentsCompilerPlan.createEntryStrategy({
          entrySource,
          reactDomRootKind,
          renderMode: request.renderMode ?? 'component',
          resolveDir: path.dirname(request.documentPath),
          singleEntryPoint: path.relative(
            request.workspaceRoot,
            path.join(path.dirname(request.documentPath), VIRTUAL_ENTRY_NAME),
          ),
        });
        let styleDependencyPaths: readonly string[] = [];
        let styleWatchDirectories: readonly string[] = [];
        const outputSelection = entryStrategy.outputSelection;
        const createBuildOptions = (
          incrementalState: MutableWorkspaceSourceState | undefined,
          sassBoundary: PreviewSassBoundary,
        ): PreviewIncrementalBuildOptions => {
          const transformer = incrementalState?.transformer ?? sourceTransformer;
          const buildOptions: PreviewIncrementalBuildOptions = {
            absWorkingDir: request.workspaceRoot,
            bundle: true,
            charset: 'utf8',
            define: {
              ...createPreviewLegacyCommonJsGlobalDefines(legacyCommonJsGlobalNames),
              'import.meta.env': JSON.stringify(
                createPreviewImportMetaEnvironment(environment.publicEnvironment),
              ),
              'process.env.NODE_ENV': '"development"',
            },
            chunkNames: 'chunks/[hash]',
            entryNames: entryStrategy.kind === 'shared-styled-runtime' ? '[name]' : 'entry',
            format: 'esm',
            jsx: 'automatic',
            jsxDev: true,
            legalComments: 'none',
            loader: PREVIEW_SOURCE_LOADERS,
            logLevel: 'silent',
            metafile: true,
            nodePaths: [...managedDependencyEnvironment.nodeModulesPaths],
            outdir: path.resolve(request.workspaceRoot, PREVIEW_OUTPUT_DIRECTORY_NAME),
            platform: 'browser',
            plugins: [
              createPreviewInstalledPackageExternalizationPlugin({
                documentPath: request.documentPath,
                staticModuleResolver,
              }),
              ...entryStrategy.plugins,
              ...(inspectorPlan === undefined
                ? []
                : [createPreviewInspectorRuntimePlugin({ projectRoot })]),
              createPreviewNodeBuiltinPlugin(),
              createPreviewManagedDependencyPeerPlugin({
                managedNodeModulesPaths: managedDependencyEnvironment.nodeModulesPaths,
                projectRoot,
              }),
              createPreviewPnpPeerDependencyPlugin({
                applicationSourcePaths:
                  inspectorPlan?.pageCandidates.map((candidate) => candidate.root.sourcePath) ?? [],
                projectRoot,
                workspaceRoot: canonicalWorkspaceRoot,
              }),
              createPreviewLegacyNbindCspPlugin({
                readSource: (options) => this.projectUsageCache.readSourceText(options),
              }),
              ...(activeDependencyResolutionHints !== undefined &&
              (activeDependencyResolutionHints.facadeSourcePaths.length > 0 ||
                activeDependencyResolutionHints.packageContractCandidates.length > 0 ||
                activeDependencyResolutionHints.styleCandidates.length > 0)
                ? [
                    createPreviewDependencyResolutionHintPlugin({
                      facadeHints: activeDependencyResolutionHints.facadeCandidates,
                      facadeSourcePaths: activeDependencyResolutionHints.facadeSourcePaths,
                      onHintApplied: (score) => {
                        appliedDependencyHintScores.add(score);
                      },
                      packageContractHints:
                        activeDependencyResolutionHints.packageContractCandidates,
                      readSource: (sourcePath) =>
                        snapshotSourceByPath.get(path.normalize(sourcePath)) ??
                        this.projectUsageCache.readSourceText({
                          maximumBytes: 2 * 1024 * 1024,
                          sourcePath,
                        }),
                      styleHints: activeDependencyResolutionHints.styleCandidates,
                      workspaceRoot: canonicalWorkspaceRoot,
                    }),
                  ]
                : []),
              ...(inspectorPlan === undefined
                ? []
                : [
                    createPreviewInspectorTargetPlugin({
                      ...(runtimeTargetMode !== undefined ||
                      targetUsageProps.inspectorTargetImportSpecifiers === undefined
                        ? {}
                        : {
                            acceptedTargetImportSpecifiers:
                              targetUsageProps.inspectorTargetImportSpecifiers,
                          }),
                      inferredPropsByExport: runtimeTargetInferredPropsByExport,
                      effectControllerExportNames: effectControllerTargetExportNames,
                      navigationOnlyExportNames: navigationOnlyTargetExportNames,
                      targetOnlyExecution: activePageExecutionCandidate?.fidelity === 'target-only',
                      targetModuleContract:
                        targetModuleContract ??
                        createPreviewInspectorTargetModuleContract({
                          preparedSourceText: targetSelection.sourceText,
                          selectedExportNames: Object.keys(
                            (inspectorAnalysisPlan ?? inspectorPlan).renderChainsByExport,
                          ),
                          sourcePath: inspectorPlan.target.sourcePath,
                        }),
                    }),
                    ...[
                      createPreviewInspectorPageExecutionBuildPlugin(
                        activePageExecutionCandidate,
                        (sourcePath) => snapshotSourceByPath.get(sourcePath),
                        (sourcePath, sourceText) => transformer.transform(sourcePath, sourceText),
                      ),
                    ].filter(
                      (plugin): plugin is NonNullable<typeof plugin> => plugin !== undefined,
                    ),
                    createPreviewInspectorCorridorPlugin({
                      ...(policy.maximumSmallDynamicImports === undefined
                        ? {}
                        : { maximumSmallDynamicImports: policy.maximumSmallDynamicImports }),
                      ...(preparedBundleExecution === undefined
                        ? {}
                        : {
                            frozenAuthenticSourcePaths:
                              preparedBundleExecution.prepared.frontier.authenticSourcePaths,
                            authenticComponentExports:
                              preparedBundleExecution.prepared.frontier.authenticComponentExports,
                            packageDemandSourcePaths:
                              preparedBundleExecution.prepared.frontier.packageDemandSourcePaths,
                            projectedEdges:
                              preparedBundleExecution.prepared.frontier.projectedEdges,
                          }),
                      optimizeSelectedPackageBarrels: policy.optimizeSelectedPackageBarrels,
                      plan: inspectorPlan,
                      projectRoot,
                      readSource: (p) => snapshotSourceByPath.get(path.normalize(p)),
                      resolveModule: staticModuleResolver.resolve,
                      workspaceRoot: canonicalWorkspaceRoot,
                    }),
                  ]),
              createPreviewMissingSourceFallbackPlugin({
                selectedCorridorPreparation: policy.discoveryScope === 'selected-corridor',
                readSource: (sourcePath) => snapshotSourceByPath.get(path.normalize(sourcePath)),
                registerWatchDirectory: transformer.registerWatchDirectory.bind(transformer),
                staticModuleResolver,
                workspaceRoot: canonicalWorkspaceRoot,
              }),
              createPreviewGlobalPackageBridgePlugin({ plan: globalPackagePlan }),
              createPreviewApolloBridgePlugin({ projectRoot }),
              createPreviewContextBridgePlugin({ projectRoot }),
              createPreviewDragDropBridgePlugin({
                ...(initialDragDropRequirement === undefined
                  ? {}
                  : { initialRequirement: initialDragDropRequirement }),
                projectRoot,
              }),
              createPreviewFormikBridgePlugin({ projectRoot }),
              createPreviewYarnLibuiBridgePlugin({ projectRoot }),
              createPreviewReduxBridgePlugin({
                ...(automaticReduxState === undefined
                  ? {}
                  : { automaticState: automaticReduxState }),
                projectRoot,
              }),
              createPreviewRouterBridgePlugin({
                automaticallyWrap: routerSelection.automaticallyWrap,
                enabled: routerSelection.enabled,
                nextAppEnabled:
                  inspectorPlan?.pageCandidates.some(
                    (candidate) => candidate.routeLocation?.evidenceKind === 'next-app-filesystem',
                  ) === true,
                projectRoot,
              }),
              createPreviewThemeBridgePlugin({
                projectRoot,
                readRuntimeInstanceKey: () =>
                  incrementalState?.runtimeInstanceKey ?? sourceCompilation.runtimeInstanceKey,
              }),
              styledComponentsCompilerPlan.managerPlanPlugin,
              createPreviewThemeCandidatePlugin(),
              createPreviewSetupBridgePlugin({
                ...(environment.setupModulePath === undefined
                  ? {}
                  : { setupModulePath: environment.setupModulePath }),
              }),
              createPreviewParentSlicePlugin({
                documentPath: request.documentPath,
                plansByExport: activeParentSlices,
              }),
              ...(inspectorPlan === undefined
                ? [
                    createPreviewTargetBridgePlugin({
                      applicationStylesheetImports,
                      documentPath: request.documentPath,
                      exports: targetExports,
                      parentSlicesByExport: activeParentSlices,
                      ...(request.renderMode !== 'page-inspector' ||
                      contextDiscoveryTruncated === true ||
                      inspectorExportName === undefined
                        ? {}
                        : { standalonePageTargetExportName: inspectorExportName }),
                      ...(selectedThemeImport === undefined
                        ? {}
                        : { themeImport: selectedThemeImport }),
                      inferredPropsByExport,
                      usagePropsByExport: targetUsageProps.propsByExport,
                    }),
                  ]
                : [
                    createPreviewInspectorRootPlugin({
                      applicationStylesheetImports,
                      displayName: path.basename(
                        (runtimeOwnershipTarget ?? inspectorPlan.target).sourcePath,
                      ),
                      globalStyleImports,
                      plan: inspectorAnalysisPlan ?? inspectorPlan,
                      ...(activePageExecutionCandidate === undefined
                        ? {}
                        : { pageExecutionCandidate: activePageExecutionCandidate }),
                      ...(executionRootModuleContract === undefined
                        ? {}
                        : { executionRootModuleContract }),
                      ...(pageExecutionCandidates.length === 0 ? {} : { pageExecutionCandidates }),
                      ...(request.inspectorPageCandidateId === undefined
                        ? {}
                        : { selectedPageCandidateId: request.inspectorPageCandidateId }),
                      ...(selectedThemeImport === undefined
                        ? {}
                        : { themeImport: selectedThemeImport }),
                      readSource: (p) => snapshotSourceByPath.get(path.normalize(p)),
                      runtimeOwnershipTarget: runtimeOwnershipTarget ?? inspectorPlan.target,
                      ...(targetModuleContract === undefined ? {} : { targetModuleContract }),
                      ...(runtimeTargetInferredPropsByExport[
                        (runtimeOwnershipTarget ?? inspectorPlan.target).exportName
                      ] === undefined
                        ? {}
                        : {
                            targetInference:
                              runtimeTargetInferredPropsByExport[
                                (runtimeOwnershipTarget ?? inspectorPlan.target).exportName
                              ],
                          }),
                    }),
                  ]),
              ...(fallbackBoundary === undefined ? [] : [fallbackBoundary.plugin]),
              createPreviewMdxFallbackPlugin({ workspaceRoot: canonicalWorkspaceRoot }),
              createPreviewAssetPlugin({
                documentPath: request.documentPath,
                projectRoot,
                registerWatchDirectory: transformer.registerWatchDirectory.bind(transformer),
                workspaceRoot: canonicalWorkspaceRoot,
              }),
              createPreviewTailwindPlugin({
                boundedSourceDiscovery: policy.boundedTailwindSourceDiscovery,
                fallbackNodeModulesPaths: managedDependencyEnvironment.nodeModulesPaths,
                ...(activeDependencyResolutionHints === undefined
                  ? {}
                  : { hintedStyleFallbacks: activeDependencyResolutionHints.styleCandidates }),
                projectRoot,
                readSourceSnapshots: () =>
                  incrementalState?.snapshots ?? sourceCompilation.snapshots,
                ...(requiredTailwindCompilerPackage === undefined
                  ? {}
                  : { requiredCompilerPackage: requiredTailwindCompilerPackage }),
                workspaceRoot: canonicalWorkspaceRoot,
              }),
              sassBoundary.plugin,
              createWorkspaceSourcePlugin(
                incrementalState === undefined
                  ? { ...sourceCompilation, workspaceRoot: canonicalWorkspaceRoot }
                  : { incrementalState, workspaceRoot: canonicalWorkspaceRoot },
              ),
            ],
            sourcemap: false,
            ...entryStrategy.buildOptions,
            target: 'es2022',
            treeShaking: true,
            ...(request.tsconfigPath === undefined ? {} : { tsconfig: request.tsconfigPath }),
            write: false,
          };
          if (resolutionConfinement === undefined) return buildOptions;
          const namespaceRegistry = createPreviewCompilerOwnedNamespaceRegistry(
            buildOptions.plugins ?? [],
            {
              inspectorPageExecutionEntry: activePageExecutionCandidate !== undefined,
              ...(policy.discoveryScope === 'selected-corridor'
                ? inspectorPlan === undefined || !policy.optimizeSelectedPackageBarrels
                  ? {}
                  : { largePackageBarrelOwner: 'inspector-corridor' as const }
                : { largePackageBarrelOwner: 'missing-source-fallbacks' as const }),
            },
          );
          const stdinSourcefile = buildOptions.stdin?.sourcefile;
          const syntheticInputRegistry = createPreviewSyntheticInputRegistry([
            ...(Object.hasOwn(buildOptions.define ?? {}, 'import.meta.env')
              ? [PREVIEW_IMPORT_META_ENV_DEFINE_INPUT]
              : []),
            ...(stdinSourcefile === undefined
              ? []
              : [
                  normalizePreviewMetafileSourceIdentity(
                    stdinSourcefile,
                    buildOptions.absWorkingDir ?? process.cwd(),
                  ),
                ]),
          ]);
          return {
            ...buildOptions,
            plugins: [
              createPreviewResolutionConfinementPlugin(
                resolutionConfinement,
                namespaceRegistry,
                syntheticInputRegistry,
              ),
              ...(buildOptions.plugins ?? []),
            ],
          };
        };
        const buildPlanIdentity = createPreviewBuildPlanIdentity({
          dependencyResolutionHints:
            activeDependencyResolutionHints === undefined
              ? undefined
              : {
                  facadeSourcePaths: activeDependencyResolutionHints.facadeSourcePaths,
                  facadeContracts: activeDependencyResolutionHints.facadeCandidates.map(
                    (candidate) => ({
                      contractExamples: candidate.contractExamples?.map((example) => ({
                        exportName: example.exportName,
                        mode: example.mode,
                        value: example.value,
                      })),
                      evidenceSourcePaths: candidate.evidenceSourcePaths,
                      sourcePath: candidate.sourcePath,
                    }),
                  ),
                  packageContracts: activeDependencyResolutionHints.packageContractCandidates.map(
                    (candidate) => ({
                      moduleSpecifier: candidate.moduleSpecifier,
                      sourcePath: candidate.sourcePath,
                    }),
                  ),
                  packageNames: activeDependencyResolutionHints.packageNames,
                  styleHints: activeDependencyResolutionHints.styleCandidates.map((candidate) => ({
                    moduleSpecifier: candidate.moduleSpecifier,
                    sourcePath: candidate.sourcePath,
                  })),
                  version: activeDependencyResolutionHints.version,
                },
          documentPath: request.documentPath,
          documentShell: { evidence: documentShellEvidence?.shell, portalHostIds },
          environment,
          applicationStylesheetImports,
          globalPackagePlan,
          globalStyleImports,
          inferredPropsByExport,
          inspectorPlan,
          inspectorBundleFrontier: preparedBundleExecution?.prepared.frontier.identity,
          legacyCommonJsGlobalNames,
          managedDependencyEnvironment: managedDependencyEnvironment.identity,
          parentSlices: activeParentSlices,
          preparationMode: request.preparationMode,
          projectRoot,
          reactDomRootKind,
          renderMode: request.renderMode,
          routerSelection,
          targetExports,
          targetUsageProps,
          themeImport: selectedThemeImport,
          tsconfigPath: request.tsconfigPath,
          styledComponents: styledComponentsCompilerPlan.buildIdentity,
          workspaceRoot: canonicalWorkspaceRoot,
        });
        const reportNativeActivity: PreviewIncrementalBuildActivityReporter = (activity) => {
          context?.reportProgress?.('bundling-modules', {
            ...compilerGraphSummary,
            ...activity,
            kind: 'native-build',
            pass: adaptivePass,
          });
        };
        const result =
          fallbackBoundary === undefined
            ? await this.incrementalBuildCache.rebuild({
                captureSassState: (dependencyPaths, watchDirectories) => {
                  styleDependencyPaths = dependencyPaths;
                  styleWatchDirectories = watchDirectories;
                },
                contextKey: buildPlanIdentity,
                createOptions: (sourceState, sassBoundary) =>
                  createBuildOptions(sourceState, requirePreviewSassBoundary(sassBoundary)),
                reportActivity: reportNativeActivity,
                sassOptions,
                signal: buildSignal,
                sourceCompilation,
              })
            : await this.incrementalBuildCache.buildOnce(
                createBuildOptions(undefined, requirePreviewSassBoundary(oneShotSassBoundary)),
                buildSignal,
                reportNativeActivity,
              );
        if (oneShotSassBoundary !== undefined) {
          styleDependencyPaths = oneShotSassBoundary.getDependencyPaths();
          styleWatchDirectories = oneShotSassBoundary.getWatchDirectories();
        }
        throwIfPreviewBuildCancelled(buildSignal);
        return {
          globalPackagePlan,
          referencedGlobalNames: sourceTransformer.getReferencedImplicitPackageGlobalNames(),
          outputSelection,
          result,
          routerRequirement: sourceTransformer.getRouterRequirement(),
          styleDependencyPaths,
          watchDirectories: mergePreviewWatchDirectories(
            sourceTransformer.getWatchDirectories(),
            runtimeWatchInputs.watchDirectories,
            styleWatchDirectories,
          ),
        };
      };
      const runAdaptiveBuild = async (
        environment: PreviewRuntimeEnvironment,
      ): ReturnType<typeof runBuild> => {
        const adaptivePlanKey = createPreviewBuildPlanIdentity({
          dependencyResolutionHints:
            activeDependencyResolutionHints === undefined
              ? undefined
              : {
                  facadeSourcePaths: activeDependencyResolutionHints.facadeSourcePaths,
                  facadeContracts: activeDependencyResolutionHints.facadeCandidates.map(
                    (candidate) => ({
                      contractExamples: candidate.contractExamples?.map((example) => ({
                        exportName: example.exportName,
                        mode: example.mode,
                        value: example.value,
                      })),
                      evidenceSourcePaths: candidate.evidenceSourcePaths,
                      sourcePath: candidate.sourcePath,
                    }),
                  ),
                  packageContracts: activeDependencyResolutionHints.packageContractCandidates.map(
                    (candidate) => ({
                      moduleSpecifier: candidate.moduleSpecifier,
                      sourcePath: candidate.sourcePath,
                    }),
                  ),
                  packageNames: activeDependencyResolutionHints.packageNames,
                  styleHints: activeDependencyResolutionHints.styleCandidates.map((candidate) => ({
                    moduleSpecifier: candidate.moduleSpecifier,
                    sourcePath: candidate.sourcePath,
                  })),
                  version: activeDependencyResolutionHints.version,
                },
          documentPath: request.documentPath,
          environment,
          managedDependencyEnvironment: managedDependencyEnvironment.identity,
          preparationMode: request.preparationMode,
          projectRoot,
          renderMode: request.renderMode,
          tsconfigPath: request.tsconfigPath,
          workspaceRoot: canonicalWorkspaceRoot,
        });
        const cachedPlan = this.adaptiveBuildPlanCache.read(adaptivePlanKey);
        legacyCommonJsGlobalNames = cachedPlan?.legacyCommonJsGlobalNames ?? [];
        portalHostIds = mergePreviewPortalHostIds(
          styleContext.portalHostIds,
          cachedPlan?.portalHostIds ?? [],
        );
        const initialGlobalPackagePlan = await discoverPreviewGlobalPackageBridges({
          ...globalBridgeEvidencePolicy,
          nodeModulesPaths: managedDependencyEnvironment.nodeModulesPaths,
          projectRoot,
          referencedGlobalNames: [
            ...new Set([
              ...(cachedPlan?.referencedGlobalNames ?? []),
              ...adaptiveBuildSeed.referencedGlobalNames,
            ]),
          ].sort(),
          workspaceRoot: canonicalWorkspaceRoot,
        });
        const initialRouterSelection: PreviewRouterBuildSelection = selectPreviewInitialRouterBuild(
          cachedPlan?.routerRequirement,
          {
            consumesRouter:
              routerNeed.consumesRouter || adaptiveBuildSeed.routerRequirement.consumesRouter,
            ownsRouter: routerNeed.ownsRouter || adaptiveBuildSeed.routerRequirement.ownsRouter,
          },
        );
        let fallbackBoundary = createStorybookFallbackBoundary(environment);
        activeStorybookFallbackBoundary = fallbackBoundary;
        const initialBuild = await runBuild(
          environment,
          initialRouterSelection,
          initialGlobalPackagePlan,
          1,
          fallbackBoundary,
        );
        const exactGlobalPackagePlan = await discoverPreviewGlobalPackageBridges({
          ...globalBridgeEvidencePolicy,
          nodeModulesPaths: managedDependencyEnvironment.nodeModulesPaths,
          projectRoot,
          referencedGlobalNames: initialBuild.referencedGlobalNames,
          workspaceRoot: canonicalWorkspaceRoot,
        });
        const exactRouterSelection: PreviewRouterBuildSelection = initialBuild.routerRequirement
          .consumesRouter
          ? {
              automaticallyWrap: !initialBuild.routerRequirement.ownsRouter,
              enabled: true,
            }
          : { automaticallyWrap: false, enabled: false };
        const planIsExact =
          haveEquivalentRouterSelections(initialRouterSelection, exactRouterSelection) &&
          haveEquivalentGlobalPackageBridges(
            initialBuild.globalPackagePlan,
            exactGlobalPackagePlan,
          );
        let finalBuild = initialBuild;
        if (!planIsExact) {
          fallbackBoundary = createStorybookFallbackBoundary(environment);
          activeStorybookFallbackBoundary = fallbackBoundary;
          finalBuild = await runBuild(
            environment,
            exactRouterSelection,
            exactGlobalPackagePlan,
            2,
            fallbackBoundary,
          );
        }
        const readReachedSource = (
          sourcePath: string,
          maximumBytes: number,
        ): Promise<string | undefined> =>
          this.projectUsageCache.readSourceText({ maximumBytes, sourcePath });
        const [portalRefinement, legacyCommonJsRefinement] = await Promise.all([
          refinePreviewPortalHostsFromBuild({
            baselineHostIds: styleContext.portalHostIds,
            currentHostIds: portalHostIds,
            metafile: finalBuild.result.metafile,
            readSource: readReachedSource,
            request,
          }),
          discoverPreviewLegacyCommonJsGlobals({
            currentGlobalNames: legacyCommonJsGlobalNames,
            metafile: finalBuild.result.metafile,
            readSource: readReachedSource,
            request,
          }),
        ]);
        portalHostIds = portalRefinement.hostIds;
        legacyCommonJsGlobalNames = legacyCommonJsRefinement.globalNames;
        if (portalRefinement.changed || legacyCommonJsRefinement.changed) {
          /*
           * Post-build refinement changes generated entry/define bytes, so returning the graph that
           * merely discovered those values postpones compatibility until a later hot compile. Close
           * both proof-based refinements in one bounded same-request pass. Their discovery reads the
           * already successful graph and neither plan is allowed to recursively schedule a rebuild.
           */
          fallbackBoundary = createStorybookFallbackBoundary(environment);
          activeStorybookFallbackBoundary = fallbackBoundary;
          finalBuild = await runBuild(
            environment,
            exactRouterSelection,
            exactGlobalPackagePlan,
            2,
            fallbackBoundary,
          );
        }
        throwIfPreviewBuildCancelled(buildSignal);
        this.adaptiveBuildPlanCache.write(adaptivePlanKey, {
          legacyCommonJsGlobalNames,
          portalHostIds,
          referencedGlobalNames: finalBuild.referencedGlobalNames,
          routerRequirement: finalBuild.routerRequirement,
        });
        return finalBuild;
      };
      const outputStrategyKey = createPreviewBuildPlanIdentity({
        dependencyResolutionHints:
          activeDependencyResolutionHints === undefined
            ? undefined
            : {
                facadeSourcePaths: activeDependencyResolutionHints.facadeSourcePaths,
                facadeContracts: activeDependencyResolutionHints.facadeCandidates.map(
                  (candidate) => ({
                    contractExamples: candidate.contractExamples?.map((example) => ({
                      exportName: example.exportName,
                      mode: example.mode,
                      value: example.value,
                    })),
                    evidenceSourcePaths: candidate.evidenceSourcePaths,
                    sourcePath: candidate.sourcePath,
                  }),
                ),
                packageContracts: activeDependencyResolutionHints.packageContractCandidates.map(
                  (candidate) => ({
                    moduleSpecifier: candidate.moduleSpecifier,
                    sourcePath: candidate.sourcePath,
                  }),
                ),
                packageNames: activeDependencyResolutionHints.packageNames,
                styleHints: activeDependencyResolutionHints.styleCandidates.map((candidate) => ({
                  moduleSpecifier: candidate.moduleSpecifier,
                  sourcePath: candidate.sourcePath,
                })),
                version: activeDependencyResolutionHints.version,
              },
        documentPath: request.documentPath,
        managedDependencyEnvironment: managedDependencyEnvironment.identity,
        preparationMode: request.preparationMode,
        projectRoot,
        renderMode: request.renderMode,
        runtimeEnvironment,
        tsconfigPath: request.tsconfigPath,
        workspaceRoot: canonicalWorkspaceRoot,
      });
      const setupFailureKey = preparedSetupFallback.cacheKey;
      const cachedSetupFailure = preparedSetupFallback.plan;
      let activeRuntimeEnvironment =
        cachedSetupFailure === undefined
          ? runtimeEnvironment
          : { ...runtimeEnvironment, setupKind: 'none' as const, setupModulePath: undefined };
      let buildExecution: Awaited<ReturnType<typeof runBuild>> | undefined;
      let fallbackDependencies = cachedSetupFailure?.dependencyPaths ?? [];
      let fallbackWatchDirectories = cachedSetupFailure?.watchDirectories ?? [];
      let fallbackDiagnostics: readonly PreviewDiagnostic[] = preparedSetupFallback.diagnostics;
      throwIfPreviewBuildCancelled(buildSignal);
      if (preparedBundleExecution !== undefined)
        context?.reportProgress?.('bundling-modules', preparedBundleExecution.activity);
      context?.reportProgress?.('bundling-modules');
      try {
        try {
          buildExecution = await runAdaptiveBuild(activeRuntimeEnvironment);
        } catch (error) {
          if (dependencyRecoveryAttempted || !isBuildFailure(error)) {
            throw error;
          }
          const hints = await createPreviewDependencyResolutionHintPlan(
            error.errors,
            acquisitionContext,
            this.dependencyResolutionNeuralModel,
          );
          const hasRenderOnlyContracts =
            hints.facadeSourcePaths.length > 0 ||
            hints.packageContractCandidates.length > 0 ||
            hints.styleCandidates.length > 0;
          // A package acquisition changes the managed environment identity and must still restart
          // the compile. Pure render-only contracts can reuse the expensive page/frontier analysis
          // and rebuild immediately with only the exact failed edges changed.
          if (!hasRenderOnlyContracts || hints.packageNames.length > 0) throw error;
          dependencyRecoveryAttempted = true;
          activeDependencyResolutionHints = mergePreviewDependencyResolutionHintPlans(
            activeDependencyResolutionHints,
            hints,
          );
          buildExecution = await runAdaptiveBuild(activeRuntimeEnvironment);
        }
      } catch (error) {
        if (!isBuildFailure(error)) {
          throw error;
        }
        const failedFallbackBoundary = activeStorybookFallbackBoundary;
        if (failedFallbackBoundary?.shouldRetry(error.errors, request.workspaceRoot) !== true) {
          throw error;
        }
        const setupFailureMessage = error.errors[0]?.text ?? 'unknown setup error';
        const fallbackWatchInputs = await failedFallbackBoundary.createWatchInputs(
          error.errors,
          request.workspaceRoot,
        );
        throwIfPreviewBuildCancelled(buildSignal);
        fallbackDependencies = fallbackWatchInputs.dependencyPaths;
        fallbackWatchDirectories = fallbackWatchInputs.watchDirectories;
        const fallbackMessage = `Automatic Storybook preview setup was skipped for ${createPreviewDocumentName(request)} because it could not be bundled: ${restorePrivateNamespaces(setupFailureMessage)}. Configure reactPreview.setupFile or add .react-preview/setup.tsx for this project.${failedFallbackBoundary.requiresManualRefresh ? ' Refresh this preview manually after fixing a missing package or alias import.' : ''}`;
        fallbackDiagnostics = [
          {
            message: fallbackMessage,
            severity: 'warning',
          },
        ];
        if (setupFailureKey !== undefined && !failedFallbackBoundary.requiresManualRefresh) {
          await this.setupFailureCache.write(
            setupFailureKey,
            {
              dependencyPaths: [
                ...fallbackWatchInputs.dependencyPaths,
                ...runtimeWatchInputs.dependencyPaths,
              ],
              diagnosticMessage: fallbackMessage,
              watchDirectories: fallbackWatchInputs.watchDirectories,
            },
            request.dependencySnapshots,
            buildSignal,
          );
        }
        activeRuntimeEnvironment = {
          ...runtimeEnvironment,
          setupKind: 'none',
          setupModulePath: undefined,
        };
        buildExecution = await runAdaptiveBuild(activeRuntimeEnvironment);
      }
      buildExecution = {
        ...buildExecution,
        watchDirectories: mergePreviewWatchDirectories(
          buildExecution.watchDirectories,
          fallbackWatchDirectories,
        ),
      };
      const inspectorFallbackDiagnostics = createPreviewInspectorFallbackDiagnostics({
        admit: this.diagnosticEmissionCache.admit.bind(this.diagnosticEmissionCache),
        documentName: createPreviewDocumentName(request),
        hasInspectorPlan: targetUsageProps.inspectorPlan !== undefined,
        outputStrategyKey,
        request,
      });
      throwIfPreviewBuildCancelled(buildSignal);
      const previewBundle = await finalizePreviewCompilerBundle({
        admitBuildWarning: this.diagnosticEmissionCache.admitBuildWarning.bind(
          this.diagnosticEmissionCache,
        ),
        buildExecution,
        contextCoverage: resolvePreviewContextCoverage({
          contextDiscoveryTruncated,
          implicitGlobalEvidence,
          inspectorPlan: targetUsageProps.inspectorPlan,
          maximumPublishedPageCandidates: undefined,
          request,
        }),
        documentShellDependencyPath: documentShellEvidence?.dependencyPath,
        fallbackDependencies,
        fallbackDiagnostics,
        globalStyleDependencyPaths: [
          ...globalStyleImports.map((globalStyleImport) =>
            path.normalize(globalStyleImport.moduleSpecifier),
          ),
          ...applicationStylesheetImports.map((selection) =>
            path.normalize(selection.importerPath),
          ),
        ],
        inspectorFallbackDiagnostics,
        ...(preparedBundleExecution === undefined
          ? { inspectorBundleFrontier: undefined }
          : {
              inspectorBundleFrontier: {
                activity: preparedBundleExecution.activity,
                authenticSourcePaths:
                  preparedBundleExecution.prepared.frontier.authenticSourcePaths,
                packageDemandSourcePaths:
                  preparedBundleExecution.prepared.frontier.packageDemandSourcePaths,
                ...(activePageExecutionCandidate === undefined
                  ? {}
                  : { executionSurfaces: activePageExecutionCandidate.criticalSurfaces }),
              },
            }),
        isManagedDependencyPath: this.managedDependencyStore?.ownsPath.bind(
          this.managedDependencyStore,
        ),
        managedDependencyPaths: managedDependencyEnvironment.profile?.dependencyPaths ?? [],
        request,
        runtimeDependencyPaths: runtimeWatchInputs.dependencyPaths,
        styledComponentsDependencyPaths: styleContext.styledComponentsPlan.dependencyPaths,
        targetDependencyPaths: [
          ...targetUsageProps.dependencyPaths,
          ...(activeDependencyResolutionHints?.facadeCandidates.flatMap(
            (candidate) => candidate.evidenceSourcePaths ?? [],
          ) ?? []),
        ],
      });
      const preparedVendorModules = await this.vendorModuleBuilder.prepareWithEvidence({
        bundle: previewBundle,
        globalPackagePlan: buildExecution.globalPackagePlan,
        metafile: buildExecution.result.metafile,
        nodePaths: managedDependencyEnvironment.nodeModulesPaths,
        projectRoot,
        workspaceRoot: canonicalWorkspaceRoot,
      });
      const browserBundle = preparedVendorModules.bundle;
      assertPreviewResolutionPaths(resolutionConfinement, browserBundle.dependencies);
      const publicAssetRoot = await findPreviewPublicAssetRoot(projectRoot);
      const publicApplicationOrigin = resolvePreviewPublicApplicationOrigin(
        activeRuntimeEnvironment.publicEnvironment,
      );
      this.managedDependencyStore?.scheduleAdmission({
        dependencyPaths: [
          ...collectPreviewBuildDependencies(request, buildExecution.result.metafile),
          ...preparedVendorModules.dependencyPaths,
        ],
        profile: managedDependencyEnvironment.profile,
        workspaceRoot: canonicalWorkspaceRoot,
      });
      throwIfPreviewBuildCancelled(buildSignal);
      const browserBundleWithPublicAssets = {
        ...browserBundle,
        ...(publicApplicationOrigin === undefined ? {} : { publicApplicationOrigin }),
        ...(publicAssetRoot === undefined ? {} : { publicAssetRoot }),
      };
      recordDependencyHintBuildOutcome(true);
      return inspectorSourceGestureSecret === undefined
        ? browserBundleWithPublicAssets
        : { ...browserBundleWithPublicAssets, inspectorSourceGestureSecret };
    } catch (error) {
      recordDependencyHintBuildOutcome(false);
      return await resolvePreviewCompilerFailure({
        buildSignal,
        dependencyAcquisitionAttempted: dependencyRecoveryAttempted,
        error,
        retryCompilation: (hints) => this.compile(request, context, hints),
        target: request.documentPath,
        tryAcquireMissingDependencies: (errors) =>
          tryAcquirePreviewMissingDependencies({
            context: acquisitionContext,
            errors,
            neuralModel: this.dependencyResolutionNeuralModel,
            signal: buildSignal,
            store: this.managedDependencyStore,
          }),
      });
    } finally {
      staticModuleResolutionMemo?.release();
      detachCallerAbort();
      this.activeBuildControllers.delete(buildController);
    }
  }
  dispose(): void {
    void this.shutdown();
  }
  shutdown(): Promise<void> {
    if (this.shutdownPromise !== undefined) return this.shutdownPromise;
    this.disposed = true;
    return (this.shutdownPromise = shutdownPreviewCompiler({
      activeBuildControllers: this.activeBuildControllers,
      caches: [
        this.adaptiveBuildPlanCache,
        this.diagnosticEmissionCache,
        this.implicitGlobalEvidenceCache,
        this.projectUsageCache,
        this.setupFailureCache,
        this.vendorModuleBuilder,
        this.completeRouteInventoryCache,
      ],
      incrementalBuildCache: this.incrementalBuildCache,
      managedDependencyStore: this.managedDependencyStore,
    }));
  }
}

/** Mirrors esbuild's relative, forward-slash metafile identity for one configured stdin sourcefile. */
function normalizePreviewMetafileSourceIdentity(
  sourcefile: string,
  workingDirectory: string,
): string {
  const relativeSourcefile = path.isAbsolute(sourcefile)
    ? path.relative(workingDirectory, sourcefile)
    : sourcefile;
  return relativeSourcefile.split(path.sep).join('/');
}
