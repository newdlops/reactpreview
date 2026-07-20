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

/** Reports either a boolean condition or a multi-way switch render choice. */
function isPreviewInspectorRenderFlowDecisionNode(node) {
  return isPreviewInspectorConditionNode(node) || isPreviewInspectorRenderChoiceNode(node);
}

/** Reads the compiler-issued decision record without conflating choices with blocker state. */
function readPreviewInspectorRenderFlowDecision(node) {
  return isPreviewInspectorRenderChoiceNode(node) ? node.choice : node?.condition;
}

/** Reports a component/context node that can participate in a function-to-child render path. */
function isPreviewInspectorRenderFlowComponent(node) {
  return node !== undefined &&
    node?.kind !== 'condition-group' &&
    !isPreviewInspectorRenderFlowDecisionNode(node) &&
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

/** Reads the selected export's immutable current-file reference from the compiled render graph. */
function readPreviewInspectorRenderFlowCurrentFileReference() {
  const descriptor = findSelectedPreviewInspectorDescriptor();
  const inspector = descriptor?.inspector;
  const exportName = previewInspectorSession.selectedExportName;
  if (inspector === undefined || typeof exportName !== 'string' || exportName.length === 0) {
    return undefined;
  }
  const selectedChainTarget = inspector.renderChainsByExport?.[exportName]?.target;
  const primaryTarget = inspector.target?.exportName === exportName ? inspector.target : undefined;
  const target = selectedChainTarget ?? primaryTarget;
  const sourcePath = normalizePreviewInspectorConditionSourcePath(target?.sourcePath);
  return target?.exportName === exportName && sourcePath.length > 0
    ? { exportName, sourcePath }
    : undefined;
}

/**
 * Proves the one mounted tree boundary that represents the selected export from the current file.
 * Export names alone are insufficient in monorepos, while source evidence alone can identify an
 * imported sibling. The compiler marker, selected export, exact source, and mounted state must agree.
 */
function isPreviewInspectorExactCurrentFileTargetNode(node, reference) {
  if (
    reference === undefined ||
    node?.currentFileExport !== true ||
    node?.mounted !== true ||
    node?.contextOnly === true ||
    node?.exportName !== reference.exportName
  ) {
    return false;
  }
  const nodeSourcePath = normalizePreviewInspectorConditionSourcePath(node?.source?.path);
  return nodeSourcePath.length > 0 &&
    matchesPreviewInspectorConditionSourcePath(nodeSourcePath, reference.sourcePath);
}

/** Reads a deterministic source order for controls evaluated during one component render. */
function readPreviewInspectorRenderFlowControlOrder(node, fallbackOrder) {
  const record = isPreviewInspectorRenderFlowDecisionNode(node)
    ? readPreviewInspectorRenderFlowDecision(node)
    : node?.blocker;
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
    if (isPreviewInspectorBlockerNode(child) || isPreviewInspectorRenderChoiceNode(child)) {
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
  const condition = readPreviewInspectorRenderFlowDecision(node);
  if (condition === undefined) return undefined;
  if (condition.kind === 'switch') {
    return condition.branches?.find(
      (branch) => branch.id === condition.effectiveBranchId,
    )?.label;
  }
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
  if (state.stepById.has(step.id)) return true;
  const protectedStep = state.protectedStepIds.has(step.id);
  const reservedCount = state.pendingProtectedStepIds.size;
  if (
    state.steps.length >= PREVIEW_INSPECTOR_RENDER_FLOW_STEP_LIMIT ||
    (!protectedStep &&
      state.steps.length >= PREVIEW_INSPECTOR_RENDER_FLOW_STEP_LIMIT - reservedCount)
  ) {
    state.truncated = true;
    return false;
  }
  state.steps.push(step);
  state.stepById.set(step.id, step);
  if (protectedStep) state.pendingProtectedStepIds.delete(step.id);
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
    detail: isPreviewInspectorRenderFlowDecisionNode(node)
      ? String(readPreviewInspectorRenderFlowDecision(node)?.kind ?? 'conditional JSX') +
        (branch === undefined ? '' : ' · selected ' + branch)
      : 'Runtime requirement evaluated while ' + owner.name + ' renders',
    editable: blockerStep?.current ?? true,
    flowKind: 'render-logic',
    graphKind: isPreviewInspectorRenderFlowDecisionNode(node) ? 'decision' : 'blocker',
    id: node.id,
    kind: isPreviewInspectorRenderFlowDecisionNode(node) ? 'condition' : 'blocker',
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
  flowKind,
  graphKind,
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
    flowKind: flowKind ?? 'component-context',
    graphKind: graphKind ?? 'component',
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
  const record = isPreviewInspectorRenderFlowDecisionNode(node)
    ? readPreviewInspectorRenderFlowDecision(node)
    : node?.blocker;
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

/** Maps static render-chain transport metadata to a debugger node shape. */
function readPreviewInspectorRenderFlowComponentGraphKind(node, predecessorIds) {
  const mode = node?.invocation?.mode ?? node?.edgeKind;
  if (['hoc', 'higher-order-component', 'memo', 'forward-ref', 'styled'].includes(mode)) {
    return 'hoc';
  }
  if (['component-prop', 'component-slot', 'polymorphic-prop', 'render-prop'].includes(mode)) {
    return 'component-slot';
  }
  return predecessorIds.length === 0 ? 'entry' : 'component';
}

/** Extracts bounded component-call labels from explicit metadata or a legacy branch label. */
function readPreviewInspectorRenderFlowBranchCalls(branch, fallbackLabel) {
  const calls = [];
  for (const candidate of branch?.calls ?? []) {
    const name = typeof candidate === 'string' ? candidate : candidate?.name;
    if (typeof name !== 'string' || name.length === 0 || calls.length >= 8) continue;
    calls.push({
      mode: typeof candidate?.mode === 'string' ? candidate.mode : 'jsx',
      name: name.slice(0, 160),
      slotName: typeof candidate?.slotName === 'string' ? candidate.slotName.slice(0, 80) : undefined,
    });
  }
  if (calls.length > 0 || typeof fallbackLabel !== 'string') return calls;
  if (/^(?:continue|empty|hidden|early return)/iu.test(fallbackLabel.trim())) return calls;
  const fragment = fallbackLabel.match(/<Fragment:\s*([^>]+)>/u)?.[1];
  const names = fragment === undefined
    ? [...fallbackLabel.matchAll(/<([$_\p{Lu}][\w$]*(?:\.[\w$]+)*)/gu)].map((match) => match[1])
    : fragment.split(',').map((name) => name.trim());
  for (const name of names) {
    if (typeof name !== 'string' || name.length === 0 || calls.length >= 8) continue;
    calls.push({ mode: 'jsx', name: name.slice(0, 160), slotName: undefined });
  }
  return calls;
}

/** Normalizes boolean and switch choices into the same explicit branch-arm contract. */
function readPreviewInspectorRenderFlowBranches(node) {
  const condition = readPreviewInspectorRenderFlowDecision(node);
  if (condition?.kind === 'switch' && Array.isArray(condition.branches)) {
    return condition.branches.slice(0, 16).map((branch, index) => ({
      active: branch.id === condition.effectiveBranchId,
      calls: readPreviewInspectorRenderFlowBranchCalls(branch, branch.label),
      continues: branch.terminal !== true,
      default: branch.default === true,
      id: typeof branch.id === 'string' ? branch.id : 'case-' + String(index),
      label: typeof branch.label === 'string' ? branch.label : 'case ' + String(index + 1),
      terminal: branch.terminal === true,
    }));
  }
  if (condition === undefined) return [];
  const effectiveTruthy = condition.effectiveEnabled === true;
  const targetBranch = condition.targetBranch;
  return [
    {
      active: effectiveTruthy,
      calls: readPreviewInspectorRenderFlowBranchCalls(
        { calls: condition.truthyCalls },
        condition.truthyLabel,
      ),
      continues: targetBranch === undefined || targetBranch === 'truthy',
      id: 'truthy',
      label: condition.truthyLabel ?? 'true',
      terminal: targetBranch === 'falsy',
    },
    {
      active: !effectiveTruthy,
      calls: readPreviewInspectorRenderFlowBranchCalls(
        { calls: condition.falsyCalls },
        condition.falsyLabel,
      ),
      continues: targetBranch === undefined || targetBranch === 'falsy',
      id: 'falsy',
      label: condition.falsyLabel ?? 'false',
      terminal: targetBranch === 'truthy',
    },
  ];
}

/** Chooses the distinct graph shape used for one statically described component invocation. */
function readPreviewInspectorRenderFlowCallGraphKind(call) {
  if (['hoc', 'memo', 'forward-ref', 'styled'].includes(call?.mode)) return 'hoc';
  if (['component-prop', 'polymorphic-prop', 'render-prop'].includes(call?.mode)) {
    return 'component-slot';
  }
  return 'component';
}

/** Appends explicit branch arms, their component outputs, and one stable convergence node. */
function appendPreviewInspectorRenderFlowDecisionBranches({
  controlStep,
  level,
  owner,
  ownerIds,
  ownerNames,
  state,
}) {
  const branches = readPreviewInspectorRenderFlowBranches(controlStep.node);
  const continuing = [];
  for (const [branchIndex, branch] of branches.entries()) {
    const branchId = 'render-branch:' + controlStep.id + ':' + branch.id;
    const branchStep = createPreviewInspectorRenderFlowContextStep({
      detail: (branch.active ? 'Selected ' : 'Dormant ') +
        (readPreviewInspectorRenderFlowDecision(controlStep.node)?.kind === 'switch'
          ? 'case'
          : 'branch'),
      flowKind: 'branch-outcome',
      graphKind: 'branch',
      id: branchId,
      kind: 'branch',
      label: branch.label,
      level,
      node: controlStep.node,
      ownerIds,
      ownerNames,
      predecessorIds: [controlStep.id],
    });
    if (controlStep.currentFileContext === true) branchStep.currentFileContext = true;
    branchStep.branchLabel = branch.id;
    branchStep.branchState = branch.active ? 'active' : 'inactive';
    branchStep.incomingEdges = [{
      active: branch.active,
      fromId: controlStep.id,
      kind: readPreviewInspectorRenderFlowDecision(controlStep.node)?.kind === 'switch'
        ? branch.default === true ? 'default' : 'case'
        : branch.id,
      label: readPreviewInspectorRenderFlowDecision(controlStep.node)?.kind === 'switch'
        ? branch.label
        : branch.id === 'truthy' ? 'TRUE' : 'FALSE',
    }];
    if (!appendPreviewInspectorRenderFlowStep(state, branchStep)) continue;
    const outputIds = [];
    for (const [callIndex, call] of branch.calls.entries()) {
      const callId = branchId + ':call:' + String(callIndex);
      const callStep = createPreviewInspectorRenderFlowContextStep({
        detail: call.slotName === undefined
          ? 'Branch renders <' + call.name + '>'
          : 'Passed through prop ' + call.slotName + ' to render <' + call.name + '>',
        flowKind: 'component-call',
        graphKind: readPreviewInspectorRenderFlowCallGraphKind(call),
        id: callId,
        kind: 'component',
        label: call.name,
        level: level + 1,
        node: controlStep.node,
        ownerIds,
        ownerNames,
        predecessorIds: [branchId],
      });
      if (controlStep.currentFileContext === true) callStep.currentFileContext = true;
      callStep.branchState = branch.active ? 'active' : 'inactive';
      callStep.invocation = call;
      callStep.incomingEdges = [{
        active: branch.active,
        fromId: branchId,
        kind: call.mode === 'component-prop' ? 'component-prop' :
          call.mode === 'render-prop' ? 'render-prop' : 'renders',
        label: call.slotName,
      }];
      if (appendPreviewInspectorRenderFlowStep(state, callStep)) outputIds.push(callId);
    }
    if (branch.continues) {
      const ids = outputIds.length > 0 ? outputIds : [branchId];
      continuing.push(...ids.map((id) => ({ active: branch.active, id })));
    }
    if (branchIndex >= 15) state.truncated = true;
  }
  const joinInputs = continuing.length > 0
    ? continuing
    : branches.map((branch) => ({
        active: branch.active,
        id: 'render-branch:' + controlStep.id + ':' + branch.id,
      })).filter((entry) => state.stepById.has(entry.id));
  if (joinInputs.length === 0) return { level, predecessorIds: [controlStep.id] };
  const joinId = 'render-join:' + controlStep.id;
  const joinStep = createPreviewInspectorRenderFlowContextStep({
    detail: 'Control flow rejoins after ' + String(branches.length) + ' branch outcome(s)',
    flowKind: 'flow-join',
    graphKind: 'join',
    id: joinId,
    kind: 'join',
    label: 'join',
    level: level + 2,
    node: owner,
    ownerIds,
    ownerNames,
    predecessorIds: joinInputs.map((entry) => entry.id),
  });
  if (controlStep.currentFileContext === true) joinStep.currentFileContext = true;
  joinStep.incomingEdges = joinInputs.map((entry) => ({
    active: entry.active,
    fromId: entry.id,
    kind: 'join',
    label: 'join',
  }));
  return appendPreviewInspectorRenderFlowStep(state, joinStep)
    ? { level: level + 3, predecessorIds: [joinId] }
    : { level: level + 2, predecessorIds: joinInputs.map((entry) => entry.id) };
}

/** Converts predecessor compatibility fields into explicit labeled graph edges. */
function createPreviewInspectorRenderFlowEdges(steps) {
  const edges = [];
  for (const step of steps) {
    for (const [index, fromId] of step.predecessorIds.entries()) {
      const incoming = step.incomingEdges?.find((edge) => edge.fromId === fromId);
      edges.push({
        active: incoming?.active !== false,
        certainty: step.node?.certainty ?? 'confirmed',
        fromId,
        id: fromId + '->' + step.id + ':' + String(index),
        kind: incoming?.kind ?? (step.graphKind === 'component' ? 'renders' : 'next'),
        label: incoming?.label,
        toId: step.id,
      });
    }
  }
  return edges;
}

/**
 * Reserves graph capacity for the exact target and actionable blockers before explanatory branches.
 * The strict direct-blocker predicate is reused unchanged, so reservation cannot broaden which
 * source/owner records receive current-file blocker semantics.
 */
function readPreviewInspectorProtectedRenderFlowStepIds(
  blockerFlow,
  currentFileTarget,
  exactCurrentFileTarget,
) {
  const protectedIds = new Set();
  if (typeof exactCurrentFileTarget?.id === 'string') {
    protectedIds.add('render-entry:' + exactCurrentFileTarget.id);
  }
  if (typeof blockerFlow.activeStepId === 'string') protectedIds.add(blockerFlow.activeStepId);
  for (const blockerStep of blockerFlow.steps) {
    const candidate = { ...blockerStep, flowKind: 'render-logic' };
    if (isPreviewInspectorDirectCurrentFileBlocker(candidate, currentFileTarget, blockerFlow)) {
      protectedIds.add(blockerStep.id);
    }
  }
  return protectedIds;
}

/** Reads only bounded graph fields whose change must invalidate the memoized flowchart layout. */
function createPreviewInspectorRenderFlowFingerprint(steps, edges) {
  const nodes = steps.map((step) => {
    const decision = readPreviewInspectorRenderFlowDecision(step.node);
    const source = step.node?.source;
    const invocation = step.invocation ?? step.node?.invocation;
    return [
      step.id,
      step.label,
      step.graphKind,
      step.flowKind,
      step.rank ?? step.level,
      step.status,
      step.branchLabel,
      step.branchState,
      step.currentFileContext === true,
      step.currentFileTarget === true,
      step.directCurrentFileBlocker === true,
      source?.path,
      source?.line,
      source?.column,
      readPreviewInspectorRenderFlowBlockerSourcePath(step.node),
      decision?.effectiveBranchId ?? decision?.effectiveEnabled,
      invocation?.mode,
      invocation?.calleeName,
      invocation?.slotName,
      invocation?.sourcePath,
      [...(invocation?.factoryNames ?? [])].slice(0, 8),
      [...(step.predecessorIds ?? [])],
    ];
  });
  const graphEdges = edges.map((edge) => [
    edge.id,
    edge.fromId,
    edge.toId,
    edge.kind,
    edge.label,
    edge.active,
    edge.certainty,
  ]);
  return JSON.stringify([nodes, graphEdges]);
}

/**
 * Appends one component function, ordered decisions, explicit branch arms, return, and descendants.
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
  const currentFileContext = node.id === state.exactCurrentFileTargetNodeId;
  const entryLevel = predecessorIds.reduce(
    (maximum, id) => Math.max(maximum, (state.stepById.get(id)?.level ?? -1) + 1),
    0,
  );
  const entry = createPreviewInspectorRenderFlowContextStep({
    detail: node.contextOnly === true
      ? 'Static entry / wrapper / route evidence; project code was not invoked here'
      : node.name + ' function render begins',
    graphKind: readPreviewInspectorRenderFlowComponentGraphKind(node, predecessorIds),
    id: entryId,
    kind: 'component',
    label: node.name,
    level: entryLevel,
    node,
    ownerIds: nextOwnerIds,
    ownerNames: nextOwnerNames,
    predecessorIds,
  });
  if (currentFileContext) {
    entry.currentFileContext = true;
    entry.currentFileTarget = true;
  }
  entry.incomingEdges = predecessorIds.map((fromId) => ({
    active: true,
    fromId,
    kind: node?.invocation?.mode ?? node?.edgeKind ?? 'renders',
    label: node?.invocation?.slotName,
  }));
  const entryAppended = appendPreviewInspectorRenderFlowStep(state, entry);
  const controls = readPreviewInspectorRenderFlowControls(node, blockerFlow, nextOwnerIds);
  let controlLevel = entryLevel + 1;
  let controlPredecessorIds = entryAppended ? [entryId] : predecessorIds;
  for (const control of controls) {
    const step = createPreviewInspectorRenderFlowControlStep(
      control,
      node,
      nextOwnerIds,
      nextOwnerNames,
      controlLevel,
    );
    step.predecessorIds = controlPredecessorIds;
    if (currentFileContext) step.currentFileContext = true;
    if (!appendPreviewInspectorRenderFlowStep(state, step)) continue;
    if (isPreviewInspectorRenderFlowDecisionNode(step.node)) {
      const branchFlow = appendPreviewInspectorRenderFlowDecisionBranches({
        controlStep: step,
        level: controlLevel + 1,
        owner: node,
        ownerIds: nextOwnerIds,
        ownerNames: nextOwnerNames,
        state,
      });
      controlLevel = branchFlow.level;
      controlPredecessorIds = branchFlow.predecessorIds;
    } else {
      controlLevel += 1;
      controlPredecessorIds = [step.id];
    }
  }
  const followChild = corridorTail[0];
  const childNodes = followChild === undefined
    ? readPreviewInspectorRenderFlowChildComponents(node)
    : [followChild];
  if (node.contextOnly === true) {
    const contextPredecessors = controlPredecessorIds;
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
    flowKind: 'render-return',
    graphKind: 'return',
    id: returnId,
    kind: 'return',
    label: describePreviewInspectorRenderFlowReturn(node, controls, childNodes),
    level: controlLevel,
    node,
    ownerIds: nextOwnerIds,
    ownerNames: nextOwnerNames,
    predecessorIds: controlPredecessorIds,
  });
  if (currentFileContext) returnStep.currentFileContext = true;
  const returnAppended = appendPreviewInspectorRenderFlowStep(state, returnStep);
  const childPredecessorIds = returnAppended ? [returnId] : controlPredecessorIds;
  if (followChild !== undefined) {
    appendPreviewInspectorRenderFlowComponent({
      blockerFlow,
      corridorTail: corridorTail.slice(1),
      depth,
      node: followChild,
      ownerIds: nextOwnerIds,
      ownerNames: nextOwnerNames,
      predecessorIds: childPredecessorIds,
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
      predecessorIds: childPredecessorIds,
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
  const currentFileReference = readPreviewInspectorRenderFlowCurrentFileReference();
  const currentFileTarget = [...targetPath].reverse().find(
    (node) => node.currentFileExport === true,
  );
  const exactCurrentFileTarget = [...targetPath].reverse().find(
    (node) => isPreviewInspectorExactCurrentFileTargetNode(node, currentFileReference),
  );
  const protectedStepIds = readPreviewInspectorProtectedRenderFlowStepIds(
    blockerFlow,
    currentFileTarget,
    exactCurrentFileTarget,
  );
  const state = {
    exactCurrentFileTargetNodeId: exactCurrentFileTarget?.id,
    pendingProtectedStepIds: new Set(protectedStepIds),
    protectedStepIds,
    stepById: new Map(),
    steps: [],
    truncated: false,
  };
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
  let directCurrentFileBlockerCount = 0;
  for (const step of state.steps) {
    step.rank = step.level;
    if (!isPreviewInspectorDirectCurrentFileBlocker(step, currentFileTarget, blockerFlow)) continue;
    step.directCurrentFileBlocker = true;
    directCurrentFileBlockerCount += 1;
  }
  const renderStages = state.steps.length === 0
    ? 0
    : Math.max(...state.steps.map((step) => step.level)) + 1;
  const graphEdges = createPreviewInspectorRenderFlowEdges(state.steps);
  const renderFingerprint = createPreviewInspectorRenderFlowFingerprint(state.steps, graphEdges);
  return {
    ...blockerFlow,
    directCurrentFileBlockerCount,
    fingerprint: blockerFlow.fingerprint + '::render:' + renderFingerprint,
    graphEdges,
    graphNodes: state.steps,
    currentFileTargetNodeId: exactCurrentFileTarget?.id,
    currentFileTargetStepId: exactCurrentFileTarget === undefined
      ? undefined
      : 'render-entry:' + exactCurrentFileTarget.id,
    renderStages,
    renderStepById: state.stepById,
    renderSteps: state.steps,
    renderTruncated: state.truncated,
    targetPathIds: targetPath.map((node) => node.id),
  };
}
`;
}
