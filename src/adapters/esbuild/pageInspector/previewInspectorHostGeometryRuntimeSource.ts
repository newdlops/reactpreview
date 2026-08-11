/** Generates the browser helper that distinguishes painted hosts from zero-size or clipped DOM. */
export function createPreviewInspectorHostGeometryRuntimeSource(): string {
  return String.raw`
/**
 * Rejects connected hosts whose painted rectangle is empty or fully clipped by an overflow-hidden
 * ancestor. DOM ownership alone is insufficient for drawers that retain a resize handle at width
 * zero. Geometry is fail-open when a non-browser test host cannot provide layout information.
 */
function hasPreviewInspectorRenderableHostGeometry(node) {
  if (node?.nodeType !== 1 || node.hidden === true) return false;
  const readStyle = (element) => {
    try { return globalThis.getComputedStyle?.(element); } catch { return undefined; }
  };
  const isStyleVisible = (style) => {
    if (style?.display === 'none' || style?.visibility === 'hidden' || style?.contentVisibility === 'hidden') {
      return false;
    }
    const opacity = Number(style?.opacity);
    return !Number.isFinite(opacity) || opacity > 0;
  };
  if (!isStyleVisible(readStyle(node))) return false;
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
    const style = readStyle(ancestor);
    if (!isStyleVisible(style)) return false;
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
`;
}
