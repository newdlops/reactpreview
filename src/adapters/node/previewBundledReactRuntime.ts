/**
 * Discovers the extension's versioned React runtime catalog and selects one exact, internally
 * consistent seed for projects that intentionally have no installed node_modules directory.
 */
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import path from 'node:path';
import {
  verifyPreviewManagedPackageTree,
  type PreviewManagedPackageCopy,
  type PreviewManagedPackageIdentity,
} from './previewManagedDependencyAdmission';
import {
  doesPreviewSpecifierAcceptVersion,
  findPreviewDependencySpecifier,
  type PreviewDependencyProfile,
} from './previewDependencyProfile';

/** One extension package slot mapped to its authored npm identity inside a managed seed. */
interface PreviewBundledPackageSlot {
  /** Actual package name expected in the source manifest and written below managed node_modules. */
  readonly packageName: 'react' | 'react-dom' | 'scheduler';
  /** Packaged-dist then development-alias candidates relative to extension node_modules. */
  readonly sourceDirectoryNames: readonly string[];
}

/** Declarative catalog row; adding another supported React major does not change store logic. */
interface PreviewBundledRuntimeLayout {
  /** Default is preferred only when a manifest leaves both React versions unspecified. */
  readonly defaultRuntime: boolean;
  /** Stable catalog identifier combined with exact package bytes in the seed fingerprint. */
  readonly id: string;
  /** Complete mutually compatible React, ReactDOM, and Scheduler package set. */
  readonly slots: readonly PreviewBundledPackageSlot[];
}

/** Exact extension-bundled runtime eligible for one compatible managed seed environment. */
export interface PreviewBundledReactRuntime {
  readonly copies: readonly PreviewManagedPackageCopy[];
  readonly defaultRuntime: boolean;
  /** Source-tree identities rechecked after copying to close the inspection/publication race. */
  readonly expectedPackages: readonly PreviewManagedPackageIdentity[];
  readonly identity: string;
  readonly reactDomVersion: string;
  readonly reactVersion: string;
}

/**
 * Versioned runtime sources retained by the extension. The current major uses production
 * node_modules; older majors prefer packaged dist trees and fall back to exact development aliases
 * so npm never replaces the extension host's own React.
 */
const BUNDLED_RUNTIME_LAYOUTS: readonly PreviewBundledRuntimeLayout[] = Object.freeze([
  runtimeLayout('react-19', true, 'react', 'react-dom', 'scheduler'),
  runtimeLayout(
    'react-18',
    false,
    ['../dist/runtime/react18/node_modules/react', 'react-preview-react-18'],
    ['../dist/runtime/react18/node_modules/react-dom', 'react-preview-react-dom-18'],
    ['../dist/runtime/react18/node_modules/scheduler', 'react-preview-scheduler-18'],
  ),
]);
const MAX_CACHED_CATALOG_ROOTS = 8;
/** Worker-wide cache prevents concurrent preview sessions from repeatedly hashing shipped bytes. */
const runtimeCatalogByRoot = new Map<string, Promise<readonly PreviewBundledReactRuntime[]>>();

/**
 * Reads every complete catalog row without resolving or evaluating project-controlled modules.
 *
 * @param bundledNodeModulesPath Packaged extension node_modules directory.
 * @returns Frozen exact runtimes; absent or malformed catalog rows are skipped independently.
 */
export async function inspectPreviewBundledReactRuntimes(
  bundledNodeModulesPath: string | undefined,
): Promise<readonly PreviewBundledReactRuntime[]> {
  if (bundledNodeModulesPath === undefined) return Object.freeze([]);
  const nodeModulesPath = path.resolve(bundledNodeModulesPath);
  const inspected = await Promise.all(
    BUNDLED_RUNTIME_LAYOUTS.map(async (layout) => inspectRuntimeLayout(nodeModulesPath, layout)),
  );
  return Object.freeze(inspected.filter(isBundledRuntime));
}

/**
 * Shares immutable catalog inspection across compiler stores in one extension worker.
 *
 * Direct inspection remains uncached for integrity tests. Production package bytes cannot change
 * during a worker lifetime, so sharing their bounded hash avoids repeating roughly 12 MiB of reads
 * for every preview tab. The small root cap protects test hosts that create many isolated stores.
 *
 * @param bundledNodeModulesPath Packaged extension node_modules directory.
 * @returns One shared exact-runtime inspection promise.
 */
export function inspectPreviewBundledReactRuntimesCached(
  bundledNodeModulesPath: string | undefined,
): Promise<readonly PreviewBundledReactRuntime[]> {
  if (bundledNodeModulesPath === undefined) return Promise.resolve(Object.freeze([]));
  const rootPath = path.resolve(bundledNodeModulesPath);
  const cached = runtimeCatalogByRoot.get(rootPath);
  if (cached !== undefined) return cached;
  if (runtimeCatalogByRoot.size >= MAX_CACHED_CATALOG_ROOTS) {
    const oldestRoot = runtimeCatalogByRoot.keys().next().value;
    if (oldestRoot !== undefined) runtimeCatalogByRoot.delete(oldestRoot);
  }
  const inspection = inspectPreviewBundledReactRuntimes(rootPath);
  runtimeCatalogByRoot.set(rootPath, inspection);
  return inspection;
}

/**
 * Chooses a range-compatible runtime only when Node resolution proves no local React half exists.
 *
 * @param runtimes Exact packaged catalog or a lazy loader skipped when project React is present.
 * @param profile Current inert project dependency profile.
 * @param projectRoot Package root used solely for package.json resolution probes.
 * @returns One complete compatible runtime or `undefined` when mixing could create two React copies.
 */
export async function selectPreviewBundledReactRuntime(
  runtimes:
    readonly PreviewBundledReactRuntime[] | (() => Promise<readonly PreviewBundledReactRuntime[]>),
  profile: PreviewDependencyProfile | undefined,
  projectRoot: string,
): Promise<PreviewBundledReactRuntime | undefined> {
  const projectRuntime = await inspectProjectReactRuntime(projectRoot);
  if (projectRuntime.reactVersion !== undefined || projectRuntime.reactDomVersion !== undefined) {
    return undefined;
  }
  const inspectedRuntimes = typeof runtimes === 'function' ? await runtimes() : runtimes;
  const compatible = inspectedRuntimes.filter((runtime) => isRuntimeCompatible(runtime, profile));
  return compatible.find(({ defaultRuntime }) => defaultRuntime) ?? compatible[0];
}

/**
 * Confirms that the source bytes used for catalog selection are exactly the bytes later staged.
 *
 * @param runtime Catalog runtime inspected before materialization.
 * @param actualPackages Identities recomputed from the completed staging directory.
 * @returns Whether names, destinations, versions, and content digests match in catalog order.
 */
export function doesPreviewBundledRuntimeMatchStaging(
  runtime: PreviewBundledReactRuntime,
  actualPackages: readonly PreviewManagedPackageIdentity[],
): boolean {
  return (
    runtime.expectedPackages.length === actualPackages.length &&
    runtime.expectedPackages.every((expected, index) => {
      const actual = actualPackages[index];
      return (
        actual?.contentDigest === expected.contentDigest &&
        expected.name === actual.name &&
        expected.relativePath === actual.relativePath &&
        expected.version === actual.version
      );
    })
  );
}

/** Creates one immutable catalog row with three fixed authored package identities. */
function runtimeLayout(
  id: string,
  defaultRuntime: boolean,
  reactDirectories: string | readonly string[],
  reactDomDirectories: string | readonly string[],
  schedulerDirectories: string | readonly string[],
): PreviewBundledRuntimeLayout {
  return Object.freeze({
    defaultRuntime,
    id,
    slots: Object.freeze([
      packageSlot('react', reactDirectories),
      packageSlot('react-dom', reactDomDirectories),
      packageSlot('scheduler', schedulerDirectories),
    ]),
  });
}

/** Retains literal npm identities while freezing one extension-owned source mapping. */
function packageSlot(
  packageName: PreviewBundledPackageSlot['packageName'],
  sourceDirectoryNames: string | readonly string[],
): PreviewBundledPackageSlot {
  return Object.freeze({
    packageName,
    sourceDirectoryNames: Object.freeze(
      typeof sourceDirectoryNames === 'string' ? [sourceDirectoryNames] : [...sourceDirectoryNames],
    ),
  });
}

/**
 * Validates one complete layout and binds its identity to extension-owned package bytes.
 *
 * The verifier rejects links, special files, sensitive configuration, and oversized trees using
 * the same rules applied after a seed is copied. Consequently, an extension update cannot reuse a
 * stale global seed merely because its package versions remained unchanged.
 */
async function inspectRuntimeLayout(
  nodeModulesPath: string,
  layout: PreviewBundledRuntimeLayout,
): Promise<PreviewBundledReactRuntime | undefined> {
  const copies: PreviewManagedPackageCopy[] = [];
  const packageEvidence: PreviewManagedPackageIdentity[] = [];
  for (const slot of layout.slots) {
    const source = await inspectPackageSlot(nodeModulesPath, slot);
    if (source === undefined) return undefined;
    copies.push(
      Object.freeze({ sourceRoot: source.rootPath, targetRelativePath: slot.packageName }),
    );
    packageEvidence.push(
      Object.freeze({
        contentDigest: source.contentDigest,
        name: slot.packageName,
        relativePath: slot.packageName,
        version: source.version,
      }),
    );
  }
  const reactVersion = packageEvidence.find(({ name }) => name === 'react')?.version;
  const reactDomVersion = packageEvidence.find(({ name }) => name === 'react-dom')?.version;
  if (reactVersion === undefined || reactDomVersion === undefined) return undefined;
  const identity = createHash('sha256')
    .update(JSON.stringify({ id: layout.id, packages: packageEvidence }))
    .digest('hex');
  return Object.freeze({
    copies: Object.freeze(copies),
    defaultRuntime: layout.defaultRuntime,
    expectedPackages: Object.freeze(packageEvidence),
    identity,
    reactDomVersion,
    reactVersion,
  });
}

/** Selects the first valid extension-owned packaged or development source for one catalog slot. */
async function inspectPackageSlot(
  nodeModulesPath: string,
  slot: PreviewBundledPackageSlot,
): Promise<
  | { readonly contentDigest: string; readonly rootPath: string; readonly version: string }
  | undefined
> {
  const extensionRoot = path.dirname(nodeModulesPath);
  for (const sourceDirectoryName of slot.sourceDirectoryNames) {
    const rootPath = path.resolve(nodeModulesPath, sourceDirectoryName);
    if (!isPathInside(extensionRoot, rootPath)) continue;
    try {
      const verification = await verifyPreviewManagedPackageTree(rootPath);
      if (verification.name !== slot.packageName) continue;
      return Object.freeze({
        contentDigest: verification.contentDigest,
        rootPath,
        version: verification.version,
      });
    } catch {
      // A missing packaged source normally falls through to the exact development npm alias.
    }
  }
  return undefined;
}

/**
 * Prevents explicit project ranges from receiving an incompatible React or ReactDOM version.
 * A lockless exact manifest may use a newer stable bundled patch/minor in the same major: there is
 * no resolved graph to reproduce, and keeping React plus ReactDOM paired is safer than failing an
 * otherwise self-contained static preview. Lock-backed projects retain exact range semantics.
 */
function isRuntimeCompatible(
  runtime: PreviewBundledReactRuntime,
  profile: PreviewDependencyProfile | undefined,
): boolean {
  const allowLocklessSameMajor = profile?.lockfileEvidenceStatus === 'absent';
  return (
    doesPreviewReactSpecifierAcceptRuntime(
      findPreviewDependencySpecifier(profile, 'react'),
      runtime.reactVersion,
      allowLocklessSameMajor,
    ) &&
    doesPreviewReactSpecifierAcceptRuntime(
      findPreviewDependencySpecifier(profile, 'react-dom'),
      runtime.reactDomVersion,
      allowLocklessSameMajor,
    )
  );
}

/**
 * Applies normal semver admission first, then one bounded lockless exact-version compatibility rule.
 * Unsupported protocols, prereleases, ranges, older bundled releases, and cross-major candidates
 * remain rejected so the fallback cannot silently reinterpret ambiguous manifest intent.
 */
function doesPreviewReactSpecifierAcceptRuntime(
  specifier: string | undefined,
  runtimeVersion: string,
  allowLocklessSameMajor: boolean,
): boolean {
  if (doesPreviewSpecifierAcceptVersion(specifier, runtimeVersion)) return true;
  if (!allowLocklessSameMajor || specifier === undefined) return false;
  const requested = parseExactStableVersion(specifier);
  const runtime = parseExactStableVersion(runtimeVersion);
  return (
    requested !== undefined &&
    runtime?.major === requested.major &&
    compareVersionTuple(runtime, requested) >= 0
  );
}

/** Parses only an authored three-component stable version with an optional exact marker. */
function parseExactStableVersion(
  value: string,
): { readonly major: number; readonly minor: number; readonly patch: number } | undefined {
  const match = /^=?v?(\d+)\.(\d+)\.(\d+)$/u.exec(value.trim());
  if (match === null) return undefined;
  const major = Number(match[1]);
  const minor = Number(match[2]);
  const patch = Number(match[3]);
  if (![major, minor, patch].every(Number.isSafeInteger)) return undefined;
  return Object.freeze({
    major,
    minor,
    patch,
  });
}

/** Orders two stable versions without accepting prerelease or build metadata. */
function compareVersionTuple(
  left: { readonly major: number; readonly minor: number; readonly patch: number },
  right: { readonly major: number; readonly minor: number; readonly patch: number },
): number {
  return left.major - right.major || left.minor - right.minor || left.patch - right.patch;
}

/** Detects project-local or hoisted React halves before a bundled singleton can be selected. */
async function inspectProjectReactRuntime(projectRoot: string): Promise<{
  readonly reactDomVersion?: string;
  readonly reactVersion?: string;
}> {
  const resolveFromProject = createRequire(path.join(path.resolve(projectRoot), 'package.json'));
  const [reactVersion, reactDomVersion] = await Promise.all([
    readInstalledPackageVersion(resolveFromProject, 'react'),
    readInstalledPackageVersion(resolveFromProject, 'react-dom'),
  ]);
  return Object.freeze({
    ...(reactVersion === undefined ? {} : { reactVersion }),
    ...(reactDomVersion === undefined ? {} : { reactDomVersion }),
  });
}

/** Reads a resolved package version without evaluating the package entry module. */
async function readInstalledPackageVersion(
  resolveFromProject: NodeJS.Require,
  packageName: string,
): Promise<string | undefined> {
  try {
    const manifestPath = resolveFromProject.resolve(`${packageName}/package.json`);
    const parsed: unknown = JSON.parse(await readFile(manifestPath, 'utf8'));
    return typeof parsed === 'object' && parsed !== null && 'version' in parsed
      ? typeof parsed.version === 'string'
        ? parsed.version
        : undefined
      : undefined;
  } catch {
    return undefined;
  }
}

/** Narrows optional inspection results without exposing an incomplete runtime. */
function isBundledRuntime(
  runtime: PreviewBundledReactRuntime | undefined,
): runtime is PreviewBundledReactRuntime {
  return runtime !== undefined;
}

/** Proves a catalog candidate stays below the extension root containing node_modules and dist. */
function isPathInside(rootPath: string, candidatePath: string): boolean {
  const relativePath = path.relative(rootPath, candidatePath);
  return (
    relativePath !== '' &&
    relativePath !== '..' &&
    !relativePath.startsWith(`..${path.sep}`) &&
    !path.isAbsolute(relativePath)
  );
}
