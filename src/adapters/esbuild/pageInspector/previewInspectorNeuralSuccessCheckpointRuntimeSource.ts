/** Generates bounded success-path checkpoints for exhaustive neural exploration. */
export function createPreviewInspectorNeuralSuccessCheckpointRuntimeSource(): string {
  return String.raw`
const PREVIEW_INSPECTOR_NEURAL_SUCCESS_PATH_LIMIT = 64;
const PREVIEW_INSPECTOR_NEURAL_RETAINED_BLOCKER_LIMIT = 24;
const PREVIEW_INSPECTOR_NEURAL_SUCCESS_VERIFY_DELAY_MS = 320;
const PREVIEW_INSPECTOR_NEURAL_SUCCESS_VERIFY_OBSERVATIONS = 3;
const PREVIEW_INSPECTOR_NEURAL_SUCCESS_FAILURE_OBSERVATIONS = 2;
const PREVIEW_INSPECTOR_NEURAL_RESTORATION_VERIFY_DELAY_MS = 320;
const PREVIEW_INSPECTOR_NEURAL_RESTORATION_SUCCESS_OBSERVATIONS = 3;
const PREVIEW_INSPECTOR_NEURAL_RESTORATION_FAILURE_OBSERVATIONS = 2;
const PREVIEW_INSPECTOR_NEURAL_SUCCESS_VALUE_LIMIT = 64;
/** Copies only the renderer-safe value already admitted by preview prop normalization. */
function copyPreviewInspectorNeuralSuccessValue(value) {
  const copied = typeof copyPreviewInspectorBlockerValueForJson === 'function'
    ? copyPreviewInspectorBlockerValueForJson(value, { nodes: 0 })
    : value;
  if (copied === undefined) return undefined;
  if (typeof normalizePreviewInspectorProps === 'function') {
    try { return normalizePreviewInspectorProps(copied); } catch { return copied; }
  }
  try {
    return typeof globalThis.structuredClone === 'function'
      ? globalThis.structuredClone(copied)
      : copied;
  } catch { return copied; }
}
/** Serializes only checkpoint-safe values and rejects a snapshot that cannot be reproduced. */
function stringifyPreviewInspectorNeuralSuccessValue(value) {
  try { return JSON.stringify(value); } catch { return undefined; }
}
/** Copies a bounded keyed viewer-state map for exact success restoration. */
function copyPreviewInspectorNeuralSuccessEntries(map) {
  if (!(map instanceof Map)) return Object.freeze([]);
  return Object.freeze([...map]
    .filter(([id]) => typeof id === 'string' && id.length > 0)
    .sort(([left], [right]) => left.localeCompare(right))
    .slice(0, PREVIEW_INSPECTOR_NEURAL_SUCCESS_VALUE_LIMIT)
    .flatMap(([id, value]) => {
      const copied = copyPreviewInspectorNeuralSuccessValue(value);
      return copied === undefined ? [] : [Object.freeze([id, copied])];
    }));
}
/** Reads bounded blocker ids even when their current strategy intentionally has no override. */
function readPreviewInspectorNeuralSuccessIds(map) {
  return Object.freeze((map instanceof Map ? [...map.keys()] : [])
    .filter((id) => typeof id === 'string' && id.length > 0)
    .sort((left, right) => left.localeCompare(right))
    .slice(0, PREVIEW_INSPECTOR_NEURAL_SUCCESS_VALUE_LIMIT));
}
/** Captures the small mutable viewer state that can reproduce one verified target output. */
function createPreviewInspectorNeuralSuccessSnapshot(state) {
  const exportName = typeof state?.targetExportName === 'string'
    ? state.targetExportName
    : previewInspectorSession.selectedExportName;
  if (typeof exportName !== 'string' || exportName.length === 0) return undefined;
  if (typeof initializePreviewInspectorDataState === 'function') {
    initializePreviewInspectorDataState();
  }
  if (typeof initializePreviewInspectorRuntimeFallbackState === 'function') {
    initializePreviewInspectorRuntimeFallbackState();
  }
  const conditionEntries = previewInspectorSession.renderConditionAutoOverrides instanceof Map
    ? [...previewInspectorSession.renderConditionAutoOverrides]
        .filter(([id, value]) => typeof id === 'string' && typeof value === 'boolean')
        .sort(([left], [right]) => left.localeCompare(right))
    : [];
  const resolverMap = previewInspectorSession.resolverPropsByExport;
  const hasResolverProps = resolverMap instanceof Map && resolverMap.has(exportName);
  const resolverProps = hasResolverProps
    ? copyPreviewInspectorNeuralSuccessValue(resolverMap.get(exportName))
    : undefined;
  const resolverFingerprint = hasResolverProps &&
    typeof fingerprintPreviewInspectorSmartPropValue === 'function'
      ? fingerprintPreviewInspectorSmartPropValue(resolverProps)
      : resolverProps;
  const pageCandidateId = typeof previewInspectorSession.selectedPageCandidateId === 'string'
    ? previewInspectorSession.selectedPageCandidateId
    : '';
  const dataAutoEnabled = previewInspectorSession.dataAutoEnabled !== false;
  const dataRequestIds = readPreviewInspectorNeuralSuccessIds(
    previewInspectorSession.dataRequests,
  );
  const dataPayloadEntries = copyPreviewInspectorNeuralSuccessEntries(
    previewInspectorSession.dataPayloadOverrides,
  );
  const runtimeFallbackIds = readPreviewInspectorNeuralSuccessIds(
    previewInspectorSession.runtimeFallbacks,
  );
  const runtimeFallbackValueEntries = Object.freeze(
    copyPreviewInspectorNeuralSuccessEntries(
      previewInspectorSession.runtimeFallbackValues,
    ).filter(([id]) => runtimeFallbackIds.includes(id)),
  );
  const runtimeFallbackSmartIds = Object.freeze((
    previewInspectorSession.runtimeFallbackSmartIds instanceof Set
      ? [...previewInspectorSession.runtimeFallbackSmartIds]
      : []
  ).filter((id) => runtimeFallbackIds.includes(id)).sort());
  const runtimeFallbackSmartPathEntries = Object.freeze(
    copyPreviewInspectorNeuralSuccessEntries(
      previewInspectorSession.runtimeFallbackSmartPathSignatures,
    ).filter(([id]) => runtimeFallbackIds.includes(id)),
  );
  const fallbackValuesEnabled = previewInspectorSession.fallbackValuesEnabled !== false;
  const temporalState = typeof createPreviewInspectorNeuralTemporalStateSnapshot === 'function'
    ? createPreviewInspectorNeuralTemporalStateSnapshot(state)
    : undefined;
  const fingerprint = stringifyPreviewInspectorNeuralSuccessValue({
    conditionEntries,
    dataAutoEnabled,
    dataPayloadEntries,
    dataRequestIds,
    exportName,
    fallbackValuesEnabled,
    pageCandidateId,
    resolverProps: hasResolverProps ? resolverFingerprint : '[absent]',
    runtimeFallbackIds,
    runtimeFallbackSmartIds,
    runtimeFallbackSmartPathEntries,
    runtimeFallbackValueEntries,
    temporalStateFingerprint: temporalState?.fingerprint,
  });
  if (typeof fingerprint !== 'string') return undefined;
  const resolverSize = stringifyPreviewInspectorNeuralSuccessValue(resolverFingerprint ?? '')
    ?.length ?? 10_000;
  const viewerValueSize = stringifyPreviewInspectorNeuralSuccessValue({
    dataPayloadEntries,
    runtimeFallbackValueEntries,
  })?.length ?? 10_000;
  const score = (state?.targetDirectElementOutput === true ? 1_000_000 : 0) +
    (state?.targetOutputKind === 'target-output' ? 100_000 : 0) - conditionEntries.length * 10 -
    Math.min(10_000, resolverSize) - Math.min(10_000, viewerValueSize);
  return Object.freeze({
    choicePathId: typeof previewInspectorSession.neuralActiveChoicePathId === 'string'
      ? previewInspectorSession.neuralActiveChoicePathId
      : undefined,
    conditionEntries: Object.freeze(conditionEntries),
    dataAutoEnabled,
    dataPayloadEntries,
    dataRequestIds,
    exportName,
    fallbackValuesEnabled,
    fingerprint,
    hasResolverProps,
    observedAt: Date.now(),
    pageCandidateId,
    resolverProps,
    runtimeFallbackIds,
    runtimeFallbackSmartIds,
    runtimeFallbackSmartPathEntries,
    runtimeFallbackValueEntries,
    score,
    temporalState,
  });
}
/** Returns the unique verified-path count retained by one bounded exploration record. */
function readPreviewInspectorNeuralSuccessfulPathCount(record) {
  return Array.isArray(record?.successfulPaths) ? record.successfulPaths.length : 0;
}
/** Reports the short interval where output is visible but not yet safe to learn or persist. */
function isPreviewInspectorNeuralSuccessVerificationPending(record) {
  return record?.provisionalSuccessfulPath !== undefined ||
    record?.successVerificationScheduled === true;
}
/** Selects the most exact, least invasive checkpoint that has not failed during restoration. */
function selectPreviewInspectorBestNeuralSuccessfulPath(record) {
  const failed = record.failedSuccessRestorations instanceof Set
    ? record.failedSuccessRestorations
    : new Set();
  return [...(Array.isArray(record.successfulPaths) ? record.successfulPaths : [])]
    .filter((candidate) => !failed.has(candidate.fingerprint))
    .sort((left, right) =>
      Number(right.temporalState?.kind === 'terminal-stable') -
        Number(left.temporalState?.kind === 'terminal-stable') ||
        right.score - left.score || left.observedAt - right.observedAt ||
        left.fingerprint.localeCompare(right.fingerprint))[0];
}
/** Upgrades one hot-safe record without making the main assistance source own checkpoint shape. */
function upgradePreviewInspectorNeuralSuccessCollectionRecord(record) {
  record.successfulPaths = (Array.isArray(record.successfulPaths) ? record.successfulPaths : [])
    .slice(-PREVIEW_INSPECTOR_NEURAL_SUCCESS_PATH_LIMIT);
  if (!(record.retainedFiniteChoiceBlockers instanceof Map)) {
    record.retainedFiniteChoiceBlockers = new Map();
  }
  if (!(record.failedSuccessRestorations instanceof Set)) {
    record.failedSuccessRestorations = new Set();
  }
  if (record.successVerificationScheduled !== true) {
    record.successVerificationScheduled = false;
  }
  if (!Number.isSafeInteger(record.successVerificationObservations)) {
    record.successVerificationObservations = 0;
  }
  if (!Number.isSafeInteger(record.successVerificationFailureObservations)) {
    record.successVerificationFailureObservations = 0;
  }
  if (record.regressionVerificationScheduled !== true) {
    record.regressionVerificationScheduled = false;
  }
  if (!Number.isSafeInteger(record.regressionFailureObservations)) {
    record.regressionFailureObservations = 0;
  }
  if (!['automatic-learning', 'user'].includes(record.successCollectionRequestedBy)) {
    record.successCollectionRequestedBy = 'automatic-learning';
  }
  if (record.successCollectionSettled !== true) record.successCollectionSettled = false;
  if (record.restoringSuccessfulPath !== true) record.restoringSuccessfulPath = false;
  if (record.restorationVerificationScheduled !== true) {
    record.restorationVerificationScheduled = false;
  }
  if (!Number.isSafeInteger(record.restorationSuccessObservations)) {
    record.restorationSuccessObservations = 0;
  }
  if (!Number.isSafeInteger(record.restorationFailureObservations)) {
    record.restorationFailureObservations = 0;
  }
  return record;
}
/** Keeps a completed verified sweep quiet until real blocker evidence or explicit user intent. */
function isPreviewInspectorNeuralSuccessCollectionSettled(state) {
  if (
    state?.targetHasOutput !== true ||
    typeof createPreviewInspectorAutomaticNeuralAssistanceKey !== 'function'
  ) return false;
  const key = createPreviewInspectorAutomaticNeuralAssistanceKey(state);
  const record = previewInspectorSession.automaticNeuralAssistanceByKey?.get?.(key);
  return record?.successCollectionSettled === true &&
    record.restoringSuccessfulPath !== true;
}
/** Prevents the page DFS from overwriting the checkpoint while its exact state is being verified. */
function isPreviewInspectorNeuralSuccessfulPathRestorationActive() {
  const key = previewInspectorSession.neuralSuccessfulPathRestorationKey;
  if (typeof key !== 'string' || key.length === 0) return false;
  const record = previewInspectorSession.automaticNeuralAssistanceByKey?.get?.(key);
  if (record?.restoringSuccessfulPath !== true) return false;
  const reachability = typeof readPreviewInspectorNeuralAssistanceReachability === 'function'
    ? readPreviewInspectorNeuralAssistanceReachability()
    : undefined;
  return reachability === undefined ||
    typeof createPreviewInspectorAutomaticNeuralAssistanceKey !== 'function' ||
    createPreviewInspectorAutomaticNeuralAssistanceKey(reachability) === key;
}
/** Marks a restored checkpoint applied only after repeated delayed visible-output observations. */
function completePreviewInspectorNeuralSuccessfulPathRestoration(record) {
  record.restoringSuccessfulPath = false;
  record.restorationFailureObservations = 0;
  record.restorationSuccessObservations = 0;
  record.restorationVerificationScheduled = false;
  record.restoringSuccessfulPathFingerprint = undefined;
  record.successCollectionSettled = true;
  record.scheduled = false;
  previewInspectorSession.neuralSuccessfulPathRestorationKey = undefined;
  previewInspectorSession.neuralAssistancePending = false;
  previewInspectorSession.neuralAssistanceSequence =
    (Number(previewInspectorSession.neuralAssistanceSequence) || 0) + 1;
  if (typeof setPreviewInspectorNeuralLearningStatus === 'function') {
    setPreviewInspectorNeuralLearningStatus({
      activeCount: 0,
      labelReason: 'best-success-path-restored',
      phase: 'applied',
      successCount: readPreviewInspectorNeuralSuccessfulPathCount(record),
      updates: typeof readPreviewInspectorNeuralLearningModelUpdates === 'function'
        ? readPreviewInspectorNeuralLearningModelUpdates()
        : 0,
    });
  }
  if (typeof continuePreviewInspectorNeuralPageContextCoverage === 'function') continuePreviewInspectorNeuralPageContextCoverage();
}
/** Rejects one unstable checkpoint and immediately starts verifying the next ranked success. */
function rejectPreviewInspectorNeuralSuccessfulPathRestoration(key, record) {
  const rejectedFingerprint = record.restoringSuccessfulPathFingerprint;
  if (typeof rejectedFingerprint === 'string') {
    record.failedSuccessRestorations.add(rejectedFingerprint);
    record.successfulPaths = record.successfulPaths.filter((candidate) =>
      candidate.fingerprint !== rejectedFingerprint);
  }
  record.restoringSuccessfulPath = false;
  record.restorationFailureObservations = 0;
  record.restorationSuccessObservations = 0;
  record.restorationVerificationScheduled = false;
  record.restoringSuccessfulPathFingerprint = undefined;
  record.bestSuccessfulPath = selectPreviewInspectorBestNeuralSuccessfulPath(record);
  record.successCollectionSettled = false;
  const retry = settlePreviewInspectorNeuralSuccessfulPaths(key);
  if (retry !== undefined) return true;
  record.successCollectionSettled = true;
  previewInspectorSession.neuralSuccessfulPathRestorationKey = undefined;
  previewInspectorSession.neuralAssistancePending = false;
  const reachability = typeof readPreviewInspectorNeuralAssistanceReachability === 'function'
    ? readPreviewInspectorNeuralAssistanceReachability()
    : undefined;
  if (reachability !== undefined) {
    reachability.targetHasOutput = false;
    reachability.neuralStableOutputVerified = false;
    reachability.neuralStableOutputRegressed = true;
    if (typeof observeCurrentPreviewInspectorNeuralPageContextOutcome === 'function') {
      observeCurrentPreviewInspectorNeuralPageContextOutcome(reachability);
    }
  }
  if (typeof setPreviewInspectorNeuralNeedsChoiceStatus === 'function') {
    setPreviewInspectorNeuralNeedsChoiceStatus('verified-path-restoration-failed');
  } else if (typeof setPreviewInspectorNeuralLearningStatus === 'function') {
    setPreviewInspectorNeuralLearningStatus({
      activeCount: 0,
      labelReason: 'verified-path-restoration-failed',
      phase: 'needs-choice',
      successCount: readPreviewInspectorNeuralSuccessfulPathCount(record),
      updates: typeof readPreviewInspectorNeuralLearningModelUpdates === 'function'
        ? readPreviewInspectorNeuralLearningModelUpdates()
        : 0,
    });
  }
  return false;
}
/** Rechecks real target geometry across delayed frames so transient output cannot win restoration. */
function schedulePreviewInspectorNeuralSuccessfulPathRestorationVerification(key) {
  const record = previewInspectorSession.automaticNeuralAssistanceByKey?.get?.(key);
  if (
    record?.restoringSuccessfulPath !== true ||
    record.restorationVerificationScheduled === true
  ) return false;
  record.restorationVerificationScheduled = true;
  const verify = () => {
    record.restorationVerificationScheduled = false;
    if (
      record.restoringSuccessfulPath !== true ||
      previewInspectorSession.neuralSuccessfulPathRestorationKey !== key
    ) return;
    const reachability = typeof readPreviewInspectorNeuralAssistanceReachability === 'function'
      ? readPreviewInspectorNeuralAssistanceReachability()
      : undefined;
    const restored = record.successfulPaths.find((candidate) =>
      candidate.fingerprint === record.restoringSuccessfulPathFingerprint);
    const stable = isPreviewInspectorNeuralSuccessSnapshotVisible(reachability, restored);
    if (stable) {
      reachability.targetHasOutput = true;
      reachability.status = 'reached';
      record.restorationFailureObservations = 0;
      record.restorationSuccessObservations =
        (Number(record.restorationSuccessObservations) || 0) + 1;
      if (
        record.restorationSuccessObservations >=
        PREVIEW_INSPECTOR_NEURAL_RESTORATION_SUCCESS_OBSERVATIONS
      ) {
        completePreviewInspectorNeuralSuccessfulPathRestoration(record);
        if (typeof notifyPreviewInspector === 'function') notifyPreviewInspector();
        if (typeof schedulePreviewInspectorTreeRefresh === 'function') {
          schedulePreviewInspectorTreeRefresh();
        }
        return;
      }
    } else {
      if (reachability !== undefined) reachability.targetHasOutput = false;
      record.restorationSuccessObservations = 0;
      record.restorationFailureObservations =
        (Number(record.restorationFailureObservations) || 0) + 1;
      if (
        record.restorationFailureObservations >=
        PREVIEW_INSPECTOR_NEURAL_RESTORATION_FAILURE_OBSERVATIONS
      ) {
        rejectPreviewInspectorNeuralSuccessfulPathRestoration(key, record);
        return;
      }
    }
    schedulePreviewInspectorNeuralSuccessfulPathRestorationVerification(key);
  };
  if (typeof globalThis.setTimeout === 'function') {
    globalThis.setTimeout(
      verify,
      PREVIEW_INSPECTOR_NEURAL_RESTORATION_VERIFY_DELAY_MS,
    );
  } else if (typeof previewInspectorScheduleRuntimeEffectFrame === 'function') {
    previewInspectorScheduleRuntimeEffectFrame(verify);
  } else {
    Promise.resolve().then(verify);
  }
  return true;
}
/** Opens one exclusive restoration transaction and starts its delayed stability audit. */
function beginPreviewInspectorNeuralSuccessfulPathRestoration(key, record, best) {
  record.restoringSuccessfulPath = true;
  record.restorationFailureObservations = 0;
  record.restorationSuccessObservations = 0;
  record.restorationVerificationScheduled = false;
  record.restoringSuccessfulPathFingerprint = best.fingerprint;
  previewInspectorSession.neuralSuccessfulPathRestorationKey = key;
  previewInspectorSession.neuralAssistancePending = false;
  schedulePreviewInspectorNeuralSuccessfulPathRestorationVerification(key);
}
/** Retains only bounded, source-proven finite choice nodes while a success sweep is active. */
function readPreviewInspectorNeuralExplorationCandidates(record, currentCandidates) {
  upgradePreviewInspectorNeuralSuccessCollectionRecord(record);
  for (const node of currentCandidates) {
    const identity = typeof readPreviewInspectorNeuralAssistanceBlockerIdentity === 'function'
      ? readPreviewInspectorNeuralAssistanceBlockerIdentity(node)
      : undefined;
    const finiteChoice = typeof readPreviewInspectorNeuralFiniteChoiceProgress === 'function'
      ? readPreviewInspectorNeuralFiniteChoiceProgress(node, record, true)
      : undefined;
    if (identity !== undefined && Number(finiteChoice?.candidateCount ?? 0) > 0) {
      record.retainedFiniteChoiceBlockers.set(identity, node);
    }
  }
  while (record.retainedFiniteChoiceBlockers.size > PREVIEW_INSPECTOR_NEURAL_RETAINED_BLOCKER_LIMIT) {
    record.retainedFiniteChoiceBlockers.delete(
      record.retainedFiniteChoiceBlockers.keys().next().value,
    );
  }
  if (
    readPreviewInspectorNeuralSuccessfulPathCount(record) === 0 ||
    record.successCollectionSettled === true
  ) return currentCandidates;
  const retained = [...record.retainedFiniteChoiceBlockers.values()];
  const currentIdentities = new Set(currentCandidates.map((node) =>
    readPreviewInspectorNeuralAssistanceBlockerIdentity(node)));
  return [
    ...currentCandidates,
    ...retained.filter((node) =>
      !currentIdentities.has(readPreviewInspectorNeuralAssistanceBlockerIdentity(node))),
  ];
}
/** Rejects error/blocker overlays that can coexist briefly with stale target host geometry. */
function hasPreviewInspectorNeuralFatalSuccessBlocker() {
  if (typeof readPreviewInspectorNeuralAssistanceBlockers !== 'function') return false;
  const active = readPreviewInspectorNeuralAssistanceBlockers()?.active;
  return Array.isArray(active) && active.some((node) =>
    ['runtime-global', 'target-error'].includes(node?.blockerKind) ||
    node?.blockerKind === 'target-reachability' &&
      node?.blocker?.targetHasOutput !== true &&
      (node?.blocker?.status === 'page-blocked' || node?.blocker?.exhausted === true),
  );
}
/** Requires the same reproducible viewer state and real target-owned output at observation time. */
function isPreviewInspectorNeuralSuccessSnapshotVisible(state, snapshot) {
  if (
    state?.pageRootCommitted !== true || state?.targetWasMounted !== true ||
    state?.targetHasOutput !== true || snapshot === undefined ||
    hasPreviewInspectorNeuralFatalSuccessBlocker()
  ) return false;
  const visible = typeof hasPreviewInspectorTargetHostOutput === 'function'
    ? hasPreviewInspectorTargetHostOutput(state)
    : state.targetHasOutput === true;
  if (!visible) return false;
  const current = createPreviewInspectorNeuralSuccessSnapshot(state);
  return current?.fingerprint === snapshot.fingerprint;
}
/** Clears one untrained candidate marker when its exact viewer state was abandoned. */
function clearPreviewInspectorNeuralProvisionalSuccess(record) {
  const candidateId = record.provisionalSuccessfulPath?.pageCandidateId;
  record.provisionalSuccessfulPath = undefined;
  record.successVerificationObservations = 0;
  record.successVerificationFailureObservations = 0;
  record.successVerificationScheduled = false;
  const retainedElsewhere = typeof candidateId === 'string' && [
    ...(previewInspectorSession.automaticNeuralAssistanceByKey?.values?.() ?? []),
  ].some((candidateRecord) =>
    candidateRecord !== record &&
    candidateRecord?.provisionalSuccessfulPath?.pageCandidateId === candidateId,
  );
  if (
    !retainedElsewhere &&
    typeof clearPreviewInspectorNeuralPageContextProvisional === 'function'
  ) {
    clearPreviewInspectorNeuralPageContextProvisional(candidateId);
  }
}
/** Continues a verified sweep before declaring its best checkpoint final. */
function continuePreviewInspectorNeuralSuccessCollection(key, record) {
  if (typeof createPreviewInspectorNeuralExplorationPlan !== 'function') {
    record.successCollectionSettled = readPreviewInspectorNeuralSuccessfulPathCount(record) > 0;
    return { continued: false, remaining: false, restoring: false };
  }
  if (
    typeof shouldSettlePreviewInspectorNeuralTemporalSuccess === 'function' &&
    shouldSettlePreviewInspectorNeuralTemporalSuccess(record)
  ) {
    const settlement = settlePreviewInspectorNeuralSuccessfulPaths(key);
    return { continued: false, remaining: false, restoring: settlement?.restoring === true };
  }
  record.successCollectionSettled = false;
  const remaining = createPreviewInspectorNeuralExplorationPlan(record) !== undefined;
  if (!remaining) {
    const settlement = settlePreviewInspectorNeuralSuccessfulPaths(key);
    return {
      continued: false,
      remaining: false,
      restoring: settlement?.restoring === true,
    };
  }
  const updates = typeof readPreviewInspectorNeuralLearningModelUpdates === 'function'
    ? readPreviewInspectorNeuralLearningModelUpdates()
    : 0;
  const continued =
    typeof schedulePreviewInspectorNeuralAssistanceSweepContinuation === 'function' &&
    schedulePreviewInspectorNeuralAssistanceSweepContinuation(
      key,
      record.successCollectionRequestedBy,
      updates,
    ) === true;
  return { continued, remaining: true, restoring: false };
}
/** Promotes output only after sustained observations, then teaches and persists the page path. */
function promotePreviewInspectorNeuralProvisionalSuccess(key, record, state, snapshot) {
  const isNewSuccess = !record.successfulPaths.some((candidate) =>
    candidate.fingerprint === snapshot.fingerprint);
  if (isNewSuccess) {
    record.successfulPaths.push(snapshot);
    record.successfulPaths = record.successfulPaths.slice(-PREVIEW_INSPECTOR_NEURAL_SUCCESS_PATH_LIMIT);
  }
  clearPreviewInspectorNeuralProvisionalSuccess(record);
  record.failedSuccessRestorations.delete(snapshot.fingerprint);
  record.bestSuccessfulPath = selectPreviewInspectorBestNeuralSuccessfulPath(record);
  record.successCollectionSettled = false;
  record.scheduled = false;
  state.neuralStableOutputRegressed = false;
  state.neuralStableOutputVerified = true;
  if (typeof settlePreviewInspectorNeuralChoicePathOutcome === 'function') {
    settlePreviewInspectorNeuralChoicePathOutcome(true);
  }
  if (typeof observeCurrentPreviewInspectorNeuralPageContextOutcome === 'function') {
    observeCurrentPreviewInspectorNeuralPageContextOutcome(state);
  }
  const continuation = continuePreviewInspectorNeuralSuccessCollection(key, record);
  if (typeof setPreviewInspectorNeuralLearningStatus === 'function') {
    setPreviewInspectorNeuralLearningStatus({
      activeCount: 0,
      collecting: continuation.remaining,
      labelReason: continuation.continued
        ? 'stable-target-output-collecting'
        : continuation.remaining
          ? 'renderer-work-budget'
          : 'stable-target-output-verified',
      phase: continuation.continued
        ? 'applying'
        : continuation.remaining
          ? 'yielded'
          : continuation.restoring
            ? 'applying'
            : 'applied',
      restoring: continuation.restoring,
      successCount: readPreviewInspectorNeuralSuccessfulPathCount(record),
      updates: typeof readPreviewInspectorNeuralLearningModelUpdates === 'function'
        ? readPreviewInspectorNeuralLearningModelUpdates()
        : 0,
    });
  }
  if (typeof notifyPreviewInspector === 'function') notifyPreviewInspector();
  if (typeof schedulePreviewInspectorTreeRefresh === 'function') {
    schedulePreviewInspectorTreeRefresh();
  }
  return isNewSuccess;
}
/** Demotes output that vanished before verification and advances the finite page-path search. */
function rejectPreviewInspectorNeuralProvisionalSuccess(key, record, state, snapshot) {
  record.failedSuccessRestorations.add(snapshot.fingerprint);
  clearPreviewInspectorNeuralProvisionalSuccess(record);
  record.successCollectionSettled = false;
  state.targetHasOutput = false;
  state.neuralStableOutputVerified = false;
  state.neuralStableOutputRegressed = true;
  if (typeof settlePreviewInspectorNeuralChoicePathOutcome === 'function') {
    settlePreviewInspectorNeuralChoicePathOutcome(false);
  }
  const pageAdvanced = typeof observeCurrentPreviewInspectorNeuralPageContextOutcome === 'function'
    ? observeCurrentPreviewInspectorNeuralPageContextOutcome(state)
    : false;
  const continuation = continuePreviewInspectorNeuralSuccessCollection(key, record);
  if (continuation.remaining && typeof setPreviewInspectorNeuralLearningStatus === 'function') {
    setPreviewInspectorNeuralLearningStatus({
      activeCount: 0,
      collecting: readPreviewInspectorNeuralSuccessfulPathCount(record) > 0,
      labelReason: continuation.continued
        ? 'transient-target-output-continuing'
        : 'renderer-work-budget',
      phase: continuation.continued ? 'applying' : 'yielded',
      successCount: readPreviewInspectorNeuralSuccessfulPathCount(record),
      updates: typeof readPreviewInspectorNeuralLearningModelUpdates === 'function'
        ? readPreviewInspectorNeuralLearningModelUpdates()
        : 0,
      verifying: false,
    });
  } else if (pageAdvanced && typeof setPreviewInspectorNeuralLearningStatus === 'function') {
    setPreviewInspectorNeuralLearningStatus({
      activeCount: 0,
      collecting: false,
      labelReason: 'transient-target-output-rejected',
      phase: 'applying',
      successCount: readPreviewInspectorNeuralSuccessfulPathCount(record),
      updates: typeof readPreviewInspectorNeuralLearningModelUpdates === 'function'
        ? readPreviewInspectorNeuralLearningModelUpdates()
        : 0,
      verifying: false,
    });
  } else if (!pageAdvanced && typeof setPreviewInspectorNeuralNeedsChoiceStatus === 'function') {
    setPreviewInspectorNeuralNeedsChoiceStatus('transient-target-output-rejected');
  }
  if (typeof notifyPreviewInspector === 'function') notifyPreviewInspector();
  if (typeof schedulePreviewInspectorTreeRefresh === 'function') {
    schedulePreviewInspectorTreeRefresh();
  }
}
/** Samples a provisional success over delayed frames so one lucky commit cannot train the model. */
function schedulePreviewInspectorNeuralProvisionalSuccessVerification(key) {
  const record = previewInspectorSession.automaticNeuralAssistanceByKey?.get?.(key);
  if (record === undefined || record.successVerificationScheduled === true) return false;
  const snapshot = record.provisionalSuccessfulPath;
  if (snapshot === undefined) return false;
  record.successVerificationScheduled = true;
  const verify = () => {
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
/** Records a provisional output candidate and waits for stability before calling it success. */
function recordPreviewInspectorNeuralSuccessfulPath(state) {
  if (
    !(previewInspectorSession.automaticNeuralAssistanceByKey instanceof Map) &&
    typeof initializePreviewInspectorAutomaticNeuralAssistanceState === 'function'
  ) {
    initializePreviewInspectorAutomaticNeuralAssistanceState();
  }
  if (!(previewInspectorSession.automaticNeuralAssistanceByKey instanceof Map)) return false;
  const key = typeof createPreviewInspectorAutomaticNeuralAssistanceKey === 'function'
    ? createPreviewInspectorAutomaticNeuralAssistanceKey(state)
    : undefined;
  if (typeof key !== 'string') return false;
  const record = typeof readPreviewInspectorAutomaticNeuralAssistanceRecord === 'function'
    ? readPreviewInspectorAutomaticNeuralAssistanceRecord(key)
    : previewInspectorSession.automaticNeuralAssistanceByKey.get(key);
  const snapshot = createPreviewInspectorNeuralSuccessSnapshot(state);
  if (record === undefined || snapshot === undefined) return false;
  upgradePreviewInspectorNeuralSuccessCollectionRecord(record);
  if (typeof activatePreviewInspectorNeuralTemporalStateContract === 'function') {
    activatePreviewInspectorNeuralTemporalStateContract(snapshot.temporalState);
  }
  if (snapshot.temporalState?.released === true) return false;
  if (typeof promotePreviewInspectorNeuralTemporalSuccessIfObserved === 'function' && promotePreviewInspectorNeuralTemporalSuccessIfObserved(key, record, state, snapshot)) return true;
  const verified = record.successfulPaths.some((candidate) =>
    candidate.fingerprint === snapshot.fingerprint);
  if (verified) {
    record.failedSuccessRestorations.delete(snapshot.fingerprint);
    record.bestSuccessfulPath = selectPreviewInspectorBestNeuralSuccessfulPath(record);
    if (typeof createPreviewInspectorNeuralExplorationPlan !== 'function') {
      record.successCollectionSettled = true;
    }
    state.neuralStableOutputVerified = true;
    state.neuralStableOutputRegressed = false;
    if (record.restoringSuccessfulPath === true) {
      schedulePreviewInspectorNeuralSuccessfulPathRestorationVerification(key);
      return true;
    }
    return false;
  }
  if (record.restoringSuccessfulPath === true) {
    schedulePreviewInspectorNeuralSuccessfulPathRestorationVerification(key);
    return true;
  }
  const changed = record.provisionalSuccessfulPath?.fingerprint !== snapshot.fingerprint;
  if (changed && record.provisionalSuccessfulPath !== undefined) {
    record.failedSuccessRestorations.add(record.provisionalSuccessfulPath.fingerprint);
    clearPreviewInspectorNeuralProvisionalSuccess(record);
  }
  if (changed) {
    record.provisionalSuccessfulPath = snapshot;
    record.successVerificationObservations = 0;
    record.successVerificationFailureObservations = 0;
  }
  record.successCollectionSettled = false;
  record.scheduled = false;
  if (typeof markPreviewInspectorNeuralPageContextProvisional === 'function') {
    markPreviewInspectorNeuralPageContextProvisional(state);
  }
  schedulePreviewInspectorNeuralProvisionalSuccessVerification(key);
  if (changed && typeof notifyPreviewInspector === 'function') notifyPreviewInspector();
  return changed;
}
/** Restores generated backend/hook values while preserving explicit user-owned overrides. */
function restorePreviewInspectorNeuralSuccessViewerValues(best) {
  if (typeof initializePreviewInspectorDataState === 'function') {
    initializePreviewInspectorDataState();
  }
  if (previewInspectorSession.dataPayloadOverrides instanceof Map) {
    const nextData = new Map(previewInspectorSession.dataPayloadOverrides);
    const isUserData = (value) => ['custom', 'smart-custom'].includes(value?.mode);
    for (const requestId of best.dataRequestIds ?? []) {
      if (!isUserData(nextData.get(requestId))) nextData.delete(requestId);
    }
    for (const [requestId, value] of best.dataPayloadEntries ?? []) {
      if (isUserData(nextData.get(requestId))) continue;
      nextData.set(requestId, copyPreviewInspectorNeuralSuccessValue(value));
    }
    previewInspectorSession.dataPayloadOverrides = nextData;
    previewInspectorSession.dataAutoEnabled = best.dataAutoEnabled !== false;
    previewInspectorSession.dataRevision =
      (Number(previewInspectorSession.dataRevision) || 0) + 1;
    for (const requestId of best.dataRequestIds ?? []) {
      if (typeof clearPreviewInspectorVirtualBackendResource === 'function') {
        clearPreviewInspectorVirtualBackendResource(requestId);
      }
    }
  }
  if (typeof initializePreviewInspectorRuntimeFallbackState === 'function') {
    initializePreviewInspectorRuntimeFallbackState();
  }
  if (previewInspectorSession.runtimeFallbackValues instanceof Map) {
    const manual = previewInspectorSession.runtimeFallbackOverrides;
    const isManual = (fallbackId) => manual?.has?.(fallbackId) === true;
    for (const fallbackId of best.runtimeFallbackIds ?? []) {
      if (isManual(fallbackId)) continue;
      previewInspectorSession.runtimeFallbackValues.delete(fallbackId);
      previewInspectorSession.runtimeFallbackSmartIds?.delete?.(fallbackId);
      previewInspectorSession.runtimeFallbackSmartPathSignatures?.delete?.(fallbackId);
    }
    for (const [fallbackId, value] of best.runtimeFallbackValueEntries ?? []) {
      if (!isManual(fallbackId)) {
        previewInspectorSession.runtimeFallbackValues.set(
          fallbackId,
          copyPreviewInspectorNeuralSuccessValue(value),
        );
      }
    }
    for (const fallbackId of best.runtimeFallbackSmartIds ?? []) {
      if (!isManual(fallbackId)) previewInspectorSession.runtimeFallbackSmartIds?.add?.(fallbackId);
    }
    for (const [fallbackId, signature] of best.runtimeFallbackSmartPathEntries ?? []) {
      if (!isManual(fallbackId)) {
        previewInspectorSession.runtimeFallbackSmartPathSignatures?.set?.(
          fallbackId,
          signature,
        );
      }
    }
    previewInspectorSession.fallbackValuesEnabled = best.fallbackValuesEnabled !== false;
  }
}
/** Settles the best verified snapshot without consuming retained user-selectable alternatives. */
function settlePreviewInspectorNeuralSuccessfulPaths(key) {
  const record = previewInspectorSession.automaticNeuralAssistanceByKey?.get?.(key);
  if (record === undefined) return undefined;
  upgradePreviewInspectorNeuralSuccessCollectionRecord(record);
  const best = selectPreviewInspectorBestNeuralSuccessfulPath(record);
  record.bestSuccessfulPath = best;
  const successCount = readPreviewInspectorNeuralSuccessfulPathCount(record);
  if (best === undefined) return undefined;
  if (typeof settlePreviewInspectorNeuralTemporalSuccess === 'function' && settlePreviewInspectorNeuralTemporalSuccess(record)) return { restoring: false, settled: true, successCount };
  if (record.restoringSuccessfulPath === true) {
    return { restoring: true, settled: false, successCount };
  }
  const alreadySettled = record.successCollectionSettled === true;
  record.successCollectionSettled = true;
  const reachability = typeof readPreviewInspectorNeuralAssistanceReachability === 'function'
    ? readPreviewInspectorNeuralAssistanceReachability()
    : undefined;
  const current = reachability?.targetHasOutput === true
    ? createPreviewInspectorNeuralSuccessSnapshot(reachability)
    : undefined;
  if (alreadySettled && current?.fingerprint === best.fingerprint) {
    return { restoring: false, settled: true, successCount };
  }
  if (current?.fingerprint === best.fingerprint) {
    if (typeof activatePreviewInspectorNeuralTemporalStateContract === 'function') {
      activatePreviewInspectorNeuralTemporalStateContract(best.temporalState);
    }
    beginPreviewInspectorNeuralSuccessfulPathRestoration(key, record, best);
    return { restoring: true, settled: false, successCount };
  }
  if (typeof initializePreviewInspectorConditionState === 'function') {
    initializePreviewInspectorConditionState();
  }
  const nextConditions = new Map(best.conditionEntries);
  previewInspectorSession.renderConditionAutoOverrides = nextConditions;
  if (previewInspectorSession.renderConditions instanceof Map) {
    for (const [conditionId, condition] of previewInspectorSession.renderConditions) {
      if (previewInspectorSession.renderConditionOverrides?.has?.(conditionId)) continue;
      previewInspectorSession.renderConditions.set(conditionId, {
        ...condition,
        effectiveEnabled: nextConditions.has(conditionId)
          ? nextConditions.get(conditionId)
          : condition.authoredEnabled,
      });
    }
  }
  if (best.pageCandidateId.length > 0) {
    previewInspectorSession.selectedPageCandidateId = best.pageCandidateId;
  }
  if (typeof setPreviewInspectorNeuralActiveChoicePath === 'function') {
    setPreviewInspectorNeuralActiveChoicePath(best.choicePathId);
  }
  restorePreviewInspectorNeuralSuccessViewerValues(best);
  if (typeof restorePreviewInspectorNeuralTemporalStateSnapshot === 'function') {
    restorePreviewInspectorNeuralTemporalStateSnapshot(best.temporalState);
  }
  if (previewInspectorSession.resolverPropsByExport instanceof Map) {
    if (best.hasResolverProps) {
      previewInspectorSession.resolverPropsByExport.set(
        best.exportName,
        copyPreviewInspectorNeuralSuccessValue(best.resolverProps),
      );
    } else {
      previewInspectorSession.resolverPropsByExport.delete(best.exportName);
    }
  }
  previewInspectorSession.renderConditionAutoAttempts?.clear?.();
  previewInspectorSession.renderConditionRevision =
    (Number(previewInspectorSession.renderConditionRevision) || 0) + 1;
  if (previewInspectorSession.propsRevisionByExport instanceof Map) {
    const revision = previewInspectorSession.propsRevisionByExport.get(best.exportName) ?? 0;
    previewInspectorSession.propsRevisionByExport.set(best.exportName, revision + 1);
  }
  beginPreviewInspectorNeuralSuccessfulPathRestoration(key, record, best);
  if (typeof notifyPreviewInspector === 'function') notifyPreviewInspector();
  if (typeof schedulePreviewInspectorCommitRefresh === 'function') {
    schedulePreviewInspectorCommitRefresh();
  }
  if (typeof schedulePreviewInspectorTreeRefresh === 'function') schedulePreviewInspectorTreeRefresh();
  return { restoring: true, settled: false, successCount };
}
/** Clears the delayed regression observer without altering the retained checkpoint inventory. */
function clearPreviewInspectorNeuralSuccessRegression(record) {
  record.regressionVerificationFingerprint = undefined;
  record.regressionReachabilityState = undefined;
  record.regressionVerificationScheduled = false;
  record.regressionFailureObservations = 0;
}
/** Removes a formerly stable output and teaches the page ranker that the path regressed. */
function rejectPreviewInspectorNeuralStableSuccess(record, state, fingerprint) {
  record.successfulPaths = record.successfulPaths.filter((candidate) =>
    candidate.fingerprint !== fingerprint);
  record.failedSuccessRestorations.add(fingerprint);
  clearPreviewInspectorNeuralSuccessRegression(record);
  record.bestSuccessfulPath = selectPreviewInspectorBestNeuralSuccessfulPath(record);
  record.successCollectionSettled = false;
  state.targetHasOutput = false;
  state.neuralStableOutputVerified = false;
  state.neuralStableOutputRegressed = true;
  const pageAdvanced = typeof observeCurrentPreviewInspectorNeuralPageContextOutcome === 'function'
    ? observeCurrentPreviewInspectorNeuralPageContextOutcome(state)
    : false;
  if (pageAdvanced && typeof setPreviewInspectorNeuralLearningStatus === 'function') {
    setPreviewInspectorNeuralLearningStatus({
      activeCount: 0,
      collecting: false,
      labelReason: 'stable-target-output-regressed',
      phase: 'applying',
      successCount: readPreviewInspectorNeuralSuccessfulPathCount(record),
      updates: typeof readPreviewInspectorNeuralLearningModelUpdates === 'function'
        ? readPreviewInspectorNeuralLearningModelUpdates()
        : 0,
      verifying: false,
    });
  }
  if (
    !pageAdvanced && record.bestSuccessfulPath !== undefined &&
    typeof createPreviewInspectorAutomaticNeuralAssistanceKey === 'function'
  ) {
    settlePreviewInspectorNeuralSuccessfulPaths(
      createPreviewInspectorAutomaticNeuralAssistanceKey(state),
    );
  } else if (!pageAdvanced && typeof setPreviewInspectorNeuralNeedsChoiceStatus === 'function') {
    setPreviewInspectorNeuralNeedsChoiceStatus('stable-target-output-regressed');
  }
  if (typeof notifyPreviewInspector === 'function') notifyPreviewInspector();
  if (typeof schedulePreviewInspectorTreeRefresh === 'function') {
    schedulePreviewInspectorTreeRefresh();
  }
}
/** Confirms a white/blocker-only regression twice before revoking a verified checkpoint. */
function schedulePreviewInspectorNeuralSuccessRegressionVerification(key) {
  const record = previewInspectorSession.automaticNeuralAssistanceByKey?.get?.(key);
  if (record === undefined || record.regressionVerificationScheduled === true) return false;
  const fingerprint = record.regressionVerificationFingerprint;
  const snapshot = record.successfulPaths.find((candidate) =>
    candidate.fingerprint === fingerprint);
  if (snapshot === undefined) {
    clearPreviewInspectorNeuralSuccessRegression(record);
    return false;
  }
  record.regressionVerificationScheduled = true;
  const verify = () => {
    record.regressionVerificationScheduled = false;
    if (record.regressionVerificationFingerprint !== fingerprint) return;
    const state = typeof readPreviewInspectorNeuralAssistanceReachability === 'function'
      ? readPreviewInspectorNeuralAssistanceReachability()
      : undefined;
    const activeKey = state !== undefined &&
      typeof createPreviewInspectorAutomaticNeuralAssistanceKey === 'function'
        ? createPreviewInspectorAutomaticNeuralAssistanceKey(state)
        : undefined;
    if (activeKey !== key) {
      const failedState = record.regressionReachabilityState;
      if (failedState?.neuralPageContextOutcome === 'failed') {
        record.successfulPaths = record.successfulPaths.filter((candidate) =>
          candidate.fingerprint !== fingerprint);
        record.failedSuccessRestorations.add(fingerprint);
        record.bestSuccessfulPath = selectPreviewInspectorBestNeuralSuccessfulPath(record);
        record.successCollectionSettled = false;
      }
      clearPreviewInspectorNeuralSuccessRegression(record);
      return;
    }
    if (isPreviewInspectorNeuralSuccessSnapshotVisible(state, snapshot)) {
      clearPreviewInspectorNeuralSuccessRegression(record);
      state.neuralStableOutputVerified = true;
      state.neuralStableOutputRegressed = false;
      return;
    }
    record.regressionFailureObservations += 1;
    if (
      record.regressionFailureObservations >=
      PREVIEW_INSPECTOR_NEURAL_SUCCESS_FAILURE_OBSERVATIONS
    ) {
      rejectPreviewInspectorNeuralStableSuccess(record, state, fingerprint);
      return;
    }
    schedulePreviewInspectorNeuralSuccessRegressionVerification(key);
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
/** Retries restored checkpoints and audits any verified path that later loses target output. */
function handlePreviewInspectorNeuralSuccessfulPathRestorationFailure(state) {
  if (state?.pageRootCommitted !== true || state?.targetWasMounted !== true) return false;
  const key = typeof createPreviewInspectorAutomaticNeuralAssistanceKey === 'function'
    ? createPreviewInspectorAutomaticNeuralAssistanceKey(state)
    : undefined;
  const record = typeof key === 'string'
    ? previewInspectorSession.automaticNeuralAssistanceByKey?.get?.(key)
    : undefined;
  if (record === undefined) return false;
  upgradePreviewInspectorNeuralSuccessCollectionRecord(record);
  if (record.restoringSuccessfulPath === true) {
    schedulePreviewInspectorNeuralSuccessfulPathRestorationVerification(key);
    return true;
  }
  const current = createPreviewInspectorNeuralSuccessSnapshot(state);
  const verified = record.successfulPaths.find((candidate) =>
    candidate.fingerprint === current?.fingerprint);
  if (verified === undefined) return false;
  if (record.regressionVerificationFingerprint !== verified.fingerprint) {
    clearPreviewInspectorNeuralSuccessRegression(record);
    record.regressionVerificationFingerprint = verified.fingerprint;
    record.regressionReachabilityState = state;
  }
  schedulePreviewInspectorNeuralSuccessRegressionVerification(key);
  return true;
}
`;
}
