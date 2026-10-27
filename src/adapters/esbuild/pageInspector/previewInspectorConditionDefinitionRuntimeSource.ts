/**
 * Generates the inert condition-definition registry used before a JSX branch executes.
 *
 * JavaScript short-circuiting means a nested condition does not enter the live condition registry
 * until every parent branch has already allowed execution to reach it. The compiler nevertheless
 * knows the nested condition's stable runtime ID and source metadata. This registry keeps that
 * evidence separate from evaluated conditions so target-guided runtime traversal still reasons only
 * about values the application actually read, while the user can queue an explicit branch choice.
 */
import { createPreviewInspectorConditionScalarCoherenceRuntimeSource } from './previewInspectorConditionScalarCoherenceRuntimeSource';

/**
 * Creates browser source for registering and reading compiler-proven condition definitions.
 *
 * The generated functions share the Inspector session, condition normalization, persistence, and
 * refresh helpers owned by the enclosing Page Inspector runtime. Definitions contain no authored
 * values or executable project references and are bounded independently from the live registry.
 *
 * @returns Plain JavaScript concatenated into the isolated Page Inspector runtime.
 */
export function createPreviewInspectorConditionDefinitionRuntimeSource(): string {
  return String.raw`
${createPreviewInspectorConditionScalarCoherenceRuntimeSource()}
const PREVIEW_INSPECTOR_RENDER_CONDITION_DEFINITION_LIMIT = 512;

/** Lazily creates the metadata-only registry on new and hot-retained Inspector sessions. */
function initializePreviewInspectorConditionDefinitionState() {
  if (!(previewInspectorSession.renderConditionDefinitions instanceof Map)) {
    previewInspectorSession.renderConditionDefinitions = new Map();
  }
}

/** Normalizes a source path without depending on UI helpers declared later in the entry. */
function normalizePreviewInspectorConditionDefinitionPath(value) {
  return typeof value === 'string' ? value.replaceAll('\\', '/') : '';
}

/** Reports whether two absolute/relative spellings conservatively identify the same source file. */
function matchesPreviewInspectorConditionDefinitionPath(left, right) {
  const normalizedLeft = normalizePreviewInspectorConditionDefinitionPath(left);
  const normalizedRight = normalizePreviewInspectorConditionDefinitionPath(right);
  if (normalizedLeft.length === 0 || normalizedRight.length === 0) return false;
  if (normalizedLeft === normalizedRight) return true;
  return normalizedLeft.endsWith('/' + normalizedRight.replace(/^\.\//u, '')) ||
    normalizedRight.endsWith('/' + normalizedLeft.replace(/^\.\//u, ''));
}

/** Gives the selected source priority if a very large authored page exhausts the metadata budget. */
function isPreviewInspectorSelectedConditionDefinition(definition) {
  const descriptors = Array.isArray(previewInspectorSession.descriptors)
    ? previewInspectorSession.descriptors
    : [];
  const selected = descriptors.find((descriptor) =>
    descriptor?.exportName === previewInspectorSession.selectedExportName) ?? descriptors[0];
  const candidatePaths = [
    selected?.inspector?.target?.sourcePath,
    selected?.sourcePath,
  ].filter((value) => typeof value === 'string' && value.length > 0);
  return candidatePaths.some((sourcePath) =>
    matchesPreviewInspectorConditionDefinitionPath(sourcePath, definition?.sourcePath));
}

/**
 * Registers one compiler-issued identity without evaluating the corresponding authored expression.
 *
 * Repeated hot registrations replace their exact ID. When the bounded registry is full, an exact
 * selected-file definition may evict the oldest unrelated definition so the current scenario table
 * never loses its own controls behind a large application shell.
 */
function registerPreviewInspectorRenderConditionDefinition(conditionId, metadata, schedule = true) {
  initializePreviewInspectorConditionState();
  initializePreviewInspectorConditionDefinitionState();
  if (
    typeof conditionId !== 'string' ||
    conditionId.length === 0 ||
    conditionId.length > 128
  ) return false;
  const normalized = normalizePreviewInspectorConditionMetadata(metadata);
  const definition = {
    ...normalized,
    id: conditionId,
    reached: false,
  };
  const definitions = previewInspectorSession.renderConditionDefinitions;
  if (
    !definitions.has(conditionId) &&
    definitions.size >= PREVIEW_INSPECTOR_RENDER_CONDITION_DEFINITION_LIMIT
  ) {
    if (!isPreviewInspectorSelectedConditionDefinition(definition)) return false;
    const evictable = [...definitions].find(([, candidate]) =>
      !isPreviewInspectorSelectedConditionDefinition(candidate));
    if (evictable === undefined) return false;
    definitions.delete(evictable[0]);
  }
  const previous = definitions.get(conditionId);
  const previousSignature = previous === undefined ? '' : JSON.stringify(previous);
  const nextSignature = JSON.stringify(definition);
  if (previousSignature === nextSignature) return false;
  definitions.set(conditionId, definition);
  if (schedule) schedulePreviewInspectorConditionRegistryRefresh();
  return true;
}

/**
 * Replaces one selected module's complete definition inventory after a build or hot source edit.
 *
 * The source identity and every item metadata path must agree. This prevents a malformed project
 * registration from deleting another module's controls while still allowing an empty batch to
 * remove branches that no longer exist in the edited file.
 */
function registerPreviewInspectorRenderConditionDefinitions(sourcePath, candidates) {
  initializePreviewInspectorConditionState();
  initializePreviewInspectorConditionDefinitionState();
  const normalizedSourcePath = normalizePreviewInspectorConditionDefinitionPath(sourcePath);
  if (
    normalizedSourcePath.length === 0 ||
    !Array.isArray(candidates) ||
    candidates.length > 128
  ) return false;
  const definitions = previewInspectorSession.renderConditionDefinitions;
  const admitted = candidates.filter((candidate) =>
    candidate !== null &&
    typeof candidate === 'object' &&
    typeof candidate.id === 'string' &&
    candidate.metadata !== null &&
    typeof candidate.metadata === 'object' &&
    matchesPreviewInspectorConditionDefinitionPath(
      normalizedSourcePath,
      candidate.metadata.sourcePath,
    ));
  const retainedIds = new Set(admitted.map((candidate) => candidate.id));
  let changed = false;
  for (const [conditionId, definition] of [...definitions]) {
    if (
      matchesPreviewInspectorConditionDefinitionPath(
        normalizedSourcePath,
        definition?.sourcePath,
      ) &&
      !retainedIds.has(conditionId)
    ) {
      definitions.delete(conditionId);
      changed = true;
    }
  }
  for (const candidate of admitted) {
    changed = registerPreviewInspectorRenderConditionDefinition(
      candidate.id,
      candidate.metadata,
      false,
    ) || changed;
  }
  if (changed) schedulePreviewInspectorConditionRegistryRefresh();
  return changed;
}

/** Returns metadata-only controls with pending explicit values but no invented authored value. */
function readPreviewInspectorRenderConditionDefinitions() {
  initializePreviewInspectorConditionState();
  initializePreviewInspectorConditionDefinitionState();
  const overrides = previewInspectorSession.renderConditionOverrides;
  return [...previewInspectorSession.renderConditionDefinitions.values()]
    .map((definition) => {
      const override = overrides.has(definition.id) ? overrides.get(definition.id) : undefined;
      return {
        ...definition,
        authoredEnabled: undefined,
        autoOverride: undefined,
        effectiveEnabled: typeof override === 'boolean' ? override : false,
        override,
        reached: false,
      };
    })
    .sort((left, right) =>
      left.sourcePath.localeCompare(right.sourcePath) ||
      (left.line ?? 0) - (right.line ?? 0) ||
      left.id.localeCompare(right.id));
}

/**
 * Merges definitions and evaluated records by ID while keeping the reached runtime record dominant.
 *
 * Target-guided DFS deliberately continues to call the live-only reader. This combined inventory is
 * reserved for user-facing component/scenario controls, where a pending manual choice is meaningful.
 */
function readPreviewInspectorControllableRenderConditions() {
  const merged = new Map(
    readPreviewInspectorRenderConditionDefinitions().map((definition) => [
      definition.id,
      definition,
    ]),
  );
  for (const condition of readPreviewInspectorRenderConditions()) {
    merged.set(condition.id, { ...condition, reached: true });
  }
  return [...merged.values()].sort((left, right) =>
    left.sourcePath.localeCompare(right.sourcePath) ||
    (left.line ?? 0) - (right.line ?? 0) ||
    left.id.localeCompare(right.id));
}

/** Reports whether an explicit branch ID is live or was statically registered by its module. */
function isPreviewInspectorKnownRenderCondition(conditionId) {
  initializePreviewInspectorConditionState();
  initializePreviewInspectorConditionDefinitionState();
  return previewInspectorSession.renderConditions.has(conditionId) ||
    previewInspectorSession.renderConditionDefinitions.has(conditionId);
}

/** Filters every truthy override that would replace a missing data receiver with Boolean true. */
function readPreviewInspectorApplicableConditionOverrides(
  conditionId, authoredValue, metadata, manualOverride, outcomeOverride, autoOverride,
) {
  if (metadata?.requiresAuthoredState === true) {
    const manualChanged = previewInspectorSession.renderConditionOverrides.delete(conditionId);
    previewInspectorSession.renderConditionAutoOverrides.delete(conditionId);
    if (manualChanged) schedulePreviewInspectorRenderOutcomeReconciliationPersistence();
    return { autoOverride: undefined, manualOverride: undefined, outcomeOverride: undefined };
  }
  const apply = (override) => {
    const unsafeTruthyData = override === true && !authoredValue &&
      typeof authoredValue !== 'boolean' && metadata?.kind !== 'overlay-visibility' &&
      metadata?.role !== 'overlay';
    return unsafeTruthyData ? undefined : override;
  };
  const applicableManualOverride = apply(manualOverride);
  if (manualOverride === true && applicableManualOverride === undefined) {
    previewInspectorSession.renderConditionOverrides.delete(conditionId);
    schedulePreviewInspectorRenderOutcomeReconciliationPersistence();
  }
  const unrelatedOverlay = isPreviewInspectorDetachedPageOverlayActivation(metadata, autoOverride);
  if (unrelatedOverlay) previewInspectorSession.renderConditionAutoOverrides.delete(conditionId);
  return {
    autoOverride: unrelatedOverlay ? undefined : apply(autoOverride),
    manualOverride: applicableManualOverride,
    outcomeOverride: apply(outcomeOverride),
  };
}

/** Allows target-guided true only for Boolean or compiler-proven overlay visibility conditions. */
function canPreviewInspectorTargetGuideCondition(record, enabled) {
  return record?.requiresAuthoredState !== true &&
    !isPreviewInspectorDetachedPageOverlayActivation(record, enabled) &&
    !isPreviewInspectorOutputHidingEmptinessContinuation(record, enabled) &&
    (enabled !== true || record?.authoredEnabled !== false ||
    record?.authoredValueKind === 'boolean' || record?.kind === 'overlay-visibility' ||
    record?.role === 'overlay');
}

/**
 * A compiler-detached overlay target already has its own mount beside the authored page. Opening
 * a different source's dormant dialog cannot reach that target; it can only obscure it with an
 * empty shell while its selected entity remains null. Manual controls and authored opens stay live.
 */
function isPreviewInspectorDetachedPageOverlayActivation(record, enabled) {
  if (enabled !== true || !(record?.kind === 'overlay-visibility' || record?.role === 'overlay')) {
    return false;
  }
  const key = record?.reachabilityKey ?? previewInspectorSession.activeTargetReachabilityKey;
  const state = previewInspectorSession.targetReachabilityByKey?.get?.(key);
  if (state?.detachedTargetPlacement !== 'overlay-sibling' ||
    typeof state.targetSourcePath !== 'string' || typeof record.sourcePath !== 'string') return false;
  return !matchesPreviewInspectorConditionDefinitionPath(record.sourcePath, state.targetSourcePath);
}

/** One collection length read such as "orders.length", "data?.items?.length", or "rows[0].length". */
const PREVIEW_INSPECTOR_EMPTINESS_LENGTH =
  '[A-Za-z_$][\\w$]*(?:\\??\\.[A-Za-z_$][\\w$]*|(?:\\?\\.)?\\[[^\\]]*\\])*\\??\\.length';
const PREVIEW_INSPECTOR_EMPTY_WHEN_TRUE_PATTERNS = [
  '^LEN(?:===|==)0$', '^LEN<1$', '^LEN<=0$', '^0(?:===|==)LEN$', '^!\\(?LEN\\)?$',
].map((pattern) =>
  new RegExp(pattern.replaceAll('LEN', () => PREVIEW_INSPECTOR_EMPTINESS_LENGTH), 'u'));
const PREVIEW_INSPECTOR_FILLED_WHEN_TRUE_PATTERNS = [
  '^LEN(?:>0|!==0|!=0|>=1)$', '^0<LEN$', '^LEN$', '^!!\\(?LEN\\)?$',
].map((pattern) =>
  new RegExp(pattern.replaceAll('LEN', () => PREVIEW_INSPECTOR_EMPTINESS_LENGTH), 'u'));

/** Reads whether a whole authored condition is true for an empty collection (undefined: not one). */
function readPreviewInspectorEmptinessGuardPolarity(expression) {
  if (typeof expression !== 'string' || expression.length > 240) return undefined;
  let text = expression.replace(/\s+/gu, '');
  while (text.startsWith('(') && text.endsWith(')')) text = text.slice(1, -1);
  if (PREVIEW_INSPECTOR_EMPTY_WHEN_TRUE_PATTERNS.some((pattern) => pattern.test(text))) return true;
  if (PREVIEW_INSPECTOR_FILLED_WHEN_TRUE_PATTERNS.some((pattern) => pattern.test(text))) return false;
  return undefined;
}

/**
 * Refuses to push the target's own collection-emptiness guard ("orders.length === 0") onto its
 * non-empty branch while the target already shows output. Forcing it adds no rows; it swaps the
 * visible empty state for an empty list, so the corridor loses its output and stalls. Rows must come
 * from data instead (requirement search, or the REST row fill once the target is reached).
 */
function isPreviewInspectorOutputHidingEmptinessContinuation(record, enabled) {
  if (typeof enabled !== 'boolean') return false;
  const emptyWhenTrue = readPreviewInspectorEmptinessGuardPolarity(record?.authoredExpression);
  if (emptyWhenTrue === undefined) return false;
  const emptyWhenEnabled = record.authoredExpressionNegated === true ? !emptyWhenTrue : emptyWhenTrue;
  if (enabled === emptyWhenEnabled) return false;
  const key = typeof record.reachabilityKey === 'string'
    ? record.reachabilityKey
    : previewInspectorSession.activeTargetReachabilityKey;
  const state = previewInspectorSession.targetReachabilityByKey?.get?.(key);
  return state?.targetHasOutput === true &&
    matchesPreviewInspectorConditionDefinitionPath(record.sourcePath, state.targetSourcePath);
}
`;
}
