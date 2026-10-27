/** Validates and persists official RTCC v3 artifacts against exact authority and predecessor evidence. */
import { existsSync, lstatSync, readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { validateInventoryExecutionPlan } from './rtcc-v3-inventory-execution-plan.mjs';
import {
  evaluateRouteSemantics,
  requireAuthoritySemanticFailure,
} from './rtcc-v3-route-semantics.mjs';
import { parseJsonl, validateStructuralTelemetry } from './rtcc-v3-structural-telemetry.mjs';
import {
  exact,
  root,
  nodePath,
  authorityPathFixed,
  authoritySha256Fixed,
  boundFiles,
  binding,
  productionManifestPath,
  productionManifestSha256,
  commandPrefix,
  finalArgumentRelation,
  noPlaceholder,
  planFiles,
  gateRelative,
  hex,
  authorityBytesFixed,
  orderedViolations,
  orderedBlockers,
  validActions,
  validatorRelative,
  outputRelative,
  sha256,
  authorityPolicy,
  canonical,
  hashFile,
  confined,
  predecessorSpecs,
  falseActions,
} from './rtcc-v3-official-policy.mjs';
import { completePredecessors } from './rtcc-v3-predecessor-evidence.mjs';

export function assertGateSchema(value, expected = {}) {
  const keys = [
    'schemaVersion',
    'kind',
    'preOfficialSolReview',
    'cwd',
    'node',
    'authority',
    'bindings',
    'productionManifest',
    'command',
  ];
  const valid =
    exact(value, keys) &&
    value.schemaVersion === 1 &&
    value.kind === 'rtcc-v5.5.31-validator-gate' &&
    exact(value.preOfficialSolReview, ['status', 'recordedAt']) &&
    value.preOfficialSolReview.status === 'PASS' &&
    typeof value.preOfficialSolReview.recordedAt === 'string' &&
    !Number.isNaN(Date.parse(value.preOfficialSolReview.recordedAt)) &&
    value.cwd === root &&
    exact(value.node, ['path', 'version']) &&
    value.node.path === nodePath &&
    value.node.version === 'v22.22.2' &&
    exact(value.authority, ['path', 'sha256']) &&
    value.authority.path === authorityPathFixed &&
    value.authority.sha256 === authoritySha256Fixed &&
    Array.isArray(value.bindings) &&
    value.bindings.length === boundFiles.length &&
    value.bindings.every((item, index) => binding(item) && item.path === boundFiles[index]) &&
    exact(value.productionManifest, ['path', 'sha256', 'entries']) &&
    value.productionManifest.path === productionManifestPath &&
    value.productionManifest.sha256 === productionManifestSha256 &&
    value.productionManifest.entries === 35 &&
    exact(value.command, ['fixedArgumentPrefix', 'finalArgumentRelation']) &&
    JSON.stringify(value.command.fixedArgumentPrefix) === JSON.stringify(commandPrefix) &&
    value.command.finalArgumentRelation === finalArgumentRelation &&
    (!expected.bindings || JSON.stringify(value.bindings) === JSON.stringify(expected.bindings)) &&
    noPlaceholder(value);
  if (!valid) throw new Error('gate-schema-drift');
  return true;
}

export function assertLineageSchema(value, expected = {}) {
  const keys = [
    'schemaVersion',
    'kind',
    'releaseResult',
    'validatorResult',
    'plans',
    'gate',
    'authority',
    'productionManifest',
    'predecessors',
    'structuralResult',
    'engineTerminal',
    'semantic',
    'currentRun',
    'prohibitedActions',
    'cannotConvertEngineCompletionToReleaseGo',
  ];
  const plans = expected.moduleHashes?.filter((item) => planFiles.includes(item.path));
  const valid =
    exact(value, keys) &&
    value.schemaVersion === 1 &&
    value.kind === 'semantic-failure-lineage' &&
    value.releaseResult === 'no-go' &&
    value.validatorResult === 'fail' &&
    Array.isArray(value.plans) &&
    value.plans.length === 4 &&
    value.plans.every((item, index) => binding(item) && item.path === planFiles[index]) &&
    (!plans || JSON.stringify(value.plans) === JSON.stringify(plans)) &&
    exact(value.gate, ['path', 'sha256']) &&
    value.gate.path === gateRelative &&
    hex(value.gate.sha256) &&
    (!expected.gateSha256 || value.gate.sha256 === expected.gateSha256) &&
    exact(value.authority, ['path', 'sha256', 'bytes', 'lines']) &&
    value.authority.path === authorityPathFixed &&
    value.authority.sha256 === authoritySha256Fixed &&
    value.authority.bytes === authorityBytesFixed &&
    value.authority.lines === 1530 &&
    exact(value.productionManifest, ['path', 'sha256', 'entries', 'productionChanged']) &&
    value.productionManifest.path === productionManifestPath &&
    value.productionManifest.sha256 === productionManifestSha256 &&
    value.productionManifest.entries === 35 &&
    value.productionManifest.productionChanged === false &&
    completePredecessors(value.predecessors) &&
    value.structuralResult === 'pass' &&
    exact(value.engineTerminal, ['status', 'executionPlanCompleted', 'executionPlanTotal']) &&
    value.engineTerminal.status === 'completed' &&
    value.engineTerminal.executionPlanCompleted === 681 &&
    value.engineTerminal.executionPlanTotal === 681 &&
    exact(value.semantic, ['result', 'violations', 'blockers']) &&
    value.semantic.result === 'fail' &&
    orderedViolations(value.semantic.violations) &&
    orderedBlockers(value.semantic.blockers) &&
    exact(value.currentRun, ['officialRunCount', 'externalRunCount', 'retryCount']) &&
    value.currentRun.officialRunCount === 1 &&
    value.currentRun.externalRunCount === 0 &&
    value.currentRun.retryCount === 0 &&
    validActions(value.prohibitedActions) &&
    value.cannotConvertEngineCompletionToReleaseGo === true &&
    noPlaceholder(value);
  if (!valid) throw new Error('lineage-schema-drift');
  return true;
}

export function assertEvidenceSchema(value, expected = {}) {
  const keys = [
    'schemaVersion',
    'kind',
    'invocation',
    'gate',
    'gateContentVerified',
    'bindings',
    'authority',
    'preflight',
    'officialRunCount',
    'expectedExitCode',
    'retryCount',
    'externalRunCount',
    'prohibitedActions',
    'persistenceOrder',
    'outputHashes',
  ];
  const approved = [...commandPrefix, value?.gate?.sha256];
  const actualArgv = [nodePath, resolve(root, validatorRelative), ...approved];
  const valid =
    exact(value, keys) &&
    value.schemaVersion === 1 &&
    value.kind === 'validator-run-evidence' &&
    exact(value.invocation, [
      'cwd',
      'execPath',
      'argv',
      'approvedTokens',
      'finalArgumentRelation',
    ]) &&
    value.invocation.cwd === root &&
    value.invocation.execPath === nodePath &&
    JSON.stringify(value.invocation.argv) === JSON.stringify(actualArgv) &&
    JSON.stringify(value.invocation.approvedTokens) === JSON.stringify(approved) &&
    value.invocation.finalArgumentRelation === finalArgumentRelation &&
    exact(value.gate, ['path', 'sha256']) &&
    value.gate.path === gateRelative &&
    hex(value.gate.sha256) &&
    (!expected.gateSha256 || value.gate.sha256 === expected.gateSha256) &&
    value.gateContentVerified === true &&
    Array.isArray(value.bindings) &&
    value.bindings.length === boundFiles.length &&
    value.bindings.every((item, index) => binding(item) && item.path === boundFiles[index]) &&
    (!expected.moduleHashes ||
      JSON.stringify(value.bindings) === JSON.stringify(expected.moduleHashes)) &&
    exact(value.authority, ['path', 'sha256', 'bytes', 'lines']) &&
    value.authority.path === authorityPathFixed &&
    value.authority.sha256 === authoritySha256Fixed &&
    value.authority.bytes === authorityBytesFixed &&
    value.authority.lines === 1530 &&
    exact(value.preflight, ['reservedOutputsAbsent']) &&
    value.preflight.reservedOutputsAbsent === true &&
    value.officialRunCount === 1 &&
    value.expectedExitCode === 1 &&
    value.retryCount === 0 &&
    value.externalRunCount === 0 &&
    validActions(value.prohibitedActions) &&
    JSON.stringify(value.persistenceOrder) === JSON.stringify(outputRelative) &&
    exact(value.outputHashes, ['profileValidation', 'semanticReport', 'lineage']) &&
    Object.values(value.outputHashes).every(hex) &&
    (!expected.bytes ||
      (value.outputHashes.profileValidation === sha256(expected.bytes[0]) &&
        value.outputHashes.semanticReport === sha256(expected.bytes[1]) &&
        value.outputHashes.lineage === sha256(expected.bytes[2]))) &&
    noPlaceholder(value);
  if (!valid) throw new Error('evidence-schema-drift');
  return true;
}

const payloadKeys = [
  'schemaVersion',
  'validator',
  'authority',
  'authorityBytes',
  'externalRunCount',
  'noRetry',
  'productionChanged',
  'checks',
  'header',
  'engineTerminal',
  'progressCount',
  'bundleCount',
  'inventory',
  'violations',
  'blockers',
  'firstViolation',
  'firstBlocker',
  'structuralResult',
  'semanticResult',
  'releaseResult',
  'kind',
];

let authorityReconstructionCache;

function reconstructAuthorityReport(authorityBytes) {
  if (authorityReconstructionCache?.bytes === authorityBytes)
    return authorityReconstructionCache.report;
  const records = parseJsonl(authorityBytes);
  const structural = validateStructuralTelemetry(records, authorityPolicy.structural);
  const inventory = validateInventoryExecutionPlan(
    records.at(-1)?.inventory,
    authorityPolicy.inventory,
  );
  const semantic = evaluateRouteSemantics(records.at(-1)?.inventory?.entries ?? []);
  const checks = [...structural.checks, ...inventory.checks];
  if (
    structural.checks.length !== 24 ||
    inventory.checks.length !== 4932 ||
    checks.length !== 4956 ||
    checks.some(
      (check) =>
        !exact(
          check,
          check.detail === undefined ? ['name', 'passed'] : ['name', 'passed', 'detail'],
        ) ||
        typeof check.name !== 'string' ||
        check.passed !== true ||
        (check.detail !== undefined && typeof check.detail !== 'string'),
    )
  )
    throw new Error('authority-check-schema-drift');
  const report = {
    ...structural,
    ...inventory,
    ...semantic,
    structuralResult: 'pass',
    semanticResult: 'fail',
    releaseResult: 'no-go',
    checks,
  };
  if (
    records.length !== 1530 ||
    report.engineTerminal?.status !== 'completed' ||
    report.engineTerminal.executionPlanCompleted !== 681 ||
    report.engineTerminal.executionPlanTotal !== 681 ||
    report.progressCount !== 1528 ||
    report.bundleCount !== 68 ||
    report.firstViolation !== report.violations[0] ||
    report.firstBlocker !== report.blockers[0]
  )
    throw new Error('authority-report-drift');
  requireAuthoritySemanticFailure(report);
  authorityReconstructionCache = { bytes: authorityBytes, report };
  return report;
}

function assertOfficialPayload(value, kind) {
  const identityValid =
    exact(value, payloadKeys) &&
    value.schemaVersion === 3 &&
    value.validator === 'rtcc-preview-complete-route-profile-v3' &&
    value.kind === kind &&
    exact(value.authority, ['path', 'sha256', 'lineCount']) &&
    value.authority.path === authorityPathFixed &&
    value.authority.sha256 === authoritySha256Fixed &&
    value.authority.lineCount === 1530 &&
    typeof value.authorityBytes === 'string' &&
    Buffer.byteLength(value.authorityBytes) === authorityBytesFixed &&
    sha256(value.authorityBytes) === authoritySha256Fixed &&
    value.externalRunCount === 0 &&
    value.noRetry === true &&
    value.productionChanged === false;
  let report;
  try {
    report = identityValid ? reconstructAuthorityReport(value.authorityBytes) : undefined;
  } catch {
    report = undefined;
  }
  const expected = report && {
    schemaVersion: 3,
    validator: 'rtcc-preview-complete-route-profile-v3',
    authority: { path: authorityPathFixed, sha256: authoritySha256Fixed, lineCount: 1530 },
    authorityBytes: value.authorityBytes,
    externalRunCount: 0,
    noRetry: true,
    productionChanged: false,
    ...report,
    kind,
  };
  const valid =
    identityValid &&
    report &&
    orderedViolations(value.violations) &&
    orderedBlockers(value.blockers) &&
    canonical(value) === canonical(expected);
  if (!valid) throw new Error(`${kind}-schema-drift`);
  return true;
}

export const assertProfileValidationSchema = (value) =>
  assertOfficialPayload(value, 'profile-validation');

export const assertSemanticReportSchema = (value) =>
  assertOfficialPayload(value, 'semantic-report');

export function assertManifestSchema(value, expected = {}) {
  if (
    !exact(value, ['schemaVersion', 'kind', 'inputs', 'results']) ||
    value.schemaVersion !== 1 ||
    value.kind !== 'artifact-manifest' ||
    !Array.isArray(value.inputs) ||
    value.inputs.length !== 1 ||
    value.inputs[0].path !== gateRelative ||
    !binding(value.inputs[0]) ||
    !Array.isArray(value.results) ||
    value.results.length !== 4 ||
    value.results.some((entry, index) => !binding(entry) || entry.path !== outputRelative[index]) ||
    new Set(
      value.results.map((entry) => entry.path).concat(value.inputs.map((entry) => entry.path)),
    ).size !== 5 ||
    (expected.gateSha256 && value.inputs[0].sha256 !== expected.gateSha256) ||
    (expected.bytes &&
      value.results.some((entry, index) => entry.sha256 !== sha256(expected.bytes[index]))) ||
    !noPlaceholder(value)
  )
    throw new Error('manifest-schema-drift');
  return true;
}

export function assertSumsSchema(bytes, expected = {}) {
  const lines = String(bytes).split('\n');
  if (lines.at(-1) !== '' || lines.length !== 6) throw new Error('sums-schema-drift');
  const parsed = lines.slice(0, -1).map((line) => /^([a-f0-9]{64})  (.+)$/.exec(line));
  if (
    parsed.some((match) => !match) ||
    parsed.map((match) => match[2]).join('\0') !== outputRelative.slice(0, 5).join('\0') ||
    new Set(parsed.map((match) => match[2])).size !== 5 ||
    (expected.bytes && parsed.some((match, index) => match[1] !== sha256(expected.bytes[index]))) ||
    !noPlaceholder(bytes)
  )
    throw new Error('sums-schema-drift');
  return true;
}

/**
 * Writes verified canonical artifact text with the official phase's exclusive-create options.
 * @param {string} file Confined absolute artifact filename.
 * @param {string} contents Exact canonical UTF-8 text already validated by the caller.
 * @param {import('node:fs').WriteFileOptions} options Exclusive-create persistence options.
 * @returns {void}
 */
function writeOfficialArtifact(file, contents, options) {
  writeFileSync(file, contents, options);
}

/**
 * @typedef {object} ValidatorGateOptions
 * @property {string} [cwd] Exact approved project root.
 * @property {string} [gatePath] Confined gate filename.
 * @property {{status: string, recordedAt: string}} [preOfficialSolReview] Required recorded review.
 * @property {typeof writeOfficialArtifact} [writeFile] Persists canonical text with exclusive create.
 * @property {(file: string) => Buffer} [readFile] Reads raw bytes of one bound absolute filename.
 */

/**
 * Builds the gate against exact current input bytes before its sole exclusive write.
 * @param {ValidatorGateOptions} options Approved root, review, reader, and writer dependencies.
 */
export function buildValidatorGate({
  cwd = root,
  gatePath = resolve(cwd, gateRelative),
  preOfficialSolReview,
  writeFile = writeOfficialArtifact,
  readFile = readFileSync,
}) {
  if (
    !preOfficialSolReview ||
    preOfficialSolReview.status !== 'PASS' ||
    typeof preOfficialSolReview.recordedAt !== 'string'
  )
    throw new Error('pre-official-sol-pass-required');
  if (resolve(cwd) !== root || resolve(gatePath) !== resolve(cwd, gateRelative))
    throw new Error('gate-location-required');
  const bindings = boundFiles.map((file) => ({
    path: file,
    sha256: hashFile(cwd, file, readFile),
  }));
  const gate = {
    schemaVersion: 1,
    kind: 'rtcc-v5.5.31-validator-gate',
    preOfficialSolReview: { status: 'PASS', recordedAt: preOfficialSolReview.recordedAt },
    cwd: root,
    node: { path: nodePath, version: 'v22.22.2' },
    authority: { path: authorityPathFixed, sha256: authoritySha256Fixed },
    bindings,
    productionManifest: {
      path: productionManifestPath,
      sha256: productionManifestSha256,
      entries: 35,
    },
    command: { fixedArgumentPrefix: [...commandPrefix], finalArgumentRelation },
  };
  assertGateSchema(gate, { bindings });
  const bytes = canonical(gate);
  writeFile(gatePath, bytes, { encoding: 'utf8', flag: 'wx' });
  return { gate, bytes, sha256: sha256(bytes) };
}

function verifyProductionManifest(cwd, readFile) {
  const bytes = readFile(resolve(cwd, productionManifestPath));
  const lines = bytes.toString('utf8').trimEnd().split('\n');
  if (
    sha256(bytes) !== productionManifestSha256 ||
    lines.length !== 35 ||
    lines.some((line) => {
      const hit = /^([a-f0-9]{64})  (.+)$/.exec(line);
      return !hit || !confined(cwd, hit[2]) || sha256(readFile(resolve(cwd, hit[2]))) !== hit[1];
    })
  )
    throw new Error('production-manifest-drift');
}

function predecessorFacts(cwd, readFile) {
  const facts = { complete: true };
  for (const [key, path, expectedHash, json] of predecessorSpecs) {
    const bytes = readFile(resolve(cwd, path));
    if (sha256(bytes) !== expectedHash) throw new Error(`predecessor-identity-drift:${key}`);
    if (json) {
      let value;
      try {
        value = JSON.parse(bytes.toString('utf8'));
      } catch {
        throw new Error(`predecessor-json-drift:${key}`);
      }
      if (canonical(value) !== bytes.toString('utf8'))
        throw new Error(`predecessor-canonical-drift:${key}`);
      facts[key] = { path, sha256: expectedHash, value };
    } else facts[key] = { path, sha256: expectedHash };
  }
  if (!completePredecessors(facts)) throw new Error('predecessor-evidence-incomplete');
  return facts;
}

/**
 * @typedef {object} OfficialPreflightOptions
 * @property {string} cwd Exact approved project root.
 * @property {string[]} argv Official validator arguments, including the raw gate hash.
 * @property {string} authorityPath Expected immutable profile path.
 * @property {string} authorityHash Expected immutable profile SHA-256.
 * @property {{cwd: string, execPath: string, argv: string[]}} [invocation] Recorded process identity.
 * @property {(file: string, encoding?: BufferEncoding) => string | Buffer} [readFile] Reads exact artifact bytes or encoded text.
 * @property {(file: string) => {isFile: () => boolean, isSymbolicLink: () => boolean}} [lstat] Inspects the gate without following symbolic links.
 * @property {(file: string) => boolean} [exists] Checks whether a reserved output already exists.
 */

/**
 * Verifies runtime identity, original evidence, and reserved outputs before any official write.
 * @param {OfficialPreflightOptions} options Exact invocation inputs and filesystem dependencies.
 * @throws {Error} When any identity, artifact, hash, or confinement check fails.
 */
export function preflightOfficialRun({
  cwd,
  argv,
  authorityPath,
  authorityHash,
  invocation = { cwd: process.cwd(), execPath: process.execPath, argv: [...process.argv] },
  readFile = readFileSync,
  lstat = lstatSync,
  exists = existsSync,
}) {
  if (
    resolve(cwd) !== root ||
    invocation.cwd !== cwd ||
    invocation.execPath !== nodePath ||
    process.execPath !== nodePath ||
    process.version !== 'v22.22.2' ||
    JSON.stringify(invocation.argv) !==
      JSON.stringify([nodePath, resolve(cwd, validatorRelative), ...argv])
  )
    throw new Error('runtime-or-cwd-identity-drift');
  if (
    !Array.isArray(argv) ||
    argv.length !== 5 ||
    JSON.stringify(argv.slice(0, 4)) !== JSON.stringify(commandPrefix) ||
    !hex(argv[4]) ||
    !noPlaceholder(argv)
  )
    throw new Error('official-argv-required');
  const gatePath = resolve(cwd, gateRelative);
  let stat;
  try {
    stat = lstat(gatePath);
  } catch {
    throw new Error('gate-required');
  }
  if (!stat.isFile() || stat.isSymbolicLink()) throw new Error('gate-type-required');
  const gateBytes = readFile(gatePath);
  if (sha256(gateBytes) !== argv[4]) throw new Error('gate-raw-hash-drift');
  let gate;
  try {
    gate = JSON.parse(gateBytes.toString('utf8'));
  } catch {
    throw new Error('gate-canonical-drift');
  }
  if (canonical(gate) !== gateBytes.toString('utf8')) throw new Error('gate-canonical-drift');
  const actualBindings = boundFiles.map((path) => ({
    path,
    sha256: hashFile(cwd, path, readFile),
  }));
  assertGateSchema(gate, { bindings: actualBindings });
  if (gate.authority.path !== authorityPath || gate.authority.sha256 !== authorityHash)
    throw new Error('gate-binding-drift');
  verifyProductionManifest(cwd, readFile);
  const predecessors = predecessorFacts(cwd, readFile);
  const paths = outputRelative.map((file) => resolve(cwd, file));
  if (paths.some(exists)) throw new Error('reserved-output-exists');
  const authorityBytes = readFile(authorityPath, 'utf8');
  if (
    sha256(authorityBytes) !== authorityHash ||
    Buffer.byteLength(authorityBytes) !== authorityBytesFixed
  )
    throw new Error('authority-identity-drift');
  return {
    cwd,
    paths,
    authorityBytes,
    gate,
    gateSha256: argv[4],
    moduleHashes: gate.bindings,
    predecessors,
    invocation: {
      cwd: invocation.cwd,
      execPath: invocation.execPath,
      argv: [...invocation.argv],
      approvedTokens: [...argv],
      finalArgumentRelation: gate.command.finalArgumentRelation,
    },
  };
}

export function persistOfficialArtifacts({
  paths,
  body,
  expectedExitCode,
  moduleHashes,
  gate,
  gateSha256,
  predecessors,
  invocation,
  writeFile = writeOfficialArtifact,
}) {
  if (
    !Array.isArray(paths) ||
    paths.length !== 6 ||
    paths.some((path) => typeof path !== 'string') ||
    !gate ||
    !hex(gateSha256) ||
    !invocation ||
    expectedExitCode !== 1
  )
    throw new Error('artifact-input-required');
  assertGateSchema(gate, { bindings: moduleHashes });
  const authority = {
    path: body.authority.path,
    sha256: body.authority.sha256,
    bytes: Buffer.byteLength(body.authorityBytes),
    lines: body.authority.lineCount,
  };
  const plans = moduleHashes.filter((item) => planFiles.includes(item.path));
  const lineage = {
    schemaVersion: 1,
    kind: 'semantic-failure-lineage',
    releaseResult: body.releaseResult,
    validatorResult: body.semanticResult,
    plans,
    gate: { path: gateRelative, sha256: gateSha256 },
    authority,
    productionManifest: {
      path: productionManifestPath,
      sha256: productionManifestSha256,
      entries: 35,
      productionChanged: false,
    },
    predecessors,
    structuralResult: body.structuralResult,
    engineTerminal: body.engineTerminal,
    semantic: { result: body.semanticResult, violations: body.violations, blockers: body.blockers },
    currentRun: { officialRunCount: 1, externalRunCount: 0, retryCount: 0 },
    prohibitedActions: falseActions(),
    cannotConvertEngineCompletionToReleaseGo: true,
  };
  const validation = { ...body, kind: 'profile-validation' },
    semantic = { ...body, kind: 'semantic-report' };
  assertProfileValidationSchema(validation);
  assertSemanticReportSchema(semantic);
  if (canonical({ ...validation, kind: 'semantic-report' }) !== canonical(semantic))
    throw new Error('official-payload-pair-drift');
  assertLineageSchema(lineage, { gateSha256, moduleHashes });
  const first = [validation, semantic, lineage],
    firstBytes = first.map(canonical);
  const evidence = {
    schemaVersion: 1,
    kind: 'validator-run-evidence',
    invocation,
    gate: { path: gateRelative, sha256: gateSha256 },
    gateContentVerified: true,
    bindings: moduleHashes,
    authority,
    preflight: { reservedOutputsAbsent: true },
    officialRunCount: 1,
    expectedExitCode,
    retryCount: 0,
    externalRunCount: 0,
    prohibitedActions: falseActions(),
    persistenceOrder: [...outputRelative],
    outputHashes: {
      profileValidation: sha256(firstBytes[0]),
      semanticReport: sha256(firstBytes[1]),
      lineage: sha256(firstBytes[2]),
    },
  };
  assertEvidenceSchema(evidence, { gateSha256, moduleHashes, bytes: firstBytes });
  const evidenceBytes = canonical(evidence);
  const manifest = {
    schemaVersion: 1,
    kind: 'artifact-manifest',
    inputs: [{ path: gateRelative, sha256: gateSha256 }],
    results: outputRelative
      .slice(0, 4)
      .map((path, index) => ({ path, sha256: sha256([...firstBytes, evidenceBytes][index]) })),
  };
  assertManifestSchema(manifest, { gateSha256, bytes: [...firstBytes, evidenceBytes] });
  const manifestBytes = canonical(manifest);
  const sums =
    outputRelative
      .slice(0, 5)
      .map(
        (path, index) => `${sha256([...firstBytes, evidenceBytes, manifestBytes][index])}  ${path}`,
      )
      .join('\n') + '\n';
  assertSumsSchema(sums, { bytes: [...firstBytes, evidenceBytes, manifestBytes] });
  const bytes = [...firstBytes, evidenceBytes, manifestBytes, sums];
  for (const [index, value] of bytes.entries())
    writeFile(paths[index], value, { encoding: 'utf8', flag: 'wx' });
  return { bytes, validation, semantic, manifest, evidence, lineage };
}
export { rtccV3BoundFiles } from './rtcc-v3-official-policy.mjs';
export { rtccV3OutputFiles } from './rtcc-v3-official-policy.mjs';
