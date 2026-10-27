/** Owns target-source identity and revision-local traversal state; it does not rank gates or verify output. */

/** Generates browser helpers composed into the existing target reachability runtime. */
export function createPreviewInspectorTargetReachabilityStateRuntimeSource(): string {
  return String.raw`
/**
 * Starts a new bounded convergence epoch after one explicit user branch change.
 *
 * A previously dormant parent can reveal new overlay props and conditions after the original DFS
 * has exhausted its one-shot visibility probe. Retaining automatic values and decision history
 * avoids oscillation, while reopening the probe and rejection frontier lets newly reachable
 * descendants participate in the next committed render.
 */
function resumePreviewInspectorTargetReachabilityAfterManualCondition(conditionId) {
  initializePreviewInspectorTargetReachabilityState();
  const condition = previewInspectorSession.renderConditions?.get?.(conditionId);
  const activeKey = previewInspectorSession.activeTargetReachabilityKey;
  const conditionKey = typeof condition?.reachabilityKey === 'string'
    ? condition.reachabilityKey
    : undefined;
  const key = conditionKey !== undefined &&
    previewInspectorSession.targetReachabilityByKey.has(conditionKey)
    ? conditionKey
    : typeof activeKey === 'string' ? activeKey : undefined;
  if (key === undefined) return false;
  const state = previewInspectorSession.targetReachabilityByKey.get(key);
  if (state === undefined) return false;
  state.attempt = 0;
  state.exhausted = false;
  state.idlePasses = 0;
  state.overlayVisibilityAttempted = false;
  if (state.contextualTargetFallbackRequested === true) {
    state.contextualTargetFallbackRequested = false;
    state.detachedTargetPlacement = undefined;
  }
  state.status = 'probing-after-manual-condition';
  state.probeRevision = (Number.isSafeInteger(state.probeRevision) ? state.probeRevision : 0) + 1;
  previewInspectorSession.renderConditionRejectedAutoOverridesByKey?.delete?.(key);
  previewInspectorSession.renderConditionAutoAttempts?.clear?.();
  const search = previewInspectorSession.minimumRequirementSearchByKey?.get?.(key);
  if (
    search !== undefined &&
    search.status !== 'searching' &&
    search.pass < PREVIEW_INSPECTOR_MINIMUM_REQUIREMENT_PASS_LIMIT
  ) {
    search.status = 'searching';
  }
  return true;
}

/**
 * Reopens the same authored-page corridor after a neural hook recommendation changes its inputs.
 *
 * A failed target may already have exhausted its page-execution lane by the time the nested hook
 * shape is learned. Refreshing only the selected export cannot remount an ancestor gate that the
 * failed transaction rolled back. This reset retains every proven branch/value decision, clears
 * only the superseded target error, and gives the existing bounded traversal a fresh probe budget.
 */
function resumePreviewInspectorTargetReachabilityAfterNeuralRecommendation(reachabilityKey) {
  initializePreviewInspectorTargetReachabilityState();
  if (
    typeof reachabilityKey !== 'string' || reachabilityKey.length === 0 ||
    previewInspectorSession.activeTargetReachabilityKey !== reachabilityKey
  ) return false;
  const state = previewInspectorSession.targetReachabilityByKey.get(reachabilityKey);
  if (
    state === undefined || state.directTarget === true || state.targetHasOutput === true ||
    ['resolver-cycle-detected', 'resolver-limit-reached'].includes(state.status)
  ) return false;
  state.attempt = 0;
  state.blockedWarningReported = false;
  state.exhausted = false;
  state.idlePasses = 0;
  state.status = 'probing-after-neural-recommendation';
  state.targetMounted = false;
  state.targetOutputError = undefined;
  state.targetOutputRecoveryPending = false;
  state.targetWasMounted = false;
  state.probeRevision = (Number.isSafeInteger(state.probeRevision) ? state.probeRevision : 0) + 1;
  if (typeof clearPreviewInspectorRuntimeHealthTargetError === 'function') {
    clearPreviewInspectorRuntimeHealthTargetError(state.targetExportName);
  }
  return true;
}
/** Returns current-file exports that can be asserted through the generated target facade. */
function readPreviewInspectorReachableTargetExports(descriptor, candidate) {
  const inspector = descriptor?.inspector;
  return [...new Set([
    candidate?.target?.exportName,
    inspector?.target?.exportName,
    ...Object.keys(inspector?.renderChainsByExport ?? {}),
  ].filter((name) => typeof name === 'string' && name.length > 0))];
}
/** Resolves the selected current-file export without mistaking an editable ancestor root for it. */
function readPreviewInspectorExpectedTargetExport(descriptor, candidate) {
  if (typeof candidate?.target?.exportName === 'string') return candidate.target.exportName;
  const exports = readPreviewInspectorReachableTargetExports(descriptor, candidate);
  return exports.includes(previewInspectorSession.selectedExportName)
    ? previewInspectorSession.selectedExportName
    : exports[0] ?? descriptor?.exportName ?? 'default';
}
/** Creates one stable traversal identity per page candidate and selected current-file export. */
function createPreviewInspectorTargetReachabilityKey(descriptor, candidate) {
  const targetPageTabKey = Array.isArray(candidate?.targetPageTabKeys)
    ? candidate.targetPageTabKeys.filter((value) =>
        typeof value === 'string' && value.length > 0 && value.length <= 128,
      ).join('\0')
    : '';
  return String(candidate?.id ?? 'nearest-authored-owner') + ':' +
    readPreviewInspectorExpectedTargetExport(descriptor, candidate) +
    (targetPageTabKey.length > 0 ? ':' + targetPageTabKey : '');
}
/** Reads target-to-entry metadata for the selected export, falling back to candidate-local evidence. */
function readPreviewInspectorTargetRenderPath(descriptor, candidate, targetExportName) {
  const targetPlan = descriptor?.inspector?.renderChainsByExport?.[targetExportName];
  const candidatePath = candidate?.renderPath;
  if (candidate?.target !== undefined && candidatePath !== undefined) return candidatePath;
  if (
    candidatePath !== undefined &&
    (targetPlan?.paths ?? []).some((path) => path?.id === candidatePath.id)
  ) {
    return candidatePath;
  }
  return targetPlan?.paths?.[0] ?? candidatePath;
}
/** Resolves the exact facade source for the selected export without export-name-only fallback. */
function readPreviewInspectorTargetSourcePath(descriptor, candidate, targetExportName) {
  for (const reference of [
    candidate?.target,
    descriptor?.inspector?.renderChainsByExport?.[targetExportName]?.target,
    descriptor?.inspector?.target,
  ]) {
    if (
      reference?.exportName === targetExportName &&
      typeof reference?.sourcePath === 'string' &&
      reference.sourcePath.length > 0
    ) return reference.sourcePath.replaceAll('\\', '/');
  }
  return undefined;
}
/** Builds one mutable but bounded state record from immutable application-path evidence. */
function createPreviewInspectorTargetReachabilityState(descriptor, candidate) {
  const targetExportName = readPreviewInspectorExpectedTargetExport(descriptor, candidate);
  const renderPath = readPreviewInspectorTargetRenderPath(descriptor, candidate, targetExportName);
  const applicationPath = [...(renderPath?.steps ?? [])]
    .reverse()
    .flatMap((step) => [
      ...[...(step?.wrapperNames ?? [])].reverse(),
      ...[...(step?.invocation?.localOwnerNames ?? [])].reverse(),
      step?.label,
    ])
    .filter((name, index, names) =>
      typeof name === 'string' && name.length > 0 && names.indexOf(name) === index,
    );
  if (!applicationPath.includes(targetExportName)) applicationPath.push(targetExportName);
  return {
    applicationPath,
    appliedConditions: [],
    attempt: 0,
    candidateId: candidate?.id ?? 'nearest-authored-owner',
    contextualTargetFallbackRequested: false,
    directTarget: false,
    directTargetAvailable: false,
    detachedTargetPlacement: candidate?.detachedTargetPlacement,
    entryRevision: typeof previewEntryRevision === 'number' ? previewEntryRevision : undefined,
    exhausted: false,
    idlePasses: 0,
    key: createPreviewInspectorTargetReachabilityKey(descriptor, candidate),
    pageRootCommitted: false,
    overlayVisibilityAttempted: false,
    probeRevision: 0,
    rootName: candidate?.root?.exportName ?? descriptor?.inspector?.root?.exportName ?? 'Application',
    runtimeOwnerNames: [],
    status: 'probing',
    targetExportName,
    targetSourcePath: readPreviewInspectorTargetSourcePath(
      descriptor,
      candidate,
      targetExportName,
    ),
    targetHasOutput: false,
    targetMounted: false,
    targetPageTabKeys: Array.isArray(candidate?.targetPageTabKeys)
      ? [...new Set(candidate.targetPageTabKeys.filter((value) =>
          typeof value === 'string' && value.length > 0 && value.length <= 128,
        ))].slice(0, 8)
      : [],
    targetWasMounted: false,
    viewportRevealAttempted: false,
    viewportRevealPending: false,
  };
}
/** Returns only committed boundaries carrying the state's exact compiler facade identity. */
function readPreviewInspectorTargetBoundaries(state) {
  if (typeof state?.targetSourcePath !== 'string') return new Set();
  const boundaries = previewInspectorSession.boundariesByExport.get(state.targetExportName);
  if (!(boundaries instanceof Set)) return new Set();
  return new Set([...boundaries].filter((boundary) =>
    boundary?.props?.exportName === state.targetExportName &&
    typeof boundary?.props?.sourcePath === 'string' &&
    boundary.props.sourcePath.replaceAll('\\', '/') === state.targetSourcePath
  ));
}

/**
 * Builds exact direct-page evidence when reverse ancestry legitimately ends at the selected file.
 *
 * The bridge marks only Page/Screen/View endpoints and the entry independently admits only live
 * React values. Runtime success still requires an exact source/export boundary, an error-free
 * selected element Fiber, and connected project DOM through the ordinary target-output verifier.
 */
function readPreviewInspectorStandaloneTargetReachabilityState(descriptor) {
  const targetExportName = descriptor?.exportName;
  const targetSourcePath = typeof descriptor?.sourcePath === 'string'
    ? descriptor.sourcePath.replaceAll('\\', '/')
    : '';
  if (
    descriptor?.inspector !== undefined ||
    descriptor?.standalonePageTarget !== true ||
    typeof targetExportName !== 'string' ||
    targetExportName.length === 0 ||
    targetSourcePath.length === 0 ||
    previewInspectorSession.selectedExportName !== targetExportName
  ) return undefined;
  const state = {
    applicationPath: [targetExportName],
    appliedConditions: [],
    attempt: 0,
    candidateId: 'standalone-target:' + targetExportName,
    contextualTargetFallbackRequested: false,
    directTarget: true,
    directTargetAvailable: true,
    exhausted: false,
    idlePasses: 0,
    key: 'standalone-target:' + targetSourcePath + ':' + targetExportName,
    overlayVisibilityAttempted: false,
    pageRootCommitted: false,
    probeRevision: 0,
    rootName: targetExportName,
    runtimeOwnerNames: [],
    status: 'probing',
    targetExportName,
    targetHasOutput: false,
    targetMounted: false,
    targetSourcePath,
    targetWasMounted: false,
    viewportRevealAttempted: false,
    viewportRevealPending: false,
  };
  const boundaries = readPreviewInspectorTargetBoundaries(state);
  state.targetMounted = boundaries.size > 0;
  state.targetWasMounted = state.targetMounted;
  state.pageRootCommitted = state.targetMounted;
  if (state.targetMounted) {
    state.targetHasOutput = hasPreviewInspectorTargetHostOutput(state);
  }
  state.status = state.targetHasOutput
    ? 'reached'
    : state.targetMounted
      ? 'target-mounted-no-output'
      : 'probing';
  state.exhausted = state.targetHasOutput;
  return state;
}
/** Observes current standalone output only after the toolbar commits, never during snapshot reads. */
function observePreviewInspectorStandaloneTargetReachability() {
  const state = readPreviewInspectorStandaloneTargetReachabilityState(
    findSelectedPreviewInspectorDescriptor(),
  );
  if (state === undefined) return;
  if (
    state.targetHasOutput === true &&
    typeof recordPreviewInspectorNeuralSuccessfulPath === 'function'
  ) {
    recordPreviewInspectorNeuralSuccessfulPath(state);
  } else if (typeof handlePreviewInspectorNeuralSuccessfulPathRestorationFailure === 'function') {
    handlePreviewInspectorNeuralSuccessfulPathRestorationFailure(state);
  }
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
`;
}

/** Creates output observation separately so standalone state readers keep their existing bindings. */
export function createPreviewInspectorTargetOutputObservationRuntimeSource(): string {
  return String.raw`
/**
 * Updates the output result and its classification together for every independent ownership probe.
 * A HOC boundary alone is insufficient: it must own connected authored output and remain error-free.
 * Compiler-proven navigation is the existing exception after its exact boundary leaves the route.
 * Neural verification and requirement continuations can call this outside the main traversal;
 * leaving targetHasOutput unchanged would publish stale failure or success beside the new kind.
 */
function hasPreviewInspectorTargetHostOutput(state) {
  const boundaries = readPreviewInspectorTargetResolutionBoundaries(state);
  state.targetHasOutput = false;
  state.targetHasAnyHostOutput = false;
  state.targetDeferredCallbackPending = false;
  state.targetOutputKind = 'none';
  state.targetOutputRecoveryPending = false;
  state.targetEffectControllerOutput = false;
  state.targetRenderedEmpty = false;
  if (!(boundaries instanceof Set)) return false;
  for (const boundary of boundaries) {
    if (boundary?.state?.error !== undefined) continue;
    const hasOutput = typeof hasPreviewInspectorResolvedTargetOutput === 'function'
      ? hasPreviewInspectorResolvedTargetOutput(boundary, state)
      : collectPreviewInspectorFiberElements(boundary).length > 0;
    if (hasOutput) {
      state.targetHasOutput = true;
      return true;
    }
  }
  const activeError = typeof readPreviewInspectorRuntimeHealthTargetError === 'function'
    ? readPreviewInspectorRuntimeHealthTargetError(state.targetExportName)
    : undefined;
  if (
    state.targetWasMounted === true &&
    activeError === undefined &&
    hasPreviewInspectorIntentionalNavigationTargetOutput(state)
  ) {
    state.targetHasOutput = true;
    state.targetOutputError = undefined;
    state.targetOutputKind = 'target-output';
    state.targetOutputRecoveryPending = false;
    state.targetRenderedEmpty = true;
    return true;
  }
  return false;
}
`;
}
