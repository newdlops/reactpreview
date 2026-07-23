/** Implements in-memory preview compilation; no project script or application server is started. */
import { randomBytes } from 'node:crypto';
import path from 'node:path';
import { stop, type BuildResult } from 'esbuild';
import type { PreviewCompiler } from '../../application/previewCompiler';
import {
  PreviewCompilationError,
  type PreviewBuildRequest,
  type PreviewBundle,
  type PreviewDiagnostic,
} from '../../domain/preview';
import {
  isPreviewBuildCancellation,
  throwIfPreviewBuildCancelled,
  type PreviewBuildExecutionContext,
} from '../../domain/previewBuildExecution';
import { canonicalizeExistingPath } from '../../shared/pathIdentity';
import {
  EMPTY_MANAGED_ENVIRONMENT,
  PreviewManagedDependencyStore,
  type PreviewManagedDependencyEnvironment,
} from '../node/previewManagedDependencyStore';
import { findPreviewDependencySpecifier } from '../node/previewDependencyProfile';
import { createPreviewEntry } from './createPreviewEntry';
import { createPreviewInspectorRootPlugin, createPreviewInspectorTargetPlugin } from './inspector';
import { createPreviewInspectorCorridorPlugin } from './inspector/previewInspectorCorridorPlugin';
import { createInspectorSourceGestureSecret } from './previewInspectorSourceGestureSecret';
import { createPreviewInspectorRuntimePlugin } from './pageInspector';
import {
  createPreviewGlobalPackageBridgeEvidencePolicy,
  createPreviewGlobalPackageBridgePlugin,
  discoverPreviewGlobalPackageBridges,
  type PreviewGlobalPackageBridgePlan,
} from './globalPackageBridge';
import { createPreviewApolloBridgePlugin } from './previewApolloBridgePlugin';
import { prepareAutomaticPreviewSetupFallback } from './previewAutomaticSetupFallback';
import { forwardPreviewAbort } from './previewAbortForwarding';
import { PreviewAdaptiveBuildPlanCache } from './previewAdaptiveBuildPlanCache';
import { createPreviewAssetPlugin } from './previewAssetPlugin';
import { createPreviewBuildPlanIdentity } from './previewBuildPlanIdentity';
import {
  collectPreviewBuildDependencies,
  convertMessage,
  createPreviewBundle,
  describeUnknownError,
  isBuildFailure,
  PREVIEW_OUTPUT_DIRECTORY_NAME,
  restorePrivateNamespaces,
  VIRTUAL_ENTRY_NAME,
} from './previewBuildResult';
import { createPreviewContextBridgePlugin } from './previewContextBridgePlugin';
import { resolvePreviewContextCoverage } from './previewContextCoverage';
import {
  EMPTY_RUNTIME_WATCH_INPUTS,
  createImplicitGlobalEvidenceCacheKey,
  createPreviewDocumentName,
  describeGlobalPackageBridgeStatus,
  haveEquivalentGlobalPackageBridges,
  haveEquivalentRouterSelections,
  mergePreviewWatchDirectories,
  requirePreviewSassBoundary,
  selectPreviewInitialRouterBuild,
  type PreviewRouterBuildSelection,
} from './previewCompilerDefaults';
import { PreviewDiagnosticEmissionCache } from './previewDiagnosticEmissionCache';
import { preparePreviewImplicitGlobalEvidence } from './previewFastImplicitGlobalEvidence';
import type { EsbuildPreviewCompilerOptions } from './previewCompilerOptions';
import { createPreviewFormikBridgePlugin } from './previewFormikBridgePlugin';
import { createPreviewMissingSourceFallbackPlugin } from './previewMissingSourceFallbackPlugin';
import {
  createPreviewLegacyCommonJsGlobalDefines,
  discoverPreviewLegacyCommonJsGlobals,
} from './previewLegacyCommonJsGlobalDiscovery';
import { createPreviewManagedDependencyPeerPlugin } from './previewManagedDependencyPeerPlugin';
import { createPreviewMdxFallbackPlugin } from './previewMdxFallbackPlugin';
import {
  tryAcquirePreviewMissingDependencies,
  type PreviewMissingDependencyAcquisitionContext,
} from './previewMissingDependencyRequirements';
import { createPreviewNodeBuiltinPlugin } from './previewNodeBuiltinPlugin';
import { createPreviewParentSlicePlugin } from './previewParentSlicePlugin';
import { createPreviewPnpPeerDependencyPlugin } from './previewPnpPeerDependencyPlugin';
import { createPreviewImportMetaEnvironment } from './previewPublicEnvironment';
import { preparePreviewCompilerTarget } from './previewImperativeEntryTarget';
import { preparePreviewCompilerUsage } from './preparePreviewCompilerUsage';
import {
  mergePreviewPortalHostIds,
  refinePreviewPortalHostsFromBuild,
} from './previewPortalHostBuildRefinement';
import { selectPreviewReactDomRootKind } from './previewReactDomRootRuntimeSource';
import { createPreviewReduxBridgePlugin } from './previewReduxBridgePlugin';
import { createPreviewRouterBridgePlugin } from './previewRouterBridgePlugin';
import { collectPreviewRouterRequirement } from './previewRouterRequirement';
import { PREVIEW_SOURCE_LOADERS } from './previewLoaderPolicy';
import { collectPreviewNextRuntimeEvidence as findNext } from './previewNextRuntimeEvidence';
import { findPreviewProjectRoot } from './previewProjectRoot';
import { PreviewProjectUsageCache } from './previewProjectUsageCache';
import { PreviewImplicitGlobalEvidenceCache } from './previewImplicitGlobalEvidenceCache';
import {
  PreviewIncrementalBuildCache,
  type PreviewIncrementalBuildOptions,
} from './previewIncrementalBuildCache';
import { PreviewOutputStrategyCache } from './previewOutputStrategyCache';
import { preparePreviewStyleContext } from './preparePreviewStyleContext';
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
  createCoalescedOutputDiagnostic,
  normalizeMaximumSplitOutputFiles,
} from './previewSplitOutputPolicy';
import { createPreviewStaticModuleResolver } from './previewStaticModuleResolver';
import { PreviewSetupFallbackBoundary } from './previewSetupFallbackBoundary';
import { PreviewSetupFailureCache } from './previewSetupFailureCache';
import { createPreviewTargetBridgePlugin } from './previewTargetBridgePlugin';
import { assertPreviewReactTarget } from './previewTargetRuntimeGuard';
import { createPreviewTailwindPlugin } from './previewTailwindPlugin';
import { selectPreviewThemeImport } from './previewTargetExports';
import { createPreviewThemeBridgePlugin } from './previewThemeBridgePlugin';
import { createPreviewThemeCandidatePlugin } from './previewThemeCandidatePlugin';
import { shouldEscalatePreviewAncestorSearch } from './previewWorkspaceAncestorPolicy';
import { PreviewSourceTransformer } from './staticResources/previewSourceTransformer';
import { collectReactExportPropInference } from './staticResources/reactExportPropInference';
import {
  createWorkspaceSourcePlugin,
  type MutableWorkspaceSourceState,
  type WorkspaceSourceCompilationState,
} from './workspaceSourcePlugin';
export type { EsbuildPreviewCompilerOptions } from './previewCompilerOptions';
/**
 * Coordinates bounded source analysis, runtime facades, native esbuild contexts, and dependency
 * recovery while keeping every generated preview browser-safe and isolated from project scripts.
 */
export class EsbuildPreviewCompiler implements PreviewCompiler {
  /** Compiler-owned signals let shutdown cancel analysis that has not reached esbuild yet. */
  private readonly activeBuildControllers = new Set<AbortController>();
  private readonly adaptiveBuildPlanCache = new PreviewAdaptiveBuildPlanCache();
  private disposed = false;
  private readonly implicitGlobalEvidenceCache = new PreviewImplicitGlobalEvidenceCache();
  private readonly projectUsageCache = new PreviewProjectUsageCache();
  private readonly incrementalBuildCache = new PreviewIncrementalBuildCache();
  private readonly diagnosticEmissionCache = new PreviewDiagnosticEmissionCache();
  private readonly outputStrategyCache = new PreviewOutputStrategyCache();
  private readonly setupFailureCache = new PreviewSetupFailureCache();
  private readonly inspectorGestureSeed = randomBytes(32);
  private readonly managedDependencyStore: PreviewManagedDependencyStore | undefined;
  private readonly maximumSplitOutputFiles: number;
  private shutdownPromise: Promise<void> | undefined;
  /** Creates a production compiler or a lower-threshold deterministic test instance. */
  public constructor(options: EsbuildPreviewCompilerOptions = {}) {
    this.maximumSplitOutputFiles = normalizeMaximumSplitOutputFiles(
      options.maximumSplitOutputFiles,
    );
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
   * Bundles the editor snapshot, graph, CSS, and small assets into browser-safe in-memory output.
   * @param request Active editor snapshot and workspace module-resolution context.
   * @param context Optional progress observer and cancellation signal for the owning revision.
   * @throws PreviewCompilationError when esbuild cannot parse or bundle the graph.
   */
  public async compile(
    request: PreviewBuildRequest,
    context?: PreviewBuildExecutionContext,
    dependencyAcquisitionAttempted = false,
  ): Promise<PreviewBundle> {
    if (this.disposed) {
      throw new PreviewCompilationError('The React preview compiler is already closed.', []);
    }
    const buildController = new AbortController();
    const detachCallerAbort = forwardPreviewAbort(context?.signal, buildController);
    this.activeBuildControllers.add(buildController);
    const buildSignal = buildController.signal;
    let acquisitionContext: PreviewMissingDependencyAcquisitionContext | undefined;
    try {
      throwIfPreviewBuildCancelled(buildSignal);
      const canonicalWorkspaceRoot = canonicalizeExistingPath(request.workspaceRoot);
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
      acquisitionContext = {
        environment: managedDependencyEnvironment,
        projectRoot,
        reportAcquisition: () => context?.reportProgress?.('acquiring-dependencies'),
        workspaceRoot: canonicalWorkspaceRoot,
      };
      const staticModuleResolver = createPreviewStaticModuleResolver({
        ...(request.tsconfigPath === undefined
          ? {}
          : { configuredTsconfigPath: request.tsconfigPath }),
        fallbackNodeModulesPaths: managedDependencyEnvironment.nodeModulesPaths,
        workspaceRoot: canonicalWorkspaceRoot,
      });
      assertPreviewReactTarget(request, dependencyProfile, staticModuleResolver);
      const targetSelection = preparePreviewCompilerTarget(request);
      const routerNeed = collectPreviewRouterRequirement(request.documentPath, request.sourceText);
      const targetExports = targetSelection.targetExports;
      const inferredPropsByExport = collectReactExportPropInference(
        request.documentPath,
        request.sourceText,
      );
      const inspectorExportName = targetSelection.inspectorExportName;
      const themeImport = selectPreviewThemeImport(request.sourceText);
      const useFastPreparation = request.preparationMode === 'fast';
      context?.reportProgress?.('discovering-components');
      const [runtimeEnvironment, runtimeWatchInputs] = await Promise.all([
        resolvePreviewRuntimeEnvironment({
          ...(request.setupModulePath === undefined
            ? {}
            : { configuredSetupPath: request.setupModulePath }),
          projectRoot,
          useStorybookPreview: !useFastPreparation && (request.useStorybookPreview ?? true),
          workspaceRoot: canonicalWorkspaceRoot,
        }),
        useFastPreparation
          ? Promise.resolve(EMPTY_RUNTIME_WATCH_INPUTS)
          : createPreviewRuntimeWatchInputs(projectRoot, canonicalWorkspaceRoot),
      ]);
      const { fastContextTruncated, packageTargetUsageProps, implicitGlobalSourcePaths } =
        await preparePreviewCompilerUsage({
          cache: this.projectUsageCache,
          projectRoot,
          projectUsesNextRuntime: nextEvidence.routeContext,
          request,
          resolver: staticModuleResolver,
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
        !useFastPreparation &&
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
          signal: buildSignal,
          snapshots: request.dependencySnapshots,
          sourceText: targetSelection.sourceText,
          ...(request.tsconfigPath === undefined ? {} : { tsconfigPath: request.tsconfigPath }),
          workspaceRoot: canonicalWorkspaceRoot,
        });
      }
      throwIfPreviewBuildCancelled(buildSignal);
      context?.reportProgress?.('preparing-runtime');
      const reactDomRootKind = selectPreviewReactDomRootKind(
        staticModuleResolver,
        request.documentPath,
      );
      const preparedSetupFallback = await prepareAutomaticPreviewSetupFallback({
        cache: this.setupFailureCache,
        dependencySnapshots: request.dependencySnapshots,
        documentName: createPreviewDocumentName(request),
        projectRoot,
        runtimeEnvironment,
        runtimeWatchInputs,
        signal: buildSignal,
        staticModuleResolver,
        workspaceRoot: canonicalWorkspaceRoot,
      });
      const primaryRenderPath =
        targetUsageProps.inspectorPlan?.renderChain.paths[0] ??
        (inspectorExportName === undefined
          ? undefined
          : targetUsageProps.renderChainsByExport?.[inspectorExportName]?.paths[0]);
      const styleContext = await preparePreviewStyleContext({
        ...(themeImport === undefined ? {} : { directThemeImport: themeImport }),
        inspectorDependencyPaths: targetUsageProps.inspectorPlan?.dependencyPaths ?? [],
        portalHostDependencyPaths: targetUsageProps.dependencyPaths,
        projectRoot,
        readSource: (options) => this.projectUsageCache.readSourceText(options),
        ...(primaryRenderPath === undefined ? {} : { renderPath: primaryRenderPath }),
        request,
        staticModuleResolver,
        workspaceRoot: canonicalWorkspaceRoot,
      });
      const {
        documentShellEvidence,
        globalStyleImports,
        snapshotSourceByPath,
        themeImport: selectedThemeImport,
      } = styleContext;
      let legacyCommonJsGlobalNames: readonly string[] = [];
      let portalHostIds = styleContext.portalHostIds;
      const implicitGlobalEvidence = await preparePreviewImplicitGlobalEvidence({
        cache: this.implicitGlobalEvidenceCache,
        cacheKey: createImplicitGlobalEvidenceCacheKey(projectRoot, request.tsconfigPath),
        fallbackSourcePaths: implicitGlobalSourcePaths,
        fast: useFastPreparation,
        inspectorDependencyPaths: targetUsageProps.dependencyPaths,
        pageInspector: request.renderMode === 'page-inspector',
        prioritizedSourcePath: primaryRenderPath?.entryPoint?.sourcePath,
        readSource: (sourcePath) => snapshotSourceByPath.get(path.normalize(sourcePath)),
        resolveModule: staticModuleResolver.resolve,
        runtimeDependencyPaths: runtimeWatchInputs.dependencyPaths,
        signal: buildSignal,
        snapshotSourceByPath,
      });
      throwIfPreviewBuildCancelled(buildSignal);
      const globalBridgeEvidencePolicy =
        createPreviewGlobalPackageBridgeEvidencePolicy(implicitGlobalEvidence);
      /** Creates one trace boundary per build because its resolver inventory is stateful. */
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
      /** Executes one isolated build so a broken automatic Storybook setup cannot consume retry state. */
      const runBuild = async (
        environment: PreviewRuntimeEnvironment,
        routerSelection: PreviewRouterBuildSelection,
        globalPackagePlan: PreviewGlobalPackageBridgePlan,
        splitOutputs: boolean,
        fallbackBoundary?: PreviewSetupFallbackBoundary,
      ): Promise<{
        readonly globalPackagePlan: PreviewGlobalPackageBridgePlan;
        readonly referencedGlobalNames: readonly string[];
        readonly result: BuildResult<{ metafile: true; write: false }>;
        readonly routerRequirement: ReturnType<PreviewSourceTransformer['getRouterRequirement']>;
        readonly styleDependencyPaths: readonly string[];
        readonly watchDirectories: readonly string[];
      }> => {
        const inspectorPlan =
          request.renderMode === 'page-inspector' ? targetUsageProps.inspectorPlan : undefined;
        const activeParentSlices =
          request.renderMode !== 'page-inspector' && environment.setupKind === 'none'
            ? targetUsageProps.parentSlicesByExport
            : {};
        const sourceTransformer = new PreviewSourceTransformer({
          deferDormantOverlayImports: useFastPreparation,
          documentPath: canonicalizeExistingPath(request.documentPath),
          fastPreparation: useFastPreparation,
          implicitPackageGlobalCandidateNames: globalPackagePlan.fallbackCandidateNames,
          implicitPackageGlobalResolver: staticModuleResolver,
          instrumentDataRequests: request.renderMode === 'page-inspector',
          instrumentGraphqlDocuments: request.renderMode === 'page-inspector',
          instrumentRenderConditions: request.renderMode === 'page-inspector',
          instrumentRuntimeEffectIsolation: request.renderMode === 'page-inspector',
          instrumentRuntimeHookFallbacks: request.renderMode === 'page-inspector',
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
        let styleDependencyPaths: readonly string[] = [];
        let styleWatchDirectories: readonly string[] = [];
        /** Creates static options around either fixed or incrementally replaceable source state. */
        const createBuildOptions = (
          incrementalState: MutableWorkspaceSourceState | undefined,
          sassBoundary: PreviewSassBoundary,
        ): PreviewIncrementalBuildOptions => {
          const transformer = incrementalState?.transformer ?? sourceTransformer;
          return {
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
            entryNames: 'entry',
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
              ...(inspectorPlan === undefined
                ? []
                : [
                    createPreviewInspectorTargetPlugin({
                      ...(targetUsageProps.inspectorTargetImportSpecifiers === undefined
                        ? {}
                        : {
                            acceptedTargetImportSpecifiers:
                              targetUsageProps.inspectorTargetImportSpecifiers,
                          }),
                      documentPath: inspectorPlan.target.sourcePath,
                      exportNames: Object.keys(inspectorPlan.renderChainsByExport),
                      ...(inspectorPlan.contextModule === undefined
                        ? { inferredPropsByExport }
                        : {}),
                      originalHasDefaultExport: Object.keys(
                        inspectorPlan.renderChainsByExport,
                      ).includes('default'),
                    }),
                    createPreviewInspectorCorridorPlugin({
                      ...(useFastPreparation ? { maximumSmallDynamicImports: 8 } : {}),
                      plan: inspectorPlan,
                      projectRoot,
                      resolveModule: staticModuleResolver.resolve,
                      workspaceRoot: canonicalWorkspaceRoot,
                    }),
                  ]),
              createPreviewMissingSourceFallbackPlugin({
                fastPreparation: useFastPreparation,
                readSource: (sourcePath) => snapshotSourceByPath.get(path.normalize(sourcePath)),
                registerWatchDirectory: transformer.registerWatchDirectory.bind(transformer),
                staticModuleResolver,
                workspaceRoot: canonicalWorkspaceRoot,
              }),
              createPreviewGlobalPackageBridgePlugin({ plan: globalPackagePlan }),
              ...(inspectorPlan === undefined
                ? []
                : [createPreviewInspectorRuntimePlugin({ projectRoot })]),
              createPreviewApolloBridgePlugin({ projectRoot }),
              createPreviewContextBridgePlugin({ projectRoot }),
              createPreviewFormikBridgePlugin({ projectRoot }),
              createPreviewReduxBridgePlugin({ projectRoot }),
              createPreviewRouterBridgePlugin({
                automaticallyWrap: routerSelection.automaticallyWrap,
                enabled: routerSelection.enabled,
                nextAppEnabled:
                  inspectorPlan?.pageCandidates.some(
                    (candidate) => candidate.routeLocation?.evidenceKind === 'next-app-filesystem',
                  ) === true,
                projectRoot,
              }),
              createPreviewThemeBridgePlugin({ projectRoot }),
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
                      documentPath: request.documentPath,
                      exports: targetExports,
                      parentSlicesByExport: activeParentSlices,
                      ...(selectedThemeImport === undefined
                        ? {}
                        : { themeImport: selectedThemeImport }),
                      inferredPropsByExport,
                      usagePropsByExport: targetUsageProps.propsByExport,
                    }),
                  ]
                : [
                    createPreviewInspectorRootPlugin({
                      displayName: path.basename(request.documentPath),
                      globalStyleImports,
                      ...(useFastPreparation ? { maximumPageCandidates: 1 } : {}),
                      plan: inspectorPlan,
                      ...(selectedThemeImport === undefined
                        ? {}
                        : { themeImport: selectedThemeImport }),
                      ...(inspectorPlan.contextModule !== undefined ||
                      inferredPropsByExport[inspectorPlan.target.exportName] === undefined
                        ? {}
                        : {
                            targetInference: inferredPropsByExport[inspectorPlan.target.exportName],
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
                boundedSourceDiscovery:
                  useFastPreparation &&
                  (packageHasFrameworkPageContext || packageHasEntryConnectedPage),
                projectRoot,
                readSourceSnapshots: () =>
                  incrementalState?.snapshots ?? sourceCompilation.snapshots,
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
            splitting: splitOutputs && !useFastPreparation,
            stdin: {
              contents: createPreviewEntry({
                documentName: createPreviewDocumentName(request),
                ...(documentShellEvidence === undefined
                  ? {}
                  : { documentShell: documentShellEvidence.shell }),
                globalNamespaces: environment.globalNamespaces,
                globalPackageBridgeStatus: describeGlobalPackageBridgeStatus(globalPackagePlan),
                publicEnvironment: environment.publicEnvironment,
                ...(inspectorSourceGestureSecret === undefined
                  ? {}
                  : { inspectorSourceGestureSecret }),
                reactDomRootKind,
                renderMode: request.renderMode ?? 'component',
                portalHostIds,
                setupKind: environment.setupKind,
              }),
              loader: 'tsx',
              resolveDir: path.dirname(request.documentPath),
              sourcefile: path.join(request.workspaceRoot, VIRTUAL_ENTRY_NAME),
            },
            target: 'es2022',
            treeShaking: true,
            ...(request.tsconfigPath === undefined ? {} : { tsconfig: request.tsconfigPath }),
            write: false,
          };
        };
        const buildPlanIdentity = createPreviewBuildPlanIdentity({
          documentPath: request.documentPath,
          documentShell: { evidence: documentShellEvidence?.shell, portalHostIds },
          environment,
          globalPackagePlan,
          globalStyleImports,
          inferredPropsByExport,
          inspectorPlan,
          legacyCommonJsGlobalNames,
          managedDependencyEnvironment: managedDependencyEnvironment.identity,
          parentSlices: activeParentSlices,
          preparationMode: request.preparationMode,
          projectRoot,
          reactDomRootKind,
          renderMode: request.renderMode,
          routerSelection,
          splitOutputs,
          targetExports,
          targetUsageProps,
          themeImport: selectedThemeImport,
          tsconfigPath: request.tsconfigPath,
          workspaceRoot: canonicalWorkspaceRoot,
        });
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
                sassOptions,
                signal: buildSignal,
                sourceCompilation,
              })
            : await this.incrementalBuildCache.buildOnce(
                createBuildOptions(undefined, requirePreviewSassBoundary(oneShotSassBoundary)),
                buildSignal,
              );
        if (oneShotSassBoundary !== undefined) {
          styleDependencyPaths = oneShotSassBoundary.getDependencyPaths();
          styleWatchDirectories = oneShotSassBoundary.getWatchDirectories();
        }
        throwIfPreviewBuildCancelled(buildSignal);
        return {
          globalPackagePlan,
          referencedGlobalNames: sourceTransformer.getReferencedImplicitPackageGlobalNames(),
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
      /** Rebuilds once after reached syntax proves router hooks or exact package-global references. */
      const runAdaptiveBuild = async (
        environment: PreviewRuntimeEnvironment,
        splitOutputs: boolean,
      ): ReturnType<typeof runBuild> => {
        const adaptivePlanKey = createPreviewBuildPlanIdentity({
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
          projectRoot,
          referencedGlobalNames: cachedPlan?.referencedGlobalNames ?? [],
          workspaceRoot: canonicalWorkspaceRoot,
        });
        const initialRouterSelection: PreviewRouterBuildSelection = selectPreviewInitialRouterBuild(
          cachedPlan?.routerRequirement,
          routerNeed,
        );
        let fallbackBoundary = createStorybookFallbackBoundary(environment);
        activeStorybookFallbackBoundary = fallbackBoundary;
        const initialBuild = await runBuild(
          environment,
          initialRouterSelection,
          initialGlobalPackagePlan,
          splitOutputs,
          fallbackBoundary,
        );
        const exactGlobalPackagePlan = await discoverPreviewGlobalPackageBridges({
          ...globalBridgeEvidencePolicy,
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
            splitOutputs,
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
        throwIfPreviewBuildCancelled(buildSignal);
        if (portalRefinement.changed || legacyCommonJsRefinement.changed) {
          fallbackBoundary = createStorybookFallbackBoundary(environment);
          activeStorybookFallbackBoundary = fallbackBoundary;
          finalBuild = await runBuild(
            environment,
            exactRouterSelection,
            exactGlobalPackagePlan,
            splitOutputs,
            fallbackBoundary,
          );
        }
        this.adaptiveBuildPlanCache.write(adaptivePlanKey, {
          legacyCommonJsGlobalNames,
          portalHostIds,
          referencedGlobalNames: finalBuild.referencedGlobalNames,
          routerRequirement: finalBuild.routerRequirement,
        });
        return finalBuild;
      };
      const outputStrategyKey = createPreviewBuildPlanIdentity({
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
      let splitOutputs = this.outputStrategyCache.shouldSplit();
      let discoveredSplitOutputCount: number | undefined;
      let activeRuntimeEnvironment =
        cachedSetupFailure === undefined
          ? runtimeEnvironment
          : { ...runtimeEnvironment, setupKind: 'none' as const, setupModulePath: undefined };
      let buildExecution: Awaited<ReturnType<typeof runBuild>> | undefined;
      let fallbackDependencies = cachedSetupFailure?.dependencyPaths ?? [];
      let fallbackWatchDirectories = cachedSetupFailure?.watchDirectories ?? [];
      let fallbackDiagnostics: readonly PreviewDiagnostic[] = preparedSetupFallback.diagnostics;
      throwIfPreviewBuildCancelled(buildSignal);
      context?.reportProgress?.('bundling-modules');
      try {
        buildExecution = await runAdaptiveBuild(activeRuntimeEnvironment, splitOutputs);
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
        buildExecution = await runAdaptiveBuild(activeRuntimeEnvironment, splitOutputs);
      }
      const splitOutputCount = buildExecution.result.outputFiles.length;
      if (splitOutputs && splitOutputCount > this.maximumSplitOutputFiles) {
        this.outputStrategyCache.write(outputStrategyKey, splitOutputCount);
        discoveredSplitOutputCount = splitOutputCount;
        splitOutputs = false;
        buildExecution = undefined;
        throwIfPreviewBuildCancelled(buildSignal);
        buildExecution = await runAdaptiveBuild(activeRuntimeEnvironment, false);
      }
      buildExecution = {
        ...buildExecution,
        watchDirectories: mergePreviewWatchDirectories(
          buildExecution.watchDirectories,
          fallbackWatchDirectories,
        ),
      };
      const outputStrategyDiagnostics: readonly PreviewDiagnostic[] =
        discoveredSplitOutputCount === undefined
          ? []
          : [
              createCoalescedOutputDiagnostic(
                discoveredSplitOutputCount,
                buildExecution.result.outputFiles.length,
                createPreviewDocumentName(request),
              ),
            ];
      const inspectorFallbackDiagnostics: readonly PreviewDiagnostic[] =
        request.renderMode === 'page-inspector' &&
        !useFastPreparation &&
        targetUsageProps.inspectorPlan === undefined &&
        this.diagnosticEmissionCache.admit(`inspector-fallback:${outputStrategyKey}`)
          ? [
              {
                message: `Page Inspector could not prove an exported ancestor for ${createPreviewDocumentName(request)}. The direct export fallback remains interactive, but parent and sibling context is unavailable. Open a direct default/PascalCase component export or configure a preview harness if this file only re-exports unknown wildcard values.`,
                severity: 'warning',
              },
            ]
          : [];
      throwIfPreviewBuildCancelled(buildSignal);
      const previewBundle = await createPreviewBundle(
        request,
        buildExecution.result,
        buildExecution.watchDirectories,
        [...fallbackDiagnostics, ...outputStrategyDiagnostics, ...inspectorFallbackDiagnostics],
        [
          ...buildExecution.globalPackagePlan.dependencyPaths,
          ...(managedDependencyEnvironment.profile?.dependencyPaths ?? []),
          ...runtimeWatchInputs.dependencyPaths,
          ...fallbackDependencies,
          ...buildExecution.styleDependencyPaths,
          ...(documentShellEvidence === undefined ? [] : [documentShellEvidence.dependencyPath]),
          ...globalStyleImports.map((globalStyleImport) =>
            path.normalize(globalStyleImport.moduleSpecifier),
          ),
          ...targetUsageProps.dependencyPaths,
        ],
        this.diagnosticEmissionCache.admitBuildWarning.bind(this.diagnosticEmissionCache),
        resolvePreviewContextCoverage({
          fastContextTruncated,
          implicitGlobalEvidence,
          request,
          inspectorPlan: targetUsageProps.inspectorPlan,
          maximumPublishedPageCandidates: useFastPreparation ? 1 : undefined,
        }),
      );
      this.managedDependencyStore?.scheduleAdmission({
        dependencyPaths: collectPreviewBuildDependencies(request, buildExecution.result.metafile),
        profile: managedDependencyEnvironment.profile,
        workspaceRoot: canonicalWorkspaceRoot,
      });
      const externallyWatchableBundle =
        this.managedDependencyStore === undefined
          ? previewBundle
          : {
              ...previewBundle,
              dependencies: previewBundle.dependencies.filter(
                (dependencyPath) => !this.managedDependencyStore?.ownsPath(dependencyPath),
              ),
            };
      throwIfPreviewBuildCancelled(buildSignal);
      return inspectorSourceGestureSecret === undefined
        ? externallyWatchableBundle
        : { ...externallyWatchableBundle, inspectorSourceGestureSecret };
    } catch (error) {
      if (isPreviewBuildCancellation(error, buildSignal)) {
        throw error;
      }
      if (!dependencyAcquisitionAttempted && isBuildFailure(error)) {
        if (
          await tryAcquirePreviewMissingDependencies({
            context: acquisitionContext,
            errors: error.errors,
            signal: buildSignal,
            store: this.managedDependencyStore,
          })
        ) {
          return await this.compile(request, context, true);
        }
      }
      if (error instanceof PreviewCompilationError) {
        throw error;
      }
      const diagnostics = isBuildFailure(error)
        ? error.errors.map((message) => convertMessage(message, 'error'))
        : [{ message: describeUnknownError(error), severity: 'error' as const }];
      const firstDiagnostic = diagnostics[0];
      const summary = firstDiagnostic?.message ?? 'The React module could not be bundled.';
      throw new PreviewCompilationError(`Preview build failed: ${summary}`, diagnostics, error);
    } finally {
      detachCallerAbort();
      this.activeBuildControllers.delete(buildController);
    }
  }
  /**
   * Prevents new builds and stops esbuild's shared native service during extension deactivation.
   * Any in-flight build rejects and is discarded by the controller's revision guard.
   */
  public dispose(): void {
    void this.shutdown();
  }
  /**
   * Stops esbuild's native service and exposes a promise for orderly extension deactivation.
   * Repeated calls return one promise so explicit shutdown and context disposal remain idempotent.
   * @returns Promise resolved after esbuild confirms that its shared service has stopped.
   */
  public shutdown(): Promise<void> {
    if (this.shutdownPromise !== undefined) return this.shutdownPromise;
    this.disposed = true;
    for (const controller of this.activeBuildControllers) controller.abort();
    this.adaptiveBuildPlanCache.clear();
    this.diagnosticEmissionCache.clear();
    this.implicitGlobalEvidenceCache.clear();
    this.outputStrategyCache.clear();
    this.projectUsageCache.clear();
    this.setupFailureCache.clear();
    this.shutdownPromise = this.incrementalBuildCache.shutdown().then(async () => {
      await this.managedDependencyStore?.shutdown();
      await stop();
    });
    return this.shutdownPromise;
  }
}
