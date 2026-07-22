/**
 * Restores a linked workspace package from authored source when its declared build output is absent.
 * Monorepos commonly expose `dist/*` from a workspace package while intentionally omitting that
 * directory until a package-local build runs. A visual preview may safely use the corresponding
 * checked-in source, but only after filesystem and manifest evidence proves the mapping exactly.
 */
import { lstat, readFile, stat } from 'node:fs/promises';
import path from 'node:path';
import type { OnResolveArgs, OnResolveResult, Plugin } from 'esbuild';
import { canonicalizeExistingPath } from '../../shared/pathIdentity';
import { PREVIEW_RESOLVE_GUARD } from './previewPluginProtocol';

const BARE_PACKAGE_PATTERN = /^(?:@[^/]+\/[^/]+|[^./][^/]*)(?:\/.*)?$/;
const PACKAGE_MANIFEST_NAME = 'package.json';
const MAXIMUM_MANIFEST_BYTES = 1024 * 1024;
const MAXIMUM_EXPORT_NODES = 128;
const MAXIMUM_EXPORT_TARGETS = 32;
const OUTPUT_DIRECTORY_NAMES = new Set(['build', 'dist', 'lib', 'out']);
const SOURCE_EXTENSIONS = ['.ts', '.tsx', '.mts', '.cts', '.js', '.jsx', '.mjs', '.cjs'];
const EXACT_STYLE_SOURCE_EXTENSIONS = new Set(['.css']);

/** Compiler-owned watcher registration used to invalidate an incremental fallback. */
export interface PreviewWorkspacePackageSourceFallbackOptions {
  /** Records package source/output directories without coupling this adapter to VS Code watchers. */
  readonly registerWatchDirectory?: (directoryPath: string) => void;
  /** Trusted monorepo boundary; linked packages and recovered source must remain inside it. */
  readonly workspaceRoot: string;
}

/** Parsed npm identity retaining the requested export key. */
interface PackageRequest {
  readonly packageName: string;
  readonly packageSegments: readonly string[];
  readonly subpath: string;
}

/** Minimal inert package metadata used to prove an unbuilt workspace export. */
interface WorkspacePackageManifest {
  readonly exports?: unknown;
  readonly files?: unknown;
  readonly name?: unknown;
  readonly scripts?: unknown;
  readonly source?: unknown;
}

/** Filesystem identity for a package linked from one application's node_modules tree. */
interface LinkedWorkspacePackage {
  readonly manifest: WorkspacePackageManifest;
  readonly physicalRoot: string;
}

/** Complete evidence required before normal package resolution can be replaced. */
interface WorkspaceSourceFallback {
  readonly outputDirectories: readonly string[];
  readonly sourcePath: string;
}

/** Export subpath selection with an optional wildcard captured from the manifest key. */
interface SelectedPackageExport {
  readonly replacement: string | undefined;
  readonly value: unknown;
}

/**
 * Creates a resolver for an unbuilt, symlinked workspace dependency.
 *
 * Ordinary installed dependencies, workspace packages with valid outputs, undeclared subpaths,
 * packages outside the workspace, and ambiguous source layouts return immediately to esbuild's
 * normal resolver. Project scripts and package configuration modules are never executed.
 */
export function createPreviewWorkspacePackageSourceFallbackPlugin(
  options: PreviewWorkspacePackageSourceFallbackOptions,
): Plugin {
  const workspaceRoot = canonicalizeExistingPath(options.workspaceRoot);
  const packageLookupCache = new Map<string, Promise<LinkedWorkspacePackage | undefined>>();
  const sourceFallbackCache = new Map<string, Promise<WorkspaceSourceFallback | undefined>>();
  const warnedRequests = new Set<string>();

  return {
    name: 'react-preview-workspace-package-source-fallback',
    setup(build): void {
      build.onStart(() => {
        packageLookupCache.clear();
        sourceFallbackCache.clear();
      });

      /** Replaces only an absent declared artifact backed by an exact source/output proof. */
      async function resolveWorkspaceSource(
        arguments_: OnResolveArgs,
      ): Promise<OnResolveResult | undefined> {
        if (!isEligiblePackageRequest(arguments_)) return undefined;
        const request = parsePackageRequest(arguments_.path);
        const resolveDirectory = readResolveDirectory(arguments_);
        if (request === undefined || resolveDirectory === undefined) return undefined;

        const lookupKey = `${resolveDirectory}\0${request.packageName}`;
        let packagePromise = packageLookupCache.get(lookupKey);
        if (packagePromise === undefined) {
          packagePromise = findLinkedWorkspacePackage(resolveDirectory, request, workspaceRoot);
          packageLookupCache.set(lookupKey, packagePromise);
        }
        const linkedPackage = await packagePromise;
        if (linkedPackage === undefined) return undefined;

        const fallbackKey = `${linkedPackage.physicalRoot}\0${request.subpath}`;
        let fallbackPromise = sourceFallbackCache.get(fallbackKey);
        if (fallbackPromise === undefined) {
          fallbackPromise = prepareWorkspaceSourceFallback(linkedPackage, request, workspaceRoot);
          sourceFallbackCache.set(fallbackKey, fallbackPromise);
        }
        const fallback = await fallbackPromise;
        if (fallback === undefined) return undefined;

        options.registerWatchDirectory?.(path.dirname(fallback.sourcePath));
        for (const outputDirectory of fallback.outputDirectories) {
          options.registerWatchDirectory?.(outputDirectory);
        }
        const warningKey = `${request.packageName}\0${request.subpath}`;
        const includeWarning = !warnedRequests.has(warningKey);
        warnedRequests.add(warningKey);
        return {
          path: fallback.sourcePath,
          warnings: includeWarning
            ? [
                {
                  text:
                    `React Preview used workspace source for unbuilt package export ` +
                    `"${formatPackageRequest(request)}" (${formatWorkspacePath(
                      fallback.sourcePath,
                      workspaceRoot,
                    )}).`,
                },
              ]
            : [],
        };
      }

      build.onResolve({ filter: BARE_PACKAGE_PATTERN }, resolveWorkspaceSource);
    },
  };
}

/** Rejects virtual namespaces, recursion, absolute paths, and non-package requests. */
function isEligiblePackageRequest(arguments_: OnResolveArgs): boolean {
  return (
    arguments_.namespace === 'file' &&
    (arguments_.pluginData as unknown) !== PREVIEW_RESOLVE_GUARD &&
    !path.isAbsolute(arguments_.path) &&
    !arguments_.path.startsWith('.') &&
    !arguments_.path.includes('?') &&
    !arguments_.path.includes('#')
  );
}

/** Extracts the filesystem issuer directory used by Node-style package lookup. */
function readResolveDirectory(arguments_: OnResolveArgs): string | undefined {
  if (arguments_.resolveDir.length > 0) return path.resolve(arguments_.resolveDir);
  return path.isAbsolute(arguments_.importer)
    ? path.dirname(path.resolve(arguments_.importer))
    : undefined;
}

/** Splits scoped and unscoped npm specifiers without accepting malformed empty segments. */
function parsePackageRequest(moduleSpecifier: string): PackageRequest | undefined {
  const segments = moduleSpecifier.split('/');
  const scoped = moduleSpecifier.startsWith('@');
  const packageSegmentCount = scoped ? 2 : 1;
  if (
    segments.length < packageSegmentCount ||
    segments.slice(0, packageSegmentCount).some((segment) => segment.length === 0)
  ) {
    return undefined;
  }
  const packageSegments = segments.slice(0, packageSegmentCount);
  const packageName = packageSegments.join('/');
  const subpath = segments.slice(packageSegmentCount).join('/');
  return { packageName, packageSegments, subpath };
}

/**
 * Finds an npm workspace link while rejecting copied registry packages and external link targets.
 * A real workspace dependency is represented by a symlink whose canonical target is workspace-owned
 * and is not another package-manager node_modules store.
 */
async function findLinkedWorkspacePackage(
  startDirectory: string,
  request: PackageRequest,
  workspaceRoot: string,
): Promise<LinkedWorkspacePackage | undefined> {
  let directory = path.resolve(startDirectory);
  while (isPathInsideOrEqual(workspaceRoot, directory)) {
    const logicalRoot = path.join(directory, 'node_modules', ...request.packageSegments);
    if (await isSymbolicLink(logicalRoot)) {
      const physicalRoot = canonicalizeExistingPath(logicalRoot);
      const relativePhysicalRoot = path.relative(workspaceRoot, physicalRoot);
      if (
        isPathInside(workspaceRoot, physicalRoot) &&
        !relativePhysicalRoot.split(path.sep).includes('node_modules')
      ) {
        const manifestPath = path.join(physicalRoot, PACKAGE_MANIFEST_NAME);
        const manifest = await readWorkspacePackageManifest(manifestPath);
        if (manifest?.name === request.packageName) {
          return { manifest, physicalRoot };
        }
      }
    }
    if (directory === workspaceRoot) break;
    directory = path.dirname(directory);
  }
  return undefined;
}

/** Reads bounded, inert JSON and never follows package build/config scripts. */
async function readWorkspacePackageManifest(
  manifestPath: string,
): Promise<WorkspacePackageManifest | undefined> {
  try {
    const manifestStat = await stat(manifestPath);
    if (!manifestStat.isFile() || manifestStat.size > MAXIMUM_MANIFEST_BYTES) return undefined;
    const parsed: unknown = JSON.parse(await readFile(manifestPath, 'utf8'));
    return isRecord(parsed) ? parsed : undefined;
  } catch {
    return undefined;
  }
}

/** Proves the missing exported build file and one unambiguous workspace source replacement. */
async function prepareWorkspaceSourceFallback(
  linkedPackage: LinkedWorkspacePackage,
  request: PackageRequest,
  workspaceRoot: string,
): Promise<WorkspaceSourceFallback | undefined> {
  if (!hasBuildOutputEvidence(linkedPackage.manifest)) return undefined;
  const selectedExport = selectPackageExport(linkedPackage.manifest.exports, request.subpath);
  if (selectedExport === undefined) return undefined;
  const exportTargets = collectRuntimeExportTargets(selectedExport);
  if (exportTargets.length === 0) return undefined;

  const outputPaths: string[] = [];
  for (const exportTarget of exportTargets) {
    const outputPath = resolvePackageRelativePath(linkedPackage.physicalRoot, exportTarget);
    if (outputPath === undefined || !hasConventionalOutputDirectory(exportTarget)) return undefined;
    outputPaths.push(outputPath);
  }
  if (await anyPathExists(outputPaths)) return undefined;

  const candidateGroups = createSourceCandidateGroups(
    linkedPackage.physicalRoot,
    linkedPackage.manifest,
    request,
    exportTargets,
  );
  let sourcePath: string | undefined;
  for (const candidateGroup of candidateGroups) {
    const existingCandidates: string[] = [];
    for (const candidate of candidateGroup) {
      const existingCandidate = await readExistingWorkspaceSource(
        candidate,
        linkedPackage.physicalRoot,
        workspaceRoot,
      );
      if (existingCandidate !== undefined) existingCandidates.push(existingCandidate);
    }
    const distinctCandidates = [...new Set(existingCandidates)];
    if (distinctCandidates.length > 1) return undefined;
    if (distinctCandidates[0] !== undefined) {
      sourcePath = distinctCandidates[0];
      break;
    }
  }
  if (sourcePath === undefined) return undefined;

  const outputDirectories = await Promise.all(
    outputPaths.map(async (outputPath) => await findNearestExistingDirectory(outputPath)),
  );
  if (
    outputDirectories.some(
      (outputDirectory) =>
        !isPathInsideOrEqual(linkedPackage.physicalRoot, outputDirectory) ||
        !isPathInsideOrEqual(workspaceRoot, outputDirectory),
    )
  ) {
    return undefined;
  }
  return {
    outputDirectories: [...new Set(outputDirectories)],
    sourcePath,
  };
}

/** Requires a declared build script or published-files list before treating dist as generated. */
function hasBuildOutputEvidence(manifest: WorkspacePackageManifest): boolean {
  const scripts = isRecord(manifest.scripts) ? manifest.scripts : undefined;
  const buildScript = scripts?.build;
  const files = Array.isArray(manifest.files) ? manifest.files : [];
  return (
    (typeof buildScript === 'string' && buildScript.trim().length > 0) ||
    files.some(
      (entry) =>
        typeof entry === 'string' &&
        OUTPUT_DIRECTORY_NAMES.has(entry.replace(/^\.\//u, '').split('/')[0] ?? ''),
    )
  );
}

/** Selects an exact or single-wildcard export entry without interpreting package code. */
function selectPackageExport(
  exportsValue: unknown,
  subpath: string,
): SelectedPackageExport | undefined {
  const requestedKey = subpath.length === 0 ? '.' : `./${subpath}`;
  if (!isRecord(exportsValue)) {
    return requestedKey === '.' && exportsValue !== undefined
      ? { replacement: undefined, value: exportsValue }
      : undefined;
  }
  const exportKeys = Object.keys(exportsValue);
  if (
    requestedKey === '.' &&
    exportKeys.length > 0 &&
    exportKeys.every((key) => !key.startsWith('.'))
  ) {
    return { replacement: undefined, value: exportsValue };
  }
  if (Object.prototype.hasOwnProperty.call(exportsValue, requestedKey)) {
    return { replacement: undefined, value: exportsValue[requestedKey] };
  }

  const wildcardMatches = Object.keys(exportsValue)
    .map((key) => matchExportWildcard(key, requestedKey, exportsValue[key]))
    .filter(
      (match): match is SelectedPackageExport & { readonly score: number } => match !== undefined,
    )
    .sort((left, right) => right.score - left.score);
  return wildcardMatches[0];
}

/** Matches one package-export wildcard and ranks the most specific prefix/suffix first. */
function matchExportWildcard(
  key: string,
  requestedKey: string,
  value: unknown,
): (SelectedPackageExport & { readonly score: number }) | undefined {
  const wildcardIndex = key.indexOf('*');
  if (wildcardIndex < 0 || key.slice(wildcardIndex + 1).includes('*')) return undefined;
  const prefix = key.slice(0, wildcardIndex);
  const suffix = key.slice(wildcardIndex + 1);
  if (!requestedKey.startsWith(prefix) || !requestedKey.endsWith(suffix)) return undefined;
  const replacement = requestedKey.slice(prefix.length, requestedKey.length - suffix.length);
  return { replacement, score: prefix.length + suffix.length, value };
}

/** Traverses bounded export conditions, skipping type-only targets that browsers never load. */
function collectRuntimeExportTargets(selectedExport: SelectedPackageExport): readonly string[] {
  const targets: string[] = [];
  const queue: { readonly condition: string | undefined; readonly value: unknown }[] = [
    { condition: undefined, value: selectedExport.value },
  ];
  let visitedNodes = 0;
  while (
    queue.length > 0 &&
    visitedNodes < MAXIMUM_EXPORT_NODES &&
    targets.length < MAXIMUM_EXPORT_TARGETS
  ) {
    visitedNodes += 1;
    const current = queue.shift();
    if (current === undefined) break;
    if (current.condition === 'types') continue;
    if (typeof current.value === 'string') {
      const replaced =
        selectedExport.replacement === undefined
          ? current.value
          : current.value.replaceAll('*', selectedExport.replacement);
      if (replaced.startsWith('./') && !replaced.includes('*')) targets.push(replaced);
      continue;
    }
    if (Array.isArray(current.value)) {
      for (const value of current.value) queue.push({ condition: current.condition, value });
      continue;
    }
    if (isRecord(current.value)) {
      for (const [condition, value] of Object.entries(current.value)) {
        queue.push({ condition, value });
      }
    }
  }
  return [...new Set(targets)];
}

/** Resolves a manifest target while rejecting traversal and absolute path escapes. */
function resolvePackageRelativePath(
  packageRoot: string,
  relativeTarget: string,
): string | undefined {
  if (!relativeTarget.startsWith('./')) return undefined;
  const resolvedPath = path.resolve(packageRoot, relativeTarget.slice(2));
  return isPathInside(packageRoot, resolvedPath) ? resolvedPath : undefined;
}

/** Checks that the exported runtime target begins in a conventional generated output directory. */
function hasConventionalOutputDirectory(relativeTarget: string): boolean {
  const firstSegment = relativeTarget.slice(2).split('/')[0];
  return firstSegment !== undefined && OUTPUT_DIRECTORY_NAMES.has(firstSegment);
}

/**
 * Builds source probes in descending evidence order.
 * The exact dist-to-src mapping wins over a subpath heuristic; this matters when a package contains
 * both `src/feature.ts` and the public export entry `src/feature/index.ts`.
 */
function createSourceCandidateGroups(
  packageRoot: string,
  manifest: WorkspacePackageManifest,
  request: PackageRequest,
  exportTargets: readonly string[],
): readonly (readonly string[])[] {
  const mappedStems = new Set<string>();
  const exactMappedStyles = new Set<string>();
  for (const exportTarget of exportTargets) {
    const targetSegments = exportTarget.slice(2).split('/');
    if (!OUTPUT_DIRECTORY_NAMES.has(targetSegments[0] ?? '')) continue;
    targetSegments[0] = 'src';
    const mappedPath = path.join(packageRoot, ...targetSegments);
    if (EXACT_STYLE_SOURCE_EXTENSIONS.has(path.extname(mappedPath).toLowerCase())) {
      exactMappedStyles.add(mappedPath);
    } else {
      mappedStems.add(removeSourceExtension(mappedPath));
    }
  }

  const groups: string[][] = [[...exactMappedStyles], expandSourceStems(mappedStems)];
  if (request.subpath.length === 0 && typeof manifest.source === 'string') {
    const sourceFieldPath = resolvePackageRelativePath(packageRoot, manifest.source);
    if (sourceFieldPath !== undefined) {
      groups.push(expandSourceStems([removeSourceExtension(sourceFieldPath)]));
    }
  }
  const sourceSubpath = path.join(packageRoot, 'src', request.subpath || 'index');
  groups.push(expandSourceStems([removeSourceExtension(sourceSubpath)]));
  if (request.subpath.length > 0)
    groups.push(expandSourceStems([path.join(sourceSubpath, 'index')]));
  return groups.filter((group) => group.length > 0);
}

/** Expands one or more extensionless source identities into bounded JS/TS candidates. */
function expandSourceStems(stems: Iterable<string>): string[] {
  const candidates: string[] = [];
  for (const stem of stems) {
    for (const extension of SOURCE_EXTENSIONS) candidates.push(`${stem}${extension}`);
  }
  return candidates;
}

/** Removes only JS/TS-family terminal extensions before probing authored source variants. */
function removeSourceExtension(filePath: string): string {
  return filePath.replace(/\.(?:[cm]?[jt]sx?)$/iu, '');
}

/** Returns one canonical source file only when it remains inside package and workspace boundaries. */
async function readExistingWorkspaceSource(
  sourcePath: string,
  packageRoot: string,
  workspaceRoot: string,
): Promise<string | undefined> {
  try {
    const sourceStat = await stat(sourcePath);
    if (!sourceStat.isFile()) return undefined;
    const canonicalSource = canonicalizeExistingPath(sourcePath);
    return isPathInside(packageRoot, canonicalSource) &&
      isPathInside(workspaceRoot, canonicalSource)
      ? canonicalSource
      : undefined;
  } catch {
    return undefined;
  }
}

/** Reports whether any declared runtime artifact unexpectedly exists. */
async function anyPathExists(candidatePaths: readonly string[]): Promise<boolean> {
  for (const candidatePath of candidatePaths) {
    try {
      if ((await stat(candidatePath)).isFile()) return true;
    } catch {
      // Absence is the evidence this adapter is intentionally collecting.
    }
  }
  return false;
}

/** Follows parent directories until a watcher-compatible existing directory is found. */
async function findNearestExistingDirectory(filePath: string): Promise<string> {
  let directory = path.dirname(filePath);
  while (directory !== path.dirname(directory)) {
    try {
      if ((await stat(directory)).isDirectory()) return canonicalizeExistingPath(directory);
    } catch {
      // A missing generated directory is expected; its first existing parent remains watchable.
    }
    directory = path.dirname(directory);
  }
  return directory;
}

/** Reads symbolic-link identity without throwing on an absent node_modules candidate. */
async function isSymbolicLink(candidatePath: string): Promise<boolean> {
  try {
    return (await lstat(candidatePath)).isSymbolicLink();
  } catch {
    return false;
  }
}

/** Narrows JSON values to records without trusting prototypes. */
function isRecord(value: unknown): value is Readonly<Record<string, unknown>> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** Checks containment while accepting the workspace root itself during upward traversal. */
function isPathInsideOrEqual(rootPath: string, candidatePath: string): boolean {
  const relativePath = path.relative(path.resolve(rootPath), path.resolve(candidatePath));
  return (
    relativePath.length === 0 ||
    (relativePath !== '..' &&
      !relativePath.startsWith(`..${path.sep}`) &&
      !path.isAbsolute(relativePath))
  );
}

/** Checks strict containment so a package root itself cannot masquerade as recovered source. */
function isPathInside(rootPath: string, candidatePath: string): boolean {
  const relativePath = path.relative(path.resolve(rootPath), path.resolve(candidatePath));
  return (
    relativePath.length > 0 &&
    relativePath !== '..' &&
    !relativePath.startsWith(`..${path.sep}`) &&
    !path.isAbsolute(relativePath)
  );
}

/** Formats an npm package request for a stable diagnostic. */
function formatPackageRequest(request: PackageRequest): string {
  return request.subpath.length === 0
    ? request.packageName
    : `${request.packageName}/${request.subpath}`;
}

/** Produces a workspace-relative diagnostic without leaking external filesystem locations. */
function formatWorkspacePath(sourcePath: string, workspaceRoot: string): string {
  return path.relative(workspaceRoot, sourcePath).split(path.sep).join('/');
}
