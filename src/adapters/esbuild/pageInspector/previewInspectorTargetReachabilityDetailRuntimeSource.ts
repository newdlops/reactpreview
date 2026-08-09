/**
 * Generates the target-reachability editor shown when an authored page does not visibly expose the
 * selected source export.
 *
 * Keeping this sizeable diagnostic UI separate from blocker-node construction preserves the
 * Inspector module boundary and the repository's per-file line budget. The generated browser
 * function deliberately consumes the shared Page Inspector runtime helpers rather than importing
 * application code into the webview.
 */

/**
 * Creates browser source for the route-aware target-reachability detail panel.
 *
 * The runtime distinguishes a genuinely empty leaf from a Provider/Routes owner. For route owners,
 * the selected child page and pathname are named explicitly so the user can change the Page path
 * instead of attempting to invent props for a wrapper that is already working.
 *
 * @returns Plain JavaScript source concatenated into the isolated Inspector UI runtime.
 */
export function createPreviewInspectorTargetReachabilityDetailRuntimeSource(): string {
  return String.raw`
const PREVIEW_INSPECTOR_TARGET_RESOLVING_STATUSES = new Set([
  'activating-local-ui',
  'advancing',
  'blocked',
  'filling-requirements',
  'mounting-contextual-target',
  'page-root-pending',
  'probing',
  'probing-after-manual-condition',
  'repairing-target-props',
  'resolving-deferred-render-contract',
  'resuming-new-requirements',
  'revealing-overlay',
  'searching-deterministic-requirements',
  'searching-requirements',
  'settling-auto-attempt',
]);

/** Keeps an active path probe informational until its bounded search reaches a terminal state. */
function isPreviewInspectorTargetReachabilityResolving(blocker) {
  const minimumSearchStatus = blocker?.minimumRequirementSearch?.status;
  if (
    blocker?.directTarget === true ||
    blocker?.exhausted === true ||
    ['candidate-output', 'fallback-output'].includes(blocker?.targetOutputKind) ||
    ['cycle-detected', 'limit-reached', 'rolled-back'].includes(minimumSearchStatus) ||
    [
      'page-blocked',
      'requirements-stalled',
      'resolver-cycle-detected',
      'resolver-limit-reached',
      'resolver-rolled-back',
      'target-error',
    ].includes(blocker?.status)
  ) return false;
  return minimumSearchStatus === 'searching' ||
    PREVIEW_INSPECTOR_TARGET_RESOLVING_STATUSES.has(blocker?.status);
}

/** Explains a logical path blocker and exposes retry/direct-target recovery without hiding context. */
function PreviewInspectorTargetReachabilityDetail({ node }) {
  const blocker = node.blocker;
  const descriptor = typeof findSelectedPreviewInspectorDescriptor === 'function'
    ? findSelectedPreviewInspectorDescriptor()
    : undefined;
  const selectedCandidate = typeof readSelectedPreviewInspectorPageCandidate === 'function'
    ? readSelectedPreviewInspectorPageCandidate(descriptor)
    : undefined;
  const direct = blocker.directTarget === true;
  const pageCommitted = blocker.pageRootCommitted === true && !direct;
  const targetMounted = blocker.targetMounted === true;
  const targetHasOutput = blocker.targetHasOutput === true;
  const targetMountedWithoutOutput = targetMounted && !targetHasOutput;
  const deferredCallbackPending = targetMountedWithoutOutput &&
    blocker.targetDeferredCallbackPending === true;
  const wrapperHostOnly = targetMountedWithoutOutput && blocker.targetHasAnyHostOutput === true;
  const fallbackOutput = blocker.targetOutputKind === 'fallback-output';
  const candidateOutput = blocker.targetOutputKind === 'candidate-output';
  const targetOutputError = blocker.targetOutputError;
  const routeChoiceName = selectedCandidate?.rootOwnsRouter === true &&
    typeof selectedCandidate?.routeLocation?.componentName === 'string' &&
    selectedCandidate.routeLocation.componentName !== blocker.targetExportName
    ? selectedCandidate.routeLocation.componentName
    : undefined;
  const routeChoicePath = selectedCandidate?.routeLocation?.pathname;
  const requiredPathSummary = summarizePreviewInspectorRequiredPaths(blocker.requiredPaths);
  const minimumSearch = blocker.minimumRequirementSearch;
  const resolving = isPreviewInspectorTargetReachabilityResolving(blocker);
  const circuitOpen = ['cycle-detected', 'limit-reached'].includes(minimumSearch?.status) ||
    minimumSearch?.status === 'rolled-back';
  const invisibleExplanation = fallbackOutput
    ? 'The visible DOM belongs to an error fallback, not this file’s authored output.'
    : candidateOutput
      ? 'Connected DOM exists, but its Fiber is not owned by the selected file boundary.'
      : deferredCallbackPending
        ? 'This file is waiting for its parent to call the render callback.'
        : wrapperHostOnly
          ? 'A wrapper or fallback is visible instead of this file’s authored content.'
          : routeChoiceName !== undefined
            ? 'This file owns the Provider and Routes. The selected child page ' +
              routeChoiceName + ' at ' + String(routeChoicePath ?? '/') +
              ' produced no visible element. Choose another Page path or inspect this page’s first condition.'
            : 'This file ran, but the current branch produced no visible element.';
  const searchStatusLabel = minimumSearch?.status === 'rolled-back'
    ? 'stopped: unsafe generated values reverted'
    : minimumSearch?.status === 'cycle-detected'
    ? 'stopped: the same values repeated'
    : minimumSearch?.status === 'limit-reached'
      ? 'stopped: pass limit reached'
      : minimumSearch?.status === 'settled' ? 'finished' : minimumSearch?.status;
  return React.createElement(
    'div',
    { className: 'rpi-detail-content' },
    React.createElement(
      'div',
      { className: resolving ? 'rpi-note' : 'rpi-error', role: resolving ? 'status' : 'alert' },
      fallbackOutput
        ? 'Original render error' +
          (typeof targetOutputError?.ownerName === 'string'
            ? ' in ' + targetOutputError.ownerName
            : '') +
          ': ' + String(targetOutputError?.message ?? 'an error fallback replaced the target')
        : candidateOutput
          ? invisibleExplanation
          : circuitOpen
            ? minimumSearch.status === 'rolled-back'
              ? 'Automatic search stopped because a generated preview value caused a render error and was reverted.'
              : minimumSearch.status === 'cycle-detected'
                ? 'Automatic search stopped because it kept generating the same preview values.' +
                  (targetMountedWithoutOutput ? ' ' + invisibleExplanation : '')
                : 'Automatic search stopped after its safe pass limit.' +
                  (targetMountedWithoutOutput ? ' ' + invisibleExplanation : '')
            : resolving
              ? pageCommitted
                ? targetMountedWithoutOutput
                  ? 'The page loaded. React Preview is still checking this file’s visible output…'
                  : 'The page loaded. React Preview is still tracing the selected file on this path…'
                : 'The page is still loading.'
              : direct
                ? 'File-only view is active. Return to the page to inspect the real layout.'
                : pageCommitted
                  ? targetMountedWithoutOutput
                    ? invisibleExplanation
                    : 'The page loaded, but this path did not use ' + blocker.targetExportName + '.'
                  : 'The page is still loading.',
    ),
    React.createElement('div', { className: 'rpi-note' },
      'Page: ' + blocker.rootName + ' · ' + (pageCommitted ? 'loaded' : 'still loading')),
    React.createElement('div', { className: 'rpi-note' },
      'Current file: ' + blocker.targetExportName + ' · ' +
      (fallbackOutput
        ? 'error fallback visible instead'
        : candidateOutput
          ? 'candidate DOM rejected · exact target Fiber absent'
          : resolving
            ? targetMountedWithoutOutput
              ? 'connected · checking visible output'
              : 'searching this page path'
            : targetMountedWithoutOutput
              ? deferredCallbackPending
                ? 'connected · waiting for parent callback'
                : wrapperHostOnly
                  ? 'ran · fallback visible instead'
                  : routeChoiceName !== undefined
                    ? 'router ran · selected ' + routeChoiceName + ' hidden'
                    : 'ran · no visible element'
              : targetMounted
                ? 'visible'
                : 'not used on this path')),
    React.createElement('div', { className: 'rpi-note' },
      'Page path: ' + blocker.applicationPath.join(' > ')),
    blocker.appliedConditions.length > 0
      ? React.createElement('div', { className: 'rpi-note' },
          'Conditions automatically used for this path: ' + blocker.appliedConditions
            .map((condition) => condition.expression + ' = ' + String(condition.enabled))
            .join(', '))
      : React.createElement('div', { className: 'rpi-note' },
          resolving
            ? 'React Preview is following newly revealed conditions and data requirements on this path.'
            : targetMountedWithoutOutput
              ? deferredCallbackPending
                ? 'Next likely cause: the parent needs data before it calls this render callback.'
                : routeChoiceName !== undefined
                  ? 'Choose another Page path above, or inspect the first condition inside ' +
                    routeChoiceName + '.'
                  : 'Next likely cause: an OFF condition, missing data, or a child that intentionally returns nothing.'
              : 'No login, session, or permission condition has been proven for this path yet.'),
    requiredPathSummary.totalCount > 0
      ? React.createElement('div', { className: 'rpi-note' },
          'Possible data needed next (' +
          String(requiredPathSummary.totalCount) + '): ' +
          requiredPathSummary.visiblePaths.join(', ') +
          (requiredPathSummary.remainingCount > 0
            ? ' · +' + String(requiredPathSummary.remainingCount) + ' more'
            : ''))
      : React.createElement('div', { className: 'rpi-note' },
          'No required data field has been observed yet. More fields appear as additional branches run.'),
    minimumSearch === undefined
      ? undefined
      : React.createElement('div', { className: 'rpi-note' },
          'Automatic requirement search: pass ' + String(minimumSearch.pass) + ' of ' +
          String(PREVIEW_INSPECTOR_MINIMUM_REQUIREMENT_PASS_LIMIT) + ' · ' +
          searchStatusLabel + ' · ' + String(minimumSearch.observedPathCount) +
          ' possible field(s) seen.' +
          (minimumSearch.cycleLength > 0
            ? ' Repeated cycle length: ' + String(minimumSearch.cycleLength) + '.'
            : '')),
    React.createElement(
      'div',
      { className: 'rpi-actions' },
      React.createElement(
        PreviewInspectorDevtoolsButton,
        {
          disabled: resolving,
          onClick: () => smartFillPreviewInspectorTargetApplicationPath(blocker),
          title: 'Follow newly revealed hook and backend fields in bounded passes, fill their minimum shape, and retry the authored page',
        },
        resolving ? 'Searching…' : 'Auto-find missing values',
      ),
      React.createElement(
        PreviewInspectorDevtoolsButton,
        {
          onClick: direct
            ? returnPreviewInspectorToPageContext
            : retryPreviewInspectorTargetApplicationPath,
        },
        direct ? 'Return to page' : 'Try page again',
      ),
      React.createElement(
        PreviewInspectorDevtoolsButton,
        {
          disabled: direct || blocker.directTargetAvailable !== true,
          onClick: showPreviewInspectorTargetDirectly,
        },
        'Show file by itself',
      ),
    ),
    React.createElement('div', { className: 'rpi-note' },
      'Preview values never change source code or backend data. Your manual condition and payload choices stay in control.'),
  );
}
`;
}
