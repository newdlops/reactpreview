/** Atomic, checksummed persistence primitives for the v7 corpus protocol. */
import { createHash, randomUUID } from 'node:crypto';
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import path from 'node:path';

export interface PreviewTsxCorpusArtifactReference {
  readonly bytes: number;
  readonly sha256: string;
}

export function previewTsxCorpusDigest(value: string | Uint8Array): string {
  return createHash('sha256').update(value).digest('hex');
}

/** Writes a complete artifact through an exclusive sibling file and verifies its bytes after rename. */
export async function writePreviewTsxCorpusArtifactAtomic(
  filePath: string,
  value: Uint8Array,
): Promise<PreviewTsxCorpusArtifactReference> {
  await mkdir(path.dirname(filePath), { recursive: true });
  const temporaryPath = `${filePath}.${randomUUID()}.tmp`;
  await writeFile(temporaryPath, value, { flag: 'wx' });
  await rename(temporaryPath, filePath);
  const committed = await readFile(filePath);
  const reference = { bytes: committed.byteLength, sha256: previewTsxCorpusDigest(committed) };
  if (reference.bytes !== value.byteLength || reference.sha256 !== previewTsxCorpusDigest(value)) {
    throw new Error(`Atomic corpus artifact verification failed: ${filePath}`);
  }
  return reference;
}

export async function writePreviewTsxCorpusJsonAtomic(
  filePath: string,
  value: unknown,
): Promise<PreviewTsxCorpusArtifactReference> {
  return writePreviewTsxCorpusArtifactAtomic(
    filePath,
    Buffer.from(`${JSON.stringify(value, undefined, 2)}\n`),
  );
}

/** Verifies an atomic JSON artifact against its separately persisted checksum. */
export async function readPreviewTsxCorpusChecksummedJson<T>(
  filePath: string,
): Promise<T> {
  const [value, checksum] = await Promise.all([
    readFile(filePath),
    readFile(`${filePath}.checksum.json`, 'utf8'),
  ]);
  const expected = JSON.parse(checksum) as PreviewTsxCorpusArtifactReference;
  const actual = { bytes: value.byteLength, sha256: previewTsxCorpusDigest(value) };
  if (expected.bytes !== actual.bytes || expected.sha256 !== actual.sha256) {
    throw new Error(`Checksummed corpus artifact verification failed: ${filePath}`);
  }
  return JSON.parse(value.toString('utf8')) as T;
}
