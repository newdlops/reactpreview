/**
 * Generates the Page Inspector registry that bypasses render-critical hook failures.
 *
 * Compiler-issued hook wrappers call this runtime only in Page Inspector mode. The runtime keeps
 * successful complete values untouched, rethrows Suspense thenables, and substitutes or overlays a
 * bounded static value only when Auto values is enabled and a required runtime path is unavailable.
 */
import { createPreviewInspectorRuntimeFallbackMetadataRuntimeSource } from './previewInspectorRuntimeFallbackMetadataRuntimeSource';
import { createPreviewInspectorRuntimeFallbackValuesRuntimeSource } from './previewInspectorRuntimeFallbackValuesRuntimeSource';
import { createPreviewInspectorRuntimeFallbackSharingRuntimeSource } from './previewInspectorRuntimeFallbackSharingRuntimeSource';
import { createPreviewInspectorRuntimeFallbackRecommendationsRuntimeSource } from './previewInspectorRuntimeFallbackRecommendationsRuntimeSource';
import { createPreviewInspectorRuntimeFallbackResolutionRuntimeSource } from './previewInspectorRuntimeFallbackResolutionRuntimeSource';
import { createPreviewInspectorRuntimeFallbackEffectsRuntimeSource } from './previewInspectorRuntimeFallbackEffectsRuntimeSource';
import { createPreviewInspectorRuntimeFallbackOverridesRuntimeSource } from './previewInspectorRuntimeFallbackOverridesRuntimeSource';
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
  return (
    String.raw`
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
` +
    createPreviewInspectorRuntimeFallbackMetadataRuntimeSource() +
    createPreviewInspectorRuntimeFallbackValuesRuntimeSource() +
    createPreviewInspectorRuntimeFallbackSharingRuntimeSource() +
    createPreviewInspectorRuntimeFallbackRecommendationsRuntimeSource() +
    createPreviewInspectorRuntimeFallbackResolutionRuntimeSource() +
    createPreviewInspectorRuntimeFallbackEffectsRuntimeSource() +
    String.raw`
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
` +
    createPreviewInspectorRuntimeFallbackOverridesRuntimeSource() +
    String.raw`
`
  );
}
