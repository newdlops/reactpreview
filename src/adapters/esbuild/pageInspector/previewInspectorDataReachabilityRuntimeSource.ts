/**
 * Generates batched backend-payload completion for one authored page reachability corridor.
 *
 * The general data runtime owns request registration and explicit editor actions. This small adapter
 * owns only DFS convergence so deterministic automatic traversal can preserve every explicit user
 * payload while the broader, user-invoked Smart action can still complete a custom fixture.
 */

/** Creates browser source for one bounded reachability-key payload completion pass. */
export function createPreviewInspectorDataReachabilityRuntimeSource(): string {
  return String.raw`
/** Smart-fills observed requests once, optionally leaving every explicit payload untouched. */
function smartFillPreviewInspectorDataPayloadsForReachability(reachabilityKey, options = {}) {
  initializePreviewInspectorDataState();
  const preserveUserValues = options?.preserveUserValues === true;
  let changed = false;
  for (const record of previewInspectorSession.dataRequests.values()) {
    if (record.reachabilityKey !== reachabilityKey) continue;
    const current = previewInspectorSession.dataPayloadOverrides.get(record.id);
    if (preserveUserValues && current !== undefined) continue;
    const minimum = generatePreviewInspectorDataValue(record.shape, '', 'smart');
    const retainUserPayload = current?.mode === 'custom' || current?.mode === 'smart-custom';
    const payload = retainUserPayload
      ? completePreviewInspectorDataSmartPayload(current.payload, minimum)
      : minimum;
    const mode = retainUserPayload ? 'smart-custom' : 'smart';
    const payloadChanged = current?.mode !== mode ||
      stringifyPreviewInspectorProps(current?.payload) !== stringifyPreviewInspectorProps(payload);
    if (payloadChanged) {
      changed = applyPreviewInspectorDataPayloadOverride(record.id, payload, mode) || changed;
    }
  }
  if (changed) previewInspectorSession.dataAutoEnabled = true;
  return changed;
}
`;
}
