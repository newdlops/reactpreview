/**
 * Discovers conservative dependency-name fallbacks and accepts stronger workspace-module evidence.
 * No webpack/Vite configuration, application module, or dependency entry point is evaluated in the
 * extension host; every result remains inert metadata until esbuild creates the isolated preview.
 */
import { readFile, realpath, stat } from 'node:fs/promises';
import path from 'node:path';
import type {
  PreviewGlobalPackageBridgeCandidate,
  PreviewGlobalPackageBridgeHint,
  PreviewGlobalPackageBridgePlan,
  PreviewGlobalPackageExportKind,
} from './previewGlobalPackageBridge';
import { createPreviewGlobalPackageBridgePlan } from './previewGlobalPackageBridgePlan';

/** Maximum exact-name package candidates whose installed identity may be probed per build. */
const DEFAULT_MAX_PACKAGE_CANDIDATES = 128;

/** Bounded metadata read; normal package manifests are only a few kilobytes. */
const MAX_PACKAGE_MANIFEST_BYTES = 1024 * 1024;

/** Exact automatic package/global convention deliberately excludes aliases and punctuation. */
const EXACT_PACKAGE_GLOBAL = /^[a-z][a-z0-9_]*$/u;
const JAVASCRIPT_IDENTIFIER = /^[A-Za-z_$][A-Za-z0-9_$]*$/u;
const PACKAGE_SEGMENT = /^[A-Za-z0-9][A-Za-z0-9._-]*$/u;
const BROWSER_BUFFER_GLOBAL_NAME = 'Buffer';
const BROWSER_BUFFER_PACKAGE_NAME = 'buffer';
const BROWSER_BUFFER_MODULE_SPECIFIER = 'buffer/';

/** Browser, language, and Node names that package metadata must never replace automatically. */
const UNSAFE_AUTOMATIC_GLOBALS = new Set([
  'arguments',
  'atob',
  'btoa',
  'console',
  'crypto',
  'document',
  'eval',
  'fetch',
  'frames',
  'globalThis',
  'history',
  'Infinity',
  'localStorage',
  'location',
  'module',
  'NaN',
  'navigator',
  'parent',
  'performance',
  'process',
  'prototype',
  'queueMicrotask',
  'require',
  'self',
  'sessionStorage',
  'setInterval',
  'setTimeout',
  'structuredClone',
  'top',
  'undefined',
  'window',
]);

/** Trusted project boundaries and optional stronger compatibility evidence. */
export interface PreviewGlobalPackageBridgeDiscoveryOptions {
  /** Strong-evidence ambiguous/unresolved names that must not fall through to a bare package. */
  readonly blockedGlobalNames?: readonly string[];
  /** Disables every dependency fallback when a stronger evidence inventory was incomplete. */
  readonly disableDependencyFallback?: boolean;
  /** Strong evidence source/module paths retained even when no candidate becomes active. */
  readonly evidenceDependencyPaths?: readonly string[];
  /** Runtime-assignment, ambient-declaration, or explicit mappings gathered by inert analyzers. */
  readonly hints?: readonly PreviewGlobalPackageBridgeHint[];
  /** Safety budget applied after rejecting scoped/hyphenated/unsafe dependency names. */
  readonly maxPackageCandidates?: number;
  /** Nearest package root selected for the target module's consumer resolution. */
  readonly projectRoot: string;
  /** Exact names proven free by source analysis; manifest metadata alone never enables fallback. */
  readonly referencedGlobalNames?: readonly string[];
  /** Workspace boundary above which manifests and hoisted node_modules are ignored. */
  readonly workspaceRoot: string;
}

/** Minimal direct dependency fields read as inert JSON metadata. */
interface PackageManifestMetadata {
  readonly dependencies?: Readonly<Record<string, unknown>>;
  readonly devDependencies?: Readonly<Record<string, unknown>>;
  readonly optionalDependencies?: Readonly<Record<string, unknown>>;
  readonly peerDependencies?: Readonly<Record<string, unknown>>;
}

/** Dependency name paired with nearest-manifest priority for deterministic de-duplication. */
interface DependencyCandidate {
  readonly packageSpecifier: string;
  readonly priority: number;
}

/** Installed package proof retained without loading the dependency entry point. */
interface InstalledPackageIdentity {
  readonly manifestPath: string;
  readonly packageSpecifier: string;
}

/**
 * Plans implicit-global injection from explicit module evidence and exact dependency names.
 *
 * Strong hints may point at a canonical workspace wrapper (for example a project-configured dayjs
 * instance with plugins) or preserve an authored alias plus its consumer directory. Dependency-name
 * fallback is considered only after identifier filtering, so a large scoped dependency set cannot
 * consume the safety budget before a valid `dayjs` candidate is reached.
 *
 * @param options Trusted roots, static hints, and bounded package probe configuration.
 * @returns Frozen priority-resolved plan with cache/HMR dependencies and diagnostics inventory.
 */
export async function discoverPreviewGlobalPackageBridges(
  options: PreviewGlobalPackageBridgeDiscoveryOptions,
): Promise<PreviewGlobalPackageBridgePlan> {
  const workspaceRoot = path.normalize(await realpath(options.workspaceRoot));
  const projectRoot = path.normalize(await realpath(options.projectRoot));
  if (!isPathInside(workspaceRoot, projectRoot)) {
    return createPreviewGlobalPackageBridgePlan({ candidates: [] });
  }

  const dependencyPaths = new Set(options.evidenceDependencyPaths ?? []);
  const dependencyCandidates: DependencyCandidate[] = [];
  for (const [priority, directoryPath] of collectAncestorDirectories(
    projectRoot,
    workspaceRoot,
  ).entries()) {
    const manifestPath = path.join(directoryPath, 'package.json');
    const manifest = await readBoundedPackageManifest(manifestPath);
    if (manifest === undefined) {
      continue;
    }
    dependencyPaths.add(await canonicalizeExistingFile(manifestPath));
    for (const packageSpecifier of collectDependencyNames(manifest)) {
      dependencyCandidates.push({ packageSpecifier, priority });
    }
  }

  const referencedGlobalNames = new Set(options.referencedGlobalNames ?? []);
  const blockedGlobalNames = new Set(options.blockedGlobalNames ?? []);
  const availableExactCandidates = options.disableDependencyFallback
    ? []
    : deduplicateDependencyCandidates(dependencyCandidates).filter((candidate) => {
        const globalName = inferExactPackageGlobalName(candidate.packageSpecifier);
        return globalName !== undefined && !blockedGlobalNames.has(globalName);
      });
  const maximumCandidates = normalizeCandidateBudget(options.maxPackageCandidates);
  const boundedAvailableCandidates = availableExactCandidates.slice(0, maximumCandidates);
  const boundedCandidates = boundedAvailableCandidates.filter((candidate) => {
    const globalName = inferExactPackageGlobalName(candidate.packageSpecifier);
    return globalName !== undefined && referencedGlobalNames.has(globalName);
  });
  const [hintCandidates, installedCandidates, browserCompatibilityCandidates] = await Promise.all([
    Promise.all(
      (options.hints ?? []).map((hint) => createHintCandidate(hint, projectRoot, workspaceRoot)),
    ),
    Promise.all(
      boundedCandidates.map(async (candidate) => ({
        candidate,
        installed: await findInstalledPackageIdentity(
          candidate.packageSpecifier,
          projectRoot,
          workspaceRoot,
        ),
      })),
    ),
    createBrowserCompatibilityCandidates(options, projectRoot, workspaceRoot, blockedGlobalNames),
  ]);

  const candidates: PreviewGlobalPackageBridgeCandidate[] = hintCandidates.filter(
    (candidate): candidate is PreviewGlobalPackageBridgeCandidate => candidate !== undefined,
  );
  candidates.push(...browserCompatibilityCandidates);
  for (const candidate of browserCompatibilityCandidates) {
    dependencyPaths.add(candidate.watchPath);
  }
  for (const { candidate, installed } of installedCandidates) {
    const globalName = inferExactPackageGlobalName(candidate.packageSpecifier);
    if (installed === undefined || globalName === undefined) {
      continue;
    }
    dependencyPaths.add(installed.manifestPath);
    candidates.push({
      evidence: 'dependency-name',
      exportKind: 'auto',
      globalName,
      moduleSpecifier: installed.packageSpecifier,
      resolveDir: projectRoot,
      watchPath: installed.manifestPath,
    });
  }

  return createPreviewGlobalPackageBridgePlan({
    candidates,
    dependencyPaths: [...dependencyPaths],
    fallbackCandidateNames: boundedAvailableCandidates.flatMap((candidate) => {
      const globalName = inferExactPackageGlobalName(candidate.packageSpecifier);
      return globalName === undefined ? [] : [globalName];
    }),
    truncated: availableExactCandidates.length > boundedAvailableCandidates.length,
  });
}

/**
 * Proves standard browser globals whose identifier deliberately differs from its npm package name.
 * These candidates are safe to plan before source traversal because esbuild injects their module
 * only when a loaded file actually contains the free identifier; unused polyfills tree-shake away.
 */
async function createBrowserCompatibilityCandidates(
  options: PreviewGlobalPackageBridgeDiscoveryOptions,
  projectRoot: string,
  workspaceRoot: string,
  blockedGlobalNames: ReadonlySet<string>,
): Promise<readonly PreviewGlobalPackageBridgeCandidate[]> {
  if (
    options.disableDependencyFallback === true ||
    blockedGlobalNames.has(BROWSER_BUFFER_GLOBAL_NAME)
  ) {
    return [];
  }
  const installed = await findInstalledPackageIdentity(
    BROWSER_BUFFER_PACKAGE_NAME,
    projectRoot,
    workspaceRoot,
  );
  return installed === undefined
    ? []
    : [
        {
          evidence: 'dependency-name',
          exportKind: 'named',
          exportName: BROWSER_BUFFER_GLOBAL_NAME,
          globalName: BROWSER_BUFFER_GLOBAL_NAME,
          moduleSpecifier: BROWSER_BUFFER_MODULE_SPECIFIER,
          resolveDir: projectRoot,
          watchPath: installed.manifestPath,
        },
      ];
}

/** Converts stronger analyzer evidence into a generic workspace/package module candidate. */
async function createHintCandidate(
  hint: PreviewGlobalPackageBridgeHint,
  projectRoot: string,
  workspaceRoot: string,
): Promise<PreviewGlobalPackageBridgeCandidate | undefined> {
  const moduleSpecifier = hint.moduleSpecifier ?? hint.packageSpecifier;
  const exportKind = hint.exportKind ?? 'auto';
  const requestedResolveDir = path.resolve(hint.resolveDir ?? projectRoot);
  const resolveDir = await canonicalizeExistingDirectory(requestedResolveDir);
  if (
    moduleSpecifier === undefined ||
    !JAVASCRIPT_IDENTIFIER.test(hint.globalName) ||
    moduleSpecifier.length === 0 ||
    moduleSpecifier.includes('\0') ||
    resolveDir === undefined ||
    !isPathInside(workspaceRoot, resolveDir) ||
    !isValidExportSelection(exportKind, hint.exportName)
  ) {
    return undefined;
  }

  const watchPath = await resolveHintWatchPath(
    hint,
    moduleSpecifier,
    resolveDir,
    projectRoot,
    workspaceRoot,
  );
  if (watchPath === undefined) {
    return undefined;
  }
  return {
    evidence: hint.evidence ?? 'explicit-hint',
    exportKind,
    ...(hint.exportName === undefined ? {} : { exportName: hint.exportName }),
    globalName: hint.globalName,
    moduleSpecifier,
    resolveDir,
    watchPath,
  };
}

/** Proves a hint through its resolved module, absolute specifier, or installed bare package. */
async function resolveHintWatchPath(
  hint: PreviewGlobalPackageBridgeHint,
  moduleSpecifier: string,
  resolveDir: string,
  projectRoot: string,
  workspaceRoot: string,
): Promise<string | undefined> {
  if (hint.watchPath !== undefined) {
    return await canonicalizeTrustedExistingFile(hint.watchPath, workspaceRoot);
  }
  if (path.isAbsolute(moduleSpecifier)) {
    return await canonicalizeTrustedExistingFile(moduleSpecifier, workspaceRoot);
  }
  if (!isSafePackageSpecifier(moduleSpecifier)) {
    return undefined;
  }
  const installed = await findInstalledPackageIdentity(moduleSpecifier, projectRoot, workspaceRoot);
  return installed?.manifestPath;
}

/** Finds a package manifest through nested-to-hoisted node_modules consumer ancestry. */
async function findInstalledPackageIdentity(
  packageSpecifier: string,
  projectRoot: string,
  workspaceRoot: string,
): Promise<InstalledPackageIdentity | undefined> {
  const packageName = getRootPackageName(packageSpecifier);
  if (packageName === undefined) {
    return undefined;
  }
  for (const directoryPath of collectAncestorDirectories(projectRoot, workspaceRoot)) {
    const manifestPath = path.join(directoryPath, 'node_modules', packageName, 'package.json');
    if ((await readBoundedPackageManifest(manifestPath)) === undefined) {
      continue;
    }
    return {
      manifestPath: await canonicalizeExistingFile(manifestPath),
      packageSpecifier,
    };
  }
  return undefined;
}

/** Reads bounded regular JSON and treats normal missing/invalid metadata as absent evidence. */
async function readBoundedPackageManifest(
  manifestPath: string,
): Promise<PackageManifestMetadata | undefined> {
  try {
    const metadata = await stat(manifestPath);
    if (!metadata.isFile() || metadata.size > MAX_PACKAGE_MANIFEST_BYTES) {
      return undefined;
    }
    const parsed: unknown = JSON.parse(await readFile(manifestPath, 'utf8'));
    return typeof parsed === 'object' && parsed !== null ? parsed : undefined;
  } catch (error) {
    if (isIgnorableMetadataError(error)) {
      return undefined;
    }
    throw error;
  }
}

/** Collects direct dependency keys without trusting their version/range value syntax. */
function collectDependencyNames(manifest: PackageManifestMetadata): readonly string[] {
  const dependencyNames = new Set<string>();
  for (const collection of [
    manifest.dependencies,
    manifest.optionalDependencies,
    manifest.peerDependencies,
    manifest.devDependencies,
  ]) {
    if (collection === undefined) {
      continue;
    }
    for (const packageSpecifier of Object.keys(collection)) {
      if (isSafePackageSpecifier(packageSpecifier)) {
        dependencyNames.add(packageSpecifier);
      }
    }
  }
  return [...dependencyNames].sort();
}

/** Keeps nearest-manifest precedence while removing repeated monorepo declarations. */
function deduplicateDependencyCandidates(
  candidates: readonly DependencyCandidate[],
): readonly DependencyCandidate[] {
  const candidateBySpecifier = new Map<string, DependencyCandidate>();
  for (const candidate of candidates) {
    const current = candidateBySpecifier.get(candidate.packageSpecifier);
    if (current === undefined || candidate.priority < current.priority) {
      candidateBySpecifier.set(candidate.packageSpecifier, candidate);
    }
  }
  return [...candidateBySpecifier.values()].sort(
    (left, right) =>
      left.priority - right.priority || left.packageSpecifier.localeCompare(right.packageSpecifier),
  );
}

/** Accepts only an exact unscoped dependency name as an automatic global identifier. */
function inferExactPackageGlobalName(packageSpecifier: string): string | undefined {
  const packageName = getRootPackageName(packageSpecifier);
  return packageName !== undefined &&
    !packageName.startsWith('@') &&
    EXACT_PACKAGE_GLOBAL.test(packageName) &&
    !UNSAFE_AUTOMATIC_GLOBALS.has(packageName)
    ? packageName
    : undefined;
}

/** Validates named exports and rejects stray names on default/namespace/auto modes. */
function isValidExportSelection(
  exportKind: PreviewGlobalPackageExportKind,
  exportName: string | undefined,
): boolean {
  return exportKind === 'named'
    ? exportName !== undefined && JAVASCRIPT_IDENTIFIER.test(exportName)
    : exportName === undefined;
}

/** Accepts plain package identities and subpaths without filesystem/source syntax. */
function isSafePackageSpecifier(packageSpecifier: string): boolean {
  if (
    packageSpecifier.length === 0 ||
    packageSpecifier.startsWith('.') ||
    packageSpecifier.startsWith('/') ||
    packageSpecifier.includes('\\') ||
    packageSpecifier.includes('\0') ||
    packageSpecifier.includes('?') ||
    packageSpecifier.includes('#')
  ) {
    return false;
  }
  const segments = packageSpecifier.split('/');
  if (packageSpecifier.startsWith('@')) {
    return (
      segments.length >= 2 &&
      segments.every((segment, index) =>
        index === 0
          ? segment.startsWith('@') && PACKAGE_SEGMENT.test(segment.slice(1))
          : PACKAGE_SEGMENT.test(segment),
      )
    );
  }
  return segments.every((segment) => PACKAGE_SEGMENT.test(segment));
}

/** Extracts the installed package root from an optional export subpath. */
function getRootPackageName(packageSpecifier: string): string | undefined {
  if (!isSafePackageSpecifier(packageSpecifier)) {
    return undefined;
  }
  const segments = packageSpecifier.split('/');
  if (!packageSpecifier.startsWith('@')) {
    return segments[0];
  }
  const scope = segments[0];
  const packageName = segments[1];
  return scope === undefined || packageName === undefined ? undefined : `${scope}/${packageName}`;
}

/** Enumerates project-to-workspace ancestors without crossing sibling-prefix boundaries. */
function collectAncestorDirectories(projectRoot: string, workspaceRoot: string): readonly string[] {
  const directories: string[] = [];
  let candidate = projectRoot;
  while (isPathInside(workspaceRoot, candidate)) {
    directories.push(candidate);
    if (candidate === workspaceRoot) {
      break;
    }
    const parent = path.dirname(candidate);
    if (parent === candidate) {
      break;
    }
    candidate = parent;
  }
  return directories;
}

/** Applies a finite positive integer budget and ignores invalid caller values. */
function normalizeCandidateBudget(candidate: number | undefined): number {
  return candidate === undefined || !Number.isFinite(candidate) || candidate < 1
    ? DEFAULT_MAX_PACKAGE_CANDIDATES
    : Math.max(1, Math.floor(candidate));
}

/** Canonicalizes a stronger workspace-module evidence file inside the trusted boundary. */
async function canonicalizeTrustedExistingFile(
  filePath: string,
  workspaceRoot: string,
): Promise<string | undefined> {
  try {
    const canonicalPath = await canonicalizeExistingFile(filePath);
    return (await stat(canonicalPath)).isFile() && isPathInside(workspaceRoot, canonicalPath)
      ? canonicalPath
      : undefined;
  } catch (error) {
    if (isIgnorableMetadataError(error)) {
      return undefined;
    }
    throw error;
  }
}

/** Canonicalizes an existing consumer directory while treating transient absence as invalid hint. */
async function canonicalizeExistingDirectory(directoryPath: string): Promise<string | undefined> {
  try {
    const canonicalPath = path.normalize(await realpath(directoryPath));
    return (await stat(canonicalPath)).isDirectory() ? canonicalPath : undefined;
  } catch (error) {
    if (isIgnorableMetadataError(error)) {
      return undefined;
    }
    throw error;
  }
}

/** Produces canonical watch identity for an already-proven regular file. */
async function canonicalizeExistingFile(filePath: string): Promise<string> {
  return path.normalize(await realpath(filePath));
}

/** Distinguishes transient/invalid metadata from unexpected filesystem failures. */
function isIgnorableMetadataError(error: unknown): boolean {
  if (error instanceof SyntaxError) {
    return true;
  }
  if (typeof error !== 'object' || error === null || !('code' in error)) {
    return false;
  }
  const code = (error as { readonly code?: unknown }).code;
  return code === 'ENOENT' || code === 'ENOTDIR';
}

/** Reports containment without accepting a sibling path that merely shares a prefix. */
function isPathInside(rootPath: string, candidatePath: string): boolean {
  const relativePath = path.relative(path.resolve(rootPath), path.resolve(candidatePath));
  return (
    relativePath.length === 0 ||
    (relativePath !== '..' &&
      !relativePath.startsWith(`..${path.sep}`) &&
      !path.isAbsolute(relativePath))
  );
}
