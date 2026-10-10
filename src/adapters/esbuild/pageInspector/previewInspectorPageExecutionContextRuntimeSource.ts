/** Generates live page-owner verification and neural Page Execution context recovery. */
import { createPreviewInspectorPageExecutionPreparationRuntimeSource } from './previewInspectorPageExecutionPreparationRuntimeSource';

import { createPreviewInspectorPageExecutionOwnerProofRuntimeSource } from './previewInspectorPageExecutionOwnerProofRuntimeSource';

export {
  PREVIEW_INSPECTOR_EXECUTION_ROOT_BRIDGE_KEY,
  PREVIEW_INSPECTOR_EXECUTION_SURFACES_KEY,
  PREVIEW_INSPECTOR_PAGE_EXECUTION_KEY,
} from './previewInspectorPageExecutionOwnerProofRuntimeSource';

/** Joins compiler/live-owner evidence with the correlated preparation transport. */
export function createPreviewInspectorPageExecutionContextRuntimeSource(): string {
  return String.raw`
${createPreviewInspectorPageExecutionPreparationRuntimeSource()}
${createPreviewInspectorPageExecutionOwnerProofRuntimeSource()}
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
const previewInspectorPageOwnerWrapperPattern = /^[\p{L}_$][\p{L}\p{N}_.$]*\(\s*(.*?)\s*\)$/u;
const previewInspectorPageOwnerInvalidPattern = /[(),]/u;
const previewInspectorPageOwnerSeparatorPattern = /[^\p{L}\p{N}]+/gu;

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

/** Unwraps bounded HOC display names without confusing arbitrary prefixes/suffixes for identity. */
function normalizePreviewInspectorPageExecutionOwnerName(value) {
  if (typeof value !== 'string' || value.length > 512) return '';
  let name = value.trim();
  for (let depth = 0; depth < 8; depth += 1) {
    const wrapper = previewInspectorPageOwnerWrapperPattern.exec(name);
    if (wrapper === null) break;
    name = wrapper[1].trim();
  }
  if (previewInspectorPageOwnerInvalidPattern.test(name)) return '';
  return name.replace(previewInspectorPageOwnerSeparatorPattern, '').toLowerCase();
}

/** Matches wrappers whose runtime display names retain a source-proven owner identity. */
function matchesPreviewInspectorPageExecutionOwnerName(expected, actual) {
  const left = normalizePreviewInspectorPageExecutionOwnerName(expected);
  const right = normalizePreviewInspectorPageExecutionOwnerName(actual);
  return left.length > 0 && left === right;
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
  // Only a full-page artifact's bridge proves its authored page root; target-only and contextual
  // executions also render through a bridge.
  const fullPageExecution = previewInspectorFullPageExecutionFidelities.has(fidelity);
  // A target mounted beside the authentic page (closed modal content) has sibling owners.
  const detachedOwners = fullPageExecution &&
    readPreviewInspectorDetachedTargetPlacement(candidate) !== undefined
    ? collectPreviewInspectorDetachedExecutionOwners(state)
    : undefined;
  const executionRootMounted = fullPageExecution && (
    isPreviewInspectorExecutionRootMountedAboveTarget(state) ||
    detachedOwners?.bridgeMounted === true
  );
  const mountedSurfaceKeys = fullPageExecution
    ? new Set([
        ...collectPreviewInspectorMountedExecutionSurfaceKeys(state),
        ...(detachedOwners?.keys ?? []),
      ])
    : new Set();
  const isMountedOwnerReference = (sourcePath, exportName) => (
    executionRootMounted &&
    isPreviewInspectorExecutionRootReference(execution, sourcePath, exportName)
  ) || mountedSurfaceKeys.has(createPreviewInspectorExecutionSurfaceKey(sourcePath, exportName));
  const rootStep = Number.isSafeInteger(candidate?.rootStepIndex)
    ? candidate?.renderPath?.steps?.[candidate.rootStepIndex]
    : undefined;
  const executionPageRootPath = execution?.pageRootSourcePath;
  const samePageRoot = (executionPageRootPath === undefined ||
    executionPageRootPath === candidate?.root?.sourcePath) &&
    (execution?.pageRootExportName === undefined ||
      execution.pageRootExportName === candidate?.root?.exportName);
  const pageRootNames = [];
  // A default export's declared name (RootLayout, MyApp) is what React mounts; the file name
  // (layout, _app) only remains an alias for roots whose name the compiler could not prove.
  for (const name of [
    execution?.pageRootComponentName,
    execution?.pageRootExportName,
    ...(samePageRoot ? [
      candidate?.root?.exportName,
      rootStep?.sourcePath === undefined || rootStep.sourcePath === candidate?.root?.sourcePath
        ? rootStep?.label : undefined,
      isPreviewInspectorPageExecutionOwnerAnchor(candidate?.root?.exportName, targetExportName)
        ? undefined : readPreviewInspectorPageExecutionSourceName(candidate?.root?.sourcePath),
    ] : []),
    isPreviewInspectorPageExecutionOwnerAnchor(execution?.pageRootExportName, targetExportName)
      ? undefined : readPreviewInspectorPageExecutionSourceName(execution?.pageRootSourcePath),
  ]) {
    if (
      isPreviewInspectorPageExecutionOwnerAnchor(name, targetExportName) &&
      !pageRootNames.some((retained) =>
        matchesPreviewInspectorPageExecutionOwnerName(retained, name))
    ) pageRootNames.push(name);
  }
  const executionRootName = [
    execution?.executionRootExportName,
    execution?.executionRootComponentName,
    readPreviewInspectorPageExecutionSourceName(execution?.executionRootSourcePath),
    readPreviewInspectorPageExecutionSourceName(candidate?.root?.sourcePath),
  ].find((name) => isPreviewInspectorPageExecutionOwnerAnchor(name, targetExportName));
  const observedOwnerIdentities = new Set(observedOwnerNames
    .map(normalizePreviewInspectorPageExecutionOwnerName).filter(Boolean));
  const matchesObserved = (expected) => observedOwnerIdentities.has(
    normalizePreviewInspectorPageExecutionOwnerName(expected));
  const pageRootObserved =
    isMountedOwnerReference(execution?.pageRootSourcePath, execution?.pageRootExportName) || (
      pageRootNames.length === 0
        ? observedOwnerNames.length > 0
        : pageRootNames.some(matchesObserved)
    );
  const executionRootObserved = executionRootName === undefined ||
    matchesObserved(executionRootName) || executionRootMounted ||
    isMountedOwnerReference(execution?.executionRootSourcePath, execution?.executionRootExportName);
  // Static outer owners/layouts are a contract, not alternate aliases for an inner content root.
  // Siblings are not ancestors; their placement remains compiler-owned.
  const pageFrames = (Array.isArray(candidate?.virtualPage?.shells)
    ? candidate.virtualPage.shells : [])
    .filter((shell) => ['owner', 'wrapper'].includes(shell?.relation))
    .map((shell) => ({
      aliases: [shell?.root?.exportName,
        readPreviewInspectorPageExecutionSourceName(shell?.root?.sourcePath)]
        .filter((name) => isPreviewInspectorPageExecutionOwnerAnchor(name, targetExportName)),
      root: shell?.root,
    }))
    .filter((frame) => frame.aliases.length > 0)
    .slice(0, 24);
  const pageFrameNames = pageFrames.map((frame) => frame.aliases[0]);
  const missingPageFrameNames = pageFrames
    .filter((frame) =>
      !isMountedOwnerReference(frame.root?.sourcePath, frame.root?.exportName) &&
      !frame.aliases.some(matchesObserved))
    .map((frame) => frame.aliases[0]);
  const pageFrameObserved = missingPageFrameNames.length === 0;
  const matchedOwnerNames = expectedOwnerNames.filter(matchesObserved);
  const missingOwnerNames = [...new Set([
    ...missingPageFrameNames,
    ...expectedOwnerNames.filter((name) => !matchesObserved(name)),
  ])];
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
  // The selected file is the page root its entry renders (an App under main.tsx). Its target-only
  // execution is then the whole page: the entry's providers are emulated for every page alike.
  const samePath = (left, right) => typeof left === 'string' && typeof right === 'string' &&
    left.replaceAll('\\', '/') === right.replaceAll('\\', '/');
  const targetIsPageRoot = fidelity === 'target-only' && execution?.standaloneTarget !== true &&
    pageCandidateComplete && pageFrames.length === 0 &&
    execution?.executionRootSurfaceId === execution?.runtimeTargetSurfaceId &&
    candidate?.root?.exportName === (candidate?.target?.exportName ?? targetExportName) &&
    samePath(candidate?.root?.sourcePath, candidate?.target?.sourcePath ?? state?.targetSourcePath);
  const contextComplete = state?.directTarget === true || targetIsPageRoot ||
    pageCandidateComplete && pageLevel && !componentOnly && pageRootObserved &&
      executionRootObserved && pageFrameObserved;
  return Object.freeze({
    authoredOwnerDepth: Number.isSafeInteger(execution?.authoredOwnerDepth)
      ? execution.authoredOwnerDepth
      : applicationPath.length,
    componentOnly,
    contextComplete,
    executionCandidateId: execution?.id,
    executionRootMounted,
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
    pageFrameObserved,
    pageFrameNames: Object.freeze(pageFrameNames),
    pageRootNames: Object.freeze(pageRootNames.slice(0, 8)),
    pageRootObserved,
    targetIsPageRoot,
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

/** Uses only compiler-stable identities so execution artifacts share one finite repair recipe. */
function createPreviewInspectorPageExecutionContextRecoveryKey(state) {
  const candidateId = state?.candidateId ?? previewInspectorSession.selectedPageCandidateId;
  const targetSourcePath = typeof state?.targetSourcePath === 'string'
    ? state.targetSourcePath.replaceAll('\\', '/')
    : '';
  return String(candidateId ?? '') + '\0' + targetSourcePath + '\0' +
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

/** Stops unrelated gate traversal after a failed handoff without claiming that every render failed. */
function isPreviewInspectorPageExecutionPreparationBlocked(state) {
  const record = readPreviewInspectorPageExecutionContextRecoveryRecord(state);
  return record?.status === 'preparation-blocked' &&
    record.preparationBlockedRevision === previewEntryRevision;
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
  const verifiedFailures = record.outcomeByExecutionCandidateId instanceof Map
    ? [...record.outcomeByExecutionCandidateId.values()].filter((success) => success === false).length
    : 0;
  const selected = typeof selectPreviewInspectorNeuralResidualCandidate === 'function'
    ? selectPreviewInspectorNeuralResidualCandidate(specification, portfolio, verifiedFailures)
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
function settlePreviewInspectorNeuralPageExecutionContextOutcome(
  state,
  success,
  observedExecutionCandidateId,
) {
  const record = readPreviewInspectorPageExecutionContextRecoveryRecord(state);
  if (record === undefined) return false;
  const descriptor = typeof findSelectedPreviewInspectorDescriptor === 'function'
    ? findSelectedPreviewInspectorDescriptor()
    : undefined;
  const executionId = typeof observedExecutionCandidateId === 'string'
    ? observedExecutionCandidateId
    : descriptor?.inspector?.pageExecutionCandidateId;
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

/**
 * Turns component-only output into a repair recipe, then replays it through a finite neural search
 * over compiler-proven full-page artifacts. The same recipe never restarts an exhausted cycle.
 * After a replayed full page failed, its own context observation no longer ends the search.
 */
function requestPreviewInspectorNeuralPageExecutionContextRecovery(
  descriptor,
  candidate,
  state,
  snapshot,
  afterFailedFullPage = false,
) {
  if (typeof isPreviewInspectorNeuralAssistancePaused === 'function' &&
    isPreviewInspectorNeuralAssistancePaused()) return false;
  if (state?.directTarget === true || snapshot === undefined) return false;
  const retained = readPreviewInspectorPageExecutionContextRecoveryRecord(state);
  if (retained?.status === 'preparation-blocked') {
    if (retained.preparationBlockedRevision === previewEntryRevision) {
      state.pageExecutionContextRecoveryRequested = true;
      state.status = 'page-context-incomplete';
      return false;
    }
    retained.status = 'searching';
  }
  if (typeof retained?.pendingExecutionCandidateId === 'string' &&
    retained.pendingExecutionCandidateId !== descriptor?.inspector?.pageExecutionCandidateId) {
    state.pageExecutionContextRecoveryRequested = true;
    state.status = 'recovering-page-context';
    return true;
  }
  const observation = readPreviewInspectorPageExecutionContextObservation(
    descriptor,
    candidate,
    state,
  );
  state.pageExecutionContextObservation = observation;
  if (observation.contextComplete && !afterFailedFullPage) return false;
  const records = initializePreviewInspectorPageExecutionContextRecoveryRecords();
  const key = createPreviewInspectorPageExecutionContextRecoveryKey(state);
  let record = records.get(key);
  if (record === undefined) {
    record = {
      attemptedExecutionCandidateIds: new Set(),
      decisionByExecutionCandidateId: new Map(),
      key,
      outcomeByExecutionCandidateId: new Map(),
      pageCandidateId: candidate?.id,
      reachabilityKey: state.key,
      recipeSnapshot: snapshot,
      status: 'searching',
    };
    records.set(key, record);
  }
  // The verified component-only artifact is where a failed full-page replay returns.
  if (observation.componentOnly === true && state.targetHasOutput === true &&
    typeof descriptor?.inspector?.pageExecutionCandidateId === 'string') {
    record.componentOutputExecutionCandidateId ??= descriptor.inspector.pageExecutionCandidateId;
  }
  if (!observation.pageCandidateComplete) {
    record.status = 'exhausted';
    state.pageExecutionContextRecoveryRequested = true;
    state.status = 'page-context-incomplete';
    return false;
  }
  // The finite compiler-candidate budget is monotonic for this target and public page path.
  // Automatic hook/data repairs legitimately change the success snapshot between artifacts; using
  // that mutable fingerprint to refill the budget admits page-authentic -> page-sliced ->
  // page-authentic forever. A different target, export, or public candidate receives a different
  // recovery key, while a fresh webview session receives a fresh bounded search.
  if (record.status === 'exhausted') {
    state.pageExecutionContextRecoveryRequested = true;
    state.status = 'page-context-incomplete';
    return false;
  }
  const currentExecutionId = descriptor?.inspector?.pageExecutionCandidateId;
  if (typeof record.pendingExecutionCandidateId === 'string') {
    if (record.pendingExecutionCandidateId !== currentExecutionId) {
      state.pageExecutionContextRecoveryRequested = true;
      state.status = 'recovering-page-context';
      return true;
    }
    // Descriptor reconciliation can commit the requested artifact before its deferred activation
    // callback runs. Treat the matching live descriptor as the acknowledgement so recovery cannot
    // remain permanently in applying state when that callback loses the revision race.
    reconcilePreviewInspectorPageExecutionPreparation(descriptor);
    record.activeExecutionCandidateId = currentExecutionId;
    record.pendingExecutionCandidateId = undefined;
    record.status = 'verifying';
  }
  // The current full-page artifact produced this incomplete observation. Mark it before ranking so
  // a same-content host rebuild cannot remain pending without advancing the finite candidate set.
  if (
    typeof currentExecutionId === 'string' &&
    previewInspectorFullPageExecutionFidelities.has(observation.fidelity)
  ) settlePreviewInspectorNeuralPageExecutionContextOutcome(state, false, currentExecutionId);
  const selected = selectPreviewInspectorNeuralPageExecutionContextCandidate(
    descriptor,
    record,
    observation,
  );
  if (selected?.execution?.id === undefined) {
    if (requestPreviewInspectorPageExecutionComponentOutputReturn(
      descriptor, candidate, state, record,
    )) return true;
    record.status = 'exhausted';
    state.pageExecutionContextRecoveryRequested = true;
    state.status = 'page-context-incomplete';
    if (typeof setPreviewInspectorNeuralNeedsChoiceStatus === 'function') {
      setPreviewInspectorNeuralNeedsChoiceStatus('full-page-context-paths-exhausted');
    }
    return false;
  }
  return postPreviewInspectorPageExecutionCandidate(
    descriptor,
    candidate,
    selected.execution.id,
    { record, state, decision: selected.decision },
  );
}

/** Continues a recovery search after one full-page artifact failed before target verification. */
function continuePreviewInspectorNeuralPageExecutionContextRecovery(descriptor, candidate) {
  if (typeof readPreviewInspectorTargetReachabilityState !== 'function') return false;
  const state = readPreviewInspectorTargetReachabilityState(descriptor, candidate);
  const record = readPreviewInspectorPageExecutionContextRecoveryRecord(state);
  if (record === undefined || !['applying', 'searching', 'verifying'].includes(record.status)) {
    return false;
  }
  if (isPreviewInspectorNeuralPageExecutionContextTransitionPending(state) &&
    record.pendingExecutionCandidateId !== descriptor?.inspector?.pageExecutionCandidateId) return true;
  settlePreviewInspectorNeuralPageExecutionContextOutcome(state, false);
  return requestPreviewInspectorNeuralPageExecutionContextRecovery(
    descriptor,
    candidate,
    state,
    record.recipeSnapshot,
    true,
  );
}

/**
 * Brings back the verified component-only artifact once every full-page replay failed, instead of
 * leaving the last blocked full page on screen. The host admits it once as a restore of an artifact
 * it already committed; a rejected or repeated return leaves the search where it stopped.
 */
function requestPreviewInspectorPageExecutionComponentOutputReturn(
  descriptor,
  candidate,
  state,
  record,
) {
  const executionId = record?.componentOutputExecutionCandidateId;
  if (
    typeof executionId !== 'string' || record.componentOutputReturnRequested === true ||
    descriptor?.inspector?.pageExecutionCandidateId === executionId
  ) return false;
  const requested = postPreviewInspectorPageExecutionCandidate(
    descriptor,
    candidate,
    executionId,
    { record, state, restore: true },
  );
  if (requested) record.componentOutputReturnRequested = true;
  return requested;
}

/** Restores the inner success recipe after the host commits the requested full-page artifact. */
function activatePreviewInspectorNeuralPageExecutionContextRecovery(descriptor) {
  reconcilePreviewInspectorPageExecutionPreparation(descriptor);
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
  reconcilePreviewInspectorPageExecutionPreparation(descriptor);
  previewInspectorSession.neuralPageExecutionContextActivationRevision =
    (Number(previewInspectorSession.neuralPageExecutionContextActivationRevision) || 0) + 1;
  const revision = previewInspectorSession.neuralPageExecutionContextActivationRevision;
  Promise.resolve().then(() => {
    if (previewInspectorSession.neuralPageExecutionContextActivationRevision !== revision) return;
    if (typeof isPreviewInspectorNeuralAssistancePaused === 'function' && isPreviewInspectorNeuralAssistancePaused()) return;
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
