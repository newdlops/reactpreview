/**
 * Verifies npm package-lock acquisition through production profile and lock interpretation while
 * replacing only network and extraction boundaries. Fixtures never execute npm, package scripts,
 * or workspace code, and every acquired package is written exclusively to managed staging.
 */
import { createHash } from 'node:crypto';
import { lstat, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import {
  readPreviewDependencyProfile,
  type PreviewDependencyProfile,
} from '../../../src/adapters/node/previewDependencyProfile';
import {
  acquirePreviewPackageLockDependencies,
  type PreviewPackageLockExtractRequest,
  type PreviewPackageLockExtractor,
  type PreviewPackageLockTransport,
  type PreviewPackageLockTransportRequest,
} from '../../../src/adapters/node/previewPackageLockAcquirer';

const temporaryRoots: string[] = [];

afterEach(async () => {
  await Promise.all(
    temporaryRoots
      .splice(0)
      .map(async (rootPath) => rm(rootPath, { force: true, recursive: true })),
  );
});

describe('npm package-lock managed dependency acquisition', () => {
  /**
   * Selects a nested workspace package record, follows its required transitive edge through npm's
   * hoisted physical layout, and materializes both packages outside the authored workspace.
   */
  it.each([2, 3] as const)(
    'materializes a package-lock v%s monorepo direct and transitive closure in staging',
    async (lockfileVersion) => {
      const alphaArchive = Buffer.from('alpha archive');
      const bravoArchive = Buffer.from('bravo archive');
      const alphaUrl = publicArchiveUrl('alpha', '1.2.3');
      const bravoUrl = publicArchiveUrl('bravo', '2.4.0');
      const fixture = await createFixture({
        dependencies: { alpha: '^1.0.0' },
        lockfileVersion,
        lockedPackages: {
          'node_modules/alpha': lockedPackageRecord(alphaArchive, alphaUrl, '1.2.3', {
            dependencies: { bravo: '^2.0.0' },
          }),
          'node_modules/bravo': lockedPackageRecord(bravoArchive, bravoUrl, '2.4.0'),
        },
        projectRelativePath: path.join('packages', 'application'),
      });
      const profile = await requireProfile(fixture);
      const extracted: PreviewPackageLockExtractRequest[] = [];
      const requestedUrls: string[] = [];

      const result = await acquirePreviewPackageLockDependencies({
        extractor: recordingExtractor(extracted),
        profile,
        projectRoot: fixture.projectRoot,
        requiredPackageNames: ['alpha'],
        targetNodeModulesPath: fixture.targetNodeModulesPath,
        transport: archiveTransport(
          new Map([
            [alphaUrl, alphaArchive],
            [bravoUrl, bravoArchive],
          ]),
          requestedUrls,
        ),
      });

      expect(profile.dependencyPaths).toContain(fixture.lockfilePath);
      expect(requestedUrls).toEqual([alphaUrl, bravoUrl]);
      expect(
        extracted.map(({ packageName, packageVersion }) => [packageName, packageVersion]),
      ).toEqual([
        ['alpha', '1.2.3'],
        ['bravo', '2.4.0'],
      ]);
      expect(result?.packages).toMatchObject([
        { name: 'alpha', relativePath: 'alpha', version: '1.2.3' },
        { name: 'bravo', relativePath: 'bravo', version: '2.4.0' },
      ]);
      await expect(readPackageName(fixture.targetNodeModulesPath, 'alpha')).resolves.toBe('alpha');
      await expect(readPackageName(fixture.targetNodeModulesPath, 'bravo')).resolves.toBe('bravo');
      await expectPathToBeMissing(path.join(fixture.projectRoot, 'node_modules'));
    },
  );

  /**
   * Retains the dependency name as the physical Node lookup slot while verifying and publishing
   * the actual package identity declared by an npm alias lock record.
   */
  it('materializes an npm alias under its requested slot with the actual package identity', async () => {
    const archive = Buffer.from('actual package archive');
    const archiveUrl = publicArchiveUrl('actual', '3.2.1');
    const fixture = await createFixture({
      dependencies: { alias: 'npm:actual@^3.0.0' },
      lockedPackages: {
        'node_modules/alias': lockedPackageRecord(archive, archiveUrl, '3.2.1', {
          name: 'actual',
        }),
      },
    });
    const profile = await requireProfile(fixture);
    const extracted: PreviewPackageLockExtractRequest[] = [];

    const result = await acquirePreviewPackageLockDependencies({
      extractor: recordingExtractor(extracted),
      profile,
      projectRoot: fixture.projectRoot,
      requiredPackageNames: ['alias'],
      targetNodeModulesPath: fixture.targetNodeModulesPath,
      transport: archiveTransport(new Map([[archiveUrl, archive]]), []),
    });

    expect(extracted).toHaveLength(1);
    expect(extracted[0]).toMatchObject({ packageName: 'actual', packageVersion: '3.2.1' });
    expect(extracted[0]?.targetPath).toBe(path.join(fixture.targetNodeModulesPath, 'alias'));
    expect(result?.packages).toMatchObject([
      { name: 'actual', relativePath: 'alias', version: '3.2.1' },
    ]);
    await expect(readPackageName(fixture.targetNodeModulesPath, 'alias')).resolves.toBe('actual');
    await expectPathToBeMissing(path.join(fixture.projectRoot, 'node_modules'));
  });

  /**
   * Detects lock bytes changed after profile discovery before transport or extraction can create a
   * staging tree, preserving the caller-owned workspace and returning a fail-closed result.
   */
  it('fails closed without staging when the captured package-lock digest becomes stale', async () => {
    const archive = Buffer.from('stale alpha archive');
    const archiveUrl = publicArchiveUrl('alpha', '1.0.0');
    const fixture = await createFixture({
      dependencies: { alpha: '1.0.0' },
      lockedPackages: {
        'node_modules/alpha': lockedPackageRecord(archive, archiveUrl, '1.0.0'),
      },
    });
    const profile = await requireProfile(fixture);
    const originalLock = JSON.parse(await readFile(fixture.lockfilePath, 'utf8')) as Readonly<
      Record<string, unknown>
    >;
    await writeFile(
      fixture.lockfilePath,
      JSON.stringify({ ...originalLock, postProfileMutation: true }),
      'utf8',
    );
    const transportRequests: string[] = [];
    const extracted: PreviewPackageLockExtractRequest[] = [];

    const result = await acquirePreviewPackageLockDependencies({
      extractor: recordingExtractor(extracted),
      profile,
      projectRoot: fixture.projectRoot,
      requiredPackageNames: ['alpha'],
      targetNodeModulesPath: fixture.targetNodeModulesPath,
      transport: archiveTransport(new Map([[archiveUrl, archive]]), transportRequests),
    });

    expect(result).toBeUndefined();
    expect(transportRequests).toEqual([]);
    expect(extracted).toEqual([]);
    await expectPathToBeMissing(fixture.targetNodeModulesPath);
    await expectPathToBeMissing(path.join(fixture.projectRoot, 'node_modules'));
  });

  /**
   * Rejects a lock-selected private registry before any download and leaves no partial managed or
   * project-local installation behind even when the remaining lock identity is otherwise valid.
   */
  it('fails closed without staging for a private package archive URL', async () => {
    const archive = Buffer.from('private alpha archive');
    const privateUrl = 'https://packages.example.test/alpha/-/alpha-1.0.0.tgz';
    const fixture = await createFixture({
      dependencies: { alpha: '1.0.0' },
      lockedPackages: {
        'node_modules/alpha': lockedPackageRecord(archive, privateUrl, '1.0.0'),
      },
    });
    const profile = await requireProfile(fixture);
    const transportRequests: string[] = [];
    const extracted: PreviewPackageLockExtractRequest[] = [];

    const result = await acquirePreviewPackageLockDependencies({
      extractor: recordingExtractor(extracted),
      profile,
      projectRoot: fixture.projectRoot,
      requiredPackageNames: ['alpha'],
      targetNodeModulesPath: fixture.targetNodeModulesPath,
      transport: archiveTransport(new Map([[privateUrl, archive]]), transportRequests),
    });

    expect(result).toBeUndefined();
    expect(transportRequests).toEqual([]);
    expect(extracted).toEqual([]);
    await expectPathToBeMissing(fixture.targetNodeModulesPath);
    await expectPathToBeMissing(path.join(fixture.projectRoot, 'node_modules'));
  });
});

/** Isolated workspace, nested package root, lock evidence, and extension-owned output location. */
interface PackageLockFixture {
  readonly lockfilePath: string;
  readonly projectRoot: string;
  readonly targetNodeModulesPath: string;
  readonly workspaceRoot: string;
}

/** Inputs used to serialize one minimal supported package-lock project graph. */
interface PackageLockFixtureOptions {
  readonly dependencies: Readonly<Record<string, string>>;
  readonly lockfileVersion?: 2 | 3;
  readonly lockedPackages: Readonly<Record<string, Readonly<Record<string, unknown>>>>;
  readonly projectRelativePath?: string;
}

/** Optional package record fields that exercise dependency traversal and npm alias identity. */
interface LockedPackageRecordOptions {
  readonly dependencies?: Readonly<Record<string, string>>;
  readonly name?: string;
}

/**
 * Writes a package manifest and nearest workspace package-lock without installing dependencies.
 * The target path is a sibling of the workspace so successful materialization cannot be confused
 * with a project-local node_modules write.
 */
async function createFixture(options: PackageLockFixtureOptions): Promise<PackageLockFixture> {
  const fixtureRoot = await mkdtemp(path.join(os.tmpdir(), 'react-preview-package-lock-'));
  temporaryRoots.push(fixtureRoot);
  const workspaceRoot = path.join(fixtureRoot, 'workspace');
  const projectRelativePath = options.projectRelativePath ?? '';
  const projectRoot =
    projectRelativePath.length === 0
      ? workspaceRoot
      : path.join(workspaceRoot, projectRelativePath);
  const lockfilePath = path.join(workspaceRoot, 'package-lock.json');
  const projectKey = projectRelativePath.split(path.sep).join('/');
  await mkdir(projectRoot, { recursive: true });
  const projectRecord = {
    dependencies: options.dependencies,
    name: 'fixture-application',
    version: '1.0.0',
  };
  const packages: Record<string, unknown> = {
    '': projectKey.length === 0 ? projectRecord : { name: 'fixture-workspace', version: '1.0.0' },
    ...options.lockedPackages,
  };
  if (projectKey.length > 0) packages[projectKey] = projectRecord;
  await Promise.all([
    writeFile(
      path.join(projectRoot, 'package.json'),
      JSON.stringify({
        dependencies: options.dependencies,
        name: 'fixture-application',
        version: '1.0.0',
      }),
      'utf8',
    ),
    writeFile(
      lockfilePath,
      JSON.stringify({
        lockfileVersion: options.lockfileVersion ?? 3,
        name: 'fixture-workspace',
        packages,
        version: '1.0.0',
      }),
      'utf8',
    ),
  ]);
  return Object.freeze({
    lockfilePath,
    projectRoot,
    targetNodeModulesPath: path.join(fixtureRoot, 'managed', 'node_modules'),
    workspaceRoot,
  });
}

/** Requires production profile discovery to capture the nearest workspace lock digest. */
async function requireProfile(fixture: PackageLockFixture): Promise<PreviewDependencyProfile> {
  const profile = await readPreviewDependencyProfile(fixture.projectRoot, fixture.workspaceRoot);
  if (profile === undefined) {
    throw new Error('Expected production dependency profile discovery to accept this fixture.');
  }
  return profile;
}

/** Serializes one exact package-lock archive record with optional runtime edges or alias identity. */
function lockedPackageRecord(
  archive: Uint8Array,
  resolved: string,
  version: string,
  options: LockedPackageRecordOptions = {},
): Readonly<Record<string, unknown>> {
  return Object.freeze({
    ...(options.dependencies === undefined ? {} : { dependencies: options.dependencies }),
    integrity: sri(archive),
    ...(options.name === undefined ? {} : { name: options.name }),
    resolved,
    version,
  });
}

/** Returns bytes only for exact lock-admitted URLs while recording every attempted download. */
function archiveTransport(
  archivesByUrl: ReadonlyMap<string, Uint8Array>,
  requestedUrls: string[],
): PreviewPackageLockTransport {
  return Object.freeze({
    download: (request: PreviewPackageLockTransportRequest) => {
      requestedUrls.push(request.url);
      if (request.signal.aborted) throw request.signal.reason;
      const archive = archivesByUrl.get(request.url);
      if (archive === undefined) throw new Error(`Unexpected archive URL: ${request.url}`);
      return Promise.resolve(Uint8Array.from(archive));
    },
  });
}

/** Writes the minimal verified package tree and retains the planner-to-extractor contract. */
function recordingExtractor(
  requests: PreviewPackageLockExtractRequest[],
): PreviewPackageLockExtractor {
  return Object.freeze({
    extract: async (request: PreviewPackageLockExtractRequest) => {
      requests.push(request);
      if (request.signal.aborted) throw request.signal.reason;
      await mkdir(request.targetPath, { recursive: false });
      await Promise.all([
        writeFile(
          path.join(request.targetPath, 'package.json'),
          JSON.stringify({ name: request.packageName, version: request.packageVersion }),
          'utf8',
        ),
        writeFile(
          path.join(request.targetPath, 'index.js'),
          'export const ready = true;\n',
          'utf8',
        ),
      ]);
    },
  });
}

/** Reads the actual manifest identity materialized beneath an authored dependency slot. */
async function readPackageName(nodeModulesPath: string, packageSlot: string): Promise<string> {
  const manifest = JSON.parse(
    await readFile(path.join(nodeModulesPath, packageSlot, 'package.json'), 'utf8'),
  ) as { readonly name: string };
  return manifest.name;
}

/** Produces the only public archive URL shape admitted by the production npm lock adapter. */
function publicArchiveUrl(packageName: string, version: string): string {
  return `https://registry.npmjs.org/${packageName}/-/${packageName}-${version}.tgz`;
}

/** Computes the canonical strong integrity token stored in an npm package-lock record. */
function sri(archive: Uint8Array): string {
  return `sha512-${createHash('sha512').update(archive).digest('base64')}`;
}

/** Asserts that fail-closed or out-of-workspace acquisition left no filesystem entry behind. */
async function expectPathToBeMissing(candidatePath: string): Promise<void> {
  await expect(lstat(candidatePath)).rejects.toMatchObject({ code: 'ENOENT' });
}
