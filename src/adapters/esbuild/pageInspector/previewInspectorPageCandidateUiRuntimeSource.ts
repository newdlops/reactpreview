/**
 * Generates the small caller-path selector embedded in the Page Inspector context strip.
 * Keeping this presentation fragment separate lets the main DevTools source stay below the
 * project's 1000-line file limit while candidate discovery and loading remain runtime concerns.
 */

/**
 * Creates a native, keyboard-accessible selector for authored page-root candidates.
 *
 * Expected lexical bindings are `React` and the candidate runtime helpers composed into the same
 * browser entry.
 *
 * @returns Plain JavaScript source consumed by the Inspector DevTools source generator.
 */
export function createPreviewInspectorPageCandidateUiRuntimeSource(): string {
  return String.raw`
/** Formats whether the selected authored page and current-file target share one committed render. */
function formatPreviewInspectorPageCorridorStatus(reachability) {
  if (reachability?.status === 'reached') return 'PAGE READY';
  if (reachability?.directTarget === true) return 'TARGET ONLY';
  if (reachability?.status === 'advancing') return 'FINDING TARGET';
  if (reachability?.pageRootCommitted === true) return 'TARGET BLOCKED';
  return 'LOADING PAGE';
}

/** Opens the ordered page-corridor repair flow and remounts the detail pane in that tab. */
function openPreviewInspectorFriendlyBlockerFlow() {
  previewInspectorDevtoolsSessionState.activeTab = 'flow';
  previewInspectorDevtoolsSessionState.blockerDetailRevision =
    (previewInspectorDevtoolsSessionState.blockerDetailRevision ?? 0) + 1;
  persistPreviewInspectorState();
  notifyPreviewInspector();
}

/** Converts internal corridor state into one plain-language status and recommended next action. */
function readPreviewInspectorFriendlyPageStatus(reachability) {
  const blockers = readPreviewInspectorActiveBlockerSummary();
  if (reachability?.directTarget === true) {
    return {
      action: 'Return to page',
      description: 'Only the selected export is shown. This is a diagnostic view, not its real page.',
      icon: '◎',
      kind: 'diagnostic',
      onAction: returnPreviewInspectorToPageContext,
      title: 'Target-only view',
    };
  }
  if (blockers.count > 0 || reachability?.status === 'page-blocked') {
    const firstBlocker = typeof blockers.first?.name === 'string'
      ? ' First: ' + blockers.first.name + '.'
      : '';
    return {
      action: 'Fix next blocker',
      description: String(Math.max(1, blockers.count)) +
        ' issue(s) stop the current file from rendering.' + firstBlocker +
        ' Start with the first red BLOCKER row.',
      icon: '!',
      kind: 'blocked',
      onAction: openPreviewInspectorFriendlyBlockerFlow,
      title: 'Page rendering is blocked',
    };
  }
  if (reachability?.status === 'reached') {
    return {
      action: 'Reveal current file',
      description: 'The authored page and selected file are mounted together. Select components to inspect them.',
      icon: '✓',
      kind: 'ready',
      onAction: selectPreviewInspectorMainComponent,
      title: 'Page context is ready',
    };
  }
  return {
    description: reachability?.status === 'advancing'
      ? 'React Preview is crossing a proven page condition and will check the target again.'
      : 'The authored page is loading. Yellow conditions and generated preview values are not fatal errors.',
    icon: '…',
    kind: 'preparing',
    title: reachability?.status === 'advancing' ? 'Finding the target on this page' : 'Preparing page context',
  };
}

/** Shows the current outcome, next action, and stable visual vocabulary before the tree. */
function PreviewInspectorFriendlyGuide({ reachability }) {
  const status = readPreviewInspectorFriendlyPageStatus(reachability);
  const legend = [
    ['component', 'C', 'Component'],
    ['target', '◎', 'Current file'],
    ['path', '↳', 'Page path'],
    ['condition', '?', 'Condition'],
    ['assisted', '≈', 'Preview value'],
    ['blocker', '!', 'Blocks rendering'],
  ];
  return React.createElement(
    React.Fragment,
    undefined,
    React.createElement(
      'section',
      { className: 'rpi-friendly-status', 'data-status-kind': status.kind, role: 'status' },
      React.createElement('span', { 'aria-hidden': true, className: 'rpi-friendly-status-icon' }, status.icon),
      React.createElement(
        'span',
        { className: 'rpi-friendly-status-copy' },
        React.createElement('strong', undefined, status.title),
        React.createElement('span', undefined, status.description),
      ),
      React.createElement(
        'span',
        { className: 'rpi-context-badge' },
        formatPreviewInspectorPageCorridorStatus(reachability),
      ),
      status.onAction === undefined
        ? undefined
        : React.createElement(
            PreviewInspectorDevtoolsButton,
            { onClick: status.onAction },
            status.action,
          ),
    ),
    React.createElement(
      'div',
      { 'aria-label': 'Inspector tree legend', className: 'rpi-tree-legend' },
      React.createElement('strong', undefined, 'Tree guide'),
      legend.map(([kind, icon, label]) => React.createElement(
        'span',
        { className: 'rpi-legend-item', 'data-role': kind, key: kind },
        React.createElement('span', { 'aria-hidden': true }, icon),
        label,
      )),
    ),
  );
}

/** Renders all proven caller paths and switches the mounted authored page without rebuilding it. */
function PreviewInspectorPageCandidateSelect({ descriptor }) {
  const candidates = readPreviewInspectorPageCandidates(descriptor);
  const selected = readSelectedPreviewInspectorPageCandidate(descriptor);
  if (candidates.length === 0) return undefined;
  const reachability = readPreviewInspectorTargetReachabilityState(descriptor, selected);
  return React.createElement(
    React.Fragment,
    undefined,
    React.createElement(PreviewInspectorFriendlyGuide, { reachability }),
    React.createElement(
      'label',
      {
        className: 'rpi-candidate-select',
        title: candidates.length > 1
          ? 'Choose which authored caller path should construct the visible page.'
          : 'Only one mountable authored caller path was proven.',
      },
      React.createElement('span', { className: 'rpi-context-badge' }, 'PAGE PATH'),
      React.createElement(
        'select',
        {
          'aria-label': 'Authored page caller path',
          className: 'rpi-select',
          disabled: candidates.length < 2,
          onChange: (event) => selectPreviewInspectorPageCandidate(event.target.value),
          value: selected?.id ?? candidates[0]?.id ?? '',
        },
        candidates.map((candidate, index) => React.createElement(
          'option',
          { key: candidate.id, value: candidate.id },
          formatPreviewInspectorPageCandidate(candidate, index),
        )),
      ),
    ),
  );
}
`;
}
