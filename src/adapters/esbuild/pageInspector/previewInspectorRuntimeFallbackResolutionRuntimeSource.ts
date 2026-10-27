/**
 * Resolves render-critical hook holes while retaining authored values, Suspense, and causal trace records.
 * This adapter emits a lexical fragment composed by previewInspectorRuntimeFallbackRuntimeSource.
 * Session state and helper ownership remain in the same generated browser module.
 */

/** Returns the ordered browser fragment; no project code runs during source generation. */
export function createPreviewInspectorRuntimeFallbackResolutionRuntimeSource(): string {
  return String.raw`
/** Registers a bypassed hook failure once and mirrors it as a warning, never a fatal error. */
function recordPreviewInspectorRuntimeFallback(metadata, fallback, reason, error, generatedPaths = []) {
  initializePreviewInspectorRuntimeFallbackState();
  if (
    metadata.id.length === 0 ||
    (!previewInspectorSession.runtimeFallbacks.has(metadata.id) &&
      previewInspectorSession.runtimeFallbacks.size >= PREVIEW_INSPECTOR_RUNTIME_FALLBACK_LIMIT)
  ) {
    return;
  }
  let errorHeadline = '';
  if (error !== undefined) {
    try { errorHeadline = createRuntimeErrorHeadline(error); } catch { errorHeadline = String(error); }
  }
  const previous = previewInspectorSession.runtimeFallbacks.get(metadata.id);
  const requiredPaths = reason === 'threw' && metadata.requiredPaths.length === 0
    ? metadata.failurePaths
    : metadata.requiredPaths;
  const requiredPathSignature = createPreviewInspectorRuntimeFallbackSmartSignature(
    metadata,
    requiredPaths,
  );
  if (
    previewInspectorSession.runtimeFallbackSmartIds.has(metadata.id) &&
    previewInspectorSession.runtimeFallbackSmartPathSignatures.get(metadata.id) !==
      requiredPathSignature
  ) {
    // A later failure or hot edit can expose paths that were absent when Smart Fill first ran.
    // Reopen that edge as Auto so the next bounded corridor frontier can complete the new minimum
    // instead of treating an obsolete Smart value as permanently settled.
    previewInspectorSession.runtimeFallbackSmartIds.delete(metadata.id);
    previewInspectorSession.runtimeFallbackSmartPathSignatures.delete(metadata.id);
  }
  const { neuralSmartPathDecision: _neuralSmartPathDecision, ...recordMetadata } = metadata;
  void _neuralSmartPathDecision;
  const next = {
    ...recordMetadata,
    count: (previous?.count ?? 0) + 1,
    error: errorHeadline,
    fallbackPreview: describePreviewInspectorRuntimeFallbackValue(fallback),
    generatedPaths: [...generatedPaths],
    mode: hasPreviewInspectorRuntimeFallbackOverride(metadata.id)
      ? previewInspectorSession.runtimeFallbackSmartIds.has(metadata.id)
        ? 'smart-manual'
        : 'manual'
      : previewInspectorSession.runtimeFallbackSmartIds.has(metadata.id)
        ? 'smart'
        : 'auto',
    reachabilityKey:
      typeof previewInspectorSession.activeTargetReachabilityKey === 'string'
        ? previewInspectorSession.activeTargetReachabilityKey
        : undefined,
    reason,
    requiredPaths,
  };
  previewInspectorSession.runtimeFallbacks.set(metadata.id, next);
  if (
    reason !== 'smart-candidate' && reason !== 'neural-candidate' &&
    (
      previous === undefined ||
      previous.error !== next.error ||
      previous.reason !== next.reason ||
      previous.fallbackPreview !== next.fallbackPreview ||
      previous.neuralRecommendation?.candidateId !== next.neuralRecommendation?.candidateId
    )
  ) {
    if (
      typeof recordPreviewInspectorBlockerAutoDecision === 'function' &&
      !next.passive && (next.mode === 'auto' || next.mode === 'smart')
    ) {
      const neuralDataFlowSignal =
        previewInspectorSession.runtimeFallbackDataFlowSignals.get(metadata.id);
      recordPreviewInspectorBlockerAutoDecision({
        action: reason === 'partial' ? 'Complete missing hook fields' : 'Substitute failed hook result',
        blockerId: metadata.id,
        blockerKind: 'runtime-fallback',
        blockerName: 'Missing hook value · ' + metadata.hookName,
        column: metadata.column,
        generatedPaths,
        line: metadata.line,
        mode: next.mode,
        neuralResidualDecision:
          previewInspectorSession.runtimeFallbackNeuralDecisions.get(metadata.id),
        neuralDataFlowSignal,
        ownerName: metadata.ownerName,
        reason: errorHeadline || metadata.evidence,
        selectedValue: metadata.neuralRecommendation?.value ??
          createPreviewInspectorRuntimeFallbackSmartDraftTemplate(fallback, requiredPaths),
        sourcePath: metadata.sourcePath,
        startsRenderAttempt: neuralDataFlowSignal !== undefined ||
          metadata.residualHoleKind === 'render-state-reference-value',
        summary: {
          ...(metadata.neuralRecommendation === undefined
            ? {}
            : { neuralRecommendation: metadata.neuralRecommendation }),
          requiredPaths,
        },
        targetReachabilityKey: next.reachabilityKey,
      });
    }
    const message =
      '[Render-only fallback] ' + metadata.hookName + ' ' +
      (reason === 'threw'
        ? 'threw; using '
        : reason === 'partial'
          ? 'was missing required fields; supplementing with '
          : 'returned no required value; using ') +
      metadata.fallbackLabel;
    const details = [
      message,
      errorHeadline.length > 0 ? 'Original: ' + errorHeadline : '',
      'Evidence: ' + metadata.evidence,
      metadata.sourcePath + (metadata.line ? ':' + String(metadata.line) : ''),
      requiredPaths.length > 0 ? 'Required paths: ' + requiredPaths.join(', ') : '',
      generatedPaths.length > 0 ? 'Generated paths: ' + generatedPaths.join(', ') : '',
      'Generated: ' + next.fallbackPreview,
    ].filter(Boolean).join('\n');
    recordPreviewInspectorConsoleEntry({
      details,
      error,
      level: 'warn',
      location: metadata.sourcePath + (metadata.line ? ':' + String(metadata.line) : ''),
      message,
      phase: 'render-only runtime fallback',
      source: 'runtime-fallback',
    });
    readPreviewInspectorConsolePrimitives().warn('[React Preview] ' + details);
  }
  schedulePreviewInspectorRuntimeFallbackRefresh(next.reachabilityKey);
}

/** Returns one stable completed identity per authored object and compiler-issued hook site. */
function readOrCreatePreviewInspectorCompletedValue(metadata, value, fallback) {
  initializePreviewInspectorRuntimeFallbackState();
  if ((typeof value !== 'object' && typeof value !== 'function') || value === null) {
    return completePreviewInspectorGeneratedValue(value, fallback, {
      nonNegativeNumberPaths: metadata.nonNegativeNumberPaths,
      renderGuardPaths: metadata.renderGuardPaths,
      requiredPaths: metadata.requiredPaths,
      typedLiterals: metadata.typedLiterals,
      repairLiteralArrays: true,
    });
  }
  let completions = previewInspectorSession.runtimeFallbackCompletions.get(value);
  const cached = completions?.get(metadata.id);
  if (cached !== undefined && cached.fallback === fallback) return cached.completion;
  const completion = completePreviewInspectorGeneratedValue(value, fallback, {
    nonNegativeNumberPaths: metadata.nonNegativeNumberPaths,
    renderGuardPaths: metadata.renderGuardPaths,
    requiredPaths: metadata.requiredPaths,
    typedLiterals: metadata.typedLiterals,
    repairLiteralArrays: true,
  });
  if (completion.changed) {
    if (completions === undefined) {
      completions = new Map();
      previewInspectorSession.runtimeFallbackCompletions.set(value, completions);
    }
    if (completions.size < PREVIEW_INSPECTOR_RUNTIME_FALLBACK_LIMIT) {
      completions.set(metadata.id, { completion, fallback });
    }
  }
  return completion;
}

/** Query packages whose successful hooks own their loading, error, and data lifecycle. */
const PREVIEW_INSPECTOR_LIVE_QUERY_MODULES = new Set(['@tanstack/react-query', 'react-query']);

/** Recognizes a TanStack/React Query result object, including one returned by a custom wrapper. */
function isPreviewInspectorQueryResultShape(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value) &&
    typeof value.refetch === 'function' && typeof value.status === 'string' &&
    typeof value.isFetching === 'boolean' && typeof value.dataUpdatedAt === 'number';
}

/**
 * Reports whether a successful hook value came from a live Query client.
 * Its data arrives through authored query functions and the preview data boundary, so completing
 * absent fields during loading would replace the authored state with shape-blind placeholders.
 * A thrown hook (for example a missing QueryClientProvider) still uses the ordinary fallback.
 */
function isPreviewInspectorLiveQueryResult(metadata, value) {
  if (value === null || value === undefined) return false;
  if (PREVIEW_INSPECTOR_LIVE_QUERY_MODULES.has(metadata.moduleSpecifier)) return true;
  if (Array.isArray(value)) {
    return value.length > 0 && value.every(isPreviewInspectorQueryResultShape);
  }
  return isPreviewInspectorQueryResultShape(value);
}

/** Removes a stale fallback record once the real hook starts producing a usable value. */
function clearPreviewInspectorRuntimeFallback(metadata) {
  initializePreviewInspectorRuntimeFallbackState();
  if (previewInspectorSession.runtimeFallbacks.delete(metadata.id)) {
    previewInspectorSession.runtimeFallbackNeuralDecisions.delete(metadata.id);
    previewInspectorSession.runtimeFallbackDataFlowRecommendations.delete(metadata.id);
    previewInspectorSession.runtimeFallbackDataFlowSignals.delete(metadata.id);
    schedulePreviewInspectorRuntimeFallbackRefresh();
  }
}

/**
 * Executes one compiler-proven hook call and cuts a failure, nullish root, or missing-leaf edge.
 * Auto values off restores the authored hook result and exception behavior exactly.
 */
function resolvePreviewInspectorRuntimeHook(
  readHook,
  createFallback,
  rawMetadata,
  readGraphqlDocument,
  readGraphqlOptions,
  readHookIdentity,
  inheritedResolutionFrame,
) {
  // A store its own module creates (a toast list) is that module's state. Filling it elsewhere
  // would add sample notifications to every page that mounts the host beside its content, so it
  // runs exactly as authored, without fallback bookkeeping, unless its module is the opened file.
  if (
    rawMetadata?.moduleSpecifier === 'local-store' &&
    typeof readHook === 'function' &&
    !isPreviewInspectorSelectedTargetModule(rawMetadata.sourcePath)
  ) {
    return readHook();
  }
  const metadata = scopePreviewInspectorRuntimeFallbackMetadata(
    normalizePreviewInspectorRuntimeFallbackMetadata(rawMetadata),
    readGraphqlDocument,
    readGraphqlOptions,
  );
  // A guard pass only advances the selected corridor; an off-corridor sibling keeps its own state.
  const offCorridorGuard = metadata.renderGuardPaths.length > 0 &&
    typeof isPreviewInspectorRuntimeHookOwnerOnTargetCorridor === 'function' &&
    !hasPreviewInspectorRuntimeFallbackOverride(metadata.id) &&
    !isPreviewInspectorRuntimeHookOwnerOnTargetCorridor(metadata);
  if (
    metadata.id.length === 0 ||
    typeof readHook !== 'function' ||
    typeof createFallback !== 'function'
  ) {
    return readHook();
  }
  const neuralSmartPathDecision = typeof copyPreviewInspectorNeuralResidualDecision === 'function'
    ? copyPreviewInspectorNeuralResidualDecision(metadata.neuralSmartPathDecision)
    : undefined;
  if (neuralSmartPathDecision !== undefined) {
    initializePreviewInspectorRuntimeFallbackState();
    previewInspectorSession.runtimeFallbackNeuralDecisions.set(metadata.id, neuralSmartPathDecision);
  }
  let value;
  let failure;
  let hookIdentity;
  const manualOverride = hasPreviewInspectorRuntimeFallbackOverride(metadata.id);
  const ownsResolutionFrame = inheritedResolutionFrame === undefined;
  const resolutionFrame = inheritedResolutionFrame ??
    beginPreviewInspectorRuntimeFallbackResolutionFrame(metadata);
  if (typeof readHookIdentity === 'function') {
    try {
      hookIdentity = readHookIdentity();
    } catch {}
  }
  try {
    try {
      value = readHook();
    } catch (error) {
      if (
        isPreviewInspectorRuntimeThenable(error) ||
        (!manualOverride && !readPreviewInspectorFallbackValuesEnabled())
      ) {
        throw error;
      }
      failure = error;
    }
  } finally {
    if (ownsResolutionFrame) {
      finishPreviewInspectorRuntimeFallbackResolutionFrame(resolutionFrame);
    }
  }
  const sharedIdentityChanged = rememberPreviewInspectorRuntimeSmartAuthoredValue(
    metadata,
    failure === undefined ? value : undefined,
    failure !== undefined ||
      (
        !isPreviewInspectorRuntimeFallbackSharedIdentity(value) &&
        Array.isArray(resolutionFrame?.children) &&
        resolutionFrame.children.length > 0
      )
      ? hookIdentity
      : undefined,
  );
  if (sharedIdentityChanged) {
    schedulePreviewInspectorRuntimeFallbackRefresh(
      previewInspectorSession.activeTargetReachabilityKey,
    );
  }
  const retainedLocalUiController = failure === undefined
    ? rememberPreviewInspectorLocalUiController(metadata, value)
    : undefined;
  /*
   * Off the corridor, an authored scalar (a popup atom's false) is the page's real state and keeps
   * its branch. Objects and callables still take the guard pass: a static store bridge serves an
   * inert callable or empty record for an unread path, and those placeholders are always truthy.
   */
  const guardMetadata = offCorridorGuard && failure === undefined && value !== null &&
    value !== undefined && typeof value !== 'object' && typeof value !== 'function'
    ? { ...metadata, renderGuardPaths: [] }
    : metadata;
  const completionMetadata = retainedLocalUiController === undefined || manualOverride
    ? guardMetadata
    : protectPreviewInspectorLocalUiVisibilityGuard(guardMetadata, retainedLocalUiController);
  /*
   * A proven React-local visibility controller already supplies a coherent false state and the
   * authored callback that can change it. Protect only that exact false leaf from a truthy
   * render-guard fallback; completing unrelated data/loading fields remains necessary for hooks
   * that combine disclosure state with an application value model.
   */
  if (failure === undefined && !manualOverride && !readPreviewInspectorFallbackValuesEnabled()) {
    return value;
  }
  if (failure !== undefined && !manualOverride && !readPreviewInspectorFallbackValuesEnabled()) {
    throw failure;
  }
  if (
    failure === undefined &&
    !manualOverride &&
    completionMetadata.preserveNullish === true &&
    (value === null || value === undefined)
  ) {
    clearPreviewInspectorRuntimeFallback(completionMetadata);
    return value;
  }
  if (
    failure === undefined &&
    !manualOverride &&
    (completionMetadata.typedOnly === true ||
      isPreviewInspectorLiveQueryResult(completionMetadata, value))
  ) {
    // A typed-only site exists solely to replace a thrown hook with its declared result type.
    clearPreviewInspectorRuntimeFallback(completionMetadata);
    return value;
  }
  const cachedFallback = readPreviewInspectorRuntimeFallbackValue(
    completionMetadata,
    createFallback,
    readGraphqlDocument,
    readGraphqlOptions,
  );
  // A verified collection fill serves sample rows beside the cached value, never inside it.
  const compilerFallback = typeof readPreviewInspectorCollectionFillHookValue === 'function'
    ? readPreviewInspectorCollectionFillHookValue(completionMetadata.id, cachedFallback)
    : cachedFallback;
  const semanticValueRecommendation = manualOverride ||
    !shouldUsePreviewInspectorRuntimeSemanticValueRecommendation(
      completionMetadata,
      value,
      failure,
      resolutionFrame,
    )
    ? undefined
    : createPreviewInspectorRuntimeSemanticValueRecommendation(
        completionMetadata,
        compilerFallback,
      );
  const semanticCompletionMetadata = semanticValueRecommendation?.metadata ?? completionMetadata;
  const semanticFallback = semanticValueRecommendation?.value ?? compilerFallback;
  if (semanticValueRecommendation?.decision !== undefined) {
    previewInspectorSession.runtimeFallbackNeuralDecisions.set(
      semanticCompletionMetadata.id,
      semanticValueRecommendation.decision,
    );
  }
  const dataFlowRecommendation = manualOverride
    ? undefined
    : createPreviewInspectorRuntimeFallbackDataFlowRecommendation(
        semanticCompletionMetadata,
        semanticFallback,
      );
  const recommendedCompletionMetadata = dataFlowRecommendation === undefined
    ? semanticCompletionMetadata
    : {
        ...semanticCompletionMetadata,
        neuralRecommendation: dataFlowRecommendation.summary,
        residualHoleKind: 'rendered-collection-consumer-data',
      };
  const sharedCarrier = failure === undefined ? value : hookIdentity;
  const sharedCompletion = !manualOverride
    ? createPreviewInspectorRuntimeSharedSmartCompletion(
        recommendedCompletionMetadata,
        sharedCarrier,
        dataFlowRecommendation?.value ?? semanticFallback,
      )
    : { fallback: compilerFallback, metadata: completionMetadata, projected: false };
  const fallback = sharedCompletion.fallback;
  const effectiveCompletionMetadata = createPreviewInspectorRuntimeSmartCompletionMetadata(
    sharedCompletion.metadata,
  );
  const residualRecommendation = failure === undefined
    ? createPreviewInspectorNestedRuntimeFallbackRecommendation(
        effectiveCompletionMetadata,
        value,
        fallback,
        resolutionFrame,
        hookIdentity,
      )
    : undefined;
  const residualMetadata = residualRecommendation === undefined
    ? effectiveCompletionMetadata
    : {
        ...effectiveCompletionMetadata,
        neuralRecommendation: residualRecommendation.summary,
        residualHoleKind: 'nested-generated-shape-mismatch',
      };
  if (residualRecommendation?.decision !== undefined) {
    previewInspectorSession.runtimeFallbackNeuralDecisions.set(
      effectiveCompletionMetadata.id,
      residualRecommendation.decision,
    );
  }
  const ownsNeuralRecommendation = manualOverride ||
    previewInspectorSession.runtimeFallbackSmartIds.has(effectiveCompletionMetadata.id);
  if (
    residualRecommendation !== undefined &&
    residualRecommendation.shared !== true &&
    ownsNeuralRecommendation
  ) {
    const stored = storePreviewInspectorRuntimeSharedNeuralRecommendation(
      effectiveCompletionMetadata,
      hookIdentity,
      {
        label: residualRecommendation.summary.label,
        residual: residualRecommendation.summary.residual,
        sharedGuardPaths: residualRecommendation.sharedGuardPaths,
        strategy: residualRecommendation.strategy,
        value: residualRecommendation.summary.value,
      },
      'runtime-discovery',
    );
    if (stored) schedulePreviewInspectorRuntimeNeuralRecommendationRetry();
  }
  if (
    residualRecommendation !== undefined &&
    (
      ownsNeuralRecommendation || residualRecommendation.shared === true
    )
  ) {
    if (residualRecommendation.shared === true && !ownsNeuralRecommendation) {
      clearPreviewInspectorRuntimeFallback(residualMetadata);
      reportPreviewInspectorNestedRuntimeFallback(
        residualMetadata,
        'shared-neural-recommendation',
        residualRecommendation.generatedPaths,
      );
      return residualRecommendation.value;
    }
    recordPreviewInspectorRuntimeFallback(
      residualMetadata,
      residualRecommendation.value,
      'partial',
      undefined,
      residualRecommendation.generatedPaths,
    );
    reportPreviewInspectorNestedRuntimeFallback(
      residualMetadata,
      'neural-recommendation',
      residualRecommendation.generatedPaths,
    );
    return residualRecommendation.value;
  }
  if (residualRecommendation !== undefined) {
    recordPreviewInspectorRuntimeFallback(
      residualMetadata,
      residualRecommendation.value,
      'neural-candidate',
      undefined,
      [],
    );
    /*
     * A nested generated scalar cannot safely escape through a custom hook whose caller proves an
     * object contract: destructuring succeeds but yields undefined and the next member read throws
     * before the learned branch can be selected. Apply only the recommendation's neutral shape on
     * this discovery pass. Its branch-opening value remains recorded and is promoted by the normal
     * Smart retry, so this exception repair cannot invent visible state ahead of neural selection.
     */
    reportPreviewInspectorNestedRuntimeFallback(
      residualMetadata,
      'neural-shape-safety',
      residualRecommendation.generatedPaths,
    );
    return residualRecommendation.safeValue;
  }
  if (
    failure === undefined &&
    shouldUsePreviewInspectorHookGraphqlFallback(value, readGraphqlDocument)
  ) {
    recordPreviewInspectorRuntimeFallback(
      effectiveCompletionMetadata,
      fallback,
      'partial',
      undefined,
      effectiveCompletionMetadata.requiredPaths,
    );
    reportPreviewInspectorNestedRuntimeFallback(
      effectiveCompletionMetadata,
      'partial',
      effectiveCompletionMetadata.requiredPaths,
    );
    return fallback;
  }
  if (failure === undefined && value !== null && value !== undefined) {
    const completion = readOrCreatePreviewInspectorCompletedValue(
      effectiveCompletionMetadata,
      value,
      fallback,
    );
    if (!completion.changed) {
      if (
        !manualOverride &&
        hasPreviewInspectorRuntimeSmartAlternative(effectiveCompletionMetadata, value)
      ) {
        /*
         * Keep this compiler-proven alternative discoverable without changing ordinary Auto
         * rendering or emitting a false failure warning. Target reachability may select it only
         * after the exact component mounted without output.
         */
        recordPreviewInspectorRuntimeFallback(
          effectiveCompletionMetadata,
          fallback,
          'smart-candidate',
          undefined,
          [],
        );
      } else {
        clearPreviewInspectorRuntimeFallback(effectiveCompletionMetadata);
      }
      return value;
    }
    if (
      sharedCompletion.projected === true &&
      !previewInspectorSession.runtimeFallbackSmartIds.has(effectiveCompletionMetadata.id)
    ) {
      // A sibling shell consumer receives the exact state selected by the target hook. It is not a
      // second blocker and should not emit a duplicate partial-value warning or occupy a frontier.
      clearPreviewInspectorRuntimeFallback(effectiveCompletionMetadata);
      reportPreviewInspectorNestedRuntimeFallback(
        effectiveCompletionMetadata,
        'shared-smart-projection',
        completion.paths,
      );
      return completion.value;
    }
    recordPreviewInspectorRuntimeFallback(
      effectiveCompletionMetadata,
      fallback,
      'partial',
      undefined,
      completion.paths,
    );
    reportPreviewInspectorNestedRuntimeFallback(
      effectiveCompletionMetadata,
      'partial',
      completion.paths,
    );
    return completion.value;
  }
  if (
    sharedCompletion.projected === true &&
    !previewInspectorSession.runtimeFallbackSmartIds.has(effectiveCompletionMetadata.id)
  ) {
    // A Provider-less sibling call failed at the same exact imported hook function. It receives
    // the target's coherent Smart state without becoming a second missing-provider blocker.
    clearPreviewInspectorRuntimeFallback(effectiveCompletionMetadata);
    reportPreviewInspectorNestedRuntimeFallback(
      effectiveCompletionMetadata,
      'shared-smart-projection',
      effectiveCompletionMetadata.requiredPaths,
    );
    return fallback;
  }
  recordPreviewInspectorRuntimeFallback(
    effectiveCompletionMetadata,
    fallback,
    failure === undefined ? 'nullish' : 'threw',
    failure,
    effectiveCompletionMetadata.requiredPaths.length > 0
      ? effectiveCompletionMetadata.requiredPaths
      : failure !== undefined && effectiveCompletionMetadata.failurePaths.length > 0
        ? effectiveCompletionMetadata.failurePaths
        : effectiveCompletionMetadata.passive
          ? []
          : ['<root>'],
  );
  reportPreviewInspectorNestedRuntimeFallback(
    effectiveCompletionMetadata,
    failure === undefined ? 'nullish' : 'threw',
    effectiveCompletionMetadata.requiredPaths.length > 0
      ? effectiveCompletionMetadata.requiredPaths
      : ['<root>'],
  );
  return fallback;
}
`;
}
