/** Owns source-admitted runtime gate selection; ranking never mutates page or traversal state. */

/** Generates query-local gate ranking and authored-state handoff for the composed runtime. */
export function createPreviewInspectorTargetGateSelectionRuntimeSource(): string {
  return String.raw`
/** Hashes bounded semantic identity fields without persisting source paths or discovery order. */
function hashPreviewInspectorTargetGateIdentity(parts) {
  const text = JSON.stringify(parts.map((part) =>
    typeof part === 'string' ? part.slice(0, 1_024) :
      typeof part === 'boolean' || Number.isFinite(part) ? part : ''));
  let hash = 2166136261;
  for (let index = 0; index < text.length; index += 1) {
    hash ^= text.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0).toString(16).padStart(8, '0');
}

/** Shares evidence only during one synchronous evaluation, never across commits or model updates. */
function createPreviewInspectorTargetGateSearch(descriptor, candidate, state) {
  initializePreviewInspectorConditionState();
  return {
    conditions: [...previewInspectorSession.renderConditions.values()],
    evidence: readPreviewInspectorTargetPathEvidence(descriptor, candidate, state),
    scope: hashPreviewInspectorTargetGateIdentity([
      normalizePreviewInspectorReachabilityPath(state.targetSourcePath), state.targetExportName,
      normalizePreviewInspectorReachabilityPath(candidate?.root?.sourcePath), state.rootName,
      String(candidate?.routeLocation?.pattern ?? candidate?.routeLocation?.pathname ?? '').split(/[?#]/u)[0],
      ...(candidate?.targetPageTabKeys ?? []).slice(0, 8),
    ]),
  };
}

/** Rejects unrelated, satisfied, manual, and unsafe gates before any model work. */
function readPreviewInspectorAdmittedTargetGate(condition, state, evidence, exactTargetOnly) {
  if (
    condition?.reachabilityKey !== state.key || condition?.requiresAuthoredState === true ||
    previewInspectorSession.renderConditionOverrides.has(condition.id) ||
    (typeof isPreviewInspectorRenderConditionControlledByOutcome === 'function' &&
      isPreviewInspectorRenderConditionControlledByOutcome(condition)) ||
    (typeof isPreviewInspectorTargetGuidedConditionRejected === 'function' &&
      isPreviewInspectorTargetGuidedConditionRejected(condition.id, state.key)) ||
    !isPreviewInspectorConditionOnTargetPath(condition, evidence)
  ) return undefined;
  const sourcePath = normalizePreviewInspectorReachabilityPath(condition.sourcePath);
  const exactMountedTargetOverlayLocal = exactTargetOnly && condition.kind === 'overlay-visibility' &&
    condition.role === 'overlay' && sourcePath.length > 0 &&
    sourcePath === normalizePreviewInspectorReachabilityPath(state.targetSourcePath);
  const exactOverlayTargetLocal = isPreviewInspectorExactTargetOverlayCondition(condition, evidence);
  const exactTargetLocal = evidence.exactConditionIds?.has(condition.id) === true ||
    (evidence.exactTargetNames?.has(condition.ownerName) === true &&
      !evidence.ambiguousNames?.has(condition.ownerName)) ||
    (evidence.pathScores?.get(sourcePath) ?? 0) >= 800 || exactMountedTargetOverlayLocal;
  if (exactTargetOnly && !exactTargetLocal) return undefined;
  // Same-file sibling overlays still require their exact owner, except for the mounted-target probe.
  if (condition.role === 'overlay' && !exactOverlayTargetLocal && !exactMountedTargetOverlayLocal) {
    return undefined;
  }
  const desiredValue = exactMountedTargetOverlayLocal || exactOverlayTargetLocal
    ? true : readPreviewInspectorTargetConditionValue(condition, evidence);
  if (typeof desiredValue !== 'boolean' || condition.effectiveEnabled === desiredValue ||
      (typeof canPreviewInspectorTargetGuideCondition === 'function' &&
        !canPreviewInspectorTargetGuideCondition(condition, desiredValue))) return undefined;
  // A sibling such as 'form && <InboundModal/>' beside the target only opens unrelated UI, even
  // when its owner (InboundTab) lies on the corridor; the target's own overlay needs no label.
  const ownOverlay = exactMountedTargetOverlayLocal || evidence.exactConditionIds?.has(condition.id) === true ||
    evidence.exactTargetNames?.has(condition.runtimeOwnerName ?? condition.ownerName) === true;
  if (!ownOverlay && !hasPreviewInspectorTargetBranchProof(condition, evidence, desiredValue)) {
    return undefined;
  }
  return { condition, desiredValue, exactMountedTargetOverlayLocal, exactOverlayTargetLocal,
    exactTargetLocal, pathLocal: true };
}

/** Attaches a source/direction identity so a verified failure survives discovery-order changes. */
function createPreviewInspectorTargetGateDecision(gate, search, createDecision) {
  const condition = gate.condition;
  const sourcePath = normalizePreviewInspectorReachabilityPath(condition.sourcePath);
  return createDecision({
    blockerKind: 'render-condition', holeKind: 'condition-activation-order',
    candidateId: 'target-gate:' + hashPreviewInspectorTargetGateIdentity([
      sourcePath, condition.runtimeOwnerName ?? condition.ownerName, condition.expression,
      condition.line, condition.column, gate.desiredValue,
      Number.isSafeInteger(condition.line) && Number.isSafeInteger(condition.column) ? '' : condition.id,
    ]),
    numbers: { exactTarget: Number(gate.exactTargetLocal), line: condition.line ?? 0 },
    texts: [condition.expression, condition.ownerName, sourcePath],
    tokens: [
      'corridor:' + search.scope,
      'desired:' + String(gate.desiredValue), 'authored:' + String(condition.authoredEnabled),
      'kind:' + String(condition.kind ?? 'condition'), 'role:' + String(condition.role ?? 'condition'),
      'target-branch:' + String(condition.targetBranch ?? 'unknown'),
      'exact-overlay:' + String(gate.exactOverlayTargetLocal),
      'exact-mounted-overlay:' + String(gate.exactMountedTargetOverlayLocal),
    ],
  });
}

/** Preserves deterministic source order when the cold model or a close score cannot distinguish gates. */
function comparePreviewInspectorTargetGateOrder(left, right) {
  return (left.reachabilityDiscoveryOrder ?? Number.MAX_SAFE_INTEGER) -
    (right.reachabilityDiscoveryOrder ?? Number.MAX_SAFE_INTEGER) ||
    (left.line ?? 0) - (right.line ?? 0);
}

/** True for a visibility value an owner passes to one target instance ('<SkuFormModal open={!!editing}>'). */
function isPreviewInspectorTargetInstanceOverlay(condition, state) {
  if (condition?.kind !== 'overlay-visibility' || condition.ownerName !== state?.targetExportName) return false;
  const targetPath = normalizePreviewInspectorReachabilityPath(state.targetSourcePath);
  return !(condition.role === 'overlay' && targetPath.length > 0 &&
    normalizePreviewInspectorReachabilityPath(condition.sourcePath) === targetPath);
}

/** Orders sibling instances by source position only; discovery order and model scores vary per run. */
function comparePreviewInspectorInstanceOverlaySource(left, right) {
  const leftPath = normalizePreviewInspectorReachabilityPath(left.sourcePath);
  const rightPath = normalizePreviewInspectorReachabilityPath(right.sourcePath);
  return (leftPath < rightPath ? -1 : leftPath > rightPath ? 1 : 0) ||
    (left.line ?? 0) - (right.line ?? 0) || (left.column ?? 0) - (right.column ?? 0);
}

/**
 * Redirects an instance overlay to its source-first admitted sibling, or returns undefined while a
 * sibling instance is already open, so target search and neural assistance open the same instance.
 */
function readPreviewInspectorSourceFirstInstanceOverlay(condition, state, evidence) {
  if (!isPreviewInspectorTargetInstanceOverlay(condition, state)) return condition;
  let first = condition;
  for (const sibling of previewInspectorSession.renderConditions?.values?.() ?? []) {
    if (sibling === condition || sibling?.reachabilityKey !== condition.reachabilityKey ||
        !isPreviewInspectorTargetInstanceOverlay(sibling, state)) continue;
    if (sibling.effectiveEnabled === true) return undefined;
    if (comparePreviewInspectorInstanceOverlaySource(sibling, first) < 0 &&
        readPreviewInspectorAdmittedTargetGate(sibling, state, evidence, false)?.desiredValue === true) {
      first = sibling;
    }
  }
  return first;
}

/** Selects one admitted gate in linear time; failures rank behind unfailed candidates in this corridor. */
function selectPreviewInspectorNextTargetGate(descriptor, candidate, state, exactTargetOnly = false, search) {
  search ??= createPreviewInspectorTargetGateSearch(descriptor, candidate, state);
  const collected = [];
  for (const condition of search.conditions) {
    const gate = readPreviewInspectorAdmittedTargetGate(condition, state, search.evidence, exactTargetOnly);
    if (gate !== undefined) collected.push(gate);
  }
  /*
   * An overlay inside the target module ('<Modal open={open}>' in SkuFormModal) is one condition
   * shared by every mounted instance, so forcing it opens the create and the edit modal together.
   * When an owner passes the visibility per instance ('<SkuFormModal open={!!editing}>'), open
   * one instance through that owner condition instead.
   */
  const targetPath = normalizePreviewInspectorReachabilityPath(state.targetSourcePath);
  const isTargetLocalOverlay = (gate) => gate.condition.role === 'overlay' && targetPath.length > 0 &&
    normalizePreviewInspectorReachabilityPath(gate.condition.sourcePath) === targetPath;
  const isInstanceOverlay = (gate) => isPreviewInspectorTargetInstanceOverlay(gate?.condition, state);
  // Two owners make the target name ambiguous, so the exact mounted-target pass never admits their
  // instance conditions; it yields to the general pass instead of opening the shared overlay.
  // An instance that is already open (authored or forced) keeps every sibling instance closed.
  const instanceOpen = search.conditions.some((condition) => condition?.reachabilityKey === state.key &&
    condition.effectiveEnabled === true && isPreviewInspectorTargetInstanceOverlay(condition, state));
  const hasInstanceOverlay = instanceOpen || collected.some(isInstanceOverlay) || (exactTargetOnly &&
    search.conditions.some((condition) => isPreviewInspectorTargetInstanceOverlay(condition, state) &&
      readPreviewInspectorAdmittedTargetGate(condition, state, search.evidence, false) !== undefined));
  // Only the source-first instance competes; a later one becomes eligible after it is rejected.
  const firstInstance = instanceOpen ? undefined : collected.filter(isInstanceOverlay)
    .sort((left, right) => comparePreviewInspectorInstanceOverlaySource(left.condition, right.condition))[0];
  const admitted = hasInstanceOverlay
    ? collected.filter((gate) => !isTargetLocalOverlay(gate) && (!isInstanceOverlay(gate) || gate === firstInstance))
    : collected;
  if (admitted.length === 0) return undefined;
  const batch = typeof createPreviewInspectorNeuralResidualRankingBatch === 'function'
    ? createPreviewInspectorNeuralResidualRankingBatch() : undefined;
  const createDecision = batch?.createDecision ??
    (typeof createPreviewInspectorNeuralResidualDecision === 'function'
      ? createPreviewInspectorNeuralResidualDecision : undefined);
  const compare = batch?.compareDecisions ??
    (typeof comparePreviewInspectorNeuralResidualDecisions === 'function'
      ? comparePreviewInspectorNeuralResidualDecisions : () => 0);
  let best;
  for (const gate of admitted) {
    gate.neuralResidualDecision = createDecision === undefined
      ? undefined : createPreviewInspectorTargetGateDecision(gate, search, createDecision);
    if (best === undefined || (
      Number(gate.neuralResidualDecision?.consecutiveFailures ?? 0) -
        Number(best.neuralResidualDecision?.consecutiveFailures ?? 0) ||
      compare(gate.neuralResidualDecision, best.neuralResidualDecision) ||
      comparePreviewInspectorTargetGateOrder(gate.condition, best.condition)
    ) < 0) best = gate;
  }
  return best;
}

/** Returns the first source-owned gate requiring authored state, without evaluating or activating controls. */
function readPreviewInspectorPendingAuthoredStateGate(descriptor, candidate, state, search) {
  search ??= createPreviewInspectorTargetGateSearch(descriptor, candidate, state);
  let best;
  for (const condition of search.conditions) {
    if (
      condition === undefined || condition.reachabilityKey !== state.key ||
      previewInspectorSession.renderConditionOverrides.has(condition.id) ||
      !isPreviewInspectorConditionOnTargetPath(condition, search.evidence)
    ) continue;
    const desiredValue = readPreviewInspectorTargetConditionValue(condition, search.evidence);
    if (typeof desiredValue !== 'boolean' || condition.effectiveEnabled === desiredValue) continue;
    const canGuide = typeof canPreviewInspectorTargetGuideCondition !== 'function'
      ? condition.requiresAuthoredState !== true
      : canPreviewInspectorTargetGuideCondition(condition, desiredValue);
    if (condition.requiresAuthoredState !== true && canGuide === true) continue;
    if (!hasPreviewInspectorTargetBranchProof(condition, search.evidence, desiredValue)) continue;
    if (best === undefined || comparePreviewInspectorTargetGateOrder(condition, best) < 0) best = condition;
  }
  return best;
}

/**
 * Returns a filter admitting only conditions whose preferred branch is proven to lead to their
 * target, computing the path evidence once per reachability state for the whole pass.
 */
function createPreviewInspectorConditionProofFilter() {
  const evidenceByKey = new Map();
  return (condition) => {
    const state = previewInspectorSession.targetReachabilityByKey?.get?.(condition?.reachabilityKey);
    if (state === undefined || typeof findSelectedPreviewInspectorDescriptor !== 'function') return true;
    if (!evidenceByKey.has(state.key)) {
      let evidence;
      try {
        const descriptor = findSelectedPreviewInspectorDescriptor();
        evidence = readPreviewInspectorTargetPathEvidence(
          descriptor, readSelectedPreviewInspectorPageCandidate(descriptor), state);
      } catch {}
      evidenceByKey.set(state.key, evidence);
    }
    // A value a forced sibling fixes ('tab === "overview"' once members is forced) is no choice.
    if (typeof readPreviewInspectorScalarCoherentOverride === 'function' &&
      readPreviewInspectorScalarCoherentOverride(condition) !== undefined) return false;
    const evidence = evidenceByKey.get(state.key);
    if (evidence === undefined) return true;
    // The target's data branches ('atRiskDelta !== 0 && <Delta/>', 'cogs.hasCogs && …') show
    // what the data says; forcing them rendered "−0". Its own UI state ('tab === "members"') stays.
    if (condition.stateBound !== true && isPreviewInspectorTargetOwnedCondition(condition, evidence)) {
      return false;
    }
    const desiredValue = readPreviewInspectorTargetConditionValue(condition, evidence);
    return typeof desiredValue !== 'boolean' ||
      hasPreviewInspectorTargetBranchProof(condition, evidence, desiredValue);
  };
}

/** Reports a condition the target component or its own module owns. */
function isPreviewInspectorTargetOwnedCondition(condition, evidence) {
  return evidence.exactTargetNames?.has(condition.runtimeOwnerName ?? condition.ownerName) === true ||
    (evidence.pathScores?.get(normalizePreviewInspectorReachabilityPath(condition.sourcePath)) ?? 0) >= 800;
}

/**
 * Waiting for authored state halts the whole traversal, so it needs evidence that the branch leads
 * to the target. A '&&' guard is preferred truthy by default, but a notice box beside the target
 * ('focusSku && <div>…</div>' above an inbound table) proves nothing: data filling continues instead.
 */
function hasPreviewInspectorTargetBranchProof(condition, evidence, desiredValue) {
  // The target's own branches ('promoWeeks?.has(week) && <span>') are its content, not siblings.
  if (isPreviewInspectorTargetOwnedCondition(condition, evidence)) return true;
  if (
    condition.targetBranchEvidence === 'selected-target' ||
    condition.targetBranch === 'truthy' || condition.targetBranch === 'falsy' ||
    condition.fallbackBranch === 'truthy' || condition.fallbackBranch === 'falsy' ||
    condition.requiresAuthoredState === true
  ) return true;
  if (typeof readPreviewInspectorTargetConditionLabelEvidence !== 'function') return true;
  const labelText = desiredValue ? condition.truthyLabel : condition.falsyLabel;
  const label = readPreviewInspectorTargetConditionLabelEvidence(labelText, evidence);
  if (label.exactTarget === true || label.score > 0 || label.componentScore > 0) return true;
  // A corridor component rendered twice (create and edit modal) is ambiguous for choosing an
  // instance, yet a branch naming it still leads toward the target ('modalOpen && <FormModal/>').
  const corridor = evidence.corridorOwnerNames;
  return corridor instanceof Set && String(labelText ?? '').replace(/[<>]/gu, ' ')
    .split(/[^A-Za-z0-9_$]+/u).some((name) => name.length > 0 && corridor.has(name));
}
`;
}
