/** Generates the browser helper that distinguishes painted hosts from zero-size or clipped DOM. */
export function createPreviewInspectorHostGeometryRuntimeSource(): string {
  return String.raw`
/** Reads computed layout style without letting a detached/test node break output discovery. */
function readPreviewInspectorHostStyle(element) {
  try { return globalThis.getComputedStyle?.(element); } catch { return undefined; }
}

/** Rejects CSS states that cannot paint even when their DOM rectangle is non-empty. */
function isPreviewInspectorHostStyleVisible(style) {
  if (style?.display === 'none' || style?.visibility === 'hidden' || style?.contentVisibility === 'hidden') {
    return false;
  }
  const opacity = Number(style?.opacity);
  return !Number.isFinite(opacity) || opacity > 0;
}

/**
 * Rejects connected hosts whose painted rectangle is empty or fully clipped by an overflow-hidden
 * ancestor. DOM ownership alone is insufficient for drawers that retain a resize handle at width
 * zero. Geometry is fail-open when a non-browser test host cannot provide layout information.
 */
function hasPreviewInspectorRenderableHostGeometry(node) {
  if (node?.nodeType !== 1 || node.hidden === true) return false;
  if (!isPreviewInspectorHostStyleVisible(readPreviewInspectorHostStyle(node))) return false;
  if (typeof node.getBoundingClientRect !== 'function') return true;
  let rectangle;
  try { rectangle = node.getBoundingClientRect(); } catch { return true; }
  let left = Number(rectangle?.left);
  let right = Number(rectangle?.right);
  let top = Number(rectangle?.top);
  let bottom = Number(rectangle?.bottom);
  if (![left, right, top, bottom].every(Number.isFinite)) return true;
  if (right - left <= 0.5 || bottom - top <= 0.5) return false;
  let ancestor = node.parentElement;
  let steps = 0;
  while (ancestor !== null && ancestor !== undefined && steps < 64) {
    steps += 1;
    const style = readPreviewInspectorHostStyle(ancestor);
    if (!isPreviewInspectorHostStyleVisible(style)) return false;
    const clipsX = /^(?:clip|hidden)$/u.test(String(style?.overflowX ?? style?.overflow ?? ''));
    const clipsY = /^(?:clip|hidden)$/u.test(String(style?.overflowY ?? style?.overflow ?? ''));
    if ((clipsX || clipsY) && typeof ancestor.getBoundingClientRect === 'function') {
      let ancestorRectangle;
      try { ancestorRectangle = ancestor.getBoundingClientRect(); } catch { ancestorRectangle = undefined; }
      if (ancestorRectangle !== undefined) {
        if (clipsX) {
          left = Math.max(left, Number(ancestorRectangle.left));
          right = Math.min(right, Number(ancestorRectangle.right));
        }
        if (clipsY) {
          top = Math.max(top, Number(ancestorRectangle.top));
          bottom = Math.min(bottom, Number(ancestorRectangle.bottom));
        }
        if (right - left <= 0.5 || bottom - top <= 0.5) return false;
      }
    }
    if (ancestor === mountNode) break;
    ancestor = ancestor.parentElement;
  }
  return true;
}

/**
 * Recognizes an otherwise healthy exact-target host hidden only by a positive-size overflowing
 * layout viewport. This is intentionally stricter than normal geometry: it never admits a
 * collapsed drawer, opacity transition, transformed off-screen panel, or merely off-viewport DOM.
 */
function hasPreviewInspectorStableClippedHostGeometry(node) {
  if (node?.nodeType !== 1 || node.hidden === true || typeof node.getBoundingClientRect !== 'function') {
    return false;
  }
  const hasOffscreenTransform = (style) => {
    const transform = String(style?.transform ?? '').trim();
    return transform !== '' && transform !== 'none';
  };
  const readRectangle = (element) => {
    let rectangle;
    try { rectangle = element.getBoundingClientRect(); } catch { return undefined; }
    const result = {
      bottom: Number(rectangle?.bottom),
      left: Number(rectangle?.left),
      right: Number(rectangle?.right),
      top: Number(rectangle?.top),
    };
    return Object.values(result).every(Number.isFinite) ? result : undefined;
  };
  const nodeStyle = readPreviewInspectorHostStyle(node);
  if (!isPreviewInspectorHostStyleVisible(nodeStyle) || hasOffscreenTransform(nodeStyle)) return false;
  const rectangle = readRectangle(node);
  if (rectangle === undefined || rectangle.right - rectangle.left <= 0.5 || rectangle.bottom - rectangle.top <= 0.5) {
    return false;
  }
  let visibleLeft = rectangle.left;
  let visibleRight = rectangle.right;
  let visibleTop = rectangle.top;
  let visibleBottom = rectangle.bottom;
  let stableLayoutClip = false;
  let ancestor = node.parentElement;
  let steps = 0;
  while (ancestor !== null && ancestor !== undefined && steps < 64) {
    steps += 1;
    const style = readPreviewInspectorHostStyle(ancestor);
    if (ancestor.hidden === true || !isPreviewInspectorHostStyleVisible(style) || hasOffscreenTransform(style)) {
      return false;
    }
    const clipsX = /^(?:clip|hidden)$/u.test(String(style?.overflowX ?? style?.overflow ?? ''));
    const clipsY = /^(?:clip|hidden)$/u.test(String(style?.overflowY ?? style?.overflow ?? ''));
    if ((clipsX || clipsY) && typeof ancestor.getBoundingClientRect === 'function') {
      const ancestorRectangle = readRectangle(ancestor);
      if (
        ancestorRectangle === undefined ||
        ancestorRectangle.right - ancestorRectangle.left <= 0.5 ||
        ancestorRectangle.bottom - ancestorRectangle.top <= 0.5
      ) return false;
      const nextLeft = clipsX ? Math.max(visibleLeft, ancestorRectangle.left) : visibleLeft;
      const nextRight = clipsX ? Math.min(visibleRight, ancestorRectangle.right) : visibleRight;
      const nextTop = clipsY ? Math.max(visibleTop, ancestorRectangle.top) : visibleTop;
      const nextBottom = clipsY ? Math.min(visibleBottom, ancestorRectangle.bottom) : visibleBottom;
      const overflowingX = Number(ancestor.scrollWidth) - Number(ancestor.clientWidth) > 0.5;
      const overflowingY = Number(ancestor.scrollHeight) - Number(ancestor.clientHeight) > 0.5;
      if (
        (clipsX && overflowingX && nextRight - nextLeft <= 0.5 && nextBottom - nextTop > 0.5) ||
        (clipsY && overflowingY && nextBottom - nextTop <= 0.5 && nextRight - nextLeft > 0.5)
      ) stableLayoutClip = true;
      visibleLeft = nextLeft;
      visibleRight = nextRight;
      visibleTop = nextTop;
      visibleBottom = nextBottom;
    }
    if (ancestor === mountNode) break;
    ancestor = ancestor.parentElement;
  }
  return stableLayoutClip;
}
`;
}
