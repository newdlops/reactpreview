/**
 * Generates the browser-side registry for authored JSX conditions and automatic fallback values.
 *
 * The registry lives in the pinned webview session, survives hot-module replacements, and exposes no
 * host privilege. Project modules may only resolve a compiler-issued condition identity; all editing
 * and persistence functions remain lexical to the extension-owned Inspector UI.
 */

/**
 * Creates condition/fallback state helpers concatenated into the Page Inspector entry.
 *
 * Expected lexical bindings include `previewInspectorSession`, state persistence/notification helpers,
 * and the coalesced tree/highlight scheduler declared by the surrounding runtime source.
 *
 * @returns Plain JavaScript source evaluated before dynamically imported project modules.
 */
export function createPreviewInspectorConditionRuntimeSource(): string {
  return String.raw`
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

/** Bounds untrusted compiler metadata before it is retained in the live Inspector registry. */
function normalizePreviewInspectorConditionMetadata(metadata) {
  const source = metadata !== null && typeof metadata === 'object' ? metadata : {};
  const readText = (name, fallback = '') =>
    typeof source[name] === 'string' ? source[name].slice(0, 512) : fallback;
  const fallbackBranch = source.fallbackBranch === 'truthy' || source.fallbackBranch === 'falsy'
    ? source.fallbackBranch
    : undefined;
  const targetBranch = source.targetBranch === 'truthy' || source.targetBranch === 'falsy'
    ? source.targetBranch
    : undefined;
  const kind = ['early-return', 'logical-and', 'overlay-visibility', 'ternary'].includes(source.kind)
    ? source.kind
    : 'logical-and';
  return {
    column: Number.isSafeInteger(source.column) && source.column > 0 ? source.column : undefined,
    expression: readText('expression', 'conditional render'),
    ...(fallbackBranch === undefined ? {} : { fallbackBranch }),
    falsyLabel: readText('falsyLabel', 'hidden'),
    kind,
    line: Number.isSafeInteger(source.line) && source.line > 0 ? source.line : undefined,
    ownerName: readText('ownerName'),
    sourcePath: readText('sourcePath'),
    ...(source.role === 'overlay' ? { role: 'overlay' } : {}),
    ...(targetBranch === undefined ? {} : { targetBranch }),
    truthyLabel: readText('truthyLabel', 'visible'),
  };
}

/** Bounds compiler-issued switch metadata and independently verifies selectable primitive cases. */
function normalizePreviewInspectorRenderChoiceMetadata(metadata) {
  const source = metadata !== null && typeof metadata === 'object' ? metadata : {};
  const readText = (name, fallback = '') =>
    typeof source[name] === 'string' ? source[name].slice(0, 512) : fallback;
  const sourceBranches = Array.isArray(source.branches)
    ? source.branches.slice(0, PREVIEW_INSPECTOR_RENDER_CHOICE_BRANCH_LIMIT)
    : [];
  const seenIds = new Set();
  const branches = [];
  for (const rawBranch of sourceBranches) {
    if (rawBranch === null || typeof rawBranch !== 'object') continue;
    const id = typeof rawBranch.id === 'string' ? rawBranch.id.slice(0, 160) : '';
    if (id.length === 0 || seenIds.has(id)) continue;
    seenIds.add(id);
    const ownsValue = Object.prototype.hasOwnProperty.call(rawBranch, 'value');
    const value = rawBranch.value;
    const literalSupported = ownsValue && (
      value === null ||
      typeof value === 'string' ||
      typeof value === 'boolean' ||
      (typeof value === 'number' && Number.isFinite(value))
    );
    const calls = Array.isArray(rawBranch.calls)
      ? rawBranch.calls
          .filter((call) => typeof call === 'string' && call.length > 0)
          .slice(0, 16)
          .map((call) => call.slice(0, 160))
      : [];
    branches.push({
      ...(calls.length === 0 ? {} : { calls }),
      ...(rawBranch.default === true ? { default: true } : {}),
      id,
      label: typeof rawBranch.label === 'string'
        ? rawBranch.label.slice(0, 512)
        : rawBranch.default === true ? 'default' : 'case',
      requestedSelectable: rawBranch.selectable === true,
      ...(literalSupported ? { value } : {}),
    });
  }
  const everyCaseLiteral = branches.every(
    (branch) => branch.default === true || Object.prototype.hasOwnProperty.call(branch, 'value'),
  );
  let dynamicCaseSeen = false;
  const seenLiteralKeys = new Set();
  return {
    branches: branches.map(({ requestedSelectable, ...branch }) => {
      let safeToSelect = false;
      if (branch.default === true) {
        safeToSelect = everyCaseLiteral;
      } else if (Object.prototype.hasOwnProperty.call(branch, 'value')) {
        const literalKey = branch.value === null
          ? 'null'
          : typeof branch.value + ':' + String(branch.value);
        safeToSelect = !dynamicCaseSeen && !seenLiteralKeys.has(literalKey);
        seenLiteralKeys.add(literalKey);
      } else {
        dynamicCaseSeen = true;
      }
      return { ...branch, selectable: requestedSelectable === true && safeToSelect };
    }),
    column: Number.isSafeInteger(source.column) && source.column > 0 ? source.column : undefined,
    expression: readText('expression', 'switch choice'),
    kind: 'switch',
    line: Number.isSafeInteger(source.line) && source.line > 0 ? source.line : undefined,
    ownerName: readText('ownerName'),
    sourcePath: readText('sourcePath'),
  };
}

/** Finds an authored branch only while preceding dynamic case expressions cannot alter matching. */
function readPreviewInspectorAuthoredChoiceBranchId(authoredValue, branches) {
  let defaultBranch;
  let dynamicCaseSeen = false;
  for (const branch of branches) {
    if (branch.default === true) {
      defaultBranch = branch;
      continue;
    }
    if (!Object.prototype.hasOwnProperty.call(branch, 'value')) {
      dynamicCaseSeen = true;
      continue;
    }
    if (authoredValue === branch.value) {
      return dynamicCaseSeen ? undefined : branch.id;
    }
  }
  return dynamicCaseSeen ? undefined : defaultBranch?.id;
}

/** Reports whether a retained switch record changed in a way visible to the choice editor. */
function didPreviewInspectorRenderChoiceChange(previous, next) {
  return previous === undefined ||
    previous.authoredBranchId !== next.authoredBranchId ||
    previous.effectiveBranchId !== next.effectiveBranchId ||
    previous.metadataSignature !== next.metadataSignature;
}

/**
 * Resolves one compiler-issued switch discriminant while preserving its exact authored identity.
 * A forced literal is returned only for a selectable case; a safe default uses an unmatched Symbol.
 */
function resolvePreviewInspectorRenderChoice(choiceId, authoredValue, metadata) {
  initializePreviewInspectorConditionState();
  if (typeof choiceId !== 'string' || choiceId.length === 0 || choiceId.length > 128) {
    return authoredValue;
  }
  const normalizedMetadata = normalizePreviewInspectorRenderChoiceMetadata(metadata);
  const authoredBranchId = readPreviewInspectorAuthoredChoiceBranchId(
    authoredValue,
    normalizedMetadata.branches,
  );
  const overrideBranchId = previewInspectorSession.renderChoiceOverrides.get(choiceId);
  const overrideBranch = normalizedMetadata.branches.find(
    (branch) => branch.id === overrideBranchId && branch.selectable === true,
  );
  if (typeof overrideBranchId === 'string' && overrideBranch === undefined) {
    previewInspectorSession.renderChoiceOverrides.delete(choiceId);
  }
  const effectiveBranchId = overrideBranch?.id ?? authoredBranchId;
  const metadataSignature = JSON.stringify(normalizedMetadata);
  const records = previewInspectorSession.renderChoices;
  const previous = records.get(choiceId);
  const nextRecord = {
    ...normalizedMetadata,
    authoredBranchId,
    effectiveBranchId,
    id: choiceId,
    metadataSignature,
  };
  if (records.has(choiceId) || records.size < PREVIEW_INSPECTOR_RENDER_CONDITION_LIMIT) {
    records.set(choiceId, nextRecord);
    if (didPreviewInspectorRenderChoiceChange(previous, nextRecord)) {
      schedulePreviewInspectorConditionRegistryRefresh();
    }
  }
  if (overrideBranch === undefined) return authoredValue;
  if (overrideBranch.default === true) {
    return Symbol('React Preview forced switch default');
  }
  return overrideBranch.value;
}

/** Reports whether two retained records differ in a way visible to the component tree UI. */
function didPreviewInspectorConditionChange(previous, next) {
  if (previous === undefined) return true;
  for (const name of [
    'authoredEnabled',
    'column',
    'effectiveEnabled',
    'expression',
    'fallbackBranch',
    'falsyLabel',
    'kind',
    'line',
    'ownerName',
    'reachabilityDiscoveryOrder',
    'reachabilityKey',
    'role',
    'sourcePath',
    'targetBranch',
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
  if (previewInspectorSession.fallbackValuesEnabled !== true) return undefined;
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
 * Resolves one compiler-issued condition without changing authored semantics unless a user forced it.
 * A truthy authored object is returned unchanged so logical-and retains its exact normal result.
 */
function resolvePreviewInspectorRenderCondition(conditionId, authoredValue, metadata) {
  initializePreviewInspectorConditionState();
  if (
    typeof conditionId !== 'string' ||
    conditionId.length === 0 ||
    conditionId.length > 128
  ) {
    return authoredValue;
  }
  const overrides = previewInspectorSession.renderConditionOverrides;
  const autoOverrides = previewInspectorSession.renderConditionAutoOverrides;
  const override = overrides.get(conditionId);
  let autoOverride = autoOverrides.get(conditionId);
  const authoredEnabled = Boolean(authoredValue);
  const normalizedMetadata = normalizePreviewInspectorConditionMetadata(metadata);
  const directContinuation = readPreviewInspectorDirectContinuationOverride(
    normalizedMetadata,
    override,
    autoOverride,
  );
  if (directContinuation !== undefined) {
    rememberPreviewInspectorDirectTargetCondition(conditionId);
    autoOverrides.set(conditionId, directContinuation);
    autoOverride = directContinuation;
  }
  const effectiveEnabled = override ?? autoOverride ?? authoredEnabled;
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
  const selectedOverride = override ?? autoOverride;
  if (selectedOverride === undefined) return authoredValue;
  if (selectedOverride === false) return false;
  return authoredEnabled ? authoredValue : true;
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

/**
 * Forces one statically proven continuation branch for the current target-search pass.
 * Automatic decisions are deliberately ephemeral and always lose to an explicit user override.
 */
function setPreviewInspectorTargetGuidedConditionOverride(conditionId, enabled) {
  initializePreviewInspectorConditionState();
  if (!previewInspectorSession.renderConditions.has(conditionId) || typeof enabled !== 'boolean') {
    return false;
  }
  if (previewInspectorSession.renderConditionAutoOverrides.get(conditionId) === enabled) {
    return false;
  }
  previewInspectorSession.renderConditionAutoOverrides.set(conditionId, enabled);
  const record = previewInspectorSession.renderConditions.get(conditionId);
  if (record !== undefined && !previewInspectorSession.renderConditionOverrides.has(conditionId)) {
    previewInspectorSession.renderConditions.set(conditionId, {
      ...record,
      effectiveEnabled: enabled,
    });
  }
  if (typeof recordPreviewInspectorBlockerAutoDecision === 'function' && record !== undefined) {
    const traceId = recordPreviewInspectorBlockerAutoDecision({
      action: 'Advance target-guided JSX branch',
      blockerId: conditionId,
      blockerKind: 'render-condition',
      blockerName: 'Render condition · ' + record.expression,
      column: record.column,
      generatedPaths: [],
      line: record.line,
      mode: 'target-guided-auto',
      ownerName: record.ownerName,
      reason: 'Static path analysis selected the branch leading toward the current-file export',
      selectedValue: enabled,
      sourcePath: record.sourcePath,
      startsRenderAttempt: true,
      summary: {
        authoredEnabled: record.authoredEnabled,
        role: record.role,
        targetBranch: record.targetBranch,
      },
    });
    if (typeof traceId === 'string' && traceId.length > 0) {
      previewInspectorSession.renderConditionAutoAttempts.set(traceId, {
        conditionId,
        enabled,
        reachabilityKey: record.reachabilityKey,
      });
      while (previewInspectorSession.renderConditionAutoAttempts.size > 64) {
        previewInspectorSession.renderConditionAutoAttempts.delete(
          previewInspectorSession.renderConditionAutoAttempts.keys().next().value,
        );
      }
    }
  }
  previewInspectorSession.renderConditionRevision += 1;
  notifyPreviewInspector();
  schedulePreviewInspectorCommitRefresh();
  return true;
}

/**
 * Reports whether a failed automatic branch has already been rejected for this exact page search.
 * The rejection is session-only: an explicit retry, candidate change, or hot graph reset clears it.
 */
function isPreviewInspectorTargetGuidedConditionRejected(conditionId, reachabilityKey) {
  initializePreviewInspectorConditionState();
  if (typeof conditionId !== 'string' || typeof reachabilityKey !== 'string') return false;
  const rejected = previewInspectorSession.renderConditionRejectedAutoOverridesByKey.get(
    reachabilityKey,
  );
  return rejected instanceof Set && rejected.has(conditionId);
}

/**
 * Rolls back the one automatic JSX mutation causally linked to a new fatal render error.
 * Explicit user choices are never touched, and the rejected gate is remembered so the bounded DFS
 * cannot immediately recreate the same failure loop during the current candidate traversal.
 */
function rollbackPreviewInspectorFailedAutoDecision(traceId) {
  initializePreviewInspectorConditionState();
  if (typeof traceId !== 'string') return false;
  const attempt = previewInspectorSession.renderConditionAutoAttempts.get(traceId);
  previewInspectorSession.renderConditionAutoAttempts.delete(traceId);
  if (attempt === undefined) return false;
  if (previewInspectorSession.renderConditionOverrides.has(attempt.conditionId)) return false;
  if (
    previewInspectorSession.renderConditionAutoOverrides.get(attempt.conditionId) !== attempt.enabled
  ) {
    return false;
  }
  const currentKey = previewInspectorSession.activeTargetReachabilityKey;
  if (
    typeof attempt.reachabilityKey === 'string' &&
    typeof currentKey === 'string' &&
    attempt.reachabilityKey !== currentKey
  ) {
    return false;
  }
  previewInspectorSession.renderConditionAutoOverrides.delete(attempt.conditionId);
  const record = previewInspectorSession.renderConditions.get(attempt.conditionId);
  if (record !== undefined) {
    previewInspectorSession.renderConditions.set(attempt.conditionId, {
      ...record,
      effectiveEnabled: record.authoredEnabled,
    });
  }
  if (typeof attempt.reachabilityKey === 'string' && attempt.reachabilityKey.length > 0) {
    let rejected = previewInspectorSession.renderConditionRejectedAutoOverridesByKey.get(
      attempt.reachabilityKey,
    );
    if (!(rejected instanceof Set)) {
      rejected = new Set();
      previewInspectorSession.renderConditionRejectedAutoOverridesByKey.set(
        attempt.reachabilityKey,
        rejected,
      );
    }
    if (rejected.size < PREVIEW_INSPECTOR_RENDER_CONDITION_LIMIT) {
      rejected.add(attempt.conditionId);
    }
    const reachability = previewInspectorSession.targetReachabilityByKey?.get(
      attempt.reachabilityKey,
    );
    if (reachability !== undefined && Array.isArray(reachability.appliedConditions)) {
      const rejectedGate = reachability.appliedConditions.find(
        (gate) => gate?.id === attempt.conditionId,
      );
      reachability.appliedConditions = reachability.appliedConditions.filter(
        (gate) => gate?.id !== attempt.conditionId,
      );
      reachability.rejectedConditions ??= [];
      if (rejectedGate !== undefined && reachability.rejectedConditions.length < 64) {
        reachability.rejectedConditions.push({ ...rejectedGate, reason: 'runtime-error', traceId });
      }
      reachability.status = 'recovering-after-rejected-gate';
    }
  }
  previewInspectorSession.renderConditionRevision += 1;
  if (typeof recordPreviewInspectorRuntimeHealth === 'function') {
    recordPreviewInspectorRuntimeHealth({
      category: 'render-attempt',
      detail: {
        conditionId: attempt.conditionId,
        reachabilityKey: attempt.reachabilityKey,
        traceId,
      },
      event: 'automatic-condition-rolled-back',
    });
  }
  notifyPreviewInspector();
  schedulePreviewInspectorCommitRefresh();
  return true;
}

/** Clears target-guided branches for one candidate/export search without touching user choices. */
function clearPreviewInspectorTargetGuidedConditionOverrides(reachabilityKey) {
  initializePreviewInspectorConditionState();
  let changed = false;
  for (const conditionId of [...previewInspectorSession.renderConditionAutoOverrides.keys()]) {
    const record = previewInspectorSession.renderConditions.get(conditionId);
    if (
      typeof reachabilityKey === 'string' &&
      reachabilityKey.length > 0 &&
      record?.reachabilityKey !== reachabilityKey
    ) {
      continue;
    }
    changed = previewInspectorSession.renderConditionAutoOverrides.delete(conditionId) || changed;
    if (record !== undefined && !previewInspectorSession.renderConditionOverrides.has(conditionId)) {
      previewInspectorSession.renderConditions.set(conditionId, {
        ...record,
        effectiveEnabled: record.authoredEnabled,
      });
    }
  }
  if (typeof reachabilityKey === 'string' && reachabilityKey.length > 0) {
    previewInspectorSession.renderConditionRejectedAutoOverridesByKey.delete(reachabilityKey);
  } else {
    previewInspectorSession.renderConditionRejectedAutoOverridesByKey.clear();
  }
  previewInspectorSession.renderConditionAutoAttempts.clear();
  if (changed) previewInspectorSession.renderConditionRevision += 1;
  return changed;
}

/** Forces one branch, remounting the authored page so memoized owners also observe the decision. */
function setPreviewInspectorRenderConditionOverride(conditionId, enabled) {
  initializePreviewInspectorConditionState();
  if (!previewInspectorSession.renderConditions.has(conditionId) || typeof enabled !== 'boolean') {
    return;
  }
  const previous = previewInspectorSession.renderConditionOverrides.get(conditionId);
  if (previous === enabled) return;
  previewInspectorSession.renderConditionOverrides.set(conditionId, enabled);
  const record = previewInspectorSession.renderConditions.get(conditionId);
  if (record !== undefined) {
    previewInspectorSession.renderConditions.set(conditionId, {
      ...record,
      effectiveEnabled: enabled,
    });
  }
  previewInspectorSession.renderConditionRevision += 1;
  persistPreviewInspectorState();
  notifyPreviewInspector();
  schedulePreviewInspectorCommitRefresh();
}

/** Flips the currently effective branch directly from its component-tree row. */
function togglePreviewInspectorRenderCondition(conditionId) {
  const record = readPreviewInspectorRenderConditions().find((item) => item.id === conditionId);
  if (record === undefined) return;
  setPreviewInspectorRenderConditionOverride(conditionId, !record.effectiveEnabled);
}

/** Restores one condition to its authored runtime value and remounts the page once. */
function resetPreviewInspectorRenderConditionOverride(conditionId) {
  initializePreviewInspectorConditionState();
  const manualChanged = previewInspectorSession.renderConditionOverrides.delete(conditionId);
  const automaticChanged = previewInspectorSession.renderConditionAutoOverrides.delete(conditionId);
  if (!manualChanged && !automaticChanged) return;
  const record = previewInspectorSession.renderConditions.get(conditionId);
  if (record !== undefined) {
    previewInspectorSession.renderConditions.set(conditionId, {
      ...record,
      effectiveEnabled: record.authoredEnabled,
    });
  }
  previewInspectorSession.renderConditionRevision += 1;
  persistPreviewInspectorState();
  notifyPreviewInspector();
  schedulePreviewInspectorCommitRefresh();
}

/** Forces one compiler-proven literal/default switch branch and remounts the page once. */
function setPreviewInspectorRenderChoiceOverride(choiceId, branchId) {
  initializePreviewInspectorConditionState();
  const record = previewInspectorSession.renderChoices.get(choiceId);
  const branch = record?.branches?.find(
    (candidate) => candidate.id === branchId && candidate.selectable === true,
  );
  if (branch === undefined) return false;
  if (previewInspectorSession.renderChoiceOverrides.get(choiceId) === branchId) return false;
  previewInspectorSession.renderChoiceOverrides.set(choiceId, branchId);
  previewInspectorSession.renderChoices.set(choiceId, {
    ...record,
    effectiveBranchId: branchId,
  });
  previewInspectorSession.renderConditionRevision += 1;
  persistPreviewInspectorState();
  notifyPreviewInspector();
  schedulePreviewInspectorCommitRefresh();
  return true;
}

/** Restores one switch to its authored discriminant without touching boolean branch overrides. */
function resetPreviewInspectorRenderChoiceOverride(choiceId) {
  initializePreviewInspectorConditionState();
  if (!previewInspectorSession.renderChoiceOverrides.delete(choiceId)) return false;
  const record = previewInspectorSession.renderChoices.get(choiceId);
  if (record !== undefined) {
    previewInspectorSession.renderChoices.set(choiceId, {
      ...record,
      effectiveBranchId: record.authoredBranchId,
    });
  }
  previewInspectorSession.renderConditionRevision += 1;
  persistPreviewInspectorState();
  notifyPreviewInspector();
  schedulePreviewInspectorCommitRefresh();
  return true;
}

/** Reports whether inferred props and usage-derived automatic values are currently admitted. */
function readPreviewInspectorFallbackValuesEnabled() {
  initializePreviewInspectorConditionState();
  return previewInspectorSession.fallbackValuesEnabled;
}

/** Toggles all preview-generated prop values while preserving setup and real parent props. */
function setPreviewInspectorFallbackValuesEnabled(enabled) {
  initializePreviewInspectorConditionState();
  const normalized = enabled === true;
  if (previewInspectorSession.fallbackValuesEnabled === normalized) return;
  previewInspectorSession.fallbackValuesEnabled = normalized;
  previewInspectorSession.renderConditionRevision += 1;
  persistPreviewInspectorState();
  notifyPreviewInspector();
  schedulePreviewInspectorHighlight();
}

/** Returns the remount key shared by branch and automatic-value controls. */
function readPreviewInspectorRenderConditionRevision() {
  initializePreviewInspectorConditionState();
  return previewInspectorSession.renderConditionRevision;
}

/** Serializes only bounded boolean condition overrides for VS Code webview persistence. */
function serializePreviewInspectorRenderConditionOverrides() {
  initializePreviewInspectorConditionState();
  return Object.fromEntries(
    [...previewInspectorSession.renderConditionOverrides]
      .filter(
        ([conditionId, value]) =>
          typeof conditionId === 'string' && conditionId.length <= 128 && typeof value === 'boolean',
      )
      .slice(0, PREVIEW_INSPECTOR_RENDER_CONDITION_LIMIT),
  );
}

/** Serializes bounded switch branch identities separately from boolean condition overrides. */
function serializePreviewInspectorRenderChoiceOverrides() {
  initializePreviewInspectorConditionState();
  return Object.fromEntries(
    [...previewInspectorSession.renderChoiceOverrides]
      .filter(
        ([choiceId, branchId]) =>
          typeof choiceId === 'string' &&
          choiceId.length <= 128 &&
          typeof branchId === 'string' &&
          branchId.length <= 160,
      )
      .slice(0, PREVIEW_INSPECTOR_RENDER_CONDITION_LIMIT),
  );
}
`;
}
