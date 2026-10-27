import { createPreviewInspectorNeuralRuntimeSnapshotValueSource } from './previewInspectorNeuralRuntimeSnapshotValueSource';

/** Generates reproducible viewer-state snapshots used by neural success verification. */
export function createPreviewInspectorNeuralSuccessSnapshotRuntimeSource(): string {
  return String.raw`
${createPreviewInspectorNeuralRuntimeSnapshotValueSource()}
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
/** Restores runtime checkpoints without flattening native leaves or generated callbacks. */
function restorePreviewInspectorNeuralSuccessRuntimeFallbackValue(value) {
  const copied = copyPreviewInspectorNeuralRuntimeSnapshotValue(value);
  if (copied === undefined) return undefined;
  return typeof materializePreviewInspectorRuntimeFallbackOverride === 'function'
    ? materializePreviewInspectorRuntimeFallbackOverride(copied)
    : copied;
}
/** Serializes only checkpoint-safe values and rejects a snapshot that cannot be reproduced. */
function stringifyPreviewInspectorNeuralSuccessValue(value) {
  try {
    return JSON.stringify(value, (_key, current) => {
      if (typeof current === 'function') return '[Preview no-op function]';
      if (current instanceof RegExp) {
        return { $previewRuntimeRegExp: readPreviewInspectorNeuralSnapshotRegExp(current) };
      }
      const element = readPreviewInspectorNeuralSnapshotElement(current);
      if (element !== undefined) return element;
      return current;
    });
  } catch { return undefined; }
}
/** Copies bounded viewer state, filtering to admitted controls before applying the value limit. */
function copyPreviewInspectorNeuralSuccessEntries(map, admittedIds, runtimeValues = false) {
  if (!(map instanceof Map)) return Object.freeze([]);
  let incomplete = false;
  const entries = [...map]
    .filter(([id]) => typeof id === 'string' && id.length > 0 &&
      (admittedIds === undefined || admittedIds.includes(id)))
    .sort(([left], [right]) => left.localeCompare(right))
    .slice(0, PREVIEW_INSPECTOR_NEURAL_SUCCESS_VALUE_LIMIT)
    .flatMap(([id, value]) => {
      const copied = runtimeValues
        ? copyPreviewInspectorNeuralRuntimeSnapshotValue(value)
        : copyPreviewInspectorNeuralSuccessValue(value);
      if (runtimeValues && copied === undefined && value !== undefined) incomplete = true;
      return copied === undefined ? [] : [Object.freeze([id, copied])];
    });
  return incomplete ? undefined : Object.freeze(entries);
}
/** Reads bounded blocker ids even when their current strategy intentionally has no override. */
function readPreviewInspectorNeuralSuccessIds(map) {
  return Object.freeze((map instanceof Map ? [...map.keys()] : [])
    .filter((id) => typeof id === 'string' && id.length > 0)
    .sort((left, right) => left.localeCompare(right))
    .slice(0, PREVIEW_INSPECTOR_NEURAL_SUCCESS_VALUE_LIMIT));
}
/**
 * Owns fallback controls, excluding passive observations with no restorable viewer state.
 * A real useContext wrapper may disappear after its caller changes without losing target output.
 * Observed values alone are not controls. Smart choices, signatures, and manual overrides still
 * require that exact id, including when the instrumented hook is otherwise passive.
 */
function readPreviewInspectorNeuralSuccessRuntimeFallbackIds() {
  const records = previewInspectorSession.runtimeFallbacks;
  if (!(records instanceof Map)) return Object.freeze([]);
  return Object.freeze([...records]
    .filter(([id, record]) => typeof id === 'string' && id.length > 0 && (
      record?.passive !== true ||
      previewInspectorSession.runtimeFallbackSmartIds?.has?.(id) === true ||
      previewInspectorSession.runtimeFallbackSmartPathSignatures?.has?.(id) === true ||
      previewInspectorSession.runtimeFallbackOverrides?.has?.(id) === true
    ))
    .map(([id]) => id)
    .sort((left, right) => left.localeCompare(right))
    .slice(0, PREVIEW_INSPECTOR_NEURAL_SUCCESS_VALUE_LIMIT));
}
/** Captures the small mutable viewer state that can reproduce one verified target output. */
function createPreviewInspectorNeuralSuccessSnapshot(state) {
  if (typeof hasPreviewInspectorNextAppControlBlocker === 'function' &&
    hasPreviewInspectorNextAppControlBlocker(state)) return undefined;
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
    ? copyPreviewInspectorNeuralRuntimeSnapshotValue(resolverMap.get(exportName))
    : undefined;
  if (hasResolverProps && resolverProps === undefined) return undefined;
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
  const runtimeFallbackIds = readPreviewInspectorNeuralSuccessRuntimeFallbackIds();
  const runtimeFallbackValueEntries = Object.freeze(
    copyPreviewInspectorNeuralSuccessEntries(
      previewInspectorSession.runtimeFallbackValues,
      runtimeFallbackIds,
      true,
    ),
  );
  if (runtimeFallbackValueEntries === undefined) return undefined;
  const runtimeFallbackSmartIds = Object.freeze((
    previewInspectorSession.runtimeFallbackSmartIds instanceof Set
      ? [...previewInspectorSession.runtimeFallbackSmartIds]
      : []
  ).filter((id) => runtimeFallbackIds.includes(id)).sort());
  const runtimeFallbackSmartPathEntries = Object.freeze(
    copyPreviewInspectorNeuralSuccessEntries(
      previewInspectorSession.runtimeFallbackSmartPathSignatures,
      runtimeFallbackIds,
    ),
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
  const tier = (pageExecutionContext?.contextComplete === true ? 10_000_000 : 0) +
    (state?.targetDirectElementOutput === true ? 1_000_000 : 0) +
    (state?.targetOutputKind === 'target-output' ? 100_000 : 0);
  const score = tier - conditionEntries.length * 10 -
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
    // Not fingerprinted: lets a later verification tell a new component's guard from a changed one.
    knownConditionIds: readPreviewInspectorNeuralSuccessIds(previewInspectorSession.renderConditions),
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
    tier,
  });
}

/** Reports that every id of a checkpoint list is still present. */
function containsPreviewInspectorNeuralSuccessIds(current, checkpoint) {
  return Array.isArray(current) && (checkpoint ?? []).every((id) => current.includes(id));
}

/** Keeps the entries of the given ids from a sorted [id, value] list. */
function readPreviewInspectorNeuralSuccessOwnedEntries(entries, ids) {
  return (entries ?? []).filter(([id]) => (ids ?? []).includes(id));
}

/**
 * Reports whether the current viewer state still reproduces one success checkpoint.
 *
 * Components that mount after the checkpoint (a delayed panel, a tab, or list rows) only add
 * requests, hooks, and choices of their own, which changed the exact fingerprint and made a stable
 * page read as a lost target. Every id the checkpoint owns must persist with an identical value, a
 * guard known at the checkpoint must keep its branch, and everything else must match exactly.
 */
function isPreviewInspectorNeuralSuccessSnapshotCompatible(current, checkpoint) {
  if (current === undefined || checkpoint === undefined) return false;
  if (current.fingerprint === checkpoint.fingerprint) return true;
  const same = (left, right) =>
    stringifyPreviewInspectorNeuralSuccessValue(left ?? null) ===
      stringifyPreviewInspectorNeuralSuccessValue(right ?? null);
  const execution = (snapshot) => [
    snapshot.pageExecutionContext?.executionCandidateId,
    snapshot.pageExecutionContext?.contextComplete,
    snapshot.pageExecutionContext?.fidelity,
  ];
  if (
    ['dataAutoEnabled', 'exportName', 'fallbackValuesEnabled', 'hasResolverProps', 'pageCandidateId']
      .some((key) => current[key] !== checkpoint[key]) ||
    !same(current.resolverProps, checkpoint.resolverProps) ||
    !same(execution(current), execution(checkpoint)) ||
    !containsPreviewInspectorNeuralSuccessIds(current.dataRequestIds, checkpoint.dataRequestIds) ||
    !containsPreviewInspectorNeuralSuccessIds(current.runtimeFallbackIds, checkpoint.runtimeFallbackIds)
  ) return false;
  const fallbackIds = checkpoint.runtimeFallbackIds ?? [];
  // Without the known-guard list (older checkpoints) no condition growth is accepted.
  const conditionIds = Array.isArray(checkpoint.knownConditionIds)
    ? checkpoint.knownConditionIds
    : (current.conditionEntries ?? []).map(([id]) => id);
  return same(
    readPreviewInspectorNeuralSuccessOwnedEntries(current.dataPayloadEntries, checkpoint.dataRequestIds),
    checkpoint.dataPayloadEntries,
  ) && same(
    readPreviewInspectorNeuralSuccessOwnedEntries(current.runtimeFallbackValueEntries, fallbackIds),
    checkpoint.runtimeFallbackValueEntries,
  ) && same(
    (current.runtimeFallbackSmartIds ?? []).filter((id) => fallbackIds.includes(id)),
    checkpoint.runtimeFallbackSmartIds,
  ) && same(
    readPreviewInspectorNeuralSuccessOwnedEntries(current.runtimeFallbackSmartPathEntries, fallbackIds),
    checkpoint.runtimeFallbackSmartPathEntries,
  ) && same(
    readPreviewInspectorNeuralSuccessOwnedEntries(current.conditionEntries, conditionIds),
    readPreviewInspectorNeuralSuccessOwnedEntries(checkpoint.conditionEntries, conditionIds),
  ) && (checkpoint.conditionEntries ?? []).every(([id]) => conditionIds.includes(id)) &&
    isPreviewInspectorNeuralTemporalStateCompatible(
      current.temporalState,
      checkpoint.temporalState,
      fallbackIds,
    );
}

/**
 * Compares the application-time part of a checkpoint with the same growth rule: owned hook and
 * loading-guard entries must match, and a terminal checkpoint may turn transient only through hooks
 * that mounted after it (their loading state, not the checkpoint's).
 */
function isPreviewInspectorNeuralTemporalStateCompatible(current, checkpoint, fallbackIds) {
  if (current === undefined || checkpoint === undefined) return current === checkpoint;
  if (current.fingerprint === checkpoint.fingerprint) return true;
  const same = (left, right) =>
    stringifyPreviewInspectorNeuralSuccessValue(left ?? null) ===
      stringifyPreviewInspectorNeuralSuccessValue(right ?? null);
  const conditionIds = (checkpoint.conditionEntries ?? []).map((entry) => entry.id);
  if (
    !same(current.applicationPath, checkpoint.applicationPath) ||
    current.pageCandidateId !== checkpoint.pageCandidateId ||
    current.targetExportName !== checkpoint.targetExportName ||
    !same(
      (current.runtimeStateEntries ?? []).filter((entry) => fallbackIds.includes(entry.fallbackId)),
      checkpoint.runtimeStateEntries,
    ) ||
    !same(
      (current.conditionEntries ?? []).filter((entry) => conditionIds.includes(entry.id)),
      checkpoint.conditionEntries,
    )
  ) return false;
  if (current.kind === checkpoint.kind) return true;
  const transientEntries = (current.runtimeStateEntries ?? []).filter((entry) => entry.transient);
  return checkpoint.kind === 'terminal-stable' &&
    transientEntries.length > 0 &&
    transientEntries.every((entry) => !fallbackIds.includes(entry.fallbackId));
}
`;
}
