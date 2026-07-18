/**
 * Generates the browser runtime that switches among statically proven authored page roots.
 * Candidate modules stay behind dynamic imports, so discovering several caller paths does not make
 * initial preview evaluation proportional to the number of possible pages.
 */

/**
 * Creates candidate selection, persistence, lazy loading, and root-prop composition helpers.
 *
 * Expected lexical bindings are `React`, `previewInspectorSession`, the shared state helpers, and
 * `createPreviewInspectorElement`; all are supplied by the composed Page Inspector entry runtime.
 *
 * @returns Plain JavaScript source concatenated into the browser-owned Inspector runtime.
 */
export function createPreviewInspectorPageCandidateRuntimeSource(): string {
  return String.raw`
/** Returns selectable page roots, synthesizing the legacy single-root contract when necessary. */
function readPreviewInspectorPageCandidates(descriptor) {
  const inspector = descriptor?.inspector;
  if (inspector === undefined) return [];
  if (Array.isArray(inspector.pageCandidates) && inspector.pageCandidates.length > 0) {
    return inspector.pageCandidates;
  }
  if (inspector.root === undefined) return [];
  return [{
    complete: inspector.complete === true,
    edges: inspector.ancestry ?? [],
    id: 'nearest-authored-owner',
    renderPath: inspector.renderChain?.paths?.[0],
    root: inspector.root,
    rootAutomaticProps: descriptor?.automaticProps ?? {},
    rootOwnsRouter: false,
    stopReason: inspector.stopReason,
    targetAutomaticProps: inspector.targetAutomaticProps ?? {},
  }];
}

/** Resolves the persisted candidate id against the current descriptor after every hot rebuild. */
function readSelectedPreviewInspectorPageCandidate(descriptor) {
  const candidates = readPreviewInspectorPageCandidates(descriptor);
  return candidates.find((candidate) => candidate?.id === previewInspectorSession.selectedPageCandidateId) ??
    candidates[0];
}

/** Reads generated-value provenance for the selected editable target or page root. */
function readSelectedPreviewInspectorInferredProps(exportName) {
  for (const descriptor of previewInspectorSession.descriptors) {
    const selectedCandidate = readSelectedPreviewInspectorPageCandidate(descriptor);
    const selectedRootName = descriptor?.inspector === undefined
      ? undefined
      : createPreviewInspectorRootName(selectedCandidate?.root ?? descriptor.inspector.root);
    if (selectedRootName !== undefined && selectedRootName === exportName) {
      const rootInferredProps = selectedCandidate?.rootInferredProps;
      return Array.isArray(rootInferredProps) ? rootInferredProps : [];
    }
    const targetName = descriptor?.inspector?.target?.exportName ?? descriptor?.exportName;
    if (targetName !== exportName) continue;
    const inferredProps = descriptor?.inspector?.targetInferredProps ?? descriptor?.inferredProps;
    return Array.isArray(inferredProps) ? inferredProps : [];
  }
  return [];
}

/** Produces a concise candidate label without exposing absolute local filesystem paths. */
function formatPreviewInspectorPageCandidate(candidate, index) {
  const rootName = candidate?.root?.exportName ?? 'default';
  const names = [];
  const steps = candidate?.renderPath?.steps ?? [];
  const rootStepIndex = Number.isInteger(candidate?.rootStepIndex)
    ? candidate.rootStepIndex
    : undefined;
  const rootStep = rootStepIndex === undefined ? undefined : steps[rootStepIndex];
  if (typeof rootStep?.label === 'string' && rootStep.label.length > 0) {
    names.push(rootStep.label);
  } else {
    names.push(rootName);
  }
  const visibleSteps = rootStepIndex === undefined
    ? [...steps].reverse()
    : steps.slice(rootStepIndex + 1);
  for (const step of visibleSteps) {
    for (const name of [step?.label, ...[...(step?.wrapperNames ?? [])].reverse()]) {
      if (typeof name === 'string' && name.length > 0 && names.at(-1) !== name) names.push(name);
    }
  }
  if (rootStepIndex === undefined && !names.includes(rootName)) names.unshift(rootName);
  const visibleNames = names.slice(0, 5);
  const pathLabel = visibleNames.join(' › ') + (names.length > visibleNames.length ? ' › …' : '');
  const entryConnected = candidate?.renderPath?.entryPoint !== undefined;
  return String(index + 1) + '. ' + pathLabel +
    (candidate?.complete === true && entryConnected
      ? ' · application root'
      : entryConnected ? ' · application path' : ' · partial context');
}

/** Selects one authored caller path and asks the root, tree, and highlight layers to reconcile. */
function selectPreviewInspectorPageCandidate(candidateId) {
  if (typeof candidateId !== 'string' || candidateId.length === 0) return;
  const descriptor = findSelectedPreviewInspectorDescriptor();
  if (!readPreviewInspectorPageCandidates(descriptor).some((candidate) => candidate?.id === candidateId)) {
    return;
  }
  if (previewInspectorSession.selectedPageCandidateId === candidateId) return;
  resetPreviewInspectorTargetReachability();
  previewInspectorSession.selectedPageCandidateId = candidateId;
  previewInspectorSession.selectedTreeNodeId = undefined;
  persistPreviewInspectorState();
  notifyPreviewInspector();
  schedulePreviewInspectorCommitRefresh();
}

/** Loads only the selected candidate module and discards late results after a selection change. */
function PreviewInspectorPageCandidateLoader({ definitions, targetProps }) {
  usePreviewInspectorStore();
  const descriptor = findSelectedPreviewInspectorDescriptor();
  const candidate = readSelectedPreviewInspectorPageCandidate(descriptor);
  const reachability = readPreviewInspectorTargetReachabilityState(descriptor, candidate);
  const pageDefinition = definitions.find((item) => item?.id === candidate?.id) ??
    definitions.find((item) => item?.directTarget !== true);
  const directDefinition = definitions.find((item) =>
    item?.directTarget === true &&
    item?.targetExportName === reachability.targetExportName,
  );
  const definition = reachability.directTarget && directDefinition !== undefined
    ? directDefinition
    : pageDefinition ?? definitions[0];
  const directTarget = definition?.directTarget === true;
  const [loadState, setLoadState] = React.useState({ definition: undefined, status: 'loading' });
  React.useEffect(() => {
    let active = true;
    if (typeof definition?.load !== 'function') {
      setLoadState({
        definition,
        error: new Error('The selected Page Inspector candidate has no module loader.'),
        status: 'failed',
      });
      return () => { active = false; };
    }
    setLoadState({ definition, status: 'loading' });
    Promise.resolve()
      .then(() => definition.load())
      .then(
        (value) => {
          if (!active) return;
          if (value === undefined || value === null) {
            throw new Error('The selected authored page root export is unavailable.');
          }
          setLoadState({ definition, status: 'ready', value });
        },
        (error) => {
          if (active) setLoadState({ definition, error, status: 'failed' });
        },
      )
      .catch((error) => {
        if (active) setLoadState({ definition, error, status: 'failed' });
      });
    return () => { active = false; };
  }, [definition]);
  if (loadState.definition !== definition || loadState.status === 'loading') {
    return React.createElement(
      'div',
      { className: 'react-preview-suspense-placeholder', role: 'status' },
      directTarget ? 'Loading selected component fallback…' : 'Loading authored page context…',
    );
  }
  if (loadState.status === 'failed') throw loadState.error;
  const rootElement = createPreviewInspectorElement(
    loadState.value,
    directTarget ? (candidate?.targetAutomaticProps ?? {}) : targetProps,
  );
  const routedElement = createPreviewCandidateRouterElement(rootElement, {
    ownsRouter: directTarget ? false : candidate?.rootOwnsRouter === true,
  });
  return React.createElement(
    PreviewInspectorTargetReachabilityProbe,
    { candidate, descriptor, directTarget, directTargetAvailable: directDefinition !== undefined },
    routedElement,
  );
}

/** Creates a React element from generated lazy-loader definitions without exposing React globally. */
function createPreviewInspectorPageCandidateElement(definitions, targetProps) {
  return React.createElement(PreviewInspectorPageCandidateLoader, {
    definitions: Array.isArray(definitions) ? definitions : [],
    targetProps,
  });
}
`;
}
