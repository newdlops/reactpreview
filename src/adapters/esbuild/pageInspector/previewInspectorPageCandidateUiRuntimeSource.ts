/**
 * Generates the caller-path controls embedded in the Page Inspector context strip.
 * Keeping this presentation fragment separate lets the main DevTools source stay below the
 * project's 1000-line file limit while candidate discovery and loading remain runtime concerns.
 */
import { createPreviewInspectorRouteExplorerUiRuntimeSource } from './previewInspectorRouteExplorerUiRuntimeSource';

/**
 * Creates a native, keyboard-accessible selector for authored page-root candidates.
 *
 * Expected lexical bindings are `React` and the candidate runtime helpers composed into the same
 * browser entry.
 *
 * @returns Plain JavaScript source consumed by the Inspector DevTools source generator.
 */
export function createPreviewInspectorPageCandidateUiRuntimeSource(): string {
  const routeExplorerSource = createPreviewInspectorRouteExplorerUiRuntimeSource();
  return String.raw`
${routeExplorerSource}

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

/** Reports whether the visible controls can apply a different compiler-proven page outcome. */
function hasPreviewInspectorAlternativePageChoice(descriptor, selectedCandidate) {
  const selectedRouteBranchId = descriptor?.inspector?.selectedRouteBranchId;
  const candidates = typeof readPreviewInspectorPageCandidates === 'function'
    ? readPreviewInspectorPageCandidates(descriptor)
    : Array.isArray(descriptor?.inspector?.pageCandidates)
      ? descriptor.inspector.pageCandidates
      : [];
  const routeBranches = typeof readPreviewInspectorRouteBranches === 'function'
    ? readPreviewInspectorRouteBranches(descriptor)
    : Array.isArray(descriptor?.inspector?.routeBranches)
      ? descriptor.inspector.routeBranches
      : [];
  return candidates.some(
    (candidate) => candidate?.id !== selectedCandidate?.id,
  ) || routeBranches.some(
    (branch) => branch?.selectable !== false && branch?.id !== selectedRouteBranchId,
  );
}

/** Moves keyboard focus to the first genuinely actionable page-path control. */
function focusPreviewInspectorPageChoice() {
  if (typeof document === 'undefined') return;
  const shell = typeof previewInspectorCompanionState === 'object'
    ? previewInspectorCompanionState?.shell
    : undefined;
  const queryRoot = shell ?? document;
  const focusChoice = () => {
    const control = queryRoot.querySelector?.('[data-rpi-page-choice="true"]:not(:disabled)');
    control?.focus?.();
    if (typeof schedulePreviewInspectorCompanionSnapshot === 'function') {
      schedulePreviewInspectorCompanionSnapshot();
    }
  };
  const contextToggle = queryRoot.querySelector?.(
    '[data-rpi-accordion-toggle="shell-page-context"]',
  );
  if (contextToggle?.getAttribute?.('aria-expanded') === 'false') {
    contextToggle.click?.();
    requestAnimationFrame(focusChoice);
    return;
  }
  focusChoice();
}

/** Converts internal corridor state into one plain-language status and recommended next action. */
function readPreviewInspectorFriendlyPageStatus(reachability) {
  const descriptor = findSelectedPreviewInspectorDescriptor();
  const selectedCandidate = readSelectedPreviewInspectorPageCandidate(descriptor);
  const moduleContext = typeof readSelectedPreviewInspectorModuleContext === 'function'
    ? readSelectedPreviewInspectorModuleContext(descriptor)
    : descriptor?.inspector?.contextModule;
  const routeChoiceName = selectedCandidate?.rootOwnsRouter === true &&
    typeof selectedCandidate?.routeLocation?.componentName === 'string' &&
    selectedCandidate.routeLocation.componentName !== descriptor?.inspector?.target?.exportName
    ? selectedCandidate.routeLocation.componentName
    : undefined;
  const routeChoicePath = selectedCandidate?.routeLocation?.pathname;
  const alternativePageChoiceAvailable = hasPreviewInspectorAlternativePageChoice(
    descriptor,
    selectedCandidate,
  );
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
  const neuralStatus = typeof readPreviewInspectorNeuralLearningStatus === 'function'
    ? readPreviewInspectorNeuralLearningStatus()
    : undefined;
  if (neuralStatus?.collecting === true || neuralStatus?.restoring === true) {
    const restoring = neuralStatus.restoring === true;
    const successCount = Number.isSafeInteger(neuralStatus.successCount)
      ? neuralStatus.successCount
      : 0;
    return {
      action: restoring ? 'Restoring result' : String(successCount) + ' path(s) saved',
      description: restoring
        ? 'The bounded search is complete. The viewer is returning to its best verified rendered path.'
        : 'A working result is checkpointed while the viewer tests the remaining finite source-proven paths.',
      icon: '◇',
      kind: 'resolving',
      onAction: revealPreviewInspectorFriendlyBlocker,
      title: restoring ? 'Restoring the best rendered path' : 'Collecting rendered paths',
    };
  }
  const mountedWithoutOutput = reachability?.pageRootCommitted === true &&
    reachability?.targetMounted === true && reachability?.targetHasOutput !== true;
  const specificBlocker = blockers.first !== undefined &&
    blockers.first?.blockerKind !== 'target-reachability';
  if (mountedWithoutOutput && !specificBlocker) {
    const deferredCallbackPending = reachability?.targetDeferredCallbackPending === true;
    const wrapperHostOnly = reachability?.targetHasAnyHostOutput === true;
    const resolutionKind = routeChoiceName !== undefined
      ? alternativePageChoiceAvailable ? 'choice' : 'flow-outcome'
      : readPreviewInspectorResolutionKind({
          blocker: reachability,
          blockerKind: 'target-reachability',
        });
    const resolving = resolutionKind === 'automatic';
    return {
      action: routeChoiceName !== undefined && alternativePageChoiceAvailable
        ? 'Choose page path'
        : routeChoiceName !== undefined
          ? 'Inspect selected page'
        : moduleContext !== undefined
        ? 'Find page requirement'
        : deferredCallbackPending
          ? 'Find callback requirement'
          : wrapperHostOnly
            ? 'Find replaced content'
            : 'Find what hides it',
      description: routeChoiceName !== undefined
        ? 'This file owns the Provider and Routes. It ran successfully, but the selected child page ' +
          routeChoiceName + ' at ' + String(routeChoicePath ?? '/') +
          (alternativePageChoiceAvailable
            ? ' produced no visible element. Choose another source-proven page path or inspect this page’s first condition.'
            : ' produced no visible element. No alternate source-proven page path is available, so inspect this page’s first condition.')
        : moduleContext !== undefined
        ? 'The page used this module, but the selected branch contains no visible element. Open the nearest condition or missing value.'
        : deferredCallbackPending
          ? 'This file is available as render content, but its parent has not called it. Open the value or condition that enables the callback.'
        : wrapperHostOnly
          ? 'A wrapper or fallback is visible instead of this file’s authored content. Open the nearest condition or missing value that selected the fallback.'
          : 'The page reached this file, but its current branch returned no visible element. Common causes are an OFF condition, missing data, or an intentional null return.',
      icon: resolutionKind === 'automatic' ? '↻' : resolutionKind === 'choice' ? '?' : '↳',
      kind: resolutionKind === 'automatic' ? 'resolving' : resolutionKind,
      onAction: routeChoiceName !== undefined && alternativePageChoiceAvailable
        ? focusPreviewInspectorPageChoice
        : revealPreviewInspectorMissingTargetOutput,
      steps: [
        { label: 'Page loaded', state: 'done' },
        {
          label: routeChoiceName !== undefined
            ? 'Router ran'
            : moduleContext !== undefined
            ? 'Module used'
            : deferredCallbackPending ? 'File connected' : 'File ran',
          state: 'done',
        },
        {
          label: routeChoiceName !== undefined
            ? 'Selected page hidden'
            : deferredCallbackPending
            ? 'Callback waiting'
            : wrapperHostOnly ? 'Fallback shown' : 'Nothing visible',
          state: 'blocked',
        },
      ],
      title: routeChoiceName !== undefined
        ? 'The selected page route is not visible'
        : moduleContext !== undefined
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
      description: alternativePageChoiceAvailable
        ? 'The chosen authored path committed its UI without mounting the current file. Choose another page path or inspect every current-file export; React Preview does not classify this application outcome.'
        : 'The only proven authored path committed its UI without mounting the current file. Inspect every current-file export; React Preview does not classify this application outcome.',
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
  if (
    reachability?.targetHasOutput !== true &&
    (blockers.count > 0 || reachability?.status === 'page-blocked')
  ) {
    const firstBlocker = typeof blockers.first?.name === 'string'
      ? ' First: ' + blockers.first.name + '.'
      : '';
    const resolutionKind = blockers.first === undefined
      ? 'choice'
      : readPreviewInspectorResolutionKind(blockers.first);
    return {
      action: resolutionKind === 'automatic' ? 'Review progress' : 'Open next step',
      description: String(Math.max(1, blockers.count)) +
        ' unresolved step(s) remain before ' +
        (moduleContext === undefined ? 'the current file' : 'the consuming page') +
        ' can render.' + firstBlocker + (
          resolutionKind === 'automatic'
            ? ' The viewer is working on the next proven repair.'
            : resolutionKind === 'error'
              ? ' Open the ERROR row for the exact runtime failure.'
              : ' Open the ACTION row to choose how to continue.'
        ),
      icon: resolutionKind === 'error' ? '×' : resolutionKind === 'automatic' ? '↻' : '?',
      kind: resolutionKind,
      onAction: revealPreviewInspectorFriendlyBlocker,
      title: resolutionKind === 'automatic'
        ? 'Viewer is resolving the page'
        : resolutionKind === 'error' ? 'Page hit a runtime error' : 'Your choice is needed',
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

/** Presents one page-path surface: static analysis admits candidates and the model ranks them. */
function PreviewInspectorPagePathSurface({ descriptor, reachability }) {
  if (typeof readPreviewInspectorPageContextPathSurface !== 'function') return null;
  const selected = readSelectedPreviewInspectorPageCandidate(descriptor);
  const resolvedReachability = reachability ??
    readPreviewInspectorTargetReachabilityState(descriptor, selected);
  const surface = readPreviewInspectorPageContextPathSurface(
    descriptor,
    resolvedReachability,
  );
  if (surface === undefined) return null;
  const possibilities = surface.paths;
  const viewPath = surface.summary;
  const fileOverview = readPreviewInspectorRenderScenario() === 'file-components';
  const globallyPending = previewInspectorSession.pendingPageCandidateId !== undefined;
  return React.createElement(
    'section',
    {
      'aria-label': 'Page context path recommendation and source-proven alternatives',
      className: 'rpi-page-paths',
      'data-state': viewPath?.state,
    },
    React.createElement(
      'div',
      { className: 'rpi-page-paths-heading' },
      React.createElement(
        'span',
        { className: 'rpi-context-badge' },
        'PAGE CONTEXT PATHS ' + String(possibilities.length),
      ),
      React.createElement(
        'span',
        { 'aria-live': 'polite', className: 'rpi-page-path-status' },
        viewPath?.statusLabel ??
          String(surface.mountVariantCount) + ' SOURCE-PROVEN MOUNT OPTION(S)',
      ),
    ),
    React.createElement(
      'p',
      { className: 'rpi-page-paths-help' },
      fileOverview
        ? 'Choose a source-proven caller chain to leave the file overview and render it in Page flow.'
        : 'Static analysis admits component callers, HOCs, owners, and conditions. The local model only ranks this list; choose and apply paths here.',
    ),
    viewPath === undefined
      ? undefined
      : React.createElement(
          'div',
          { className: 'rpi-page-path-model-meta' },
          React.createElement('span', undefined, viewPath.detail),
          React.createElement('span', undefined, viewPath.modelLabel),
          viewPath.temporalPinned !== true
            ? undefined
            : React.createElement(
                'button',
                {
                  'aria-label': 'Resume normal page time progression',
                  className: 'rpi-button rpi-page-path-resume',
                  onClick: () => releasePreviewInspectorNeuralTemporalStateContract(),
                  title: 'Release the loading checkpoint and let pending application work continue.',
                  type: 'button',
                },
                'Resume',
              ),
        ),
    possibilities.length === 0
      ? React.createElement(
          'p',
          { className: 'rpi-page-paths-empty' },
          'No source-proven page path is available for this file.',
        )
      : React.createElement(
          'ol',
          {
            'aria-label': 'Source-proven page context paths',
            className: 'rpi-page-path-list',
            tabIndex: 0,
          },
      possibilities.map((possibility) => {
        const disabled = possibility.selectable !== true;
        const callerNames = Array.isArray(possibility.callerNames)
          ? possibility.callerNames
          : [];
        const pathLabel = possibility.pathSegments.join(' › ') ||
          'Compiler-proven path ' + String(possibility.index + 1);
        const wrapperLabel = possibility.wrapperNames.length === 0
          ? undefined
          : 'Wrappers: ' + possibility.wrapperNames.join(', ');
        const callerLabel = callerNames.length === 0
          ? undefined
          : 'Callers: ' + callerNames.join(', ');
        const kindLabel = possibility.kinds.length === 0
          ? 'Direct component caller'
          : possibility.kinds.join(' · ');
        return React.createElement(
          'li',
          {
            'data-state': possibility.state,
            key: possibility.id,
            className: 'rpi-page-path-item',
          },
          React.createElement(
            'button',
            {
              'aria-busy': possibility.pending || possibility.checking ? true : undefined,
              'aria-label': (possibility.active ? 'Try next mount option for page path ' :
                possibility.recommended ? 'Apply recommended page path ' :
                  'Apply page path ') + String(possibility.index + 1),
              'aria-pressed': possibility.active ? true : undefined,
              className: 'rpi-page-path-action',
              'data-rpi-page-choice': 'true',
              disabled,
              onClick: () => applyPreviewInspectorPageCandidateChoice(possibility.candidateId),
              title: disabled
                ? possibility.queued
                  ? 'This page path is queued and will apply after the current build.'
                  : possibility.pending
                    ? 'This page path is being prepared.'
                    : possibility.state === 'rejected'
                      ? 'Every retained mount option on this path was rejected by verification.'
                      : possibility.state === 'unstable'
                        ? 'Visible output disappeared during stability verification; choose another path.'
                      : 'This path is already using its only available mount option.'
                : globallyPending
                  ? 'Queue this page path after the current compiler transaction.'
                  : possibility.active
                    ? 'Compile and mount the next remaining option from this wrapper path.'
                    : 'Compile and mount the best remaining option from this wrapper path.',
              type: 'button',
            },
            React.createElement(
              'span',
              { className: 'rpi-page-path-copy' },
              React.createElement(
                'span',
                { className: 'rpi-page-path-segments', title: pathLabel },
                possibility.pathSegments.map((segment, index) => React.createElement(
                  'span',
                  { key: String(index) + ':' + segment },
                  segment,
                )),
              ),
              React.createElement(
                'span',
                { className: 'rpi-page-path-meta' },
                callerLabel === undefined
                  ? undefined
                  : React.createElement('span', undefined, callerLabel),
                wrapperLabel === undefined
                  ? undefined
                  : React.createElement('span', undefined, wrapperLabel),
                React.createElement('span', undefined, kindLabel),
                React.createElement(
                  'span',
                  undefined,
                  String(possibility.evaluatedVariantCount) + '/' +
                    String(possibility.variantCount) + ' mount option(s) tested',
                ),
                possibility.stabilityLabel === undefined
                  ? undefined
                  : React.createElement('span', undefined, possibility.stabilityLabel),
                possibility.executionContractLabel === undefined
                  ? undefined
                  : React.createElement('span', undefined, possibility.executionContractLabel),
                possibility.route === undefined
                  ? undefined
                  : React.createElement('code', { title: possibility.route }, possibility.route),
              ),
            ),
            React.createElement(
              'span',
              { 'aria-live': 'polite', className: 'rpi-page-path-item-status' },
              possibility.statusLabel,
            ),
            React.createElement(
              'span',
              { 'aria-hidden': true, className: 'rpi-button rpi-page-path-apply' },
              possibility.queued
                ? 'Queued'
                : possibility.pending
                  ? 'Applying…'
                  : possibility.state === 'checking'
                    ? 'Checking…'
                    : possibility.state === 'transient'
                      ? 'Pinned'
                    : possibility.state === 'unstable'
                      ? 'Unstable'
                  : possibility.state === 'rejected'
                    ? 'Exhausted'
                    : globallyPending
                      ? 'Queue path'
                      : possibility.active ? 'Try next' : 'Apply path',
            ),
          ),
        );
      }),
    ),
    previewInspectorSession.pendingPageCandidateError === undefined
      ? undefined
      : React.createElement(
          'span',
          { className: 'rpi-note rpi-page-choice-error', role: 'status' },
          previewInspectorSession.pendingPageCandidateError.message,
        ),
  );
}

/** Keeps the count of admitted page paths visible while the Page Context region is collapsed. */
function formatPreviewInspectorPageContextAccordionLabel(descriptor) {
  const possibilities = typeof readPreviewInspectorPageContextPossibilities === 'function'
    ? readPreviewInspectorPageContextPossibilities(descriptor)
    : [];
  const count = possibilities.length > 1 || possibilities.some((possibility) =>
    (Array.isArray(possibility.callerNames) && possibility.callerNames.length > 0) ||
      possibility.wrapperNames.length > 0 ||
      possibility.kinds.length > 0,
  ) ? possibilities.length : 0;
  return count > 0
    ? 'Page context · ' + String(count) + ' path' + (count === 1 ? '' : 's')
    : 'Page context';
}

/** Shows the current outcome, next action, and stable visual vocabulary before the tree. */
function PreviewInspectorFriendlyGuide({ reachability }) {
  const status = readPreviewInspectorFriendlyPageStatus(reachability);
  const descriptor = findSelectedPreviewInspectorDescriptor();
  const moduleContext = typeof readSelectedPreviewInspectorModuleContext === 'function'
    ? readSelectedPreviewInspectorModuleContext(descriptor)
    : descriptor?.inspector?.contextModule;
  const selectedCandidate = readSelectedPreviewInspectorPageCandidate(descriptor);
  const alternativePageChoiceAvailable = hasPreviewInspectorAlternativePageChoice(
    descriptor,
    selectedCandidate,
  );
  const activeResolutionKinds = new Set(
    readPreviewInspectorActiveBlockerSummary().active.map((node) =>
      node?.blockerKind === 'target-reachability' && !alternativePageChoiceAvailable
        ? 'flow-outcome'
        : readPreviewInspectorResolutionKind(node),
    ),
  );
  const legend = [
    ['component', 'C', 'Component'],
    ['target', '◎', moduleContext === undefined ? 'Current file' : 'Consuming page'],
    ['path', '↳', 'Page path'],
    ['condition', '◇', 'Condition'],
    ['assisted', '≈', 'Preview value'],
    ...(status.kind === 'resolving' || activeResolutionKinds.has('automatic')
      ? [['automatic', '↻', 'Viewer resolving']]
      : []),
    ...(status.kind === 'choice' || activeResolutionKinds.has('choice')
      ? [['choice', '?', 'Your choice']]
      : []),
    ...(status.kind === 'error' || activeResolutionKinds.has('error')
      ? [['error', '×', 'Runtime error']]
      : []),
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

/** Composes the rendering perspective, canonical path surface, status, and route explorer. */
function PreviewInspectorPageContextControls({ descriptor }) {
  const candidates = readPreviewInspectorPageCandidates(descriptor);
  const selected = readSelectedPreviewInspectorPageCandidate(descriptor);
  if (candidates.length === 0) return null;
  const reachability = readPreviewInspectorTargetReachabilityState(descriptor, selected);
  return React.createElement(
    React.Fragment,
    undefined,
    React.createElement(PreviewInspectorRenderScenarioSelect),
    React.createElement(PreviewInspectorPagePathSurface, { descriptor, reachability }),
    React.createElement(PreviewInspectorFriendlyGuide, { reachability }),
    React.createElement(PreviewInspectorRouteExplorer, { descriptor }),
  );
}
`;
}
