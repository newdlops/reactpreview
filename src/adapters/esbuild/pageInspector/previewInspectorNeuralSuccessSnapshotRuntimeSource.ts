/** Generates reproducible viewer-state snapshots used by neural success verification. */
export function createPreviewInspectorNeuralSuccessSnapshotRuntimeSource(): string {
  return String.raw`
/** Copies only the renderer-safe value already admitted by preview prop normalization. */
function copyPreviewInspectorNeuralSuccessValue(value) {
  const copied = typeof copyPreviewInspectorBlockerValueForJson === 'function'
    ? copyPreviewInspectorBlockerValueForJson(value, { nodes: 0 })
    : value;
  if (copied === undefined) return undefined;
  /*
   * Snapshot values are not all component props. Runtime-hook roots may legitimately be Arrays or
   * scalars, while normalizePreviewInspectorProps intentionally accepts only plain prop objects.
   * Sending every successful viewer value through that object-only normalizer turns an exact
   * membership list into {}, so the next path restoration regresses into a type error.
   */
  try {
    return typeof globalThis.structuredClone === 'function'
      ? globalThis.structuredClone(copied)
      : copied;
  } catch { return copied; }
}
/** Restores JSON-safe hook snapshots to the inert runtime values expected by project code. */
function restorePreviewInspectorNeuralSuccessRuntimeFallbackValue(value) {
  const copied = copyPreviewInspectorNeuralSuccessValue(value);
  if (copied === undefined) return undefined;
  return typeof materializePreviewInspectorRuntimeFallbackOverride === 'function'
    ? materializePreviewInspectorRuntimeFallbackOverride(copied)
    : copied;
}
/** Serializes only checkpoint-safe values and rejects a snapshot that cannot be reproduced. */
function stringifyPreviewInspectorNeuralSuccessValue(value) {
  try { return JSON.stringify(value); } catch { return undefined; }
}
/** Copies a bounded keyed viewer-state map for exact success restoration. */
function copyPreviewInspectorNeuralSuccessEntries(map) {
  if (!(map instanceof Map)) return Object.freeze([]);
  return Object.freeze([...map]
    .filter(([id]) => typeof id === 'string' && id.length > 0)
    .sort(([left], [right]) => left.localeCompare(right))
    .slice(0, PREVIEW_INSPECTOR_NEURAL_SUCCESS_VALUE_LIMIT)
    .flatMap(([id, value]) => {
      const copied = copyPreviewInspectorNeuralSuccessValue(value);
      return copied === undefined ? [] : [Object.freeze([id, copied])];
    }));
}
/** Reads bounded blocker ids even when their current strategy intentionally has no override. */
function readPreviewInspectorNeuralSuccessIds(map) {
  return Object.freeze((map instanceof Map ? [...map.keys()] : [])
    .filter((id) => typeof id === 'string' && id.length > 0)
    .sort((left, right) => left.localeCompare(right))
    .slice(0, PREVIEW_INSPECTOR_NEURAL_SUCCESS_VALUE_LIMIT));
}
/** Captures the small mutable viewer state that can reproduce one verified target output. */
function createPreviewInspectorNeuralSuccessSnapshot(state) {
  const exportName = typeof state?.targetExportName === 'string'
    ? state.targetExportName
    : previewInspectorSession.selectedExportName;
  if (typeof exportName !== 'string' || exportName.length === 0) return undefined;
  if (typeof initializePreviewInspectorDataState === 'function') {
    initializePreviewInspectorDataState();
  }
  if (typeof initializePreviewInspectorRuntimeFallbackState === 'function') {
    initializePreviewInspectorRuntimeFallbackState();
  }
  const conditionEntries = previewInspectorSession.renderConditionAutoOverrides instanceof Map
    ? [...previewInspectorSession.renderConditionAutoOverrides]
        .filter(([id, value]) => typeof id === 'string' && typeof value === 'boolean')
        .sort(([left], [right]) => left.localeCompare(right))
    : [];
  const resolverMap = previewInspectorSession.resolverPropsByExport;
  const hasResolverProps = resolverMap instanceof Map && resolverMap.has(exportName);
  const resolverProps = hasResolverProps
    ? copyPreviewInspectorNeuralSuccessValue(resolverMap.get(exportName))
    : undefined;
  const resolverFingerprint = hasResolverProps &&
    typeof fingerprintPreviewInspectorSmartPropValue === 'function'
      ? fingerprintPreviewInspectorSmartPropValue(resolverProps)
      : resolverProps;
  const pageCandidateId = typeof previewInspectorSession.selectedPageCandidateId === 'string'
    ? previewInspectorSession.selectedPageCandidateId
    : '';
  const dataAutoEnabled = previewInspectorSession.dataAutoEnabled !== false;
  const dataRequestIds = readPreviewInspectorNeuralSuccessIds(
    previewInspectorSession.dataRequests,
  );
  const dataPayloadEntries = copyPreviewInspectorNeuralSuccessEntries(
    previewInspectorSession.dataPayloadOverrides,
  );
  const runtimeFallbackIds = readPreviewInspectorNeuralSuccessIds(
    previewInspectorSession.runtimeFallbacks,
  );
  const runtimeFallbackValueEntries = Object.freeze(
    copyPreviewInspectorNeuralSuccessEntries(
      previewInspectorSession.runtimeFallbackValues,
    ).filter(([id]) => runtimeFallbackIds.includes(id)),
  );
  const runtimeFallbackSmartIds = Object.freeze((
    previewInspectorSession.runtimeFallbackSmartIds instanceof Set
      ? [...previewInspectorSession.runtimeFallbackSmartIds]
      : []
  ).filter((id) => runtimeFallbackIds.includes(id)).sort());
  const runtimeFallbackSmartPathEntries = Object.freeze(
    copyPreviewInspectorNeuralSuccessEntries(
      previewInspectorSession.runtimeFallbackSmartPathSignatures,
    ).filter(([id]) => runtimeFallbackIds.includes(id)),
  );
  const fallbackValuesEnabled = previewInspectorSession.fallbackValuesEnabled !== false;
  const temporalState = typeof createPreviewInspectorNeuralTemporalStateSnapshot === 'function'
    ? createPreviewInspectorNeuralTemporalStateSnapshot(state)
    : undefined;
  const pageExecutionContext =
    typeof readPreviewInspectorNeuralSuccessPageExecutionContext === 'function'
      ? readPreviewInspectorNeuralSuccessPageExecutionContext(state)
      : undefined;
  const fingerprint = stringifyPreviewInspectorNeuralSuccessValue({
    conditionEntries,
    dataAutoEnabled,
    dataPayloadEntries,
    dataRequestIds,
    exportName,
    fallbackValuesEnabled,
    pageCandidateId,
    pageExecutionCandidateId: pageExecutionContext?.executionCandidateId,
    pageExecutionContextComplete: pageExecutionContext?.contextComplete,
    pageExecutionFidelity: pageExecutionContext?.fidelity,
    resolverProps: hasResolverProps ? resolverFingerprint : '[absent]',
    runtimeFallbackIds,
    runtimeFallbackSmartIds,
    runtimeFallbackSmartPathEntries,
    runtimeFallbackValueEntries,
    temporalStateFingerprint: temporalState?.fingerprint,
  });
  if (typeof fingerprint !== 'string') return undefined;
  const resolverSize = stringifyPreviewInspectorNeuralSuccessValue(resolverFingerprint ?? '')
    ?.length ?? 10_000;
  const viewerValueSize = stringifyPreviewInspectorNeuralSuccessValue({
    dataPayloadEntries,
    runtimeFallbackValueEntries,
  })?.length ?? 10_000;
  const score = (pageExecutionContext?.contextComplete === true ? 10_000_000 : 0) +
    (state?.targetDirectElementOutput === true ? 1_000_000 : 0) +
    (state?.targetOutputKind === 'target-output' ? 100_000 : 0) - conditionEntries.length * 10 -
    Math.min(10_000, resolverSize) - Math.min(10_000, viewerValueSize);
  return Object.freeze({
    choicePathId: typeof previewInspectorSession.neuralActiveChoicePathId === 'string'
      ? previewInspectorSession.neuralActiveChoicePathId
      : undefined,
    conditionEntries: Object.freeze(conditionEntries),
    dataAutoEnabled,
    dataPayloadEntries,
    dataRequestIds,
    exportName,
    fallbackValuesEnabled,
    fingerprint,
    hasResolverProps,
    observedAt: Date.now(),
    pageCandidateId,
    pageExecutionContext,
    resolverProps,
    runtimeFallbackIds,
    runtimeFallbackSmartIds,
    runtimeFallbackSmartPathEntries,
    runtimeFallbackValueEntries,
    score,
    temporalState,
  });
}
`;
}
