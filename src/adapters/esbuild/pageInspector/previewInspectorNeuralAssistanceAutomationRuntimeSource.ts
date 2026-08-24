/** Generates automatic neural retry scheduling outside the explicit-request runtime source. */
export function createPreviewInspectorNeuralAssistanceAutomationRuntimeSource(): string {
  return String.raw`
/** Keeps verified output open only while its already-admitted bounded sweep remains incomplete. */
function readPreviewInspectorAutomaticNeuralAssistanceCorridor() {
  const reachability = readPreviewInspectorNeuralAssistanceReachability();
  const activeBlockers = readPreviewInspectorNeuralAssistanceBlockers().active;
  const hasActiveNonReachabilityBlocker = activeBlockers.some((node) =>
    node?.blockerKind !== 'target-reachability' &&
    previewInspectorNeuralAssistanceBlockerKinds.has(node?.blockerKind));
  if (reachability === undefined) {
    const blocker = activeBlockers.find((node) =>
      previewInspectorNeuralAssistanceBlockerKinds.has(node?.blockerKind) &&
      readPreviewInspectorNeuralAssistanceBlockerIdentity(node) !== undefined);
    const blockerIdentity = readPreviewInspectorNeuralAssistanceBlockerIdentity(blocker);
    if (blockerIdentity === undefined) return undefined;
    return Object.freeze({
      directTarget: false,
      key: (typeof createPreviewInspectorNeuralFiniteChoiceScopeKey === 'function'
        ? createPreviewInspectorNeuralFiniteChoiceScopeKey(blocker)
        : undefined) ?? 'active-blocker:' + blockerIdentity,
      status: 'blocker-active',
      targetExportName: previewInspectorSession.selectedExportName,
      targetHasOutput: false,
    });
  }
  const key = createPreviewInspectorAutomaticNeuralAssistanceKey(reachability);
  if (
    typeof isPreviewInspectorNeuralTemporalStateContractActive === 'function' &&
      isPreviewInspectorNeuralTemporalStateContractActive(
        previewInspectorSession.selectedPageCandidateId,
      ) ||
    typeof isPreviewInspectorNeuralTemporalStateContractReleased === 'function' &&
      isPreviewInspectorNeuralTemporalStateContractReleased(
        previewInspectorSession.selectedPageCandidateId,
      )
  ) return undefined;
  const record = previewInspectorSession.automaticNeuralAssistanceByKey?.get?.(key);
  const successfulPathSettled =
    typeof isPreviewInspectorNeuralSuccessCollectionSettled === 'function' &&
    isPreviewInspectorNeuralSuccessCollectionSettled(reachability);
  const collecting = record !== undefined && record.successCollectionSettled !== true &&
    readPreviewInspectorNeuralSuccessfulPathCount(record) > 0 &&
    createPreviewInspectorNeuralExplorationPlan(record) !== undefined;
  if (collecting) return reachability;
  if (successfulPathSettled && reachability.targetHasOutput === true) return undefined;
  const pageGenerationWork = typeof hasPreviewInspectorNeuralPageGenerationWork === 'function' &&
    hasPreviewInspectorNeuralPageGenerationWork();
  if (reachability.targetHasOutput === true && !pageGenerationWork) return undefined;
  if (
    !hasActiveNonReachabilityBlocker &&
    (reachability.directTarget === true || reachability.status === 'reached')
  ) return undefined;
  return reachability;
}

/** Canonicalizes the scope whose learned retries share one small hard budget. */
function createPreviewInspectorAutomaticNeuralAssistanceKey(reachability) {
  return [
    previewEntryRevision,
    reachability?.key ?? previewInspectorSession.activeTargetReachabilityKey ?? '',
    previewInspectorSession.selectedPageCandidateId ?? '',
    previewInspectorSession.selectedExportName ?? '',
  ].join(':');
}

/** Reads the monotonic model revision carried by a verified training event. */
function readPreviewInspectorAutomaticNeuralAssistanceUpdates(detail) {
  if (Number.isSafeInteger(detail?.modelUpdates)) return Math.max(0, detail.modelUpdates);
  if (Number.isSafeInteger(detail?.updates)) return Math.max(0, detail.updates);
  return typeof readPreviewInspectorNeuralLearningModelUpdates === 'function'
    ? Math.max(0, readPreviewInspectorNeuralLearningModelUpdates())
    : 0;
}

/** Accepts candidate exclusion only from verifier-owned neural labels, never generic health ids. */
function readPreviewInspectorNeuralCandidateOutcome(event, detail) {
  if (!previewInspectorNeuralLearningAssistanceEvents.has(event)) return undefined;
  const candidateId = typeof detail?.candidateId === 'string'
    ? detail.candidateId.slice(0, 120)
    : '';
  const label = detail?.label;
  if (candidateId.length === 0 || typeof label !== 'number' || !Number.isFinite(label)) {
    return undefined;
  }
  return {
    candidateId,
    failed: label <= PREVIEW_INSPECTOR_NEURAL_ASSISTANCE_FAILURE_LABEL_MAX,
    succeeded: label >= PREVIEW_INSPECTOR_NEURAL_ASSISTANCE_SUCCESS_LABEL_MIN,
  };
}

/** Defers while the transaction that produced the label is settling, then opens one bounded retry. */
function runPreviewInspectorAutomaticNeuralAssistance(
  key,
  revision,
  modelUpdates,
  busyFrames = 0,
  requestedBy = 'automatic-learning',
) {
  initializePreviewInspectorAutomaticNeuralAssistanceState();
  const record = previewInspectorSession.automaticNeuralAssistanceByKey.get(key);
  if (record === undefined || record.scheduled !== true) return false;
  const reachability = readPreviewInspectorAutomaticNeuralAssistanceCorridor();
  if (
    revision !== previewEntryRevision || reachability === undefined ||
    createPreviewInspectorAutomaticNeuralAssistanceKey(reachability) !== key
  ) {
    record.scheduled = false;
    return false;
  }
  if (!hasPreviewInspectorNeuralRendererWorkSliceBudget(record)) {
    record.scheduled = false;
    return false;
  }
  const learningStatus = typeof readPreviewInspectorNeuralLearningStatus === 'function'
    ? readPreviewInspectorNeuralLearningStatus()
    : undefined;
  const busy = previewInspectorSession.neuralAssistancePending === true ||
    previewInspectorSession.runtimeFallbackNeuralRetryScheduled === true ||
    (learningStatus?.phase === 'learning' && Number(learningStatus?.activeCount ?? 0) > 0);
  if (busy) {
    if (busyFrames < PREVIEW_INSPECTOR_AUTOMATIC_NEURAL_ASSISTANCE_BUSY_FRAME_LIMIT) {
      schedulePreviewInspectorNeuralAssistanceFrame(() =>
        runPreviewInspectorAutomaticNeuralAssistance(
          key,
          revision,
          modelUpdates,
          busyFrames + 1,
          requestedBy,
        ));
      return true;
    }
    record.scheduled = false;
    return false;
  }
  record.scheduled = false;
  record.lastModelUpdates = Math.max(record.lastModelUpdates, modelUpdates);
  const exploration = createPreviewInspectorNeuralExplorationPlan(record);
  if (exploration === undefined) {
    const settlement = settlePreviewInspectorNeuralSuccessfulPaths(key);
    if (settlement !== undefined) {
      setPreviewInspectorNeuralLearningStatus({
        activeCount: 0,
        labelReason: 'successful-path-collection-complete',
        phase: settlement.settled === true ? 'applied' : 'applying',
        restoring: settlement.restoring === true,
        successCount: settlement.successCount,
        updates: modelUpdates,
      });
      return settlement.restoring === true;
    }
    setPreviewInspectorNeuralNeedsChoiceStatus('automatic-neural-effort-exhausted');
    return false;
  }
  const started = beginPreviewInspectorNeuralAssistanceRequest(requestedBy, {
    exploration,
    sweepKey: key,
  });
  if (started) markPreviewInspectorNeuralExplorationAttempt(record, exploration);
  return started;
}

/** Continues across newly revealed blocker families without requiring another training event. */
function schedulePreviewInspectorNeuralAssistanceSweepContinuation(
  key,
  requestedBy,
  modelUpdates,
) {
  initializePreviewInspectorAutomaticNeuralAssistanceState();
  const record = previewInspectorSession.automaticNeuralAssistanceByKey.get(key);
  const reachability = readPreviewInspectorAutomaticNeuralAssistanceCorridor();
  if (
    record === undefined || reachability === undefined ||
    createPreviewInspectorAutomaticNeuralAssistanceKey(reachability) !== key ||
    record.scheduled === true ||
    !hasPreviewInspectorNeuralRendererWorkSliceBudget(record) ||
    record.attempts >= readPreviewInspectorNeuralAssistanceEffortLimit(record, requestedBy) ||
    createPreviewInspectorNeuralExplorationPlan(record) === undefined
  ) return false;
  record.scheduled = true;
  schedulePreviewInspectorNeuralAssistanceFrame(() =>
    runPreviewInspectorAutomaticNeuralAssistance(
      key,
      previewEntryRevision,
      modelUpdates,
      0,
      requestedBy === 'user' ? 'user' : 'automatic-learning',
    ));
  return true;
}

/** Converts verified local learning into proactive resolution without expanding admitted blockers. */
function schedulePreviewInspectorAutomaticNeuralAssistanceFromHealth(event, detail = {}) {
  if (!previewInspectorAutomaticNeuralAssistanceEvents.has(event)) return false;
  const reachability = readPreviewInspectorAutomaticNeuralAssistanceCorridor();
  const modelUpdates = readPreviewInspectorAutomaticNeuralAssistanceUpdates(detail);
  if (reachability === undefined) return false;
  initializePreviewInspectorAutomaticNeuralAssistanceState();
  const key = createPreviewInspectorAutomaticNeuralAssistanceKey(reachability);
  const record = readPreviewInspectorAutomaticNeuralAssistanceRecord(key);
  resetPreviewInspectorNeuralRendererWorkSliceAfterIdle(record);
  const candidateOutcome = readPreviewInspectorNeuralCandidateOutcome(event, detail);
  if (candidateOutcome?.failed === true) {
    record.failedCandidateIds.add(candidateOutcome.candidateId);
    while (record.failedCandidateIds.size > 12) {
      record.failedCandidateIds.delete(record.failedCandidateIds.values().next().value);
    }
  } else if (candidateOutcome?.succeeded === true) {
    record.failedCandidateIds.delete(candidateOutcome.candidateId);
  }
  if (
    record.scheduled === true || previewInspectorSession.neuralAssistancePending === true ||
    !hasPreviewInspectorNeuralRendererWorkSliceBudget(record) ||
    record.attempts >= PREVIEW_INSPECTOR_AUTOMATIC_NEURAL_ASSISTANCE_LIMIT ||
    (previewInspectorNeuralLearningAssistanceEvents.has(event) &&
      modelUpdates <= record.lastModelUpdates) ||
    createPreviewInspectorNeuralExplorationPlan(record) === undefined
  ) return false;
  record.scheduled = true;
  schedulePreviewInspectorNeuralAssistanceFrame(() =>
    runPreviewInspectorAutomaticNeuralAssistance(
      key,
      previewEntryRevision,
      modelUpdates,
      0,
      'automatic-learning',
    ));
  return true;
}
`;
}
