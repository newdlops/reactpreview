/**
 * Generates the Page Inspector's inner vertical-resize controls.
 *
 * The outer drawer layout owns only the Inspector window geometry. This module owns the smaller
 * split between the toolbar, page context, component tree, and selection detail, plus independently
 * resizable detail cards. The three main boundaries also own compact disclosure buttons, so their
 * last expanded height remains independent from accordion collapse. Keeping those responsibilities
 * separate prevents a drag or disclosure from remounting application React or resetting scroll.
 */

/**
 * Creates browser source for accessible, persisted, vertical section and card resize handles.
 *
 * Expected lexical bindings include `React`, `previewInspectorDevtoolsSessionState`, and
 * `persistPreviewInspectorState`. Pointer moves update the handle's owning DOM element directly;
 * React state is deliberately not used during a gesture because a component-tree rerender could
 * disturb the user's current scroll position.
 *
 * @returns Plain JavaScript source concatenated after the Inspector layout runtime.
 */
export function createPreviewInspectorSectionResizeUiRuntimeSource(): string {
  return String.raw`
const PREVIEW_INSPECTOR_INNER_RESIZE_STEP = 16;
const PREVIEW_INSPECTOR_INNER_BOUNDARY_SIZE = 37;
const PREVIEW_INSPECTOR_CARD_MIN_HEIGHT = 56;
const PREVIEW_INSPECTOR_CARD_MAX_HEIGHT = 4096;
const PREVIEW_INSPECTOR_SECTION_MIN_HEIGHT = 72;
const PREVIEW_INSPECTOR_SECTION_DEFAULT_RATIO = 0.6;
const PREVIEW_INSPECTOR_SECTION_MIN_RATIO = 0.15;
const PREVIEW_INSPECTOR_SECTION_MAX_RATIO = 0.85;
const PREVIEW_INSPECTOR_SHELL_TOOLBAR_MIN_HEIGHT = 36;
const PREVIEW_INSPECTOR_SHELL_CONTEXT_MIN_HEIGHT = 72;
const PREVIEW_INSPECTOR_SHELL_WORKBENCH_MIN_HEIGHT = 120;
const PREVIEW_INSPECTOR_RESIZE_STATE_LIMIT = 128;
let previewInspectorActiveInnerResizeGesture;

/** Rejects prototype keys and unbounded identities before storing UI-only resize state. */
function normalizePreviewInspectorResizeStateKey(value) {
  if (typeof value !== 'string') return '';
  const normalized = value.trim().slice(0, 240);
  return normalized.length === 0 ||
    ['__proto__', 'prototype', 'constructor'].includes(normalized)
    ? ''
    : normalized;
}

/** Clamps one restored card height to a finite, usable Inspector value. */
function normalizePreviewInspectorCardHeight(
  value,
  maximum = PREVIEW_INSPECTOR_CARD_MAX_HEIGHT,
) {
  if (!Number.isFinite(value)) return undefined;
  const safeMaximum = Number.isFinite(maximum)
    ? Math.max(PREVIEW_INSPECTOR_CARD_MIN_HEIGHT, maximum)
    : PREVIEW_INSPECTOR_CARD_MAX_HEIGHT;
  return Math.round(Math.min(
    PREVIEW_INSPECTOR_CARD_MAX_HEIGHT,
    safeMaximum,
    Math.max(PREVIEW_INSPECTOR_CARD_MIN_HEIGHT, value),
  ));
}

/** Clamps one shell-region height while allowing the toolbar's smaller intrinsic minimum. */
function normalizePreviewInspectorShellRegionHeight(value, minimum, maximum = 4096) {
  if (!Number.isFinite(value)) return undefined;
  const safeMinimum = Number.isFinite(minimum) ? Math.max(1, minimum) : 1;
  const safeMaximum = Number.isFinite(maximum)
    ? Math.max(safeMinimum, maximum)
    : 4096;
  return Math.round(Math.min(4096, safeMaximum, Math.max(safeMinimum, value)));
}

/** Clamps one restored section ratio so both adjacent regions remain reachable. */
function normalizePreviewInspectorSectionRatio(
  value,
  fallback = PREVIEW_INSPECTOR_SECTION_DEFAULT_RATIO,
) {
  const candidate = Number.isFinite(value) ? value : fallback;
  return Math.min(
    PREVIEW_INSPECTOR_SECTION_MAX_RATIO,
    Math.max(PREVIEW_INSPECTOR_SECTION_MIN_RATIO, candidate),
  );
}

/** Copies only a bounded set of finite persisted resize values into a null-prototype record. */
function normalizePreviewInspectorResizeStateMap(value, normalizeValue) {
  const normalized = Object.create(null);
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return normalized;
  const entries = Object.entries(value).slice(-PREVIEW_INSPECTOR_RESIZE_STATE_LIMIT);
  for (const [candidateKey, candidateValue] of entries) {
    const key = normalizePreviewInspectorResizeStateKey(candidateKey);
    const normalizedValue = normalizeValue(candidateValue);
    if (key.length > 0 && normalizedValue !== undefined) normalized[key] = normalizedValue;
  }
  return normalized;
}

previewInspectorDevtoolsSessionState.cardHeights =
  normalizePreviewInspectorResizeStateMap(
    previewInspectorDevtoolsSessionState.cardHeights,
    (value) => normalizePreviewInspectorCardHeight(value),
  );
previewInspectorDevtoolsSessionState.sectionRatios =
  normalizePreviewInspectorResizeStateMap(
    previewInspectorDevtoolsSessionState.sectionRatios,
    (value) => Number.isFinite(value)
      ? normalizePreviewInspectorSectionRatio(value)
      : undefined,
  );
previewInspectorDevtoolsSessionState.shellRegionHeights =
  normalizePreviewInspectorResizeStateMap(
    previewInspectorDevtoolsSessionState.shellRegionHeights,
    (value) => normalizePreviewInspectorShellRegionHeight(value, 1),
  );
previewInspectorDevtoolsSessionState.collapsedSections =
  normalizePreviewInspectorResizeStateMap(
    previewInspectorDevtoolsSessionState.collapsedSections,
    (value) => typeof value === 'boolean' ? value : undefined,
  );

/** Retains a bounded insertion order when a workspace produces many transient component IDs. */
function setPreviewInspectorBoundedResizeState(record, key, value) {
  if (key.length === 0) return;
  delete record[key];
  record[key] = value;
  const keys = Object.keys(record);
  for (let index = 0; index < keys.length - PREVIEW_INSPECTOR_RESIZE_STATE_LIMIT; index += 1) {
    delete record[keys[index]];
  }
}

/** Finds the nearest vertical viewport so a resized card cannot disappear below a small display. */
function readPreviewInspectorCardMaximumHeight(card) {
  const viewport = card?.closest?.(
    '.rpi-tree-selection-scroll,.rpi-detail-scroll,.rpi-scenario-scroll',
  );
  const viewportHeight = Number(viewport?.clientHeight);
  const browserHeight = Number(globalThis.innerHeight);
  const availableHeight = Number.isFinite(viewportHeight) && viewportHeight > 0
    ? viewportHeight - 12
    : Number.isFinite(browserHeight) && browserHeight > 0
      ? browserHeight - 48
      : PREVIEW_INSPECTOR_CARD_MAX_HEIGHT;
  return Math.min(
    PREVIEW_INSPECTOR_CARD_MAX_HEIGHT,
    Math.max(PREVIEW_INSPECTOR_CARD_MIN_HEIGHT, availableHeight),
  );
}

/** Applies one explicit card height without scheduling a component-tree React render. */
function applyPreviewInspectorCardHeight(card, resizeId, value) {
  if (card === null || card === undefined || resizeId.length === 0) return undefined;
  const height = normalizePreviewInspectorCardHeight(
    value,
    readPreviewInspectorCardMaximumHeight(card),
  );
  if (height === undefined) {
    card.style.removeProperty('height');
    card.setAttribute('data-rpi-resized', 'false');
    delete previewInspectorDevtoolsSessionState.cardHeights[resizeId];
    return undefined;
  }
  card.style.height = String(height) + 'px';
  card.setAttribute('data-rpi-resized', 'true');
  setPreviewInspectorBoundedResizeState(
    previewInspectorDevtoolsSessionState.cardHeights,
    resizeId,
    height,
  );
  return height;
}

/** Converts a pointer coordinate into a split ratio while preserving both adjacent sections. */
function calculatePreviewInspectorSectionRatio(
  pointerY,
  containerTop,
  containerHeight,
  minimumSize = PREVIEW_INSPECTOR_SECTION_MIN_HEIGHT,
) {
  if (![pointerY, containerTop, containerHeight, minimumSize].every(Number.isFinite)) {
    return PREVIEW_INSPECTOR_SECTION_DEFAULT_RATIO;
  }
  const availableHeight = Math.max(
    1,
    containerHeight - PREVIEW_INSPECTOR_INNER_BOUNDARY_SIZE,
  );
  const boundedMinimum = Math.min(
    Math.max(0, minimumSize),
    Math.max(0, availableHeight / 2),
  );
  const firstHeight = Math.min(
    availableHeight - boundedMinimum,
    Math.max(boundedMinimum, pointerY - containerTop),
  );
  return normalizePreviewInspectorSectionRatio(firstHeight / availableHeight);
}

/** Applies a persisted ratio as a concrete first-row size on one two-region grid. */
function applyPreviewInspectorSectionRatio(container, resizeId, value, minimumSize) {
  if (container === null || container === undefined || resizeId.length === 0) return undefined;
  const ratio = normalizePreviewInspectorSectionRatio(value);
  const availableHeight = Math.max(
    1,
    container.clientHeight - PREVIEW_INSPECTOR_INNER_BOUNDARY_SIZE,
  );
  const boundedMinimum = Math.min(minimumSize, Math.max(0, availableHeight / 2));
  const firstHeight = Math.round(Math.min(
    availableHeight - boundedMinimum,
    Math.max(boundedMinimum, availableHeight * ratio),
  ));
  container.style.setProperty('--rpi-primary-section-height', String(firstHeight) + 'px');
  setPreviewInspectorBoundedResizeState(
    previewInspectorDevtoolsSessionState.sectionRatios,
    resizeId,
    ratio,
  );
  return ratio;
}

/** Returns the authored shell element and CSS row identity for one top-level region. */
function readPreviewInspectorShellRegionDefinition(shell, regionName) {
  if (regionName === 'toolbar') {
    return {
      element: shell?.querySelector?.(':scope > .rpi-toolbar'),
      minimum: PREVIEW_INSPECTOR_SHELL_TOOLBAR_MIN_HEIGHT,
      variable: '--rpi-toolbar-section-height',
    };
  }
  if (regionName === 'context') {
    return {
      element: shell?.querySelector?.(':scope > .rpi-page-context'),
      minimum: PREVIEW_INSPECTOR_SHELL_CONTEXT_MIN_HEIGHT,
      variable: '--rpi-context-section-height',
    };
  }
  return undefined;
}

/** Keeps the resized top region from consuming the remaining component workbench. */
function readPreviewInspectorShellRegionMaximumHeight(shell, regionName, minimum) {
  const shellHeight = Number(shell?.clientHeight);
  if (!Number.isFinite(shellHeight) || shellHeight <= 0) return 4096;
  const otherMinimum = regionName === 'toolbar'
    ? PREVIEW_INSPECTOR_SHELL_CONTEXT_MIN_HEIGHT
    : PREVIEW_INSPECTOR_SHELL_TOOLBAR_MIN_HEIGHT;
  const otherRegionName = regionName === 'toolbar' ? 'context' : 'toolbar';
  const reservedOtherHeight =
    shell.getAttribute?.('data-rpi-' + otherRegionName + '-collapsed') === 'true'
      ? 0
      : otherMinimum;
  const workbench = shell.querySelector?.(':scope > .rpi-workbench');
  const computedWorkbenchMinimum = workbench === null || workbench === undefined
    ? Number.NaN
    : Number.parseFloat(globalThis.getComputedStyle?.(workbench)?.minHeight ?? '');
  const reservedWorkbenchHeight = Number.isFinite(computedWorkbenchMinimum)
    ? Math.max(PREVIEW_INSPECTOR_SHELL_WORKBENCH_MIN_HEIGHT, computedWorkbenchMinimum)
    : PREVIEW_INSPECTOR_SHELL_WORKBENCH_MIN_HEIGHT;
  return Math.max(
    minimum,
    shellHeight -
      PREVIEW_INSPECTOR_INNER_BOUNDARY_SIZE * 2 -
      reservedWorkbenchHeight -
      reservedOtherHeight,
  );
}

/** Applies one toolbar/context row height without rerendering the Inspector or application tree. */
function applyPreviewInspectorShellRegionHeight(shell, regionName, resizeId, value) {
  const definition = readPreviewInspectorShellRegionDefinition(shell, regionName);
  if (
    definition === undefined ||
    definition.element === null ||
    definition.element === undefined ||
    resizeId.length === 0
  ) {
    return undefined;
  }
  const height = normalizePreviewInspectorShellRegionHeight(
    value,
    definition.minimum,
    readPreviewInspectorShellRegionMaximumHeight(shell, regionName, definition.minimum),
  );
  if (height === undefined) {
    shell.style.removeProperty(definition.variable);
    definition.element.setAttribute('data-rpi-resized', 'false');
    delete previewInspectorDevtoolsSessionState.shellRegionHeights[resizeId];
    return undefined;
  }
  shell.style.setProperty(definition.variable, String(height) + 'px');
  definition.element.setAttribute('data-rpi-resized', 'true');
  setPreviewInspectorBoundedResizeState(
    previewInspectorDevtoolsSessionState.shellRegionHeights,
    resizeId,
    height,
  );
  return height;
}

/** Updates the compact disclosure button without scheduling a React render or moving scroll. */
function updatePreviewInspectorAccordionToggle(button, collapsed) {
  if (button === null || button === undefined) return;
  button.setAttribute('aria-expanded', String(!collapsed));
  button.setAttribute('data-rpi-collapsed', String(collapsed));
  const chevron = button.querySelector?.('[data-rpi-accordion-chevron]');
  if (chevron !== null && chevron !== undefined) chevron.textContent = collapsed ? '▸' : '▾';
}

/** Applies a toolbar/page-context disclosure while retaining its last expanded height. */
function applyPreviewInspectorShellRegionCollapsed(
  shell,
  regionName,
  resizeId,
  button,
  collapsed,
) {
  const definition = readPreviewInspectorShellRegionDefinition(shell, regionName);
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
    const restoredHeight = previewInspectorDevtoolsSessionState.shellRegionHeights[resizeId];
    if (Number.isFinite(restoredHeight)) {
      applyPreviewInspectorShellRegionHeight(
        shell,
        regionName,
        resizeId,
        restoredHeight,
      );
    } else {
      shell.style.removeProperty(definition.variable);
      definition.element.setAttribute('data-rpi-resized', 'false');
    }
  }
  updatePreviewInspectorAccordionToggle(button, next);
  setPreviewInspectorBoundedResizeState(
    previewInspectorDevtoolsSessionState.collapsedSections,
    resizeId,
    next,
  );
  return next;
}

/** Applies the selection-detail disclosure while preserving the component tree's current scroll. */
function applyPreviewInspectorSectionCollapsed(
  container,
  handle,
  resizeId,
  button,
  collapsed,
  defaultRatio,
  minimumSize,
) {
  if (container === null || container === undefined || resizeId.length === 0) return false;
  const next = collapsed === true;
  const detail = container.querySelector?.(':scope > .rpi-tree-selection-detail');
  container.setAttribute('data-rpi-detail-collapsed', String(next));
  if (detail !== null && detail !== undefined) {
    detail.hidden = next;
    detail.setAttribute('aria-hidden', String(next));
  }
  updatePreviewInspectorAccordionToggle(button, next);
  setPreviewInspectorBoundedResizeState(
    previewInspectorDevtoolsSessionState.collapsedSections,
    resizeId,
    next,
  );
  if (!next) {
    const ratio = normalizePreviewInspectorSectionRatio(
      previewInspectorDevtoolsSessionState.sectionRatios[resizeId],
      defaultRatio,
    );
    applyPreviewInspectorSectionRatio(container, resizeId, ratio, minimumSize);
    handle?.setAttribute?.('aria-valuenow', String(Math.round(ratio * 100)));
  }
  return next;
}

/** Ends the active inner resize gesture and saves its already-applied DOM value. */
function finishPreviewInspectorInnerResize(event, persist = true) {
  const gesture = previewInspectorActiveInnerResizeGesture;
  if (gesture === undefined || gesture.pointerId !== event.pointerId) return;
  previewInspectorActiveInnerResizeGesture = undefined;
  try {
    event.currentTarget?.releasePointerCapture?.(event.pointerId);
  } catch {
    // Browsers may implicitly release capture when a pointer leaves the webview.
  }
  if (persist) persistPreviewInspectorState();
}

/** Renders the explicit grip at the bottom edge of one Inspector detail card. */
function PreviewInspectorCardHeightHandle({ resizeId }) {
  const normalizedId = normalizePreviewInspectorResizeStateKey(resizeId);
  const beginResize = (event) => {
    if (event.button !== 0 || normalizedId.length === 0) return;
    const card = event.currentTarget.parentElement;
    if (card === null) return;
    event.preventDefault();
    event.stopPropagation();
    event.currentTarget.setPointerCapture?.(event.pointerId);
    previewInspectorActiveInnerResizeGesture = {
      card,
      kind: 'card',
      pointerId: event.pointerId,
      resizeId: normalizedId,
      startHeight: card.getBoundingClientRect().height,
      startY: event.clientY,
    };
  };
  const moveResize = (event) => {
    const gesture = previewInspectorActiveInnerResizeGesture;
    if (
      gesture?.kind !== 'card' ||
      gesture.pointerId !== event.pointerId ||
      gesture.resizeId !== normalizedId
    ) return;
    event.preventDefault();
    applyPreviewInspectorCardHeight(
      gesture.card,
      normalizedId,
      gesture.startHeight + event.clientY - gesture.startY,
    );
  };
  const resizeByKeyboard = (event) => {
    const card = event.currentTarget.parentElement;
    if (card === null || normalizedId.length === 0) return;
    const maximum = readPreviewInspectorCardMaximumHeight(card);
    const current = card.getBoundingClientRect().height;
    const step = event.shiftKey
      ? PREVIEW_INSPECTOR_INNER_RESIZE_STEP * 4
      : PREVIEW_INSPECTOR_INNER_RESIZE_STEP;
    const next = event.key === 'ArrowUp'
      ? current - step
      : event.key === 'ArrowDown'
        ? current + step
        : event.key === 'Home'
          ? PREVIEW_INSPECTOR_CARD_MIN_HEIGHT
          : event.key === 'End'
            ? maximum
            : undefined;
    if (next === undefined) return;
    event.preventDefault();
    event.stopPropagation();
    applyPreviewInspectorCardHeight(card, normalizedId, next);
    persistPreviewInspectorState();
  };
  const reset = (event) => {
    event.preventDefault();
    event.stopPropagation();
    const card = event.currentTarget.parentElement;
    applyPreviewInspectorCardHeight(card, normalizedId, undefined);
    persistPreviewInspectorState();
  };
  return React.createElement('div', {
    'aria-label': 'Resize this Inspector card vertically',
    'aria-orientation': 'horizontal',
    className: 'rpi-card-height-handle',
    'data-rpi-resize-id': normalizedId,
    onDoubleClick: reset,
    onKeyDown: resizeByKeyboard,
    onPointerCancel: (event) => finishPreviewInspectorInnerResize(event),
    onPointerDown: beginResize,
    onPointerMove: moveResize,
    onPointerUp: (event) => finishPreviewInspectorInnerResize(event),
    role: 'separator',
    tabIndex: 0,
    title: 'Drag to resize this card · double-click to reset',
  });
}

/**
 * Wraps arbitrary card contents with an independently persisted height handle.
 *
 * A details element keeps its summary as the first direct child, which preserves native disclosure
 * semantics while the remaining content scrolls inside the resized card.
 */
function PreviewInspectorResizableCard({
  as = 'div',
  children,
  className = '',
  resizeId,
  style,
  ...props
}) {
  const cardRef = React.useRef(null);
  const normalizedId = normalizePreviewInspectorResizeStateKey(resizeId);
  const restoredHeight = normalizePreviewInspectorCardHeight(
    previewInspectorDevtoolsSessionState.cardHeights[normalizedId],
  );
  React.useLayoutEffect(() => {
    if (restoredHeight !== undefined) {
      applyPreviewInspectorCardHeight(cardRef.current, normalizedId, restoredHeight);
    }
  }, [normalizedId]);
  const classNames = ['rpi-source-card', 'rpi-resizable-card', className]
    .filter((value) => typeof value === 'string' && value.length > 0)
    .join(' ');
  const elementProps = {
    ...props,
    'data-rpi-resized': restoredHeight === undefined ? 'false' : 'true',
    'data-rpi-resize-id': normalizedId,
    className: classNames,
    ref: cardRef,
    style: restoredHeight === undefined ? style : { ...style, height: restoredHeight },
  };
  const childArray = React.Children.toArray(children);
  if (as === 'details') {
    const summaryIndex = childArray.findIndex((child) => child?.type === 'summary');
    const summary = summaryIndex < 0 ? undefined : childArray[summaryIndex];
    const content = childArray.filter((_, index) => index !== summaryIndex);
    return React.createElement(
      'details',
      elementProps,
      summary,
      React.createElement('div', { className: 'rpi-resizable-card-content' }, content),
      React.createElement(PreviewInspectorCardHeightHandle, { resizeId: normalizedId }),
    );
  }
  return React.createElement(
    as,
    elementProps,
    React.createElement('div', { className: 'rpi-resizable-card-content' }, childArray),
    React.createElement(PreviewInspectorCardHeightHandle, { resizeId: normalizedId }),
  );
}

/** Renders a compact disclosure-only header while its owner places a separate bottom resize track. */
function PreviewInspectorAccordionBoundary({
  collapsed,
  contentId,
  kind,
  label,
  onToggle,
  toggleId,
}) {
  return React.createElement(
    'div',
    {
      className: 'rpi-section-accordion rpi-' + kind + '-section-accordion',
      'data-rpi-accordion-id': toggleId,
      'data-rpi-collapsed': String(collapsed),
    },
    React.createElement(
      'button',
      {
        'aria-controls': contentId,
        'aria-expanded': !collapsed,
        className: 'rpi-section-accordion-toggle',
        'data-rpi-accordion-toggle': toggleId,
        'data-rpi-collapsed': String(collapsed),
        onClick: onToggle,
        title: (collapsed ? 'Expand ' : 'Collapse ') + label,
        type: 'button',
      },
      React.createElement(
        'span',
        { 'aria-hidden': 'true', 'data-rpi-accordion-chevron': 'true' },
        collapsed ? '▸' : '▾',
      ),
      React.createElement('span', undefined, label),
    ),
  );
}

/** Emits a top-level region header and a splitter that the shell grid places below its content. */
function PreviewInspectorShellRegionHeightHandle({
  children,
  contentId,
  label,
  regionName,
  resizeId,
}) {
  const handleRef = React.useRef(null);
  const normalizedId = normalizePreviewInspectorResizeStateKey(resizeId);
  const toggleSelector = '[data-rpi-accordion-toggle="' + normalizedId + '"]';
  const restoredHeight = previewInspectorDevtoolsSessionState.shellRegionHeights[normalizedId];
  const restoredCollapsed =
    previewInspectorDevtoolsSessionState.collapsedSections[normalizedId] === true;
  React.useLayoutEffect(() => {
    const shell = handleRef.current?.closest?.('.rpi-shell');
    if (shell === null || shell === undefined) return undefined;
    const button = handleRef.current?.parentElement?.querySelector?.(toggleSelector);
    applyPreviewInspectorShellRegionCollapsed(
      shell,
      regionName,
      normalizedId,
      button,
      previewInspectorDevtoolsSessionState.collapsedSections[normalizedId] === true,
    );
    if (typeof ResizeObserver !== 'function') return undefined;
    const observer = new ResizeObserver(() => {
      applyPreviewInspectorShellRegionCollapsed(
        shell,
        regionName,
        normalizedId,
        button,
        previewInspectorDevtoolsSessionState.collapsedSections[normalizedId] === true,
      );
    });
    observer.observe(shell);
    return () => observer.disconnect();
  }, [normalizedId, regionName]);
  const beginResize = (event) => {
    if (event.button !== 0 || normalizedId.length === 0) return;
    const shell = event.currentTarget.closest?.('.rpi-shell');
    const button = event.currentTarget.parentElement?.querySelector?.(toggleSelector);
    if (previewInspectorDevtoolsSessionState.collapsedSections[normalizedId] === true) {
      applyPreviewInspectorShellRegionCollapsed(
        shell,
        regionName,
        normalizedId,
        button,
        false,
      );
      persistPreviewInspectorState();
    }
    const definition = readPreviewInspectorShellRegionDefinition(shell, regionName);
    if (shell === null || definition?.element === null || definition?.element === undefined) return;
    event.preventDefault();
    event.stopPropagation();
    event.currentTarget.setPointerCapture?.(event.pointerId);
    previewInspectorActiveInnerResizeGesture = {
      kind: 'shell-region',
      pointerId: event.pointerId,
      regionName,
      resizeId: normalizedId,
      shell,
      startHeight: definition.element.getBoundingClientRect().height,
      startY: event.clientY,
    };
  };
  const moveResize = (event) => {
    const gesture = previewInspectorActiveInnerResizeGesture;
    if (
      gesture?.kind !== 'shell-region' ||
      gesture.pointerId !== event.pointerId ||
      gesture.resizeId !== normalizedId
    ) return;
    event.preventDefault();
    const height = applyPreviewInspectorShellRegionHeight(
      gesture.shell,
      gesture.regionName,
      normalizedId,
      gesture.startHeight + event.clientY - gesture.startY,
    );
    if (height !== undefined) {
      event.currentTarget.setAttribute('aria-valuenow', String(height));
    }
  };
  const resizeByKeyboard = (event) => {
    const shell = event.currentTarget.closest?.('.rpi-shell');
    const definition = readPreviewInspectorShellRegionDefinition(shell, regionName);
    if (shell === null || definition?.element === null || definition?.element === undefined) return;
    if (
      previewInspectorDevtoolsSessionState.collapsedSections[normalizedId] === true &&
      ['ArrowUp', 'ArrowDown', 'Home', 'End'].includes(event.key)
    ) {
      applyPreviewInspectorShellRegionCollapsed(
        shell,
        regionName,
        normalizedId,
        event.currentTarget.parentElement?.querySelector?.(toggleSelector),
        false,
      );
    }
    const current = definition.element.getBoundingClientRect().height;
    const maximum = readPreviewInspectorShellRegionMaximumHeight(
      shell,
      regionName,
      definition.minimum,
    );
    const step = PREVIEW_INSPECTOR_INNER_RESIZE_STEP * (event.shiftKey ? 4 : 1);
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
    const height = applyPreviewInspectorShellRegionHeight(
      shell,
      regionName,
      normalizedId,
      next,
    );
    event.currentTarget.setAttribute('aria-valuenow', String(height));
    persistPreviewInspectorState();
  };
  const reset = (event) => {
    event.preventDefault();
    event.stopPropagation();
    const shell = event.currentTarget.closest?.('.rpi-shell');
    applyPreviewInspectorShellRegionHeight(shell, regionName, normalizedId, undefined);
    event.currentTarget.removeAttribute('aria-valuenow');
    persistPreviewInspectorState();
  };
  const toggle = (event) => {
    event.preventDefault();
    event.stopPropagation();
    const shell = event.currentTarget.closest?.('.rpi-shell');
    const next =
      previewInspectorDevtoolsSessionState.collapsedSections[normalizedId] !== true;
    applyPreviewInspectorShellRegionCollapsed(
      shell,
      regionName,
      normalizedId,
      event.currentTarget,
      next,
    );
    persistPreviewInspectorState();
  };
  return React.createElement(
    React.Fragment,
    undefined,
    React.createElement(PreviewInspectorAccordionBoundary, {
      collapsed: restoredCollapsed,
      contentId,
      kind: 'shell',
      label,
      onToggle: toggle,
      toggleId: normalizedId,
    }),
    children,
    React.createElement('div', {
      'aria-label': 'Resize ' + label,
      'aria-orientation': 'horizontal',
      'aria-valuemin': regionName === 'toolbar'
        ? PREVIEW_INSPECTOR_SHELL_TOOLBAR_MIN_HEIGHT
        : PREVIEW_INSPECTOR_SHELL_CONTEXT_MIN_HEIGHT,
      'aria-valuenow': Number.isFinite(restoredHeight) ? restoredHeight : undefined,
      className: 'rpi-shell-section-height-handle',
      'data-rpi-resize-id': normalizedId,
      'data-rpi-shell-region': regionName,
      onDoubleClick: reset,
      onKeyDown: resizeByKeyboard,
      onPointerCancel: (event) => finishPreviewInspectorInnerResize(event),
      onPointerDown: beginResize,
      onPointerMove: moveResize,
      onPointerUp: (event) => finishPreviewInspectorInnerResize(event),
      ref: handleRef,
      role: 'separator',
      tabIndex: 0,
      title: 'Drag to resize ' + label + ' · double-click to reset',
    }),
  );
}

/** Emits the tree's bottom splitter followed by the selected-detail accordion header. */
function PreviewInspectorSectionHeightHandle({
  defaultRatio = PREVIEW_INSPECTOR_SECTION_DEFAULT_RATIO,
  minimumSize = PREVIEW_INSPECTOR_SECTION_MIN_HEIGHT,
  resizeId,
}) {
  const handleRef = React.useRef(null);
  const normalizedId = normalizePreviewInspectorResizeStateKey(resizeId);
  const toggleSelector = '[data-rpi-accordion-toggle="' + normalizedId + '"]';
  const restoredRatio = normalizePreviewInspectorSectionRatio(
    previewInspectorDevtoolsSessionState.sectionRatios[normalizedId],
    defaultRatio,
  );
  const restoredCollapsed =
    previewInspectorDevtoolsSessionState.collapsedSections[normalizedId] === true;
  React.useLayoutEffect(() => {
    const container = handleRef.current?.closest?.('.rpi-components-body');
    if (container === null || container === undefined) return undefined;
    const button = handleRef.current?.parentElement?.querySelector?.(toggleSelector);
    applyPreviewInspectorSectionCollapsed(
      container,
      handleRef.current,
      normalizedId,
      button,
      previewInspectorDevtoolsSessionState.collapsedSections[normalizedId] === true,
      defaultRatio,
      minimumSize,
    );
    if (typeof ResizeObserver !== 'function') return undefined;
    const observer = new ResizeObserver(() => {
      applyPreviewInspectorSectionCollapsed(
        container,
        handleRef.current,
        normalizedId,
        button,
        previewInspectorDevtoolsSessionState.collapsedSections[normalizedId] === true,
        defaultRatio,
        minimumSize,
      );
    });
    observer.observe(container);
    return () => observer.disconnect();
  }, [defaultRatio, minimumSize, normalizedId]);
  const beginResize = (event) => {
    if (event.button !== 0 || normalizedId.length === 0) return;
    const container = event.currentTarget.closest?.('.rpi-components-body');
    if (container === null || container === undefined) return;
    if (previewInspectorDevtoolsSessionState.collapsedSections[normalizedId] === true) {
      applyPreviewInspectorSectionCollapsed(
        container,
        event.currentTarget,
        normalizedId,
        event.currentTarget.parentElement?.querySelector?.(toggleSelector),
        false,
        defaultRatio,
        minimumSize,
      );
      persistPreviewInspectorState();
    }
    event.preventDefault();
    event.stopPropagation();
    event.currentTarget.setPointerCapture?.(event.pointerId);
    previewInspectorActiveInnerResizeGesture = {
      container,
      kind: 'section',
      minimumSize,
      pointerId: event.pointerId,
      resizeId: normalizedId,
    };
  };
  const moveResize = (event) => {
    const gesture = previewInspectorActiveInnerResizeGesture;
    if (
      gesture?.kind !== 'section' ||
      gesture.pointerId !== event.pointerId ||
      gesture.resizeId !== normalizedId
    ) return;
    event.preventDefault();
    const bounds = gesture.container.getBoundingClientRect();
    const ratio = calculatePreviewInspectorSectionRatio(
      event.clientY,
      bounds.top,
      bounds.height,
      gesture.minimumSize,
    );
    applyPreviewInspectorSectionRatio(
      gesture.container,
      normalizedId,
      ratio,
      gesture.minimumSize,
    );
    event.currentTarget.setAttribute('aria-valuenow', String(Math.round(ratio * 100)));
  };
  const resizeByKeyboard = (event) => {
    const container = event.currentTarget.closest?.('.rpi-components-body');
    if (container === null || container === undefined || normalizedId.length === 0) return;
    if (
      previewInspectorDevtoolsSessionState.collapsedSections[normalizedId] === true &&
      ['ArrowUp', 'ArrowDown', 'Home', 'End'].includes(event.key)
    ) {
      applyPreviewInspectorSectionCollapsed(
        container,
        event.currentTarget,
        normalizedId,
        event.currentTarget.parentElement?.querySelector?.(toggleSelector),
        false,
        defaultRatio,
        minimumSize,
      );
    }
    const availableHeight = Math.max(
      1,
      container.clientHeight - PREVIEW_INSPECTOR_INNER_BOUNDARY_SIZE,
    );
    const ratioStep = PREVIEW_INSPECTOR_INNER_RESIZE_STEP / availableHeight *
      (event.shiftKey ? 4 : 1);
    const current = normalizePreviewInspectorSectionRatio(
      previewInspectorDevtoolsSessionState.sectionRatios[normalizedId],
      defaultRatio,
    );
    const next = event.key === 'ArrowUp'
      ? current - ratioStep
      : event.key === 'ArrowDown'
        ? current + ratioStep
        : event.key === 'Home'
          ? PREVIEW_INSPECTOR_SECTION_MIN_RATIO
          : event.key === 'End'
            ? PREVIEW_INSPECTOR_SECTION_MAX_RATIO
            : undefined;
    if (next === undefined) return;
    event.preventDefault();
    event.stopPropagation();
    const applied = applyPreviewInspectorSectionRatio(
      container,
      normalizedId,
      next,
      minimumSize,
    );
    event.currentTarget.setAttribute('aria-valuenow', String(Math.round(applied * 100)));
    persistPreviewInspectorState();
  };
  const reset = (event) => {
    event.preventDefault();
    event.stopPropagation();
    const container = event.currentTarget.closest?.('.rpi-components-body');
    delete previewInspectorDevtoolsSessionState.sectionRatios[normalizedId];
    const applied = applyPreviewInspectorSectionRatio(
      container,
      normalizedId,
      defaultRatio,
      minimumSize,
    );
    event.currentTarget.setAttribute('aria-valuenow', String(Math.round(applied * 100)));
    persistPreviewInspectorState();
  };
  const toggle = (event) => {
    event.preventDefault();
    event.stopPropagation();
    const container = event.currentTarget.closest?.('.rpi-components-body');
    const next =
      previewInspectorDevtoolsSessionState.collapsedSections[normalizedId] !== true;
    applyPreviewInspectorSectionCollapsed(
      container,
      handleRef.current,
      normalizedId,
      event.currentTarget,
      next,
      defaultRatio,
      minimumSize,
    );
    persistPreviewInspectorState();
  };
  return React.createElement(
    React.Fragment,
    undefined,
    React.createElement('div', {
      'aria-label': 'Resize the component tree and selection details',
      'aria-orientation': 'horizontal',
      'aria-valuemax': 85,
      'aria-valuemin': 15,
      'aria-valuenow': Math.round(restoredRatio * 100),
      className: 'rpi-section-height-handle',
      'data-rpi-resize-id': normalizedId,
      onDoubleClick: reset,
      onKeyDown: resizeByKeyboard,
      onPointerCancel: (event) => finishPreviewInspectorInnerResize(event),
      onPointerDown: beginResize,
      onPointerMove: moveResize,
      onPointerUp: (event) => finishPreviewInspectorInnerResize(event),
      ref: handleRef,
      role: 'separator',
      tabIndex: 0,
      title: 'Drag to resize component tree and selection details · double-click to reset',
    }),
    React.createElement(PreviewInspectorAccordionBoundary, {
      collapsed: restoredCollapsed,
      contentId: 'rpi-selection-details-section',
      kind: 'detail',
      label: 'Selection details',
      onToggle: toggle,
      toggleId: normalizedId,
    }),
  );
}
`;
}
