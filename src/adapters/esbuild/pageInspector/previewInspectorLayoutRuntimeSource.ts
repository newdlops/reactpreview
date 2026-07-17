/**
 * Generates the isolated Page Inspector layout controller and Shadow DOM stylesheet.
 *
 * Layout state is deliberately separate from component-tree semantics: the controller only owns
 * drawer dimensions, floating coordinates, pointer/keyboard gestures, and viewport clamping. This
 * keeps project React state untouched while letting the Inspector move away from important content.
 */

/**
 * Creates browser source for resizable bottom/side drawers and a movable floating Inspector.
 *
 * Expected generated-entry bindings are `React`, `previewInspectorSession`, and
 * `persistPreviewInspectorState`. Values are stored as finite viewport-clamped numbers so hot
 * reload and VS Code webview-state restoration cannot revive an off-screen panel.
 *
 * @returns Plain JavaScript source concatenated before the DevTools component-tree UI.
 */
export function createPreviewInspectorLayoutRuntimeSource(): string {
  return String.raw`
/** CSS is scoped by the Inspector Shadow Root and cannot alter the rendered application page. */
const previewInspectorDevtoolsCss = [
  ':host{all:initial!important;color-scheme:light dark!important}',
  '*,*::before,*::after{box-sizing:border-box}',
  'button,input,select,textarea{font:inherit}',
  '.rpi-shell{--rpi-border:var(--vscode-panel-border,#454545);--rpi-muted:var(--vscode-descriptionForeground,#999);',
  'background:var(--vscode-editor-background,#1e1e1e);border:1px solid var(--rpi-border);',
  'box-shadow:0 8px 28px rgba(0,0,0,.38);color:var(--vscode-editor-foreground,#ddd);',
  'display:grid;font:12px/1.4 var(--vscode-font-family,sans-serif);max-width:calc(100vw - 16px);min-width:0;',
  'overflow:hidden;pointer-events:auto;position:fixed;z-index:2147483647}',
  '.rpi-shell[data-dock="floating"]{border-radius:5px}',
  '.rpi-toolbar{align-items:center;background:var(--vscode-sideBar-background,#252526);border-bottom:1px solid var(--rpi-border);',
  'display:flex;gap:6px;min-height:36px;overflow-x:auto;overflow-y:hidden;padding:5px 7px}',
  '.rpi-title{font-weight:650;margin-right:3px;white-space:nowrap}',
  '.rpi-spacer{flex:1 1 auto}',
  '.rpi-button,.rpi-select,.rpi-search{background:var(--vscode-input-background,#3c3c3c);border:1px solid var(--rpi-border);',
  'border-radius:3px;color:inherit;min-height:25px;outline:none}',
  '.rpi-button{cursor:pointer;padding:2px 7px}',
  '.rpi-toolbar>.rpi-button,.rpi-toolbar>.rpi-select,.rpi-toolbar>.rpi-title{flex:0 0 auto}',
  '.rpi-button:hover{background:var(--vscode-list-hoverBackground,#2a2d2e)}',
  '.rpi-button:focus-visible,.rpi-select:focus-visible,.rpi-search:focus-visible,.rpi-tree-row:focus-visible,.rpi-tab:focus-visible,',
  '.rpi-resize-handle:focus-visible,.rpi-move-handle:focus-visible{outline:1px solid var(--vscode-focusBorder,#007fd4);outline-offset:-1px}',
  '.rpi-button[aria-pressed="true"]{background:var(--vscode-button-background,#0e639c);color:var(--vscode-button-foreground,#fff)}',
  '.rpi-button:disabled{cursor:default;opacity:.45}',
  '.rpi-select{max-width:210px;padding:2px 5px}',
  '.rpi-page-context{align-items:center;background:var(--vscode-breadcrumb-background,var(--vscode-editor-background,#1e1e1e));',
  'border-bottom:1px solid var(--rpi-border);display:grid;gap:2px 8px;grid-template-columns:auto minmax(0,1fr);padding:6px 8px}',
  '.rpi-context-badge{background:var(--vscode-badge-background,#4d4d4d);border-radius:9px;color:var(--vscode-badge-foreground,#fff);',
  'font-size:9px;font-weight:700;grid-row:1/3;line-height:17px;padding:0 6px;white-space:nowrap}',
  '.rpi-context-path{font-family:var(--vscode-editor-font-family,monospace);font-size:11px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}',
  '.rpi-context-detail{color:var(--rpi-muted);font-size:10px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}',
  '.rpi-candidate-select{align-items:center;display:flex;gap:7px;grid-column:1/-1;min-width:0}',
  '.rpi-candidate-select .rpi-context-badge{flex:0 0 auto;grid-row:auto}.rpi-candidate-select .rpi-select{flex:1 1 auto;max-width:360px}',
  '.rpi-workbench{display:grid;grid-template-columns:minmax(230px,.9fr) minmax(320px,1.35fr);min-height:0}',
  '.rpi-shell:is([data-dock="left"],[data-dock="right"]) .rpi-workbench{grid-template-columns:1fr;',
  'grid-template-rows:minmax(180px,.9fr) minmax(240px,1.2fr)}',
  '.rpi-pane{display:grid;grid-template-rows:auto minmax(0,1fr);min-height:0;min-width:0}',
  '.rpi-pane+.rpi-pane{border-left:1px solid var(--rpi-border)}',
  '.rpi-shell:is([data-dock="left"],[data-dock="right"]) .rpi-pane+.rpi-pane{border-left:0;border-top:1px solid var(--rpi-border)}',
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
  '.rpi-condition-row{border-left:2px solid var(--vscode-charts-yellow,#cca700);cursor:pointer;padding-left:4px}',
  '.rpi-condition-row .rpi-component-icon{color:var(--vscode-charts-yellow,#cca700)}',
  '.rpi-overlay-row{border-left:2px solid var(--vscode-charts-purple,#b180d7);padding-left:4px}',
  '.rpi-overlay-row .rpi-component-icon{color:var(--vscode-charts-purple,#b180d7)}',
  '.rpi-wrapper-row .rpi-component-icon{color:var(--vscode-symbolIcon-interfaceForeground,#75beff)}',
  '.rpi-twisty{display:inline-block;font-size:10px;text-align:center;width:12px}',
  '.rpi-twisty[data-expandable="true"]{cursor:pointer}',
  '.rpi-component-icon{color:var(--vscode-symbolIcon-classForeground,#ee9d28);font-weight:700}',
  '.rpi-node-name{overflow:hidden;text-overflow:ellipsis;white-space:nowrap}',
  '.rpi-badge{border:1px solid currentColor;border-radius:8px;font-size:9px;line-height:14px;margin-left:3px;opacity:.78;padding:0 5px}',
  '.rpi-empty{color:var(--rpi-muted);padding:18px;text-align:center}',
  '.rpi-tabs{display:flex;gap:1px;min-width:0;overflow-x:auto}',
  '.rpi-tab{background:transparent;border:0;border-bottom:2px solid transparent;color:var(--rpi-muted);cursor:pointer;padding:4px 9px;white-space:nowrap}',
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
  '.rpi-console{grid-template-rows:auto auto minmax(0,1fr);height:100%}',
  '.rpi-console-controls{display:grid;gap:6px;grid-template-columns:auto minmax(120px,1fr) auto}',
  '.rpi-console-list{border:1px solid var(--rpi-border);border-radius:3px;min-height:0;overflow:auto}',
  '.rpi-console-entry{border-left:3px solid var(--rpi-muted);display:grid;gap:4px;padding:7px 8px}',
  '.rpi-console-entry+.rpi-console-entry{border-top:1px solid var(--rpi-border)}',
  '.rpi-console-entry[data-level="error"]{border-left-color:var(--vscode-errorForeground,#f48771);background:rgba(244,135,113,.07)}',
  '.rpi-console-entry[data-level="warn"]{border-left-color:var(--vscode-charts-yellow,#cca700);background:rgba(204,167,0,.06)}',
  '.rpi-console-heading{align-items:center;display:flex;gap:7px;min-width:0}',
  '.rpi-console-level{font-size:9px;font-weight:750;letter-spacing:.05em}',
  '.rpi-console-time{color:var(--rpi-muted);font:10px var(--vscode-editor-font-family,monospace)}',
  '.rpi-console-meta{color:var(--rpi-muted);font-size:10px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}',
  '.rpi-console-repeat{background:var(--vscode-badge-background,#4d4d4d);border-radius:8px;color:var(--vscode-badge-foreground,#fff);margin-left:auto;padding:0 5px}',
  '.rpi-console-message,.rpi-console-details pre{font:11px/1.45 var(--vscode-editor-font-family,monospace);margin:0;overflow-wrap:anywhere;white-space:pre-wrap}',
  '.rpi-console-details{color:var(--rpi-muted)}.rpi-console-details summary{cursor:pointer}.rpi-console-details pre{color:inherit;margin-top:6px}',
  '.rpi-shell[data-collapsed="true"] .rpi-page-context,.rpi-shell[data-collapsed="true"] .rpi-workbench,',
  '.rpi-shell[data-collapsed="true"] .rpi-resize-handle{display:none}',
  '.rpi-resize-handle{background:transparent;border:0;display:block;position:absolute;touch-action:none;user-select:none;z-index:4}',
  '.rpi-resize-handle::after{background:var(--rpi-muted);border-radius:2px;content:"";opacity:.55;position:absolute}',
  '.rpi-resize-handle[data-edge="bottom"]{cursor:ns-resize;height:9px;left:0;right:0;top:-5px}',
  '.rpi-resize-handle[data-edge="bottom"]::after{bottom:2px;height:2px;left:calc(50% - 24px);width:48px}',
  '.rpi-resize-handle[data-edge="right"]{bottom:0;cursor:ew-resize;left:-5px;top:0;width:9px}',
  '.rpi-resize-handle[data-edge="right"]::after{height:48px;right:2px;top:calc(50% - 24px);width:2px}',
  '.rpi-resize-handle[data-edge="left"]{bottom:0;cursor:ew-resize;right:-5px;top:0;width:9px}',
  '.rpi-resize-handle[data-edge="left"]::after{height:48px;left:2px;top:calc(50% - 24px);width:2px}',
  '.rpi-resize-handle[data-edge="floating"]{border-bottom:2px solid var(--rpi-muted);border-right:2px solid var(--rpi-muted);',
  'bottom:2px;cursor:nwse-resize;height:14px;right:2px;width:14px}',
  '.rpi-resize-handle[data-edge="floating"]::after{display:none}',
  '.rpi-move-handle{background:transparent;border:0;color:var(--rpi-muted);cursor:move;display:none;font-size:16px;',
  'height:25px;line-height:20px;padding:0 4px;touch-action:none;user-select:none}',
  '.rpi-shell[data-dock="floating"] .rpi-move-handle{display:block}',
  '@media(max-width:720px){.rpi-workbench{grid-template-columns:1fr;grid-template-rows:minmax(160px,.8fr) minmax(220px,1fr)}',
  '.rpi-pane+.rpi-pane{border-left:0;border-top:1px solid var(--rpi-border)}.rpi-title{display:none}.rpi-select{max-width:150px}}',
].join('');

const PREVIEW_INSPECTOR_LAYOUT_MARGIN = 8;
const PREVIEW_INSPECTOR_LAYOUT_STEP = 16;
const previewInspectorLayoutModes = new Set(['bottom', 'left', 'right', 'floating']);

/** Retains visual controls across hot replacements and full VS Code webview restoration. */
const previewInspectorDevtoolsSessionState =
  previewInspectorSession.devtoolsState !== null &&
  typeof previewInspectorSession.devtoolsState === 'object' &&
  !Array.isArray(previewInspectorSession.devtoolsState)
    ? previewInspectorSession.devtoolsState
    : {};
previewInspectorSession.devtoolsState = previewInspectorDevtoolsSessionState;
previewInspectorDevtoolsSessionState.activeTab =
  ['console', 'fallbacks', 'payloads', 'props', 'state', 'source'].includes(previewInspectorDevtoolsSessionState.activeTab)
    ? previewInspectorDevtoolsSessionState.activeTab
    : 'props';
previewInspectorDevtoolsSessionState.collapsed =
  previewInspectorDevtoolsSessionState.collapsed === true;
previewInspectorDevtoolsSessionState.query =
  typeof previewInspectorDevtoolsSessionState.query === 'string'
    ? previewInspectorDevtoolsSessionState.query
    : '';
Object.assign(
  previewInspectorDevtoolsSessionState,
  normalizePreviewInspectorLayout(previewInspectorDevtoolsSessionState),
);

/** Returns a finite browser viewport even in synthetic or partially initialized webviews. */
function readPreviewInspectorViewport() {
  return {
    height: Number.isFinite(globalThis.innerHeight) ? Math.max(1, globalThis.innerHeight) : 800,
    width: Number.isFinite(globalThis.innerWidth) ? Math.max(1, globalThis.innerWidth) : 1280,
  };
}

/** Clamps an untrusted persisted dimension and applies an already bounded fallback. */
function clampPreviewInspectorLayoutValue(value, minimum, maximum, fallback) {
  const finiteValue = Number.isFinite(value) ? value : fallback;
  return Math.min(maximum, Math.max(minimum, finiteValue));
}

/** Normalizes mode, dimensions, and floating coordinates against the current viewport. */
function normalizePreviewInspectorLayout(value, viewport = readPreviewInspectorViewport()) {
  const viewportWidth = Math.max(160, Number(viewport?.width) || 1280);
  const viewportHeight = Math.max(160, Number(viewport?.height) || 800);
  const maximumWidth = Math.max(144, viewportWidth - PREVIEW_INSPECTOR_LAYOUT_MARGIN * 2);
  const maximumHeight = Math.max(144, viewportHeight - PREVIEW_INSPECTOR_LAYOUT_MARGIN * 2);
  const minimumSideWidth = Math.min(300, maximumWidth);
  const minimumBottomHeight = Math.min(220, maximumHeight);
  const minimumFloatingWidth = Math.min(320, maximumWidth);
  const minimumFloatingHeight = Math.min(240, maximumHeight);
  const legacyDock = value?.dock === 'right' ? 'right' : 'bottom';
  const dock = previewInspectorLayoutModes.has(value?.dock) ? value.dock : legacyDock;
  const bottomHeight = clampPreviewInspectorLayoutValue(
    value?.bottomHeight,
    minimumBottomHeight,
    maximumHeight,
    Math.min(420, viewportHeight * 0.55, maximumHeight),
  );
  const sideWidth = clampPreviewInspectorLayoutValue(
    value?.sideWidth,
    minimumSideWidth,
    maximumWidth,
    Math.min(540, viewportWidth * 0.48, maximumWidth),
  );
  const floatingWidth = clampPreviewInspectorLayoutValue(
    value?.floatingWidth,
    minimumFloatingWidth,
    maximumWidth,
    Math.min(760, viewportWidth * 0.7, maximumWidth),
  );
  const floatingHeight = clampPreviewInspectorLayoutValue(
    value?.floatingHeight,
    minimumFloatingHeight,
    maximumHeight,
    Math.min(520, viewportHeight * 0.65, maximumHeight),
  );
  const maximumX = Math.max(
    PREVIEW_INSPECTOR_LAYOUT_MARGIN,
    viewportWidth - floatingWidth - PREVIEW_INSPECTOR_LAYOUT_MARGIN,
  );
  const maximumY = Math.max(
    PREVIEW_INSPECTOR_LAYOUT_MARGIN,
    viewportHeight - floatingHeight - PREVIEW_INSPECTOR_LAYOUT_MARGIN,
  );
  return {
    bottomHeight,
    dock,
    floatingHeight,
    floatingWidth,
    floatingX: clampPreviewInspectorLayoutValue(
      value?.floatingX,
      PREVIEW_INSPECTOR_LAYOUT_MARGIN,
      maximumX,
      PREVIEW_INSPECTOR_LAYOUT_MARGIN,
    ),
    floatingY: clampPreviewInspectorLayoutValue(
      value?.floatingY,
      PREVIEW_INSPECTOR_LAYOUT_MARGIN,
      maximumY,
      PREVIEW_INSPECTOR_LAYOUT_MARGIN,
    ),
    sideWidth,
  };
}

/** Converts normalized layout state into React inline styles for one fixed Shadow DOM shell. */
function createPreviewInspectorShellStyle(
  layout,
  collapsed,
  viewport = readPreviewInspectorViewport(),
) {
  if (collapsed) {
    const viewportWidth = Math.max(1, Number(viewport?.width) || 1280);
    const collapsedWidth = Math.max(
      1,
      Math.min(520, viewportWidth - PREVIEW_INSPECTOR_LAYOUT_MARGIN * 2),
    );
    return {
      bottom: PREVIEW_INSPECTOR_LAYOUT_MARGIN,
      height: 'auto',
      left: Math.max(
        0,
        viewportWidth - collapsedWidth - PREVIEW_INSPECTOR_LAYOUT_MARGIN,
      ),
      maxWidth: 'none',
      minWidth: 0,
      right: 'auto',
      top: 'auto',
      transform: 'none',
      width: collapsedWidth,
    };
  }
  if (layout.dock === 'bottom') {
    return {
      bottom: PREVIEW_INSPECTOR_LAYOUT_MARGIN,
      height: layout.bottomHeight,
      left: PREVIEW_INSPECTOR_LAYOUT_MARGIN,
      right: PREVIEW_INSPECTOR_LAYOUT_MARGIN,
    };
  }
  if (layout.dock === 'left') {
    return {
      bottom: PREVIEW_INSPECTOR_LAYOUT_MARGIN,
      left: PREVIEW_INSPECTOR_LAYOUT_MARGIN,
      top: PREVIEW_INSPECTOR_LAYOUT_MARGIN,
      width: layout.sideWidth,
    };
  }
  if (layout.dock === 'right') {
    return {
      bottom: PREVIEW_INSPECTOR_LAYOUT_MARGIN,
      right: PREVIEW_INSPECTOR_LAYOUT_MARGIN,
      top: PREVIEW_INSPECTOR_LAYOUT_MARGIN,
      width: layout.sideWidth,
    };
  }
  return {
    height: layout.floatingHeight,
    left: layout.floatingX,
    top: layout.floatingY,
    width: layout.floatingWidth,
  };
}

/** Applies a pointer/keyboard delta to a copied layout before viewport normalization. */
function resizePreviewInspectorLayout(layout, action, deltaX, deltaY) {
  if (action === 'move') {
    return normalizePreviewInspectorLayout({
      ...layout,
      floatingX: layout.floatingX + deltaX,
      floatingY: layout.floatingY + deltaY,
    });
  }
  if (layout.dock === 'bottom') {
    return normalizePreviewInspectorLayout({ ...layout, bottomHeight: layout.bottomHeight - deltaY });
  }
  if (layout.dock === 'left') {
    return normalizePreviewInspectorLayout({ ...layout, sideWidth: layout.sideWidth + deltaX });
  }
  if (layout.dock === 'right') {
    return normalizePreviewInspectorLayout({ ...layout, sideWidth: layout.sideWidth - deltaX });
  }
  return normalizePreviewInspectorLayout({
    ...layout,
    floatingHeight: layout.floatingHeight + deltaY,
    floatingWidth: layout.floatingWidth + deltaX,
  });
}

/** Owns React state while synchronously mirroring every update into the hot session object. */
function usePreviewInspectorLayout() {
  const initialLayout = React.useMemo(
    () => normalizePreviewInspectorLayout(previewInspectorDevtoolsSessionState),
    [],
  );
  const layoutRef = React.useRef(initialLayout);
  const [layout, setLayout] = React.useState(initialLayout);
  const updateLayout = React.useCallback((update) => {
    const candidate = typeof update === 'function' ? update(layoutRef.current) : update;
    const normalized = normalizePreviewInspectorLayout(candidate);
    layoutRef.current = normalized;
    Object.assign(previewInspectorDevtoolsSessionState, normalized);
    setLayout(normalized);
    return normalized;
  }, []);
  const persistLayout = React.useCallback(() => persistPreviewInspectorState(), []);
  React.useEffect(() => {
    const keepVisible = () => updateLayout((current) => current);
    globalThis.addEventListener?.('resize', keepVisible);
    return () => globalThis.removeEventListener?.('resize', keepVisible);
  }, [updateLayout]);
  return { layout, persistLayout, updateLayout };
}

/** Tracks one pointer gesture on its handle without installing document-global persistent state. */
function beginPreviewInspectorLayoutPointerGesture(
  event,
  action,
  layout,
  updateLayout,
  persistLayout,
) {
  if (event.button !== 0) return;
  event.preventDefault();
  const handle = event.currentTarget;
  const pointerId = event.pointerId;
  const startX = event.clientX;
  const startY = event.clientY;
  const move = (nextEvent) => {
    if (nextEvent.pointerId !== pointerId) return;
    updateLayout(
      resizePreviewInspectorLayout(
        layout,
        action,
        nextEvent.clientX - startX,
        nextEvent.clientY - startY,
      ),
    );
  };
  const finish = (nextEvent) => {
    if (nextEvent.pointerId !== pointerId) return;
    handle.removeEventListener('pointermove', move);
    handle.removeEventListener('pointerup', finish);
    handle.removeEventListener('pointercancel', finish);
    try { handle.releasePointerCapture?.(pointerId); } catch { /* Capture may already be gone. */ }
    persistLayout();
  };
  handle.addEventListener('pointermove', move);
  handle.addEventListener('pointerup', finish);
  handle.addEventListener('pointercancel', finish);
  try { handle.setPointerCapture?.(pointerId); } catch { /* Pointer capture is an enhancement. */ }
}

/** Maps arrow keys to the same bounded move/resize operation used by pointer gestures. */
function handlePreviewInspectorLayoutArrowKey(
  event,
  action,
  layout,
  updateLayout,
  persistLayout,
) {
  const deltas = {
    ArrowDown: [0, PREVIEW_INSPECTOR_LAYOUT_STEP],
    ArrowLeft: [-PREVIEW_INSPECTOR_LAYOUT_STEP, 0],
    ArrowRight: [PREVIEW_INSPECTOR_LAYOUT_STEP, 0],
    ArrowUp: [0, -PREVIEW_INSPECTOR_LAYOUT_STEP],
  };
  const delta = deltas[event.key];
  if (delta === undefined) return;
  event.preventDefault();
  updateLayout(resizePreviewInspectorLayout(layout, action, delta[0], delta[1]));
  persistLayout();
}

/** Renders the edge/corner separator used to resize the current expanded layout. */
function PreviewInspectorResizeHandle({ collapsed, layout, persistLayout, updateLayout }) {
  if (collapsed) return null;
  const orientation = layout.dock === 'floating'
    ? undefined
    : layout.dock === 'bottom'
      ? 'horizontal'
      : 'vertical';
  return React.createElement('div', {
    'aria-label': 'Resize React Page Inspector',
    'aria-orientation': orientation,
    className: 'rpi-resize-handle',
    'data-edge': layout.dock,
    onKeyDown: (event) => handlePreviewInspectorLayoutArrowKey(
      event,
      'resize',
      layout,
      updateLayout,
      persistLayout,
    ),
    onPointerDown: (event) => beginPreviewInspectorLayoutPointerGesture(
      event,
      'resize',
      layout,
      updateLayout,
      persistLayout,
    ),
    role: 'separator',
    tabIndex: 0,
    title: 'Drag or use arrow keys to resize the Inspector',
  });
}

/** Renders a keyboard-accessible drag handle only while the Inspector is floating. */
function PreviewInspectorMoveHandle({ layout, persistLayout, updateLayout }) {
  if (layout.dock !== 'floating') return null;
  return React.createElement(
    'button',
    {
      'aria-label': 'Move floating React Page Inspector',
      className: 'rpi-move-handle',
      onKeyDown: (event) => handlePreviewInspectorLayoutArrowKey(
        event,
        'move',
        layout,
        updateLayout,
        persistLayout,
      ),
      onPointerDown: (event) => beginPreviewInspectorLayoutPointerGesture(
        event,
        'move',
        layout,
        updateLayout,
        persistLayout,
      ),
      title: 'Drag or use arrow keys to move the Inspector',
      type: 'button',
    },
    '⠿',
  );
}

/** Renders an explicit placement selector instead of cycling through an implicit two-state toggle. */
function PreviewInspectorLayoutSelect({ layout, persistLayout, updateLayout }) {
  return React.createElement(
    'select',
    {
      'aria-label': 'Inspector position',
      className: 'rpi-select',
      onChange: (event) => {
        updateLayout({ ...layout, dock: event.target.value });
        persistLayout();
      },
      title: 'Choose a drawer edge or a movable floating Inspector',
      value: layout.dock,
    },
    React.createElement('option', { value: 'bottom' }, 'Bottom drawer'),
    React.createElement('option', { value: 'right' }, 'Right drawer'),
    React.createElement('option', { value: 'left' }, 'Left drawer'),
    React.createElement('option', { value: 'floating' }, 'Floating'),
  );
}
`;
}
