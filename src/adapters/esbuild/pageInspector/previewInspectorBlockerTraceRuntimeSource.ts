/**
 * Generates the browser-side chronological trace recorder for deterministic blocker resolution.
 *
 * The recorder observes enriched blocker-tree snapshots, explicit Auto/Smart decisions, and the
 * next warning or error without retaining project objects. It posts bounded plain data to the
 * extension host, where committed-graph authorization and source excerpt reads are performed.
 */

/**
 * Creates browser source for blocker discovery, Auto decision, render-diff, and error correlation.
 *
 * Expected lexical bindings include `previewInspectorSession`, `previewInspectorPostHostMessage`,
 * and the selected descriptor helpers declared by the composed Page Inspector runtime.
 *
 * @returns Plain JavaScript source concatenated before project modules are imported.
 */
export function createPreviewInspectorBlockerTraceRuntimeSource(): string {
  return String.raw`
const PREVIEW_INSPECTOR_BLOCKER_TRACE_RECORD_LIMIT = 256;
const PREVIEW_INSPECTOR_BLOCKER_TRACE_ACTIVE_WINDOW_MS = 5_000;
const PREVIEW_INSPECTOR_BLOCKER_TRACE_SETTLED_ERROR_GRACE_MS = 1_000;
const PREVIEW_INSPECTOR_BLOCKER_TRACE_DECISION_DEDUPE_MS = 30_000;
const PREVIEW_INSPECTOR_BLOCKER_TRACE_RESOLUTION_STABILITY_MS = 120;
const PREVIEW_INSPECTOR_BLOCKER_TRACE_TEXT_LIMIT = 4_000;

/** Lazily initializes non-persisted chronological state for one pinned webview session. */
function initializePreviewInspectorBlockerTraceState() {
  if (!(previewInspectorSession.blockerTraceRecords instanceof Map)) {
    previewInspectorSession.blockerTraceRecords = new Map();
  }
  if (!(previewInspectorSession.blockerTraceDecisionFingerprints instanceof Map)) {
    previewInspectorSession.blockerTraceDecisionFingerprints = new Map();
  }
  if (!(previewInspectorSession.blockerTraceErrorFingerprints instanceof Map)) {
    previewInspectorSession.blockerTraceErrorFingerprints = new Map();
  }
  if (!(previewInspectorSession.blockerTracePendingResolutions instanceof Map)) {
    previewInspectorSession.blockerTracePendingResolutions = new Map();
  }
  if (!Number.isSafeInteger(previewInspectorSession.blockerTraceEventSequence)) {
    previewInspectorSession.blockerTraceEventSequence = 0;
  }
  if (!Number.isSafeInteger(previewInspectorSession.blockerTraceIdentitySequence)) {
    previewInspectorSession.blockerTraceIdentitySequence = 0;
  }
}

/** Requests one later tree observation so a disappearing error boundary is not called resolved. */
function schedulePreviewInspectorBlockerTraceResolutionCheck() {
  if (
    previewInspectorSession.blockerTraceResolutionCheckScheduled === true ||
    typeof globalThis.setTimeout !== 'function'
  ) return;
  previewInspectorSession.blockerTraceResolutionCheckScheduled = true;
  globalThis.setTimeout(() => {
    previewInspectorSession.blockerTraceResolutionCheckScheduled = false;
    schedulePreviewInspectorTreeRefresh();
  }, PREVIEW_INSPECTOR_BLOCKER_TRACE_RESOLUTION_STABILITY_MS);
}

/** Creates a monotonic attempt identity local to the immutable pinned preview target. */
function createPreviewInspectorBlockerTraceId() {
  initializePreviewInspectorBlockerTraceState();
  previewInspectorSession.blockerTraceIdentitySequence += 1;
  return 'blocker-trace-' + String(previewInspectorSession.blockerTraceIdentitySequence);
}

/** Returns selected preview identity without retaining descriptor or page-candidate objects. */
function readPreviewInspectorBlockerTraceTarget() {
  return {
    exportName:
      typeof previewInspectorSession.selectedExportName === 'string'
        ? previewInspectorSession.selectedExportName
        : undefined,
    pageCandidateId:
      typeof previewInspectorSession.selectedPageCandidateId === 'string'
        ? previewInspectorSession.selectedPageCandidateId
        : undefined,
    renderScenario:
      typeof previewInspectorSession.renderScenario === 'string'
        ? previewInspectorSession.renderScenario
        : undefined,
    revision:
      typeof previewEntryRevision === 'number' && Number.isSafeInteger(previewEntryRevision)
        ? previewEntryRevision
        : 0,
  };
}

/** Posts one bounded event without allowing diagnostic delivery to affect project rendering. */
function postPreviewInspectorBlockerTraceEvent(event, traceId, fields = {}) {
  if (typeof previewInspectorPostHostMessage !== 'function') return;
  initializePreviewInspectorBlockerTraceState();
  previewInspectorSession.blockerTraceEventSequence += 1;
  const message = {
    event: {
      ...fields,
      event,
      sequence: previewInspectorSession.blockerTraceEventSequence,
      target: readPreviewInspectorBlockerTraceTarget(),
      timestamp: new Date().toISOString(),
      traceId,
    },
    type: 'react-preview-blocker-trace',
  };
  try {
    const delivery = previewInspectorPostHostMessage(message);
    if (delivery !== null && typeof delivery === 'object' && typeof delivery.catch === 'function') {
      delivery.catch(() => undefined);
    }
  } catch {
    /* Blocker diagnostics must never become a new render blocker. */
  }
}

/** Reads one own data property without invoking project getters or proxy fallbacks. */
function readPreviewInspectorBlockerTraceOwnValue(value, propertyName) {
  if ((typeof value !== 'object' && typeof value !== 'function') || value === null) {
    return undefined;
  }
  try {
    const descriptor = Object.getOwnPropertyDescriptor(value, propertyName);
    return descriptor !== undefined && 'value' in descriptor ? descriptor.value : undefined;
  } catch {
    return undefined;
  }
}

/** Copies arbitrary internal records into small JSON-compatible diagnostic values. */
function copyPreviewInspectorBlockerTraceValue(
  value,
  depth = 0,
  state = { nodes: 0, seen: new WeakSet() },
) {
  state.nodes += 1;
  if (state.nodes > 384) return '[Node limit]';
  if (typeof value === 'string') return value.slice(0, PREVIEW_INSPECTOR_BLOCKER_TRACE_TEXT_LIMIT);
  if (value === null || typeof value === 'boolean') return value;
  if (typeof value === 'number') return Number.isFinite(value) ? value : String(value);
  if (value === undefined) return '[undefined]';
  if (typeof value === 'bigint') return String(value) + 'n';
  if (typeof value === 'symbol') return '[Symbol]';
  if (typeof value === 'function') {
    const name = readPreviewInspectorBlockerTraceOwnValue(value, 'name');
    return '[Function' + (typeof name === 'string' && name.length > 0 ? ' ' + name : '') + ']';
  }
  if (typeof value !== 'object') return '[' + typeof value + ']';
  if (state.seen.has(value)) return '[Circular]';
  if (depth >= 5) return '[Depth limit]';
  state.seen.add(value);
  let isArray = false;
  try { isArray = Array.isArray(value); } catch { return '[Uninspectable]'; }
  if (isArray) {
    const result = [];
    const length = Math.min(Number.isSafeInteger(value.length) ? value.length : 0, 48);
    for (let index = 0; index < length; index += 1) {
      result.push(copyPreviewInspectorBlockerTraceValue(value[index], depth + 1, state));
    }
    if (value.length > length) result.push('[Truncated]');
    return result;
  }
  let keys;
  try { keys = Object.keys(value).slice(0, 48); } catch { return '[Uninspectable]'; }
  const result = {};
  for (const propertyName of keys) {
    if (blockedInspectorPropNames.has(propertyName)) continue;
    const propertyValue = readPreviewInspectorBlockerTraceOwnValue(value, propertyName);
    result[propertyName] = copyPreviewInspectorBlockerTraceValue(
      propertyValue,
      depth + 1,
      state,
    );
  }
  return result;
}

/** Keeps only absolute authored JS/TS locations; the host performs the authoritative graph check. */
function createPreviewInspectorBlockerTraceSource(value) {
  const sourcePath =
    typeof value?.sourcePath === 'string'
      ? value.sourcePath
      : typeof value?.path === 'string'
        ? value.path
        : '';
  const absolute = sourcePath.startsWith('/') || /^[A-Za-z]:[\\/]/u.test(sourcePath);
  if (!absolute) return undefined;
  const source = { sourcePath };
  if (Number.isSafeInteger(value?.line) && value.line > 0) source.line = value.line;
  if (Number.isSafeInteger(value?.column) && value.column > 0 && source.line !== undefined) {
    source.column = value.column;
  }
  if (Number.isSafeInteger(value?.occurrenceStart) && value.occurrenceStart >= 0) {
    source.occurrenceStart = value.occurrenceStart;
  }
  return source;
}

/** Converts one enriched tree blocker into a stable, source-backed diagnostic record. */
function createPreviewInspectorBlockerTraceRecord(node) {
  const blocker = node?.blocker;
  const source = createPreviewInspectorBlockerTraceSource(
    node?.source ?? {
      column: blocker?.column,
      line: blocker?.line,
      occurrenceStart: blocker?.occurrenceStart,
      sourcePath: blocker?.sourcePath,
    },
  );
  const diagnosticState =
    node?.blockerKind === 'target-reachability'
      ? node?.state
      : node?.blockerKind === 'runtime-fallback'
        ? { error: blocker?.error, reason: blocker?.reason }
        : node?.blockerKind === 'target-error'
          ? { error: blocker?.headline, requiredPaths: blocker?.requiredPaths }
          : undefined;
  return {
    id: String(node?.blockerId ?? node?.id ?? 'unknown-blocker').slice(0, 160),
    kind: String(node?.blockerKind ?? node?.kind ?? 'blocker').slice(0, 120),
    name: String(node?.name ?? 'Render blocker').slice(0, PREVIEW_INSPECTOR_BLOCKER_TRACE_TEXT_LIMIT),
    ownerName:
      typeof blocker?.ownerName === 'string'
        ? blocker.ownerName
        : typeof node?.ownerExportName === 'string'
          ? node.ownerExportName
          : undefined,
    ...(source === undefined ? {} : { source }),
    summary: copyPreviewInspectorBlockerTraceValue({
      active: typeof isPreviewInspectorBlockingNode === 'function'
        ? isPreviewInspectorBlockingNode(node)
        : true,
      props: node?.props,
      state: diagnosticState,
    }),
  };
}

/** Collects blocker pseudo-nodes without retaining Fiber/component tree references. */
function collectPreviewInspectorBlockerTraceRecords(nodes, records = new Map(), depth = 0) {
  if (!Array.isArray(nodes) || depth > 80 || records.size >= PREVIEW_INSPECTOR_BLOCKER_TRACE_RECORD_LIMIT) {
    return records;
  }
  for (const node of nodes) {
    if (node?.kind === 'blocker' && typeof node?.blockerKind === 'string') {
      const record = createPreviewInspectorBlockerTraceRecord(node);
      records.set(record.id, record);
      if (records.size >= PREVIEW_INSPECTOR_BLOCKER_TRACE_RECORD_LIMIT) break;
    }
    collectPreviewInspectorBlockerTraceRecords(node?.children, records, depth + 1);
  }
  return records;
}

/** Creates a stable comparison string from an already bounded blocker record. */
function fingerprintPreviewInspectorBlockerTraceRecord(record) {
  try { return JSON.stringify(record); } catch { return String(record?.id ?? 'blocker'); }
}

/**
 * Emits initial discoveries and one blocker-set diff after Auto/Smart remounts.
 * Repeated records are ignored, except for the bounded observations needed to confirm resolution.
 */
function publishPreviewInspectorBlockerTraceSnapshot(snapshot) {
  initializePreviewInspectorBlockerTraceState();
  const previous = previewInspectorSession.blockerTraceRecords;
  const next = collectPreviewInspectorBlockerTraceRecords(snapshot?.roots);
  const pendingResolutions = previewInspectorSession.blockerTracePendingResolutions;
  const pendingBeforeSnapshot = new Map(pendingResolutions);
  const newlyMissingBlockerIds = [...previous.keys()].filter((id) => !next.has(id));
  for (const blockerId of newlyMissingBlockerIds) {
    if (pendingResolutions.has(blockerId)) continue;
    pendingResolutions.set(blockerId, {
      missingAt: Date.now(),
      missingSnapshots: 1,
      record: previous.get(blockerId),
    });
  }
  const resolvedBlockerIds = [];
  for (const [blockerId, pending] of [...pendingResolutions]) {
    if (next.has(blockerId)) {
      pendingResolutions.delete(blockerId);
      continue;
    }
    if (!newlyMissingBlockerIds.includes(blockerId)) pending.missingSnapshots += 1;
    if (
      pending.missingSnapshots >= 2 &&
      Date.now() - pending.missingAt >= PREVIEW_INSPECTOR_BLOCKER_TRACE_RESOLUTION_STABILITY_MS
    ) {
      resolvedBlockerIds.push(blockerId);
      pendingResolutions.delete(blockerId);
    }
  }
  if (pendingResolutions.size > 0) schedulePreviewInspectorBlockerTraceResolutionCheck();
  const remainingBlockerIds = [
    ...new Set([...next.keys(), ...pendingResolutions.keys()]),
  ];
  const discoveredBlockerIds = [...next.keys()].filter(
    (id) => !previous.has(id) && !pendingBeforeSnapshot.has(id),
  );
  const changedBlockerIds = [...next.keys()].filter((id) =>
    (previous.has(id) || pendingBeforeSnapshot.has(id)) &&
    fingerprintPreviewInspectorBlockerTraceRecord(
      previous.get(id) ?? pendingBeforeSnapshot.get(id)?.record,
    ) !==
      fingerprintPreviewInspectorBlockerTraceRecord(next.get(id)),
  );
  if (
    discoveredBlockerIds.length === 0 &&
    resolvedBlockerIds.length === 0 &&
    changedBlockerIds.length === 0 &&
    newlyMissingBlockerIds.length === 0
  ) {
    previewInspectorSession.blockerTraceRecords = next;
    return;
  }

  const activeAttempt = previewInspectorSession.blockerTraceActiveAttempt;
  const active = activeAttempt !== undefined &&
    activeAttempt.settledAt === undefined &&
    Date.now() - activeAttempt.startedAt <= PREVIEW_INSPECTOR_BLOCKER_TRACE_ACTIVE_WINDOW_MS;
  if (active || resolvedBlockerIds.length > 0) {
    const traceId = active ? activeAttempt.traceId : createPreviewInspectorBlockerTraceId();
    postPreviewInspectorBlockerTraceEvent('render-result', traceId, {
      ...(activeAttempt?.blocker === undefined ? {} : { blocker: activeAttempt.blocker }),
      result: {
        changedBlockerIds,
        discoveredBlockerIds,
        remainingBlockerIds,
        resolvedBlockerIds,
      },
    });
  }
  if (active) {
    activeAttempt.settledAt = Date.now();
    if (typeof recordPreviewInspectorRuntimeHealth === 'function') {
      recordPreviewInspectorRuntimeHealth({
        category: 'render-attempt',
        detail: {
          changedBlockerIds,
          discoveredBlockerIds,
          remainingBlockerIds,
          resolvedBlockerIds,
          traceId: activeAttempt.traceId,
        },
        event: 'render-attempt-settled',
      });
    }
  }
  for (const blockerId of discoveredBlockerIds) {
    postPreviewInspectorBlockerTraceEvent(
      'blocker-discovered',
      createPreviewInspectorBlockerTraceId(),
      { blocker: next.get(blockerId) },
    );
  }
  for (const blockerId of changedBlockerIds) {
    postPreviewInspectorBlockerTraceEvent(
      'blocker-updated',
      active ? activeAttempt.traceId : createPreviewInspectorBlockerTraceId(),
      { blocker: next.get(blockerId) },
    );
  }
  previewInspectorSession.blockerTraceRecords = next;
}

/** Builds a blocker record for an Auto decision that occurred before the next tree snapshot. */
function createPreviewInspectorBlockerTraceDecisionRecord(candidate) {
  initializePreviewInspectorBlockerTraceState();
  const blockerId = String(candidate?.blockerId ?? 'automatic-resolver').slice(0, 160);
  const existing = previewInspectorSession.blockerTraceRecords.get(blockerId);
  if (existing !== undefined) return existing;
  const source = createPreviewInspectorBlockerTraceSource(candidate);
  return {
    id: blockerId,
    kind: String(candidate?.blockerKind ?? 'automatic-resolver').slice(0, 120),
    name: String(candidate?.blockerName ?? candidate?.action ?? 'Automatic blocker decision')
      .slice(0, PREVIEW_INSPECTOR_BLOCKER_TRACE_TEXT_LIMIT),
    ownerName: typeof candidate?.ownerName === 'string' ? candidate.ownerName : undefined,
    ...(source === undefined ? {} : { source }),
    summary: copyPreviewInspectorBlockerTraceValue(candidate?.summary ?? {}),
  };
}

/** Records one Auto/Smart selection and starts correlation only when it schedules a new commit. */
function recordPreviewInspectorBlockerAutoDecision(candidate = {}) {
  initializePreviewInspectorBlockerTraceState();
  const blocker = createPreviewInspectorBlockerTraceDecisionRecord(candidate);
  const generatedPaths = Array.isArray(candidate?.generatedPaths)
    ? candidate.generatedPaths.filter((value) => typeof value === 'string').slice(0, 128)
    : [];
  const auto = {
    action: String(candidate?.action ?? 'automatic blocker resolution')
      .slice(0, PREVIEW_INSPECTOR_BLOCKER_TRACE_TEXT_LIMIT),
    generatedPaths,
    mode: String(candidate?.mode ?? 'auto').slice(0, 120),
    reason:
      typeof candidate?.reason === 'string'
        ? candidate.reason.slice(0, PREVIEW_INSPECTOR_BLOCKER_TRACE_TEXT_LIMIT)
        : undefined,
    selectedValue: copyPreviewInspectorBlockerTraceValue(candidate?.selectedValue),
    startsRenderAttempt: candidate?.startsRenderAttempt === true,
  };
  const fingerprint = fingerprintPreviewInspectorBlockerTraceRecord({ auto, blocker });
  const previousAt = previewInspectorSession.blockerTraceDecisionFingerprints.get(fingerprint);
  const now = Date.now();
  if (
    typeof previousAt === 'number' &&
    now - previousAt < PREVIEW_INSPECTOR_BLOCKER_TRACE_DECISION_DEDUPE_MS
  ) return undefined;
  previewInspectorSession.blockerTraceDecisionFingerprints.set(fingerprint, now);
  if (previewInspectorSession.blockerTraceDecisionFingerprints.size > 256) {
    previewInspectorSession.blockerTraceDecisionFingerprints.delete(
      previewInspectorSession.blockerTraceDecisionFingerprints.keys().next().value,
    );
  }
  const traceId = createPreviewInspectorBlockerTraceId();
  postPreviewInspectorBlockerTraceEvent('auto-selection', traceId, { auto, blocker });
  if (auto.startsRenderAttempt) {
    previewInspectorSession.blockerTraceActiveAttempt = { blocker, startedAt: now, traceId };
  }
  if (auto.startsRenderAttempt && typeof recordPreviewInspectorRuntimeHealth === 'function') {
    recordPreviewInspectorRuntimeHealth({
      category: 'render-attempt',
      detail: {
        blockerId: blocker.id,
        mode: auto.mode,
        traceId,
      },
      event: 'render-attempt-started',
    });
  }
  return traceId;
}

/** Correlates the next fatal error with the most recent commit-producing Auto attempt. */
function recordPreviewInspectorBlockerTraceError(entry) {
  initializePreviewInspectorBlockerTraceState();
  if (entry?.level !== 'error') return;
  if (
    typeof isPreviewInspectorNonFatalReactDiagnostic === 'function' &&
    isPreviewInspectorNonFatalReactDiagnostic(String(entry?.message ?? ''))
  ) return;
  if (!['preview-runtime', 'react-boundary', 'runtime-fallback', 'target-reachability'].includes(entry.source)) {
    return;
  }
  const activeAttempt = previewInspectorSession.blockerTraceActiveAttempt;
  const now = Date.now();
  const active = activeAttempt !== undefined &&
    now - activeAttempt.startedAt <= PREVIEW_INSPECTOR_BLOCKER_TRACE_ACTIVE_WINDOW_MS &&
    (
      activeAttempt.settledAt === undefined ||
      now - activeAttempt.settledAt <= PREVIEW_INSPECTOR_BLOCKER_TRACE_SETTLED_ERROR_GRACE_MS
    );
  const fingerprint = [
    active ? activeAttempt.traceId : '',
    entry.level,
    entry.source,
    entry.message,
    entry.details,
  ].join('\0');
  if (previewInspectorSession.blockerTraceErrorFingerprints.has(fingerprint)) return;
  previewInspectorSession.blockerTraceErrorFingerprints.set(fingerprint, Date.now());
  if (previewInspectorSession.blockerTraceErrorFingerprints.size > 256) {
    previewInspectorSession.blockerTraceErrorFingerprints.delete(
      previewInspectorSession.blockerTraceErrorFingerprints.keys().next().value,
    );
  }
  postPreviewInspectorBlockerTraceEvent(
    'subsequent-error',
    active ? activeAttempt.traceId : createPreviewInspectorBlockerTraceId(),
    {
      ...(!active || activeAttempt.blocker === undefined ? {} : { blocker: activeAttempt.blocker }),
      error: {
        details: typeof entry.details === 'string' ? entry.details : undefined,
        exportName: typeof entry.exportName === 'string' ? entry.exportName : undefined,
        level: entry.level,
        location: typeof entry.location === 'string' ? entry.location : undefined,
        message: String(entry.message ?? '[' + entry.level + ']'),
        phase: typeof entry.phase === 'string' ? entry.phase : undefined,
        source: typeof entry.source === 'string' ? entry.source : 'console',
      },
    },
  );
}
`;
}
