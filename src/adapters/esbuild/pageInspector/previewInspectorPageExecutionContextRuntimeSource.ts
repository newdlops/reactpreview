/** Generates live page-owner verification and neural Page Execution context recovery. */
export function createPreviewInspectorPageExecutionContextRuntimeSource(): string {
  return String.raw`
const previewInspectorFullPageExecutionFidelities = new Set([
  'route-page-authentic',
  'route-page-sliced',
  'page-authentic',
  'page-sliced',
]);
const previewInspectorTransientPageExecutionTargetWords = Object.freeze([
  'fallback',
  'loader',
  'loading',
  'pending',
  'placeholder',
  'progress',
  'shimmer',
  'skeleton',
  'spinner',
]);
const PREVIEW_INSPECTOR_PAGE_EXECUTION_CONTEXT_RECORD_LIMIT = 24;

/** Keeps temporary loading surfaces on the stricter authored-owner and temporal contract. */
function isPreviewInspectorTransientPageExecutionTarget(descriptor, candidate, state) {
  const target = candidate?.target ?? descriptor?.inspector?.target;
  const semanticText = [
    descriptor?.displayName,
    target?.exportName,
    typeof target?.sourcePath === 'string'
      ? target.sourcePath.split(/[\\/]/u).at(-1)
      : undefined,
    state?.targetExportName,
  ].filter((value) => typeof value === 'string').join(' ').toLowerCase();
  return previewInspectorTransientPageExecutionTargetWords.some((word) =>
    semanticText.includes(word));
}

/** Normalizes authored and runtime owner spellings without trusting display punctuation. */
function normalizePreviewInspectorPageExecutionOwnerName(value) {
  return typeof value === 'string'
    ? value.replace(/^@/u, '').replace(/[^\p{L}\p{N}]+/gu, '').toLowerCase()
    : '';
}

/** Matches wrappers whose runtime display names retain a source-proven owner identity. */
function matchesPreviewInspectorPageExecutionOwnerName(expected, actual) {
  const left = normalizePreviewInspectorPageExecutionOwnerName(expected);
  const right = normalizePreviewInspectorPageExecutionOwnerName(actual);
  if (left.length === 0 || right.length === 0) return false;
  if (left === right) return true;
  return Math.min(left.length, right.length) >= 4 && (
    left.startsWith(right) || left.endsWith(right) ||
    right.startsWith(left) || right.endsWith(left)
  );
}

/** Rejects compiler placeholders that cannot prove an authored page owner at runtime. */
function isPreviewInspectorPageExecutionOwnerAnchor(value, targetExportName) {
  const normalized = normalizePreviewInspectorPageExecutionOwnerName(value);
  return normalized.length > 0 &&
    !['anonymous', 'default', 'reactroot'].includes(normalized) &&
    !matchesPreviewInspectorPageExecutionOwnerName(value, targetExportName);
}

/** Recovers a useful component identity when an authored module uses a default export. */
function readPreviewInspectorPageExecutionSourceName(value) {
  if (typeof value !== 'string') return undefined;
  const fileName = value.split(/[\\/]/u).at(-1);
  if (typeof fileName !== 'string') return undefined;
  const name = fileName.replace(/\.[^.]+$/u, '');
  return name.length > 0 && name !== 'index' ? name : undefined;
}

/** Accepts an outer page only from compiler completeness, an app entry, or framework route proof. */
function isPreviewInspectorCompletePageCandidateContext(candidate) {
  const routeEvidence = candidate?.routeLocation?.evidenceKind;
  const virtualPageMode = candidate?.virtualPage?.mode;
  return candidate?.complete === true ||
    candidate?.renderPath?.entryPoint !== undefined ||
    [
      'next-app-filesystem',
      'next-pages-filesystem',
      'next-pages-synthetic',
    ].includes(routeEvidence) ||
    ['next-app-filesystem', 'next-pages-filesystem'].includes(virtualPageMode);
}

/** Reads the real Fiber ancestors above the exact target boundary, never a static display tree. */
function collectPreviewInspectorPageExecutionAncestorNames(state) {
  if (
    typeof readPreviewInspectorTargetBoundaries !== 'function' ||
    typeof readPreviewInspectorBoundaryFiber !== 'function' ||
    typeof readPreviewInspectorFiberLink !== 'function' ||
    typeof classifyPreviewInspectorFiber !== 'function' ||
    typeof namePreviewInspectorFiber !== 'function'
  ) return [];
  const boundaries = readPreviewInspectorTargetBoundaries(state);
  if (!(boundaries instanceof Set)) return [];
  let longest = [];
  for (const boundary of boundaries) {
    let fiber = readPreviewInspectorFiberLink(
      readPreviewInspectorBoundaryFiber(boundary),
      'return',
    );
    const visited = new Set();
    const nearestFirst = [];
    for (let depth = 0; fiber !== undefined && depth < 64 && !visited.has(fiber); depth += 1) {
      visited.add(fiber);
      const kind = classifyPreviewInspectorFiber(fiber);
      const name = namePreviewInspectorFiber(fiber, kind);
      const viewerOwned = typeof isPreviewInspectorOwnedFiber === 'function' &&
        isPreviewInspectorOwnedFiber(fiber, name, kind);
      if (
        ['class', 'forward-ref', 'function', 'lazy', 'memo'].includes(kind) &&
        !viewerOwned && typeof name === 'string' && name.length > 0 && name.length <= 160 &&
        !nearestFirst.includes(name)
      ) nearestFirst.push(name);
      fiber = readPreviewInspectorFiberLink(fiber, 'return');
    }
    const rootFirst = nearestFirst.reverse();
    if (rootFirst.length > longest.length) longest = rootFirst;
  }
  return longest.slice(-48);
}

/**
 * Joins compiler fidelity with live owner evidence. A mounted generated boundary proves only that
 * some execution root committed; this observation additionally proves the original page root is
 * above the selected target in the same Fiber corridor.
 */
function readPreviewInspectorPageExecutionContextObservation(descriptor, candidate, state) {
  const execution = readSelectedPreviewInspectorPageExecutionCandidate(descriptor);
  const fidelity = typeof execution?.fidelity === 'string' ? execution.fidelity : 'legacy-page';
  const componentOnly = execution?.standaloneTarget === true ||
    ['target-contextual', 'target-only'].includes(fidelity);
  const pageCandidateComplete = isPreviewInspectorCompletePageCandidateContext(candidate);
  const pageLevel = execution === undefined
    ? state?.directTarget !== true && candidate !== undefined
    : previewInspectorFullPageExecutionFidelities.has(fidelity);
  const targetExportName = String(
    state?.targetExportName ?? candidate?.target?.exportName ??
      previewInspectorSession.selectedExportName ?? '',
  );
  const applicationPath = (Array.isArray(state?.applicationPath) ? state.applicationPath : [])
    .filter((name) => typeof name === 'string' && name.length > 0)
    .slice(0, 48);
  const expectedOwnerNames = applicationPath.filter((name) =>
    isPreviewInspectorPageExecutionOwnerAnchor(name, targetExportName));
  const observedOwnerNames = collectPreviewInspectorPageExecutionAncestorNames(state);
  const rootStep = Number.isSafeInteger(candidate?.rootStepIndex)
    ? candidate?.renderPath?.steps?.[candidate.rootStepIndex]
    : undefined;
  const pageRootNames = [];
  for (const name of [
    execution?.pageRootExportName,
    candidate?.root?.exportName,
    rootStep?.label,
    readPreviewInspectorPageExecutionSourceName(candidate?.root?.sourcePath),
    readPreviewInspectorPageExecutionSourceName(execution?.pageRootSourcePath),
  ]) {
    if (
      isPreviewInspectorPageExecutionOwnerAnchor(name, targetExportName) &&
      !pageRootNames.some((retained) =>
        matchesPreviewInspectorPageExecutionOwnerName(retained, name))
    ) pageRootNames.push(name);
  }
  const executionRootName = [
    execution?.executionRootExportName,
    readPreviewInspectorPageExecutionSourceName(execution?.executionRootSourcePath),
    readPreviewInspectorPageExecutionSourceName(candidate?.root?.sourcePath),
  ].find((name) => isPreviewInspectorPageExecutionOwnerAnchor(name, targetExportName));
  const matchesObserved = (expected) => observedOwnerNames.some((actual) =>
    matchesPreviewInspectorPageExecutionOwnerName(expected, actual));
  const pageRootObserved = pageRootNames.length === 0
    ? observedOwnerNames.length > 0
    : pageRootNames.some(matchesObserved);
  const executionRootObserved = executionRootName === undefined || matchesObserved(executionRootName);
  const matchedOwnerNames = expectedOwnerNames.filter(matchesObserved);
  const missingOwnerNames = expectedOwnerNames.filter((name) => !matchesObserved(name));
  const transientTarget = isPreviewInspectorTransientPageExecutionTarget(
    descriptor,
    candidate,
    state,
  );
  const generatedRouteContextObserved = transientTarget !== true &&
    execution?.ownsGeneratedRouter === true && execution?.targetRole !== 'error-element' &&
    state?.pageRootCommitted === true && state?.targetHasOutput === true &&
    state?.targetDirectElementOutput === true &&
    (state?.targetMounted === true || state?.targetWasMounted === true);
  const contextComplete = state?.directTarget === true ||
    pageCandidateComplete && pageLevel && !componentOnly && pageRootObserved &&
      executionRootObserved;
  return Object.freeze({
    authoredOwnerDepth: Number.isSafeInteger(execution?.authoredOwnerDepth)
      ? execution.authoredOwnerDepth
      : applicationPath.length,
    componentOnly,
    contextComplete,
    executionCandidateId: execution?.id,
    executionRootName,
    executionRootObserved,
    fidelity,
    generatedRouteContextObserved,
    matchedOwnerCount: matchedOwnerNames.length,
    missingOwnerNames: Object.freeze(missingOwnerNames.slice(0, 24)),
    observedOwnerNames: Object.freeze(observedOwnerNames.slice(0, 48)),
    pageCandidateComplete,
    pageCandidateCompilerComplete: candidate?.complete === true,
    pageCandidateEntryConnected: candidate?.renderPath?.entryPoint !== undefined,
    pageCandidateStopReason: candidate?.stopReason ?? 'unknown',
    pageLevel,
    pageRootNames: Object.freeze(pageRootNames.slice(0, 8)),
    pageRootObserved,
    transientTarget,
  });
}

/** Makes full page context part of target success while preserving legacy direct-target probes. */
function hasPreviewInspectorCompletePageExecutionContext(state) {
  if (state?.directTarget === true || typeof findSelectedPreviewInspectorDescriptor !== 'function') {
    return true;
  }
  const descriptor = findSelectedPreviewInspectorDescriptor();
  const candidate = readSelectedPreviewInspectorPageCandidate(descriptor);
  if (descriptor === undefined || candidate === undefined) return true;
  const observation = readPreviewInspectorPageExecutionContextObservation(
    descriptor,
    candidate,
    state,
  );
  state.pageExecutionContextObservation = observation;
  return observation.contextComplete;
}

/** Reads page-owner evidence only for a committed reachability state that can become a checkpoint. */
function readPreviewInspectorNeuralSuccessPageExecutionContext(state) {
  if (
    state?.pageRootCommitted !== true ||
    typeof findSelectedPreviewInspectorDescriptor !== 'function'
  ) return undefined;
  const descriptor = findSelectedPreviewInspectorDescriptor();
  const candidate = readSelectedPreviewInspectorPageCandidate(descriptor);
  return descriptor === undefined || candidate === undefined
    ? undefined
    : readPreviewInspectorPageExecutionContextObservation(descriptor, candidate, state);
}

/** Keeps component output as an untrained recipe and starts its full-page replay transaction. */
function retainPreviewInspectorIncompletePageExecutionSuccess(state, snapshot, record) {
  if (
    state?.directTarget === true || snapshot?.pageExecutionContext?.contextComplete !== false ||
    typeof findSelectedPreviewInspectorDescriptor !== 'function'
  ) return false;
  if (typeof activatePreviewInspectorNeuralTemporalStateContract === 'function') {
    activatePreviewInspectorNeuralTemporalStateContract(snapshot.temporalState);
  }
  const descriptor = findSelectedPreviewInspectorDescriptor();
  const candidate = readSelectedPreviewInspectorPageCandidate(descriptor);
  if (
    descriptor !== undefined && candidate !== undefined &&
    typeof retainPreviewInspectorNeuralPageContextRecoveryRecipe === 'function'
  ) {
    retainPreviewInspectorNeuralPageContextRecoveryRecipe(
      descriptor,
      candidate,
      state,
      snapshot,
    );
  }
  const requested = descriptor !== undefined && candidate !== undefined &&
    requestPreviewInspectorNeuralPageExecutionContextRecovery(
      descriptor,
      candidate,
      state,
      snapshot,
    );
  record.successCollectionSettled = false;
  record.scheduled = false;
  return requested || state.pageExecutionContextRecoveryRequested === true;
}

/** Lazily owns bounded, page-candidate-local recovery records across execution artifact rebuilds. */
function initializePreviewInspectorPageExecutionContextRecoveryRecords() {
  if (!(previewInspectorSession.neuralPageExecutionContextRecoveryByKey instanceof Map)) {
    previewInspectorSession.neuralPageExecutionContextRecoveryByKey = new Map();
  }
  while (
    previewInspectorSession.neuralPageExecutionContextRecoveryByKey.size >
    PREVIEW_INSPECTOR_PAGE_EXECUTION_CONTEXT_RECORD_LIMIT
  ) {
    previewInspectorSession.neuralPageExecutionContextRecoveryByKey.delete(
      previewInspectorSession.neuralPageExecutionContextRecoveryByKey.keys().next().value,
    );
  }
  return previewInspectorSession.neuralPageExecutionContextRecoveryByKey;
}

/** Uses the reachability identity so another caller/HOC path cannot inherit this repair recipe. */
function createPreviewInspectorPageExecutionContextRecoveryKey(state) {
  return String(state?.key ?? '') + '\0' +
    String(previewInspectorSession.selectedPageCandidateId ?? '') + '\0' +
    String(state?.targetExportName ?? previewInspectorSession.selectedExportName ?? '');
}

/** Returns an active recovery transaction without creating a false recovery UI state. */
function readPreviewInspectorPageExecutionContextRecoveryRecord(state) {
  if (state === undefined) return undefined;
  return initializePreviewInspectorPageExecutionContextRecoveryRecords().get(
    createPreviewInspectorPageExecutionContextRecoveryKey(state),
  );
}

/** Reports the hand-off interval where component output exists but its page owners do not. */
function isPreviewInspectorNeuralPageExecutionContextRecoveryActive(state) {
  const record = readPreviewInspectorPageExecutionContextRecoveryRecord(state);
  return record !== undefined && ['applying', 'searching', 'verifying'].includes(record.status);
}

/** Pauses traversal only while the host is replacing the Page Execution artifact. */
function isPreviewInspectorNeuralPageExecutionContextTransitionPending(state) {
  const record = readPreviewInspectorPageExecutionContextRecoveryRecord(state);
  return record?.status === 'applying' &&
    typeof record.pendingExecutionCandidateId === 'string';
}

/** Reports that every admitted full-page artifact failed with the retained component recipe. */
function isPreviewInspectorNeuralPageExecutionContextRecoveryExhausted(state) {
  return readPreviewInspectorPageExecutionContextRecoveryRecord(state)?.status === 'exhausted';
}

/** Gives page-level execution alternatives to the existing local residual head. */
function createPreviewInspectorPageExecutionContextDecision(
  descriptor,
  execution,
  index,
  observation,
) {
  if (typeof createPreviewInspectorNeuralResidualDecision !== 'function') return undefined;
  const fidelityRanks = {
    'route-page-authentic': 0,
    'route-page-sliced': 1,
    'page-authentic': 2,
    'page-sliced': 3,
  };
  return createPreviewInspectorNeuralResidualDecision({
    blockerKind: 'page-context',
    candidateId: 'page-execution:' + hashPreviewInspectorNeuralPageContextCandidateId(
      String(execution?.id ?? ''),
    ).toString(16).padStart(8, '0'),
    holeKind: 'page-execution-context',
    numbers: {
      authoredOwnerDepth: Number(execution?.authoredOwnerDepth) || 0,
      compilerRank: index,
      fidelityRank: fidelityRanks[execution?.fidelity] ?? 9,
      missingOwnerCount: observation?.missingOwnerNames?.length ?? 0,
      nestedMountCount: Number(execution?.nestedMountCount) || 0,
    },
    texts: [
      execution?.executionRootExportName,
      execution?.pageRootExportName,
      observation?.missingOwnerNames?.join(' '),
      descriptor?.inspector?.target?.exportName,
    ],
    tokens: [
      'compiler-admitted:true',
      'full-page-execution:true',
      'fidelity:' + String(execution?.fidelity ?? 'unknown'),
      'page-root:' + String(execution?.pageRootExportName ?? 'unknown'),
      'execution-root:' + String(execution?.executionRootExportName ?? 'unknown'),
    ],
  });
}

/** Selects an untried full-page artifact; learned outcomes may reorder the fidelity baseline. */
function selectPreviewInspectorNeuralPageExecutionContextCandidate(
  descriptor,
  record,
  observation,
) {
  const candidates = Array.isArray(descriptor?.inspector?.pageExecutionCandidates)
    ? descriptor.inspector.pageExecutionCandidates
    : [];
  const eligible = candidates.filter((execution) =>
    typeof execution?.id === 'string' &&
    previewInspectorFullPageExecutionFidelities.has(execution.fidelity) &&
    !record.attemptedExecutionCandidateIds.has(execution.id));
  if (eligible.length === 0) return undefined;
  const indexed = new Map(candidates.map((execution, index) => [execution?.id, index]));
  const fidelityRanks = {
    'route-page-authentic': 0,
    'route-page-sliced': 1,
    'page-authentic': 2,
    'page-sliced': 3,
  };
  const portfolio = eligible.map((execution) => {
    const index = indexed.get(execution.id) ?? 0;
    const decision = createPreviewInspectorPageExecutionContextDecision(
      descriptor,
      execution,
      index,
      observation,
    );
    if (decision !== undefined) record.decisionByExecutionCandidateId.set(execution.id, decision);
    return {
      deterministicRank: (fidelityRanks[execution.fidelity] ?? 9) * 100 + index,
      id: 'page-execution:' + hashPreviewInspectorNeuralPageContextCandidateId(execution.id)
        .toString(16).padStart(8, '0'),
      numbers: {
        authoredOwnerDepth: Number(execution.authoredOwnerDepth) || 0,
        compilerRank: index,
        fidelityRank: fidelityRanks[execution.fidelity] ?? 9,
        nestedMountCount: Number(execution.nestedMountCount) || 0,
      },
      runtimeExecutionCandidateId: execution.id,
      texts: [execution.executionRootExportName, execution.pageRootExportName],
      tokens: ['fidelity:' + String(execution.fidelity)],
    };
  });
  const specification = {
    blockerKind: 'page-context',
    holeKind: 'page-execution-context',
    numbers: {
      candidateCount: candidates.length,
      missingOwnerCount: observation?.missingOwnerNames?.length ?? 0,
    },
    texts: [observation?.missingOwnerNames?.join(' ')],
    tokens: ['component-output-found:true', 'page-context-missing:true'],
  };
  const selected = typeof selectPreviewInspectorNeuralResidualCandidate === 'function'
    ? selectPreviewInspectorNeuralResidualCandidate(specification, portfolio)
    : undefined;
  const selectedInput = portfolio.find((input) => input.id === selected?.candidateId) ??
    [...portfolio].sort((left, right) => left.deterministicRank - right.deterministicRank)[0];
  const execution = eligible.find((candidate) =>
    candidate.id === selectedInput?.runtimeExecutionCandidateId) ?? eligible[0];
  return {
    decision: selected?.decision ?? record.decisionByExecutionCandidateId.get(execution.id),
    execution,
  };
}

/** Teaches only whether an execution candidate restored the missing page-owner corridor. */
function settlePreviewInspectorNeuralPageExecutionContextOutcome(state, success) {
  const record = readPreviewInspectorPageExecutionContextRecoveryRecord(state);
  if (record === undefined) return false;
  const descriptor = typeof findSelectedPreviewInspectorDescriptor === 'function'
    ? findSelectedPreviewInspectorDescriptor()
    : undefined;
  const executionId = descriptor?.inspector?.pageExecutionCandidateId;
  if (!(record.outcomeByExecutionCandidateId instanceof Map)) {
    record.outcomeByExecutionCandidateId = new Map();
  }
  if (record.outcomeByExecutionCandidateId.get(executionId) === success) return false;
  const decision = record.decisionByExecutionCandidateId.get(executionId);
  const update = decision !== undefined && typeof trainPreviewInspectorNeuralResidualDecision === 'function'
    ? trainPreviewInspectorNeuralResidualDecision(decision, success ? 1 : 0)
    : undefined;
  if (typeof executionId === 'string') record.attemptedExecutionCandidateIds.add(executionId);
  if (typeof executionId === 'string') record.outcomeByExecutionCandidateId.set(executionId, success);
  record.activeExecutionCandidateId = executionId;
  record.pendingExecutionCandidateId = undefined;
  record.status = success ? 'verified' : 'searching';
  if (typeof recordPreviewInspectorRuntimeHealth === 'function') {
    recordPreviewInspectorRuntimeHealth({
      category: 'page-context',
      detail: {
        executionCandidateId: executionId,
        headUpdates: update?.headUpdates ?? 0,
        missingOwnerNames: state?.pageExecutionContextObservation?.missingOwnerNames ?? [],
        pageCandidateId: record.pageCandidateId,
        success,
      },
      event: success
        ? 'neural-page-execution-context-verified'
        : 'neural-page-execution-context-rejected',
    });
  }
  return true;
}

/** Posts one exact compiler-owned execution choice while retaining the visible artifact. */
function postPreviewInspectorPageExecutionCandidate(descriptor, candidate, executionCandidateId) {
  if (
    typeof candidate?.id !== 'string' ||
    typeof executionCandidateId !== 'string' ||
    previewInspectorSession.pageExecutionRetryRevision === previewEntryRevision ||
    typeof previewInspectorPostHostMessage !== 'function'
  ) return false;
  previewInspectorSession.pageExecutionRetryRevision = previewEntryRevision;
  previewInspectorPostHostMessage({
    candidateId: candidate.id,
    executionCandidateId,
    interactionId: 'execution:' + String(readPreviewInspectorHostRuntimeRevision()) + ':' +
      String(++previewInspectorSession.interactionSequence),
    runtimeRevision: readPreviewInspectorHostRuntimeRevision(),
    type: 'react-preview-inspector-page-execution-retry',
  });
  return true;
}

/**
 * Turns component-only output into a repair recipe, then replays it through a finite neural search
 * over compiler-proven full-page artifacts. The same recipe never restarts an exhausted cycle.
 */
function requestPreviewInspectorNeuralPageExecutionContextRecovery(
  descriptor,
  candidate,
  state,
  snapshot,
) {
  if (state?.directTarget === true || snapshot === undefined) return false;
  const observation = readPreviewInspectorPageExecutionContextObservation(
    descriptor,
    candidate,
    state,
  );
  state.pageExecutionContextObservation = observation;
  if (observation.contextComplete) return false;
  const records = initializePreviewInspectorPageExecutionContextRecoveryRecords();
  const key = createPreviewInspectorPageExecutionContextRecoveryKey(state);
  let record = records.get(key);
  if (record === undefined || record.status === 'verified') {
    record = {
      attemptedExecutionCandidateIds: new Set(),
      decisionByExecutionCandidateId: new Map(),
      key,
      outcomeByExecutionCandidateId: new Map(),
      pageCandidateId: candidate?.id,
      reachabilityKey: state.key,
      recipeSnapshot: snapshot,
      recipeSnapshotFingerprint: snapshot.fingerprint,
      status: 'searching',
    };
    records.set(key, record);
  }
  if (!observation.pageCandidateComplete) {
    record.status = 'exhausted';
    state.pageExecutionContextRecoveryRequested = true;
    state.status = 'page-context-incomplete';
    return false;
  }
  if (record.status === 'exhausted' &&
      record.recipeSnapshotFingerprint === snapshot.fingerprint) {
    state.pageExecutionContextRecoveryRequested = true;
    state.status = 'page-context-incomplete';
    return false;
  }
  if (record.status === 'exhausted') {
    record.attemptedExecutionCandidateIds = new Set();
    record.decisionByExecutionCandidateId = new Map();
    record.outcomeByExecutionCandidateId = new Map();
    record.recipeSnapshot = snapshot;
    record.recipeSnapshotFingerprint = snapshot.fingerprint;
    record.status = 'searching';
  }
  if (typeof record.pendingExecutionCandidateId === 'string') {
    state.pageExecutionContextRecoveryRequested = true;
    state.status = 'recovering-page-context';
    return true;
  }
  const currentExecutionId = descriptor?.inspector?.pageExecutionCandidateId;
  if (
    typeof currentExecutionId === 'string' &&
    previewInspectorFullPageExecutionFidelities.has(observation.fidelity) &&
    record.attemptedExecutionCandidateIds.has(currentExecutionId)
  ) settlePreviewInspectorNeuralPageExecutionContextOutcome(state, false);
  const selected = selectPreviewInspectorNeuralPageExecutionContextCandidate(
    descriptor,
    record,
    observation,
  );
  if (selected?.execution?.id === undefined) {
    record.status = 'exhausted';
    state.pageExecutionContextRecoveryRequested = true;
    state.status = 'page-context-incomplete';
    if (typeof setPreviewInspectorNeuralNeedsChoiceStatus === 'function') {
      setPreviewInspectorNeuralNeedsChoiceStatus('full-page-context-paths-exhausted');
    }
    return false;
  }
  if (!postPreviewInspectorPageExecutionCandidate(
    descriptor,
    candidate,
    selected.execution.id,
  )) return false;
  record.attemptedExecutionCandidateIds.add(selected.execution.id);
  if (selected.decision !== undefined) {
    record.decisionByExecutionCandidateId.set(selected.execution.id, selected.decision);
  }
  record.pendingExecutionCandidateId = selected.execution.id;
  record.status = 'applying';
  state.pageExecutionContextRecoveryRequested = true;
  state.status = 'recovering-page-context';
  if (typeof setPreviewInspectorNeuralLearningStatus === 'function') {
    setPreviewInspectorNeuralLearningStatus({
      activeCount: 1,
      labelReason: 'component-output-found-restoring-full-page-context',
      phase: 'applying',
      successCount: 0,
      updates: typeof readPreviewInspectorNeuralLearningModelUpdates === 'function'
        ? readPreviewInspectorNeuralLearningModelUpdates()
        : 0,
    });
  }
  return true;
}

/** Continues a recovery search after one full-page artifact failed before target verification. */
function continuePreviewInspectorNeuralPageExecutionContextRecovery(descriptor, candidate) {
  if (typeof readPreviewInspectorTargetReachabilityState !== 'function') return false;
  const state = readPreviewInspectorTargetReachabilityState(descriptor, candidate);
  const record = readPreviewInspectorPageExecutionContextRecoveryRecord(state);
  if (record === undefined || !['applying', 'searching', 'verifying'].includes(record.status)) {
    return false;
  }
  settlePreviewInspectorNeuralPageExecutionContextOutcome(state, false);
  return requestPreviewInspectorNeuralPageExecutionContextRecovery(
    descriptor,
    candidate,
    state,
    record.recipeSnapshot,
  );
}

/** Restores the inner success recipe after the host commits the requested full-page artifact. */
function activatePreviewInspectorNeuralPageExecutionContextRecovery(descriptor) {
  const executionId = descriptor?.inspector?.pageExecutionCandidateId;
  const pageCandidateId = descriptor?.inspector?.executablePageCandidateId ??
    previewInspectorSession.selectedPageCandidateId;
  if (typeof executionId !== 'string') return false;
  const records = initializePreviewInspectorPageExecutionContextRecoveryRecords();
  const record = [...records.values()].find((candidateRecord) =>
    candidateRecord.pageCandidateId === pageCandidateId &&
    candidateRecord.pendingExecutionCandidateId === executionId &&
    candidateRecord.status === 'applying');
  if (record === undefined) return false;
  record.activeExecutionCandidateId = executionId;
  record.pendingExecutionCandidateId = undefined;
  record.status = 'verifying';
  if (typeof restorePreviewInspectorNeuralPageGenerationBaseline !== 'function') return false;
  return restorePreviewInspectorNeuralPageGenerationBaseline(record.recipeSnapshot);
}

/** Defers recipe restoration until descriptor reconciliation has installed the new artifact. */
function schedulePreviewInspectorNeuralPageExecutionContextRecoveryActivation(descriptor) {
  previewInspectorSession.neuralPageExecutionContextActivationRevision =
    (Number(previewInspectorSession.neuralPageExecutionContextActivationRevision) || 0) + 1;
  const revision = previewInspectorSession.neuralPageExecutionContextActivationRevision;
  Promise.resolve().then(() => {
    if (previewInspectorSession.neuralPageExecutionContextActivationRevision !== revision) return;
    if (!activatePreviewInspectorNeuralPageExecutionContextRecovery(descriptor)) return;
    if (typeof notifyPreviewInspector === 'function') notifyPreviewInspector();
    if (typeof schedulePreviewInspectorCommitRefresh === 'function') {
      schedulePreviewInspectorCommitRefresh();
    }
    if (typeof schedulePreviewInspectorTreeRefresh === 'function') {
      schedulePreviewInspectorTreeRefresh();
    }
  });
}

`;
}
