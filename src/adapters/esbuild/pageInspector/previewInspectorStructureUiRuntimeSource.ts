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

/** Produces a semantic tree icon while keeping the explicit role label available beside it. */
function readPreviewInspectorStructureIcon(node, isCondition, isBlocking, isCurrentFileExport) {
  if (isBlocking) return '!';
  if (isCondition) return '?';
  if (node?.blockerKind === 'target-reachability') return '↳';
  if (node?.kind === 'blocker') return '≈';
  if (isCurrentFileExport) return '◎';
  if (node?.edgeKind === 'workspace-render-root') return '⌂';
  if (node?.edgeKind === 'hoc-wrapper') return 'H';
  if (node?.edgeKind === 'component-slot') return 'P';
  if (node?.kind === 'route' && node?.contextOnly === true) return '↳';
  if (node?.kind === 'entry' && node?.contextOnly === true) return '◆';
  if (isPreviewInspectorOverlayNode(node)) return '▱';
  if (isPreviewInspectorTransparentWrapperNode(node)) return '⬚';
  return 'C';
}

/** Gives every row one plain-language role so users never infer meaning from color alone. */
function readPreviewInspectorTreeNodeRole(node, isCondition, isBlocking, isCurrentFileExport) {
  if (
    node?.blockerKind === 'target-reachability' &&
    node?.blocker?.pageRootCommitted === true &&
    node?.blocker?.targetMounted !== true
  ) {
    return { key: 'path', label: 'FLOW OUTCOME' };
  }
  if (isBlocking) return { key: 'blocker', label: 'BLOCKER' };
  if (isCondition) return { key: 'condition', label: 'CONDITION' };
  if (node?.blockerKind === 'target-reachability') {
    return { key: 'path', label: 'PAGE SEARCH' };
  }
  if (node?.kind === 'blocker') return { key: 'assisted', label: 'PREVIEW VALUE' };
  if (isCurrentFileExport) return { key: 'target', label: 'CURRENT FILE' };
  if (node?.edgeKind === 'hoc-wrapper') return { key: 'path', label: 'HOC' };
  if (node?.edgeKind === 'component-slot') return { key: 'path', label: 'COMPONENT PROP' };
  if (node?.contextOnly === true) return { key: 'path', label: 'PAGE PATH' };
  return { key: 'component', label: 'COMPONENT' };
}

/** Adds narrowly scoped role classes without allowing collector-provided arbitrary class names. */
function readPreviewInspectorStructureRowClass(node) {
  if (isPreviewInspectorOverlayNode(node)) return ' rpi-overlay-row';
  if (node?.edgeKind === 'hoc-wrapper' || node?.edgeKind === 'component-slot') {
    return ' rpi-wrapper-row';
  }
  if (isPreviewInspectorTransparentWrapperNode(node)) return ' rpi-wrapper-row';
  return '';
}
`;
}
