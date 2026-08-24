/** Generates neural ranking and verified exploration for compiler-proven page contexts. */

/**
 * Creates the browser runtime that connects the existing page-choice neural head to page roots.
 * Static analysis remains the admission boundary; this layer only reorders admitted candidates and
 * trains from target-output verification owned by the Page Inspector runtime.
 */
export function createPreviewInspectorNeuralPageContextRuntimeSource(): string {
  return String.raw`
const PREVIEW_INSPECTOR_NEURAL_PAGE_CONTEXT_PORTFOLIO_LIMIT = 12;
const PREVIEW_INSPECTOR_NEURAL_PAGE_CONTEXT_RECORD_LIMIT = 24;

/** Creates an anonymous model identity even in selector-only compatibility fixtures. */
function hashPreviewInspectorNeuralPageContextCandidateId(value) {
  const text = String(value).slice(0, 2048);
  let hash = 2166136261;
  for (let index = 0; index < text.length; index += 1) {
    hash ^= text.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}

/** Lazily creates hot-session search records without persisting project identities. */
function initializePreviewInspectorNeuralPageContextRecords() {
  if (!(previewInspectorSession.neuralPageContextByKey instanceof Map)) {
    previewInspectorSession.neuralPageContextByKey = new Map();
  }
  while (
    previewInspectorSession.neuralPageContextByKey.size >
    PREVIEW_INSPECTOR_NEURAL_PAGE_CONTEXT_RECORD_LIMIT
  ) {
    previewInspectorSession.neuralPageContextByKey.delete(
      previewInspectorSession.neuralPageContextByKey.keys().next().value,
    );
  }
  return previewInspectorSession.neuralPageContextByKey;
}

/** Builds one target-local search identity; it never enters persisted neural model data. */
function createPreviewInspectorNeuralPageContextKey(descriptor) {
  const sourcePathValue = descriptor?.inspector?.target?.sourcePath ?? descriptor?.sourcePath;
  const sourcePath = typeof sourcePathValue === 'string'
    ? sourcePathValue.replaceAll('\\', '/').slice(-1024)
    : '';
  const exportNameValue = descriptor?.inspector?.target?.exportName ??
    descriptor?.inspectedExportName ?? descriptor?.exportName ??
      previewInspectorSession.selectedExportName;
  const exportName = typeof exportNameValue === 'string'
    ? exportNameValue.slice(0, 160)
    : String(previewInspectorSession.selectedExportName ?? '').slice(0, 160);
  return sourcePath + '\0' + exportName;
}

/** Hashes the target-local key before retaining a verified path across full webview reloads. */
function createPreviewInspectorNeuralPageContextPersistedScope(descriptor) {
  return hashPreviewInspectorNeuralPageContextCandidateId(
    createPreviewInspectorNeuralPageContextKey(descriptor),
  ).toString(16).padStart(8, '0');
}

/** Adds one bounded semantic label without repeating adjacent or previously admitted names. */
function appendPreviewInspectorPageContextPathLabel(labels, value) {
  if (typeof value !== 'string' || value.length === 0) return;
  const bounded = value.slice(0, 160);
  if (labels.at(-1) !== bounded && !labels.includes(bounded)) labels.push(bounded);
}

/** Extracts source-proven HOC, wrapper, local-owner, and conditional evidence from one path. */
function createPreviewInspectorPageContextPathProfile(candidate) {
  const steps = Array.isArray(candidate?.renderPath?.steps)
    ? candidate.renderPath.steps.slice(0, 24)
    : [];
  const callerNames = [];
  const pathSegments = [];
  const wrapperNames = [];
  const invocationModes = [];
  const kinds = [];
  let conditionalCount = 0;
  const appendWrapper = (value) => {
    if (typeof value !== 'string' || value.length === 0) return;
    appendPreviewInspectorPageContextPathLabel(wrapperNames, value);
  };
  const appendKind = (value) => {
    if (!kinds.includes(value)) kinds.push(value);
  };
  for (let stepIndex = steps.length - 1; stepIndex >= 0; stepIndex -= 1) {
    const step = steps[stepIndex];
    if (stepIndex > 0) {
      appendPreviewInspectorPageContextPathLabel(callerNames, step?.label);
    }
    if (step?.certainty === 'conditional') {
      conditionalCount += 1;
      appendKind('conditional');
    }
    const stepWrappers = Array.isArray(step?.wrapperNames)
      ? step.wrapperNames.slice(0, 12)
      : [];
    if (stepWrappers.length > 0) appendKind('JSX wrapper');
    for (const name of [...stepWrappers].reverse()) {
      appendWrapper(name);
      appendPreviewInspectorPageContextPathLabel(pathSegments, name);
    }
    const invocation = step?.invocation;
    const mode = typeof invocation?.mode === 'string' ? invocation.mode : undefined;
    if (mode !== undefined && !invocationModes.includes(mode)) invocationModes.push(mode);
    if (['hoc', 'memo', 'forward-ref', 'styled'].includes(mode)) {
      appendKind(mode === 'forward-ref' ? 'forwardRef' : mode === 'hoc' ? 'HOC' : mode);
      appendWrapper(invocation?.calleeName);
    }
    for (const name of Array.isArray(invocation?.factoryNames)
      ? invocation.factoryNames.slice(0, 12)
      : []) appendWrapper(name);
    for (const name of Array.isArray(invocation?.localOwnerNames)
      ? invocation.localOwnerNames.slice(0, 12)
      : []) {
      appendWrapper(name);
      appendKind('local owner');
    }
    appendPreviewInspectorPageContextPathLabel(pathSegments, step?.label);
  }
  if (callerNames.length > 0) appendKind('component caller');
  const edges = Array.isArray(candidate?.edges) ? candidate.edges.slice(0, 24) : [];
  if (pathSegments.length === 0) {
    for (const edge of [...edges].reverse()) {
      appendPreviewInspectorPageContextPathLabel(pathSegments, edge?.owner?.exportName);
      for (const name of [...(Array.isArray(edge?.localOwnerNames)
        ? edge.localOwnerNames.slice(0, 12)
        : [])].reverse()) appendPreviewInspectorPageContextPathLabel(pathSegments, name);
      appendPreviewInspectorPageContextPathLabel(pathSegments, edge?.child?.exportName);
    }
  }
  for (const edge of edges) {
    for (const name of Array.isArray(edge?.localOwnerNames)
      ? edge.localOwnerNames.slice(0, 12)
      : []) {
      appendWrapper(name);
      appendKind('local owner');
    }
  }
  if (candidate?.contextModule !== undefined) appendKind('module consumer');
  if (Array.isArray(candidate?.nextAppLayoutChain) && candidate.nextAppLayoutChain.length > 0) {
    appendKind('framework layout');
  }
  appendPreviewInspectorPageContextPathLabel(pathSegments, candidate?.target?.exportName);
  const boundedSegments = pathSegments.length <= 14
    ? pathSegments
    : [...pathSegments.slice(0, 7), '…', ...pathSegments.slice(-6)];
  return {
    callerNames,
    conditionalCount,
    invocationModes,
    kinds,
    pathSegments: boundedSegments,
    wrapperNames,
  };
}

/** Returns the exact render-path identity before optional authored-route disambiguation. */
function createPreviewInspectorPageContextPathIdentity(candidate, index) {
  const renderPathId = candidate?.renderPath?.id;
  const pathIdentity = typeof renderPathId === 'string' && renderPathId.length > 0
    ? renderPathId
    : String(candidate?.id ?? 'candidate:' + String(index));
  return pathIdentity;
}

/** Keeps genuinely different authored routes separate without splitting route-less checkpoints. */
function createPreviewInspectorPageContextRouteIdentity(candidate) {
  const route = candidate?.routeLocation;
  return [
    route?.pathname ?? '',
    route?.pattern ?? '',
    route?.componentName ?? '',
  ].join('\0');
}

/** Builds a stable round-robin inventory so duplicate checkpoints cannot hide another HOC path. */
function createPreviewInspectorPageContextPathInventory(candidates) {
  const groupsByKey = new Map();
  const groupByCandidateId = new Map();
  const profileByCandidateId = new Map();
  const routeIdentitiesByPath = new Map();
  for (let index = 0; index < candidates.length; index += 1) {
    const candidate = candidates[index];
    const routeIdentity = createPreviewInspectorPageContextRouteIdentity(candidate);
    if (routeIdentity.replaceAll('\0', '').length === 0) continue;
    const pathIdentity = createPreviewInspectorPageContextPathIdentity(candidate, index);
    const routeIdentities = routeIdentitiesByPath.get(pathIdentity) ?? new Set();
    routeIdentities.add(routeIdentity);
    routeIdentitiesByPath.set(pathIdentity, routeIdentities);
  }
  for (let index = 0; index < candidates.length; index += 1) {
    const candidate = candidates[index];
    if (typeof candidate?.id !== 'string' || candidate.id.length === 0) continue;
    const pathIdentity = createPreviewInspectorPageContextPathIdentity(candidate, index);
    const splitByRoute = (routeIdentitiesByPath.get(pathIdentity)?.size ?? 0) > 1;
    const key = [
      pathIdentity,
      splitByRoute ? createPreviewInspectorPageContextRouteIdentity(candidate) : '',
    ].join('\0');
    let group = groupsByKey.get(key);
    if (group === undefined) {
      group = {
        candidates: [],
        compilerRank: index,
        id: 'wrapper-path:' + hashPreviewInspectorNeuralPageContextCandidateId(key)
          .toString(16).padStart(8, '0'),
        key,
      };
      groupsByKey.set(key, group);
    }
    group.candidates.push(candidate);
    groupByCandidateId.set(candidate.id, group);
    profileByCandidateId.set(candidate.id, createPreviewInspectorPageContextPathProfile(candidate));
  }
  const groups = [...groupsByKey.values()];
  const orderedCandidates = [];
  const diversityRankByCandidateId = new Map();
  const maximumVariants = groups.reduce(
    (maximum, group) => Math.max(maximum, group.candidates.length),
    0,
  );
  for (let variantIndex = 0; variantIndex < maximumVariants; variantIndex += 1) {
    for (const group of groups) {
      const candidate = group.candidates[variantIndex];
      if (candidate === undefined) continue;
      diversityRankByCandidateId.set(candidate.id, orderedCandidates.length);
      orderedCandidates.push(candidate);
    }
  }
  return {
    diversityRankByCandidateId,
    groupByCandidateId,
    groups,
    orderedCandidates,
    profileByCandidateId,
  };
}

/** Unions wrapper evidence retained by every mount checkpoint on one authored caller path. */
function createPreviewInspectorPageContextGroupProfile(group, inventory, representative) {
  const primary = inventory.profileByCandidateId.get(representative?.id) ??
    createPreviewInspectorPageContextPathProfile(representative);
  const kinds = [];
  const invocationModes = [];
  const callerNames = [];
  const wrapperNames = [];
  let conditionalCount = 0;
  for (const candidate of group.candidates) {
    const profile = inventory.profileByCandidateId.get(candidate.id) ??
      createPreviewInspectorPageContextPathProfile(candidate);
    conditionalCount = Math.max(conditionalCount, profile.conditionalCount);
    for (const [target, values] of [
      [kinds, profile.kinds],
      [invocationModes, profile.invocationModes],
      [callerNames, profile.callerNames],
      [wrapperNames, profile.wrapperNames],
    ]) {
      for (const value of values) {
        if (!target.includes(value)) target.push(value);
      }
    }
  }
  return { ...primary, callerNames, conditionalCount, invocationModes, kinds, wrapperNames };
}

/** Reconciles one bounded search record with the latest compiler candidate inventory. */
function readPreviewInspectorNeuralPageContextRecord(descriptor) {
  const candidates = readPreviewInspectorPageCandidates(descriptor);
  if (candidates.length === 0) return undefined;
  const inventory = createPreviewInspectorPageContextPathInventory(candidates);
  const records = initializePreviewInspectorNeuralPageContextRecords();
  const key = createPreviewInspectorNeuralPageContextKey(descriptor);
  let record = records.get(key);
  if (record === undefined) {
    record = {
      decisionByCandidateId: new Map(),
      evaluatedCandidateIds: new Set(),
      executionContractByCandidateId: new Map(),
      failedCandidateIds: new Set(),
      key,
      provisionalCandidateIds: new Set(),
      stabilityByCandidateId: new Map(),
      status: 'baseline',
      successfulCandidateIds: new Set(),
      unstableCandidateIds: new Set(),
    };
    records.set(key, record);
  }
  if (!(record.provisionalCandidateIds instanceof Set)) {
    record.provisionalCandidateIds = new Set();
  }
  if (!(record.unstableCandidateIds instanceof Set)) record.unstableCandidateIds = new Set();
  if (!(record.executionContractByCandidateId instanceof Map)) {
    record.executionContractByCandidateId = new Map();
  }
  if (!(record.stabilityByCandidateId instanceof Map)) {
    record.stabilityByCandidateId = new Map();
  }
  if (record.coverageBaseline === undefined) {
    record.coverageBaseline = createPreviewInspectorNeuralPageContextCoverageBaseline();
  }
  const candidateIds = new Set(candidates.map((candidate) => candidate?.id).filter((id) =>
    typeof id === 'string' && id.length > 0,
  ));
  for (const collection of [
    record.decisionByCandidateId,
    record.evaluatedCandidateIds,
    record.executionContractByCandidateId,
    record.failedCandidateIds,
    record.provisionalCandidateIds,
    record.stabilityByCandidateId,
    record.successfulCandidateIds,
    record.unstableCandidateIds,
  ]) {
    for (const candidateId of collection.keys()) {
      if (!candidateIds.has(candidateId)) collection.delete(candidateId);
    }
  }
  const verifiedCandidateId = previewInspectorSession.verifiedPageCandidateId;
  const verifiedScopeMatches = previewInspectorSession.verifiedPageContextScope ===
    createPreviewInspectorNeuralPageContextPersistedScope(descriptor);
  if (
    verifiedScopeMatches && typeof verifiedCandidateId === 'string' &&
    candidateIds.has(verifiedCandidateId)
  ) {
    if (!record.successfulCandidateIds.has(verifiedCandidateId)) {
      record.provisionalCandidateIds.add(verifiedCandidateId);
    }
  }
  record.candidateCount = candidates.length;
  record.coverageComplete = candidates.every((candidate) =>
    record.evaluatedCandidateIds.has(candidate?.id),
  );
  record.possibilityCount = inventory.groups.length;
  record.inventoryFingerprint = [...candidateIds].join('\0');
  records.delete(key);
  records.set(key, record);
  while (records.size > PREVIEW_INSPECTOR_NEURAL_PAGE_CONTEXT_RECORD_LIMIT) {
    records.delete(records.keys().next().value);
  }
  return record;
}

/** Collects bounded semantic evidence for one already-admitted page candidate. */
function createPreviewInspectorNeuralPageContextCandidateInput(candidate, index, inventory) {
  const steps = Array.isArray(candidate?.renderPath?.steps)
    ? candidate.renderPath.steps.slice(0, 16)
    : [];
  const profile = inventory?.profileByCandidateId?.get?.(candidate?.id) ??
    createPreviewInspectorPageContextPathProfile(candidate);
  const pathGroupSize = inventory?.groupByCandidateId?.get?.(candidate?.id)
    ?.candidates?.length ?? 1;
  const diversityRank = inventory?.diversityRankByCandidateId?.get?.(candidate?.id) ?? index;
  const targetName = candidate?.target?.exportName;
  const rootName = candidate?.root?.exportName;
  const route = candidate?.routeLocation;
  const modelId = 'page-context:' + hashPreviewInspectorNeuralPageContextCandidateId(
    String(candidate?.id ?? '') + '\0' + String(rootName ?? '') + '\0' +
      String(route?.componentName ?? ''),
  ).toString(16).padStart(8, '0');
  return {
    deterministicRank: diversityRank,
    id: modelId,
    numbers: {
      callerCount: profile.callerNames.length,
      complete: Number(candidate?.complete === true),
      compilerRank: index,
      conditionalCount: profile.conditionalCount,
      edgeCount: Array.isArray(candidate?.edges) ? candidate.edges.length : 0,
      entryConnected: Number(candidate?.renderPath?.entryPoint !== undefined),
      invocationModeCount: profile.invocationModes.length,
      pathDepth: steps.length,
      pathGroupSize,
      rootStepIndex: Number.isSafeInteger(candidate?.rootStepIndex)
        ? candidate.rootStepIndex + 1
        : 0,
      routeSlotCount: Number.isSafeInteger(candidate?.routeSlotCount)
        ? candidate.routeSlotCount
          : 0,
      wrapperCount: profile.wrapperNames.length,
      targetAffinity: Number(
        typeof targetName === 'string' &&
        targetName === previewInspectorSession.selectedExportName,
      ),
    },
    texts: [
      rootName,
      targetName,
      route?.componentName,
      candidate?.stopReason,
      profile.callerNames.join(' '),
      profile.pathSegments.join(' '),
      profile.wrapperNames.join(' '),
      steps.map((step) => [
        ...(Array.isArray(step?.wrapperNames) ? step.wrapperNames : []),
        step?.label,
      ].filter(Boolean).join(' ')).join(' '),
    ],
    runtimeCandidateId: candidate.id,
    tokens: [
      'complete:' + String(candidate?.complete === true),
      'entry-connected:' + String(candidate?.renderPath?.entryPoint !== undefined),
      'root-owns-router:' + String(candidate?.rootOwnsRouter === true),
      'route-evidence:' + String(route?.evidenceKind ?? 'none'),
      'route-inferred:' + String(typeof route?.pathname === 'string'),
      ...profile.invocationModes.map((mode) => 'invocation:' + mode),
      'component-callers:' + String(profile.callerNames.length),
      ...profile.kinds.map((kind) => 'wrapper-kind:' + kind),
      'virtual-page:' + String(candidate?.virtualPage?.mode ?? 'none'),
      'context-module:' + String(candidate?.contextModule?.evidenceKind ?? 'none'),
      'detached-target:' + String(candidate?.detachedTargetPlacement ?? 'none'),
      'stop:' + String(candidate?.stopReason ?? 'unknown'),
    ],
  };
}

/** Shares target-level context across every candidate decision at this exact page-choice hole. */
function createPreviewInspectorNeuralPageContextSpecification(descriptor, candidates, inventory) {
  const target = typeof readSelectedPreviewInspectorCandidateTarget === 'function'
    ? readSelectedPreviewInspectorCandidateTarget(descriptor)
    : descriptor?.inspector?.target;
  return {
    blockerKind: 'page-context',
    holeKind: 'page-choice-context',
    numbers: {
      candidateCount: candidates.length,
      possibilityCount: inventory?.groups?.length ?? candidates.length,
    },
    texts: [target?.exportName, previewInspectorSession.selectedExportName],
    tokens: [
      'compiler-admitted:true',
      'path-groups:' + String(inventory?.groups?.length ?? candidates.length),
      'target-kind:' + String(target?.kind ?? 'component'),
      'module-context:' + String(descriptor?.inspector?.contextModule !== undefined),
    ],
  };
}

/** Recreates the exact residual decision used for selection so only its verified outcome is trained. */
function createPreviewInspectorNeuralPageContextDecision(descriptor, candidate, index, inventory) {
  if (typeof createPreviewInspectorNeuralResidualDecision !== 'function') return undefined;
  const candidates = readPreviewInspectorPageCandidates(descriptor);
  const resolvedInventory = inventory ?? createPreviewInspectorPageContextPathInventory(candidates);
  const specification = createPreviewInspectorNeuralPageContextSpecification(
    descriptor,
    candidates,
    resolvedInventory,
  );
  const input = createPreviewInspectorNeuralPageContextCandidateInput(
    candidate,
    index,
    resolvedInventory,
  );
  return createPreviewInspectorNeuralResidualDecision({
    blockerKind: specification.blockerKind,
    candidateId: input.id,
    holeKind: specification.holeKind,
    numbers: { ...specification.numbers, ...input.numbers, deterministicRank: input.deterministicRank },
    texts: [...specification.texts, ...input.texts],
    tokens: [...specification.tokens, ...input.tokens, 'candidate:' + input.id],
  });
}

/** Chooses the most stable successful path, preferring the least invasive verified contract. */
function selectPreviewInspectorBestVerifiedPageContextCandidate(candidates, inventory, record) {
  return candidates.filter((candidate) =>
    typeof candidate?.id === 'string' && record.successfulCandidateIds.has(candidate.id),
  ).sort((left, right) => {
    const leftStability = record.stabilityByCandidateId.get(left.id) ?? {};
    const rightStability = record.stabilityByCandidateId.get(right.id) ?? {};
    const stabilityDifference = (Number(rightStability.stableCount) || 0) -
      (Number(leftStability.stableCount) || 0) ||
      (Number(leftStability.regressionCount) || 0) -
        (Number(rightStability.regressionCount) || 0);
    if (stabilityDifference !== 0) return stabilityDifference;
    const leftScore = Number(record.executionContractByCandidateId.get(left.id)?.snapshot?.score);
    const rightScore = Number(record.executionContractByCandidateId.get(right.id)?.snapshot?.score);
    if (Number.isFinite(leftScore) && Number.isFinite(rightScore) && leftScore !== rightScore) {
      return rightScore - leftScore;
    }
    const neuralDifference = typeof comparePreviewInspectorNeuralResidualDecisions === 'function'
      ? comparePreviewInspectorNeuralResidualDecisions(
          record.decisionByCandidateId.get(left.id),
          record.decisionByCandidateId.get(right.id),
        )
      : 0;
    return neuralDifference ||
      (inventory.diversityRankByCandidateId.get(left.id) ?? 0) -
        (inventory.diversityRankByCandidateId.get(right.id) ?? 0) ||
      left.id.localeCompare(right.id);
  })[0];
}

/**
 * Ranks a moving safe portfolio. Failed candidates leave the window, so a large finite inventory
 * is still exhausted in bounded batches without weakening the residual model's twelve-item limit.
 */
function selectPreviewInspectorNeuralPageContextCandidate(descriptor, options = {}) {
  const candidates = readPreviewInspectorPageCandidates(descriptor);
  if (candidates.length === 0) return undefined;
  const inventory = createPreviewInspectorPageContextPathInventory(candidates);
  const record = readPreviewInspectorNeuralPageContextRecord(descriptor);
  if (record === undefined) return undefined;
  const explicitId = previewInspectorSession.userSelectedPageCandidateId;
  const explicitIndex = candidates.findIndex((candidate) => candidate?.id === explicitId);
  if (explicitIndex >= 0) {
    const candidate = candidates[explicitIndex];
    const decision = createPreviewInspectorNeuralPageContextDecision(
      descriptor,
      candidate,
      explicitIndex,
      inventory,
    );
    if (decision !== undefined) record.decisionByCandidateId.set(candidate.id, decision);
    record.selectedCandidateId = candidate.id;
    record.selectionOrigin = 'user';
    record.status = 'user-selected';
    return { candidate, candidateCount: candidates.length, decision, origin: 'user' };
  }
  const preferredVerifiedIds = [
    previewInspectorSession.selectedPageCandidateId,
    descriptor?.inspector?.executablePageCandidateId,
    record.selectedCandidateId,
  ];
  const preferredVerifiedCandidate = preferredVerifiedIds.flatMap((candidateId) =>
    candidates.filter((candidate) =>
      candidate?.id === candidateId && record.successfulCandidateIds.has(candidate.id),
    )
  )[0] ?? candidates.find((candidate) =>
    typeof candidate?.id === 'string' && record.successfulCandidateIds.has(candidate.id),
  );
  const bestVerifiedCandidate = selectPreviewInspectorBestVerifiedPageContextCandidate(
    candidates,
    inventory,
    record,
  );
  const verifiedCandidate = record.coverageComplete === true
    ? bestVerifiedCandidate
    : preferredVerifiedCandidate;
  if (verifiedCandidate !== undefined && options.exploreUnevaluated !== true) {
    record.selectedCandidateId = verifiedCandidate.id;
    record.selectionReason = 'target-output-verified';
    record.status = 'verified';
    return {
      candidate: verifiedCandidate,
      candidateCount: candidates.length,
      decision: record.decisionByCandidateId.get(verifiedCandidate.id),
      origin: record.selectionOrigin ?? 'neural',
      portfolioCount: 0,
    };
  }
  const provisionalCandidate = preferredVerifiedIds.flatMap((candidateId) =>
    candidates.filter((candidate) =>
      candidate?.id === candidateId && record.provisionalCandidateIds.has(candidate.id),
    )
  )[0] ?? candidates.find((candidate) =>
    typeof candidate?.id === 'string' && record.provisionalCandidateIds.has(candidate.id),
  );
  if (provisionalCandidate !== undefined) {
    record.selectedCandidateId = provisionalCandidate.id;
    record.selectionOrigin = 'neural';
    record.selectionReason = 'persisted-output-requires-reverification';
    record.status = 'verifying';
    return {
      candidate: provisionalCandidate,
      candidateCount: candidates.length,
      decision: record.decisionByCandidateId.get(provisionalCandidate.id),
      origin: 'neural',
      portfolioCount: 0,
    };
  }
  const recoveryCandidate = typeof readPreviewInspectorNeuralPageContextRecoveryCandidate ===
      'function'
    ? readPreviewInspectorNeuralPageContextRecoveryCandidate(descriptor, record, candidates)
    : undefined;
  if (recoveryCandidate !== undefined) {
    const recoveryIndex = candidates.indexOf(recoveryCandidate);
    const decision = createPreviewInspectorNeuralPageContextDecision(
      descriptor,
      recoveryCandidate,
      recoveryIndex,
      inventory,
    );
    if (decision !== undefined) record.decisionByCandidateId.set(recoveryCandidate.id, decision);
    record.selectedCandidateId = recoveryCandidate.id;
    record.selectionOrigin = 'neural';
    record.selectionReason = 'component-recipe-full-page-replay';
    record.status = 'ranked';
    return {
      candidate: recoveryCandidate,
      candidateCount: candidates.length,
      decision,
      origin: 'neural',
      portfolioCount: 1,
    };
  }
  const eligible = inventory.orderedCandidates.filter((candidate) =>
    !record.failedCandidateIds.has(candidate?.id) &&
    (options.exploreUnevaluated !== true || !record.evaluatedCandidateIds.has(candidate?.id)),
  );
  if (eligible.length === 0) {
    record.coverageComplete = candidates.every((candidate) =>
      record.evaluatedCandidateIds.has(candidate?.id),
    );
    if (bestVerifiedCandidate === undefined) {
      record.status = 'exhausted';
      return undefined;
    }
    record.selectedCandidateId = bestVerifiedCandidate.id;
    record.selectionOrigin = 'neural';
    record.selectionReason = 'best-verified-execution-contract';
    record.status = bestVerifiedCandidate.id === descriptor?.inspector?.executablePageCandidateId
      ? 'verified'
      : 'switching';
    return {
      candidate: bestVerifiedCandidate,
      candidateCount: candidates.length,
      decision: record.decisionByCandidateId.get(bestVerifiedCandidate.id),
      origin: 'neural',
      portfolioCount: 0,
    };
  }
  const indexed = new Map(candidates.map((candidate, index) => [candidate?.id, index]));
  const portfolio = eligible
    .slice(0, PREVIEW_INSPECTOR_NEURAL_PAGE_CONTEXT_PORTFOLIO_LIMIT)
    .map((candidate) => createPreviewInspectorNeuralPageContextCandidateInput(
      candidate,
      indexed.get(candidate?.id) ?? 0,
      inventory,
    ));
  const specification = createPreviewInspectorNeuralPageContextSpecification(
    descriptor,
    candidates,
    inventory,
  );
  const selected = typeof selectPreviewInspectorNeuralResidualCandidate === 'function'
    ? selectPreviewInspectorNeuralResidualCandidate(specification, portfolio)
    : undefined;
  const selectedInput = portfolio.find((input) => input.id === selected?.candidateId);
  const candidate = candidates.find((item) =>
    item?.id === selectedInput?.runtimeCandidateId,
  ) ?? eligible[0];
  const index = indexed.get(candidate?.id) ?? 0;
  const decision = selected?.decision ?? createPreviewInspectorNeuralPageContextDecision(
    descriptor,
    candidate,
    index,
    inventory,
  );
  if (decision !== undefined) record.decisionByCandidateId.set(candidate.id, decision);
  const summary = typeof summarizePreviewInspectorNeuralResidualDecision === 'function'
    ? summarizePreviewInspectorNeuralResidualDecision(decision)
    : undefined;
  record.selectedCandidateId = candidate.id;
  record.selectionOrigin = Number(summary?.headUpdates ?? 0) > 0 ? 'neural' : 'deterministic';
  if (!['switching', 'verified', 'verifying'].includes(record.status)) {
    record.status = record.selectionOrigin === 'neural' ? 'ranked' : 'baseline';
  }
  return {
    candidate,
    candidateCount: candidates.length,
    decision,
    origin: record.selectionOrigin,
    portfolioCount: portfolio.length,
  };
}

/** Defers initial neural promotion until descriptor reconciliation has selected the target export. */
function schedulePreviewInspectorNeuralPageContextSelection() {
  previewInspectorSession.neuralPageContextScheduleRevision =
    (Number(previewInspectorSession.neuralPageContextScheduleRevision) || 0) + 1;
  const revision = previewInspectorSession.neuralPageContextScheduleRevision;
  Promise.resolve().then(() => {
    if (previewInspectorSession.neuralPageContextScheduleRevision !== revision) return;
    const descriptor = findSelectedPreviewInspectorDescriptor();
    const executableId = descriptor?.inspector?.executablePageCandidateId;
    const record = readPreviewInspectorNeuralPageContextRecord(descriptor);
    const verifiedCandidateId = previewInspectorSession.verifiedPageCandidateId;
    const verifiedScopeMatches = previewInspectorSession.verifiedPageContextScope ===
      createPreviewInspectorNeuralPageContextPersistedScope(descriptor);
    const restoringVerifiedCandidate = typeof verifiedCandidateId === 'string' &&
      verifiedScopeMatches && verifiedCandidateId.length > 0 &&
      verifiedCandidateId !== executableId &&
      readPreviewInspectorPageCandidates(descriptor).some((candidate) =>
        candidate?.id === verifiedCandidateId);
    if (
      typeof executableId === 'string' && executableId.length > 0 &&
      record?.evaluatedCandidateIds?.has?.(executableId) !== true &&
      !restoringVerifiedCandidate
    ) return;
    const selected = selectPreviewInspectorNeuralPageContextCandidate(descriptor);
    if (
      selected?.origin === 'user' ||
      typeof selected?.candidate?.id !== 'string' ||
      selected.candidate.id === executableId ||
      previewInspectorSession.pendingPageCandidateId !== undefined
    ) return;
    selectPreviewInspectorPageCandidate(selected.candidate.id, {
      origin: 'neural-page-context',
    });
  });
}

/** Records the executable candidate and schedules a learned promotion when one is available. */
function reconcilePreviewInspectorNeuralPageContextSelection(descriptor) {
  const selected = selectPreviewInspectorNeuralPageContextCandidate(descriptor);
  const record = readPreviewInspectorNeuralPageContextRecord(descriptor);
  if (record !== undefined) {
    const executableCandidateId = descriptor?.inspector?.executablePageCandidateId;
    record.executableCandidateId = executableCandidateId;
    if (
      typeof executableCandidateId === 'string' &&
      record.pendingExecutionContractCandidateId === executableCandidateId &&
      record.evaluatedCandidateIds.has(executableCandidateId) !== true
    ) {
      record.selectedCandidateId = executableCandidateId;
      record.selectionOrigin = 'neural';
      record.selectionReason = 'candidate-artifact-committed';
      record.status = 'verifying';
    }
    if (
      record.pendingExecutionContractCandidateId === executableCandidateId &&
      typeof schedulePreviewInspectorNeuralPageContextExecutionContractActivation === 'function'
    ) {
      schedulePreviewInspectorNeuralPageContextExecutionContractActivation(executableCandidateId);
    }
  }
  schedulePreviewInspectorNeuralPageContextSelection();
  return selected;
}

/** Marks manual selection as authoritative without manufacturing a training label. */
function recordPreviewInspectorUserPageContextSelection(candidateId) {
  const descriptor = findSelectedPreviewInspectorDescriptor();
  const record = readPreviewInspectorNeuralPageContextRecord(descriptor);
  if (record === undefined) return;
  record.selectedCandidateId = candidateId;
  record.selectionOrigin = 'user';
  record.status = 'user-selected';
}

/** Tracks the host hand-off separately from target-output success or failure. */
function handlePreviewInspectorNeuralPageContextSelectionStatus(message) {
  if (previewInspectorSession.pendingPageCandidateOrigin !== 'neural-page-context') return;
  const descriptor = findSelectedPreviewInspectorDescriptor();
  const record = readPreviewInspectorNeuralPageContextRecord(descriptor);
  if (record === undefined) return;
  if (message?.status === 'committed') {
    record.status = 'verifying';
    record.selectionReason = 'candidate-artifact-committed';
  } else if (['failed', 'cancelled', 'rejected'].includes(message?.status)) {
    record.status = 'selection-error';
    record.selectionReason = 'candidate-artifact-' + String(message.status);
  }
}

/** Emits a compact page-choice health event without feature vectors or absolute source paths. */
function recordPreviewInspectorNeuralPageContextHealth(record, candidate, update, outcome, state) {
  if (typeof recordPreviewInspectorRuntimeHealth !== 'function') return;
  recordPreviewInspectorRuntimeHealth({
    category: 'page-context',
    detail: {
      candidateCount: record.candidateCount,
      candidateId: candidate?.id,
      evaluatedCandidateCount: record.evaluatedCandidateIds.size,
      failedCandidateCount: record.failedCandidateIds.size,
      headKey: update?.headKey ?? 'page-choice',
      headUpdates: update?.headUpdates ?? 0,
      outcome,
      pageRootCommitted: state?.pageRootCommitted === true,
      possibilityCount: record.possibilityCount,
      successfulCandidateCount: record.successfulCandidateIds.size,
      targetHasOutput: state?.targetHasOutput === true,
    },
    event: 'neural-page-context-' + outcome,
  });
}

/** Resolves the active compiler candidate for a target verifier state without trusting UI state. */
function observeCurrentPreviewInspectorNeuralPageContextOutcome(state) {
  if (state === undefined || typeof findSelectedPreviewInspectorDescriptor !== 'function') {
    return false;
  }
  const descriptor = findSelectedPreviewInspectorDescriptor();
  const candidate = readPreviewInspectorPageCandidates(descriptor).find(
    (item) => item?.id === state.candidateId,
  );
  return candidate === undefined
    ? false
    : observePreviewInspectorNeuralPageContextOutcome(descriptor, candidate, state);
}

/** Marks newly visible output as provisional until delayed host-output checks promote it. */
function markPreviewInspectorNeuralPageContextProvisional(state) {
  if (state === undefined || typeof findSelectedPreviewInspectorDescriptor !== 'function') {
    return false;
  }
  const descriptor = findSelectedPreviewInspectorDescriptor();
  const candidate = readPreviewInspectorPageCandidates(descriptor).find(
    (item) => item?.id === state.candidateId,
  );
  const record = readPreviewInspectorNeuralPageContextRecord(descriptor);
  if (candidate === undefined || record === undefined || state.directTarget === true) return false;
  record.provisionalCandidateIds.add(candidate.id);
  record.selectionReason = 'visible-output-stability-check';
  record.status = 'verifying';
  return true;
}

/** Clears an abandoned provisional label without teaching either success or failure. */
function clearPreviewInspectorNeuralPageContextProvisional(candidateId) {
  if (
    typeof candidateId !== 'string' ||
    typeof findSelectedPreviewInspectorDescriptor !== 'function'
  ) return false;
  const descriptor = findSelectedPreviewInspectorDescriptor();
  const record = readPreviewInspectorNeuralPageContextRecord(descriptor);
  if (record?.provisionalCandidateIds?.delete?.(candidateId) !== true) return false;
  if (record.status === 'verifying') record.status = 'baseline';
  return true;
}

/** Converts only the target verifier's terminal corridor warning into a negative page label. */
function observePreviewInspectorNeuralPageContextConsoleEntry(entry) {
  if (
    entry?.source !== 'target-reachability' ||
    entry?.phase !== 'page render corridor' ||
    !(previewInspectorSession.targetReachabilityByKey instanceof Map)
  ) return false;
  const active = previewInspectorSession.targetReachabilityByKey.get(
    previewInspectorSession.activeTargetReachabilityKey,
  );
  const state = active?.status === 'page-blocked'
    ? active
    : [...previewInspectorSession.targetReachabilityByKey.values()].find((candidate) =>
        candidate?.status === 'page-blocked' &&
        candidate?.candidateId === previewInspectorSession.selectedPageCandidateId,
      );
  return observeCurrentPreviewInspectorNeuralPageContextOutcome(state);
}

/**
 * Trains only after target-level verification. Intermediate loading and recoverable exceptions do
 * not become negative examples; a terminal page-blocked state advances to the next finite path.
 */
function observePreviewInspectorNeuralPageContextOutcome(descriptor, candidate, state) {
  if (
    descriptor === undefined || candidate === undefined || state?.directTarget === true ||
    typeof candidate?.id !== 'string'
  ) return false;
  const success = state.neuralStableOutputVerified === true &&
    state.pageRootCommitted === true && state.targetHasOutput === true &&
    (state.targetMounted === true || state.targetWasMounted === true) &&
    (typeof hasPreviewInspectorCompletePageExecutionContext !== 'function' ||
      hasPreviewInspectorCompletePageExecutionContext(state));
  const pageExecutionContextComplete =
    typeof hasPreviewInspectorCompletePageExecutionContext !== 'function' ||
    hasPreviewInspectorCompletePageExecutionContext(state);
  const failure = (state.targetHasOutput !== true || !pageExecutionContextComplete) && (
    state.neuralStableOutputRegressed === true ||
    state.status === 'page-blocked' && state.exhausted === true
  );
  if (!success && !failure) return false;
  const outcome = success ? 'verified' : 'failed';
  if (state.neuralPageContextOutcome === outcome) return false;
  state.neuralPageContextOutcome = outcome;
  const candidates = readPreviewInspectorPageCandidates(descriptor);
  const index = candidates.findIndex((item) => item?.id === candidate.id);
  if (index < 0) return false;
  const record = readPreviewInspectorNeuralPageContextRecord(descriptor);
  if (record === undefined) return false;
  if (success) {
    capturePreviewInspectorNeuralPageContextExecutionContract(record, candidate, index, state);
  }
  const decision = record.decisionByCandidateId.get(candidate.id) ??
    createPreviewInspectorNeuralPageContextDecision(descriptor, candidate, index);
  if (decision !== undefined) record.decisionByCandidateId.set(candidate.id, decision);
  const update = typeof trainPreviewInspectorNeuralResidualDecision === 'function'
    ? trainPreviewInspectorNeuralResidualDecision(decision, success ? 1 : 0)
    : undefined;
  record.evaluatedCandidateIds.add(candidate.id);
  record.selectedCandidateId = candidate.id;
  const stability = record.stabilityByCandidateId.get(candidate.id) ?? {
    regressionCount: 0,
    stableCount: 0,
  };
  if (success) {
    previewInspectorSession.neuralPageContextScheduleRevision =
      (Number(previewInspectorSession.neuralPageContextScheduleRevision) || 0) + 1;
    record.failedCandidateIds.delete(candidate.id);
    record.provisionalCandidateIds.delete(candidate.id);
    record.successfulCandidateIds.add(candidate.id);
    record.unstableCandidateIds.delete(candidate.id);
    stability.stableCount += 1;
    record.selectionOrigin = previewInspectorSession.userSelectedPageCandidateId === candidate.id
      ? 'user'
      : 'neural';
    record.selectionReason = 'target-output-verified';
    record.status = 'verified';
    const verifiedPageContextScope =
      createPreviewInspectorNeuralPageContextPersistedScope(descriptor);
    const verifiedCandidateChanged =
      previewInspectorSession.verifiedPageCandidateId !== candidate.id ||
      previewInspectorSession.verifiedPageContextScope !== verifiedPageContextScope;
    previewInspectorSession.verifiedPageCandidateId = candidate.id;
    previewInspectorSession.verifiedPageContextScope = verifiedPageContextScope;
    if (
      verifiedCandidateChanged &&
      typeof persistPreviewInspectorState === 'function'
    ) persistPreviewInspectorState();
  } else {
    record.failedCandidateIds.add(candidate.id);
    record.provisionalCandidateIds.delete(candidate.id);
    record.successfulCandidateIds.delete(candidate.id);
    record.unstableCandidateIds.add(candidate.id);
    stability.regressionCount += 1;
    record.selectionReason = !pageExecutionContextComplete
      ? 'component-output-missing-page-context'
      : state.neuralStableOutputRegressed === true
        ? 'visible-output-regressed'
        : 'page-blocked-verified';
    record.status = 'searching';
    if (
      previewInspectorSession.verifiedPageCandidateId === candidate.id &&
      previewInspectorSession.verifiedPageContextScope ===
        createPreviewInspectorNeuralPageContextPersistedScope(descriptor)
    ) {
      previewInspectorSession.verifiedPageCandidateId = '';
      previewInspectorSession.verifiedPageContextScope = '';
      if (typeof persistPreviewInspectorState === 'function') persistPreviewInspectorState();
    }
  }
  record.stabilityByCandidateId.set(candidate.id, stability);
  recordPreviewInspectorNeuralPageContextHealth(record, candidate, update, outcome, state);
  if (
    success ||
    typeof previewInspectorSession.userSelectedPageCandidateId === 'string' &&
      previewInspectorSession.userSelectedPageCandidateId.length > 0
  ) return true;
  const next = selectPreviewInspectorNeuralPageContextCandidate(descriptor, {
    exploreUnevaluated: true,
  });
  if (next?.candidate?.id === undefined || next.candidate.id === candidate.id) {
    record.status = 'exhausted';
    return true;
  }
  record.status = 'switching';
  record.selectionReason = 'trying-next-compiler-proven-candidate';
  preparePreviewInspectorNeuralPageContextExecutionContract(descriptor, next.candidate.id, 'neural');
  selectPreviewInspectorPageCandidate(next.candidate.id, {
    origin: 'neural-page-context',
  });
  return true;
}

/** Continues across caller/HOC mount paths only after the current path's inner sweep has settled. */
function continuePreviewInspectorNeuralPageContextCoverage() {
  if (
    typeof findSelectedPreviewInspectorDescriptor !== 'function' ||
    typeof previewInspectorSession.userSelectedPageCandidateId === 'string' &&
      previewInspectorSession.userSelectedPageCandidateId.length > 0 ||
    previewInspectorSession.pendingPageCandidateId !== undefined
  ) return false;
  const descriptor = findSelectedPreviewInspectorDescriptor();
  const record = readPreviewInspectorNeuralPageContextRecord(descriptor);
  const currentId = descriptor?.inspector?.executablePageCandidateId ??
    previewInspectorSession.selectedPageCandidateId;
  if (record === undefined || record.evaluatedCandidateIds.has(currentId) !== true) return false;
  const next = selectPreviewInspectorNeuralPageContextCandidate(descriptor, {
    exploreUnevaluated: true,
  });
  if (next?.candidate?.id === undefined) {
    record.status = 'exhausted';
    return false;
  }
  if (next.candidate.id === currentId) {
    record.coverageComplete = true;
    record.selectionReason = 'best-verified-execution-contract';
    record.status = 'verified';
    return false;
  }
  record.status = 'switching';
  record.selectionReason = record.coverageComplete === true
    ? 'restoring-best-verified-execution-contract'
    : 'testing-next-caller-wrapper-contract';
  preparePreviewInspectorNeuralPageContextExecutionContract(
    descriptor,
    next.candidate.id,
    'neural',
  );
  return selectPreviewInspectorPageCandidate(next.candidate.id, {
    origin: 'neural-page-context',
  });
}

`;
}
