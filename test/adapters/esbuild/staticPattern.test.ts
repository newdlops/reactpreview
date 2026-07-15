/**
 * Verifies deterministic, bounded, workspace-confined expansion for framework resource macros.
 * Temporary directories exercise the real filesystem so traversal and symlink checks cannot be
 * accidentally satisfied by a permissive mock.
 */
import { mkdtemp, mkdir, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import {
  expandStaticPatterns,
  StaticPatternError,
} from '../../../src/adapters/esbuild/staticResources/staticPattern';

const temporaryRoots: string[] = [];

afterEach(async () => {
  await Promise.all(
    temporaryRoots
      .splice(0)
      .map((temporaryRoot) => rm(temporaryRoot, { force: true, recursive: true })),
  );
});

describe('expandStaticPatterns', () => {
  /** Applies positive and negative patterns in stable key order and returns the fixed watch root. */
  it('expands supported patterns deterministically', async () => {
    const workspaceRoot = await createTemporaryWorkspace();
    const sourceDirectory = path.join(workspaceRoot, 'src');
    const pagesDirectory = path.join(sourceDirectory, 'pages');
    await mkdir(path.join(pagesDirectory, 'admin'), { recursive: true });
    await Promise.all([
      writeFile(path.join(pagesDirectory, 'Home.tsx'), 'export default 1;'),
      writeFile(path.join(pagesDirectory, 'About.tsx'), 'export default 2;'),
      writeFile(path.join(pagesDirectory, 'admin', 'Admin.tsx'), 'export default 3;'),
    ]);

    const expansion = await expandStaticPatterns({
      importerPath: path.join(sourceDirectory, 'entry.tsx'),
      patterns: ['./pages/**/*.tsx', '!./pages/admin/**'],
      workspaceRoot,
    });

    expect(expansion.matches.map(({ key }) => key)).toEqual([
      './pages/About.tsx',
      './pages/Home.tsx',
    ]);
    expect(expansion.watchDirectories).toEqual([pagesDirectory]);
  });

  /** Rejects an otherwise valid local pattern when its finite result exceeds the caller's cap. */
  it('enforces the match budget', async () => {
    const workspaceRoot = await createTemporaryWorkspace();
    const pagesDirectory = path.join(workspaceRoot, 'src', 'pages');
    await mkdir(pagesDirectory, { recursive: true });
    await Promise.all([
      writeFile(path.join(pagesDirectory, 'A.tsx'), 'export default 1;'),
      writeFile(path.join(pagesDirectory, 'B.tsx'), 'export default 2;'),
    ]);

    await expect(
      expandStaticPatterns({
        importerPath: path.join(workspaceRoot, 'src', 'entry.tsx'),
        maxMatches: 1,
        patterns: ['./pages/*.tsx'],
        workspaceRoot,
      }),
    ).rejects.toThrow('matched 2 files');
  });

  /** Rejects oversized literal lists before issuing an unbounded number of exact filesystem probes. */
  it('limits pattern count and charges exact paths to the scan budget', async () => {
    const workspaceRoot = await createTemporaryWorkspace();
    const importerPath = path.join(workspaceRoot, 'src', 'entry.tsx');
    await mkdir(path.dirname(importerPath), { recursive: true });

    await expect(
      expandStaticPatterns({
        importerPath,
        patterns: Array.from({ length: 129 }, (_, index) => `./missing-${index.toString()}.tsx`),
        workspaceRoot,
      }),
    ).rejects.toThrow('at most 128 patterns');
    await expect(
      expandStaticPatterns({
        importerPath,
        maxScannedEntries: 1,
        patterns: ['./missing-a.tsx', './missing-b.tsx'],
        workspaceRoot,
      }),
    ).rejects.toThrow('scanned more than 1');
  });

  /** Avoids scanning nested trees that a single-segment filename glob can never match. */
  it('limits traversal depth to the pattern structure', async () => {
    const workspaceRoot = await createTemporaryWorkspace();
    const pagesDirectory = path.join(workspaceRoot, 'src', 'pages');
    const nestedDirectory = path.join(pagesDirectory, 'deeply-nested');
    await mkdir(nestedDirectory, { recursive: true });
    await Promise.all([
      writeFile(path.join(pagesDirectory, 'Visible.tsx'), 'export default 1;'),
      writeFile(path.join(nestedDirectory, 'IgnoredA.tsx'), 'export default 2;'),
      writeFile(path.join(nestedDirectory, 'IgnoredB.tsx'), 'export default 3;'),
    ]);

    const expansion = await expandStaticPatterns({
      importerPath: path.join(workspaceRoot, 'src', 'entry.tsx'),
      maxScannedEntries: 2,
      patterns: ['./pages/*.tsx'],
      workspaceRoot,
    });

    expect(expansion.matches.map(({ key }) => key)).toEqual(['./pages/Visible.tsx']);
  });

  /** Keeps an empty future glob root watchable even when an operating-system parent is symlinked. */
  it('accepts a missing discovery directory below the workspace', async () => {
    const workspaceRoot = await createTemporaryWorkspace();
    const missingDirectory = path.join(workspaceRoot, 'src', 'future-pages');
    await mkdir(path.dirname(missingDirectory), { recursive: true });

    const expansion = await expandStaticPatterns({
      importerPath: path.join(workspaceRoot, 'src', 'entry.tsx'),
      patterns: ['./future-pages/*.tsx'],
      workspaceRoot,
    });

    expect(expansion.matches).toEqual([]);
    expect(expansion.watchDirectories).toEqual([missingDirectory]);
  });

  /** Stops a relative pattern before it can scan a sibling of the trusted workspace. */
  it('rejects lexical traversal outside the workspace', async () => {
    const temporaryRoot = await createTemporaryRoot();
    const workspaceRoot = path.join(temporaryRoot, 'workspace');
    await mkdir(path.join(workspaceRoot, 'src'), { recursive: true });

    await expect(
      expandStaticPatterns({
        importerPath: path.join(workspaceRoot, 'src', 'entry.tsx'),
        patterns: ['../../outside/*.tsx'],
        workspaceRoot,
      }),
    ).rejects.toBeInstanceOf(StaticPatternError);
  });

  /** Resolves an existing fixed-prefix symlink and rejects it when the target leaves the workspace. */
  it('rejects symlinked discovery roots outside the workspace', async () => {
    const temporaryRoot = await createTemporaryRoot();
    const workspaceRoot = path.join(temporaryRoot, 'workspace');
    const sourceDirectory = path.join(workspaceRoot, 'src');
    const outsideDirectory = path.join(temporaryRoot, 'outside');
    await Promise.all([
      mkdir(sourceDirectory, { recursive: true }),
      mkdir(outsideDirectory, { recursive: true }),
    ]);
    await writeFile(path.join(outsideDirectory, 'Outside.tsx'), 'export default 1;');
    await symlink(outsideDirectory, path.join(sourceDirectory, 'linked-pages'), 'dir');

    await expect(
      expandStaticPatterns({
        importerPath: path.join(sourceDirectory, 'entry.tsx'),
        patterns: ['./linked-pages/*.tsx'],
        workspaceRoot,
      }),
    ).rejects.toThrow('must stay inside the workspace');
  });

  /** Follows an internal directory symlink once and exposes matches through its lexical import key. */
  it('includes workspace-internal symlinked directories without following loops', async () => {
    const workspaceRoot = await createTemporaryWorkspace();
    const sourceDirectory = path.join(workspaceRoot, 'src');
    const pagesDirectory = path.join(sourceDirectory, 'pages');
    const sharedDirectory = path.join(workspaceRoot, 'shared', 'admin');
    await Promise.all([
      mkdir(pagesDirectory, { recursive: true }),
      mkdir(sharedDirectory, { recursive: true }),
    ]);
    await writeFile(path.join(sharedDirectory, 'Admin.tsx'), 'export default 1;');
    await symlink(sharedDirectory, path.join(pagesDirectory, 'admin'), 'dir');

    const expansion = await expandStaticPatterns({
      importerPath: path.join(sourceDirectory, 'entry.tsx'),
      patterns: ['./pages/**/*.tsx'],
      workspaceRoot,
    });

    expect(expansion.matches.map(({ key }) => key)).toEqual(['./pages/admin/Admin.tsx']);
  });

  /** Treats metadata directory names case-insensitively and keeps partial `**` within one segment. */
  it('excludes metadata variants and does not make partial globstars cross directories', async () => {
    const workspaceRoot = await createTemporaryWorkspace();
    const pagesDirectory = path.join(workspaceRoot, 'src', 'pages');
    await Promise.all([
      mkdir(path.join(pagesDirectory, 'NODE_MODULES'), { recursive: true }),
      mkdir(path.join(pagesDirectory, 'nested'), { recursive: true }),
    ]);
    await Promise.all([
      writeFile(path.join(pagesDirectory, 'fooXXbar.tsx'), 'export default 1;'),
      writeFile(path.join(pagesDirectory, 'nested', 'fooXXbar.tsx'), 'export default 2;'),
      writeFile(path.join(pagesDirectory, 'NODE_MODULES', 'fooXXbar.tsx'), 'export default 3;'),
    ]);

    const expansion = await expandStaticPatterns({
      importerPath: path.join(workspaceRoot, 'src', 'entry.tsx'),
      patterns: ['./pages/foo**bar.tsx'],
      workspaceRoot,
    });

    expect(expansion.matches.map(({ key }) => key)).toEqual(['./pages/fooXXbar.tsx']);
  });
});

/** Creates and records one empty operating-system temporary directory for automatic cleanup. */
async function createTemporaryRoot(): Promise<string> {
  const temporaryRoot = await mkdtemp(path.join(tmpdir(), 'react-preview-static-pattern-'));
  temporaryRoots.push(temporaryRoot);
  return temporaryRoot;
}

/** Creates one workspace directory below a recorded temporary root. */
async function createTemporaryWorkspace(): Promise<string> {
  const temporaryRoot = await createTemporaryRoot();
  const workspaceRoot = path.join(temporaryRoot, 'workspace');
  await mkdir(workspaceRoot, { recursive: true });
  return workspaceRoot;
}
