/** Generates the private capability, token, boundary, and DOM-ownership primitives. */
export function createPreviewInspectorDomOwnershipRuntimeSource(): string {
  return String.raw`
let previewInspectorJsxOwnershipContext;
const PREVIEW_INSPECTOR_JSX_OWNERSHIP_CONTEXT_KEY = Symbol.for('newdlops.react-file-preview.page-inspector.jsx-ownership-context');
const previewInspectorOwnershipByToken = new WeakMap();
const previewInspectorCapabilitiesByMarker = new WeakMap();
function registerPreviewInspectorCompilerCapability(marker, metadata) {
  if ((typeof marker !== 'object' && typeof marker !== 'function') || marker === null || typeof metadata?.sourcePath !== 'string' || typeof metadata?.exportName !== 'string') return false;
  const next = { exportName: metadata.exportName, sourcePath: metadata.sourcePath.replaceAll('\\', '/') };
  const existing = previewInspectorCapabilitiesByMarker.get(marker);
  if (existing !== undefined) return existing.exportName === next.exportName && existing.sourcePath === next.sourcePath;
  previewInspectorCapabilitiesByMarker.set(marker, next);
  return true;
}
function createPreviewInspectorOwnershipToken(capability, metadata) {
  const registered = previewInspectorCapabilitiesByMarker.get(capability);
  if ((typeof capability !== 'object' && typeof capability !== 'function') || capability === null || typeof metadata?.sourcePath !== 'string' || metadata.sourcePath.length === 0 || typeof metadata?.exportName !== 'string' || metadata.exportName.length === 0 || registered?.exportName !== metadata.exportName || registered.sourcePath !== metadata.sourcePath.replaceAll('\\', '/')) return undefined;
  const token = {};
  previewInspectorOwnershipByToken.set(token, { capability, exportName: metadata.exportName, nodes: new Set(), sourcePath: metadata.sourcePath.replaceAll('\\', '/') });
  return token;
}
function registerPreviewInspectorJsxOwnershipContext(context) { if (context !== undefined) { previewInspectorJsxOwnershipContext = context; globalThis[PREVIEW_INSPECTOR_JSX_OWNERSHIP_CONTEXT_KEY] ??= context; } }
function readPreviewInspectorJsxOwnershipContext() { return previewInspectorJsxOwnershipContext ?? globalThis[PREVIEW_INSPECTOR_JSX_OWNERSHIP_CONTEXT_KEY]; }
function registerPreviewInspectorOwnedHost(token, node) {
  const record = previewInspectorOwnershipByToken.get(token);
  if (record === undefined || node?.nodeType !== 1) return undefined;
  const added = !record.nodes.has(node);
  record.nodes.add(node);
  if (typeof schedulePreviewInspectorCommitRefresh === 'function') schedulePreviewInspectorCommitRefresh();
  if (added && typeof continuePreviewInspectorTargetReachabilityAfterOwnedHostRegistration === 'function') {
    continuePreviewInspectorTargetReachabilityAfterOwnedHostRegistration(record);
  }
  return () => {
    if (!record.nodes.delete(node)) return;
    if (typeof schedulePreviewInspectorCommitRefresh === 'function') schedulePreviewInspectorCommitRefresh();
  };
}
function registerPreviewInspectorOwnershipBoundary(token, boundary) { const record = previewInspectorOwnershipByToken.get(token); if (record === undefined) return undefined; record.boundary = boundary; return () => { if (record.boundary === boundary) record.boundary = undefined; record.nodes.clear(); }; }
function clearPreviewInspectorOwnedHosts(token, boundary) { const record = previewInspectorOwnershipByToken.get(token); if (record?.boundary === boundary) record.nodes.clear(); }
function readPreviewInspectorOwnedBoundaryRecord(boundary, state) { const token = boundary?.ownershipToken; const record = previewInspectorOwnershipByToken.get(token); const descriptor = typeof findSelectedPreviewInspectorDescriptor === 'function' ? findSelectedPreviewInspectorDescriptor() : undefined; const sourcePath = state?.targetSourcePath ?? descriptor?.inspector?.target?.sourcePath; if (record === undefined || record.boundary !== boundary || record.exportName !== state?.targetExportName || typeof sourcePath !== 'string' || record.sourcePath !== sourcePath.replaceAll('\\', '/')) return undefined; return record; }
function hasPreviewInspectorOwnedBoundary(boundary, state) { return readPreviewInspectorOwnedBoundaryRecord(boundary, state) !== undefined; }
function readPreviewInspectorOwnedHosts(boundary, state) { const record = readPreviewInspectorOwnedBoundaryRecord(boundary, state); return record === undefined ? [] : [...record.nodes]; }
`;
}
