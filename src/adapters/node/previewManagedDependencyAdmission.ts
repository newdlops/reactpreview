/**
 * Extracts browser-reached packages from an esbuild graph and copies bounded immutable package
 * trees into a managed environment. Every source root is proven through real paths, nested package
 * installations remain independent copy units, and staged bytes are re-read before publication.
 */
import { createHash, type Hash } from 'node:crypto';
import { cp, lstat, mkdir, open, readFile, readdir, realpath } from 'node:fs/promises';
import path from 'node:path';

const NODE_MODULES_SEGMENT = 'node_modules';
const MAX_ADMITTED_BYTES = 256 * 1024 * 1024;
const MAX_ADMITTED_FILES = 40_000;
const MAX_ADMITTED_FILE_BYTES = 32 * 1024 * 1024;
const PACKAGE_VERSION_PATTERN = /^\d+\.\d+\.\d+(?:[-+].+)?$/u;
const SENSITIVE_PACKAGE_FILE_PATTERN = /^(?:\.env(?:\..*)?|\.npmrc|\.yarnrc(?:\..*)?)$/iu;

/** One package tree and its collision-free destination below a shared node_modules root. */
export interface PreviewManagedPackageCopy {
  /** Canonical package directory proven to remain inside its originating workspace or seed root. */
  readonly sourceRoot: string;
  /** Portable npm layout below the managed environment's node_modules directory. */
  readonly targetRelativePath: string;
}

/** Safe metadata persisted without retaining the originating workspace path. */
export interface PreviewManagedPackageIdentity {
  /** Deterministic digest over package-owned relative paths and regular-file bytes. */
  readonly contentDigest: string;
  /** Exact package identity declared by its installed manifest. */
  readonly name: string;
  /** Portable location used by Node/esbuild resolution inside the managed environment. */
  readonly relativePath: string;
  /** Exact installed package version. */
  readonly version: string;
}

/** Bounded copy result used to validate and account for one immutable environment. */
export interface PreviewManagedPackageCopyResult {
  /** Total regular-file bytes admitted into the environment. */
  readonly bytes: number;
  /** Deterministic digest over ordered package paths, versions, and package-tree digests. */
  readonly contentDigest: string;
  /** Total regular files admitted into the environment. */
  readonly files: number;
  /** Package identities retained in deterministic destination order. */
  readonly packages: readonly PreviewManagedPackageIdentity[];
}

/** Deterministic verification result for one package-owned tree. */
export interface PreviewManagedPackageTreeVerification {
  /** Total bytes in regular files owned directly by this package. */
  readonly bytes: number;
  /** Digest framed by entry kind, portable relative path, size, and exact file bytes. */
  readonly contentDigest: string;
  /** Total regular files owned directly by this package. */
  readonly files: number;
  /** Manifest package name verified after the copy completed. */
  readonly name: string;
  /** Manifest package version verified after the copy completed. */
  readonly version: string;
}

/** Internal package manifest fields required to reject ambiguous or private package roots. */
interface PackageIdentityManifest {
  readonly name?: unknown;
  readonly private?: unknown;
  readonly version?: unknown;
}

/** Package identity read before a copy and checked again against the completed staging tree. */
interface PreviewManagedPackageDescriptor {
  readonly name: string;
  readonly version: string;
}

/** Mutable budget shared by every source or staged package in one environment. */
interface CopyBudget {
  bytes: number;
  files: number;
}

/** Mutable deterministic digest state for one package-owned tree walk. */
interface PackageTreeInspection {
  readonly budget: CopyBudget;
  readonly hash: Hash;
}

/**
 * Converts reached filesystem inputs to a portable, non-overlapping package copy plan.
 *
 * Both lexical ancestry and realpath ancestry are checked. This deliberately rejects ordinary
 * packages reached through a symlink below the workspace even when that link happens to point back
 * into the workspace: a later link retarget must not change which bytes global storage receives.
 *
 * @param dependencyPaths Absolute esbuild input paths from one successful preview graph.
 * @param workspaceRoot Trusted workspace boundary containing ordinary installed packages.
 * @returns Package roots, or an empty plan when version/layout collisions make reuse unsafe.
 */
export async function collectPreviewManagedPackageCopies(
  dependencyPaths: readonly string[],
  workspaceRoot: string,
): Promise<readonly PreviewManagedPackageCopy[]> {
  const lexicalWorkspaceRoot = path.resolve(workspaceRoot);
  let canonicalWorkspaceRoot: string;
  try {
    canonicalWorkspaceRoot = await realpath(lexicalWorkspaceRoot);
  } catch {
    return Object.freeze([]);
  }

  const copyByTarget = new Map<string, PreviewManagedPackageCopy>();
  for (const dependencyPath of dependencyPaths) {
    const copy = await locatePortablePackageCopy(
      dependencyPath,
      lexicalWorkspaceRoot,
      canonicalWorkspaceRoot,
    );
    if (copy === undefined) continue;
    const existing = copyByTarget.get(copy.targetRelativePath);
    if (existing !== undefined && existing.sourceRoot !== copy.sourceRoot) {
      return Object.freeze([]);
    }
    copyByTarget.set(copy.targetRelativePath, copy);
  }

  // Parent packages must be copied before their separately reached nested dependencies. Parent
  // copies exclude their own node_modules tree, so the two destinations never overlap.
  return Object.freeze(
    [...copyByTarget.values()].sort((left, right) => {
      const depthDifference =
        countPathSegments(left.targetRelativePath) - countPathSegments(right.targetRelativePath);
      return (
        depthDifference || comparePortablePaths(left.targetRelativePath, right.targetRelativePath)
      );
    }),
  );
}

/**
 * Copies one package set below an unpublished staging node_modules directory.
 *
 * @param copies Collision-free package roots selected from a successful build.
 * @param targetNodeModulesPath Empty staging node_modules directory.
 * @returns Exact identities, content digests, and post-copy byte/file accounting.
 */
export async function copyPreviewManagedPackages(
  copies: readonly PreviewManagedPackageCopy[],
  targetNodeModulesPath: string,
): Promise<PreviewManagedPackageCopyResult> {
  const sourceBudget: CopyBudget = { bytes: 0, files: 0 };
  const packageIdentities: PreviewManagedPackageIdentity[] = [];
  const copiedRelativePaths = new Set<string>();
  const normalizedNodeModulesPath = path.resolve(targetNodeModulesPath);
  await mkdir(normalizedNodeModulesPath, { recursive: true });

  for (const copy of copies) {
    let canonicalSourceRoot: string;
    try {
      canonicalSourceRoot = await realpath(copy.sourceRoot);
    } catch {
      continue;
    }
    const descriptor = await readPackageDescriptor(canonicalSourceRoot);
    const expectedName = readPackageNameFromRelativePath(copy.targetRelativePath);
    if (descriptor === undefined || descriptor.name !== expectedName) continue;
    if (!hasCopiedNestedOwner(copy.targetRelativePath, copiedRelativePaths)) continue;

    const targetRoot = path.resolve(normalizedNodeModulesPath, copy.targetRelativePath);
    if (!isPathInside(normalizedNodeModulesPath, targetRoot)) {
      throw new Error('Managed dependency destination escaped its node_modules boundary.');
    }
    await mkdir(path.dirname(targetRoot), { recursive: true });
    await cp(canonicalSourceRoot, targetRoot, {
      dereference: false,
      errorOnExist: true,
      filter: async (sourcePath) =>
        shouldCopyPackagePath(sourcePath, canonicalSourceRoot, sourceBudget),
      force: false,
      recursive: true,
      verbatimSymlinks: true,
    });

    const verification = await verifyPreviewManagedPackageTree(targetRoot);
    if (verification.name !== descriptor.name || verification.version !== descriptor.version) {
      throw new Error('Managed dependency identity changed while its package tree was copied.');
    }
    packageIdentities.push(
      Object.freeze({
        contentDigest: verification.contentDigest,
        name: verification.name,
        relativePath: copy.targetRelativePath,
        version: verification.version,
      }),
    );
    copiedRelativePaths.add(copy.targetRelativePath);
  }

  return verifyPreviewManagedPackages(packageIdentities, normalizedNodeModulesPath);
}

/**
 * Recomputes one package's deterministic digest and rejects links, private manifests, sensitive
 * configuration, special files, or budget violations. Nested node_modules are separate package
 * identities and therefore excluded from the owning package's digest.
 *
 * @param packageRoot Completed staging or committed package directory.
 * @returns Verified package manifest identity, digest, and package-owned size accounting.
 */
export async function verifyPreviewManagedPackageTree(
  packageRoot: string,
): Promise<PreviewManagedPackageTreeVerification> {
  const normalizedPackageRoot = path.resolve(packageRoot);
  const rootStatus = await lstat(normalizedPackageRoot);
  if (rootStatus.isSymbolicLink() || !rootStatus.isDirectory()) {
    throw new Error('Managed dependency package root is not an ordinary directory.');
  }

  const inspection: PackageTreeInspection = {
    budget: { bytes: 0, files: 0 },
    hash: createHash('sha256'),
  };
  await inspectPackageOwnedDirectory(normalizedPackageRoot, '', inspection);
  const descriptor = await readPackageDescriptor(normalizedPackageRoot);
  if (descriptor === undefined) {
    throw new Error('Managed dependency package manifest is missing, private, or invalid.');
  }
  return Object.freeze({
    bytes: inspection.budget.bytes,
    contentDigest: inspection.hash.digest('hex'),
    files: inspection.budget.files,
    name: descriptor.name,
    version: descriptor.version,
  });
}

/**
 * Verifies the complete staged package set after all nested destinations have been assembled.
 * The whole environment walk catches a link inserted beneath a parent package's node_modules after
 * that parent's package-owned digest was calculated; every recorded identity is then recomputed.
 */
export async function verifyPreviewManagedPackageSet(
  targetNodeModulesPath: string,
  packages: readonly PreviewManagedPackageIdentity[],
): Promise<Readonly<CopyBudget>> {
  const normalizedNodeModulesPath = path.resolve(targetNodeModulesPath);
  const seenRelativePaths = new Set<string>();
  for (const identity of packages) {
    if (seenRelativePaths.has(identity.relativePath)) {
      throw new Error('Managed dependency package set contains a duplicate destination.');
    }
    seenRelativePaths.add(identity.relativePath);
    const packageRoot = path.resolve(normalizedNodeModulesPath, identity.relativePath);
    if (!isPathInside(normalizedNodeModulesPath, packageRoot)) {
      throw new Error('Managed dependency identity escaped its node_modules boundary.');
    }
    const verification = await verifyPreviewManagedPackageTree(packageRoot);
    if (
      verification.name !== identity.name ||
      verification.version !== identity.version ||
      verification.contentDigest !== identity.contentDigest
    ) {
      throw new Error('Managed dependency package content changed after staging.');
    }
  }
  // Keep the link/special-file walk last. Package digest reads deliberately ignore separately owned
  // nested node_modules, while this final pass covers the assembled environment without exclusions.
  const environmentBudget: CopyBudget = { bytes: 0, files: 0 };
  await inspectStagedDirectory(normalizedNodeModulesPath, '', environmentBudget);
  return Object.freeze({ ...environmentBudget });
}

/**
 * Revalidates a complete staged or committed package environment and derives its aggregate digest.
 * This is the persistence-facing API: callers can compare every returned field with immutable
 * environment metadata before adding its node_modules path to TypeScript or esbuild resolution.
 *
 * @param packages Exact package identities recorded when the environment was staged.
 * @param targetNodeModulesPath Managed environment's node_modules directory.
 * @returns Recomputed accounting, deterministic set digest, and sorted immutable identities.
 */
export function verifyPreviewManagedPackages(
  packages: readonly PreviewManagedPackageIdentity[],
  targetNodeModulesPath: string,
): Promise<PreviewManagedPackageCopyResult>;
/** Compatibility overload retaining path-first call sites while store integration is migrated. */
export function verifyPreviewManagedPackages(
  targetNodeModulesPath: string,
  packages: readonly PreviewManagedPackageIdentity[],
): Promise<PreviewManagedPackageCopyResult>;
export async function verifyPreviewManagedPackages(
  first: string | readonly PreviewManagedPackageIdentity[],
  second: string | readonly PreviewManagedPackageIdentity[],
): Promise<PreviewManagedPackageCopyResult> {
  const packages = typeof first === 'string' ? second : first;
  const targetNodeModulesPath = typeof first === 'string' ? first : second;
  if (typeof targetNodeModulesPath !== 'string' || typeof packages === 'string') {
    throw new TypeError('Managed dependency verification received invalid package-set arguments.');
  }
  const orderedPackages = Object.freeze(
    [...packages].sort((left, right) =>
      comparePortablePaths(left.relativePath, right.relativePath),
    ),
  );
  const budget = await verifyPreviewManagedPackageSet(targetNodeModulesPath, orderedPackages);
  const hash = createHash('sha256');
  for (const identity of orderedPackages) {
    updateDigestFrame(hash, 'relative-path', toPortablePath(identity.relativePath));
    updateDigestFrame(hash, 'package-name', identity.name);
    updateDigestFrame(hash, 'package-version', identity.version);
    updateDigestFrame(hash, 'content-digest', identity.contentDigest);
  }
  return Object.freeze({
    bytes: budget.bytes,
    contentDigest: hash.digest('hex'),
    files: budget.files,
    packages: orderedPackages,
  });
}

/** Maps one input to its deepest ordinary package root and portable nested npm location. */
async function locatePortablePackageCopy(
  dependencyPath: string,
  lexicalWorkspaceRoot: string,
  canonicalWorkspaceRoot: string,
): Promise<PreviewManagedPackageCopy | undefined> {
  const absolutePath = path.resolve(dependencyPath);
  if (!isPathInside(lexicalWorkspaceRoot, absolutePath)) return undefined;
  const workspaceRelativePath = path.relative(lexicalWorkspaceRoot, absolutePath);
  const segments = workspaceRelativePath.split(path.sep);
  const nodeModulesIndexes = segments.flatMap((segment, index) =>
    segment === NODE_MODULES_SEGMENT ? [index] : [],
  );
  const deepestIndex = nodeModulesIndexes.at(-1);
  const firstIndex = nodeModulesIndexes[0];
  if (deepestIndex === undefined || firstIndex === undefined) return undefined;
  if (segments.includes('.pnpm') || segments.some((segment) => segment.startsWith('.yarn'))) {
    return undefined;
  }

  const packageNameLength = segments[deepestIndex + 1]?.startsWith('@') ? 2 : 1;
  const packageEndIndex = deepestIndex + 1 + packageNameLength;
  if (packageEndIndex > segments.length) return undefined;
  const lexicalPackageRoot = path.join(lexicalWorkspaceRoot, ...segments.slice(0, packageEndIndex));
  const targetSegments = segments.slice(firstIndex + 1, packageEndIndex);
  if (targetSegments.length === 0 || targetSegments.some((segment) => segment.length === 0)) {
    return undefined;
  }
  if (!(await hasOrdinaryDirectoryAncestry(lexicalWorkspaceRoot, lexicalPackageRoot))) {
    return undefined;
  }

  try {
    const [canonicalPackageRoot, canonicalDependencyPath] = await Promise.all([
      realpath(lexicalPackageRoot),
      realpath(absolutePath),
    ]);
    if (
      !isPathInside(canonicalWorkspaceRoot, canonicalPackageRoot) ||
      !isPathAtOrInside(canonicalPackageRoot, canonicalDependencyPath)
    ) {
      return undefined;
    }
    return Object.freeze({
      sourceRoot: canonicalPackageRoot,
      targetRelativePath: path.join(...targetSegments),
    });
  } catch {
    return undefined;
  }
}

/** Rejects a package path when any directory at or below the workspace boundary is a link. */
async function hasOrdinaryDirectoryAncestry(
  workspaceRoot: string,
  packageRoot: string,
): Promise<boolean> {
  const relativePath = path.relative(workspaceRoot, packageRoot);
  if (relativePath.length === 0 || !isPathInside(workspaceRoot, packageRoot)) return false;
  let candidatePath = path.resolve(workspaceRoot);
  for (const segment of relativePath.split(path.sep)) {
    candidatePath = path.join(candidatePath, segment);
    try {
      const status = await lstat(candidatePath);
      if (status.isSymbolicLink() || !status.isDirectory()) return false;
    } catch {
      return false;
    }
  }
  return true;
}

/** Reads exact public package identity while rejecting malformed or private manifests. */
async function readPackageDescriptor(
  sourceRoot: string,
): Promise<PreviewManagedPackageDescriptor | undefined> {
  try {
    const parsed: unknown = JSON.parse(
      await readFile(path.join(sourceRoot, 'package.json'), 'utf8'),
    );
    if (typeof parsed !== 'object' || parsed === null) return undefined;
    const manifest = parsed as PackageIdentityManifest;
    if (
      manifest.private === true ||
      typeof manifest.name !== 'string' ||
      typeof manifest.version !== 'string' ||
      !isValidPackageName(manifest.name) ||
      !PACKAGE_VERSION_PATTERN.test(manifest.version)
    ) {
      return undefined;
    }
    return Object.freeze({ name: manifest.name, version: manifest.version });
  } catch {
    return undefined;
  }
}

/** Rejects links, nested installs, sensitive configuration, special files and excessive source. */
async function shouldCopyPackagePath(
  sourcePath: string,
  packageRoot: string,
  budget: CopyBudget,
): Promise<boolean> {
  const relativePath = path.relative(packageRoot, sourcePath);
  if (!isPathAtOrInside(packageRoot, sourcePath)) {
    throw new Error('Managed dependency source escaped its package root.');
  }
  if (isNestedNodeModulesPath(relativePath) || isExcludedPackagePath(relativePath)) return false;

  const physicalSourcePath = await realpath(sourcePath);
  if (!isPathAtOrInside(packageRoot, physicalSourcePath)) {
    throw new Error('Managed dependency source resolved outside its canonical package root.');
  }
  const status = await lstat(sourcePath);
  if (status.isSymbolicLink()) return false;
  if (!status.isFile()) return status.isDirectory();
  addFileToBudget(budget, status.size);
  return true;
}

/** Walks one package tree in stable path order while excluding separately owned nested installs. */
async function inspectPackageOwnedDirectory(
  packageRoot: string,
  relativeDirectory: string,
  inspection: PackageTreeInspection,
): Promise<void> {
  const directoryPath = path.join(packageRoot, relativeDirectory);
  const entries = (await readdir(directoryPath, { withFileTypes: true })).sort((left, right) =>
    comparePortablePaths(left.name, right.name),
  );
  for (const entry of entries) {
    const relativePath =
      relativeDirectory.length === 0 ? entry.name : path.join(relativeDirectory, entry.name);
    if (isNestedNodeModulesPath(relativePath)) continue;
    if (isExcludedPackagePath(relativePath)) {
      throw new Error('Managed dependency staging tree contains sensitive package configuration.');
    }
    const sourcePath = path.join(packageRoot, relativePath);
    const status = await lstat(sourcePath);
    if (status.isSymbolicLink()) {
      throw new Error('Managed dependency staging tree contains a symbolic link.');
    }
    if (status.isDirectory()) {
      updateDigestFrame(inspection.hash, 'directory', toPortablePath(relativePath));
      await inspectPackageOwnedDirectory(packageRoot, relativePath, inspection);
      continue;
    }
    if (!status.isFile()) {
      throw new Error('Managed dependency staging tree contains a special filesystem entry.');
    }
    await inspectRegularFile(sourcePath, relativePath, status.size, inspection);
  }
}

/** Performs a metadata-only full staging walk so nested package links cannot hide from validation. */
async function inspectStagedDirectory(
  stagingRoot: string,
  relativeDirectory: string,
  budget: CopyBudget,
): Promise<void> {
  const directoryPath = path.join(stagingRoot, relativeDirectory);
  const status = await lstat(directoryPath);
  if (status.isSymbolicLink() || !status.isDirectory()) {
    throw new Error('Managed dependency staging root is not an ordinary directory.');
  }
  const entries = (await readdir(directoryPath, { withFileTypes: true })).sort((left, right) =>
    comparePortablePaths(left.name, right.name),
  );
  for (const entry of entries) {
    const relativePath =
      relativeDirectory.length === 0 ? entry.name : path.join(relativeDirectory, entry.name);
    if (isExcludedPackagePath(relativePath)) {
      throw new Error('Managed dependency staging set contains sensitive package configuration.');
    }
    const entryPath = path.join(stagingRoot, relativePath);
    const entryStatus = await lstat(entryPath);
    if (entryStatus.isSymbolicLink()) {
      throw new Error('Managed dependency staging set contains a symbolic link.');
    }
    if (entryStatus.isDirectory()) {
      await inspectStagedDirectory(stagingRoot, relativePath, budget);
    } else if (entryStatus.isFile()) {
      addFileToBudget(budget, entryStatus.size);
    } else {
      throw new Error('Managed dependency staging set contains a special filesystem entry.');
    }
  }
}

/** Reads one bounded regular file through its handle and appends exact bytes to the tree digest. */
async function inspectRegularFile(
  filePath: string,
  relativePath: string,
  observedSize: number,
  inspection: PackageTreeInspection,
): Promise<void> {
  if (observedSize > MAX_ADMITTED_FILE_BYTES) {
    throw new Error('Managed dependency contains an oversized package file.');
  }
  const handle = await open(filePath, 'r');
  try {
    const openedStatus = await handle.stat();
    if (!openedStatus.isFile() || openedStatus.size > MAX_ADMITTED_FILE_BYTES) {
      throw new Error(
        'Managed dependency package file changed to an invalid entry during verification.',
      );
    }
    addFileToBudget(inspection.budget, openedStatus.size);
    updateDigestFrame(inspection.hash, 'file', toPortablePath(relativePath));
    updateDigestFrame(inspection.hash, 'size', openedStatus.size.toString());

    const buffer = Buffer.allocUnsafe(Math.min(64 * 1024, Math.max(1, openedStatus.size)));
    let position = 0;
    while (position < openedStatus.size) {
      const length = Math.min(buffer.byteLength, openedStatus.size - position);
      const result = await handle.read(buffer, 0, length, position);
      if (result.bytesRead === 0) {
        throw new Error('Managed dependency package file changed size during verification.');
      }
      inspection.hash.update(buffer.subarray(0, result.bytesRead));
      position += result.bytesRead;
    }
    const trailingByte = Buffer.allocUnsafe(1);
    if ((await handle.read(trailingByte, 0, 1, position)).bytesRead !== 0) {
      throw new Error('Managed dependency package file grew during verification.');
    }
  } finally {
    await handle.close();
  }
}

/** Applies the shared environment budget after a regular file size is known. */
function addFileToBudget(budget: CopyBudget, size: number): void {
  if (!Number.isSafeInteger(size) || size < 0 || size > MAX_ADMITTED_FILE_BYTES) {
    throw new Error('Managed dependency contains an oversized or invalid package file.');
  }
  budget.files += 1;
  budget.bytes += size;
  if (budget.files > MAX_ADMITTED_FILES || budget.bytes > MAX_ADMITTED_BYTES) {
    throw new Error('Managed dependency environment exceeds its admission safety budget.');
  }
}

/** Frames digest strings with byte lengths so paths and entry kinds cannot concatenate ambiguously. */
function updateDigestFrame(hash: Hash, kind: string, value: string): void {
  const bytes = Buffer.from(value, 'utf8');
  hash.update(kind);
  hash.update('\0');
  hash.update(bytes.byteLength.toString());
  hash.update('\0');
  hash.update(bytes);
  hash.update('\0');
}

/** Reports whether a path belongs to a nested dependency tree owned by another package identity. */
function isNestedNodeModulesPath(relativePath: string): boolean {
  return relativePath.split(path.sep).includes(NODE_MODULES_SEGMENT);
}

/** Excludes package-manager credentials, environment files, executable shims, and mutable caches. */
function isExcludedPackagePath(relativePath: string): boolean {
  if (relativePath.length === 0) return false;
  const segments = relativePath.split(path.sep);
  const baseName = segments.at(-1) ?? '';
  return (
    segments.includes('.bin') ||
    segments.includes('.cache') ||
    SENSITIVE_PACKAGE_FILE_PATTERN.test(baseName)
  );
}

/** Requires every nested destination's parent package to have been admitted successfully first. */
function hasCopiedNestedOwner(
  targetRelativePath: string,
  copiedRelativePaths: ReadonlySet<string>,
): boolean {
  const segments = targetRelativePath.split(path.sep);
  const lastNodeModulesIndex = segments.lastIndexOf(NODE_MODULES_SEGMENT);
  if (lastNodeModulesIndex < 0) return true;
  const ownerPath = segments.slice(0, lastNodeModulesIndex).join(path.sep);
  return copiedRelativePaths.has(ownerPath);
}

/** Derives the package name after any preserved nested node_modules ancestry. */
function readPackageNameFromRelativePath(relativePath: string): string | undefined {
  const segments = relativePath.split(path.sep);
  const lastNodeModulesIndex = segments.lastIndexOf(NODE_MODULES_SEGMENT);
  const packageIndex = lastNodeModulesIndex < 0 ? 0 : lastNodeModulesIndex + 1;
  const first = segments[packageIndex];
  if (first === undefined) return undefined;
  const scopedName = segments[packageIndex + 1];
  return first.startsWith('@') && scopedName !== undefined ? `${first}/${scopedName}` : first;
}

/** Accepts canonical unscoped/scoped npm package names without URL or path syntax. */
function isValidPackageName(packageName: string): boolean {
  return /^(?:@[a-z0-9][a-z0-9._~-]*\/[a-z0-9][a-z0-9._~-]*|[a-z0-9][a-z0-9._~-]*)$/u.test(
    packageName,
  );
}

/** Counts native path segments for parent-before-child package ordering. */
function countPathSegments(relativePath: string): number {
  return relativePath.split(path.sep).length;
}

/** Produces locale-independent ordering suitable for a content identity. */
function comparePortablePaths(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

/** Normalizes native separators before a path is committed to a platform-stable digest. */
function toPortablePath(relativePath: string): string {
  return relativePath.split(path.sep).join('/');
}

/** Checks strict containment without accepting sibling paths that merely share a textual prefix. */
function isPathInside(rootPath: string, candidatePath: string): boolean {
  const relativePath = path.relative(path.resolve(rootPath), path.resolve(candidatePath));
  return (
    relativePath.length > 0 &&
    relativePath !== '..' &&
    !relativePath.startsWith(`..${path.sep}`) &&
    !path.isAbsolute(relativePath)
  );
}

/** Checks equality or containment for a resolved source entry below its canonical package root. */
function isPathAtOrInside(rootPath: string, candidatePath: string): boolean {
  return (
    path.resolve(rootPath) === path.resolve(candidatePath) || isPathInside(rootPath, candidatePath)
  );
}
