/**
 * Builds bounded causal/cost features for the packaged ranker, separate from persisted v4 keys.
 * Only compiler facts and verifier-owned counts are accepted; source, values and error text are
 * never encoded. Structural work units are an explicit estimate, not measured milliseconds.
 */

/** Emits dependency-free helpers shared verbatim by training and the browser runtime. */
export function createPreviewInspectorRecoveryPriorContextRuntimeSource(): string {
  return String.raw`
const PREVIEW_INSPECTOR_RECOVERY_PRIOR_CONTEXT_KEYS = Object.freeze([
  'collectionDemandCount', 'callableDemandCount', 'stringDemandCount', 'numericDemandCount',
  'scalarGuardCount', 'nestedThrowCount', 'rootOwnsRouter', 'routeEvidencePresent',
  'layoutWrapperCount', 'providerWrapperCount', 'callInvocationCount', 'failedCandidateCount',
  'verifiedFailureCount', 'remainingCandidateCount', 'repairCostUnits', 'contextPresent',
]);

/** Rejects non-finite or negative counts without coercing workspace objects or numeric strings. */
function readPreviewInspectorRecoveryPriorCount(value) {
  return Number.isFinite(value) && value >= 0 ? Math.min(10000, value) : 0;
}

/** Estimates bounded reconstruction work from already available structural facts, not display rank. */
function estimatePreviewInspectorRecoveryPriorCost(specification) {
  const numbers = specification?.numbers ?? {};
  const count = (key) => readPreviewInspectorRecoveryPriorCount(numbers[key]);
  switch (specification?.holeKind) {
    case 'page-choice-context':
      return Math.min(50, 1 + count('pathDepth') + count('wrapperCount') + count('conditionalCount') * 2);
    case 'page-execution-context':
      return Math.min(50, 1 + count('authoredOwnerDepth') + count('nestedMountCount') * 2);
    case 'blocker-exception-runtime-value':
      return Math.min(50, 1 + count('nestedFallbackCount') + count('requiredPathCount') / 4 + count('branchOpening'));
    default:
      return 1;
  }
}

/** Reads only closed fields; missing context stays distinct from an explicitly observed zero. */
function readPreviewInspectorRecoveryPriorContext(specification) {
  const raw = specification?.recoveryContext;
  const present = raw !== null && typeof raw === 'object' && !Array.isArray(raw);
  const rawTokens = Array.isArray(specification?.tokens) ? specification.tokens : [];
  const tokens = rawTokens.length <= 64 ? rawTokens : [...rawTokens.slice(0, 48), ...rawTokens.slice(-16)];
  const has = (token) => Number(tokens.includes(token));
  const context = {};
  for (const key of PREVIEW_INSPECTOR_RECOVERY_PRIOR_CONTEXT_KEYS) {
    context[key] = present ? readPreviewInspectorRecoveryPriorCount(raw[key]) : 0;
  }
  context.rootOwnsRouter = has('root-owns-router:true');
  context.routeEvidencePresent = Number(tokens.some((token) =>
    typeof token === 'string' && /^route-evidence:(?:authored|route-jsx|route-catalog|next-pages-filesystem|next-app-filesystem)$/u.test(token)));
  context.layoutWrapperCount = has('wrapper-kind:layout');
  context.providerWrapperCount = has('wrapper-kind:provider');
  context.callInvocationCount = has('invocation:call');
  context.remainingCandidateCount = present && Number.isFinite(raw.remainingCandidateCount)
    ? readPreviewInspectorRecoveryPriorCount(raw.remainingCandidateCount)
    : readPreviewInspectorRecoveryPriorCount(specification?.numbers?.candidateCount);
  context.repairCostUnits = estimatePreviewInspectorRecoveryPriorCost(specification);
  context.contextPresent = Number(present);
  return context;
}

/** Keeps the prior useful after failure, but never ranks a tried candidate or overrides local success. */
function preparePreviewInspectorRecoveryPriorPortfolio(specifications, decisions, excludedIds) {
  if (!Array.isArray(decisions)) return { specifications, indices: specifications.map((_, index) => index) };
  if (decisions.length !== specifications.length || decisions.some((decision) =>
    decision.outcomeAttempts > 0 && decision.consecutiveFailures === 0)) return undefined;
  const indices = decisions.flatMap((decision, index) =>
    decision.outcomeAttempts === 0 && !excludedIds?.has(decision.candidateId) ? [index] : []);
  if (indices.length < 2) return undefined;
  const failed = decisions.filter((decision) => decision.consecutiveFailures > 0);
  const failures = failed.reduce((sum, decision) => sum + decision.consecutiveFailures, 0);
  return {
    indices,
    specifications: specifications.map((specification) => {
      const context = specification.recoveryContext;
      // Cold legacy callers retain their exact missing-context representation.
      if (failed.length === 0 && context === undefined) return specification;
      return { ...specification, recoveryContext: {
        ...context,
        failedCandidateCount: Math.max(failed.length, readPreviewInspectorRecoveryPriorCount(context?.failedCandidateCount)),
        verifiedFailureCount: Math.max(failures, readPreviewInspectorRecoveryPriorCount(context?.verifiedFailureCount)),
        remainingCandidateCount: indices.length,
      } };
    }),
  };
}
`;
}
