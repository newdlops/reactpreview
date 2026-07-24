/**
 * Generates the serializable Page Inspector diagnostic snapshot exposed to extension tooling.
 *
 * The diagnostic boundary intentionally excludes Fiber, DOM, hook, and application values. It
 * retains only bounded condition/path decisions so an automatically opened branch can be explained
 * from logs without copying project payloads into the extension protocol.
 */

/**
 * Creates a data-only browser helper after condition and target runtimes have been composed.
 *
 * Expected lexical bindings are the Inspector session plus `readPreviewInspectorRenderConditions`.
 * Function declaration hoisting keeps composition order independent.
 *
 * @returns Plain JavaScript source for one bounded diagnostics reader.
 */
export function createPreviewInspectorDiagnosticsRuntimeSource(): string {
  return String.raw`
/** Returns authored/manual/automatic condition layers and their active target traversal. */
function readPreviewInspectorSerializableDiagnostics() {
  const allRenderConditions = readPreviewInspectorRenderConditions();
  const renderConditions = allRenderConditions.slice(0, 256).map(
    (condition) => ({
      authoredEnabled: condition.authoredEnabled,
      autoOverride: condition.autoOverride,
      effectiveEnabled: condition.effectiveEnabled,
      expression: condition.expression,
      id: condition.id,
      kind: condition.kind,
      override: condition.override,
      ownerName: condition.ownerName,
      reachabilityKey: condition.reachabilityKey,
      role: condition.role,
      sourcePath: condition.sourcePath,
    }),
  );
  const activeOverlayConditions = allRenderConditions.filter(
    (condition) =>
      condition?.role === 'overlay' &&
      (
        condition.effectiveEnabled === true ||
        typeof condition.autoOverride === 'boolean' ||
        typeof condition.override === 'boolean'
      ),
  ).slice(0, 128);
  const targetReachability = [...(
    previewInspectorSession.targetReachabilityByKey?.values?.() ?? []
  )].slice(0, 32).map((state) => ({
    appliedConditions: Array.isArray(state?.appliedConditions)
      ? state.appliedConditions.slice(0, 64)
      : [],
    key: state?.key,
    status: state?.status,
    targetExportName: state?.targetExportName,
    targetHasOutput: state?.targetHasOutput,
    targetMounted: state?.targetMounted,
  }));
  return { activeOverlayConditions, renderConditions, targetReachability };
}
`;
}
