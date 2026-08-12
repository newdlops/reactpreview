/**
 * Generates target-guided application-path traversal for React Page Inspector.
 *
 * A valid login, permission, loading, or empty branch can omit the component selected in the
 * editor, so the wrapped export becomes a reachability assertion rather than an error assertion.
 * One instrumented gate advances per commit; success requires the authored page root and selected
 * target in one corridor. Direct rendering remains an explicit diagnostic mode.
 */
import { createPreviewInspectorRequirementFrontierRuntimeSource } from './previewInspectorRequirementFrontierRuntimeSource';
import { createPreviewInspectorRequirementConvergenceRuntimeSource } from './previewInspectorRequirementConvergenceRuntimeSource';
import { createPreviewInspectorPageTabActivationRuntimeSource } from './previewInspectorPageTabActivationRuntimeSource';
import { createPreviewInspectorTargetPathEvidenceRuntimeSource } from './previewInspectorTargetPathEvidenceRuntimeSource';
/**
 * Creates browser source for bounded DFS page traversal and explicit target-only diagnostics.
 *
 * Expected lexical bindings include React, the shared Inspector session/store, condition, data, and
 * runtime-fallback registries, plus notification and console helpers from the composed entry.
 *
 * @returns Plain JavaScript source concatenated into the Page Inspector browser runtime.
 */
export function createPreviewInspectorTargetReachabilityRuntimeSource(): string {
  const requirementFrontierRuntimeSource = createPreviewInspectorRequirementFrontierRuntimeSource();
  const requirementConvergenceRuntimeSource =
    createPreviewInspectorRequirementConvergenceRuntimeSource();
  const pageTabActivationRuntimeSource = createPreviewInspectorPageTabActivationRuntimeSource();
  const targetPathEvidenceRuntimeSource = createPreviewInspectorTargetPathEvidenceRuntimeSource();
  return String.raw`
const PREVIEW_INSPECTOR_TARGET_REACHABILITY_PASS_LIMIT = 16;
const PREVIEW_INSPECTOR_TARGET_REACHABILITY_IDLE_LIMIT = 2;
const PREVIEW_INSPECTOR_MINIMUM_REQUIREMENT_PASS_LIMIT = 8;
const PREVIEW_INSPECTOR_TARGET_INITIAL_PROBE_DELAY_MS = 160;
const PREVIEW_INSPECTOR_TARGET_CONTINUATION_PROBE_DELAY_MS = 48;
const PREVIEW_INSPECTOR_TARGET_DIRECT_PROBE_DELAY_MS = 32;
${requirementFrontierRuntimeSource}
${requirementConvergenceRuntimeSource}
${pageTabActivationRuntimeSource}
${targetPathEvidenceRuntimeSource}
/** Lazily initializes ephemeral traversal state retained only by the pinned preview webview. */
function initializePreviewInspectorTargetReachabilityState() {
  if (!(previewInspectorSession.targetReachabilityByKey instanceof Map)) {
    previewInspectorSession.targetReachabilityByKey = new Map();
  }
  if (!(previewInspectorSession.minimumRequirementSearchByKey instanceof Map)) {
    previewInspectorSession.minimumRequirementSearchByKey = new Map();
  }
  if (!(previewInspectorSession.contextualTargetFallbackCountByKey instanceof Map)) {
    previewInspectorSession.contextualTargetFallbackCountByKey = new Map();
  }
  if (!(previewInspectorSession.contextualTargetFallbackCapabilitiesByKey instanceof Map)) {
    previewInspectorSession.contextualTargetFallbackCapabilitiesByKey = new Map();
  }
  if (!(previewInspectorSession.contextualTargetFallbackRolesByKey instanceof Map)) {
    previewInspectorSession.contextualTargetFallbackRolesByKey = new Map();
  }
  if (!(previewInspectorSession.contextualTargetFallbackClaimsByKey instanceof Map)) {
    previewInspectorSession.contextualTargetFallbackClaimsByKey = new Map();
  }
}

/** Validates the one opaque role issued to a live generated retained-route registration. */
function validatePreviewInspectorContextualBoundaryRoleToken(roleToken, metadata) {
  initializePreviewInspectorTargetReachabilityState();
  if ((typeof roleToken !== 'object' && typeof roleToken !== 'function') || roleToken === null) return undefined;
  const sourcePath = typeof metadata?.sourcePath === 'string' ? metadata.sourcePath.replaceAll('\\\\', '/') : '';
  const exportName = typeof metadata?.exportName === 'string' ? metadata.exportName : '';
  const key = typeof roleToken?.key === 'string' ? roleToken.key : '';
  const state = previewInspectorSession.targetReachabilityByKey.get(key);
  const roles = previewInspectorSession.contextualTargetFallbackRolesByKey.get(key);
  const registrations = previewInspectorSession.contextualTargetFallbackCapabilitiesByKey.get(key);
  const claim = previewInspectorSession.contextualTargetFallbackClaimsByKey.get(key);
  if (
    key.length === 0 || sourcePath.length === 0 || exportName.length === 0 ||
    roles?.get(roleToken) !== claim?.owner || roles.size !== 1 ||
    !(registrations instanceof Map) || registrations.size !== 1 ||
    (previewInspectorSession.contextualTargetFallbackCountByKey.get(key) ?? 0) !== 1 ||
    state?.key !== key || state.targetSourcePath !== sourcePath ||
    state.targetExportName !== exportName || state.contextualTargetFallbackRequested !== true ||
    claim?.status !== 'committed' || claim.key !== key || claim.roleToken !== roleToken ||
    previewInspectorSession.activeTargetReachabilityKey !== key
  ) return undefined;
  return { key, role: 'retained-route' };
}

/** Narrows post-latch consumers to the unique live extension-owned outer boundary. */
function readPreviewInspectorContextualTargetBoundary(state) {
  if (state?.contextualTargetFallbackRequested !== true) return undefined;
  const boundaries = readPreviewInspectorTargetBoundaries(state);
  const matches = [...boundaries].filter((boundary) =>
    boundary?.props?.contextualBoundaryRole === 'retained-route' &&
    boundary?.props?.contextualBoundaryKey === state.key &&
    hasPreviewInspectorOwnedBoundary(boundary, state) === true &&
    boundary?.state?.error === undefined &&
    validatePreviewInspectorContextualBoundaryRoleToken(
      [...(previewInspectorSession.contextualTargetFallbackRolesByKey.get(state.key)?.keys?.() ?? [])][0],
      { exportName: state.targetExportName, sourcePath: state.targetSourcePath },
    ) !== undefined,
  );
  return matches.length === 1 ? matches[0] : undefined;
}

/** Explains only why the live contextual boundary selector currently fails closed. */
function readPreviewInspectorContextualTargetBoundaryFailure(state) {
  if (state?.contextualTargetFallbackRequested !== true) return 'not-requested';
  const boundaries = readPreviewInspectorTargetBoundaries(state);
  if (!(boundaries instanceof Set) || boundaries.size === 0) return 'no-boundary';
  const contextual = [...boundaries].filter((boundary) =>
    boundary?.props?.contextualBoundaryRole === 'retained-route' &&
    boundary?.props?.contextualBoundaryKey === state.key,
  );
  if (contextual.length === 0) return 'role-key-mismatch';
  if (contextual.length !== 1) return 'multiple-boundaries';
  const boundary = contextual[0];
  if (hasPreviewInspectorOwnedBoundary(boundary, state) !== true) return 'ownership-mismatch';
  if (boundary?.state?.error !== undefined) return 'boundary-error';
  const roles = previewInspectorSession.contextualTargetFallbackRolesByKey.get(state.key);
  if (!(roles instanceof Map) || roles.size !== 1) return 'role-count';
  const registrations = previewInspectorSession.contextualTargetFallbackCapabilitiesByKey.get(state.key);
  if (!(registrations instanceof Map) || registrations.size !== 1) return 'registration-count';
  if ((previewInspectorSession.contextualTargetFallbackCountByKey.get(state.key) ?? 0) !== 1) {
    return 'fallback-count';
  }
  const claim = previewInspectorSession.contextualTargetFallbackClaimsByKey.get(state.key);
  const [roleToken, owner] = roles.entries().next().value ?? [];
  if (claim?.status !== 'committed' || claim.key !== state.key) return 'claim-status';
  if (claim.owner !== owner) return 'claim-owner';
  if (claim.roleToken !== roleToken) return 'claim-role-token';
  if (previewInspectorSession.activeTargetReachabilityKey !== state.key) return 'inactive-key';
  if (validatePreviewInspectorContextualBoundaryRoleToken(
    roleToken,
    { exportName: state.targetExportName, sourcePath: state.targetSourcePath },
  ) === undefined) return 'role-token-invalid';
  return 'eligible-but-unselected';
}

/** Reports whether a generated Page Execution root can mount its exact selected target as a sibling. */
function hasPreviewInspectorContextualTargetFallback(key) {
  initializePreviewInspectorTargetReachabilityState();
  return (previewInspectorSession.contextualTargetFallbackCountByKey.get(key) ?? 0) > 0;
}

/** Reads one uniquely registered compiler capability without retaining route elements or components. */
function readPreviewInspectorMountedTransparentChildrenCapability(key) {
  initializePreviewInspectorTargetReachabilityState();
  const registrations = previewInspectorSession.contextualTargetFallbackCapabilitiesByKey.get(key);
  if (!(registrations instanceof Map) || registrations.size !== 1) return undefined;
  const [signature, count] = registrations.entries().next().value ?? [];
  return count === 1 && signature === 'mounted-transparent-children:retained-route-page'
    ? { mountedTransparentChildren: true, retainedRoutePage: true }
    : undefined;
}

/** Builds one bounded, fixed-order observation of the V27 mounted-children gate. */
function readPreviewInspectorMountedTransparentChildrenGateDecision(state) {
  const chain = typeof readPreviewInspectorTargetRenderCommitChain === 'function'
    ? readPreviewInspectorTargetRenderCommitChain(state.key)
    : undefined;
  const boundaries = state.contextualTargetFallbackRequested === true
    ? new Set([readPreviewInspectorContextualTargetBoundary(state)].filter(Boolean))
    : readPreviewInspectorTargetBoundaries(state);
  const registrationCount = Math.max(0,
    previewInspectorSession.contextualTargetFallbackCountByKey?.get?.(state.key) ?? 0);
  const registrations = previewInspectorSession.contextualTargetFallbackCapabilitiesByKey?.get?.(state.key);
  const registrationConflict = !(registrations instanceof Map) || registrations.size !== 1 ||
    registrationCount !== 1;
  const [capabilitySignature, capabilityCount] = registrations instanceof Map
    ? registrations.entries().next().value ?? []
    : [];
  const transparentCapability = capabilitySignature ===
    'mounted-transparent-children:retained-route-page' && capabilityCount === 1;
  const retainedRouteAvailable = registrationCount > 0;
  const retainedRouteOwned = transparentCapability === true && registrationConflict !== true;
  const decision = {
    latchBefore: state.contextualTargetFallbackRequested === true,
    directTarget: state.directTarget === true,
    pageRootCommitted: state.pageRootCommitted === true,
    currentMount: state.targetMounted === true,
    targetOutput: state.targetHasOutput === true,
    repairError: state.pendingTargetRepairFailure !== undefined,
    activeKey: previewInspectorSession.activeTargetReachabilityKey === state.key,
    renderError: hasPreviewInspectorTargetRenderError(state) === true,
    registrationCount,
    registrationConflict,
    transparentCapability,
    retainedRouteAvailable,
    retainedRouteOwned,
    boundaryCount: boundaries instanceof Set ? boundaries.size : 0,
    chainAvailable: chain !== undefined,
    alternateFiber: chain?.alternateFiberObserved === true,
    stableRerender: chain?.stableRerenderObserved === true,
    markedCall: chain?.markedContextCallUsed === true,
    effectCompleted: chain?.effectCompletedAfterMarkedCall === true,
    logicalTargetCount: Number.isSafeInteger(chain?.logicalTargetCount)
      ? Math.max(0, chain.logicalTargetCount)
      : 0,
    inputChildrenState: chain?.inputChildrenState === 'absent'
      ? 'absent'
      : 'meaningful-or-unsupported',
    returnedChild: chain?.returnedChildObserved === true,
    ownedHost: chain?.ownedHostObserved === true,
    latchAfter: false,
    requestAttempted: true,
    requestAccepted: false,
    notificationIssued: false,
  };
  decision.mountedChildrenGateFirstReject = decision.latchBefore ? 'prior-latch-set'
    : decision.directTarget ? 'direct-target'
    : !decision.pageRootCommitted ? 'page-root-not-committed'
    : !decision.currentMount ? 'current-mount-not-observed'
    : decision.targetOutput ? 'target-output-observed'
    : decision.repairError ? 'repair-error-present'
    : !decision.activeKey ? 'active-key-not-owned'
    : decision.renderError ? 'render-error-present'
    : decision.registrationCount !== 1 ? 'registration-not-unique'
    : decision.registrationConflict ? 'registration-conflict'
    : !decision.transparentCapability ? 'transparent-capability-unavailable'
    : !decision.retainedRouteAvailable ? 'retained-route-unavailable'
    : !decision.retainedRouteOwned ? 'retained-route-not-owned'
    : decision.boundaryCount !== 1 ? 'boundary-count-not-one'
    : !decision.chainAvailable ? 'render-chain-unavailable'
    : !decision.alternateFiber ? 'alternate-fiber-not-observed'
    : !decision.stableRerender ? 'stable-rerender-not-observed'
    : !decision.markedCall ? 'marked-context-call-not-used'
    : !decision.effectCompleted ? 'effect-not-completed-after-marked-call'
    : decision.logicalTargetCount !== 1 ? 'logical-target-count-not-one'
    : decision.inputChildrenState !== 'absent' ? 'input-children-not-absent'
    : decision.returnedChild ? 'returned-child-observed'
    : decision.ownedHost ? 'owned-host-observed'
    : 'none';
  return decision;
}

/** Admits only the V21 mounted wrapper after its exact empty render chain has settled. */
function canRequestPreviewInspectorMountedTransparentChildrenFallback(state, decision) {
  decision ??= readPreviewInspectorMountedTransparentChildrenGateDecision(state);
  state.mountedChildrenGateDecision = decision;
  return decision.mountedChildrenGateFirstReject === 'none';
}

/**
 * Mounts the selected facade once after the authentic page corridor has conclusively omitted it.
 * The page root remains mounted, so this is contextual recovery rather than target-only mode.
 */
function requestPreviewInspectorContextualTargetFallback(state) {
  if (state === undefined) return false;
  const roles = previewInspectorSession.contextualTargetFallbackRolesByKey.get(state.key);
  const registrations = previewInspectorSession.contextualTargetFallbackCapabilitiesByKey.get(state.key);
  const claim = previewInspectorSession.contextualTargetFallbackClaimsByKey.get(state.key);
  const [roleToken, owner] = roles?.entries?.().next().value ?? [];
  if (state.contextualTargetFallbackRequested === true) {
    return state.directTarget !== true &&
      state.pageRootCommitted === true &&
      state.targetHasOutput !== true &&
      state.pendingTargetRepairFailure === undefined &&
      previewInspectorSession.activeTargetReachabilityKey === state.key &&
      !hasPreviewInspectorTargetRenderError(state) &&
      roles?.size === 1 &&
      registrations instanceof Map && registrations.size === 1 &&
      (previewInspectorSession.contextualTargetFallbackCountByKey.get(state.key) ?? 0) === 1 &&
      claim?.status === 'committed' && claim.key === state.key &&
      claim.owner === owner && claim.roleToken === roleToken;
  }
  const mountedTransparentChildren = state?.targetMounted === true;
  const mountedDecision = mountedTransparentChildren
    ? readPreviewInspectorMountedTransparentChildrenGateDecision(state)
    : undefined;
  if (mountedDecision !== undefined) state.mountedChildrenGateDecision = mountedDecision;
  if (
    state.directTarget === true ||
    state.pageRootCommitted !== true ||
    (mountedTransparentChildren
      ? !canRequestPreviewInspectorMountedTransparentChildrenFallback(state, mountedDecision)
      : state.targetWasMounted === true) ||
    state.targetHasOutput === true ||
    state.pendingTargetRepairFailure !== undefined ||
    previewInspectorSession.activeTargetReachabilityKey !== state.key ||
    !hasPreviewInspectorContextualTargetFallback(state.key) ||
    hasPreviewInspectorTargetRenderError(state)
  ) return false;
  if (
    roles?.size !== 1 ||
    !(registrations instanceof Map) || registrations.size !== 1 ||
    (previewInspectorSession.contextualTargetFallbackCountByKey.get(state.key) ?? 0) !== 1 ||
    claim?.status !== 'reserved' || claim.key !== state.key ||
    claim.owner !== owner || claim.roleToken !== roleToken
  ) return false;
  if (mountedDecision !== undefined) mountedDecision.requestAccepted = true;
  claim.status = 'committed';
  state.contextualTargetFallbackRequested = true;
  if (mountedDecision !== undefined) mountedDecision.latchAfter = true;
  state.detachedTargetPlacement = mountedTransparentChildren
    ? 'mounted-transparent-children'
    : 'deferred-sibling';
  state.exhausted = false;
  state.idlePasses = 0;
  state.status = 'mounting-contextual-target';
  state.probeRevision = (Number.isSafeInteger(state.probeRevision) ? state.probeRevision : 0) + 1;
  if (mountedDecision !== undefined) mountedDecision.notificationIssued = true;
  notifyPreviewInspector();
  schedulePreviewInspectorTreeRefresh();
  schedulePreviewInspectorCommitRefresh();
  return true;
}

/** Registers one generated fallback without retaining component or DOM references in session state. */
function registerPreviewInspectorContextualTargetFallback(key, rawCapability, owner) {
  initializePreviewInspectorTargetReachabilityState();
  if (
    typeof key !== 'string' || key.length === 0 ||
    (typeof owner !== 'object' && typeof owner !== 'function') || owner === null
  ) return () => {};
  const counts = previewInspectorSession.contextualTargetFallbackCountByKey;
  counts.set(key, (counts.get(key) ?? 0) + 1);
  const capability = rawCapability?.mountedTransparentChildren === true &&
    rawCapability?.retainedRoutePage === true
    ? 'mounted-transparent-children:retained-route-page'
    : 'ordinary-contextual-fallback';
  const registrations = previewInspectorSession.contextualTargetFallbackCapabilitiesByKey;
  const capabilityCounts = registrations.get(key) ?? new Map();
  capabilityCounts.set(capability, (capabilityCounts.get(capability) ?? 0) + 1);
  registrations.set(key, capabilityCounts);
  const roles = previewInspectorSession.contextualTargetFallbackRolesByKey;
  const roleToken = { key };
  const roleEntries = roles.get(key) ?? new Map();
  roleEntries.set(roleToken, owner);
  roles.set(key, roleEntries);
  const claims = previewInspectorSession.contextualTargetFallbackClaimsByKey;
  const currentClaim = claims.get(key);
  const uniquelyRegistered =
    (counts.get(key) ?? 0) === 1 && roleEntries.size === 1 && capabilityCounts.size === 1;
  if (
    currentClaim !== undefined && currentClaim.owner === owner && currentClaim.key === key &&
    (currentClaim.status === 'reserved' || currentClaim.status === 'committed')
  ) {
    currentClaim.generation += 1;
    currentClaim.roleToken = roleToken;
  } else if (currentClaim === undefined && uniquelyRegistered) {
    claims.set(key, { generation: 0, key, owner, roleToken, status: 'reserved' });
  }
  const state = previewInspectorSession.targetReachabilityByKey.get(key);
  if (state?.status === 'page-blocked') requestPreviewInspectorContextualTargetFallback(state);
  let registered = true;
  const release = () => {
    if (!registered) return;
    registered = false;
    const nextCount = Math.max(0, (counts.get(key) ?? 1) - 1);
    if (nextCount === 0) counts.delete(key);
    else counts.set(key, nextCount);
    const nextCapabilityCount = Math.max(0, (capabilityCounts.get(capability) ?? 1) - 1);
    if (nextCapabilityCount === 0) capabilityCounts.delete(capability);
    else capabilityCounts.set(capability, nextCapabilityCount);
    if (capabilityCounts.size === 0) registrations.delete(key);
    roleEntries.delete(roleToken);
    if (roleEntries.size === 0) roles.delete(key);
    const claim = claims.get(key);
    const generation = claim?.generation;
    if (claim?.key === key && claim.owner === owner && claim.roleToken === roleToken) {
      queueMicrotask(() => {
        const current = claims.get(key);
        const currentState = previewInspectorSession.targetReachabilityByKey.get(key);
        if (
          current !== claim || current?.generation !== generation || current.key !== key ||
          current.owner !== owner || current.roleToken !== roleToken ||
          previewInspectorSession.contextualTargetFallbackRolesByKey.get(key)?.has(roleToken) === true ||
          currentState?.key !== key
        ) return;
        claims.delete(key);
        if (currentState.contextualTargetFallbackRequested === true) {
          currentState.contextualTargetFallbackRequested = false;
        }
      });
    }
  };
  release.contextualRoleToken = roleToken;
  return release;
}

/** Lets generated Page Execution code render only the active corridor's one-shot fallback. */
function shouldRenderPreviewInspectorContextualTargetFallback(key, owner) {
  initializePreviewInspectorTargetReachabilityState();
  const state = previewInspectorSession.targetReachabilityByKey.get(key);
  const claim = previewInspectorSession.contextualTargetFallbackClaimsByKey.get(key);
  return previewInspectorSession.activeTargetReachabilityKey === key &&
    state?.contextualTargetFallbackRequested === true &&
    claim?.status === 'committed' && claim.key === key && claim.owner === owner &&
    previewInspectorSession.contextualTargetFallbackRolesByKey.get(key)?.get(claim.roleToken) === owner &&
    state.directTarget !== true;
}

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
/**
 * Chooses only the first newly revealed continuation gate so each pass behaves like bounded DFS.
 * Exact facade IDs, owners, and source paths can be restricted ahead of data convergence; ordinary
 * traversal still rejects page siblings that merely share the surrounding application page.
 */
function selectPreviewInspectorNextTargetGate(descriptor, candidate, state, exactTargetOnly = false) {
  initializePreviewInspectorConditionState();
  const evidence = readPreviewInspectorTargetPathEvidence(descriptor, candidate, state);
  return [...previewInspectorSession.renderConditions.values()]
    .filter((condition) =>
      condition?.reachabilityKey === state.key &&
      !previewInspectorSession.renderConditionOverrides.has(condition.id) &&
      (
        typeof isPreviewInspectorRenderConditionControlledByOutcome !== 'function' ||
        !isPreviewInspectorRenderConditionControlledByOutcome(condition)
      ) &&
      (
        typeof isPreviewInspectorTargetGuidedConditionRejected !== 'function' ||
        !isPreviewInspectorTargetGuidedConditionRejected(condition.id, state.key)
      ),
    )
    .map((condition) => {
      const conditionSourcePath = normalizePreviewInspectorReachabilityPath(condition.sourcePath);
      const exactMountedTargetOverlayLocal = exactTargetOnly &&
        condition?.kind === 'overlay-visibility' &&
        condition?.role === 'overlay' &&
        conditionSourcePath.length > 0 &&
        conditionSourcePath === normalizePreviewInspectorReachabilityPath(state.targetSourcePath);
      const exactConditionLocal = evidence.exactConditionIds?.has(condition.id) === true;
      const exactOwnerLocal =
        evidence.exactTargetNames?.has(condition.ownerName) === true &&
        !evidence.ambiguousNames?.has(condition.ownerName);
      const exactSourceLocal = (evidence.pathScores?.get(conditionSourcePath) ?? 0) >= 800;
      const exactOverlayTargetLocal =
        isPreviewInspectorExactTargetOverlayCondition(condition, evidence);
      return {
        condition,
        desiredValue: exactMountedTargetOverlayLocal || exactOverlayTargetLocal
          ? true
          : readPreviewInspectorTargetConditionValue(condition, evidence),
        exactMountedTargetOverlayLocal,
        exactOverlayTargetLocal,
        exactTargetLocal:
          exactConditionLocal || exactOwnerLocal || exactSourceLocal || exactMountedTargetOverlayLocal,
        pathLocal: isPreviewInspectorConditionOnTargetPath(condition, evidence),
      };
    })
    .filter(({
      condition,
      desiredValue,
      exactMountedTargetOverlayLocal,
      exactOverlayTargetLocal,
      exactTargetLocal,
      pathLocal,
    }) =>
      typeof desiredValue === 'boolean' &&
      condition.effectiveEnabled !== desiredValue &&
      (
        typeof canPreviewInspectorTargetGuideCondition !== 'function' ||
        canPreviewInspectorTargetGuideCondition(condition, desiredValue)
      ) &&
      pathLocal &&
      (!exactTargetOnly || exactTargetLocal) &&
      /*
       * A page/source match is sufficient for ordinary continuation guards, but not for overlays.
       * Several sibling dialogs commonly live in the same page file. Opening every one merely
       * because that file lies on the target corridor obscures the page and can create modal loops.
       * The narrow exception is a visibility gate authored in the exact selected target file after
       * that target has mounted without output: source order reveals one child overlay per pass.
       * All other overlays still require an exact condition, target, or corridor-owner identity.
       */
      (
        condition.role !== 'overlay' ||
        exactOverlayTargetLocal ||
        exactMountedTargetOverlayLocal
      ),
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
  const boundaries = readPreviewInspectorTargetBoundaries(state);
  return boundaries instanceof Set && boundaries.size > 0;
}
/**
 * Adds selected-export runtime names to root-to-target evidence. HOC factories can disappear from
 * import graphs while returned functions own redirect gates; mounted siblings are never promoted.
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
/** Adds the exported facade's exact public runtime name before its selected boundary commits. */
function rememberPreviewInspectorTargetRuntimeOwner(exportName, Component) {
  const names = [Component?.displayName, Component?.name]
    .filter((name) => typeof name === 'string' && name.length > 0 && name.length <= 160);
  if (!(previewInspectorSession.targetFacadeRuntimeOwnerNamesByExport instanceof Map)) {
    previewInspectorSession.targetFacadeRuntimeOwnerNamesByExport = new Map();
  }
  previewInspectorSession.targetFacadeRuntimeOwnerNamesByExport.set(exportName, new Set(names));
  return rememberPreviewInspectorTargetRuntimeOwnerNames(exportName, names);
}
/**
 * Reads only the single-child component chain inside the exact selected-target boundary.
 *
 * A HOC can have owners PageComponent -> GuardedPage -> Navigate while static evidence contains
 * only PageComponent. The walk stops at a host or branch and never promotes page siblings.
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
 * Reads the target-output verifier's static proof for a selected export that only navigates.
 * Keeping this proof on the verifier avoids accepting a short HOC or parent redirect merely
 * because some boundary with the same public export name committed before DFS observed it.
 */
function hasPreviewInspectorIntentionalNavigationTargetOutput(state) {
  if (typeof hasPreviewInspectorResolvedTargetOutput !== 'function') return false;
  const detector = hasPreviewInspectorResolvedTargetOutput.hasIntentionalNavigationOutput;
  return typeof detector === 'function' && detector(state) === true;
}
/**
 * Requires the selected boundary to own connected host output and to remain error-free.
 * A HOC can mount the facade boundary and immediately return Navigate/null before invoking the
 * authored visual component; treating that boundary alone as success stops DFS on a blank page.
 * A compiler-proven navigation-only export is the narrow exception: its authored output changes
 * the route and therefore cannot retain either a host node or its boundary at settled observation.
 */
function hasPreviewInspectorTargetHostOutput(state) {
  const boundaries = state.contextualTargetFallbackRequested === true
    ? new Set([readPreviewInspectorContextualTargetBoundary(state)].filter(Boolean))
    : readPreviewInspectorTargetBoundaries(state);
  state.targetHasAnyHostOutput = false;
  state.targetDeferredCallbackPending = false;
  state.targetOutputKind = 'none';
  state.targetOutputRecoveryPending = false;
  state.targetEffectControllerOutput = false;
  state.targetRenderedEmpty = false;
  if (!(boundaries instanceof Set)) return false;
  for (const boundary of boundaries) {
    if (boundary?.state?.error !== undefined) continue;
    if (typeof hasPreviewInspectorResolvedTargetOutput === 'function'
      ? hasPreviewInspectorResolvedTargetOutput(boundary, state)
      : collectPreviewInspectorFiberElements(boundary).length > 0) return true;
  }
  const activeError = typeof readPreviewInspectorRuntimeHealthTargetError === 'function'
    ? readPreviewInspectorRuntimeHealthTargetError(state.targetExportName)
    : undefined;
  if (
    state.targetWasMounted === true &&
    activeError === undefined &&
    hasPreviewInspectorIntentionalNavigationTargetOutput(state)
  ) {
    state.targetOutputError = undefined;
    state.targetOutputKind = 'target-output';
    state.targetOutputRecoveryPending = false;
    state.targetRenderedEmpty = true;
    return true;
  }
  return false;
}
/** Stops automatic branch traversal while the selected target owns a contained render failure. */
function hasPreviewInspectorTargetRenderError(state) {
  const boundaries = state.contextualTargetFallbackRequested === true
    ? new Set([readPreviewInspectorContextualTargetBoundary(state)].filter(Boolean))
    : readPreviewInspectorTargetBoundaries(state);
  return boundaries instanceof Set &&
    [...boundaries].some((boundary) => boundary?.state?.error !== undefined);
}
/** Reports success only when the authored root and a visible selected target share one live render. */
function hasReachedPreviewInspectorPageCorridor(state) {
  return state.directTarget !== true &&
    state.pageRootCommitted === true &&
    state.targetMounted === true &&
    state.targetHasOutput === true;
}
/**
 * Finds only compiler-shaped values whose continuation has one generated answer. Root-only custom
 * hooks stay interactive unless the compiler also proved one exact target-visible scalar.
 */
function readPreviewInspectorDeterministicRequirementEvidence(descriptor, candidate, state) {
  const batch = readPreviewInspectorRequirementBatch(descriptor, candidate, state, true);
  const admittedHookIds = new Set(batch.hookIds);
  const admittedRequestIds = new Set(batch.requestIds);
  const hookIds = readPreviewInspectorRuntimeFallbacks()
    .filter((record) =>
      admittedHookIds.has(record.id) &&
      record.reachabilityKey === state.key &&
      record.mode === 'auto' &&
      hasPreviewInspectorMaterializableHookRequirement(record),
    )
    .map((record) => record.id)
    .slice(0, 24);
  const requestIds = readPreviewInspectorDataRequests()
    .filter((record) =>
      admittedRequestIds.has(record.id) &&
      record.reachabilityKey === state.key &&
      record.kind === 'graphql' &&
      (record.mode === 'auto' || hasPreviewInspectorStaleSmartDataRequirement(record)) &&
      readPreviewInspectorDataShapePaths(record.shape).length > 0,
    )
    .map((record) => record.id)
    .slice(0, 24);
  return { hookIds, requestIds };
}

/**
 * Reports whether the mounted empty target owns one exact Smart scalar in the next frontier.
 *
 * A coherent hook discriminator is stronger than independently forcing the target's early-return
 * and child JSX conditions: the same memoized Context value also updates page-shell layout flags.
 * Source/owner equality keeps this priority unavailable to sibling hooks elsewhere on the page.
 */
function hasPreviewInspectorExactTargetSmartRequirement(descriptor, candidate, state) {
  const evidence = readPreviewInspectorDeterministicRequirementEvidence(
    descriptor,
    candidate,
    state,
  );
  const admittedIds = new Set(evidence.hookIds);
  const targetSourcePath = normalizePreviewInspectorReachabilityPath(state.targetSourcePath);
  return readPreviewInspectorRuntimeFallbacks().some((record) => {
    if (
      !admittedIds.has(record.id) ||
      !Array.isArray(record.smartPathValues) ||
      record.smartPathValues.length === 0
    ) return false;
    const sourcePath = normalizePreviewInspectorReachabilityPath(record.sourcePath);
    return record.ownerName === state.targetExportName ||
      (targetSourcePath.length > 0 && sourcePath === targetSourcePath);
  });
}
/** Applies one newly observed hook/API batch and remounts only when that batch changed values. */
function advancePreviewInspectorMinimumRequirementSearch(descriptor, candidate, state) {
  const search = readPreviewInspectorMinimumRequirementSearch(state);
  if (
    search === undefined ||
    search.status !== 'searching' ||
    search.pass >= PREVIEW_INSPECTOR_MINIMUM_REQUIREMENT_PASS_LIMIT
  ) {
    return false;
  }
  const preserveUserValues = search.origin !== 'user';
  const batch = search.origin === 'deterministic-auto'
    ? readPreviewInspectorDeterministicRequirementEvidence(descriptor, candidate, state)
    : readPreviewInspectorRequirementBatch(descriptor, candidate, state, preserveUserValues);
  search.observedPathCount = readPreviewInspectorTargetReachabilityRequiredPaths(state).length;
  const frontier = beginPreviewInspectorRequirementFrontier(state, search, batch);
  if (frontier === undefined) return state.exhausted === true;
  const rollbackSnapshot = capturePreviewInspectorRequirementAutoRollback(state, batch);
  const runtimeChanged = smartFillPreviewInspectorRuntimeFallbacksForReachability(
    state.key,
    {
      changeLimit: PREVIEW_INSPECTOR_REQUIREMENT_HOOK_BATCH_LIMIT,
      preserveUserValues,
      recordIds: batch.hookIds,
    },
  );
  const dataChanged = smartFillPreviewInspectorDataPayloadsForReachability(
    state.key,
    {
      applicationPath: state.applicationPath,
      changeLimit: PREVIEW_INSPECTOR_REQUIREMENT_DATA_BATCH_LIMIT,
      preserveUserValues,
      recordIds: batch.requestIds,
    },
  );
  if (!runtimeChanged && !dataChanged) {
    completePreviewInspectorRequirementFrontier(search, frontier, false, state);
    return false;
  }
  let traceId;
  if (typeof recordPreviewInspectorBlockerAutoDecision === 'function') {
    const hookIdSet = new Set(batch.hookIds);
    const requestIdSet = new Set(batch.requestIds);
    const hookValues = readPreviewInspectorRuntimeFallbacks()
      .filter((record) => record.reachabilityKey === state.key && hookIdSet.has(record.id))
      .map((record) => ({
        id: record.id,
        requiredPaths: record.requiredPaths,
        value: createPreviewInspectorRuntimeFallbackSmartDraftTemplate(
          previewInspectorSession.runtimeFallbackValues.get(record.id),
          record.requiredPaths,
        ),
      }));
    const backendPayloads = [...previewInspectorSession.dataRequests.values()]
      .filter((record) => record.reachabilityKey === state.key && requestIdSet.has(record.id))
      .map((record) => {
        const override = previewInspectorSession.dataPayloadOverrides.get(record.id);
        return {
          id: record.id,
          mode: override?.mode ?? 'smart',
          payload: override?.payload ?? generatePreviewInspectorDataValue(record.shape, '', 'smart'),
        };
      });
    const sourceGate = state.appliedConditions?.at(-1);
    traceId = recordPreviewInspectorBlockerAutoDecision({
      action: search.origin === 'deterministic-auto'
        ? 'Auto-fill deterministic page-path requirements'
        : 'Fill newly discovered page-path requirements',
      blockerId: 'target-reachability:' + state.key,
      blockerKind: 'target-reachability',
      blockerName: 'Target not reached · ' + state.targetExportName,
      generatedPaths: readPreviewInspectorRequirementBatchPaths(batch),
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
  if (runtimeChanged || dataChanged) {
    if (rollbackSnapshot !== undefined) {
      rollbackSnapshot.mode = search.origin === 'deterministic-auto'
        ? 'deterministic-minimum-auto'
        : 'minimum-requirement-dfs';
    }
    registerPreviewInspectorRequirementAutoRollback(traceId, rollbackSnapshot);
  }
  completePreviewInspectorRequirementFrontier(search, frontier, true, state);
  search.observedPathCount = readPreviewInspectorTargetReachabilityRequiredPaths(state).length;
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
function startPreviewInspectorDeterministicRequirementSearch(descriptor, candidate, state) {
  const current = readPreviewInspectorMinimumRequirementSearch(state);
  if (current?.status === 'searching') return false;
  const evidence = readPreviewInspectorDeterministicRequirementEvidence(
    descriptor,
    candidate,
    state,
  );
  if (evidence.hookIds.length === 0 && evidence.requestIds.length === 0) return false;
  if (!canStartPreviewInspectorDeterministicRequirementSearch(state, evidence)) return false;
  const convergence = readPreviewInspectorRequirementConvergence(state);
  const search = current?.origin === 'deterministic-auto' ? current : {};
  Object.assign(search, {
    observedPathCount: readPreviewInspectorTargetReachabilityRequiredPaths(state).length,
    origin: 'deterministic-auto',
    pass: convergence.totalPasses,
    status: 'searching',
    totalPasses: convergence.totalPasses,
  });
  delete search.cycleLength;
  previewInspectorSession.minimumRequirementSearchByKey.set(state.key, search);
  if (typeof recordPreviewInspectorBlockerAutoDecision === 'function') {
    recordPreviewInspectorBlockerAutoDecision({
      action: 'Start deterministic minimum page-path search',
      blockerId: 'target-reachability:' + state.key,
      blockerKind: 'target-reachability',
      blockerName: 'Target not reached · ' + state.targetExportName,
      generatedPaths: readPreviewInspectorRequirementBatchPaths(evidence),
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
  if (advancePreviewInspectorMinimumRequirementSearch(descriptor, candidate, state)) return true;
  settlePreviewInspectorMinimumRequirementSearch(state);
  return false;
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
    'Show file by itself preserves preview providers and data, but it is not the real page layout.',
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
  state.targetMounted = hasMountedPreviewInspectorTarget(state);
  state.targetWasMounted = state.targetWasMounted === true || state.targetMounted;
  const targetRenderError = hasPreviewInspectorTargetRenderError(state) ||
    state.pendingTargetRepairFailure !== undefined;
  state.targetHasOutput = targetRenderError
    ? false
    : hasPreviewInspectorTargetHostOutput(state);
  if (
    state.targetMounted !== true &&
    state.targetWasMounted === true &&
    state.targetHasOutput === true &&
    hasPreviewInspectorIntentionalNavigationTargetOutput(state)
  ) {
    // The exact boundary is gone only because its authored output completed the route transition.
    // Promote the latched commit to corridor-mounted semantics for existing blocker/UI consumers.
    state.targetMounted = true;
  }
  if (!targetRenderError && hasReachedPreviewInspectorPageCorridor(state)) {
    completePreviewInspectorMinimumRequirementSearch(state);
    state.status = 'reached';
    state.idlePasses = 0;
    notifyPreviewInspector();
    schedulePreviewInspectorTreeRefresh();
    return;
  }
  if (targetRenderError) {
    if (isPreviewInspectorTargetAutoAttemptPending(state)) {
      state.status = 'settling-auto-attempt';
      schedulePreviewInspectorTreeRefresh();
      return;
    }
    if (advancePreviewInspectorTargetFailureRequirement(state)) return;
    state.status = 'target-error';
    state.idlePasses = 0;
    schedulePreviewInspectorTreeRefresh();
    return;
  }
  if (
    (state.targetMounted || state.targetWasMounted) &&
    !state.targetHasOutput
  ) {
    const localUiController =
      typeof autoActivatePreviewInspectorTargetLocalUiController === 'function'
        ? autoActivatePreviewInspectorTargetLocalUiController(state)
        : undefined;
    if (localUiController !== undefined) {
      state.status = 'activating-local-ui';
      state.probeRevision += 1;
      notifyPreviewInspector();
      schedulePreviewInspectorTreeRefresh();
      return;
    }
  }
  if (
    (state.targetMounted || state.targetWasMounted) &&
    !state.targetHasOutput &&
    state.overlayVisibilityAttempted !== true
  ) {
    state.overlayVisibilityAttempted = true;
    const visibilityPath = typeof autoRevealPreviewInspectorOverlayTarget === 'function'
      ? autoRevealPreviewInspectorOverlayTarget(state.targetExportName, state.key)
      : undefined;
    if (visibilityPath !== undefined) {
      state.status = 'revealing-overlay';
      state.probeRevision += 1;
      return;
    }
  }
  if (
    state.targetMounted !== true &&
    state.targetWasMounted !== true &&
    autoActivatePreviewInspectorTargetPageTab(state) !== undefined
  ) {
    state.exhausted = false;
    state.idlePasses = 0;
    state.status = 'activating-page-tab';
    state.probeRevision += 1;
    notifyPreviewInspector();
    schedulePreviewInspectorTreeRefresh();
    schedulePreviewInspectorCommitRefresh();
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
  if (isPreviewInspectorTargetAutoAttemptPending(state)) {
    state.status = 'settling-auto-attempt';
    schedulePreviewInspectorTreeRefresh();
    return;
  }
  if (
    (state.targetMounted || state.targetWasMounted) &&
    !state.targetHasOutput &&
    hasPreviewInspectorExactTargetSmartRequirement(descriptor, candidate, state) &&
    startPreviewInspectorDeterministicRequirementSearch(descriptor, candidate, state)
  ) {
    return;
  }
  const mountedTargetGate = (state.targetMounted || state.targetWasMounted) && !state.targetHasOutput
    ? selectPreviewInspectorNextTargetGate(descriptor, candidate, state, true)
    : undefined;
  // A newly committed, path-local JSX gate is stronger reachability evidence than unrelated hook
  // requirements collected from the surrounding application shell. Traverse it before spending
  // another minimum-value pass (or closing that pass circuit at its limit).
  const nextGate = mountedTargetGate ?? selectPreviewInspectorNextTargetGate(descriptor, candidate, state);
  if (nextGate === undefined) {
    if (
      state.pageRootCommitted === true &&
      state.targetMounted !== true && state.targetWasMounted !== true &&
      (Array.isArray(state.rejectedConditions) ? state.rejectedConditions.length : 0) > 0
    ) {
      /*
       * A compiler-proven target-local branch already committed without revealing this target and
       * has been session-rejected. Further page-wide hook/data filling cannot make that same branch
       * a stronger target owner; use the generated exact facade beside the still-mounted page.
       */
      settlePreviewInspectorMinimumRequirementSearch(state);
      if (requestPreviewInspectorContextualTargetFallback(state)) return;
    }
    if (stopPreviewInspectorRequirementConvergenceAtLimit(state)) {
      if (requestPreviewInspectorContextualTargetFallback(state)) return;
      return;
    }
    if (advancePreviewInspectorMinimumRequirementSearch(descriptor, candidate, state)) return;
  }
  if (state.targetMounted && state.pageRootCommitted !== true) {
    state.status = 'page-root-pending';
    schedulePreviewInspectorTreeRefresh();
    return;
  }
  if (state.exhausted === true && nextGate === undefined) return;
  if (nextGate !== undefined && state.attempt < PREVIEW_INSPECTOR_TARGET_REACHABILITY_PASS_LIMIT) {
    if (!setPreviewInspectorTargetGuidedConditionOverride(
      nextGate.condition.id,
      nextGate.desiredValue,
    )) {
      state.rejectedConditions ??= [];
      state.rejectedConditions.push({
        expression: nextGate.condition.expression,
        id: nextGate.condition.id,
        reachabilityKey: state.key,
        reason: 'target-guided condition became inapplicable before commit',
      });
      state.status = 'probing';
      state.probeRevision += 1;
      notifyPreviewInspector();
      return;
    }
    state.appliedConditions.push({
      enabled: nextGate.desiredValue,
      expression: nextGate.condition.expression,
      id: nextGate.condition.id,
      line: nextGate.condition.line,
      ownerName: nextGate.condition.ownerName,
      sourcePath: nextGate.condition.sourcePath,
    });
    state.attempt += 1;
    state.exhausted = false;
    state.idlePasses = 0;
    state.status = 'advancing';
    const search = readPreviewInspectorMinimumRequirementSearch(state);
    if (search?.status === 'stalled') search.status = 'searching';
    state.probeRevision += 1;
    return;
  }
  if (startPreviewInspectorDeterministicRequirementSearch(descriptor, candidate, state)) return;
  state.idlePasses += 1;
  state.status = 'blocked';
  state.probeRevision += 1;
  if (
    state.attempt >= PREVIEW_INSPECTOR_TARGET_REACHABILITY_PASS_LIMIT ||
    state.idlePasses >= PREVIEW_INSPECTOR_TARGET_REACHABILITY_IDLE_LIMIT
  ) {
    settlePreviewInspectorMinimumRequirementSearch(state);
    if (requestPreviewInspectorContextualTargetFallback(state)) return;
    if (
      typeof requestPreviewInspectorPageExecutionRetry === 'function' &&
      requestPreviewInspectorPageExecutionRetry(descriptor, candidate)
    ) {
      state.exhausted = true;
      state.status = 'retrying-page-execution';
      notifyPreviewInspector();
      schedulePreviewInspectorTreeRefresh();
      return;
    }
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
 * Continues traversal directly from a trace settlement that already proves its React commit is
 * stable. This avoids depending on an incidental Inspector component rerender to create the next
 * effect timer, while the corridor key prevents an old attempt from advancing a newer selection.
 */
function continuePreviewInspectorTargetReachabilityAfterSettledAttempt(state) {
  if (state === undefined) return false;
  if (state.status !== 'probing') {
    state.lastContinuationSkipReason = 'status:' + String(state.status);
    return false;
  }
  if (previewInspectorSession.activeTargetReachabilityKey !== state.key) {
    state.lastContinuationSkipReason = 'inactive-key';
    return false;
  }
  const descriptor = typeof findSelectedPreviewInspectorDescriptor === 'function'
    ? findSelectedPreviewInspectorDescriptor()
    : undefined;
  const candidate = typeof readSelectedPreviewInspectorPageCandidate === 'function'
    ? readSelectedPreviewInspectorPageCandidate(descriptor)
    : undefined;
  if (descriptor === undefined) {
    state.lastContinuationSkipReason = 'missing-descriptor';
    return false;
  }
  if (candidate === undefined) {
    state.lastContinuationSkipReason = 'missing-candidate';
    return false;
  }
  if (createPreviewInspectorTargetReachabilityKey(descriptor, candidate) !== state.key) {
    state.lastContinuationSkipReason = 'candidate-key-mismatch';
    return false;
  }
  delete state.lastContinuationSkipReason;
  evaluatePreviewInspectorTargetReachability(descriptor, candidate, state);
  return true;
}
/**
 * Rechecks one mounted authored target after its exact compiler-proven effect has synchronously
 * registered context state. The store notification deliberately leaves the target instance key
 * alone, so initialized refs survive the single bounded render before ordinary DFS resumes.
 */
function readPreviewInspectorRuntimeEffectContinuationInstance(state, rawMetadata, ownershipToken) {
  const effectId = typeof rawMetadata?.id === 'string' ? rawMetadata.id : '';
  const sourcePath = typeof rawMetadata?.sourcePath === 'string'
    ? rawMetadata.sourcePath.replaceAll('\\', '/')
    : '';
  const descriptor = typeof findSelectedPreviewInspectorDescriptor === 'function'
    ? findSelectedPreviewInspectorDescriptor()
    : undefined;
  const candidate = typeof readSelectedPreviewInspectorPageCandidate === 'function'
    ? readSelectedPreviewInspectorPageCandidate(descriptor)
    : undefined;
  if (
    state === undefined ||
    (typeof ownershipToken !== 'object' && typeof ownershipToken !== 'function') ||
    ownershipToken === null ||
    state.directTarget === true ||
    state.status === 'reached' ||
    state.pageRootCommitted !== true ||
    effectId.length === 0 ||
    sourcePath.length === 0 ||
    sourcePath !== state.targetSourcePath ||
    descriptor === undefined ||
    candidate === undefined ||
    candidate.id !== state.candidateId ||
    createPreviewInspectorTargetReachabilityKey(descriptor, candidate) !== state.key
  ) return undefined;
  const boundaries = state.contextualTargetFallbackRequested === true
    ? new Set([readPreviewInspectorContextualTargetBoundary(state)].filter(Boolean))
    : readPreviewInspectorTargetBoundaries(state);
  const boundary = [...boundaries].find((candidateBoundary) =>
    candidateBoundary?.ownershipToken === ownershipToken &&
      hasPreviewInspectorOwnedBoundary(candidateBoundary, state) === true &&
      candidateBoundary?.state?.error === undefined,
  );
  if (boundary === undefined || hasPreviewInspectorTargetHostOutput(state)) return undefined;
  return { boundary, effectId };
}
/**
 * Rechecks one live exact target instance after its compiler-proven effect synchronously
 * registered context state. A state accepts one original token and, after the existing one-shot
 * latch, one contextual token; remounts and sibling instances fail closed.
 */
function continuePreviewInspectorTargetReachabilityAfterSuccessfulRuntimeEffect(rawMetadata, ownershipToken) {
  initializePreviewInspectorTargetReachabilityState();
  const key = previewInspectorSession.activeTargetReachabilityKey;
  const state = typeof key === 'string'
    ? previewInspectorSession.targetReachabilityByKey.get(key)
    : undefined;
  const instance = readPreviewInspectorRuntimeEffectContinuationInstance(
    state,
    rawMetadata,
    ownershipToken,
  );
  if (instance === undefined) return false;
  if (instance.boundary?.props?.effectControllerOutputCandidate === true) {
    state.effectControllerCompletionToken = ownershipToken;
  }
  const phase = instance.boundary?.props?.contextualBoundaryRole === 'retained-route'
    ? 'contextual'
    : 'original';
  if ((phase === 'contextual') !== (state.contextualTargetFallbackRequested === true)) return false;
  state.topologyEffectContinuationAccepted = true;
  if (phase === 'contextual') state.topologyContextualEffectContinuationAccepted = true;
  else state.topologyOriginalEffectContinuationAccepted = true;
  const tokensByPhase = state.successfulRuntimeEffectContinuationTokensByPhase ??= new Map();
  const admittedToken = tokensByPhase.get(phase);
  if (admittedToken !== undefined && admittedToken !== ownershipToken) return false;
  if (admittedToken === undefined && tokensByPhase.size >= 2) return false;
  tokensByPhase.set(phase, ownershipToken);
  const usedEffectIdsByToken = state.successfulRuntimeEffectContinuationIdsByToken ??= new WeakMap();
  const usedEffectIds = usedEffectIdsByToken.get(ownershipToken) ?? new Set();
  usedEffectIdsByToken.set(ownershipToken, usedEffectIds);
  if (usedEffectIds.has(instance.effectId)) return false;
  usedEffectIds.add(instance.effectId);
  const pendingEffectIdsByToken = state.successfulRuntimeEffectContinuationPendingIdsByToken ??= new WeakMap();
  const pendingEffectIds = pendingEffectIdsByToken.get(ownershipToken) ?? new Set();
  pendingEffectIdsByToken.set(ownershipToken, pendingEffectIds);
  pendingEffectIds.add(instance.effectId);
  notifyPreviewInspector();
  globalThis.setTimeout(() => {
    pendingEffectIds.delete(instance.effectId);
    if (previewInspectorSession.activeTargetReachabilityKey !== state.key) return;
    const current = readPreviewInspectorRuntimeEffectContinuationInstance(
      state,
      rawMetadata,
      ownershipToken,
    );
    if (
      current === undefined ||
      current.boundary !== instance.boundary ||
      (current.boundary?.props?.contextualBoundaryRole === 'retained-route'
        ? 'contextual'
        : 'original') !== phase
    ) return;
    state.topologyDelayedProbeFired = true;
    state.topologyBoundaryIdentityRetained = current.boundary === instance.boundary;
    if (phase === 'contextual') {
      state.topologyContextualDelayedProbeFired = true;
      state.topologyContextualBoundaryIdentityRetained = current.boundary === instance.boundary;
    } else {
      state.topologyOriginalDelayedProbeFired = true;
      state.topologyOriginalBoundaryIdentityRetained = current.boundary === instance.boundary;
    }
    const descriptor = typeof findSelectedPreviewInspectorDescriptor === 'function'
      ? findSelectedPreviewInspectorDescriptor()
      : undefined;
    const candidate = typeof readSelectedPreviewInspectorPageCandidate === 'function'
      ? readSelectedPreviewInspectorPageCandidate(descriptor)
      : undefined;
    if (descriptor === undefined || candidate === undefined) return;
    evaluatePreviewInspectorTargetReachability(descriptor, candidate, state);
  }, PREVIEW_INSPECTOR_TARGET_CONTINUATION_PROBE_DELAY_MS);
  return true;
}
/**
 * Rechecks the active authored corridor when its exact compiler-owned target gains host output
 * after an effect/provider commit. Registration can precede React's settled tree, so coalesce one
 * delayed continuation and repeat every identity check before using the ordinary evaluator.
 */
function continuePreviewInspectorTargetReachabilityAfterOwnedHostRegistration(record) {
  initializePreviewInspectorTargetReachabilityState();
  const key = previewInspectorSession.activeTargetReachabilityKey;
  const state = typeof key === 'string'
    ? previewInspectorSession.targetReachabilityByKey.get(key)
    : undefined;
  if (
    state === undefined ||
    state.directTarget === true ||
    state.status === 'reached' ||
    record?.exportName !== state.targetExportName ||
    record?.sourcePath !== state.targetSourcePath ||
    state.ownedHostContinuationPending === true
  ) return false;
  state.ownedHostContinuationPending = true;
  globalThis.setTimeout(() => {
    state.ownedHostContinuationPending = false;
    if (
      previewInspectorSession.activeTargetReachabilityKey !== state.key ||
      state.directTarget === true ||
      state.pageRootCommitted !== true ||
      state.status === 'reached' ||
      record?.exportName !== state.targetExportName ||
      record?.sourcePath !== state.targetSourcePath ||
      ![...(record?.nodes ?? [])].some((node) => node?.isConnected === true)
    ) return;
    const descriptor = typeof findSelectedPreviewInspectorDescriptor === 'function'
      ? findSelectedPreviewInspectorDescriptor()
      : undefined;
    const candidate = typeof readSelectedPreviewInspectorPageCandidate === 'function'
      ? readSelectedPreviewInspectorPageCandidate(descriptor)
      : undefined;
    if (
      descriptor === undefined ||
      candidate === undefined ||
      candidate?.id !== state.candidateId ||
      createPreviewInspectorTargetReachabilityKey(descriptor, candidate) !== state.key
    ) return;
    evaluatePreviewInspectorTargetReachability(descriptor, candidate, state);
  }, PREVIEW_INSPECTOR_TARGET_CONTINUATION_PROBE_DELAY_MS);
  return true;
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
    if (fallback.reachabilityKey !== state.key || fallback.passive === true) continue;
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
  const activeKey = previewInspectorSession.activeTargetReachabilityKey;
  return [...previewInspectorSession.targetReachabilityByKey.values()]
    .filter((state) =>
      state.status !== 'reached' &&
      (typeof activeKey !== 'string' || state.key === activeKey),
    )
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
  const descriptor = typeof findSelectedPreviewInspectorDescriptor === 'function'
    ? findSelectedPreviewInspectorDescriptor()
    : undefined;
  const candidate = typeof readSelectedPreviewInspectorPageCandidate === 'function'
    ? readSelectedPreviewInspectorPageCandidate(descriptor)
    : undefined;
  const state = previewInspectorSession.targetReachabilityByKey.get(reachabilityKey);
  resetPreviewInspectorRequirementConvergence(state ?? reachabilityKey);
  clearPreviewInspectorRequirementAutoRollbacks(reachabilityKey);
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
    observedPathCount: state === undefined ? 0 : readPreviewInspectorTargetReachabilityRequiredPaths(state).length,
    origin: 'user',
    pass: 0,
    status: 'searching',
  });
  previewInspectorSession.fallbackValuesEnabled = true;
  previewInspectorSession.dataAutoEnabled = true;
  if (state !== undefined) {
    state.exhausted = false;
    state.idlePasses = 0;
    state.status = 'searching-requirements';
    state.probeRevision += 1;
    if (advancePreviewInspectorMinimumRequirementSearch(descriptor, candidate, state)) return;
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
  resetPreviewInspectorRequirementConvergence(key);
  clearPreviewInspectorRequirementAutoRollbacks(key);
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
  state.contextualTargetFallbackRequested = false;
  state.directTarget = false;
  state.detachedTargetPlacement = candidate?.detachedTargetPlacement;
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
  const rollbackChanged = clearPreviewInspectorRequirementAutoRollbacks();
  const stateChanged = previewInspectorSession.targetReachabilityByKey.size > 0;
  previewInspectorSession.targetReachabilityByKey.clear();
  previewInspectorSession.minimumRequirementSearchByKey.clear();
  previewInspectorSession.activeTargetReachabilityKey = undefined;
  return conditionChanged || rollbackChanged || stateChanged;
}
`;
}
