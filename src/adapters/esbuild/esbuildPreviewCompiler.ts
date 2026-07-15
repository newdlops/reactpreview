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
import { createPreviewAssetPlugin } from './previewAssetPlugin';
import { PREVIEW_SOURCE_LOADERS } from './previewLoaderPolicy';
import { findPreviewProjectRoot } from './previewProjectRoot';
import {
  PREVIEW_ASSET_NAMESPACE,
  PREVIEW_DATA_URL_NAMESPACE,
  PREVIEW_SNAPSHOT_NAMESPACE,
  PREVIEW_TARGET_BRIDGE_NAMESPACE,
} from './previewPluginProtocol';
import { createPreviewTargetBridgePlugin } from './previewTargetBridgePlugin';
import { PreviewSourceTransformer } from './staticResources/previewSourceTransformer';
import { createWorkspaceSourcePlugin } from './workspaceSourcePlugin';

const VIRTUAL_ENTRY_NAME = '<react-preview-entry>';
const MAX_PREVIEW_OUTPUT_BYTES = 32 * 1024 * 1024;

/** esbuild-backed compiler for browser-safe React preview bundles. */
export class EsbuildPreviewCompiler implements PreviewCompiler {
  private disposed = false;
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
      const sourceTransformer = new PreviewSourceTransformer({
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
        entryNames: 'entry',
        format: 'esm',
        jsx: 'automatic',
        legalComments: 'none',
        loader: PREVIEW_SOURCE_LOADERS,
        logLevel: 'silent',
        metafile: true,
        outdir: 'react-preview-output',
        platform: 'browser',
        plugins: [
          createPreviewTargetBridgePlugin({ documentPath: request.documentPath }),
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
          }),
        ],
        sourcemap: false,
        splitting: false,
        stdin: {
          contents: createPreviewEntry(),
          loader: 'tsx',
          resolveDir: path.dirname(request.documentPath),
          sourcefile: VIRTUAL_ENTRY_NAME,
        },
        target: 'es2022',
        treeShaking: true,
        ...(request.tsconfigPath === undefined ? {} : { tsconfig: request.tsconfigPath }),
        write: false,
      });

      return createPreviewBundle(request, result, sourceTransformer.getWatchDirectories());
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
    this.shutdownPromise = stop();
    return this.shutdownPromise;
  }
}

/**
 * Converts an esbuild result into the infrastructure-independent bundle model.
 *
 * @param request Original request used to restore the custom document namespace to its file path.
 * @param result Successful esbuild result with output files and metadata enabled.
 * @returns Validated preview bundle containing one JavaScript output and optional CSS.
 */
function createPreviewBundle(
  request: PreviewBuildRequest,
  result: BuildResult<{ metafile: true; write: false }>,
  watchDirectories: readonly string[],
): PreviewBundle {
  assertOutputSize(result.outputFiles);
  const javascriptFile = findOutputFile(result.outputFiles, '.js');
  if (javascriptFile === undefined) {
    throw new PreviewCompilationError('Preview build produced no JavaScript entry.', []);
  }

  const stylesheetFile = findOutputFile(result.outputFiles, '.css');
  const baseBundle = {
    dependencies: collectDependencies(request, result.metafile),
    diagnostics: result.warnings.map((message) => convertMessage(message, 'warning')),
    javascript: javascriptFile.contents,
    watchDirectories,
  };

  return stylesheetFile === undefined
    ? baseBundle
    : { ...baseBundle, stylesheet: stylesheetFile.contents };
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
 * Finds the single emitted file matching an output extension.
 *
 * @param outputFiles Files returned by esbuild with `write: false`.
 * @param extension Output suffix such as `.js` or `.css`.
 * @returns First matching output file, or `undefined` when no such artifact was emitted.
 */
function findOutputFile(
  outputFiles: readonly OutputFile[],
  extension: string,
): OutputFile | undefined {
  return outputFiles.find((outputFile) => outputFile.path.endsWith(extension));
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

  return [...new Set(dependencies)].sort();
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
    PREVIEW_DATA_URL_NAMESPACE,
    PREVIEW_SNAPSHOT_NAMESPACE,
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
    PREVIEW_DATA_URL_NAMESPACE,
    PREVIEW_SNAPSHOT_NAMESPACE,
    PREVIEW_TARGET_BRIDGE_NAMESPACE,
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
