/**
 * Generates the dedicated Inspector tab's local render-flow camera controller.
 *
 * The preview webview owns React and blocker state, while the companion tab owns the pixels the
 * user actually sees. Zooming or scrolling the hidden authoritative shell therefore cannot move
 * the visible graph. This controller applies only bounded, extension-authored camera state to the
 * sanitized companion DOM and never evaluates project code or trusts mirrored inline geometry.
 */

/** Lowest graph magnification accepted from restored companion state. */
export const PREVIEW_INSPECTOR_COMPANION_FLOWCHART_MIN_ZOOM = 35;

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
const PREVIEW_INSPECTOR_COMPANION_FLOWCHART_MAX_ZOOM =
  ${PREVIEW_INSPECTOR_COMPANION_FLOWCHART_MAX_ZOOM};
const PREVIEW_INSPECTOR_COMPANION_FLOWCHART_ZOOM_STEP =
  ${PREVIEW_INSPECTOR_COMPANION_FLOWCHART_ZOOM_STEP};
const PREVIEW_INSPECTOR_COMPANION_FLOWCHART_STATE_KEY =
  'reactPreviewInspectorFlowchartCamera';
const previewInspectorCompanionFlowchartCommands = new Set([
  'zoom-out', 'zoom-reset', 'zoom-in', 'center-selected', 'fit', 'locate-current',
]);

/** Restricts a restored or computed zoom percentage to the supported finite camera range. */
function normalizePreviewInspectorCompanionFlowchartZoom(value, fallback = 100) {
  const finite = Number.isFinite(value) ? Number(value) : fallback;
  return Math.min(
    PREVIEW_INSPECTOR_COMPANION_FLOWCHART_MAX_ZOOM,
    Math.max(PREVIEW_INSPECTOR_COMPANION_FLOWCHART_MIN_ZOOM, Math.round(finite)),
  );
}

/** Restricts one normalized canvas-center coordinate without accepting NaN or infinity. */
function normalizePreviewInspectorCompanionFlowchartCenter(value, fallback = 0.5) {
  const finite = Number.isFinite(value) ? Number(value) : fallback;
  return Math.min(1, Math.max(0, finite));
}

/** Reads this document's bounded graph camera while ignoring every unrelated persisted field. */
function readPreviewInspectorCompanionFlowchartState() {
  let persisted;
  try { persisted = vscode.getState?.(); } catch { persisted = undefined; }
  const source = persisted?.[PREVIEW_INSPECTOR_COMPANION_FLOWCHART_STATE_KEY];
  return {
    centerX: normalizePreviewInspectorCompanionFlowchartCenter(source?.centerX),
    centerY: normalizePreviewInspectorCompanionFlowchartCenter(source?.centerY),
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
    };
  }
  return { ...previewInspectorCompanionFlowchartState };
}

/** Restores bounded zoom and relative center after the latest companion graph is in the DOM. */
function restorePreviewInspectorCompanionFlowchartCamera(snapshot) {
  const source = snapshot !== null && typeof snapshot === 'object' ? snapshot : {};
  previewInspectorCompanionFlowchartState = {
    centerX: normalizePreviewInspectorCompanionFlowchartCenter(
      source.centerX,
      previewInspectorCompanionFlowchartState.centerX,
    ),
    centerY: normalizePreviewInspectorCompanionFlowchartCenter(
      source.centerY,
      previewInspectorCompanionFlowchartState.centerY,
    ),
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
  applyPreviewInspectorCompanionFlowchartZoom(zoomPercent);
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
  );
  previewInspectorCompanionFlowchartState = {
    centerX: 0.5,
    centerY: 0.5,
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

/** Rebinds scroll/resize observers to the graph created by the latest sanitized snapshot. */
function installPreviewInspectorCompanionFlowchartViewport() {
  disposePreviewInspectorCompanionFlowchartViewport();
  disposePreviewInspectorCompanionFlowchartViewport = () => undefined;
  applyPreviewInspectorCompanionFlowchartZoom(
    previewInspectorCompanionFlowchartState.zoomPercent,
  );
  const elements = readPreviewInspectorCompanionFlowchartElements();
  if (elements === undefined) return;
  const remember = () => {
    previewInspectorCompanionFlowchartState = {
      ...previewInspectorCompanionFlowchartState,
      ...readPreviewInspectorCompanionFlowchartCenter(elements.viewport),
    };
    persistPreviewInspectorCompanionFlowchartState();
  };
  const restoreCenter = () => applyPreviewInspectorCompanionFlowchartCenter(
    elements.viewport,
    previewInspectorCompanionFlowchartState,
  );
  elements.viewport.addEventListener?.('scroll', remember, { passive: true });
  const observer = typeof ResizeObserver === 'function'
    ? new ResizeObserver(restoreCenter)
    : undefined;
  if (observer !== undefined) observer.observe(elements.viewport);
  else globalThis.addEventListener?.('resize', restoreCenter);
  refreshPreviewInspectorCompanionFlowchartControls();
  disposePreviewInspectorCompanionFlowchartViewport = () => {
    elements.viewport.removeEventListener?.('scroll', remember);
    observer?.disconnect?.();
    globalThis.removeEventListener?.('resize', restoreCenter);
  };
}
`;
}
