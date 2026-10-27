/** Preserves V4 positive and corruption cases using explicitly reconstructed, real-hash unit inputs. */
import './rtccV4ReconstructedSetup';
import type {
  AttemptStartFixture,
  AuthorityRecordsFixture,
  AuthorityTerminalFixture,
  CompactValidationFixture,
  ExecutorArgumentFixture,
  ExecutorBindingFixture,
  ExecutorHashFixture,
  ExecutorPathFixture,
  ProcessInspectionFixture,
  ProspectivePreflightFixtureBuilder,
  ReviewedPreflightFixture,
  RunContextMutationFixture,
  RunnableAuthorityFixture,
  RunnableTargetFixture,
  TerminalEvidenceFixture,
  TerminalResultFixture,
} from './rtccV4FixtureTypes';
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { readV4ReconstructedFile } from '../support/rtccV4ReconstructedArchive';
import { getReconstructedArchive } from '../support/rtccReconstructedArchive';
import {
  BINDINGS as EXECUTOR_BINDINGS,
  PATHS as EXECUTOR_PATHS,
  EXPECTED_ARGUMENT_VECTOR,
  buildProspectivePreflightFacts,
  FROZEN_AUTHORITY_IDENTITY,
} from '../../scripts/rtcc-v4-executor-contract.mjs';
import {
  AUTHORITY_POLICY,
  V4_PATHS,
  V4_VALIDATOR_MODULE_PATHS,
  assertCompactValidationSchema,
  buildCompactValidation,
  expectedExecutorHashBindings,
  parseOfficialArguments,
  persistCompactArtifacts,
  readReferenceBlockers,
  sha256,
  validateAttemptStart,
  validateCompactTrace,
  validatePreflightEvidence,
  validateTerminalEvidence,
  writeExclusiveBytes,
} from '../../scripts/validate-rtcc-preview-complete-route-profile-v4.mjs';
import { canonicalDigest } from '../../scripts/validation/rtcc-v3-inventory-execution-plan.mjs';
import { parseJsonl } from '../../scripts/validation/rtcc-v3-structural-telemetry.mjs';
const oldAuthorityPath = '/private/tmp/rtcc-preview-v4-3.0ESvAAhF/profile-v5-5-30-a/profile.jsonl';
const deterministicUuid = '00000000-0000-4000-8000-000000000000';
const temporaryDirectories = new Set<string>();
afterEach(() => {
  for (const directory of temporaryDirectories) rmSync(directory, { recursive: true, force: true });
  temporaryDirectories.clear();
});
/** Creates and registers an isolated output directory for exclusive-write tests. */
const isolatedTemp = (): string => {
  const directory = mkdtempSync(join(tmpdir(), 'rtcc-v4-validator-test-'));
  temporaryDirectories.add(directory);
  return directory;
};
/** Replaces only the intentionally invalid UUID token in the reconstructed negative fixture. */
function replaceInvalidUuid(value: string): string {
  return value.replaceAll('aaaaaaaa', deterministicUuid);
}
/** Repairs a copy of the generated negative authority without changing its blocker inventory. */
function repairAuthorityRecords(): AuthorityRecordsFixture {
  const records = parseJsonl(
    readV4ReconstructedFile(oldAuthorityPath, 'utf8'),
  ) as unknown as AuthorityRecordsFixture;
  records[0].productionAggregate = AUTHORITY_POLICY.structural.header.productionAggregate;
  const inventory = (records.at(-1) as AuthorityTerminalFixture).inventory;
  const runnableById = new Map<string, RunnableAuthorityFixture>();
  for (const entry of inventory.entries) {
    if (entry.disposition !== 'runnable') continue;
    entry.parameters = Object.fromEntries(
      Object.entries(entry.parameters).map(([key, value]) => [
        key,
        replaceInvalidUuid(String(value)),
      ]),
    );
    entry.pathname = replaceInvalidUuid(entry.pathname);
    entry.replay.parameters = structuredClone(entry.parameters);
    entry.replay.pathname = entry.pathname;
    entry.executionPlan.recipe.params = structuredClone(entry.parameters);
    entry.executionPlan.recipe.pathname = entry.pathname;
    entry.executionPlan.selectedBranch.pathname = entry.pathname;
    entry.executionPlan.digest = canonicalDigest(
      Object.fromEntries(Object.entries(entry.executionPlan).filter(([key]) => key !== 'digest')),
    );
    runnableById.set(entry.id, entry);
  }
  for (const entry of inventory.entries) {
    if (entry.disposition !== 'duplicate') continue;
    const target = runnableById.get(entry.duplicateOf) as RunnableTargetFixture;
    entry.parameters = structuredClone(target.parameters);
    entry.pathname = target.pathname;
    entry.replay = structuredClone(target.replay);
  }
  return records;
}
const referenceBlockers = readReferenceBlockers(readV4ReconstructedFile) as unknown[];
const repairedRecords = repairAuthorityRecords();
const repairedAuthorityBytes = `${repairedRecords.map((record) => JSON.stringify(record)).join('\n')}\n`;
const repairedReport = validateCompactTrace(repairedRecords, referenceBlockers);
const compactValidation = buildCompactValidation(
  repairedAuthorityBytes,
  repairedReport,
) as CompactValidationFixture;
const canonicalBytes = (value: unknown): Buffer =>
  Buffer.from(`${JSON.stringify(value, null, 2)}\n`, 'utf8');
const zeroProcess = (): ProcessInspectionFixture => ({
  method: '/bin/ps -Ao pid=,ppid=,command=',
  shell: false,
  processInspectionApiInvocationCount: 1,
  candidateCount: 0,
  excludedSelfCount: 0,
  exactMatchingCount: 0,
  matchedPids: [],
});
const preflightCommon = {
  state: {
    profileRoot: { exists: false },
    trace: { exists: false },
    processInspection: zeroProcess(),
  },
  frozenLineage: {
    authority: {
      root: {
        path: (EXECUTOR_PATHS as ExecutorPathFixture).frozenAuthorityRoot,
        realpath: (EXECUTOR_PATHS as ExecutorPathFixture).frozenAuthorityRoot,
        type: 'directory',
        symlink: false,
        entries: ['profile.jsonl'],
      },
      trace: {
        path: (EXECUTOR_PATHS as ExecutorPathFixture).frozenAuthorityTrace,
        realpath: (EXECUTOR_PATHS as ExecutorPathFixture).frozenAuthorityTrace,
        type: 'regular-file',
        symlink: false,
        sha256: (EXECUTOR_BINDINGS as ExecutorBindingFixture).frozenAuthoritySha256,
        byteCount: FROZEN_AUTHORITY_IDENTITY.byteCount,
        lineCount: FROZEN_AUTHORITY_IDENTITY.lineCount,
        finalLf: true,
      },
    },
  },
};
const currentExecutorSha = sha256(readFileSync((EXECUTOR_PATHS as ExecutorPathFixture).executor));
const reviewedPreflight = {
  schemaVersion: 1,
  kind: 'rtcc-preview-reviewed-profile-preflight',
  release: 'v5.5.33',
  solReview: { status: 'PASS', recordedAt: '2026-08-01T00:00:00.000Z' },
  ...(buildProspectivePreflightFacts as ProspectivePreflightFixtureBuilder)(
    preflightCommon,
    currentExecutorSha,
  ),
} as unknown as ReviewedPreflightFixture;
const reviewedPreflightBytes = canonicalBytes(reviewedPreflight);
const reviewedPreflightContext = validatePreflightEvidence(
  reviewedPreflightBytes,
  sha256(reviewedPreflightBytes),
  readV4ReconstructedFile,
);
const attemptStart: AttemptStartFixture = {
  schemaVersion: 1,
  kind: 'rtcc-preview-execution-attempt-start',
  release: 'v5.5.33',
  complete: true,
  timestamp: '2026-08-01T00:01:00.000Z',
  processId: 5533,
  command: {
    workingDirectory: (EXECUTOR_PATHS as ExecutorPathFixture).workingDirectory,
    argumentVector: [
      (EXPECTED_ARGUMENT_VECTOR as ExecutorArgumentFixture)[0],
      (EXECUTOR_PATHS as ExecutorPathFixture).executor,
      '--execute',
    ],
  },
  hashBindings: expectedExecutorHashBindings() as ExecutorHashFixture,
  directRootContract: {
    existingParent: (EXECUTOR_PATHS as ExecutorPathFixture).existingParent,
    profileRoot: (EXECUTOR_PATHS as ExecutorPathFixture).profileRoot,
    trace: (EXECUTOR_PATHS as ExecutorPathFixture).trace,
    launcherCreatesRootNonrecursively: true,
    executorCreatesRoot: false,
  },
  authorizationConsumed: true,
  profileSpawnApiInvocationCount: 0,
  launcherExecuted: false,
};
const attemptBytes = canonicalBytes(attemptStart);
const attemptContext = validateAttemptStart(attemptBytes, readV4ReconstructedFile);
const emptyHash = sha256(Buffer.alloc(0));
const stdoutBytes = Buffer.from('out');
const stderrBytes = Buffer.from('err');
const authorityHash = sha256(repairedAuthorityBytes);
const prohibitedActions = {
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
};
/** Builds a simulated terminal payload from regenerated identities and repaired authority bytes. */
function terminalFixture(): TerminalEvidenceFixture {
  return {
    schemaVersion: 1,
    kind: 'rtcc-preview-execution-terminal-evidence',
    release: 'v5.5.33',
    complete: true,
    result: 'audit-required',
    hashBindings: expectedExecutorHashBindings() as ExecutorHashFixture,
    reviewedPreflightIdentity: { ...reviewedPreflightContext.identity },
    attemptStartIdentity: { ...attemptContext.identity },
    directRootContract: {
      existingParent: (EXECUTOR_PATHS as ExecutorPathFixture).existingParent,
      profileRoot: (EXECUTOR_PATHS as ExecutorPathFixture).profileRoot,
      trace: (EXECUTOR_PATHS as ExecutorPathFixture).trace,
      executorCreatedRoot: false,
    },
    materialization: {
      file: (EXPECTED_ARGUMENT_VECTOR as ExecutorArgumentFixture)[0],
      args: (EXPECTED_ARGUMENT_VECTOR as ExecutorArgumentFixture).slice(1),
      argumentVector: [...(EXPECTED_ARGUMENT_VECTOR as ExecutorArgumentFixture)],
      authorizedChildMaterialized: true,
    },
    execution: {
      validationFailure: null,
      profileSpawnApiInvocationCount: 1,
      launcherExecuted: true,
      profileExecuted: true,
      telemetryProduced: true,
      authorityRunCandidate: true,
      authorityPass: false,
      retryCount: 0,
      shell: false,
      externalTimeout: null,
      exitCode: 0,
      signal: null,
      closeObserved: true,
      synchronousSpawnThrow: false,
      durationNanoseconds: '25',
      events: [
        { sequence: 1, type: 'spawn' },
        { sequence: 4, type: 'exit', exitCode: 0, signal: null },
        { sequence: 5, type: 'close', exitCode: 0, signal: null },
      ],
    },
    streams: {
      separated: true,
      stdout: {
        byteCount: stdoutBytes.length,
        base64: stdoutBytes.toString('base64'),
        sha256: sha256(stdoutBytes),
      },
      stderr: {
        byteCount: stderrBytes.length,
        base64: stderrBytes.toString('base64'),
        sha256: sha256(stderrBytes),
      },
      taggedCallbackOrder: [
        {
          sequence: 2,
          stream: 'stdout',
          byteCount: stdoutBytes.length,
          base64: stdoutBytes.toString('base64'),
          sha256: sha256(stdoutBytes),
        },
        {
          sequence: 3,
          stream: 'stderr',
          byteCount: stderrBytes.length,
          base64: stderrBytes.toString('base64'),
          sha256: sha256(stderrBytes),
        },
      ],
    },
    preState: {
      existingParent: {
        path: (EXECUTOR_PATHS as ExecutorPathFixture).existingParent,
        realpath: (EXECUTOR_PATHS as ExecutorPathFixture).existingParent,
        type: 'directory',
        exists: true,
        symlink: false,
      },
      profileRoot: {
        path: (EXECUTOR_PATHS as ExecutorPathFixture).profileRoot,
        exists: false,
        lstatErrorCode: 'ENOENT',
      },
      trace: {
        path: (EXECUTOR_PATHS as ExecutorPathFixture).trace,
        exists: false,
        lstatErrorCode: 'ENOENT',
      },
      processInspection: zeroProcess(),
    },
    postStateResult: {
      status: 'fulfilled',
      value: {
        existingParent: {
          path: (EXECUTOR_PATHS as ExecutorPathFixture).existingParent,
          realpath: (EXECUTOR_PATHS as ExecutorPathFixture).existingParent,
          type: 'directory',
          exists: true,
          symlink: false,
        },
        profileRoot: {
          path: (EXECUTOR_PATHS as ExecutorPathFixture).profileRoot,
          exists: true,
          type: 'directory',
        },
        trace: {
          path: (EXECUTOR_PATHS as ExecutorPathFixture).trace,
          exists: true,
          type: 'regular-file',
        },
        processInspection: zeroProcess(),
      },
    },
    traceResult: {
      status: 'fulfilled',
      value: {
        path: (EXECUTOR_PATHS as ExecutorPathFixture).trace,
        present: true,
        headerPresent: true,
        byteCount: Buffer.byteLength(repairedAuthorityBytes),
        lineCount: 1530,
        sha256: authorityHash,
      },
    },
    postChildInspectionFailure: false,
    prohibitedActions: { ...prohibitedActions },
    audit: { completeMarkerPresent: true, strict681AuditPerformed: false },
  };
}
/** Validates canonical terminal fixture bytes against their exact authority identity. */
function validateTerminalFixture(value: unknown): TerminalResultFixture {
  const bytes = canonicalBytes(value);
  return validateTerminalEvidence(bytes, sha256(bytes), authorityHash, {
    preflightIdentity: reviewedPreflightContext.identity,
    attemptIdentity: attemptContext.identity,
    read: readV4ReconstructedFile,
  }) as TerminalResultFixture;
}
const terminalForContextBytes = canonicalBytes(terminalFixture());
const evidenceContext = {
  invocation: {
    cwd: (EXECUTOR_PATHS as ExecutorPathFixture).workingDirectory,
    execPath: (EXPECTED_ARGUMENT_VECTOR as ExecutorArgumentFixture)[0],
    argv: [
      (EXPECTED_ARGUMENT_VECTOR as ExecutorArgumentFixture)[0],
      (EXECUTOR_PATHS as ExecutorPathFixture).validator,
      '--official-v5.5.33',
      '--preflight-sha256',
      sha256(reviewedPreflightBytes),
      '--terminal-evidence-sha256',
      sha256(terminalForContextBytes),
      '--authority-sha256',
      authorityHash,
    ],
  },
  bindings: [
    {
      path: '.plan/rtcc-preview-v5.5.33.md',
      sha256: (EXECUTOR_BINDINGS as ExecutorBindingFixture).planSha256,
    },
    {
      path: '.plan/launchers/rtcc-v5.5.33-production-SHA256SUMS',
      sha256: (EXECUTOR_BINDINGS as ExecutorBindingFixture).productionManifestSha256,
    },
    ...V4_VALIDATOR_MODULE_PATHS.map((path) => ({
      path,
      sha256: sha256(
        readFileSync(join((EXECUTOR_PATHS as ExecutorPathFixture).workingDirectory, path)),
      ),
    })),
    {
      path: '.plan/launchers/rtcc-v5.5.33-profile-preflight.json',
      sha256: sha256(reviewedPreflightBytes),
    },
    {
      path: '.plan/launchers/rtcc-v5.5.33-execution-attempt-start.json',
      sha256: sha256(attemptBytes),
    },
    {
      path: '.plan/launchers/rtcc-v5.5.33-execution-terminal-evidence.json',
      sha256: sha256(terminalForContextBytes),
    },
  ],
};
describe('complete-route profile v4', () => {
  it('validates the repaired authority as semantic pass with the same 18 blocker no-go', () => {
    expect(repairedReport).toMatchObject({
      validatorResult: 'pass',
      structuralResult: 'pass',
      engineResult: 'pass',
      routeSemanticResult: 'pass',
      unresolvedBlockerResult: 'no-go',
      releaseResult: 'no-go',
      routeSemanticViolationCount: 0,
    });
    expect(repairedReport.checkSummary).toEqual({
      structural: { passed: 24, failed: 0, total: 24 },
      inventory: { passed: 4932, failed: 0, total: 4932 },
    });
    expect(repairedReport.inventoryCounts).toEqual({
      duplicate: 47,
      runnable: 681,
      total: 746,
      unresolved: 18,
    });
    expect(repairedReport.unresolvedBlockers).toEqual(referenceBlockers);
  });
  it('builds a compact report without authority bytes, inventory, checks, or violations', () => {
    expect(assertCompactValidationSchema(compactValidation)).toBe(true);
    expect(compactValidation.authority).toMatchObject({ lineCount: 1530 });
    expect(compactValidation).not.toHaveProperty('authorityBytes');
    expect(compactValidation).not.toHaveProperty('inventory');
    expect(compactValidation).not.toHaveProperty('checks');
    expect(compactValidation).not.toHaveProperty('violations');
    expect(Buffer.byteLength(`${JSON.stringify(compactValidation, null, 2)}\n`)).toBeLessThan(
      10000,
    );
  });
  it('accepts exact canonical reviewed-preflight, attempt, and terminal evidence schemas', () => {
    expect(reviewedPreflightContext.identity).toEqual({
      path: V4_PATHS.preflight,
      sha256: sha256(reviewedPreflightBytes),
      byteCount: reviewedPreflightBytes.length,
    });
    expect(attemptContext.identity).toEqual({
      path: V4_PATHS.attempt,
      sha256: sha256(attemptBytes),
      byteCount: attemptBytes.length,
    });
    expect(validateTerminalFixture(terminalFixture()).result).toBe('audit-required');
  });
  it.each([
    [
      'sol review',
      (value: ReviewedPreflightFixture) => {
        value.solReview.status = 'PENDING';
      },
    ],
    [
      'current identity',
      (value: ReviewedPreflightFixture) => {
        value.identities.routePatternTest.sha256 = '0'.repeat(64);
      },
    ],
    [
      'snapshot',
      (value: ReviewedPreflightFixture) => {
        value.snapshot.dependencyView.linkCount = 1847;
      },
    ],
    [
      'frozen lineage',
      (value: ReviewedPreflightFixture) => {
        value.frozenLineage.authorityTrace.finalLf = false;
      },
    ],
    [
      'invocation',
      (value: ReviewedPreflightFixture) => {
        value.invocation.argumentVector[3] = `${(EXECUTOR_PATHS as ExecutorPathFixture).profileRoot}/nested`;
      },
    ],
    [
      'zero state',
      (value: ReviewedPreflightFixture) => {
        value.observedZeroState.matchingProcessCount = 1;
      },
    ],
    [
      'extra field',
      (value: ReviewedPreflightFixture) => {
        value.extra = true;
      },
    ],
  ] as const)('rejects reviewed-preflight %s drift', (_name, mutate) => {
    const value = structuredClone(reviewedPreflight);
    mutate(value);
    const bytes = canonicalBytes(value);
    expect(() =>
      validatePreflightEvidence(bytes, sha256(bytes), readV4ReconstructedFile),
    ).toThrow();
  });
  it.each([
    [
      'header',
      (value: AttemptStartFixture) => {
        value.complete = false;
      },
    ],
    [
      'command',
      (value: AttemptStartFixture) => {
        value.command.argumentVector[2] = '--dry-run';
      },
    ],
    [
      'hash bindings',
      (value: AttemptStartFixture) => {
        value.hashBindings.routePatternTestSha256 = '0'.repeat(64);
      },
    ],
    [
      'root policy',
      (value: AttemptStartFixture) => {
        value.directRootContract.executorCreatesRoot = true;
      },
    ],
    [
      'zero state',
      (value: AttemptStartFixture) => {
        value.profileSpawnApiInvocationCount = 1;
      },
    ],
    [
      'extra field',
      (value: AttemptStartFixture) => {
        value.extra = true;
      },
    ],
  ] as const)('rejects attempt-marker %s drift', (_name, mutate) => {
    const value = structuredClone(attemptStart);
    mutate(value);
    expect(() => validateAttemptStart(canonicalBytes(value), readV4ReconstructedFile)).toThrow();
  });
  it.each([
    [
      'hash bindings',
      (value: TerminalEvidenceFixture) => {
        value.hashBindings.executorSha256 = '0'.repeat(64);
      },
    ],
    [
      'preflight identity',
      (value: TerminalEvidenceFixture) => {
        value.reviewedPreflightIdentity.byteCount += 1;
      },
    ],
    [
      'attempt identity',
      (value: TerminalEvidenceFixture) => {
        value.attemptStartIdentity.sha256 = '0'.repeat(64);
      },
    ],
    [
      'materialization',
      (value: TerminalEvidenceFixture) => {
        value.materialization.authorizedChildMaterialized = false;
      },
    ],
    [
      'spawn count',
      (value: TerminalEvidenceFixture) => {
        value.execution.profileSpawnApiInvocationCount = 2;
      },
    ],
    [
      'exit',
      (value: TerminalEvidenceFixture) => {
        value.execution.exitCode = 1;
      },
    ],
    [
      'signal',
      (value: TerminalEvidenceFixture) => {
        value.execution.signal = 'SIGTERM';
      },
    ],
    [
      'close',
      (value: TerminalEvidenceFixture) => {
        value.execution.closeObserved = false;
      },
    ],
    [
      'events',
      (value: TerminalEvidenceFixture) => {
        value.execution.events[1].sequence = 3;
      },
    ],
    [
      'duration',
      (value: TerminalEvidenceFixture) => {
        value.execution.durationNanoseconds = '0';
      },
    ],
    [
      'stream bytes',
      (value: TerminalEvidenceFixture) => {
        value.streams.stdout.byteCount = 1;
      },
    ],
    [
      'stream base64',
      (value: TerminalEvidenceFixture) => {
        value.streams.stderr.base64 = '!';
      },
    ],
    [
      'stream hash',
      (value: TerminalEvidenceFixture) => {
        value.streams.stdout.sha256 = '0'.repeat(64);
      },
    ],
    [
      'callback order',
      (value: TerminalEvidenceFixture) => {
        value.streams.taggedCallbackOrder.push({
          sequence: 2,
          stream: 'stdout',
          byteCount: 0,
          base64: '',
          sha256: emptyHash,
        });
      },
    ],
    [
      'pre state',
      (value: TerminalEvidenceFixture) => {
        value.preState.profileRoot.exists = true;
      },
    ],
    [
      'post state',
      (value: TerminalEvidenceFixture) => {
        value.postStateResult.value.profileRoot.type = 'regular-file';
      },
    ],
    [
      'post process',
      (value: TerminalEvidenceFixture) => {
        value.postStateResult.value.processInspection.exactMatchingCount = 1;
        value.postStateResult.value.processInspection.matchedPids = [42];
      },
    ],
    [
      'trace identity',
      (value: TerminalEvidenceFixture) => {
        value.traceResult.value.sha256 = '0'.repeat(64);
      },
    ],
    [
      'post inspection',
      (value: TerminalEvidenceFixture) => {
        value.postChildInspectionFailure = true;
      },
    ],
    [
      'prohibited actions',
      (value: TerminalEvidenceFixture) => {
        value.prohibitedActions.browserExecuted = true;
      },
    ],
    [
      'audit',
      (value: TerminalEvidenceFixture) => {
        value.audit.strict681AuditPerformed = true;
      },
    ],
    [
      'extra field',
      (value: TerminalEvidenceFixture) => {
        value.extra = true;
      },
    ],
  ] as const)('rejects terminal-evidence %s drift', (_name, mutate) => {
    const value = terminalFixture();
    mutate(value);
    expect(() => validateTerminalFixture(value)).toThrow();
  });
  it('rejects the frozen predecessor authority because its 31 UUID violations remain', () => {
    const oldRecords = parseJsonl(readV4ReconstructedFile(oldAuthorityPath, 'utf8'));
    expect(() =>
      validateCompactTrace(oldRecords, referenceBlockers, {
        ...AUTHORITY_POLICY,
        structural: {
          ...AUTHORITY_POLICY.structural,
          header: {
            ...AUTHORITY_POLICY.structural.header,
            productionAggregate: getReconstructedArchive().policyExports.productionManifestSha256,
          },
        },
      }),
    ).toThrow('route-semantic-violations-present');
  });
  it('rejects any ordered blocker drift even when all validator checks pass', () => {
    const drifted = structuredClone(referenceBlockers);
    [drifted[0], drifted[1]] = [drifted[1], drifted[0]];
    expect(() => validateCompactTrace(repairedRecords, drifted)).toThrow(
      'unresolved-blocker-drift',
    );
  });
  it.each([
    [
      'result',
      (value: CompactValidationFixture) => {
        value.releaseResult = 'go';
      },
    ],
    [
      'blocker',
      (value: CompactValidationFixture) => {
        value.unresolvedBlockers[0].reason = 'forged';
      },
    ],
    [
      'extra',
      (value: CompactValidationFixture) => {
        value.inventory = {};
      },
    ],
    [
      'count',
      (value: CompactValidationFixture) => {
        value.inventoryCounts.runnable = 680;
      },
    ],
  ] as const)('rejects compact schema %s drift', (_name, mutate) => {
    const value = structuredClone(compactValidation);
    mutate(value);
    expect(() => assertCompactValidationSchema(value)).toThrow('compact-validation-schema-drift');
  });
  it('persists exactly two canonical exclusive artifacts in order', () => {
    const directory = isolatedTemp();
    const paths: [string, string] = [
      join(directory, 'validation.json'),
      join(directory, 'evidence.json'),
    ];
    const result = persistCompactArtifacts({
      paths,
      validation: compactValidation,
      context: evidenceContext,
    });
    expect(result.bytes).toHaveLength(2);
    expect(readFileSync(paths[0])).toEqual(result.bytes[0]);
    expect(readFileSync(paths[1])).toEqual(result.bytes[1]);
    expect(() =>
      persistCompactArtifacts({ paths, validation: compactValidation, context: evidenceContext }),
    ).toThrow(/EEXIST/);
  });
  it('rejects validator invocation or consumed-attempt run-binding drift before writing', () => {
    for (const mutate of [
      (context: RunContextMutationFixture) => {
        context.invocation.argv[2] = '--other';
      },
      (context: RunContextMutationFixture) => {
        const attempt = context.bindings.find((binding) =>
          binding.path.endsWith('execution-attempt-start.json'),
        );
        if (attempt === undefined) throw new Error('Missing consumed-attempt fixture binding.');
        attempt.path = 'attempt-wrong';
      },
    ]) {
      const context = structuredClone(evidenceContext) as unknown as RunContextMutationFixture;
      mutate(context);
      let writes = 0;
      expect(() =>
        persistCompactArtifacts({
          paths: ['validation', 'evidence'],
          validation: compactValidation,
          context,
          write: () => {
            writes += 1;
          },
        }),
      ).toThrow('compact-run-evidence-schema-drift');
      expect(writes).toBe(0);
    }
  });
  it('treats a real second-output wx failure as terminal and keeps the first compact bytes immutable', () => {
    const directory = isolatedTemp();
    const validationPath = join(directory, 'validation.json');
    const evidencePath = join(directory, 'evidence.json');
    writeFileSync(evidencePath, 'sentinel\n');
    expect(() =>
      persistCompactArtifacts({
        paths: [validationPath, evidencePath],
        validation: compactValidation,
        context: evidenceContext,
      }),
    ).toThrow(/EEXIST/);
    const firstBytes = readFileSync(validationPath);
    expect(readFileSync(evidencePath, 'utf8')).toBe('sentinel\n');
    expect(() =>
      persistCompactArtifacts({
        paths: [validationPath, evidencePath],
        validation: compactValidation,
        context: evidenceContext,
      }),
    ).toThrow(/EEXIST/);
    expect(readFileSync(validationPath)).toEqual(firstBytes);
    expect(readFileSync(evidencePath, 'utf8')).toBe('sentinel\n');
  });
  it.each([0, 1] as const)('stops wx persistence terminally at write %i', (failureIndex) => {
    const writes: string[] = [];
    expect(() =>
      persistCompactArtifacts({
        paths: ['validation', 'evidence'],
        validation: compactValidation,
        context: evidenceContext,
        write: (path: string) => {
          if (writes.length === failureIndex) throw new Error('injected-write');
          writes.push(path);
        },
      }),
    ).toThrow('injected-write');
    expect(writes).toHaveLength(failureIndex);
  });
  it('requires the exact future official argument relation', () => {
    const hashes = ['a'.repeat(64), 'b'.repeat(64), 'c'.repeat(64)];
    expect(
      parseOfficialArguments([
        '--official-v5.5.33',
        '--preflight-sha256',
        hashes[0],
        '--terminal-evidence-sha256',
        hashes[1],
        '--authority-sha256',
        hashes[2],
      ]),
    ).toEqual({
      preflightSha256: hashes[0],
      terminalSha256: hashes[1],
      authoritySha256: hashes[2],
    });
    for (const args of [
      [],
      ['--official-v5.5.33'],
      [
        '--official-v5.5.33',
        '--preflight-sha256',
        'x',
        '--terminal-evidence-sha256',
        hashes[1],
        '--authority-sha256',
        hashes[2],
      ],
    ])
      expect(() => parseOfficialArguments(args)).toThrow();
  });
  it('never creates reserved official paths while exercising temporary persistence', () => {
    expect(existsSync('.plan/launchers/rtcc-v5.5.33-profile-preflight.json')).toBe(false);
    expect(existsSync('.plan/launchers/rtcc-v5.5.33-execution-attempt-start.json')).toBe(false);
    expect(existsSync('.plan/launchers/rtcc-v5.5.33-execution-terminal-evidence.json')).toBe(false);
    expect(existsSync('.plan/launchers/rtcc-v5.5.33-profile-validation.json')).toBe(false);
    expect(existsSync('.plan/launchers/rtcc-v5.5.33-validator-run-evidence.json')).toBe(false);
  });
  it('uses real wx writes for standalone byte persistence', () => {
    const path = join(isolatedTemp(), 'exclusive.json');
    writeExclusiveBytes(path, Buffer.from('{}\n'));
    expect(readFileSync(path, 'utf8')).toBe('{}\n');
    expect(() => {
      writeExclusiveBytes(path, Buffer.from('changed\n'));
    }).toThrow(/EEXIST/);
  });
});
