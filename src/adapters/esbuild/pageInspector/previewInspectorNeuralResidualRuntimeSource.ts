/**
 * Generates the local neural residual used only after deterministic blocker admission.
 *
 * The model is intentionally tiny: a deterministic hashed input projection feeds isolated logistic
 * heads for each blocker-hole family. This prevents an unrendered failure from poisoning exception
 * repair or table-data recommendations while keeping an untrained head exactly neutral.
 */
import { createPreviewInspectorNeuralModelRuntimeSource } from './previewInspectorNeuralModelRuntimeSource';

/** Creates browser source for bounded inference, verified online learning, and model persistence. */
export function createPreviewInspectorNeuralResidualRuntimeSource(): string {
  return String.raw`
${createPreviewInspectorNeuralModelRuntimeSource()}
const PREVIEW_INSPECTOR_NEURAL_RESIDUAL_INPUT_SIZE = 64;
const PREVIEW_INSPECTOR_NEURAL_RESIDUAL_TOKEN_LIMIT = 64;
const PREVIEW_INSPECTOR_NEURAL_RESIDUAL_TEXT_LIMIT = 192;
const PREVIEW_INSPECTOR_NEURAL_RESIDUAL_LEARNING_RATE = 0.1;
const PREVIEW_INSPECTOR_NEURAL_RESIDUAL_L2 = 0.0005;
const PREVIEW_INSPECTOR_NEURAL_RESIDUAL_SELECTION_MIN_EVIDENCE = 1;
const PREVIEW_INSPECTOR_NEURAL_RESIDUAL_SELECTION_MARGIN = 0.003;
const PREVIEW_INSPECTOR_NEURAL_RESIDUAL_BRANCH_LEASE_LIMIT = 96;
const PREVIEW_INSPECTOR_NEURAL_RESIDUAL_FAILURE_LABEL_MAX = 0.2;
const PREVIEW_INSPECTOR_NEURAL_RESIDUAL_SUCCESS_LABEL_MIN = 0.65;
const PREVIEW_INSPECTOR_NEURAL_RESIDUAL_VERIFY_INTERVAL_MS = 160;
const PREVIEW_INSPECTOR_NEURAL_RESIDUAL_VERIFY_LIMIT_MS = 960;
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

/** Creates a stable anonymous lookup key for a reusable strategy inside one isolated head. */
function createPreviewInspectorNeuralResidualOutcomeKey(headKey, candidateId) {
  if (
    !PREVIEW_INSPECTOR_NEURAL_RESIDUAL_HEAD_KEYS.includes(headKey) ||
    typeof candidateId !== 'string' || candidateId.length === 0
  ) return undefined;
  return headKey + ':' + hashPreviewInspectorNeuralResidualToken(
    'candidate-outcome:' + candidateId.slice(0, 120),
  ).toString(16).padStart(8, '0');
}

/** Reads prior verified outcomes for one candidate without allocating memory during inference. */
function readPreviewInspectorNeuralResidualOutcome(model, headKey, candidateId) {
  const key = createPreviewInspectorNeuralResidualOutcomeKey(headKey, candidateId);
  return key === undefined ? undefined : model.candidateOutcomes[key];
}

/** Blends generalization with empirical success and strongly discounts repeated failed directions. */
function scorePreviewInspectorNeuralResidualSelection(score, outcome) {
  if (outcome === undefined) return score;
  const empiricalScore = (outcome.rewardSum + 1) / (outcome.evidence + 2);
  const evidenceWeight = Math.min(0.78, outcome.evidence / (outcome.evidence + 3));
  const failurePenalty = Math.min(0.28, outcome.consecutiveFailures * 0.055);
  const successMomentum = outcome.lastLabel >= PREVIEW_INSPECTOR_NEURAL_RESIDUAL_SUCCESS_LABEL_MIN
    ? Math.min(0.04, outcome.lastLabel * outcome.lastConfidence * 0.04)
    : 0;
  return Math.max(0, Math.min(
    1,
    score * (1 - evidenceWeight) + empiricalScore * evidenceWeight - failurePenalty +
      successMomentum,
  ));
}

/** Retains one verifier label and evicts the least-recent anonymous candidate when bounded. */
function recordPreviewInspectorNeuralResidualOutcome(model, decision, label, confidence) {
  const key = createPreviewInspectorNeuralResidualOutcomeKey(
    decision.headKey,
    decision.candidateId,
  );
  if (key === undefined) return undefined;
  const previous = normalizePreviewInspectorNeuralResidualOutcome(model.candidateOutcomes[key]);
  model.outcomeSequence = Math.min(Number.MAX_SAFE_INTEGER, model.outcomeSequence + 1);
  const attempts = Math.min(Number.MAX_SAFE_INTEGER, (previous?.attempts ?? 0) + 1);
  const consecutiveFailures = label <= PREVIEW_INSPECTOR_NEURAL_RESIDUAL_FAILURE_LABEL_MAX
    ? Math.min(attempts, (previous?.consecutiveFailures ?? 0) + 1)
    : label >= PREVIEW_INSPECTOR_NEURAL_RESIDUAL_SUCCESS_LABEL_MIN
      ? 0
      : previous?.consecutiveFailures ?? 0;
  const outcome = {
    attempts,
    consecutiveFailures,
    evidence: Math.min(attempts, (previous?.evidence ?? 0) + confidence),
    lastConfidence: confidence,
    lastLabel: label,
    rewardSum: Math.min(
      attempts,
      (previous?.rewardSum ?? 0) + label * confidence,
    ),
    sequence: model.outcomeSequence,
  };
  model.candidateOutcomes[key] = outcome;
  const entries = Object.entries(model.candidateOutcomes);
  if (entries.length > PREVIEW_INSPECTOR_NEURAL_RESIDUAL_OUTCOME_LIMIT) {
    entries.sort((left, right) => left[1].sequence - right[1].sequence);
    for (const [staleKey] of entries.slice(
      0,
      entries.length - PREVIEW_INSPECTOR_NEURAL_RESIDUAL_OUTCOME_LIMIT,
    )) delete model.candidateOutcomes[staleKey];
  }
  return outcome;
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

/** Runs the fixed nonlinear projection and the isolated head for this blocker-hole family. */
function runPreviewInspectorNeuralResidualModel(vector, holeKind) {
  const model = initializePreviewInspectorNeuralResidualModel();
  const selectedHead = readPreviewInspectorNeuralResidualHead(model, holeKind);
  const head = selectedHead.head ?? createPreviewInspectorNeuralResidualHead();
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
  let logit = head.outputBias;
  for (let index = 0; index < hidden.length; index += 1) {
    logit += hidden[index] * head.outputWeights[index];
  }
  const boundedLogit = Math.max(-20, Math.min(20, logit));
  return {
    headEvidence: head.evidence,
    headKey: selectedHead.headKey,
    headUpdates: head.updates,
    hidden,
    score: 1 / (1 + Math.exp(-boundedLogit)),
  };
}

/** Creates the opaque numeric residual attached to one deterministically admitted candidate. */
function createPreviewInspectorNeuralResidualDecision(specification) {
  const holeKind = String(specification?.holeKind ?? 'unknown').slice(0, 80);
  const featureVector = encodePreviewInspectorNeuralResidualFeatures(specification);
  const inference = runPreviewInspectorNeuralResidualModel(featureVector, holeKind);
  const model = initializePreviewInspectorNeuralResidualModel();
  const candidateId = typeof specification?.candidateId === 'string' &&
    specification.candidateId.length > 0
    ? specification.candidateId.slice(0, 120)
    : undefined;
  const outcome = readPreviewInspectorNeuralResidualOutcome(
    model,
    inference.headKey,
    candidateId,
  );
  return {
    blockerKind: String(specification?.blockerKind ?? 'unknown').slice(0, 80),
    ...(candidateId === undefined ? {} : { candidateId }),
    consecutiveFailures: outcome?.consecutiveFailures ?? 0,
    featureVector,
    headEvidence: inference.headEvidence,
    headKey: inference.headKey,
    headUpdates: inference.headUpdates,
    holeKind,
    modelUpdates: model.updates,
    outcomeAttempts: outcome?.attempts ?? 0,
    score: inference.score,
    selectionScore: scorePreviewInspectorNeuralResidualSelection(inference.score, outcome),
    version: PREVIEW_INSPECTOR_NEURAL_RESIDUAL_VERSION,
  };
}

/** Reads the bounded portfolio policy attached to the active minimum-requirement search. */
function readPreviewInspectorNeuralResidualExplorationPolicy() {
  const directPolicy = previewInspectorSession.neuralAssistanceExplorationPolicy;
  if (
    ['automatic-neural', 'user-neural'].includes(directPolicy?.origin) &&
    typeof directPolicy?.mode === 'string'
  ) {
    return {
      excludedCandidateIds: new Set(
        Array.isArray(directPolicy.excludedCandidateIds)
          ? directPolicy.excludedCandidateIds.slice(0, 12)
          : [],
      ),
      mode: directPolicy.mode,
      ordinal: Number.isSafeInteger(directPolicy.ordinal)
        ? Math.max(1, directPolicy.ordinal)
        : 1,
    };
  }
  const reachabilityKey = previewInspectorSession.activeTargetReachabilityKey;
  const search = typeof reachabilityKey === 'string'
    ? previewInspectorSession.minimumRequirementSearchByKey?.get?.(reachabilityKey)
    : undefined;
  if (
    !['automatic-neural', 'user-neural'].includes(search?.origin) ||
    typeof search?.explorationMode !== 'string'
  ) return undefined;
  return {
    excludedCandidateIds: new Set(
      Array.isArray(search.excludedCandidateIds) ? search.excludedCandidateIds.slice(0, 12) : [],
    ),
    mode: search.explorationMode,
    ordinal: Number.isSafeInteger(search.explorationOrdinal)
      ? Math.max(1, search.explorationOrdinal)
      : 1,
  };
}

/** Keeps one admitted branch stable until verifier-owned evidence rejects that exact direction. */
function initializePreviewInspectorNeuralResidualBranchLeases() {
  if (!(previewInspectorSession.neuralResidualBranchLeases instanceof Map)) {
    previewInspectorSession.neuralResidualBranchLeases = new Map();
  }
  while (previewInspectorSession.neuralResidualBranchLeases.size > PREVIEW_INSPECTOR_NEURAL_RESIDUAL_BRANCH_LEASE_LIMIT) {
    previewInspectorSession.neuralResidualBranchLeases.delete(previewInspectorSession.neuralResidualBranchLeases.keys().next().value);
  }
  return previewInspectorSession.neuralResidualBranchLeases;
}

/** Creates an anonymous revision-local identity for one semantic decision point. */
function createPreviewInspectorNeuralResidualBranchLeaseKey(specification) {
  const featureFingerprint = encodePreviewInspectorNeuralResidualFeatures(specification).map((value) => Math.round(value * 10_000)).join(',');
  return [
    typeof previewEntryRevision === 'number' ? previewEntryRevision : 0,
    previewInspectorSession.activeTargetReachabilityKey ?? '',
    previewInspectorSession.selectedPageCandidateId ?? '',
    previewInspectorSession.selectedExportName ?? '',
    readPreviewInspectorNeuralResidualHeadKey(specification?.holeKind),
    hashPreviewInspectorNeuralResidualToken(featureFingerprint).toString(16),
  ].join(':');
}

/**
 * Ranks only caller-admitted typed values and returns the winning opaque residual decision.
 *
 * The model never materializes project data. Callers retain the candidate values and supply only
 * bounded semantic features plus a deterministic safety rank. A neutral model therefore selects
 * the safest existing candidate, while verified local learning can reorder equally admitted holes.
 */
function selectPreviewInspectorNeuralResidualCandidate(specification, rawCandidates) {
  const exploration = readPreviewInspectorNeuralResidualExplorationPolicy();
  const candidates = (Array.isArray(rawCandidates) ? rawCandidates : [])
    .filter((candidate) =>
      candidate !== null && typeof candidate === 'object' &&
      typeof candidate.id === 'string' && candidate.id.length > 0,
    )
    .slice(0, 12)
    .map((candidate, index) => {
      const deterministicRank = Number.isFinite(candidate.deterministicRank)
        ? Number(candidate.deterministicRank)
        : index;
      const decision = createPreviewInspectorNeuralResidualDecision({
        blockerKind: specification?.blockerKind,
        candidateId: candidate.id,
        holeKind: specification?.holeKind,
        numbers: {
          ...(specification?.numbers ?? {}),
          ...(candidate?.numbers ?? {}),
          deterministicRank,
        },
        texts: [
          ...(Array.isArray(specification?.texts) ? specification.texts : []),
          ...(Array.isArray(candidate?.texts) ? candidate.texts : []),
        ],
        tokens: [
          ...(Array.isArray(specification?.tokens) ? specification.tokens : []),
          ...(Array.isArray(candidate?.tokens) ? candidate.tokens : []),
          'candidate:' + candidate.id,
        ],
      });
      return {
        candidateId: candidate.id.slice(0, 120),
        decision,
        deterministicRank,
      };
    });
  candidates.sort((left, right) =>
    comparePreviewInspectorNeuralResidualDecisions(left.decision, right.decision) ||
    left.deterministicRank - right.deterministicRank ||
    left.candidateId.localeCompare(right.candidateId),
  );
  const novelCandidates = exploration === undefined
    ? candidates
    : candidates.filter((candidate) =>
        !exploration.excludedCandidateIds.has(candidate.candidateId),
      );
  const selectionPool = novelCandidates.length > 0 ? novelCandidates : candidates;
  const leases = initializePreviewInspectorNeuralResidualBranchLeases();
  const leaseKey = createPreviewInspectorNeuralResidualBranchLeaseKey(specification);
  const leasedCandidateId = leases.get(leaseKey);
  const leasedCandidate = selectionPool.find((candidate) =>
    candidate.candidateId === leasedCandidateId &&
    candidate.decision.consecutiveFailures === 0,
  );
  const candidatesWithoutVerifiedFailure = selectionPool.filter((candidate) =>
    candidate.decision.consecutiveFailures === 0,
  );
  const selected = leasedCandidate ??
    (candidatesWithoutVerifiedFailure.length > 0
      ? candidatesWithoutVerifiedFailure[0]
      : selectionPool[0]);
  if (selected === undefined) return undefined;
  leases.delete(leaseKey);
  leases.set(leaseKey, selected.candidateId);
  while (leases.size > PREVIEW_INSPECTOR_NEURAL_RESIDUAL_BRANCH_LEASE_LIMIT) leases.delete(leases.keys().next().value);
  const runnerUp = selectionPool.find((candidate) => candidate !== selected);
  return {
    ...selected,
    branchRetained: leasedCandidate !== undefined,
    candidateCount: candidates.length,
    scoreMargin: runnerUp === undefined
      ? 1
      : Math.abs(
          selected.decision.selectionScore - runnerUp.decision.selectionScore,
        ),
    selectionPolicy: 'sticky-until-verified-failure',
  };
}

/** Copies only a current bounded decision before it enters an asynchronous render attempt. */
function copyPreviewInspectorNeuralResidualDecision(value) {
  if (
    value?.version !== PREVIEW_INSPECTOR_NEURAL_RESIDUAL_VERSION ||
    !Array.isArray(value?.featureVector) ||
    value.featureVector.length !== PREVIEW_INSPECTOR_NEURAL_RESIDUAL_INPUT_SIZE ||
    !value.featureVector.every((feature) => Number.isFinite(feature) && Math.abs(feature) <= 1) ||
    !Number.isFinite(value?.score) ||
    readPreviewInspectorNeuralResidualHeadKey(value?.holeKind) !== value?.headKey
  ) return undefined;
  return {
    blockerKind: String(value?.blockerKind ?? 'unknown').slice(0, 80),
    ...(typeof value?.candidateId === 'string' && value.candidateId.length > 0
      ? { candidateId: value.candidateId.slice(0, 120) }
      : {}),
    featureVector: [...value.featureVector],
    headEvidence: Number.isFinite(value?.headEvidence)
      ? Math.max(0, value.headEvidence)
      : 0,
    headKey: value.headKey,
    headUpdates: Number.isSafeInteger(value?.headUpdates) ? Math.max(0, value.headUpdates) : 0,
    holeKind: String(value?.holeKind ?? 'unknown').slice(0, 80),
    modelUpdates: Number.isSafeInteger(value?.modelUpdates) ? value.modelUpdates : 0,
    outcomeAttempts: Number.isSafeInteger(value?.outcomeAttempts)
      ? Math.max(0, value.outcomeAttempts)
      : 0,
    score: Math.max(0, Math.min(1, value.score)),
    selectionScore: Number.isFinite(value?.selectionScore)
      ? Math.max(0, Math.min(1, value.selectionScore))
      : Math.max(0, Math.min(1, value.score)),
    consecutiveFailures: Number.isSafeInteger(value?.consecutiveFailures)
      ? Math.max(0, value.consecutiveFailures)
      : 0,
    version: PREVIEW_INSPECTOR_NEURAL_RESIDUAL_VERSION,
  };
}

/** Re-scores a retained feature vector against the latest persisted model head. */
function refreshPreviewInspectorNeuralResidualDecision(value) {
  const decision = copyPreviewInspectorNeuralResidualDecision(value);
  if (decision === undefined) return undefined;
  const inference = runPreviewInspectorNeuralResidualModel(
    decision.featureVector,
    decision.holeKind,
  );
  const model = initializePreviewInspectorNeuralResidualModel();
  const outcome = readPreviewInspectorNeuralResidualOutcome(
    model,
    inference.headKey,
    decision.candidateId,
  );
  return {
    ...decision,
    consecutiveFailures: outcome?.consecutiveFailures ?? 0,
    headEvidence: inference.headEvidence,
    headKey: inference.headKey,
    headUpdates: inference.headUpdates,
    modelUpdates: model.updates,
    outcomeAttempts: outcome?.attempts ?? 0,
    score: inference.score,
    selectionScore: scorePreviewInspectorNeuralResidualSelection(inference.score, outcome),
  };
}

/** Supplies Array.sort with a neutral-safe score comparison. */
function comparePreviewInspectorNeuralResidualDecisions(left, right) {
  const leftDecision = refreshPreviewInspectorNeuralResidualDecision(left);
  const rightDecision = refreshPreviewInspectorNeuralResidualDecision(right);
  if (
    leftDecision === undefined || rightDecision === undefined ||
    leftDecision.headKey !== rightDecision.headKey ||
    Math.min(leftDecision.headEvidence, rightDecision.headEvidence) <
      PREVIEW_INSPECTOR_NEURAL_RESIDUAL_SELECTION_MIN_EVIDENCE
  ) return 0;
  const difference = rightDecision.selectionScore - leftDecision.selectionScore;
  return Math.abs(difference) >= PREVIEW_INSPECTOR_NEURAL_RESIDUAL_SELECTION_MARGIN
    ? difference
    : 0;
}

/** Produces bounded diagnostics without exposing the learned vector. */
function summarizePreviewInspectorNeuralResidualDecision(value) {
  const decision = refreshPreviewInspectorNeuralResidualDecision(value);
  return decision === undefined
    ? undefined
    : {
        blockerKind: decision.blockerKind,
        ...(decision.candidateId === undefined ? {} : { candidateId: decision.candidateId }),
        headEvidence: Number(decision.headEvidence.toFixed(6)),
        headKey: decision.headKey,
        headUpdates: decision.headUpdates,
        holeKind: decision.holeKind,
        modelUpdates: decision.modelUpdates,
        outcomeAttempts: decision.outcomeAttempts,
        score: Number(decision.score.toFixed(6)),
        selectionScore: Number(decision.selectionScore.toFixed(6)),
        consecutiveFailures: decision.consecutiveFailures,
        version: decision.version,
      };
}

/** Publishes one compact inference selection independently from its later verifier label. */
function recordPreviewInspectorNeuralResidualSelection(decision, auto, traceId) {
  const selected = copyPreviewInspectorNeuralResidualDecision(decision);
  if (
    selected === undefined || typeof traceId !== 'string' ||
    typeof recordPreviewInspectorRuntimeHealth !== 'function'
  ) return;
  recordPreviewInspectorRuntimeHealth({
    category: 'neural-residual',
    detail: {
      blockerKind: selected.blockerKind,
      candidateId: selected.candidateId,
      headEvidence: selected.headEvidence,
      headKey: selected.headKey,
      headUpdates: selected.headUpdates,
      holeKind: selected.holeKind,
      mode: auto?.mode,
      modelUpdates: selected.modelUpdates,
      outcomeAttempts: selected.outcomeAttempts,
      prediction: selected.score,
      selectionScore: selected.selectionScore,
      consecutiveFailures: selected.consecutiveFailures,
      traceId,
    },
    event: 'neural-residual-selected',
  });
}

/** Applies one soft-label SGD update to the output head and persists only verified learning. */
function trainPreviewInspectorNeuralResidualDecision(value, label, confidence = 1) {
  const decision = copyPreviewInspectorNeuralResidualDecision(value);
  if (
    decision === undefined || !Number.isFinite(label) || label < 0 || label > 1 ||
    !Number.isFinite(confidence) || confidence <= 0 || confidence > 1
  ) {
    return undefined;
  }
  const model = initializePreviewInspectorNeuralResidualModel();
  const selectedHead = readPreviewInspectorNeuralResidualHead(model, decision.holeKind, true);
  const head = selectedHead.head;
  if (head === undefined) return undefined;
  const inference = runPreviewInspectorNeuralResidualModel(
    decision.featureVector,
    decision.holeKind,
  );
  const error = inference.score - label;
  for (let index = 0; index < head.outputWeights.length; index += 1) {
    const weight = head.outputWeights[index];
    const gradient = confidence * (
      error * inference.hidden[index] + PREVIEW_INSPECTOR_NEURAL_RESIDUAL_L2 * weight
    );
    head.outputWeights[index] = Math.max(
      -PREVIEW_INSPECTOR_NEURAL_RESIDUAL_WEIGHT_LIMIT,
      Math.min(
        PREVIEW_INSPECTOR_NEURAL_RESIDUAL_WEIGHT_LIMIT,
        weight - PREVIEW_INSPECTOR_NEURAL_RESIDUAL_LEARNING_RATE * gradient,
      ),
    );
  }
  head.outputBias = Math.max(
    -PREVIEW_INSPECTOR_NEURAL_RESIDUAL_WEIGHT_LIMIT,
    Math.min(
      PREVIEW_INSPECTOR_NEURAL_RESIDUAL_WEIGHT_LIMIT,
      head.outputBias - PREVIEW_INSPECTOR_NEURAL_RESIDUAL_LEARNING_RATE * error * confidence,
    ),
  );
  head.evidence = Math.min(Number.MAX_SAFE_INTEGER, head.evidence + confidence);
  head.updates = Math.min(Number.MAX_SAFE_INTEGER, head.updates + 1);
  model.updates = Math.min(Number.MAX_SAFE_INTEGER, model.updates + 1);
  const outcome = recordPreviewInspectorNeuralResidualOutcome(
    model,
    decision,
    label,
    confidence,
  );
  if (typeof persistPreviewInspectorState === 'function') persistPreviewInspectorState();
  if (typeof publishPreviewInspectorNeuralResidualModel === 'function') {
    publishPreviewInspectorNeuralResidualModel();
  }
  return {
    consecutiveFailures: outcome?.consecutiveFailures ?? 0,
    confidence,
    headEvidence: head.evidence,
    headKey: selectedHead.headKey,
    headUpdates: head.updates,
    label,
    outcomeAttempts: outcome?.attempts ?? 0,
    prediction: inference.score,
    updates: model.updates,
  };
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
  const targetOutput = state?.targetHasOutput === true || state?.status === 'reached';
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
  if (Number.isSafeInteger(dataFlowCallCount) && dataFlowCallCount > 0) {
    const truthyReturnCount = Math.max(
      0,
      Math.min(dataFlowCallCount, Number(dataFlowSignal?.truthyReturns ?? 0)),
    );
    const retentionRatio = truthyReturnCount / dataFlowCallCount;
    return {
      confidence: Math.min(1, 0.4 + dataFlowCallCount * 0.2),
      label: targetOutput ? retentionRatio : retentionRatio * 0.65,
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
  const ownsTarget = typeof attempt?.targetReachabilityKey === 'string';
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

/** Waits through the ordinary convergence window before assigning target-level credit. */
function observePreviewInspectorNeuralResidualAttempt(attempt, result) {
  if (copyPreviewInspectorNeuralResidualDecision(attempt?.neuralResidualDecision) === undefined) {
    return undefined;
  }
  const retainedResult = copyPreviewInspectorNeuralResidualAttemptResult(result);
  if (retainedResult === undefined) return undefined;
  const assessment = assessPreviewInspectorNeuralResidualAttempt(
    attempt,
    retainedResult,
  );
  if (assessment === undefined) return undefined;
  if (assessment.pending !== true) {
    return applyPreviewInspectorNeuralResidualAttemptAssessment(
      attempt,
      assessment,
      'neural-residual-trained',
    );
  }
  if (typeof globalThis.setTimeout !== 'function') {
    return applyPreviewInspectorNeuralResidualAttemptAssessment(
      attempt,
      assessPreviewInspectorNeuralResidualAttempt(attempt, retainedResult, true),
      'neural-residual-trained',
    );
  }
  attempt.neuralResidualObservationRevision =
    (Number.isSafeInteger(attempt.neuralResidualObservationRevision)
      ? attempt.neuralResidualObservationRevision
      : 0) + 1;
  const revision = attempt.neuralResidualObservationRevision;
  const startedAt = Date.now();
  const verify = () => {
    if (
      attempt.neuralResidualRejected === true ||
      attempt.neuralResidualObservationRevision !== revision
    ) return;
    const deadlineReached = Date.now() - startedAt >=
      PREVIEW_INSPECTOR_NEURAL_RESIDUAL_VERIFY_LIMIT_MS;
    const nextAssessment = assessPreviewInspectorNeuralResidualAttempt(
      attempt,
      retainedResult,
      deadlineReached,
    );
    if (nextAssessment?.pending === true && !deadlineReached) {
      globalThis.setTimeout(verify, PREVIEW_INSPECTOR_NEURAL_RESIDUAL_VERIFY_INTERVAL_MS);
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

/** Corrects an optimistic settled label when the existing fatal-error grace window rolls it back. */
function rejectPreviewInspectorNeuralResidualAttempt(attempt) {
  if (attempt === undefined) return undefined;
  attempt.neuralResidualRejected = true;
  attempt.neuralResidualObservationRevision =
    (Number.isSafeInteger(attempt.neuralResidualObservationRevision)
      ? attempt.neuralResidualObservationRevision
      : 0) + 1;
  return applyPreviewInspectorNeuralResidualAttemptAssessment(
    attempt,
    {
      confidence: 1,
      label: 0,
      localProgress: false,
      pending: false,
      reason: 'fatal-error-after-attempt',
      targetOutput: false,
    },
    'neural-residual-corrected',
  );
}
`;
}
