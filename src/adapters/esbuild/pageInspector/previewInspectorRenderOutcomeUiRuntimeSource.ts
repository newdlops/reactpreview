/**
 * Generates static JSX-outcome graph nodes and their compact Inspector editor.
 *
 * Runtime Fiber data can describe only the branch that mounted. Build-time outcome analysis also
 * knows dormant return candidates, so this adapter projects those candidates beneath the exact
 * current-file export without replacing the full blocker/Fiber graph used by Focus and All.
 */

/**
 * Creates browser-side helpers for outcome graph construction and selection.
 *
 * Expected lexical bindings include the render-flow step factories, condition registries, selected
 * outcome runtime helpers, React, and the ordinary Inspector button component. Component trees are
 * traversed with independent depth/count bounds even though compiler output is already bounded.
 *
 * @returns Plain JavaScript concatenated before render-flow construction and Inspector components.
 */
export function createPreviewInspectorRenderOutcomeUiRuntimeSource(): string {
  return String.raw`
const PREVIEW_INSPECTOR_OUTCOME_COMPONENT_DEPTH_LIMIT = 8;
const PREVIEW_INSPECTOR_OUTCOME_COMPONENT_NODE_LIMIT = 64;

/** Matches a selected-file export using source identity even when its Fiber has not mounted. */
function isPreviewInspectorReferencedRenderOutcomeTargetNode(node, reference) {
  if (
    reference === undefined ||
    node?.currentFileExport !== true ||
    node?.exportName !== reference.exportName
  ) {
    return false;
  }
  const nodeSourcePath = normalizePreviewInspectorConditionSourcePath(node?.source?.path);
  return nodeSourcePath.length > 0 &&
    matchesPreviewInspectorConditionSourcePath(nodeSourcePath, reference.sourcePath);
}

/** Reads the analyzer's source record without trusting optional compatibility spellings. */
function readPreviewInspectorRenderOutcomeSource(value, fallbackSourcePath) {
  const source = value?.source;
  return {
    column: Number.isSafeInteger(value?.column)
      ? value.column
      : Number.isSafeInteger(source?.column) ? source.column : undefined,
    line: Number.isSafeInteger(value?.line)
      ? value.line
      : Number.isSafeInteger(source?.line) ? source.line : undefined,
    path: typeof value?.sourcePath === 'string'
      ? value.sourcePath
      : typeof source?.sourcePath === 'string'
        ? source.sourcePath
        : fallbackSourcePath,
  };
}

/** Describes one complete conjunction edge from the current export to a JSX return candidate. */
function describePreviewInspectorRenderOutcomeConditions(outcome) {
  const conditions = Array.isArray(outcome?.conditions) ? outcome.conditions.slice(0, 4) : [];
  if (conditions.length === 0) return 'always';
  return conditions.map((condition) => {
    const expression = typeof condition?.expression === 'string'
      ? condition.expression.replace(/\s+/gu, ' ').trim().slice(0, 72)
      : 'condition';
    const arm = typeof condition?.label === 'string' && condition.label.length > 0
      ? condition.label
      : Object.prototype.hasOwnProperty.call(condition ?? {}, 'value')
        ? 'case ' + JSON.stringify(condition.value)
        : condition?.arm ?? condition?.branch ?? 'selected';
    return expression + ' → ' + String(arm).slice(0, 72);
  }).join(' ∧ ');
}

/**
 * Produces the stable source identity shared by compiler outcomes and evaluated runtime controls.
 * Empty optional fields intentionally remain in the key: a partial analyzer record must fall back
 * to the compatibility matcher instead of accidentally aliasing a more specific runtime record.
 */
function createPreviewInspectorRenderOutcomeControlKey(value) {
  const source = readPreviewInspectorRenderOutcomeConditionSource(value);
  const sourcePath = normalizePreviewInspectorConditionSourcePath(source.sourcePath);
  if (sourcePath.length === 0) return undefined;
  const line = Number.isSafeInteger(source.line) ? String(source.line) : '';
  const column = Number.isSafeInteger(source.column) ? String(source.column) : '';
  const expression = typeof source.expression === 'string'
    ? source.expression.replace(/\s+/gu, ' ').trim()
    : '';
  return [sourcePath, line, column, expression].join('|');
}

/** Indexes the first sorted record for each exact identity, preserving the former find semantics. */
function indexPreviewInspectorRenderOutcomeControls(records) {
  const recordsByKey = new Map();
  for (const record of records) {
    const key = createPreviewInspectorRenderOutcomeControlKey(record);
    if (key !== undefined && !recordsByKey.has(key)) recordsByKey.set(key, record);
  }
  return recordsByKey;
}

/**
 * Reads and indexes expensive condition registries once for one graph append transaction.
 * Registry readers clone, enrich, and sort their values, so invoking them inside the
 * outcome-by-condition loop causes avoidable CPU work and short-lived allocations.
 */
function createPreviewInspectorRenderOutcomeControlIndex() {
  const booleanRecords = readPreviewInspectorRenderConditions();
  const choiceRecords = readPreviewInspectorRenderChoices();
  return {
    booleanRecords,
    booleanRecordsByKey: indexPreviewInspectorRenderOutcomeControls(booleanRecords),
    choiceRecords,
    choiceRecordsByKey: indexPreviewInspectorRenderOutcomeControls(choiceRecords),
    selectedOutcomeId: readPreviewInspectorSelectedRenderOutcomeId(),
  };
}

/**
 * Resolves an exact indexed runtime control, retaining relative/absolute path compatibility and
 * optional analyzer-field semantics through a bounded scan of the already-read snapshot.
 */
function findPreviewInspectorRenderOutcomeControl(condition, records, recordsByKey) {
  const key = createPreviewInspectorRenderOutcomeControlKey(condition);
  const exactRecord = key === undefined ? undefined : recordsByKey.get(key);
  if (
    exactRecord !== undefined &&
    matchesPreviewInspectorRenderOutcomeCondition(condition, exactRecord)
  ) {
    return exactRecord;
  }
  return records.find((record) =>
    matchesPreviewInspectorRenderOutcomeCondition(condition, record));
}

/** Reports whether currently observed runtime controls already select one static outcome. */
function isPreviewInspectorRenderOutcomeCurrentlyActive(outcome, outcomeIndex, controlIndex) {
  const selectedId = controlIndex.selectedOutcomeId;
  if (selectedId !== undefined) return outcome?.id === selectedId;
  const conditions = Array.isArray(outcome?.conditions) ? outcome.conditions : [];
  if (conditions.length === 0) return outcomeIndex === 0;
  let matchedCount = 0;
  for (const condition of conditions.slice(0, PREVIEW_INSPECTOR_RENDER_OUTCOME_CONDITION_LIMIT)) {
    const arm = condition?.arm ?? condition?.branch;
    const booleanRecord = findPreviewInspectorRenderOutcomeControl(
      condition,
      controlIndex.booleanRecords,
      controlIndex.booleanRecordsByKey,
    );
    if (booleanRecord !== undefined && (arm === 'truthy' || arm === 'falsy')) {
      matchedCount += 1;
      if (booleanRecord.effectiveEnabled !== (arm === 'truthy')) return false;
      continue;
    }
    const choiceRecord = findPreviewInspectorRenderOutcomeControl(
      condition,
      controlIndex.choiceRecords,
      controlIndex.choiceRecordsByKey,
    );
    if (choiceRecord !== undefined && (arm === 'case' || arm === 'default')) {
      matchedCount += 1;
      const selectedBranch = choiceRecord.branches?.find(
        (branch) => branch.id === choiceRecord.effectiveBranchId,
      );
      if (arm === 'default' ? selectedBranch?.default !== true :
        Object.prototype.hasOwnProperty.call(condition, 'value') &&
          selectedBranch?.value !== condition.value) {
        return false;
      }
    }
  }
  return matchedCount === conditions.length;
}

/** Appends the nested PascalCase/member component structure below one return outcome. */
function appendPreviewInspectorRenderOutcomeComponents({
  active,
  componentTree,
  depth,
  fallbackSourcePath,
  outcomeId,
  ownerIds,
  ownerNames,
  predecessorId,
  state,
  treePath,
}) {
  if (
    depth > PREVIEW_INSPECTOR_OUTCOME_COMPONENT_DEPTH_LIMIT ||
    state.currentFileOutcomeNodeIds.size >= PREVIEW_INSPECTOR_OUTCOME_COMPONENT_NODE_LIMIT
  ) {
    state.truncated = true;
    return;
  }
  const nodes = Array.isArray(componentTree) ? componentTree : componentTree === undefined
    ? []
    : [componentTree];
  for (const [index, component] of nodes.entries()) {
    if (state.currentFileOutcomeNodeIds.size >= PREVIEW_INSPECTOR_OUTCOME_COMPONENT_NODE_LIMIT) {
      state.truncated = true;
      return;
    }
    if (component === null || typeof component !== 'object') continue;
    const componentPath = [...treePath, index];
    const id = 'render-outcome:' + outcomeId + ':component:' + componentPath.join('.');
    const name = typeof component.name === 'string' && component.name.length > 0
      ? component.name.slice(0, 160)
      : 'Component';
    const node = {
      certainty: 'confirmed',
      children: [],
      id: id + ':node',
      kind: 'component',
      name,
      source: readPreviewInspectorRenderOutcomeSource(component, fallbackSourcePath),
    };
    const step = createPreviewInspectorRenderFlowContextStep({
      detail: 'JSX outcome renders <' + name + '>',
      flowKind: 'static-component-call',
      graphKind: 'component',
      id,
      kind: 'component',
      label: name,
      level: (state.stepById.get(predecessorId)?.level ?? 0) + 1,
      node,
      ownerIds,
      ownerNames,
      predecessorIds: [predecessorId],
    });
    step.branchState = active ? 'active' : 'inactive';
    step.currentFileContext = true;
    step.currentFileOutcome = true;
    step.incomingEdges = [{ active, fromId: predecessorId, kind: 'renders' }];
    if (!appendPreviewInspectorRenderFlowStep(state, step)) continue;
    state.currentFileOutcomeNodeIds.add(id);
    appendPreviewInspectorRenderOutcomeComponents({
      active,
      componentTree: component.children,
      depth: depth + 1,
      fallbackSourcePath,
      outcomeId,
      ownerIds,
      ownerNames,
      predecessorId: id,
      state,
      treePath: componentPath,
    });
  }
}

/** Adds every statically known return choice beneath the selected-file function entry. */
function appendPreviewInspectorStaticRenderOutcomes({ entryId, node, ownerIds, ownerNames, state }) {
  const plan = readPreviewInspectorSelectedRenderOutcomePlan();
  const outcomes = readPreviewInspectorStaticRenderOutcomes();
  if (outcomes.length === 0 || !state.stepById.has(entryId)) return;
  const controlIndex = createPreviewInspectorRenderOutcomeControlIndex();
  const fallbackSourcePath = typeof plan?.sourcePath === 'string'
    ? plan.sourcePath
    : node?.source?.path;
  for (const [outcomeIndex, outcome] of outcomes.entries()) {
    if (typeof outcome.id !== 'string' || outcome.id.length === 0) continue;
    const id = 'render-outcome:' + outcome.id;
    const active = isPreviewInspectorRenderOutcomeCurrentlyActive(
      outcome,
      outcomeIndex,
      controlIndex,
    );
    const source = readPreviewInspectorRenderOutcomeSource(outcome, fallbackSourcePath);
    const outcomeNode = {
      certainty: 'confirmed',
      children: [],
      id: id + ':node',
      kind: 'render-outcome',
      name: typeof outcome.label === 'string' ? outcome.label : 'JSX outcome',
      source,
    };
    const step = createPreviewInspectorRenderFlowContextStep({
      detail: 'Static JSX return candidate · ' + describePreviewInspectorRenderOutcomeConditions(outcome),
      flowKind: 'static-render-outcome',
      graphKind: 'return',
      id,
      kind: 'return',
      label: typeof outcome.label === 'string' ? outcome.label : 'return JSX',
      level: (state.stepById.get(entryId)?.level ?? 0) + 1,
      node: outcomeNode,
      ownerIds,
      ownerNames,
      predecessorIds: [entryId],
    });
    step.branchState = active ? 'active' : 'inactive';
    step.currentFileContext = true;
    step.currentFileOutcome = true;
    step.incomingEdges = [{
      active,
      fromId: entryId,
      kind: 'outcome-condition',
      label: describePreviewInspectorRenderOutcomeConditions(outcome),
    }];
    step.renderOutcome = outcome;
    if (!appendPreviewInspectorRenderFlowStep(state, step)) continue;
    state.currentFileOutcomeNodeIds.add(id);
    state.currentFileOutcomeChoiceNodeIds?.add(id);
    appendPreviewInspectorRenderOutcomeComponents({
      active,
      componentTree: outcome.componentTree,
      depth: 0,
      fallbackSourcePath,
      outcomeId: outcome.id,
      ownerIds,
      ownerNames,
      predecessorId: id,
      state,
      treePath: [],
    });
  }
}

/**
 * Materializes one inert application-to-current-file corridor independently from the mounted tree.
 * This prevents an unmounted export inventory sibling from masquerading as a two-hop application
 * path when login, data, or routing logic blocks the actual target before Fiber can mount it.
 */
function appendPreviewInspectorStaticApplicationRenderPath(state) {
  const descriptor = findSelectedPreviewInspectorDescriptor();
  const context = readPreviewInspectorRenderContextEntries(descriptor, { preferShortest: true });
  const entries = Array.isArray(context?.entries) ? context.entries.slice(0, 64) : [];
  if (entries.length === 0) return;
  const selectedExportName = previewInspectorSession.selectedExportName;
  let predecessorId;
  const ownerIds = [];
  const ownerNames = [];
  for (const [index, entry] of entries.entries()) {
    const id = 'static-render-path:' + String(index) + ':' + String(entry.kind) + ':' +
      String(entry.name);
    const target = index === entries.length - 1 && entry.name === selectedExportName;
    const node = {
      certainty: entry.certainty ?? 'confirmed',
      children: [],
      contextOnly: true,
      currentFileExport: target,
      edgeKind: entry.edgeKind,
      exportName: target ? selectedExportName : undefined,
      id: id + ':node',
      invocation: entry.invocation,
      kind: target ? 'target' : entry.kind,
      mounted: false,
      name: entry.name,
      source: readPreviewInspectorRenderOutcomeSource(entry, entry.sourcePath),
    };
    const nextOwnerIds = [...ownerIds, id];
    const nextOwnerNames = [...ownerNames, entry.name];
    const step = createPreviewInspectorRenderFlowContextStep({
      detail: target
        ? 'Static current-file export reached from the selected application path'
        : 'Static application entry / route / wrapper evidence; project code was not invoked',
      graphKind: index === 0 ? 'entry' : readPreviewInspectorRenderFlowComponentGraphKind(
        node,
        predecessorId === undefined ? [] : [predecessorId],
      ),
      id,
      kind: 'component',
      label: entry.name,
      level: index,
      node,
      ownerIds: nextOwnerIds,
      ownerNames: nextOwnerNames,
      predecessorIds: predecessorId === undefined ? [] : [predecessorId],
    });
    step.incomingEdges = predecessorId === undefined ? [] : [{
      active: true,
      fromId: predecessorId,
      kind: entry.invocation?.mode ?? entry.edgeKind ?? 'renders',
      label: entry.invocation?.slotName,
    }];
    step.staticApplicationPath = true;
    if (target) {
      step.currentFileContext = true;
      step.staticCurrentFileTarget = true;
    }
    if (!appendPreviewInspectorRenderFlowStep(state, step)) return;
    state.staticMainPathNodeIds.push(id);
    ownerIds.push(id);
    ownerNames.push(entry.name);
    predecessorId = id;
    if (target) {
      state.staticMainPathTargetStepId = id;
      appendPreviewInspectorStaticRenderOutcomes({
        entryId: id,
        node,
        ownerIds: nextOwnerIds,
        ownerNames: nextOwnerNames,
        state,
      });
    }
  }
}

/** Renders only the selected static return's complete condition conjunction. */
function PreviewInspectorRenderOutcomeEditor({ step }) {
  const outcome = step?.renderOutcome;
  if (outcome === undefined) return null;
  const selected = readPreviewInspectorSelectedRenderOutcomeId() === outcome.id;
  const names = Array.isArray(outcome.componentNames) ? outcome.componentNames.slice(0, 12) : [];
  return React.createElement(
    'div',
    { className: 'rpi-flow-inspector-outcome-editor' },
    React.createElement(
      'strong',
      undefined,
      selected ? 'Selected JSX outcome' : 'Render this JSX outcome',
    ),
    React.createElement(
      'div',
      { className: 'rpi-note' },
      describePreviewInspectorRenderOutcomeConditions(outcome),
    ),
    names.length === 0
      ? undefined
      : React.createElement('div', { className: 'rpi-note' }, 'Components · ' + names.join(', ')),
    React.createElement(
      'div',
      { className: 'rpi-actions' },
      React.createElement(
        PreviewInspectorDevtoolsButton,
        {
          disabled: selected,
          onClick: () => selectPreviewInspectorRenderOutcome(outcome.id),
          title: 'Apply the complete source-proven condition path and remount once',
        },
        selected ? 'Active choice' : 'Show this return',
      ),
      selected
        ? React.createElement(
            PreviewInspectorDevtoolsButton,
            { onClick: clearPreviewInspectorRenderOutcome, title: 'Restore authored control flow' },
            'Use authored flow',
          )
        : undefined,
    ),
  );
}
`;
}
