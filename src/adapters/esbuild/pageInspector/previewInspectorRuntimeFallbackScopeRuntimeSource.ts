/**
 * Generates page-candidate scoping for automatic hook fallbacks.
 *
 * A pinned webview keeps its Inspector session across the fast direct-component artifact and the
 * later authored-page artifact. Compiler-generated values are useful only inside the render
 * corridor that produced them, while explicit user JSON is an intentional cross-remount choice.
 * This runtime therefore expires inferred values at that boundary and lets an application-owned
 * Router remain authoritative after its hooks return successfully. Generated hook values also
 * carry the canonical sample date (name-only date fields), placed here on the preview's current day
 * like every other generated date.
 */
import { createPreviewSampleDateApiExpression } from '../previewSampleDateRuntimeSource';

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
const previewInspectorFallbackSampleDates = ${createPreviewSampleDateApiExpression()};

/** Moves canonical sample dates inside one generated plain value onto the current day. */
function rebasePreviewInspectorFallbackSampleDates(value, depth) {
  if (typeof value === 'string') return previewInspectorFallbackSampleDates.rebase(value);
  if (value === null || typeof value !== 'object' || depth > 6) return value;
  if (Array.isArray(value)) {
    let changed = false;
    const items = value.map((item) => {
      const next = rebasePreviewInspectorFallbackSampleDates(item, depth + 1);
      if (next !== item) changed = true;
      return next;
    });
    if (!changed) return value;
    return Object.isFrozen(value) ? Object.freeze(items) : items;
  }
  // Plain records only (any realm's Object.prototype or none); proxies and class instances stay.
  const prototype = Object.getPrototypeOf(value);
  if (prototype !== null && Object.getPrototypeOf(prototype) !== null) return value;
  let result;
  for (const key of Object.keys(value)) {
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    if (descriptor === undefined || !('value' in descriptor)) continue;
    const next = rebasePreviewInspectorFallbackSampleDates(descriptor.value, depth + 1);
    if (next === descriptor.value) continue;
    result ??= Object.assign(Object.create(prototype), value);
    result[key] = next;
  }
  if (result === undefined) return value;
  return Object.isFrozen(value) ? Object.freeze(result) : result;
}

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
    previewInspectorSession.runtimeFallbackNeuralDecisions?.delete?.(fallbackId);
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
  previewInspectorSession.runtimeFallbackResolutionFrames = [];
  previewInspectorSession.runtimeFallbackAuthoredValues?.clear?.();
  previewInspectorSession.runtimeFallbackSharedSmartPathValues = new WeakMap();
  previewInspectorSession.runtimeFallbackSharedNeuralRecommendations = new WeakMap();
  previewInspectorSession.runtimeFallbackSharedNeuralRecommendationsByContract?.clear?.();
  previewInspectorSession.runtimeFallbackSemanticValueRecommendations?.clear?.();
  previewInspectorSession.localUiControllers?.clear?.();
  previewInspectorSession.localUiControllerAttemptKeys?.clear?.();
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

/**
 * Reports whether a hook's owner lies on the selected root-to-target corridor.
 *
 * A guard-pass value (a hook boolean forced past 'if (!isOpen) return null') exists to reach the
 * target. Applied to an unrelated sibling, such as a global popup mounted by the application shell,
 * it opens UI the page never shows. The owner counts when its module is the target module, or when
 * the module is on the corridor and the owner name is one of its proven components; same-file
 * membership alone is not enough because a page often declares several sibling dialogs. Without a
 * reachability state or corridor evidence the rule stays as authored (true).
 */
function isPreviewInspectorRuntimeHookOwnerOnTargetCorridor(metadata) {
  const key = previewInspectorSession.activeTargetReachabilityKey;
  const state = typeof key === 'string'
    ? previewInspectorSession.targetReachabilityByKey?.get?.(key)
    : undefined;
  if (
    state === undefined || state === null || typeof state !== 'object' ||
    typeof readPreviewInspectorTargetPathEvidence !== 'function' ||
    typeof findSelectedPreviewInspectorDescriptor !== 'function'
  ) return true;
  const descriptor = findSelectedPreviewInspectorDescriptor();
  const candidate = readSelectedPreviewInspectorPageCandidate(descriptor);
  if (!(previewInspectorSession.runtimeHookCorridorEvidence instanceof WeakMap)) {
    previewInspectorSession.runtimeHookCorridorEvidence = new WeakMap();
  }
  let cached = previewInspectorSession.runtimeHookCorridorEvidence.get(state);
  if (cached === undefined || cached.candidate !== candidate) {
    let evidence;
    try {
      evidence = readPreviewInspectorTargetPathEvidence(descriptor, candidate, state);
    } catch {
      evidence = undefined;
    }
    cached = { candidate, evidence };
    previewInspectorSession.runtimeHookCorridorEvidence.set(state, cached);
  }
  const evidence = cached.evidence;
  if (!(evidence?.paths instanceof Set) || evidence.paths.size === 0) return true;
  const sourcePath = normalizePreviewInspectorReachabilityPath(metadata?.sourcePath);
  const targetPath = normalizePreviewInspectorReachabilityPath(
    candidate?.target?.sourcePath ?? descriptor?.inspector?.target?.sourcePath,
  );
  if (sourcePath.length > 0 && sourcePath === targetPath) return true;
  if (!evidence.paths.has(sourcePath)) return false;
  const ownerName = metadata?.ownerName;
  return typeof ownerName === 'string' && ownerName.length > 0 && (
    evidence.names?.has?.(ownerName) === true ||
    evidence.corridorOwnerNames?.has?.(ownerName) === true ||
    evidence.localComponentOwnerNames?.has?.(ownerName) === true
  );
}

/** Reports whether a source path is the module the user opened, without reading page evidence. */
function isPreviewInspectorSelectedTargetModule(sourcePath) {
  const descriptor = typeof findSelectedPreviewInspectorDescriptor === 'function'
    ? findSelectedPreviewInspectorDescriptor()
    : undefined;
  const normalize = typeof normalizePreviewInspectorReachabilityPath === 'function'
    ? normalizePreviewInspectorReachabilityPath
    : (value) => (typeof value === 'string' ? value : '');
  const targetPath = normalize(descriptor?.inspector?.target?.sourcePath);
  return targetPath.length > 0 && normalize(sourcePath) === targetPath;
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

/** Subscribes this authored hook consumer to shared neural state without a page-wide remount. */
function usePreviewInspectorRuntimeFallbackNeuralSubscription() {
  if (
    typeof React !== 'object' || React === null ||
    typeof React.useReducer !== 'function' || typeof React.useEffect !== 'function'
  ) return;
  const [, refresh] = React.useReducer((revision) => revision + 1, 0);
  React.useEffect(() => {
    initializePreviewInspectorRuntimeFallbackState();
    previewInspectorSession.runtimeFallbackNeuralListeners.add(refresh);
    return () => previewInspectorSession.runtimeFallbackNeuralListeners.delete(refresh);
  }, []);
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
  readHookIdentity,
) {
  const createRawFallback = createFallback;
  createFallback = typeof createRawFallback === 'function'
    ? () => rebasePreviewInspectorFallbackSampleDates(createRawFallback(), 0)
    : createRawFallback;
  // A member call such as a store's getState() can run in an event handler, effect, or HTTP
  // interceptor. Only a genuine hook invocation may add this render-scoped subscription.
  if (rawMetadata?.invocation !== 'member') usePreviewInspectorRuntimeFallbackNeuralSubscription();
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
      readHookIdentity,
    );
  }
  const metadata = normalizePreviewInspectorRuntimeFallbackMetadata(rawMetadata);
  const resolutionFrame = beginPreviewInspectorRuntimeFallbackResolutionFrame(metadata);
  let value;
  let failure;
  try {
    value = readHook();
  } catch (error) {
    failure = error;
  } finally {
    finishPreviewInspectorRuntimeFallbackResolutionFrame(resolutionFrame);
  }
  if (failure !== undefined) {
    return resolvePreviewInspectorRuntimeHook(
      () => { throw failure; },
      createFallback,
      rawMetadata,
      readGraphqlDocument,
      readGraphqlOptions,
      readHookIdentity,
      resolutionFrame,
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
    readHookIdentity,
    resolutionFrame,
  );
}
`;
}
