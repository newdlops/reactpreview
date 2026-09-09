/**
 * Applies explicit and minimum-shape hook overrides without replacing unrelated authored values.
 * This adapter emits a lexical fragment composed by previewInspectorRuntimeFallbackRuntimeSource.
 * Session state and helper ownership remain in the same generated browser module.
 */

/** Returns the ordered browser fragment; no project code runs during source generation. */
export function createPreviewInspectorRuntimeFallbackOverridesRuntimeSource(): string {
  return String.raw`
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
}`;
}
