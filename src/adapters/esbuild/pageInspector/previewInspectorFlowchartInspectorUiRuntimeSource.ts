/**
 * Generates the right-hand advanced diagnostics panel for React Page Inspector's flow debugger.
 *
 * The panel consumes the already-bounded flowchart view model. It never discovers components,
 * executes project code, or invents blocker values. Instead, it explains the selected graph step,
 * navigates proven predecessor/successor edges, and delegates edits to the existing condition and
 * blocker editors. Keeping this presentation in its own source generator prevents the main
 * DevTools source from crossing the project's 1000-line file boundary.
 */

/**
 * Creates browser-side React components for the selected-step Inspector and current-file guide.
 *
 * Expected lexical bindings include React, `PreviewInspectorDevtoolsButton`,
 * `PreviewInspectorSimpleResolver`, `PreviewInspectorSourceDetail`,
 * `formatPreviewInspectorFlowchartGraphKind`, and `readPreviewInspectorFlowchartNodeName`. The
 * caller supplies the data-only layout, original flow, selected step, selection callback, and
 * current-file locator result.
 *
 * The locator accepts either resolved step objects or their IDs:
 * `{ status, currentFileStep, currentFileStepId, nearestBlockerStep, nearestBlockerStepId, detail }`.
 * Missing locator fields are conservatively derived from retained graph nodes without fabricating a
 * target that the page has not mounted.
 *
 * @returns Plain JavaScript source concatenated after the shared flowchart UI helpers.
 */
export function createPreviewInspectorFlowchartInspectorUiRuntimeSource(): string {
  return String.raw`
const PREVIEW_INSPECTOR_FLOWCHART_RELATION_LIMIT = 12;

/** Converts one retained graph identity into a step without trusting locator-owned object shapes. */
function resolvePreviewInspectorFlowchartInspectorStep(layout, candidate, candidateId) {
  if (candidate !== null && typeof candidate === 'object' && typeof candidate.id === 'string') {
    return layout?.nodeById?.get(candidate.id) ?? candidate;
  }
  const id = typeof candidateId === 'string'
    ? candidateId
    : typeof candidate === 'string'
      ? candidate
      : undefined;
  return id === undefined ? undefined : layout?.nodeById?.get(id);
}

/** Recognizes a retained exact target or static current-file entry without guessing from its name. */
function isPreviewInspectorFlowchartCurrentFileStep(step) {
  if (step?.currentFileTarget === true) return true;
  if (step?.staticCurrentFileTarget === true) return true;
  const node = step?.node;
  return step?.graphKind === 'entry' && node?.currentFileExport === true;
}

/** Recognizes the closest useful path stop when the current-file component has not mounted yet. */
function isPreviewInspectorFlowchartCurrentFilePathBlocker(step) {
  return step?.directCurrentFileBlocker === true ||
    step?.node?.blockerKind === 'target-reachability';
}

/**
 * Normalizes explicit locator output and falls back only to graph-proven target/blocker evidence.
 * A missing target remains absent instead of becoming a synthetic successful component node.
 */
function normalizePreviewInspectorFlowchartLocator(locator, layout) {
  const orderedNodes = Array.isArray(layout?.orderedNodes) ? layout.orderedNodes : [];
  const currentFileStep = resolvePreviewInspectorFlowchartInspectorStep(
    layout,
    locator?.currentFileStep,
    locator?.currentFileStepId,
  ) ?? orderedNodes.find(isPreviewInspectorFlowchartCurrentFileStep);
  const nearestBlockerStep = resolvePreviewInspectorFlowchartInspectorStep(
    layout,
    locator?.nearestBlockerStep,
    locator?.nearestBlockerStepId,
  ) ?? orderedNodes.find((step) => step?.directCurrentFileBlocker === true) ??
    orderedNodes.find(isPreviewInspectorFlowchartCurrentFilePathBlocker);
  const requestedStatus = ['absent', 'blocked', 'estimated', 'located'].includes(locator?.status)
    ? locator.status
    : undefined;
  const status = requestedStatus ?? (
    currentFileStep !== undefined
      ? currentFileStep.node?.mounted === false || currentFileStep.node?.contextOnly === true
        ? 'estimated'
        : 'located'
      : nearestBlockerStep !== undefined
        ? 'blocked'
        : 'absent'
  );
  return {
    currentFileStep,
    detail: typeof locator?.detail === 'string' ? locator.detail.slice(0, 1_000) : undefined,
    nearestBlockerStep,
    status,
  };
}

/** Labels selected-step resolution without coupling the Inspector to one blocker implementation. */
function formatPreviewInspectorFlowchartInspectorStatus(step) {
  if (step?.status === 'active') return 'FIX THIS FIRST';
  if (step?.status === 'waiting') return 'WAITING';
  if (step?.status === 'ready') return 'READY';
  if (step?.status === 'resolved' || step?.resolution === 'resolved') return 'RESOLVED';
  if (step?.status === 'context') return 'RENDER CONTEXT';
  return 'OBSERVED';
}

/** Determines whether the selected node participates in the currently effective render path. */
function readPreviewInspectorFlowchartInspectorPathState(step, layout) {
  if (step?.branchState === 'inactive') return 'DORMANT PATH';
  const incoming = (layout?.edges ?? []).filter((edge) => edge.toId === step?.id);
  if (incoming.length > 0 && incoming.every((edge) => edge.active === false)) {
    return 'DORMANT PATH';
  }
  return 'ACTIVE PATH';
}

/** Reports whether the selected step was proven exactly or retained from conditional inference. */
function formatPreviewInspectorFlowchartInspectorCertainty(step, layout) {
  if (step?.node?.certainty === 'conditional') return 'INFERRED';
  const incoming = (layout?.edges ?? []).filter((edge) => edge.toId === step?.id);
  return incoming.some((edge) => edge.certainty === 'conditional') ? 'INFERRED' : 'EXACT';
}

/** Formats the outer-to-inner component ownership path for the selected render operation. */
function formatPreviewInspectorFlowchartInspectorOwner(step) {
  const names = Array.isArray(step?.ownerNames)
    ? step.ownerNames.filter((name) => typeof name === 'string' && name.length > 0)
    : [];
  return names.length > 0 ? names.join(' › ') : 'Workspace React root';
}

/** Reads bounded adjacent steps in deterministic active-edge-first order. */
function readPreviewInspectorFlowchartInspectorRelations(layout, selectedStep, direction) {
  if (selectedStep === undefined) return [];
  const outgoing = direction === 'successor';
  return (layout?.edges ?? [])
    .filter((edge) => outgoing
      ? edge.fromId === selectedStep.id
      : edge.toId === selectedStep.id)
    .sort((left, right) =>
      Number(right.active === true) - Number(left.active === true) ||
      String(left.id).localeCompare(String(right.id)))
    .slice(0, PREVIEW_INSPECTOR_FLOWCHART_RELATION_LIMIT)
    .map((edge) => ({
      edge,
      step: layout?.nodeById?.get(outgoing ? edge.toId : edge.fromId),
    }))
    .filter((relation) => relation.step !== undefined);
}

/** Renders predecessor or successor buttons without changing the Components tree selection. */
function PreviewInspectorFlowchartInspectorRelations({ direction, layout, onSelect, selectedStep }) {
  const relations = readPreviewInspectorFlowchartInspectorRelations(
    layout,
    selectedStep,
    direction,
  );
  const outgoing = direction === 'successor';
  return React.createElement(
    'section',
    { className: 'rpi-flow-inspector-relations' },
    React.createElement(
      'strong',
      { className: 'rpi-flow-inspector-section-title' },
      outgoing ? 'Next in render flow' : 'Previous in render flow',
    ),
    relations.length === 0
      ? React.createElement(
          'span',
          { className: 'rpi-note' },
          outgoing ? 'This is a terminal render step.' : 'This is a flow entry.',
        )
      : React.createElement(
          'div',
          { className: 'rpi-actions' },
          relations.map(({ edge, step }) => React.createElement(
            PreviewInspectorDevtoolsButton,
            {
              key: edge.id,
              onClick: () => onSelect(step),
              title: (edge.active === false ? 'Dormant path · ' : 'Active path · ') +
                (edge.label || edge.kind || 'render flow'),
            },
            (outgoing ? '' : '← ') + readPreviewInspectorFlowchartNodeName(step) +
              (outgoing ? ' →' : '') +
              (edge.label ? ' · ' + edge.label : ''),
          )),
        ),
  );
}

/** Selects the current file or its nearest blocker while leaving viewport centering to the toolbar. */
function selectPreviewInspectorFlowchartLocatorResult(locator, onSelect) {
  const step = locator.currentFileStep ?? locator.nearestBlockerStep;
  if (step !== undefined) onSelect(step);
}

/**
 * Leads with the current path outcome and next action. The longer four-pass tutorial is retained in
 * native disclosure so it remains keyboard accessible without crowding the everyday resolver.
 */
function PreviewInspectorFlowchartCurrentFileGuide({ locator, onSelect }) {
  const targetName = locator.currentFileStep === undefined
    ? undefined
    : readPreviewInspectorFlowchartNodeName(locator.currentFileStep);
  const blockerName = locator.nearestBlockerStep === undefined
    ? undefined
    : readPreviewInspectorFlowchartNodeName(locator.nearestBlockerStep);
  const summary = locator.status === 'located'
    ? 'Current file is present in this graph' + (targetName ? ' as ' + targetName : '') + '.'
    : locator.status === 'estimated'
      ? 'Current file is known from static render evidence, but this page branch has not mounted it.'
    : locator.status === 'blocked'
      ? 'Current file has not mounted yet. The closest proven blocker is ' +
        String(blockerName ?? 'the selected page-path blocker') + '.'
      : 'No mounted current-file node or source-proven path blocker is available in this page graph.';
  const nextAction = locator.status === 'located'
    ? 'Use Current file in the graph toolbar to center the yellow target.'
    : locator.status === 'estimated'
      ? 'Trace the active path and resolve its earlier blocker, or compare another Page path.'
    : locator.status === 'blocked'
      ? 'Resolve the highlighted blocker, then press Current file again.'
      : 'Try another Page path or use the File components view; this authored outcome may not contain the file.';
  const steps = [
    ['Locate', 'Press Current file. The graph centers CURRENT FILE, or the nearest blocker when the target is absent.'],
    ['Trace', 'Follow solid ACTIVE PATH edges backward to the workspace/page entry. Dashed dormant branches are not executing.'],
    ['Resolve', 'Open the first ! blocker and use Smart fill, Auto, or an explicit value in this Resolver.'],
    ['Verify', 'After remount, confirm the active path reaches CURRENT FILE; repeat if a downstream blocker appears.'],
  ];
  return React.createElement(
    'section',
    {
      className: 'rpi-flow-inspector-locate-guide',
      'data-rpi-locator-status': locator.status,
    },
    React.createElement(
      'div',
      { className: 'rpi-flow-inspector-guide-heading' },
      React.createElement('strong', undefined, 'CURRENT FILE PATH'),
      locator.currentFileStep !== undefined || locator.nearestBlockerStep !== undefined
        ? React.createElement(
            PreviewInspectorDevtoolsButton,
            {
              onClick: () => selectPreviewInspectorFlowchartLocatorResult(locator, onSelect),
              title: locator.status === 'located'
                ? 'Select the current-file graph node'
                : 'Select the closest blocker before the current file',
            },
            locator.status === 'located' ? 'Select current file' : 'Select nearest blocker',
          )
        : undefined,
    ),
    React.createElement('div', { className: 'rpi-flow-inspector-locate-summary' }, summary),
    locator.detail === undefined
      ? undefined
      : React.createElement('div', { className: 'rpi-note' }, locator.detail),
    React.createElement('div', { className: 'rpi-note' }, nextAction),
    React.createElement(
      'details',
      { className: 'rpi-flow-inspector-disclosure' },
      React.createElement('summary', undefined, 'How path tracing works'),
      React.createElement(
        'ol',
        { className: 'rpi-flow-inspector-guide-steps' },
        steps.map(([title, detail], index) => React.createElement(
          'li',
          { key: title },
          React.createElement('span', { className: 'rpi-flow-inspector-guide-index' }, String(index + 1)),
          React.createElement(
            'span',
            { className: 'rpi-flow-inspector-guide-copy' },
            React.createElement('strong', undefined, title),
            React.createElement('span', undefined, detail),
          ),
        )),
      ),
    ),
  );
}

/** Shows stable selected-step identity, graph semantics, ownership, and source navigation. */
function PreviewInspectorFlowchartSelectedSummary({ layout, selectedStep }) {
  if (selectedStep === undefined) {
    return React.createElement(
      'div',
      { className: 'rpi-empty' },
      'Select a render step or blocker in the graph.',
    );
  }
  const currentFile = selectedStep.currentFileTarget === true;
  const staticCurrentFile = !currentFile && isPreviewInspectorFlowchartCurrentFileStep(selectedStep);
  const currentFileContext = !currentFile && !staticCurrentFile &&
    selectedStep.currentFileContext === true;
  const directCurrentFileBlocker = selectedStep.directCurrentFileBlocker === true;
  const record = isPreviewInspectorRenderFlowDecisionNode(selectedStep.node)
    ? readPreviewInspectorRenderFlowDecision(selectedStep.node)
    : selectedStep.node?.blocker;
  const sourceNode = selectedStep.node?.source !== undefined
    ? selectedStep.node
    : {
        source: {
          column: record?.column,
          line: record?.line,
          path: readPreviewInspectorFlowchartStepSourcePath(selectedStep),
        },
      };
  return React.createElement(
    React.Fragment,
    undefined,
    React.createElement(
      'section',
      { className: 'rpi-flow-inspector-selected-summary' },
      React.createElement(
        'div',
        { className: 'rpi-flow-inspector-selected-badges' },
        React.createElement(
          'span',
          { className: 'rpi-badge' },
          formatPreviewInspectorFlowchartGraphKind(selectedStep.graphKind),
        ),
        React.createElement(
          'span',
          { className: 'rpi-badge' },
          formatPreviewInspectorFlowchartInspectorStatus(selectedStep),
        ),
        React.createElement(
          'span',
          {
            className: 'rpi-badge',
            'data-rpi-active-path': String(
              readPreviewInspectorFlowchartInspectorPathState(selectedStep, layout) === 'ACTIVE PATH',
            ),
          },
          readPreviewInspectorFlowchartInspectorPathState(selectedStep, layout),
        ),
        React.createElement(
          'span',
          { className: 'rpi-badge' },
          formatPreviewInspectorFlowchartInspectorCertainty(selectedStep, layout),
        ),
        currentFile
          ? React.createElement(
              'span',
              { className: 'rpi-badge rpi-current-file-badge' },
              'CURRENT FILE',
            )
          : undefined,
        staticCurrentFile
          ? React.createElement(
              'span',
              { className: 'rpi-badge rpi-current-file-badge', 'data-rpi-estimated': 'true' },
              'CURRENT FILE · STATIC',
            )
          : undefined,
        currentFileContext
          ? React.createElement(
              'span',
              { className: 'rpi-badge rpi-current-file-badge' },
              'CURRENT FILE FLOW',
            )
          : undefined,
        directCurrentFileBlocker
          ? React.createElement(
              'span',
              { className: 'rpi-badge rpi-current-file-blocker-badge' },
              'CURRENT FILE BLOCKER',
            )
          : undefined,
      ),
      React.createElement(
        'strong',
        { className: 'rpi-flow-inspector-selected-name' },
        readPreviewInspectorFlowchartNodeName(selectedStep),
      ),
      React.createElement(
        'div',
        { className: 'rpi-note' },
        String(selectedStep.detail ?? 'Selected render operation.'),
      ),
      React.createElement(
        'div',
        { className: 'rpi-flow-inspector-owner' },
        React.createElement('strong', undefined, 'Owner path'),
        React.createElement('span', undefined, formatPreviewInspectorFlowchartInspectorOwner(selectedStep)),
      ),
    ),
    React.createElement(PreviewInspectorSourceDetail, { node: sourceNode }),
  );
}

/** Keeps predecessor/successor diagnostics together under the selected-node disclosure. */
function PreviewInspectorFlowchartAdvancedRelations({ layout, onSelect, selectedStep }) {
  return React.createElement(
    'section',
    { className: 'rpi-flow-inspector-disclosure rpi-flow-inspector-advanced-relations' },
    React.createElement('strong', undefined, 'Path relationships'),
    React.createElement(
      'div',
      { className: 'rpi-flow-inspector-disclosure-content' },
      React.createElement(PreviewInspectorFlowchartInspectorRelations, {
        direction: 'predecessor',
        layout,
        onSelect,
        selectedStep,
      }),
      React.createElement(PreviewInspectorFlowchartInspectorRelations, {
        direction: 'successor',
        layout,
        onSelect,
        selectedStep,
      }),
    ),
  );
}

/**
 * Groups source identity and graph relations behind native disclosure. The simple resolver remains
 * the first everyday surface, while all selected-node internals stay available for debugging.
 */
function PreviewInspectorFlowchartDiagnostics({ layout, locator, onSelect, selectedStep }) {
  return React.createElement(
    'details',
    { className: 'rpi-flow-inspector-disclosure rpi-flow-inspector-diagnostics' },
    React.createElement('summary', undefined, 'Selected graph diagnostics'),
    React.createElement(
      'div',
      { className: 'rpi-flow-inspector-disclosure-content' },
      React.createElement(PreviewInspectorFlowchartCurrentFileGuide, {
        locator,
        onSelect,
      }),
      React.createElement(PreviewInspectorFlowchartSelectedSummary, {
        layout,
        selectedStep,
      }),
      React.createElement(PreviewInspectorFlowchartAdvancedRelations, {
        layout,
        onSelect,
        selectedStep,
      }),
    ),
  );
}

/**
 * Renders independently collapsible advanced render diagnostics beside the full graph.
 *
 * Collapsing hides only explanation/editing chrome; the graph and its selection remain mounted.
 */
function PreviewInspectorFlowchartInspector({
  collapsed,
  flow,
  layout,
  locator,
  onSelect,
  onToggleCollapsed,
  selectedStep,
}) {
  const normalizedLocator = normalizePreviewInspectorFlowchartLocator(locator, layout);
  const toggle = typeof onToggleCollapsed === 'function' ? onToggleCollapsed : () => undefined;
  const select = typeof onSelect === 'function' ? onSelect : () => undefined;
  return React.createElement(
    'aside',
    {
      'aria-label': 'Advanced render diagnostics',
      className: 'rpi-flow-inspector',
      'data-rpi-collapsed': String(collapsed === true),
    },
    React.createElement(
      'header',
      { className: 'rpi-flow-inspector-heading' },
      React.createElement(
        'span',
        { className: 'rpi-flow-inspector-heading-copy' },
        React.createElement(
          'span',
          { className: 'rpi-flow-inspector-kicker' },
          'ADVANCED RENDER DIAGNOSTICS',
        ),
        React.createElement(
          'strong',
          undefined,
          selectedStep === undefined
            ? 'No selected block'
            : readPreviewInspectorFlowchartNodeName(selectedStep),
        ),
      ),
      React.createElement(
        PreviewInspectorDevtoolsButton,
        {
          expanded: collapsed !== true,
          onClick: toggle,
          title: collapsed === true
            ? 'Open advanced render diagnostics'
            : 'Collapse advanced render diagnostics',
        },
        collapsed === true ? 'Diagnostics' : '×',
      ),
    ),
    collapsed === true
      ? undefined
      : React.createElement(
          'div',
          { className: 'rpi-flow-inspector-scroll' },
          React.createElement(PreviewInspectorSimpleResolver, {
            flow: flow.simpleResolverFlow ?? flow,
            showManualEditor: true,
          }),
          React.createElement(PreviewInspectorFlowchartDiagnostics, {
            layout,
            locator: normalizedLocator,
            onSelect: select,
            selectedStep,
          }),
        ),
  );
}

/**
 * Resolves the shared selected graph record and renders it in the workbench's existing details pane.
 * Graph selection remains independent from the Components tree until an explicit Reveal action.
 */
function PreviewInspectorFlowchartResolverPane({ flow }) {
  const chartFlow = createPreviewInspectorRenderFlowChartView(flow);
  const layout = React.useMemo(
    () => createPreviewInspectorFlowchartLayout(chartFlow),
    [chartFlow.fingerprint],
  );
  const requestedId = previewInspectorDevtoolsSessionState.selectedBlockerFlowNodeId;
  const selectedStep = layout.nodeById.get(requestedId) ??
    layout.nodeById.get(chartFlow.activeStepId) ?? layout.orderedNodes.at(-1);
  const locator = locatePreviewInspectorFlowchartCurrentFile(chartFlow, layout);
  const collapsed = previewInspectorDevtoolsSessionState.flowchartInspectorCollapsed === true;
  const select = (step) => selectPreviewInspectorBlockerFlowStep(step, () => undefined);
  const toggle = () => {
    previewInspectorDevtoolsSessionState.flowchartInspectorCollapsed = !collapsed;
    persistPreviewInspectorState();
    notifyPreviewInspector();
  };
  return React.createElement(PreviewInspectorFlowchartInspector, {
    collapsed,
    flow: chartFlow,
    layout,
    locator,
    onSelect: select,
    onToggleCollapsed: toggle,
    selectedStep,
  });
}
`;
}
