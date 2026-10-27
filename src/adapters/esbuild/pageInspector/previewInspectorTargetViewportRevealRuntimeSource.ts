import { createPreviewInspectorHostContainmentRuntimeSource } from './previewInspectorHostContainmentRuntimeSource';

/**
 * Generates bounded viewport activation for exact targets behind authored scroll animations.
 * Each committed target host is revealed once, without retaining released DOM, so an async or
 * prepared-page replacement receives its own activation. Human control changes cancel the epoch.
 */
export function createPreviewInspectorTargetViewportRevealRuntimeSource(): string {
  return String.raw`
const PREVIEW_INSPECTOR_TARGET_VIEWPORT_REVEAL_DELAY_MS = 900;
${createPreviewInspectorHostContainmentRuntimeSource()}

/**
 * Finds exact target DOM that is waiting outside a viewport or behind a scroll-triggered opacity
 * transition. Positive geometry keeps this separate from intentionally empty and display-hidden
 * targets, while exact compiler boundaries prevent an unrelated page host from moving the page.
 */
function readPreviewInspectorTargetViewportRevealElement(state, attemptedElements) {
  const viewportWidth = Number(globalThis.innerWidth);
  const viewportHeight = Number(globalThis.innerHeight);
  const readStyle = (element) => {
    try { return globalThis.getComputedStyle?.(element); } catch { return undefined; }
  };
  for (const boundary of readPreviewInspectorTargetBoundaries(state)) {
    const elements = typeof collectPreviewInspectorFiberElements === 'function'
      ? collectPreviewInspectorFiberElements(boundary)
      : [];
    for (const element of elements) {
      if (
        element?.nodeType !== 1 || element.isConnected !== true || element.hidden === true ||
        attemptedElements?.has(element) === true ||
        isPreviewInspectorUiElement(element) || typeof element.scrollIntoView !== 'function' ||
        typeof element.getBoundingClientRect !== 'function'
      ) continue;
      let rectangle;
      try { rectangle = element.getBoundingClientRect(); } catch { continue; }
      const left = Number(rectangle?.left);
      const right = Number(rectangle?.right);
      const top = Number(rectangle?.top);
      const bottom = Number(rectangle?.bottom);
      if (
        ![left, right, top, bottom].every(Number.isFinite) ||
        right - left <= 0.5 || bottom - top <= 0.5
      ) continue;
      let ancestor = element;
      let hiddenByOpacity = false;
      let outsideScrollableAncestor = false;
      let styleHidden = false;
      let steps = 0;
      // A fixed modal is not inside the clipping or scrolling page section it is nested in.
      let escape;
      while (ancestor !== null && ancestor !== undefined && steps < 64) {
        steps += 1;
        const style = readStyle(ancestor);
        if (
          style?.display === 'none' || style?.visibility === 'hidden' ||
          style?.contentVisibility === 'hidden'
        ) {
          styleHidden = true;
          break;
        }
        const opacity = Number(style?.opacity);
        if (Number.isFinite(opacity) && opacity <= 0) hiddenByOpacity = true;
        const overflow = String(style?.overflow ?? '');
        const overflowX = String(style?.overflowX ?? overflow);
        const overflowY = String(style?.overflowY ?? overflow);
        const contains = ancestor === element || containsPreviewInspectorEscapedHost(style, escape);
        if (contains) escape = readPreviewInspectorHostClipEscape(style);
        if (
          contains && (
            /^(?:auto|clip|hidden|scroll)$/u.test(overflowX) ||
            /^(?:auto|clip|hidden|scroll)$/u.test(overflowY)
          )
        ) {
          let ancestorRectangle;
          try { ancestorRectangle = ancestor.getBoundingClientRect?.(); } catch {
            ancestorRectangle = undefined;
          }
          if (ancestorRectangle !== undefined) {
            const ancestorLeft = Number(ancestorRectangle.left);
            const ancestorRight = Number(ancestorRectangle.right);
            const ancestorTop = Number(ancestorRectangle.top);
            const ancestorBottom = Number(ancestorRectangle.bottom);
            if (
              [ancestorLeft, ancestorRight].every(Number.isFinite) &&
              (right <= ancestorLeft || left >= ancestorRight)
            ) outsideScrollableAncestor = true;
            if (
              [ancestorTop, ancestorBottom].every(Number.isFinite) &&
              (bottom <= ancestorTop || top >= ancestorBottom)
            ) outsideScrollableAncestor = true;
          }
        }
        if (ancestor === mountNode) break;
        ancestor = ancestor.parentElement;
      }
      if (styleHidden) continue;
      const outsideWindow =
        (Number.isFinite(viewportWidth) && viewportWidth > 0 && (right <= 0 || left >= viewportWidth)) ||
        (Number.isFinite(viewportHeight) && viewportHeight > 0 && (bottom <= 0 || top >= viewportHeight));
      if (!hiddenByOpacity && !outsideScrollableAncestor && !outsideWindow) continue;
      return element;
    }
  }
  return undefined;
}

/** Reveals each exact committed host once; replacing a loading host does not consume its successor. */
function revealPreviewInspectorMountedTargetViewport(descriptor, candidate, state) {
  const controlRevision = previewInspectorSession.neuralHumanControlRevision;
  if (
    state.viewportRevealPending === true || state.directTarget === true ||
    state.viewportRevealAttempted === true &&
      state.viewportRevealControlRevision !== controlRevision ||
    state.pageRootCommitted !== true || previewInspectorSession.activeTargetReachabilityKey !== state.key
  ) return false;
  const attemptedElements = state.viewportRevealAttempted === true &&
    state.viewportRevealAttemptedElements instanceof WeakSet
    ? state.viewportRevealAttemptedElements : new WeakSet();
  const element = readPreviewInspectorTargetViewportRevealElement(state, attemptedElements);
  if (element === undefined) return false;
  // An async target can have no measurable host yet; consume the one shot only for a real scroll.
  state.viewportRevealAttempted = true;
  state.viewportRevealAttemptedElements = attemptedElements;
  state.viewportRevealControlRevision = controlRevision;
  attemptedElements.add(element);
  const entryRevision = typeof previewEntryRevision === 'number' ? previewEntryRevision : undefined;
  try {
    element.scrollIntoView({ behavior: 'auto', block: 'nearest', inline: 'nearest' });
  } catch {
    return false;
  }
  state.viewportRevealPending = true;
  const pendingToken = {};
  state.viewportRevealPendingToken = pendingToken;
  state.status = 'revealing-target-viewport';
  state.probeRevision += 1;
  notifyPreviewInspector();
  schedulePreviewInspectorTreeRefresh();
  schedulePreviewInspectorCommitRefresh();
  globalThis.setTimeout(() => {
    if (state.viewportRevealPendingToken !== pendingToken) return;
    delete state.viewportRevealPendingToken;
    state.viewportRevealPending = false;
    if (
      state.directTarget === true ||
      previewInspectorSession.neuralHumanControlRevision !== controlRevision ||
      (typeof previewEntryRevision === 'number' ? previewEntryRevision : undefined) !== entryRevision ||
      previewInspectorSession.activeTargetReachabilityKey !== state.key ||
      previewInspectorSession.targetReachabilityByKey?.get(state.key) !== state
    ) return;
    const selectedDescriptor = typeof findSelectedPreviewInspectorDescriptor === 'function'
      ? findSelectedPreviewInspectorDescriptor()
      : undefined;
    const selectedCandidate = typeof readSelectedPreviewInspectorPageCandidate === 'function'
      ? readSelectedPreviewInspectorPageCandidate(selectedDescriptor)
      : undefined;
    if (
      selectedDescriptor === undefined || selectedCandidate === undefined ||
      selectedCandidate.id !== candidate?.id ||
      createPreviewInspectorTargetReachabilityKey(selectedDescriptor, selectedCandidate) !== state.key
    ) return;
    evaluatePreviewInspectorTargetReachability(selectedDescriptor, selectedCandidate, state);
  }, PREVIEW_INSPECTOR_TARGET_VIEWPORT_REVEAL_DELAY_MS);
  return true;
}

/**
 * Returns the first exact target element when no target element intersects the window and that
 * element lies above or below it, as when a full-height application shell renders before a target
 * mounted after it. Horizontally hidden elements (carousels, off-canvas panels) are never chosen.
 */
function readPreviewInspectorReachedTargetOutsideWindowElement(state) {
  const viewportWidth = Number(globalThis.innerWidth);
  const viewportHeight = Number(globalThis.innerHeight);
  if (!(viewportWidth > 0) || !(viewportHeight > 0)) return undefined;
  let outside;
  for (const boundary of readPreviewInspectorTargetBoundaries(state)) {
    const elements = typeof collectPreviewInspectorFiberElements === 'function'
      ? collectPreviewInspectorFiberElements(boundary)
      : [];
    for (const element of elements) {
      if (
        element?.nodeType !== 1 || element.isConnected !== true ||
        isPreviewInspectorUiElement(element) || typeof element.getBoundingClientRect !== 'function'
      ) continue;
      let rectangle;
      try { rectangle = element.getBoundingClientRect(); } catch { continue; }
      const left = Number(rectangle?.left);
      const right = Number(rectangle?.right);
      const top = Number(rectangle?.top);
      const bottom = Number(rectangle?.bottom);
      if (
        ![left, right, top, bottom].every(Number.isFinite) ||
        right - left <= 0.5 || bottom - top <= 0.5
      ) continue;
      const horizontallyInside = right > 0 && left < viewportWidth;
      if (horizontallyInside && bottom > 0 && top < viewportHeight) return undefined;
      if (outside === undefined && horizontallyInside && typeof element.scrollIntoView === 'function') {
        outside = { element, height: bottom - top };
      }
    }
  }
  return outside;
}

/**
 * Scrolls a target with output into view once when none of it is visible. The check repeats on
 * later commits while the target stays visible, so a shell that grows after data loads is still
 * handled; any user scroll ends it for this target state.
 */
function revealPreviewInspectorReachedTargetViewport(state) {
  if (state.reachedViewportRevealAttempted === true || state.directTarget === true) return false;
  if (Number(globalThis.scrollX) > 0 || Number(globalThis.scrollY) > 0) {
    state.reachedViewportRevealAttempted = true;
    return false;
  }
  const outside = readPreviewInspectorReachedTargetOutsideWindowElement(state);
  if (outside === undefined) return false;
  state.reachedViewportRevealAttempted = true;
  try {
    outside.element.scrollIntoView({
      behavior: 'auto',
      block: outside.height < Number(globalThis.innerHeight) ? 'center' : 'start',
      inline: 'nearest',
    });
  } catch {
    return false;
  }
  return true;
}
`;
}
