/**
 * Emits a packaged, quantized recovery prior without changing the verifier or local model schema.
 * It can break a cold ranking tie only within a supported, already admitted portfolio. Corrupt,
 * ambiguous, unfamiliar and verified-success cases retain the deterministic/online policy.
 */
import { previewInspectorRecoveryPriorArtifact } from './previewInspectorRecoveryPriorArtifact';
import { createPreviewInspectorRecoveryPriorFeaturesRuntimeSource } from './previewInspectorRecoveryPriorFeaturesRuntimeSource';

/** Composes CSP-safe lazy inference; the artifact never contains executable model code. */
export function createPreviewInspectorRecoveryPriorRuntimeSource(): string {
  return String.raw`
${createPreviewInspectorRecoveryPriorFeaturesRuntimeSource()}
const PREVIEW_INSPECTOR_RECOVERY_PRIOR_ARTIFACT = ${JSON.stringify(previewInspectorRecoveryPriorArtifact)};
let previewInspectorRecoveryPriorNetwork;
let previewInspectorRecoveryPriorInvalid = false;
const previewInspectorRecoveryPriorScores = new Map();

/** Decodes bounded base64 without Buffer, fetch, dynamic imports, eval or browser-only globals. */
function decodePreviewInspectorRecoveryPriorWeights(encoded) {
  if (typeof encoded !== 'string' || encoded.length > 200000 || encoded.length % 4 !== 0 ||
      !/^[A-Za-z0-9+/]*={0,2}$/u.test(encoded)) return undefined;
  const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';
  const lookup = new Uint8Array(128);
  for (let index = 0; index < alphabet.length; index += 1) lookup[alphabet.charCodeAt(index)] = index;
  const padding = encoded.endsWith('==') ? 2 : encoded.endsWith('=') ? 1 : 0;
  const bytes = new Uint8Array(encoded.length / 4 * 3 - padding);
  for (let index = 0, offset = 0; index < encoded.length; index += 4) {
    const packed = (lookup[encoded.charCodeAt(index)] << 18) |
      (lookup[encoded.charCodeAt(index + 1)] << 12) |
      (lookup[encoded.charCodeAt(index + 2)] << 6) |
      lookup[encoded.charCodeAt(index + 3)];
    for (let shift = 16; shift >= 0 && offset < bytes.length; shift -= 8) {
      bytes[offset++] = (packed >>> shift) & 255;
    }
  }
  return bytes;
}

/** Validates dimensions and every byte before allocating the immutable dense layers once. */
function readPreviewInspectorRecoveryPriorNetwork() {
  if (previewInspectorRecoveryPriorInvalid) return undefined;
  if (previewInspectorRecoveryPriorNetwork !== undefined) return previewInspectorRecoveryPriorNetwork;
  const artifact = PREVIEW_INSPECTOR_RECOVERY_PRIOR_ARTIFACT;
  const dimensions = artifact?.dimensions;
  const scales = artifact?.scales;
  const fail = () => { previewInspectorRecoveryPriorInvalid = true; return undefined; };
  if (artifact?.format !== 2 || !Array.isArray(dimensions) || dimensions.length !== 4 ||
      dimensions[0] !== PREVIEW_INSPECTOR_RECOVERY_PRIOR_INPUT_SIZE || dimensions[3] !== 1 ||
      !dimensions.every((size) => Number.isSafeInteger(size) && size > 0 && size <= 512) ||
      !Array.isArray(scales) || scales.length !== 3 ||
      !scales.every((scale) => Number.isFinite(scale) && scale > 0 && scale <= 1)) return fail();
  const count = dimensions.slice(1).reduce((sum, width, index) =>
    sum + (dimensions[index] + 1) * width, 0);
  if (count !== artifact.parameters || count > 140000) return fail();
  const bytes = decodePreviewInspectorRecoveryPriorWeights(artifact.weights);
  if (bytes?.length !== count) return fail();
  let checksum = 2166136261;
  for (const byte of bytes) checksum = Math.imul(checksum ^ byte, 16777619);
  if ((checksum >>> 0) !== artifact.checksum) return fail();
  const layers = [];
  let offset = 0;
  for (let index = 0; index < 3; index += 1) {
    const inputSize = dimensions[index];
    const outputSize = dimensions[index + 1];
    const weights = new Float32Array(inputSize * outputSize);
    const biases = new Float32Array(outputSize);
    for (const array of [weights, biases]) {
      for (let cell = 0; cell < array.length; cell += 1) {
        const byte = bytes[offset++];
        array[cell] = (byte > 127 ? byte - 256 : byte) * scales[index];
      }
    }
    layers.push({ biases, inputSize, output: new Float32Array(outputSize), outputSize, weights });
  }
  previewInspectorRecoveryPriorNetwork = layers;
  return layers;
}

/** Reuses scratch arrays synchronously and skips zero inputs; no allocation occurs per layer. */
function runPreviewInspectorRecoveryPrior(vector, network) {
  let input = vector;
  for (const [layerIndex, layer] of network.entries()) {
    layer.output.set(layer.biases);
    for (let index = 0; index < layer.inputSize; index += 1) {
      const value = input[index];
      if (value === 0) continue;
      const offset = index * layer.outputSize;
      for (let output = 0; output < layer.outputSize; output += 1) {
        layer.output[output] += value * layer.weights[offset + output];
      }
    }
    if (layerIndex < network.length - 1) {
      for (let index = 0; index < layer.outputSize; index += 1) {
        layer.output[index] = Math.max(0, layer.output[index]);
      }
    }
    input = layer.output;
  }
  return 1 / (1 + Math.exp(-Math.max(-20, Math.min(20, input[0]))));
}

/** Memoizes at most 64 anonymous vectors, checking all cells after a hash hit to avoid collisions. */
function scorePreviewInspectorRecoveryPriorVector(vector, network) {
  let hash = 2166136261;
  for (const value of vector) hash = Math.imul(hash ^ Math.round(value * 1000000), 16777619);
  const cached = previewInspectorRecoveryPriorScores.get(hash);
  if (cached !== undefined && vector.every((value, index) => value === cached.vector[index])) {
    return cached.score;
  }
  const score = runPreviewInspectorRecoveryPrior(vector, network);
  if (!Number.isFinite(score)) return undefined;
  previewInspectorRecoveryPriorScores.delete(hash);
  previewInspectorRecoveryPriorScores.set(hash, { score, vector });
  if (previewInspectorRecoveryPriorScores.size > 64) {
    previewInspectorRecoveryPriorScores.delete(previewInspectorRecoveryPriorScores.keys().next().value);
  }
  return score;
}

/** Scores the whole portfolio or abstains; unsupported candidates can never be silently penalized. */
function rankPreviewInspectorRecoveryPrior(rawSpecifications, decisions, excludedIds) {
  if (!Array.isArray(rawSpecifications) || rawSpecifications.length < 2 || rawSpecifications.length > 12) return undefined;
  const portfolio = preparePreviewInspectorRecoveryPriorPortfolio(rawSpecifications, decisions, excludedIds);
  if (portfolio === undefined) return undefined;
  const { specifications, indices } = portfolio;
  if (!Array.isArray(specifications) || specifications.length < 2 || specifications.length > 12) return undefined;
  const families = specifications.map(readPreviewInspectorRecoveryPriorFamily);
  if (families[0] === undefined || families.some((family) => family !== families[0])) return undefined;
  const vectors = specifications.map(encodePreviewInspectorRecoveryPriorFeatures);
  if (vectors.some((vector) => vector === undefined)) return undefined;
  if (vectors.some((vector) => !isPreviewInspectorRecoveryPriorVectorSupported(vector, families[0]))) return undefined;
  const network = readPreviewInspectorRecoveryPriorNetwork();
  if (network === undefined) return undefined;
  const rawScores = vectors.map((vector, index) => indices.includes(index)
    ? scorePreviewInspectorRecoveryPriorVector(vector, network) : undefined);
  if (indices.some((index) => !Number.isFinite(rawScores[index]))) return undefined;
  const scores = rawScores.map((score, index) => score === undefined ? undefined :
    Math.max(0, score - Math.min(0.075, estimatePreviewInspectorRecoveryPriorCost(specifications[index]) * 0.0015)));
  const ordered = [...indices].sort((left, right) => scores[right] - scores[left]);
  const [first, second] = ordered;
  if (rawScores[first] < 0.8) return undefined;
  const clearSuccess = rawScores[first] - rawScores[second] >= 0.2;
  const cheaperConfidentSuccess = rawScores[first] >= 0.9 && rawScores[second] >= 0.9 &&
    scores[first] - scores[second] >= 0.02;
  if (!clearSuccess && !cheaperConfidentSuccess) return undefined;
  return { family: families[0], id: PREVIEW_INSPECTOR_RECOVERY_PRIOR_ARTIFACT.id, scores };
}

/** Abstains outside the training domain; the log-space allowance permits modest count variation. */
function isPreviewInspectorRecoveryPriorVectorSupported(vector, family) {
  const bounds = PREVIEW_INSPECTOR_RECOVERY_PRIOR_ARTIFACT.domains?.[family];
  if (!Array.isArray(bounds?.minimum) || !Array.isArray(bounds?.maximum) ||
      bounds.minimum.length !== 48 || bounds.maximum.length !== 48) return false;
  return bounds.minimum.every((minimum, index) => {
    const maximum = bounds.maximum[index];
    return Number.isFinite(minimum) && Number.isFinite(maximum) && minimum <= maximum &&
      minimum >= -1 && maximum <= 1 &&
      vector[96 + index] >= minimum - 0.12 && vector[96 + index] <= maximum + 0.12;
  });
}

/** General experience blends in; the prior never compares tried candidates against untried ones. */
function comparePreviewInspectorRecoveryPriorScores(left, right) {
  if (left.outcomeAttempts > 0 || right.outcomeAttempts > 0 || left.headKey !== right.headKey ||
      typeof left.priorVersion !== 'string' || left.priorVersion !== right.priorVersion ||
      !Number.isFinite(left.priorScore) || !Number.isFinite(right.priorScore)) return 0;
  const evidence = Math.max(left.headEvidence ?? 0, right.headEvidence ?? 0);
  const onlineWeight = Math.min(0.75, evidence / (evidence + 32));
  const difference = (right.priorScore - left.priorScore) * (1 - onlineWeight) +
    (right.selectionScore - left.selectionScore) * onlineWeight;
  return Math.abs(difference) >= 0.02 ? difference : 0;
}

/** Keeps provenance in diagnostics without inventing verified attempts, confidence or updates. */
function copyPreviewInspectorRecoveryPriorMetadata(value) {
  return value?.priorVersion === PREVIEW_INSPECTOR_RECOVERY_PRIOR_ARTIFACT.id &&
    Number.isFinite(value?.priorScore) && value.priorScore >= 0 && value.priorScore <= 1
    ? { priorScore: value.priorScore, priorVersion: value.priorVersion }
    : {};
}
`;
}
