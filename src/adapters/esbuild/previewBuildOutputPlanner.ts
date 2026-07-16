/**
 * Converts esbuild's multi-file in-memory result into the bounded browser artifacts understood by
 * React Preview. The planner performs no filesystem writes: it only joins metafile identities to
 * `OutputFile` objects, identifies the virtual entry and aggregate stylesheet, and exposes safe
 * auxiliary JavaScript paths that a later artifact-store change can publish below one revision.
 */
import path from 'node:path';
import type { Metafile, OutputFile } from 'esbuild';

const MAX_PREVIEW_OUTPUT_FILES = 128;
const JAVASCRIPT_OUTPUT_PATTERN = /\.[cm]?js$/iu;
const STYLESHEET_OUTPUT_PATTERN = /\.css$/iu;

/** One code-split JavaScript file loaded relative to the published preview entry. */
export interface PreviewAuxiliaryJavaScriptOutput {
  /** Immutable browser bytes emitted by esbuild for this chunk. */
  readonly contents: Uint8Array;
  /** Safe POSIX path below the artifact revision's dedicated `chunks` directory. */
  readonly relativePath: string;
}

/** Entry artifacts and deterministic auxiliary chunks selected from one successful build. */
export interface PreviewBuildOutputPlan {
  /** JavaScript bytes for the virtual React Preview entry point. */
  readonly entryJavaScript: Uint8Array;
  /** Optional aggregate CSS bundle associated with the virtual entry by esbuild metadata. */
  readonly entryStylesheet?: Uint8Array;
  /** Code-split JavaScript outputs sorted by their safe POSIX artifact paths. */
  readonly auxiliaryJavaScript: readonly PreviewAuxiliaryJavaScriptOutput[];
}

/** Inputs required to map esbuild's working-directory-relative metadata to absolute output files. */
export interface PreviewBuildOutputPlannerOptions {
  /** Absolute `absWorkingDir` value supplied to the corresponding esbuild invocation. */
  readonly absoluteWorkingDirectory: string;
  /** Absolute form of the build's write-disabled `outdir`. */
  readonly absoluteOutputDirectory: string;
  /** Metafile returned by the same successful esbuild invocation. */
  readonly metafile: Metafile;
  /** Complete in-memory outputs returned with `write: false`. */
  readonly outputFiles: readonly OutputFile[];
  /** Exact virtual `sourcefile` value used for the generated preview entry. */
  readonly virtualEntryName: string;
}

/** Policy or consistency error raised before any generated artifact can reach global storage. */
export class PreviewBuildOutputPlannerError extends Error {
  /** Creates an actionable output-plan failure without retaining workspace source contents. */
  public constructor(message: string) {
    super(message);
    this.name = 'PreviewBuildOutputPlannerError';
  }
}

/** Internal output file joined to its validated artifact-relative identity. */
interface PlannedOutputFile {
  /** Absolute lexical identity used to join the output with metafile metadata. */
  readonly absolutePath: string;
  /** Original esbuild bytes retained without copying. */
  readonly contents: Uint8Array;
  /** POSIX path safe for deterministic storage beneath one revision directory. */
  readonly relativePath: string;
}

/** Metafile output paired with the absolute path calculated from esbuild's working directory. */
interface PlannedMetadataOutput {
  /** Absolute lexical identity shared with the corresponding `OutputFile`. */
  readonly absolutePath: string;
  /** Original metadata used to identify entry and CSS bundle relationships. */
  readonly metadata: Metafile['outputs'][string];
  /** Unmodified POSIX key used by other metafile output references. */
  readonly metadataPath: string;
}

/**
 * Plans entry bytes and local code-split chunks from a complete esbuild result.
 *
 * Auxiliary CSS files are deliberately validated but not returned. With one browser entry,
 * esbuild's entry `cssBundle` aggregates CSS reached through both eager and dynamic imports, so the
 * presentation layer can load that stylesheet once without a runtime CSS-chunk loader. A future
 * true lazy-style implementation can extend this contract with an explicit CSS dependency map.
 *
 * @param options Output files, metadata, path roots, and virtual entry identity from one build.
 * @returns Validated entry JavaScript, optional aggregate CSS, and sorted auxiliary JS chunks.
 * @throws PreviewBuildOutputPlannerError for inconsistent metadata or unsafe artifact paths.
 */
export function planPreviewBuildOutputs(
  options: PreviewBuildOutputPlannerOptions,
): PreviewBuildOutputPlan {
  assertPlannerRoots(options.absoluteWorkingDirectory, options.absoluteOutputDirectory);
  assertOutputCount(options.outputFiles.length, 'in-memory');
  const metadataEntries = Object.entries(options.metafile.outputs);
  assertOutputCount(metadataEntries.length, 'metadata');

  const outputByIdentity = collectOutputFiles(options.outputFiles, options.absoluteOutputDirectory);
  const metadataByIdentity = collectMetadataOutputs(
    metadataEntries,
    options.absoluteWorkingDirectory,
    options.absoluteOutputDirectory,
  );
  assertCompleteOutputJoin(outputByIdentity, metadataByIdentity);

  const entryMetadata = selectEntryMetadata(metadataByIdentity, options.virtualEntryName);
  const entryOutput = requireJoinedOutput(outputByIdentity, entryMetadata);
  if (!isJavaScriptOutput(entryOutput.relativePath)) {
    throw new PreviewBuildOutputPlannerError(
      `Preview virtual entry must emit JavaScript: ${entryOutput.relativePath}`,
    );
  }

  const stylesheet = selectEntryStylesheet(
    options.metafile,
    metadataByIdentity,
    outputByIdentity,
    entryMetadata.metadata,
  );
  const auxiliaryJavaScript = [...outputByIdentity.values()]
    .filter(
      (output) =>
        output.absolutePath !== entryOutput.absolutePath && isJavaScriptOutput(output.relativePath),
    )
    .map(createAuxiliaryJavaScriptOutput)
    .sort(compareAuxiliaryOutputs);

  const basePlan = {
    auxiliaryJavaScript,
    entryJavaScript: entryOutput.contents,
  };
  return stylesheet === undefined
    ? basePlan
    : { ...basePlan, entryStylesheet: stylesheet.contents };
}

/** Validates absolute roots required for unambiguous metadata-to-file path resolution. */
function assertPlannerRoots(workingDirectory: string, outputDirectory: string): void {
  if (!path.isAbsolute(workingDirectory)) {
    throw new PreviewBuildOutputPlannerError('Preview build working directory must be absolute.');
  }
  if (!path.isAbsolute(outputDirectory)) {
    throw new PreviewBuildOutputPlannerError('Preview build output directory must be absolute.');
  }
  if (workingDirectory.includes('\0') || outputDirectory.includes('\0')) {
    throw new PreviewBuildOutputPlannerError('Preview build paths cannot contain NUL characters.');
  }
}

/** Applies the same bounded file-count policy to bytes and their metadata representation. */
function assertOutputCount(outputCount: number, source: string): void {
  if (outputCount === 0) {
    throw new PreviewBuildOutputPlannerError(`Preview build produced no ${source} output files.`);
  }
  if (outputCount > MAX_PREVIEW_OUTPUT_FILES) {
    throw new PreviewBuildOutputPlannerError(
      `Preview build produced more than ${MAX_PREVIEW_OUTPUT_FILES.toString()} ${source} output files.`,
    );
  }
}

/** Validates every in-memory file and indexes it by normalized absolute filesystem identity. */
function collectOutputFiles(
  outputFiles: readonly OutputFile[],
  outputDirectory: string,
): ReadonlyMap<string, PlannedOutputFile> {
  const outputByIdentity = new Map<string, PlannedOutputFile>();
  for (const outputFile of outputFiles) {
    const plannedOutput = planOutputFile(outputFile, outputDirectory);
    const identity = createFilesystemIdentity(plannedOutput.absolutePath);
    if (outputByIdentity.has(identity)) {
      throw new PreviewBuildOutputPlannerError(
        `Preview build contains duplicate output path: ${plannedOutput.relativePath}`,
      );
    }
    outputByIdentity.set(identity, plannedOutput);
  }
  return outputByIdentity;
}

/** Converts one absolute esbuild output path into a safe artifact-relative POSIX path. */
function planOutputFile(outputFile: OutputFile, outputDirectory: string): PlannedOutputFile {
  const outputPath = outputFile.path;
  if (outputPath.includes('\0')) {
    throw new PreviewBuildOutputPlannerError('Preview output paths cannot contain NUL characters.');
  }
  if (!path.isAbsolute(outputPath)) {
    throw new PreviewBuildOutputPlannerError(
      `Preview output file path must be absolute: ${outputPath}`,
    );
  }
  if (path.sep !== '\\' && outputPath.includes('\\')) {
    throw new PreviewBuildOutputPlannerError(
      `Preview output paths cannot contain backslashes: ${outputPath}`,
    );
  }
  if (path.normalize(outputPath) !== outputPath) {
    throw new PreviewBuildOutputPlannerError(
      `Preview output path must not contain traversal or redundant segments: ${outputPath}`,
    );
  }

  const normalizedOutputDirectory = path.normalize(outputDirectory);
  const relativeFilesystemPath = path.relative(normalizedOutputDirectory, outputPath);
  if (!isContainedRelativePath(relativeFilesystemPath)) {
    throw new PreviewBuildOutputPlannerError(
      `Preview output must stay inside its output directory: ${outputPath}`,
    );
  }
  const relativePath = relativeFilesystemPath.split(path.sep).join('/');
  assertSafePosixRelativePath(relativePath, 'output');
  assertSupportedOutputType(relativePath);
  return {
    absolutePath: path.normalize(outputPath),
    contents: outputFile.contents,
    relativePath,
  };
}

/** Validates and indexes each metafile output using the build's original working directory. */
function collectMetadataOutputs(
  metadataEntries: readonly [string, Metafile['outputs'][string]][],
  workingDirectory: string,
  outputDirectory: string,
): ReadonlyMap<string, PlannedMetadataOutput> {
  const metadataByIdentity = new Map<string, PlannedMetadataOutput>();
  for (const [metadataPath, metadata] of metadataEntries) {
    assertSafePosixRelativePath(metadataPath, 'metadata output');
    const absolutePath = path.resolve(workingDirectory, ...metadataPath.split('/'));
    const relativeToOutput = path.relative(path.normalize(outputDirectory), absolutePath);
    if (!isContainedRelativePath(relativeToOutput)) {
      throw new PreviewBuildOutputPlannerError(
        `Preview metadata output must stay inside its output directory: ${metadataPath}`,
      );
    }

    const identity = createFilesystemIdentity(absolutePath);
    if (metadataByIdentity.has(identity)) {
      throw new PreviewBuildOutputPlannerError(
        `Preview metadata contains duplicate output path: ${metadataPath}`,
      );
    }
    metadataByIdentity.set(identity, { absolutePath, metadata, metadataPath });
  }
  return metadataByIdentity;
}

/** Ensures neither esbuild result representation has lost or invented an output file. */
function assertCompleteOutputJoin(
  outputByIdentity: ReadonlyMap<string, PlannedOutputFile>,
  metadataByIdentity: ReadonlyMap<string, PlannedMetadataOutput>,
): void {
  for (const [identity, output] of outputByIdentity) {
    if (!metadataByIdentity.has(identity)) {
      throw new PreviewBuildOutputPlannerError(
        `Preview output is missing metafile metadata: ${output.relativePath}`,
      );
    }
  }
  for (const [identity, metadata] of metadataByIdentity) {
    if (!outputByIdentity.has(identity)) {
      throw new PreviewBuildOutputPlannerError(
        `Preview metafile output is missing in-memory bytes: ${metadata.metadataPath}`,
      );
    }
  }
}

/** Selects exactly one JavaScript output whose metadata points to the generated virtual entry. */
function selectEntryMetadata(
  metadataByIdentity: ReadonlyMap<string, PlannedMetadataOutput>,
  virtualEntryName: string,
): PlannedMetadataOutput {
  const candidates = [...metadataByIdentity.values()].filter(
    (output) => output.metadata.entryPoint === virtualEntryName,
  );
  if (candidates.length !== 1) {
    const emittedEntryPoints = [...metadataByIdentity.values()]
      .map((output) => output.metadata.entryPoint)
      .filter((entryPoint): entryPoint is string => entryPoint !== undefined)
      .sort();
    throw new PreviewBuildOutputPlannerError(
      `Preview build must contain exactly one output for virtual entry ${JSON.stringify(virtualEntryName)}; found ${candidates.length.toString()} among ${JSON.stringify(emittedEntryPoints)}.`,
    );
  }
  const entry = candidates[0];
  if (entry === undefined) {
    throw new PreviewBuildOutputPlannerError('Preview build produced no virtual entry output.');
  }
  return entry;
}

/** Returns the in-memory output paired with one already validated metadata output. */
function requireJoinedOutput(
  outputByIdentity: ReadonlyMap<string, PlannedOutputFile>,
  metadataOutput: PlannedMetadataOutput,
): PlannedOutputFile {
  const output = outputByIdentity.get(createFilesystemIdentity(metadataOutput.absolutePath));
  if (output === undefined) {
    throw new PreviewBuildOutputPlannerError(
      `Preview metafile output is missing in-memory bytes: ${metadataOutput.metadataPath}`,
    );
  }
  return output;
}

/** Resolves the entry metadata's optional aggregate CSS bundle to validated in-memory bytes. */
function selectEntryStylesheet(
  metafile: Metafile,
  metadataByIdentity: ReadonlyMap<string, PlannedMetadataOutput>,
  outputByIdentity: ReadonlyMap<string, PlannedOutputFile>,
  entryMetadata: Metafile['outputs'][string],
): PlannedOutputFile | undefined {
  const stylesheetMetadataPath = entryMetadata.cssBundle;
  if (stylesheetMetadataPath === undefined) {
    return undefined;
  }
  const stylesheetMetadata = metafile.outputs[stylesheetMetadataPath];
  if (stylesheetMetadata === undefined) {
    throw new PreviewBuildOutputPlannerError(
      `Preview entry stylesheet is missing metafile metadata: ${stylesheetMetadataPath}`,
    );
  }
  const plannedMetadata = [...metadataByIdentity.values()].find(
    (output) => output.metadataPath === stylesheetMetadataPath,
  );
  if (plannedMetadata === undefined) {
    throw new PreviewBuildOutputPlannerError(
      `Preview entry stylesheet metadata path is invalid: ${stylesheetMetadataPath}`,
    );
  }
  const stylesheet = requireJoinedOutput(outputByIdentity, plannedMetadata);
  if (!STYLESHEET_OUTPUT_PATTERN.test(stylesheet.relativePath)) {
    throw new PreviewBuildOutputPlannerError(
      `Preview entry cssBundle must reference a CSS output: ${stylesheet.relativePath}`,
    );
  }
  return stylesheet;
}

/** Converts a validated non-entry JavaScript output into the public auxiliary chunk shape. */
function createAuxiliaryJavaScriptOutput(
  output: PlannedOutputFile,
): PreviewAuxiliaryJavaScriptOutput {
  if (!output.relativePath.startsWith('chunks/') || output.relativePath === 'chunks/') {
    throw new PreviewBuildOutputPlannerError(
      `Preview auxiliary JavaScript must be emitted below chunks/: ${output.relativePath}`,
    );
  }
  return { contents: output.contents, relativePath: output.relativePath };
}

/** Orders chunk paths by Unicode code point comparison without depending on process locale. */
function compareAuxiliaryOutputs(
  left: PreviewAuxiliaryJavaScriptOutput,
  right: PreviewAuxiliaryJavaScriptOutput,
): number {
  return left.relativePath < right.relativePath
    ? -1
    : left.relativePath > right.relativePath
      ? 1
      : 0;
}

/** Rejects absolute, backslash, traversal, redundant, empty, and NUL-containing POSIX paths. */
function assertSafePosixRelativePath(candidatePath: string, description: string): void {
  if (
    candidatePath.length === 0 ||
    candidatePath.includes('\0') ||
    candidatePath.includes('\\') ||
    path.posix.isAbsolute(candidatePath) ||
    path.win32.isAbsolute(candidatePath) ||
    path.posix.normalize(candidatePath) !== candidatePath ||
    candidatePath.split('/').some((segment) => segment.length === 0 || segment === '..')
  ) {
    throw new PreviewBuildOutputPlannerError(
      `Preview ${description} path must be a safe POSIX relative path: ${candidatePath}`,
    );
  }
}

/** Rejects artifact types the current multi-file store contract would otherwise silently omit. */
function assertSupportedOutputType(relativePath: string): void {
  if (!isJavaScriptOutput(relativePath) && !STYLESHEET_OUTPUT_PATTERN.test(relativePath)) {
    throw new PreviewBuildOutputPlannerError(
      `Preview build emitted an unsupported output type: ${relativePath}`,
    );
  }
}

/** Reports whether a path produced by `path.relative` remains inside the selected output root. */
function isContainedRelativePath(relativePath: string): boolean {
  return (
    relativePath.length > 0 &&
    relativePath !== '..' &&
    !relativePath.startsWith(`..${path.sep}`) &&
    !path.isAbsolute(relativePath)
  );
}

/** Gives case-insensitive Windows paths the same duplicate-detection behavior as the filesystem. */
function createFilesystemIdentity(absolutePath: string): string {
  const normalizedPath = path.normalize(absolutePath);
  return process.platform === 'win32' ? normalizedPath.toLowerCase() : normalizedPath;
}

/** Reports whether an output filename can be loaded as a browser JavaScript module. */
function isJavaScriptOutput(relativePath: string): boolean {
  return JAVASCRIPT_OUTPUT_PATTERN.test(relativePath);
}
