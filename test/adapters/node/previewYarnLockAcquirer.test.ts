/**
 * Verifies Yarn archive acquisition through injected boundaries only. Fixtures provide immutable
 * lock evidence, exact registry metadata, compressed archive bytes, and extraction results without
 * accessing the network or invoking Yarn. This keeps lock interpretation and cleanup observable.
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
import { acquirePreviewLockedDependencies } from '../../../src/adapters/node/previewLockedDependencyAcquirer';
import type {
  PreviewPackageArchiveExtractRequest,
  PreviewPackageArchiveExtractor,
  PreviewPackageArchiveTransport,
  PreviewPackageArchiveTransportRequest,
} from '../../../src/adapters/node/previewPackageArchive';
import {
  acquirePreviewYarnLockDependencies,
  type PreviewYarnMetadataTransport,
  type PreviewYarnMetadataTransportRequest,
} from '../../../src/adapters/node/previewYarnLockAcquirer';

const temporaryRoots: string[] = [];

afterEach(async () => {
  await Promise.all(
    temporaryRoots
      .splice(0)
      .map(async (rootPath) => rm(rootPath, { force: true, recursive: true })),
  );
});

describe('Yarn managed dependency acquisition', () => {
  /** Uses classic lock SRI directly and proves the dispatcher falls through from npm to Yarn. */
  it('materializes a Yarn classic package without metadata or project node_modules', async () => {
    const archive = Buffer.from('classic alpha archive');
    const fixture = await createFixture(
      { alpha: '^1.0.0' },
      classicLock([classicEntry('alpha@^1.0.0', 'alpha', '1.2.3', sri(archive))]),
    );
    const profile = await requireProfile(fixture.projectRoot);
    let metadataRequests = 0;
    const metadataTransport: PreviewYarnMetadataTransport = {
      download: () => {
        metadataRequests += 1;
        return Promise.reject(
          new Error('Classic lock acquisition must not request registry metadata.'),
        );
      },
    };
    const transport = archiveTransport(
      new Map([['https://registry.npmjs.org/alpha/-/alpha-1.2.3.tgz', archive]]),
    );
    const extracted: PreviewPackageArchiveExtractRequest[] = [];

    const result = await acquirePreviewLockedDependencies({
      extractor: recordingExtractor(extracted),
      metadataTransport,
      profile,
      projectRoot: fixture.projectRoot,
      requiredPackageNames: ['alpha'],
      targetNodeModulesPath: fixture.targetNodeModulesPath,
      transport,
    });

    expect(metadataRequests).toBe(0);
    expect(extracted).toHaveLength(1);
    expect(extracted[0]).toMatchObject({ packageName: 'alpha', packageVersion: '1.2.3' });
    expect(result?.packages).toMatchObject([
      { name: 'alpha', relativePath: 'alpha', version: '1.2.3' },
    ]);
    await expect(readPackageName(fixture.targetNodeModulesPath, 'alpha')).resolves.toBe('alpha');
    await expect(lstat(path.join(fixture.projectRoot, 'node_modules'))).rejects.toMatchObject({
      code: 'ENOENT',
    });
  });

  /** Obtains Berry archive SRI only from metadata for the exact lock-selected identity. */
  it('resolves a Berry exact version through bounded metadata before archive extraction', async () => {
    const archive = Buffer.from('berry alpha archive');
    const archiveUrl = 'https://registry.npmjs.org/alpha/-/alpha-2.4.0.tgz';
    const fixture = await createFixture(
      { alpha: '^2.0.0' },
      berryLock([
        '"alpha@npm:^2.0.0":',
        '  version: 2.4.0',
        '  resolution: "alpha@npm:2.4.0"',
        '  languageName: node',
        '  linkType: hard',
      ]),
    );
    const profile = await requireProfile(fixture.projectRoot);
    const metadataRequests: string[] = [];
    const metadataTransport = exactMetadataTransport(
      metadataRequests,
      'alpha',
      '2.4.0',
      archiveUrl,
      sri(archive),
    );

    const result = await acquirePreviewYarnLockDependencies({
      extractor: recordingExtractor([]),
      metadataTransport,
      profile,
      projectRoot: fixture.projectRoot,
      requiredPackageNames: ['alpha'],
      targetNodeModulesPath: fixture.targetNodeModulesPath,
      transport: archiveTransport(new Map([[archiveUrl, archive]])),
    });

    expect(metadataRequests).toEqual(['https://registry.npmjs.org/alpha/2.4.0']);
    expect(result?.packages).toMatchObject([
      { name: 'alpha', relativePath: 'alpha', version: '2.4.0' },
    ]);
  });

  /** Removes the entire unpublished target when downloaded bytes violate classic lock SRI. */
  it('fails closed and cleans staging after an archive integrity mismatch', async () => {
    const expectedArchive = Buffer.from('expected bytes');
    const downloadedArchive = Buffer.from('different bytes');
    const archiveUrl = 'https://registry.npmjs.org/alpha/-/alpha-1.0.0.tgz';
    const fixture = await createFixture(
      { alpha: '1.0.0' },
      classicLock([classicEntry('alpha@1.0.0', 'alpha', '1.0.0', sri(expectedArchive))]),
    );
    const profile = await requireProfile(fixture.projectRoot);
    const extracted: PreviewPackageArchiveExtractRequest[] = [];

    const result = await acquirePreviewYarnLockDependencies({
      extractor: recordingExtractor(extracted),
      profile,
      projectRoot: fixture.projectRoot,
      requiredPackageNames: ['alpha'],
      targetNodeModulesPath: fixture.targetNodeModulesPath,
      transport: archiveTransport(new Map([[archiveUrl, downloadedArchive]])),
    });

    expect(result).toBeUndefined();
    expect(extracted).toEqual([]);
    await expect(lstat(fixture.targetNodeModulesPath)).rejects.toMatchObject({ code: 'ENOENT' });
  });

  /** Retains the authored alias slot while verifying the archive's actual manifest identity. */
  it('installs a Berry npm alias under its target slot with the actual package name', async () => {
    const archive = Buffer.from('aliased actual archive');
    const archiveUrl = 'https://registry.npmjs.org/actual/-/actual-3.2.1.tgz';
    const fixture = await createFixture(
      { alias: 'npm:actual@^3.0.0' },
      berryLock([
        '"alias@npm:actual@^3.0.0":',
        '  version: 3.2.1',
        '  resolution: "actual@npm:3.2.1"',
        '  languageName: node',
        '  linkType: hard',
      ]),
    );
    const profile = await requireProfile(fixture.projectRoot);
    const extracted: PreviewPackageArchiveExtractRequest[] = [];
    const metadataRequests: string[] = [];

    const result = await acquirePreviewLockedDependencies({
      extractor: recordingExtractor(extracted),
      metadataTransport: exactMetadataTransport(
        metadataRequests,
        'actual',
        '3.2.1',
        archiveUrl,
        sri(archive),
      ),
      profile,
      projectRoot: fixture.projectRoot,
      requiredPackageNames: ['alias'],
      targetNodeModulesPath: fixture.targetNodeModulesPath,
      transport: archiveTransport(new Map([[archiveUrl, archive]])),
    });

    expect(metadataRequests).toEqual(['https://registry.npmjs.org/actual/3.2.1']);
    expect(extracted[0]?.targetPath).toBe(path.join(fixture.targetNodeModulesPath, 'alias'));
    expect(extracted[0]).toMatchObject({ packageName: 'actual', packageVersion: '3.2.1' });
    expect(result?.packages).toMatchObject([
      { name: 'actual', relativePath: 'alias', version: '3.2.1' },
    ]);
    await expect(readPackageName(fixture.targetNodeModulesPath, 'alias')).resolves.toBe('actual');
  });

  /** Propagates caller cancellation through an in-flight Berry metadata request without staging. */
  it('cancels metadata acquisition and leaves no partial package target', async () => {
    const fixture = await createFixture(
      { alpha: '1.0.0' },
      berryLock([
        '"alpha@npm:1.0.0":',
        '  version: 1.0.0',
        '  resolution: "alpha@npm:1.0.0"',
        '  languageName: node',
        '  linkType: hard',
      ]),
    );
    const profile = await requireProfile(fixture.projectRoot);
    const controller = new AbortController();
    let notifyStarted: (() => void) | undefined;
    const started = new Promise<void>((resolve) => {
      notifyStarted = resolve;
    });
    const metadataTransport: PreviewYarnMetadataTransport = {
      download: ({ signal }) =>
        new Promise<Uint8Array>((_resolve, reject) => {
          notifyStarted?.();
          const rejectForAbort = (): void => {
            reject(signal.reason instanceof Error ? signal.reason : new Error('aborted'));
          };
          if (signal.aborted) rejectForAbort();
          else signal.addEventListener('abort', rejectForAbort, { once: true });
        }),
    };
    const cancellation = new Error('obsolete preview revision');

    const acquisition = acquirePreviewYarnLockDependencies({
      metadataTransport,
      profile,
      projectRoot: fixture.projectRoot,
      requiredPackageNames: ['alpha'],
      signal: controller.signal,
      targetNodeModulesPath: fixture.targetNodeModulesPath,
    });
    await started;
    controller.abort(cancellation);

    await expect(acquisition).rejects.toBe(cancellation);
    await expect(lstat(fixture.targetNodeModulesPath)).rejects.toMatchObject({ code: 'ENOENT' });
  });
});

/** Isolated project and extension-owned destination used by one acquisition scenario. */
interface YarnAcquisitionFixture {
  readonly projectRoot: string;
  readonly targetNodeModulesPath: string;
}

/** Writes inert manifest/lock evidence while keeping managed package output outside the project. */
async function createFixture(
  dependencies: Readonly<Record<string, string>>,
  lockText: string,
): Promise<YarnAcquisitionFixture> {
  const fixtureRoot = await mkdtemp(path.join(os.tmpdir(), 'react-preview-yarn-acquirer-'));
  temporaryRoots.push(fixtureRoot);
  const projectRoot = path.join(fixtureRoot, 'project');
  await mkdir(projectRoot, { recursive: true });
  await Promise.all([
    writeFile(
      path.join(projectRoot, 'package.json'),
      JSON.stringify({ dependencies, name: 'fixture', version: '1.0.0' }),
      'utf8',
    ),
    writeFile(path.join(projectRoot, 'yarn.lock'), lockText, 'utf8'),
  ]);
  return Object.freeze({
    projectRoot,
    targetNodeModulesPath: path.join(fixtureRoot, 'managed', 'node_modules'),
  });
}

/** Requires production discovery to capture the exact lock digest used by the adapter. */
async function requireProfile(projectRoot: string): Promise<PreviewDependencyProfile> {
  const profile = await readPreviewDependencyProfile(projectRoot);
  if (profile === undefined) throw new Error('Expected a dependency profile for this fixture.');
  return profile;
}

/** Returns immutable archive bytes only for URLs explicitly admitted by the test scenario. */
function archiveTransport(
  archivesByUrl: ReadonlyMap<string, Uint8Array>,
): PreviewPackageArchiveTransport {
  return Object.freeze({
    download: ({ signal, url }: PreviewPackageArchiveTransportRequest) => {
      if (signal.aborted) throw signal.reason;
      const archive = archivesByUrl.get(url);
      if (archive === undefined) throw new Error(`Unexpected archive URL: ${url}`);
      return Promise.resolve(Uint8Array.from(archive));
    },
  });
}

/** Materializes a minimal valid package and records the exact identity/path contract received. */
function recordingExtractor(
  requests: PreviewPackageArchiveExtractRequest[],
): PreviewPackageArchiveExtractor {
  return Object.freeze({
    extract: async (request: PreviewPackageArchiveExtractRequest) => {
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

/** Returns exact-version metadata and records the canonical URL built by the production adapter. */
function exactMetadataTransport(
  requestedUrls: string[],
  packageName: string,
  packageVersion: string,
  archiveUrl: string,
  integrity: string,
): PreviewYarnMetadataTransport {
  return Object.freeze({
    download: (request: PreviewYarnMetadataTransportRequest) => {
      requestedUrls.push(request.url);
      expect(request).toMatchObject({ packageName, packageVersion });
      return Promise.resolve(
        Buffer.from(
          JSON.stringify({
            dist: { integrity, tarball: archiveUrl },
            name: packageName,
            version: packageVersion,
          }),
        ),
      );
    },
  });
}

/** Reads the manifest name from one authored node_modules slot, including alias destinations. */
async function readPackageName(nodeModulesPath: string, packageSlot: string): Promise<string> {
  const manifest = JSON.parse(
    await readFile(path.join(nodeModulesPath, packageSlot, 'package.json'), 'utf8'),
  ) as { readonly name: string };
  return manifest.name;
}

/** Computes the canonical strong integrity token stored by supported public Yarn locks. */
function sri(archive: Uint8Array): string {
  return `sha512-${createHash('sha512').update(archive).digest('base64')}`;
}

/** Serializes the minimal stable header accepted by the Yarn classic parser. */
function classicLock(entries: readonly string[]): string {
  return ['# yarn lockfile v1', '', ...entries].join('\n');
}

/** Serializes one classic exact public archive entry with caller-provided strong integrity. */
function classicEntry(
  descriptor: string,
  packageName: string,
  version: string,
  integrity: string,
): string {
  return [
    `"${descriptor}":`,
    `  version "${version}"`,
    `  resolved "https://registry.yarnpkg.com/${packageName}/-/${packageName}-${version}.tgz#deadbeef"`,
    `  integrity ${integrity}`,
    '',
  ].join('\n');
}

/** Adds supported Berry metadata around exact package records used by a scenario. */
function berryLock(lines: readonly string[]): string {
  return ['__metadata:', '  version: 6', '  cacheKey: 8', '', ...lines, ''].join('\n');
}
