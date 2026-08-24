/**
 * Generates the Page Inspector registry that bypasses render-critical hook failures.
 *
 * Compiler-issued hook wrappers call this runtime only in Page Inspector mode. The runtime keeps
 * successful complete values untouched, rethrows Suspense thenables, and substitutes or overlays a
 * bounded static value only when Auto values is enabled and a required runtime path is unavailable.
 */
import { createPreviewInspectorGeneratedValueRuntimeSource } from './previewInspectorGeneratedValueRuntimeSource';
import { createPreviewInspectorBlockerValueRuntimeSource } from './previewInspectorBlockerValueRuntimeSource';
import { createPreviewInspectorHookGraphqlRuntimeSource } from './previewInspectorHookGraphqlRuntimeSource';
import { createPreviewInspectorLocalUiControllerRuntimeSource } from './previewInspectorLocalUiControllerRuntimeSource';
import { createPreviewInspectorOverlayActivationRuntimeSource } from './previewInspectorOverlayActivationRuntimeSource';

/** Maximum distinct hook fallback sites retained by one pinned Inspector session. */
export const PREVIEW_INSPECTOR_RUNTIME_FALLBACK_LIMIT = 256;

/** Repeated executions admitted for one authored effect site before render-only isolation. */
export const PREVIEW_INSPECTOR_RUNTIME_EFFECT_EXECUTION_LIMIT = 24;

/**
 * Creates browser source for hook-failure isolation, warning capture, and UI inventory reads.
 *
 * Expected lexical bindings include the Inspector session, Auto values helpers, console formatting,
 * original console primitives, and coalesced notification functions from the composed runtime.
 *
 * @returns Plain JavaScript source evaluated before project modules are dynamically imported.
 */
export function createPreviewInspectorRuntimeFallbackRuntimeSource(): string {
  const generatedValueRuntimeSource = createPreviewInspectorGeneratedValueRuntimeSource();
  const blockerValueRuntimeSource = createPreviewInspectorBlockerValueRuntimeSource();
  const hookGraphqlRuntimeSource = createPreviewInspectorHookGraphqlRuntimeSource();
  const localUiControllerRuntimeSource = createPreviewInspectorLocalUiControllerRuntimeSource();
  const overlayActivationRuntimeSource = createPreviewInspectorOverlayActivationRuntimeSource();
  return String.raw`
const PREVIEW_INSPECTOR_RUNTIME_FALLBACK_LIMIT = ${PREVIEW_INSPECTOR_RUNTIME_FALLBACK_LIMIT};
const PREVIEW_INSPECTOR_RUNTIME_FALLBACK_TEXT_LIMIT = 1_000;
const PREVIEW_INSPECTOR_RUNTIME_EFFECT_EXECUTION_LIMIT = ${PREVIEW_INSPECTOR_RUNTIME_EFFECT_EXECUTION_LIMIT};
const PREVIEW_INSPECTOR_RUNTIME_EFFECT_FRAME_FALLBACK_MS = 16;
const PREVIEW_INSPECTOR_RUNTIME_GENERATED_IDENTITY_VALUE = 'preview-id';
const PREVIEW_INSPECTOR_TARGET_RENDER_CHAIN_BRIDGE = Symbol.for('newdlops.react-file-preview.target-render-chain');
const previewInspectorScheduleRuntimeFallbackMicrotask =
  typeof globalThis.queueMicrotask === 'function'
    ? globalThis.queueMicrotask.bind(globalThis)
    : (callback) => Promise.resolve().then(callback);
function previewInspectorScheduleRuntimeEffectFrame(callback) {
  let delivered = false;
  const deliver = () => {
    if (delivered) return;
    delivered = true;
    callback();
  };
  const hasAnimationFrame = typeof globalThis.requestAnimationFrame === 'function';
  const hasTimer = typeof globalThis.setTimeout === 'function';
  if (hasAnimationFrame) globalThis.requestAnimationFrame(deliver);
  if (hasTimer) {
    globalThis.setTimeout(deliver, PREVIEW_INSPECTOR_RUNTIME_EFFECT_FRAME_FALLBACK_MS);
  } else if (!hasAnimationFrame) {
    previewInspectorScheduleRuntimeFallbackMicrotask(deliver);
  }
}

/** Lazily initializes ephemeral blocker records and stable fallback identities. */
function initializePreviewInspectorRuntimeFallbackState() {
  if (!(previewInspectorSession.runtimeFallbacks instanceof Map)) {
    previewInspectorSession.runtimeFallbacks = new Map();
  }
  if (!(previewInspectorSession.runtimeFallbackValues instanceof Map)) {
    previewInspectorSession.runtimeFallbackValues = new Map();
  }
  if (!(previewInspectorSession.runtimeFallbackOverrides instanceof Map)) {
    const persisted = readPersistedPreviewInspectorState();
    const persistedOverrides = persisted.runtimeFallbackOverrides;
    const entries = persistedOverrides !== null && typeof persistedOverrides === 'object'
      ? Object.entries(persistedOverrides).filter(
          ([fallbackId]) => typeof fallbackId === 'string' && fallbackId.length > 0,
        )
      : [];
    previewInspectorSession.runtimeFallbackOverrides = new Map(
      entries.slice(0, PREVIEW_INSPECTOR_RUNTIME_FALLBACK_LIMIT),
    );
  }
  if (!(previewInspectorSession.runtimeFallbackMaterializedOverrides instanceof Map)) {
    previewInspectorSession.runtimeFallbackMaterializedOverrides = new Map();
  }
  if (!(previewInspectorSession.runtimeFallbackCompletions instanceof WeakMap)) {
    previewInspectorSession.runtimeFallbackCompletions = new WeakMap();
  }
  if (!(previewInspectorSession.runtimeFallbackAuthoredValues instanceof Map)) {
    previewInspectorSession.runtimeFallbackAuthoredValues = new Map();
  }
  if (!(previewInspectorSession.runtimeFallbackSharedSmartPathValues instanceof WeakMap)) {
    previewInspectorSession.runtimeFallbackSharedSmartPathValues = new WeakMap();
  }
  if (!(previewInspectorSession.runtimeFallbackSharedNeuralRecommendations instanceof WeakMap)) {
    previewInspectorSession.runtimeFallbackSharedNeuralRecommendations = new WeakMap();
  }
  if (!(previewInspectorSession.runtimeFallbackSharedNeuralRecommendationsByContract instanceof Map)) {
    previewInspectorSession.runtimeFallbackSharedNeuralRecommendationsByContract = new Map();
  }
  if (!(previewInspectorSession.runtimeFallbackContextIdentityByHook instanceof WeakMap)) {
    previewInspectorSession.runtimeFallbackContextIdentityByHook = new WeakMap();
  }
  if (!(previewInspectorSession.runtimeFallbackAmbiguousContextHooks instanceof WeakSet)) {
    previewInspectorSession.runtimeFallbackAmbiguousContextHooks = new WeakSet();
  }
  if (!(previewInspectorSession.runtimeFallbackSmartIds instanceof Set)) {
    previewInspectorSession.runtimeFallbackSmartIds = new Set();
  }
  if (!(previewInspectorSession.runtimeFallbackSmartPathSignatures instanceof Map)) {
    previewInspectorSession.runtimeFallbackSmartPathSignatures = new Map();
  }
  if (!(previewInspectorSession.runtimeFallbackNeuralDecisions instanceof Map)) {
    previewInspectorSession.runtimeFallbackNeuralDecisions = new Map();
  }
  if (!(previewInspectorSession.runtimeFallbackSemanticValueRecommendations instanceof Map)) {
    previewInspectorSession.runtimeFallbackSemanticValueRecommendations = new Map();
  }
  if (!(previewInspectorSession.runtimeFallbackNeuralListeners instanceof Set)) {
    previewInspectorSession.runtimeFallbackNeuralListeners = new Set();
  }
  if (!(previewInspectorSession.runtimeFallbackDataFlowRecommendations instanceof Map)) {
    previewInspectorSession.runtimeFallbackDataFlowRecommendations = new Map();
  }
  if (!(previewInspectorSession.runtimeFallbackDataFlowSignals instanceof Map)) {
    previewInspectorSession.runtimeFallbackDataFlowSignals = new Map();
  }
  if (!Array.isArray(previewInspectorSession.runtimeFallbackResolutionFrames)) {
    previewInspectorSession.runtimeFallbackResolutionFrames = [];
  }
  if (!(previewInspectorSession.runtimeEffectIsolations instanceof Map)) {
    previewInspectorSession.runtimeEffectIsolations = new Map();
  }
  if (!(previewInspectorSession.runtimeEffectExecutionWindows instanceof Map)) {
    previewInspectorSession.runtimeEffectExecutionWindows = new Map();
  }
  if (!(previewInspectorSession.targetRenderCommitChainsByToken instanceof WeakMap)) {
    previewInspectorSession.targetRenderCommitChainsByToken = new WeakMap();
  }
  if (!(previewInspectorSession.successfulRuntimeEffectSourcePathsByToken instanceof WeakMap)) {
    previewInspectorSession.successfulRuntimeEffectSourcePathsByToken = new WeakMap();
  }
}

/** Notifies mounted hook consumers after a shared neural decision has committed outside render. */
function notifyPreviewInspectorRuntimeFallbackNeuralSubscribers() {
  initializePreviewInspectorRuntimeFallbackState();
  let notifiedCount = 0;
  for (const listener of [...previewInspectorSession.runtimeFallbackNeuralListeners]) {
    try {
      listener();
      notifiedCount += 1;
    } catch {}
  }
  return notifiedCount;
}

/** Drops only cached Auto hook values so a new shared collection size is materialized on remount. */
function resetPreviewInspectorGeneratedRuntimeFallbackValues() {
  initializePreviewInspectorRuntimeFallbackState();
  previewInspectorSession.runtimeFallbackValues.clear();
  previewInspectorSession.runtimeFallbackDataFlowRecommendations.clear();
  previewInspectorSession.runtimeFallbackDataFlowSignals.clear();
  previewInspectorSession.runtimeFallbackCompletions = new WeakMap();
}

/** Remembers a successful exact effect even when a child layout effect precedes boundary mount. */
function rememberPreviewInspectorSuccessfulRuntimeEffect(rawMetadata, ownershipToken) {
  if (
    (typeof ownershipToken !== 'object' && typeof ownershipToken !== 'function') ||
    ownershipToken === null ||
    typeof rawMetadata?.sourcePath !== 'string' ||
    rawMetadata.sourcePath.length === 0
  ) return false;
  initializePreviewInspectorRuntimeFallbackState();
  const sourcePath = rawMetadata.sourcePath.replaceAll('\\', '/');
  const paths = previewInspectorSession.successfulRuntimeEffectSourcePathsByToken.get(
    ownershipToken,
  ) ?? new Set();
  paths.add(sourcePath);
  previewInspectorSession.successfulRuntimeEffectSourcePathsByToken.set(ownershipToken, paths);
  return true;
}

/** Reads only source identity recorded for the same private target ownership token. */
function hasPreviewInspectorSuccessfulRuntimeEffect(ownershipToken, sourcePath) {
  if (
    (typeof ownershipToken !== 'object' && typeof ownershipToken !== 'function') ||
    ownershipToken === null ||
    typeof sourcePath !== 'string' ||
    sourcePath.length === 0
  ) return false;
  initializePreviewInspectorRuntimeFallbackState();
  return previewInspectorSession.successfulRuntimeEffectSourcePathsByToken
    .get(ownershipToken)
    ?.has(sourcePath.replaceAll('\\', '/')) === true;
}

/** Records bounded cross-runtime Context/effect evidence without retaining project values. */
function recordPreviewInspectorTargetRenderChain(event) {
  try {
    initializePreviewInspectorRuntimeFallbackState();
    const key = previewInspectorSession.activeTargetReachabilityKey;
    if (typeof key !== 'string' || key.length === 0 || event === null || typeof event !== 'object') return;
    const activeEffect = previewInspectorSession.activeTargetRenderChainEffect;
    const ownershipToken = event.ownershipToken ?? activeEffect?.ownershipToken;
    if ((typeof ownershipToken !== 'object' && typeof ownershipToken !== 'function') || ownershipToken === null) return;
    let chain = previewInspectorSession.targetRenderCommitChainsByToken.get(ownershipToken);
    if (chain === undefined) {
      chain = { key, markedCalls: [], thunkTexts: [] };
      previewInspectorSession.targetRenderCommitChainsByToken.set(ownershipToken, chain);
    }
    if (event.kind === 'specialized-context-resolver') {
      chain.specializedReplacementExecuted = true;
      chain.resolverOutcome = String(event.outcome ?? 'unknown').slice(0, 80);
      if (typeof event.thunkText === 'string' && chain.thunkTexts.length < 4) chain.thunkTexts.push(event.thunkText.slice(0, 320));
    } else if (event.kind === 'marked-call') {
      const call = { effectId: typeof activeEffect?.id === 'string' ? activeEffect.id.slice(0, 240) : '', propertyPath: typeof event.propertyPath === 'string' ? event.propertyPath.slice(0, 240) : '', result: event.result === true };
      if (chain.markedCalls.length < 8) chain.markedCalls.push(call);
      chain.markedContextCallUsed = true;
      chain.markedCallEffectId = call.effectId;
      chain.markedCallPropertyPath = call.propertyPath;
      chain.markedCallResult = call.result;
    } else if (event.kind === 'target-fiber') {
      // A contextual rerender legitimately replaces the original empty exact-target Fiber. Keep
      // positive completion evidence and the pre-activation empty-input observation monotonic.
      chain.alternateFiberObserved ||= event.alternateFiberObserved === true;
      chain.childrenForwarded ||= event.childrenForwarded === true;
      chain.connectedHostCount = Math.max(chain.connectedHostCount ?? 0,
        Number.isSafeInteger(event.connectedHostCount) ? Math.max(0, event.connectedHostCount) : 0);
      chain.logicalTargetCount = Math.max(chain.logicalTargetCount ?? 0,
        Number.isSafeInteger(event.logicalTargetCount) ? Math.max(0, event.logicalTargetCount) : 0);
      if (chain.inputChildrenState === undefined) {
        chain.inputChildrenState = event.inputChildrenState === 'absent'
          ? 'absent'
          : 'meaningful-or-unsupported';
      } else if (chain.inputChildrenState !== 'absent') {
        chain.inputChildrenState = 'meaningful-or-unsupported';
      }
      chain.ownedHostObserved ||= event.ownedHostObserved === true;
      chain.privateOwnershipCount = Math.max(chain.privateOwnershipCount ?? 0,
        Number.isSafeInteger(event.privateOwnershipCount) ? Math.max(0, event.privateOwnershipCount) : 0);
      chain.returnedChildObserved ||= event.returnedChildObserved === true;
      chain.stableRerenderObserved ||= event.stableRerenderObserved === true;
      const topology = event.topology;
      if (topology !== null && typeof topology === 'object') {
        chain.currentBranchAmbiguous ||= topology.currentBranchAmbiguous === true;
        for (const field of [
          'currentExactTargetCount', 'currentTargetChildCount', 'currentRetainedChildCount',
          'currentDescendantHostCount', 'currentConnectedVisibleHostCount',
          'staleExactTargetCount', 'staleConnectedVisibleHostCount', 'locatorExactTargetCount',
        ]) {
          chain[field] = Math.max(chain[field] ?? 0,
            Number.isSafeInteger(topology[field]) ? Math.max(0, topology[field]) : 0);
        }
      }
    } else if (event.kind === 'target-fiber-observation') {
      const stage = typeof event.observationStage === 'string' ? event.observationStage : '';
      if ([
        'started', 'complete', 'failed-boundary-props', 'failed-target-fibers',
        'failed-topology', 'failed-target-input', 'failed-target-traversal',
        'failed-final-bridge',
      ].includes(stage)) chain.targetFiberObservationStage = stage;
    }
  } catch {}
}
try { globalThis[PREVIEW_INSPECTOR_TARGET_RENDER_CHAIN_BRIDGE] = recordPreviewInspectorTargetRenderChain; } catch {}

/** Returns only bounded scalars and generated thunk text for composition transport. */
function readPreviewInspectorTargetRenderCommitChain(reachabilityKey) {
  const state = previewInspectorSession.targetReachabilityByKey?.get?.(reachabilityKey);
  const boundary = state?.contextualTargetFallbackRequested === true &&
    typeof readPreviewInspectorContextualTargetBoundary === 'function'
    ? readPreviewInspectorContextualTargetBoundary(state)
    : undefined;
  const phase = state?.contextualTargetFallbackRequested === true ? 'contextual' : 'original';
  const ownershipToken = phase === 'contextual'
    ? boundary?.ownershipToken
    : state?.successfulRuntimeEffectContinuationTokensByPhase?.get?.(phase);
  const observeCurrentBoundary = typeof hasPreviewInspectorResolvedTargetOutput === 'function'
    ? hasPreviewInspectorResolvedTargetOutput.observeTargetRenderCommitChain
    : undefined;
  if (boundary !== undefined && typeof observeCurrentBoundary === 'function') {
    observeCurrentBoundary(boundary);
  }
  const chain = previewInspectorSession.targetRenderCommitChainsByToken?.get?.(ownershipToken);
  const mountedDecision = state?.mountedChildrenGateDecision;
  if (chain === undefined && mountedDecision === undefined) return undefined;
  const currentExactTargetCount = Number.isSafeInteger(chain?.currentExactTargetCount) ? Math.max(0, chain.currentExactTargetCount) : 0;
  const locatorExactTargetCount = Number.isSafeInteger(chain?.locatorExactTargetCount) ? Math.max(0, chain.locatorExactTargetCount) : 0;
  const currentTargetChildCount = Number.isSafeInteger(chain?.currentTargetChildCount) ? Math.max(0, chain.currentTargetChildCount) : 0;
  const currentRetainedChildCount = Number.isSafeInteger(chain?.currentRetainedChildCount) ? Math.max(0, chain.currentRetainedChildCount) : 0;
  const currentConnectedVisibleHostCount = Number.isSafeInteger(chain?.currentConnectedVisibleHostCount) ? Math.max(0, chain.currentConnectedVisibleHostCount) : 0;
  const topologyAmbiguous = chain?.currentBranchAmbiguous === true;
  const continuationAccepted = phase === 'contextual'
    ? state?.topologyContextualEffectContinuationAccepted === true
    : state?.topologyOriginalEffectContinuationAccepted === true;
  const delayedProbeFired = phase === 'contextual'
    ? state?.topologyContextualDelayedProbeFired === true
    : state?.topologyOriginalDelayedProbeFired === true;
  const boundaryIdentityRetained = phase === 'contextual'
    ? state?.topologyContextualBoundaryIdentityRetained === true
    : state?.topologyOriginalBoundaryIdentityRetained === true;
  const currentResolverDisagrees = currentConnectedVisibleHostCount !== 0 && chain?.ownedHostObserved !== true;
  const topologyObservationStage = typeof chain?.targetFiberObservationStage === 'string'
    ? chain.targetFiberObservationStage
    : 'not-observed';
  const contextualBoundaryFailure = phase === 'contextual' && boundary === undefined &&
    typeof readPreviewInspectorContextualTargetBoundaryFailure === 'function'
    ? readPreviewInspectorContextualTargetBoundaryFailure(state)
    : undefined;
  const topologyVerdict = topologyAmbiguous || currentResolverDisagrees
    ? 'D'
    : currentExactTargetCount !== locatorExactTargetCount
      ? 'A'
      : !continuationAccepted || !delayedProbeFired || !boundaryIdentityRetained || currentTargetChildCount === 0
        ? 'B'
        : 'C';
  const topologyReason = contextualBoundaryFailure !== undefined
    ? 'contextual-boundary-' + contextualBoundaryFailure
    : topologyObservationStage !== 'complete'
    ? 'target-fiber-observation-' + topologyObservationStage
    : topologyVerdict === 'D' ? 'current-root-ambiguous-or-resolver-disagrees'
      : topologyVerdict === 'A' ? 'locator-dfs-exact-target-disagrees'
        : topologyVerdict === 'B' ? 'continuation-or-post-effect-child-absent'
          : 'retained-child-without-visible-host';
  return {
    alternateFiberObserved: chain?.alternateFiberObserved === true,
    childrenForwarded: chain?.childrenForwarded === true,
    connectedHostCount: Number.isSafeInteger(chain?.connectedHostCount) ? Math.max(0, chain.connectedHostCount) : 0,
    effectCompletedAfterMarkedCall: chain?.effectCompletedAfterMarkedCall === true,
    firstBreak: chain?.specializedReplacementExecuted !== true ? 'specialized-replacement-not-executed' : chain?.markedContextCallUsed !== true ? 'marked-context-call-not-used' : chain?.effectCompletedAfterMarkedCall !== true ? 'effect-not-completed-after-marked-call' : chain?.stableRerenderObserved !== true ? 'stable-rerender-not-observed' : chain?.childrenForwarded !== true ? 'children-not-forwarded' : chain?.ownedHostObserved !== true ? 'owned-host-not-observed' : 'none',
    markedCallEffectId: typeof chain?.markedCallEffectId === 'string' ? chain.markedCallEffectId.slice(0, 240) : '',
    markedCallPropertyPath: typeof chain?.markedCallPropertyPath === 'string' ? chain.markedCallPropertyPath.slice(0, 240) : '',
    markedCallResult: chain?.markedCallResult === true,
    markedContextCallUsed: chain?.markedContextCallUsed === true,
    ownedHostObserved: chain?.ownedHostObserved === true,
    inputChildrenState: chain?.inputChildrenState === 'absent' ? 'absent' : 'meaningful-or-unsupported',
    logicalTargetCount: Number.isSafeInteger(chain?.logicalTargetCount) ? Math.max(0, chain.logicalTargetCount) : 0,
    privateOwnershipCount: Number.isSafeInteger(chain?.privateOwnershipCount) ? Math.max(0, chain.privateOwnershipCount) : 0,
    returnedChildObserved: chain?.returnedChildObserved === true,
    resolverOutcome: typeof chain?.resolverOutcome === 'string' ? chain.resolverOutcome.slice(0, 80) : 'unknown',
    specializedReplacementExecuted: chain?.specializedReplacementExecuted === true,
    stableRerenderObserved: chain?.stableRerenderObserved === true,
    topologyVerdict,
    topologyReason,
    topologyEffectContinuationAccepted: continuationAccepted,
    topologyDelayedProbeFired: delayedProbeFired,
    topologyBoundaryIdentityRetained: boundaryIdentityRetained,
    topologyCurrentBranchAmbiguous: topologyAmbiguous,
    topologyCurrentExactTargetCount: currentExactTargetCount,
    topologyLocatorExactTargetCount: locatorExactTargetCount,
    topologyCurrentTargetChildCount: currentTargetChildCount,
    topologyCurrentRetainedChildCount: currentRetainedChildCount,
    topologyCurrentConnectedVisibleHostCount: currentConnectedVisibleHostCount,
    topologyCurrentDescendantHostCount: Number.isSafeInteger(chain?.currentDescendantHostCount) ? Math.max(0, chain.currentDescendantHostCount) : 0,
    topologyStaleExactTargetCount: Number.isSafeInteger(chain?.staleExactTargetCount) ? Math.max(0, chain.staleExactTargetCount) : 0,
    topologyStaleConnectedVisibleHostCount: Number.isSafeInteger(chain?.staleConnectedVisibleHostCount) ? Math.max(0, chain.staleConnectedVisibleHostCount) : 0,
    thunkTexts: Array.isArray(chain?.thunkTexts) ? chain.thunkTexts.slice(0, 4).map((text) => String(text).slice(0, 320)) : [],
    mountedChildrenGateDecision: mountedDecision === null || typeof mountedDecision !== 'object'
      ? undefined
      : { ...mountedDecision },
  };
}

${localUiControllerRuntimeSource}

${generatedValueRuntimeSource}

${blockerValueRuntimeSource}

${overlayActivationRuntimeSource}

${hookGraphqlRuntimeSource}

/** Reports whether a thrown value is a Suspense thenable that React must continue to own. */
function isPreviewInspectorRuntimeThenable(value) {
  if ((typeof value !== 'object' && typeof value !== 'function') || value === null) return false;
  try {
    return typeof value.then === 'function';
  } catch {
    return false;
  }
}

/** Bounds compiler-proven fragment literals before they can affect generated browser data. */
function normalizePreviewInspectorRuntimeLiteralDemands(rawDemands) {
  const demands = [];
  const seen = new Set();
  for (const rawDemand of Array.isArray(rawDemands) ? rawDemands.slice(0, 32) : []) {
    if (rawDemand === null || typeof rawDemand !== 'object') continue;
    const path = rawDemand.path;
    const value = rawDemand.value;
    if (
      typeof path !== 'string' ||
      path.length === 0 ||
      path.length > 240 ||
      seen.has(path) ||
      !path.split('.').every(
        (segment) =>
          segment === '[]' ||
          (/^[A-Za-z_$][A-Za-z0-9_$]*$/u.test(segment) && !blockedInspectorPropNames.has(segment)),
      ) ||
      !(
        typeof value === 'string' ||
        typeof value === 'boolean' ||
        (typeof value === 'number' && Number.isFinite(value))
      )
    ) {
      continue;
    }
    seen.add(path);
    demands.push(Object.freeze({ path, value }));
  }
  return Object.freeze(demands);
}

/** Retains and ranks bounded scalar values statically proven for target-only Smart Fill. */
function normalizePreviewInspectorRuntimeSmartPathValues(rawValues, metadata) {
  const values = [];
  const seen = new Set();
  for (const rawValue of Array.isArray(rawValues) ? rawValues.slice(0, 32) : []) {
    if (rawValue === null || typeof rawValue !== 'object') continue;
    const path = normalizePreviewInspectorRequiredPropertyPaths([rawValue.path])[0];
    const value = rawValue.value;
    if (
      typeof path !== 'string' || path.length === 0 ||
      !(
        typeof value === 'string' || typeof value === 'boolean' ||
        (typeof value === 'number' && Number.isFinite(value))
      )
    ) continue;
    const role = ['collection-filter-predicate', 'render-state'].includes(rawValue.role)
      ? rawValue.role
      : undefined;
    const identity = role === 'render-state'
      ? path + '\0' + typeof value + '\0' + String(value)
      : path;
    if (seen.has(identity)) continue;
    seen.add(identity);
    values.push(Object.freeze({
      deterministicRank: Number.isFinite(rawValue.deterministicRank)
        ? Math.max(0, Number(rawValue.deterministicRank))
        : values.length,
      path,
      value,
      ...(role === undefined ? {} : { role }),
    }));
  }
  const selectedValues = values.filter((item) => item.role !== 'render-state');
  const renderStateGroups = new Map();
  for (const item of values.filter((candidate) => candidate.role === 'render-state')) {
    const group = renderStateGroups.get(item.path) ?? [];
    group.push(item);
    renderStateGroups.set(item.path, group);
  }
  let retainedSelection;
  for (const [path, group] of renderStateGroups) {
    const candidates = group.map((item, index) => {
      const semanticValue = String(item.value).toLowerCase().replace(/[^a-z0-9_-]+/gu, '-').slice(0, 48);
      return {
        deterministicRank: item.deterministicRank,
        id: 'render-state:' + typeof item.value + ':' + (semanticValue || String(index)),
        numbers: {
          authoredCandidateCount: group.length,
          authoredRank: item.deterministicRank,
        },
        texts: ['Select authored render state ' + String(item.value), path],
        tokens: [
          'role:render-state',
          'path:' + path,
          'semantic:' + semanticValue,
          'value-type:' + typeof item.value,
        ],
        value: item,
      };
    });
    const selection = typeof selectPreviewInspectorNeuralResidualCandidate === 'function'
      ? selectPreviewInspectorNeuralResidualCandidate(
          {
            blockerKind: 'runtime-fallback',
            holeKind: 'render-state-scalar',
            numbers: { authoredCandidateCount: candidates.length },
            texts: [
              metadata?.evidence,
              metadata?.hookName,
              metadata?.ownerName,
              metadata?.sourcePath,
              path,
            ],
            tokens: ['compiler-render-state-candidates', 'path:' + path],
          },
          candidates,
        )
      : undefined;
    const chosen = candidates.find((candidate) => candidate.id === selection?.candidateId) ??
      candidates.sort((left, right) =>
        left.deterministicRank - right.deterministicRank || left.id.localeCompare(right.id),
      )[0];
    if (chosen !== undefined) selectedValues.push(chosen.value);
    if (retainedSelection === undefined && selection !== undefined) retainedSelection = selection;
  }
  return Object.freeze({
    candidateId: retainedSelection?.candidateId,
    decision: retainedSelection?.decision,
    values: Object.freeze(selectedValues),
  });
}

/** Bounds compiler metadata before retaining it in the local webview session. */
function normalizePreviewInspectorRuntimeFallbackMetadata(metadata) {
  const source = metadata !== null && typeof metadata === 'object' ? metadata : {};
  const readText = (name, fallback = '') =>
    typeof source[name] === 'string'
      ? source[name].slice(0, PREVIEW_INSPECTOR_RUNTIME_FALLBACK_TEXT_LIMIT)
      : fallback;
  const smartPathSelection = normalizePreviewInspectorRuntimeSmartPathValues(
    source.smartPathValues,
    source,
  );
  const semanticValueDemand = normalizePreviewInspectorRuntimeSemanticValueDemand(
    source.semanticValueDemand,
  );
  return {
    column: Number.isSafeInteger(source.column) && source.column > 0 ? source.column : undefined,
    evidence: readText('evidence', 'bounded static hook usage inference'),
    failurePaths: normalizePreviewInspectorRequiredPropertyPaths(source.failurePaths),
    fallbackLabel: readText('fallbackLabel', 'generated static value'),
    hookName: readText('hookName', 'custom hook'),
    id: readText('id'),
    line: Number.isSafeInteger(source.line) && source.line > 0 ? source.line : undefined,
    literalDemands: normalizePreviewInspectorRuntimeLiteralDemands(source.literalDemands),
    moduleSpecifier: readText('moduleSpecifier'),
    nonNegativeNumberPaths: normalizePreviewInspectorRequiredPropertyPaths(
      source.nonNegativeNumberPaths,
    ),
    ownerName: readText('ownerName'),
    passive: source.passive === true,
    preserveNullish: source.preserveNullish === true,
    preserveSmartValue: source.preserveSmartValue === true,
    renderGuardPaths: normalizePreviewInspectorRequiredPropertyPaths(source.renderGuardPaths),
    requiredPaths: normalizePreviewInspectorRequiredPropertyPaths(source.requiredPaths),
    semanticValueDemand,
    neuralSmartPathDecision: smartPathSelection.decision,
    smartPathCandidateId: smartPathSelection.candidateId,
    smartPathValues: smartPathSelection.values,
    sourcePath: readText('sourcePath'),
  };
}

/** Accepts only compiler-issued scalar identity evidence at one normalized result path. */
function normalizePreviewInspectorRuntimeSemanticValueDemand(value) {
  if (value?.kind !== 'identity' || typeof value?.path !== 'string') return undefined;
  const path = normalizePreviewInspectorRequiredPropertyPaths([value.path])[0];
  const parsed = parsePreviewInspectorRequiredPath(path);
  if (
    typeof path !== 'string' || parsed === undefined || parsed.callable || parsed.collection ||
    parsed.stringReceiver || parsed.path.length === 0
  ) return undefined;
  return Object.freeze({ kind: 'identity', path });
}

/** Creates the exact compiler/runtime requirement coverage owned by one applied Smart value. */
function createPreviewInspectorRuntimeFallbackPathSignature(requiredPaths) {
  // Property access order can vary across equivalent React branches. Treat the evidence as a set so
  // an order-only change cannot reopen a settled Smart fallback and restart automatic resolution.
  return JSON.stringify([...normalizePreviewInspectorRequiredPropertyPaths(requiredPaths)].sort());
}

/** Separates a shared query-wrapper callsite into one fallback record per authored request. */
function scopePreviewInspectorRuntimeFallbackMetadata(metadata, readDocument, readOptions) {
  const renderPropPaths = readPreviewInspectorGraphqlRenderPropUsagePaths(readDocument);
  const renderPropLiteralDemands =
    readPreviewInspectorGraphqlRenderPropLiteralDemands(readDocument);
  const renderGuardPaths = renderPropLiteralDemands.map((demand) => demand.path);
  const mergedMetadata = renderPropPaths.length === 0 && renderGuardPaths.length === 0
    ? metadata
    : {
        ...metadata,
        requiredPaths: normalizePreviewInspectorRequiredPropertyPaths([
          ...metadata.requiredPaths,
          ...renderPropPaths,
        ]),
        renderGuardPaths: normalizePreviewInspectorRequiredPropertyPaths([
          ...metadata.renderGuardPaths,
          ...renderGuardPaths,
        ]),
      };
  if (mergedMetadata.id.length === 0) return mergedMetadata;
  const requestIdentity = createPreviewInspectorHookGraphqlRequestIdentity(
    readDocument,
    readOptions,
  );
  if (requestIdentity.length === 0) return mergedMetadata;
  const graphqlRequiredPaths = normalizePreviewInspectorRequiredPropertyPaths([
    ...mergedMetadata.requiredPaths,
    ...mergedMetadata.failurePaths,
  ]);
  const suffix = ':graphql:' + requestIdentity;
  return {
    ...mergedMetadata,
    graphqlSelectionBacked: true,
    id: mergedMetadata.id.slice(0, PREVIEW_INSPECTOR_RUNTIME_FALLBACK_TEXT_LIMIT - suffix.length) + suffix,
    /*
     * Optional access may keep an unknown hook root absent, but the reached DocumentNode already
     * proves which response fields exist. Once selection-shaped preview data is present, an Array
     * operation recorded as a failure path is authoritative type evidence and must repair a
     * schema-less object/list guess before application code invokes map/filter/find.
     */
    requiredPaths: graphqlRequiredPaths,
  };
}

/** Defers Inspector-only registry refreshes so a caught hook never updates UI during render. */
function schedulePreviewInspectorRuntimeFallbackRefresh(reachabilityKey) {
  const pendingKeys = previewInspectorSession.runtimeFallbackRefreshReachabilityKeys ??= new Set();
  if (typeof reachabilityKey === 'string' && reachabilityKey.length > 0) {
    pendingKeys.add(reachabilityKey);
  }
  if (previewInspectorSession.runtimeFallbackRefreshScheduled === true) return;
  previewInspectorSession.runtimeFallbackRefreshScheduled = true;
  previewInspectorScheduleRuntimeFallbackMicrotask(() => {
    previewInspectorSession.runtimeFallbackRefreshScheduled = false;
    schedulePreviewInspectorTreeRefresh();
    if (typeof schedulePreviewInspectorTargetRequirementContinuation === 'function') {
      for (const key of pendingKeys) schedulePreviewInspectorTargetRequirementContinuation(key);
    }
    pendingKeys.clear();
  });
}

/** Commits one learned recommendation only after the Auto transaction that found it has settled. */
function commitPreviewInspectorRuntimeNeuralRecommendationRetry(exportName, reachabilityKey) {
  previewInspectorSession.runtimeFallbackNeuralRetryScheduled = false;
  if (
    typeof exportName !== 'string' || exportName.length === 0 ||
    typeof refreshPreviewInspectorExport !== 'function' ||
    (
      typeof reachabilityKey === 'string' &&
      previewInspectorSession.activeTargetReachabilityKey !== reachabilityKey
    )
  ) return false;
  const corridorResumed = typeof resumePreviewInspectorTargetReachabilityAfterNeuralRecommendation ===
    'function' && typeof reachabilityKey === 'string'
    ? resumePreviewInspectorTargetReachabilityAfterNeuralRecommendation(reachabilityKey)
    : false;
  const notifiedSubscriberCount = notifyPreviewInspectorRuntimeFallbackNeuralSubscribers();
  refreshPreviewInspectorExport(exportName, false);
  if (typeof recordPreviewInspectorRuntimeHealth === 'function') {
    recordPreviewInspectorRuntimeHealth({
      category: 'neural-residual',
      detail: {
        corridorResumed,
        exportName,
        notifiedSubscriberCount,
        phase: 'retry-scheduled',
        reachabilityKey,
      },
      event: 'neural-residual-shared',
    });
  }
  return true;
}

/** Resets the page error boundary once after a newly learned target recommendation is available. */
function schedulePreviewInspectorRuntimeNeuralRecommendationRetry() {
  if (
    previewInspectorSession.runtimeFallbackNeuralRetryScheduled === true ||
    typeof refreshPreviewInspectorExport !== 'function'
  ) return false;
  const reachabilityKey = previewInspectorSession.activeTargetReachabilityKey;
  const state = typeof reachabilityKey === 'string'
    ? previewInspectorSession.targetReachabilityByKey?.get?.(reachabilityKey)
    : undefined;
  const exportName = typeof state?.targetExportName === 'string'
    ? state.targetExportName
    : previewInspectorSession.selectedExportName;
  if (typeof exportName !== 'string' || exportName.length === 0) return false;
  previewInspectorSession.runtimeFallbackNeuralRetryScheduled = true;
  const scheduleAfterCommit = typeof previewInspectorScheduleRuntimeEffectFrame === 'function'
    ? previewInspectorScheduleRuntimeEffectFrame
    : previewInspectorScheduleRuntimeFallbackMicrotask;
  scheduleAfterCommit(() => {
    const activeAttempt = previewInspectorSession.blockerTraceActiveAttempt;
    if (
      activeAttempt?.settledAt === undefined &&
      typeof reachabilityKey === 'string' &&
      activeAttempt?.targetReachabilityKey === reachabilityKey
    ) {
      activeAttempt.runtimeFallbackNeuralRetry = { exportName, reachabilityKey };
      if (typeof settlePreviewInspectorBlockerTraceAttempt === 'function') {
        settlePreviewInspectorBlockerTraceAttempt(activeAttempt, {
          outcome: 'superseded-by-neural-recommendation',
        });
        return;
      }
      /*
       * The export-boundary reset must wait for the active transaction, but mounted hook consumers
       * can safely observe the committed recommendation after this animation frame. Without this
       * notification an invisible stateful drawer can deadlock: its output is required to settle
       * the attempt that is itself withholding the learned state needed to make that output visible.
      */
      notifyPreviewInspectorRuntimeFallbackNeuralSubscribers();
      if (typeof recordPreviewInspectorRuntimeHealth === 'function') {
        recordPreviewInspectorRuntimeHealth({
          category: 'neural-residual',
          detail: { exportName, phase: 'retry-deferred', reachabilityKey },
          event: 'neural-residual-shared',
        });
      }
      return;
    }
    commitPreviewInspectorRuntimeNeuralRecommendationRetry(exportName, reachabilityKey);
  });
  return true;
}

/** Safely describes one generated fallback without retaining or invoking project-owned values. */
function describePreviewInspectorRuntimeFallbackValue(value) {
  try {
    return boundPreviewInspectorConsoleText(
      formatPreviewInspectorConsoleValue(value),
      PREVIEW_INSPECTOR_RUNTIME_FALLBACK_TEXT_LIMIT,
    );
  } catch {
    return '[Generated static value]';
  }
}

/** Creates one stable fallback value per compiler-issued hook identity. */
function readOrCreatePreviewInspectorRuntimeFallback(
  metadata,
  createFallback,
  readGraphqlDocument,
  readGraphqlOptions,
) {
  initializePreviewInspectorRuntimeFallbackState();
  if (previewInspectorSession.runtimeFallbackValues.has(metadata.id)) {
    /*
     * The metadata id already includes the GraphQL document and bounded identity variables. A
     * second enrichment would allocate a new data object and refetch closure on every component
     * render, retriggering application effects whose dependency arrays contain the query result.
     */
    return previewInspectorSession.runtimeFallbackValues.get(metadata.id);
  }
  const compilerFallback = createFallback();
  const graphqlFallback = createPreviewInspectorHookGraphqlFallback(
    compilerFallback,
    readGraphqlDocument,
    readGraphqlOptions,
  );
  const exactFallback = completePreviewInspectorGeneratedValue(graphqlFallback, compilerFallback, {
    renderGuardPaths: metadata.renderGuardPaths,
    requiredPaths: metadata.requiredPaths,
  }).value;
  const structuralFallback = createPreviewInspectorRuntimeFallbackAutoValue(
    exactFallback,
    metadata.requiredPaths,
  );
  const fallback = overlayPreviewInspectorHookGraphqlLiteralDemands(
    structuralFallback,
    readGraphqlDocument,
  );
  markPreviewInspectorGeneratedValue(fallback);
  if (previewInspectorSession.runtimeFallbackValues.size < PREVIEW_INSPECTOR_RUNTIME_FALLBACK_LIMIT) {
    previewInspectorSession.runtimeFallbackValues.set(metadata.id, fallback);
  }
  return fallback;
}

/** Creates the bounded residual problem shared by unseen identity-valued hook fields. */
function createPreviewInspectorRuntimeSemanticValueSpecification(metadata, demand) {
  return {
    blockerKind: 'runtime-fallback',
    holeKind: 'render-state-reference-value',
    numbers: {
      requiredPathCount: metadata.requiredPaths.length,
      semanticPathDepth: parsePreviewInspectorRequiredPath(demand.path)?.path.length ?? 0,
    },
    texts: [metadata.evidence, metadata.hookName, metadata.ownerName, demand.path],
    tokens: [
      'compiler-semantic-demand:' + demand.kind,
      'semantic-path-leaf:value',
      'value-source:generated-hook',
    ],
  };
}

/** Keeps materialization deterministic while the residual chooses only between admitted values. */
function createPreviewInspectorRuntimeSemanticValueCandidates() {
  return [
    {
      deterministicRank: 0,
      id: 'independent-generated-value',
      numbers: { referentialCoherence: 0 },
      texts: ['Retain the independently generated value leaf'],
      tokens: ['strategy:independent-generated-value'],
    },
    {
      deterministicRank: 1,
      id: 'generated-identity-reference',
      numbers: { referentialCoherence: 1 },
      texts: ['Reuse the generated collection identity convention'],
      tokens: ['strategy:generated-identity-reference'],
    },
  ];
}

/** Replaces one compiler-owned scalar path without invoking project getters or setters. */
function replacePreviewInspectorRuntimeFallbackSemanticValue(value, rawPath, replacement) {
  const parsed = parsePreviewInspectorRequiredPath(rawPath);
  if (
    parsed === undefined || parsed.callable || parsed.collection || parsed.stringReceiver ||
    parsed.path.length === 0
  ) return value;
  let template = copyPreviewInspectorBlockerValueForJson(value, { nodes: 0 });
  const indexedRoot = /^\d+$/u.test(parsed.path[0]);
  if (template === null || typeof template !== 'object' || Array.isArray(template) !== indexedRoot) {
    template = indexedRoot ? [] : {};
  }
  let current = template;
  for (const [index, propertyName] of parsed.path.entries()) {
    if (blockedInspectorPropNames.has(propertyName)) return value;
    if (index === parsed.path.length - 1) {
      current[propertyName] = replacement;
      break;
    }
    const expectsArray = /^\d+$/u.test(parsed.path[index + 1] ?? '');
    if (
      current[propertyName] === null || typeof current[propertyName] !== 'object' ||
      Array.isArray(current[propertyName]) !== expectsArray
    ) {
      current[propertyName] = expectsArray ? [] : {};
    }
    current = current[propertyName];
  }
  const materialized = materializePreviewInspectorRuntimeFallbackOverride(template);
  markPreviewInspectorGeneratedValue(materialized);
  return materialized;
}

/** Emits one compact self-supervised update without retaining the compiler field name or value. */
function recordPreviewInspectorRuntimeSemanticValueTraining(
  metadata,
  initialSelection,
  finalSelection,
  updateCount,
  lastUpdate,
) {
  if (typeof recordPreviewInspectorRuntimeHealth !== 'function') return;
  recordPreviewInspectorRuntimeHealth({
    category: 'neural-residual',
    detail: {
      candidateId: finalSelection?.candidateId,
      headKey: lastUpdate?.headKey,
      hookName: metadata.hookName,
      initialCandidateId: initialSelection?.candidateId,
      labelReason: 'compiler-identity-field-proof',
      modelUpdates: lastUpdate?.updates,
      ownerName: metadata.ownerName,
      phase: finalSelection?.candidateId === 'generated-identity-reference'
        ? 'learned-and-promoted'
        : 'learning-bounded-without-promotion',
      trainingExamples: updateCount,
    },
    event: 'neural-residual-trained',
  });
}

/**
 * Learns one compiler-proven reference mismatch after commit, then retries mounted hook consumers.
 * The cold path remains deterministic; only a verified semantic candidate may displace it later.
 */
function schedulePreviewInspectorRuntimeSemanticValueLearning(
  metadata,
  entry,
  specification,
  candidates,
) {
  if (entry.learningScheduled === true) return;
  entry.learningScheduled = true;
  if (typeof beginPreviewInspectorNeuralLearningStatus === 'function') {
    beginPreviewInspectorNeuralLearningStatus({
      headKey: 'render-state',
      labelReason: 'compiler-identity-field-proof',
    });
  }
  const scheduleAfterCommit = typeof previewInspectorScheduleRuntimeEffectFrame === 'function'
    ? previewInspectorScheduleRuntimeEffectFrame
    : previewInspectorScheduleRuntimeFallbackMicrotask;
  scheduleAfterCommit(() => {
    const compilerDecision = typeof selectPreviewInspectorNeuralResidualCandidate === 'function'
      ? selectPreviewInspectorNeuralResidualCandidate(specification, [candidates[0]])?.decision
      : undefined;
    const identityDecision = typeof selectPreviewInspectorNeuralResidualCandidate === 'function'
      ? selectPreviewInspectorNeuralResidualCandidate(specification, [candidates[1]])?.decision
      : undefined;
    let finalSelection = entry.selection;
    let lastUpdate;
    let updateCount = 0;
    for (let pass = 0; pass < 8 && finalSelection?.candidateId !== 'generated-identity-reference'; pass += 1) {
      const negativeUpdate = typeof trainPreviewInspectorNeuralResidualDecision === 'function'
        ? trainPreviewInspectorNeuralResidualDecision(compilerDecision, 0)
        : undefined;
      const positiveUpdate = typeof trainPreviewInspectorNeuralResidualDecision === 'function'
        ? trainPreviewInspectorNeuralResidualDecision(identityDecision, 1)
        : undefined;
      if (negativeUpdate !== undefined) {
        lastUpdate = negativeUpdate;
        updateCount += 1;
      }
      if (positiveUpdate !== undefined) {
        lastUpdate = positiveUpdate;
        updateCount += 1;
      }
      finalSelection = typeof selectPreviewInspectorNeuralResidualCandidate === 'function'
        ? selectPreviewInspectorNeuralResidualCandidate(specification, candidates)
        : finalSelection;
    }
    entry.selection = finalSelection;
    entry.learningComplete = true;
    if (finalSelection?.decision !== undefined) {
      previewInspectorSession.runtimeFallbackNeuralDecisions.set(
        metadata.id,
        finalSelection.decision,
      );
    }
    recordPreviewInspectorRuntimeSemanticValueTraining(
      metadata,
      entry.initialSelection,
      finalSelection,
      updateCount,
      lastUpdate,
    );
    if (typeof finishPreviewInspectorNeuralLearningStatus === 'function') {
      finishPreviewInspectorNeuralLearningStatus({
        headKey: lastUpdate?.headKey,
        labelReason: 'compiler-identity-field-proof',
        modelUpdates: lastUpdate?.updates,
        phase: finalSelection?.candidateId === 'generated-identity-reference'
          ? 'learned-and-promoted'
          : 'learning-bounded-without-promotion',
        success: finalSelection?.candidateId === 'generated-identity-reference',
        trainingExamples: updateCount,
      });
    }
    if (
      finalSelection?.decision !== undefined &&
      typeof recordPreviewInspectorNeuralResidualSelection === 'function'
    ) {
      recordPreviewInspectorNeuralResidualSelection(
        finalSelection.decision,
        { mode: 'auto-semantic-retry' },
        'semantic-value-retry:' + metadata.id,
      );
    }
    if (finalSelection?.candidateId === 'generated-identity-reference') {
      schedulePreviewInspectorRuntimeNeuralRecommendationRetry();
    }
  });
}

/** Selects and applies a learned referentially coherent value for one compiler-proven field leaf. */
function createPreviewInspectorRuntimeSemanticValueRecommendation(metadata, compilerFallback) {
  const demand = metadata.semanticValueDemand;
  if (demand?.kind !== 'identity') return undefined;
  const parsed = parsePreviewInspectorRequiredPath(demand.path);
  if (parsed === undefined) return undefined;
  const generatedValue = readPreviewInspectorRequiredPathSeed(compilerFallback, parsed.path);
  const signature = JSON.stringify([
    typeof readPreviewInspectorNeuralLearningModelUpdates === 'function'
      ? readPreviewInspectorNeuralLearningModelUpdates()
      : 0,
    demand.kind,
    demand.path,
    generatedValue === PREVIEW_INSPECTOR_RUNTIME_GENERATED_IDENTITY_VALUE,
  ]);
  let entry = previewInspectorSession.runtimeFallbackSemanticValueRecommendations.get(metadata.id);
  if (entry?.signature !== signature) {
    const specification = createPreviewInspectorRuntimeSemanticValueSpecification(metadata, demand);
    const candidates = createPreviewInspectorRuntimeSemanticValueCandidates();
    const selection = typeof selectPreviewInspectorNeuralResidualCandidate === 'function'
      ? selectPreviewInspectorNeuralResidualCandidate(specification, candidates)
      : undefined;
    entry = {
      initialSelection: selection,
      learningComplete: generatedValue === PREVIEW_INSPECTOR_RUNTIME_GENERATED_IDENTITY_VALUE,
      learningScheduled: false,
      selection,
      signature,
    };
    if (
      previewInspectorSession.runtimeFallbackSemanticValueRecommendations.size <
        PREVIEW_INSPECTOR_RUNTIME_FALLBACK_LIMIT
    ) {
      previewInspectorSession.runtimeFallbackSemanticValueRecommendations.set(metadata.id, entry);
    }
    if (selection?.decision !== undefined) {
      previewInspectorSession.runtimeFallbackNeuralDecisions.set(metadata.id, selection.decision);
      if (typeof recordPreviewInspectorNeuralResidualSelection === 'function') {
        recordPreviewInspectorNeuralResidualSelection(
          selection.decision,
          { mode: 'auto-semantic-discovery' },
          'semantic-value:' + metadata.id,
        );
      }
    }
    if (
      generatedValue !== PREVIEW_INSPECTOR_RUNTIME_GENERATED_IDENTITY_VALUE &&
      selection?.candidateId !== 'generated-identity-reference'
    ) {
      schedulePreviewInspectorRuntimeSemanticValueLearning(
        metadata,
        entry,
        specification,
        candidates,
      );
    }
  }
  const useIdentityReference =
    generatedValue === PREVIEW_INSPECTOR_RUNTIME_GENERATED_IDENTITY_VALUE ||
    entry?.selection?.candidateId === 'generated-identity-reference';
  if (!useIdentityReference) return undefined;
  const value = replacePreviewInspectorRuntimeFallbackSemanticValue(
    compilerFallback,
    demand.path,
    PREVIEW_INSPECTOR_RUNTIME_GENERATED_IDENTITY_VALUE,
  );
  return Object.freeze({
    decision: entry?.selection?.decision,
    metadata: {
      ...metadata,
      neuralRecommendation: Object.freeze({
        candidateId: 'generated-identity-reference',
        label: 'Learned generated identity reference',
        path: demand.path,
        residual: typeof summarizePreviewInspectorNeuralResidualDecision === 'function'
          ? summarizePreviewInspectorNeuralResidualDecision(entry?.selection?.decision)
          : undefined,
        strategy: 'generated-identity-reference',
        value: PREVIEW_INSPECTOR_RUNTIME_GENERATED_IDENTITY_VALUE,
      }),
      renderGuardPaths: normalizePreviewInspectorRequiredPropertyPaths([
        ...metadata.renderGuardPaths,
        demand.path,
      ]),
      residualHoleKind: 'render-state-reference-value',
    },
    value,
  });
}

/** Prevents semantic Auto learning from replacing a complete application-owned field value. */
function shouldUsePreviewInspectorRuntimeSemanticValueRecommendation(
  metadata,
  authoredValue,
  failure,
  resolutionFrame,
) {
  const demand = metadata.semanticValueDemand;
  if (demand === undefined) return false;
  if (
    failure !== undefined ||
    (Array.isArray(resolutionFrame?.children) && resolutionFrame.children.length > 0) ||
    isPreviewInspectorMarkedGeneratedValue(authoredValue)
  ) return true;
  const parsed = parsePreviewInspectorRequiredPath(demand.path);
  return parsed !== undefined &&
    readPreviewInspectorRequiredPathSeed(authoredValue, parsed.path) === undefined;
}

/** Returns whether a user supplied an explicit JSON result for one render-blocking hook edge. */
function hasPreviewInspectorRuntimeFallbackOverride(fallbackId) {
  initializePreviewInspectorRuntimeFallbackState();
  return previewInspectorSession.runtimeFallbackOverrides.has(fallbackId);
}

/** Selects the user value before compiler-inferred Auto data for one isolated hook edge. */
function readPreviewInspectorRuntimeFallbackValue(
  metadata,
  createFallback,
  readGraphqlDocument,
  readGraphqlOptions,
) {
  initializePreviewInspectorRuntimeFallbackState();
  if (previewInspectorSession.runtimeFallbackOverrides.has(metadata.id)) {
    const source = previewInspectorSession.runtimeFallbackOverrides.get(metadata.id);
    const cached = previewInspectorSession.runtimeFallbackMaterializedOverrides.get(metadata.id);
    if (cached?.source === source) return cached.value;
    const value = materializePreviewInspectorRuntimeFallbackOverride(source);
    previewInspectorSession.runtimeFallbackMaterializedOverrides.set(metadata.id, { source, value });
    return value;
  }
  return readOrCreatePreviewInspectorRuntimeFallback(
    metadata,
    createFallback,
    readGraphqlDocument,
    readGraphqlOptions,
  );
}

/**
 * Promotes exact target-only Smart scalars to render guards after that fallback is selected.
 *
 * Ordinary Auto completion keeps every non-nullish authored value, including intentionally dormant
 * Redux/Context state. Once target reachability explicitly Smart-fills this hook, however, a
 * compiler-proven overlay value such as State.Default must replace the existing State.Hidden;
 * otherwise the generated value is visible only in diagnostics and never reaches the component.
 */
function createPreviewInspectorRuntimeSmartCompletionMetadata(metadata) {
  initializePreviewInspectorRuntimeFallbackState();
  if (!previewInspectorSession.runtimeFallbackSmartIds.has(metadata.id)) return metadata;
  const smartPaths = (Array.isArray(metadata.smartPathValues) ? metadata.smartPathValues : [])
    .map((item) => item?.path)
    .filter((path) => typeof path === 'string' && path.length > 0);
  if (smartPaths.length === 0) return metadata;
  return {
    ...metadata,
    renderGuardPaths: normalizePreviewInspectorRequiredPropertyPaths([
      ...(metadata.renderGuardPaths ?? []),
      ...smartPaths,
    ]),
  };
}

/** Reports whether a successful hook result can safely act as a shared state-carrier identity. */
function isPreviewInspectorRuntimeFallbackSharedIdentity(value) {
  return (typeof value === 'object' || typeof value === 'function') && value !== null;
}

/**
 * Mirrors the compiler-proven custom-hook to raw-Context identity into the Inspector session.
 * A conflicting registration becomes permanently ambiguous, matching the Context bridge policy.
 */
function registerPreviewInspectorRuntimeContextIdentity(hookIdentity, contextIdentity) {
  initializePreviewInspectorRuntimeFallbackState();
  if (
    typeof hookIdentity !== 'function' ||
    !isPreviewInspectorRuntimeFallbackSharedIdentity(contextIdentity) ||
    previewInspectorSession.runtimeFallbackAmbiguousContextHooks.has(hookIdentity)
  ) return false;
  const current = previewInspectorSession.runtimeFallbackContextIdentityByHook.get(hookIdentity);
  if (current === contextIdentity) return true;
  if (current !== undefined) {
    previewInspectorSession.runtimeFallbackContextIdentityByHook.delete(hookIdentity);
    previewInspectorSession.runtimeFallbackAmbiguousContextHooks.add(hookIdentity);
    return false;
  }
  previewInspectorSession.runtimeFallbackContextIdentityByHook.set(hookIdentity, contextIdentity);
  return true;
}

/** Resolves a non-ambiguous raw Context identity for one exact imported custom hook. */
function readPreviewInspectorRuntimeContextIdentity(hookIdentity) {
  if (
    typeof hookIdentity !== 'function' ||
    previewInspectorSession.runtimeFallbackAmbiguousContextHooks.has(hookIdentity)
  ) return undefined;
  return previewInspectorSession.runtimeFallbackContextIdentityByHook.get(hookIdentity);
}

/** Canonicalizes a bounded exact-scalar overlay independently of compiler discovery order. */
function createPreviewInspectorRuntimeSharedSmartSignature(values) {
  return JSON.stringify(
    (Array.isArray(values) ? values : [])
      .map((item) => [item?.path, item?.value, item?.role])
      .sort((left, right) => String(left[0]).localeCompare(String(right[0]))),
  );
}

/**
 * Shares a selected target's Smart discriminator with consumers of the same authored hook carrier.
 *
 * Context hooks commonly expose one memoized value to the page shell and selected panel. Object
 * identity is stronger than import spelling (aliases and relative paths can name the same hook),
 * and it prevents an inferred state from leaking to an unrelated hook with a coincidentally equal
 * shape. When the hook itself throws because its Provider is absent, the exact imported hook
 * function is the only shared carrier available; it is used only for failed calls. Conflicting
 * scalars fail closed while complementary exact paths are merged.
 */
function promotePreviewInspectorRuntimeSmartValueToSharedIdentity(fallbackId, metadata) {
  initializePreviewInspectorRuntimeFallbackState();
  const authored = previewInspectorSession.runtimeFallbackAuthoredValues.get(fallbackId);
  if (!isPreviewInspectorRuntimeFallbackSharedIdentity(authored)) return false;
  const incoming = Array.isArray(metadata?.smartPathValues)
    ? metadata.smartPathValues.slice(0, 32)
    : [];
  if (incoming.length === 0) return false;
  const previous = previewInspectorSession.runtimeFallbackSharedSmartPathValues.get(authored);
  const byPath = new Map(
    (Array.isArray(previous?.values) ? previous.values : []).map((item) => [item.path, item]),
  );
  for (const item of incoming) {
    const retained = byPath.get(item.path);
    if (retained === undefined) {
      byPath.set(item.path, item);
    } else if (!Object.is(retained.value, item.value)) {
      // Two selected-target proofs disagree about one state carrier. Preserve the first bounded
      // decision instead of creating a state combination that no authored render can produce.
      continue;
    }
  }
  const values = Object.freeze([...byPath.values()]);
  const signature = createPreviewInspectorRuntimeSharedSmartSignature(values);
  if (previous?.signature === signature) return false;
  previewInspectorSession.runtimeFallbackSharedSmartPathValues.set(
    authored,
    Object.freeze({ signature, values }),
  );
  return true;
}

/** Retains only exact Smart-capable hook identities and refreshes a changed memoized carrier. */
function rememberPreviewInspectorRuntimeSmartAuthoredValue(metadata, value, failedHookIdentity) {
  initializePreviewInspectorRuntimeFallbackState();
  const carrier = isPreviewInspectorRuntimeFallbackSharedIdentity(value)
    ? value
    : isPreviewInspectorRuntimeFallbackSharedIdentity(failedHookIdentity)
      ? failedHookIdentity
      : undefined;
  if (
    carrier === undefined ||
    !Array.isArray(metadata?.smartPathValues) ||
    metadata.smartPathValues.length === 0
  ) return false;
  if (
    !previewInspectorSession.runtimeFallbackAuthoredValues.has(metadata.id) &&
    previewInspectorSession.runtimeFallbackAuthoredValues.size >=
      PREVIEW_INSPECTOR_RUNTIME_FALLBACK_LIMIT
  ) return false;
  previewInspectorSession.runtimeFallbackAuthoredValues.set(metadata.id, carrier);
  if (!previewInspectorSession.runtimeFallbackSmartIds.has(metadata.id)) return false;
  return promotePreviewInspectorRuntimeSmartValueToSharedIdentity(metadata.id, metadata);
}

/** Reads a previously selected projection only from the exact shared authored object. */
function readPreviewInspectorRuntimeSharedSmartProjection(value) {
  initializePreviewInspectorRuntimeFallbackState();
  return isPreviewInspectorRuntimeFallbackSharedIdentity(value)
    ? previewInspectorSession.runtimeFallbackSharedSmartPathValues.get(value)
    : undefined;
}

/** Adds a shared exact-state overlay to this consumer's compiler fallback without losing fields. */
function createPreviewInspectorRuntimeSharedSmartCompletion(metadata, value, fallback) {
  const projection = readPreviewInspectorRuntimeSharedSmartProjection(value);
  const values = Array.isArray(projection?.values) ? projection.values : [];
  const paths = values.map((item) => item?.path).filter(
    (path) => typeof path === 'string' && path.length > 0,
  );
  if (paths.length === 0) return { fallback, metadata, projected: false };
  const generated = createPreviewInspectorRuntimeFallbackSmartValue(value, paths, values);
  const completedFallback = completePreviewInspectorGeneratedValue(fallback, generated, {
    renderGuardPaths: paths,
    requiredPaths: paths,
  });
  return {
    fallback: completedFallback.changed ? completedFallback.value : fallback,
    metadata: {
      ...metadata,
      renderGuardPaths: normalizePreviewInspectorRequiredPropertyPaths([
        ...(metadata.renderGuardPaths ?? []),
        ...paths,
      ]),
      requiredPaths: normalizePreviewInspectorRequiredPropertyPaths([
        ...(metadata.requiredPaths ?? []),
        ...paths,
      ]),
    },
    projected: true,
  };
}

/** Includes exact compiler-owned Smart scalars when deciding whether one fill is still current. */
function createPreviewInspectorRuntimeFallbackSmartSignature(metadata, requiredPaths) {
  const pathSignature = createPreviewInspectorRuntimeFallbackPathSignature(
    requiredPaths ?? metadata?.requiredPaths ?? [],
  );
  const smartSignature = JSON.stringify(
    (Array.isArray(metadata?.smartPathValues) ? metadata.smartPathValues : [])
      .map((item) => [item?.path, item?.value, item?.role]),
  );
  return pathSignature + ':' + smartSignature;
}

/** Detects a dormant authored scalar that has one statically proven target-visible alternative. */
function hasPreviewInspectorRuntimeSmartAlternative(metadata, value) {
  for (const item of Array.isArray(metadata?.smartPathValues) ? metadata.smartPathValues : []) {
    if (item?.path === '<root>') {
      if (!Object.is(value, item.value)) return true;
      continue;
    }
    const parsed = parsePreviewInspectorRequiredPath(item?.path);
    if (parsed === undefined) continue;
    const current = readPreviewInspectorRequiredPathSeed(value, parsed.path);
    if (!Object.is(current, item.value)) return true;
  }
  return false;
}

/** Opens a bounded causal frame so an outer hook can recognize values produced by nested fallbacks. */
function beginPreviewInspectorRuntimeFallbackResolutionFrame(metadata) {
  initializePreviewInspectorRuntimeFallbackState();
  const frame = { children: [], id: metadata.id };
  previewInspectorSession.runtimeFallbackResolutionFrames.push(frame);
  return frame;
}

/** Removes only the exact active frame, including when authored hook execution throws. */
function finishPreviewInspectorRuntimeFallbackResolutionFrame(frame) {
  const frames = previewInspectorSession.runtimeFallbackResolutionFrames;
  if (!Array.isArray(frames)) return;
  if (frames.at(-1) === frame) {
    frames.pop();
    return;
  }
  const index = frames.lastIndexOf(frame);
  if (index >= 0) frames.splice(index, 1);
}

/**
 * Reports generated child output to its active caller without retaining the child value itself.
 * This supplies causal provenance for primitives, which cannot carry the generated-value marker.
 */
function reportPreviewInspectorNestedRuntimeFallback(metadata, reason, generatedPaths) {
  const frames = previewInspectorSession.runtimeFallbackResolutionFrames;
  const parent = Array.isArray(frames) ? frames.at(-1) : undefined;
  if (parent === undefined || parent.children.length >= 12 || parent.id === metadata.id) return;
  parent.children.push(Object.freeze({
    hookName: metadata.hookName,
    id: metadata.id,
    reason: String(reason ?? 'generated').slice(0, 80),
    requiredPaths: normalizePreviewInspectorRequiredPropertyPaths(generatedPaths),
  }));
}

/** Returns a stable coarse kind used only as a neural feature token. */
function readPreviewInspectorRuntimeFallbackValueKind(value) {
  if (value === null) return 'null';
  if (Array.isArray(value)) return 'array';
  return typeof value;
}

/** Reports whether the compiler proves a property below the hook-result root. */
function hasPreviewInspectorRuntimeFallbackDescendantRequirement(metadata) {
  return normalizePreviewInspectorRequiredPropertyPaths([
    ...(metadata?.requiredPaths ?? []),
    ...(metadata?.smartPathValues ?? []).map((item) => item?.path),
  ]).some((path) => path !== '<root>' && path !== '<root>()');
}

/** Resolves one imported hook contract across callsites without trusting a bare local hook name. */
function createPreviewInspectorRuntimeFallbackHookContractKey(metadata) {
  const hookName = typeof metadata?.hookName === 'string' ? metadata.hookName : '';
  const moduleSpecifier = typeof metadata?.moduleSpecifier === 'string'
    ? metadata.moduleSpecifier.replaceAll('\\', '/')
    : '';
  if (hookName.length === 0 || moduleSpecifier.length === 0) return '';
  if (!moduleSpecifier.startsWith('.')) return moduleSpecifier + '#' + hookName;
  const sourcePath = typeof metadata?.sourcePath === 'string'
    ? metadata.sourcePath.replaceAll('\\', '/')
    : '';
  if (sourcePath.length === 0) return '';
  const segments = sourcePath.split('/');
  segments.pop();
  for (const segment of moduleSpecifier.split('/')) {
    if (segment.length === 0 || segment === '.') continue;
    if (segment === '..') segments.pop();
    else segments.push(segment);
  }
  return segments.join('/') + '#' + hookName;
}

/** Reads a selected-target recommendation by exact identity, then its resolved import contract. */
function readPreviewInspectorRuntimeSharedNeuralRecommendation(metadata, hookIdentity) {
  const accepts = (recommendation) =>
    metadata?.smartPathCandidateId === undefined ||
    recommendation?.smartPathCandidateId === undefined ||
    recommendation.smartPathCandidateId === metadata?.smartPathCandidateId;
  if (isPreviewInspectorRuntimeFallbackSharedIdentity(hookIdentity)) {
    const byIdentity = previewInspectorSession.runtimeFallbackSharedNeuralRecommendations.get(
      hookIdentity,
    );
    if (byIdentity !== undefined && accepts(byIdentity)) {
      return { match: 'identity', recommendation: byIdentity };
    }
  }
  const contractKey = createPreviewInspectorRuntimeFallbackHookContractKey(metadata);
  const byContract = contractKey.length === 0
    ? undefined
    : previewInspectorSession.runtimeFallbackSharedNeuralRecommendationsByContract.get(contractKey);
  return byContract === undefined || !accepts(byContract)
    ? undefined
    : { match: 'contract', recommendation: byContract };
}

/** Stores one target recommendation across its exact hook, Context, and resolved import contract. */
function storePreviewInspectorRuntimeSharedNeuralRecommendation(
  metadata,
  hookIdentity,
  recommendation,
  origin,
) {
  const contractKey = createPreviewInspectorRuntimeFallbackHookContractKey(metadata);
  const contextIdentity = readPreviewInspectorRuntimeContextIdentity(hookIdentity);
  if (
    !isPreviewInspectorRuntimeFallbackSharedIdentity(hookIdentity) &&
    !isPreviewInspectorRuntimeFallbackSharedIdentity(contextIdentity) &&
    contractKey.length === 0
  ) return false;
  let signature;
  try {
    signature = JSON.stringify([
      recommendation?.strategy,
      metadata?.smartPathCandidateId,
      metadata?.sourcePath,
      normalizePreviewInspectorRequiredPropertyPaths(recommendation?.sharedGuardPaths),
      recommendation?.value,
    ]);
  } catch {
    signature = String(recommendation?.strategy ?? 'neural-recommendation');
  }
  const sharedRecommendation = Object.freeze({
    label: recommendation?.label,
    residual: recommendation?.residual,
    sharedGuardPaths: normalizePreviewInspectorRequiredPropertyPaths(
      recommendation?.sharedGuardPaths,
    ),
    smartPathCandidateId: metadata?.smartPathCandidateId,
    sourcePath: typeof metadata?.sourcePath === 'string'
      ? metadata.sourcePath.replaceAll('\\', '/')
      : '',
    strategy: recommendation?.strategy,
    signature,
    value: recommendation?.value,
  });
  let changed = false;
  if (isPreviewInspectorRuntimeFallbackSharedIdentity(hookIdentity)) {
    changed ||= previewInspectorSession.runtimeFallbackSharedNeuralRecommendations.get(
      hookIdentity,
    )?.signature !== signature;
    previewInspectorSession.runtimeFallbackSharedNeuralRecommendations.set(
      hookIdentity,
      sharedRecommendation,
    );
  }
  if (isPreviewInspectorRuntimeFallbackSharedIdentity(contextIdentity)) {
    changed ||= previewInspectorSession.runtimeFallbackSharedNeuralRecommendations.get(
      contextIdentity,
    )?.signature !== signature;
    previewInspectorSession.runtimeFallbackSharedNeuralRecommendations.set(
      contextIdentity,
      sharedRecommendation,
    );
  }
  if (
    contractKey.length > 0 &&
    (
      previewInspectorSession.runtimeFallbackSharedNeuralRecommendationsByContract.has(
        contractKey,
      ) ||
      previewInspectorSession.runtimeFallbackSharedNeuralRecommendationsByContract.size <
        PREVIEW_INSPECTOR_RUNTIME_FALLBACK_LIMIT
    )
  ) {
    changed ||= previewInspectorSession.runtimeFallbackSharedNeuralRecommendationsByContract.get(
      contractKey,
    )?.signature !== signature;
    previewInspectorSession.runtimeFallbackSharedNeuralRecommendationsByContract.set(
      contractKey,
      sharedRecommendation,
    );
  }
  if (!changed) return false;
  previewInspectorSession.runtimeFallbackNeuralRevision =
    (previewInspectorSession.runtimeFallbackNeuralRevision ?? 0) + 1;
  if (typeof recordPreviewInspectorRuntimeHealth === 'function') {
    recordPreviewInspectorRuntimeHealth({
      category: 'neural-residual',
      detail: {
        hookName: metadata.hookName,
        origin,
        ownerName: metadata.ownerName,
        phase: 'stored',
        sharedBy: [
          ...(isPreviewInspectorRuntimeFallbackSharedIdentity(hookIdentity) ? ['identity'] : []),
          ...(isPreviewInspectorRuntimeFallbackSharedIdentity(contextIdentity)
            ? ['context-identity']
            : []),
          ...(contractKey.length > 0 ? ['contract'] : []),
        ],
        sharedGuardPaths: sharedRecommendation.sharedGuardPaths,
        strategy: sharedRecommendation.strategy,
      },
      event: 'neural-residual-shared',
    });
  }
  return true;
}

/** Reads only compiler-tagged callable candidates that can retain a rendered collection. */
function readPreviewInspectorRuntimeFallbackDataFlowSmartValues(metadata) {
  return (Array.isArray(metadata?.smartPathValues) ? metadata.smartPathValues : [])
    .filter((item) =>
      item?.role === 'collection-filter-predicate' &&
      typeof item?.path === 'string' && item.path.endsWith('()') &&
      typeof item?.value === 'boolean',
    )
    .slice(0, 8);
}

/** Trains on observed generated-call flow, not on the presence of an empty-state DOM node. */
function observePreviewInspectorRuntimeFallbackDataFlowSignal(signal, decision, metadata) {
  if (signal?.scheduled === true || decision === undefined) return;
  signal.scheduled = true;
  const startedAt = Date.now();
  const observe = () => {
    if (signal.observed === true) return;
    if ((signal.calls ?? 0) === 0 && Date.now() - startedAt < 320) {
      if (typeof globalThis.setTimeout === 'function') globalThis.setTimeout(observe, 32);
      return;
    }
    signal.observed = true;
    if ((signal.calls ?? 0) === 0) return;
    const retentionRatio = Math.max(
      0,
      Math.min(1, Number(signal.truthyReturns ?? 0) / Number(signal.calls)),
    );
    const label = retentionRatio * 0.65;
    const update = typeof trainPreviewInspectorNeuralResidualDecision === 'function'
      ? trainPreviewInspectorNeuralResidualDecision(decision, label)
      : undefined;
    if (update !== undefined && typeof recordPreviewInspectorRuntimeHealth === 'function') {
      recordPreviewInspectorRuntimeHealth({
        category: 'neural-residual',
        detail: {
          callCount: signal.calls,
          candidateId: decision.candidateId,
          headKey: update.headKey,
          hookName: metadata.hookName,
          label: update.label,
          labelReason: label > 0
            ? 'generated-collection-retained'
            : 'generated-collection-dropped',
          ownerName: metadata.ownerName,
          pathCount: signal.paths.size,
          prediction: update.prediction,
          truthyReturnCount: signal.truthyReturns,
          updates: update.updates,
        },
        event: 'neural-residual-data-flow-trained',
      });
    }
  };
  if (typeof globalThis.setTimeout === 'function') globalThis.setTimeout(observe, 0);
  else previewInspectorScheduleRuntimeFallbackMicrotask(observe);
}

/**
 * Lets the residual choose a callable data valve and keeps its cold compiler fallback unchanged.
 * The first unseen site explores the data-retaining candidate; verified call flow then owns later
 * ranking through the isolated data-collection head.
 */
function createPreviewInspectorRuntimeFallbackDataFlowRecommendation(metadata, compilerFallback) {
  const smartValues = readPreviewInspectorRuntimeFallbackDataFlowSmartValues(metadata);
  if (smartValues.length === 0) return undefined;
  const signature = JSON.stringify([
    typeof readPreviewInspectorNeuralLearningModelUpdates === 'function'
      ? readPreviewInspectorNeuralLearningModelUpdates()
      : 0,
    smartValues.map((item) => [item.path, item.value, item.role]),
  ]);
  const cached = previewInspectorSession.runtimeFallbackDataFlowRecommendations.get(metadata.id);
  if (cached?.signature === signature) return cached;
  const requiredPaths = normalizePreviewInspectorRequiredPropertyPaths(metadata.requiredPaths);
  const candidates = [
    {
      deterministicRank: 0,
      id: 'retain-generated-collection',
      numbers: { callableCandidateCount: smartValues.length, retainsData: 1 },
      texts: ['Return the compiler-admitted predicate candidate and retain generated rows'],
      tokens: ['strategy:data-retaining-call-result', 'role:collection-filter-predicate'],
    },
    {
      deterministicRank: 1,
      id: 'neutral-callable',
      numbers: { callableCandidateCount: smartValues.length, retainsData: 0 },
      texts: ['Keep the generated callable inert'],
      tokens: ['strategy:neutral-call-result', 'role:collection-filter-predicate'],
    },
  ];
  const selection = typeof selectPreviewInspectorNeuralResidualCandidate === 'function'
    ? selectPreviewInspectorNeuralResidualCandidate(
        {
          blockerKind: 'runtime-fallback',
          holeKind: 'rendered-collection-consumer-data',
          numbers: {
            callableCandidateCount: smartValues.length,
            requiredPathCount: requiredPaths.length,
          },
          texts: [
            metadata.evidence,
            metadata.hookName,
            metadata.ownerName,
            metadata.sourcePath,
            ...smartValues.map((item) => item.path),
          ],
          tokens: [
            'compiler-call-result-candidate',
            ...smartValues.map((item) => 'role:' + item.role),
          ],
        },
        candidates,
      )
    : undefined;
  const candidateId = selection?.candidateId === 'neutral-callable'
    ? 'neutral-callable'
    : 'retain-generated-collection';
  const selectedSmartValues = candidateId === 'retain-generated-collection'
    ? smartValues
    : [];
  const draft = createPreviewInspectorRuntimeFallbackSmartDraftTemplate(
    compilerFallback,
    requiredPaths,
    selectedSmartValues,
  );
  const signal = {
    calls: 0,
    candidateId,
    observed: false,
    paths: new Set(smartValues.map((item) => item.path.slice(0, -2))),
    scheduled: false,
    truthyReturns: 0,
  };
  const value = materializePreviewInspectorRuntimeFallbackOverride(draft, 0, signal);
  markPreviewInspectorGeneratedValue(value);
  const recommendation = Object.freeze({
    candidateId,
    decision: selection?.decision,
    signal,
    signature,
    summary: Object.freeze({
      candidateId,
      label: candidateId === 'retain-generated-collection'
        ? 'Learned data-retaining callable'
        : 'Learned neutral callable',
      paths: Object.freeze(smartValues.map((item) => item.path)),
      residual: typeof summarizePreviewInspectorNeuralResidualDecision === 'function'
        ? summarizePreviewInspectorNeuralResidualDecision(selection?.decision)
        : undefined,
      strategy: candidateId,
    }),
    value,
  });
  previewInspectorSession.runtimeFallbackDataFlowRecommendations.set(metadata.id, recommendation);
  previewInspectorSession.runtimeFallbackDataFlowSignals.set(metadata.id, signal);
  if (selection?.decision !== undefined) {
    previewInspectorSession.runtimeFallbackNeuralDecisions.set(metadata.id, selection.decision);
    observePreviewInspectorRuntimeFallbackDataFlowSignal(signal, selection.decision, metadata);
  }
  return recommendation;
}

/**
 * Creates a typed recommendation when a nested generated primitive contradicts its caller's shape.
 * The neural residual sees semantic candidate descriptions only; materialization remains in the
 * existing bounded blocker-value runtime and defaults to the non-branch-opening shape on a tie.
 */
function createPreviewInspectorNestedRuntimeFallbackRecommendation(
  metadata,
  authoredValue,
  compilerFallback,
  resolutionFrame,
  hookIdentity,
) {
  const authoredKind = readPreviewInspectorRuntimeFallbackValueKind(authoredValue);
  const fallbackKind = readPreviewInspectorRuntimeFallbackValueKind(compilerFallback);
  const requiredPaths = normalizePreviewInspectorRequiredPropertyPaths(metadata.requiredPaths);
  const sharedMatch = readPreviewInspectorRuntimeSharedNeuralRecommendation(
    metadata,
    hookIdentity,
  );
  const sharedRecommendation = sharedMatch?.recommendation;
  if (sharedRecommendation !== undefined) {
    const sharedValue = materializePreviewInspectorRuntimeFallbackOverride(
      copyPreviewInspectorBlockerValueForJson(sharedRecommendation.value, { nodes: 0 }),
    );
    const localDraft = createPreviewInspectorRuntimeFallbackSmartDraftTemplate(
      compilerFallback,
      requiredPaths,
      [],
    );
    const localValue = materializePreviewInspectorRuntimeFallbackOverride(localDraft);
    const localCompletion = completePreviewInspectorGeneratedValue(sharedValue, localValue, {
      requiredPaths,
    });
    const compatibleSharedValue = localCompletion.changed
      ? localCompletion.value
      : sharedValue;
    const sharedGuardPaths = normalizePreviewInspectorRequiredPropertyPaths(
      sharedRecommendation.sharedGuardPaths,
    );
    const authoredCompletion = isPreviewInspectorRuntimeFallbackSharedIdentity(authoredValue)
      ? completePreviewInspectorGeneratedValue(authoredValue, compatibleSharedValue, {
          renderGuardPaths: sharedGuardPaths,
          requiredPaths: normalizePreviewInspectorRequiredPropertyPaths([
            ...requiredPaths,
            ...sharedGuardPaths,
          ]),
        })
      : { changed: false, value: authoredValue };
    const value = authoredCompletion.changed
      ? authoredCompletion.value
      : isPreviewInspectorRuntimeFallbackSharedIdentity(authoredValue)
        ? authoredValue
        : compatibleSharedValue;
    markPreviewInspectorGeneratedValue(value);
    if (typeof recordPreviewInspectorRuntimeHealth === 'function') {
      recordPreviewInspectorRuntimeHealth({
        category: 'neural-residual',
        detail: {
          authoredKind,
          changed: authoredCompletion.changed === true,
          hookName: metadata.hookName,
          match: sharedMatch.match,
          ownerName: metadata.ownerName,
          phase: 'applied',
          sharedGuardValuePreview: sharedGuardPaths.map((rawPath) => {
            const parsed = parsePreviewInspectorRequiredPath(rawPath);
            const pathValue = parsed === undefined
              ? undefined
              : readPreviewInspectorRequiredPathSeed(value, parsed.path);
            return rawPath + '=' + describePreviewInspectorRuntimeFallbackValue(pathValue);
          }).join(', '),
          sharedGuardPaths,
          strategy: sharedRecommendation.strategy,
        },
        event: 'neural-residual-shared',
      });
    }
    return {
      decision: undefined,
      generatedPaths: normalizePreviewInspectorRequiredPropertyPaths([
        ...requiredPaths,
        ...sharedGuardPaths,
      ]),
      shared: true,
      strategy: sharedRecommendation.strategy,
      summary: {
        ...sharedRecommendation,
        nestedFallbacks: (resolutionFrame?.children ?? []).map((child) => ({
          hookName: child.hookName,
          reason: child.reason,
        })),
        requiredPaths,
        shared: true,
        value: copyPreviewInspectorBlockerValueForJson(value, { nodes: 0 }),
      },
      value,
    };
  }
  if (
    !Array.isArray(resolutionFrame?.children) || resolutionFrame.children.length === 0 ||
    authoredValue === null || authoredValue === undefined ||
    (typeof authoredValue === 'object' || typeof authoredValue === 'function') ||
    (typeof compilerFallback !== 'object' && typeof compilerFallback !== 'function') ||
    compilerFallback === null ||
    !hasPreviewInspectorRuntimeFallbackDescendantRequirement(metadata)
  ) return undefined;
  const shapeDraft = createPreviewInspectorRuntimeFallbackSmartDraftTemplate(
    compilerFallback,
    requiredPaths,
    [],
  );
  const branchDraft = createPreviewInspectorRuntimeFallbackSmartDraftTemplate(
    compilerFallback,
    requiredPaths,
    metadata.smartPathValues,
  );
  let distinctBranchDraft = false;
  try { distinctBranchDraft = JSON.stringify(branchDraft) !== JSON.stringify(shapeDraft); } catch {}
  const requiredPathSet = new Set(requiredPaths);
  const exactSmartPathCount = (Array.isArray(metadata?.smartPathValues)
    ? metadata.smartPathValues
    : []).filter((item) => requiredPathSet.has(item?.path)).length;
  const compilerBranchPreferred = distinctBranchDraft && exactSmartPathCount > 0;
  const candidates = [
    {
      deterministicRank: compilerBranchPreferred ? 1 : 0,
      id: 'shape-only',
      numbers: {
        branchOpening: 0,
        exactSmartPathCount: 0,
        requiredPathCount: requiredPaths.length,
      },
      texts: ['Preserve the compiler fallback scalars and repair only its required shape'],
      tokens: [
        'strategy:shape-only',
        'value-kind:' + fallbackKind,
        'compiler-branch-proof:false',
      ],
    },
    ...(distinctBranchDraft
      ? [{
          deterministicRank: compilerBranchPreferred ? 0 : 1,
          id: 'branch-opening',
          numbers: {
            branchOpening: 1,
            exactSmartPathCount,
            requiredPathCount: requiredPaths.length,
          },
          texts: [
            'Use compiler-proven branch scalars while repairing the required shape',
            (metadata.smartPathValues ?? []).map((item) => item?.path).join(' '),
          ],
          tokens: [
            'strategy:branch-opening',
            'value-kind:' + fallbackKind,
            'compiler-branch-proof:' + String(compilerBranchPreferred),
          ],
        }]
      : []),
  ];
  const specification = {
    blockerKind: 'runtime-fallback',
    holeKind: 'blocker-exception-runtime-value',
    numbers: {
      nestedFallbackCount: resolutionFrame.children.length,
      requiredPathCount: requiredPaths.length,
    },
    texts: [
      metadata.evidence,
      metadata.hookName,
      metadata.ownerName,
      metadata.sourcePath,
      requiredPaths.join(' '),
    ],
    tokens: [
      'authored-kind:' + authoredKind,
      'fallback-kind:' + fallbackKind,
      ...requiredPaths.slice(0, 16).map((path) => 'required:' + path),
      ...resolutionFrame.children.slice(0, 8).map(
        (child) => 'nested:' + child.hookName + ':' + child.reason,
      ),
    ],
  };
  const selection = typeof selectPreviewInspectorNeuralResidualCandidate === 'function'
    ? selectPreviewInspectorNeuralResidualCandidate(specification, candidates)
    : undefined;
  const strategy = selection?.candidateId === 'branch-opening'
    ? 'branch-opening'
    : 'shape-only';
  const decision = strategy === 'branch-opening'
    ? previewInspectorSession.runtimeFallbackNeuralDecisions.get(metadata.id) ?? selection?.decision
    : selection?.decision;
  const draft = strategy === 'branch-opening' ? branchDraft : shapeDraft;
  const value = materializePreviewInspectorRuntimeFallbackOverride(draft);
  const safeValue = strategy === 'shape-only'
    ? value
    : materializePreviewInspectorRuntimeFallbackOverride(shapeDraft);
  const sharedGuardPaths = requiredPaths.filter((rawPath) => {
    const parsed = parsePreviewInspectorRequiredPath(rawPath);
    if (parsed === undefined || parsed.callable || parsed.collection || parsed.stringReceiver) {
      return false;
    }
    const leaf = readPreviewInspectorRequiredPathSeed(value, parsed.path);
    return leaf === null || ['boolean', 'number', 'string'].includes(typeof leaf);
  });
  markPreviewInspectorGeneratedValue(value);
  markPreviewInspectorGeneratedValue(safeValue);
  return {
    decision,
    generatedPaths: requiredPaths,
    safeValue,
    sharedGuardPaths,
    strategy,
    summary: {
      label: strategy === 'branch-opening'
        ? 'Compiler branch value'
        : 'Minimum compatible hook value',
      nestedFallbacks: resolutionFrame.children.map((child) => ({
        hookName: child.hookName,
        reason: child.reason,
      })),
      requiredPaths,
      residual: typeof summarizePreviewInspectorNeuralResidualDecision === 'function'
        ? summarizePreviewInspectorNeuralResidualDecision(decision)
        : undefined,
      sharedGuardPaths,
      strategy,
      value: copyPreviewInspectorBlockerValueForJson(value, { nodes: 0 }),
    },
    value,
  };
}

/** Registers a bypassed hook failure once and mirrors it as a warning, never a fatal error. */
function recordPreviewInspectorRuntimeFallback(metadata, fallback, reason, error, generatedPaths = []) {
  initializePreviewInspectorRuntimeFallbackState();
  if (
    metadata.id.length === 0 ||
    (!previewInspectorSession.runtimeFallbacks.has(metadata.id) &&
      previewInspectorSession.runtimeFallbacks.size >= PREVIEW_INSPECTOR_RUNTIME_FALLBACK_LIMIT)
  ) {
    return;
  }
  let errorHeadline = '';
  if (error !== undefined) {
    try { errorHeadline = createRuntimeErrorHeadline(error); } catch { errorHeadline = String(error); }
  }
  const previous = previewInspectorSession.runtimeFallbacks.get(metadata.id);
  const requiredPaths = reason === 'threw' && metadata.requiredPaths.length === 0
    ? metadata.failurePaths
    : metadata.requiredPaths;
  const requiredPathSignature = createPreviewInspectorRuntimeFallbackSmartSignature(
    metadata,
    requiredPaths,
  );
  if (
    previewInspectorSession.runtimeFallbackSmartIds.has(metadata.id) &&
    previewInspectorSession.runtimeFallbackSmartPathSignatures.get(metadata.id) !==
      requiredPathSignature
  ) {
    // A later failure or hot edit can expose paths that were absent when Smart Fill first ran.
    // Reopen that edge as Auto so the next bounded corridor frontier can complete the new minimum
    // instead of treating an obsolete Smart value as permanently settled.
    previewInspectorSession.runtimeFallbackSmartIds.delete(metadata.id);
    previewInspectorSession.runtimeFallbackSmartPathSignatures.delete(metadata.id);
  }
  const { neuralSmartPathDecision: _neuralSmartPathDecision, ...recordMetadata } = metadata;
  void _neuralSmartPathDecision;
  const next = {
    ...recordMetadata,
    count: (previous?.count ?? 0) + 1,
    error: errorHeadline,
    fallbackPreview: describePreviewInspectorRuntimeFallbackValue(fallback),
    generatedPaths: [...generatedPaths],
    mode: hasPreviewInspectorRuntimeFallbackOverride(metadata.id)
      ? previewInspectorSession.runtimeFallbackSmartIds.has(metadata.id)
        ? 'smart-manual'
        : 'manual'
      : previewInspectorSession.runtimeFallbackSmartIds.has(metadata.id)
        ? 'smart'
        : 'auto',
    reachabilityKey:
      typeof previewInspectorSession.activeTargetReachabilityKey === 'string'
        ? previewInspectorSession.activeTargetReachabilityKey
        : undefined,
    reason,
    requiredPaths,
  };
  previewInspectorSession.runtimeFallbacks.set(metadata.id, next);
  if (
    reason !== 'smart-candidate' && reason !== 'neural-candidate' &&
    (
      previous === undefined ||
      previous.error !== next.error ||
      previous.reason !== next.reason ||
      previous.fallbackPreview !== next.fallbackPreview
    )
  ) {
    if (
      typeof recordPreviewInspectorBlockerAutoDecision === 'function' &&
      !next.passive && (next.mode === 'auto' || next.mode === 'smart')
    ) {
      const neuralDataFlowSignal =
        previewInspectorSession.runtimeFallbackDataFlowSignals.get(metadata.id);
      recordPreviewInspectorBlockerAutoDecision({
        action: reason === 'partial' ? 'Complete missing hook fields' : 'Substitute failed hook result',
        blockerId: metadata.id,
        blockerKind: 'runtime-fallback',
        blockerName: 'Missing hook value · ' + metadata.hookName,
        column: metadata.column,
        generatedPaths,
        line: metadata.line,
        mode: next.mode,
        neuralResidualDecision:
          previewInspectorSession.runtimeFallbackNeuralDecisions.get(metadata.id),
        neuralDataFlowSignal,
        ownerName: metadata.ownerName,
        reason: errorHeadline || metadata.evidence,
        selectedValue: metadata.neuralRecommendation?.value ??
          createPreviewInspectorRuntimeFallbackSmartDraftTemplate(fallback, requiredPaths),
        sourcePath: metadata.sourcePath,
        startsRenderAttempt: neuralDataFlowSignal !== undefined ||
          metadata.residualHoleKind === 'render-state-reference-value',
        summary: {
          ...(metadata.neuralRecommendation === undefined
            ? {}
            : { neuralRecommendation: metadata.neuralRecommendation }),
          requiredPaths,
        },
        targetReachabilityKey: next.reachabilityKey,
      });
    }
    const message =
      '[Render-only fallback] ' + metadata.hookName + ' ' +
      (reason === 'threw'
        ? 'threw; using '
        : reason === 'partial'
          ? 'was missing required fields; supplementing with '
          : 'returned no required value; using ') +
      metadata.fallbackLabel;
    const details = [
      message,
      errorHeadline.length > 0 ? 'Original: ' + errorHeadline : '',
      'Evidence: ' + metadata.evidence,
      metadata.sourcePath + (metadata.line ? ':' + String(metadata.line) : ''),
      requiredPaths.length > 0 ? 'Required paths: ' + requiredPaths.join(', ') : '',
      generatedPaths.length > 0 ? 'Generated paths: ' + generatedPaths.join(', ') : '',
      'Generated: ' + next.fallbackPreview,
    ].filter(Boolean).join('\n');
    recordPreviewInspectorConsoleEntry({
      details,
      error,
      level: 'warn',
      location: metadata.sourcePath + (metadata.line ? ':' + String(metadata.line) : ''),
      message,
      phase: 'render-only runtime fallback',
      source: 'runtime-fallback',
    });
    readPreviewInspectorConsolePrimitives().warn('[React Preview] ' + details);
  }
  schedulePreviewInspectorRuntimeFallbackRefresh(next.reachabilityKey);
}

/** Returns one stable completed identity per authored object and compiler-issued hook site. */
function readOrCreatePreviewInspectorCompletedValue(metadata, value, fallback) {
  initializePreviewInspectorRuntimeFallbackState();
  if ((typeof value !== 'object' && typeof value !== 'function') || value === null) {
    return completePreviewInspectorGeneratedValue(value, fallback, {
      nonNegativeNumberPaths: metadata.nonNegativeNumberPaths,
      renderGuardPaths: metadata.renderGuardPaths,
      requiredPaths: metadata.requiredPaths,
    });
  }
  let completions = previewInspectorSession.runtimeFallbackCompletions.get(value);
  const cached = completions?.get(metadata.id);
  if (cached !== undefined && cached.fallback === fallback) return cached.completion;
  const completion = completePreviewInspectorGeneratedValue(value, fallback, {
    nonNegativeNumberPaths: metadata.nonNegativeNumberPaths,
    renderGuardPaths: metadata.renderGuardPaths,
    requiredPaths: metadata.requiredPaths,
  });
  if (completion.changed) {
    if (completions === undefined) {
      completions = new Map();
      previewInspectorSession.runtimeFallbackCompletions.set(value, completions);
    }
    if (completions.size < PREVIEW_INSPECTOR_RUNTIME_FALLBACK_LIMIT) {
      completions.set(metadata.id, { completion, fallback });
    }
  }
  return completion;
}

/** Removes a stale fallback record once the real hook starts producing a usable value. */
function clearPreviewInspectorRuntimeFallback(metadata) {
  initializePreviewInspectorRuntimeFallbackState();
  if (previewInspectorSession.runtimeFallbacks.delete(metadata.id)) {
    previewInspectorSession.runtimeFallbackNeuralDecisions.delete(metadata.id);
    previewInspectorSession.runtimeFallbackDataFlowRecommendations.delete(metadata.id);
    previewInspectorSession.runtimeFallbackDataFlowSignals.delete(metadata.id);
    schedulePreviewInspectorRuntimeFallbackRefresh();
  }
}

/**
 * Executes one compiler-proven hook call and cuts a failure, nullish root, or missing-leaf edge.
 * Auto values off restores the authored hook result and exception behavior exactly.
 */
function resolvePreviewInspectorRuntimeHook(
  readHook,
  createFallback,
  rawMetadata,
  readGraphqlDocument,
  readGraphqlOptions,
  readHookIdentity,
  inheritedResolutionFrame,
) {
  const metadata = scopePreviewInspectorRuntimeFallbackMetadata(
    normalizePreviewInspectorRuntimeFallbackMetadata(rawMetadata),
    readGraphqlDocument,
    readGraphqlOptions,
  );
  if (
    metadata.id.length === 0 ||
    typeof readHook !== 'function' ||
    typeof createFallback !== 'function'
  ) {
    return readHook();
  }
  const neuralSmartPathDecision = typeof copyPreviewInspectorNeuralResidualDecision === 'function'
    ? copyPreviewInspectorNeuralResidualDecision(metadata.neuralSmartPathDecision)
    : undefined;
  if (neuralSmartPathDecision !== undefined) {
    initializePreviewInspectorRuntimeFallbackState();
    previewInspectorSession.runtimeFallbackNeuralDecisions.set(metadata.id, neuralSmartPathDecision);
  }
  let value;
  let failure;
  let hookIdentity;
  const manualOverride = hasPreviewInspectorRuntimeFallbackOverride(metadata.id);
  const ownsResolutionFrame = inheritedResolutionFrame === undefined;
  const resolutionFrame = inheritedResolutionFrame ??
    beginPreviewInspectorRuntimeFallbackResolutionFrame(metadata);
  if (typeof readHookIdentity === 'function') {
    try {
      hookIdentity = readHookIdentity();
    } catch {}
  }
  try {
    try {
      value = readHook();
    } catch (error) {
      if (
        isPreviewInspectorRuntimeThenable(error) ||
        (!manualOverride && !readPreviewInspectorFallbackValuesEnabled())
      ) {
        throw error;
      }
      failure = error;
    }
  } finally {
    if (ownsResolutionFrame) {
      finishPreviewInspectorRuntimeFallbackResolutionFrame(resolutionFrame);
    }
  }
  const sharedIdentityChanged = rememberPreviewInspectorRuntimeSmartAuthoredValue(
    metadata,
    failure === undefined ? value : undefined,
    failure !== undefined ||
      (
        !isPreviewInspectorRuntimeFallbackSharedIdentity(value) &&
        Array.isArray(resolutionFrame?.children) &&
        resolutionFrame.children.length > 0
      )
      ? hookIdentity
      : undefined,
  );
  if (sharedIdentityChanged) {
    schedulePreviewInspectorRuntimeFallbackRefresh(
      previewInspectorSession.activeTargetReachabilityKey,
    );
  }
  const retainedLocalUiController = failure === undefined
    ? rememberPreviewInspectorLocalUiController(metadata, value)
    : undefined;
  const completionMetadata = retainedLocalUiController === undefined || manualOverride
    ? metadata
    : protectPreviewInspectorLocalUiVisibilityGuard(metadata, retainedLocalUiController);
  /*
   * A proven React-local visibility controller already supplies a coherent false state and the
   * authored callback that can change it. Protect only that exact false leaf from a truthy
   * render-guard fallback; completing unrelated data/loading fields remains necessary for hooks
   * that combine disclosure state with an application value model.
   */
  if (failure === undefined && !manualOverride && !readPreviewInspectorFallbackValuesEnabled()) {
    return value;
  }
  if (failure !== undefined && !manualOverride && !readPreviewInspectorFallbackValuesEnabled()) {
    throw failure;
  }
  if (
    failure === undefined &&
    !manualOverride &&
    completionMetadata.preserveNullish === true &&
    (value === null || value === undefined)
  ) {
    clearPreviewInspectorRuntimeFallback(completionMetadata);
    return value;
  }
  const compilerFallback = readPreviewInspectorRuntimeFallbackValue(
    completionMetadata,
    createFallback,
    readGraphqlDocument,
    readGraphqlOptions,
  );
  const semanticValueRecommendation = manualOverride ||
    !shouldUsePreviewInspectorRuntimeSemanticValueRecommendation(
      completionMetadata,
      value,
      failure,
      resolutionFrame,
    )
    ? undefined
    : createPreviewInspectorRuntimeSemanticValueRecommendation(
        completionMetadata,
        compilerFallback,
      );
  const semanticCompletionMetadata = semanticValueRecommendation?.metadata ?? completionMetadata;
  const semanticFallback = semanticValueRecommendation?.value ?? compilerFallback;
  if (semanticValueRecommendation?.decision !== undefined) {
    previewInspectorSession.runtimeFallbackNeuralDecisions.set(
      semanticCompletionMetadata.id,
      semanticValueRecommendation.decision,
    );
  }
  const dataFlowRecommendation = manualOverride
    ? undefined
    : createPreviewInspectorRuntimeFallbackDataFlowRecommendation(
        semanticCompletionMetadata,
        semanticFallback,
      );
  const recommendedCompletionMetadata = dataFlowRecommendation === undefined
    ? semanticCompletionMetadata
    : {
        ...semanticCompletionMetadata,
        neuralRecommendation: dataFlowRecommendation.summary,
        residualHoleKind: 'rendered-collection-consumer-data',
      };
  const sharedCarrier = failure === undefined ? value : hookIdentity;
  const sharedCompletion = !manualOverride
    ? createPreviewInspectorRuntimeSharedSmartCompletion(
        recommendedCompletionMetadata,
        sharedCarrier,
        dataFlowRecommendation?.value ?? semanticFallback,
      )
    : { fallback: compilerFallback, metadata: completionMetadata, projected: false };
  const fallback = sharedCompletion.fallback;
  const effectiveCompletionMetadata = createPreviewInspectorRuntimeSmartCompletionMetadata(
    sharedCompletion.metadata,
  );
  const residualRecommendation = failure === undefined
    ? createPreviewInspectorNestedRuntimeFallbackRecommendation(
        effectiveCompletionMetadata,
        value,
        fallback,
        resolutionFrame,
        hookIdentity,
      )
    : undefined;
  const residualMetadata = residualRecommendation === undefined
    ? effectiveCompletionMetadata
    : {
        ...effectiveCompletionMetadata,
        neuralRecommendation: residualRecommendation.summary,
        residualHoleKind: 'nested-generated-shape-mismatch',
      };
  if (residualRecommendation?.decision !== undefined) {
    previewInspectorSession.runtimeFallbackNeuralDecisions.set(
      effectiveCompletionMetadata.id,
      residualRecommendation.decision,
    );
  }
  const ownsNeuralRecommendation = manualOverride ||
    previewInspectorSession.runtimeFallbackSmartIds.has(effectiveCompletionMetadata.id);
  if (
    residualRecommendation !== undefined &&
    residualRecommendation.shared !== true &&
    ownsNeuralRecommendation
  ) {
    const stored = storePreviewInspectorRuntimeSharedNeuralRecommendation(
      effectiveCompletionMetadata,
      hookIdentity,
      {
        label: residualRecommendation.summary.label,
        residual: residualRecommendation.summary.residual,
        sharedGuardPaths: residualRecommendation.sharedGuardPaths,
        strategy: residualRecommendation.strategy,
        value: residualRecommendation.summary.value,
      },
      'runtime-discovery',
    );
    if (stored) schedulePreviewInspectorRuntimeNeuralRecommendationRetry();
  }
  if (
    residualRecommendation !== undefined &&
    (
      ownsNeuralRecommendation || residualRecommendation.shared === true
    )
  ) {
    if (residualRecommendation.shared === true && !ownsNeuralRecommendation) {
      clearPreviewInspectorRuntimeFallback(residualMetadata);
      reportPreviewInspectorNestedRuntimeFallback(
        residualMetadata,
        'shared-neural-recommendation',
        residualRecommendation.generatedPaths,
      );
      return residualRecommendation.value;
    }
    recordPreviewInspectorRuntimeFallback(
      residualMetadata,
      residualRecommendation.value,
      'partial',
      undefined,
      residualRecommendation.generatedPaths,
    );
    reportPreviewInspectorNestedRuntimeFallback(
      residualMetadata,
      'neural-recommendation',
      residualRecommendation.generatedPaths,
    );
    return residualRecommendation.value;
  }
  if (residualRecommendation !== undefined) {
    recordPreviewInspectorRuntimeFallback(
      residualMetadata,
      residualRecommendation.value,
      'neural-candidate',
      undefined,
      [],
    );
    /*
     * A nested generated scalar cannot safely escape through a custom hook whose caller proves an
     * object contract: destructuring succeeds but yields undefined and the next member read throws
     * before the learned branch can be selected. Apply only the recommendation's neutral shape on
     * this discovery pass. Its branch-opening value remains recorded and is promoted by the normal
     * Smart retry, so this exception repair cannot invent visible state ahead of neural selection.
     */
    reportPreviewInspectorNestedRuntimeFallback(
      residualMetadata,
      'neural-shape-safety',
      residualRecommendation.generatedPaths,
    );
    return residualRecommendation.safeValue;
  }
  if (
    failure === undefined &&
    shouldUsePreviewInspectorHookGraphqlFallback(value, readGraphqlDocument)
  ) {
    recordPreviewInspectorRuntimeFallback(
      effectiveCompletionMetadata,
      fallback,
      'partial',
      undefined,
      effectiveCompletionMetadata.requiredPaths,
    );
    reportPreviewInspectorNestedRuntimeFallback(
      effectiveCompletionMetadata,
      'partial',
      effectiveCompletionMetadata.requiredPaths,
    );
    return fallback;
  }
  if (failure === undefined && value !== null && value !== undefined) {
    const completion = readOrCreatePreviewInspectorCompletedValue(
      effectiveCompletionMetadata,
      value,
      fallback,
    );
    if (!completion.changed) {
      if (
        !manualOverride &&
        hasPreviewInspectorRuntimeSmartAlternative(effectiveCompletionMetadata, value)
      ) {
        /*
         * Keep this compiler-proven alternative discoverable without changing ordinary Auto
         * rendering or emitting a false failure warning. Target reachability may select it only
         * after the exact component mounted without output.
         */
        recordPreviewInspectorRuntimeFallback(
          effectiveCompletionMetadata,
          fallback,
          'smart-candidate',
          undefined,
          [],
        );
      } else {
        clearPreviewInspectorRuntimeFallback(effectiveCompletionMetadata);
      }
      return value;
    }
    if (
      sharedCompletion.projected === true &&
      !previewInspectorSession.runtimeFallbackSmartIds.has(effectiveCompletionMetadata.id)
    ) {
      // A sibling shell consumer receives the exact state selected by the target hook. It is not a
      // second blocker and should not emit a duplicate partial-value warning or occupy a frontier.
      clearPreviewInspectorRuntimeFallback(effectiveCompletionMetadata);
      reportPreviewInspectorNestedRuntimeFallback(
        effectiveCompletionMetadata,
        'shared-smart-projection',
        completion.paths,
      );
      return completion.value;
    }
    recordPreviewInspectorRuntimeFallback(
      effectiveCompletionMetadata,
      fallback,
      'partial',
      undefined,
      completion.paths,
    );
    reportPreviewInspectorNestedRuntimeFallback(
      effectiveCompletionMetadata,
      'partial',
      completion.paths,
    );
    return completion.value;
  }
  if (
    sharedCompletion.projected === true &&
    !previewInspectorSession.runtimeFallbackSmartIds.has(effectiveCompletionMetadata.id)
  ) {
    // A Provider-less sibling call failed at the same exact imported hook function. It receives
    // the target's coherent Smart state without becoming a second missing-provider blocker.
    clearPreviewInspectorRuntimeFallback(effectiveCompletionMetadata);
    reportPreviewInspectorNestedRuntimeFallback(
      effectiveCompletionMetadata,
      'shared-smart-projection',
      effectiveCompletionMetadata.requiredPaths,
    );
    return fallback;
  }
  recordPreviewInspectorRuntimeFallback(
    effectiveCompletionMetadata,
    fallback,
    failure === undefined ? 'nullish' : 'threw',
    failure,
    effectiveCompletionMetadata.requiredPaths.length > 0
      ? effectiveCompletionMetadata.requiredPaths
      : failure !== undefined && effectiveCompletionMetadata.failurePaths.length > 0
        ? effectiveCompletionMetadata.failurePaths
        : effectiveCompletionMetadata.passive
          ? []
          : ['<root>'],
  );
  reportPreviewInspectorNestedRuntimeFallback(
    effectiveCompletionMetadata,
    failure === undefined ? 'nullish' : 'threw',
    effectiveCompletionMetadata.requiredPaths.length > 0
      ? effectiveCompletionMetadata.requiredPaths
      : ['<root>'],
  );
  return fallback;
}

/**
 * Records an effect failure as an automatically resolved render-only warning.
 * Effects cannot accept a replacement payload, so presenting a JSON blocker editor would ask the
 * user a question with only one meaningful answer. The Inspector console retains source, owner,
 * missing-property evidence, and the original error while the rendered page remains mounted.
 */
function recordPreviewInspectorRuntimeEffectIsolation(rawMetadata, error, phase, effectScopeKey) {
  initializePreviewInspectorRuntimeFallbackState();
  if (previewInspectorSession.runtimeFallbackScopeKey !== effectScopeKey) return;
  const metadata = normalizePreviewInspectorRuntimeFallbackMetadata(rawMetadata);
  if (
    metadata.id.length === 0 ||
    (!previewInspectorSession.runtimeEffectIsolations.has(metadata.id) &&
      previewInspectorSession.runtimeEffectIsolations.size >= PREVIEW_INSPECTOR_RUNTIME_FALLBACK_LIMIT)
  ) {
    return;
  }
  const errorHeadline = createRuntimeErrorHeadline(error);
  const requiredPaths = readPreviewInspectorErrorPropertyPaths(error);
  const previous = previewInspectorSession.runtimeEffectIsolations.get(metadata.id);
  const next = {
    ...metadata,
    count: (previous?.count ?? 0) + 1,
    error: errorHeadline,
    phase,
    requiredPaths,
  };
  previewInspectorSession.runtimeEffectIsolations.set(metadata.id, next);
  if (previous?.error === next.error && previous?.phase === next.phase) return;
  const message = '[Render-only effect isolation] ' + metadata.hookName +
    ' failed during ' + phase + '; the authored page remains mounted';
  const details = [
    message,
    'Original: ' + errorHeadline,
    metadata.sourcePath + (metadata.line ? ':' + String(metadata.line) : ''),
    metadata.ownerName ? 'Owner: ' + metadata.ownerName : '',
    requiredPaths.length > 0 ? 'Observed missing paths: ' + requiredPaths.join(', ') : '',
  ].filter(Boolean).join('\n');
  recordPreviewInspectorConsoleEntry({
    details,
    error,
    level: 'warn',
    location: metadata.sourcePath + (metadata.line ? ':' + String(metadata.line) : ''),
    message,
    phase: 'render-only effect isolation',
    source: 'runtime-effect',
  });
  readPreviewInspectorConsolePrimitives().warn('[React Preview] ' + details);
  recordPreviewInspectorRuntimeHealth({
    category: 'render-isolation',
    detail: {
      effect: metadata.hookName,
      error: errorHeadline,
      ownerName: metadata.ownerName,
      phase,
      requiredPaths,
      sourcePath: metadata.sourcePath,
    },
    event: 'runtime-effect-isolated',
  });
  schedulePreviewInspectorRuntimeFallbackRefresh();
}

/** Wraps a cleanup callback so a later unmount cannot replace an otherwise valid static page. */
function createPreviewInspectorRuntimeEffectCleanup(cleanup, metadata, effectScopeKey) {
  return () => {
    if (!readPreviewInspectorFallbackValuesEnabled()) return cleanup();
    try {
      return cleanup();
    } catch (error) {
      recordPreviewInspectorRuntimeEffectIsolation(metadata, error, 'cleanup', effectScopeKey);
      return undefined;
    }
  };
}

/**
 * Clears a completed frame's execution counter without reviving a superseded candidate/revision.
 *
 * Counting by animation frame, rather than wall-clock frequency, distinguishes a legitimate
 * 60/120Hz state-driven animation from a synchronous effect/update loop that prevents the browser
 * from reaching its next paint. The token check keeps an old frame callback from deleting a newer
 * burst admitted under the same stable source id.
 */
function schedulePreviewInspectorRuntimeEffectBurstReset(metadataId, revision, frameToken) {
  if (typeof previewInspectorScheduleRuntimeEffectFrame !== 'function') return;
  previewInspectorScheduleRuntimeEffectFrame(() => {
    const current = previewInspectorSession.runtimeEffectExecutionWindows?.get(metadataId);
    if (
      current?.revision === revision &&
      current.frameToken === frameToken &&
      current.isolated !== true
    ) {
      previewInspectorSession.runtimeEffectExecutionWindows.delete(metadataId);
    }
  });
}

/**
 * Stops one effect site that repeatedly completes but schedules another synchronous application
 * update before the browser can paint. React reports this pattern only after dozens of commits, at
 * which point the renderer can already be unresponsive. Ordinary repeated animation effects are
 * admitted because their counter is cleared at every browser frame boundary.
 */
function shouldIsolatePreviewInspectorRepeatedRuntimeEffect(rawMetadata) {
  if (!readPreviewInspectorFallbackValuesEnabled()) return false;
  initializePreviewInspectorRuntimeFallbackState();
  const metadata = normalizePreviewInspectorRuntimeFallbackMetadata(rawMetadata);
  if (metadata.id.length === 0) return false;
  const revision = typeof previewEntryRevision === 'number' ? previewEntryRevision : 0;
  const previous = previewInspectorSession.runtimeEffectExecutionWindows.get(metadata.id);
  if (previous?.isolated === true && previous.revision === revision) return true;
  if (
    previous === undefined &&
    previewInspectorSession.runtimeEffectExecutionWindows.size >=
      PREVIEW_INSPECTOR_RUNTIME_FALLBACK_LIMIT
  ) {
    return false;
  }
  const withinFrame = previous?.revision === revision;
  const frameToken = withinFrame ? previous.frameToken : Symbol(metadata.id);
  const execution = {
    count: withinFrame ? previous.count + 1 : 1,
    frameToken,
    isolated: false,
    revision,
  };
  if (!withinFrame) {
    schedulePreviewInspectorRuntimeEffectBurstReset(metadata.id, revision, frameToken);
  }
  if (execution.count <= PREVIEW_INSPECTOR_RUNTIME_EFFECT_EXECUTION_LIMIT) {
    previewInspectorSession.runtimeEffectExecutionWindows.set(metadata.id, execution);
    return false;
  }
  execution.isolated = true;
  previewInspectorSession.runtimeEffectExecutionWindows.set(metadata.id, execution);
  recordPreviewInspectorRuntimeEffectIsolation(
    metadata,
    new Error(
      'Effect executed more than ' + String(PREVIEW_INSPECTOR_RUNTIME_EFFECT_EXECUTION_LIMIT) +
      ' times before the next browser frame; further executions were disabled for this preview session',
    ),
    'repeated effect execution',
    previewInspectorSession.runtimeFallbackScopeKey,
  );
  return true;
}

/**
 * Runs one compiler-proven React effect while Auto values controls render-only failure isolation.
 * Successful cleanup functions remain intact. Promise-returning effects are made non-blocking and
 * their rejection is logged because React cannot use a Promise as an effect cleanup value.
 */
function resolvePreviewInspectorRuntimeEffect(readEffect, rawMetadata, ownershipToken) {
  if (typeof readEffect !== 'function') return undefined;
  initializePreviewInspectorRuntimeFallbackState();
  const effectScopeKey = previewInspectorSession.runtimeFallbackScopeKey;
  const chainEffect = normalizePreviewInspectorRuntimeFallbackMetadata(rawMetadata);
  previewInspectorSession.activeTargetRenderChainEffect = { id: chainEffect.id, ownershipToken, sourcePath: chainEffect.sourcePath };
  if (shouldIsolatePreviewInspectorRepeatedRuntimeEffect(rawMetadata)) return undefined;
  let result;
  try {
    result = readEffect();
  } catch (error) {
    previewInspectorSession.activeTargetRenderChainEffect = undefined;
    if (!readPreviewInspectorFallbackValuesEnabled()) throw error;
    recordPreviewInspectorRuntimeEffectIsolation(rawMetadata, error, 'effect', effectScopeKey);
    return undefined;
  }
  const chain = previewInspectorSession.targetRenderCommitChainsByToken?.get?.(ownershipToken);
  if (chain?.markedCallEffectId === chainEffect.id && chainEffect.id.length > 0) chain.effectCompletedAfterMarkedCall = true;
  previewInspectorSession.activeTargetRenderChainEffect = undefined;
  if (isPreviewInspectorRuntimeThenable(result)) {
    previewInspectorSession.activeTargetRenderChainEffect = undefined;
    if (!readPreviewInspectorFallbackValuesEnabled()) return result;
    Promise.resolve(result).catch((error) => {
      recordPreviewInspectorRuntimeEffectIsolation(
        rawMetadata,
        error,
        'async effect',
        effectScopeKey,
      );
    });
    return undefined;
  }
  rememberPreviewInspectorSuccessfulRuntimeEffect(rawMetadata, ownershipToken);
  if (typeof result === 'function') {
    if (typeof continuePreviewInspectorTargetReachabilityAfterSuccessfulRuntimeEffect === 'function') {
      continuePreviewInspectorTargetReachabilityAfterSuccessfulRuntimeEffect(rawMetadata, ownershipToken);
    }
    return createPreviewInspectorRuntimeEffectCleanup(result, rawMetadata, effectScopeKey);
  }
  const metadata = normalizePreviewInspectorRuntimeFallbackMetadata(rawMetadata);
  previewInspectorSession.runtimeEffectIsolations.delete(metadata.id);
  if (typeof continuePreviewInspectorTargetReachabilityAfterSuccessfulRuntimeEffect === 'function') {
    continuePreviewInspectorTargetReachabilityAfterSuccessfulRuntimeEffect(rawMetadata, ownershipToken);
  }
  return result;
}

/**
 * Repairs a fragment carrier whose upstream generated Context widened one object into a list.
 *
 * GraphQL fragment helpers can faithfully return their input carrier. When a schema-less Context
 * fallback generated company as an Array but this callsite immediately destructures warnings, the
 * Array is not an authored fragment result: its first generated row is the compatible object root.
 * This decision is enabled only for Auto values and only by compiler-proven named root paths.
 */
function readPreviewInspectorCompatibleGraphqlFragmentCarrier(readFragment, metadata) {
  const value = readFragment();
  if (!readPreviewInspectorFallbackValuesEnabled() || !Array.isArray(value)) return value;
  const requiresNamedObjectRoot = normalizePreviewInspectorRequiredPropertyPaths(
    metadata?.requiredPaths,
  )
    .map(parsePreviewInspectorRequiredPath)
    .some((parsed) =>
      parsed !== undefined &&
      parsed.path.length > 0 &&
      !/^\d+$/u.test(parsed.path[0]),
    );
  if (!requiresNamedObjectRoot) return value;
  try {
    const first = Object.getOwnPropertyDescriptor(value, '0');
    return first !== undefined && Object.hasOwn(first, 'value')
      ? first.value
      : undefined;
  } catch {
    return undefined;
  }
}

/**
 * Completes a GraphQL Code Generator fragment carrier from its authored fragment selection.
 * The normal helper still executes first; real carrier fields win, while an empty Context/prop
 * placeholder receives only missing selected fields through the ordinary editable blocker store.
 */
function resolvePreviewInspectorGraphqlFragmentValue(
  readFragment,
  readDocument,
  createStaticFallback,
  metadata,
) {
  const normalizedMetadata = normalizePreviewInspectorRuntimeFallbackMetadata(metadata);
  return resolvePreviewInspectorRuntimeHook(
    () => readPreviewInspectorCompatibleGraphqlFragmentCarrier(
      readFragment,
      normalizedMetadata,
    ),
    () => {
      const selectedData = createPreviewInspectorHookGraphqlFragmentData(readDocument);
      return overlayPreviewInspectorGraphqlLiteralDemands(
        selectedData ?? createStaticFallback(),
        normalizedMetadata.literalDemands,
      );
    },
    normalizedMetadata,
  );
}

/** Returns sorted immutable-looking copies for the Inspector Fallbacks detail pane. */
function readPreviewInspectorRuntimeFallbacks() {
  initializePreviewInspectorRuntimeFallbackState();
  return [...previewInspectorSession.runtimeFallbacks.values()]
    .map((record) => ({ ...record }))
    .sort((left, right) =>
      left.sourcePath.localeCompare(right.sourcePath) ||
      (left.line ?? 0) - (right.line ?? 0) ||
      left.hookName.localeCompare(right.hookName),
    );
}

/** Returns the editable generated/manual value currently associated with one blocker row. */
function readPreviewInspectorRuntimeFallbackDraft(fallbackId) {
  initializePreviewInspectorRuntimeFallbackState();
  if (previewInspectorSession.runtimeFallbackOverrides.has(fallbackId)) {
    return previewInspectorSession.runtimeFallbackOverrides.get(fallbackId);
  }
  const fallback = previewInspectorSession.runtimeFallbackValues.get(fallbackId);
  const record = previewInspectorSession.runtimeFallbacks.get(fallbackId);
  return createPreviewInspectorRuntimeFallbackDraftTemplate(fallback, record?.requiredPaths ?? []);
}

/** Copies bounded JSON while dropping prototype keys before it can enter project hook code. */
function normalizePreviewInspectorRuntimeFallbackOverride(value) {
  const encoded = JSON.stringify(value, (propertyName, propertyValue) =>
    blockedInspectorPropNames.has(propertyName) ? undefined : propertyValue,
  );
  if (typeof encoded !== 'string' || encoded.length > 64 * 1024) {
    throw new TypeError('Fallback JSON must be serializable and no larger than 64 KiB.');
  }
  return JSON.parse(encoded);
}

/** Remounts the selected authored page after one blocker value policy changes. */
function commitPreviewInspectorRuntimeFallbackChange() {
  previewInspectorSession.renderConditionRevision =
    (previewInspectorSession.renderConditionRevision ?? 0) + 1;
  persistPreviewInspectorState();
  notifyPreviewInspector();
  schedulePreviewInspectorCommitRefresh();
}

/** Stores user-authored JSON for one known blocker and gives it precedence over Auto inference. */
function setPreviewInspectorRuntimeFallbackOverride(fallbackId, value) {
  initializePreviewInspectorRuntimeFallbackState();
  if (!previewInspectorSession.runtimeFallbacks.has(fallbackId)) return;
  previewInspectorSession.runtimeFallbackSmartIds.delete(fallbackId);
  previewInspectorSession.runtimeFallbackSmartPathSignatures.delete(fallbackId);
  previewInspectorSession.runtimeFallbackOverrides.set(
    fallbackId,
    normalizePreviewInspectorRuntimeFallbackOverride(value),
  );
  previewInspectorSession.runtimeFallbackMaterializedOverrides.delete(fallbackId);
  commitPreviewInspectorRuntimeFallbackChange();
}

/** Restores compiler-inferred generation for one blocker and ensures Auto values is enabled. */
function autoPassPreviewInspectorRuntimeFallback(fallbackId) {
  initializePreviewInspectorRuntimeFallbackState();
  if (!previewInspectorSession.runtimeFallbacks.has(fallbackId)) return;
  previewInspectorSession.runtimeFallbackSmartIds.delete(fallbackId);
  previewInspectorSession.runtimeFallbackSmartPathSignatures.delete(fallbackId);
  previewInspectorSession.runtimeFallbackOverrides.delete(fallbackId);
  previewInspectorSession.runtimeFallbackMaterializedOverrides.delete(fallbackId);
  const fallback = previewInspectorSession.runtimeFallbackValues.get(fallbackId);
  const requiredPaths = previewInspectorSession.runtimeFallbacks.get(fallbackId)?.requiredPaths ?? [];
  if (previewInspectorSession.runtimeFallbackValues.has(fallbackId)) {
    previewInspectorSession.runtimeFallbackValues.set(
      fallbackId,
      createPreviewInspectorRuntimeFallbackAutoValue(fallback, requiredPaths),
    );
  }
  const record = previewInspectorSession.runtimeFallbacks.get(fallbackId);
  if (typeof recordPreviewInspectorBlockerAutoDecision === 'function' && record !== undefined) {
    recordPreviewInspectorBlockerAutoDecision({
      action: 'Use compiler-inferred hook value',
      blockerId: fallbackId,
      blockerKind: 'runtime-fallback',
      blockerName: 'Missing hook value · ' + record.hookName,
      column: record.column,
      generatedPaths: requiredPaths,
      line: record.line,
      mode: 'auto',
      ownerName: record.ownerName,
      reason: record.evidence,
      selectedValue: previewInspectorSession.runtimeFallbackValues.get(fallbackId),
      sourcePath: record.sourcePath,
      startsRenderAttempt: true,
      summary: { requiredPaths },
    });
  }
  previewInspectorSession.fallbackValuesEnabled = true;
  commitPreviewInspectorRuntimeFallbackChange();
}

/** Mutates one known hook edge to its minimum demanded shape without scheduling a remount. */
function applyPreviewInspectorRuntimeFallbackSmartValue(fallbackId) {
  initializePreviewInspectorRuntimeFallbackState();
  const record = previewInspectorSession.runtimeFallbacks.get(fallbackId);
  if (record === undefined || !previewInspectorSession.runtimeFallbackValues.has(fallbackId)) return false;
  const fallback = previewInspectorSession.runtimeFallbackValues.get(fallbackId);
  const manualValue = previewInspectorSession.runtimeFallbackOverrides.get(fallbackId);
  const wasSmart = previewInspectorSession.runtimeFallbackSmartIds.has(fallbackId);
  const pathSignature = createPreviewInspectorRuntimeFallbackSmartSignature(
    record,
    record.requiredPaths,
  );
  const previousPathSignature =
    previewInspectorSession.runtimeFallbackSmartPathSignatures.get(fallbackId);
  const sharedIdentityChanged =
    promotePreviewInspectorRuntimeSmartValueToSharedIdentity(fallbackId, record);
  if (manualValue !== undefined) {
    const minimum = record.graphqlSelectionBacked === true
      ? copyPreviewInspectorBlockerValueForJson(fallback, { nodes: 0 })
      : createPreviewInspectorRuntimeFallbackSmartDraftTemplate(
          fallback,
          record.requiredPaths,
          record.smartPathValues,
        );
    const completion = completePreviewInspectorGeneratedValue(manualValue, minimum, {
      requiredPaths: record.requiredPaths,
    });
    if (completion.changed) {
      previewInspectorSession.runtimeFallbackOverrides.set(
        fallbackId,
        normalizePreviewInspectorRuntimeFallbackOverride(completion.value),
      );
      previewInspectorSession.runtimeFallbackMaterializedOverrides.delete(fallbackId);
    }
    previewInspectorSession.runtimeFallbackSmartIds.add(fallbackId);
    previewInspectorSession.runtimeFallbackSmartPathSignatures.set(fallbackId, pathSignature);
    // The selected branch can disappear before the instrumented hook executes again. Reflect the
    // Smart state in the registry now so an obsolete Auto record cannot repeatedly occupy the next
    // target-reachability frontier while waiting for a re-registration that may never happen.
    previewInspectorSession.runtimeFallbacks.set(fallbackId, {
      ...record,
      mode: 'smart-manual',
    });
    return completion.changed || sharedIdentityChanged || !wasSmart ||
      previousPathSignature !== pathSignature;
  }
  if (
    record.residualHoleKind === 'nested-generated-shape-mismatch' &&
    record.neuralRecommendation?.value !== undefined
  ) {
    const recommendedDraft = copyPreviewInspectorBlockerValueForJson(
      record.neuralRecommendation.value,
      { nodes: 0 },
    );
    const materializedRecommendation = materializePreviewInspectorRuntimeFallbackOverride(
      recommendedDraft,
    );
    /*
     * The residual repairs an invalid nested hook shape, while exact Smart path values select the
     * authored target branch. Compose those two independent decisions instead of letting a learned
     * shape-only recommendation erase a compiler-proven temporal state such as status=pending.
     */
    const recommendedValue = Array.isArray(record.smartPathValues) &&
      record.smartPathValues.length > 0
      ? createPreviewInspectorRuntimeFallbackSmartValue(
          materializedRecommendation,
          record.requiredPaths,
          record.smartPathValues,
        )
      : materializedRecommendation;
    markPreviewInspectorGeneratedValue(recommendedValue);
    previewInspectorSession.runtimeFallbackValues.set(fallbackId, recommendedValue);
    previewInspectorSession.runtimeFallbackSmartIds.add(fallbackId);
    previewInspectorSession.runtimeFallbackSmartPathSignatures.set(fallbackId, pathSignature);
    previewInspectorSession.runtimeFallbacks.set(fallbackId, {
      ...record,
      mode: 'smart',
    });
    const sharedRecommendationStored = storePreviewInspectorRuntimeSharedNeuralRecommendation(
      record,
      previewInspectorSession.runtimeFallbackAuthoredValues.get(fallbackId),
      { ...record.neuralRecommendation, value: recommendedValue },
      'smart-selection',
    );
    if (sharedRecommendationStored) schedulePreviewInspectorRuntimeNeuralRecommendationRetry();
    return sharedIdentityChanged || !wasSmart || previousPathSignature !== pathSignature ||
      recommendedValue !== fallback;
  }
  const dataFlowRecommendation =
    record.residualHoleKind === 'rendered-collection-consumer-data'
      ? previewInspectorSession.runtimeFallbackDataFlowRecommendations.get(fallbackId)
      : undefined;
  if (dataFlowRecommendation?.value !== undefined) {
    previewInspectorSession.runtimeFallbackValues.set(
      fallbackId,
      dataFlowRecommendation.value,
    );
    previewInspectorSession.runtimeFallbackSmartIds.add(fallbackId);
    previewInspectorSession.runtimeFallbackSmartPathSignatures.set(fallbackId, pathSignature);
    previewInspectorSession.runtimeFallbacks.set(fallbackId, {
      ...record,
      mode: 'smart',
    });
    return sharedIdentityChanged || !wasSmart || previousPathSignature !== pathSignature ||
      dataFlowRecommendation.value !== fallback;
  }
  if (record.graphqlSelectionBacked === true) {
    /*
     * The authored DocumentNode proves every selected response field. Narrowing this value to only
     * locally observed wrapper paths can erase deeper items needed to reach a selected descendant.
     * Keep the already bounded selection-shaped fallback and mark its exact compiler proof settled.
     */
    previewInspectorSession.runtimeFallbackSmartIds.add(fallbackId);
    previewInspectorSession.runtimeFallbackSmartPathSignatures.set(fallbackId, pathSignature);
    previewInspectorSession.runtimeFallbacks.set(fallbackId, {
      ...record,
      mode: 'smart',
    });
    return sharedIdentityChanged || !wasSmart || previousPathSignature !== pathSignature;
  }
  if (record.preserveSmartValue === true) {
    /*
     * A syntax-serialized authored initializer is already stronger than a path-derived minimum.
     * Narrowing a tuple such as [defaultFilters, setter] at path "0" would erase the object's
     * known fields and make a later retry less renderable than the first compiler fallback.
     */
    previewInspectorSession.runtimeFallbackSmartIds.add(fallbackId);
    previewInspectorSession.runtimeFallbackSmartPathSignatures.set(fallbackId, pathSignature);
    previewInspectorSession.runtimeFallbacks.set(fallbackId, {
      ...record,
      mode: 'smart',
    });
    return sharedIdentityChanged || !wasSmart || previousPathSignature !== pathSignature;
  }
  if (hasPreviewInspectorGeneratedRuntimeOnlyNativeValue(fallback)) {
    /*
     * Smart Fill is JSON-editable by design, but a compiler-proven native such as RegExp carries
     * required behavior on its prototype. The compiler fallback is already the minimum demanded
     * shape; serializing it would turn the item into an empty object and reintroduce the blocker.
     */
    previewInspectorSession.runtimeFallbackSmartIds.add(fallbackId);
    previewInspectorSession.runtimeFallbackSmartPathSignatures.set(fallbackId, pathSignature);
    previewInspectorSession.runtimeFallbacks.set(fallbackId, {
      ...record,
      mode: 'smart',
    });
    return sharedIdentityChanged || !wasSmart || previousPathSignature !== pathSignature;
  }
  previewInspectorSession.runtimeFallbackValues.set(
    fallbackId,
    createPreviewInspectorRuntimeFallbackSmartValue(
      fallback,
      record.requiredPaths,
      record.smartPathValues,
    ),
  );
  previewInspectorSession.runtimeFallbackSmartIds.add(fallbackId);
  previewInspectorSession.runtimeFallbackSmartPathSignatures.set(fallbackId, pathSignature);
  // Keep frontier selection and Inspector presentation synchronized with the value mutation even
  // when Smart Fill itself removes the component that originally registered this fallback.
  previewInspectorSession.runtimeFallbacks.set(fallbackId, {
    ...record,
    mode: 'smart',
  });
  return sharedIdentityChanged || !wasSmart || previousPathSignature !== pathSignature;
}

/** Replaces one generated hook result with only the paths proven necessary by downstream reads. */
function smartFillPreviewInspectorRuntimeFallback(fallbackId) {
  if (!applyPreviewInspectorRuntimeFallbackSmartValue(fallbackId)) return false;
  const record = previewInspectorSession.runtimeFallbacks.get(fallbackId);
  if (typeof recordPreviewInspectorBlockerAutoDecision === 'function' && record !== undefined) {
    const generatedSelection = createPreviewInspectorRuntimeFallbackSmartDraftTemplate(
      previewInspectorSession.runtimeFallbackValues.get(fallbackId),
      record.requiredPaths,
      record.smartPathValues,
    );
    recordPreviewInspectorBlockerAutoDecision({
      action: 'Smart fill minimum hook value',
      blockerId: fallbackId,
      blockerKind: 'runtime-fallback',
      blockerName: 'Missing hook value · ' + record.hookName,
      column: record.column,
      generatedPaths: record.requiredPaths,
      line: record.line,
      mode: previewInspectorSession.runtimeFallbackOverrides.has(fallbackId)
        ? 'smart-manual'
        : 'smart',
      neuralResidualDecision:
        previewInspectorSession.runtimeFallbackNeuralDecisions.get(fallbackId),
      neuralDataFlowSignal:
        previewInspectorSession.runtimeFallbackDataFlowSignals.get(fallbackId),
      ownerName: record.ownerName,
      reason: record.evidence,
      selectedValue: generatedSelection,
      sourcePath: record.sourcePath,
      startsRenderAttempt: true,
      summary: {
        ...(record.neuralRecommendation === undefined
          ? {}
          : { neuralRecommendation: record.neuralRecommendation }),
        preservedUserValue: previewInspectorSession.runtimeFallbackOverrides.has(fallbackId),
        requiredPaths: record.requiredPaths,
      },
    });
  }
  previewInspectorSession.fallbackValuesEnabled = true;
  commitPreviewInspectorRuntimeFallbackChange();
  return true;
}

/**
 * Smart-fills every hook edge observed inside one authored page corridor as one batched mutation.
 * Deterministic background traversal skips explicit JSON so it cannot silently revise a scenario;
 * the user-invoked Smart action retains its existing behavior of completing that JSON in place.
 */
function smartFillPreviewInspectorRuntimeFallbacksForReachability(reachabilityKey, options = {}) {
  initializePreviewInspectorRuntimeFallbackState();
  const preserveUserValues = options?.preserveUserValues === true;
  const admittedIds = Array.isArray(options?.recordIds)
    ? new Set(options.recordIds.filter((value) => typeof value === 'string'))
    : undefined;
  const changeLimit = Number.isSafeInteger(options?.changeLimit)
    ? Math.max(1, Math.min(24, options.changeLimit))
    : 24;
  let changed = false;
  let changeCount = 0;
  for (const record of previewInspectorSession.runtimeFallbacks.values()) {
    if (record.reachabilityKey !== reachabilityKey) continue;
    if (record.passive === true || (admittedIds !== undefined && !admittedIds.has(record.id))) {
      continue;
    }
    if (preserveUserValues && previewInspectorSession.runtimeFallbackOverrides.has(record.id)) {
      continue;
    }
    const recordChanged = applyPreviewInspectorRuntimeFallbackSmartValue(record.id);
    changed = recordChanged || changed;
    if (recordChanged) {
      changeCount += 1;
      if (changeCount >= changeLimit) break;
    }
  }
  if (changed) previewInspectorSession.fallbackValuesEnabled = true;
  return changed;
}

/** Removes a manual blocker value while retaining the caller's current global Auto policy. */
function resetPreviewInspectorRuntimeFallbackOverride(fallbackId) {
  initializePreviewInspectorRuntimeFallbackState();
  if (!previewInspectorSession.runtimeFallbackOverrides.delete(fallbackId)) return;
  previewInspectorSession.runtimeFallbackSmartIds.delete(fallbackId);
  previewInspectorSession.runtimeFallbackSmartPathSignatures.delete(fallbackId);
  previewInspectorSession.runtimeFallbackMaterializedOverrides.delete(fallbackId);
  commitPreviewInspectorRuntimeFallbackChange();
}

/** Serializes only the bounded JSON values explicitly authored in the blocker editor. */
function serializePreviewInspectorRuntimeFallbackOverrides() {
  initializePreviewInspectorRuntimeFallbackState();
  return Object.fromEntries(
    [...previewInspectorSession.runtimeFallbackOverrides].slice(
      0,
      PREVIEW_INSPECTOR_RUNTIME_FALLBACK_LIMIT,
    ),
  );
}

/** Describes the visual-only isolation status in detailed runtime diagnostics. */
function readPreviewInspectorRuntimeFallbackStatus() {
  const fallbacks = readPreviewInspectorRuntimeFallbacks();
  const count = fallbacks.length;
  initializePreviewInspectorRuntimeFallbackState();
  const effectCount = previewInspectorSession.runtimeEffectIsolations.size;
  const manualCount = fallbacks.filter((fallback) =>
    fallback.mode === 'manual' || fallback.mode === 'smart-manual',
  ).length;
  const effectSuffix = effectCount > 0
    ? '; ' + String(effectCount) + ' render-only effect failure(s) isolated'
    : '';
  return readPreviewInspectorFallbackValuesEnabled()
    ? 'active: ' + String(count) + ' render-blocking hook edge(s) currently use generated static values' + effectSuffix
    : manualCount > 0
      ? 'manual only: ' + String(manualCount) + ' hook edge(s) use explicit user pass values'
      : 'disabled by user: authored hook failures, nullish values, and missing fields are preserved';
}
`;
}
