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
