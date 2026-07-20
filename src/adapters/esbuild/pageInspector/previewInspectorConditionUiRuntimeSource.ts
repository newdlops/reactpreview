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

/**
 * Reports a dormant overlay that lies on the proven path to the selected current-file component.
 *
 * This is deliberately narrower than "every hidden modal": both target-path membership and the
 * compiler/runtime branch decision must prove that visible=true is required for this exact target.
 */
function doesPreviewInspectorConditionBlockCurrentTarget(condition) {
  if (condition?.role !== 'overlay' || condition?.effectiveEnabled === true) return false;
  if (
    typeof readPreviewInspectorTargetPathEvidence !== 'function' ||
    typeof isPreviewInspectorConditionOnTargetPath !== 'function' ||
    typeof readPreviewInspectorTargetConditionValue !== 'function' ||
    typeof findSelectedPreviewInspectorDescriptor !== 'function' ||
    typeof readSelectedPreviewInspectorPageCandidate !== 'function' ||
    typeof previewInspectorSession.targetReachabilityByKey?.get !== 'function'
  ) {
    return false;
  }
  const state = previewInspectorSession.targetReachabilityByKey.get(condition.reachabilityKey);
  if (state === undefined) return false;
  const descriptor = findSelectedPreviewInspectorDescriptor();
  const candidate = readSelectedPreviewInspectorPageCandidate(descriptor);
  if (descriptor === undefined || candidate === undefined) return false;
  const evidence = readPreviewInspectorTargetPathEvidence(descriptor, candidate, state);
  return isPreviewInspectorConditionOnTargetPath(condition, evidence) &&
    readPreviewInspectorTargetConditionValue(condition, evidence) === true;
}

/** Creates one serializable pseudo-component node representing an authored render condition. */
function createPreviewInspectorConditionTreeNode(condition) {
  const enabled = condition.effectiveEnabled === true;
  const activeLabel = enabled ? condition.truthyLabel : condition.falsyLabel;
  const forced = typeof condition.override === 'boolean';
  const targetGuided = typeof condition.autoOverride === 'boolean';
  const fallbackActive = condition.fallbackBranch === (enabled ? 'truthy' : 'falsy');
  const overlay = condition.role === 'overlay';
  const blocksCurrentTarget = doesPreviewInspectorConditionBlockCurrentTarget(condition);
  return {
    blocksCurrentTarget,
    children: [],
    condition,
    conditionId: condition.id,
    exportName: undefined,
    id: 'render-condition:' + condition.id,
    kind: 'condition',
    name: (overlay ? 'Overlay · ' : '') + condition.expression + ' · ' + activeLabel,
    overlayState: overlay ? (enabled ? 'mounted' : 'dormant') : undefined,
    props: {
      authored: condition.authoredEnabled,
      blocksCurrentTarget,
      effective: enabled,
      fallbackActive,
      mode: forced ? 'forced' : targetGuided ? 'target-guided' : 'authored',
    },
    role: overlay ? 'overlay' : undefined,
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

/** Creates one non-boolean switch choice row without classifying it as a blocker/DFS condition. */
function createPreviewInspectorRenderChoiceTreeNode(choice) {
  const activeBranch = choice.branches.find((branch) => branch.id === choice.effectiveBranchId);
  const forced = typeof choice.override === 'string';
  return {
    children: [],
    choice,
    choiceId: choice.id,
    exportName: undefined,
    id: 'render-choice:' + choice.id,
    kind: 'render-choice',
    name: 'Switch · ' + choice.expression + ' · ' + (activeBranch?.label ?? 'unresolved runtime case'),
    props: {
      authoredBranchId: choice.authoredBranchId,
      effectiveBranchId: choice.effectiveBranchId,
      mode: forced ? 'forced' : 'authored',
    },
    source: normalizePreviewInspectorUiSource({
      column: choice.column,
      displayName: choice.sourcePath,
      line: choice.line,
      path: choice.sourcePath,
    }),
    state: {
      branches: choice.branches.map((branch) => ({
        id: branch.id,
        label: branch.label,
        selectable: branch.selectable,
      })),
    },
  };
}

/** Selects the correct pseudo-node representation for boolean and multi-way render controls. */
function createPreviewInspectorRenderControlTreeNode(control) {
  return control?.kind === 'switch'
    ? createPreviewInspectorRenderChoiceTreeNode(control)
    : createPreviewInspectorConditionTreeNode(control);
}

/** Flattens component source candidates while retaining their current structural identity. */
function collectPreviewInspectorConditionOwners(nodes, owners = []) {
  for (const node of nodes) {
    const sourcePath = normalizePreviewInspectorConditionSourcePath(node.source?.path);
    if (
      sourcePath.length > 0 &&
      node.contextOnly !== true &&
      node.kind !== 'blocker' &&
      node.kind !== 'condition' &&
      node.kind !== 'render-choice'
    ) {
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
      ...(assignments.get(node.id) ?? []).map(createPreviewInspectorRenderControlTreeNode),
    ],
  }));
}

/** Adds every evaluated JSX condition to its component or a clearly labeled unowned tree group. */
function attachPreviewInspectorConditionsToSnapshot(snapshot) {
  const conditions = [
    ...readPreviewInspectorRenderConditions(),
    ...readPreviewInspectorRenderChoices(),
  ];
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
      children: unowned.map(createPreviewInspectorRenderControlTreeNode),
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

/** Reports a compiler-instrumented multi-way render choice kept outside boolean blocker DFS. */
function isPreviewInspectorRenderChoiceNode(node) {
  return node?.kind === 'render-choice' && typeof node.choiceId === 'string';
}

/** Reads the selected source file's representative export from immutable Inspector metadata. */
function readPreviewInspectorMainComponentName() {
  const descriptor = findSelectedPreviewInspectorDescriptor() ?? previewInspectorSession.descriptors[0];
  const name = descriptor?.inspector?.target?.exportName ??
    descriptor?.inspectedExportName ?? descriptor?.exportName;
  return typeof name === 'string' && name.length > 0 ? name : undefined;
}

/** Clears arbitrary tree selection and returns focus/highlight to the current file's main component. */
function selectPreviewInspectorMainComponent() {
  const exportName = readPreviewInspectorMainComponentName();
  if (exportName === undefined) return;
  previewInspectorDevtoolsSessionState.navigationTab = 'components';
  previewInspectorDevtoolsSessionState.query = '';
  previewInspectorSession.selectedTreeNodeId = undefined;
  if (previewInspectorSession.selectedExportName !== exportName) {
    selectPreviewInspectorExport(exportName);
    requestPreviewInspectorTreeReveal();
    return;
  }
  const snapshot = collectPreviewInspectorUiTreeSnapshot();
  const currentFileNode = findPreviewInspectorUiNodeByExport(snapshot.roots, exportName);
  if (currentFileNode !== undefined) {
    requestPreviewInspectorTreeReveal(currentFileNode.id);
    selectPreviewInspectorUiNode(currentFileNode);
    return;
  }
  requestPreviewInspectorTreeReveal();
  previewInspectorSession.selectedTreeNodeId = undefined;
  persistPreviewInspectorState();
  schedulePreviewInspectorTreeRefresh();
  schedulePreviewInspectorHighlight();
}

/** Renders explicit authored/forced branch buttons for one selected conditional tree row. */
function PreviewInspectorConditionDetail({ node }) {
  if (isPreviewInspectorRenderChoiceNode(node)) {
    return React.createElement(PreviewInspectorRenderChoiceDetail, { node });
  }
  const condition = node.condition;
  const enabled = condition.effectiveEnabled === true;
  const forced = typeof condition.override === 'boolean';
  const targetGuided = typeof condition.autoOverride === 'boolean';
  const activeBranch = enabled ? condition.truthyLabel : condition.falsyLabel;
  const fallbackActive = condition.fallbackBranch === (enabled ? 'truthy' : 'falsy');
  const overlay = condition.role === 'overlay';
  return React.createElement(
    'div',
    { className: 'rpi-detail-content' },
    React.createElement(
      'div',
      { className: 'rpi-meta' },
      (overlay
        ? 'Overlay visibility'
        : forced
          ? 'Forced branch'
          : targetGuided
            ? 'Target-guided DFS branch'
            : 'Authored runtime branch') + ' · ' +
        (overlay && (forced || targetGuided)
          ? (targetGuided ? 'target-guided · ' : 'forced · ')
          : '') +
        (enabled ? 'true' : 'false'),
    ),
    React.createElement('pre', { className: 'rpi-json' }, condition.expression),
    React.createElement(
      'div',
      { className: 'rpi-note' },
      'Visible branch: ' + activeBranch + (fallbackActive ? ' · authored fallback' : '') +
        (node.blocksCurrentTarget === true ? ' · blocks current file while hidden' : ''),
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
          disabled: !forced && !targetGuided,
          onClick: () => resetPreviewInspectorRenderConditionOverride(condition.id),
          title: 'Follow the authored runtime value again',
        },
        'Use authored value',
      ),
    ),
    React.createElement(
      'div',
      { className: 'rpi-note' },
      'Selecting this blocker keeps authored output unchanged until you choose a branch, then remounts the surrounding page context.',
    ),
  );
}

/** Renders one button per switch case while clearly retaining dynamic cases as read-only evidence. */
function PreviewInspectorRenderChoiceDetail({ node }) {
  const choice = node.choice;
  const forced = typeof choice.override === 'string';
  const activeBranch = choice.branches.find((branch) => branch.id === choice.effectiveBranchId);
  const authoredBranch = choice.branches.find((branch) => branch.id === choice.authoredBranchId);
  return React.createElement(
    'div',
    { className: 'rpi-detail-content' },
    React.createElement(
      'div',
      { className: 'rpi-meta' },
      (forced ? 'Forced switch case' : 'Authored switch case') + ' · ' +
        (activeBranch?.label ?? 'dynamic case unresolved'),
    ),
    React.createElement('pre', { className: 'rpi-json' }, choice.expression),
    React.createElement(
      'div',
      { className: 'rpi-note' },
      'Authored: ' + (authoredBranch?.label ?? 'runtime-only dynamic case') +
        ' · Effective: ' + (activeBranch?.label ?? 'runtime-only dynamic case'),
    ),
    React.createElement(
      'div',
      { className: 'rpi-actions' },
      choice.branches.map((branch) => React.createElement(
        PreviewInspectorDevtoolsButton,
        {
          disabled: branch.selectable !== true,
          key: branch.id,
          onClick: () => setPreviewInspectorRenderChoiceOverride(choice.id, branch.id),
          pressed: choice.override === branch.id,
          title: branch.selectable === true
            ? 'Force this literal switch branch'
            : 'Read-only dynamic case: forcing it could evaluate project logic out of order',
        },
        branch.label,
      )),
      React.createElement(
        PreviewInspectorDevtoolsButton,
        {
          disabled: !forced,
          onClick: () => resetPreviewInspectorRenderChoiceOverride(choice.id),
          title: 'Follow the authored switch discriminant again',
        },
        'Use authored value',
      ),
    ),
    React.createElement(
      'div',
      { className: 'rpi-note' },
      'Literal cases are editable. Dynamic case expressions stay read-only because evaluating them in the Inspector could change application behavior.',
    ),
  );
}
`;
}
