/** Creates and verifies deterministic tracked-only Git source snapshots. */
import { createHash, randomUUID } from 'node:crypto';
import { execFile } from 'node:child_process';
import { chmod, mkdir, readFile, readdir, rename, rm, stat, writeFile } from 'node:fs/promises';
import path from 'node:path';

const MAX_GIT_OUTPUT_BYTES = 512 * 1_024 * 1_024;
const FORBIDDEN_SEGMENTS = new Set([
  '.cache',
  '.git',
  '.next',
  '.parcel-cache',
  '.turbo',
  '.vite',
  'build',
  'coverage',
  'dist',
  'node_modules',
  'out',
]);
const SENSITIVE_FILE_PATTERN =
  /(?:^|\/)(?:\.env(?:\..*)?|.*\.(?:key|pem|p12|pfx)|id_(?:dsa|ecdsa|ed25519|rsa)(?:\.pub)?)$/iu;

export interface PreviewTrackedSourceSnapshotFile {
  readonly blobId: string;
  readonly mode: string;
  readonly path: string;
  readonly sha256: string;
  readonly size: number;
}

export interface PreviewTrackedSourceSnapshotManifest {
  readonly allowlist: readonly string[];
  readonly archiveEntries: readonly string[];
  readonly archiveSha256: string;
  readonly commit: string;
  readonly files: readonly PreviewTrackedSourceSnapshotFile[];
  readonly kind: 'react-preview-tracked-source-snapshot';
  readonly manifestDigest: string;
  readonly tree: string;
  readonly version: 1;
}

export interface CreatePreviewTrackedSourceSnapshotOptions {
  readonly allowlist: readonly string[];
  readonly commit: string;
  readonly destinationPath: string;
  readonly repositoryPath: string;
  readonly tree: string;
}

/** Archives an explicit tracked allowlist, verifies it, and atomically accepts a new source root. */
export async function createPreviewTrackedSourceSnapshot(
  options: CreatePreviewTrackedSourceSnapshotOptions,
): Promise<PreviewTrackedSourceSnapshotManifest> {
  const allowlist = normalizePreviewSnapshotAllowlist(options.allowlist);
  const destinationPath = path.resolve(options.destinationPath);
  await assertPathMissing(destinationPath, 'Snapshot destination already exists.');
  const repositoryPath = path.resolve(options.repositoryPath);
  const actualCommit = (
    await runText('git', ['-C', repositoryPath, 'rev-parse', `${options.commit}^{commit}`])
  ).trim();
  const actualTree = (
    await runText('git', ['-C', repositoryPath, 'rev-parse', `${actualCommit}^{tree}`])
  ).trim();
  if (actualCommit !== options.commit || actualTree !== options.tree) {
    throw new Error('Snapshot commit or tree identity does not match the requested lineage.');
  }
  const tracked = parseTrackedFiles(
    await runBuffer('git', [
      '-C',
      repositoryPath,
      'ls-tree',
      '-r',
      '-z',
      actualCommit,
      '--',
      ...allowlist,
    ]),
  );
  if (tracked.length === 0) throw new Error('Snapshot allowlist selected no tracked files.');
  for (const entry of allowlist) {
    if (!tracked.some((file) => file.path === entry || file.path.startsWith(`${entry}/`))) {
      throw new Error(`Snapshot allowlist entry selected no tracked files: ${entry}`);
    }
  }
  assertPreviewSnapshotTrackedFiles(tracked);

  const parentPath = path.dirname(destinationPath);
  await mkdir(parentPath, { recursive: true, mode: 0o700 });
  const stagingPath = `${destinationPath}.staging-${randomUUID()}`;
  const sourcePath = path.join(stagingPath, 'source');
  const manifestDirectory = path.join(stagingPath, 'manifests');
  const archivePath = path.join(stagingPath, 'source.tar');
  try {
    await mkdir(sourcePath, { recursive: true, mode: 0o700 });
    await mkdir(manifestDirectory, { recursive: true, mode: 0o700 });
    const archive = await runBuffer('git', [
      '-C',
      repositoryPath,
      'archive',
      '--format=tar',
      actualCommit,
      '--',
      ...allowlist,
    ]);
    await writeFile(archivePath, archive, { mode: 0o600 });
    const archiveEntries = normalizeArchiveEntries(
      (await runText('tar', ['-tf', archivePath])).split(/\r?\n/u),
    );
    const trackedPaths = tracked.map((file) => file.path);
    if (stableJson(archiveEntries) !== stableJson(trackedPaths)) {
      throw new Error('Git archive entries do not agree with the tracked file manifest.');
    }
    await runText('tar', [
      '-xf',
      archivePath,
      '-C',
      sourcePath,
      '--no-same-owner',
      '--no-same-permissions',
    ]);
    const files = await verifyExtractedFiles(sourcePath, tracked);
    const unsignedManifest = {
      allowlist,
      archiveEntries,
      archiveSha256: sha256(archive),
      commit: actualCommit,
      files,
      kind: 'react-preview-tracked-source-snapshot' as const,
      tree: actualTree,
      version: 1 as const,
    };
    const manifest = Object.freeze({
      ...unsignedManifest,
      manifestDigest: digestJson(unsignedManifest),
    });
    await writeFile(
      path.join(manifestDirectory, 'source-manifest.json'),
      `${JSON.stringify(manifest, undefined, 2)}\n`,
      { mode: 0o600 },
    );
    for (const file of files) await chmod(path.join(sourcePath, file.path), 0o444);
    await rename(stagingPath, destinationPath);
    return manifest;
  } catch (error) {
    await rm(stagingPath, { force: true, recursive: true });
    throw error;
  }
}

/** Rehashes accepted tracked files and rejects any later source or manifest drift. */
export async function verifyPreviewTrackedSourceSnapshot(
  snapshotPath: string,
): Promise<PreviewTrackedSourceSnapshotManifest> {
  const manifestPath = path.join(snapshotPath, 'manifests', 'source-manifest.json');
  const parsed = JSON.parse(
    await readFile(manifestPath, 'utf8'),
  ) as PreviewTrackedSourceSnapshotManifest;
  const { manifestDigest: _digest, ...unsigned } = parsed;
  if (
    parsed.kind !== 'react-preview-tracked-source-snapshot' ||
    parsed.version !== 1 ||
    digestJson(unsigned) !== parsed.manifestDigest
  ) {
    throw new Error('Source snapshot manifest identity is invalid.');
  }
  const sourcePath = path.join(snapshotPath, 'source');
  const actualPaths = await collectRegularFilePaths(sourcePath);
  if (stableJson(actualPaths) !== stableJson(parsed.files.map((file) => file.path))) {
    throw new Error('Accepted source paths differ from the tracked snapshot manifest.');
  }
  await verifyExtractedFiles(sourcePath, parsed.files);
  const archive = await readFile(path.join(snapshotPath, 'source.tar'));
  if (sha256(archive) !== parsed.archiveSha256) {
    throw new Error('Accepted source archive hash has changed.');
  }
  return parsed;
}

/** Validates and freezes literal, repository-relative allowlist entries. */
export function normalizePreviewSnapshotAllowlist(allowlist: readonly string[]): readonly string[] {
  const normalized = allowlist.map((entry) => normalizeSafeRelativePath(entry, true));
  if (normalized.length === 0 || new Set(normalized).size !== normalized.length) {
    throw new Error('Snapshot allowlist must be non-empty and unique.');
  }
  return Object.freeze([...normalized].sort());
}

/** Rejects links, submodules, sensitive files, generated output, and unsafe path spellings. */
export function assertPreviewSnapshotTrackedFiles(
  files: readonly Pick<PreviewTrackedSourceSnapshotFile, 'blobId' | 'mode' | 'path'>[],
): void {
  for (const file of files) {
    normalizeSafeRelativePath(file.path, false);
    if (file.mode !== '100644' && file.mode !== '100755') {
      throw new Error(`Snapshot file mode is not a regular tracked file: ${file.path}`);
    }
    if (!/^[\da-f]{40}(?:[\da-f]{24})?$/u.test(file.blobId)) {
      throw new Error(`Snapshot blob identity is invalid: ${file.path}`);
    }
  }
}

function normalizeSafeRelativePath(candidate: string, allowDirectory: boolean): string {
  if (
    candidate.length === 0 ||
    path.posix.isAbsolute(candidate) ||
    candidate.includes('\\') ||
    /[\u0000-\u001f\u007f]/u.test(candidate) ||
    candidate.startsWith(':')
  ) {
    throw new Error('Snapshot paths must be safe literal repository-relative paths.');
  }
  const normalized = path.posix.normalize(candidate).replace(/\/+$/u, '');
  if (
    normalized.length === 0 ||
    normalized === '.' ||
    normalized === '..' ||
    normalized.startsWith('../') ||
    (!allowDirectory && normalized.endsWith('/'))
  ) {
    throw new Error('Snapshot path traversal is forbidden.');
  }
  const segments = normalized.split('/');
  if (segments.some((segment) => FORBIDDEN_SEGMENTS.has(segment))) {
    throw new Error(`Snapshot path selects generated or cached content: ${normalized}`);
  }
  if (SENSITIVE_FILE_PATTERN.test(normalized)) {
    throw new Error(`Snapshot path selects sensitive content: ${normalized}`);
  }
  return normalized;
}

function parseTrackedFiles(output: Buffer): PreviewTrackedSourceSnapshotFile[] {
  return output
    .toString('utf8')
    .split('\0')
    .filter(Boolean)
    .map((record) => {
      const match = /^(?<mode>\d{6}) blob (?<blobId>[\da-f]+)\t(?<path>.+)$/u.exec(record);
      if (match?.groups === undefined) throw new Error('Git returned a non-blob snapshot entry.');
      return {
        blobId: match.groups.blobId ?? '',
        mode: match.groups.mode ?? '',
        path: match.groups.path ?? '',
        sha256: '',
        size: 0,
      };
    })
    .sort((left, right) => compareText(left.path, right.path));
}

function normalizeArchiveEntries(entries: readonly string[]): readonly string[] {
  const normalized = entries
    .filter((entry) => entry.length > 0 && !entry.endsWith('/'))
    .map((entry) => normalizeSafeRelativePath(entry, false))
    .sort();
  if (new Set(normalized).size !== normalized.length) {
    throw new Error('Git archive contains duplicate file entries.');
  }
  return Object.freeze(normalized);
}

async function verifyExtractedFiles(
  sourcePath: string,
  expectedFiles: readonly PreviewTrackedSourceSnapshotFile[],
): Promise<readonly PreviewTrackedSourceSnapshotFile[]> {
  const verified: PreviewTrackedSourceSnapshotFile[] = [];
  for (const expected of expectedFiles) {
    const filePath = path.join(sourcePath, expected.path);
    const metadata = await stat(filePath);
    if (!metadata.isFile())
      throw new Error(`Extracted snapshot entry is not a file: ${expected.path}`);
    const contents = await readFile(filePath);
    const blobAlgorithm = expected.blobId.length === 64 ? 'sha256' : 'sha1';
    const blobId = createHash(blobAlgorithm)
      .update(`blob ${contents.byteLength.toString()}\0`)
      .update(contents)
      .digest('hex');
    if (blobId !== expected.blobId) {
      throw new Error(`Extracted snapshot blob does not match Git: ${expected.path}`);
    }
    const file = Object.freeze({
      blobId,
      mode: expected.mode,
      path: expected.path,
      sha256: sha256(contents),
      size: contents.byteLength,
    });
    if (
      expected.sha256.length > 0 &&
      (expected.sha256 !== file.sha256 || expected.size !== file.size)
    ) {
      throw new Error(`Extracted snapshot content hash has changed: ${expected.path}`);
    }
    verified.push(file);
  }
  return Object.freeze(verified);
}

async function collectRegularFilePaths(rootPath: string): Promise<readonly string[]> {
  const files: string[] = [];
  const visit = async (directoryPath: string): Promise<void> => {
    for (const entry of await readdir(directoryPath, { withFileTypes: true })) {
      if (directoryPath === rootPath && entry.name === 'node_modules') continue;
      const absolutePath = path.join(directoryPath, entry.name);
      if (entry.isSymbolicLink())
        throw new Error('Tracked source contains an unexpected symbolic link.');
      if (entry.isDirectory()) await visit(absolutePath);
      else if (entry.isFile())
        files.push(path.relative(rootPath, absolutePath).split(path.sep).join('/'));
      else throw new Error('Tracked source contains an unsupported filesystem entry.');
    }
  };
  await visit(rootPath);
  return Object.freeze(files.sort());
}

async function assertPathMissing(candidatePath: string, message: string): Promise<void> {
  try {
    await stat(candidatePath);
    throw new Error(message);
  } catch (error) {
    if (
      error instanceof Error &&
      'code' in error &&
      (error as NodeJS.ErrnoException).code === 'ENOENT'
    )
      return;
    throw error;
  }
}

function runBuffer(command: string, arguments_: readonly string[]): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    execFile(
      command,
      [...arguments_],
      { encoding: 'buffer', maxBuffer: MAX_GIT_OUTPUT_BYTES },
      (error, stdout) => {
        if (error !== null) reject(error);
        else resolve(Buffer.isBuffer(stdout) ? stdout : Buffer.from(stdout));
      },
    );
  });
}

async function runText(command: string, arguments_: readonly string[]): Promise<string> {
  return (await runBuffer(command, arguments_)).toString('utf8');
}

export function digestPreviewManifest(value: unknown): string {
  return digestJson(value);
}

function digestJson(value: unknown): string {
  return sha256(Buffer.from(stableJson(value)));
}

function stableJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableJson).join(',')}]`;
  if (value !== null && typeof value === 'object') {
    return `{${Object.entries(value as Record<string, unknown>)
      .filter(([, item]) => item !== undefined)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, item]) => `${JSON.stringify(key)}:${stableJson(item)}`)
      .join(',')}}`;
  }
  return JSON.stringify(value);
}

function sha256(value: Buffer): string {
  return createHash('sha256').update(value).digest('hex');
}

function compareText(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}
