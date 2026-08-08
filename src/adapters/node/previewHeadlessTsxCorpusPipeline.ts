/**
 * v12's deliberately small compiler-to-renderer seam.  The handoff is a v8
 * envelope rather than JSON: PreviewBundle contains binary values and must
 * never be reconstructed from a lossy DTO.
 */
import { createHash, randomUUID } from 'node:crypto';
import { mkdir, readFile, rename, rm, stat, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { isDeepStrictEqual } from 'node:util';
import { deserialize, serialize } from 'node:v8';
import type { PreviewBuildRequest, PreviewBundle } from '../../domain/preview';

export const PREVIEW_TSX_CORPUS_PIPELINE_SCHEMA = 12;
export const PREVIEW_TSX_CORPUS_SPOOL_LIMIT_BYTES = 2 * 1024 * 1024 * 1024;

export interface PreviewTsxCorpusSpoolIdentity {
  readonly attemptId: string; readonly campaignId: string; readonly candidate: string;
  readonly engineDigest: string; readonly generationId: string; readonly laneId: number;
  readonly policyDigest: string; readonly row: number; readonly sourceDigest: string;
}
export interface PreviewTsxCorpusSpoolDescriptor extends PreviewTsxCorpusSpoolIdentity {
  readonly absoluteDeadlineEpochMs: number; readonly bundleBytes: number; readonly bundleSha256: string;
  readonly compiledAtEpochMs: number; readonly descriptorSha256: string; readonly schema: 12;
  readonly sharedChunks: readonly PreviewTsxCorpusSharedChunkDescriptor[];
  readonly spoolPath: string;
}
interface PreviewTsxCorpusSharedChunkDescriptor {
  readonly bytes: number;
  readonly index: number;
  readonly path: string;
  readonly relativePath: string;
  readonly sha256: string;
}
interface VerifiedPreviewTsxCorpusSharedChunk {
  readonly bytes: Buffer;
  readonly descriptor: PreviewTsxCorpusSharedChunkDescriptor;
}
interface VerifiedPreviewTsxCorpusSpoolRead {
  readonly descriptor: PreviewTsxCorpusSpoolDescriptor;
  readonly sharedChunks: readonly VerifiedPreviewTsxCorpusSharedChunk[];
  readonly spoolBytes: Buffer;
}
export type PreviewTsxCorpusCompilerLaneCommand =
  | {
      readonly absoluteDeadlineEpochMs: number;
      readonly commandId: string;
      readonly identity: PreviewTsxCorpusSpoolIdentity;
      readonly kind: 'compile';
      readonly request: PreviewBuildRequest;
      readonly spoolRoot: string;
      readonly version: 12;
    }
  | { readonly kind: 'shutdown'; readonly version: 12 };

export type PreviewTsxCorpusCompilerLaneMessage =
  | { readonly kind: 'ready'; readonly version: 12 }
  | {
      readonly commandId: string;
      readonly compileFinishedAt: number;
      readonly compileStartedAt: number;
      readonly descriptor: PreviewTsxCorpusSpoolDescriptor;
      readonly kind: 'compiled';
      readonly version: 12;
    }
  | {
      readonly commandId: string;
      readonly error: string;
      readonly errorName: string;
      readonly kind: 'compile-failed';
      readonly stage: 'compile' | 'spool';
      readonly version: 12;
    }
  | { readonly kind: 'drained'; readonly version: 12 };
interface Envelope { readonly bundle: PreviewBundle; readonly identity: PreviewTsxCorpusSpoolIdentity; readonly request: PreviewBuildRequest; readonly schema: 12; }

const digest = (bytes: Uint8Array): string => createHash('sha256').update(bytes).digest('hex');
const descriptorBytes = (value: Omit<PreviewTsxCorpusSpoolDescriptor, 'descriptorSha256'>): Buffer => Buffer.from(`${JSON.stringify(value)}\n`);

/** Atomically persists and independently verifies a lossless compiler handoff. */
export async function writePreviewTsxCorpusSpool(
  root: string, identity: PreviewTsxCorpusSpoolIdentity, bundle: PreviewBundle, request: PreviewBuildRequest, absoluteDeadlineEpochMs: number,
): Promise<PreviewTsxCorpusSpoolDescriptor> {
  const shared = await persistSharedVendorChunks(root, bundle);
  const encoded = serialize({ bundle: shared.bundle, identity, request, schema: PREVIEW_TSX_CORPUS_PIPELINE_SCHEMA } satisfies Envelope);
  // Detect unsupported values before a render worker ever sees the handoff.
  const roundTrip = deserialize(encoded) as Envelope;
  if (roundTrip.schema !== 12 || !isDeepStrictEqual(roundTrip.bundle, shared.bundle)) {
    throw new Error('PreviewBundle failed exact v8 spool round trip.');
  }
  const directory = path.join(root, 'spool', identity.engineDigest, identity.policyDigest, identity.candidate);
  await mkdir(directory, { recursive: true });
  const stem = `${identity.row.toString().padStart(4, '0')}-${identity.attemptId}`;
  const spoolPath = path.join(directory, `${stem}.v8`);
  const temporary = `${spoolPath}.${randomUUID()}.tmp`;
  await writeFile(temporary, encoded, { flag: 'wx' });
  await rename(temporary, spoolPath);
  const committed = await readFile(spoolPath);
  if (!committed.equals(encoded)) throw new Error(`Spool atomic verification failed: ${spoolPath}`);
  const bare = { ...identity, absoluteDeadlineEpochMs, bundleBytes: committed.byteLength, bundleSha256: digest(committed), compiledAtEpochMs: Date.now(), schema: 12 as const, sharedChunks: shared.descriptors, spoolPath };
  const descriptor = { ...bare, descriptorSha256: digest(descriptorBytes(bare)) };
  const descriptorPath = `${spoolPath}.descriptor.json`;
  const descriptorTemporary = `${descriptorPath}.${randomUUID()}.tmp`;
  await writeFile(descriptorTemporary, `${JSON.stringify(descriptor)}\n`, { flag: 'wx' });
  await rename(descriptorTemporary, descriptorPath);
  return verifyPreviewTsxCorpusSpool(descriptor, identity);
}

/** Validates identity, byte length, checksums, then and only then deserializes. */
export async function readPreviewTsxCorpusSpool(descriptor: PreviewTsxCorpusSpoolDescriptor, expected: PreviewTsxCorpusSpoolIdentity): Promise<Envelope> {
  const verified = await readVerifiedPreviewTsxCorpusSpool(descriptor, expected);
  if (Date.now() > verified.descriptor.absoluteDeadlineEpochMs) throw new Error('Row deadline expired while waiting in the render queue.');
  const value = deserialize(verified.spoolBytes) as Envelope;
  if (value.schema !== 12 || JSON.stringify(value.identity) !== JSON.stringify(expected)) throw new Error('Spool envelope identity mismatch.');
  return { ...value, bundle: restoreSharedVendorChunks(value.bundle, verified.sharedChunks) };
}

export async function verifyPreviewTsxCorpusSpool(descriptor: PreviewTsxCorpusSpoolDescriptor, expected: PreviewTsxCorpusSpoolIdentity): Promise<PreviewTsxCorpusSpoolDescriptor> {
  return (await readVerifiedPreviewTsxCorpusSpool(descriptor, expected)).descriptor;
}

async function readVerifiedPreviewTsxCorpusSpool(
  descriptor: PreviewTsxCorpusSpoolDescriptor,
  expected: PreviewTsxCorpusSpoolIdentity,
): Promise<VerifiedPreviewTsxCorpusSpoolRead> {
  if (descriptor.schema !== 12 || JSON.stringify(pickIdentity(descriptor)) !== JSON.stringify(expected)) throw new Error('Spool descriptor identity mismatch.');
  const { descriptorSha256: _descriptorSha256, ...bare } = descriptor;
  if (digest(descriptorBytes(bare)) !== descriptor.descriptorSha256) throw new Error('Spool descriptor checksum mismatch.');
  const metadata = await stat(descriptor.spoolPath);
  const spoolBytes = await readFile(descriptor.spoolPath);
  if (metadata.size !== descriptor.bundleBytes || spoolBytes.byteLength !== descriptor.bundleBytes || digest(spoolBytes) !== descriptor.bundleSha256) throw new Error('Spool bundle checksum or length mismatch.');
  const sharedChunks = await Promise.all(descriptor.sharedChunks.map(readVerifiedSharedVendorChunk));
  return { descriptor, sharedChunks, spoolBytes };
}

export async function removePreviewTsxCorpusSpool(descriptor: PreviewTsxCorpusSpoolDescriptor): Promise<void> {
  await Promise.all([rm(descriptor.spoolPath, { force: false }), rm(`${descriptor.spoolPath}.descriptor.json`, { force: false })]);
}

function pickIdentity(value: PreviewTsxCorpusSpoolIdentity): PreviewTsxCorpusSpoolIdentity {
  const { attemptId, campaignId, candidate, engineDigest, generationId, laneId, policyDigest, row, sourceDigest } = value;
  return { attemptId, campaignId, candidate, engineDigest, generationId, laneId, policyDigest, row, sourceDigest };
}

async function persistSharedVendorChunks(
  root: string,
  bundle: PreviewBundle,
): Promise<{
  readonly bundle: PreviewBundle;
  readonly descriptors: readonly PreviewTsxCorpusSharedChunkDescriptor[];
}> {
  const directory = path.join(root, 'shared-vendor');
  const descriptors: PreviewTsxCorpusSharedChunkDescriptor[] = [];
  const retained = [];
  for (const [index, chunk] of bundle.chunks.entries()) {
    if (!chunk.relativePath.startsWith('chunks/vendor/')) {
      retained.push(chunk);
      continue;
    }
    const sha256 = digest(chunk.contents);
    const sharedPath = path.join(directory, `${sha256}.chunk`);
    await persistSharedVendorChunk(sharedPath, chunk.contents, sha256);
    descriptors.push({
      bytes: chunk.contents.byteLength,
      index,
      path: sharedPath,
      relativePath: chunk.relativePath,
      sha256,
    });
  }
  if (descriptors.length === 0) return { bundle, descriptors };
  return { bundle: { ...bundle, chunks: retained }, descriptors };
}

async function persistSharedVendorChunk(
  sharedPath: string,
  contents: Uint8Array,
  sha256: string,
): Promise<void> {
  await mkdir(path.dirname(sharedPath), { recursive: true });
  try {
    const existing = await readFile(sharedPath);
    if (existing.byteLength !== contents.byteLength || digest(existing) !== sha256) {
      throw new Error(`Shared vendor chunk identity collision: ${sharedPath}`);
    }
    return;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
  }
  const temporary = `${sharedPath}.${randomUUID()}.tmp`;
  await writeFile(temporary, contents, { flag: 'wx' });
  await rename(temporary, sharedPath);
  const committed = await readFile(sharedPath);
  if (committed.byteLength !== contents.byteLength || digest(committed) !== sha256) {
    throw new Error(`Shared vendor chunk atomic verification failed: ${sharedPath}`);
  }
}

async function readVerifiedSharedVendorChunk(
  descriptor: PreviewTsxCorpusSharedChunkDescriptor,
): Promise<VerifiedPreviewTsxCorpusSharedChunk> {
  const bytes = await readFile(descriptor.path);
  if (bytes.byteLength !== descriptor.bytes || digest(bytes) !== descriptor.sha256) {
    throw new Error(`Shared vendor chunk checksum or length mismatch: ${descriptor.path}`);
  }
  return { bytes, descriptor };
}

function restoreSharedVendorChunks(
  bundle: PreviewBundle,
  sharedChunks: readonly VerifiedPreviewTsxCorpusSharedChunk[],
): PreviewBundle {
  if (sharedChunks.length === 0) return bundle;
  const chunkCount = bundle.chunks.length + sharedChunks.length;
  const chunks = new Array<PreviewBundle['chunks'][number] | undefined>(chunkCount);
  for (const { bytes, descriptor } of sharedChunks) {
    if (descriptor.index < 0 || descriptor.index >= chunkCount || chunks[descriptor.index] !== undefined) {
      throw new Error('Shared vendor chunk index is invalid or duplicated.');
    }
    chunks[descriptor.index] = {
      contents: new Uint8Array(bytes),
      relativePath: descriptor.relativePath,
    };
  }
  let retainedIndex = 0;
  for (let index = 0; index < chunks.length; index += 1) {
    if (chunks[index] !== undefined) continue;
    const retained = bundle.chunks[retainedIndex++];
    if (retained === undefined) throw new Error('Shared vendor chunk restoration underflowed.');
    chunks[index] = retained;
  }
  if (retainedIndex !== bundle.chunks.length) throw new Error('Shared vendor chunk restoration overflowed.');
  return { ...bundle, chunks: chunks as PreviewBundle['chunks'] };
}
