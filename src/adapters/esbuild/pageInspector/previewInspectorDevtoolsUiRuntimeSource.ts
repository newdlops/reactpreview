/**
 * Generates the isolated DevTools-style shell shown by React Page Inspector.
 *
 * The emitted browser source owns only presentation and user interaction. Live Fiber discovery and
 * editor navigation remain optional capabilities on `previewInspectorApi`, which keeps the shell
 * useful while either adapter is unavailable and prevents UI code from depending on React internals
 * or the VS Code message protocol.
 */
import { createPreviewInspectorLayoutRuntimeSource } from './previewInspectorLayoutRuntimeSource';
import { createPreviewInspectorConditionUiRuntimeSource } from './previewInspectorConditionUiRuntimeSource';
import { createPreviewInspectorConsoleUiRuntimeSource } from './previewInspectorConsoleUiRuntimeSource';
import { createPreviewInspectorDataUiRuntimeSource } from './previewInspectorDataUiRuntimeSource';
import { createPreviewInspectorPageCandidateUiRuntimeSource } from './previewInspectorPageCandidateUiRuntimeSource';
import { createPreviewInspectorRuntimeFallbackUiRuntimeSource } from './previewInspectorRuntimeFallbackUiRuntimeSource';
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
  /** Compiler-issued condition metadata present only on editable conditional-render pseudo nodes. */
  readonly condition?: unknown;
  /** Stable compiler-issued identity present only on conditional-render pseudo nodes. */
  readonly conditionId?: string;
  /** Export identity when the node is an instrumented editable target or ancestor root. */
  readonly exportName?: string;
  /** Stable identity for selection across collector refreshes. */
  readonly id: string;
  /** Collector classification such as `component`, `target`, `root`, or `host`. */
  readonly kind: string;
  /** Component display name shown in the tree. */
  readonly name: string;
  /** Read-only props snapshot; only instrumented target/root props are editable. */
  readonly props?: unknown;
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
  /** Mirrors a tree-row selection back into the live collector. */
  selectNode?(id: string): void;
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
  const consoleUiRuntimeSource = createPreviewInspectorConsoleUiRuntimeSource();
  const dataUiRuntimeSource = createPreviewInspectorDataUiRuntimeSource();
  const layoutRuntimeSource = createPreviewInspectorLayoutRuntimeSource();
  const pageCandidateUiRuntimeSource = createPreviewInspectorPageCandidateUiRuntimeSource();
  const runtimeFallbackUiRuntimeSource = createPreviewInspectorRuntimeFallbackUiRuntimeSource();
  return String.raw`
${layoutRuntimeSource}

${conditionUiRuntimeSource}
${consoleUiRuntimeSource}
${dataUiRuntimeSource}
${pageCandidateUiRuntimeSource}
${runtimeFallbackUiRuntimeSource}
/**
 * Collector kinds that identify authored or declarative React component boundaries.
 *
 * Component and entry kinds retain static render-chain evidence whose syntax analysis cannot safely
 * distinguish functions from classes. A root kind is handled separately because React's private host
 * root Fiber uses the same broad label as the Inspector's explicitly instrumented authored root.
 */
const previewInspectorComponentKinds = new Set([
  'class',
  'component',
  'context',
  'entry',
  'forward-ref',
  'function',
  'lazy',
  'memo',
  'suspense',
  'target',
]);

/** Returns whether a collector node is an authored React component rather than an internal Fiber. */
function isPreviewInspectorComponentNode(node) {
  const kind = typeof node?.kind === 'string' ? node.kind.toLowerCase() : 'component';
  if (node?.isHost === true) return false;
  if (kind === 'root') {
    return typeof node?.exportName === 'string' && node.exportName.length > 0;
  }
  return previewInspectorComponentKinds.has(kind);
}

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
      exportName: typeof value.exportName === 'string' ? value.exportName : undefined,
      id: typeof value.id === 'string' && value.id.length > 0
        ? value.id
        : 'collector:' + String(counter.count),
      kind: typeof value.kind === 'string' ? value.kind : 'component',
      name,
      props: value.props,
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
    return attachPreviewInspectorConditionsToSnapshot(createFallbackPreviewInspectorTreeSnapshot());
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
    return attachPreviewInspectorConditionsToSnapshot(baseSnapshot);
  } catch (error) {
    console.warn('[React Preview] Component tree collector failed.', error);
    return attachPreviewInspectorConditionsToSnapshot(createFallbackPreviewInspectorTreeSnapshot());
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
    previewInspectorSession.basePropsByExport.has(exportName) &&
    previewInspectorSession.descriptorNames.includes(exportName);
}

/** Commits tree selection locally, synchronizes editable exports, and informs an optional collector. */
function selectPreviewInspectorUiNode(node) {
  previewInspectorSession.selectedTreeNodeId = node.id;
  if (
    typeof node.exportName === 'string' &&
    previewInspectorSession.descriptorNames.includes(node.exportName)
  ) {
    selectPreviewInspectorExport(node.exportName);
  } else {
    persistPreviewInspectorState();
    notifyPreviewInspector();
  }
  if (isPreviewInspectorConditionNode(node)) return;
  try {
    previewInspectorApi.selectNode?.(node.id);
  } catch (error) {
    console.warn('[React Preview] Component tree selection adapter failed.', error);
  }
}

/** Subscribes to collector commits or uses a low-frequency fallback refresh for read-only snapshots. */
function usePreviewInspectorTreeRefresh() {
  const [, setTreeRevision] = React.useState(0);
  React.useEffect(() => {
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
  }, []);
}

/** Creates one reusable toolbar button with native disabled and pressed semantics. */
function PreviewInspectorDevtoolsButton({ children, disabled, onClick, pressed, sourceOpen, title }) {
  return React.createElement(
    'button',
    {
      'aria-pressed': pressed,
      className: 'rpi-button',
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

/** Renders one component-only tree branch with target and selection badges. */
function PreviewInspectorComponentTreeNode({
  expandedIds,
  focusableId,
  node,
  selectedId,
  setExpandedIds,
}) {
  const hasChildren = node.children.length > 0;
  const expanded = hasChildren && expandedIds.has(node.id);
  const selected = node.id === selectedId;
  const isCondition = isPreviewInspectorConditionNode(node);
  const conditionEnabled = node.condition?.effectiveEnabled === true;
  const conditionForced = typeof node.condition?.override === 'boolean';
  const isTarget = node.kind === 'target' || node.exportName === previewInspectorSession.selectedExportName;
  const toggle = () => {
    if (!hasChildren) return;
    setExpandedIds((current) => {
      const next = new Set(current);
      if (next.has(node.id)) next.delete(node.id); else next.add(node.id);
      return next;
    });
  };
  return React.createElement(
    'li',
    { role: 'none' },
    React.createElement('button', {
      'aria-label': (expanded ? 'Collapse ' : 'Expand ') + node.name,
      'data-react-preview-tree-toggle': node.id,
      hidden: true,
      onClick: toggle,
      tabIndex: -1,
      type: 'button',
    }),
    React.createElement(
      'button',
      {
        'aria-expanded': hasChildren ? expanded : undefined,
        'aria-selected': selected,
        className: 'rpi-tree-row' + (isCondition ? ' rpi-condition-row' : ''),
        'data-render-condition': isCondition ? 'true' : undefined,
        'data-react-preview-tree-row': node.id,
        onClick: () => {
          selectPreviewInspectorUiNode(node);
          if (isCondition) togglePreviewInspectorRenderCondition(node.conditionId);
        },
        onDoubleClick: toggle,
        role: 'treeitem',
        tabIndex: node.id === focusableId ? 0 : -1,
        title: isCondition ? node.name + ' · click to toggle branch' : node.name,
        type: 'button',
      },
      React.createElement(
        'span',
        {
          'aria-hidden': true,
          className: 'rpi-twisty',
          'data-expandable': hasChildren,
          onClick: (event) => {
            if (!hasChildren) return;
            event.preventDefault();
            event.stopPropagation();
            toggle();
          },
          title: hasChildren ? (expanded ? 'Collapse component' : 'Expand component') : undefined,
        },
        hasChildren ? (expanded ? '▾' : '▸') : '',
      ),
      React.createElement(
        'span',
        { 'aria-hidden': true, className: 'rpi-component-icon' },
        isCondition ? '◐' : '◇',
      ),
      React.createElement('span', { className: 'rpi-node-name' }, node.name),
      selected ? React.createElement('span', { className: 'rpi-badge' }, 'selected') : null,
      isTarget ? React.createElement('span', { className: 'rpi-badge' }, 'target') : null,
      isCondition
        ? React.createElement(
            'span',
            { className: 'rpi-badge' },
            (conditionEnabled ? 'on' : 'off') + (conditionForced ? ' · forced' : ''),
          )
        : null,
    ),
    expanded
      ? React.createElement(
          'ul',
          { className: 'rpi-tree-group', role: 'group' },
          node.children.map((child) => React.createElement(PreviewInspectorComponentTreeNode, {
            expandedIds,
            focusableId,
            key: child.id,
            node: child,
            selectedId,
            setExpandedIds,
          })),
        )
      : null,
  );
}

/** Renders the searchable React Components pane and owns only visual expansion state. */
function PreviewInspectorComponentsPane({ roots, selectedId, status, truncated }) {
  const [query, setQuery] = React.useState(() => previewInspectorDevtoolsSessionState.query);
  const [expandedIds, setExpandedIds] = React.useState(() => new Set(roots.map((node) => node.id)));
  const treeScrollRef = React.useRef(null);
  const filteredRoots = filterPreviewInspectorUiNodes(roots, query);
  const focusableId = resolvePreviewInspectorTreeFocusableId(
    filteredRoots,
    selectedId,
    expandedIds,
  );
  React.useEffect(() => {
    setExpandedIds((current) => expandPreviewInspectorUiSelection(roots, selectedId, current));
    const frame = requestAnimationFrame(() => {
      const rows = treeScrollRef.current?.querySelectorAll?.('[data-react-preview-tree-row]') ?? [];
      const selectedRow = [...rows].find(
        (row) => row.getAttribute('data-react-preview-tree-row') === selectedId,
      );
      selectedRow?.scrollIntoView?.({ block: 'nearest', inline: 'nearest' });
    });
    return () => cancelAnimationFrame(frame);
  }, [selectedId]);
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
    { 'aria-label': 'React Components', className: 'rpi-pane' },
    React.createElement(
      'div',
      { className: 'rpi-pane-heading' },
      React.createElement('span', { className: 'rpi-pane-title' }, 'React Components'),
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
        placeholder: 'Filter components',
        type: 'search',
        value: query,
      }),
    ),
    React.createElement(
      'div',
      {
        className: 'rpi-tree-scroll',
        onKeyDown: handlePreviewInspectorTreeKeyDown,
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

/** Reads generated-value provenance for one editable selected target. */
function readSelectedPreviewInspectorInferredProps(exportName) {
  for (const descriptor of previewInspectorSession.descriptors) {
    const targetName = descriptor?.inspector?.target?.exportName ?? descriptor?.exportName;
    if (targetName !== exportName) continue;
    const inferredProps = descriptor?.inspector?.targetInferredProps ?? descriptor?.inferredProps;
    return Array.isArray(inferredProps) ? inferredProps : [];
  }
  return [];
}

/** Renders editable target/root props or a clearly read-only arbitrary Fiber snapshot. */
function PreviewInspectorPropsDetail({ node }) {
  const editable = isPreviewInspectorUiNodeEditable(node);
  const exportName = editable ? node.exportName : undefined;
  const baseProps = exportName === undefined
    ? normalizePreviewInspectorProps(node?.props ?? {})
    : previewInspectorSession.basePropsByExport.get(exportName) ?? {};
  const overrideProps = exportName === undefined
    ? {}
    : previewInspectorSession.overridesByExport.get(exportName) ?? {};
  const effectiveProps = editable ? { ...baseProps, ...overrideProps } : baseProps;
  const inferredProps = exportName === undefined ? [] : readSelectedPreviewInspectorInferredProps(exportName);
  const draftKey = (node?.id ?? '') + ':' + stringifyPreviewInspectorProps(effectiveProps);
  const [draftText, setDraftText] = React.useState(() => stringifyPreviewInspectorProps(effectiveProps));
  const [draftError, setDraftError] = React.useState('');
  React.useEffect(() => {
    setDraftText(stringifyPreviewInspectorProps(effectiveProps));
    setDraftError('');
  }, [draftKey]);
  const applyDraft = () => {
    if (!editable || exportName === undefined) return;
    try {
      const value = JSON.parse(draftText);
      if (value === null || typeof value !== 'object' || Array.isArray(value)) {
        throw new TypeError('Props JSON must be an object.');
      }
      setPreviewInspectorPropsOverride(exportName, value);
      setDraftError('');
    } catch (error) {
      setDraftError(error instanceof Error ? error.message : String(error));
    }
  };
  return React.createElement(
    'div',
    { className: 'rpi-detail-content' },
    React.createElement('div', { className: 'rpi-meta' }, editable
      ? 'Editable instrumented target/root props'
      : 'Read-only Fiber props snapshot'),
    React.createElement('textarea', {
      'aria-label': editable ? 'Editable component props JSON' : 'Read-only component props JSON',
      className: 'rpi-json',
      onChange: editable ? (event) => setDraftText(event.target.value) : undefined,
      readOnly: !editable,
      spellCheck: false,
      value: draftText,
    }),
    draftError.length > 0 ? React.createElement('div', { className: 'rpi-error' }, draftError) : null,
    editable
      ? React.createElement(
          'div',
          { className: 'rpi-actions' },
          React.createElement(PreviewInspectorDevtoolsButton, { onClick: applyDraft }, 'Apply props'),
          React.createElement(
            PreviewInspectorDevtoolsButton,
            { onClick: () => resetPreviewInspectorPropsOverride(exportName) },
            'Reset props',
          ),
        )
      : null,
    inferredProps.length > 0
      ? React.createElement('div', { className: 'rpi-note' }, 'Auto-generated preview values: ' + inferredProps
          .map((item) => String(item.path) + ' (' + String(item.kind) + ')').join(', '))
      : null,
    React.createElement('div', { className: 'rpi-note' }, editable
      ? 'Changes remount only the instrumented export and preserve its surrounding page.'
      : 'Arbitrary Fiber props are observational and cannot be safely rewritten.'),
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
            onClick: openSource,
            sourceOpen: true,
          },
          canOpen ? 'Open source' : 'Source unavailable',
        ),
      ),
    ),
  );
}

/** Renders component details and the page-wide editable backend payload inventory. */
function PreviewInspectorDetailsPane({ node }) {
  const [activeTab, setActiveTab] = React.useState(
    () => previewInspectorDevtoolsSessionState.activeTab,
  );
  const tabs = [
    ['props', 'Props'],
    ['state', 'State'],
    ['source', 'Source'],
    ['payloads', 'Payloads'],
    ['fallbacks', 'Fallbacks (' + String(readPreviewInspectorRuntimeFallbacks().length) + ')'],
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
            'aria-controls': 'react-preview-inspector-' + id + '-panel',
            'aria-selected': activeTab === id,
            className: 'rpi-tab',
            id: 'react-preview-inspector-' + id + '-tab',
            key: id,
            onClick: () => {
              previewInspectorDevtoolsSessionState.activeTab = id;
              setActiveTab(id);
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
        'aria-labelledby': 'react-preview-inspector-' + activeTab + '-tab',
        className: 'rpi-detail-scroll',
        id: 'react-preview-inspector-' + activeTab + '-panel',
        role: 'tabpanel',
      },
      activeTab === 'payloads'
        ? React.createElement(PreviewInspectorDataDetail)
        : activeTab === 'fallbacks'
          ? React.createElement(PreviewInspectorRuntimeFallbackDetail)
        : activeTab === 'console'
          ? React.createElement(PreviewInspectorConsoleDetail)
          : node === undefined
            ? React.createElement('div', { className: 'rpi-empty' }, 'Select a React component to inspect it.')
            : activeTab === 'state'
              ? React.createElement(PreviewInspectorStateDetail, { node })
              : activeTab === 'source'
                ? React.createElement(PreviewInspectorSourceDetail, { node })
                : isPreviewInspectorConditionNode(node)
                  ? React.createElement(PreviewInspectorConditionDetail, { node })
                  : React.createElement(PreviewInspectorPropsDetail, { node }),
    ),
  );
}

/** Renders the picker/highlight toolbar inside a resizable drawer or movable floating shell. */
function PreviewInspectorToolbar() {
  usePreviewInspectorStore();
  usePreviewInspectorTreeRefresh();
  const [collapsed, setCollapsed] = React.useState(
    () => previewInspectorDevtoolsSessionState.collapsed,
  );
  const { layout, persistLayout, updateLayout } = usePreviewInspectorLayout();
  const snapshot = collectPreviewInspectorUiTreeSnapshot();
  const collectorSelectedId = snapshot.selectedId;
  const selectedTreeNodeId = previewInspectorSession.selectedTreeNodeId ?? collectorSelectedId;
  const selectedNode = findPreviewInspectorUiNode(snapshot.roots, selectedTreeNodeId) ??
    findPreviewInspectorUiNode(
      snapshot.roots,
      snapshot.roots.find((node) => node.exportName === previewInspectorSession.selectedExportName)?.id,
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
    React.createElement(
      'aside',
      {
        'aria-label': 'React Page Inspector',
        className: 'rpi-shell',
        'data-collapsed': collapsed,
        'data-dock': layout.dock,
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
          'Main component',
        ),
        React.createElement(
          PreviewInspectorDevtoolsButton,
          {
            onClick: () => setPreviewInspectorPickerEnabled(!previewInspectorSession.pickerEnabled),
            pressed: previewInspectorSession.pickerEnabled,
            title: 'Pick a rendered element',
          },
          previewInspectorSession.pickerEnabled ? 'Cancel pick' : 'Pick',
        ),
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
        React.createElement(PreviewInspectorComponentsPane, {
          roots: snapshot.roots,
          selectedId,
          status: snapshot.status,
          truncated: snapshot.truncated,
        }),
        React.createElement(PreviewInspectorDetailsPane, { node: selectedNode }),
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
