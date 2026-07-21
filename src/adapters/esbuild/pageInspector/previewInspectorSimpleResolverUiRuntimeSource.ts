/**
 * Generates the deliberately small, user-facing Preview Inspector resolver.
 *
 * The full component/blocker graphs remain useful as diagnostics, but they expose implementation
 * details that do not represent independent user decisions. This projection reduces that graph to
 * two stable surfaces: missing preview data and rendered-component choices. Logical-AND JSX guards
 * appear as boolean switches inside the component surface; other runtime conditions, reachability
 * probes, and source errors without missing-property evidence stay in a read-only automatic summary.
 */

/**
 * Creates browser-side model and React helpers for the compact resolver.
 *
 * Expected lexical bindings include React, `PreviewInspectorDevtoolsButton`, the existing blocker
 * detail component, static render-outcome helpers, non-committing data/fallback/prop mutations, and
 * shared persistence/render schedulers. The pure model accepts its inputs as arguments so it can be
 * tested without React or a project runtime.
 *
 * @returns Plain JavaScript concatenated after blocker and render-outcome runtime helpers.
 */
export function createPreviewInspectorSimpleResolverUiRuntimeSource(): string {
  return String.raw`
const PREVIEW_INSPECTOR_SIMPLE_RESOLVER_ITEM_LIMIT = 64;

/** Returns one blocker node from either a graph step or an already-normalized tree node. */
function readPreviewInspectorSimpleResolverNode(candidate) {
  const node = candidate?.node ?? candidate;
  return node !== null && typeof node === 'object' ? node : undefined;
}

/** Excludes retained blocker history after the corresponding preview requirement has cleared. */
function isPreviewInspectorSimpleResolverCurrentCandidate(candidate) {
  return candidate?.current !== false &&
    candidate?.resolution !== 'resolved' &&
    candidate?.status !== 'resolved';
}

/** Normalizes inferred property paths and removes duplicates without changing discovery order. */
function readPreviewInspectorSimpleResolverRequiredPaths(node) {
  const blocker = node?.blocker;
  const candidates = [
    blocker?.targetPropRequiredPaths,
    blocker?.requiredPaths,
    node?.props?.requiredPaths,
    node?.props?.generatedPaths,
  ];
  const paths = [];
  const seen = new Set();
  for (const candidate of candidates) {
    if (!Array.isArray(candidate)) continue;
    for (const path of candidate) {
      if (typeof path !== 'string') continue;
      const normalized = path.trim();
      if (normalized.length === 0 || seen.has(normalized)) continue;
      seen.add(normalized);
      paths.push(normalized);
    }
  }
  return paths;
}

/**
 * Creates one stable data action or returns undefined for diagnostics that cannot be data-filled.
 * Hook fallbacks and backend requests own fill operations even before a property read is observed.
 * Target errors need an explicit required path so source errors never acquire a fake "fix" button.
 * Reachability remains an automatic page-corridor concern and never becomes a third user choice.
 */
function classifyPreviewInspectorSimpleResolverDataItem(candidate) {
  if (!isPreviewInspectorSimpleResolverCurrentCandidate(candidate)) return undefined;
  const node = readPreviewInspectorSimpleResolverNode(candidate);
  const kind = node?.blockerKind;
  if (!['runtime-fallback', 'data-request', 'target-error'].includes(kind)) {
    return undefined;
  }
  const allRequiredPaths = readPreviewInspectorSimpleResolverRequiredPaths(node);
  const targetPropPathSet = new Set(
    Array.isArray(node?.blocker?.targetPropRequiredPaths)
      ? node.blocker.targetPropRequiredPaths
          .filter((path) => typeof path === 'string')
          .map((path) => path.trim())
          .filter((path) => path.length > 0)
      : [],
  );
  const requiredPaths = kind === 'target-error'
    ? allRequiredPaths.filter((path) => targetPropPathSet.has(path))
    : allRequiredPaths;
  if (kind === 'target-error' && requiredPaths.length === 0) {
    return undefined;
  }
  const blockerId = node?.blockerId ?? node?.blocker?.id ?? node?.id;
  const identity = typeof blockerId === 'string' && blockerId.length > 0
    ? kind + ':' + blockerId
    : [kind, node?.source?.path ?? '', requiredPaths.join('|'), node?.name ?? ''].join(':');
  return {
    id: identity,
    kind,
    label: typeof node?.name === 'string' && node.name.length > 0
      ? node.name
      : kind === 'data-request' ? 'Backend data' : 'Missing preview value',
    node,
    requiredPaths,
  };
}

/** Labels a read-only automatic diagnostic without offering an action that cannot be proven safe. */
function classifyPreviewInspectorSimpleResolverDiagnostic(candidate) {
  if (!isPreviewInspectorSimpleResolverCurrentCandidate(candidate)) return undefined;
  const node = readPreviewInspectorSimpleResolverNode(candidate);
  if (node === undefined) return undefined;
  if (typeof isPreviewInspectorConditionNode === 'function' && isPreviewInspectorConditionNode(node)) {
    if (node?.condition?.kind === 'logical-and') return undefined;
    return { id: 'condition:' + node.id, kind: 'condition', label: 'Render condition' };
  }
  const kind = node.blockerKind;
  if (kind === 'target-error') {
    return {
      id: 'diagnostic:' + String(node.blockerId ?? node.id),
      kind: 'target-error',
      label: 'Component error retained in Console',
    };
  }
  if (kind === 'target-reachability') {
    return {
      id: 'diagnostic:' + String(node.blockerId ?? node.id),
      kind: 'target-reachability',
      label: 'Page reachability is checked automatically',
    };
  }
  if (
    typeof kind === 'string' &&
    !['runtime-fallback', 'data-request'].includes(kind)
  ) {
    return {
      id: 'diagnostic:' + String(node.blockerId ?? node.id),
      kind,
      label: 'Runtime diagnostic retained in Console',
    };
  }
  return undefined;
}

/** Collects bounded unique records while retaining the first source-backed occurrence. */
function dedupePreviewInspectorSimpleResolverItems(
  items,
  limit = PREVIEW_INSPECTOR_SIMPLE_RESOLVER_ITEM_LIMIT,
) {
  const unique = [];
  const seen = new Set();
  for (const item of items) {
    if (item === undefined || seen.has(item.id)) continue;
    seen.add(item.id);
    unique.push(item);
    if (unique.length >= limit) break;
  }
  return unique;
}

/** Reads all actionable and diagnostic nodes from the full graph without exposing graph topology. */
function readPreviewInspectorSimpleResolverCandidates(flow) {
  const graphNodes = Array.isArray(flow?.graphNodes) ? flow.graphNodes : [];
  const steps = Array.isArray(flow?.actionableSteps)
    ? flow.actionableSteps
    : Array.isArray(flow?.steps) ? flow.steps : [];
  return [...steps, ...graphNodes].slice(0, PREVIEW_INSPECTOR_SIMPLE_RESOLVER_ITEM_LIMIT * 2);
}

/** Reads the full-expression identity emitted by current compilers, including nested descriptors. */
function readPreviewInspectorLogicalAndExpressionFingerprint(condition) {
  const fingerprint = condition?.expressionFingerprint ?? condition?.source?.expressionFingerprint;
  return typeof fingerprint === 'string' && fingerprint.length > 0 ? fingerprint : undefined;
}

/** Creates the bounded-expression identity retained for mixed-version and legacy descriptors. */
function createPreviewInspectorLogicalAndLegacySourceKey(condition) {
  return [
    condition?.sourcePath ?? condition?.source?.path ?? '',
    condition?.line ?? condition?.source?.line ?? '',
    condition?.column ?? condition?.source?.column ?? '',
    condition?.authoredExpression ?? condition?.expression ?? '',
  ].join(':');
}

/** Creates one source identity, preferring the collision-resistant full-expression fingerprint. */
function createPreviewInspectorLogicalAndSourceKey(condition) {
  const fingerprint = readPreviewInspectorLogicalAndExpressionFingerprint(condition);
  return fingerprint === undefined
    ? createPreviewInspectorLogicalAndLegacySourceKey(condition)
    : [
        condition?.sourcePath ?? condition?.source?.path ?? '',
        condition?.line ?? condition?.source?.line ?? '',
        condition?.column ?? condition?.source?.column ?? '',
        'fingerprint=' + fingerprint,
      ].join(':');
}

/** Uses compiler chain metadata when available and falls back to one legacy source identity. */
function createPreviewInspectorLogicalAndGuardKey(condition) {
  return typeof condition?.logicalAndGroupId === 'string' &&
    Number.isSafeInteger(condition?.logicalAndGuardIndex)
    ? condition.logicalAndGroupId + ':' + String(condition.logicalAndGuardIndex)
    : 'source:' + createPreviewInspectorLogicalAndSourceKey(condition);
}

/**
 * Projects every static logical-AND guard and overlays a runtime control when that guard was reached.
 * A later short-circuited guard remains visible but read-only until JavaScript evaluates its resolver.
 */
function readPreviewInspectorSimpleResolverBooleanSwitches(outcomes = [], conditions = []) {
  const runtimeBySource = new Map();
  const runtimeByLegacySource = new Map();
  for (const condition of Array.isArray(conditions) ? conditions : []) {
    if (condition?.kind !== 'logical-and' || typeof condition?.id !== 'string') continue;
    runtimeBySource.set(createPreviewInspectorLogicalAndSourceKey(condition), condition);
    const legacyKey = createPreviewInspectorLogicalAndLegacySourceKey(condition);
    const legacyRecords = runtimeByLegacySource.get(legacyKey) ?? [];
    legacyRecords.push(condition);
    runtimeByLegacySource.set(legacyKey, legacyRecords);
  }
  const staticGuards = new Map();
  for (const outcome of Array.isArray(outcomes) ? outcomes : []) {
    for (const condition of Array.isArray(outcome?.conditions) ? outcome.conditions : []) {
      if (condition?.kind !== 'logical-and') continue;
      const guardKey = createPreviewInspectorLogicalAndGuardKey(condition);
      const previous = staticGuards.get(guardKey);
      const names = Array.isArray(outcome?.componentNames) ? outcome.componentNames : [];
      staticGuards.set(guardKey, {
        condition: previous?.condition ?? condition,
        guardKey,
        label: previous?.label ?? (names.length > 0 ? names.slice(0, 4).join(', ') : undefined),
        legacySourceKey: createPreviewInspectorLogicalAndLegacySourceKey(condition),
        sourceKey: createPreviewInspectorLogicalAndSourceKey(condition),
      });
    }
  }
  const switches = [];
  const matchedRuntimeIds = new Set();
  for (const entry of staticGuards.values()) {
    const exactRuntime = runtimeBySource.get(entry.sourceKey);
    const staticFingerprint = readPreviewInspectorLogicalAndExpressionFingerprint(entry.condition);
    const legacyRuntime = (runtimeByLegacySource.get(entry.legacySourceKey) ?? []).find((candidate) =>
      staticFingerprint === undefined ||
      readPreviewInspectorLogicalAndExpressionFingerprint(candidate) === undefined);
    const runtime = exactRuntime ?? legacyRuntime;
    if (typeof runtime?.id === 'string') matchedRuntimeIds.add(runtime.id);
    switches.push(createPreviewInspectorSimpleResolverBooleanSwitch(entry, runtime));
  }
  for (const [sourceKey, runtime] of runtimeBySource) {
    if (matchedRuntimeIds.has(runtime.id)) continue;
    switches.push(createPreviewInspectorSimpleResolverBooleanSwitch({
      condition: runtime,
      guardKey: 'runtime:' + runtime.id,
      sourceKey,
    }, runtime));
  }
  return switches.slice(0, PREVIEW_INSPECTOR_SIMPLE_RESOLVER_ITEM_LIMIT);
}

/** Combines one static guard with its optional runtime resolver without inventing an editable ID. */
function createPreviewInspectorSimpleResolverBooleanSwitch(entry, runtime) {
  const condition = runtime ?? entry.condition;
  const reached = runtime !== undefined && typeof runtime.id === 'string' && runtime.id.length > 0;
  return {
    authoredEnabled: reached && runtime.authoredEnabled === true,
    condition: runtime,
    conditionId: reached ? runtime.id : undefined,
    enabled: reached && runtime.effectiveEnabled === true,
    expression: typeof condition?.expression === 'string'
      ? condition.expression
      : 'JSX visibility',
    forced: reached && typeof runtime.override === 'boolean',
    guardCount: entry.condition?.logicalAndGuardCount,
    guardIndex: entry.condition?.logicalAndGuardIndex,
    id: 'logical-and:' + entry.guardKey,
    label: typeof runtime?.truthyLabel === 'string' && runtime.truthyLabel.length > 0
      ? runtime.truthyLabel
      : entry.label ?? 'JSX branch',
    reached,
    sourceKey: entry.sourceKey,
    targetGuided: reached && typeof runtime.autoOverride === 'boolean',
  };
}

/** Creates a branch identity after removing logical-AND edges now represented as switches. */
function createPreviewInspectorNonLogicalOutcomeKey(outcome) {
  const conditions = Array.isArray(outcome?.conditions) ? outcome.conditions : [];
  const logicalConditions = conditions.filter((condition) => condition?.kind === 'logical-and');
  if (logicalConditions.length === 0) return 'outcome:' + String(outcome?.id ?? '');
  const logicalGroups = [...new Set(
    logicalConditions.map((condition) =>
      typeof condition?.logicalAndGroupId === 'string'
        ? condition.logicalAndGroupId
        : 'source:' + createPreviewInspectorLogicalAndSourceKey(condition)),
  )].sort();
  const remaining = conditions
    .filter((condition) => condition?.kind !== 'logical-and')
    .map((condition) => [
      condition?.kind,
      condition?.sourcePath ?? condition?.source?.path,
      condition?.line ?? condition?.source?.line,
      condition?.column ?? condition?.source?.column,
      condition?.expressionFingerprint ?? condition?.expression,
      condition?.branch ?? condition?.arm,
      condition?.value,
    ]);
  return 'return:' + String(outcome?.exportName ?? '') + ':' + JSON.stringify([
    logicalGroups,
    remaining,
  ]);
}

/** Identifies an empty result caused only after one logical-AND guard short-circuited. */
function isPreviewInspectorLogicalAndHiddenOutcome(outcome) {
  return outcome?.kind === 'empty' &&
    Array.isArray(outcome?.conditions) &&
    outcome.conditions.some((condition) =>
      condition?.kind === 'logical-and' &&
      (condition?.branch ?? condition?.arm) === 'falsy');
}

/**
 * Collapses the combinatorial visible/hidden variants of independent JSX switches into one return.
 * The representative ID still selects the same non-logical return path; logical edges are controlled
 * separately and therefore no longer multiply the component-return dropdown.
 */
function collapsePreviewInspectorLogicalAndOutcomes(outcomes = []) {
  const boundedOutcomes = Array.isArray(outcomes) ? outcomes : [];
  const exportsWithVisibleResults = new Set(
    boundedOutcomes
      .filter((outcome) => !isPreviewInspectorLogicalAndHiddenOutcome(outcome))
      .map((outcome) => outcome?.exportName),
  );
  const groups = new Map();
  for (const outcome of boundedOutcomes) {
    if (outcome === null || typeof outcome !== 'object' || typeof outcome.id !== 'string') continue;
    const hidden = isPreviewInspectorLogicalAndHiddenOutcome(outcome);
    const hasVisibleResult = exportsWithVisibleResults.has(outcome.exportName);
    const key = hidden && !hasVisibleResult
      ? 'only-empty:' + String(outcome.exportName ?? '')
      : createPreviewInspectorNonLogicalOutcomeKey(outcome);
    const group = groups.get(key) ?? { members: [], names: [], switchKeys: new Set() };
    group.members.push(outcome);
    for (const name of Array.isArray(outcome.componentNames) ? outcome.componentNames : []) {
      if (typeof name === 'string' && !group.names.includes(name)) group.names.push(name);
    }
    for (const condition of Array.isArray(outcome.conditions) ? outcome.conditions : []) {
      if (condition?.kind === 'logical-and') {
        group.switchKeys.add(createPreviewInspectorLogicalAndSourceKey(condition));
      }
    }
    groups.set(key, group);
  }
  return [...groups.values()]
    .filter((group) => {
      const exportName = group.members[0]?.exportName;
      return !exportsWithVisibleResults.has(exportName) ||
        group.members.some((outcome) => !isPreviewInspectorLogicalAndHiddenOutcome(outcome));
    })
    .map((group) => {
      const representative = [...group.members].sort((left, right) =>
        (right.componentNames?.length ?? 0) - (left.componentNames?.length ?? 0))[0];
      if (representative === undefined) return undefined;
      const switchCount = group.switchKeys.size;
      const label = switchCount === 0
        ? representative.label
        : (group.names.length > 0 ? group.names.join(', ') : 'Rendered JSX') +
          ' · ' + String(switchCount) + ' optional switch' + (switchCount === 1 ? '' : 'es');
      return {
        ...representative,
        label,
        memberIds: group.members.map((member) => member.id),
        switchCount,
      };
    })
    .filter((outcome) => outcome !== undefined)
    .slice(0, PREVIEW_INSPECTOR_SIMPLE_RESOLVER_ITEM_LIMIT);
}

/**
 * Projects arbitrary blocker graph complexity into exactly two stable user-facing categories.
 * The surfaces array is intentionally always data followed by render-choice; mode/actionable flags decide
 * whether the UI shows a button, a single select, or only an automatic status sentence.
 */
function createPreviewInspectorSimpleResolverModel(flow, outcomes = [], conditions = []) {
  const candidates = readPreviewInspectorSimpleResolverCandidates(flow);
  const classifiedDataItems = candidates.map(classifyPreviewInspectorSimpleResolverDataItem);
  const allDataItems = dedupePreviewInspectorSimpleResolverItems(
    classifiedDataItems,
    PREVIEW_INSPECTOR_SIMPLE_RESOLVER_ITEM_LIMIT * 2,
  );
  const dataItems = allDataItems.slice(0, PREVIEW_INSPECTOR_SIMPLE_RESOLVER_ITEM_LIMIT);
  const diagnostics = dedupePreviewInspectorSimpleResolverItems(
    candidates
      .filter((candidate) => classifyPreviewInspectorSimpleResolverDataItem(candidate) === undefined)
      .map(classifyPreviewInspectorSimpleResolverDiagnostic),
  );
  const normalizedOutcomes = collapsePreviewInspectorLogicalAndOutcomes(outcomes);
  const booleanSwitches = readPreviewInspectorSimpleResolverBooleanSwitches(outcomes, conditions);
  const data = {
    actionable: allDataItems.length > 0,
    items: dataItems,
    kind: 'data',
    policies: {
      dataRequest: allDataItems.some((item) => item.kind === 'data-request'),
      runtimeFallback: allDataItems.some((item) => item.kind === 'runtime-fallback'),
      targetFailure: allDataItems.find((item) => item.kind === 'target-error'),
    },
    requiredPaths: [...new Set(dataItems.flatMap((item) => item.requiredPaths))],
    truncated: allDataItems.length > dataItems.length,
  };
  const renderChoice = {
    actionable: normalizedOutcomes.length > 1 || booleanSwitches.length > 0,
    kind: 'render-choice',
    mode: normalizedOutcomes.length === 0
      ? 'automatic'
      : normalizedOutcomes.length === 1 ? 'fixed' : 'selectable',
    outcomes: normalizedOutcomes,
    switches: booleanSwitches,
  };
  return {
    automatic: {
        diagnostics,
        summary: [
          diagnostics.length > 0
          ? String(diagnostics.length) +
            ' runtime diagnostic(s) require no setup choice; see Console if rendering still fails'
          : 'Runtime guards are handled automatically',
        normalizedOutcomes.length === 0
          ? 'No alternate JSX return was found'
          : normalizedOutcomes.length === 1
            ? 'One source-proven JSX return is fixed automatically'
            : String(normalizedOutcomes.length) + ' source-proven JSX returns are available',
        booleanSwitches.length === 0
          ? 'No evaluated JSX boolean switch is available'
          : String(booleanSwitches.length) + ' JSX boolean switch(es) are available',
      ],
    },
    data,
    renderChoice,
    surfaces: [data, renderChoice],
  };
}

/**
 * Enables each global preview-data policy and smart-fills at most one exact target prop error as one
 * transaction. Revisions are advanced by non-committing adapters before this function persists and
 * notifies once, regardless of the number of equivalent runtime observations.
 */
function fillPreviewInspectorSimpleResolverData(model) {
  if (model?.data?.actionable !== true) return false;
  let changed = false;
  if (model.data.policies.runtimeFallback) {
    changed = setPreviewInspectorFallbackValuesEnabled(true, false) || changed;
  }
  if (model.data.policies.dataRequest) {
    changed = setPreviewInspectorDataAutoEnabled(true, false) || changed;
  }
  const targetFailure = model.data.policies.targetFailure;
  if (targetFailure !== undefined) {
    changed = smartFillPreviewInspectorTargetFailure(targetFailure.node.blocker, false) || changed;
  }
  if (changed) {
    persistPreviewInspectorState();
    notifyPreviewInspector();
    schedulePreviewInspectorHighlight();
    schedulePreviewInspectorTreeRefresh();
    schedulePreviewInspectorCommitRefresh();
  }
  return changed;
}

/** Renders the sole data card and exposes one lazy manual editor only in advanced diagnostics. */
function PreviewInspectorSimpleResolverData({ model, showManualEditor = false }) {
  const paths = model.data.requiredPaths;
  const [manualOpen, setManualOpen] = React.useState(false);
  const [selectedManualItemId, setSelectedManualItemId] = React.useState(
    () => model.data.items[0]?.id ?? '',
  );
  const selectedManualItem = model.data.items.find(
    (item) => item.id === selectedManualItemId,
  ) ?? model.data.items[0];
  return React.createElement(
    'section',
    { 'aria-label': 'Preview data', className: 'rpi-simple-resolver-card' },
    React.createElement('strong', undefined, 'Preview data'),
    React.createElement(
      'span',
      { className: 'rpi-note' },
      model.data.actionable
        ? String(model.data.items.length) + ' missing preview value(s)' +
          (paths.length > 0 ? ' · ' + paths.slice(0, 6).join(', ') : '') +
          (model.data.truncated ? ' · additional values handled automatically' : '')
        : 'No missing backend or component value requires input.',
    ),
    model.data.actionable && showManualEditor
      ? React.createElement(
          PreviewInspectorDevtoolsButton,
          { onClick: () => fillPreviewInspectorSimpleResolverData(model) },
          'Fill automatically',
        )
      : undefined,
    model.data.actionable
      ? React.createElement(
          'details',
          {
            className: 'rpi-simple-resolver-details',
            onToggle: (event) => setManualOpen(event.currentTarget.open),
            open: manualOpen,
          },
          React.createElement('summary', undefined, 'Edit values manually'),
          manualOpen && selectedManualItem !== undefined
            ? React.createElement(
                React.Fragment,
                undefined,
                model.data.items.length > 1
                  ? React.createElement(
                      'select',
                      {
                        'aria-label': 'Preview value to edit',
                        className: 'rpi-select',
                        onChange: (event) => setSelectedManualItemId(event.target.value),
                        value: selectedManualItem.id,
                      },
                      model.data.items.map((item) => React.createElement(
                        'option',
                        { key: item.id, value: item.id },
                        item.label,
                      )),
                    )
                  : undefined,
                React.createElement(
                  'section',
                  { className: 'rpi-simple-resolver-manual-item' },
                  React.createElement('strong', undefined, selectedManualItem.label),
                  React.createElement(PreviewInspectorBlockerDetail, {
                    node: selectedManualItem.node,
                  }),
                ),
              )
            : undefined,
        )
      : undefined,
  );
}

/** Renders one native Boolean switch for a JSX branch while preserving authored reset semantics. */
function PreviewInspectorSimpleResolverBooleanSwitch({ item }) {
  return React.createElement(
    'div',
    { className: 'rpi-simple-resolver-switch' },
    React.createElement(
      'button',
      {
        'aria-checked': item.enabled,
        'aria-disabled': item.reached !== true,
        className: 'rpi-button',
        disabled: item.reached !== true,
        onClick: () => item.reached === true && typeof item.conditionId === 'string'
          ? setPreviewInspectorRenderConditionOverride(item.conditionId, !item.enabled)
          : false,
        role: 'switch',
        title: item.reached === true
          ? 'Toggle the JSX mounted by this logical AND condition'
          : 'Not reached yet; an earlier logical AND guard short-circuited evaluation',
        type: 'button',
      },
      item.reached === true ? (item.enabled ? 'On' : 'Off') : 'Not reached yet',
    ),
    React.createElement(
      'span',
      { className: 'rpi-simple-resolver-switch-label' },
      React.createElement('strong', undefined, item.label),
      React.createElement('code', undefined, item.expression + ' && JSX'),
    ),
    item.reached === true && (item.forced || item.targetGuided)
      ? React.createElement(
          PreviewInspectorDevtoolsButton,
          {
            onClick: () => resetPreviewInspectorRenderConditionOverride(item.conditionId),
            title: 'Follow the project value for this JSX condition again',
          },
          'Authored',
        )
      : undefined,
  );
}

/** Renders source-level returns plus independent logical-AND component visibility switches. */
function PreviewInspectorSimpleResolverRenderChoice({ model }) {
  const choice = model.renderChoice;
  const selectedId = readPreviewInspectorSelectedRenderOutcomeId();
  const selectedOutcome = choice.outcomes.find((outcome) =>
    outcome.id === selectedId || outcome.memberIds?.includes?.(selectedId));
  const effectiveId = selectedOutcome?.id ?? '';
  return React.createElement(
    'section',
    { 'aria-label': 'Rendered component choice', className: 'rpi-simple-resolver-card' },
    React.createElement('strong', undefined, 'Rendered component'),
    choice.mode === 'selectable'
      ? React.createElement(
          'select',
          {
            'aria-label': 'JSX return to render',
            className: 'rpi-select',
            onChange: (event) => event.target.value.length === 0
              ? clearPreviewInspectorRenderOutcome()
              : selectPreviewInspectorRenderOutcome(event.target.value),
            value: effectiveId,
          },
          React.createElement('option', { value: '' }, 'Use authored result'),
          ...choice.outcomes.map((outcome) => React.createElement(
              'option',
              { key: outcome.id, value: outcome.id },
              outcome.label ?? outcome.id,
            )),
        )
      : React.createElement(
          'span',
          { className: 'rpi-note' },
          choice.mode === 'fixed'
            ? 'Fixed by source · ' + String(choice.outcomes[0]?.label ?? 'single JSX return')
            : 'The authored render path is selected automatically.',
        ),
    choice.switches.length > 0
      ? React.createElement(
          'div',
          { className: 'rpi-simple-resolver-switch-list' },
          ...choice.switches.map((item) => React.createElement(
            PreviewInspectorSimpleResolverBooleanSwitch,
            { item, key: item.id },
          )),
        )
      : undefined,
  );
}

/** Displays automatic diagnostics as a short read-only audit instead of another resolver form. */
function PreviewInspectorSimpleResolverAutomaticSummary({ model }) {
  return React.createElement(
    'details',
    { className: 'rpi-simple-resolver-automatic' },
    React.createElement('summary', undefined, 'Automatic setup'),
    ...model.automatic.summary.map((summary, index) => React.createElement(
      'div',
      { className: 'rpi-note', key: 'summary:' + String(index) },
      summary,
    )),
    ...model.automatic.diagnostics.map((diagnostic) => React.createElement(
      'div',
      { className: 'rpi-meta', key: diagnostic.id },
      diagnostic.label,
    )),
  );
}

/** Renders the complete resolver: Data, rendered-component choice, then automatic diagnostics. */
function PreviewInspectorSimpleResolver({ flow, showManualEditor = false }) {
  const model = createPreviewInspectorSimpleResolverModel(
    flow,
    readPreviewInspectorStaticRenderOutcomes(),
    readPreviewInspectorRenderConditions(),
  );
  return React.createElement(
    'div',
    { 'aria-label': 'Simple preview resolver', className: 'rpi-simple-resolver' },
    React.createElement(PreviewInspectorSimpleResolverData, { model, showManualEditor }),
    React.createElement(PreviewInspectorSimpleResolverRenderChoice, { model }),
    React.createElement(PreviewInspectorSimpleResolverAutomaticSummary, { model }),
  );
}
`;
}
