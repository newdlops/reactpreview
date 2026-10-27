/**
 * Supplies real-hash virtual inputs for the reconstructed V4 evidence contract.
 * No historical or reserved official artifact is created on disk by this fixture.
 */
import { createHash } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import { evaluateRouteSemantics } from '../../scripts/validation/rtcc-v3-route-semantics.mjs';
import { parseJsonl } from '../../scripts/validation/rtcc-v3-structural-telemetry.mjs';
import { getReconstructedArchive } from './rtccReconstructedArchive';

type ExecutorModule = typeof import('../../scripts/rtcc-v4-executor-contract.mjs');
type V3PolicyModule = typeof import('../../scripts/validation/rtcc-v3-official-policy.mjs');

/** Exact virtual byte set and its bound executor contract, scoped to one test module graph. */
interface V4ReconstructedArchive {
  /** Side-effect-free contract bound to the actual virtual input bytes. */
  readonly contract: ReturnType<ExecutorModule['createExecutorContract']>;
  /** Read-only byte map including the explicit reference report. */
  readonly files: ReadonlyMap<string, Buffer>;
  /** Canonical reference report SHA-256. */
  readonly referenceSha256: string;
  /** Ordered blocker identity used by compact validation. */
  readonly blockersSha256: string;
  /** Reconstructed mount policy identity. */
  readonly mountFallbackEvidenceDigest: string;
}

const hash = (value: string | Buffer): string => createHash('sha256').update(value).digest('hex');
let archive: V4ReconstructedArchive | undefined;

/** Initializes the fixture using actual production modules supplied by scoped test factories. */
export function getV4ReconstructedArchive(
  executor?: ExecutorModule,
  originalPolicy?: V3PolicyModule,
): V4ReconstructedArchive {
  if (archive !== undefined) return archive;
  if (executor === undefined || originalPolicy === undefined)
    throw new Error('Reconstructed V4 archive was not configured.');
  const base = getReconstructedArchive(originalPolicy);
  const files = new Map(base.files);
  const paths = { ...executor.PATHS };
  const vector = executor.EXPECTED_ARGUMENT_VECTOR.map(String);
  /** Copies a real maintained source or supplies clearly named virtual fixture bytes. */
  const ensure = (path: string): Buffer => {
    const existing = files.get(path);
    if (existing !== undefined) return existing;
    const bytes = existsSync(path)
      ? readFileSync(path)
      : Buffer.from('Reconstructed V4 unit input: ' + path + '\n');
    files.set(path, bytes);
    return bytes;
  };
  for (const path of Object.values(paths)) {
    if (
      path !== paths.workingDirectory &&
      path !== paths.existingParent &&
      path !== paths.profileRoot &&
      path !== paths.frozenAuthorityRoot &&
      ![
        paths.preflight,
        paths.attempt,
        paths.terminal,
        paths.profileValidation,
        paths.runEvidence,
        paths.trace,
      ].includes(path)
    )
      ensure(path);
  }
  const manifest =
    Array.from({ length: 36 }, (_, index) => {
      const path = paths.workingDirectory + '/.plan/reconstructed-fixtures/v4-' + String(index);
      const bytes = Buffer.from('Reconstructed V4 production input ' + String(index) + '\n');
      files.set(path, bytes);
      return hash(bytes) + '  ' + path.slice(paths.workingDirectory.length + 1);
    }).join('\n') + '\n';
  files.set(paths.productionManifest, Buffer.from(manifest));
  const bindings = {
    planSha256: hash(ensure(paths.plan)),
    productionManifestSha256: hash(manifest),
    routePatternTestSha256: hash(ensure(paths.routePatternTest)),
    sourceManifestRawSha256: hash(ensure(paths.sourceManifest)),
    dependencyViewRawSha256: hash(ensure(paths.dependencyView)),
    snapshotArchiveSha256: hash(ensure(paths.snapshotArchive)),
    v5531GateSha256: hash(ensure(paths.v5531Gate)),
    v5531SumsSha256: hash(ensure(paths.v5531Sums)),
    frozenAuthoritySha256: hash(base.authorityBytes),
  };
  vector[11] = bindings.productionManifestSha256;
  const frozenAuthorityIdentity = {
    byteCount: Buffer.byteLength(base.authorityBytes),
    lineCount: 1530,
  };
  const nodePath = vector[0];
  if (nodePath === undefined) throw new Error('Missing reconstructed Node identity.');
  ensure(nodePath);
  const records = parseJsonl(base.authorityBytes) as unknown[];
  const terminal = records.at(-1) as { inventory: { entries: unknown[] } };
  const semantic = evaluateRouteSemantics(terminal.inventory.entries);
  const referenceBytes = Buffer.from(
    JSON.stringify(
      {
        kind: 'semantic-report',
        semanticResult: 'fail',
        releaseResult: 'no-go',
        blockers: semantic.blockers,
      },
      null,
      2,
    ) + '\n',
  );
  files.set(
    paths.workingDirectory + '/.plan/launchers/rtcc-v5.5.31-semantic-report.json',
    referenceBytes,
  );
  const contract = executor.createExecutorContract({
    paths,
    bindings,
    argumentVector: vector,
    frozenAuthorityIdentity,
    read: (path) => Buffer.from(files.get(path) ?? readFileSync(path)),
    exists: existsSync,
  });
  const reconstructed: V4ReconstructedArchive = {
    contract,
    files,
    referenceSha256: hash(referenceBytes),
    blockersSha256: hash(JSON.stringify(semantic.blockers)),
    mountFallbackEvidenceDigest:
      base.policyExports.authorityPolicy.inventory.mountFallbackEvidenceDigest,
  };
  archive = reconstructed;
  return reconstructed;
}

/** Reads simulated inputs or real temporary output artifacts without populating historical paths. */
export function readV4ReconstructedFile(path: string): Buffer;
export function readV4ReconstructedFile(path: string, encoding: BufferEncoding): string;
export function readV4ReconstructedFile(path: string, encoding?: BufferEncoding): string | Buffer;
export function readV4ReconstructedFile(path: string, encoding?: BufferEncoding): string | Buffer {
  const bytes = getV4ReconstructedArchive().files.get(path) ?? readFileSync(path);
  return encoding === undefined ? Buffer.from(bytes) : bytes.toString(encoding);
}
