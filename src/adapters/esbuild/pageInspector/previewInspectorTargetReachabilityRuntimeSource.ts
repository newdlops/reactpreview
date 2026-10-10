/**
 * Generates target-guided application-path traversal for React Page Inspector.
 *
 * A valid login, permission, loading, or empty branch can omit the component selected in the
 * editor, so the wrapped export becomes a reachability assertion rather than an error assertion.
 * One instrumented gate advances per commit; success requires the authored page root and selected
 * target in one corridor. Direct rendering remains an explicit diagnostic mode.
 */
import { createPreviewInspectorTargetContextualBoundaryRuntimeSource } from './previewInspectorTargetContextualBoundaryRuntimeSource';
import { createPreviewInspectorTargetReachabilityStateRuntimeSource } from './previewInspectorTargetReachabilityStateRuntimeSource';
import { createPreviewInspectorTargetGateSelectionRuntimeSource } from './previewInspectorTargetGateSelectionRuntimeSource';
import { createPreviewInspectorTargetRequirementTraversalRuntimeSource } from './previewInspectorTargetRequirementTraversalRuntimeSource';
import { createPreviewInspectorRequirementFrontierRuntimeSource } from './previewInspectorRequirementFrontierRuntimeSource';
import { createPreviewInspectorRequirementConvergenceRuntimeSource } from './previewInspectorRequirementConvergenceRuntimeSource';
import { createPreviewInspectorPageTabActivationRuntimeSource } from './previewInspectorPageTabActivationRuntimeSource';
import { createPreviewInspectorTargetPathEvidenceRuntimeSource } from './previewInspectorTargetPathEvidenceRuntimeSource';
import { createPreviewInspectorTargetViewportRevealRuntimeSource } from './previewInspectorTargetViewportRevealRuntimeSource';
/**
 * Creates browser source for bounded DFS page traversal and explicit target-only diagnostics.
 *
 * Expected lexical bindings include React, the shared Inspector session/store, condition, data, and
 * runtime-fallback registries, plus notification and console helpers from the composed entry.
 *
 * @returns Plain JavaScript source concatenated into the Page Inspector browser runtime.
 */
export function createPreviewInspectorTargetReachabilityRuntimeSource(): string {
  const requirementFrontierRuntimeSource = createPreviewInspectorRequirementFrontierRuntimeSource();
  const requirementConvergenceRuntimeSource =
    createPreviewInspectorRequirementConvergenceRuntimeSource();
  const pageTabActivationRuntimeSource = createPreviewInspectorPageTabActivationRuntimeSource();
  const targetPathEvidenceRuntimeSource = createPreviewInspectorTargetPathEvidenceRuntimeSource();
  const targetViewportRevealRuntimeSource =
    createPreviewInspectorTargetViewportRevealRuntimeSource();
  return String.raw`
const PREVIEW_INSPECTOR_TARGET_REACHABILITY_PASS_LIMIT = 16;
const PREVIEW_INSPECTOR_TARGET_REACHABILITY_IDLE_LIMIT = 2;
const PREVIEW_INSPECTOR_MINIMUM_REQUIREMENT_PASS_LIMIT = 8;
const PREVIEW_INSPECTOR_TARGET_INITIAL_PROBE_DELAY_MS = 160;
const PREVIEW_INSPECTOR_TARGET_CONTINUATION_PROBE_DELAY_MS = 48;
const PREVIEW_INSPECTOR_TARGET_DIRECT_PROBE_DELAY_MS = 32;
const PREVIEW_INSPECTOR_TARGET_NEURAL_RENDER_SETTLE_DELAY_MS = 96;
${requirementFrontierRuntimeSource}
${requirementConvergenceRuntimeSource}
${pageTabActivationRuntimeSource}
${targetPathEvidenceRuntimeSource}
${targetViewportRevealRuntimeSource}
${createPreviewInspectorTargetContextualBoundaryRuntimeSource()}
${createPreviewInspectorTargetReachabilityStateRuntimeSource()}
${createPreviewInspectorTargetGateSelectionRuntimeSource()}
${createPreviewInspectorTargetRequirementTraversalRuntimeSource()}
/** Lazily initializes ephemeral traversal state retained only by the pinned preview webview. */
function initializePreviewInspectorTargetReachabilityState() {
  if (!(previewInspectorSession.targetReachabilityByKey instanceof Map)) {
    previewInspectorSession.targetReachabilityByKey = new Map();
  }
  if (!(previewInspectorSession.minimumRequirementSearchByKey instanceof Map)) {
    previewInspectorSession.minimumRequirementSearchByKey = new Map();
  }
  if (!(previewInspectorSession.contextualTargetFallbackCountByKey instanceof Map)) {
    previewInspectorSession.contextualTargetFallbackCountByKey = new Map();
  }
  if (!(previewInspectorSession.contextualTargetFallbackCapabilitiesByKey instanceof Map)) {
    previewInspectorSession.contextualTargetFallbackCapabilitiesByKey = new Map();
  }
  if (!(previewInspectorSession.contextualTargetFallbackRolesByKey instanceof Map)) {
    previewInspectorSession.contextualTargetFallbackRolesByKey = new Map();
  }
  if (!(previewInspectorSession.contextualTargetFallbackClaimsByKey instanceof Map)) {
    previewInspectorSession.contextualTargetFallbackClaimsByKey = new Map();
  }
}

/** Reports whether the exact selected target facade committed at least one live boundary. */
function hasMountedPreviewInspectorTarget(state) {
  const boundaries = readPreviewInspectorTargetBoundaries(state);
  return boundaries instanceof Set && boundaries.size > 0;
}
/**
 * Adds selected-export runtime names to root-to-target evidence. HOC factories can disappear from
 * import graphs while returned functions own redirect gates; mounted siblings are never promoted.
 */
function rememberPreviewInspectorTargetRuntimeOwnerNames(exportName, candidateNames) {
  initializePreviewInspectorTargetReachabilityState();
  if (!(previewInspectorSession.directTargetRuntimeOwnerNamesByExport instanceof Map)) {
    previewInspectorSession.directTargetRuntimeOwnerNamesByExport = new Map();
  }
  const names = candidateNames
    .filter((name) => typeof name === 'string' && name.length > 0 && name.length <= 160);
  let retainedNames = previewInspectorSession.directTargetRuntimeOwnerNamesByExport.get(exportName);
  if (!(retainedNames instanceof Set)) {
    retainedNames = new Set();
    previewInspectorSession.directTargetRuntimeOwnerNamesByExport.set(exportName, retainedNames);
  }
  let changed = false;
  for (const name of names) {
    if (retainedNames.has(name)) continue;
    retainedNames.add(name);
    changed = true;
  }
  const key = previewInspectorSession.activeTargetReachabilityKey;
  if (typeof key !== 'string') return changed;
  const state = previewInspectorSession.targetReachabilityByKey.get(key);
  if (state === undefined || state.targetExportName !== exportName) return changed;
  for (const name of names) {
    if (!state.runtimeOwnerNames.includes(name)) state.runtimeOwnerNames.push(name);
  }
  return changed;
}
/** Adds the exported facade's exact public runtime name before its selected boundary commits. */
function rememberPreviewInspectorTargetRuntimeOwner(exportName, Component) {
  const names = [Component?.displayName, Component?.name]
    .filter((name) => typeof name === 'string' && name.length > 0 && name.length <= 160);
  if (!(previewInspectorSession.targetFacadeRuntimeOwnerNamesByExport instanceof Map)) {
    previewInspectorSession.targetFacadeRuntimeOwnerNamesByExport = new Map();
  }
  previewInspectorSession.targetFacadeRuntimeOwnerNamesByExport.set(exportName, new Set(names));
  return rememberPreviewInspectorTargetRuntimeOwnerNames(exportName, names);
}
/**
 * Reads only the single-child component chain inside the exact selected-target boundary.
 *
 * A HOC can have owners PageComponent -> GuardedPage -> Navigate while static evidence contains
 * only PageComponent. The walk stops at a host or branch and never promotes page siblings.
 */
function collectPreviewInspectorTargetMountedOwnerNames(boundary) {
  const boundaryFiber = readPreviewInspectorBoundaryFiber(boundary);
  let fiber = readPreviewInspectorFiberLink(boundaryFiber, 'child');
  const visited = new Set();
  const names = [];
  for (let depth = 0; fiber !== undefined && depth < 24 && !visited.has(fiber); depth += 1) {
    visited.add(fiber);
    const kind = classifyPreviewInspectorFiber(fiber);
    if (kind === 'host' || kind === 'text' || kind === 'portal') break;
    const name = namePreviewInspectorFiber(fiber, kind);
    if (
      ['class', 'forward-ref', 'function', 'lazy', 'memo'].includes(kind) &&
      !isPreviewInspectorOwnedFiber(fiber, name, kind) &&
      typeof name === 'string' &&
      name.length > 0 &&
      name.length <= 160 &&
      !names.includes(name)
    ) {
      names.push(name);
    }
    /* Multiple children are authored render output, not an unambiguous wrapper continuation. */
    if (readPreviewInspectorFiberLink(fiber, 'sibling') !== undefined) break;
    fiber = readPreviewInspectorFiberLink(fiber, 'child');
  }
  return names;
}
/**
 * Admits exact nested HOC owners to DFS and retries one cold direct render when new evidence appears.
 * A Set makes the retry self-settling: the second commit discovers no new owner and cannot loop.
 */
function rememberPreviewInspectorTargetMountedOwnerChain(exportName, boundary) {
  const names = collectPreviewInspectorTargetMountedOwnerNames(boundary);
  const changed = rememberPreviewInspectorTargetRuntimeOwnerNames(exportName, names);
  if (
    changed &&
    typeof previewInspectorSession.activeTargetReachabilityKey !== 'string' &&
    previewInspectorSession.fallbackValuesEnabled === true
  ) {
    previewInspectorSession.renderConditionRevision =
      (Number.isSafeInteger(previewInspectorSession.renderConditionRevision)
        ? previewInspectorSession.renderConditionRevision
        : 0) + 1;
    notifyPreviewInspector();
    schedulePreviewInspectorCommitRefresh();
  }
  return names;
}
/**
 * Latches a selected target commit before a redirect or navigation effect can remove its boundary.
 * A guard commonly renders Navigate, commits, and changes the MemoryRouter location well before the
 * delayed DFS evaluation. Remembering that short-lived commit lets the traversal examine the
 * already registered off-graph HOC condition without mistaking unrelated pre-target gates for it.
 */
function markPreviewInspectorTargetReachabilityMount(exportName) {
  initializePreviewInspectorTargetReachabilityState();
  const key = previewInspectorSession.activeTargetReachabilityKey;
  if (typeof key !== 'string') return;
  const state = previewInspectorSession.targetReachabilityByKey.get(key);
  if (state === undefined || state.targetExportName !== exportName) return;
  state.targetMounted = hasMountedPreviewInspectorTarget(state);
  state.targetWasMounted = true;
  if (typeof settlePreviewInspectorNeuralRenderStateTarget === 'function') {
    settlePreviewInspectorNeuralRenderStateTarget(state);
  }
}
/**
 * Reads the target-output verifier's static proof for a selected export that only navigates.
 * Keeping this proof on the verifier avoids accepting a short HOC or parent redirect merely
 * because some boundary with the same public export name committed before DFS observed it.
 */
function hasPreviewInspectorIntentionalNavigationTargetOutput(state) {
  if (typeof hasPreviewInspectorResolvedTargetOutput !== 'function') return false;
  const detector = hasPreviewInspectorResolvedTargetOutput.hasIntentionalNavigationOutput;
  return typeof detector === 'function' && detector(state) === true;
}

/**
 * Lets an exact target revived by a learned render-state value supersede an older contextual probe.
 * Contextual fallback normally stays fail-closed around its one retained-route boundary. Once the
 * neural head has selected state for this exact source, however, that original boundary can acquire
 * authored output in place and must be evaluated again instead of remaining permanently shadowed.
 */
function readPreviewInspectorTargetResolutionBoundaries(state) {
  const exactBoundaries = readPreviewInspectorTargetBoundaries(state);
  if (state?.contextualTargetFallbackRequested !== true) return exactBoundaries;
  if (
    typeof hasPreviewInspectorNeuralRenderStateForSource === 'function' &&
    hasPreviewInspectorNeuralRenderStateForSource(state.targetSourcePath)
  ) return exactBoundaries;
  return new Set([readPreviewInspectorContextualTargetBoundary(state)].filter(Boolean));
}
/**
 * Requires the selected boundary to own connected host output and to remain error-free.
 * A HOC can mount the facade boundary and immediately return Navigate/null before invoking the
 * authored visual component; treating that boundary alone as success stops DFS on a blank page.
 * A compiler-proven navigation-only export is the narrow exception: its authored output changes
 * the route and therefore cannot retain either a host node or its boundary at settled observation.
 */
function hasPreviewInspectorTargetHostOutput(state) {
  const boundaries = readPreviewInspectorTargetResolutionBoundaries(state);
  state.targetHasAnyHostOutput = false;
  state.targetDeferredCallbackPending = false;
  state.targetOutputKind = 'none';
  state.targetOutputRecoveryPending = false;
  state.targetEffectControllerOutput = false;
  state.targetRenderedEmpty = false;
  if (!(boundaries instanceof Set)) return false;
  for (const boundary of boundaries) {
    if (boundary?.state?.error !== undefined) continue;
    if (typeof hasPreviewInspectorResolvedTargetOutput === 'function'
      ? hasPreviewInspectorResolvedTargetOutput(boundary, state)
      : collectPreviewInspectorFiberElements(boundary).length > 0) return true;
  }
  const activeError = typeof readPreviewInspectorRuntimeHealthTargetError === 'function'
    ? readPreviewInspectorRuntimeHealthTargetError(state.targetExportName)
    : undefined;
  if (
    state.targetWasMounted === true &&
    activeError === undefined &&
    hasPreviewInspectorIntentionalNavigationTargetOutput(state)
  ) {
    state.targetOutputError = undefined;
    state.targetOutputKind = 'target-output';
    state.targetOutputRecoveryPending = false;
    state.targetRenderedEmpty = true;
    return true;
  }
  return false;
}
/** Stops automatic branch traversal while the selected target owns a contained render failure. */
function hasPreviewInspectorTargetRenderError(state) {
  const boundaries = readPreviewInspectorTargetResolutionBoundaries(state);
  return boundaries instanceof Set &&
    [...boundaries].some((boundary) => boundary?.state?.error !== undefined);
}
/** Reports success only when the authored root and a visible selected target share one live render. */
function hasReachedPreviewInspectorPageCorridor(state) {
  return state.directTarget !== true &&
    state.pageRootCommitted === true &&
    state.targetMounted === true &&
    state.targetHasOutput === true &&
    (typeof hasPreviewInspectorCompletePageExecutionContext !== 'function' ||
      hasPreviewInspectorCompletePageExecutionContext(state));
}
/**
 * Ends the value search once the target's own output is handed to the page-context lane. The
 * host-side page-execution retry decides the remaining context; without this the search stays
 * "searching" forever when that retry is blocked or never answered. It is not marked exhausted.
 */
function settlePreviewInspectorRequirementSearchForPageContext(state) {
  if (
    state.targetHasOutput !== true ||
    typeof readPreviewInspectorMinimumRequirementSearch !== 'function' ||
    typeof settlePreviewInspectorMinimumRequirementSearch !== 'function'
  ) return false;
  try {
    if (readPreviewInspectorMinimumRequirementSearch(state)?.status !== 'searching') return false;
    settlePreviewInspectorMinimumRequirementSearch(state);
    return true;
  } catch {
    return false;
  }
}
/** Evaluates one settled commit and advances at most one path gate. */
function evaluatePreviewInspectorTargetReachability(descriptor, candidate, state) {
  state.targetMounted = hasMountedPreviewInspectorTarget(state);
  state.targetWasMounted = state.targetWasMounted === true || state.targetMounted;
  const targetRenderError = hasPreviewInspectorTargetRenderError(state) ||
    state.pendingTargetRepairFailure !== undefined;
  state.targetHasOutput = targetRenderError
    ? false
    : hasPreviewInspectorTargetHostOutput(state);
  // Real application CSS can make a shell fill the window above a target mounted after it.
  if (state.targetHasOutput === true) revealPreviewInspectorReachedTargetViewport(state);
  if (
    state.targetHasOutput === true &&
    typeof recordPreviewInspectorNeuralSuccessfulPath === 'function'
  ) {
    recordPreviewInspectorNeuralSuccessfulPath(state);
  } else if (typeof handlePreviewInspectorNeuralSuccessfulPathRestorationFailure === 'function') {
    handlePreviewInspectorNeuralSuccessfulPathRestorationFailure(state);
  }
  if (
    typeof isPreviewInspectorNeuralPageExecutionContextTransitionPending === 'function' &&
    isPreviewInspectorNeuralPageExecutionContextTransitionPending(state)
  ) {
    const searchSettled = settlePreviewInspectorRequirementSearchForPageContext(state);
    if (state.status !== 'recovering-page-context' || searchSettled) {
      state.status = 'recovering-page-context';
      notifyPreviewInspector();
      schedulePreviewInspectorTreeRefresh();
    }
    return;
  }
  if (
    typeof isPreviewInspectorPageExecutionPreparationBlocked === 'function' &&
    isPreviewInspectorPageExecutionPreparationBlocked(state)
  ) {
    state.status = 'page-context-incomplete';
    if (settlePreviewInspectorRequirementSearchForPageContext(state)) {
      notifyPreviewInspector();
      schedulePreviewInspectorTreeRefresh();
    }
    return;
  }
  if (
    typeof isPreviewInspectorNeuralPageExecutionContextRecoveryExhausted === 'function' &&
    isPreviewInspectorNeuralPageExecutionContextRecoveryExhausted(state)
  ) {
    if (state.exhausted !== true || state.status !== 'page-blocked') {
      state.exhausted = true;
      state.status = 'page-blocked';
      reportPreviewInspectorPageCorridorBlocked(state);
      notifyPreviewInspector();
      schedulePreviewInspectorTreeRefresh();
    }
    return;
  }
  if (
    state.targetMounted !== true &&
    state.targetWasMounted === true &&
    state.targetHasOutput === true &&
    hasPreviewInspectorIntentionalNavigationTargetOutput(state)
  ) {
    // The exact boundary is gone only because its authored output completed the route transition.
    // Promote the latched commit to corridor-mounted semantics for existing blocker/UI consumers.
    state.targetMounted = true;
  }
  if (!targetRenderError && hasReachedPreviewInspectorPageCorridor(state)) {
    state.viewportRevealPending = false;
    completePreviewInspectorMinimumRequirementSearch(state);
    state.status = 'reached';
    state.idlePasses = 0;
    notifyPreviewInspector();
    schedulePreviewInspectorTreeRefresh();
    return;
  }
  if (targetRenderError) {
    state.viewportRevealPending = false;
    if (isPreviewInspectorTargetAutoAttemptPending(state)) {
      state.status = 'settling-auto-attempt';
      schedulePreviewInspectorTreeRefresh();
      return;
    }
    if (
      typeof canContinuePreviewInspectorMinimumRequirementsThroughBaselineError === 'function' &&
      canContinuePreviewInspectorMinimumRequirementsThroughBaselineError(state) &&
      advancePreviewInspectorMinimumRequirementSearch(descriptor, candidate, state)
    ) return;
    if (advancePreviewInspectorTargetFailureRequirement(state)) return;
    state.status = 'target-error';
    state.idlePasses = 0;
    schedulePreviewInspectorTreeRefresh();
    return;
  }
  if (settlePreviewInspectorNeuralRenderStateTarget(state)) return;
  if (
    (state.targetMounted || state.targetWasMounted) &&
    !state.targetHasOutput
  ) {
    const localUiController =
      typeof autoActivatePreviewInspectorTargetLocalUiController === 'function'
        ? autoActivatePreviewInspectorTargetLocalUiController(state)
        : undefined;
    if (localUiController !== undefined) {
      state.status = 'activating-local-ui';
      state.probeRevision += 1;
      notifyPreviewInspector();
      schedulePreviewInspectorTreeRefresh();
      return;
    }
  }
  if (
    (state.targetMounted || state.targetWasMounted) &&
    !state.targetHasOutput &&
    state.overlayVisibilityAttempted !== true && !isPreviewInspectorOverlayRevealDeferred(state)
  ) {
    state.overlayVisibilityAttempted = true;
    const visibilityPath = typeof autoRevealPreviewInspectorOverlayTarget === 'function'
      ? autoRevealPreviewInspectorOverlayTarget(state.targetExportName, state.key)
      : undefined;
    if (visibilityPath !== undefined) {
      state.status = 'revealing-overlay';
      state.probeRevision += 1;
      return;
    }
  }
  if (
    state.targetMounted !== true &&
    state.targetWasMounted !== true &&
    autoActivatePreviewInspectorTargetPageTab(state) !== undefined
  ) {
    state.exhausted = false;
    state.idlePasses = 0;
    state.status = 'activating-page-tab';
    state.probeRevision += 1;
    notifyPreviewInspector();
    schedulePreviewInspectorTreeRefresh();
    schedulePreviewInspectorCommitRefresh();
    return;
  }
  if (
    (state.targetMounted || state.targetWasMounted) &&
    !state.targetHasOutput &&
    state.viewportRevealPending === true
  ) {
    state.status = 'revealing-target-viewport';
    schedulePreviewInspectorTreeRefresh();
    return;
  }
  if (
    (state.targetMounted || state.targetWasMounted) &&
    !state.targetHasOutput &&
    revealPreviewInspectorMountedTargetViewport(descriptor, candidate, state)
  ) return;
  if (state.directTarget) {
    state.status = state.targetHasOutput
      ? 'target-only'
      : state.targetMounted
        ? 'target-only-empty'
        : 'target-only-loading';
    schedulePreviewInspectorTreeRefresh();
    return;
  }
  if (isPreviewInspectorTargetAutoAttemptPending(state)) {
    state.status = 'settling-auto-attempt';
    schedulePreviewInspectorTreeRefresh();
    return;
  }
  if (
    (state.targetMounted || state.targetWasMounted) &&
    !state.targetHasOutput &&
    hasPreviewInspectorExactTargetSmartRequirement(descriptor, candidate, state) &&
    startPreviewInspectorDeterministicRequirementSearch(descriptor, candidate, state)
  ) {
    return;
  }
  const gateSearch = createPreviewInspectorTargetGateSearch(descriptor, candidate, state);
  const mountedTargetGate = (state.targetMounted || state.targetWasMounted) && !state.targetHasOutput
    ? selectPreviewInspectorNextTargetGate(descriptor, candidate, state, true, gateSearch)
    : undefined;
  // A newly committed, path-local JSX gate is stronger reachability evidence than unrelated hook
  // requirements collected from the surrounding application shell. Traverse it before spending
  // another minimum-value pass (or closing that pass circuit at its limit).
  const nextGate = mountedTargetGate ?? selectPreviewInspectorNextTargetGate(descriptor, candidate, state, false, gateSearch);
  const authoredStateGate = nextGate === undefined
    ? readPreviewInspectorPendingAuthoredStateGate(descriptor, candidate, state, gateSearch)
    : undefined;
  if (authoredStateGate !== undefined) {
    state.awaitingAuthoredStateConditionId = authoredStateGate.id;
    state.exhausted = false;
    state.idlePasses = 0;
    const activatedStateTrigger =
      typeof autoInvokePreviewInspectorAuthoredStateTrigger === 'function'
        ? autoInvokePreviewInspectorAuthoredStateTrigger(state, authoredStateGate)
        : undefined;
    if (activatedStateTrigger !== undefined) {
      state.status = 'activating-authored-state';
      state.probeRevision = Number.isSafeInteger(state.probeRevision)
        ? state.probeRevision + 1
        : 1;
      notifyPreviewInspector();
      schedulePreviewInspectorTreeRefresh();
      schedulePreviewInspectorCommitRefresh();
      return;
    }
    state.status = 'awaiting-authored-state';
    schedulePreviewInspectorTreeRefresh();
    return;
  }
  delete state.awaitingAuthoredStateConditionId;
  if (nextGate === undefined) {
    if (
      state.pageRootCommitted === true &&
      state.targetMounted !== true && state.targetWasMounted !== true &&
      hasPreviewInspectorTargetRevealingRejectedCondition(state)
    ) {
      /*
       * A compiler-proven target-local branch already committed without revealing this target and
       * has been session-rejected. Further page-wide hook/data filling cannot make that same branch
       * a stronger target owner; use the generated exact facade beside the still-mounted page.
       */
      settlePreviewInspectorMinimumRequirementSearch(state);
      if (requestPreviewInspectorContextualTargetFallback(state)) return;
    }
    if (stopPreviewInspectorRequirementConvergenceAtLimit(state)) {
      if (requestPreviewInspectorContextualTargetFallback(state)) return;
      return;
    }
    if (advancePreviewInspectorMinimumRequirementSearch(descriptor, candidate, state)) return;
  }
  if (state.targetMounted && state.pageRootCommitted !== true) {
    state.status = 'page-root-pending';
    schedulePreviewInspectorTreeRefresh();
    return;
  }
  if (state.exhausted === true && nextGate === undefined) return;
  if (nextGate !== undefined && state.attempt < PREVIEW_INSPECTOR_TARGET_REACHABILITY_PASS_LIMIT) {
    if (!setPreviewInspectorTargetGuidedConditionOverride(
      nextGate.condition.id,
      nextGate.desiredValue,
      nextGate.neuralResidualDecision,
    )) {
      state.rejectedConditions ??= [];
      state.rejectedConditions.push({
        expression: nextGate.condition.expression,
        id: nextGate.condition.id,
        reachabilityKey: state.key,
        reason: 'target-guided condition became inapplicable before commit',
      });
      state.status = 'probing';
      state.probeRevision += 1;
      notifyPreviewInspector();
      return;
    }
    state.appliedConditions.push({
      enabled: nextGate.desiredValue,
      expression: nextGate.condition.expression,
      id: nextGate.condition.id,
      line: nextGate.condition.line,
      ownerName: nextGate.condition.ownerName,
      sourcePath: nextGate.condition.sourcePath,
    });
    state.attempt += 1;
    state.exhausted = false;
    state.idlePasses = 0;
    state.status = 'advancing';
    const search = readPreviewInspectorMinimumRequirementSearch(state);
    if (search?.status === 'stalled') search.status = 'searching';
    state.probeRevision += 1;
    return;
  }
  if (startPreviewInspectorDeterministicRequirementSearch(descriptor, candidate, state)) return;
  state.idlePasses += 1;
  state.status = 'blocked';
  state.probeRevision += 1;
  if (
    state.attempt >= PREVIEW_INSPECTOR_TARGET_REACHABILITY_PASS_LIMIT ||
    state.idlePasses >= PREVIEW_INSPECTOR_TARGET_REACHABILITY_IDLE_LIMIT
  ) {
    settlePreviewInspectorMinimumRequirementSearch(state);
    if (requestPreviewInspectorContextualTargetFallback(state)) return;
    if (
      typeof requestPreviewInspectorPageExecutionRetry === 'function' &&
      requestPreviewInspectorPageExecutionRetry(descriptor, candidate)
    ) {
      state.exhausted = true;
      state.status = 'retrying-page-execution';
      notifyPreviewInspector();
      schedulePreviewInspectorTreeRefresh();
      return;
    }
    state.exhausted = true;
    state.status = 'page-blocked';
    reportPreviewInspectorPageCorridorBlocked(state);
    notifyPreviewInspector();
    schedulePreviewInspectorTreeRefresh();
    return;
  }
  notifyPreviewInspector();
}

/**
 * Continues traversal directly from a trace settlement that already proves its React commit is
 * stable. This avoids depending on an incidental Inspector component rerender to create the next
 * effect timer, while the corridor key prevents an old attempt from advancing a newer selection.
 */
function continuePreviewInspectorTargetReachabilityAfterSettledAttempt(state) {
  if (state === undefined) return false;
  if (state.status !== 'probing') {
    state.lastContinuationSkipReason = 'status:' + String(state.status);
    return false;
  }
  if (previewInspectorSession.activeTargetReachabilityKey !== state.key) {
    state.lastContinuationSkipReason = 'inactive-key';
    return false;
  }
  const descriptor = typeof findSelectedPreviewInspectorDescriptor === 'function'
    ? findSelectedPreviewInspectorDescriptor()
    : undefined;
  const candidate = typeof readSelectedPreviewInspectorPageCandidate === 'function'
    ? readSelectedPreviewInspectorPageCandidate(descriptor)
    : undefined;
  if (descriptor === undefined) {
    state.lastContinuationSkipReason = 'missing-descriptor';
    return false;
  }
  if (candidate === undefined) {
    state.lastContinuationSkipReason = 'missing-candidate';
    return false;
  }
  if (createPreviewInspectorTargetReachabilityKey(descriptor, candidate) !== state.key) {
    state.lastContinuationSkipReason = 'candidate-key-mismatch';
    return false;
  }
  delete state.lastContinuationSkipReason;
  evaluatePreviewInspectorTargetReachability(descriptor, candidate, state);
  return true;
}
/**
 * Rechecks one mounted authored target after its exact compiler-proven effect has synchronously
 * registered context state. The store notification deliberately leaves the target instance key
 * alone, so initialized refs survive the single bounded render before ordinary DFS resumes.
 */
function readPreviewInspectorRuntimeEffectContinuationInstance(state, rawMetadata, ownershipToken) {
  const effectId = typeof rawMetadata?.id === 'string' ? rawMetadata.id : '';
  const sourcePath = typeof rawMetadata?.sourcePath === 'string'
    ? rawMetadata.sourcePath.replaceAll('\\', '/')
    : '';
  const descriptor = typeof findSelectedPreviewInspectorDescriptor === 'function'
    ? findSelectedPreviewInspectorDescriptor()
    : undefined;
  const candidate = typeof readSelectedPreviewInspectorPageCandidate === 'function'
    ? readSelectedPreviewInspectorPageCandidate(descriptor)
    : undefined;
  if (
    state === undefined ||
    (typeof ownershipToken !== 'object' && typeof ownershipToken !== 'function') ||
    ownershipToken === null ||
    state.directTarget === true ||
    state.status === 'reached' ||
    state.pageRootCommitted !== true ||
    effectId.length === 0 ||
    sourcePath.length === 0 ||
    sourcePath !== state.targetSourcePath ||
    descriptor === undefined ||
    candidate === undefined ||
    candidate.id !== state.candidateId ||
    createPreviewInspectorTargetReachabilityKey(descriptor, candidate) !== state.key
  ) return undefined;
  const boundaries = state.contextualTargetFallbackRequested === true
    ? new Set([readPreviewInspectorContextualTargetBoundary(state)].filter(Boolean))
    : readPreviewInspectorTargetBoundaries(state);
  const boundary = [...boundaries].find((candidateBoundary) =>
    candidateBoundary?.ownershipToken === ownershipToken &&
      hasPreviewInspectorOwnedBoundary(candidateBoundary, state) === true &&
      candidateBoundary?.state?.error === undefined,
  );
  if (boundary === undefined || hasPreviewInspectorTargetHostOutput(state)) return undefined;
  return { boundary, effectId };
}
/**
 * Rechecks one live exact target instance after its compiler-proven effect synchronously
 * registered context state. A state accepts one original token and, after the existing one-shot
 * latch, one contextual token; remounts and sibling instances fail closed.
 */
function continuePreviewInspectorTargetReachabilityAfterSuccessfulRuntimeEffect(rawMetadata, ownershipToken) {
  initializePreviewInspectorTargetReachabilityState();
  const key = previewInspectorSession.activeTargetReachabilityKey;
  const state = typeof key === 'string'
    ? previewInspectorSession.targetReachabilityByKey.get(key)
    : undefined;
  const instance = readPreviewInspectorRuntimeEffectContinuationInstance(
    state,
    rawMetadata,
    ownershipToken,
  );
  if (instance === undefined) return false;
  if (instance.boundary?.props?.effectControllerOutputCandidate === true) {
    state.effectControllerCompletionToken = ownershipToken;
  }
  const phase = instance.boundary?.props?.contextualBoundaryRole === 'retained-route'
    ? 'contextual'
    : 'original';
  if ((phase === 'contextual') !== (state.contextualTargetFallbackRequested === true)) return false;
  state.topologyEffectContinuationAccepted = true;
  if (phase === 'contextual') state.topologyContextualEffectContinuationAccepted = true;
  else state.topologyOriginalEffectContinuationAccepted = true;
  const tokensByPhase = state.successfulRuntimeEffectContinuationTokensByPhase ??= new Map();
  const admittedToken = tokensByPhase.get(phase);
  if (admittedToken !== undefined && admittedToken !== ownershipToken) return false;
  if (admittedToken === undefined && tokensByPhase.size >= 2) return false;
  tokensByPhase.set(phase, ownershipToken);
  const usedEffectIdsByToken = state.successfulRuntimeEffectContinuationIdsByToken ??= new WeakMap();
  const usedEffectIds = usedEffectIdsByToken.get(ownershipToken) ?? new Set();
  usedEffectIdsByToken.set(ownershipToken, usedEffectIds);
  if (usedEffectIds.has(instance.effectId)) return false;
  usedEffectIds.add(instance.effectId);
  const pendingEffectIdsByToken = state.successfulRuntimeEffectContinuationPendingIdsByToken ??= new WeakMap();
  const pendingEffectIds = pendingEffectIdsByToken.get(ownershipToken) ?? new Set();
  pendingEffectIdsByToken.set(ownershipToken, pendingEffectIds);
  pendingEffectIds.add(instance.effectId);
  notifyPreviewInspector();
  globalThis.setTimeout(() => {
    pendingEffectIds.delete(instance.effectId);
    if (previewInspectorSession.activeTargetReachabilityKey !== state.key) return;
    const current = readPreviewInspectorRuntimeEffectContinuationInstance(
      state,
      rawMetadata,
      ownershipToken,
    );
    if (
      current === undefined ||
      current.boundary !== instance.boundary ||
      (current.boundary?.props?.contextualBoundaryRole === 'retained-route'
        ? 'contextual'
        : 'original') !== phase
    ) return;
    state.topologyDelayedProbeFired = true;
    state.topologyBoundaryIdentityRetained = current.boundary === instance.boundary;
    if (phase === 'contextual') {
      state.topologyContextualDelayedProbeFired = true;
      state.topologyContextualBoundaryIdentityRetained = current.boundary === instance.boundary;
    } else {
      state.topologyOriginalDelayedProbeFired = true;
      state.topologyOriginalBoundaryIdentityRetained = current.boundary === instance.boundary;
    }
    const descriptor = typeof findSelectedPreviewInspectorDescriptor === 'function'
      ? findSelectedPreviewInspectorDescriptor()
      : undefined;
    const candidate = typeof readSelectedPreviewInspectorPageCandidate === 'function'
      ? readSelectedPreviewInspectorPageCandidate(descriptor)
      : undefined;
    if (descriptor === undefined || candidate === undefined) return;
    evaluatePreviewInspectorTargetReachability(descriptor, candidate, state);
  }, PREVIEW_INSPECTOR_TARGET_CONTINUATION_PROBE_DELAY_MS);
  return true;
}
/**
 * Rechecks the active authored corridor when its exact compiler-owned target gains host output
 * after an effect/provider commit. Registration can precede React's settled tree, so coalesce one
 * delayed continuation and repeat every identity check before using the ordinary evaluator.
 */
function continuePreviewInspectorTargetReachabilityAfterOwnedHostRegistration(record) {
  initializePreviewInspectorTargetReachabilityState();
  const key = previewInspectorSession.activeTargetReachabilityKey;
  const state = typeof key === 'string'
    ? previewInspectorSession.targetReachabilityByKey.get(key)
    : undefined;
  if (
    state === undefined ||
    state.directTarget === true ||
    state.status === 'reached' ||
    record?.exportName !== state.targetExportName ||
    record?.sourcePath !== state.targetSourcePath ||
    state.ownedHostContinuationPending === true
  ) return false;
  state.ownedHostContinuationPending = true;
  globalThis.setTimeout(() => {
    state.ownedHostContinuationPending = false;
    if (
      previewInspectorSession.activeTargetReachabilityKey !== state.key ||
      state.directTarget === true ||
      state.pageRootCommitted !== true ||
      state.status === 'reached' ||
      record?.exportName !== state.targetExportName ||
      record?.sourcePath !== state.targetSourcePath ||
      ![...(record?.nodes ?? [])].some((node) => node?.isConnected === true)
    ) return;
    const descriptor = typeof findSelectedPreviewInspectorDescriptor === 'function'
      ? findSelectedPreviewInspectorDescriptor()
      : undefined;
    const candidate = typeof readSelectedPreviewInspectorPageCandidate === 'function'
      ? readSelectedPreviewInspectorPageCandidate(descriptor)
      : undefined;
    if (
      descriptor === undefined ||
      candidate === undefined ||
      candidate?.id !== state.candidateId ||
      createPreviewInspectorTargetReachabilityKey(descriptor, candidate) !== state.key
    ) return;
    evaluatePreviewInspectorTargetReachability(descriptor, candidate, state);
  }, PREVIEW_INSPECTOR_TARGET_CONTINUATION_PROBE_DELAY_MS);
  return true;
}
/**
 * Marks the candidate subtree as one traversal pass and checks target presence after its commit.
 * Leaving the active key set for this mounted subtree lets downstream conditions and hook/data
 * consumers discovered by later state updates join the same progressive payload plan.
 */
function PreviewInspectorTargetReachabilityProbe({
  candidate,
  children,
  descriptor,
  directTarget,
  directTargetAvailable,
}) {
  usePreviewInspectorStore();
  const state = readPreviewInspectorTargetReachabilityState(descriptor, candidate);
  state.directTargetAvailable = directTargetAvailable === true;
  previewInspectorSession.activeTargetReachabilityKey = state.key;
  const probeRevision = state.probeRevision;
  React.useEffect(() => {
    const probeDelay =
      directTarget === true
        ? PREVIEW_INSPECTOR_TARGET_DIRECT_PROBE_DELAY_MS
        : state.attempt === 0 && probeRevision === 0
          ? PREVIEW_INSPECTOR_TARGET_INITIAL_PROBE_DELAY_MS
          : PREVIEW_INSPECTOR_TARGET_CONTINUATION_PROBE_DELAY_MS;
    const timer = globalThis.setTimeout(
      () => evaluatePreviewInspectorTargetReachability(descriptor, candidate, state),
      probeDelay,
    );
    return () => globalThis.clearTimeout(timer);
  }, [state, descriptor, candidate, probeRevision, directTarget, directTargetAvailable]);
  return children;
}
/** Collects paths exposed by the hook and request registries reached during progressive traversal. */
function readPreviewInspectorTargetReachabilityRequiredPaths(state) {
  const paths = [];
  const append = (value) => {
    if (typeof value === 'string' && value.length > 0 && !paths.includes(value) && paths.length < 96) {
      paths.push(value);
    }
  };
  for (const fallback of readPreviewInspectorRuntimeFallbacks()) {
    if (fallback.reachabilityKey !== state.key || fallback.passive === true) continue;
    for (const path of fallback.requiredPaths ?? []) append(fallback.hookName + '.' + path);
  }
  for (const request of readPreviewInspectorDataRequests()) {
    if (request.reachabilityKey !== state.key) continue;
    for (const path of readPreviewInspectorDataShapePaths(request.shape)) {
      append(request.label + '.' + path);
    }
  }
  for (const gate of state.appliedConditions ?? []) append('gate.' + gate.expression);
  return paths;
}

/** Returns logical blockers even when the page committed without throwing an exception. */
function readPreviewInspectorTargetReachabilityBlockers() {
  initializePreviewInspectorTargetReachabilityState();
  const activeKey = previewInspectorSession.activeTargetReachabilityKey;
  return [...previewInspectorSession.targetReachabilityByKey.values()]
    .filter((state) =>
      state.status !== 'reached' &&
      (typeof activeKey !== 'string' || state.key === activeKey),
    )
    .map((state) => ({
      ...state,
      id: 'target-reachability:' + state.key,
      line: state.appliedConditions?.at(-1)?.line,
      minimumRequirementSearch: readPreviewInspectorMinimumRequirementSearch(state),
      ownerName: state.appliedConditions?.at(-1)?.ownerName ?? state.rootName,
      requiredPaths: readPreviewInspectorTargetReachabilityRequiredPaths(state),
      sourcePath: state.appliedConditions?.at(-1)?.sourcePath,
    }));
}

/** Starts bounded convergence across hook/data edges without discarding proven branch choices. */
function smartFillPreviewInspectorTargetApplicationPath(blocker, options = {}) {
  const reachabilityKey = typeof blocker?.key === 'string' ? blocker.key : '';
  if (reachabilityKey.length === 0) {
    retryPreviewInspectorTargetApplicationPath();
    return true;
  }
  initializePreviewInspectorTargetReachabilityState();
  const descriptor = typeof findSelectedPreviewInspectorDescriptor === 'function'
    ? findSelectedPreviewInspectorDescriptor()
    : undefined;
  const candidate = typeof readSelectedPreviewInspectorPageCandidate === 'function'
    ? readSelectedPreviewInspectorPageCandidate(descriptor)
    : undefined;
  const state = previewInspectorSession.targetReachabilityByKey.get(reachabilityKey);
  resetPreviewInspectorRequirementConvergence(state ?? reachabilityKey);
  clearPreviewInspectorRequirementAutoRollbacks(reachabilityKey);
  if (typeof recordPreviewInspectorBlockerAutoDecision === 'function') {
    recordPreviewInspectorBlockerAutoDecision({
      action: 'Start minimum page-path requirement search',
      blockerId: blocker.id ?? 'target-reachability:' + reachabilityKey,
      blockerKind: 'target-reachability',
      blockerName: 'Target not reached · ' + String(blocker.targetExportName ?? 'selected export'),
      generatedPaths: blocker.requiredPaths ?? [],
      line: blocker.line,
      mode: 'minimum-requirement-dfs',
      ownerName: blocker.ownerName,
      reason: 'Traverse from the authored page root and fill only values demanded downstream',
      selectedValue: {
        dataAutoEnabled: true,
        fallbackValuesEnabled: true,
        retainedGates: blocker.appliedConditions ?? [],
      },
      sourcePath: blocker.sourcePath,
      summary: { applicationPath: blocker.applicationPath ?? [] },
    });
  }
  previewInspectorSession.minimumRequirementSearchByKey.set(reachabilityKey, {
    excludedCandidateIds: Array.isArray(options?.excludedCandidateIds)
      ? options.excludedCandidateIds.slice(0, 12)
      : [],
    explorationMode: typeof previewInspectorNeuralExplorationModes !== 'undefined' &&
      previewInspectorNeuralExplorationModes.includes(options?.explorationMode)
      ? options.explorationMode
      : undefined,
    explorationOrdinal: Number.isSafeInteger(options?.explorationOrdinal)
      ? Math.max(0, options.explorationOrdinal)
      : 0,
    observedPathCount: state === undefined ? 0 : readPreviewInspectorTargetReachabilityRequiredPaths(state).length,
    origin: options?.origin === 'automatic-neural'
      ? 'automatic-neural'
      : options?.origin === 'user-neural'
        ? 'user-neural'
        : 'user',
    pass: 0,
    status: 'searching',
  });
  previewInspectorSession.fallbackValuesEnabled = true;
  previewInspectorSession.dataAutoEnabled = true;
  if (state !== undefined) {
    state.exhausted = false;
    state.idlePasses = 0;
    state.status = 'searching-requirements';
    state.probeRevision += 1;
    if (advancePreviewInspectorMinimumRequirementSearch(descriptor, candidate, state)) return true;
  }
  previewInspectorSession.renderConditionRevision =
    (previewInspectorSession.renderConditionRevision ?? 0) + 1;
  persistPreviewInspectorState();
  notifyPreviewInspector();
  schedulePreviewInspectorTreeRefresh();
  schedulePreviewInspectorCommitRefresh();
  return true;
}

/** Restarts selected application-path traversal and discards only its automatic branch choices. */
function retryPreviewInspectorTargetApplicationPath() {
  const descriptor = findSelectedPreviewInspectorDescriptor();
  const candidate = readSelectedPreviewInspectorPageCandidate(descriptor);
  if (descriptor === undefined || candidate === undefined) return;
  const key = createPreviewInspectorTargetReachabilityKey(descriptor, candidate);
  resetPreviewInspectorRequirementConvergence(key);
  clearPreviewInspectorRequirementAutoRollbacks(key);
  previewInspectorSession.minimumRequirementSearchByKey?.delete(key);
  clearPreviewInspectorTargetGuidedConditionOverrides(key);
  previewInspectorSession.targetReachabilityByKey?.delete(key);
  previewInspectorSession.renderConditionRevision =
    (previewInspectorSession.renderConditionRevision ?? 0) + 1;
  notifyPreviewInspector();
  schedulePreviewInspectorCommitRefresh();
}

/** Lets the user choose immediate target rendering while keeping automatic providers and payloads. */
function showPreviewInspectorTargetDirectly() {
  const descriptor = findSelectedPreviewInspectorDescriptor();
  const candidate = readSelectedPreviewInspectorPageCandidate(descriptor);
  if (descriptor === undefined || candidate === undefined) return;
  activatePreviewInspectorDirectTarget(
    readPreviewInspectorTargetReachabilityState(descriptor, candidate),
  );
}
/** Leaves target-only diagnostics and resumes the same authored page corridor and DFS choices. */
function returnPreviewInspectorToPageContext() {
  const descriptor = findSelectedPreviewInspectorDescriptor();
  const candidate = readSelectedPreviewInspectorPageCandidate(descriptor);
  if (descriptor === undefined || candidate === undefined) return;
  const state = readPreviewInspectorTargetReachabilityState(descriptor, candidate);
  state.contextualTargetFallbackRequested = false;
  state.directTarget = false;
  state.detachedTargetPlacement = candidate?.detachedTargetPlacement;
  state.exhausted = false;
  state.idlePasses = 0;
  state.pageRootCommitted = false;
  state.status = 'probing';
  state.targetHasOutput = false;
  state.targetMounted = false;
  state.targetWasMounted = false;
  state.viewportRevealAttempted = false;
  state.viewportRevealPending = false;
  state.probeRevision += 1;
  notifyPreviewInspector();
  schedulePreviewInspectorCommitRefresh();
}
/** Clears obsolete traversal state after a candidate, export, or hot descriptor replacement. */
function resetPreviewInspectorTargetReachability() {
  initializePreviewInspectorTargetReachabilityState();
  const conditionChanged = clearPreviewInspectorTargetGuidedConditionOverrides();
  const rollbackChanged = clearPreviewInspectorRequirementAutoRollbacks();
  const stateChanged = previewInspectorSession.targetReachabilityByKey.size > 0;
  previewInspectorSession.targetReachabilityByKey.clear();
  previewInspectorSession.minimumRequirementSearchByKey.clear();
  previewInspectorSession.activeTargetReachabilityKey = undefined;
  return conditionChanged || rollbackChanged || stateChanged;
}
`;
}
