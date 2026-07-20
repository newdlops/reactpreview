/**
 * Generates the data-only JSX render-flow model used by React Page Inspector.
 *
 * A component tree answers "what mounted", while this model answers "how rendering reached it".
 * Every proven component on the workspace-root-to-current-file corridor is represented as a function
 * entry, followed by compiler-instrumented render logic, its selected return output, and the child
 * component calls produced by that return. The selected component's mounted descendants are included
 * with a bounded depth so the graph remains useful in very large applications.
 *
 * The model never executes project functions or edits arbitrary hook slots. Editable nodes are only
 * existing condition/blocker pseudo nodes whose runtime adapters already provide safe controls.
 */

/** Maximum function, logic, return, and child steps shown in one render-flow snapshot. */
export const PREVIEW_INSPECTOR_RENDER_FLOW_STEP_LIMIT = 128;

/** Maximum mounted descendant depth expanded after the selected current-file component. */
export const PREVIEW_INSPECTOR_RENDER_FLOW_OUTPUT_DEPTH_LIMIT = 4;

/**
 * Creates browser-side source for a bounded function-to-JSX render-flow DAG.
 *
 * Expected lexical bindings are `createPreviewInspectorBlockerFlow`, blocker/condition predicates,
 * the selected-export session, and the enriched component-tree helpers emitted before this module.
 * The returned model deliberately keeps the original blocker fields so existing progress and inline
 * resolution controls can consume it without a second source of truth.
 *
 * @returns Plain JavaScript source concatenated before the Inspector React components render.
 */
export function createPreviewInspectorRenderFlowUiRuntimeSource(): string {
  return String.raw`
const PREVIEW_INSPECTOR_RENDER_FLOW_STEP_LIMIT = ${PREVIEW_INSPECTOR_RENDER_FLOW_STEP_LIMIT};
const PREVIEW_INSPECTOR_RENDER_FLOW_OUTPUT_DEPTH_LIMIT =
  ${PREVIEW_INSPECTOR_RENDER_FLOW_OUTPUT_DEPTH_LIMIT};

/** Reports a component/context node that can participate in a function-to-child render path. */
function isPreviewInspectorRenderFlowComponent(node) {
  return node !== undefined &&
    node?.kind !== 'condition-group' &&
    !isPreviewInspectorBlockerNode(node) &&
    isPreviewInspectorComponentNode(node);
}

/** Converts the selected owner-id corridor into the corresponding outer-to-inner component nodes. */
function readPreviewInspectorRenderFlowTargetPath(nodes) {
  const ownerIds = readPreviewInspectorBlockerFlowTargetOwnerIds(nodes);
  if (!Array.isArray(ownerIds) || ownerIds.length === 0) return [];
  const path = [];
  let children = nodes;
  for (const id of ownerIds) {
    const node = (children ?? []).find((candidate) => candidate?.id === id);
    if (!isPreviewInspectorRenderFlowComponent(node)) break;
    path.push(node);
    children = node.children;
  }
  return path;
}

/** Reads a deterministic source order for controls evaluated during one component render. */
function readPreviewInspectorRenderFlowControlOrder(node, fallbackOrder) {
  const record = isPreviewInspectorConditionNode(node) ? node.condition : node?.blocker;
  const line = Number.isSafeInteger(record?.line)
    ? record.line
    : Number.isSafeInteger(node?.source?.line)
      ? node.source.line
      : Number.POSITIVE_INFINITY;
  const column = Number.isSafeInteger(record?.column)
    ? record.column
    : Number.isSafeInteger(node?.source?.column)
      ? node.source.column
      : Number.POSITIVE_INFINITY;
  return { column, fallbackOrder, line };
}

/** Collects direct authored logic plus retained runtime blockers owned by one component. */
function readPreviewInspectorRenderFlowControls(node, blockerFlow, ownerIds) {
  const controls = [];
  const seen = new Set();
  const append = (control, blockerStep, fallbackOrder) => {
    if (control === undefined || seen.has(control.id)) return;
    seen.add(control.id);
    controls.push({
      blockerStep,
      node: control,
      order: readPreviewInspectorRenderFlowControlOrder(control, fallbackOrder),
    });
  };
  for (const child of node?.children ?? []) {
    if (isPreviewInspectorBlockerNode(child)) {
      append(child, blockerFlow.stepById.get(child.id), controls.length);
    }
  }
  for (const blockerStep of blockerFlow.steps) {
    if (blockerStep.ownerIds?.at(-1) === node.id) {
      append(blockerStep.node, blockerStep, controls.length);
    }
  }
  return controls.sort((left, right) =>
    left.order.line - right.order.line ||
    left.order.column - right.order.column ||
    left.order.fallbackOrder - right.order.fallbackOrder ||
    left.node.id.localeCompare(right.node.id),
  );
}

/** Describes the branch/output currently selected by a compiler-instrumented condition. */
function readPreviewInspectorRenderFlowConditionOutput(node) {
  const condition = node?.condition;
  if (condition === undefined) return undefined;
  return condition.effectiveEnabled === true ? condition.truthyLabel : condition.falsyLabel;
}

/** Produces a compact selected-return label without claiming knowledge absent from runtime evidence. */
function describePreviewInspectorRenderFlowReturn(node, controls, childNodes) {
  const branches = controls
    .map((control) => readPreviewInspectorRenderFlowConditionOutput(control.node))
    .filter((label) => typeof label === 'string' && label.length > 0)
    .slice(0, 3);
  const children = childNodes
    .map((child) => child?.name)
    .filter((name) => typeof name === 'string' && name.length > 0)
    .slice(0, 3)
    .map((name) => '<' + name + '>');
  const outputs = [...new Set(branches.length > 0 ? branches : children)];
  return outputs.length > 0
    ? 'return · ' + outputs.join(' + ')
    : 'return · host JSX / null';
}

/** Adds one step unless the bounded graph is full, returning whether insertion succeeded. */
function appendPreviewInspectorRenderFlowStep(state, step) {
  if (state.steps.length >= PREVIEW_INSPECTOR_RENDER_FLOW_STEP_LIMIT) {
    state.truncated = true;
    return false;
  }
  state.steps.push(step);
  state.stepById.set(step.id, step);
  return true;
}

/** Maps an existing blocker-flow step to a render-time logic node without changing its resolution. */
function createPreviewInspectorRenderFlowControlStep(control, owner, ownerIds, ownerNames, level) {
  const blockerStep = control.blockerStep;
  const node = control.node;
  const branch = readPreviewInspectorRenderFlowConditionOutput(node);
  return {
    ...(blockerStep ?? {}),
    current: blockerStep?.current ?? true,
    detail: isPreviewInspectorConditionNode(node)
      ? String(node.condition?.kind ?? 'conditional JSX') +
        (branch === undefined ? '' : ' · selected ' + branch)
      : 'Runtime requirement evaluated while ' + owner.name + ' renders',
    editable: blockerStep?.current ?? true,
    flowKind: 'render-logic',
    id: node.id,
    kind: isPreviewInspectorConditionNode(node) ? 'condition' : 'blocker',
    label: node.name,
    level,
    node,
    ownerIds: blockerStep?.ownerIds ?? ownerIds,
    ownerNames: blockerStep?.ownerNames ?? ownerNames,
    predecessorIds: [],
    resolution: blockerStep?.resolution ?? 'resolved',
    status: blockerStep?.status ?? 'resolved',
  };
}

/** Creates one read-only function-entry or selected-return context step. */
function createPreviewInspectorRenderFlowContextStep({
  detail,
  id,
  kind,
  label,
  level,
  node,
  ownerIds,
  ownerNames,
  predecessorIds,
}) {
  return {
    current: true,
    detail,
    editable: false,
    flowKind: 'component-context',
    id,
    kind,
    label,
    level,
    node,
    ownerIds,
    ownerNames,
    predecessorIds,
    resolution: 'resolved',
    status: 'context',
  };
}

/** Returns direct rendered child components, excluding condition/blocker pseudo nodes. */
function readPreviewInspectorRenderFlowChildComponents(node) {
  return (node?.children ?? []).filter(isPreviewInspectorRenderFlowComponent);
}

/** Reads the authored source identity retained by a condition or runtime blocker pseudo node. */
function readPreviewInspectorRenderFlowBlockerSourcePath(node) {
  const record = isPreviewInspectorConditionNode(node) ? node.condition : node?.blocker;
  return normalizePreviewInspectorConditionSourcePath(
    record?.sourcePath ?? node?.source?.path,
  );
}

/**
 * Proves that an unresolved graph step is owned directly by the mounted selected-file component.
 * Exact owner and matching source identities are mandatory, so a fallback assignment, unmounted
 * inventory entry, imported child, or target-reachability gate cannot receive the direct badge.
 */
function isPreviewInspectorDirectCurrentFileBlocker(step, targetNode, blockerFlow) {
  const selectedExportName = previewInspectorSession.selectedExportName;
  const selectedTarget = targetNode?.currentFileExport === true &&
    targetNode.mounted !== false &&
    targetNode.contextOnly !== true &&
    (targetNode.exportName === selectedExportName || targetNode.name === selectedExportName);
  if (
    !selectedTarget ||
    step?.flowKind !== 'render-logic' ||
    step.current !== true ||
    step.resolution === 'resolved' ||
    !blockerFlow.stepById.has(step.id) ||
    step.ownerIds?.at(-1) !== targetNode.id ||
    step.node?.blockerKind === 'target-reachability'
  ) {
    return false;
  }
  const targetSourcePath = normalizePreviewInspectorConditionSourcePath(targetNode.source?.path);
  const blockerSourcePath = readPreviewInspectorRenderFlowBlockerSourcePath(step.node);
  return targetSourcePath.length > 0 &&
    blockerSourcePath.length > 0 &&
    matchesPreviewInspectorConditionSourcePath(targetSourcePath, blockerSourcePath);
}

/**
 * Appends one component function, its parallel render-time logic, selected return, and descendants.
 * Upstream corridor owners follow only the proven next owner; once the current file is reached, its
 * mounted output subtree is expanded in parallel with a strict depth and total-step bound.
 */
function appendPreviewInspectorRenderFlowComponent({
  blockerFlow,
  corridorTail,
  depth,
  node,
  ownerIds,
  ownerNames,
  predecessorIds,
  state,
}) {
  if (!isPreviewInspectorRenderFlowComponent(node)) return;
  const nextOwnerIds = [...ownerIds, node.id];
  const nextOwnerNames = [...ownerNames, node.name];
  const entryId = 'render-entry:' + node.id;
  const entryLevel = predecessorIds.reduce(
    (maximum, id) => Math.max(maximum, (state.stepById.get(id)?.level ?? -1) + 1),
    0,
  );
  const entry = createPreviewInspectorRenderFlowContextStep({
    detail: node.contextOnly === true
      ? 'Static entry / wrapper / route evidence; project code was not invoked here'
      : node.name + ' function render begins',
    id: entryId,
    kind: 'component',
    label: node.name,
    level: entryLevel,
    node,
    ownerIds: nextOwnerIds,
    ownerNames: nextOwnerNames,
    predecessorIds,
  });
  if (!appendPreviewInspectorRenderFlowStep(state, entry)) return;
  const controls = readPreviewInspectorRenderFlowControls(node, blockerFlow, nextOwnerIds);
  const controlIds = [];
  for (const control of controls) {
    const step = createPreviewInspectorRenderFlowControlStep(
      control,
      node,
      nextOwnerIds,
      nextOwnerNames,
      entryLevel + 1,
    );
    step.predecessorIds = [entryId];
    if (appendPreviewInspectorRenderFlowStep(state, step)) controlIds.push(step.id);
  }
  const followChild = corridorTail[0];
  const childNodes = followChild === undefined
    ? readPreviewInspectorRenderFlowChildComponents(node)
    : [followChild];
  if (node.contextOnly === true) {
    const contextPredecessors = controlIds.length > 0 ? controlIds : [entryId];
    const nextDepth = followChild === undefined ? depth + 1 : depth;
    if (
      followChild === undefined &&
      depth >= PREVIEW_INSPECTOR_RENDER_FLOW_OUTPUT_DEPTH_LIMIT
    ) {
      if (childNodes.length > 0) state.truncated = true;
      return;
    }
    for (const child of childNodes) {
      appendPreviewInspectorRenderFlowComponent({
        blockerFlow,
        corridorTail: followChild === undefined ? [] : corridorTail.slice(1),
        depth: nextDepth,
        node: child,
        ownerIds: nextOwnerIds,
        ownerNames: nextOwnerNames,
        predecessorIds: contextPredecessors,
        state,
      });
    }
    return;
  }
  const returnId = 'render-return:' + node.id;
  const returnStep = createPreviewInspectorRenderFlowContextStep({
    detail: 'Selected output after ' + String(controls.length) + ' observed render decision(s)',
    id: returnId,
    kind: 'return',
    label: describePreviewInspectorRenderFlowReturn(node, controls, childNodes),
    level: entryLevel + (controlIds.length > 0 ? 2 : 1),
    node,
    ownerIds: nextOwnerIds,
    ownerNames: nextOwnerNames,
    predecessorIds: controlIds.length > 0 ? controlIds : [entryId],
  });
  if (!appendPreviewInspectorRenderFlowStep(state, returnStep)) return;
  if (followChild !== undefined) {
    appendPreviewInspectorRenderFlowComponent({
      blockerFlow,
      corridorTail: corridorTail.slice(1),
      depth,
      node: followChild,
      ownerIds: nextOwnerIds,
      ownerNames: nextOwnerNames,
      predecessorIds: [returnId],
      state,
    });
    return;
  }
  if (depth >= PREVIEW_INSPECTOR_RENDER_FLOW_OUTPUT_DEPTH_LIMIT) {
    if (childNodes.length > 0) state.truncated = true;
    return;
  }
  for (const child of childNodes) {
    appendPreviewInspectorRenderFlowComponent({
      blockerFlow,
      corridorTail: [],
      depth: depth + 1,
      node: child,
      ownerIds: nextOwnerIds,
      ownerNames: nextOwnerNames,
      predecessorIds: [returnId],
      state,
    });
  }
}

/**
 * Joins the actionable blocker DAG with the explanatory JSX function/return DAG.
 * Blocker progress remains sourced exclusively from createPreviewInspectorBlockerFlow; the richer
 * renderSteps collection is a view model and therefore cannot silently change resolution state.
 */
function createPreviewInspectorRenderFlow(snapshot) {
  const blockerFlow = createPreviewInspectorBlockerFlow(snapshot);
  const targetPath = readPreviewInspectorRenderFlowTargetPath(snapshot?.roots);
  const state = { stepById: new Map(), steps: [], truncated: false };
  if (targetPath.length > 0) {
    appendPreviewInspectorRenderFlowComponent({
      blockerFlow,
      corridorTail: targetPath.slice(1),
      depth: 0,
      node: targetPath[0],
      ownerIds: [],
      ownerNames: [],
      predecessorIds: [],
      state,
    });
  }
  for (const blockerStep of blockerFlow.steps) {
    // Progress records from an older/synthetic adapter may omit their pseudo tree node. They remain
    // counted by blockerFlow but cannot safely become an editable Render-flow card without identity.
    if (blockerStep?.node === undefined || state.stepById.has(blockerStep.id)) continue;
    const ownerId = [...(blockerStep.ownerIds ?? [])]
      .reverse()
      .find((id) => state.stepById.has('render-entry:' + id));
    const predecessorId = ownerId === undefined ? undefined : 'render-entry:' + ownerId;
    const predecessorIds = predecessorId === undefined ? [] : [predecessorId];
    const level = predecessorIds.reduce(
      (maximum, id) => Math.max(maximum, (state.stepById.get(id)?.level ?? -1) + 1),
      0,
    );
    const step = createPreviewInspectorRenderFlowControlStep(
      { blockerStep, node: blockerStep.node },
      { name: blockerStep.ownerNames?.at(-1) ?? 'Page render root' },
      blockerStep.ownerIds ?? [],
      blockerStep.ownerNames ?? [],
      level,
    );
    step.predecessorIds = predecessorIds;
    appendPreviewInspectorRenderFlowStep(state, step);
  }
  const currentFileTarget = [...targetPath].reverse().find(
    (node) => node.currentFileExport === true,
  );
  let directCurrentFileBlockerCount = 0;
  for (const step of state.steps) {
    if (!isPreviewInspectorDirectCurrentFileBlocker(step, currentFileTarget, blockerFlow)) continue;
    step.directCurrentFileBlocker = true;
    directCurrentFileBlockerCount += 1;
  }
  const renderStages = state.steps.length === 0
    ? 0
    : Math.max(...state.steps.map((step) => step.level)) + 1;
  const renderFingerprint = state.steps.map((step) =>
    step.id + ':' + step.status + ':' + String(step.node?.condition?.effectiveEnabled),
  ).join('|');
  return {
    ...blockerFlow,
    directCurrentFileBlockerCount,
    fingerprint: blockerFlow.fingerprint + '::render:' + renderFingerprint,
    renderStages,
    renderStepById: state.stepById,
    renderSteps: state.steps,
    renderTruncated: state.truncated,
    targetPathIds: targetPath.map((node) => node.id),
  };
}
`;
}
