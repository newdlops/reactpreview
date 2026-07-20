/**
 * Generates target-guided application-path traversal for React Page Inspector.
 *
 * A page can render a perfectly valid login, permission, loading, or empty branch while never
 * invoking the component selected in the editor. Error boundaries cannot classify that as failure.
 * This runtime therefore treats the wrapped target export as a reachability assertion and advances
 * one statically instrumented gate per committed pass. A preview is successful only when both the
 * authored page root and the selected target commit in the same render corridor. Direct target
 * rendering remains an explicit diagnostic mode and never masquerades as page success.
 */

/**
 * Creates browser source for bounded DFS page traversal and explicit target-only diagnostics.
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
const PREVIEW_INSPECTOR_MINIMUM_REQUIREMENT_PASS_LIMIT = 8;
const PREVIEW_INSPECTOR_TARGET_INITIAL_PROBE_DELAY_MS = 160;
const PREVIEW_INSPECTOR_TARGET_CONTINUATION_PROBE_DELAY_MS = 48;
const PREVIEW_INSPECTOR_TARGET_DIRECT_PROBE_DELAY_MS = 32;

/** Lazily initializes ephemeral traversal state retained only by the pinned preview webview. */
function initializePreviewInspectorTargetReachabilityState() {
  if (!(previewInspectorSession.targetReachabilityByKey instanceof Map)) {
    previewInspectorSession.targetReachabilityByKey = new Map();
  }
  if (!(previewInspectorSession.minimumRequirementSearchByKey instanceof Map)) {
    previewInspectorSession.minimumRequirementSearchByKey = new Map();
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
    exhausted: false,
    idlePasses: 0,
    key: createPreviewInspectorTargetReachabilityKey(descriptor, candidate),
    pageRootCommitted: false,
    probeRevision: 0,
    rootName: candidate?.root?.exportName ?? descriptor?.inspector?.root?.exportName ?? 'Application',
    runtimeOwnerNames: [],
    status: 'probing',
    targetExportName,
    targetHasOutput: false,
    targetMounted: false,
    targetWasMounted: false,
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
  const names = new Set([
    state.rootName,
    state.targetExportName,
    ...state.applicationPath,
    ...(state.runtimeOwnerNames ?? []),
  ]);
  const nameScores = new Map();
  state.applicationPath.forEach((name, index) => nameScores.set(name, index + 1));
  nameScores.set(state.targetExportName, 1_000);
  for (const runtimeOwnerName of state.runtimeOwnerNames ?? []) {
    nameScores.set(runtimeOwnerName, 900);
  }
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

/** Scores component names embedded in one branch label against the proven root-to-target corridor. */
function scorePreviewInspectorTargetConditionLabel(label, evidence) {
  const normalized = String(label ?? '').replace(/[<>]/gu, '');
  const tokens = normalized.split(/[^A-Za-z0-9_$]+/u).filter(Boolean);
  let score = 0;
  for (const [name, nameScore] of evidence.nameScores) {
    if (normalized === String(name) || tokens.includes(String(name))) {
      score = Math.max(score, nameScore);
    }
  }
  return score;
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
  /* A target-named overlay may be declared in a factory/helper file absent from import edges. */
  return condition?.role === 'overlay' && Math.max(
    scorePreviewInspectorTargetConditionLabel(condition?.truthyLabel, evidence),
    scorePreviewInspectorTargetConditionLabel(condition?.falsyLabel, evidence),
  ) > 0;
}

/** Selects the branch that continues toward the target using compiler-issued gate evidence only. */
function readPreviewInspectorTargetConditionValue(condition, evidence) {
  const truthyScore = scorePreviewInspectorTargetConditionLabel(
    condition?.truthyLabel,
    evidence,
  );
  const falsyScore = scorePreviewInspectorTargetConditionLabel(
    condition?.falsyLabel,
    evidence,
  );
  if (truthyScore !== falsyScore && Math.max(truthyScore, falsyScore) > 0) {
    return truthyScore > falsyScore;
  }
  /* Visibility metadata defines truthy as visible even though both labels repeat the Modal name. */
  if (
    condition?.kind === 'overlay-visibility' &&
    condition?.role === 'overlay' &&
    Math.max(truthyScore, falsyScore) > 0
  ) {
    return true;
  }
  if (condition?.targetBranch === 'truthy') return true;
  if (condition?.targetBranch === 'falsy') return false;
  if (condition?.fallbackBranch === 'truthy') return false;
  if (condition?.fallbackBranch === 'falsy') return true;
  return undefined;
}

/**
 * Chooses only the first newly revealed continuation gate so each pass behaves like bounded DFS.
 * Exact caller-path evidence wins. A condition outside that path is considered only after the exact
 * target facade's runtime function name is admitted as exact evidence for an off-graph HOC that
 * returns Navigate/null. Page siblings such as topbars and formatting helpers never become eligible
 * merely because the target mounted; doing so can destroy the layout before the route outlet commits.
 */
function selectPreviewInspectorNextTargetGate(descriptor, candidate, state) {
  initializePreviewInspectorConditionState();
  const evidence = readPreviewInspectorTargetPathEvidence(descriptor, candidate, state);
  return [...previewInspectorSession.renderConditions.values()]
    .filter((condition) =>
      condition?.reachabilityKey === state.key &&
      !previewInspectorSession.renderConditionOverrides.has(condition.id),
    )
    .map((condition) => ({
      condition,
      desiredValue: readPreviewInspectorTargetConditionValue(condition, evidence),
      pathLocal: isPreviewInspectorConditionOnTargetPath(condition, evidence),
    }))
    .filter(({ condition, desiredValue, pathLocal }) =>
      typeof desiredValue === 'boolean' &&
      condition.effectiveEnabled !== desiredValue &&
      pathLocal,
    )
    .sort((left, right) =>
      Number(right.pathLocal) - Number(left.pathLocal) ||
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

/**
 * Adds the actual selected export function name to static root-to-target path evidence.
 * HOC factories often disappear from import/route graphs, while their returned named function owns
 * the decisive redirect or permission gate. Only names from the exact facade component are retained;
 * arbitrary mounted siblings are never promoted to target-path evidence.
 */
function rememberPreviewInspectorTargetRuntimeOwnerNames(exportName, candidateNames) {
  initializePreviewInspectorTargetReachabilityState();
  if (!(previewInspectorSession.directTargetRuntimeOwnerNamesByExport instanceof Map)) {
    previewInspectorSession.directTargetRuntimeOwnerNamesByExport = new Map();
  }
  const names = candidateNames
    .filter((name) => typeof name === 'string' && name.length > 0 && name.length <= 160);
  let retainedNames = previewInspectorSession.directTargetRuntimeOwnerNamesByExport.get(exportName);
  if (!(retainedNames instanceof Set)) {
    retainedNames = new Set();
    previewInspectorSession.directTargetRuntimeOwnerNamesByExport.set(exportName, retainedNames);
  }
  let changed = false;
  for (const name of names) {
    if (retainedNames.has(name)) continue;
    retainedNames.add(name);
    changed = true;
  }
  const key = previewInspectorSession.activeTargetReachabilityKey;
  if (typeof key !== 'string') return changed;
  const state = previewInspectorSession.targetReachabilityByKey.get(key);
  if (state === undefined || state.targetExportName !== exportName) return changed;
  for (const name of names) {
    if (!state.runtimeOwnerNames.includes(name)) state.runtimeOwnerNames.push(name);
  }
  return changed;
}

/** Adds the exported facade's public runtime name before its selected boundary commits. */
function rememberPreviewInspectorTargetRuntimeOwner(exportName, Component) {
  return rememberPreviewInspectorTargetRuntimeOwnerNames(
    exportName,
    [Component?.displayName, Component?.name],
  );
}

/**
 * Reads only the single-child component chain inside the exact selected-target boundary.
 *
 * A composed HOC can have runtime owners PageComponent -> GuardedPage -> Navigate while static
 * import evidence contains only PageComponent. The chain stops at the first host node or branch,
 * never visits a sibling, and therefore cannot promote header/sidebar/formatter conditions merely
 * because they share the surrounding application page.
 */
function collectPreviewInspectorTargetMountedOwnerNames(boundary) {
  const boundaryFiber = readPreviewInspectorBoundaryFiber(boundary);
  let fiber = readPreviewInspectorFiberLink(boundaryFiber, 'child');
  const visited = new Set();
  const names = [];
  for (let depth = 0; fiber !== undefined && depth < 24 && !visited.has(fiber); depth += 1) {
    visited.add(fiber);
    const kind = classifyPreviewInspectorFiber(fiber);
    if (kind === 'host' || kind === 'text' || kind === 'portal') break;
    const name = namePreviewInspectorFiber(fiber, kind);
    if (
      ['class', 'forward-ref', 'function', 'lazy', 'memo'].includes(kind) &&
      !isPreviewInspectorOwnedFiber(fiber, name, kind) &&
      typeof name === 'string' &&
      name.length > 0 &&
      name.length <= 160 &&
      !names.includes(name)
    ) {
      names.push(name);
    }
    /* Multiple children are authored render output, not an unambiguous wrapper continuation. */
    if (readPreviewInspectorFiberLink(fiber, 'sibling') !== undefined) break;
    fiber = readPreviewInspectorFiberLink(fiber, 'child');
  }
  return names;
}

/**
 * Admits exact nested HOC owners to DFS and retries one cold direct render when new evidence appears.
 * A Set makes the retry self-settling: the second commit discovers no new owner and cannot loop.
 */
function rememberPreviewInspectorTargetMountedOwnerChain(exportName, boundary) {
  const names = collectPreviewInspectorTargetMountedOwnerNames(boundary);
  const changed = rememberPreviewInspectorTargetRuntimeOwnerNames(exportName, names);
  if (
    changed &&
    typeof previewInspectorSession.activeTargetReachabilityKey !== 'string' &&
    previewInspectorSession.fallbackValuesEnabled === true
  ) {
    previewInspectorSession.renderConditionRevision =
      (Number.isSafeInteger(previewInspectorSession.renderConditionRevision)
        ? previewInspectorSession.renderConditionRevision
        : 0) + 1;
    notifyPreviewInspector();
    schedulePreviewInspectorCommitRefresh();
  }
  return names;
}

/**
 * Latches a selected target commit before a redirect or navigation effect can remove its boundary.
 * A guard commonly renders Navigate, commits, and changes the MemoryRouter location well before the
 * delayed DFS evaluation. Remembering that short-lived commit lets the traversal examine the
 * already registered off-graph HOC condition without mistaking unrelated pre-target gates for it.
 */
function markPreviewInspectorTargetReachabilityMount(exportName) {
  initializePreviewInspectorTargetReachabilityState();
  const key = previewInspectorSession.activeTargetReachabilityKey;
  if (typeof key !== 'string') return;
  const state = previewInspectorSession.targetReachabilityByKey.get(key);
  if (state === undefined || state.targetExportName !== exportName) return;
  state.targetWasMounted = true;
}

/**
 * Requires the selected boundary to own connected host output and to remain error-free.
 * A HOC can mount the facade boundary and immediately return Navigate/null before invoking the
 * authored visual component; treating that boundary alone as success stops DFS on a blank page.
 */
function hasPreviewInspectorTargetHostOutput(state) {
  const boundaries = previewInspectorSession.boundariesByExport.get(state.targetExportName);
  if (!(boundaries instanceof Set)) return false;
  for (const boundary of boundaries) {
    if (boundary?.state?.error !== undefined) continue;
    if (collectPreviewInspectorFiberElements(boundary).length > 0) return true;
  }
  return false;
}

/** Reports success only when the authored root and a visible selected target share one live render. */
function hasReachedPreviewInspectorPageCorridor(state) {
  return state.directTarget !== true &&
    state.pageRootCommitted === true &&
    state.targetMounted === true &&
    state.targetHasOutput === true;
}

/** Returns the user-started bounded search that follows newly revealed hook and data requirements. */
function readPreviewInspectorMinimumRequirementSearch(state) {
  initializePreviewInspectorTargetReachabilityState();
  return previewInspectorSession.minimumRequirementSearchByKey.get(state.key);
}

/**
 * Finds only compiler-shaped values whose continuation has one generated answer. Root-only custom
 * hooks and non-GraphQL endpoints stay interactive because their payload structure is ambiguous.
 */
function readPreviewInspectorDeterministicRequirementEvidence(state) {
  const hookIds = readPreviewInspectorRuntimeFallbacks()
    .filter((record) =>
      record.reachabilityKey === state.key &&
      record.mode === 'auto' &&
      (record.requiredPaths ?? []).some((path) => path !== '<root>'),
    )
    .map((record) => record.id)
    .slice(0, 24);
  const requestIds = readPreviewInspectorDataRequests()
    .filter((record) =>
      record.reachabilityKey === state.key &&
      record.kind === 'graphql' &&
      record.mode === 'auto' &&
      readPreviewInspectorDataShapePaths(record.shape).length > 0,
    )
    .map((record) => record.id)
    .slice(0, 24);
  return { hookIds, requestIds };
}

/** Marks a successful corridor as the terminal result of its explicit minimum-requirement search. */
function completePreviewInspectorMinimumRequirementSearch(state) {
  const search = readPreviewInspectorMinimumRequirementSearch(state);
  if (search === undefined) return;
  search.observedPathCount = readPreviewInspectorTargetReachabilityRequiredPaths(state).length;
  search.status = 'reached';
}

/** Applies one newly observed hook/API batch and remounts only when that batch changed values. */
function advancePreviewInspectorMinimumRequirementSearch(state) {
  const search = readPreviewInspectorMinimumRequirementSearch(state);
  if (
    search === undefined ||
    search.status !== 'searching' ||
    search.pass >= PREVIEW_INSPECTOR_MINIMUM_REQUIREMENT_PASS_LIMIT
  ) {
    return false;
  }
  const preserveUserValues = search.origin === 'deterministic-auto';
  const runtimeChanged = smartFillPreviewInspectorRuntimeFallbacksForReachability(
    state.key,
    { preserveUserValues },
  );
  const dataChanged = smartFillPreviewInspectorDataPayloadsForReachability(
    state.key,
    { applicationPath: state.applicationPath, preserveUserValues },
  );
  if (!runtimeChanged && !dataChanged) return false;
  if (typeof recordPreviewInspectorBlockerAutoDecision === 'function') {
    const hookValues = readPreviewInspectorRuntimeFallbacks()
      .filter((record) => record.reachabilityKey === state.key)
      .slice(0, 24)
      .map((record) => ({
        id: record.id,
        requiredPaths: record.requiredPaths,
        value: createPreviewInspectorRuntimeFallbackSmartDraftTemplate(
          previewInspectorSession.runtimeFallbackValues.get(record.id),
          record.requiredPaths,
        ),
      }));
    const backendPayloads = [...previewInspectorSession.dataRequests.values()]
      .filter((record) => record.reachabilityKey === state.key)
      .slice(0, 24)
      .map((record) => {
        const override = previewInspectorSession.dataPayloadOverrides.get(record.id);
        return {
          id: record.id,
          mode: override?.mode ?? 'smart',
          payload: override?.payload ?? generatePreviewInspectorDataValue(record.shape, '', 'smart'),
        };
      });
    const sourceGate = state.appliedConditions?.at(-1);
    recordPreviewInspectorBlockerAutoDecision({
      action: search.origin === 'deterministic-auto'
        ? 'Auto-fill deterministic page-path requirements'
        : 'Fill newly discovered page-path requirements',
      blockerId: 'target-reachability:' + state.key,
      blockerKind: 'target-reachability',
      blockerName: 'Target not reached · ' + state.targetExportName,
      generatedPaths: readPreviewInspectorTargetReachabilityRequiredPaths(state),
      line: sourceGate?.line,
      mode: search.origin === 'deterministic-auto'
        ? 'deterministic-minimum-auto'
        : 'minimum-requirement-dfs',
      ownerName: sourceGate?.ownerName ?? state.rootName,
      reason: 'Downstream hook and backend reads were discovered during the previous DFS pass',
      selectedValue: { backendPayloads, hookValues, nextPass: search.pass + 1 },
      sourcePath: sourceGate?.sourcePath,
      startsRenderAttempt: true,
      summary: { applicationPath: state.applicationPath },
    });
  }
  search.pass += 1;
  search.observedPathCount = readPreviewInspectorTargetReachabilityRequiredPaths(state).length;
  if (search.pass >= PREVIEW_INSPECTOR_MINIMUM_REQUIREMENT_PASS_LIMIT) {
    search.status = 'limit-reached';
  }
  state.exhausted = false;
  state.idlePasses = 0;
  state.status = 'filling-requirements';
  state.probeRevision += 1;
  previewInspectorSession.fallbackValuesEnabled = true;
  previewInspectorSession.dataAutoEnabled = true;
  if (dataChanged) previewInspectorSession.dataRevision += 1;
  previewInspectorSession.renderConditionRevision =
    (previewInspectorSession.renderConditionRevision ?? 0) + 1;
  persistPreviewInspectorState();
  notifyPreviewInspector();
  schedulePreviewInspectorTreeRefresh();
  schedulePreviewInspectorCommitRefresh();
  return true;
}

/**
 * Starts minimum-shape convergence without a prompt when every admitted input is compiler-proven.
 * The pass is still bounded and records its origin so user JSON remains immutable in the background.
 */
function startPreviewInspectorDeterministicRequirementSearch(state) {
  const current = readPreviewInspectorMinimumRequirementSearch(state);
  if (current?.status === 'searching') return false;
  const evidence = readPreviewInspectorDeterministicRequirementEvidence(state);
  if (evidence.hookIds.length === 0 && evidence.requestIds.length === 0) return false;
  previewInspectorSession.minimumRequirementSearchByKey.set(state.key, {
    observedPathCount: 0,
    origin: 'deterministic-auto',
    pass: 0,
    status: 'searching',
  });
  if (typeof recordPreviewInspectorBlockerAutoDecision === 'function') {
    recordPreviewInspectorBlockerAutoDecision({
      action: 'Start deterministic minimum page-path search',
      blockerId: 'target-reachability:' + state.key,
      blockerKind: 'target-reachability',
      blockerName: 'Target not reached · ' + state.targetExportName,
      generatedPaths: readPreviewInspectorTargetReachabilityRequiredPaths(state),
      mode: 'deterministic-minimum-auto',
      ownerName: state.appliedConditions?.at(-1)?.ownerName ?? state.rootName,
      reason: 'Compiler-required hook paths or GraphQL selections admit one minimum static shape',
      selectedValue: evidence,
      sourcePath: state.appliedConditions?.at(-1)?.sourcePath,
      summary: { applicationPath: state.applicationPath },
    });
  }
  state.exhausted = false;
  state.idlePasses = 0;
  state.status = 'searching-deterministic-requirements';
  if (advancePreviewInspectorMinimumRequirementSearch(state)) return true;
  settlePreviewInspectorMinimumRequirementSearch(state);
  return false;
}

/** Retains the final discovery summary when no further path-local requirement can be proven. */
function settlePreviewInspectorMinimumRequirementSearch(state) {
  const search = readPreviewInspectorMinimumRequirementSearch(state);
  if (search === undefined || search.status !== 'searching') return;
  search.observedPathCount = readPreviewInspectorTargetReachabilityRequiredPaths(state).length;
  search.status = 'settled';
}

/** Emits one warning when bounded static traversal cannot prove another page-local continuation. */
function reportPreviewInspectorPageCorridorBlocked(state) {
  if (state.blockedWarningReported === true) return;
  state.blockedWarningReported = true;
  const message = 'Page context rendered, but did not reach ' + state.targetExportName + '.';
  const details = [
    message,
    'Page root: ' + state.rootName,
    'Path: ' + state.applicationPath.join(' > '),
    state.appliedConditions.length > 0
      ? 'Auto-passed gates: ' + state.appliedConditions.map((gate) => gate.expression).join(', ')
      : 'No additional statically proven gate was available.',
    'The page remains mounted. Resolve its next blocker or choose target-only diagnostic mode explicitly.',
  ].join('\n');
  recordPreviewInspectorConsoleEntry({
    details,
    level: 'warn',
    location: '',
    message,
    phase: 'page render corridor',
    source: 'target-reachability',
  });
  readPreviewInspectorConsolePrimitives().warn('[React Preview] ' + details);
}

/** Emits one visible warning when the user explicitly leaves authored page context. */
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
    'Target-only diagnostic mode preserves generated providers and payloads, but is not a successful page preview.',
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

/** Switches to target-only diagnostic mode only after an explicit user action. */
function activatePreviewInspectorDirectTarget(state) {
  if (state.directTargetAvailable !== true) {
    state.exhausted = true;
    state.status = 'blocked';
    state.probeRevision += 1;
    notifyPreviewInspector();
    schedulePreviewInspectorTreeRefresh();
    return;
  }
  previewInspectorSession.minimumRequirementSearchByKey?.delete(state.key);
  state.directTarget = true;
  state.pageRootCommitted = false;
  state.status = 'target-only';
  state.probeRevision += 1;
  reportPreviewInspectorTargetReachabilityFallback(state);
  notifyPreviewInspector();
  schedulePreviewInspectorTreeRefresh();
}

/** Evaluates one settled commit and advances at most one path gate. */
function evaluatePreviewInspectorTargetReachability(descriptor, candidate, state) {
  state.targetMounted = state.targetWasMounted === true || hasMountedPreviewInspectorTarget(state);
  state.targetHasOutput = hasPreviewInspectorTargetHostOutput(state);
  if (hasReachedPreviewInspectorPageCorridor(state)) {
    completePreviewInspectorMinimumRequirementSearch(state);
    state.status = 'reached';
    state.idlePasses = 0;
    schedulePreviewInspectorTreeRefresh();
    return;
  }
  if (state.directTarget) {
    state.status = state.targetHasOutput
      ? 'target-only'
      : state.targetMounted
        ? 'target-only-empty'
        : 'target-only-loading';
    schedulePreviewInspectorTreeRefresh();
    return;
  }
  if (advancePreviewInspectorMinimumRequirementSearch(state)) return;
  if (state.targetMounted && state.pageRootCommitted !== true) {
    state.status = 'page-root-pending';
    schedulePreviewInspectorTreeRefresh();
    return;
  }
  if (state.exhausted === true) return;
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
  if (startPreviewInspectorDeterministicRequirementSearch(state)) return;
  state.idlePasses += 1;
  state.status = 'blocked';
  state.probeRevision += 1;
  if (
    state.attempt >= PREVIEW_INSPECTOR_TARGET_REACHABILITY_PASS_LIMIT ||
    state.idlePasses >= PREVIEW_INSPECTOR_TARGET_REACHABILITY_IDLE_LIMIT
  ) {
    settlePreviewInspectorMinimumRequirementSearch(state);
    state.exhausted = true;
    state.status = 'page-blocked';
    reportPreviewInspectorPageCorridorBlocked(state);
    notifyPreviewInspector();
    schedulePreviewInspectorTreeRefresh();
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
    const probeDelay =
      directTarget === true
        ? PREVIEW_INSPECTOR_TARGET_DIRECT_PROBE_DELAY_MS
        : state.attempt === 0 && probeRevision === 0
          ? PREVIEW_INSPECTOR_TARGET_INITIAL_PROBE_DELAY_MS
          : PREVIEW_INSPECTOR_TARGET_CONTINUATION_PROBE_DELAY_MS;
    const timer = globalThis.setTimeout(
      () => evaluatePreviewInspectorTargetReachability(descriptor, candidate, state),
      probeDelay,
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
  for (const gate of state.appliedConditions ?? []) append('gate.' + gate.expression);
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
      line: state.appliedConditions?.at(-1)?.line,
      minimumRequirementSearch: readPreviewInspectorMinimumRequirementSearch(state),
      ownerName: state.appliedConditions?.at(-1)?.ownerName ?? state.rootName,
      requiredPaths: readPreviewInspectorTargetReachabilityRequiredPaths(state),
      sourcePath: state.appliedConditions?.at(-1)?.sourcePath,
    }));
}

/** Starts bounded convergence across hook/data edges without discarding proven branch choices. */
function smartFillPreviewInspectorTargetApplicationPath(blocker) {
  const reachabilityKey = typeof blocker?.key === 'string' ? blocker.key : '';
  if (reachabilityKey.length === 0) {
    retryPreviewInspectorTargetApplicationPath();
    return;
  }
  initializePreviewInspectorTargetReachabilityState();
  if (typeof recordPreviewInspectorBlockerAutoDecision === 'function') {
    recordPreviewInspectorBlockerAutoDecision({
      action: 'Start minimum page-path requirement search',
      blockerId: blocker.id ?? 'target-reachability:' + reachabilityKey,
      blockerKind: 'target-reachability',
      blockerName: 'Target not reached · ' + String(blocker.targetExportName ?? 'selected export'),
      generatedPaths: blocker.requiredPaths ?? [],
      line: blocker.line,
      mode: 'minimum-requirement-dfs',
      ownerName: blocker.ownerName,
      reason: 'Traverse from the authored page root and fill only values demanded downstream',
      selectedValue: {
        dataAutoEnabled: true,
        fallbackValuesEnabled: true,
        retainedGates: blocker.appliedConditions ?? [],
      },
      sourcePath: blocker.sourcePath,
      summary: { applicationPath: blocker.applicationPath ?? [] },
    });
  }
  previewInspectorSession.minimumRequirementSearchByKey.set(reachabilityKey, {
    observedPathCount: 0,
    origin: 'user',
    pass: 0,
    status: 'searching',
  });
  previewInspectorSession.fallbackValuesEnabled = true;
  previewInspectorSession.dataAutoEnabled = true;
  const state = previewInspectorSession.targetReachabilityByKey.get(reachabilityKey);
  if (state !== undefined) {
    state.exhausted = false;
    state.idlePasses = 0;
    state.status = 'searching-requirements';
    state.probeRevision += 1;
    if (advancePreviewInspectorMinimumRequirementSearch(state)) return;
  }
  previewInspectorSession.renderConditionRevision =
    (previewInspectorSession.renderConditionRevision ?? 0) + 1;
  persistPreviewInspectorState();
  notifyPreviewInspector();
  schedulePreviewInspectorTreeRefresh();
  schedulePreviewInspectorCommitRefresh();
}

/** Restarts selected application-path traversal and discards only its automatic branch choices. */
function retryPreviewInspectorTargetApplicationPath() {
  const descriptor = findSelectedPreviewInspectorDescriptor();
  const candidate = readSelectedPreviewInspectorPageCandidate(descriptor);
  if (descriptor === undefined || candidate === undefined) return;
  const key = createPreviewInspectorTargetReachabilityKey(descriptor, candidate);
  previewInspectorSession.minimumRequirementSearchByKey?.delete(key);
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

/** Leaves target-only diagnostics and resumes the same authored page corridor and DFS choices. */
function returnPreviewInspectorToPageContext() {
  const descriptor = findSelectedPreviewInspectorDescriptor();
  const candidate = readSelectedPreviewInspectorPageCandidate(descriptor);
  if (descriptor === undefined || candidate === undefined) return;
  const state = readPreviewInspectorTargetReachabilityState(descriptor, candidate);
  state.directTarget = false;
  state.exhausted = false;
  state.idlePasses = 0;
  state.pageRootCommitted = false;
  state.status = 'probing';
  state.targetHasOutput = false;
  state.targetMounted = false;
  state.targetWasMounted = false;
  state.probeRevision += 1;
  notifyPreviewInspector();
  schedulePreviewInspectorCommitRefresh();
}

/** Clears obsolete traversal state after a candidate, export, or hot descriptor replacement. */
function resetPreviewInspectorTargetReachability() {
  initializePreviewInspectorTargetReachabilityState();
  const conditionChanged = clearPreviewInspectorTargetGuidedConditionOverrides();
  const stateChanged = previewInspectorSession.targetReachabilityByKey.size > 0;
  previewInspectorSession.targetReachabilityByKey.clear();
  previewInspectorSession.minimumRequirementSearchByKey.clear();
  previewInspectorSession.activeTargetReachabilityKey = undefined;
  return conditionChanged || stateChanged;
}
`;
}
