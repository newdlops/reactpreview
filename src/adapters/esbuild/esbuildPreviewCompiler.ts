/**
 * Implements the preview compiler port with esbuild's in-process build API.
 * It never starts `serve()` or writes into the user's project: browser artifacts remain in memory
 * until the separate artifact-store adapter publishes them under VS Code global storage.
 */
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
import { forwardPreviewAbort } from './previewAbortForwarding';
import { PreviewAdaptiveBuildPlanCache } from './previewAdaptiveBuildPlanCache';
import { createPreviewAssetPlugin } from './previewAssetPlugin';
import { createPreviewBuildPlanIdentity } from './previewBuildPlanIdentity';
import {
  convertMessage,
  createPreviewBundle,
  describeUnknownError,
  isBuildFailure,
  PREVIEW_OUTPUT_DIRECTORY_NAME,
  restorePrivateNamespaces,
  VIRTUAL_ENTRY_NAME,
} from './previewBuildResult';
import { MAX_PREVIEW_OUTPUT_FILES } from './previewBuildOutputPlanner';
import { createPreviewContextBridgePlugin } from './previewContextBridgePlugin';
import { PreviewDiagnosticEmissionCache } from './previewDiagnosticEmissionCache';
import { createPreviewFormikBridgePlugin } from './previewFormikBridgePlugin';
import { createPreviewNodeBuiltinPlugin } from './previewNodeBuiltinPlugin';
import { createPreviewParentSlicePlugin } from './previewParentSlicePlugin';
import { createPreviewReduxBridgePlugin } from './previewReduxBridgePlugin';
import { createPreviewRouterBridgePlugin } from './previewRouterBridgePlugin';
import { PREVIEW_SOURCE_LOADERS } from './previewLoaderPolicy';
import { findPreviewProjectRoot } from './previewProjectRoot';
import { PreviewProjectUsageCache } from './previewProjectUsageCache';
import type { PreviewTargetUsageProps } from './previewTargetUsageProps';
import { PreviewImplicitGlobalEvidenceCache } from './previewImplicitGlobalEvidenceCache';
import type { PreviewImplicitGlobalEvidenceInventory } from './previewImplicitGlobalEvidence';
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
  type PreviewRuntimeWatchInputs,
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
import {
  selectPreviewPrimaryTargetExport,
  selectPreviewTargetExports,
  selectPreviewThemeImport,
} from './previewTargetExports';
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

const MAX_PREVIEW_WATCH_DIRECTORIES = 128;
/** Direct-preview fast path omits package-wide reverse analysis until background enrichment. */
const EMPTY_TARGET_USAGE_PROPS: PreviewTargetUsageProps = Object.freeze({
  dependencyPaths: Object.freeze([]),
  parentSlicesByExport: Object.freeze({}),
  propsByExport: Object.freeze({}),
});
/** Fast builds discover exact free globals from their reached esbuild graph instead of a cold scan. */
const EMPTY_IMPLICIT_GLOBAL_EVIDENCE: PreviewImplicitGlobalEvidenceInventory = Object.freeze({
  ambiguousGlobalNames: Object.freeze([]),
  dependencyPaths: Object.freeze([]),
  evidence: Object.freeze([]),
  truncated: false,
  unresolvedGlobalNames: Object.freeze([]),
});

/** Fast first paint observes only reached esbuild inputs; convention candidates join enrichment. */
const EMPTY_RUNTIME_WATCH_INPUTS: PreviewRuntimeWatchInputs = Object.freeze({
  dependencyPaths: Object.freeze([]),
  watchDirectories: Object.freeze([]),
});

/** Router bridge selection carried into one discovery or final esbuild attempt. */
interface PreviewRouterBuildSelection {
  /** Whether graph evidence permits a default automatic MemoryRouter wrapper. */
  readonly automaticallyWrap: boolean;
  /** Whether the project router package should be resolved into the final runtime. */
  readonly enabled: boolean;
}

/** Optional compiler policy overrides used by deterministic integration tests. */
export interface EsbuildPreviewCompilerOptions {
  /** Split-output threshold before retrying with lazy initializers in a coalesced local artifact. */
  readonly maximumSplitOutputFiles?: number;
}

/** esbuild-backed compiler for browser-safe React preview bundles. */
export class EsbuildPreviewCompiler implements PreviewCompiler {
  /** Compiler-owned signals let shutdown cancel analysis that has not reached esbuild yet. */
  private readonly activeBuildControllers = new Set<AbortController>();
  /** Graph-proven runtime requirements reused so hot rebuilds normally need one native pass. */
  private readonly adaptiveBuildPlanCache = new PreviewAdaptiveBuildPlanCache();
  private disposed = false;
  /** Package-scoped bootstrap/ambient evidence reused across preview tabs and hot rebuilds. */
  private readonly implicitGlobalEvidenceCache = new PreviewImplicitGlobalEvidenceCache();
  /** Package-scoped inert source inventories reused by multiple tabs and hot rebuilds. */
  private readonly projectUsageCache = new PreviewProjectUsageCache();
  /** Native build contexts retaining parsed dependency graphs across compatible revisions. */
  private readonly incrementalBuildCache = new PreviewIncrementalBuildCache();
  /** One-time informational warnings retained separately from repeatable build errors. */
  private readonly diagnosticEmissionCache = new PreviewDiagnosticEmissionCache();
  /** Target plans whose previous split build exceeded the local artifact fan-out boundary. */
  private readonly outputStrategyCache = new PreviewOutputStrategyCache();
  /** Trackable broken Storybook graphs skipped until their exact source evidence changes. */
  private readonly setupFailureCache = new PreviewSetupFailureCache();
  /** Host-lifetime entropy derives entry-private source gesture keys without invalidating rebuilds. */
  private readonly inspectorGestureSeed = randomBytes(32);
  private readonly maximumSplitOutputFiles: number;
  private shutdownPromise: Promise<void> | undefined;

  /** Creates a production compiler or a lower-threshold deterministic test instance. */
  public constructor(options: EsbuildPreviewCompilerOptions = {}) {
    this.maximumSplitOutputFiles = normalizeMaximumSplitOutputFiles(
      options.maximumSplitOutputFiles,
    );
  }

  /**
   * Bundles the current editor snapshot, its dependency graph, CSS, and small binary assets.
   * Project build scripts and framework plugins are deliberately not loaded or executed.
   *
   * @param request Active editor snapshot and workspace module-resolution context.
   * @param context Optional progress observer and cancellation signal for the owning revision.
   * @returns In-memory ESM JavaScript, optional CSS, warnings, and dependency paths.
   * @throws PreviewCompilationError when esbuild cannot parse or bundle the module graph.
   */
  public async compile(
    request: PreviewBuildRequest,
    context?: PreviewBuildExecutionContext,
  ): Promise<PreviewBundle> {
    if (this.disposed) {
      throw new PreviewCompilationError('The React preview compiler is already closed.', []);
    }

    const buildController = new AbortController();
    const detachCallerAbort = forwardPreviewAbort(context?.signal, buildController);
    this.activeBuildControllers.add(buildController);
    const buildSignal = buildController.signal;
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
      const targetExports = selectPreviewTargetExports(request.documentPath, request.sourceText);
      const inferredPropsByExport = collectReactExportPropInference(
        request.documentPath,
        request.sourceText,
      );
      const explicitTargetExportNames = targetExports.flatMap((slot) =>
        slot.kind === 'explicit' ? [slot.exportName] : [],
      );
      const inspectorExportName =
        request.renderMode === 'page-inspector'
          ? selectPreviewPrimaryTargetExport(targetExports)
          : undefined;
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
      const [packageTargetUsageProps, implicitGlobalSourcePaths] = await Promise.all([
        useFastPreparation
          ? Promise.resolve(EMPTY_TARGET_USAGE_PROPS)
          : this.projectUsageCache.discover({
              climbParentSlices:
                request.renderMode !== 'page-inspector' && runtimeEnvironment.setupKind === 'none',
              documentPath: request.documentPath,
              exports: targetExports,
              ...(inspectorExportName === undefined ? {} : { inspectorExportName }),
              projectRoot,
              signal: buildSignal,
              snapshots: request.dependencySnapshots,
              sourceText: request.sourceText,
              ...(request.tsconfigPath === undefined ? {} : { tsconfigPath: request.tsconfigPath }),
              workspaceRoot: canonicalWorkspaceRoot,
            }),
        useFastPreparation
          ? Promise.resolve(Object.freeze([]) as readonly string[])
          : this.projectUsageCache.getSourcePaths(canonicalWorkspaceRoot, projectRoot, buildSignal),
      ]);
      let targetUsageProps = packageTargetUsageProps;
      const packageHasEntryConnectedPage =
        inspectorExportName !== undefined &&
        packageTargetUsageProps.renderChainsByExport?.[inspectorExportName]?.paths.some(
          (candidate) => candidate.entryPoint !== undefined,
        ) === true;
      const requiresWorkspaceAncestorEscalation =
        !useFastPreparation &&
        request.renderMode === 'page-inspector' &&
        !packageHasEntryConnectedPage &&
        (packageTargetUsageProps.inspectorPlan === undefined ||
          packageTargetUsageProps.inspectorPlan.edges.length === 0) &&
        (await shouldEscalatePreviewAncestorSearch(projectRoot, canonicalWorkspaceRoot));
      if (requiresWorkspaceAncestorEscalation) {
        targetUsageProps = await this.projectUsageCache.discover({
          documentPath: request.documentPath,
          exports: targetExports,
          ...(inspectorExportName === undefined ? {} : { inspectorExportName }),
          projectRoot: canonicalWorkspaceRoot,
          signal: buildSignal,
          snapshots: request.dependencySnapshots,
          sourceText: request.sourceText,
          ...(request.tsconfigPath === undefined ? {} : { tsconfigPath: request.tsconfigPath }),
          workspaceRoot: canonicalWorkspaceRoot,
        });
      }
      throwIfPreviewBuildCancelled(buildSignal);
      context?.reportProgress?.('preparing-runtime');
      const staticModuleResolver = createPreviewStaticModuleResolver({
        ...(request.tsconfigPath === undefined
          ? {}
          : { configuredTsconfigPath: request.tsconfigPath }),
        workspaceRoot: canonicalWorkspaceRoot,
      });
      const primaryRenderPath =
        inspectorExportName === undefined
          ? undefined
          : targetUsageProps.renderChainsByExport?.[inspectorExportName]?.paths[0];
      const styleContext = await preparePreviewStyleContext({
        ...(themeImport === undefined ? {} : { directThemeImport: themeImport }),
        inspectorDependencyPaths: targetUsageProps.inspectorPlan?.dependencyPaths ?? [],
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
      const implicitGlobalEvidence = useFastPreparation
        ? EMPTY_IMPLICIT_GLOBAL_EVIDENCE
        : await this.implicitGlobalEvidenceCache.discover({
            cacheKey: createImplicitGlobalEvidenceCacheKey(projectRoot, request.tsconfigPath),
            readSource: (sourcePath) => snapshotSourceByPath.get(path.normalize(sourcePath)),
            resolveModule: staticModuleResolver.resolve,
            signal: buildSignal,
            snapshotSourceByPath,
            sourcePaths:
              request.renderMode === 'page-inspector' && targetUsageProps.dependencyPaths.length > 0
                ? targetUsageProps.dependencyPaths
                : implicitGlobalSourcePaths,
          });
      throwIfPreviewBuildCancelled(buildSignal);
      const globalBridgeEvidencePolicy =
        createPreviewGlobalPackageBridgeEvidencePolicy(implicitGlobalEvidence);
      /** Creates one trace boundary per esbuild attempt because its resolver inventory is stateful. */
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
          documentPath: canonicalizeExistingPath(request.documentPath),
          implicitPackageGlobalCandidateNames: globalPackagePlan.fallbackCandidateNames,
          implicitPackageGlobalResolver: staticModuleResolver,
          instrumentDataRequests: request.renderMode === 'page-inspector',
          instrumentGraphqlDocuments: request.renderMode === 'page-inspector',
          instrumentRenderConditions: request.renderMode === 'page-inspector',
          instrumentRuntimeHookFallbacks: request.renderMode === 'page-inspector',
          graphqlModuleResolver: staticModuleResolver,
          projectRoot,
          readGraphqlSource: (sourcePath) => snapshotSourceByPath.get(path.normalize(sourcePath)),
          workspaceRoot: canonicalWorkspaceRoot,
        });
        const sourceCompilation: WorkspaceSourceCompilationState = {
          snapshots: [
            {
              documentPath: request.documentPath,
              language: request.language,
              sourceText: request.sourceText,
            },
            ...request.dependencySnapshots,
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
        ): PreviewIncrementalBuildOptions => ({
          absWorkingDir: request.workspaceRoot,
          bundle: true,
          charset: 'utf8',
          define: {
            'import.meta.env': JSON.stringify({
              BASE_URL: '/',
              DEV: true,
              MODE: 'development',
              PROD: false,
              SSR: false,
            }),
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
          outdir: path.resolve(request.workspaceRoot, PREVIEW_OUTPUT_DIRECTORY_NAME),
          platform: 'browser',
          plugins: [
            createPreviewNodeBuiltinPlugin(),
            createPreviewGlobalPackageBridgePlugin({ plan: globalPackagePlan }),
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
                    documentPath: request.documentPath,
                    exportNames: explicitTargetExportNames,
                    inferredPropsByExport,
                    originalHasDefaultExport: explicitTargetExportNames.includes('default'),
                  }),
                  createPreviewInspectorRuntimePlugin({ projectRoot }),
                  createPreviewInspectorCorridorPlugin({
                    plan: inspectorPlan,
                    projectRoot,
                    resolveModule: staticModuleResolver.resolve,
                    workspaceRoot: canonicalWorkspaceRoot,
                  }),
                ]),
            createPreviewApolloBridgePlugin({ projectRoot }),
            createPreviewContextBridgePlugin({ projectRoot }),
            createPreviewFormikBridgePlugin({ projectRoot }),
            createPreviewReduxBridgePlugin({ projectRoot }),
            createPreviewRouterBridgePlugin({
              automaticallyWrap: routerSelection.automaticallyWrap,
              enabled: routerSelection.enabled,
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
                    plan: inspectorPlan,
                    ...(selectedThemeImport === undefined
                      ? {}
                      : { themeImport: selectedThemeImport }),
                    ...(inferredPropsByExport[inspectorPlan.target.exportName] === undefined
                      ? {}
                      : {
                          targetInference: inferredPropsByExport[inspectorPlan.target.exportName],
                        }),
                  }),
                ]),
            ...(fallbackBoundary === undefined ? [] : [fallbackBoundary.plugin]),
            createPreviewAssetPlugin({
              documentPath: request.documentPath,
              projectRoot,
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
              ...(inspectorSourceGestureSecret === undefined
                ? {}
                : { inspectorSourceGestureSecret }),
              renderMode: request.renderMode ?? 'component',
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
        });
        const buildPlanIdentity = createPreviewBuildPlanIdentity({
          documentPath: request.documentPath,
          documentShell: documentShellEvidence?.shell,
          environment,
          globalPackagePlan,
          globalStyleImports,
          inferredPropsByExport,
          inspectorPlan,
          parentSlices: activeParentSlices,
          preparationMode: request.preparationMode,
          projectRoot,
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

      /**
       * Rebuilds at most once for graph-proven router hooks or exact installed-package globals.
       * Strong bootstrap/ambient bridges participate in the first build. Conservative same-name
       * package fallback is admitted only after that reached graph proves a lexical free reference.
       */
      const runAdaptiveBuild = async (
        environment: PreviewRuntimeEnvironment,
        splitOutputs: boolean,
      ): ReturnType<typeof runBuild> => {
        const adaptivePlanKey = createPreviewBuildPlanIdentity({
          documentPath: request.documentPath,
          environment,
          preparationMode: request.preparationMode,
          projectRoot,
          renderMode: request.renderMode,
          tsconfigPath: request.tsconfigPath,
          workspaceRoot: canonicalWorkspaceRoot,
        });
        const cachedPlan = this.adaptiveBuildPlanCache.read(adaptivePlanKey);
        const initialGlobalPackagePlan = await discoverPreviewGlobalPackageBridges({
          ...globalBridgeEvidencePolicy,
          projectRoot,
          referencedGlobalNames: cachedPlan?.referencedGlobalNames ?? [],
          workspaceRoot: canonicalWorkspaceRoot,
        });
        const initialRouterSelection: PreviewRouterBuildSelection =
          cachedPlan?.routerRequirement.consumesRouter === true
            ? {
                automaticallyWrap: !cachedPlan.routerRequirement.ownsRouter,
                enabled: true,
              }
            : { automaticallyWrap: false, enabled: false };
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
        this.adaptiveBuildPlanCache.write(adaptivePlanKey, {
          referencedGlobalNames: finalBuild.referencedGlobalNames,
          routerRequirement: finalBuild.routerRequirement,
        });
        return finalBuild;
      };

      const outputStrategyKey = createPreviewBuildPlanIdentity({
        documentPath: request.documentPath,
        preparationMode: request.preparationMode,
        projectRoot,
        renderMode: request.renderMode,
        runtimeEnvironment,
        tsconfigPath: request.tsconfigPath,
        workspaceRoot: canonicalWorkspaceRoot,
      });
      const setupFailureKey =
        runtimeEnvironment.setupKind === 'storybook' &&
        runtimeEnvironment.setupModulePath !== undefined
          ? createPreviewBuildPlanIdentity({
              projectRoot,
              setupModulePath: runtimeEnvironment.setupModulePath,
              workspaceRoot: canonicalWorkspaceRoot,
            })
          : undefined;
      const cachedSetupFailure =
        setupFailureKey === undefined
          ? undefined
          : await this.setupFailureCache.read(
              setupFailureKey,
              request.dependencySnapshots,
              buildSignal,
            );
      const cachedOutputStrategy = useFastPreparation
        ? undefined
        : this.outputStrategyCache.read(outputStrategyKey);
      let splitOutputs = !useFastPreparation && cachedOutputStrategy === undefined;
      let discoveredSplitOutputCount: number | undefined;
      let activeRuntimeEnvironment =
        cachedSetupFailure === undefined
          ? runtimeEnvironment
          : { globalNamespaces: runtimeEnvironment.globalNamespaces, setupKind: 'none' as const };
      let buildExecution: Awaited<ReturnType<typeof runBuild>> | undefined;
      let fallbackDependencies = cachedSetupFailure?.dependencyPaths ?? [];
      let fallbackWatchDirectories = cachedSetupFailure?.watchDirectories ?? [];
      let fallbackDiagnostics: readonly PreviewDiagnostic[] = [];
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
          globalNamespaces: runtimeEnvironment.globalNamespaces,
          setupKind: 'none',
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
      const previewBundle = createPreviewBundle(
        request,
        buildExecution.result,
        buildExecution.watchDirectories,
        [...fallbackDiagnostics, ...outputStrategyDiagnostics, ...inspectorFallbackDiagnostics],
        [
          ...buildExecution.globalPackagePlan.dependencyPaths,
          ...runtimeWatchInputs.dependencyPaths,
          ...fallbackDependencies,
          ...buildExecution.styleDependencyPaths,
          ...(documentShellEvidence === undefined ? [] : [documentShellEvidence.dependencyPath]),
          ...globalStyleImports.map((globalStyleImport) =>
            path.normalize(globalStyleImport.moduleSpecifier),
          ),
          ...targetUsageProps.dependencyPaths,
        ],
      );
      return inspectorSourceGestureSecret === undefined
        ? previewBundle
        : { ...previewBundle, inspectorSourceGestureSecret };
    } catch (error) {
      if (isPreviewBuildCancellation(error, buildSignal)) {
        throw error;
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
   *
   * @returns Promise resolved after esbuild confirms that its shared service has stopped.
   */
  public shutdown(): Promise<void> {
    if (this.shutdownPromise !== undefined) {
      return this.shutdownPromise;
    }

    this.disposed = true;
    for (const controller of this.activeBuildControllers) {
      controller.abort();
    }
    this.adaptiveBuildPlanCache.clear();
    this.diagnosticEmissionCache.clear();
    this.implicitGlobalEvidenceCache.clear();
    this.outputStrategyCache.clear();
    this.projectUsageCache.clear();
    this.setupFailureCache.clear();
    this.shutdownPromise = this.incrementalBuildCache.shutdown().then(async () => {
      await stop();
    });
    return this.shutdownPromise;
  }
}

/** Clamps an internal split threshold without allowing tests to weaken the production hard limit. */
function normalizeMaximumSplitOutputFiles(configuredMaximum: number | undefined): number {
  if (!Number.isSafeInteger(configuredMaximum) || configuredMaximum === undefined) {
    return MAX_PREVIEW_OUTPUT_FILES;
  }
  return Math.min(MAX_PREVIEW_OUTPUT_FILES, Math.max(1, configuredMaximum));
}

/** Explains why one large graph uses lazy module initializers inside fewer local artifact files. */
function createCoalescedOutputDiagnostic(
  splitOutputCount: number,
  coalescedOutputCount: number,
  targetName: string,
): PreviewDiagnostic {
  return {
    message: `The split preview graph for ${targetName} produced ${splitOutputCount.toString()} local output files, so React Preview automatically coalesced it into ${coalescedOutputCount.toString()} output file(s). Dynamic-import modules still initialize only when their loader is invoked, while per-module file splitting is disabled for this oversized local graph.`,
    severity: 'warning',
  };
}

/** Separates nearest-config and explicitly configured evidence resolution policies per package. */
function createImplicitGlobalEvidenceCacheKey(
  projectRoot: string,
  configuredTsconfigPath: string | undefined,
): string {
  const configIdentity =
    configuredTsconfigPath === undefined
      ? 'nearest-config'
      : path.normalize(configuredTsconfigPath);
  return `${path.normalize(projectRoot)}\0${configIdentity}`;
}

/** Describes static module injection without claiming that every available candidate was used. */
function describeGlobalPackageBridgeStatus(plan: PreviewGlobalPackageBridgePlan): string {
  if (plan.bridges.length === 0) {
    return plan.truncated
      ? 'degraded: implicit-global evidence or exact package candidates exceeded a safety budget'
      : 'available: no active bridge; exact package fallback is enabled only for reached free identifiers';
  }
  const projectEvidenceCount = plan.bridges.filter(
    (bridge) =>
      bridge.evidence === 'ambient-declaration' || bridge.evidence === 'runtime-assignment',
  ).length;
  const packageFallbackCount = plan.bridges.filter(
    (bridge) => bridge.evidence === 'dependency-name',
  ).length;
  return `active: ${plan.bridges.length.toString()} lexical module bridge(s); ${projectEvidenceCount.toString()} from project bootstrap/ambient evidence, ${packageFallbackCount.toString()} from exact installed-package fallback`;
}

/** Reports whether a cached router boundary exactly matches the newly reached source graph. */
function haveEquivalentRouterSelections(
  left: PreviewRouterBuildSelection,
  right: PreviewRouterBuildSelection,
): boolean {
  return left.enabled === right.enabled && left.automaticallyWrap === right.automaticallyWrap;
}

/** Reports whether adaptive discovery selected the same generated module bindings. */
function haveEquivalentGlobalPackageBridges(
  left: PreviewGlobalPackageBridgePlan,
  right: PreviewGlobalPackageBridgePlan,
): boolean {
  return (
    left.bridges.length === right.bridges.length &&
    left.bridges.every((bridge, index) => {
      const candidate = right.bridges[index];
      return (
        bridge.globalName === candidate?.globalName &&
        bridge.moduleSpecifier === candidate.moduleSpecifier &&
        bridge.resolveDir === candidate.resolveDir &&
        bridge.exportKind === candidate.exportKind &&
        bridge.exportName === candidate.exportName
      );
    })
  );
}

/**
 * Creates a stable setup/decorator title without exposing a path outside the selected workspace.
 *
 * @param request Compilation request containing target and workspace identities.
 * @returns Workspace-relative target name, or the basename when the target is outside that root.
 */
function createPreviewDocumentName(request: PreviewBuildRequest): string {
  const relativeName = path.relative(request.workspaceRoot, request.documentPath);
  return relativeName.length > 0 && !relativeName.startsWith('..') && !path.isAbsolute(relativeName)
    ? relativeName.split(path.sep).join('/')
    : path.basename(request.documentPath);
}

/**
 * Narrows the Sass resource injected by either the persistent-context cache or one-shot build.
 * A missing boundary indicates an internal build-plan wiring error rather than a project error.
 */
function requirePreviewSassBoundary(
  boundary: PreviewSassBoundary | undefined,
): PreviewSassBoundary {
  if (boundary === undefined) {
    throw new Error('React Preview could not initialize its project-scoped Sass boundary.');
  }
  return boundary;
}

/**
 * Merges resource, runtime-convention, and recoverable style roots under one build limit.
 *
 * @param directoryGroups Independent bounded directory collections produced by build adapters.
 * @returns Sorted unique watch directories for one pinned preview session.
 * @throws PreviewCompilationError when the combined graph exceeds the lightweight watcher budget.
 */
function mergePreviewWatchDirectories(
  ...directoryGroups: readonly (readonly string[])[]
): readonly string[] {
  const directories = [...new Set(directoryGroups.flat())].sort();
  if (directories.length > MAX_PREVIEW_WATCH_DIRECTORIES) {
    throw new PreviewCompilationError(
      `Preview build exceeds the ${MAX_PREVIEW_WATCH_DIRECTORIES.toString()} watch directory safety limit.`,
      [],
    );
  }
  return directories;
}
