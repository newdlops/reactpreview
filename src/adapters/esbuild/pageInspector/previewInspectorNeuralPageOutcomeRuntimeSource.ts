/** Guards page-choice training with current execution ownership and independently verified output. */

/** Emits bounded admission checks; unavailable evidence never teaches success or terminal failure. */
export function createPreviewInspectorNeuralPageOutcomeRuntimeSource(): string {
  return String.raw`
/** Rejects old page/target callbacks before touching learning records or walking project Fibers. */
function isPreviewInspectorNeuralPageOutcomeCurrent(descriptor, candidate, state) {
  if (
    descriptor === undefined || candidate === undefined || state === null ||
    typeof state !== 'object' || state.directTarget === true ||
    typeof candidate?.id !== 'string' || candidate.id.length === 0 ||
    typeof isPreviewInspectorNeuralAssistancePaused === 'function' &&
      isPreviewInspectorNeuralAssistancePaused() ||
    typeof findSelectedPreviewInspectorDescriptor === 'function' &&
      findSelectedPreviewInspectorDescriptor() !== descriptor
  ) return false;
  const selectedId = previewInspectorSession.selectedPageCandidateId;
  const executableId = descriptor?.inspector?.executablePageCandidateId;
  const target = candidate?.target ?? descriptor?.inspector?.target;
  const selectedExport = previewInspectorSession.selectedExportName;
  const activeKey = previewInspectorSession.activeTargetReachabilityKey;
  const states = previewInspectorSession.targetReachabilityByKey;
  const entryRevision = typeof previewEntryRevision === 'number' ? previewEntryRevision : undefined;
  const activeRevision = typeof previewHotRuntime === 'object'
    ? previewHotRuntime?.activeReloadRevision : undefined;
  return !(
    typeof selectedId === 'string' && selectedId.length > 0 && selectedId !== candidate.id ||
    typeof executableId === 'string' && executableId.length > 0 && executableId !== candidate.id ||
    typeof state.candidateId === 'string' && state.candidateId !== candidate.id ||
    typeof target?.exportName === 'string' && (
      typeof state.targetExportName === 'string' && state.targetExportName !== target.exportName ||
      typeof selectedExport === 'string' && selectedExport.length > 0 &&
        !selectedExport.startsWith('@root:') && selectedExport !== target.exportName
    ) ||
    typeof target?.sourcePath === 'string' && typeof state.targetSourcePath === 'string' &&
      target.sourcePath.replaceAll('\\', '/') !== state.targetSourcePath.replaceAll('\\', '/') ||
    typeof activeKey === 'string' && state.key !== activeKey ||
    typeof state.key === 'string' && states instanceof Map && states.get(state.key) !== state ||
    Number.isSafeInteger(state.entryRevision) && state.entryRevision !== entryRevision ||
    Number.isSafeInteger(activeRevision) && activeRevision >= 0 && activeRevision !== entryRevision
  );
}

/**
 * Separates an in-progress repair from a verifier-confirmed regression. A stale success flag cannot
 * override active blockers, a missing authored page, or a detached target. Evidence readers failing
 * here leave the result unlabelled; they do not hide the project's exception or consume its retries.
 */
function readPreviewInspectorNeuralPageOutcome(state) {
  const terminalFailure = state.neuralStableOutputRegressed === true ||
    state.status === 'page-blocked' && state.exhausted === true;
  const verifiedOutput = state.neuralStableOutputVerified === true &&
    state.neuralStableOutputRegressed !== true;
  if (!verifiedOutput && !terminalFailure) return undefined;
  if (state.neuralPageContextOutcome === (terminalFailure ? 'failed' : 'verified')) return undefined;
  try {
    // Use the unsuppressed registry when present: an unavailable verifier is not an empty registry.
    const readBlockers = typeof readPreviewInspectorActiveBlockerSummary === 'function'
      ? readPreviewInspectorActiveBlockerSummary
      : typeof readPreviewInspectorNeuralAssistanceBlockers === 'function'
        ? readPreviewInspectorNeuralAssistanceBlockers : undefined;
    const blockers = readBlockers?.();
    if (readBlockers !== undefined && !(
      Array.isArray(blockers?.active) || Number.isFinite(blockers?.count) && blockers.count >= 0
    )) return undefined;
    const blocked = blockers?.count > 0 || blockers?.active?.length > 0;
    const failedState = Boolean(state.targetOutputError) ||
      state.pendingTargetRepairFailure !== undefined || state.targetOutputRecoveryPending === true ||
      ['page-blocked', 'target-error', 'runtime-error-output', 'resolver-cycle-detected',
        'resolver-limit-reached', 'resolver-rolled-back', 'retrying-page-execution'].includes(state.status);
    const outputEligible = !blocked && !failedState &&
      state.pageRootCommitted === true && state.targetHasOutput === true &&
      (state.targetMounted === true || state.targetWasMounted === true);
    if (!terminalFailure && !outputEligible) return undefined;
    const pageExecutionContextComplete =
      typeof hasPreviewInspectorCompletePageExecutionContext !== 'function' ||
      hasPreviewInspectorCompletePageExecutionContext(state) === true;
    const completeOutput = outputEligible && pageExecutionContextComplete && (
      typeof hasPreviewInspectorTargetHostOutput !== 'function' ||
      hasPreviewInspectorTargetHostOutput(state) === true
    );
    const success = verifiedOutput && !terminalFailure && completeOutput;
    if (!success && !(terminalFailure && !completeOutput)) return undefined;
    return { pageExecutionContextComplete, success };
  } catch {
    return undefined;
  }
}
`;
}
