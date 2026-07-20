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
function PreviewInspectorFlowchartNode({ layout, onSelect, selectedStepId, step }) {
  const selected = step.id === selectedStepId;
  const directCurrentFileBlocker = step.directCurrentFileBlocker === true;
  const currentFile = step.currentFileTarget === true;
  const currentFileContext = currentFile || step.currentFileContext === true;
  const staticCurrentFile = !currentFileContext && step.graphKind === 'entry' &&
    step.node?.currentFileExport === true;
  const nodeName = readPreviewInspectorFlowchartNodeName(step);
  const graphKindLabel = formatPreviewInspectorFlowchartGraphKind(step.graphKind);
  const ownerNames = Array.isArray(step.ownerNames) ? step.ownerNames : [];
  const relation = describePreviewInspectorFlowchartNodeRelations(layout, step);
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
        'data-rpi-flowchart-node': step.id,
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
      'data-rpi-graph-kind': step.graphKind,
      'data-rpi-flowchart-node': step.id,
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
      { className: 'rpi-flowchart-node-copy' },
      React.createElement(
        'span',
        { className: 'rpi-flowchart-node-heading' },
        React.createElement('strong', undefined, nodeName),
        currentFile
          ? React.createElement(
              'span',
              { className: 'rpi-flowchart-node-target' },
              'CURRENT FILE',
            )
          : currentFileContext
            ? React.createElement(
                'span',
                { className: 'rpi-flowchart-node-target' },
                'CURRENT FILE FLOW',
              )
            : staticCurrentFile
              ? React.createElement(
                  'span',
                  { className: 'rpi-flowchart-node-target', 'data-rpi-estimated': 'true' },
                'CURRENT FILE · STATIC',
              )
          : undefined,
      ),
      React.createElement('span', { className: 'rpi-flowchart-node-kind' }, graphKindLabel),
      step.branchLabel.length > 0
        ? React.createElement(
            'span',
            { className: 'rpi-flowchart-node-branch', title: step.branchLabel },
            step.branchLabel,
          )
        : undefined,
      React.createElement(
        'span',
        { className: 'rpi-flowchart-node-state' },
        directCurrentFileBlocker
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
              : 'Active render path',
      ),
      React.createElement(
        'span',
        { className: 'rpi-flowchart-node-owner' },
        ownerNames.join(' › ') || 'Workspace React root',
      ),
      React.createElement('span', { className: 'rpi-visually-hidden' }, relation),
    ),
  );
}

/** Renders one fixed-height lane slot so every rank and connector shares the same vertical grid. */
function PreviewInspectorFlowchartLane({ layout, node, onSelect, selectedStepId }) {
  return React.createElement(
    'div',
    { className: 'rpi-flowchart-lane' },
    node === undefined
      ? undefined
      : React.createElement(PreviewInspectorFlowchartNode, {
          layout,
          onSelect,
          selectedStepId,
          step: node,
        }),
  );
}

/** Renders one rank of debugger nodes using an explicit placeholder for every absent lane. */
function PreviewInspectorFlowchartRank({ layout, onSelect, rank, selectedStepId }) {
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
        node,
        onSelect,
        selectedStepId,
      })),
    ),
  );
}

/** Renders one edge route as horizontal and vertical CSS border segments across repeated lane cells. */
function PreviewInspectorFlowchartEdgeTrack({ segment }) {
  return React.createElement(
    'div',
    {
      'aria-hidden': 'true',
      className: 'rpi-flowchart-edge-track',
      'data-rpi-active': String(segment.active === true),
      'data-rpi-certainty': segment.certainty,
      'data-rpi-flowchart-edge': segment.id,
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
function PreviewInspectorFlowchartConnector({ transition }) {
  return React.createElement(
    'section',
    { className: 'rpi-flowchart-connector' },
    React.createElement(
      'div',
      { className: 'rpi-flowchart-connector-label' },
      transition.omittedCount > 0 ? '+' + String(transition.omittedCount) + ' paths' : 'flow',
    ),
    React.createElement(
      'div',
      { className: 'rpi-flowchart-edge-stack' },
      transition.segments.map((segment) => React.createElement(
        PreviewInspectorFlowchartEdgeTrack,
        { key: segment.id + ':' + String(transition.rank), segment },
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
 * Renders one deterministic debugger canvas with companion-local camera controls.
 * The alternating rank/connector DOM is intentionally compatible with companion sanitization.
 */
function PreviewInspectorFlowchart({ flow, onSelect, selectedStep, selectedStepId }) {
  const layout = React.useMemo(
    () => createPreviewInspectorFlowchartLayout(flow),
    [flow.fingerprint],
  );
  const locator = React.useMemo(
    () => locatePreviewInspectorFlowchartCurrentFile(flow, layout),
    [flow.fingerprint, layout],
  );
  const inspectorCollapsed = previewInspectorDevtoolsSessionState.flowchartInspectorCollapsed === true;
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
      onSelect,
      rank,
      selectedStepId,
    }));
    const transition = layout.transitions[rank.rank];
    if (transition !== undefined) {
      columns.push(React.createElement(PreviewInspectorFlowchartConnector, {
        key: 'connector:' + String(rank.rank),
        transition,
      }));
    }
  }
  return React.createElement(
    'div',
    {
      className: 'rpi-flowchart',
      'data-rpi-current-file-status': locator.status,
    },
    React.createElement(PreviewInspectorFlowchartToolbar, {
      flow,
      inspectorCollapsed,
      layout,
      locator,
      onSelect,
      onToggleInspector: toggleInspector,
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
