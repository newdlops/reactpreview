/**
 * Owns the persistent dependency environments shared by every trusted workspace in one VS Code
 * profile. Environments are immutable and selected by package-requirement fingerprint, while
 * staging, links, workspace source, and package scripts are never exposed to preview resolution.
 */
import { createHash, randomUUID } from 'node:crypto';
import {
  mkdir,
  open,
  readFile,
  readdir,
  rename,
  rm,
  stat,
  unlink,
  utimes,
  writeFile,
} from 'node:fs/promises';
import path from 'node:path';
import {
  collectPreviewManagedPackageCopies,
  copyPreviewManagedPackages,
  verifyPreviewManagedPackages,
  type PreviewManagedPackageCopyResult,
  type PreviewManagedPackageIdentity,
} from './previewManagedDependencyAdmission';
import {
  doesPreviewBundledRuntimeMatchStaging,
  inspectPreviewBundledReactRuntimesCached,
  selectPreviewBundledReactRuntime,
  type PreviewBundledReactRuntime,
} from './previewBundledReactRuntime';
import {
  doesPreviewSpecifierAcceptVersion,
  findPreviewDependencySpecifier,
  readPreviewDependencyProfile,
  type PreviewDependencyProfile,
} from './previewDependencyProfile';
import { acquirePreviewLockedDependencies } from './previewLockedDependencyAcquirer';
import {
  selectCompatiblePreviewManagedLayers,
  type PreviewManagedDependencyLayerCoverage,
} from './previewManagedDependencyLayerSelection';

const COMMITTED_MARKER = 'COMMITTED';
const ENVIRONMENT_MANIFEST = 'environment.json';
const STORE_SCHEMA_VERSION = 3;
const MAX_ENVIRONMENTS = 24;
const MAX_STORE_BYTES = 512 * 1024 * 1024;
const LOCK_STALE_MILLISECONDS = 5 * 60 * 1000;
const LOCK_WAIT_MILLISECONDS = 10_000;
const LOCK_POLL_MILLISECONDS = 100;
const PRUNE_MINIMUM_IDLE_MILLISECONDS = 24 * 60 * 60 * 1000;

/** Immutable resolution state selected before static analysis and esbuild options are created. */
export interface PreviewManagedDependencyEnvironment {
  /** Build-plan identity changed whenever an immutable environment selection changes. */
  readonly identity: string;
  /** Fallback node_modules roots; project-local Node resolution retains normal precedence. */
  readonly nodeModulesPaths: readonly string[];
  /** Optional package profile used to admit a successful local build for future workspaces. */
  readonly profile?: PreviewDependencyProfile;
}

/** Constructor policy supplied once through the trusted compiler worker bootstrap. */
export interface PreviewManagedDependencyStoreOptions {
  /** Extension-packaged production node_modules used only to seed compatible React runtimes. */
  readonly bundledNodeModulesPath?: string;
  /** Injectable lockfile acquirer used by offline tests; production uses the verified HTTPS path. */
  readonly lockedDependencyAcquirer?: typeof acquirePreviewLockedDependencies;
  /** Persistent sibling of the disposable preview artifact cache. */
  readonly rootPath: string;
}

/** One compiler-requested package batch proven unresolved after every local fallback. */
export interface PreviewLockedDependencyAcquisitionRequest {
  /** Exact profile and lock evidence selected before the failed build. */
  readonly profile: PreviewDependencyProfile | undefined;
  /** Package root whose manifest and lock entry define direct requirements. */
  readonly projectRoot: string;
  /** Declared npm package roots parsed from esbuild's unresolved diagnostics. */
  readonly requiredPackageNames: readonly string[];
  /** Active preview revision cancellation propagated into download and extraction. */
  readonly signal?: AbortSignal;
}

/** Inputs retained for a background admission after a successful local package build. */
export interface PreviewManagedDependencyAdmission {
  /** Absolute esbuild filesystem inputs from the committed browser bundle. */
  readonly dependencyPaths: readonly string[];
  /** Profile selected for the package owning the target. */
  readonly profile: PreviewDependencyProfile | undefined;
  /** Trusted workspace boundary; package bytes outside it are never copied. */
  readonly workspaceRoot: string;
}

/** Persisted environment metadata containing no originating workspace path. */
interface ManagedEnvironmentManifest {
  readonly bytes: number;
  readonly contentDigest: string;
  readonly coverage: PreviewManagedDependencyLayerCoverage;
  readonly createdAt: string;
  readonly files: number;
  /** Immutable layer identity derived from profile and verified package contents. */
  readonly fingerprint: string;
  readonly packages: readonly PreviewManagedPackageIdentity[];
  /** Dependency/lock profile shared by every independently reached package layer. */
  readonly profileFingerprint: string;
  readonly schemaVersion: number;
}

/** Metadata needed for cheap quota pruning without walking immutable package trees. */
interface StoredEnvironmentUsage {
  readonly bytes: number;
  readonly directoryPath: string;
  readonly lastUsedMilliseconds: number;
}

/**
 * Persistent, compiler-worker-owned dependency store.
 *
 * Successful builds are admitted in the background, while `shutdown()` waits for publication and
 * performs bounded LRU pruning without deleting reusable environments on extension deactivation.
 */
export class PreviewManagedDependencyStore {
  private disposed = false;
  /** Successful validation is memoized for this worker lifetime, never across extension runs. */
  private readonly committedValidationByPath = new Map<
    string,
    Promise<ManagedEnvironmentManifest | undefined>
  >();
  private readonly pendingAdmissions = new Map<string, Promise<void>>();
  private readonly pendingAcquisitions = new Map<string, Promise<boolean>>();
  private readonly successfulAcquisitions = new Set<string>();
  private readonly lockedDependencyAcquirer: typeof acquirePreviewLockedDependencies;
  private readonly rootPath: string;
  private seedRuntimePromise: Promise<readonly PreviewBundledReactRuntime[]> | undefined;

  /** Creates a path-scoped store without reading the filesystem on extension activation. */
  public constructor(private readonly options: PreviewManagedDependencyStoreOptions) {
    this.rootPath = path.resolve(options.rootPath);
    this.lockedDependencyAcquirer =
      options.lockedDependencyAcquirer ?? acquirePreviewLockedDependencies;
  }

  /**
   * Selects a previously committed exact profile and a compatible bundled React seed.
   *
   * @param projectRoot Nearest package root for the selected target.
   * @returns Immutable node-path fallbacks and cache identity for this compilation.
   */
  public async prepare(
    projectRoot: string,
    workspaceRoot = projectRoot,
  ): Promise<PreviewManagedDependencyEnvironment> {
    if (this.disposed) return EMPTY_MANAGED_ENVIRONMENT;
    const profile = await readPreviewDependencyProfile(projectRoot, workspaceRoot);
    if (profile !== undefined) {
      await Promise.all(
        [...this.pendingAdmissions.entries()]
          .filter(([taskIdentity]) => taskIdentity.startsWith(`${profile.fingerprint}:`))
          .map(([, task]) => task),
      );
    }
    const cachedNodeModulesPaths =
      profile?.hasReusableLockEvidence !== true
        ? Object.freeze([])
        : await this.readCommittedEnvironmentLayers(profile);
    const hasManagedCoreRuntime = await doesAnyLayerContainReactRuntime(cachedNodeModulesPaths);
    const bundledNodeModulesPath = hasManagedCoreRuntime
      ? undefined
      : await this.prepareBundledReactSeed(profile, projectRoot);
    const nodeModulesPaths = Object.freeze(
      [
        ...new Set(
          [
            ...cachedNodeModulesPaths,
            ...(hasManagedCoreRuntime ? [] : [bundledNodeModulesPath]),
          ].filter(isString),
        ),
      ].map((value) => path.resolve(value)),
    );
    return Object.freeze({
      identity: createHash('sha256')
        .update(
          JSON.stringify({
            nodeModulesPaths,
            profile: profile?.fingerprint ?? 'manifestless',
            schemaVersion: STORE_SCHEMA_VERSION,
          }),
        )
        .digest('hex')
        .slice(0, 32),
      nodeModulesPaths,
      ...(profile === undefined ? {} : { profile }),
    });
  }

  /**
   * Starts one deduplicated, non-blocking admission for packages reached by a successful build.
   *
   * @param admission Exact profile, workspace boundary and reached filesystem inputs.
   */
  public scheduleAdmission(admission: PreviewManagedDependencyAdmission): void {
    const profile = admission.profile;
    if (this.disposed || !profile?.hasReusableLockEvidence) {
      return;
    }
    const taskIdentity = createAdmissionTaskIdentity(
      profile.fingerprint,
      admission.dependencyPaths,
    );
    if (this.pendingAdmissions.has(taskIdentity)) return;
    const task = this.admit(admission)
      .catch(() => undefined)
      .finally(() => {
        this.pendingAdmissions.delete(taskIdentity);
      });
    this.pendingAdmissions.set(taskIdentity, task);
  }

  /**
   * Restores one unresolved package closure from exact supported public lockfile evidence.
   * Concurrent previews share the same immutable operation and never write into the workspace.
   *
   * @param request Profile, package roots, project boundary, and active revision cancellation.
   * @returns Whether a new or existing verified layer can satisfy a single compiler retry.
   */
  public acquireLockedDependencies(
    request: PreviewLockedDependencyAcquisitionRequest,
  ): Promise<boolean> {
    const profile = request.profile;
    if (
      this.disposed ||
      !profile?.hasReusableLockEvidence ||
      request.requiredPackageNames.length === 0
    ) {
      return Promise.resolve(false);
    }
    const taskIdentity = createLockedAcquisitionTaskIdentity(
      profile.fingerprint,
      request.requiredPackageNames,
    );
    const activeTask = this.pendingAcquisitions.get(taskIdentity);
    if (activeTask !== undefined) return activeTask;
    if (this.successfulAcquisitions.has(taskIdentity)) return Promise.resolve(false);
    const task = this.acquireLockedDependencyLayer({ ...request, profile })
      .then((acquired) => {
        if (acquired) this.successfulAcquisitions.add(taskIdentity);
        return acquired;
      })
      .finally(() => {
        this.pendingAcquisitions.delete(taskIdentity);
      });
    this.pendingAcquisitions.set(taskIdentity, task);
    return task;
  }

  /** Reports whether an immutable package input belongs to this extension's private store. */
  public ownsPath(candidatePath: string): boolean {
    return isPathInside(this.rootPath, path.resolve(candidatePath));
  }

  /**
   * Stops new admission, waits for current atomic publications, and prunes old environments.
   * Reusable package bytes intentionally survive deactivation.
   */
  public async shutdown(): Promise<void> {
    if (this.disposed) return;
    this.disposed = true;
    await Promise.allSettled([
      ...this.pendingAdmissions.values(),
      ...this.pendingAcquisitions.values(),
    ]);
    await this.prune().catch(() => undefined);
  }

  /** Publishes one independently reached package layer under its exact dependency profile. */
  private async admit(admission: PreviewManagedDependencyAdmission): Promise<void> {
    const profile = admission.profile;
    if (!profile?.hasReusableLockEvidence) return;
    const copies = await collectPreviewManagedPackageCopies(
      admission.dependencyPaths,
      admission.workspaceRoot,
    );
    if (copies.length === 0) return;

    const profilePath = this.profilePath(profile.fingerprint);
    const stagingPath = path.join(
      profilePath,
      `.staging-${process.pid.toString()}-${randomUUID()}`,
    );
    await mkdir(profilePath, { recursive: true });
    try {
      const nodeModulesPath = path.join(stagingPath, 'root', 'node_modules');
      const result = await copyPreviewManagedPackages(copies, nodeModulesPath);
      if (
        result.packages.length === 0 ||
        !doInstalledPackagesMatchDeclaredRequirements(profile, result.packages)
      ) {
        return;
      }
      await this.publishStagedLayer(profile, result, stagingPath, 'reached');
    } finally {
      await rm(stagingPath, { force: true, recursive: true }).catch(() => undefined);
    }
  }

  /** Downloads, verifies, extracts, and publishes one exact missing-package closure. */
  private async acquireLockedDependencyLayer(
    request: PreviewLockedDependencyAcquisitionRequest & {
      readonly profile: PreviewDependencyProfile;
    },
  ): Promise<boolean> {
    const profilePath = this.profilePath(request.profile.fingerprint);
    const stagingPath = path.join(
      profilePath,
      `.acquiring-${process.pid.toString()}-${randomUUID()}`,
    );
    await mkdir(profilePath, { recursive: true });
    try {
      const result = await this.lockedDependencyAcquirer({
        profile: request.profile,
        projectRoot: request.projectRoot,
        requiredPackageNames: request.requiredPackageNames,
        ...(request.signal === undefined ? {} : { signal: request.signal }),
        targetNodeModulesPath: path.join(stagingPath, 'root', 'node_modules'),
      });
      return result === undefined
        ? false
        : await this.publishStagedLayer(request.profile, result, stagingPath, 'lockfile');
    } finally {
      await rm(stagingPath, { force: true, recursive: true }).catch(() => undefined);
    }
  }

  /** Commits one completely staged package set under a content-derived immutable layer identity. */
  private async publishStagedLayer(
    profile: PreviewDependencyProfile,
    result: PreviewManagedPackageCopyResult,
    stagingPath: string,
    coverage: ManagedEnvironmentManifest['coverage'],
  ): Promise<boolean> {
    const layerFingerprint = createLayerFingerprint(profile.fingerprint, result.contentDigest);
    const environmentPath = this.layerPath(profile.fingerprint, layerFingerprint);
    const manifest: ManagedEnvironmentManifest = Object.freeze({
      bytes: result.bytes,
      contentDigest: result.contentDigest,
      coverage,
      createdAt: new Date().toISOString(),
      files: result.files,
      fingerprint: layerFingerprint,
      packages: result.packages,
      profileFingerprint: profile.fingerprint,
      schemaVersion: STORE_SCHEMA_VERSION,
    });
    await writeFile(
      path.join(stagingPath, ENVIRONMENT_MANIFEST),
      `${JSON.stringify(manifest, undefined, 2)}\n`,
      { encoding: 'utf8', flag: 'wx' },
    );
    await writeFile(path.join(stagingPath, COMMITTED_MARKER), `${layerFingerprint}\n`, {
      encoding: 'utf8',
      flag: 'wx',
    });
    await mkdir(path.dirname(environmentPath), { recursive: true });
    await withEnvironmentLock(environmentPath, async () => {
      if ((await this.readValidatedEnvironment(environmentPath, layerFingerprint)) !== undefined) {
        return;
      }
      await rm(environmentPath, { force: true, recursive: true }).catch(() => undefined);
      this.committedValidationByPath.delete(environmentPath);
      await publishStagingDirectory(stagingPath, environmentPath, layerFingerprint);
    });
    return (await this.readValidatedEnvironment(environmentPath, layerFingerprint)) !== undefined;
  }

  /** Returns every validated immutable layer while rejecting conflicting package identities. */
  private async readCommittedEnvironmentLayers(
    profile: PreviewDependencyProfile,
  ): Promise<readonly string[]> {
    const layersPath = path.join(this.profilePath(profile.fingerprint), 'layers');
    let entries;
    try {
      entries = await readdir(layersPath, { withFileTypes: true });
    } catch {
      return Object.freeze([]);
    }
    const validatedLayers = (
      await Promise.all(
        entries
          .filter((entry) => entry.isDirectory())
          .sort((left, right) => left.name.localeCompare(right.name))
          .map(async (entry) => {
            const environmentPath = path.join(layersPath, entry.name);
            const manifest = await this.readValidatedEnvironment(environmentPath, entry.name);
            return manifest === undefined ? undefined : { environmentPath, manifest };
          }),
      )
    ).filter(
      (
        layer,
      ): layer is {
        readonly environmentPath: string;
        readonly manifest: ManagedEnvironmentManifest;
      } => layer !== undefined,
    );
    const compatibleLayers = selectCompatiblePreviewManagedLayers(
      validatedLayers.map((layer) => ({
        ...layer,
        coverage: layer.manifest.coverage,
        packages: layer.manifest.packages,
      })),
    );
    const now = new Date();
    await Promise.all(
      compatibleLayers.map(async ({ environmentPath }) =>
        utimes(path.join(environmentPath, COMMITTED_MARKER), now, now).catch(() => undefined),
      ),
    );
    return Object.freeze(
      compatibleLayers.map(({ environmentPath }) =>
        path.join(environmentPath, 'root', 'node_modules'),
      ),
    );
  }

  /** Validates package bytes once per worker lifetime before exposing a persistent layer. */
  private readValidatedEnvironment(
    environmentPath: string,
    fingerprint: string,
  ): Promise<ManagedEnvironmentManifest | undefined> {
    let validation = this.committedValidationByPath.get(environmentPath);
    if (validation === undefined) {
      validation = readCommittedEnvironmentManifest(environmentPath, fingerprint);
      this.committedValidationByPath.set(environmentPath, validation);
    }
    return validation;
  }

  /** Materializes extension-packaged React/ReactDOM only when declared versions are compatible. */
  private async prepareBundledReactSeed(
    profile: PreviewDependencyProfile | undefined,
    projectRoot: string,
  ): Promise<string | undefined> {
    const runtime = await selectPreviewBundledReactRuntime(
      () => this.readBundledReactRuntimes(),
      profile,
      projectRoot,
    );
    if (runtime === undefined) return undefined;
    const seedPath = path.join(this.rootPath, 'seeds', runtime.identity);
    if ((await this.readValidatedEnvironment(seedPath, runtime.identity)) === undefined) {
      await mkdir(path.dirname(seedPath), { recursive: true });
      await withEnvironmentLock(seedPath, async () => {
        if ((await this.readValidatedEnvironment(seedPath, runtime.identity)) !== undefined) return;
        const stagingPath = `${seedPath}.staging-${process.pid.toString()}-${randomUUID()}`;
        try {
          const result = await copyPreviewManagedPackages(
            runtime.copies,
            path.join(stagingPath, 'root', 'node_modules'),
          );
          if (!doesPreviewBundledRuntimeMatchStaging(runtime, result.packages)) return;
          const manifest: ManagedEnvironmentManifest = {
            bytes: result.bytes,
            contentDigest: result.contentDigest,
            coverage: 'bundled',
            createdAt: new Date().toISOString(),
            files: result.files,
            fingerprint: runtime.identity,
            packages: result.packages,
            profileFingerprint: 'extension-bundled-react',
            schemaVersion: STORE_SCHEMA_VERSION,
          };
          await writeFile(
            path.join(stagingPath, ENVIRONMENT_MANIFEST),
            `${JSON.stringify(manifest, undefined, 2)}\n`,
            'utf8',
          );
          await writeFile(
            path.join(stagingPath, COMMITTED_MARKER),
            `${runtime.identity}\n`,
            'utf8',
          );
          await rm(seedPath, { force: true, recursive: true }).catch(() => undefined);
          this.committedValidationByPath.delete(seedPath);
          await publishStagingDirectory(stagingPath, seedPath, runtime.identity);
        } finally {
          await rm(stagingPath, { force: true, recursive: true }).catch(() => undefined);
        }
      });
    }
    return (await this.readValidatedEnvironment(seedPath, runtime.identity)) !== undefined
      ? path.join(seedPath, 'root', 'node_modules')
      : undefined;
  }

  /** Reads exact packaged core versions once without resolving any project-controlled module. */
  private readBundledReactRuntimes(): Promise<readonly PreviewBundledReactRuntime[]> {
    this.seedRuntimePromise ??= inspectPreviewBundledReactRuntimesCached(
      this.options.bundledNodeModulesPath,
    );
    return this.seedRuntimePromise;
  }

  /** Maps one exact project fingerprint to its append-only package-layer directory. */
  private profilePath(fingerprint: string): string {
    return path.join(this.rootPath, 'environments', fingerprint);
  }

  /** Maps verified package contents to one immutable layer within an exact profile. */
  private layerPath(profileFingerprint: string, layerFingerprint: string): string {
    return path.join(this.profilePath(profileFingerprint), 'layers', layerFingerprint);
  }

  /** Removes oldest unleased environments using metadata-only byte accounting. */
  private async prune(): Promise<void> {
    const environmentsRoot = path.join(this.rootPath, 'environments');
    let profileEntries;
    try {
      profileEntries = await readdir(environmentsRoot, { withFileTypes: true });
    } catch {
      return;
    }
    const usages = (
      await Promise.all(
        profileEntries
          .filter((entry) => entry.isDirectory())
          .map(async (entry) =>
            readProfileEnvironmentUsages(path.join(environmentsRoot, entry.name)),
          ),
      )
    ).flat();
    usages.sort((left, right) => right.lastUsedMilliseconds - left.lastUsedMilliseconds);
    let retainedBytes = 0;
    const now = Date.now();
    for (const [index, usage] of usages.entries()) {
      retainedBytes += usage.bytes;
      if (
        (index >= MAX_ENVIRONMENTS || retainedBytes > MAX_STORE_BYTES) &&
        now - usage.lastUsedMilliseconds >= PRUNE_MINIMUM_IDLE_MILLISECONDS
      ) {
        await rm(usage.directoryPath, { force: true, recursive: true }).catch(() => undefined);
        this.committedValidationByPath.delete(usage.directoryPath);
      }
    }
  }
}

/** Stable empty value returned after store disposal or when no bootstrap path was configured. */
export const EMPTY_MANAGED_ENVIRONMENT: PreviewManagedDependencyEnvironment = Object.freeze({
  identity: 'managed-dependencies-disabled',
  nodeModulesPaths: Object.freeze([]),
});

/** Rejects stale installs and non-registry direct specs before their bytes become reusable. */
function doInstalledPackagesMatchDeclaredRequirements(
  profile: PreviewDependencyProfile,
  packages: readonly PreviewManagedPackageIdentity[],
): boolean {
  return packages.every((packageIdentity) => {
    const declaredSpecifier = findPreviewDependencySpecifier(profile, packageIdentity.name);
    return (
      declaredSpecifier === undefined ||
      doesPreviewSpecifierAcceptVersion(declaredSpecifier, packageIdentity.version)
    );
  });
}

/** Separates append-only layers by verified bytes while keeping them under one lock profile. */
function createLayerFingerprint(profileFingerprint: string, contentDigest: string): string {
  return createHash('sha256')
    .update(
      JSON.stringify({ contentDigest, profileFingerprint, schemaVersion: STORE_SCHEMA_VERSION }),
    )
    .digest('hex');
}

/** Deduplicates only the same reached graph, allowing later targets to contribute new layers. */
function createAdmissionTaskIdentity(
  profileFingerprint: string,
  dependencyPaths: readonly string[],
): string {
  const reachedGraphDigest = createHash('sha256')
    .update(
      JSON.stringify([...new Set(dependencyPaths.map((value) => path.resolve(value)))].sort()),
    )
    .digest('hex');
  return `${profileFingerprint}:${reachedGraphDigest}`;
}

/** Deduplicates one exact lock profile and stable unresolved package-root batch. */
function createLockedAcquisitionTaskIdentity(
  profileFingerprint: string,
  requiredPackageNames: readonly string[],
): string {
  const requirementDigest = createHash('sha256')
    .update(JSON.stringify([...new Set(requiredPackageNames)].sort()))
    .digest('hex');
  return `${profileFingerprint}:acquire:${requirementDigest}`;
}

/**
 * Detects either half of React in validated managed layers before composing a bundled runtime.
 * A partial lock-proven runtime intentionally suppresses the seed as well: failing explicitly is
 * safer than combining different React installations and producing invalid hook identities.
 */
async function doesAnyLayerContainReactRuntime(
  nodeModulesPaths: readonly string[],
): Promise<boolean> {
  const probes = nodeModulesPaths.flatMap((nodeModulesPath) =>
    ['react', 'react-dom'].map(async (packageName) => {
      try {
        return (await stat(path.join(nodeModulesPath, packageName, 'package.json'))).isFile();
      } catch {
        return false;
      }
    }),
  );
  return (await Promise.all(probes)).some(Boolean);
}

/** Verifies marker, metadata, package identities and deterministic package bytes before reuse. */
async function readCommittedEnvironmentManifest(
  environmentPath: string,
  fingerprint: string,
): Promise<ManagedEnvironmentManifest | undefined> {
  try {
    const [marker, manifestText] = await Promise.all([
      readFile(path.join(environmentPath, COMMITTED_MARKER), 'utf8'),
      readFile(path.join(environmentPath, ENVIRONMENT_MANIFEST), 'utf8'),
    ]);
    const parsed: unknown = JSON.parse(manifestText);
    if (!isManagedEnvironmentManifest(parsed, fingerprint) || marker.trim() !== fingerprint) {
      return undefined;
    }
    const verification = await verifyPreviewManagedPackages(
      parsed.packages,
      path.join(environmentPath, 'root', 'node_modules'),
    );
    if (
      verification.bytes !== parsed.bytes ||
      verification.files !== parsed.files ||
      verification.contentDigest !== parsed.contentDigest
    ) {
      return undefined;
    }
    return Object.freeze(parsed);
  } catch {
    return undefined;
  }
}

/** Narrows persisted JSON before any filesystem path derived from it is inspected. */
function isManagedEnvironmentManifest(
  value: unknown,
  fingerprint: string,
): value is ManagedEnvironmentManifest {
  if (typeof value !== 'object' || value === null) return false;
  const manifest = value as Readonly<Record<string, unknown>>;
  return (
    manifest.fingerprint === fingerprint &&
    manifest.schemaVersion === STORE_SCHEMA_VERSION &&
    (manifest.coverage === 'bundled' ||
      manifest.coverage === 'lockfile' ||
      manifest.coverage === 'reached') &&
    typeof manifest.profileFingerprint === 'string' &&
    typeof manifest.contentDigest === 'string' &&
    /^[a-f\d]{64}$/u.test(manifest.contentDigest) &&
    typeof manifest.bytes === 'number' &&
    Number.isSafeInteger(manifest.bytes) &&
    manifest.bytes >= 0 &&
    typeof manifest.files === 'number' &&
    Number.isSafeInteger(manifest.files) &&
    manifest.files >= 0 &&
    Array.isArray(manifest.packages) &&
    manifest.packages.every(isManagedPackageIdentity)
  );
}

/** Validates portable package identity fields before a managed path is reconstructed. */
function isManagedPackageIdentity(value: unknown): value is PreviewManagedPackageIdentity {
  if (typeof value !== 'object' || value === null) return false;
  const identity = value as Readonly<Record<string, unknown>>;
  return (
    typeof identity.name === 'string' &&
    typeof identity.version === 'string' &&
    typeof identity.relativePath === 'string' &&
    identity.relativePath.length > 0 &&
    !path.isAbsolute(identity.relativePath) &&
    !identity.relativePath.split(path.sep).includes('..') &&
    typeof identity.contentDigest === 'string' &&
    /^[a-f\d]{64}$/u.test(identity.contentDigest)
  );
}

/** Serializes publication across extension-host windows and reclaims stale crashed-writer locks. */
async function withEnvironmentLock(
  environmentPath: string,
  operation: () => Promise<void>,
): Promise<void> {
  const lockPath = `${environmentPath}.lock`;
  const deadline = Date.now() + LOCK_WAIT_MILLISECONDS;
  const ownerToken = `${process.pid.toString()}:${randomUUID()}`;
  let shouldRetry: boolean;
  do {
    shouldRetry = false;
    let handle: Awaited<ReturnType<typeof open>>;
    try {
      handle = await open(lockPath, 'wx');
    } catch (error) {
      if (!isFileExistsError(error)) throw error;
      if (await removeStaleLock(lockPath)) {
        shouldRetry = true;
        continue;
      }
      shouldRetry = Date.now() < deadline;
      if (shouldRetry) await delay(LOCK_POLL_MILLISECONDS);
      continue;
    }
    await handle.writeFile(`${ownerToken}\n`, 'utf8');
    await handle.sync();
    const heartbeat = setInterval(
      () => {
        const now = new Date();
        void utimes(lockPath, now, now).catch(() => undefined);
      },
      Math.max(1_000, Math.floor(LOCK_STALE_MILLISECONDS / 4)),
    );
    heartbeat.unref();
    try {
      await operation();
    } finally {
      clearInterval(heartbeat);
      await handle.close();
      await releaseOwnedLock(lockPath, ownerToken);
    }
    return;
  } while (shouldRetry);
  throw new Error('Timed out while waiting for the managed dependency environment lock.');
}

/** Renames a completed staging directory without replacing another window's committed result. */
async function publishStagingDirectory(
  stagingPath: string,
  environmentPath: string,
  expectedFingerprint: string,
): Promise<void> {
  try {
    await rename(stagingPath, environmentPath);
  } catch (error) {
    if (
      (await readCommittedEnvironmentManifest(environmentPath, expectedFingerprint)) === undefined
    ) {
      throw error;
    }
  }
}

/** Removes a lock left by a crashed worker after a conservative grace period. */
async function removeStaleLock(lockPath: string): Promise<boolean> {
  try {
    const status = await stat(lockPath);
    if (Date.now() - status.mtimeMs < LOCK_STALE_MILLISECONDS) return false;
    const stalePath = `${lockPath}.stale-${randomUUID()}`;
    await rename(lockPath, stalePath);
    await rm(stalePath, { force: true });
    return true;
  } catch {
    return false;
  }
}

/** Removes only the still-owned lock token so a reclaimed successor lock is never unlinked. */
async function releaseOwnedLock(lockPath: string, ownerToken: string): Promise<void> {
  try {
    if ((await readFile(lockPath, 'utf8')).trim() !== ownerToken) return;
    await unlink(lockPath);
  } catch {
    // A stale-lock recovery may already have moved the original token out of this path.
  }
}

/** Lists immutable layers for quota accounting and removes only clearly crashed staging trees. */
async function readProfileEnvironmentUsages(
  profilePath: string,
): Promise<readonly StoredEnvironmentUsage[]> {
  let profileEntries;
  try {
    profileEntries = await readdir(profilePath, { withFileTypes: true });
  } catch {
    return Object.freeze([]);
  }
  await Promise.all(
    profileEntries
      .filter(
        (entry) =>
          entry.isDirectory() &&
          (entry.name.startsWith('.staging-') || entry.name.startsWith('.acquiring-')),
      )
      .map(async (entry) => removeCrashedStagingDirectory(path.join(profilePath, entry.name))),
  );
  const layersPath = path.join(profilePath, 'layers');
  let layerEntries;
  try {
    layerEntries = await readdir(layersPath, { withFileTypes: true });
  } catch {
    return Object.freeze([]);
  }
  const usages = await Promise.all(
    layerEntries
      .filter((entry) => entry.isDirectory())
      .map(async (entry) => readStoredEnvironmentUsage(path.join(layersPath, entry.name))),
  );
  return Object.freeze(
    usages.filter((usage): usage is StoredEnvironmentUsage => usage !== undefined),
  );
}

/** Deletes staging left by a crashed writer only after the same conservative stale interval. */
async function removeCrashedStagingDirectory(stagingPath: string): Promise<void> {
  try {
    const status = await stat(stagingPath);
    if (Date.now() - status.mtimeMs >= LOCK_STALE_MILLISECONDS) {
      await rm(stagingPath, { force: true, recursive: true });
    }
  } catch {
    // Another window may still be publishing or cleaning this private staging directory.
  }
}

/** Reads quota metadata and the last-used commit timestamp without traversing package files. */
async function readStoredEnvironmentUsage(
  directoryPath: string,
): Promise<StoredEnvironmentUsage | undefined> {
  try {
    const [manifestText, marker, markerStatus] = await Promise.all([
      readFile(path.join(directoryPath, ENVIRONMENT_MANIFEST), 'utf8'),
      readFile(path.join(directoryPath, COMMITTED_MARKER), 'utf8'),
      stat(path.join(directoryPath, COMMITTED_MARKER)),
    ]);
    const parsed: unknown = JSON.parse(manifestText);
    if (
      typeof parsed !== 'object' ||
      parsed === null ||
      !('fingerprint' in parsed) ||
      typeof parsed.fingerprint !== 'string' ||
      marker.trim() !== parsed.fingerprint ||
      !('schemaVersion' in parsed) ||
      parsed.schemaVersion !== STORE_SCHEMA_VERSION ||
      !('bytes' in parsed) ||
      typeof parsed.bytes !== 'number' ||
      !Number.isSafeInteger(parsed.bytes) ||
      parsed.bytes < 0
    ) {
      return undefined;
    }
    return {
      bytes: parsed.bytes,
      directoryPath,
      lastUsedMilliseconds: markerStatus.mtimeMs,
    };
  } catch {
    return undefined;
  }
}

/** Recognizes atomic-open collisions without depending on platform-specific error subclasses. */
function isFileExistsError(error: unknown): boolean {
  return typeof error === 'object' && error !== null && 'code' in error && error.code === 'EEXIST';
}

/** Narrows optional filesystem paths after concurrent environment preparation. */
function isString(value: string | undefined): value is string {
  return typeof value === 'string';
}

/** Checks strict containment so managed storage cannot claim its own root or textual siblings. */
function isPathInside(rootPath: string, candidatePath: string): boolean {
  const relativePath = path.relative(path.resolve(rootPath), path.resolve(candidatePath));
  return (
    relativePath.length > 0 &&
    relativePath !== '..' &&
    !relativePath.startsWith(`..${path.sep}`) &&
    !path.isAbsolute(relativePath)
  );
}

/** Yields briefly while another VS Code window publishes the same immutable environment. */
function delay(milliseconds: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, milliseconds);
  });
}
