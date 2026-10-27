/**
 * Supplies an in-memory, explicitly reconstructed archive for official-validator unit tests.
 * Every identity is the real hash of the bytes supplied here. Missing historical hashes and
 * Sol review evidence are never manufactured on disk or accepted by the production CLI.
 */
import { createHash } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { createReconstructedAuthority } from './rtccReconstructedAuthority';

type PolicyModule = typeof import('../../scripts/validation/rtcc-v3-official-policy.mjs');
type ReconstructedPolicy = Omit<
  PolicyModule,
  'authoritySha256Fixed' | 'authorityBytesFixed' | 'productionManifestSha256'
> & {
  authoritySha256Fixed: string;
  authorityBytesFixed: number;
  productionManifestSha256: string;
};
type PredecessorSpec = [name: string, path: string, sha256: string, json: boolean];

const hash = (value: string | Buffer): string => createHash('sha256').update(value).digest('hex');
const canonicalBytes = (value: unknown): Buffer =>
  Buffer.from(JSON.stringify(value, null, 2) + '\n');

/** One isolated data set shared by unit cases within their Vitest worker. */
interface ReconstructedArchive {
  /** Virtual input bytes indexed by absolute paths; no archive files are written. */
  readonly files: ReadonlyMap<string, Buffer>;
  /** Regenerated trace bytes used by the original positive and negative cases. */
  readonly authorityBytes: string;
  /** Actual regenerated trace identity. */
  readonly authoritySha256: string;
  /** Original contract with only fixture identities rebound to these new bytes. */
  readonly policyExports: ReconstructedPolicy;
}

let archive: ReconstructedArchive | undefined;

/** Builds an empty stream identity in the order expected by predecessor validation. */
const emptyStream = (): { byteCount: number; sha256: string; base64: string } => ({
  byteCount: 0,
  sha256: hash(''),
  base64: '',
});

/** Recreates predecessor payloads as test inputs, with hash-linked attempt and trace identities. */
function predecessorValues(
  original: PolicyModule,
  authorityBytes: string,
  authoritySha256: string,
  productionSha256: string,
): Record<string, unknown> {
  const vector = Array.from(
    { length: 22 },
    (_, index) => 'reconstructed-argument-' + String(index),
  );
  vector[0] = original.nodePath;
  vector[1] = resolve(original.root, 'scripts/profile-preview-complete-route-inventory.mjs');
  const attempt = {
    schemaVersion: 1,
    kind: 'rtcc-preview-execution-attempt-start',
    release: 'v5.5.30',
    complete: true,
    timestamp: '2026-08-01T00:00:00.000Z',
    processId: 42,
    command: {
      workingDirectory: original.root,
      argumentVector: [original.nodePath, '.plan/reconstructed-executor.mjs', '--execute'],
    },
    hashBindings: { productionManifestSha256: productionSha256 },
    directRootContract: { executorCreatedRoot: false },
    authorizationConsumed: true,
    profileSpawnApiInvocationCount: 0,
    launcherExecuted: false,
  };
  const terminal = {
    schemaVersion: 1,
    kind: 'rtcc-preview-execution-terminal-evidence',
    release: 'v5.5.30',
    complete: true,
    result: 'audit-required',
    hashBindings: { productionManifestSha256: productionSha256 },
    attemptStartIdentity: { sha256: hash(canonicalBytes(attempt)) },
    directRootContract: { executorCreatedRoot: false },
    materialization: { authorizedChildMaterialized: true, argumentVector: vector },
    execution: {
      validationFailure: null,
      profileSpawnApiInvocationCount: 1,
      launcherExecuted: true,
      profileExecuted: true,
      telemetryProduced: true,
      authorityRunCandidate: true,
      authorityPass: false,
      retryCount: 0,
      shell: false,
      externalTimeout: null,
      exitCode: 0,
      signal: null,
      closeObserved: true,
      synchronousSpawnThrow: false,
      durationNanoseconds: '25',
      events: [{ type: 'spawn' }, { type: 'exit' }, { type: 'close' }],
    },
    streams: {
      separated: true,
      stdout: emptyStream(),
      stderr: emptyStream(),
      taggedCallbackOrder: [],
    },
    preState: { profileRoot: { exists: false }, trace: { exists: false } },
    postStateResult: {
      status: 'fulfilled',
      value: { profileRoot: { exists: true }, trace: { exists: true } },
    },
    traceResult: {
      status: 'fulfilled',
      value: {
        present: true,
        headerPresent: true,
        byteCount: Buffer.byteLength(authorityBytes),
        lineCount: 1530,
        sha256: authoritySha256,
      },
    },
    postChildInspectionFailure: false,
    prohibitedActions: Object.fromEntries(
      original.predecessorProhibitedKeys.map((key) => [key, false]),
    ),
    audit: { completeMarkerPresent: true, strict681AuditPerformed: false },
  };
  return {
    canonicalArgv: {
      schemaVersion: 1,
      kind: 'rtcc-preview-canonical-argv',
      release: 'v5.5.30',
      workingDirectory: original.root,
      argumentCount: vector.length,
      argumentVector: vector,
      profileRoot: '/virtual/reconstructed/profile',
      productionAggregate: productionSha256,
      executionPolicy: { exactOnce: true, shell: false, retry: false },
    },
    attempt,
    terminal,
    gateProbe: {
      schemaVersion: 1,
      kind: 'reconstructed-gate-probe',
      result: 'pass',
    },
    preflight: {
      schemaVersion: 1,
      kind: 'reconstructed-preflight',
      decision: { preflightPassed: true, terminal: true },
    },
    lineage: {
      schemaVersion: 1,
      kind: 'reconstructed-lineage',
      predecessor: { release: 'reconstructed-fixture' },
      decision: { preflightPassed: true, terminal: true },
    },
  };
}

/** Initializes only from the real module supplied by a scoped test mock, never production input. */
export function getReconstructedArchive(original?: PolicyModule): ReconstructedArchive {
  if (archive !== undefined) return archive;
  if (original === undefined) throw new Error('Reconstructed archive was not configured.');
  const files = new Map<string, Buffer>();
  const put = (path: string, bytes: Buffer): void => {
    files.set(resolve(original.root, path), bytes);
  };
  const productionEntries = Array.from({ length: 35 }, (_, index) => {
    const path = '.plan/reconstructed-fixtures/production-' + String(index) + '.txt';
    const bytes = Buffer.from('Reconstructed production fixture ' + String(index) + '\n');
    put(path, bytes);
    return hash(bytes) + '  ' + path;
  });
  const productionBytes = Buffer.from(productionEntries.join('\n') + '\n');
  const productionSha256 = hash(productionBytes);
  put(original.productionManifestPath, productionBytes);
  const fixture = createReconstructedAuthority(original.authorityPolicy);
  (fixture.records[0] as Record<string, unknown>).productionAggregate = productionSha256;
  const authorityBytes = fixture.records.map((record) => JSON.stringify(record)).join('\n') + '\n';
  const authoritySha256 = hash(authorityBytes);
  put(original.authorityPathFixed, Buffer.from(authorityBytes));
  const predecessors = predecessorValues(
    original,
    authorityBytes,
    authoritySha256,
    productionSha256,
  );
  const predecessorSpecs = (original.predecessorSpecs as PredecessorSpec[]).map(
    ([name, path, , json]): PredecessorSpec => {
      const bytes = json
        ? canonicalBytes(predecessors[name])
        : Buffer.from('Reconstructed test input: ' + path + '\n');
      put(path, bytes);
      return [name, path, hash(bytes), json];
    },
  );
  for (const path of original.boundFiles as string[]) {
    const absolute = resolve(original.root, path);
    if (files.has(absolute)) continue;
    put(
      path,
      existsSync(absolute)
        ? readFileSync(absolute)
        : Buffer.from('Reconstructed test input: ' + path + '\n'),
    );
  }
  const authorityPolicy = {
    ...original.authorityPolicy,
    structural: {
      ...original.authorityPolicy.structural,
      header: {
        ...original.authorityPolicy.structural.header,
        productionAggregate: productionSha256,
      },
    },
    inventory: {
      ...original.authorityPolicy.inventory,
      mountFallbackEvidenceDigest: String(fixture.policy.inventory.mountFallbackEvidenceDigest),
    },
  };
  const reconstructed: ReconstructedArchive = {
    files,
    authorityBytes,
    authoritySha256,
    policyExports: {
      ...original,
      authorityPolicy,
      authoritySha256Fixed: authoritySha256,
      authorityBytesFixed: Buffer.byteLength(authorityBytes),
      productionManifestSha256: productionSha256,
      predecessorSpecs,
    },
  };
  archive = reconstructed;
  return reconstructed;
}

/** Reads virtual fixture bytes while preserving normal reads of real temporary output artifacts. */
export function readReconstructedFile(path: string): Buffer;
export function readReconstructedFile(path: string, encoding: BufferEncoding): string;
export function readReconstructedFile(path: string, encoding?: BufferEncoding): string | Buffer;
export function readReconstructedFile(path: string, encoding?: BufferEncoding): string | Buffer {
  const bytes = getReconstructedArchive().files.get(resolve(path)) ?? readFileSync(path);
  return encoding === undefined ? Buffer.from(bytes) : bytes.toString(encoding);
}
