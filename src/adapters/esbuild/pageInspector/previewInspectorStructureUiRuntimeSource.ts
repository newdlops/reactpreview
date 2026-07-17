/** Generates UI-side normalization and presentation helpers for wrappers and overlay layers. */

/**
 * Creates structure helpers used by the DevTools-style component tree.
 * Collector metadata remains data-only; these helpers never access Fiber or application objects.
 *
 * @returns Plain JavaScript source for component admission, roles, icons, and row classes.
 */
export function createPreviewInspectorStructureUiRuntimeSource(): string {
  return String.raw`
/** Collector kinds representing authored/declarative boundaries, including project portals. */
const previewInspectorComponentKinds = new Set([
  'class',
  'component',
  'context',
  'entry',
  'forward-ref',
  'function',
  'lazy',
  'memo',
  'portal',
  'suspense',
  'target',
]);

/** Returns whether a collector node is an authored React boundary rather than an internal Fiber. */
function isPreviewInspectorComponentNode(node) {
  const kind = typeof node?.kind === 'string' ? node.kind.toLowerCase() : 'component';
  if (node?.isHost === true) return false;
  if (kind === 'root') {
    return typeof node?.exportName === 'string' && node.exportName.length > 0;
  }
  return previewInspectorComponentKinds.has(kind);
}

/** Reports portal, modal, and compiler-discovered dormant overlay entries uniformly. */
function isPreviewInspectorOverlayNode(node) {
  return node?.role === 'overlay' || node?.kind === 'portal' || node?.condition?.role === 'overlay';
}

/** Reports a mounted component that forwards children through hostless/provider boundaries. */
function isPreviewInspectorTransparentWrapperNode(node) {
  return node?.role === 'transparent-wrapper';
}

/** Produces a semantic tree icon while keeping the row label available to screen readers. */
function readPreviewInspectorStructureIcon(node, isCondition) {
  if (isPreviewInspectorOverlayNode(node)) return '▱';
  if (isPreviewInspectorTransparentWrapperNode(node)) return '⬚';
  return isCondition ? '◐' : '◇';
}

/** Adds narrowly scoped role classes without allowing collector-provided arbitrary class names. */
function readPreviewInspectorStructureRowClass(node) {
  if (isPreviewInspectorOverlayNode(node)) return ' rpi-overlay-row';
  if (isPreviewInspectorTransparentWrapperNode(node)) return ' rpi-wrapper-row';
  return '';
}
`;
}
