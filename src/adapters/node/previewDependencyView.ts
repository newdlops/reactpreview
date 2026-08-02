/** Builds a read-only, link-only dependency view for an immutable tracked source snapshot. */
import { createHash } from 'node:crypto';
import {
  chmod,
  lstat,
  mkdir,
  readFile,
  readdir,
  realpath,
  rm,
  symlink,
  writeFile,
} from 'node:fs/promises';
import path from 'node:path';
import {
  digestPreviewManifest,
  type PreviewTrackedSourceSnapshotManifest,
} from './previewTrackedSourceSnapshot';

const OMITTED_DEPENDENCY_NAMES = new Set(['.bin', '.cache', '.vite']);

export interface PreviewDependencyViewLink {
  readonly packageManifestSha256?: string;
  readonly packageName: string;
  readonly realPath: string;
  readonly targetKind: 'approved-dependency' | 'snapshot-workspace';
}

export interface PreviewDependencyViewManifest {
  readonly approvedDependencyRoots: readonly string[];
  readonly dependencyViewDigest: string;
  readonly installIntegrity: readonly {
    readonly path: string;
    readonly sha256: string;
  }[];
  readonly kind: 'react-preview-dependency-view';
  readonly links: readonly PreviewDependencyViewLink[];
  readonly lockfileSha256: string;
  readonly packageManifestSha256: string;
  readonly policyDigest: string;
  readonly sourceManifestDigest: string;
  readonly version: 1;
  readonly workspacePackageManifestSha256: string;
}

export interface CreatePreviewDependencyViewOptions {
  readonly approvedDependencyRoots: readonly string[];
  readonly snapshotPath: string;
  readonly sourceManifest: PreviewTrackedSourceSnapshotManifest;
  readonly workspacePackageName: string;
  readonly workspacePackagePath: string;
}

/** Links approved installed packages and remaps the workspace package into tracked snapshot source. */
export async function createPreviewDependencyView(
  options: CreatePreviewDependencyViewOptions,
): Promise<PreviewDependencyViewManifest> {
  const snapshotPath = path.resolve(options.snapshotPath);
  const sourceRoot = await realpath(path.join(snapshotPath, 'source'));
  const nodeModulesPath = path.join(sourceRoot, 'node_modules');
  await assertMissing(nodeModulesPath, 'Snapshot dependency view already exists.');
  const approvedDependencyRoots = Object.freeze(
    [
      ...new Set(await Promise.all(options.approvedDependencyRoots.map((root) => realpath(root)))),
    ].sort(),
  );
  if (approvedDependencyRoots.length === 0) {
    throw new Error('At least one approved installed dependency root is required.');
  }
  const workspacePackagePath = await realpath(
    path.join(sourceRoot, normalizeWorkspacePackagePath(options.workspacePackagePath)),
  );
  if (!isPathInsideOrEqual(sourceRoot, workspacePackagePath)) {
    throw new Error('Workspace package mapping escaped the tracked snapshot source.');
  }
  const packageManifestPath = path.join(sourceRoot, 'package.json');
  const lockfilePath = path.join(sourceRoot, 'yarn.lock');
  const workspaceManifestPath = path.join(workspacePackagePath, 'package.json');
  const packageManifestSha256 = await hashFile(packageManifestPath);
  const lockfileSha256 = await hashFile(lockfilePath);
  const workspacePackageManifestSha256 = await hashFile(workspaceManifestPath);
  const linksByName = new Map<string, PreviewDependencyViewLink>();
  try {
    await mkdir(nodeModulesPath, { recursive: false, mode: 0o700 });
    for (const dependencyRoot of approvedDependencyRoots) {
      await collectDependencyRootLinks(dependencyRoot, linksByName);
    }
    linksByName.set(
      options.workspacePackageName,
      Object.freeze({
        packageManifestSha256: workspacePackageManifestSha256,
        packageName: options.workspacePackageName,
        realPath: workspacePackagePath,
        targetKind: 'snapshot-workspace' as const,
      }),
    );
    const links = Object.freeze(
      [...linksByName.values()].sort((left, right) =>
        left.packageName.localeCompare(right.packageName),
      ),
    );
    for (const link of links) {
      const linkPath = path.join(nodeModulesPath, ...link.packageName.split('/'));
      await mkdir(path.dirname(linkPath), { recursive: true, mode: 0o700 });
      await symlink(link.realPath, linkPath, 'junction');
    }
    const installIntegrity = Object.freeze(
      (
        await Promise.all(
          approvedDependencyRoots.map(async (root) => {
            const integrityPath = path.join(root, '.yarn-integrity');
            return {
              path: integrityPath,
              sha256: await hashFile(integrityPath),
            };
          }),
        )
      ).sort((left, right) => left.path.localeCompare(right.path)),
    );
    const unsignedManifest = {
      approvedDependencyRoots,
      installIntegrity,
      kind: 'react-preview-dependency-view' as const,
      links,
      lockfileSha256,
      packageManifestSha256,
      policyDigest: createDependencyPolicyDigest(),
      sourceManifestDigest: options.sourceManifest.manifestDigest,
      version: 1 as const,
      workspacePackageManifestSha256,
    };
    const manifest = Object.freeze({
      ...unsignedManifest,
      dependencyViewDigest: digestPreviewManifest(unsignedManifest),
    });
    await writeFile(
      path.join(snapshotPath, 'manifests', 'dependency-view-manifest.json'),
      `${JSON.stringify(manifest, undefined, 2)}\n`,
      { mode: 0o600 },
    );
    await makeSnapshotReadOnly(snapshotPath);
    return manifest;
  } catch (error) {
    await rm(nodeModulesPath, { force: true, recursive: true });
    throw error;
  }
}

/** Revalidates every link, manifest, lockfile, and installed-root integrity marker. */
export async function verifyPreviewDependencyView(
  snapshotPath: string,
): Promise<PreviewDependencyViewManifest> {
  const resolvedSnapshotPath = path.resolve(snapshotPath);
  const manifestPath = path.join(
    resolvedSnapshotPath,
    'manifests',
    'dependency-view-manifest.json',
  );
  const parsed = JSON.parse(await readFile(manifestPath, 'utf8')) as PreviewDependencyViewManifest;
  const { dependencyViewDigest: _digest, ...unsigned } = parsed;
  if (
    parsed.kind !== 'react-preview-dependency-view' ||
    parsed.version !== 1 ||
    parsed.policyDigest !== createDependencyPolicyDigest() ||
    digestPreviewManifest(unsigned) !== parsed.dependencyViewDigest
  ) {
    throw new Error('Dependency view manifest identity is invalid.');
  }
  const sourceManifest = JSON.parse(
    await readFile(path.join(resolvedSnapshotPath, 'manifests', 'source-manifest.json'), 'utf8'),
  ) as PreviewTrackedSourceSnapshotManifest;
  if (sourceManifest.manifestDigest !== parsed.sourceManifestDigest) {
    throw new Error('Dependency view is not bound to the accepted source manifest.');
  }
  if (
    parsed.approvedDependencyRoots.length === 0 ||
    new Set(parsed.approvedDependencyRoots).size !== parsed.approvedDependencyRoots.length
  ) {
    throw new Error('Dependency view approved roots are invalid.');
  }
  for (const root of parsed.approvedDependencyRoots) {
    if ((await realpath(root)) !== root) {
      throw new Error('Dependency view approved root identity changed.');
    }
  }
  const sourceRoot = path.join(resolvedSnapshotPath, 'source');
  const canonicalSourceRoot = await realpath(sourceRoot);
  if (
    (await hashFile(path.join(sourceRoot, 'package.json'))) !== parsed.packageManifestSha256 ||
    (await hashFile(path.join(sourceRoot, 'yarn.lock'))) !== parsed.lockfileSha256
  ) {
    throw new Error('Snapshot package manifest or lockfile changed.');
  }
  const expectedNames = new Set(parsed.links.map((link) => link.packageName));
  const actualNames = await collectDependencyViewNames(path.join(sourceRoot, 'node_modules'));
  if (
    expectedNames.size !== actualNames.size ||
    [...expectedNames].some((name) => !actualNames.has(name))
  ) {
    throw new Error('Dependency view links differ from the manifest.');
  }
  for (const link of parsed.links) {
    const linkPath = path.join(sourceRoot, 'node_modules', ...link.packageName.split('/'));
    const metadata = await lstat(linkPath);
    if (!metadata.isSymbolicLink() || (await realpath(linkPath)) !== link.realPath) {
      throw new Error(`Dependency view link changed: ${link.packageName}`);
    }
    if (
      link.targetKind === 'approved-dependency' &&
      !parsed.approvedDependencyRoots.some((root) => isPathInsideOrEqual(root, link.realPath))
    ) {
      throw new Error(`Dependency link escaped approved roots: ${link.packageName}`);
    }
    if (
      link.targetKind === 'snapshot-workspace' &&
      !isPathInsideOrEqual(canonicalSourceRoot, link.realPath)
    ) {
      throw new Error(`Workspace link escaped snapshot source: ${link.packageName}`);
    }
    if (
      link.packageManifestSha256 !== undefined &&
      (await hashFile(path.join(link.realPath, 'package.json'))) !== link.packageManifestSha256
    ) {
      throw new Error(`Dependency package manifest changed: ${link.packageName}`);
    }
  }
  for (const integrity of parsed.installIntegrity) {
    if ((await hashFile(integrity.path)) !== integrity.sha256) {
      throw new Error('Installed dependency integrity marker changed.');
    }
  }
  return parsed;
}

async function collectDependencyRootLinks(
  dependencyRoot: string,
  linksByName: Map<string, PreviewDependencyViewLink>,
): Promise<void> {
  for (const entry of await readdir(dependencyRoot, { withFileTypes: true })) {
    if (entry.name.startsWith('.') || OMITTED_DEPENDENCY_NAMES.has(entry.name)) continue;
    if (entry.name.startsWith('@')) {
      const scopePath = path.join(dependencyRoot, entry.name);
      for (const child of await readdir(scopePath, { withFileTypes: true })) {
        await admitDependencyPackage(
          `${entry.name}/${child.name}`,
          path.join(scopePath, child.name),
          dependencyRoot,
          linksByName,
        );
      }
    } else {
      await admitDependencyPackage(
        entry.name,
        path.join(dependencyRoot, entry.name),
        dependencyRoot,
        linksByName,
      );
    }
  }
}

async function admitDependencyPackage(
  packageName: string,
  packagePath: string,
  approvedRoot: string,
  linksByName: Map<string, PreviewDependencyViewLink>,
): Promise<void> {
  if (packageName === '@zuzu/client') return;
  const metadata = await lstat(packagePath);
  if (!metadata.isDirectory() && !metadata.isSymbolicLink()) return;
  const realPath = await realpath(packagePath);
  if (!isPathInsideOrEqual(approvedRoot, realPath)) {
    throw new Error(`Installed package link escaped its approved root: ${packageName}`);
  }
  let packageManifestSha256: string | undefined;
  try {
    packageManifestSha256 = await hashFile(path.join(realPath, 'package.json'));
  } catch {
    return;
  }
  const link = Object.freeze({
    packageManifestSha256,
    packageName,
    realPath,
    targetKind: 'approved-dependency' as const,
  });
  const existing = linksByName.get(packageName);
  if (existing !== undefined && existing.realPath !== realPath) {
    throw new Error(`Approved dependency roots disagree for package: ${packageName}`);
  }
  linksByName.set(packageName, link);
}

async function collectDependencyViewNames(nodeModulesPath: string): Promise<Set<string>> {
  const names = new Set<string>();
  for (const entry of await readdir(nodeModulesPath, { withFileTypes: true })) {
    if (entry.name.startsWith('.'))
      throw new Error('Dependency view contains a cache or hidden entry.');
    if (entry.name.startsWith('@')) {
      if (!entry.isDirectory()) throw new Error('Dependency scope entry is not a directory.');
      for (const child of await readdir(path.join(nodeModulesPath, entry.name))) {
        names.add(`${entry.name}/${child}`);
      }
    } else {
      names.add(entry.name);
    }
  }
  return names;
}

async function makeSnapshotReadOnly(snapshotPath: string): Promise<void> {
  const visit = async (candidatePath: string): Promise<void> => {
    const metadata = await lstat(candidatePath);
    if (metadata.isSymbolicLink()) return;
    if (metadata.isDirectory()) {
      for (const entry of await readdir(candidatePath)) {
        await visit(path.join(candidatePath, entry));
      }
      await chmod(candidatePath, 0o555);
    } else if (metadata.isFile()) {
      await chmod(candidatePath, 0o444);
    } else {
      throw new Error('Snapshot contains an unsupported filesystem entry.');
    }
  };
  await visit(snapshotPath);
}

function normalizeWorkspacePackagePath(candidatePath: string): string {
  if (
    candidatePath.length === 0 ||
    path.isAbsolute(candidatePath) ||
    candidatePath.includes('\\') ||
    path.normalize(candidatePath).startsWith('..')
  ) {
    throw new Error('Workspace package path must stay inside snapshot source.');
  }
  return candidatePath;
}

async function assertMissing(candidatePath: string, message: string): Promise<void> {
  try {
    await lstat(candidatePath);
    throw new Error(message);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return;
    throw error;
  }
}

async function hashFile(filePath: string): Promise<string> {
  return createHash('sha256')
    .update(await readFile(filePath))
    .digest('hex');
}

function isPathInsideOrEqual(rootPath: string, candidatePath: string): boolean {
  const relativePath = path.relative(rootPath, candidatePath);
  return (
    relativePath.length === 0 ||
    (relativePath !== '..' &&
      !relativePath.startsWith(`..${path.sep}`) &&
      !path.isAbsolute(relativePath))
  );
}

function createDependencyPolicyDigest(): string {
  return digestPreviewManifest({
    dependencyRule: 'canonical-realpath-inside-approved-root',
    sourceRule: 'canonical-realpath-inside-tracked-snapshot',
    version: 1,
    workspaceRule: 'explicit-snapshot-package-link',
  });
}
