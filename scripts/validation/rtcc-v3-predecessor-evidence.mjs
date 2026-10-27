/** Checks exact predecessor bytes and their complete execution lineage before official admission. */
import {
  exact,
  noPlaceholder,
  sha256,
  canonical,
  predecessorKeys,
  predecessorSpecs,
  authorityBytesFixed,
  authoritySha256Fixed,
  predecessorProhibitedKeys,
} from './rtcc-v3-official-policy.mjs';

export function exactPredecessorIdentity(value, spec) {
  const [, path, expectedHash, json] = spec;
  return (
    exact(value, json ? ['path', 'sha256', 'value'] : ['path', 'sha256']) &&
    value.path === path &&
    value.sha256 === expectedHash &&
    (!json || (noPlaceholder(value.value) && sha256(canonical(value.value)) === expectedHash))
  );
}

export function completePredecessors(value) {
  if (
    !exact(value, predecessorKeys) ||
    value.complete !== true ||
    predecessorSpecs.some((spec) => !exactPredecessorIdentity(value[spec[0]], spec))
  )
    return false;
  const canonicalArgv = value.canonicalArgv.value,
    attempt = value.attempt.value,
    terminal = value.terminal.value;
  return (
    exact(canonicalArgv, [
      'schemaVersion',
      'kind',
      'release',
      'workingDirectory',
      'argumentCount',
      'argumentVector',
      'profileRoot',
      'productionAggregate',
      'executionPolicy',
    ]) &&
    canonicalArgv.argumentCount === 22 &&
    canonicalArgv.argumentVector.length === 22 &&
    canonicalArgv.executionPolicy?.exactOnce === true &&
    exact(attempt, [
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
    ]) &&
    attempt.complete === true &&
    attempt.authorizationConsumed === true &&
    attempt.profileSpawnApiInvocationCount === 0 &&
    attempt.launcherExecuted === false &&
    attempt.command.argumentVector.length === 3 &&
    exact(terminal, [
      'schemaVersion',
      'kind',
      'release',
      'complete',
      'result',
      'hashBindings',
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
    ]) &&
    terminal.complete === true &&
    terminal.result === 'audit-required' &&
    terminal.attemptStartIdentity.sha256 === predecessorSpecs[4][2] &&
    terminal.materialization.authorizedChildMaterialized === true &&
    terminal.materialization.argumentVector.length === 22 &&
    exact(terminal.execution, [
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
    ]) &&
    terminal.execution.profileSpawnApiInvocationCount === 1 &&
    terminal.execution.launcherExecuted === true &&
    terminal.execution.profileExecuted === true &&
    terminal.execution.telemetryProduced === true &&
    terminal.execution.authorityRunCandidate === true &&
    terminal.execution.authorityPass === false &&
    terminal.execution.retryCount === 0 &&
    terminal.execution.shell === false &&
    terminal.execution.externalTimeout === null &&
    terminal.execution.exitCode === 0 &&
    terminal.execution.signal === null &&
    terminal.execution.closeObserved === true &&
    terminal.execution.synchronousSpawnThrow === false &&
    /^\d+$/.test(terminal.execution.durationNanoseconds) &&
    terminal.execution.events.map((event) => event.type).join(',') === 'spawn,exit,close' &&
    exact(terminal.streams, ['separated', 'stdout', 'stderr', 'taggedCallbackOrder']) &&
    terminal.streams.separated === true &&
    terminal.streams.stdout.byteCount === 0 &&
    terminal.streams.stdout.sha256 === sha256('') &&
    terminal.streams.stdout.base64 === '' &&
    terminal.streams.stderr.byteCount === 0 &&
    terminal.streams.stderr.sha256 === sha256('') &&
    terminal.streams.stderr.base64 === '' &&
    Array.isArray(terminal.streams.taggedCallbackOrder) &&
    terminal.streams.taggedCallbackOrder.length === 0 &&
    terminal.directRootContract.executorCreatedRoot === false &&
    terminal.preState.profileRoot.exists === false &&
    terminal.preState.trace.exists === false &&
    terminal.postStateResult.status === 'fulfilled' &&
    terminal.postStateResult.value.profileRoot.exists === true &&
    terminal.postStateResult.value.trace.exists === true &&
    terminal.traceResult.status === 'fulfilled' &&
    terminal.traceResult.value.present === true &&
    terminal.traceResult.value.headerPresent === true &&
    terminal.traceResult.value.byteCount === authorityBytesFixed &&
    terminal.traceResult.value.lineCount === 1530 &&
    terminal.traceResult.value.sha256 === authoritySha256Fixed &&
    terminal.postChildInspectionFailure === false &&
    terminal.audit.completeMarkerPresent === true &&
    terminal.audit.strict681AuditPerformed === false &&
    exact(terminal.prohibitedActions, predecessorProhibitedKeys) &&
    predecessorProhibitedKeys.every((key) => terminal.prohibitedActions[key] === false)
  );
}
