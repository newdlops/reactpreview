/**
 * Discovers opt-in preview setup modules and inert global namespace declarations near a project.
 * Discovery is deliberately filesystem-only: project HTML, Storybook configuration, and setup
 * modules are never imported or evaluated here. Every executable setup path is canonicalized and
 * confined to the trusted VS Code workspace before it can be returned to the compiler.
 */
import { open, realpath, stat } from 'node:fs/promises';
import path from 'node:path';
import { PreviewCompilationError } from '../../domain/preview';
import { normalizeLexicalPath } from '../../shared/pathIdentity';

/** Maximum prefix read from any one convention file during inert namespace discovery. */
export const MAX_RUNTIME_DISCOVERY_FILE_BYTES = 1024 * 1024;

/** Maximum unique top-level namespaces admitted into one generated runtime prelude. */
export const MAX_RUNTIME_GLOBAL_NAMESPACES = 128;

const STORYBOOK_PREVIEW_EXTENSIONS = [
  'tsx',
  'ts',
  'jsx',
  'js',
  'mts',
  'mjs',
  'cts',
  'cjs',
] as const;
const PROJECT_SETUP_EXTENSIONS = ['tsx', 'ts', 'jsx', 'js', 'mts', 'mjs', 'cts', 'cjs'] as const;
const STORYBOOK_MAIN_EXTENSIONS = ['ts', 'tsx', 'js', 'jsx', 'mts', 'mjs', 'cts', 'cjs'] as const;
const SETUP_MODULE_EXTENSIONS = new Set([
  '.cjs',
  '.cts',
  '.js',
  '.jsx',
  '.mjs',
  '.mts',
  '.ts',
  '.tsx',
]);
const UNSAFE_NAMESPACE_NAMES = new Set([
  '__proto__',
  'closed',
  'constructor',
  'document',
  'frames',
  'global',
  'globalThis',
  'history',
  'Infinity',
  'length',
  'location',
  'NaN',
  'name',
  'navigator',
  'opener',
  'parent',
  'prototype',
  'self',
  'top',
  'undefined',
  'window',
]);
const GLOBAL_NAMESPACE_ASSIGNMENT =
  /\b(window|globalThis)\s*\.\s*([A-Za-z_$][A-Za-z0-9_$]*)\s*(?:=\s*\1\s*\.\s*\2\s*(?:\|\||\?\?)\s*\{\s*\}|(?:=|\|\|=|\?\?=)\s*\{\s*\})/g;

/** Input paths and policy flags used for one runtime-environment discovery pass. */
export interface PreviewRuntimeEnvironmentOptions {
  /** Optional workspace-relative or absolute setup module explicitly selected by the user. */
  readonly configuredSetupPath?: string;
  /** Nearest package directory whose public and Storybook conventions should be inspected. */
  readonly projectRoot: string;
  /** Canonical security boundary supplied by the selected VS Code workspace folder. */
  readonly workspaceRoot: string;
  /** Whether a conventional Storybook preview module may be used when no custom setup is set. */
  readonly useStorybookPreview: boolean;
}

/** Safe, deterministic runtime metadata that can be consumed by a later entry generator. */
export interface PreviewRuntimeEnvironment {
  /** Names declared through an empty-object global namespace initializer in bounded source text. */
  readonly globalNamespaces: readonly string[];
  /** Canonical setup module path, omitted when no setup convention was selected. */
  readonly setupModulePath?: string;
  /** Explains whether setup was explicitly configured, conventionally discovered, or absent. */
  readonly setupKind: 'none' | 'custom' | 'storybook';
}

/** Fixed convention paths that must remain observable after one successful compilation. */
export interface PreviewRuntimeWatchInputs {
  /** Existing or future convention files whose save can change runtime setup selection or globals. */
  readonly dependencyPaths: readonly string[];
  /** Narrow convention directories watched for files created outside an open VS Code editor. */
  readonly watchDirectories: readonly string[];
}

/**
 * Enumerates bounded convention identities without reading or executing any project file.
 * Nonexistent candidates are intentional: an editor save at one of these exact paths must rebuild a
 * panel that previously had no setup, while existing setup directories cover external creates.
 *
 * @param projectRoot Nearest package root selected for the preview target.
 * @param workspaceRoot Canonical security boundary for candidates and recursive watchers.
 * @returns Stable absolute candidate paths and convention watch directories.
 */
export async function createPreviewRuntimeWatchInputs(
  projectRoot: string,
  workspaceRoot: string,
): Promise<PreviewRuntimeWatchInputs> {
  const normalizedProjectRoot = normalizeLexicalPath(path.resolve(projectRoot));
  const canonicalWorkspaceRoot = normalizeLexicalPath(await realpath(workspaceRoot));
  const watchCandidates = [
    path.join(normalizedProjectRoot, '.react-preview'),
    path.join(normalizedProjectRoot, '.storybook'),
  ];
  const watchDirectories = (
    await Promise.all(
      watchCandidates.map(async (candidate) =>
        resolveOptionalSafeWatchDirectory(candidate, canonicalWorkspaceRoot),
      ),
    )
  ).filter((candidate): candidate is string => candidate !== undefined);
  const dependencyCandidates = [
    ...createProjectSetupCandidatePaths(normalizedProjectRoot),
    ...createStorybookPreviewCandidatePaths(normalizedProjectRoot),
    ...createRuntimeMetadataPaths(normalizedProjectRoot),
  ];
  const dependencyPaths = (
    await Promise.all(
      dependencyCandidates.map(async (candidate) =>
        resolveSafeConventionDependency(candidate, canonicalWorkspaceRoot),
      ),
    )
  ).filter((candidate): candidate is string => candidate !== undefined);
  return {
    dependencyPaths: [...new Set(dependencyPaths)],
    watchDirectories,
  };
}

/**
 * Keeps existing files and future lexical candidates only when their canonical location or nearest
 * existing parent remains in the trusted workspace. Existing safe files use canonical identity;
 * missing candidates keep their lexical path so a first editor save can match the panel graph.
 */
async function resolveSafeConventionDependency(
  filePath: string,
  workspaceRoot: string,
): Promise<string | undefined> {
  try {
    const canonicalFile = normalizeLexicalPath(await realpath(filePath));
    return (await stat(canonicalFile)).isFile() && isPathInside(workspaceRoot, canonicalFile)
      ? canonicalFile
      : undefined;
  } catch (error) {
    if (!isMissingPathError(error)) {
      throw createRuntimeError(
        `Preview convention path could not be inspected: ${filePath}`,
        error,
      );
    }
  }

  let parentDirectory = path.dirname(filePath);
  let reachedFilesystemRoot = false;
  while (!reachedFilesystemRoot) {
    try {
      const canonicalParent = normalizeLexicalPath(await realpath(parentDirectory));
      return isPathInside(workspaceRoot, canonicalParent)
        ? normalizeLexicalPath(filePath)
        : undefined;
    } catch (error) {
      if (!isMissingPathError(error)) {
        throw createRuntimeError(
          `Preview convention parent could not be inspected: ${parentDirectory}`,
          error,
        );
      }
    }

    const nextParent = path.dirname(parentDirectory);
    reachedFilesystemRoot = nextParent === parentDirectory;
    parentDirectory = nextParent;
  }
  return undefined;
}

/**
 * Admits only an existing regular directory whose canonical target remains in the workspace.
 * Missing convention directories are still represented by exact dependency candidates, but are not
 * watched broadly because a later symlink could otherwise redirect a recursive watcher externally.
 */
async function resolveOptionalSafeWatchDirectory(
  directoryPath: string,
  workspaceRoot: string,
): Promise<string | undefined> {
  try {
    const canonicalDirectory = normalizeLexicalPath(await realpath(directoryPath));
    if (!(await stat(canonicalDirectory)).isDirectory()) {
      return undefined;
    }
    return isPathInside(workspaceRoot, canonicalDirectory) ? canonicalDirectory : undefined;
  } catch (error) {
    if (isMissingPathError(error)) {
      return undefined;
    }
    throw createRuntimeError(
      `Preview convention directory could not be inspected: ${directoryPath}`,
      error,
    );
  }
}

/**
 * Resolves a trusted setup module and scans bounded convention files for namespace initializers.
 * A non-empty explicit setup always takes precedence over Storybook auto-discovery. Relative
 * explicit paths are interpreted from the workspace root, matching VS Code resource settings.
 *
 * @param options Trusted roots, optional setup path, and Storybook discovery policy.
 * @returns Canonical setup metadata plus sorted, unique global namespace names.
 * @throws PreviewCompilationError when a trusted root or selected setup is invalid or unreadable.
 */
export async function resolvePreviewRuntimeEnvironment(
  options: PreviewRuntimeEnvironmentOptions,
): Promise<PreviewRuntimeEnvironment> {
  const canonicalWorkspaceRoot = await resolveRequiredDirectory(
    options.workspaceRoot,
    'Preview workspace root',
  );
  const canonicalProjectRoot = await resolveRequiredDirectory(
    options.projectRoot,
    'Preview project root',
  );
  assertInsideWorkspace(canonicalWorkspaceRoot, canonicalProjectRoot, 'Preview project root');

  const setup = await resolveSetupModule(options, canonicalProjectRoot, canonicalWorkspaceRoot);
  const globalNamespaces = await discoverGlobalNamespaces(
    canonicalProjectRoot,
    canonicalWorkspaceRoot,
  );

  return setup.setupModulePath === undefined
    ? { globalNamespaces, setupKind: setup.setupKind }
    : {
        globalNamespaces,
        setupKind: setup.setupKind,
        setupModulePath: setup.setupModulePath,
      };
}

/**
 * Applies explicit-path and project-setup precedence before probing Storybook preview filenames.
 *
 * @param options Original discovery options containing custom and automatic setup preferences.
 * @param projectRoot Canonical project directory containing an optional `.storybook` folder.
 * @param workspaceRoot Canonical workspace boundary for every executable setup file.
 * @returns Setup kind and canonical module path when one is selected.
 */
async function resolveSetupModule(
  options: PreviewRuntimeEnvironmentOptions,
  projectRoot: string,
  workspaceRoot: string,
): Promise<Pick<PreviewRuntimeEnvironment, 'setupKind' | 'setupModulePath'>> {
  const configuredSetupPath = options.configuredSetupPath?.trim();
  if (configuredSetupPath !== undefined && configuredSetupPath.length > 0) {
    const absoluteSetupPath = path.isAbsolute(configuredSetupPath)
      ? configuredSetupPath
      : path.resolve(workspaceRoot, configuredSetupPath);
    return {
      setupKind: 'custom',
      setupModulePath: await resolveRequiredSetupModule(absoluteSetupPath, workspaceRoot, 'Custom'),
    };
  }

  for (const candidatePath of createProjectSetupCandidatePaths(projectRoot)) {
    const candidate = await resolveOptionalRegularFile(candidatePath);
    if (candidate !== undefined) {
      assertInsideWorkspace(workspaceRoot, candidate, 'Project preview setup');
      return { setupKind: 'custom', setupModulePath: candidate };
    }
  }

  if (options.useStorybookPreview) {
    for (const candidatePath of createStorybookPreviewCandidatePaths(projectRoot)) {
      const candidate = await resolveOptionalRegularFile(candidatePath);
      if (candidate !== undefined) {
        assertInsideWorkspace(workspaceRoot, candidate, 'Storybook preview module');
        return { setupKind: 'storybook', setupModulePath: candidate };
      }
    }
  }

  return { setupKind: 'none' };
}

/**
 * Validates an explicitly selected setup without executing it or accepting non-source formats.
 *
 * @param setupPath Absolute lexical path supplied by configuration or convention.
 * @param workspaceRoot Canonical directory that must contain the setup after following symlinks.
 * @param setupLabel Human-readable setup kind used in diagnostics.
 * @returns Canonical regular-file path suitable for a later esbuild import.
 * @throws PreviewCompilationError when the path is missing, unsupported, non-file, or out of bounds.
 */
async function resolveRequiredSetupModule(
  setupPath: string,
  workspaceRoot: string,
  setupLabel: string,
): Promise<string> {
  if (!SETUP_MODULE_EXTENSIONS.has(path.extname(setupPath).toLowerCase())) {
    throw createRuntimeError(
      `${setupLabel} preview setup must be a JavaScript or TypeScript module: ${setupPath}`,
    );
  }

  let canonicalSetupPath: string;
  try {
    canonicalSetupPath = normalizeLexicalPath(await realpath(setupPath));
  } catch (error) {
    if (isMissingPathError(error)) {
      throw createRuntimeError(`${setupLabel} preview setup does not exist: ${setupPath}`, error);
    }
    throw createRuntimeError(
      `${setupLabel} preview setup could not be resolved: ${setupPath}`,
      error,
    );
  }

  assertInsideWorkspace(workspaceRoot, canonicalSetupPath, `${setupLabel} preview setup`);
  try {
    if (!(await stat(canonicalSetupPath)).isFile()) {
      throw createRuntimeError(`${setupLabel} preview setup must be a regular file: ${setupPath}`);
    }
  } catch (error) {
    if (error instanceof PreviewCompilationError) {
      throw error;
    }
    throw createRuntimeError(
      `${setupLabel} preview setup could not be inspected: ${setupPath}`,
      error,
    );
  }
  return canonicalSetupPath;
}

/**
 * Collects namespaces from known inert convention files without interpreting their configuration.
 * Source prefixes are scanned in stable path order, then names are deduplicated and sorted.
 *
 * @param projectRoot Canonical project directory used to construct fixed convention paths.
 * @param workspaceRoot Canonical boundary preventing discovery reads through external symlinks.
 * @returns Sorted unique namespace names safe to use with dot-property syntax.
 */
async function discoverGlobalNamespaces(
  projectRoot: string,
  workspaceRoot: string,
): Promise<readonly string[]> {
  const sourcePaths = createRuntimeMetadataPaths(projectRoot);
  const namespaces = new Set<string>();

  for (const sourcePath of sourcePaths) {
    const sourceText = await readOptionalBoundedSource(sourcePath, workspaceRoot);
    if (sourceText === undefined) {
      continue;
    }
    for (const namespaceName of extractGlobalNamespaces(sourceText)) {
      if (!namespaces.has(namespaceName) && namespaces.size >= MAX_RUNTIME_GLOBAL_NAMESPACES) {
        throw createRuntimeError(
          `Preview runtime metadata exceeds the ${MAX_RUNTIME_GLOBAL_NAMESPACES.toString()} namespace safety limit.`,
        );
      }
      namespaces.add(namespaceName);
    }
  }

  return [...namespaces].sort();
}

/** Creates conventional project-owned setup candidates in deterministic extension order. */
function createProjectSetupCandidatePaths(projectRoot: string): readonly string[] {
  return PROJECT_SETUP_EXTENSIONS.map((extension) =>
    path.join(projectRoot, '.react-preview', `setup.${extension}`),
  );
}

/** Creates conventional Storybook preview candidates in deterministic extension order. */
function createStorybookPreviewCandidatePaths(projectRoot: string): readonly string[] {
  return STORYBOOK_PREVIEW_EXTENSIONS.map((extension) =>
    path.join(projectRoot, '.storybook', `preview.${extension}`),
  );
}

/** Creates fixed inert HTML and Storybook-main paths used only for namespace text discovery. */
function createRuntimeMetadataPaths(projectRoot: string): readonly string[] {
  return [
    path.join(projectRoot, 'public', 'index.html'),
    path.join(projectRoot, 'index.html'),
    ...STORYBOOK_MAIN_EXTENSIONS.map((extension) =>
      path.join(projectRoot, '.storybook', `main.${extension}`),
    ),
  ];
}

/**
 * Extracts only empty-object namespace initialization names from inert source text. The surrounding
 * HTML, strings, template literals, and configuration remain opaque text and are never evaluated or
 * returned. Matching both backreferences prevents mismatched globals from being accepted.
 *
 * @param sourceText Bounded source prefix read from a fixed convention path.
 * @returns Namespace names in source order, excluding prototype-sensitive property names.
 */
function extractGlobalNamespaces(sourceText: string): readonly string[] {
  const namespaces: string[] = [];
  const searchableSource = maskSourceComments(sourceText);
  GLOBAL_NAMESPACE_ASSIGNMENT.lastIndex = 0;
  for (const match of searchableSource.matchAll(GLOBAL_NAMESPACE_ASSIGNMENT)) {
    const namespaceName = match[2];
    if (namespaceName === undefined || UNSAFE_NAMESPACE_NAMES.has(namespaceName)) {
      continue;
    }
    if (hasUnsafeNamespacePrefix(searchableSource, match.index)) {
      continue;
    }
    namespaces.push(namespaceName);
  }
  return namespaces;
}

/**
 * Replaces JavaScript and HTML comments with spaces while preserving quoted preview-head scripts.
 * The output has exactly the same length as the input so regex match offsets remain meaningful.
 * This is intentionally a bounded lexical filter rather than a project-code parser: it recognizes
 * escapes in ordinary strings and template literals but never evaluates their contents.
 *
 * @param sourceText Bounded inert source prefix read from a fixed convention file.
 * @returns Equal-length source with line, block, and HTML comment bodies hidden from discovery.
 */
function maskSourceComments(sourceText: string): string {
  const characters = sourceText.split('');
  let quote: '"' | "'" | '`' | undefined;
  for (let index = 0; index < characters.length; index += 1) {
    const character = characters[index];
    const nextCharacter = characters[index + 1];
    if (quote !== undefined) {
      if (character === '\\') {
        index += 1;
      } else if (character === quote) {
        quote = undefined;
      }
      continue;
    }
    if (character === '"' || character === "'" || character === '`') {
      quote = character;
      continue;
    }
    if (character === '/' && nextCharacter === '/') {
      index = maskCommentUntil(characters, index, '\n');
      continue;
    }
    if (character === '/' && nextCharacter === '*') {
      index = maskDelimitedComment(characters, index, '*/');
      continue;
    }
    if (sourceText.startsWith('<!--', index)) {
      index = maskDelimitedComment(characters, index, '-->');
    }
  }
  return characters.join('');
}

/** Masks one line comment and returns the newline index retained for source-coordinate stability. */
function maskCommentUntil(characters: string[], startIndex: number, terminator: string): number {
  let index = startIndex;
  while (index < characters.length && characters[index] !== terminator) {
    characters[index] = ' ';
    index += 1;
  }
  return index;
}

/** Masks a block-style comment through its closing token and returns the final consumed index. */
function maskDelimitedComment(
  characters: string[],
  startIndex: number,
  terminator: string,
): number {
  let index = startIndex;
  while (index < characters.length) {
    if (characters.slice(index, index + terminator.length).join('') === terminator) {
      for (let offset = 0; offset < terminator.length; offset += 1) {
        characters[index + offset] = ' ';
      }
      return index + terminator.length - 1;
    }
    if (characters[index] !== '\n') {
      characters[index] = ' ';
    }
    index += 1;
  }
  return characters.length - 1;
}

/**
 * Reads at most one mebibyte from an optional convention file after canonical boundary checks.
 * Missing files and directories are normal discovery misses; other filesystem failures surface as
 * domain errors so permission and I/O problems are not silently mistaken for absent configuration.
 *
 * @param sourcePath Fixed lexical convention path below the project root.
 * @param workspaceRoot Canonical workspace boundary applied after following symlinks.
 * @returns UTF-8 source prefix, or undefined when the optional file does not exist or is not regular.
 */
async function readOptionalBoundedSource(
  sourcePath: string,
  workspaceRoot: string,
): Promise<string | undefined> {
  const canonicalSourcePath = await resolveOptionalRegularFile(sourcePath);
  if (canonicalSourcePath === undefined) {
    return undefined;
  }
  if (!isPathInside(workspaceRoot, canonicalSourcePath)) {
    return undefined;
  }

  let fileHandle;
  try {
    fileHandle = await open(canonicalSourcePath, 'r');
    const sourceFileSize = (await fileHandle.stat()).size;
    const sourceBuffer = Buffer.alloc(
      Math.min(Math.max(sourceFileSize, 0), MAX_RUNTIME_DISCOVERY_FILE_BYTES),
    );
    let totalBytesRead = 0;
    while (totalBytesRead < sourceBuffer.byteLength) {
      const { bytesRead } = await fileHandle.read(
        sourceBuffer,
        totalBytesRead,
        sourceBuffer.byteLength - totalBytesRead,
        totalBytesRead,
      );
      if (bytesRead === 0) {
        break;
      }
      totalBytesRead += bytesRead;
    }
    return sourceBuffer.subarray(0, totalBytesRead).toString('utf8');
  } catch (error) {
    if (isMissingPathError(error)) {
      return undefined;
    }
    throw createRuntimeError(`Preview runtime metadata could not be read: ${sourcePath}`, error);
  } finally {
    await fileHandle?.close();
  }
}

/**
 * Rejects nested property access and template interpolation expressions before a global assignment.
 * Storybook `previewHead` commonly stores literal script text in a template, which remains useful,
 * while `${window.X = {}}` is executable interpolation and must not mutate preview feature checks.
 *
 * @param sourceText Complete bounded source prefix being scanned.
 * @param endIndex Exclusive position immediately before a namespace assignment match.
 * @returns Whether the match is nested after `.` or begins immediately inside `${...}`.
 */
function hasUnsafeNamespacePrefix(sourceText: string, endIndex: number): boolean {
  let previousIndex = findPreviousNonWhitespaceIndex(sourceText, endIndex);
  const previousCharacter = previousIndex === undefined ? undefined : sourceText[previousIndex];
  if (previousCharacter === '.' || previousCharacter === '$') {
    return true;
  }
  if (previousCharacter !== '{' || previousIndex === undefined) {
    return false;
  }

  previousIndex = findPreviousNonWhitespaceIndex(sourceText, previousIndex);
  return previousIndex !== undefined && sourceText[previousIndex] === '$';
}

/** Finds the nearest significant character index before an exclusive source offset. */
function findPreviousNonWhitespaceIndex(sourceText: string, endIndex: number): number | undefined {
  for (let index = endIndex - 1; index >= 0; index -= 1) {
    const character = sourceText[index];
    if (character !== undefined && !/\s/.test(character)) {
      return index;
    }
  }
  return undefined;
}

/**
 * Resolves an optional lexical path to a canonical regular file without treating absence as failure.
 *
 * @param filePath Fixed convention path that may legitimately be missing.
 * @returns Canonical file path, or undefined for ENOENT, ENOTDIR, and non-regular filesystem nodes.
 */
async function resolveOptionalRegularFile(filePath: string): Promise<string | undefined> {
  let canonicalFilePath: string;
  try {
    canonicalFilePath = normalizeLexicalPath(await realpath(filePath));
    return (await stat(canonicalFilePath)).isFile() ? canonicalFilePath : undefined;
  } catch (error) {
    if (isMissingPathError(error)) {
      return undefined;
    }
    throw createRuntimeError(`Preview convention file could not be inspected: ${filePath}`, error);
  }
}

/**
 * Canonicalizes a required trusted directory and converts filesystem failures to domain errors.
 *
 * @param directoryPath Directory supplied by project-root discovery or the VS Code workspace.
 * @param directoryLabel Human-readable name included in failure messages.
 * @returns Canonical normalized directory path.
 */
async function resolveRequiredDirectory(
  directoryPath: string,
  directoryLabel: string,
): Promise<string> {
  try {
    const canonicalDirectory = normalizeLexicalPath(await realpath(directoryPath));
    if (!(await stat(canonicalDirectory)).isDirectory()) {
      throw createRuntimeError(`${directoryLabel} must be a directory: ${directoryPath}`);
    }
    return canonicalDirectory;
  } catch (error) {
    if (error instanceof PreviewCompilationError) {
      throw error;
    }
    throw createRuntimeError(`${directoryLabel} could not be resolved: ${directoryPath}`, error);
  }
}

/**
 * Enforces the post-symlink workspace boundary for project and executable setup paths.
 *
 * @param workspaceRoot Canonical trusted workspace directory.
 * @param candidatePath Canonical project or file path being admitted.
 * @param candidateLabel Human-readable path role used in the error message.
 * @throws PreviewCompilationError when the candidate escapes the selected workspace.
 */
function assertInsideWorkspace(
  workspaceRoot: string,
  candidatePath: string,
  candidateLabel: string,
): void {
  if (!isPathInside(workspaceRoot, candidatePath)) {
    throw createRuntimeError(`${candidateLabel} must stay inside the selected workspace.`);
  }
}

/** Reports whether a canonical candidate equals or descends from a canonical directory boundary. */
function isPathInside(directoryPath: string, candidatePath: string): boolean {
  const relativePath = path.relative(directoryPath, candidatePath);
  return (
    relativePath.length === 0 ||
    (relativePath !== '..' &&
      !relativePath.startsWith(`..${path.sep}`) &&
      !path.isAbsolute(relativePath))
  );
}

/** Identifies normal optional-path misses without swallowing permissions or other I/O failures. */
function isMissingPathError(error: unknown): boolean {
  if (typeof error !== 'object' || error === null || !('code' in error)) {
    return false;
  }
  const code = (error as { readonly code?: unknown }).code;
  return code === 'ENOENT' || code === 'ENOTDIR';
}

/** Creates a consistent domain failure for discovery and setup validation boundaries. */
function createRuntimeError(message: string, cause?: unknown): PreviewCompilationError {
  return new PreviewCompilationError(message, [], cause);
}
