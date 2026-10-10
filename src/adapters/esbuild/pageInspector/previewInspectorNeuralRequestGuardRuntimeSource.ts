/** Generates transient ownership and evidence checks for queued neural recovery requests. */

/** Prevents a preparatory remount from redirecting an old strategy into a new page or error. */
export function createPreviewInspectorNeuralRequestGuardRuntimeSource(): string {
  return String.raw`
const previewInspectorReleasedNeuralChoices = new WeakSet();

/** Captures only current request ownership, never mutable project props or model state. */
function capturePreviewInspectorNeuralAssistanceScope() {
  return {
    controlRevision: previewInspectorSession.neuralHumanControlRevision,
    exportName: previewInspectorSession.selectedExportName,
    pageCandidateId: previewInspectorSession.selectedPageCandidateId,
    targetKey: previewInspectorSession.activeTargetReachabilityKey,
  };
}

/** Restores an unexecuted finite slot, but never refunds the hard work/attempt budget. */
function releasePreviewInspectorNeuralFiniteChoiceReservation(exploration, sweepKey) {
  const signature = exploration?.choiceAttemptSignature ?? exploration?.choiceSignature;
  const ordinal = exploration?.choiceOrdinal;
  if (typeof signature !== 'string' || !Number.isSafeInteger(ordinal) || ordinal < 1 ||
      previewInspectorReleasedNeuralChoices.has(exploration)) return;
  const attempts = previewInspectorSession.automaticNeuralAssistanceByKey?.get?.(
    sweepKey)?.finiteChoiceAttemptsBySignature;
  // A later reservation must not be overwritten by an obsolete callback or repeated release.
  if (attempts?.get?.(signature) === ordinal) {
    attempts.set(signature, ordinal - 1);
    previewInspectorReleasedNeuralChoices.add(exploration);
  }
}

/** Clears only this obsolete request's pending flags; newer requests keep their ownership. */
function isPreviewInspectorNeuralAssistanceRequestCurrent(sequence) {
  if (previewInspectorSession.neuralAssistanceSequence !== sequence) return false;
  const scope = previewInspectorSession.neuralAssistanceScope;
  const current = previewInspectorSession.neuralAssistanceRevision === previewEntryRevision &&
    !isPreviewInspectorNeuralAssistancePaused() &&
    scope?.controlRevision === previewInspectorSession.neuralHumanControlRevision &&
    scope?.exportName === previewInspectorSession.selectedExportName &&
    scope?.pageCandidateId === previewInspectorSession.selectedPageCandidateId &&
    scope?.targetKey === previewInspectorSession.activeTargetReachabilityKey;
  if (!current) {
    previewInspectorSession.neuralAssistancePending = false;
    previewInspectorSession.neuralPageGenerationPending = false;
  }
  return current;
}

/** Admits only the planned evidence; a changed hole returns to the bounded next sweep. */
function isPreviewInspectorNeuralAssistancePlanCurrent(node, exploration) {
  // Page-generation plans perform their own exact state/signature check at their apply boundary.
  if (exploration?.pageGenerationChoice === true) return true;
  if (typeof exploration?.attemptIdentity === 'string' &&
      createPreviewInspectorNeuralAssistanceAttemptIdentity(node) !== exploration.attemptIdentity) {
    return false;
  }
  if (node === undefined) return exploration === undefined;
  // The request already reserved its budget. Re-reading UI availability here would incorrectly
  // cancel the last permitted attempt as "exhausted". Check explicit ownership instead.
  const condition = node.condition ?? (node.blockerKind === 'render-condition' ? node.blocker : undefined);
  if (condition !== undefined && (
    condition.requiresAuthoredState === true || typeof condition.override === 'boolean' ||
    previewInspectorSession.renderConditionRejectedAutoOverridesByKey?.get?.(
      condition.reachabilityKey)?.has?.(condition.id) === true
  )) return false;
  if (node.blockerKind === 'runtime-fallback' && (
    previewInspectorSession.runtimeFallbackOverrides?.has?.(node.blocker?.id) === true ||
    String(node.blocker?.mode ?? '').toLowerCase().includes('manual')
  )) return false;
  if (node.blockerKind === 'data-request' && ['custom', 'smart-custom'].includes(String(
    previewInspectorSession.dataPayloadOverrides?.get?.(node.blocker?.id)?.mode ?? node.blocker?.mode ?? '',
  ))) return false;
  if (node.blockerKind === 'target-reachability' && node.blocker?.status === 'awaiting-authored-state') {
    return false;
  }
  if (typeof exploration?.choiceSignature === 'string') {
    return readPreviewInspectorNeuralFiniteChoiceDomain(node)?.signature === exploration.choiceSignature;
  }
  return true;
}
/**
 * The automatic request reads blockers at its start (while reachability still probes) and again
 * one and two frames later. When the target is reached in between, its own UI-state branches
 * ('tab === "members"') leave the list by timing alone and the request applied nothing in some
 * runs. Those branches are kept from the start-time list, so every run opens the same one.
 */
function keepPreviewInspectorReachedTargetUiStateBlockers(summary, initial) {
  const state = readPreviewInspectorNeuralAssistanceReachability();
  if (
    state?.status !== 'reached' || state.targetHasOutput !== true ||
    !Array.isArray(summary?.active) || !Array.isArray(initial?.active)
  ) {
    return summary;
  }
  const present = new Set(summary.active.map(readPreviewInspectorNeuralAssistanceBlockerIdentity));
  const kept = initial.active.filter((node) => {
    const condition = node?.blockerKind === 'render-condition' ? node.condition : undefined;
    const record = previewInspectorSession.renderConditions?.get?.(condition?.id);
    return condition?.stateBound === true && record?.effectiveEnabled === condition.effectiveEnabled &&
      !present.has(readPreviewInspectorNeuralAssistanceBlockerIdentity(node)) &&
      !previewInspectorSession.renderConditionAutoOverrides?.has?.(condition.id) &&
      !previewInspectorSession.renderConditionOverrides?.has?.(condition.id) &&
      typeof readPreviewInspectorScalarCoherentOverride === 'function' &&
      readPreviewInspectorScalarCoherentOverride(record) === undefined &&
      typeof matchesPreviewInspectorConditionDefinitionPath === 'function' &&
      matchesPreviewInspectorConditionDefinitionPath(condition.sourcePath, state.targetSourcePath);
  });
  return kept.length === 0
    ? summary
    : { ...summary, active: [...summary.active, ...kept], count: summary.count + kept.length };
}
`;
}
