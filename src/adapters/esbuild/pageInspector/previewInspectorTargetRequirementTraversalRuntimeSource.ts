/** Owns admitted requirement traversal, bounded settling, and explicit diagnostic fallback actions. */

/** Generates browser helpers composed into the existing target reachability runtime. */
export function createPreviewInspectorTargetRequirementTraversalRuntimeSource(): string {
  return String.raw`
/**
 * Finds only compiler-shaped values whose continuation has one generated answer. Root-only custom
 * hooks stay interactive unless the compiler also proved one exact target-visible scalar.
 */
function readPreviewInspectorDeterministicRequirementEvidence(descriptor, candidate, state) {
  const preferNeural = typeof readPreviewInspectorNeuralLearningModelUpdates === 'function' &&
    readPreviewInspectorNeuralLearningModelUpdates() > 0;
  const batch = readPreviewInspectorRequirementBatch(
    descriptor,
    candidate,
    state,
    true,
    { preferNeural },
  );
  const admittedHookIds = new Set(batch.hookIds);
  const admittedRequestIds = new Set(batch.requestIds);
  const hookIds = readPreviewInspectorRuntimeFallbacks()
    .filter((record) =>
      admittedHookIds.has(record.id) &&
      record.reachabilityKey === state.key &&
      record.mode === 'auto' &&
      hasPreviewInspectorMaterializableHookRequirement(record),
    )
    .map((record) => record.id)
    .slice(0, 24);
  const requestIds = readPreviewInspectorDataRequests()
    .filter((record) =>
      admittedRequestIds.has(record.id) &&
      record.reachabilityKey === state.key &&
      // GraphQL selections and declared (or compiler-inferred) REST response types both prove one
      // minimum static shape; an endpoint-name guess does not.
      (record.kind === 'graphql' ||
        (typeof isPreviewInspectorDeclaredRestRequest === 'function' &&
          isPreviewInspectorDeclaredRestRequest(record))) &&
      (record.mode === 'auto' || hasPreviewInspectorStaleSmartDataRequirement(record)) &&
      readPreviewInspectorDataShapePaths(record.shape).length > 0,
    )
    .map((record) => record.id)
    .slice(0, 24);
  const narrowed = { hookIds, requestIds };
  return batch.neuralResidualDecision === undefined ||
    (hookIds.length === 0 && requestIds.length === 0)
    ? narrowed
    : { ...narrowed, neuralResidualDecision: batch.neuralResidualDecision };
}

/**
 * Reports whether the mounted empty target owns one exact Smart scalar in the next frontier.
 *
 * A coherent hook discriminator is stronger than independently forcing the target's early-return
 * and child JSX conditions: the same memoized Context value also updates page-shell layout flags.
 * Source/owner equality keeps this priority unavailable to sibling hooks elsewhere on the page.
 */
function hasPreviewInspectorExactTargetSmartRequirement(descriptor, candidate, state) {
  const evidence = readPreviewInspectorDeterministicRequirementEvidence(
    descriptor,
    candidate,
    state,
  );
  const admittedIds = new Set(evidence.hookIds);
  const targetSourcePath = normalizePreviewInspectorReachabilityPath(state.targetSourcePath);
  return readPreviewInspectorRuntimeFallbacks().some((record) => {
    if (
      !admittedIds.has(record.id) ||
      !Array.isArray(record.smartPathValues) ||
      record.smartPathValues.length === 0
    ) return false;
    const sourcePath = normalizePreviewInspectorReachabilityPath(record.sourcePath);
    return record.ownerName === state.targetExportName ||
      (targetSourcePath.length > 0 && sourcePath === targetSourcePath);
  });
}
/** Applies one newly observed hook/API batch and remounts only when that batch changed values. */
function advancePreviewInspectorMinimumRequirementSearch(descriptor, candidate, state) {
  const search = readPreviewInspectorMinimumRequirementSearch(state);
  if (
    search === undefined ||
    search.status !== 'searching' ||
    search.pass >= PREVIEW_INSPECTOR_MINIMUM_REQUIREMENT_PASS_LIMIT
  ) {
    return false;
  }
  const preserveUserValues = search.origin !== 'user';
  const batch = search.origin === 'deterministic-auto'
    ? readPreviewInspectorDeterministicRequirementEvidence(descriptor, candidate, state)
    : readPreviewInspectorRequirementBatch(
        descriptor,
        candidate,
        state,
        preserveUserValues,
        {
          excludedCandidateIds: search.excludedCandidateIds,
          explorationMode: search.explorationMode,
          explorationOrdinal: search.explorationOrdinal,
          preferNeural: search.origin === 'user-neural' ||
            search.origin === 'automatic-neural',
        },
      );
  search.observedPathCount = readPreviewInspectorTargetReachabilityRequiredPaths(state).length;
  const frontier = beginPreviewInspectorRequirementFrontier(state, search, batch);
  if (frontier === undefined) return state.exhausted === true;
  const rollbackSnapshot = capturePreviewInspectorRequirementAutoRollback(state, batch);
  const runtimeChanged = smartFillPreviewInspectorRuntimeFallbacksForReachability(
    state.key,
    {
      changeLimit: PREVIEW_INSPECTOR_REQUIREMENT_HOOK_BATCH_LIMIT,
      preserveUserValues,
      recordIds: batch.hookIds,
    },
  );
  const dataChanged = smartFillPreviewInspectorDataPayloadsForReachability(
    state.key,
    {
      applicationPath: state.applicationPath,
      changeLimit: PREVIEW_INSPECTOR_REQUIREMENT_DATA_BATCH_LIMIT,
      preserveUserValues,
      recordIds: batch.requestIds,
    },
  );
  const neuralDataFlowEntry = batch.hookIds
    .map((id) => ({
      decision: previewInspectorSession.runtimeFallbackNeuralDecisions?.get?.(id),
      signal: previewInspectorSession.runtimeFallbackDataFlowSignals?.get?.(id),
    }))
    .find((entry) => entry.decision !== undefined && entry.signal !== undefined);
  if (!runtimeChanged && !dataChanged) {
    completePreviewInspectorRequirementFrontier(search, frontier, false, state);
    return false;
  }
  let traceId;
  if (typeof recordPreviewInspectorBlockerAutoDecision === 'function') {
    const hookIdSet = new Set(batch.hookIds);
    const requestIdSet = new Set(batch.requestIds);
    const hookValues = readPreviewInspectorRuntimeFallbacks()
      .filter((record) => record.reachabilityKey === state.key && hookIdSet.has(record.id))
      .map((record) => ({
        id: record.id,
        requiredPaths: record.requiredPaths,
        value: createPreviewInspectorRuntimeFallbackSmartDraftTemplate(
          previewInspectorSession.runtimeFallbackValues.get(record.id),
          record.requiredPaths,
        ),
      }));
    const backendPayloads = [...previewInspectorSession.dataRequests.values()]
      .filter((record) => record.reachabilityKey === state.key && requestIdSet.has(record.id))
      .map((record) => {
        const override = previewInspectorSession.dataPayloadOverrides.get(record.id);
        return {
          id: record.id,
          mode: override?.mode ?? 'smart',
          payload: override?.payload ?? generatePreviewInspectorDataValue(record.shape, '', 'smart'),
        };
      });
    const sourceGate = state.appliedConditions?.at(-1);
    traceId = recordPreviewInspectorBlockerAutoDecision({
      action: search.origin === 'deterministic-auto'
        ? 'Auto-fill deterministic page-path requirements'
        : 'Fill newly discovered page-path requirements',
      blockerId: 'target-reachability:' + state.key,
      blockerKind: 'target-reachability',
      blockerName: 'Target not reached · ' + state.targetExportName,
      generatedPaths: readPreviewInspectorRequirementBatchPaths(batch),
      line: sourceGate?.line,
      mode: search.origin === 'deterministic-auto'
        ? 'deterministic-minimum-auto'
        : 'minimum-requirement-dfs',
      neuralResidualDecision:
        neuralDataFlowEntry?.decision ?? batch.neuralResidualDecision,
      neuralDataFlowSignal: neuralDataFlowEntry?.signal,
      ownerName: sourceGate?.ownerName ?? state.rootName,
      reason: 'Downstream hook and backend reads were discovered during the previous DFS pass',
      selectedValue: { backendPayloads, hookValues, nextPass: search.pass + 1 },
      sourcePath: sourceGate?.sourcePath,
      startsRenderAttempt: true,
      summary: {
        applicationPath: state.applicationPath,
        neuralResidual:
          typeof summarizePreviewInspectorNeuralResidualDecision === 'function'
            ? summarizePreviewInspectorNeuralResidualDecision(batch.neuralResidualDecision)
            : undefined,
      },
    });
  }
  if (runtimeChanged || dataChanged) {
    if (rollbackSnapshot !== undefined) {
      rollbackSnapshot.mode = search.origin === 'deterministic-auto'
        ? 'deterministic-minimum-auto'
        : 'minimum-requirement-dfs';
    }
    registerPreviewInspectorRequirementAutoRollback(traceId, rollbackSnapshot);
  }
  completePreviewInspectorRequirementFrontier(search, frontier, true, state);
  search.observedPathCount = readPreviewInspectorTargetReachabilityRequiredPaths(state).length;
  state.exhausted = false;
  state.idlePasses = 0;
  state.status = 'filling-requirements';
  state.probeRevision += 1;
  previewInspectorSession.fallbackValuesEnabled = true;
  previewInspectorSession.dataAutoEnabled = true;
  if (dataChanged) previewInspectorSession.dataRevision += 1;
  previewInspectorSession.renderConditionRevision =
    (previewInspectorSession.renderConditionRevision ?? 0) + 1;
  persistPreviewInspectorState();
  notifyPreviewInspector();
  schedulePreviewInspectorTreeRefresh();
  schedulePreviewInspectorCommitRefresh();
  return true;
}
/**
 * Starts minimum-shape convergence without a prompt when every admitted input is compiler-proven.
 * The pass is still bounded and records its origin so user JSON remains immutable in the background.
 */
function startPreviewInspectorDeterministicRequirementSearch(descriptor, candidate, state) {
  const current = readPreviewInspectorMinimumRequirementSearch(state);
  if (current?.status === 'searching') return false;
  const evidence = readPreviewInspectorDeterministicRequirementEvidence(
    descriptor,
    candidate,
    state,
  );
  if (evidence.hookIds.length === 0 && evidence.requestIds.length === 0) return false;
  if (!canStartPreviewInspectorDeterministicRequirementSearch(state, evidence)) return false;
  const convergence = readPreviewInspectorRequirementConvergence(state);
  const search = current?.origin === 'deterministic-auto' ? current : {};
  Object.assign(search, {
    observedPathCount: readPreviewInspectorTargetReachabilityRequiredPaths(state).length,
    origin: 'deterministic-auto',
    pass: convergence.totalPasses,
    status: 'searching',
    totalPasses: convergence.totalPasses,
  });
  delete search.cycleLength;
  previewInspectorSession.minimumRequirementSearchByKey.set(state.key, search);
  if (typeof recordPreviewInspectorBlockerAutoDecision === 'function') {
    recordPreviewInspectorBlockerAutoDecision({
      action: 'Start deterministic minimum page-path search',
      blockerId: 'target-reachability:' + state.key,
      blockerKind: 'target-reachability',
      blockerName: 'Target not reached · ' + state.targetExportName,
      generatedPaths: readPreviewInspectorRequirementBatchPaths(evidence),
      mode: 'deterministic-minimum-auto',
      ownerName: state.appliedConditions?.at(-1)?.ownerName ?? state.rootName,
      reason: 'Compiler-required hook paths or GraphQL selections admit one minimum static shape',
      selectedValue: evidence,
      sourcePath: state.appliedConditions?.at(-1)?.sourcePath,
      summary: { applicationPath: state.applicationPath },
    });
  }
  state.exhausted = false;
  state.idlePasses = 0;
  state.status = 'searching-deterministic-requirements';
  if (advancePreviewInspectorMinimumRequirementSearch(descriptor, candidate, state)) return true;
  settlePreviewInspectorMinimumRequirementSearch(state);
  return false;
}
/** Emits one warning when bounded static traversal cannot prove another page-local continuation. */
function reportPreviewInspectorPageCorridorBlocked(state) {
  if (state.blockedWarningReported === true) return;
  state.blockedWarningReported = true;
  const missingPageContext = state.pageExecutionContextObservation?.contextComplete === false;
  const message = missingPageContext
    ? 'Component output rendered, but its full page context could not be restored.'
    : 'Page context rendered, but did not reach ' + state.targetExportName + '.';
  const details = [
    message,
    'Page root: ' + state.rootName,
    'Path: ' + state.applicationPath.join(' > '),
    ...(missingPageContext
      ? [state.pageExecutionContextObservation.pageCandidateComplete === false
          ? 'The selected caller path is only a partial checkpoint (' +
            String(state.pageExecutionContextObservation.pageCandidateStopReason ?? 'unknown') + ').'
          : 'Missing live page owners: ' +
            (state.pageExecutionContextObservation.missingOwnerNames?.join(' > ') || 'unknown')]
      : []),
    state.appliedConditions.length > 0
      ? 'Auto-passed gates: ' + state.appliedConditions.map((gate) => gate.expression).join(', ')
      : 'No additional statically proven gate was available.',
    missingPageContext
      ? state.pageExecutionContextObservation.pageCandidateComplete === false
        ? 'The component repair recipe was retained and the next complete page candidate will receive it.'
        : 'The component repair recipe was retained, but every compiler-proven full-page execution path was exhausted.'
      : 'The page remains mounted. Resolve its next blocker or choose target-only diagnostic mode explicitly.',
  ].join('\n');
  recordPreviewInspectorConsoleEntry({
    details,
    level: 'warn',
    location: '',
    message,
    phase: 'page render corridor',
    source: 'target-reachability',
  });
  readPreviewInspectorConsolePrimitives().warn('[React Preview] ' + details);
}
/** Emits one visible warning when the user explicitly leaves authored page context. */
function reportPreviewInspectorTargetReachabilityFallback(state) {
  if (state.warningReported === true) return;
  state.warningReported = true;
  const message = 'Application path rendered, but did not reach ' + state.targetExportName + '.';
  const details = [
    message,
    'Path: ' + state.applicationPath.join(' > '),
    state.appliedConditions.length > 0
      ? 'Auto-passed gates: ' + state.appliedConditions.map((gate) => gate.expression).join(', ')
      : 'No additional statically proven gate was available.',
    'Show file by itself preserves preview providers and data, but it is not the real page layout.',
  ].join('\n');
  recordPreviewInspectorConsoleEntry({
    details,
    level: 'warn',
    location: '',
    message,
    phase: 'target-guided application path',
    source: 'target-reachability',
  });
  readPreviewInspectorConsolePrimitives().warn('[React Preview] ' + details);
}
/** Switches to target-only diagnostic mode only after an explicit user action. */
function activatePreviewInspectorDirectTarget(state) {
  if (state.directTargetAvailable !== true) {
    state.exhausted = true;
    state.status = 'blocked';
    state.probeRevision += 1;
    notifyPreviewInspector();
    schedulePreviewInspectorTreeRefresh();
    return;
  }
  previewInspectorSession.minimumRequirementSearchByKey?.delete(state.key);
  state.directTarget = true;
  state.pageRootCommitted = false;
  state.status = 'target-only';
  state.probeRevision += 1;
  reportPreviewInspectorTargetReachabilityFallback(state);
  notifyPreviewInspector();
  schedulePreviewInspectorTreeRefresh();
}

/**
 * Gives a newly selected render state one bounded effect/animation window before more DFS writes.
 * A drawer commonly commits at width zero and becomes visible on its next animation frame. Advancing
 * the requirement frontier during that transient frame can remount away an otherwise solved target.
 */
function settlePreviewInspectorNeuralRenderStateTarget(state) {
  const neuralRevision = previewInspectorSession.runtimeFallbackNeuralRevision ?? 0;
  if (
    state?.targetMounted !== true || state.targetHasOutput === true || neuralRevision <= 0 ||
    typeof hasPreviewInspectorNeuralRenderStateForSource !== 'function' ||
    !hasPreviewInspectorNeuralRenderStateForSource(state.targetSourcePath) ||
    state.neuralRenderStateSettledRevision === neuralRevision
  ) return false;
  if (
    state.neuralRenderStateSettlingRevision === neuralRevision &&
    state.neuralRenderStateSettleTimer !== undefined
  ) {
    state.status = 'settling-neural-render-state';
    return true;
  }
  if (state.neuralRenderStateSettleTimer !== undefined) {
    clearTimeout(state.neuralRenderStateSettleTimer);
  }
  state.neuralRenderStateSettlingRevision = neuralRevision;
  state.status = 'settling-neural-render-state';
  state.neuralRenderStateSettleTimer = setTimeout(() => {
    state.neuralRenderStateSettleTimer = undefined;
    if (
      previewInspectorSession.activeTargetReachabilityKey !== state.key ||
      state.neuralRenderStateSettlingRevision !== neuralRevision
    ) return;
    state.neuralRenderStateSettledRevision = neuralRevision;
    state.neuralRenderStateSettlingRevision = undefined;
    state.status = 'probing';
    state.probeRevision = Number.isSafeInteger(state.probeRevision)
      ? state.probeRevision + 1
      : 1;
    notifyPreviewInspector();
    schedulePreviewInspectorTreeRefresh();
    schedulePreviewInspectorCommitRefresh();
  }, PREVIEW_INSPECTOR_TARGET_NEURAL_RENDER_SETTLE_DELAY_MS);
  return true;
}
`;
}
