/** Generates the user-priority transaction used to apply one compiler-proven page path. */

/**
 * Keeps page-path selection responsive while the host compiles a previously requested path.
 * User input is retained as the next transaction instead of being discarded behind a disabled UI.
 */
export function createPreviewInspectorPageCandidateSelectionRuntimeSource(): string {
  return String.raw`
const PREVIEW_INSPECTOR_PAGE_CANDIDATE_ADMISSION_TIMEOUT_MS = 5 * 1000;
const PREVIEW_INSPECTOR_PAGE_CANDIDATE_SETTLEMENT_TIMEOUT_MS = 150 * 1000;

/** Clears one settled page-path transaction without discarding a later user choice. */
function clearPreviewInspectorPendingPageCandidateSelection() {
  if (previewInspectorSession.pendingPageCandidateTimeout !== undefined) {
    clearTimeout(previewInspectorSession.pendingPageCandidateTimeout);
  }
  previewInspectorSession.pendingPageCandidateId = undefined;
  previewInspectorSession.pendingPageCandidateBuildRevision = undefined;
  previewInspectorSession.pendingPageCandidateInteractionId = undefined;
  previewInspectorSession.pendingPageCandidateOrigin = undefined;
  previewInspectorSession.pendingPageCandidateRevision = undefined;
  previewInspectorSession.pendingPageCandidateTimeout = undefined;
}

/** Bounds a lost host hand-off so page choices cannot remain disabled forever. */
function schedulePreviewInspectorPageCandidateSelectionTimeout(candidateId, timeoutMs, message) {
  if (previewInspectorSession.pendingPageCandidateTimeout !== undefined) {
    clearTimeout(previewInspectorSession.pendingPageCandidateTimeout);
  }
  previewInspectorSession.pendingPageCandidateTimeout = setTimeout(() => {
    if (previewInspectorSession.pendingPageCandidateId !== candidateId) return;
    clearPreviewInspectorPendingPageCandidateSelection();
    previewInspectorSession.pendingPageCandidateError = { candidateId, message };
    notifyPreviewInspector();
    applyPreviewInspectorQueuedPageCandidateSelection();
  }, timeoutMs);
}

/** Applies the latest user choice after the in-flight compiler transaction releases the host. */
function applyPreviewInspectorQueuedPageCandidateSelection() {
  const candidateId = previewInspectorSession.queuedPageCandidateId;
  if (typeof candidateId !== 'string' || candidateId.length === 0) return false;
  previewInspectorSession.queuedPageCandidateId = undefined;
  return selectPreviewInspectorPageCandidate(candidateId, { origin: 'queued-user' });
}

/** Returns an explicit path choice to its authored page before compiling or mounting that path. */
function applyPreviewInspectorPageCandidateChoice(candidateId) {
  const leavingFileOverview =
    typeof readPreviewInspectorRenderScenario === 'function' &&
    readPreviewInspectorRenderScenario() === 'file-components';
  if (
    leavingFileOverview &&
    typeof setPreviewInspectorRenderScenario === 'function'
  ) {
    setPreviewInspectorRenderScenario('authored-page');
  }
  const selected = selectPreviewInspectorPageCandidate(candidateId, { origin: 'user' });
  return leavingFileOverview || selected;
}

/** Selects one authored caller path and gives explicit user input priority over automatic search. */
function selectPreviewInspectorPageCandidate(candidateId, options = {}) {
  if (typeof candidateId !== 'string' || candidateId.length === 0) return false;
  const descriptor = findSelectedPreviewInspectorDescriptor();
  if (!readPreviewInspectorPageCandidates(descriptor).some((candidate) => candidate?.id === candidateId)) {
    return false;
  }
  const neuralSelection = options?.origin === 'neural-page-context';
  const userSelection = !neuralSelection;
  const preferenceChanged = userSelection &&
    previewInspectorSession.userSelectedPageCandidateId !== candidateId;
  if (userSelection) {
    previewInspectorSession.userSelectedPageCandidateId = candidateId;
    if (typeof recordPreviewInspectorUserPageContextSelection === 'function') {
      recordPreviewInspectorUserPageContextSelection(candidateId);
    }
  }
  if (previewInspectorSession.pendingPageCandidateId !== undefined) {
    if (neuralSelection) return false;
    const pendingCandidateId = previewInspectorSession.pendingPageCandidateId;
    const queueChanged = pendingCandidateId === candidateId
      ? previewInspectorSession.queuedPageCandidateId !== undefined ||
        previewInspectorSession.pendingPageCandidateOrigin !== 'user'
      : previewInspectorSession.queuedPageCandidateId !== candidateId;
    previewInspectorSession.pendingPageCandidateOrigin = pendingCandidateId === candidateId
      ? 'user'
      : previewInspectorSession.pendingPageCandidateOrigin;
    previewInspectorSession.queuedPageCandidateId = pendingCandidateId === candidateId
      ? undefined
      : candidateId;
    if (previewInspectorSession.pendingPageCandidateTimeout === undefined) {
      schedulePreviewInspectorPageCandidateSelectionTimeout(
        pendingCandidateId,
        PREVIEW_INSPECTOR_PAGE_CANDIDATE_ADMISSION_TIMEOUT_MS,
        'Page path request was not accepted. Your queued choice is running next.',
      );
    }
    if (preferenceChanged || queueChanged) {
      persistPreviewInspectorState();
      notifyPreviewInspector();
    }
    return preferenceChanged || queueChanged;
  }
  previewInspectorSession.queuedPageCandidateId = undefined;
  previewInspectorSession.pendingPageCandidateError = undefined;
  const executableCandidateId = descriptor?.inspector?.executablePageCandidateId;
  if (typeof preparePreviewInspectorNeuralPageContextExecutionContract === 'function') {
    preparePreviewInspectorNeuralPageContextExecutionContract(
      descriptor,
      candidateId,
      neuralSelection ? 'neural' : 'user',
    );
  }
  if (candidateId !== executableCandidateId && typeof previewInspectorPostHostMessage === 'function') {
    previewInspectorSession.pendingPageCandidateId = candidateId;
    previewInspectorSession.pendingPageCandidateInteractionId =
      'page:' + String(readPreviewInspectorHostRuntimeRevision()) + ':' +
      String(++previewInspectorSession.interactionSequence);
    previewInspectorSession.pendingPageCandidateOrigin = neuralSelection
      ? 'neural-page-context'
      : 'user';
    previewInspectorSession.pendingPageCandidateRevision = previewEntryRevision;
    if (preferenceChanged) persistPreviewInspectorState();
    notifyPreviewInspector();
    schedulePreviewInspectorPageCandidateSelectionTimeout(
      candidateId,
      PREVIEW_INSPECTOR_PAGE_CANDIDATE_ADMISSION_TIMEOUT_MS,
      'Page path request was not accepted. Choose the path again.',
    );
    previewInspectorPostHostMessage({
      candidateId,
      interactionId: previewInspectorSession.pendingPageCandidateInteractionId,
      runtimeRevision: readPreviewInspectorHostRuntimeRevision(),
      type: 'react-preview-inspector-page-candidate-selected',
    });
    return true;
  }
  if (previewInspectorSession.selectedPageCandidateId === candidateId) {
    if (typeof activatePreviewInspectorNeuralPageContextExecutionContract === 'function') {
      activatePreviewInspectorNeuralPageContextExecutionContract(descriptor, candidateId);
    }
    if (preferenceChanged) persistPreviewInspectorState();
    return preferenceChanged;
  }
  resetPreviewInspectorTargetReachability();
  previewInspectorSession.selectedPageCandidateId = candidateId;
  if (typeof activatePreviewInspectorNeuralPageContextExecutionContract === 'function') {
    activatePreviewInspectorNeuralPageContextExecutionContract(descriptor, candidateId);
  }
  previewInspectorSession.selectedTreeNodeId = undefined;
  persistPreviewInspectorState();
  notifyPreviewInspector();
  schedulePreviewInspectorCommitRefresh();
  return true;
}

/** Uses a matching ready milestone when the terminal page-path status was lost in hot replacement. */
function handlePreviewInspectorPageCandidateProgress(message) {
  if (previewInspectorSession.pendingPageCandidateId === undefined) return false;
  if (
    Number.isSafeInteger(message?.revision) &&
    previewInspectorSession.pendingPageCandidateBuildRevision === undefined &&
    message.complete !== true
  ) {
    previewInspectorSession.pendingPageCandidateBuildRevision = message.revision;
    schedulePreviewInspectorPageCandidateSelectionTimeout(
      previewInspectorSession.pendingPageCandidateId,
      PREVIEW_INSPECTOR_PAGE_CANDIDATE_SETTLEMENT_TIMEOUT_MS,
      'Page path preparation did not finish. Choose the path again.',
    );
  }
  if (
    message?.complete === true && message.stage === 'ready' &&
    message.revision === previewInspectorSession.pendingPageCandidateBuildRevision
  ) {
    clearPreviewInspectorPendingPageCandidateSelection();
    previewInspectorSession.pendingPageCandidateError = undefined;
    notifyPreviewInspector();
    applyPreviewInspectorQueuedPageCandidateSelection();
  }
  return true;
}

/** Applies correlated host status and immediately advances a queued explicit user choice. */
function handlePreviewInspectorPageCandidateSelectionStatus(message) {
  if (message?.type !== 'react-preview-inspector-page-candidate-selection-status') return false;
  if (message.interactionId !== previewInspectorSession.pendingPageCandidateInteractionId) return true;
  if (typeof handlePreviewInspectorNeuralPageContextSelectionStatus === 'function') {
    handlePreviewInspectorNeuralPageContextSelectionStatus(message);
  }
  if (Number.isSafeInteger(message.buildRevision)) {
    previewInspectorSession.pendingPageCandidateBuildRevision = message.buildRevision;
  }
  if (message.status === 'accepted' || message.status === 'progress') {
    schedulePreviewInspectorPageCandidateSelectionTimeout(
      previewInspectorSession.pendingPageCandidateId,
      PREVIEW_INSPECTOR_PAGE_CANDIDATE_SETTLEMENT_TIMEOUT_MS,
      'Page path preparation did not finish. Choose the path again.',
    );
    notifyPreviewInspector();
    return true;
  }
  if (!['committed', 'failed', 'cancelled', 'rejected'].includes(message.status)) return true;
  const candidateId = previewInspectorSession.pendingPageCandidateId;
  clearPreviewInspectorPendingPageCandidateSelection();
  previewInspectorSession.pendingPageCandidateError = message.status === 'committed'
    ? undefined
    : {
        candidateId,
        message: message.reason === 'busy'
          ? 'Another page path was still applying. Your latest choice will run next.'
          : 'Page path could not be applied. Choose this path again or select another one.',
      };
  notifyPreviewInspector();
  applyPreviewInspectorQueuedPageCandidateSelection();
  return true;
}
`;
}
