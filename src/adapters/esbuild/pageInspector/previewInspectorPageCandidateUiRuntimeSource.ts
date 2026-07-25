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
/** Formats page visibility with labels that describe what the user can actually see. */
function formatPreviewInspectorPageCorridorStatus(reachability) {
  if (readPreviewInspectorRenderScenario() === 'file-components') return 'FILE COMPONENTS';
  const descriptor = findSelectedPreviewInspectorDescriptor();
  const moduleContext = typeof readSelectedPreviewInspectorModuleContext === 'function'
    ? readSelectedPreviewInspectorModuleContext(descriptor)
    : descriptor?.inspector?.contextModule;
  if (
    reachability?.status === 'reached' &&
    reachability?.targetMounted === true &&
    reachability?.targetHasOutput === true
  ) return 'PAGE READY';
  if (reachability?.directTarget === true) return 'FILE ONLY';
  if (reachability?.status === 'advancing') return 'FINDING FILE';
  if (
    reachability?.pageRootCommitted === true &&
    reachability?.targetMounted === true &&
    reachability?.targetHasOutput !== true
  ) {
    if (reachability?.targetDeferredCallbackPending === true) return 'CALLBACK WAITING';
    if (reachability?.targetHasAnyHostOutput === true) return 'FALLBACK SHOWN';
    return moduleContext === undefined ? 'NOT VISIBLE' : 'PAGE NOT VISIBLE';
  }
  if (reachability?.pageRootCommitted === true && reachability?.targetMounted !== true) {
    return moduleContext === undefined ? 'NOT ON THIS PATH' : 'PAGE PATH SKIPPED';
  }
  if (reachability?.pageRootCommitted === true) return 'CHECKING FILE';
  return 'LOADING PAGE';
}

/** Reveals the first active blocker at its owning location in the component tree. */
function revealPreviewInspectorFriendlyBlocker() {
  const blocker = readPreviewInspectorActiveBlockerSummary().first;
  if (blocker === undefined) return;
  requestPreviewInspectorTreeReveal(blocker.id);
  selectPreviewInspectorUiNode(blocker);
}

/** Reveals mounted-empty reachability even before it becomes an exhausted active blocker. */
function revealPreviewInspectorMissingTargetOutput() {
  const descriptor = findSelectedPreviewInspectorDescriptor();
  const candidate = readSelectedPreviewInspectorPageCandidate(descriptor);
  const reachability = candidate === undefined
    ? undefined
    : readPreviewInspectorTargetReachabilityState(descriptor, candidate);
  const blocker = readPreviewInspectorTargetReachabilityBlockers().find(
    (item) => item.key === reachability?.key,
  );
  if (blocker !== undefined) {
    const node = createPreviewInspectorTargetReachabilityTreeNode(blocker);
    requestPreviewInspectorTreeReveal(node.id);
    selectPreviewInspectorUiNode(node);
    return;
  }
  const exportName = reachability?.targetExportName ?? previewInspectorSession.selectedExportName;
  requestPreviewInspectorTreeReveal('expected-outcomes:' + String(exportName));
}

/** Converts internal corridor state into one plain-language status and recommended next action. */
function readPreviewInspectorFriendlyPageStatus(reachability) {
  const descriptor = findSelectedPreviewInspectorDescriptor();
  const moduleContext = typeof readSelectedPreviewInspectorModuleContext === 'function'
    ? readSelectedPreviewInspectorModuleContext(descriptor)
    : descriptor?.inspector?.contextModule;
  if (readPreviewInspectorRenderScenario() === 'file-components') {
    return {
      action: 'Return to page flow',
      description: 'All statically proven component exports from the current file are mounted independently. This overview does not decide which application outcome is normal.',
      icon: 'C',
      kind: 'overview',
      onAction: () => setPreviewInspectorRenderScenario('authored-page'),
      title: 'Current-file component overview',
    };
  }
  const blockers = readPreviewInspectorActiveBlockerSummary();
  const mountedWithoutOutput = reachability?.pageRootCommitted === true &&
    reachability?.targetMounted === true && reachability?.targetHasOutput !== true;
  if (mountedWithoutOutput) {
    const deferredCallbackPending = reachability?.targetDeferredCallbackPending === true;
    const wrapperHostOnly = reachability?.targetHasAnyHostOutput === true;
    return {
      action: moduleContext !== undefined
        ? 'Find page requirement'
        : deferredCallbackPending
          ? 'Find callback requirement'
          : wrapperHostOnly
            ? 'Find replaced content'
            : 'Find what hides it',
      description: moduleContext !== undefined
        ? 'The page used this module, but the selected branch contains no visible element. Open the nearest condition or missing value.'
        : deferredCallbackPending
          ? 'This file is available as render content, but its parent has not called it. Open the value or condition that enables the callback.'
        : wrapperHostOnly
          ? 'A wrapper or fallback is visible instead of this file’s authored content. Open the nearest condition or missing value that selected the fallback.'
          : 'The page reached this file, but its current branch returned no visible element. Common causes are an OFF condition, missing data, or an intentional null return.',
      icon: '!',
      kind: 'blocked',
      onAction: revealPreviewInspectorMissingTargetOutput,
      steps: [
        { label: 'Page loaded', state: 'done' },
        {
          label: moduleContext !== undefined
            ? 'Module used'
            : deferredCallbackPending ? 'File connected' : 'File ran',
          state: 'done',
        },
        {
          label: deferredCallbackPending
            ? 'Callback waiting'
            : wrapperHostOnly ? 'Fallback shown' : 'Nothing visible',
          state: 'blocked',
        },
      ],
      title: moduleContext !== undefined
        ? 'This module’s page has no visible content'
        : deferredCallbackPending
          ? 'Waiting for the parent to render this file'
        : wrapperHostOnly
          ? 'A fallback is shown instead of this file'
          : 'This file ran, but nothing is visible',
    };
  }
  const renderedWithoutTarget = reachability?.pageRootCommitted === true &&
    reachability?.targetMounted !== true &&
    blockers.count > 0 &&
    blockers.active.every((node) => node?.blockerKind === 'target-reachability');
  if (renderedWithoutTarget) {
    if (moduleContext !== undefined) {
      return {
        action: 'Inspect page path',
        description: 'The selected consuming page committed a different branch before its page boundary mounted. Inspect the authored path; this module has no independent component view.',
        icon: '↳',
        kind: 'flow-outcome',
        onAction: revealPreviewInspectorMissingTargetOutput,
        title: 'Consuming page selected another flow',
      };
    }
    return {
      action: 'Show file components',
      description: 'The chosen authored path committed its UI without mounting the current file. Compare another page path or inspect every current-file export; React Preview does not classify this application outcome.',
      icon: '↳',
      kind: 'flow-outcome',
      onAction: () => setPreviewInspectorRenderScenario('file-components'),
      title: 'Rendered flow does not contain the current file',
    };
  }
  if (reachability?.directTarget === true) {
    return {
      action: 'Return to page',
      description: 'Only the selected export is shown. This is a diagnostic view, not its real page.',
      icon: '◎',
      kind: 'diagnostic',
      onAction: returnPreviewInspectorToPageContext,
      title: 'File-only view',
    };
  }
  if (blockers.count > 0 || reachability?.status === 'page-blocked') {
    const firstBlocker = typeof blockers.first?.name === 'string'
      ? ' First: ' + blockers.first.name + '.'
      : '';
    return {
      action: 'Fix next blocker',
      description: String(Math.max(1, blockers.count)) +
        ' issue(s) stop ' + (moduleContext === undefined ? 'the current file' : 'the consuming page') +
        ' from rendering.' + firstBlocker +
        ' Start with the first red BLOCKER row.',
      icon: '!',
      kind: 'blocked',
      onAction: revealPreviewInspectorFriendlyBlocker,
      title: 'Page rendering is blocked',
    };
  }
  if (
    reachability?.status === 'reached' &&
    reachability?.targetMounted === true &&
    reachability?.targetHasOutput === true
  ) {
    if (moduleContext !== undefined) {
      return {
        description: 'The selected source module is loaded through its statically proven consuming page and layout chain.',
        icon: '✓',
        kind: 'ready',
        title: 'Module page context is ready',
      };
    }
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
      ? 'React Preview is crossing a proven page condition and will check ' +
        (moduleContext === undefined ? 'the target' : 'the consuming page') + ' again.'
      : 'The authored page is loading. Yellow conditions and generated preview values are not fatal errors.',
    icon: '…',
    kind: 'preparing',
    title: reachability?.status === 'advancing'
      ? moduleContext === undefined ? 'Finding the target on this page' : 'Finding the consuming page flow'
      : 'Preparing page context',
  };
}

/** Lets the user choose perspective while keeping application fallback screens as authored output. */
function PreviewInspectorRenderScenarioSelect() {
  const scenario = readPreviewInspectorRenderScenario();
  const descriptor = findSelectedPreviewInspectorDescriptor();
  const moduleContext = typeof readSelectedPreviewInspectorModuleContext === 'function'
    ? readSelectedPreviewInspectorModuleContext(descriptor)
    : descriptor?.inspector?.contextModule;
  return React.createElement(
    'label',
    {
      className: 'rpi-candidate-select',
      title: moduleContext === undefined
        ? 'Page flow preserves the chosen authored route. File components mounts each current-file export independently.'
        : 'This file contributes values to the selected authored page and has no standalone component export.',
    },
    React.createElement('span', { className: 'rpi-context-badge' }, 'VIEW'),
    React.createElement(
      'select',
      {
        'aria-label': 'Preview rendering perspective',
        className: 'rpi-select',
        onChange: (event) => setPreviewInspectorRenderScenario(event.target.value),
        value: scenario,
      },
      React.createElement('option', { value: 'authored-page' }, 'Page flow (as authored)'),
      moduleContext === undefined
        ? React.createElement('option', { value: 'file-components' }, 'File components (all exports)')
        : undefined,
    ),
  );
}

/** Shows the current outcome, next action, and stable visual vocabulary before the tree. */
function PreviewInspectorFriendlyGuide({ reachability }) {
  const status = readPreviewInspectorFriendlyPageStatus(reachability);
  const descriptor = findSelectedPreviewInspectorDescriptor();
  const moduleContext = typeof readSelectedPreviewInspectorModuleContext === 'function'
    ? readSelectedPreviewInspectorModuleContext(descriptor)
    : descriptor?.inspector?.contextModule;
  const legend = [
    ['component', 'C', 'Component'],
    ['target', '◎', moduleContext === undefined ? 'Current file' : 'Consuming page'],
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
        status.steps === undefined
          ? undefined
          : React.createElement(
              'span',
              { 'aria-label': 'Visibility path', className: 'rpi-friendly-status-steps' },
              status.steps.map((step, index) => React.createElement(
                'span',
                {
                  'data-state': step.state,
                  key: step.label,
                  className: 'rpi-friendly-status-step',
                },
                (index === 0 ? '' : '→ ') + step.label,
              )),
            ),
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
  if (candidates.length === 0) return null;
  const selectedIndex = Math.max(0, candidates.findIndex((candidate) => candidate?.id === selected?.id));
  const reachability = readPreviewInspectorTargetReachabilityState(descriptor, selected);
  const scenario = readPreviewInspectorRenderScenario();
  return React.createElement(
    React.Fragment,
    undefined,
    React.createElement(PreviewInspectorRenderScenarioSelect),
    React.createElement(PreviewInspectorFriendlyGuide, { reachability }),
    React.createElement(
      'label',
      {
        className: 'rpi-candidate-select',
        title: candidates.length > 1
          ? 'Choose which authored caller path should construct the visible page.'
          : 'Only one mountable authored caller path was proven.',
      },
      React.createElement(
        'span',
        { className: 'rpi-context-badge' },
        candidates.length > 1
          ? 'PAGE PATH ' + String(selectedIndex + 1) + '/' + String(candidates.length)
          : 'PAGE PATH',
      ),
      React.createElement(
        'select',
        {
          'aria-label': 'Authored page caller path',
          className: 'rpi-select',
          disabled: candidates.length < 2 || scenario === 'file-components',
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
