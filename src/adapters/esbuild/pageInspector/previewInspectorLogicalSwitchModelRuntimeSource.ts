/**
 * Generates the data-only model that joins static JSX logical-AND guards with live conditions.
 *
 * JavaScript does not evaluate the later operands of a failed `a && b && <Panel />` chain. Runtime
 * instrumentation therefore cannot discover `b` until `a` is enabled. Static render outcomes know
 * that `b` exists, while the live condition registry owns the only safe editable condition ID. This
 * module merges both views without inventing an ID for an expression that has not executed yet.
 */

/** Maximum logical-AND rows admitted into one component-tree snapshot. */
export const PREVIEW_INSPECTOR_LOGICAL_SWITCH_LIMIT = 256;

/**
 * Creates browser source for stable logical-AND switch identities and static/runtime reconciliation.
 *
 * Expected lexical bindings include `readPreviewInspectorStaticRenderOutcomes` and the normalized
 * runtime condition inventory. Returned records are plain objects and never retain AST or Fiber data.
 *
 * @returns Plain JavaScript source concatenated before condition-tree enrichment runs.
 */
export function createPreviewInspectorLogicalSwitchModelRuntimeSource(): string {
  return String.raw`
const PREVIEW_INSPECTOR_LOGICAL_SWITCH_LIMIT = ${PREVIEW_INSPECTOR_LOGICAL_SWITCH_LIMIT};

/** Reads a collision-resistant expression identity when either analyzer side provides one. */
function readPreviewInspectorLogicalSwitchFingerprint(condition) {
  const value = condition?.expressionFingerprint ?? condition?.source?.expressionFingerprint;
  return typeof value === 'string' && value.length > 0 ? value : undefined;
}

/** Creates the bounded legacy source identity retained for mixed-version hot sessions. */
function createPreviewInspectorLogicalSwitchLegacySourceKey(condition) {
  return [
    condition?.sourcePath ?? condition?.source?.path ?? '',
    condition?.line ?? condition?.source?.line ?? '',
    condition?.column ?? condition?.source?.column ?? '',
    condition?.expression ?? condition?.source?.expression ?? '',
  ].join(':');
}

/** Creates the preferred source identity without truncating long-expression distinctions. */
function createPreviewInspectorLogicalSwitchSourceKey(condition) {
  const fingerprint = readPreviewInspectorLogicalSwitchFingerprint(condition);
  return fingerprint === undefined
    ? createPreviewInspectorLogicalSwitchLegacySourceKey(condition)
    : [
        condition?.sourcePath ?? condition?.source?.path ?? '',
        condition?.line ?? condition?.source?.line ?? '',
        condition?.column ?? condition?.source?.column ?? '',
        'fingerprint=' + fingerprint,
      ].join(':');
}

/** Uses analyzer chain metadata so repeated visible/hidden outcomes produce one switch row. */
function createPreviewInspectorLogicalSwitchGuardKey(condition) {
  return typeof condition?.logicalAndGroupId === 'string' &&
    Number.isSafeInteger(condition?.logicalAndGuardIndex)
    ? condition.logicalAndGroupId + ':' + String(condition.logicalAndGuardIndex)
    : 'source:' + createPreviewInspectorLogicalSwitchSourceKey(condition);
}

/** Reports whether two path spellings conservatively identify the same analyzer-owned source. */
function matchesPreviewInspectorLogicalSwitchSourcePath(left, right) {
  const normalizedLeft = typeof left === 'string' ? left.replaceAll('\\', '/') : '';
  const normalizedRight = typeof right === 'string' ? right.replaceAll('\\', '/') : '';
  if (normalizedLeft.length === 0 || normalizedRight.length === 0) return false;
  if (normalizedLeft === normalizedRight) return true;
  return normalizedLeft.endsWith('/' + normalizedRight.replace(/^\.\//u, '')) ||
    normalizedRight.endsWith('/' + normalizedLeft.replace(/^\.\//u, ''));
}

/**
 * Collects one static record per authored guard and prefers a visible JSX label over an empty path.
 * The export name is accepted as an owner hint only when the guard belongs to the plan's own file.
 */
function collectPreviewInspectorStaticLogicalSwitches(outcomes) {
  const switches = new Map();
  for (const outcome of Array.isArray(outcomes) ? outcomes : []) {
    for (const condition of Array.isArray(outcome?.conditions) ? outcome.conditions : []) {
      if (condition?.kind !== 'logical-and') continue;
      const guardKey = createPreviewInspectorLogicalSwitchGuardKey(condition);
      const previous = switches.get(guardKey);
      const componentNames = Array.isArray(outcome?.componentNames) ? outcome.componentNames : [];
      const visibleLabel = componentNames.length > 0 ? componentNames.slice(0, 4).join(', ') : undefined;
      const sourcePath = condition?.sourcePath ?? condition?.source?.path;
      const ownsGuardSource = matchesPreviewInspectorLogicalSwitchSourcePath(
        sourcePath,
        outcome?.sourcePath,
      );
      switches.set(guardKey, {
        condition: previous?.condition ?? condition,
        guardKey,
        label: visibleLabel ?? previous?.label,
        legacySourceKey: createPreviewInspectorLogicalSwitchLegacySourceKey(condition),
        ownerName: previous?.ownerName ?? (ownsGuardSource ? outcome?.exportName : undefined),
        sourceKey: createPreviewInspectorLogicalSwitchSourceKey(condition),
      });
      if (switches.size >= PREVIEW_INSPECTOR_LOGICAL_SWITCH_LIMIT) return switches;
    }
  }
  return switches;
}

/** Combines one static guard with its optional live condition without fabricating editability. */
function createPreviewInspectorLogicalSwitchRecord(entry, runtime) {
  const source = runtime ?? entry.condition;
  const reached = runtime !== undefined && typeof runtime.id === 'string' && runtime.id.length > 0;
  const expression = typeof source?.expression === 'string' && source.expression.length > 0
    ? source.expression
    : 'JSX visibility';
  return {
    ...source,
    authoredEnabled: reached ? runtime.authoredEnabled === true : undefined,
    autoOverride: reached ? runtime.autoOverride : undefined,
    conditionTreeId: 'logical-and:' + entry.guardKey,
    effectiveEnabled: reached ? runtime.effectiveEnabled === true : false,
    expression,
    falsyLabel: typeof runtime?.falsyLabel === 'string' ? runtime.falsyLabel : 'hidden',
    id: reached ? runtime.id : undefined,
    kind: 'logical-and',
    ownerName: runtime?.ownerName ?? entry.ownerName,
    override: reached ? runtime.override : undefined,
    reached,
    truthyLabel: typeof runtime?.truthyLabel === 'string' && runtime.truthyLabel.length > 0
      ? runtime.truthyLabel
      : entry.label ?? 'visible JSX',
  };
}

/**
 * Returns every source-proven logical guard, including disabled placeholders after short-circuiting.
 * Exact fingerprints win; the legacy join is admitted only when one side predates fingerprints.
 */
function readPreviewInspectorLogicalSwitchRecords(outcomes = [], runtimeConditions = []) {
  const runtimeBySource = new Map();
  const runtimeByLegacySource = new Map();
  for (const condition of Array.isArray(runtimeConditions) ? runtimeConditions : []) {
    if (condition?.kind !== 'logical-and' || typeof condition?.id !== 'string') continue;
    runtimeBySource.set(createPreviewInspectorLogicalSwitchSourceKey(condition), condition);
    const legacyKey = createPreviewInspectorLogicalSwitchLegacySourceKey(condition);
    const records = runtimeByLegacySource.get(legacyKey) ?? [];
    records.push(condition);
    runtimeByLegacySource.set(legacyKey, records);
  }
  const staticSwitches = collectPreviewInspectorStaticLogicalSwitches(outcomes);
  const records = [];
  const matchedRuntimeIds = new Set();
  for (const entry of staticSwitches.values()) {
    const exactRuntime = runtimeBySource.get(entry.sourceKey);
    const staticFingerprint = readPreviewInspectorLogicalSwitchFingerprint(entry.condition);
    const legacyRuntime = (runtimeByLegacySource.get(entry.legacySourceKey) ?? []).find((candidate) =>
      staticFingerprint === undefined ||
      readPreviewInspectorLogicalSwitchFingerprint(candidate) === undefined);
    const runtime = exactRuntime ?? legacyRuntime;
    if (typeof runtime?.id === 'string') matchedRuntimeIds.add(runtime.id);
    records.push(createPreviewInspectorLogicalSwitchRecord(entry, runtime));
  }
  for (const runtime of Array.isArray(runtimeConditions) ? runtimeConditions : []) {
    if (
      runtime?.kind !== 'logical-and' ||
      typeof runtime?.id !== 'string' ||
      matchedRuntimeIds.has(runtime.id)
    ) {
      continue;
    }
    const sourceKey = createPreviewInspectorLogicalSwitchSourceKey(runtime);
    records.push(createPreviewInspectorLogicalSwitchRecord({
      condition: runtime,
      guardKey: 'runtime:' + runtime.id,
      sourceKey,
    }, runtime));
  }
  return records.slice(0, PREVIEW_INSPECTOR_LOGICAL_SWITCH_LIMIT).sort((left, right) =>
    String(left.sourcePath ?? '').localeCompare(String(right.sourcePath ?? '')) ||
    (left.line ?? 0) - (right.line ?? 0) ||
    (left.column ?? 0) - (right.column ?? 0) ||
    String(left.conditionTreeId).localeCompare(String(right.conditionTreeId)));
}
`;
}
