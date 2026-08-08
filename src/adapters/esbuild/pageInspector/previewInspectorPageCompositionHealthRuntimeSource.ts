/**
 * Generates a compact page-composition health snapshot for one Inspector render revision.
 *
 * The component tree can contain live Fiber nodes, statically expected JSX, synthetic application
 * path wrappers, conditions, and blocker records at the same time. This module reduces that mixed
 * tree to a bounded diagnostic record so the Output channel explains what page root was selected,
 * which shell segments are missing, and why the current-file target did or did not produce output.
 */

/** Maximum tree records inspected while computing aggregate composition counts. */
export const PREVIEW_INSPECTOR_PAGE_COMPOSITION_VISIT_LIMIT = 512;

/** Maximum tree rows copied into one runtime-health event. */
export const PREVIEW_INSPECTOR_PAGE_COMPOSITION_ROW_LIMIT = 20;

/** Maximum active blocker summaries copied into one runtime-health event. */
export const PREVIEW_INSPECTOR_PAGE_COMPOSITION_BLOCKER_LIMIT = 6;

/**
 * Creates browser source for deduplicated page-composition runtime-health events.
 *
 * Expected lexical bindings include the selected descriptor/candidate readers, target reachability
 * state, blocker classification, render-scenario state, and `recordPreviewInspectorRuntimeHealth`.
 * All data is renderer-owned and bounded before entering the already defensive health transport.
 *
 * @returns Plain JavaScript source concatenated into the Page Inspector DevTools runtime.
 */
export function createPreviewInspectorPageCompositionHealthRuntimeSource(): string {
  return String.raw`
const PREVIEW_INSPECTOR_PAGE_COMPOSITION_VISIT_LIMIT =
  ${PREVIEW_INSPECTOR_PAGE_COMPOSITION_VISIT_LIMIT};
const PREVIEW_INSPECTOR_PAGE_COMPOSITION_ROW_LIMIT =
  ${PREVIEW_INSPECTOR_PAGE_COMPOSITION_ROW_LIMIT};
const PREVIEW_INSPECTOR_PAGE_COMPOSITION_BLOCKER_LIMIT =
  ${PREVIEW_INSPECTOR_PAGE_COMPOSITION_BLOCKER_LIMIT};

/** Converts an authored or runtime component identity into a conservative comparison token. */
function normalizePreviewInspectorCompositionIdentity(value) {
  return typeof value === 'string'
    ? value.replace(/^@/u, '').replace(/\s+\(default\)$/u, '').replace(/[^\p{L}\p{N}]+/gu, '').toLowerCase()
    : '';
}

/** Reports whether a static application-path identity is represented by one live/expected row. */
function matchesPreviewInspectorCompositionIdentity(expected, actual) {
  const left = normalizePreviewInspectorCompositionIdentity(expected);
  const right = normalizePreviewInspectorCompositionIdentity(actual);
  if (left.length === 0 || right.length === 0) return false;
  if (left === right) return true;
  return Math.min(left.length, right.length) >= 4 &&
    (left.includes(right) || right.includes(left));
}

/** Reads connected host output without retaining host nodes in the serializable health record. */
function hasPreviewInspectorCompositionHostOutput(snapshot, nodeId) {
  const hostNodes = snapshot?.hostNodesById?.get?.(nodeId);
  return Array.isArray(hostNodes) && hostNodes.some((host) => host?.isConnected !== false);
}

/** Produces one stable human-readable state for a mixed live/static Inspector node. */
function readPreviewInspectorCompositionNodeState(node, hasHostOutput, blocking) {
  if (blocking) return 'blocking';
  if (node?.overlayState === 'dormant') return 'overlay-dormant';
  if (node?.kind === 'blocker') return 'assisted-blocker';
  if (node?.kind === 'condition') return node?.condition?.reached === false
    ? 'condition-unreached'
    : 'condition-reached';
  if (node?.mounted === true) return hasHostOutput ? 'mounted-output' : 'mounted-no-output';
  if (node?.mounted === false) return 'not-mounted';
  if (node?.expectedOutput === true || String(node?.edgeKind ?? '').startsWith('expected-')) {
    return 'expected';
  }
  if (node?.contextOnly === true) return 'context';
  return 'unknown';
}

/** Formats optional source evidence as one short row field without evaluating source accessors. */
function readPreviewInspectorCompositionSource(node) {
  const sourcePath = typeof node?.source?.path === 'string' ? node.source.path : '';
  if (sourcePath.length === 0) return undefined;
  const sourceName = sourcePath.replaceAll('\\', '/').split('/').at(-1) ?? sourcePath;
  return sourceName.slice(0, 160) +
    (Number.isSafeInteger(node?.source?.line) ? ':' + String(node.source.line) : '');
}

/**
 * Traverses the mixed page tree once, retaining aggregate status plus a compact pre-order outline.
 * Counts use a larger visit budget than rows so a broad page remains diagnosable without producing
 * a large webview message.
 */
function summarizePreviewInspectorPageCompositionTree(snapshot) {
  const counts = {
    activeBlockers: 0,
    blockers: 0,
    blockingConditions: 0,
    conditions: 0,
    currentFile: 0,
    currentFileMounted: 0,
    dormantOverlays: 0,
    expected: 0,
    hostOutput: 0,
    mounted: 0,
    notMounted: 0,
    observed: 0,
  };
  const rows = [];
  const blockerItems = [];
  const activeBlockerItems = [];
  const mountedNames = [];
  let observedFiberPath = [];
  let observedFiberPathHasCurrentFile = false;
  const roots = Array.isArray(snapshot?.roots) ? snapshot.roots : [];
  const stack = [...roots].reverse().map((node) => ({
    depth: 0,
    liveOwners: [],
    node,
    owners: [],
  }));
  while (stack.length > 0 && counts.observed < PREVIEW_INSPECTOR_PAGE_COMPOSITION_VISIT_LIMIT) {
    const current = stack.pop();
    const node = current?.node;
    if (node === null || typeof node !== 'object') continue;
    counts.observed += 1;
    const name = typeof node.name === 'string' && node.name.length > 0 ? node.name : 'Anonymous';
    const hasHostOutput = hasPreviewInspectorCompositionHostOutput(snapshot, node.id);
    const blocking = typeof isPreviewInspectorBlockingNode === 'function' &&
      isPreviewInspectorBlockingNode(node);
    const state = readPreviewInspectorCompositionNodeState(node, hasHostOutput, blocking);
    if (node.mounted === true) {
      counts.mounted += 1;
      mountedNames.push(name);
      const livePath = [...current.liveOwners, name].slice(-24);
      const livePathHasCurrentFile = node.currentFileExport === true;
      if (
        (livePathHasCurrentFile && !observedFiberPathHasCurrentFile) ||
        (livePathHasCurrentFile === observedFiberPathHasCurrentFile &&
          livePath.length > observedFiberPath.length)
      ) {
        observedFiberPath = livePath;
        observedFiberPathHasCurrentFile = livePathHasCurrentFile;
      }
    }
    if (node.mounted === false) counts.notMounted += 1;
    if (hasHostOutput) counts.hostOutput += 1;
    if (state === 'expected') counts.expected += 1;
    if (node.currentFileExport === true) {
      counts.currentFile += 1;
      if (node.mounted === true) counts.currentFileMounted += 1;
    }
    if (node.overlayState === 'dormant') counts.dormantOverlays += 1;
    if (node.kind === 'condition') {
      counts.conditions += 1;
      if (blocking) counts.blockingConditions += 1;
    }
    if (node.kind === 'blocker') {
      counts.blockers += 1;
      if (blocking) counts.activeBlockers += 1;
    }
    const source = readPreviewInspectorCompositionSource(node);
    const flags = [
      node.currentFileExport === true ? 'current-file' : '',
      node.contextOnly === true ? 'context-only' : '',
      node.role === 'overlay' ? 'overlay' : '',
      node.expectedOutput === true ? 'expected-output' : '',
    ].filter(Boolean).join(',');
    const row = {
      blocker: blocking,
      currentFile: node.currentFileExport === true,
      depth: Math.min(32, current.depth),
      ...(flags.length === 0 ? {} : { flags }),
      kind: String(node.kind ?? 'component').slice(0, 80),
      mounted: node.mounted === true,
      name: name.slice(0, 240),
      ...(source === undefined ? {} : { source }),
      state,
    };
    if (rows.length < PREVIEW_INSPECTOR_PAGE_COMPOSITION_ROW_LIMIT) {
      rows.push(row);
    } else if (row.currentFile || row.blocker) {
      /*
       * A wide header/navigation subtree can consume the outline before the selected file or its
       * first blocker is visited. Replace the last ordinary row so critical target evidence remains
       * visible while the aggregate traversal and truncation flag still describe the complete tree.
       */
      let replacementIndex = rows.length - 1;
      while (
        replacementIndex >= 0 &&
        (rows[replacementIndex]?.currentFile || rows[replacementIndex]?.blocker)
      ) {
        replacementIndex -= 1;
      }
      if (replacementIndex >= 0) rows[replacementIndex] = row;
    }
    if (node.kind === 'blocker' || node.kind === 'condition') {
      const blockerItem = {
        active: blocking,
        kind: String(node.blockerKind ?? node.kind).slice(0, 80),
        name: name.slice(0, 240),
        ownerPath: current.owners.slice(-12).join(' > ').slice(0, 1_200),
      };
      if (
        blocking &&
        activeBlockerItems.length < PREVIEW_INSPECTOR_PAGE_COMPOSITION_BLOCKER_LIMIT
      ) {
        activeBlockerItems.push(blockerItem);
      }
      if (blockerItems.length < PREVIEW_INSPECTOR_PAGE_COMPOSITION_BLOCKER_LIMIT) {
        blockerItems.push(blockerItem);
      } else if (blocking) {
        // A broad page can expose many dormant conditions before the active blocker. Preserve the
        // bounded record but always retain active evidence so headless validation cannot report a
        // positive blocker count with an empty provenance list.
        let replacementIndex = blockerItems.length - 1;
        while (replacementIndex >= 0 && blockerItems[replacementIndex]?.active === true) {
          replacementIndex -= 1;
        }
        if (replacementIndex >= 0) blockerItems[replacementIndex] = blockerItem;
      }
    }
    const childOwners = [...current.owners, name].slice(-24);
    const childLiveOwners = node.mounted === true
      ? [...current.liveOwners, name].slice(-24)
      : current.liveOwners;
    const children = Array.isArray(node.children) ? node.children : [];
    for (let index = children.length - 1; index >= 0; index -= 1) {
      stack.push({
        depth: current.depth + 1,
        liveOwners: childLiveOwners,
        node: children[index],
        owners: childOwners,
      });
    }
  }
  return {
    activeBlockerItems,
    blockerItems,
    counts,
    mountedNames,
    observedFiberPath,
    rows,
    rowsTruncated:
      counts.observed > rows.length || stack.length > 0 || snapshot?.truncated === true,
    visitLimitReached: stack.length > 0,
  };
}

/** Classifies output only after reachability and the collected tree prove current-file Fiber. */
function readPreviewInspectorCompositionTargetStage(reachability, tree) {
  if (reachability?.targetOutputKind === 'fallback-output') return 'fallback-output';
  if (reachability?.targetOutputKind === 'candidate-output') return 'candidate-output';
  // The target-output verifier already requires an exact source/export boundary, owned connected
  // DOM, and authored JSX evidence. Its positive result remains authoritative when a barrel export
  // prevents the secondary display-tree collector from attaching currentFileExport to the
  // implementation Fiber.
  if (
    reachability?.targetOutputKind === 'target-output' &&
    reachability?.targetHasOutput === true
  ) return 'target-output';
  const ownsObservedFiber = tree?.counts?.currentFileMounted > 0 &&
    Array.isArray(tree?.observedFiberPath) &&
    tree.observedFiberPath.length > 0;
  if (reachability?.directTarget === true) return 'direct-target-fallback';
  if (reachability?.targetHasOutput === true) {
    return ownsObservedFiber ? 'target-output' : 'candidate-output';
  }
  if (reachability?.targetMounted === true || reachability?.targetWasMounted === true) {
    return 'target-mounted-no-output';
  }
  if (reachability?.pageRootCommitted === true) return 'page-committed-target-absent';
  return 'awaiting-page-commit';
}

/**
 * Builds one bounded renderer-owned record and a smaller digest used as the React effect dependency.
 * A new tree object on every toolbar render therefore does not emit duplicate health messages.
 */
function createPreviewInspectorPageCompositionHealthSnapshot(snapshot) {
  const descriptor = typeof findSelectedPreviewInspectorDescriptor === 'function'
    ? findSelectedPreviewInspectorDescriptor()
    : undefined;
  const candidates = typeof readPreviewInspectorPageCandidates === 'function'
    ? readPreviewInspectorPageCandidates(descriptor)
    : [];
  const candidate = typeof readSelectedPreviewInspectorPageCandidate === 'function'
    ? readSelectedPreviewInspectorPageCandidate(descriptor)
    : undefined;
  const contextModule = typeof readSelectedPreviewInspectorModuleContext === 'function'
    ? readSelectedPreviewInspectorModuleContext(descriptor)
    : undefined;
  const trackedReachability = descriptor !== undefined && candidate !== undefined &&
    typeof readPreviewInspectorTargetReachabilityState === 'function'
    ? readPreviewInspectorTargetReachabilityState(descriptor, candidate)
    : undefined;
  const standaloneReachability = trackedReachability === undefined && descriptor !== undefined &&
    typeof readPreviewInspectorStandaloneTargetReachabilityState === 'function'
    ? readPreviewInspectorStandaloneTargetReachabilityState(descriptor)
    : undefined;
  const reachability = trackedReachability ?? standaloneReachability;
  const tree = summarizePreviewInspectorPageCompositionTree(snapshot);
  const targetStage = readPreviewInspectorCompositionTargetStage(reachability, tree);
  const retainedTargetError = typeof readPreviewInspectorRuntimeHealthTargetError === 'function'
    ? readPreviewInspectorRuntimeHealthTargetError(reachability?.targetExportName)
    : undefined;
  const targetOutputError = reachability?.targetOutputError ?? retainedTargetError;
  const requirementSearch = trackedReachability !== undefined &&
    typeof readPreviewInspectorMinimumRequirementSearch === 'function'
    ? readPreviewInspectorMinimumRequirementSearch(trackedReachability)
    : undefined;
  const requirementConvergence = trackedReachability !== undefined &&
    typeof readPreviewInspectorRequirementConvergence === 'function'
    ? readPreviewInspectorRequirementConvergence(trackedReachability)
    : undefined;
  const requirementSearchStatus = requirementSearch?.status ??
    (requirementConvergence?.status === 'idle' && targetStage === 'target-output'
      ? 'not-required'
      : requirementConvergence?.status ?? (
        targetStage === 'target-output' ? 'not-required' : 'untracked'
      ));
  const requirementSearchSettled =
    reachability?.exhausted === true ||
    requirementSearchStatus === 'not-required' ||
    ['reached', 'settled', 'limit-reached', 'cycle-detected'].includes(
      requirementSearchStatus,
    );
  const applicationPath = (Array.isArray(reachability?.applicationPath)
    ? reachability.applicationPath
    : []).filter((name) => typeof name === 'string' && name.length > 0).slice(0, 24);
  const missingPathNames = applicationPath.filter((expected) =>
    !tree.mountedNames.some((actual) =>
      matchesPreviewInspectorCompositionIdentity(expected, actual),
    ),
  ).slice(0, 24);
  const routeLocation = candidate?.routeLocation;
  const evidenceSourcePath = typeof descriptor?.inspector?.target?.sourcePath === 'string'
    ? descriptor.inspector.target.sourcePath
    : typeof descriptor?.sourcePath === 'string' && descriptor.sourcePath.length > 0
      ? descriptor.sourcePath
      : undefined;
  const targetExportName = reachability?.targetExportName ??
    descriptor?.inspector?.target?.exportName ??
    descriptor?.exportName ??
    'default';
  const targetOwnershipPhases =
    typeof readPreviewInspectorTargetOwnershipPhases === 'function'
      ? readPreviewInspectorTargetOwnershipPhases({
          exportName: targetExportName,
          sourcePath: evidenceSourcePath,
        })
      : {};
  const activeAutoAttempt = previewInspectorSession.blockerTraceActiveAttempt;
  const targetRuntimeFallbackSummaries = reachability === undefined ||
    !(previewInspectorSession.runtimeFallbacks instanceof Map)
    ? []
    : [...previewInspectorSession.runtimeFallbacks.values()]
        .filter((record) =>
          record?.reachabilityKey === reachability.key &&
          (
            record?.graphqlSelectionBacked === true ||
            record?.hookName === 'useQuery' ||
            (record?.requiredPaths ?? []).some((path) =>
              typeof path === 'string' && path.startsWith('data.'),
            )
          ),
        )
        .slice(-12)
        .map((record) => JSON.stringify({
          fallback: String(record.fallbackPreview ?? '').slice(0, 600),
          graphqlSelectionBacked: record.graphqlSelectionBacked === true,
          id: String(record.id ?? '').slice(-48),
          mode: String(record.mode ?? ''),
          requiredPaths: Array.isArray(record.requiredPaths)
            ? record.requiredPaths.slice(0, 16)
            : [],
        }).slice(0, 1_000));
  const targetRenderCommitChain = reachability !== undefined &&
    typeof readPreviewInspectorTargetRenderCommitChain === 'function'
    ? readPreviewInspectorTargetRenderCommitChain(reachability.key)
    : undefined;
  const standalonePageExecution = standaloneReachability !== undefined;
  const pageExecutionCandidateId = typeof descriptor?.inspector?.pageExecutionCandidateId === 'string'
    ? descriptor.inspector.pageExecutionCandidateId
    : standalonePageExecution
      ? standaloneReachability.candidateId
      : undefined;
  const pageExecutionCandidate = Array.isArray(descriptor?.inspector?.pageExecutionCandidates)
    ? descriptor.inspector.pageExecutionCandidates.find(
        (item) => item?.id === pageExecutionCandidateId,
      )
    : undefined;
  const authoredTargetOwner = (
    typeof evidenceSourcePath === 'string' && evidenceSourcePath.length > 0
      ? evidenceSourcePath + '#' + String(targetExportName)
      : String(targetExportName)
  ).slice(0, 1_200);
  const requiresOutputBlocker = ['candidate-output', 'fallback-output'].includes(targetStage);
  const hasOutputBlocker = tree.blockerItems.some((item) =>
    item.active === true && item.kind === 'target-reachability',
  );
  const outputBlockerItem = requiresOutputBlocker && !hasOutputBlocker
    ? {
        active: true,
        kind: 'target-reachability',
        name: (targetStage === 'fallback-output'
          ? 'Error fallback shown instead · '
          : 'Candidate output is not the current file · ') +
          String(targetExportName),
        ownerPath: String(targetOutputError?.ownerName ?? authoredTargetOwner).slice(0, 1_200),
      }
    : undefined;
  const blockerItems = [
    ...tree.blockerItems,
    ...(outputBlockerItem === undefined ? [] : [outputBlockerItem]),
  ].slice(0, PREVIEW_INSPECTOR_PAGE_COMPOSITION_BLOCKER_LIMIT);
  const activeBlockerItems = [
    ...tree.activeBlockerItems,
    ...(outputBlockerItem === undefined ? [] : [outputBlockerItem]),
  ].slice(0, PREVIEW_INSPECTOR_PAGE_COMPOSITION_BLOCKER_LIMIT);
  const detail = {
    activeBlockerProvenance: activeBlockerItems,
    applicationPath,
    authoredStaticPath: applicationPath,
    blockerSummary: {
      active: tree.counts.activeBlockers + tree.counts.blockingConditions +
        (outputBlockerItem === undefined ? 0 : 1),
      items: blockerItems,
      total: tree.counts.blockers + tree.counts.conditions +
        (outputBlockerItem === undefined ? 0 : 1),
    },
    candidate: {
      candidateCount: candidates.length,
      complete: candidate?.complete === true,
      entryConnected: candidate?.renderPath?.entryPoint !== undefined,
      id: candidate?.id ?? 'none',
      rootExport: candidate?.root?.exportName ?? 'none',
      rootSourcePath: candidate?.root?.sourcePath ?? '',
      rootStepIndex: Number.isInteger(candidate?.rootStepIndex)
        ? candidate.rootStepIndex
        : '[unknown]',
      stopReason: candidate?.stopReason ?? 'none',
      virtualPage: candidate?.virtualPage,
    },
    ...(typeof contextModule?.sourcePath !== 'string'
      ? {}
      : {
          contextModule: {
            evidenceKind: contextModule.evidenceKind,
            importPathLength: Array.isArray(contextModule.importPath)
              ? contextModule.importPath.length
              : 0,
            sourcePath: contextModule.sourcePath,
          },
        }),
    ...(evidenceSourcePath === undefined
      ? {}
      : { evidence: { sourcePath: evidenceSourcePath } }),
    missingShellNames: missingPathNames,
    observedFiberPath: tree.observedFiberPath,
    pageExecution: {
      candidateId: pageExecutionCandidateId ?? 'none',
      executionRootSurfaceId:
        typeof pageExecutionCandidate?.executionRootSurfaceId === 'string'
          ? pageExecutionCandidate.executionRootSurfaceId
          : standalonePageExecution ? authoredTargetOwner : '',
      fidelity: typeof pageExecutionCandidate?.fidelity === 'string'
        ? pageExecutionCandidate.fidelity
        : standalonePageExecution ? 'target-only' : 'none',
      nestedMountCount: Number.isSafeInteger(pageExecutionCandidate?.nestedMountCount)
        ? Math.max(0, pageExecutionCandidate.nestedMountCount)
        : 0,
      ownsGeneratedRouter: pageExecutionCandidate?.ownsGeneratedRouter === true,
      runtimeTargetSurfaceId:
        typeof pageExecutionCandidate?.runtimeTargetSurfaceId === 'string'
          ? pageExecutionCandidate.runtimeTargetSurfaceId
          : standalonePageExecution ? authoredTargetOwner : '',
      standaloneTarget:
        pageExecutionCandidate?.standaloneTarget === true || standalonePageExecution,
      targetRole: typeof pageExecutionCandidate?.targetRole === 'string'
        ? pageExecutionCandidate.targetRole
        : 'element',
    },
    route: {
      evidenceKind: routeLocation?.evidenceKind ?? 'none',
      pathname: routeLocation?.pathname ?? '/',
      pattern: routeLocation?.pattern ?? '',
      rootOwnsRouter: candidate?.rootOwnsRouter === true,
    },
    requirementSearch: {
      convergenceStatus: requirementConvergence?.status ?? 'untracked',
      exhausted: reachability?.exhausted === true,
      observedPathCount: Number.isSafeInteger(requirementSearch?.observedPathCount)
        ? Math.max(0, requirementSearch.observedPathCount)
        : 0,
      pass: Number.isSafeInteger(requirementSearch?.pass)
        ? Math.max(0, requirementSearch.pass)
        : 0,
      searchStatus: requirementSearchStatus,
      settled: requirementSearchSettled,
      totalPasses: Number.isSafeInteger(requirementSearch?.totalPasses)
        ? Math.max(0, requirementSearch.totalPasses)
        : 0,
    },
    statusCounts: tree.counts,
    targetState: {
      activeAutoAttemptMode: typeof activeAutoAttempt?.autoMode === 'string'
        ? activeAutoAttempt.autoMode
        : '',
      activeAutoAttemptResumeHandled:
        activeAutoAttempt?.targetReachabilityResumeHandled === true,
      activeAutoAttemptResumeScheduled:
        activeAutoAttempt?.targetReachabilityResumeScheduled === true,
      activeAutoAttemptSettled: Number.isFinite(activeAutoAttempt?.settledAt),
      appliedConditionCount: Array.isArray(reachability?.appliedConditions)
        ? reachability.appliedConditions.length
        : 0,
      attempt: Number.isSafeInteger(reachability?.attempt) ? Math.max(0, reachability.attempt) : 0,
      contextualTargetFallbackRequested:
        reachability?.contextualTargetFallbackRequested === true,
      directTarget: reachability?.directTarget === true,
      detachedBoundaryOutput: reachability?.targetDetachedBoundaryOutput === true,
      detachedTargetPlacement: reachability?.detachedTargetPlacement ?? '',
      directElementOutput: reachability?.targetDirectElementOutput === true,
      exportName: targetExportName,
      ...(typeof targetOutputError?.message === 'string'
        ? { errorMessage: targetOutputError.message.slice(0, 1_200) }
        : {}),
      ...(typeof targetOutputError?.details === 'string'
        ? { errorDetails: targetOutputError.details.slice(0, 2_400) }
        : {}),
      ...(typeof targetOutputError?.location === 'string'
        ? { errorLocation: targetOutputError.location.slice(0, 1_024) }
        : {}),
      ...(typeof targetOutputError?.ownerName === 'string'
        ? { errorOwner: targetOutputError.ownerName.slice(0, 240) }
        : {}),
      ...(typeof targetOutputError?.phase === 'string'
        ? { errorPhase: targetOutputError.phase.slice(0, 240) }
        : {}),
      ...(typeof targetOutputError?.stack === 'string'
        ? { errorStack: targetOutputError.stack.slice(0, 4_000) }
        : {}),
      ...(typeof targetOutputError?.fallbackOwnerName === 'string'
        ? { fallbackOwner: targetOutputError.fallbackOwnerName.slice(0, 240) }
        : {}),
      hasOutput: targetStage === 'target-output',
      idlePasses: Number.isSafeInteger(reachability?.idlePasses)
        ? Math.max(0, reachability.idlePasses)
        : 0,
      lastContinuationSkipReason: typeof reachability?.lastContinuationSkipReason === 'string'
        ? reachability.lastContinuationSkipReason
        : '',
      mounted: reachability?.targetMounted === true,
      outputKind: reachability?.targetOutputKind ?? 'none',
      projectedCompatibilityOutput:
        reachability?.targetProjectedCompatibilityOutput === true,
      ownershipPhases: targetOwnershipPhases,
      pageRootCommitted: reachability?.pageRootCommitted === true,
      probeRevision: Number.isSafeInteger(reachability?.probeRevision)
        ? Math.max(0, reachability.probeRevision)
        : 0,
      rejectedConditionCount: Array.isArray(reachability?.rejectedConditions)
        ? reachability.rejectedConditions.length
        : 0,
      reachabilityHasOutput: reachability?.targetHasOutput === true,
      renderScenario: typeof readPreviewInspectorRenderScenario === 'function'
        ? readPreviewInspectorRenderScenario()
        : 'authored-page',
      stage: targetStage,
      status: reachability?.status ?? 'untracked',
      runtimeFallbackSummaries: targetRuntimeFallbackSummaries,
      targetRenderCommitChain,
      targetEffectControllerOutput: reachability?.targetEffectControllerOutput === true,
      targetRenderedEmpty: reachability?.targetRenderedEmpty === true,
      wasMounted: reachability?.targetWasMounted === true,
    },
    treeRows: tree.rows,
    treeRowsTruncated: tree.rowsTruncated,
    treeStatus: snapshot?.status ?? 'unknown',
    visitLimitReached: tree.visitLimitReached,
  };
  const digest = JSON.stringify([
    detail.candidate.id,
    detail.candidate.complete,
    detail.contextModule,
    detail.pageExecution,
    detail.route.pathname,
    detail.targetState.stage,
    detail.targetState.status,
    detail.targetState.errorOwner,
    detail.targetState.errorMessage,
    detail.targetState.pageRootCommitted,
    detail.targetState.ownershipPhases,
    detail.targetState.targetEffectControllerOutput,
    detail.targetState.targetRenderedEmpty,
    detail.requirementSearch,
    detail.targetState.runtimeFallbackSummaries,
    detail.targetState.targetRenderCommitChain,
    tree.rows.map((row) => [row.name, row.state]),
    blockerItems.map((item) => [item.name, item.active]),
    missingPathNames,
    tree.observedFiberPath,
  ]);
  return { detail, digest };
}

/** Proves that Page Inspector committed the exact selected target with blocker-free output. */
function hasPreviewInspectorVerifiedTargetOutput(detail) {
  const target = detail?.targetState;
  const blockers = detail?.blockerSummary;
  return target?.stage === 'target-output' &&
    target.status === 'reached' &&
    target.outputKind === 'target-output' &&
    target.mounted === true &&
    target.hasOutput === true &&
    target.pageRootCommitted === true &&
    blockers?.active === 0 &&
    Array.isArray(detail?.activeBlockerProvenance) &&
    detail.activeBlockerProvenance.length === 0;
}

/** Emits one deduplicated page snapshot after the corresponding Inspector toolbar commit. */
function recordPreviewInspectorPageCompositionHealthSnapshot(snapshot) {
  if (
    snapshot === null ||
    typeof snapshot !== 'object' ||
    typeof recordPreviewInspectorRuntimeHealth !== 'function'
  ) {
    return;
  }
  recordPreviewInspectorRuntimeHealth({
    category: 'page-composition',
    detail: snapshot.detail,
    event: 'page-composition-snapshot',
  });
  // Page Execution can commit the authored target in a nested root while the outer Inspector root
  // is still waiting on unrelated work. This is an equally strong terminal success signal, so let
  // the normal token/revision-correlated readiness protocol settle the host watchdog.
  if (hasPreviewInspectorVerifiedTargetOutput(snapshot.detail)) {
    completePreviewCommit();
  }
}
`;
}
