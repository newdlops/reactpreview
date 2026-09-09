/**
 * Shares admitted repairs only across compatible hook and Context ownership identities.
 * This adapter emits a lexical fragment composed by previewInspectorRuntimeFallbackRuntimeSource.
 * Session state and helper ownership remain in the same generated browser module.
 */

/** Returns the ordered browser fragment; no project code runs during source generation. */
export function createPreviewInspectorRuntimeFallbackSharingRuntimeSource(): string {
  return String.raw`
/** Reports whether a successful hook result can safely act as a shared state-carrier identity. */
function isPreviewInspectorRuntimeFallbackSharedIdentity(value) {
  return (typeof value === 'object' || typeof value === 'function') && value !== null;
}

/**
 * Mirrors the compiler-proven custom-hook to raw-Context identity into the Inspector session.
 * A conflicting registration becomes permanently ambiguous, matching the Context bridge policy.
 */
function registerPreviewInspectorRuntimeContextIdentity(hookIdentity, contextIdentity) {
  initializePreviewInspectorRuntimeFallbackState();
  if (
    typeof hookIdentity !== 'function' ||
    !isPreviewInspectorRuntimeFallbackSharedIdentity(contextIdentity) ||
    previewInspectorSession.runtimeFallbackAmbiguousContextHooks.has(hookIdentity)
  ) return false;
  const current = previewInspectorSession.runtimeFallbackContextIdentityByHook.get(hookIdentity);
  if (current === contextIdentity) return true;
  if (current !== undefined) {
    previewInspectorSession.runtimeFallbackContextIdentityByHook.delete(hookIdentity);
    previewInspectorSession.runtimeFallbackAmbiguousContextHooks.add(hookIdentity);
    return false;
  }
  previewInspectorSession.runtimeFallbackContextIdentityByHook.set(hookIdentity, contextIdentity);
  return true;
}

/** Resolves a non-ambiguous raw Context identity for one exact imported custom hook. */
function readPreviewInspectorRuntimeContextIdentity(hookIdentity) {
  if (
    typeof hookIdentity !== 'function' ||
    previewInspectorSession.runtimeFallbackAmbiguousContextHooks.has(hookIdentity)
  ) return undefined;
  return previewInspectorSession.runtimeFallbackContextIdentityByHook.get(hookIdentity);
}

/** Canonicalizes a bounded exact-scalar overlay independently of compiler discovery order. */
function createPreviewInspectorRuntimeSharedSmartSignature(values) {
  return JSON.stringify(
    (Array.isArray(values) ? values : [])
      .map((item) => [item?.path, item?.value, item?.role])
      .sort((left, right) => String(left[0]).localeCompare(String(right[0]))),
  );
}

/**
 * Shares a selected target's Smart discriminator with consumers of the same authored hook carrier.
 *
 * Context hooks commonly expose one memoized value to the page shell and selected panel. Object
 * identity is stronger than import spelling (aliases and relative paths can name the same hook),
 * and it prevents an inferred state from leaking to an unrelated hook with a coincidentally equal
 * shape. When the hook itself throws because its Provider is absent, the exact imported hook
 * function is the only shared carrier available; it is used only for failed calls. Conflicting
 * scalars fail closed while complementary exact paths are merged.
 */
function promotePreviewInspectorRuntimeSmartValueToSharedIdentity(fallbackId, metadata) {
  initializePreviewInspectorRuntimeFallbackState();
  const authored = previewInspectorSession.runtimeFallbackAuthoredValues.get(fallbackId);
  if (!isPreviewInspectorRuntimeFallbackSharedIdentity(authored)) return false;
  const incoming = Array.isArray(metadata?.smartPathValues)
    ? metadata.smartPathValues.slice(0, 32)
    : [];
  if (incoming.length === 0) return false;
  const previous = previewInspectorSession.runtimeFallbackSharedSmartPathValues.get(authored);
  const byPath = new Map(
    (Array.isArray(previous?.values) ? previous.values : []).map((item) => [item.path, item]),
  );
  for (const item of incoming) {
    const retained = byPath.get(item.path);
    if (retained === undefined) {
      byPath.set(item.path, item);
    } else if (!Object.is(retained.value, item.value)) {
      // Two selected-target proofs disagree about one state carrier. Preserve the first bounded
      // decision instead of creating a state combination that no authored render can produce.
      continue;
    }
  }
  const values = Object.freeze([...byPath.values()]);
  const signature = createPreviewInspectorRuntimeSharedSmartSignature(values);
  if (previous?.signature === signature) return false;
  previewInspectorSession.runtimeFallbackSharedSmartPathValues.set(
    authored,
    Object.freeze({ signature, values }),
  );
  return true;
}

/** Retains only exact Smart-capable hook identities and refreshes a changed memoized carrier. */
function rememberPreviewInspectorRuntimeSmartAuthoredValue(metadata, value, failedHookIdentity) {
  initializePreviewInspectorRuntimeFallbackState();
  const carrier = isPreviewInspectorRuntimeFallbackSharedIdentity(value)
    ? value
    : isPreviewInspectorRuntimeFallbackSharedIdentity(failedHookIdentity)
      ? failedHookIdentity
      : undefined;
  if (
    carrier === undefined ||
    !Array.isArray(metadata?.smartPathValues) ||
    metadata.smartPathValues.length === 0
  ) return false;
  if (
    !previewInspectorSession.runtimeFallbackAuthoredValues.has(metadata.id) &&
    previewInspectorSession.runtimeFallbackAuthoredValues.size >=
      PREVIEW_INSPECTOR_RUNTIME_FALLBACK_LIMIT
  ) return false;
  previewInspectorSession.runtimeFallbackAuthoredValues.set(metadata.id, carrier);
  if (!previewInspectorSession.runtimeFallbackSmartIds.has(metadata.id)) return false;
  return promotePreviewInspectorRuntimeSmartValueToSharedIdentity(metadata.id, metadata);
}

/** Reads a previously selected projection only from the exact shared authored object. */
function readPreviewInspectorRuntimeSharedSmartProjection(value) {
  initializePreviewInspectorRuntimeFallbackState();
  return isPreviewInspectorRuntimeFallbackSharedIdentity(value)
    ? previewInspectorSession.runtimeFallbackSharedSmartPathValues.get(value)
    : undefined;
}

/** Adds a shared exact-state overlay to this consumer's compiler fallback without losing fields. */
function createPreviewInspectorRuntimeSharedSmartCompletion(metadata, value, fallback) {
  const projection = readPreviewInspectorRuntimeSharedSmartProjection(value);
  const values = Array.isArray(projection?.values) ? projection.values : [];
  const paths = values.map((item) => item?.path).filter(
    (path) => typeof path === 'string' && path.length > 0,
  );
  if (paths.length === 0) return { fallback, metadata, projected: false };
  const generated = createPreviewInspectorRuntimeFallbackSmartValue(value, paths, values);
  const completedFallback = completePreviewInspectorGeneratedValue(fallback, generated, {
    renderGuardPaths: paths,
    requiredPaths: paths,
  });
  return {
    fallback: completedFallback.changed ? completedFallback.value : fallback,
    metadata: {
      ...metadata,
      renderGuardPaths: normalizePreviewInspectorRequiredPropertyPaths([
        ...(metadata.renderGuardPaths ?? []),
        ...paths,
      ]),
      requiredPaths: normalizePreviewInspectorRequiredPropertyPaths([
        ...(metadata.requiredPaths ?? []),
        ...paths,
      ]),
    },
    projected: true,
  };
}

/** Includes exact compiler-owned Smart scalars when deciding whether one fill is still current. */
function createPreviewInspectorRuntimeFallbackSmartSignature(metadata, requiredPaths) {
  const pathSignature = createPreviewInspectorRuntimeFallbackPathSignature(
    requiredPaths ?? metadata?.requiredPaths ?? [],
  );
  const smartSignature = JSON.stringify(
    (Array.isArray(metadata?.smartPathValues) ? metadata.smartPathValues : [])
      .map((item) => [item?.path, item?.value, item?.role]),
  );
  return pathSignature + ':' + smartSignature;
}

/** Detects a dormant authored scalar that has one statically proven target-visible alternative. */
function hasPreviewInspectorRuntimeSmartAlternative(metadata, value) {
  for (const item of Array.isArray(metadata?.smartPathValues) ? metadata.smartPathValues : []) {
    if (item?.path === '<root>') {
      if (!Object.is(value, item.value)) return true;
      continue;
    }
    const parsed = parsePreviewInspectorRequiredPath(item?.path);
    if (parsed === undefined) continue;
    const current = readPreviewInspectorRequiredPathSeed(value, parsed.path);
    if (!Object.is(current, item.value)) return true;
  }
  return false;
}

/** Opens a bounded causal frame so an outer hook can recognize values produced by nested fallbacks. */
function beginPreviewInspectorRuntimeFallbackResolutionFrame(metadata) {
  initializePreviewInspectorRuntimeFallbackState();
  const frame = { children: [], id: metadata.id };
  previewInspectorSession.runtimeFallbackResolutionFrames.push(frame);
  return frame;
}

/** Removes only the exact active frame, including when authored hook execution throws. */
function finishPreviewInspectorRuntimeFallbackResolutionFrame(frame) {
  const frames = previewInspectorSession.runtimeFallbackResolutionFrames;
  if (!Array.isArray(frames)) return;
  if (frames.at(-1) === frame) {
    frames.pop();
    return;
  }
  const index = frames.lastIndexOf(frame);
  if (index >= 0) frames.splice(index, 1);
}

/**
 * Reports generated child output to its active caller without retaining the child value itself.
 * This supplies causal provenance for primitives, which cannot carry the generated-value marker.
 */
function reportPreviewInspectorNestedRuntimeFallback(metadata, reason, generatedPaths) {
  const frames = previewInspectorSession.runtimeFallbackResolutionFrames;
  const parent = Array.isArray(frames) ? frames.at(-1) : undefined;
  if (parent === undefined || parent.children.length >= 12 || parent.id === metadata.id) return;
  parent.children.push(Object.freeze({
    hookName: metadata.hookName,
    id: metadata.id,
    reason: String(reason ?? 'generated').slice(0, 80),
    requiredPaths: normalizePreviewInspectorRequiredPropertyPaths(generatedPaths),
  }));
}

/** Returns a stable coarse kind used only as a neural feature token. */
function readPreviewInspectorRuntimeFallbackValueKind(value) {
  if (value === null) return 'null';
  if (Array.isArray(value)) return 'array';
  return typeof value;
}

/** Reports whether the compiler proves a property below the hook-result root. */
function hasPreviewInspectorRuntimeFallbackDescendantRequirement(metadata) {
  return normalizePreviewInspectorRequiredPropertyPaths([
    ...(metadata?.requiredPaths ?? []),
    ...(metadata?.smartPathValues ?? []).map((item) => item?.path),
  ]).some((path) => path !== '<root>' && path !== '<root>()');
}

/** Resolves one imported hook contract across callsites without trusting a bare local hook name. */
function createPreviewInspectorRuntimeFallbackHookContractKey(metadata) {
  const hookName = typeof metadata?.hookName === 'string' ? metadata.hookName : '';
  const moduleSpecifier = typeof metadata?.moduleSpecifier === 'string'
    ? metadata.moduleSpecifier.replaceAll('\\', '/')
    : '';
  if (hookName.length === 0 || moduleSpecifier.length === 0) return '';
  if (!moduleSpecifier.startsWith('.')) return moduleSpecifier + '#' + hookName;
  const sourcePath = typeof metadata?.sourcePath === 'string'
    ? metadata.sourcePath.replaceAll('\\', '/')
    : '';
  if (sourcePath.length === 0) return '';
  const segments = sourcePath.split('/');
  segments.pop();
  for (const segment of moduleSpecifier.split('/')) {
    if (segment.length === 0 || segment === '.') continue;
    if (segment === '..') segments.pop();
    else segments.push(segment);
  }
  return segments.join('/') + '#' + hookName;
}

/** Reads a selected-target recommendation by exact identity, then its resolved import contract. */
function readPreviewInspectorRuntimeSharedNeuralRecommendation(metadata, hookIdentity) {
  const accepts = (recommendation) =>
    metadata?.smartPathCandidateId === undefined ||
    recommendation?.smartPathCandidateId === undefined ||
    recommendation.smartPathCandidateId === metadata?.smartPathCandidateId;
  if (isPreviewInspectorRuntimeFallbackSharedIdentity(hookIdentity)) {
    const byIdentity = previewInspectorSession.runtimeFallbackSharedNeuralRecommendations.get(
      hookIdentity,
    );
    if (byIdentity !== undefined && accepts(byIdentity)) {
      return { match: 'identity', recommendation: byIdentity };
    }
  }
  const contractKey = createPreviewInspectorRuntimeFallbackHookContractKey(metadata);
  const byContract = contractKey.length === 0
    ? undefined
    : previewInspectorSession.runtimeFallbackSharedNeuralRecommendationsByContract.get(contractKey);
  return byContract === undefined || !accepts(byContract)
    ? undefined
    : { match: 'contract', recommendation: byContract };
}

/** Stores one target recommendation across its exact hook, Context, and resolved import contract. */
function storePreviewInspectorRuntimeSharedNeuralRecommendation(
  metadata,
  hookIdentity,
  recommendation,
  origin,
) {
  const contractKey = createPreviewInspectorRuntimeFallbackHookContractKey(metadata);
  const contextIdentity = readPreviewInspectorRuntimeContextIdentity(hookIdentity);
  if (
    !isPreviewInspectorRuntimeFallbackSharedIdentity(hookIdentity) &&
    !isPreviewInspectorRuntimeFallbackSharedIdentity(contextIdentity) &&
    contractKey.length === 0
  ) return false;
  let signature;
  try {
    signature = JSON.stringify([
      recommendation?.strategy,
      metadata?.smartPathCandidateId,
      metadata?.sourcePath,
      normalizePreviewInspectorRequiredPropertyPaths(recommendation?.sharedGuardPaths),
      recommendation?.value,
    ]);
  } catch {
    signature = String(recommendation?.strategy ?? 'neural-recommendation');
  }
  const sharedRecommendation = Object.freeze({
    label: recommendation?.label,
    residual: recommendation?.residual,
    sharedGuardPaths: normalizePreviewInspectorRequiredPropertyPaths(
      recommendation?.sharedGuardPaths,
    ),
    smartPathCandidateId: metadata?.smartPathCandidateId,
    sourcePath: typeof metadata?.sourcePath === 'string'
      ? metadata.sourcePath.replaceAll('\\', '/')
      : '',
    strategy: recommendation?.strategy,
    signature,
    value: recommendation?.value,
  });
  let changed = false;
  if (isPreviewInspectorRuntimeFallbackSharedIdentity(hookIdentity)) {
    changed ||= previewInspectorSession.runtimeFallbackSharedNeuralRecommendations.get(
      hookIdentity,
    )?.signature !== signature;
    previewInspectorSession.runtimeFallbackSharedNeuralRecommendations.set(
      hookIdentity,
      sharedRecommendation,
    );
  }
  if (isPreviewInspectorRuntimeFallbackSharedIdentity(contextIdentity)) {
    changed ||= previewInspectorSession.runtimeFallbackSharedNeuralRecommendations.get(
      contextIdentity,
    )?.signature !== signature;
    previewInspectorSession.runtimeFallbackSharedNeuralRecommendations.set(
      contextIdentity,
      sharedRecommendation,
    );
  }
  if (
    contractKey.length > 0 &&
    (
      previewInspectorSession.runtimeFallbackSharedNeuralRecommendationsByContract.has(
        contractKey,
      ) ||
      previewInspectorSession.runtimeFallbackSharedNeuralRecommendationsByContract.size <
        PREVIEW_INSPECTOR_RUNTIME_FALLBACK_LIMIT
    )
  ) {
    changed ||= previewInspectorSession.runtimeFallbackSharedNeuralRecommendationsByContract.get(
      contractKey,
    )?.signature !== signature;
    previewInspectorSession.runtimeFallbackSharedNeuralRecommendationsByContract.set(
      contractKey,
      sharedRecommendation,
    );
  }
  if (!changed) return false;
  previewInspectorSession.runtimeFallbackNeuralRevision =
    (previewInspectorSession.runtimeFallbackNeuralRevision ?? 0) + 1;
  if (typeof recordPreviewInspectorRuntimeHealth === 'function') {
    recordPreviewInspectorRuntimeHealth({
      category: 'neural-residual',
      detail: {
        hookName: metadata.hookName,
        origin,
        ownerName: metadata.ownerName,
        phase: 'stored',
        sharedBy: [
          ...(isPreviewInspectorRuntimeFallbackSharedIdentity(hookIdentity) ? ['identity'] : []),
          ...(isPreviewInspectorRuntimeFallbackSharedIdentity(contextIdentity)
            ? ['context-identity']
            : []),
          ...(contractKey.length > 0 ? ['contract'] : []),
        ],
        sharedGuardPaths: sharedRecommendation.sharedGuardPaths,
        strategy: sharedRecommendation.strategy,
      },
      event: 'neural-residual-shared',
    });
  }
  return true;
}
`;
}
