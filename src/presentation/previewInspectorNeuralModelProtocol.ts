/**
 * Validates the bounded Page Inspector neural model crossing the webview/extension boundary.
 * Persisted values contain only finite weights and anonymous candidate counters, never project
 * source, runtime values, feature vectors, or candidate identifiers.
 */

export const PREVIEW_INSPECTOR_NEURAL_MODEL_SYNC_TYPE = 'react-preview-neural-model-sync' as const;
export const PREVIEW_INSPECTOR_NEURAL_MODEL_SNAPSHOT_TYPE =
  'react-preview-neural-model-snapshot' as const;
const PREVIEW_INSPECTOR_NEURAL_MODEL_VERSION = 4;
const PREVIEW_INSPECTOR_NEURAL_MODEL_LEGACY_VERSION = 3;
const PREVIEW_INSPECTOR_NEURAL_HIDDEN_SIZE = 16;
const PREVIEW_INSPECTOR_NEURAL_WEIGHT_LIMIT = 4;
const PREVIEW_INSPECTOR_NEURAL_OUTCOME_LIMIT = 192;
const PREVIEW_INSPECTOR_NEURAL_HEAD_KEYS = [
  'blocker-exception',
  'condition',
  'data-collection',
  'page-choice',
  'rendered-empty',
  'render-state',
  'unrendered',
  'general',
] as const;
const PREVIEW_INSPECTOR_NEURAL_HEAD_KEY_SET = new Set<string>(PREVIEW_INSPECTOR_NEURAL_HEAD_KEYS);
const PREVIEW_INSPECTOR_NEURAL_OUTCOME_KEY_PATTERN =
  /^(?:blocker-exception|condition|data-collection|page-choice|rendered-empty|render-state|unrendered|general):[a-f0-9]{8}$/u;

/** One finite logistic output head learned for an isolated blocker-hole family. */
export interface PreviewInspectorNeuralModelHead {
  readonly evidence: number;
  readonly outputBias: number;
  readonly outputWeights: readonly number[];
  readonly updates: number;
}

/** Anonymous empirical result memory for one reusable candidate strategy. */
export interface PreviewInspectorNeuralCandidateOutcome {
  readonly attempts: number;
  readonly consecutiveFailures: number;
  readonly evidence: number;
  readonly lastConfidence: number;
  readonly lastLabel: number;
  readonly rewardSum: number;
  readonly sequence: number;
}

/** Bounded profile-local model accepted from an untrusted preview webview. */
export interface PreviewInspectorNeuralModel {
  readonly candidateOutcomes: Readonly<Record<string, PreviewInspectorNeuralCandidateOutcome>>;
  readonly heads: Readonly<Record<string, PreviewInspectorNeuralModelHead>>;
  readonly outcomeSequence: number;
  readonly updates: number;
  readonly version: 4;
}

/** Validated renderer request to merge its local learning into the shared profile model. */
export interface PreviewInspectorNeuralModelSyncRequest {
  readonly model: PreviewInspectorNeuralModel;
  readonly runtimeRevision: number;
  readonly type: typeof PREVIEW_INSPECTOR_NEURAL_MODEL_SYNC_TYPE;
}

/** Creates the neutral model used when no valid profile-level learning has been retained. */
export function createEmptyPreviewInspectorNeuralModel(): PreviewInspectorNeuralModel {
  return Object.freeze({
    candidateOutcomes: Object.freeze({}),
    heads: Object.freeze({}),
    outcomeSequence: 0,
    updates: 0,
    version: PREVIEW_INSPECTOR_NEURAL_MODEL_VERSION,
  });
}

/** Reports whether untrusted traffic claims the model synchronization discriminator. */
export function isPreviewInspectorNeuralModelSyncMessage(
  value: unknown,
): value is Record<string, unknown> {
  return isRecord(value) && value.type === PREVIEW_INSPECTOR_NEURAL_MODEL_SYNC_TYPE;
}

/** Reads one current-revision synchronization request with a fully validated bounded model. */
export function readPreviewInspectorNeuralModelSyncRequest(
  value: unknown,
): PreviewInspectorNeuralModelSyncRequest | undefined {
  if (!isPreviewInspectorNeuralModelSyncMessage(value)) return undefined;
  const runtimeRevision = value.runtimeRevision;
  const model = readPreviewInspectorNeuralModel(value.model);
  if (
    !Number.isSafeInteger(runtimeRevision) ||
    (runtimeRevision as number) < 0 ||
    model === undefined
  )
    return undefined;
  return Object.freeze({
    model,
    runtimeRevision: runtimeRevision as number,
    type: PREVIEW_INSPECTOR_NEURAL_MODEL_SYNC_TYPE,
  });
}

/**
 * Normalizes a current model and refines legacy version-three learning exactly once.
 */
export function readPreviewInspectorNeuralModel(
  value: unknown,
): PreviewInspectorNeuralModel | undefined {
  if (
    !isRecord(value) ||
    ![
      PREVIEW_INSPECTOR_NEURAL_MODEL_LEGACY_VERSION,
      PREVIEW_INSPECTOR_NEURAL_MODEL_VERSION,
    ].includes(value.version as number)
  ) {
    return undefined;
  }
  const legacy = value.version === PREVIEW_INSPECTOR_NEURAL_MODEL_LEGACY_VERSION;
  if (!isRecord(value.heads)) return undefined;
  const rawOutcomes = value.candidateOutcomes;
  if (rawOutcomes !== undefined && !isRecord(rawOutcomes)) return undefined;
  const outcomeEntries = Object.entries(rawOutcomes ?? {});
  if (outcomeEntries.length > PREVIEW_INSPECTOR_NEURAL_OUTCOME_LIMIT) return undefined;
  const candidateOutcomes: Record<string, PreviewInspectorNeuralCandidateOutcome> = {};
  let greatestSequence = 0;
  for (const [key, rawOutcome] of outcomeEntries) {
    if (!PREVIEW_INSPECTOR_NEURAL_OUTCOME_KEY_PATTERN.test(key)) return undefined;
    const outcome = readOutcome(rawOutcome, legacy);
    if (outcome === undefined) return undefined;
    candidateOutcomes[key] = outcome;
    greatestSequence = Math.max(greatestSequence, outcome.sequence);
  }
  const rawSequence = value.outcomeSequence;
  if (
    rawSequence !== undefined &&
    (!Number.isSafeInteger(rawSequence) || (rawSequence as number) < greatestSequence)
  )
    return undefined;
  const heads: Record<string, PreviewInspectorNeuralModelHead> = {};
  let updates = 0;
  for (const [headKey, rawHead] of Object.entries(value.heads)) {
    if (!PREVIEW_INSPECTOR_NEURAL_HEAD_KEY_SET.has(headKey)) return undefined;
    const head = readHead(rawHead, legacy);
    if (head === undefined) return undefined;
    heads[headKey] = legacy ? refineLegacyHead(headKey, head, candidateOutcomes) : head;
    updates = Math.min(Number.MAX_SAFE_INTEGER, updates + head.updates);
  }
  return Object.freeze({
    candidateOutcomes: Object.freeze(candidateOutcomes),
    heads: Object.freeze(heads),
    outcomeSequence: rawSequence === undefined ? greatestSequence : (rawSequence as number),
    updates,
    version: PREVIEW_INSPECTOR_NEURAL_MODEL_VERSION,
  });
}

/** Merges independently learned families and keeps the strongest bounded outcome evidence. */
export function mergePreviewInspectorNeuralModels(
  current: PreviewInspectorNeuralModel,
  incoming: PreviewInspectorNeuralModel,
): PreviewInspectorNeuralModel {
  const heads: Record<string, PreviewInspectorNeuralModelHead> = {};
  for (const headKey of PREVIEW_INSPECTOR_NEURAL_HEAD_KEYS) {
    const currentHead = current.heads[headKey];
    const incomingHead = incoming.heads[headKey];
    const selected =
      currentHead === undefined
        ? incomingHead
        : incomingHead === undefined
          ? currentHead
          : incomingHead.updates > currentHead.updates ||
              (incomingHead.updates === currentHead.updates &&
                incomingHead.evidence > currentHead.evidence)
            ? incomingHead
            : currentHead;
    if (selected !== undefined) heads[headKey] = selected;
  }
  const candidateOutcomes = { ...current.candidateOutcomes };
  for (const [key, incomingOutcome] of Object.entries(incoming.candidateOutcomes)) {
    const currentOutcome = candidateOutcomes[key];
    if (
      currentOutcome === undefined ||
      incomingOutcome.attempts > currentOutcome.attempts ||
      (incomingOutcome.attempts === currentOutcome.attempts &&
        (incomingOutcome.evidence > currentOutcome.evidence ||
          (incomingOutcome.evidence === currentOutcome.evidence &&
            incomingOutcome.sequence >= currentOutcome.sequence)))
    )
      candidateOutcomes[key] = incomingOutcome;
  }
  const retainedOutcomes = Object.fromEntries(
    Object.entries(candidateOutcomes)
      .sort((left, right) => right[1].sequence - left[1].sequence)
      .slice(0, PREVIEW_INSPECTOR_NEURAL_OUTCOME_LIMIT),
  );
  return (
    readPreviewInspectorNeuralModel({
      candidateOutcomes: retainedOutcomes,
      heads,
      outcomeSequence: Math.max(current.outcomeSequence, incoming.outcomeSequence),
      version: PREVIEW_INSPECTOR_NEURAL_MODEL_VERSION,
    }) ?? createEmptyPreviewInspectorNeuralModel()
  );
}

/** Creates one extension-to-renderer snapshot for the session's currently displayed revision. */
export function createPreviewInspectorNeuralModelSnapshot(
  runtimeRevision: number,
  model: PreviewInspectorNeuralModel,
): Readonly<Record<string, unknown>> {
  return Object.freeze({
    model,
    runtimeRevision,
    type: PREVIEW_INSPECTOR_NEURAL_MODEL_SNAPSHOT_TYPE,
  });
}

/** Reads one bounded finite output head without repairing hostile values. */
function readHead(value: unknown, legacy: boolean): PreviewInspectorNeuralModelHead | undefined {
  if (!isRecord(value) || !Array.isArray(value.outputWeights)) return undefined;
  const evidence = value.evidence;
  const outputBias = value.outputBias;
  const updates = value.updates;
  if (
    !Number.isFinite(outputBias) ||
    Math.abs(outputBias as number) > PREVIEW_INSPECTOR_NEURAL_WEIGHT_LIMIT ||
    value.outputWeights.length !== PREVIEW_INSPECTOR_NEURAL_HIDDEN_SIZE ||
    !value.outputWeights.every(
      (weight) =>
        typeof weight === 'number' &&
        Number.isFinite(weight) &&
        Math.abs(weight) <= PREVIEW_INSPECTOR_NEURAL_WEIGHT_LIMIT,
    ) ||
    !Number.isSafeInteger(updates) ||
    (updates as number) < 0 ||
    (!legacy &&
      (!Number.isFinite(evidence) ||
        (evidence as number) < 0 ||
        (evidence as number) > (updates as number)))
  )
    return undefined;
  return Object.freeze({
    evidence: legacy ? 0 : (evidence as number),
    outputBias: outputBias as number,
    outputWeights: Object.freeze(value.outputWeights.map((weight) => weight as number)),
    updates: updates as number,
  });
}

/** Reads one finite anonymous result counter with internally consistent bounds. */
function readOutcome(
  value: unknown,
  legacy: boolean,
): PreviewInspectorNeuralCandidateOutcome | undefined {
  if (!isRecord(value)) return undefined;
  const {
    attempts,
    consecutiveFailures,
    evidence,
    lastConfidence,
    lastLabel,
    rewardSum,
    sequence,
  } = value;
  if (
    !Number.isSafeInteger(attempts) ||
    (attempts as number) < 1 ||
    !Number.isSafeInteger(consecutiveFailures) ||
    (consecutiveFailures as number) < 0 ||
    (consecutiveFailures as number) > (attempts as number) ||
    !Number.isFinite(lastLabel) ||
    (lastLabel as number) < 0 ||
    (lastLabel as number) > 1 ||
    !Number.isFinite(rewardSum) ||
    (rewardSum as number) < 0 ||
    (rewardSum as number) > (attempts as number) ||
    !Number.isSafeInteger(sequence) ||
    (sequence as number) < 1
  )
    return undefined;
  if (legacy) {
    const migratedEvidence = readLegacyOutcomeEvidence(attempts as number);
    return Object.freeze({
      attempts: attempts as number,
      consecutiveFailures: consecutiveFailures as number,
      evidence: migratedEvidence,
      lastConfidence: (attempts as number) === 1 ? 0.35 : 0.85,
      lastLabel: lastLabel as number,
      rewardSum: ((rewardSum as number) / (attempts as number)) * migratedEvidence,
      sequence: sequence as number,
    });
  }
  if (
    !Number.isFinite(evidence) ||
    (evidence as number) <= 0 ||
    (evidence as number) > (attempts as number) ||
    !Number.isFinite(lastConfidence) ||
    (lastConfidence as number) <= 0 ||
    (lastConfidence as number) > 1 ||
    (rewardSum as number) > (evidence as number)
  )
    return undefined;
  return Object.freeze({
    attempts: attempts as number,
    consecutiveFailures: consecutiveFailures as number,
    evidence: evidence as number,
    lastConfidence: lastConfidence as number,
    lastLabel: lastLabel as number,
    rewardSum: rewardSum as number,
    sequence: sequence as number,
  });
}

/** Discounts a singleton observation while allowing repeated evidence to become authoritative. */
function readLegacyOutcomeEvidence(attempts: number): number {
  return attempts === 1 ? 0.35 : Math.min(attempts, 0.35 + (attempts - 1) * 0.85);
}

/**
 * Removes broad bias learned mostly from one-shot candidates while preserving exact outcome memory.
 * Heads without an outcome audit trail stay numerically intact because their provenance is unknown.
 */
function refineLegacyHead(
  headKey: string,
  head: PreviewInspectorNeuralModelHead,
  outcomes: Readonly<Record<string, PreviewInspectorNeuralCandidateOutcome>>,
): PreviewInspectorNeuralModelHead {
  const familyOutcomes = Object.entries(outcomes)
    .filter(([key]) => key.startsWith(`${headKey}:`))
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
  return Object.freeze({
    evidence: Math.min(head.updates, outcomeEvidence + untrackedUpdates * 0.65),
    outputBias: head.outputBias * retention,
    outputWeights: Object.freeze(head.outputWeights.map((weight) => weight * retention)),
    updates: head.updates,
  });
}

/** Narrows untrusted structured-clone values to indexable records. */
function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
