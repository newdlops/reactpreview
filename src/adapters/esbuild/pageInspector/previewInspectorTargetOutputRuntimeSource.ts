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
function createPreviewInspectorTargetOutputFactory() {
const PREVIEW_INSPECTOR_TARGET_OUTPUT_FIBER_LIMIT = 512;

/** Normalizes component/member spellings used by analyzer and runtime Fiber labels. */
function normalizePreviewInspectorTargetOutputName(value) {
  const text = typeof value === 'string' ? value.replace(/\(…\)$/u, '') : '';
  const generated = /^PreviewGenerated\(([^()]+)\)$/u.exec(text)?.[1] ?? text;
  return generated.split('.').at(-1) ?? generated;
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

/** Recognizes concrete loading/error UI, excluding passive wrappers around healthy output. */
function hasPreviewInspectorFallbackLikeTargetOutput(
  liveNames,
  targetExportName,
  deferredFallbackNames,
) {
  const normalizedTargetExportName = normalizePreviewInspectorTargetOutputName(targetExportName);
  return [...liveNames].some((name) =>
    name !== normalizedTargetExportName &&
      (name !== 'SuspenseLoader' || deferredFallbackNames.has(name)) &&
      /(?:ErrorFallback|ErrorPage|ErrorStatus|FallbackPage|Loading|LoadingPage|Loader|NotFoundStatus|Progress|Skeleton|Spinner)$/u.test(
        name,
      ),
  );
}

/** Records one non-success host-output classification for tree, blocker, and health diagnostics. */
function rejectPreviewInspectorTargetOutput(state, kind, error) {
  state.targetOutputKind = kind;
  state.targetOutputError = error;
  state.targetOutputRecoveryPending = error !== undefined;
  return false;
}

/**
 * Guarantees one post-grace recheck when a healthy exact Fiber appears immediately after an error.
 *
 * A commit can precede the short error-settlement window. Without this timer no later React commit
 * is guaranteed, leaving valid authored output permanently classified as a fallback.
 */
function schedulePreviewInspectorTargetOutputRecovery(state, error, errorAge) {
  const token = String(error?.eventId ?? error?.timestamp ?? error?.message ?? 'runtime-error');
  if (state.targetOutputRecoveryToken === token && state.targetOutputRecoveryTimer !== undefined) {
    return;
  }
  if (state.targetOutputRecoveryTimer !== undefined) {
    clearTimeout(state.targetOutputRecoveryTimer);
  }
  state.targetOutputRecoveryToken = token;
  state.targetOutputRecoveryTimer = setTimeout(() => {
    state.targetOutputRecoveryTimer = undefined;
    state.targetOutputRecoveryToken = undefined;
    if (typeof schedulePreviewInspectorCommitRefresh === 'function') {
      schedulePreviewInspectorCommitRefresh();
    }
    if (typeof schedulePreviewInspectorTreeRefresh === 'function') {
      schedulePreviewInspectorTreeRefresh();
    }
  }, Math.max(1, 321 - Math.max(0, errorAge)));
}

/** Promotes target output and releases a stale root error only after authored output is proven. */
function acceptPreviewInspectorTargetOutput(state) {
  if (state.targetOutputRecoveryTimer !== undefined) {
    clearTimeout(state.targetOutputRecoveryTimer);
    state.targetOutputRecoveryTimer = undefined;
  }
  state.targetOutputRecoveryToken = undefined;
  state.targetOutputKind = 'target-output';
  state.targetOutputError = undefined;
  state.targetOutputRecoveryPending = false;
  if (typeof clearPreviewInspectorRuntimeHealthTargetError === 'function') {
    clearPreviewInspectorRuntimeHealthTargetError(state.targetExportName);
  }
  return true;
}

/** Reports whether a target owns both DOM and the authored JSX below any wrapper-only root. */
function hasPreviewInspectorResolvedTargetOutput(boundary, state) {
  const expected = readPreviewInspectorExpectedTargetOutput(state);
  const activeError = typeof readPreviewInspectorRuntimeHealthTargetError === 'function'
    ? readPreviewInspectorRuntimeHealthTargetError(state.targetExportName)
    : undefined;
  const privatelyOwnedHosts = typeof readPreviewInspectorOwnedHosts === 'function'
    ? readPreviewInspectorOwnedHosts(boundary, state)
    : [];
  const targetDomOwnership = privatelyOwnedHosts.some((node) =>
    node?.nodeType === 1 && node.isConnected === true && mountNode?.contains?.(node) === true,
  );
  if (expected.hasIntentionalEmpty) {
    if (activeError !== undefined) {
      return rejectPreviewInspectorTargetOutput(state, 'fallback-output', activeError);
    }
    state.targetRenderedEmpty = true;
    return acceptPreviewInspectorTargetOutput(state);
  }
  const needsLiveNames = expected.deferredNames.size > 0 ||
    (expected.hasEvidence && expected.hasJsx && !expected.hasIntrinsicJsx) ||
    activeError !== undefined ||
    !expected.hasEvidence;
  const liveNames = needsLiveNames ? readPreviewInspectorLiveTargetOutputNames(boundary) : new Set();
  const hasAnyHostOutput = targetDomOwnership;
  if (hasAnyHostOutput) state.targetHasAnyHostOutput = true;
  const fallbackLikeOutput = hasPreviewInspectorFallbackLikeTargetOutput(
    liveNames,
    state.targetExportName,
    expected.deferredFallbackNames,
  );
  let resolved = false;
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
    if (hasIndependentOutput) resolved = hasAnyHostOutput;
    if (callbackRequired && !callbackInvoked) {
      return rejectPreviewInspectorTargetOutput(
        state,
        fallbackLikeOutput || activeError !== undefined ? 'fallback-output' : 'candidate-output',
        activeError,
      );
    }
  }
  if (!hasAnyHostOutput) {
    state.targetOutputKind = 'none';
    state.targetOutputRecoveryPending = false;
    return false;
  }
  if (!resolved) {
    if (!expected.hasEvidence) {
      resolved = targetDomOwnership && !fallbackLikeOutput;
    } else if (!expected.hasJsx) {
      resolved = false;
    } else if (expected.hasIntrinsicJsx || expected.deferredNames.size > 0) {
      resolved = true;
    } else {
      const requiredNames = expected.descendantNames.size > 0
        ? expected.descendantNames
        : expected.rootNames;
      resolved = requiredNames.size === 0 ||
        [...requiredNames].some((name) => liveNames.has(name));
    }
  }
  if (!targetDomOwnership) {
    return rejectPreviewInspectorTargetOutput(state, 'candidate-output', activeError);
  }
  if (!resolved) {
    return rejectPreviewInspectorTargetOutput(
      state,
      fallbackLikeOutput || activeError !== undefined ? 'fallback-output' : 'candidate-output',
      activeError,
    );
  }
  if (activeError !== undefined) {
    const errorAge = Date.now() - Number(activeError.timestamp ?? Date.now());
    if (errorAge < 320) {
      schedulePreviewInspectorTargetOutputRecovery(state, activeError, errorAge);
      return rejectPreviewInspectorTargetOutput(state, 'fallback-output', activeError);
    }
    if (fallbackLikeOutput) {
      return rejectPreviewInspectorTargetOutput(state, 'fallback-output', activeError);
    }
  }
  return acceptPreviewInspectorTargetOutput(state);
}
return hasPreviewInspectorResolvedTargetOutput;
}
`;
}
