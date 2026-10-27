/** Generates authored render-choice metadata normalization and bounded branch selection. */

/** Returns source concatenated at its original lexical position; declarations share the session scope. */
export function createPreviewInspectorRenderChoiceRuntimeSource(): string {
  return String.raw`/** Bounds untrusted compiler metadata before it is retained in the live Inspector registry. */
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
  const expressionFingerprint = readText('expressionFingerprint');
  const kind = ['early-return', 'logical-and', 'overlay-visibility', 'ternary'].includes(source.kind)
    ? source.kind
    : 'logical-and';
  const scalarExpression = normalizePreviewInspectorConditionScalarExpression(
    source.scalarExpression,
  );
  return {
    authoredExpression: readText('authoredExpression', readText('expression', 'conditional render')),
    ...(source.authoredExpressionNegated === true ? { authoredExpressionNegated: true } : {}),
    column: Number.isSafeInteger(source.column) && source.column > 0 ? source.column : undefined,
    expression: readText('expression', 'conditional render'),
    ...(expressionFingerprint.length === 0 ? {} : { expressionFingerprint }),
    ...(fallbackBranch === undefined ? {} : { fallbackBranch }),
    falsyLabel: readText('falsyLabel', 'hidden'),
    kind,
    line: Number.isSafeInteger(source.line) && source.line > 0 ? source.line : undefined,
    ownerName: readText('ownerName'),
    runtimeOwnerName: readText('runtimeOwnerName'),
    sourcePath: readText('sourcePath'),
    ...(source.requiresAuthoredState === true ? { requiresAuthoredState: true } : {}),
    ...(source.renderValueHelper === true ? { renderValueHelper: true } : {}),
    ...(source.renderValueHelper === true ? { targetCallName: readText('targetCallName') } : {}),
    ...(source.synchronousContinuation === true ? { synchronousContinuation: true } : {}),
    ...(['navigation', 'overlay'].includes(source.role) ? { role: source.role } : {}),
    ...(scalarExpression === undefined ? {} : { scalarExpression }),
    ...(source.stateBound === true ? { stateBound: true } : {}),
    ...(targetBranch === undefined ? {} : { targetBranch }),
    ...(source.targetBranchEvidence === 'selected-target' ? { targetBranchEvidence: 'selected-target' } : {}),
    truthyLabel: readText('truthyLabel', 'visible'),
  };
}

/** Bounds compiler-issued switch/JSX-array metadata and verifies selectable primitive branches. */
function normalizePreviewInspectorRenderChoiceMetadata(choiceId, metadata) {
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
    const observedValueKey = typeof rawBranch.observedValueKey === 'string'
      ? rawBranch.observedValueKey.slice(0, 64)
      : '';
    const observed = observedValueKey.length === 0
      ? undefined
      : previewInspectorSession.renderChoiceObservedValues.get(choiceId + '\0' + id);
    const ownsObservedValue = observed?.key === observedValueKey;
    const value = ownsValue ? rawBranch.value : observed?.value;
    const literalSupported = ownsValue && (
      value === null ||
      typeof value === 'string' ||
      typeof value === 'boolean' ||
      (typeof value === 'number' && Number.isFinite(value))
    ) || ownsObservedValue && (
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
      ...(observedValueKey.length === 0 ? {} : { observedValueKey }),
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
    expression: readText('expression', 'render choice'),
    kind: source.kind === 'array-index' ? 'array-index' : 'switch',
    line: Number.isSafeInteger(source.line) && source.line > 0 ? source.line : undefined,
    ownerName: readText('ownerName'),
    sourcePath: readText('sourcePath'),
  };
}

/** Normalizes one component/path label before matching a render choice to the selected file. */
function normalizePreviewInspectorTargetChoiceName(value) {
  const text = typeof value === 'string' ? value.trim() : '';
  const withoutExport = text.replace(/\s*\((?:default|[^)]+ export)\)\s*$/iu, '');
  return withoutExport.split('.').at(-1)?.replace(/[<>]/gu, '') ?? '';
}

/**
 * Selects the sole primitive branch whose JSX component occurs on the active root-to-file path.
 *
 * This resolves patterns such as steps[currentStep] after an earlier return gate is opened. It is
 * deliberately lower priority than authored scenario and manual choices and requires one unique
 * branch, so ambiguous repeated components remain user-controlled.
 */
function readPreviewInspectorTargetGuidedRenderChoiceBranch(metadata) {
  const key = previewInspectorSession.activeTargetReachabilityKey;
  const state = typeof key === 'string'
    ? previewInspectorSession.targetReachabilityByKey?.get?.(key)
    : undefined;
  if (
    state === undefined ||
    state.directTarget === true ||
    previewInspectorSession.fallbackValuesEnabled !== true
  ) {
    return undefined;
  }
  const targetNames = new Set(
    (state.applicationPath ?? [])
      .map(normalizePreviewInspectorTargetChoiceName)
      .filter((name) => name.length > 0),
  );
  const matches = (metadata?.branches ?? []).filter((branch) =>
    branch.selectable === true &&
    (branch.calls ?? []).some((call) =>
      targetNames.has(normalizePreviewInspectorTargetChoiceName(call))),
  );
  return matches.length === 1 ? matches[0] : undefined;
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
 * Records a primitive static-member case value while the authored switch evaluates that case.
 * The wrapper returns the exact value unchanged; a coalesced retry lets the discriminant resolver
 * select a target branch on the next render without evaluating any project expression early.
 */
function observePreviewInspectorRenderChoiceCase(choiceId, branchId, valueKey, value) {
  initializePreviewInspectorConditionState();
  const validValue = value === null || typeof value === 'string' || typeof value === 'boolean' ||
    (typeof value === 'number' && Number.isFinite(value));
  if (
    typeof choiceId !== 'string' || choiceId.length === 0 || choiceId.length > 128 ||
    typeof branchId !== 'string' || branchId.length === 0 || branchId.length > 160 ||
    typeof valueKey !== 'string' || valueKey.length === 0 || valueKey.length > 64 ||
    !validValue
  ) {
    return value;
  }
  const identity = choiceId + '\0' + branchId;
  const observedValues = previewInspectorSession.renderChoiceObservedValues;
  const previous = observedValues.get(identity);
  if (previous?.key === valueKey && Object.is(previous.value, value)) return value;
  if (!observedValues.has(identity) && observedValues.size >= PREVIEW_INSPECTOR_RENDER_CONDITION_LIMIT * 2) {
    return value;
  }
  observedValues.set(identity, { key: valueKey, value });
  schedulePreviewInspectorCommitRefresh();
  return value;
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
  const normalizedMetadata = normalizePreviewInspectorRenderChoiceMetadata(choiceId, metadata);
  const authoredBranchId = readPreviewInspectorAuthoredChoiceBranchId(
    authoredValue,
    normalizedMetadata.branches,
  );
  const overrideBranchId = previewInspectorSession.renderChoiceOverrides.get(choiceId);
  let overrideBranch = normalizedMetadata.branches.find(
    (branch) => branch.id === overrideBranchId && branch.selectable === true,
  );
  if (typeof overrideBranchId === 'string' && overrideBranch === undefined) {
    previewInspectorSession.renderChoiceOverrides.delete(choiceId);
  }
  const outcomeBranch = typeof readPreviewInspectorRenderOutcomeChoiceBranch === 'function'
    ? readPreviewInspectorRenderOutcomeChoiceBranch(normalizedMetadata)
    : undefined;
  if (
    outcomeBranch !== undefined &&
    reconcilePreviewInspectorManualOverrideWithOutcome(
      previewInspectorSession.renderChoiceOverrides,
      choiceId,
      outcomeBranch,
    )
  ) {
    overrideBranch = undefined;
  }
  const targetGuidedBranch =
    outcomeBranch === undefined && overrideBranch === undefined
      ? readPreviewInspectorTargetGuidedRenderChoiceBranch(normalizedMetadata)
      : undefined;
  const selectedBranch = outcomeBranch ?? overrideBranch ?? targetGuidedBranch;
  const effectiveBranchId = selectedBranch?.id ?? authoredBranchId;
  const metadataSignature = JSON.stringify(normalizedMetadata);
  const records = previewInspectorSession.renderChoices;
  const previous = records.get(choiceId);
  const nextRecord = {
    ...normalizedMetadata,
    authoredBranchId,
    effectiveBranchId,
    id: choiceId,
    metadataSignature,
    ...(targetGuidedBranch === undefined ? {} : { targetGuidedBranchId: targetGuidedBranch.id }),
  };
  if (records.has(choiceId) || records.size < PREVIEW_INSPECTOR_RENDER_CONDITION_LIMIT) {
    records.set(choiceId, nextRecord);
    if (didPreviewInspectorRenderChoiceChange(previous, nextRecord)) {
      schedulePreviewInspectorConditionRegistryRefresh();
    }
  }
  if (selectedBranch === undefined) return authoredValue;
  if (selectedBranch.default === true) {
    return Symbol('React Preview forced switch default');
  }
  return selectedBranch.value;
}

`;
}
