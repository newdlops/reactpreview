/** Validates compact route telemetry and its exact reference-bound output schema. */
import { readFileSync } from 'node:fs';
import {
  validateStructuralTelemetry,
  parseJsonl,
} from './validation/rtcc-v3-structural-telemetry.mjs';
import { validateInventoryExecutionPlan } from './validation/rtcc-v3-inventory-execution-plan.mjs';
import { evaluateRouteSemantics } from './validation/rtcc-v3-route-semantics.mjs';
import {
  REFERENCE_PATH,
  assertCondition,
  sha256,
  REFERENCE_SHA256,
  REFERENCE_BLOCKERS_SHA256,
  AUTHORITY_POLICY,
  AUTHORITY_PATH,
  PRODUCTION_SHA256,
  exact,
  hex,
} from './rtcc-v4-authority-policy.mjs';

/**
 * Reads the reference only after validating its complete byte and ordered blocker identities.
 * @param {(path: string) => Buffer} [read] Read-only reference byte dependency.
 */
export function readReferenceBlockers(read = readFileSync) {
  const raw = read(REFERENCE_PATH);
  assertCondition(sha256(raw) === REFERENCE_SHA256, 'reference-semantic-report-sha256-mismatch');
  const value = JSON.parse(raw.toString('utf8'));
  assertCondition(
    value.kind === 'semantic-report' &&
      value.semanticResult === 'fail' &&
      value.releaseResult === 'no-go' &&
      Array.isArray(value.blockers) &&
      value.blockers.length === 18,
    'reference-semantic-report-contract-mismatch',
  );
  assertCondition(
    sha256(JSON.stringify(value.blockers)) === REFERENCE_BLOCKERS_SHA256,
    'reference-blockers-sha256-mismatch',
  );
  return value.blockers;
}

export function validateCompactTrace(records, expectedBlockers, policy = AUTHORITY_POLICY) {
  const structural = validateStructuralTelemetry(records, policy.structural);
  const inventory = validateInventoryExecutionPlan(records.at(-1)?.inventory, policy.inventory);
  const semantic = evaluateRouteSemantics(records.at(-1)?.inventory?.entries ?? []);
  const structuralFailed = structural.checks.filter((check) => !check.passed);
  const inventoryFailed = inventory.checks.filter((check) => !check.passed);
  assertCondition(
    structural.checks.length === 24 && structuralFailed.length === 0,
    'structural-validation-failed',
  );
  assertCondition(
    inventory.checks.length === 4932 && inventoryFailed.length === 0,
    'inventory-validation-failed',
  );
  assertCondition(
    structural.engineTerminal?.status === 'completed' &&
      structural.engineTerminal.executionPlanCompleted === 681 &&
      structural.engineTerminal.executionPlanTotal === 681,
    'engine-terminal-failed',
  );
  assertCondition(semantic.violations.length === 0, 'route-semantic-violations-present');
  assertCondition(
    Array.isArray(expectedBlockers) &&
      expectedBlockers.length === 18 &&
      JSON.stringify(semantic.blockers) === JSON.stringify(expectedBlockers),
    'unresolved-blocker-drift',
  );
  return {
    validatorResult: 'pass',
    structuralResult: 'pass',
    engineResult: 'pass',
    routeSemanticResult: 'pass',
    unresolvedBlockerResult: 'no-go',
    releaseResult: 'no-go',
    checkSummary: {
      structural: { passed: 24, failed: 0, total: 24 },
      inventory: { passed: 4932, failed: 0, total: 4932 },
    },
    telemetry: { progressCount: structural.progressCount, bundleCount: structural.bundleCount },
    engineTerminal: structural.engineTerminal,
    inventoryCounts: inventory.inventory.counts,
    routeSemanticViolationCount: 0,
    unresolvedBlockers: semantic.blockers,
  };
}

export const VALIDATION_KEYS = [
  'schemaVersion',
  'kind',
  'release',
  'validator',
  'authority',
  'production',
  'reference',
  'validatorResult',
  'structuralResult',
  'engineResult',
  'routeSemanticResult',
  'unresolvedBlockerResult',
  'releaseResult',
  'checkSummary',
  'telemetry',
  'engineTerminal',
  'inventoryCounts',
  'routeSemanticViolationCount',
  'unresolvedBlockers',
];

export function buildCompactValidation(authorityBytes, report) {
  const records = parseJsonl(authorityBytes);
  const value = {
    schemaVersion: 4,
    kind: 'rtcc-preview-compact-profile-validation',
    release: 'v5.5.33',
    validator: 'rtcc-preview-complete-route-profile-v4',
    authority: {
      path: AUTHORITY_PATH,
      sha256: sha256(authorityBytes),
      byteCount: Buffer.byteLength(authorityBytes),
      lineCount: records.length,
    },
    production: {
      manifestPath: '.plan/launchers/rtcc-v5.5.33-production-SHA256SUMS',
      sha256: PRODUCTION_SHA256,
      entries: 36,
    },
    reference: {
      path: '.plan/launchers/rtcc-v5.5.31-semantic-report.json',
      sha256: REFERENCE_SHA256,
      blockerSha256: REFERENCE_BLOCKERS_SHA256,
    },
    ...report,
  };
  assertCompactValidationSchema(value);
  return value;
}

export function assertCompactValidationSchema(value) {
  const valid =
    exact(value, VALIDATION_KEYS) &&
    value.schemaVersion === 4 &&
    value.kind === 'rtcc-preview-compact-profile-validation' &&
    value.release === 'v5.5.33' &&
    value.validator === 'rtcc-preview-complete-route-profile-v4' &&
    exact(value.authority, ['path', 'sha256', 'byteCount', 'lineCount']) &&
    value.authority.path === AUTHORITY_PATH &&
    hex(value.authority.sha256) &&
    Number.isSafeInteger(value.authority.byteCount) &&
    value.authority.byteCount > 0 &&
    value.authority.lineCount === 1530 &&
    exact(value.production, ['manifestPath', 'sha256', 'entries']) &&
    value.production.sha256 === PRODUCTION_SHA256 &&
    value.production.entries === 36 &&
    exact(value.reference, ['path', 'sha256', 'blockerSha256']) &&
    value.reference.sha256 === REFERENCE_SHA256 &&
    value.reference.blockerSha256 === REFERENCE_BLOCKERS_SHA256 &&
    value.validatorResult === 'pass' &&
    value.structuralResult === 'pass' &&
    value.engineResult === 'pass' &&
    value.routeSemanticResult === 'pass' &&
    value.unresolvedBlockerResult === 'no-go' &&
    value.releaseResult === 'no-go' &&
    JSON.stringify(value.checkSummary) ===
      JSON.stringify({
        structural: { passed: 24, failed: 0, total: 24 },
        inventory: { passed: 4932, failed: 0, total: 4932 },
      }) &&
    value.telemetry?.progressCount === 1528 &&
    value.telemetry?.bundleCount === 68 &&
    JSON.stringify(value.engineTerminal) ===
      JSON.stringify({
        status: 'completed',
        executionPlanCompleted: 681,
        executionPlanTotal: 681,
      }) &&
    JSON.stringify(value.inventoryCounts) ===
      JSON.stringify({ duplicate: 47, runnable: 681, total: 746, unresolved: 18 }) &&
    value.routeSemanticViolationCount === 0 &&
    Array.isArray(value.unresolvedBlockers) &&
    value.unresolvedBlockers.length === 18 &&
    sha256(JSON.stringify(value.unresolvedBlockers)) === REFERENCE_BLOCKERS_SHA256 &&
    !('authorityBytes' in value) &&
    !('inventory' in value) &&
    !('checks' in value) &&
    !('violations' in value);
  if (!valid) throw new Error('compact-validation-schema-drift');
  return true;
}
