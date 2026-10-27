/**
 * Reconstructs the missing executor's evidence contract without starting any child or service.
 * Imports are side-effect free. Unknown historical hashes remain null and fail admission; callers
 * can bind a new, explicitly reconstructed fixture to actual bytes through createExecutorContract.
 */
import { createHash } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../', import.meta.url)).replace(/\/$/u, '');
const parent = '/private/tmp/rtcc-preview-v4-3.0ESvAAhF';
const node = '/Users/lky/.nvm/versions/node/v22.22.2/bin/node';
const productionSha256 = '40f68936746ed9ff7818cbf52fa1eb3f5e981084a4641964a470058c35eeac97';
const hash = (bytes) => createHash('sha256').update(bytes).digest('hex');
const hex = (value) => typeof value === 'string' && /^[a-f0-9]{64}$/u.test(value);
const exact = (value, keys) =>
  value !== null &&
  typeof value === 'object' &&
  !Array.isArray(value) &&
  JSON.stringify(Object.keys(value)) === JSON.stringify(keys);
const requireCondition = (condition, code) => {
  if (!condition) throw new Error(code);
};

export const PATHS = Object.freeze({
  workingDirectory: root,
  plan: root + '/.plan/rtcc-preview-v5.5.33.md',
  v5532Plan: root + '/.plan/rtcc-preview-v5.5.32.md',
  routePatternSource: root + '/src/adapters/esbuild/inspector/previewInspectorRoutePattern.ts',
  routePatternTest: root + '/test/adapters/esbuild/inspector/previewInspectorRoutePattern.test.ts',
  productionManifest: root + '/.plan/launchers/rtcc-v5.5.33-production-SHA256SUMS',
  canonical: root + '/.plan/launchers/rtcc-v5.5.33-canonical-argv.json',
  executor: fileURLToPath(import.meta.url),
  executorTest: root + '/test/scripts/rtccV4ExecutorContract.test.ts',
  validator: root + '/scripts/validate-rtcc-preview-complete-route-profile-v4.mjs',
  validatorTest: root + '/test/scripts/validateRtccPreviewCompleteRouteProfileV4.test.ts',
  cliSource: root + '/src/adapters/node/previewCompleteRouteInventoryProfileCli.ts',
  launcher: root + '/scripts/profile-preview-complete-route-inventory.mjs',
  sourceManifest: root + '/.plan/snapshots/rtcc-reconstructed-source-manifest.json',
  dependencyView: root + '/.plan/snapshots/rtcc-reconstructed-dependency-view.json',
  snapshotArchive: root + '/.plan/snapshots/rtcc-reconstructed-source.tar',
  v5531Gate: root + '/.plan/launchers/rtcc-v5.5.31-validator-gate.json',
  v5531Sums: root + '/.plan/launchers/rtcc-v5.5.31-SHA256SUMS',
  frozenAuthorityRoot: parent + '/profile-v5-5-30-a',
  frozenAuthorityTrace: parent + '/profile-v5-5-30-a/profile.jsonl',
  existingParent: parent,
  profileRoot: parent + '/profile-v5-5-33-a',
  trace: parent + '/profile-v5-5-33-a/profile.jsonl',
  preflight: root + '/.plan/launchers/rtcc-v5.5.33-profile-preflight.json',
  attempt: root + '/.plan/launchers/rtcc-v5.5.33-execution-attempt-start.json',
  terminal: root + '/.plan/launchers/rtcc-v5.5.33-execution-terminal-evidence.json',
  profileValidation: root + '/.plan/launchers/rtcc-v5.5.33-profile-validation.json',
  runEvidence: root + '/.plan/launchers/rtcc-v5.5.33-validator-run-evidence.json',
});

/** @type {Readonly<Record<'planSha256' | 'productionManifestSha256' | 'routePatternTestSha256' | 'sourceManifestRawSha256' | 'dependencyViewRawSha256' | 'snapshotArchiveSha256' | 'v5531GateSha256' | 'v5531SumsSha256' | 'frozenAuthoritySha256', string | null>>} */
export const BINDINGS = Object.freeze({
  planSha256: 'b3e35302ccd9af62959ab405f4229042ba29378d7d8af1a9fb94c5c3114a27cb',
  productionManifestSha256: productionSha256,
  routePatternTestSha256: null,
  sourceManifestRawSha256: null,
  dependencyViewRawSha256: null,
  snapshotArchiveSha256: null,
  v5531GateSha256: null,
  v5531SumsSha256: null,
  frozenAuthoritySha256: 'a0688f1201c1d4d4eace2a9e6176f8e48d85daf32a8179e535e51caf1b720cbb',
});

/** @type {Readonly<{byteCount: number, lineCount: number}>} */
export const FROZEN_AUTHORITY_IDENTITY = Object.freeze({
  byteCount: 6037478,
  lineCount: 1530,
});

export const EXPECTED_ARGUMENT_VECTOR = Object.freeze([
  node,
  PATHS.launcher,
  '--profile-root',
  PATHS.profileRoot,
  '--workspace',
  root + '/.plan/snapshots/source',
  '--target',
  root + '/.plan/snapshots/source/root.tsx',
  '--source-root',
  root + '/.plan/snapshots/source',
  '--production-aggregate',
  productionSha256,
  '--source-manifest-digest',
  '6ff4218223f36aa0e79238320ea27063bb3ac60de00d6d8e92b1863c48bb803a',
  '--dependency-view-digest',
  'e72d1ee18d1fbb4aa5d3870fdad38222dcb24d83646840f6ac22f61a7f6fab86',
  '--confinement-policy-digest',
  '3d298017221f509418878fe98353c1137c86c5f0a53b35dc3f0cbe97f6de53a8',
  '--approved-dependency-root',
  root + '/node_modules',
  '--tsconfig',
  root + '/.plan/snapshots/source/tsconfig.json',
]);

const zeroState = Object.freeze({
  matchingProcessCount: 0,
  profileRootAbsent: true,
  traceAbsent: true,
  attemptStartAbsent: true,
  terminalEvidenceAbsent: true,
  profileValidationAbsent: true,
  validatorEvidenceAbsent: true,
  dryRunProfileSpawnApiInvocationCount: 0,
  dryRunFilesystemWriteCount: 0,
});

/**
 * @typedef {object} ExecutorContractOptions
 * @property {typeof PATHS} [paths] Exact source, snapshot, and reserved output filenames.
 * @property {typeof BINDINGS} [bindings] Recorded hashes; null historical values prevent admission.
 * @property {readonly string[]} [argumentVector] Exact 22-token materialization vector.
 * @property {{byteCount: number, lineCount: number}} [frozenAuthorityIdentity] Exact trace size.
 * @property {(path: string) => Buffer} [read] Reads raw input bytes without writing.
 * @property {(path: string) => boolean} [exists] Checks reserved output absence.
 */

/**
 * Binds evidence construction and schema checks to exact caller-supplied identities.
 * Reads are injectable for isolated tests. No function writes files, inspects processes, or spawns.
 * @param {ExecutorContractOptions} [options] Fixed identities and read-only filesystem ports.
 */
export function createExecutorContract({
  paths = PATHS,
  bindings = BINDINGS,
  argumentVector = EXPECTED_ARGUMENT_VECTOR,
  frozenAuthorityIdentity = FROZEN_AUTHORITY_IDENTITY,
  read = readFileSync,
  exists = existsSync,
} = {}) {
  const identityPaths = {
    plan: paths.plan,
    v5532Plan: paths.v5532Plan,
    routePatternSource: paths.routePatternSource,
    routePatternTest: paths.routePatternTest,
    productionManifest: paths.productionManifest,
    canonical: paths.canonical,
    executor: paths.executor,
    executorTest: paths.executorTest,
    validator: paths.validator,
    validatorTest: paths.validatorTest,
    node: argumentVector[0],
    launcher: argumentVector[1],
    cliSource: paths.cliSource,
  };
  const snapshot = {
    sourceManifest: {
      path: paths.sourceManifest,
      rawSha256: bindings.sourceManifestRawSha256,
      digest: argumentVector[13],
      fileCount: 11724,
    },
    dependencyView: {
      path: paths.dependencyView,
      rawSha256: bindings.dependencyViewRawSha256,
      digest: argumentVector[15],
      confinementPolicyDigest: argumentVector[17],
      approvedDependencyRoots: [argumentVector[19]],
      linkCount: 1848,
    },
    archive: { path: paths.snapshotArchive, sha256: bindings.snapshotArchiveSha256 },
  };
  const frozenLineage = {
    gate: { path: paths.v5531Gate, sha256: bindings.v5531GateSha256, bindingCount: 21 },
    sums: { path: paths.v5531Sums, sha256: bindings.v5531SumsSha256, resultCount: 5 },
    authorityRoot: {
      path: paths.frozenAuthorityRoot,
      realpath: paths.frozenAuthorityRoot,
      type: 'directory',
      symlink: false,
      entries: ['profile.jsonl'],
    },
    authorityTrace: {
      path: paths.frozenAuthorityTrace,
      realpath: paths.frozenAuthorityTrace,
      type: 'regular-file',
      symlink: false,
      sha256: bindings.frozenAuthoritySha256,
      byteCount: frozenAuthorityIdentity.byteCount,
      lineCount: frozenAuthorityIdentity.lineCount,
      finalLf: true,
    },
  };
  const invocation = {
    workingDirectory: paths.workingDirectory,
    argumentCount: 22,
    argumentVector: [...argumentVector],
    profileRoot: paths.profileRoot,
    executionPolicy: { exactOnce: true, shell: false, externalTimeout: false, retry: false },
    directRootPolicy: {
      existingParent: paths.existingParent,
      launcherCreatesRootNonrecursively: true,
      executorCreatesRoot: false,
      secondRootUsed: false,
    },
  };
  /** Builds prospective facts only after exact zero-state and frozen-lineage checks succeed. */
  function buildProspectivePreflightFacts(state, executorSha256) {
    requireCondition(
      Object.values(bindings).every(hex),
      'executor-historical-bindings-unavailable',
    );
    requireCondition(hex(executorSha256), 'executor-source-identity-invalid');
    requireCondition(
      argumentVector.length === 22 &&
        state?.state?.profileRoot?.exists === false &&
        state?.state?.trace?.exists === false &&
        state?.state?.processInspection?.exactMatchingCount === 0 &&
        JSON.stringify(state?.frozenLineage?.authority?.root) ===
          JSON.stringify(frozenLineage.authorityRoot) &&
        JSON.stringify(state?.frozenLineage?.authority?.trace) ===
          JSON.stringify(frozenLineage.authorityTrace),
      'executor-prospective-state-invalid',
    );
    for (const path of [paths.attempt, paths.terminal, paths.profileValidation, paths.runEvidence])
      requireCondition(!exists(path), 'executor-reserved-output-exists');
    const identities = Object.fromEntries(
      Object.entries(identityPaths).map(([name, path]) => [
        name,
        { path, sha256: hash(read(path)) },
      ]),
    );
    requireCondition(
      identities.executor.sha256 === executorSha256,
      'executor-source-identity-drift',
    );
    for (const [name, binding] of [
      ['plan', 'planSha256'],
      ['routePatternTest', 'routePatternTestSha256'],
      ['productionManifest', 'productionManifestSha256'],
    ])
      requireCondition(
        identities[name].sha256 === bindings[binding],
        'executor-identity-binding-drift:' + name,
      );
    for (const [path, binding] of [
      [paths.sourceManifest, 'sourceManifestRawSha256'],
      [paths.dependencyView, 'dependencyViewRawSha256'],
      [paths.snapshotArchive, 'snapshotArchiveSha256'],
      [paths.v5531Gate, 'v5531GateSha256'],
      [paths.v5531Sums, 'v5531SumsSha256'],
      [paths.frozenAuthorityTrace, 'frozenAuthoritySha256'],
    ])
      requireCondition(
        hash(read(path)) === bindings[binding],
        'executor-input-binding-drift:' + binding,
      );
    return {
      identities,
      snapshot: structuredClone(snapshot),
      frozenLineage: structuredClone(frozenLineage),
      invocation: structuredClone(invocation),
      observedZeroState: { ...zeroState },
    };
  }
  /** Rejects omitted, reordered, extra, or mismatched reviewed-preflight fields before admission. */
  function assertReviewedPreflightSchema(value) {
    const reviewedAt = value?.solReview?.recordedAt;
    const canonicalDate =
      typeof reviewedAt === 'string' &&
      !Number.isNaN(Date.parse(reviewedAt)) &&
      new Date(reviewedAt).toISOString() === reviewedAt;
    const valid =
      exact(value, [
        'schemaVersion',
        'kind',
        'release',
        'solReview',
        'identities',
        'snapshot',
        'frozenLineage',
        'invocation',
        'observedZeroState',
      ]) &&
      value.schemaVersion === 1 &&
      value.kind === 'rtcc-preview-reviewed-profile-preflight' &&
      value.release === 'v5.5.33' &&
      exact(value.solReview, ['status', 'recordedAt']) &&
      value.solReview.status === 'PASS' &&
      canonicalDate &&
      exact(value.identities, Object.keys(identityPaths)) &&
      Object.entries(identityPaths).every(
        ([name, path]) =>
          exact(value.identities[name], ['path', 'sha256']) &&
          value.identities[name].path === path &&
          hex(value.identities[name].sha256),
      ) &&
      Object.values(bindings).every(hex) &&
      JSON.stringify(value.snapshot) === JSON.stringify(snapshot) &&
      JSON.stringify(value.frozenLineage) === JSON.stringify(frozenLineage) &&
      JSON.stringify(value.invocation) === JSON.stringify(invocation) &&
      JSON.stringify(value.observedZeroState) === JSON.stringify(zeroState);
    requireCondition(valid, 'reviewed-preflight-schema-drift');
    return true;
  }
  return {
    PATHS: paths,
    BINDINGS: bindings,
    EXPECTED_ARGUMENT_VECTOR: argumentVector,
    FROZEN_AUTHORITY_IDENTITY: frozenAuthorityIdentity,
    buildProspectivePreflightFacts,
    assertReviewedPreflightSchema,
  };
}

const defaultContract = createExecutorContract();
export const buildProspectivePreflightFacts = defaultContract.buildProspectivePreflightFacts;
export const assertReviewedPreflightSchema = defaultContract.assertReviewedPreflightSchema;
