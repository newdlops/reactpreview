/* eslint-disable jsdoc/require-jsdoc */
import { randomBytes } from 'node:crypto';
import path from 'node:path';
import ts from 'typescript';
import type { PreviewCompiler } from '../../application/previewCompiler';
import {
  PreviewCompilationError,
  type PreviewBuildRequest,
  type PreviewBundle,
  type PreviewDiagnostic,
} from '../../domain/preview';
// prettier-ignore
import { throwIfPreviewBuildCancelled, type PreviewBuildExecutionContext } from '../../domain/previewBuildExecution';
import { canonicalizeExistingPath } from '../../shared/pathIdentity';
import {
  EMPTY_MANAGED_ENVIRONMENT,
  PreviewManagedDependencyStore,
  type PreviewManagedDependencyEnvironment,
} from '../node/previewManagedDependencyStore';
import { findPreviewDependencySpecifier } from '../node/previewDependencyProfile';
import { createPreviewEntry } from './createPreviewEntry';
// prettier-ignore
import { createEligiblePreviewInspectorPageExecutionCandidates, createPreviewInspectorExecutablePlan, createPreviewInspectorPageExecutionBuildPlugin, createPreviewInspectorRootPlugin, createPreviewInspectorTargetPlugin } from './inspector';
import { createPreviewInspectorCorridorPlugin } from './inspector/previewInspectorCorridorPlugin';
import { preparePreviewInspectorBundleExecution } from './preparePreviewInspectorBundleExecution';
import { createInspectorSourceGestureSecret } from './previewInspectorSourceGestureSecret';
import { createPreviewInspectorRuntimePlugin } from './pageInspector';
// prettier-ignore
import { createPreviewGlobalPackageBridgeEvidencePolicy, createPreviewGlobalPackageBridgePlugin, discoverPreviewGlobalPackageBridges, type PreviewGlobalPackageBridgePlan } from './globalPackageBridge';
import { createPreviewApolloBridgePlugin } from './previewApolloBridgePlugin';
import { prepareAutomaticPreviewSetupFallback } from './previewAutomaticSetupFallback';
import { forwardPreviewAbort } from './previewAbortForwarding';
import { PreviewAdaptiveBuildPlanCache } from './previewAdaptiveBuildPlanCache';
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
import { EMPTY_RUNTIME_WATCH_INPUTS, createImplicitGlobalEvidenceCacheKey, createPreviewDocumentName, describeGlobalPackageBridgeStatus, haveEquivalentGlobalPackageBridges, haveEquivalentRouterSelections, mergePreviewWatchDirectories, requirePreviewSassBoundary, selectPreviewInitialRouterBuild, type PreviewRouterBuildSelection } from './previewCompilerDefaults';
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
import { createPreviewPreparationPolicy } from './previewPreparationPolicy';
import { createPreviewInspectorFallbackDiagnostics } from './previewInspectorFallbackDiagnostic';
import {
  mergePreviewPortalHostIds,
  refinePreviewPortalHostsFromBuild,
} from './previewPortalHostBuildRefinement';
import { selectPreviewReactDomRootKind } from './previewReactDomRootRuntimeSource';
import { createPreviewReduxBridgePlugin } from './previewReduxBridgePlugin';
import { createPreviewRouterBridgePlugin } from './previewRouterBridgePlugin';
import { createPreviewRuntimeInstanceKey } from './previewRuntimeInstanceKey';
import { collectPreviewRouterRequirement } from './previewRouterRequirement';
import { PREVIEW_SOURCE_LOADERS } from './previewLoaderPolicy';
import { collectPreviewNextRuntimeEvidence as findNext } from './previewNextRuntimeEvidence';
import { findPreviewProjectRoot } from './previewProjectRoot';
import { PreviewProjectUsageCache } from './previewProjectUsageCache';
import { PreviewImplicitGlobalEvidenceCache } from './previewImplicitGlobalEvidenceCache';
import { collectPreviewInspectorRuntimeCompanionPaths } from './previewImplicitGlobalRuntimeCompanions';
import {
  PreviewIncrementalBuildCache,
  type PreviewIncrementalBuildOptions,
} from './previewIncrementalBuildCache';
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
  private readonly setupFailureCache = new PreviewSetupFailureCache();
  private readonly inspectorGestureSeed = randomBytes(32);
  private readonly managedDependencyStore: PreviewManagedDependencyStore | undefined;
  private shutdownPromise: Promise<void> | undefined;
  public constructor(options: EsbuildPreviewCompilerOptions = {}) {
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
      context?.reportProgress?.('discovering-components');
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
        {
          resolveImport: (moduleSpecifier, importerPath) => {
            const sourcePath = staticModuleResolver.resolve(moduleSpecifier, importerPath);
            const sourceText = sourcePath === undefined ? undefined : ts.sys.readFile(sourcePath);
            return sourcePath === undefined || sourceText === undefined ? undefined : { sourcePath, sourceText };
          },
        },
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
      // prettier-ignore
      const activeInspectorPlan = targetUsageProps.inspectorPlan === undefined ? undefined : createPreviewInspectorExecutablePlan(targetUsageProps.inspectorPlan, request.inspectorPageCandidateId);
      // prettier-ignore
      const pageExecutionCandidates = activeInspectorPlan === undefined ? [] : createEligiblePreviewInspectorPageExecutionCandidates(targetUsageProps.inspectorPlan ?? activeInspectorPlan, request.inspectorPageCandidateId, request.inspectorPageExecutionCandidateId);
      let activePageExecutionCandidate = pageExecutionCandidates[0];
      // prettier-ignore
      const primaryRenderPath = activeInspectorPlan?.pageCandidates[0]?.renderPath ?? targetUsageProps.inspectorPlan?.renderChain.paths[0] ?? (inspectorExportName === undefined ? undefined : targetUsageProps.renderChainsByExport?.[inspectorExportName]?.paths[0]);
      const activeInspectorDependencyPaths = activeInspectorPlan?.dependencyPaths ?? [];
      const styleContext = await preparePreviewStyleContext({
        ...(themeImport === undefined ? {} : { directThemeImport: themeImport }),
        inspectorDependencyPaths: activeInspectorDependencyPaths,
        portalHostDependencyPaths:
          policy.discoveryScope === 'selected-corridor'
            ? activeInspectorDependencyPaths
            : targetUsageProps.dependencyPaths,
        projectRoot,
        styleEvidence: policy.styleEvidence,
        readSource: (options) => this.projectUsageCache.readSourceText(options),
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
        fast: policy.mode === 'fast',
        inspectorDependencyPaths: targetUsageProps.dependencyPaths,
        pageInspector: request.renderMode === 'page-inspector',
        prioritizedSourcePath: primaryRenderPath?.entryPoint?.sourcePath,
        readSource: (sourcePath) => snapshotSourceByPath.get(path.normalize(sourcePath)),
        resolveModule: staticModuleResolver.resolve,
        runtimeDependencyPaths: runtimeWatchInputs.dependencyPaths,
        signal: buildSignal,
        snapshotSourceByPath,
      });
      const globalBridgeEvidencePolicy =
        createPreviewGlobalPackageBridgeEvidencePolicy(implicitGlobalEvidence);
      // prettier-ignore
      const runtimeCompanionSourcePaths = collectPreviewInspectorRuntimeCompanionPaths({ globalBridgePolicy: globalBridgeEvidencePolicy, globalStyleImports, resolveModule: staticModuleResolver.resolve, ...(selectedThemeImport === undefined ? {} : { themeImport: selectedThemeImport }), themeImporterPath: request.documentPath });
      const preparedBundleExecution = await preparePreviewInspectorBundleExecution({
        analysisCandidateCount: targetUsageProps.inspectorPlan?.pageCandidates.length ?? 0,
        runtimeCompanionSourcePaths,
        corridorSourceCount: activeInspectorDependencyPaths.length,
        dependencySnapshotCount: request.dependencySnapshots.length,
        discoveryTruncated: contextDiscoveryTruncated === true,
        executablePlan: activeInspectorPlan,
        // prettier-ignore
        ...(activeInspectorPlan === undefined ? {} : { executionCandidates: pageExecutionCandidates }),
        policy,
        // prettier-ignore
        readSource: async (sourcePath) => snapshotSourceByPath.get(path.normalize(sourcePath)) ?? this.projectUsageCache.readSourceText({ maximumBytes: 1024 * 1024, sourcePath }),
        resolveModule: staticModuleResolver.resolve,
        styleSnapshotCount: styleContext.tailwindCandidateSnapshots.length,
        workspaceRoot: canonicalWorkspaceRoot,
      });
      activePageExecutionCandidate =
        preparedBundleExecution?.executionCandidate ?? activePageExecutionCandidate;
      context?.reportProgress?.('analyzing-project', {
        analysisCandidateCount: targetUsageProps.inspectorPlan?.pageCandidates.length ?? 0,
        corridorSourceCount: activeInspectorDependencyPaths.length,
        dependencySnapshotCount: request.dependencySnapshots.length,
        discoveryScope: policy.discoveryScope,
        discoveryTruncated: contextDiscoveryTruncated === true,
        executableCandidateCount: activeInspectorPlan === undefined ? 0 : 1,
        kind: 'graph-plan',
        preparationMode: policy.mode,
        styleSnapshotCount: styleContext.tailwindCandidateSnapshots.length,
      });
      if (preparedBundleExecution !== undefined) {
        context?.reportProgress?.('analyzing-project', preparedBundleExecution.activity);
        preparedBundleExecution.throwIfRejected(request.documentPath);
      }
      throwIfPreviewBuildCancelled(buildSignal);
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
          deferDormantOverlayImports: policy.deferDormantOverlayImports,
          documentPath: canonicalizeExistingPath(request.documentPath),
          selectiveDependencyPassThrough: policy.selectiveDependencyPassThrough,
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
              ...entryStrategy.plugins,
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
                      exportNames: Object.keys(
                        (inspectorAnalysisPlan ?? inspectorPlan).renderChainsByExport,
                      ),
                      inferredPropsByExport,
                      originalHasDefaultExport: Object.keys(
                        (inspectorAnalysisPlan ?? inspectorPlan).renderChainsByExport,
                      ).includes('default'),
                    }),
                    ...[
                      createPreviewInspectorPageExecutionBuildPlugin(
                        activePageExecutionCandidate,
                        (sourcePath) => snapshotSourceByPath.get(sourcePath),
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
                            packageDemandSourcePaths:
                              preparedBundleExecution.prepared.frontier.packageDemandSourcePaths,
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
                      plan: inspectorAnalysisPlan ?? inspectorPlan,
                      ...(activePageExecutionCandidate === undefined
                        ? {}
                        : { pageExecutionCandidate: activePageExecutionCandidate }),
                      ...(pageExecutionCandidates.length === 0 ? {} : { pageExecutionCandidates }),
                      ...(request.inspectorPageCandidateId === undefined
                        ? {}
                        : { selectedPageCandidateId: request.inspectorPageCandidateId }),
                      ...(selectedThemeImport === undefined
                        ? {}
                        : { themeImport: selectedThemeImport }),
                      readSource: (p) => snapshotSourceByPath.get(path.normalize(p)),
                      ...(inferredPropsByExport[inspectorPlan.target.exportName] === undefined
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
                boundedSourceDiscovery: policy.boundedTailwindSourceDiscovery,
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
            ...entryStrategy.buildOptions,
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
        buildExecution = await runAdaptiveBuild(activeRuntimeEnvironment);
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
        globalStyleDependencyPaths: globalStyleImports.map((globalStyleImport) =>
          path.normalize(globalStyleImport.moduleSpecifier),
        ),
        inspectorFallbackDiagnostics,
        ...(preparedBundleExecution === undefined
          ? { inspectorBundleFrontier: undefined }
          : {
              inspectorBundleFrontier: {
                activity: preparedBundleExecution.activity,
                authenticSourcePaths:
                  preparedBundleExecution.prepared.frontier.authenticSourcePaths,
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
        targetDependencyPaths: targetUsageProps.dependencyPaths,
      });
      this.managedDependencyStore?.scheduleAdmission({
        dependencyPaths: collectPreviewBuildDependencies(request, buildExecution.result.metafile),
        profile: managedDependencyEnvironment.profile,
        workspaceRoot: canonicalWorkspaceRoot,
      });
      throwIfPreviewBuildCancelled(buildSignal);
      return inspectorSourceGestureSecret === undefined
        ? previewBundle
        : { ...previewBundle, inspectorSourceGestureSecret };
    } catch (error) {
      return await resolvePreviewCompilerFailure({
        buildSignal,
        dependencyAcquisitionAttempted,
        error,
        retryCompilation: () => this.compile(request, context, true),
        target: request.documentPath,
        tryAcquireMissingDependencies: (errors) =>
          tryAcquirePreviewMissingDependencies({
            context: acquisitionContext,
            errors,
            signal: buildSignal,
            store: this.managedDependencyStore,
          }),
      });
    } finally {
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
      ],
      incrementalBuildCache: this.incrementalBuildCache,
      managedDependencyStore: this.managedDependencyStore,
    }));
  }
}
