/**
 * Generates the local neural residual used only after deterministic blocker admission.
 *
 * The model is intentionally tiny: a deterministic hashed input projection feeds twelve tanh
 * units, while only the logistic output head learns. This keeps persisted state bounded to thirteen
 * numbers and makes an untrained model exactly neutral, preserving the existing resolver order.
 */

/** Creates browser source for bounded inference, verified online learning, and model persistence. */
export function createPreviewInspectorNeuralResidualRuntimeSource(): string {
  return String.raw`
const PREVIEW_INSPECTOR_NEURAL_RESIDUAL_VERSION = 1;
const PREVIEW_INSPECTOR_NEURAL_RESIDUAL_INPUT_SIZE = 48;
const PREVIEW_INSPECTOR_NEURAL_RESIDUAL_HIDDEN_SIZE = 12;
const PREVIEW_INSPECTOR_NEURAL_RESIDUAL_TOKEN_LIMIT = 48;
const PREVIEW_INSPECTOR_NEURAL_RESIDUAL_TEXT_LIMIT = 160;
const PREVIEW_INSPECTOR_NEURAL_RESIDUAL_LEARNING_RATE = 0.12;
const PREVIEW_INSPECTOR_NEURAL_RESIDUAL_L2 = 0.0005;
const PREVIEW_INSPECTOR_NEURAL_RESIDUAL_WEIGHT_LIMIT = 4;

/** Returns the neutral trainable head used before any verified local attempt has settled. */
function createPreviewInspectorNeuralResidualModel() {
  return {
    outputBias: 0,
    outputWeights: Array(PREVIEW_INSPECTOR_NEURAL_RESIDUAL_HIDDEN_SIZE).fill(0),
    updates: 0,
    version: PREVIEW_INSPECTOR_NEURAL_RESIDUAL_VERSION,
  };
}

/** Accepts only the exact current model shape; stale or malformed state starts neutral. */
function normalizePreviewInspectorNeuralResidualModel(value) {
  if (
    value?.version !== PREVIEW_INSPECTOR_NEURAL_RESIDUAL_VERSION ||
    !Array.isArray(value?.outputWeights) ||
    value.outputWeights.length !== PREVIEW_INSPECTOR_NEURAL_RESIDUAL_HIDDEN_SIZE ||
    !value.outputWeights.every((weight) => Number.isFinite(weight)) ||
    !Number.isFinite(value?.outputBias)
  ) return createPreviewInspectorNeuralResidualModel();
  return {
    outputBias: Math.max(
      -PREVIEW_INSPECTOR_NEURAL_RESIDUAL_WEIGHT_LIMIT,
      Math.min(PREVIEW_INSPECTOR_NEURAL_RESIDUAL_WEIGHT_LIMIT, value.outputBias),
    ),
    outputWeights: value.outputWeights.map((weight) => Math.max(
      -PREVIEW_INSPECTOR_NEURAL_RESIDUAL_WEIGHT_LIMIT,
      Math.min(PREVIEW_INSPECTOR_NEURAL_RESIDUAL_WEIGHT_LIMIT, weight),
    )),
    updates: Number.isSafeInteger(value?.updates) && value.updates >= 0 ? value.updates : 0,
    version: PREVIEW_INSPECTOR_NEURAL_RESIDUAL_VERSION,
  };
}

/** Lazily repairs hot-retained state without allowing project values into model parameters. */
function initializePreviewInspectorNeuralResidualModel() {
  const current = previewInspectorSession.neuralResidualModel;
  if (
    current?.version !== PREVIEW_INSPECTOR_NEURAL_RESIDUAL_VERSION ||
    !Array.isArray(current?.outputWeights) ||
    current.outputWeights.length !== PREVIEW_INSPECTOR_NEURAL_RESIDUAL_HIDDEN_SIZE
  ) {
    previewInspectorSession.neuralResidualModel =
      normalizePreviewInspectorNeuralResidualModel(current);
  }
  return previewInspectorSession.neuralResidualModel;
}

/** Serializes only the small learned head; source text and feature vectors are never persisted. */
function serializePreviewInspectorNeuralResidualModel() {
  const model = initializePreviewInspectorNeuralResidualModel();
  return {
    outputBias: model.outputBias,
    outputWeights: [...model.outputWeights],
    updates: model.updates,
    version: model.version,
  };
}

/** Produces one stable unsigned FNV-1a hash for a bounded semantic feature token. */
function hashPreviewInspectorNeuralResidualToken(value) {
  const text = String(value).slice(0, PREVIEW_INSPECTOR_NEURAL_RESIDUAL_TEXT_LIMIT);
  let hash = 2166136261;
  for (let index = 0; index < text.length; index += 1) {
    hash ^= text.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}

/** Adds a signed hashed feature twice so small lexical variations do not own one input cell. */
function addPreviewInspectorNeuralResidualFeature(vector, token, magnitude = 1) {
  if (typeof token !== 'string' || token.length === 0 || !Number.isFinite(magnitude)) return;
  const firstHash = hashPreviewInspectorNeuralResidualToken(token);
  const secondHash = Math.imul(firstHash ^ 0x9e3779b9, 2246822519) >>> 0;
  vector[firstHash % vector.length] += (firstHash & 1) === 0 ? magnitude : -magnitude;
  vector[secondHash % vector.length] += (secondHash & 1) === 0
    ? magnitude * 0.5
    : -magnitude * 0.5;
}

/** Converts a typed blocker hole into a bounded, normalized numeric feature vector. */
function encodePreviewInspectorNeuralResidualFeatures(specification = {}) {
  const vector = Array(PREVIEW_INSPECTOR_NEURAL_RESIDUAL_INPUT_SIZE).fill(0);
  const tokens = [
    'bias',
    'hole:' + String(specification?.holeKind ?? 'unknown'),
    'blocker:' + String(specification?.blockerKind ?? 'unknown'),
    ...(Array.isArray(specification?.tokens) ? specification.tokens : []),
  ].filter((value) => typeof value === 'string' && value.length > 0)
    .slice(0, PREVIEW_INSPECTOR_NEURAL_RESIDUAL_TOKEN_LIMIT);
  for (const token of tokens) addPreviewInspectorNeuralResidualFeature(vector, token);
  const texts = Array.isArray(specification?.texts) ? specification.texts.slice(0, 8) : [];
  let lexicalCount = 0;
  for (const text of texts) {
    if (typeof text !== 'string') continue;
    for (const word of text.toLowerCase().match(/[a-z0-9_$-]+/gu) ?? []) {
      if (lexicalCount >= 24) break;
      addPreviewInspectorNeuralResidualFeature(vector, 'lex:' + word.slice(0, 64), 0.65);
      lexicalCount += 1;
    }
  }
  const numbers = specification?.numbers;
  if (numbers !== null && typeof numbers === 'object' && !Array.isArray(numbers)) {
    for (const [name, rawValue] of Object.entries(numbers).slice(0, 16)) {
      if (!Number.isFinite(rawValue)) continue;
      addPreviewInspectorNeuralResidualFeature(
        vector,
        'number:' + name,
        Math.tanh(Number(rawValue)),
      );
    }
  }
  const norm = Math.sqrt(vector.reduce((sum, value) => sum + value * value, 0));
  return norm > 0 ? vector.map((value) => value / norm) : vector;
}

/** Returns one deterministic fixed projection weight without retaining a dense input matrix. */
function readPreviewInspectorNeuralResidualProjectionWeight(hiddenIndex, inputIndex) {
  const mixed = (
    Math.imul(hiddenIndex + 1, 0x45d9f3b) ^
    Math.imul(inputIndex + 3, 0x27d4eb2d)
  ) >>> 0;
  return (((mixed % 2001) / 1000) - 1) * 0.34;
}

/** Runs the fixed nonlinear projection and the locally learned logistic output head. */
function runPreviewInspectorNeuralResidualModel(vector) {
  const model = initializePreviewInspectorNeuralResidualModel();
  const hidden = Array(PREVIEW_INSPECTOR_NEURAL_RESIDUAL_HIDDEN_SIZE).fill(0);
  for (let hiddenIndex = 0; hiddenIndex < hidden.length; hiddenIndex += 1) {
    let activation = ((hiddenIndex % 3) - 1) * 0.025;
    for (let inputIndex = 0; inputIndex < vector.length; inputIndex += 1) {
      activation += vector[inputIndex] * readPreviewInspectorNeuralResidualProjectionWeight(
        hiddenIndex,
        inputIndex,
      );
    }
    hidden[hiddenIndex] = Math.tanh(activation);
  }
  let logit = model.outputBias;
  for (let index = 0; index < hidden.length; index += 1) {
    logit += hidden[index] * model.outputWeights[index];
  }
  const boundedLogit = Math.max(-20, Math.min(20, logit));
  return { hidden, score: 1 / (1 + Math.exp(-boundedLogit)) };
}

/** Creates the opaque numeric residual attached to one deterministically admitted candidate. */
function createPreviewInspectorNeuralResidualDecision(specification) {
  const featureVector = encodePreviewInspectorNeuralResidualFeatures(specification);
  const inference = runPreviewInspectorNeuralResidualModel(featureVector);
  return {
    featureVector,
    holeKind: String(specification?.holeKind ?? 'unknown').slice(0, 80),
    modelUpdates: initializePreviewInspectorNeuralResidualModel().updates,
    score: inference.score,
    version: PREVIEW_INSPECTOR_NEURAL_RESIDUAL_VERSION,
  };
}

/** Copies only a current bounded decision before it enters an asynchronous render attempt. */
function copyPreviewInspectorNeuralResidualDecision(value) {
  if (
    value?.version !== PREVIEW_INSPECTOR_NEURAL_RESIDUAL_VERSION ||
    !Array.isArray(value?.featureVector) ||
    value.featureVector.length !== PREVIEW_INSPECTOR_NEURAL_RESIDUAL_INPUT_SIZE ||
    !value.featureVector.every((feature) => Number.isFinite(feature) && Math.abs(feature) <= 1) ||
    !Number.isFinite(value?.score)
  ) return undefined;
  return {
    featureVector: [...value.featureVector],
    holeKind: String(value?.holeKind ?? 'unknown').slice(0, 80),
    modelUpdates: Number.isSafeInteger(value?.modelUpdates) ? value.modelUpdates : 0,
    score: Math.max(0, Math.min(1, value.score)),
    version: PREVIEW_INSPECTOR_NEURAL_RESIDUAL_VERSION,
  };
}

/** Supplies Array.sort with a neutral-safe score comparison. */
function comparePreviewInspectorNeuralResidualDecisions(left, right) {
  const leftDecision = copyPreviewInspectorNeuralResidualDecision(left);
  const rightDecision = copyPreviewInspectorNeuralResidualDecision(right);
  if (leftDecision === undefined || rightDecision === undefined) return 0;
  const difference = rightDecision.score - leftDecision.score;
  return Math.abs(difference) > 0.000001 ? difference : 0;
}

/** Produces bounded diagnostics without exposing the learned vector. */
function summarizePreviewInspectorNeuralResidualDecision(value) {
  const decision = copyPreviewInspectorNeuralResidualDecision(value);
  return decision === undefined
    ? undefined
    : {
        holeKind: decision.holeKind,
        modelUpdates: decision.modelUpdates,
        score: Number(decision.score.toFixed(6)),
        version: decision.version,
      };
}

/** Applies one soft-label SGD update to the output head and persists only verified learning. */
function trainPreviewInspectorNeuralResidualDecision(value, label) {
  const decision = copyPreviewInspectorNeuralResidualDecision(value);
  if (decision === undefined || !Number.isFinite(label) || label < 0 || label > 1) {
    return undefined;
  }
  const model = initializePreviewInspectorNeuralResidualModel();
  const inference = runPreviewInspectorNeuralResidualModel(decision.featureVector);
  const error = inference.score - label;
  for (let index = 0; index < model.outputWeights.length; index += 1) {
    const weight = model.outputWeights[index];
    const gradient = error * inference.hidden[index] + PREVIEW_INSPECTOR_NEURAL_RESIDUAL_L2 * weight;
    model.outputWeights[index] = Math.max(
      -PREVIEW_INSPECTOR_NEURAL_RESIDUAL_WEIGHT_LIMIT,
      Math.min(
        PREVIEW_INSPECTOR_NEURAL_RESIDUAL_WEIGHT_LIMIT,
        weight - PREVIEW_INSPECTOR_NEURAL_RESIDUAL_LEARNING_RATE * gradient,
      ),
    );
  }
  model.outputBias = Math.max(
    -PREVIEW_INSPECTOR_NEURAL_RESIDUAL_WEIGHT_LIMIT,
    Math.min(
      PREVIEW_INSPECTOR_NEURAL_RESIDUAL_WEIGHT_LIMIT,
      model.outputBias - PREVIEW_INSPECTOR_NEURAL_RESIDUAL_LEARNING_RATE * error,
    ),
  );
  model.updates = Math.min(Number.MAX_SAFE_INTEGER, model.updates + 1);
  if (typeof persistPreviewInspectorState === 'function') persistPreviewInspectorState();
  return { label, prediction: inference.score, updates: model.updates };
}

/** Converts only objectively settled target/blocker evidence into an online learning label. */
function readPreviewInspectorNeuralResidualAttemptLabel(attempt, result) {
  if (result?.outcome === 'rolled-back') return 0;
  if (result?.outcome === 'superseded') return undefined;
  const state = typeof attempt?.targetReachabilityKey === 'string'
    ? previewInspectorSession.targetReachabilityByKey?.get?.(attempt.targetReachabilityKey)
    : undefined;
  if (state?.targetHasOutput === true || state?.status === 'reached') return 1;
  if (Array.isArray(result?.resolvedBlockerIds) && result.resolvedBlockerIds.length > 0) return 0.9;
  const revealedEvidence = [result?.changedBlockerIds, result?.discoveredBlockerIds]
    .some((ids) => Array.isArray(ids) && ids.length > 0);
  if (revealedEvidence) return 0.65;
  return result?.outcome === 'committed' ? 0 : undefined;
}

/** Learns after the ordinary verifier settles; the model never declares an attempt successful. */
function observePreviewInspectorNeuralResidualAttempt(attempt, result) {
  const label = readPreviewInspectorNeuralResidualAttemptLabel(attempt, result);
  if (label === undefined) return undefined;
  const update = trainPreviewInspectorNeuralResidualDecision(
    attempt?.neuralResidualDecision,
    label,
  );
  if (update !== undefined && typeof recordPreviewInspectorRuntimeHealth === 'function') {
    recordPreviewInspectorRuntimeHealth({
      category: 'neural-residual',
      detail: {
        holeKind: attempt.neuralResidualDecision.holeKind,
        label: update.label,
        prediction: update.prediction,
        traceId: attempt.traceId,
        updates: update.updates,
      },
      event: 'neural-residual-trained',
    });
  }
  return update;
}
`;
}
