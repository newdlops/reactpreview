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

/** Produces a concise candidate label without exposing absolute local filesystem paths. */
function formatPreviewInspectorPageCandidate(candidate, index) {
  const rootName = candidate?.root?.exportName ?? 'default';
  const names = [];
  for (const step of [...(candidate?.renderPath?.steps ?? [])].reverse()) {
    for (const name of [step?.label, ...[...(step?.wrapperNames ?? [])].reverse()]) {
      if (typeof name === 'string' && name.length > 0 && names.at(-1) !== name) names.push(name);
    }
  }
  if (!names.includes(rootName)) names.unshift(rootName);
  const visibleNames = names.slice(0, 5);
  const pathLabel = visibleNames.join(' › ') + (names.length > visibleNames.length ? ' › …' : '');
  const entryConnected = candidate?.renderPath?.entryPoint !== undefined;
  return String(index + 1) + '. ' + pathLabel +
    (entryConnected ? ' · application page' : ' · partial context');
}

/** Selects one authored caller path and asks the root, tree, and highlight layers to reconcile. */
function selectPreviewInspectorPageCandidate(candidateId) {
  if (typeof candidateId !== 'string' || candidateId.length === 0) return;
  const descriptor = findSelectedPreviewInspectorDescriptor();
  if (!readPreviewInspectorPageCandidates(descriptor).some((candidate) => candidate?.id === candidateId)) {
    return;
  }
  if (previewInspectorSession.selectedPageCandidateId === candidateId) return;
  previewInspectorSession.selectedPageCandidateId = candidateId;
  previewInspectorSession.selectedTreeNodeId = undefined;
  persistPreviewInspectorState();
  notifyPreviewInspector();
  schedulePreviewInspectorHighlight();
}

/** Loads only the selected candidate module and discards late results after a selection change. */
function PreviewInspectorPageCandidateLoader({ definitions, targetProps }) {
  usePreviewInspectorStore();
  const descriptor = findSelectedPreviewInspectorDescriptor();
  const candidate = readSelectedPreviewInspectorPageCandidate(descriptor);
  const definition = definitions.find((item) => item?.id === candidate?.id) ?? definitions[0];
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
      'Loading authored page context…',
    );
  }
  if (loadState.status === 'failed') throw loadState.error;
  return createPreviewInspectorElement(loadState.value, targetProps);
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
