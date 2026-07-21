/**
 * Generates the Page Inspector registry that bypasses render-critical hook failures.
 *
 * Compiler-issued hook wrappers call this runtime only in Page Inspector mode. The runtime keeps
 * successful complete values untouched, rethrows Suspense thenables, and substitutes or overlays a
 * bounded static value only when Auto values is enabled and a required runtime path is unavailable.
 */
import { createPreviewInspectorGeneratedValueRuntimeSource } from './previewInspectorGeneratedValueRuntimeSource';
import { createPreviewInspectorBlockerValueRuntimeSource } from './previewInspectorBlockerValueRuntimeSource';
import { createPreviewInspectorHookGraphqlRuntimeSource } from './previewInspectorHookGraphqlRuntimeSource';

/** Maximum distinct hook fallback sites retained by one pinned Inspector session. */
export const PREVIEW_INSPECTOR_RUNTIME_FALLBACK_LIMIT = 256;

/** Repeated executions admitted for one authored effect site before render-only isolation. */
export const PREVIEW_INSPECTOR_RUNTIME_EFFECT_EXECUTION_LIMIT = 24;

/**
 * Creates browser source for hook-failure isolation, warning capture, and UI inventory reads.
 *
 * Expected lexical bindings include the Inspector session, Auto values helpers, console formatting,
 * original console primitives, and coalesced notification functions from the composed runtime.
 *
 * @returns Plain JavaScript source evaluated before project modules are dynamically imported.
 */
export function createPreviewInspectorRuntimeFallbackRuntimeSource(): string {
  const generatedValueRuntimeSource = createPreviewInspectorGeneratedValueRuntimeSource();
  const blockerValueRuntimeSource = createPreviewInspectorBlockerValueRuntimeSource();
  const hookGraphqlRuntimeSource = createPreviewInspectorHookGraphqlRuntimeSource();
  return String.raw`
const PREVIEW_INSPECTOR_RUNTIME_FALLBACK_LIMIT = ${PREVIEW_INSPECTOR_RUNTIME_FALLBACK_LIMIT};
const PREVIEW_INSPECTOR_RUNTIME_FALLBACK_TEXT_LIMIT = 1_000;
const PREVIEW_INSPECTOR_RUNTIME_EFFECT_EXECUTION_LIMIT = ${PREVIEW_INSPECTOR_RUNTIME_EFFECT_EXECUTION_LIMIT};
const PREVIEW_INSPECTOR_RUNTIME_EFFECT_EXECUTION_WINDOW_MS = 1_000;
const previewInspectorScheduleRuntimeFallbackMicrotask =
  typeof globalThis.queueMicrotask === 'function'
    ? globalThis.queueMicrotask.bind(globalThis)
    : (callback) => Promise.resolve().then(callback);

/** Lazily initializes ephemeral blocker records and stable fallback identities. */
function initializePreviewInspectorRuntimeFallbackState() {
  if (!(previewInspectorSession.runtimeFallbacks instanceof Map)) {
    previewInspectorSession.runtimeFallbacks = new Map();
  }
  if (!(previewInspectorSession.runtimeFallbackValues instanceof Map)) {
    previewInspectorSession.runtimeFallbackValues = new Map();
  }
  if (!(previewInspectorSession.runtimeFallbackOverrides instanceof Map)) {
    const persisted = readPersistedPreviewInspectorState();
    const persistedOverrides = persisted.runtimeFallbackOverrides;
    const entries = persistedOverrides !== null && typeof persistedOverrides === 'object'
      ? Object.entries(persistedOverrides).filter(
          ([fallbackId]) => typeof fallbackId === 'string' && fallbackId.length > 0,
        )
      : [];
    previewInspectorSession.runtimeFallbackOverrides = new Map(
      entries.slice(0, PREVIEW_INSPECTOR_RUNTIME_FALLBACK_LIMIT),
    );
  }
  if (!(previewInspectorSession.runtimeFallbackMaterializedOverrides instanceof Map)) {
    previewInspectorSession.runtimeFallbackMaterializedOverrides = new Map();
  }
  if (!(previewInspectorSession.runtimeFallbackCompletions instanceof WeakMap)) {
    previewInspectorSession.runtimeFallbackCompletions = new WeakMap();
  }
  if (!(previewInspectorSession.runtimeFallbackSmartIds instanceof Set)) {
    previewInspectorSession.runtimeFallbackSmartIds = new Set();
  }
  if (!(previewInspectorSession.runtimeFallbackSmartPathSignatures instanceof Map)) {
    previewInspectorSession.runtimeFallbackSmartPathSignatures = new Map();
  }
  if (!(previewInspectorSession.runtimeEffectIsolations instanceof Map)) {
    previewInspectorSession.runtimeEffectIsolations = new Map();
  }
  if (!(previewInspectorSession.runtimeEffectExecutionWindows instanceof Map)) {
    previewInspectorSession.runtimeEffectExecutionWindows = new Map();
  }
}

${generatedValueRuntimeSource}

${blockerValueRuntimeSource}

${hookGraphqlRuntimeSource}

/** Reports whether a thrown value is a Suspense thenable that React must continue to own. */
function isPreviewInspectorRuntimeThenable(value) {
  if ((typeof value !== 'object' && typeof value !== 'function') || value === null) return false;
  try {
    return typeof value.then === 'function';
  } catch {
    return false;
  }
}

/** Bounds compiler metadata before retaining it in the local webview session. */
function normalizePreviewInspectorRuntimeFallbackMetadata(metadata) {
  const source = metadata !== null && typeof metadata === 'object' ? metadata : {};
  const readText = (name, fallback = '') =>
    typeof source[name] === 'string'
      ? source[name].slice(0, PREVIEW_INSPECTOR_RUNTIME_FALLBACK_TEXT_LIMIT)
      : fallback;
  return {
    column: Number.isSafeInteger(source.column) && source.column > 0 ? source.column : undefined,
    evidence: readText('evidence', 'bounded static hook usage inference'),
    failurePaths: normalizePreviewInspectorRequiredPropertyPaths(source.failurePaths),
    fallbackLabel: readText('fallbackLabel', 'generated static value'),
    hookName: readText('hookName', 'custom hook'),
    id: readText('id'),
    line: Number.isSafeInteger(source.line) && source.line > 0 ? source.line : undefined,
    moduleSpecifier: readText('moduleSpecifier'),
    nonNegativeNumberPaths: normalizePreviewInspectorRequiredPropertyPaths(
      source.nonNegativeNumberPaths,
    ),
    ownerName: readText('ownerName'),
    passive: source.passive === true,
    preserveNullish: source.preserveNullish === true,
    requiredPaths: normalizePreviewInspectorRequiredPropertyPaths(source.requiredPaths),
    sourcePath: readText('sourcePath'),
  };
}

/** Creates the exact compiler/runtime requirement coverage owned by one applied Smart value. */
function createPreviewInspectorRuntimeFallbackPathSignature(requiredPaths) {
  // Property access order can vary across equivalent React branches. Treat the evidence as a set so
  // an order-only change cannot reopen a settled Smart fallback and restart automatic resolution.
  return JSON.stringify([...normalizePreviewInspectorRequiredPropertyPaths(requiredPaths)].sort());
}

/** Separates a shared query-wrapper callsite into one fallback record per authored request. */
function scopePreviewInspectorRuntimeFallbackMetadata(metadata, readDocument, readOptions) {
  if (metadata.id.length === 0) return metadata;
  const requestIdentity = createPreviewInspectorHookGraphqlRequestIdentity(
    readDocument,
    readOptions,
  );
  if (requestIdentity.length === 0) return metadata;
  const suffix = ':graphql:' + requestIdentity;
  return {
    ...metadata,
    id: metadata.id.slice(0, PREVIEW_INSPECTOR_RUNTIME_FALLBACK_TEXT_LIMIT - suffix.length) + suffix,
  };
}

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
  const fallback = createPreviewInspectorRuntimeFallbackAutoValue(
    createPreviewInspectorHookGraphqlFallback(
      createFallback(),
      readGraphqlDocument,
      readGraphqlOptions,
    ),
    metadata.requiredPaths,
  );
  if (previewInspectorSession.runtimeFallbackValues.size < PREVIEW_INSPECTOR_RUNTIME_FALLBACK_LIMIT) {
    previewInspectorSession.runtimeFallbackValues.set(metadata.id, fallback);
  }
  return fallback;
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
  const requiredPathSignature = createPreviewInspectorRuntimeFallbackPathSignature(requiredPaths);
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
  const next = {
    ...metadata,
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
    previous === undefined ||
    previous.error !== next.error ||
    previous.reason !== next.reason ||
    previous.fallbackPreview !== next.fallbackPreview
  ) {
    if (
      typeof recordPreviewInspectorBlockerAutoDecision === 'function' &&
      !next.passive && (next.mode === 'auto' || next.mode === 'smart')
    ) {
      recordPreviewInspectorBlockerAutoDecision({
        action: reason === 'partial' ? 'Complete missing hook fields' : 'Substitute failed hook result',
        blockerId: metadata.id,
        blockerKind: 'runtime-fallback',
        blockerName: 'Missing hook value · ' + metadata.hookName,
        column: metadata.column,
        generatedPaths,
        line: metadata.line,
        mode: next.mode,
        ownerName: metadata.ownerName,
        reason: errorHeadline || metadata.evidence,
        selectedValue: createPreviewInspectorRuntimeFallbackSmartDraftTemplate(
          fallback,
          requiredPaths,
        ),
        sourcePath: metadata.sourcePath,
        summary: { requiredPaths },
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
      requiredPaths: metadata.requiredPaths,
    });
  }
  let completions = previewInspectorSession.runtimeFallbackCompletions.get(value);
  const cached = completions?.get(metadata.id);
  if (cached !== undefined && cached.fallback === fallback) return cached.completion;
  const completion = completePreviewInspectorGeneratedValue(value, fallback, {
    nonNegativeNumberPaths: metadata.nonNegativeNumberPaths,
    requiredPaths: metadata.requiredPaths,
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

/** Removes a stale fallback record once the real hook starts producing a usable value. */
function clearPreviewInspectorRuntimeFallback(metadata) {
  initializePreviewInspectorRuntimeFallbackState();
  if (previewInspectorSession.runtimeFallbacks.delete(metadata.id)) {
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
) {
  const metadata = scopePreviewInspectorRuntimeFallbackMetadata(
    normalizePreviewInspectorRuntimeFallbackMetadata(rawMetadata),
    readGraphqlDocument,
    readGraphqlOptions,
  );
  if (
    metadata.id.length === 0 ||
    typeof readHook !== 'function' ||
    typeof createFallback !== 'function'
  ) {
    return readHook();
  }
  let value;
  let failure;
  const manualOverride = hasPreviewInspectorRuntimeFallbackOverride(metadata.id);
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
  if (failure === undefined && !manualOverride && !readPreviewInspectorFallbackValuesEnabled()) {
    return value;
  }
  if (failure !== undefined && !manualOverride && !readPreviewInspectorFallbackValuesEnabled()) {
    throw failure;
  }
  if (
    failure === undefined &&
    !manualOverride &&
    metadata.preserveNullish === true &&
    (value === null || value === undefined)
  ) {
    clearPreviewInspectorRuntimeFallback(metadata);
    return value;
  }
  const fallback = readPreviewInspectorRuntimeFallbackValue(
    metadata,
    createFallback,
    readGraphqlDocument,
    readGraphqlOptions,
  );
  if (
    failure === undefined &&
    shouldUsePreviewInspectorHookGraphqlFallback(value, readGraphqlDocument)
  ) {
    recordPreviewInspectorRuntimeFallback(
      metadata,
      fallback,
      'partial',
      undefined,
      metadata.requiredPaths,
    );
    return fallback;
  }
  if (failure === undefined && value !== null && value !== undefined) {
    const completion = readOrCreatePreviewInspectorCompletedValue(metadata, value, fallback);
    if (!completion.changed) {
      clearPreviewInspectorRuntimeFallback(metadata);
      return value;
    }
    recordPreviewInspectorRuntimeFallback(
      metadata,
      fallback,
      'partial',
      undefined,
      completion.paths,
    );
    return completion.value;
  }
  recordPreviewInspectorRuntimeFallback(
    metadata,
    fallback,
    failure === undefined ? 'nullish' : 'threw',
    failure,
    metadata.requiredPaths.length > 0
      ? metadata.requiredPaths
      : failure !== undefined && metadata.failurePaths.length > 0
        ? metadata.failurePaths
        : metadata.passive
          ? []
          : ['<root>'],
  );
  return fallback;
}

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
 * Stops one effect site that repeatedly completes but schedules another synchronous application
 * update. React reports this pattern only after dozens of commits, at which point the renderer can
 * already be unresponsive. The preview boundary therefore admits a generous bounded burst and then
 * isolates that source site; ordinary one-shot effects and modest lists remain unaffected.
 */
function shouldIsolatePreviewInspectorRepeatedRuntimeEffect(rawMetadata) {
  if (!readPreviewInspectorFallbackValuesEnabled()) return false;
  initializePreviewInspectorRuntimeFallbackState();
  const metadata = normalizePreviewInspectorRuntimeFallbackMetadata(rawMetadata);
  if (metadata.id.length === 0) return false;
  const now = Date.now();
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
  const withinWindow = previous?.revision === revision &&
    now - previous.startedAt <= PREVIEW_INSPECTOR_RUNTIME_EFFECT_EXECUTION_WINDOW_MS;
  const execution = {
    count: withinWindow ? previous.count + 1 : 1,
    isolated: false,
    revision,
    startedAt: withinWindow ? previous.startedAt : now,
  };
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
      ' times within ' + String(PREVIEW_INSPECTOR_RUNTIME_EFFECT_EXECUTION_WINDOW_MS) +
      ' ms; further executions were disabled for this preview session',
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
function resolvePreviewInspectorRuntimeEffect(readEffect, rawMetadata) {
  if (typeof readEffect !== 'function') return undefined;
  initializePreviewInspectorRuntimeFallbackState();
  const effectScopeKey = previewInspectorSession.runtimeFallbackScopeKey;
  if (shouldIsolatePreviewInspectorRepeatedRuntimeEffect(rawMetadata)) return undefined;
  let result;
  try {
    result = readEffect();
  } catch (error) {
    if (!readPreviewInspectorFallbackValuesEnabled()) throw error;
    recordPreviewInspectorRuntimeEffectIsolation(rawMetadata, error, 'effect', effectScopeKey);
    return undefined;
  }
  if (isPreviewInspectorRuntimeThenable(result)) {
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
  if (typeof result === 'function') {
    return createPreviewInspectorRuntimeEffectCleanup(result, rawMetadata, effectScopeKey);
  }
  const metadata = normalizePreviewInspectorRuntimeFallbackMetadata(rawMetadata);
  previewInspectorSession.runtimeEffectIsolations.delete(metadata.id);
  return result;
}

/**
 * Completes a GraphQL Code Generator fragment carrier from its authored fragment selection.
 * The normal helper still executes first; real carrier fields win, while an empty Context/prop
 * placeholder receives only missing selected fields through the ordinary editable blocker store.
 */
function resolvePreviewInspectorGraphqlFragmentValue(
  readFragment,
  readDocument,
  createStaticFallback,
  metadata,
) {
  return resolvePreviewInspectorRuntimeHook(
    readFragment,
    () => {
      const selectedData = createPreviewInspectorHookGraphqlFragmentData(readDocument);
      return selectedData ?? createStaticFallback();
    },
    metadata,
  );
}

/** Returns sorted immutable-looking copies for the Inspector Fallbacks detail pane. */
function readPreviewInspectorRuntimeFallbacks() {
  initializePreviewInspectorRuntimeFallbackState();
  return [...previewInspectorSession.runtimeFallbacks.values()]
    .map((record) => ({ ...record }))
    .sort((left, right) =>
      left.sourcePath.localeCompare(right.sourcePath) ||
      (left.line ?? 0) - (right.line ?? 0) ||
      left.hookName.localeCompare(right.hookName),
    );
}

/** Returns the editable generated/manual value currently associated with one blocker row. */
function readPreviewInspectorRuntimeFallbackDraft(fallbackId) {
  initializePreviewInspectorRuntimeFallbackState();
  if (previewInspectorSession.runtimeFallbackOverrides.has(fallbackId)) {
    return previewInspectorSession.runtimeFallbackOverrides.get(fallbackId);
  }
  const fallback = previewInspectorSession.runtimeFallbackValues.get(fallbackId);
  const record = previewInspectorSession.runtimeFallbacks.get(fallbackId);
  return createPreviewInspectorRuntimeFallbackDraftTemplate(fallback, record?.requiredPaths ?? []);
}

/** Copies bounded JSON while dropping prototype keys before it can enter project hook code. */
function normalizePreviewInspectorRuntimeFallbackOverride(value) {
  const encoded = JSON.stringify(value, (propertyName, propertyValue) =>
    blockedInspectorPropNames.has(propertyName) ? undefined : propertyValue,
  );
  if (typeof encoded !== 'string' || encoded.length > 64 * 1024) {
    throw new TypeError('Fallback JSON must be serializable and no larger than 64 KiB.');
  }
  return JSON.parse(encoded);
}

/** Remounts the selected authored page after one blocker value policy changes. */
function commitPreviewInspectorRuntimeFallbackChange() {
  previewInspectorSession.renderConditionRevision =
    (previewInspectorSession.renderConditionRevision ?? 0) + 1;
  persistPreviewInspectorState();
  notifyPreviewInspector();
  schedulePreviewInspectorCommitRefresh();
}

/** Stores user-authored JSON for one known blocker and gives it precedence over Auto inference. */
function setPreviewInspectorRuntimeFallbackOverride(fallbackId, value) {
  initializePreviewInspectorRuntimeFallbackState();
  if (!previewInspectorSession.runtimeFallbacks.has(fallbackId)) return;
  previewInspectorSession.runtimeFallbackSmartIds.delete(fallbackId);
  previewInspectorSession.runtimeFallbackSmartPathSignatures.delete(fallbackId);
  previewInspectorSession.runtimeFallbackOverrides.set(
    fallbackId,
    normalizePreviewInspectorRuntimeFallbackOverride(value),
  );
  previewInspectorSession.runtimeFallbackMaterializedOverrides.delete(fallbackId);
  commitPreviewInspectorRuntimeFallbackChange();
}

/** Restores compiler-inferred generation for one blocker and ensures Auto values is enabled. */
function autoPassPreviewInspectorRuntimeFallback(fallbackId) {
  initializePreviewInspectorRuntimeFallbackState();
  if (!previewInspectorSession.runtimeFallbacks.has(fallbackId)) return;
  previewInspectorSession.runtimeFallbackSmartIds.delete(fallbackId);
  previewInspectorSession.runtimeFallbackSmartPathSignatures.delete(fallbackId);
  previewInspectorSession.runtimeFallbackOverrides.delete(fallbackId);
  previewInspectorSession.runtimeFallbackMaterializedOverrides.delete(fallbackId);
  const fallback = previewInspectorSession.runtimeFallbackValues.get(fallbackId);
  const requiredPaths = previewInspectorSession.runtimeFallbacks.get(fallbackId)?.requiredPaths ?? [];
  if (previewInspectorSession.runtimeFallbackValues.has(fallbackId)) {
    previewInspectorSession.runtimeFallbackValues.set(
      fallbackId,
      createPreviewInspectorRuntimeFallbackAutoValue(fallback, requiredPaths),
    );
  }
  const record = previewInspectorSession.runtimeFallbacks.get(fallbackId);
  if (typeof recordPreviewInspectorBlockerAutoDecision === 'function' && record !== undefined) {
    recordPreviewInspectorBlockerAutoDecision({
      action: 'Use compiler-inferred hook value',
      blockerId: fallbackId,
      blockerKind: 'runtime-fallback',
      blockerName: 'Missing hook value · ' + record.hookName,
      column: record.column,
      generatedPaths: requiredPaths,
      line: record.line,
      mode: 'auto',
      ownerName: record.ownerName,
      reason: record.evidence,
      selectedValue: previewInspectorSession.runtimeFallbackValues.get(fallbackId),
      sourcePath: record.sourcePath,
      startsRenderAttempt: true,
      summary: { requiredPaths },
    });
  }
  previewInspectorSession.fallbackValuesEnabled = true;
  commitPreviewInspectorRuntimeFallbackChange();
}

/** Mutates one known hook edge to its minimum demanded shape without scheduling a remount. */
function applyPreviewInspectorRuntimeFallbackSmartValue(fallbackId) {
  initializePreviewInspectorRuntimeFallbackState();
  const record = previewInspectorSession.runtimeFallbacks.get(fallbackId);
  if (record === undefined || !previewInspectorSession.runtimeFallbackValues.has(fallbackId)) return false;
  const fallback = previewInspectorSession.runtimeFallbackValues.get(fallbackId);
  const manualValue = previewInspectorSession.runtimeFallbackOverrides.get(fallbackId);
  const wasSmart = previewInspectorSession.runtimeFallbackSmartIds.has(fallbackId);
  const pathSignature = createPreviewInspectorRuntimeFallbackPathSignature(record.requiredPaths);
  const previousPathSignature =
    previewInspectorSession.runtimeFallbackSmartPathSignatures.get(fallbackId);
  if (manualValue !== undefined) {
    const minimum = createPreviewInspectorRuntimeFallbackSmartDraftTemplate(
      fallback,
      record.requiredPaths,
    );
    const completion = completePreviewInspectorGeneratedValue(manualValue, minimum, {
      requiredPaths: record.requiredPaths,
    });
    if (completion.changed) {
      previewInspectorSession.runtimeFallbackOverrides.set(
        fallbackId,
        normalizePreviewInspectorRuntimeFallbackOverride(completion.value),
      );
      previewInspectorSession.runtimeFallbackMaterializedOverrides.delete(fallbackId);
    }
    previewInspectorSession.runtimeFallbackSmartIds.add(fallbackId);
    previewInspectorSession.runtimeFallbackSmartPathSignatures.set(fallbackId, pathSignature);
    // The selected branch can disappear before the instrumented hook executes again. Reflect the
    // Smart state in the registry now so an obsolete Auto record cannot repeatedly occupy the next
    // target-reachability frontier while waiting for a re-registration that may never happen.
    previewInspectorSession.runtimeFallbacks.set(fallbackId, {
      ...record,
      mode: 'smart-manual',
    });
    return completion.changed || !wasSmart || previousPathSignature !== pathSignature;
  }
  previewInspectorSession.runtimeFallbackValues.set(
    fallbackId,
    createPreviewInspectorRuntimeFallbackSmartValue(fallback, record.requiredPaths),
  );
  previewInspectorSession.runtimeFallbackSmartIds.add(fallbackId);
  previewInspectorSession.runtimeFallbackSmartPathSignatures.set(fallbackId, pathSignature);
  // Keep frontier selection and Inspector presentation synchronized with the value mutation even
  // when Smart Fill itself removes the component that originally registered this fallback.
  previewInspectorSession.runtimeFallbacks.set(fallbackId, {
    ...record,
    mode: 'smart',
  });
  return !wasSmart || previousPathSignature !== pathSignature;
}

/** Replaces one generated hook result with only the paths proven necessary by downstream reads. */
function smartFillPreviewInspectorRuntimeFallback(fallbackId) {
  if (!applyPreviewInspectorRuntimeFallbackSmartValue(fallbackId)) return;
  const record = previewInspectorSession.runtimeFallbacks.get(fallbackId);
  if (typeof recordPreviewInspectorBlockerAutoDecision === 'function' && record !== undefined) {
    const generatedSelection = createPreviewInspectorRuntimeFallbackSmartDraftTemplate(
      previewInspectorSession.runtimeFallbackValues.get(fallbackId),
      record.requiredPaths,
    );
    recordPreviewInspectorBlockerAutoDecision({
      action: 'Smart fill minimum hook value',
      blockerId: fallbackId,
      blockerKind: 'runtime-fallback',
      blockerName: 'Missing hook value · ' + record.hookName,
      column: record.column,
      generatedPaths: record.requiredPaths,
      line: record.line,
      mode: previewInspectorSession.runtimeFallbackOverrides.has(fallbackId)
        ? 'smart-manual'
        : 'smart',
      ownerName: record.ownerName,
      reason: record.evidence,
      selectedValue: generatedSelection,
      sourcePath: record.sourcePath,
      startsRenderAttempt: true,
      summary: {
        preservedUserValue: previewInspectorSession.runtimeFallbackOverrides.has(fallbackId),
        requiredPaths: record.requiredPaths,
      },
    });
  }
  previewInspectorSession.fallbackValuesEnabled = true;
  commitPreviewInspectorRuntimeFallbackChange();
}

/**
 * Smart-fills every hook edge observed inside one authored page corridor as one batched mutation.
 * Deterministic background traversal skips explicit JSON so it cannot silently revise a scenario;
 * the user-invoked Smart action retains its existing behavior of completing that JSON in place.
 */
function smartFillPreviewInspectorRuntimeFallbacksForReachability(reachabilityKey, options = {}) {
  initializePreviewInspectorRuntimeFallbackState();
  const preserveUserValues = options?.preserveUserValues === true;
  const admittedIds = Array.isArray(options?.recordIds)
    ? new Set(options.recordIds.filter((value) => typeof value === 'string'))
    : undefined;
  const changeLimit = Number.isSafeInteger(options?.changeLimit)
    ? Math.max(1, Math.min(24, options.changeLimit))
    : 24;
  let changed = false;
  let changeCount = 0;
  for (const record of previewInspectorSession.runtimeFallbacks.values()) {
    if (record.reachabilityKey !== reachabilityKey) continue;
    if (record.passive === true || (admittedIds !== undefined && !admittedIds.has(record.id))) {
      continue;
    }
    if (preserveUserValues && previewInspectorSession.runtimeFallbackOverrides.has(record.id)) {
      continue;
    }
    const recordChanged = applyPreviewInspectorRuntimeFallbackSmartValue(record.id);
    changed = recordChanged || changed;
    if (recordChanged) {
      changeCount += 1;
      if (changeCount >= changeLimit) break;
    }
  }
  if (changed) previewInspectorSession.fallbackValuesEnabled = true;
  return changed;
}

/** Removes a manual blocker value while retaining the caller's current global Auto policy. */
function resetPreviewInspectorRuntimeFallbackOverride(fallbackId) {
  initializePreviewInspectorRuntimeFallbackState();
  if (!previewInspectorSession.runtimeFallbackOverrides.delete(fallbackId)) return;
  previewInspectorSession.runtimeFallbackSmartIds.delete(fallbackId);
  previewInspectorSession.runtimeFallbackSmartPathSignatures.delete(fallbackId);
  previewInspectorSession.runtimeFallbackMaterializedOverrides.delete(fallbackId);
  commitPreviewInspectorRuntimeFallbackChange();
}

/** Serializes only the bounded JSON values explicitly authored in the blocker editor. */
function serializePreviewInspectorRuntimeFallbackOverrides() {
  initializePreviewInspectorRuntimeFallbackState();
  return Object.fromEntries(
    [...previewInspectorSession.runtimeFallbackOverrides].slice(
      0,
      PREVIEW_INSPECTOR_RUNTIME_FALLBACK_LIMIT,
    ),
  );
}

/** Describes the visual-only isolation status in detailed runtime diagnostics. */
function readPreviewInspectorRuntimeFallbackStatus() {
  const fallbacks = readPreviewInspectorRuntimeFallbacks();
  const count = fallbacks.length;
  initializePreviewInspectorRuntimeFallbackState();
  const effectCount = previewInspectorSession.runtimeEffectIsolations.size;
  const manualCount = fallbacks.filter((fallback) =>
    fallback.mode === 'manual' || fallback.mode === 'smart-manual',
  ).length;
  const effectSuffix = effectCount > 0
    ? '; ' + String(effectCount) + ' render-only effect failure(s) isolated'
    : '';
  return readPreviewInspectorFallbackValuesEnabled()
    ? 'active: ' + String(count) + ' render-blocking hook edge(s) currently use generated static values' + effectSuffix
    : manualCount > 0
      ? 'manual only: ' + String(manualCount) + ' hook edge(s) use explicit user pass values'
      : 'disabled by user: authored hook failures, nullish values, and missing fields are preserved';
}
`;
}
