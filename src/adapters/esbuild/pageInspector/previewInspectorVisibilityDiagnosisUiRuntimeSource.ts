/** Presents source-path proof and observed render logic separately without changing page state. */

/** Generates bounded, read-only diagnostics and shared evidence rows for Inspector surfaces. */
export function createPreviewInspectorVisibilityDiagnosisUiRuntimeSource(): string {
  return String.raw`
/** Formats only observed strings; diagnostic text never invokes authored object coercion. */
function formatPreviewInspectorVisibilityEvidence(value, fallback = '', limit = 240) {
  return typeof value === 'string' && value.length > 0
    ? value.slice(0, limit) + (value.length > limit ? '…' : '') : fallback;
}

/** Separates an observed code gate from a missing or unverified page context. */
function readPreviewInspectorVisibilityDiagnosis(state, options = {}) {
  if (state === undefined) return undefined;
  const descriptor = options.descriptor ?? (typeof findSelectedPreviewInspectorDescriptor === 'function'
    ? findSelectedPreviewInspectorDescriptor() : undefined);
  const candidate = options.candidate ?? (typeof readSelectedPreviewInspectorPageCandidate === 'function'
    ? readSelectedPreviewInspectorPageCandidate(descriptor) : undefined);
  const target = formatPreviewInspectorVisibilityEvidence(state.targetExportName, 'the current file', 160);
  const normalizePath = (value) => typeof value === 'string' ? value.replaceAll('\\', '/') : '';
  const targetSource = normalizePath(state.targetSourcePath);
  const session = typeof previewInspectorSession === 'object' ? previewInspectorSession : {};
  const sameCandidate = typeof state.candidateId !== 'string' || typeof candidate?.id !== 'string' ||
    state.candidateId === candidate.id;
  const currentKey = session.activeTargetReachabilityKey;
  const selectedTarget = candidate?.target ?? descriptor?.inspector?.target;
  const selectedTargetSource = normalizePath(selectedTarget?.sourcePath);
  const targetIdentityKnown = selectedTargetSource.length > 0 &&
    typeof selectedTarget?.exportName === 'string';
  const sameTarget = !targetIdentityKnown || selectedTargetSource === targetSource &&
    selectedTarget.exportName === state.targetExportName;
  const current = sameCandidate && sameTarget &&
    (typeof currentKey !== 'string' || currentKey === state.key);
  const execution = typeof readSelectedPreviewInspectorPageExecutionCandidate === 'function'
    ? readSelectedPreviewInspectorPageExecutionCandidate(descriptor) : undefined;
  const componentOnly = current && (execution?.standaloneTarget === true ||
    ['target-contextual', 'target-only'].includes(execution?.fidelity));
  const linked = current && targetSource.length > 0 &&
    normalizePath(candidate?.target?.sourcePath) === targetSource &&
    candidate?.target?.exportName === state.targetExportName && (
      (Array.isArray(candidate?.renderPath?.steps) ? candidate.renderPath.steps : []).slice(0, 64).some((step) =>
        normalizePath(step?.sourcePath) === targetSource) ||
      (Array.isArray(candidate?.edges) ? candidate.edges : []).slice(0, 64).some((edge) =>
        normalizePath(edge?.child?.sourcePath) === targetSource &&
        edge?.child?.exportName === state.targetExportName)
    );
  const base = {
    action: 'path', actionLabel: 'Inspect path evidence',
    key: state.key,
    path: componentOnly ? 'Only a component-level context was restored.'
      : linked ? 'Source-linked to the target; runtime arrival not verified.'
      : 'Not verified. Loading a page alone does not prove it contains the target.',
    logic: 'No blocking condition has been verified for this target.',
    kind: 'unknown', title: 'Why this file is missing is not yet known',
    description: 'The target has not been observed. The current evidence cannot distinguish a wrong page path from an unobserved code or data condition.',
  };
  if (!current) return { ...base, kind: 'pending', title: 'Checking the newly selected path',
    description: 'The retained result belongs to an earlier path. Its conditions cannot explain the current selection.' };
  if (state.directTarget === true) return { ...base, action: undefined, kind: 'diagnostic',
    title: 'File-only view does not verify the page', path: 'Bypassed in file-only view.',
    description: 'Return to page flow to check this component in its authored page.' };
  if (state.pageRootCommitted !== true) return { ...base, action: undefined, kind: 'pending',
    title: 'Waiting for page execution', path: 'Not checked yet; the page has not committed.',
    description: 'A code or page-path cause cannot be established before the page runs.' };
  if (state.targetOutputKind === 'fallback-output' || state.pendingTargetRepairFailure !== undefined) {
    return { ...base, action: 'details', actionLabel: 'Inspect render error', kind: 'render-error',
      title: 'A runtime error replaced the target', logic: 'A render failure was observed.',
      description: 'Inspect the recorded error. An error fallback is not evidence that a different page should be selected.' };
  }
  if (state.targetMounted === true && state.targetHasOutput === true) {
    const observation = typeof readPreviewInspectorPageExecutionContextObservation === 'function'
      ? readPreviewInspectorPageExecutionContextObservation(descriptor, candidate, state) : undefined;
    if (observation?.contextComplete === false) return { ...base, kind: 'page-context',
      title: 'The target rendered without verified page context',
      path: observation.componentOnly === true ? 'Only a component-level context was restored.'
        : 'The expected authored page context was not verified.',
      logic: 'The target produced output; a hidden target branch is not the observed problem.',
      description: 'Check the page path and its owners. Showing the component alone does not confirm the original page layout.' };
    return { ...base, action: undefined, kind: 'visible', title: 'Target output is visible',
      path: observation?.contextComplete === true ? 'Authored page context verified at runtime.'
        : 'The target was reached; full page context is not independently verified here.',
      logic: 'The target produced its own visible output.', description: '' };
  }
  let blockers = options.blockers;
  if (blockers === undefined && typeof readPreviewInspectorActiveBlockerSummary === 'function') {
    try { blockers = readPreviewInspectorActiveBlockerSummary(); } catch { /* Missing evidence remains unknown. */ }
  }
  const gate = (Array.isArray(blockers?.active) ? blockers.active : []).slice(0, 128).find((node) => {
    const condition = node?.condition;
    return node?.blocksCurrentTarget === true && typeof state.key === 'string' &&
      condition?.reachabilityKey === state.key && condition?.reached !== false &&
      typeof condition?.effectiveEnabled === 'boolean' && typeof condition?.id === 'string';
  });
  if (gate !== undefined) {
    const condition = gate.condition;
    const enabled = condition.effectiveEnabled;
    const expression = formatPreviewInspectorVisibilityEvidence(condition.expression, 'Observed condition');
    const branch = formatPreviewInspectorVisibilityEvidence(
      enabled ? condition.falsyLabel : condition.truthyLabel, target,
    );
    const location = formatPreviewInspectorVisibilityEvidence(condition.sourcePath, 'Source location unavailable');
    return { ...base, action: 'condition', actionLabel: 'Inspect blocking condition',
      kind: 'code-condition', title: 'An observed condition blocks the inferred target path',
      description: 'This condition ran and selected the other branch. Inspect it before changing the page path; other requirements may still remain.',
      logic: expression + ' is ' + (enabled ? 'ON' : 'OFF') +
        '; the inferred target branch requires ' + (enabled ? 'OFF.' : 'ON.'),
      expression, branch, nodeId: gate.id, conditionId: condition.id,
      location: location + (Number.isSafeInteger(condition.line) && condition.line > 0 ? ':' + condition.line : ''),
    };
  }
  if (componentOnly) {
    return { ...base, kind: 'page-context', title: 'The authored page context was not restored',
      path: 'Only a component-level context was restored.',
      description: 'This execution uses a component-level fallback, not the authored page. Inspect the page path; there is not enough evidence to blame a code condition.' };
  }
  if (state.targetWasMounted === true && state.targetMounted !== true &&
      state.targetHasOutput !== true && targetIdentityKnown &&
      typeof currentKey === 'string' && currentKey === state.key) {
    const resolving = typeof isPreviewInspectorTargetReachabilityResolving === 'function' &&
      isPreviewInspectorTargetReachabilityResolving(state);
    return { ...base, action: resolving ? undefined : 'details', actionLabel: 'Inspect target evidence',
      kind: resolving ? 'pending' : 'unmounted-target',
      title: resolving ? 'Checking the target after an earlier mount'
        : 'The target was reached earlier on this path',
      path: 'An earlier target mount was recorded; the current page context is not verified.',
      logic: resolving ? 'The target mounted earlier; its current render is still being checked.'
        : 'The target mounted earlier and is not mounted now. The cause of its removal is not verified.',
      description: resolving ? 'Wait for the current render check before changing a page path or condition.'
        : 'Inspect the recorded render and observed conditions. An earlier mount does not prove that the current page is ready.' };
  }
  if (state.targetMounted === true && state.targetHasOutput !== true) {
    const waiting = state.targetDeferredCallbackPending === true;
    return { ...base, action: 'details', actionLabel: waiting ? 'Inspect parent requirement' : 'Inspect target output',
      kind: waiting ? 'parent-callback' : 'empty-output',
      title: waiting ? 'The parent has not invoked the render content' : 'The target ran but produced no visible output',
      path: 'The target boundary was reached on this path; full page context is not yet verified.',
      logic: waiting ? 'The render callback has not been invoked.'
        : 'Empty or replacement output was observed; its exact condition is not yet known.',
      description: waiting ? 'Inspect the parent callback and its data requirements. Choosing another page is not justified by this evidence alone.'
        : 'Inspect conditions, returned content and fallback values inside this target. This is different from a target that was never reached.' };
  }
  return base;
}

/** Reads only the active retained observation; it does not start traversal or apply a value. */
function readPreviewInspectorCurrentVisibilityDiagnosis() {
  const session = typeof previewInspectorSession === 'object' ? previewInspectorSession : undefined;
  const key = session?.activeTargetReachabilityKey;
  const state = typeof key === 'string' ? session?.targetReachabilityByKey?.get?.(key) : undefined;
  return state === undefined ? undefined : readPreviewInspectorVisibilityDiagnosis(state);
}

/** Re-reads the selected path before navigation so stale evidence cannot select an unrelated gate. */
function activatePreviewInspectorVisibilityDiagnosis(diagnosis) {
  if (diagnosis === undefined) return false;
  const key = previewInspectorSession.activeTargetReachabilityKey;
  if (typeof key === 'string' && diagnosis.key !== key) return false;
  if (diagnosis.kind === 'unmounted-target' &&
      readPreviewInspectorCurrentVisibilityDiagnosis()?.kind !== 'unmounted-target') return false;
  if (diagnosis.action === 'condition') {
    const current = typeof readPreviewInspectorActiveBlockerSummary === 'function'
      ? readPreviewInspectorActiveBlockerSummary().active.find((node) =>
        node?.id === diagnosis.nodeId && node?.blocksCurrentTarget === true &&
        node?.condition?.reachabilityKey === diagnosis.key &&
        node?.condition?.id === diagnosis.conditionId) : undefined;
    if (current === undefined) return false;
    requestPreviewInspectorTreeReveal(current.id);
    selectPreviewInspectorUiNode(current);
    return true;
  }
  if (diagnosis.action === 'path') {
    if (typeof revealPreviewInspectorNeuralInferenceEvidence === 'function') {
      revealPreviewInspectorNeuralInferenceEvidence();
      return true;
    }
    if (typeof focusPreviewInspectorPageChoice === 'function') {
      focusPreviewInspectorPageChoice();
      return true;
    }
  }
  if (typeof revealPreviewInspectorMissingTargetOutput === 'function') {
    revealPreviewInspectorMissingTargetOutput();
    return true;
  }
  return false;
}

/** Keeps the two independent diagnoses and concrete observed proof visible in existing chrome. */
function PreviewInspectorVisibilityEvidence({ diagnosis, showAction = false }) {
  if (diagnosis === undefined || ['visible', 'diagnostic'].includes(diagnosis.kind)) return null;
  return React.createElement('span', { className: 'rpi-visibility-evidence', 'aria-label': 'Visibility evidence' },
    React.createElement('span', undefined, React.createElement('strong', undefined, 'Page path: '), diagnosis.path),
    React.createElement('span', undefined, React.createElement('strong', undefined, 'Render logic: '), diagnosis.logic),
    diagnosis.branch === undefined ? null : React.createElement('span', undefined,
      React.createElement('strong', undefined, 'Target branch: '),
      React.createElement('code', undefined, diagnosis.branch)),
    diagnosis.location === undefined ? null : React.createElement('span', undefined,
      React.createElement('strong', undefined, 'Observed at: '),
      React.createElement('code', undefined, diagnosis.location)),
    showAction && diagnosis.action !== undefined ? React.createElement(PreviewInspectorDevtoolsButton,
      { onClick: () => activatePreviewInspectorVisibilityDiagnosis(diagnosis) }, diagnosis.actionLabel) : null,
  );
}
`;
}
