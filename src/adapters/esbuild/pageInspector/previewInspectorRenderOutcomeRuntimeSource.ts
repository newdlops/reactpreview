/**
 * Generates the browser-side scenario adapter for statically discovered JSX return outcomes.
 *
 * Build-time analysis describes every bounded return candidate in the selected source file. This
 * adapter keeps one user-selected candidate in ordinary serializable Inspector state and projects
 * its condition edges onto compiler-instrumented boolean and switch controls. Project expressions
 * are never evaluated here. Selecting a complete outcome clears only source-matched manual branch
 * edits so an older persisted edit cannot silently defeat the newly selected scenario.
 */

/**
 * Creates runtime helpers shared by condition resolution and the render-flow UI.
 *
 * The generated functions are declarations so the condition registry may call them even though the
 * descriptor/session bindings are concatenated later in the same generated entry. Every lookup is
 * bounded and source-qualified to prevent same-named exports in a monorepo from sharing a scenario.
 *
 * @returns Plain JavaScript source with no project imports or host-privileged operations.
 */
export function createPreviewInspectorRenderOutcomeRuntimeSource(): string {
  return String.raw`
const PREVIEW_INSPECTOR_RENDER_OUTCOME_LIMIT = 32;
const PREVIEW_INSPECTOR_RENDER_OUTCOME_CONDITION_LIMIT = 16;

/**
 * Resolves the current-file export that owns static outcomes even while an ancestor/root export is
 * selected for page rendering. A selected export with its own plan remains authoritative.
 */
function readPreviewInspectorRenderOutcomeExportName() {
  const descriptor = typeof findSelectedPreviewInspectorDescriptor === 'function'
    ? findSelectedPreviewInspectorDescriptor()
    : undefined;
  const inspector = descriptor?.inspector;
  const selectedExportName = previewInspectorSession?.selectedExportName;
  if (
    typeof selectedExportName === 'string' &&
    inspector?.renderOutcomesByExport?.[selectedExportName] !== undefined
  ) {
    return selectedExportName;
  }
  const targetExportName = inspector?.target?.exportName;
  return typeof targetExportName === 'string' &&
    inspector?.renderOutcomesByExport?.[targetExportName] !== undefined
    ? targetExportName
    : selectedExportName;
}

/** Reads the selected export's immutable static outcome plan from the generated descriptor. */
function readPreviewInspectorSelectedRenderOutcomePlan() {
  const descriptor = typeof findSelectedPreviewInspectorDescriptor === 'function'
    ? findSelectedPreviewInspectorDescriptor()
    : undefined;
  const inspector = descriptor?.inspector;
  const exportName = readPreviewInspectorRenderOutcomeExportName();
  if (inspector === undefined || typeof exportName !== 'string') return undefined;
  const plan = inspector.renderOutcomesByExport?.[exportName];
  return plan !== null && typeof plan === 'object' ? plan : undefined;
}

/** Returns a bounded outcome array while accepting only extension-generated plain records. */
function readPreviewInspectorStaticRenderOutcomes() {
  const outcomes = readPreviewInspectorSelectedRenderOutcomePlan()?.outcomes;
  return Array.isArray(outcomes)
    ? outcomes.filter((outcome) => outcome !== null && typeof outcome === 'object')
        .slice(0, PREVIEW_INSPECTOR_RENDER_OUTCOME_LIMIT)
    : [];
}

/**
 * Returns the sole unconditional authored result without creating persisted scenario state.
 *
 * A component with exactly one unconditional return has no meaningful user choice. Treating that
 * result as selected keeps the graph and editor model accurate while avoiding a prompt, remount, or
 * webview-state write merely to confirm what the source already proves.
 */
function readPreviewInspectorAuthoredSingleRenderOutcome() {
  const outcomes = readPreviewInspectorStaticRenderOutcomes();
  if (outcomes.length !== 1 || typeof outcomes[0]?.id !== 'string') return undefined;
  const conditions = outcomes[0]?.conditions;
  return !Array.isArray(conditions) || conditions.length === 0 ? outcomes[0] : undefined;
}

/** Reads one condition's source identity from either a flat or nested analyzer record. */
function readPreviewInspectorRenderOutcomeConditionSource(condition) {
  const source = condition?.source;
  return {
    column: Number.isSafeInteger(condition?.column)
      ? condition.column
      : Number.isSafeInteger(source?.column) ? source.column : undefined,
    expression: typeof condition?.expression === 'string'
      ? condition.expression
      : typeof source?.expression === 'string' ? source.expression : undefined,
    expressionFingerprint: typeof condition?.expressionFingerprint === 'string'
      ? condition.expressionFingerprint
      : typeof source?.expressionFingerprint === 'string'
        ? source.expressionFingerprint
        : undefined,
    line: Number.isSafeInteger(condition?.line)
      ? condition.line
      : Number.isSafeInteger(source?.line) ? source.line : undefined,
    sourcePath: typeof condition?.sourcePath === 'string'
      ? condition.sourcePath
      : typeof source?.sourcePath === 'string'
        ? source.sourcePath
        : typeof source?.path === 'string' ? source.path : undefined,
  };
}

/** Proves that runtime metadata and one static condition edge identify the same authored decision. */
function matchesPreviewInspectorRenderOutcomeCondition(condition, metadata) {
  const source = readPreviewInspectorRenderOutcomeConditionSource(condition);
  const metadataPath = normalizePreviewInspectorConditionSourcePath(metadata?.sourcePath);
  const conditionPath = normalizePreviewInspectorConditionSourcePath(source.sourcePath);
  if (
    metadataPath.length === 0 ||
    conditionPath.length === 0 ||
    !matchesPreviewInspectorConditionSourcePath(metadataPath, conditionPath)
  ) {
    return false;
  }
  if (Number.isSafeInteger(source.line) && source.line !== metadata?.line) return false;
  if (Number.isSafeInteger(source.column) && source.column !== metadata?.column) return false;
  const staticFingerprint = typeof source.expressionFingerprint === 'string' &&
    source.expressionFingerprint.length > 0
    ? source.expressionFingerprint
    : undefined;
  const runtimeFingerprint = typeof metadata?.expressionFingerprint === 'string' &&
    metadata.expressionFingerprint.length > 0
    ? metadata.expressionFingerprint
    : undefined;
  if (staticFingerprint !== undefined && runtimeFingerprint !== undefined) {
    return staticFingerprint === runtimeFingerprint;
  }
  const runtimeExpression = typeof metadata?.authoredExpression === 'string'
    ? metadata.authoredExpression
    : metadata?.expression;
  return typeof source.expression !== 'string' || source.expression.length === 0 ||
    source.expression.replace(/\s+/gu, ' ').trim() ===
      String(runtimeExpression ?? '').replace(/\s+/gu, ' ').trim();
}

/** Reads the persisted current-file outcome identity without retaining compiler objects. */
function readPreviewInspectorSelectedRenderOutcomeId() {
  const exportName = readPreviewInspectorRenderOutcomeExportName();
  const selections = previewInspectorSession?.devtoolsState?.renderOutcomeSelectionByExport;
  const outcomeId = selections !== null && typeof selections === 'object' &&
    typeof exportName === 'string'
    ? selections[exportName]
    : undefined;
  return typeof outcomeId === 'string'
    ? outcomeId
    : readPreviewInspectorAuthoredSingleRenderOutcome()?.id;
}

/** Resolves the selected static scenario, discarding a stale identity after source edits. */
function readPreviewInspectorSelectedRenderOutcome() {
  const selectedId = readPreviewInspectorSelectedRenderOutcomeId();
  return selectedId === undefined
    ? undefined
    : readPreviewInspectorStaticRenderOutcomes().find((outcome) => outcome.id === selectedId);
}

/** Maps the selected outcome's authored arm to a boolean condition override. */
function readPreviewInspectorRenderOutcomeConditionOverride(metadata) {
  /* JSX logical-AND controls are independent switches, not whole-return ownership. */
  if (metadata?.kind === 'logical-and') return undefined;
  const outcome = readPreviewInspectorSelectedRenderOutcome();
  const conditions = Array.isArray(outcome?.conditions)
    ? outcome.conditions.slice(0, PREVIEW_INSPECTOR_RENDER_OUTCOME_CONDITION_LIMIT)
    : [];
  const condition = conditions.find((candidate) =>
    matchesPreviewInspectorRenderOutcomeCondition(candidate, metadata));
  const arm = condition?.arm ?? condition?.branch;
  const authoredValue = arm === 'truthy' || arm === true
    ? true
    : arm === 'falsy' || arm === false ? false : undefined;
  return typeof authoredValue === 'boolean' && metadata?.authoredExpressionNegated === true
    ? !authoredValue
    : authoredValue;
}

/** Reports whether the selected whole-return result owns this exact runtime branch decision. */
function isPreviewInspectorRenderConditionControlledByOutcome(metadata) {
  return typeof readPreviewInspectorRenderOutcomeConditionOverride(metadata) === 'boolean';
}

/** Maps a selected switch outcome to the runtime's independently validated branch record. */
function readPreviewInspectorRenderOutcomeChoiceBranch(metadata) {
  const outcome = readPreviewInspectorSelectedRenderOutcome();
  const conditions = Array.isArray(outcome?.conditions)
    ? outcome.conditions.slice(0, PREVIEW_INSPECTOR_RENDER_OUTCOME_CONDITION_LIMIT)
    : [];
  const condition = conditions.find((candidate) =>
    matchesPreviewInspectorRenderOutcomeCondition(candidate, metadata));
  if (condition === undefined) return undefined;
  const arm = condition.arm ?? condition.branch;
  if (arm === 'default') {
    return metadata?.branches?.find((branch) => branch.default === true && branch.selectable === true);
  }
  if (Object.prototype.hasOwnProperty.call(condition, 'value')) {
    return metadata?.branches?.find((branch) =>
      branch.selectable === true &&
      Object.prototype.hasOwnProperty.call(branch, 'value') &&
      branch.value === condition.value);
  }
  const label = typeof condition.label === 'string' ? condition.label : undefined;
  return label === undefined
    ? undefined
    : metadata?.branches?.find((branch) => branch.selectable === true && branch.label === label);
}

/** Reports whether one analyzer edge can project a boolean runtime decision. */
function isPreviewInspectorRenderOutcomeBooleanCondition(condition) {
  const arm = condition?.arm ?? condition?.branch;
  return arm === 'truthy' || arm === 'falsy' || arm === true || arm === false;
}

/**
 * Removes manual edits that identify decisions controlled by the newly selected whole outcome.
 *
 * Override IDs are intentionally opaque and differ from analyzer outcome-edge IDs. Runtime
 * condition registries are therefore the only safe join boundary: source path, line, column, and
 * expression must match before deletion. Unregistered or unrelated persisted entries remain intact
 * because deleting them by name or ID prefix would leak edits across files in a monorepo.
 */
function clearPreviewInspectorRenderOutcomeManualOverrides(outcome) {
  if (typeof initializePreviewInspectorConditionState !== 'function') return false;
  initializePreviewInspectorConditionState();
  const conditions = Array.isArray(outcome?.conditions)
    ? outcome.conditions.slice(0, PREVIEW_INSPECTOR_RENDER_OUTCOME_CONDITION_LIMIT)
    : [];
  let changed = false;
  for (const condition of conditions) {
    /* A return selection must never clear or rewrite the user's independent JSX mount switches. */
    if (condition?.kind === 'logical-and') continue;
    if (isPreviewInspectorRenderOutcomeBooleanCondition(condition)) {
      for (const [conditionId, record] of previewInspectorSession.renderConditions) {
        if (!matchesPreviewInspectorRenderOutcomeCondition(condition, record)) continue;
        if (!previewInspectorSession.renderConditionOverrides.delete(conditionId)) continue;
        const enabled = readPreviewInspectorRenderOutcomeConditionOverride(record);
        if (typeof enabled === 'boolean') {
          previewInspectorSession.renderConditions.set(conditionId, {
            ...record,
            effectiveEnabled: enabled,
          });
        }
        changed = true;
      }
      continue;
    }
    for (const [choiceId, record] of previewInspectorSession.renderChoices) {
      if (!matchesPreviewInspectorRenderOutcomeCondition(condition, record)) continue;
      const branch = readPreviewInspectorRenderOutcomeChoiceBranch(record);
      if (branch === undefined || !previewInspectorSession.renderChoiceOverrides.delete(choiceId)) {
        continue;
      }
      previewInspectorSession.renderChoices.set(choiceId, {
        ...record,
        effectiveBranchId: branch.id,
      });
      changed = true;
    }
  }
  return changed;
}

/** Selects one complete return scenario and remounts once so downstream decisions can register. */
function selectPreviewInspectorRenderOutcome(outcomeId) {
  const exportName = readPreviewInspectorRenderOutcomeExportName();
  const outcome = readPreviewInspectorStaticRenderOutcomes().find(
    (candidate) => candidate.id === outcomeId,
  );
  if (typeof exportName !== 'string' || outcome === undefined) return false;
  if (readPreviewInspectorSelectedRenderOutcomeId() === outcomeId) return false;
  const devtoolsState = previewInspectorSession.devtoolsState ??= {};
  const previous = devtoolsState.renderOutcomeSelectionByExport;
  const selections = previous !== null && typeof previous === 'object' && !Array.isArray(previous)
    ? { ...previous }
    : {};
  selections[exportName] = outcomeId;
  devtoolsState.renderOutcomeSelectionByExport = selections;
  clearPreviewInspectorRenderOutcomeManualOverrides(outcome);
  previewInspectorSession.renderConditionRevision =
    Number.isSafeInteger(previewInspectorSession.renderConditionRevision)
      ? previewInspectorSession.renderConditionRevision + 1
      : 1;
  persistPreviewInspectorState();
  notifyPreviewInspector();
  schedulePreviewInspectorCommitRefresh();
  return true;
}

/** Restores authored control flow for the selected export without touching manual condition edits. */
function clearPreviewInspectorRenderOutcome() {
  const exportName = readPreviewInspectorRenderOutcomeExportName();
  const selections = previewInspectorSession?.devtoolsState?.renderOutcomeSelectionByExport;
  if (
    typeof exportName !== 'string' ||
    selections === null ||
    typeof selections !== 'object' ||
    !Object.prototype.hasOwnProperty.call(selections, exportName)
  ) {
    return false;
  }
  const nextSelections = { ...selections };
  delete nextSelections[exportName];
  previewInspectorSession.devtoolsState.renderOutcomeSelectionByExport = nextSelections;
  previewInspectorSession.renderConditionRevision =
    Number.isSafeInteger(previewInspectorSession.renderConditionRevision)
      ? previewInspectorSession.renderConditionRevision + 1
      : 1;
  persistPreviewInspectorState();
  notifyPreviewInspector();
  schedulePreviewInspectorCommitRefresh();
  return true;
}
`;
}
