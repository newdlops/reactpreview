/**
 * Generates reusable ambiguity rules for root-to-target component-name evidence.
 *
 * React applications routinely repeat wrapper display names across routes. Name-only matching is
 * therefore admitted only when the reached conditions expose one source identity; exact selected
 * export identity and source-path evidence remain authoritative in the reachability runtime.
 */

/** Creates browser helpers that classify generic wrappers and repeated runtime owner names. */
export function createPreviewInspectorTargetPathIdentityRuntimeSource(): string {
  return String.raw`
const PREVIEW_INSPECTOR_SHARED_OWNER_NAMES = new Set([
  'Anonymous', 'Boundary', 'Component', 'Container', 'Content', 'Dialog', 'Drawer',
  'Fallback', 'Fragment', 'Layout', 'Modal', 'Overlay', 'Page', 'Portal', 'Popover',
  'Provider', 'Route', 'Router', 'Section', 'Shell', 'View', 'Wrapper',
]);

/** Recognizes conventional and styled overlay/wrapper names without project-specific vocabulary. */
function isPreviewInspectorSharedOwnerName(value) {
  const source = typeof value === 'string' ? value.trim() : '';
  const styledMatch = /^Styled\(([^()]+)\)$/u.exec(source);
  const name = styledMatch?.[1] ?? source;
  return PREVIEW_INSPECTOR_SHARED_OWNER_NAMES.has(name) ||
    /(?:Boundary|Container|Dialog|Drawer|Modal|Popover|Portal|Provider|Wrapper)$/u.test(name);
}

/**
 * Marks generic names and runtime owners emitted from multiple source files as name-ambiguous.
 * Unknown source locations use the compiler condition ID so two unlocated siblings cannot be
 * collapsed into a false single-owner proof.
 */
function readPreviewInspectorAmbiguousTargetOwnerNames(names) {
  const ambiguous = new Set([...names].filter(isPreviewInspectorSharedOwnerName));
  const sourceKeysByName = new Map();
  for (const condition of previewInspectorSession.renderConditions?.values?.() ?? []) {
    const ownerName = typeof condition?.ownerName === 'string' ? condition.ownerName : '';
    if (!names.has(ownerName) || ownerName.length === 0) continue;
    let sourceKeys = sourceKeysByName.get(ownerName);
    if (!(sourceKeys instanceof Set)) {
      sourceKeys = new Set();
      sourceKeysByName.set(ownerName, sourceKeys);
    }
    const sourcePath = normalizePreviewInspectorReachabilityPath(condition?.sourcePath);
    sourceKeys.add(sourcePath.length > 0 ? sourcePath : 'condition:' + String(condition?.id ?? ''));
  }
  for (const [ownerName, sourceKeys] of sourceKeysByName) {
    if (sourceKeys.size > 1) ambiguous.add(ownerName);
  }
  return ambiguous;
}
`;
}
