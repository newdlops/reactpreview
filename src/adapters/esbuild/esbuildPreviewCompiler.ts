/**
 * Implements the preview compiler port with esbuild's in-process build API.
 * It never starts `serve()` or writes into the user's project: browser artifacts remain in memory
 * until the separate artifact-store adapter publishes them under VS Code global storage.
 */
import path from 'node:path';
import {
  build,
  stop,
  type BuildFailure,
  type BuildResult,
  type Message,
  type Metafile,
  type OutputFile,
} from 'esbuild';
import type { PreviewCompiler } from '../../application/previewCompiler';
import {
  PreviewCompilationError,
  type PreviewBuildRequest,
  type PreviewBundle,
  type PreviewDiagnostic,
  type PreviewDiagnosticLocation,
} from '../../domain/preview';
import { canonicalizeExistingPath } from '../../shared/pathIdentity';
import { createPreviewEntry } from './createPreviewEntry';
import { createPreviewInspectorRootPlugin, createPreviewInspectorTargetPlugin } from './inspector';
import { createPreviewInspectorRuntimePlugin } from './pageInspector';
import { createPreviewApolloBridgePlugin } from './previewApolloBridgePlugin';
import { createPreviewAssetPlugin } from './previewAssetPlugin';
import { planPreviewBuildOutputs } from './previewBuildOutputPlanner';
import { createPreviewFormikBridgePlugin } from './previewFormikBridgePlugin';
import { createPreviewParentSlicePlugin } from './previewParentSlicePlugin';
import { createPreviewReduxBridgePlugin } from './previewReduxBridgePlugin';
import { createPreviewRouterBridgePlugin } from './previewRouterBridgePlugin';
import { PREVIEW_SOURCE_LOADERS } from './previewLoaderPolicy';
import { findPreviewProjectRoot } from './previewProjectRoot';
import { PreviewProjectUsageCache } from './previewProjectUsageCache';
import {
  PREVIEW_ASSET_NAMESPACE,
  PREVIEW_APOLLO_BRIDGE_NAMESPACE,
  PREVIEW_DATA_URL_NAMESPACE,
  PREVIEW_FORMIK_BRIDGE_NAMESPACE,
  PREVIEW_INSPECTOR_ROOT_NAMESPACE,
  PREVIEW_INSPECTOR_RUNTIME_NAMESPACE,
  PREVIEW_INSPECTOR_TARGET_NAMESPACE,
  PREVIEW_REDUX_BRIDGE_NAMESPACE,
  PREVIEW_ROUTER_BRIDGE_NAMESPACE,
  PREVIEW_SETUP_BRIDGE_NAMESPACE,
  PREVIEW_SNAPSHOT_NAMESPACE,
  PREVIEW_TARGET_BRIDGE_NAMESPACE,
  PREVIEW_THEME_BRIDGE_NAMESPACE,
  PREVIEW_THEME_CANDIDATE_NAMESPACE,
} from './previewPluginProtocol';
import {
  createPreviewRuntimeWatchInputs,
  resolvePreviewRuntimeEnvironment,
  type PreviewRuntimeEnvironment,
} from './previewRuntimeEnvironment';
import { createPreviewSetupBridgePlugin } from './previewSetupBridgePlugin';
import { PreviewSetupFallbackBoundary } from './previewSetupFallbackBoundary';
import { createPreviewTargetBridgePlugin } from './previewTargetBridgePlugin';
import { selectPreviewTargetExports, selectPreviewThemeImport } from './previewTargetExports';
import { createPreviewThemeBridgePlugin } from './previewThemeBridgePlugin';
import { createPreviewThemeCandidatePlugin } from './previewThemeCandidatePlugin';
import { PreviewSourceTransformer } from './staticResources/previewSourceTransformer';
import { createWorkspaceSourcePlugin } from './workspaceSourcePlugin';

const VIRTUAL_ENTRY_NAME = '<react-preview-entry>';
const PREVIEW_OUTPUT_DIRECTORY_NAME = 'react-preview-output';
const MAX_PREVIEW_OUTPUT_BYTES = 32 * 1024 * 1024;
const MAX_PREVIEW_WATCH_DIRECTORIES = 128;

/** Router bridge selection carried into one discovery or final esbuild attempt. */
interface PreviewRouterBuildSelection {
  /** Whether graph evidence permits a default automatic MemoryRouter wrapper. */
  readonly automaticallyWrap: boolean;
  /** Whether the project router package should be resolved into the final runtime. */
  readonly enabled: boolean;
}

/** esbuild-backed compiler for browser-safe React preview bundles. */
export class EsbuildPreviewCompiler implements PreviewCompiler {
  private disposed = false;
  /** Package-scoped inert source inventories reused by multiple tabs and hot rebuilds. */
  private readonly projectUsageCache = new PreviewProjectUsageCache();
  private shutdownPromise: Promise<void> | undefined;

  /**
   * Bundles the current editor snapshot, its dependency graph, CSS, and small binary assets.
   * Project build scripts and framework plugins are deliberately not loaded or executed.
   *
   * @param request Active editor snapshot and workspace module-resolution context.
   * @returns In-memory ESM JavaScript, optional CSS, warnings, and dependency paths.
   * @throws PreviewCompilationError when esbuild cannot parse or bundle the module graph.
   */
  public async compile(request: PreviewBuildRequest): Promise<PreviewBundle> {
    if (this.disposed) {
      throw new PreviewCompilationError('The React preview compiler is already closed.', []);
    }

    try {
      const canonicalWorkspaceRoot = canonicalizeExistingPath(request.workspaceRoot);
      const projectRoot = await findPreviewProjectRoot(
        canonicalizeExistingPath(request.documentPath),
        canonicalWorkspaceRoot,
      );
      const targetExports = selectPreviewTargetExports(request.documentPath, request.sourceText);
      const explicitTargetExportNames = targetExports.flatMap((slot) =>
        slot.kind === 'explicit' ? [slot.exportName] : [],
      );
      const inspectorExportName =
        request.renderMode === 'page-inspector'
          ? selectPreviewInspectorExport(targetExports)
          : undefined;
      const themeImport = selectPreviewThemeImport(request.sourceText);
      const usageSearchRoot =
        request.renderMode === 'page-inspector' ? canonicalWorkspaceRoot : projectRoot;
      const [runtimeEnvironment, runtimeWatchInputs] = await Promise.all([
        resolvePreviewRuntimeEnvironment({
          ...(request.setupModulePath === undefined
            ? {}
            : { configuredSetupPath: request.setupModulePath }),
          projectRoot,
          useStorybookPreview: request.useStorybookPreview ?? true,
          workspaceRoot: canonicalWorkspaceRoot,
        }),
        createPreviewRuntimeWatchInputs(projectRoot, canonicalWorkspaceRoot),
      ]);
      const targetUsageProps = await this.projectUsageCache.discover({
        climbParentSlices:
          request.renderMode !== 'page-inspector' && runtimeEnvironment.setupKind === 'none',
        documentPath: request.documentPath,
        exports: targetExports,
        ...(inspectorExportName === undefined ? {} : { inspectorExportName }),
        projectRoot: usageSearchRoot,
        snapshots: request.dependencySnapshots,
        ...(request.tsconfigPath === undefined ? {} : { tsconfigPath: request.tsconfigPath }),
        workspaceRoot: canonicalWorkspaceRoot,
      });
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
        fallbackBoundary?: PreviewSetupFallbackBoundary,
      ): Promise<{
        readonly result: BuildResult<{ metafile: true; write: false }>;
        readonly routerRequirement: ReturnType<PreviewSourceTransformer['getRouterRequirement']>;
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
          projectRoot,
          workspaceRoot: canonicalWorkspaceRoot,
        });
        const result = await build({
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
          chunkNames: 'chunks/[name]-[hash]',
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
                    originalHasDefaultExport: explicitTargetExportNames.includes('default'),
                  }),
                  createPreviewInspectorRuntimePlugin({ projectRoot }),
                ]),
            createPreviewApolloBridgePlugin({ projectRoot }),
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
                    ...(themeImport === undefined ? {} : { themeImport }),
                    usagePropsByExport: targetUsageProps.propsByExport,
                  }),
                ]
              : [
                  createPreviewInspectorRootPlugin({
                    displayName: path.basename(request.documentPath),
                    plan: inspectorPlan,
                  }),
                ]),
            ...(fallbackBoundary === undefined ? [] : [fallbackBoundary.plugin]),
            createPreviewAssetPlugin({
              documentPath: request.documentPath,
              projectRoot,
              workspaceRoot: canonicalWorkspaceRoot,
            }),
            createWorkspaceSourcePlugin({
              snapshots: [
                {
                  documentPath: request.documentPath,
                  language: request.language,
                  sourceText: request.sourceText,
                },
                ...request.dependencySnapshots,
              ],
              transformer: sourceTransformer,
              workspaceRoot: canonicalWorkspaceRoot,
            }),
          ],
          sourcemap: false,
          splitting: true,
          stdin: {
            contents: createPreviewEntry({
              documentName: createPreviewDocumentName(request),
              globalNamespaces: environment.globalNamespaces,
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
        assertOutputSize(result.outputFiles);
        return {
          result,
          routerRequirement: sourceTransformer.getRouterRequirement(),
          watchDirectories: mergePreviewWatchDirectories(
            sourceTransformer.getWatchDirectories(),
            runtimeWatchInputs.watchDirectories,
          ),
        };
      };

      /**
       * Rebuilds at most once when the actual target-rooted graph reveals a child-only router hook.
       * The discovery build keeps the optional router package out of ordinary previews; the second
       * build uses the same deterministic graph with a project-owned MemoryRouter bridge enabled.
       */
      const runAdaptiveBuild = async (
        environment: PreviewRuntimeEnvironment,
      ): ReturnType<typeof runBuild> => {
        let fallbackBoundary = createStorybookFallbackBoundary(environment);
        activeStorybookFallbackBoundary = fallbackBoundary;
        const initialBuild = await runBuild(
          environment,
          { automaticallyWrap: false, enabled: false },
          fallbackBoundary,
        );
        if (!initialBuild.routerRequirement.consumesRouter) {
          return initialBuild;
        }
        fallbackBoundary = createStorybookFallbackBoundary(environment);
        activeStorybookFallbackBoundary = fallbackBoundary;
        return runBuild(
          environment,
          {
            automaticallyWrap: !initialBuild.routerRequirement.ownsRouter,
            enabled: true,
          },
          fallbackBoundary,
        );
      };

      let buildExecution: Awaited<ReturnType<typeof runBuild>>;
      let fallbackDependencies: readonly string[] = [];
      let fallbackWatchDirectories: readonly string[] = [];
      let fallbackDiagnostics: readonly PreviewDiagnostic[] = [];
      try {
        buildExecution = await runAdaptiveBuild(runtimeEnvironment);
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
        fallbackDependencies = fallbackWatchInputs.dependencyPaths;
        fallbackWatchDirectories = fallbackWatchInputs.watchDirectories;
        fallbackDiagnostics = [
          {
            message: `Automatic Storybook preview setup was skipped because it could not be bundled: ${restorePrivateNamespaces(setupFailureMessage)}. Configure reactPreview.setupFile or add .react-preview/setup.tsx for this project.${failedFallbackBoundary.requiresManualRefresh ? ' Refresh this preview manually after fixing a missing package or alias import.' : ''}`,
            severity: 'warning',
          },
        ];
        buildExecution = await runAdaptiveBuild({
          globalNamespaces: runtimeEnvironment.globalNamespaces,
          setupKind: 'none',
        });
        buildExecution = {
          ...buildExecution,
          watchDirectories: mergePreviewWatchDirectories(
            buildExecution.watchDirectories,
            fallbackWatchDirectories,
          ),
        };
      }

      const inspectorFallbackDiagnostics: readonly PreviewDiagnostic[] =
        request.renderMode === 'page-inspector' && targetUsageProps.inspectorPlan === undefined
          ? [
              {
                message:
                  'Page Inspector could not prove an exported ancestor for this file. The direct export fallback remains interactive, but parent and sibling context is unavailable. Open a direct default/PascalCase component export or configure a preview harness if this file only re-exports unknown wildcard values.',
                severity: 'warning',
              },
            ]
          : [];
      return createPreviewBundle(
        request,
        buildExecution.result,
        buildExecution.watchDirectories,
        [...fallbackDiagnostics, ...inspectorFallbackDiagnostics],
        [
          ...runtimeWatchInputs.dependencyPaths,
          ...fallbackDependencies,
          ...targetUsageProps.dependencyPaths,
        ],
      );
    } catch (error) {
      if (error instanceof PreviewCompilationError) {
        throw error;
      }

      const diagnostics = isBuildFailure(error)
        ? error.errors.map((message) => convertMessage(message, 'error'))
        : [{ message: describeUnknownError(error), severity: 'error' as const }];
      const firstDiagnostic = diagnostics[0];
      const summary = firstDiagnostic?.message ?? 'The React module could not be bundled.';

      throw new PreviewCompilationError(`Preview build failed: ${summary}`, diagnostics, error);
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
    this.projectUsageCache.clear();
    this.shutdownPromise = stop();
    return this.shutdownPromise;
  }
}

/** Selects one stable actual-parent root while the target facade can still wrap every file export. */
function selectPreviewInspectorExport(
  slots: readonly ReturnType<typeof selectPreviewTargetExports>[number][],
): string | undefined {
  const explicitSlots = slots.filter(
    (slot): slot is Extract<(typeof slots)[number], { readonly kind: 'explicit' }> =>
      slot.kind === 'explicit',
  );
  return (
    explicitSlots.find((slot) => slot.exportName === 'default')?.exportName ??
    explicitSlots[0]?.exportName
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
 * Merges resource-macro and runtime-convention watch roots under one documented build limit.
 *
 * @param resourceDirectories Directories produced by bounded static resource expansion.
 * @param runtimeDirectories Fixed project setup, Storybook, and public convention directories.
 * @returns Sorted unique watch directories for one pinned preview session.
 * @throws PreviewCompilationError when the combined graph exceeds the lightweight watcher budget.
 */
function mergePreviewWatchDirectories(
  resourceDirectories: readonly string[],
  runtimeDirectories: readonly string[],
): readonly string[] {
  const directories = [...new Set([...resourceDirectories, ...runtimeDirectories])].sort();
  if (directories.length > MAX_PREVIEW_WATCH_DIRECTORIES) {
    throw new PreviewCompilationError(
      `Preview build exceeds the ${MAX_PREVIEW_WATCH_DIRECTORIES.toString()} watch directory safety limit.`,
      [],
    );
  }
  return directories;
}

/**
 * Converts an esbuild result into the infrastructure-independent bundle model.
 *
 * @param request Original request used to restore the custom document namespace to its file path.
 * @param result Successful esbuild result with output files and metadata enabled.
 * @param watchDirectories Static resource roots whose future additions can affect this build.
 * @param additionalDiagnostics Adapter warnings produced outside esbuild's successful result.
 * @param additionalDependencies Setup files retained after an automatic environment fallback.
 * @returns Validated preview bundle containing an entry, local lazy chunks, and optional CSS.
 */
function createPreviewBundle(
  request: PreviewBuildRequest,
  result: BuildResult<{ metafile: true; write: false }>,
  watchDirectories: readonly string[],
  additionalDiagnostics: readonly PreviewDiagnostic[] = [],
  additionalDependencies: readonly string[] = [],
): PreviewBundle {
  assertOutputSize(result.outputFiles);
  const outputPlan = planPreviewBuildOutputs({
    absoluteOutputDirectory: path.resolve(request.workspaceRoot, PREVIEW_OUTPUT_DIRECTORY_NAME),
    absoluteWorkingDirectory: request.workspaceRoot,
    metafile: result.metafile,
    outputFiles: result.outputFiles,
    virtualEntryName: VIRTUAL_ENTRY_NAME,
  });
  const baseBundle = {
    chunks: outputPlan.auxiliaryJavaScript,
    dependencies: [
      ...new Set([
        ...collectDependencies(request, result.metafile),
        ...additionalDependencies.map((dependency) => path.normalize(dependency)),
      ]),
    ].sort(),
    diagnostics: [
      ...additionalDiagnostics,
      ...result.warnings.map((message) => convertMessage(message, 'warning')),
    ],
    javascript: outputPlan.entryJavaScript,
    watchDirectories,
  };

  return outputPlan.entryStylesheet === undefined
    ? baseBundle
    : { ...baseBundle, stylesheet: outputPlan.entryStylesheet };
}

/**
 * Rejects an unexpectedly large in-memory result before it reaches global storage or the webview.
 * The asset plugin applies earlier per-file and aggregate limits; this final boundary also covers
 * generated JavaScript, CSS, and base64 expansion.
 *
 * @param outputFiles Complete in-memory output returned by esbuild.
 * @throws PreviewCompilationError when combined output exceeds the lightweight preview budget.
 */
function assertOutputSize(outputFiles: readonly OutputFile[]): void {
  const outputBytes = outputFiles.reduce(
    (totalBytes, outputFile) => totalBytes + outputFile.contents.byteLength,
    0,
  );
  if (outputBytes > MAX_PREVIEW_OUTPUT_BYTES) {
    throw new PreviewCompilationError(
      `Preview output exceeds the ${formatMebibytes(MAX_PREVIEW_OUTPUT_BYTES)} MiB safety limit.`,
      [],
    );
  }
}

/**
 * Formats a byte count as a stable mebibyte number for compiler diagnostics.
 *
 * @param bytes Integer byte limit used by an in-memory compiler boundary.
 * @returns Human-readable base-two mebibyte count without a unit suffix.
 */
function formatMebibytes(bytes: number): string {
  return (bytes / (1024 * 1024)).toString();
}

/**
 * Maps compiler metadata inputs to normalized absolute paths and removes virtual entries.
 *
 * @param request Original request containing the active path and working directory.
 * @param metafile esbuild metadata containing every bundled input module.
 * @returns Sorted unique absolute input paths.
 */
function collectDependencies(request: PreviewBuildRequest, metafile: Metafile): readonly string[] {
  const dependencies = Object.keys(metafile.inputs)
    .filter(
      (inputPath) =>
        !inputPath.startsWith('<') &&
        !inputPath.endsWith(VIRTUAL_ENTRY_NAME) &&
        !inputPath.startsWith(`${PREVIEW_APOLLO_BRIDGE_NAMESPACE}:`) &&
        !inputPath.startsWith(`${PREVIEW_FORMIK_BRIDGE_NAMESPACE}:`) &&
        !inputPath.startsWith(`${PREVIEW_INSPECTOR_ROOT_NAMESPACE}:`) &&
        !inputPath.startsWith(`${PREVIEW_INSPECTOR_RUNTIME_NAMESPACE}:`) &&
        !inputPath.startsWith(`${PREVIEW_INSPECTOR_TARGET_NAMESPACE}:`) &&
        !inputPath.startsWith(`${PREVIEW_REDUX_BRIDGE_NAMESPACE}:`) &&
        !inputPath.startsWith(`${PREVIEW_ROUTER_BRIDGE_NAMESPACE}:`) &&
        !inputPath.startsWith(`${PREVIEW_THEME_BRIDGE_NAMESPACE}:`) &&
        !inputPath.startsWith(`${PREVIEW_THEME_CANDIDATE_NAMESPACE}:`) &&
        !inputPath.startsWith(`${PREVIEW_SETUP_BRIDGE_NAMESPACE}:`) &&
        !inputPath.startsWith(`${PREVIEW_TARGET_BRIDGE_NAMESPACE}:`),
    )
    .map((inputPath) => {
      const namespacelessInput = removeFileBackedPreviewNamespace(inputPath);
      const filesystemInput = stripAssetSuffix(namespacelessInput);
      return path.normalize(
        path.isAbsolute(filesystemInput)
          ? filesystemInput
          : path.resolve(request.workspaceRoot, filesystemInput),
      );
    });

  // Preserve the editor's lexical target identity even when esbuild resolves a symlink to its real
  // path. Panel change routing listens to the URI VS Code opened, while both identities may still
  // appear for reachable imports and are harmless after set deduplication.
  return [...new Set([path.normalize(request.documentPath), ...dependencies])].sort();
}

/**
 * Removes a private file-backed namespace from an esbuild metadata input identity.
 *
 * @param inputPath Metafile key that may represent a snapshot or generated asset module.
 * @returns Underlying filesystem path with any query or fragment still attached.
 */
function removeFileBackedPreviewNamespace(inputPath: string): string {
  for (const namespace of [
    PREVIEW_ASSET_NAMESPACE,
    PREVIEW_APOLLO_BRIDGE_NAMESPACE,
    PREVIEW_DATA_URL_NAMESPACE,
    PREVIEW_FORMIK_BRIDGE_NAMESPACE,
    PREVIEW_REDUX_BRIDGE_NAMESPACE,
    PREVIEW_ROUTER_BRIDGE_NAMESPACE,
    PREVIEW_SETUP_BRIDGE_NAMESPACE,
    PREVIEW_SNAPSHOT_NAMESPACE,
    PREVIEW_THEME_BRIDGE_NAMESPACE,
  ]) {
    const prefix = `${namespace}:`;
    if (inputPath.startsWith(prefix)) {
      return inputPath.slice(prefix.length);
    }
  }

  return inputPath;
}

/**
 * Removes a query or fragment used to distinguish generated asset-module representations.
 *
 * @param assetPath Filesystem path followed by an optional import suffix.
 * @returns Filesystem path suitable for dependency watching.
 */
function stripAssetSuffix(assetPath: string): string {
  const queryIndex = assetPath.indexOf('?');
  const fragmentIndex = assetPath.indexOf('#');
  const suffixIndex = [queryIndex, fragmentIndex]
    .filter((index) => index >= 0)
    .reduce((lowest, index) => Math.min(lowest, index), assetPath.length);
  return assetPath.slice(0, suffixIndex);
}

/**
 * Converts an esbuild message into a stable domain diagnostic.
 *
 * @param message esbuild warning or error message.
 * @param severity Domain severity associated with the source collection.
 * @returns Serializable diagnostic suitable for logging or safe HTML rendering.
 */
function convertMessage(message: Message, severity: 'error' | 'warning'): PreviewDiagnostic {
  const location = convertLocation(message);
  const notes = message.notes.map(formatMessageNote);
  const baseDiagnostic = {
    message: restorePrivateNamespaces(message.text),
    severity,
  } as const;
  const diagnosticWithNotes = notes.length === 0 ? baseDiagnostic : { ...baseDiagnostic, notes };

  return location === undefined ? diagnosticWithNotes : { ...diagnosticWithNotes, location };
}

/**
 * Formats one esbuild note with its optional source location for actionable import diagnostics.
 *
 * @param note Resolver or parser context attached to a compiler message.
 * @returns Compact note text safe for the domain diagnostic model.
 */
function formatMessageNote(note: Message['notes'][number]): string {
  const location = note.location;
  if (location === null) {
    return restorePrivateNamespaces(note.text);
  }

  return `${restorePreviewFilePath(location.file)}:${location.line.toString()}:${location.column.toString()} ${restorePrivateNamespaces(note.text)}`;
}

/**
 * Extracts source coordinates from an esbuild message when they are available.
 *
 * @param message Compiler message that may contain a source location.
 * @returns Domain location or `undefined` for resolution and global errors.
 */
function convertLocation(message: Message): PreviewDiagnosticLocation | undefined {
  if (message.location === null) {
    return undefined;
  }

  return {
    column: message.location.column,
    file: restorePreviewFilePath(message.location.file),
    line: message.location.line,
  };
}

/**
 * Restores a diagnostic file identity from an internal esbuild namespace to its filesystem path.
 *
 * @param file Compiler location that may begin with a private preview namespace.
 * @returns User-facing path suitable for display and dependency change tracking.
 */
function restorePreviewFilePath(file: string): string {
  const restoredPath = restorePrivateNamespaces(file);
  return stripAssetSuffix(restoredPath);
}

/**
 * Removes private plugin namespace prefixes from compiler text without changing ordinary content.
 *
 * @param text Diagnostic message, note, or location produced by esbuild.
 * @returns Text containing only the underlying filesystem identities.
 */
function restorePrivateNamespaces(text: string): string {
  return [
    PREVIEW_ASSET_NAMESPACE,
    PREVIEW_APOLLO_BRIDGE_NAMESPACE,
    PREVIEW_DATA_URL_NAMESPACE,
    PREVIEW_FORMIK_BRIDGE_NAMESPACE,
    PREVIEW_INSPECTOR_ROOT_NAMESPACE,
    PREVIEW_INSPECTOR_RUNTIME_NAMESPACE,
    PREVIEW_INSPECTOR_TARGET_NAMESPACE,
    PREVIEW_REDUX_BRIDGE_NAMESPACE,
    PREVIEW_ROUTER_BRIDGE_NAMESPACE,
    PREVIEW_SETUP_BRIDGE_NAMESPACE,
    PREVIEW_SNAPSHOT_NAMESPACE,
    PREVIEW_TARGET_BRIDGE_NAMESPACE,
    PREVIEW_THEME_BRIDGE_NAMESPACE,
  ].reduce((restoredText, namespace) => restoredText.replaceAll(`${namespace}:`, ''), text);
}

/**
 * Narrows unknown failures to esbuild's documented build-failure shape.
 *
 * @param error Unknown value caught from the build API.
 * @returns `true` when the value exposes esbuild error and warning arrays.
 */
function isBuildFailure(error: unknown): error is BuildFailure {
  if (typeof error !== 'object' || error === null) {
    return false;
  }

  return 'errors' in error && Array.isArray(error.errors) && 'warnings' in error;
}

/**
 * Converts an arbitrary thrown value into a concise diagnostic message.
 *
 * @param error Unknown value thrown by the build API or local validation.
 * @returns Existing Error message or a safe string representation.
 */
function describeUnknownError(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
