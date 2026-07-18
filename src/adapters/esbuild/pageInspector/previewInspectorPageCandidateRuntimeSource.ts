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

/** Returns the explicit rendering perspective without inferring business meaning from page text. */
function readPreviewInspectorRenderScenario() {
  return previewInspectorSession.renderScenario === 'file-components'
    ? 'file-components'
    : 'authored-page';
}

/** Switches between the preserved authored page and an export overview chosen by the user. */
function setPreviewInspectorRenderScenario(nextScenario) {
  if (nextScenario !== 'authored-page' && nextScenario !== 'file-components') return;
  if (readPreviewInspectorRenderScenario() === nextScenario) return;
  resetPreviewInspectorTargetReachability();
  previewInspectorSession.renderScenario = nextScenario;
  previewInspectorSession.selectedTreeNodeId = undefined;
  persistPreviewInspectorState();
  notifyPreviewInspector();
  schedulePreviewInspectorCommitRefresh();
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

/**
 * Marks a successful commit of the authored page subtree without inserting a host DOM wrapper.
 * If a descendant throws before commit, React never calls this boundary's mount lifecycle and the
 * corridor correctly remains blocked. Target-only diagnostics deliberately bypass this boundary.
 */
class PreviewInspectorPageRootCommitBoundary extends React.Component {
  componentDidMount() {
    this.markCommitted();
  }

  componentDidUpdate() {
    this.markCommitted();
  }

  componentWillUnmount() {
    const state = this.props.reachability;
    if (state?.pageCommitBoundary !== this) return;
    state.pageCommitBoundary = undefined;
    state.pageRootCommitted = false;
    schedulePreviewInspectorTreeRefresh();
  }

  /** Records only the selected authored root associated with this exact mounted boundary. */
  markCommitted() {
    const state = this.props.reachability;
    if (state === undefined || state.directTarget === true) return;
    const changed = state.pageRootCommitted !== true || state.pageCommitBoundary !== this;
    state.pageCommitBoundary = this;
    state.pageRootCommitted = true;
    state.rootName = this.props.rootName ?? state.rootName;
    if (changed) schedulePreviewInspectorTreeRefresh();
  }

  render() {
    return this.props.children;
  }
}

/** Loads one generated definition and ignores a stale promise after selection or hot reload. */
function usePreviewInspectorLazyDefinition(definition) {
  const [loadState, setLoadState] = React.useState({ definition: undefined, status: 'loading' });
  React.useEffect(() => {
    let active = true;
    if (typeof definition?.load !== 'function') {
      setLoadState({
        definition,
        error: new Error('The selected React Preview definition has no module loader.'),
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
            throw new Error('The selected React component export is unavailable.');
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
  return loadState;
}

/** Re-throws a rejected dynamic import inside the nearest per-export React error boundary. */
function PreviewInspectorFileComponentLoadFailure({ error }) {
  throw error;
}

/** Loads and renders one current-file export without allowing it to remove sibling exports. */
function PreviewInspectorFileComponentItem({ definition, targetProps }) {
  const loadState = usePreviewInspectorLazyDefinition(definition);
  const exportName = definition?.targetExportName ?? 'default';
  let content;
  if (loadState.definition !== definition || loadState.status === 'loading') {
    content = React.createElement(
      'div',
      { className: 'react-preview-suspense-placeholder', role: 'status' },
      'Loading ' + String(exportName) + '…',
    );
  } else if (loadState.status === 'failed') {
    content = React.createElement(PreviewInspectorFileComponentLoadFailure, {
      error: loadState.error,
    });
  } else {
    content = createPreviewInspectorElement(loadState.value, targetProps);
  }
  const suspenseFallback = React.createElement(
    'div',
    { className: 'react-preview-suspense-placeholder', role: 'status' },
    'Waiting for ' + String(exportName) + '…',
  );
  return React.createElement(
    React.Fragment,
    undefined,
    React.createElement(
      'div',
      { className: 'react-preview-export-label' },
      exportName,
    ),
    React.createElement(
      PreviewExportErrorBoundary,
      { exportName },
      React.createElement(React.Suspense, { fallback: suspenseFallback }, content),
    ),
  );
}

/** Displays every statically proven current-file component as a user-selected neutral overview. */
function PreviewInspectorFileComponentOverview({ candidate, definitions, descriptor, targetProps }) {
  const directDefinitions = definitions.filter((item) => item?.directTarget === true);
  if (directDefinitions.length === 0) {
    return React.createElement(
      'p',
      { className: 'react-preview-empty-gallery' },
      'No statically proven current-file component exports are available.',
    );
  }
  const selectedTargetName = descriptor?.inspector?.target?.exportName ?? descriptor?.exportName;
  const selectedTargetProps = createPreviewPropsFromLayers(
    undefined,
    candidate?.targetAutomaticProps ?? {},
    targetProps,
  );
  const gallery = React.createElement(
    'div',
    {
      className: 'react-preview-gallery',
      'data-react-preview-render-scenario': 'file-components',
    },
    directDefinitions.map((definition) => React.createElement(
      PreviewInspectorFileComponentItem,
      {
        definition,
        key: definition.id,
        targetProps: definition.targetExportName === selectedTargetName
          ? selectedTargetProps
          : {},
      },
    )),
  );
  return createPreviewCandidateRouterElement(gallery, { ownsRouter: false });
}

/** Loads only the chosen authored path, including any fallback UI that path legitimately renders. */
function PreviewInspectorAuthoredPageLoader({ candidate, definitions, descriptor, targetProps }) {
  usePreviewInspectorStore();
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
  const loadState = usePreviewInspectorLazyDefinition(definition);
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
  const pageCorridorElement = directTarget
    ? routedElement
    : React.createElement(
        PreviewInspectorPageRootCommitBoundary,
        {
          reachability,
          rootName: candidate?.root?.exportName ?? reachability.rootName,
        },
        routedElement,
      );
  return React.createElement(
    PreviewInspectorTargetReachabilityProbe,
    { candidate, descriptor, directTarget, directTargetAvailable: directDefinition !== undefined },
    pageCorridorElement,
  );
}

/** Chooses a rendering perspective explicitly; it never classifies application fallback pages. */
function PreviewInspectorPageCandidateLoader({ definitions, targetProps }) {
  usePreviewInspectorStore();
  const descriptor = findSelectedPreviewInspectorDescriptor();
  const candidate = readSelectedPreviewInspectorPageCandidate(descriptor);
  if (readPreviewInspectorRenderScenario() === 'file-components') {
    return React.createElement(PreviewInspectorFileComponentOverview, {
      candidate,
      definitions,
      descriptor,
      targetProps,
    });
  }
  return React.createElement(PreviewInspectorAuthoredPageLoader, {
    candidate,
    definitions,
    descriptor,
    targetProps,
  });
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
