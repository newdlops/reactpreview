/**
 * Generates the incremental hook/backend frontier used by target reachability traversal.
 * Keeping this policy separate prevents the reachability state machine from growing into another
 * data-runtime implementation and makes the per-pass performance limit independently testable.
 */

/** Creates browser source that prioritizes a bounded root-to-target requirement batch. */
export function createPreviewInspectorRequirementFrontierRuntimeSource(): string {
  return String.raw`
const PREVIEW_INSPECTOR_REQUIREMENT_HOOK_BATCH_LIMIT = 8;
const PREVIEW_INSPECTOR_REQUIREMENT_DATA_BATCH_LIMIT = 4;

/** Reports whether compiler evidence names a property that Smart fill can actually materialize. */
function hasPreviewInspectorMaterializableHookRequirement(record) {
  return (record?.requiredPaths ?? []).some((path) =>
    typeof path === 'string' && path.length > 0 && path !== '<root>' && path !== '<root>()',
  );
}

/** Returns whether a formerly Smart record has discovered a shape not covered by its last fill. */
function hasPreviewInspectorStaleSmartRequirement(record) {
  if (record?.mode !== 'smart' && record?.mode !== 'smart-manual') return false;
  const signatures = previewInspectorSession.runtimeFallbackSmartPathSignatures;
  if (!(signatures instanceof Map)) return true;
  const current = createPreviewInspectorRuntimeFallbackPathSignature(record.requiredPaths);
  return signatures.get(record.id) !== current;
}

/** Returns whether a Smart backend fixture predates the request's latest inferred response shape. */
function hasPreviewInspectorStaleSmartDataRequirement(record) {
  if (record?.mode !== 'smart' && record?.mode !== 'smart-custom') return false;
  const signatures = previewInspectorSession.dataPayloadSmartShapeSignatures;
  return !(signatures instanceof Map) || signatures.get(record.id) !== record.shapeFingerprint;
}

/** Excludes settled generated values while admitting newly expanded Smart requirements exactly once. */
function hasPreviewInspectorPendingHookRequirement(record, preserveUserValues) {
  if (record?.passive === true || !hasPreviewInspectorMaterializableHookRequirement(record)) {
    return false;
  }
  if (preserveUserValues && (record.mode === 'manual' || record.mode === 'smart-manual')) {
    return false;
  }
  return record.mode !== 'smart' && record.mode !== 'smart-manual' ||
    hasPreviewInspectorStaleSmartRequirement(record);
}

/** Excludes completed payloads but reopens one whose compiler-owned shape expanded after a render. */
function hasPreviewInspectorPendingDataRequirement(record, preserveUserValues) {
  if (preserveUserValues && (record?.mode === 'custom' || record?.mode === 'smart-custom')) {
    return false;
  }
  return record?.mode !== 'smart' && record?.mode !== 'smart-custom' ||
    hasPreviewInspectorStaleSmartDataRequirement(record);
}

/** Finds the nearest synchronous JSX owner of every deferred callback subtree. */
function readPreviewInspectorDeferredOutcomeOwners(outcomes) {
  const ownerNames = new Set();
  const sourcePaths = new Set();
  const visit = (nodes, synchronousAncestors, outcomeSourcePath) => {
    for (const node of Array.isArray(nodes) ? nodes : []) {
      if (node === null || typeof node !== 'object') continue;
      if (node.renderMode === 'deferred-callback') {
        const owner = synchronousAncestors.at(-1);
        const ownerName = typeof owner?.name === 'string' ? owner.name : '';
        if (ownerName.length > 0) {
          ownerNames.add(ownerName);
          const shortName = ownerName.split('.').at(-1);
          if (shortName?.length > 0) ownerNames.add(shortName);
        }
        const sourcePath = normalizePreviewInspectorReachabilityPath(
          owner?.sourcePath ?? outcomeSourcePath,
        );
        if (sourcePath.length > 0) sourcePaths.add(sourcePath);
        visit(node.children, synchronousAncestors, outcomeSourcePath);
        continue;
      }
      visit(node.children, [...synchronousAncestors, node], outcomeSourcePath);
    }
  };
  for (const outcome of outcomes) visit(outcome?.componentTree, [], outcome?.sourcePath);
  return { ownerNames, sourcePaths };
}

/**
 * Proves that the selected export is deferred behind a JSX render callback.
 *
 * A mounted facade with no host output is ambiguous by itself. Static JSX outcomes prove that the
 * export can return visual output, while render-graph invocation metadata proves that an ancestor
 * must call a render prop before that output exists. The result is inert scoring evidence only;
 * project callbacks are never invoked by the Inspector.
 */
function readPreviewInspectorDeferredRenderContract(descriptor, candidate, state) {
  if (
    !(state?.targetMounted === true || state?.targetWasMounted === true) ||
    state?.targetHasOutput === true
  ) return undefined;
  const plan = descriptor?.inspector?.renderOutcomesByExport?.[state.targetExportName];
  const jsxOutcomes = (Array.isArray(plan?.outcomes) ? plan.outcomes : [])
    .filter((outcome) => outcome?.kind === 'jsx')
    .slice(0, 32);
  if (jsxOutcomes.length === 0) return undefined;
  const path = readPreviewInspectorTargetRenderPath(
    descriptor,
    candidate,
    state.targetExportName,
  );
  const steps = (Array.isArray(path?.steps) ? path.steps : [])
    .filter((step) => step?.invocation?.mode === 'render-prop')
    .slice(0, 8);
  const outcomeOwners = readPreviewInspectorDeferredOutcomeOwners(jsxOutcomes);
  if (steps.length === 0 && outcomeOwners.ownerNames.size === 0) return undefined;
  const invocationOwnerNames = steps.map((step) => step?.invocation?.calleeName)
    .filter((name) => typeof name === 'string' && name.length > 0);
  const invocationSourcePaths = steps.map((step) => step?.invocation?.sourcePath)
    .map(normalizePreviewInspectorReachabilityPath).filter(Boolean);
  return {
    active: true,
    conditionIds: [...new Set(jsxOutcomes.flatMap((outcome) =>
      (Array.isArray(outcome?.conditions) ? outcome.conditions : [])
        .map((condition) => condition?.id).filter(Boolean)))],
    kind: 'deferred-render-contract',
    outcomeIds: jsxOutcomes.map((outcome) => outcome.id).filter(Boolean),
    ownerNames: [...new Set([...outcomeOwners.ownerNames, ...invocationOwnerNames])],
    slotNames: [...new Set([
      ...(outcomeOwners.ownerNames.size > 0 ? ['children'] : []),
      ...steps.map((step) => step?.invocation?.slotName).filter(Boolean),
    ])],
    sourcePaths: [...new Set([...outcomeOwners.sourcePaths, ...invocationSourcePaths])],
  };
}

/** Scores one runtime requirement by exact ownership inside the proven root-to-target corridor. */
function scorePreviewInspectorRequirementRecord(record, evidence) {
  const ownerName = record?.ownerName;
  const ambiguousOwner = evidence.ambiguousNames?.has(ownerName) &&
    !evidence.runtimeOwnerNames?.has(ownerName);
  let score = ambiguousOwner ? 0 : evidence.nameScores.get(ownerName) ?? 0;
  const sourcePath = normalizePreviewInspectorReachabilityPath(record?.sourcePath);
  const contract = evidence.deferredRenderContract;
  if (contract?.ownerNames?.includes(ownerName)) score = Math.max(score, 1_400);
  if (sourcePath.length > 0 && contract?.sourcePaths?.some((path) =>
    path === sourcePath || path.endsWith('/' + sourcePath) || sourcePath.endsWith('/' + path)
  )) score = Math.max(score, 1_300);
  if (sourcePath.length === 0) return score;
  for (const path of evidence.paths) {
    if (path === sourcePath || path.endsWith('/' + sourcePath) || sourcePath.endsWith('/' + path)) {
      /* Target-to-root path scores preserve distance; a shell source must not tie the target. */
      score = Math.max(score, evidence.pathScores?.get(path) ?? 1);
    }
  }
  return score;
}

/**
 * Chooses records proven to belong to the root-to-target path before considering a blind fallback.
 * A bounded fallback remains necessary for anonymous wrapper hooks whose compiler metadata cannot
 * name an owner, but zero-score siblings must never consume slots once any path evidence matches.
 */
function selectPreviewInspectorRequirementIds(records, evidence, limit) {
  const ranked = records
    .map((record) => ({ record, score: scorePreviewInspectorRequirementRecord(record, evidence) }))
    .sort((left, right) => right.score - left.score);
  const pathLocal = ranked.filter((candidate) => candidate.score > 0);
  return (pathLocal.length > 0 ? pathLocal : ranked)
    .slice(0, limit)
    .map((candidate) => candidate.record.id);
}

/**
 * Selects a small incremental frontier instead of filling every hook and request seen on the page.
 * Path-local records exclusively occupy a proven batch; unresolved anonymous hooks are used only
 * when the current observations provide no owner/source correlation at all.
 */
function readPreviewInspectorRequirementBatch(
  descriptor,
  candidate,
  state,
  preserveUserValues,
) {
  const deferredRenderContract = readPreviewInspectorDeferredRenderContract(
    descriptor,
    candidate,
    state,
  );
  state.deferredRenderContract = deferredRenderContract;
  const evidence = {
    ...readPreviewInspectorTargetPathEvidence(descriptor, candidate, state),
    deferredRenderContract,
  };
  const hooks = readPreviewInspectorRuntimeFallbacks()
    .filter((record) =>
      record.reachabilityKey === state.key &&
      hasPreviewInspectorPendingHookRequirement(record, preserveUserValues),
    );
  const requests = readPreviewInspectorDataRequests()
    .filter((record) =>
      record.reachabilityKey === state.key &&
      hasPreviewInspectorPendingDataRequirement(record, preserveUserValues),
    );
  const hookIds = selectPreviewInspectorRequirementIds(
    hooks,
    evidence,
    PREVIEW_INSPECTOR_REQUIREMENT_HOOK_BATCH_LIMIT,
  );
  const requestIds = selectPreviewInspectorRequirementIds(
    requests,
    evidence,
    PREVIEW_INSPECTOR_REQUIREMENT_DATA_BATCH_LIMIT,
  );
  return { hookIds, requestIds };
}

/** Canonicalizes only actionable IDs and shapes so registry refresh order cannot restart traversal. */
function createPreviewInspectorActionableRequirementSignature(batch) {
  const hookIds = new Set(batch?.hookIds ?? []);
  const requestIds = new Set(batch?.requestIds ?? []);
  const hooks = readPreviewInspectorRuntimeFallbacks()
    .filter((record) => hookIds.has(record.id))
    .map((record) => [record.id, createPreviewInspectorRuntimeFallbackPathSignature(
      record.requiredPaths,
    )])
    .sort((left, right) => left[0].localeCompare(right[0]));
  const requests = readPreviewInspectorDataRequests()
    .filter((record) => requestIds.has(record.id))
    .map((record) => [record.id, record.shapeFingerprint ?? JSON.stringify(
      readPreviewInspectorDataShapePaths(record.shape).sort(),
    )])
    .sort((left, right) => left[0].localeCompare(right[0]));
  return JSON.stringify({ hooks, requests });
}

/**
 * Reopens a settled search only after a later render exposes a new actionable child requirement.
 * Registry updates are coalesced into one microtask, semantic signatures suppress duplicates, and
 * the shared convergence history still owns the hard pass limit and A-B-A cycle detection.
 */
function schedulePreviewInspectorTargetRequirementContinuation(reachabilityKey) {
  if (typeof reachabilityKey !== 'string' || reachabilityKey.length === 0) return false;
  const pending = previewInspectorSession.requirementContinuationPendingKeys ??= new Set();
  if (pending.has(reachabilityKey)) return false;
  pending.add(reachabilityKey);
  const schedule = globalThis.queueMicrotask ?? ((callback) => Promise.resolve().then(callback));
  schedule(() => {
    pending.delete(reachabilityKey);
    initializePreviewInspectorTargetReachabilityState();
    const state = previewInspectorSession.targetReachabilityByKey.get(reachabilityKey);
    if (
      state === undefined ||
      state.directTarget === true ||
      state.pageRootCommitted !== true ||
      state.status === 'resolver-cycle-detected' ||
      state.status === 'resolver-limit-reached'
    ) return;
    state.targetMounted = hasMountedPreviewInspectorTarget(state);
    state.targetHasOutput = hasPreviewInspectorTargetHostOutput(state);
    if (state.targetHasOutput === true) return;
    const descriptor = typeof findSelectedPreviewInspectorDescriptor === 'function'
      ? findSelectedPreviewInspectorDescriptor()
      : undefined;
    const candidate = typeof readSelectedPreviewInspectorPageCandidate === 'function'
      ? readSelectedPreviewInspectorPageCandidate(descriptor)
      : undefined;
    if (descriptor === undefined || candidate === undefined) return;
    const current = readPreviewInspectorMinimumRequirementSearch(state);
    if (current?.status === 'searching') return;
    const preserveUserValues = current?.origin !== 'user';
    const batch = readPreviewInspectorRequirementBatch(
      descriptor,
      candidate,
      state,
      preserveUserValues,
    );
    if (batch.hookIds.length === 0 && batch.requestIds.length === 0) return;
    const signature = createPreviewInspectorActionableRequirementSignature(batch);
    if (
      state.lastActionableRequirementSignature === signature ||
      !canStartPreviewInspectorDeterministicRequirementSearch(state, batch)
    ) return;
    state.lastActionableRequirementSignature = signature;
    const convergence = readPreviewInspectorRequirementConvergence(state);
    const search = current ?? {};
    Object.assign(search, {
      observedPathCount: readPreviewInspectorTargetReachabilityRequiredPaths(state).length,
      origin: current?.origin ?? 'deterministic-auto',
      pass: convergence.totalPasses,
      status: 'searching',
      totalPasses: convergence.totalPasses,
    });
    previewInspectorSession.minimumRequirementSearchByKey.set(state.key, search);
    state.exhausted = false;
    state.idlePasses = 0;
    state.status = state.deferredRenderContract?.active === true
      ? 'resolving-deferred-render-contract'
      : 'resuming-new-requirements';
    state.probeRevision += 1;
    notifyPreviewInspector();
    schedulePreviewInspectorTreeRefresh();
  });
  return true;
}

/** Returns only paths changed by the current incremental requirement batch. */
function readPreviewInspectorRequirementBatchPaths(batch) {
  const hookIds = new Set(batch.hookIds);
  const requestIds = new Set(batch.requestIds);
  const paths = [];
  const append = (value) => {
    if (typeof value === 'string' && value.length > 0 && !paths.includes(value) && paths.length < 64) {
      paths.push(value);
    }
  };
  for (const record of readPreviewInspectorRuntimeFallbacks()) {
    if (!hookIds.has(record.id)) continue;
    for (const path of record.requiredPaths ?? []) append(record.hookName + '.' + path);
  }
  for (const record of readPreviewInspectorDataRequests()) {
    if (!requestIds.has(record.id)) continue;
    for (const path of readPreviewInspectorDataShapePaths(record.shape)) {
      append(record.label + '.' + path);
    }
  }
  return paths;
}
`;
}
