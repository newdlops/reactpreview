/**
 * Generates the ephemeral UI status for the viewer's persisted local neural residual.
 *
 * Model parameters remain owned by the neural runtime. This source retains only bounded progress
 * metadata so Inspector chrome can distinguish active learning from a verified update.
 */

/** Creates browser source for observable learning progress without exposing project values. */
export function createPreviewInspectorNeuralLearningStatusRuntimeSource(): string {
  return String.raw`
const PREVIEW_INSPECTOR_NEURAL_LEARNING_PHASES = new Set([
  'applied',
  'applying',
  'learned',
  'learning',
  'needs-choice',
  'paused',
  'unchanged',
  'yielded',
]);
const PREVIEW_INSPECTOR_NEURAL_LEARNING_TEXT_LIMIT = 120;
const PREVIEW_INSPECTOR_NEURAL_LEARNING_MIN_VISIBLE_MS = 600;

/** Reads the persisted model's finite total without allocating project-owned data. */
function readPreviewInspectorNeuralLearningModelUpdates() {
  const model = typeof initializePreviewInspectorNeuralResidualModel === 'function'
    ? initializePreviewInspectorNeuralResidualModel()
    : previewInspectorSession.neuralResidualModel;
  return Number.isSafeInteger(model?.updates) && model.updates >= 0 ? model.updates : 0;
}

/** Accepts only renderer-owned progress metadata and the current runtime revision. */
function normalizePreviewInspectorNeuralLearningStatus(candidate) {
  const phase = PREVIEW_INSPECTOR_NEURAL_LEARNING_PHASES.has(candidate?.phase)
    ? candidate.phase
    : undefined;
  if (phase === undefined) return undefined;
  const activeCount = Number.isSafeInteger(candidate?.activeCount) && candidate.activeCount > 0
    ? Math.min(candidate.activeCount, 256)
    : 0;
  const updates = Number.isSafeInteger(candidate?.updates) && candidate.updates >= 0
    ? candidate.updates
    : readPreviewInspectorNeuralLearningModelUpdates();
  const choiceCount = Number.isSafeInteger(candidate?.choiceCount) && candidate.choiceCount > 0
    ? Math.min(candidate.choiceCount, 256)
    : undefined;
  const choiceAttempt = choiceCount !== undefined &&
    Number.isSafeInteger(candidate?.choiceAttempt) && candidate.choiceAttempt > 0
      ? Math.min(candidate.choiceAttempt, choiceCount)
      : undefined;
  const successCount = Number.isSafeInteger(candidate?.successCount) && candidate.successCount > 0
    ? Math.min(candidate.successCount, 64)
    : 0;
  const readText = (value) => typeof value === 'string' && value.length > 0
    ? value.slice(0, PREVIEW_INSPECTOR_NEURAL_LEARNING_TEXT_LIMIT)
    : undefined;
  return Object.freeze({
    activeCount,
    choiceAttempt,
    choiceCount,
    collecting: candidate?.collecting === true,
    headKey: readText(candidate?.headKey),
    labelReason: readText(candidate?.labelReason),
    phase: activeCount > 0 ? 'learning' : phase,
    restoring: candidate?.restoring === true,
    revision: previewEntryRevision,
    startedAt: Number.isFinite(candidate?.startedAt) && candidate.startedAt > 0
      ? candidate.startedAt
      : undefined,
    trainingExamples:
      Number.isSafeInteger(candidate?.trainingExamples) && candidate.trainingExamples >= 0
        ? Math.min(candidate.trainingExamples, Number.MAX_SAFE_INTEGER)
        : undefined,
    successCount,
    updates,
    verifying: candidate?.verifying === true,
  });
}

/** Coalesces progress notifications so learning discovered during render cannot re-enter React. */
function schedulePreviewInspectorNeuralLearningStatusRefresh() {
  if (previewInspectorSession.neuralLearningStatusRefreshScheduled === true) return;
  previewInspectorSession.neuralLearningStatusRefreshScheduled = true;
  const refresh = () => {
    previewInspectorSession.neuralLearningStatusRefreshScheduled = false;
    if (typeof notifyPreviewInspector === 'function') notifyPreviewInspector();
  };
  if (typeof globalThis.queueMicrotask === 'function') {
    globalThis.queueMicrotask(refresh);
  } else {
    refresh();
  }
}

/** Commits one bounded state only when its visible content changed. */
function setPreviewInspectorNeuralLearningStatus(candidate) {
  const next = normalizePreviewInspectorNeuralLearningStatus(candidate);
  if (next === undefined) return undefined;
  const previous = previewInspectorSession.neuralLearningStatus;
  const unchanged = previous?.revision === next.revision &&
    previous.activeCount === next.activeCount &&
    previous.choiceAttempt === next.choiceAttempt && previous.choiceCount === next.choiceCount &&
    previous.collecting === next.collecting && previous.headKey === next.headKey &&
    previous.labelReason === next.labelReason && previous.phase === next.phase &&
    previous.restoring === next.restoring && previous.startedAt === next.startedAt &&
    previous.successCount === next.successCount &&
    previous.trainingExamples === next.trainingExamples && previous.updates === next.updates &&
    previous.verifying === next.verifying;
  if (unchanged) return previous;
  previewInspectorSession.neuralLearningStatus = next;
  schedulePreviewInspectorNeuralLearningStatusRefresh();
  return next;
}

/** Marks a renderer-admitted learning task before its deferred verifier update starts. */
function beginPreviewInspectorNeuralLearningStatus(detail = {}) {
  const current = previewInspectorSession.neuralLearningStatus;
  previewInspectorSession.neuralLearningCompletionSequence =
    (Number.isSafeInteger(previewInspectorSession.neuralLearningCompletionSequence)
      ? previewInspectorSession.neuralLearningCompletionSequence
      : 0) + 1;
  if (
    previewInspectorSession.neuralLearningCompletionTimer !== undefined &&
    typeof globalThis.clearTimeout === 'function'
  ) {
    globalThis.clearTimeout(previewInspectorSession.neuralLearningCompletionTimer);
    previewInspectorSession.neuralLearningCompletionTimer = undefined;
  }
  const activeCount = Number.isSafeInteger(current?.activeCount) ? current.activeCount : 0;
  return setPreviewInspectorNeuralLearningStatus({
    activeCount: activeCount + 1,
    headKey: detail.headKey ?? current?.headKey,
    labelReason: detail.labelReason ?? current?.labelReason,
    phase: 'learning',
    startedAt: activeCount > 0 && Number.isFinite(current?.startedAt)
      ? current.startedAt
      : Date.now(),
    updates: readPreviewInspectorNeuralLearningModelUpdates(),
  });
}

/** Settles one active task after the existing verifier has accepted or rejected its update. */
function finishPreviewInspectorNeuralLearningStatus(detail = {}) {
  const current = previewInspectorSession.neuralLearningStatus;
  const activeCount = Math.max(
    0,
    (Number.isSafeInteger(current?.activeCount) ? current.activeCount : 0) - 1,
  );
  const learned = detail.success !== false &&
    detail.phase !== 'learning-bounded-without-promotion';
  const settled = {
    activeCount,
    headKey: detail.headKey ?? current?.headKey,
    labelReason: detail.labelReason ?? current?.labelReason,
    phase: learned ? 'learned' : 'paused',
    trainingExamples: detail.trainingExamples,
    updates: Number.isSafeInteger(detail.modelUpdates)
      ? detail.modelUpdates
      : Number.isSafeInteger(detail.updates)
        ? detail.updates
        : readPreviewInspectorNeuralLearningModelUpdates(),
  };
  if (activeCount > 0) {
    return setPreviewInspectorNeuralLearningStatus({
      ...settled,
      phase: 'learning',
      startedAt: current?.startedAt,
    });
  }
  const elapsed = Number.isFinite(current?.startedAt) ? Date.now() - current.startedAt : Infinity;
  const waitMs = PREVIEW_INSPECTOR_NEURAL_LEARNING_MIN_VISIBLE_MS - elapsed;
  if (waitMs > 0 && typeof globalThis.setTimeout === 'function') {
    const sequence = (Number.isSafeInteger(previewInspectorSession.neuralLearningCompletionSequence)
      ? previewInspectorSession.neuralLearningCompletionSequence
      : 0) + 1;
    previewInspectorSession.neuralLearningCompletionSequence = sequence;
    const learning = setPreviewInspectorNeuralLearningStatus({
      ...settled,
      phase: 'learning',
      startedAt: current.startedAt,
    });
    previewInspectorSession.neuralLearningCompletionTimer = globalThis.setTimeout(() => {
      if (previewInspectorSession.neuralLearningCompletionSequence !== sequence) return;
      previewInspectorSession.neuralLearningCompletionTimer = undefined;
      setPreviewInspectorNeuralLearningStatus(settled);
    }, waitMs);
    return learning;
  }
  return setPreviewInspectorNeuralLearningStatus(settled);
}

/** Mirrors verifier-owned training events that did not need an explicit deferred progress task. */
function syncPreviewInspectorNeuralLearningStatusFromHealth(event, detail = {}) {
  if (
    event !== 'neural-residual-trained' &&
    event !== 'neural-residual-corrected' &&
    event !== 'neural-residual-data-flow-trained'
  ) return;
  const current = previewInspectorSession.neuralLearningStatus;
  const activeCount = Number.isSafeInteger(current?.activeCount) ? current.activeCount : 0;
  const learned = detail.phase !== 'learning-bounded-without-promotion';
  setPreviewInspectorNeuralLearningStatus({
    activeCount,
    headKey: detail.headKey ?? current?.headKey,
    labelReason: detail.labelReason ?? current?.labelReason,
    phase: activeCount > 0 ? 'learning' : learned ? 'learned' : 'paused',
    startedAt: activeCount > 0 ? current?.startedAt : undefined,
    trainingExamples: detail.trainingExamples,
    updates: Number.isSafeInteger(detail.modelUpdates)
      ? detail.modelUpdates
      : Number.isSafeInteger(detail.updates)
        ? detail.updates
        : readPreviewInspectorNeuralLearningModelUpdates(),
  });
}

/** Returns current activity, or a compact learned summary for a restored persisted model. */
function readPreviewInspectorNeuralLearningStatus() {
  const current = previewInspectorSession.neuralLearningStatus;
  if (current?.revision === previewEntryRevision) return current;
  const updates = readPreviewInspectorNeuralLearningModelUpdates();
  return updates > 0
    ? Object.freeze({
        activeCount: 0,
        phase: 'learned',
        revision: previewEntryRevision,
        updates,
      })
    : undefined;
}
`;
}
