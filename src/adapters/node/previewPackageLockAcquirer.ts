/**
 * Converts an exact npm package-lock dependency closure into a verified public archive plan.
 * Package-manager execution, lifecycle scripts, registry configuration, and authentication remain
 * outside this adapter; archive download and extraction are delegated to a reusable safe boundary.
 */
import { createHash } from 'node:crypto';
import { readFile, stat } from 'node:fs/promises';
import path from 'node:path';
import type { PreviewManagedPackageCopyResult } from './previewManagedDependencyAdmission';
import {
  isPublicPreviewPackageArchiveUrl,
  materializePreviewPackageArchives,
  parsePreviewPackageSha512Integrity,
  type PreviewPackageArchiveExtractor,
  type PreviewPackageArchiveTransport,
  type PreviewVerifiedPackageArchivePlanEntry,
} from './previewPackageArchive';
import type { PreviewDependencyField, PreviewDependencyProfile } from './previewDependencyProfile';

export {
  DEFAULT_PREVIEW_PACKAGE_ARCHIVE_EXTRACTOR as DEFAULT_PREVIEW_PACKAGE_LOCK_EXTRACTOR,
  DEFAULT_PREVIEW_PACKAGE_ARCHIVE_TRANSPORT as DEFAULT_PREVIEW_PACKAGE_LOCK_TRANSPORT,
  type PreviewPackageArchiveExtractRequest as PreviewPackageLockExtractRequest,
  type PreviewPackageArchiveExtractor as PreviewPackageLockExtractor,
  type PreviewPackageArchiveTransport as PreviewPackageLockTransport,
  type PreviewPackageArchiveTransportRequest as PreviewPackageLockTransportRequest,
} from './previewPackageArchive';

const PACKAGE_LOCK_NAME = 'package-lock.json';
const MAX_LOCKFILE_BYTES = 16 * 1024 * 1024;
const MAX_MANIFEST_BYTES = 1024 * 1024;
const MAX_PACKAGE_COUNT = 1_024;
const PACKAGE_VERSION_PATTERN =
  /^\d+\.\d+\.\d+(?:-[0-9A-Za-z](?:[0-9A-Za-z.-]*[0-9A-Za-z])?)?(?:\+[0-9A-Za-z](?:[0-9A-Za-z.-]*[0-9A-Za-z])?)?$/u;
const PACKAGE_NAME_PATTERN =
  /^(?:@[a-z0-9][a-z0-9._~-]*\/[a-z0-9][a-z0-9._~-]*|[a-z0-9][a-z0-9._~-]*)$/u;
const DEPENDENCY_FIELDS: readonly PreviewDependencyField[] = Object.freeze([
  'dependencies',
  'devDependencies',
  'optionalDependencies',
  'peerDependencies',
]);

/** Arguments for one exact, bounded package-lock acquisition attempt. */
export interface AcquirePreviewPackageLockDependenciesOptions {
  /** Immutable manifest and nearest-lock evidence selected before compilation. */
  readonly profile: PreviewDependencyProfile;
  /** Package root whose project lock entry declares the starting requirements. */
  readonly projectRoot: string;
  /** Optional unresolved direct package batch; omission acquires every declared direct root. */
  readonly requiredPackageNames?: readonly string[];
  /** Active preview revision cancellation. */
  readonly signal?: AbortSignal;
  /** Fresh unpublished node_modules directory owned by the managed dependency store. */
  readonly targetNodeModulesPath: string;
  /** Optional deterministic transport used by networkless tests. */
  readonly transport?: PreviewPackageArchiveTransport;
  /** Optional deterministic extractor used by tar-free tests. */
  readonly extractor?: PreviewPackageArchiveExtractor;
}

/** Minimal untrusted package-lock shape narrowed before any path or URL is used. */
interface PackageLockDocument {
  readonly packages: Readonly<Record<string, unknown>>;
}

/** One installed package augmented with its lock key for dependency traversal. */
interface LockedPackagePlanEntry extends PreviewVerifiedPackageArchivePlanEntry {
  readonly lockKey: string;
}

/** One unresolved dependency edge while the physical packages map is traversed. */
interface DependencyRequest {
  readonly name: string;
  readonly optional: boolean;
  readonly ownerKey: string;
}

/** Runtime dependency maps and optional-peer metadata read from one lock record. */
interface LockedDependencyMaps {
  readonly dependencies: Readonly<Record<string, string>>;
  readonly optionalDependencies: Readonly<Record<string, string>>;
  readonly optionalPeers: ReadonlySet<string>;
  readonly peerDependencies: Readonly<Record<string, string>>;
}

/**
 * Acquires one package-lock-proven closure into an unpublished managed staging tree.
 *
 * Unsupported or stale evidence returns `undefined` without semver or registry fallback. Caller
 * cancellation remains a rejection; the materializer removes all partially extracted bytes.
 *
 * @param options Exact profile, requested roots, staging path, and optional test adapters.
 * @returns Fully reverified package accounting, or `undefined` after a fail-closed rejection.
 */
export async function acquirePreviewPackageLockDependencies(
  options: AcquirePreviewPackageLockDependenciesOptions,
): Promise<PreviewManagedPackageCopyResult | undefined> {
  if (options.signal?.aborted === true) throw abortReason(options.signal);
  const entries = await createLockedPackagePlan(options).catch(() => undefined);
  if (entries === undefined || entries.length === 0) return undefined;
  return materializePreviewPackageArchives({
    entries,
    ...(options.extractor === undefined ? {} : { extractor: options.extractor }),
    ...(options.signal === undefined ? {} : { signal: options.signal }),
    targetNodeModulesPath: options.targetNodeModulesPath,
    ...(options.transport === undefined ? {} : { transport: options.transport }),
  });
}

/** Reads and validates the one npm package-lock eligible for public acquisition. */
async function createLockedPackagePlan(
  options: AcquirePreviewPackageLockDependenciesOptions,
): Promise<readonly PreviewVerifiedPackageArchivePlanEntry[] | undefined> {
  const lockPath = selectExactPackageLockPath(options.profile);
  if (lockPath === undefined) return undefined;
  const projectRoot = path.resolve(options.projectRoot);
  if (path.resolve(options.profile.manifestPath) !== path.join(projectRoot, 'package.json')) {
    return undefined;
  }
  const lockRoot = path.dirname(lockPath);
  const projectRelativePath = path.relative(lockRoot, projectRoot);
  if (!isContainedRelativePath(projectRelativePath)) return undefined;

  const [manifestBytes, lockBytes] = await Promise.all([
    readBoundedFile(options.profile.manifestPath, MAX_MANIFEST_BYTES),
    readBoundedFile(lockPath, MAX_LOCKFILE_BYTES),
  ]);
  const expectedLockDigest = options.profile.lockfileDigests[PACKAGE_LOCK_NAME];
  if (
    expectedLockDigest === undefined ||
    !/^[a-f\d]{64}$/u.test(expectedLockDigest) ||
    createHash('sha256').update(lockBytes).digest('hex') !== expectedLockDigest
  ) {
    return undefined;
  }
  const currentRequirements = readRequirementMaps(parseJsonObject(manifestBytes));
  if (
    currentRequirements === undefined ||
    !requirementSetsEqual(currentRequirements, options.profile.requirementsByField)
  ) {
    return undefined;
  }
  const document = readPackageLockDocument(parseJsonObject(lockBytes));
  if (document === undefined) return undefined;
  const projectKey = toPortableProjectKey(projectRelativePath);
  const rootRecord = readObject(document.packages['']);
  const projectRecord = readObject(document.packages[projectKey]);
  if (rootRecord === undefined || projectRecord === undefined) return undefined;
  const lockedRequirements = readRequirementMaps(projectRecord);
  if (
    lockedRequirements === undefined ||
    !requirementSetsEqual(lockedRequirements, currentRequirements)
  ) {
    return undefined;
  }
  const selectedNames = selectDirectPackageNames(currentRequirements, options.requiredPackageNames);
  if (selectedNames === undefined || selectedNames.length === 0) return undefined;
  const entries = buildLockedPackageClosure(
    document.packages,
    projectKey,
    projectRecord,
    selectedNames,
  );
  return entries?.map((entry) =>
    Object.freeze({
      packageName: entry.packageName,
      packageVersion: entry.packageVersion,
      sha512Digest: entry.sha512Digest,
      targetRelativePath: entry.targetRelativePath,
      url: entry.url,
    }),
  );
}

/** Requires exactly one reusable package-lock and no competing package-manager evidence. */
function selectExactPackageLockPath(profile: PreviewDependencyProfile): string | undefined {
  if (!profile.hasReusableLockEvidence || profile.lockfileEvidenceStatus !== 'reusable') {
    return undefined;
  }
  if (
    Object.keys(profile.lockfileDigests).length !== 1 ||
    profile.lockfileDigests[PACKAGE_LOCK_NAME] === undefined
  ) {
    return undefined;
  }
  const candidates = profile.dependencyPaths.filter(
    (candidatePath) => path.basename(candidatePath) === PACKAGE_LOCK_NAME,
  );
  return candidates.length === 1 ? path.resolve(candidates[0] ?? '') : undefined;
}

/** Reads a regular bounded file and rechecks its returned byte count. */
async function readBoundedFile(filePath: string, maximumBytes: number): Promise<Buffer> {
  const metadata = await stat(filePath);
  if (!metadata.isFile() || metadata.size > maximumBytes) {
    throw new Error('Dependency evidence exceeds its acquisition safety limit.');
  }
  const bytes = await readFile(filePath);
  if (bytes.byteLength > maximumBytes) {
    throw new Error('Dependency evidence grew beyond its acquisition safety limit.');
  }
  return bytes;
}

/** Parses one UTF-8 JSON object while rejecting arrays and primitive roots. */
function parseJsonObject(bytes: Uint8Array): Readonly<Record<string, unknown>> | undefined {
  try {
    return readObject(JSON.parse(Buffer.from(bytes).toString('utf8')));
  } catch {
    return undefined;
  }
}

/** Narrows package-lock v2/v3 and its authoritative packages map. */
function readPackageLockDocument(
  value: Readonly<Record<string, unknown>> | undefined,
): PackageLockDocument | undefined {
  if (value === undefined || (value.lockfileVersion !== 2 && value.lockfileVersion !== 3)) {
    return undefined;
  }
  const packages = readObject(value.packages);
  return packages === undefined ? undefined : Object.freeze({ packages });
}

/** Reads all dependency maps and rejects malformed fields rather than treating them as empty. */
function readRequirementMaps(
  record: Readonly<Record<string, unknown>> | undefined,
): Readonly<Record<PreviewDependencyField, Readonly<Record<string, string>>>> | undefined {
  if (record === undefined) return undefined;
  const dependencies = readStringMap(record.dependencies);
  const devDependencies = readStringMap(record.devDependencies);
  const optionalDependencies = readStringMap(record.optionalDependencies);
  const peerDependencies = readStringMap(record.peerDependencies);
  if (
    dependencies === undefined ||
    devDependencies === undefined ||
    optionalDependencies === undefined ||
    peerDependencies === undefined
  ) {
    return undefined;
  }
  return Object.freeze({
    dependencies,
    devDependencies,
    optionalDependencies,
    peerDependencies,
  });
}

/** Reads an absent or string-valued dependency object in deterministic order. */
function readStringMap(value: unknown): Readonly<Record<string, string>> | undefined {
  if (value === undefined) return Object.freeze({});
  const record = readObject(value);
  if (record === undefined) return undefined;
  const entries: [string, string][] = [];
  for (const [rawName, rawSpecifier] of Object.entries(record)) {
    if (
      !PACKAGE_NAME_PATTERN.test(rawName) ||
      typeof rawSpecifier !== 'string' ||
      rawSpecifier.trim().length === 0 ||
      rawSpecifier.trim() !== rawSpecifier
    ) {
      return undefined;
    }
    entries.push([rawName, rawSpecifier]);
  }
  entries.sort(([left], [right]) => compareStrings(left, right));
  return Object.freeze(Object.fromEntries(entries));
}

/** Compares all manifest/lock fields exactly so stale evidence cannot select a graph. */
function requirementSetsEqual(
  left: Readonly<Record<PreviewDependencyField, Readonly<Record<string, string>>>>,
  right: Readonly<Record<PreviewDependencyField, Readonly<Record<string, string>>>>,
): boolean {
  return DEPENDENCY_FIELDS.every((field) => stringMapsEqual(left[field], right[field]));
}

/** Compares two dependency maps without relying on source key order. */
function stringMapsEqual(
  left: Readonly<Record<string, string>>,
  right: Readonly<Record<string, string>>,
): boolean {
  const leftKeys = Object.keys(left).sort(compareStrings);
  const rightKeys = Object.keys(right).sort(compareStrings);
  return (
    leftKeys.length === rightKeys.length &&
    leftKeys.every((key, index) => key === rightKeys[index] && left[key] === right[key])
  );
}

/** Selects only actually declared direct roots from an optional unresolved package batch. */
function selectDirectPackageNames(
  requirements: Readonly<Record<PreviewDependencyField, Readonly<Record<string, string>>>>,
  requestedNames: readonly string[] | undefined,
): readonly string[] | undefined {
  const declaredNames = new Set(
    DEPENDENCY_FIELDS.flatMap((field) => Object.keys(requirements[field])),
  );
  if (requestedNames === undefined) {
    return Object.freeze([...declaredNames].sort(compareStrings));
  }
  const selected = [...new Set(requestedNames)];
  if (selected.some((name) => !PACKAGE_NAME_PATTERN.test(name) || !declaredNames.has(name))) {
    return undefined;
  }
  return Object.freeze(selected.sort(compareStrings));
}

/** Traverses runtime, optional, and peer edges through physical Node lock-layout lookup. */
function buildLockedPackageClosure(
  packages: Readonly<Record<string, unknown>>,
  projectKey: string,
  projectRecord: Readonly<Record<string, unknown>>,
  selectedNames: readonly string[],
): readonly LockedPackagePlanEntry[] | undefined {
  const projectMaps = readLockedDependencyMaps(projectRecord);
  if (projectMaps === undefined) return undefined;
  const requests = dependencyRequestsForNames(projectKey, projectMaps, selectedNames);
  const entriesByLockKey = new Map<string, LockedPackagePlanEntry>();
  const lockKeyByTarget = new Map<string, string>();
  while (requests.length > 0) {
    const request = requests.shift();
    if (request === undefined) break;
    const lockKey = resolveInstalledPackageKey(packages, request.ownerKey, request.name);
    if (lockKey === undefined) {
      if (request.optional) continue;
      return undefined;
    }
    if (entriesByLockKey.has(lockKey)) continue;
    const record = readObject(packages[lockKey]);
    if (record === undefined) return undefined;
    const entry = readLockedPackageEntry(lockKey, record);
    if (entry === undefined) return undefined;
    const collisionKey = entry.targetRelativePath.normalize('NFC').toLowerCase();
    const collidingLockKey = lockKeyByTarget.get(collisionKey);
    if (collidingLockKey !== undefined && collidingLockKey !== lockKey) return undefined;
    lockKeyByTarget.set(collisionKey, lockKey);
    entriesByLockKey.set(lockKey, entry);
    if (entriesByLockKey.size > MAX_PACKAGE_COUNT) return undefined;
    const dependencyMaps = readLockedDependencyMaps(record);
    if (dependencyMaps === undefined) return undefined;
    requests.push(...dependencyRequestsForPackage(lockKey, dependencyMaps));
  }
  const entries = [...entriesByLockKey.values()].sort((left, right) => {
    const depth =
      left.targetRelativePath.split('/').length - right.targetRelativePath.split('/').length;
    return depth || compareStrings(left.targetRelativePath, right.targetRelativePath);
  });
  return Object.freeze(entries);
}

/** Reads transitive runtime edges and optional-peer metadata. */
function readLockedDependencyMaps(
  record: Readonly<Record<string, unknown>>,
): LockedDependencyMaps | undefined {
  const dependencies = readStringMap(record.dependencies);
  const optionalDependencies = readStringMap(record.optionalDependencies);
  const peerDependencies = readStringMap(record.peerDependencies);
  if (
    dependencies === undefined ||
    optionalDependencies === undefined ||
    peerDependencies === undefined
  ) {
    return undefined;
  }
  const optionalPeers = readOptionalPeers(record.peerDependenciesMeta, peerDependencies);
  return optionalPeers === undefined
    ? undefined
    : Object.freeze({ dependencies, optionalDependencies, optionalPeers, peerDependencies });
}

/** Narrows optional peer metadata without accepting unknown peer names. */
function readOptionalPeers(
  value: unknown,
  peers: Readonly<Record<string, string>>,
): ReadonlySet<string> | undefined {
  if (value === undefined) return Object.freeze(new Set<string>());
  const metadata = readObject(value);
  if (metadata === undefined) return undefined;
  const optionalPeers = new Set<string>();
  for (const [name, rawEntry] of Object.entries(metadata)) {
    const entry = readObject(rawEntry);
    if (!(name in peers) || entry === undefined || typeof entry.optional !== 'boolean') {
      return undefined;
    }
    if (entry.optional) optionalPeers.add(name);
  }
  return Object.freeze(optionalPeers);
}

/** Creates direct requests while preserving required-over-optional precedence. */
function dependencyRequestsForNames(
  ownerKey: string,
  maps: LockedDependencyMaps,
  names: readonly string[],
): DependencyRequest[] {
  return names.map((name) => ({
    name,
    optional:
      name in maps.optionalDependencies &&
      !(name in maps.dependencies) &&
      (!(name in maps.peerDependencies) || maps.optionalPeers.has(name)),
    ownerKey,
  }));
}

/** Creates transitive requests while excluding package development dependencies. */
function dependencyRequestsForPackage(
  ownerKey: string,
  maps: LockedDependencyMaps,
): DependencyRequest[] {
  const optionalByName = new Map<string, boolean>();
  for (const name of Object.keys(maps.dependencies)) optionalByName.set(name, false);
  for (const name of Object.keys(maps.optionalDependencies)) {
    if (!optionalByName.has(name)) optionalByName.set(name, true);
  }
  for (const name of Object.keys(maps.peerDependencies)) {
    const optional = maps.optionalPeers.has(name);
    if (!optionalByName.has(name) || !optional) optionalByName.set(name, optional);
  }
  return [...optionalByName]
    .sort(([left], [right]) => compareStrings(left, right))
    .map(([name, optional]) => ({ name, optional, ownerKey }));
}

/** Resolves one package using Node's upward node_modules walk over physical lock keys. */
function resolveInstalledPackageKey(
  packages: Readonly<Record<string, unknown>>,
  ownerKey: string,
  packageName: string,
): string | undefined {
  let directoryKey = ownerKey;
  while (directoryKey.length > 0) {
    if (path.posix.basename(directoryKey) !== 'node_modules') {
      const candidate = `${directoryKey}/node_modules/${packageName}`;
      if (Object.hasOwn(packages, candidate)) return candidate;
    }
    const parentKey = path.posix.dirname(directoryKey);
    directoryKey = parentKey === '.' ? '' : parentKey;
  }
  const rootCandidate = `node_modules/${packageName}`;
  return Object.hasOwn(packages, rootCandidate) ? rootCandidate : undefined;
}

/** Validates exact identity, public URL, strong integrity, and portable npm destination. */
function readLockedPackageEntry(
  lockKey: string,
  record: Readonly<Record<string, unknown>>,
): LockedPackagePlanEntry | undefined {
  const installedPath = readInstalledPackagePath(lockKey);
  const packageName = record.name === undefined ? installedPath?.name : record.name;
  if (
    installedPath === undefined ||
    record.link === true ||
    record.inBundle === true ||
    typeof record.version !== 'string' ||
    !PACKAGE_VERSION_PATTERN.test(record.version) ||
    typeof packageName !== 'string' ||
    !PACKAGE_NAME_PATTERN.test(packageName) ||
    typeof record.resolved !== 'string' ||
    !isPublicPreviewPackageArchiveUrl(record.resolved) ||
    typeof record.integrity !== 'string'
  ) {
    return undefined;
  }
  const sha512Digest = parsePreviewPackageSha512Integrity(record.integrity);
  return sha512Digest === undefined
    ? undefined
    : Object.freeze({
        lockKey,
        packageName,
        packageVersion: record.version,
        sha512Digest,
        targetRelativePath: installedPath.targetRelativePath,
        url: record.resolved,
      });
}

/** Parses a packages-map key and strips ancestry before its first node_modules. */
function readInstalledPackagePath(
  lockKey: string,
): { readonly name: string; readonly targetRelativePath: string } | undefined {
  if (!isPortableLockPath(lockKey)) return undefined;
  const segments = lockKey.split('/');
  const firstNodeModulesIndex = segments.indexOf('node_modules');
  if (firstNodeModulesIndex < 0) return undefined;
  let cursor = firstNodeModulesIndex;
  let finalName: string | undefined;
  while (cursor < segments.length) {
    if (segments[cursor] !== 'node_modules') return undefined;
    const first = segments[cursor + 1];
    if (first === undefined) return undefined;
    if (first.startsWith('@')) {
      const second = segments[cursor + 2];
      if (second === undefined) return undefined;
      finalName = `${first}/${second}`;
      cursor += 3;
    } else {
      finalName = first;
      cursor += 2;
    }
    if (!PACKAGE_NAME_PATTERN.test(finalName)) return undefined;
  }
  if (finalName === undefined) return undefined;
  return Object.freeze({
    name: finalName,
    targetRelativePath: segments.slice(firstNodeModulesIndex + 1).join('/'),
  });
}

/** Narrows ordinary JSON records while rejecting arrays and null. */
function readObject(value: unknown): Readonly<Record<string, unknown>> | undefined {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? (value as Readonly<Record<string, unknown>>)
    : undefined;
}

/** Converts an ancestor-relative native path to one package-lock key. */
function toPortableProjectKey(relativePath: string): string {
  return relativePath.length === 0 ? '' : relativePath.split(path.sep).join('/');
}

/** Accepts an empty self path or descendant without upward escape. */
function isContainedRelativePath(relativePath: string): boolean {
  return (
    relativePath.length === 0 ||
    (relativePath !== '..' &&
      !relativePath.startsWith(`..${path.sep}`) &&
      !path.isAbsolute(relativePath) &&
      !relativePath.split(path.sep).includes('..'))
  );
}

/** Validates package-lock keys before reconstructing an npm destination. */
function isPortableLockPath(value: string): boolean {
  return (
    value.length > 0 &&
    value === value.normalize('NFC') &&
    !value.includes('\\') &&
    !value.includes('\0') &&
    !path.posix.isAbsolute(value) &&
    !/^[A-Za-z]:/u.test(value) &&
    value.split('/').every((segment) => segment.length > 0 && segment !== '.' && segment !== '..')
  );
}

/** Normalizes arbitrary cancellation reasons to an Error. */
function abortReason(signal: AbortSignal): Error {
  return signal.reason instanceof Error
    ? signal.reason
    : new Error('Preview dependency acquisition aborted.');
}

/** Produces locale-independent deterministic ordering. */
function compareStrings(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}
