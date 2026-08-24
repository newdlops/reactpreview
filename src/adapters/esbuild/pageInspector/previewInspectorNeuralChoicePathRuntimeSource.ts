/** Generates the bounded page-choice graph used by the local neural path recommender. */

/** Creates browser source that derives finite paths without inventing application choices. */
export function createPreviewInspectorNeuralChoicePathRuntimeSource(): string {
  return String.raw`
const PREVIEW_INSPECTOR_NEURAL_CHOICE_PATH_LIMIT = 96;
const PREVIEW_INSPECTOR_NEURAL_CHOICE_PATH_DEPTH_LIMIT = 12;
const PREVIEW_INSPECTOR_NEURAL_CHOICE_PATH_STATE_LIMIT = 48;
const PREVIEW_INSPECTOR_NEURAL_CHOICE_PATH_EDGE_LIMIT = 192;
const PREVIEW_INSPECTOR_NEURAL_CHOICE_PATH_COMPLETED_LIMIT = 24;

/** Returns one stable candidate identity without retaining arbitrary project values. */
function createPreviewInspectorNeuralChoicePathCandidateId(candidate, index) {
  if (candidate !== null && typeof candidate === 'object') {
    const identity = candidate.id ?? candidate.candidateId ?? candidate.label;
    if (typeof identity === 'string' && identity.length > 0) return identity.slice(0, 160);
  }
  return hashPreviewInspectorNeuralFiniteChoiceSignature(
    formatPreviewInspectorNeuralChoicePathValue(candidate) + ':' + String(index),
  );
}

/** Formats only the short label needed by the Inspector path list. */
function formatPreviewInspectorNeuralChoicePathValue(value) {
  if (value !== null && typeof value === 'object' && typeof value.label === 'string') {
    return value.label.replace(/\s+/gu, ' ').trim().slice(0, 120);
  }
  if (typeof value === 'string') return value.replace(/\s+/gu, ' ').trim().slice(0, 120);
  try { return JSON.stringify(value).slice(0, 120); } catch { return String(value).slice(0, 120); }
}

/** Gives inference, training, and retained outcomes the same semantic route identity. */
function createPreviewInspectorNeuralChoicePathId(steps) {
  return 'choice-path:' + hashPreviewInspectorNeuralFiniteChoiceSignature(
    JSON.stringify(steps.map((step) => [step.choiceId, step.path, step.candidateId])),
  );
}

/** Normalizes concrete decision units while preserving every source/page candidate. */
function readPreviewInspectorNeuralChoicePathUnits(choices) {
  const units = [];
  for (const [choiceIndex, choice] of (Array.isArray(choices) ? choices : []).entries()) {
    if (choice?.surface === 'page-context' || !Array.isArray(choice?.choiceRecords)) continue;
    for (const record of choice.choiceRecords) {
      if (
        typeof record?.path !== 'string' || record.path.length === 0 ||
        !Array.isArray(record.candidates) || record.candidates.length === 0
      ) continue;
      units.push({
        candidates: record.candidates.slice(0, PREVIEW_INSPECTOR_NEURAL_PAGE_CHOICE_LIMIT),
        choice,
        choiceId: String(choice.id ?? choice.choiceKind ?? choiceIndex),
        choiceIndex,
        path: record.path,
        record,
      });
    }
  }
  return units.slice(0, PREVIEW_INSPECTOR_NEURAL_CHOICE_PATH_DEPTH_LIMIT);
}

/** Snapshots only serializable finite edges so prior graph states never retain project DOM nodes. */
function createPreviewInspectorNeuralChoicePathUnitSnapshots(units) {
  return units.map((unit) => ({
    candidates: unit.candidates.map((candidate, candidateIndex) => ({
      candidateId: createPreviewInspectorNeuralChoicePathCandidateId(candidate, candidateIndex),
      candidateIndex,
      disabled: candidate !== null && typeof candidate === 'object' && candidate.disabled === true,
      label: formatPreviewInspectorNeuralChoicePathValue(candidate),
      selected: candidate !== null && typeof candidate === 'object' && candidate.selected === true,
    })),
    choiceId: unit.choiceId,
    choiceIndex: unit.choiceIndex,
    choiceKind: unit.choice?.choiceKind,
    currentValue: formatPreviewInspectorNeuralChoicePathValue(unit.record?.currentValue),
    path: unit.path,
  }));
}

/** Collapses the current semantic choice surface into one graph-node identity. */
function createPreviewInspectorNeuralChoicePathState(choices) {
  const units = readPreviewInspectorNeuralChoicePathUnits(choices);
  if (units.length === 0) return undefined;
  const pathUnits = createPreviewInspectorNeuralChoicePathUnitSnapshots(units);
  const signature = JSON.stringify(pathUnits.map((unit) => [
    unit.choiceId,
    unit.choiceKind,
    unit.path,
    unit.currentValue,
    unit.candidates.map((candidate) => [
      candidate.candidateId,
      candidate.label,
      candidate.selected,
    ]),
  ]));
  return {
    id: 'choice-state:' + hashPreviewInspectorNeuralFiniteChoiceSignature(signature),
    pathUnits,
    signature,
    units,
  };
}

/** Initializes one revision-local finite graph and upgrades hot-retained state defensively. */
function initializePreviewInspectorNeuralChoicePathSearch(searchKind = 'user') {
  const stateKey = searchKind === 'automatic'
    ? 'neuralPageGenerationChoicePathSearch'
    : 'neuralChoicePathSearch';
  let search = previewInspectorSession[stateKey];
  if (search?.revision !== previewEntryRevision) {
    search = {
      activeEdges: [],
      completedPaths: [],
      edges: new Map(),
      lastCycle: undefined,
      nodes: new Map(),
      pending: undefined,
      revision: previewEntryRevision,
      rootStateId: undefined,
    };
    previewInspectorSession[stateKey] = search;
  }
  if (!(search.nodes instanceof Map)) search.nodes = new Map();
  if (!(search.edges instanceof Map)) search.edges = new Map();
  if (!Array.isArray(search.activeEdges)) search.activeEdges = [];
  if (!Array.isArray(search.completedPaths)) search.completedPaths = [];
  while (search.nodes.size > PREVIEW_INSPECTOR_NEURAL_CHOICE_PATH_STATE_LIMIT) {
    search.nodes.delete(search.nodes.keys().next().value);
  }
  while (search.edges.size > PREVIEW_INSPECTOR_NEURAL_CHOICE_PATH_EDGE_LIMIT) {
    search.edges.delete(search.edges.keys().next().value);
  }
  return search;
}

/** Reads whether the selected file has reached real page output. */
function hasPreviewInspectorNeuralChoicePathReachedTarget() {
  const reachability = typeof readPreviewInspectorNeuralAssistanceReachability === 'function'
    ? readPreviewInspectorNeuralAssistanceReachability()
    : undefined;
  const visible = reachability?.targetHasOutput === true || reachability?.status === 'reached';
  return visible && (
    typeof recordPreviewInspectorNeuralSuccessfulPath !== 'function' ||
    reachability?.neuralStableOutputVerified === true
  );
}

/** Keeps the selected edge pending while visible output undergoes delayed stability checks. */
function isPreviewInspectorNeuralChoicePathAwaitingStableTarget() {
  if (typeof recordPreviewInspectorNeuralSuccessfulPath !== 'function') return false;
  const reachability = typeof readPreviewInspectorNeuralAssistanceReachability === 'function'
    ? readPreviewInspectorNeuralAssistanceReachability()
    : undefined;
  return reachability?.targetHasOutput === true &&
    reachability?.neuralStableOutputVerified !== true &&
    reachability?.neuralStableOutputRegressed !== true;
}

/** Returns the currently active path prefix after prior observed transitions. */
function readPreviewInspectorNeuralChoicePathPrefix(search) {
  return search.activeEdges.flatMap((edge) => edge.steps).slice(
    -PREVIEW_INSPECTOR_NEURAL_CHOICE_PATH_DEPTH_LIMIT,
  );
}

/** Scopes downstream blocker attempts to the exact finite path the user or model applied. */
function setPreviewInspectorNeuralActiveChoicePath(pathId) {
  previewInspectorSession.neuralActiveChoicePathId =
    typeof pathId === 'string' && pathId.length > 0 ? pathId.slice(0, 200) : undefined;
}

/** Creates one residual decision for a path using only bounded semantic features. */
function createPreviewInspectorNeuralChoicePathDecision(path, stateId, deterministicRank) {
  if (typeof createPreviewInspectorNeuralResidualDecision !== 'function') return undefined;
  return createPreviewInspectorNeuralResidualDecision({
    blockerKind: 'render-condition',
    candidateId: path.id,
    holeKind: 'page-choice-path',
    numbers: {
      choiceCount: path.steps.length,
      deterministicRank,
      pathDepth: path.steps.length,
    },
    texts: [
      previewInspectorSession.selectedExportName,
      globalThis.location?.pathname,
      path.label,
    ],
    tokens: [
      'choice-state:' + stateId,
      ...path.steps.slice(-PREVIEW_INSPECTOR_NEURAL_CHOICE_PATH_DEPTH_LIMIT)
        .map((step) => 'choice-step:' + step.candidateId),
    ],
  });
}

/** Emits a verified path label through the existing local-learning health channel. */
function trainPreviewInspectorNeuralChoicePathDecision(pending, label, reason) {
  const update = typeof trainPreviewInspectorNeuralResidualDecision === 'function'
    ? trainPreviewInspectorNeuralResidualDecision(pending?.decision, label)
    : undefined;
  if (update === undefined || typeof recordPreviewInspectorRuntimeHealth !== 'function') return;
  recordPreviewInspectorRuntimeHealth({
    category: 'neural-residual',
    detail: {
      blockerKind: 'render-condition',
      candidateId: pending.decision?.candidateId,
      headKey: update.headKey,
      headUpdates: update.headUpdates,
      holeKind: 'page-choice-path',
      label: update.label,
      labelReason: reason,
      outcomeAttempts: update.outcomeAttempts,
      prediction: update.prediction,
      targetOutput: label >= 0.95,
      updates: update.updates,
    },
    event: 'neural-residual-trained',
  });
}

/** Propagates a terminal verifier result to each earlier decision prefix on the same route. */
function trainPreviewInspectorNeuralChoicePathPrefixes(steps, stateId, label, reason) {
  for (let depth = 1; depth < steps.length; depth += 1) {
    const prefixSteps = steps.slice(0, depth);
    const path = {
      id: createPreviewInspectorNeuralChoicePathId(prefixSteps),
      label: prefixSteps.map((step) => step.label).join(' → '),
      steps: prefixSteps,
    };
    trainPreviewInspectorNeuralChoicePathDecision(
      { decision: createPreviewInspectorNeuralChoicePathDecision(path, stateId, 0) },
      label,
      reason,
    );
  }
}

/** Rewinds the active prefix when authored page navigation returns to an earlier state. */
function reconcilePreviewInspectorNeuralChoicePathPrefix(search, currentStateId) {
  if (typeof currentStateId !== 'string' || search.activeEdges.length === 0) return;
  const stateIds = [search.rootStateId, ...search.activeEdges.map((edge) => edge.toStateId)];
  const retainedIndex = stateIds.lastIndexOf(currentStateId);
  if (retainedIndex >= 0 && retainedIndex < search.activeEdges.length) {
    search.activeEdges = search.activeEdges.slice(0, retainedIndex);
  }
}

/** Commits one pending edge only after React reveals a distinct next state or verified output. */
function observePreviewInspectorNeuralChoicePathState(
  choices,
  force = false,
  searchKind = 'user',
) {
  const search = initializePreviewInspectorNeuralChoicePathSearch(searchKind);
  const currentState = createPreviewInspectorNeuralChoicePathState(choices);
  const reachedTarget = currentState === undefined &&
    hasPreviewInspectorNeuralChoicePathReachedTarget();
  const currentStateId = reachedTarget ? 'target-ready' : currentState?.id;
  if (currentState !== undefined) {
    const previous = search.nodes.get(currentState.id);
    search.nodes.set(currentState.id, {
      id: currentState.id,
      pathUnits: currentState.pathUnits,
      signature: currentState.signature,
      visits: Math.min(Number.MAX_SAFE_INTEGER, Number(previous?.visits ?? 0) + 1),
    });
    if (search.rootStateId === undefined) search.rootStateId = currentState.id;
  }
  const pending = search.pending;
  const stateChanged = typeof currentStateId === 'string' &&
    currentStateId !== pending?.fromStateId;
  if (
    pending !== undefined && currentState === undefined && !reachedTarget &&
    isPreviewInspectorNeuralChoicePathAwaitingStableTarget()
  ) {
    return { awaitingStableTarget: true, currentState, reachedTarget, search };
  }
  if (pending === undefined || (!reachedTarget && !stateChanged && force !== true)) {
    reconcilePreviewInspectorNeuralChoicePathPrefix(search, currentStateId);
    return { currentState, reachedTarget, search };
  }

  const toStateId = currentStateId ?? 'blocked-terminal';
  const prefixBefore = readPreviewInspectorNeuralChoicePathPrefix(search);
  const completedSteps = [...prefixBefore, ...pending.steps].slice(
    -PREVIEW_INSPECTOR_NEURAL_CHOICE_PATH_DEPTH_LIMIT,
  );
  const activeStateIds = [search.rootStateId, ...search.activeEdges.map((edge) => edge.toStateId)];
  const repeatedAt = activeStateIds.lastIndexOf(toStateId);
  const cycle = !reachedTarget && repeatedAt >= 0;
  const edge = {
    fromStateId: pending.fromStateId,
    id: pending.fromStateId + '→' + toStateId + ':' + pending.pathId,
    steps: pending.steps,
    targetReady: reachedTarget,
    toStateId,
  };
  search.edges.set(edge.id, edge);
  if (reachedTarget) {
    const completedPath = {
      id: pending.pathId,
      label: completedSteps.map((step) => step.label).join(' → '),
      steps: completedSteps,
    };
    search.completedPaths = search.completedPaths
      .filter((path) => path.id !== completedPath.id);
    search.completedPaths.push(completedPath);
    search.completedPaths = search.completedPaths.slice(
      -PREVIEW_INSPECTOR_NEURAL_CHOICE_PATH_COMPLETED_LIMIT,
    );
  } else if (cycle) {
    const cycleEdges = search.activeEdges.slice(Math.max(0, repeatedAt));
    const cycleSteps = [...cycleEdges.flatMap((item) => item.steps), ...pending.steps];
    search.lastCycle = {
      label: cycleSteps.map((step) => step.label).join(' → '),
      stateId: toStateId,
    };
    search.activeEdges = search.activeEdges.slice(0, Math.max(0, repeatedAt));
  } else if (search.activeEdges.length < PREVIEW_INSPECTOR_NEURAL_CHOICE_PATH_DEPTH_LIMIT) {
    search.activeEdges.push(edge);
  }
  const label = reachedTarget ? 1 : cycle ? 0.1 : currentState !== undefined ? 0.7 : 0;
  trainPreviewInspectorNeuralChoicePathDecision(
    pending,
    label,
    reachedTarget
      ? 'page-choice-path-reached-target'
      : cycle
        ? 'page-choice-path-cycle'
        : currentState !== undefined
          ? 'page-choice-path-progress'
          : 'page-choice-path-blocked',
  );
  if (reachedTarget || cycle || currentState === undefined) {
    trainPreviewInspectorNeuralChoicePathPrefixes(
      completedSteps,
      search.rootStateId ?? pending.fromStateId,
      label,
      reachedTarget
        ? 'page-choice-prefix-reached-target'
        : cycle
          ? 'page-choice-prefix-cycle'
          : 'page-choice-prefix-blocked',
    );
  }
  search.pending = undefined;
  return { currentState, reachedTarget, search };
}

/** Commits pending user/model edges only after the shared target verifier reaches a terminal verdict. */
function settlePreviewInspectorNeuralChoicePathOutcome(success) {
  let settled = false;
  for (const searchKind of ['user', 'automatic']) {
    const search = initializePreviewInspectorNeuralChoicePathSearch(searchKind);
    if (search.pending === undefined) continue;
    const choices = success
      ? []
      : searchKind === 'automatic' &&
          typeof readPreviewInspectorNeuralPageGenerationChoices === 'function'
        ? readPreviewInspectorNeuralPageGenerationChoices()
        : typeof readPreviewInspectorNeuralUserChoices === 'function'
          ? readPreviewInspectorNeuralUserChoices({ explicitOnly: true, includePending: true })
          : [];
    observePreviewInspectorNeuralChoicePathState(choices, true, searchKind);
    settled = true;
  }
  return settled;
}

/** Expands one state's small Cartesian domain while keeping every decision in each path. */
function enumeratePreviewInspectorNeuralChoiceCombinations(
  pathUnits,
  current,
  singleChoice = false,
) {
  const combinations = [];
  let truncated = false;
  if (singleChoice) {
    for (const unit of pathUnits) {
      for (const candidate of unit.candidates) {
        if (candidate.disabled) continue;
        combinations.push([{
          candidateId: candidate.candidateId,
          candidateIndex: candidate.candidateIndex,
          choiceId: unit.choiceId,
          choiceIndex: unit.choiceIndex,
          current,
          label: candidate.label,
          path: unit.path,
        }]);
        if (combinations.length >= PREVIEW_INSPECTOR_NEURAL_CHOICE_PATH_LIMIT) {
          truncated = true;
          return { combinations, truncated };
        }
      }
    }
    return { combinations, truncated };
  }
  const visit = (unitIndex, combination) => {
    if (combinations.length >= PREVIEW_INSPECTOR_NEURAL_CHOICE_PATH_LIMIT) {
      truncated = true;
      return;
    }
    if (unitIndex >= pathUnits.length) {
      combinations.push(combination);
      return;
    }
    const unit = pathUnits[unitIndex];
    for (const candidate of unit.candidates) {
      if (candidate.disabled) continue;
      visit(unitIndex + 1, [...combination, {
        candidateId: candidate.candidateId,
        candidateIndex: candidate.candidateIndex,
        choiceId: unit.choiceId,
        choiceIndex: unit.choiceIndex,
        current,
        label: candidate.label,
        path: unit.path,
      }]);
      if (truncated) return;
    }
  };
  visit(0, []);
  return { combinations, truncated };
}

/** Compares an observed transition with one complete selection at its source state. */
function createPreviewInspectorNeuralChoicePathStepKey(steps) {
  return JSON.stringify(steps.map((step) => [step.choiceId, step.path, step.candidateId]));
}

/** Walks observed graph edges, closes cycles, and leaves unseen alternatives as finite frontiers. */
function enumeratePreviewInspectorNeuralChoiceGraph(search, currentState, prefix, options = {}) {
  const paths = [];
  const pathIds = new Set();
  let truncated = false;
  const appendPath = (steps, terminal = {}) => {
    if (paths.length >= PREVIEW_INSPECTOR_NEURAL_CHOICE_PATH_LIMIT) {
      truncated = true;
      return;
    }
    const boundedSteps = steps.slice(0, PREVIEW_INSPECTOR_NEURAL_CHOICE_PATH_DEPTH_LIMIT);
    const id = createPreviewInspectorNeuralChoicePathId(boundedSteps);
    if (pathIds.has(id)) return;
    pathIds.add(id);
    paths.push({
      ...terminal,
      id,
      label: boundedSteps.map((step) => step.label).join(' → '),
      steps: boundedSteps,
    });
  };
  const visit = (stateId, routeSteps, visitedStateIds, current) => {
    if (paths.length >= PREVIEW_INSPECTOR_NEURAL_CHOICE_PATH_LIMIT) {
      truncated = true;
      return;
    }
    const node = stateId === currentState.id ? currentState : search.nodes.get(stateId);
    if (!Array.isArray(node?.pathUnits) || node.pathUnits.length === 0) {
      appendPath(routeSteps, { blocked: true });
      return;
    }
    const local = enumeratePreviewInspectorNeuralChoiceCombinations(
      node.pathUnits,
      current,
      options.singleChoice === true,
    );
    if (local.truncated) truncated = true;
    for (const combination of local.combinations) {
      const steps = [...routeSteps, ...combination];
      if (steps.length >= PREVIEW_INSPECTOR_NEURAL_CHOICE_PATH_DEPTH_LIMIT) {
        appendPath(steps, { bounded: true });
        continue;
      }
      const combinationKey = createPreviewInspectorNeuralChoicePathStepKey(combination);
      const outgoing = [...search.edges.values()].filter((edge) =>
        edge.fromStateId === stateId && edge.steps.length === combination.length &&
        createPreviewInspectorNeuralChoicePathStepKey(edge.steps) === combinationKey);
      if (outgoing.length === 0) {
        appendPath(steps);
        continue;
      }
      for (const edge of outgoing) {
        if (edge.targetReady) {
          appendPath(steps, { verified: true });
        } else if (visitedStateIds.has(edge.toStateId)) {
          appendPath(steps, { cyclic: true });
        } else if (search.nodes.has(edge.toStateId)) {
          visit(
            edge.toStateId,
            steps,
            new Set([...visitedStateIds, edge.toStateId]),
            false,
          );
        } else {
          appendPath(steps, { blocked: true });
        }
        if (truncated) return;
      }
    }
  };
  const activeStateIds = new Set([
    search.rootStateId,
    ...search.activeEdges.map((edge) => edge.toStateId),
    currentState.id,
  ].filter((stateId) => typeof stateId === 'string'));
  visit(currentState.id, prefix, activeStateIds, true);
  return { paths, truncated };
}

/** Derives and model-ranks every currently reachable finite choice path. */
function readPreviewInspectorNeuralDerivedChoicePaths(choices, options = {}) {
  const normalizedChoices = Array.isArray(choices)
    ? choices
    : readPreviewInspectorNeuralUserChoices({ explicitOnly: true });
  const searchKind = options.searchKind === 'automatic' ? 'automatic' : 'user';
  const observation = observePreviewInspectorNeuralChoicePathState(
    normalizedChoices,
    false,
    searchKind,
  );
  const currentState = observation.currentState;
  if (currentState === undefined) return undefined;
  const prefix = readPreviewInspectorNeuralChoicePathPrefix(observation.search).map((step) => ({
    ...step,
    current: false,
  }));
  const enumeration = enumeratePreviewInspectorNeuralChoiceGraph(
    observation.search,
    currentState,
    prefix,
    { singleChoice: options.singleChoice === true },
  );
  const ranked = enumeration.paths.map((path, deterministicRank) => {
    return {
      decision: createPreviewInspectorNeuralChoicePathDecision(path, currentState.id, deterministicRank),
      deterministicRank,
      path,
    };
  });
  const terminalRank = (path) => path.verified === true
    ? 0
    : path.cyclic === true
      ? 3
      : path.blocked === true
        ? 2
        : 1;
  ranked.sort((left, right) => terminalRank(left.path) - terminalRank(right.path) ||
    (
      typeof comparePreviewInspectorNeuralResidualDecisions === 'function' &&
      left.decision !== undefined && right.decision !== undefined
        ? comparePreviewInspectorNeuralResidualDecisions(left.decision, right.decision)
        : 0
    ) || Number(left.decision?.consecutiveFailures ?? 0) -
      Number(right.decision?.consecutiveFailures ?? 0) ||
      left.deterministicRank - right.deterministicRank || left.path.id.localeCompare(right.path.id),
  );
  const paths = ranked.map((item) => item.path);
  return {
    completedPaths: [...observation.search.completedPaths],
    currentStateId: currentState.id,
    cycle: observation.search.lastCycle,
    pathCount: paths.length,
    paths,
    recommendedPath: paths[0],
    stateCount: observation.search.nodes.size,
    truncated: enumeration.truncated,
  };
}

/** Captures the exact user-selected edge before its page action changes React state. */
function recordPreviewInspectorNeuralChoicePathSelection(choice, selections, options = {}) {
  if (!Array.isArray(selections) || selections.length === 0) return false;
  const searchKind = options.searchKind === 'automatic' ? 'automatic' : 'user';
  const choices = Array.isArray(options.choices)
    ? options.choices
    : searchKind === 'automatic' &&
        typeof readPreviewInspectorNeuralPageGenerationChoices === 'function'
      ? readPreviewInspectorNeuralPageGenerationChoices()
      : readPreviewInspectorNeuralUserChoices({ explicitOnly: true });
  const observation = observePreviewInspectorNeuralChoicePathState(
    choices,
    false,
    searchKind,
  );
  const currentState = observation.currentState;
  if (currentState === undefined) return false;
  const steps = selections.map((selection) => {
    const candidateIndex = selection.choiceRecord.candidates.indexOf(selection.selectedValue);
    return {
      candidateId: createPreviewInspectorNeuralChoicePathCandidateId(
        selection.selectedValue,
        candidateIndex,
      ),
      candidateIndex,
      choiceId: String(choice?.id ?? choice?.choiceKind ?? 'choice'),
      current: true,
      label: formatPreviewInspectorNeuralChoicePathValue(selection.selectedValue),
      path: selection.choiceRecord.path,
    };
  });
  const requestedPathId = typeof options?.pathId === 'string' && options.pathId.length > 0
    ? options.pathId
    : undefined;
  if (requestedPathId !== undefined) {
    setPreviewInspectorNeuralActiveChoicePath(requestedPathId);
  }
  const retainedSteps = requestedPathId !== undefined &&
      observation.search.pending?.fromStateId === currentState.id &&
      observation.search.pending?.pathId === requestedPathId
    ? observation.search.pending.steps
    : [];
  const mergedSteps = [...retainedSteps, ...steps].filter((step, index, all) =>
    all.findIndex((candidate) =>
      candidate.choiceId === step.choiceId && candidate.path === step.path,
    ) === index,
  );
  const fullSteps = [...readPreviewInspectorNeuralChoicePathPrefix(observation.search), ...mergedSteps]
    .slice(-PREVIEW_INSPECTOR_NEURAL_CHOICE_PATH_DEPTH_LIMIT);
  const path = {
    id: requestedPathId ?? createPreviewInspectorNeuralChoicePathId(fullSteps),
    label: fullSteps.map((step) => step.label).join(' → '),
    steps: fullSteps,
  };
  observation.search.pending = {
    decision: createPreviewInspectorNeuralChoicePathDecision(path, currentState.id, 0),
    fromStateId: currentState.id,
    pathId: path.id,
    steps: mergedSteps,
  };
  schedulePreviewInspectorNeuralChoicePathObservation(searchKind);
  return true;
}

/** Cancels a pending edge when its admitted page action could not execute. */
function cancelPreviewInspectorNeuralChoicePathSelection(searchKind = 'user') {
  const search = initializePreviewInspectorNeuralChoicePathSearch(searchKind);
  search.pending = undefined;
}

/** Waits for two commit boundaries before judging an unchanged page state as failure. */
function schedulePreviewInspectorNeuralChoicePathObservation(searchKind = 'user') {
  const revision = previewEntryRevision;
  const schedule = typeof schedulePreviewInspectorNeuralAssistanceFrame === 'function'
    ? schedulePreviewInspectorNeuralAssistanceFrame
    : (callback) => (globalThis.queueMicrotask ?? ((task) => Promise.resolve().then(task)))(callback);
  schedule(() => schedule(() => {
    if (revision !== previewEntryRevision) return;
    const choices = searchKind === 'automatic' &&
        typeof readPreviewInspectorNeuralPageGenerationChoices === 'function'
      ? readPreviewInspectorNeuralPageGenerationChoices()
      : readPreviewInspectorNeuralUserChoices({ explicitOnly: true });
    observePreviewInspectorNeuralChoicePathState(choices, true, searchKind);
    if (typeof notifyPreviewInspector === 'function') notifyPreviewInspector();
  }));
}
`;
}
