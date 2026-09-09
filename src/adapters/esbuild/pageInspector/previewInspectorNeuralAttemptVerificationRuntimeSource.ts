/** Generates scope-bound render verification before neural candidates receive training credit. */

/** Creates bounded attempt assessment, delayed verification, and late-error correction source. */
export function createPreviewInspectorNeuralAttemptVerificationRuntimeSource(): string {
  return String.raw`
const PREVIEW_INSPECTOR_NEURAL_RESIDUAL_VERIFY_INTERVAL_MS = 160;
const PREVIEW_INSPECTOR_NEURAL_RESIDUAL_VERIFY_LIMIT_MS = 960;
const PREVIEW_INSPECTOR_NEURAL_RESIDUAL_SUCCESS_OBSERVATIONS = 3;

/** Rechecks target-owned output; a cached reached status alone is never render evidence. */
function hasPreviewInspectorNeuralResidualTargetOutput(state) {
  if (
    state?.targetHasOutput !== true || state?.pageRootCommitted === false ||
    state?.targetWasMounted === false
  ) return false;
  try {
    const blockers = typeof readPreviewInspectorNeuralAssistanceBlockers === 'function'
      ? readPreviewInspectorNeuralAssistanceBlockers()
      : typeof readPreviewInspectorActiveBlockerSummary === 'function'
        ? readPreviewInspectorActiveBlockerSummary() : undefined;
    if (blockers?.count > 0 || blockers?.active?.length > 0) return false;
    return typeof hasPreviewInspectorTargetHostOutput === 'function'
      ? hasPreviewInspectorTargetHostOutput(state) === true
      : true;
  } catch { return false; }
}

/** Captures only transient ownership identities; no page state is added to persisted weights. */
function createPreviewInspectorNeuralResidualObservationScope(attempt) {
  return {
    controlRevision: previewInspectorSession.neuralHumanControlRevision,
    entryRevision: typeof previewEntryRevision === 'number' ? previewEntryRevision : undefined,
    exportName: previewInspectorSession.selectedExportName,
    pageCandidateId: previewInspectorSession.selectedPageCandidateId,
    targetState: previewInspectorSession.targetReachabilityByKey?.get?.(attempt.targetReachabilityKey),
  };
}

/** Drops delayed credit when another page, target, attempt, source, or user action took ownership. */
function isPreviewInspectorNeuralResidualObservationCurrent(attempt, scope) {
  const activeAttempt = previewInspectorSession.blockerTraceActiveAttempt;
  const activeKey = previewInspectorSession.activeTargetReachabilityKey;
  const activeReloadRevision = typeof previewHotRuntime === 'object'
    ? previewHotRuntime?.activeReloadRevision : undefined;
  const currentState = previewInspectorSession.targetReachabilityByKey?.get?.(attempt.targetReachabilityKey);
  if (
    attempt.neuralResidualRejected === true ||
    previewInspectorSession.neuralHumanControlRevision !== scope.controlRevision ||
    (typeof previewEntryRevision === 'number' ? previewEntryRevision : undefined) !== scope.entryRevision ||
    Number.isSafeInteger(activeReloadRevision) && activeReloadRevision >= 0 &&
      activeReloadRevision !== scope.entryRevision ||
    previewInspectorSession.selectedExportName !== scope.exportName ||
    previewInspectorSession.selectedPageCandidateId !== scope.pageCandidateId ||
    typeof attempt.targetReachabilityKey === 'string' && typeof activeKey === 'string' &&
      activeKey !== attempt.targetReachabilityKey ||
    scope.targetState !== undefined && currentState !== scope.targetState ||
    typeof activeAttempt?.traceId === 'string' && typeof attempt.traceId === 'string' &&
      activeAttempt.traceId !== attempt.traceId
  ) return false;
  if (scope.targetState === undefined) scope.targetState = currentState;
  return true;
}

/** Copies the verifier arrays retained while final target reachability is still converging. */
function copyPreviewInspectorNeuralResidualAttemptResult(result) {
  if (result === null || typeof result !== 'object') return undefined;
  const copyIds = (value) => (Array.isArray(value) ? value : [])
    .filter((id) => typeof id === 'string').slice(0, 256);
  return {
    changedBlockerIds: copyIds(result.changedBlockerIds),
    discoveredBlockerIds: copyIds(result.discoveredBlockerIds),
    outcome: result.outcome,
    remainingBlockerIds: copyIds(result.remainingBlockerIds),
    resolvedBlockerIds: copyIds(result.resolvedBlockerIds),
  };
}

/** Produces a goal-aligned assessment instead of treating one removed intermediate blocker as success. */
function assessPreviewInspectorNeuralResidualAttempt(attempt, result, deadlineReached = false) {
  if (result?.outcome === 'superseded') return undefined;
  if (result?.outcome === 'rolled-back') {
    return { confidence: 1, label: 0, pending: false, reason: 'attempt-rolled-back' };
  }
  const state = typeof attempt?.targetReachabilityKey === 'string'
    ? previewInspectorSession.targetReachabilityByKey?.get?.(attempt.targetReachabilityKey)
    : undefined;
  const remainingBlockerIds = Array.isArray(result?.remainingBlockerIds)
    ? result.remainingBlockerIds
    : [];
  const resolvedBlockerIds = Array.isArray(result?.resolvedBlockerIds)
    ? result.resolvedBlockerIds
    : [];
  const revealedCount = [result?.changedBlockerIds, result?.discoveredBlockerIds]
    .reduce((count, ids) => count + (Array.isArray(ids) ? ids.length : 0), 0);
  const targetOutput = hasPreviewInspectorNeuralResidualTargetOutput(state);
  const ownsTarget = typeof attempt?.targetReachabilityKey === 'string';
  const selectedBlockerId = attempt?.blocker?.id;
  const selectedBlockerResolved = typeof selectedBlockerId === 'string' &&
    resolvedBlockerIds.includes(selectedBlockerId);
  const localProgress = selectedBlockerResolved || resolvedBlockerIds.length > 0;
  const remainingTarget = remainingBlockerIds.some((id) =>
    typeof id === 'string' && id.startsWith('target-reachability:'),
  );
  const remainingFatal = remainingBlockerIds.some((id) =>
    typeof id === 'string' &&
    (id.startsWith('target-error:') || id.startsWith('runtime-global:')),
  );
  const failedStatuses = new Set([
    'page-blocked',
    'resolver-cycle-detected',
    'resolver-limit-reached',
    'resolver-rolled-back',
    'retrying-page-execution',
    'runtime-error-output',
    'target-error',
  ]);
  const failedTarget = remainingFatal || failedStatuses.has(state?.status) ||
    state?.pendingTargetRepairFailure !== undefined;
  if (failedTarget) {
    return {
      confidence: 1,
      label: 0,
      localProgress,
      pending: false,
      reason: remainingFatal ? 'fatal-blocker-remains' : 'target-failed',
      remainingBlockerCount: remainingBlockerIds.length,
      targetOutput: false,
    };
  }
  const dataFlowSignal = attempt?.neuralDataFlowSignal;
  const dataFlowCallCount = Number(dataFlowSignal?.calls ?? 0);
  if (dataFlowSignal !== undefined) {
    // An unused predicate or an unowned target provides no causal data-flow training example.
    if (!ownsTarget || !Number.isSafeInteger(dataFlowCallCount) || dataFlowCallCount < 0) return undefined;
    if (dataFlowCallCount === 0) {
      return deadlineReached ? undefined : {
        localProgress: false,
        pending: true,
        reason: 'generated-data-flow-awaiting-calls',
        targetOutput: false,
      };
    }
  }
  if (Number.isSafeInteger(dataFlowCallCount) && dataFlowCallCount > 0) {
    const truthyReturnCount = Math.max(
      0,
      Math.min(dataFlowCallCount, Number(dataFlowSignal?.truthyReturns ?? 0)),
    );
    const retentionRatio = truthyReturnCount / dataFlowCallCount;
    if (!targetOutput && retentionRatio > 0 && !deadlineReached) {
      return {
        localProgress: true,
        pending: true,
        reason: 'generated-data-flow-awaiting-target-output',
        remainingBlockerCount: remainingBlockerIds.length,
        targetOutput: false,
      };
    }
    return {
      confidence: !targetOutput && retentionRatio > 0
        ? 0.2 : Math.min(1, 0.4 + dataFlowCallCount * 0.2),
      label: targetOutput ? retentionRatio : retentionRatio * 0.2,
      localProgress: retentionRatio > 0,
      pending: false,
      reason: retentionRatio > 0
        ? targetOutput
          ? 'generated-data-flow-and-target-output-verified'
          : 'generated-data-flow-retained-without-target-output'
        : 'generated-data-flow-dropped',
      remainingBlockerCount: remainingBlockerIds.length,
      targetOutput,
    };
  }
  if (targetOutput) {
    return {
      confidence: 1,
      label: 1,
      localProgress,
      pending: false,
      reason: 'target-output-verified',
      remainingBlockerCount: remainingBlockerIds.length,
      targetOutput: true,
    };
  }
  if (ownsTarget && !deadlineReached) {
    return {
      localProgress,
      pending: true,
      reason: remainingTarget ? 'target-still-converging' : 'awaiting-target-verifier',
      remainingBlockerCount: remainingBlockerIds.length,
      targetOutput: false,
    };
  }
  if (ownsTarget) {
    return {
      confidence: 0.2,
      label: localProgress ? 0.2 : revealedCount > 0 ? 0.05 : 0,
      localProgress,
      pending: false,
      reason: localProgress
        ? 'local-progress-without-target-output'
        : revealedCount > 0
          ? 'new-evidence-without-target-output'
          : 'no-target-progress',
      remainingBlockerCount: remainingBlockerIds.length,
      targetOutput: false,
    };
  }
  return {
    confidence: localProgress ? 0.75 : revealedCount > 0 ? 0.4 : 0.65,
    label: localProgress ? 0.65 : revealedCount > 0 ? 0.35 : 0,
    localProgress,
    pending: false,
    reason: localProgress
      ? 'standalone-blocker-resolved'
      : revealedCount > 0
        ? 'standalone-evidence-revealed'
        : 'standalone-no-progress',
    remainingBlockerCount: remainingBlockerIds.length,
  };
}

/** Applies one verifier-owned assessment and emits diagnostics without feature vectors or values. */
function applyPreviewInspectorNeuralResidualAttemptAssessment(attempt, assessment, event) {
  if (assessment?.pending === true || !Number.isFinite(assessment?.label)) return undefined;
  const previous = attempt?.neuralResidualLastAssessment;
  if (
    previous?.label === assessment.label && previous?.reason === assessment.reason ||
    event === 'neural-residual-corrected' && previous?.label === 0
  ) return undefined;
  const update = trainPreviewInspectorNeuralResidualDecision(
    attempt?.neuralResidualDecision,
    assessment.label,
    Number.isFinite(assessment.confidence) ? assessment.confidence : 1,
  );
  if (attempt !== undefined && update !== undefined) {
    attempt.neuralResidualLastAssessment = {
      confidence: assessment.confidence,
      label: assessment.label,
      reason: assessment.reason,
    };
  }
  if (update !== undefined && typeof recordPreviewInspectorRuntimeHealth === 'function') {
    recordPreviewInspectorRuntimeHealth({
      category: 'neural-residual',
      detail: {
        blockerKind: attempt.neuralResidualDecision.blockerKind,
        candidateId: attempt.neuralResidualDecision.candidateId,
        confidence: update.confidence,
        headEvidence: update.headEvidence,
        headKey: update.headKey,
        headUpdates: update.headUpdates,
        holeKind: attempt.neuralResidualDecision.holeKind,
        label: update.label,
        labelReason: assessment.reason,
        localProgress: assessment.localProgress === true,
        outcomeAttempts: update.outcomeAttempts,
        prediction: update.prediction,
        consecutiveFailures: update.consecutiveFailures,
        remainingBlockerCount: assessment.remainingBlockerCount ?? 0,
        targetOutput: assessment.targetOutput === true,
        traceId: attempt.traceId,
        updates: update.updates,
      },
      event,
    });
  }
  return update;
}

/** Requires spaced output observations within the existing bounded convergence window. */
function observePreviewInspectorNeuralResidualAttempt(attempt, result) {
  if (typeof isPreviewInspectorNeuralAssistancePaused === 'function' && isPreviewInspectorNeuralAssistancePaused()) return undefined;
  if (copyPreviewInspectorNeuralResidualDecision(attempt?.neuralResidualDecision) === undefined) {
    return undefined;
  }
  attempt.neuralResidualObservationRevision =
    (Number.isSafeInteger(attempt.neuralResidualObservationRevision)
      ? attempt.neuralResidualObservationRevision : 0) + 1;
  const revision = attempt.neuralResidualObservationRevision;
  const scope = attempt.neuralResidualObservationScope ??
    createPreviewInspectorNeuralResidualObservationScope(attempt);
  attempt.neuralResidualObservationScope = scope;
  if (!isPreviewInspectorNeuralResidualObservationCurrent(attempt, scope)) return undefined;
  const retainedResult = copyPreviewInspectorNeuralResidualAttemptResult(result);
  if (retainedResult === undefined) return undefined;
  const assessment = assessPreviewInspectorNeuralResidualAttempt(
    attempt,
    retainedResult,
  );
  if (assessment === undefined) return undefined;
  const requiresStableOutput = (value) => value?.targetOutput === true && value?.label > 0;
  if (assessment.pending !== true && !requiresStableOutput(assessment)) {
    return applyPreviewInspectorNeuralResidualAttemptAssessment(
      attempt,
      assessment,
      'neural-residual-trained',
    );
  }
  if (typeof globalThis.setTimeout !== 'function') {
    const finalAssessment = assessPreviewInspectorNeuralResidualAttempt(attempt, retainedResult, true);
    if (requiresStableOutput(finalAssessment)) return undefined;
    return applyPreviewInspectorNeuralResidualAttemptAssessment(
      attempt,
      finalAssessment,
      'neural-residual-trained',
    );
  }
  const startedAt = Date.now();
  let visibleObservations = requiresStableOutput(assessment) ? 1 : 0;
  const verify = () => {
    if (
      attempt.neuralResidualObservationRevision !== revision ||
      !isPreviewInspectorNeuralResidualObservationCurrent(attempt, scope)
    ) return;
    const deadlineReached = Date.now() - startedAt >=
      PREVIEW_INSPECTOR_NEURAL_RESIDUAL_VERIFY_LIMIT_MS;
    const nextAssessment = assessPreviewInspectorNeuralResidualAttempt(
      attempt,
      retainedResult,
      deadlineReached,
    );
    visibleObservations = requiresStableOutput(nextAssessment) ? visibleObservations + 1 : 0;
    const needsMoreEvidence = nextAssessment?.pending === true ||
      requiresStableOutput(nextAssessment) &&
        visibleObservations < PREVIEW_INSPECTOR_NEURAL_RESIDUAL_SUCCESS_OBSERVATIONS;
    if (needsMoreEvidence) {
      if (!deadlineReached) globalThis.setTimeout(verify, PREVIEW_INSPECTOR_NEURAL_RESIDUAL_VERIFY_INTERVAL_MS);
      return;
    }
    applyPreviewInspectorNeuralResidualAttemptAssessment(
      attempt,
      nextAssessment,
      'neural-residual-trained',
    );
  };
  globalThis.setTimeout(verify, PREVIEW_INSPECTOR_NEURAL_RESIDUAL_VERIFY_INTERVAL_MS);
  return undefined;
}

/** Cancels pending credit after an owned error or no-progress rollback, without mutating UI. */
function rejectPreviewInspectorNeuralResidualAttempt(attempt, reason = 'fatal-error-after-attempt') {
  if (attempt === undefined) return undefined;
  const scope = attempt.neuralResidualObservationScope;
  const mayLearn = (typeof isPreviewInspectorNeuralAssistancePaused !== 'function' ||
    !isPreviewInspectorNeuralAssistancePaused()) &&
    (scope === undefined || isPreviewInspectorNeuralResidualObservationCurrent(attempt, scope));
  attempt.neuralResidualRejected = true;
  attempt.neuralResidualObservationRevision =
    (Number.isSafeInteger(attempt.neuralResidualObservationRevision)
      ? attempt.neuralResidualObservationRevision
      : 0) + 1;
  if (!mayLearn) return undefined;
  return applyPreviewInspectorNeuralResidualAttemptAssessment(
    attempt,
    {
      confidence: 1,
      label: 0,
      localProgress: false,
      pending: false,
      reason: ['no-target-progress', 'target-repair-failed'].includes(reason)
        ? reason : 'fatal-error-after-attempt',
      targetOutput: false,
    },
    'neural-residual-corrected',
  );
}
`;
}
