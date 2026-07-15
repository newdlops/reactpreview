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
  type Loader,
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
import { createOpenDocumentPlugin, OPEN_DOCUMENT_NAMESPACE } from './openDocumentPlugin';
import { createPreviewEntry } from './createPreviewEntry';

const FILE_LOADERS = {
  '.module.css': 'local-css',
  '.avif': 'dataurl',
  '.gif': 'dataurl',
  '.jpeg': 'dataurl',
  '.jpg': 'dataurl',
  '.png': 'dataurl',
  '.svg': 'dataurl',
  '.ttf': 'dataurl',
  '.webp': 'dataurl',
  '.woff': 'dataurl',
  '.woff2': 'dataurl',
} as const satisfies Readonly<Record<string, Loader>>;

const VIRTUAL_ENTRY_NAME = '<react-preview-entry>';

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
      const result = await build({
        absWorkingDir: request.workspaceRoot,
        bundle: true,
        charset: 'utf8',
        define: {
          'process.env.NODE_ENV': '"development"',
        },
        entryNames: 'entry',
        format: 'esm',
        jsx: 'automatic',
        legalComments: 'none',
        loader: FILE_LOADERS,
        logLevel: 'silent',
        metafile: true,
        outdir: 'react-preview-output',
        platform: 'browser',
        plugins: [
          createOpenDocumentPlugin({
            documentPath: request.documentPath,
            loader: request.language,
            sourceText: request.sourceText,
          }),
        ],
        sourcemap: false,
        splitting: false,
        stdin: {
          contents: createPreviewEntry(request.documentPath),
          loader: 'tsx',
          resolveDir: path.dirname(request.documentPath),
          sourcefile: VIRTUAL_ENTRY_NAME,
        },
        target: 'es2022',
        treeShaking: true,
        write: false,
      });

      return createPreviewBundle(request, result);
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
): PreviewBundle {
  const javascriptFile = findOutputFile(result.outputFiles, '.js');
  if (javascriptFile === undefined) {
    throw new PreviewCompilationError('Preview build produced no JavaScript entry.', []);
  }

  const stylesheetFile = findOutputFile(result.outputFiles, '.css');
  const baseBundle = {
    dependencies: collectDependencies(request, result.metafile),
    diagnostics: result.warnings.map((message) => convertMessage(message, 'warning')),
    javascript: javascriptFile.contents,
  };

  return stylesheetFile === undefined
    ? baseBundle
    : { ...baseBundle, stylesheet: stylesheetFile.contents };
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
  const openDocumentPrefix = `${OPEN_DOCUMENT_NAMESPACE}:`;
  const dependencies = Object.keys(metafile.inputs)
    .filter((inputPath) => !inputPath.startsWith('<') && !inputPath.endsWith(VIRTUAL_ENTRY_NAME))
    .map((inputPath) => {
      if (inputPath.startsWith(openDocumentPrefix)) {
        return path.normalize(request.documentPath);
      }

      return path.normalize(
        path.isAbsolute(inputPath) ? inputPath : path.resolve(request.workspaceRoot, inputPath),
      );
    });

  return [...new Set(dependencies)].sort();
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
  const baseDiagnostic = {
    message: message.text,
    severity,
  } as const;

  return location === undefined ? baseDiagnostic : { ...baseDiagnostic, location };
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
    file: message.location.file,
    line: message.location.line,
  };
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
