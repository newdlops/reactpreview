/** Owns fixed RTCC v4 authority identities and primitive evidence predicates. */
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import {
  BINDINGS as EXECUTOR_BINDINGS,
  PATHS as EXECUTOR_PATHS,
} from './rtcc-v4-executor-contract.mjs';

export const ROOT = '/Users/lky/project/reactpreview';

export const NODE_PATH = '/Users/lky/.nvm/versions/node/v22.22.2/bin/node';

export const VALIDATOR_PATH = `${ROOT}/scripts/validate-rtcc-preview-complete-route-profile-v4.mjs`;

export const AUTHORITY_PATH =
  '/private/tmp/rtcc-preview-v4-3.0ESvAAhF/profile-v5-5-33-a/profile.jsonl';

export const PREFLIGHT_PATH = `${ROOT}/.plan/launchers/rtcc-v5.5.33-profile-preflight.json`;

export const ATTEMPT_PATH = `${ROOT}/.plan/launchers/rtcc-v5.5.33-execution-attempt-start.json`;

export const TERMINAL_PATH = `${ROOT}/.plan/launchers/rtcc-v5.5.33-execution-terminal-evidence.json`;

export const PROFILE_VALIDATION_PATH = `${ROOT}/.plan/launchers/rtcc-v5.5.33-profile-validation.json`;

export const RUN_EVIDENCE_PATH = `${ROOT}/.plan/launchers/rtcc-v5.5.33-validator-run-evidence.json`;

export const REFERENCE_PATH = `${ROOT}/.plan/launchers/rtcc-v5.5.31-semantic-report.json`;

export const PRODUCTION_MANIFEST_PATH = `${ROOT}/.plan/launchers/rtcc-v5.5.33-production-SHA256SUMS`;

export const PLAN_SHA256 = 'b3e35302ccd9af62959ab405f4229042ba29378d7d8af1a9fb94c5c3114a27cb';

export const PRODUCTION_SHA256 = '40f68936746ed9ff7818cbf52fa1eb3f5e981084a4641964a470058c35eeac97';

export const REFERENCE_SHA256 = 'b5a7796195eaa60d0c7cee142d84b2eec9475424d34cec1bfe48570749aef322';

export const REFERENCE_BLOCKERS_SHA256 =
  '15a087c139953a277c8f36bbc016b1baaa226006d05d80cfd87fa0e9d220c4c8';

export const AUTHORITY_POLICY = Object.freeze({
  structural: {
    lineCount: 1530,
    progressCount: 1528,
    executionCount: 1496,
    bundleCount: 68,
    checkpoints: [1, 64, 128, 256, 512, 681],
    requiredOrdinals: [...Array(64).keys()]
      .map((number) => number + 1)
      .concat([128, 256, 512, 681]),
    phaseOrder: ['prepare', 'enumerate', 'replay', 'execution', 'finalize'],
    header: {
      schemaVersion: 1,
      telemetryPolicyVersion: 4,
      isolationPolicyVersion: 3,
      maximumEvents: 1664,
      probeCapMs: 300000,
      productionAggregate: PRODUCTION_SHA256,
      sourceManifestDigest: '6ff4218223f36aa0e79238320ea27063bb3ac60de00d6d8e92b1863c48bb803a',
      dependencyViewDigest: 'e72d1ee18d1fbb4aa5d3870fdad38222dcb24d83646840f6ac22f61a7f6fab86',
      confinementPolicyDigest: '3d298017221f509418878fe98353c1137c86c5f0a53b35dc3f0cbe97f6de53a8',
      isolationPolicyDigest: 'a88baf7521baffa65f4f7c6257ce53e3372422b623f05eef31ba506e1ca2c66d',
      telemetryPolicyDigest: '5d49da6914ca52b9dd41d0117cf1e2be1434636395a9db7e0afbeb0c50ee338f',
    },
    bundleKeys: [
      'diagnosticsVersion',
      'bundleMeasuredMicros',
      'frontierCount',
      'rawSourceReadCount',
      'rawSourceReadMicros',
      'inventoryReadRequestCount',
      'inventoryReadPathCacheHitCount',
      'sliceRequestCount',
      'sliceComputationCount',
      'sliceHitCount',
      'sliceLookupMicros',
      'inventoryRequestCount',
      'inventoryComputationCount',
      'inventoryHitCount',
      'inventoryLookupMicros',
      'queueIterationCount',
      'queuePeakLength',
      'queueSortCount',
      'queueSortMicros',
      'edgeVisitCount',
      'optionalClosureProbeCount',
      'optionalClosureMicros',
      'resolveModuleCount',
      'resolveModuleMicros',
      'authoredPathCheckCount',
      'authoredPathCheckMicros',
      'frontierFinalizeMicros',
      'frontierIdentityMicros',
      'candidateSelectionSortCount',
      'candidateSelectionMicros',
    ],
  },
  inventory: {
    analysisCount: 725,
    replayCount: 730,
    total: 746,
    runnable: 681,
    duplicate: 47,
    unresolved: 18,
    maximumAnalysisPasses: 4096,
    maximumBranches: 8192,
    maximumDepth: 64,
    replayPolicyDigest: '274a9aecd52944871f1a88940416e3a2e485490d8d287f0e0235a635c7e89601',
    executionPlanPolicyDigest: 'e0aa9adf1c3c766fb629e7048ef9ee949eeef49a7522e2ede0889d0ced58eb6e',
    mountFallbackEvidenceDigest: 'd17d8781254638a9e879ece557268d55e155c634694ffbaf6fb03eaf9687f3e7',
  },
});

export const V4_PATHS = Object.freeze({
  authority: AUTHORITY_PATH,
  preflight: PREFLIGHT_PATH,
  attempt: ATTEMPT_PATH,
  terminal: TERMINAL_PATH,
  profileValidation: PROFILE_VALIDATION_PATH,
  runEvidence: RUN_EVIDENCE_PATH,
  reference: REFERENCE_PATH,
});

export const sha256 = (value) => createHash('sha256').update(value).digest('hex');

export const canonicalBytes = (value) => Buffer.from(`${JSON.stringify(value, null, 2)}\n`, 'utf8');

export const exact = (value, keys) =>
  value !== null &&
  typeof value === 'object' &&
  !Array.isArray(value) &&
  JSON.stringify(Object.keys(value)) === JSON.stringify(keys);

export const hex = (value) => typeof value === 'string' && /^[a-f0-9]{64}$/u.test(value);

export function assertCondition(condition, code) {
  if (!condition) throw new Error(code);
}

export const canonicalIso = (value) => {
  if (typeof value !== 'string') return false;
  try {
    return new Date(value).toISOString() === value;
  } catch {
    return false;
  }
};

export const regularIdentity = (path, raw) => ({
  path,
  sha256: sha256(raw),
  byteCount: raw.length,
});

export const expectedExecutorHashBindings = (read = readFileSync) => ({
  ...EXECUTOR_BINDINGS,
  executorSha256: sha256(read(EXECUTOR_PATHS.executor)),
});

export const EXPECTED_ZERO_STATE = Object.freeze({
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

export const EXPECTED_PROHIBITED = Object.freeze({
  retryPerformed: false,
  externalTimeoutUsed: false,
  killTimerUsed: false,
  shellWrapperUsed: false,
  secondRootUsed: false,
  rootDeletedOrReused: false,
  recursiveWorkaroundUsed: false,
  executorCreatedRoot: false,
  browserExecuted: false,
  chromiumExecuted: false,
  serverExecuted: false,
  campaignExecuted: false,
});

export const PROCESS_KEYS = [
  'method',
  'shell',
  'processInspectionApiInvocationCount',
  'candidateCount',
  'excludedSelfCount',
  'exactMatchingCount',
  'matchedPids',
];

export const ABSENT_PATH_KEYS = ['path', 'exists', 'lstatErrorCode'];

export const EXISTING_PARENT_KEYS = ['path', 'realpath', 'type', 'exists', 'symlink'];
