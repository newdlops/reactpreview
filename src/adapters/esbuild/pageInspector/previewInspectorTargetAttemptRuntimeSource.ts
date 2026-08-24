/**
 * Generates coordination between target traversal and its commit-producing Auto attempts.
 *
 * A JSX gate or minimum-payload fill can schedule React work whose tree and errors settle later.
 * Keeping the exact page corridor locked until that trace closes prevents another automatic pass
 * from superseding it, while a single settlement continuation resumes traversal without polling.
 */

/** Creates the browser-side target-attempt lock, identity, and settlement continuation helpers. */
export function createPreviewInspectorTargetAttemptRuntimeSource(): string {
  return String.raw`
const PREVIEW_INSPECTOR_TARGET_CONDITION_SETTLED_GRACE_MS = 160;
const PREVIEW_INSPECTOR_TARGET_AUTO_ATTEMPT_MODES = new Set([
  'deterministic-minimum-auto',
  'minimum-requirement-dfs',
  'target-overlay-auto',
  'target-prop-repair-auto',
  'target-guided-auto',
]);

/** Reports whether a trace mode is owned by the automatic current-file corridor resolver. */
function isPreviewInspectorTargetAutoAttemptMode(mode) {
  return PREVIEW_INSPECTOR_TARGET_AUTO_ATTEMPT_MODES.has(mode);
}

/**
 * Infers and snapshots the corridor identity when a trace attempt is created.
 *
 * The condition registry is render-scoped and can disappear before a late error settles. Storing
 * its key on the durable trace attempt keeps rollback and continuation attached to the same page.
 */
function inferPreviewInspectorTargetAutoAttemptReachabilityKey(candidate, blocker) {
  const explicitKey = candidate?.targetReachabilityKey ?? candidate?.reachabilityKey;
  if (typeof explicitKey === 'string' && explicitKey.length > 0) return explicitKey;
  const blockerId = String(blocker?.id ?? candidate?.blockerId ?? '');
  const condition = previewInspectorSession.renderConditions?.get?.(blockerId);
  if (typeof condition?.reachabilityKey === 'string' && condition.reachabilityKey.length > 0) {
    return condition.reachabilityKey;
  }
  const targetPrefix = 'target-reachability:';
  if (blockerId.startsWith(targetPrefix) && blockerId.length > targetPrefix.length) {
    return blockerId.slice(targetPrefix.length);
  }
  return undefined;
}

/** Reads a stable corridor key from trace metadata, condition-attempt metadata, or legacy records. */
function readPreviewInspectorTargetAutoAttemptReachabilityKey(attempt) {
  if (typeof attempt?.targetReachabilityKey === 'string' && attempt.targetReachabilityKey.length > 0) {
    return attempt.targetReachabilityKey;
  }
  const conditionAttempt = previewInspectorSession.renderConditionAutoAttempts?.get?.(
    attempt?.traceId,
  );
  const conditionId = conditionAttempt?.conditionId ?? attempt?.blocker?.id;
  const condition = previewInspectorSession.renderConditions?.get?.(conditionId);
  const reachabilityKey = conditionAttempt?.reachabilityKey ?? condition?.reachabilityKey ??
    inferPreviewInspectorTargetAutoAttemptReachabilityKey(undefined, attempt?.blocker);
  if (typeof reachabilityKey !== 'string' || reachabilityKey.length === 0) return undefined;
  attempt.targetReachabilityKey = reachabilityKey;
  return reachabilityKey;
}

/** Reports whether this corridor must wait for its current automatic trace to settle. */
function isPreviewInspectorTargetAutoAttemptPending(state) {
  const attempt = previewInspectorSession.blockerTraceActiveAttempt;
  if (!isPreviewInspectorTargetAutoAttemptMode(attempt?.autoMode)) return false;
  if (readPreviewInspectorTargetAutoAttemptReachabilityKey(attempt) !== state?.key) return false;
  if (attempt.targetReachabilityResumeHandled === true) return false;
  if (attempt.settledAt === undefined) return true;
  return ['target-guided-auto', 'target-overlay-auto'].includes(attempt.autoMode) &&
    Date.now() - attempt.settledAt <= PREVIEW_INSPECTOR_TARGET_CONDITION_SETTLED_GRACE_MS;
}

/**
 * Allows a minimum-shape search to layer another admitted value through the error it inherited.
 * The trace recorder marks this only when the same semantic failure was already mounted before
 * the transaction began, or when a compiler-proven repair exposed a deeper retained exception;
 * an unrelated new error still follows the ordinary rollback path.
 */
function canContinuePreviewInspectorMinimumRequirementsThroughBaselineError(state) {
  const attempt = previewInspectorSession.blockerTraceActiveAttempt;
  if (
    !['deterministic-minimum-auto', 'minimum-requirement-dfs'].includes(
      attempt?.autoMode,
    ) ||
    attempt?.settledAt === undefined ||
    readPreviewInspectorTargetAutoAttemptReachabilityKey(attempt) !== state?.key ||
    typeof attempt?.retainedBaselineFatalError?.message !== 'string'
  ) return false;
  const currentError = state?.targetOutputError ??
    (typeof readPreviewInspectorRuntimeHealthTargetError === 'function'
      ? readPreviewInspectorRuntimeHealthTargetError(state?.targetExportName)
      : undefined);
  return typeof currentError?.message === 'string' &&
    currentError.message === attempt.retainedBaselineFatalError.message;
}

/** Compatibility bridge for generated entries cached before the generic lock was introduced. */
function isPreviewInspectorTargetConditionAttemptPending(state) {
  return isPreviewInspectorTargetAutoAttemptPending(state);
}

/** Reports whether a settled attempt exposed any new information for a legitimate multi-step path. */
function hasPreviewInspectorTargetAutoAttemptEvidence(attempt, state) {
  const blockerProgress = [
    'changedBlockerIds',
    'discoveredBlockerIds',
    'resolvedBlockerIds',
  ].some((field) => attempt?.[field] instanceof Set && attempt[field].size > 0);
  const targetProgress = state?.targetMounted === true ||
    state?.targetWasMounted === true ||
    state?.targetHasOutput === true;
  return blockerProgress || targetProgress ||
    hasPreviewInspectorTargetAutoAttemptContinuationGate(attempt, state);
}

/**
 * Recognizes a newly revealed, compiler-proven downstream JSX gate as legitimate DFS progress.
 *
 * Composition blocker snapshots can settle after the trace bookkeeping snapshot, so their changed
 * ID sets are not always populated in time. The retained condition override is still safe when the
 * exact selected page corridor now exposes another actionable gate: the ordinary path selector
 * applies the same source/export/overlay restrictions used by traversal and excludes the already
 * satisfied gate through its effective value check.
 */
function hasPreviewInspectorTargetAutoAttemptContinuationGate(attempt, state) {
  if (attempt?.autoMode !== 'target-guided-auto' || state === undefined) return false;
  if (typeof selectPreviewInspectorNextTargetGate !== 'function') return false;
  const descriptor = typeof findSelectedPreviewInspectorDescriptor === 'function'
    ? findSelectedPreviewInspectorDescriptor()
    : undefined;
  const candidate = typeof readSelectedPreviewInspectorPageCandidate === 'function'
    ? readSelectedPreviewInspectorPageCandidate(descriptor)
    : undefined;
  if (descriptor === undefined || candidate === undefined) return false;
  return selectPreviewInspectorNextTargetGate(descriptor, candidate, state) !== undefined;
}

/**
 * Rejects one inert target-guided gate before the corridor advances.
 *
 * A committed React tree alone is not branch progress: if it neither changes blocker evidence nor
 * reaches the selected boundary, retaining the override makes bounded DFS select the same dead
 * branch again. Multi-step gates remain intact as soon as either kind of observable evidence exists.
 */
function rollbackPreviewInspectorNoProgressTargetAutoAttempt(attempt, state) {
  if (attempt?.autoMode === 'target-prop-repair-auto' && attempt.settledAt !== undefined) {
    const snapshot = previewInspectorSession.requirementAutoRollbackByTraceId?.get?.(
      attempt.traceId,
    );
    state.pendingTargetRepairFailure = undefined;
    const currentFailure = readPreviewInspectorTargetFailureRepairRecord(state);
    if (
      snapshot?.targetRepair?.errorIdentity !== undefined &&
      currentFailure?.errorIdentity === snapshot.targetRepair.errorIdentity &&
      typeof rollbackPreviewInspectorRequirementAutoDecision === 'function'
    ) {
      return rollbackPreviewInspectorRequirementAutoDecision(attempt.traceId);
    }
    if (typeof commitPreviewInspectorRequirementAutoDecision === 'function') {
      commitPreviewInspectorRequirementAutoDecision(attempt.traceId);
    }
    return false;
  }
  if (
    attempt?.autoMode !== 'target-guided-auto' ||
    attempt.settledAt === undefined ||
    hasPreviewInspectorTargetAutoAttemptEvidence(attempt, state) ||
    typeof rollbackPreviewInspectorNoProgressAutoDecision !== 'function'
  ) return false;
  return rollbackPreviewInspectorNoProgressAutoDecision(attempt.traceId);
}

/** Resumes the exact corridor once after its trace has either stabilized or rolled back. */
function resumePreviewInspectorTargetReachabilityAfterAutoAttempt(attempt) {
  if (
    !isPreviewInspectorTargetAutoAttemptMode(attempt?.autoMode) ||
    attempt.targetReachabilityResumeHandled === true
  ) return false;
  if (previewInspectorSession.blockerTraceActiveAttempt !== attempt) {
    // A newer decision owns the corridor now. Retire this delayed callback without advancing the
    // probe, otherwise the old condition grace timer can consume idle passes in the new attempt.
    attempt.targetReachabilityResumeHandled = true;
    return false;
  }
  const reachabilityKey = readPreviewInspectorTargetAutoAttemptReachabilityKey(attempt);
  if (typeof reachabilityKey !== 'string') return false;
  const state = previewInspectorSession.targetReachabilityByKey?.get?.(reachabilityKey);
  if (state === undefined) return false;
  const rolledBack = rollbackPreviewInspectorNoProgressTargetAutoAttempt(attempt, state);
  const neuralRetry = attempt.runtimeFallbackNeuralRetry;
  attempt.runtimeFallbackNeuralRetry = undefined;
  attempt.targetReachabilityResumeHandled = true;
  if (
    neuralRetry !== undefined &&
    typeof commitPreviewInspectorRuntimeNeuralRecommendationRetry === 'function'
  ) {
    return commitPreviewInspectorRuntimeNeuralRecommendationRetry(
      neuralRetry.exportName,
      neuralRetry.reachabilityKey,
    );
  }
  if (rolledBack) {
    /*
     * A no-progress JSX gate was removed and session-rejected successfully. That rollback changes
     * renderConditionRevision, but the mounted reachability probe is keyed by probeRevision; without
     * advancing it React keeps the corridor parked at recovering-after-rejected-gate indefinitely.
     * Re-probe after the rollback commit so the next non-rejected gate, requirement frontier, or
     * compiler-proven contextual target fallback can proceed. A failed target-prop transaction is
     * intentionally terminal and retains its existing resolver-rolled-back circuit instead.
     */
    if (attempt.autoMode !== 'target-guided-auto') return false;
    state.exhausted = false;
    state.idlePasses = 0;
    state.probeRevision = Number.isSafeInteger(state.probeRevision)
      ? state.probeRevision + 1
      : 1;
    notifyPreviewInspector();
    schedulePreviewInspectorTreeRefresh();
    return true;
  }
  if (['page-blocked', 'reached', 'target-only'].includes(state.status)) return false;
  state.status = 'probing';
  state.probeRevision = Number.isSafeInteger(state.probeRevision)
    ? state.probeRevision + 1
    : 1;
  if (
    typeof continuePreviewInspectorTargetReachabilityAfterSettledAttempt === 'function' &&
    continuePreviewInspectorTargetReachabilityAfterSettledAttempt(state)
  ) return true;
  notifyPreviewInspector();
  schedulePreviewInspectorTreeRefresh();
  return true;
}

/**
 * Schedules the one continuation owned by a settled trace.
 *
 * The trace settlement itself already waits for stable committed snapshots (and retains late-error
 * attribution separately), so traversal resumes synchronously. A second timer can be starved by a
 * paused webview or headless virtual-time boundary and leave a settled page permanently suspended.
 */
function schedulePreviewInspectorTargetReachabilityResumeAfterAutoAttempt(attempt) {
  if (
    !isPreviewInspectorTargetAutoAttemptMode(attempt?.autoMode) ||
    attempt.targetReachabilityResumeScheduled === true ||
    attempt.targetReachabilityResumeHandled === true
  ) return false;
  attempt.targetReachabilityResumeScheduled = true;
  const resume = () => {
    attempt.targetReachabilityResumeScheduled = false;
    resumePreviewInspectorTargetReachabilityAfterAutoAttempt(attempt);
  };
  resume();
  return true;
}

/** Compatibility bridge for callers retained by an older hot entry. */
function resumePreviewInspectorTargetReachabilityAfterConditionAttempt(attempt) {
  return resumePreviewInspectorTargetReachabilityAfterAutoAttempt(attempt);
}
`;
}
