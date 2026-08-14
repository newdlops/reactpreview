/** Generates bounded viewport activation for exact targets behind authored scroll animations. */
export function createPreviewInspectorTargetViewportRevealRuntimeSource(): string {
  return String.raw`
const PREVIEW_INSPECTOR_TARGET_VIEWPORT_REVEAL_DELAY_MS = 900;

/**
 * Finds exact target DOM that is waiting outside a viewport or behind a scroll-triggered opacity
 * transition. Positive geometry keeps this separate from intentionally empty and display-hidden
 * targets, while exact compiler boundaries prevent an unrelated page host from moving the page.
 */
function readPreviewInspectorTargetViewportRevealElement(state) {
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
        if (
          /^(?:auto|clip|hidden|scroll)$/u.test(overflowX) ||
          /^(?:auto|clip|hidden|scroll)$/u.test(overflowY)
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

/** Scrolls an exact mounted target once, allowing its authored IntersectionObserver to reveal it. */
function revealPreviewInspectorMountedTargetViewport(descriptor, candidate, state) {
  if (
    state.viewportRevealAttempted === true || state.directTarget === true ||
    state.pageRootCommitted !== true || previewInspectorSession.activeTargetReachabilityKey !== state.key
  ) return false;
  state.viewportRevealAttempted = true;
  const element = readPreviewInspectorTargetViewportRevealElement(state);
  if (element === undefined) return false;
  try {
    element.scrollIntoView({ behavior: 'auto', block: 'nearest', inline: 'nearest' });
  } catch {
    return false;
  }
  state.viewportRevealPending = true;
  state.status = 'revealing-target-viewport';
  state.probeRevision += 1;
  notifyPreviewInspector();
  schedulePreviewInspectorTreeRefresh();
  schedulePreviewInspectorCommitRefresh();
  globalThis.setTimeout(() => {
    if (
      state.viewportRevealPending !== true || state.directTarget === true ||
      previewInspectorSession.activeTargetReachabilityKey !== state.key ||
      previewInspectorSession.targetReachabilityByKey?.get(state.key) !== state
    ) return;
    state.viewportRevealPending = false;
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
`;
}
