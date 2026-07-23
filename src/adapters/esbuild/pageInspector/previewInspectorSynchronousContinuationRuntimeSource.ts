/**
 * Generates the first-render continuation used for route-destructive JSX guards.
 *
 * A React Router `<Navigate>`/`<Redirect>` return changes the in-memory location during its first
 * commit. The normal target DFS runs after that commit, so merely discovering and overriding the
 * guard later cannot restore the authored route. This small runtime admits only compiler-labelled
 * navigation exits whose source file is already proven on the selected root-to-file render path.
 */

/**
 * Creates the browser helper concatenated with the condition and target-reachability runtimes.
 *
 * The helper deliberately depends on the target runtime's lexical evidence readers instead of
 * duplicating graph heuristics. Function declaration hoisting makes those readers available even
 * though their generated source is concatenated after the condition registry.
 *
 * @returns Plain JavaScript source evaluated inside the extension-owned preview entry.
 */
export function createPreviewInspectorSynchronousContinuationRuntimeSource(): string {
  return String.raw`
/** Matches an exact or workspace-relative source identity without accepting owner-name guesses. */
function isPreviewInspectorProvenContinuationSource(sourcePath, evidence) {
  const normalizedSource = typeof sourcePath === 'string' ? sourcePath.replaceAll('\\', '/') : '';
  if (normalizedSource.length === 0 || !(evidence?.paths instanceof Set)) return false;
  for (const rawPath of evidence.paths) {
    const path = typeof rawPath === 'string' ? rawPath.replaceAll('\\', '/') : '';
    if (
      path.length > 0 &&
      (
        path === normalizedSource ||
        path.endsWith('/' + normalizedSource) ||
        normalizedSource.endsWith('/' + path)
      )
    ) return true;
  }
  return false;
}

/**
 * Selects a navigation guard's only compiler-proven continuation before it can mutate router state.
 *
 * Manual/outcome choices retain precedence. Ordinary login, permission, loading, modal, and sibling
 * conditions remain on the bounded post-commit DFS; only a one-sided navigation return on the exact
 * selected render corridor is eligible for this synchronous exception.
 */
function readPreviewInspectorSynchronousNavigationContinuation(
  conditionId,
  metadata,
  selectedOverride,
  autoOverride,
) {
  if (selectedOverride !== undefined || autoOverride !== undefined) return undefined;
  if (
    previewInspectorSession.fallbackValuesEnabled !== true ||
    metadata?.kind !== 'early-return' ||
    metadata?.role !== 'navigation'
  ) return undefined;
  const desiredValue = metadata.targetBranch === 'truthy'
    ? true
    : metadata.targetBranch === 'falsy'
      ? false
      : undefined;
  const fallbackValue = metadata.fallbackBranch === 'truthy'
    ? true
    : metadata.fallbackBranch === 'falsy'
      ? false
      : undefined;
  if (desiredValue === undefined || fallbackValue === undefined || desiredValue === fallbackValue) {
    return undefined;
  }
  const key = previewInspectorSession.activeTargetReachabilityKey;
  const state = typeof key === 'string'
    ? previewInspectorSession.targetReachabilityByKey?.get?.(key)
    : undefined;
  if (state === undefined || state.directTarget !== false || state.key !== key) return undefined;
  if (
    typeof isPreviewInspectorTargetGuidedConditionRejected === 'function' &&
    isPreviewInspectorTargetGuidedConditionRejected(conditionId, key)
  ) return undefined;
  if (
    typeof findSelectedPreviewInspectorDescriptor !== 'function' ||
    typeof readSelectedPreviewInspectorPageCandidate !== 'function' ||
    typeof readPreviewInspectorTargetPathEvidence !== 'function'
  ) return undefined;
  const descriptor = findSelectedPreviewInspectorDescriptor();
  const candidate = readSelectedPreviewInspectorPageCandidate(descriptor);
  if (descriptor === undefined || candidate === undefined) return undefined;
  const evidence = readPreviewInspectorTargetPathEvidence(descriptor, candidate, state);
  if (!isPreviewInspectorProvenContinuationSource(metadata.sourcePath, evidence)) return undefined;
  state.appliedConditions ??= [];
  if (!state.appliedConditions.some((condition) => condition?.id === conditionId)) {
    state.appliedConditions.push({
      enabled: desiredValue,
      expression: metadata.expression,
      id: conditionId,
      line: metadata.line,
      ownerName: metadata.ownerName,
      sourcePath: metadata.sourcePath,
      synchronous: true,
    });
  }
  return desiredValue;
}
`;
}
