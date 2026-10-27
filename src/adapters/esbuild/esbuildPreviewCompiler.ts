import { randomBytes } from 'node:crypto';
import path from 'node:path';
import type { PreviewCompiler } from '../../application/previewCompiler';
import {
  PreviewCompilationError,
  type PreviewBuildRequest,
  type PreviewBundle,
  type PreviewDiagnostic,
} from '../../domain/preview';
import {
  throwIfPreviewBuildCancelled,
  type PreviewBuildExecutionContext,
} from '../../domain/previewBuildExecution';
import type { PreviewCompilerGraphSummary } from '../../domain/previewCompilerActivity';
import { canonicalizeExistingPath } from '../../shared/pathIdentity';
import {
  findPreviewDependencySpecifier,
  readPreviewDependencyProfile,
} from '../node/previewDependencyProfile';
import {
  EMPTY_MANAGED_ENVIRONMENT,
  PreviewManagedDependencyStore,
  type PreviewManagedDependencyEnvironment,
} from '../node/previewManagedDependencyStore';
import { findPreviewYarnLockedPackageVersion } from '../node/previewYarnLockPlan';
import {
  type PreviewCompleteRouteInventoryTelemetryObserver,
  type PreviewInspectorCompleteRouteBaseEntry,
  type PreviewInspectorCompleteRouteInventory,
  type PreviewInspectorCompleteRouteInventoryLimits,
  type PreviewInspectorExactRouteReplayResult,
} from './inspector/previewInspectorCompleteRouteInventory';
import { preparePreviewCompilerTargetContracts } from './preparePreviewCompilerTargetContracts';
import { preparePreviewCompilerUsage } from './preparePreviewCompilerUsage';
import { preparePreviewRouteExecutionFinalFrontier } from './preparePreviewRouteExecutionFinalFrontier';
import { forwardPreviewAbort } from './previewAbortForwarding';
import { PreviewAdapterStrategyLearner } from './previewAdapterStrategyLearner';
import { PREVIEW_ADAPTER_STRATEGY_SEED } from './previewAdapterStrategySeed';
import { PreviewAdaptiveBuildPlanCache } from './previewAdaptiveBuildPlanCache';
import { clearPreviewAnalysisSourceFileCache } from './previewAnalysisSourceFile';
import { prepareAutomaticPreviewSetupFallback } from './previewAutomaticSetupFallback';
import { createPreviewBuildPlanIdentity } from './previewBuildPlanIdentity';
import {
  collectPreviewBuildDependencies,
  isBuildFailure,
  normalizePreviewMetafileSourceIdentity,
  restorePrivateNamespaces,
} from './previewBuildResult';
import { executePreviewCompilerAdaptiveBuild } from './previewCompilerAdaptiveRunner';
import { executePreviewCompilerBuild } from './previewCompilerBuildRunner';
import { finalizePreviewCompilerBundle } from './previewCompilerBundleFinalizer';
import {
  createPreviewDocumentName,
  EMPTY_RUNTIME_WATCH_INPUTS,
  mergePreviewWatchDirectories,
} from './previewCompilerDefaults';
import { resolvePreviewCompilerFailure } from './previewCompilerFailure';
import type { EsbuildPreviewCompilerOptions } from './previewCompilerOptions';
import type { PreviewCompilerBuildRun } from './previewCompilerPhaseInputs';
import { createPreviewCompilerPropInference } from './previewCompilerPropInference';
import { PreviewCompilerRouteInventory } from './previewCompilerRouteInventory';
import { shutdownPreviewCompiler } from './previewCompilerShutdown';
import { resolvePreviewContextCoverage } from './previewContextCoverage';
import { createPreviewDependencyResolutionHintIdentity } from './previewDependencyResolutionHintIdentity';
import {
  PreviewDependencyResolutionNeuralModel,
  type PreviewDependencyResolutionNeuralScore,
} from './previewDependencyResolutionNeuralModel';
import { PreviewDiagnosticEmissionCache } from './previewDiagnosticEmissionCache';
import { collectPreviewHostIoServerSourcePaths } from './previewHostIoServerModules';
import { preparePreviewCompilerTarget } from './previewImperativeEntryTarget';
import { PreviewImplicitGlobalEvidenceCache } from './previewImplicitGlobalEvidenceCache';
import { PreviewIncrementalBuildCache } from './previewIncrementalBuildCache';
import { createPreviewInspectorFallbackDiagnostics } from './previewInspectorFallbackDiagnostic';
import { createInspectorSourceGestureSecret } from './previewInspectorSourceGestureSecret';
import {
  collectPreviewDependencyResolutionPreflightMessages,
  createPreviewDependencyResolutionHintPlan,
  createPreviewRenderOnlyDependencyResolutionHintPlan,
  mergePreviewDependencyResolutionHintPlans,
  tryAcquirePreviewMissingDependencies,
  type PreviewDependencyResolutionHintPlan,
  type PreviewMissingDependencyAcquisitionContext,
} from './previewMissingDependencyRequirements';
import { collectPreviewNextAuthAugmentationPaths } from './previewNextAuthSession';
import { readPreviewNextI18nConfig } from './previewNextConfigI18n';
import { collectPreviewNextRuntimeEvidence as findNext } from './previewNextRuntimeEvidence';
import { createPreviewPreparationPolicy } from './previewPreparationPolicy';
import { collectPreviewPrismaClientTypes } from './previewPrismaClientTypes';
import { findPreviewProjectRoot } from './previewProjectRoot';
import { PreviewProjectUsageCache } from './previewProjectUsageCache';
import { findPreviewPublicAssetRoot } from './previewPublicAssetRoot';
import { resolvePreviewPublicApplicationOrigin } from './previewPublicEnvironment';
import { selectPreviewReactDomRootKind } from './previewReactDomRootRuntimeSource';
import { collectPreviewReduxAutomaticStateParts } from './previewReduxAutomaticState';
import {
  assertPreviewResolutionPath,
  assertPreviewResolutionPaths,
  assertPreviewWatchedPaths,
  normalizePreviewResolutionConfinement,
} from './previewResolutionConfinement';
import { collectPreviewRouterRequirement } from './previewRouterRequirement';
import {
  createPreviewRuntimeWatchInputs,
  resolvePreviewRuntimeEnvironment,
  type PreviewRuntimeEnvironment,
} from './previewRuntimeEnvironment';
import { PreviewSetupFailureCache } from './previewSetupFailureCache';
import { PreviewSetupFallbackBoundary } from './previewSetupFallbackBoundary';
import {
  createPreviewStaticModuleResolutionMemo,
  createPreviewStaticModuleResolver,
  type PreviewStaticModuleResolutionMemo,
} from './previewStaticModuleResolver';
import { selectPreviewTailwindCompilerPackage } from './previewTailwindImplementation';
import { selectPreviewThemeImport } from './previewTargetExports';
import { assertPreviewReactTarget } from './previewTargetRuntimeGuard';
import { PreviewVendorModuleBuilder } from './previewVendorModuleBuilder';
import { shouldEscalatePreviewAncestorSearch } from './previewWorkspaceAncestorPolicy';
import { PreviewTypeOracle } from './typeOracle/previewTypeOracle';
import { resolvePreviewTypeLibDirectory } from './typeOracle/previewTypeProgram';
export type { EsbuildPreviewCompilerOptions } from './previewCompilerOptions';
/** Owns compiler caches, cancellation, frozen route analysis, and adapter shutdown across preview revisions. */
export class EsbuildPreviewCompiler implements PreviewCompiler {
  private readonly activeBuildControllers = new Set<AbortController>();
  private readonly adaptiveBuildPlanCache = new PreviewAdaptiveBuildPlanCache();
  private disposed = false;
  private readonly implicitGlobalEvidenceCache = new PreviewImplicitGlobalEvidenceCache();
  private readonly projectUsageCache = new PreviewProjectUsageCache();
  private readonly incrementalBuildCache: PreviewIncrementalBuildCache;
  private readonly diagnosticEmissionCache = new PreviewDiagnosticEmissionCache();
  private readonly dependencyResolutionNeuralModel = new PreviewDependencyResolutionNeuralModel();
  private readonly setupFailureCache = new PreviewSetupFailureCache();
  private readonly typeOracle: PreviewTypeOracle;
  private readonly vendorModuleBuilder: PreviewVendorModuleBuilder;
  private readonly routeInventory: PreviewCompilerRouteInventory;
  private readonly inspectorGestureSeed = randomBytes(32);
  private readonly managedDependencyStore: PreviewManagedDependencyStore | undefined;
  private readonly adapterStrategyLearner: PreviewAdapterStrategyLearner | undefined;
  private shutdownPromise: Promise<void> | undefined;
  /** Creates compiler-owned caches and optional storage without executing workspace configuration. */
  public constructor(options: EsbuildPreviewCompilerOptions = {}) {
    this.incrementalBuildCache = new PreviewIncrementalBuildCache(options.createSassTask);
    this.adapterStrategyLearner =
      options.adapterLearningRoot === undefined
        ? undefined
        : new PreviewAdapterStrategyLearner({
            seed: PREVIEW_ADAPTER_STRATEGY_SEED,
            storePath: path.join(options.adapterLearningRoot, 'adapter-strategies.json'),
          });
    this.typeOracle = new PreviewTypeOracle(
      resolvePreviewTypeLibDirectory(options.bundledNodeModulesPath),
    );
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

    this.routeInventory = new PreviewCompilerRouteInventory({
      isDisposed: () => this.disposed,
      managedDependencyStore: this.managedDependencyStore,
      projectUsageCache: this.projectUsageCache,
      implicitGlobalEvidenceCache: this.implicitGlobalEvidenceCache,
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
    return this.routeInventory.collectCompleteRouteInventory(request, limits, signal, observer);
  }

  /** Independently replays one frozen inventory identity with compiler-owned inert analysis. */
  public async replayCompleteRouteInventoryEntry(
    request: PreviewBuildRequest,
    entry: PreviewInspectorCompleteRouteBaseEntry,
  ): Promise<PreviewInspectorExactRouteReplayResult> {
    return this.routeInventory.replayCompleteRouteInventoryEntry(request, entry);
  }

  /** Builds the pinned snapshot or throws cancellation and structured compilation diagnostics; preserves caches across revisions. */
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
      const nextPagesI18n = nextEvidence.projectRuntime
        ? await readPreviewNextI18nConfig(projectRoot)
        : undefined;
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
        selectPreviewTailwindCompilerPackage(dependencyProfile);
      assertPreviewReactTarget(request, dependencyProfile, analysisStaticModuleResolver);
      const targetSelection = preparePreviewCompilerTarget(request);
      const routerNeed = collectPreviewRouterRequirement(request.documentPath, request.sourceText);
      const targetExports = targetSelection.targetExports;
      const collectTargetInferredProps = createPreviewCompilerPropInference(
        request,
        canonicalWorkspaceRoot,
        analysisStaticModuleResolver,
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
      const readFrontierSource = async (sourcePath: string): Promise<string | undefined> =>
        snapshotSourceByPath.get(path.normalize(sourcePath)) ??
        (await this.projectUsageCache.readSourceText({
          maximumBytes: 1024 * 1024,
          sourcePath,
        }));
      const frontierSourcePaths = [
        ...activeInspectorDependencyPaths,
        ...(preparedBundleExecution?.prepared.frontier.authenticSourcePaths ?? []),
      ];
      const automaticRedux = await collectPreviewReduxAutomaticStateParts({
        readSource: readFrontierSource,
        sourcePaths: frontierSourcePaths,
      });
      const nextAuthAugmentationPaths =
        request.renderMode === 'page-inspector'
          ? await collectPreviewNextAuthAugmentationPaths({
              frontierSourcePaths,
              readInventory: () =>
                this.projectUsageCache.getSourcePaths(
                  canonicalWorkspaceRoot,
                  projectRoot,
                  buildSignal,
                ),
              readSource: readFrontierSource,
            })
          : [];
      const prismaClientTypes =
        request.renderMode === 'page-inspector'
          ? await collectPreviewPrismaClientTypes({
              frontierSourcePaths,
              projectRoot,
              readSource: readFrontierSource,
              workspaceRoot: canonicalWorkspaceRoot,
            })
          : undefined;
      const buildState: {
        legacyCommonJsGlobalNames: readonly string[];
        portalHostIds: readonly string[];
        activeStorybookFallbackBoundary: PreviewSetupFallbackBoundary | undefined;
      } = {
        legacyCommonJsGlobalNames: [],
        portalHostIds: styleContext.portalHostIds,
        activeStorybookFallbackBoundary: undefined,
      };

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
        const readPreflightSource = async (sourcePath: string): Promise<string | undefined> =>
          snapshotSourceByPath.get(path.normalize(sourcePath)) ??
          (await this.projectUsageCache.readSourceText({
            maximumBytes: 2 * 1024 * 1024,
            sourcePath,
          }));
        const preflightMessages = await collectPreviewDependencyResolutionPreflightMessages({
          readSource: readPreflightSource,
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
          await collectPreviewHostIoServerSourcePaths({
            readSource: readPreflightSource,
            sourcePaths: preparedBundleExecution.prepared.frontier.authenticSourcePaths,
            targetPath: request.documentPath,
          }),
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
      const {
        runtimeTargetMode,
        runtimeOwnershipTarget,
        localTargetModuleContract,
        runtimeTargetInferredPropsByExport,
        effectControllerTargetExportNames,
        navigationOnlyTargetExportNames,
        targetModuleContract,
        initialDragDropRequirement,
        executionRootModuleContract,
        adaptiveBuildSeed,
      } = await preparePreviewCompilerTargetContracts(
        {
          activeInspectorPlan,
          targetUsageProps,
          request,
          plannedRouteExecution,
          activePageExecutionCandidate,
          snapshotSourceByPath,
          buildSignal,
          targetSelection,
          inspectorExportName,
          inferredPropsByExport,
          collectTargetInferredProps,
          globalBridgeEvidencePolicy,
          managedDependencyEnvironment,
          projectRoot,
          preparedBundleExecution,
          activeInspectorDependencyPaths,
          analysisStaticModuleResolver,
          canonicalWorkspaceRoot,
        },
        { projectUsageCache: this.projectUsageCache },
      );
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

      const runBuild: PreviewCompilerBuildRun = (...args) =>
        executePreviewCompilerBuild(
          {
            styleContext,
            request,
            targetUsageProps,
            activeInspectorPlan,
            nextAuthAugmentationPaths,
            prismaClientTypes,
            managedDependencyEnvironment,
            snapshotSourceByPath,
            activeDependencyResolutionHints,
            projectRoot,
            dependencyProfile,
            criticalSurfaceSourcePaths,
            policy,
            runtimeTargetMode,
            runtimeOwnershipTarget,
            activePageExecutionCandidate,
            staticModuleResolver,
            localTargetModuleContract,
            runtimeTargetInferredPropsByExport,
            effectControllerTargetExportNames,
            navigationOnlyTargetExportNames,
            nextEvidence,
            canonicalWorkspaceRoot,
            targetSelection,
            documentShellEvidence,
            inspectorSourceGestureSecret,
            reactDomRootKind,
            buildState,
            appliedDependencyHintScores,
            targetModuleContract,
            preparedBundleExecution,
            initialDragDropRequirement,
            automaticRedux,
            nextPagesI18n,
            applicationStylesheetImports,
            targetExports,
            contextDiscoveryTruncated,
            inspectorExportName,
            selectedThemeImport,
            inferredPropsByExport,
            globalStyleImports,
            executionRootModuleContract,
            pageExecutionCandidates,
            requiredTailwindCompilerPackage,
            resolutionConfinement,
            normalizePreviewMetafileSourceIdentity,
            context,
            compilerGraphSummary,
            buildSignal,
            runtimeWatchInputs,
          },
          {
            typeOracle: this.typeOracle,
            projectUsageCache: this.projectUsageCache,
            adapterStrategyLearner: this.adapterStrategyLearner,
            incrementalBuildCache: this.incrementalBuildCache,
          },
          ...args,
        );
      const runAdaptiveBuild = async (
        environment: PreviewRuntimeEnvironment,
      ): ReturnType<typeof runBuild> =>
        executePreviewCompilerAdaptiveBuild(
          {
            runBuild,
            activeDependencyResolutionHints,
            request,
            managedDependencyEnvironment,
            projectRoot,
            canonicalWorkspaceRoot,
            buildState,
            styleContext,
            globalBridgeEvidencePolicy,
            adaptiveBuildSeed,
            routerNeed,
            createStorybookFallbackBoundary,
            buildSignal,
          },
          {
            adaptiveBuildPlanCache: this.adaptiveBuildPlanCache,
            projectUsageCache: this.projectUsageCache,
          },
          environment,
        );
      const outputStrategyKey = createPreviewBuildPlanIdentity({
        dependencyResolutionHints: createPreviewDependencyResolutionHintIdentity(
          activeDependencyResolutionHints,
        ),
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
        const failedFallbackBoundary = buildState.activeStorybookFallbackBoundary;
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
          ...styleContext.applicationStyleDependencyPaths,
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
      assertPreviewWatchedPaths(resolutionConfinement, browserBundle.dependencies);
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
        appliedHints: activeDependencyResolutionHints,
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
  /** Starts idempotent cancellation and resource cleanup without blocking host disposal. */
  dispose(): void {
    void this.shutdown();
  }
  /** Cancels active builds and awaits compiler-owned contexts, caches, and managed resources. */
  shutdown(): Promise<void> {
    if (this.shutdownPromise !== undefined) return this.shutdownPromise;
    this.disposed = true;
    return (this.shutdownPromise = shutdownPreviewCompiler({
      activeBuildControllers: this.activeBuildControllers,
      caches: [
        { clear: clearPreviewAnalysisSourceFileCache },
        this.adaptiveBuildPlanCache,
        this.diagnosticEmissionCache,
        this.implicitGlobalEvidenceCache,
        this.projectUsageCache,
        this.setupFailureCache,
        this.typeOracle,
        this.vendorModuleBuilder,
        this.routeInventory,
      ],
      incrementalBuildCache: this.incrementalBuildCache,
      managedDependencyStore: this.managedDependencyStore,
    }));
  }
}
