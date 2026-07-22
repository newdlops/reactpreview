/**
 * Resolves bare imports to authored npm/Yarn workspace package sources without executing PnP.
 *
 * Static reverse-graph analysis cannot rely on a project's installed dependency state. A Yarn PnP
 * resolver can also point at an absent `.yarn/__virtual__` path after a repository is copied without
 * its install artifacts. This module reads only declarative `package.json` workspace metadata and
 * existing source files, keeping discovery inert, bounded, and inside the trusted workspace.
 */
import { readdirSync, statSync } from 'node:fs';
import path from 'node:path';
import ts from 'typescript';
import {
  canonicalizeExistingPath,
  canonicalizePathThroughExistingAncestor,
} from '../../shared/pathIdentity';

const MAX_MANIFEST_BYTES = 1024 * 1024;
const MAX_WORKSPACE_PATTERNS = 64;
const MAX_WORKSPACE_PACKAGES = 512;
const MAX_SCANNED_DIRECTORIES = 4096;
const MAX_DIRECTORY_ENTRIES = 2048;
const MAX_GLOBSTAR_DEPTH = 12;
const MAX_EXPORT_TARGETS = 32;
const SOURCE_EXTENSIONS = [
  '.tsx',
  '.ts',
  '.jsx',
  '.js',
  '.mts',
  '.cts',
  '.mjs',
  '.cjs',
  '.json',
] as const;
const JAVASCRIPT_EXTENSION_PATTERN = /\.(?:mjs|cjs|jsx|js)$/iu;
const IGNORED_DISCOVERY_DIRECTORIES = new Set([
  '.git',
  '.yarn',
  'build',
  'coverage',
  'dist',
  'node_modules',
  'out',
]);

/** One parsed workspace package whose source root has been proven to stay in the workspace. */
interface WorkspacePackageRecord {
  /** Declarative package metadata; values remain untrusted until individually validated. */
  readonly manifest: Readonly<Record<string, unknown>>;
  /** Canonical directory containing this package's package.json. */
  readonly rootPath: string;
}

/** Mutable counters shared by all workspace-pattern expansions in one resolver. */
interface WorkspaceDiscoveryBudget {
  packageCount: number;
  scannedDirectoryCount: number;
}

/** A parsed bare package request split without applying filesystem semantics to user text. */
interface WorkspacePackageRequest {
  readonly packageName: string;
  readonly subpath: string;
}

/** Read-only package source lookup consumed by the static TypeScript resolver. */
export interface PreviewWorkspacePackageResolver {
  /** Resolves a bare package or package subpath to one existing authored source file. */
  readonly resolve: (moduleSpecifier: string) => string | undefined;
}

/**
 * Creates a lazy workspace resolver backed only by package manifests and existing source paths.
 *
 * Discovery starts on the first bare import miss, so ordinary projects pay no workspace scan cost.
 * Duplicate package names are treated as ambiguous rather than choosing an arbitrary source root.
 *
 * @param workspaceRoot Trusted workspace boundary and location of the root package.json.
 * @returns A cached inert resolver that never imports package code or project configuration.
 */
export function createPreviewWorkspacePackageResolver(
  workspaceRoot: string,
): PreviewWorkspacePackageResolver {
  const canonicalWorkspaceRoot = canonicalizeExistingPath(workspaceRoot);
  let packageRecords: ReadonlyMap<string, WorkspacePackageRecord | undefined> | undefined;
  const resolutionCache = new Map<string, string | undefined>();

  return Object.freeze({
    resolve(moduleSpecifier: string): string | undefined {
      const request = parseWorkspacePackageRequest(moduleSpecifier);
      if (request === undefined) return undefined;
      const cacheKey = `${request.packageName}\0${request.subpath}`;
      if (resolutionCache.has(cacheKey)) return resolutionCache.get(cacheKey);

      packageRecords ??= discoverWorkspacePackages(canonicalWorkspaceRoot);
      const packageRecord = packageRecords.get(request.packageName);
      const resolvedPath =
        packageRecord === undefined
          ? undefined
          : resolveWorkspacePackageRequest(packageRecord, request, canonicalWorkspaceRoot);
      resolutionCache.set(cacheKey, resolvedPath);
      return resolvedPath;
    },
  });
}

/** Reads the root workspaces declaration and indexes a bounded set of uniquely named packages. */
function discoverWorkspacePackages(
  workspaceRoot: string,
): ReadonlyMap<string, WorkspacePackageRecord | undefined> {
  const rootManifest = readPackageManifest(path.join(workspaceRoot, 'package.json'));
  if (rootManifest === undefined) return new Map();

  const budget: WorkspaceDiscoveryBudget = { packageCount: 0, scannedDirectoryCount: 0 };
  const packageRoots = new Set<string>();
  const rootPackageName = readNonEmptyString(rootManifest.name);
  if (rootPackageName !== undefined) packageRoots.add(workspaceRoot);

  for (const pattern of readWorkspacePatterns(rootManifest).slice(0, MAX_WORKSPACE_PATTERNS)) {
    for (const packageRoot of expandWorkspacePattern(workspaceRoot, pattern, budget)) {
      packageRoots.add(packageRoot);
      if (packageRoots.size >= MAX_WORKSPACE_PACKAGES) break;
    }
    if (packageRoots.size >= MAX_WORKSPACE_PACKAGES) break;
  }

  const records = new Map<string, WorkspacePackageRecord | undefined>();
  for (const packageRoot of [...packageRoots].sort()) {
    const manifest =
      packageRoot === workspaceRoot
        ? rootManifest
        : readPackageManifest(path.join(packageRoot, 'package.json'));
    const packageName = readNonEmptyString(manifest?.name);
    if (manifest === undefined || packageName === undefined) continue;
    const record = Object.freeze({ manifest, rootPath: packageRoot });
    if (records.has(packageName)) {
      records.set(packageName, undefined);
    } else {
      records.set(packageName, record);
    }
  }
  return records;
}

/** Normalizes npm/Yarn's array and `{ packages: [] }` workspace declaration forms. */
function readWorkspacePatterns(manifest: Readonly<Record<string, unknown>>): readonly string[] {
  const workspaces = manifest.workspaces;
  const candidates = Array.isArray(workspaces)
    ? workspaces
    : isPlainObject(workspaces) && Array.isArray(workspaces.packages)
      ? workspaces.packages
      : [];
  return [
    ...new Set(
      candidates
        .filter((candidate): candidate is string => typeof candidate === 'string')
        .map(normalizeWorkspacePattern)
        .filter((candidate): candidate is string => candidate !== undefined),
    ),
  ].sort();
}

/** Rejects absolute, negated, escaping, and degenerate workspace patterns before traversal. */
function normalizeWorkspacePattern(pattern: string): string | undefined {
  const normalized = pattern.trim().replaceAll('\\', '/').replace(/^\.\//u, '').replace(/\/$/u, '');
  if (
    normalized.length === 0 ||
    normalized.startsWith('!') ||
    normalized.startsWith('/') ||
    /^[A-Za-z]:/u.test(normalized)
  ) {
    return undefined;
  }
  const segments = normalized.split('/');
  return segments.some((segment) => segment.length === 0 || segment === '.' || segment === '..')
    ? undefined
    : normalized;
}

/** Expands one safe workspace glob with explicit traversal, entry, depth, and result limits. */
function expandWorkspacePattern(
  workspaceRoot: string,
  pattern: string,
  budget: WorkspaceDiscoveryBudget,
): readonly string[] {
  const segments = pattern.split('/');
  const matches = new Set<string>();

  /** Visits only directory candidates proven to remain below the canonical workspace root. */
  function visit(directoryPath: string, segmentIndex: number, globstarDepth: number): void {
    if (
      matches.size >= MAX_WORKSPACE_PACKAGES ||
      budget.scannedDirectoryCount >= MAX_SCANNED_DIRECTORIES
    ) {
      return;
    }
    const trustedDirectory = normalizeTrustedDirectory(directoryPath, workspaceRoot);
    if (trustedDirectory === undefined) return;
    if (segmentIndex >= segments.length) {
      if (readPackageManifest(path.join(trustedDirectory, 'package.json')) !== undefined) {
        matches.add(trustedDirectory);
        budget.packageCount += 1;
      }
      return;
    }

    const segment = segments[segmentIndex];
    if (segment === undefined) return;
    if (segment === '**') {
      visit(trustedDirectory, segmentIndex + 1, globstarDepth);
      if (globstarDepth >= MAX_GLOBSTAR_DEPTH) return;
      for (const childName of readChildDirectoryNames(trustedDirectory, budget)) {
        visit(path.join(trustedDirectory, childName), segmentIndex, globstarDepth + 1);
      }
      return;
    }

    if (!segment.includes('*') && !segment.includes('?')) {
      visit(path.join(trustedDirectory, segment), segmentIndex + 1, globstarDepth);
      return;
    }
    const matcher = compileWorkspaceSegmentMatcher(segment);
    for (const childName of readChildDirectoryNames(trustedDirectory, budget)) {
      if (matcher.test(childName)) {
        visit(path.join(trustedDirectory, childName), segmentIndex + 1, globstarDepth);
      }
    }
  }

  visit(workspaceRoot, 0, 0);
  return [...matches].sort();
}

/** Enumerates safe direct child directories while skipping generated dependency/build trees. */
function readChildDirectoryNames(
  directoryPath: string,
  budget: WorkspaceDiscoveryBudget,
): readonly string[] {
  if (budget.scannedDirectoryCount >= MAX_SCANNED_DIRECTORIES) return [];
  budget.scannedDirectoryCount += 1;
  try {
    return readdirSync(directoryPath, { withFileTypes: true })
      .slice(0, MAX_DIRECTORY_ENTRIES)
      .filter(
        (entry) =>
          entry.isDirectory() &&
          !entry.name.startsWith('.') &&
          !IGNORED_DISCOVERY_DIRECTORIES.has(entry.name),
      )
      .map((entry) => entry.name)
      .sort();
  } catch {
    return [];
  }
}

/** Converts one path segment's `*` and `?` syntax to an anchored, escaped expression. */
function compileWorkspaceSegmentMatcher(segment: string): RegExp {
  const expression = segment
    .replace(/[.+^${}()|[\]\\]/gu, '\\$&')
    .replaceAll('*', '.*')
    .replaceAll('?', '.');
  return new RegExp(`^${expression}$`, 'u');
}

/** Parses scoped and unscoped bare imports while refusing paths and package-internal `#` aliases. */
function parseWorkspacePackageRequest(
  moduleSpecifier: string,
): WorkspacePackageRequest | undefined {
  const cleanSpecifier = moduleSpecifier.split(/[?#]/u, 1)[0]?.trim();
  if (
    cleanSpecifier === undefined ||
    cleanSpecifier.length === 0 ||
    cleanSpecifier.startsWith('.') ||
    cleanSpecifier.startsWith('#') ||
    cleanSpecifier.includes('\\') ||
    path.isAbsolute(cleanSpecifier)
  ) {
    return undefined;
  }
  const segments = cleanSpecifier.split('/');
  const packageSegmentCount = cleanSpecifier.startsWith('@') ? 2 : 1;
  if (
    segments.length < packageSegmentCount ||
    segments
      .slice(0, packageSegmentCount)
      .some((segment) => segment.length === 0 || segment === '.' || segment === '..') ||
    segments
      .slice(packageSegmentCount)
      .some((segment) => segment.length === 0 || segment === '.' || segment === '..')
  ) {
    return undefined;
  }
  return {
    packageName: segments.slice(0, packageSegmentCount).join('/'),
    subpath: segments.slice(packageSegmentCount).join('/'),
  };
}

/** Selects declarative package entry/subpath candidates and returns the first existing source. */
function resolveWorkspacePackageRequest(
  packageRecord: WorkspacePackageRecord,
  request: WorkspacePackageRequest,
  workspaceRoot: string,
): string | undefined {
  const candidates =
    request.subpath.length === 0
      ? collectPackageRootCandidates(packageRecord.manifest)
      : collectPackageSubpathCandidates(packageRecord.manifest, request.subpath);
  for (const relativeCandidate of candidates) {
    const resolvedPath = resolvePackageSourceCandidate(
      packageRecord.rootPath,
      relativeCandidate,
      workspaceRoot,
    );
    if (resolvedPath !== undefined) return resolvedPath;
  }
  return undefined;
}

/** Orders package-root candidates toward authored source before optional generated distributions. */
function collectPackageRootCandidates(
  manifest: Readonly<Record<string, unknown>>,
): readonly string[] {
  const publishConfig = isPlainObject(manifest.publishConfig) ? manifest.publishConfig : undefined;
  return deduplicateStrings([
    readPackageEntryTarget(manifest.source),
    readPackageEntryTarget(publishConfig?.source),
    './src/index',
    ...collectExportTargets(manifest.exports, '.'),
    readPackageEntryTarget(manifest.module),
    readPackageEntryTarget(manifest.main),
    readPackageEntryTarget(manifest.browser),
    './index',
  ]);
}

/** Resolves exact/wildcard exports before conventional package-root and source-root subpaths. */
function collectPackageSubpathCandidates(
  manifest: Readonly<Record<string, unknown>>,
  subpath: string,
): readonly string[] {
  const publishConfig = isPlainObject(manifest.publishConfig) ? manifest.publishConfig : undefined;
  const authoredSourceRoots = [manifest.source, publishConfig?.source]
    .map(readPackageEntryTarget)
    .filter((candidate): candidate is string => candidate !== undefined)
    .map((candidate) => `${path.posix.dirname(candidate)}/${subpath}`);
  return deduplicateStrings([
    ...authoredSourceRoots,
    `./src/${subpath}`,
    ...collectExportTargets(manifest.exports, `./${subpath}`),
    `./${subpath}`,
  ]);
}

/** Extracts a bounded set of relative targets from an exports entry or conditional target object. */
function collectExportTargets(exportsValue: unknown, requestedKey: string): readonly string[] {
  let selectedValue: unknown = exportsValue;
  if (isPlainObject(exportsValue)) {
    const exportKeys = Object.keys(exportsValue);
    if (exportKeys.some((key) => key.startsWith('.'))) {
      selectedValue = selectSubpathExport(exportsValue, requestedKey);
    } else if (requestedKey !== '.') {
      return [];
    }
  } else if (requestedKey !== '.') {
    return [];
  }

  const targets: string[] = [];
  collectConditionalExportTargets(selectedValue, targets, 0);
  return deduplicateStrings(targets).slice(0, MAX_EXPORT_TARGETS);
}

/** Selects one exact or single-wildcard package export without interpreting package conditions. */
function selectSubpathExport(
  exportsValue: Readonly<Record<string, unknown>>,
  requestedKey: string,
): unknown {
  if (Object.hasOwn(exportsValue, requestedKey)) return exportsValue[requestedKey];
  for (const [exportPattern, target] of Object.entries(exportsValue)) {
    const wildcardOffset = exportPattern.indexOf('*');
    if (wildcardOffset < 0 || exportPattern.slice(wildcardOffset + 1).includes('*')) continue;
    const prefix = exportPattern.slice(0, wildcardOffset);
    const suffix = exportPattern.slice(wildcardOffset + 1);
    if (!requestedKey.startsWith(prefix) || !requestedKey.endsWith(suffix)) continue;
    const wildcardValue = requestedKey.slice(prefix.length, requestedKey.length - suffix.length);
    return substituteExportWildcard(target, wildcardValue);
  }
  return undefined;
}

/** Recursively substitutes a selected exports wildcard while retaining the declarative structure. */
function substituteExportWildcard(value: unknown, wildcardValue: string): unknown {
  if (typeof value === 'string') return value.replaceAll('*', wildcardValue);
  if (Array.isArray(value)) {
    return value.map((candidate) => substituteExportWildcard(candidate, wildcardValue));
  }
  if (isPlainObject(value)) {
    return Object.fromEntries(
      Object.entries(value).map(([key, candidate]) => [
        key,
        substituteExportWildcard(candidate, wildcardValue),
      ]),
    );
  }
  return value;
}

/** Flattens strings from conditional/array exports with depth and result limits. */
function collectConditionalExportTargets(value: unknown, targets: string[], depth: number): void {
  if (depth > 8 || targets.length >= MAX_EXPORT_TARGETS) return;
  const relativeTarget = readRelativePackageTarget(value);
  if (relativeTarget !== undefined) {
    targets.push(relativeTarget);
    return;
  }
  if (Array.isArray(value)) {
    for (const candidate of value) {
      collectConditionalExportTargets(candidate, targets, depth + 1);
      if (targets.length >= MAX_EXPORT_TARGETS) return;
    }
    return;
  }
  if (isPlainObject(value)) {
    for (const candidate of Object.values(value)) {
      collectConditionalExportTargets(candidate, targets, depth + 1);
      if (targets.length >= MAX_EXPORT_TARGETS) return;
    }
  }
}

/** Resolves file, extension-substituted, and directory-index candidates inside one package root. */
function resolvePackageSourceCandidate(
  packageRoot: string,
  relativeCandidate: string,
  workspaceRoot: string,
): string | undefined {
  if (!relativeCandidate.startsWith('./')) return undefined;
  const lexicalCandidate = path.resolve(packageRoot, relativeCandidate);
  const canonicalCandidate = canonicalizePathThroughExistingAncestor(lexicalCandidate);
  if (
    !isPathInside(packageRoot, canonicalCandidate) ||
    !isPathInside(workspaceRoot, canonicalCandidate)
  ) {
    return undefined;
  }

  const candidates = [lexicalCandidate];
  if (JAVASCRIPT_EXTENSION_PATTERN.test(lexicalCandidate)) {
    const extensionlessCandidate = lexicalCandidate.replace(JAVASCRIPT_EXTENSION_PATTERN, '');
    candidates.push(
      ...SOURCE_EXTENSIONS.map((extension) => `${extensionlessCandidate}${extension}`),
    );
  } else if (path.extname(lexicalCandidate).length === 0) {
    candidates.push(...SOURCE_EXTENSIONS.map((extension) => `${lexicalCandidate}${extension}`));
  }
  candidates.push(
    ...SOURCE_EXTENSIONS.map((extension) => path.join(lexicalCandidate, `index${extension}`)),
  );
  for (const candidate of candidates) {
    if (!ts.sys.fileExists(candidate)) continue;
    const canonicalPath = canonicalizeExistingPath(candidate);
    if (isPathInside(packageRoot, canonicalPath) && isPathInside(workspaceRoot, canonicalPath)) {
      return canonicalPath;
    }
  }
  return undefined;
}

/** Reads one bounded JSON object, returning undefined for missing, oversized, or malformed files. */
function readPackageManifest(manifestPath: string): Readonly<Record<string, unknown>> | undefined {
  try {
    if (statSync(manifestPath).size > MAX_MANIFEST_BYTES) return undefined;
    const parsedValue: unknown = JSON.parse(ts.sys.readFile(manifestPath) ?? '');
    return isPlainObject(parsedValue) ? parsedValue : undefined;
  } catch {
    return undefined;
  }
}

/** Accepts a source target only when it is a package-relative path. */
function readRelativePackageTarget(value: unknown): string | undefined {
  return typeof value === 'string' && value.startsWith('./') ? value : undefined;
}

/** Normalizes source/main/module fields, whose npm syntax may omit the leading `./`. */
function readPackageEntryTarget(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined;
  const normalizedValue = value.trim();
  if (
    normalizedValue.length === 0 ||
    normalizedValue.includes('\\') ||
    path.posix.isAbsolute(normalizedValue) ||
    normalizedValue.split('/').some((segment) => segment === '..')
  ) {
    return undefined;
  }
  return normalizedValue.startsWith('./') ? normalizedValue : `./${normalizedValue}`;
}

/** Reads a non-empty manifest string without coercing unexpected JSON values. */
function readNonEmptyString(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim().length > 0 ? value.trim() : undefined;
}

/** Narrows parsed JSON records while rejecting arrays and null. */
function isPlainObject(value: unknown): value is Readonly<Record<string, unknown>> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** Removes undefined and duplicate package candidates while preserving priority order. */
function deduplicateStrings(values: readonly (string | undefined)[]): readonly string[] {
  return [...new Set(values.filter((value): value is string => value !== undefined))];
}

/** Canonicalizes one existing directory and enforces the trusted workspace boundary. */
function normalizeTrustedDirectory(
  directoryPath: string,
  workspaceRoot: string,
): string | undefined {
  const lexicalPath = path.resolve(directoryPath);
  if (!isPathInside(workspaceRoot, lexicalPath) || !ts.sys.directoryExists(lexicalPath)) {
    return undefined;
  }
  const canonicalPath = canonicalizeExistingPath(lexicalPath);
  return isPathInside(workspaceRoot, canonicalPath) ? canonicalPath : undefined;
}

/** Checks containment without accepting a sibling path that merely shares the root prefix. */
function isPathInside(rootPath: string, candidatePath: string): boolean {
  const relativePath = path.relative(path.resolve(rootPath), path.resolve(candidatePath));
  return (
    relativePath.length === 0 ||
    (relativePath !== '..' &&
      !relativePath.startsWith(`..${path.sep}`) &&
      !path.isAbsolute(relativePath))
  );
}
