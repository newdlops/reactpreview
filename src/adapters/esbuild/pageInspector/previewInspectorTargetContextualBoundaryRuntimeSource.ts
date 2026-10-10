/** Owns the compiler-issued contextual-boundary capability, claims, and one-shot fallback. */

/** Generates browser helpers composed into the existing target reachability runtime. */
export function createPreviewInspectorTargetContextualBoundaryRuntimeSource(): string {
  return String.raw`
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
 * Reports whether a session-rejected gate is proven to render the target in one of its branches.
 * Only such a gate shows that the page cannot reveal the target through it. A sibling gate with
 * the same expression (a table header \`hasTrend && <th>\` next to the row cell that renders the
 * target) proves nothing about the rows that data filling can still create.
 */
function hasPreviewInspectorTargetRevealingRejectedCondition(state) {
  const targetName = state?.targetExportName;
  if (typeof targetName !== 'string' || !/^[A-Za-z_$][\w$]*$/u.test(targetName)) return false;
  const namesTarget = new RegExp('(?:^|[^\\w$])' + targetName.replaceAll('$', '\\$') + '(?![\\w$])', 'u');
  return (Array.isArray(state.rejectedConditions) ? state.rejectedConditions : []).some((gate) => {
    const record = previewInspectorSession.renderConditions?.get?.(gate?.id) ??
      previewInspectorSession.renderConditionDefinitions?.get?.(gate?.id);
    return record?.targetBranchEvidence === 'selected-target' ||
      [record?.truthyLabel, record?.falsyLabel].some((label) =>
        typeof label === 'string' && namesTarget.test(label));
  });
}

/**
 * Defers the export-wide visibility reveal while an owner-side visibility condition for the target
 * is still untried. The reveal sets the target's boolean prop for every instance, so a page that
 * mounts the same modal twice (create and edit) opened both whenever it ran before the condition
 * search; the owner condition opens exactly one instance. A rejected or manual condition no longer
 * defers, so the reveal remains the fallback. An open sibling instance keeps it deferred: the
 * reveal would open the remaining instances beside it before the open one commits its output.
 */
function isPreviewInspectorOverlayRevealDeferred(state) {
  if (typeof state?.targetExportName !== 'string') return false;
  for (const condition of previewInspectorSession.renderConditions?.values?.() ?? []) {
    if (
      condition?.kind === 'overlay-visibility' &&
      condition.ownerName === state.targetExportName &&
      condition.reachabilityKey === state.key &&
      condition.effectiveEnabled !== true &&
      !previewInspectorSession.renderConditionOverrides?.has?.(condition.id) &&
      !(typeof isPreviewInspectorTargetGuidedConditionRejected === 'function' &&
        isPreviewInspectorTargetGuidedConditionRejected(condition.id, state.key)) &&
      (typeof canPreviewInspectorTargetGuideCondition !== 'function' ||
        canPreviewInspectorTargetGuideCondition(condition, true))
    ) return true;
  }
  return false;
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
    const committedFallback = state.directTarget !== true &&
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
    // A committed fallback is only a bounded probe. Once its target has mounted without host
    // output for the normal idle budget, return control to the Page Execution retry lane instead
    // of permanently masking a compiler-proven contextual execution candidate.
    if (
      committedFallback &&
      (state.targetMounted === true || state.targetWasMounted === true) &&
      state.idlePasses >= PREVIEW_INSPECTOR_TARGET_REACHABILITY_IDLE_LIMIT
    ) {
      return false;
    }
    return committedFallback;
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
`;
}
