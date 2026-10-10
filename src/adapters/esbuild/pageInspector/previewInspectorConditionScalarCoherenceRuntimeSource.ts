/**
 * Generates browser helpers that keep sibling JSX comparisons consistent with a forced one.
 *
 * An automatic branch choice overrides one condition, not the value it reads. Forcing
 * `tab === 'members'` therefore left `tab === 'overview'` authored-true, and a tab page drew two
 * panels at once. The compiler's scalar metadata says which value the forced branch fixes, so the
 * other comparisons of that value in the same component are evaluated against it instead.
 */

/**
 * Creates browser source for scalar coherence between automatic condition overrides.
 *
 * Expected lexical bindings: `previewInspectorSession` with the live condition registries.
 *
 * @returns Plain JavaScript concatenated into the isolated Page Inspector runtime.
 */
export function createPreviewInspectorConditionScalarCoherenceRuntimeSource(): string {
  return String.raw`
/** Names the component scope whose comparisons share one value; undefined without an owner. */
function readPreviewInspectorScalarCoherenceScope(record) {
  const owner = record?.runtimeOwnerName || record?.ownerName;
  const sourcePath = typeof record?.sourcePath === 'string' ? record.sourcePath.replaceAll('\\', '/') : '';
  return typeof owner === 'string' && owner.length > 0 && sourcePath.length > 0
    ? sourcePath + '\n' + owner
    : undefined;
}

/** Collects the exact values one forced truth fixes ('tab === "members"' true → tab = 'members'). */
function collectPreviewInspectorForcedScalarAssignments(expression, truth, assignments, depth = 0) {
  if (expression === null || typeof expression !== 'object' || depth > 6) return;
  if (expression.kind === 'comparison') {
    const equality = expression.operator === '===' || expression.operator === '==';
    // 'x == null' admits both null and undefined, so it fixes no single value.
    const exact = expression.operator.length === 3 || expression.value !== null;
    if (equality === truth && exact) assignments.push([expression.path, expression.value]);
    return;
  }
  if (expression.kind === 'not') {
    collectPreviewInspectorForcedScalarAssignments(expression.operand, !truth, assignments, depth + 1);
    return;
  }
  if ((expression.kind === 'and' && truth) || (expression.kind === 'or' && !truth)) {
    collectPreviewInspectorForcedScalarAssignments(expression.left, truth, assignments, depth + 1);
    collectPreviewInspectorForcedScalarAssignments(expression.right, truth, assignments, depth + 1);
  }
}

/**
 * Calls back with each choice of one kind in a scope and the values it fixes: 'manual' Inspector
 * toggles, or 'automatic' overrides that no manual toggle supersedes.
 */
function forEachPreviewInspectorForcedScalarChoice(scope, kind, callback) {
  const manualChoices = previewInspectorSession.renderConditionOverrides;
  const choices = kind === 'manual' ? manualChoices : previewInspectorSession.renderConditionAutoOverrides;
  if (!(choices instanceof Map)) return;
  for (const [conditionId, enabled] of choices) {
    if (typeof enabled !== 'boolean' || (kind !== 'manual' && manualChoices?.has?.(conditionId))) continue;
    const record = previewInspectorSession.renderConditions?.get?.(conditionId) ??
      previewInspectorSession.renderConditionDefinitions?.get?.(conditionId);
    if (record?.scalarExpression === undefined || readPreviewInspectorScalarCoherenceScope(record) !== scope) {
      continue;
    }
    const assignments = [];
    collectPreviewInspectorForcedScalarAssignments(
      record.scalarExpression,
      record.authoredExpressionNegated === true ? !enabled : enabled,
      assignments,
    );
    if (assignments.length > 0) callback(record, enabled, assignments);
  }
}

/** Reads the values one kind of choice fixes in a component scope, dropping contradictions. */
function readPreviewInspectorForcedScalarValues(scope, kind) {
  const values = new Map();
  const conflicts = new Set();
  forEachPreviewInspectorForcedScalarChoice(scope, kind, (_record, _enabled, assignments) => {
    for (const [path, value] of assignments) {
      if (values.has(path) && !Object.is(values.get(path), value)) conflicts.add(path);
      values.set(path, value);
    }
  });
  for (const path of conflicts) values.delete(path);
  return values;
}

/** Evaluates scalar logic only when every compared value is fixed by a forced sibling. */
function evaluatePreviewInspectorForcedScalarExpression(expression, values, depth = 0) {
  if (expression === null || typeof expression !== 'object' || depth > 6) return undefined;
  if (expression.kind === 'comparison') {
    if (!values.has(expression.path)) return undefined;
    const value = values.get(expression.path);
    const equal = value === expression.value ||
      (expression.operator.length === 2 && value == null && expression.value == null);
    return expression.operator === '===' || expression.operator === '==' ? equal : !equal;
  }
  if (expression.kind === 'not') {
    const operand = evaluatePreviewInspectorForcedScalarExpression(expression.operand, values, depth + 1);
    return typeof operand === 'boolean' ? !operand : undefined;
  }
  if (expression.kind !== 'and' && expression.kind !== 'or') return undefined;
  const left = evaluatePreviewInspectorForcedScalarExpression(expression.left, values, depth + 1);
  const right = evaluatePreviewInspectorForcedScalarExpression(expression.right, values, depth + 1);
  const decisive = expression.kind === 'and' ? false : true;
  if (left === decisive || right === decisive) return decisive;
  return typeof left === 'boolean' && typeof right === 'boolean' ? !decisive : undefined;
}

/**
 * Returns the visible state a condition takes from the values its chosen siblings fix, or undefined.
 * Manual Inspector choices come first and also decide a condition the automatic search forced
 * (choosing billing closes an automatically opened members panel); automatic choices decide only
 * conditions without a choice of their own. The caller skips conditions with a manual choice.
 */
function readPreviewInspectorScalarCoherentOverride(metadata, ownAutomaticChoice = false) {
  const manualSize = previewInspectorSession.renderConditionOverrides?.size ?? 0;
  const automaticSize = previewInspectorSession.renderConditionAutoOverrides?.size ?? 0;
  if (metadata?.scalarExpression === undefined || manualSize + automaticSize === 0) return undefined;
  const scope = readPreviewInspectorScalarCoherenceScope(metadata);
  if (scope === undefined) return undefined;
  const manual = readPreviewInspectorForcedScalarValues(scope, 'manual');
  let truth = evaluatePreviewInspectorForcedScalarExpression(metadata.scalarExpression, manual);
  if (typeof truth !== 'boolean' && !ownAutomaticChoice) {
    const values = readPreviewInspectorForcedScalarValues(scope, 'automatic');
    for (const [path, value] of manual) values.set(path, value);
    truth = evaluatePreviewInspectorForcedScalarExpression(metadata.scalarExpression, values);
  }
  if (typeof truth !== 'boolean') return undefined;
  return metadata.authoredExpressionNegated === true ? !truth : truth;
}

/** Collects every value path a scalar expression compares. */
function collectPreviewInspectorScalarPaths(expression, paths, depth = 0) {
  if (expression === null || typeof expression !== 'object' || depth > 6) return;
  if (expression.kind === 'comparison') paths.add(expression.path);
  else if (expression.kind === 'not') collectPreviewInspectorScalarPaths(expression.operand, paths, depth + 1);
  else if (expression.kind === 'and' || expression.kind === 'or') {
    collectPreviewInspectorScalarPaths(expression.left, paths, depth + 1);
    collectPreviewInspectorScalarPaths(expression.right, paths, depth + 1);
  }
}

/**
 * Names the chosen branches ('tab === "members" ON', manual ones marked) whose fixed value decides a
 * condition without a manual choice of its own, so the Inspector can say why it is off.
 */
function readPreviewInspectorScalarCoherenceSources(condition) {
  const conditionId = condition?.id;
  const record = previewInspectorSession.renderConditions?.get?.(conditionId) ??
    previewInspectorSession.renderConditionDefinitions?.get?.(conditionId);
  const ownAutomaticChoice = previewInspectorSession.renderConditionAutoOverrides?.has?.(conditionId) === true;
  if (
    typeof conditionId !== 'string' || record === undefined ||
    previewInspectorSession.renderConditionOverrides?.has?.(conditionId) ||
    readPreviewInspectorScalarCoherentOverride(record, ownAutomaticChoice) === undefined
  ) return [];
  const paths = new Set();
  collectPreviewInspectorScalarPaths(record.scalarExpression, paths);
  const scope = readPreviewInspectorScalarCoherenceScope(record);
  const manual = readPreviewInspectorForcedScalarValues(scope, 'manual');
  const sources = [];
  forEachPreviewInspectorForcedScalarChoice(scope, 'manual', (chosen, enabled, assignments) => {
    if (assignments.some(([path]) => paths.has(path) && manual.has(path))) {
      sources.push(String(chosen.expression) + (enabled ? ' ON' : ' OFF') + ' (manual)');
    }
  });
  if (ownAutomaticChoice) return sources;
  forEachPreviewInspectorForcedScalarChoice(scope, 'automatic', (chosen, enabled, assignments) => {
    if (assignments.some(([path]) => paths.has(path) && !manual.has(path))) {
      sources.push(String(chosen.expression) + (enabled ? ' ON' : ' OFF'));
    }
  });
  return sources;
}
`;
}
