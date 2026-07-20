/**
 * Generates the camera toolbar and exact current-file locator for the render-flow debugger.
 *
 * Camera commands are represented by bounded data attributes. The visible companion Inspector owns
 * their viewport effects because the authoritative preview-side shell is deliberately hidden. Only
 * `locate-current` is also forwarded to React so the selected resolver record stays synchronized.
 */

/**
 * Creates browser-side locator, legend, and toolbar helpers for the flowchart workbench.
 *
 * Expected lexical bindings include React, the selected preview session, the flowchart layout, and
 * the Blockers selection callback supplied by the parent workbench.
 *
 * @returns Plain JavaScript concatenated before the main flowchart React component.
 */
export function createPreviewInspectorFlowchartToolbarUiRuntimeSource(): string {
  return String.raw`
/** Reads the selected file/export identity without guessing from a component's display name. */
function readPreviewInspectorFlowchartCurrentFileIdentity() {
  const descriptor = findSelectedPreviewInspectorDescriptor();
  const inspector = descriptor?.inspector;
  const selectedExportName = previewInspectorSession.selectedExportName;
  const selectedChainTarget = inspector?.renderChainsByExport?.[selectedExportName]?.target;
  const primaryTarget = inspector?.target?.exportName === selectedExportName
    ? inspector.target
    : undefined;
  const target = selectedChainTarget ?? primaryTarget;
  const exportName = typeof target?.exportName === 'string' && target.exportName.length > 0
    ? target.exportName
    : selectedExportName;
  const sourcePath = typeof target?.sourcePath === 'string' && target.sourcePath.length > 0
    ? target.sourcePath
    : undefined;
  return { exportName, sourcePath };
}

/**
 * Finds the strongest exact tree candidate instead of returning the first same-named export.
 * Mounted, source-matched current-file rows outrank static inventory and unrelated package exports.
 */
function findPreviewInspectorUiNodeByExport(nodes, exportName) {
  const identity = readPreviewInspectorFlowchartCurrentFileIdentity();
  const candidates = [];
  const visit = (values, depth = 0) => {
    for (const node of values ?? []) {
      if (node?.exportName === exportName) {
        const sourcePath = node?.source?.path ?? node?.source?.sourcePath;
        const sourceMatches = identity.sourcePath !== undefined &&
          typeof sourcePath === 'string' &&
          matchesPreviewInspectorConditionSourcePath(sourcePath, identity.sourcePath);
        candidates.push({
          depth,
          node,
          score: Number(node.currentFileExport === true) * 100 + Number(sourceMatches) * 50 +
            Number(node.mounted !== false) * 20 + Number(node.contextOnly !== true) * 10,
        });
      }
      visit(node?.children, depth + 1);
    }
  };
  visit(nodes);
  return candidates.sort((left, right) =>
    right.score - left.score || right.depth - left.depth || left.node.id.localeCompare(right.node.id))[0]?.node;
}

/** Normalizes one graph source path without interpreting project-specific aliases or casing. */
function readPreviewInspectorFlowchartStepSourcePath(step) {
  const nodePath = step?.node?.source?.path ?? step?.node?.source?.sourcePath;
  if (typeof nodePath === 'string' && nodePath.length > 0) return nodePath;
  const record = isPreviewInspectorRenderFlowDecisionNode(step?.node)
    ? readPreviewInspectorRenderFlowDecision(step.node)
    : step?.node?.blocker;
  return typeof record?.sourcePath === 'string' && record.sourcePath.length > 0
    ? record.sourcePath
    : undefined;
}

/** Scores only explicit current-file evidence; ordinary workspace roots never become a fallback. */
function scorePreviewInspectorFlowchartCurrentFileStep(step, identity) {
  const node = step?.node;
  const sourcePath = readPreviewInspectorFlowchartStepSourcePath(step);
  const sourceMatches = identity.sourcePath !== undefined &&
    typeof sourcePath === 'string' &&
    matchesPreviewInspectorConditionSourcePath(sourcePath, identity.sourcePath);
  const exportMatches = typeof identity.exportName === 'string' && identity.exportName.length > 0 &&
    (node?.exportName === identity.exportName || node?.name === identity.exportName);
  if (step?.currentFileTarget === true) return 1000;
  if (node?.currentFileExport === true) {
    const entry = String(step?.id ?? '').startsWith('render-entry:');
    return 800 + Number(sourceMatches) * 80 + Number(exportMatches) * 40 +
      Number(node?.mounted !== false && node?.contextOnly !== true) * 20 + Number(entry) * 10;
  }
  return -1;
}

/** Chooses the nearest target-path blocker when the selected file has not entered the render graph. */
function readPreviewInspectorFlowchartNearestTargetBlocker(layout) {
  const blockers = layout.orderedNodes.filter((step) =>
    step?.directCurrentFileBlocker === true || step?.node?.blockerKind === 'target-reachability');
  return blockers.sort((left, right) =>
    Number(right.directCurrentFileBlocker === true) - Number(left.directCurrentFileBlocker === true) ||
    right.rank - left.rank || left.id.localeCompare(right.id))[0];
}

/**
 * Locates the selected file in the visible graph or explains the exact blocker standing before it.
 * The result is data-only so the right resolver and toolbar always describe the same target.
 */
function locatePreviewInspectorFlowchartCurrentFile(flow, layout) {
  const identity = readPreviewInspectorFlowchartCurrentFileIdentity();
  const candidates = layout.orderedNodes
    .map((step) => ({ score: scorePreviewInspectorFlowchartCurrentFileStep(step, identity), step }))
    .filter((candidate) => candidate.score >= 0)
    .sort((left, right) => right.score - left.score || left.step.rank - right.step.rank ||
      left.step.id.localeCompare(right.step.id));
  const currentFileStep = candidates[0]?.step;
  const nearestBlockerStep = readPreviewInspectorFlowchartNearestTargetBlocker(layout);
  if (currentFileStep !== undefined) {
    const mounted = currentFileStep.node?.mounted !== false &&
      currentFileStep.node?.contextOnly !== true;
    return {
      currentFileStep,
      currentFileStepId: currentFileStep.id,
      detail: mounted
        ? 'The selected export is mounted on this page path.'
        : 'The selected export is known statically but is not mounted on the active page branch.',
      exportName: identity.exportName,
      nearestBlockerStep,
      nearestBlockerStepId: nearestBlockerStep?.id,
      sourcePath: identity.sourcePath,
      status: mounted ? 'located' : 'estimated',
      step: currentFileStep,
    };
  }
  if (nearestBlockerStep !== undefined) {
    return {
      detail: 'The current file is not mounted yet. Resolve this nearest path blocker, then locate again.',
      exportName: identity.exportName,
      nearestBlockerStep,
      nearestBlockerStepId: nearestBlockerStep.id,
      sourcePath: identity.sourcePath,
      status: 'blocked',
      step: nearestBlockerStep,
    };
  }
  return {
    detail: flow?.renderTruncated === true
      ? 'The bounded graph ended before it could retain the selected file. Choose another Page path or narrow the graph.'
      : 'No page-to-file render path is proven yet. Choose a Page path or compare File components.',
    exportName: identity.exportName,
    sourcePath: identity.sourcePath,
    status: 'absent',
    step: undefined,
  };
}

/** Creates one camera button whose local command is accepted only by the companion flowchart script. */
function PreviewInspectorFlowchartCameraButton({ command, label, title }) {
  return React.createElement(
    'button',
    {
      className: 'rpi-button rpi-flowchart-camera-button',
      'data-rpi-flowchart-command': command,
      onClick: () => {},
      title,
      type: 'button',
    },
    label,
  );
}

/** Explains line and node semantics without requiring users to infer meaning from color alone. */
function PreviewInspectorFlowchartLegend() {
  const items = [
    ['exact', 'solid · active/proven'],
    ['inferred', 'dashed · inferred/dormant'],
    ['blocker', '! blocker'],
    ['current', '◎ current file'],
    ['branch', '? branch/case'],
    ['hoc', 'H HOC'],
    ['slot', 'P component prop'],
  ];
  return React.createElement(
    'div',
    { 'aria-label': 'Render flow legend', className: 'rpi-flowchart-legend' },
    items.map(([kind, label]) => React.createElement(
      'span',
      { className: 'rpi-flowchart-legend-item', 'data-rpi-legend-kind': kind, key: kind },
      label,
    )),
  );
}

/** Renders camera actions, the exact current-file locator, and the resolver visibility switch. */
function PreviewInspectorFlowchartToolbar({
  flow,
  inspectorCollapsed,
  layout,
  locator,
  onSelect,
  onToggleInspector,
}) {
  const locate = () => {
    if (locator?.step !== undefined) onSelect(locator.step);
  };
  const locateTitle = locator?.status === 'located'
    ? 'Select and center the mounted current-file function entry'
    : locator?.status === 'estimated'
      ? 'Select the statically located current-file function entry'
      : locator?.status === 'blocked'
        ? 'Select the nearest blocker before the current file can mount'
        : 'No proven current-file path yet; open the resolver for next steps';
  return React.createElement(
    'header',
    { className: 'rpi-flowchart-toolbar' },
    React.createElement(
      'div',
      { className: 'rpi-flowchart-toolbar-heading' },
      React.createElement('strong', undefined, 'Control & render flow'),
      React.createElement(
        'span',
        { className: 'rpi-meta' },
        String(layout.orderedNodes.length) + ' blocks · ' + String(flow.unresolvedCount) + ' unresolved',
      ),
    ),
    React.createElement(PreviewInspectorFlowchartLegend),
    React.createElement(
      'div',
      { 'aria-label': 'Render flow camera controls', className: 'rpi-flowchart-camera', role: 'toolbar' },
      React.createElement(PreviewInspectorFlowchartCameraButton, {
        command: 'zoom-out',
        label: '−',
        title: 'Zoom out',
      }),
      React.createElement(
        'button',
        {
          'aria-label': 'Reset render flow zoom to 100 percent',
          className: 'rpi-button rpi-flowchart-zoom-label',
          'data-rpi-flowchart-command': 'zoom-reset',
          'data-rpi-flowchart-zoom-label': 'true',
          onClick: () => {},
          title: 'Reset zoom',
          type: 'button',
        },
        '100%',
      ),
      React.createElement(PreviewInspectorFlowchartCameraButton, {
        command: 'zoom-in',
        label: '+',
        title: 'Zoom in',
      }),
      React.createElement(PreviewInspectorFlowchartCameraButton, {
        command: 'center-selected',
        label: 'Center',
        title: 'Center the selected flow block without moving the Inspector document',
      }),
      React.createElement(PreviewInspectorFlowchartCameraButton, {
        command: 'fit',
        label: 'Fit',
        title: 'Fit the complete bounded graph inside the visible canvas',
      }),
      React.createElement(
        'button',
        {
          className: 'rpi-button rpi-flowchart-locate-button',
          'data-rpi-flowchart-command': 'locate-current',
          'data-rpi-locator-status': locator?.status ?? 'absent',
          onClick: locate,
          title: locateTitle,
          type: 'button',
        },
        locator?.status === 'blocked' ? 'Locate current file · blocker' : 'Locate current file',
      ),
      React.createElement(
        'button',
        {
          'aria-pressed': inspectorCollapsed !== true,
          className: 'rpi-button',
          onClick: onToggleInspector,
          title: inspectorCollapsed === true ? 'Show Blocker Resolver inspector' : 'Hide Blocker Resolver inspector',
          type: 'button',
        },
        'Inspector',
      ),
    ),
    React.createElement(
      'span',
      {
        'aria-live': 'polite',
        className: 'rpi-flowchart-camera-status',
        'data-rpi-flowchart-camera-status': 'true',
        role: 'status',
      },
      locator?.detail ?? 'Use Locate current file to find the selected export in this page flow.',
    ),
  );
}
`;
}
