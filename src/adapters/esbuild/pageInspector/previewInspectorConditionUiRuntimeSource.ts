/**
 * Generates condition-tree enrichment and branch controls for the Page Inspector UI.
 *
 * This module depends only on the Inspector's serializable condition registry. It never retains Fiber
 * objects and attaches conditions to the nearest same-file component using source-line evidence, with
 * a visible unowned group when runtime source metadata is incomplete.
 */

/**
 * Creates browser source consumed by the DevTools-style Inspector shell.
 *
 * Expected lexical bindings include React, the condition registry helpers, the ordinary tree-node
 * selection helpers, and `PreviewInspectorDevtoolsButton` declared by the surrounding UI runtime.
 *
 * @returns Plain JavaScript source concatenated before the Inspector React components render.
 */
export function createPreviewInspectorConditionUiRuntimeSource(): string {
  return String.raw`
/** Normalizes a local source identity for same-file condition/component matching. */
function normalizePreviewInspectorConditionSourcePath(value) {
  return typeof value === 'string' ? value.replaceAll('\\', '/') : '';
}

/** Matches exact paths and a single absolute/relative JSX-dev representation of the same file. */
function matchesPreviewInspectorConditionSourcePath(left, right) {
  if (left === right) return true;
  const leftAbsolute = left.startsWith('/') || /^[A-Za-z]:\//u.test(left);
  const rightAbsolute = right.startsWith('/') || /^[A-Za-z]:\//u.test(right);
  if (leftAbsolute === rightAbsolute) return false;
  const absolute = leftAbsolute ? left : right;
  const relative = leftAbsolute ? right : left;
  return relative.length > 0 && absolute.endsWith('/' + relative.replace(/^\.\//u, ''));
}

/** Creates one serializable pseudo-component node representing an authored render condition. */
function createPreviewInspectorConditionTreeNode(condition) {
  const enabled = condition.effectiveEnabled === true;
  const activeLabel = enabled ? condition.truthyLabel : condition.falsyLabel;
  const forced = typeof condition.override === 'boolean';
  const fallbackActive = condition.fallbackBranch === (enabled ? 'truthy' : 'falsy');
  return {
    children: [],
    condition,
    conditionId: condition.id,
    exportName: undefined,
    id: 'render-condition:' + condition.id,
    kind: 'condition',
    name: condition.expression + ' · ' + activeLabel,
    props: {
      authored: condition.authoredEnabled,
      effective: enabled,
      fallbackActive,
      mode: forced ? 'forced' : 'authored',
    },
    source: normalizePreviewInspectorUiSource({
      column: condition.column,
      displayName: condition.sourcePath,
      line: condition.line,
      path: condition.sourcePath,
    }),
    state: {
      fallbackBranch: condition.fallbackBranch,
      falsyBranch: condition.falsyLabel,
      truthyBranch: condition.truthyLabel,
    },
  };
}

/** Flattens component source candidates while retaining their current structural identity. */
function collectPreviewInspectorConditionOwners(nodes, owners = []) {
  for (const node of nodes) {
    const sourcePath = normalizePreviewInspectorConditionSourcePath(node.source?.path);
    if (sourcePath.length > 0 && node.kind !== 'condition') {
      owners.push({
        id: node.id,
        line: Number.isSafeInteger(node.source?.line) ? node.source.line : 0,
        sourcePath,
      });
    }
    collectPreviewInspectorConditionOwners(node.children, owners);
  }
  return owners;
}

/** Selects the nearest preceding same-file component declaration for one condition source line. */
function findPreviewInspectorConditionOwner(condition, owners) {
  const sourcePath = normalizePreviewInspectorConditionSourcePath(condition.sourcePath);
  if (sourcePath.length === 0) return undefined;
  const conditionLine = Number.isSafeInteger(condition.line) ? condition.line : 0;
  let selected;
  let selectedScore = Number.POSITIVE_INFINITY;
  for (const owner of owners) {
    if (!matchesPreviewInspectorConditionSourcePath(owner.sourcePath, sourcePath)) continue;
    const precedes = owner.line <= conditionLine;
    const score = (precedes ? 0 : 1_000_000) + Math.abs(conditionLine - owner.line);
    if (score < selectedScore) {
      selected = owner;
      selectedScore = score;
    }
  }
  return selected;
}

/** Appends assigned condition nodes without mutating the collector-owned component snapshot. */
function appendPreviewInspectorAssignedConditions(nodes, assignments) {
  return nodes.map((node) => ({
    ...node,
    children: [
      ...appendPreviewInspectorAssignedConditions(node.children, assignments),
      ...(assignments.get(node.id) ?? []).map(createPreviewInspectorConditionTreeNode),
    ],
  }));
}

/** Adds every evaluated JSX condition to its component or a clearly labeled unowned tree group. */
function attachPreviewInspectorConditionsToSnapshot(snapshot) {
  const conditions = readPreviewInspectorRenderConditions();
  if (conditions.length === 0) return snapshot;
  const owners = collectPreviewInspectorConditionOwners(snapshot.roots);
  const assignments = new Map();
  const unowned = [];
  for (const condition of conditions) {
    const owner = findPreviewInspectorConditionOwner(condition, owners);
    if (owner === undefined) {
      unowned.push(condition);
      continue;
    }
    const assigned = assignments.get(owner.id) ?? [];
    assigned.push(condition);
    assignments.set(owner.id, assigned);
  }
  const roots = appendPreviewInspectorAssignedConditions(snapshot.roots, assignments);
  if (unowned.length > 0) {
    roots.push({
      children: unowned.map(createPreviewInspectorConditionTreeNode),
      id: 'render-conditions:unowned',
      kind: 'condition-group',
      name: 'Render conditions',
      props: undefined,
      source: undefined,
      state: undefined,
    });
  }
  return { ...snapshot, roots };
}

/** Reports whether a tree node is a compiler-instrumented conditional branch control. */
function isPreviewInspectorConditionNode(node) {
  return node?.kind === 'condition' && typeof node.conditionId === 'string';
}

/** Reads the selected source file's representative export from immutable Inspector metadata. */
function readPreviewInspectorMainComponentName() {
  const descriptor = previewInspectorSession.descriptors[0];
  const name = descriptor?.inspector?.target?.exportName ??
    descriptor?.inspectedExportName ?? descriptor?.exportName;
  return typeof name === 'string' && name.length > 0 ? name : undefined;
}

/** Clears arbitrary tree selection and returns focus/highlight to the current file's main component. */
function selectPreviewInspectorMainComponent() {
  const exportName = readPreviewInspectorMainComponentName();
  if (exportName === undefined) return;
  previewInspectorSession.selectedTreeNodeId = undefined;
  if (previewInspectorSession.selectedExportName !== exportName) {
    selectPreviewInspectorExport(exportName);
    return;
  }
  persistPreviewInspectorState();
  schedulePreviewInspectorTreeRefresh();
  schedulePreviewInspectorHighlight();
}

/** Renders explicit authored/forced branch buttons for one selected conditional tree row. */
function PreviewInspectorConditionDetail({ node }) {
  const condition = node.condition;
  const enabled = condition.effectiveEnabled === true;
  const forced = typeof condition.override === 'boolean';
  const activeBranch = enabled ? condition.truthyLabel : condition.falsyLabel;
  const fallbackActive = condition.fallbackBranch === (enabled ? 'truthy' : 'falsy');
  return React.createElement(
    'div',
    { className: 'rpi-detail-content' },
    React.createElement(
      'div',
      { className: 'rpi-meta' },
      (forced ? 'Forced branch' : 'Authored runtime branch') + ' · ' +
        (enabled ? 'true' : 'false'),
    ),
    React.createElement('pre', { className: 'rpi-json' }, condition.expression),
    React.createElement(
      'div',
      { className: 'rpi-note' },
      'Visible branch: ' + activeBranch + (fallbackActive ? ' · authored fallback' : ''),
    ),
    React.createElement(
      'div',
      { className: 'rpi-actions' },
      React.createElement(
        PreviewInspectorDevtoolsButton,
        {
          onClick: () => setPreviewInspectorRenderConditionOverride(condition.id, true),
          pressed: condition.override === true,
          title: 'Force the truthy JSX branch',
        },
        'Show ' + condition.truthyLabel,
      ),
      React.createElement(
        PreviewInspectorDevtoolsButton,
        {
          onClick: () => setPreviewInspectorRenderConditionOverride(condition.id, false),
          pressed: condition.override === false,
          title: 'Force the falsy or hidden JSX branch',
        },
        'Show ' + condition.falsyLabel,
      ),
      React.createElement(
        PreviewInspectorDevtoolsButton,
        {
          disabled: !forced,
          onClick: () => resetPreviewInspectorRenderConditionOverride(condition.id),
          title: 'Follow the authored runtime value again',
        },
        'Use authored value',
      ),
    ),
    React.createElement(
      'div',
      { className: 'rpi-note' },
      'Clicking this condition in the component tree flips its effective branch and remounts the page context.',
    ),
  );
}
`;
}
