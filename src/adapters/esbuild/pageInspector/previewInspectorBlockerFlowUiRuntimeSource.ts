/**
 * Generates the ordered blocker-resolution flow for React Page Inspector.
 *
 * Component ancestry provides proven precedence: a blocker owned by an outer component must be
 * crossed before a blocker discovered in its descendant. Within one owner, render phases provide a
 * conservative recommendation (path, condition, hook, data, contained render error). Equal-phase
 * blockers remain parallel instead of inventing an unsupported dependency.
 */

/** Maximum current and recently resolved blocker steps retained for one render-corridor scope. */
export const PREVIEW_INSPECTOR_BLOCKER_FLOW_STEP_LIMIT = 96;

/** Maximum render-corridor histories retained by one pinned Inspector session. */
export const PREVIEW_INSPECTOR_BLOCKER_FLOW_SCOPE_LIMIT = 8;

/**
 * Creates browser source for the blocker DAG model, staged flow chart, and one-step editor.
 *
 * Expected lexical bindings include React, blocker predicates/details, tree selection, runtime
 * boundary readers, selected page-candidate helpers, and the runtime-fallback scope helpers supplied
 * by the composed Inspector runtime. Histories are session-only Maps and never enter persisted
 * webview JSON.
 *
 * @returns Plain JavaScript source concatenated into the DevTools-style Inspector runtime.
 */
export function createPreviewInspectorBlockerFlowUiRuntimeSource(): string {
  return String.raw`
const PREVIEW_INSPECTOR_BLOCKER_FLOW_STEP_LIMIT = ${PREVIEW_INSPECTOR_BLOCKER_FLOW_STEP_LIMIT};
const PREVIEW_INSPECTOR_BLOCKER_FLOW_SCOPE_LIMIT = ${PREVIEW_INSPECTOR_BLOCKER_FLOW_SCOPE_LIMIT};

/** Initializes bounded hot-session history without exposing it through persisted DevTools state. */
function initializePreviewInspectorBlockerFlowHistory() {
  if (!(previewInspectorSession.blockerFlowHistoryByKey instanceof Map)) {
    previewInspectorSession.blockerFlowHistoryByKey = new Map();
  }
}

/** Reuses the provider/fallback scope so solved blockers never cross render-corridor boundaries. */
function createPreviewInspectorBlockerFlowScopeKey() {
  const descriptor = findSelectedPreviewInspectorDescriptor();
  const candidate = readSelectedPreviewInspectorPageCandidate(descriptor);
  const directTarget = readPreviewInspectorRuntimeFallbackDirectTarget(descriptor, candidate);
  return createPreviewInspectorRuntimeFallbackScopeKey(candidate, directTarget);
}

/** Returns the conservative render phase used only for same-owner recommended ordering. */
function readPreviewInspectorBlockerFlowPhase(node) {
  if (node?.blockerKind === 'target-reachability') return 0;
  if (isPreviewInspectorConditionNode(node)) return 1;
  if (node?.blockerKind === 'runtime-fallback') return 2;
  if (node?.blockerKind === 'data-request') return 3;
  if (node?.blockerKind === 'target-error') return 4;
  return 5;
}

/** Includes conditions only when they block a branch or document an explicit/DFS resolution. */
function shouldIncludePreviewInspectorConditionInFlow(node) {
  if (!isPreviewInspectorConditionNode(node)) return true;
  const condition = node.condition;
  const enabled = condition?.effectiveEnabled === true;
  const activeBranch = enabled ? 'truthy' : 'falsy';
  const fallbackActive = condition?.fallbackBranch === activeBranch;
  return fallbackActive ||
    enabled === false ||
    typeof condition?.override === 'boolean' ||
    typeof condition?.autoOverride === 'boolean';
}

/** Walks the enriched component tree and records owner paths without retaining Fiber objects. */
function collectPreviewInspectorBlockerFlowRecords(
  nodes,
  ownerIds = [],
  ownerNames = [],
  ownerOrder = [],
  records = [],
  counter = { value: 0 },
) {
  if (!Array.isArray(nodes) || records.length >= PREVIEW_INSPECTOR_BLOCKER_FLOW_STEP_LIMIT) {
    return records;
  }
  for (let index = 0; index < nodes.length; index += 1) {
    const node = nodes[index];
    if (isPreviewInspectorBlockerNode(node)) {
      if (shouldIncludePreviewInspectorConditionInFlow(node)) {
        records.push({
          current: true,
          discoveryOrder: counter.value++,
          id: node.id,
          node,
          ownerIds,
          ownerNames,
          ownerOrder,
          phase: readPreviewInspectorBlockerFlowPhase(node),
        });
      }
      continue;
    }
    const ownsPath = node?.kind !== 'condition-group';
    const nextOwnerIds = ownsPath ? [...ownerIds, node.id] : ownerIds;
    const nextOwnerNames = ownsPath ? [...ownerNames, node.name] : ownerNames;
    const nextOwnerOrder = ownsPath ? [...ownerOrder, index] : ownerOrder;
    collectPreviewInspectorBlockerFlowRecords(
      node?.children,
      nextOwnerIds,
      nextOwnerNames,
      nextOwnerOrder,
      records,
      counter,
    );
  }
  return records;
}

/** Finds the live selected export path, preferring a mounted node over inert inventory entries. */
function readPreviewInspectorBlockerFlowTargetOwnerIds(nodes, ownerIds = []) {
  let fallback;
  for (const node of nodes ?? []) {
    if (isPreviewInspectorBlockerNode(node)) continue;
    const ownsPath = node?.kind !== 'condition-group';
    const nextOwnerIds = ownsPath ? [...ownerIds, node.id] : ownerIds;
    const selected = node?.currentFileExport === true &&
      (node?.exportName === previewInspectorSession.selectedExportName ||
        node?.name === previewInspectorSession.selectedExportName);
    if (selected && node?.mounted !== false && node?.contextOnly !== true) return nextOwnerIds;
    if (selected && fallback === undefined) fallback = nextOwnerIds;
    const descendant = readPreviewInspectorBlockerFlowTargetOwnerIds(node?.children, nextOwnerIds);
    if (descendant !== undefined) {
      const descendantNode = findPreviewInspectorUiNode(nodes, descendant.at(-1));
      if (descendantNode?.mounted !== false && descendantNode?.contextOnly !== true) return descendant;
      if (fallback === undefined) fallback = descendant;
    }
  }
  return fallback;
}

/** Reports whether one blocker owner is an ancestor or descendant of the selected export path. */
function isPreviewInspectorBlockerFlowRelatedOwnerPath(ownerIds, targetOwnerIds) {
  if (!Array.isArray(targetOwnerIds) || targetOwnerIds.length === 0) return false;
  const sharedLength = Math.min(ownerIds.length, targetOwnerIds.length);
  for (let index = 0; index < sharedLength; index += 1) {
    if (ownerIds[index] !== targetOwnerIds[index]) return false;
  }
  return true;
}

/** Reads compiler-issued source/name evidence for the selected authored page-to-target corridor. */
function readPreviewInspectorBlockerFlowCorridorEvidence() {
  const descriptor = findSelectedPreviewInspectorDescriptor();
  const candidate = readSelectedPreviewInspectorPageCandidate(descriptor);
  if (descriptor?.inspector === undefined || candidate === undefined) return undefined;
  const state = readPreviewInspectorTargetReachabilityState(descriptor, candidate);
  return {
    evidence: readPreviewInspectorTargetPathEvidence(descriptor, candidate, state),
    state,
  };
}

/** Keeps the primary flow focused on blockers proven to gate the selected page render corridor. */
function isPreviewInspectorBlockerFlowCorridorRecord(record, context) {
  const node = record.node;
  if (node?.blockerKind === 'target-reachability') return true;
  if (isPreviewInspectorBlockerFlowRelatedOwnerPath(record.ownerIds, context.targetOwnerIds)) {
    return true;
  }
  if (
    node?.blockerKind === 'target-error' &&
    node?.blocker?.exportName === previewInspectorSession.selectedExportName
  ) {
    return true;
  }
  if (context.corridor?.evidence === undefined) return context.targetOwnerIds === undefined;
  const sourceRecord = isPreviewInspectorConditionNode(node) ? node.condition : node?.blocker;
  return isPreviewInspectorConditionOnTargetPath(sourceRecord, context.corridor.evidence);
}

/** Reports whether a data seed already contains a useful local value without reading getters. */
function hasPreviewInspectorBlockerFlowPayload(value) {
  if (value === undefined) return false;
  if (Array.isArray(value)) return value.length > 0;
  if (value !== null && typeof value === 'object') return Object.keys(value).length > 0;
  return true;
}

/** Classifies whether the underlying edge still blocks visual traversal in the current revision. */
function readPreviewInspectorBlockerFlowResolution(record) {
  if (record.current !== true) return 'resolved';
  const node = record.node;
  if (isPreviewInspectorConditionNode(node)) {
    const condition = node.condition;
    const enabled = condition?.effectiveEnabled === true;
    const activeBranch = enabled ? 'truthy' : 'falsy';
    const fallbackActive = condition?.fallbackBranch === activeBranch;
    const logicalAndBlocked = condition?.fallbackBranch === undefined && !enabled;
    return fallbackActive || logicalAndBlocked ? 'pending' : 'resolved';
  }
  if (node?.blockerKind === 'runtime-fallback') {
    return readPreviewInspectorFallbackValuesEnabled() ? 'resolved' : 'pending';
  }
  if (node?.blockerKind === 'data-request') {
    return node.blocker?.mode !== 'seed' || hasPreviewInspectorBlockerFlowPayload(node.blocker?.payload)
      ? 'resolved'
      : 'pending';
  }
  if (node?.blockerKind === 'target-reachability') {
    const pageCorridorReached = node.blocker?.directTarget !== true &&
      node.blocker?.pageRootCommitted === true &&
      node.blocker?.targetMounted === true;
    if (pageCorridorReached || node.blocker?.status === 'reached') return 'resolved';
    return node.blocker?.status === 'probing' || node.blocker?.status === 'advancing'
      ? 'running'
      : 'pending';
  }
  return 'pending';
}

/** Compares deterministic component positions without treating sibling branches as dependencies. */
function comparePreviewInspectorBlockerFlowRecords(left, right) {
  if (left.ownerIds.length !== right.ownerIds.length) {
    return left.ownerIds.length - right.ownerIds.length;
  }
  const orderLength = Math.max(left.ownerOrder.length, right.ownerOrder.length);
  for (let index = 0; index < orderLength; index += 1) {
    const difference = (left.ownerOrder[index] ?? -1) - (right.ownerOrder[index] ?? -1);
    if (difference !== 0) return difference;
  }
  return left.phase - right.phase || left.discoveryOrder - right.discoveryOrder ||
    left.id.localeCompare(right.id);
}

/** Keeps disappeared blockers as resolved history so the chart documents completed work. */
function mergePreviewInspectorBlockerFlowHistory(records) {
  initializePreviewInspectorBlockerFlowHistory();
  const scopeKey = createPreviewInspectorBlockerFlowScopeKey();
  let history = previewInspectorSession.blockerFlowHistoryByKey.get(scopeKey);
  if (!(history instanceof Map)) {
    history = new Map();
    previewInspectorSession.blockerFlowHistoryByKey.set(scopeKey, history);
  }
  for (const retained of history.values()) retained.current = false;
  for (const record of records) {
    const previous = history.get(record.id);
    history.set(record.id, {
      ...record,
      firstSeenOrder: previous?.firstSeenOrder ?? history.size,
    });
  }
  while (history.size > PREVIEW_INSPECTOR_BLOCKER_FLOW_STEP_LIMIT) {
    const resolvedId = [...history].find(([, record]) => record.current !== true)?.[0];
    history.delete(resolvedId ?? history.keys().next().value);
  }
  while (previewInspectorSession.blockerFlowHistoryByKey.size > PREVIEW_INSPECTOR_BLOCKER_FLOW_SCOPE_LIMIT) {
    previewInspectorSession.blockerFlowHistoryByKey.delete(
      previewInspectorSession.blockerFlowHistoryByKey.keys().next().value,
    );
  }
  return [...history.values()];
}

/** Returns the deepest authored owner path that strictly contains the supplied owner path. */
function findPreviewInspectorBlockerFlowAncestorRecords(record, recordsByOwner) {
  for (let length = record.ownerIds.length - 1; length >= 0; length -= 1) {
    const candidates = recordsByOwner.get(record.ownerIds.slice(0, length).join('\0')) ?? [];
    if (candidates.length === 0) continue;
    const terminalPhase = Math.max(...candidates.map((candidate) => candidate.phase));
    return candidates.filter((candidate) => candidate.phase === terminalPhase);
  }
  return [];
}

/**
 * Creates a bounded DAG. Ancestry edges are proven; same-owner phase edges are recommendations,
 * while equal-phase and sibling blockers stay parallel at the same chart stage.
 */
function createPreviewInspectorBlockerFlow(snapshot) {
  const observedRecords = collectPreviewInspectorBlockerFlowRecords(snapshot?.roots);
  const corridorContext = {
    corridor: readPreviewInspectorBlockerFlowCorridorEvidence(),
    targetOwnerIds: readPreviewInspectorBlockerFlowTargetOwnerIds(snapshot?.roots),
  };
  const currentRecords = observedRecords.filter((record) =>
    isPreviewInspectorBlockerFlowCorridorRecord(record, corridorContext),
  );
  const supportingCount = observedRecords.length - currentRecords.length;
  const records = mergePreviewInspectorBlockerFlowHistory(currentRecords)
    .sort(comparePreviewInspectorBlockerFlowRecords);
  const recordsByOwner = new Map();
  const steps = [];
  const stepById = new Map();
  for (const record of records) {
    const ownerKey = record.ownerIds.join('\0');
    const sameOwner = recordsByOwner.get(ownerKey) ?? [];
    const earlierPhases = sameOwner.filter((candidate) => candidate.phase < record.phase);
    const predecessorRecords = earlierPhases.length > 0
      ? earlierPhases.filter((candidate) => candidate.phase === Math.max(
          ...earlierPhases.map((item) => item.phase),
        ))
      : findPreviewInspectorBlockerFlowAncestorRecords(record, recordsByOwner);
    const predecessorIds = [...new Set(predecessorRecords.map((candidate) => candidate.id))];
    const level = predecessorIds.reduce(
      (maximum, predecessorId) => Math.max(maximum, (stepById.get(predecessorId)?.level ?? -1) + 1),
      0,
    );
    const step = {
      ...record,
      level,
      predecessorIds,
      resolution: readPreviewInspectorBlockerFlowResolution(record),
    };
    steps.push(step);
    stepById.set(step.id, step);
    sameOwner.push(record);
    recordsByOwner.set(ownerKey, sameOwner);
  }
  /** A solved intermediate edge cannot hide an unresolved transitive predecessor. */
  const hasResolvedPredecessorPath = (step, visited = new Set()) => {
    if (visited.has(step.id)) return false;
    const nextVisited = new Set(visited).add(step.id);
    return step.predecessorIds.every((id) => {
      const predecessor = stepById.get(id);
      return predecessor?.resolution === 'resolved' &&
        hasResolvedPredecessorPath(predecessor, nextVisited);
    });
  };
  const ready = steps.filter((step) =>
    step.resolution !== 'resolved' && hasResolvedPredecessorPath(step),
  );
  const activeStep = ready.find((step) => step.resolution === 'running') ?? ready[0];
  for (const step of steps) {
    step.status = step.resolution === 'resolved'
      ? 'resolved'
      : step.id === activeStep?.id
        ? 'active'
        : !hasResolvedPredecessorPath(step)
          ? 'waiting'
          : 'ready';
  }
  const unresolvedCount = steps.filter((step) => step.resolution !== 'resolved').length;
  return {
    activeStepId: activeStep?.id,
    completed: steps.length > 0 && unresolvedCount === 0,
    fingerprint: steps.map((step) =>
      step.id + ':' + step.status + ':' + String(step.current === true),
    ).join('|'),
    resolvedCount: steps.length - unresolvedCount,
    stages: Math.max(0, ...steps.map((step) => step.level)) + (steps.length > 0 ? 1 : 0),
    steps,
    stepById,
    supportingCount,
    unresolvedCount,
  };
}

/** Produces a compact blocker category without leaking package- or project-specific semantics. */
function formatPreviewInspectorBlockerFlowKind(node) {
  if (isPreviewInspectorConditionNode(node)) return 'Branch condition';
  if (node?.blockerKind === 'target-reachability') return 'Target not reached';
  if (node?.blockerKind === 'runtime-fallback') return 'Hook needs value';
  if (node?.blockerKind === 'data-request') return 'Backend data needed';
  if (node?.blockerKind === 'target-error') return 'Component crashed';
  return 'Blocker';
}

/** Labels one flow state in action-oriented language. */
function formatPreviewInspectorBlockerFlowStatus(status) {
  if (status === 'resolved') return 'Resolved';
  if (status === 'active') return 'Fix this first';
  if (status === 'waiting') return 'Blocked by an earlier step';
  return 'Can fix now';
}

/** Labels each read-only Render-flow context without inventing project-specific semantics. */
function formatPreviewInspectorRenderFlowContextKind(step) {
  if (step.kind === 'return') return 'Selected return JSX';
  if (step.node?.currentFileExport === true) return 'Current file function';
  if (step.node?.contextOnly === true) return 'Entry / route context';
  if ((step.ownerIds?.length ?? 0) <= 1) return 'Application root';
  return 'Child component';
}

/** Selects a Render-flow step and keeps the primary Blockers navigation synchronized. */
function selectPreviewInspectorBlockerFlowStep(step, setSelectedStepId) {
  setSelectedStepId(step.id);
  previewInspectorDevtoolsSessionState.navigationTab = 'blockers';
  previewInspectorDevtoolsSessionState.selectedBlockerFlowNodeId = step.id;
  previewInspectorDevtoolsSessionState.blockerDetailRevision =
    (previewInspectorDevtoolsSessionState.blockerDetailRevision ?? 0) + 1;
  persistPreviewInspectorState();
  notifyPreviewInspector();
}

/** Reveals a blocker only after an explicit request, preserving component selection while graphing. */
function revealPreviewInspectorBlockerFlowStepInComponents(step) {
  if (step?.current !== true || typeof step.node?.id !== 'string') return;
  previewInspectorDevtoolsSessionState.navigationTab = 'components';
  previewInspectorDevtoolsSessionState.detailsTab = 'blocker';
  requestPreviewInspectorTreeReveal(step.node.id);
  selectPreviewInspectorUiNode(step.node);
}

/** Renders safe authored/effective branch state and a direct switch only for compiler-issued logic. */
function PreviewInspectorRenderFlowConditionSwitch({ step }) {
  if (!isPreviewInspectorConditionNode(step.node) || step.current !== true) return undefined;
  const condition = step.node.condition;
  const effective = condition.effectiveEnabled === true;
  const authored = condition.authoredEnabled === true;
  const overridden = typeof condition.override === 'boolean' ||
    typeof condition.autoOverride === 'boolean';
  return React.createElement(
    'div',
    { className: 'rpi-flow-condition-controls' },
    React.createElement(
      'span',
      { className: 'rpi-flow-condition-state' },
      'Authored: ' + String(authored) + ' · Effective: ' + String(effective),
    ),
    React.createElement(
      PreviewInspectorDevtoolsButton,
      {
        onClick: () => setPreviewInspectorRenderConditionOverride(condition.id, !effective),
        pressed: effective,
        title: 'Switch this compiler-instrumented JSX branch and remount its page context',
      },
      effective ? 'Switch false' : 'Switch true',
    ),
    React.createElement(
      PreviewInspectorDevtoolsButton,
      {
        disabled: !overridden,
        onClick: () => resetPreviewInspectorRenderConditionOverride(condition.id),
        title: 'Restore the authored runtime branch value',
      },
      'Use authored',
    ),
  );
}

/** Renders the selected node's existing editor inline, directly below its graph card. */
function PreviewInspectorRenderFlowNodeEditor({ step }) {
  const contextOnly = step.flowKind === 'component-context' ||
    step.kind === 'component' || step.kind === 'return';
  if (contextOnly) {
    return React.createElement(
      'section',
      { className: 'rpi-flow-node-editor rpi-flow-context-editor' },
      React.createElement('strong', undefined,
        step.kind === 'return' ? 'Selected return JSX' : 'Read-only render context'),
      React.createElement(
        'span',
        { className: 'rpi-note' },
        String(step.detail ?? ('Function/component call · ' +
          String(step.node.edgeKind ?? step.node.kind ?? 'component'))),
      ),
      React.createElement(PreviewInspectorSourceDetail, { node: step.node }),
    );
  }
  return React.createElement(
    'section',
    { className: 'rpi-flow-node-editor', 'data-flow-status': step.status },
    React.createElement(
      'div',
      { className: 'rpi-flow-editor-heading' },
      React.createElement('strong', undefined, 'Adjust · ' + step.node.name),
      React.createElement('span', { className: 'rpi-badge' },
        formatPreviewInspectorBlockerFlowStatus(step.status)),
      step.current === true
        ? React.createElement(
            PreviewInspectorDevtoolsButton,
            {
              onClick: () => revealPreviewInspectorBlockerFlowStepInComponents(step),
              title: 'Switch to Components and reveal this blocker at its owner path',
            },
            'Reveal in Components',
          )
        : undefined,
    ),
    step.current === true
      ? React.createElement(PreviewInspectorBlockerDetail, { node: step.node })
      : React.createElement('div', { className: 'rpi-note' },
          'This step no longer exists in the current render tree and remains as solved history.'),
  );
}

/** Renders one context, logic, or runtime step with immediate safe controls at the graph node. */
function PreviewInspectorRenderFlowNode({ flow, onSelect, selectedStepId, step }) {
  const selected = step.id === selectedStepId;
  const contextOnly = step.flowKind === 'component-context' ||
    step.kind === 'component' || step.kind === 'return';
  const directCurrentFileBlocker = step.directCurrentFileBlocker === true;
  const nodeName = step.label ?? step.node.name;
  const ownerNames = Array.isArray(step.ownerNames) ? step.ownerNames : [];
  const contextKind = contextOnly
    ? formatPreviewInspectorRenderFlowContextKind(step)
    : undefined;
  return React.createElement(
    'div',
    {
      className: 'rpi-flow-node-shell',
      'data-current-file-blocker': String(directCurrentFileBlocker),
      'data-flow-kind': contextOnly ? 'context' : 'blocker',
      'data-selected': selected,
    },
    React.createElement(
      'button',
      {
        'aria-expanded': selected,
        'aria-label': (contextOnly
          ? 'Inspect render context: '
          : directCurrentFileBlocker
            ? 'Adjust current file blocker: '
            : 'Adjust blocker: ') + nodeName,
        'aria-pressed': selected,
        className: 'rpi-flow-card',
        'data-flow-status': step.status,
        onClick: () => onSelect(step),
        title: contextOnly
          ? 'Inspect this read-only function/component render context'
          : step.current === true
            ? 'Open this blocker\'s existing resolution options'
            : 'This blocker disappeared after a previous resolution',
        type: 'button',
      },
      React.createElement(
        'span',
        { className: 'rpi-flow-node' },
        contextOnly
          ? step.kind === 'return' ? '↳' : 'C'
          : step.status === 'resolved' ? '✓' : String(flow.steps.indexOf(step) + 1),
      ),
      React.createElement(
        'span',
        { className: 'rpi-flow-card-body' },
        React.createElement(
          'span',
          { className: 'rpi-flow-card-heading' },
          React.createElement('strong', undefined, nodeName),
          React.createElement('span', { className: 'rpi-badge' },
            contextOnly ? contextKind : formatPreviewInspectorBlockerFlowKind(step.node)),
          directCurrentFileBlocker
            ? React.createElement(
                'span',
                { className: 'rpi-badge rpi-current-file-blocker-badge' },
                'CURRENT FILE BLOCKER',
              )
            : undefined,
        ),
        React.createElement('span', { className: 'rpi-flow-status' },
          contextOnly ? contextKind + ' · read-only' : formatPreviewInspectorBlockerFlowStatus(step.status)),
        React.createElement('span', { className: 'rpi-flow-owner' },
          ownerNames.join(' › ') || 'Workspace React root'),
        typeof step.detail === 'string'
          ? React.createElement('span', { className: 'rpi-flow-detail' }, step.detail)
          : undefined,
        step.predecessorIds.length > 0
          ? React.createElement('span', { className: 'rpi-flow-relation' },
              'After → ' + step.predecessorIds
                .map((id) => {
                  const predecessor = flow.stepById.get(id);
                  return predecessor?.label ?? predecessor?.node.name ?? id;
                })
                .join(', '))
          : React.createElement('span', { className: 'rpi-flow-relation' }, 'Render flow entry'),
        React.createElement('span', { className: 'rpi-flow-action' },
          selected ? 'Options open' : contextOnly ? 'Inspect context' : 'Adjust options'),
      ),
    ),
    React.createElement(PreviewInspectorRenderFlowConditionSwitch, { step }),
    selected ? React.createElement(PreviewInspectorRenderFlowNodeEditor, { step }) : undefined,
  );
}

/** Renders one stage of parallel cards in the root-to-target blocker DAG. */
function PreviewInspectorBlockerFlowStage({ flow, level, onSelect, selectedStepId }) {
  const steps = flow.steps.filter((step) => step.level === level);
  return React.createElement(
    'section',
    { className: 'rpi-flow-stage', 'data-stage': String(level + 1) },
    React.createElement(
      'div',
      { className: 'rpi-flow-stage-label' },
      (level === 0 ? 'Enter' : 'Then ↓') + ' · Stage ' + String(level + 1),
    ),
    React.createElement(
      'div',
      { className: 'rpi-flow-stage-grid' },
      steps.map((step) => React.createElement(PreviewInspectorRenderFlowNode, {
        flow,
        key: step.id,
        onSelect,
        selectedStepId,
        step,
      })),
    ),
  );
}

/**
 * Renders the staged JSX Render flow and expands the selected node's existing editor in place. When
 * the chosen blocker resolves or disappears, selection advances to the next ready step automatically.
 */
function PreviewInspectorBlockerFlowDetail({ flow }) {
  const initialId = previewInspectorDevtoolsSessionState.selectedBlockerFlowNodeId;
  const [selectedStepId, setSelectedStepId] = React.useState(
    () => flow.stepById.has(initialId)
      ? initialId
      : flow.activeStepId ?? flow.steps.at(-1)?.id,
  );
  const previousSelection = React.useRef(undefined);
  const externalSelectionRevision =
    previewInspectorDevtoolsSessionState.blockerDetailRevision ?? 0;
  React.useEffect(() => {
    const requestedId = previewInspectorDevtoolsSessionState.selectedBlockerFlowNodeId;
    if (requestedId !== selectedStepId && flow.stepById.has(requestedId)) {
      setSelectedStepId(requestedId);
      previousSelection.current = undefined;
      return;
    }
    const selected = flow.stepById.get(selectedStepId);
    const previous = previousSelection.current;
    const becameResolved = previous?.id === selectedStepId &&
      previous.resolution !== 'resolved' && selected?.resolution === 'resolved';
    const restoredResolvedSelection = previous === undefined &&
      selected?.resolution === 'resolved' && flow.activeStepId !== undefined;
    if (selected === undefined || becameResolved || restoredResolvedSelection) {
      const next = flow.stepById.get(flow.activeStepId) ?? flow.steps.at(-1);
      if (next !== undefined && next.id !== selectedStepId) {
        selectPreviewInspectorBlockerFlowStep(next, setSelectedStepId);
        previousSelection.current = { id: next.id, resolution: next.resolution };
        return;
      }
    }
    previousSelection.current = selected === undefined
      ? undefined
      : { id: selected.id, resolution: selected.resolution };
  }, [externalSelectionRevision, flow.fingerprint, selectedStepId]);
  const selectedStep = flow.stepById.get(selectedStepId) ??
    flow.stepById.get(flow.activeStepId) ?? flow.steps.at(-1);
  const actionableCount = Number.isSafeInteger(flow.actionableCount)
    ? flow.actionableCount
    : flow.steps.length;
  const progress = actionableCount === 0 ? 100 : flow.resolvedCount / actionableCount * 100;
  const activeStep = flow.stepById.get(flow.activeStepId);
  return React.createElement(
    'div',
    { className: 'rpi-blocker-flow' },
    React.createElement(
      'div',
      { className: 'rpi-flow-summary' },
      React.createElement('strong', undefined,
        flow.unresolvedCount === 0
          ? 'Page path is clear'
          : String(flow.unresolvedCount) + ' required fix(es) remaining'),
      React.createElement('span', { className: 'rpi-meta' },
        String(flow.resolvedCount) + ' / ' + String(actionableCount) + ' blockers resolved'),
      flow.supportingCount > 0
        ? React.createElement('span', { className: 'rpi-meta' },
            String(flow.supportingCount) + ' supporting page blocker(s) remain in Components')
        : undefined,
      React.createElement(
        'div',
        { 'aria-label': 'Blocker resolution progress', className: 'rpi-flow-progress', role: 'progressbar',
          'aria-valuemax': 100, 'aria-valuemin': 0, 'aria-valuenow': Math.round(progress) },
        React.createElement('span', { style: { width: String(progress) + '%' } }),
      ),
      activeStep === undefined
        ? undefined
        : React.createElement(
            PreviewInspectorDevtoolsButton,
            {
              onClick: () => selectPreviewInspectorBlockerFlowStep(
                activeStep,
                setSelectedStepId,
              ),
              title: 'Select the first blocker whose predecessors are resolved',
            },
            'Show next fix',
          ),
    ),
    flow.steps.length === 0
      ? React.createElement('div', { className: 'rpi-empty' },
          'No rendering blockers were found between the page and current file.')
      : React.createElement(
          'div',
          { 'aria-label': 'Blocker dependency flow chart' },
          React.createElement(PreviewInspectorFlowchart, {
            flow,
            onSelect: (step) => selectPreviewInspectorBlockerFlowStep(step, setSelectedStepId),
            selectedStep,
            selectedStepId,
          }),
        ),
  );
}

/**
 * Adapts the richer function-entry/condition/return/child model to the graph and resolver surfaces.
 * Both panes consume this one view so a selected block never resolves against a different identity.
 */
function createPreviewInspectorRenderFlowChartView(flow) {
  const hasRenderPath = Array.isArray(flow.renderSteps) && flow.renderSteps.length > 0;
  const renderSteps = hasRenderPath ? flow.renderSteps : flow.steps;
  const renderStepById = hasRenderPath && flow.renderStepById instanceof Map
    ? flow.renderStepById
    : new Map(renderSteps.map((step) => [step.id, step]));
  const graphNodes = Array.isArray(flow.graphNodes) && flow.graphNodes.length > 0
    ? flow.graphNodes
    : renderSteps;
  const graphStepById = new Map(renderStepById);
  for (const step of graphNodes) graphStepById.set(step.id, step);
  const renderStages = hasRenderPath && Number.isSafeInteger(flow.renderStages)
    ? flow.renderStages
    : flow.stages;
  return {
    ...flow,
    actionableCount: flow.steps.length,
    graphNodes,
    stages: renderStages,
    stepById: graphStepById,
    steps: graphNodes,
  };
}

/**
 * Adapts the richer function-entry/condition/return/child model to the existing graph viewer.
 * Runtime blocker counts remain actionable progress while read-only component context stays visible.
 */
function PreviewInspectorRenderFlowDetail({ flow }) {
  const chartFlow = createPreviewInspectorRenderFlowChartView(flow);
  return React.createElement(
    'div',
    { className: 'rpi-render-flow-navigation' },
    React.createElement(
      'div',
      { className: 'rpi-render-flow-guide' },
      React.createElement('strong', undefined, 'Render flow'),
      React.createElement(
        'span',
        { className: 'rpi-note' },
        'JSX function entry → guard / condition → selected return JSX → child render',
      ),
      flow.renderTruncated === true
        ? React.createElement(
            'span',
            { className: 'rpi-meta' },
            'Bounded Render flow · additional child output was omitted after the safe depth/step limit.',
          )
        : undefined,
      flow.directCurrentFileBlockerCount > 0
        ? React.createElement(
            'span',
            { className: 'rpi-current-file-blocker-summary' },
            String(flow.directCurrentFileBlockerCount) + ' direct current-file blocker(s)',
          )
        : undefined,
    ),
    React.createElement(PreviewInspectorBlockerFlowDetail, { flow: chartFlow }),
  );
}
`;
}
