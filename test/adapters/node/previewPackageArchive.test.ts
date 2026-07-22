/** Verifies production tar extraction for npm's two legitimate single-root archive conventions. */
import { createHash } from 'node:crypto';
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { create as createTar } from 'tar';
import { afterEach, describe, expect, it } from 'vitest';
import {
  materializePreviewPackageArchives,
  type PreviewVerifiedPackageArchivePlanEntry,
} from '../../../src/adapters/node/previewPackageArchive';

const temporaryRoots: string[] = [];

afterEach(async () => {
  await Promise.all(
    temporaryRoots
      .splice(0)
      .map(async (rootPath) => rm(rootPath, { force: true, recursive: true })),
  );
});

describe('materializePreviewPackageArchives', () => {
  /** Ordinary npm tarballs retain their conventional `package/` prefix through preflight. */
  it('accepts a standard npm package archive root', async () => {
    const fixture = await createArchiveFixture('package', 'standard-package', '1.2.3', {
      'index.js': 'export default "preview";',
    });
    const targetNodeModulesPath = path.join(fixture.rootPath, 'staging', 'node_modules');

    const result = await materializePreviewPackageArchives({
      entries: [archiveEntry('standard-package', '1.2.3', fixture.archive)],
      targetNodeModulesPath,
      transport: { download: () => Promise.resolve(fixture.archive) },
    });

    expect(result?.packages).toEqual([
      expect.objectContaining({
        name: 'standard-package',
        relativePath: 'standard-package',
        version: '1.2.3',
      }),
    ]);
    await expect(
      readFile(path.join(targetNodeModulesPath, 'standard-package', 'index.js'), 'utf8'),
    ).resolves.toContain('preview');
  });

  /** DefinitelyTyped tarballs use `invariant/` rather than npm's usual `package/` prefix. */
  it('accepts one consistent legacy DefinitelyTyped archive root', async () => {
    const fixtureRoot = await mkdtemp(path.join(os.tmpdir(), 'react-preview-types-archive-'));
    temporaryRoots.push(fixtureRoot);
    const sourceRoot = path.join(fixtureRoot, 'source');
    const packageRoot = path.join(sourceRoot, 'invariant');
    const archivePath = path.join(fixtureRoot, 'invariant.tgz');
    await mkdir(packageRoot, { recursive: true });
    await Promise.all([
      writeFile(
        path.join(packageRoot, 'package.json'),
        JSON.stringify({ name: '@types/invariant', version: '2.2.37' }),
        'utf8',
      ),
      writeFile(
        path.join(packageRoot, 'index.d.ts'),
        'declare function invariant(): void;',
        'utf8',
      ),
    ]);
    await createTar({ cwd: sourceRoot, file: archivePath, gzip: true }, ['invariant']);
    const archive = await readFile(archivePath);
    const targetNodeModulesPath = path.join(fixtureRoot, 'staging', 'node_modules');

    const result = await materializePreviewPackageArchives({
      entries: [
        {
          packageName: '@types/invariant',
          packageVersion: '2.2.37',
          sha512Digest: createHash('sha512').update(archive).digest(),
          targetRelativePath: '@types/invariant',
          url: 'https://registry.npmjs.org/@types/invariant/-/invariant-2.2.37.tgz',
        },
      ],
      targetNodeModulesPath,
      transport: { download: () => Promise.resolve(archive) },
    });

    expect(result?.packages).toEqual([
      expect.objectContaining({
        name: '@types/invariant',
        relativePath: path.join('@types', 'invariant'),
        version: '2.2.37',
      }),
    ]);
    await expect(
      readFile(path.join(targetNodeModulesPath, '@types', 'invariant', 'index.d.ts'), 'utf8'),
    ).resolves.toContain('invariant');
  });

  /** A tar cannot escape the one stripped root by introducing a second top-level directory. */
  it('rejects mixed archive roots during list-only preflight', async () => {
    const fixtureRoot = await mkdtemp(path.join(os.tmpdir(), 'react-preview-mixed-archive-'));
    temporaryRoots.push(fixtureRoot);
    const sourceRoot = path.join(fixtureRoot, 'source');
    await Promise.all([
      writePackageRoot(sourceRoot, 'package', 'mixed-package', '1.0.0'),
      writePackageRoot(sourceRoot, 'other', 'other-package', '1.0.0'),
    ]);
    const archive = await createArchive(sourceRoot, path.join(fixtureRoot, 'mixed.tgz'), [
      'package',
      'other',
    ]);
    const targetNodeModulesPath = path.join(fixtureRoot, 'staging', 'node_modules');

    const result = await materializePreviewPackageArchives({
      entries: [archiveEntry('mixed-package', '1.0.0', archive)],
      targetNodeModulesPath,
      transport: { download: () => Promise.resolve(archive) },
    });

    expect(result).toBeUndefined();
    await expect(
      readFile(path.join(targetNodeModulesPath, 'mixed-package', 'package.json'), 'utf8'),
    ).rejects.toThrow();
  });

  /** Case aliases of package-manager executable and cache directories stay forbidden. */
  it('rejects case-insensitive sensitive directory aliases', async () => {
    const fixture = await createArchiveFixture('package', 'sensitive-package', '1.0.0', {
      '.BIN/command': 'malicious shim',
      '.CACHE/value': 'mutable cache',
    });

    const result = await materializePreviewPackageArchives({
      entries: [archiveEntry('sensitive-package', '1.0.0', fixture.archive)],
      targetNodeModulesPath: path.join(fixture.rootPath, 'staging', 'node_modules'),
      transport: { download: () => Promise.resolve(fixture.archive) },
    });

    expect(result).toBeUndefined();
  });

  /** A nested npm separator must always be followed by another complete package slot. */
  it('rejects a target plan ending in node_modules before downloading', async () => {
    let downloadCalled = false;
    const digest = Buffer.alloc(64, 1);

    const result = await materializePreviewPackageArchives({
      entries: [
        {
          packageName: 'owner-package',
          packageVersion: '1.0.0',
          sha512Digest: digest,
          targetRelativePath: 'owner-package',
          url: 'https://registry.npmjs.org/owner-package/-/owner-package-1.0.0.tgz',
        },
        {
          packageName: 'invalid-package',
          packageVersion: '1.0.0',
          sha512Digest: digest,
          targetRelativePath: 'owner-package/node_modules',
          url: 'https://registry.npmjs.org/invalid-package/-/invalid-package-1.0.0.tgz',
        },
      ],
      targetNodeModulesPath: path.join(os.tmpdir(), 'unused-preview-target', 'node_modules'),
      transport: {
        download: () => {
          downloadCalled = true;
          return Promise.resolve(Buffer.alloc(0));
        },
      },
    });

    expect(result).toBeUndefined();
    expect(downloadCalled).toBe(false);
  });
});

/** Exact production-style fixture retained until the test-level cleanup hook runs. */
interface ArchiveFixture {
  readonly archive: Buffer;
  readonly rootPath: string;
}

/** Creates one gzip tar with an exact root, manifest, and optional ordinary package files. */
async function createArchiveFixture(
  rootPrefix: string,
  packageName: string,
  packageVersion: string,
  files: Readonly<Record<string, string>>,
): Promise<ArchiveFixture> {
  const rootPath = await mkdtemp(path.join(os.tmpdir(), 'react-preview-package-archive-'));
  temporaryRoots.push(rootPath);
  const sourceRoot = path.join(rootPath, 'source');
  await writePackageRoot(sourceRoot, rootPrefix, packageName, packageVersion, files);
  const archive = await createArchive(sourceRoot, path.join(rootPath, 'package.tgz'), [rootPrefix]);
  return { archive, rootPath };
}

/** Writes one package directory without relying on lifecycle scripts or package-manager behavior. */
async function writePackageRoot(
  sourceRoot: string,
  rootPrefix: string,
  packageName: string,
  packageVersion: string,
  files: Readonly<Record<string, string>> = {},
): Promise<void> {
  const packageRoot = path.join(sourceRoot, rootPrefix);
  await mkdir(packageRoot, { recursive: true });
  await writeFile(
    path.join(packageRoot, 'package.json'),
    JSON.stringify({ name: packageName, version: packageVersion }),
    'utf8',
  );
  for (const [relativePath, contents] of Object.entries(files)) {
    const filePath = path.join(packageRoot, ...relativePath.split('/'));
    await mkdir(path.dirname(filePath), { recursive: true });
    await writeFile(filePath, contents, 'utf8');
  }
}

/** Serializes selected source roots and returns the exact compressed bytes used for SRI. */
async function createArchive(
  sourceRoot: string,
  archivePath: string,
  roots: readonly string[],
): Promise<Buffer> {
  await createTar({ cwd: sourceRoot, file: archivePath, gzip: true }, [...roots]);
  return readFile(archivePath);
}

/** Creates one canonical public-registry archive plan entry for an unscoped package fixture. */
function archiveEntry(
  packageName: string,
  packageVersion: string,
  archive: Buffer,
): PreviewVerifiedPackageArchivePlanEntry {
  return {
    packageName,
    packageVersion,
    sha512Digest: createHash('sha512').update(archive).digest(),
    targetRelativePath: packageName,
    url: `https://registry.npmjs.org/${packageName}/-/${packageName}-${packageVersion}.tgz`,
  } as const;
}
