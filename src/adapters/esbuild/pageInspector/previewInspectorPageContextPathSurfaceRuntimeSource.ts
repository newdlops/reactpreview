/** Generates the canonical page-context path status and alternatives surface. */
export function createPreviewInspectorPageContextPathSurfaceRuntimeSource(): string {
  return String.raw`
/** Returns every distinct source-proven wrapper path with its retained mount variants. */
function readPreviewInspectorPageContextPossibilities(descriptor) {
  const candidates = readPreviewInspectorPageCandidates(descriptor);
  if (candidates.length === 0) return [];
  const inventory = createPreviewInspectorPageContextPathInventory(candidates);
  const record = readPreviewInspectorNeuralPageContextRecord(descriptor);
  const activeId = previewInspectorSession.selectedPageCandidateId;
  const pendingId = previewInspectorSession.pendingPageCandidateId;
  const queuedId = previewInspectorSession.queuedPageCandidateId;
  const userId = previewInspectorSession.userSelectedPageCandidateId;
  return inventory.groups.map((group, index) => {
    const candidateIds = group.candidates.map((candidate) => candidate.id);
    const contains = (candidateId) =>
      typeof candidateId === 'string' && candidateIds.includes(candidateId);
    const evaluatedVariantCount = candidateIds.filter((candidateId) =>
      record?.evaluatedCandidateIds?.has?.(candidateId),
    ).length;
    const failedVariantCount = candidateIds.filter((candidateId) =>
      record?.failedCandidateIds?.has?.(candidateId),
    ).length;
    const executionContracts = candidateIds.flatMap((candidateId) => {
      const contract = record?.executionContractByCandidateId?.get?.(candidateId);
      return contract === undefined ? [] : [contract];
    });
    const executionContractConditionCount = executionContracts.reduce(
      (maximum, contract) => Math.max(
        maximum,
        Array.isArray(contract?.snapshot?.conditionEntries)
          ? contract.snapshot.conditionEntries.length
          : 0,
      ),
      0,
    );
    const executionContractValueCount = executionContracts.reduce(
      (maximum, contract) => Math.max(
        maximum,
        (contract?.snapshot?.dataPayloadEntries?.length ?? 0) +
          (contract?.snapshot?.runtimeFallbackValueEntries?.length ?? 0) +
          Number(contract?.snapshot?.hasResolverProps === true),
      ),
      0,
    );
    const temporalContracts = executionContracts.filter((contract) =>
      contract?.snapshot?.temporalState?.kind === 'transient-checkpoint',
    );
    const temporalSignalCount = temporalContracts.reduce(
      (maximum, contract) => Math.max(
        maximum,
        Number(contract?.snapshot?.temporalState?.signalCount) || 0,
      ),
      0,
    );
    const temporalPinned = candidateIds.some((candidateId) =>
      typeof isPreviewInspectorNeuralTemporalStateContractActive === 'function' &&
      isPreviewInspectorNeuralTemporalStateContractActive(candidateId),
    );
    const temporalReleased = candidateIds.some((candidateId) =>
      typeof isPreviewInspectorNeuralTemporalStateContractReleased === 'function' &&
      isPreviewInspectorNeuralTemporalStateContractReleased(candidateId),
    );
    const stability = candidateIds.reduce((totals, candidateId) => {
      const candidateStability = record?.stabilityByCandidateId?.get?.(candidateId);
      totals.regressionCount += Number(candidateStability?.regressionCount) || 0;
      totals.stableCount += Number(candidateStability?.stableCount) || 0;
      return totals;
    }, { regressionCount: 0, stableCount: 0 });
    const checkingCandidate = group.candidates.find((candidate) =>
      record?.provisionalCandidateIds?.has?.(candidate.id),
    );
    const verifiedCandidate = group.candidates.find((candidate) =>
      record?.successfulCandidateIds?.has?.(candidate.id),
    );
    const unstableCandidate = group.candidates.find((candidate) =>
      record?.unstableCandidateIds?.has?.(candidate.id),
    );
    const pendingCandidate = group.candidates.find((candidate) => candidate.id === pendingId);
    const queuedCandidate = group.candidates.find((candidate) => candidate.id === queuedId);
    const activeCandidate = group.candidates.find((candidate) => candidate.id === activeId);
    const unevaluatedAlternative = group.candidates.find((candidate) =>
      candidate.id !== activeId &&
      !record?.failedCandidateIds?.has?.(candidate.id) &&
      !record?.evaluatedCandidateIds?.has?.(candidate.id),
    );
    const availableAlternative = group.candidates.find((candidate) =>
      candidate.id !== activeId && !record?.failedCandidateIds?.has?.(candidate.id),
    );
    const availableCandidate = group.candidates.find((candidate) =>
      !record?.failedCandidateIds?.has?.(candidate.id),
    );
    const representative = queuedCandidate ?? pendingCandidate ?? checkingCandidate ??
      (activeCandidate === undefined
        ? verifiedCandidate ?? availableCandidate ?? unstableCandidate
        : unevaluatedAlternative ?? availableAlternative ?? activeCandidate) ??
      group.candidates[0];
    const profile = createPreviewInspectorPageContextGroupProfile(
      group,
      inventory,
      representative,
    );
    const pending = pendingCandidate !== undefined;
    const queued = queuedCandidate !== undefined;
    const checking = checkingCandidate !== undefined;
    const verified = verifiedCandidate !== undefined;
    const unstable = unstableCandidate !== undefined && !verified;
    const active = activeCandidate !== undefined;
    const rejected = failedVariantCount === candidateIds.length && candidateIds.length > 0;
    const selectable = !queued && !pending && !checking && !rejected &&
      typeof representative?.id === 'string' && representative.id !== activeId;
    const userSelected = contains(userId);
    const modelChoice = contains(record?.selectedCandidateId) &&
      !contains(userId) && ['deterministic', 'neural'].includes(record?.selectionOrigin);
    const state = queued
      ? 'queued'
      : pending
        ? 'applying'
        : temporalPinned
          ? 'transient'
          : temporalReleased
            ? 'resumed'
            : checking
              ? 'checking'
              : verified
            ? 'verified'
            : unstable
              ? 'unstable'
              : userSelected
                ? 'user'
                : modelChoice
                ? 'recommended'
                : active
                  ? 'active'
                  : rejected
                      ? 'rejected'
                      : evaluatedVariantCount > 0
                        ? 'tested'
                        : 'available';
    return {
      active,
      candidateId: representative?.id,
      candidateIds,
      callerNames: profile.callerNames,
      checking,
      conditionalCount: profile.conditionalCount,
      evaluatedVariantCount,
      executionContractCount: executionContracts.length,
      executionContractLabel: executionContracts.length === 0
        ? undefined
        : String(executionContracts.length) + '/' + String(candidateIds.length) +
          ' reproducible mount contract(s)' +
          (executionContractConditionCount + executionContractValueCount === 0
            ? ' · authored values only'
            : ' · up to ' + String(executionContractConditionCount) + ' condition(s), ' +
              String(executionContractValueCount) + ' generated value(s)') +
          (temporalContracts.length === 0
            ? ''
            : ' · ' + String(temporalContracts.length) + ' transient checkpoint(s), up to ' +
              String(temporalSignalCount) + ' time-state signal(s)'),
      failedVariantCount,
      id: group.id,
      index,
      kinds: profile.kinds,
      modelChoice,
      pathSegments: profile.pathSegments,
      pending,
      queued,
      route: representative?.routeLocation?.pathname,
      recommended: modelChoice && !unstable,
      selectable,
      stabilityLabel: stability.stableCount + stability.regressionCount === 0
        ? undefined
        : String(stability.stableCount) + '/' +
          String(stability.stableCount + stability.regressionCount) + ' stable verdict(s)',
      state,
      statusLabel: state === 'queued'
        ? 'QUEUED'
        : state === 'applying'
          ? 'APPLYING'
          : state === 'transient'
            ? 'LOADING STATE PINNED'
            : state === 'resumed'
              ? 'TIME STATE RESUMED'
              : state === 'checking'
                ? 'VERIFYING OUTPUT'
                : state === 'verified'
              ? evaluatedVariantCount < candidateIds.length
                ? 'STABLE · TESTING ALTERNATIVES'
                : 'STABLE OUTPUT'
              : state === 'user'
                ? 'USER SELECTED'
                : state === 'recommended'
                  ? 'MODEL PICK'
                  : state === 'active'
                    ? 'ACTIVE'
                    : state === 'unstable'
                      ? 'UNSTABLE OUTPUT'
                      : state === 'rejected'
                        ? 'REJECTED'
                        : state === 'tested'
                          ? 'PARTLY TESTED'
                          : 'AVAILABLE',
      unstable,
      temporalPinned,
      temporalReleased,
      temporalSignalCount,
      variantCount: candidateIds.length,
      userSelected,
      wrapperNames: profile.wrapperNames,
    };
  });
}

/** Creates a bounded display path from the selected root, live corridor, route, and target. */
function collectPreviewInspectorPageContextPathSegments(candidate, reachability) {
  const names = [];
  const append = (value) => {
    if (typeof value !== 'string' || value.length === 0 || names.at(-1) === value) return;
    if (!names.includes(value)) names.push(value.slice(0, 160));
  };
  append(candidate?.root?.exportName);
  for (const name of Array.isArray(reachability?.applicationPath)
    ? reachability.applicationPath.slice(0, 24)
    : []) append(name);
  append(candidate?.routeLocation?.componentName);
  append(reachability?.targetExportName ?? candidate?.target?.exportName);
  if (names.length <= 10) return names;
  return [...names.slice(0, 5), '…', ...names.slice(-4)];
}

/** Returns the selected path and its sustained-output state for the Page Context UI. */
function readPreviewInspectorPageContextPathSummary(descriptor, reachability) {
  const candidates = readPreviewInspectorPageCandidates(descriptor);
  const candidate = readSelectedPreviewInspectorPageCandidate(descriptor);
  if (candidate === undefined) return undefined;
  const record = readPreviewInspectorNeuralPageContextRecord(descriptor);
  const selectedIndex = Math.max(0, candidates.findIndex((item) => item?.id === candidate.id));
  const decision = record?.decisionByCandidateId?.get?.(candidate.id) ??
    createPreviewInspectorNeuralPageContextDecision(descriptor, candidate, selectedIndex);
  const neural = typeof summarizePreviewInspectorNeuralResidualDecision === 'function'
    ? summarizePreviewInspectorNeuralResidualDecision(decision)
    : undefined;
  const userSelected = previewInspectorSession.userSelectedPageCandidateId === candidate.id;
  const pending = previewInspectorSession.pendingPageCandidateId !== undefined;
  const checking = record?.provisionalCandidateIds?.has?.(candidate.id) === true;
  const temporalState = typeof readPreviewInspectorActiveNeuralTemporalStateContract === 'function'
    ? readPreviewInspectorActiveNeuralTemporalStateContract(candidate.id)
    : undefined;
  const temporalPinned = temporalState !== undefined;
  const releasedTemporalState =
    typeof readPreviewInspectorReleasedNeuralTemporalStateContract === 'function'
      ? readPreviewInspectorReleasedNeuralTemporalStateContract(candidate.id)
      : undefined;
  const temporalReleased = releasedTemporalState !== undefined;
  const pageExecutionContext = typeof readPreviewInspectorPageExecutionContextObservation === 'function'
    ? readPreviewInspectorPageExecutionContextObservation(descriptor, candidate, reachability)
    : undefined;
  const recoveringPageContext =
    typeof isPreviewInspectorNeuralPageExecutionContextRecoveryActive === 'function' &&
    isPreviewInspectorNeuralPageExecutionContextRecoveryActive(reachability);
  const unstable = record?.unstableCandidateIds?.has?.(candidate.id) === true &&
    record?.successfulCandidateIds?.has?.(candidate.id) !== true;
  const verified = record?.successfulCandidateIds?.has?.(candidate.id) === true &&
    reachability?.targetHasOutput === true && pageExecutionContext?.contextComplete !== false;
  const successfulPathSettled =
    typeof isPreviewInspectorNeuralSuccessCollectionSettled === 'function' &&
    isPreviewInspectorNeuralSuccessCollectionSettled(reachability);
  const viewerChoiceRefining = !successfulPathSettled &&
    typeof hasPreviewInspectorNeuralPageGenerationWork === 'function' &&
    hasPreviewInspectorNeuralPageGenerationWork();
  const evaluatedCount = record?.evaluatedCandidateIds?.size ?? 0;
  const pagePathRefining = verified && !userSelected && evaluatedCount < candidates.length;
  const refining = !temporalPinned && !temporalReleased && verified &&
    (viewerChoiceRefining || pagePathRefining);
  const selectionError = record?.status === 'selection-error';
  const possibilityCount = record?.possibilityCount ?? candidates.length;
  const state = pending
      ? 'switching'
      : recoveringPageContext
        ? 'recovering'
      : temporalPinned
        ? 'transient'
        : temporalReleased
          ? 'resumed'
          : checking
            ? 'checking'
            : unstable
          ? 'unstable'
          : userSelected
            ? 'user'
            : verified
              ? refining ? 'neural' : 'verified'
              : record?.status === 'exhausted' || selectionError
                ? 'attention'
                : Number(neural?.headUpdates ?? 0) > 0
                  ? 'neural'
                  : 'baseline';
  const statusLabel = state === 'user'
    ? verified ? 'USER PATH · STABLE' : checking ? 'USER PATH · VERIFYING' : 'USER SELECTED'
    : state === 'switching'
      ? 'TESTING NEXT PATH'
      : state === 'recovering'
        ? 'RESTORING FULL PAGE CONTEXT'
      : state === 'transient'
        ? 'LOADING STATE PINNED'
        : state === 'resumed'
          ? 'TIME STATE RESUMED'
          : state === 'checking'
            ? userSelected ? 'USER PATH · VERIFYING' : 'VERIFYING OUTPUT STABILITY'
            : state === 'unstable'
          ? userSelected ? 'USER PATH · UNSTABLE' : 'OUTPUT REGRESSED'
          : refining
            ? 'STABLE OUTPUT · OPTIMIZING'
            : state === 'verified'
              ? 'STABLE OUTPUT VERIFIED'
              : state === 'attention'
                ? selectionError ? 'PATH SWITCH FAILED' : 'PATHS EXHAUSTED'
                : state === 'neural'
                  ? 'NEURAL RANKED'
                  : 'SOURCE ORDER';
  const detail = state === 'transient'
    ? 'This loading output is an intentional time checkpoint, not a terminal page success · ' +
      'the viewer is holding its request clock until you choose Resume'
    : state === 'resumed'
      ? 'You released this loading checkpoint · authored pending work may now complete, and ' +
        'its expected disappearance will not restart automatic blocker repair'
    : state === 'recovering'
      ? 'The selected component produced valid output without its authored page owners · ' +
        'the local model retained that repair state and is replaying it through a full-page execution path' +
        (pageExecutionContext?.missingOwnerNames?.length > 0
          ? ' · missing ' + pageExecutionContext.missingOwnerNames.join(' › ')
          : '')
    : state === 'checking'
    ? (userSelected ? 'Your selected path produced target output; ' : 'Target output appeared; ') +
      'the viewer is checking it across delayed observations before learning or saving this path'
    : state === 'unstable'
      ? 'Target output disappeared into a blocker-only render; ' +
        (userSelected
          ? 'your path remains selected, but it will not be learned or restored as a verified success'
          : 'this path was demoted and will not be restored as a verified success')
      : refining
        ? pagePathRefining && !viewerChoiceRefining
          ? 'Sustained target output checkpointed · testing remaining caller/HOC mount candidates'
          : 'Sustained target output checkpointed · settling remaining source-proven viewer choices'
        : state === 'verified'
          ? 'Sustained target output verified · ' + String(evaluatedCount) + '/' +
            String(candidates.length) + ' mount candidate(s) evaluated across ' +
            String(possibilityCount) + ' wrapper path(s)'
          : state === 'switching'
            ? 'An unstable or blocked path was rejected · preparing another compiler-proven candidate'
            : state === 'user'
              ? verified
                ? 'Your authoritative page choice has sustained visible target output'
                : checking
                  ? 'Your authoritative page choice is visible and undergoing stability verification'
                  : 'Your page choice is authoritative; the model observes its verified result without replacing it'
              : state === 'attention'
                ? selectionError
                  ? 'The viewer could not commit the ranked path; manual Page path choice remains available'
                  : 'No remaining admitted candidate has sustained target output; manual Page path choice remains available'
                : state === 'neural'
                  ? 'The local page-choice head ranked this candidate from sustained render outcomes'
                  : 'No stable page-choice samples yet · compiler safety ranking is retained';
  return {
    candidateCount: candidates.length,
    detail,
    evaluatedCount,
    modelLabel: temporalPinned
      ? 'TIME CONTRACT · transient checkpoint · ' + String(temporalState.signalCount) +
        ' time-state signal(s) · ' + String(temporalState.backendScenarioEntries?.length ?? 0) +
        ' viewer request(s) held · ' + String(temporalState.observationWindowMs) +
        ' ms verification window'
      : temporalReleased
        ? 'TIME CONTRACT · resumed by user · authored application progression active'
      : recoveringPageContext
        ? 'PAGE-CONTEXT RECOVERY · component output retained · testing compiler-proven page owners'
      : Number(neural?.headUpdates ?? 0) > 0
      ? 'PAGE-CHOICE · ' + String(possibilityCount) + ' source-proven wrapper path(s) · ' +
        String(neural.headUpdates) + ' learned update(s) · rank ' +
        Number(neural.selectionScore ?? neural.score ?? 0).toFixed(2)
      : 'PAGE-CHOICE · ' + String(possibilityCount) +
        ' source-proven wrapper path(s) · awaiting stable samples',
    pathname: typeof candidate?.routeLocation?.pathname === 'string'
      ? candidate.routeLocation.pathname
      : undefined,
    possibilityCount,
    segments: collectPreviewInspectorPageContextPathSegments(candidate, reachability),
    selectedIndex,
    state,
    statusLabel,
    temporalPinned,
    temporalReleased,
  };
}

/** Joins deterministic admission evidence and the model rank into one canonical UI surface. */
function readPreviewInspectorPageContextPathSurface(descriptor, reachability) {
  const paths = readPreviewInspectorPageContextPossibilities(descriptor);
  const summary = readPreviewInspectorPageContextPathSummary(descriptor, reachability);
  if (paths.length === 0 && summary === undefined) return undefined;
  const priorityByState = {
    active: 6, applying: 0, available: 7, checking: 2, queued: 1, recommended: 5,
    recovering: 1, rejected: 9, resumed: 3, tested: 8, transient: 2, unstable: 4,
    user: 3, verified: 2,
  };
  const orderedPaths = [...paths].sort((left, right) =>
    (priorityByState[left.state] ?? 10) - (priorityByState[right.state] ?? 10) ||
      left.index - right.index,
  );
  return Object.freeze({
    mountVariantCount: paths.reduce((count, path) => count + path.variantCount, 0),
    paths: Object.freeze(orderedPaths),
    summary,
  });
}
`;
}
