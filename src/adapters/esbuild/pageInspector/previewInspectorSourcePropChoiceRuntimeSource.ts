/** Generates syntax-proven prop choice registration and reconciliation in the shared Inspector scope. */

/** Returns source concatenated at its original lexical position; declarations share the session scope. */
export function createPreviewInspectorSourcePropChoiceRuntimeSource(): string {
  return String.raw`/** Bounds compiler-issued scalar logic before retaining it in the live condition registry. */
function normalizePreviewInspectorConditionScalarExpression(rawExpression, depth = 0) {
  if (rawExpression === null || typeof rawExpression !== 'object' || depth > 6) return undefined;
  if (rawExpression.kind === 'comparison') {
    const path = typeof rawExpression.path === 'string'
      ? rawExpression.path.slice(0, 160)
      : '';
    const operator = ['==', '!=', '===', '!=='].includes(rawExpression.operator)
      ? rawExpression.operator
      : undefined;
    const value = rawExpression.value;
    const literalSupported = value === null || typeof value === 'string' ||
      typeof value === 'boolean' || (typeof value === 'number' && Number.isFinite(value));
    return path.length > 0 && operator !== undefined && literalSupported
      ? { kind: 'comparison', operator, path, value }
      : undefined;
  }
  if (rawExpression.kind === 'not') {
    const operand = normalizePreviewInspectorConditionScalarExpression(
      rawExpression.operand,
      depth + 1,
    );
    return operand === undefined ? undefined : { kind: 'not', operand };
  }
  if (rawExpression.kind !== 'and' && rawExpression.kind !== 'or') return undefined;
  const left = normalizePreviewInspectorConditionScalarExpression(rawExpression.left, depth + 1);
  const right = normalizePreviewInspectorConditionScalarExpression(rawExpression.right, depth + 1);
  return left === undefined || right === undefined
    ? undefined
    : { kind: rawExpression.kind, left, right };
}

/** Normalizes one compiler-proven external prop path without accepting prototype traversal. */
function normalizePreviewInspectorSourceProvenPropChoicePath(rawPath) {
  if (typeof rawPath !== 'string') return '';
  const path = rawPath.trim().slice(0, 160);
  const segments = path.split('.');
  return segments.length > 0 && segments.length <= 8 && segments.every((segment) =>
    /^[$A-Z_a-z][$\w]*$/u.test(segment) &&
    !['__proto__', 'constructor', 'prototype'].includes(segment)
  ) ? segments.join('.') : '';
}

/** Reports whether inert scalar metadata reads the exact selected prop path. */
function doesPreviewInspectorConditionReferenceSourceProvenProp(
  expression,
  propPath,
  depth = 0,
) {
  if (expression === null || typeof expression !== 'object' || depth > 6) return false;
  if (expression.kind === 'comparison') {
    const expressionPath = typeof expression.path === 'string' ? expression.path : '';
    return expressionPath === propPath || expressionPath === 'props.' + propPath ||
      expressionPath === 'this.props.' + propPath;
  }
  if (expression.kind === 'not') {
    return doesPreviewInspectorConditionReferenceSourceProvenProp(
      expression.operand,
      propPath,
      depth + 1,
    );
  }
  if (expression.kind !== 'and' && expression.kind !== 'or') return false;
  return doesPreviewInspectorConditionReferenceSourceProvenProp(
    expression.left,
    propPath,
    depth + 1,
  ) || doesPreviewInspectorConditionReferenceSourceProvenProp(
    expression.right,
    propPath,
    depth + 1,
  );
}

/** Lazily owns finite prop decisions for this generated entry revision only. */
function initializePreviewInspectorSourceProvenPropChoiceState() {
  if (!(previewInspectorSession.sourceProvenPropChoicesByExport instanceof Map)) {
    previewInspectorSession.sourceProvenPropChoicesByExport = new Map();
  }
}

/** Reads the generated-entry revision while keeping the standalone runtime fixture executable. */
function readPreviewInspectorSourceProvenPropChoiceRevision() {
  return typeof previewEntryRevision === 'number' ? previewEntryRevision : 0;
}

/** Reads the exact finite prop decision that makes one authored target condition authoritative. */
function readPreviewInspectorSourceProvenPropChoiceResolution(condition) {
  initializePreviewInspectorSourceProvenPropChoiceState();
  const exportName = previewInspectorSession.selectedExportName;
  const choices = typeof exportName === 'string'
    ? previewInspectorSession.sourceProvenPropChoicesByExport.get(exportName)
    : undefined;
  if (!(choices instanceof Map)) return undefined;
  const conditionSourcePath = typeof condition?.sourcePath === 'string'
    ? condition.sourcePath.replaceAll('\\', '/')
    : '';
  for (const resolution of choices.values()) {
    if (resolution?.revision !== readPreviewInspectorSourceProvenPropChoiceRevision()) continue;
    if (
      typeof resolution.sourcePath === 'string' && resolution.sourcePath.length > 0 &&
      conditionSourcePath !== resolution.sourcePath
    ) continue;
    if (
      typeof resolution.ownerName === 'string' && resolution.ownerName.length > 0 &&
      condition?.ownerName !== resolution.ownerName
    ) continue;
    if (doesPreviewInspectorConditionReferenceSourceProvenProp(
      condition?.scalarExpression,
      resolution.path,
    )) return resolution;
  }
  return undefined;
}

/** Prevents path search from overriding a branch whose external finite prop is now valid. */
function isPreviewInspectorConditionControlledBySourceProvenPropChoice(condition) {
  return readPreviewInspectorSourceProvenPropChoiceResolution(condition) !== undefined;
}

/** Removes stale automatic JSX decisions while preserving every explicit user branch override. */
function reconcilePreviewInspectorAutomaticConditionsWithSourceProvenPropChoice() {
  initializePreviewInspectorConditionState();
  let changed = false;
  const reconciledConditionIds = new Set();
  for (const conditionId of [...previewInspectorSession.renderConditionAutoOverrides.keys()]) {
    const record = previewInspectorSession.renderConditions.get(conditionId) ??
      previewInspectorSession.renderConditionDefinitions?.get?.(conditionId);
    if (!isPreviewInspectorConditionControlledBySourceProvenPropChoice(record)) continue;
    reconciledConditionIds.add(conditionId);
    changed = previewInspectorSession.renderConditionAutoOverrides.delete(conditionId) || changed;
    if (
      record !== undefined &&
      previewInspectorSession.renderConditions.has(conditionId) &&
      !previewInspectorSession.renderConditionOverrides.has(conditionId)
    ) {
      previewInspectorSession.renderConditions.set(conditionId, {
        ...record,
        effectiveEnabled: record.authoredEnabled,
      });
    }
  }
  if (reconciledConditionIds.size === 0) return false;
  for (const [traceId, attempt] of previewInspectorSession.renderConditionAutoAttempts) {
    if (reconciledConditionIds.has(attempt?.conditionId)) {
      previewInspectorSession.renderConditionAutoAttempts.delete(traceId);
    }
  }
  for (const rejected of previewInspectorSession.renderConditionRejectedAutoOverridesByKey.values()) {
    if (!(rejected instanceof Set)) continue;
    for (const conditionId of reconciledConditionIds) rejected.delete(conditionId);
  }
  for (const state of previewInspectorSession.targetReachabilityByKey?.values?.() ?? []) {
    if (Array.isArray(state?.appliedConditions)) {
      state.appliedConditions = state.appliedConditions.filter(
        (gate) => !reconciledConditionIds.has(gate?.id),
      );
    }
  }
  if (changed) previewInspectorSession.renderConditionRevision += 1;
  return changed;
}

/** Registers one source-authored finite prop decision and releases conflicting automatic gates. */
function registerPreviewInspectorSourceProvenPropChoice(
  exportName,
  rawPath,
  value,
  metadata = {},
) {
  const path = normalizePreviewInspectorSourceProvenPropChoicePath(rawPath);
  const primitive = value === null || typeof value === 'string' || typeof value === 'boolean' ||
    (typeof value === 'number' && Number.isFinite(value));
  if (typeof exportName !== 'string' || exportName.length === 0 || path.length === 0 || !primitive) {
    return false;
  }
  initializePreviewInspectorSourceProvenPropChoiceState();
  let choices = previewInspectorSession.sourceProvenPropChoicesByExport.get(exportName);
  if (!(choices instanceof Map)) {
    choices = new Map();
    previewInspectorSession.sourceProvenPropChoicesByExport.set(exportName, choices);
  }
  const sourcePath = typeof metadata?.sourcePath === 'string'
    ? metadata.sourcePath.replaceAll('\\', '/')
    : '';
  const ownerName = typeof metadata?.ownerName === 'string'
    ? metadata.ownerName.slice(0, 180)
    : '';
  choices.set(path, Object.freeze({
    origin: metadata?.origin === 'user-choice' ? 'user-choice' : 'automatic-repair',
    ownerName,
    path,
    revision: readPreviewInspectorSourceProvenPropChoiceRevision(),
    sourcePath,
    value,
  }));
  reconcilePreviewInspectorAutomaticConditionsWithSourceProvenPropChoice();
  return true;
}

/** Clears finite-choice authority when free-form JSON or Reset replaces that exact decision. */
function resetPreviewInspectorSourceProvenPropChoices(exportName) {
  initializePreviewInspectorSourceProvenPropChoiceState();
  return previewInspectorSession.sourceProvenPropChoicesByExport.delete(exportName);
}

`;
}
