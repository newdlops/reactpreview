/**
 * Generates the browser-side formatter for static application render-chain evidence.
 * Keeping this helper outside the main Page Inspector runtime preserves the 1000-line file boundary
 * and gives future route/entry selection controls a focused module that does not touch Fiber logic.
 */

/**
 * Creates JavaScript that explains the best entry-to-target path without exposing source paths.
 *
 * @returns Runtime source expecting the shared `previewInspectorSession` binding to exist.
 */
export function createPreviewInspectorChainRuntimeSource(): string {
  return String.raw`
/** Formats the best static application-entry path, with legacy JSX-owner ancestry as a fallback. */
function describePreviewInspectorAncestry() {
  const inspector = previewInspectorSession.descriptors[0]?.inspector;
  if (inspector === undefined) return 'No static component ancestry was discovered.';
  const selectedExportName = previewInspectorSession.selectedExportName;
  const renderChain = inspector.renderChainsByExport?.[selectedExportName] ?? inspector.renderChain;
  const selectedPath = renderChain?.paths?.[0];
  if (selectedPath !== undefined) {
    const names = [];
    for (const step of [...(selectedPath.steps ?? [])].reverse()) {
      const label = step?.label;
      if (typeof label === 'string' && names.at(-1) !== label) names.push(label);
      for (const wrapperName of [...(step?.wrapperNames ?? [])].reverse()) {
        if (typeof wrapperName === 'string' && names.at(-1) !== wrapperName) names.push(wrapperName);
      }
    }
    const alternatives = Math.max(0, (renderChain.paths?.length ?? 1) - 1);
    const status = renderChain.reachability === 'entry-connected'
      ? 'entry connected'
      : renderChain.reachability === 'ambiguous'
        ? 'multiple entries'
        : 'standalone fallback';
    return names.join('  ›  ') + '  ·  ' + status +
      (alternatives > 0 ? '  ·  +' + String(alternatives) + ' path(s)' : '') +
      (renderChain.truncated === true ? '  ·  bounded graph' : '');
  }
  const names = [];
  for (const edge of [...(inspector.ancestry ?? [])].reverse()) {
    const ownerName = edge?.owner?.exportName;
    if (typeof ownerName === 'string' && names.at(-1) !== ownerName) names.push(ownerName);
    for (const localName of [...(edge?.localOwnerNames ?? [])].reverse()) {
      if (typeof localName === 'string' && names.at(-1) !== localName) names.push(localName);
    }
  }
  const targetName = inspector.target?.exportName ?? 'default';
  if (names.at(-1) !== targetName) names.push(targetName);
  return names.join('  ›  ') +
    (inspector.complete === true ? '' : '  ·  partial: ' + String(inspector.stopReason));
}
`;
}
