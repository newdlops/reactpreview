/**
 * Correlates inner Page Execution rebuilds with the host's shared page-selection transaction.
 * Preparation failures are bounded transport evidence, never neural render labels. The visible
 * artifact and queued human selection survive failed builds, lost replies, and stale callbacks.
 */

/** Generates execution admission, terminal handling and bounded full-page continuation helpers. */
export function createPreviewInspectorPageExecutionPreparationRuntimeSource(): string {
  return String.raw`
const PREVIEW_INSPECTOR_PAGE_EXECUTION_PREPARATION_FAILURE_LIMIT = 3;

/** Checks cheap ownership guards before touching the live target tree or starting another build. */
function ownsPreviewInspectorPageExecutionPreparation(pending) {
  return pending.revision === previewEntryRevision &&
    pending.controlRevision === previewInspectorSession.neuralHumanControlRevision &&
    pending.exportName === previewInspectorSession.selectedExportName &&
    pending.userCandidateId === previewInspectorSession.userSelectedPageCandidateId &&
    previewInspectorSession.queuedPageCandidateId === undefined &&
    previewInspectorSession.pendingRouteBranchId === undefined &&
    !(typeof isPreviewInspectorNeuralAssistancePaused === 'function' &&
      isPreviewInspectorNeuralAssistancePaused()) &&
    findSelectedPreviewInspectorDescriptor() === pending.descriptor;
}

/** Releases a failed transaction without turning an unrendered artifact into a failed training sample. */
function finishPreviewInspectorPageExecutionPreparation(reason, retryable = false) {
  const pending = previewInspectorSession.pendingPageExecutionPreparation;
  if (pending === undefined) return false;
  const owned = ownsPreviewInspectorPageExecutionPreparation(pending);
  clearPreviewInspectorPendingPageCandidateSelection();
  const record = pending.recovery?.record;
  if (record?.pendingExecutionCandidateId === pending.executionCandidateId) {
    record.pendingExecutionCandidateId = undefined;
    record.status = 'preparation-blocked';
    record.preparationBlockedRevision = pending.revision;
    pending.recovery.state.status = 'page-context-incomplete';
    if (retryable && owned) {
      record.preparationFailureCount = record.preparationFailureRevision === pending.revision
        ? (record.preparationFailureCount || 0) + 1 : 1;
      record.preparationFailureRevision = pending.revision;
      if (record.preparationFailureCount < PREVIEW_INSPECTOR_PAGE_EXECUTION_PREPARATION_FAILURE_LIMIT) {
        Promise.resolve().then(() => {
          if (!ownsPreviewInspectorPageExecutionPreparation(pending) ||
            previewInspectorSession.pendingPageCandidateId !== undefined ||
            readPreviewInspectorPageExecutionContextRecoveryRecord(pending.recovery.state) !== record ||
            record.status !== 'preparation-blocked') return;
          record.status = 'searching';
          previewInspectorSession.pageExecutionRetryRevision = undefined;
          requestPreviewInspectorNeuralPageExecutionContextRecovery(
            pending.descriptor, pending.candidate, pending.recovery.state, record.recipeSnapshot,
          );
        });
      }
    }
    if (owned && typeof setPreviewInspectorNeuralNeedsChoiceStatus === 'function') {
      setPreviewInspectorNeuralNeedsChoiceStatus('page-execution-preparation-' + reason);
    }
  }
  if (typeof recordPreviewInspectorRuntimeHealth === 'function') {
    recordPreviewInspectorRuntimeHealth({ category: 'page-context',
      event: 'page-execution-preparation-stopped', detail: {
        executionCandidateId: pending.executionCandidateId, pageCandidateId: pending.candidate.id,
        reason, retryable: retryable && owned,
      } });
  }
  notifyPreviewInspector();
  applyPreviewInspectorQueuedPageCandidateSelection();
  return true;
}

/** Retains one absolute settlement deadline; repeated progress cannot extend the wait forever. */
function schedulePreviewInspectorPageExecutionSettlement(pending) {
  pending.deadline ??= Date.now() + PREVIEW_INSPECTOR_PAGE_CANDIDATE_SETTLEMENT_TIMEOUT_MS;
  schedulePreviewInspectorPageCandidateSelectionTimeout(
    pending.candidate.id, Math.max(1, pending.deadline - Date.now()),
    'Page path preparation did not finish. Choose the path again.',
  );
}

/** Releases transport ownership only when the requested page and execution actually enter the descriptor. */
function reconcilePreviewInspectorPageExecutionPreparation(descriptor) {
  const pending = previewInspectorSession.pendingPageExecutionPreparation;
  if (pending === undefined ||
    descriptor?.inspector?.executablePageCandidateId !== pending.candidate.id ||
    descriptor?.inspector?.pageExecutionCandidateId !== pending.executionCandidateId ||
    previewInspectorSession.selectedExportName !== pending.exportName) return false;
  // React can install the descriptor before the host releases its build. Keep manual work queued.
  if (pending.committed !== true) return false;
  clearPreviewInspectorPendingPageCandidateSelection();
  // Keep the recovery recipe pending until the existing live-owner verifier activates it.
  Promise.resolve().then(() => applyPreviewInspectorQueuedPageCandidateSelection());
  if (typeof schedulePreviewInspectorCommitRefresh === 'function') schedulePreviewInspectorCommitRefresh();
  notifyPreviewInspector();
  return true;
}

/** Uses a correlated ready milestone only together with the exact live descriptor, never by itself. */
function handlePreviewInspectorPageExecutionPreparationProgress(message) {
  const pending = previewInspectorSession.pendingPageExecutionPreparation;
  if (pending === undefined) return false;
  if (message?.complete === true && message.stage === 'ready' &&
    Number.isSafeInteger(message.revision) &&
    message.revision === previewInspectorSession.pendingPageCandidateBuildRevision) {
    pending.committed = true;
    reconcilePreviewInspectorPageExecutionPreparation(findSelectedPreviewInspectorDescriptor());
  }
  return true;
}

/** Consumes only this execution interaction; host commit alone cannot prove page render success. */
function handlePreviewInspectorPageExecutionPreparationStatus(message) {
  const pending = previewInspectorSession.pendingPageExecutionPreparation;
  if (pending === undefined || message?.type !== 'react-preview-inspector-page-candidate-selection-status' ||
    message.candidateId !== pending.candidate.id || message.interactionId !== pending.interactionId) return false;
  const buildRevision = previewInspectorSession.pendingPageCandidateBuildRevision;
  if (buildRevision !== undefined && message.buildRevision !== buildRevision) return true;
  if (!['accepted', 'progress', 'committed', 'failed', 'cancelled', 'rejected'].includes(message.status)) return true;
  if (Number.isSafeInteger(message.buildRevision) && message.buildRevision >= 0) {
    previewInspectorSession.pendingPageCandidateBuildRevision = message.buildRevision;
  }
  if (['accepted', 'progress', 'committed'].includes(message.status)) {
    if (message.status === 'committed') pending.committed = true;
    if (message.status === 'committed' &&
      reconcilePreviewInspectorPageExecutionPreparation(findSelectedPreviewInspectorDescriptor())) return true;
    schedulePreviewInspectorPageExecutionSettlement(pending);
    return true;
  }
  finishPreviewInspectorPageExecutionPreparation(String(message.reason ?? message.status),
    message.status === 'failed' && message.reason === 'build-failed' ||
    message.status === 'rejected' && message.reason === 'selection-unavailable');
  return true;
}

/** Posts a compiler-admitted execution using the shared user-priority transaction and bounded timer. */
function postPreviewInspectorPageExecutionCandidate(descriptor, candidate, executionCandidateId, recovery) {
  if (typeof candidate?.id !== 'string' || typeof executionCandidateId !== 'string' ||
    previewInspectorSession.pageExecutionRetryRevision === previewEntryRevision ||
    previewInspectorSession.pendingPageCandidateId !== undefined ||
    previewInspectorSession.queuedPageCandidateId !== undefined ||
    previewInspectorSession.pendingRouteBranchId !== undefined ||
    typeof isPreviewInspectorNeuralAssistancePaused === 'function' && isPreviewInspectorNeuralAssistancePaused() ||
    typeof previewInspectorPostHostMessage !== 'function' ||
    descriptor?.inspector?.executablePageCandidateId !== candidate.id ||
    descriptor.inspector.pageExecutionCandidateId === executionCandidateId ||
    !Array.isArray(descriptor.inspector.pageExecutionCandidates) ||
    !descriptor.inspector.pageExecutionCandidates.some((item) => item?.id === executionCandidateId)
  ) return false;
  const interactionId = 'execution:' + String(readPreviewInspectorHostRuntimeRevision()) + ':' +
    String(++previewInspectorSession.interactionSequence);
  previewInspectorSession.pageExecutionRetryRevision = previewEntryRevision;
  previewInspectorSession.pendingPageExecutionPreparation = {
    candidate, executionCandidateId, interactionId, descriptor, recovery,
    revision: previewEntryRevision, controlRevision: previewInspectorSession.neuralHumanControlRevision,
    exportName: previewInspectorSession.selectedExportName,
    userCandidateId: previewInspectorSession.userSelectedPageCandidateId,
  };
  previewInspectorSession.pendingPageCandidateId = candidate.id;
  previewInspectorSession.pendingPageCandidateInteractionId = interactionId;
  previewInspectorSession.pendingPageCandidateOrigin = 'page-execution';
  previewInspectorSession.pendingPageCandidateRevision = previewEntryRevision;
  previewInspectorSession.pendingPageCandidateError = undefined;
  if (recovery !== undefined) {
    const { record, state, decision } = recovery;
    record.attemptedExecutionCandidateIds.add(executionCandidateId);
    if (decision !== undefined) record.decisionByExecutionCandidateId.set(executionCandidateId, decision);
    record.pendingExecutionCandidateId = executionCandidateId;
    record.status = 'applying';
    state.pageExecutionContextRecoveryRequested = true;
    state.status = 'recovering-page-context';
    if (typeof setPreviewInspectorNeuralLearningStatus === 'function') {
      setPreviewInspectorNeuralLearningStatus({ activeCount: 1,
        labelReason: 'component-output-found-restoring-full-page-context', phase: 'applying',
        successCount: 0, updates: typeof readPreviewInspectorNeuralLearningModelUpdates === 'function'
          ? readPreviewInspectorNeuralLearningModelUpdates() : 0 });
    }
  }
  schedulePreviewInspectorPageCandidateSelectionTimeout(candidate.id,
    PREVIEW_INSPECTOR_PAGE_CANDIDATE_ADMISSION_TIMEOUT_MS,
    'Page path request was not accepted. Choose the path again.');
  try {
    previewInspectorPostHostMessage({ candidateId: candidate.id, executionCandidateId, interactionId,
      runtimeRevision: readPreviewInspectorHostRuntimeRevision(),
      type: 'react-preview-inspector-page-execution-retry' });
  } catch {
    finishPreviewInspectorPageExecutionPreparation('message-undelivered');
    return false;
  }
  return true;
}
`;
}
