/**
 * Generates local accordion and section resizing for the separate Inspector editor tab.
 *
 * The companion webview receives inert, sanitized Inspector markup rather than project JavaScript.
 * Its resize/disclosure controls therefore need a document-local controller instead of forwarding
 * interaction to the hidden renderer. Heights and collapsed sections are kept in VS Code webview
 * state and reapplied whenever a newer Inspector snapshot replaces the mirrored DOM.
 */

/**
 * Creates browser source that activates mirrored accordion, card, and tree/detail height controls.
 *
 * The generated source expects the companion IIFE's `mirror` element and `vscode` API binding.
 * It modifies only CSS height/grid variables inside the inert mirror, so pointer movement cannot
 * execute project code or cause the renderer's component tree to remount.
 *
 * @returns Inert companion-only JavaScript embedded under the document's nonce-authorized script.
 */
export function createPreviewInspectorCompanionInnerResizeScript(): string {
  return String.raw`
const PREVIEW_INSPECTOR_COMPANION_INNER_STATE_KEY = 'reactPreviewInspectorInnerLayout';
const PREVIEW_INSPECTOR_COMPANION_INNER_LAYOUT_VERSION = 3;
const PREVIEW_INSPECTOR_COMPANION_INNER_BOUNDARY_SIZE = 37;
const PREVIEW_INSPECTOR_COMPANION_INNER_STEP = 16;
const PREVIEW_INSPECTOR_COMPANION_CARD_MIN_HEIGHT = 56;
const PREVIEW_INSPECTOR_COMPANION_CARD_MAX_HEIGHT = 4096;
const PREVIEW_INSPECTOR_COMPANION_SECTION_MIN_HEIGHT = 72;
const PREVIEW_INSPECTOR_COMPANION_SECTION_DEFAULT_RATIO = 0.6;
const PREVIEW_INSPECTOR_COMPANION_TOOLBAR_MIN_HEIGHT = 36;
const PREVIEW_INSPECTOR_COMPANION_CONTEXT_MIN_HEIGHT = 72;
const PREVIEW_INSPECTOR_COMPANION_WORKBENCH_MIN_HEIGHT = 120;
const PREVIEW_INSPECTOR_COMPANION_INNER_STATE_LIMIT = 128;

/** Accepts only bounded opaque IDs emitted by the renderer-side resize components. */
function normalizePreviewInspectorCompanionInnerResizeId(value) {
  if (typeof value !== 'string') return '';
  const normalized = value.trim().slice(0, 240);
  return normalized.length === 0 ||
    ['__proto__', 'prototype', 'constructor'].includes(normalized)
    ? ''
    : normalized;
}

/** Clamps one card height against both persisted-state and current-viewport limits. */
function normalizePreviewInspectorCompanionCardHeight(
  value,
  maximum = PREVIEW_INSPECTOR_COMPANION_CARD_MAX_HEIGHT,
) {
  if (!Number.isFinite(value)) return undefined;
  const safeMaximum = Number.isFinite(maximum)
    ? Math.max(PREVIEW_INSPECTOR_COMPANION_CARD_MIN_HEIGHT, maximum)
    : PREVIEW_INSPECTOR_COMPANION_CARD_MAX_HEIGHT;
  return Math.round(Math.min(
    PREVIEW_INSPECTOR_COMPANION_CARD_MAX_HEIGHT,
    safeMaximum,
    Math.max(PREVIEW_INSPECTOR_COMPANION_CARD_MIN_HEIGHT, value),
  ));
}

/** Clamps one mirrored shell region while allowing the toolbar's smaller minimum height. */
function normalizePreviewInspectorCompanionShellRegionHeight(
  value,
  minimum,
  maximum = 4096,
) {
  if (!Number.isFinite(value)) return undefined;
  const safeMinimum = Number.isFinite(minimum) ? Math.max(1, minimum) : 1;
  const safeMaximum = Number.isFinite(maximum)
    ? Math.max(safeMinimum, maximum)
    : 4096;
  return Math.round(Math.min(4096, safeMaximum, Math.max(safeMinimum, value)));
}

/** Keeps both sides of the component-tree splitter reachable. */
function normalizePreviewInspectorCompanionSectionRatio(value, fallback = 0.6) {
  const candidate = Number.isFinite(value) ? value : fallback;
  return Math.min(0.85, Math.max(0.15, candidate));
}

/** Copies a bounded set of finite persisted values into a prototype-safe map. */
function normalizePreviewInspectorCompanionInnerMap(value, normalizeValue) {
  const normalized = Object.create(null);
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return normalized;
  for (const [candidateKey, candidateValue] of Object.entries(value).slice(
    -PREVIEW_INSPECTOR_COMPANION_INNER_STATE_LIMIT,
  )) {
    const key = normalizePreviewInspectorCompanionInnerResizeId(candidateKey);
    const normalizedValue = normalizeValue(candidateValue);
    if (key.length > 0 && normalizedValue !== undefined) normalized[key] = normalizedValue;
  }
  return normalized;
}

/** Restores only extension-owned card heights and section ratios from webview state. */
function readPreviewInspectorCompanionInnerState() {
  let persisted;
  try { persisted = vscode.getState?.(); } catch { persisted = undefined; }
  const source = persisted?.[PREVIEW_INSPECTOR_COMPANION_INNER_STATE_KEY];
  return {
    cardHeights: normalizePreviewInspectorCompanionInnerMap(
      source?.cardHeights,
      (value) => normalizePreviewInspectorCompanionCardHeight(value),
    ),
    collapsedSections: normalizePreviewInspectorCompanionInnerMap(
      source?.collapsedSections,
      (value) => typeof value === 'boolean' ? value : undefined,
    ),
    sectionRatios: normalizePreviewInspectorCompanionInnerMap(
      source?.sectionRatios,
      (value) => Number.isFinite(value)
        ? normalizePreviewInspectorCompanionSectionRatio(value)
        : undefined,
    ),
    shellRegionHeights: normalizePreviewInspectorCompanionInnerMap(
      source?.shellRegionHeights,
      (value) => normalizePreviewInspectorCompanionShellRegionHeight(value, 1),
    ),
  };
}

let previewInspectorCompanionInnerState = readPreviewInspectorCompanionInnerState();
let disposePreviewInspectorCompanionInnerResize = () => undefined;

/** Persists local dimensions without discarding pane ratios or scroll state. */
function persistPreviewInspectorCompanionInnerState() {
  let current;
  try { current = vscode.getState?.(); } catch { current = undefined; }
  const root = current !== null && typeof current === 'object' ? current : {};
  try {
    vscode.setState?.({
      ...root,
      [PREVIEW_INSPECTOR_COMPANION_INNER_STATE_KEY]: {
        cardHeights: { ...previewInspectorCompanionInnerState.cardHeights },
        collapsedSections: { ...previewInspectorCompanionInnerState.collapsedSections },
        sectionRatios: { ...previewInspectorCompanionInnerState.sectionRatios },
        shellRegionHeights: { ...previewInspectorCompanionInnerState.shellRegionHeights },
        version: PREVIEW_INSPECTOR_COMPANION_INNER_LAYOUT_VERSION,
      },
    });
  } catch { /* A closing webview can reject a final best-effort state write. */ }
}

/** Retains insertion order while bounding transient component identities from repeated snapshots. */
function setPreviewInspectorCompanionInnerValue(record, key, value) {
  if (key.length === 0) return;
  delete record[key];
  record[key] = value;
  const keys = Object.keys(record);
  for (let index = 0;
    index < keys.length - PREVIEW_INSPECTOR_COMPANION_INNER_STATE_LIMIT;
    index += 1) {
    delete record[keys[index]];
  }
}

/** Reads the closest active viewport so a card cannot cover an entire compact Inspector tab. */
function readPreviewInspectorCompanionCardMaximum(card) {
  const viewport = card?.closest?.(
    '.rpi-tree-selection-scroll,.rpi-detail-scroll,.rpi-scenario-scroll',
  );
  const viewportHeight = Number(viewport?.clientHeight);
  const mirrorHeight = Number(mirror?.clientHeight);
  const available = Number.isFinite(viewportHeight) && viewportHeight > 0
    ? viewportHeight - 12
    : Number.isFinite(mirrorHeight) && mirrorHeight > 0
      ? mirrorHeight - 48
      : PREVIEW_INSPECTOR_COMPANION_CARD_MAX_HEIGHT;
  return Math.min(
    PREVIEW_INSPECTOR_COMPANION_CARD_MAX_HEIGHT,
    Math.max(PREVIEW_INSPECTOR_COMPANION_CARD_MIN_HEIGHT, available),
  );
}

/** Applies one mirrored card height without invoking its renderer-side remote control. */
function applyPreviewInspectorCompanionCardHeight(card, resizeId, value) {
  if (card === null || card === undefined || resizeId.length === 0) return undefined;
  const height = normalizePreviewInspectorCompanionCardHeight(
    value,
    readPreviewInspectorCompanionCardMaximum(card),
  );
  if (height === undefined) {
    card.style.removeProperty('height');
    card.setAttribute('data-rpi-resized', 'false');
    delete previewInspectorCompanionInnerState.cardHeights[resizeId];
    return undefined;
  }
  card.style.height = String(height) + 'px';
  card.setAttribute('data-rpi-resized', 'true');
  setPreviewInspectorCompanionInnerValue(
    previewInspectorCompanionInnerState.cardHeights,
    resizeId,
    height,
  );
  return height;
}

/** Applies one persisted ratio as the concrete first row of the tree/detail grid. */
function applyPreviewInspectorCompanionSectionRatio(container, handle, resizeId, value) {
  const ratio = normalizePreviewInspectorCompanionSectionRatio(value);
  const available = Math.max(
    1,
    container.clientHeight - PREVIEW_INSPECTOR_COMPANION_INNER_BOUNDARY_SIZE,
  );
  const minimum = Math.min(
    PREVIEW_INSPECTOR_COMPANION_SECTION_MIN_HEIGHT,
    Math.max(0, available / 2),
  );
  const firstHeight = Math.round(Math.min(
    available - minimum,
    Math.max(minimum, available * ratio),
  ));
  container.style.setProperty('--rpi-primary-section-height', String(firstHeight) + 'px');
  handle.setAttribute('aria-valuenow', String(Math.round(ratio * 100)));
  setPreviewInspectorCompanionInnerValue(
    previewInspectorCompanionInnerState.sectionRatios,
    resizeId,
    ratio,
  );
  return ratio;
}

/** Finds one renderer-authored shell region and its grid-row contract. */
function readPreviewInspectorCompanionShellRegion(shell, regionName) {
  if (regionName === 'toolbar') {
    return {
      element: shell?.querySelector?.('.rpi-toolbar'),
      minimum: PREVIEW_INSPECTOR_COMPANION_TOOLBAR_MIN_HEIGHT,
      variable: '--rpi-toolbar-section-height',
    };
  }
  if (regionName === 'context') {
    return {
      element: shell?.querySelector?.('.rpi-page-context'),
      minimum: PREVIEW_INSPECTOR_COMPANION_CONTEXT_MIN_HEIGHT,
      variable: '--rpi-context-section-height',
    };
  }
  return undefined;
}

/** Reserves enough vertical space for the other header region and component workbench. */
function readPreviewInspectorCompanionShellRegionMaximum(shell, regionName, minimum) {
  const shellHeight = Number(shell?.clientHeight);
  if (!Number.isFinite(shellHeight) || shellHeight <= 0) return 4096;
  const otherMinimum = regionName === 'toolbar'
    ? PREVIEW_INSPECTOR_COMPANION_CONTEXT_MIN_HEIGHT
    : PREVIEW_INSPECTOR_COMPANION_TOOLBAR_MIN_HEIGHT;
  const otherRegionName = regionName === 'toolbar' ? 'context' : 'toolbar';
  const reservedOtherHeight =
    shell.getAttribute?.('data-rpi-' + otherRegionName + '-collapsed') === 'true'
      ? 0
      : otherMinimum;
  const workbench = shell.querySelector?.('.rpi-workbench');
  const computedWorkbenchMinimum = workbench === null || workbench === undefined
    ? Number.NaN
    : Number.parseFloat(globalThis.getComputedStyle?.(workbench)?.minHeight ?? '');
  const reservedWorkbenchHeight = Number.isFinite(computedWorkbenchMinimum)
    ? Math.max(
        PREVIEW_INSPECTOR_COMPANION_WORKBENCH_MIN_HEIGHT,
        computedWorkbenchMinimum,
      )
    : PREVIEW_INSPECTOR_COMPANION_WORKBENCH_MIN_HEIGHT;
  return Math.max(
    minimum,
    shellHeight -
      PREVIEW_INSPECTOR_COMPANION_INNER_BOUNDARY_SIZE * 2 -
      reservedWorkbenchHeight -
      reservedOtherHeight,
  );
}

/** Applies one local toolbar/context row height without forwarding an action to project React. */
function applyPreviewInspectorCompanionShellRegionHeight(
  shell,
  regionName,
  resizeId,
  value,
) {
  const definition = readPreviewInspectorCompanionShellRegion(shell, regionName);
  if (
    definition === undefined ||
    definition.element === null ||
    definition.element === undefined ||
    resizeId.length === 0
  ) {
    return undefined;
  }
  const height = normalizePreviewInspectorCompanionShellRegionHeight(
    value,
    definition.minimum,
    readPreviewInspectorCompanionShellRegionMaximum(shell, regionName, definition.minimum),
  );
  if (height === undefined) {
    shell.style.removeProperty(definition.variable);
    definition.element.setAttribute('data-rpi-resized', 'false');
    delete previewInspectorCompanionInnerState.shellRegionHeights[resizeId];
    return undefined;
  }
  shell.style.setProperty(definition.variable, String(height) + 'px');
  definition.element.setAttribute('data-rpi-resized', 'true');
  setPreviewInspectorCompanionInnerValue(
    previewInspectorCompanionInnerState.shellRegionHeights,
    resizeId,
    height,
  );
  return height;
}

/** Updates one inert disclosure control without forwarding its click to renderer-side React. */
function updatePreviewInspectorCompanionAccordionToggle(button, collapsed) {
  if (button === null || button === undefined) return;
  button.setAttribute('aria-expanded', String(!collapsed));
  button.setAttribute('data-rpi-collapsed', String(collapsed));
  const chevron = button.querySelector?.('[data-rpi-accordion-chevron]');
  if (chevron !== null && chevron !== undefined) chevron.textContent = collapsed ? '▸' : '▾';
}

/** Applies a mirrored toolbar/page-context disclosure while retaining its expanded height. */
function applyPreviewInspectorCompanionShellRegionCollapsed(
  shell,
  regionName,
  resizeId,
  button,
  collapsed,
) {
  const definition = readPreviewInspectorCompanionShellRegion(shell, regionName);
  if (
    definition === undefined ||
    definition.element === null ||
    definition.element === undefined ||
    resizeId.length === 0
  ) return false;
  const next = collapsed === true;
  shell.setAttribute('data-rpi-' + regionName + '-collapsed', String(next));
  definition.element.hidden = next;
  definition.element.setAttribute('aria-hidden', String(next));
  if (next) {
    shell.style.setProperty(definition.variable, '0px');
  } else {
    const restored = previewInspectorCompanionInnerState.shellRegionHeights[resizeId];
    if (Number.isFinite(restored)) {
      applyPreviewInspectorCompanionShellRegionHeight(shell, regionName, resizeId, restored);
    } else {
      shell.style.removeProperty(definition.variable);
      definition.element.setAttribute('data-rpi-resized', 'false');
    }
  }
  updatePreviewInspectorCompanionAccordionToggle(button, next);
  setPreviewInspectorCompanionInnerValue(
    previewInspectorCompanionInnerState.collapsedSections,
    resizeId,
    next,
  );
  return next;
}

/** Applies the mirrored selection-detail disclosure without replacing the sanitized snapshot. */
function applyPreviewInspectorCompanionSectionCollapsed(
  container,
  handle,
  resizeId,
  button,
  collapsed,
) {
  if (container === null || container === undefined || resizeId.length === 0) return false;
  const next = collapsed === true;
  const detail = container.querySelector?.(':scope > .rpi-tree-selection-detail');
  container.setAttribute('data-rpi-detail-collapsed', String(next));
  if (detail !== null && detail !== undefined) {
    detail.hidden = next;
    detail.setAttribute('aria-hidden', String(next));
  }
  updatePreviewInspectorCompanionAccordionToggle(button, next);
  setPreviewInspectorCompanionInnerValue(
    previewInspectorCompanionInnerState.collapsedSections,
    resizeId,
    next,
  );
  if (!next) {
    applyPreviewInspectorCompanionSectionRatio(
      container,
      handle,
      resizeId,
      previewInspectorCompanionInnerState.sectionRatios[resizeId] ??
        PREVIEW_INSPECTOR_COMPANION_SECTION_DEFAULT_RATIO,
    );
  }
  return next;
}

/** Binds a local accordion button and prevents the companion remote-control bridge from firing. */
function installPreviewInspectorCompanionAccordionToggle(button, readCollapsed, applyCollapsed) {
  if (button === null || button === undefined) return () => undefined;
  const click = (event) => {
    event.preventDefault();
    event.stopPropagation();
    event.stopImmediatePropagation?.();
    applyCollapsed(!readCollapsed());
    persistPreviewInspectorCompanionInnerState();
  };
  button.addEventListener('click', click);
  return () => button.removeEventListener('click', click);
}

/** Installs drag, keyboard, and reset behavior on one mirrored card handle. */
function installPreviewInspectorCompanionCardHandle(handle, disposers) {
  const resizeId = normalizePreviewInspectorCompanionInnerResizeId(
    handle.getAttribute('data-rpi-resize-id'),
  );
  const card = handle.parentElement;
  if (resizeId.length === 0 || card === null) return;
  const restored = previewInspectorCompanionInnerState.cardHeights[resizeId];
  if (restored === undefined) {
    card.style.removeProperty('height');
    card.setAttribute('data-rpi-resized', 'false');
  } else {
    applyPreviewInspectorCompanionCardHeight(card, resizeId, restored);
  }
  const pointerDown = (event) => {
    if (event.button !== 0) return;
    event.preventDefault();
    event.stopPropagation();
    const pointerId = event.pointerId;
    const startY = event.clientY;
    const startHeight = card.getBoundingClientRect().height;
    const move = (nextEvent) => {
      if (nextEvent.pointerId !== pointerId) return;
      nextEvent.preventDefault();
      applyPreviewInspectorCompanionCardHeight(
        card,
        resizeId,
        startHeight + nextEvent.clientY - startY,
      );
    };
    const finish = (nextEvent) => {
      if (nextEvent.pointerId !== pointerId) return;
      handle.removeEventListener('pointermove', move);
      handle.removeEventListener('pointerup', finish);
      handle.removeEventListener('pointercancel', finish);
      try { handle.releasePointerCapture?.(pointerId); } catch { /* Capture may be gone. */ }
      persistPreviewInspectorCompanionInnerState();
    };
    handle.addEventListener('pointermove', move);
    handle.addEventListener('pointerup', finish);
    handle.addEventListener('pointercancel', finish);
    try { handle.setPointerCapture?.(pointerId); } catch { /* Pointer capture is optional. */ }
  };
  const keyDown = (event) => {
    const maximum = readPreviewInspectorCompanionCardMaximum(card);
    const current = card.getBoundingClientRect().height;
    const step = PREVIEW_INSPECTOR_COMPANION_INNER_STEP * (event.shiftKey ? 4 : 1);
    const next = event.key === 'ArrowUp'
      ? current - step
      : event.key === 'ArrowDown'
        ? current + step
        : event.key === 'Home'
          ? PREVIEW_INSPECTOR_COMPANION_CARD_MIN_HEIGHT
          : event.key === 'End'
            ? maximum
            : undefined;
    if (next === undefined) return;
    event.preventDefault();
    event.stopPropagation();
    applyPreviewInspectorCompanionCardHeight(card, resizeId, next);
    persistPreviewInspectorCompanionInnerState();
  };
  const reset = (event) => {
    event.preventDefault();
    event.stopPropagation();
    applyPreviewInspectorCompanionCardHeight(card, resizeId, undefined);
    persistPreviewInspectorCompanionInnerState();
  };
  handle.addEventListener('pointerdown', pointerDown);
  handle.addEventListener('keydown', keyDown);
  handle.addEventListener('dblclick', reset);
  disposers.push(() => {
    handle.removeEventListener('pointerdown', pointerDown);
    handle.removeEventListener('keydown', keyDown);
    handle.removeEventListener('dblclick', reset);
  });
}

/** Installs drag, keyboard, and reset behavior on one mirrored tree/detail splitter. */
function installPreviewInspectorCompanionSectionHandle(handle, disposers) {
  const resizeId = normalizePreviewInspectorCompanionInnerResizeId(
    handle.getAttribute('data-rpi-resize-id'),
  );
  const container = handle.closest?.('.rpi-components-body');
  const button = handle.parentElement?.querySelector?.(
    '[data-rpi-accordion-toggle="' + resizeId + '"]',
  );
  if (resizeId.length === 0 || container === null || container === undefined) return;
  const readCollapsed = () =>
    previewInspectorCompanionInnerState.collapsedSections[resizeId] === true;
  const refresh = () => applyPreviewInspectorCompanionSectionCollapsed(
    container,
    handle,
    resizeId,
    button,
    readCollapsed(),
  );
  const pointerDown = (event) => {
    if (event.button !== 0) return;
    if (readCollapsed()) {
      applyPreviewInspectorCompanionSectionCollapsed(
        container,
        handle,
        resizeId,
        button,
        false,
      );
      persistPreviewInspectorCompanionInnerState();
    }
    event.preventDefault();
    event.stopPropagation();
    const pointerId = event.pointerId;
    const move = (nextEvent) => {
      if (nextEvent.pointerId !== pointerId) return;
      nextEvent.preventDefault();
      const bounds = container.getBoundingClientRect();
      const available = Math.max(
        1,
        bounds.height - PREVIEW_INSPECTOR_COMPANION_INNER_BOUNDARY_SIZE,
      );
      const minimum = Math.min(
        PREVIEW_INSPECTOR_COMPANION_SECTION_MIN_HEIGHT,
        Math.max(0, available / 2),
      );
      const first = Math.min(
        available - minimum,
        Math.max(minimum, nextEvent.clientY - bounds.top),
      );
      applyPreviewInspectorCompanionSectionRatio(
        container,
        handle,
        resizeId,
        first / available,
      );
    };
    const finish = (nextEvent) => {
      if (nextEvent.pointerId !== pointerId) return;
      handle.removeEventListener('pointermove', move);
      handle.removeEventListener('pointerup', finish);
      handle.removeEventListener('pointercancel', finish);
      try { handle.releasePointerCapture?.(pointerId); } catch { /* Capture may be gone. */ }
      persistPreviewInspectorCompanionInnerState();
    };
    handle.addEventListener('pointermove', move);
    handle.addEventListener('pointerup', finish);
    handle.addEventListener('pointercancel', finish);
    try { handle.setPointerCapture?.(pointerId); } catch { /* Pointer capture is optional. */ }
  };
  const keyDown = (event) => {
    if (readCollapsed() && ['ArrowUp', 'ArrowDown', 'Home', 'End'].includes(event.key)) {
      applyPreviewInspectorCompanionSectionCollapsed(
        container,
        handle,
        resizeId,
        button,
        false,
      );
    }
    const available = Math.max(
      1,
      container.clientHeight - PREVIEW_INSPECTOR_COMPANION_INNER_BOUNDARY_SIZE,
    );
    const current = normalizePreviewInspectorCompanionSectionRatio(
      previewInspectorCompanionInnerState.sectionRatios[resizeId],
    );
    const step = PREVIEW_INSPECTOR_COMPANION_INNER_STEP / available *
      (event.shiftKey ? 4 : 1);
    const next = event.key === 'ArrowUp'
      ? current - step
      : event.key === 'ArrowDown'
        ? current + step
        : event.key === 'Home'
          ? 0.15
          : event.key === 'End'
            ? 0.85
            : undefined;
    if (next === undefined) return;
    event.preventDefault();
    event.stopPropagation();
    applyPreviewInspectorCompanionSectionRatio(container, handle, resizeId, next);
    persistPreviewInspectorCompanionInnerState();
  };
  const reset = (event) => {
    event.preventDefault();
    event.stopPropagation();
    delete previewInspectorCompanionInnerState.sectionRatios[resizeId];
    applyPreviewInspectorCompanionSectionRatio(
      container,
      handle,
      resizeId,
      PREVIEW_INSPECTOR_COMPANION_SECTION_DEFAULT_RATIO,
    );
    persistPreviewInspectorCompanionInnerState();
  };
  handle.addEventListener('pointerdown', pointerDown);
  handle.addEventListener('keydown', keyDown);
  handle.addEventListener('dblclick', reset);
  disposers.push(() => {
    handle.removeEventListener('pointerdown', pointerDown);
    handle.removeEventListener('keydown', keyDown);
    handle.removeEventListener('dblclick', reset);
  });
  disposers.push(installPreviewInspectorCompanionAccordionToggle(
    button,
    readCollapsed,
    (collapsed) => applyPreviewInspectorCompanionSectionCollapsed(
      container,
      handle,
      resizeId,
      button,
      collapsed,
    ),
  ));
  const observer = typeof ResizeObserver === 'function' ? new ResizeObserver(refresh) : undefined;
  if (observer !== undefined) observer.observe(container);
  else globalThis.addEventListener?.('resize', refresh);
  disposers.push(() => {
    observer?.disconnect();
    globalThis.removeEventListener?.('resize', refresh);
  });
  refresh();
}

/** Installs local height behavior on a toolbar or page-context boundary handle. */
function installPreviewInspectorCompanionShellRegionHandle(handle, disposers) {
  const resizeId = normalizePreviewInspectorCompanionInnerResizeId(
    handle.getAttribute('data-rpi-resize-id'),
  );
  const regionName = handle.getAttribute('data-rpi-shell-region');
  const shell = handle.closest?.('.rpi-shell');
  const button = handle.parentElement?.querySelector?.(
    '[data-rpi-accordion-toggle="' + resizeId + '"]',
  );
  const definition = readPreviewInspectorCompanionShellRegion(shell, regionName);
  if (
    resizeId.length === 0 ||
    shell === null ||
    shell === undefined ||
    definition?.element === null ||
    definition?.element === undefined
  ) return;
  const readCollapsed = () =>
    previewInspectorCompanionInnerState.collapsedSections[resizeId] === true;
  const refresh = () => {
    applyPreviewInspectorCompanionShellRegionCollapsed(
      shell,
      regionName,
      resizeId,
      button,
      readCollapsed(),
    );
  };
  refresh();
  const pointerDown = (event) => {
    if (event.button !== 0) return;
    if (readCollapsed()) {
      applyPreviewInspectorCompanionShellRegionCollapsed(
        shell,
        regionName,
        resizeId,
        button,
        false,
      );
      persistPreviewInspectorCompanionInnerState();
    }
    event.preventDefault();
    event.stopPropagation();
    const pointerId = event.pointerId;
    const startY = event.clientY;
    const startHeight = definition.element.getBoundingClientRect().height;
    const move = (nextEvent) => {
      if (nextEvent.pointerId !== pointerId) return;
      nextEvent.preventDefault();
      const height = applyPreviewInspectorCompanionShellRegionHeight(
        shell,
        regionName,
        resizeId,
        startHeight + nextEvent.clientY - startY,
      );
      if (height !== undefined) handle.setAttribute('aria-valuenow', String(height));
    };
    const finish = (nextEvent) => {
      if (nextEvent.pointerId !== pointerId) return;
      handle.removeEventListener('pointermove', move);
      handle.removeEventListener('pointerup', finish);
      handle.removeEventListener('pointercancel', finish);
      try { handle.releasePointerCapture?.(pointerId); } catch { /* Capture may be gone. */ }
      persistPreviewInspectorCompanionInnerState();
    };
    handle.addEventListener('pointermove', move);
    handle.addEventListener('pointerup', finish);
    handle.addEventListener('pointercancel', finish);
    try { handle.setPointerCapture?.(pointerId); } catch { /* Pointer capture is optional. */ }
  };
  const keyDown = (event) => {
    if (readCollapsed() && ['ArrowUp', 'ArrowDown', 'Home', 'End'].includes(event.key)) {
      applyPreviewInspectorCompanionShellRegionCollapsed(
        shell,
        regionName,
        resizeId,
        button,
        false,
      );
    }
    const current = definition.element.getBoundingClientRect().height;
    const maximum = readPreviewInspectorCompanionShellRegionMaximum(
      shell,
      regionName,
      definition.minimum,
    );
    const step = PREVIEW_INSPECTOR_COMPANION_INNER_STEP * (event.shiftKey ? 4 : 1);
    const next = event.key === 'ArrowUp'
      ? current - step
      : event.key === 'ArrowDown'
        ? current + step
        : event.key === 'Home'
          ? definition.minimum
          : event.key === 'End'
            ? maximum
            : undefined;
    if (next === undefined) return;
    event.preventDefault();
    event.stopPropagation();
    const height = applyPreviewInspectorCompanionShellRegionHeight(
      shell,
      regionName,
      resizeId,
      next,
    );
    handle.setAttribute('aria-valuenow', String(height));
    persistPreviewInspectorCompanionInnerState();
  };
  const reset = (event) => {
    event.preventDefault();
    event.stopPropagation();
    applyPreviewInspectorCompanionShellRegionHeight(shell, regionName, resizeId, undefined);
    handle.removeAttribute('aria-valuenow');
    persistPreviewInspectorCompanionInnerState();
  };
  handle.addEventListener('pointerdown', pointerDown);
  handle.addEventListener('keydown', keyDown);
  handle.addEventListener('dblclick', reset);
  disposers.push(() => {
    handle.removeEventListener('pointerdown', pointerDown);
    handle.removeEventListener('keydown', keyDown);
    handle.removeEventListener('dblclick', reset);
  });
  disposers.push(installPreviewInspectorCompanionAccordionToggle(
    button,
    readCollapsed,
    (collapsed) => applyPreviewInspectorCompanionShellRegionCollapsed(
      shell,
      regionName,
      resizeId,
      button,
      collapsed,
    ),
  ));
  const observer = typeof ResizeObserver === 'function' ? new ResizeObserver(refresh) : undefined;
  if (observer !== undefined) observer.observe(shell);
  else globalThis.addEventListener?.('resize', refresh);
  disposers.push(() => {
    observer?.disconnect();
    globalThis.removeEventListener?.('resize', refresh);
  });
}

/** Rebinds local resize behavior after the sanitized mirror is atomically replaced. */
function installPreviewInspectorCompanionInnerResize() {
  disposePreviewInspectorCompanionInnerResize();
  const disposers = [];
  for (const handle of mirror.querySelectorAll('.rpi-card-height-handle')) {
    installPreviewInspectorCompanionCardHandle(handle, disposers);
  }
  for (const handle of mirror.querySelectorAll('.rpi-section-height-handle')) {
    installPreviewInspectorCompanionSectionHandle(handle, disposers);
  }
  for (const handle of mirror.querySelectorAll('.rpi-shell-section-height-handle')) {
    installPreviewInspectorCompanionShellRegionHandle(handle, disposers);
  }
  disposePreviewInspectorCompanionInnerResize = () => {
    for (const dispose of disposers) dispose();
  };
}
`;
}
