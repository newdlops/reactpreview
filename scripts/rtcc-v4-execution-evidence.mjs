/** Validates reviewed preflight, exact-once attempt, stream, process, and terminal evidence. */
import { readFileSync } from 'node:fs';
import {
  BINDINGS as EXECUTOR_BINDINGS,
  EXPECTED_ARGUMENT_VECTOR,
  PATHS as EXECUTOR_PATHS,
  assertReviewedPreflightSchema,
  FROZEN_AUTHORITY_IDENTITY,
} from './rtcc-v4-executor-contract.mjs';
import {
  assertCondition,
  sha256,
  canonicalBytes,
  ROOT,
  EXPECTED_ZERO_STATE,
  regularIdentity,
  PREFLIGHT_PATH,
  exact,
  canonicalIso,
  NODE_PATH,
  expectedExecutorHashBindings,
  ATTEMPT_PATH,
  hex,
  PROCESS_KEYS,
  EXISTING_PARENT_KEYS,
  ABSENT_PATH_KEYS,
  AUTHORITY_PATH,
  EXPECTED_PROHIBITED,
} from './rtcc-v4-authority-policy.mjs';

/**
 * Validates canonical reviewed facts against the exact recorded inputs.
 * @param {Buffer} raw Canonical preflight bytes.
 * @param {string} expectedSha256 Raw preflight byte hash.
 * @param {(path: string) => Buffer} [read] Read-only byte dependency.
 */
export function validatePreflightEvidence(raw, expectedSha256, read = readFileSync) {
  assertCondition(sha256(raw) === expectedSha256, 'profile-preflight-sha256-mismatch');
  const value = JSON.parse(raw.toString('utf8'));
  assertCondition(
    raw.at(-1) === 0x0a && raw.equals(canonicalBytes(value)),
    'profile-preflight-canonical-bytes-mismatch',
  );
  assertReviewedPreflightSchema(value);
  const paths = {
    plan: EXECUTOR_PATHS.plan,
    v5532Plan: EXECUTOR_PATHS.v5532Plan,
    routePatternSource: EXECUTOR_PATHS.routePatternSource,
    routePatternTest: EXECUTOR_PATHS.routePatternTest,
    productionManifest: EXECUTOR_PATHS.productionManifest,
    canonical: EXECUTOR_PATHS.canonical,
    executor: EXECUTOR_PATHS.executor,
    executorTest: EXECUTOR_PATHS.executorTest,
    validator: EXECUTOR_PATHS.validator,
    validatorTest: EXECUTOR_PATHS.validatorTest,
    node: EXPECTED_ARGUMENT_VECTOR[0],
    launcher: EXPECTED_ARGUMENT_VECTOR[1],
    cliSource: EXECUTOR_PATHS.cliSource,
  };
  for (const [name, path] of Object.entries(paths))
    assertCondition(
      value.identities[name].path === path && value.identities[name].sha256 === sha256(read(path)),
      `profile-preflight-identity-drift:${name}`,
    );
  const expectedSnapshot = {
    sourceManifest: {
      path: EXECUTOR_PATHS.sourceManifest,
      rawSha256: EXECUTOR_BINDINGS.sourceManifestRawSha256,
      digest: EXPECTED_ARGUMENT_VECTOR[13],
      fileCount: 11724,
    },
    dependencyView: {
      path: EXECUTOR_PATHS.dependencyView,
      rawSha256: EXECUTOR_BINDINGS.dependencyViewRawSha256,
      digest: EXPECTED_ARGUMENT_VECTOR[15],
      confinementPolicyDigest: EXPECTED_ARGUMENT_VECTOR[17],
      approvedDependencyRoots: [EXPECTED_ARGUMENT_VECTOR[19]],
      linkCount: 1848,
    },
    archive: {
      path: EXECUTOR_PATHS.snapshotArchive,
      sha256: EXECUTOR_BINDINGS.snapshotArchiveSha256,
    },
  };
  assertCondition(
    JSON.stringify(value.snapshot) === JSON.stringify(expectedSnapshot),
    'profile-preflight-snapshot-drift',
  );
  const oldTrace = read(EXECUTOR_PATHS.frozenAuthorityTrace);
  const expectedFrozen = {
    gate: {
      path: EXECUTOR_PATHS.v5531Gate,
      sha256: EXECUTOR_BINDINGS.v5531GateSha256,
      bindingCount: 21,
    },
    sums: {
      path: EXECUTOR_PATHS.v5531Sums,
      sha256: EXECUTOR_BINDINGS.v5531SumsSha256,
      resultCount: 5,
    },
    authorityRoot: {
      path: EXECUTOR_PATHS.frozenAuthorityRoot,
      realpath: EXECUTOR_PATHS.frozenAuthorityRoot,
      type: 'directory',
      symlink: false,
      entries: ['profile.jsonl'],
    },
    authorityTrace: {
      path: EXECUTOR_PATHS.frozenAuthorityTrace,
      realpath: EXECUTOR_PATHS.frozenAuthorityTrace,
      type: 'regular-file',
      symlink: false,
      sha256: EXECUTOR_BINDINGS.frozenAuthoritySha256,
      byteCount: FROZEN_AUTHORITY_IDENTITY.byteCount,
      lineCount: FROZEN_AUTHORITY_IDENTITY.lineCount,
      finalLf: true,
    },
  };
  assertCondition(
    sha256(read(EXECUTOR_PATHS.v5531Gate)) === EXECUTOR_BINDINGS.v5531GateSha256 &&
      sha256(read(EXECUTOR_PATHS.v5531Sums)) === EXECUTOR_BINDINGS.v5531SumsSha256,
    'profile-preflight-frozen-lineage-file-drift',
  );
  assertCondition(
    sha256(oldTrace) === EXECUTOR_BINDINGS.frozenAuthoritySha256 &&
      oldTrace.length === FROZEN_AUTHORITY_IDENTITY.byteCount &&
      oldTrace.at(-1) === 0x0a &&
      oldTrace.toString('utf8').split('\n').length - 1 === FROZEN_AUTHORITY_IDENTITY.lineCount,
    'profile-preflight-frozen-authority-drift',
  );
  assertCondition(
    JSON.stringify(value.frozenLineage) === JSON.stringify(expectedFrozen),
    'profile-preflight-frozen-lineage-drift',
  );
  const expectedInvocation = {
    workingDirectory: ROOT,
    argumentCount: 22,
    argumentVector: [...EXPECTED_ARGUMENT_VECTOR],
    profileRoot: EXECUTOR_PATHS.profileRoot,
    executionPolicy: { exactOnce: true, shell: false, externalTimeout: false, retry: false },
    directRootPolicy: {
      existingParent: EXECUTOR_PATHS.existingParent,
      launcherCreatesRootNonrecursively: true,
      executorCreatesRoot: false,
      secondRootUsed: false,
    },
  };
  assertCondition(
    JSON.stringify(value.invocation) === JSON.stringify(expectedInvocation),
    'profile-preflight-invocation-drift',
  );
  assertCondition(
    JSON.stringify(value.observedZeroState) === JSON.stringify(EXPECTED_ZERO_STATE),
    'profile-preflight-zero-state-drift',
  );
  return { value, identity: regularIdentity(PREFLIGHT_PATH, raw) };
}

/**
 * Verifies that one authorization was consumed before a profile child could start.
 * @param {Buffer} raw Canonical attempt marker bytes.
 * @param {(path: string) => Buffer} [read] Reads the bound executor source.
 */
export function validateAttemptStart(raw, read = readFileSync) {
  const value = JSON.parse(raw.toString('utf8'));
  const keys = [
    'schemaVersion',
    'kind',
    'release',
    'complete',
    'timestamp',
    'processId',
    'command',
    'hashBindings',
    'directRootContract',
    'authorizationConsumed',
    'profileSpawnApiInvocationCount',
    'launcherExecuted',
  ];
  assertCondition(
    raw.at(-1) === 0x0a && raw.equals(canonicalBytes(value)) && exact(value, keys),
    'attempt-start-canonical-schema-mismatch',
  );
  assertCondition(
    value.schemaVersion === 1 &&
      value.kind === 'rtcc-preview-execution-attempt-start' &&
      value.release === 'v5.5.33' &&
      value.complete === true &&
      canonicalIso(value.timestamp) &&
      Number.isSafeInteger(value.processId) &&
      value.processId > 0,
    'attempt-start-header-mismatch',
  );
  assertCondition(
    exact(value.command, ['workingDirectory', 'argumentVector']) &&
      JSON.stringify(value.command) ===
        JSON.stringify({
          workingDirectory: ROOT,
          argumentVector: [NODE_PATH, EXECUTOR_PATHS.executor, '--execute'],
        }),
    'attempt-start-command-mismatch',
  );
  assertCondition(
    JSON.stringify(value.hashBindings) === JSON.stringify(expectedExecutorHashBindings(read)),
    'attempt-start-hash-bindings-mismatch',
  );
  assertCondition(
    exact(value.directRootContract, [
      'existingParent',
      'profileRoot',
      'trace',
      'launcherCreatesRootNonrecursively',
      'executorCreatesRoot',
    ]) &&
      JSON.stringify(value.directRootContract) ===
        JSON.stringify({
          existingParent: EXECUTOR_PATHS.existingParent,
          profileRoot: EXECUTOR_PATHS.profileRoot,
          trace: EXECUTOR_PATHS.trace,
          launcherCreatesRootNonrecursively: true,
          executorCreatesRoot: false,
        }),
    'attempt-start-root-contract-mismatch',
  );
  assertCondition(
    value.authorizationConsumed === true &&
      value.profileSpawnApiInvocationCount === 0 &&
      value.launcherExecuted === false,
    'attempt-start-zero-state-mismatch',
  );
  return { value, identity: regularIdentity(ATTEMPT_PATH, raw) };
}

export function validateStreamRecord(value, code) {
  assertCondition(
    exact(value, ['byteCount', 'base64', 'sha256']) &&
      Number.isSafeInteger(value.byteCount) &&
      value.byteCount >= 0 &&
      typeof value.base64 === 'string' &&
      hex(value.sha256),
    code,
  );
  const bytes = Buffer.from(value.base64, 'base64');
  assertCondition(
    bytes.toString('base64') === value.base64 &&
      bytes.length === value.byteCount &&
      sha256(bytes) === value.sha256,
    code,
  );
  return bytes;
}

export function validateProcessZero(value, code) {
  assertCondition(
    exact(value, PROCESS_KEYS) &&
      JSON.stringify(value) ===
        JSON.stringify({
          method: '/bin/ps -Ao pid=,ppid=,command=',
          shell: false,
          processInspectionApiInvocationCount: 1,
          candidateCount: 0,
          excludedSelfCount: 0,
          exactMatchingCount: 0,
          matchedPids: [],
        }),
    code,
  );
}

/**
 * Checks terminal execution, correlated evidence identities, and captured stream integrity.
 * @param {Buffer} raw Canonical terminal evidence.
 * @param {string} expectedTerminalSha256 Exact raw terminal hash.
 * @param {string} expectedAuthoritySha256 Exact resulting trace hash.
 * @param {{preflightIdentity?: {path: string, sha256: string, byteCount: number}, attemptIdentity?: {path: string, sha256: string, byteCount: number}, read?: (path: string) => Buffer}} [context] Previously validated evidence identities and reader.
 */
export function validateTerminalEvidence(
  raw,
  terminalSha256,
  authoritySha256,
  { preflightIdentity, attemptIdentity, read = readFileSync } = {},
) {
  assertCondition(sha256(raw) === terminalSha256, 'terminal-evidence-sha256-mismatch');
  const terminal = JSON.parse(raw.toString('utf8'));
  const topKeys = [
    'schemaVersion',
    'kind',
    'release',
    'complete',
    'result',
    'hashBindings',
    'reviewedPreflightIdentity',
    'attemptStartIdentity',
    'directRootContract',
    'materialization',
    'execution',
    'streams',
    'preState',
    'postStateResult',
    'traceResult',
    'postChildInspectionFailure',
    'prohibitedActions',
    'audit',
  ];
  assertCondition(
    raw.at(-1) === 0x0a &&
      raw.equals(canonicalBytes(terminal)) &&
      exact(terminal, topKeys) &&
      terminal.schemaVersion === 1 &&
      terminal.kind === 'rtcc-preview-execution-terminal-evidence' &&
      terminal.release === 'v5.5.33' &&
      terminal.complete === true &&
      terminal.result === 'audit-required',
    'terminal-evidence-contract-mismatch',
  );
  assertCondition(
    JSON.stringify(terminal.hashBindings) === JSON.stringify(expectedExecutorHashBindings(read)),
    'terminal-hash-bindings-mismatch',
  );
  assertCondition(
    exact(terminal.reviewedPreflightIdentity, ['path', 'sha256', 'byteCount']) &&
      JSON.stringify(terminal.reviewedPreflightIdentity) === JSON.stringify(preflightIdentity),
    'terminal-preflight-identity-mismatch',
  );
  assertCondition(
    exact(terminal.attemptStartIdentity, ['path', 'sha256', 'byteCount']) &&
      JSON.stringify(terminal.attemptStartIdentity) === JSON.stringify(attemptIdentity),
    'terminal-attempt-identity-mismatch',
  );
  assertCondition(
    exact(terminal.directRootContract, [
      'existingParent',
      'profileRoot',
      'trace',
      'executorCreatedRoot',
    ]) &&
      JSON.stringify(terminal.directRootContract) ===
        JSON.stringify({
          existingParent: EXECUTOR_PATHS.existingParent,
          profileRoot: EXECUTOR_PATHS.profileRoot,
          trace: EXECUTOR_PATHS.trace,
          executorCreatedRoot: false,
        }),
    'terminal-root-contract-mismatch',
  );
  assertCondition(
    exact(terminal.materialization, [
      'file',
      'args',
      'argumentVector',
      'authorizedChildMaterialized',
    ]) &&
      terminal.materialization.file === EXPECTED_ARGUMENT_VECTOR[0] &&
      JSON.stringify(terminal.materialization.args) ===
        JSON.stringify(EXPECTED_ARGUMENT_VECTOR.slice(1)) &&
      JSON.stringify(terminal.materialization.argumentVector) ===
        JSON.stringify(EXPECTED_ARGUMENT_VECTOR) &&
      terminal.materialization.authorizedChildMaterialized === true,
    'terminal-materialization-mismatch',
  );
  const executionKeys = [
    'validationFailure',
    'profileSpawnApiInvocationCount',
    'launcherExecuted',
    'profileExecuted',
    'telemetryProduced',
    'authorityRunCandidate',
    'authorityPass',
    'retryCount',
    'shell',
    'externalTimeout',
    'exitCode',
    'signal',
    'closeObserved',
    'synchronousSpawnThrow',
    'durationNanoseconds',
    'events',
  ];
  const execution = terminal.execution;
  assertCondition(
    exact(execution, executionKeys) &&
      execution.validationFailure === null &&
      execution.profileSpawnApiInvocationCount === 1 &&
      execution.launcherExecuted === true &&
      execution.profileExecuted === true &&
      execution.telemetryProduced === true &&
      execution.authorityRunCandidate === true &&
      execution.authorityPass === false &&
      execution.retryCount === 0 &&
      execution.shell === false &&
      execution.externalTimeout === null &&
      execution.exitCode === 0 &&
      execution.signal === null &&
      execution.closeObserved === true &&
      execution.synchronousSpawnThrow === false &&
      /^[1-9][0-9]*$/u.test(execution.durationNanoseconds),
    'terminal-execution-contract-mismatch',
  );
  assertCondition(
    Array.isArray(execution.events) && execution.events.length === 3,
    'terminal-execution-events-mismatch',
  );
  const [spawnEvent, exitEvent, closeEvent] = execution.events;
  assertCondition(
    exact(spawnEvent, ['sequence', 'type']) &&
      spawnEvent.type === 'spawn' &&
      spawnEvent.sequence === 1 &&
      exact(exitEvent, ['sequence', 'type', 'exitCode', 'signal']) &&
      exitEvent.type === 'exit' &&
      exitEvent.exitCode === 0 &&
      exitEvent.signal === null &&
      exact(closeEvent, ['sequence', 'type', 'exitCode', 'signal']) &&
      closeEvent.type === 'close' &&
      closeEvent.exitCode === 0 &&
      closeEvent.signal === null &&
      spawnEvent.sequence < exitEvent.sequence &&
      exitEvent.sequence < closeEvent.sequence,
    'terminal-execution-events-mismatch',
  );
  assertCondition(
    exact(terminal.streams, ['separated', 'stdout', 'stderr', 'taggedCallbackOrder']) &&
      terminal.streams.separated === true &&
      Array.isArray(terminal.streams.taggedCallbackOrder),
    'terminal-stream-contract-mismatch',
  );
  const stdout = validateStreamRecord(
    terminal.streams.stdout,
    'terminal-stdout-integrity-mismatch',
  );
  const stderr = validateStreamRecord(
    terminal.streams.stderr,
    'terminal-stderr-integrity-mismatch',
  );
  const pieces = { stdout: [], stderr: [] };
  const sequenceValues = execution.events.map(({ sequence }) => sequence);
  let previousChunkSequence = 0;
  for (const chunk of terminal.streams.taggedCallbackOrder) {
    assertCondition(
      exact(chunk, ['sequence', 'stream', 'byteCount', 'base64', 'sha256']) &&
        (chunk.stream === 'stdout' || chunk.stream === 'stderr') &&
        Number.isSafeInteger(chunk.sequence) &&
        chunk.sequence > previousChunkSequence,
      'terminal-tagged-stream-schema-mismatch',
    );
    previousChunkSequence = chunk.sequence;
    const bytes = validateStreamRecord(
      { byteCount: chunk.byteCount, base64: chunk.base64, sha256: chunk.sha256 },
      'terminal-tagged-stream-integrity-mismatch',
    );
    pieces[chunk.stream].push(bytes);
    sequenceValues.push(chunk.sequence);
  }
  assertCondition(
    Buffer.concat(pieces.stdout).equals(stdout) && Buffer.concat(pieces.stderr).equals(stderr),
    'terminal-stream-reconstruction-mismatch',
  );
  const sortedSequences = [...sequenceValues].sort((left, right) => left - right);
  assertCondition(
    closeEvent.sequence === sequenceValues.length &&
      JSON.stringify(sortedSequences) ===
        JSON.stringify([...Array(sequenceValues.length).keys()].map((number) => number + 1)),
    'terminal-callback-order-mismatch',
  );
  assertCondition(
    exact(terminal.preState, ['existingParent', 'profileRoot', 'trace', 'processInspection']) &&
      exact(terminal.preState.existingParent, EXISTING_PARENT_KEYS) &&
      JSON.stringify(terminal.preState.existingParent) ===
        JSON.stringify({
          path: EXECUTOR_PATHS.existingParent,
          realpath: EXECUTOR_PATHS.existingParent,
          type: 'directory',
          exists: true,
          symlink: false,
        }) &&
      exact(terminal.preState.profileRoot, ABSENT_PATH_KEYS) &&
      exact(terminal.preState.trace, ABSENT_PATH_KEYS) &&
      JSON.stringify(terminal.preState.profileRoot) ===
        JSON.stringify({
          path: EXECUTOR_PATHS.profileRoot,
          exists: false,
          lstatErrorCode: 'ENOENT',
        }) &&
      JSON.stringify(terminal.preState.trace) ===
        JSON.stringify({ path: EXECUTOR_PATHS.trace, exists: false, lstatErrorCode: 'ENOENT' }),
    'terminal-pre-state-mismatch',
  );
  validateProcessZero(terminal.preState.processInspection, 'terminal-pre-process-mismatch');
  assertCondition(
    exact(terminal.postStateResult, ['status', 'value']) &&
      terminal.postStateResult.status === 'fulfilled' &&
      exact(terminal.postStateResult.value, [
        'existingParent',
        'profileRoot',
        'trace',
        'processInspection',
      ]),
    'terminal-post-state-mismatch',
  );
  const post = terminal.postStateResult.value;
  assertCondition(
    JSON.stringify(post.existingParent) === JSON.stringify(terminal.preState.existingParent) &&
      exact(post.profileRoot, ['path', 'exists', 'type']) &&
      JSON.stringify(post.profileRoot) ===
        JSON.stringify({ path: EXECUTOR_PATHS.profileRoot, exists: true, type: 'directory' }) &&
      exact(post.trace, ['path', 'exists', 'type']) &&
      JSON.stringify(post.trace) ===
        JSON.stringify({ path: AUTHORITY_PATH, exists: true, type: 'regular-file' }),
    'terminal-post-state-mismatch',
  );
  validateProcessZero(post.processInspection, 'terminal-post-process-mismatch');
  assertCondition(
    exact(terminal.traceResult, ['status', 'value']) &&
      terminal.traceResult.status === 'fulfilled' &&
      exact(terminal.traceResult.value, [
        'path',
        'present',
        'headerPresent',
        'byteCount',
        'lineCount',
        'sha256',
      ]),
    'terminal-trace-identity-mismatch',
  );
  const trace = terminal.traceResult.value;
  assertCondition(
    trace.path === AUTHORITY_PATH &&
      trace.present === true &&
      trace.headerPresent === true &&
      Number.isSafeInteger(trace.byteCount) &&
      trace.byteCount > 0 &&
      trace.lineCount === 1530 &&
      trace.sha256 === authoritySha256,
    'terminal-trace-identity-mismatch',
  );
  assertCondition(
    terminal.postChildInspectionFailure === false,
    'terminal-post-child-inspection-failure',
  );
  assertCondition(
    exact(terminal.prohibitedActions, Object.keys(EXPECTED_PROHIBITED)) &&
      JSON.stringify(terminal.prohibitedActions) === JSON.stringify(EXPECTED_PROHIBITED),
    'terminal-prohibited-actions-mismatch',
  );
  assertCondition(
    exact(terminal.audit, ['completeMarkerPresent', 'strict681AuditPerformed']) &&
      terminal.audit.completeMarkerPresent === true &&
      terminal.audit.strict681AuditPerformed === false,
    'terminal-audit-mismatch',
  );
  return terminal;
}
