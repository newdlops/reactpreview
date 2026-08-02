#!/usr/bin/env node
/** Validates the sole frozen v5.5.24 complete-route profile without executing project code. */
import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { access, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const CONTRACT_NAMES = Object.freeze([
  'authority-file-identity',
  'record-cardinality',
  'record-wrapper-schema-and-key-order',
  'header-contract',
  'progress-record-schema-and-key-order',
  'progress-sequence-and-version',
  'phase-transition-domain',
  'pre-execution-envelope-order',
  'enumeration-checkpoint-order',
  'enumeration-terminal-counts',
  'enumeration-prefix-equations',
  'replay-checkpoint-order',
  'replay-terminal-counts',
  'replay-prefix-equations',
  'execution-sampled-ordinals',
  'execution-phase-order',
  'execution-counter-semantics',
  'execution-total-consistency',
  'bundle-payload-placement-and-count',
  'bundle-diagnostic-schema-and-key-order',
  'bundle-diagnostic-equations-and-physical-meaning',
  'terminal-partial-failure',
  'cleanup-no-retry-and-false-completion',
  'v5524-production-aggregate',
]);

export const BUNDLE_DIAGNOSTIC_KEYS = Object.freeze([
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
]);

const HEADER_KEYS = Object.freeze([
  'confinementPolicyDigest',
  'dependencyViewDigest',
  'isolationPolicyDigest',
  'isolationPolicyVersion',
  'kind',
  'maximumEvents',
  'noRetry',
  'probeCapMs',
  'productionAggregate',
  'schemaVersion',
  'sourceManifestDigest',
  'telemetryPolicyDigest',
  'telemetryPolicyVersion',
]);
const TERMINAL_KEYS = Object.freeze([
  'cleanupConfirmed',
  'eventCount',
  'finalSequence',
  'kind',
  'lastCounters',
  'lastPhase',
  'noRetry',
  'schemaVersion',
  'failureCode',
  'status',
]);
const PROGRESS_KEYS = Object.freeze(['event', 'kind', 'schemaVersion']);
const COMMON_EVENT_KEYS = Object.freeze([
  'transition',
  'cpuSystemMicros',
  'cpuUserMicros',
  'elapsedMs',
  'heapUsedBytes',
  'rssBytes',
  'sequence',
  'version',
]);
const SIMPLE_EVENT_KEYS = Object.freeze(['phase', ...COMMON_EVENT_KEYS]);
const ENUMERATION_EVENT_KEYS = Object.freeze([
  'analysisPasses',
  'discoveredBranches',
  'enumerationPrefixComputationCount',
  'enumerationPrefixEntryCount',
  'enumerationPrefixHitCount',
  'enumerationPrefixRequestCount',
  'phase',
  'queuedSelections',
  ...COMMON_EVENT_KEYS,
]);
const REPLAY_EVENT_KEYS = Object.freeze([
  'phase',
  'replayPrefixComputationCount',
  'replayPrefixEntryCount',
  'replayPrefixHitCount',
  'replayPrefixRequestCount',
  'replayCompleted',
  'replayTotal',
  ...COMMON_EVENT_KEYS,
]);
const EXECUTION_EVENT_KEYS = Object.freeze([
  'executionPlanCompleted',
  'executionPlanTotal',
  'routeOrdinal',
  'phase',
  ...COMMON_EVENT_KEYS,
]);
const BUNDLE_EVENT_KEYS = Object.freeze([
  'executionPlanCompleted',
  'executionPlanTotal',
  'routeOrdinal',
  'bundleDiagnostics',
  'phase',
  ...COMMON_EVENT_KEYS,
]);
const EXECUTION_PHASES = Object.freeze([
  'execution-shared-context',
  'execution-route-usage',
  'execution-frontier-style',
  'execution-frontier-globals',
  'execution-frontier-plan',
  'execution-frontier-candidates',
  'execution-frontier-bundle',
  'execution-frontier-ownership',
  'execution-frontier-target-contract',
  'execution-frontier-root-contract',
  'execution-frontier-artifact',
]);
const EXECUTION_SEQUENCE = Object.freeze([
  ['execution-shared-context', 'start'],
  ['execution-shared-context', 'complete'],
  ['execution-route-usage', 'start'],
  ['execution-route-usage', 'complete'],
  ['execution-frontier-style', 'start'],
  ['execution-frontier-style', 'complete'],
  ['execution-frontier-globals', 'start'],
  ['execution-frontier-globals', 'complete'],
  ['execution-frontier-plan', 'start'],
  ['execution-frontier-candidates', 'start'],
  ['execution-frontier-candidates', 'complete'],
  ['execution-frontier-bundle', 'start'],
  ['execution-frontier-bundle', 'complete'],
  ['execution-frontier-ownership', 'start'],
  ['execution-frontier-ownership', 'complete'],
  ['execution-frontier-target-contract', 'start'],
  ['execution-frontier-target-contract', 'complete'],
  ['execution-frontier-root-contract', 'start'],
  ['execution-frontier-root-contract', 'complete'],
  ['execution-frontier-artifact', 'start'],
  ['execution-frontier-artifact', 'complete'],
  ['execution-frontier-plan', 'complete'],
]);
const CHECKPOINTS_ENUMERATION = Object.freeze([1, 2, 4, 8, 16, 32, 64, 128, 256, 512, 725]);
const CHECKPOINTS_REPLAY = Object.freeze([1, 2, 4, 8, 16, 32, 64, 128, 256, 512, 730]);
const SAMPLED_ORDINALS = Object.freeze([
  ...Array.from({ length: 64 }, (_, index) => index + 1),
  128,
  256,
]);
const EXPECTED_PROGRESS_COUNT = 1482;
const EXPECTED_CHECK_COUNT = 1506;
const AUTHORITY_SHA256 = 'dfb8aad757909f843e368fb8ce73a72ed112144ad12d5b4e5546ad3ab92f88e4';
const AUTHORITY_PATH = '/private/tmp/rtcc-preview-v4-3.0ESvAAhF/profile-v5-5-23-a/profile.jsonl';
const AUTHORITY_PRODUCTION_AGGREGATE =
  '39e813eae9f6d4efaabff943a622a23102544a45aae6b692b5161e06ef2e2ed0';
const BASE_PLAN_SHA256 = '47c0a980be5f4754a970ee686258871f0feda9045257a2daa40416f1868472ac';
const AMENDMENT_SHA256 = 'fc4d65cfcc3a3871e9b7bad38eb0651a9a6a0d7a242ac99b747e425ff0d34414';
const REPOSITORY_ROOT = '/Users/lky/project/reactpreview';
const SCRIPT_PATH = fileURLToPath(import.meta.url);
const TEST_PATH = 'test/scripts/validateRtccPreviewCompleteRouteProfile.test.ts';

const sha256 = (value) => createHash('sha256').update(value).digest('hex');
const isRecord = (value) => value !== null && typeof value === 'object' && !Array.isArray(value);
const isSafeCount = (value) => Number.isSafeInteger(value) && value >= 0;
const hasKeys = (value, keys) =>
  isRecord(value) && JSON.stringify(Object.keys(value)) === JSON.stringify(keys);
const isDigest = (value) => typeof value === 'string' && /^[0-9a-f]{64}$/u.test(value);
const pair = (event) => `${String(event?.phase)}:${String(event?.transition)}`;

function parseJsonl(profileBytes) {
  const text = profileBytes.toString('utf8');
  const terminalNewline = text.endsWith('\n');
  const lines = terminalNewline ? text.slice(0, -1).split('\n') : text.split('\n');
  const nonempty = lines.every((line) => line.length > 0);
  const records = lines.map((line) => {
    try {
      return JSON.parse(line);
    } catch {
      return undefined;
    }
  });
  return { lines, nonempty, records, terminalNewline };
}

function expectedEventKeys(event) {
  if (!isRecord(event)) return undefined;
  if (event.phase === 'enumerate-branches') return ENUMERATION_EVENT_KEYS;
  if (event.phase === 'replay-branches') return REPLAY_EVENT_KEYS;
  if (typeof event.phase === 'string' && event.phase.startsWith('execution-'))
    return event.phase === 'execution-frontier-bundle' && event.transition === 'complete'
      ? BUNDLE_EVENT_KEYS
      : EXECUTION_EVENT_KEYS;
  if (event.phase === 'prepare-source-index' || event.phase === 'prepare-target-usage')
    return SIMPLE_EVENT_KEYS;
  return undefined;
}

function eventSchemaIsValid(event) {
  const keys = expectedEventKeys(event);
  if (keys === undefined || !hasKeys(event, keys)) return false;
  if (
    typeof event.phase !== 'string' ||
    typeof event.transition !== 'string' ||
    !COMMON_EVENT_KEYS.slice(1).every((key) => isSafeCount(event[key])) ||
    event.version !== 4
  )
    return false;
  if (event.phase === 'enumerate-branches')
    return [
      'analysisPasses',
      'discoveredBranches',
      'enumerationPrefixComputationCount',
      'enumerationPrefixEntryCount',
      'enumerationPrefixHitCount',
      'enumerationPrefixRequestCount',
      'queuedSelections',
    ].every((key) => isSafeCount(event[key]));
  if (event.phase === 'replay-branches')
    return [
      'replayPrefixComputationCount',
      'replayPrefixEntryCount',
      'replayPrefixHitCount',
      'replayPrefixRequestCount',
      'replayCompleted',
      'replayTotal',
    ].every((key) => isSafeCount(event[key]));
  if (event.phase.startsWith('execution-'))
    return ['executionPlanCompleted', 'executionPlanTotal', 'routeOrdinal'].every((key) =>
      isSafeCount(event[key]),
    );
  return true;
}

function diagnosticSchemaIsValid(diagnostics) {
  return (
    hasKeys(diagnostics, BUNDLE_DIAGNOSTIC_KEYS) &&
    BUNDLE_DIAGNOSTIC_KEYS.every((key) => isSafeCount(diagnostics[key])) &&
    diagnostics.diagnosticsVersion === 1
  );
}

function parseManifest(bytes) {
  const text = bytes.toString('utf8');
  if (!text.endsWith('\n')) return { entries: [], validLines: false };
  const lines = text.slice(0, -1).split('\n');
  const entries = lines.map((line) => {
    const match = /^([0-9a-f]{64})  ([^\r\n]+)$/u.exec(line);
    return match === null ? undefined : { hash: match[1], path: match[2] };
  });
  return { entries, validLines: entries.every((entry) => entry !== undefined) };
}

async function productionManifestIsValid(options, manifest) {
  if (
    !manifest.validLines ||
    manifest.entries.length !== 35 ||
    new Set(manifest.entries.map((entry) => entry?.path)).size !== 35 ||
    JSON.stringify(manifest.entries.map((entry) => entry?.path)) !==
      JSON.stringify(options.expectedProductionPaths)
  )
    return false;
  for (const entry of manifest.entries) {
    if (entry === undefined || path.isAbsolute(entry.path) || entry.path.includes('..'))
      return false;
    const contents = await readFile(path.join(options.repositoryRoot, entry.path));
    if (sha256(contents) !== entry.hash) return false;
  }
  return true;
}

function headerIsValid(header, authorityProductionAggregate) {
  return (
    hasKeys(header, HEADER_KEYS) &&
    header.kind === 'header' &&
    header.schemaVersion === 1 &&
    header.telemetryPolicyVersion === 4 &&
    header.isolationPolicyVersion === 3 &&
    header.maximumEvents === 1664 &&
    header.probeCapMs === 300000 &&
    header.noRetry === true &&
    header.productionAggregate === authorityProductionAggregate &&
    [
      header.confinementPolicyDigest,
      header.dependencyViewDigest,
      header.isolationPolicyDigest,
      header.sourceManifestDigest,
      header.telemetryPolicyDigest,
    ].every(isDigest)
  );
}

function terminalIsValid(terminal) {
  return (
    hasKeys(terminal, TERMINAL_KEYS) &&
    hasKeys(terminal.lastCounters, [
      'executionPlanCompleted',
      'executionPlanTotal',
      'routeOrdinal',
    ]) &&
    terminal.cleanupConfirmed === true &&
    terminal.eventCount === 1482 &&
    terminal.finalSequence === 1482 &&
    terminal.kind === 'terminal' &&
    terminal.lastPhase === 'execution-frontier-plan' &&
    terminal.noRetry === true &&
    terminal.schemaVersion === 1 &&
    terminal.failureCode === 'preview-inventory-cancelled' &&
    terminal.status === 'probe-cancelled' &&
    terminal.lastCounters.executionPlanCompleted === 256 &&
    terminal.lastCounters.executionPlanTotal === 681 &&
    terminal.lastCounters.routeOrdinal === 256
  );
}

function prefixEquations(events, prefix) {
  return events.every(
    (event) =>
      event[`${prefix}RequestCount`] ===
        event[`${prefix}ComputationCount`] + event[`${prefix}HitCount`] &&
      event[`${prefix}EntryCount`] <= event[`${prefix}ComputationCount`],
  );
}

function diagnosticsEquations(events) {
  return events.every((event) => {
    const value = event.bundleDiagnostics;
    return (
      diagnosticSchemaIsValid(value) &&
      value.sliceRequestCount === value.sliceComputationCount + value.sliceHitCount &&
      value.inventoryRequestCount === value.inventoryComputationCount + value.inventoryHitCount &&
      value.inventoryReadRequestCount >= value.inventoryReadPathCacheHitCount &&
      value.queueSortCount === value.queueIterationCount &&
      (value.queueIterationCount === 0) === (value.queuePeakLength === 0)
    );
  });
}

function noForbiddenEvidence(records) {
  const visit = (value) => {
    if (Array.isArray(value)) return value.every(visit);
    if (!isRecord(value)) return true;
    return Object.entries(value).every(
      ([key, nested]) =>
        !/(?:browser|chromium|campaign)/iu.test(key) &&
        (key === 'noRetry' || !/retry/iu.test(key)) &&
        visit(nested),
    );
  };
  return records.every(visit);
}

/** Runs the 1,506-check semantic core against supplied immutable bytes. */
export async function validateProfileSnapshot(options) {
  const parsed = parseJsonl(options.profileBytes);
  const header = parsed.records[0];
  const progress = parsed.records.slice(1, 1 + EXPECTED_PROGRESS_COUNT);
  const terminal = parsed.records.at(-1);
  const events = progress.map((record) => record?.event);
  const enumeration = events.filter((event) => event?.phase === 'enumerate-branches');
  const replay = events.filter((event) => event?.phase === 'replay-branches');
  const execution = events.filter((event) => event?.phase?.startsWith('execution-'));
  const bundleEvents = events.filter((event) => event?.bundleDiagnostics !== undefined);
  const manifest = parseManifest(options.productionManifestBytes);
  const productionAggregate = sha256(options.productionManifestBytes);
  const progressPasses = Array.from({ length: EXPECTED_PROGRESS_COUNT }, (_, index) => {
    const record = progress[index];
    return (
      hasKeys(record, PROGRESS_KEYS) &&
      record.kind === 'progress' &&
      record.schemaVersion === 1 &&
      eventSchemaIsValid(record.event) &&
      record.event.sequence === index + 1 &&
      record.event.version === 4
    );
  });
  const contractResults = [];
  const check = async (name, operation) => {
    let passed = false;
    try {
      passed = (await operation()) === true;
    } catch {
      passed = false;
    }
    contractResults.push({ name, passed });
  };
  await check('authority-file-identity', () =>
    options.enforceOfficialIdentity
      ? options.profilePath === AUTHORITY_PATH &&
        options.expectedProfileSha256 === AUTHORITY_SHA256 &&
        sha256(options.profileBytes) === AUTHORITY_SHA256
      : sha256(options.profileBytes) === options.expectedProfileSha256,
  );
  await check(
    'record-cardinality',
    () =>
      parsed.terminalNewline &&
      parsed.nonempty &&
      parsed.records.length === 1484 &&
      parsed.records.every((record) => record !== undefined),
  );
  await check(
    'record-wrapper-schema-and-key-order',
    () =>
      hasKeys(header, HEADER_KEYS) &&
      progress.every((record) => hasKeys(record, PROGRESS_KEYS)) &&
      hasKeys(terminal, TERMINAL_KEYS),
  );
  await check('header-contract', () => headerIsValid(header, options.authorityProductionAggregate));
  await check('progress-record-schema-and-key-order', () => events.every(eventSchemaIsValid));
  await check(
    'progress-sequence-and-version',
    () =>
      events.length === EXPECTED_PROGRESS_COUNT &&
      events.every((event, index) => event?.sequence === index + 1 && event.version === 4),
  );
  await check('phase-transition-domain', () =>
    events.every((event) => {
      if (!isRecord(event)) return false;
      if (event.phase.startsWith('execution-'))
        return (
          EXECUTION_PHASES.includes(event.phase) && ['start', 'complete'].includes(event.transition)
        );
      if (event.phase === 'enumerate-branches' || event.phase === 'replay-branches')
        return ['start', 'checkpoint', 'complete'].includes(event.transition);
      return (
        ['prepare-source-index', 'prepare-target-usage'].includes(event.phase) &&
        ['start', 'complete'].includes(event.transition)
      );
    }),
  );
  const expectedPreExecution = [
    'prepare-source-index:start',
    'prepare-source-index:complete',
    'prepare-target-usage:start',
    'prepare-target-usage:complete',
    'enumerate-branches:start',
    ...CHECKPOINTS_ENUMERATION.map(() => 'enumerate-branches:checkpoint'),
    'enumerate-branches:complete',
    'replay-branches:start',
    ...CHECKPOINTS_REPLAY.map(() => 'replay-branches:checkpoint'),
    'replay-branches:complete',
  ];
  await check(
    'pre-execution-envelope-order',
    () => JSON.stringify(events.slice(0, 30).map(pair)) === JSON.stringify(expectedPreExecution),
  );
  await check(
    'enumeration-checkpoint-order',
    () =>
      JSON.stringify(
        enumeration
          .filter((event) => event.transition === 'checkpoint')
          .map((event) => event.analysisPasses),
      ) === JSON.stringify(CHECKPOINTS_ENUMERATION),
  );
  await check('enumeration-terminal-counts', () => {
    const last = enumeration.at(-1);
    return (
      last?.transition === 'complete' &&
      last.analysisPasses === 725 &&
      last.discoveredBranches === 746 &&
      last.queuedSelections === 725
    );
  });
  await check('enumeration-prefix-equations', () =>
    prefixEquations(enumeration, 'enumerationPrefix'),
  );
  await check(
    'replay-checkpoint-order',
    () =>
      JSON.stringify(
        replay
          .filter((event) => event.transition === 'checkpoint')
          .map((event) => event.replayCompleted),
      ) === JSON.stringify(CHECKPOINTS_REPLAY),
  );
  await check('replay-terminal-counts', () => {
    const last = replay.at(-1);
    return (
      last?.transition === 'complete' && last.replayCompleted === 730 && last.replayTotal === 730
    );
  });
  await check('replay-prefix-equations', () => prefixEquations(replay, 'replayPrefix'));
  await check(
    'execution-sampled-ordinals',
    () =>
      JSON.stringify([...new Set(execution.map((event) => event.routeOrdinal))]) ===
      JSON.stringify(SAMPLED_ORDINALS),
  );
  await check('execution-phase-order', () =>
    SAMPLED_ORDINALS.every((ordinal, ordinalIndex) => {
      const slice = execution.slice(
        ordinalIndex * EXECUTION_SEQUENCE.length,
        (ordinalIndex + 1) * EXECUTION_SEQUENCE.length,
      );
      return (
        slice.length === EXECUTION_SEQUENCE.length &&
        slice.every(
          (event, index) =>
            event.routeOrdinal === ordinal &&
            pair(event) === `${EXECUTION_SEQUENCE[index][0]}:${EXECUTION_SEQUENCE[index][1]}`,
        )
      );
    }),
  );
  await check('execution-counter-semantics', () =>
    execution.every(
      (event) =>
        event.executionPlanCompleted ===
        (event.phase === 'execution-frontier-plan' && event.transition === 'complete'
          ? event.routeOrdinal
          : event.routeOrdinal - 1),
    ),
  );
  await check(
    'execution-total-consistency',
    () => execution.length === 1452 && execution.every((event) => event.executionPlanTotal === 681),
  );
  await check(
    'bundle-payload-placement-and-count',
    () =>
      bundleEvents.length === 66 &&
      events.every(
        (event) =>
          (event?.bundleDiagnostics !== undefined) ===
          (event?.phase === 'execution-frontier-bundle' && event?.transition === 'complete'),
      ),
  );
  await check('bundle-diagnostic-schema-and-key-order', () =>
    bundleEvents.every((event) => diagnosticSchemaIsValid(event.bundleDiagnostics)),
  );
  await check('bundle-diagnostic-equations-and-physical-meaning', () =>
    diagnosticsEquations(bundleEvents),
  );
  await check('terminal-partial-failure', () => terminalIsValid(terminal));
  await check(
    'cleanup-no-retry-and-false-completion',
    () =>
      header?.noRetry === true &&
      terminal?.noRetry === true &&
      terminal?.cleanupConfirmed === true &&
      terminal?.status !== 'complete' &&
      execution.every((event) => event.routeOrdinal <= 256) &&
      parsed.records.filter((record) => record?.kind === 'header').length === 1 &&
      parsed.records.filter((record) => record?.kind === 'terminal').length === 1 &&
      parsed.records.every((record) => !Object.hasOwn(record ?? {}, 'inventory')) &&
      noForbiddenEvidence(parsed.records),
  );
  await check(
    'v5524-production-aggregate',
    async () =>
      sha256(options.basePlanBytes) === options.expectedBasePlanSha256 &&
      sha256(options.amendmentBytes) === options.expectedAmendmentSha256 &&
      (!options.enforceOfficialIdentity ||
        (options.expectedBasePlanSha256 === BASE_PLAN_SHA256 &&
          options.expectedAmendmentSha256 === AMENDMENT_SHA256)) &&
      (await productionManifestIsValid(options, manifest)),
  );
  if (contractResults.map((result) => result.name).join('\n') !== CONTRACT_NAMES.join('\n'))
    throw new Error('Validator contract check ordering drifted.');
  const passedProgressCount = progressPasses.filter(Boolean).length;
  const passedContractCount = contractResults.filter((result) => result.passed).length;
  const passedCheckCount = passedProgressCount + passedContractCount;
  const failedCheckCount = EXPECTED_CHECK_COUNT - passedCheckCount;
  const result = failedCheckCount === 0 ? 'pass' : 'fail';
  const exitCode = result === 'pass' ? 0 : 1;
  return Object.freeze({
    output: Object.freeze({
      schemaVersion: 1,
      validator: 'rtcc-preview-complete-route-profile',
      validatorVersion: 1,
      result,
      exitCode,
      expectedCheckCount: EXPECTED_CHECK_COUNT,
      passedCheckCount,
      failedCheckCount,
      progressRecordChecks: Object.freeze({
        expected: EXPECTED_PROGRESS_COUNT,
        passed: passedProgressCount,
        failed: EXPECTED_PROGRESS_COUNT - passedProgressCount,
      }),
      contractChecks: Object.freeze({
        expected: CONTRACT_NAMES.length,
        passed: passedContractCount,
        failed: CONTRACT_NAMES.length - passedContractCount,
        names: CONTRACT_NAMES,
      }),
      authority: Object.freeze({
        sha256: options.expectedProfileSha256,
        lineCount: parsed.lines.length,
        progressCount: parsed.records.filter((record) => record?.kind === 'progress').length,
        productionAggregate: options.authorityProductionAggregate,
      }),
      plans: Object.freeze({
        baseSha256: options.expectedBasePlanSha256,
        amendmentSha256: options.expectedAmendmentSha256,
      }),
      productionAggregate: Object.freeze({
        sha256: productionAggregate,
        entryCount: manifest.entries.length,
      }),
      telemetry: Object.freeze({
        version: 4,
        bundleDiagnosticRecordCount: bundleEvents.length,
        bundleDiagnosticFieldCount: BUNDLE_DIAGNOSTIC_KEYS.length,
      }),
      terminal: Object.freeze({
        status: terminal?.status,
        failureCode: terminal?.failureCode,
        executionPlanCompleted: terminal?.lastCounters?.executionPlanCompleted,
        executionPlanTotal: terminal?.lastCounters?.executionPlanTotal,
        cleanupConfirmed: terminal?.cleanupConfirmed,
        noRetry: terminal?.noRetry,
      }),
    }),
    contractResults: Object.freeze(contractResults.map((item) => Object.freeze(item))),
  });
}

export const canonicalJson = (value) => `${JSON.stringify(value)}\n`;

/** Exclusively persists one captured parent/worker result and never overwrites retained evidence. */
export async function persistValidationRun(options) {
  const outputBytes = Buffer.from(canonicalJson(options.output));
  await writeFile(options.outputPath, outputBytes, { flag: 'wx', mode: 0o600 });
  const evidence = Object.freeze({
    schemaVersion: 1,
    cwd: options.cwd,
    environment: Object.freeze(options.environment),
    argv: Object.freeze([...options.argv]),
    childExitCode: options.childExitCode,
    childStdout: options.childStdout,
    childStderr: options.childStderr,
    validatorSha256: options.validatorSha256,
    validatorTestSha256: options.validatorTestSha256,
    authoritySha256: options.authoritySha256,
    basePlanSha256: options.basePlanSha256,
    amendmentSha256: options.amendmentSha256,
    productionManifestSha256: options.productionManifestSha256,
    validationOutputSha256: sha256(outputBytes),
    noRetry: true,
    browserExecuted: false,
    campaignExecuted: false,
    chromiumExecuted: false,
    profileExecuted: false,
  });
  await writeFile(options.evidencePath, canonicalJson(evidence), { flag: 'wx', mode: 0o600 });
  return evidence;
}

function parseArguments(argv) {
  const values = new Map();
  let worker = false;
  for (let index = 0; index < argv.length; index += 1) {
    const name = argv[index];
    if (name === '--worker') {
      if (worker) throw new Error('Duplicate --worker flag.');
      worker = true;
      continue;
    }
    const value = argv[index + 1];
    if (
      !name?.startsWith('--') ||
      value === undefined ||
      value.startsWith('--') ||
      values.has(name)
    )
      throw new Error('Invalid validator arguments.');
    values.set(name, value);
    index += 1;
  }
  const required = [
    '--profile',
    '--profile-sha256',
    '--authority-production-aggregate',
    '--base-plan',
    '--base-plan-sha256',
    '--amendment',
    '--production-manifest',
    '--output',
    '--evidence',
  ];
  if (values.size !== required.length || required.some((name) => !values.has(name)))
    throw new Error('Invalid validator arguments.');
  return { worker, values };
}

async function officialInputs(parsed) {
  const get = (name) => parsed.values.get(name);
  const reference = JSON.parse(
    await readFile(
      path.join(REPOSITORY_ROOT, '.plan/launchers/rtcc-v5.5.23-artifact-manifest.json'),
      'utf8',
    ),
  );
  const expectedProductionPaths = reference.finalImplementationHashes.map((item) => item.path);
  return {
    profileBytes: await readFile(get('--profile')),
    profilePath: get('--profile'),
    expectedProfileSha256: get('--profile-sha256'),
    authorityProductionAggregate: get('--authority-production-aggregate'),
    basePlanBytes: await readFile(get('--base-plan')),
    expectedBasePlanSha256: get('--base-plan-sha256'),
    amendmentBytes: await readFile(get('--amendment')),
    expectedAmendmentSha256: AMENDMENT_SHA256,
    productionManifestBytes: await readFile(get('--production-manifest')),
    expectedProductionPaths,
    repositoryRoot: REPOSITORY_ROOT,
    enforceOfficialIdentity: true,
  };
}

function invocationIsExact(parsed) {
  const get = (name) => parsed.values.get(name);
  return (
    process.cwd() === REPOSITORY_ROOT &&
    process.execPath === '/Users/lky/.nvm/versions/node/v22.22.2/bin/node' &&
    JSON.stringify(Object.keys(process.env).sort()) ===
      JSON.stringify(['LANG', 'LC_ALL', 'NODE_OPTIONS', 'TZ']) &&
    process.env.LANG === 'C' &&
    process.env.LC_ALL === 'C' &&
    process.env.TZ === 'UTC' &&
    process.env.NODE_OPTIONS === '' &&
    get('--profile') === AUTHORITY_PATH &&
    get('--profile-sha256') === AUTHORITY_SHA256 &&
    get('--authority-production-aggregate') === AUTHORITY_PRODUCTION_AGGREGATE &&
    get('--base-plan') === '.plan/rtcc-preview-v5.5.24.md' &&
    get('--base-plan-sha256') === BASE_PLAN_SHA256 &&
    get('--amendment') === '.plan/rtcc-preview-v5.5.24-amendment-1.md' &&
    get('--production-manifest') === '.plan/launchers/rtcc-v5.5.24-production-SHA256SUMS' &&
    get('--output') === '.plan/launchers/rtcc-v5.5.24-profile-validation.json' &&
    get('--evidence') === '.plan/launchers/rtcc-v5.5.24-validator-run-evidence.json'
  );
}

async function pathDoesNotExist(targetPath) {
  try {
    await access(targetPath);
    return false;
  } catch {
    return true;
  }
}

async function runWorker(parsed) {
  if (!invocationIsExact(parsed)) {
    process.stderr.write('Invalid validator worker invocation.\n');
    process.exitCode = 64;
    return;
  }
  try {
    const validated = await validateProfileSnapshot(await officialInputs(parsed));
    process.send?.({ output: validated.output });
    process.stdout.write(
      `rtcc-preview-profile-validator v1 ${validated.output.result.toUpperCase()} ${validated.output.passedCheckCount}/1506\n`,
    );
    process.exitCode = validated.output.exitCode;
  } catch (error) {
    process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
    process.exitCode = 74;
  }
}

async function runParent(parsed, originalArgv) {
  if (!invocationIsExact(parsed)) {
    process.stderr.write('Invalid validator invocation environment or arguments.\n');
    process.exitCode = 64;
    return;
  }
  const outputPath = parsed.values.get('--output');
  const evidencePath = parsed.values.get('--evidence');
  if (!(await pathDoesNotExist(outputPath)) || !(await pathDoesNotExist(evidencePath))) {
    process.stderr.write('Validation output or evidence already exists; retry is forbidden.\n');
    process.exitCode = 74;
    return;
  }
  const child = spawn(process.execPath, [SCRIPT_PATH, '--worker', ...originalArgv], {
    cwd: process.cwd(),
    env: process.env,
    stdio: ['ignore', 'pipe', 'pipe', 'ipc'],
  });
  let stdout = '';
  let stderr = '';
  let output;
  child.stdout.setEncoding('utf8').on('data', (chunk) => {
    stdout += chunk;
  });
  child.stderr.setEncoding('utf8').on('data', (chunk) => {
    stderr += chunk;
  });
  child.on('message', (message) => {
    if (isRecord(message) && isRecord(message.output)) output = message.output;
  });
  const exitCode = await new Promise((resolve) => child.once('close', resolve));
  if (!isRecord(output) || typeof exitCode !== 'number') {
    process.stderr.write('Validator worker did not return a complete result.\n');
    process.exitCode = 74;
    return;
  }
  try {
    const hashes = {
      validatorSha256: sha256(await readFile(SCRIPT_PATH)),
      validatorTestSha256: sha256(await readFile(path.join(REPOSITORY_ROOT, TEST_PATH))),
      authoritySha256: sha256(await readFile(parsed.values.get('--profile'))),
      basePlanSha256: sha256(await readFile(parsed.values.get('--base-plan'))),
      amendmentSha256: sha256(await readFile(parsed.values.get('--amendment'))),
      productionManifestSha256: sha256(await readFile(parsed.values.get('--production-manifest'))),
    };
    await persistValidationRun({
      output,
      outputPath,
      evidencePath,
      cwd: process.cwd(),
      environment: {
        LANG: process.env.LANG,
        LC_ALL: process.env.LC_ALL,
        TZ: process.env.TZ,
        NODE_OPTIONS: process.env.NODE_OPTIONS,
      },
      argv: originalArgv,
      childExitCode: exitCode,
      childStdout: stdout,
      childStderr: stderr,
      ...hashes,
    });
  } catch (error) {
    process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
    process.exitCode = 74;
    return;
  }
  process.stdout.write(stdout);
  process.stderr.write(stderr);
  process.exitCode = exitCode;
}

async function main() {
  let parsed;
  try {
    parsed = parseArguments(process.argv.slice(2));
  } catch (error) {
    process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
    process.exitCode = 64;
    return;
  }
  if (parsed.worker) await runWorker(parsed);
  else await runParent(parsed, process.argv.slice(2));
}

if (path.resolve(process.argv[1] ?? '') === SCRIPT_PATH) await main();
