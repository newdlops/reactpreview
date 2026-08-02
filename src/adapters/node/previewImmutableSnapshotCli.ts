/** Command-line orchestration for atomic tracked-source and dependency-view preparation. */
import { chmod, lstat, readdir, rm } from 'node:fs/promises';
import path from 'node:path';
import { createPreviewDependencyView, verifyPreviewDependencyView } from './previewDependencyView';
import {
  createPreviewTrackedSourceSnapshot,
  verifyPreviewTrackedSourceSnapshot,
} from './previewTrackedSourceSnapshot';

interface PreviewImmutableSnapshotArguments {
  readonly allowlist: readonly string[];
  readonly commit: string;
  readonly dependencyRoots: readonly string[];
  readonly destination: string;
  readonly repository: string;
  readonly tree: string;
  readonly workspacePackageName: string;
  readonly workspacePackagePath: string;
}

/** Creates one task-owned snapshot root and prints its immutable identity fields. */
export async function runPreviewImmutableSnapshotCli(
  arguments_: readonly string[],
): Promise<number> {
  const values = parsePreviewImmutableSnapshotArguments(arguments_);
  const destination = path.resolve(values.destination);
  await assertDestinationMissing(destination);
  try {
    const sourceManifest = await createPreviewTrackedSourceSnapshot({
      allowlist: values.allowlist,
      commit: values.commit,
      destinationPath: destination,
      repositoryPath: path.resolve(values.repository),
      tree: values.tree,
    });
    const dependencyManifest = await createPreviewDependencyView({
      approvedDependencyRoots: values.dependencyRoots.map((root) => path.resolve(root)),
      snapshotPath: destination,
      sourceManifest,
      workspacePackageName: values.workspacePackageName,
      workspacePackagePath: values.workspacePackagePath,
    });
    await verifyPreviewTrackedSourceSnapshot(destination);
    await verifyPreviewDependencyView(destination);
    process.stdout.write(
      `${JSON.stringify({
        approvedDependencyRoots: dependencyManifest.approvedDependencyRoots,
        dependencyViewDigest: dependencyManifest.dependencyViewDigest,
        policyDigest: dependencyManifest.policyDigest,
        snapshotPath: destination,
        sourceManifestDigest: sourceManifest.manifestDigest,
      })}\n`,
    );
    return 0;
  } catch (error) {
    await makeWritableForCleanup(destination).catch(() => undefined);
    await rm(destination, { force: true, recursive: true });
    throw error;
  }
}

export function parsePreviewImmutableSnapshotArguments(
  arguments_: readonly string[],
): PreviewImmutableSnapshotArguments {
  const values = new Map<string, string>();
  const allowlist: string[] = [];
  const dependencyRoots: string[] = [];
  for (let index = 0; index < arguments_.length; index += 2) {
    const name = arguments_[index];
    const value = arguments_[index + 1];
    if (name === undefined || !name.startsWith('--') || value === undefined) {
      throw new Error(`Invalid immutable snapshot argument near ${name ?? '<missing>'}.`);
    }
    if (name === '--allow') allowlist.push(value);
    else if (name === '--dependency-root') dependencyRoots.push(value);
    else {
      if (
        ![
          '--commit',
          '--destination',
          '--repository',
          '--tree',
          '--workspace-package-name',
          '--workspace-package-path',
        ].includes(name)
      ) {
        throw new Error(`Unknown immutable snapshot argument: ${name}`);
      }
      if (values.has(name)) throw new Error(`Duplicate immutable snapshot argument: ${name}`);
      values.set(name, value);
    }
  }
  for (const required of [
    '--commit',
    '--destination',
    '--repository',
    '--tree',
    '--workspace-package-name',
    '--workspace-package-path',
  ]) {
    if (!values.has(required)) throw new Error(`Missing immutable snapshot argument: ${required}`);
  }
  if (allowlist.length === 0 || dependencyRoots.length === 0) {
    throw new Error('Immutable snapshot requires explicit allowlist and dependency roots.');
  }
  return Object.freeze({
    allowlist: Object.freeze([...allowlist]),
    commit: values.get('--commit') ?? '',
    dependencyRoots: Object.freeze([...dependencyRoots]),
    destination: values.get('--destination') ?? '',
    repository: values.get('--repository') ?? '',
    tree: values.get('--tree') ?? '',
    workspacePackageName: values.get('--workspace-package-name') ?? '',
    workspacePackagePath: values.get('--workspace-package-path') ?? '',
  });
}

async function assertDestinationMissing(destination: string): Promise<void> {
  try {
    await lstat(destination);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return;
    throw error;
  }
  throw new Error('Immutable snapshot destination already exists.');
}

async function makeWritableForCleanup(candidatePath: string): Promise<void> {
  let metadata;
  try {
    metadata = await lstat(candidatePath);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return;
    throw error;
  }
  if (metadata.isSymbolicLink()) return;
  if (metadata.isDirectory()) {
    await chmod(candidatePath, 0o700);
    for (const entry of await readdir(candidatePath)) {
      await makeWritableForCleanup(path.join(candidatePath, entry));
    }
  } else if (metadata.isFile()) {
    await chmod(candidatePath, 0o600);
  }
}
