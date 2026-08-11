import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { access, readFile } from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { describe, expect, it } from 'vitest';

interface ContractResult {
  readonly name: string;
  readonly passed: boolean;
}

interface CoreOutput {
  readonly authority: unknown;
  readonly progressRecordChecks: {
    readonly expected: number;
    readonly failed: number;
    readonly passed: number;
  };
  readonly telemetry: unknown;
  readonly terminal: unknown;
  readonly [key: string]: unknown;
}

interface CoreResult {
  readonly contractResults: readonly ContractResult[];
  readonly output: CoreOutput;
}

interface ValidatorModule {
  readonly CONTRACT_NAMES: readonly string[];
  readonly buildV2ValidationResult: (
    core: CoreResult,
    carriedContractPassed: boolean,
    metadata: Readonly<Record<string, unknown>>,
  ) => CoreResult;
  readonly canonicalJson: (value: unknown) => string;
  readonly expectedFailureLineage: () => Readonly<Record<string, unknown>>;
  readonly failureLineageIsValid: (bytes: Buffer) => boolean;
}

interface SubprocessResult {
  readonly code: number | null;
  readonly stderr: string;
  readonly stdout: string;
}

const validatorModulePath = '../../scripts/validate-rtcc-preview-complete-route-profile-v2.mjs';
const validator = (await import(validatorModulePath)) as unknown as ValidatorModule;
const repositoryRoot = path.resolve('.');
const nodePath = process.execPath;
const scriptPath = path.join(
  repositoryRoot,
  'scripts/validate-rtcc-preview-complete-route-profile-v2.mjs',
);
const marker = 'rtcc-preview-profile-validator v2 GATE WORKER START\n';
const exactEnvironment: Record<string, string> = {
  LANG: 'C',
  LC_ALL: 'C',
  NODE_OPTIONS: '',
  TZ: 'UTC',
  __CF_USER_TEXT_ENCODING: '0x1F5:0x3:0x33',
};
const reservedV5525Paths = [
  '.plan/launchers/rtcc-v5.5.25-profile-validation.json',
  '.plan/launchers/rtcc-v5.5.25-validator-run-evidence.json',
  '.plan/launchers/rtcc-v5.5.25-artifact-manifest.json',
  '.plan/launchers/rtcc-v5.5.25-SHA256SUMS',
];

const sha256 = (value: Buffer): string => createHash('sha256').update(value).digest('hex');

/** Runs the actual validator executable with an explicit environment object. */
function runProbe(
  environment: Readonly<Record<string, string>>,
  argument = '--gate-probe',
): Promise<SubprocessResult> {
  const child = spawn(nodePath, [scriptPath, argument], {
    cwd: repositoryRoot,
    env: { ...environment },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  let stdout = '';
  let stderr = '';
  child.stdout.setEncoding('utf8').on('data', (chunk: string) => {
    stdout += chunk;
  });
  child.stderr.setEncoding('utf8').on('data', (chunk: string) => {
    stderr += chunk;
  });
  return new Promise((resolve, reject) => {
    child.once('error', reject);
    child.once('close', (code) => {
      resolve({ code, stderr, stdout });
    });
  });
}

/** Mutates one real Node subprocess after macOS normalization and before the parent gate. */
function runInvalidParentProbe(
  mutation: 'changed-fifth' | 'missing-fifth' | 'sixth-key',
): Promise<SubprocessResult> {
  const statements = {
    'changed-fifth': "process.env.__CF_USER_TEXT_ENCODING = 'changed';",
    'missing-fifth': 'delete process.env.__CF_USER_TEXT_ENCODING;',
    'sixth-key': "process.env.FORBIDDEN_SIXTH_KEY = 'present';",
  };
  const source = [
    `const validator = await import(${JSON.stringify(pathToFileURL(scriptPath).href)});`,
    statements[mutation],
    'await validator.runGateProbeForTest();',
  ].join('\n');
  const child = spawn(nodePath, ['--input-type=module', '--eval', source], {
    cwd: repositoryRoot,
    env: { ...exactEnvironment },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  let stdout = '';
  let stderr = '';
  child.stdout.setEncoding('utf8').on('data', (chunk: string) => {
    stdout += chunk;
  });
  child.stderr.setEncoding('utf8').on('data', (chunk: string) => {
    stderr += chunk;
  });
  return new Promise((resolve, reject) => {
    child.once('error', reject);
    child.once('close', (code) => {
      resolve({ code, stderr, stdout });
    });
  });
}

/** Reports whether an artifact path already exists without creating anything. */
async function exists(targetPath: string): Promise<boolean> {
  try {
    await access(targetPath);
    return true;
  } catch {
    return false;
  }
}

/** Makes a complete passing frozen-core result for schema-upgrade tests. */
function passingCore(): CoreResult {
  return {
    contractResults: validator.CONTRACT_NAMES.map((name, index) => ({
      name: index === validator.CONTRACT_NAMES.length - 1 ? 'v5524-production-aggregate' : name,
      passed: true,
    })),
    output: {
      authority: {
        sha256: 'd'.repeat(64),
        lineCount: 1484,
        progressCount: 1482,
        productionAggregate: '3'.repeat(64),
      },
      progressRecordChecks: { expected: 1482, passed: 1482, failed: 0 },
      telemetry: {
        version: 4,
        bundleDiagnosticRecordCount: 66,
        bundleDiagnosticFieldCount: 30,
      },
      terminal: {
        status: 'probe-cancelled',
        failureCode: 'preview-inventory-cancelled',
        executionPlanCompleted: 256,
        executionPlanTotal: 681,
        cleanupConfirmed: true,
        noRetry: true,
      },
    },
  };
}

/** Makes the v2-only metadata bound into the upgraded output. */
function resultMetadata(): Readonly<Record<string, unknown>> {
  const productionManifestBytes = Buffer.from(
    `${Array.from({ length: 35 }, (_, index) => `hash-${index.toString()}`).join('\n')}\n`,
  );
  return {
    expectedPredecessorPlanSha256: '1'.repeat(64),
    expectedPredecessorAmendmentSha256: '2'.repeat(64),
    expectedPlanSha256: '3'.repeat(64),
    predecessorProductionManifestBytes: productionManifestBytes,
    productionManifestBytes,
  };
}

describe('rtcc preview complete-route validator v2 gate', () => {
  it('passes a real parent and worker subprocess with exactly five environment keys', async () => {
    const result = await runProbe(exactEnvironment);
    expect(result).toEqual({
      code: 0,
      stdout: 'rtcc-preview-profile-validator v2 GATE PASS parent=5 worker=5\n',
      stderr: '',
    });
    expect(await Promise.all(reservedV5525Paths.map(exists))).toEqual([false, false, false, false]);
  });

  it.each([
    ['missing fifth key', 'missing-fifth'],
    ['changed fifth value', 'changed-fifth'],
    ['a sixth key', 'sixth-key'],
  ])('rejects %s before spawning its worker', async (_name, environment) => {
    const result = await runInvalidParentProbe(
      environment as 'changed-fifth' | 'missing-fifth' | 'sixth-key',
    );
    expect(result).toEqual({
      code: 64,
      stdout: '',
      stderr: 'Invalid validator v2 gate parent environment.\n',
    });
    expect(`${result.stdout}${result.stderr}`).not.toContain(marker.trim());
  });

  it('rejects inherited worker environment drift after a valid parent gate', async () => {
    const result = await runProbe(exactEnvironment, '--gate-probe-worker-drift');
    expect(result).toEqual({
      code: 64,
      stdout: marker,
      stderr: 'Invalid validator v2 gate worker environment.\n',
    });
  });
});

describe('rtcc preview complete-route validator v2 contracts', () => {
  it('upgrades a passing core to the exact schema-2 1506-check result', () => {
    const validated = validator.buildV2ValidationResult(passingCore(), true, resultMetadata());
    expect(validated.output).toMatchObject({
      schemaVersion: 2,
      validator: 'rtcc-preview-complete-route-profile-v2',
      validatorVersion: 2,
      result: 'pass',
      exitCode: 0,
      expectedCheckCount: 1506,
      passedCheckCount: 1506,
      failedCheckCount: 0,
      progressRecordChecks: { expected: 1482, passed: 1482, failed: 0 },
      contractChecks: { expected: 24, passed: 24, failed: 0 },
      lineage: { result: 'no-go', retryPerformed: false, v5524Passed: false },
      productionAggregate: { entryCount: 35, implementationChanged: false },
    });
    expect(Object.keys(validated.output)).toEqual([
      'schemaVersion',
      'validator',
      'validatorVersion',
      'result',
      'exitCode',
      'expectedCheckCount',
      'passedCheckCount',
      'failedCheckCount',
      'progressRecordChecks',
      'contractChecks',
      'authority',
      'lineage',
      'plans',
      'productionAggregate',
      'telemetry',
      'terminal',
    ]);
    expect(validated.contractResults.at(-1)).toEqual({
      name: 'v5525-carried-production-aggregate',
      passed: true,
    });
  });

  it('keeps a carried-manifest or lineage failure inside check 24', () => {
    const validated = validator.buildV2ValidationResult(passingCore(), false, resultMetadata());
    expect(validated.output).toMatchObject({
      result: 'fail',
      exitCode: 1,
      passedCheckCount: 1505,
      failedCheckCount: 1,
    });
    expect(validated.contractResults.at(-1)).toEqual({
      name: 'v5525-carried-production-aggregate',
      passed: false,
    });
  });

  it('binds the canonical v5.5.24 NO-GO failure lineage byte-for-byte', async () => {
    const lineageBytes = await readFile(
      '.plan/launchers/rtcc-v5.5.25-v5.5.24-validator-failure-lineage.json',
    );
    expect(validator.failureLineageIsValid(lineageBytes)).toBe(true);
    expect(lineageBytes.toString('utf8')).toBe(
      validator.canonicalJson(validator.expectedFailureLineage()),
    );
    expect(
      validator.failureLineageIsValid(
        Buffer.from(lineageBytes.toString('utf8').replace('"runCount":1', '"runCount":2')),
      ),
    ).toBe(false);
  });

  it('carries the frozen production manifest and v1 artifacts byte-for-byte', async () => {
    const [previousManifest, carriedManifest, failedValidator, failedValidatorTest] =
      await Promise.all([
        readFile('.plan/launchers/rtcc-v5.5.24-production-SHA256SUMS'),
        readFile('.plan/launchers/rtcc-v5.5.25-production-SHA256SUMS'),
        readFile('scripts/validate-rtcc-preview-complete-route-profile.mjs'),
        readFile('test/scripts/validateRtccPreviewCompleteRouteProfile.test.ts'),
      ]);
    expect(carriedManifest.equals(previousManifest)).toBe(true);
    expect(carriedManifest.toString('utf8').trimEnd().split('\n')).toHaveLength(35);
    expect(sha256(carriedManifest)).toBe(
      'ac1344e8c36f436a5d3e8f5e83dc9bb8dfd649a7255a38d5577c9ee2dd87b5a8',
    );
    expect(sha256(failedValidator)).toBe(
      '85af9c6178228b1885e02b911a7c335505964b9e67f2e6fdd4705f557071daca',
    );
    expect(sha256(failedValidatorTest)).toBe(
      '757687b97a6d10104010192dd7e318377aa6e960fb00b72dd583c6a6352a2190',
    );
  });
});
