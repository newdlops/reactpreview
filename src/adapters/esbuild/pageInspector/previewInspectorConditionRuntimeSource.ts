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
const previewInspectorScheduleConditionMicrotask = typeof globalThis.queueMicrotask === 'function'
  ? globalThis.queueMicrotask.bind(globalThis)
  : (callback) => Promise.resolve().then(callback);

/** Lazily initializes persisted interactive condition state on both new and retained sessions. */
function initializePreviewInspectorConditionState() {
  if (!(previewInspectorSession.renderConditions instanceof Map)) {
    previewInspectorSession.renderConditions = new Map();
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
  if (typeof previewInspectorSession.fallbackValuesEnabled !== 'boolean') {
    const persisted = readPersistedPreviewInspectorState();
    previewInspectorSession.fallbackValuesEnabled = persisted.fallbackValuesEnabled !== false;
  }
  if (!Number.isSafeInteger(previewInspectorSession.renderConditionRevision)) {
    previewInspectorSession.renderConditionRevision = 0;
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
  const kind = ['logical-and', 'overlay-visibility', 'ternary'].includes(source.kind)
    ? source.kind
    : 'logical-and';
  return {
    column: Number.isSafeInteger(source.column) && source.column > 0 ? source.column : undefined,
    expression: readText('expression', 'conditional render'),
    ...(fallbackBranch === undefined ? {} : { fallbackBranch }),
    falsyLabel: readText('falsyLabel', 'hidden'),
    kind,
    line: Number.isSafeInteger(source.line) && source.line > 0 ? source.line : undefined,
    sourcePath: readText('sourcePath'),
    ...(source.role === 'overlay' ? { role: 'overlay' } : {}),
    truthyLabel: readText('truthyLabel', 'visible'),
  };
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
    'role',
    'sourcePath',
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
  const override = overrides.get(conditionId);
  const authoredEnabled = Boolean(authoredValue);
  const effectiveEnabled = override ?? authoredEnabled;
  const normalizedMetadata = normalizePreviewInspectorConditionMetadata(metadata);
  const nextRecord = {
    ...normalizedMetadata,
    authoredEnabled,
    effectiveEnabled,
    id: conditionId,
  };
  const records = previewInspectorSession.renderConditions;
  if (
    records.has(conditionId) ||
    records.size < PREVIEW_INSPECTOR_RENDER_CONDITION_LIMIT
  ) {
    const previous = records.get(conditionId);
    records.set(conditionId, nextRecord);
    if (didPreviewInspectorConditionChange(previous, nextRecord)) {
      schedulePreviewInspectorConditionRegistryRefresh();
    }
  }
  if (override === undefined) return authoredValue;
  if (override === false) return false;
  return authoredEnabled ? authoredValue : true;
}

/** Returns a sorted serializable inventory for condition nodes in the Inspector tree. */
function readPreviewInspectorRenderConditions() {
  initializePreviewInspectorConditionState();
  const overrides = previewInspectorSession.renderConditionOverrides;
  return [...previewInspectorSession.renderConditions.values()]
    .map((record) => ({
      ...record,
      override: overrides.has(record.id) ? overrides.get(record.id) : undefined,
    }))
    .sort((left, right) =>
      left.sourcePath.localeCompare(right.sourcePath) ||
      (left.line ?? 0) - (right.line ?? 0) ||
      left.id.localeCompare(right.id),
    );
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
  if (!previewInspectorSession.renderConditionOverrides.delete(conditionId)) return;
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
`;
}
