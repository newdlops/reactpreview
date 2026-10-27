/** Generates storage for temporary, non-persisted Inspector prop repairs. */
export function createPreviewInspectorResolverPropsRuntimeSource(): string {
  return String.raw`
/** Stores one resolver-owned prop layer and optionally commits the selected export. */
function setPreviewInspectorResolverPropsOverride(exportName, value, commit = true) {
  if (typeof exportName !== 'string' || exportName.length === 0) return false;
  const runtimeValue = copyPreviewInspectorNeuralRuntimeSnapshotValue(value);
  if (runtimeValue === undefined && value !== undefined) return false;
  previewInspectorSession.resolverPropsByExport.set(
    exportName,
    normalizePreviewInspectorProps(runtimeValue),
  );
  if (commit) {
    refreshPreviewInspectorExport(exportName, false);
  } else {
    const revision = previewInspectorSession.propsRevisionByExport.get(exportName) ?? 0;
    previewInspectorSession.propsRevisionByExport.set(exportName, revision + 1);
  }
  return true;
}
`;
}
