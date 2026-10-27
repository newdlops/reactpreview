import { createPreviewInspectorConditionEditingRuntimeSource } from './previewInspectorConditionEditingRuntimeSource';
import { createPreviewInspectorRenderChoiceRuntimeSource } from './previewInspectorRenderChoiceRuntimeSource';
import { createPreviewInspectorSourcePropChoiceRuntimeSource } from './previewInspectorSourcePropChoiceRuntimeSource';
/**
 * Generates the browser-side registry for authored JSX conditions and automatic fallback values.
 *
 * The registry lives in the pinned webview session, survives hot-module replacements, and exposes no
 * host privilege. Project modules may only resolve a compiler-issued condition identity; all editing
 * and persistence functions remain lexical to the extension-owned Inspector UI.
 */
import { createPreviewInspectorConditionDefinitionRuntimeSource } from './previewInspectorConditionDefinitionRuntimeSource';
import { createPreviewInspectorSynchronousContinuationRuntimeSource } from './previewInspectorSynchronousContinuationRuntimeSource';
import { createPreviewInspectorVirtualPageConditionRuntimeSource } from './previewInspectorVirtualPageConditionRuntimeSource';

/**
 * Creates condition/fallback state helpers concatenated into the Page Inspector entry.
 *
 * Expected lexical bindings include `previewInspectorSession`, state persistence/notification helpers,
 * and the coalesced tree/highlight scheduler declared by the surrounding runtime source.
 *
 * @returns Plain JavaScript source evaluated before dynamically imported project modules.
 */
export function createPreviewInspectorConditionRuntimeSource(): string {
  const synchronousContinuationRuntimeSource =
    createPreviewInspectorSynchronousContinuationRuntimeSource();
  const conditionDefinitionRuntimeSource = createPreviewInspectorConditionDefinitionRuntimeSource();
  const virtualPageConditionRuntimeSource =
    createPreviewInspectorVirtualPageConditionRuntimeSource();
  return String.raw`
${synchronousContinuationRuntimeSource}
${conditionDefinitionRuntimeSource}
${virtualPageConditionRuntimeSource}
const PREVIEW_INSPECTOR_RENDER_CONDITION_LIMIT = 512;
const PREVIEW_INSPECTOR_RENDER_CHOICE_BRANCH_LIMIT = 32;
const previewInspectorScheduleConditionMicrotask = typeof globalThis.queueMicrotask === 'function'
  ? globalThis.queueMicrotask.bind(globalThis)
  : (callback) => Promise.resolve().then(callback);

/** Lazily initializes persisted interactive condition state on both new and retained sessions. */
function initializePreviewInspectorConditionState() {
  if (!(previewInspectorSession.renderConditions instanceof Map)) {
    previewInspectorSession.renderConditions = new Map();
  }
  if (!(previewInspectorSession.renderChoices instanceof Map)) {
    previewInspectorSession.renderChoices = new Map();
  }
  if (!(previewInspectorSession.renderChoiceObservedValues instanceof Map)) {
    previewInspectorSession.renderChoiceObservedValues = new Map();
  }
  if (!(previewInspectorSession.renderConditionOverrides instanceof Map)) {
    const persisted = readPersistedPreviewInspectorState();
    const persistedOverrides = persisted.renderConditionOverrides;
    const entries = persistedOverrides !== null && typeof persistedOverrides === 'object'
      ? Object.entries(persistedOverrides).filter(
          ([conditionId, value]) =>
            typeof conditionId === 'string' &&
            conditionId.length > 0 &&
            conditionId.length <= 128 &&
            typeof value === 'boolean',
        )
      : [];
    previewInspectorSession.renderConditionOverrides = new Map(
      entries.slice(0, PREVIEW_INSPECTOR_RENDER_CONDITION_LIMIT),
    );
  }
  if (!(previewInspectorSession.renderChoiceOverrides instanceof Map)) {
    const persisted = readPersistedPreviewInspectorState();
    const persistedOverrides = persisted.renderChoiceOverrides;
    const entries = persistedOverrides !== null && typeof persistedOverrides === 'object'
      ? Object.entries(persistedOverrides).filter(
          ([choiceId, branchId]) =>
            typeof choiceId === 'string' &&
            choiceId.length > 0 &&
            choiceId.length <= 128 &&
            typeof branchId === 'string' &&
            branchId.length > 0 &&
            branchId.length <= 160,
        )
      : [];
    previewInspectorSession.renderChoiceOverrides = new Map(
      entries.slice(0, PREVIEW_INSPECTOR_RENDER_CONDITION_LIMIT),
    );
  }
  if (!(previewInspectorSession.renderConditionAutoOverrides instanceof Map)) {
    previewInspectorSession.renderConditionAutoOverrides = new Map();
  }
  if (!(previewInspectorSession.renderConditionAutoAttempts instanceof Map)) {
    previewInspectorSession.renderConditionAutoAttempts = new Map();
  }
  if (!(previewInspectorSession.renderConditionRejectedAutoOverridesByKey instanceof Map)) {
    previewInspectorSession.renderConditionRejectedAutoOverridesByKey = new Map();
  }
  if (!(previewInspectorSession.directTargetConditionIdsByExport instanceof Map)) {
    previewInspectorSession.directTargetConditionIdsByExport = new Map();
  }
  if (typeof previewInspectorSession.fallbackValuesEnabled !== 'boolean') {
    const persisted = readPersistedPreviewInspectorState();
    previewInspectorSession.fallbackValuesEnabled = persisted.fallbackValuesEnabled !== false;
  }
  if (!Number.isSafeInteger(previewInspectorSession.renderConditionRevision)) {
    previewInspectorSession.renderConditionRevision = 0;
  }
  if (!Number.isSafeInteger(previewInspectorSession.renderConditionDiscoverySequence)) {
    previewInspectorSession.renderConditionDiscoverySequence = 0;
  }
}

/** Persists lazy outcome/manual reconciliation after project render leaves the current call stack. */
function schedulePreviewInspectorRenderOutcomeReconciliationPersistence() {
  if (previewInspectorSession.renderOutcomeReconciliationScheduled === true) return;
  previewInspectorSession.renderOutcomeReconciliationScheduled = true;
  previewInspectorScheduleConditionMicrotask(() => {
    previewInspectorSession.renderOutcomeReconciliationScheduled = false;
    persistPreviewInspectorState();
  });
}

/**
 * Removes one exact manual decision when a selected whole-return outcome controls the same source.
 * The caller supplies an outcome value only after source path/line/column/expression matching, so an
 * inactive branch can reconcile safely when it registers for the first time after outcome selection.
 */
function reconcilePreviewInspectorManualOverrideWithOutcome(overrides, controlId, outcomeValue) {
  if (outcomeValue === undefined || !overrides.delete(controlId)) return false;
  schedulePreviewInspectorRenderOutcomeReconciliationPersistence();
  return true;
}

${createPreviewInspectorSourcePropChoiceRuntimeSource()}${createPreviewInspectorRenderChoiceRuntimeSource()}/** Reports whether two retained records differ in a way visible to the component tree UI. */
function didPreviewInspectorConditionChange(previous, next) {
  if (previous === undefined) return true;
  for (const name of [
    'authoredExpression',
    'authoredExpressionNegated',
    'authoredEnabled',
    'column',
    'effectiveEnabled',
    'expression',
    'expressionFingerprint',
    'fallbackBranch',
    'falsyLabel',
    'kind',
    'line',
    'ownerName',
    'runtimeOwnerName',
    'reachabilityDiscoveryOrder',
    'reachabilityKey',
    'requiresAuthoredState',
    'renderValueHelper',
    'targetCallName',
    'role',
    'sourcePath',
    'synchronousContinuation',
    'targetBranch',
    'targetBranchEvidence',
    'truthyLabel',
  ]) {
    if (previous[name] !== next[name]) return true;
  }
  return false;
}

/** Defers registry-only UI refreshes so condition evaluation never updates React during render. */
function schedulePreviewInspectorConditionRegistryRefresh() {
  if (previewInspectorSession.renderConditionRefreshScheduled === true) return;
  previewInspectorSession.renderConditionRefreshScheduled = true;
  previewInspectorScheduleConditionMicrotask(() => {
    previewInspectorSession.renderConditionRefreshScheduled = false;
    schedulePreviewInspectorTreeRefresh();
  });
}

/**
 * Selects the sole compiler-proven continuation or visible overlay state for a cold direct target.
 *
 * Full page candidates install an active reachability key and advance one path-local gate per DFS
 * pass. Before that reverse graph exists, an early-return guard can otherwise replace the selected
 * file with a login, redirect, loading, or permission branch. Target-branch metadata is emitted only
 * when syntax proves that the opposite branch continues through the same component body. Overlay
 * metadata similarly defines true as visible, so a selected Modal file does not default to an empty
 * null return. Both temporary decisions need neither a guessed payload nor a user prompt.
 */
function readPreviewInspectorDirectContinuationOverride(metadata, manualOverride, autoOverride) {
  if (manualOverride !== undefined || autoOverride !== undefined) return undefined;
  if (metadata.requiresAuthoredState === true) return undefined;
  if (previewInspectorSession.fallbackValuesEnabled !== true) return undefined;
  if (isPreviewInspectorConditionControlledBySourceProvenPropChoice(metadata)) return undefined;
  if (typeof previewInspectorSession.activeTargetReachabilityKey === 'string') return undefined;
  const descriptors = Array.isArray(previewInspectorSession.descriptors)
    ? previewInspectorSession.descriptors
    : [];
  const selectedDescriptor = descriptors.find((descriptor) =>
    descriptor?.exportName === previewInspectorSession.selectedExportName,
  ) ?? descriptors[0];
  if (
    selectedDescriptor?.inspector !== undefined ||
    !['early-return', 'overlay-visibility'].includes(metadata.kind)
  ) {
    return undefined;
  }
  const ownerNames = previewInspectorSession.directTargetRuntimeOwnerNamesByExport instanceof Map
    ? previewInspectorSession.directTargetRuntimeOwnerNamesByExport.get(selectedDescriptor?.exportName)
    : undefined;
  if (!(ownerNames instanceof Set) || !ownerNames.has(metadata.ownerName)) return undefined;
  if (metadata.kind === 'overlay-visibility' && metadata.role === 'overlay') return true;
  if (metadata.targetBranch === 'truthy') return true;
  if (metadata.targetBranch === 'falsy') return false;
  return undefined;
}

/** Retains a compiler-stable condition ID proven inside the exact cold selected target facade. */
function rememberPreviewInspectorDirectTargetCondition(conditionId) {
  const descriptors = Array.isArray(previewInspectorSession.descriptors)
    ? previewInspectorSession.descriptors
    : [];
  const descriptor = descriptors.find(
    (item) => item?.exportName === previewInspectorSession.selectedExportName,
  ) ?? descriptors[0];
  const exportName = descriptor?.exportName;
  if (typeof exportName !== 'string' || exportName.length === 0) return;
  let conditionIds = previewInspectorSession.directTargetConditionIdsByExport.get(exportName);
  if (!(conditionIds instanceof Set)) {
    conditionIds = new Set();
    previewInspectorSession.directTargetConditionIdsByExport.set(exportName, conditionIds);
  }
  if (conditionIds.size < 128) conditionIds.add(conditionId);
}

/**
 * Resolves one compiler-issued condition from an exact whole-outcome choice, a manual edit, bounded
 * automatic continuation, or authored semantics in that order. A truthy authored object is returned
 * unchanged when no override applies so logical-and retains its exact normal result. Compiler-marked
 * negated expressions instead return visible-state booleans; the generated outer negation then
 * recreates the exact source guard while the Inspector consistently presents true as visible.
 */
function resolvePreviewInspectorRenderCondition(conditionId, authoredValue, metadata) {
  initializePreviewInspectorConditionState();
  const normalizedMetadata = normalizePreviewInspectorConditionMetadata(metadata);
  const authoredExpressionNegated = normalizedMetadata.authoredExpressionNegated === true;
  const authoredEnabled = authoredExpressionNegated
    ? !Boolean(authoredValue)
    : Boolean(authoredValue);
  const authoredResult = authoredExpressionNegated ? authoredEnabled : authoredValue;
  if (
    typeof conditionId !== 'string' ||
    conditionId.length === 0 ||
    conditionId.length > 128
  ) {
    return authoredResult;
  }
  const overrides = previewInspectorSession.renderConditionOverrides;
  const autoOverrides = previewInspectorSession.renderConditionAutoOverrides;
  let override = overrides.get(conditionId);
  let autoOverride = autoOverrides.get(conditionId);
  const outcomeOverride = typeof readPreviewInspectorRenderOutcomeConditionOverride === 'function'
    ? readPreviewInspectorRenderOutcomeConditionOverride(normalizedMetadata)
    : undefined;
  if (
    typeof outcomeOverride === 'boolean' &&
    reconcilePreviewInspectorManualOverrideWithOutcome(overrides, conditionId, outcomeOverride)
  ) {
    override = undefined;
  }
  const virtualPageShellContinuation = readPreviewInspectorVirtualPageShellContinuation(
    normalizedMetadata,
    override ?? outcomeOverride,
    autoOverride,
    authoredValue,
  );
  if (virtualPageShellContinuation !== undefined) {
    autoOverrides.set(conditionId, virtualPageShellContinuation);
    autoOverride = virtualPageShellContinuation;
  }
  const synchronousContinuation = readPreviewInspectorSynchronousNavigationContinuation(
    conditionId,
    normalizedMetadata,
    override ?? outcomeOverride,
    autoOverride,
  );
  if (synchronousContinuation !== undefined) {
    autoOverrides.set(conditionId, synchronousContinuation);
    autoOverride = synchronousContinuation;
  }
  const directContinuation = readPreviewInspectorDirectContinuationOverride(
    normalizedMetadata,
    override ?? outcomeOverride,
    autoOverride,
  );
  if (directContinuation !== undefined) {
    rememberPreviewInspectorDirectTargetCondition(conditionId);
    autoOverrides.set(conditionId, directContinuation);
    autoOverride = directContinuation;
  }
  // A chosen 'tab === "members"' fixes tab for sibling comparisons such as 'tab === "overview"';
  // a manual choice also decides a condition the automatic search forced.
  if (override === undefined && outcomeOverride === undefined) {
    autoOverride = readPreviewInspectorScalarCoherentOverride(normalizedMetadata, autoOverride !== undefined) ??
      autoOverride;
  }
  const applicableOverrides = readPreviewInspectorApplicableConditionOverrides(conditionId, authoredValue, normalizedMetadata, override, outcomeOverride, autoOverride);
  const effectiveEnabled = applicableOverrides.outcomeOverride ?? applicableOverrides.manualOverride ?? applicableOverrides.autoOverride ?? authoredEnabled;
  const records = previewInspectorSession.renderConditions;
  const previous = records.get(conditionId);
  const reachabilityKey =
    typeof previewInspectorSession.activeTargetReachabilityKey === 'string'
      ? previewInspectorSession.activeTargetReachabilityKey
      : undefined;
  const reachabilityDiscoveryOrder = previous !== undefined && previous.reachabilityKey === reachabilityKey
    ? previous.reachabilityDiscoveryOrder
    : ++previewInspectorSession.renderConditionDiscoverySequence;
  const nextRecord = {
    ...normalizedMetadata,
    authoredEnabled,
    authoredValueKind: authoredValue === null ? 'null' : typeof authoredValue,
    effectiveEnabled,
    id: conditionId,
    reachabilityDiscoveryOrder,
    reachabilityKey,
  };
  if (
    records.has(conditionId) ||
    records.size < PREVIEW_INSPECTOR_RENDER_CONDITION_LIMIT
  ) {
    records.set(conditionId, nextRecord);
    if (didPreviewInspectorConditionChange(previous, nextRecord)) {
      schedulePreviewInspectorConditionRegistryRefresh();
    }
  }
  if (
    directContinuation !== undefined &&
    typeof recordPreviewInspectorBlockerAutoDecision === 'function'
  ) {
    const directOverlay = normalizedMetadata.kind === 'overlay-visibility';
    recordPreviewInspectorBlockerAutoDecision({
      action: directOverlay ? 'Reveal direct target overlay' : 'Continue through direct target guard',
      blockerId: conditionId,
      blockerKind: 'render-condition',
      blockerName: 'Render condition · ' + normalizedMetadata.expression,
      column: normalizedMetadata.column,
      generatedPaths: [],
      line: normalizedMetadata.line,
      mode: directOverlay
        ? 'deterministic-direct-overlay'
        : 'deterministic-direct-continuation',
      ownerName: normalizedMetadata.ownerName,
      reason: directOverlay
        ? 'Compiler-proven overlay visibility is required for the selected file to produce host output'
        : 'Compiler-proven early-return continuation is the only branch that reaches the selected file body',
      selectedValue: directContinuation,
      sourcePath: normalizedMetadata.sourcePath,
      summary: {
        authoredEnabled,
        fallbackBranch: normalizedMetadata.fallbackBranch,
        role: normalizedMetadata.role,
        targetBranch: normalizedMetadata.targetBranch,
      },
    });
  }
  const selectedOverride = applicableOverrides.outcomeOverride ?? applicableOverrides.manualOverride ?? applicableOverrides.autoOverride;
  if (selectedOverride === undefined) return authoredResult;
  if (selectedOverride === false) return false;
  return authoredEnabled ? authoredResult : true;
}

/**
 * Evaluates one logical-AND guard behind an error boundary owned by the preview runtime.
 *
 * A preceding manually revealed guard can expose a dependent expression that authored JavaScript
 * previously short-circuited, such as session.user when session is null. That missing value must
 * become the next visible condition switch instead of aborting the component render. Normal values
 * still pass through the shared resolver unchanged, preserving object identity and exact falsy values.
 */
function resolvePreviewInspectorRenderConditionLazy(conditionId, evaluateAuthoredValue, metadata) {
  let authoredValue;
  try {
    if (typeof evaluateAuthoredValue !== 'function') {
      throw new TypeError('Render condition evaluator must be a function.');
    }
    authoredValue = evaluateAuthoredValue();
  } catch (error) {
    const normalizedMetadata = normalizePreviewInspectorConditionMetadata(metadata);
    if (typeof recordPreviewInspectorConsoleEntry === 'function') {
      let errorDescription = 'Unknown condition evaluation error';
      try {
        errorDescription = error instanceof Error
          ? error.name + ': ' + error.message
          : String(error);
      } catch {
        /* Keep the neutral error description when a hostile thrown value cannot be formatted. */
      }
      const sourceLocation = normalizedMetadata.sourcePath +
        (normalizedMetadata.line === undefined ? '' : ':' + String(normalizedMetadata.line)) +
        (normalizedMetadata.column === undefined ? '' : ':' + String(normalizedMetadata.column));
      recordPreviewInspectorConsoleEntry({
        details: 'Condition: ' + normalizedMetadata.authoredExpression + '\n' + errorDescription,
        error,
        level: 'warn',
        location: sourceLocation,
        message: '[React Preview] Render condition evaluation failed; authored value treated as false.',
        phase: 'evaluate-render-condition',
        source: 'render-condition',
      });
    }
    return resolvePreviewInspectorRenderCondition(conditionId, false, metadata);
  }
  return resolvePreviewInspectorRenderCondition(conditionId, authoredValue, metadata);
}

/** Returns a sorted serializable inventory for condition nodes in the Inspector tree. */
function readPreviewInspectorRenderConditions() {
  initializePreviewInspectorConditionState();
  const overrides = previewInspectorSession.renderConditionOverrides;
  const autoOverrides = previewInspectorSession.renderConditionAutoOverrides;
  return [...previewInspectorSession.renderConditions.values()]
    .map((record) => ({
      ...record,
      autoOverride: !overrides.has(record.id) && autoOverrides.has(record.id)
        ? autoOverrides.get(record.id)
        : undefined,
      override: overrides.has(record.id) ? overrides.get(record.id) : undefined,
    }))
    .sort((left, right) =>
      left.sourcePath.localeCompare(right.sourcePath) ||
      (left.line ?? 0) - (right.line ?? 0) ||
      left.id.localeCompare(right.id),
    );
}

/** Returns a sorted serializable switch-choice inventory without mixing it into boolean DFS gates. */
function readPreviewInspectorRenderChoices() {
  initializePreviewInspectorConditionState();
  const overrides = previewInspectorSession.renderChoiceOverrides;
  return [...previewInspectorSession.renderChoices.values()]
    .map(({ metadataSignature: _metadataSignature, ...record }) => ({
      ...record,
      override: overrides.has(record.id) ? overrides.get(record.id) : undefined,
    }))
    .sort((left, right) =>
      left.sourcePath.localeCompare(right.sourcePath) ||
      (left.line ?? 0) - (right.line ?? 0) ||
      left.id.localeCompare(right.id),
    );
}

${createPreviewInspectorConditionEditingRuntimeSource()}
`;
}
