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
/** Adds one nonempty component label without repeating an adjacent render-chain identity. */
function appendPreviewInspectorPageContextName(names, value) {
  if (typeof value === 'string' && value.length > 0 && names.at(-1) !== value) names.push(value);
}

/** Reads the mounted root and best static application path as one user-facing page identity. */
function readPreviewInspectorPageContext() {
  const descriptor = findSelectedPreviewInspectorDescriptor();
  const inspector = descriptor?.inspector;
  if (inspector === undefined) {
    return {
      badge: 'STANDALONE',
      breadcrumb: 'No authored page context was proven',
      detail: 'Rendering the selected export as an isolated fallback.',
      kind: 'standalone',
    };
  }
  const selectedExportName = previewInspectorSession.selectedExportName;
  const renderChain = inspector.renderChainsByExport?.[selectedExportName] ?? inspector.renderChain;
  const selectedPath = renderChain?.paths?.[0];
  const names = [];
  if (selectedPath !== undefined) {
    for (const step of [...(selectedPath.steps ?? [])].reverse()) {
      appendPreviewInspectorPageContextName(names, step?.label);
      for (const wrapperName of [...(step?.wrapperNames ?? [])].reverse()) {
        appendPreviewInspectorPageContextName(names, wrapperName);
      }
    }
  } else {
    for (const edge of [...(inspector.ancestry ?? [])].reverse()) {
      appendPreviewInspectorPageContextName(names, edge?.owner?.exportName);
      for (const localName of [...(edge?.localOwnerNames ?? [])].reverse()) {
        appendPreviewInspectorPageContextName(names, localName);
      }
    }
  }
  const rootName = inspector.root?.exportName;
  const targetName = renderChain?.target?.exportName ?? inspector.target?.exportName ?? 'default';
  if (typeof rootName === 'string' && !names.includes(rootName)) names.unshift(rootName);
  appendPreviewInspectorPageContextName(names, targetName);
  const rootIsTarget = inspector.root?.sourcePath === inspector.target?.sourcePath &&
    inspector.root?.exportName === inspector.target?.exportName;
  const hasAuthoredParent = !rootIsTarget || (inspector.ancestry?.length ?? 0) > 0;
  const entryConnected = renderChain?.reachability === 'entry-connected';
  const entryAmbiguous = renderChain?.reachability === 'ambiguous';
  const hasApplicationEntry = entryConnected || entryAmbiguous;
  const entryStatus = entryAmbiguous
    ? 'multiple application entries'
    : 'application entry connected';
  const alternatives = Math.max(0, (renderChain?.paths?.length ?? 1) - 1);
  const suffix =
    (alternatives > 0 ? ' · +' + String(alternatives) + ' page path(s)' : '') +
    (renderChain?.truncated === true ? ' · bounded graph' : '');
  if (hasAuthoredParent) {
    return {
      badge: 'PAGE COMPONENT',
      breadcrumb: names.join('  ›  '),
      detail: 'Mounted inside authored page root ' + String(rootName ?? 'unknown') +
        (hasApplicationEntry ? ' · ' + entryStatus : ' · nearest safe page context') + suffix,
      kind: 'page-component',
    };
  }
  if (hasApplicationEntry) {
    return {
      badge: 'PAGE ROOT',
      breadcrumb: names.join('  ›  '),
      detail: 'The selected component is the authored page root · ' + entryStatus + suffix,
      kind: 'page-root',
    };
  }
  return {
    badge: 'STANDALONE',
    breadcrumb: names.join('  ›  '),
    detail: 'No safe outer page component was proven · ' + String(inspector.stopReason ?? 'entry unreachable'),
    kind: 'standalone',
  };
}

/** Formats the structured page identity for diagnostics and compatibility consumers. */
function describePreviewInspectorAncestry() {
  const context = readPreviewInspectorPageContext();
  return context.breadcrumb + '  ·  ' + context.detail;
}
`;
}
