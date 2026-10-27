import { createHash, randomUUID } from 'node:crypto';
import { mkdir, readFile, rename, rm, stat, writeFile } from 'node:fs/promises';
import path from 'node:path';
import type {
  PreviewVendorBuildOutput,
  PreviewVendorModuleCacheBackend,
} from '../esbuild/previewVendorModuleBuilder';

/** Content-addressed bytes shared by chunks and the optional stylesheet. */
interface PayloadIdentity {
  /** Expected decoded payload size in bytes. */
  readonly bytes: number;
  /** SHA-256 of the exact payload bytes and its confined storage filename. */
  readonly sha256: string;
}
type PayloadDescriptor = PayloadIdentity &
  ({ readonly relativePath: string; readonly role: 'chunk' } | { readonly role: 'stylesheet' });
interface VendorManifest {
  readonly identity: string;
  readonly manifestSha256: string;
  readonly moduleImports: PreviewVendorBuildOutput['moduleImports'];
  readonly payloads: readonly PayloadDescriptor[];
  readonly schema: 1;
}

const LOCK_STALE_MS = 120_000;
const WAIT_MS = 100;
const WAIT_LIMIT_MS = 3_000;
const digest = (bytes: Uint8Array): string => createHash('sha256').update(bytes).digest('hex');
/** Distinguishes a local compiler rejection from a recoverable cache failure. */
class VendorBuildFailure extends Error {
  /** Retains the original rejection so cache fallback never reruns a failed compiler build. */
  public constructor(override readonly cause: unknown) {
    super('Vendor compilation failed.', { cause });
  }
}

/** Campaign-confined, fail-open vendor single-flight cache for v12 compiler lanes only. */
export function createPreviewHeadlessTsxCorpusVendorCache(options: {
  readonly campaignId: string;
  readonly engineDigest: string;
  readonly policyDigest: string;
  readonly spoolRoot: string;
}): PreviewVendorModuleCacheBackend {
  let root: string;
  let sharedRoot: string;
  try {
    root = confinedDirectory(
      options.spoolRoot,
      'vendor-cache',
      segment(options.engineDigest),
      segment(options.policyDigest),
      segment(options.campaignId),
    );
    sharedRoot = confinedDirectory(options.spoolRoot, 'shared-vendor');
  } catch {
    return { getOrBuild: async (_identity, build) => await build() };
  }
  return {
    async getOrBuild(identity, build) {
      if (!/^[a-f0-9]{64}$/u.test(identity)) return await build();
      const manifestPath = confinedFile(root, `${identity}.manifest.json`);
      const lockPath = confinedFile(root, `${identity}.lock`);
      try {
        const cached = await readManifest(manifestPath, identity, sharedRoot);
        if (cached !== undefined) return cached;
      } catch {
        // Corrupt or incomplete cache entries are misses, never compiler failures.
      }
      const token = randomUUID();
      let owner = false;
      try {
        owner = await acquire(lockPath, token);
        if (!owner) {
          const until = Date.now() + WAIT_LIMIT_MS;
          while (Date.now() < until) {
            await delay(WAIT_MS);
            try {
              const cached = await readManifest(manifestPath, identity, sharedRoot);
              if (cached !== undefined) return cached;
            } catch {
              // A publisher may still be atomically committing; retain local fallback.
            }
            owner = await acquire(lockPath, token);
            if (owner) break;
          }
          if (!owner) return await build();
        }
        try {
          const cached = await readManifest(manifestPath, identity, sharedRoot);
          if (cached !== undefined) return cached;
        } catch {
          // Publish a replacement only while owning this exact identity lock.
        }
        const output = await build().catch((error: unknown) => {
          throw new VendorBuildFailure(error);
        });
        try {
          await publish(manifestPath, identity, output, sharedRoot);
        } catch {
          // The verified local output remains usable when persistence is unavailable.
        }
        return output;
      } catch (error) {
        if (error instanceof VendorBuildFailure) throw error.cause;
        return await build();
      } finally {
        if (owner) await release(lockPath, token).catch(() => undefined);
      }
    },
  };
}

/** Atomically publishes content-addressed payloads and verifies the committed manifest before reuse. */
async function publish(
  manifestPath: string,
  identity: string,
  output: PreviewVendorBuildOutput,
  sharedRoot: string,
): Promise<void> {
  const payloads: PayloadDescriptor[] = [];
  for (const chunk of output.chunks) {
    const sha256 = digest(chunk.contents);
    await persistPayload(confinedFile(sharedRoot, `${sha256}.chunk`), chunk.contents, sha256);
    payloads.push({
      bytes: chunk.contents.byteLength,
      relativePath: safeRelativePath(chunk.relativePath),
      role: 'chunk',
      sha256,
    });
  }
  if (output.stylesheet !== undefined) {
    const sha256 = digest(output.stylesheet);
    await persistPayload(confinedFile(sharedRoot, `${sha256}.chunk`), output.stylesheet, sha256);
    payloads.push({ bytes: output.stylesheet.byteLength, role: 'stylesheet', sha256 });
  }
  const bare = {
    identity,
    moduleImports: output.moduleImports.map((value) => ({ ...value })),
    payloads,
    schema: 1 as const,
  };
  const manifest: VendorManifest = {
    ...bare,
    manifestSha256: digest(Buffer.from(JSON.stringify(bare))),
  };
  await mkdir(path.dirname(manifestPath), { recursive: true });
  const temporary = `${manifestPath}.${randomUUID()}.tmp`;
  await writeFile(temporary, JSON.stringify(manifest), { flag: 'wx' });
  await rename(temporary, manifestPath);
  const verified = await readManifest(manifestPath, identity, sharedRoot);
  if (verified === undefined)
    throw new Error('Vendor cache manifest failed post-commit verification.');
}

/** Verifies bounded untrusted manifest fields and payload hashes before admitting cached output. */
async function readManifest(
  manifestPath: string,
  identity: string,
  sharedRoot: string,
): Promise<PreviewVendorBuildOutput | undefined> {
  const metadata = await stat(manifestPath).catch((error: unknown) => {
    if (isManifestRecord(error) && error.code === 'ENOENT') return undefined;
    throw error;
  });
  if (metadata === undefined) return undefined;
  if (metadata.size <= 0 || metadata.size > 1_000_000)
    throw new Error('Vendor cache manifest size is invalid.');
  const parsed: unknown = JSON.parse(await readFile(manifestPath, 'utf8'));
  if (!isManifestRecord(parsed)) throw new Error('Vendor cache manifest is invalid.');
  const { manifestSha256, ...bare } = parsed;
  if (
    parsed.schema !== 1 ||
    parsed.identity !== identity ||
    typeof manifestSha256 !== 'string' ||
    digest(Buffer.from(JSON.stringify(bare))) !== manifestSha256
  )
    throw new Error('Vendor cache manifest integrity mismatch.');
  if (
    !Array.isArray(parsed.payloads) ||
    parsed.payloads.length > 10_000 ||
    !Array.isArray(parsed.moduleImports) ||
    parsed.moduleImports.length > 10_000
  )
    throw new Error('Vendor cache manifest bounds are invalid.');
  const chunks: PreviewVendorBuildOutput['chunks'][number][] = [];
  let stylesheet: Uint8Array | undefined;
  const payloads: readonly unknown[] = parsed.payloads;
  for (const payload of payloads) {
    if (!validPayload(payload)) throw new Error('Vendor cache payload descriptor is invalid.');
    const bytes = await readFile(confinedFile(sharedRoot, `${payload.sha256}.chunk`));
    if (bytes.byteLength !== payload.bytes || digest(bytes) !== payload.sha256)
      throw new Error('Vendor cache payload integrity mismatch.');
    if (payload.role === 'stylesheet') {
      if (stylesheet !== undefined) throw new Error('Vendor cache has multiple stylesheets.');
      stylesheet = new Uint8Array(bytes);
    } else {
      chunks.push({
        contents: new Uint8Array(bytes),
        relativePath: safeRelativePath(payload.relativePath),
      });
    }
  }
  const importValues: readonly unknown[] = parsed.moduleImports;
  const moduleImports = importValues.map((value) => {
    if (
      !isManifestRecord(value) ||
      typeof value.specifier !== 'string' ||
      typeof value.relativePath !== 'string' ||
      value.specifier.length > 4_096 ||
      value.relativePath.length > 4_096
    )
      throw new Error('Vendor cache module import is invalid.');
    return { relativePath: safeRelativePath(value.relativePath), specifier: value.specifier };
  });
  return { chunks, moduleImports, ...(stylesheet === undefined ? {} : { stylesheet }) };
}

/** Narrows only descriptor fields that are consumed by the corresponding payload role. */
function validPayload(payload: unknown): payload is PayloadDescriptor {
  return (
    isManifestRecord(payload) &&
    (payload.role === 'chunk' || payload.role === 'stylesheet') &&
    typeof payload.sha256 === 'string' &&
    /^[a-f0-9]{64}$/u.test(payload.sha256) &&
    typeof payload.bytes === 'number' &&
    Number.isSafeInteger(payload.bytes) &&
    payload.bytes >= 0 &&
    payload.bytes <= 128 * 1024 * 1024 &&
    (payload.role === 'stylesheet' || typeof payload.relativePath === 'string')
  );
}

/** Rejects primitive and array values before reading JSON object fields. */
function isManifestRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** Reuses matching payload bytes or commits a new immutable payload; hash collisions reject reuse. */
async function persistPayload(target: string, bytes: Uint8Array, sha256: string): Promise<void> {
  await mkdir(path.dirname(target), { recursive: true });
  try {
    const existing = await readFile(target);
    if (existing.byteLength === bytes.byteLength && digest(existing) === sha256) return;
    throw new Error('Shared vendor payload hash collision.');
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
  }
  const temporary = `${target}.${randomUUID()}.tmp`;
  await writeFile(temporary, bytes, { flag: 'wx' });
  await rename(temporary, target);
  const committed = await readFile(target);
  if (committed.byteLength !== bytes.byteLength || digest(committed) !== sha256)
    throw new Error('Shared vendor payload atomic verification failed.');
}

/** Claims one identity lock, reclaiming only stale locks whose owning process is no longer alive. */
async function acquire(lockPath: string, token: string): Promise<boolean> {
  await mkdir(path.dirname(lockPath), { recursive: true });
  try {
    await writeFile(lockPath, JSON.stringify({ pid: process.pid, token }), { flag: 'wx' });
    return true;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error;
  }
  try {
    const lock = JSON.parse(await readFile(lockPath, 'utf8')) as { readonly pid?: unknown };
    const metadata = await stat(lockPath);
    const alive =
      typeof lock.pid === 'number' && Number.isSafeInteger(lock.pid) && processAlive(lock.pid);
    if (alive || Date.now() - metadata.mtimeMs < LOCK_STALE_MS) return false;
    await rm(lockPath, { force: true });
  } catch {
    return false;
  }
  try {
    await writeFile(lockPath, JSON.stringify({ pid: process.pid, token }), { flag: 'wx' });
    return true;
  } catch {
    return false;
  }
}

/** Removes a lock only when its persisted token still belongs to this publisher. */
async function release(lockPath: string, token: string): Promise<void> {
  const lock = JSON.parse(await readFile(lockPath, 'utf8')) as { readonly token?: unknown };
  if (lock.token === token) await rm(lockPath, { force: false });
}

/** Treats permission-denied process probes as alive so another publisher's lock is retained. */
function processAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return (error as NodeJS.ErrnoException).code === 'EPERM';
  }
}
/** Waits the bounded polling interval before checking for another publisher's commit. */
function delay(milliseconds: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}
/** Accepts a single bounded cache namespace segment and rejects separators or empty names. */
function segment(value: string): string {
  if (!/^[A-Za-z0-9._-]{1,160}$/u.test(value)) throw new Error('Unsafe vendor-cache namespace.');
  return value;
}
/** Rejects absolute or parent-traversing chunk paths and normalizes platform separators. */
function safeRelativePath(value: string): string {
  if (
    value.length === 0 ||
    value.length > 4_096 ||
    path.isAbsolute(value) ||
    value.split(/[\\/]/u).includes('..')
  )
    throw new Error('Unsafe vendor-cache relative path.');
  return value.split(path.sep).join('/');
}
/** Resolves cache segments beneath the spool root, throwing on lexical directory escapes. */
function confinedDirectory(root: string, ...segments: readonly string[]): string {
  const resolvedRoot = path.resolve(root);
  const candidate = path.resolve(resolvedRoot, ...segments);
  if (candidate !== resolvedRoot && !candidate.startsWith(`${resolvedRoot}${path.sep}`))
    throw new Error('Vendor-cache path escaped spool root.');
  return candidate;
}
/** Resolves one cache filename through the same confinement boundary as cache directories. */
function confinedFile(directory: string, filename: string): string {
  return confinedDirectory(directory, filename);
}
