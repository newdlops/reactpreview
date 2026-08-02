import { createHash } from 'node:crypto';
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';

interface ContractResult {
  readonly name: string;
  readonly passed: boolean;
}

interface ValidationOutput {
  readonly contractChecks: {
    readonly expected: number;
    readonly failed: number;
    readonly passed: number;
  };
  readonly exitCode: number;
  readonly expectedCheckCount: number;
  readonly failedCheckCount: number;
  readonly passedCheckCount: number;
  readonly progressRecordChecks: {
    readonly expected: number;
    readonly failed: number;
    readonly passed: number;
  };
  readonly result: 'fail' | 'pass';
  readonly [key: string]: unknown;
}

interface ValidationResult {
  readonly contractResults: readonly ContractResult[];
  readonly output: ValidationOutput;
}

type PersistedEvidence = Readonly<Record<string, unknown>>;

interface ValidatorModule {
  readonly BUNDLE_DIAGNOSTIC_KEYS: readonly string[];
  readonly persistValidationRun: (options: Record<string, unknown>) => Promise<PersistedEvidence>;
  readonly validateProfileSnapshot: (options: Record<string, unknown>) => Promise<ValidationResult>;
}

const validatorModulePath = '../../scripts/validate-rtcc-preview-complete-route-profile.mjs';
const validator = (await import(validatorModulePath)) as unknown as ValidatorModule;
const temporaryRoots: string[] = [];
const AUTHORITY_AGGREGATE = 'a'.repeat(64);
const ENUMERATION_CHECKPOINTS = [1, 2, 4, 8, 16, 32, 64, 128, 256, 512, 725];
const REPLAY_CHECKPOINTS = [1, 2, 4, 8, 16, 32, 64, 128, 256, 512, 730];
const ORDINALS = [...Array.from({ length: 64 }, (_, index) => index + 1), 128, 256];
const EXECUTION_SEQUENCE = [
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
] as const;

interface SyntheticFixture {
  readonly amendmentBytes: Buffer;
  readonly basePlanBytes: Buffer;
  readonly expectedProductionPaths: readonly string[];
  readonly productionManifestBytes: Buffer;
  readonly profileBytes: Buffer;
  readonly repositoryRoot: string;
}

const sha256 = (value: string | Buffer): string => createHash('sha256').update(value).digest('hex');

/** Builds one canonical zero-work diagnostics payload. */
function createDiagnostics(): Record<string, number> {
  return Object.fromEntries(
    validator.BUNDLE_DIAGNOSTIC_KEYS.map((key: string) => [
      key,
      key === 'diagnosticsVersion' ? 1 : 0,
    ]),
  );
}

/** Builds the canonical physical-measurement suffix shared by every event. */
function commonEvent(sequence: number): Record<string, number> {
  return {
    cpuSystemMicros: sequence,
    cpuUserMicros: sequence,
    elapsedMs: sequence,
    heapUsedBytes: sequence,
    rssBytes: sequence,
    sequence,
    version: 4,
  };
}

/** Generates the exact 1,484-record synthetic authority shape. */
function createSyntheticRecords(): Record<string, unknown>[] {
  const records: Record<string, unknown>[] = [
    {
      confinementPolicyDigest: '1'.repeat(64),
      dependencyViewDigest: '2'.repeat(64),
      isolationPolicyDigest: '3'.repeat(64),
      isolationPolicyVersion: 3,
      kind: 'header',
      maximumEvents: 1664,
      noRetry: true,
      probeCapMs: 300000,
      productionAggregate: AUTHORITY_AGGREGATE,
      schemaVersion: 1,
      sourceManifestDigest: '4'.repeat(64),
      telemetryPolicyDigest: '5'.repeat(64),
      telemetryPolicyVersion: 4,
    },
  ];
  let sequence = 0;
  const push = (event: Record<string, unknown>): void => {
    sequence += 1;
    records.push({
      event: { ...event, ...commonEvent(sequence) },
      kind: 'progress',
      schemaVersion: 1,
    });
  };
  for (const phase of ['prepare-source-index', 'prepare-target-usage']) {
    push({ phase, transition: 'start' });
    push({ phase, transition: 'complete' });
  }
  const enumerationEvent = (
    analysisPasses: number,
    transition: 'checkpoint' | 'complete' | 'start',
  ): Record<string, unknown> => ({
    analysisPasses,
    discoveredBranches: analysisPasses === 725 ? 746 : analysisPasses,
    enumerationPrefixComputationCount: analysisPasses,
    enumerationPrefixEntryCount: analysisPasses,
    enumerationPrefixHitCount: analysisPasses,
    enumerationPrefixRequestCount: analysisPasses * 2,
    phase: 'enumerate-branches',
    queuedSelections: analysisPasses,
    transition,
  });
  push(enumerationEvent(0, 'start'));
  for (const checkpoint of ENUMERATION_CHECKPOINTS)
    push(enumerationEvent(checkpoint, 'checkpoint'));
  push(enumerationEvent(725, 'complete'));
  const replayEvent = (
    replayCompleted: number,
    transition: 'checkpoint' | 'complete' | 'start',
  ): Record<string, unknown> => ({
    phase: 'replay-branches',
    replayPrefixComputationCount: replayCompleted,
    replayPrefixEntryCount: replayCompleted,
    replayPrefixHitCount: replayCompleted,
    replayPrefixRequestCount: replayCompleted * 2,
    replayCompleted,
    replayTotal: 730,
    transition,
  });
  push(replayEvent(0, 'start'));
  for (const checkpoint of REPLAY_CHECKPOINTS) push(replayEvent(checkpoint, 'checkpoint'));
  push(replayEvent(730, 'complete'));
  for (const ordinal of ORDINALS) {
    for (const [phase, transition] of EXECUTION_SEQUENCE) {
      const event: Record<string, unknown> = {
        executionPlanCompleted:
          phase === 'execution-frontier-plan' && transition === 'complete' ? ordinal : ordinal - 1,
        executionPlanTotal: 681,
        routeOrdinal: ordinal,
      };
      if (phase === 'execution-frontier-bundle' && transition === 'complete')
        event.bundleDiagnostics = createDiagnostics();
      event.phase = phase;
      event.transition = transition;
      push(event);
    }
  }
  records.push({
    cleanupConfirmed: true,
    eventCount: 1482,
    finalSequence: 1482,
    kind: 'terminal',
    lastCounters: {
      executionPlanCompleted: 256,
      executionPlanTotal: 681,
      routeOrdinal: 256,
    },
    lastPhase: 'execution-frontier-plan',
    noRetry: true,
    schemaVersion: 1,
    failureCode: 'preview-inventory-cancelled',
    status: 'probe-cancelled',
  });
  return records;
}

/** Encodes records as newline-terminated nonempty JSONL. */
function encodeRecords(records: readonly Record<string, unknown>[]): Buffer {
  return Buffer.from(`${records.map((record) => JSON.stringify(record)).join('\n')}\n`);
}

/** Creates a synthetic repository and its exact 35-entry production manifest. */
async function createFixture(): Promise<SyntheticFixture> {
  const repositoryRoot = await mkdtemp(path.join(os.tmpdir(), 'rtcc-validator-test-'));
  temporaryRoots.push(repositoryRoot);
  const expectedProductionPaths = Array.from(
    { length: 35 },
    (_, index) => `production/file-${index.toString().padStart(2, '0')}.txt`,
  );
  const lines: string[] = [];
  for (const relativePath of expectedProductionPaths) {
    const contents = Buffer.from(`${relativePath}\n`);
    const absolutePath = path.join(repositoryRoot, relativePath);
    await mkdir(path.dirname(absolutePath), { recursive: true });
    await writeFile(absolutePath, contents);
    lines.push(`${sha256(contents)}  ${relativePath}`);
  }
  return {
    amendmentBytes: Buffer.from('synthetic amendment\n'),
    basePlanBytes: Buffer.from('synthetic base plan\n'),
    expectedProductionPaths,
    productionManifestBytes: Buffer.from(`${lines.join('\n')}\n`),
    profileBytes: encodeRecords(createSyntheticRecords()),
    repositoryRoot,
  };
}

/** Applies the validator core to one synthetic immutable fixture. */
function validateFixture(
  fixture: SyntheticFixture,
  overrides: Record<string, unknown> = {},
): Promise<ValidationResult> {
  return validator.validateProfileSnapshot({
    profileBytes: fixture.profileBytes,
    profilePath: '/synthetic/profile.jsonl',
    expectedProfileSha256: sha256(fixture.profileBytes),
    authorityProductionAggregate: AUTHORITY_AGGREGATE,
    basePlanBytes: fixture.basePlanBytes,
    expectedBasePlanSha256: sha256(fixture.basePlanBytes),
    amendmentBytes: fixture.amendmentBytes,
    expectedAmendmentSha256: sha256(fixture.amendmentBytes),
    productionManifestBytes: fixture.productionManifestBytes,
    expectedProductionPaths: fixture.expectedProductionPaths,
    repositoryRoot: fixture.repositoryRoot,
    enforceOfficialIdentity: false,
    ...overrides,
  });
}

/** Decodes a fixture for one explicit mutation. */
function decodedRecords(profileBytes: Buffer): Record<string, unknown>[] {
  return profileBytes
    .toString('utf8')
    .trimEnd()
    .split('\n')
    .map((line) => JSON.parse(line) as Record<string, unknown>);
}

/** Requires one indexed synthetic fixture value. */
function requireValue<Value>(value: Value | undefined): Value {
  if (value === undefined) throw new Error('Expected a synthetic fixture value.');
  return value;
}

afterEach(async (): Promise<void> => {
  await Promise.all(
    temporaryRoots
      .splice(0)
      .map((temporaryRoot) => rm(temporaryRoot, { force: true, recursive: true })),
  );
});

describe('persisted rtcc preview complete-route validator', () => {
  it('accepts the complete valid synthetic schema with exactly 1506 checks', async () => {
    const fixture = await createFixture();
    const validated = await validateFixture(fixture);
    expect(validated.contractResults.filter((result) => !result.passed)).toEqual([]);
    expect(validated.output).toMatchObject({
      result: 'pass',
      exitCode: 0,
      expectedCheckCount: 1506,
      passedCheckCount: 1506,
      failedCheckCount: 0,
      progressRecordChecks: { expected: 1482, passed: 1482, failed: 0 },
      contractChecks: { expected: 24, passed: 24, failed: 0 },
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
      'plans',
      'productionAggregate',
      'telemetry',
      'terminal',
    ]);
  });

  it('rejects authority hash drift', async () => {
    const fixture = await createFixture();
    const validated = await validateFixture(fixture, { expectedProfileSha256: '0'.repeat(64) });
    expect(validated.output).toMatchObject({ result: 'fail', exitCode: 1 });
    expect(validated.contractResults[0]).toEqual({
      name: 'authority-file-identity',
      passed: false,
    });
  });

  it('rejects reordered wrapper and event keys', async () => {
    const fixture = await createFixture();
    const records = decodedRecords(fixture.profileBytes);
    const progress = records[1] as { event: Record<string, unknown> };
    records[1] = { kind: 'progress', event: progress.event, schemaVersion: 1 };
    const profileBytes = encodeRecords(records);
    const validated = await validateFixture(fixture, {
      profileBytes,
      expectedProfileSha256: sha256(profileBytes),
    });
    expect(validated.output.result).toBe('fail');
    expect(validated.output.progressRecordChecks.failed).toBeGreaterThan(0);
  });

  it.each(['missing', 'extra'] as const)('rejects a %s record', async (kind) => {
    const fixture = await createFixture();
    const records = decodedRecords(fixture.profileBytes);
    if (kind === 'missing') records.splice(100, 1);
    else {
      const duplicated = records[100];
      if (duplicated === undefined) throw new Error('Expected a synthetic progress record.');
      records.splice(-1, 0, structuredClone(duplicated));
    }
    const profileBytes = encodeRecords(records);
    const validated = await validateFixture(fixture, {
      profileBytes,
      expectedProfileSha256: sha256(profileBytes),
    });
    expect(validated.output.result).toBe('fail');
    expect(
      validated.contractResults.find((result) => result.name === 'record-cardinality')?.passed,
    ).toBe(false);
  });

  it('rejects phase order and prefix counter equation drift', async () => {
    const fixture = await createFixture();
    const records = decodedRecords(fixture.profileBytes);
    const first = requireValue(records[1]);
    const second = requireValue(records[2]);
    records[1] = second;
    records[2] = first;
    const enumeration = records[5] as { event: Record<string, unknown> };
    enumeration.event.enumerationPrefixRequestCount = 1;
    const profileBytes = encodeRecords(records);
    const validated = await validateFixture(fixture, {
      profileBytes,
      expectedProfileSha256: sha256(profileBytes),
    });
    expect(validated.output.result).toBe('fail');
    expect(
      validated.contractResults.filter((result) => !result.passed).map((result) => result.name),
    ).toEqual(
      expect.arrayContaining(['pre-execution-envelope-order', 'enumeration-prefix-equations']),
    );
  });

  it('rejects diagnostics placement and canonical schema drift', async () => {
    const fixture = await createFixture();
    const records = decodedRecords(fixture.profileBytes);
    const start = requireValue(
      records.find(
        (record) =>
          (record.event as Record<string, unknown> | undefined)?.phase ===
            'execution-frontier-bundle' &&
          (record.event as Record<string, unknown>).transition === 'start',
      ),
    ) as { event: Record<string, unknown> };
    const complete = requireValue(
      records.find(
        (record) =>
          (record.event as Record<string, unknown> | undefined)?.phase ===
            'execution-frontier-bundle' &&
          (record.event as Record<string, unknown>).transition === 'complete',
      ),
    ) as { event: Record<string, unknown> };
    const diagnostics = complete.event.bundleDiagnostics as Record<string, number>;
    const reordered = { bundleMeasuredMicros: diagnostics.bundleMeasuredMicros, ...diagnostics };
    start.event.bundleDiagnostics = reordered;
    delete complete.event.bundleDiagnostics;
    const profileBytes = encodeRecords(records);
    const validated = await validateFixture(fixture, {
      profileBytes,
      expectedProfileSha256: sha256(profileBytes),
    });
    expect(validated.output.result).toBe('fail');
    expect(
      validated.contractResults.find(
        (result) => result.name === 'bundle-payload-placement-and-count',
      )?.passed,
    ).toBe(false);
  });

  it('rejects a completed terminal and false all-route completion', async () => {
    const fixture = await createFixture();
    const records = decodedRecords(fixture.profileBytes);
    const terminal = requireValue(records.at(-1));
    terminal.status = 'complete';
    terminal.failureCode = undefined;
    terminal.lastCounters = {
      executionPlanCompleted: 681,
      executionPlanTotal: 681,
      routeOrdinal: 681,
    };
    const profileBytes = encodeRecords(records);
    const validated = await validateFixture(fixture, {
      profileBytes,
      expectedProfileSha256: sha256(profileBytes),
    });
    expect(validated.output.result).toBe('fail');
    expect(
      validated.contractResults.find((result) => result.name === 'terminal-partial-failure')
        ?.passed,
    ).toBe(false);
  });

  it.each(['path-order', 'hash', 'extra'] as const)(
    'rejects production manifest %s drift',
    async (kind) => {
      const fixture = await createFixture();
      const lines = fixture.productionManifestBytes.toString('utf8').trimEnd().split('\n');
      const first = requireValue(lines[0]);
      if (kind === 'path-order') {
        const second = requireValue(lines[1]);
        lines[0] = second;
        lines[1] = first;
      } else if (kind === 'hash') lines[0] = `${'0'.repeat(64)}${first.slice(64)}`;
      else lines.push(first);
      const validated = await validateFixture(fixture, {
        productionManifestBytes: Buffer.from(`${lines.join('\n')}\n`),
      });
      expect(validated.output.result).toBe('fail');
      expect(validated.contractResults.at(-1)).toEqual({
        name: 'v5524-production-aggregate',
        passed: false,
      });
    },
  );

  it('creates output and retained failure evidence exclusively without retry', async () => {
    const fixture = await createFixture();
    const outputPath = path.join(fixture.repositoryRoot, 'output.json');
    const evidencePath = path.join(fixture.repositoryRoot, 'evidence.json');
    const validated = await validateFixture(fixture, { expectedProfileSha256: '0'.repeat(64) });
    const persistOptions = {
      output: validated.output,
      outputPath,
      evidencePath,
      cwd: fixture.repositoryRoot,
      environment: { LANG: 'C', LC_ALL: 'C', TZ: 'UTC', NODE_OPTIONS: '' },
      argv: ['--synthetic'],
      childExitCode: 1,
      childStdout: 'rtcc-preview-profile-validator v1 FAIL 1505/1506\n',
      childStderr: '',
      validatorSha256: '1'.repeat(64),
      validatorTestSha256: '2'.repeat(64),
      authoritySha256: '3'.repeat(64),
      basePlanSha256: '4'.repeat(64),
      amendmentSha256: '5'.repeat(64),
      productionManifestSha256: '6'.repeat(64),
    };
    const evidence = await validator.persistValidationRun(persistOptions);
    expect(evidence).toMatchObject({
      childExitCode: 1,
      noRetry: true,
      browserExecuted: false,
      campaignExecuted: false,
      chromiumExecuted: false,
      profileExecuted: false,
    });
    const retainedOutput = await readFile(outputPath, 'utf8');
    const retainedEvidence = await readFile(evidencePath, 'utf8');
    await expect(validator.persistValidationRun(persistOptions)).rejects.toMatchObject({
      code: 'EEXIST',
    });
    expect(await readFile(outputPath, 'utf8')).toBe(retainedOutput);
    expect(await readFile(evidencePath, 'utf8')).toBe(retainedEvidence);
  });

  it('uses only Node built-ins and the same script for its worker', async () => {
    const source = await readFile(
      path.resolve('scripts/validate-rtcc-preview-complete-route-profile.mjs'),
      'utf8',
    );
    const imports = [...source.matchAll(/from '([^']+)'/gu)].map((match) => match[1]);
    expect(imports.every((specifier) => specifier?.startsWith('node:'))).toBe(true);
    expect(source).toContain("spawn(process.execPath, [SCRIPT_PATH, '--worker', ...originalArgv]");
    expect(source).not.toMatch(/(?:https?:|playwright|setTimeout|retry\()/u);
  });
});
