/** Generates the bounded browser-side neural model schema, migration, and persistence helpers. */

/** Creates model state source shared by inference and cross-panel synchronization. */
export function createPreviewInspectorNeuralModelRuntimeSource(): string {
  return String.raw`
const PREVIEW_INSPECTOR_NEURAL_RESIDUAL_VERSION = 4;
const PREVIEW_INSPECTOR_NEURAL_RESIDUAL_LEGACY_VERSION = 3;
const PREVIEW_INSPECTOR_NEURAL_RESIDUAL_HIDDEN_SIZE = 16;
const PREVIEW_INSPECTOR_NEURAL_RESIDUAL_WEIGHT_LIMIT = 4;
const PREVIEW_INSPECTOR_NEURAL_RESIDUAL_OUTCOME_LIMIT = 192;
const PREVIEW_INSPECTOR_NEURAL_RESIDUAL_HEAD_KEYS = Object.freeze([
  'blocker-exception',
  'condition',
  'data-collection',
  'page-choice',
  'rendered-empty',
  'render-state',
  'unrendered',
  'general',
]);

/** Maps fine-grained hole names to independent trainable heads with bounded persisted keys. */
function readPreviewInspectorNeuralResidualHeadKey(holeKind) {
  const value = String(holeKind ?? 'unknown').toLowerCase();
  if (value.includes('blocker-exception')) return 'blocker-exception';
  if (value.includes('page-choice')) return 'page-choice';
  if (value.includes('render-state')) return 'render-state';
  if (value.includes('unrendered')) return 'unrendered';
  if (value.includes('rendered-without-output')) return 'rendered-empty';
  if (value.includes('collection') || value.includes('table') || value.includes('data')) {
    return 'data-collection';
  }
  if (value.includes('condition') || value.includes('gate')) return 'condition';
  return 'general';
}

/** Returns one neutral head used before its blocker-hole family has verified outcomes. */
function createPreviewInspectorNeuralResidualHead() {
  return {
    evidence: 0,
    outputBias: 0,
    outputWeights: Array(PREVIEW_INSPECTOR_NEURAL_RESIDUAL_HIDDEN_SIZE).fill(0),
    updates: 0,
  };
}

/** Returns the bounded multi-head model; heads are allocated only after verified learning. */
function createPreviewInspectorNeuralResidualModel() {
  return {
    candidateOutcomes: {},
    heads: {},
    outcomeSequence: 0,
    updates: 0,
    version: PREVIEW_INSPECTOR_NEURAL_RESIDUAL_VERSION,
  };
}

/** Accepts one exact finite head and drops malformed persisted weights. */
function normalizePreviewInspectorNeuralResidualHead(value, legacy = false) {
  if (
    !Array.isArray(value?.outputWeights) ||
    value.outputWeights.length !== PREVIEW_INSPECTOR_NEURAL_RESIDUAL_HIDDEN_SIZE ||
    !value.outputWeights.every((weight) => Number.isFinite(weight)) ||
    !Number.isFinite(value?.outputBias) ||
    !Number.isSafeInteger(value?.updates) || value.updates < 0 ||
    !legacy && (
      !Number.isFinite(value?.evidence) || value.evidence < 0 ||
      value.evidence > value.updates
    )
  ) return undefined;
  return {
    evidence: legacy ? 0 : value.evidence,
    outputBias: Math.max(
      -PREVIEW_INSPECTOR_NEURAL_RESIDUAL_WEIGHT_LIMIT,
      Math.min(PREVIEW_INSPECTOR_NEURAL_RESIDUAL_WEIGHT_LIMIT, value.outputBias),
    ),
    outputWeights: value.outputWeights.map((weight) => Math.max(
      -PREVIEW_INSPECTOR_NEURAL_RESIDUAL_WEIGHT_LIMIT,
      Math.min(PREVIEW_INSPECTOR_NEURAL_RESIDUAL_WEIGHT_LIMIT, weight),
    )),
    updates: value.updates,
  };
}

/** Accepts one anonymous candidate outcome without retaining its original candidate identifier. */
function normalizePreviewInspectorNeuralResidualOutcome(value, legacy = false) {
  if (
    !Number.isSafeInteger(value?.attempts) || value.attempts < 1 ||
    !Number.isSafeInteger(value?.consecutiveFailures) || value.consecutiveFailures < 0 ||
    value.consecutiveFailures > value.attempts ||
    !Number.isFinite(value?.lastLabel) || value.lastLabel < 0 || value.lastLabel > 1 ||
    !Number.isFinite(value?.rewardSum) || value.rewardSum < 0 ||
    value.rewardSum > value.attempts ||
    !Number.isSafeInteger(value?.sequence) || value.sequence < 1
  ) return undefined;
  if (legacy) {
    const evidence = readPreviewInspectorLegacyOutcomeEvidence(value.attempts);
    return {
      attempts: value.attempts,
      consecutiveFailures: value.consecutiveFailures,
      evidence,
      lastConfidence: value.attempts === 1 ? 0.35 : 0.85,
      lastLabel: value.lastLabel,
      rewardSum: value.rewardSum / value.attempts * evidence,
      sequence: value.sequence,
    };
  }
  if (
    !Number.isFinite(value?.evidence) || value.evidence <= 0 ||
    value.evidence > value.attempts ||
    !Number.isFinite(value?.lastConfidence) || value.lastConfidence <= 0 ||
    value.lastConfidence > 1 || value.rewardSum > value.evidence
  ) return undefined;
  return {
    attempts: value.attempts,
    consecutiveFailures: value.consecutiveFailures,
    evidence: value.evidence,
    lastConfidence: value.lastConfidence,
    lastLabel: value.lastLabel,
    rewardSum: value.rewardSum,
    sequence: value.sequence,
  };
}

/** Discounts singleton legacy results while repeated verification accumulates authority. */
function readPreviewInspectorLegacyOutcomeEvidence(attempts) {
  return attempts === 1 ? 0.35 : Math.min(attempts, 0.35 + (attempts - 1) * 0.85);
}

/** Removes singleton-heavy legacy bias without deleting exact per-candidate failure memory. */
function refinePreviewInspectorLegacyNeuralResidualHead(headKey, head, outcomes) {
  const familyOutcomes = Object.entries(outcomes)
    .filter(([key]) => key.startsWith(headKey + ':'))
    .map((entry) => entry[1]);
  const outcomeAttempts = familyOutcomes.reduce((sum, outcome) => sum + outcome.attempts, 0);
  const singletonAttempts = familyOutcomes.reduce(
    (sum, outcome) => sum + (outcome.attempts === 1 ? 1 : 0),
    0,
  );
  const coverage = head.updates === 0 ? 0 : Math.min(1, outcomeAttempts / head.updates);
  const singletonShare = outcomeAttempts === 0 ? 0 : singletonAttempts / outcomeAttempts;
  const retention = Math.max(0.4, 1 - 0.65 * coverage * singletonShare);
  const outcomeEvidence = familyOutcomes.reduce((sum, outcome) => sum + outcome.evidence, 0);
  const untrackedUpdates = Math.max(0, head.updates - outcomeAttempts);
  return {
    evidence: Math.min(head.updates, outcomeEvidence + untrackedUpdates * 0.65),
    outputBias: head.outputBias * retention,
    outputWeights: head.outputWeights.map((weight) => weight * retention),
    updates: head.updates,
  };
}

/** Reports whether one persisted key contains only a head family and an opaque 32-bit hash. */
function isPreviewInspectorNeuralResidualOutcomeKey(value) {
  if (typeof value !== 'string') return false;
  const separator = value.lastIndexOf(':');
  return separator > 0 && PREVIEW_INSPECTOR_NEURAL_RESIDUAL_HEAD_KEYS.includes(
    value.slice(0, separator),
  ) && /^[a-f0-9]{8}$/u.test(value.slice(separator + 1));
}

/** Accepts current heads while refining legacy version-three learning exactly once. */
function normalizePreviewInspectorNeuralResidualModel(value) {
  if (
    ![
      PREVIEW_INSPECTOR_NEURAL_RESIDUAL_LEGACY_VERSION,
      PREVIEW_INSPECTOR_NEURAL_RESIDUAL_VERSION,
    ].includes(value?.version) ||
    value?.heads === null || typeof value?.heads !== 'object' || Array.isArray(value.heads)
  ) return createPreviewInspectorNeuralResidualModel();
  const legacy = value.version === PREVIEW_INSPECTOR_NEURAL_RESIDUAL_LEGACY_VERSION;
  const candidateOutcomes = {};
  const normalizedOutcomes = value.candidateOutcomes !== null &&
    typeof value.candidateOutcomes === 'object' && !Array.isArray(value.candidateOutcomes)
    ? Object.entries(value.candidateOutcomes)
        .filter(([key]) => isPreviewInspectorNeuralResidualOutcomeKey(key))
        .map(([key, outcome]) => [
          key,
          normalizePreviewInspectorNeuralResidualOutcome(outcome, legacy),
        ])
        .filter((entry) => entry[1] !== undefined)
        .sort((left, right) => right[1].sequence - left[1].sequence)
        .slice(0, PREVIEW_INSPECTOR_NEURAL_RESIDUAL_OUTCOME_LIMIT)
    : [];
  let outcomeSequence = 0;
  for (const [key, outcome] of normalizedOutcomes) {
    candidateOutcomes[key] = outcome;
    outcomeSequence = Math.max(outcomeSequence, outcome.sequence);
  }
  const heads = {};
  let updates = 0;
  for (const headKey of PREVIEW_INSPECTOR_NEURAL_RESIDUAL_HEAD_KEYS) {
    const head = normalizePreviewInspectorNeuralResidualHead(value.heads[headKey], legacy);
    if (head !== undefined) {
      heads[headKey] = legacy
        ? refinePreviewInspectorLegacyNeuralResidualHead(headKey, head, candidateOutcomes)
        : head;
      updates = Math.min(Number.MAX_SAFE_INTEGER, updates + head.updates);
    }
  }
  return {
    candidateOutcomes,
    heads,
    outcomeSequence: Math.max(
      outcomeSequence,
      Number.isSafeInteger(value.outcomeSequence) && value.outcomeSequence >= 0
        ? value.outcomeSequence
        : 0,
    ),
    updates,
    version: PREVIEW_INSPECTOR_NEURAL_RESIDUAL_VERSION,
  };
}

/** Lazily repairs hot-retained state without allowing project values into model parameters. */
function initializePreviewInspectorNeuralResidualModel() {
  const current = previewInspectorSession.neuralResidualModel;
  if (
    current?.version !== PREVIEW_INSPECTOR_NEURAL_RESIDUAL_VERSION ||
    current?.heads === null || typeof current?.heads !== 'object' || Array.isArray(current.heads) ||
    current?.candidateOutcomes === null || typeof current?.candidateOutcomes !== 'object' ||
    Array.isArray(current.candidateOutcomes) ||
    !Number.isSafeInteger(current?.outcomeSequence) || current.outcomeSequence < 0 ||
    !Number.isSafeInteger(current?.updates) || current.updates < 0 ||
    Object.entries(current.heads).some(([headKey, head]) =>
      !PREVIEW_INSPECTOR_NEURAL_RESIDUAL_HEAD_KEYS.includes(headKey) ||
      normalizePreviewInspectorNeuralResidualHead(head) === undefined,
    ) || Object.entries(current.candidateOutcomes ?? {}).some(([key, outcome]) =>
      !isPreviewInspectorNeuralResidualOutcomeKey(key) ||
      normalizePreviewInspectorNeuralResidualOutcome(outcome) === undefined,
    )
  ) {
    previewInspectorSession.neuralResidualModel =
      normalizePreviewInspectorNeuralResidualModel(current);
  }
  return previewInspectorSession.neuralResidualModel;
}

/** Reads one family head without allocating it during inference. */
function readPreviewInspectorNeuralResidualHead(model, holeKind, create = false) {
  const headKey = readPreviewInspectorNeuralResidualHeadKey(holeKind);
  let head = model.heads[headKey];
  if (head === undefined && create) {
    head = createPreviewInspectorNeuralResidualHead();
    model.heads[headKey] = head;
  }
  return { head, headKey };
}

/** Serializes finite heads and anonymous outcome counters; source text and vectors never persist. */
function serializePreviewInspectorNeuralResidualModel() {
  const model = initializePreviewInspectorNeuralResidualModel();
  const heads = {};
  for (const headKey of PREVIEW_INSPECTOR_NEURAL_RESIDUAL_HEAD_KEYS) {
    const head = normalizePreviewInspectorNeuralResidualHead(model.heads[headKey]);
    if (head !== undefined) heads[headKey] = head;
  }
  const candidateOutcomes = {};
  for (const [key, value] of Object.entries(model.candidateOutcomes)
    .sort((left, right) => right[1].sequence - left[1].sequence)
    .slice(0, PREVIEW_INSPECTOR_NEURAL_RESIDUAL_OUTCOME_LIMIT)) {
    const outcome = normalizePreviewInspectorNeuralResidualOutcome(value);
    if (isPreviewInspectorNeuralResidualOutcomeKey(key) && outcome !== undefined) {
      candidateOutcomes[key] = outcome;
    }
  }
  return {
    candidateOutcomes,
    heads,
    outcomeSequence: model.outcomeSequence,
    updates: model.updates,
    version: model.version,
  };
}
`;
}
