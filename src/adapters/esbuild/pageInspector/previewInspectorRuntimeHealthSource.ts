/**
 * Generates a browser-to-host health stream for preview compatibility decisions and error chains.
 * This layer is deliberately separate from blocker state: blocker traces explain user/Auto choices,
 * while health events explain the renderer mechanisms that may hide CSS, alter package resolution,
 * or produce a secondary fallback failure after the original application exception.
 */

/** Creates bounded browser source for health event correlation and live host delivery. */
export function createPreviewInspectorRuntimeHealthSource(): string {
  return String.raw`
const PREVIEW_INSPECTOR_HEALTH_RECORD_LIMIT = 256;
const PREVIEW_INSPECTOR_HEALTH_ERROR_ROOT_LIMIT = 64;
const PREVIEW_INSPECTOR_HEALTH_TEXT_LIMIT = 4_000;
const PREVIEW_INSPECTOR_HEALTH_ERROR_CHAIN_MS = 5_000;
const PREVIEW_INSPECTOR_HEALTH_ERROR_ASSISTANCE_FRAME_LIMIT = 6;
const previewInspectorCompositionHealthPriorityKeys = [
  'targetState', 'requirementSearch', 'pageExecution', 'route', 'statusCounts',
  'blockerSummary', 'candidate', 'evidence', 'treeStatus', 'visitLimitReached',
];
// Snapshots describe the current state: a return to an earlier state (A -> B -> A) must reach the
// host again, so they are deduplicated only against the latest snapshot of the same event.
const previewInspectorRuntimeHealthStateSnapshotEvents = new Set(['page-composition-snapshot']);
const previewInspectorRuntimeHealthDeferredAssistanceEvents = new Set([
  'runtime-error-cascade',
  'runtime-error-fallback',
  'runtime-error-root',
]);
const previewInspectorRuntimeHealthEvents = new Set([
  'automatic-condition-rolled-back',
  'automatic-resolution-rolled-back',
  'graphql-interpolation-repaired',
  'neural-assistance-requested',
  'neural-residual-corrected',
  'neural-residual-data-flow-trained',
  'neural-residual-selected',
  'neural-residual-shared',
  'neural-residual-trained',
  'neural-page-context-failed',
  'neural-page-context-verified',
  'neural-page-execution-context-rejected',
  'neural-page-execution-context-verified',
  'page-composition-snapshot',
  'page-context-selected',
  'page-execution-preparation-stopped',
  'render-attempt-started',
  'render-attempt-settled',
  'runtime-effect-isolated',
  'runtime-error-cascade',
  'runtime-error-fallback',
  'runtime-error-root',
  'styled-components-instance-warning',
  'styled-components-boundary-composed',
  'styled-components-configuration-partial',
  'styled-components-style-commit',
  'theme-boundary-composed',
  'theme-token-repaired',
]);

/** Initializes ephemeral health state that survives Inspector refreshes but not webview disposal. */
function initializePreviewInspectorRuntimeHealthState() {
  if (!(previewInspectorSession.runtimeHealthFingerprints instanceof Map)) {
    previewInspectorSession.runtimeHealthFingerprints = new Map();
  }
  if (!(previewInspectorSession.runtimeHealthRootErrors instanceof Map)) {
    previewInspectorSession.runtimeHealthRootErrors = new Map();
  }
  if (!Number.isSafeInteger(previewInspectorSession.runtimeHealthSequence)) {
    previewInspectorSession.runtimeHealthSequence = 0;
  }
  if (!(previewInspectorSession.runtimeHealthLatestSnapshots instanceof Map)) {
    previewInspectorSession.runtimeHealthLatestSnapshots = new Map();
  }
}

/** Copies renderer-owned diagnostic data into a bounded JSON-compatible value. */
function copyPreviewInspectorRuntimeHealthValue(
  value,
  depth = 0,
  state = { nodes: 0, seen: new WeakSet() },
) {
  state.nodes += 1;
  if (state.nodes > 384) return '[Node limit]';
  if (typeof value === 'string') return value.slice(0, PREVIEW_INSPECTOR_HEALTH_TEXT_LIMIT);
  if (value === null || typeof value === 'boolean') return value;
  if (typeof value === 'number') return Number.isFinite(value) ? value : String(value);
  if (value === undefined) return null;
  if (typeof value === 'bigint') return String(value) + 'n';
  if (typeof value === 'symbol' || typeof value === 'function') return '[' + typeof value + ']';
  if (typeof value !== 'object') return '[' + typeof value + ']';
  if (state.seen.has(value)) return '[Circular]';
  if (depth >= 5) return '[Depth limit]';
  state.seen.add(value);
  let isArray = false;
  try { isArray = Array.isArray(value); } catch { return '[Uninspectable]'; }
  if (isArray) {
    return value.slice(0, 48).map((item) =>
      copyPreviewInspectorRuntimeHealthValue(item, depth + 1, state),
    );
  }
  let keys;
  try { keys = Object.keys(value).slice(0, 48); } catch { return '[Uninspectable]'; }
  const result = {};
  for (const key of keys) {
    if (blockedInspectorPropNames.has(key)) continue;
    let descriptor;
    try { descriptor = Object.getOwnPropertyDescriptor(value, key); } catch { descriptor = undefined; }
    if (
      descriptor === undefined ||
      !('value' in descriptor) ||
      descriptor.value === undefined
    ) continue;
    result[key] = copyPreviewInspectorRuntimeHealthValue(descriptor.value, depth + 1, state);
  }
  return result;
}

/**
 * Copies composition evidence breadth first under the same 384-node, five-level, 48-key bounds.
 * Shallow target flags and counts are reserved before deep ownership/provenance diagnostics.
 * A branch that cannot fit stays explicitly opaque; no property accessor or project function runs.
 */
function copyPreviewInspectorCompositionHealthValue(value) {
  const pending = [];
  const seen = new WeakSet();
  let nodes = 0;
  let result;
  const read = (current, depth, assign) => {
    nodes += 1;
    if (typeof current === 'string') return assign(current.slice(0, PREVIEW_INSPECTOR_HEALTH_TEXT_LIMIT));
    if (current === null || typeof current === 'boolean') return assign(current);
    if (typeof current === 'number') return assign(Number.isFinite(current) ? current : String(current));
    if (current === undefined) return assign(null);
    if (typeof current === 'bigint') return assign(String(current) + 'n');
    if (typeof current !== 'object') return assign('[' + typeof current + ']');
    if (seen.has(current)) return assign('[Circular]');
    if (depth >= 5) return assign('[Depth limit]');
    seen.add(current);
    let array;
    try { array = Array.isArray(current); } catch { return assign('[Uninspectable]'); }
    const output = array ? [] : {};
    assign(output);
    pending.push({ current, depth, assign, output, array });
  };
  read(value, 0, (copied) => { result = copied; });
  for (let index = 0; index < pending.length; index += 1) {
    const frame = pending[index];
    let descriptors;
    try { descriptors = Object.getOwnPropertyDescriptors(frame.current); }
    catch { frame.assign('[Uninspectable]'); continue; }
    let keys = frame.array
      ? Array.from({ length: Math.min(48, descriptors.length?.value ?? 0) }, (_, item) => String(item))
      : Object.keys(descriptors).filter((key) => descriptors[key].enumerable === true);
    if (frame.depth === 0 && !frame.array) {
      const priority = new Set(previewInspectorCompositionHealthPriorityKeys);
      const present = new Set(keys);
      keys = [...previewInspectorCompositionHealthPriorityKeys.filter((key) => present.has(key)),
        ...keys.filter((key) => !priority.has(key))];
    }
    const values = keys.slice(0, 48).flatMap((key) => {
      if (blockedInspectorPropNames.has(key)) return [];
      const descriptor = descriptors[key];
      if (descriptor === undefined) return frame.array ? [[key, undefined]] : [];
      if (!Object.hasOwn(descriptor, 'value')) return [];
      return descriptor.value === undefined && !frame.array ? [] : [[key, descriptor.value]];
    });
    if (nodes + values.length > 384) { frame.assign('[Node limit]'); continue; }
    for (const [key, child] of values) {
      read(child, frame.depth + 1, (copied) => { frame.output[key] = copied; });
    }
  }
  return result;
}

/** Returns source evidence generated by the compiler without accepting project object accessors. */
function readPreviewInspectorRuntimeHealthSource(detail) {
  const evidence = detail?.evidence;
  if (evidence === null || typeof evidence !== 'object') return undefined;
  const sourcePath = typeof evidence.sourcePath === 'string' ? evidence.sourcePath : '';
  if (!(sourcePath.startsWith('/') || /^[A-Za-z]:[\\/]/u.test(sourcePath))) return undefined;
  const source = { sourcePath: sourcePath.slice(0, 16_384) };
  if (Number.isSafeInteger(evidence.line) && evidence.line > 0) source.line = evidence.line;
  if (Number.isSafeInteger(evidence.column) && evidence.column > 0) source.column = evidence.column;
  return source;
}

/** Resolves severity from the compatibility action rather than trusting a project-supplied value. */
function readPreviewInspectorRuntimeHealthSeverity(event) {
  if (event.startsWith('runtime-error')) {
    return 'error';
  }
  return event === 'graphql-interpolation-repaired' ||
    event === 'runtime-effect-isolated' ||
    event === 'theme-token-repaired' ||
    event === 'styled-components-instance-warning' ||
    event === 'styled-components-configuration-partial'
    ? 'warn'
    : 'info';
}

/**
 * Distinguishes React compatibility/deprecation diagnostics from failures that prevented a commit.
 * React emits several non-fatal development warnings through console.error, so the transport level
 * alone cannot decide whether a warning starts a runtime failure chain.
 */
function isPreviewInspectorNonFatalReactDiagnostic(message) {
  return /(?:findDOMNode is deprecated|Each child in a list should have a unique|React does not recognize the|Invalid (?:DOM property|attribute name)|validateDOMNesting|Received .* for a non-boolean attribute|A component is changing an? (?:un)?controlled|Support for defaultProps will be removed from function components|AG Grid: error #272)/u.test(
    message,
  );
}

/** Emits one deduplicated health event and returns its revision-local identity. */
function recordPreviewInspectorRuntimeHealth(candidate = {}) {
  initializePreviewInspectorRuntimeHealthState();
  const event = typeof candidate.event === 'string' ? candidate.event : '';
  if (!previewInspectorRuntimeHealthEvents.has(event)) return undefined;
  const category = typeof candidate.category === 'string'
    ? candidate.category.slice(0, 80)
    : 'renderer';
  const detail = event === 'page-composition-snapshot'
    ? copyPreviewInspectorCompositionHealthValue(candidate.detail ?? {})
    : copyPreviewInspectorRuntimeHealthValue(candidate.detail ?? {});
  const parentEventId = typeof candidate.parentEventId === 'string'
    ? candidate.parentEventId.slice(0, 160)
    : undefined;
  const source = readPreviewInspectorRuntimeHealthSource(candidate.detail);
  let fingerprint;
  try {
    fingerprint = JSON.stringify([
      previewEntryRevision,
      category,
      event,
      parentEventId,
      detail,
      source,
    ]);
  } catch {
    fingerprint = String(previewEntryRevision) + ':' + category + ':' + event;
  }
  const snapshotKey = previewInspectorRuntimeHealthStateSnapshotEvents.has(event)
    ? category + '\0' + event
    : undefined;
  if (snapshotKey !== undefined) {
    if (previewInspectorSession.runtimeHealthLatestSnapshots.get(snapshotKey) === fingerprint) {
      return undefined;
    }
  } else if (previewInspectorSession.runtimeHealthFingerprints.has(fingerprint)) return undefined;
  previewInspectorSession.runtimeHealthSequence += 1;
  const eventId = 'runtime-health-' + String(previewInspectorSession.runtimeHealthSequence);
  if (snapshotKey !== undefined) {
    previewInspectorSession.runtimeHealthLatestSnapshots.set(snapshotKey, fingerprint);
  } else {
    previewInspectorSession.runtimeHealthFingerprints.set(fingerprint, eventId);
  }
  if (previewInspectorSession.runtimeHealthFingerprints.size > PREVIEW_INSPECTOR_HEALTH_RECORD_LIMIT) {
    previewInspectorSession.runtimeHealthFingerprints.delete(
      previewInspectorSession.runtimeHealthFingerprints.keys().next().value,
    );
  }
  try {
    previewInspectorPostHostMessage?.({
      ...readPreviewInspectorRuntimeCorrelation(),
      event: {
        category,
        detail,
        event,
        eventId,
        ...(parentEventId === undefined ? {} : { parentEventId }),
        revision: previewEntryRevision,
        sequence: previewInspectorSession.runtimeHealthSequence,
        severity: readPreviewInspectorRuntimeHealthSeverity(event),
        ...(source === undefined ? {} : { source }),
        target: readPreviewInspectorBlockerTraceTarget(),
        timestamp: new Date().toISOString(),
      },
      type: 'react-preview-runtime-health',
    });
  } catch {
    /* Health delivery cannot participate in project rendering. */
  }
  try {
    if (typeof syncPreviewInspectorNeuralLearningStatusFromHealth === 'function') {
      syncPreviewInspectorNeuralLearningStatusFromHealth(event, detail);
    }
  } catch {
    /* Progress UI cannot participate in project rendering or health delivery. */
  }
  try {
    if (
      !previewInspectorRuntimeHealthDeferredAssistanceEvents.has(event) &&
      typeof schedulePreviewInspectorAutomaticNeuralAssistanceFromHealth === 'function'
    ) {
      schedulePreviewInspectorAutomaticNeuralAssistanceFromHealth(event, detail);
    }
  } catch {
    /* Automatic assistance cannot participate in project rendering or health delivery. */
  }
  return eventId;
}

/** Creates a stable error-chain key for the currently selected page candidate and export. */
function createPreviewInspectorRuntimeHealthErrorKey(entry) {
  return [
    previewEntryRevision,
    previewInspectorSession.selectedPageCandidateId ?? '',
    entry?.exportName ?? previewInspectorSession.selectedExportName ?? '',
  ].join(':');
}

/** Extracts the first project-facing component label without trusting stack object accessors. */
function readPreviewInspectorRuntimeHealthErrorOwner(entry, componentStack) {
  const stackOwner = /^\s*at\s+([^\s(]+)/mu.exec(componentStack)?.[1];
  if (typeof stackOwner === 'string' && stackOwner.length > 0) {
    return stackOwner.slice(0, 240);
  }
  if (typeof entry?.exportName === 'string' && entry.exportName.length > 0) {
    return entry.exportName.slice(0, 240);
  }
  return String(previewInspectorSession.selectedExportName ?? 'selected target').slice(0, 240);
}

/** Returns the retained root failure for this exact candidate/export render revision. */
function readPreviewInspectorRuntimeHealthTargetError(exportName) {
  initializePreviewInspectorRuntimeHealthState();
  return previewInspectorSession.runtimeHealthRootErrors.get(
    createPreviewInspectorRuntimeHealthErrorKey({ exportName }),
  );
}

/** Clears a root failure only after exact authored target output has replaced its fallback. */
function clearPreviewInspectorRuntimeHealthTargetError(exportName) {
  initializePreviewInspectorRuntimeHealthState();
  return previewInspectorSession.runtimeHealthRootErrors.delete(
    createPreviewInspectorRuntimeHealthErrorKey({ exportName }),
  );
}

/** Demotes a previously reached page when a later runtime error invalidates its visible output. */
function demotePreviewInspectorReachedTargetAfterRuntimeError(exportName, errorRecord) {
  const states = previewInspectorSession.targetReachabilityByKey;
  if (!(states instanceof Map)) return;
  let changed = false;
  for (const state of states.values()) {
    if (state?.targetExportName !== exportName) continue;
    const previouslyReached = state.status === 'reached';
    state.targetHasOutput = false;
    state.targetOutputError = errorRecord;
    state.targetOutputKind = 'fallback-output';
    state.targetOutputRecoveryPending = true;
    if (previouslyReached) state.status = 'runtime-error-output';
    if (
      previouslyReached &&
      typeof schedulePreviewInspectorTargetFailureRepairContinuation === 'function'
    ) {
      try {
        schedulePreviewInspectorTargetFailureRepairContinuation(state.key, errorRecord);
      } catch {
        /* Unsupported late failures remain contained and visible without reopening traversal. */
      }
    }
    changed = true;
  }
  if (!changed) return;
  if (typeof schedulePreviewInspectorTreeRefresh === 'function') {
    schedulePreviewInspectorTreeRefresh();
  }
  if (typeof schedulePreviewInspectorCommitRefresh === 'function') {
    schedulePreviewInspectorCommitRefresh();
  }
}

/** Waits a few commit frames for an exact runtime blocker to enter the inspector tree. */
function schedulePreviewInspectorRuntimeHealthErrorAssistanceRetry(
  event,
  detail,
  remainingFrames = PREVIEW_INSPECTOR_HEALTH_ERROR_ASSISTANCE_FRAME_LIMIT,
) {
  if (
    remainingFrames <= 0 ||
    typeof schedulePreviewInspectorNeuralAssistanceFrame !== 'function' ||
    typeof schedulePreviewInspectorAutomaticNeuralAssistanceFromHealth !== 'function'
  ) return false;
  schedulePreviewInspectorNeuralAssistanceFrame(() => {
    if (previewInspectorSession.neuralAssistancePending === true) return;
    try {
      schedulePreviewInspectorAutomaticNeuralAssistanceFromHealth(event, detail);
      if (remainingFrames > 1) {
        schedulePreviewInspectorRuntimeHealthErrorAssistanceRetry(
          event,
          detail,
          remainingFrames - 1,
        );
      }
    } catch {
      /* A deferred retry cannot participate in project rendering. */
    }
  });
  return true;
}

/** Reports root, cascade, and error-fallback failures without claiming heuristic certainty. */
function recordPreviewInspectorRuntimeHealthError(entry) {
  const rawMessage = String(entry?.message ?? '[Runtime error]');
  const isStyledComponentsInstanceWarning =
    /several instances of ['"]styled-components['"]/u.test(rawMessage);
  if (entry?.level !== 'error' && !(entry?.level === 'warn' && isStyledComponentsInstanceWarning)) {
    return;
  }
  if (!isStyledComponentsInstanceWarning && isPreviewInspectorNonFatalReactDiagnostic(rawMessage)) {
    return;
  }
  const source = typeof entry.source === 'string' ? entry.source : 'runtime';
  // Project code frequently uses console.error for optional bridges, configuration probes, and
  // recoverable API failures. Those entries remain visible in Inspector Console, but only React's
  // boundary/runtime transports can prove that the current commit actually failed.
  if (source === 'console' && !isStyledComponentsInstanceWarning) return;
  initializePreviewInspectorRuntimeHealthState();
  if (!['console', 'preview-runtime', 'react-boundary', 'runtime-fallback', 'target-reachability'].includes(source)) return;
  const message = rawMessage.slice(0, PREVIEW_INSPECTOR_HEALTH_TEXT_LIMIT);
  const key = createPreviewInspectorRuntimeHealthErrorKey(entry);
  const now = Date.now();
  const previousRoot = previewInspectorSession.runtimeHealthRootErrors.get(key);
  const repeatsRecentRoot = !isStyledComponentsInstanceWarning && previousRoot !== undefined &&
    now - previousRoot.timestamp <= PREVIEW_INSPECTOR_HEALTH_ERROR_CHAIN_MS &&
    previousRoot.message === message;
  // Browser error events, React's boundary, and the fallback scope can report the same exception
  // one commit. Keep the first causal record instead of serializing the same stack two to four times.
  if (repeatsRecentRoot) return;
  const componentStack = typeof entry.componentStack === 'string' ? entry.componentStack : '';
  const ownerName = readPreviewInspectorRuntimeHealthErrorOwner(entry, componentStack);
  const targetExportName = typeof entry?.exportName === 'string' && entry.exportName.length > 0
    ? entry.exportName
    : String(previewInspectorSession.selectedExportName ?? '');
  const hasFallbackEvidence = source === 'runtime-fallback' ||
    /(?:ErrorBoundary|ErrorStatus|Fallback|NotFoundStatus)/u.test(componentStack);
  const followsRoot = !isStyledComponentsInstanceWarning && previousRoot !== undefined &&
    now - previousRoot.timestamp <= PREVIEW_INSPECTOR_HEALTH_ERROR_CHAIN_MS &&
    previousRoot.message !== message;
  const event = isStyledComponentsInstanceWarning
    ? 'styled-components-instance-warning'
    : followsRoot
      ? hasFallbackEvidence ? 'runtime-error-fallback' : 'runtime-error-cascade'
      : 'runtime-error-root';
  const parentEventId = followsRoot ? previousRoot.eventId : undefined;
  const healthDetail = {
    componentStack: componentStack.slice(0, PREVIEW_INSPECTOR_HEALTH_TEXT_LIMIT),
    confidence: isStyledComponentsInstanceWarning
      ? 'package-runtime-warning'
      : followsRoot
        ? hasFallbackEvidence ? 'stack-evidenced' : 'temporal'
        : 'root',
    location: typeof entry.location === 'string' ? entry.location : undefined,
    message,
    phase: typeof entry.phase === 'string' ? entry.phase : undefined,
    source,
    stack: typeof entry.stack === 'string'
      ? entry.stack.slice(0, PREVIEW_INSPECTOR_HEALTH_TEXT_LIMIT)
      : undefined,
  };
  const eventId = recordPreviewInspectorRuntimeHealth({
    category: 'runtime-error',
    detail: healthDetail,
    event,
    parentEventId,
  });
  if (followsRoot && hasFallbackEvidence && previousRoot !== undefined) {
    previewInspectorSession.runtimeHealthRootErrors.set(key, {
      ...previousRoot,
      fallbackEventId: eventId,
      fallbackOwnerName: ownerName,
      fallbackTimestamp: now,
    });
  }
  if (!isStyledComponentsInstanceWarning && !followsRoot && eventId !== undefined) {
    const errorRecord = {
      componentStack: componentStack.slice(0, PREVIEW_INSPECTOR_HEALTH_TEXT_LIMIT),
      details: typeof entry.details === 'string'
        ? entry.details.slice(0, PREVIEW_INSPECTOR_HEALTH_TEXT_LIMIT)
        : undefined,
      eventId,
      location: typeof entry.location === 'string'
        ? entry.location.slice(0, PREVIEW_INSPECTOR_HEALTH_TEXT_LIMIT)
        : undefined,
      message,
      ownerName,
      phase: typeof entry.phase === 'string' ? entry.phase.slice(0, 240) : undefined,
      source,
      stack: typeof entry.stack === 'string'
        ? entry.stack.slice(0, PREVIEW_INSPECTOR_HEALTH_TEXT_LIMIT)
        : undefined,
      timestamp: now,
    };
    previewInspectorSession.runtimeHealthRootErrors.set(key, errorRecord);
    demotePreviewInspectorReachedTargetAfterRuntimeError(targetExportName, errorRecord);
    if (previewInspectorSession.runtimeHealthRootErrors.size > PREVIEW_INSPECTOR_HEALTH_ERROR_ROOT_LIMIT) {
      previewInspectorSession.runtimeHealthRootErrors.delete(
        previewInspectorSession.runtimeHealthRootErrors.keys().next().value,
      );
    }
  }
  try {
    if (
      previewInspectorRuntimeHealthDeferredAssistanceEvents.has(event) &&
      typeof schedulePreviewInspectorAutomaticNeuralAssistanceFromHealth === 'function'
    ) {
      const scheduled = schedulePreviewInspectorAutomaticNeuralAssistanceFromHealth(
        event,
        healthDetail,
      );
      if (scheduled !== true) {
        schedulePreviewInspectorRuntimeHealthErrorAssistanceRetry(event, healthDetail);
      }
    }
  } catch {
    /* Automatic assistance starts only after the exact error blocker has committed. */
  }
}
`;
}
