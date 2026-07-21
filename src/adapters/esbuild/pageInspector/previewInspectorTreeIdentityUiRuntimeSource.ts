/**
 * Generates shared current-file identity helpers for every Page Inspector tree consumer.
 *
 * Tree selection, the main-component action, and optional flow visualizations all need the same
 * exact export lookup. Keeping that lookup in an always-composed UI fragment prevents a retired or
 * optional presentation surface from accidentally owning a runtime dependency used by the core
 * Inspector shell.
 */

/**
 * Creates browser-side helpers that locate the selected file's strongest exact component-tree row.
 *
 * Expected lexical bindings include only the selected descriptor reader and preview session. The
 * helpers inspect serializable tree records; they never retain Fiber nodes or access project
 * component values.
 *
 * @returns Plain JavaScript concatenated into the complete Page Inspector UI runtime.
 */
export function createPreviewInspectorTreeIdentityUiRuntimeSource(): string {
  return String.raw`
/** Matches exact paths and one absolute/relative JSX-development representation of the same file. */
function matchesPreviewInspectorTreeIdentitySourcePath(left, right) {
  if (left === right) return true;
  if (typeof left !== 'string' || typeof right !== 'string') return false;
  const normalizedLeft = left.replaceAll('\\', '/');
  const normalizedRight = right.replaceAll('\\', '/');
  const leftAbsolute = normalizedLeft.startsWith('/') || /^[A-Za-z]:\//u.test(normalizedLeft);
  const rightAbsolute = normalizedRight.startsWith('/') || /^[A-Za-z]:\//u.test(normalizedRight);
  if (leftAbsolute === rightAbsolute) return false;
  const absolute = leftAbsolute ? normalizedLeft : normalizedRight;
  const relative = leftAbsolute ? normalizedRight : normalizedLeft;
  return relative.length > 0 && absolute.endsWith('/' + relative.replace(/^\.\//u, ''));
}

/** Reads the selected file/export identity without guessing from a component display name. */
function readPreviewInspectorCurrentFileTreeIdentity() {
  const descriptor = findSelectedPreviewInspectorDescriptor();
  const inspector = descriptor?.inspector;
  const selectedExportName = previewInspectorSession.selectedExportName;
  const selectedChainTarget = inspector?.renderChainsByExport?.[selectedExportName]?.target;
  const primaryTarget = inspector?.target?.exportName === selectedExportName
    ? inspector.target
    : undefined;
  const target = selectedChainTarget ?? primaryTarget;
  const exportName = typeof target?.exportName === 'string' && target.exportName.length > 0
    ? target.exportName
    : selectedExportName;
  const sourcePath = typeof target?.sourcePath === 'string' && target.sourcePath.length > 0
    ? target.sourcePath
    : undefined;
  return { exportName, sourcePath };
}

/**
 * Finds the strongest exact tree candidate instead of returning the first same-named export.
 * Mounted, source-matched current-file rows outrank static inventory and unrelated package exports.
 */
function findPreviewInspectorUiNodeByExport(nodes, exportName) {
  const identity = readPreviewInspectorCurrentFileTreeIdentity();
  const candidates = [];
  const visit = (values, depth = 0) => {
    for (const node of values ?? []) {
      if (node?.exportName === exportName) {
        const sourcePath = node?.source?.path ?? node?.source?.sourcePath;
        const sourceMatches = identity.sourcePath !== undefined &&
          typeof sourcePath === 'string' &&
          matchesPreviewInspectorTreeIdentitySourcePath(sourcePath, identity.sourcePath);
        candidates.push({
          depth,
          node,
          score: Number(node.currentFileExport === true) * 100 + Number(sourceMatches) * 50 +
            Number(node.mounted !== false) * 20 + Number(node.contextOnly !== true) * 10,
        });
      }
      visit(node?.children, depth + 1);
    }
  };
  visit(nodes);
  return candidates.sort((left, right) =>
    right.score - left.score || right.depth - left.depth ||
      String(left.node.id ?? '').localeCompare(String(right.node.id ?? '')))[0]?.node;
}
`;
}
