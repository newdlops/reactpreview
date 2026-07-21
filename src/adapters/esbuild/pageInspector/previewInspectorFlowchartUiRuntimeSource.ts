/**
 * Generates the debugger-style render-flow chart used by React Page Inspector.
 *
 * The React surface consumes only the bounded layout model and existing blocker editors. Nodes are
 * ordinary buttons and connectors are ordinary div cells, keeping the complete chart interactive in
 * the separately mirrored companion tab without SVG or inline style privileges.
 */

/**
 * Creates browser-side React components for graph nodes, orthogonal edges, keyboard traversal, and
 * the stable selection editor rendered below the canvas.
 *
 * Expected lexical bindings include React, `createPreviewInspectorFlowchartLayout`, the existing
 * condition/blocker formatters and editors, and the Blockers panel's selection callback.
 *
 * @returns Plain JavaScript source concatenated after the flowchart layout helpers.
 */
export function createPreviewInspectorFlowchartUiRuntimeSource(): string {
  return String.raw`
/** Labels graph semantics independently from the underlying component/blocker record kind. */
function formatPreviewInspectorFlowchartGraphKind(graphKind) {
  if (graphKind === 'entry') return 'Function entry';
  if (graphKind === 'decision') return 'Decision';
  if (graphKind === 'branch') return 'Branch output';
  if (graphKind === 'join') return 'Branch join';
  if (graphKind === 'return') return 'Return JSX';
  if (graphKind === 'hoc') return 'Higher-order component';
  if (graphKind === 'component-slot') return 'Component prop / slot';
  if (graphKind === 'blocker') return 'Render blocker';
  return 'Component render';
}

/** Chooses a compact, text-independent node symbol while keeping the full meaning in its label. */
function readPreviewInspectorFlowchartNodeSymbol(graphKind) {
  if (graphKind === 'entry') return '▶';
  if (graphKind === 'decision') return '?';
  if (graphKind === 'branch') return '⑂';
  if (graphKind === 'join') return '●';
  if (graphKind === 'return') return '↩';
  if (graphKind === 'hoc') return 'H';
  if (graphKind === 'component-slot') return 'P';
  if (graphKind === 'blocker') return '!';
  return 'C';
}

/** Reads a bounded graph label without assuming every synthetic join owns a component-tree node. */
function readPreviewInspectorFlowchartNodeName(step) {
  const value = step?.label ?? step?.node?.name ?? formatPreviewInspectorFlowchartGraphKind(step?.graphKind);
  return String(value ?? 'Render step').slice(0, 180);
}

/** Describes incoming and outgoing graph relationships for non-visual navigation. */
function describePreviewInspectorFlowchartNodeRelations(layout, step) {
  const predecessors = layout.predecessorIdsByNode.get(step.id) ?? [];
  const outgoing = layout.edges.filter((edge) => edge.fromId === step.id);
  const predecessorText = predecessors.length === 0
    ? 'Flow entry.'
    : 'After ' + predecessors.map((id) =>
        readPreviewInspectorFlowchartNodeName(layout.nodeById.get(id))).join(', ') + '.';
  const outgoingText = outgoing.length === 0
    ? ' Terminal step.'
    : ' Next: ' + outgoing.map((edge) => {
        const label = edge.label.length > 0 ? edge.label + ' to ' : '';
        const state = edge.active === true ? 'active' : 'inactive';
        return label + readPreviewInspectorFlowchartNodeName(layout.nodeById.get(edge.toId)) +
          ' (' + state + ')';
      }).join(', ') + '.';
  return predecessorText + outgoingText;
}

/**
 * Builds Main scope only from the render model's deterministic application-entry path. Current-file
 * context adds only the selected export's authored JSX return choices. The DFS component inventory
 * remains available in All and the outcome Inspector, but does not turn Main back into a dense
 * component dump. A target-related locator is used only as a legacy/blocked fallback when a
 * snapshot predates shortest-path metadata.
 */
function createPreviewInspectorFlowchartMajorPath(flow, layout, locator) {
  const nodeIds = new Set((flow?.mainPathNodeIds ?? []).filter((id) =>
    layout.nodeById.has(id)));
  const edgeIds = new Set((flow?.mainPathEdgeIds ?? []).filter((id) =>
    layout.edges.some((edge) => edge.id === id)));
  const currentFileContextIds = new Set();
  const outcomeChoiceIds = flow?.currentFileOutcomeChoiceNodeIds ??
    flow?.currentFileOutcomeNodeIds ?? [];
  const staticOutcomeIds = new Set(outcomeChoiceIds.filter((id) =>
    layout.nodeById.has(id)));
  if (staticOutcomeIds.size > 0) {
    for (const id of staticOutcomeIds) {
      currentFileContextIds.add(id);
      nodeIds.add(id);
    }
    const outcomeEdgeIds = flow?.currentFileOutcomeChoiceEdgeIds ??
      flow?.currentFileOutcomeEdgeIds ?? [];
    for (const id of outcomeEdgeIds) {
      if (layout.edges.some((edge) => edge.id === id)) edgeIds.add(id);
    }
  } else {
    for (const step of layout.orderedNodes) {
      if (step.currentFileContext !== true) continue;
      currentFileContextIds.add(step.id);
      nodeIds.add(step.id);
    }
  }
  if (nodeIds.size === 0 && layout.nodeById.has(locator?.step?.id)) {
    nodeIds.add(locator.step.id);
  }
  for (const edge of layout.edges) {
    if (
      currentFileContextIds.has(edge.fromId) &&
      currentFileContextIds.has(edge.toId)
    ) {
      edgeIds.add(edge.id);
    }
  }
  return { edgeIds, nodeIds };
}

/**
 * Filters Main without synthesizing bridge edges, preserving each compiler/runtime edge kind.
 * Selection and active blocker state never alter this product path; they remain available in Focus
 * and All plus the independent resolver pane.
 */
function createPreviewInspectorFlowchartMainFlow(flow, layout, majorPath) {
  const retainedNodes = layout.orderedNodes.filter((node) => majorPath.nodeIds.has(node.id));
  const retainedIds = new Set(retainedNodes.map((node) => node.id));
  const retainedEdges = layout.edges.filter((edge) =>
    majorPath.edgeIds.has(edge.id) &&
    retainedIds.has(edge.fromId) &&
    retainedIds.has(edge.toId));
  return {
    ...flow,
    fingerprint: String(flow?.fingerprint ?? '') + '::main-path:' +
      retainedNodes.map((node) => node.id).join(','),
    focusOmittedNodeCount: Math.max(0, layout.orderedNodes.length - retainedNodes.length),
    focusSourceNodeCount: layout.orderedNodes.length,
    graphEdges: retainedEdges,
    graphNodes: retainedNodes,
    steps: retainedNodes,
  };
}

/**
 * Keeps the canvas's roving selection valid when Main excludes the resolver's unrelated record.
 * This presentation fallback does not mutate the authoritative Inspector selection or graph scope.
 */
function readPreviewInspectorFlowchartVisibleSelectionId(
  layout,
  selectedGraphStepId,
  locator,
  flow,
) {
  if (layout.nodeById.has(selectedGraphStepId)) return selectedGraphStepId;
  return [locator?.currentFileStepId, flow?.mainPathTargetStepId, flow?.mainPathEntryStepId]
    .find((id) => layout.nodeById.has(id)) ?? layout.orderedNodes[0]?.id;
}

/** Selects the strongest edge for debugger Left/Right traversal without inventing dependencies. */
function selectPreviewInspectorFlowchartNavigationEdge(edges) {
  return [...edges].sort((left, right) =>
    Number(right.active === true) - Number(left.active === true) ||
    Number(left.certainty === 'conditional') - Number(right.certainty === 'conditional') ||
    left.id.localeCompare(right.id))[0];
}

/** Resolves one debugger navigation key against explicit predecessors, successors, ranks, and lanes. */
function readPreviewInspectorFlowchartKeyboardTarget(layout, selectedId, key) {
  const current = layout.nodeById.get(selectedId) ?? layout.orderedNodes[0];
  if (current === undefined) return undefined;
  if (key === 'Home') return layout.orderedNodes[0];
  if (key === 'End') return layout.orderedNodes.at(-1);
  if (key === 'ArrowLeft') {
    const edge = selectPreviewInspectorFlowchartNavigationEdge(
      layout.edges.filter((candidate) => candidate.toId === current.id),
    );
    return edge === undefined ? current : layout.nodeById.get(edge.fromId) ?? current;
  }
  if (key === 'ArrowRight') {
    const edge = selectPreviewInspectorFlowchartNavigationEdge(
      layout.edges.filter((candidate) => candidate.fromId === current.id),
    );
    return edge === undefined ? current : layout.nodeById.get(edge.toId) ?? current;
  }
  if (key === 'ArrowUp' || key === 'ArrowDown') {
    const direction = key === 'ArrowUp' ? -1 : 1;
    const sameRank = layout.orderedNodes
      .filter((candidate) => candidate.rank === current.rank)
      .sort((left, right) => left.lane - right.lane);
    const currentIndex = sameRank.findIndex((candidate) => candidate.id === current.id);
    return sameRank[currentIndex + direction] ?? current;
  }
  return undefined;
}

/** Handles roving debugger navigation while leaving ordinary Tab behavior to the browser. */
function navigatePreviewInspectorFlowchart(event, layout, selectedStepId, onSelect) {
  if (!['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown', 'Home', 'End'].includes(event.key)) {
    return;
  }
  const target = readPreviewInspectorFlowchartKeyboardTarget(layout, selectedStepId, event.key);
  if (target === undefined) return;
  event.preventDefault();
  onSelect(target);
}

/** Renders one compact flowchart node; its full editor remains outside the geometry-stable canvas. */
function PreviewInspectorFlowchartNode({ layout, majorPath, onSelect, selectedStepId, step }) {
  const selected = step.id === selectedStepId;
  const directCurrentFileBlocker = step.directCurrentFileBlocker === true;
  const currentFile = step.currentFileTarget === true;
  const staticCurrentFile = step.staticCurrentFileTarget === true ||
    (!currentFile && step.graphKind === 'entry' && step.node?.currentFileExport === true);
  const currentFileContext = currentFile ||
    (!staticCurrentFile && step.currentFileContext === true);
  const nodeName = readPreviewInspectorFlowchartNodeName(step);
  const graphKindLabel = formatPreviewInspectorFlowchartGraphKind(step.graphKind);
  const ownerNames = Array.isArray(step.ownerNames) ? step.ownerNames : [];
  const relation = describePreviewInspectorFlowchartNodeRelations(layout, step);
  const inferred = step.node?.certainty === 'conditional';
  const majorFlow = directCurrentFileBlocker || currentFileContext || staticCurrentFile ||
    majorPath.nodeIds.has(step.id);
  const stateLabel = directCurrentFileBlocker
    ? 'CURRENT FILE BLOCKER'
    : currentFile
      ? 'Current file render context'
      : currentFileContext
        ? 'Current-file control and value flow'
        : staticCurrentFile
          ? 'Static current-file render evidence'
          : step.branchState === 'inactive'
            ? 'Dormant branch'
            : step.status === 'active'
              ? 'Fix this first'
              : 'Active render path';
  if (step.graphKind === 'join') {
    return React.createElement(
      'button',
      {
        'aria-label': graphKindLabel + ': ' + nodeName + '. ' + relation,
        'aria-pressed': selected,
        className: 'rpi-flowchart-node',
        'data-rpi-branch-state': step.branchState,
        'data-rpi-flow-status': step.status,
        'data-rpi-graph-kind': step.graphKind,
        'data-rpi-current-file-context': String(currentFileContext || staticCurrentFile),
        'data-rpi-current-file-static': String(staticCurrentFile),
        'data-rpi-current-file': String(currentFile),
        'data-rpi-flow-certainty': inferred ? 'conditional' : 'confirmed',
        'data-rpi-flowchart-node': step.id,
        'data-rpi-major-flow': String(majorFlow),
        onClick: () => onSelect(step),
        onKeyDown: (event) => navigatePreviewInspectorFlowchart(
          event,
          layout,
          selectedStepId,
          onSelect,
        ),
        tabIndex: selected ? 0 : -1,
        title: nodeName,
        type: 'button',
      },
      React.createElement('span', { className: 'rpi-flowchart-node-symbol' }, '●'),
    );
  }
  return React.createElement(
    'button',
    {
      'aria-label': graphKindLabel + ': ' + nodeName + '. ' +
        (step.branchState === 'inactive' ? 'Inactive branch. ' : 'Active path. ') + relation,
      'aria-pressed': selected,
      className: 'rpi-flowchart-node',
      'data-rpi-branch-state': step.branchState,
      'data-rpi-current-file-blocker': String(directCurrentFileBlocker),
      'data-rpi-current-file-context': String(currentFileContext || staticCurrentFile),
      'data-rpi-current-file-static': String(staticCurrentFile),
      'data-rpi-current-file-path-blocker': String(
        directCurrentFileBlocker || step.node?.blockerKind === 'target-reachability',
      ),
      'data-rpi-current-file': String(currentFile),
      'data-rpi-flow-status': step.status,
      'data-rpi-flow-certainty': inferred ? 'conditional' : 'confirmed',
      'data-rpi-graph-kind': step.graphKind,
      'data-rpi-flowchart-node': step.id,
      'data-rpi-major-flow': String(majorFlow),
      onClick: () => onSelect(step),
      onKeyDown: (event) => navigatePreviewInspectorFlowchart(
        event,
        layout,
        selectedStepId,
        onSelect,
      ),
      tabIndex: selected ? 0 : -1,
      title: nodeName + ' · ' + graphKindLabel,
      type: 'button',
    },
    React.createElement(
      'span',
      { className: 'rpi-flowchart-node-symbol' },
      readPreviewInspectorFlowchartNodeSymbol(step.graphKind),
    ),
    React.createElement(
      'span',
      { className: 'rpi-flowchart-node-label' },
      React.createElement(
        'strong',
        { title: nodeName },
        nodeName,
      ),
      currentFile
        ? React.createElement(
            'span',
            { className: 'rpi-flowchart-node-target' },
            'CURRENT',
          )
        : directCurrentFileBlocker
          ? React.createElement(
              'span',
              { className: 'rpi-flowchart-node-target' },
              'BLOCKED',
            )
        : undefined,
      React.createElement(
        'span',
        { className: 'rpi-visually-hidden' },
        graphKindLabel + '. ' + stateLabel + '. ' +
          (step.branchLabel.length > 0 ? 'Branch ' + step.branchLabel + '. ' : '') +
          'Owner ' + (ownerNames.join(' › ') || 'Workspace React root') + '. ' + relation,
      ),
    ),
  );
}

/** Renders one fixed-height lane slot so every rank and connector shares the same vertical grid. */
function PreviewInspectorFlowchartLane({ layout, majorPath, node, onSelect, selectedStepId }) {
  return React.createElement(
    'div',
    { className: 'rpi-flowchart-lane' },
    node === undefined
      ? undefined
      : React.createElement(PreviewInspectorFlowchartNode, {
          layout,
          majorPath,
          onSelect,
          selectedStepId,
          step: node,
        }),
  );
}

/** Renders one rank of debugger nodes using an explicit placeholder for every absent lane. */
function PreviewInspectorFlowchartRank({ layout, majorPath, onSelect, rank, selectedStepId }) {
  return React.createElement(
    'section',
    { className: 'rpi-flowchart-rank', 'data-rpi-flowchart-rank': String(rank.rank) },
    React.createElement(
      'div',
      { className: 'rpi-flowchart-rank-label' },
      rank.rank === 0 ? 'Start · Rank 1' : 'Then · Rank ' + String(rank.rank + 1),
    ),
    React.createElement(
      'div',
      { className: 'rpi-flowchart-rank-lanes' },
      rank.nodesByLane.map((node, lane) => React.createElement(PreviewInspectorFlowchartLane, {
        key: String(rank.rank) + ':' + String(lane),
        layout,
        majorPath,
        node,
        onSelect,
        selectedStepId,
      })),
    ),
  );
}

/** Renders one edge route as horizontal and vertical CSS border segments across repeated lane cells. */
function PreviewInspectorFlowchartEdgeTrack({ majorPath, segment }) {
  return React.createElement(
    'div',
    {
      'aria-hidden': 'true',
      className: 'rpi-flowchart-edge-track',
      'data-rpi-active': String(segment.active === true),
      'data-rpi-certainty': segment.certainty,
      'data-rpi-flowchart-edge': segment.id,
      'data-rpi-major-flow': String(majorPath.edgeIds.has(segment.id)),
      'data-rpi-track': String(segment.track),
      title: segment.label || segment.kind,
    },
    segment.cells.map((cell) => React.createElement(
      'div',
      {
        className: 'rpi-flowchart-edge-cell',
        'data-rpi-path': cell.path,
        key: segment.id + ':' + String(cell.lane),
      },
      cell.lane === segment.sourceLane && segment.label.length > 0
        ? React.createElement(
            'span',
            { className: 'rpi-flowchart-edge-label', title: segment.label },
            segment.label,
          )
        : undefined,
      segment.terminal === true && cell.lane === segment.targetLane
        ? React.createElement('span', { className: 'rpi-flowchart-edge-arrow' }, '›')
        : undefined,
    )),
  );
}

/** Renders all bounded routes between adjacent ranks, including an explicit overflow summary. */
function PreviewInspectorFlowchartConnector({ majorPath, transition }) {
  return React.createElement(
    'section',
    { className: 'rpi-flowchart-connector' },
    React.createElement(
      'div',
      { className: 'rpi-flowchart-connector-label' },
      transition.omittedCount > 0 ? '+' + String(transition.omittedCount) + ' paths' : '',
    ),
    React.createElement(
      'div',
      { className: 'rpi-flowchart-edge-stack' },
      transition.segments.map((segment) => React.createElement(
        PreviewInspectorFlowchartEdgeTrack,
        { key: segment.id + ':' + String(transition.rank), majorPath, segment },
      )),
    ),
  );
}

/** Renders a screen-reader relationship inventory because visual orthogonal segments are decorative. */
function PreviewInspectorFlowchartAccessibleRelations({ layout }) {
  return React.createElement(
    'ol',
    { className: 'rpi-visually-hidden' },
    layout.edges.map((edge) => React.createElement(
      'li',
      { key: edge.id },
      readPreviewInspectorFlowchartNodeName(layout.nodeById.get(edge.fromId)) + ' to ' +
        readPreviewInspectorFlowchartNodeName(layout.nodeById.get(edge.toId)) +
        (edge.label.length > 0 ? ' through ' + edge.label : '') +
        '. ' + (edge.active === true ? 'Active path.' : 'Inactive path.'),
    )),
  );
}

/**
 * Creates a bounded identity for the actual visible node set, not the current selection. Companion
 * camera state can therefore refit when Focus/Main geometry changes without resetting user pan and
 * zoom merely because another already-visible node was inspected.
 */
function createPreviewInspectorFlowchartCameraKey(viewMode, layout) {
  let hash = 2166136261;
  for (const node of layout.orderedNodes) {
    for (let index = 0; index < node.id.length; index += 1) {
      hash ^= node.id.charCodeAt(index);
      hash = Math.imul(hash, 16777619);
    }
    hash ^= 31;
    hash = Math.imul(hash, 16777619);
  }
  return viewMode + ':' + String(layout.orderedNodes.length) + ':' +
    String(hash >>> 0).toString(36);
}

/**
 * Renders one deterministic debugger canvas with companion-local camera controls.
 * The alternating rank/connector DOM is intentionally compatible with companion sanitization.
 */
function PreviewInspectorFlowchart({ flow, onSelect, selectedStep, selectedStepId }) {
  const completeLayout = React.useMemo(
    () => createPreviewInspectorFlowchartLayout(flow),
    [flow.fingerprint],
  );
  const locator = React.useMemo(
    () => locatePreviewInspectorFlowchartCurrentFile(flow, completeLayout),
    [flow.fingerprint, completeLayout],
  );
  const completeMajorPath = React.useMemo(
    () => createPreviewInspectorFlowchartMajorPath(flow, completeLayout, locator),
    [flow.fingerprint, completeLayout, locator],
  );
  // Resolver selection remains an exact full-graph identity for Focus and All. Main deliberately
  // ignores it while choosing graph membership; a visible roving fallback is selected below.
  const selectedGraphStepId = completeLayout.nodeById.has(selectedStepId)
    ? selectedStepId
    : completeLayout.nodeById.has(selectedStep?.id)
      ? selectedStep.id
      : undefined;
  const mainFlow = React.useMemo(
    () => createPreviewInspectorFlowchartMainFlow(flow, completeLayout, completeMajorPath),
    [flow.fingerprint, completeLayout, completeMajorPath],
  );
  const primaryFocusStepId = selectedGraphStepId ?? locator.nearestBlockerStepId ??
    locator.currentFileStepId ??
    (completeLayout.nodeById.has(flow.activeStepId) ? flow.activeStepId : locator.step?.id);
  const focusNodeIds = React.useMemo(
    () => createPreviewInspectorFlowchartNeighborhood(
      completeLayout,
      typeof primaryFocusStepId === 'string' ? [primaryFocusStepId] : [],
      2,
    ),
    [completeLayout, primaryFocusStepId],
  );
  const focusFlow = React.useMemo(
    () => createPreviewInspectorFocusedFlowchartFlow(
      flow,
      completeLayout,
      focusNodeIds,
      typeof primaryFocusStepId === 'string' ? [primaryFocusStepId] : [],
      PREVIEW_INSPECTOR_FLOWCHART_FOCUS_NODE_LIMIT,
      false,
    ),
    [flow.fingerprint, completeLayout, focusNodeIds, primaryFocusStepId],
  );
  const storedViewMode = previewInspectorDevtoolsSessionState.flowchartViewMode;
  const viewMode = storedViewMode === 'focus' || storedViewMode === 'main' || storedViewMode === 'all'
    ? storedViewMode
    : 'main';
  const visibleFlow = viewMode === 'all' ? flow : viewMode === 'main' ? mainFlow : focusFlow;
  const layout = React.useMemo(
    () => viewMode === 'all'
      ? completeLayout
      : createPreviewInspectorFlowchartLayout(visibleFlow),
    [completeLayout, visibleFlow.fingerprint, viewMode],
  );
  const majorPath = React.useMemo(
    () => viewMode === 'all'
      ? completeMajorPath
      : {
          edgeIds: new Set(layout.edges.map((edge) => edge.id)),
          nodeIds: new Set(layout.orderedNodes.map((node) => node.id)),
        },
    [completeMajorPath, layout, viewMode],
  );
  const cameraKey = React.useMemo(
    () => createPreviewInspectorFlowchartCameraKey(viewMode, layout),
    [layout, viewMode],
  );
  const inspectorCollapsed = previewInspectorDevtoolsSessionState.flowchartInspectorCollapsed === true;
  // Main intentionally omits unrelated resolver selections. Keep a real visible roving target for
  // keyboard navigation and Center without mutating the independent right-hand Inspector selection.
  const visibleSelectedStepId = readPreviewInspectorFlowchartVisibleSelectionId(
    layout,
    selectedGraphStepId,
    locator,
    flow,
  );
  const changeViewMode = (nextMode) => {
    if (nextMode !== 'focus' && nextMode !== 'main' && nextMode !== 'all') return;
    previewInspectorDevtoolsSessionState.flowchartViewMode = nextMode;
    persistPreviewInspectorState();
    notifyPreviewInspector();
  };
  const toggleInspector = () => {
    previewInspectorDevtoolsSessionState.flowchartInspectorCollapsed = !inspectorCollapsed;
    persistPreviewInspectorState();
    notifyPreviewInspector();
  };
  const columns = [];
  for (const rank of layout.ranks) {
    columns.push(React.createElement(PreviewInspectorFlowchartRank, {
      key: 'rank:' + String(rank.rank),
      layout,
      majorPath,
      onSelect,
      rank,
      selectedStepId: visibleSelectedStepId,
    }));
    const transition = layout.transitions[rank.rank];
    if (transition !== undefined) {
      columns.push(React.createElement(PreviewInspectorFlowchartConnector, {
        key: 'connector:' + String(rank.rank),
        majorPath,
        transition,
      }));
    }
  }
  return React.createElement(
    'div',
    {
      className: 'rpi-flowchart',
      'data-rpi-current-file-status': locator.status,
      'data-rpi-flowchart-camera-key': cameraKey,
      'data-rpi-flowchart-view': viewMode,
    },
    React.createElement(PreviewInspectorFlowchartToolbar, {
      flow,
      inspectorCollapsed,
      layout,
      locator,
      onChangeViewMode: changeViewMode,
      onSelect,
      onToggleInspector: toggleInspector,
      totalNodeCount: completeLayout.orderedNodes.length,
      viewMode,
    }),
    React.createElement(
      'div',
      {
        'aria-label': 'JSX render debugger flowchart',
        className: 'rpi-flowchart-viewport',
        'data-rpi-scroll-key': 'render-flowchart',
        role: 'region',
        tabIndex: 0,
      },
      React.createElement(
        'div',
        { className: 'rpi-flowchart-canvas' },
        columns,
      ),
      React.createElement(PreviewInspectorFlowchartAccessibleRelations, { layout }),
      viewMode !== 'all' && visibleFlow.focusOmittedNodeCount > 0
        ? React.createElement(
            'div',
            { className: 'rpi-flowchart-overflow' },
            (viewMode === 'focus' ? 'Focus neighborhood' : 'Main path') + ' · ' +
              String(visibleFlow.focusOmittedNodeCount) +
              ' secondary block(s) hidden. Choose ' +
              (viewMode === 'focus' ? 'Main or All' : 'All') + ' to expand.',
          )
        : undefined,
      layout.truncated
        ? React.createElement(
            'div',
            { className: 'rpi-flowchart-overflow' },
            'Bounded graph · ' + String(layout.omittedNodeCount) + ' node(s), ' +
              String(layout.omittedEdgeCount) + ' route segment(s) omitted.',
          )
        : undefined,
    ),
  );
}
`;
}
