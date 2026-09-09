/** Owns explicit, revision-local human control without deleting model evidence or viewer values. */
export function createPreviewInspectorNeuralControlRuntimeSource(): string {
  return String.raw`
/** Keeps automatic work paused across page changes until this target is explicitly resumed. */
function isPreviewInspectorNeuralAssistancePaused() {
  return previewInspectorSession.neuralAssistancePausedRevision === previewEntryRevision &&
    previewInspectorSession.neuralAssistancePausedExport === previewInspectorSession.selectedExportName;
}

/** Invalidates queued work before exposing manual choices; already committed values are retained. */
function pausePreviewInspectorNeuralAssistance() {
  previewInspectorSession.neuralHumanControlRevision =
    (Number(previewInspectorSession.neuralHumanControlRevision) || 0) + 1;
  previewInspectorSession.neuralAssistancePausedRevision = previewEntryRevision;
  previewInspectorSession.neuralAssistancePausedExport = previewInspectorSession.selectedExportName;
  previewInspectorSession.neuralAssistanceSequence =
    (Number(previewInspectorSession.neuralAssistanceSequence) || 0) + 1;
  previewInspectorSession.neuralPageContextScheduleRevision =
    (Number(previewInspectorSession.neuralPageContextScheduleRevision) || 0) + 1;
  previewInspectorSession.neuralPageExecutionContextActivationRevision =
    (Number(previewInspectorSession.neuralPageExecutionContextActivationRevision) || 0) + 1;
  previewInspectorSession.neuralPageContextExecutionContractSchedule =
    (Number(previewInspectorSession.neuralPageContextExecutionContractSchedule) || 0) + 1;
  previewInspectorSession.neuralAssistancePending = false;
  previewInspectorSession.neuralPageGenerationPending = false;
  previewInspectorSession.neuralSuccessfulPathRestorationKey = undefined;
  for (const [key, record] of previewInspectorSession.automaticNeuralAssistanceByKey?.entries?.() ?? []) {
    if (!key.startsWith(String(previewEntryRevision) + ':') ||
        !key.endsWith(':' + previewInspectorSession.selectedExportName)) continue;
    record.scheduled = false;
    record.rendererWorkSlicePaused = true;
    record.neuralHumanPaused = true;
    record.restoringSuccessfulPath = false;
    record.restorationVerificationScheduled = false;
    record.restoringSuccessfulPathFingerprint = undefined;
    if (typeof clearPreviewInspectorNeuralProvisionalSuccess === 'function') {
      clearPreviewInspectorNeuralProvisionalSuccess(record);
    }
    if (typeof clearPreviewInspectorNeuralSuccessRegression === 'function') {
      clearPreviewInspectorNeuralSuccessRegression(record);
    }
  }
  if (typeof cancelPreviewInspectorNeuralChoicePathSelection === 'function') {
    cancelPreviewInspectorNeuralChoicePathSelection('automatic');
  }
  if (typeof setPreviewInspectorNeuralLearningStatus === 'function') {
    setPreviewInspectorNeuralLearningStatus({
      activeCount: 0,
      labelReason: 'user-paused',
      phase: 'yielded',
      updates: typeof readPreviewInspectorNeuralLearningModelUpdates === 'function'
        ? readPreviewInspectorNeuralLearningModelUpdates() : 0,
    });
  }
  if (typeof notifyPreviewInspector === 'function') notifyPreviewInspector();
  return true;
}

/** Restarts only on an explicit action, preserving failure budgets and all learned outcomes. */
function resumePreviewInspectorNeuralAssistance() {
  previewInspectorSession.neuralAssistancePausedRevision = undefined;
  previewInspectorSession.neuralAssistancePausedExport = undefined;
  for (const [key, record] of previewInspectorSession.automaticNeuralAssistanceByKey?.entries?.() ?? []) {
    if (record.neuralHumanPaused !== true || !key.startsWith(String(previewEntryRevision) + ':') ||
        !key.endsWith(':' + previewInspectorSession.selectedExportName)) continue;
    record.neuralHumanPaused = false;
    resetPreviewInspectorNeuralRendererWorkSlice(record);
  }
  return requestPreviewInspectorNeuralAssistance();
}
`;
}
