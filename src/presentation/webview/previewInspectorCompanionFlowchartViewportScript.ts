/**
 * Generates the dedicated Inspector tab's local render-flow camera controller.
 *
 * The preview webview owns React and blocker state, while the companion tab owns the pixels the
 * user actually sees. Zooming or scrolling the hidden authoritative shell therefore cannot move
 * the visible graph. This controller applies only bounded, extension-authored camera state to the
 * sanitized companion DOM and never evaluates project code or trusts mirrored inline geometry.
 */

/** Lowest magnification reachable through ordinary plus/minus camera controls. */
export const PREVIEW_INSPECTOR_COMPANION_FLOWCHART_MIN_ZOOM = 35;

/** Lowest magnification reserved for fitting the complete bounded 128-node graph. */
export const PREVIEW_INSPECTOR_COMPANION_FLOWCHART_FIT_MIN_ZOOM = 1;

/** Highest graph magnification accepted from restored companion state. */
export const PREVIEW_INSPECTOR_COMPANION_FLOWCHART_MAX_ZOOM = 200;

/** Magnification delta used by the explicit plus and minus toolbar buttons. */
export const PREVIEW_INSPECTOR_COMPANION_FLOWCHART_ZOOM_STEP = 10;

/**
 * Creates browser source that controls only the visible companion flowchart viewport.
 *
 * Expected lexical bindings are the companion document's `mirror` element and `vscode` API. The
 * generated helpers are installed after every sanitized snapshot, preserve a normalized viewport
 * center across graph-size changes, and merge their bounded state with unrelated webview state.
 * Toolbar buttons opt in with `data-rpi-flowchart-command`; every command except `locate-current`
 * is consumed locally. Locate also reaches the authoritative button so its selected resolver pane
 * stays synchronized with the graph that was centered locally.
 *
 * @returns Inert companion-only JavaScript embedded under the document's nonce-authorized script.
 */
export function createPreviewInspectorCompanionFlowchartViewportScript(): string {
  return String.raw`
const PREVIEW_INSPECTOR_COMPANION_FLOWCHART_MIN_ZOOM =
  ${PREVIEW_INSPECTOR_COMPANION_FLOWCHART_MIN_ZOOM};
const PREVIEW_INSPECTOR_COMPANION_FLOWCHART_FIT_MIN_ZOOM =
  ${PREVIEW_INSPECTOR_COMPANION_FLOWCHART_FIT_MIN_ZOOM};
const PREVIEW_INSPECTOR_COMPANION_FLOWCHART_MAX_ZOOM =
  ${PREVIEW_INSPECTOR_COMPANION_FLOWCHART_MAX_ZOOM};
const PREVIEW_INSPECTOR_COMPANION_FLOWCHART_ZOOM_STEP =
  ${PREVIEW_INSPECTOR_COMPANION_FLOWCHART_ZOOM_STEP};
const PREVIEW_INSPECTOR_COMPANION_FLOWCHART_STATE_KEY =
  'reactPreviewInspectorFlowchartCamera';
const previewInspectorCompanionFlowchartCommands = new Set([
  'zoom-out', 'zoom-reset', 'zoom-in', 'center-selected', 'fit', 'locate-current',
]);

/** Restricts a restored or computed zoom percentage to a caller-selected safe camera range. */
function normalizePreviewInspectorCompanionFlowchartZoom(
  value,
  fallback = 100,
  minimum = PREVIEW_INSPECTOR_COMPANION_FLOWCHART_FIT_MIN_ZOOM,
) {
  const finite = Number.isFinite(value) ? Number(value) : fallback;
  return Math.min(
    PREVIEW_INSPECTOR_COMPANION_FLOWCHART_MAX_ZOOM,
    Math.max(minimum, Math.round(finite)),
  );
}

/** Restricts one normalized canvas-center coordinate without accepting NaN or infinity. */
function normalizePreviewInspectorCompanionFlowchartCenter(value, fallback = 0.5) {
  const finite = Number.isFinite(value) ? Number(value) : fallback;
  return Math.min(1, Math.max(0, finite));
}

/** Accepts only the three extension-authored graph scopes stored with camera state. */
function normalizePreviewInspectorCompanionFlowchartViewMode(value) {
  return value === 'focus' || value === 'main' || value === 'all' ? value : undefined;
}

/** Reads the latest sanitized graph scope without trusting arbitrary mirrored attributes. */
function readPreviewInspectorCompanionFlowchartViewMode() {
  const flowchart = mirror.querySelector?.('.rpi-flowchart');
  return normalizePreviewInspectorCompanionFlowchartViewMode(
    flowchart?.getAttribute?.('data-rpi-flowchart-view'),
  );
}

/** Accepts only the bounded view/count/hash key minted by the preview-side graph renderer. */
function normalizePreviewInspectorCompanionFlowchartCameraKey(value) {
  return typeof value === 'string' &&
    /^(?:focus|main|all):\d{1,3}:[a-z0-9]+$/u.test(value)
    ? value
    : undefined;
}

/** Reads visible geometry identity without coupling camera behavior to ordinary node selection. */
function readPreviewInspectorCompanionFlowchartCameraKey() {
  const flowchart = mirror.querySelector?.('.rpi-flowchart');
  return normalizePreviewInspectorCompanionFlowchartCameraKey(
    flowchart?.getAttribute?.('data-rpi-flowchart-camera-key'),
  );
}

/** Reads this document's bounded graph camera while ignoring every unrelated persisted field. */
function readPreviewInspectorCompanionFlowchartState() {
  let persisted;
  try { persisted = vscode.getState?.(); } catch { persisted = undefined; }
  const source = persisted?.[PREVIEW_INSPECTOR_COMPANION_FLOWCHART_STATE_KEY];
  return {
    centerX: normalizePreviewInspectorCompanionFlowchartCenter(source?.centerX),
    centerY: normalizePreviewInspectorCompanionFlowchartCenter(source?.centerY),
    graphKey: normalizePreviewInspectorCompanionFlowchartCameraKey(source?.graphKey),
    viewMode: normalizePreviewInspectorCompanionFlowchartViewMode(source?.viewMode),
    zoomPercent: normalizePreviewInspectorCompanionFlowchartZoom(source?.zoomPercent),
  };
}

let previewInspectorCompanionFlowchartState =
  readPreviewInspectorCompanionFlowchartState();
let disposePreviewInspectorCompanionFlowchartViewport = () => undefined;

/** Merges camera values into VS Code state so pane proportions and future state remain intact. */
function persistPreviewInspectorCompanionFlowchartState() {
  let current;
  try { current = vscode.getState?.(); } catch { current = undefined; }
  const root = current !== null && typeof current === 'object' && !Array.isArray(current)
    ? current
    : {};
  try {
    vscode.setState?.({
      ...root,
      [PREVIEW_INSPECTOR_COMPANION_FLOWCHART_STATE_KEY]: {
        ...previewInspectorCompanionFlowchartState,
      },
    });
  } catch { /* A closing companion can reject its final best-effort camera write. */ }
}

/** Resolves the one visible graph viewport and canvas from the latest sanitized snapshot. */
function readPreviewInspectorCompanionFlowchartElements() {
  const viewport = mirror.querySelector?.('.rpi-flowchart-viewport');
  const canvas = viewport?.querySelector?.('.rpi-flowchart-canvas') ??
    mirror.querySelector?.('.rpi-flowchart-canvas');
  return viewport === null || viewport === undefined || canvas === null || canvas === undefined
    ? undefined
    : { canvas, viewport };
}

/** Converts a scroll surface into the normalized visual center stored across graph replacements. */
function readPreviewInspectorCompanionFlowchartCenter(viewport) {
  const width = Math.max(1, Number(viewport.scrollWidth) || Number(viewport.clientWidth) || 1);
  const height = Math.max(1, Number(viewport.scrollHeight) || Number(viewport.clientHeight) || 1);
  return {
    centerX: normalizePreviewInspectorCompanionFlowchartCenter(
      (Number(viewport.scrollLeft) + Number(viewport.clientWidth) / 2) / width,
    ),
    centerY: normalizePreviewInspectorCompanionFlowchartCenter(
      (Number(viewport.scrollTop) + Number(viewport.clientHeight) / 2) / height,
    ),
  };
}

/** Writes only the graph viewport's scroll offsets and never moves the companion document. */
function applyPreviewInspectorCompanionFlowchartCenter(viewport, center) {
  const width = Math.max(1, Number(viewport.scrollWidth) || Number(viewport.clientWidth) || 1);
  const height = Math.max(1, Number(viewport.scrollHeight) || Number(viewport.clientHeight) || 1);
  const maximumLeft = Math.max(0, width - (Number(viewport.clientWidth) || 0));
  const maximumTop = Math.max(0, height - (Number(viewport.clientHeight) || 0));
  viewport.scrollLeft = Math.min(maximumLeft, Math.max(
    0,
    normalizePreviewInspectorCompanionFlowchartCenter(center?.centerX) * width -
      (Number(viewport.clientWidth) || 0) / 2,
  ));
  viewport.scrollTop = Math.min(maximumTop, Math.max(
    0,
    normalizePreviewInspectorCompanionFlowchartCenter(center?.centerY) * height -
      (Number(viewport.clientHeight) || 0) / 2,
  ));
}

/** Updates local toolbar feedback and disables zoom buttons only at their exact safe bounds. */
function refreshPreviewInspectorCompanionFlowchartControls() {
  const zoomPercent = previewInspectorCompanionFlowchartState.zoomPercent;
  for (const label of mirror.querySelectorAll?.('[data-rpi-flowchart-zoom-label]') ?? []) {
    label.textContent = String(zoomPercent) + '%';
    label.setAttribute?.('aria-label', 'Render flow zoom ' + String(zoomPercent) + '%');
  }
  for (const button of mirror.querySelectorAll?.('[data-rpi-flowchart-command]') ?? []) {
    const command = button.getAttribute?.('data-rpi-flowchart-command');
    const disabled = command === 'zoom-out'
      ? zoomPercent <= PREVIEW_INSPECTOR_COMPANION_FLOWCHART_MIN_ZOOM
      : command === 'zoom-in'
        ? zoomPercent >= PREVIEW_INSPECTOR_COMPANION_FLOWCHART_MAX_ZOOM
        : false;
    if (disabled) button.setAttribute?.('disabled', '');
    else button.removeAttribute?.('disabled');
  }
}

/** Publishes a concise local camera result without requiring a React rerender. */
function writePreviewInspectorCompanionFlowchartStatus(message) {
  for (const status of mirror.querySelectorAll?.('[data-rpi-flowchart-camera-status]') ?? []) {
    status.textContent = message;
  }
}

/** Applies zoom through an extension-owned mirror variable rather than sanitized mirrored style. */
function applyPreviewInspectorCompanionFlowchartZoom(zoomPercent) {
  previewInspectorCompanionFlowchartState = {
    ...previewInspectorCompanionFlowchartState,
    zoomPercent: normalizePreviewInspectorCompanionFlowchartZoom(zoomPercent),
  };
  mirror.style?.setProperty?.(
    '--rpi-companion-flowchart-zoom',
    String(previewInspectorCompanionFlowchartState.zoomPercent / 100),
  );
  refreshPreviewInspectorCompanionFlowchartControls();
}

/** Captures the live graph center before zoom, resize, or sanitized snapshot replacement. */
function capturePreviewInspectorCompanionFlowchartCamera() {
  const elements = readPreviewInspectorCompanionFlowchartElements();
  if (elements !== undefined) {
    previewInspectorCompanionFlowchartState = {
      ...previewInspectorCompanionFlowchartState,
      ...readPreviewInspectorCompanionFlowchartCenter(elements.viewport),
      graphKey: readPreviewInspectorCompanionFlowchartCameraKey() ??
        previewInspectorCompanionFlowchartState.graphKey,
      viewMode: readPreviewInspectorCompanionFlowchartViewMode() ??
        previewInspectorCompanionFlowchartState.viewMode,
    };
  }
  return { ...previewInspectorCompanionFlowchartState };
}

/** Restores bounded zoom and relative center after the latest companion graph is in the DOM. */
function restorePreviewInspectorCompanionFlowchartCamera(snapshot) {
  const source = snapshot !== null && typeof snapshot === 'object' ? snapshot : {};
  const currentViewMode = readPreviewInspectorCompanionFlowchartViewMode();
  const restoredViewMode = normalizePreviewInspectorCompanionFlowchartViewMode(source.viewMode) ??
    previewInspectorCompanionFlowchartState.viewMode;
  const currentGraphKey = readPreviewInspectorCompanionFlowchartCameraKey();
  const restoredGraphKey = normalizePreviewInspectorCompanionFlowchartCameraKey(source.graphKey) ??
    previewInspectorCompanionFlowchartState.graphKey;
  const compactGraphChanged = currentViewMode !== 'all' &&
    currentGraphKey !== restoredGraphKey;
  if (currentViewMode !== undefined &&
    (currentViewMode !== restoredViewMode || compactGraphChanged)) {
    previewInspectorCompanionFlowchartState = {
      ...previewInspectorCompanionFlowchartState,
      graphKey: currentGraphKey,
      viewMode: currentViewMode,
    };
    fitPreviewInspectorCompanionFlowchart();
    return;
  }
  previewInspectorCompanionFlowchartState = {
    centerX: normalizePreviewInspectorCompanionFlowchartCenter(
      source.centerX,
      previewInspectorCompanionFlowchartState.centerX,
    ),
    centerY: normalizePreviewInspectorCompanionFlowchartCenter(
      source.centerY,
      previewInspectorCompanionFlowchartState.centerY,
    ),
    graphKey: currentGraphKey ?? restoredGraphKey ??
      previewInspectorCompanionFlowchartState.graphKey,
    viewMode: currentViewMode ?? restoredViewMode ??
      previewInspectorCompanionFlowchartState.viewMode,
    zoomPercent: normalizePreviewInspectorCompanionFlowchartZoom(
      source.zoomPercent,
      previewInspectorCompanionFlowchartState.zoomPercent,
    ),
  };
  applyPreviewInspectorCompanionFlowchartZoom(
    previewInspectorCompanionFlowchartState.zoomPercent,
  );
  const elements = readPreviewInspectorCompanionFlowchartElements();
  if (elements !== undefined) {
    applyPreviewInspectorCompanionFlowchartCenter(
      elements.viewport,
      previewInspectorCompanionFlowchartState,
    );
  }
  persistPreviewInspectorCompanionFlowchartState();
}

/** Changes magnification while keeping the same graph point under the viewport center. */
function setPreviewInspectorCompanionFlowchartZoom(zoomPercent, status) {
  const elements = readPreviewInspectorCompanionFlowchartElements();
  if (elements !== undefined) {
    previewInspectorCompanionFlowchartState = {
      ...previewInspectorCompanionFlowchartState,
      ...readPreviewInspectorCompanionFlowchartCenter(elements.viewport),
    };
  }
  applyPreviewInspectorCompanionFlowchartZoom(
    normalizePreviewInspectorCompanionFlowchartZoom(
      zoomPercent,
      previewInspectorCompanionFlowchartState.zoomPercent,
      PREVIEW_INSPECTOR_COMPANION_FLOWCHART_MIN_ZOOM,
    ),
  );
  const refreshed = readPreviewInspectorCompanionFlowchartElements();
  if (refreshed !== undefined) {
    applyPreviewInspectorCompanionFlowchartCenter(
      refreshed.viewport,
      previewInspectorCompanionFlowchartState,
    );
  }
  persistPreviewInspectorCompanionFlowchartState();
  writePreviewInspectorCompanionFlowchartStatus(status);
}

/** Centers one selected/current node by bounded rectangle deltas inside the graph viewport only. */
function centerPreviewInspectorCompanionFlowchartElement(element, status) {
  const elements = readPreviewInspectorCompanionFlowchartElements();
  const viewportBounds = elements?.viewport.getBoundingClientRect?.();
  const elementBounds = element?.getBoundingClientRect?.();
  if (elements === undefined || viewportBounds === undefined || elementBounds === undefined) {
    writePreviewInspectorCompanionFlowchartStatus('The requested render-flow node is unavailable.');
    return false;
  }
  const maximumLeft = Math.max(
    0,
    Number(elements.viewport.scrollWidth) - Number(elements.viewport.clientWidth),
  );
  const maximumTop = Math.max(
    0,
    Number(elements.viewport.scrollHeight) - Number(elements.viewport.clientHeight),
  );
  const nextLeft = Number(elements.viewport.scrollLeft) +
    Number(elementBounds.left) + Number(elementBounds.width) / 2 -
    (Number(viewportBounds.left) + Number(viewportBounds.width) / 2);
  const nextTop = Number(elements.viewport.scrollTop) +
    Number(elementBounds.top) + Number(elementBounds.height) / 2 -
    (Number(viewportBounds.top) + Number(viewportBounds.height) / 2);
  elements.viewport.scrollLeft = Math.min(maximumLeft, Math.max(0, nextLeft));
  elements.viewport.scrollTop = Math.min(maximumTop, Math.max(0, nextTop));
  previewInspectorCompanionFlowchartState = {
    ...previewInspectorCompanionFlowchartState,
    ...readPreviewInspectorCompanionFlowchartCenter(elements.viewport),
  };
  persistPreviewInspectorCompanionFlowchartState();
  writePreviewInspectorCompanionFlowchartStatus(status);
  return true;
}

/** Finds the selected resolver node, falling back to the selected current-file export. */
function centerSelectedPreviewInspectorCompanionFlowchartNode() {
  const selected = mirror.querySelector?.(
    '.rpi-flowchart-node[data-rpi-flowchart-node][aria-pressed="true"]',
  );
  const current = mirror.querySelector?.(
    '.rpi-flowchart-node[data-rpi-current-file="true"]',
  );
  if (selected !== null && selected !== undefined) {
    return centerPreviewInspectorCompanionFlowchartElement(selected, 'Centered selected block.');
  }
  if (current !== null && current !== undefined) {
    return centerPreviewInspectorCompanionFlowchartElement(current, 'Centered current file.');
  }
  const elements = readPreviewInspectorCompanionFlowchartElements();
  if (elements === undefined) return false;
  previewInspectorCompanionFlowchartState = {
    ...previewInspectorCompanionFlowchartState,
    centerX: 0.5,
    centerY: 0.5,
  };
  applyPreviewInspectorCompanionFlowchartCenter(
    elements.viewport,
    previewInspectorCompanionFlowchartState,
  );
  persistPreviewInspectorCompanionFlowchartState();
  writePreviewInspectorCompanionFlowchartStatus('Centered render flow.');
  return true;
}

/** Fits the unscaled graph into the visible viewport and then centers the complete canvas. */
function fitPreviewInspectorCompanionFlowchart() {
  const before = capturePreviewInspectorCompanionFlowchartCamera();
  applyPreviewInspectorCompanionFlowchartZoom(100);
  const elements = readPreviewInspectorCompanionFlowchartElements();
  if (elements === undefined) return false;
  const canvasBounds = elements.canvas.getBoundingClientRect?.();
  const naturalWidth = Math.max(
    1,
    Number(elements.canvas.scrollWidth) || Number(canvasBounds?.width) || 1,
  );
  const naturalHeight = Math.max(
    1,
    Number(elements.canvas.scrollHeight) || Number(canvasBounds?.height) || 1,
  );
  const availableWidth = Math.max(1, Number(elements.viewport.clientWidth) - 24);
  const availableHeight = Math.max(1, Number(elements.viewport.clientHeight) - 24);
  const fitPercent = normalizePreviewInspectorCompanionFlowchartZoom(
    Math.floor(Math.min(availableWidth / naturalWidth, availableHeight / naturalHeight) * 100),
    before.zoomPercent,
    PREVIEW_INSPECTOR_COMPANION_FLOWCHART_FIT_MIN_ZOOM,
  );
  previewInspectorCompanionFlowchartState = {
    centerX: 0.5,
    centerY: 0.5,
    graphKey: readPreviewInspectorCompanionFlowchartCameraKey() ??
      previewInspectorCompanionFlowchartState.graphKey,
    viewMode: readPreviewInspectorCompanionFlowchartViewMode() ??
      previewInspectorCompanionFlowchartState.viewMode,
    zoomPercent: fitPercent,
  };
  applyPreviewInspectorCompanionFlowchartZoom(fitPercent);
  const fitted = readPreviewInspectorCompanionFlowchartElements();
  if (fitted !== undefined) {
    applyPreviewInspectorCompanionFlowchartCenter(
      fitted.viewport,
      previewInspectorCompanionFlowchartState,
    );
  }
  persistPreviewInspectorCompanionFlowchartState();
  writePreviewInspectorCompanionFlowchartStatus(
    'Fit render flow at ' + String(fitPercent) + '%.',
  );
  return true;
}

/**
 * Centers the exact current-file entry, or the closest graph-proven obstruction/static context.
 * React subsequently selects the same logical locator result and refreshes Resolver details.
 */
function locateCurrentPreviewInspectorCompanionFlowchartNode() {
  const current = mirror.querySelector?.(
    '.rpi-flowchart-node[data-rpi-current-file="true"]',
  );
  const blocker = mirror.querySelector?.(
    '.rpi-flowchart-node[data-rpi-current-file-path-blocker="true"]',
  );
  const context = mirror.querySelector?.(
    '.rpi-flowchart-node[data-rpi-current-file-context="true"]',
  );
  const target = current ?? blocker ?? context;
  const status = current !== null && current !== undefined
    ? 'Located current file. Its resolver details will open next.'
    : blocker !== null && blocker !== undefined
      ? 'Located the nearest blocker before the current file.'
      : context !== null && context !== undefined
        ? 'Located static current-file evidence; this branch has not mounted it.'
        : 'Current file is not present in this bounded render flow.';
  return centerPreviewInspectorCompanionFlowchartElement(
    target,
    status,
  );
}

/**
 * Runs one allowlisted camera command and tells the delegated bridge whether to relay it.
 * Locate is intentionally local-and-remote: local centering owns pixels while React owns selection.
 */
function handlePreviewInspectorCompanionFlowchartCommand(control) {
  const command = control?.getAttribute?.('data-rpi-flowchart-command');
  if (!previewInspectorCompanionFlowchartCommands.has(command)) return undefined;
  if (command === 'zoom-out') {
    setPreviewInspectorCompanionFlowchartZoom(
      previewInspectorCompanionFlowchartState.zoomPercent -
        PREVIEW_INSPECTOR_COMPANION_FLOWCHART_ZOOM_STEP,
      'Zoomed render flow out.',
    );
  } else if (command === 'zoom-reset') {
    setPreviewInspectorCompanionFlowchartZoom(100, 'Reset render-flow zoom to 100%.');
  } else if (command === 'zoom-in') {
    setPreviewInspectorCompanionFlowchartZoom(
      previewInspectorCompanionFlowchartState.zoomPercent +
        PREVIEW_INSPECTOR_COMPANION_FLOWCHART_ZOOM_STEP,
      'Zoomed render flow in.',
    );
  } else if (command === 'center-selected') {
    centerSelectedPreviewInspectorCompanionFlowchartNode();
  } else if (command === 'fit') {
    fitPreviewInspectorCompanionFlowchart();
  } else if (command === 'locate-current') {
    locateCurrentPreviewInspectorCompanionFlowchartNode();
    return 'local-and-remote';
  }
  return 'local-only';
}

/**
 * Identifies controls that must retain ordinary click/selection semantics instead of starting a
 * primary-button canvas pan. Middle-button behavior remains browser-native and is not intercepted.
 */
function isPreviewInspectorCompanionFlowchartInteractiveTarget(target) {
  const control = target?.closest?.(
    'button,a,input,select,textarea,[role="button"],[data-rpi-flowchart-node]',
  );
  return control !== null && control !== undefined;
}

/**
 * Adds grab-to-pan on graph whitespace without converting nodes or the surrounding document into
 * drag handles. Pointer capture keeps the gesture stable when the cursor leaves the viewport.
 */
function installPreviewInspectorCompanionFlowchartPanning(elements, lifecycle = {}) {
  let gesture;
  let suppressNextClick = false;
  const viewport = elements.viewport;
  const finish = (event) => {
    if (gesture === undefined || (event?.pointerId !== undefined &&
      event.pointerId !== gesture.pointerId)) return;
    const completedGesture = gesture;
    gesture = undefined;
    try { viewport.releasePointerCapture?.(completedGesture.pointerId); } catch {}
    viewport.removeAttribute?.('data-rpi-panning');
    if (!completedGesture.moved) return;
    suppressNextClick = true;
    globalThis.setTimeout?.(() => { suppressNextClick = false; }, 0);
    lifecycle.onComplete?.();
    writePreviewInspectorCompanionFlowchartStatus('Panned render flow.');
  };
  const onPointerDown = (event) => {
    if (event?.button !== 0 || event?.isPrimary === false ||
      isPreviewInspectorCompanionFlowchartInteractiveTarget(event?.target)) return;
    gesture = {
      moved: false,
      pointerId: event.pointerId,
      startClientX: Number(event.clientX) || 0,
      startClientY: Number(event.clientY) || 0,
      startScrollLeft: Number(viewport.scrollLeft) || 0,
      startScrollTop: Number(viewport.scrollTop) || 0,
    };
    lifecycle.onStart?.();
    try { viewport.setPointerCapture?.(event.pointerId); } catch {}
    viewport.setAttribute?.('data-rpi-panning', 'true');
    event.preventDefault?.();
  };
  const onPointerMove = (event) => {
    if (gesture === undefined || event?.pointerId !== gesture.pointerId) return;
    const deltaX = (Number(event.clientX) || 0) - gesture.startClientX;
    const deltaY = (Number(event.clientY) || 0) - gesture.startClientY;
    if (Math.abs(deltaX) + Math.abs(deltaY) >= 3) gesture.moved = true;
    viewport.scrollLeft = gesture.startScrollLeft - deltaX;
    viewport.scrollTop = gesture.startScrollTop - deltaY;
    event.preventDefault?.();
  };
  const onClick = (event) => {
    if (!suppressNextClick) return;
    suppressNextClick = false;
    event.preventDefault?.();
    event.stopPropagation?.();
  };
  viewport.addEventListener?.('pointerdown', onPointerDown);
  viewport.addEventListener?.('pointermove', onPointerMove);
  viewport.addEventListener?.('pointerup', finish);
  viewport.addEventListener?.('pointercancel', finish);
  viewport.addEventListener?.('lostpointercapture', finish);
  viewport.addEventListener?.('click', onClick);
  return () => {
    if (gesture !== undefined) {
      const pointerId = gesture.pointerId;
      gesture = undefined;
      try { viewport.releasePointerCapture?.(pointerId); } catch {}
    }
    viewport.removeAttribute?.('data-rpi-panning');
    viewport.removeEventListener?.('pointerdown', onPointerDown);
    viewport.removeEventListener?.('pointermove', onPointerMove);
    viewport.removeEventListener?.('pointerup', finish);
    viewport.removeEventListener?.('pointercancel', finish);
    viewport.removeEventListener?.('lostpointercapture', finish);
    viewport.removeEventListener?.('click', onClick);
  };
}

/** Rebinds camera, panning, scroll, and resize observers to the latest sanitized graph snapshot. */
function installPreviewInspectorCompanionFlowchartViewport() {
  disposePreviewInspectorCompanionFlowchartViewport();
  disposePreviewInspectorCompanionFlowchartViewport = () => undefined;
  applyPreviewInspectorCompanionFlowchartZoom(
    previewInspectorCompanionFlowchartState.zoomPercent,
  );
  const elements = readPreviewInspectorCompanionFlowchartElements();
  if (elements === undefined) return;
  let cancelScheduledPersistence = () => undefined;
  let persistenceScheduled = false;
  const commitCenter = () => {
    persistenceScheduled = false;
    cancelScheduledPersistence = () => undefined;
    persistPreviewInspectorCompanionFlowchartState();
  };
  const scheduleCenterPersistence = () => {
    if (persistenceScheduled) return;
    persistenceScheduled = true;
    if (typeof globalThis.requestAnimationFrame === 'function') {
      const handle = globalThis.requestAnimationFrame(commitCenter);
      cancelScheduledPersistence = () => {
        globalThis.cancelAnimationFrame?.(handle);
        persistenceScheduled = false;
      };
      return;
    }
    const handle = globalThis.setTimeout?.(commitCenter, 16);
    cancelScheduledPersistence = () => {
      if (handle !== undefined) globalThis.clearTimeout?.(handle);
      persistenceScheduled = false;
    };
  };
  const remember = () => {
    previewInspectorCompanionFlowchartState = {
      ...previewInspectorCompanionFlowchartState,
      ...readPreviewInspectorCompanionFlowchartCenter(elements.viewport),
    };
    if (elements.viewport.getAttribute?.('data-rpi-panning') === 'true') return;
    scheduleCenterPersistence();
  };
  const restoreCenter = () => applyPreviewInspectorCompanionFlowchartCenter(
    elements.viewport,
    previewInspectorCompanionFlowchartState,
  );
  const disposePanning = installPreviewInspectorCompanionFlowchartPanning(elements, {
    onComplete: () => {
      previewInspectorCompanionFlowchartState = {
        ...previewInspectorCompanionFlowchartState,
        ...readPreviewInspectorCompanionFlowchartCenter(elements.viewport),
      };
      persistPreviewInspectorCompanionFlowchartState();
    },
    onStart: () => cancelScheduledPersistence(),
  });
  elements.viewport.addEventListener?.('scroll', remember, { passive: true });
  const observer = typeof ResizeObserver === 'function'
    ? new ResizeObserver(restoreCenter)
    : undefined;
  if (observer !== undefined) observer.observe(elements.viewport);
  else globalThis.addEventListener?.('resize', restoreCenter);
  refreshPreviewInspectorCompanionFlowchartControls();
  disposePreviewInspectorCompanionFlowchartViewport = () => {
    cancelScheduledPersistence();
    disposePanning();
    elements.viewport.removeEventListener?.('scroll', remember);
    observer?.disconnect?.();
    globalThis.removeEventListener?.('resize', restoreCenter);
  };
}
`;
}
