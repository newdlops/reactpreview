/**
 * Distinguishes the selected file's authored JSX from a wrapper-owned loading/error host.
 *
 * A target boundary can own DOM while a QueryRenderer, Suspense wrapper, or error fallback has not
 * invoked the visible descendants authored in the selected file. Reachability must not call that
 * page ready: it would stop discovery on the same fallback screen the extension is meant to pass.
 * This adapter joins bounded static outcomes with live Fiber names and never mutates project Fiber.
 */

/** Creates browser source for authored target-output verification. */
export function createPreviewInspectorTargetOutputRuntimeSource(): string {
  return String.raw`
const PREVIEW_INSPECTOR_TARGET_OUTPUT_FIBER_LIMIT = 512;

/** Normalizes component/member spellings used by analyzer and runtime Fiber labels. */
function normalizePreviewInspectorTargetOutputName(value) {
  const text = typeof value === 'string' ? value.replace(/\(…\)$/u, '') : '';
  return text.split('.').at(-1) ?? text;
}

/** Collects root and nested component names for the selected or currently possible JSX outcomes. */
function readPreviewInspectorExpectedTargetOutput(state) {
  const descriptor = typeof findSelectedPreviewInspectorDescriptor === 'function'
    ? findSelectedPreviewInspectorDescriptor()
    : undefined;
  const plan = descriptor?.inspector?.renderOutcomesByExport?.[state.targetExportName];
  const outcomes = Array.isArray(plan?.outcomes) ? plan.outcomes.slice(0, 32) : [];
  const selected = typeof readPreviewInspectorSelectedRenderOutcome === 'function'
    ? readPreviewInspectorSelectedRenderOutcome()
    : undefined;
  const hasSelectedOutcome = selected?.exportName === state.targetExportName;
  const candidates = hasSelectedOutcome ? [selected] : outcomes;
  const deferredNames = new Set();
  const deferredFallbackNames = new Set();
  const deferredReceiverNames = new Set();
  const independentNames = new Set();
  const rootNames = new Set();
  const descendantNames = new Set();
  let hasDeferredHostOutput = false;
  let hasIntrinsicJsx = false;
  let hasJsx = false;
  const visit = (nodes, depth) => {
    if (!Array.isArray(nodes)) return;
    for (const node of nodes) {
      if (node === null || typeof node !== 'object') continue;
      const name = normalizePreviewInspectorTargetOutputName(node.name);
      if (name.length > 0) (depth === 0 ? rootNames : descendantNames).add(name);
      if (name.length > 0 && node.renderMode === 'deferred-callback') {
        deferredNames.add(name);
      }
      visit(node.children, depth + 1);
    }
  };
  /**
   * Finds each callback's nearest synchronous receiver while retaining unrelated visible roots.
   * Receiver names later prevent a dormant callback in an absent modal/slot from being reported as
   * a pending operation in the currently mounted page branch.
   */
  const inspectDeferredContract = (node) => {
    if (node === null || typeof node !== 'object') {
      return { synchronousNames: new Set(), unownedDeferred: false };
    }
    const name = normalizePreviewInspectorTargetOutputName(node.name);
    if (node.renderMode === 'deferred-callback') {
      if (name.length > 0) deferredNames.add(name);
      if (name === '#deferred-host-output') hasDeferredHostOutput = true;
      return { synchronousNames: new Set(), unownedDeferred: true };
    }
    const childEvidence = (Array.isArray(node.children) ? node.children : [])
      .map(inspectDeferredContract);
    if (childEvidence.some((evidence) => evidence.unownedDeferred)) {
      if (name.length > 0) deferredReceiverNames.add(name);
      for (const evidence of childEvidence) {
        if (!evidence.unownedDeferred) {
          for (const childName of evidence.synchronousNames) deferredFallbackNames.add(childName);
        }
      }
      return { synchronousNames: new Set(), unownedDeferred: false };
    }
    const synchronousNames = new Set(name.length > 0 ? [name] : []);
    for (const evidence of childEvidence) {
      for (const childName of evidence.synchronousNames) synchronousNames.add(childName);
    }
    return { synchronousNames, unownedDeferred: false };
  };
  for (const outcome of candidates) {
    if (outcome?.kind !== 'jsx') continue;
    hasJsx = true;
    const tree = Array.isArray(outcome.componentTree) ? outcome.componentTree : [];
    if (tree.length === 0) hasIntrinsicJsx = true;
    visit(tree, 0);
    for (const root of tree) {
      const evidence = inspectDeferredContract(root);
      for (const name of evidence.synchronousNames) independentNames.add(name);
    }
  }
  const soleOutcomeConditions = outcomes[0]?.conditions;
  const hasIntentionalEmpty = hasSelectedOutcome
    ? selected?.kind === 'empty'
    : outcomes.length === 1 &&
      outcomes[0]?.kind === 'empty' &&
      (!Array.isArray(soleOutcomeConditions) || soleOutcomeConditions.length === 0);
  return {
    deferredNames,
    deferredFallbackNames,
    deferredReceiverNames,
    descendantNames,
    hasEvidence: outcomes.length > 0,
    hasIntentionalEmpty,
    hasIntrinsicJsx,
    hasDeferredHostOutput,
    hasJsx,
    independentNames,
    rootNames,
  };
}

/** Reads only project component names contained by one selected-export boundary. */
function readPreviewInspectorLiveTargetOutputNames(boundary) {
  const boundaryFiber = readPreviewInspectorBoundaryFiber(boundary);
  const first = readPreviewInspectorFiberLink(boundaryFiber, 'child');
  const names = new Set();
  const pending = first === undefined ? [] : [first];
  const seen = new Set();
  while (pending.length > 0 && seen.size < PREVIEW_INSPECTOR_TARGET_OUTPUT_FIBER_LIMIT) {
    const fiber = pending.pop();
    if (fiber === undefined || seen.has(fiber)) continue;
    seen.add(fiber);
    const sibling = readPreviewInspectorFiberLink(fiber, 'sibling');
    const child = readPreviewInspectorFiberLink(fiber, 'child');
    if (sibling !== undefined) pending.push(sibling);
    if (child !== undefined) pending.push(child);
    const kind = classifyPreviewInspectorFiber(fiber);
    const name = namePreviewInspectorFiber(fiber, kind);
    if (!isPreviewInspectorOwnedFiber(fiber, name, kind) && !['host', 'text'].includes(kind)) {
      const normalized = normalizePreviewInspectorTargetOutputName(name);
      if (normalized.length > 0) names.add(normalized);
    }
  }
  return names;
}

/** Reports whether a target owns both DOM and the authored JSX below any wrapper-only root. */
function hasPreviewInspectorResolvedTargetOutput(boundary, state) {
  const expected = readPreviewInspectorExpectedTargetOutput(state);
  if (expected.hasIntentionalEmpty) {
    state.targetRenderedEmpty = true;
    return true;
  }
  const needsLiveNames = expected.deferredNames.size > 0 ||
    (expected.hasEvidence && expected.hasJsx && !expected.hasIntrinsicJsx);
  const liveNames = needsLiveNames ? readPreviewInspectorLiveTargetOutputNames(boundary) : new Set();
  const hasAnyHostOutput = collectPreviewInspectorFiberElements(boundary).length > 0;
  if (hasAnyHostOutput) state.targetHasAnyHostOutput = true;
  if (expected.deferredNames.size > 0) {
    const hasIndependentOutput = [...expected.independentNames].some((name) => liveNames.has(name));
    const namedCallbackInvoked = [...expected.deferredNames]
      .filter((name) => name !== '#deferred-host-output')
      .some((name) => liveNames.has(name));
    const hostCallbackInvoked = expected.hasDeferredHostOutput && hasAnyHostOutput &&
      ![...expected.deferredFallbackNames].some((name) => liveNames.has(name));
    // Pending is a runtime claim, so static callback evidence becomes pending only after its nearest
    // receiver is visible in this exact selected-export boundary.
    const hasLiveDeferredReceiver = [...expected.deferredReceiverNames]
      .some((name) => liveNames.has(name));
    const callbackRequired = !hasIndependentOutput;
    const callbackInvoked = namedCallbackInvoked || hostCallbackInvoked;
    state.targetDeferredCallbackPending ||=
      callbackRequired && hasLiveDeferredReceiver && !callbackInvoked;
    if (!callbackRequired || callbackInvoked) state.targetDeferredCallbackPending = false;
    if (hasIndependentOutput) return hasAnyHostOutput;
    if (callbackRequired && !callbackInvoked) return false;
  }
  if (!hasAnyHostOutput) return false;
  if (!expected.hasEvidence) return true;
  if (!expected.hasJsx) return false;
  if (expected.hasIntrinsicJsx) return true;
  if (expected.deferredNames.size > 0) return true;
  const requiredNames = expected.descendantNames.size > 0
    ? expected.descendantNames
    : expected.rootNames;
  if (requiredNames.size === 0) return true;
  return [...requiredNames].some((name) => liveNames.has(name));
}
`;
}
