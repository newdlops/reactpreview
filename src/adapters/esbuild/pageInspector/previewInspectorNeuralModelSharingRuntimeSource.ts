/** Generates browser-side synchronization for the bounded profile-local neural residual model. */

/** Creates model merge, publish, and host-snapshot handlers composed after neural inference. */
export function createPreviewInspectorNeuralModelSharingRuntimeSource(): string {
  return String.raw`
/** Combines independently retained families and outcome counters without inventing training labels. */
function mergePreviewInspectorNeuralResidualModels(currentValue, incomingValue) {
  const current = normalizePreviewInspectorNeuralResidualModel(currentValue);
  const incoming = normalizePreviewInspectorNeuralResidualModel(incomingValue);
  const heads = {};
  for (const headKey of PREVIEW_INSPECTOR_NEURAL_RESIDUAL_HEAD_KEYS) {
    const currentHead = current.heads[headKey];
    const incomingHead = incoming.heads[headKey];
    const selected = currentHead === undefined
      ? incomingHead
      : incomingHead === undefined
        ? currentHead
        : incomingHead.updates >= currentHead.updates
          ? incomingHead.updates > currentHead.updates ||
              incomingHead.evidence > currentHead.evidence
            ? incomingHead
            : currentHead
          : currentHead;
    if (selected !== undefined) heads[headKey] = selected;
  }
  const candidateOutcomes = { ...current.candidateOutcomes };
  for (const [key, incomingOutcome] of Object.entries(incoming.candidateOutcomes)) {
    const currentOutcome = candidateOutcomes[key];
    if (
      currentOutcome === undefined ||
      incomingOutcome.attempts > currentOutcome.attempts ||
      incomingOutcome.attempts === currentOutcome.attempts &&
        (incomingOutcome.evidence > currentOutcome.evidence ||
          incomingOutcome.evidence === currentOutcome.evidence &&
            incomingOutcome.sequence >= currentOutcome.sequence)
    ) candidateOutcomes[key] = incomingOutcome;
  }
  const retainedOutcomes = retainPreviewInspectorNeuralResidualOutcomes(
    Object.entries(candidateOutcomes),
  );
  return normalizePreviewInspectorNeuralResidualModel({
    candidateOutcomes: Object.fromEntries(retainedOutcomes),
    heads,
    outcomeSequence: Math.max(current.outcomeSequence, incoming.outcomeSequence),
    version: PREVIEW_INSPECTOR_NEURAL_RESIDUAL_VERSION,
  });
}

/** Publishes the bounded learned state to the extension host for profile-local panel sharing. */
function publishPreviewInspectorNeuralResidualModel() {
  if (
    typeof previewInspectorPostHostMessage !== 'function' ||
    typeof previewEntryRevision !== 'number'
  ) return;
  try {
    const delivery = previewInspectorPostHostMessage({
      model: serializePreviewInspectorNeuralResidualModel(),
      runtimeRevision: previewEntryRevision,
      type: 'react-preview-neural-model-sync',
    });
    if (delivery?.catch !== undefined) delivery.catch(() => undefined);
  } catch {
    // Local webview persistence remains authoritative when the extension host is unavailable.
  }
}

/** Applies one host snapshot while retaining any newer family learned by this live panel. */
function handlePreviewInspectorNeuralResidualHostMessage(value) {
  if (
    value?.type !== 'react-preview-neural-model-snapshot' ||
    value.runtimeRevision !== previewEntryRevision
  ) return false;
  const previous = serializePreviewInspectorNeuralResidualModel();
  const merged = mergePreviewInspectorNeuralResidualModels(previous, value.model);
  if (JSON.stringify(previous) === JSON.stringify(merged)) return true;
  previewInspectorSession.neuralResidualModel = merged;
  if (typeof persistPreviewInspectorState === 'function') persistPreviewInspectorState();
  /* Shared weights affect the next admitted decision; they never require a full Inspector render. */
  return true;
}
`;
}
