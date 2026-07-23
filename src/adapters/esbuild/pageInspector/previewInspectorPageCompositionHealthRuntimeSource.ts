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
    if (
      (node.kind === 'blocker' || node.kind === 'condition') &&
      blockerItems.length < PREVIEW_INSPECTOR_PAGE_COMPOSITION_BLOCKER_LIMIT
    ) {
      blockerItems.push({
        active: blocking,
        kind: String(node.blockerKind ?? node.kind).slice(0, 80),
        name: name.slice(0, 240),
        ownerPath: current.owners.slice(-12).join(' > ').slice(0, 1_200),
      });
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

/** Classifies the selected target's commit/mount/output phase for one-line log scanning. */
function readPreviewInspectorCompositionTargetStage(reachability) {
  if (reachability?.directTarget === true) return 'direct-target-fallback';
  if (reachability?.targetHasOutput === true) return 'target-output';
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
  const reachability = descriptor !== undefined && candidate !== undefined &&
    typeof readPreviewInspectorTargetReachabilityState === 'function'
    ? readPreviewInspectorTargetReachabilityState(descriptor, candidate)
    : undefined;
  const tree = summarizePreviewInspectorPageCompositionTree(snapshot);
  const applicationPath = (Array.isArray(reachability?.applicationPath)
    ? reachability.applicationPath
    : []).filter((name) => typeof name === 'string' && name.length > 0).slice(0, 24);
  const missingPathNames = applicationPath.filter((expected) =>
    !tree.mountedNames.some((actual) =>
      matchesPreviewInspectorCompositionIdentity(expected, actual),
    ),
  ).slice(0, 24);
  const routeLocation = candidate?.routeLocation;
  const evidenceSourcePath = typeof routeLocation?.sourcePath === 'string'
    ? routeLocation.sourcePath
    : typeof candidate?.root?.sourcePath === 'string'
      ? candidate.root.sourcePath
      : undefined;
  const detail = {
    applicationPath,
    authoredStaticPath: applicationPath,
    blockerSummary: {
      active: tree.counts.activeBlockers + tree.counts.blockingConditions,
      items: tree.blockerItems,
      total: tree.counts.blockers + tree.counts.conditions,
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
    },
    ...(evidenceSourcePath === undefined
      ? {}
      : { evidence: { sourcePath: evidenceSourcePath } }),
    missingShellNames: missingPathNames,
    observedFiberPath: tree.observedFiberPath,
    route: {
      evidenceKind: routeLocation?.evidenceKind ?? 'none',
      pathname: routeLocation?.pathname ?? '/',
      pattern: routeLocation?.pattern ?? '',
      rootOwnsRouter: candidate?.rootOwnsRouter === true,
    },
    statusCounts: tree.counts,
    targetState: {
      directTarget: reachability?.directTarget === true,
      exportName: reachability?.targetExportName ??
        descriptor?.inspector?.target?.exportName ??
        descriptor?.exportName ??
        'default',
      hasOutput: reachability?.targetHasOutput === true,
      mounted: reachability?.targetMounted === true,
      pageRootCommitted: reachability?.pageRootCommitted === true,
      renderScenario: typeof readPreviewInspectorRenderScenario === 'function'
        ? readPreviewInspectorRenderScenario()
        : 'authored-page',
      stage: readPreviewInspectorCompositionTargetStage(reachability),
      status: reachability?.status ?? 'untracked',
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
    detail.route.pathname,
    detail.targetState.stage,
    detail.targetState.status,
    tree.rows.map((row) => [row.name, row.state]),
    tree.blockerItems.map((item) => [item.name, item.active]),
    missingPathNames,
    tree.observedFiberPath,
  ]);
  return { detail, digest };
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
}
`;
}
