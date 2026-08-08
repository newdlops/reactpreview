/**
 * Generates the convergence guard for automatic Page Inspector requirement filling.
 *
 * Hook and backend inference intentionally runs over several committed renders because each branch
 * can reveal a deeper requirement. A project hook can nevertheless alternate between two generated
 * shapes, or a terminal search can be rediscovered after every probe. This runtime owns a bounded,
 * revision-local history so a stable A -> A frontier settles without blocking the next JSX gate,
 * while a real A -> B -> A oscillation stops before another remount. Explicit retry clears either.
 */

/** Creates browser source for canonical frontier fingerprints and the automatic pass circuit. */
export function createPreviewInspectorRequirementConvergenceRuntimeSource(): string {
  return String.raw`
const PREVIEW_INSPECTOR_REQUIREMENT_FRONTIER_HISTORY_LIMIT = 12;
const PREVIEW_INSPECTOR_REQUIREMENT_CONVERGENCE_RECORD_LIMIT = 64;
const PREVIEW_INSPECTOR_REQUIREMENT_AUTO_ROLLBACK_LIMIT = 64;

/** Initializes histories outside reachability state so incidental state recreation cannot reset a loop. */
function initializePreviewInspectorRequirementConvergenceState() {
  if (!(previewInspectorSession.requirementConvergenceByKey instanceof Map)) {
    previewInspectorSession.requirementConvergenceByKey = new Map();
  }
  if (!(previewInspectorSession.requirementAutoRollbackByTraceId instanceof Map)) {
    previewInspectorSession.requirementAutoRollbackByTraceId = new Map();
  }
}

function capturePreviewInspectorRequirementMapEntry(map, id) {
  return map instanceof Map && map.has(id)
    ? { present: true, value: map.get(id) }
    : { present: false };
}

function restorePreviewInspectorRequirementMapEntry(map, id, entry) {
  if (!(map instanceof Map)) return;
  if (entry?.present === true) map.set(id, entry.value);
  else map.delete(id);
}

/** Captures session-only generated-state entries immediately before one bounded Auto mutation. */
function capturePreviewInspectorRequirementAutoRollback(state, batch) {
  initializePreviewInspectorRequirementConvergenceState();
  if (typeof state?.key !== 'string') return undefined;
  const hookIds = [...new Set((batch?.hookIds ?? []).filter((id) => typeof id === 'string'))]
    .slice(0, PREVIEW_INSPECTOR_REQUIREMENT_HOOK_BATCH_LIMIT);
  const requestIds = [...new Set((batch?.requestIds ?? []).filter((id) => typeof id === 'string'))]
    .slice(0, PREVIEW_INSPECTOR_REQUIREMENT_DATA_BATCH_LIMIT);
  const targetRepair = batch?.targetRepair;
  const propExportName = typeof targetRepair?.failure?.exportName === 'string'
    ? targetRepair.failure.exportName
    : undefined;
  if (hookIds.length === 0 && requestIds.length === 0 && propExportName === undefined) {
    return undefined;
  }
  const hooks = hookIds.map((id) => ({
    id,
    materialized: capturePreviewInspectorRequirementMapEntry(
      previewInspectorSession.runtimeFallbackMaterializedOverrides, id,
    ),
    override: capturePreviewInspectorRequirementMapEntry(previewInspectorSession.runtimeFallbackOverrides, id),
    record: capturePreviewInspectorRequirementMapEntry(previewInspectorSession.runtimeFallbacks, id),
    signature: capturePreviewInspectorRequirementMapEntry(
      previewInspectorSession.runtimeFallbackSmartPathSignatures, id,
    ),
    smart: previewInspectorSession.runtimeFallbackSmartIds instanceof Set &&
      previewInspectorSession.runtimeFallbackSmartIds.has(id),
    value: capturePreviewInspectorRequirementMapEntry(previewInspectorSession.runtimeFallbackValues, id),
  }));
  const requests = requestIds.map((id) => ({
    id,
    override: capturePreviewInspectorRequirementMapEntry(previewInspectorSession.dataPayloadOverrides, id),
    signature: capturePreviewInspectorRequirementMapEntry(
      previewInspectorSession.dataPayloadSmartShapeSignatures, id,
    ),
  }));
  const props = propExportName === undefined ? [] : [{
    exportName: propExportName,
    override: capturePreviewInspectorRequirementMapEntry(
      previewInspectorSession.resolverPropsByExport,
      propExportName,
    ),
  }];
  return { fallbackValuesEnabled: previewInspectorSession.fallbackValuesEnabled === true,
    dataAutoEnabled: previewInspectorSession.dataAutoEnabled === true, hooks, props,
    reachabilityKey: state.key, requests,
    ...(targetRepair === undefined ? {} : { targetRepair: {
      changedPaths: targetRepair.changedPaths,
      errorIdentity: targetRepair.errorIdentity,
      fingerprint: targetRepair.fingerprint,
    } }) };
}

/** Associates one causal render attempt with its exact pre-mutation generated state. */
function registerPreviewInspectorRequirementAutoRollback(traceId, snapshot) {
  initializePreviewInspectorRequirementConvergenceState();
  if (typeof traceId !== 'string' || traceId.length === 0 || snapshot === undefined) return false;
  if (
    snapshot.hooks.length === 0 && snapshot.requests.length === 0 &&
    (snapshot.props ?? []).length === 0
  ) return false;
  previewInspectorSession.requirementAutoRollbackByTraceId.set(traceId, snapshot);
  while (previewInspectorSession.requirementAutoRollbackByTraceId.size >
    PREVIEW_INSPECTOR_REQUIREMENT_AUTO_ROLLBACK_LIMIT) {
    previewInspectorSession.requirementAutoRollbackByTraceId.delete(
      previewInspectorSession.requirementAutoRollbackByTraceId.keys().next().value,
    );
  }
  return true;
}

function clearPreviewInspectorRequirementAutoRollbacks(reachabilityKey) {
  initializePreviewInspectorRequirementConvergenceState();
  let changed = false;
  for (const [traceId, snapshot] of previewInspectorSession.requirementAutoRollbackByTraceId) {
    if (reachabilityKey === undefined || snapshot.reachabilityKey === reachabilityKey) {
      previewInspectorSession.requirementAutoRollbackByTraceId.delete(traceId);
      changed = true;
    }
  }
  return changed;
}

/** Commits one successful transaction by discarding only its pre-mutation snapshot. */
function commitPreviewInspectorRequirementAutoDecision(traceId) {
  initializePreviewInspectorRequirementConvergenceState();
  return typeof traceId === 'string'
    ? previewInspectorSession.requirementAutoRollbackByTraceId.delete(traceId)
    : false;
}

/** Restores a failed minimum-requirement transaction before any follow-up resolver pass. */
function rollbackPreviewInspectorRequirementAutoDecision(traceId) {
  initializePreviewInspectorRequirementConvergenceState();
  if (typeof traceId !== 'string') return false;
  const snapshot = previewInspectorSession.requirementAutoRollbackByTraceId.get(traceId);
  previewInspectorSession.requirementAutoRollbackByTraceId.delete(traceId);
  if (snapshot === undefined) return false;
  const activeKey = previewInspectorSession.activeTargetReachabilityKey;
  if (typeof activeKey === 'string' && activeKey !== snapshot.reachabilityKey) return false;
  for (const hook of snapshot.hooks) {
    restorePreviewInspectorRequirementMapEntry(previewInspectorSession.runtimeFallbackValues, hook.id, hook.value);
    restorePreviewInspectorRequirementMapEntry(previewInspectorSession.runtimeFallbackOverrides, hook.id, hook.override);
    restorePreviewInspectorRequirementMapEntry(previewInspectorSession.runtimeFallbackSmartPathSignatures, hook.id, hook.signature);
    restorePreviewInspectorRequirementMapEntry(
      previewInspectorSession.runtimeFallbackMaterializedOverrides, hook.id, hook.materialized,
    );
    if (previewInspectorSession.runtimeFallbackSmartIds instanceof Set) {
      if (hook.smart) previewInspectorSession.runtimeFallbackSmartIds.add(hook.id);
      else previewInspectorSession.runtimeFallbackSmartIds.delete(hook.id);
    }
    const current = previewInspectorSession.runtimeFallbacks?.get(hook.id);
    if (hook.record.present && current !== undefined) {
      previewInspectorSession.runtimeFallbacks.set(hook.id, {
        ...current,
        mode: hook.record.value?.mode,
        requiredPaths: current.requiredPaths,
      });
    } else {
      restorePreviewInspectorRequirementMapEntry(previewInspectorSession.runtimeFallbacks, hook.id, hook.record);
    }
  }
  for (const request of snapshot.requests) {
    restorePreviewInspectorRequirementMapEntry(previewInspectorSession.dataPayloadOverrides, request.id, request.override);
    restorePreviewInspectorRequirementMapEntry(
      previewInspectorSession.dataPayloadSmartShapeSignatures, request.id, request.signature,
    );
    if (typeof clearPreviewInspectorVirtualBackendResource === 'function') {
      clearPreviewInspectorVirtualBackendResource(request.id);
    }
  }
  for (const prop of snapshot.props ?? []) {
    restorePreviewInspectorRequirementMapEntry(
      previewInspectorSession.resolverPropsByExport,
      prop.exportName,
      prop.override,
    );
    const revision = previewInspectorSession.propsRevisionByExport.get(prop.exportName) ?? 0;
    previewInspectorSession.propsRevisionByExport.set(prop.exportName, revision + 1);
  }
  previewInspectorSession.fallbackValuesEnabled = snapshot.fallbackValuesEnabled;
  previewInspectorSession.dataAutoEnabled = snapshot.dataAutoEnabled;
  const search = previewInspectorSession.minimumRequirementSearchByKey?.get(snapshot.reachabilityKey);
  if (search !== undefined) Object.assign(search, { rollbackTraceId: traceId,
    rolledBackHookCount: snapshot.hooks.length, rolledBackPropCount: (snapshot.props ?? []).length,
    rolledBackRequestCount: snapshot.requests.length, status: 'rolled-back' });
  const state = previewInspectorSession.targetReachabilityByKey?.get(snapshot.reachabilityKey);
  if (state !== undefined) {
    state.exhausted = true;
    state.idlePasses = 0;
    state.probeRevision = (state.probeRevision ?? 0) + 1;
    state.status = 'resolver-rolled-back';
  }
  const convergence = readPreviewInspectorRequirementConvergence({ key: snapshot.reachabilityKey });
  convergence.status = 'rolled-back';
  clearPreviewInspectorRequirementAutoRollbacks(snapshot.reachabilityKey);
  if (snapshot.requests.length > 0) previewInspectorSession.dataRevision =
    (previewInspectorSession.dataRevision ?? 0) + 1;
  previewInspectorSession.renderConditionRevision = (previewInspectorSession.renderConditionRevision ?? 0) + 1;
  if (typeof persistPreviewInspectorState === 'function') persistPreviewInspectorState();
  notifyPreviewInspector();
  schedulePreviewInspectorTreeRefresh();
  schedulePreviewInspectorCommitRefresh();
  const message = 'Automatic generated preview values were reverted after a new render error.';
  if (typeof recordPreviewInspectorConsoleEntry === 'function') recordPreviewInspectorConsoleEntry({
    details: 'Trace: ' + traceId + '\\nMode: ' + String(snapshot.mode ?? 'minimum-requirement') +
      '\\nTarget: ' + String(state?.targetExportName ?? '') +
      '\\nGenerated hooks: ' + snapshot.hooks.length +
      '\\nGenerated props: ' + (snapshot.props ?? []).length +
      '\\nGenerated requests: ' + snapshot.requests.length,
    level: 'warn', location: '', message, phase: 'blocker resolver rollback', source: 'target-reachability',
  });
  if (typeof recordPreviewInspectorRuntimeHealth === 'function') recordPreviewInspectorRuntimeHealth({
    category: 'blocker-resolver', detail: { mode: snapshot.mode ?? 'minimum-requirement',
      reason: 'runtime-error', target: state?.targetExportName, traceId, hookCount: snapshot.hooks.length,
      propCount: (snapshot.props ?? []).length, requestCount: snapshot.requests.length },
    event: 'automatic-resolution-rolled-back',
  });
  return true;
}

/** Includes the active hot artifact revision so a real source edit receives a fresh automatic budget. */
function createPreviewInspectorRequirementConvergenceKey(state) {
  const revision = typeof previewEntryRevision === 'number' && Number.isSafeInteger(previewEntryRevision)
    ? previewEntryRevision
    : 0;
  return String(revision) + ':' + String(state?.key ?? 'unknown-target');
}

/** Returns the monotonic automatic budget retained for one revision and page-to-target corridor. */
function readPreviewInspectorRequirementConvergence(state) {
  initializePreviewInspectorRequirementConvergenceState();
  const key = createPreviewInspectorRequirementConvergenceKey(state);
  let convergence = previewInspectorSession.requirementConvergenceByKey.get(key);
  if (convergence === undefined) {
    convergence = {
      fingerprints: [],
      key,
      startedAt: Date.now(),
      status: 'idle',
      totalPasses: 0,
    };
    previewInspectorSession.requirementConvergenceByKey.set(key, convergence);
    while (
      previewInspectorSession.requirementConvergenceByKey.size >
      PREVIEW_INSPECTOR_REQUIREMENT_CONVERGENCE_RECORD_LIMIT
    ) {
      previewInspectorSession.requirementConvergenceByKey.delete(
        previewInspectorSession.requirementConvergenceByKey.keys().next().value,
      );
    }
  }
  return convergence;
}

/** Clears only an explicitly retried corridor; ordinary probes and descriptor refreshes retain history. */
function resetPreviewInspectorRequirementConvergence(stateOrKey) {
  initializePreviewInspectorRequirementConvergenceState();
  const reachabilityKey = typeof stateOrKey === 'string' ? stateOrKey : stateOrKey?.key;
  if (typeof reachabilityKey !== 'string') return false;
  return previewInspectorSession.requirementConvergenceByKey.delete(
    createPreviewInspectorRequirementConvergenceKey({ key: reachabilityKey }),
  );
}

/** Returns the mutable minimum-requirement search retained for the current target corridor. */
function readPreviewInspectorMinimumRequirementSearch(state) {
  initializePreviewInspectorTargetReachabilityState();
  return previewInspectorSession.minimumRequirementSearchByKey.get(state.key);
}

/** Canonicalizes property evidence as a set so registry iteration order cannot reopen Smart values. */
function canonicalizePreviewInspectorRequirementPaths(paths) {
  return [...new Set((Array.isArray(paths) ? paths : [])
    .filter((path) => typeof path === 'string'))].sort();
}

/** Copies an effective generated value into a small deterministic representation without invoking getters. */
function fingerprintPreviewInspectorRequirementValue(value, state, depth = 0) {
  if (depth > 8 || state.nodes >= 192) return '[bounded]';
  state.nodes += 1;
  if (typeof value === 'function') return '[function]';
  if (value === undefined) return '[undefined]';
  if (typeof value === 'symbol') return '[symbol]';
  if (typeof value === 'bigint') return String(value) + 'n';
  if (value === null || typeof value !== 'object') {
    return typeof value === 'string' ? value.slice(0, 240) : value;
  }
  if (state.seen.has(value)) return '[circular]';
  state.seen.add(value);
  let descriptors;
  try { descriptors = Object.getOwnPropertyDescriptors(value); } catch { return '[unreadable]'; }
  if (Array.isArray(value)) {
    return Object.keys(descriptors)
      .filter((name) => name !== 'length' && /^\d+$/u.test(name))
      .map(Number)
      .sort((left, right) => left - right)
      .slice(0, 24)
      .map((index) => fingerprintPreviewInspectorRequirementValue(
        descriptors[String(index)]?.value,
        state,
        depth + 1,
      ));
  }
  const result = {};
  for (const name of Object.keys(descriptors).sort().slice(0, 32)) {
    const descriptor = descriptors[name];
    if (blockedInspectorPropNames.has(name) || !Object.hasOwn(descriptor, 'value')) continue;
    result[name] = fingerprintPreviewInspectorRequirementValue(
      descriptor.value,
      state,
      depth + 1,
    );
  }
  return result;
}

/** Builds one semantic snapshot from admitted gates, hook values, request payloads, and target output. */
function createPreviewInspectorRequirementFrontierFingerprint(state, batch) {
  const admittedHookIds = new Set(batch?.hookIds ?? []);
  const admittedRequestIds = new Set(batch?.requestIds ?? []);
  const hookOverrides = previewInspectorSession.runtimeFallbackOverrides instanceof Map
    ? previewInspectorSession.runtimeFallbackOverrides
    : new Map();
  const hookValues = previewInspectorSession.runtimeFallbackValues instanceof Map
    ? previewInspectorSession.runtimeFallbackValues
    : new Map();
  const dataOverrides = previewInspectorSession.dataPayloadOverrides instanceof Map
    ? previewInspectorSession.dataPayloadOverrides
    : new Map();
  const hooks = readPreviewInspectorRuntimeFallbacks()
    .filter((record) => record.reachabilityKey === state.key && admittedHookIds.has(record.id))
    .map((record) => {
      const value = hookOverrides.has(record.id)
        ? hookOverrides.get(record.id)
        : hookValues.get(record.id);
      return [
        record.id,
        canonicalizePreviewInspectorRequirementPaths(record.requiredPaths),
        fingerprintPreviewInspectorRequirementValue(value, { nodes: 0, seen: new WeakSet() }),
      ];
    })
    .sort((left, right) => left[0].localeCompare(right[0]));
  const requests = readPreviewInspectorDataRequests()
    .filter((record) => record.reachabilityKey === state.key && admittedRequestIds.has(record.id))
    .map((record) => {
      const override = dataOverrides.get(record.id);
      const payload = override?.payload ?? record.servedPayload ?? record.lastPayload ?? record.autoPayload;
      return [
        record.id,
        canonicalizePreviewInspectorRequirementPaths(
          readPreviewInspectorDataShapePaths(record.shape),
        ),
        fingerprintPreviewInspectorRequirementValue(payload, { nodes: 0, seen: new WeakSet() }),
      ];
    })
    .sort((left, right) => left[0].localeCompare(right[0]));
  const gates = [...(state.appliedConditions ?? [])]
    .map((gate) => [gate.id, gate.enabled])
    .sort((left, right) => String(left[0]).localeCompare(String(right[0])));
  const targetRepair = batch?.targetRepair === undefined ? undefined : {
    changedPaths: canonicalizePreviewInspectorRequirementPaths(batch.targetRepair.changedPaths),
    errorIdentity: batch.targetRepair.errorIdentity,
    fingerprint: batch.targetRepair.fingerprint,
    requirements: [...(batch.targetRepair.requirementRecords ?? [])]
      .map((record) => [record.path, record.kind])
      .sort((left, right) => left[0].localeCompare(right[0])),
  };
  return JSON.stringify({
    gates,
    hooks,
    pageRootCommitted: state.pageRootCommitted === true,
    requests,
    targetRepair,
    targetHasOutput: state.targetHasOutput === true,
    targetMounted: state.targetMounted === true,
  });
}

/** Emits one circuit-open diagnostic and leaves the authored page mounted for manual inspection. */
function stopPreviewInspectorRequirementConvergence(state, search, status, cycleLength = 0) {
  const convergence = readPreviewInspectorRequirementConvergence(state);
  convergence.status = status;
  search.status = status;
  search.cycleLength = cycleLength;
  search.totalPasses = convergence.totalPasses;
  state.exhausted = true;
  state.status = 'resolver-' + status;
  if (convergence.warningReported !== true) {
    convergence.warningReported = true;
    const message = status === 'cycle-detected'
      ? 'Automatic blocker resolution stopped after a repeated requirement state.'
      : 'Automatic blocker resolution stopped at its bounded pass limit.';
    const details = [
      message,
      'Target: ' + state.targetExportName,
      'Passes: ' + String(convergence.totalPasses) + '/' +
        String(PREVIEW_INSPECTOR_MINIMUM_REQUIREMENT_PASS_LIMIT),
      cycleLength > 0 ? 'Detected cycle length: ' + String(cycleLength) : '',
      'Use Try page again or Auto-find missing values to explicitly start a fresh search.',
    ].filter(Boolean).join('\n');
    if (typeof recordPreviewInspectorConsoleEntry === 'function') {
      recordPreviewInspectorConsoleEntry({
        details,
        level: 'warn',
        location: '',
        message,
        phase: 'blocker resolver convergence',
        source: 'target-reachability',
      });
    }
    if (typeof recordPreviewInspectorRuntimeHealth === 'function') {
      recordPreviewInspectorRuntimeHealth({
        category: 'blocker-resolver',
        detail: { cycleLength, status, target: state.targetExportName, totalPasses: convergence.totalPasses },
        event: 'automatic-resolution-circuit-opened',
      });
    }
    if (typeof recordPreviewInspectorBlockerAutoDecision === 'function') {
      recordPreviewInspectorBlockerAutoDecision({
        action: 'Stop automatic page-path search',
        blockerId: 'target-reachability:' + state.key,
        blockerKind: 'target-reachability',
        blockerName: 'Target not reached · ' + state.targetExportName,
        mode: 'convergence-circuit',
        ownerName: state.rootName,
        reason: message,
        selectedValue: { cycleLength, status, totalPasses: convergence.totalPasses },
        startsRenderAttempt: false,
        summary: { applicationPath: state.applicationPath ?? [] },
      });
    }
    readPreviewInspectorConsolePrimitives().warn('[React Preview] ' + details);
  }
  notifyPreviewInspector();
  schedulePreviewInspectorTreeRefresh();
}

/** Inspects a candidate pass and distinguishes a settled A -> A frontier from real oscillation. */
function beginPreviewInspectorRequirementFrontier(state, search, batch) {
  const convergence = readPreviewInspectorRequirementConvergence(state);
  if (convergence.totalPasses >= PREVIEW_INSPECTOR_MINIMUM_REQUIREMENT_PASS_LIMIT) {
    stopPreviewInspectorRequirementConvergence(state, search, 'limit-reached');
    return undefined;
  }
  const fingerprint = createPreviewInspectorRequirementFrontierFingerprint(state, batch);
  const repeatedAt = convergence.fingerprints.lastIndexOf(fingerprint);
  if (repeatedAt >= 0) {
    const cycleLength = Math.max(1, convergence.fingerprints.length - repeatedAt);
    if (cycleLength === 1) {
      /*
       * The same generated value often means this requirement dimension is simply exhausted. It
       * must not close the whole page corridor: a target-local JSX gate discovered by that commit
       * may still be the actionable continuation. No remount is scheduled for the stalled batch.
       */
      convergence.status = 'stalled';
      search.frontierFingerprint = fingerprint;
      search.status = 'stalled';
      search.totalPasses = convergence.totalPasses;
      state.exhausted = false;
      state.status = 'requirements-stalled';
      return undefined;
    }
    stopPreviewInspectorRequirementConvergence(
      state,
      search,
      'cycle-detected',
      cycleLength,
    );
    return undefined;
  }
  return { convergence, fingerprint };
}

/** Records an observed frontier and consumes budget only when it schedules a changed page commit. */
function completePreviewInspectorRequirementFrontier(search, frontier, changed) {
  const { convergence, fingerprint } = frontier;
  convergence.fingerprints.push(fingerprint);
  if (convergence.fingerprints.length > PREVIEW_INSPECTOR_REQUIREMENT_FRONTIER_HISTORY_LIMIT) {
    convergence.fingerprints.shift();
  }
  convergence.frontierFingerprint = fingerprint;
  search.frontierFingerprint = fingerprint;
  if (!changed) {
    /* No mutation was available in this new frontier; report completion, not an apparent loop. */
    convergence.status = 'settled';
    search.status = 'settled';
    return;
  }
  convergence.totalPasses += 1;
  convergence.status = convergence.totalPasses >= PREVIEW_INSPECTOR_MINIMUM_REQUIREMENT_PASS_LIMIT
    ? 'limit-reached'
    : 'searching';
  search.pass = convergence.totalPasses;
  search.totalPasses = convergence.totalPasses;
  if (convergence.status === 'limit-reached') search.status = 'limit-reached';
}

/** Prevents a terminal deterministic search from reopening unless its semantic frontier is new. */
function canStartPreviewInspectorDeterministicRequirementSearch(state, evidence) {
  const convergence = readPreviewInspectorRequirementConvergence(state);
  if (convergence.totalPasses >= PREVIEW_INSPECTOR_MINIMUM_REQUIREMENT_PASS_LIMIT) return false;
  const fingerprint = createPreviewInspectorRequirementFrontierFingerprint(state, evidence);
  return !convergence.fingerprints.includes(fingerprint);
}

/** Opens a previously reached hard-limit circuit after the final scheduled render was observed. */
function stopPreviewInspectorRequirementConvergenceAtLimit(state) {
  const search = readPreviewInspectorMinimumRequirementSearch(state);
  const convergence = readPreviewInspectorRequirementConvergence(state);
  if (
    search === undefined ||
    search.status !== 'limit-reached' ||
    convergence.totalPasses < PREVIEW_INSPECTOR_MINIMUM_REQUIREMENT_PASS_LIMIT
  ) return false;
  stopPreviewInspectorRequirementConvergence(state, search, 'limit-reached');
  return true;
}

/** Converts a reached target into the terminal result of its current requirement search. */
function completePreviewInspectorMinimumRequirementSearch(state) {
  const search = readPreviewInspectorMinimumRequirementSearch(state);
  if (search === undefined) return;
  search.observedPathCount = readPreviewInspectorTargetReachabilityRequiredPaths(state).length;
  search.status = 'reached';
  readPreviewInspectorRequirementConvergence(state).status = 'reached';
}

/** Retains the final discovery summary when no further path-local requirement can be proven. */
function settlePreviewInspectorMinimumRequirementSearch(state) {
  const search = readPreviewInspectorMinimumRequirementSearch(state);
  if (search === undefined || search.status !== 'searching') return;
  search.observedPathCount = readPreviewInspectorTargetReachabilityRequiredPaths(state).length;
  search.status = 'settled';
  readPreviewInspectorRequirementConvergence(state).status = 'settled';
}
`;
}
