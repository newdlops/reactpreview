/** Coordinates exact official RTCC v4 admission and exclusive compact artifact persistence. */
import { closeSync, existsSync, openSync, readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { V4_MODULE_BINDINGS as MODULE_BINDINGS } from './rtcc-v4-module-policy.mjs';
import { parseJsonl } from './validation/rtcc-v3-structural-telemetry.mjs';
import {
  assertCondition,
  hex,
  PRODUCTION_MANIFEST_PATH,
  sha256,
  PRODUCTION_SHA256,
  ROOT,
  NODE_PATH,
  VALIDATOR_PATH,
  PROFILE_VALIDATION_PATH,
  RUN_EVIDENCE_PATH,
  PLAN_SHA256,
  PREFLIGHT_PATH,
  ATTEMPT_PATH,
  TERMINAL_PATH,
  AUTHORITY_PATH,
  canonicalBytes,
  exact,
} from './rtcc-v4-authority-policy.mjs';
import {
  validatePreflightEvidence,
  validateAttemptStart,
  validateTerminalEvidence,
} from './rtcc-v4-execution-evidence.mjs';
import {
  readReferenceBlockers,
  assertCompactValidationSchema,
  validateCompactTrace,
  buildCompactValidation,
} from './rtcc-v4-compact-validation.mjs';

/** Ordered module filenames shared by admission and reconstructed run-evidence fixtures. */
export const V4_VALIDATOR_MODULE_PATHS = Object.freeze(MODULE_BINDINGS.map(({ path }) => path));

export function parseOfficialArguments(args) {
  assertCondition(Array.isArray(args) && args.length === 7, 'official-argument-count-mismatch');
  assertCondition(
    args[0] === '--official-v5.5.33' &&
      args[1] === '--preflight-sha256' &&
      hex(args[2]) &&
      args[3] === '--terminal-evidence-sha256' &&
      hex(args[4]) &&
      args[5] === '--authority-sha256' &&
      hex(args[6]),
    'official-arguments-invalid',
  );
  return { preflightSha256: args[2], terminalSha256: args[4], authoritySha256: args[6] };
}

function verifyProductionManifest(read) {
  const raw = read(PRODUCTION_MANIFEST_PATH);
  assertCondition(sha256(raw) === PRODUCTION_SHA256, 'production-manifest-sha256-mismatch');
  const lines = raw.toString('utf8').split('\n');
  assertCondition(
    lines.at(-1) === '' && lines.length === 37,
    'production-manifest-contract-mismatch',
  );
  for (const line of lines.slice(0, -1)) {
    const match = /^([a-f0-9]{64})  (.+)$/u.exec(line);
    assertCondition(
      match !== null && sha256(read(resolve(ROOT, match[2]))) === match[1],
      `production-binding-drift:${match?.[2] ?? 'invalid'}`,
    );
  }
}

export function preflightOfficialRun({
  args,
  invocation,
  read = readFileSync,
  exists = existsSync,
}) {
  const parsed = parseOfficialArguments(args);
  assertCondition(
    process.cwd() === ROOT && process.execPath === NODE_PATH && process.version === 'v22.22.2',
    'validator-runtime-identity-mismatch',
  );
  assertCondition(
    JSON.stringify(invocation) ===
      JSON.stringify({
        cwd: ROOT,
        execPath: NODE_PATH,
        argv: [NODE_PATH, VALIDATOR_PATH, ...args],
      }),
    'validator-invocation-mismatch',
  );
  assertCondition(
    !exists(PROFILE_VALIDATION_PATH) && !exists(RUN_EVIDENCE_PATH),
    'validator-output-exists',
  );
  assertCondition(
    sha256(read(`${ROOT}/.plan/rtcc-preview-v5.5.33.md`)) === PLAN_SHA256,
    'plan-sha256-mismatch',
  );
  verifyProductionManifest(read);
  for (const binding of MODULE_BINDINGS)
    assertCondition(
      sha256(read(resolve(ROOT, binding.path))) === binding.sha256,
      `validator-module-drift:${binding.path}`,
    );
  const preflight = validatePreflightEvidence(read(PREFLIGHT_PATH), parsed.preflightSha256, read);
  const attempt = validateAttemptStart(read(ATTEMPT_PATH), read);
  const terminalRaw = read(TERMINAL_PATH);
  const terminal = validateTerminalEvidence(
    terminalRaw,
    parsed.terminalSha256,
    parsed.authoritySha256,
    { preflightIdentity: preflight.identity, attemptIdentity: attempt.identity, read },
  );
  const authorityBytes = read(AUTHORITY_PATH);
  assertCondition(
    sha256(authorityBytes) === parsed.authoritySha256 &&
      authorityBytes.at(-1) === 0x0a &&
      authorityBytes.length === terminal.traceResult.value.byteCount,
    'authority-identity-mismatch',
  );
  const blockers = readReferenceBlockers(read);
  return {
    authorityBytes,
    blockers,
    parsed,
    invocation,
    bindings: [
      { path: '.plan/rtcc-preview-v5.5.33.md', sha256: PLAN_SHA256 },
      { path: '.plan/launchers/rtcc-v5.5.33-production-SHA256SUMS', sha256: PRODUCTION_SHA256 },
      ...MODULE_BINDINGS,
      {
        path: '.plan/launchers/rtcc-v5.5.33-profile-preflight.json',
        sha256: parsed.preflightSha256,
      },
      {
        path: '.plan/launchers/rtcc-v5.5.33-execution-attempt-start.json',
        sha256: attempt.identity.sha256,
      },
      {
        path: '.plan/launchers/rtcc-v5.5.33-execution-terminal-evidence.json',
        sha256: parsed.terminalSha256,
      },
    ],
  };
}

function buildRunEvidence(validation, context) {
  return {
    schemaVersion: 1,
    kind: 'rtcc-preview-compact-validator-run-evidence',
    release: 'v5.5.33',
    invocation: context.invocation,
    authority: validation.authority,
    bindings: context.bindings,
    output: {
      path: '.plan/launchers/rtcc-v5.5.33-profile-validation.json',
      sha256: sha256(canonicalBytes(validation)),
    },
    results: {
      validator: 'pass',
      engine: 'pass',
      routeSemantic: 'pass',
      unresolvedBlockers: 'no-go',
      release: 'no-go',
    },
    runCounts: { validator: 1, profile: 1, external: 0, retry: 0 },
    persistence: {
      exclusive: true,
      order: [
        '.plan/launchers/rtcc-v5.5.33-profile-validation.json',
        '.plan/launchers/rtcc-v5.5.33-validator-run-evidence.json',
      ],
    },
    prohibitedActions: {
      profileRerun: false,
      external: false,
      browser: false,
      chromium: false,
      server: false,
      campaign: false,
    },
  };
}

const RUN_BINDING_PATHS = [
  '.plan/rtcc-preview-v5.5.33.md',
  '.plan/launchers/rtcc-v5.5.33-production-SHA256SUMS',
  ...MODULE_BINDINGS.map(({ path }) => path),
  '.plan/launchers/rtcc-v5.5.33-profile-preflight.json',
  '.plan/launchers/rtcc-v5.5.33-execution-attempt-start.json',
  '.plan/launchers/rtcc-v5.5.33-execution-terminal-evidence.json',
];

function validRunInvocation(value) {
  try {
    return (
      exact(value, ['cwd', 'execPath', 'argv']) &&
      value.cwd === ROOT &&
      value.execPath === NODE_PATH &&
      Array.isArray(value.argv) &&
      value.argv[0] === NODE_PATH &&
      value.argv[1] === VALIDATOR_PATH &&
      parseOfficialArguments(value.argv.slice(2)) !== null
    );
  } catch {
    return false;
  }
}

export function assertRunEvidenceSchema(value, validationBytes) {
  const keys = [
    'schemaVersion',
    'kind',
    'release',
    'invocation',
    'authority',
    'bindings',
    'output',
    'results',
    'runCounts',
    'persistence',
    'prohibitedActions',
  ];
  const valid =
    exact(value, keys) &&
    value.schemaVersion === 1 &&
    value.kind === 'rtcc-preview-compact-validator-run-evidence' &&
    value.release === 'v5.5.33' &&
    validRunInvocation(value.invocation) &&
    exact(value.authority, ['path', 'sha256', 'byteCount', 'lineCount']) &&
    value.authority.path === AUTHORITY_PATH &&
    hex(value.authority.sha256) &&
    value.authority.lineCount === 1530 &&
    Array.isArray(value.bindings) &&
    JSON.stringify(value.bindings.map(({ path }) => path)) === JSON.stringify(RUN_BINDING_PATHS) &&
    value.bindings.every((binding) => exact(binding, ['path', 'sha256']) && hex(binding.sha256)) &&
    value.bindings[0].sha256 === PLAN_SHA256 &&
    value.bindings[1].sha256 === PRODUCTION_SHA256 &&
    MODULE_BINDINGS.every(
      (binding, index) => value.bindings[index + 2].sha256 === binding.sha256,
    ) &&
    exact(value.output, ['path', 'sha256']) &&
    value.output.path === '.plan/launchers/rtcc-v5.5.33-profile-validation.json' &&
    value.output.sha256 === sha256(validationBytes) &&
    JSON.stringify(value.results) ===
      JSON.stringify({
        validator: 'pass',
        engine: 'pass',
        routeSemantic: 'pass',
        unresolvedBlockers: 'no-go',
        release: 'no-go',
      }) &&
    JSON.stringify(value.runCounts) ===
      JSON.stringify({ validator: 1, profile: 1, external: 0, retry: 0 }) &&
    JSON.stringify(value.persistence) ===
      JSON.stringify({
        exclusive: true,
        order: [
          '.plan/launchers/rtcc-v5.5.33-profile-validation.json',
          '.plan/launchers/rtcc-v5.5.33-validator-run-evidence.json',
        ],
      }) &&
    exact(value.prohibitedActions, [
      'profileRerun',
      'external',
      'browser',
      'chromium',
      'server',
      'campaign',
    ]) &&
    JSON.stringify(value.prohibitedActions) ===
      JSON.stringify({
        profileRerun: false,
        external: false,
        browser: false,
        chromium: false,
        server: false,
        campaign: false,
      });
  if (!valid) throw new Error('compact-run-evidence-schema-drift');
  return true;
}

export function writeExclusiveBytes(path, bytes) {
  let descriptor;
  try {
    descriptor = openSync(path, 'wx', 0o600);
    writeFileSync(descriptor, bytes);
  } finally {
    if (descriptor !== undefined) closeSync(descriptor);
  }
}

export function persistCompactArtifacts({
  paths = [PROFILE_VALIDATION_PATH, RUN_EVIDENCE_PATH],
  validation,
  context,
  write = writeExclusiveBytes,
}) {
  assertCondition(Array.isArray(paths) && paths.length === 2, 'compact-output-paths-invalid');
  assertCompactValidationSchema(validation);
  const validationBytes = canonicalBytes(validation);
  const evidence = buildRunEvidence(validation, context);
  const evidenceBytes = canonicalBytes(evidence);
  assertRunEvidenceSchema(evidence, validationBytes);
  write(paths[0], validationBytes);
  write(paths[1], evidenceBytes);
  return { validation, evidence, bytes: [validationBytes, evidenceBytes] };
}

async function official() {
  const args = process.argv.slice(2);
  const invocation = { cwd: process.cwd(), execPath: process.execPath, argv: [...process.argv] };
  const preflight = preflightOfficialRun({ args, invocation });
  const records = parseJsonl(preflight.authorityBytes);
  const report = validateCompactTrace(records, preflight.blockers);
  const validation = buildCompactValidation(preflight.authorityBytes, report);
  persistCompactArtifacts({ validation, context: preflight });
  process.stdout.write('rtcc-preview-profile-validator v4 NO-GO\n');
  process.exitCode = 1;
}

if (
  process.argv[1] !== undefined &&
  resolve(process.argv[1]) === fileURLToPath(import.meta.url) &&
  process.argv[2] === '--official-v5.5.33'
)
  await official();
export { AUTHORITY_POLICY } from './rtcc-v4-authority-policy.mjs';
export { V4_PATHS } from './rtcc-v4-authority-policy.mjs';
export { sha256 } from './rtcc-v4-authority-policy.mjs';
export { expectedExecutorHashBindings } from './rtcc-v4-authority-policy.mjs';
export { readReferenceBlockers } from './rtcc-v4-compact-validation.mjs';
export { validateCompactTrace } from './rtcc-v4-compact-validation.mjs';
export { buildCompactValidation } from './rtcc-v4-compact-validation.mjs';
export { assertCompactValidationSchema } from './rtcc-v4-compact-validation.mjs';
export { validatePreflightEvidence } from './rtcc-v4-execution-evidence.mjs';
export { validateAttemptStart } from './rtcc-v4-execution-evidence.mjs';
export { validateTerminalEvidence } from './rtcc-v4-execution-evidence.mjs';
