/**
 * Distinguishes the selected file's authored JSX from a wrapper-owned loading/error host.
 *
 * A target boundary can own DOM while a QueryRenderer, Suspense wrapper, or error fallback has not
 * invoked the visible descendants authored in the selected file. Reachability must not call that
 * page ready: it would stop discovery on the same fallback screen the extension is meant to pass.
 * This adapter joins bounded static outcomes with live Fiber names and never mutates project Fiber.
 */
import type { PreviewReactRenderOutcomePlan } from '../staticResources/previewReactRenderOutcomeTypes';

/** Proves that one complete export inventory can only produce router navigation elements. */
export function isPreviewInspectorNavigationOnlyRenderOutcomePlan(
  plan: PreviewReactRenderOutcomePlan | undefined,
): boolean {
  if (plan === undefined || plan.truncated || plan.outcomes.length === 0) return false;
  return plan.outcomes.every(
    (outcome) =>
      outcome.kind === 'jsx' &&
      outcome.componentTree.length > 0 &&
      outcome.componentTree.every((root) => {
        const name = normalizePreviewInspectorNavigationOutputName(root.name);
        return (name === 'Navigate' || name === 'Redirect') && root.children.length === 0;
      }),
  );
}

/** Normalizes analyzer component/member spellings for the navigation-only compile contract. */
function normalizePreviewInspectorNavigationOutputName(value: string): string {
  const generated = /^PreviewGenerated\(([^()]+)\)$/u.exec(value.replace(/\(…\)$/u, ''))?.[1];
  const normalized = generated ?? value.replace(/\(…\)$/u, '');
  return normalized.split('.').at(-1) ?? normalized;
}

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

/**
 * Proves that every authored result for the selected export is a router-only navigation element.
 * The proof deliberately rejects mixed visible/navigation outcomes: a transient boundary commit
 * can be retained as completed output only when this file has no authored host-producing branch.
 */
function hasPreviewInspectorIntentionalNavigationOutput(state) {
  const descriptor = typeof findSelectedPreviewInspectorDescriptor === 'function'
    ? findSelectedPreviewInspectorDescriptor()
    : undefined;
  const plan = descriptor?.inspector?.renderOutcomesByExport?.[state.targetExportName];
  const outcomes = Array.isArray(plan?.outcomes) ? plan.outcomes.slice(0, 32) : [];
  if (plan?.truncated === true || outcomes.length === 0) return false;
  return outcomes.every((outcome) => {
    if (outcome?.kind !== 'jsx') return false;
    const roots = Array.isArray(outcome.componentTree) ? outcome.componentTree : [];
    return roots.length > 0 && roots.every((root) => {
      const name = normalizePreviewInspectorTargetOutputName(root?.name);
      const children = Array.isArray(root?.children) ? root.children : [];
      return ['Navigate', 'Redirect'].includes(name) && children.length === 0;
    });
  });
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
  const deferredOutputNames = new Set();
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
  /** Retains authored callback descendants whose runtime wrapper may hide the callback root name. */
  const collectDeferredOutputNames = (nodes) => {
    if (!Array.isArray(nodes)) return;
    for (const node of nodes) {
      if (node === null || typeof node !== 'object') continue;
      const name = normalizePreviewInspectorTargetOutputName(node.name);
      if (name.length > 0 && name !== '#deferred-host-output') deferredOutputNames.add(name);
      collectDeferredOutputNames(node.children);
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
      collectDeferredOutputNames(node.children);
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
    deferredOutputNames,
    deferredFallbackNames,
    deferredReceiverNames,
    descendantNames,
    hasEvidence: outcomes.length > 0,
    hasIntentionalEmpty,
    hasIntentionalNavigation: hasPreviewInspectorIntentionalNavigationOutput(state),
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

/**
 * Accepts a bounded compatibility host only below an authentic authored child component.
 *
 * Frontier projection may retain a real modal/page component while replacing one of its broad UI
 * dependencies with a structural host. That host cannot carry the selected file's private JSX
 * ownership token, but the live Fiber ancestry still proves that the authored child ran. Requiring
 * the exact expected component above the projected host prevents a projection of the selected
 * component itself from being mistaken for target output.
 */
function hasPreviewInspectorAuthenticProjectedTargetOutput(boundary, expected, targetExportName) {
  const expectedNames = new Set([...expected.rootNames, ...expected.descendantNames]);
  if (expectedNames.size === 0) return false;
  const normalizedTargetExportName = normalizePreviewInspectorTargetOutputName(targetExportName);
  const boundaryFiber = readPreviewInspectorBoundaryFiber(boundary);
  const first = readPreviewInspectorFiberLink(boundaryFiber, 'child');
  const pending = first === undefined
    ? []
    : [{ fiber: first, withinExpectedComponent: false }];
  const seen = new Set();
  while (pending.length > 0 && seen.size < PREVIEW_INSPECTOR_TARGET_OUTPUT_FIBER_LIMIT) {
    const entry = pending.pop();
    const fiber = entry?.fiber;
    if (fiber === undefined || seen.has(fiber)) continue;
    seen.add(fiber);
    const sibling = readPreviewInspectorFiberLink(fiber, 'sibling');
    if (sibling !== undefined) {
      pending.push({
        fiber: sibling,
        withinExpectedComponent: entry.withinExpectedComponent,
      });
    }
    const kind = classifyPreviewInspectorFiber(fiber);
    const name = namePreviewInspectorFiber(fiber, kind);
    const normalizedName = normalizePreviewInspectorTargetOutputName(name);
    const authenticExpectedComponent =
      !['host', 'text'].includes(kind) &&
      !isPreviewInspectorOwnedFiber(fiber, name, kind) &&
      !name.startsWith('PreviewShallow(') &&
      expectedNames.has(normalizedName);
    const withinExpectedComponent =
      entry.withinExpectedComponent || authenticExpectedComponent;
    const child = readPreviewInspectorFiberLink(fiber, 'child');
    if (child !== undefined) pending.push({ fiber: child, withinExpectedComponent });
    if (kind !== 'host') continue;
    const node = readPreviewInspectorOwnData(fiber, 'stateNode');
    const projectedIdentity = typeof node?.getAttribute === 'function'
      ? node.getAttribute('data-react-preview-shallow-component')
      : undefined;
    const projectedName = typeof projectedIdentity === 'string'
      ? normalizePreviewInspectorTargetOutputName(
          projectedIdentity.split(':').at(-1) ?? projectedIdentity,
        )
      : '';
    const exactExpectedProjection = projectedName.length > 0 &&
      projectedName !== normalizedTargetExportName &&
      expectedNames.has(projectedName);
    if (
      (withinExpectedComponent || exactExpectedProjection) &&
      node?.nodeType === 1 &&
      node.isConnected === true &&
      typeof projectedIdentity === 'string' &&
      node.closest?.('[' + PREVIEW_INSPECTOR_UI_ATTRIBUTE + ']') === null
    ) return true;
  }
  return false;
}

/**
 * Accepts connected host output below an authentic expected child of the exact target boundary.
 *
 * styled/memo/HOC libraries may invoke the selected file's inner component below their own Fiber,
 * outside the private JSX ownership context captured when the facade element was created. The
 * boundary still carries the compiler-proven source/export identity. Requiring one statically
 * expected authored component on the live ancestry keeps unrelated wrapper DOM from satisfying
 * the target, while the caller separately rejects loading/error fallback names.
 */
function hasPreviewInspectorAuthenticExpectedTargetOutput(boundary, expected) {
  const expectedNames = new Set([...expected.rootNames, ...expected.descendantNames]);
  if (expectedNames.size === 0) return false;
  const boundaryFiber = readPreviewInspectorBoundaryFiber(boundary);
  const first = readPreviewInspectorFiberLink(boundaryFiber, 'child');
  const pending = first === undefined
    ? []
    : [{ fiber: first, withinExpectedComponent: false }];
  const seen = new Set();
  while (pending.length > 0 && seen.size < PREVIEW_INSPECTOR_TARGET_OUTPUT_FIBER_LIMIT) {
    const entry = pending.pop();
    const fiber = entry?.fiber;
    if (fiber === undefined || seen.has(fiber)) continue;
    seen.add(fiber);
    const sibling = readPreviewInspectorFiberLink(fiber, 'sibling');
    if (sibling !== undefined) {
      pending.push({
        fiber: sibling,
        withinExpectedComponent: entry.withinExpectedComponent,
      });
    }
    const kind = classifyPreviewInspectorFiber(fiber);
    const name = namePreviewInspectorFiber(fiber, kind);
    const normalizedName = normalizePreviewInspectorTargetOutputName(name);
    const authenticExpectedComponent =
      !['host', 'text'].includes(kind) &&
      !isPreviewInspectorOwnedFiber(fiber, name, kind) &&
      !name.startsWith('PreviewShallow(') &&
      expectedNames.has(normalizedName);
    const withinExpectedComponent =
      entry.withinExpectedComponent || authenticExpectedComponent;
    const child = readPreviewInspectorFiberLink(fiber, 'child');
    if (child !== undefined) pending.push({ fiber: child, withinExpectedComponent });
    if (kind !== 'host' || !withinExpectedComponent) continue;
    const node = readPreviewInspectorOwnData(fiber, 'stateNode');
    if (
      node?.nodeType === 1 &&
      node.isConnected === true &&
      node.closest?.('[' + PREVIEW_INSPECTOR_UI_ATTRIBUTE + ']') === null
    ) return true;
  }
  return false;
}

/** Rejects malformed element-like values before exact target-type identity comparison. */
function isPreviewInspectorTargetElementType(type) {
  return (
    typeof type === 'string' ||
    typeof type === 'symbol' ||
    typeof type === 'function' ||
    (type !== null && typeof type === 'object')
  );
}

/**
 * Proves host output below the exact React element passed into the selected source/export boundary.
 *
 * Shared composites, styled-components, and similar wrappers may create the final intrinsic node in
 * another module or with React.createElement, so the selected file's private automatic-JSX ref cannot
 * tag it. Element-type identity is stronger than a display-name match: the target boundary received
 * this exact compiler-selected value and the live Fiber using the same value committed DOM below it.
 */
function hasPreviewInspectorDirectTargetElementOutput(boundary) {
  const boundaryProps = readPreviewInspectorOwnData(boundary, 'props');
  const targetElement = readPreviewInspectorOwnData(boundaryProps, 'children');
  const targetType = readPreviewInspectorOwnData(targetElement, 'type');
  if (!isPreviewInspectorTargetElementType(targetType)) return false;

  const boundaryFiber = readPreviewInspectorBoundaryFiber(boundary);
  const first = readPreviewInspectorFiberLink(boundaryFiber, 'child');
  const pending = first === undefined ? [] : [first];
  const seen = new Set();
  let targetFiber;
  while (pending.length > 0 && seen.size < PREVIEW_INSPECTOR_TARGET_OUTPUT_FIBER_LIMIT) {
    const fiber = pending.pop();
    if (fiber === undefined || seen.has(fiber)) continue;
    seen.add(fiber);
    const type = readPreviewInspectorOwnData(fiber, 'type');
    const elementType = readPreviewInspectorOwnData(fiber, 'elementType');
    if (type === targetType || elementType === targetType) {
      targetFiber = fiber;
      break;
    }
    const sibling = readPreviewInspectorFiberLink(fiber, 'sibling');
    const child = readPreviewInspectorFiberLink(fiber, 'child');
    if (sibling !== undefined) pending.push(sibling);
    if (child !== undefined) pending.push(child);
  }
  if (targetFiber === undefined) return false;

  const isConnectedProjectHost = (fiber) => {
    if (classifyPreviewInspectorFiber(fiber) !== 'host') return false;
    const node = readPreviewInspectorOwnData(fiber, 'stateNode');
    return (
      node?.nodeType === 1 &&
      node.isConnected === true &&
      node.closest?.('[' + PREVIEW_INSPECTOR_UI_ATTRIBUTE + ']') === null
    );
  };
  if (isConnectedProjectHost(targetFiber)) return true;
  const targetChild = readPreviewInspectorFiberLink(targetFiber, 'child');
  const targetPending = targetChild === undefined ? [] : [targetChild];
  const targetSeen = new Set();
  while (
    targetPending.length > 0 &&
    targetSeen.size < PREVIEW_INSPECTOR_TARGET_OUTPUT_FIBER_LIMIT
  ) {
    const fiber = targetPending.pop();
    if (fiber === undefined || targetSeen.has(fiber)) continue;
    targetSeen.add(fiber);
    const sibling = readPreviewInspectorFiberLink(fiber, 'sibling');
    const child = readPreviewInspectorFiberLink(fiber, 'child');
    if (sibling !== undefined) targetPending.push(sibling);
    if (child !== undefined) targetPending.push(child);
    if (isConnectedProjectHost(fiber)) return true;
  }
  return false;
}

/**
 * Accepts dependency-owned DOM below an explicitly detached exact target boundary.
 *
 * A selected file may return only shared composites such as Table, Badge, or IconButton. Those
 * dependencies own the eventual host Fibers, so JSX-token attribution alone cannot credit the
 * selected file even though its compiler facade and boundary both committed. Detached placement
 * is the narrow proof that this boundary cannot be a page-shell fallback: the generated execution
 * graph mounted the exact selected source/export as a separate sibling after the authentic page.
 */
function hasPreviewInspectorDetachedTargetBoundaryOutput(boundary, state) {
  const descriptor = typeof findSelectedPreviewInspectorDescriptor === 'function'
    ? findSelectedPreviewInspectorDescriptor()
    : undefined;
  const candidates = descriptor?.inspector?.pageCandidates;
  const candidate = Array.isArray(candidates)
    ? candidates.find((item) => item?.id === state.candidateId)
    : undefined;
  const placement = state.detachedTargetPlacement ?? candidate?.detachedTargetPlacement;
  if (!['deferred-sibling', 'overlay-sibling'].includes(placement)) {
    return false;
  }
  if (typeof collectPreviewInspectorFiberElements !== 'function') return false;
  return collectPreviewInspectorFiberElements(boundary).some((node) =>
    node?.nodeType === 1 &&
    node.isConnected === true &&
    node.closest?.('[' + PREVIEW_INSPECTOR_UI_ATTRIBUTE + ']') === null
  );
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
  const inlineTargetDomOwnership = privatelyOwnedHosts.some((node) =>
    node?.nodeType === 1 && node.isConnected === true && mountNode?.contains?.(node) === true,
  );
  const targetPortalOwnership = typeof collectPreviewInspectorFiberElements === 'function' &&
    collectPreviewInspectorFiberElements(boundary).some((node) =>
      node?.nodeType === 1 &&
      node.isConnected === true &&
      mountNode?.contains?.(node) !== true &&
      document.documentElement?.contains?.(node) === true &&
      node.closest?.('[' + PREVIEW_INSPECTOR_UI_ATTRIBUTE + ']') === null,
    );
  const targetDomOwnership = inlineTargetDomOwnership || targetPortalOwnership;
  if (expected.hasIntentionalEmpty || expected.hasIntentionalNavigation) {
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
  const projectedCompatibilityOutput = hasPreviewInspectorAuthenticProjectedTargetOutput(
    boundary,
    expected,
    state.targetExportName,
  );
  const authenticExpectedOutput = hasPreviewInspectorAuthenticExpectedTargetOutput(
    boundary,
    expected,
  );
  const directTargetElementOutput = hasPreviewInspectorDirectTargetElementOutput(boundary);
  const detachedBoundaryOutput = hasPreviewInspectorDetachedTargetBoundaryOutput(boundary, state);
  state.targetProjectedCompatibilityOutput = projectedCompatibilityOutput;
  state.targetDirectElementOutput = directTargetElementOutput;
  state.targetDetachedBoundaryOutput = detachedBoundaryOutput;
  const hasAnyHostOutput =
    targetDomOwnership ||
    projectedCompatibilityOutput ||
    authenticExpectedOutput ||
    directTargetElementOutput ||
    detachedBoundaryOutput;
  if (hasAnyHostOutput) state.targetHasAnyHostOutput = true;
  const fallbackLikeOutput = hasPreviewInspectorFallbackLikeTargetOutput(
    liveNames,
    state.targetExportName,
    expected.deferredFallbackNames,
  );
  // An exact projected root/descendant already proves that the selected export executed one of its
  // authored JSX nodes. Requiring a second non-projected descendant would incorrectly reject files
  // whose entire shared UI layer is intentionally represented by compatibility hosts.
  let resolved =
    projectedCompatibilityOutput ||
    ((authenticExpectedOutput || directTargetElementOutput || detachedBoundaryOutput) &&
      !fallbackLikeOutput);
  if (expected.deferredNames.size > 0) {
    const hasIndependentOutput = [...expected.independentNames].some((name) => liveNames.has(name));
    const namedCallbackInvoked = [...expected.deferredNames]
      .filter((name) => name !== '#deferred-host-output')
      .some((name) => liveNames.has(name));
    const descendantCallbackInvoked = [...expected.deferredOutputNames]
      .some((name) => liveNames.has(name));
    const hostCallbackInvoked = expected.hasDeferredHostOutput && hasAnyHostOutput &&
      ![...expected.deferredFallbackNames].some((name) => liveNames.has(name));
    // Pending is a runtime claim, so static callback evidence becomes pending only after its nearest
    // receiver is visible in this exact selected-export boundary.
    const hasLiveDeferredReceiver = [...expected.deferredReceiverNames]
      .some((name) => liveNames.has(name));
    const callbackRequired =
      !hasIndependentOutput && !(detachedBoundaryOutput && directTargetElementOutput);
    const callbackInvoked = namedCallbackInvoked || descendantCallbackInvoked || hostCallbackInvoked;
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
  if (
    !targetDomOwnership &&
    !projectedCompatibilityOutput &&
    !authenticExpectedOutput &&
    !directTargetElementOutput &&
    !detachedBoundaryOutput
  ) {
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
hasPreviewInspectorResolvedTargetOutput.hasIntentionalNavigationOutput =
  hasPreviewInspectorIntentionalNavigationOutput;
return hasPreviewInspectorResolvedTargetOutput;
}
`;
}
