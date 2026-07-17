/**
 * Generates the Page Inspector registry that bypasses render-critical hook failures.
 *
 * Compiler-issued hook wrappers call this runtime only in Page Inspector mode. The runtime keeps
 * successful complete values untouched, rethrows Suspense thenables, and substitutes or overlays a
 * bounded static value only when Auto values is enabled and a required runtime path is unavailable.
 */
import { createPreviewInspectorGeneratedValueRuntimeSource } from './previewInspectorGeneratedValueRuntimeSource';

/** Maximum distinct hook fallback sites retained by one pinned Inspector session. */
export const PREVIEW_INSPECTOR_RUNTIME_FALLBACK_LIMIT = 256;

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
  return String.raw`
const PREVIEW_INSPECTOR_RUNTIME_FALLBACK_LIMIT = ${PREVIEW_INSPECTOR_RUNTIME_FALLBACK_LIMIT};
const PREVIEW_INSPECTOR_RUNTIME_FALLBACK_TEXT_LIMIT = 1_000;
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
  if (!(previewInspectorSession.runtimeFallbackCompletions instanceof WeakMap)) {
    previewInspectorSession.runtimeFallbackCompletions = new WeakMap();
  }
}

${generatedValueRuntimeSource}

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
    fallbackLabel: readText('fallbackLabel', 'generated static value'),
    hookName: readText('hookName', 'custom hook'),
    id: readText('id'),
    line: Number.isSafeInteger(source.line) && source.line > 0 ? source.line : undefined,
    moduleSpecifier: readText('moduleSpecifier'),
    sourcePath: readText('sourcePath'),
  };
}

/** Defers Inspector-only registry refreshes so a caught hook never updates UI during render. */
function schedulePreviewInspectorRuntimeFallbackRefresh() {
  if (previewInspectorSession.runtimeFallbackRefreshScheduled === true) return;
  previewInspectorSession.runtimeFallbackRefreshScheduled = true;
  previewInspectorScheduleRuntimeFallbackMicrotask(() => {
    previewInspectorSession.runtimeFallbackRefreshScheduled = false;
    schedulePreviewInspectorTreeRefresh();
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
function readOrCreatePreviewInspectorRuntimeFallback(metadata, createFallback) {
  initializePreviewInspectorRuntimeFallbackState();
  if (previewInspectorSession.runtimeFallbackValues.has(metadata.id)) {
    return previewInspectorSession.runtimeFallbackValues.get(metadata.id);
  }
  const fallback = createFallback();
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
function readPreviewInspectorRuntimeFallbackValue(metadata, createFallback) {
  initializePreviewInspectorRuntimeFallbackState();
  if (previewInspectorSession.runtimeFallbackOverrides.has(metadata.id)) {
    return previewInspectorSession.runtimeFallbackOverrides.get(metadata.id);
  }
  return readOrCreatePreviewInspectorRuntimeFallback(metadata, createFallback);
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
  const next = {
    ...metadata,
    count: (previous?.count ?? 0) + 1,
    error: errorHeadline,
    fallbackPreview: describePreviewInspectorRuntimeFallbackValue(fallback),
    generatedPaths: [...generatedPaths],
    mode: hasPreviewInspectorRuntimeFallbackOverride(metadata.id) ? 'manual' : 'auto',
    reason,
  };
  previewInspectorSession.runtimeFallbacks.set(metadata.id, next);
  if (
    previous === undefined ||
    previous.error !== next.error ||
    previous.reason !== next.reason ||
    previous.fallbackPreview !== next.fallbackPreview
  ) {
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
  schedulePreviewInspectorRuntimeFallbackRefresh();
}

/** Returns one stable completed identity per authored object and compiler-issued hook site. */
function readOrCreatePreviewInspectorCompletedValue(metadata, value, fallback) {
  initializePreviewInspectorRuntimeFallbackState();
  if ((typeof value !== 'object' && typeof value !== 'function') || value === null) {
    return completePreviewInspectorGeneratedValue(value, fallback);
  }
  let completions = previewInspectorSession.runtimeFallbackCompletions.get(value);
  const cached = completions?.get(metadata.id);
  if (cached !== undefined && cached.fallback === fallback) return cached.completion;
  const completion = completePreviewInspectorGeneratedValue(value, fallback);
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
function resolvePreviewInspectorRuntimeHook(readHook, createFallback, rawMetadata) {
  const metadata = normalizePreviewInspectorRuntimeFallbackMetadata(rawMetadata);
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
  const fallback = readPreviewInspectorRuntimeFallbackValue(metadata, createFallback);
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
    ['<root>'],
  );
  return fallback;
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
  return previewInspectorSession.runtimeFallbackValues.get(fallbackId);
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
  previewInspectorSession.runtimeFallbackOverrides.set(
    fallbackId,
    normalizePreviewInspectorRuntimeFallbackOverride(value),
  );
  commitPreviewInspectorRuntimeFallbackChange();
}

/** Restores compiler-inferred generation for one blocker and ensures Auto values is enabled. */
function autoPassPreviewInspectorRuntimeFallback(fallbackId) {
  initializePreviewInspectorRuntimeFallbackState();
  if (!previewInspectorSession.runtimeFallbacks.has(fallbackId)) return;
  previewInspectorSession.runtimeFallbackOverrides.delete(fallbackId);
  previewInspectorSession.fallbackValuesEnabled = true;
  commitPreviewInspectorRuntimeFallbackChange();
}

/** Removes a manual blocker value while retaining the caller's current global Auto policy. */
function resetPreviewInspectorRuntimeFallbackOverride(fallbackId) {
  initializePreviewInspectorRuntimeFallbackState();
  if (!previewInspectorSession.runtimeFallbackOverrides.delete(fallbackId)) return;
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
  const manualCount = fallbacks.filter((fallback) => fallback.mode === 'manual').length;
  return readPreviewInspectorFallbackValuesEnabled()
    ? 'active: ' + String(count) + ' render-blocking hook edge(s) currently use generated static values'
    : manualCount > 0
      ? 'manual only: ' + String(manualCount) + ' hook edge(s) use explicit user pass values'
      : 'disabled by user: authored hook failures, nullish values, and missing fields are preserved';
}
`;
}
