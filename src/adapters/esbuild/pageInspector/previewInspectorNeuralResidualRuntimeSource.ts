/**
 * Generates the local neural residual used only after deterministic blocker admission.
 *
 * The adaptive model stays compatible: a deterministic hashed input projection feeds isolated logistic
 * heads for each blocker-hole family. This prevents an unrendered failure from poisoning exception
 * repair or table-data recommendations while keeping an untrained head exactly neutral. Exact
 * outcome memory is scoped to the bounded problem features, while head weights generalize.
 */
import { createPreviewInspectorNeuralModelRuntimeSource } from './previewInspectorNeuralModelRuntimeSource';
import { createPreviewInspectorNeuralAttemptVerificationRuntimeSource } from './previewInspectorNeuralAttemptVerificationRuntimeSource';
import { createPreviewInspectorNeuralProjectionRuntimeSource } from './previewInspectorNeuralProjectionRuntimeSource';
import { createPreviewInspectorRecoveryPriorRuntimeSource } from './previewInspectorRecoveryPriorRuntimeSource';

/** Creates browser source for bounded inference, verified online learning, and model persistence. */
export function createPreviewInspectorNeuralResidualRuntimeSource(): string {
  return String.raw`
${createPreviewInspectorNeuralModelRuntimeSource()}
${createPreviewInspectorRecoveryPriorRuntimeSource()}
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

/** Fingerprints every bounded feature cell so different problems cannot share a failure streak. */
function createPreviewInspectorNeuralResidualContextKey(specification, vector) {
  let hash = hashPreviewInspectorNeuralResidualToken(
    'problem:' + String(specification?.holeKind ?? 'unknown').slice(0, 80) + ':' +
      String(specification?.blockerKind ?? 'unknown').slice(0, 80),
  );
  for (const feature of vector) {
    const quantized = Math.round(feature * 1_000_000);
    for (let shift = 0; shift < 32; shift += 8) {
      hash ^= (quantized >>> shift) & 255;
      hash = Math.imul(hash, 16777619);
    }
  }
  return (hash >>> 0).toString(16).padStart(8, '0');
}

/** Creates an anonymous strategy/context key; legacy context-free counters never veto a new hole. */
function createPreviewInspectorNeuralResidualOutcomeKey(headKey, candidateId, contextKey) {
  if (
    !PREVIEW_INSPECTOR_NEURAL_RESIDUAL_HEAD_KEYS.includes(headKey) ||
    typeof candidateId !== 'string' || candidateId.length === 0 ||
    typeof contextKey !== 'string' || !/^[a-f0-9]{8}$/u.test(contextKey)
  ) return undefined;
  return headKey + ':' + hashPreviewInspectorNeuralResidualToken(
    'candidate-context:' + contextKey + ':' + candidateId.slice(0, 120),
  ).toString(16).padStart(8, '0');
}

/** Reads prior verified outcomes for one candidate without allocating memory during inference. */
function readPreviewInspectorNeuralResidualOutcome(model, headKey, candidateId, contextKey) {
  const key = createPreviewInspectorNeuralResidualOutcomeKey(headKey, candidateId, contextKey);
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

/** Retains one verifier label while reserving recent anonymous outcomes for other families. */
function recordPreviewInspectorNeuralResidualOutcome(model, decision, label, confidence) {
  const key = createPreviewInspectorNeuralResidualOutcomeKey(
    decision.headKey,
    decision.candidateId,
    decision.contextKey,
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
    model.candidateOutcomes = Object.fromEntries(
      retainPreviewInspectorNeuralResidualOutcomes(entries),
    );
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

/** Preserves signed unit features while keeping larger counts distinguishable instead of saturated. */
function scalePreviewInspectorNeuralResidualNumber(value) {
  const magnitude = Math.abs(value);
  if (magnitude <= 1) return Math.tanh(value);
  const unit = Math.tanh(1);
  const tail = Math.log1p(magnitude - 1);
  return Math.sign(value) * (unit + (1 - unit) * tail / (1 + tail));
}

/** Converts a typed blocker hole into a bounded, normalized numeric feature vector. */
function encodePreviewInspectorNeuralResidualFeatures(specification = {}) {
  const vector = Array(PREVIEW_INSPECTOR_NEURAL_RESIDUAL_INPUT_SIZE).fill(0);
  const suppliedTokens = Array.isArray(specification?.tokens) ? specification.tokens : [];
  // Reserve identity before context truncation; otherwise long requirements hide every action.
  const priorityTokens = [
    ...(typeof specification?.candidateId === 'string' && specification.candidateId.length > 0
      ? ['candidate:' + specification.candidateId.slice(0, 120)] : []),
    ...suppliedTokens.filter((token) =>
      typeof token === 'string' && /^(?:strategy|row-strategy):/u.test(token),
    ).slice(0, 8),
  ];
  const tokens = [
    'bias',
    'hole:' + String(specification?.holeKind ?? 'unknown'),
    'blocker:' + String(specification?.blockerKind ?? 'unknown'),
    ...priorityTokens,
    ...suppliedTokens.filter((token) => !priorityTokens.includes(token)),
  ].filter((value) => typeof value === 'string' && value.length > 0)
    .slice(0, PREVIEW_INSPECTOR_NEURAL_RESIDUAL_TOKEN_LIMIT);
  for (const token of tokens) addPreviewInspectorNeuralResidualFeature(vector, token);
  const texts = Array.isArray(specification?.texts) ? specification.texts.slice(0, 8) : [];
  let lexicalCount = 0;
  for (const text of texts) {
    if (lexicalCount >= 24) break;
    if (typeof text !== 'string') continue;
    const boundedText = text.slice(0, PREVIEW_INSPECTOR_NEURAL_RESIDUAL_TEXT_LIMIT);
    for (const word of boundedText.toLowerCase().match(/[a-z0-9_$-]+/gu) ?? []) {
      if (lexicalCount >= 24) break;
      addPreviewInspectorNeuralResidualFeature(vector, 'lex:' + word.slice(0, 64), 0.65);
      lexicalCount += 1;
    }
  }
  const numbers = specification?.numbers;
  if (numbers !== null && typeof numbers === 'object' && !Array.isArray(numbers)) {
    for (const [name, rawValue] of Object.entries(numbers)
      .filter(([name]) => name !== 'deterministicRank').slice(0, 16)) {
      if (!Number.isFinite(rawValue)) continue;
      addPreviewInspectorNeuralResidualFeature(
        vector,
        'number:' + name,
        scalePreviewInspectorNeuralResidualNumber(Number(rawValue)),
      );
    }
  }
  const norm = Math.sqrt(vector.reduce((sum, value) => sum + value * value, 0));
  return norm > 0 ? vector.map((value) => value / norm) : vector;
}

${createPreviewInspectorNeuralProjectionRuntimeSource()}

/** Skips neutral score-only projection; training always requests the exact hidden activations. */
function runPreviewInspectorNeuralResidualModel(vector, holeKind, model, requireHidden = true) {
  const selectedHead = readPreviewInspectorNeuralResidualHead(model, holeKind);
  if (!requireHidden && selectedHead.head === undefined) {
    return { headEvidence: 0, headKey: selectedHead.headKey, headUpdates: 0, score: 0.5 };
  }
  const head = selectedHead.head ?? createPreviewInspectorNeuralResidualHead();
  const hidden = projectPreviewInspectorNeuralResidualFeatures(vector);
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
  return createPreviewInspectorNeuralResidualDecisionWithModel(
    specification,
    initializePreviewInspectorNeuralResidualModel(),
  );
}

/** Scores one candidate against the already-validated model owned by this synchronous batch. */
function createPreviewInspectorNeuralResidualDecisionWithModel(specification, model) {
  const holeKind = String(specification?.holeKind ?? 'unknown').slice(0, 80);
  const featureVector = encodePreviewInspectorNeuralResidualFeatures(specification);
  const contextKey = createPreviewInspectorNeuralResidualContextKey(specification, featureVector);
  const inference = runPreviewInspectorNeuralResidualModel(featureVector, holeKind, model, false);
  const candidateId = typeof specification?.candidateId === 'string' &&
    specification.candidateId.length > 0
    ? specification.candidateId.slice(0, 120)
    : undefined;
  const outcome = readPreviewInspectorNeuralResidualOutcome(
    model,
    inference.headKey,
    candidateId,
    contextKey,
  );
  return {
    blockerKind: String(specification?.blockerKind ?? 'unknown').slice(0, 80),
    ...(candidateId === undefined ? {} : { candidateId }),
    consecutiveFailures: outcome?.consecutiveFailures ?? 0,
    contextKey,
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
  const contextKey = createPreviewInspectorNeuralResidualContextKey(
    specification,
    encodePreviewInspectorNeuralResidualFeatures(specification),
  );
  return [
    typeof previewEntryRevision === 'number' ? previewEntryRevision : 0,
    previewInspectorSession.activeTargetReachabilityKey ?? '',
    previewInspectorSession.selectedPageCandidateId ?? '',
    previewInspectorSession.selectedExportName ?? '',
    readPreviewInspectorNeuralResidualHeadKey(specification?.holeKind),
    contextKey,
  ].join(':');
}

/**
 * Ranks only caller-admitted typed values and returns the winning opaque residual decision.
 *
 * The model never materializes project data. Callers retain the candidate values and supply only
 * bounded semantic features plus a deterministic safety rank. A neutral model therefore selects
 * the safest existing candidate, while verified local learning can reorder equally admitted holes.
 */
function selectPreviewInspectorNeuralResidualCandidate(specification, rawCandidates, verifiedPortfolioFailures = 0) {
  const exploration = readPreviewInspectorNeuralResidualExplorationPolicy();
  const admittedCandidates = (Array.isArray(rawCandidates) ? rawCandidates : [])
    .filter((candidate) =>
      candidate !== null && typeof candidate === 'object' &&
      typeof candidate.id === 'string' && candidate.id.length > 0,
    )
    .slice(0, 12);
  if (admittedCandidates.length === 0) return undefined;
  const recoveryContext = Number.isSafeInteger(verifiedPortfolioFailures) && verifiedPortfolioFailures > 0
    ? { ...specification?.recoveryContext, failedCandidateCount: Math.min(10000, verifiedPortfolioFailures),
        verifiedFailureCount: Math.min(10000, verifiedPortfolioFailures), remainingCandidateCount: admittedCandidates.length }
    : specification?.recoveryContext;
  const model = initializePreviewInspectorNeuralResidualModel();
  const specifications = admittedCandidates.map((candidate) => ({
      blockerKind: specification?.blockerKind,
      candidateId: candidate.id,
      holeKind: specification?.holeKind,
      recoveryContext,
      numbers: {
        ...(specification?.numbers ?? {}),
        ...(candidate?.numbers ?? {}),
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
    }));
  const candidates = admittedCandidates.map((candidate, index) => {
    const deterministicRank = Number.isFinite(candidate.deterministicRank)
      ? Number(candidate.deterministicRank)
      : index;
    const decision = createPreviewInspectorNeuralResidualDecisionWithModel(specifications[index], model);
    return {
      candidateId: candidate.id.slice(0, 120),
      decision,
      deterministicRank,
    };
  });
  // Verifier failures remain excluded; unknown alternatives may still use the packaged prior.
  const prior = rankPreviewInspectorRecoveryPrior(
    specifications, candidates.map((candidate) => candidate.decision), exploration?.excludedCandidateIds,
  );
  if (prior !== undefined) {
    for (const [index, candidate] of candidates.entries()) {
      if (!Number.isFinite(prior.scores[index])) continue;
      candidate.decision.priorScore = prior.scores[index];
      candidate.decision.priorVersion = prior.id;
    }
  }
  candidates.sort((left, right) =>
    left.decision.consecutiveFailures - right.decision.consecutiveFailures ||
    comparePreviewInspectorRecoveryPriorScores(left.decision, right.decision) ||
    comparePreviewInspectorNeuralResidualScores(left.decision, right.decision) ||
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
    ...copyPreviewInspectorRecoveryPriorMetadata(value),
    ...(typeof value?.candidateId === 'string' && value.candidateId.length > 0
      ? { candidateId: value.candidateId.slice(0, 120) }
      : {}),
    contextKey: createPreviewInspectorNeuralResidualContextKey(value, value.featureVector),
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
function refreshPreviewInspectorNeuralResidualDecision(value, validatedModel) {
  const decision = copyPreviewInspectorNeuralResidualDecision(value);
  if (decision === undefined) return undefined;
  const model = validatedModel ?? initializePreviewInspectorNeuralResidualModel();
  const inference = runPreviewInspectorNeuralResidualModel(
    decision.featureVector,
    decision.holeKind,
    model,
    false,
  );
  const outcome = readPreviewInspectorNeuralResidualOutcome(
    model,
    inference.headKey,
    decision.candidateId,
    decision.contextKey,
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

/** Shares one validated model only within a synchronous ranking; callers must not retain this batch. */
function createPreviewInspectorNeuralResidualRankingBatch() {
  const model = initializePreviewInspectorNeuralResidualModel();
  return {
    compareDecisions: comparePreviewInspectorNeuralResidualScores,
    createDecision: (specification) =>
      createPreviewInspectorNeuralResidualDecisionWithModel(specification, model),
    refreshDecision: (decision) => refreshPreviewInspectorNeuralResidualDecision(decision, model),
  };
}

/** Supplies Array.sort with a neutral-safe score comparison. */
function comparePreviewInspectorNeuralResidualDecisions(left, right) {
  const leftDecision = refreshPreviewInspectorNeuralResidualDecision(left);
  const rightDecision = refreshPreviewInspectorNeuralResidualDecision(right);
  return comparePreviewInspectorNeuralResidualScores(leftDecision, rightDecision);
}

/** Compares fresh scores without repeating model validation and inference inside Array.sort. */
function comparePreviewInspectorNeuralResidualScores(leftDecision, rightDecision) {
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
        ...copyPreviewInspectorRecoveryPriorMetadata(decision),
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
    model,
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

${createPreviewInspectorNeuralAttemptVerificationRuntimeSource()}
`;
}
