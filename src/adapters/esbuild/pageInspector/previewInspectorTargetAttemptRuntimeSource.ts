/**
 * Generates coordination between target-guided JSX traversal and blocker render attempts.
 *
 * A condition remount can surface delayed effects or promise failures after the next 48 ms probe.
 * Keeping one condition attempt in flight prevents a later gate from inheriting that earlier
 * failure, while the trace settlement callback resumes traversal without polling the main thread.
 */

/** Creates the browser-side condition-attempt lock and settlement continuation helpers. */
export function createPreviewInspectorTargetAttemptRuntimeSource(): string {
  return String.raw`
const PREVIEW_INSPECTOR_TARGET_CONDITION_SETTLED_GRACE_MS = 160;

/** Reports whether this reachability corridor is still observing its last automatic JSX gate. */
function isPreviewInspectorTargetConditionAttemptPending(state) {
  const attempt = previewInspectorSession.blockerTraceActiveAttempt;
  if (
    attempt === undefined ||
    attempt.autoMode !== 'target-guided-auto'
  ) {
    return false;
  }
  const conditionId = attempt.blocker?.id;
  const condition = previewInspectorSession.renderConditions?.get(conditionId);
  const withinSettledGrace = attempt.settledAt === undefined ||
    Date.now() - attempt.settledAt <= PREVIEW_INSPECTOR_TARGET_CONDITION_SETTLED_GRACE_MS;
  return condition?.reachabilityKey === state?.key && withinSettledGrace;
}

/** Resumes the exact corridor after its trace has either stabilized or rolled back. */
function resumePreviewInspectorTargetReachabilityAfterConditionAttempt(attempt) {
  if (attempt?.autoMode !== 'target-guided-auto') return false;
  const condition = previewInspectorSession.renderConditions?.get(attempt.blocker?.id);
  const reachabilityKey = condition?.reachabilityKey;
  if (typeof reachabilityKey !== 'string') return false;
  const state = previewInspectorSession.targetReachabilityByKey?.get(reachabilityKey);
  if (state === undefined || state.status !== 'settling-condition-attempt') return false;
  state.status = 'probing';
  state.probeRevision += 1;
  notifyPreviewInspector();
  schedulePreviewInspectorTreeRefresh();
  return true;
}
`;
}
