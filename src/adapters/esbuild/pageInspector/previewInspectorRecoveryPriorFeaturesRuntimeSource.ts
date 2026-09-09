/**
 * Encodes compiler-admitted recovery portfolios for the offline-trained, read-only prior.
 * This is separate from the version-four online vector: persisted user learning stays compatible.
 * Unknown portfolios abstain, and neither workspace source nor runtime values enter the artifact.
 */
import { createPreviewInspectorRecoveryPriorContextRuntimeSource } from './previewInspectorRecoveryPriorContextRuntimeSource';

/** Emits the identical bounded encoder used by the browser and the owned training corpus. */
export function createPreviewInspectorRecoveryPriorFeaturesRuntimeSource(): string {
  return String.raw`
${createPreviewInspectorRecoveryPriorContextRuntimeSource()}
const PREVIEW_INSPECTOR_RECOVERY_PRIOR_INPUT_SIZE = 144;
const PREVIEW_INSPECTOR_RECOVERY_PRIOR_NUMBER_KEYS = Object.freeze([
  'nestedFallbackCount', 'requiredPathCount', 'exactSmartPathCount', 'branchOpening',
  'callableCandidateCount', 'retainsData', 'referentialCoherence', 'semanticPathDepth',
  'complete', 'entryConnected', 'targetAffinity', 'pathDepth', 'conditionalCount',
  'callerCount', 'edgeCount', 'invocationModeCount', 'pathGroupSize', 'rootStepIndex',
  'routeSlotCount', 'wrapperCount', 'candidateCount', 'possibilityCount',
  'authoredOwnerDepth', 'missingOwnerCount', 'nestedMountCount', 'fidelityRank',
  'selectionPriority', 'conditionLine', 'rowCount', 'fieldCount',
  'literalVariantCount', 'renderedCollectionCount',
]);

/** Rejects incomplete or unsupported semantics instead of applying a prior to arbitrary actions. */
function readPreviewInspectorRecoveryPriorFamily(specification) {
  const numbers = specification?.numbers;
  const rawTokens = specification?.tokens;
  if (numbers === null || typeof numbers !== 'object' || Array.isArray(numbers) ||
      !Array.isArray(rawTokens)) return undefined;
  const tokens = rawTokens.length <= 64 ? rawTokens : [...rawTokens.slice(0, 48), ...rawTokens.slice(-16)];
  const has = (names) => names.every((name) =>
    Object.hasOwn(numbers, name) && Number.isFinite(numbers[name]) &&
    numbers[name] >= 0 && numbers[name] <= 10000,
  );
  const includes = (value) => tokens.includes(value);
  const binary = (names) => names.every((name) => numbers[name] === 0 || numbers[name] === 1);
  switch (specification?.holeKind) {
    case 'blocker-exception-runtime-value':
      return has(['nestedFallbackCount', 'requiredPathCount', 'exactSmartPathCount', 'branchOpening']) &&
        binary(['branchOpening']) &&
        numbers.nestedFallbackCount > 0 &&
        (includes('strategy:shape-only') || includes('strategy:branch-opening')) &&
        (includes('compiler-branch-proof:true') || includes('compiler-branch-proof:false'))
        ? 'exception' : undefined;
    case 'rendered-collection-consumer-data':
      return has(['callableCandidateCount', 'retainsData']) && binary(['retainsData']) && numbers.callableCandidateCount > 0 &&
        includes('role:collection-filter-predicate') &&
        (includes('strategy:data-retaining-call-result') || includes('strategy:neutral-call-result'))
        ? 'collection' : undefined;
    case 'render-state-reference-value':
      return has(['referentialCoherence', 'semanticPathDepth']) &&
        binary(['referentialCoherence']) &&
        includes('compiler-semantic-demand:identity') &&
        (includes('strategy:generated-identity-reference') || includes('strategy:independent-generated-value'))
        ? 'identity' : undefined;
    case 'page-choice-context':
      return has(['complete', 'entryConnected', 'targetAffinity', 'pathDepth', 'conditionalCount']) &&
        binary(['complete', 'entryConnected', 'targetAffinity']) &&
        includes('compiler-admitted:true') ? 'page-choice' : undefined;
    case 'page-execution-context':
      return has(['authoredOwnerDepth', 'missingOwnerCount', 'fidelityRank']) &&
        includes('page-context-missing:true') ? 'page-execution' : undefined;
    case 'authored-local-state-transition':
      return has(['selectionPriority', 'candidateCount']) && includes('desired:true') &&
        tokens.some((token) => typeof token === 'string' && token.startsWith('setter:'))
        ? 'local-ui' : undefined;
    default:
      return undefined;
  }
}

/** Hashes only bounded feature labels; deterministic rank and raw candidate ids are not inputs. */
function hashPreviewInspectorRecoveryPriorFeature(text) {
  let hash = 2166136261;
  for (let index = 0; index < Math.min(text.length, 96); index += 1) {
    hash = Math.imul(hash ^ text.charCodeAt(index), 16777619);
  }
  return hash >>> 0;
}

/** Builds a compact vector with collision-free numeric slots and bounded semantic token cells. */
function encodePreviewInspectorRecoveryPriorFeatures(specification) {
  const family = readPreviewInspectorRecoveryPriorFamily(specification);
  if (family === undefined) return undefined;
  const vector = new Float32Array(PREVIEW_INSPECTOR_RECOVERY_PRIOR_INPUT_SIZE);
  const rawTokens = specification.tokens;
  const bounded = rawTokens.length <= 64 ? rawTokens : [...rawTokens.slice(0, 48), ...rawTokens.slice(-16)];
  // Unknown names, source paths, conditions and setter identities are not learned semantics.
  const semantic = bounded.filter((token) => typeof token === 'string' &&
    (/^(?:strategy|role|compiler-branch-proof|compiler-semantic-demand|fidelity):/u.test(token) ||
      /^(?:authored-kind|fallback-kind):(?:undefined|null|boolean|number|string|array|object|function)$/u.test(token)),
  );
  const tokens = ['family:' + family, 'hole:' + specification.holeKind, ...semantic.slice(0, 24)];
  for (const token of tokens) {
    const hash = hashPreviewInspectorRecoveryPriorFeature(token);
    vector[hash % 96] += (hash & 256) === 0 ? 1 : -1;
  }
  let norm = 0;
  for (let index = 0; index < 96; index += 1) norm += vector[index] * vector[index];
  norm = Math.sqrt(norm) || 1;
  for (let index = 0; index < 96; index += 1) vector[index] /= norm;
  for (const [index, key] of PREVIEW_INSPECTOR_RECOVERY_PRIOR_NUMBER_KEYS.entries()) {
    const value = specification.numbers[key];
    if (!Number.isFinite(value)) continue;
    vector[96 + index] = Math.sign(value) * Math.log1p(Math.min(10000, Math.abs(value))) / 10;
  }
  const context = readPreviewInspectorRecoveryPriorContext(specification);
  for (const [index, key] of PREVIEW_INSPECTOR_RECOVERY_PRIOR_CONTEXT_KEYS.entries()) {
    vector[128 + index] = Math.log1p(context[key]) / 10;
  }
  return vector;
}
`;
}
