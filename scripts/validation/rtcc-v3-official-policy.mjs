/** Owns immutable authority identities, ordered gate bindings, and primitive official-evidence predicates. */
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

export const sha256 = (value) => createHash('sha256').update(value).digest('hex');

export const canonical = (value) => `${JSON.stringify(value, null, 2)}\n`;

export const exact = (value, keys) =>
  value &&
  typeof value === 'object' &&
  !Array.isArray(value) &&
  Object.keys(value).join('\0') === keys.join('\0');

export const hex = (value) => typeof value === 'string' && /^[a-f0-9]{64}$/.test(value);

export const noPlaceholder = (value) =>
  typeof value === 'string'
    ? !/<[^>]+>/.test(value)
    : Array.isArray(value)
      ? value.every(noPlaceholder)
      : value && typeof value === 'object'
        ? Object.values(value).every(noPlaceholder)
        : true;

export const root = '/Users/lky/project/reactpreview';

export const nodePath = '/Users/lky/.nvm/versions/node/v22.22.2/bin/node';

export const validatorRelative = 'scripts/validate-rtcc-preview-complete-route-profile-v3.mjs';

export const authorityPathFixed =
  '/private/tmp/rtcc-preview-v4-3.0ESvAAhF/profile-v5-5-30-a/profile.jsonl';

export const authoritySha256Fixed =
  'a0688f1201c1d4d4eace2a9e6176f8e48d85daf32a8179e535e51caf1b720cbb';

export const authorityBytesFixed = 6037478;

export const gateRelative = '.plan/launchers/rtcc-v5.5.31-validator-gate.json';

export const productionManifestPath = '.plan/launchers/rtcc-v5.5.25-production-SHA256SUMS';

export const productionManifestSha256 =
  'ac1344e8c36f436a5d3e8f5e83dc9bb8dfd649a7255a38d5577c9ee2dd87b5a8';

export const authorityPolicy = {
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
      productionAggregate: productionManifestSha256,
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
};

export const outputRelative = [
  '.plan/launchers/rtcc-v5.5.31-profile-validation.json',
  '.plan/launchers/rtcc-v5.5.31-semantic-report.json',
  '.plan/launchers/rtcc-v5.5.31-v5.5.30-semantic-failure-lineage.json',
  '.plan/launchers/rtcc-v5.5.31-validator-run-evidence.json',
  '.plan/launchers/rtcc-v5.5.31-artifact-manifest.json',
  '.plan/launchers/rtcc-v5.5.31-SHA256SUMS',
];

export const planFiles = [
  '.plan/rtcc-preview-v5.5.31.md',
  '.plan/rtcc-preview-v5.5.31-amendment-1.md',
  '.plan/rtcc-preview-v5.5.31-amendment-2.md',
  '.plan/rtcc-preview-v5.5.31-amendment-3.md',
];

export const predecessorSpecs = [
  [
    'plan',
    '.plan/rtcc-preview-v5.5.30.md',
    '42d80cb4ea462dace3e36fef68b32f9f08800e6cc41e1eb7fc0ceba265022186',
    false,
  ],
  [
    'canonicalArgv',
    '.plan/launchers/rtcc-v5.5.30-canonical-argv.json',
    'd95409756a9f2dcf6f679e698f4a6a02e29441c5326a69b789214ad55a1167f6',
    true,
  ],
  [
    'executor',
    '.plan/launchers/rtcc-v5.5.30-exact-once-executor.mjs',
    '604c180b698e6c7cd1a2ca97a59904e902bf67596e3595406bf1a542f2b3d88b',
    false,
  ],
  [
    'executorTest',
    '.plan/launchers/rtcc-v5.5.30-exact-once-executor.test.mjs',
    '8323e84601a0be5ba0e5e66b01d54d1fb57f1cef2824cdfca6fc09db6c778411',
    false,
  ],
  [
    'attempt',
    '.plan/launchers/rtcc-v5.5.30-execution-attempt-start.json',
    'a5c4795329456df958e6e5a3f14800bfff71b3e02f05ea5b4a130841b2b2e24a',
    true,
  ],
  [
    'terminal',
    '.plan/launchers/rtcc-v5.5.30-execution-terminal-evidence.json',
    '7dec93dd874baf220334a07fe9875241f27e78a0201ff7bce6817df5211d4268',
    true,
  ],
  [
    'gateProbe',
    '.plan/launchers/rtcc-v5.5.30-executor-gate-probe.json',
    'f35d26e5d4fbce8ded1b082333285dbc083d246be606f38724c10a049db01938',
    true,
  ],
  [
    'preflight',
    '.plan/launchers/rtcc-v5.5.30-profile-preflight.json',
    'dc3caf80dac93383c04babb32d6cb74d47e250b88a52734046840acdc3f7ae7b',
    true,
  ],
  [
    'lineage',
    '.plan/launchers/rtcc-v5.5.30-v5.5.29-external-failure-lineage.json',
    '2adefb03906944166c10d93c520831c8cf76f50dbc1d4eed859e8599134b40d4',
    true,
  ],
];

export const predecessorKeys = ['complete', ...predecessorSpecs.map(([key]) => key)];

export const boundFiles = [
  ...planFiles,
  validatorRelative,
  'scripts/validation/rtcc-v3-structural-telemetry.mjs',
  'scripts/validation/rtcc-v3-inventory-execution-plan.mjs',
  'scripts/validation/rtcc-v3-route-semantics.mjs',
  'scripts/validation/rtcc-v3-official-artifacts.mjs',
  'scripts/validation/rtcc-v3-official-policy.mjs',
  'scripts/validation/rtcc-v3-predecessor-evidence.mjs',
  'test/support/rtccV3Fixture.ts',
  'test/support/rtccV3Mutation.ts',
  'test/scripts/validateRtccPreviewCompleteRouteProfileV3.test.ts',
  'test/scripts/validateRtccPreviewCompleteRouteProfileV3Fixtures.ts',
  'test/scripts/rtccV3SchemaFixtureTypes.ts',
  'test/scripts/rtccV3ArtifactMutationTypes.ts',
  'test/scripts/validateRtccPreviewCompleteRouteProfileV3.semantics.test.ts',
  'test/scripts/validateRtccPreviewCompleteRouteProfileV3.boundaries.test.ts',
  'test/scripts/validateRtccPreviewCompleteRouteProfileV3.inventory.test.ts',
  'test/scripts/validateRtccPreviewCompleteRouteProfileV3.officialAdmission.test.ts',
  'test/scripts/validateRtccPreviewCompleteRouteProfileV3.payloads.test.ts',
  'test/scripts/validateRtccPreviewCompleteRouteProfileV3.schemas.test.ts',
  ...predecessorSpecs.map(([, path]) => path),
  productionManifestPath,
];

export const commandPrefix = ['--official-v5.5.31', '--gate', gateRelative, '--gate-sha256'];

export const finalArgumentRelation = 'final argument equals SHA-256 of raw gate bytes';

export const prohibitedKeys = [
  'spawn',
  'retry',
  'external',
  'browser',
  'chromium',
  'server',
  'campaign',
  'timeout',
  'newRoot',
  'profileRetry',
];

export const predecessorProhibitedKeys = [
  'retryPerformed',
  'externalTimeoutUsed',
  'killTimerUsed',
  'shellWrapperUsed',
  'secondRootUsed',
  'rootDeletedOrReused',
  'recursiveWorkaroundUsed',
  'executorCreatedRoot',
  'browserExecuted',
  'chromiumExecuted',
  'serverExecuted',
  'campaignExecuted',
];

export const hashFile = (cwd, file, read = readFileSync) => sha256(read(resolve(cwd, file)));

export const confined = (cwd, file) =>
  !file.startsWith('/') &&
  !file.split('/').includes('..') &&
  resolve(cwd, file).startsWith(`${resolve(cwd)}/`);

export const falseActions = () => Object.fromEntries(prohibitedKeys.map((key) => [key, false]));

export const validActions = (value) =>
  exact(value, prohibitedKeys) && prohibitedKeys.every((key) => value[key] === false);

export const binding = (value) =>
  exact(value, ['path', 'sha256']) && typeof value.path === 'string' && hex(value.sha256);

export const orderedViolations = (value) =>
  Array.isArray(value) &&
  value.length === 31 &&
  value.every(
    (item, index) =>
      exact(item, ['inventoryIndex', 'tokenOffset', 'code', 'id', 'nonSplat']) &&
      Number.isSafeInteger(item.inventoryIndex) &&
      Number.isSafeInteger(item.tokenOffset) &&
      item.code === 'pathname-pattern-mismatch' &&
      typeof item.id === 'string' &&
      typeof item.nonSplat === 'boolean' &&
      (index === 0 ||
        value[index - 1].inventoryIndex < item.inventoryIndex ||
        (value[index - 1].inventoryIndex === item.inventoryIndex &&
          (value[index - 1].tokenOffset < item.tokenOffset ||
            (value[index - 1].tokenOffset === item.tokenOffset &&
              value[index - 1].code <= item.code)))),
  ) &&
  value.filter((item) => item.nonSplat).length === 30;

export const orderedBlockers = (value) =>
  Array.isArray(value) &&
  value.length === 18 &&
  value.every(
    (item, index) =>
      exact(item, ['inventoryIndex', 'id', 'reason']) &&
      Number.isSafeInteger(item.inventoryIndex) &&
      typeof item.id === 'string' &&
      typeof item.reason === 'string' &&
      (index === 0 || value[index - 1].inventoryIndex <= item.inventoryIndex),
  );

export const rtccV3BoundFiles = [...boundFiles];

export const rtccV3OutputFiles = [...outputRelative];
