/**
 * Generates the isolated DevTools-style shell shown by React Page Inspector.
 *
 * The emitted browser source owns only presentation and user interaction. Live Fiber discovery and
 * editor navigation remain optional capabilities on `previewInspectorApi`, which keeps the shell
 * useful while either adapter is unavailable and prevents UI code from depending on React internals
 * or the VS Code message protocol.
 */
import { createPreviewInspectorLayoutRuntimeSource } from './previewInspectorLayoutRuntimeSource';
import { createPreviewInspectorNavigationUiRuntimeSource } from './previewInspectorNavigationUiRuntimeSource';
import { createPreviewInspectorConditionUiRuntimeSource } from './previewInspectorConditionUiRuntimeSource';
import { createPreviewInspectorComponentDebuggerUiRuntimeSource } from './previewInspectorComponentDebuggerUiRuntimeSource';
import { createPreviewInspectorConsoleUiRuntimeSource } from './previewInspectorConsoleUiRuntimeSource';
import { createPreviewInspectorDataUiRuntimeSource } from './previewInspectorDataUiRuntimeSource';
import { createPreviewInspectorHiddenElementsUiRuntimeSource } from './previewInspectorHiddenElementsUiRuntimeSource';
import { createPreviewInspectorPageCandidateUiRuntimeSource } from './previewInspectorPageCandidateUiRuntimeSource';
import { createPreviewInspectorBlockerFlowUiRuntimeSource } from './previewInspectorBlockerFlowUiRuntimeSource';
import { createPreviewInspectorBlockerUiRuntimeSource } from './previewInspectorBlockerUiRuntimeSource';
import { createPreviewInspectorRenderTreeUiRuntimeSource } from './previewInspectorRenderTreeUiRuntimeSource';
import { createPreviewInspectorRenderFlowUiRuntimeSource } from './previewInspectorRenderFlowUiRuntimeSource';
import { createPreviewInspectorRuntimeFallbackUiRuntimeSource } from './previewInspectorRuntimeFallbackUiRuntimeSource';
import { createPreviewInspectorStructureUiRuntimeSource } from './previewInspectorStructureUiRuntimeSource';
import { createPreviewInspectorTreeScrollRuntimeSource } from './previewInspectorTreeScrollRuntimeSource';
import { createPreviewInspectorTreeNodeUiRuntimeSource } from './previewInspectorTreeNodeUiRuntimeSource';
import { createPreviewInspectorWireframeUiRuntimeSource } from './previewInspectorWireframeUiRuntimeSource';
/** Source location exposed to the UI without prescribing an extension-host transport. */
export interface PreviewInspectorUiSourceLocation {
  /** Optional one-based source column. */
  readonly column?: number;
  /** Human-readable file label; collectors may omit the absolute path from this value. */
  readonly displayName?: string;
  /** Optional one-based source line. */
  readonly line?: number;
  /** Optional collector byte/character offset used to disambiguate repeated component names. */
  readonly occurrenceStart?: number;
  /** Collector-owned source identity forwarded unchanged to `openSource`. */
  readonly path?: string;
  /** Compatibility spelling emitted by static/Fiber source evidence before UI normalization. */
  readonly sourcePath?: string;
}
/** One read-only React component node accepted by the inspector UI. */
export interface PreviewInspectorUiTreeNode {
  /** Nested React component children; HTML host nodes should be omitted or marked as `host`. */
  readonly children: readonly PreviewInspectorUiTreeNode[];
  /** Render-graph certainty retained only on inert entry, route, lazy, or wrapper context nodes. */
  readonly certainty?: 'conditional' | 'confirmed';
  /** Compiler-issued condition metadata present only on editable conditional-render pseudo nodes. */
  readonly condition?: unknown;
  /** Stable compiler-issued identity present only on conditional-render pseudo nodes. */
  readonly conditionId?: string;
  /** True for data-only route/entry/group nodes that do not claim a mounted Fiber identity. */
  readonly contextOnly?: boolean;
  /** Marks a component export declared by the source file whose preview tab is pinned. */
  readonly currentFileExport?: boolean;
  /** Static render-graph relationship represented by a context-only node. */
  readonly edgeKind?: string;
  /** Export identity when the node is an instrumented editable target or ancestor root. */
  readonly exportName?: string;
  /** Stable identity for selection across collector refreshes. */
  readonly id: string;
  /** Collector classification such as `component`, `target`, `root`, or `host`. */
  readonly kind: string;
  /** Component display name shown in the tree. */
  readonly name: string;
  /** Distinguishes a live export from one retained only in the current-file inventory. */
  readonly mounted?: boolean;
  /** Mounted/dormant state supplied only for overlay components and portals. */
  readonly overlayState?: 'dormant' | 'mounted';
  /** Read-only props snapshot; only instrumented target/root props are editable. */
  readonly props?: unknown;
  /** Structural presentation role proven by the collector. */
  readonly role?: 'overlay' | 'transparent-wrapper';
  /** Source location suitable for the optional source-opening adapter. */
  readonly source?: PreviewInspectorUiSourceLocation;
  /** Read-only class, hook, or collector-defined state snapshot. */
  readonly state?: unknown;
}
/** Bounded component-tree snapshot returned by the optional live collector. */
export interface PreviewInspectorUiTreeSnapshot {
  /** React component roots currently mounted below the preview root. */
  readonly roots: readonly PreviewInspectorUiTreeNode[];
  /** Collector-selected node, when selection originated from host picking or another adapter. */
  readonly selectedId?: string;
  /** Optional collector capability or freshness note shown above the tree. */
  readonly status?: string;
  /** Whether a collector visit bound omitted deeper or later component nodes. */
  readonly truncated?: boolean;
}
/**
 * Small browser contract between the UI shell and independently implemented collector/host adapters.
 * Every method except `collectTree` is optional so static export fallback remains fully functional.
 */
export interface PreviewInspectorUiAdapter {
  /** Returns a current read-only React component tree. */
  collectTree(): PreviewInspectorUiTreeSnapshot;
  /** Mirrors a tree-row selection back into the live collector with optional export identity. */
  selectNode?(id: string, exportName?: string): void;
  /** Subscribes to React commits; returning cleanup follows React effect conventions. */
  subscribeTree?(listener: () => void): (() => void) | undefined;
}

/**
 * Creates the browser source for a bottom-docked, Elements-like React component inspector.
 *
 * Expected generated-entry bindings include `React`, the non-privileged `previewInspectorApi`, and
 * the lexical-only `previewInspectorSourceNavigation` bridge. The source renders through the
 * pre-existing Shadow DOM portal, so it introduces no wrapper into the application DOM.
 *
 * @returns Plain JavaScript source concatenated after the Page Inspector public API is installed.
 */
export function createPreviewInspectorDevtoolsUiRuntimeSource(): string {
  const conditionUiRuntimeSource = createPreviewInspectorConditionUiRuntimeSource();
  const componentDebuggerUiRuntimeSource = createPreviewInspectorComponentDebuggerUiRuntimeSource();
  const consoleUiRuntimeSource = createPreviewInspectorConsoleUiRuntimeSource();
  const dataUiRuntimeSource = createPreviewInspectorDataUiRuntimeSource();
  const hiddenElementsUiRuntimeSource = createPreviewInspectorHiddenElementsUiRuntimeSource();
  const layoutRuntimeSource = createPreviewInspectorLayoutRuntimeSource();
  const navigationUiRuntimeSource = createPreviewInspectorNavigationUiRuntimeSource();
  const pageCandidateUiRuntimeSource = createPreviewInspectorPageCandidateUiRuntimeSource();
  const blockerFlowUiRuntimeSource = createPreviewInspectorBlockerFlowUiRuntimeSource();
  const blockerUiRuntimeSource = createPreviewInspectorBlockerUiRuntimeSource();
  const renderTreeUiRuntimeSource = createPreviewInspectorRenderTreeUiRuntimeSource();
  const renderFlowUiRuntimeSource = createPreviewInspectorRenderFlowUiRuntimeSource();
  const runtimeFallbackUiRuntimeSource = createPreviewInspectorRuntimeFallbackUiRuntimeSource();
  const structureUiRuntimeSource = createPreviewInspectorStructureUiRuntimeSource();
  const treeScrollRuntimeSource = createPreviewInspectorTreeScrollRuntimeSource();
  const treeNodeUiRuntimeSource = createPreviewInspectorTreeNodeUiRuntimeSource();
  const wireframeUiRuntimeSource = createPreviewInspectorWireframeUiRuntimeSource();
  return String.raw`
${layoutRuntimeSource}
${treeScrollRuntimeSource}

${structureUiRuntimeSource}
${conditionUiRuntimeSource}
${componentDebuggerUiRuntimeSource}
${consoleUiRuntimeSource}
${dataUiRuntimeSource}
${hiddenElementsUiRuntimeSource}
${pageCandidateUiRuntimeSource}
${runtimeFallbackUiRuntimeSource}
${renderTreeUiRuntimeSource}
${blockerUiRuntimeSource}
${blockerFlowUiRuntimeSource}
${renderFlowUiRuntimeSource}
${navigationUiRuntimeSource}
${wireframeUiRuntimeSource}
/** Normalizes one source identity while leaving its opaque path untouched for source navigation. */
function normalizePreviewInspectorUiSource(source) {
  if (source === null || typeof source !== 'object') return undefined;
  const normalized = {};
  const sourcePath = typeof source.path === 'string' ? source.path : source.sourcePath;
  if (typeof sourcePath === 'string') normalized.path = sourcePath;
  if (typeof source.displayName === 'string') normalized.displayName = source.displayName;
  if (Number.isSafeInteger(source.line) && source.line > 0) normalized.line = source.line;
  if (Number.isSafeInteger(source.column) && source.column > 0) normalized.column = source.column;
  if (Number.isSafeInteger(source.occurrenceStart) && source.occurrenceStart >= 0) {
    normalized.occurrenceStart = source.occurrenceStart;
  }
  return Object.keys(normalized).length === 0 ? undefined : normalized;
}

/**
 * Promotes component descendants through omitted host records and bounds hostile or future collector
 * shapes. The shared counter prevents a broad tree from bypassing the per-branch depth ceiling.
 */
function normalizePreviewInspectorUiNodes(values, depth, counter) {
  if (!Array.isArray(values) || depth > 64 || counter.count >= 4096) return [];
  const normalized = [];
  for (const value of values) {
    if (value === null || typeof value !== 'object' || counter.count >= 4096) continue;
    const children = normalizePreviewInspectorUiNodes(value.children, depth + 1, counter);
    if (!isPreviewInspectorComponentNode(value)) {
      normalized.push(...children);
      continue;
    }
    counter.count += 1;
    const name = typeof value.name === 'string' && value.name.length > 0
      ? value.name
      : typeof value.displayName === 'string' && value.displayName.length > 0
        ? value.displayName
        : 'Anonymous';
    normalized.push({
      children,
      certainty: value.certainty === 'conditional' ? 'conditional' : value.certainty === 'confirmed' ? 'confirmed' : undefined,
      contextOnly: value.contextOnly === true,
      currentFileExport: value.currentFileExport === true,
      edgeKind: typeof value.edgeKind === 'string' ? value.edgeKind : undefined,
      exportName: typeof value.exportName === 'string' ? value.exportName : undefined,
      id: typeof value.id === 'string' && value.id.length > 0
        ? value.id
        : 'collector:' + String(counter.count),
      kind: typeof value.kind === 'string' ? value.kind : 'component',
      mounted: value.mounted === false ? false : value.mounted === true ? true : undefined,
      name,
      overlayState: value.overlayState === 'dormant' ? 'dormant' : value.overlayState === 'mounted' ? 'mounted' : undefined,
      props: value.props,
      role: value.role === 'overlay' || value.role === 'transparent-wrapper' ? value.role : undefined,
      source: normalizePreviewInspectorUiSource(value.source),
      state: value.state,
    });
  }
  return normalized;
}

/** Converts statically discovered exports into a useful component-only tree when Fiber is absent. */
function createFallbackPreviewInspectorTreeSnapshot() {
  const roots = previewInspectorSession.descriptorNames.map((exportName, index) => ({
    children: [],
    exportName,
    id: 'export:' + exportName + ':' + String(index),
    kind: exportName.startsWith('@root:') ? 'root' : 'target',
    name: formatPreviewInspectorEntryName(exportName),
    props: previewInspectorSession.basePropsByExport.get(exportName),
    source: undefined,
    state: undefined,
  }));
  return {
    roots,
    selectedId: previewInspectorSession.selectedTreeNodeId,
    status: 'Static export fallback · live component collector unavailable',
    truncated: false,
  };
}

/** Reads the optional live collector and safely falls back to the static export inventory. */
function collectPreviewInspectorUiTreeSnapshot() {
  const collectTree = previewInspectorApi.collectTree;
  if (typeof collectTree !== 'function') {
    return attachPreviewInspectorBlockersToSnapshot(
      enrichPreviewInspectorRenderTreeSnapshot(createFallbackPreviewInspectorTreeSnapshot()),
    );
  }
  try {
    const collectorSnapshot = collectTree();
    const roots = normalizePreviewInspectorUiNodes(collectorSnapshot?.roots, 0, { count: 0 });
    const baseSnapshot = roots.length === 0
      ? createFallbackPreviewInspectorTreeSnapshot()
      : {
          roots,
          selectedId:
            typeof collectorSnapshot?.selectedId === 'string'
              ? collectorSnapshot.selectedId
              : undefined,
          status:
            typeof collectorSnapshot?.status === 'string' ? collectorSnapshot.status : undefined,
          truncated: collectorSnapshot?.truncated === true,
        };
    return copyPreviewInspectorSnapshotRuntimeIndexes(
      collectorSnapshot,
      attachPreviewInspectorBlockersToSnapshot(
        enrichPreviewInspectorRenderTreeSnapshot(baseSnapshot),
      ),
    );
  } catch (error) {
    console.warn('[React Preview] Component tree collector failed.', error);
    return attachPreviewInspectorBlockersToSnapshot(
      enrichPreviewInspectorRenderTreeSnapshot(createFallbackPreviewInspectorTreeSnapshot()),
    );
  }
}

/** Locates one node without retaining a Fiber or DOM reference in React component state. */
function findPreviewInspectorUiNode(nodes, nodeId) {
  for (const node of nodes) {
    if (node.id === nodeId) return node;
    const descendant = findPreviewInspectorUiNode(node.children, nodeId);
    if (descendant !== undefined) return descendant;
  }
  return undefined;
}

/** Locates the first live or retained current-file row carrying one editable export identity. */
function findPreviewInspectorUiNodeByExport(nodes, exportName) {
  for (const node of nodes) {
    if (node.exportName === exportName) return node;
    const descendant = findPreviewInspectorUiNodeByExport(node.children, exportName);
    if (descendant !== undefined) return descendant;
  }
  return undefined;
}

/**
 * Chooses the roving-tab-stop row from nodes that are actually rendered under expanded ancestors.
 * A hidden selection must not leave the ARIA tree with every row removed from the tab sequence.
 */
function resolvePreviewInspectorTreeFocusableId(nodes, selectedId, expandedIds) {
  let firstVisibleId;
  let selectedIsVisible = false;
  const visit = (visibleNodes) => {
    for (const node of visibleNodes) {
      firstVisibleId ??= node.id;
      if (node.id === selectedId) selectedIsVisible = true;
      if (expandedIds.has(node.id)) visit(node.children);
    }
  };
  visit(nodes);
  return selectedIsVisible ? selectedId : firstVisibleId;
}

/** Finds the authored ancestor IDs required to reveal one selected component row. */
function findPreviewInspectorUiNodeAncestorIds(nodes, selectedId, ancestors = []) {
  for (const node of nodes) {
    if (node.id === selectedId) return ancestors;
    const descendantAncestors = findPreviewInspectorUiNodeAncestorIds(
      node.children,
      selectedId,
      [...ancestors, node.id],
    );
    if (descendantAncestors !== undefined) return descendantAncestors;
  }
  return undefined;
}

/** Expands only missing ancestors so picker and export selection reveal their exact tree row. */
function expandPreviewInspectorUiSelection(nodes, selectedId, expandedIds) {
  const ancestorIds = findPreviewInspectorUiNodeAncestorIds(nodes, selectedId);
  if (ancestorIds === undefined) return expandedIds;
  let next = expandedIds;
  for (const ancestorId of ancestorIds) {
    if (next.has(ancestorId)) continue;
    if (next === expandedIds) next = new Set(expandedIds);
    next.add(ancestorId);
  }
  return next;
}

/** Keeps matching components and their ancestor path while filtering the visible tree. */
function filterPreviewInspectorUiNodes(nodes, query) {
  const normalizedQuery = query.trim().toLocaleLowerCase();
  if (normalizedQuery.length === 0) return nodes;
  const filtered = [];
  for (const node of nodes) {
    const children = filterPreviewInspectorUiNodes(node.children, normalizedQuery);
    if (node.name.toLocaleLowerCase().includes(normalizedQuery) || children.length > 0) {
      filtered.push({ ...node, children });
    }
  }
  return filtered;
}

/** Returns a basename-only source label plus optional one-based line and column. */
function formatPreviewInspectorUiSource(source) {
  if (source === undefined) return 'Source metadata unavailable';
  const rawName = source.displayName ?? source.path ?? 'Unknown source';
  const fileName = String(rawName).split(/[\\/]/).at(-1) || String(rawName);
  return fileName + (source.line === undefined ? '' : ':' + String(source.line)) +
    (source.column === undefined ? '' : ':' + String(source.column));
}

/** Reports whether the selected node maps to an explicitly instrumented target or ancestor root. */
function isPreviewInspectorUiNodeEditable(node) {
  const exportName = node?.exportName;
  return typeof exportName === 'string' &&
    previewInspectorSession.descriptorNames.includes(exportName) &&
    (previewInspectorSession.basePropsByExport.has(exportName) ||
      hasPreviewInspectorSmartPropEvidence(exportName));
}

/** Commits tree selection, cancels picker hover, and makes a mounted host visible by highlight. */
function selectPreviewInspectorUiNode(node) {
  previewInspectorSession.selectedTreeNodeId = node.id;
  previewInspectorSession.pickerCandidate = undefined;
  previewInspectorSession.pickerEnabled = false;
  const canHighlight = !isPreviewInspectorBlockerNode(node) &&
    node.contextOnly !== true && node.mounted !== false;
  if (canHighlight && previewInspectorSession.highlightEnabled !== true) {
    setPreviewInspectorHighlightEnabled(true);
  }
  if (node?.blockerKind === 'data-request') {
    previewInspectorDevtoolsSessionState.selectedDataRequestId = node.blockerId;
  }
  if (
    typeof node.exportName === 'string' &&
    previewInspectorSession.descriptorNames.includes(node.exportName)
  ) {
    selectPreviewInspectorExport(node.exportName);
  } else {
    persistPreviewInspectorState();
    schedulePreviewInspectorTreeRefresh();
  }
  if (
    isPreviewInspectorBlockerNode(node) ||
    node.contextOnly === true ||
    node.mounted === false
  ) {
    previewInspectorSession.selectedTreeNodeId = node.id;
    persistPreviewInspectorState();
    schedulePreviewInspectorTreeRefresh();
    schedulePreviewInspectorHighlight();
    return;
  }
  try {
    previewInspectorApi.selectNode?.(node.id, node.exportName);
  } catch (error) {
    console.warn('[React Preview] Component tree selection adapter failed.', error);
  } finally {
    schedulePreviewInspectorHighlight();
  }
}

/** Subscribes only while expanded, with a low-frequency fallback for older collector contracts. */
function usePreviewInspectorTreeRefresh(enabled) {
  const [, setTreeRevision] = React.useState(0);
  React.useEffect(() => {
    if (!enabled) return undefined;
    const refresh = () => setTreeRevision((revision) => revision + 1);
    if (typeof previewInspectorApi.subscribeTree === 'function') {
      try {
        const unsubscribe = previewInspectorApi.subscribeTree(refresh);
        return typeof unsubscribe === 'function' ? unsubscribe : undefined;
      } catch (error) {
        console.warn('[React Preview] Component tree subscription failed.', error);
      }
    }
    const timer = setInterval(refresh, 750);
    return () => clearInterval(timer);
  }, [enabled]);
}

/** Creates one reusable toolbar button with native disabled and pressed semantics. */
function PreviewInspectorDevtoolsButton({ children, companionSource, disabled, onClick, pressed, sourceOpen, title }) {
  const companionSourcePath = companionSource?.path ?? companionSource?.sourcePath;
  return React.createElement(
    'button',
    {
      'aria-pressed': pressed,
      className: 'rpi-button',
      'data-rpi-source-column': sourceOpen === true ? companionSource?.column : undefined,
      'data-rpi-source-line': sourceOpen === true ? companionSource?.line : undefined,
      'data-rpi-source-offset': sourceOpen === true ? companionSource?.occurrenceStart : undefined,
      'data-rpi-source-path': sourceOpen === true ? companionSourcePath : undefined,
      'data-react-preview-source-open': sourceOpen === true ? 'true' : undefined,
      disabled: disabled === true,
      onClick,
      title,
      type: 'button',
    },
    children,
  );
}

/** Handles roving tree focus with the standard Elements/ARIA directional key model. */
function handlePreviewInspectorTreeKeyDown(event) {
  const row = event.target?.closest?.('[data-react-preview-tree-row]');
  if (row === null || row === undefined) return;
  if (event.target !== row) return;
  const rows = [...event.currentTarget.querySelectorAll('[data-react-preview-tree-row]')];
  const rowIndex = rows.indexOf(row);
  if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
    event.preventDefault();
    const offset = event.key === 'ArrowDown' ? 1 : -1;
    rows[Math.min(rows.length - 1, Math.max(0, rowIndex + offset))]?.focus();
    return;
  }
  if (event.key === 'Enter' || event.key === ' ') {
    event.preventDefault();
    capturePreviewInspectorTreeSelectionScroll(event.currentTarget);
    row.click();
    return;
  }
  if (event.key === 'ArrowRight') {
    const toggle = row.parentElement?.querySelector?.(':scope > [data-react-preview-tree-toggle]');
    if (row.getAttribute('aria-expanded') === 'false') {
      event.preventDefault();
      toggle?.click();
    } else if (row.getAttribute('aria-expanded') === 'true') {
      event.preventDefault();
      rows[rowIndex + 1]?.focus();
    }
    return;
  }
  if (event.key === 'ArrowLeft') {
    if (row.getAttribute('aria-expanded') === 'true') {
      event.preventDefault();
      row.parentElement?.querySelector?.(':scope > [data-react-preview-tree-toggle]')?.click();
      return;
    }
    const parentGroup = row.parentElement?.closest?.('[role="group"]');
    const parentRow = parentGroup?.parentElement?.querySelector?.(
      ':scope > [data-react-preview-tree-row]',
    );
    if (parentRow !== undefined && parentRow !== null) {
      event.preventDefault();
      parentRow.focus();
    }
  }
}

${treeNodeUiRuntimeSource}

/** Scrolls only the tree viewport, preventing a row selection from moving the preview document. */
function revealPreviewInspectorTreeRow(treeViewport, row) {
  const viewportBounds = treeViewport?.getBoundingClientRect?.();
  const rowBounds = row?.getBoundingClientRect?.();
  if (viewportBounds === undefined || rowBounds === undefined) return;
  if (rowBounds.top < viewportBounds.top) {
    treeViewport.scrollTop = Math.max(0, treeViewport.scrollTop + rowBounds.top - viewportBounds.top);
  } else if (rowBounds.bottom > viewportBounds.bottom) {
    treeViewport.scrollTop += rowBounds.bottom - viewportBounds.bottom;
  }
  if (rowBounds.left < viewportBounds.left) {
    treeViewport.scrollLeft = Math.max(0, treeViewport.scrollLeft + rowBounds.left - viewportBounds.left);
  } else if (rowBounds.right > viewportBounds.right) {
    treeViewport.scrollLeft += rowBounds.right - viewportBounds.right;
  }
  rememberPreviewInspectorTreeScrollPosition(treeViewport);
}

/** Renders the searchable React Components pane and owns only visual expansion state. */
function PreviewInspectorComponentsPane({ roots, selectedId, status, truncated }) {
  const [query, setQuery] = React.useState(() => previewInspectorDevtoolsSessionState.query);
  const [expandedIds, setExpandedIds] = React.useState(() =>
    expandPreviewInspectorUiSelection(
      roots,
      selectedId,
      new Set(roots.map((node) => node.id)),
    ),
  );
  const treeScrollRef = React.useRef(null);
  const treeRevealRevision = previewInspectorDevtoolsSessionState.treeRevealRevision ?? 0;
  const filteredRoots = filterPreviewInspectorUiNodes(roots, query);
  const focusableId = resolvePreviewInspectorTreeFocusableId(
    filteredRoots,
    selectedId,
    expandedIds,
  );
  React.useLayoutEffect(() => {
    setExpandedIds((current) => expandPreviewInspectorUiSelection(roots, selectedId, current));
  }, [roots, selectedId]);
  React.useLayoutEffect(() => {
    const frame = schedulePreviewInspectorTreeScrollRestoration(treeScrollRef.current);
    return () => cancelAnimationFrame(frame);
  });
  React.useEffect(() => {
    const revealRequested = consumePreviewInspectorTreeReveal(selectedId);
    if (revealRequested) {
      previewInspectorDevtoolsSessionState.query = '';
      setQuery('');
      persistPreviewInspectorState();
    }
    if (!revealRequested) return undefined;
    const frame = requestAnimationFrame(() => {
      const rows = treeScrollRef.current?.querySelectorAll?.('[data-react-preview-tree-row]') ?? [];
      const selectedRow = [...rows].find(
        (row) => row.getAttribute('data-react-preview-tree-row') === selectedId,
      );
      revealPreviewInspectorTreeRow(treeScrollRef.current, selectedRow);
    });
    return () => cancelAnimationFrame(frame);
  }, [query, selectedId, treeRevealRevision]);
  React.useEffect(() => {
    if (query.trim().length === 0) return;
    const expanded = new Set();
    const visit = (nodes) => {
      for (const node of nodes) {
        if (node.children.length > 0) expanded.add(node.id);
        visit(node.children);
      }
    };
    visit(filteredRoots);
    setExpandedIds(expanded);
  }, [query]);
  return React.createElement(
    'section',
    { 'aria-label': 'Page component tree', className: 'rpi-pane' },
    React.createElement(
      'div',
      { className: 'rpi-pane-heading' },
      React.createElement('span', { className: 'rpi-pane-title' }, 'Page component tree'),
      React.createElement(
        'span',
        { className: 'rpi-meta', title: status },
        truncated ? 'bounded tree' : status ?? 'live tree',
      ),
      React.createElement('input', {
        'aria-label': 'Filter React components',
        className: 'rpi-search',
        onChange: (event) => {
          previewInspectorDevtoolsSessionState.query = event.target.value;
          setQuery(event.target.value);
        },
        placeholder: 'Find a component',
        type: 'search',
        value: query,
      }),
    ),
    React.createElement(
      'div',
      {
        className: 'rpi-tree-scroll',
        'data-rpi-scroll-key': 'components-tree',
        onKeyDown: handlePreviewInspectorTreeKeyDown,
        onPointerDownCapture: (event) => {
          const row = event.target?.closest?.('[data-react-preview-tree-row]');
          if (row === null || row === undefined) return;
          capturePreviewInspectorTreeSelectionScroll(treeScrollRef.current);
        },
        onScroll: () => rememberPreviewInspectorTreeScrollPosition(treeScrollRef.current),
        ref: treeScrollRef,
      },
      filteredRoots.length === 0
        ? React.createElement('div', { className: 'rpi-empty' }, 'No matching React components.')
        : React.createElement(
            'ul',
            { 'aria-label': 'Mounted React component tree', className: 'rpi-tree', role: 'tree' },
            filteredRoots.map((node) => React.createElement(PreviewInspectorComponentTreeNode, {
              expandedIds,
              focusableId,
              key: node.id,
              node,
              selectedId,
              setExpandedIds,
            })),
          ),
    ),
  );
}

/** Renders collector state as an explicitly read-only snapshot. */
function PreviewInspectorStateDetail({ node }) {
  return React.createElement(
    'div',
    { className: 'rpi-detail-content' },
    React.createElement('div', { className: 'rpi-meta' }, 'Read-only component state / hooks snapshot'),
    React.createElement('pre', { className: 'rpi-json' }, stringifyPreviewInspectorProps(node?.state ?? {})),
    React.createElement(
      'div',
      { className: 'rpi-note' },
      'Internal hook state uses the page UI or a source edit; React exposes no stable hook-slot mutation API.',
    ),
  );
}

/** Delegates a real source-button click through the lexical-only privileged navigation bridge. */
function PreviewInspectorSourceDetail({ node }) {
  const source = node?.source;
  const canOpen =
    source !== undefined && typeof previewInspectorSourceNavigation.openSource === 'function';
  const openSource = (event) => {
    if (!canOpen) return;
    try {
      previewInspectorSourceNavigation.openSource(source, event.nativeEvent, event.currentTarget);
    } catch (error) {
      console.warn('[React Preview] Source opening adapter failed.', error);
    }
  };
  return React.createElement(
    'div',
    { className: 'rpi-detail-content' },
    React.createElement(
      'div',
      { className: 'rpi-source-card' },
      React.createElement('strong', undefined, formatPreviewInspectorUiSource(source)),
      React.createElement('div', { className: 'rpi-note' }, source === undefined
        ? 'The component collector did not provide a source location.'
        : 'Source identity is forwarded to the editor adapter without UI transport coupling.'),
      React.createElement(
        'div',
        { className: 'rpi-actions' },
        React.createElement(
          PreviewInspectorDevtoolsButton,
          {
            disabled: !canOpen,
            companionSource: source,
            onClick: openSource,
            sourceOpen: true,
          },
          canOpen ? 'Open source' : 'Source unavailable',
        ),
      ),
    ),
  );
}

/** Renders either one explicit blocker editor or the selected-component debugger and console. */
function PreviewInspectorDetailsPane({ node }) {
  const blockerSelected = isPreviewInspectorBlockerNode(node);
  const initialDetailsTab = blockerSelected
    ? 'blocker'
    : previewInspectorDevtoolsSessionState.detailsTab === 'console' ? 'console' : 'component';
  const [detailsTab, setDetailsTab] = React.useState(initialDetailsTab);
  React.useEffect(() => {
    const nextTab = blockerSelected ? 'blocker' : detailsTab === 'blocker' ? 'component' : detailsTab;
    previewInspectorDevtoolsSessionState.detailsTab = nextTab;
    setDetailsTab(nextTab);
    persistPreviewInspectorState();
  }, [node?.id, blockerSelected]);
  const tabs = [
    [blockerSelected ? 'blocker' : 'component', blockerSelected ? 'Fix selected blocker' : 'Component debugger'],
    ['console', 'Console (' + String(readPreviewInspectorConsoleEntries().length) + ')'],
  ];
  return React.createElement(
    'section',
    { 'aria-label': 'Component details', className: 'rpi-pane' },
    React.createElement(
      'div',
      { className: 'rpi-pane-heading' },
      React.createElement('span', { className: 'rpi-pane-title' }, node?.name ?? 'Component details'),
      React.createElement(
        'div',
        { 'aria-label': 'Component detail views', className: 'rpi-tabs', role: 'tablist' },
        tabs.map(([id, label]) => React.createElement(
          'button',
          {
            'aria-controls': 'react-preview-details-' + id + '-panel',
            'aria-selected': detailsTab === id,
            className: 'rpi-tab',
            id: 'react-preview-details-' + id + '-tab',
            key: id,
            onClick: () => {
              previewInspectorDevtoolsSessionState.detailsTab = id;
              setDetailsTab(id);
              persistPreviewInspectorState();
            },
            role: 'tab',
            type: 'button',
          },
          label,
        )),
      ),
    ),
    React.createElement(
      'div',
      {
        'aria-labelledby': 'react-preview-details-' + detailsTab + '-tab',
        className: 'rpi-detail-scroll',
        id: 'react-preview-details-' + detailsTab + '-panel',
        role: 'tabpanel',
      },
      detailsTab === 'blocker' && blockerSelected
        ? React.createElement(PreviewInspectorBlockerDetail, { node })
        : detailsTab === 'console'
          ? React.createElement(PreviewInspectorConsoleDetail)
          : node === undefined
            ? React.createElement('div', { className: 'rpi-empty' }, 'Select a React component to debug it.')
            : React.createElement(PreviewInspectorComponentDebuggerDetail, { node }),
    ),
  );
}

/** Renders the picker/highlight toolbar inside a resizable drawer or movable floating shell. */
function PreviewInspectorToolbar() {
  usePreviewInspectorStore();
  React.useEffect(schedulePreviewInspectorCompanionSnapshot);
  const [collapsed, setCollapsed] = React.useState(
    () => previewInspectorDevtoolsSessionState.collapsed,
  );
  const [wireframeVisible, setWireframeVisible] = React.useState(
    () => previewInspectorDevtoolsSessionState.wireframeVisible !== false,
  );
  usePreviewInspectorTreeRefresh(!collapsed || wireframeVisible);
  const { layout, persistLayout, updateLayout } = usePreviewInspectorLayout();
  const snapshot = collectPreviewInspectorUiTreeSnapshot();
  const blockerFlow = createPreviewInspectorRenderFlow(snapshot);
  const collectorSelectedId = snapshot.selectedId;
  const selectedTreeNodeId = previewInspectorSession.selectedTreeNodeId ?? collectorSelectedId;
  const selectedNode = findPreviewInspectorUiNode(snapshot.roots, selectedTreeNodeId) ??
    findPreviewInspectorUiNodeByExport(
      snapshot.roots,
      previewInspectorSession.selectedExportName,
    ) ?? snapshot.roots[0];
  const selectedId = selectedNode?.id;
  const editable = isPreviewInspectorUiNodeEditable(selectedNode);
  const mainComponentName = readPreviewInspectorMainComponentName();
  const fallbackValuesEnabled = readPreviewInspectorFallbackValuesEnabled();
  const dataAutoEnabled = readPreviewInspectorDataAutoEnabled();
  const runtimeFallbackCount = readPreviewInspectorRuntimeFallbacks().length;
  const pageContext = readPreviewInspectorPageContext();
  return React.createElement(
    React.Fragment,
    undefined,
    React.createElement('style', undefined, previewInspectorDevtoolsCss),
    React.createElement(PreviewInspectorWireframeLayer, {
      enabled: wireframeVisible,
      onSelectBlocker: (node) => revealPreviewInspectorWireframeBlocker(node, setCollapsed),
      snapshot,
    }),
    React.createElement(
      'aside',
      {
        'aria-label': 'React Page Inspector',
        className: 'rpi-shell',
        'data-collapsed': collapsed,
        'data-dock': layout.dock,
        ref: setPreviewInspectorCompanionShell,
        style: createPreviewInspectorShellStyle(layout, collapsed),
      },
      React.createElement(PreviewInspectorResizeHandle, {
        collapsed,
        layout,
        persistLayout,
        updateLayout,
      }),
      React.createElement(
        'div',
        { 'aria-label': 'React Page Inspector tools', className: 'rpi-toolbar', role: 'toolbar' },
        React.createElement(PreviewInspectorMoveHandle, {
          layout,
          persistLayout,
          updateLayout,
        }),
        React.createElement('span', { className: 'rpi-title' }, 'React Page Inspector'),
        React.createElement(
          PreviewInspectorDevtoolsButton,
          {
            disabled: mainComponentName === undefined,
            onClick: selectPreviewInspectorMainComponent,
            title: "Go to the current file's main component",
          },
          'Current file',
        ),
        React.createElement(
          PreviewInspectorDevtoolsButton,
          {
            onClick: () => setPreviewInspectorPickerEnabled(!previewInspectorSession.pickerEnabled),
            pressed: previewInspectorSession.pickerEnabled,
            title: 'Pick a rendered element',
          },
          previewInspectorSession.pickerEnabled ? 'Cancel pick' : 'Pick on page',
        ),
        React.createElement(PreviewInspectorHiddenElementControls),
        React.createElement(
          PreviewInspectorDevtoolsButton,
          {
            onClick: () => setPreviewInspectorHighlightEnabled(!previewInspectorSession.highlightEnabled),
            pressed: previewInspectorSession.highlightEnabled,
            title: 'Toggle selected target highlight',
          },
          'Highlight',
        ),
        React.createElement(
          PreviewInspectorDevtoolsButton,
          {
            onClick: () => {
              const next = !wireframeVisible;
              previewInspectorDevtoolsSessionState.wireframeVisible = next;
              setWireframeVisible(next);
              persistPreviewInspectorState();
            },
            pressed: wireframeVisible,
            title: 'Toggle the full-page React component placement wireframe',
          },
          'Wireframe',
        ),
        React.createElement(
          PreviewInspectorDevtoolsButton,
          {
            onClick: () => setPreviewInspectorFallbackValuesEnabled(!fallbackValuesEnabled),
            pressed: fallbackValuesEnabled,
            title: 'Toggle preview-generated fallback prop values',
          },
          'Auto values',
        ),
        runtimeFallbackCount > 0
          ? React.createElement(
              'span',
              { className: 'rpi-meta', title: 'Render-blocking hook edges replaced by generated static values' },
              'Fallbacks: ' + String(runtimeFallbackCount),
            )
          : undefined,
        React.createElement(
          PreviewInspectorDevtoolsButton,
          {
            onClick: () => setPreviewInspectorDataAutoEnabled(!dataAutoEnabled),
            pressed: dataAutoEnabled,
            title: 'Toggle inferred no-network API and GraphQL payloads',
          },
          'Auto payloads',
        ),
        React.createElement('select', {
          'aria-label': 'Instrumented target export',
          className: 'rpi-select',
          onChange: (event) => selectPreviewInspectorExport(event.target.value),
          value: previewInspectorSession.selectedExportName,
        }, previewInspectorSession.descriptorNames.map((name) => React.createElement(
          'option',
          { key: name, value: name },
          formatPreviewInspectorEntryName(name),
        ))),
        React.createElement(
          PreviewInspectorDevtoolsButton,
          {
            disabled: !editable,
            onClick: () => remountPreviewInspectorExport(selectedNode.exportName),
            title: editable ? 'Remount the instrumented component' : 'Only instrumented targets can remount',
          },
          'Remount',
        ),
        React.createElement('span', { className: 'rpi-meta', title: previewInspectorSession.highlightStatus }, previewInspectorSession.highlightStatus),
        React.createElement('span', { className: 'rpi-spacer' }),
        React.createElement(PreviewInspectorLayoutSelect, {
          layout,
          persistLayout,
          updateLayout,
        }),
        React.createElement(
          PreviewInspectorDevtoolsButton,
          {
            onClick: () => setCollapsed((current) => {
              const next = !current;
              previewInspectorDevtoolsSessionState.collapsed = next;
              persistPreviewInspectorState();
              return next;
            }),
            title: collapsed ? 'Expand inspector' : 'Collapse inspector',
          },
          collapsed ? 'Expand' : 'Collapse',
        ),
      ),
      React.createElement(
        'div',
        {
          'aria-label': 'Rendered page component context',
          className: 'rpi-page-context',
          'data-context-kind': pageContext.kind,
          title: pageContext.breadcrumb + ' · ' + pageContext.detail,
        },
        React.createElement('span', { className: 'rpi-context-badge' }, pageContext.badge),
        React.createElement('span', { className: 'rpi-context-path' }, pageContext.breadcrumb),
        React.createElement('span', { className: 'rpi-context-detail' }, pageContext.detail),
        React.createElement(PreviewInspectorPageCandidateSelect, {
          descriptor: findSelectedPreviewInspectorDescriptor(),
        }),
      ),
      React.createElement(
        'div',
        { className: 'rpi-workbench' },
        React.createElement(PreviewInspectorNavigationPane, {
          flow: blockerFlow,
          roots: snapshot.roots,
          selectedId,
          status: snapshot.status,
          truncated: snapshot.truncated,
        }),
        React.createElement(PreviewInspectorDetailsPane, {
          key: 'details:' + String(previewInspectorDevtoolsSessionState.blockerDetailRevision ?? 0),
          node: selectedNode,
        }),
      ),
    ),
  );
}

/** Mounts Inspector chrome through a portal and keeps transient observers aligned with hot reload. */
function PreviewPageInspectorShell({ descriptors, children }) {
  const [portalHost] = React.useState(createPreviewInspectorPortalHost);
  React.useEffect(() => {
    setPreviewInspectorDescriptors(descriptors);
    const removeObservers = installPreviewInspectorDomObservers();
    return () => {
      removeObservers();
      portalHost.remove();
    };
  }, [descriptors, portalHost]);
  const toolbar = React.createElement(PreviewInspectorToolbar);
  const portal = typeof ReactDOMNamespace.createPortal === 'function'
    ? ReactDOMNamespace.createPortal(
        toolbar,
        portalHost.__reactPreviewInspectorPortalRoot ?? portalHost,
      )
    : null;
  return React.createElement(React.Fragment, undefined, children, portal);
}
`;
}
