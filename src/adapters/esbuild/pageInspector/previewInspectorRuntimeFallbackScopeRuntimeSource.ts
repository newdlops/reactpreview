/**
 * Generates page-candidate scoping for automatic hook fallbacks.
 *
 * A pinned webview keeps its Inspector session across the fast direct-component artifact and the
 * later authored-page artifact. Compiler-generated values are useful only inside the render
 * corridor that produced them, while explicit user JSON is an intentional cross-remount choice.
 * This runtime therefore expires inferred values at that boundary and lets an application-owned
 * Router remain authoritative after its hooks return successfully.
 */

/**
 * Creates browser source that scopes automatic hook values to one revision and page perspective.
 *
 * Expected lexical bindings are the Page Inspector session, runtime-fallback registry helpers,
 * selected-candidate helpers, runtime-health recorder, and the session-local entry revision.
 *
 * @returns Plain JavaScript concatenated after the base runtime-fallback implementation.
 */
export function createPreviewInspectorRuntimeFallbackScopeRuntimeSource(): string {
  return String.raw`
const PREVIEW_INSPECTOR_ROUTER_HOOK_MODULE_PATTERN = /^react-router(?:-dom)?(?:\/|$)/u;

/** Creates an identity for inferred values that must not cross candidate or artifact boundaries. */
function createPreviewInspectorRuntimeFallbackScopeKey(candidate, directTarget) {
  const revision = typeof previewEntryRevision === 'number' ? previewEntryRevision : 0;
  const candidateId = typeof candidate?.id === 'string' ? candidate.id : 'direct-component';
  const scenario = previewInspectorSession.renderScenario === 'file-components'
    ? 'file-components'
    : 'authored-page';
  const exportName = typeof previewInspectorSession.selectedExportName === 'string'
    ? previewInspectorSession.selectedExportName
    : 'default';
  return [revision, scenario, candidateId, exportName, directTarget === true ? 'direct' : 'page']
    .join(':');
}

/**
 * Resolves the single direct/page perspective shared by the outer Provider boundary and loader.
 * Target-only diagnostics remain an authored-page UI scenario, so checking the toolbar scenario
 * alone would make the two layers alternate between page and direct scopes on every refresh.
 */
function readPreviewInspectorRuntimeFallbackDirectTarget(descriptor, candidate) {
  if (readPreviewInspectorRenderScenario() === 'file-components') return true;
  if (typeof readPreviewInspectorTargetReachabilityState !== 'function') return false;
  try {
    const reachability = readPreviewInspectorTargetReachabilityState(descriptor, candidate);
    return reachability?.directTarget === true && reachability?.directTargetAvailable === true;
  } catch {
    return false;
  }
}

/**
 * Expires only compiler-owned hook values before a different render corridor evaluates modules.
 * Explicit JSON overrides and their records survive, so changing pages never discards user work.
 */
function activatePreviewInspectorRuntimeFallbackScope(candidate, directTarget) {
  initializePreviewInspectorRuntimeFallbackState();
  const scopeKey = createPreviewInspectorRuntimeFallbackScopeKey(candidate, directTarget);
  const previousScopeKey = previewInspectorSession.runtimeFallbackScopeKey;
  if (previousScopeKey === scopeKey) return false;
  previewInspectorSession.runtimeFallbackScopeKey = scopeKey;
  if (previousScopeKey === undefined) return false;

  let clearedCount = 0;
  for (const fallbackId of [...previewInspectorSession.runtimeFallbackValues.keys()]) {
    previewInspectorSession.runtimeFallbackValues.delete(fallbackId);
    previewInspectorSession.runtimeFallbackSmartIds.delete(fallbackId);
    previewInspectorSession.runtimeFallbackSmartPathSignatures.delete(fallbackId);
    clearedCount += 1;
  }
  for (const [fallbackId, record] of [...previewInspectorSession.runtimeFallbacks]) {
    previewInspectorSession.runtimeFallbackSmartIds.delete(fallbackId);
    previewInspectorSession.runtimeFallbackSmartPathSignatures.delete(fallbackId);
    if (previewInspectorSession.runtimeFallbackOverrides.has(fallbackId)) {
      previewInspectorSession.runtimeFallbacks.set(fallbackId, { ...record, mode: 'manual' });
      continue;
    }
    previewInspectorSession.runtimeFallbacks.delete(fallbackId);
  }
  previewInspectorSession.runtimeFallbackCompletions = new WeakMap();
  const clearedEffectCount = previewInspectorSession.runtimeEffectIsolations.size;
  const clearedExecutionWindowCount = previewInspectorSession.runtimeEffectExecutionWindows.size;
  previewInspectorSession.runtimeEffectIsolations.clear();
  previewInspectorSession.runtimeEffectExecutionWindows.clear();
  const clearedRuntimeStateCount =
    clearedCount + clearedEffectCount + clearedExecutionWindowCount;
  if (clearedRuntimeStateCount > 0) schedulePreviewInspectorRuntimeFallbackRefresh();
  if (typeof recordPreviewInspectorRuntimeHealth === 'function') {
    recordPreviewInspectorRuntimeHealth({
      category: 'page-context',
      detail: {
        clearedCount,
        clearedEffectCount,
        clearedExecutionWindowCount,
        nextScope: scopeKey,
        previousScope: previousScopeKey,
      },
      event: 'runtime-fallback-scope-activated',
    });
  }
  return clearedRuntimeStateCount > 0;
}

/**
 * Activates the new artifact scope at the final preparation commit, before React renders providers.
 * Calling this only after element composition succeeds keeps a failed replacement from mutating the
 * mounted revision; the loader call still handles same-revision candidate and perspective changes.
 */
function preparePreviewInspectorRuntimeFallbackScope(descriptors) {
  if (!Array.isArray(descriptors)) return false;
  setPreviewInspectorDescriptors(descriptors);
  const descriptor = findSelectedPreviewInspectorDescriptor();
  const candidate = readSelectedPreviewInspectorPageCandidate(descriptor);
  const directTarget = readPreviewInspectorRuntimeFallbackDirectTarget(descriptor, candidate);
  return activatePreviewInspectorRuntimeFallbackScope(candidate, directTarget);
}

/**
 * Remounts every project and automatic Provider when the selected render corridor changes.
 *
 * This boundary is composed outside Apollo/Redux/Router/setup providers. Clearing generated caches
 * alone is insufficient when an outer provider already retained a value from the previous page;
 * a keyed extension-owned Fragment gives the new candidate a fresh provider subtree while ordinary
 * blocker edits in the same scope retain project-local state.
 */
function PreviewInspectorRuntimeFallbackScopeBoundary({ children }) {
  usePreviewInspectorStore();
  const descriptor = findSelectedPreviewInspectorDescriptor();
  const candidate = readSelectedPreviewInspectorPageCandidate(descriptor);
  const directTarget = readPreviewInspectorRuntimeFallbackDirectTarget(descriptor, candidate);
  activatePreviewInspectorRuntimeFallbackScope(candidate, directTarget);
  const scopeKey = createPreviewInspectorRuntimeFallbackScopeKey(candidate, directTarget);
  return React.createElement(React.Fragment, { key: scopeKey }, children);
}

/** Reports whether successful router-hook output belongs to the selected application Router. */
function shouldPreservePreviewInspectorOwnedRouterHookValue(metadata) {
  if (
    metadata === null ||
    typeof metadata !== 'object' ||
    typeof metadata.moduleSpecifier !== 'string' ||
    !PREVIEW_INSPECTOR_ROUTER_HOOK_MODULE_PATTERN.test(metadata.moduleSpecifier)
  ) {
    return false;
  }
  try {
    return typeof doesSelectedPreviewInspectorPageCandidateOwnRouter === 'function' &&
      doesSelectedPreviewInspectorPageCandidateOwnRouter();
  } catch {
    return false;
  }
}

/**
 * Preserves a successful application Router read, otherwise delegates exactly once to isolation.
 * A manual override deliberately keeps precedence because it represents an explicit user scenario.
 */
function resolvePreviewInspectorScopedRuntimeHook(
  readHook,
  createFallback,
  rawMetadata,
  readGraphqlDocument,
  readGraphqlOptions,
) {
  const fallbackId = typeof rawMetadata?.id === 'string' ? rawMetadata.id : '';
  if (
    fallbackId.length === 0 ||
    hasPreviewInspectorRuntimeFallbackOverride(fallbackId) ||
    typeof readHook !== 'function'
  ) {
    return resolvePreviewInspectorRuntimeHook(
      readHook,
      createFallback,
      rawMetadata,
      readGraphqlDocument,
      readGraphqlOptions,
    );
  }
  let value;
  try {
    value = readHook();
  } catch (error) {
    return resolvePreviewInspectorRuntimeHook(
      () => { throw error; },
      createFallback,
      rawMetadata,
      readGraphqlDocument,
      readGraphqlOptions,
    );
  }
  if (shouldPreservePreviewInspectorOwnedRouterHookValue(rawMetadata)) {
    clearPreviewInspectorRuntimeFallback(
      normalizePreviewInspectorRuntimeFallbackMetadata(rawMetadata),
    );
    return value;
  }
  return resolvePreviewInspectorRuntimeHook(
    () => value,
    createFallback,
    rawMetadata,
    readGraphqlDocument,
    readGraphqlOptions,
  );
}
`;
}
