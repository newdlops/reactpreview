/**
 * Builds a deterministic, workspace-independent identity for one project's package requirements.
 * The profile contains inert manifest data only: scripts and package-manager configuration are
 * never evaluated, and filesystem/registry protocols remain useful solely as identity evidence.
 */
import { createHash } from 'node:crypto';
import { readFile, stat } from 'node:fs/promises';
import path from 'node:path';

const PROFILE_SCHEMA_VERSION = 2;
const LOCKFILE_NAMES = [
  'npm-shrinkwrap.json',
  'package-lock.json',
  'pnpm-lock.yaml',
  'yarn.lock',
] as const;
const MAX_LOCKFILE_BYTES = 16 * 1024 * 1024;
/** Manifest dependency maps that can influence browser module resolution. */
export type PreviewDependencyField =
  'dependencies' | 'devDependencies' | 'optionalDependencies' | 'peerDependencies';

/** Whether the nearest package-manager lock evidence can safely identify a reusable graph. */
export type PreviewLockfileEvidenceStatus = 'absent' | 'reusable' | 'unusable';

/** Normalized package requirements used to select a persistent shared environment. */
export interface PreviewDependencyProfile {
  /** Manifest and bounded lockfiles whose edits must invalidate a hot preview environment. */
  readonly dependencyPaths: readonly string[];
  /** Stable content identity independent from workspace path and manifest key ordering. */
  readonly fingerprint: string;
  /** Convenience proof for callers that require a readable bounded lockfile before reuse. */
  readonly hasReusableLockEvidence: boolean;
  /** Absolute inert manifest retained as a rebuild dependency, never copied to shared storage. */
  readonly manifestPath: string;
  /** Content digests make equal ranges with different resolved package graphs distinct. */
  readonly lockfileDigests: Readonly<Record<string, string>>;
  /** Distinguishes no lockfile from evidence that exists but cannot be trusted for reuse. */
  readonly lockfileEvidenceStatus: PreviewLockfileEvidenceStatus;
  /** Dependency maps preserved separately so precedence and conflicts remain inspectable. */
  readonly requirementsByField: Readonly<
    Record<PreviewDependencyField, Readonly<Record<string, string>>>
  >;
  /** Storage format version; changing it invalidates incompatible environments only. */
  readonly schemaVersion: number;
}

/** Minimal JSON package shape accepted from an untrusted workspace manifest. */
interface PreviewPackageManifest {
  readonly dependencies?: unknown;
  readonly devDependencies?: unknown;
  readonly optionalDependencies?: unknown;
  readonly peerDependencies?: unknown;
}

/** One nearest-directory lockfile probe without a workspace-specific identity component. */
interface PreviewLockfileProbe {
  /** Digest of bounded readable bytes, present only for reusable evidence. */
  readonly digest?: string;
  /** Conventional basename used as the path-independent digest key. */
  readonly fileName: (typeof LOCKFILE_NAMES)[number];
  /** Absolute path retained only for dependency invalidation and diagnostics. */
  readonly filePath: string;
  /** Probe outcome; only `absent` permits searching the next ancestor directory. */
  readonly status: PreviewLockfileEvidenceStatus;
}

/** Complete nearest-directory evidence used by profile hashing and rebuild observation. */
interface PreviewLockfileEvidence {
  /** Content digests keyed by conventional basename rather than absolute source path. */
  readonly digests: Readonly<Record<string, string>>;
  /** Existing or unreadable evidence paths whose changes must invalidate this profile. */
  readonly paths: readonly string[];
  /** Reuse safety for the nearest directory containing possible lockfile evidence. */
  readonly status: PreviewLockfileEvidenceStatus;
}

/** Three-part stable release used by conservative bundled-runtime compatibility checks. */
interface StableVersion {
  readonly major: number;
  readonly minor: number;
  readonly patch: number;
}

/**
 * Reads one package manifest and derives a profile suitable for cross-workspace cache reuse.
 *
 * @param projectRoot Nearest package directory selected by the preview compiler.
 * @param workspaceRoot Optional trusted ancestor that bounds nearest-lockfile discovery.
 * @returns Frozen dependency profile, or `undefined` when no readable package manifest exists.
 */
export async function readPreviewDependencyProfile(
  projectRoot: string,
  workspaceRoot: string = projectRoot,
): Promise<PreviewDependencyProfile | undefined> {
  const normalizedProjectRoot = path.resolve(projectRoot);
  const manifestPath = path.join(normalizedProjectRoot, 'package.json');
  let parsed: unknown;
  try {
    parsed = JSON.parse(await readFile(manifestPath, 'utf8'));
  } catch {
    return undefined;
  }
  if (typeof parsed !== 'object' || parsed === null) return undefined;

  const manifest = parsed as PreviewPackageManifest;
  const requirementsByField = Object.freeze({
    dependencies: normalizeDependencyMap(manifest.dependencies),
    devDependencies: normalizeDependencyMap(manifest.devDependencies),
    optionalDependencies: normalizeDependencyMap(manifest.optionalDependencies),
    peerDependencies: normalizeDependencyMap(manifest.peerDependencies),
  });
  const lockfileEvidence = await readNearestLockfileEvidence(
    normalizedProjectRoot,
    normalizeWorkspaceBoundary(normalizedProjectRoot, workspaceRoot),
  );
  const fingerprint = createHash('sha256')
    .update(
      JSON.stringify({
        architecture: process.arch,
        lockfileDigests: lockfileEvidence.digests,
        lockfileEvidenceStatus: lockfileEvidence.status,
        platform: process.platform,
        requirementsByField,
        schemaVersion: PROFILE_SCHEMA_VERSION,
      }),
    )
    .digest('hex');

  return Object.freeze({
    dependencyPaths: Object.freeze([manifestPath, ...lockfileEvidence.paths]),
    fingerprint,
    hasReusableLockEvidence: lockfileEvidence.status === 'reusable',
    lockfileDigests: lockfileEvidence.digests,
    lockfileEvidenceStatus: lockfileEvidence.status,
    manifestPath,
    requirementsByField,
    schemaVersion: PROFILE_SCHEMA_VERSION,
  });
}

/**
 * Finds the nearest ancestor directory with lockfile evidence and hashes only bounded readable data.
 * An inaccessible or oversized file stops the upward search: silently selecting a farther lockfile
 * could associate this package with a different resolved graph than its package manager uses.
 */
async function readNearestLockfileEvidence(
  projectRoot: string,
  workspaceRoot: string,
): Promise<PreviewLockfileEvidence> {
  let directoryPath = projectRoot;
  while (isPathInsideOrEqual(workspaceRoot, directoryPath)) {
    const probes = await Promise.all(
      LOCKFILE_NAMES.map(async (fileName) => probeLockfile(directoryPath, fileName)),
    );
    const presentProbes = probes.filter((probe) => probe.status !== 'absent');
    if (presentProbes.length > 0) {
      const reusableProbes = presentProbes.filter(
        (probe): probe is PreviewLockfileProbe & { readonly digest: string } =>
          probe.status === 'reusable' && probe.digest !== undefined,
      );
      const status: PreviewLockfileEvidenceStatus = presentProbes.every(
        (probe) => probe.status === 'reusable',
      )
        ? 'reusable'
        : 'unusable';
      return Object.freeze({
        digests: Object.freeze(
          Object.fromEntries(
            reusableProbes
              .map((probe) => [probe.fileName, probe.digest] as const)
              .sort(([left], [right]) => left.localeCompare(right)),
          ),
        ),
        paths: Object.freeze(presentProbes.map((probe) => probe.filePath).sort()),
        status,
      });
    }
    if (directoryPath === workspaceRoot) break;
    const parentDirectory = path.dirname(directoryPath);
    if (parentDirectory === directoryPath) break;
    directoryPath = parentDirectory;
  }
  return Object.freeze({
    digests: Object.freeze({}),
    paths: Object.freeze([]),
    status: 'absent',
  });
}

/** Reads one conventional lockfile while preserving unsafe evidence as an explicit unusable state. */
async function probeLockfile(
  directoryPath: string,
  fileName: (typeof LOCKFILE_NAMES)[number],
): Promise<PreviewLockfileProbe> {
  const filePath = path.join(directoryPath, fileName);
  let metadata: Awaited<ReturnType<typeof stat>>;
  try {
    metadata = await stat(filePath);
  } catch (error) {
    return Object.freeze({
      fileName,
      filePath,
      status: isMissingFileError(error) ? 'absent' : 'unusable',
    });
  }
  if (!metadata.isFile() || metadata.size > MAX_LOCKFILE_BYTES) {
    return Object.freeze({ fileName, filePath, status: 'unusable' });
  }
  try {
    const contents = await readFile(filePath);
    return Object.freeze({
      digest: createHash('sha256').update(contents).digest('hex'),
      fileName,
      filePath,
      status: 'reusable',
    });
  } catch {
    // A file proven present above but removed or made unreadable mid-probe is transient evidence,
    // not absence: climbing to a farther ancestor could select a different package-manager graph.
    return Object.freeze({ fileName, filePath, status: 'unusable' });
  }
}

/** Keeps a malformed caller boundary from widening lockfile discovery above the package itself. */
function normalizeWorkspaceBoundary(projectRoot: string, workspaceRoot: string): string {
  const normalizedWorkspaceRoot = path.resolve(workspaceRoot);
  return isPathInsideOrEqual(normalizedWorkspaceRoot, projectRoot)
    ? normalizedWorkspaceRoot
    : projectRoot;
}

/** Reports inclusive containment without accepting sibling paths with a common text prefix. */
function isPathInsideOrEqual(rootPath: string, candidatePath: string): boolean {
  const relativePath = path.relative(path.resolve(rootPath), path.resolve(candidatePath));
  return (
    relativePath.length === 0 ||
    (relativePath !== '..' &&
      !relativePath.startsWith(`..${path.sep}`) &&
      !path.isAbsolute(relativePath))
  );
}

/** Treats only a definite missing path as absence; permissions and transient I/O fail closed. */
function isMissingFileError(error: unknown): boolean {
  return typeof error === 'object' && error !== null && 'code' in error && error.code === 'ENOENT';
}

/**
 * Selects the authored requirement for one package using Node installation precedence.
 *
 * @param profile Normalized project package profile.
 * @param packageName Exact npm package identity.
 * @returns Declared specifier, or `undefined` when the project leaves the package implicit.
 */
export function findPreviewDependencySpecifier(
  profile: PreviewDependencyProfile | undefined,
  packageName: string,
): string | undefined {
  if (profile === undefined) return undefined;
  for (const field of [
    'dependencies',
    'optionalDependencies',
    'peerDependencies',
    'devDependencies',
  ] as const) {
    const specifier = profile.requirementsByField[field][packageName];
    if (specifier !== undefined) return specifier;
  }
  return undefined;
}

/**
 * Conservatively checks whether an exact bundled version satisfies a common npm range form.
 * Unsupported compound, prerelease, alias, URL and workspace forms return `false` instead of
 * guessing; a project with explicit incompatible evidence must never receive another React copy.
 *
 * @param specifier Authored manifest version or range.
 * @param exactVersion Exact bundled package version.
 * @returns Whether the exact version is provably admitted by the authored range.
 */
export function doesPreviewSpecifierAcceptVersion(
  specifier: string | undefined,
  exactVersion: string,
): boolean {
  if (specifier === undefined) return true;
  const candidate = parseStableVersion(exactVersion);
  const normalizedSpecifier = specifier.trim();
  if (
    candidate === undefined ||
    normalizedSpecifier.length === 0 ||
    normalizedSpecifier.includes('||') ||
    /^(?:file|git|github|https?|link|npm|patch|portal|workspace):/iu.test(normalizedSpecifier)
  ) {
    return false;
  }

  const exact = parseStableVersion(normalizedSpecifier.replace(/^=/u, ''));
  if (exact !== undefined) return compareStableVersions(candidate, exact) === 0;

  if (normalizedSpecifier.startsWith('^')) {
    const lower = parseStableVersion(normalizedSpecifier.slice(1));
    return lower !== undefined && acceptsCaretRange(candidate, lower);
  }
  if (normalizedSpecifier.startsWith('~')) {
    const lower = parseStableVersion(normalizedSpecifier.slice(1));
    if (lower === undefined) return false;
    return (
      candidate.major === lower.major &&
      candidate.minor === lower.minor &&
      compareStableVersions(candidate, lower) >= 0
    );
  }
  if (/^[v\d]+(?:\.(?:\d+|x|\*)){0,2}$/iu.test(normalizedSpecifier)) {
    return acceptsWildcardRange(candidate, normalizedSpecifier);
  }
  return acceptsComparatorRange(candidate, normalizedSpecifier);
}

/** Keeps string-valued entries only and sorts them for deterministic hashing/serialization. */
function normalizeDependencyMap(value: unknown): Readonly<Record<string, string>> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    return Object.freeze({});
  }
  const normalizedEntries = Object.entries(value)
    .filter(
      (entry): entry is [string, string] =>
        Boolean(entry[0].trim()) && typeof entry[1] === 'string' && Boolean(entry[1].trim()),
    )
    .map(([packageName, specifier]) => [packageName.trim(), specifier.trim()] as const)
    .sort(([left], [right]) => left.localeCompare(right));
  return Object.freeze(Object.fromEntries(normalizedEntries));
}

/** Parses only complete stable semantic versions; prerelease/build ambiguity is rejected. */
function parseStableVersion(value: string): StableVersion | undefined {
  const match = /^v?(\d+)\.(\d+)\.(\d+)$/u.exec(value.trim());
  if (match === null) return undefined;
  const major = Number(match[1]);
  const minor = Number(match[2]);
  const patch = Number(match[3]);
  return [major, minor, patch].every(Number.isSafeInteger) ? { major, minor, patch } : undefined;
}

/** Implements npm caret upper bounds for stable major, zero-major and zero-minor releases. */
function acceptsCaretRange(candidate: StableVersion, lower: StableVersion): boolean {
  if (compareStableVersions(candidate, lower) < 0) return false;
  if (lower.major > 0) return candidate.major === lower.major;
  if (lower.minor > 0) {
    return candidate.major === 0 && candidate.minor === lower.minor;
  }
  return candidate.major === 0 && candidate.minor === 0 && candidate.patch === lower.patch;
}

/** Checks `1`, `1.x`, `1.2.x`, and their `*` equivalents without widening missing evidence. */
function acceptsWildcardRange(candidate: StableVersion, specifier: string): boolean {
  const segments = specifier.replace(/^v/u, '').split('.');
  const expectedMajor = parseWildcardSegment(segments[0]);
  const expectedMinor = parseWildcardSegment(segments[1]);
  const expectedPatch = parseWildcardSegment(segments[2]);
  return (
    (expectedMajor === undefined || candidate.major === expectedMajor) &&
    (expectedMinor === undefined || candidate.minor === expectedMinor) &&
    (expectedPatch === undefined || candidate.patch === expectedPatch)
  );
}

/** Converts a numeric wildcard segment while treating absence/x/star as unbounded. */
function parseWildcardSegment(segment: string | undefined): number | undefined {
  if (segment === undefined || /^(?:x|\*)$/iu.test(segment)) return undefined;
  const parsed = Number(segment);
  return Number.isSafeInteger(parsed) && parsed >= 0 ? parsed : undefined;
}

/** Supports whitespace-separated comparator intersections such as `>=18.0.0 <20.0.0`. */
function acceptsComparatorRange(candidate: StableVersion, specifier: string): boolean {
  const clauses = specifier.split(/\s+/u).filter(Boolean);
  if (clauses.length === 0) return false;
  return clauses.every((clause) => {
    const match = /^(<=|>=|<|>)(v?\d+\.\d+\.\d+)$/u.exec(clause);
    if (match === null) return false;
    const boundary = parseStableVersion(match[2] ?? '');
    if (boundary === undefined) return false;
    const comparison = compareStableVersions(candidate, boundary);
    if (match[1] === '<') return comparison < 0;
    if (match[1] === '<=') return comparison <= 0;
    if (match[1] === '>') return comparison > 0;
    return comparison >= 0;
  });
}

/** Orders stable semantic versions without floating-point or locale behavior. */
function compareStableVersions(left: StableVersion, right: StableVersion): number {
  return left.major - right.major || left.minor - right.minor || left.patch - right.patch;
}
