/**
 * Separates host preparation failures from neural render outcomes.
 * A failed build stays unavailable to automatic search only while the displayed source revision
 * remains current. No training label, persisted preference, project mutation, or success is inferred.
 */

/** Creates revision-scoped admission and a guarded continuation after a failed host transaction. */
export function createPreviewInspectorNeuralPagePreparationRuntimeSource(): string {
  return String.raw`
const PREVIEW_INSPECTOR_NEURAL_PAGE_PREPARATION_FAILURE_LIMIT = 3;

/** Selector-only compatibility callers have no host revision and must not retain preparation bans. */
function readPreviewInspectorNeuralPagePreparationRevision() {
  return typeof previewEntryRevision === 'number' &&
    Number.isSafeInteger(previewEntryRevision) && previewEntryRevision >= 0
    ? previewEntryRevision : undefined;
}

/** Keeps preparation failures local to the retained artifact, never to future source revisions. */
function isPreviewInspectorNeuralPagePreparationAvailable(record, candidateId) {
  const revision = readPreviewInspectorNeuralPagePreparationRevision();
  if (revision === undefined) return true;
  if (record.preparationFailureRevision !== revision) {
    record.preparationFailureRevision = revision;
    record.preparationFailedCandidateIds = new Set();
  }
  return record.preparationFailedCandidateIds.size < PREVIEW_INSPECTOR_NEURAL_PAGE_PREPARATION_FAILURE_LIMIT &&
    record.preparationFailedCandidateIds.has(candidateId) !== true;
}

/** Advances once after the correlated host request releases ownership; user work always wins. */
function schedulePreviewInspectorNeuralPagePreparationContinuation(descriptor, record) {
  const revision = readPreviewInspectorNeuralPagePreparationRevision();
  if (revision === undefined) return;
  const controlRevision = previewInspectorSession.neuralHumanControlRevision;
  const exportName = previewInspectorSession.selectedExportName;
  Promise.resolve().then(() => {
    if (
      readPreviewInspectorNeuralPagePreparationRevision() !== revision ||
      previewInspectorSession.neuralHumanControlRevision !== controlRevision ||
      previewInspectorSession.selectedExportName !== exportName ||
      previewInspectorSession.pendingPageCandidateId !== undefined ||
      previewInspectorSession.queuedPageCandidateId !== undefined ||
      typeof previewInspectorSession.userSelectedPageCandidateId === 'string' &&
        previewInspectorSession.userSelectedPageCandidateId.length > 0 ||
      typeof isPreviewInspectorNeuralAssistancePaused === 'function' &&
        isPreviewInspectorNeuralAssistancePaused() ||
      findSelectedPreviewInspectorDescriptor() !== descriptor
    ) return;
    if (readPreviewInspectorNeuralPageContextRecord(descriptor) !== record) return;
    const next = selectPreviewInspectorNeuralPageContextCandidate(descriptor, {
      exploreUnevaluated: true,
    });
    if (
      typeof next?.candidate?.id !== 'string' || next.origin === 'user' ||
      next.candidate.id === descriptor?.inspector?.executablePageCandidateId
    ) return;
    record.status = 'switching';
    record.selectionReason = 'trying-next-preparable-candidate';
    selectPreviewInspectorPageCandidate(next.candidate.id, { origin: 'neural-page-context' });
  });
}

/** Records only correlated deterministic preparation failures, without changing render evidence. */
function handlePreviewInspectorNeuralPageContextSelectionStatus(message) {
  if (previewInspectorSession.pendingPageCandidateOrigin !== 'neural-page-context') return;
  const descriptor = findSelectedPreviewInspectorDescriptor();
  const record = readPreviewInspectorNeuralPageContextRecord(descriptor);
  if (record === undefined) return;
  if (message?.status === 'committed') {
    record.status = 'verifying';
    record.selectionReason = 'candidate-artifact-committed';
  } else if (['failed', 'cancelled', 'rejected'].includes(message?.status)) {
    record.status = 'selection-error';
    record.selectionReason = 'candidate-artifact-' + String(message.status);
  }
  const candidateId = previewInspectorSession.pendingPageCandidateId;
  const revision = readPreviewInspectorNeuralPagePreparationRevision();
  if (
    typeof candidateId !== 'string' || message?.candidateId !== candidateId ||
    message.interactionId !== previewInspectorSession.pendingPageCandidateInteractionId ||
    revision === undefined || previewInspectorSession.pendingPageCandidateRevision !== revision ||
    !(
      message.status === 'failed' && message.reason === 'build-failed' ||
      message.status === 'rejected' && message.reason === 'selection-unavailable'
    ) ||
    !readPreviewInspectorPageCandidates(descriptor).some((candidate) => candidate?.id === candidateId)
  ) return;
  isPreviewInspectorNeuralPagePreparationAvailable(record, candidateId);
  record.preparationFailedCandidateIds.add(candidateId);
  // Failed builds are not evaluated renders. Keep all verifier-owned sets and model weights intact.
  schedulePreviewInspectorNeuralPagePreparationContinuation(descriptor, record);
}
`;
}
