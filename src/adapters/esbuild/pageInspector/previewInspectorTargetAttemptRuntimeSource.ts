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
  return attempt.autoMode === 'target-guided-auto' &&
    Date.now() - attempt.settledAt <= PREVIEW_INSPECTOR_TARGET_CONDITION_SETTLED_GRACE_MS;
}

/** Compatibility bridge for generated entries cached before the generic lock was introduced. */
function isPreviewInspectorTargetConditionAttemptPending(state) {
  return isPreviewInspectorTargetAutoAttemptPending(state);
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
  attempt.targetReachabilityResumeHandled = true;
  if (['page-blocked', 'reached', 'target-only'].includes(state.status)) return false;
  state.status = 'probing';
  state.probeRevision = Number.isSafeInteger(state.probeRevision)
    ? state.probeRevision + 1
    : 1;
  notifyPreviewInspector();
  schedulePreviewInspectorTreeRefresh();
  return true;
}

/**
 * Schedules the one continuation owned by a settled trace.
 *
 * Condition errors retain a short attribution grace. Requirement fills resume immediately because
 * their trace settlement already proves the generated values reached a stable committed snapshot.
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
  if (attempt.autoMode === 'target-guided-auto' && typeof globalThis.setTimeout === 'function') {
    globalThis.setTimeout(resume, PREVIEW_INSPECTOR_TARGET_CONDITION_SETTLED_GRACE_MS);
  } else {
    resume();
  }
  return true;
}

/** Compatibility bridge for callers retained by an older hot entry. */
function resumePreviewInspectorTargetReachabilityAfterConditionAttempt(attempt) {
  return resumePreviewInspectorTargetReachabilityAfterAutoAttempt(attempt);
}
`;
}
