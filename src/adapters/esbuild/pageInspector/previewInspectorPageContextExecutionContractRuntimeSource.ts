/** Generates candidate-scoped viewer-state contracts for page-context exploration. */

/**
 * Keeps automatic conditions, generated data, runtime fallbacks, and resolver props from leaking
 * between compiler-proven caller/HOC paths while retaining reproducible successful checkpoints.
 */
export function createPreviewInspectorPageContextExecutionContractRuntimeSource(): string {
  return String.raw`
const PREVIEW_INSPECTOR_NEURAL_TEMPORAL_SIGNAL_LIMIT = 24;
const PREVIEW_INSPECTOR_NEURAL_TEMPORAL_RELEASE_LIMIT = 64;
const PREVIEW_INSPECTOR_NEURAL_TEMPORAL_OBSERVATION_WINDOW_MS = 960;
const previewInspectorNeuralTransientTargetPattern =
  /(?:skeleton|loader|loading|spinner|shimmer|placeholder|progress)(?:component|content|panel|view)?$/iu;
const previewInspectorNeuralTransientStatePattern =
  /(?:^|[^a-z])(?:loading|pending|fetching|initializing|connecting|preparing|opening|suspended)(?:$|[^a-z])/iu;

/** Keeps time contracts revision-local so a hot edit cannot retain a paused request. */
function initializePreviewInspectorNeuralTemporalState() {
  const entryChanged = previewInspectorSession.neuralTemporalStateEntryRevision !==
    previewEntryRevision;
  const staleRequestIds = entryChanged &&
    previewInspectorSession.temporalBackendScenarioOverrides instanceof Map
      ? [...previewInspectorSession.temporalBackendScenarioOverrides.keys()]
      : [];
  if (entryChanged) {
    previewInspectorSession.neuralTemporalStateEntryRevision = previewEntryRevision;
    previewInspectorSession.activeNeuralTemporalStateContract = undefined;
    previewInspectorSession.lastReleasedNeuralTemporalStateContract = undefined;
    previewInspectorSession.releasedNeuralTemporalStateFingerprints = new Set();
    previewInspectorSession.temporalBackendScenarioOverrides = new Map();
  }
  if (!(previewInspectorSession.releasedNeuralTemporalStateFingerprints instanceof Set)) {
    previewInspectorSession.releasedNeuralTemporalStateFingerprints = new Set();
  }
  if (!(previewInspectorSession.temporalBackendScenarioOverrides instanceof Map)) {
    previewInspectorSession.temporalBackendScenarioOverrides = new Map();
  }
  if (
    staleRequestIds.length > 0 &&
    typeof releasePreviewInspectorVirtualBackendPendingRequests === 'function'
  ) releasePreviewInspectorVirtualBackendPendingRequests(staleRequestIds);
}

/** Recognizes a compiler-observed scalar that denotes an in-progress application phase. */
function isPreviewInspectorNeuralTransientStateScalar(path, value) {
  const normalizedPath = String(path ?? '').replaceAll('_', '').toLowerCase();
  const pathNamesTransient = /(?:loading|pending|fetching|initializing|connecting|preparing|opening|suspended)/u
    .test(normalizedPath);
  if (typeof value === 'boolean') return value && pathNamesTransient;
  if (typeof value !== 'string') return false;
  return previewInspectorNeuralTransientStatePattern.test(value) ||
    (pathNamesTransient && !/(?:ready|loaded|resolved|complete|success|idle|closed)/iu.test(value));
}

/** Reads exact render-state leaves without evaluating project getters. */
function collectPreviewInspectorNeuralTemporalRuntimeStateEntries(state) {
  if (!(previewInspectorSession.runtimeFallbacks instanceof Map)) return Object.freeze([]);
  const values = previewInspectorSession.runtimeFallbackValues;
  const entries = [];
  for (const [fallbackId, record] of previewInspectorSession.runtimeFallbacks) {
    if (
      entries.length >= PREVIEW_INSPECTOR_NEURAL_TEMPORAL_SIGNAL_LIMIT ||
      record?.reachabilityKey !== state?.key || !Array.isArray(record?.smartPathValues)
    ) continue;
    const rootValue = values?.get?.(fallbackId);
    for (const item of record.smartPathValues) {
      if (entries.length >= PREVIEW_INSPECTOR_NEURAL_TEMPORAL_SIGNAL_LIMIT) break;
      if (item?.role !== 'render-state' || typeof item?.path !== 'string') continue;
      const parsed = item.path === '<root>' || typeof parsePreviewInspectorRequiredPath !== 'function'
        ? undefined
        : parsePreviewInspectorRequiredPath(item.path);
      const value = item.path === '<root>'
        ? rootValue
        : parsed === undefined || typeof readPreviewInspectorRequiredPathSeed !== 'function'
          ? undefined
          : readPreviewInspectorRequiredPathSeed(rootValue, parsed.path);
      if (
        value !== null && typeof value !== 'boolean' && typeof value !== 'number' &&
        typeof value !== 'string'
      ) continue;
      entries.push(Object.freeze({
        fallbackId,
        path: item.path,
        transient: isPreviewInspectorNeuralTransientStateScalar(item.path, value),
        value,
      }));
    }
  }
  return Object.freeze(entries);
}

/** Captures reached loading guards separately from ordinary branch conditions. */
function collectPreviewInspectorNeuralTemporalConditionEntries(state) {
  if (!(previewInspectorSession.renderConditions instanceof Map)) return Object.freeze([]);
  return Object.freeze([...previewInspectorSession.renderConditions]
    .filter(([, condition]) =>
      condition?.reachabilityKey === state?.key &&
      /(?:loading|pending|fetching|initializing|connecting|preparing|opening|suspended)/iu
        .test(String(condition?.expression ?? '')),
    )
    .slice(0, PREVIEW_INSPECTOR_NEURAL_TEMPORAL_SIGNAL_LIMIT)
    .map(([id, condition]) => Object.freeze({
      enabled: condition.effectiveEnabled === true,
      expression: String(condition.expression ?? '').slice(0, 240),
      id,
    })));
}

/** Selects only viewer-owned reads on the exact corridor; explicit user scenarios remain authoritative. */
function collectPreviewInspectorNeuralTemporalBackendEntries(state, transient) {
  if (!transient || !(previewInspectorSession.dataRequests instanceof Map)) return Object.freeze([]);
  if (typeof initializePreviewInspectorVirtualBackendState === 'function') {
    initializePreviewInspectorVirtualBackendState();
  }
  return Object.freeze([...previewInspectorSession.dataRequests]
    .filter(([requestId, request]) =>
      request?.reachabilityKey === state?.key &&
      previewInspectorSession.virtualBackendScenarios?.has?.(requestId) !== true &&
      (request?.kind === 'graphql' || String(request?.method ?? 'GET').toUpperCase() === 'GET'),
    )
    .slice(0, PREVIEW_INSPECTOR_NEURAL_TEMPORAL_SIGNAL_LIMIT)
    .map(([requestId]) => Object.freeze({
      latencyMs: 0,
      mode: 'pending',
      requestId,
      status: 200,
    })));
}

/** Adds the observed application-time checkpoint to one reproducible candidate snapshot. */
function createPreviewInspectorNeuralTemporalStateSnapshot(state) {
  initializePreviewInspectorNeuralTemporalState();
  if (typeof initializePreviewInspectorRuntimeFallbackState === 'function') {
    initializePreviewInspectorRuntimeFallbackState();
  }
  if (typeof initializePreviewInspectorDataState === 'function') initializePreviewInspectorDataState();
  const pageCandidateId = typeof previewInspectorSession.selectedPageCandidateId === 'string'
    ? previewInspectorSession.selectedPageCandidateId
    : '';
  const targetExportName = String(
    state?.targetExportName ?? previewInspectorSession.selectedExportName ?? '',
  );
  const applicationPath = (Array.isArray(state?.applicationPath) ? state.applicationPath : [])
    .filter((value) => typeof value === 'string')
    .slice(0, PREVIEW_INSPECTOR_NEURAL_TEMPORAL_SIGNAL_LIMIT);
  const runtimeStateEntries = collectPreviewInspectorNeuralTemporalRuntimeStateEntries(state);
  const conditionEntries = collectPreviewInspectorNeuralTemporalConditionEntries(state);
  const targetRoleTransient = previewInspectorNeuralTransientTargetPattern.test(targetExportName);
  const statusTransient = previewInspectorNeuralTransientStatePattern.test(String(state?.status ?? ''));
  const transient = targetRoleTransient || statusTransient ||
    runtimeStateEntries.some((entry) => entry.transient === true);
  const kind = transient ? 'transient-checkpoint' : 'terminal-stable';
  const backendScenarioEntries = collectPreviewInspectorNeuralTemporalBackendEntries(
    state,
    transient,
  );
  const fingerprint = JSON.stringify({
    applicationPath,
    backendRequestIds: backendScenarioEntries.map((entry) => entry.requestId),
    conditionEntries,
    kind,
    pageCandidateId,
    revision: previewEntryRevision,
    runtimeStateEntries,
    targetExportName,
  });
  const releasedForCandidate = previewInspectorSession.lastReleasedNeuralTemporalStateContract;
  const released = previewInspectorSession.releasedNeuralTemporalStateFingerprints.has(fingerprint) ||
    kind === 'transient-checkpoint' &&
      releasedForCandidate?.pageCandidateId === pageCandidateId &&
      releasedForCandidate?.released === true;
  return Object.freeze({
    applicationPath: Object.freeze(applicationPath),
    backendScenarioEntries,
    conditionEntries,
    fingerprint,
    holdPolicy: transient ? 'viewer-pending-until-resume' : 'none',
    kind,
    observationWindowMs: PREVIEW_INSPECTOR_NEURAL_TEMPORAL_OBSERVATION_WINDOW_MS,
    observedAt: Date.now(),
    pageCandidateId,
    released,
    runtimeStateEntries,
    signalCount: Number(targetRoleTransient) + Number(statusTransient) +
      runtimeStateEntries.length + conditionEntries.length + backendScenarioEntries.length,
    targetExportName,
  });
}

/** Returns the active candidate-scoped checkpoint, never a stale path's paused clock. */
function readPreviewInspectorActiveNeuralTemporalStateContract(candidateId) {
  initializePreviewInspectorNeuralTemporalState();
  const contract = previewInspectorSession.activeNeuralTemporalStateContract;
  const expectedCandidateId = typeof candidateId === 'string'
    ? candidateId
    : previewInspectorSession.selectedPageCandidateId;
  return contract?.kind === 'transient-checkpoint' && contract.released !== true &&
    contract.pageCandidateId === expectedCandidateId
    ? contract
    : undefined;
}

/** Reports whether automatic repair must preserve the currently displayed loading checkpoint. */
function isPreviewInspectorNeuralTemporalStateContractActive(candidateId) {
  return readPreviewInspectorActiveNeuralTemporalStateContract(candidateId) !== undefined;
}

/** Retains the user's Resume verdict so expected loading disappearance is not treated as failure. */
function readPreviewInspectorReleasedNeuralTemporalStateContract(candidateId) {
  initializePreviewInspectorNeuralTemporalState();
  const contract = previewInspectorSession.lastReleasedNeuralTemporalStateContract;
  const expectedCandidateId = typeof candidateId === 'string'
    ? candidateId
    : previewInspectorSession.selectedPageCandidateId;
  return contract?.kind === 'transient-checkpoint' && contract.released === true &&
    contract.pageCandidateId === expectedCandidateId &&
    previewInspectorSession.releasedNeuralTemporalStateFingerprints.has(contract.fingerprint)
    ? contract
    : undefined;
}

/** Reports the candidate whose authored time progression the user explicitly resumed. */
function isPreviewInspectorNeuralTemporalStateContractReleased(candidateId) {
  return readPreviewInspectorReleasedNeuralTemporalStateContract(candidateId) !== undefined;
}

/** Arms viewer-owned reads before a transient target's first loading render can disappear. */
function shouldHoldPreviewInspectorNeuralTransientTargetRequest(request) {
  initializePreviewInspectorNeuralTemporalState();
  const candidateId = previewInspectorSession.selectedPageCandidateId;
  const targetExportName = String(previewInspectorSession.selectedExportName ?? '');
  const method = String(request?.method ?? 'GET').toUpperCase();
  if (
    request === null || typeof request !== 'object' ||
    !previewInspectorNeuralTransientTargetPattern.test(targetExportName) ||
    (request.kind !== 'graphql' && method !== 'GET') ||
    previewInspectorSession.virtualBackendScenarios?.has?.(request.id) === true ||
    isPreviewInspectorNeuralTemporalStateContractReleased(candidateId)
  ) return false;
  const activeKey = previewInspectorSession.activeTargetReachabilityKey;
  return typeof request.reachabilityKey !== 'string' || typeof activeKey !== 'string' ||
    request.reachabilityKey === activeKey;
}

/** Restores a time contract without persisting its automatic pending transport policy. */
function restorePreviewInspectorNeuralTemporalStateSnapshot(temporalState) {
  initializePreviewInspectorNeuralTemporalState();
  const previous = previewInspectorSession.temporalBackendScenarioOverrides;
  const applicable = temporalState?.kind === 'transient-checkpoint' &&
    temporalState.released !== true &&
    temporalState.pageCandidateId === previewInspectorSession.selectedPageCandidateId &&
    !previewInspectorSession.releasedNeuralTemporalStateFingerprints.has(temporalState.fingerprint);
  const next = new Map(applicable
    ? (temporalState.backendScenarioEntries ?? []).map((entry) => [
        entry.requestId,
        { latencyMs: 0, mode: 'pending', status: 200 },
      ])
    : []);
  const previousSignature = JSON.stringify([...previous].sort(([left], [right]) =>
    left.localeCompare(right)));
  const nextSignature = JSON.stringify([...next].sort(([left], [right]) =>
    left.localeCompare(right)));
  const previousFingerprint = previewInspectorSession.activeNeuralTemporalStateContract?.fingerprint;
  const nextFingerprint = applicable ? temporalState.fingerprint : undefined;
  if (previousSignature === nextSignature && previousFingerprint === nextFingerprint) return false;
  const releasedRequestIds = [...previous.keys()].filter((requestId) => !next.has(requestId));
  previewInspectorSession.temporalBackendScenarioOverrides = next;
  previewInspectorSession.activeNeuralTemporalStateContract = applicable
    ? temporalState
    : undefined;
  if (applicable) previewInspectorSession.lastReleasedNeuralTemporalStateContract = undefined;
  previewInspectorSession.neuralTemporalStateChangeRevision =
    (Number(previewInspectorSession.neuralTemporalStateChangeRevision) || 0) + 1;
  if (
    releasedRequestIds.length > 0 &&
    typeof releasePreviewInspectorVirtualBackendPendingRequests === 'function'
  ) releasePreviewInspectorVirtualBackendPendingRequests(releasedRequestIds);
  return true;
}

/** Pins an observed transient before the ordinary solver can optimize it away. */
function activatePreviewInspectorNeuralTemporalStateContract(temporalState) {
  if (temporalState?.kind === 'terminal-stable') {
    const released = readPreviewInspectorReleasedNeuralTemporalStateContract(
      temporalState.pageCandidateId,
    );
    if (released !== undefined) {
      previewInspectorSession.lastReleasedNeuralTemporalStateContract = undefined;
    }
    return false;
  }
  if (temporalState?.kind !== 'transient-checkpoint' || temporalState.released === true) return false;
  const changed = restorePreviewInspectorNeuralTemporalStateSnapshot(temporalState);
  if (!changed) return false;
  if (typeof notifyPreviewInspector === 'function') notifyPreviewInspector();
  if (typeof schedulePreviewInspectorTreeRefresh === 'function') {
    schedulePreviewInspectorTreeRefresh();
  }
  return true;
}

/** Lets the success collector stop at a loading surface instead of mutating the next app state. */
function shouldSettlePreviewInspectorNeuralTemporalSuccess(record) {
  const temporalState = record?.bestSuccessfulPath?.temporalState;
  return temporalState?.kind === 'transient-checkpoint' && temporalState.released !== true &&
    isPreviewInspectorNeuralTemporalStateContractActive(temporalState.pageCandidateId);
}

/** Keeps the observed loading DOM in place instead of restoring or exploring away from it. */
function settlePreviewInspectorNeuralTemporalSuccess(record) {
  if (!shouldSettlePreviewInspectorNeuralTemporalSuccess(record)) return false;
  record.restoringSuccessfulPath = false;
  record.restorationVerificationScheduled = false;
  record.restoringSuccessfulPathFingerprint = undefined;
  record.successCollectionSettled = true;
  record.scheduled = false;
  previewInspectorSession.neuralSuccessfulPathRestorationKey = undefined;
  previewInspectorSession.neuralAssistancePending = false;
  return true;
}

/** Accepts real loading geometry immediately because transience is part of this success contract. */
function promotePreviewInspectorNeuralTemporalSuccessIfObserved(key, record, state, snapshot) {
  if (
    snapshot?.temporalState?.kind !== 'transient-checkpoint' ||
    snapshot.temporalState.released === true || record?.restoringSuccessfulPath === true ||
    record?.successfulPaths?.some?.((candidate) => candidate.fingerprint === snapshot.fingerprint) ||
    typeof isPreviewInspectorNeuralSuccessSnapshotVisible !== 'function' ||
    !isPreviewInspectorNeuralSuccessSnapshotVisible(state, snapshot)
  ) return false;
  record.provisionalSuccessfulPath = snapshot;
  record.successVerificationObservations = 1;
  record.successVerificationFailureObservations = 0;
  return promotePreviewInspectorNeuralProvisionalSuccess(key, record, state, snapshot);
}

/** Releases the paused request clock and resumes the authored application progression. */
function releasePreviewInspectorNeuralTemporalStateContract() {
  initializePreviewInspectorNeuralTemporalState();
  const active = previewInspectorSession.activeNeuralTemporalStateContract;
  if (active === undefined) return false;
  previewInspectorSession.releasedNeuralTemporalStateFingerprints.add(active.fingerprint);
  while (
    previewInspectorSession.releasedNeuralTemporalStateFingerprints.size >
    PREVIEW_INSPECTOR_NEURAL_TEMPORAL_RELEASE_LIMIT
  ) {
    previewInspectorSession.releasedNeuralTemporalStateFingerprints.delete(
      previewInspectorSession.releasedNeuralTemporalStateFingerprints.values().next().value,
    );
  }
  const requestIds = [...previewInspectorSession.temporalBackendScenarioOverrides.keys()];
  previewInspectorSession.temporalBackendScenarioOverrides = new Map();
  previewInspectorSession.activeNeuralTemporalStateContract = undefined;
  previewInspectorSession.lastReleasedNeuralTemporalStateContract = Object.freeze({
    ...active,
    released: true,
    releasedAt: Date.now(),
  });
  previewInspectorSession.neuralTemporalStateChangeRevision =
    (Number(previewInspectorSession.neuralTemporalStateChangeRevision) || 0) + 1;
  previewInspectorSession.dataRevision = (Number(previewInspectorSession.dataRevision) || 0) + 1;
  previewInspectorSession.neuralAssistancePending = false;
  previewInspectorSession.neuralAssistanceSequence =
    (Number(previewInspectorSession.neuralAssistanceSequence) || 0) + 1;
  for (const record of previewInspectorSession.automaticNeuralAssistanceByKey?.values?.() ?? []) {
    const matches = (snapshot) => snapshot?.temporalState?.fingerprint === active.fingerprint;
    const temporalSnapshots = [
      ...(Array.isArray(record?.successfulPaths) ? record.successfulPaths : []),
      record?.provisionalSuccessfulPath,
      record?.bestSuccessfulPath,
    ];
    if (!temporalSnapshots.some(matches)) continue;
    const restoringTemporal = temporalSnapshots.some((snapshot) =>
      snapshot?.fingerprint === record?.restoringSuccessfulPathFingerprint && matches(snapshot));
    if (Array.isArray(record?.successfulPaths)) {
      record.successfulPaths = record.successfulPaths.filter((snapshot) => !matches(snapshot));
    }
    if (matches(record?.provisionalSuccessfulPath)) record.provisionalSuccessfulPath = undefined;
    if (matches(record?.bestSuccessfulPath)) record.bestSuccessfulPath =
      typeof selectPreviewInspectorBestNeuralSuccessfulPath === 'function'
        ? selectPreviewInspectorBestNeuralSuccessfulPath(record)
        : undefined;
    if (record?.restoringSuccessfulPath === true && restoringTemporal) {
      record.restoringSuccessfulPath = false;
      record.restorationFailureObservations = 0;
      record.restorationSuccessObservations = 0;
      record.restorationVerificationScheduled = false;
      record.restoringSuccessfulPathFingerprint = undefined;
    }
    if (record !== null && typeof record === 'object') {
      record.scheduled = false;
      record.successCollectionSettled = true;
      record.successVerificationFailureObservations = 0;
      record.successVerificationObservations = 0;
      record.successVerificationScheduled = false;
      if (temporalSnapshots.some((snapshot) =>
        snapshot?.fingerprint === record.regressionVerificationFingerprint && matches(snapshot))) {
        record.regressionFailureObservations = 0;
        record.regressionReachabilityState = undefined;
        record.regressionVerificationFingerprint = undefined;
        record.regressionVerificationScheduled = false;
      }
    }
  }
  previewInspectorSession.neuralSuccessfulPathRestorationKey = undefined;
  if (typeof releasePreviewInspectorVirtualBackendPendingRequests === 'function') {
    releasePreviewInspectorVirtualBackendPendingRequests(requestIds);
  }
  if (typeof setPreviewInspectorNeuralLearningStatus === 'function') {
    setPreviewInspectorNeuralLearningStatus({
      activeCount: 0,
      labelReason: 'temporal-checkpoint-released',
      phase: 'applied',
      successCount: 0,
      updates: typeof readPreviewInspectorNeuralLearningModelUpdates === 'function'
        ? readPreviewInspectorNeuralLearningModelUpdates()
        : 0,
    });
  }
  if (typeof notifyPreviewInspector === 'function') notifyPreviewInspector();
  if (typeof schedulePreviewInspectorCommitRefresh === 'function') {
    schedulePreviewInspectorCommitRefresh();
  }
  if (typeof schedulePreviewInspectorTreeRefresh === 'function') {
    schedulePreviewInspectorTreeRefresh();
  }
  return true;
}

/** Creates a candidate-neutral viewer baseline so one HOC path cannot leak repairs into another. */
function createPreviewInspectorNeuralPageContextCoverageBaseline() {
  if (typeof createPreviewInspectorNeuralSuccessSnapshot !== 'function') return undefined;
  const snapshot = createPreviewInspectorNeuralSuccessSnapshot({
    targetExportName: previewInspectorSession.selectedExportName,
  });
  if (snapshot === undefined) return undefined;
  return Object.freeze({
    ...snapshot,
    conditionEntries: Object.freeze([]),
    dataPayloadEntries: Object.freeze([]),
    dataRequestIds: Object.freeze([]),
    fingerprint: 'page-context-baseline:' + snapshot.exportName,
    hasResolverProps: false,
    pageCandidateId: '',
    resolverProps: undefined,
    runtimeFallbackIds: Object.freeze([]),
    runtimeFallbackSmartIds: Object.freeze([]),
    runtimeFallbackSmartPathEntries: Object.freeze([]),
    runtimeFallbackValueEntries: Object.freeze([]),
    temporalState: undefined,
  });
}

/** Retains the least invasive reproducible viewer state for one exact compiler candidate. */
function capturePreviewInspectorNeuralPageContextExecutionContract(
  record,
  candidate,
  index,
  state,
) {
  if (typeof createPreviewInspectorNeuralSuccessSnapshot !== 'function') return undefined;
  const snapshot = createPreviewInspectorNeuralSuccessSnapshot(state);
  if (snapshot === undefined || snapshot.pageCandidateId !== candidate?.id) return undefined;
  const current = record.executionContractByCandidateId.get(candidate.id);
  const replacesTransientCheckpoint =
    current?.snapshot?.temporalState?.kind === 'transient-checkpoint' &&
    snapshot.temporalState?.kind === 'terminal-stable';
  if (
    current !== undefined && !replacesTransientCheckpoint &&
    Number(current.snapshot?.score) >= Number(snapshot.score)
  ) {
    return current;
  }
  const contract = Object.freeze({
    applicationPath: Object.freeze((Array.isArray(state?.applicationPath)
      ? state.applicationPath
      : []).filter((value) => typeof value === 'string').slice(0, 24)),
    candidateId: candidate.id,
    pathIdentity: createPreviewInspectorPageContextPathIdentity(candidate, index),
    snapshot,
  });
  record.executionContractByCandidateId.set(candidate.id, contract);
  return contract;
}

/** Marks a candidate transition so its own contract is restored after the compiler hand-off. */
function preparePreviewInspectorNeuralPageContextExecutionContract(descriptor, candidateId, origin) {
  const record = readPreviewInspectorNeuralPageContextRecord(descriptor);
  if (record === undefined || typeof candidateId !== 'string') return false;
  record.pendingExecutionContractCandidateId = candidateId;
  record.pendingExecutionContractOrigin = origin;
  return true;
}

/** Activates only the selected candidate's checkpoint, or a clean baseline for neural exploration. */
function activatePreviewInspectorNeuralPageContextExecutionContract(descriptor, candidateId) {
  const record = readPreviewInspectorNeuralPageContextRecord(descriptor);
  if (
    record === undefined || record.pendingExecutionContractCandidateId !== candidateId ||
    typeof restorePreviewInspectorNeuralPageGenerationBaseline !== 'function'
  ) return false;
  const contract = record.executionContractByCandidateId.get(candidateId);
  const snapshot = contract?.snapshot ??
    (record.pendingExecutionContractOrigin === 'neural' ? record.coverageBaseline : undefined);
  record.pendingExecutionContractCandidateId = undefined;
  record.pendingExecutionContractOrigin = undefined;
  if (snapshot === undefined) return false;
  const activationKey = String(previewEntryRevision) + '\0' + record.key + '\0' + candidateId +
    '\0' + snapshot.fingerprint;
  if (previewInspectorSession.neuralPageContextExecutionContractKey === activationKey) return false;
  const restored = restorePreviewInspectorNeuralPageGenerationBaseline(snapshot);
  if (restored) previewInspectorSession.neuralPageContextExecutionContractKey = activationKey;
  return restored;
}

/** Defers activation until descriptor replacement has cleared obsolete reachability state. */
function schedulePreviewInspectorNeuralPageContextExecutionContractActivation(candidateId) {
  if (typeof candidateId !== 'string' || candidateId.length === 0) return false;
  previewInspectorSession.neuralPageContextExecutionContractSchedule =
    (Number(previewInspectorSession.neuralPageContextExecutionContractSchedule) || 0) + 1;
  const schedule = previewInspectorSession.neuralPageContextExecutionContractSchedule;
  Promise.resolve().then(() => {
    if (previewInspectorSession.neuralPageContextExecutionContractSchedule !== schedule) return;
    const descriptor = findSelectedPreviewInspectorDescriptor();
    if (!activatePreviewInspectorNeuralPageContextExecutionContract(descriptor, candidateId)) return;
    if (typeof notifyPreviewInspector === 'function') notifyPreviewInspector();
    if (typeof schedulePreviewInspectorCommitRefresh === 'function') {
      schedulePreviewInspectorCommitRefresh();
    }
    if (typeof schedulePreviewInspectorTreeRefresh === 'function') {
      schedulePreviewInspectorTreeRefresh();
    }
  });
  return true;
}
`;
}
