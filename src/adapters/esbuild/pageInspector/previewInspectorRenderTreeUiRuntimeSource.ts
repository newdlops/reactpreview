/**
 * Generates the UI-side application-root and current-file export tree enrichment.
 *
 * The mounted Fiber tree begins at the safest route-aware application shell. Executing a complete
 * browser bootstrap would reintroduce authentication, network, and route-loader side effects, so
 * higher entry evidence remains inert. This module prepends that evidence above the live shell and
 * inventories current-file exports not mounted by the selected authored route branch.
 */

/**
 * Creates browser source that joins static render-path evidence with the mounted component tree.
 *
 * Expected lexical bindings include Page Inspector descriptor/candidate readers, UI source
 * normalization, path matching, and the pinned session. All added nodes are data-only; selecting a
 * route node can open source but never executes the application entry module.
 *
 * @returns Plain JavaScript source concatenated into the DevTools-style Inspector runtime.
 */
export function createPreviewInspectorRenderTreeUiRuntimeSource(): string {
  return String.raw`
/** Returns component-shaped exports declared by the file currently opened in the editor. */
function readPreviewInspectorCurrentFileExports(descriptor) {
  const inspector = descriptor?.inspector;
  if (inspector === undefined) return [];
  const names = [
    inspector.target?.exportName,
    ...Object.keys(inspector.renderChainsByExport ?? {}),
  ].filter(
    (name, index, values) =>
      typeof name === 'string' &&
      (name === 'default' || /^\p{Lu}/u.test(name)) &&
      values.indexOf(name) === index,
  );
  return names.slice(0, 64).map((exportName) => {
    const chain = inspector.renderChainsByExport?.[exportName];
    return {
      exportName,
      sourcePath: chain?.target?.sourcePath ??
        (exportName === inspector.target?.exportName ? inspector.target?.sourcePath : undefined),
    };
  });
}

/**
 * Resolves the current-file export whose static JSX outcomes belong in the Elements tree.
 *
 * A page-root export can be selected for execution while the editor still points at a nested target
 * export. Reusing the render-outcome runtime's ownership decision keeps those two identities from
 * being conflated and falls back to immutable descriptor evidence when that helper is unavailable.
 */
function readPreviewInspectorExpectedOutcomeExportName(descriptor) {
  const runtimeName = typeof readPreviewInspectorRenderOutcomeExportName === 'function'
    ? readPreviewInspectorRenderOutcomeExportName()
    : undefined;
  if (
    typeof runtimeName === 'string' &&
    descriptor?.inspector?.renderOutcomesByExport?.[runtimeName] !== undefined
  ) {
    return runtimeName;
  }
  const selectedName = previewInspectorSession.selectedExportName;
  if (
    typeof selectedName === 'string' &&
    descriptor?.inspector?.renderOutcomesByExport?.[selectedName] !== undefined
  ) {
    return selectedName;
  }
  const targetName = descriptor?.inspector?.target?.exportName;
  return typeof targetName === 'string' &&
    descriptor?.inspector?.renderOutcomesByExport?.[targetName] !== undefined
    ? targetName
    : undefined;
}

/** Reads the persisted whole-return selection without treating logical-AND switches as outcomes. */
function readPreviewInspectorExpectedSelectedOutcomeId(plan, exportName) {
  const runtimeOutcome = typeof readPreviewInspectorSelectedRenderOutcome === 'function'
    ? readPreviewInspectorSelectedRenderOutcome()
    : undefined;
  if (runtimeOutcome?.exportName === exportName && typeof runtimeOutcome?.id === 'string') {
    return runtimeOutcome.id;
  }
  const persisted = previewInspectorSession.devtoolsState?.renderOutcomeSelectionByExport;
  if (
    persisted !== null &&
    typeof persisted === 'object' &&
    typeof persisted?.[exportName] === 'string'
  ) {
    return persisted[exportName];
  }
  const outcomes = Array.isArray(plan?.outcomes) ? plan.outcomes : [];
  return outcomes.length === 1 &&
    (!Array.isArray(outcomes[0]?.conditions) || outcomes[0].conditions.length === 0) &&
    typeof outcomes[0]?.id === 'string'
    ? outcomes[0].id
    : undefined;
}

/**
 * Reads current target-output truth without asking a static component row to impersonate Fiber.
 *
 * Boundary helpers provide the freshest answer during the delay before reachability state updates;
 * retained state remains the safe UI-only fallback used by isolated tests and old preview artifacts.
 */
function readPreviewInspectorExpectedOutputState(exportName) {
  let retainedState;
  const states = previewInspectorSession.targetReachabilityByKey;
  if (states instanceof Map) {
    const activeKey = previewInspectorSession.activeTargetReachabilityKey;
    const active = typeof activeKey === 'string' ? states.get(activeKey) : undefined;
    retainedState = active?.targetExportName === exportName
      ? active
      : [...states.values()].find((state) => state?.targetExportName === exportName);
  }
  let mounted = retainedState?.targetMounted === true || retainedState?.targetWasMounted === true;
  let hasOutput = retainedState?.targetHasOutput === true;
  let hasAnyHostOutput = retainedState?.targetHasAnyHostOutput === true;
  let deferredCallbackPending = retainedState?.targetDeferredCallbackPending === true;
  let renderedEmpty = retainedState?.targetRenderedEmpty === true;
  try {
    const boundaries = previewInspectorSession.boundariesByExport?.get(exportName);
    if (boundaries instanceof Set) {
      hasAnyHostOutput = [...boundaries].some(
        (boundary) => collectPreviewInspectorFiberElements(boundary).length > 0,
      );
    }
    if (typeof hasMountedPreviewInspectorTarget === 'function') {
      mounted = hasMountedPreviewInspectorTarget({ targetExportName: exportName }) || mounted;
    }
    if (typeof hasPreviewInspectorTargetHostOutput === 'function') {
      const outputProbe = { targetExportName: exportName };
      hasOutput = hasPreviewInspectorTargetHostOutput(outputProbe);
      deferredCallbackPending = outputProbe.targetDeferredCallbackPending === true;
      renderedEmpty = outputProbe.targetRenderedEmpty === true;
    }
  } catch {
    /* UI enrichment must stay available when a future collector cannot expose boundary internals. */
  }
  hasAnyHostOutput = retainedState?.targetHasAnyHostOutput === true || hasAnyHostOutput;
  return { deferredCallbackPending, hasAnyHostOutput, hasOutput, mounted, renderedEmpty };
}

/** Counts a bounded static component forest when older descriptors omit component-name metadata. */
function countPreviewInspectorExpectedComponentNodes(nodes, state = { count: 0 }) {
  if (!Array.isArray(nodes) || state.count >= 256) return state.count;
  for (const node of nodes) {
    if (node === null || typeof node !== 'object' || state.count >= 256) continue;
    state.count += 1;
    countPreviewInspectorExpectedComponentNodes(node.children, state);
  }
  return state.count;
}

/** Creates one stable family identity for outcomes that differ only by JSX logical-AND visibility. */
function createPreviewInspectorExpectedOutcomeFamilyKey(outcome) {
  const conditions = Array.isArray(outcome?.conditions) ? outcome.conditions : [];
  const logicalConditions = conditions.filter((condition) => condition?.kind === 'logical-and');
  if (logicalConditions.length === 0) return 'outcome:' + String(outcome?.id ?? 'unknown');
  const logicalGroups = [...new Set(logicalConditions.map((condition) =>
    condition?.logicalAndGroupId ?? condition?.id,
  ).filter((value) => typeof value === 'string'))].sort();
  const ordinaryConditions = conditions.filter((condition) => condition?.kind !== 'logical-and')
    .map((condition) => [condition?.id, condition?.branch, condition?.value]);
  return JSON.stringify([outcome?.sourcePath, outcome?.exportName, ordinaryConditions, logicalGroups]);
}

/**
 * Collapses the visible/hidden products of logical-AND expressions into one component-rich family.
 * Their existing component-tree Boolean switches remain the sole interactive controls, while
 * ternary/if/switch return alternatives retain separate authored outcome rows.
 */
function readPreviewInspectorExpectedOutcomeFamilies(plan) {
  const families = new Map();
  const outcomes = Array.isArray(plan?.outcomes) ? plan.outcomes.slice(0, 32) : [];
  for (const outcome of outcomes) {
    if (outcome === null || typeof outcome !== 'object' || typeof outcome.id !== 'string') continue;
    const key = createPreviewInspectorExpectedOutcomeFamilyKey(outcome);
    const previous = families.get(key);
    const conditions = Array.isArray(outcome.conditions) ? outcome.conditions : [];
    const logicalOnly = conditions.length > 0 &&
      conditions.every((condition) => condition?.kind === 'logical-and');
    const componentCount = Array.isArray(outcome.componentNames)
      ? outcome.componentNames.length
      : countPreviewInspectorExpectedComponentNodes(outcome.componentTree);
    if (previous === undefined) {
      families.set(key, { componentCount, ids: [outcome.id], logicalOnly, outcome });
      continue;
    }
    previous.ids.push(outcome.id);
    previous.logicalOnly = previous.logicalOnly && logicalOnly;
    if (componentCount > previous.componentCount) {
      previous.componentCount = componentCount;
      previous.outcome = outcome;
    }
  }
  return [...families.values()];
}

/** Collects exact live JSX occurrences below the selected export for one-to-one static matching. */
function collectPreviewInspectorLiveSourceClaims(nodes, claims = []) {
  if (!Array.isArray(nodes) || claims.length >= 512) return claims;
  for (const node of nodes) {
    const source = node?.source;
    if (
      node?.contextOnly !== true &&
      node?.expectedOutput !== true &&
      node?.mounted !== false &&
      source?.approximate !== true &&
      typeof source?.path === 'string' &&
      Number.isSafeInteger(source?.line) &&
      source.line > 0
    ) {
      claims.push({ claimed: false, source });
    }
    collectPreviewInspectorLiveSourceClaims(node?.children, claims);
  }
  return claims;
}

/** Claims one exact JSX source occurrence even when HOCs rename the corresponding live Fiber. */
function claimPreviewInspectorExpectedLiveOccurrence(source, claims) {
  if (
    source?.approximate === true ||
    typeof source?.path !== 'string' ||
    !Number.isSafeInteger(source?.line) ||
    source.line <= 0
  ) {
    return false;
  }
  const match = claims.find((claim) => {
    const live = claim.source;
    const columnsConflict = Number.isSafeInteger(source.column) && source.column > 0 &&
      Number.isSafeInteger(live?.column) && live.column > 0 && source.column !== live.column;
    return claim.claimed !== true &&
      live?.approximate !== true &&
      Number.isSafeInteger(live?.line) &&
      live.line === source.line &&
      !columnsConflict &&
      matchesPreviewInspectorConditionSourcePath(live?.path, source.path);
  });
  if (match === undefined) return false;
  match.claimed = true;
  return true;
}

/**
 * Converts one analyzer occurrence into authored evidence, never a counterfeit Fiber mount claim.
 *
 * Exact source matches consume the duplicate static row and promote their children. Once the first
 * missing occurrence is found, its descendants remain possibilities because expanded implementation
 * outcomes can contain mutually exclusive branches that syntax alone cannot classify as unmounted.
 */
function createPreviewInspectorExpectedComponentForest(
  node,
  outcome,
  path,
  liveClaims,
  ancestorUnobserved = false,
) {
  const sourcePath = typeof node?.sourcePath === 'string' ? node.sourcePath : outcome?.sourcePath;
  const source = normalizePreviewInspectorUiSource({
    column: node?.column,
    displayName: sourcePath,
    line: node?.line,
    path: sourcePath,
  });
  const liveMatched = !ancestorUnobserved && Array.isArray(liveClaims) &&
    claimPreviewInspectorExpectedLiveOccurrence(source, liveClaims);
  const children = (Array.isArray(node?.children) ? node.children : []).slice(0, 96).flatMap(
    (child, index) => createPreviewInspectorExpectedComponentForest(
      child,
      outcome,
      path + '.' + String(index),
      liveClaims,
      ancestorUnobserved || !liveMatched,
    ),
  );
  if (liveMatched) return children;
  const expectedFrontier = Array.isArray(liveClaims) && !ancestorUnobserved;
  return [{
    children,
    contextOnly: true,
    edgeKind: node?.renderMode === 'deferred-callback'
      ? 'deferred-render-callback'
      : 'expected-jsx-component',
    expectedOutput: true,
    expectedFrontier,
    id: 'expected-jsx:' + String(outcome?.id ?? 'unknown') + ':' + path,
    kind: 'component',
    name: typeof node?.name === 'string' && node.name.length > 0
      ? node.renderMode === 'deferred-callback'
        ? 'Deferred callback · ' + node.name
        : node.name
      : 'Unknown component',
    props: {
      authored: true,
      deferred: node?.renderMode === 'deferred-callback',
      expected: true,
      expectedPresence: expectedFrontier ? 'not-observed' : 'unproven',
      live: false,
    },
    source,
    state: undefined,
  }];
}

/** Creates a selectable data-only row for one whole-return outcome or condition alternative. */
function createPreviewInspectorExpectedOutcomeNode(family, selectedId, outputState, liveClaims) {
  const outcome = family.outcome;
  const outputMissing = outputState.hasOutput !== true;
  const selected = family.ids.includes(selectedId);
  const ordinaryConditions = (Array.isArray(outcome.conditions) ? outcome.conditions : [])
    .filter((condition) => condition?.kind !== 'logical-and')
    .map((condition) => ({
      branch: condition.branch,
      expression: condition.expression,
      kind: condition.kind,
      label: condition.label,
      selectable: condition.selectable,
      value: condition.value,
    }));
  const logicalSwitchCount = (Array.isArray(outcome.conditions) ? outcome.conditions : [])
    .filter((condition) => condition?.kind === 'logical-and').length;
  const prefix = selected
    ? 'Expected return · '
    : selectedId === undefined ? 'Return option · ' : 'Alternative return · ';
  return {
    children: (Array.isArray(outcome.componentTree) ? outcome.componentTree : []).slice(0, 96)
      .flatMap((node, index) => createPreviewInspectorExpectedComponentForest(
        node,
        outcome,
        String(index),
        selected ? liveClaims : undefined,
      )),
    contextOnly: true,
    edgeKind: 'expected-render-outcome',
    authoredOutputMissing: outputMissing,
    expectedOutcomeActive: selected,
    expectedOutput: true,
    id: 'expected-outcome:' + outcome.id,
    kind: 'component',
    liveHostOutputMissing: outputMissing && outputState.hasAnyHostOutput !== true,
    name: prefix + String(outcome.label ?? outcome.kind ?? 'authored return'),
    outcomeId: outcome.id,
    props: {
      authored: true,
      kind: outcome.kind,
      authoredOutput: outputState.hasOutput === true,
      liveHostOutput: outputState.hasAnyHostOutput === true,
      logicalSwitchCount,
      selected,
    },
    source: normalizePreviewInspectorUiSource({
      column: outcome.column,
      displayName: outcome.sourcePath,
      line: outcome.line,
      path: outcome.sourcePath,
    }),
    state: { conditions: ordinaryConditions },
  };
}

/** Builds the static JSX inventory shown only as expectation/alternative evidence. */
function createPreviewInspectorExpectedOutcomeGroup(descriptor, exportName, liveNodes) {
  const plan = descriptor?.inspector?.renderOutcomesByExport?.[exportName];
  if (plan === null || typeof plan !== 'object') return undefined;
  const families = readPreviewInspectorExpectedOutcomeFamilies(plan);
  if (families.length === 0) return undefined;
  const outputState = readPreviewInspectorExpectedOutputState(exportName);
  const outputMissing = outputState.hasOutput !== true;
  let selectedId = readPreviewInspectorExpectedSelectedOutcomeId(plan, exportName);
  if (selectedId === undefined && families.length === 1) selectedId = families[0]?.ids[0];
  const visibleFamilies = outputMissing
    ? families
    : families.filter((family) => !family.ids.includes(selectedId) && family.logicalOnly !== true);
  if (visibleFamilies.length === 0) return undefined;
  const liveClaims = collectPreviewInspectorLiveSourceClaims(liveNodes);
  const children = visibleFamilies
    .sort((left, right) => Number(right.ids.includes(selectedId)) - Number(left.ids.includes(selectedId)))
    .map((family) => createPreviewInspectorExpectedOutcomeNode(
      family,
      selectedId,
      outputState,
      liveClaims,
    ));
  return {
    authoredOutputMissing: outputMissing,
    children,
    contextOnly: true,
    edgeKind: 'expected-output-group',
    expectedOutput: true,
    id: 'expected-outcomes:' + exportName,
    kind: 'component',
    liveHostOutputMissing: outputMissing && !outputState.hasAnyHostOutput,
    name: outputMissing
      ? outputState.deferredCallbackPending
        ? 'Expected JSX · callback output not observed'
        : outputState.hasAnyHostOutput
        ? 'Expected JSX · wrapper/fallback host only'
        : 'Expected JSX · no live host output'
      : 'Authored JSX alternatives',
    props: {
      authoredOutput: outputState.hasOutput === true,
      deferredCallbackPending: outputState.deferredCallbackPending === true,
      liveHostOutput: outputState.hasAnyHostOutput === true,
      renderedEmpty: outputState.renderedEmpty === true,
      wrapperOrFallbackHost: outputState.hasAnyHostOutput === true && outputMissing,
      targetMounted: outputState.mounted === true,
      truncated: plan.truncated === true,
    },
    source: normalizePreviewInspectorUiSource({ displayName: plan.sourcePath, path: plan.sourcePath }),
    state: undefined,
  };
}

/** Attaches expectation evidence once below the exact selected current-file export row. */
function appendPreviewInspectorExpectedOutcomes(nodes, descriptor, exportName) {
  const attachment = { complete: false };
  const visit = (values) => values.map((node) => {
    const children = visit(node.children);
    const matches = attachment.complete !== true && node.currentFileExport === true &&
      (node.exportName === exportName || node.name === exportName);
    if (!matches) return { ...node, children };
    attachment.complete = true;
    const group = createPreviewInspectorExpectedOutcomeGroup(
      descriptor,
      exportName,
      children,
    );
    return group === undefined ? { ...node, children } : { ...node, children: [...children, group] };
  });
  return visit(nodes);
}

/** Maps a render-graph edge to the React-centered category displayed by the Elements tree. */
function classifyPreviewInspectorRenderContextStep(step) {
  if (step?.kind === 'entry-render') return 'entry';
  if (step?.kind === 'route-branch') return 'route';
  if (step?.kind === 'react-lazy') return 'lazy';
  return 'component';
}

/** Appends one bounded context record while removing adjacent wrapper/name duplicates. */
function appendPreviewInspectorRenderContextEntry(entries, candidate) {
  if (typeof candidate?.name !== 'string' || candidate.name.length === 0) return;
  const previous = entries.at(-1);
  if (previous?.name === candidate.name && previous?.sourcePath === candidate.sourcePath) return;
  entries.push(candidate);
}

/** Appends nested HOC factory boundaries in outer-to-inner render order. */
function appendPreviewInspectorHocContextEntries(entries, step, invocation, sourcePath) {
  const factories = invocation.factoryNames?.length > 0
    ? [...invocation.factoryNames].reverse()
    : [invocation.calleeName ?? 'HOC'];
  for (const factoryName of factories.slice(0, 8)) {
    const mode = factoryName === 'memo'
      ? 'memo'
      : factoryName === 'forwardRef' ? 'forward-ref' : factoryName === 'styled' ? 'styled' : 'hoc';
    appendPreviewInspectorRenderContextEntry(entries, {
      certainty: step.certainty,
      edgeKind: 'hoc-wrapper',
      invocation: { ...invocation, calleeName: factoryName, factoryNames: [factoryName], mode },
      kind: 'component',
      name: factoryName + '(…)',
      occurrenceStart: step.occurrenceStart,
      sourcePath,
    });
  }
}

/** Expands HOC factories and component-valued JSX props into explicit inert context nodes. */
function appendPreviewInspectorInvocationContextEntries(entries, step) {
  const invocation = step?.invocation;
  if (invocation === undefined) return;
  const invocationSourcePath = invocation.sourcePath ?? step.sourcePath;
  const hocModes = ['hoc', 'memo', 'forward-ref', 'styled'];
  if (hocModes.includes(invocation.mode)) {
    appendPreviewInspectorHocContextEntries(entries, step, invocation, invocationSourcePath);
    return;
  }
  if (['component-prop', 'polymorphic-prop', 'render-prop'].includes(invocation.mode)) {
    const receiver = invocation.calleeName ?? 'Component';
    appendPreviewInspectorRenderContextEntry(entries, {
      certainty: step.certainty,
      edgeKind: 'component-slot',
      invocation,
      kind: 'component',
      name: receiver + '.' + (invocation.slotName ?? 'component'),
      occurrenceStart: step.occurrenceStart,
      sourcePath: invocationSourcePath,
    });
    if (invocation.factoryNames?.length > 0) {
      appendPreviewInspectorHocContextEntries(entries, step, invocation, invocationSourcePath);
    }
  }
}

/**
 * Reads one inert workspace-entry-to-target path in outer-to-inner order.
 *
 * The Elements tree may follow the user's selected page candidate. The compact Main flow instead
 * requests the compiler-ranked shortest entry path so page choice UI cannot silently make the
 * current-file locator longer or less deterministic.
 */
function readPreviewInspectorRenderContextEntries(descriptor, options = {}) {
  const inspector = descriptor?.inspector;
  if (inspector === undefined) return { entries: [], entryPoint: undefined };
  const selectedName = previewInspectorSession.selectedExportName;
  const primaryName = inspector.target?.exportName ?? descriptor?.exportName;
  const selectedChain = inspector.renderChainsByExport?.[selectedName] ?? inspector.renderChain;
  const candidate = readSelectedPreviewInspectorPageCandidate(descriptor);
  const shortestPath = selectedChain?.paths?.[0];
  const path = options.preferShortest === true
    ? shortestPath ?? candidate?.renderPath
    : selectedName === primaryName
      ? candidate?.renderPath ?? shortestPath
      : shortestPath ?? candidate?.renderPath;
  const entries = [];
  for (const step of [...(path?.steps ?? [])].slice(0, 64).reverse()) {
    appendPreviewInspectorInvocationContextEntries(entries, step);
    appendPreviewInspectorRenderContextEntry(entries, {
      certainty: step?.certainty,
      edgeKind: step?.kind,
      kind: classifyPreviewInspectorRenderContextStep(step),
      name: step?.label,
      occurrenceStart: step?.occurrenceStart,
      sourcePath: step?.sourcePath,
    });
    for (const wrapperName of [...(step?.wrapperNames ?? [])].slice(0, 16).reverse()) {
      appendPreviewInspectorRenderContextEntry(entries, {
        certainty: step?.certainty,
        edgeKind: 'wrapper',
        kind: step?.kind === 'route-branch' ? 'route' : 'component',
        name: wrapperName,
        occurrenceStart: step?.occurrenceStart,
        sourcePath: step?.sourcePath,
      });
    }
  }
  if (entries.length === 0 && typeof candidate?.root?.exportName === 'string') {
    appendPreviewInspectorRenderContextEntry(entries, {
      edgeKind: 'page-root',
      kind: 'component',
      name: candidate.root.exportName,
      sourcePath: candidate.root.sourcePath,
    });
  }
  if (typeof selectedName === 'string' && !selectedName.startsWith('@root:')) {
    const selectedTarget = selectedChain?.target ?? inspector.target;
    appendPreviewInspectorRenderContextEntry(entries, {
      edgeKind: 'current-file-export',
      kind: 'target',
      name: selectedName,
      sourcePath: selectedTarget?.sourcePath,
    });
  }
  return { entries, entryPoint: path?.entryPoint };
}

/** Finds the earliest static path step already represented anywhere in the mounted live tree. */
function findPreviewInspectorMountedContextIndex(entries, nodes) {
  let bestIndex = Number.POSITIVE_INFINITY;
  const visit = (values) => {
    for (const node of values) {
      const nodePath = normalizePreviewInspectorConditionSourcePath(node.source?.path);
      for (let index = 0; index < entries.length && index < bestIndex; index += 1) {
        const entry = entries[index];
        const sourceMatches =
          nodePath.length > 0 &&
          typeof entry.sourcePath === 'string' &&
          matchesPreviewInspectorConditionSourcePath(nodePath, entry.sourcePath);
        if (node.name === entry.name || sourceMatches) bestIndex = index;
      }
      visit(node.children);
    }
  };
  visit(nodes);
  return Number.isFinite(bestIndex) ? bestIndex : undefined;
}

/** Reports whether one live component represents a static render-context entry. */
function matchesPreviewInspectorRenderContextEntry(node, entry) {
  const nodePath = normalizePreviewInspectorConditionSourcePath(node.source?.path);
  const sourceMatches = nodePath.length > 0 &&
    typeof entry?.sourcePath === 'string' &&
    matchesPreviewInspectorConditionSourcePath(nodePath, entry.sourcePath);
  return node.name === entry?.name || sourceMatches;
}

/**
 * Inserts HOC/slot evidence between already mounted parent and child nodes.
 * Prefix-only enrichment would discard these boundaries as soon as any outer live component matched
 * the static path, so each contiguous invocation group wraps its following mounted child in place.
 */
function insertPreviewInspectorMountedInvocationContext(nodes, entries, prefixCount) {
  let roots = nodes;
  let index = 0;
  while (index < entries.length) {
    const entry = entries[index];
    if (!['hoc-wrapper', 'component-slot'].includes(entry?.edgeKind)) {
      index += 1;
      continue;
    }
    const start = index;
    while (
      index < entries.length &&
      ['hoc-wrapper', 'component-slot'].includes(entries[index]?.edgeKind)
    ) {
      index += 1;
    }
    const childEntry = entries[index];
    if (start < prefixCount || childEntry === undefined) continue;
    let inserted = false;
    const visit = (values) => values.map((node) => {
      if (!inserted && matchesPreviewInspectorRenderContextEntry(node, childEntry)) {
        inserted = true;
        let wrapped = node;
        for (let wrapperIndex = index - 1; wrapperIndex >= start; wrapperIndex -= 1) {
          wrapped = createPreviewInspectorRenderContextNode(
            entries[wrapperIndex],
            wrapperIndex,
            [wrapped],
          );
        }
        return wrapped;
      }
      return { ...node, children: visit(node.children) };
    });
    roots = visit(roots);
  }
  return roots;
}

/** Creates one read-only route/entry node that explains context without claiming to be mounted. */
function createPreviewInspectorRenderContextNode(entry, index, children) {
  return {
    certainty: entry.certainty,
    children,
    contextOnly: true,
    edgeKind: entry.edgeKind,
    id: 'render-context:' + String(index) + ':' + entry.kind + ':' + entry.name,
    kind: entry.kind,
    invocation: entry.invocation,
    name: entry.name,
    props: { certainty: entry.certainty, edge: entry.edgeKind, mounted: false },
    source: normalizePreviewInspectorUiSource({
      displayName: entry.sourcePath,
      occurrenceStart: entry.occurrenceStart,
      path: entry.sourcePath,
    }),
    state: undefined,
  };
}

/** Marks mounted current-file exports without mutating the collector-owned Fiber snapshot. */
function markPreviewInspectorCurrentFileExports(nodes, exports, mountedNames) {
  return nodes.map((node) => {
    const matching = exports.find((item) => {
      if (node.exportName === item.exportName) return true;
      const nodePath = normalizePreviewInspectorConditionSourcePath(node.source?.path);
      return node.name === item.exportName && nodePath.length > 0 &&
        typeof item.sourcePath === 'string' &&
        matchesPreviewInspectorConditionSourcePath(nodePath, item.sourcePath);
    });
    if (matching !== undefined) mountedNames.add(matching.exportName);
    return {
      ...node,
      ...(matching === undefined ? {} : { currentFileExport: true, mounted: true }),
      children: markPreviewInspectorCurrentFileExports(node.children, exports, mountedNames),
    };
  });
}

/** Creates an explicit inventory branch for exports absent from the selected authored page path. */
function createPreviewInspectorUnmountedExportGroup(exports, mountedNames) {
  const missing = exports.filter((item) => !mountedNames.has(item.exportName));
  if (missing.length === 0) return undefined;
  return {
    children: missing.map((item, index) => ({
      children: [],
      currentFileExport: true,
      exportName: item.exportName,
      id: 'unmounted-export:' + String(index) + ':' + item.exportName,
      kind: 'target',
      mounted: false,
      name: item.exportName,
      props: previewInspectorSession.basePropsByExport.get(item.exportName),
      source: normalizePreviewInspectorUiSource({ displayName: item.sourcePath, path: item.sourcePath }),
      state: undefined,
    })),
    contextOnly: true,
    id: 'current-file-exports:unmounted',
    kind: 'component',
    name: 'Unmounted current-file exports',
    props: { mounted: false },
    source: undefined,
    state: undefined,
  };
}

/** Joins workspace root, entry/route evidence, live page Fiber, and missing export inventory. */
function enrichPreviewInspectorRenderTreeSnapshot(snapshot) {
  const descriptor = findSelectedPreviewInspectorDescriptor();
  if (descriptor?.inspector === undefined) return snapshot;
  const exports = readPreviewInspectorCurrentFileExports(descriptor);
  const mountedNames = new Set();
  let roots = markPreviewInspectorCurrentFileExports(snapshot.roots, exports, mountedNames);
  const context = readPreviewInspectorRenderContextEntries(descriptor);
  const mountedIndex = findPreviewInspectorMountedContextIndex(context.entries, roots);
  const prefixCount = mountedIndex ?? Math.max(0, context.entries.length - 1);
  roots = insertPreviewInspectorMountedInvocationContext(roots, context.entries, prefixCount);
  for (let index = prefixCount - 1; index >= 0; index -= 1) {
    roots = [createPreviewInspectorRenderContextNode(context.entries[index], index, roots)];
  }
  const unmountedGroup = createPreviewInspectorUnmountedExportGroup(exports, mountedNames);
  if (unmountedGroup !== undefined) roots.push(unmountedGroup);
  const expectedOutcomeExportName = readPreviewInspectorExpectedOutcomeExportName(descriptor);
  if (expectedOutcomeExportName !== undefined) {
    roots = appendPreviewInspectorExpectedOutcomes(
      roots,
      descriptor,
      expectedOutcomeExportName,
    );
  }
  const entryPath = context.entryPoint?.sourcePath;
  const workspaceRoot = {
    children: roots,
    contextOnly: true,
    edgeKind: 'workspace-render-root',
    id: 'workspace-react-render-root',
    kind: 'entry',
    name: 'Workspace React render root',
    props: {
      entryConnected: context.entryPoint !== undefined,
      mountedPageRoot: readSelectedPreviewInspectorPageCandidate(descriptor)?.root?.exportName,
    },
    source: normalizePreviewInspectorUiSource({ displayName: entryPath, path: entryPath }),
    state: undefined,
  };
  return { ...snapshot, roots: [workspaceRoot] };
}
`;
}
