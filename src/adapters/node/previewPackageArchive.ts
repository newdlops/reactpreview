/**
 * Downloads and materializes lock-proven public package archives without knowing which lockfile
 * produced the plan. The adapter never invokes a package manager or package lifecycle script.
 */
import { createHash, timingSafeEqual } from 'node:crypto';
import type { Stats } from 'node:fs';
import { lstat, mkdir, readdir, rm } from 'node:fs/promises';
import path from 'node:path';
import { gunzip } from 'node:zlib';
import { extract as extractTar, list as listTar, type Parser, type ReadEntry } from 'tar';
import {
  verifyPreviewManagedPackages,
  verifyPreviewManagedPackageTree,
  type PreviewManagedPackageCopyResult,
  type PreviewManagedPackageIdentity,
} from './previewManagedDependencyAdmission';

const PUBLIC_REGISTRY_HOST = 'registry.npmjs.org';
const MAX_PACKAGE_COUNT = 1_024;
const MAX_PACKAGE_TARBALL_BYTES = 32 * 1024 * 1024;
const MAX_TOTAL_TARBALL_BYTES = 256 * 1024 * 1024;
const MAX_PACKAGE_EXTRACTED_BYTES = 64 * 1024 * 1024;
const MAX_CLOSURE_EXTRACTED_BYTES = 256 * 1024 * 1024;
const MAX_PACKAGE_UNCOMPRESSED_TAR_BYTES = 96 * 1024 * 1024;
const MAX_CLOSURE_UNCOMPRESSED_TAR_BYTES = 384 * 1024 * 1024;
const MAX_ARCHIVE_ENTRIES = 10_000;
const MAX_CLOSURE_ARCHIVE_ENTRIES = 40_000;
const MAX_ARCHIVE_META_ENTRIES = 256;
const MAX_ARCHIVE_META_BYTES = 1024 * 1024;
const MAX_ARCHIVE_META_ENTRY_BYTES = 64 * 1024;
const MAX_ARCHIVE_PATH_BYTES = 1024;
const MAX_ARCHIVE_SEGMENT_BYTES = 255;
const MAX_ARCHIVE_DEPTH = 128;
const MAX_DOWNLOAD_MILLISECONDS = 30_000;
const DOWNLOAD_CONCURRENCY = 4;
const PACKAGE_VERSION_PATTERN = /^\d+\.\d+\.\d+(?:[-+].+)?$/u;
const PACKAGE_NAME_PATTERN =
  /^(?:@[a-z0-9][a-z0-9._~-]*\/[a-z0-9][a-z0-9._~-]*|[a-z0-9][a-z0-9._~-]*)$/u;
const SENSITIVE_PACKAGE_FILE_PATTERN = /^(?:\.env(?:\..*)?|\.npmrc|\.yarnrc(?:\..*)?)$/iu;
const WINDOWS_RESERVED_NAME_PATTERN = /^(?:con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\..*)?$/iu;

/** One exact package archive selected by a separately verified lockfile planner. */
export interface PreviewVerifiedPackageArchivePlanEntry {
  /** Exact manifest identity expected after extraction. */
  readonly packageName: string;
  /** Exact installed version expected after extraction. */
  readonly packageVersion: string;
  /** Raw 64-byte SHA-512 digest over the compressed response body. */
  readonly sha512Digest: Uint8Array;
  /** Portable npm layout below the managed node_modules directory. */
  readonly targetRelativePath: string;
  /** Exact public registry tarball URL. */
  readonly url: string;
}

/** Inputs delivered to an injectable HTTPS tarball transport. */
export interface PreviewPackageArchiveTransportRequest {
  /** Per-response hard body limit. */
  readonly maximumBytes: number;
  /** Active acquisition cancellation. */
  readonly signal: AbortSignal;
  /** Exact URL already admitted by the archive plan validator. */
  readonly url: string;
}

/** Network boundary injectable by offline tests and alternative lockfile planners. */
export interface PreviewPackageArchiveTransport {
  /** Returns compressed response bytes without following redirects. */
  readonly download: (request: PreviewPackageArchiveTransportRequest) => Promise<Uint8Array>;
}

/** Inputs delivered to an injectable, integrity-verified archive extractor. */
export interface PreviewPackageArchiveExtractRequest {
  /** Bounded compressed bytes whose SHA-512 digest already matched. */
  readonly archive: Uint8Array;
  /** Exact expected manifest name. */
  readonly packageName: string;
  /** Exact expected manifest version. */
  readonly packageVersion: string;
  /** Active cancellation propagated through both tar passes. */
  readonly signal: AbortSignal;
  /** Fresh extension-owned package directory. */
  readonly targetPath: string;
}

/** Archive boundary injectable by tests without weakening post-extraction verification. */
export interface PreviewPackageArchiveExtractor {
  /** Materializes one package without evaluating package-owned code. */
  readonly extract: (request: PreviewPackageArchiveExtractRequest) => Promise<void>;
}

/** Inputs for lockfile-independent verified archive materialization. */
export interface MaterializePreviewPackageArchivesOptions {
  /** Collision-free exact package plan. */
  readonly entries: readonly PreviewVerifiedPackageArchivePlanEntry[];
  /** Optional deterministic extractor used by tests. */
  readonly extractor?: PreviewPackageArchiveExtractor;
  /** Optional active preview cancellation. */
  readonly signal?: AbortSignal;
  /** Fresh unpublished managed node_modules path. */
  readonly targetNodeModulesPath: string;
  /** Optional deterministic transport used by tests. */
  readonly transport?: PreviewPackageArchiveTransport;
}

/** State shared by one tar list or extraction pass. */
interface ArchiveValidationState {
  bytes: number;
  /** Optional closure budget is attached only to the preflight pass, never the extraction pass. */
  readonly closure: ArchiveClosureValidationState | undefined;
  entries: number;
  error: Error | undefined;
  metaBytes: number;
  metaEntries: number;
  owner: Parser | undefined;
  readonly paths: Map<string, 'directory' | 'file'>;
  /** Npm normally uses `package`, while DefinitelyTyped archives use the unscoped type name. */
  rootPrefix: string | undefined;
}

/** Shared preflight accounting that prevents many individually valid packages exhausting the host. */
interface ArchiveClosureValidationState {
  bytes: number;
  entries: number;
  uncompressedTarBytes: number;
}

/** Production transport refusing redirects, HTTP encoding, and oversized bodies. */
export const DEFAULT_PREVIEW_PACKAGE_ARCHIVE_TRANSPORT: PreviewPackageArchiveTransport =
  Object.freeze({ download: downloadPublicRegistryTarball });

/** Production two-pass tar extractor admitting only bounded regular files and directories. */
export const DEFAULT_PREVIEW_PACKAGE_ARCHIVE_EXTRACTOR: PreviewPackageArchiveExtractor =
  Object.freeze({ extract: extractVerifiedPackageTarball });

/**
 * Downloads, integrity-checks, extracts, and re-verifies an exact package archive plan.
 *
 * @param options Plan, fresh managed destination, cancellation, and optional test adapters.
 * @returns Verified package-set accounting, or `undefined` after any fail-closed rejection.
 */
export async function materializePreviewPackageArchives(
  options: MaterializePreviewPackageArchivesOptions,
): Promise<PreviewManagedPackageCopyResult | undefined> {
  throwIfAborted(options.signal);
  const entries = validateArchivePlan(options.entries);
  if (entries === undefined || entries.length === 0) return undefined;
  const targetNodeModulesPath = path.resolve(options.targetNodeModulesPath);
  if (!(await prepareFreshNodeModulesTarget(targetNodeModulesPath))) return undefined;
  const acquisitionAbort = new AbortController();
  const detachAbort = forwardAbort(options.signal, acquisitionAbort);
  try {
    const archives = await downloadArchives(
      entries,
      options.transport ?? DEFAULT_PREVIEW_PACKAGE_ARCHIVE_TRANSPORT,
      acquisitionAbort,
    );
    const extractor = options.extractor ?? DEFAULT_PREVIEW_PACKAGE_ARCHIVE_EXTRACTOR;
    const preflightedArchives =
      extractor === DEFAULT_PREVIEW_PACKAGE_ARCHIVE_EXTRACTOR
        ? await preflightPackageArchives(archives, acquisitionAbort.signal)
        : undefined;
    const identities = await extractArchives(
      entries,
      preflightedArchives === undefined ? archives : undefined,
      targetNodeModulesPath,
      extractor,
      acquisitionAbort.signal,
      preflightedArchives,
    );
    return await verifyPreviewManagedPackages(identities, targetNodeModulesPath);
  } catch (error) {
    acquisitionAbort.abort(toError(error));
    await rm(targetNodeModulesPath, { force: true, recursive: true }).catch(() => undefined);
    if (options.signal?.aborted === true) throw abortReason(options.signal);
    return undefined;
  } finally {
    detachAbort();
  }
}

/** Accepts a canonical public npm HTTPS tarball URL without credentials or modifiers. */
export function isPublicPreviewPackageArchiveUrl(value: string): boolean {
  if (/\s|\\/u.test(value)) return false;
  try {
    const url = new URL(value);
    return (
      url.protocol === 'https:' &&
      url.hostname === PUBLIC_REGISTRY_HOST &&
      url.port.length === 0 &&
      url.username.length === 0 &&
      url.password.length === 0 &&
      url.search.length === 0 &&
      url.hash.length === 0 &&
      url.pathname.endsWith('.tgz')
    );
  } catch {
    return false;
  }
}

/** Parses one canonical SHA-512 SRI token to the raw digest consumed by archive plans. */
export function parsePreviewPackageSha512Integrity(value: string): Buffer | undefined {
  const match = /^sha512-([A-Za-z0-9+/]+={0,2})$/u.exec(value);
  if (match?.[1] === undefined) return undefined;
  const encodedDigest = match[1];
  const digest = Buffer.from(encodedDigest, 'base64');
  return digest.byteLength === 64 &&
    digest.toString('base64').replace(/=+$/u, '') === encodedDigest.replace(/=+$/u, '')
    ? digest
    : undefined;
}

/** Revalidates public URLs, exact identities, npm paths, digests, and target collisions. */
function validateArchivePlan(
  entries: readonly PreviewVerifiedPackageArchivePlanEntry[],
): readonly PreviewVerifiedPackageArchivePlanEntry[] | undefined {
  if (entries.length === 0 || entries.length > MAX_PACKAGE_COUNT) return undefined;
  const targetKeys = new Set<string>();
  const copiedEntries: PreviewVerifiedPackageArchivePlanEntry[] = [];
  for (const entry of entries) {
    const targetName = readTargetPackageName(entry.targetRelativePath);
    const collisionKey = entry.targetRelativePath.normalize('NFC').toLowerCase();
    if (
      targetName === undefined ||
      !PACKAGE_NAME_PATTERN.test(targetName) ||
      !PACKAGE_NAME_PATTERN.test(entry.packageName) ||
      !PACKAGE_VERSION_PATTERN.test(entry.packageVersion) ||
      !isPublicPreviewPackageArchiveUrl(entry.url) ||
      entry.sha512Digest.byteLength !== 64 ||
      targetKeys.has(collisionKey)
    ) {
      return undefined;
    }
    targetKeys.add(collisionKey);
    copiedEntries.push(
      Object.freeze({
        packageName: entry.packageName,
        packageVersion: entry.packageVersion,
        sha512Digest: Buffer.from(entry.sha512Digest),
        targetRelativePath: entry.targetRelativePath,
        url: entry.url,
      }),
    );
  }
  const ordered = copiedEntries.sort((left, right) => {
    const depth =
      left.targetRelativePath.split('/').length - right.targetRelativePath.split('/').length;
    return depth || compareStrings(left.targetRelativePath, right.targetRelativePath);
  });
  const targets = new Set(ordered.map((entry) => entry.targetRelativePath));
  return ordered.every((entry) => hasNestedOwner(entry.targetRelativePath, targets))
    ? Object.freeze(ordered)
    : undefined;
}

/** Parses a portable npm destination and returns the final installed package name. */
function readTargetPackageName(targetPath: string): string | undefined {
  if (
    targetPath.length === 0 ||
    targetPath !== targetPath.normalize('NFC') ||
    targetPath.includes('\\') ||
    path.posix.isAbsolute(targetPath)
  ) {
    return undefined;
  }
  const segments = targetPath.split('/');
  let cursor = 0;
  let finalName: string | undefined;
  while (cursor < segments.length) {
    const first = segments[cursor];
    if (first === undefined || first === 'node_modules' || first === '.' || first === '..') {
      return undefined;
    }
    if (first.startsWith('@')) {
      const second = segments[cursor + 1];
      if (second === undefined) return undefined;
      finalName = `${first}/${second}`;
      cursor += 2;
    } else {
      finalName = first;
      cursor += 1;
    }
    if (!PACKAGE_NAME_PATTERN.test(finalName)) return undefined;
    if (cursor === segments.length) break;
    if (segments[cursor] !== 'node_modules') return undefined;
    cursor += 1;
    if (cursor === segments.length) return undefined;
  }
  return finalName;
}

/** Downloads a complete plan with bounded concurrency and verifies SRI before extraction. */
async function downloadArchives(
  entries: readonly PreviewVerifiedPackageArchivePlanEntry[],
  transport: PreviewPackageArchiveTransport,
  controller: AbortController,
): Promise<readonly Buffer[]> {
  const archives = new Array<Buffer | undefined>(entries.length);
  let nextIndex = 0;
  let totalBytes = 0;
  const workers = Array.from(
    { length: Math.min(DOWNLOAD_CONCURRENCY, entries.length) },
    async () => {
      while (!controller.signal.aborted) {
        const index = nextIndex++;
        const entry = entries[index];
        if (entry === undefined) return;
        const downloaded = await transport.download({
          maximumBytes: MAX_PACKAGE_TARBALL_BYTES,
          signal: controller.signal,
          url: entry.url,
        });
        if (!(downloaded instanceof Uint8Array)) {
          throw new Error('Package transport returned a non-binary response.');
        }
        const archive = Buffer.from(downloaded);
        if (archive.byteLength === 0 || archive.byteLength > MAX_PACKAGE_TARBALL_BYTES) {
          throw new Error('Package tarball exceeds its compressed safety limit.');
        }
        const expectedDigest = Buffer.from(entry.sha512Digest);
        const actualDigest = createHash('sha512').update(archive).digest();
        if (!timingSafeEqual(actualDigest, expectedDigest)) {
          throw new Error('Package tarball integrity does not match its lock plan.');
        }
        totalBytes += archive.byteLength;
        if (totalBytes > MAX_TOTAL_TARBALL_BYTES) {
          throw new Error('Package closure exceeds its compressed safety limit.');
        }
        archives[index] = archive;
      }
    },
  );
  try {
    await Promise.all(workers);
  } catch (error) {
    controller.abort(toError(error));
    await Promise.allSettled(workers);
    throw error;
  }
  if (archives.some((archive) => archive === undefined)) {
    throw new Error('Package download batch ended before every archive was verified.');
  }
  return Object.freeze(archives as Buffer[]);
}

/** Uses fetch with timeout, redirect rejection, identity encoding, and streaming byte limits. */
async function downloadPublicRegistryTarball(
  request: PreviewPackageArchiveTransportRequest,
): Promise<Uint8Array> {
  if (!isPublicPreviewPackageArchiveUrl(request.url)) {
    throw new Error('Package transport refused a non-public registry URL.');
  }
  const requestAbort = new AbortController();
  const detachAbort = forwardAbort(request.signal, requestAbort);
  const timeout = setTimeout(() => {
    requestAbort.abort(new Error('Package tarball download timed out.'));
  }, MAX_DOWNLOAD_MILLISECONDS);
  timeout.unref();
  try {
    const response = await fetch(request.url, {
      headers: { Accept: 'application/octet-stream', 'Accept-Encoding': 'identity' },
      redirect: 'error',
      signal: requestAbort.signal,
    });
    const contentEncoding = response.headers.get('content-encoding');
    if (
      response.status !== 200 ||
      (contentEncoding !== null && contentEncoding.toLowerCase() !== 'identity') ||
      response.body === null
    ) {
      throw new Error('Package registry returned an inadmissible HTTP response.');
    }
    const contentLength = readContentLength(response.headers.get('content-length'));
    if (contentLength !== undefined && contentLength > request.maximumBytes) {
      throw new Error('Package registry declared an oversized tarball.');
    }
    const reader = response.body.getReader();
    const chunks: Buffer[] = [];
    let bytes = 0;
    try {
      let chunk = await reader.read();
      while (!chunk.done) {
        bytes += chunk.value.byteLength;
        if (bytes > request.maximumBytes) {
          throw new Error('Package registry streamed an oversized tarball.');
        }
        chunks.push(Buffer.from(chunk.value));
        chunk = await reader.read();
      }
    } finally {
      reader.releaseLock();
    }
    return Buffer.concat(chunks, bytes);
  } finally {
    clearTimeout(timeout);
    detachAbort();
  }
}

/** Parses optional decimal Content-Length without signs, fractions, or overflow. */
function readContentLength(value: string | null): number | undefined {
  if (value === null) return undefined;
  if (!/^\d+$/u.test(value)) throw new Error('Package registry returned invalid length metadata.');
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed < 0) {
    throw new Error('Package registry returned invalid length metadata.');
  }
  return parsed;
}

/** Extracts parent packages before their separately owned nested dependencies. */
async function extractArchives(
  entries: readonly PreviewVerifiedPackageArchivePlanEntry[],
  archives: readonly Buffer[] | undefined,
  targetNodeModulesPath: string,
  extractor: PreviewPackageArchiveExtractor,
  signal: AbortSignal,
  preflightedArchives: readonly Buffer[] | undefined,
): Promise<readonly PreviewManagedPackageIdentity[]> {
  const identities: PreviewManagedPackageIdentity[] = [];
  for (const [index, entry] of entries.entries()) {
    throwIfAborted(signal);
    const targetPath = path.resolve(targetNodeModulesPath, ...entry.targetRelativePath.split('/'));
    if (!isPathInside(targetNodeModulesPath, targetPath) || (await pathExists(targetPath))) {
      throw new Error('Package extraction target is not a fresh managed path.');
    }
    await mkdir(path.dirname(targetPath), { recursive: true });
    const preflightedArchive = preflightedArchives?.[index];
    if (preflightedArchives !== undefined) {
      if (preflightedArchive === undefined) {
        throw new Error('A preflighted package archive is missing.');
      }
      await extractPreflightedPackageTarball(preflightedArchive, targetPath, signal);
    } else {
      const archive = archives?.[index];
      if (archive === undefined) throw new Error('A verified package archive is missing.');
      await extractor.extract({
        archive,
        packageName: entry.packageName,
        packageVersion: entry.packageVersion,
        signal,
        targetPath,
      });
    }
    const verification = await verifyPreviewManagedPackageTree(targetPath);
    if (verification.name !== entry.packageName || verification.version !== entry.packageVersion) {
      throw new Error('Extracted package identity does not match its lock plan.');
    }
    identities.push(
      Object.freeze({
        contentDigest: verification.contentDigest,
        name: verification.name,
        relativePath: path.join(...entry.targetRelativePath.split('/')),
        version: verification.version,
      }),
    );
  }
  return Object.freeze(identities);
}

/**
 * Expands and list-validates every production archive before the first package reaches disk.
 * Closure budgets are shared across packages, while the returned raw tar buffers let extraction
 * reuse the bounded decompression work without passing compressed input into the tar parser.
 */
async function preflightPackageArchives(
  archives: readonly Buffer[],
  signal: AbortSignal,
): Promise<readonly Buffer[]> {
  const closure: ArchiveClosureValidationState = {
    bytes: 0,
    entries: 0,
    uncompressedTarBytes: 0,
  };
  const preflighted: Buffer[] = [];
  for (const archive of archives) {
    throwIfAborted(signal);
    const uncompressedTar = await decompressPackageArchive(archive, signal);
    closure.uncompressedTarBytes += uncompressedTar.byteLength;
    if (closure.uncompressedTarBytes > MAX_CLOSURE_UNCOMPRESSED_TAR_BYTES) {
      throw new Error('Package closure exceeds its uncompressed tar safety limit.');
    }
    await runTarValidationPass(uncompressedTar, undefined, signal, closure);
    preflighted.push(uncompressedTar);
  }
  return Object.freeze(preflighted);
}

/** Lists and validates one directly invoked production extractor request before materialization. */
async function extractVerifiedPackageTarball(
  request: PreviewPackageArchiveExtractRequest,
): Promise<void> {
  const archive = Buffer.from(request.archive);
  if (await pathExists(request.targetPath)) {
    throw new Error('Package archive extraction target is not fresh.');
  }
  const [preflightedArchive] = await preflightPackageArchives([archive], request.signal);
  if (preflightedArchive === undefined)
    throw new Error('Package archive preflight produced no tar.');
  await extractPreflightedPackageTarball(preflightedArchive, request.targetPath, request.signal);
}

/** Decompresses one gzip body with an absolute output bound before tar metadata is interpreted. */
async function decompressPackageArchive(archive: Buffer, signal: AbortSignal): Promise<Buffer> {
  if (archive.byteLength < 2 || archive[0] !== 0x1f || archive[1] !== 0x8b) {
    throw new Error('Package archive is not a gzip tarball.');
  }
  throwIfAborted(signal);
  const uncompressedTar = await new Promise<Buffer>((resolve, reject) => {
    gunzip(archive, { maxOutputLength: MAX_PACKAGE_UNCOMPRESSED_TAR_BYTES }, (error, result) => {
      if (error !== null) reject(error);
      else resolve(result);
    });
  }).catch(() => {
    throw new Error(
      'Package archive exceeds its uncompressed tar safety limit or is invalid gzip.',
    );
  });
  throwIfAborted(signal);
  return uncompressedTar;
}

/** Extracts one already preflighted raw tar while repeating the same path rules at write time. */
async function extractPreflightedPackageTarball(
  uncompressedTar: Buffer,
  targetPath: string,
  signal: AbortSignal,
): Promise<void> {
  if (await pathExists(targetPath)) {
    throw new Error('Package archive extraction target is not fresh.');
  }
  await mkdir(targetPath, { recursive: false, mode: 0o700 });
  try {
    await runTarValidationPass(uncompressedTar, targetPath, signal);
  } catch (error) {
    await rm(targetPath, { force: true, recursive: true }).catch(() => undefined);
    throw error;
  }
}

/** Runs one raw-tar list/extract pass with identical synchronous entry rules. */
async function runTarValidationPass(
  uncompressedTar: Buffer,
  targetPath: string | undefined,
  signal: AbortSignal,
  closure?: ArchiveClosureValidationState,
): Promise<void> {
  const state: ArchiveValidationState = {
    bytes: 0,
    closure,
    entries: 0,
    error: undefined,
    metaBytes: 0,
    metaEntries: 0,
    owner: undefined,
    paths: new Map(),
    rootPrefix: undefined,
  };
  const commonOptions = {
    filter: (archivePath: string, value: Stats | ReadEntry): boolean =>
      validateArchiveEntry(state, archivePath, value as ReadEntry),
    maxDepth: MAX_ARCHIVE_DEPTH,
    maxMetaEntrySize: MAX_ARCHIVE_META_ENTRY_BYTES,
    noMtime: true,
    preserveOwner: false,
    preservePaths: false,
    strict: true,
  } as const;
  const parser: Parser =
    targetPath === undefined
      ? listTar(commonOptions)
      : extractTar({
          ...commonOptions,
          chmod: false,
          cwd: targetPath,
          keep: true,
          strip: 1,
          umask: 0o022,
          unlink: false,
        });
  state.owner = parser;
  parser.on('meta', (metadata: unknown) => {
    validateArchiveMetadata(state, metadata);
  });
  await consumeTarParser(parser, uncompressedTar, signal);
  if (state.error !== undefined) throw state.error;
  if (state.entries === 0 || !state.paths.has('package.json')) {
    throw new Error('Package archive does not contain a package manifest.');
  }
}

/** Validates one final PAX-resolved regular entry before tar handles it. */
function validateArchiveEntry(
  state: ArchiveValidationState,
  archivePath: string,
  entry: ReadEntry,
): boolean {
  try {
    state.entries += 1;
    if (state.closure !== undefined) state.closure.entries += 1;
    if (
      state.entries > MAX_ARCHIVE_ENTRIES ||
      (state.closure !== undefined && state.closure.entries > MAX_CLOSURE_ARCHIVE_ENTRIES) ||
      entry.invalid ||
      entry.unsupported
    ) {
      throw new Error('Package archive exceeds its entry safety limit.');
    }
    if (!['File', 'OldFile', 'Directory'].includes(entry.type) || entry.linkpath !== undefined) {
      throw new Error('Package archive contains a link or special filesystem entry.');
    }
    if (!Number.isSafeInteger(entry.size) || entry.size < 0) {
      throw new Error('Package archive contains invalid size metadata.');
    }
    const relativePath = readArchiveRelativePath(state, archivePath, entry.type === 'Directory');
    if (relativePath === undefined) {
      if (entry.type !== 'Directory' || entry.size !== 0) {
        throw new Error('Package archive root is not an empty directory entry.');
      }
      entry.mode = 0o755;
      return true;
    }
    validatePortableArchivePath(relativePath);
    if (isExcludedArchivePath(relativePath)) {
      throw new Error('Package archive contains nested installation or sensitive configuration.');
    }
    const kind = entry.type === 'Directory' ? 'directory' : 'file';
    registerArchivePath(state.paths, relativePath, kind);
    if (kind === 'file') {
      if (entry.size > MAX_PACKAGE_TARBALL_BYTES) {
        throw new Error('Package archive contains an oversized file.');
      }
      state.bytes += entry.size;
      if (state.closure !== undefined) state.closure.bytes += entry.size;
      if (state.bytes > MAX_PACKAGE_EXTRACTED_BYTES) {
        throw new Error('Package archive exceeds its expanded safety limit.');
      }
      if (state.closure !== undefined && state.closure.bytes > MAX_CLOSURE_EXTRACTED_BYTES) {
        throw new Error('Package closure exceeds its expanded safety limit.');
      }
      entry.mode = 0o644;
    } else {
      if (entry.size !== 0) throw new Error('Package archive directory has a nonzero size.');
      entry.mode = 0o755;
    }
    return true;
  } catch (error) {
    return rejectArchive(state, toError(error));
  }
}

/** Bounds metadata consumed before ordinary entries reach the tar filter. */
function validateArchiveMetadata(state: ArchiveValidationState, metadata: unknown): void {
  state.metaEntries += 1;
  state.metaBytes += typeof metadata === 'string' ? Buffer.byteLength(metadata) : 0;
  if (state.metaEntries > MAX_ARCHIVE_META_ENTRIES || state.metaBytes > MAX_ARCHIVE_META_BYTES) {
    rejectArchive(state, new Error('Package archive exceeds its metadata safety limit.'));
  }
}

/** Aborts the active tar parser while retaining the first deterministic error. */
function rejectArchive(state: ArchiveValidationState, error: Error): false {
  state.error ??= error;
  state.owner?.abort(state.error);
  return false;
}

/** Resolves a tar parser after asynchronous extraction closes. */
function consumeTarParser(parser: Parser, archive: Buffer, signal: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    let settled = false;
    const settle = (error?: Error): void => {
      if (settled) return;
      settled = true;
      signal.removeEventListener('abort', onAbort);
      parser.removeListener('close', onClose);
      parser.removeListener('error', onError);
      if (error === undefined) resolve();
      else reject(error);
    };
    const onAbort = (): void => {
      parser.abort(abortReason(signal));
    };
    const onClose = (): void => {
      settle();
    };
    const onError = (error: Error): void => {
      settle(error);
    };
    signal.addEventListener('abort', onAbort, { once: true });
    parser.once('close', onClose);
    parser.once('error', onError);
    if (signal.aborted) onAbort();
    else parser.end(archive);
  });
}

/** Removes one consistent archive root (`package` or the legacy DefinitelyTyped package name). */
function readArchiveRelativePath(
  state: ArchiveValidationState,
  archivePath: string,
  directory: boolean,
): string | undefined {
  if (/\\|\0|[\u0001-\u001f\u007f]/u.test(archivePath)) {
    throw new Error('Package archive contains a non-portable path.');
  }
  const normalized =
    directory && archivePath.endsWith('/') ? archivePath.slice(0, -1) : archivePath;
  const separatorIndex = normalized.indexOf('/');
  const rootPrefix = separatorIndex < 0 ? normalized : normalized.slice(0, separatorIndex);
  validatePortableArchivePath(rootPrefix);
  state.rootPrefix ??= rootPrefix;
  if (rootPrefix !== state.rootPrefix) {
    throw new Error('Package archive contains more than one root prefix.');
  }
  if (separatorIndex < 0) return undefined;
  const relativePath = normalized.slice(separatorIndex + 1);
  return relativePath.length === 0 ? undefined : relativePath;
}

/** Applies cross-platform component, normalization, and alias constraints. */
function validatePortableArchivePath(relativePath: string): void {
  if (
    Buffer.byteLength(relativePath) > MAX_ARCHIVE_PATH_BYTES ||
    relativePath !== relativePath.normalize('NFC') ||
    path.posix.isAbsolute(relativePath) ||
    /^[A-Za-z]:/u.test(relativePath)
  ) {
    throw new Error('Package archive contains a non-portable path.');
  }
  const segments = relativePath.split('/');
  if (segments.length > MAX_ARCHIVE_DEPTH) {
    throw new Error('Package archive path exceeds its depth limit.');
  }
  for (const segment of segments) {
    if (
      segment.length === 0 ||
      segment === '.' ||
      segment === '..' ||
      Buffer.byteLength(segment) > MAX_ARCHIVE_SEGMENT_BYTES ||
      /[<>:"|?*\u0000-\u001f\u007f]/u.test(segment) ||
      /[. ]$/u.test(segment) ||
      WINDOWS_RESERVED_NAME_PATTERN.test(segment)
    ) {
      throw new Error('Package archive contains an invalid path component.');
    }
  }
}

/** Rejects duplicate/case aliases and file/directory prefix conflicts. */
function registerArchivePath(
  paths: Map<string, 'directory' | 'file'>,
  relativePath: string,
  kind: 'directory' | 'file',
): void {
  const collisionKey = relativePath.toLowerCase();
  if (paths.has(collisionKey)) throw new Error('Package archive contains a duplicate path.');
  const segments = collisionKey.split('/');
  for (let index = 1; index < segments.length; index += 1) {
    if (paths.get(segments.slice(0, index).join('/')) === 'file') {
      throw new Error('Package archive path descends through a regular file.');
    }
  }
  if (kind === 'file' && [...paths.keys()].some((value) => value.startsWith(`${collisionKey}/`))) {
    throw new Error('Package archive file collides with an existing directory subtree.');
  }
  paths.set(collisionKey, kind);
}

/** Rejects package-manager state, credentials, environment files, and embedded installs. */
function isExcludedArchivePath(relativePath: string): boolean {
  const segments = relativePath.split('/');
  const baseName = segments.at(-1) ?? '';
  const normalizedSegments = segments.map((segment) => segment.toLowerCase());
  return (
    normalizedSegments.includes('node_modules') ||
    normalizedSegments.includes('.bin') ||
    normalizedSegments.includes('.cache') ||
    SENSITIVE_PACKAGE_FILE_PATTERN.test(baseName)
  );
}

/** Creates or validates the caller-owned empty staging node_modules directory. */
async function prepareFreshNodeModulesTarget(targetPath: string): Promise<boolean> {
  if (path.basename(targetPath) !== 'node_modules' || path.dirname(targetPath) === targetPath) {
    return false;
  }
  try {
    const metadata = await lstat(targetPath);
    return (
      !metadata.isSymbolicLink() &&
      metadata.isDirectory() &&
      (await readdir(targetPath)).length === 0
    );
  } catch (error) {
    if (!isMissingFileError(error)) return false;
    await mkdir(targetPath, { recursive: true, mode: 0o700 });
    return true;
  }
}

/** Requires the physical owner package for every nested npm destination. */
function hasNestedOwner(targetPath: string, targets: ReadonlySet<string>): boolean {
  const segments = targetPath.split('/');
  const index = segments.lastIndexOf('node_modules');
  return index < 0 || targets.has(segments.slice(0, index).join('/'));
}

/** Checks path existence without conflating permissions or transient I/O with absence. */
async function pathExists(candidatePath: string): Promise<boolean> {
  try {
    await lstat(candidatePath);
    return true;
  } catch (error) {
    if (isMissingFileError(error)) return false;
    throw error;
  }
}

/** Checks strict containment without textual-prefix sibling mistakes. */
function isPathInside(rootPath: string, candidatePath: string): boolean {
  const relativePath = path.relative(path.resolve(rootPath), path.resolve(candidatePath));
  return (
    relativePath.length > 0 &&
    relativePath !== '..' &&
    !relativePath.startsWith(`..${path.sep}`) &&
    !path.isAbsolute(relativePath)
  );
}

/** Forwards cancellation into a private controller and returns cleanup. */
function forwardAbort(signal: AbortSignal | undefined, controller: AbortController): () => void {
  if (signal === undefined) return () => undefined;
  const onAbort = (): void => {
    controller.abort(abortReason(signal));
  };
  if (signal.aborted) onAbort();
  else signal.addEventListener('abort', onAbort, { once: true });
  return () => {
    signal.removeEventListener('abort', onAbort);
  };
}

/** Throws before obsolete preview work begins. */
function throwIfAborted(signal: AbortSignal | undefined): void {
  if (signal?.aborted === true) throw abortReason(signal);
}

/** Normalizes arbitrary cancellation reasons to an Error. */
function abortReason(signal: AbortSignal): Error {
  return signal.reason instanceof Error
    ? signal.reason
    : new Error('Preview dependency acquisition aborted.');
}

/** Normalizes caught values without reflecting untrusted response bodies. */
function toError(value: unknown): Error {
  return value instanceof Error ? value : new Error('Preview dependency acquisition failed.');
}

/** Treats only definite absence as missing. */
function isMissingFileError(error: unknown): boolean {
  return typeof error === 'object' && error !== null && 'code' in error && error.code === 'ENOENT';
}

/** Produces locale-independent ordering. */
function compareStrings(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}
