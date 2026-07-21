/**
 * Generates blocker nodes and editors for the React Page Inspector component tree.
 *
 * Authored JSX conditions, render-only hook substitutions, backend payload fixtures, and locally
 * contained target failures share one visible tree vocabulary. Records stay attached to the nearest
 * source-backed React owner so users can see where rendering would have stopped and can choose an
 * explicit JSON value or the extension's bounded Auto inference.
 */

/**
 * Creates browser source that enriches a component tree and renders blocker-specific controls.
 *
 * Expected lexical bindings include the condition, data, fallback, target-boundary, JSON, and shared
 * DevTools helpers declared by the composed Page Inspector runtime.
 *
 * @returns Plain JavaScript source concatenated into the isolated Inspector UI runtime.
 */
export function createPreviewInspectorBlockerUiRuntimeSource(): string {
  return String.raw`
const PREVIEW_INSPECTOR_REQUIRED_PATH_SUMMARY_LIMIT = 10;
const PREVIEW_INSPECTOR_REQUIRED_PATH_TEXT_LIMIT = 180;

/**
 * Bounds the target-path payload summary without hiding how much additional evidence was found.
 * The resolver and trace logger retain the complete set; this helper changes presentation only.
 */
function summarizePreviewInspectorRequiredPaths(requiredPaths) {
  const uniquePaths = [...new Set((Array.isArray(requiredPaths) ? requiredPaths : [])
    .filter((path) => typeof path === 'string' && path.length > 0))];
  const visiblePaths = uniquePaths
    .slice(0, PREVIEW_INSPECTOR_REQUIRED_PATH_SUMMARY_LIMIT)
    .map((path) => path.length <= PREVIEW_INSPECTOR_REQUIRED_PATH_TEXT_LIMIT
      ? path
      : path.slice(0, PREVIEW_INSPECTOR_REQUIRED_PATH_TEXT_LIMIT - 1) + '…');
  return {
    remainingCount: Math.max(0, uniquePaths.length - visiblePaths.length),
    totalCount: uniquePaths.length,
    visiblePaths,
  };
}

/** Creates a common source object for compiler/runtime records retained by the local webview. */
function createPreviewInspectorBlockerSource(record) {
  return normalizePreviewInspectorUiSource({
    column: record?.column,
    displayName: record?.sourcePath,
    line: record?.line,
    occurrenceStart: record?.occurrenceStart,
    path: record?.sourcePath,
  });
}

/** Converts one isolated hook edge into a selectable blocker below its owning component. */
function createPreviewInspectorRuntimeFallbackTreeNode(fallback) {
  return {
    blocker: fallback,
    blockerId: fallback.id,
    blockerKind: 'runtime-fallback',
    children: [],
    id: 'runtime-blocker:' + fallback.id,
    kind: 'blocker',
    name: 'Missing hook value · ' + fallback.hookName,
    props: {
      generatedPaths: fallback.generatedPaths,
      mode: fallback.mode,
      reason: fallback.reason,
      requiredPaths: fallback.requiredPaths,
    },
    source: createPreviewInspectorBlockerSource(fallback),
    state: { error: fallback.error, generated: fallback.fallbackPreview },
  };
}

/** Converts one intercepted backend read into an editable data dependency below its caller. */
function createPreviewInspectorDataBlockerTreeNode(request) {
  return {
    blocker: request,
    blockerId: request.id,
    blockerKind: 'data-request',
    children: [],
    id: 'data-blocker:' + request.id,
    kind: 'blocker',
    name: 'Backend data · ' + request.label,
    props: {
      evidence: request.evidence,
      latencyMs: request.virtualBackend?.latencyMs,
      mode: request.mode,
      requiredPaths: readPreviewInspectorDataShapePaths(request.shape),
      resource: request.virtualBackend?.resourceKey,
      responseScenario: request.virtualBackend?.mode ?? request.virtualBackend?.scenario,
      status: request.virtualBackend?.status,
    },
    source: createPreviewInspectorBlockerSource(request),
    state: { payload: request.payload, servedPayload: request.servedPayload },
  };
}

/** Reads failures currently contained by target-local boundaries without retaining Fiber objects. */
function readPreviewInspectorTargetFailures() {
  const failures = [];
  const seen = new Set();
  for (const [exportName, boundaries] of previewInspectorSession.boundariesByExport) {
    for (const boundary of boundaries) {
      const error = boundary?.state?.error;
      if (error === undefined) continue;
      const headline = createRuntimeErrorHeadline(error).slice(0, 1_000);
      const componentStack = typeof boundary?.state?.componentStack === 'string'
        ? boundary.state.componentStack
        : '';
      const identity = exportName + '\0' + headline + '\0' + componentStack;
      if (seen.has(identity) || failures.length >= 64) continue;
      seen.add(identity);
      const descriptor = previewInspectorSession.descriptors.find((item) =>
        Object.hasOwn(item?.inspector?.renderChainsByExport ?? {}, exportName) ||
        item?.inspector?.target?.exportName === exportName,
      );
      const reference = descriptor?.inspector?.renderChainsByExport?.[exportName]?.target ??
        descriptor?.inspector?.target;
      const componentNames = readPreviewInspectorComponentStackNames(componentStack, exportName);
      const blockedComponentName = readPreviewInspectorBlockedComponentName(
        componentStack,
        exportName,
      );
      const requiredPaths = readPreviewInspectorErrorPropertyPaths(error);
      const targetPropRequiredPaths =
        typeof readPreviewInspectorTargetPropFailurePaths === 'function'
          ? readPreviewInspectorTargetPropFailurePaths(exportName, blockedComponentName, error)
          : [];
      failures.push({
        blockedComponentName,
        componentNames,
        componentStack,
        error,
        exportName,
        headline,
        id: 'target-error:' + exportName + ':' + String(failures.length),
        occurrenceStart: reference?.occurrenceStart,
        requiredPaths,
        sourcePath: reference?.sourcePath,
        // Runtime owner identity plus compiler path correlation prevents a hook/local receiver from
        // being projected onto the selected export merely because its component name is identical.
        targetPropRequiredPaths,
      });
    }
  }
  return failures;
}

/** Creates a locally recoverable node for an error already contained inside the rendered page. */
function createPreviewInspectorTargetFailureTreeNode(failure) {
  return {
    blocker: failure,
    blockerId: failure.id,
    blockerKind: 'target-error',
    children: [],
    id: failure.id,
    kind: 'blocker',
    name: 'Component error · ' + failure.blockedComponentName,
    ownerExportName: failure.exportName,
    props: {
      componentPath: failure.componentNames,
      error: failure.headline,
      requiredPaths: failure.requiredPaths,
    },
    source: createPreviewInspectorBlockerSource(failure),
    state: undefined,
  };
}

/** Represents a page corridor that has not produced connected output for the selected export. */
function createPreviewInspectorTargetReachabilityTreeNode(blocker) {
  const mountedWithoutOutput = blocker.targetMounted === true && blocker.targetHasOutput !== true;
  const deferredCallbackPending = mountedWithoutOutput &&
    blocker.targetDeferredCallbackPending === true;
  const wrapperHostOnly = mountedWithoutOutput && blocker.targetHasAnyHostOutput === true;
  return {
    blocker,
    blockerId: blocker.id,
    blockerKind: 'target-reachability',
    children: [],
    id: blocker.id,
    kind: 'blocker',
    name: (deferredCallbackPending
      ? 'Render callback not invoked · '
      : wrapperHostOnly
      ? 'Target authored JSX absent · '
      : mountedWithoutOutput ? 'Target produced no host output · ' : 'Target not reached · ') +
        blocker.targetExportName,
    props: {
      applicationPath: blocker.applicationPath,
      appliedGates: blocker.appliedConditions.map((condition) => condition.expression),
      requiredPaths: blocker.requiredPaths,
      status: blocker.status,
      targetDeferredCallbackPending: deferredCallbackPending,
    },
    source: createPreviewInspectorBlockerSource(blocker),
    state: {
      directTarget: blocker.directTarget,
      targetHasOutput: blocker.targetHasOutput,
      targetMounted: blocker.targetMounted,
    },
  };
}

/** Collects mounted/static components while excluding inert context and pseudo-node groups. */
function collectPreviewInspectorBlockerOwners(nodes, owners = [], depth = 0) {
  for (const node of nodes) {
    const sourcePath = normalizePreviewInspectorConditionSourcePath(node.source?.path);
    if (
      node.contextOnly !== true &&
      node.kind !== 'condition' &&
      node.kind !== 'blocker'
    ) {
      owners.push({
        currentFileExport: node.currentFileExport === true,
        depth,
        exportName: node.exportName,
        id: node.id,
        line: Number.isSafeInteger(node.source?.line) ? node.source.line : 0,
        name: node.name,
        sourcePath,
      });
    }
    collectPreviewInspectorBlockerOwners(node.children, owners, depth + 1);
  }
  return owners;
}

/** Scores one source-local owner without letting line distance beat an exact component name. */
function scorePreviewInspectorBlockerOwner(owner, sourcePath, line) {
  const sameSource = sourcePath.length > 0 &&
    matchesPreviewInspectorConditionSourcePath(owner.sourcePath, sourcePath);
  const precedes = owner.line <= line;
  return (sameSource ? 0 : 10_000_000) +
    (precedes ? 0 : 1_000_000) +
    Math.abs(line - owner.line) - owner.depth / 1_000;
}

/** Selects an exact named owner first, then the nearest surviving source-backed ancestor. */
function findPreviewInspectorBlockerOwner(record, owners) {
  const sourcePath = normalizePreviewInspectorConditionSourcePath(record?.sourcePath);
  const line = Number.isSafeInteger(record?.line) ? record.line : 0;
  const ownerName = typeof record?.ownerName === 'string' ? record.ownerName : '';
  const namedOwners = ownerName.length === 0
    ? []
    : owners.filter((owner) => owner.name === ownerName || owner.exportName === ownerName);
  const sourceNamedOwners = sourcePath.length === 0
    ? namedOwners
    : namedOwners.filter((owner) =>
        matchesPreviewInspectorConditionSourcePath(owner.sourcePath, sourcePath));
  const pool = sourceNamedOwners.length > 0
    ? sourceNamedOwners
    : sourcePath.length > 0
      ? owners.filter((owner) =>
          matchesPreviewInspectorConditionSourcePath(owner.sourcePath, sourcePath))
        : [];
  let selected;
  let selectedScore = Number.POSITIVE_INFINITY;
  for (const owner of pool) {
    const score = scorePreviewInspectorBlockerOwner(owner, sourcePath, line);
    if (score < selectedScore) {
      selected = owner;
      selectedScore = score;
    }
  }
  if (selected !== undefined) {
    return { exactName: sourceNamedOwners.length > 0, owner: selected };
  }
  const fallback = owners.find((owner) =>
    owner.exportName === previewInspectorSession.selectedExportName,
  ) ?? owners.find((owner) => owner.currentFileExport === true);
  return fallback === undefined ? undefined : { exactName: false, owner: fallback };
}

/** Creates a visible component row for a failed Fiber that disappeared before tree collection. */
function createPreviewInspectorSyntheticBlockedOwner(record, children, identityPrefix) {
  const ownerName = typeof record?.ownerName === 'string' && record.ownerName.length > 0
    ? record.ownerName
    : typeof record?.blockedComponentName === 'string' && record.blockedComponentName.length > 0
      ? record.blockedComponentName
      : 'Blocked component';
  return {
    blockedOwner: true,
    children,
    contextOnly: false,
    id: identityPrefix + ':' + ownerName + ':' + String(record?.line ?? 0),
    kind: 'component',
    mounted: false,
    name: ownerName,
    props: { requiredPaths: record?.requiredPaths ?? [] },
    source: createPreviewInspectorBlockerSource(record),
    state: { renderBlocked: true },
  };
}

/** Reconstructs failed descendants below an export from React's innermost-first stack. */
function createPreviewInspectorTargetFailureBranch(failure) {
  const blocker = createPreviewInspectorTargetFailureTreeNode(failure);
  const exportIndex = failure.componentNames.indexOf(failure.exportName);
  const descendants = exportIndex > 0
    ? failure.componentNames.slice(0, exportIndex)
    : failure.blockedComponentName === failure.exportName
      ? []
      : [failure.blockedComponentName];
  let branch = blocker;
  for (const componentName of descendants) {
    branch = createPreviewInspectorSyntheticBlockedOwner(
      { ...failure, ownerName: componentName },
      [branch],
      'target-blocked-owner:' + failure.id,
    );
  }
  return branch;
}

/** Appends assigned blockers immutably so a cached Fiber snapshot remains collector-owned. */
function appendPreviewInspectorAssignedBlockers(nodes, assignments, targetFailures) {
  return nodes.map((node) => ({
    ...node,
    children: [
      ...appendPreviewInspectorAssignedBlockers(node.children, assignments, targetFailures),
      ...(assignments.get(node.id) ?? []),
      ...(typeof node.exportName === 'string'
        ? (targetFailures.get(node.exportName) ?? []).map(createPreviewInspectorTargetFailureBranch)
        : []),
    ],
  }));
}

/** Adds hook, data, and contained-error blockers after authored condition nodes are attached. */
function attachPreviewInspectorBlockersToSnapshot(snapshot) {
  const conditionedSnapshot = attachPreviewInspectorConditionsToSnapshot(snapshot);
  const owners = collectPreviewInspectorBlockerOwners(conditionedSnapshot.roots);
  const assignments = new Map();
  const rootBlockers = [];
  const syntheticAssignments = new Map();
  const candidates = [
    ...readPreviewInspectorTargetReachabilityBlockers().map((record) => ({
      node: createPreviewInspectorTargetReachabilityTreeNode(record),
      record,
    })),
    ...readPreviewInspectorRuntimeFallbacks()
      .filter((record) => record.passive !== true)
      .map((record) => ({
        node: createPreviewInspectorRuntimeFallbackTreeNode(record),
        record,
      })),
    ...readPreviewInspectorDataRequests().map((record) => ({
      node: createPreviewInspectorDataBlockerTreeNode(record),
      record,
    })),
  ];
  for (const candidate of candidates) {
    const match = findPreviewInspectorBlockerOwner(candidate.record, owners);
    if (match === undefined) {
      rootBlockers.push(createPreviewInspectorSyntheticBlockedOwner(
        candidate.record,
        [candidate.node],
        'root-blocked-owner',
      ));
      continue;
    }
    const recordOwnerName = typeof candidate.record?.ownerName === 'string'
      ? candidate.record.ownerName
      : '';
    if (recordOwnerName.length > 0 && !match.exactName) {
      const key = match.owner.id + '\0' + recordOwnerName;
      const synthetic = syntheticAssignments.get(key) ?? createPreviewInspectorSyntheticBlockedOwner(
        candidate.record,
        [],
        'blocked-owner:' + match.owner.id,
      );
      synthetic.children.push(candidate.node);
      syntheticAssignments.set(key, synthetic);
      continue;
    }
    const assigned = assignments.get(match.owner.id) ?? [];
    assigned.push(candidate.node);
    assignments.set(match.owner.id, assigned);
  }
  for (const [key, synthetic] of syntheticAssignments) {
    const ownerId = key.split('\0', 1)[0];
    const assigned = assignments.get(ownerId) ?? [];
    assigned.push(synthetic);
    assignments.set(ownerId, assigned);
  }
  const targetFailures = new Map();
  for (const failure of readPreviewInspectorTargetFailures()) {
    const grouped = targetFailures.get(failure.exportName) ?? [];
    grouped.push(failure);
    targetFailures.set(failure.exportName, grouped);
  }
  const roots = appendPreviewInspectorAssignedBlockers(
    conditionedSnapshot.roots,
    assignments,
    targetFailures,
  );
  roots.push(...rootBlockers);
  const blockerSnapshot = {
    ...conditionedSnapshot,
    roots,
  };
  const enrichedSnapshot = typeof attachPreviewInspectorDeferredUiTriggersToSnapshot === 'function'
    ? attachPreviewInspectorDeferredUiTriggersToSnapshot(blockerSnapshot)
    : blockerSnapshot;
  if (typeof publishPreviewInspectorBlockerTraceSnapshot === 'function') {
    publishPreviewInspectorBlockerTraceSnapshot(enrichedSnapshot);
  }
  return enrichedSnapshot;
}

/** Reports whether selection should open blocker controls instead of ordinary component props. */
function isPreviewInspectorBlockerNode(node) {
  return isPreviewInspectorConditionNode(node) ||
    (node?.kind === 'blocker' && typeof node.blockerKind === 'string');
}

/** Reports whether an editable pseudo-node currently stops the selected page instead of assisting it. */
function isPreviewInspectorBlockingNode(node) {
  if (isPreviewInspectorConditionNode(node)) return node?.blocksCurrentTarget === true;
  if (node?.blockerKind === 'runtime-fallback') {
    return !['manual', 'smart-manual'].includes(node.blocker?.mode) &&
      !readPreviewInspectorFallbackValuesEnabled();
  }
  if (node?.blockerKind === 'data-request') {
    const payload = node.blocker?.payload;
    const usefulPayload = Array.isArray(payload)
      ? payload.length > 0
      : payload !== null && typeof payload === 'object'
        ? Object.keys(payload).length > 0
        : payload !== undefined;
    return node.blocker?.mode === 'seed' && !usefulPayload;
  }
  if (node?.blockerKind === 'target-reachability') {
    return node.blocker?.directTarget === true || node.blocker?.exhausted === true ||
      node.blocker?.status === 'page-blocked';
  }
  return node?.blockerKind === 'target-error';
}

/** Collects only active render stops for the friendly page-status summary. */
function readPreviewInspectorActiveBlockerSummary() {
  const nodes = [
    ...readPreviewInspectorTargetReachabilityBlockers().map(createPreviewInspectorTargetReachabilityTreeNode),
    ...readPreviewInspectorRuntimeFallbacks()
      .filter((record) => record.passive !== true)
      .map(createPreviewInspectorRuntimeFallbackTreeNode),
    ...readPreviewInspectorDataRequests().map(createPreviewInspectorDataBlockerTreeNode),
    ...readPreviewInspectorTargetFailures().map(createPreviewInspectorTargetFailureTreeNode),
  ];
  const active = nodes.filter(isPreviewInspectorBlockingNode);
  return { active, count: active.length, first: active[0] };
}

/** Produces the compact status badge shown directly beside one blocker tree row. */
function formatPreviewInspectorBlockerBadge(node) {
  if (isPreviewInspectorConditionNode(node)) {
    if (node.condition?.reached === false) return 'not reached yet';
    return (node.condition?.effectiveEnabled === true ? 'branch on' : 'branch off') +
      (typeof node.condition?.override === 'boolean'
        ? ' · forced'
        : typeof node.condition?.autoOverride === 'boolean'
          ? ' · path auto'
          : '');
  }
  if (node?.blockerKind === 'runtime-fallback') {
    return 'hook value · ' + (
      node.blocker?.mode === 'smart-manual'
        ? 'user + smart'
        : node.blocker?.mode === 'manual'
          ? 'user'
          : node.blocker?.mode === 'smart'
            ? 'smart'
            : 'auto'
    );
  }
  if (node?.blockerKind === 'data-request') {
    return 'backend data · ' + String(node.blocker?.mode ?? 'seed');
  }
  if (node?.blockerKind === 'target-reachability') {
    return node.blocker?.directTarget === true ? 'target only' : 'page path';
  }
  if (node?.blockerKind === 'target-error') return 'component error';
  return 'blocker';
}

/** Explains the selected pseudo-node in user language before showing its technical editor. */
function PreviewInspectorBlockerGuide({ node }) {
  const condition = isPreviewInspectorConditionNode(node);
  const blocking = isPreviewInspectorBlockingNode(node);
  const targetAbsent = node?.blockerKind === 'target-reachability' &&
    node?.blocker?.pageRootCommitted === true && node?.blocker?.targetMounted !== true;
  let detail = 'The page can continue, but you can inspect or replace the generated value below.';
  let helpKind = 'assisted';
  let icon = '≈';
  let title = 'React Preview supplied a local preview value here.';
  if (condition && blocking) {
    detail = 'This hidden overlay contains the selected file. React Preview will choose its visible branch automatically unless a manual branch override prevents it.';
    helpKind = 'blocking';
    icon = '!';
    title = 'A dormant overlay blocks the current-file component.';
  } else if (condition) {
    detail = 'Choose a branch below. This changes only the pinned preview.';
    helpKind = 'condition';
    icon = '?';
    title = 'This condition chooses which React branch is visible.';
  } else if (targetAbsent) {
    detail = 'This may be a valid application outcome. Compare another Page path, inspect File components, or provide path values when static evidence is sufficient.';
    helpKind = 'flow-outcome';
    icon = '↳';
    title = 'The authored page rendered without mounting this current-file component.';
  } else if (blocking) {
    detail = 'Use Smart fill to add only proven missing values, or enter a value below; the page remounts after applying it.';
    helpKind = 'blocking';
    icon = '!';
    title = 'Rendering stops at this point in the component tree.';
  }
  return React.createElement(
    'section',
    {
      className: 'rpi-blocker-help',
      'data-help-kind': helpKind,
    },
    React.createElement(
      'span',
      { 'aria-hidden': true, className: 'rpi-blocker-help-icon' },
      icon,
    ),
    React.createElement(
      'span',
      { className: 'rpi-blocker-help-copy' },
      React.createElement('strong', undefined, title),
      React.createElement('span', undefined, detail),
    ),
  );
}

/** Renders JSON editing and Auto inference controls for one bypassed hook result. */
function PreviewInspectorRuntimeBlockerDetail({ node }) {
  const fallback = node.blocker;
  const editableValue = readPreviewInspectorRuntimeFallbackDraft(fallback.id);
  const draftKey = fallback.id + ':' + fallback.mode + ':' + fallback.fallbackPreview;
  const [draftText, setDraftText] = React.useState(
    () => stringifyPreviewInspectorProps(editableValue ?? {}),
  );
  const [draftError, setDraftError] = React.useState('');
  React.useEffect(() => {
    setDraftText(stringifyPreviewInspectorProps(editableValue ?? {}));
    setDraftError('');
  }, [draftKey]);
  const applyDraft = () => {
    try {
      setPreviewInspectorRuntimeFallbackOverride(fallback.id, JSON.parse(draftText));
      setDraftError('');
    } catch (error) {
      setDraftError(error instanceof Error ? error.message : String(error));
    }
  };
  return React.createElement(
    'div',
    { className: 'rpi-detail-content' },
    React.createElement('div', { className: 'rpi-meta' },
      fallback.hookName + ' · ' + (
        fallback.mode === 'manual'
          ? 'USER VALUE'
          : fallback.mode === 'smart-manual'
            ? 'USER + SMART MINIMUM'
          : fallback.mode === 'smart'
            ? 'GENERATED · SMART MINIMUM'
            : 'GENERATED · AUTO'
      )),
    fallback.error ? React.createElement('div', { className: 'rpi-error' }, fallback.error) : undefined,
    React.createElement('div', { className: 'rpi-note' }, 'Evidence: ' + fallback.evidence),
    fallback.ownerName
      ? React.createElement('div', { className: 'rpi-note' },
          'Blocked component: ' + fallback.ownerName)
      : undefined,
    fallback.requiredPaths?.length > 0
      ? React.createElement('div', { className: 'rpi-note' },
          'Required properties: ' + fallback.requiredPaths.join(', '))
      : undefined,
    React.createElement('div', { className: 'rpi-note' },
      'Smart fill preserves user JSON; otherwise it starts from an empty compatible root, adds only demanded paths, restores inert callbacks, and creates one item only when a demanded path enters a list.'),
    React.createElement('textarea', {
      'aria-label': 'Render blocker result JSON',
      className: 'rpi-json',
      onChange: (event) => setDraftText(event.target.value),
      spellCheck: false,
      value: draftText,
    }),
    draftError ? React.createElement('div', { className: 'rpi-error', role: 'alert' }, draftError) : undefined,
    React.createElement(
      'div',
      { className: 'rpi-actions' },
      React.createElement(
        PreviewInspectorDevtoolsButton,
        {
          onClick: () => smartFillPreviewInspectorRuntimeFallback(fallback.id),
          pressed: fallback.mode === 'smart' || fallback.mode === 'smart-manual',
          title: 'Generate the minimum value shape proven necessary by downstream property reads',
        },
        'Smart fill minimum',
      ),
      React.createElement(PreviewInspectorDevtoolsButton, { onClick: applyDraft }, 'Apply pass value'),
      React.createElement(
        PreviewInspectorDevtoolsButton,
        { onClick: () => autoPassPreviewInspectorRuntimeFallback(fallback.id), pressed: fallback.mode === 'auto' },
        'Auto pass',
      ),
      React.createElement(
        PreviewInspectorDevtoolsButton,
        {
          disabled: !['manual', 'smart-manual'].includes(fallback.mode),
          onClick: () => resetPreviewInspectorRuntimeFallbackOverride(fallback.id),
        },
        'Reset manual value',
      ),
    ),
    React.createElement('div', { className: 'rpi-note' },
      'This value is preview-only. Generated or user-authored data is visibly marked and never sent to a backend.'),
  );
}

/**
 * Applies the minimum prop record and optionally defers the single refresh to a surrounding batch.
 * The non-draft path still advances the target input revision so retry semantics are preserved
 * without treating an automatic repair as the user's explicit component-remount command.
 */
function smartFillPreviewInspectorTargetFailure(failure, commit = true) {
  const draft = createPreviewInspectorSmartPropsDraft(
    failure.exportName,
    failure.targetPropRequiredPaths,
  );
  if (typeof recordPreviewInspectorBlockerAutoDecision === 'function') {
    recordPreviewInspectorBlockerAutoDecision({
      action: 'Smart fill target props and retry',
      blockerId: failure.id,
      blockerKind: 'target-error',
      blockerName: 'Component error · ' + failure.blockedComponentName,
      generatedPaths: draft.generatedPaths,
      mode: 'smart-props',
      occurrenceStart: failure.occurrenceStart,
      ownerName: failure.exportName,
      reason: failure.headline,
      selectedValue: draft.generatedValue,
      sourcePath: failure.sourcePath,
      startsRenderAttempt: true,
      summary: {
        preservedObservedOrUserProps:
          stringifyPreviewInspectorProps(draft.generatedValue) !==
          stringifyPreviewInspectorProps(draft.value),
        requiredPaths: failure.targetPropRequiredPaths,
      },
    });
  }
  if (!hasPreviewInspectorSmartPropsDraft(draft)) {
    setPreviewInspectorFallbackValuesEnabled(true, commit);
    if (commit) {
      refreshPreviewInspectorExport(failure.exportName);
    } else {
      const currentRevision =
        previewInspectorSession.propsRevisionByExport.get(failure.exportName) ?? 0;
      previewInspectorSession.propsRevisionByExport.set(failure.exportName, currentRevision + 1);
    }
    return true;
  }
  applyPreviewInspectorSmartProps(failure.exportName, failure.targetPropRequiredPaths, commit);
  return true;
}

/** Renders retry and inferred-value controls for a target-local contained React failure. */
function PreviewInspectorTargetFailureDetail({ node }) {
  const failure = node.blocker;
  const ownerNode = previewInspectorSession.descriptorNames.includes(failure.exportName) &&
    (previewInspectorSession.basePropsByExport.has(failure.exportName) ||
      hasPreviewInspectorSmartPropEvidence(failure.exportName))
    ? {
        exportName: failure.exportName,
        id: 'target-error-owner:' + failure.exportName,
        name: failure.exportName,
        props: previewInspectorSession.basePropsByExport.get(failure.exportName),
      }
    : undefined;
  return React.createElement(
    'div',
    { className: 'rpi-detail-content' },
    React.createElement('div', { className: 'rpi-error', role: 'alert' }, failure.headline),
    React.createElement('div', { className: 'rpi-note' },
      'Blocked component path: ' + [...failure.componentNames].reverse().join(' > ')),
    failure.requiredPaths.length > 0
      ? React.createElement('div', { className: 'rpi-note' },
          'Required properties: ' + failure.requiredPaths.join(', '))
      : undefined,
    React.createElement(
      'div',
      { className: 'rpi-actions' },
      React.createElement(
        PreviewInspectorDevtoolsButton,
        {
          onClick: () => smartFillPreviewInspectorTargetFailure(failure),
          title: 'Preserve observed props and add only error-proven missing property paths',
        },
        'Smart fill and retry',
      ),
      React.createElement(
        PreviewInspectorDevtoolsButton,
        { onClick: () => remountPreviewInspectorExport(failure.exportName) },
        'Retry',
      ),
    ),
    React.createElement('div', { className: 'rpi-note' },
      'If inferred values cannot cross this edge, select the highlighted owner export and edit its props, or inspect Console for the exact stack.'),
    ownerNode === undefined
      ? undefined
      : React.createElement(PreviewInspectorPropsDetail, {
          node: ownerNode,
          requiredPaths: failure.targetPropRequiredPaths,
        }),
  );
}

/** Explains a logical path blocker and exposes retry/direct-target recovery without hiding context. */
function PreviewInspectorTargetReachabilityDetail({ node }) {
  const blocker = node.blocker;
  const direct = blocker.directTarget === true;
  const pageCommitted = blocker.pageRootCommitted === true && !direct;
  const targetMounted = blocker.targetMounted === true;
  const targetHasOutput = blocker.targetHasOutput === true;
  const targetMountedWithoutOutput = targetMounted && !targetHasOutput;
  const deferredCallbackPending = targetMountedWithoutOutput &&
    blocker.targetDeferredCallbackPending === true;
  const wrapperHostOnly = targetMountedWithoutOutput && blocker.targetHasAnyHostOutput === true;
  const requiredPathSummary = summarizePreviewInspectorRequiredPaths(blocker.requiredPaths);
  const minimumSearch = blocker.minimumRequirementSearch;
  const resolving = blocker.status === 'settling-auto-attempt' || minimumSearch?.status === 'searching';
  const circuitOpen = ['cycle-detected', 'limit-reached'].includes(minimumSearch?.status);
  return React.createElement(
    'div',
    { className: 'rpi-detail-content' },
    React.createElement(
      'div',
      { className: 'rpi-error', role: 'alert' },
      circuitOpen
        ? minimumSearch.status === 'cycle-detected'
          ? 'Automatic resolution stopped because the same generated requirement state repeated.' +
            (targetMountedWithoutOutput
              ? deferredCallbackPending
                ? ' The selected target is mounted, but its receiver has not invoked the authored render callback.'
                : ' The selected target is mounted, but its authored JSX is still absent.'
              : '')
          : 'Automatic resolution stopped at its bounded pass limit.' +
            (targetMountedWithoutOutput
              ? deferredCallbackPending
                ? ' The selected target is mounted, but its receiver has not invoked the authored render callback.'
                : ' The selected target is mounted, but its authored JSX is still absent.'
              : '')
        : direct
          ? 'Target-only diagnostic mode is active; authored page context is not successful.'
          : pageCommitted
            ? targetMountedWithoutOutput
              ? deferredCallbackPending
                ? 'The selected target mounted, but its receiver has not invoked the authored render callback.'
                : wrapperHostOnly
                ? 'The selected target mounted and produced wrapper or fallback DOM, but its authored JSX subtree is absent.'
                : 'The selected target mounted in the authored page, but produced no host output.'
              : 'The authored page committed, but never mounted ' + blocker.targetExportName + '.'
            : 'The authored page root has not committed yet.',
    ),
    React.createElement('div', { className: 'rpi-note' },
      'Page root: ' + blocker.rootName + ' · ' + (pageCommitted ? 'committed' : 'not committed')),
    React.createElement('div', { className: 'rpi-note' },
      'Selected target: ' + blocker.targetExportName + ' · ' +
      (targetMountedWithoutOutput
        ? deferredCallbackPending
          ? 'mounted · render callback pending'
          : wrapperHostOnly
          ? 'mounted · wrapper/fallback host only · authored JSX absent'
          : 'mounted · no host output'
        : targetMounted
          ? 'mounted · host output connected'
          : 'not mounted')),
    React.createElement('div', { className: 'rpi-note' },
      'Application path: ' + blocker.applicationPath.join(' > ')),
    blocker.appliedConditions.length > 0
      ? React.createElement('div', { className: 'rpi-note' },
          'DFS pass gates: ' + blocker.appliedConditions
            .map((condition) => condition.expression + ' = ' + String(condition.enabled))
            .join(', '))
      : React.createElement('div', { className: 'rpi-note' },
          targetMountedWithoutOutput
            ? deferredCallbackPending
              ? 'The receiver must obtain its minimum payload before it can invoke the current file render callback.'
              : 'No target-local Boolean gate has been applied yet; a child render contract or payload may be the next requirement.'
            : 'No statically proven login/session/permission gate has been passed yet.'),
    requiredPathSummary.totalCount > 0
      ? React.createElement('div', { className: 'rpi-note' },
          'Payload properties discovered downstream (' +
          String(requiredPathSummary.totalCount) + '): ' +
          requiredPathSummary.visiblePaths.join(', ') +
          (requiredPathSummary.remainingCount > 0
            ? ' · +' + String(requiredPathSummary.remainingCount) + ' more'
            : ''))
      : React.createElement('div', { className: 'rpi-note' },
          'Downstream payload fields will appear here as each additional branch is reached.'),
    minimumSearch === undefined
      ? undefined
      : React.createElement('div', { className: 'rpi-note' },
          'Minimum requirement search: pass ' + String(minimumSearch.pass) + '/' +
          String(PREVIEW_INSPECTOR_MINIMUM_REQUIREMENT_PASS_LIMIT) + ' · ' +
          minimumSearch.status + ' · ' + String(minimumSearch.observedPathCount) +
          ' required path(s) observed.' +
          (minimumSearch.cycleLength > 0
            ? ' Repeated cycle length: ' + String(minimumSearch.cycleLength) + '.'
            : '')),
    React.createElement(
      'div',
      { className: 'rpi-actions' },
      React.createElement(
        PreviewInspectorDevtoolsButton,
        {
          disabled: resolving,
          onClick: () => smartFillPreviewInspectorTargetApplicationPath(blocker),
          title: 'Follow newly revealed hook and backend fields in bounded passes, fill their minimum shape, and retry the authored page',
        },
        resolving ? 'Resolving…' : 'Find minimum requirements',
      ),
      React.createElement(
        PreviewInspectorDevtoolsButton,
        {
          onClick: direct
            ? returnPreviewInspectorToPageContext
            : retryPreviewInspectorTargetApplicationPath,
        },
        direct ? 'Return to page context' : 'Retry page corridor',
      ),
      React.createElement(
        PreviewInspectorDevtoolsButton,
        {
          disabled: direct || blocker.directTargetAvailable !== true,
          onClick: showPreviewInspectorTargetDirectly,
        },
        'Target-only diagnostic',
      ),
    ),
    React.createElement('div', { className: 'rpi-note' },
      'Automatic values are preview-only. Explicit condition and payload edits still take precedence over DFS inference.'),
  );
}

/** Routes one selected tree blocker to its condition, payload, hook, or contained-error editor. */
function PreviewInspectorBlockerDetail({ node }) {
  let editor;
  if (isPreviewInspectorConditionNode(node)) {
    editor = React.createElement(PreviewInspectorConditionDetail, { node });
  } else if (node?.blockerKind === 'data-request') {
    editor = React.createElement(PreviewInspectorDataDetail, { requestId: node.blockerId });
  } else if (node?.blockerKind === 'runtime-fallback') {
    editor = React.createElement(PreviewInspectorRuntimeBlockerDetail, { node });
  } else if (node?.blockerKind === 'target-reachability') {
    editor = React.createElement(PreviewInspectorTargetReachabilityDetail, { node });
  } else if (node?.blockerKind === 'target-error') {
    editor = React.createElement(PreviewInspectorTargetFailureDetail, { node });
  } else {
    editor = React.createElement('div', { className: 'rpi-empty' },
      'No editable render control is available.');
  }
  return React.createElement(
    'div',
    { className: 'rpi-blocker-editor' },
    React.createElement(PreviewInspectorBlockerGuide, { node }),
    editor,
  );
}
`;
}
