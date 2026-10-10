/**
 * Applies an offline pre-training result to the profile-local Page Inspector neural model.
 *
 * Pre-training (`scripts/pretrain-page-inspector-neural.mjs`) continues the runtime's own training
 * from a copy of the profile model (`base`) and stores the result (`trained`) beside it. Importing
 * adds only the difference to the current profile model, so every update the profile made after
 * the copy survives and nothing is reset. The profile's outcome memories keep their values and
 * order; pre-training outcomes for new candidates only fill free slots, as the oldest entries.
 *
 * Storage access is injected through {@link PreviewInspectorNeuralModelImportSource}; the
 * global-storage adapter claims the file by an atomic rename before reading it, so one import is
 * applied at most once even when several windows share the profile.
 */
import {
  readPreviewInspectorNeuralModel,
  type PreviewInspectorNeuralCandidateOutcome,
  type PreviewInspectorNeuralModel,
  type PreviewInspectorNeuralModelHead,
} from './previewInspectorNeuralModelProtocol';

export const PREVIEW_INSPECTOR_NEURAL_MODEL_IMPORT_FORMAT = 'react-preview-neural-pretraining';
const IMPORT_ID_PATTERN = /^[a-z0-9][a-z0-9-]{0,63}$/u;
const OUTCOME_LIMIT = 192;
const WEIGHT_LIMIT = 4;
const NEUTRAL_HEAD: PreviewInspectorNeuralModelHead = {
  evidence: 0,
  outputBias: 0,
  outputWeights: Array.from({ length: 16 }, () => 0),
  updates: 0,
};

/** Validated pre-training result. */
export interface PreviewInspectorNeuralModelImport {
  /** Profile model the pre-training started from. */
  readonly base: PreviewInspectorNeuralModel;
  /** Stable identifier used for backup and applied-file names. */
  readonly id: string;
  /** Model after pre-training. */
  readonly trained: PreviewInspectorNeuralModel;
}

/** One pending import, claimed so no other window applies it. */
export interface PreviewInspectorNeuralModelImportClaim {
  /** Validated import, or `undefined` when the stored document was malformed. */
  readonly value?: PreviewInspectorNeuralModelImport;
  /** Saves the pre-import model so the profile can be restored by hand. */
  backup(model: PreviewInspectorNeuralModel): Promise<void>;
  /** Records whether the claimed import was applied. */
  settle(outcome: 'applied' | 'rejected'): Promise<void>;
}

/** Storage that may hold one pending pre-training import. */
export interface PreviewInspectorNeuralModelImportSource {
  /** Claims the pending import, or resolves `undefined` when there is none. */
  claim(): Promise<PreviewInspectorNeuralModelImportClaim | undefined>;
}

/**
 * Validates an untrusted import document.
 *
 * @param value Parsed JSON.
 * @returns The import, or `undefined` when the format, identifier, or either model is invalid.
 */
export function readPreviewInspectorNeuralModelImport(
  value: unknown,
): PreviewInspectorNeuralModelImport | undefined {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return undefined;
  const record = value as Record<string, unknown>;
  if (
    record.format !== PREVIEW_INSPECTOR_NEURAL_MODEL_IMPORT_FORMAT ||
    record.version !== 1 ||
    typeof record.id !== 'string' ||
    !IMPORT_ID_PATTERN.test(record.id)
  )
    return undefined;
  const base = readPreviewInspectorNeuralModel(record.base);
  const trained = readPreviewInspectorNeuralModel(record.trained);
  return base === undefined || trained === undefined ? undefined : { base, id: record.id, trained };
}

/**
 * Adds the pre-training difference to the current profile model.
 *
 * @param current Current profile model.
 * @param imported Validated pre-training result.
 * @returns The combined model, or `current` unchanged when the result would be invalid.
 */
export function applyPreviewInspectorNeuralModelImport(
  current: PreviewInspectorNeuralModel,
  imported: PreviewInspectorNeuralModelImport,
): PreviewInspectorNeuralModel {
  const { base, trained } = imported;
  const heads: Record<string, PreviewInspectorNeuralModelHead> = { ...current.heads };
  for (const [headKey, trainedHead] of Object.entries(trained.heads)) {
    const baseHead = base.heads[headKey] ?? NEUTRAL_HEAD;
    const learnedUpdates = trainedHead.updates - baseHead.updates;
    if (learnedUpdates <= 0) continue;
    const currentHead = current.heads[headKey] ?? NEUTRAL_HEAD;
    const updates = currentHead.updates + learnedUpdates;
    heads[headKey] = {
      evidence: Math.min(
        updates,
        currentHead.evidence + Math.max(0, trainedHead.evidence - baseHead.evidence),
      ),
      outputBias: clampWeight(
        currentHead.outputBias + trainedHead.outputBias - baseHead.outputBias,
      ),
      outputWeights: currentHead.outputWeights.map((weight, index) =>
        clampWeight(
          weight + (trainedHead.outputWeights[index] ?? 0) - (baseHead.outputWeights[index] ?? 0),
        ),
      ),
      updates,
    };
  }
  const candidateOutcomes: Record<string, PreviewInspectorNeuralCandidateOutcome> = {
    ...current.candidateOutcomes,
  };
  const additions: [string, PreviewInspectorNeuralCandidateOutcome][] = [];
  for (const [key, trainedOutcome] of Object.entries(trained.candidateOutcomes)) {
    const baseOutcome = base.candidateOutcomes[key];
    const currentOutcome = candidateOutcomes[key];
    if (baseOutcome !== undefined) {
      // Never resurrect a memory the profile has dropped since the copy was taken.
      if (currentOutcome !== undefined) {
        candidateOutcomes[key] = addOutcomeDifference(currentOutcome, baseOutcome, trainedOutcome);
      }
    } else if (currentOutcome === undefined) {
      additions.push([key, trainedOutcome]);
    }
  }
  const freeSlots = Math.max(0, OUTCOME_LIMIT - Object.keys(candidateOutcomes).length);
  additions.sort(
    ([leftKey, left], [rightKey, right]) =>
      right.evidence - left.evidence || (leftKey < rightKey ? -1 : leftKey > rightKey ? 1 : 0),
  );
  for (const [key, outcome] of additions.slice(0, freeSlots)) {
    // Sequence 1 ranks pre-training memories oldest, so live outcomes evict them first.
    candidateOutcomes[key] = { ...outcome, sequence: 1 };
  }
  return (
    readPreviewInspectorNeuralModel({
      candidateOutcomes,
      heads,
      outcomeSequence: Math.max(
        current.outcomeSequence,
        Object.keys(candidateOutcomes).length > 0 ? 1 : 0,
      ),
      version: 4,
    }) ?? current
  );
}

/** Adds the pre-training counters of one outcome to the profile's current counters. */
function addOutcomeDifference(
  current: PreviewInspectorNeuralCandidateOutcome,
  base: PreviewInspectorNeuralCandidateOutcome,
  trained: PreviewInspectorNeuralCandidateOutcome,
): PreviewInspectorNeuralCandidateOutcome {
  const attempts = trained.attempts - base.attempts;
  if (attempts <= 0) return current;
  const evidence = Math.min(attempts, Math.max(0, trained.evidence - base.evidence));
  const rewardSum = Math.min(evidence, Math.max(0, trained.rewardSum - base.rewardSum));
  const combinedAttempts = current.attempts + attempts;
  return {
    attempts: combinedAttempts,
    consecutiveFailures: Math.min(combinedAttempts, trained.consecutiveFailures),
    evidence: current.evidence + evidence,
    lastConfidence: trained.lastConfidence,
    lastLabel: trained.lastLabel,
    rewardSum: current.rewardSum + rewardSum,
    sequence: current.sequence,
  };
}

/** Keeps a combined weight inside the runtime's clipping range. */
function clampWeight(value: number): number {
  return Math.max(-WEIGHT_LIMIT, Math.min(WEIGHT_LIMIT, value));
}
