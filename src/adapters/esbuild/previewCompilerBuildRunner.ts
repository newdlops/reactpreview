import { createPreviewDependencyResolutionHintIdentity } from './previewDependencyResolutionHintIdentity';
/** Builds one frozen browser graph with exact plugins, shared compiler caches, and bounded output. */
import path from 'node:path';
import { throwIfPreviewBuildCancelled } from '../../domain/previewBuildExecution';
import { canonicalizeExistingPath } from '../../shared/pathIdentity';
import { findPreviewDependencySpecifier } from '../node/previewDependencyProfile';
import { createPreviewEntry } from './createPreviewEntry';
import {
  createPreviewGlobalPackageBridgePlugin,
  type PreviewGlobalPackageBridgePlan,
} from './globalPackageBridge';
import {
  createPreviewInspectorPageExecutionBuildPlugin,
  createPreviewInspectorRootPlugin,
  createPreviewInspectorTargetModuleContract,
  createPreviewInspectorTargetPlugin,
} from './inspector';
import { createPreviewInspectorCorridorPlugin } from './inspector/previewInspectorCorridorPlugin';
import { createPreviewInspectorRuntimePlugin } from './pageInspector';
import { createPreviewApolloBridgePlugin } from './previewApolloBridgePlugin';
import { createPreviewAssetPlugin } from './previewAssetPlugin';
import { createPreviewBuildPlanIdentity } from './previewBuildPlanIdentity';
import { PREVIEW_OUTPUT_DIRECTORY_NAME, VIRTUAL_ENTRY_NAME } from './previewBuildResult';
import { type PreviewCompilerBuildExecution } from './previewCompilerBundleFinalizer';
import {
  createPreviewDocumentName,
  describeGlobalPackageBridgeStatus,
  mergePreviewWatchDirectories,
  requirePreviewSassBoundary,
  type PreviewRouterBuildSelection,
} from './previewCompilerDefaults';
import type {
  PreviewCompilerBuildInputs,
  PreviewCompilerBuildInputsServices,
} from './previewCompilerPhaseInputs';
import { createPreviewContextBridgePlugin } from './previewContextBridgePlugin';
import {
  createPreviewDependencyResolutionHintPlugin,
  PREVIEW_SERVER_CONTRACT_NEUTRAL_VALUE_EXPRESSION,
} from './previewDependencyResolutionHintPlugin';
import { createPreviewDragDropBridgePlugin } from './previewDragDropBridgePlugin';
import { createPreviewFormikBridgePlugin } from './previewFormikBridgePlugin';
import {
  type PreviewIncrementalBuildActivityReporter,
  type PreviewIncrementalBuildOptions,
} from './previewIncrementalBuildCache';
import { createPreviewInstalledPackageExternalizationPlugin } from './previewInstalledPackageExternalizationPlugin';
import { createPreviewLegacyCommonJsGlobalDefines } from './previewLegacyCommonJsGlobalDiscovery';
import { createPreviewLegacyNbindCspPlugin } from './previewLegacyNbindCspPlugin';
import { PREVIEW_SOURCE_LOADERS } from './previewLoaderPolicy';
import { PREVIEW_LAZY_STYLE_CHUNK_NAMES } from './previewLazyStyleImports';
import { createPreviewManagedDependencyPeerPlugin } from './previewManagedDependencyPeerPlugin';
import { createPreviewMdxFallbackPlugin } from './previewMdxFallbackPlugin';
import { createPreviewMissingSourceFallbackPlugin } from './previewMissingSourceFallbackPlugin';
import {
  createPreviewNextAuthSessionExpression,
  PREVIEW_NEXT_AUTH_SESSION_PATHS,
  PREVIEW_NEXT_AUTH_SESSION_TYPE_NAME,
  PREVIEW_NEXT_AUTH_SPECIFIER,
} from './previewNextAuthSession';
import { createPreviewNextAuthSessionPlugin } from './previewNextAuthSessionPlugin';
import {
  createPreviewNodeBuiltinPlugin,
  PREVIEW_NODE_PATH_GLOBAL_DEFINES,
} from './previewNodeBuiltinPlugin';
import { createPreviewCompilerOwnedNamespaceRegistry } from './previewOwnedNamespaceRegistry';
import { createPreviewParentSlicePlugin } from './previewParentSlicePlugin';
import { createPreviewPnpPeerDependencyPlugin } from './previewPnpPeerDependencyPlugin';
import { collectPreviewPrismaColumnDefaults } from './previewPrismaColumnDefaults';
import { createPreviewImportMetaEnvironment } from './previewPublicEnvironment';
import { createPreviewReactQueryBridgePlugin } from './previewReactQueryBridgePlugin';
import { createPreviewReduxBridgePlugin } from './previewReduxBridgePlugin';
import {
  assertPreviewResolutionPaths,
  createPreviewResolutionConfinementPlugin,
} from './previewResolutionConfinement';
import { selectPreviewSassPreparationPath } from './previewSassPreparation';
import { createPreviewRouterBridgePlugin } from './previewRouterBridgePlugin';
import { type PreviewRuntimeEnvironment } from './previewRuntimeEnvironment';
import { createPreviewRuntimeInstanceKey } from './previewRuntimeInstanceKey';
import {
  createPreviewSassPlugin,
  type PreviewSassBoundary,
  type PreviewSassPluginOptions,
} from './previewSassPlugin';
import { createPreviewSetupBridgePlugin } from './previewSetupBridgePlugin';
import { PreviewSetupFallbackBoundary } from './previewSetupFallbackBoundary';
import { createPreviewStyledComponentsCompilerPlan } from './previewStyledComponentsCompilerPlan';
import {
  createPreviewSyntheticInputRegistry,
  PREVIEW_IMPORT_META_ENV_DEFINE_INPUT,
} from './previewSyntheticInputRegistry';
import { createPreviewTailwindPlugin } from './previewTailwindPlugin';
import { createPreviewTargetBridgePlugin } from './previewTargetBridgePlugin';
import { createPreviewThemeBridgePlugin } from './previewThemeBridgePlugin';
import { createPreviewThemeCandidatePlugin } from './previewThemeCandidatePlugin';
import { createPreviewNextThemesStoragePlugin } from './previewNextThemesStoragePlugin';
import { createPreviewYarnLibuiBridgePlugin } from './previewYarnLibuiBridgePlugin';
import { createPreviewSelectedTargetOccurrences } from './staticResources/previewSelectedTargetExit';
import { supportsPreviewJsxPathOccurrenceProof } from './previewJsxOccurrenceIdentity';
import { createPreviewSelectedPageTabHookProof } from './staticResources/previewSelectedPageTabHookProof';
import { PreviewSourceTransformer } from './staticResources/previewSourceTransformer';
import { createPreviewTypedFunctionExpression } from './typeOracle/previewTypedValueExpression';
import { createPreviewBuildTypeOracleView } from './typeOracle/previewTypeOracle';
import {
  createWorkspaceSourcePlugin,
  MutableWorkspaceSourceState,
  type WorkspaceSourceCompilationState,
} from './workspaceSourcePlugin';

/** Executes one phase with explicit prepared inputs and caller-owned service lifetimes. */
export async function executePreviewCompilerBuild(
  inputs: PreviewCompilerBuildInputs,
  services: PreviewCompilerBuildInputsServices,
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
> {
  const { localTargetModuleContract } = inputs;
  const styledComponentsCompilerPlan = createPreviewStyledComponentsCompilerPlan(
    inputs.styleContext.styledComponentsPlan,
  );
  const inspectorAnalysisPlan =
    inputs.request.renderMode === 'page-inspector'
      ? inputs.targetUsageProps.inspectorPlan
      : undefined;
  const inspectorPlan =
    inputs.request.renderMode === 'page-inspector' ? inputs.activeInspectorPlan : undefined;
  const activeParentSlices =
    inputs.request.renderMode !== 'page-inspector' && environment.setupKind === 'none'
      ? inputs.targetUsageProps.parentSlicesByExport
      : {};
  const typeOracle =
    inputs.request.renderMode === 'page-inspector'
      ? createPreviewBuildTypeOracleView(services.typeOracle, {
          ...(inputs.nextAuthAugmentationPaths.length === 0
            ? {}
            : { augmentationPaths: inputs.nextAuthAugmentationPaths }),
          ...(inputs.prismaClientTypes === undefined
            ? {}
            : { virtualModules: [inputs.prismaClientTypes] }),
          managedNodeModulesPaths: inputs.managedDependencyEnvironment.nodeModulesPaths,
          plan: inspectorPlan,
          request: inputs.request,
          snapshotSourceByPath: inputs.snapshotSourceByPath,
        })
      : undefined;
  const serverContractSourcePaths = inputs.activeDependencyResolutionHints?.facadeSourcePaths ?? [];
  // Only typed server queries use schema defaults, so other builds never read the schema.
  const prismaColumnDefaults =
    typeOracle === undefined || serverContractSourcePaths.length === 0
      ? undefined
      : await collectPreviewPrismaColumnDefaults(inputs.projectRoot).catch(() => undefined);
  const sourceTransformer = new PreviewSourceTransformer({
    ...(findPreviewDependencySpecifier(inputs.dependencyProfile, 'ag-grid-enterprise') !== undefined
      ? { agGridModulePackage: 'enterprise' as const }
      : findPreviewDependencySpecifier(inputs.dependencyProfile, 'ag-grid-community') !== undefined
        ? { agGridModulePackage: 'community' as const }
        : {}),
    ...(inputs.criticalSurfaceSourcePaths.length === 0
      ? {}
      : { criticalSurfaceSourcePaths: inputs.criticalSurfaceSourcePaths }),
    deferDormantOverlayImports: inputs.policy.deferDormantOverlayImports,
    documentPath: canonicalizeExistingPath(
      inputs.runtimeTargetMode === 'selected-route-leaf'
        ? (inputs.runtimeOwnershipTarget?.sourcePath ?? inputs.request.documentPath)
        : inputs.request.documentPath,
    ),
    ...(inputs.activePageExecutionCandidate?.evidenceSourcePaths === undefined
      ? {}
      : {
          preservedDormantOverlaySourcePaths:
            inputs.activePageExecutionCandidate.evidenceSourcePaths,
        }),
    selectiveDependencyPassThrough: inputs.policy.selectiveDependencyPassThrough,
    implicitPackageGlobalCandidateNames: globalPackagePlan.fallbackCandidateNames,
    implicitPackageGlobalResolver: inputs.staticModuleResolver,
    instrumentDataRequests: inputs.request.renderMode === 'page-inspector',
    instrumentGraphqlDocuments: inputs.request.renderMode === 'page-inspector',
    instrumentRenderConditions: inputs.request.renderMode === 'page-inspector',
    instrumentRuntimeEffectIsolation: inputs.request.renderMode === 'page-inspector',
    instrumentRuntimeHookFallbacks: inputs.request.renderMode === 'page-inspector',
    ...(inspectorPlan === undefined
      ? {}
      : {
          trackSelectedJsxOccurrences: supportsPreviewJsxPathOccurrenceProof(
            inputs.activePageExecutionCandidate?.browserCandidate.renderPath ??
              inspectorPlan.renderChain.paths[0],
          ),
          selectedTargetOccurrences: createPreviewSelectedTargetOccurrences(
            inputs.activePageExecutionCandidate?.browserCandidate.edges ?? inspectorPlan.edges,
            inputs.activePageExecutionCandidate?.browserCandidate.renderPath ??
              inspectorPlan.renderChain.paths[0],
          ),
          admitSelectedPageTabHook: createPreviewSelectedPageTabHookProof(
            inputs.staticModuleResolver.resolve,
            async (sourcePath, maximumBytes) =>
              inputs.snapshotSourceByPath.get(path.normalize(sourcePath)) ??
              services.projectUsageCache.readSourceText({ sourcePath, maximumBytes }),
          ),
        }),
    ...(localTargetModuleContract === undefined
      ? {}
      : {
          localTargetExportInstrumentation: {
            metadataByExport: Object.fromEntries(
              localTargetModuleContract.selectedExportNames.map((exportName) => {
                const inference = inputs.runtimeTargetInferredPropsByExport[exportName];
                return [
                  exportName,
                  {
                    compilerExportEvidence: true as const,
                    ...(inputs.effectControllerTargetExportNames.includes(exportName)
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
                    ...(inputs.navigationOnlyTargetExportNames.includes(exportName)
                      ? { intentionalNavigationOutput: true as const }
                      : {}),
                    preparedSourceDigest: localTargetModuleContract.preparedSourceDigest,
                    sourcePath: localTargetModuleContract.sourcePath,
                    ...(inputs.activePageExecutionCandidate?.fidelity === 'target-only'
                      ? { targetOnlyExecution: true as const }
                      : {}),
                  },
                ];
              }),
            ),
            sourcePath: localTargetModuleContract.sourcePath,
          },
        }),
    graphqlModuleResolver: inputs.staticModuleResolver,
    ...(typeOracle === undefined || serverContractSourcePaths.length === 0
      ? {}
      : { serverContractSourcePaths }),
    ...(prismaColumnDefaults === undefined ? {} : { prismaColumnDefaults }),
    jsxRuntimeResolver: inputs.staticModuleResolver,
    projectRoot: inputs.projectRoot,
    projectUsesNextRuntime: inputs.nextEvidence.projectRuntime,
    projectUsesReactRuntime:
      findPreviewDependencySpecifier(inputs.dependencyProfile, 'react') !== undefined,
    readGraphqlSource: (sourcePath) => inputs.snapshotSourceByPath.get(path.normalize(sourcePath)),
    ...(typeOracle === undefined ? {} : { typeOracle }),
    workspaceRoot: inputs.canonicalWorkspaceRoot,
  });
  const sourceCompilation: WorkspaceSourceCompilationState = {
    prepareSource: inputs.targetSelection.prepareSource,
    runtimeInstanceKey: createPreviewRuntimeInstanceKey(),
    snapshots: [
      {
        documentPath: inputs.request.documentPath,
        language: inputs.request.language,
        sourceText: inputs.request.sourceText,
      },
      ...inputs.request.dependencySnapshots,
      ...inputs.styleContext.tailwindCandidateSnapshots,
    ],
    transformer: sourceTransformer,
  };
  const sassOptions: PreviewSassPluginOptions = {
    projectRoot: inputs.projectRoot,
    workspaceRoot: inputs.canonicalWorkspaceRoot,
    ...(await createSassPreparation()),
  };
  /** Prepares one proven style runtime while preserving current source and confinement checks. */
  async function createSassPreparation(): Promise<Pick<PreviewSassPluginOptions, 'preparation'>> {
    const createTask = services.incrementalBuildCache.createSassTask;
    if (createTask === undefined) return {};
    const sourcePath = await selectPreviewSassPreparationPath({
      applicationImports: inputs.applicationStylesheetImports,
      globalImports: inputs.globalStyleImports,
      readSource: async (sourcePath, maximumBytes) =>
        inputs.snapshotSourceByPath.get(path.normalize(sourcePath)) ??
        services.projectUsageCache.readSourceText({ sourcePath, maximumBytes }),
    });
    if (sourcePath === undefined) return {};
    assertPreviewResolutionPaths(inputs.resolutionConfinement, [sourcePath]);
    return { preparation: { sourcePath, createTask, signal: inputs.buildSignal } };
  }
  const oneShotSassBoundary =
    fallbackBoundary === undefined ? undefined : createPreviewSassPlugin(sassOptions);
  const entrySource = createPreviewEntry({
    documentName: createPreviewDocumentName(inputs.request),
    ...(inputs.documentShellEvidence === undefined
      ? {}
      : { documentShell: inputs.documentShellEvidence.shell }),
    globalNamespaces: environment.globalNamespaces,
    globalPackageBridgeStatus: describeGlobalPackageBridgeStatus(globalPackagePlan),
    publicEnvironment: environment.publicEnvironment,
    ...(inputs.inspectorSourceGestureSecret === undefined
      ? {}
      : { inspectorSourceGestureSecret: inputs.inspectorSourceGestureSecret }),
    reactDomRootKind: inputs.reactDomRootKind,
    renderMode: inputs.request.renderMode ?? 'component',
    portalHostIds: inputs.buildState.portalHostIds,
    setupKind: environment.setupKind,
    styleSheetManagerPlanEnabled: true,
  });
  const entryStrategy = styledComponentsCompilerPlan.createEntryStrategy({
    entrySource,
    reactDomRootKind: inputs.reactDomRootKind,
    renderMode: inputs.request.renderMode ?? 'component',
    resolveDir: path.dirname(inputs.request.documentPath),
    singleEntryPoint: path.relative(
      inputs.request.workspaceRoot,
      path.join(path.dirname(inputs.request.documentPath), VIRTUAL_ENTRY_NAME),
    ),
  });
  let styleDependencyPaths: readonly string[] = [];
  let styleWatchDirectories: readonly string[] = [];
  const outputSelection = entryStrategy.outputSelection;
  const createBuildOptions = (
    incrementalState: MutableWorkspaceSourceState | undefined,
    sassBoundary: PreviewSassBoundary,
  ): PreviewIncrementalBuildOptions => {
    let sourceState = incrementalState;
    const transformer = incrementalState?.transformer ?? sourceTransformer;
    const buildOptions: PreviewIncrementalBuildOptions = {
      absWorkingDir: inputs.request.workspaceRoot,
      bundle: true,
      charset: 'utf8',
      define: {
        ...PREVIEW_NODE_PATH_GLOBAL_DEFINES,
        ...createPreviewLegacyCommonJsGlobalDefines(inputs.buildState.legacyCommonJsGlobalNames),
        'import.meta.env': JSON.stringify(
          createPreviewImportMetaEnvironment(environment.publicEnvironment),
        ),
        'process.env.NODE_ENV': '"development"',
      },
      chunkNames: PREVIEW_LAZY_STYLE_CHUNK_NAMES,
      entryNames: entryStrategy.kind === 'shared-styled-runtime' ? '[name]' : 'entry',
      format: 'esm',
      jsx: 'automatic',
      jsxDev: true,
      legalComments: 'none',
      loader: PREVIEW_SOURCE_LOADERS,
      logLevel: 'silent',
      metafile: true,
      nodePaths: [...inputs.managedDependencyEnvironment.nodeModulesPaths],
      outdir: path.resolve(inputs.request.workspaceRoot, PREVIEW_OUTPUT_DIRECTORY_NAME),
      platform: 'browser',
      plugins: [
        createPreviewNextThemesStoragePlugin(inputs.projectRoot),
        createPreviewInstalledPackageExternalizationPlugin({
          documentPath: inputs.request.documentPath,
          staticModuleResolver: inputs.staticModuleResolver,
        }),
        ...entryStrategy.plugins,
        ...(inspectorPlan === undefined
          ? []
          : [createPreviewInspectorRuntimePlugin({ projectRoot: inputs.projectRoot })]),
        createPreviewNodeBuiltinPlugin(),
        createPreviewManagedDependencyPeerPlugin({
          managedNodeModulesPaths: inputs.managedDependencyEnvironment.nodeModulesPaths,
          projectRoot: inputs.projectRoot,
        }),
        createPreviewPnpPeerDependencyPlugin({
          applicationSourcePaths:
            inspectorPlan?.pageCandidates.map((candidate) => candidate.root.sourcePath) ?? [],
          projectRoot: inputs.projectRoot,
          workspaceRoot: inputs.canonicalWorkspaceRoot,
        }),
        createPreviewLegacyNbindCspPlugin({
          readSource: (options) => services.projectUsageCache.readSourceText(options),
        }),
        ...(inputs.activeDependencyResolutionHints !== undefined &&
        (inputs.activeDependencyResolutionHints.facadeSourcePaths.length > 0 ||
          inputs.activeDependencyResolutionHints.packageContractCandidates.length > 0 ||
          inputs.activeDependencyResolutionHints.styleCandidates.length > 0)
          ? [
              createPreviewDependencyResolutionHintPlugin({
                facadeHints: inputs.activeDependencyResolutionHints.facadeCandidates,
                facadeSourcePaths: inputs.activeDependencyResolutionHints.facadeSourcePaths,
                onHintApplied: (score) => {
                  inputs.appliedDependencyHintScores.add(score);
                },
                packageContractHints:
                  inputs.activeDependencyResolutionHints.packageContractCandidates,
                readSource: (sourcePath) =>
                  inputs.snapshotSourceByPath.get(path.normalize(sourcePath)) ??
                  services.projectUsageCache.readSourceText({
                    maximumBytes: 2 * 1024 * 1024,
                    sourcePath,
                  }),
                // Read per call: a persistent context keeps this plugin but swaps transformers.
                readTypedExportExpression: (sourcePath, exportName) => {
                  const typed = (
                    incrementalState?.transformer ?? sourceTransformer
                  ).typeOracle?.readTypedExportValue({
                    exportName,
                    requiredPaths: [],
                    sourcePath,
                  });
                  const expression =
                    typed === undefined
                      ? undefined
                      : createPreviewTypedFunctionExpression(
                          typed.value,
                          PREVIEW_SERVER_CONTRACT_NEUTRAL_VALUE_EXPRESSION,
                        );
                  return expression === undefined || typed === undefined
                    ? undefined
                    : { expression, nullableResult: typed.nullableResult };
                },
                styleHints: inputs.activeDependencyResolutionHints.styleCandidates,
                workspaceRoot: inputs.canonicalWorkspaceRoot,
              }),
            ]
          : []),
        createPreviewNextAuthSessionPlugin({
          // Read per call: a persistent context keeps this plugin but swaps transformers.
          readSessionExpression: (importerPath) =>
            createPreviewNextAuthSessionExpression(
              (
                incrementalState?.transformer ?? sourceTransformer
              ).typeOracle?.readTypedModuleTypeValue({
                moduleSpecifier: PREVIEW_NEXT_AUTH_SPECIFIER,
                requiredPaths: PREVIEW_NEXT_AUTH_SESSION_PATHS,
                sourcePath: importerPath,
                typeName: PREVIEW_NEXT_AUTH_SESSION_TYPE_NAME,
              }),
            ),
        }),
        ...(inspectorPlan === undefined
          ? []
          : [
              createPreviewInspectorTargetPlugin({
                ...(inputs.runtimeTargetMode !== undefined ||
                inputs.targetUsageProps.inspectorTargetImportSpecifiers === undefined
                  ? {}
                  : {
                      acceptedTargetImportSpecifiers:
                        inputs.targetUsageProps.inspectorTargetImportSpecifiers,
                    }),
                inferredPropsByExport: inputs.runtimeTargetInferredPropsByExport,
                effectControllerExportNames: inputs.effectControllerTargetExportNames,
                navigationOnlyExportNames: inputs.navigationOnlyTargetExportNames,
                targetOnlyExecution:
                  inputs.activePageExecutionCandidate?.fidelity === 'target-only',
                targetModuleContract:
                  inputs.targetModuleContract ??
                  createPreviewInspectorTargetModuleContract({
                    preparedSourceText: inputs.targetSelection.sourceText,
                    selectedExportNames: Object.keys(
                      (inspectorAnalysisPlan ?? inspectorPlan).renderChainsByExport,
                    ),
                    sourcePath: inspectorPlan.target.sourcePath,
                  }),
              }),
              ...[
                createPreviewInspectorPageExecutionBuildPlugin(
                  inputs.activePageExecutionCandidate,
                  (sourcePath) => inputs.snapshotSourceByPath.get(sourcePath),
                  (sourcePath, sourceText) => transformer.transform(sourcePath, sourceText),
                  (sourcePath, sourceText) =>
                    transformer.prepareSelectedTargetOccurrences(sourcePath, sourceText),
                ),
              ].filter((plugin): plugin is NonNullable<typeof plugin> => plugin !== undefined),
              createPreviewInspectorCorridorPlugin({
                ...(inputs.policy.maximumSmallDynamicImports === undefined
                  ? {}
                  : { maximumSmallDynamicImports: inputs.policy.maximumSmallDynamicImports }),
                ...(inputs.preparedBundleExecution === undefined
                  ? {}
                  : {
                      frozenAuthenticSourcePaths:
                        inputs.preparedBundleExecution.prepared.frontier.authenticSourcePaths,
                      authenticComponentExports:
                        inputs.preparedBundleExecution.prepared.frontier.authenticComponentExports,
                      packageDemandSourcePaths:
                        inputs.preparedBundleExecution.prepared.frontier.packageDemandSourcePaths,
                      projectedEdges:
                        inputs.preparedBundleExecution.prepared.frontier.projectedEdges,
                    }),
                optimizeSelectedPackageBarrels: inputs.policy.optimizeSelectedPackageBarrels,
                plan: inspectorPlan,
                projectRoot: inputs.projectRoot,
                readSource: (p) => inputs.snapshotSourceByPath.get(path.normalize(p)),
                resolveModule: inputs.staticModuleResolver.resolve,
                workspaceRoot: inputs.canonicalWorkspaceRoot,
              }),
            ]),
        createPreviewMissingSourceFallbackPlugin({
          selectedCorridorPreparation: inputs.policy.discoveryScope === 'selected-corridor',
          readSource: (sourcePath) => sourceState?.readCurrentSource(sourcePath),
          registerWatchDirectory: transformer.registerWatchDirectory.bind(transformer),
          staticModuleResolver: inputs.staticModuleResolver,
          workspaceRoot: inputs.canonicalWorkspaceRoot,
        }),
        createPreviewGlobalPackageBridgePlugin({ plan: globalPackagePlan }),
        createPreviewApolloBridgePlugin({ projectRoot: inputs.projectRoot }),
        createPreviewContextBridgePlugin({ projectRoot: inputs.projectRoot }),
        createPreviewDragDropBridgePlugin({
          ...(inputs.initialDragDropRequirement === undefined
            ? {}
            : { initialRequirement: inputs.initialDragDropRequirement }),
          projectRoot: inputs.projectRoot,
        }),
        createPreviewFormikBridgePlugin({ projectRoot: inputs.projectRoot }),
        createPreviewReactQueryBridgePlugin({ projectRoot: inputs.projectRoot }),
        createPreviewYarnLibuiBridgePlugin({ projectRoot: inputs.projectRoot }),
        createPreviewReduxBridgePlugin({
          ...(inputs.automaticRedux === undefined
            ? {}
            : { automaticState: inputs.automaticRedux.state }),
          ...(inputs.automaticRedux?.absentReceiverOverlay === undefined
            ? {}
            : { absentReceiverOverlay: inputs.automaticRedux.absentReceiverOverlay }),
          projectRoot: inputs.projectRoot,
        }),
        createPreviewRouterBridgePlugin({
          automaticallyWrap: routerSelection.automaticallyWrap,
          enabled: routerSelection.enabled,
          nextAppEnabled:
            inspectorPlan?.pageCandidates.some(
              (candidate) => candidate.routeLocation?.evidenceKind === 'next-app-filesystem',
            ) === true,
          ...(inputs.nextPagesI18n === undefined ? {} : { nextPagesI18n: inputs.nextPagesI18n }),
          projectRoot: inputs.projectRoot,
        }),
        createPreviewThemeBridgePlugin({
          projectRoot: inputs.projectRoot,
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
          documentPath: inputs.request.documentPath,
          plansByExport: activeParentSlices,
        }),
        ...(inspectorPlan === undefined
          ? [
              createPreviewTargetBridgePlugin({
                applicationStylesheetImports: inputs.applicationStylesheetImports,
                documentPath: inputs.request.documentPath,
                exports: inputs.targetExports,
                parentSlicesByExport: activeParentSlices,
                ...(inputs.request.renderMode !== 'page-inspector' ||
                inputs.contextDiscoveryTruncated === true ||
                inputs.inspectorExportName === undefined
                  ? {}
                  : { standalonePageTargetExportName: inputs.inspectorExportName }),
                ...(inputs.selectedThemeImport === undefined
                  ? {}
                  : { themeImport: inputs.selectedThemeImport }),
                inferredPropsByExport: inputs.inferredPropsByExport,
                usagePropsByExport: inputs.targetUsageProps.propsByExport,
              }),
            ]
          : [
              createPreviewInspectorRootPlugin({
                applicationStylesheetImports: inputs.applicationStylesheetImports,
                displayName: path.basename(
                  (inputs.runtimeOwnershipTarget ?? inspectorPlan.target).sourcePath,
                ),
                globalStyleImports: inputs.globalStyleImports,
                plan: inspectorAnalysisPlan ?? inspectorPlan,
                ...(inputs.runtimeTargetMode === undefined
                  ? {}
                  : { targetMode: inputs.runtimeTargetMode }),
                targetTypedProps: typeOracle?.readTypedComponentProps(
                  inputs.runtimeOwnershipTarget ?? inspectorPlan.target,
                ),
                ...(inputs.activePageExecutionCandidate === undefined
                  ? {}
                  : { pageExecutionCandidate: inputs.activePageExecutionCandidate }),
                ...(inputs.executionRootModuleContract === undefined
                  ? {}
                  : { executionRootModuleContract: inputs.executionRootModuleContract }),
                ...(inputs.pageExecutionCandidates.length === 0
                  ? {}
                  : { pageExecutionCandidates: inputs.pageExecutionCandidates }),
                ...(inputs.request.inspectorPageCandidateId === undefined
                  ? {}
                  : { selectedPageCandidateId: inputs.request.inspectorPageCandidateId }),
                ...(inputs.selectedThemeImport === undefined
                  ? {}
                  : { themeImport: inputs.selectedThemeImport }),
                readSource: (p) => inputs.snapshotSourceByPath.get(path.normalize(p)),
                runtimeOwnershipTarget: inputs.runtimeOwnershipTarget ?? inspectorPlan.target,
                ...(inputs.targetModuleContract === undefined
                  ? {}
                  : { targetModuleContract: inputs.targetModuleContract }),
                ...(inputs.runtimeTargetInferredPropsByExport[
                  (inputs.runtimeOwnershipTarget ?? inspectorPlan.target).exportName
                ] === undefined
                  ? {}
                  : {
                      targetInference:
                        inputs.runtimeTargetInferredPropsByExport[
                          (inputs.runtimeOwnershipTarget ?? inspectorPlan.target).exportName
                        ],
                    }),
              }),
            ]),
        ...(fallbackBoundary === undefined ? [] : [fallbackBoundary.plugin]),
        createPreviewMdxFallbackPlugin({ workspaceRoot: inputs.canonicalWorkspaceRoot }),
        createPreviewAssetPlugin({
          documentPath: inputs.request.documentPath,
          projectRoot: inputs.projectRoot,
          registerWatchDirectory: transformer.registerWatchDirectory.bind(transformer),
          workspaceRoot: inputs.canonicalWorkspaceRoot,
        }),
        createPreviewTailwindPlugin({
          ...(services.adapterStrategyLearner === undefined
            ? {}
            : { adapterStrategyLearner: services.adapterStrategyLearner }),
          boundedSourceDiscovery: inputs.policy.boundedTailwindSourceDiscovery,
          fallbackNodeModulesPaths: inputs.managedDependencyEnvironment.nodeModulesPaths,
          ...(inputs.activeDependencyResolutionHints === undefined
            ? {}
            : { hintedStyleFallbacks: inputs.activeDependencyResolutionHints.styleCandidates }),
          projectRoot: inputs.projectRoot,
          readSourceSnapshots: () => incrementalState?.snapshots ?? sourceCompilation.snapshots,
          ...(inputs.requiredTailwindCompilerPackage === undefined
            ? {}
            : { requiredCompilerPackage: inputs.requiredTailwindCompilerPackage }),
          workspaceRoot: inputs.canonicalWorkspaceRoot,
        }),
        sassBoundary.plugin,
        createWorkspaceSourcePlugin({
          incrementalState: (sourceState ??= new MutableWorkspaceSourceState(sourceCompilation)),
          workspaceRoot: inputs.canonicalWorkspaceRoot,
        }),
      ],
      sourcemap: false,
      ...entryStrategy.buildOptions,
      target: 'es2022',
      treeShaking: true,
      ...(inputs.request.tsconfigPath === undefined
        ? {}
        : { tsconfig: inputs.request.tsconfigPath }),
      write: false,
    };
    if (inputs.resolutionConfinement === undefined) return buildOptions;
    const namespaceRegistry = createPreviewCompilerOwnedNamespaceRegistry(
      buildOptions.plugins ?? [],
      {
        inspectorPageExecutionEntry: inputs.activePageExecutionCandidate !== undefined,
        ...(inputs.policy.discoveryScope === 'selected-corridor'
          ? inspectorPlan === undefined || !inputs.policy.optimizeSelectedPackageBarrels
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
            inputs.normalizePreviewMetafileSourceIdentity(
              stdinSourcefile,
              buildOptions.absWorkingDir ?? process.cwd(),
            ),
          ]),
    ]);
    return {
      ...buildOptions,
      plugins: [
        createPreviewResolutionConfinementPlugin(
          inputs.resolutionConfinement,
          namespaceRegistry,
          syntheticInputRegistry,
        ),
        ...(buildOptions.plugins ?? []),
      ],
    };
  };
  const buildPlanIdentity = createPreviewBuildPlanIdentity({
    dependencyResolutionHints: createPreviewDependencyResolutionHintIdentity(
      inputs.activeDependencyResolutionHints,
    ),
    documentPath: inputs.request.documentPath,
    documentShell: {
      evidence: inputs.documentShellEvidence?.shell,
      portalHostIds: inputs.buildState.portalHostIds,
    },
    environment,
    applicationStylesheetImports: inputs.applicationStylesheetImports,
    globalPackagePlan,
    globalStyleImports: inputs.globalStyleImports,
    inferredPropsByExport: inputs.inferredPropsByExport,
    inspectorPlan,
    inspectorBundleFrontier: inputs.preparedBundleExecution?.prepared.frontier.identity,
    legacyCommonJsGlobalNames: inputs.buildState.legacyCommonJsGlobalNames,
    managedDependencyEnvironment: inputs.managedDependencyEnvironment.identity,
    parentSlices: activeParentSlices,
    preparationMode: inputs.request.preparationMode,
    projectRoot: inputs.projectRoot,
    reactDomRootKind: inputs.reactDomRootKind,
    renderMode: inputs.request.renderMode,
    routerSelection,
    targetExports: inputs.targetExports,
    targetUsageProps: inputs.targetUsageProps,
    themeImport: inputs.selectedThemeImport,
    tsconfigPath: inputs.request.tsconfigPath,
    styledComponents: styledComponentsCompilerPlan.buildIdentity,
    workspaceRoot: inputs.canonicalWorkspaceRoot,
  });
  const reportNativeActivity: PreviewIncrementalBuildActivityReporter = (activity) => {
    inputs.context?.reportProgress?.('bundling-modules', {
      ...inputs.compilerGraphSummary,
      ...activity,
      kind: 'native-build',
      pass: adaptivePass,
    });
  };
  const result = await (
    fallbackBoundary === undefined
      ? services.incrementalBuildCache.rebuild({
          captureSassState: (dependencyPaths, watchDirectories) => {
            styleDependencyPaths = dependencyPaths;
            styleWatchDirectories = watchDirectories;
          },
          contextKey: buildPlanIdentity,
          createOptions: (sourceState, sassBoundary) =>
            createBuildOptions(sourceState, requirePreviewSassBoundary(sassBoundary)),
          reportActivity: reportNativeActivity,
          sassOptions,
          signal: inputs.buildSignal,
          sourceCompilation,
        })
      : services.incrementalBuildCache.buildOnce(
          createBuildOptions(undefined, requirePreviewSassBoundary(oneShotSassBoundary)),
          inputs.buildSignal,
          reportNativeActivity,
        )
  ).finally(() => typeOracle?.release());
  if (oneShotSassBoundary !== undefined) {
    styleDependencyPaths = oneShotSassBoundary.getDependencyPaths();
    styleWatchDirectories = oneShotSassBoundary.getWatchDirectories();
  }
  throwIfPreviewBuildCancelled(inputs.buildSignal);
  return {
    globalPackagePlan,
    referencedGlobalNames: sourceTransformer.getReferencedImplicitPackageGlobalNames(),
    outputSelection,
    result,
    routerRequirement: sourceTransformer.getRouterRequirement(),
    styleDependencyPaths,
    watchDirectories: mergePreviewWatchDirectories(
      sourceTransformer.getWatchDirectories(),
      inputs.runtimeWatchInputs.watchDirectories,
      styleWatchDirectories,
    ),
  };
}
