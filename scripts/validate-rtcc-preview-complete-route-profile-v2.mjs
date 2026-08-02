#!/usr/bin/env node
/** Validates the sole frozen profile while retaining the terminal v5.5.24 validator failure. */
import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { access, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  CONTRACT_NAMES as V1_CONTRACT_NAMES,
  validateProfileSnapshot as validateProfileSnapshotV1,
} from './validate-rtcc-preview-complete-route-profile.mjs';

export const CONTRACT_NAMES = Object.freeze([
  ...V1_CONTRACT_NAMES.slice(0, -1),
  'v5525-carried-production-aggregate',
]);

const EXPECTED_CHECK_COUNT = 1506;
const EXPECTED_PROGRESS_COUNT = 1482;
const REPOSITORY_ROOT = '/Users/lky/project/reactpreview';
const NODE_PATH = '/Users/lky/.nvm/versions/node/v22.22.2/bin/node';
const AUTHORITY_PATH = '/private/tmp/rtcc-preview-v4-3.0ESvAAhF/profile-v5-5-23-a/profile.jsonl';
const AUTHORITY_SHA256 = 'dfb8aad757909f843e368fb8ce73a72ed112144ad12d5b4e5546ad3ab92f88e4';
const AUTHORITY_PRODUCTION_AGGREGATE =
  '39e813eae9f6d4efaabff943a622a23102544a45aae6b692b5161e06ef2e2ed0';
const PREDECESSOR_PLAN_PATH = '.plan/rtcc-preview-v5.5.24.md';
const PREDECESSOR_PLAN_SHA256 = '47c0a980be5f4754a970ee686258871f0feda9045257a2daa40416f1868472ac';
const PREDECESSOR_AMENDMENT_PATH = '.plan/rtcc-preview-v5.5.24-amendment-1.md';
const PREDECESSOR_AMENDMENT_SHA256 =
  'fc4d65cfcc3a3871e9b7bad38eb0651a9a6a0d7a242ac99b747e425ff0d34414';
const PLAN_PATH = '.plan/rtcc-preview-v5.5.25.md';
const PLAN_SHA256 = 'ab859770b1b96a7fedbf573fd0156ca68986458d9d17f9ea24e5d5385279328a';
const FAILED_VALIDATOR_PATH = 'scripts/validate-rtcc-preview-complete-route-profile.mjs';
const FAILED_VALIDATOR_SHA256 = '85af9c6178228b1885e02b911a7c335505964b9e67f2e6fdd4705f557071daca';
const FAILED_VALIDATOR_TEST_PATH = 'test/scripts/validateRtccPreviewCompleteRouteProfile.test.ts';
const FAILED_VALIDATOR_TEST_SHA256 =
  '757687b97a6d10104010192dd7e318377aa6e960fb00b72dd583c6a6352a2190';
const PREDECESSOR_PRODUCTION_MANIFEST_PATH = '.plan/launchers/rtcc-v5.5.24-production-SHA256SUMS';
const PRODUCTION_MANIFEST_PATH = '.plan/launchers/rtcc-v5.5.25-production-SHA256SUMS';
const PRODUCTION_MANIFEST_SHA256 =
  'ac1344e8c36f436a5d3e8f5e83dc9bb8dfd649a7255a38d5577c9ee2dd87b5a8';
const FAILURE_LINEAGE_PATH = '.plan/launchers/rtcc-v5.5.25-v5.5.24-validator-failure-lineage.json';
const OUTPUT_PATH = '.plan/launchers/rtcc-v5.5.25-profile-validation.json';
const EVIDENCE_PATH = '.plan/launchers/rtcc-v5.5.25-validator-run-evidence.json';
const TEST_PATH = 'test/scripts/validateRtccPreviewCompleteRouteProfileV2.test.ts';
const SCRIPT_PATH = fileURLToPath(import.meta.url);
const GATE_WORKER_MARKER = 'rtcc-preview-profile-validator v2 GATE WORKER START\n';

const EXPECTED_ENVIRONMENT = Object.freeze({
  LANG: 'C',
  LC_ALL: 'C',
  NODE_OPTIONS: '',
  TZ: 'UTC',
  __CF_USER_TEXT_ENCODING: '0x1F5:0x3:0x33',
});
const EXPECTED_ENVIRONMENT_KEYS = Object.freeze(Object.keys(EXPECTED_ENVIRONMENT).sort());

const V5524_RESERVED_OUTPUTS = Object.freeze([
  '.plan/launchers/rtcc-v5.5.24-profile-validation.json',
  '.plan/launchers/rtcc-v5.5.24-validator-run-evidence.json',
  '.plan/launchers/rtcc-v5.5.24-artifact-manifest.json',
  '.plan/launchers/rtcc-v5.5.24-SHA256SUMS',
]);

const V5524_ARGUMENTS = Object.freeze([
  '--profile',
  AUTHORITY_PATH,
  '--profile-sha256',
  AUTHORITY_SHA256,
  '--authority-production-aggregate',
  AUTHORITY_PRODUCTION_AGGREGATE,
  '--base-plan',
  PREDECESSOR_PLAN_PATH,
  '--base-plan-sha256',
  PREDECESSOR_PLAN_SHA256,
  '--amendment',
  PREDECESSOR_AMENDMENT_PATH,
  '--production-manifest',
  PREDECESSOR_PRODUCTION_MANIFEST_PATH,
  '--output',
  '.plan/launchers/rtcc-v5.5.24-profile-validation.json',
  '--evidence',
  '.plan/launchers/rtcc-v5.5.24-validator-run-evidence.json',
]);

const OFFICIAL_ARGUMENTS = Object.freeze([
  '--profile',
  AUTHORITY_PATH,
  '--profile-sha256',
  AUTHORITY_SHA256,
  '--authority-production-aggregate',
  AUTHORITY_PRODUCTION_AGGREGATE,
  '--predecessor-plan',
  PREDECESSOR_PLAN_PATH,
  '--predecessor-plan-sha256',
  PREDECESSOR_PLAN_SHA256,
  '--predecessor-amendment',
  PREDECESSOR_AMENDMENT_PATH,
  '--predecessor-amendment-sha256',
  PREDECESSOR_AMENDMENT_SHA256,
  '--plan',
  PLAN_PATH,
  '--failed-validator',
  FAILED_VALIDATOR_PATH,
  '--failed-validator-sha256',
  FAILED_VALIDATOR_SHA256,
  '--failed-validator-test',
  FAILED_VALIDATOR_TEST_PATH,
  '--failed-validator-test-sha256',
  FAILED_VALIDATOR_TEST_SHA256,
  '--failure-lineage',
  FAILURE_LINEAGE_PATH,
  '--production-manifest',
  PRODUCTION_MANIFEST_PATH,
  '--production-manifest-sha256',
  PRODUCTION_MANIFEST_SHA256,
  '--output',
  OUTPUT_PATH,
  '--evidence',
  EVIDENCE_PATH,
]);

const sha256 = (value) => createHash('sha256').update(value).digest('hex');
export const canonicalJson = (value) => `${JSON.stringify(value)}\n`;

/** Captures the five accepted keys in stable evidence order. */
export function captureEnvironment(environment = process.env) {
  return Object.freeze({
    LANG: environment.LANG,
    LC_ALL: environment.LC_ALL,
    NODE_OPTIONS: environment.NODE_OPTIONS,
    TZ: environment.TZ,
    __CF_USER_TEXT_ENCODING: environment.__CF_USER_TEXT_ENCODING,
  });
}

/** Applies the same exact runtime gate to every parent and worker mode. */
export function environmentIsExact(environment = process.env) {
  return (
    JSON.stringify(Object.keys(environment).sort()) === JSON.stringify(EXPECTED_ENVIRONMENT_KEYS) &&
    Object.entries(EXPECTED_ENVIRONMENT).every(([key, value]) => environment[key] === value)
  );
}

/** Applies the same exact runtime gate to every parent and worker mode. */
export function runtimeIsExact(environment = process.env) {
  return (
    process.cwd() === REPOSITORY_ROOT &&
    process.execPath === NODE_PATH &&
    environmentIsExact(environment)
  );
}

/** Returns the only valid retained account of the terminal v5.5.24 validator failure. */
export function expectedFailureLineage() {
  return {
    schemaVersion: 1,
    kind: 'rtcc-preview-validator-failure-lineage',
    release: 'v5.5.24',
    result: 'no-go',
    plans: {
      base: { path: PREDECESSOR_PLAN_PATH, sha256: PREDECESSOR_PLAN_SHA256 },
      amendment: {
        path: PREDECESSOR_AMENDMENT_PATH,
        sha256: PREDECESSOR_AMENDMENT_SHA256,
      },
    },
    failedArtifacts: {
      validator: { path: FAILED_VALIDATOR_PATH, sha256: FAILED_VALIDATOR_SHA256 },
      validatorTest: {
        path: FAILED_VALIDATOR_TEST_PATH,
        sha256: FAILED_VALIDATOR_TEST_SHA256,
      },
      productionManifest: {
        path: PREDECESSOR_PRODUCTION_MANIFEST_PATH,
        sha256: PRODUCTION_MANIFEST_SHA256,
      },
    },
    authority: { path: AUTHORITY_PATH, sha256: AUTHORITY_SHA256 },
    invocation: {
      argv: [...V5524_ARGUMENTS],
      requestedEnvironment: { LANG: 'C', LC_ALL: 'C', TZ: 'UTC', NODE_OPTIONS: '' },
      observedAdditionalEnvironment: {
        __CF_USER_TEXT_ENCODING: '0x1F5:0x3:0x33',
      },
    },
    observedResult: {
      exitCode: 64,
      stdout: '',
      stderr: 'Invalid validator invocation environment or arguments.\n',
      workerSpawned: false,
    },
    reservedOutputsAbsent: [...V5524_RESERVED_OUTPUTS],
    runCount: 1,
    noRetry: true,
    retryPerformed: false,
    v5524Passed: false,
    externalActions: {
      browserExecuted: false,
      chromiumExecuted: false,
      campaignExecuted: false,
      timeoutUsed: false,
      profileExecuted: false,
      externalActionPerformed: false,
    },
  };
}

/** Requires canonical bytes so key ordering and every failure fact are immutable. */
export function failureLineageIsValid(bytes) {
  return bytes.equals(Buffer.from(canonicalJson(expectedFailureLineage())));
}

async function pathDoesNotExist(targetPath) {
  try {
    await access(targetPath);
    return false;
  } catch {
    return true;
  }
}

function buffersEqual(left, right) {
  return Buffer.from(left).equals(Buffer.from(right));
}

/** Upgrades v1's pure semantic result without adding or removing any check. */
export function buildV2ValidationResult(core, carriedContractPassed, metadata) {
  if (
    core.contractResults.length !== CONTRACT_NAMES.length ||
    core.contractResults.slice(0, -1).some((result, index) => result.name !== CONTRACT_NAMES[index])
  )
    throw new Error('Frozen validator contract ordering drifted.');
  const contractResults = Object.freeze(
    core.contractResults.map((result, index) =>
      Object.freeze(
        index === CONTRACT_NAMES.length - 1
          ? { name: CONTRACT_NAMES[index], passed: result.passed && carriedContractPassed }
          : { name: result.name, passed: result.passed },
      ),
    ),
  );
  const passedProgressCount = core.output.progressRecordChecks.passed;
  const passedContractCount = contractResults.filter((result) => result.passed).length;
  const passedCheckCount = passedProgressCount + passedContractCount;
  const failedCheckCount = EXPECTED_CHECK_COUNT - passedCheckCount;
  const result = failedCheckCount === 0 ? 'pass' : 'fail';
  const productionManifestText = metadata.productionManifestBytes.toString('utf8');
  const productionManifestEntryCount = productionManifestText.endsWith('\n')
    ? productionManifestText.slice(0, -1).split('\n').length
    : productionManifestText.split('\n').length;
  const implementationChanged = metadata.predecessorProductionManifestBytes
    ? !buffersEqual(metadata.productionManifestBytes, metadata.predecessorProductionManifestBytes)
    : false;
  return Object.freeze({
    output: Object.freeze({
      schemaVersion: 2,
      validator: 'rtcc-preview-complete-route-profile-v2',
      validatorVersion: 2,
      result,
      exitCode: result === 'pass' ? 0 : 1,
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
      authority: core.output.authority,
      lineage: Object.freeze({
        result: 'no-go',
        retryPerformed: false,
        v5524Passed: false,
      }),
      plans: Object.freeze({
        predecessorSha256: metadata.expectedPredecessorPlanSha256,
        predecessorAmendmentSha256: metadata.expectedPredecessorAmendmentSha256,
        currentSha256: metadata.expectedPlanSha256,
      }),
      productionAggregate: Object.freeze({
        sha256: sha256(metadata.productionManifestBytes),
        entryCount: productionManifestEntryCount,
        implementationChanged,
      }),
      telemetry: core.output.telemetry,
      terminal: core.output.terminal,
    }),
    contractResults,
  });
}

/** Runs the frozen semantic core and binds check 24 to v5.5.25's carried lineage. */
export async function validateProfileSnapshot(options) {
  const core = await validateProfileSnapshotV1({
    profileBytes: options.profileBytes,
    profilePath: options.profilePath,
    expectedProfileSha256: options.expectedProfileSha256,
    authorityProductionAggregate: options.authorityProductionAggregate,
    basePlanBytes: options.predecessorPlanBytes,
    expectedBasePlanSha256: options.expectedPredecessorPlanSha256,
    amendmentBytes: options.predecessorAmendmentBytes,
    expectedAmendmentSha256: options.expectedPredecessorAmendmentSha256,
    productionManifestBytes: options.productionManifestBytes,
    expectedProductionPaths: options.expectedProductionPaths,
    repositoryRoot: options.repositoryRoot,
    enforceOfficialIdentity: options.enforceOfficialIdentity,
  });
  const reservedOutputsAbsent = await Promise.all(
    (options.v5524ReservedOutputPaths ?? []).map(pathDoesNotExist),
  );
  const carriedContractPassed =
    sha256(options.planBytes) === options.expectedPlanSha256 &&
    sha256(options.failedValidatorBytes) === options.expectedFailedValidatorSha256 &&
    sha256(options.failedValidatorTestBytes) === options.expectedFailedValidatorTestSha256 &&
    sha256(options.productionManifestBytes) === options.expectedProductionManifestSha256 &&
    buffersEqual(options.productionManifestBytes, options.predecessorProductionManifestBytes) &&
    failureLineageIsValid(options.failureLineageBytes) &&
    reservedOutputsAbsent.every(Boolean) &&
    (!options.enforceOfficialIdentity ||
      (options.expectedPlanSha256 === PLAN_SHA256 &&
        options.expectedFailedValidatorSha256 === FAILED_VALIDATOR_SHA256 &&
        options.expectedFailedValidatorTestSha256 === FAILED_VALIDATOR_TEST_SHA256 &&
        options.expectedProductionManifestSha256 === PRODUCTION_MANIFEST_SHA256));
  return buildV2ValidationResult(core, carriedContractPassed, options);
}

/** Writes one retained parent/worker result with exclusive creation and no retry. */
export async function persistValidationRun(options) {
  const outputBytes = Buffer.from(canonicalJson(options.output));
  await writeFile(options.outputPath, outputBytes, { flag: 'wx', mode: 0o600 });
  const evidence = Object.freeze({
    schemaVersion: 2,
    validator: 'rtcc-preview-complete-route-profile-v2',
    validatorVersion: 2,
    cwd: options.cwd,
    parentEnvironment: Object.freeze(options.parentEnvironment),
    workerEnvironment: Object.freeze(options.workerEnvironment),
    argv: Object.freeze([...options.argv]),
    childExitCode: options.childExitCode,
    childStdout: options.childStdout,
    childStderr: options.childStderr,
    validatorSha256: options.validatorSha256,
    validatorTestSha256: options.validatorTestSha256,
    failedValidatorSha256: options.failedValidatorSha256,
    failedValidatorTestSha256: options.failedValidatorTestSha256,
    authoritySha256: options.authoritySha256,
    predecessorPlanSha256: options.predecessorPlanSha256,
    predecessorAmendmentSha256: options.predecessorAmendmentSha256,
    planSha256: options.planSha256,
    predecessorProductionManifestSha256: options.predecessorProductionManifestSha256,
    productionManifestSha256: options.productionManifestSha256,
    failureLineageSha256: options.failureLineageSha256,
    validationOutputSha256: sha256(outputBytes),
    runCount: 1,
    noRetry: true,
    retryPerformed: false,
    browserExecuted: false,
    chromiumExecuted: false,
    campaignExecuted: false,
    timeoutUsed: false,
    profileExecuted: false,
    externalActionPerformed: false,
  });
  await writeFile(options.evidencePath, canonicalJson(evidence), { flag: 'wx', mode: 0o600 });
  return evidence;
}

async function officialInputs() {
  const referencePath = path.join(
    REPOSITORY_ROOT,
    '.plan/launchers/rtcc-v5.5.23-artifact-manifest.json',
  );
  const [
    profileBytes,
    predecessorPlanBytes,
    predecessorAmendmentBytes,
    planBytes,
    failedValidatorBytes,
    failedValidatorTestBytes,
    failureLineageBytes,
    predecessorProductionManifestBytes,
    productionManifestBytes,
    referenceBytes,
  ] = await Promise.all([
    readFile(AUTHORITY_PATH),
    readFile(PREDECESSOR_PLAN_PATH),
    readFile(PREDECESSOR_AMENDMENT_PATH),
    readFile(PLAN_PATH),
    readFile(FAILED_VALIDATOR_PATH),
    readFile(FAILED_VALIDATOR_TEST_PATH),
    readFile(FAILURE_LINEAGE_PATH),
    readFile(PREDECESSOR_PRODUCTION_MANIFEST_PATH),
    readFile(PRODUCTION_MANIFEST_PATH),
    readFile(referencePath),
  ]);
  const reference = JSON.parse(referenceBytes.toString('utf8'));
  return {
    profileBytes,
    profilePath: AUTHORITY_PATH,
    expectedProfileSha256: AUTHORITY_SHA256,
    authorityProductionAggregate: AUTHORITY_PRODUCTION_AGGREGATE,
    predecessorPlanBytes,
    expectedPredecessorPlanSha256: PREDECESSOR_PLAN_SHA256,
    predecessorAmendmentBytes,
    expectedPredecessorAmendmentSha256: PREDECESSOR_AMENDMENT_SHA256,
    planBytes,
    expectedPlanSha256: PLAN_SHA256,
    failedValidatorBytes,
    expectedFailedValidatorSha256: FAILED_VALIDATOR_SHA256,
    failedValidatorTestBytes,
    expectedFailedValidatorTestSha256: FAILED_VALIDATOR_TEST_SHA256,
    failureLineageBytes,
    predecessorProductionManifestBytes,
    productionManifestBytes,
    expectedProductionManifestSha256: PRODUCTION_MANIFEST_SHA256,
    expectedProductionPaths: reference.finalImplementationHashes.map((item) => item.path),
    repositoryRoot: REPOSITORY_ROOT,
    v5524ReservedOutputPaths: V5524_RESERVED_OUTPUTS,
    enforceOfficialIdentity: true,
  };
}

function argumentsEqual(actual, expected) {
  return JSON.stringify(actual) === JSON.stringify(expected);
}

function modeForArguments(argv) {
  if (argumentsEqual(argv, ['--gate-probe'])) return 'gate-parent';
  if (argumentsEqual(argv, ['--gate-probe-worker'])) return 'gate-worker';
  if (argumentsEqual(argv, ['--gate-probe-worker-inheritance-drift']))
    return 'gate-worker-inheritance-drift';
  if (argumentsEqual(argv, ['--gate-probe-worker-drift'])) return 'gate-parent-worker-drift';
  if (argumentsEqual(argv, OFFICIAL_ARGUMENTS)) return 'official-parent';
  if (argumentsEqual(argv, ['--worker', ...OFFICIAL_ARGUMENTS])) return 'official-worker';
  return 'invalid';
}

function collectChild(child) {
  let stdout = '';
  let stderr = '';
  let message;
  child.stdout.setEncoding('utf8').on('data', (chunk) => {
    stdout += chunk;
  });
  child.stderr.setEncoding('utf8').on('data', (chunk) => {
    stderr += chunk;
  });
  child.on('message', (value) => {
    message = value;
  });
  return new Promise((resolve) => {
    child.once('close', (exitCode) => resolve({ exitCode, stdout, stderr, message }));
  });
}

async function runGateWorker(simulateInheritanceDrift = false) {
  process.stdout.write(GATE_WORKER_MARKER);
  if (simulateInheritanceDrift) process.env.__CF_USER_TEXT_ENCODING = 'worker-drift';
  if (!runtimeIsExact()) {
    process.stderr.write('Invalid validator v2 gate worker environment.\n');
    process.exitCode = 64;
    return;
  }
  process.send?.({ kind: 'gate-worker-pass', environment: captureEnvironment() });
}

export async function runGateProbeForTest() {
  await runGateParent(false);
}

async function runGateParent(simulateWorkerDrift) {
  if (!runtimeIsExact()) {
    process.stderr.write('Invalid validator v2 gate parent environment.\n');
    process.exitCode = 64;
    return;
  }
  const workerArgument = simulateWorkerDrift
    ? '--gate-probe-worker-inheritance-drift'
    : '--gate-probe-worker';
  const child = spawn(process.execPath, [SCRIPT_PATH, workerArgument], {
    cwd: process.cwd(),
    env: process.env,
    stdio: ['ignore', 'pipe', 'pipe', 'ipc'],
  });
  const captured = await collectChild(child);
  if (simulateWorkerDrift) {
    process.stdout.write(captured.stdout);
    process.stderr.write(captured.stderr);
    process.exitCode = captured.exitCode ?? 64;
    return;
  }
  const workerPassed =
    captured.exitCode === 0 &&
    captured.stdout === GATE_WORKER_MARKER &&
    captured.stderr === '' &&
    captured.message?.kind === 'gate-worker-pass' &&
    argumentsEqual(Object.keys(captured.message.environment).sort(), EXPECTED_ENVIRONMENT_KEYS) &&
    Object.entries(EXPECTED_ENVIRONMENT).every(
      ([key, value]) => captured.message.environment[key] === value,
    );
  if (!workerPassed) {
    process.stderr.write('Validator v2 gate worker result was invalid.\n');
    process.exitCode = 64;
    return;
  }
  process.stdout.write('rtcc-preview-profile-validator v2 GATE PASS parent=5 worker=5\n');
}

async function runOfficialWorker() {
  if (!runtimeIsExact()) {
    process.stderr.write('Invalid validator v2 worker environment or arguments.\n');
    process.exitCode = 64;
    return;
  }
  try {
    const validated = await validateProfileSnapshot(await officialInputs());
    process.send?.({
      kind: 'official-worker-result',
      output: validated.output,
      environment: captureEnvironment(),
    });
    process.stdout.write(
      `rtcc-preview-profile-validator v2 ${validated.output.result.toUpperCase()} ${validated.output.passedCheckCount}/1506\n`,
    );
    process.exitCode = validated.output.exitCode;
  } catch (error) {
    process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
    process.exitCode = 74;
  }
}

async function runOfficialParent(originalArgv) {
  if (!runtimeIsExact()) {
    process.stderr.write('Invalid validator v2 invocation environment or arguments.\n');
    process.exitCode = 64;
    return;
  }
  if (!(await pathDoesNotExist(OUTPUT_PATH)) || !(await pathDoesNotExist(EVIDENCE_PATH))) {
    process.stderr.write('Validation output or evidence already exists; retry is forbidden.\n');
    process.exitCode = 74;
    return;
  }
  const child = spawn(process.execPath, [SCRIPT_PATH, '--worker', ...originalArgv], {
    cwd: process.cwd(),
    env: process.env,
    stdio: ['ignore', 'pipe', 'pipe', 'ipc'],
  });
  const captured = await collectChild(child);
  const message = captured.message;
  if (
    message?.kind !== 'official-worker-result' ||
    typeof captured.exitCode !== 'number' ||
    !message.output ||
    !message.environment ||
    !environmentIsExact(message.environment)
  ) {
    process.stderr.write('Validator v2 worker did not return a complete result.\n');
    process.exitCode = 74;
    return;
  }
  try {
    const inputs = await officialInputs();
    await persistValidationRun({
      output: message.output,
      outputPath: OUTPUT_PATH,
      evidencePath: EVIDENCE_PATH,
      cwd: process.cwd(),
      parentEnvironment: captureEnvironment(),
      workerEnvironment: message.environment,
      argv: originalArgv,
      childExitCode: captured.exitCode,
      childStdout: captured.stdout,
      childStderr: captured.stderr,
      validatorSha256: sha256(await readFile(SCRIPT_PATH)),
      validatorTestSha256: sha256(await readFile(path.join(REPOSITORY_ROOT, TEST_PATH))),
      failedValidatorSha256: sha256(inputs.failedValidatorBytes),
      failedValidatorTestSha256: sha256(inputs.failedValidatorTestBytes),
      authoritySha256: sha256(inputs.profileBytes),
      predecessorPlanSha256: sha256(inputs.predecessorPlanBytes),
      predecessorAmendmentSha256: sha256(inputs.predecessorAmendmentBytes),
      planSha256: sha256(inputs.planBytes),
      predecessorProductionManifestSha256: sha256(inputs.predecessorProductionManifestBytes),
      productionManifestSha256: sha256(inputs.productionManifestBytes),
      failureLineageSha256: sha256(inputs.failureLineageBytes),
    });
  } catch (error) {
    process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
    process.exitCode = 74;
    return;
  }
  process.stdout.write(captured.stdout);
  process.stderr.write(captured.stderr);
  process.exitCode = captured.exitCode;
}

async function main() {
  const argv = process.argv.slice(2);
  const mode = modeForArguments(argv);
  if (mode === 'invalid') {
    process.stderr.write('Invalid validator v2 arguments.\n');
    process.exitCode = 64;
    return;
  }
  if (mode === 'gate-worker') await runGateWorker();
  else if (mode === 'gate-worker-inheritance-drift') await runGateWorker(true);
  else if (mode === 'gate-parent') await runGateParent(false);
  else if (mode === 'gate-parent-worker-drift') await runGateParent(true);
  else if (mode === 'official-worker') await runOfficialWorker();
  else await runOfficialParent(argv);
}

if (path.resolve(process.argv[1] ?? '') === SCRIPT_PATH) await main();
