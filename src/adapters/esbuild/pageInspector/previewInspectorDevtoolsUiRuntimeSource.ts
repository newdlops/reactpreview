/**
 * Generates the isolated DevTools-style shell shown by React Page Inspector.
 *
 * The emitted browser source owns only presentation and user interaction. Live Fiber discovery and
 * editor navigation remain optional capabilities on `previewInspectorApi`, which keeps the shell
 * useful while either adapter is unavailable and prevents UI code from depending on React internals
 * or the VS Code message protocol.
 */

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
  /** Opens a collector-owned source identity in the editor without exposing transport details. */
  openSource?(source: PreviewInspectorUiSourceLocation): void;
  /** Mirrors a tree-row selection back into the live collector. */
  selectNode?(id: string): void;
  /** Subscribes to React commits; returning cleanup follows React effect conventions. */
  subscribeTree?(listener: () => void): (() => void) | undefined;
}

/**
 * Creates the browser source for a bottom-docked, Elements-like React component inspector.
 *
 * Expected generated-entry bindings are `React`, `previewInspectorApi`, `previewInspectorSession`,
 * and the existing inspector mutation helpers. The source renders through the pre-existing Shadow
 * DOM portal, so it introduces no wrapper or sizing element into the application DOM.
 *
 * @returns Plain JavaScript source concatenated after the Page Inspector public API is installed.
 */
export function createPreviewInspectorDevtoolsUiRuntimeSource(): string {
  return String.raw`
/** CSS is scoped by the inspector Shadow Root and cannot alter the rendered application page. */
const previewInspectorDevtoolsCss = [
  ':host{all:initial!important;color-scheme:light dark!important}',
  '*,*::before,*::after{box-sizing:border-box}',
  'button,input,select,textarea{font:inherit}',
  '.rpi-shell{--rpi-border:var(--vscode-panel-border,#454545);--rpi-muted:var(--vscode-descriptionForeground,#999);',
  'background:var(--vscode-editor-background,#1e1e1e);border:1px solid var(--rpi-border);',
  'box-shadow:0 8px 28px rgba(0,0,0,.38);color:var(--vscode-editor-foreground,#ddd);',
  'display:grid;font:12px/1.4 var(--vscode-font-family,sans-serif);overflow:hidden;position:fixed;z-index:2147483647}',
  '.rpi-shell[data-dock="bottom"]{bottom:8px;height:min(420px,55vh);left:8px;right:8px}',
  '.rpi-shell[data-dock="right"]{bottom:8px;right:8px;top:8px;width:min(540px,48vw)}',
  '.rpi-shell[data-collapsed="true"]{bottom:8px;height:auto;left:auto;right:8px;top:auto;width:min(520px,calc(100vw - 16px))}',
  '.rpi-toolbar{align-items:center;background:var(--vscode-sideBar-background,#252526);border-bottom:1px solid var(--rpi-border);',
  'display:flex;gap:6px;min-height:36px;padding:5px 7px}',
  '.rpi-title{font-weight:650;margin-right:3px;white-space:nowrap}',
  '.rpi-spacer{flex:1 1 auto}',
  '.rpi-button,.rpi-select,.rpi-search{background:var(--vscode-input-background,#3c3c3c);border:1px solid var(--rpi-border);',
  'border-radius:3px;color:inherit;min-height:25px;outline:none}',
  '.rpi-button{cursor:pointer;padding:2px 7px}',
  '.rpi-button:hover{background:var(--vscode-list-hoverBackground,#2a2d2e)}',
  '.rpi-button:focus-visible,.rpi-select:focus-visible,.rpi-search:focus-visible,.rpi-tree-row:focus-visible,.rpi-tab:focus-visible{',
  'outline:1px solid var(--vscode-focusBorder,#007fd4);outline-offset:-1px}',
  '.rpi-button[aria-pressed="true"]{background:var(--vscode-button-background,#0e639c);color:var(--vscode-button-foreground,#fff)}',
  '.rpi-button:disabled{cursor:default;opacity:.45}',
  '.rpi-select{max-width:210px;padding:2px 5px}',
  '.rpi-workbench{display:grid;grid-template-columns:minmax(230px,.9fr) minmax(320px,1.35fr);min-height:0}',
  '.rpi-shell[data-dock="right"] .rpi-workbench{grid-template-columns:1fr;grid-template-rows:minmax(180px,.9fr) minmax(240px,1.2fr)}',
  '.rpi-pane{display:grid;grid-template-rows:auto minmax(0,1fr);min-height:0;min-width:0}',
  '.rpi-pane+.rpi-pane{border-left:1px solid var(--rpi-border)}',
  '.rpi-shell[data-dock="right"] .rpi-pane+.rpi-pane{border-left:0;border-top:1px solid var(--rpi-border)}',
  '.rpi-pane-heading{align-items:center;background:var(--vscode-sideBarSectionHeader-background,rgba(128,128,128,.08));',
  'border-bottom:1px solid var(--rpi-border);display:flex;gap:7px;min-height:31px;padding:4px 7px}',
  '.rpi-pane-title{font-size:11px;font-weight:650;letter-spacing:.04em;text-transform:uppercase;white-space:nowrap}',
  '.rpi-search{min-width:80px;padding:2px 6px;width:100%}',
  '.rpi-tree-scroll,.rpi-detail-scroll{min-height:0;overflow:auto}',
  '.rpi-tree,.rpi-tree-group{list-style:none;margin:0;padding:0}',
  '.rpi-tree{padding:4px 0}',
  '.rpi-tree-group{padding-left:15px}',
  '.rpi-tree-row{align-items:center;background:transparent;border:0;color:inherit;cursor:default;display:flex;gap:4px;',
  'height:23px;padding:0 6px;text-align:left;width:100%}',
  '.rpi-tree-row:hover{background:var(--vscode-list-hoverBackground,#2a2d2e)}',
  '.rpi-tree-row[aria-selected="true"]{background:var(--vscode-list-activeSelectionBackground,#094771);color:var(--vscode-list-activeSelectionForeground,#fff)}',
  '.rpi-twisty{display:inline-block;font-size:10px;text-align:center;width:12px}',
  '.rpi-twisty[data-expandable="true"]{cursor:pointer}',
  '.rpi-component-icon{color:var(--vscode-symbolIcon-classForeground,#ee9d28);font-weight:700}',
  '.rpi-node-name{overflow:hidden;text-overflow:ellipsis;white-space:nowrap}',
  '.rpi-badge{border:1px solid currentColor;border-radius:8px;font-size:9px;line-height:14px;margin-left:3px;opacity:.78;padding:0 5px}',
  '.rpi-empty{color:var(--rpi-muted);padding:18px;text-align:center}',
  '.rpi-tabs{display:flex;gap:1px}',
  '.rpi-tab{background:transparent;border:0;border-bottom:2px solid transparent;color:var(--rpi-muted);cursor:pointer;padding:4px 9px}',
  '.rpi-tab[aria-selected="true"]{border-bottom-color:var(--vscode-focusBorder,#007fd4);color:inherit}',
  '.rpi-detail-content{display:grid;gap:9px;padding:9px}',
  '.rpi-meta{color:var(--rpi-muted);overflow:hidden;text-overflow:ellipsis;white-space:nowrap}',
  '.rpi-json{background:var(--vscode-textCodeBlock-background,#2d2d2d);border:1px solid var(--rpi-border);border-radius:3px;',
  'color:inherit;font:11px/1.5 var(--vscode-editor-font-family,monospace);margin:0;min-height:110px;overflow:auto;padding:7px;white-space:pre-wrap}',
  'textarea.rpi-json{resize:vertical;width:100%}',
  '.rpi-actions{display:flex;flex-wrap:wrap;gap:6px}',
  '.rpi-error{color:var(--vscode-errorForeground,#f48771)}',
  '.rpi-note{color:var(--rpi-muted);font-size:11px}',
  '.rpi-source-card{border:1px solid var(--rpi-border);border-radius:3px;display:grid;gap:5px;padding:8px}',
  '.rpi-shell[data-collapsed="true"] .rpi-workbench{display:none}',
  '@media(max-width:720px){.rpi-workbench{grid-template-columns:1fr;grid-template-rows:minmax(160px,.8fr) minmax(220px,1fr)}',
  '.rpi-pane+.rpi-pane{border-left:0;border-top:1px solid var(--rpi-border)}.rpi-title{display:none}.rpi-select{max-width:150px}}',
].join('');

/** Returns whether a collector node is a React component rather than an HTML/text host record. */
function isPreviewInspectorComponentNode(node) {
  const kind = typeof node?.kind === 'string' ? node.kind.toLowerCase() : 'component';
  return node?.isHost !== true && kind !== 'host' && kind !== 'html' && kind !== 'dom' && kind !== 'text';
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
  if (typeof collectTree !== 'function') return createFallbackPreviewInspectorTreeSnapshot();
  try {
    const snapshot = collectTree();
    const roots = normalizePreviewInspectorUiNodes(snapshot?.roots, 0, { count: 0 });
    return roots.length === 0
      ? createFallbackPreviewInspectorTreeSnapshot()
      : {
          roots,
          selectedId: typeof snapshot?.selectedId === 'string' ? snapshot.selectedId : undefined,
          status: typeof snapshot?.status === 'string' ? snapshot.status : undefined,
          truncated: snapshot?.truncated === true,
        };
  } catch (error) {
    console.warn('[React Preview] Component tree collector failed.', error);
    return createFallbackPreviewInspectorTreeSnapshot();
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
function PreviewInspectorDevtoolsButton({ children, disabled, onClick, pressed, title }) {
  return React.createElement(
    'button',
    {
      'aria-pressed': pressed,
      className: 'rpi-button',
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
    const parentItem = row.parentElement?.parentElement?.closest?.('[role="treeitem"]');
    const parentRow = parentItem?.querySelector?.(':scope > [data-react-preview-tree-row]');
    if (parentRow !== undefined && parentRow !== null) {
      event.preventDefault();
      parentRow.focus();
    }
  }
}

/** Renders one component-only tree branch with target and selection badges. */
function PreviewInspectorComponentTreeNode({ expandedIds, node, selectedId, setExpandedIds }) {
  const hasChildren = node.children.length > 0;
  const expanded = hasChildren && expandedIds.has(node.id);
  const selected = node.id === selectedId;
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
    { 'aria-expanded': hasChildren ? expanded : undefined, role: 'treeitem' },
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
        className: 'rpi-tree-row',
        'data-react-preview-tree-row': node.id,
        onClick: () => selectPreviewInspectorUiNode(node),
        onDoubleClick: toggle,
        tabIndex: selected ? 0 : -1,
        title: node.name,
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
      React.createElement('span', { 'aria-hidden': true, className: 'rpi-component-icon' }, '◇'),
      React.createElement('span', { className: 'rpi-node-name' }, node.name),
      selected ? React.createElement('span', { className: 'rpi-badge' }, 'selected') : null,
      isTarget ? React.createElement('span', { className: 'rpi-badge' }, 'target') : null,
    ),
    expanded
      ? React.createElement(
          'ul',
          { className: 'rpi-tree-group', role: 'group' },
          node.children.map((child) => React.createElement(PreviewInspectorComponentTreeNode, {
            expandedIds,
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
  const [query, setQuery] = React.useState('');
  const [expandedIds, setExpandedIds] = React.useState(() => new Set(roots.map((node) => node.id)));
  const filteredRoots = filterPreviewInspectorUiNodes(roots, query);
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
        onChange: (event) => setQuery(event.target.value),
        placeholder: 'Filter components',
        type: 'search',
        value: query,
      }),
    ),
    React.createElement(
      'div',
      { className: 'rpi-tree-scroll', onKeyDown: handlePreviewInspectorTreeKeyDown },
      filteredRoots.length === 0
        ? React.createElement('div', { className: 'rpi-empty' }, 'No matching React components.')
        : React.createElement(
            'ul',
            { 'aria-label': 'Mounted React component tree', className: 'rpi-tree', role: 'tree' },
            filteredRoots.map((node) => React.createElement(PreviewInspectorComponentTreeNode, {
              expandedIds,
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

/** Delegates source navigation only through the optional public adapter contract. */
function PreviewInspectorSourceDetail({ node }) {
  const source = node?.source;
  const canOpen = source !== undefined && typeof previewInspectorApi.openSource === 'function';
  const openSource = () => {
    if (!canOpen) return;
    try {
      previewInspectorApi.openSource(source);
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
          { disabled: !canOpen, onClick: openSource },
          canOpen ? 'Open source' : 'Source unavailable',
        ),
      ),
    ),
  );
}

/** Renders Props, State, and Source tabs for the current component selection. */
function PreviewInspectorDetailsPane({ node }) {
  const [activeTab, setActiveTab] = React.useState('props');
  const tabs = [
    ['props', 'Props'],
    ['state', 'State'],
    ['source', 'Source'],
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
            onClick: () => setActiveTab(id),
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
      node === undefined
        ? React.createElement('div', { className: 'rpi-empty' }, 'Select a React component to inspect it.')
        : activeTab === 'state'
          ? React.createElement(PreviewInspectorStateDetail, { node })
          : activeTab === 'source'
            ? React.createElement(PreviewInspectorSourceDetail, { node })
            : React.createElement(PreviewInspectorPropsDetail, { node }),
    ),
  );
}

/** Renders the top picker/highlight toolbar and the docked two-pane inspector workbench. */
function PreviewInspectorToolbar() {
  usePreviewInspectorStore();
  usePreviewInspectorTreeRefresh();
  const [collapsed, setCollapsed] = React.useState(false);
  const [dock, setDock] = React.useState('bottom');
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
        'data-dock': dock,
      },
      React.createElement(
        'div',
        { 'aria-label': 'React Page Inspector tools', className: 'rpi-toolbar', role: 'toolbar' },
        React.createElement('span', { className: 'rpi-title' }, 'React Page Inspector'),
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
        React.createElement(
          PreviewInspectorDevtoolsButton,
          {
            onClick: () => setDock((current) => current === 'bottom' ? 'right' : 'bottom'),
            title: dock === 'bottom' ? 'Dock inspector to the right' : 'Dock inspector to the bottom',
          },
          dock === 'bottom' ? 'Dock right' : 'Dock bottom',
        ),
        React.createElement(
          PreviewInspectorDevtoolsButton,
          { onClick: () => setCollapsed((current) => !current), title: collapsed ? 'Expand inspector' : 'Collapse inspector' },
          collapsed ? 'Expand' : 'Collapse',
        ),
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
`;
}
