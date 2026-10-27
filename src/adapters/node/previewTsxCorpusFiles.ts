/** Reads checksummed records and writes campaign ledgers and summary artifacts. */
import { createHash } from 'node:crypto';
import { appendFile, mkdir, readFile, stat } from 'node:fs/promises';
import path from 'node:path';
import {
  writePreviewTsxCorpusArtifactAtomic,
  writePreviewTsxCorpusJsonAtomic,
} from './previewHeadlessTsxCorpusCampaignArtifacts';
import {
  type PreviewTsxCorpusAttemptKind,
  type PreviewTsxCorpusAttemptRecord,
  type PreviewTsxCorpusCanonicalRecord,
  type PreviewTsxCorpusCategory,
  type PreviewTsxCorpusCompilerEvent,
  type PreviewTsxCorpusDiagnosticEvent,
  type PreviewTsxCorpusManifestRow,
  type PreviewTsxCorpusRowOwnershipEvent,
  type PreviewTsxCorpusStageEvent,
  type PreviewTsxCorpusWorkerLifecycleEvent,
  type PreviewTsxCorpusWorkerResult,
} from './previewHeadlessTsxCorpusCampaignTypes';
import { isValidRowOwnershipEvent, type CampaignState } from './previewTsxCorpusModel';

/** Persists captured worker streams and returns their exact byte counts and digests for the attempt record. */
export async function writeRawEvidence(
  artifacts: string,
  index: number,
  attemptKind: PreviewTsxCorpusAttemptKind,
  stdout: Buffer,
  stderr: Buffer,
  stages: Buffer,
): Promise<PreviewTsxCorpusAttemptRecord['raw']> {
  const directory = path.join(artifacts, 'raw', pad(index));
  await mkdir(directory, { recursive: true });
  await Promise.all([
    writeBufferAtomic(path.join(directory, `${attemptKind}.stdout`), stdout),
    writeBufferAtomic(path.join(directory, `${attemptKind}.stderr`), stderr),
    writeBufferAtomic(path.join(directory, `${attemptKind}.stages.jsonl`), stages),
  ]);
  return {
    stages: { bytes: stages.byteLength, sha256: digest(stages) },
    stderr: { bytes: stderr.byteLength, sha256: digest(stderr) },
    stdout: { bytes: stdout.byteLength, sha256: digest(stdout) },
  };
}

/** Parses bounded stage telemetry into ordered diagnostic history while retaining malformed transport evidence. */
export function parseDiagnosticHistory(
  source: Buffer,
  row: PreviewTsxCorpusManifestRow,
  index: number,
): {
  readonly compilerProgress: readonly PreviewTsxCorpusCompilerEvent[];
  readonly ownership: readonly PreviewTsxCorpusRowOwnershipEvent[];
  readonly stageHistory: readonly PreviewTsxCorpusStageEvent[];
  readonly valid: boolean;
  readonly workerLifecycle: readonly PreviewTsxCorpusWorkerLifecycleEvent[];
} {
  const compilerProgress: PreviewTsxCorpusCompilerEvent[] = [];
  const ownership: PreviewTsxCorpusRowOwnershipEvent[] = [];
  const stageHistory: PreviewTsxCorpusStageEvent[] = [];
  const workerLifecycle: PreviewTsxCorpusWorkerLifecycleEvent[] = [];
  const lines = source.toString('utf8').split('\n').filter(Boolean);
  if (lines.length > 512) {
    return { compilerProgress, ownership, stageHistory, valid: false, workerLifecycle };
  }
  for (const line of lines) {
    try {
      const transportValue: unknown = JSON.parse(line);
      if (
        typeof transportValue !== 'object' ||
        transportValue === null ||
        !('version' in transportValue) ||
        transportValue.version !== 3 ||
        !('kind' in transportValue) ||
        typeof transportValue.kind !== 'string' ||
        !['target-stage', 'compiler-progress', 'worker-lifecycle', 'row-ownership'].includes(
          transportValue.kind,
        )
      ) {
        return { compilerProgress, ownership, stageHistory, valid: false, workerLifecycle };
      }
      const event = transportValue as PreviewTsxCorpusDiagnosticEvent;
      if (event.index !== index || event.path !== row.path) {
        return { compilerProgress, ownership, stageHistory, valid: false, workerLifecycle };
      }
      if (event.kind === 'target-stage') stageHistory.push(event);
      else if (event.kind === 'compiler-progress') compilerProgress.push(event);
      else if (event.kind === 'worker-lifecycle') workerLifecycle.push(event);
      else {
        if (!isValidRowOwnershipEvent(event)) {
          return { compilerProgress, ownership, stageHistory, valid: false, workerLifecycle };
        }
        ownership.push(event);
      }
    } catch {
      return { compilerProgress, ownership, stageHistory, valid: false, workerLifecycle };
    }
  }
  return { compilerProgress, ownership, stageHistory, valid: true, workerLifecycle };
}

/** Reads the worker's terminal result record and rejects unusable or mismatched result payloads. */
export function parseWorkerResult(
  source: Buffer,
  row: PreviewTsxCorpusManifestRow,
  index: number,
  sourceRoot: string,
): PreviewTsxCorpusWorkerResult | undefined {
  const lines = source.toString('utf8').trim().split('\n').filter(Boolean);
  if (lines.length !== 1) return undefined;
  try {
    const transportValue: unknown = JSON.parse(lines[0] ?? '');
    if (
      typeof transportValue !== 'object' ||
      transportValue === null ||
      !('version' in transportValue) ||
      transportValue.version !== 3
    )
      return undefined;
    const result = transportValue as PreviewTsxCorpusWorkerResult;
    const expectedPath = path.resolve(sourceRoot, row.path);
    if (
      result.index !== index ||
      result.path !== row.path ||
      path.resolve(result.documentPath) !== expectedPath
    ) {
      return undefined;
    }
    return result;
  } catch {
    return undefined;
  }
}

/** Parses frozen manifest rows and validates their required source identities before dispatch. */
export function parseManifest(source: string): readonly PreviewTsxCorpusManifestRow[] {
  const rows = source
    .trimEnd()
    .split('\n')
    .map((line) => JSON.parse(line) as PreviewTsxCorpusManifestRow);
  if (rows.length === 0) throw new Error('Corpus manifest is empty.');
  const paths = rows.map((row) => row.path);
  const sorted = [...paths].sort();
  if (
    new Set(paths).size !== paths.length ||
    paths.some((value, index) => value !== sorted[index])
  ) {
    throw new Error('Corpus manifest paths must be unique and sorted.');
  }
  return rows;
}

/** Checks whether an existing row record matches this campaign's exact canonical identity. */
export async function canonicalExists(state: CampaignState, index: number): Promise<boolean> {
  const recordPath = canonicalRecordPath(state, index);
  const record = await readJsonIfPresent<PreviewTsxCorpusCanonicalRecord>(recordPath);
  if (record === undefined) return false;
  const row = state.rows[index];
  if (
    row === undefined ||
    record.index !== index ||
    record.path !== row.path ||
    record.sha256 !== row.sha256 ||
    record.manifestSha256 !== state.identity.manifestSha256 ||
    record.engineDigest !== state.identity.engineDigest ||
    record.classifierDigest !== state.identity.classifierDigest ||
    record.policyDigest !== state.identity.policyDigest ||
    !Number.isSafeInteger(record.committedAtEpochMs)
  ) {
    throw new Error(`Canonical identity mismatch at manifest index ${index.toString()}.`);
  }
  if (state.options.maxRows === undefined) {
    await ledgerRecord(state, recordPath, 'canonical', index);
  }
  return true;
}

/** Commits available staged rows in manifest order without skipping a missing predecessor. */
export async function commitStagedCanonicals(state: CampaignState, limit: number): Promise<void> {
  const staged: {
    readonly index: number;
    readonly record: PreviewTsxCorpusCanonicalRecord;
  }[] = [];
  for (let index = 0; index < limit; index += 1) {
    const record = await readJsonIfPresent<PreviewTsxCorpusCanonicalRecord>(
      path.join(state.options.artifacts, 'canonical-staging', `${pad(index)}.json`),
    );
    if (record === undefined) {
      throw new Error(
        `Gate cannot promote with missing canonical candidate at index ${index.toString()}.`,
      );
    }
    staged.push({ index, record });
  }
  for (const candidate of staged) {
    const recordPath = path.join(
      state.options.artifacts,
      'canonical',
      `${pad(candidate.index)}.json`,
    );
    if (!(await fileExists(recordPath))) await writeJsonAtomic(recordPath, candidate.record);
    await ledgerRecord(state, recordPath, 'canonical', candidate.index);
  }
}

/** Returns the deterministic campaign-owned canonical record filename for a manifest index. */
export function canonicalRecordPath(state: CampaignState, index: number): string {
  return path.join(
    state.options.artifacts,
    state.options.maxRows === undefined ? 'canonical' : 'canonical-staging',
    `${pad(index)}.json`,
  );
}

/** Rebuilds the aggregate row summary from durable canonical evidence up to the requested limit. */
export async function writeSummary(state: CampaignState, limit: number): Promise<void> {
  const totals: Record<PreviewTsxCorpusCategory, number> = {
    Unrendered: 0,
    'blank/empty output': 0,
    blocker: 0,
    'explicitly structurally non-renderable': 0,
    'incomplete page composition': 0,
    'runtime/build failure': 0,
    'successful meaningful render': 0,
  };
  let canonical = 0;
  let isolatedAttempts = 0;
  let primaryAttempts = 0;
  for (let index = 0; index < limit; index += 1) {
    const record = await readJsonIfPresent<PreviewTsxCorpusCanonicalRecord>(
      path.join(state.options.artifacts, 'canonical', `${pad(index)}.json`),
    );
    if (record !== undefined) {
      canonical += 1;
      totals[record.category] += 1;
    }
    if (
      await fileExists(path.join(state.options.artifacts, 'attempts', pad(index), 'primary.json'))
    ) {
      primaryAttempts += 1;
    }
    if (
      await fileExists(path.join(state.options.artifacts, 'attempts', pad(index), 'isolated.json'))
    ) {
      isolatedAttempts += 1;
    }
  }
  await writeJsonAtomic(path.join(state.options.artifacts, 'summary.json'), {
    canonical,
    isolatedAttempts,
    limit,
    pending: limit - canonical,
    policyDigest: state.identity.policyDigest,
    primaryAttempts,
    totals,
    version: 1,
  });
}

/** Appends one deduplicated campaign ledger record and updates the in-memory digest set after persistence. */
export async function ledgerRecord(
  state: CampaignState,
  recordPath: string,
  kind: 'attempt' | 'canonical',
  index: number,
  attemptKind?: PreviewTsxCorpusAttemptKind,
): Promise<void> {
  const operation = state.ledgerWriteChain.then(async () => {
    const source = await readFile(recordPath);
    const recordSha256 = digest(source);
    if (state.ledgerDigests.has(recordSha256)) return;
    await appendFile(
      path.join(state.options.artifacts, 'ledger.jsonl'),
      `${JSON.stringify({ attemptKind, index, kind, recordSha256, version: 1 })}\n`,
    );
    state.ledgerDigests.add(recordSha256);
  });
  state.ledgerWriteChain = operation.then(
    () => undefined,
    () => undefined,
  );
  await operation;
}

/** Loads committed ledger digests so resuming a campaign cannot append duplicate evidence. */
export async function readLedgerDigests(filePath: string): Promise<Set<string>> {
  try {
    const source = await readFile(filePath, 'utf8');
    return new Set(
      source
        .split('\n')
        .filter(Boolean)
        .map((line) => (JSON.parse(line) as { readonly recordSha256: string }).recordSha256),
    );
  } catch (error) {
    if (isMissing(error)) return new Set();
    throw error;
  }
}

/** Reads a JSON artifact when present; missing files return undefined and other I/O failures propagate. */
export async function readJsonIfPresent<T>(filePath: string): Promise<T | undefined> {
  try {
    return JSON.parse(await readFile(filePath, 'utf8')) as T;
  } catch (error) {
    if (isMissing(error)) return undefined;
    throw error;
  }
}

/** Serializes campaign data and commits it through the shared verified atomic JSON writer. */
export async function writeJsonAtomic(filePath: string, value: unknown): Promise<void> {
  await writePreviewTsxCorpusJsonAtomic(filePath, value);
}

/** Commits exact binary artifact bytes through the shared atomic writer. */
export async function writeBufferAtomic(filePath: string, value: Buffer): Promise<void> {
  await writePreviewTsxCorpusArtifactAtomic(filePath, value);
}

/** Checks path existence while propagating filesystem failures other than a missing path. */
export async function fileExists(filePath: string): Promise<boolean> {
  try {
    await stat(filePath);
    return true;
  } catch (error) {
    if (isMissing(error)) return false;
    throw error;
  }
}

/** Checks whether an existing campaign directory contains prior artifacts before initialization. */
export async function directoryHasEntries(directoryPath: string): Promise<boolean> {
  try {
    const { readdir } = await import('node:fs/promises');
    return (await readdir(directoryPath)).length > 0;
  } catch (error) {
    if (isMissing(error)) return false;
    throw error;
  }
}

/** Recognizes the filesystem missing-path error without classifying other I/O failures as absence. */
export function isMissing(error: unknown): boolean {
  return error instanceof Error && 'code' in error && error.code === 'ENOENT';
}

/** Formats manifest indices with stable leading zeroes for deterministic artifact filenames. */
export function pad(index: number): string {
  return index.toString().padStart(6, '0');
}

/** Returns a hexadecimal SHA-256 for exact UTF-8 text or captured binary evidence. */
export function digest(value: string | Buffer): string {
  return createHash('sha256').update(value).digest('hex');
}

/** Hashes the canonical JSON representation used for campaign identity and artifact comparisons. */
export function digestJson(value: unknown): string {
  return digest(JSON.stringify(value));
}
