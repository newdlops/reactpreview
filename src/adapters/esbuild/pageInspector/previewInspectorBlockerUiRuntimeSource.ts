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
/** Creates a common source object for compiler/runtime records retained by the local webview. */
function createPreviewInspectorBlockerSource(record) {
  return normalizePreviewInspectorUiSource({
    column: record?.column,
    displayName: record?.sourcePath,
    line: record?.line,
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
    name: 'Blocker · ' + fallback.hookName,
    props: {
      generatedPaths: fallback.generatedPaths,
      mode: fallback.mode,
      reason: fallback.reason,
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
    name: 'Data · ' + request.label,
    props: { evidence: request.evidence, mode: request.mode },
    source: createPreviewInspectorBlockerSource(request),
    state: { payload: request.payload },
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
      const identity = exportName + '\0' + headline;
      if (seen.has(identity) || failures.length >= 64) continue;
      seen.add(identity);
      const descriptor = previewInspectorSession.descriptors.find((item) =>
        Object.hasOwn(item?.inspector?.renderChainsByExport ?? {}, exportName) ||
        item?.inspector?.target?.exportName === exportName,
      );
      const reference = descriptor?.inspector?.renderChainsByExport?.[exportName]?.target ??
        descriptor?.inspector?.target;
      failures.push({
        error,
        exportName,
        headline,
        id: 'target-error:' + exportName + ':' + String(failures.length),
        sourcePath: reference?.sourcePath,
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
    name: 'Blocked render · ' + failure.exportName,
    ownerExportName: failure.exportName,
    props: { error: failure.headline },
    source: createPreviewInspectorBlockerSource(failure),
    state: undefined,
  };
}

/** Collects source-backed mounted components while excluding inert context and pseudo-node groups. */
function collectPreviewInspectorBlockerOwners(nodes, owners = [], depth = 0) {
  for (const node of nodes) {
    const sourcePath = normalizePreviewInspectorConditionSourcePath(node.source?.path);
    if (
      sourcePath.length > 0 &&
      node.contextOnly !== true &&
      node.kind !== 'condition' &&
      node.kind !== 'blocker'
    ) {
      owners.push({
        depth,
        exportName: node.exportName,
        id: node.id,
        line: Number.isSafeInteger(node.source?.line) ? node.source.line : 0,
        sourcePath,
      });
    }
    collectPreviewInspectorBlockerOwners(node.children, owners, depth + 1);
  }
  return owners;
}

/** Selects the deepest nearest same-file React owner for one blocker source location. */
function findPreviewInspectorBlockerOwner(record, owners) {
  const sourcePath = normalizePreviewInspectorConditionSourcePath(record?.sourcePath);
  if (sourcePath.length === 0) return undefined;
  const line = Number.isSafeInteger(record?.line) ? record.line : 0;
  let selected;
  let selectedScore = Number.POSITIVE_INFINITY;
  for (const owner of owners) {
    if (!matchesPreviewInspectorConditionSourcePath(owner.sourcePath, sourcePath)) continue;
    const precedes = owner.line <= line;
    const score = (precedes ? 0 : 1_000_000) + Math.abs(line - owner.line) - owner.depth / 1_000;
    if (score < selectedScore) {
      selected = owner;
      selectedScore = score;
    }
  }
  return selected;
}

/** Appends assigned blockers immutably so a cached Fiber snapshot remains collector-owned. */
function appendPreviewInspectorAssignedBlockers(nodes, assignments, targetFailures) {
  return nodes.map((node) => ({
    ...node,
    children: [
      ...appendPreviewInspectorAssignedBlockers(node.children, assignments, targetFailures),
      ...(assignments.get(node.id) ?? []),
      ...(typeof node.exportName === 'string'
        ? (targetFailures.get(node.exportName) ?? []).map(createPreviewInspectorTargetFailureTreeNode)
        : []),
    ],
  }));
}

/** Adds hook, data, and contained-error blockers after authored condition nodes are attached. */
function attachPreviewInspectorBlockersToSnapshot(snapshot) {
  const conditionedSnapshot = attachPreviewInspectorConditionsToSnapshot(snapshot);
  const owners = collectPreviewInspectorBlockerOwners(conditionedSnapshot.roots);
  const assignments = new Map();
  const unowned = [];
  const candidates = [
    ...readPreviewInspectorRuntimeFallbacks().map((record) => ({
      node: createPreviewInspectorRuntimeFallbackTreeNode(record),
      record,
    })),
    ...readPreviewInspectorDataRequests().map((record) => ({
      node: createPreviewInspectorDataBlockerTreeNode(record),
      record,
    })),
  ];
  for (const candidate of candidates) {
    const owner = findPreviewInspectorBlockerOwner(candidate.record, owners);
    if (owner === undefined) {
      unowned.push(candidate.node);
      continue;
    }
    const assigned = assignments.get(owner.id) ?? [];
    assigned.push(candidate.node);
    assignments.set(owner.id, assigned);
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
  if (unowned.length > 0) {
    roots.push({
      children: unowned,
      contextOnly: true,
      id: 'render-blockers:unowned',
      kind: 'component',
      name: 'Unlocated render blockers',
      props: undefined,
      source: undefined,
      state: undefined,
    });
  }
  return { ...conditionedSnapshot, roots };
}

/** Reports whether selection should open blocker controls instead of ordinary component props. */
function isPreviewInspectorBlockerNode(node) {
  return isPreviewInspectorConditionNode(node) ||
    (node?.kind === 'blocker' && typeof node.blockerKind === 'string');
}

/** Produces the compact status badge shown directly beside one blocker tree row. */
function formatPreviewInspectorBlockerBadge(node) {
  if (isPreviewInspectorConditionNode(node)) {
    return (node.condition?.effectiveEnabled === true ? 'condition · on' : 'condition · off') +
      (typeof node.condition?.override === 'boolean' ? ' · forced' : '');
  }
  if (node?.blockerKind === 'runtime-fallback') {
    return 'hook · ' + (node.blocker?.mode === 'manual' ? 'manual' : 'auto');
  }
  if (node?.blockerKind === 'data-request') return 'data · ' + String(node.blocker?.mode ?? 'seed');
  if (node?.blockerKind === 'target-error') return 'blocked';
  return 'blocker';
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
      fallback.hookName + ' · ' + (fallback.mode === 'manual' ? 'USER VALUE' : 'GENERATED · AUTO')),
    fallback.error ? React.createElement('div', { className: 'rpi-error' }, fallback.error) : undefined,
    React.createElement('div', { className: 'rpi-note' }, 'Evidence: ' + fallback.evidence),
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
      React.createElement(PreviewInspectorDevtoolsButton, { onClick: applyDraft }, 'Apply pass value'),
      React.createElement(
        PreviewInspectorDevtoolsButton,
        { onClick: () => autoPassPreviewInspectorRuntimeFallback(fallback.id), pressed: fallback.mode !== 'manual' },
        'Auto pass',
      ),
      React.createElement(
        PreviewInspectorDevtoolsButton,
        {
          disabled: fallback.mode !== 'manual',
          onClick: () => resetPreviewInspectorRuntimeFallbackOverride(fallback.id),
        },
        'Reset manual value',
      ),
    ),
    React.createElement('div', { className: 'rpi-note' },
      'This value is preview-only. Generated or user-authored data is visibly marked and never sent to a backend.'),
  );
}

/** Renders retry and inferred-value controls for a target-local contained React failure. */
function PreviewInspectorTargetFailureDetail({ node }) {
  const failure = node.blocker;
  const ownerNode = previewInspectorSession.basePropsByExport.has(failure.exportName)
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
    React.createElement(
      'div',
      { className: 'rpi-actions' },
      React.createElement(
        PreviewInspectorDevtoolsButton,
        {
          onClick: () => {
            setPreviewInspectorFallbackValuesEnabled(true);
            remountPreviewInspectorExport(failure.exportName);
          },
        },
        'Auto values and retry',
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
      : React.createElement(PreviewInspectorPropsDetail, { node: ownerNode }),
  );
}

/** Routes one selected tree blocker to its condition, payload, hook, or contained-error editor. */
function PreviewInspectorBlockerDetail({ node }) {
  if (isPreviewInspectorConditionNode(node)) {
    return React.createElement(PreviewInspectorConditionDetail, { node });
  }
  if (node?.blockerKind === 'data-request') {
    return React.createElement(PreviewInspectorDataDetail);
  }
  if (node?.blockerKind === 'runtime-fallback') {
    return React.createElement(PreviewInspectorRuntimeBlockerDetail, { node });
  }
  if (node?.blockerKind === 'target-error') {
    return React.createElement(PreviewInspectorTargetFailureDetail, { node });
  }
  return React.createElement('div', { className: 'rpi-empty' }, 'No editable blocker value is available.');
}
`;
}
