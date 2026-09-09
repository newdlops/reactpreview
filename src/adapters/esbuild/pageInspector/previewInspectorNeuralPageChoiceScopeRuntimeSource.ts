/** Restricts page choices to compiler-registered handlers for the blocked local state binding. */
export function createPreviewInspectorNeuralPageChoiceScopeRuntimeSource(): string {
  return String.raw`
/** Reads data descriptors only; page getters cannot execute while choices are being inspected. */
function readPreviewInspectorNeuralPageChoiceData(value, key) {
  try { return Object.getOwnPropertyDescriptor(value, key)?.value; } catch { return undefined; }
}

/** Finds exact source/state evidence; CSS classes and generic control roles are never proof. */
function readPreviewInspectorNeuralPageChoiceSources(condition) {
  const normalize = (value) => typeof value === 'string' ? value.replaceAll('\\', '/') : '';
  const sourcePath = normalize(condition?.sourcePath);
  const ownerName = condition?.runtimeOwnerName || condition?.ownerName;
  if (
    condition?.requiresAuthoredState !== true || sourcePath.length === 0 ||
    typeof ownerName !== 'string' || ownerName.length === 0 ||
    previewInspectorSession.deferredUiTriggerEntryRevision !== previewEntryRevision ||
    typeof hasPreviewInspectorDeferredUiStateToken !== 'function' ||
    !(previewInspectorSession.deferredUiTriggerRecords instanceof Map)
  ) return [];
  return [...previewInspectorSession.deferredUiTriggerRecords.values()].flatMap((record) => {
    const metadata = record?.metadata;
    return metadata?.kind === 'local-state-transition' &&
      metadata.invocationSafe === true &&
      ['onClick', 'onChange'].includes(metadata.eventName) &&
      normalize(metadata.sourcePath) === sourcePath && metadata.ownerName === ownerName &&
      typeof metadata.stateName === 'string' && metadata.stateName.length > 0 &&
      hasPreviewInspectorDeferredUiStateToken(condition, metadata.stateName)
        ? [metadata] : [];
  });
}

/** Checks the mounted host's exact handler against the compiler-owned source membership map. */
function hasPreviewInspectorNeuralPageChoiceProof(element, sources) {
  const memberships = previewInspectorSession.deferredUiTriggerHandlerSources;
  if (!(memberships instanceof WeakMap) || sources.length === 0) return false;
  let keys;
  try { keys = Object.getOwnPropertyNames(element).slice(0, 128); } catch { return false; }
  const currentPropKeys = keys.filter((key) => key.startsWith('__reactProps$'));
  for (const key of currentPropKeys.length > 0 ? currentPropKeys : keys) {
    if (!key.startsWith('__reactProps$') && !key.startsWith('__reactFiber$')) continue;
    const value = readPreviewInspectorNeuralPageChoiceData(element, key);
    const props = key.startsWith('__reactProps$') ? value :
      readPreviewInspectorNeuralPageChoiceData(value, 'memoizedProps');
    for (const source of sources) {
      const handler = readPreviewInspectorNeuralPageChoiceData(props, source.eventName);
      if (typeof handler === 'function' && memberships.get(handler)?.has(source.id) === true) {
        return true;
      }
    }
  }
  return false;
}

/** Makes identical labels in different blocked conditions distinct and independently refreshable. */
function createPreviewInspectorNeuralPageChoiceScope(condition) {
  return hashPreviewInspectorNeuralFiniteChoiceSignature(JSON.stringify([
    condition?.id, condition?.sourcePath, condition?.runtimeOwnerName || condition?.ownerName,
  ]));
}
`;
}
