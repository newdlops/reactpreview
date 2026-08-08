/**
 * Generates the first-render continuation used for route-destructive JSX guards.
 *
 * A React Router `<Navigate>`/`<Redirect>` return changes the in-memory location during its first
 * commit. The normal target DFS runs after that commit, so merely discovering and overriding the
 * guard later cannot restore the authored route. This small runtime admits only compiler-labelled
 * navigation exits whose source file is already proven on the selected root-to-file render path,
 * or whose owner is proven by the exact selected facade while that facade is rendering.
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

/** Matches a guard declared by the exact selected authored page checkpoint. */
function isPreviewInspectorSelectedRootContinuationSource(sourcePath, candidate) {
  const normalizedSource = typeof sourcePath === 'string' ? sourcePath.replaceAll('\\', '/') : '';
  const rootSource = typeof candidate?.root?.sourcePath === 'string'
    ? candidate.root.sourcePath.replaceAll('\\', '/')
    : '';
  if (normalizedSource.length === 0 || rootSource.length === 0) return false;
  return normalizedSource === rootSource ||
    normalizedSource.endsWith('/' + rootSource) ||
    rootSource.endsWith('/' + normalizedSource);
}

/**
 * Proves a lazy/barrel implementation owner through the exact selected facade invocation.
 *
 * A route can import Page from Page/index.ts while React.lazy evaluates Page/Page.tsx. The
 * static route corridor intentionally ends at the public facade, so the implementation source is
 * not a path match. Requiring every compiler/facade phase plus wrapper render prevents an unrelated
 * same-named condition from becoming evidence before the selected export is actually invoked.
 */
function isPreviewInspectorProvenContinuationOwner(metadata, state) {
  const ownerName = typeof metadata?.ownerName === 'string' ? metadata.ownerName : '';
  const targetExportName =
    typeof state?.targetExportName === 'string' ? state.targetExportName : '';
  const targetSourcePath = typeof state?.targetSourcePath === 'string'
    ? state.targetSourcePath.replaceAll('\\', '/')
    : '';
  if (ownerName.length === 0 || targetExportName.length === 0 || targetSourcePath.length === 0) {
    return false;
  }
  const identity = targetSourcePath + '\0' + targetExportName;
  const ownership = previewInspectorSession.targetOwnershipPhasesByIdentity?.get?.(identity);
  for (const phase of [
    'compiler-export-evidence',
    'facade-resolution',
    'facade-evaluation',
    'wrapper-render',
  ]) {
    if (ownership?.phases?.has?.(phase) !== true) return false;
  }
  if (ownerName === targetExportName) return true;
  return previewInspectorSession.targetFacadeRuntimeOwnerNamesByExport
    ?.get?.(targetExportName)
    ?.has?.(ownerName) === true;
}

/**
 * Selects a pre-commit guard's only compiler-proven continuation before it can block the page.
 *
 * Manual/outcome choices retain precedence. Ordinary login, permission, loading, modal, and sibling
 * conditions remain on the bounded post-commit DFS; only a one-sided navigation return or terminal
 * throw on the exact selected render corridor is eligible for this synchronous exception.
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
    (metadata?.role !== 'navigation' && metadata?.synchronousContinuation !== true)
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
  if (
    !isPreviewInspectorProvenContinuationSource(metadata.sourcePath, evidence) &&
    !isPreviewInspectorSelectedRootContinuationSource(metadata.sourcePath, candidate) &&
    !isPreviewInspectorProvenContinuationOwner(metadata, state)
  ) return undefined;
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
