/** Verifies deterministic project dependency identities and conservative bundled-version checks. */
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import {
  doesPreviewSpecifierAcceptVersion,
  findPreviewDependencySpecifier,
  readPreviewDependencyProfile,
} from '../../../src/adapters/node/previewDependencyProfile';

const temporaryRoots: string[] = [];

afterEach(async () => {
  await Promise.all(
    temporaryRoots
      .splice(0)
      .map(async (rootPath) => rm(rootPath, { force: true, recursive: true })),
  );
});

describe('preview dependency profile', () => {
  /** Ignores manifest order, path, scripts and descriptive metadata in the reusable identity. */
  it('creates the same fingerprint for equivalent dependency maps in different projects', async () => {
    const leftRoot = await createProject({
      dependencies: { react: '^19.0.0', zed: '1.0.0' },
      name: 'left',
      scripts: { postinstall: 'never-run' },
    });
    const rightRoot = await createProject({
      dependencies: { zed: '1.0.0', react: '^19.0.0' },
      description: 'different inert metadata',
      name: 'right',
    });

    const left = await readPreviewDependencyProfile(leftRoot);
    const right = await readPreviewDependencyProfile(rightRoot);

    expect(left?.fingerprint).toBe(right?.fingerprint);
    expect(left?.manifestPath).not.toBe(right?.manifestPath);
    expect(findPreviewDependencySpecifier(left, 'react')).toBe('^19.0.0');
  });

  /** Changes identity for runtime evidence and keeps dependency-field precedence explicit. */
  it('separates incompatible package requirements', async () => {
    const firstRoot = await createProject({
      dependencies: { react: '^18.0.0' },
      devDependencies: { react: '^17.0.0' },
    });
    const secondRoot = await createProject({ dependencies: { react: '^19.0.0' } });
    const first = await readPreviewDependencyProfile(firstRoot);
    const second = await readPreviewDependencyProfile(secondRoot);

    expect(first?.fingerprint).not.toBe(second?.fingerprint);
    expect(findPreviewDependencySpecifier(first, 'react')).toBe('^18.0.0');
  });

  /** Separates identical ranges when lockfiles prove different resolved dependency graphs. */
  it('includes bounded lockfile content in the profile identity', async () => {
    const firstRoot = await createProject({ dependencies: { react: '^19.0.0' } });
    const secondRoot = await createProject({ dependencies: { react: '^19.0.0' } });
    await Promise.all([
      writeFile(path.join(firstRoot, 'package-lock.json'), '{"lockfileVersion":3,"a":1}', 'utf8'),
      writeFile(path.join(secondRoot, 'package-lock.json'), '{"lockfileVersion":3,"a":2}', 'utf8'),
    ]);

    const first = await readPreviewDependencyProfile(firstRoot);
    const second = await readPreviewDependencyProfile(secondRoot);

    expect(first?.fingerprint).not.toBe(second?.fingerprint);
    expect(first?.dependencyPaths).toContain(path.join(firstRoot, 'package-lock.json'));
  });

  /** Finds a monorepo lock above the nearest package and observes its exact graph revision. */
  it('includes workspace-root lock evidence for a nested project profile', async () => {
    const workspaceRoot = await mkdtemp(path.join(os.tmpdir(), 'react-preview-profile-workspace-'));
    temporaryRoots.push(workspaceRoot);
    const projectRoot = path.join(workspaceRoot, 'packages', 'application');
    const lockfilePath = path.join(workspaceRoot, 'package-lock.json');
    await mkdir(projectRoot, { recursive: true });
    await Promise.all([
      writeFile(
        path.join(projectRoot, 'package.json'),
        JSON.stringify({ dependencies: { react: '^19.0.0' }, name: 'nested-application' }),
        'utf8',
      ),
      writeFile(lockfilePath, '{"lockfileVersion":3,"resolvedRevision":1}', 'utf8'),
    ]);

    const first = await readPreviewDependencyProfile(projectRoot, workspaceRoot);
    await writeFile(lockfilePath, '{"lockfileVersion":3,"resolvedRevision":2}', 'utf8');
    const second = await readPreviewDependencyProfile(projectRoot, workspaceRoot);

    expect(first?.hasReusableLockEvidence).toBe(true);
    expect(first?.dependencyPaths).toContain(lockfilePath);
    expect(first?.fingerprint).not.toBe(second?.fingerprint);
  });

  /** Accepts common exact/caret/tilde/wildcard/comparator ranges and rejects unsafe protocols. */
  it('proves only conservative exact-version compatibility', () => {
    expect(doesPreviewSpecifierAcceptVersion('^19.0.0', '19.2.7')).toBe(true);
    expect(doesPreviewSpecifierAcceptVersion('^18.0.0', '19.2.7')).toBe(false);
    expect(doesPreviewSpecifierAcceptVersion('^18', '18.3.1')).toBe(true);
    expect(doesPreviewSpecifierAcceptVersion('^18', '19.0.0')).toBe(false);
    expect(doesPreviewSpecifierAcceptVersion('^18.2', '18.2.7')).toBe(true);
    expect(doesPreviewSpecifierAcceptVersion('^18.2', '18.9.0')).toBe(true);
    expect(doesPreviewSpecifierAcceptVersion('^18.2', '18.1.9')).toBe(false);
    expect(doesPreviewSpecifierAcceptVersion('~19.2.0', '19.2.7')).toBe(true);
    expect(doesPreviewSpecifierAcceptVersion('~18', '18.9.9')).toBe(true);
    expect(doesPreviewSpecifierAcceptVersion('~18', '19.0.0')).toBe(false);
    expect(doesPreviewSpecifierAcceptVersion('~18.2', '18.2.7')).toBe(true);
    expect(doesPreviewSpecifierAcceptVersion('~18.2', '18.3.0')).toBe(false);
    expect(doesPreviewSpecifierAcceptVersion('19.2.x', '19.2.7')).toBe(true);
    expect(doesPreviewSpecifierAcceptVersion('>=19.0.0 <20.0.0', '19.2.7')).toBe(true);
    expect(doesPreviewSpecifierAcceptVersion('workspace:*', '19.2.7')).toBe(false);
    expect(doesPreviewSpecifierAcceptVersion('19 || 20', '19.2.7')).toBe(false);
    expect(doesPreviewSpecifierAcceptVersion('^18.0.0-beta.1', '18.3.1')).toBe(false);
  });
});

/** Writes one inert project manifest in an isolated workspace fixture. */
async function createProject(manifest: Readonly<Record<string, unknown>>): Promise<string> {
  const rootPath = await mkdtemp(path.join(os.tmpdir(), 'react-preview-profile-'));
  temporaryRoots.push(rootPath);
  await mkdir(rootPath, { recursive: true });
  await writeFile(path.join(rootPath, 'package.json'), JSON.stringify(manifest), 'utf8');
  return rootPath;
}
