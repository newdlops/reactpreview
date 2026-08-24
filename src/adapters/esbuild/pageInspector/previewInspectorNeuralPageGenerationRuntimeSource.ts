/** Generates the model-driven bridge that executes safe viewer-owned page choices. */

/** Creates browser source for one-choice-per-render neural page generation. */
export function createPreviewInspectorNeuralPageGenerationRuntimeSource(): string {
  return String.raw`
let previewInspectorNeuralPageGenerationReading = false;
const PREVIEW_INSPECTOR_NEURAL_PAGE_GENERATION_FRONTIER_LIMIT = 96;

/** Returns whether a candidate already represents the effective preview-only state. */
function isPreviewInspectorNeuralPageGenerationCandidateCurrent(choice, candidate) {
  const mode = String(choice?.node?.blocker?.mode ?? '').toLowerCase();
  if (choice?.choiceKind === 'render-condition') {
    const condition = choice.node?.condition ?? choice.node?.blocker;
    return candidate?.actionKind === 'condition-override' &&
      candidate.value === condition?.effectiveEnabled;
  }
  if (choice?.choiceKind === 'runtime-fallback') {
    return candidate?.actionKind === 'runtime-smart'
      ? mode.startsWith('smart')
      : candidate?.actionKind === 'runtime-auto' && mode.startsWith('auto');
  }
  if (choice?.choiceKind === 'data-request') {
    return candidate?.actionKind === 'data-smart'
      ? mode.startsWith('smart')
      : candidate?.actionKind === 'data-auto'
        ? mode === 'auto'
        : candidate?.actionKind === 'data-lorem' && mode === 'lorem';
  }
  return candidate?.selected === true;
}

/** Rejects choices that would overwrite authored page state or explicit user values. */
function isPreviewInspectorNeuralPageGenerationChoiceSafe(choice) {
  const node = choice?.node;
  if (choice?.choiceKind === 'render-condition') {
    const condition = node?.condition ?? node?.blocker;
    return condition?.requiresAuthoredState !== true &&
      typeof condition?.override !== 'boolean' && typeof condition?.id === 'string';
  }
  if (choice?.choiceKind === 'runtime-fallback') {
    const fallbackId = node?.blocker?.id;
    return typeof fallbackId === 'string' &&
      previewInspectorSession.runtimeFallbackOverrides?.has?.(fallbackId) !== true &&
      !String(node?.blocker?.mode ?? '').toLowerCase().includes('manual');
  }
  if (choice?.choiceKind === 'data-request') {
    const requestId = node?.blocker?.id;
    const override = previewInspectorSession.dataPayloadOverrides?.get?.(requestId);
    return typeof requestId === 'string' &&
      !['custom', 'smart-custom'].includes(String(override?.mode ?? node?.blocker?.mode ?? ''));
  }
  return false;
}

/** Admits only reversible viewer strategies; real page controls and page-root choices stay manual. */
function readPreviewInspectorNeuralPageGenerationChoices() {
  if (
    previewInspectorNeuralPageGenerationReading ||
    typeof readPreviewInspectorNeuralUserChoices !== 'function'
  ) return Object.freeze([]);
  previewInspectorNeuralPageGenerationReading = true;
  let choices;
  try {
    choices = readPreviewInspectorNeuralUserChoices({
      explicitOnly: true,
      includePending: true,
    });
  } finally {
    previewInspectorNeuralPageGenerationReading = false;
  }
  const safeChoices = [];
  for (const choice of choices) {
    if (!isPreviewInspectorNeuralPageGenerationChoiceSafe(choice)) continue;
    const choiceRecords = [];
    for (const record of Array.isArray(choice?.choiceRecords) ? choice.choiceRecords : []) {
      const candidates = (Array.isArray(record?.candidates) ? record.candidates : []).flatMap(
        (candidate) => {
          if (candidate === null || typeof candidate !== 'object' || candidate.disabled === true) {
            return [];
          }
          const safeAction = choice.choiceKind === 'render-condition'
            ? candidate.actionKind === 'condition-override' &&
              (typeof canPreviewInspectorTargetGuideCondition !== 'function' ||
                canPreviewInspectorTargetGuideCondition(
                  choice.node?.condition ?? choice.node?.blocker,
                  candidate.value,
                ))
            : choice.choiceKind === 'runtime-fallback'
              ? ['runtime-smart', 'runtime-auto'].includes(candidate.actionKind)
              : ['data-smart', 'data-auto', 'data-lorem'].includes(candidate.actionKind);
          return safeAction
            ? [Object.freeze({
                ...candidate,
                selected: isPreviewInspectorNeuralPageGenerationCandidateCurrent(
                  choice,
                  candidate,
                ),
              })]
            : [];
        },
      );
      if (candidates.length > 0) {
        choiceRecords.push(Object.freeze({
          ...record,
          candidates: Object.freeze(candidates),
        }));
      }
    }
    if (choiceRecords.length === 0) continue;
    safeChoices.push(Object.freeze({
      ...choice,
      choiceRecords: Object.freeze(choiceRecords),
    }));
  }
  return Object.freeze(safeChoices);
}

/** Reports unresolved model-owned choices without constructing a mutation. */
function hasPreviewInspectorNeuralPageGenerationWork() {
  if (
    previewInspectorSession.neuralPageGenerationPending === true &&
    previewInspectorSession.neuralAssistanceRevision === previewEntryRevision
  ) return true;
  const choices = readPreviewInspectorNeuralPageGenerationChoices();
  const reachability = typeof readPreviewInspectorNeuralAssistanceReachability === 'function'
    ? readPreviewInspectorNeuralAssistanceReachability()
    : undefined;
  const key = reachability !== undefined &&
      typeof createPreviewInspectorAutomaticNeuralAssistanceKey === 'function'
    ? createPreviewInspectorAutomaticNeuralAssistanceKey(reachability)
    : undefined;
  const record = typeof key === 'string'
    ? previewInspectorSession.automaticNeuralAssistanceByKey?.get?.(key)
    : undefined;
  if (record === undefined) return choices.length > 0;
  return createPreviewInspectorNeuralPageGenerationPlan(record) !== undefined;
}

/** Gives availability, ranking, and retry accounting one current-state action identity. */
function createPreviewInspectorNeuralPageGenerationAttemptIdentity(
  selections,
) {
  return 'page-generation-combination:' + hashPreviewInspectorNeuralFiniteChoiceSignature(
    JSON.stringify(selections.map((item) => [
      item.step.choiceId,
      item.step.path,
      item.step.candidateId,
    ])),
  );
}

/** Resolves one graph step back to its current source-proven choice and candidate. */
function readPreviewInspectorNeuralPageGenerationStep(choices, step) {
  if (step?.current !== true || !Number.isInteger(step.candidateIndex)) return undefined;
  const preferredChoice = choices[step.choiceIndex];
  const choice = String(
    preferredChoice?.id ?? preferredChoice?.choiceKind ?? step.choiceIndex,
  ) === step.choiceId
    ? preferredChoice
    : choices.find((item, index) =>
        String(item?.id ?? item?.choiceKind ?? index) === step.choiceId);
  const record = choice?.choiceRecords?.find((item) => item?.path === step.path);
  const candidate = record?.candidates?.[step.candidateIndex];
  if (choice === undefined || record === undefined || candidate === undefined) return undefined;
  return { candidate, choice, record };
}

/** Restores the viewer-owned baseline before another independent combination is tested. */
function restorePreviewInspectorNeuralPageGenerationBaseline(baseline) {
  if (baseline === undefined) return false;
  if (typeof restorePreviewInspectorNeuralTemporalStateSnapshot === 'function') {
    restorePreviewInspectorNeuralTemporalStateSnapshot(baseline.temporalState);
  }
  if (typeof initializePreviewInspectorConditionState === 'function') {
    initializePreviewInspectorConditionState();
  }
  previewInspectorSession.renderConditionAutoAttempts?.clear?.();
  previewInspectorSession.renderConditionRejectedAutoOverridesByKey?.delete?.(
    previewInspectorSession.activeTargetReachabilityKey,
  );
  previewInspectorSession.renderConditionAutoOverrides = new Map(baseline.conditionEntries ?? []);
  if (previewInspectorSession.renderConditions instanceof Map) {
    for (const [conditionId, condition] of previewInspectorSession.renderConditions) {
      if (previewInspectorSession.renderConditionOverrides?.has?.(conditionId)) continue;
      previewInspectorSession.renderConditions.set(conditionId, {
        ...condition,
        effectiveEnabled: previewInspectorSession.renderConditionAutoOverrides.has(conditionId)
          ? previewInspectorSession.renderConditionAutoOverrides.get(conditionId)
          : condition.authoredEnabled,
      });
    }
  }
  if (typeof initializePreviewInspectorDataState === 'function') initializePreviewInspectorDataState();
  if (previewInspectorSession.dataPayloadOverrides instanceof Map) {
    const userData = [...previewInspectorSession.dataPayloadOverrides].filter(([, value]) =>
      ['custom', 'smart-custom'].includes(value?.mode),
    );
    previewInspectorSession.dataPayloadOverrides = new Map(userData);
    for (const [requestId, value] of baseline.dataPayloadEntries ?? []) {
      if (!previewInspectorSession.dataPayloadOverrides.has(requestId)) {
        previewInspectorSession.dataPayloadOverrides.set(
          requestId,
          copyPreviewInspectorNeuralSuccessValue(value),
        );
      }
    }
    previewInspectorSession.dataAutoEnabled = baseline.dataAutoEnabled !== false;
    previewInspectorSession.dataRevision = (Number(previewInspectorSession.dataRevision) || 0) + 1;
  }
  if (typeof initializePreviewInspectorRuntimeFallbackState === 'function') {
    initializePreviewInspectorRuntimeFallbackState();
  }
  if (previewInspectorSession.runtimeFallbackValues instanceof Map) {
    const isManual = (fallbackId) =>
      previewInspectorSession.runtimeFallbackOverrides?.has?.(fallbackId) === true;
    previewInspectorSession.runtimeFallbackValues = new Map(
      [...previewInspectorSession.runtimeFallbackValues].filter(([fallbackId]) =>
        isManual(fallbackId),
      ),
    );
    for (const [fallbackId, value] of baseline.runtimeFallbackValueEntries ?? []) {
      if (!isManual(fallbackId)) {
        const restoredValue = restorePreviewInspectorNeuralSuccessRuntimeFallbackValue(value);
        if (restoredValue === undefined) continue;
        previewInspectorSession.runtimeFallbackValues.set(
          fallbackId,
          restoredValue,
        );
      }
    }
    previewInspectorSession.runtimeFallbackSmartIds = new Set([
      ...[...(previewInspectorSession.runtimeFallbackSmartIds ?? [])].filter(isManual),
      ...(baseline.runtimeFallbackSmartIds ?? []).filter((fallbackId) => !isManual(fallbackId)),
    ]);
    previewInspectorSession.runtimeFallbackSmartPathSignatures = new Map([
      ...[...(previewInspectorSession.runtimeFallbackSmartPathSignatures ?? [])]
        .filter(([fallbackId]) => isManual(fallbackId)),
      ...(baseline.runtimeFallbackSmartPathEntries ?? [])
        .filter(([fallbackId]) => !isManual(fallbackId)),
    ]);
    previewInspectorSession.fallbackValuesEnabled = baseline.fallbackValuesEnabled !== false;
  }
  if (previewInspectorSession.resolverPropsByExport instanceof Map) {
    if (baseline.hasResolverProps) {
      previewInspectorSession.resolverPropsByExport.set(
        baseline.exportName,
        copyPreviewInspectorNeuralSuccessValue(baseline.resolverProps),
      );
    } else {
      previewInspectorSession.resolverPropsByExport.delete(baseline.exportName);
    }
  }
  previewInspectorSession.renderConditionRevision =
    (Number(previewInspectorSession.renderConditionRevision) || 0) + 1;
  const propsRevision = previewInspectorSession.propsRevisionByExport?.get?.(baseline.exportName) ?? 0;
  previewInspectorSession.propsRevisionByExport?.set?.(baseline.exportName, propsRevision + 1);
  return true;
}

/** Upgrades the record-owned combination frontier without retaining authored DOM nodes. */
function initializePreviewInspectorNeuralPageGenerationFrontier(record) {
  if (!Array.isArray(record.pageGenerationCombinationPlans)) {
    record.pageGenerationCombinationPlans = [];
  }
  if (!(record.pageGenerationCombinationStateIds instanceof Set)) {
    record.pageGenerationCombinationStateIds = new Set();
  }
  if (!(record.pageGenerationBaselineCombinationIds instanceof Set)) {
    record.pageGenerationBaselineCombinationIds = new Set();
  }
}

/** Captures every current Cartesian combination once, including the viewer baseline values. */
function collectPreviewInspectorNeuralPageGenerationPlans(record, choices, derivation) {
  initializePreviewInspectorNeuralPageGenerationFrontier(record);
  const stateId = derivation?.currentStateId;
  if (typeof stateId !== 'string' || record.pageGenerationCombinationStateIds.has(stateId)) return;
  if (record.pageGenerationBaseline === undefined &&
      typeof createPreviewInspectorNeuralSuccessSnapshot === 'function') {
    record.pageGenerationBaseline = createPreviewInspectorNeuralSuccessSnapshot({
      targetExportName: previewInspectorSession.selectedExportName,
    });
  }
  for (const [rank, path] of (Array.isArray(derivation?.paths) ? derivation.paths : []).entries()) {
    if (path?.blocked === true || path?.cyclic === true || path?.verified === true) continue;
    const steps = (Array.isArray(path?.steps) ? path.steps : [])
      .filter((item) => item?.current === true);
    const selections = steps.map((step) => ({
      resolved: readPreviewInspectorNeuralPageGenerationStep(choices, step),
      step,
    }));
    if (selections.length === 0 || selections.some((item) => item.resolved === undefined)) continue;
    const attemptIdentity = createPreviewInspectorNeuralPageGenerationAttemptIdentity(selections);
    const changedSelections = selections.filter((item) =>
      !isPreviewInspectorNeuralPageGenerationCandidateCurrent(
        item.resolved.choice,
        item.resolved.candidate,
      ));
    if (changedSelections.length === 0) {
      record.pageGenerationBaselineCombinationIds.add(attemptIdentity);
      continue;
    }
    if (
      record.pageGenerationBaselineCombinationIds.has(attemptIdentity) ||
      record.pageGenerationCombinationPlans.some((item) =>
        item.attemptIdentity === attemptIdentity,
      )
    ) continue;
    const first = selections[0].resolved;
    record.pageGenerationCombinationPlans.push(Object.freeze({
      attemptIdentity,
      attemptLimit: 1,
      baseline: record.pageGenerationBaseline,
      blockerIdentity: typeof readPreviewInspectorNeuralAssistanceBlockerIdentity === 'function'
        ? readPreviewInspectorNeuralAssistanceBlockerIdentity(first.choice.node)
        : undefined,
      blockerKind: first.choice.node?.blockerKind,
      candidateId: path.id,
      choiceCombination: true,
      decision: typeof createPreviewInspectorNeuralChoicePathDecision === 'function'
        ? createPreviewInspectorNeuralChoicePathDecision(path, stateId, rank)
        : undefined,
      mode: 'neural-page-choice-combination',
      ordinal: rank + 1,
      pageGenerationChoice: true,
      pathId: path.id,
      revision: previewEntryRevision,
      selections: Object.freeze(selections.map((item) => Object.freeze({
        candidate: item.resolved.candidate,
        candidateId: item.step.candidateId,
        candidateIndex: item.step.candidateIndex,
        choiceId: item.step.choiceId,
        choiceIndex: item.step.choiceIndex,
        current: isPreviewInspectorNeuralPageGenerationCandidateCurrent(
          item.resolved.choice,
          item.resolved.candidate,
        ),
        recordPath: item.step.path,
      }))),
      stateId,
    }));
    if (
      record.pageGenerationCombinationPlans.length >=
      PREVIEW_INSPECTOR_NEURAL_PAGE_GENERATION_FRONTIER_LIMIT
    ) break;
  }
  record.pageGenerationCombinationStateIds.add(stateId);
}

/** Selects the highest-ranked unseen complete combination from the retained bounded frontier. */
function createPreviewInspectorNeuralPageGenerationPlan(record) {
  const choices = readPreviewInspectorNeuralPageGenerationChoices();
  if (choices.length > 0 && typeof readPreviewInspectorNeuralDerivedChoicePaths === 'function') {
    const derivation = readPreviewInspectorNeuralDerivedChoicePaths(choices, {
      searchKind: 'automatic',
      singleChoice: false,
    });
    collectPreviewInspectorNeuralPageGenerationPlans(record, choices, derivation);
  }
  initializePreviewInspectorNeuralPageGenerationFrontier(record);
  return record.pageGenerationCombinationPlans.find((plan) =>
    plan.revision === previewEntryRevision &&
    (record?.attemptsByBlocker?.get?.(plan.attemptIdentity) ?? 0) < plan.attemptLimit,
  );
}

/** Applies one admitted reversible viewer action from a retained combination. */
function applyPreviewInspectorNeuralPageGenerationSelection(selection, decision) {
  const candidate = selection?.candidate;
  if (candidate === null || typeof candidate !== 'object') return false;
  if (selection.current === true) return true;
  if (
    candidate.actionKind === 'condition-override' &&
    typeof setPreviewInspectorTargetGuidedConditionOverride === 'function'
  ) {
    return setPreviewInspectorTargetGuidedConditionOverride(
      candidate.conditionId,
      candidate.value,
      decision,
    ) === true;
  }
  if (
    candidate.actionKind === 'runtime-smart' &&
    typeof smartFillPreviewInspectorRuntimeFallback === 'function'
  ) return smartFillPreviewInspectorRuntimeFallback(candidate.fallbackId) === true;
  if (
    candidate.actionKind === 'runtime-auto' &&
    typeof autoPassPreviewInspectorRuntimeFallback === 'function'
  ) return autoPassPreviewInspectorRuntimeFallback(candidate.fallbackId) !== false;
  if (
    candidate.actionKind === 'data-smart' &&
    typeof smartFillPreviewInspectorDataPayload === 'function'
  ) return smartFillPreviewInspectorDataPayload(candidate.requestId) === true;
  if (
    candidate.actionKind === 'data-auto' &&
    typeof resetPreviewInspectorDataPayload === 'function' &&
    typeof setPreviewInspectorDataAutoEnabled === 'function'
  ) {
    resetPreviewInspectorDataPayload(candidate.requestId);
    setPreviewInspectorDataAutoEnabled(true);
    return true;
  }
  if (
    candidate.actionKind === 'data-lorem' &&
    typeof generatePreviewInspectorLoremPayload === 'function'
  ) return generatePreviewInspectorLoremPayload(candidate.requestId) !== false;
  return false;
}

/** Applies one complete Cartesian viewer state and leaves its result to the delayed verifier. */
function applyPreviewInspectorNeuralPageGenerationPlan(plan) {
  if (
    plan?.pageGenerationChoice !== true || plan?.choiceCombination !== true ||
    plan.revision !== previewEntryRevision || !Array.isArray(plan.selections)
  ) return { action: 'neural-page-generation-unavailable', changed: false };
  if (typeof setPreviewInspectorNeuralActiveChoicePath === 'function') {
    setPreviewInspectorNeuralActiveChoicePath(plan.pathId);
  }
  restorePreviewInspectorNeuralPageGenerationBaseline(plan.baseline);
  const choices = readPreviewInspectorNeuralPageGenerationChoices();
  for (const [choiceIndex, choice] of choices.entries()) {
    const selected = plan.selections.flatMap((selection) => {
      if (String(choice?.id ?? choice?.choiceKind ?? choiceIndex) !== selection.choiceId) return [];
      const record = choice.choiceRecords?.find((item) => item?.path === selection.recordPath);
      const candidate = record?.candidates?.find((item, index) =>
        createPreviewInspectorNeuralChoicePathCandidateId(item, index) === selection.candidateId);
      return record !== undefined && candidate !== undefined
        ? [{ choiceRecord: record, selectedValue: candidate }]
        : [];
    });
    if (selected.length > 0) {
      recordPreviewInspectorNeuralChoicePathSelection(choice, selected, {
        choices,
        pathId: plan.pathId,
        searchKind: 'automatic',
      });
    }
  }
  const actionable = plan.selections.filter((selection) => selection.current !== true);
  const changed = actionable.length > 0 && actionable.every((selection) =>
    applyPreviewInspectorNeuralPageGenerationSelection(selection, plan.decision),
  );
  if (!changed && typeof cancelPreviewInspectorNeuralChoicePathSelection === 'function') {
    cancelPreviewInspectorNeuralChoicePathSelection('automatic');
  }
  return {
    action: 'neural-page-generation-combination',
    changed,
  };
}
`;
}
