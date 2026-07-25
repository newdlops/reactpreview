/**
 * Generates the current-file JSX ON/OFF scenario table shown by React Page Inspector.
 *
 * The table is a projection of compiler-owned return outcomes and the live condition registry. It
 * never evaluates project expressions: static conditions remain visible while short-circuited, and
 * only conditions that the instrumented application has reached receive editable ON/OFF controls.
 */
import { createPreviewInspectorJsxScenarioLineageRuntimeSource } from './previewInspectorJsxScenarioLineageRuntimeSource';

/** Maximum scenario rows shown for one selected source file. */
export const PREVIEW_INSPECTOR_JSX_SCENARIO_LIMIT = 256;

/**
 * Creates browser source for collecting, presenting, and selecting current-file JSX scenarios.
 *
 * Expected lexical bindings include the static render-outcome readers, condition registry helpers,
 * tree-selection helpers, React, and the shared Inspector session state. All records remain plain
 * serializable objects; neither TypeScript AST nodes nor React Fiber objects cross this boundary.
 *
 * @returns Plain JavaScript concatenated into the isolated Inspector Shadow DOM runtime.
 */
export function createPreviewInspectorJsxScenarioUiRuntimeSource(): string {
  return String.raw`
const PREVIEW_INSPECTOR_JSX_SCENARIO_LIMIT = ${PREVIEW_INSPECTOR_JSX_SCENARIO_LIMIT};
${createPreviewInspectorJsxScenarioLineageRuntimeSource()}

/** Reads the exact selected source rather than admitting conditions from an ancestor application. */
function readPreviewInspectorJsxScenarioSourcePath() {
  const plan = typeof readPreviewInspectorSelectedRenderOutcomePlan === 'function'
    ? readPreviewInspectorSelectedRenderOutcomePlan()
    : undefined;
  if (typeof plan?.sourcePath === 'string' && plan.sourcePath.length > 0) {
    return normalizePreviewInspectorConditionSourcePath(plan.sourcePath);
  }
  const identity = typeof readPreviewInspectorCurrentFileTreeIdentity === 'function'
    ? readPreviewInspectorCurrentFileTreeIdentity()
    : undefined;
  if (typeof identity?.sourcePath === 'string' && identity.sourcePath.length > 0) {
    return normalizePreviewInspectorConditionSourcePath(identity.sourcePath);
  }
  const descriptor = typeof findSelectedPreviewInspectorDescriptor === 'function'
    ? findSelectedPreviewInspectorDescriptor()
    : undefined;
  return normalizePreviewInspectorConditionSourcePath(descriptor?.inspector?.target?.sourcePath);
}

/** Creates one stable static identity shared by the truthy and falsy outcome edges. */
function createPreviewInspectorJsxScenarioStaticKey(condition) {
  const source = typeof readPreviewInspectorRenderOutcomeConditionSource === 'function'
    ? readPreviewInspectorRenderOutcomeConditionSource(condition)
    : condition ?? {};
  const fingerprint = typeof source.expressionFingerprint === 'string' &&
    source.expressionFingerprint.length > 0
    ? source.expressionFingerprint
    : undefined;
  return [
    normalizePreviewInspectorConditionSourcePath(source.sourcePath),
    source.line ?? '',
    source.column ?? '',
    condition?.kind ?? '',
    fingerprint === undefined ? source.expression ?? condition?.expression ?? '' : fingerprint,
  ].join(':');
}

/** Produces a short JSX result label from one complete static return outcome. */
function describePreviewInspectorJsxScenarioOutcome(outcome) {
  if (typeof outcome?.label === 'string' && outcome.label.length > 0) return outcome.label;
  const names = Array.isArray(outcome?.componentNames)
    ? outcome.componentNames.filter((name) => typeof name === 'string').slice(0, 4)
    : [];
  if (names.length > 0) return names.join(', ');
  return outcome?.kind === 'empty' ? 'empty render' : 'render result';
}

/** Appends one unique bounded result label to a static ON or OFF branch. */
function appendPreviewInspectorJsxScenarioBranchLabel(labels, label) {
  if (typeof label !== 'string' || label.length === 0 || labels.includes(label)) return;
  if (labels.length < 4) labels.push(label);
}

/**
 * Groups duplicate condition edges from complete return outcomes into one two-sided decision.
 *
 * Logical-AND guards use their dedicated chain-aware model. Switch statements are multi-way rather
 * than ON/OFF and therefore remain in the component tree instead of being mislabeled as Boolean.
 */
function collectPreviewInspectorStaticJsxScenarioGroups(outcomes) {
  const groups = new Map();
  for (const outcome of Array.isArray(outcomes) ? outcomes : []) {
    const outcomeLabel = describePreviewInspectorJsxScenarioOutcome(outcome);
    for (const condition of Array.isArray(outcome?.conditions) ? outcome.conditions : []) {
      if (condition?.kind === 'logical-and' || condition?.kind === 'switch') continue;
      const branch = condition?.branch ?? condition?.arm;
      if (!['truthy', 'falsy', true, false].includes(branch)) continue;
      const key = createPreviewInspectorJsxScenarioStaticKey(condition);
      const group = groups.get(key) ?? {
        condition,
        falsyLabels: [],
        key,
        truthyLabels: [],
      };
      appendPreviewInspectorJsxScenarioBranchLabel(
        branch === 'truthy' || branch === true ? group.truthyLabels : group.falsyLabels,
        outcomeLabel,
      );
      groups.set(key, group);
      if (groups.size >= PREVIEW_INSPECTOR_JSX_SCENARIO_LIMIT) return groups;
    }
  }
  return groups;
}

/** Joins a static decision to its live editable registry record using exact source evidence. */
function findPreviewInspectorJsxScenarioRuntimeCondition(condition, runtimeConditions, matchedIds) {
  const runtime = runtimeConditions.find((candidate) =>
    candidate?.kind !== 'logical-and' &&
    !matchedIds.has(candidate?.id) &&
    typeof matchesPreviewInspectorRenderOutcomeCondition === 'function' &&
    matchesPreviewInspectorRenderOutcomeCondition(condition, candidate));
  if (typeof runtime?.id === 'string') matchedIds.add(runtime.id);
  return runtime;
}

/** Creates one normalized table row without inventing editability for an unreached expression. */
function createPreviewInspectorJsxScenarioRecord(options) {
  const runtime = options.runtime;
  const source = runtime ??
    (typeof readPreviewInspectorRenderOutcomeConditionSource === 'function'
      ? readPreviewInspectorRenderOutcomeConditionSource(options.condition)
      : options.condition ?? {});
  const reached = runtime !== undefined &&
    typeof runtime.id === 'string' && runtime.id.length > 0;
  const expression = typeof runtime?.expression === 'string' && runtime.expression.length > 0
    ? runtime.expression
    : typeof options.condition?.expression === 'string' && options.condition.expression.length > 0
      ? options.condition.expression
      : 'JSX condition';
  return {
    ...source,
    authoredEnabled: reached ? runtime.authoredEnabled === true : undefined,
    autoOverride: reached ? runtime.autoOverride : undefined,
    conditionTreeId: runtime?.conditionTreeId ?? 'scenario:' + options.key,
    effectiveEnabled: reached ? runtime.effectiveEnabled === true : false,
    expression,
    falsyLabel: typeof runtime?.falsyLabel === 'string' && runtime.falsyLabel.length > 0
      ? runtime.falsyLabel
      : options.falsyLabels.join(' / ') || 'false branch',
    id: reached ? runtime.id : undefined,
    kind: runtime?.kind ?? options.condition?.kind ?? 'condition',
    override: reached ? runtime.override : undefined,
    reached,
    role: runtime?.role,
    sourcePath: runtime?.sourcePath ?? source.sourcePath ?? options.condition?.sourcePath,
    staticKey: options.key,
    truthyLabel: typeof runtime?.truthyLabel === 'string' && runtime.truthyLabel.length > 0
      ? runtime.truthyLabel
      : options.truthyLabels.join(' / ') || 'true branch',
  };
}

/** Collects current-file static and live conditions into a bounded, source-ordered table model. */
function collectPreviewInspectorJsxScenarioRecords() {
  const sourcePath = readPreviewInspectorJsxScenarioSourcePath();
  const outcomes = typeof readPreviewInspectorStaticRenderOutcomes === 'function'
    ? readPreviewInspectorStaticRenderOutcomes()
    : [];
  const runtimeConditions = typeof readPreviewInspectorRenderConditions === 'function'
    ? readPreviewInspectorRenderConditions()
    : [];
  const matchedRuntimeIds = new Set();
  const records = [];
  for (const group of collectPreviewInspectorStaticJsxScenarioGroups(outcomes).values()) {
    const runtime = findPreviewInspectorJsxScenarioRuntimeCondition(
      group.condition,
      runtimeConditions,
      matchedRuntimeIds,
    );
    records.push(createPreviewInspectorJsxScenarioRecord({
      ...group,
      runtime,
    }));
  }
  const logicalSwitches = typeof readPreviewInspectorLogicalSwitchRecords === 'function'
    ? readPreviewInspectorLogicalSwitchRecords(outcomes, runtimeConditions)
    : runtimeConditions.filter((condition) => condition?.kind === 'logical-and');
  for (const condition of logicalSwitches) {
    if (typeof condition?.id === 'string') matchedRuntimeIds.add(condition.id);
    records.push(condition);
  }
  for (const condition of runtimeConditions) {
    if (
      condition?.kind === 'logical-and' ||
      typeof condition?.id !== 'string' ||
      matchedRuntimeIds.has(condition.id)
    ) {
      continue;
    }
    records.push({
      ...condition,
      conditionTreeId: condition.conditionTreeId ?? 'runtime:' + condition.id,
      reached: true,
    });
  }
  const unique = [];
  const seen = new Set();
  for (const record of records) {
    const recordSourcePath = normalizePreviewInspectorConditionSourcePath(record?.sourcePath);
    if (
      sourcePath.length > 0 &&
      !matchesPreviewInspectorConditionSourcePath(sourcePath, recordSourcePath)
    ) {
      continue;
    }
    const key = String(record?.conditionTreeId ?? record?.id ?? createPreviewInspectorJsxScenarioStaticKey(record));
    if (seen.has(key)) continue;
    seen.add(key);
    unique.push(record);
    if (unique.length >= PREVIEW_INSPECTOR_JSX_SCENARIO_LIMIT) break;
  }
  return attachPreviewInspectorJsxScenarioLineage(outcomes, unique);
}

/** Reduces scenario records to unique source locations accepted by the passive host protocol. */
function collectPreviewInspectorJsxScenarioDecorationSources(scenarios) {
  const sources = [];
  const seen = new Set();
  for (const scenario of Array.isArray(scenarios) ? scenarios : []) {
    const source = normalizePreviewInspectorUiSource({
      column: scenario?.column,
      line: scenario?.line,
      occurrenceStart: scenario?.occurrenceStart,
      path: scenario?.sourcePath,
    });
    if (
      typeof source?.path !== 'string' ||
      source.path.length === 0 ||
      (!Number.isSafeInteger(source.line) && !Number.isSafeInteger(source.occurrenceStart))
    ) {
      continue;
    }
    const key = [
      source.path,
      source.line ?? '',
      source.column ?? '',
      source.occurrenceStart ?? '',
    ].join(':');
    if (seen.has(key)) continue;
    seen.add(key);
    sources.push({
      ...(Number.isSafeInteger(source.column) && source.column > 0
        ? { column: source.column }
        : {}),
      ...(Number.isSafeInteger(source.line) && source.line > 0 ? { line: source.line } : {}),
      ...(Number.isSafeInteger(source.occurrenceStart) && source.occurrenceStart >= 0
        ? { occurrenceStart: source.occurrenceStart }
        : {}),
      sourcePath: source.path,
    });
    if (sources.length >= PREVIEW_INSPECTOR_JSX_SCENARIO_LIMIT) break;
  }
  return sources;
}

/** Publishes one hot-stable passive branch inventory without requesting source navigation. */
function publishPreviewInspectorJsxScenarioDecorations(sources) {
  const previousSequence = previewHotRuntime.inspectorBranchDecorationSequence;
  const sequence = Number.isSafeInteger(previousSequence) && previousSequence >= 0
    ? previousSequence + 1
    : 1;
  previewHotRuntime.inspectorBranchDecorationSequence = sequence;
  try {
    previewInspectorPostHostMessage?.({
      runtimeRevision: Number.isSafeInteger(previewEntryRevision) && previewEntryRevision > 0
        ? previewEntryRevision
        : previewRuntimeRevision,
      sequence,
      sources,
      type: 'react-preview-inspector-branch-sources',
    });
  } catch (error) {
    console.warn('[React Preview] Could not publish JSX branch source decorations.', error);
  }
}

/**
 * Keeps editor annotations synchronized even when the user opens Components or Console first.
 *
 * A coordinate digest prevents ordinary React refreshes and ON/OFF value changes from republishing
 * an unchanged source inventory; only authored branch locations affect the passive yellow marks.
 */
function usePreviewInspectorJsxScenarioSourceDecorations() {
  const sources = collectPreviewInspectorJsxScenarioDecorationSources(
    collectPreviewInspectorJsxScenarioRecords(),
  );
  const digest = JSON.stringify(sources);
  React.useEffect(() => {
    publishPreviewInspectorJsxScenarioDecorations(sources);
  }, [digest]);
}

/** Finds the tree pseudo-node that owns one scenario so its details/source remain reusable. */
function findPreviewInspectorJsxScenarioTreeNode(nodes, scenario) {
  for (const node of nodes ?? []) {
    if (
      node?.condition === scenario ||
      (typeof scenario?.id === 'string' &&
        (node?.conditionId === scenario.id || node?.condition?.id === scenario.id)) ||
      (typeof scenario?.conditionTreeId === 'string' &&
        node?.condition?.conditionTreeId === scenario.conditionTreeId)
    ) {
      return node;
    }
    const descendant = findPreviewInspectorJsxScenarioTreeNode(node?.children, scenario);
    if (descendant !== undefined) return descendant;
  }
  return undefined;
}

/** Formats one table mode without conflating target-guided values with explicit user choices. */
function describePreviewInspectorJsxScenarioMode(scenario) {
  if (scenario?.reached === false || typeof scenario?.id !== 'string') return 'waiting';
  if (typeof scenario.override === 'boolean') return 'manual';
  if (typeof scenario.autoOverride === 'boolean') return 'automatic';
  return 'authored';
}

/** Renders one scenario with explicit OFF/ON values and a reversible authored-value action. */
function PreviewInspectorJsxScenarioRow({ roots, scenario }) {
  const reached = scenario.reached !== false && typeof scenario.id === 'string';
  const lineageBlocked = scenario.lineageBlocked === true;
  const enabled = reached && !lineageBlocked && scenario.effectiveEnabled === true;
  const overridden = typeof scenario.override === 'boolean' ||
    typeof scenario.autoOverride === 'boolean';
  const selectScenario = () => {
    const node = findPreviewInspectorJsxScenarioTreeNode(roots, scenario);
    if (node !== undefined) selectPreviewInspectorUiNode(node);
  };
  const source = normalizePreviewInspectorUiSource({
    column: scenario.column,
    line: scenario.line,
    path: scenario.sourcePath,
  });
  const canOpenSource = typeof source?.path === 'string' &&
    source.path.length > 0 &&
    typeof previewInspectorSourceNavigation.openSource === 'function';
  const highlightSource = (event) => {
    publishPreviewInspectorSourceSelection(source);
    if (!canOpenSource) return;
    try {
      previewInspectorSourceNavigation.openSource(
        source,
        event.nativeEvent,
        event.currentTarget,
      );
    } catch (error) {
      console.warn('[React Preview] JSX switch source highlighting failed.', error);
    }
  };
  const lineageDepth = Number.isSafeInteger(scenario.lineageDepth)
    ? Math.min(Math.max(0, scenario.lineageDepth), 12)
    : 0;
  const lineageSummary = typeof scenario.lineageParentExpression === 'string'
    ? 'Requires ' + scenario.lineageParentExpression + ' ' +
      (scenario.lineageParentRequiredEnabled === false ? 'OFF' : 'ON')
    : 'Root switch';
  const descendantSummary = scenario.lineageDescendantCount > 0
    ? ' · ' + String(scenario.lineageDescendantCount) + ' downstream'
    : '';
  return React.createElement(
    'tr',
    {
      'data-lineage-blocked': lineageBlocked,
      'data-lineage-depth': lineageDepth,
      'data-reached': reached,
      'data-scenario-enabled': enabled,
    },
    React.createElement(
      'td',
      { className: 'rpi-scenario-expression' },
      React.createElement(
        'div',
        { className: 'rpi-scenario-lineage' },
        ...Array.from({ length: lineageDepth }, (_, index) => React.createElement(
          'span',
          {
            'aria-hidden': 'true',
            className: 'rpi-scenario-lineage-guide',
            key: 'guide:' + String(index),
          },
        )),
        React.createElement(
          'span',
          {
            'aria-hidden': 'true',
            className: 'rpi-scenario-lineage-marker',
            'data-root': lineageDepth === 0,
          },
          lineageDepth === 0 ? '●' : '↳',
        ),
        React.createElement(
          'div',
          { className: 'rpi-scenario-lineage-content' },
          React.createElement(
            'button',
            {
              className: 'rpi-scenario-expression-button',
              disabled: findPreviewInspectorJsxScenarioTreeNode(roots, scenario) === undefined,
              onClick: selectScenario,
              title: 'Select this JSX condition in the component tree details',
              type: 'button',
            },
            scenario.expression,
          ),
          React.createElement(
            'span',
            {
              className: 'rpi-scenario-lineage-summary',
              title: lineageSummary + descendantSummary,
            },
            lineageSummary + descendantSummary,
          ),
        ),
      ),
      React.createElement(
        'span',
        { className: 'rpi-meta' },
        formatPreviewInspectorUiSource(source),
      ),
    ),
    React.createElement('td', { className: 'rpi-scenario-branch' }, scenario.falsyLabel),
    React.createElement('td', { className: 'rpi-scenario-branch' }, scenario.truthyLabel),
    React.createElement(
      'td',
      undefined,
      React.createElement(
        'span',
        {
          className: 'rpi-scenario-state',
          'data-enabled': enabled,
          'data-reached': reached,
        },
        lineageBlocked ? 'BLOCKED' : reached ? enabled ? 'ON' : 'OFF' : 'WAIT',
      ),
      React.createElement(
        'span',
        { className: 'rpi-scenario-mode' },
        describePreviewInspectorJsxScenarioMode(scenario),
      ),
    ),
    React.createElement(
      'td',
      { className: 'rpi-scenario-actions' },
      React.createElement(
        PreviewInspectorDevtoolsButton,
        {
          disabled: !reached || lineageBlocked,
          onClick: () => setPreviewInspectorRenderConditionOverride(scenario.id, false),
          pressed: reached && !enabled,
          title: lineageBlocked
            ? 'Set the required parent switch first'
            : reached ? 'Force the OFF JSX branch' : 'A preceding condition must run first',
        },
        'Off',
      ),
      React.createElement(
        PreviewInspectorDevtoolsButton,
        {
          disabled: !reached || lineageBlocked,
          onClick: () => setPreviewInspectorRenderConditionOverride(scenario.id, true),
          pressed: reached && enabled,
          title: lineageBlocked
            ? 'Set the required parent switch first'
            : reached ? 'Force the ON JSX branch' : 'A preceding condition must run first',
        },
        'On',
      ),
      React.createElement(
        PreviewInspectorDevtoolsButton,
        {
          disabled: !reached || !overridden,
          onClick: () => resetPreviewInspectorRenderConditionOverride(scenario.id),
          title: 'Follow the authored JavaScript value again',
        },
        'Authored',
      ),
      React.createElement(
        PreviewInspectorDevtoolsButton,
        {
          companionSource: source,
          disabled: !canOpenSource,
          onClick: highlightSource,
          sourceHighlight: true,
          sourceOpen: true,
          title: canOpenSource
            ? 'Reveal and highlight this switch in the source editor'
            : 'Source location unavailable',
        },
        'Highlight code',
      ),
    ),
  );
}

/** Renders the default current-file scenario tab while preserving its own scroll coordinates. */
function PreviewInspectorJsxScenarioPane({ roots }) {
  const scenarios = collectPreviewInspectorJsxScenarioRecords();
  const sourcePath = readPreviewInspectorJsxScenarioSourcePath();
  const fileName = sourcePath.split('/').at(-1) || 'Current file';
  const scrollRef = React.useRef(null);
  React.useLayoutEffect(() => {
    const viewport = scrollRef.current;
    if (viewport !== null) {
      viewport.scrollLeft = normalizePreviewInspectorTreeScrollCoordinate(
        previewInspectorDevtoolsSessionState.jsxScenarioScrollLeft,
      );
      viewport.scrollTop = normalizePreviewInspectorTreeScrollCoordinate(
        previewInspectorDevtoolsSessionState.jsxScenarioScrollTop,
      );
    }
    return () => {
      if (viewport === null) return;
      previewInspectorDevtoolsSessionState.jsxScenarioScrollLeft =
        normalizePreviewInspectorTreeScrollCoordinate(viewport.scrollLeft);
      previewInspectorDevtoolsSessionState.jsxScenarioScrollTop =
        normalizePreviewInspectorTreeScrollCoordinate(viewport.scrollTop);
    };
  }, []);
  return React.createElement(
    'div',
    {
      'aria-labelledby': 'rpi-navigation-tab-scenarios',
      className: 'rpi-primary-panel',
      id: 'rpi-navigation-panel-scenarios',
      role: 'tabpanel',
    },
    React.createElement(
      'div',
      { className: 'rpi-pane-heading rpi-scenario-heading' },
      React.createElement('span', { className: 'rpi-pane-title' }, 'Current-file JSX scenarios'),
      React.createElement(
        'span',
        { className: 'rpi-meta', title: sourcePath },
        fileName + ' · ' + String(scenarios.length) + ' Boolean choice(s)',
      ),
    ),
    React.createElement(
      'div',
      {
        className: 'rpi-scenario-scroll',
        'data-rpi-scroll-key': 'jsx-scenarios',
        onScroll: () => {
          previewInspectorDevtoolsSessionState.jsxScenarioScrollLeft =
            normalizePreviewInspectorTreeScrollCoordinate(scrollRef.current?.scrollLeft);
          previewInspectorDevtoolsSessionState.jsxScenarioScrollTop =
            normalizePreviewInspectorTreeScrollCoordinate(scrollRef.current?.scrollTop);
        },
        ref: scrollRef,
      },
      scenarios.length === 0
        ? React.createElement(
            'div',
            { className: 'rpi-empty' },
            'No Boolean JSX branches were found in the selected file.',
          )
        : React.createElement(
            'table',
            { className: 'rpi-scenario-table' },
            React.createElement(
              'thead',
              undefined,
              React.createElement(
                'tr',
                undefined,
                React.createElement('th', { scope: 'col' }, 'Switch lineage / JSX condition'),
                React.createElement('th', { scope: 'col' }, 'OFF renders'),
                React.createElement('th', { scope: 'col' }, 'ON renders'),
                React.createElement('th', { scope: 'col' }, 'Current'),
                React.createElement('th', { scope: 'col' }, 'Scenario'),
              ),
            ),
            React.createElement(
              'tbody',
              undefined,
              scenarios.map((scenario) => React.createElement(PreviewInspectorJsxScenarioRow, {
                key: scenario.conditionTreeId ?? scenario.id,
                roots,
                scenario,
              })),
            ),
          ),
    ),
  );
}
`;
}
