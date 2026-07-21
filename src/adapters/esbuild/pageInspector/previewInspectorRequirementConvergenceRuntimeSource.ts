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

/** Initializes histories outside reachability state so incidental state recreation cannot reset a loop. */
function initializePreviewInspectorRequirementConvergenceState() {
  if (!(previewInspectorSession.requirementConvergenceByKey instanceof Map)) {
    previewInspectorSession.requirementConvergenceByKey = new Map();
  }
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
  return JSON.stringify({
    gates,
    hooks,
    pageRootCommitted: state.pageRootCommitted === true,
    requests,
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
      'Use Retry page corridor or Find minimum requirements to explicitly start a fresh search.',
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
