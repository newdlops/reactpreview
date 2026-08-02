import { execFile } from 'node:child_process';
import {
  chmod,
  lstat,
  mkdir,
  mkdtemp,
  readFile,
  readdir,
  realpath,
  rm,
  symlink,
  writeFile,
} from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { promisify } from 'node:util';
import { afterEach, describe, expect, it } from 'vitest';
import type { PreviewBuildRequest } from '../../../src/domain/preview';
import {
  PREVIEW_COMPLETE_ROUTE_REPLAY_POLICY_DIGEST,
  type PreviewInspectorCompleteRouteInventory,
} from '../../../src/adapters/esbuild/inspector/previewInspectorCompleteRouteInventory';
import { createPreviewRouteExecutionPlanFixture } from '../../support/previewRouteExecutionPlanFixture';
import {
  createPreviewDependencyView,
  verifyPreviewDependencyView,
} from '../../../src/adapters/node/previewDependencyView';
import { runPreviewImmutableSnapshotCli } from '../../../src/adapters/node/previewImmutableSnapshotCli';
import { freezePreviewSnapshotInventoryLineage } from '../../../src/adapters/node/previewSnapshotInventoryLineage';
import {
  assertPreviewSnapshotTrackedFiles,
  createPreviewTrackedSourceSnapshot,
  normalizePreviewSnapshotAllowlist,
  verifyPreviewTrackedSourceSnapshot,
} from '../../../src/adapters/node/previewTrackedSourceSnapshot';

const run = promisify(execFile);
const temporaryDirectories: string[] = [];

afterEach(async () => {
  await Promise.all(
    temporaryDirectories.splice(0).map(async (directory) => {
      await makeWritable(directory);
      await rm(directory, { force: true, recursive: true });
    }),
  );
});

describe('immutable tracked source snapshot', () => {
  it('atomically accepts matching archive, tracked blob, file, and content manifests', async () => {
    const fixture = await createGitFixture();
    const snapshotPath = path.join(fixture.directory, 'accepted-snapshot');
    const manifest = await createSnapshot(fixture, snapshotPath);
    const verified = await verifyPreviewTrackedSourceSnapshot(snapshotPath);

    expect(manifest.commit).toBe(fixture.commit);
    expect(manifest.tree).toBe(fixture.tree);
    expect(manifest.files.map((file) => file.path)).toEqual([
      'package.json',
      'src/App.tsx',
      'yarn.lock',
      'zuzu/client/package.json',
    ]);
    expect(verified.manifestDigest).toBe(manifest.manifestDigest);
    expect((await lstat(path.join(snapshotPath, 'source', 'src', 'App.tsx'))).mode & 0o222).toBe(0);
    await expect(createSnapshot(fixture, snapshotPath)).rejects.toThrow('already exists');
  });

  it('rejects traversal, sensitive/generated paths, links, and later content drift', async () => {
    expect(() => normalizePreviewSnapshotAllowlist(['../outside'])).toThrow('traversal');
    expect(() => normalizePreviewSnapshotAllowlist(['/absolute'])).toThrow('relative');
    expect(() => normalizePreviewSnapshotAllowlist(['.env.production'])).toThrow('sensitive');
    expect(() => normalizePreviewSnapshotAllowlist(['src/node_modules/pkg'])).toThrow('generated');
    expect(() =>
      { assertPreviewSnapshotTrackedFiles([
        { blobId: 'a'.repeat(40), mode: '120000', path: 'unsafe-link' },
      ]); },
    ).toThrow('regular tracked file');

    const fixture = await createGitFixture();
    await expect(
      createPreviewTrackedSourceSnapshot({
        allowlist: ['unsafe-link'],
        commit: fixture.commit,
        destinationPath: path.join(fixture.directory, 'link-snapshot'),
        repositoryPath: fixture.repository,
        tree: fixture.tree,
      }),
    ).rejects.toThrow('regular tracked file');

    const snapshotPath = path.join(fixture.directory, 'drift-snapshot');
    await createSnapshot(fixture, snapshotPath);
    const targetPath = path.join(snapshotPath, 'source', 'src', 'App.tsx');
    await chmod(targetPath, 0o644);
    await writeFile(targetPath, 'export default function Changed() {}');
    await expect(verifyPreviewTrackedSourceSnapshot(snapshotPath)).rejects.toThrow(
      /blob does not match Git|content hash has changed/u,
    );
  });
});

describe('audited dependency view', () => {
  it('links approved packages, omits caches, and remaps the workspace package to snapshot source', async () => {
    const fixture = await createGitFixture();
    const snapshotPath = path.join(fixture.directory, 'dependency-snapshot');
    const sourceManifest = await createSnapshot(fixture, snapshotPath);
    const dependencyRoot = path.join(fixture.directory, 'installed', 'node_modules');
    await createDependencyRoot(dependencyRoot);

    const manifest = await createPreviewDependencyView({
      approvedDependencyRoots: [dependencyRoot],
      snapshotPath,
      sourceManifest,
      workspacePackageName: '@zuzu/client',
      workspacePackagePath: 'zuzu/client',
    });
    const verified = await verifyPreviewDependencyView(snapshotPath);
    const sourceRoot = path.join(snapshotPath, 'source');

    expect(manifest.links.some((link) => link.packageName === 'react')).toBe(true);
    expect(await realpath(path.join(sourceRoot, 'node_modules', 'react'))).toBe(
      await realpath(path.join(dependencyRoot, 'react')),
    );
    expect(await realpath(path.join(sourceRoot, 'node_modules', '@zuzu', 'client'))).toBe(
      await realpath(path.join(sourceRoot, 'zuzu', 'client')),
    );
    await expect(lstat(path.join(sourceRoot, 'node_modules', '.bin'))).rejects.toMatchObject({
      code: 'ENOENT',
    });
    expect(verified.dependencyViewDigest).toBe(manifest.dependencyViewDigest);

    await makeWritable(snapshotPath);
    await writeFile(path.join(dependencyRoot, 'react', 'package.json'), '{"name":"changed"}');
    await expect(verifyPreviewDependencyView(snapshotPath)).rejects.toThrow(
      'package manifest changed',
    );
  });

  it('rejects installed package links escaping an approved root', async () => {
    const fixture = await createGitFixture();
    const snapshotPath = path.join(fixture.directory, 'escaped-dependency-snapshot');
    const sourceManifest = await createSnapshot(fixture, snapshotPath);
    const dependencyRoot = path.join(fixture.directory, 'escaped-installed', 'node_modules');
    const outsidePackage = path.join(fixture.directory, 'outside-package');
    await mkdir(dependencyRoot, { recursive: true });
    await mkdir(outsidePackage, { recursive: true });
    await writeFile(path.join(outsidePackage, 'package.json'), '{"name":"escaped"}');
    await writeFile(path.join(dependencyRoot, '.yarn-integrity'), '{}');
    await symlink(outsidePackage, path.join(dependencyRoot, 'escaped'));

    await expect(
      createPreviewDependencyView({
        approvedDependencyRoots: [dependencyRoot],
        snapshotPath,
        sourceManifest,
        workspacePackageName: '@zuzu/client',
        workspacePackagePath: 'zuzu/client',
      }),
    ).rejects.toThrow('escaped its approved root');
  });

  it('keeps the workspace link valid at the final CLI destination', async () => {
    const fixture = await createGitFixture();
    const snapshotPath = path.join(fixture.directory, 'cli-snapshot');
    const dependencyRoot = path.join(fixture.directory, 'cli-installed', 'node_modules');
    await createDependencyRoot(dependencyRoot);

    await expect(
      runPreviewImmutableSnapshotCli([
        '--repository',
        fixture.repository,
        '--commit',
        fixture.commit,
        '--tree',
        fixture.tree,
        '--destination',
        snapshotPath,
        '--allow',
        'package.json',
        '--allow',
        'yarn.lock',
        '--allow',
        'zuzu/client/package.json',
        '--dependency-root',
        dependencyRoot,
        '--workspace-package-name',
        '@zuzu/client',
        '--workspace-package-path',
        'zuzu/client',
      ]),
    ).resolves.toBe(0);
    await expect(verifyPreviewDependencyView(snapshotPath)).resolves.toBeDefined();
    expect(
      await realpath(path.join(snapshotPath, 'source', 'node_modules', '@zuzu', 'client')),
    ).toBe(await realpath(path.join(snapshotPath, 'source', 'zuzu', 'client')));
  });
});

describe('snapshot inventory lineage', () => {
  it('writes evidence only after two fresh confined inventories are identical', async () => {
    const directory = await mkdtemp(path.join(tmpdir(), 'preview-inventory-test-'));
    temporaryDirectories.push(directory);
    const sourceRoot = path.join(directory, 'source');
    const dependencyRoot = path.join(directory, 'installed', 'node_modules');
    const documentPath = path.join(sourceRoot, 'App.tsx');
    const evidencePath = path.join(directory, 'evidence', 'inventory.json');
    await mkdir(sourceRoot, { recursive: true });
    await mkdir(dependencyRoot, { recursive: true });
    await writeFile(documentPath, 'export default function App() {}');
    const inventory = createInventory(documentPath, 'route');
    let compilerCount = 0;

    const manifest = await freezePreviewSnapshotInventoryLineage({
      createCompiler: () => {
        compilerCount += 1;
        return {
          collectCompleteRouteInventory: () => Promise.resolve(inventory),
          shutdown: () => Promise.resolve(),
        };
      },
      evidencePath,
      request: createConfinedRequest(sourceRoot, dependencyRoot, documentPath),
    });

    expect(compilerCount).toBe(2);
    expect(manifest).toMatchObject({
      executionPlanAuditPasses: 2,
      predecessorVersion: 2,
      replayPolicy: { predecessorVersion: 3, version: 4 },
      version: 3,
    });
    expect(manifest.routes.map((route) => route.id)).toEqual(['route']);
    expect(JSON.parse(await readFile(evidencePath, 'utf8'))).toEqual(manifest);
  });

  it('leaves no evidence when independent inventory passes differ', async () => {
    const directory = await mkdtemp(path.join(tmpdir(), 'preview-inventory-drift-test-'));
    temporaryDirectories.push(directory);
    const sourceRoot = path.join(directory, 'source');
    const dependencyRoot = path.join(directory, 'installed', 'node_modules');
    const documentPath = path.join(sourceRoot, 'App.tsx');
    const evidencePath = path.join(directory, 'evidence', 'inventory.json');
    await mkdir(sourceRoot, { recursive: true });
    await mkdir(dependencyRoot, { recursive: true });
    await writeFile(documentPath, 'export default function App() {}');
    let pass = 0;

    await expect(
      freezePreviewSnapshotInventoryLineage({
        createCompiler: () => {
          const inventory = createInventory(documentPath, pass === 0 ? 'first' : 'second');
          pass += 1;
          return {
            collectCompleteRouteInventory: () => Promise.resolve(inventory),
            shutdown: () => Promise.resolve(),
          };
        },
        evidencePath,
        request: createConfinedRequest(sourceRoot, dependencyRoot, documentPath),
      }),
    ).rejects.toThrow('do not match');
    await expect(lstat(evidencePath)).rejects.toMatchObject({ code: 'ENOENT' });
  });
});

interface GitFixture {
  readonly commit: string;
  readonly directory: string;
  readonly repository: string;
  readonly tree: string;
}

/** Creates one committed repository whose tracked and excluded files exercise snapshot policy. */
async function createGitFixture(): Promise<GitFixture> {
  const directory = await mkdtemp(path.join(tmpdir(), 'preview-snapshot-test-'));
  temporaryDirectories.push(directory);
  const repository = path.join(directory, 'repository');
  await mkdir(path.join(repository, 'src'), { recursive: true });
  await mkdir(path.join(repository, 'zuzu', 'client'), { recursive: true });
  await writeFile(path.join(repository, 'package.json'), '{"private":true}');
  await writeFile(path.join(repository, 'yarn.lock'), '# lock');
  await writeFile(path.join(repository, 'src', 'App.tsx'), 'export default function App() {}');
  await writeFile(
    path.join(repository, 'zuzu', 'client', 'package.json'),
    '{"name":"@zuzu/client"}',
  );
  await writeFile(path.join(repository, '.env.production'), 'SECRET=test');
  await symlink('src/App.tsx', path.join(repository, 'unsafe-link'));
  await run('git', ['init', '-q', repository]);
  await run('git', ['-C', repository, 'config', 'user.email', 'snapshot@example.invalid']);
  await run('git', ['-C', repository, 'config', 'user.name', 'Snapshot Test']);
  await run('git', ['-C', repository, 'add', '.']);
  await run('git', ['-C', repository, 'commit', '-qm', 'fixture']);
  const commit = (await run('git', ['-C', repository, 'rev-parse', 'HEAD'])).stdout.trim();
  const tree = (await run('git', ['-C', repository, 'rev-parse', 'HEAD^{tree}'])).stdout.trim();
  return { commit, directory, repository, tree };
}

/** Materializes the fixture's approved tracked source snapshot. */
async function createSnapshot(
  fixture: GitFixture,
  destinationPath: string,
): ReturnType<typeof createPreviewTrackedSourceSnapshot> {
  return createPreviewTrackedSourceSnapshot({
    allowlist: ['package.json', 'src', 'yarn.lock', 'zuzu/client/package.json'],
    commit: fixture.commit,
    destinationPath,
    repositoryPath: fixture.repository,
    tree: fixture.tree,
  });
}

/** Creates the immutable dependency tree consumed by snapshot tests. */
async function createDependencyRoot(dependencyRoot: string): Promise<void> {
  await mkdir(path.join(dependencyRoot, 'react'), { recursive: true });
  await mkdir(path.join(dependencyRoot, '.bin'), { recursive: true });
  await mkdir(path.join(dependencyRoot, '.cache'), { recursive: true });
  await writeFile(path.join(dependencyRoot, 'react', 'package.json'), '{"name":"react"}');
  await writeFile(path.join(dependencyRoot, '.yarn-integrity'), '{"flags":[]}');
}

/** Restores permissions recursively so afterEach can remove read-only fixture trees. */
async function makeWritable(candidatePath: string): Promise<void> {
  let metadata;
  try {
    metadata = await lstat(candidatePath);
  } catch {
    return;
  }
  if (metadata.isSymbolicLink()) return;
  if (metadata.isDirectory()) {
    await chmod(candidatePath, 0o755);
    for (const entry of await readdir(candidatePath)) {
      await makeWritable(path.join(candidatePath, entry));
    }
  } else {
    await chmod(candidatePath, 0o644);
  }
}

/** Builds one explicitly confined Page Inspector request for lineage collection. */
function createConfinedRequest(
  sourceRoot: string,
  dependencyRoot: string,
  documentPath: string,
): PreviewBuildRequest {
  return Object.freeze({
    dependencySnapshots: Object.freeze([]),
    documentPath,
    language: 'tsx' as const,
    preparationMode: 'fast' as const,
    renderMode: 'page-inspector' as const,
    resolutionConfinement: Object.freeze({
      approvedDependencyRoots: Object.freeze([dependencyRoot]),
      dependencyViewDigest: 'b'.repeat(64),
      policyDigest: 'c'.repeat(64),
      sourceManifestDigest: 'a'.repeat(64),
      sourceRoot,
    }),
    sourceText: 'export default function App() {}',
    workspaceRoot: sourceRoot,
  });
}

/** Builds one complete exact-replay inventory used by lineage equality tests. */
function createInventory(
  documentPath: string,
  routeId: string,
): PreviewInspectorCompleteRouteInventory {
  const selection = Object.freeze([
    Object.freeze({ componentName: 'App', pattern: `/${routeId}` }),
  ]);
  const owner = Object.freeze({ exportName: 'default', sourcePath: documentPath });
  const entry = Object.freeze({
    componentName: 'App',
    disposition: 'runnable' as const,
    exportName: 'default',
    id: routeId,
    executionPlan: createPreviewRouteExecutionPlanFixture({
      componentName: 'App',
      exportName: 'default',
      pathname: `/${routeId}`,
      pattern: `/${routeId}`,
      routeId,
      selection,
      sourcePath: documentPath,
    }),
    owner,
    parameters: Object.freeze({}),
    pathname: `/${routeId}`,
    pattern: `/${routeId}`,
    replay: Object.freeze({
      branchId: routeId,
      componentName: 'App',
      executionRoot: Object.freeze({ ...owner, basePattern: '/' }),
      exportName: 'default',
      owner,
      ownerChain: Object.freeze([Object.freeze({ ...owner, basePattern: '/' })]),
      parameters: Object.freeze({}),
      pathname: `/${routeId}`,
      pattern: `/${routeId}`,
      policyDigest: PREVIEW_COMPLETE_ROUTE_REPLAY_POLICY_DIGEST,
      routeSelectionResolution: 'exact' as const,
      runtimeTarget: owner,
      selection,
      sourcePath: documentPath,
      version: 1 as const,
    }),
    selection,
    sourcePath: documentPath,
  });
  return Object.freeze({
    analysisPasses: 1,
    complete: true,
    counts: Object.freeze({ duplicate: 0, runnable: 1, total: 1, unresolved: 0 }),
    dependencyPaths: Object.freeze([documentPath]),
    entries: Object.freeze([entry]),
    limits: Object.freeze({
      maximumAnalysisPasses: 4_096,
      maximumBranches: 8_192,
      maximumDepth: 64,
    }),
    owner,
    predecessorVersion: 3 as const,
    replayPasses: 1,
    replayPolicy: Object.freeze({
      digest: PREVIEW_COMPLETE_ROUTE_REPLAY_POLICY_DIGEST,
      predecessorVersion: 3 as const,
      version: 4 as const,
    }),
    truncated: false,
    version: 4 as const,
  });
}
