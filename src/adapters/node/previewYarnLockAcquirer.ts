/**
 * Acquires Yarn v1/Berry public npm packages into extension-owned staging storage. Classic locks
 * provide tarball SRI directly. Berry locks provide the exact version, so this adapter obtains only
 * that version's public registry metadata before delegating to the shared verified archive layer.
 */
import type { PreviewManagedPackageCopyResult } from './previewManagedDependencyAdmission';
import {
  isPublicPreviewPackageArchiveUrl,
  materializePreviewPackageArchives,
  parsePreviewPackageSha512Integrity,
  type PreviewPackageArchiveExtractor,
  type PreviewPackageArchiveTransport,
  type PreviewVerifiedPackageArchivePlanEntry,
} from './previewPackageArchive';
import type { PreviewDependencyProfile } from './previewDependencyProfile';
import {
  createPreviewYarnLockPlan,
  type PreviewYarnLockedPackagePlanEntry,
} from './previewYarnLockPlan';

const PUBLIC_REGISTRY_HOST = 'registry.npmjs.org';
const MAX_METADATA_BYTES = 1024 * 1024;
const MAX_TOTAL_METADATA_BYTES = 32 * 1024 * 1024;
const MAX_METADATA_MILLISECONDS = 30_000;
const METADATA_CONCURRENCY = 4;

/** One exact public registry metadata request retained as an injectable network boundary. */
export interface PreviewYarnMetadataTransportRequest {
  readonly maximumBytes: number;
  readonly packageName: string;
  readonly packageVersion: string;
  readonly signal: AbortSignal;
  readonly url: string;
}

/** Raw metadata transport used by Berry acquisition tests without real registry access. */
export interface PreviewYarnMetadataTransport {
  readonly download: (request: PreviewYarnMetadataTransportRequest) => Promise<Uint8Array>;
}

/** Inputs for one exact Yarn lock acquisition into a fresh managed node_modules directory. */
export interface AcquirePreviewYarnLockDependenciesOptions {
  readonly extractor?: PreviewPackageArchiveExtractor;
  readonly metadataTransport?: PreviewYarnMetadataTransport;
  readonly profile: PreviewDependencyProfile;
  readonly projectRoot: string;
  readonly requiredPackageNames?: readonly string[];
  readonly signal?: AbortSignal;
  readonly targetNodeModulesPath: string;
  readonly transport?: PreviewPackageArchiveTransport;
}

/** Exact archive metadata narrowed from an exact-version registry response. */
interface YarnArchiveMetadata {
  readonly integrity: string;
  readonly resolved: string;
}

/** Public production metadata transport with no redirect, compression, or unbounded body support. */
export const DEFAULT_PREVIEW_YARN_METADATA_TRANSPORT: PreviewYarnMetadataTransport = Object.freeze({
  download: downloadExactRegistryMetadata,
});

/**
 * Restores one compiler-proven Yarn package closure without invoking Yarn or touching the project.
 *
 * @param options Frozen profile, missing roots, staging path, cancellation, and test transports.
 * @returns Verified package-set accounting, or `undefined` for unsupported/stale lock evidence.
 */
export async function acquirePreviewYarnLockDependencies(
  options: AcquirePreviewYarnLockDependenciesOptions,
): Promise<PreviewManagedPackageCopyResult | undefined> {
  if (options.signal?.aborted === true) throw abortReason(options.signal);
  const requiredPackageNames =
    options.requiredPackageNames ?? directRequirementNames(options.profile);
  const plan = await createPreviewYarnLockPlan({
    profile: options.profile,
    projectRoot: options.projectRoot,
    requiredPackageNames,
  });
  if (plan === undefined || plan.entries.length === 0) return undefined;
  const entries = await resolveArchiveEntries(
    plan.entries,
    options.metadataTransport ?? DEFAULT_PREVIEW_YARN_METADATA_TRANSPORT,
    options.signal,
  ).catch(() => {
    if (options.signal?.aborted === true) throw abortReason(options.signal);
    return undefined;
  });
  if (entries === undefined) return undefined;
  return materializePreviewPackageArchives({
    entries,
    ...(options.extractor === undefined ? {} : { extractor: options.extractor }),
    ...(options.signal === undefined ? {} : { signal: options.signal }),
    targetNodeModulesPath: options.targetNodeModulesPath,
    ...(options.transport === undefined ? {} : { transport: options.transport }),
  });
}

/** Converts classic evidence directly and resolves each distinct Berry identity once. */
async function resolveArchiveEntries(
  planEntries: readonly PreviewYarnLockedPackagePlanEntry[],
  metadataTransport: PreviewYarnMetadataTransport,
  signal: AbortSignal | undefined,
): Promise<readonly PreviewVerifiedPackageArchivePlanEntry[] | undefined> {
  const missingMetadata = new Map<string, PreviewYarnLockedPackagePlanEntry>();
  for (const entry of planEntries) {
    if (entry.integrity === undefined || entry.resolved === undefined) {
      missingMetadata.set(packageIdentity(entry), entry);
    }
  }
  const metadata = await downloadBerryMetadata(
    [...missingMetadata.values()],
    metadataTransport,
    signal,
  );
  if (metadata === undefined) return undefined;

  const archives: PreviewVerifiedPackageArchivePlanEntry[] = [];
  for (const entry of planEntries) {
    const resolvedMetadata =
      entry.integrity !== undefined && entry.resolved !== undefined
        ? { integrity: entry.integrity, resolved: entry.resolved }
        : metadata.get(packageIdentity(entry));
    const sha512Digest =
      resolvedMetadata === undefined
        ? undefined
        : parsePreviewPackageSha512Integrity(resolvedMetadata.integrity);
    if (
      resolvedMetadata === undefined ||
      sha512Digest === undefined ||
      !isPublicPreviewPackageArchiveUrl(resolvedMetadata.resolved)
    ) {
      return undefined;
    }
    archives.push(
      Object.freeze({
        packageName: entry.packageName,
        packageVersion: entry.version,
        sha512Digest,
        targetRelativePath: entry.targetRelativePath,
        url: resolvedMetadata.resolved,
      }),
    );
  }
  return Object.freeze(archives);
}

/** Downloads exact-version Berry metadata with bounded concurrency and aggregate accounting. */
async function downloadBerryMetadata(
  entries: readonly PreviewYarnLockedPackagePlanEntry[],
  transport: PreviewYarnMetadataTransport,
  signal: AbortSignal | undefined,
): Promise<ReadonlyMap<string, YarnArchiveMetadata> | undefined> {
  if (entries.length === 0) return new Map();
  const controller = new AbortController();
  const detachAbort = forwardAbort(signal, controller);
  const metadata = new Map<string, YarnArchiveMetadata>();
  let nextIndex = 0;
  let totalBytes = 0;
  const workers = Array.from(
    { length: Math.min(METADATA_CONCURRENCY, entries.length) },
    async () => {
      while (!controller.signal.aborted) {
        const entry = entries[nextIndex++];
        if (entry === undefined) return;
        const url = createExactMetadataUrl(entry.packageName, entry.version);
        const downloaded = await transport.download({
          maximumBytes: MAX_METADATA_BYTES,
          packageName: entry.packageName,
          packageVersion: entry.version,
          signal: controller.signal,
          url,
        });
        if (!(downloaded instanceof Uint8Array) || downloaded.byteLength > MAX_METADATA_BYTES) {
          throw new Error('Registry metadata transport returned an invalid response.');
        }
        totalBytes += downloaded.byteLength;
        if (totalBytes > MAX_TOTAL_METADATA_BYTES) {
          throw new Error('Registry metadata exceeds the aggregate safety limit.');
        }
        const parsed = readExactArchiveMetadata(downloaded, entry.packageName, entry.version);
        if (parsed === undefined)
          throw new Error('Registry metadata lacks exact archive evidence.');
        metadata.set(packageIdentity(entry), parsed);
      }
    },
  );
  try {
    await Promise.all(workers);
    return metadata;
  } catch (error) {
    controller.abort(error instanceof Error ? error : undefined);
    await Promise.allSettled(workers);
    if (signal?.aborted === true) throw abortReason(signal);
    return undefined;
  } finally {
    detachAbort();
  }
}

/** Narrows registry JSON to the requested package identity and one strong public archive. */
function readExactArchiveMetadata(
  bytes: Uint8Array,
  packageName: string,
  packageVersion: string,
): YarnArchiveMetadata | undefined {
  try {
    const parsed: unknown = JSON.parse(Buffer.from(bytes).toString('utf8'));
    if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) return undefined;
    const record = parsed as Readonly<Record<string, unknown>>;
    if (record.name !== packageName || record.version !== packageVersion) return undefined;
    const dist =
      typeof record.dist === 'object' && record.dist !== null && !Array.isArray(record.dist)
        ? (record.dist as Readonly<Record<string, unknown>>)
        : undefined;
    if (
      dist === undefined ||
      typeof dist.tarball !== 'string' ||
      !isPublicPreviewPackageArchiveUrl(dist.tarball) ||
      typeof dist.integrity !== 'string' ||
      parsePreviewPackageSha512Integrity(dist.integrity) === undefined
    ) {
      return undefined;
    }
    return Object.freeze({ integrity: dist.integrity, resolved: dist.tarball });
  } catch {
    return undefined;
  }
}

/** Performs one exact public metadata fetch with timeout and streaming size enforcement. */
async function downloadExactRegistryMetadata(
  request: PreviewYarnMetadataTransportRequest,
): Promise<Uint8Array> {
  if (request.url !== createExactMetadataUrl(request.packageName, request.packageVersion)) {
    throw new Error('Registry metadata transport refused a non-exact URL.');
  }
  const controller = new AbortController();
  const detachAbort = forwardAbort(request.signal, controller);
  const timeout = setTimeout(() => {
    controller.abort(new Error('Registry metadata request timed out.'));
  }, MAX_METADATA_MILLISECONDS);
  timeout.unref();
  try {
    const response = await fetch(request.url, {
      headers: { Accept: 'application/json', 'Accept-Encoding': 'identity' },
      redirect: 'error',
      signal: controller.signal,
    });
    const contentEncoding = response.headers.get('content-encoding');
    if (
      response.status !== 200 ||
      response.body === null ||
      (contentEncoding !== null && contentEncoding.toLowerCase() !== 'identity')
    ) {
      throw new Error('Registry metadata returned an inadmissible response.');
    }
    const declaredBytes = readContentLength(response.headers.get('content-length'));
    if (declaredBytes !== undefined && declaredBytes > request.maximumBytes) {
      throw new Error('Registry metadata declared an oversized response.');
    }
    const reader = response.body.getReader();
    const chunks: Buffer[] = [];
    let bytes = 0;
    try {
      let chunk = await reader.read();
      while (!chunk.done) {
        bytes += chunk.value.byteLength;
        if (bytes > request.maximumBytes) throw new Error('Registry metadata is oversized.');
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

/** Constructs the sole accepted metadata endpoint for an exact public package version. */
function createExactMetadataUrl(packageName: string, packageVersion: string): string {
  return `https://${PUBLIC_REGISTRY_HOST}/${encodeURIComponent(packageName)}/${encodeURIComponent(packageVersion)}`;
}

/** Falls back to every declared root only for direct adapter callers, not compiler retries. */
function directRequirementNames(profile: PreviewDependencyProfile): readonly string[] {
  return Object.freeze(
    [
      ...new Set(
        Object.values(profile.requirementsByField).flatMap((requirements) =>
          Object.keys(requirements),
        ),
      ),
    ].sort(),
  );
}

/** Exact package identity deduplicates Berry metadata across nested install slots. */
function packageIdentity(entry: PreviewYarnLockedPackagePlanEntry): string {
  return `${entry.packageName}\0${entry.version}`;
}

/** Parses a non-negative decimal content length without accepting alternate syntax. */
function readContentLength(value: string | null): number | undefined {
  if (value === null || !/^\d+$/u.test(value)) return undefined;
  const parsed = Number(value);
  return Number.isSafeInteger(parsed) && parsed >= 0 ? parsed : undefined;
}

/** Forwards caller cancellation into a private network batch controller. */
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

/** Normalizes cancellation reasons without exposing arbitrary structured-clone values. */
function abortReason(signal: AbortSignal): Error {
  return signal.reason instanceof Error
    ? signal.reason
    : new Error('Preview dependency acquisition aborted.');
}
