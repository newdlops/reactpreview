/**
 * Isolates failed or repeatedly self-triggering effects and preserves bounded commit ownership.
 * This adapter emits a lexical fragment composed by previewInspectorRuntimeFallbackRuntimeSource.
 * Session state and helper ownership remain in the same generated browser module.
 */

/** Returns the ordered browser fragment; no project code runs during source generation. */
export function createPreviewInspectorRuntimeFallbackEffectsRuntimeSource(): string {
  return String.raw`
/**
 * Records an effect failure as an automatically resolved render-only warning.
 * Effects cannot accept a replacement payload, so presenting a JSON blocker editor would ask the
 * user a question with only one meaningful answer. The Inspector console retains source, owner,
 * missing-property evidence, and the original error while the rendered page remains mounted.
 */
function recordPreviewInspectorRuntimeEffectIsolation(rawMetadata, error, phase, effectScopeKey) {
  initializePreviewInspectorRuntimeFallbackState();
  if (previewInspectorSession.runtimeFallbackScopeKey !== effectScopeKey) return;
  const metadata = normalizePreviewInspectorRuntimeFallbackMetadata(rawMetadata);
  if (
    metadata.id.length === 0 ||
    (!previewInspectorSession.runtimeEffectIsolations.has(metadata.id) &&
      previewInspectorSession.runtimeEffectIsolations.size >= PREVIEW_INSPECTOR_RUNTIME_FALLBACK_LIMIT)
  ) {
    return;
  }
  const errorHeadline = createRuntimeErrorHeadline(error);
  const requiredPaths = readPreviewInspectorErrorPropertyPaths(error);
  const previous = previewInspectorSession.runtimeEffectIsolations.get(metadata.id);
  const next = {
    ...metadata,
    count: (previous?.count ?? 0) + 1,
    error: errorHeadline,
    phase,
    requiredPaths,
  };
  previewInspectorSession.runtimeEffectIsolations.set(metadata.id, next);
  if (previous?.error === next.error && previous?.phase === next.phase) return;
  const message = '[Render-only effect isolation] ' + metadata.hookName +
    ' failed during ' + phase + '; the authored page remains mounted';
  const details = [
    message,
    'Original: ' + errorHeadline,
    metadata.sourcePath + (metadata.line ? ':' + String(metadata.line) : ''),
    metadata.ownerName ? 'Owner: ' + metadata.ownerName : '',
    requiredPaths.length > 0 ? 'Observed missing paths: ' + requiredPaths.join(', ') : '',
  ].filter(Boolean).join('\n');
  recordPreviewInspectorConsoleEntry({
    details,
    error,
    level: 'warn',
    location: metadata.sourcePath + (metadata.line ? ':' + String(metadata.line) : ''),
    message,
    phase: 'render-only effect isolation',
    source: 'runtime-effect',
  });
  readPreviewInspectorConsolePrimitives().warn('[React Preview] ' + details);
  recordPreviewInspectorRuntimeHealth({
    category: 'render-isolation',
    detail: {
      effect: metadata.hookName,
      error: errorHeadline,
      ownerName: metadata.ownerName,
      phase,
      requiredPaths,
      sourcePath: metadata.sourcePath,
    },
    event: 'runtime-effect-isolated',
  });
  schedulePreviewInspectorRuntimeFallbackRefresh();
}

/** Wraps a cleanup callback so a later unmount cannot replace an otherwise valid static page. */
function createPreviewInspectorRuntimeEffectCleanup(cleanup, metadata, effectScopeKey) {
  return () => {
    if (!readPreviewInspectorFallbackValuesEnabled()) return cleanup();
    try {
      return cleanup();
    } catch (error) {
      recordPreviewInspectorRuntimeEffectIsolation(metadata, error, 'cleanup', effectScopeKey);
      return undefined;
    }
  };
}

/**
 * Clears a completed frame's execution counter without reviving a superseded candidate/revision.
 *
 * Counting by animation frame, rather than wall-clock frequency, distinguishes a legitimate
 * 60/120Hz state-driven animation from a synchronous effect/update loop that prevents the browser
 * from reaching its next paint. The token check keeps an old frame callback from deleting a newer
 * burst admitted under the same stable source id.
 */
function schedulePreviewInspectorRuntimeEffectBurstReset(metadataId, revision, frameToken) {
  if (typeof previewInspectorScheduleRuntimeEffectFrame !== 'function') return;
  previewInspectorScheduleRuntimeEffectFrame(() => {
    const current = previewInspectorSession.runtimeEffectExecutionWindows?.get(metadataId);
    if (
      current?.revision === revision &&
      current.frameToken === frameToken &&
      current.isolated !== true
    ) {
      previewInspectorSession.runtimeEffectExecutionWindows.delete(metadataId);
    }
  });
}

/**
 * Stops one effect site that repeatedly completes but schedules another synchronous application
 * update before the browser can paint. React reports this pattern only after dozens of commits, at
 * which point the renderer can already be unresponsive. Ordinary repeated animation effects are
 * admitted because their counter is cleared at every browser frame boundary.
 */
function shouldIsolatePreviewInspectorRepeatedRuntimeEffect(rawMetadata) {
  if (!readPreviewInspectorFallbackValuesEnabled()) return false;
  initializePreviewInspectorRuntimeFallbackState();
  const metadata = normalizePreviewInspectorRuntimeFallbackMetadata(rawMetadata);
  if (metadata.id.length === 0) return false;
  const revision = typeof previewEntryRevision === 'number' ? previewEntryRevision : 0;
  const previous = previewInspectorSession.runtimeEffectExecutionWindows.get(metadata.id);
  if (previous?.isolated === true && previous.revision === revision) return true;
  if (
    previous === undefined &&
    previewInspectorSession.runtimeEffectExecutionWindows.size >=
      PREVIEW_INSPECTOR_RUNTIME_FALLBACK_LIMIT
  ) {
    return false;
  }
  const withinFrame = previous?.revision === revision;
  const frameToken = withinFrame ? previous.frameToken : Symbol(metadata.id);
  const execution = {
    count: withinFrame ? previous.count + 1 : 1,
    frameToken,
    isolated: false,
    revision,
  };
  if (!withinFrame) {
    schedulePreviewInspectorRuntimeEffectBurstReset(metadata.id, revision, frameToken);
  }
  if (execution.count <= PREVIEW_INSPECTOR_RUNTIME_EFFECT_EXECUTION_LIMIT) {
    previewInspectorSession.runtimeEffectExecutionWindows.set(metadata.id, execution);
    return false;
  }
  execution.isolated = true;
  previewInspectorSession.runtimeEffectExecutionWindows.set(metadata.id, execution);
  recordPreviewInspectorRuntimeEffectIsolation(
    metadata,
    new Error(
      'Effect executed more than ' + String(PREVIEW_INSPECTOR_RUNTIME_EFFECT_EXECUTION_LIMIT) +
      ' times before the next browser frame; further executions were disabled for this preview session',
    ),
    'repeated effect execution',
    previewInspectorSession.runtimeFallbackScopeKey,
  );
  return true;
}

/**
 * Runs one compiler-proven React effect while Auto values controls render-only failure isolation.
 * Successful cleanup functions remain intact. Promise-returning effects are made non-blocking and
 * their rejection is logged because React cannot use a Promise as an effect cleanup value.
 */
function resolvePreviewInspectorRuntimeEffect(readEffect, rawMetadata, ownershipToken) {
  if (typeof readEffect !== 'function') return undefined;
  initializePreviewInspectorRuntimeFallbackState();
  const effectScopeKey = previewInspectorSession.runtimeFallbackScopeKey;
  const chainEffect = normalizePreviewInspectorRuntimeFallbackMetadata(rawMetadata);
  previewInspectorSession.activeTargetRenderChainEffect = { id: chainEffect.id, ownershipToken, sourcePath: chainEffect.sourcePath };
  if (shouldIsolatePreviewInspectorRepeatedRuntimeEffect(rawMetadata)) return undefined;
  let result;
  try {
    result = readEffect();
  } catch (error) {
    previewInspectorSession.activeTargetRenderChainEffect = undefined;
    if (!readPreviewInspectorFallbackValuesEnabled()) throw error;
    recordPreviewInspectorRuntimeEffectIsolation(rawMetadata, error, 'effect', effectScopeKey);
    return undefined;
  }
  const chain = previewInspectorSession.targetRenderCommitChainsByToken?.get?.(ownershipToken);
  if (chain?.markedCallEffectId === chainEffect.id && chainEffect.id.length > 0) chain.effectCompletedAfterMarkedCall = true;
  previewInspectorSession.activeTargetRenderChainEffect = undefined;
  if (isPreviewInspectorRuntimeThenable(result)) {
    previewInspectorSession.activeTargetRenderChainEffect = undefined;
    if (!readPreviewInspectorFallbackValuesEnabled()) return result;
    Promise.resolve(result).catch((error) => {
      recordPreviewInspectorRuntimeEffectIsolation(
        rawMetadata,
        error,
        'async effect',
        effectScopeKey,
      );
    });
    return undefined;
  }
  rememberPreviewInspectorSuccessfulRuntimeEffect(rawMetadata, ownershipToken);
  if (typeof result === 'function') {
    if (typeof continuePreviewInspectorTargetReachabilityAfterSuccessfulRuntimeEffect === 'function') {
      continuePreviewInspectorTargetReachabilityAfterSuccessfulRuntimeEffect(rawMetadata, ownershipToken);
    }
    return createPreviewInspectorRuntimeEffectCleanup(result, rawMetadata, effectScopeKey);
  }
  const metadata = normalizePreviewInspectorRuntimeFallbackMetadata(rawMetadata);
  previewInspectorSession.runtimeEffectIsolations.delete(metadata.id);
  if (typeof continuePreviewInspectorTargetReachabilityAfterSuccessfulRuntimeEffect === 'function') {
    continuePreviewInspectorTargetReachabilityAfterSuccessfulRuntimeEffect(rawMetadata, ownershipToken);
  }
  return result;
}
`;
}
