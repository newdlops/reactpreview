import { createHash, randomUUID } from 'node:crypto';
import { mkdir, readFile, rename, rm, stat, writeFile } from 'node:fs/promises';
import path from 'node:path';
import type {
  PreviewVendorBuildOutput,
  PreviewVendorModuleCacheBackend,
} from '../esbuild/previewVendorModuleBuilder';

interface PayloadDescriptor {
  readonly bytes: number;
  readonly relativePath?: string;
  readonly role: 'chunk' | 'stylesheet';
  readonly sha256: string;
}
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
class VendorBuildFailure {
  public constructor(readonly cause: unknown) {}
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
        const output = await build().catch((error: unknown) => { throw new VendorBuildFailure(error); });
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
    payloads.push({ bytes: chunk.contents.byteLength, relativePath: safeRelativePath(chunk.relativePath), role: 'chunk', sha256 });
  }
  if (output.stylesheet !== undefined) {
    const sha256 = digest(output.stylesheet);
    await persistPayload(confinedFile(sharedRoot, `${sha256}.chunk`), output.stylesheet, sha256);
    payloads.push({ bytes: output.stylesheet.byteLength, role: 'stylesheet', sha256 });
  }
  const bare = { identity, moduleImports: output.moduleImports.map((value) => ({ ...value })), payloads, schema: 1 as const };
  const manifest: VendorManifest = { ...bare, manifestSha256: digest(Buffer.from(JSON.stringify(bare))) };
  await mkdir(path.dirname(manifestPath), { recursive: true });
  const temporary = `${manifestPath}.${randomUUID()}.tmp`;
  await writeFile(temporary, JSON.stringify(manifest), { flag: 'wx' });
  await rename(temporary, manifestPath);
  const verified = await readManifest(manifestPath, identity, sharedRoot);
  if (verified === undefined) throw new Error('Vendor cache manifest failed post-commit verification.');
}

async function readManifest(manifestPath: string, identity: string, sharedRoot: string): Promise<PreviewVendorBuildOutput | undefined> {
  const metadata = await stat(manifestPath).catch((error: NodeJS.ErrnoException) => error.code === 'ENOENT' ? undefined : Promise.reject(error));
  if (metadata === undefined) return undefined;
  if (metadata.size <= 0 || metadata.size > 1_000_000) throw new Error('Vendor cache manifest size is invalid.');
  const parsed = JSON.parse(await readFile(manifestPath, 'utf8')) as VendorManifest;
  const { manifestSha256, ...bare } = parsed;
  if (parsed.schema !== 1 || parsed.identity !== identity || typeof manifestSha256 !== 'string' || digest(Buffer.from(JSON.stringify(bare))) !== manifestSha256) throw new Error('Vendor cache manifest integrity mismatch.');
  if (!Array.isArray(parsed.payloads) || parsed.payloads.length > 10_000 || !Array.isArray(parsed.moduleImports) || parsed.moduleImports.length > 10_000) throw new Error('Vendor cache manifest bounds are invalid.');
  const chunks: Array<PreviewVendorBuildOutput['chunks'][number]> = [];
  let stylesheet: Uint8Array | undefined;
  for (const payload of parsed.payloads) {
    if (!validPayload(payload)) throw new Error('Vendor cache payload descriptor is invalid.');
    const bytes = await readFile(confinedFile(sharedRoot, `${payload.sha256}.chunk`));
    if (bytes.byteLength !== payload.bytes || digest(bytes) !== payload.sha256) throw new Error('Vendor cache payload integrity mismatch.');
    if (payload.role === 'stylesheet') {
      if (stylesheet !== undefined) throw new Error('Vendor cache has multiple stylesheets.');
      stylesheet = new Uint8Array(bytes);
    } else {
      chunks.push({ contents: new Uint8Array(bytes), relativePath: safeRelativePath(payload.relativePath!) });
    }
  }
  const moduleImports = parsed.moduleImports.map((value) => {
    if (typeof value.specifier !== 'string' || typeof value.relativePath !== 'string' || value.specifier.length > 4_096 || value.relativePath.length > 4_096) throw new Error('Vendor cache module import is invalid.');
    return { relativePath: safeRelativePath(value.relativePath), specifier: value.specifier };
  });
  return { chunks, moduleImports, ...(stylesheet === undefined ? {} : { stylesheet }) };
}

function validPayload(payload: PayloadDescriptor): boolean {
  return typeof payload === 'object' && payload !== null && (payload.role === 'chunk' || payload.role === 'stylesheet') && typeof payload.sha256 === 'string' && /^[a-f0-9]{64}$/u.test(payload.sha256) && Number.isSafeInteger(payload.bytes) && payload.bytes >= 0 && payload.bytes <= 128 * 1024 * 1024 && (payload.role === 'stylesheet' || typeof payload.relativePath === 'string');
}

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
  if (committed.byteLength !== bytes.byteLength || digest(committed) !== sha256) throw new Error('Shared vendor payload atomic verification failed.');
}

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
    const alive = typeof lock.pid === 'number' && Number.isSafeInteger(lock.pid) && processAlive(lock.pid);
    if (alive || Date.now() - metadata.mtimeMs < LOCK_STALE_MS) return false;
    await rm(lockPath, { force: true });
  } catch {
    return false;
  }
  try { await writeFile(lockPath, JSON.stringify({ pid: process.pid, token }), { flag: 'wx' }); return true; } catch { return false; }
}

async function release(lockPath: string, token: string): Promise<void> {
  const lock = JSON.parse(await readFile(lockPath, 'utf8')) as { readonly token?: unknown };
  if (lock.token === token) await rm(lockPath, { force: false });
}

function processAlive(pid: number): boolean {
  try { process.kill(pid, 0); return true; } catch (error) { return (error as NodeJS.ErrnoException).code === 'EPERM'; }
}
function delay(milliseconds: number): Promise<void> { return new Promise((resolve) => setTimeout(resolve, milliseconds)); }
function segment(value: string): string { if (!/^[A-Za-z0-9._-]{1,160}$/u.test(value)) throw new Error('Unsafe vendor-cache namespace.'); return value; }
function safeRelativePath(value: string): string { if (value.length === 0 || value.length > 4_096 || path.isAbsolute(value) || value.split(/[\\/]/u).includes('..')) throw new Error('Unsafe vendor-cache relative path.'); return value.split(path.sep).join('/'); }
function confinedDirectory(root: string, ...segments: readonly string[]): string { const resolvedRoot = path.resolve(root); const candidate = path.resolve(resolvedRoot, ...segments); if (candidate !== resolvedRoot && !candidate.startsWith(`${resolvedRoot}${path.sep}`)) throw new Error('Vendor-cache path escaped spool root.'); return candidate; }
function confinedFile(directory: string, filename: string): string { return confinedDirectory(directory, filename); }
