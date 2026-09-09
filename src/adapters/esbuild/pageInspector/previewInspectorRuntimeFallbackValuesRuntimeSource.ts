/**
 * Coordinates generated hook values, semantic identity candidates, and bounded retry delivery.
 * This adapter emits a lexical fragment composed by previewInspectorRuntimeFallbackRuntimeSource.
 * Session state and helper ownership remain in the same generated browser module.
 */

/** Returns the ordered browser fragment; no project code runs during source generation. */
export function createPreviewInspectorRuntimeFallbackValuesRuntimeSource(): string {
  return String.raw`
/** Defers Inspector-only registry refreshes so a caught hook never updates UI during render. */
function schedulePreviewInspectorRuntimeFallbackRefresh(reachabilityKey) {
  const pendingKeys = previewInspectorSession.runtimeFallbackRefreshReachabilityKeys ??= new Set();
  if (typeof reachabilityKey === 'string' && reachabilityKey.length > 0) {
    pendingKeys.add(reachabilityKey);
  }
  if (previewInspectorSession.runtimeFallbackRefreshScheduled === true) return;
  previewInspectorSession.runtimeFallbackRefreshScheduled = true;
  previewInspectorScheduleRuntimeFallbackMicrotask(() => {
    previewInspectorSession.runtimeFallbackRefreshScheduled = false;
    schedulePreviewInspectorTreeRefresh();
    if (typeof schedulePreviewInspectorTargetRequirementContinuation === 'function') {
      for (const key of pendingKeys) schedulePreviewInspectorTargetRequirementContinuation(key);
    }
    pendingKeys.clear();
  });
}

/** Commits one learned recommendation only after the Auto transaction that found it has settled. */
function commitPreviewInspectorRuntimeNeuralRecommendationRetry(exportName, reachabilityKey) {
  previewInspectorSession.runtimeFallbackNeuralRetryScheduled = false;
  if (
    typeof exportName !== 'string' || exportName.length === 0 ||
    typeof refreshPreviewInspectorExport !== 'function' ||
    (
      typeof reachabilityKey === 'string' &&
      previewInspectorSession.activeTargetReachabilityKey !== reachabilityKey
    )
  ) return false;
  const corridorResumed = typeof resumePreviewInspectorTargetReachabilityAfterNeuralRecommendation ===
    'function' && typeof reachabilityKey === 'string'
    ? resumePreviewInspectorTargetReachabilityAfterNeuralRecommendation(reachabilityKey)
    : false;
  const notifiedSubscriberCount = notifyPreviewInspectorRuntimeFallbackNeuralSubscribers();
  refreshPreviewInspectorExport(exportName, false);
  if (typeof recordPreviewInspectorRuntimeHealth === 'function') {
    recordPreviewInspectorRuntimeHealth({
      category: 'neural-residual',
      detail: {
        corridorResumed,
        exportName,
        notifiedSubscriberCount,
        phase: 'retry-scheduled',
        reachabilityKey,
      },
      event: 'neural-residual-shared',
    });
  }
  return true;
}

/** Resets the page error boundary once after a newly learned target recommendation is available. */
function schedulePreviewInspectorRuntimeNeuralRecommendationRetry() {
  if (
    previewInspectorSession.runtimeFallbackNeuralRetryScheduled === true ||
    typeof refreshPreviewInspectorExport !== 'function'
  ) return false;
  const reachabilityKey = previewInspectorSession.activeTargetReachabilityKey;
  const state = typeof reachabilityKey === 'string'
    ? previewInspectorSession.targetReachabilityByKey?.get?.(reachabilityKey)
    : undefined;
  const exportName = typeof state?.targetExportName === 'string'
    ? state.targetExportName
    : previewInspectorSession.selectedExportName;
  if (typeof exportName !== 'string' || exportName.length === 0) return false;
  previewInspectorSession.runtimeFallbackNeuralRetryScheduled = true;
  const scheduleAfterCommit = typeof previewInspectorScheduleRuntimeEffectFrame === 'function'
    ? previewInspectorScheduleRuntimeEffectFrame
    : previewInspectorScheduleRuntimeFallbackMicrotask;
  scheduleAfterCommit(() => {
    const activeAttempt = previewInspectorSession.blockerTraceActiveAttempt;
    if (
      activeAttempt?.settledAt === undefined &&
      typeof reachabilityKey === 'string' &&
      activeAttempt?.targetReachabilityKey === reachabilityKey
    ) {
      activeAttempt.runtimeFallbackNeuralRetry = { exportName, reachabilityKey };
      if (typeof settlePreviewInspectorBlockerTraceAttempt === 'function') {
        settlePreviewInspectorBlockerTraceAttempt(activeAttempt, {
          outcome: 'superseded-by-neural-recommendation',
        });
        return;
      }
      /*
       * The export-boundary reset must wait for the active transaction, but mounted hook consumers
       * can safely observe the committed recommendation after this animation frame. Without this
       * notification an invisible stateful drawer can deadlock: its output is required to settle
       * the attempt that is itself withholding the learned state needed to make that output visible.
      */
      notifyPreviewInspectorRuntimeFallbackNeuralSubscribers();
      if (typeof recordPreviewInspectorRuntimeHealth === 'function') {
        recordPreviewInspectorRuntimeHealth({
          category: 'neural-residual',
          detail: { exportName, phase: 'retry-deferred', reachabilityKey },
          event: 'neural-residual-shared',
        });
      }
      return;
    }
    commitPreviewInspectorRuntimeNeuralRecommendationRetry(exportName, reachabilityKey);
  });
  return true;
}

/** Safely describes one generated fallback without retaining or invoking project-owned values. */
function describePreviewInspectorRuntimeFallbackValue(value) {
  try {
    return boundPreviewInspectorConsoleText(
      formatPreviewInspectorConsoleValue(value),
      PREVIEW_INSPECTOR_RUNTIME_FALLBACK_TEXT_LIMIT,
    );
  } catch {
    return '[Generated static value]';
  }
}

/** Creates one stable fallback value per compiler-issued hook identity. */
function readOrCreatePreviewInspectorRuntimeFallback(
  metadata,
  createFallback,
  readGraphqlDocument,
  readGraphqlOptions,
) {
  initializePreviewInspectorRuntimeFallbackState();
  if (previewInspectorSession.runtimeFallbackValues.has(metadata.id)) {
    /*
     * The metadata id already includes the GraphQL document and bounded identity variables. A
     * second enrichment would allocate a new data object and refetch closure on every component
     * render, retriggering application effects whose dependency arrays contain the query result.
     */
    return previewInspectorSession.runtimeFallbackValues.get(metadata.id);
  }
  const compilerFallback = createFallback();
  const graphqlFallback = createPreviewInspectorHookGraphqlFallback(
    compilerFallback,
    readGraphqlDocument,
    readGraphqlOptions,
  );
  const exactFallback = completePreviewInspectorGeneratedValue(graphqlFallback, compilerFallback, {
    renderGuardPaths: metadata.renderGuardPaths,
    requiredPaths: metadata.requiredPaths,
  }).value;
  const structuralFallback = createPreviewInspectorRuntimeFallbackAutoValue(
    exactFallback,
    metadata.requiredPaths,
  );
  const fallback = overlayPreviewInspectorHookGraphqlLiteralDemands(
    structuralFallback,
    readGraphqlDocument,
  );
  markPreviewInspectorGeneratedValue(fallback);
  if (previewInspectorSession.runtimeFallbackValues.size < PREVIEW_INSPECTOR_RUNTIME_FALLBACK_LIMIT) {
    previewInspectorSession.runtimeFallbackValues.set(metadata.id, fallback);
  }
  return fallback;
}

/** Creates the bounded residual problem shared by unseen identity-valued hook fields. */
function createPreviewInspectorRuntimeSemanticValueSpecification(metadata, demand) {
  return {
    blockerKind: 'runtime-fallback',
    holeKind: 'render-state-reference-value',
    numbers: {
      requiredPathCount: metadata.requiredPaths.length,
      semanticPathDepth: parsePreviewInspectorRequiredPath(demand.path)?.path.length ?? 0,
    },
    texts: [metadata.evidence, metadata.hookName, metadata.ownerName, demand.path],
    tokens: [
      'compiler-semantic-demand:' + demand.kind,
      'semantic-path-leaf:value',
      'value-source:generated-hook',
    ],
  };
}

/** Keeps materialization deterministic while the residual chooses only between admitted values. */
function createPreviewInspectorRuntimeSemanticValueCandidates() {
  return [
    {
      deterministicRank: 1,
      id: 'independent-generated-value',
      numbers: { referentialCoherence: 0 },
      texts: ['Retain the independently generated value leaf'],
      tokens: ['strategy:independent-generated-value'],
    },
    {
      deterministicRank: 0,
      id: 'generated-identity-reference',
      numbers: { referentialCoherence: 1 },
      texts: ['Reuse the generated collection identity convention'],
      tokens: ['strategy:generated-identity-reference'],
    },
  ];
}

/** Replaces one compiler-owned scalar path without invoking project getters or setters. */
function replacePreviewInspectorRuntimeFallbackSemanticValue(value, rawPath, replacement) {
  const parsed = parsePreviewInspectorRequiredPath(rawPath);
  if (
    parsed === undefined || parsed.callable || parsed.collection || parsed.stringReceiver ||
    parsed.path.length === 0
  ) return value;
  let template = copyPreviewInspectorBlockerValueForJson(value, { nodes: 0 });
  const indexedRoot = /^\d+$/u.test(parsed.path[0]);
  if (template === null || typeof template !== 'object' || Array.isArray(template) !== indexedRoot) {
    template = indexedRoot ? [] : {};
  }
  let current = template;
  for (const [index, propertyName] of parsed.path.entries()) {
    if (blockedInspectorPropNames.has(propertyName)) return value;
    if (index === parsed.path.length - 1) {
      current[propertyName] = replacement;
      break;
    }
    const expectsArray = /^\d+$/u.test(parsed.path[index + 1] ?? '');
    if (
      current[propertyName] === null || typeof current[propertyName] !== 'object' ||
      Array.isArray(current[propertyName]) !== expectsArray
    ) {
      current[propertyName] = expectsArray ? [] : {};
    }
    current = current[propertyName];
  }
  const materialized = materializePreviewInspectorRuntimeFallbackOverride(template);
  markPreviewInspectorGeneratedValue(materialized);
  return materialized;
}

/** Proposes compiler-admitted values; only their subsequent target render may train the residual. */
function createPreviewInspectorRuntimeSemanticValueRecommendation(metadata, compilerFallback) {
  const demand = metadata.semanticValueDemand;
  if (demand?.kind !== 'identity') return undefined;
  const parsed = parsePreviewInspectorRequiredPath(demand.path);
  if (parsed === undefined) return undefined;
  const generatedValue = readPreviewInspectorRequiredPathSeed(compilerFallback, parsed.path);
  const signature = JSON.stringify([
    typeof readPreviewInspectorNeuralLearningModelUpdates === 'function'
      ? readPreviewInspectorNeuralLearningModelUpdates()
      : 0,
    demand.kind,
    demand.path,
    generatedValue === PREVIEW_INSPECTOR_RUNTIME_GENERATED_IDENTITY_VALUE,
  ]);
  let entry = previewInspectorSession.runtimeFallbackSemanticValueRecommendations.get(metadata.id);
  if (entry?.signature !== signature) {
    const specification = createPreviewInspectorRuntimeSemanticValueSpecification(metadata, demand);
    const candidates = createPreviewInspectorRuntimeSemanticValueCandidates().filter((candidate) =>
      generatedValue !== PREVIEW_INSPECTOR_RUNTIME_GENERATED_IDENTITY_VALUE ||
        candidate.id === 'generated-identity-reference',
    );
    const selection = typeof selectPreviewInspectorNeuralResidualCandidate === 'function'
      ? selectPreviewInspectorNeuralResidualCandidate(specification, candidates)
      : undefined;
    entry = {
      selection,
      signature,
    };
    if (
      previewInspectorSession.runtimeFallbackSemanticValueRecommendations.size <
        PREVIEW_INSPECTOR_RUNTIME_FALLBACK_LIMIT
    ) {
      previewInspectorSession.runtimeFallbackSemanticValueRecommendations.set(metadata.id, entry);
    }
    if (selection?.decision !== undefined) {
      previewInspectorSession.runtimeFallbackNeuralDecisions.set(metadata.id, selection.decision);
      if (typeof recordPreviewInspectorNeuralResidualSelection === 'function') {
        recordPreviewInspectorNeuralResidualSelection(
          selection.decision,
          { mode: 'auto-semantic-discovery' },
          'semantic-value:' + metadata.id,
        );
      }
    }
  }
  const useIdentityReference =
    generatedValue === PREVIEW_INSPECTOR_RUNTIME_GENERATED_IDENTITY_VALUE ||
    entry?.selection?.candidateId === 'generated-identity-reference';
  const value = useIdentityReference ? replacePreviewInspectorRuntimeFallbackSemanticValue(
    compilerFallback,
    demand.path,
    PREVIEW_INSPECTOR_RUNTIME_GENERATED_IDENTITY_VALUE,
  ) : compilerFallback;
  const candidateId = useIdentityReference
    ? 'generated-identity-reference' : 'independent-generated-value';
  return Object.freeze({
    decision: entry?.selection?.decision,
    metadata: {
      ...metadata,
      neuralRecommendation: Object.freeze({
        candidateId,
        label: useIdentityReference ? 'Generated identity reference candidate' : 'Generated value candidate',
        path: demand.path,
        residual: typeof summarizePreviewInspectorNeuralResidualDecision === 'function'
          ? summarizePreviewInspectorNeuralResidualDecision(entry?.selection?.decision)
          : undefined,
        strategy: candidateId,
        value: useIdentityReference ? PREVIEW_INSPECTOR_RUNTIME_GENERATED_IDENTITY_VALUE : generatedValue,
      }),
      renderGuardPaths: normalizePreviewInspectorRequiredPropertyPaths([
        ...metadata.renderGuardPaths,
        demand.path,
      ]),
      residualHoleKind: 'render-state-reference-value',
    },
    value,
  });
}

/** Prevents semantic Auto learning from replacing a complete application-owned field value. */
function shouldUsePreviewInspectorRuntimeSemanticValueRecommendation(
  metadata,
  authoredValue,
  failure,
  resolutionFrame,
) {
  const demand = metadata.semanticValueDemand;
  if (demand === undefined) return false;
  if (
    failure !== undefined ||
    (Array.isArray(resolutionFrame?.children) && resolutionFrame.children.length > 0) ||
    isPreviewInspectorMarkedGeneratedValue(authoredValue)
  ) return true;
  const parsed = parsePreviewInspectorRequiredPath(demand.path);
  return parsed !== undefined &&
    readPreviewInspectorRequiredPathSeed(authoredValue, parsed.path) === undefined;
}

/** Returns whether a user supplied an explicit JSON result for one render-blocking hook edge. */
function hasPreviewInspectorRuntimeFallbackOverride(fallbackId) {
  initializePreviewInspectorRuntimeFallbackState();
  return previewInspectorSession.runtimeFallbackOverrides.has(fallbackId);
}

/** Selects the user value before compiler-inferred Auto data for one isolated hook edge. */
function readPreviewInspectorRuntimeFallbackValue(
  metadata,
  createFallback,
  readGraphqlDocument,
  readGraphqlOptions,
) {
  initializePreviewInspectorRuntimeFallbackState();
  if (previewInspectorSession.runtimeFallbackOverrides.has(metadata.id)) {
    const source = previewInspectorSession.runtimeFallbackOverrides.get(metadata.id);
    const cached = previewInspectorSession.runtimeFallbackMaterializedOverrides.get(metadata.id);
    if (cached?.source === source) return cached.value;
    const value = materializePreviewInspectorRuntimeFallbackOverride(source);
    previewInspectorSession.runtimeFallbackMaterializedOverrides.set(metadata.id, { source, value });
    return value;
  }
  return readOrCreatePreviewInspectorRuntimeFallback(
    metadata,
    createFallback,
    readGraphqlDocument,
    readGraphqlOptions,
  );
}

/**
 * Promotes exact target-only Smart scalars to render guards after that fallback is selected.
 *
 * Ordinary Auto completion keeps every non-nullish authored value, including intentionally dormant
 * Redux/Context state. Once target reachability explicitly Smart-fills this hook, however, a
 * compiler-proven overlay value such as State.Default must replace the existing State.Hidden;
 * otherwise the generated value is visible only in diagnostics and never reaches the component.
 */
function createPreviewInspectorRuntimeSmartCompletionMetadata(metadata) {
  initializePreviewInspectorRuntimeFallbackState();
  if (!previewInspectorSession.runtimeFallbackSmartIds.has(metadata.id)) return metadata;
  const smartPaths = (Array.isArray(metadata.smartPathValues) ? metadata.smartPathValues : [])
    .map((item) => item?.path)
    .filter((path) => typeof path === 'string' && path.length > 0);
  if (smartPaths.length === 0) return metadata;
  return {
    ...metadata,
    renderGuardPaths: normalizePreviewInspectorRequiredPropertyPaths([
      ...(metadata.renderGuardPaths ?? []),
      ...smartPaths,
    ]),
  };
}
`;
}
