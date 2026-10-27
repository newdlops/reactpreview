/** Owns sustained output sampling; viewer-state changes are distinct from actual render regressions. */

/** Emits bounded verifier helpers into the existing checkpoint lexical runtime. */
export function createPreviewInspectorNeuralSuccessVerificationRuntimeSource(): string {
  return String.raw`
/** Visible geometry is only partial output while any admitted render stop still needs resolution. */
function hasPreviewInspectorNeuralUnresolvedSuccessBlocker() {
  if (typeof readPreviewInspectorNeuralAssistanceBlockers !== 'function') return false;
  const active = readPreviewInspectorNeuralAssistanceBlockers()?.active;
  return Array.isArray(active) && active.length > 0;
}
/** Requires the same reproducible viewer state and real target-owned output at observation time. */
function hasPreviewInspectorNeuralSuccessOutputEvidence(state) {
  if (
    state?.pageRootCommitted !== true || state?.targetWasMounted !== true ||
    state?.targetHasOutput !== true ||
    (typeof hasPreviewInspectorCompletePageExecutionContext === 'function' &&
      !hasPreviewInspectorCompletePageExecutionContext(state)) ||
    hasPreviewInspectorNeuralUnresolvedSuccessBlocker()
  ) return false;
  const visible = typeof hasPreviewInspectorTargetHostOutput === 'function'
    ? hasPreviewInspectorTargetHostOutput(state)
    : state.targetHasOutput === true;
  return visible;
}

/** Requires both current authored output and the exact restorable viewer contract. */
function isPreviewInspectorNeuralSuccessSnapshotVisible(state, snapshot) {
  if (snapshot === undefined || !hasPreviewInspectorNeuralSuccessOutputEvidence(state)) return false;
  const current = createPreviewInspectorNeuralSuccessSnapshot(state);
  return isPreviewInspectorNeuralSuccessSnapshotCompatible(current, snapshot);
}

/**
 * Resamples live data settling under the same execution rather than teaching a render failure.
 * No observations carry over: the replacement must pass all sustained checks. Explicit human
 * changes and execution switches are rejected by the caller's revision/key checks. Churning state
 * uses the existing bounded checkpoint budget and remains unlabelled when that budget is exhausted.
 */
function resamplePreviewInspectorNeuralSuccessContract(key, record, state, snapshot) {
  if (!hasPreviewInspectorNeuralSuccessOutputEvidence(state)) return false;
  const current = createPreviewInspectorNeuralSuccessSnapshot(state);
  if (current === undefined || current.fingerprint === snapshot.fingerprint ||
    current.exportName !== snapshot.exportName ||
    current.pageCandidateId !== snapshot.pageCandidateId ||
    current.pageExecutionContext?.executionCandidateId !== snapshot.pageExecutionContext?.executionCandidateId ||
    current.pageExecutionContext?.fidelity !== snapshot.pageExecutionContext?.fidelity) return false;
  const rebases = (Number(record.successVerificationRebases) || 0) + 1;
  clearPreviewInspectorNeuralProvisionalSuccess(record);
  record.successVerificationRebases = rebases;
  if (rebases > PREVIEW_INSPECTOR_NEURAL_SUCCESS_PATH_LIMIT) return true;
  record.provisionalSuccessfulPath = current;
  if (typeof markPreviewInspectorNeuralPageContextProvisional === 'function') {
    markPreviewInspectorNeuralPageContextProvisional(state);
  }
  schedulePreviewInspectorNeuralProvisionalSuccessVerification(key);
  return true;
}
/** Samples a provisional success over delayed frames so one lucky commit cannot train the model. */
function schedulePreviewInspectorNeuralProvisionalSuccessVerification(key) {
  const record = previewInspectorSession.automaticNeuralAssistanceByKey?.get?.(key);
  if (record === undefined || record.successVerificationScheduled === true) return false;
  const snapshot = record.provisionalSuccessfulPath;
  if (snapshot === undefined) return false;
  record.successVerificationScheduled = true;
  const controlRevision = previewInspectorSession.neuralHumanControlRevision;
  const verify = () => {
    if (previewInspectorSession.neuralHumanControlRevision !== controlRevision) return;
    record.successVerificationScheduled = false;
    if (record.provisionalSuccessfulPath?.fingerprint !== snapshot.fingerprint) return;
    const state = typeof readPreviewInspectorNeuralAssistanceReachability === 'function'
      ? readPreviewInspectorNeuralAssistanceReachability()
      : undefined;
    const activeKey = state !== undefined &&
      typeof createPreviewInspectorAutomaticNeuralAssistanceKey === 'function'
        ? createPreviewInspectorAutomaticNeuralAssistanceKey(state)
        : undefined;
    if (activeKey !== key) {
      clearPreviewInspectorNeuralProvisionalSuccess(record);
      return;
    }
    if (isPreviewInspectorNeuralSuccessSnapshotVisible(state, snapshot)) {
      record.successVerificationFailureObservations = 0;
      record.successVerificationObservations += 1;
      if (
        record.successVerificationObservations >=
        PREVIEW_INSPECTOR_NEURAL_SUCCESS_VERIFY_OBSERVATIONS
      ) {
        promotePreviewInspectorNeuralProvisionalSuccess(key, record, state, snapshot);
        return;
      }
    } else {
      if (resamplePreviewInspectorNeuralSuccessContract(key, record, state, snapshot)) return;
      record.successVerificationObservations = 0;
      record.successVerificationFailureObservations += 1;
      if (
        record.successVerificationFailureObservations >=
        PREVIEW_INSPECTOR_NEURAL_SUCCESS_FAILURE_OBSERVATIONS
      ) {
        rejectPreviewInspectorNeuralProvisionalSuccess(key, record, state, snapshot);
        return;
      }
    }
    schedulePreviewInspectorNeuralProvisionalSuccessVerification(key);
  };
  if (typeof globalThis.setTimeout === 'function') {
    globalThis.setTimeout(verify, PREVIEW_INSPECTOR_NEURAL_SUCCESS_VERIFY_DELAY_MS);
  } else if (typeof previewInspectorScheduleRuntimeEffectFrame === 'function') {
    previewInspectorScheduleRuntimeEffectFrame(verify);
  } else {
    Promise.resolve().then(verify);
  }
  return true;
}
`;
}
