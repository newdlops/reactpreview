/**
 * Converts a bounded Yarn v1 or Berry lockfile into an ordinary, deterministic node_modules plan.
 * The planner performs no network or extraction work. It accepts only exact public npm package
 * resolutions, follows compiler-proven missing roots plus public direct runtime requirements, and
 * keeps Yarn workspace/file/git protocols outside the automatic acquisition boundary.
 */
import { createHash } from 'node:crypto';
import { readFile, stat } from 'node:fs/promises';
import path from 'node:path';
import { parseSyml } from '@yarnpkg/parsers';
import {
  findPreviewDependencySpecifier,
  findPreviewReactDomCompanionSpecifier,
  type PreviewDependencyField,
  type PreviewDependencyProfile,
} from './previewDependencyProfile';

const YARN_LOCK_NAME = 'yarn.lock';
const MAX_LOCKFILE_BYTES = 16 * 1024 * 1024;
const MAX_MANIFEST_BYTES = 1024 * 1024;
const MAX_PACKAGE_COUNT = 1024;
const MAX_DESCRIPTOR_BYTES = 2048;
const PUBLIC_YARN_REGISTRY_HOST = 'registry.yarnpkg.com';
const PUBLIC_NPM_REGISTRY_HOST = 'registry.npmjs.org';
const PACKAGE_NAME_PATTERN =
  /^(?:@[a-z0-9][a-z0-9._~-]*\/[a-z0-9][a-z0-9._~-]*|[a-z0-9][a-z0-9._~-]*)$/u;
const PACKAGE_VERSION_PATTERN =
  /^\d+\.\d+\.\d+(?:-[0-9A-Za-z](?:[0-9A-Za-z.-]*[0-9A-Za-z])?)?(?:\+[0-9A-Za-z](?:[0-9A-Za-z.-]*[0-9A-Za-z])?)?$/u;
const DEPENDENCY_FIELDS: readonly PreviewDependencyField[] = Object.freeze([
  'dependencies',
  'devDependencies',
  'optionalDependencies',
  'peerDependencies',
]);
const RUNTIME_ROOT_FIELDS = [
  'dependencies',
  'optionalDependencies',
  'peerDependencies',
] as const satisfies readonly PreviewDependencyField[];

/** One public package archive and its collision-free destination below managed node_modules. */
export interface PreviewYarnLockedPackagePlanEntry {
  /** Actual manifest package name; aliases can differ from the destination slot name. */
  readonly packageName: string;
  /** SHA-512 SRI copied from Yarn v1; Berry obtains it from exact-version registry metadata. */
  readonly integrity?: string;
  /** Canonical npm registry tarball URL; Berry obtains this together with its integrity metadata. */
  readonly resolved?: string;
  /** Portable ordinary Node layout relative to the staging node_modules directory. */
  readonly targetRelativePath: string;
  /** Exact version selected by the immutable Yarn lock entry. */
  readonly version: string;
}

/** Complete Yarn graph plan plus the evidence mode needed by the acquisition adapter. */
export interface PreviewYarnLockedPackagePlan {
  readonly entries: readonly PreviewYarnLockedPackagePlanEntry[];
  readonly flavor: 'berry' | 'classic';
}

/** Inputs required to revalidate lock and manifest bytes before planning a package closure. */
export interface CreatePreviewYarnLockPlanOptions {
  readonly profile: PreviewDependencyProfile;
  readonly projectRoot: string;
  readonly requiredPackageNames: readonly string[];
}

/** Narrowed descriptor such as `react@^18` or `react@npm:latest`. */
interface YarnDescriptor {
  readonly name: string;
  readonly range: string;
}

/** One exact package record indexed by every equivalent descriptor in the lockfile. */
interface YarnPackageRecord {
  readonly dependencies: Readonly<Record<string, string>>;
  readonly optionalDependencies: ReadonlySet<string>;
  readonly packageName: string;
  readonly integrity?: string;
  readonly resolved?: string;
  readonly version: string;
}

/** One placed package whose record will later be downloaded and extracted. */
interface PlacedYarnPackage {
  readonly identity: string;
  readonly record: YarnPackageRecord;
  readonly targetRelativePath: string;
}

/** One top-level package request, retaining whether compiler evidence requires strict failure. */
interface YarnRootRequest {
  readonly packageName: string;
  readonly required: boolean;
}

/** Normalized manifest maps re-read to reject edits after profile discovery. */
type ManifestRequirements = Readonly<
  Record<PreviewDependencyField, Readonly<Record<string, string>>>
>;

/**
 * Revalidates the selected lock evidence and builds only the requested package closure.
 *
 * @param options Frozen dependency profile, package root, and declared unresolved roots.
 * @returns Deterministic package plan, or `undefined` for unsupported/malformed evidence.
 */
export async function createPreviewYarnLockPlan(
  options: CreatePreviewYarnLockPlanOptions,
): Promise<PreviewYarnLockedPackagePlan | undefined> {
  try {
    const evidence = await readYarnEvidence(options);
    if (evidence === undefined) return undefined;
    const parsed = parseSyml(evidence.lockText) as unknown;
    const lock = readObject(parsed);
    if (lock === undefined) return undefined;
    const flavor = readYarnFlavor(lock);
    if (flavor === undefined) return undefined;
    const recordsByDescriptor = indexYarnRecords(lock, flavor);
    if (recordsByDescriptor === undefined) return undefined;
    const entries = buildYarnPackageLayout(
      recordsByDescriptor,
      flavor,
      options.profile,
      options.requiredPackageNames,
    );
    return entries === undefined ? undefined : Object.freeze({ entries, flavor });
  } catch {
    return undefined;
  }
}

/** Reads bounded current bytes and proves they still match the compiler-selected profile. */
async function readYarnEvidence(
  options: CreatePreviewYarnLockPlanOptions,
): Promise<{ readonly lockText: string } | undefined> {
  const lockPaths = options.profile.dependencyPaths.filter(
    (candidate) => path.basename(candidate) === YARN_LOCK_NAME,
  );
  const lockPath = lockPaths.length === 1 ? lockPaths[0] : undefined;
  const projectRoot = path.resolve(options.projectRoot);
  if (
    !options.profile.hasReusableLockEvidence ||
    options.profile.lockfileEvidenceStatus !== 'reusable' ||
    Object.keys(options.profile.lockfileDigests).length !== 1 ||
    lockPath === undefined ||
    path.resolve(options.profile.manifestPath) !== path.join(projectRoot, 'package.json') ||
    !isPathAtOrInside(path.dirname(lockPath), projectRoot)
  ) {
    return undefined;
  }
  const [lockBytes, manifestBytes] = await Promise.all([
    readBoundedFile(lockPath, MAX_LOCKFILE_BYTES),
    readBoundedFile(options.profile.manifestPath, MAX_MANIFEST_BYTES),
  ]);
  const expectedDigest = options.profile.lockfileDigests[YARN_LOCK_NAME];
  if (
    expectedDigest === undefined ||
    !/^[a-f\d]{64}$/u.test(expectedDigest) ||
    createHash('sha256').update(lockBytes).digest('hex') !== expectedDigest
  ) {
    return undefined;
  }
  const requirements = readManifestRequirements(JSON.parse(manifestBytes.toString('utf8')));
  if (
    requirements === undefined ||
    !requirementsEqual(requirements, options.profile.requirementsByField)
  ) {
    return undefined;
  }
  return Object.freeze({ lockText: lockBytes.toString('utf8') });
}

/** Distinguishes Yarn classic from supported Berry metadata without guessing unknown schemas. */
function readYarnFlavor(lock: Readonly<Record<string, unknown>>): 'berry' | 'classic' | undefined {
  if (!Object.hasOwn(lock, '__metadata')) return 'classic';
  const metadata = readObject(lock.__metadata);
  const metadataVersion = readYarnMetadataVersion(metadata?.version);
  return metadataVersion !== undefined && metadataVersion >= 4 && metadataVersion <= 8
    ? 'berry'
    : undefined;
}

/** Parses the decimal scalar shape returned by parseSyml without widening unknown metadata. */
function readYarnMetadataVersion(value: unknown): number | undefined {
  const version =
    typeof value === 'number'
      ? value
      : typeof value === 'string' && /^\d+$/u.test(value)
        ? Number(value)
        : Number.NaN;
  return Number.isSafeInteger(version) ? version : undefined;
}

/** Builds a descriptor index while rejecting any duplicate descriptor with competing identities. */
function indexYarnRecords(
  lock: Readonly<Record<string, unknown>>,
  flavor: 'berry' | 'classic',
): ReadonlyMap<string, YarnPackageRecord> | undefined {
  const records = new Map<string, YarnPackageRecord>();
  for (const [joinedDescriptors, value] of Object.entries(lock)) {
    if (joinedDescriptors === '__metadata') continue;
    const descriptorNames = splitJoinedDescriptors(joinedDescriptors);
    const recordValue = readObject(value);
    if (descriptorNames === undefined || recordValue === undefined) continue;
    const record = readYarnPackageRecord(recordValue, flavor);
    if (record === undefined) continue;
    for (const descriptorName of descriptorNames) {
      const descriptor = readDescriptor(descriptorName);
      if (descriptor === undefined) continue;
      const previous = records.get(descriptorName);
      if (previous !== undefined && packageIdentity(previous) !== packageIdentity(record)) {
        return undefined;
      }
      records.set(descriptorName, record);
    }
  }
  return records;
}

/** Narrows one classic or Berry package record to public-registry acquisition evidence. */
function readYarnPackageRecord(
  value: Readonly<Record<string, unknown>>,
  flavor: 'berry' | 'classic',
): YarnPackageRecord | undefined {
  if (typeof value.version !== 'string' || !PACKAGE_VERSION_PATTERN.test(value.version)) {
    return undefined;
  }
  const requiredDependencies = readStringMap(value.dependencies);
  if (requiredDependencies === undefined) return undefined;
  const optionalDependencyMap =
    flavor === 'classic' ? readStringMap(value.optionalDependencies) : Object.freeze({});
  if (optionalDependencyMap === undefined) return undefined;
  const dependencies = mergeDependencyMaps(requiredDependencies, optionalDependencyMap);
  const optionalDependencies = readOptionalDependencyNames(value, flavor, requiredDependencies);
  if (optionalDependencies === undefined) return undefined;
  if (flavor === 'classic') {
    if (
      typeof value.integrity !== 'string' ||
      parseSha512Integrity(value.integrity) === undefined
    ) {
      return undefined;
    }
    const archive = readClassicArchive(value.resolved, value.version);
    return archive === undefined
      ? undefined
      : Object.freeze({
          dependencies,
          integrity: value.integrity,
          optionalDependencies,
          packageName: archive.packageName,
          resolved: archive.resolved,
          version: value.version,
        });
  }
  const packageName = readBerryResolutionName(value.resolution, value.version);
  return packageName === undefined
    ? undefined
    : Object.freeze({
        dependencies,
        optionalDependencies,
        packageName,
        version: value.version,
      });
}

/** Creates an ordinary layout with root hoisting, nested conflicts, and finite cycle reuse. */
function buildYarnPackageLayout(
  records: ReadonlyMap<string, YarnPackageRecord>,
  flavor: 'berry' | 'classic',
  profile: PreviewDependencyProfile,
  requiredPackageNames: readonly string[],
): readonly PreviewYarnLockedPackagePlanEntry[] | undefined {
  const placedByPath = new Map<string, PlacedYarnPackage>();
  const queue: PlacedYarnPackage[] = [];
  const rootRequests = selectYarnRootRequests(profile, requiredPackageNames);
  if (rootRequests === undefined) return undefined;
  for (const { packageName, required } of rootRequests) {
    if (placedByPath.size >= MAX_PACKAGE_COUNT) return undefined;
    // Defense in depth mirrors the diagnostic collector: direct planner callers may infer only
    // the exact React DOM companion, and only from a safe direct React registry declaration.
    const specifier =
      findPreviewDependencySpecifier(profile, packageName) ??
      (packageName === 'react-dom' ? findPreviewReactDomCompanionSpecifier(profile) : undefined);
    const record =
      specifier === undefined
        ? undefined
        : records.get(createDescriptorName(packageName, specifier, flavor));
    if (record === undefined) {
      // Compiler-proven misses are the retry contract and therefore fail closed. Runtime
      // supplemental roots are opportunistic: workspace/file/git dependencies deliberately have
      // no accepted public npm record and must not prevent acquisition of the proven package.
      if (required) return undefined;
      continue;
    }
    const placement = placePackage(packageName, record);
    placedByPath.set(packageName, placement);
    queue.push(placement);
  }

  const processedPaths = new Set<string>();
  while (queue.length > 0) {
    const owner = queue.shift();
    if (owner === undefined || processedPaths.has(owner.targetRelativePath)) continue;
    processedPaths.add(owner.targetRelativePath);
    for (const [dependencyName, specifier] of Object.entries(owner.record.dependencies).sort(
      ([left], [right]) => compareStrings(left, right),
    )) {
      const record = records.get(createDescriptorName(dependencyName, specifier, flavor));
      if (record === undefined) {
        if (owner.record.optionalDependencies.has(dependencyName)) continue;
        return undefined;
      }
      const targetRelativePath = selectDependencyPlacement(
        owner.targetRelativePath,
        dependencyName,
        packageIdentity(record),
        placedByPath,
      );
      if (targetRelativePath === undefined) continue;
      if (placedByPath.size >= MAX_PACKAGE_COUNT) return undefined;
      const placement = placePackage(targetRelativePath, record);
      placedByPath.set(targetRelativePath, placement);
      queue.push(placement);
    }
  }

  return Object.freeze(
    [...placedByPath.values()]
      .sort((left, right) => comparePackagePaths(left.targetRelativePath, right.targetRelativePath))
      .map((placement) =>
        Object.freeze({
          ...(placement.record.integrity === undefined
            ? {}
            : { integrity: placement.record.integrity }),
          packageName: placement.record.packageName,
          ...(placement.record.resolved === undefined
            ? {}
            : { resolved: placement.record.resolved }),
          targetRelativePath: placement.targetRelativePath,
          version: placement.record.version,
        }),
      ),
  );
}

/**
 * Combines compiler-proven misses with direct manifest roots needed to satisfy undeclared peers.
 * Runtime fields are supplemental because a Yarn record does not reliably preserve every peer
 * edge. Development-only roots remain excluded unless the compiler explicitly requested them.
 * Required roots are emitted first so the finite package budget cannot be consumed by optional
 * context before the retry contract is represented.
 */
function selectYarnRootRequests(
  profile: PreviewDependencyProfile,
  requiredPackageNames: readonly string[],
): readonly YarnRootRequest[] | undefined {
  const requiredNames = new Set<string>();
  for (const packageName of requiredPackageNames) {
    if (!PACKAGE_NAME_PATTERN.test(packageName)) return undefined;
    requiredNames.add(packageName);
  }

  const supplementalNames = new Set<string>();
  for (const field of RUNTIME_ROOT_FIELDS) {
    for (const packageName of Object.keys(profile.requirementsByField[field])) {
      if (!requiredNames.has(packageName)) supplementalNames.add(packageName);
    }
  }

  return Object.freeze([
    ...[...requiredNames]
      .sort(compareStrings)
      .map((packageName) => Object.freeze({ packageName, required: true })),
    ...[...supplementalNames]
      .sort(compareStrings)
      .map((packageName) => Object.freeze({ packageName, required: false })),
  ]);
}

/** Records one package slot with a content identity used for ancestor-cycle reuse. */
function placePackage(targetRelativePath: string, record: YarnPackageRecord): PlacedYarnPackage {
  return Object.freeze({
    identity: packageIdentity(record),
    record,
    targetRelativePath,
  });
}

/** Chooses the root-most empty slot unless a nearer incompatible package blocks that lookup. */
function selectDependencyPlacement(
  ownerRelativePath: string,
  dependencyName: string,
  identity: string,
  placedByPath: ReadonlyMap<string, PlacedYarnPackage>,
): string | undefined {
  let firstEmpty: string | undefined;
  let rootMostEmpty: string | undefined;
  for (const candidate of dependencyLookupSlots(ownerRelativePath, dependencyName)) {
    const existing = placedByPath.get(candidate);
    if (existing === undefined) {
      firstEmpty ??= candidate;
      rootMostEmpty = candidate;
      continue;
    }
    if (existing.identity === identity) return undefined;
    return firstEmpty;
  }
  return rootMostEmpty;
}

/** Models Node's node_modules ancestor lookup from one already placed package directory. */
function dependencyLookupSlots(
  ownerRelativePath: string,
  dependencyName: string,
): readonly string[] {
  const nodeModulesRoot = '/managed/node_modules';
  let directory = path.posix.join(nodeModulesRoot, ownerRelativePath);
  const slots: string[] = [];
  while (isPortablePathAtOrInside('/managed', directory)) {
    if (path.posix.basename(directory) !== 'node_modules') {
      const candidate = path.posix.relative(
        nodeModulesRoot,
        path.posix.join(directory, 'node_modules', dependencyName),
      );
      if (candidate.length > 0 && !candidate.startsWith('../')) slots.push(candidate);
    }
    if (directory === '/managed') break;
    directory = path.posix.dirname(directory);
  }
  return Object.freeze(slots);
}

/** Reads classic optionalDependencies or Berry dependenciesMeta optional flags. */
function readOptionalDependencyNames(
  value: Readonly<Record<string, unknown>>,
  flavor: 'berry' | 'classic',
  dependencies: Readonly<Record<string, string>>,
): ReadonlySet<string> | undefined {
  if (flavor === 'classic') {
    const optional = readStringMap(value.optionalDependencies);
    if (optional === undefined) return undefined;
    return Object.freeze(
      new Set(Object.keys(optional).filter((name) => !Object.hasOwn(dependencies, name))),
    );
  }
  if (value.dependenciesMeta === undefined) return Object.freeze(new Set<string>());
  const metadata = readObject(value.dependenciesMeta);
  if (metadata === undefined) return undefined;
  const optional = new Set<string>();
  for (const [name, rawMetadata] of Object.entries(metadata)) {
    const entry = readObject(rawMetadata);
    if (!Object.hasOwn(dependencies, name) || entry === undefined) return undefined;
    const isOptional = readYarnBoolean(entry.optional);
    if (entry.optional !== undefined && isOptional === undefined) return undefined;
    if (isOptional === true) optional.add(name);
  }
  return Object.freeze(optional);
}

/** Normalizes boolean YAML scalars because parseSyml preserves Berry scalar text as strings. */
function readYarnBoolean(value: unknown): boolean | undefined {
  if (value === true || value === 'true') return true;
  if (value === false || value === 'false') return false;
  return undefined;
}

/** Classic Yarn keeps a public tarball URL; normalize yarnpkg aliases to the npm registry host. */
function readClassicArchive(
  value: unknown,
  version: string,
): { readonly packageName: string; readonly resolved: string } | undefined {
  if (typeof value !== 'string' || /\s|\\/u.test(value)) return undefined;
  try {
    const url = new URL(value);
    if (
      url.protocol !== 'https:' ||
      (url.hostname !== PUBLIC_YARN_REGISTRY_HOST && url.hostname !== PUBLIC_NPM_REGISTRY_HOST) ||
      url.port.length > 0 ||
      url.username.length > 0 ||
      url.password.length > 0 ||
      url.search.length > 0
    ) {
      return undefined;
    }
    const segments = url.pathname.split('/').filter(Boolean).map(decodeURIComponent);
    const separatorIndex = segments.indexOf('-');
    const nameSegments = segments.slice(0, separatorIndex);
    const packageName = nameSegments.join('/');
    const baseName = packageName.split('/').at(-1);
    const archiveName = segments[separatorIndex + 1];
    if (
      separatorIndex < 1 ||
      separatorIndex !== segments.length - 2 ||
      !PACKAGE_NAME_PATTERN.test(packageName) ||
      baseName === undefined ||
      archiveName !== `${baseName}-${version}.tgz`
    ) {
      return undefined;
    }
    return Object.freeze({
      packageName,
      resolved: `https://${PUBLIC_NPM_REGISTRY_HOST}/${packageName}/-/${archiveName}`,
    });
  } catch {
    return undefined;
  }
}

/** Berry locks exact npm resolutions; archive SRI is intentionally resolved in a later adapter. */
function readBerryResolutionName(value: unknown, version: string): string | undefined {
  if (typeof value !== 'string') return undefined;
  const descriptor = readDescriptor(value);
  if (descriptor === undefined) return undefined;
  const registryRange = unwrapBerryVirtualRange(descriptor.range);
  return registryRange === `npm:${version}` ? descriptor.name : undefined;
}

/** Unwraps only Yarn's bounded virtual-peer locator before validating its exact npm resolution. */
function unwrapBerryVirtualRange(range: string): string {
  if (!range.startsWith('virtual:')) return range;
  const match = /^virtual:([a-f\d]{6,64})#(npm:.+)$/u.exec(range);
  return match?.[2] ?? '';
}

/** Converts authored dependency syntax to the descriptor spelling used by each Yarn generation. */
function createDescriptorName(
  packageName: string,
  specifier: string,
  flavor: 'berry' | 'classic',
): string {
  return `${packageName}@${flavor === 'berry' && !hasProtocol(specifier) ? `npm:${specifier}` : specifier}`;
}

/** Treats only an explicit lowercase URI-like prefix as a Yarn dependency protocol. */
function hasProtocol(value: string): boolean {
  return /^[a-z][a-z\d+.-]*:/iu.test(value);
}

/** Splits Yarn's comma-joined equivalent descriptor key after the parser removes quoting. */
function splitJoinedDescriptors(value: string): readonly string[] | undefined {
  if (Buffer.byteLength(value) > MAX_DESCRIPTOR_BYTES) return undefined;
  const descriptors = value.split(/,\s+/u);
  return descriptors.length > 0 && descriptors.every((descriptor) => readDescriptor(descriptor))
    ? Object.freeze(descriptors)
    : undefined;
}

/** Separates a scoped or unscoped package name from the final descriptor delimiter. */
function readDescriptor(value: string): YarnDescriptor | undefined {
  if (
    value.length === 0 ||
    Buffer.byteLength(value) > MAX_DESCRIPTOR_BYTES ||
    /[\0\r\n]/u.test(value)
  ) {
    return undefined;
  }
  const scopeSlash = value.startsWith('@') ? value.indexOf('/') : -1;
  const delimiter = value.indexOf('@', scopeSlash >= 0 ? scopeSlash + 1 : 0);
  const name = delimiter > 0 ? value.slice(0, delimiter) : '';
  const range = delimiter > 0 ? value.slice(delimiter + 1) : '';
  return PACKAGE_NAME_PATTERN.test(name) && range.length > 0
    ? Object.freeze({ name, range })
    : undefined;
}

/** Includes archive and dependency metadata so conflicting lock records never silently coalesce. */
function packageIdentity(record: YarnPackageRecord): string {
  return createHash('sha256')
    .update(
      JSON.stringify({
        dependencies: record.dependencies,
        integrity: record.integrity ?? null,
        optionalDependencies: [...record.optionalDependencies].sort(compareStrings),
        packageName: record.packageName,
        resolved: record.resolved ?? null,
        version: record.version,
      }),
    )
    .digest('hex');
}

/** Reads string-valued dependency maps and rejects invalid registry package names. */
function readStringMap(value: unknown): Readonly<Record<string, string>> | undefined {
  if (value === undefined) return Object.freeze({});
  const record = readObject(value);
  if (record === undefined) return undefined;
  const entries: (readonly [string, string])[] = [];
  for (const [name, specifier] of Object.entries(record)) {
    if (
      !PACKAGE_NAME_PATTERN.test(name) ||
      typeof specifier !== 'string' ||
      specifier.length === 0
    ) {
      return undefined;
    }
    entries.push([name, specifier]);
  }
  return Object.freeze(
    Object.fromEntries(entries.sort(([left], [right]) => compareStrings(left, right))),
  );
}

/** Merges classic optional edges after required edges while keeping stable property ordering. */
function mergeDependencyMaps(
  required: Readonly<Record<string, string>>,
  optional: Readonly<Record<string, string>>,
): Readonly<Record<string, string>> {
  return Object.freeze(
    Object.fromEntries(
      Object.entries({ ...optional, ...required }).sort(([left], [right]) =>
        compareStrings(left, right),
      ),
    ),
  );
}

/** Re-reads only dependency fields; scripts and package-manager configuration remain inert. */
function readManifestRequirements(value: unknown): ManifestRequirements | undefined {
  const manifest = readObject(value);
  if (manifest === undefined) return undefined;
  const fields = Object.fromEntries(
    DEPENDENCY_FIELDS.map((field) => [field, readStringMap(manifest[field])]),
  ) as Record<PreviewDependencyField, Readonly<Record<string, string>> | undefined>;
  return DEPENDENCY_FIELDS.every((field) => fields[field] !== undefined)
    ? (fields as ManifestRequirements)
    : undefined;
}

/** Compares normalized current manifest maps against profile discovery without path dependence. */
function requirementsEqual(left: ManifestRequirements, right: ManifestRequirements): boolean {
  return DEPENDENCY_FIELDS.every(
    (field) => JSON.stringify(left[field]) === JSON.stringify(right[field]),
  );
}

/** Reads a regular file only after a pre-read and post-read size bound check. */
async function readBoundedFile(filePath: string, maximumBytes: number): Promise<Buffer> {
  const before = await stat(filePath);
  if (!before.isFile() || before.size > maximumBytes)
    throw new Error('Lock evidence is oversized.');
  const contents = await readFile(filePath);
  const after = await stat(filePath);
  if (
    contents.byteLength > maximumBytes ||
    before.dev !== after.dev ||
    before.ino !== after.ino ||
    before.size !== after.size ||
    before.mtimeMs !== after.mtimeMs
  ) {
    throw new Error('Lock evidence changed while it was inspected.');
  }
  return contents;
}

/** Validates a SHA-512 SRI token without accepting weak or multi-token alternatives. */
function parseSha512Integrity(value: string): Buffer | undefined {
  const match = /^sha512-([A-Za-z0-9+/]+={0,2})$/u.exec(value);
  if (match?.[1] === undefined) return undefined;
  const digest = Buffer.from(match[1], 'base64');
  return digest.byteLength === 64 ? digest : undefined;
}

/** Narrows parsed YAML/JSON values to non-array records. */
function readObject(value: unknown): Readonly<Record<string, unknown>> | undefined {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? (value as Readonly<Record<string, unknown>>)
    : undefined;
}

/** Inclusive containment guard for a nearest lock root and nested workspace package root. */
function isPathAtOrInside(rootPath: string, candidatePath: string): boolean {
  const relative = path.relative(path.resolve(rootPath), path.resolve(candidatePath));
  return (
    relative === '' ||
    (relative !== '..' && !relative.startsWith(`..${path.sep}`) && !path.isAbsolute(relative))
  );
}

/** POSIX-only inclusive containment for the synthetic layout planner. */
function isPortablePathAtOrInside(rootPath: string, candidatePath: string): boolean {
  const relative = path.posix.relative(rootPath, candidatePath);
  return (
    relative === '' ||
    (relative !== '..' && !relative.startsWith('../') && !path.posix.isAbsolute(relative))
  );
}

/** Orders package destinations by depth before lexical path for deterministic extraction. */
function comparePackagePaths(left: string, right: string): number {
  return left.split('/').length - right.split('/').length || compareStrings(left, right);
}

/** Locale-independent ordering used in profile-identity-sensitive plans. */
function compareStrings(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}
