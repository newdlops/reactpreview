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

/** Selects one admitted gate in linear time; failures rank behind unfailed candidates in this corridor. */
function selectPreviewInspectorNextTargetGate(descriptor, candidate, state, exactTargetOnly = false, search) {
  search ??= createPreviewInspectorTargetGateSearch(descriptor, candidate, state);
  const admitted = [];
  for (const condition of search.conditions) {
    const gate = readPreviewInspectorAdmittedTargetGate(condition, state, search.evidence, exactTargetOnly);
    if (gate !== undefined) admitted.push(gate);
  }
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
    if (best === undefined || comparePreviewInspectorTargetGateOrder(condition, best) < 0) best = condition;
  }
  return best;
}
`;
}
