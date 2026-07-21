/**
 * Converts esbuild's infrastructure-specific output into the stable preview bundle domain model.
 * Keeping output validation, dependency recovery, and diagnostic restoration at this boundary lets
 * the compiler focus on build planning while every caller receives the same safety guarantees.
 */
import path from 'node:path';
import type { BuildFailure, BuildResult, Message, Metafile, OutputFile } from 'esbuild';
import {
  PreviewCompilationError,
  type PreviewBuildRequest,
  type PreviewBundle,
  type PreviewDiagnostic,
  type PreviewDiagnosticLocation,
} from '../../domain/preview';
import {
  MAX_PREVIEW_OUTPUT_MEBIBYTES,
  normalizePreviewOutputMebibytes,
  resolvePreviewOutputLimitBytes,
} from '../../domain/previewOutputPolicy';
import { planPreviewBuildOutputs } from './previewBuildOutputPlanner';
import {
  PREVIEW_ASSET_NAMESPACE,
  PREVIEW_APOLLO_BRIDGE_NAMESPACE,
  PREVIEW_CONTEXT_BRIDGE_NAMESPACE,
  PREVIEW_DATA_URL_NAMESPACE,
  PREVIEW_FORMIK_BRIDGE_NAMESPACE,
  PREVIEW_GLOBAL_PACKAGE_BRIDGE_NAMESPACE,
  PREVIEW_INSPECTOR_ROOT_NAMESPACE,
  PREVIEW_INSPECTOR_RUNTIME_NAMESPACE,
  PREVIEW_INSPECTOR_TARGET_NAMESPACE,
  PREVIEW_NODE_BUILTIN_NAMESPACE,
  PREVIEW_REDUX_BRIDGE_NAMESPACE,
  PREVIEW_ROUTER_BRIDGE_NAMESPACE,
  PREVIEW_SETUP_BRIDGE_NAMESPACE,
  PREVIEW_SNAPSHOT_NAMESPACE,
  PREVIEW_TARGET_BRIDGE_NAMESPACE,
  PREVIEW_THEME_BRIDGE_NAMESPACE,
  PREVIEW_THEME_CANDIDATE_NAMESPACE,
} from './previewPluginProtocol';

/** Virtual source name used to locate the generated browser entry in esbuild metadata. */
export const VIRTUAL_ENTRY_NAME = '<react-preview-entry>';

/** Stable synthetic output root shared by esbuild options and output-plan validation. */
export const PREVIEW_OUTPUT_DIRECTORY_NAME = 'react-preview-output';

/**
 * Converts an esbuild result into the infrastructure-independent bundle model.
 *
 * @param request Original request used to restore the custom document namespace to its file path.
 * @param result Successful esbuild result with output files and metadata enabled.
 * @param watchDirectories Static resource roots whose future additions can affect this build.
 * @param additionalDiagnostics Adapter warnings produced outside esbuild's successful result.
 * @param additionalDependencies Setup files retained after an automatic environment fallback.
 * @param admitBuildWarning Compiler-lifetime admission boundary that suppresses hot-rebuild repeats.
 * @returns Validated preview bundle containing an entry, local lazy chunks, and optional CSS.
 */
export function createPreviewBundle(
  request: PreviewBuildRequest,
  result: BuildResult<{ metafile: true; write: false }>,
  watchDirectories: readonly string[],
  additionalDiagnostics: readonly PreviewDiagnostic[] = [],
  additionalDependencies: readonly string[] = [],
  admitBuildWarning: (message: Message) => boolean = () => true,
): PreviewBundle {
  assertOutputSize(result.outputFiles, request.maxOutputMebibytes);
  const outputPlan = planPreviewBuildOutputs({
    absoluteOutputDirectory: path.resolve(request.workspaceRoot, PREVIEW_OUTPUT_DIRECTORY_NAME),
    absoluteWorkingDirectory: request.workspaceRoot,
    metafile: result.metafile,
    outputFiles: result.outputFiles,
    virtualEntryName: VIRTUAL_ENTRY_NAME,
  });
  const baseBundle = {
    chunks: [...outputPlan.auxiliaryJavaScript, ...outputPlan.auxiliaryStylesheets].sort(
      (left, right) => left.relativePath.localeCompare(right.relativePath),
    ),
    dependencies: [
      ...new Set([
        ...collectDependencies(request, result.metafile),
        ...additionalDependencies.map((dependency) => path.normalize(dependency)),
      ]),
    ].sort(),
    diagnostics: [
      ...additionalDiagnostics,
      ...result.warnings
        .filter(admitBuildWarning)
        .map((message) => convertMessage(message, 'warning')),
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
 * @param configuredMebibytes Optional resource-scoped user limit, normalized to the safe range.
 * @throws PreviewCompilationError when combined output exceeds the configured local budget.
 */
export function assertOutputSize(
  outputFiles: readonly OutputFile[],
  configuredMebibytes?: number,
): void {
  const outputBytes = outputFiles.reduce(
    (totalBytes, outputFile) => totalBytes + outputFile.contents.byteLength,
    0,
  );
  const outputLimitMebibytes = normalizePreviewOutputMebibytes(configuredMebibytes);
  const outputLimitBytes = resolvePreviewOutputLimitBytes(outputLimitMebibytes);
  if (outputBytes > outputLimitBytes) {
    throw new PreviewCompilationError(
      `Preview output is ${formatMebibytes(outputBytes)} MiB and exceeds the configured ${outputLimitMebibytes.toString()} MiB limit. Increase reactPreview.maxOutputSizeMiB up to ${MAX_PREVIEW_OUTPUT_MEBIBYTES.toString()} MiB, or narrow the rendered page graph.`,
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
  const mebibytes = bytes / (1024 * 1024);
  const roundedUpMebibytes = Math.ceil(mebibytes * 10) / 10;
  return Number.isInteger(roundedUpMebibytes)
    ? roundedUpMebibytes.toString()
    : roundedUpMebibytes.toFixed(1);
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
        !inputPath.startsWith(`${PREVIEW_CONTEXT_BRIDGE_NAMESPACE}:`) &&
        !inputPath.startsWith(`${PREVIEW_FORMIK_BRIDGE_NAMESPACE}:`) &&
        !inputPath.startsWith(`${PREVIEW_GLOBAL_PACKAGE_BRIDGE_NAMESPACE}:`) &&
        !inputPath.startsWith(`${PREVIEW_INSPECTOR_ROOT_NAMESPACE}:`) &&
        !inputPath.startsWith(`${PREVIEW_INSPECTOR_RUNTIME_NAMESPACE}:`) &&
        !inputPath.startsWith(`${PREVIEW_INSPECTOR_TARGET_NAMESPACE}:`) &&
        !inputPath.startsWith(`${PREVIEW_NODE_BUILTIN_NAMESPACE}:`) &&
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
    PREVIEW_CONTEXT_BRIDGE_NAMESPACE,
    PREVIEW_DATA_URL_NAMESPACE,
    PREVIEW_FORMIK_BRIDGE_NAMESPACE,
    PREVIEW_NODE_BUILTIN_NAMESPACE,
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
export function convertMessage(message: Message, severity: 'error' | 'warning'): PreviewDiagnostic {
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
export function restorePrivateNamespaces(text: string): string {
  return [
    PREVIEW_ASSET_NAMESPACE,
    PREVIEW_APOLLO_BRIDGE_NAMESPACE,
    PREVIEW_DATA_URL_NAMESPACE,
    PREVIEW_FORMIK_BRIDGE_NAMESPACE,
    PREVIEW_INSPECTOR_ROOT_NAMESPACE,
    PREVIEW_INSPECTOR_RUNTIME_NAMESPACE,
    PREVIEW_INSPECTOR_TARGET_NAMESPACE,
    PREVIEW_NODE_BUILTIN_NAMESPACE,
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
export function isBuildFailure(error: unknown): error is BuildFailure {
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
export function describeUnknownError(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
