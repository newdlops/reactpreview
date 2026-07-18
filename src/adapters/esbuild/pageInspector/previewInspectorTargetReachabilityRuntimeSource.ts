/**
 * Generates target-guided application-path traversal for React Page Inspector.
 *
 * A page can render a perfectly valid login, permission, loading, or empty branch while never
 * invoking the component selected in the editor. Error boundaries cannot classify that as failure.
 * This runtime therefore treats the wrapped target export as a reachability assertion, advances one
 * statically instrumented gate per committed pass, and finally mounts the selected export directly
 * when the authored application path has no further safe evidence to traverse.
 */

/**
 * Creates browser source for bounded DFS gate traversal and direct-target fallback selection.
 *
 * Expected lexical bindings include React, the shared Inspector session/store, condition, data, and
 * runtime-fallback registries, plus notification and console helpers from the composed entry.
 *
 * @returns Plain JavaScript source concatenated into the Page Inspector browser runtime.
 */
export function createPreviewInspectorTargetReachabilityRuntimeSource(): string {
  return String.raw`
const PREVIEW_INSPECTOR_TARGET_REACHABILITY_PASS_LIMIT = 16;
const PREVIEW_INSPECTOR_TARGET_REACHABILITY_IDLE_LIMIT = 2;

/** Lazily initializes ephemeral traversal state retained only by the pinned preview webview. */
function initializePreviewInspectorTargetReachabilityState() {
  if (!(previewInspectorSession.targetReachabilityByKey instanceof Map)) {
    previewInspectorSession.targetReachabilityByKey = new Map();
  }
}

/** Returns current-file exports that can be asserted through the generated target facade. */
function readPreviewInspectorReachableTargetExports(descriptor) {
  const inspector = descriptor?.inspector;
  return [...new Set([
    inspector?.target?.exportName,
    ...Object.keys(inspector?.renderChainsByExport ?? {}),
  ].filter((name) => typeof name === 'string' && name.length > 0))];
}

/** Resolves the selected current-file export without mistaking an editable ancestor root for it. */
function readPreviewInspectorExpectedTargetExport(descriptor) {
  const exports = readPreviewInspectorReachableTargetExports(descriptor);
  return exports.includes(previewInspectorSession.selectedExportName)
    ? previewInspectorSession.selectedExportName
    : exports[0] ?? descriptor?.exportName ?? 'default';
}

/** Creates one stable traversal identity per page candidate and selected current-file export. */
function createPreviewInspectorTargetReachabilityKey(descriptor, candidate) {
  return String(candidate?.id ?? 'nearest-authored-owner') + ':' +
    readPreviewInspectorExpectedTargetExport(descriptor);
}

/** Reads target-to-entry metadata for the selected export, falling back to candidate-local evidence. */
function readPreviewInspectorTargetRenderPath(descriptor, candidate, targetExportName) {
  const targetPlan = descriptor?.inspector?.renderChainsByExport?.[targetExportName];
  const candidatePath = candidate?.renderPath;
  if (
    candidatePath !== undefined &&
    (targetPlan?.paths ?? []).some((path) => path?.id === candidatePath.id)
  ) {
    return candidatePath;
  }
  return targetPlan?.paths?.[0] ?? candidatePath;
}

/** Builds one mutable but bounded state record from immutable application-path evidence. */
function createPreviewInspectorTargetReachabilityState(descriptor, candidate) {
  const targetExportName = readPreviewInspectorExpectedTargetExport(descriptor);
  const renderPath = readPreviewInspectorTargetRenderPath(descriptor, candidate, targetExportName);
  const applicationPath = [...(renderPath?.steps ?? [])]
    .reverse()
    .flatMap((step) => [step?.label, ...[...(step?.wrapperNames ?? [])].reverse()])
    .filter((name, index, names) =>
      typeof name === 'string' && name.length > 0 && names.indexOf(name) === index,
    );
  if (!applicationPath.includes(targetExportName)) applicationPath.push(targetExportName);
  return {
    applicationPath,
    appliedConditions: [],
    attempt: 0,
    candidateId: candidate?.id ?? 'nearest-authored-owner',
    directTarget: false,
    directTargetAvailable: false,
    idlePasses: 0,
    key: createPreviewInspectorTargetReachabilityKey(descriptor, candidate),
    probeRevision: 0,
    rootName: candidate?.root?.exportName ?? descriptor?.inspector?.root?.exportName ?? 'Application',
    status: 'probing',
    targetExportName,
    targetMounted: false,
  };
}

/** Returns the retained traversal state, creating it before the candidate's first render. */
function readPreviewInspectorTargetReachabilityState(descriptor, candidate) {
  initializePreviewInspectorTargetReachabilityState();
  const key = createPreviewInspectorTargetReachabilityKey(descriptor, candidate);
  let state = previewInspectorSession.targetReachabilityByKey.get(key);
  if (state === undefined) {
    state = createPreviewInspectorTargetReachabilityState(descriptor, candidate);
    previewInspectorSession.targetReachabilityByKey.set(key, state);
  }
  return state;
}

/** Normalizes browser/source path spellings for conservative application-path matching. */
function normalizePreviewInspectorReachabilityPath(value) {
  return typeof value === 'string' ? value.replaceAll('\\', '/') : '';
}

/** Collects source and component identities proven to lie between the root and selected target. */
function readPreviewInspectorTargetPathEvidence(descriptor, candidate, state) {
  const renderPath = readPreviewInspectorTargetRenderPath(
    descriptor,
    candidate,
    state.targetExportName,
  );
  const paths = new Set();
  const names = new Set([state.rootName, state.targetExportName, ...state.applicationPath]);
  const nameScores = new Map();
  state.applicationPath.forEach((name, index) => nameScores.set(name, index + 1));
  nameScores.set(state.targetExportName, 1_000);
  for (const step of renderPath?.steps ?? []) {
    paths.add(normalizePreviewInspectorReachabilityPath(step?.sourcePath));
    if (typeof step?.label === 'string') {
      names.add(step.label);
      if (!nameScores.has(step.label)) nameScores.set(step.label, 1);
    }
    for (const wrapperName of step?.wrapperNames ?? []) {
      names.add(wrapperName);
      if (!nameScores.has(wrapperName)) nameScores.set(wrapperName, 1);
    }
  }
  for (const edge of candidate?.edges ?? []) {
    paths.add(normalizePreviewInspectorReachabilityPath(edge?.child?.sourcePath));
    paths.add(normalizePreviewInspectorReachabilityPath(edge?.owner?.sourcePath));
    if (typeof edge?.child?.exportName === 'string') names.add(edge.child.exportName);
    if (typeof edge?.owner?.exportName === 'string') names.add(edge.owner.exportName);
    for (const ownerName of edge?.localOwnerNames ?? []) names.add(ownerName);
  }
  paths.delete('');
  names.delete(undefined);
  return { nameScores, names, paths };
}

/** Requires a gate to belong to a statically proven path source or named path component. */
function isPreviewInspectorConditionOnTargetPath(condition, evidence) {
  const ownerName = typeof condition?.ownerName === 'string' ? condition.ownerName : '';
  if (ownerName.length > 0 && evidence.names.has(ownerName)) return true;
  const sourcePath = normalizePreviewInspectorReachabilityPath(condition?.sourcePath);
  if (sourcePath.length === 0) return false;
  for (const path of evidence.paths) {
    if (path === sourcePath || path.endsWith('/' + sourcePath) || sourcePath.endsWith('/' + path)) {
      return true;
    }
  }
  return false;
}

/** Selects the branch that continues toward the target using compiler-issued gate evidence only. */
function readPreviewInspectorTargetConditionValue(condition, evidence) {
  const scoreLabel = (label) => {
    const normalized = String(label ?? '').replace(/[<>]/gu, '');
    const tokens = normalized.split(/[^A-Za-z0-9_$]+/u).filter(Boolean);
    let score = 0;
    for (const [name, nameScore] of evidence.nameScores) {
      if (normalized === String(name) || tokens.includes(String(name))) {
        score = Math.max(score, nameScore);
      }
    }
    return score;
  };
  const truthyScore = scoreLabel(condition?.truthyLabel);
  const falsyScore = scoreLabel(condition?.falsyLabel);
  if (truthyScore !== falsyScore && Math.max(truthyScore, falsyScore) > 0) {
    return truthyScore > falsyScore;
  }
  if (condition?.targetBranch === 'truthy') return true;
  if (condition?.targetBranch === 'falsy') return false;
  if (condition?.fallbackBranch === 'truthy') return false;
  if (condition?.fallbackBranch === 'falsy') return true;
  return undefined;
}

/** Chooses only the first newly revealed, path-local gate so each pass behaves like bounded DFS. */
function selectPreviewInspectorNextTargetGate(descriptor, candidate, state) {
  initializePreviewInspectorConditionState();
  const evidence = readPreviewInspectorTargetPathEvidence(descriptor, candidate, state);
  return [...previewInspectorSession.renderConditions.values()]
    .filter((condition) =>
      condition?.reachabilityKey === state.key &&
      !previewInspectorSession.renderConditionOverrides.has(condition.id) &&
      isPreviewInspectorConditionOnTargetPath(condition, evidence),
    )
    .map((condition) => ({
      condition,
      desiredValue: readPreviewInspectorTargetConditionValue(condition, evidence),
    }))
    .filter(({ condition, desiredValue }) =>
      typeof desiredValue === 'boolean' && condition.effectiveEnabled !== desiredValue,
    )
    .sort((left, right) =>
      (left.condition.reachabilityDiscoveryOrder ?? Number.MAX_SAFE_INTEGER) -
        (right.condition.reachabilityDiscoveryOrder ?? Number.MAX_SAFE_INTEGER) ||
      (left.condition.line ?? 0) - (right.condition.line ?? 0),
    )[0];
}

/** Reports whether the exact selected target facade committed at least one live boundary. */
function hasMountedPreviewInspectorTarget(state) {
  const boundaries = previewInspectorSession.boundariesByExport.get(state.targetExportName);
  return boundaries instanceof Set && boundaries.size > 0;
}

/** Emits one visible warning when target context is replaced by direct-target fallback. */
function reportPreviewInspectorTargetReachabilityFallback(state) {
  if (state.warningReported === true) return;
  state.warningReported = true;
  const message = 'Application path rendered, but did not reach ' + state.targetExportName + '.';
  const details = [
    message,
    'Path: ' + state.applicationPath.join(' > '),
    state.appliedConditions.length > 0
      ? 'Auto-passed gates: ' + state.appliedConditions.map((gate) => gate.expression).join(', ')
      : 'No additional statically proven gate was available.',
    'React Preview is rendering the selected file directly while preserving generated providers and payloads.',
  ].join('\n');
  recordPreviewInspectorConsoleEntry({
    details,
    level: 'warn',
    location: '',
    message,
    phase: 'target-guided application path',
    source: 'target-reachability',
  });
  readPreviewInspectorConsolePrimitives().warn('[React Preview] ' + details);
}

/** Switches the candidate loader to the facade export after static DFS can make no more progress. */
function activatePreviewInspectorDirectTarget(state) {
  if (state.directTargetAvailable !== true) {
    state.exhausted = true;
    state.status = 'blocked';
    state.probeRevision += 1;
    notifyPreviewInspector();
    schedulePreviewInspectorTreeRefresh();
    return;
  }
  state.directTarget = true;
  state.status = 'direct';
  state.probeRevision += 1;
  reportPreviewInspectorTargetReachabilityFallback(state);
  notifyPreviewInspector();
  schedulePreviewInspectorTreeRefresh();
}

/** Evaluates one settled commit and advances at most one path gate. */
function evaluatePreviewInspectorTargetReachability(descriptor, candidate, state) {
  if (hasMountedPreviewInspectorTarget(state)) {
    state.targetMounted = true;
    state.status = state.directTarget ? 'direct' : 'reached';
    state.idlePasses = 0;
    schedulePreviewInspectorTreeRefresh();
    return;
  }
  state.targetMounted = false;
  if (state.directTarget || state.exhausted === true) return;
  const nextGate = selectPreviewInspectorNextTargetGate(descriptor, candidate, state);
  if (nextGate !== undefined && state.attempt < PREVIEW_INSPECTOR_TARGET_REACHABILITY_PASS_LIMIT) {
    state.appliedConditions.push({
      enabled: nextGate.desiredValue,
      expression: nextGate.condition.expression,
      id: nextGate.condition.id,
      line: nextGate.condition.line,
      ownerName: nextGate.condition.ownerName,
      sourcePath: nextGate.condition.sourcePath,
    });
    state.attempt += 1;
    state.idlePasses = 0;
    state.status = 'advancing';
    state.probeRevision += 1;
    setPreviewInspectorTargetGuidedConditionOverride(
      nextGate.condition.id,
      nextGate.desiredValue,
    );
    return;
  }
  state.idlePasses += 1;
  state.status = 'blocked';
  state.probeRevision += 1;
  if (
    state.attempt >= PREVIEW_INSPECTOR_TARGET_REACHABILITY_PASS_LIMIT ||
    state.idlePasses >= PREVIEW_INSPECTOR_TARGET_REACHABILITY_IDLE_LIMIT
  ) {
    activatePreviewInspectorDirectTarget(state);
    return;
  }
  notifyPreviewInspector();
}

/**
 * Marks the candidate subtree as one traversal pass and checks target presence after its commit.
 * Leaving the active key set for this mounted subtree lets downstream conditions and hook/data
 * consumers discovered by later state updates join the same progressive payload plan.
 */
function PreviewInspectorTargetReachabilityProbe({
  candidate,
  children,
  descriptor,
  directTarget,
  directTargetAvailable,
}) {
  usePreviewInspectorStore();
  const state = readPreviewInspectorTargetReachabilityState(descriptor, candidate);
  state.directTargetAvailable = directTargetAvailable === true;
  previewInspectorSession.activeTargetReachabilityKey = state.key;
  const probeRevision = state.probeRevision;
  React.useEffect(() => {
    const timer = globalThis.setTimeout(
      () => evaluatePreviewInspectorTargetReachability(descriptor, candidate, state),
      directTarget === true ? 60 : 260,
    );
    return () => globalThis.clearTimeout(timer);
  }, [state, descriptor, candidate, probeRevision, directTarget, directTargetAvailable]);
  return children;
}

/** Collects paths exposed by the hook and request registries reached during progressive traversal. */
function readPreviewInspectorTargetReachabilityRequiredPaths(state) {
  const paths = [];
  const append = (value) => {
    if (typeof value === 'string' && value.length > 0 && !paths.includes(value) && paths.length < 96) {
      paths.push(value);
    }
  };
  for (const fallback of readPreviewInspectorRuntimeFallbacks()) {
    if (fallback.reachabilityKey !== state.key) continue;
    for (const path of fallback.requiredPaths ?? []) append(fallback.hookName + '.' + path);
  }
  for (const request of readPreviewInspectorDataRequests()) {
    if (request.reachabilityKey !== state.key) continue;
    for (const path of readPreviewInspectorDataShapePaths(request.shape)) {
      append(request.label + '.' + path);
    }
  }
  for (const gate of state.appliedConditions) append('gate.' + gate.expression);
  return paths;
}

/** Returns logical blockers even when the page committed without throwing an exception. */
function readPreviewInspectorTargetReachabilityBlockers() {
  initializePreviewInspectorTargetReachabilityState();
  return [...previewInspectorSession.targetReachabilityByKey.values()]
    .filter((state) => state.status !== 'reached')
    .map((state) => ({
      ...state,
      id: 'target-reachability:' + state.key,
      ownerName: state.appliedConditions.at(-1)?.ownerName ?? state.rootName,
      requiredPaths: readPreviewInspectorTargetReachabilityRequiredPaths(state),
      sourcePath: state.appliedConditions.at(-1)?.sourcePath,
    }));
}

/** Restarts selected application-path traversal and discards only its automatic branch choices. */
function retryPreviewInspectorTargetApplicationPath() {
  const descriptor = findSelectedPreviewInspectorDescriptor();
  const candidate = readSelectedPreviewInspectorPageCandidate(descriptor);
  if (descriptor === undefined || candidate === undefined) return;
  const key = createPreviewInspectorTargetReachabilityKey(descriptor, candidate);
  clearPreviewInspectorTargetGuidedConditionOverrides(key);
  previewInspectorSession.targetReachabilityByKey?.delete(key);
  previewInspectorSession.renderConditionRevision =
    (previewInspectorSession.renderConditionRevision ?? 0) + 1;
  notifyPreviewInspector();
  schedulePreviewInspectorCommitRefresh();
}

/** Lets the user choose immediate target rendering while keeping automatic providers and payloads. */
function showPreviewInspectorTargetDirectly() {
  const descriptor = findSelectedPreviewInspectorDescriptor();
  const candidate = readSelectedPreviewInspectorPageCandidate(descriptor);
  if (descriptor === undefined || candidate === undefined) return;
  activatePreviewInspectorDirectTarget(
    readPreviewInspectorTargetReachabilityState(descriptor, candidate),
  );
}

/** Clears obsolete traversal state after a candidate, export, or hot descriptor replacement. */
function resetPreviewInspectorTargetReachability() {
  initializePreviewInspectorTargetReachabilityState();
  const conditionChanged = clearPreviewInspectorTargetGuidedConditionOverrides();
  const stateChanged = previewInspectorSession.targetReachabilityByKey.size > 0;
  previewInspectorSession.targetReachabilityByKey.clear();
  previewInspectorSession.activeTargetReachabilityKey = undefined;
  return conditionChanged || stateChanged;
}
`;
}
