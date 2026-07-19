/**
 * Generates the dedicated Inspector tab's local Components/Details pane splitter.
 *
 * The companion document contains no project JavaScript and is replaced from sanitized snapshots.
 * Keeping pane resizing in that document avoids round trips to the hidden renderer, prevents a
 * pointer drag from remounting React components, and lets each Inspector editor retain its own
 * proportions through VS Code webview state.
 */

/**
 * Creates browser source that installs an accessible splitter after every companion snapshot.
 *
 * The generated source expects the companion IIFE's `mirror` element and `vscode` API binding.
 * Wide workbenches remember a left/right ratio while narrow workbenches independently remember an
 * upper/lower ratio. All values are finite and clamped again against the live workbench extent.
 *
 * @returns Inert companion-only JavaScript embedded under the document's nonce-authorized script.
 */
export function createPreviewInspectorCompanionPaneResizeScript(): string {
  return String.raw`
const PREVIEW_INSPECTOR_COMPANION_PANE_BREAKPOINT = 760;
const PREVIEW_INSPECTOR_COMPANION_PANE_HANDLE_SIZE = 9;
const PREVIEW_INSPECTOR_COMPANION_PANE_STATE_KEY = 'reactPreviewInspectorPaneLayout';
const PREVIEW_INSPECTOR_COMPANION_PANE_DEFAULTS = Object.freeze({
  columnsRatio: 0.38,
  rowsRatio: 0.34,
});

/** Restricts restored ratios before live dimensions provide stricter pixel-based bounds. */
function normalizePreviewInspectorCompanionPaneRatio(value, fallback) {
  const finiteValue = Number.isFinite(value) ? value : fallback;
  return Math.min(0.85, Math.max(0.15, finiteValue));
}

/** Reads only this document's bounded pane ratios from VS Code webview state. */
function readPreviewInspectorCompanionPaneState() {
  let persisted;
  try { persisted = vscode.getState?.(); } catch { persisted = undefined; }
  const source = persisted?.[PREVIEW_INSPECTOR_COMPANION_PANE_STATE_KEY];
  return {
    columnsRatio: normalizePreviewInspectorCompanionPaneRatio(
      source?.columnsRatio,
      PREVIEW_INSPECTOR_COMPANION_PANE_DEFAULTS.columnsRatio,
    ),
    rowsRatio: normalizePreviewInspectorCompanionPaneRatio(
      source?.rowsRatio,
      PREVIEW_INSPECTOR_COMPANION_PANE_DEFAULTS.rowsRatio,
    ),
  };
}

let previewInspectorCompanionPaneState = readPreviewInspectorCompanionPaneState();
let disposePreviewInspectorCompanionPaneResize = () => undefined;

/** Persists pane proportions without discarding unrelated companion document state. */
function persistPreviewInspectorCompanionPaneState() {
  let current;
  try { current = vscode.getState?.(); } catch { current = undefined; }
  const root = current !== null && typeof current === 'object' ? current : {};
  try {
    vscode.setState?.({
      ...root,
      [PREVIEW_INSPECTOR_COMPANION_PANE_STATE_KEY]: { ...previewInspectorCompanionPaneState },
    });
  } catch { /* A closing webview can reject a final best-effort state write. */ }
}

/** Selects side-by-side or stacked panes from the workbench's actual inline size. */
function readPreviewInspectorCompanionPaneAxis(workbench) {
  const width = workbench.getBoundingClientRect?.().width ?? workbench.clientWidth ?? 0;
  return width < PREVIEW_INSPECTOR_COMPANION_PANE_BREAKPOINT ? 'rows' : 'columns';
}

/** Computes ratio bounds that keep both panes reachable even in a small editor group. */
function readPreviewInspectorCompanionPaneBounds(workbench, axis) {
  const rawExtent = axis === 'columns' ? workbench.clientWidth : workbench.clientHeight;
  const extent = Math.max(1, rawExtent - PREVIEW_INSPECTOR_COMPANION_PANE_HANDLE_SIZE);
  const firstMinimum = Math.min(axis === 'columns' ? 180 : 120, extent * 0.45);
  const secondMinimum = Math.min(axis === 'columns' ? 260 : 160, extent * 0.45);
  return {
    extent,
    maximum: Math.min(0.85, Math.max(0.55, 1 - secondMinimum / extent)),
    minimum: Math.max(0.15, Math.min(0.45, firstMinimum / extent)),
  };
}

/** Applies one bounded ratio and synchronizes separator accessibility metadata. */
function applyPreviewInspectorCompanionPaneRatio(workbench, handle, axis, candidate) {
  const bounds = readPreviewInspectorCompanionPaneBounds(workbench, axis);
  const ratio = Math.min(bounds.maximum, Math.max(bounds.minimum, candidate));
  const stateName = axis === 'columns' ? 'columnsRatio' : 'rowsRatio';
  previewInspectorCompanionPaneState = {
    ...previewInspectorCompanionPaneState,
    [stateName]: ratio,
  };
  workbench.setAttribute('data-rpi-pane-axis', axis);
  workbench.style.setProperty('--rpi-pane-first-size', String(ratio * 100) + '%');
  handle.setAttribute('aria-orientation', axis === 'columns' ? 'vertical' : 'horizontal');
  handle.setAttribute('aria-valuemin', String(Math.round(bounds.minimum * 100)));
  handle.setAttribute('aria-valuemax', String(Math.round(bounds.maximum * 100)));
  handle.setAttribute('aria-valuenow', String(Math.round(ratio * 100)));
  handle.setAttribute('aria-valuetext', 'Components pane ' + String(Math.round(ratio * 100)) + '%');
  return ratio;
}

/** Reapplies the independently stored ratio whenever responsive orientation changes. */
function refreshPreviewInspectorCompanionPaneLayout(workbench, handle) {
  const axis = readPreviewInspectorCompanionPaneAxis(workbench);
  const stateName = axis === 'columns' ? 'columnsRatio' : 'rowsRatio';
  applyPreviewInspectorCompanionPaneRatio(
    workbench,
    handle,
    axis,
    previewInspectorCompanionPaneState[stateName],
  );
}

/** Tracks one captured pointer and updates only local grid styles until the gesture completes. */
function beginPreviewInspectorCompanionPanePointerResize(event, workbench, handle) {
  if (event.button !== 0) return;
  event.preventDefault();
  event.stopPropagation();
  const pointerId = event.pointerId;
  handle.setAttribute('data-dragging', 'true');
  const move = (nextEvent) => {
    if (nextEvent.pointerId !== pointerId) return;
    const axis = readPreviewInspectorCompanionPaneAxis(workbench);
    const bounds = readPreviewInspectorCompanionPaneBounds(workbench, axis);
    const rectangle = workbench.getBoundingClientRect();
    const offset = axis === 'columns'
      ? nextEvent.clientX - rectangle.left
      : nextEvent.clientY - rectangle.top;
    applyPreviewInspectorCompanionPaneRatio(workbench, handle, axis, offset / bounds.extent);
  };
  const finish = (nextEvent) => {
    if (nextEvent.pointerId !== pointerId) return;
    handle.removeAttribute('data-dragging');
    handle.removeEventListener('pointermove', move);
    handle.removeEventListener('pointerup', finish);
    handle.removeEventListener('pointercancel', finish);
    try { handle.releasePointerCapture?.(pointerId); } catch { /* Capture may already be gone. */ }
    persistPreviewInspectorCompanionPaneState();
  };
  handle.addEventListener('pointermove', move);
  handle.addEventListener('pointerup', finish);
  handle.addEventListener('pointercancel', finish);
  try { handle.setPointerCapture?.(pointerId); } catch { /* Pointer capture is an enhancement. */ }
}

/** Supports precise arrows, larger Shift+arrow steps, and Home/End pane bounds. */
function handlePreviewInspectorCompanionPaneKeyDown(event, workbench, handle) {
  const axis = readPreviewInspectorCompanionPaneAxis(workbench);
  const stateName = axis === 'columns' ? 'columnsRatio' : 'rowsRatio';
  const bounds = readPreviewInspectorCompanionPaneBounds(workbench, axis);
  const step = event.shiftKey ? 0.08 : 0.025;
  let next = previewInspectorCompanionPaneState[stateName];
  if (event.key === 'Home') next = bounds.minimum;
  else if (event.key === 'End') next = bounds.maximum;
  else if (axis === 'columns' && event.key === 'ArrowLeft') next -= step;
  else if (axis === 'columns' && event.key === 'ArrowRight') next += step;
  else if (axis === 'rows' && event.key === 'ArrowUp') next -= step;
  else if (axis === 'rows' && event.key === 'ArrowDown') next += step;
  else return;
  event.preventDefault();
  event.stopPropagation();
  applyPreviewInspectorCompanionPaneRatio(workbench, handle, axis, next);
  persistPreviewInspectorCompanionPaneState();
}

/** Restores the current orientation's default proportion on a separator double click. */
function resetPreviewInspectorCompanionPaneRatio(event, workbench, handle) {
  event.preventDefault();
  event.stopPropagation();
  const axis = readPreviewInspectorCompanionPaneAxis(workbench);
  const stateName = axis === 'columns' ? 'columnsRatio' : 'rowsRatio';
  applyPreviewInspectorCompanionPaneRatio(
    workbench,
    handle,
    axis,
    PREVIEW_INSPECTOR_COMPANION_PANE_DEFAULTS[stateName],
  );
  persistPreviewInspectorCompanionPaneState();
}

/** Inserts one local splitter between the sanitized Components and Details panes. */
function installPreviewInspectorCompanionPaneResize() {
  disposePreviewInspectorCompanionPaneResize();
  disposePreviewInspectorCompanionPaneResize = () => undefined;
  const workbench = mirror.querySelector('.rpi-workbench');
  const panes = workbench === null
    ? []
    : [...workbench.children].filter((child) => child.classList.contains('rpi-pane'));
  if (workbench === null || panes.length < 2) return;
  const handle = document.createElement('div');
  handle.className = 'rpi-pane-resize-handle';
  handle.setAttribute('aria-label', 'Resize Components and Details panes');
  handle.setAttribute('role', 'separator');
  handle.setAttribute('tabindex', '0');
  handle.setAttribute('title', 'Drag or use arrow keys to resize panes; double-click to reset');
  workbench.insertBefore(handle, panes[1]);
  const refresh = () => refreshPreviewInspectorCompanionPaneLayout(workbench, handle);
  const pointerDown = (event) => beginPreviewInspectorCompanionPanePointerResize(
    event,
    workbench,
    handle,
  );
  const keyDown = (event) => handlePreviewInspectorCompanionPaneKeyDown(
    event,
    workbench,
    handle,
  );
  const doubleClick = (event) => resetPreviewInspectorCompanionPaneRatio(
    event,
    workbench,
    handle,
  );
  handle.addEventListener('pointerdown', pointerDown);
  handle.addEventListener('keydown', keyDown);
  handle.addEventListener('dblclick', doubleClick);
  const observer = typeof ResizeObserver === 'function' ? new ResizeObserver(refresh) : undefined;
  if (observer !== undefined) observer.observe(workbench);
  else globalThis.addEventListener?.('resize', refresh);
  refresh();
  disposePreviewInspectorCompanionPaneResize = () => {
    observer?.disconnect();
    globalThis.removeEventListener?.('resize', refresh);
    handle.removeEventListener('pointerdown', pointerDown);
    handle.removeEventListener('keydown', keyDown);
    handle.removeEventListener('dblclick', doubleClick);
  };
}
`;
}
