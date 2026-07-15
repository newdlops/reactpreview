/**
 * Traces the workspace-owned side of an automatically selected Storybook setup graph.
 * The trace gives fallback a precise boundary: target failures are never retried, while unresolved
 * relative setup imports retain bounded file and directory identities for automatic recovery.
 */
import { realpath, stat } from 'node:fs/promises';
import path from 'node:path';
import type {
  Message,
  OnResolveArgs,
  OnResolveResult,
  Plugin,
  PluginBuild,
  ResolveResult,
} from 'esbuild';
import { canonicalizeExistingPath, normalizeLexicalPath } from '../../shared/pathIdentity';
import {
  PREVIEW_ASSET_NAMESPACE,
  PREVIEW_DATA_URL_NAMESPACE,
  PREVIEW_RESOLVE_GUARD,
  PREVIEW_SETUP_BRIDGE_NAMESPACE,
  PREVIEW_SNAPSHOT_NAMESPACE,
  PREVIEW_TARGET_BRIDGE_NAMESPACE,
} from './previewPluginProtocol';

const SETUP_TRACE_RESOLVE_GUARD = Symbol('react-preview-setup-trace-resolve-guard');
const MAX_TRACED_SETUP_PATHS = 4096;
const MAX_MISSING_SETUP_IMPORTS = 64;
const MAX_FALLBACK_DEPENDENCY_PATHS = 512;
const MAX_FALLBACK_WATCH_DIRECTORIES = 64;
const MODULE_CANDIDATE_EXTENSIONS = [
  '.tsx',
  '.ts',
  '.jsx',
  '.js',
  '.mts',
  '.mjs',
  '.cts',
  '.cjs',
  '.json',
] as const;
const PRIVATE_FILE_NAMESPACE_PREFIXES = [
  PREVIEW_ASSET_NAMESPACE,
  PREVIEW_DATA_URL_NAMESPACE,
  PREVIEW_SETUP_BRIDGE_NAMESPACE,
  PREVIEW_SNAPSHOT_NAMESPACE,
  PREVIEW_TARGET_BRIDGE_NAMESPACE,
] as const;

/** Missing local setup request captured before esbuild turns it into a build diagnostic. */
interface MissingSetupImport {
  /** Workspace source file containing the unresolved import. */
  readonly importerPath: string;
  /** Relative module specifier whose future creation can repair Storybook setup. */
  readonly specifier: string;
}

/** Paths retained by a successful setup-free retry so the pinned panel can recover automatically. */
export interface PreviewSetupFallbackWatchInputs {
  /** Existing importers and bounded future module candidates routed through document events. */
  readonly dependencyPaths: readonly string[];
  /** Existing safe parent directories routed through recursive VS Code filesystem watchers. */
  readonly watchDirectories: readonly string[];
}

/**
 * Stateful, compilation-scoped observer for the automatic Storybook setup branch.
 * One instance must be used only for the first build attempt and discarded before setup-free retry.
 */
export class PreviewSetupFallbackBoundary {
  /** Esbuild observer installed between the virtual bridges and ordinary source resolvers. */
  public readonly plugin: Plugin;

  private readonly canonicalWorkspaceRoot: string;
  private readonly canonicalProjectRoot: string;
  private hasUntrackedMissingImport = false;
  private readonly missingImports: MissingSetupImport[] = [];
  private readonly setupModulePath: string;
  private readonly setupPaths = new Set<string>();
  private traceLimitReached = false;

  /**
   * Seeds the trace with the canonical Storybook preview module and creates its resolver observer.
   *
   * @param setupModulePath Trusted automatic Storybook preview selected by runtime discovery.
   * @param projectRoot Nearest package boundary used to reject overly broad recursive watchers.
   * @param workspaceRoot Trusted workspace boundary for trace ownership and recovery watchers.
   */
  public constructor(setupModulePath: string, projectRoot: string, workspaceRoot: string) {
    this.canonicalWorkspaceRoot = canonicalizeExistingPath(workspaceRoot);
    this.canonicalProjectRoot = canonicalizeExistingPath(projectRoot);
    this.setupModulePath = canonicalizeExistingPath(setupModulePath);
    this.rememberSetupPath(setupModulePath);
    this.plugin = {
      name: 'react-preview-storybook-fallback-boundary',
      setup: (buildContext): void => {
        buildContext.onResolve({ filter: /.*/ }, async (arguments_) =>
          this.traceSetupResolution(
            async (requestPath, options) => buildContext.resolve(requestPath, options),
            arguments_,
          ),
        );
      },
    };
  }

  /** Whether a missing bare or alias request cannot be observed through bounded local candidates. */
  public get requiresManualRefresh(): boolean {
    return this.hasUntrackedMissingImport;
  }

  /**
   * Allows retry only when every esbuild error has a location inside the traced setup graph.
   * Requiring complete attribution prevents a simultaneous target failure from being hidden behind
   * a successful setup-free retry and avoids doubling work for ordinary target build errors.
   *
   * @param errors Errors returned by the first automatic-setup build.
   * @param workingDirectory esbuild working directory used to resolve relative diagnostic paths.
   * @returns `true` only for a nonempty, fully setup-owned error collection within trace limits.
   */
  public shouldRetry(errors: readonly Message[], workingDirectory: string): boolean {
    return (
      !this.traceLimitReached &&
      errors.length > 0 &&
      errors.every((message) => {
        const locationPath = restoreDiagnosticPath(message.location?.file, workingDirectory);
        return locationPath !== undefined && this.hasSetupPath(locationPath);
      })
    );
  }

  /**
   * Produces bounded liveness inputs after a setup-owned build failure.
   * Missing module directories are canonicalized after following symlinks, while future exact file
   * candidates remain lexical so normal editor-save routing can observe their first creation.
   *
   * @param errors Setup-owned esbuild errors whose importers should remain dependencies.
   * @param workingDirectory esbuild working directory used for relative diagnostic locations.
   * @returns Safe dependency paths and existing watch roots sorted for deterministic bundle output.
   */
  public async createWatchInputs(
    errors: readonly Message[],
    workingDirectory: string,
  ): Promise<PreviewSetupFallbackWatchInputs> {
    const dependencyPaths = new Set<string>();
    const watchDirectories = new Set<string>();
    dependencyPaths.add(this.setupModulePath);

    for (const message of errors.slice(0, MAX_MISSING_SETUP_IMPORTS)) {
      const locationPath = restoreDiagnosticPath(message.location?.file, workingDirectory);
      if (locationPath !== undefined && this.hasSetupPath(locationPath)) {
        dependencyPaths.add(canonicalizeExistingPath(locationPath));
      }
    }

    for (const missingImport of this.missingImports) {
      const recovery = await resolveMissingImportRecovery(
        missingImport,
        this.canonicalProjectRoot,
        this.canonicalWorkspaceRoot,
      );
      if (recovery === undefined) {
        continue;
      }
      for (const dependencyPath of recovery.dependencyPaths) {
        if (dependencyPaths.size >= MAX_FALLBACK_DEPENDENCY_PATHS) {
          break;
        }
        dependencyPaths.add(dependencyPath);
      }
      if (
        recovery.watchDirectory !== undefined &&
        watchDirectories.size < MAX_FALLBACK_WATCH_DIRECTORIES
      ) {
        watchDirectories.add(recovery.watchDirectory);
      }
    }

    return {
      dependencyPaths: [...dependencyPaths].sort(),
      watchDirectories: [...watchDirectories].sort(),
    };
  }

  /** Resolves one setup-owned import through the remaining plugin chain and records its outcome. */
  private async traceSetupResolution(
    resolve: PluginBuild['resolve'],
    arguments_: OnResolveArgs,
  ): Promise<OnResolveResult | undefined> {
    const pluginData = arguments_.pluginData as unknown;
    if (
      pluginData === PREVIEW_RESOLVE_GUARD ||
      pluginData === SETUP_TRACE_RESOLVE_GUARD ||
      !this.isSetupImporter(arguments_)
    ) {
      return undefined;
    }

    const fromSetupBridge = arguments_.namespace === PREVIEW_SETUP_BRIDGE_NAMESPACE;
    const importerPath = fromSetupBridge
      ? arguments_.importer
      : canonicalizeExistingPath(arguments_.importer);
    const resolved = await resolve(arguments_.path, {
      importer: importerPath,
      kind: arguments_.kind,
      namespace: fromSetupBridge ? 'file' : arguments_.namespace,
      pluginData: SETUP_TRACE_RESOLVE_GUARD,
      resolveDir: fromSetupBridge ? path.dirname(importerPath) : arguments_.resolveDir,
      with: arguments_.with,
    });

    if (resolved.errors.length > 0) {
      this.rememberMissingRelativeImport(importerPath, arguments_.path);
      return { errors: resolved.errors, warnings: resolved.warnings };
    }
    if (!resolved.external && isWorkspaceFileResolution(resolved)) {
      this.rememberSetupPath(resolved.path);
    }
    return resolved;
  }

  /** Reports whether a resolver request begins at the setup bridge or continues a traced path. */
  private isSetupImporter(arguments_: OnResolveArgs): boolean {
    return (
      arguments_.namespace === PREVIEW_SETUP_BRIDGE_NAMESPACE ||
      (arguments_.importer.length > 0 && this.hasSetupPath(arguments_.importer))
    );
  }

  /** Retains a canonical and lexical path identity until the explicit trace budget is exhausted. */
  private rememberSetupPath(filePath: string): void {
    const canonicalPath = canonicalizeExistingPath(filePath);
    if (!isPathInside(this.canonicalWorkspaceRoot, canonicalPath)) {
      return;
    }
    if (this.setupPaths.size >= MAX_TRACED_SETUP_PATHS) {
      this.traceLimitReached = true;
      return;
    }
    this.setupPaths.add(normalizeLexicalPath(filePath));
    this.setupPaths.add(canonicalPath);
  }

  /** Matches both symlink-preserving and canonical diagnostic identities. */
  private hasSetupPath(filePath: string): boolean {
    return this.setupPaths.has(normalizeLexicalPath(filePath));
  }

  /** Records a bounded relative failure without parsing esbuild's human-readable error text. */
  private rememberMissingRelativeImport(importerPath: string, specifier: string): void {
    if (!specifier.startsWith('./') && !specifier.startsWith('../')) {
      this.hasUntrackedMissingImport = true;
      return;
    }
    if (this.missingImports.length >= MAX_MISSING_SETUP_IMPORTS) {
      return;
    }
    this.missingImports.push({ importerPath, specifier });
  }
}

/** Reports whether a successful resolver result represents a workspace-loadable file identity. */
function isWorkspaceFileResolution(result: ResolveResult): boolean {
  return (
    result.namespace === 'file' ||
    result.namespace === PREVIEW_ASSET_NAMESPACE ||
    result.namespace === PREVIEW_DATA_URL_NAMESPACE ||
    result.namespace === PREVIEW_SNAPSHOT_NAMESPACE
  );
}

/** Restores a private diagnostic identity and resolves it from esbuild's working directory. */
function restoreDiagnosticPath(
  diagnosticFile: string | undefined,
  workingDirectory: string,
): string | undefined {
  if (diagnosticFile === undefined || diagnosticFile.startsWith('<')) {
    return undefined;
  }
  let restoredFile = diagnosticFile;
  for (const namespace of PRIVATE_FILE_NAMESPACE_PREFIXES) {
    restoredFile = restoredFile.replaceAll(`${namespace}:`, '');
  }
  const suffixIndex = findImportSuffixIndex(restoredFile);
  const filesystemPath = restoredFile.slice(0, suffixIndex);
  return path.isAbsolute(filesystemPath)
    ? normalizeLexicalPath(filesystemPath)
    : normalizeLexicalPath(path.resolve(workingDirectory, filesystemPath));
}

/** Recovery candidates and canonical watcher returned for one unresolved setup import. */
interface MissingImportRecovery {
  /** Extension and index variants that may be created by a later editor save. */
  readonly dependencyPaths: readonly string[];
  /** Nearest existing safe directory, omitted when watching the whole workspace would be required. */
  readonly watchDirectory?: string;
}

/** Resolves a relative missing request to safe future candidates and its nearest existing parent. */
async function resolveMissingImportRecovery(
  missingImport: MissingSetupImport,
  projectRoot: string,
  workspaceRoot: string,
): Promise<MissingImportRecovery | undefined> {
  const cleanSpecifier = missingImport.specifier.slice(
    0,
    findImportSuffixIndex(missingImport.specifier),
  );
  if (cleanSpecifier.includes('\0')) {
    return undefined;
  }
  const candidateBase = normalizeLexicalPath(
    path.resolve(path.dirname(missingImport.importerPath), cleanSpecifier),
  );
  if (!isPathInside(workspaceRoot, candidateBase)) {
    return undefined;
  }

  const safeParent = await findNearestSafeExistingDirectory(candidateBase, workspaceRoot);
  if (safeParent === undefined) {
    return undefined;
  }
  const dependencyPaths = createMissingModuleCandidates(candidateBase).filter((candidate) =>
    isPathInside(workspaceRoot, candidate),
  );
  return canWatchRecoveryDirectory(projectRoot, safeParent)
    ? { dependencyPaths, watchDirectory: safeParent }
    : { dependencyPaths };
}

/**
 * Rejects recursive watchers at package root, its first-level source folders, and external paths.
 * Exact dependency candidates still rebuild for editor saves when no sufficiently narrow existing
 * directory is available, without turning every package write into a preview rebuild.
 */
function canWatchRecoveryDirectory(projectRoot: string, directoryPath: string): boolean {
  const relativeDirectory = path.relative(projectRoot, directoryPath);
  if (
    relativeDirectory.length === 0 ||
    relativeDirectory.startsWith('..') ||
    path.isAbsolute(relativeDirectory)
  ) {
    return false;
  }
  return relativeDirectory.split(path.sep).filter((segment) => segment.length > 0).length >= 2;
}

/** Finds a canonical directory without admitting a missing path below an external symlink. */
async function findNearestSafeExistingDirectory(
  candidateBase: string,
  workspaceRoot: string,
): Promise<string | undefined> {
  let candidateDirectory = candidateBase;
  try {
    if (!(await stat(candidateBase)).isDirectory()) {
      candidateDirectory = path.dirname(candidateBase);
    }
  } catch (error) {
    if (!isMissingPathError(error)) {
      return undefined;
    }
    candidateDirectory = path.dirname(candidateBase);
  }

  let reachedFilesystemRoot = false;
  while (!reachedFilesystemRoot) {
    try {
      const canonicalDirectory = normalizeLexicalPath(await realpath(candidateDirectory));
      return isPathInside(workspaceRoot, canonicalDirectory) ? canonicalDirectory : undefined;
    } catch (error) {
      if (!isMissingPathError(error)) {
        return undefined;
      }
    }
    const nextDirectory = path.dirname(candidateDirectory);
    reachedFilesystemRoot = nextDirectory === candidateDirectory;
    candidateDirectory = nextDirectory;
  }
  return undefined;
}

/** Creates exact, extension-appended, and directory-index candidates in resolver priority order. */
function createMissingModuleCandidates(candidateBase: string): readonly string[] {
  if (path.extname(candidateBase).length > 0) {
    return [candidateBase];
  }
  return [
    candidateBase,
    ...MODULE_CANDIDATE_EXTENSIONS.map((extension) => `${candidateBase}${extension}`),
    ...MODULE_CANDIDATE_EXTENSIONS.map((extension) =>
      path.join(candidateBase, `index${extension}`),
    ),
  ];
}

/** Finds the first query or fragment delimiter that is not part of a filesystem identity. */
function findImportSuffixIndex(importPath: string): number {
  const queryIndex = importPath.indexOf('?');
  const fragmentIndex = importPath.indexOf('#');
  return [queryIndex, fragmentIndex]
    .filter((index) => index >= 0)
    .reduce((lowestIndex, index) => Math.min(lowestIndex, index), importPath.length);
}

/** Reports whether a path stays at or below the trusted canonical workspace boundary. */
function isPathInside(directoryPath: string, candidatePath: string): boolean {
  const relativePath = path.relative(directoryPath, path.resolve(candidatePath));
  return (
    relativePath.length === 0 || (!relativePath.startsWith('..') && !path.isAbsolute(relativePath))
  );
}

/** Narrows filesystem absence errors without hiding permission, loop, or I/O failures. */
function isMissingPathError(error: unknown): boolean {
  return (
    error instanceof Error &&
    'code' in error &&
    (error.code === 'ENOENT' || error.code === 'ENOTDIR')
  );
}
