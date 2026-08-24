import { createPreviewInspectorNeuralAssistanceAvailabilityRuntimeSource } from './previewInspectorNeuralAssistanceAvailabilityRuntimeSource';
import { createPreviewInspectorNeuralAssistanceAutomationRuntimeSource } from './previewInspectorNeuralAssistanceAutomationRuntimeSource';
import { createPreviewInspectorNeuralChoiceRuntimeSource } from './previewInspectorNeuralChoiceRuntimeSource';
import { createPreviewInspectorNeuralSuccessCheckpointRuntimeSource } from './previewInspectorNeuralSuccessCheckpointRuntimeSource';
/**
 * Generates the user-invoked bridge from Inspector chrome to the bounded local neural residual.
 *
 * The request never invents candidates. It refreshes current model scores, remounts only an
 * unresolved hook/data edge, and delegates one admitted blocker to the existing bounded verifier.
 */
/** Creates browser source for one cancellable, revision-local neural assistance request. */
export function createPreviewInspectorNeuralAssistanceRuntimeSource(): string {
  const availabilityRuntimeSource =
    createPreviewInspectorNeuralAssistanceAvailabilityRuntimeSource();
  const automationRuntimeSource = createPreviewInspectorNeuralAssistanceAutomationRuntimeSource();
  const neuralChoiceRuntimeSource = createPreviewInspectorNeuralChoiceRuntimeSource();
  const successCheckpointRuntimeSource =
    createPreviewInspectorNeuralSuccessCheckpointRuntimeSource();
  return String.raw`
const previewInspectorNeuralAssistanceBlockerKinds = new Set([
  'data-request',
  'render-condition',
  'runtime-fallback',
  'runtime-global',
  'target-error',
  'target-reachability',
]);
const previewInspectorNeuralAssistanceBlockerPriority = Object.freeze([
  'target-error',
  'runtime-global',
  'render-condition',
  'runtime-fallback',
  'data-request',
  'target-reachability',
]);
const previewInspectorAutomaticNeuralAssistanceEvents = new Set([
  'blocker-discovered',
  'neural-residual-corrected',
  'neural-residual-data-flow-trained',
  'neural-residual-trained',
  'page-composition-snapshot',
  'runtime-error-cascade',
  'runtime-error-fallback',
  'runtime-error-root',
]);
const previewInspectorNeuralLearningAssistanceEvents = new Set([
  'neural-residual-corrected',
  'neural-residual-data-flow-trained',
  'neural-residual-trained',
]);
const previewInspectorNeuralExplorationModes = Object.freeze([
  'novel-candidate',
  'data-first',
  'hook-first',
]);
const previewInspectorNeuralAssistanceAttemptLimits = Object.freeze({
  'data-request': 6,
  'render-condition': 2,
  'runtime-fallback': 8,
  'runtime-global': 2,
  'target-error': 3,
  'target-reachability': 12,
});
const PREVIEW_INSPECTOR_AUTOMATIC_NEURAL_ASSISTANCE_LIMIT = 128;
const PREVIEW_INSPECTOR_MANUAL_NEURAL_ASSISTANCE_LIMIT = 256;
const PREVIEW_INSPECTOR_MANUAL_NEURAL_ASSISTANCE_PASS_LIMIT = 8;
const PREVIEW_INSPECTOR_MANUAL_NEURAL_ASSISTANCE_PASS_ATTEMPTS = 2;
const PREVIEW_INSPECTOR_NEURAL_ASSISTANCE_IDENTITY_LIMIT = 96;
const PREVIEW_INSPECTOR_NEURAL_FINITE_CHOICE_RECORD_LIMIT = 32;
const PREVIEW_INSPECTOR_AUTOMATIC_NEURAL_ASSISTANCE_RECORD_LIMIT = 64;
const PREVIEW_INSPECTOR_AUTOMATIC_NEURAL_ASSISTANCE_BUSY_FRAME_LIMIT = 480;
const PREVIEW_INSPECTOR_NEURAL_RENDERER_WORK_SLICE_ATTEMPT_LIMIT = 24;
const PREVIEW_INSPECTOR_NEURAL_RENDERER_WORK_SLICE_MS = 20_000;
const PREVIEW_INSPECTOR_NEURAL_RENDERER_WORK_SLICE_IDLE_RESET_MS = 5_000;
const PREVIEW_INSPECTOR_NEURAL_RENDERER_LONG_ATTEMPT_MS = 2_500;
const PREVIEW_INSPECTOR_NEURAL_ASSISTANCE_FAILURE_LABEL_MAX = 0.2;
const PREVIEW_INSPECTOR_NEURAL_ASSISTANCE_SUCCESS_LABEL_MIN = 0.65;

/** Reads active blockers only when the DevTools blocker adapter is present. */
function readPreviewInspectorNeuralAssistanceBlockers() {
  if (typeof readPreviewInspectorActiveBlockerSummary !== 'function') {
    return { active: [], count: 0 };
  }
  try {
    const summary = readPreviewInspectorActiveBlockerSummary();
    const conditionBlockers =
      typeof readPreviewInspectorRenderConditions === 'function' &&
      typeof createPreviewInspectorConditionTreeNode === 'function'
        ? readPreviewInspectorRenderConditions()
            .map(createPreviewInspectorConditionTreeNode)
            .filter((node) => node?.blocksCurrentTarget === true)
            .map((node) => ({ ...node, blocker: node.condition, blockerKind: 'render-condition' }))
        : [];
    const active = [
      ...conditionBlockers,
      ...(Array.isArray(summary?.active)
        ? summary.active.filter((node) => node?.blockerKind !== 'render-condition')
        : []),
    ];
    return {
      active,
      count: active.length,
    };
  } catch {
    return { active: [], count: 0 };
  }
}

/** Returns the exact active corridor without constructing a new candidate or path. */
function readPreviewInspectorNeuralAssistanceReachability() {
  const key = previewInspectorSession.activeTargetReachabilityKey;
  return typeof key === 'string'
    ? previewInspectorSession.targetReachabilityByKey?.get?.(key)
    : undefined;
}

${neuralChoiceRuntimeSource}
${successCheckpointRuntimeSource}
${availabilityRuntimeSource}

/** Returns a stable identity so a preparatory remount cannot redirect the user request. */
function readPreviewInspectorNeuralAssistanceBlockerIdentity(node) {
  const id = node?.blocker?.id ?? node?.blocker?.key ?? node?.blockerId ?? node?.conditionId;
  return typeof id === 'string' && id.length > 0
    ? node.blockerKind + ':' + id
    : undefined;
}

/** Adds changing exception/shape evidence so a genuinely new hole can re-enter one later sweep. */
function createPreviewInspectorNeuralAssistanceAttemptIdentity(node) {
  const identity = readPreviewInspectorNeuralAssistanceBlockerIdentity(node);
  if (identity === undefined) return undefined;
  const requiredPaths = [
    ...(Array.isArray(node?.blocker?.requiredPaths) ? node.blocker.requiredPaths : []),
    ...(Array.isArray(node?.blocker?.targetPropRequiredPaths)
      ? node.blocker.targetPropRequiredPaths
      : []),
  ].filter((path) => typeof path === 'string').slice(0, 24);
  return identity + ':' + JSON.stringify({
    choicePathId: typeof previewInspectorSession.neuralActiveChoicePathId === 'string'
      ? previewInspectorSession.neuralActiveChoicePathId
      : '',
    effectiveEnabled: node?.condition?.effectiveEnabled,
    error: String(node?.blocker?.headline ?? node?.blocker?.targetOutputError?.message ?? '')
      .slice(0, 240),
    requiredPaths,
  });
}

/** Returns admitted blockers in exception-to-Unrendered order without inventing a new edge. */
function readPreviewInspectorNeuralAssistanceCandidates(summary, reachability) {
  const retainedReachability = (
    reachability !== undefined && reachability.status !== 'reached' &&
      reachability.targetHasOutput !== true
    ? { blocker: reachability, blockerKind: 'target-reachability' }
    : undefined
  );
  const candidates = [
    ...(Array.isArray(summary?.active) ? summary.active : []),
    retainedReachability,
  ].filter((node) =>
    node !== undefined && previewInspectorNeuralAssistanceBlockerKinds.has(node?.blockerKind) &&
    !(node?.blockerKind === 'target-reachability' && node?.blocker?.directTarget === true),
  );
  const seen = new Set();
  return candidates
    .filter((node) => {
      const identity = readPreviewInspectorNeuralAssistanceBlockerIdentity(node);
      if (identity === undefined || seen.has(identity)) return false;
      seen.add(identity);
      return true;
    })
    .sort((left, right) =>
      previewInspectorNeuralAssistanceBlockerPriority.indexOf(left.blockerKind) -
        previewInspectorNeuralAssistanceBlockerPriority.indexOf(right.blockerKind) ||
      readPreviewInspectorNeuralAssistanceBlockerIdentity(left).localeCompare(
        readPreviewInspectorNeuralAssistanceBlockerIdentity(right),
      ),
    );
}

/** Selects one existing blocker; the model never expands this admitted set. */
function selectPreviewInspectorNeuralAssistanceBlocker(summary, reachability, options = {}) {
  const currentCandidates = readPreviewInspectorNeuralAssistanceCandidates(summary, reachability);
  const record = typeof options?.sweepKey === 'string'
    ? previewInspectorSession.automaticNeuralAssistanceByKey?.get?.(options.sweepKey)
    : undefined;
  const candidates = record === undefined
    ? currentCandidates
    : readPreviewInspectorNeuralExplorationCandidates(record, currentCandidates);
  if (typeof options?.blockerIdentity === 'string') {
    return candidates.find((node) =>
      readPreviewInspectorNeuralAssistanceBlockerIdentity(node) === options.blockerIdentity,
    );
  }
  return candidates[0];
}

/** Remounts one unresolved hook/data edge; model-versioned caches replace themselves on demand. */
function preparePreviewInspectorNeuralAssistanceBlocker(node) {
  if (!['data-request', 'runtime-fallback'].includes(node?.blockerKind)) return false;
  const exportName = previewInspectorSession.selectedExportName;
  if (
    typeof exportName !== 'string' || exportName.length === 0 ||
    typeof remountPreviewInspectorExport !== 'function'
  ) return false;
  remountPreviewInspectorExport(exportName, false);
  return true;
}

/** Schedules after a commit boundary so the pending button state can render first. */
function schedulePreviewInspectorNeuralAssistanceFrame(callback) {
  const schedule = typeof previewInspectorScheduleRuntimeEffectFrame === 'function'
    ? previewInspectorScheduleRuntimeEffectFrame
    : typeof globalThis.requestAnimationFrame === 'function'
      ? globalThis.requestAnimationFrame.bind(globalThis)
      : globalThis.queueMicrotask ?? ((task) => Promise.resolve().then(task));
  schedule(callback);
}

/** Delegates exactly one currently admitted blocker to its existing bounded resolver. */
function applyPreviewInspectorNeuralAssistanceBlocker(
  node,
  requestedBy = 'user',
  exploration,
) {
  const previousExplorationPolicy = previewInspectorSession.neuralAssistanceExplorationPolicy;
  previewInspectorSession.neuralAssistanceExplorationPolicy = {
    excludedCandidateIds: exploration?.excludedCandidateIds,
    mode: exploration?.mode,
    ordinal: exploration?.ordinal,
    origin: requestedBy === 'automatic-learning' ? 'automatic-neural' : 'user-neural',
  };
  try {
    if (
      exploration?.pageGenerationChoice === true &&
      typeof applyPreviewInspectorNeuralPageGenerationPlan === 'function'
    ) {
      return applyPreviewInspectorNeuralPageGenerationPlan(exploration);
    }
    if (node?.blockerKind === 'target-error') {
      const failure = node.blocker;
      const finiteChoiceCandidateId = typeof exploration?.choiceCandidateId === 'string'
        ? exploration.choiceCandidateId
        : undefined;
      const neuralResidualDecision =
        typeof createPreviewInspectorNeuralResidualDecision === 'function'
          ? createPreviewInspectorNeuralResidualDecision({
              blockerKind: 'target-error',
              candidateId: finiteChoiceCandidateId ?? failure?.id,
              holeKind: 'blocker-exception-target-props',
              numbers: {
                choiceAttempt: exploration?.choiceOrdinal ?? 0,
                choiceCount: exploration?.choiceCandidateCount ?? 0,
                requiredPathCount: failure?.targetPropRequiredPaths?.length ?? 0,
              },
              texts: [failure?.headline, failure?.blockedComponentName, failure?.sourcePath],
              tokens: [
                ...(failure?.targetPropRequiredPaths ?? [])
                  .slice(0, 16)
                  .map((path) => 'required:' + path),
                ...(typeof exploration?.choicePath === 'string'
                  ? ['finite-choice-path:' + exploration.choicePath]
                  : []),
              ],
            })
          : undefined;
      const changed = typeof smartFillPreviewInspectorTargetFailure === 'function'
        ? smartFillPreviewInspectorTargetFailure(
            failure,
            true,
            neuralResidualDecision,
            {
              finiteChoiceOrdinal: exploration?.choiceOrdinal,
              finiteChoiceSignature: exploration?.choiceSignature,
            },
          ) === true
        : false;
      return { action: 'target-error-recommendation', changed };
    }
    if (node?.blockerKind === 'runtime-global') {
      const exportName = node.blocker?.exportName;
      const changed = typeof exportName === 'string' && exportName.length > 0 &&
        typeof remountPreviewInspectorExport === 'function';
      if (changed) remountPreviewInspectorExport(exportName, false);
      return { action: 'runtime-global-retry', changed };
    }
    if (node?.blockerKind === 'render-condition') {
      const condition = node.condition ?? node.blocker;
      const state = previewInspectorSession.targetReachabilityByKey?.get?.(
        condition?.reachabilityKey,
      );
      const descriptor = typeof findSelectedPreviewInspectorDescriptor === 'function'
        ? findSelectedPreviewInspectorDescriptor()
        : undefined;
      const candidate = typeof readSelectedPreviewInspectorPageCandidate === 'function'
        ? readSelectedPreviewInspectorPageCandidate(descriptor)
        : undefined;
      const evidence =
        state !== undefined && descriptor !== undefined && candidate !== undefined &&
        typeof readPreviewInspectorTargetPathEvidence === 'function'
          ? readPreviewInspectorTargetPathEvidence(descriptor, candidate, state)
          : undefined;
      const requiredValue = evidence !== undefined &&
        typeof readPreviewInspectorTargetConditionValue === 'function'
          ? readPreviewInspectorTargetConditionValue(condition, evidence)
          : undefined;
      const neuralResidualDecision = typeof requiredValue === 'boolean' &&
        typeof createPreviewInspectorNeuralResidualDecision === 'function'
          ? createPreviewInspectorNeuralResidualDecision({
              blockerKind: 'render-condition',
              candidateId: condition?.id + ':' + String(requiredValue),
              holeKind: 'condition-activation-order',
              numbers: { requiredValue: requiredValue ? 1 : 0 },
              texts: [condition?.expression, condition?.ownerName, condition?.sourcePath],
              tokens: ['desired:' + String(requiredValue)],
            })
          : undefined;
      const changed = typeof requiredValue === 'boolean' &&
        typeof setPreviewInspectorTargetGuidedConditionOverride === 'function'
          ? setPreviewInspectorTargetGuidedConditionOverride(
              condition?.id,
              requiredValue,
              neuralResidualDecision,
            ) === true
          : false;
      return { action: 'render-condition-recommendation', changed };
    }
    if (node?.blockerKind === 'runtime-fallback') {
      const changed = typeof smartFillPreviewInspectorRuntimeFallback === 'function'
        ? smartFillPreviewInspectorRuntimeFallback(node.blocker?.id) === true
        : false;
      return { action: 'hook-value-recommendation', changed };
    }
    if (node?.blockerKind === 'data-request') {
      const changed = typeof smartFillPreviewInspectorDataPayload === 'function'
        ? smartFillPreviewInspectorDataPayload(node.blocker?.id) === true
        : false;
      return { action: 'data-payload-recommendation', changed };
    }
    if (node?.blockerKind === 'target-reachability') {
      const origin = requestedBy === 'automatic-learning'
        ? 'automatic-neural'
        : 'user-neural';
      const changed = typeof smartFillPreviewInspectorTargetApplicationPath === 'function'
        ? smartFillPreviewInspectorTargetApplicationPath(
            node.blocker,
            {
              excludedCandidateIds: exploration?.excludedCandidateIds,
              explorationMode: exploration?.mode,
              explorationOrdinal: exploration?.ordinal,
              origin,
            },
          ) === true
        : false;
      return { action: 'page-path-search', changed };
    }
    return { action: 're-evaluate-learned-model', changed: false };
  } finally {
    previewInspectorSession.neuralAssistanceExplorationPolicy = previousExplorationPolicy;
  }
}

/** Rejects callbacks retained by an older preview revision or superseded request. */
function isPreviewInspectorNeuralAssistanceRequestCurrent(sequence) {
  return previewInspectorSession.neuralAssistanceSequence === sequence &&
    previewInspectorSession.neuralAssistanceRevision === previewEntryRevision;
}

/** Settles the visible request after its work completes, while never delaying the page mutation. */
function finishPreviewInspectorNeuralAssistanceRequest(sequence, result) {
  const finalize = () => {
    if (!isPreviewInspectorNeuralAssistanceRequestCurrent(sequence)) return;
    previewInspectorSession.neuralAssistancePending = false;
    previewInspectorSession.neuralPageGenerationPending = false;
    const modelUpdates = typeof readPreviewInspectorNeuralLearningModelUpdates === 'function'
      ? readPreviewInspectorNeuralLearningModelUpdates()
      : 0;
    const reachability = readPreviewInspectorNeuralAssistanceReachability();
    const sweepRecord = typeof result.sweepKey === 'string'
      ? previewInspectorSession.automaticNeuralAssistanceByKey?.get?.(result.sweepKey)
      : undefined;
    if (
      sweepRecord !== undefined &&
      Date.now() - result.startedAt >= PREVIEW_INSPECTOR_NEURAL_RENDERER_LONG_ATTEMPT_MS
    ) {
      pausePreviewInspectorNeuralRendererWorkSlice(sweepRecord);
    }
    if (reachability?.targetHasOutput === true) {
      recordPreviewInspectorNeuralSuccessfulPath(reachability);
    }
    const verifyingOutput =
      typeof isPreviewInspectorNeuralSuccessVerificationPending === 'function' &&
      isPreviewInspectorNeuralSuccessVerificationPending(sweepRecord);
    const continueSweep = () => {
      if (typeof result.sweepKey !== 'string' || result.sweepKey.length === 0) return false;
      return schedulePreviewInspectorNeuralAssistanceSweepContinuation(
        result.sweepKey,
        result.requestedBy,
        modelUpdates,
      );
    };
    const continued = verifyingOutput ? false : continueSweep();
    const remainingExploration = !verifyingOutput && continued !== true &&
      sweepRecord !== undefined
      ? createPreviewInspectorNeuralExplorationPlan(sweepRecord)
      : undefined;
    const settlement = continued === true || remainingExploration !== undefined ||
      typeof result.sweepKey !== 'string'
      ? undefined
      : settlePreviewInspectorNeuralSuccessfulPaths(result.sweepKey);
    const successCount = settlement?.successCount ??
      readPreviewInspectorNeuralSuccessfulPathCount(
        previewInspectorSession.automaticNeuralAssistanceByKey?.get?.(result.sweepKey),
      );
    const needsChoice = !verifyingOutput && continued !== true &&
      remainingExploration === undefined && settlement === undefined &&
      readPreviewInspectorNeuralUserChoice() !== undefined;
    const rendererWorkPaused = sweepRecord?.rendererWorkSlicePaused === true;
    if (typeof setPreviewInspectorNeuralLearningStatus === 'function') {
      setPreviewInspectorNeuralLearningStatus({
        activeCount: 0,
        collecting: verifyingOutput || continued === true && successCount > 0,
        labelReason: verifyingOutput
          ? 'verifying-output-stability'
          : rendererWorkPaused ? 'renderer-work-budget' : result.action,
        phase: verifyingOutput
          ? 'applying'
          : settlement?.settled === true
          ? 'applied'
          : settlement?.restoring === true
            ? 'applying'
            : result.error === true
              ? 'paused'
          : continued === true
            ? 'applying'
            : rendererWorkPaused ? 'yielded'
            : needsChoice ? 'needs-choice' : result.changed ? 'applied' : 'unchanged',
        restoring: settlement?.restoring === true,
        successCount,
        updates: modelUpdates,
        verifying: verifyingOutput,
      });
    } else if (typeof notifyPreviewInspector === 'function') {
      notifyPreviewInspector();
    }
  };
  const elapsed = Date.now() - result.startedAt;
  const minimumVisibleMs = typeof PREVIEW_INSPECTOR_NEURAL_LEARNING_MIN_VISIBLE_MS === 'number'
    ? PREVIEW_INSPECTOR_NEURAL_LEARNING_MIN_VISIBLE_MS
    : 600;
  const waitMs = minimumVisibleMs - elapsed;
  if (waitMs > 0 && typeof globalThis.setTimeout === 'function') {
    globalThis.setTimeout(finalize, waitMs);
  } else {
    finalize();
  }
}

/** Re-evaluates current evidence with persisted weights, then asks one safe resolver to proceed. */
function beginPreviewInspectorNeuralAssistanceRequest(requestedBy = 'user', options = {}) {
  const availability = readPreviewInspectorNeuralAssistanceAvailability();
  const collectionRecord = typeof options?.sweepKey === 'string'
    ? previewInspectorSession.automaticNeuralAssistanceByKey?.get?.(options.sweepKey)
    : undefined;
  const successCount = readPreviewInspectorNeuralSuccessfulPathCount(collectionRecord);
  const collectingSuccesses = successCount > 0 &&
    collectionRecord?.successCollectionSettled !== true;
  if (!availability.actionable && !collectingSuccesses) return false;
  const sequence = (Number.isSafeInteger(previewInspectorSession.neuralAssistanceSequence)
    ? previewInspectorSession.neuralAssistanceSequence
    : 0) + 1;
  const startedAt = Date.now();
  previewInspectorSession.neuralAssistanceSequence = sequence;
  previewInspectorSession.neuralAssistanceRevision = previewEntryRevision;
  previewInspectorSession.neuralAssistancePending = true;
  previewInspectorSession.neuralPageGenerationPending =
    options?.exploration?.pageGenerationChoice === true;
  if (collectionRecord !== undefined) {
    collectionRecord.successCollectionRequestedBy = requestedBy === 'user'
      ? 'user'
      : 'automatic-learning';
  }
  const currentReachability = readPreviewInspectorNeuralAssistanceReachability();
  if (currentReachability?.targetHasOutput === true) {
    recordPreviewInspectorNeuralSuccessfulPath(currentReachability);
  }
  if (typeof setPreviewInspectorNeuralLearningStatus === 'function') {
    setPreviewInspectorNeuralLearningStatus({
      activeCount: 0,
      choiceAttempt: options?.exploration?.choiceOrdinal,
      choiceCount: options?.exploration?.choiceCandidateCount,
      collecting: collectingSuccesses,
      phase: 'applying',
      successCount,
      startedAt,
      updates: availability.modelUpdates,
    });
  }
  const before = readPreviewInspectorNeuralAssistanceBlockers();
  schedulePreviewInspectorNeuralAssistanceFrame(() => {
    if (!isPreviewInspectorNeuralAssistanceRequestCurrent(sequence)) return;
    try {
      const preparedSummary = readPreviewInspectorNeuralAssistanceBlockers();
      const preparedBlocker = selectPreviewInspectorNeuralAssistanceBlocker(
        preparedSummary,
        readPreviewInspectorNeuralAssistanceReachability(),
        { blockerIdentity: options?.exploration?.blockerIdentity, sweepKey: options?.sweepKey },
      );
      const preparedIdentity = readPreviewInspectorNeuralAssistanceBlockerIdentity(
        preparedBlocker,
      );
      preparePreviewInspectorNeuralAssistanceBlocker(preparedBlocker);
      schedulePreviewInspectorNeuralAssistanceFrame(() => {
        if (!isPreviewInspectorNeuralAssistanceRequestCurrent(sequence)) return;
        try {
          const current = readPreviewInspectorNeuralAssistanceBlockers();
          const reachability = readPreviewInspectorNeuralAssistanceReachability();
          const blocker = current.active.find((node) =>
            readPreviewInspectorNeuralAssistanceBlockerIdentity(node) === preparedIdentity,
          ) ?? selectPreviewInspectorNeuralAssistanceBlocker(
            current,
            reachability,
            { blockerIdentity: options?.exploration?.blockerIdentity, sweepKey: options?.sweepKey },
          );
          const applied = applyPreviewInspectorNeuralAssistanceBlocker(
            blocker,
            requestedBy,
            options?.exploration,
          );
          const changed = applied.changed || current.count < before.count;
          if (typeof recordPreviewInspectorRuntimeHealth === 'function') {
            recordPreviewInspectorRuntimeHealth({
              category: 'neural-residual',
              detail: {
                action: applied.action,
                blockerIdentity: preparedIdentity,
                blockerKind: blocker?.blockerKind,
                branchPolicy: 'sticky-until-verified-failure',
                changed,
                explorationAttempt: options?.exploration?.ordinal,
                explorationAttemptLimit: options?.exploration?.attemptLimit,
                explorationMode: options?.exploration?.mode,
                explorationOrdinal: options?.exploration?.ordinal,
                finiteChoiceAttempt: options?.exploration?.choiceOrdinal,
                finiteChoiceCandidateCount: options?.exploration?.choiceCandidateCount,
                modelUpdates: availability.modelUpdates,
                observedBlockerCount: current.count,
                requestedBy,
              },
              event: 'neural-assistance-requested',
            });
          }
          finishPreviewInspectorNeuralAssistanceRequest(sequence, {
            action: applied.action,
            changed,
            requestedBy,
            startedAt,
            sweepKey: options?.sweepKey,
          });
        } catch {
          finishPreviewInspectorNeuralAssistanceRequest(sequence, {
            action: 'request-failed',
            changed: false,
            error: true,
            requestedBy,
            startedAt,
            sweepKey: options?.sweepKey,
          });
        }
      });
    } catch {
      finishPreviewInspectorNeuralAssistanceRequest(sequence, {
        action: 'request-failed',
        changed: false,
        error: true,
        requestedBy,
        startedAt,
        sweepKey: options?.sweepKey,
      });
    }
  });
  return true;
}

/** Keeps the button additive: explicit requests share the resolver but never own automatic policy. */
function requestPreviewInspectorNeuralAssistance() {
  const reachability = readPreviewInspectorAutomaticNeuralAssistanceCorridor();
  if (reachability === undefined) return beginPreviewInspectorNeuralAssistanceRequest('user');
  initializePreviewInspectorAutomaticNeuralAssistanceState();
  const key = createPreviewInspectorAutomaticNeuralAssistanceKey(reachability);
  const record = readPreviewInspectorAutomaticNeuralAssistanceRecord(key);
  if (record.rendererWorkSlicePaused === true) {
    resetPreviewInspectorNeuralRendererWorkSlice(record);
  } else {
    resetPreviewInspectorNeuralRendererWorkSliceAfterIdle(record);
  }
  let exploration = record.attempts < readPreviewInspectorNeuralAssistanceEffortLimit(
    record,
    'user',
  )
    ? createPreviewInspectorNeuralExplorationPlan(record)
    : undefined;
  if (
    exploration === undefined &&
    record.manualPasses < PREVIEW_INSPECTOR_MANUAL_NEURAL_ASSISTANCE_PASS_LIMIT
  ) {
    record.manualPasses += 1;
    exploration = createPreviewInspectorNeuralExplorationPlan(record);
  }
  if (exploration === undefined) {
    setPreviewInspectorNeuralNeedsChoiceStatus('neural-effort-exhausted');
    return false;
  }
  const started = beginPreviewInspectorNeuralAssistanceRequest('user', {
    exploration,
    sweepKey: key,
  });
  if (started) {
    markPreviewInspectorNeuralExplorationAttempt(record, exploration);
    record.manualAttempts += 1;
  }
  return started;
}

/** Uses one toolbar action for automatic work and the explicit user-choice handoff. */
function activatePreviewInspectorNeuralAssistance() {
  const availability = readPreviewInspectorNeuralAssistanceAvailability();
  if (!availability.actionable) return false;
  if (availability.mode === 'choice') {
    return revealPreviewInspectorNeuralUserChoice();
  }
  const started = requestPreviewInspectorNeuralAssistance();
  if (started) return true;
  return setPreviewInspectorNeuralNeedsChoiceStatus('neural-effort-exhausted') &&
    revealPreviewInspectorNeuralUserChoice();
}

/** Initializes a revision-local hard budget for learning-triggered retries. */
function initializePreviewInspectorAutomaticNeuralAssistanceState() {
  if (!(previewInspectorSession.automaticNeuralAssistanceByKey instanceof Map)) {
    previewInspectorSession.automaticNeuralAssistanceByKey = new Map();
  }
}

/** Returns one hot-safe retry record and upgrades records retained by an older webview script. */
function readPreviewInspectorAutomaticNeuralAssistanceRecord(key) {
  initializePreviewInspectorAutomaticNeuralAssistanceState();
  let record = previewInspectorSession.automaticNeuralAssistanceByKey.get(key);
  if (record === undefined) {
    record = {
      attempts: 0,
      attemptsByBlocker: new Map(),
      attemptIdentityOrder: [],
      failedCandidateIds: new Set(),
      finiteChoiceAttemptsBySignature: new Map(),
      lastAttemptIdentity: undefined,
      lastModelUpdates: 0,
      manualAttempts: 0,
      manualPasses: 0,
      rendererWorkSliceAttempts: 0,
      rendererWorkSliceLastAttemptAt: undefined,
      rendererWorkSlicePaused: false,
      rendererWorkSliceStartedAt: undefined,
      scheduled: false,
    };
    previewInspectorSession.automaticNeuralAssistanceByKey.set(key, record);
  }
  if (!(record.attemptsByBlocker instanceof Map)) record.attemptsByBlocker = new Map();
  if (!(record.finiteChoiceAttemptsBySignature instanceof Map)) {
    record.finiteChoiceAttemptsBySignature = new Map();
  }
  while (
    record.finiteChoiceAttemptsBySignature.size >
    PREVIEW_INSPECTOR_NEURAL_FINITE_CHOICE_RECORD_LIMIT
  ) {
    record.finiteChoiceAttemptsBySignature.delete(
      record.finiteChoiceAttemptsBySignature.keys().next().value,
    );
  }
  record.attemptIdentityOrder = (Array.isArray(record.attemptIdentityOrder)
    ? record.attemptIdentityOrder
    : []).filter((identity) => typeof identity === 'string').slice(
      -PREVIEW_INSPECTOR_NEURAL_ASSISTANCE_IDENTITY_LIMIT,
  );
  if (!(record.failedCandidateIds instanceof Set)) record.failedCandidateIds = new Set();
  upgradePreviewInspectorNeuralSuccessCollectionRecord(record);
  if (!Number.isSafeInteger(record.attempts) || record.attempts < 0) record.attempts = 0;
  if (!Number.isSafeInteger(record.lastModelUpdates) || record.lastModelUpdates < 0) {
    record.lastModelUpdates = 0;
  }
  if (!Number.isSafeInteger(record.manualAttempts) || record.manualAttempts < 0) {
    record.manualAttempts = 0;
  }
  if (!Number.isSafeInteger(record.rendererWorkSliceAttempts) || record.rendererWorkSliceAttempts < 0) {
    record.rendererWorkSliceAttempts = 0;
  }
  if (!Number.isFinite(record.rendererWorkSliceLastAttemptAt)) {
    record.rendererWorkSliceLastAttemptAt = undefined;
  }
  if (!Number.isFinite(record.rendererWorkSliceStartedAt)) {
    record.rendererWorkSliceStartedAt = undefined;
  }
  if (record.rendererWorkSlicePaused !== true) record.rendererWorkSlicePaused = false;
  record.manualPasses = Number.isSafeInteger(record.manualPasses)
    ? Math.max(0, Math.min(
        PREVIEW_INSPECTOR_MANUAL_NEURAL_ASSISTANCE_PASS_LIMIT,
        record.manualPasses,
      ))
    : 0;
  if (record.scheduled !== true) record.scheduled = false;
  while (
    previewInspectorSession.automaticNeuralAssistanceByKey.size >
    PREVIEW_INSPECTOR_AUTOMATIC_NEURAL_ASSISTANCE_RECORD_LIMIT
  ) {
    previewInspectorSession.automaticNeuralAssistanceByKey.delete(
      previewInspectorSession.automaticNeuralAssistanceByKey.keys().next().value,
    );
  }
  return record;
}

/** Opens a fresh cooperative renderer slice without resetting learned exploration evidence. */
function resetPreviewInspectorNeuralRendererWorkSlice(record) {
  record.rendererWorkSliceAttempts = 0;
  record.rendererWorkSliceLastAttemptAt = undefined;
  record.rendererWorkSlicePaused = false;
  record.rendererWorkSliceStartedAt = undefined;
}

/** Starts a new slice after real idle time, while a safety pause still requires explicit intent. */
function resetPreviewInspectorNeuralRendererWorkSliceAfterIdle(record) {
  if (
    record.rendererWorkSlicePaused === true ||
    !Number.isFinite(record.rendererWorkSliceLastAttemptAt) ||
    Date.now() - record.rendererWorkSliceLastAttemptAt <
      PREVIEW_INSPECTOR_NEURAL_RENDERER_WORK_SLICE_IDLE_RESET_MS
  ) return;
  resetPreviewInspectorNeuralRendererWorkSlice(record);
}

/** Stops continuations before one retained webview can monopolize the shared renderer process. */
function pausePreviewInspectorNeuralRendererWorkSlice(record) {
  record.rendererWorkSlicePaused = true;
  record.scheduled = false;
}

/** Admits work only inside one bounded, event-loop-yielding renderer slice. */
function hasPreviewInspectorNeuralRendererWorkSliceBudget(record) {
  if (record.rendererWorkSlicePaused === true) return false;
  try {
    if (typeof document !== 'undefined' && document.visibilityState === 'hidden') {
      pausePreviewInspectorNeuralRendererWorkSlice(record);
      return false;
    }
  } catch {
    /* A non-browser test/runtime without visibility state remains governed by the hard slice. */
  }
  const now = Date.now();
  if (!Number.isFinite(record.rendererWorkSliceStartedAt)) {
    record.rendererWorkSliceStartedAt = now;
  }
  if (
    record.rendererWorkSliceAttempts >=
      PREVIEW_INSPECTOR_NEURAL_RENDERER_WORK_SLICE_ATTEMPT_LIMIT ||
    now - record.rendererWorkSliceStartedAt >=
      PREVIEW_INSPECTOR_NEURAL_RENDERER_WORK_SLICE_MS
  ) {
    pausePreviewInspectorNeuralRendererWorkSlice(record);
    return false;
  }
  return true;
}

/** Returns the bounded per-evidence effort granted to one blocker family. */
function readPreviewInspectorNeuralAssistanceAttemptLimit(record, blockerKind) {
  const baseLimit = previewInspectorNeuralAssistanceAttemptLimits[blockerKind] ?? 1;
  return baseLimit + Math.min(
    PREVIEW_INSPECTOR_MANUAL_NEURAL_ASSISTANCE_PASS_LIMIT,
    record.manualPasses,
  ) * PREVIEW_INSPECTOR_MANUAL_NEURAL_ASSISTANCE_PASS_ATTEMPTS;
}

/** Gives user-requested passes more room without removing the absolute revision-local guardrail. */
function readPreviewInspectorNeuralAssistanceEffortLimit(record, requestedBy) {
  if (requestedBy !== 'user') return PREVIEW_INSPECTOR_AUTOMATIC_NEURAL_ASSISTANCE_LIMIT;
  return Math.min(
    PREVIEW_INSPECTOR_MANUAL_NEURAL_ASSISTANCE_LIMIT,
    PREVIEW_INSPECTOR_AUTOMATIC_NEURAL_ASSISTANCE_LIMIT + record.manualPasses * 16,
  );
}

/** Keeps one strategy until verified failure evidence authorizes the next admitted direction. */
function createPreviewInspectorNeuralExplorationPlan(record) {
  const currentCandidates = readPreviewInspectorNeuralAssistanceCandidates(
    readPreviewInspectorNeuralAssistanceBlockers(),
    readPreviewInspectorNeuralAssistanceReachability(),
  );
  const blockers = readPreviewInspectorNeuralExplorationCandidates(
    record,
    currentCandidates,
  ).map((node) => {
    const finiteChoice = typeof readPreviewInspectorNeuralFiniteChoiceProgress === 'function'
      ? readPreviewInspectorNeuralFiniteChoiceProgress(node, record, true)
      : undefined;
    return {
      attemptIdentity: createPreviewInspectorNeuralAssistanceAttemptIdentity(node),
      blockerIdentity: readPreviewInspectorNeuralAssistanceBlockerIdentity(node),
      blockerKind: node.blockerKind,
      finiteChoice,
      resolutionKind: typeof readPreviewInspectorResolutionKind === 'function'
        ? readPreviewInspectorResolutionKind(node)
        : undefined,
    };
  }).filter((item) =>
    item.attemptIdentity !== undefined && item.blockerIdentity !== undefined &&
      item.resolutionKind !== 'choice',
  );
  const selected = blockers.map((item, priority) => {
    const attempts = item.finiteChoice?.attempts ??
      (record.attemptsByBlocker.get(item.attemptIdentity) ?? 0);
    const attemptLimit = item.finiteChoice?.candidateCount ??
      readPreviewInspectorNeuralAssistanceAttemptLimit(record, item.blockerKind);
    return { ...item, attempts, attemptLimit, priority };
  }).filter((item) =>
    item.attempts < item.attemptLimit,
  ).sort((left, right) =>
    left.attempts - right.attempts ||
    Number(left.attemptIdentity === record.lastAttemptIdentity) -
      Number(right.attemptIdentity === record.lastAttemptIdentity) ||
    left.priority - right.priority,
  )[0];
  if (selected !== undefined) {
    const previousAttempts = selected.attempts;
    const ordinal = previousAttempts + 1;
    const mode = selected.blockerKind === 'runtime-fallback'
      ? 'novel-candidate'
      : previewInspectorNeuralExplorationModes[
          record.failedCandidateIds.size % previewInspectorNeuralExplorationModes.length
        ];
    return Object.freeze({
      attemptIdentity: selected.attemptIdentity,
      blockerIdentity: selected.blockerIdentity,
      blockerKind: selected.blockerKind,
      choiceCandidateCount: selected.finiteChoice?.candidateCount,
      choiceCandidateId: selected.finiteChoice?.candidateId,
      choiceAttemptSignature: selected.finiteChoice?.attemptSignature,
      choiceOrdinal: selected.finiteChoice?.choiceOrdinal,
      choicePath: selected.finiteChoice?.path,
      choiceSignature: selected.finiteChoice?.signature,
      excludedCandidateIds: [...record.failedCandidateIds].slice(-12),
      attemptLimit: selected.attemptLimit,
      mode,
      ordinal,
    });
  }
  return typeof createPreviewInspectorNeuralPageGenerationPlan === 'function'
    ? createPreviewInspectorNeuralPageGenerationPlan(record)
    : undefined;
}

/** Consumes budget only after one concrete admitted blocker request starts. */
function markPreviewInspectorNeuralExplorationAttempt(record, exploration) {
  const previous = record.attemptsByBlocker.get(exploration.attemptIdentity) ?? 0;
  if (previous === 0) {
    record.attemptIdentityOrder.push(exploration.attemptIdentity);
    while (
      record.attemptIdentityOrder.length >
      PREVIEW_INSPECTOR_NEURAL_ASSISTANCE_IDENTITY_LIMIT
    ) {
      const staleIdentity = record.attemptIdentityOrder.shift();
      if (staleIdentity !== undefined) record.attemptsByBlocker.delete(staleIdentity);
    }
  }
  record.attemptsByBlocker.set(exploration.attemptIdentity, previous + 1);
  if (
    typeof exploration.choiceSignature === 'string' &&
    Number.isSafeInteger(exploration.choiceCandidateCount)
  ) {
    const choiceAttemptSignature = typeof exploration.choiceAttemptSignature === 'string'
      ? exploration.choiceAttemptSignature
      : exploration.choiceSignature;
    const previousChoiceAttempts = record.finiteChoiceAttemptsBySignature.get(
      choiceAttemptSignature,
    ) ?? 0;
    record.finiteChoiceAttemptsBySignature.set(
      choiceAttemptSignature,
      Math.min(exploration.choiceCandidateCount, previousChoiceAttempts + 1),
    );
  }
  record.lastAttemptIdentity = exploration.attemptIdentity;
  record.attempts += 1;
  if (!Number.isFinite(record.rendererWorkSliceStartedAt)) {
    record.rendererWorkSliceStartedAt = Date.now();
  }
  record.rendererWorkSliceAttempts += 1;
  record.rendererWorkSliceLastAttemptAt = Date.now();
}

${automationRuntimeSource}
`;
}
