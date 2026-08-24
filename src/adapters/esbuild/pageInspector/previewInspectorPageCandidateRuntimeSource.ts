/**
 * Generates the browser runtime that switches among statically proven authored page roots.
 * Candidate modules stay behind dynamic imports, so discovering several caller paths does not make
 * initial preview evaluation proportional to the number of possible pages.
 */
import { createPreviewInspectorNeuralPageContextRuntimeSource } from './previewInspectorNeuralPageContextRuntimeSource';
import { createPreviewInspectorPageContextExecutionContractRuntimeSource } from './previewInspectorPageContextExecutionContractRuntimeSource';
import { createPreviewInspectorPageContextPathSurfaceRuntimeSource } from './previewInspectorPageContextPathSurfaceRuntimeSource';
import { createPreviewInspectorPageCandidateSelectionRuntimeSource } from './previewInspectorPageCandidateSelectionRuntimeSource';

/**
 * Creates candidate selection, persistence, lazy loading, and root-prop composition helpers.
 *
 * Expected lexical bindings are `React`, `previewInspectorSession`, the shared state helpers, and
 * `createPreviewInspectorElement`; all are supplied by the composed Page Inspector entry runtime.
 *
 * @returns Plain JavaScript source concatenated into the browser-owned Inspector runtime.
 */
export function createPreviewInspectorPageCandidateRuntimeSource(): string {
  const neuralPageContextRuntimeSource = createPreviewInspectorNeuralPageContextRuntimeSource();
  const pageContextExecutionContractRuntimeSource =
    createPreviewInspectorPageContextExecutionContractRuntimeSource();
  const pageContextPathSurfaceRuntimeSource =
    createPreviewInspectorPageContextPathSurfaceRuntimeSource();
  const pageCandidateSelectionRuntimeSource =
    createPreviewInspectorPageCandidateSelectionRuntimeSource();
  return String.raw`
${neuralPageContextRuntimeSource}
${pageContextExecutionContractRuntimeSource}
${pageContextPathSurfaceRuntimeSource}
/** Returns selectable page roots, synthesizing the legacy single-root contract when necessary. */
function readPreviewInspectorPageCandidates(descriptor) {
  const inspector = descriptor?.inspector;
  if (inspector === undefined) return [];
  if (Array.isArray(inspector.pageCandidates) && inspector.pageCandidates.length > 0) {
    const selectedExportName = previewInspectorSession.selectedExportName;
    const exportCandidates = inspector.pageCandidates.filter((candidate) =>
      candidate?.target?.exportName === selectedExportName,
    );
    return exportCandidates.length > 0 ? exportCandidates : inspector.pageCandidates;
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

/** Returns lightweight route metadata independently from the one branch admitted to the bundle. */
function readPreviewInspectorRouteBranches(descriptor) {
  if (
    previewInspectorSession.pendingRouteBranchRevision !== undefined &&
    previewInspectorSession.pendingRouteBranchRevision !== previewEntryRevision
  ) {
    clearPreviewInspectorPendingRouteSelection();
  }
  if (previewInspectorSession.pendingRouteError?.revision !== previewEntryRevision) {
    previewInspectorSession.pendingRouteError = undefined;
  }
  const branches = descriptor?.inspector?.routeBranches;
  return Array.isArray(branches) ? branches : [];
}

const PREVIEW_INSPECTOR_ROUTE_ADMISSION_TIMEOUT_MS = 5 * 1000;
const PREVIEW_INSPECTOR_ROUTE_SETTLEMENT_TIMEOUT_MS = 150 * 1000;

/** Correlates host interactions with the displayed revision, including an initial entry numbered 0. */
function readPreviewInspectorHostRuntimeRevision() {
  return Number.isSafeInteger(previewEntryRevision) && previewEntryRevision > 0
    ? previewEntryRevision
    : previewRuntimeRevision;
}

/** Clears a settled route request and its bounded watchdog without affecting the visible preview. */
function clearPreviewInspectorPendingRouteSelection() {
  if (previewInspectorSession.pendingRouteTimeout !== undefined) {
    clearTimeout(previewInspectorSession.pendingRouteTimeout);
  }
  previewInspectorSession.pendingRouteBranchId = undefined;
  previewInspectorSession.pendingRouteBuildRevision = undefined;
  previewInspectorSession.pendingRouteInteractionId = undefined;
  previewInspectorSession.pendingRouteBranchRevision = undefined;
  previewInspectorSession.pendingRouteSelectionPath = undefined;
  previewInspectorSession.pendingRouteTimeout = undefined;
}

/** Arms one phase-specific route watchdog without extending a request the host never accepted. */
function schedulePreviewInspectorRouteSelectionTimeout(branchId, timeoutMs, message) {
  if (previewInspectorSession.pendingRouteTimeout !== undefined) {
    clearTimeout(previewInspectorSession.pendingRouteTimeout);
  }
  previewInspectorSession.pendingRouteTimeout = setTimeout(() => {
    if (previewInspectorSession.pendingRouteBranchId !== branchId) return;
    clearPreviewInspectorPendingRouteSelection();
    previewInspectorSession.pendingRouteError = {
      branchId,
      message,
      revision: previewEntryRevision,
    };
    notifyPreviewInspector();
  }, timeoutMs);
}

/** Makes a lost compiler hand-off recoverable instead of leaving a disabled route control forever. */
function beginPreviewInspectorPendingRouteSelection(branch) {
  clearPreviewInspectorPendingRouteSelection();
  previewInspectorSession.pendingRouteBranchId = branch.id;
  previewInspectorSession.pendingRouteInteractionId =
    'route:' + String(readPreviewInspectorHostRuntimeRevision()) + ':' +
    String(++previewInspectorSession.interactionSequence);
  previewInspectorSession.pendingRouteBranchRevision = previewEntryRevision;
  previewInspectorSession.pendingRouteSelectionPath = branch.selectionPath;
  previewInspectorSession.lastRequestedRouteSelectionPath = branch.selectionPath;
  previewInspectorSession.pendingRouteError = undefined;
  schedulePreviewInspectorRouteSelectionTimeout(
    branch.id,
    PREVIEW_INSPECTOR_ROUTE_ADMISSION_TIMEOUT_MS,
    'Route request was not accepted. Retry route.',
  );
}

/** Requests a fresh branch-scoped bundle after preserving the current preview until it is ready. */
function selectPreviewInspectorRouteBranch(branch) {
  if (
    typeof branch?.id !== 'string' ||
    branch?.selectable === false ||
    !Array.isArray(branch.selectionPath) ||
    typeof previewInspectorPostHostMessage !== 'function'
  ) {
    return;
  }
  if (branch.id === findSelectedPreviewInspectorDescriptor()?.inspector?.selectedRouteBranchId) {
    return;
  }
  beginPreviewInspectorPendingRouteSelection(branch);
  notifyPreviewInspector();
  previewInspectorPostHostMessage({
    branchId: branch.id,
    interactionId: previewInspectorSession.pendingRouteInteractionId,
    runtimeRevision: readPreviewInspectorHostRuntimeRevision(),
    selectionPath: branch.selectionPath,
    type: 'react-preview-inspector-route-selected',
  });
}

/** Resolves the persisted candidate id against the current descriptor after every hot rebuild. */
function readSelectedPreviewInspectorPageCandidate(descriptor) {
  const candidates = readPreviewInspectorPageCandidates(descriptor);
  const selected = candidates.find(
    (candidate) => candidate?.id === previewInspectorSession.selectedPageCandidateId,
  );
  if (
    selected === undefined && candidates.length > 0 &&
    typeof schedulePreviewInspectorNeuralPageContextSelection === 'function'
  ) schedulePreviewInspectorNeuralPageContextSelection();
  return selected ?? candidates[0];
}

/** Returns the candidate-local hook/HOC context before the legacy plan-wide fallback. */
function readSelectedPreviewInspectorModuleContext(descriptor) {
  return readSelectedPreviewInspectorPageCandidate(descriptor)?.contextModule ??
    descriptor?.inspector?.contextModule;
}

/** Returns the component promoted for this caller path before the legacy primary target. */
function readSelectedPreviewInspectorCandidateTarget(descriptor) {
  return readSelectedPreviewInspectorPageCandidate(descriptor)?.target ??
    descriptor?.inspector?.target;
}

/** Returns the compiler-owned inner execution slice selected for the current page artifact. */
function readSelectedPreviewInspectorPageExecutionCandidate(descriptor) {
  const executionCandidateId = descriptor?.inspector?.pageExecutionCandidateId;
  const executionCandidates = descriptor?.inspector?.pageExecutionCandidates;
  return Array.isArray(executionCandidates)
    ? executionCandidates.find((candidate) => candidate?.id === executionCandidateId)
    : undefined;
}

/** Reconciles browser state with the single caller path actually compiled into this artifact. */
function reconcilePreviewInspectorPageCandidateSelection(candidateIds) {
  const descriptor = findSelectedPreviewInspectorDescriptor();
  const neuralSelection =
    typeof reconcilePreviewInspectorNeuralPageContextSelection === 'function'
      ? reconcilePreviewInspectorNeuralPageContextSelection(descriptor)
      : undefined;
  const executableCandidateId = descriptor?.inspector?.executablePageCandidateId;
  if (typeof executableCandidateId === 'string' && candidateIds.includes(executableCandidateId)) {
    if (previewInspectorSession.selectedPageCandidateId === executableCandidateId) return false;
    previewInspectorSession.selectedPageCandidateId = executableCandidateId;
    return true;
  }
  const userSelection = previewInspectorSession.userSelectedPageCandidateId;
  const nextId = typeof userSelection === 'string' && candidateIds.includes(userSelection)
    ? userSelection
    : neuralSelection?.candidate?.id ?? candidateIds[0] ?? '';
  if (previewInspectorSession.selectedPageCandidateId === nextId) return false;
  previewInspectorSession.selectedPageCandidateId = nextId;
  return true;
}

/** Reports whether the selected authored application root supplies its own Router boundary. */
function doesSelectedPreviewInspectorPageCandidateOwnRouter() {
  if (typeof findSelectedPreviewInspectorDescriptor !== 'function') return false;
  const descriptor = findSelectedPreviewInspectorDescriptor();
  if (readSelectedPreviewInspectorPageCandidate(descriptor)?.rootOwnsRouter === true) return true;
  return readSelectedPreviewInspectorPageExecutionCandidate(descriptor)?.ownsGeneratedRouter === true;
}

/** Validates an inert compiler or runtime base path before it can affect Router state. */
function normalizePreviewInspectorRouteMountBasePath(value) {
  if (
    typeof value !== 'string' ||
    value.length === 0 ||
    value.length > 512 ||
    !value.startsWith('/') ||
    /[?#]/u.test(value)
  ) {
    return undefined;
  }
  return value.length > 1 ? value.replace(/\/+$/u, '') : value;
}

/** Reads an app-module base path only from a bounded own data property, never from a getter. */
function readPreviewInspectorPageRootBasePath(rootValue) {
  if ((typeof rootValue !== 'object' && typeof rootValue !== 'function') || rootValue === null) {
    return undefined;
  }
  try {
    const descriptor = Object.getOwnPropertyDescriptor(rootValue, 'basePath');
    const value = descriptor !== undefined && Object.prototype.hasOwnProperty.call(descriptor, 'value')
      ? descriptor.value
      : undefined;
    return normalizePreviewInspectorRouteMountBasePath(value);
  } catch {
    return undefined;
  }
}

/** Localizes one concrete pathname through static or constrained dynamic route-owner segments. */
function localizePreviewInspectorRouteMountPathname(basePattern, pathname) {
  if (typeof basePattern !== 'string' || typeof pathname !== 'string' || /[?#]/u.test(pathname)) {
    return undefined;
  }
  const baseSegments = basePattern.split('/').filter(Boolean);
  const pathnameSegments = pathname.split('/').filter(Boolean);
  if (pathnameSegments.length < baseSegments.length) return undefined;
  for (let index = 0; index < baseSegments.length; index += 1) {
    const pattern = baseSegments[index] ?? '';
    const concrete = pathnameSegments[index] ?? '';
    const parameter = /^:([$_\p{ID_Start}][$_\u200C\u200D\p{ID_Continue}]*)(?:\((.*)\))?\??$/u.exec(pattern);
    if (parameter === null) {
      if (pattern !== concrete) return undefined;
      continue;
    }
    if (/\\d|\[0-9\]|digit/iu.test(parameter[2] ?? '') && !/^\d+$/u.test(concrete)) {
      return undefined;
    }
    if (concrete.length === 0) return undefined;
  }
  const remainder = pathnameSegments.slice(baseSegments.length);
  return remainder.length === 0 ? '/' : '/' + remainder.join('/');
}

/**
 * Converts an application-absolute route to the path expected by a directly mounted app module.
 * A component carrying basePath=/company owns routes relative to that mount point, so feeding it
 * /company/1/credit would bind companyId to "company" and legitimately render its 404 branch.
 */
function createPreviewInspectorCandidateInitialEntry(candidate, rootValue, directTarget) {
  const pathname = candidate?.routeLocation?.pathname;
  if (
    directTarget === true ||
    typeof pathname !== 'string' ||
    pathname.length === 0 ||
    pathname.length > 2_048
  ) {
    return pathname;
  }
  const basePath =
    readPreviewInspectorPageRootBasePath(rootValue) ??
    normalizePreviewInspectorRouteMountBasePath(candidate?.routeMountBasePath);
  if (basePath === undefined || basePath === '/') return pathname;
  return localizePreviewInspectorRouteMountPathname(basePath, pathname) ?? pathname;
}

const previewInspectorNextPagesRouterStateSymbol = Symbol.for(
  'newdlops.react-file-preview.next-pages-router-state',
);

/** Publishes a validated Pages Router pattern before _app and the selected page are imported. */
function preparePreviewInspectorNextPagesRouterState(candidate, directTarget) {
  const routeLocation = candidate?.routeLocation;
  const pathname = routeLocation?.pathname;
  const pattern = routeLocation?.pattern;
  const eligible =
    directTarget !== true &&
    candidate?.nextPagesShell !== undefined &&
    routeLocation?.evidenceKind === 'next-pages-filesystem' &&
    typeof pathname === 'string' &&
    typeof pattern === 'string' &&
    pathname.length > 0 && pathname.length <= 2048 &&
    pattern.length > 0 && pattern.length <= 2048 &&
    pathname.startsWith('/') && pattern.startsWith('/') &&
    !pathname.startsWith('//') && !pattern.startsWith('//') &&
    !/[\\\u0000-\u001f\u007f]/u.test(pathname) &&
    !/[\\\u0000-\u001f\u007f]/u.test(pattern);
  try {
    globalThis[previewInspectorNextPagesRouterStateSymbol] = eligible
      ? Object.freeze({ pathname, pattern })
      : undefined;
  } catch {
    return false;
  }
  return eligible;
}

/**
 * Seeds an application-owned BrowserRouter or implicit Next Pages Router before module evaluation.
 * The route is static compiler evidence, not user HTML; nevertheless this boundary accepts only a
 * short same-origin pathname and never changes scheme, authority, state payload, query, or hash.
 */
function preparePreviewInspectorOwnedRouterLocation(candidate, directTarget) {
  const nextPagesRouterPrepared = preparePreviewInspectorNextPagesRouterState(
    candidate,
    directTarget,
  );
  const pathname = candidate?.routeLocation?.pathname;
  if (
    directTarget === true ||
    (candidate?.rootOwnsRouter !== true && !nextPagesRouterPrepared) ||
    typeof pathname !== 'string' ||
    pathname.length === 0 ||
    pathname.length > 2048 ||
    !pathname.startsWith('/') ||
    pathname.startsWith('//') ||
    /[\\\u0000-\u001f\u007f]/u.test(pathname) ||
    typeof globalThis.history?.replaceState !== 'function'
  ) {
    return false;
  }
  try {
    if (globalThis.location?.pathname === pathname) return true;
    globalThis.history.replaceState(globalThis.history.state, '', pathname);
    if (typeof recordPreviewInspectorRuntimeHealth === 'function') {
      recordPreviewInspectorRuntimeHealth({
        category: 'page-context',
        detail: { candidateId: candidate?.id, pathname },
        event: 'owned-router-location-seeded',
      });
    }
    return true;
  } catch (error) {
    if (typeof recordPreviewInspectorRuntimeHealth === 'function') {
      recordPreviewInspectorRuntimeHealth({
        category: 'page-context',
        detail: { candidateId: candidate?.id, error: String(error), pathname },
        event: 'owned-router-location-rejected',
      });
    }
    return false;
  }
}

/** Returns the explicit rendering perspective without inferring business meaning from page text. */
function readPreviewInspectorRenderScenario() {
  const descriptor = typeof findSelectedPreviewInspectorDescriptor === 'function'
    ? findSelectedPreviewInspectorDescriptor()
    : undefined;
  if (readSelectedPreviewInspectorModuleContext(descriptor) !== undefined) return 'authored-page';
  return previewInspectorSession.renderScenario === 'file-components'
    ? 'file-components'
    : 'authored-page';
}

/** Switches between the preserved authored page and an export overview chosen by the user. */
function setPreviewInspectorRenderScenario(nextScenario) {
  if (nextScenario !== 'authored-page' && nextScenario !== 'file-components') return;
  const descriptor = typeof findSelectedPreviewInspectorDescriptor === 'function'
    ? findSelectedPreviewInspectorDescriptor()
    : undefined;
  if (
    nextScenario === 'file-components' &&
    readSelectedPreviewInspectorModuleContext(descriptor) !== undefined
  ) {
    return;
  }
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
  const virtualPageMode = candidate?.virtualPage?.mode;
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
    for (const name of [...[...(step?.wrapperNames ?? [])].reverse(), step?.label]) {
      if (typeof name === 'string' && name.length > 0 && names.at(-1) !== name) names.push(name);
    }
  }
  if (rootStepIndex === undefined && !names.includes(rootName)) names.unshift(rootName);
  const visibleNames = names.slice(0, 5);
  const pathLabel = visibleNames.join(' › ') + (names.length > visibleNames.length ? ' › …' : '');
  const entryConnected = candidate?.renderPath?.entryPoint !== undefined;
  const routePath = typeof candidate?.routeLocation?.pathname === 'string'
    ? candidate.routeLocation.pathname
    : undefined;
  const routeComponentName = typeof candidate?.routeLocation?.componentName === 'string'
    ? candidate.routeLocation.componentName
    : undefined;
  const routeChoiceLabel = routeComponentName === undefined ||
    routeComponentName === rootName ||
    names.includes(routeComponentName)
    ? ''
    : ' · view ' + routeComponentName;
  const routeLabel = routePath === undefined
    ? ''
    : ' · ' + (routePath.length > 64 ? '…' + routePath.slice(-63) : routePath);
  const compositionLabel = typeof virtualPageMode === 'string' ? ' · VirtualPage' : '';
  return String(index + 1) + '. ' + pathLabel +
    (candidate?.complete === true && entryConnected
      ? ' · application root'
      : entryConnected ? ' · application path' : ' · partial context') +
    compositionLabel + routeChoiceLabel + routeLabel;
}

/**
 * Serializes the bounded static evidence behind one page choice for the Output-channel trace.
 *
 * Candidate labels alone conceal why a direct-file fallback beat an application root. Retaining
 * the stop reason, entry identity, root checkpoint, route, and authored step names makes that
 * ranking failure diagnosable without dumping the complete compiler descriptor into the webview
 * protocol or log.
 */
function createPreviewInspectorPageCandidateHealthSummary(candidate) {
  const renderPath = candidate?.renderPath;
  const steps = (renderPath?.steps ?? []).slice(0, 8);
  return {
    complete: candidate?.complete === true,
    entryConnected: renderPath?.entryPoint !== undefined,
    entrySourcePath: renderPath?.entryPoint?.sourcePath,
    id: candidate?.id,
    rootExport: candidate?.root?.exportName,
    rootSourcePath: candidate?.root?.sourcePath,
    rootStepIndex: Number.isInteger(candidate?.rootStepIndex)
      ? candidate.rootStepIndex
      : undefined,
    routeComponentName: candidate?.routeLocation?.componentName,
    routePathname: candidate?.routeLocation?.pathname,
    stopReason: candidate?.stopReason ?? 'unknown',
    steps: steps.map((step) => ({
      label: step?.label,
      sourcePath: step?.sourcePath,
      wrappers: (step?.wrapperNames ?? []).slice(0, 8),
    })),
    stepsOmitted: Math.max(0, (renderPath?.steps?.length ?? 0) - steps.length),
    virtualPage: candidate?.virtualPage,
  };
}

${pageCandidateSelectionRuntimeSource}

/** Applies host transaction outcomes without treating a new entry module as proof of success. */
function handlePreviewInspectorSelectionStatus(message) {
  if (message?.type === 'react-preview-progress') {
    handlePreviewInspectorPageCandidateProgress(message);
    if (
      previewInspectorSession.pendingRouteBranchId !== undefined &&
      Number.isSafeInteger(message.revision) &&
      previewInspectorSession.pendingRouteBuildRevision === undefined &&
      message.complete !== true
    ) {
      previewInspectorSession.pendingRouteBuildRevision = message.revision;
    }
    if (
      message.complete === true &&
      message.stage === 'ready' &&
      message.revision === previewInspectorSession.pendingRouteBuildRevision
    ) {
      clearPreviewInspectorPendingRouteSelection();
      previewInspectorSession.pendingRouteError = undefined;
      notifyPreviewInspector();
    }
    return;
  }
  if (message?.type === 'react-preview-inspector-route-selection-status') {
    if (message.interactionId !== previewInspectorSession.pendingRouteInteractionId) return;
    if (Number.isSafeInteger(message.buildRevision)) {
      previewInspectorSession.pendingRouteBuildRevision = message.buildRevision;
    }
    if (message.status === 'accepted' || message.status === 'progress') {
      schedulePreviewInspectorRouteSelectionTimeout(
        previewInspectorSession.pendingRouteBranchId,
        PREVIEW_INSPECTOR_ROUTE_SETTLEMENT_TIMEOUT_MS,
        'Route preparation did not finish. Retry route.',
      );
    }
    if (message.status === 'committed') {
      clearPreviewInspectorPendingRouteSelection();
      previewInspectorSession.pendingRouteError = undefined;
    } else if (
      message.status === 'failed' ||
      message.status === 'cancelled' ||
      message.status === 'rejected'
    ) {
      const branchId = previewInspectorSession.pendingRouteBranchId;
      clearPreviewInspectorPendingRouteSelection();
      previewInspectorSession.pendingRouteError = {
        branchId,
        message: 'Route preparation could not be applied. Retry route.',
        revision: previewEntryRevision,
      };
    }
    notifyPreviewInspector();
    return;
  }
  handlePreviewInspectorPageCandidateSelectionStatus(message);
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
    if (changed) {
      if (typeof releasePreviewInspectorDeferredRequirementContinuation === 'function') {
        releasePreviewInspectorDeferredRequirementContinuation(state);
      }
      schedulePreviewInspectorTreeRefresh();
    }
  }

  render() {
    return this.props.children;
  }
}

/** Loads one generated definition and ignores a stale promise after selection or hot reload. */
function usePreviewInspectorLazyDefinition(definition, loadContext) {
  const [loadState, setLoadState] = React.useState({ definition: undefined, status: 'loading' });
  const loadPreparationKey = loadContext === undefined
    ? ''
    : String(loadContext.candidate?.id ?? '') + '\0' +
      String(loadContext.candidate?.routeLocation?.pathname ?? '') + '\0' +
      String(loadContext.directTarget === true);
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
      .then(() => {
        preparePreviewInspectorOwnedRouterLocation(
          loadContext?.candidate,
          loadContext?.directTarget === true,
        );
        return definition.load();
      })
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
  }, [definition, loadPreparationKey]);
  return loadState;
}

/** Requests at most one host-owned inner Page Execution retry after a selected module load fails. */
function requestPreviewInspectorPageExecutionRetry(descriptor, candidate) {
  const inspector = descriptor?.inspector;
  const currentId = inspector?.pageExecutionCandidateId;
  const alternatives = Array.isArray(inspector?.pageExecutionCandidates)
    ? inspector.pageExecutionCandidates
    : [];
  const currentIndex = alternatives.findIndex((item) => item?.id === currentId);
  const next = currentIndex < 0 ? undefined : alternatives.slice(currentIndex + 1).find(
    (item) => typeof item?.id === 'string' && item.id !== currentId,
  );
  if (
    typeof candidate?.id !== 'string' ||
    typeof next?.id !== 'string' ||
    previewInspectorSession.pageExecutionRetryRevision === previewEntryRevision ||
    typeof previewInspectorPostHostMessage !== 'function'
  ) {
    return false;
  }
  previewInspectorSession.pageExecutionRetryRevision = previewEntryRevision;
  previewInspectorPostHostMessage({
    candidateId: candidate.id,
    executionCandidateId: next.id,
    interactionId: 'execution:' + String(readPreviewInspectorHostRuntimeRevision()) + ':' +
      String(++previewInspectorSession.interactionSequence),
    runtimeRevision: readPreviewInspectorHostRuntimeRevision(),
    type: 'react-preview-inspector-page-execution-retry',
  });
  return true;
}

/** Re-throws a rejected dynamic import inside the nearest per-export React error boundary. */
function PreviewInspectorFileComponentLoadFailure({ error }) {
  throw error;
}

/** Loads and renders one current-file export without allowing it to remove sibling exports. */
function PreviewInspectorFileComponentItem({ definition, targetProps }) {
  const loadState = usePreviewInspectorLazyDefinition(definition);
  const exportName = definition?.targetExportName ?? 'default';
  const conditionRevision = readPreviewInspectorRenderConditionRevision();
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
      { exportName, key: exportName, resetKey: String(conditionRevision) },
      React.createElement(React.Suspense, { fallback: suspenseFallback }, content),
    ),
  );
}

/** Displays every statically proven current-file component as a user-selected neutral overview. */
function PreviewInspectorFileComponentOverview({ candidate, definitions, descriptor, targetProps }) {
  activatePreviewInspectorRuntimeFallbackScope(candidate, true);
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
  const directTarget = readPreviewInspectorRuntimeFallbackDirectTarget(descriptor, candidate) &&
    directDefinition !== undefined;
  const definition = directTarget
    ? directDefinition
    : pageDefinition ?? definitions[0];
  activatePreviewInspectorRuntimeFallbackScope(candidate, directTarget);
  const loadState = usePreviewInspectorLazyDefinition(definition, { candidate, directTarget });
  const candidateInitialEntry = createPreviewInspectorCandidateInitialEntry(
    candidate,
    loadState.value,
    directTarget,
  );
  React.useEffect(() => {
    if (typeof recordPreviewInspectorRuntimeHealth !== 'function') return;
    const routeLocation = candidate?.routeLocation;
    const pageCandidates = readPreviewInspectorPageCandidates(descriptor);
    const candidateSummaries = pageCandidates
      .slice(0, 4)
      .map(createPreviewInspectorPageCandidateHealthSummary);
    recordPreviewInspectorRuntimeHealth({
      category: 'page-context',
      detail: {
        applicationPath: (reachability.applicationPath ?? []).slice(0, 32),
        candidateComplete: candidate?.complete === true,
        candidateCount: pageCandidates.length,
        candidateId: candidate?.id,
        candidateSummaries,
        candidatesOmitted: Math.max(0, pageCandidates.length - candidateSummaries.length),
        directTarget,
        ...(typeof routeLocation?.sourcePath === 'string'
          ? { evidence: { sourcePath: routeLocation.sourcePath } }
          : {}),
        evidenceKind: routeLocation?.evidenceKind ?? 'none',
        nextAppContextApplied:
          directTarget !== true && routeLocation?.evidenceKind === 'next-app-filesystem',
        nextAppLayoutPaths: (candidate?.nextAppLayoutChain ?? [])
          .slice(0, 16)
          .map((layout) => layout?.sourcePath)
          .filter((sourcePath) => typeof sourcePath === 'string'),
        nextPagesAppPath: candidate?.nextPagesShell?.app?.sourcePath,
        pathname: routeLocation?.pathname ?? '/',
        routeBasePathSource:
          readPreviewInspectorPageRootBasePath(loadState.value) !== undefined
            ? 'runtime-static'
            : normalizePreviewInspectorRouteMountBasePath(candidate?.routeMountBasePath) !== undefined
              ? 'compiler-evidence'
              : 'none',
        routeMountBasePath: normalizePreviewInspectorRouteMountBasePath(candidate?.routeMountBasePath),
        routePathnameBeforeLocalization: routeLocation?.pathname ?? '/',
        routeSlotCount: Number.isSafeInteger(candidate?.routeSlotCount) ? candidate.routeSlotCount : 0,
        wildcardFallbackPresent: candidate?.wildcardFallbackPresent === true,
        requestedRouterPathname: candidateInitialEntry ?? '/',
        routePattern: routeLocation?.pattern,
        routerPathname: candidateInitialEntry ?? '/',
        rootExport: candidate?.root?.exportName,
        rootSourcePath: candidate?.root?.sourcePath,
        rootStepIndex: candidate?.rootStepIndex,
        rootOwnsRouter: candidate?.rootOwnsRouter === true,
        routeInferred: typeof routeLocation?.pathname === 'string',
        stopReason: candidate?.stopReason ?? 'unknown',
        targetExport: reachability.targetExportName,
        virtualPage: candidate?.virtualPage,
      },
      event: 'page-context-selected',
    });
  }, [candidate?.id, candidateInitialEntry, definition?.id, directTarget]);
  if (loadState.definition !== definition || loadState.status === 'loading') {
    return React.createElement(
      'div',
      { className: 'react-preview-suspense-placeholder', role: 'status' },
      directTarget ? 'Loading selected component fallback…' : 'Loading authored page context…',
    );
  }
  if (loadState.status === 'failed') {
    requestPreviewInspectorPageExecutionRetry(descriptor, candidate);
    throw loadState.error;
  }
  const rootElement = createPreviewInspectorElement(
    loadState.value,
    directTarget ? (candidate?.targetAutomaticProps ?? {}) : targetProps,
  );
  const routedElement = createPreviewCandidateRouterElement(rootElement, {
    initialEntry: candidateInitialEntry,
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
