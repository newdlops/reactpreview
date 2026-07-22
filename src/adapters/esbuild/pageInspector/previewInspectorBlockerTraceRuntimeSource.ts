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
const PREVIEW_INSPECTOR_BLOCKER_TRACE_ATTEMPT_SETTLEMENT_MS = 320;
const PREVIEW_INSPECTOR_BLOCKER_TRACE_PENDING_SETTLEMENT_LIMIT_MS = 960;
const PREVIEW_INSPECTOR_BLOCKER_TRACE_RESOLUTION_STABILITY_MS = 320;
const PREVIEW_INSPECTOR_BLOCKER_TRACE_RESOLUTION_SNAPSHOT_COUNT = 3;
const PREVIEW_INSPECTOR_BLOCKER_TRACE_TEXT_LIMIT = 4_000;
const PREVIEW_INSPECTOR_BLOCKER_TRACE_BATCH_DETAIL_LIMIT = 24;

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
  if (!(previewInspectorSession.blockerTraceRecentFatalErrors instanceof Map)) {
    previewInspectorSession.blockerTraceRecentFatalErrors = new Map();
  }
  if (!(previewInspectorSession.blockerTracePendingResolutions instanceof Map)) {
    previewInspectorSession.blockerTracePendingResolutions = new Map();
  }
  if (!(previewInspectorSession.blockerTracePendingAutoDecisions instanceof Map)) {
    previewInspectorSession.blockerTracePendingAutoDecisions = new Map();
  }
  if (!Number.isSafeInteger(previewInspectorSession.blockerTraceEventSequence)) {
    previewInspectorSession.blockerTraceEventSequence = 0;
  }
  if (!Number.isSafeInteger(previewInspectorSession.blockerTraceIdentitySequence)) {
    previewInspectorSession.blockerTraceIdentitySequence = 0;
  }
}

/**
 * Retains only fatal errors that the latest committed blocker tree still represents.
 *
 * A timestamp-only cache incorrectly treated a recently resolved error as an active baseline. A
 * later Auto gate could then reproduce the same message without being rolled back. Target-error and
 * non-editable runtime-global nodes are the snapshot's authoritative evidence of a mounted failure.
 */
function reconcilePreviewInspectorBlockerTraceFatalErrors(records) {
  const activeTargetErrors = [...records.values()].filter(
    (record) => record?.kind === 'target-error' || record?.kind === 'runtime-global',
  );
  for (const [fingerprint, fatalError] of previewInspectorSession.blockerTraceRecentFatalErrors) {
    const stillActive = activeTargetErrors.some((record) => {
      const headline = record?.summary?.state?.error;
      const sameOwner = typeof fatalError?.exportName !== 'string' ||
        record?.ownerName === fatalError.exportName;
      return sameOwner && typeof headline === 'string' &&
        headline.includes(String(fatalError?.message ?? ''));
    });
    if (!stillActive) previewInspectorSession.blockerTraceRecentFatalErrors.delete(fingerprint);
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

/**
 * Closes one commit-producing attempt exactly once.
 *
 * Auto decisions can be coalesced by React before a tree snapshot is observable. Explicitly
 * settling a superseded attempt keeps diagnostics causal and prevents a later error from being
 * attached to a render that the browser never committed.
 */
function settlePreviewInspectorBlockerTraceAttempt(attempt, detail) {
  if (attempt === undefined || attempt.settledAt !== undefined) return false;
  attempt.settledAt = Date.now();
  if (typeof recordPreviewInspectorRuntimeHealth === 'function') {
    recordPreviewInspectorRuntimeHealth({
      category: 'render-attempt',
      detail: { ...detail, traceId: attempt.traceId },
      event: 'render-attempt-settled',
    });
  }
  if (typeof schedulePreviewInspectorTargetReachabilityResumeAfterAutoAttempt === 'function') {
    schedulePreviewInspectorTargetReachabilityResumeAfterAutoAttempt(attempt);
  } else if (typeof resumePreviewInspectorTargetReachabilityAfterConditionAttempt === 'function') {
    if (
      ['target-guided-auto', 'target-overlay-auto'].includes(attempt.autoMode) &&
      typeof globalThis.setTimeout === 'function'
    ) {
      globalThis.setTimeout(
        () => resumePreviewInspectorTargetReachabilityAfterConditionAttempt(attempt),
        PREVIEW_INSPECTOR_TARGET_CONDITION_SETTLED_GRACE_MS,
      );
    } else {
      resumePreviewInspectorTargetReachabilityAfterConditionAttempt(attempt);
    }
  }
  return true;
}

/** Adds bounded blocker identities to one open attempt's eventual single commit result. */
function accumulatePreviewInspectorBlockerTraceAttemptIds(attempt, field, blockerIds) {
  if (attempt === undefined || attempt.settledAt !== undefined || !Array.isArray(blockerIds)) return;
  if (!(attempt[field] instanceof Set)) attempt[field] = new Set();
  for (const blockerId of blockerIds) {
    if (attempt[field].size >= PREVIEW_INSPECTOR_BLOCKER_TRACE_RECORD_LIMIT) break;
    if (typeof blockerId === 'string') attempt[field].add(blockerId);
  }
}

/** Reads one attempt accumulator without exposing its mutable Set to host diagnostics. */
function readPreviewInspectorBlockerTraceAttemptIds(attempt, field) {
  return attempt?.[field] instanceof Set ? [...attempt[field]] : [];
}

/**
 * Atomically settles and publishes one commit-producing attempt exactly once.
 *
 * Marking the attempt settled before posting prevents a synchronous host callback or duplicate
 * tree observation from emitting a second terminal result for the same Auto decision.
 */
function completePreviewInspectorBlockerTraceAttempt(
  attempt,
  result,
  settlementDetail = result,
) {
  if (!settlePreviewInspectorBlockerTraceAttempt(attempt, settlementDetail)) return false;
  postPreviewInspectorBlockerTraceEvent('render-result', attempt.traceId, {
    ...(attempt.blocker === undefined ? {} : { blocker: attempt.blocker }),
    result,
  });
  return true;
}

/** Retains the logical target blocker until the attempt's exact page corridor proves output. */
function readPreviewInspectorBlockerTracePendingTargetId(attempt) {
  const reachabilityKey = attempt?.targetReachabilityKey;
  if (typeof reachabilityKey !== 'string' || reachabilityKey.length === 0) return undefined;
  const state = previewInspectorSession.targetReachabilityByKey?.get?.(reachabilityKey);
  const reachedTarget = state?.status === 'reached' || state?.targetHasOutput === true;
  return reachedTarget ? undefined : 'target-reachability:' + reachabilityKey;
}

/** Reads the latest conservative blocker set when an attempt's bounded wait expires. */
function readPreviewInspectorBlockerTraceRemainingIds(attempt) {
  const remainingIds = Array.isArray(attempt?.lastRemainingBlockerIds)
    ? [...attempt.lastRemainingBlockerIds]
    : [
        ...previewInspectorSession.blockerTraceRecords.keys(),
        ...previewInspectorSession.blockerTracePendingResolutions.keys(),
      ];
  const pendingTargetId = readPreviewInspectorBlockerTracePendingTargetId(attempt);
  if (pendingTargetId !== undefined) remainingIds.push(pendingTargetId);
  return [...new Set(remainingIds)];
}

/** Builds the single terminal result from all snapshots observed during one render attempt. */
function createPreviewInspectorBlockerTraceAttemptResult(attempt, outcome = 'committed') {
  return {
    changedBlockerIds: readPreviewInspectorBlockerTraceAttemptIds(
      attempt,
      'changedBlockerIds',
    ),
    discoveredBlockerIds: readPreviewInspectorBlockerTraceAttemptIds(
      attempt,
      'discoveredBlockerIds',
    ),
    outcome,
    remainingBlockerIds: readPreviewInspectorBlockerTraceRemainingIds(attempt),
    resolvedBlockerIds: readPreviewInspectorBlockerTraceAttemptIds(
      attempt,
      'resolvedBlockerIds',
    ),
  };
}

/**
 * Gives React one bounded stabilization window before committing a no-diff or stale observation.
 *
 * A disappearing blocker or lone stale observation receives two additional short windows so a
 * later remount can provide stable evidence. The hard deadline still closes the trace when no tree
 * refresh ever arrives, preventing an orphaned Auto record from owning unrelated errors.
 */
function schedulePreviewInspectorBlockerTraceAttemptSettlement(attempt, delayMs) {
  if (
    attempt === undefined ||
    attempt.settledAt !== undefined ||
    attempt.settlementScheduled === true ||
    typeof globalThis.setTimeout !== 'function'
  ) return;
  attempt.settlementScheduled = true;
  globalThis.setTimeout(() => {
    attempt.settlementScheduled = false;
    if (attempt.settledAt !== undefined) return;
    const age = Date.now() - attempt.startedAt;
    const hasObservableDiff = [
      'changedBlockerIds',
      'discoveredBlockerIds',
      'resolvedBlockerIds',
    ].some((field) => attempt[field] instanceof Set && attempt[field].size > 0);
    const awaitsStableObservation =
      !hasObservableDiff &&
      (!Number.isSafeInteger(attempt.observedSnapshotCount) ||
        attempt.observedSnapshotCount < 2);
    const awaitsResolution = [...previewInspectorSession.blockerTracePendingResolutions.values()]
      .some((pending) => pending.attemptTraceId === attempt.traceId);
    if (
      (awaitsResolution || awaitsStableObservation) &&
      age < PREVIEW_INSPECTOR_BLOCKER_TRACE_PENDING_SETTLEMENT_LIMIT_MS
    ) {
      schedulePreviewInspectorTreeRefresh();
      schedulePreviewInspectorBlockerTraceAttemptSettlement(
        attempt,
        Math.min(
          PREVIEW_INSPECTOR_BLOCKER_TRACE_ATTEMPT_SETTLEMENT_MS,
          PREVIEW_INSPECTOR_BLOCKER_TRACE_PENDING_SETTLEMENT_LIMIT_MS - age,
        ),
      );
      return;
    }
    completePreviewInspectorBlockerTraceAttempt(
      attempt,
      createPreviewInspectorBlockerTraceAttemptResult(attempt),
    );
  }, Math.max(0, delayMs));
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
    ...readPreviewInspectorRuntimeCorrelation(),
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
  state = { limit: 384, nodes: 0, seen: new WeakSet() },
) {
  state.nodes += 1;
  if (state.nodes > state.limit) return '[Node limit]';
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
        : node?.blockerKind === 'target-error' || node?.blockerKind === 'runtime-global'
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

/** Collects only unresolved blocker pseudo-nodes without retaining Fiber/component references. */
function collectPreviewInspectorBlockerTraceRecords(nodes, records = new Map(), depth = 0) {
  if (!Array.isArray(nodes) || depth > 80 || records.size >= PREVIEW_INSPECTOR_BLOCKER_TRACE_RECORD_LIMIT) {
    return records;
  }
  for (const node of nodes) {
    if (node?.kind === 'blocker' && typeof node?.blockerKind === 'string') {
      const blocking =
        typeof isPreviewInspectorBlockingNode === 'function'
          ? isPreviewInspectorBlockingNode(node)
          : true;
      if (blocking) {
        const record = createPreviewInspectorBlockerTraceRecord(node);
        records.set(record.id, record);
        if (records.size >= PREVIEW_INSPECTOR_BLOCKER_TRACE_RECORD_LIMIT) break;
      }
    }
    collectPreviewInspectorBlockerTraceRecords(node?.children, records, depth + 1);
  }
  return records;
}

/** Creates a stable comparison string from an already bounded blocker record. */
function fingerprintPreviewInspectorBlockerTraceRecord(record) {
  try { return JSON.stringify(record); } catch { return String(record?.id ?? 'blocker'); }
}

/** Reduces a group to one source-backed record while retaining bounded member identities. */
function createPreviewInspectorBlockerTraceBatchRecord(records, label, totalCount = records.length) {
  const first = records[0];
  if (totalCount <= 1 || first === undefined) return first;
  const blockers = records.slice(0, PREVIEW_INSPECTOR_BLOCKER_TRACE_BATCH_DETAIL_LIMIT).map(
    (record) => ({
      id: record.id,
      kind: record.kind,
      name: record.name,
      ownerName: record.ownerName,
      source: record.source,
    }),
  );
  return {
    ...first,
    id: 'batch:' + label + ':' + first.id,
    name: label + ' · ' + String(totalCount) + ' blockers',
    summary: {
      batchCount: totalCount,
      blockers,
      truncatedCount: Math.max(0, totalCount - blockers.length),
    },
  };
}

/** Posts one discovery/update group so host source reads do not scale with tree breadth. */
function postPreviewInspectorBlockerTraceRecordBatch(event, traceId, blockerIds, records) {
  const blockers = blockerIds.map((id) => records.get(id)).filter((record) => record !== undefined);
  const blocker = createPreviewInspectorBlockerTraceBatchRecord(blockers, event);
  if (blocker === undefined) return;
  postPreviewInspectorBlockerTraceEvent(event, traceId, { blocker });
}

/**
 * Emits initial discoveries and one blocker-set diff after Auto/Smart remounts.
 * Repeated records are ignored, except for the bounded observations needed to confirm resolution.
 */
function publishPreviewInspectorBlockerTraceSnapshot(snapshot) {
  initializePreviewInspectorBlockerTraceState();
  flushPreviewInspectorBlockerTraceAutoDecisions();
  const previous = previewInspectorSession.blockerTraceRecords;
  const next = collectPreviewInspectorBlockerTraceRecords(snapshot?.roots);
  reconcilePreviewInspectorBlockerTraceFatalErrors(next);
  const pendingResolutions = previewInspectorSession.blockerTracePendingResolutions;
  const pendingBeforeSnapshot = new Map(pendingResolutions);
  const activeAttempt = previewInspectorSession.blockerTraceActiveAttempt;
  const openAttempt =
    activeAttempt !== undefined && activeAttempt.settledAt === undefined
      ? activeAttempt
      : undefined;
  const newlyMissingBlockerIds = [...previous.keys()].filter((id) => !next.has(id));
  for (const blockerId of newlyMissingBlockerIds) {
    if (pendingResolutions.has(blockerId)) continue;
    pendingResolutions.set(blockerId, {
      attemptTraceId: openAttempt?.traceId,
      missingAt: Date.now(),
      missingSnapshots: 1,
      record: previous.get(blockerId),
    });
  }
  const resolvedBlockerIds = [];
  const standaloneResolvedBlockerIds = [];
  for (const [blockerId, pending] of [...pendingResolutions]) {
    if (next.has(blockerId)) {
      pendingResolutions.delete(blockerId);
      continue;
    }
    if (!newlyMissingBlockerIds.includes(blockerId)) pending.missingSnapshots += 1;
    if (
      pending.missingSnapshots >= PREVIEW_INSPECTOR_BLOCKER_TRACE_RESOLUTION_SNAPSHOT_COUNT &&
      Date.now() - pending.missingAt >= PREVIEW_INSPECTOR_BLOCKER_TRACE_RESOLUTION_STABILITY_MS
    ) {
      if (pending.attemptTraceId === openAttempt?.traceId) {
        resolvedBlockerIds.push(blockerId);
      } else {
        standaloneResolvedBlockerIds.push(blockerId);
      }
      pendingResolutions.delete(blockerId);
    }
  }
  if (pendingResolutions.size > 0) schedulePreviewInspectorBlockerTraceResolutionCheck();
  const remainingBlockerIds = [
    ...new Set([...next.keys(), ...pendingResolutions.keys()]),
  ];
  if (openAttempt !== undefined) {
    openAttempt.lastRemainingBlockerIds = remainingBlockerIds;
    openAttempt.observedSnapshotCount =
      (Number.isSafeInteger(openAttempt.observedSnapshotCount)
        ? openAttempt.observedSnapshotCount
        : 0) + 1;
  }
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
  accumulatePreviewInspectorBlockerTraceAttemptIds(
    openAttempt,
    'changedBlockerIds',
    changedBlockerIds,
  );
  accumulatePreviewInspectorBlockerTraceAttemptIds(
    openAttempt,
    'discoveredBlockerIds',
    discoveredBlockerIds,
  );
  accumulatePreviewInspectorBlockerTraceAttemptIds(
    openAttempt,
    'resolvedBlockerIds',
    resolvedBlockerIds,
  );
  const attemptAwaitsResolution =
    openAttempt !== undefined &&
    [...pendingResolutions.values()].some(
      (pending) => pending.attemptTraceId === openAttempt.traceId,
    );
  const stableAttemptObservation =
    openAttempt !== undefined &&
    openAttempt.observedSnapshotCount >= 2 &&
    Date.now() - openAttempt.startedAt >= PREVIEW_INSPECTOR_BLOCKER_TRACE_ATTEMPT_SETTLEMENT_MS;
  if (
    openAttempt !== undefined &&
    !attemptAwaitsResolution &&
    (resolvedBlockerIds.length > 0 || stableAttemptObservation)
  ) {
    completePreviewInspectorBlockerTraceAttempt(
      openAttempt,
      createPreviewInspectorBlockerTraceAttemptResult(openAttempt),
    );
  }
  if (standaloneResolvedBlockerIds.length > 0) {
    postPreviewInspectorBlockerTraceEvent(
      'render-result',
      createPreviewInspectorBlockerTraceId(),
      {
        result: {
          changedBlockerIds: [],
          discoveredBlockerIds: [],
          outcome: 'committed',
          remainingBlockerIds,
          resolvedBlockerIds: standaloneResolvedBlockerIds,
        },
      },
    );
  }
  postPreviewInspectorBlockerTraceRecordBatch(
    'blocker-discovered',
    createPreviewInspectorBlockerTraceId(),
    discoveredBlockerIds,
    next,
  );
  postPreviewInspectorBlockerTraceRecordBatch(
    'blocker-updated',
    openAttempt?.traceId ?? createPreviewInspectorBlockerTraceId(),
    changedBlockerIds,
    next,
  );
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

/** Emits queued observational Auto decisions as bounded action/mode groups. */
function flushPreviewInspectorBlockerTraceAutoDecisions() {
  initializePreviewInspectorBlockerTraceState();
  previewInspectorSession.blockerTraceAutoDecisionFlushScheduled = false;
  const pending = previewInspectorSession.blockerTracePendingAutoDecisions;
  previewInspectorSession.blockerTracePendingAutoDecisions = new Map();
  for (const group of pending.values()) {
    const entries = group.entries;
    const generatedPaths = [...group.generatedPaths];
    const blocker = createPreviewInspectorBlockerTraceBatchRecord(
      entries.map((entry) => entry.blocker),
      'automatic-resolver',
      group.count,
    );
    postPreviewInspectorBlockerTraceEvent('auto-selection', group.traceId, {
      auto: {
        ...entries[0].auto,
        action: entries[0].auto.action + ' × ' + String(group.count),
        generatedPaths,
        selectedValue: {
          decisionCount: group.count,
          decisions: entries.map((entry) => ({
            blockerId: entry.blocker.id,
            blockerName: entry.blocker.name,
            ownerName: entry.blocker.ownerName,
            selectedValue: entry.auto.selectedValue,
          })),
          truncatedCount: Math.max(0, group.count - entries.length),
        },
      },
      blocker,
    });
  }
}

/** Defers non-committing fallback observations until the current render stack has completed. */
function queuePreviewInspectorBlockerTraceAutoDecision(auto, blocker) {
  initializePreviewInspectorBlockerTraceState();
  const key = auto.mode + '\\0' + auto.action;
  let group = previewInspectorSession.blockerTracePendingAutoDecisions.get(key);
  if (group === undefined) {
    group = {
      count: 0,
      entries: [],
      generatedPaths: new Set(),
      traceId: createPreviewInspectorBlockerTraceId(),
    };
    previewInspectorSession.blockerTracePendingAutoDecisions.set(key, group);
  }
  group.count += 1;
  if (group.entries.length < PREVIEW_INSPECTOR_BLOCKER_TRACE_BATCH_DETAIL_LIMIT) {
    group.entries.push({ auto, blocker });
  }
  for (const generatedPath of auto.generatedPaths) {
    if (group.generatedPaths.size >= 128) break;
    group.generatedPaths.add(generatedPath);
  }
  if (previewInspectorSession.blockerTraceAutoDecisionFlushScheduled !== true) {
    previewInspectorSession.blockerTraceAutoDecisionFlushScheduled = true;
    const schedule = globalThis.queueMicrotask ?? ((callback) => Promise.resolve().then(callback));
    schedule(flushPreviewInspectorBlockerTraceAutoDecisions);
  }
  return group.traceId;
}

/** Records one Auto/Smart selection and starts correlation only when it schedules a new commit. */
function recordPreviewInspectorBlockerAutoDecision(candidate = {}) {
  initializePreviewInspectorBlockerTraceState();
  const blocker = createPreviewInspectorBlockerTraceDecisionRecord(candidate);
  const startsRenderAttempt = candidate?.startsRenderAttempt === true;
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
    selectedValue: copyPreviewInspectorBlockerTraceValue(
      candidate?.selectedValue,
      0,
      { limit: startsRenderAttempt ? 384 : 64, nodes: 0, seen: new WeakSet() },
    ),
    startsRenderAttempt,
  };
  const now = Date.now();
  /* Render retries are causal events even when their generated value is byte-for-byte identical. */
  if (!auto.startsRenderAttempt) {
    const fingerprint = fingerprintPreviewInspectorBlockerTraceRecord({ auto, blocker });
    const previousAt = previewInspectorSession.blockerTraceDecisionFingerprints.get(fingerprint);
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
    return queuePreviewInspectorBlockerTraceAutoDecision(auto, blocker);
  }
  const traceId = createPreviewInspectorBlockerTraceId();
  if (auto.startsRenderAttempt) {
    const supersededAttempt = previewInspectorSession.blockerTraceActiveAttempt;
    if (supersededAttempt !== undefined && supersededAttempt.settledAt === undefined) {
      for (const pending of previewInspectorSession.blockerTracePendingResolutions.values()) {
        if (pending.attemptTraceId === supersededAttempt.traceId) {
          pending.attemptTraceId = traceId;
        }
      }
      const supersededResult = {
        changedBlockerIds: readPreviewInspectorBlockerTraceAttemptIds(
          supersededAttempt,
          'changedBlockerIds',
        ),
        discoveredBlockerIds: readPreviewInspectorBlockerTraceAttemptIds(
          supersededAttempt,
          'discoveredBlockerIds',
        ),
        outcome: 'superseded',
        remainingBlockerIds: readPreviewInspectorBlockerTraceRemainingIds(supersededAttempt),
        resolvedBlockerIds: readPreviewInspectorBlockerTraceAttemptIds(
          supersededAttempt,
          'resolvedBlockerIds',
        ),
      };
      completePreviewInspectorBlockerTraceAttempt(
        supersededAttempt,
        supersededResult,
        { ...supersededResult, supersededByTraceId: traceId },
      );
    }
  }
  postPreviewInspectorBlockerTraceEvent('auto-selection', traceId, { auto, blocker });
  if (auto.startsRenderAttempt) {
    const recentErrorCutoff = now - PREVIEW_INSPECTOR_BLOCKER_TRACE_ACTIVE_WINDOW_MS;
    const knownFatalErrors = new Set();
    for (const [errorFingerprint, fatalError] of previewInspectorSession.blockerTraceRecentFatalErrors) {
      const observedAt = fatalError?.observedAt;
      if (typeof observedAt === 'number' && observedAt >= recentErrorCutoff) {
        knownFatalErrors.add(errorFingerprint);
      } else {
        previewInspectorSession.blockerTraceRecentFatalErrors.delete(errorFingerprint);
      }
    }
    const targetReachabilityKey =
      typeof inferPreviewInspectorTargetAutoAttemptReachabilityKey === 'function'
        ? inferPreviewInspectorTargetAutoAttemptReachabilityKey(candidate, blocker)
        : undefined;
    const attempt = {
      autoMode: auto.mode,
      blocker,
      knownFatalErrors,
      observedSnapshotCount: 0,
      startedAt: now,
      ...(targetReachabilityKey === undefined ? {} : { targetReachabilityKey }),
      traceId,
    };
    previewInspectorSession.blockerTraceActiveAttempt = attempt;
    schedulePreviewInspectorBlockerTraceAttemptSettlement(
      attempt,
      PREVIEW_INSPECTOR_BLOCKER_TRACE_ATTEMPT_SETTLEMENT_MS,
    );
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
  flushPreviewInspectorBlockerTraceAutoDecisions();
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
  const settledErrorGrace = ['target-guided-auto', 'target-overlay-auto'].includes(
    activeAttempt?.autoMode,
  )
    ? PREVIEW_INSPECTOR_TARGET_CONDITION_SETTLED_GRACE_MS
    : PREVIEW_INSPECTOR_BLOCKER_TRACE_SETTLED_ERROR_GRACE_MS;
  const active = activeAttempt !== undefined &&
    now - activeAttempt.startedAt <= PREVIEW_INSPECTOR_BLOCKER_TRACE_ACTIVE_WINDOW_MS &&
    (
      activeAttempt.settledAt === undefined ||
      now - activeAttempt.settledAt <= settledErrorGrace
    );
  const target = readPreviewInspectorBlockerTraceTarget();
  const fatalErrorFingerprint = [
    target.exportName,
    target.pageCandidateId,
    target.renderScenario,
    target.revision,
    entry.level,
    entry.source,
    entry.exportName,
    entry.location,
    entry.phase,
    entry.message,
  ].join('\0');
  const errorWasKnownAtAttemptStart =
    active && activeAttempt.knownFatalErrors instanceof Set &&
    activeAttempt.knownFatalErrors.has(fatalErrorFingerprint);
  previewInspectorSession.blockerTraceRecentFatalErrors.set(fatalErrorFingerprint, {
    exportName:
      typeof entry.exportName === 'string' ? entry.exportName : target.exportName,
    message: String(entry.message ?? '[' + entry.level + ']'),
    observedAt: now,
  });
  while (previewInspectorSession.blockerTraceRecentFatalErrors.size > 256) {
    previewInspectorSession.blockerTraceRecentFatalErrors.delete(
      previewInspectorSession.blockerTraceRecentFatalErrors.keys().next().value,
    );
  }
  const fingerprint = [
    active ? activeAttempt.traceId : '',
    entry.level,
    typeof entry.exportName === 'string' ? entry.exportName : target.exportName,
    entry.message,
  ].join('\0');
  if (previewInspectorSession.blockerTraceErrorFingerprints.has(fingerprint)) return;
  previewInspectorSession.blockerTraceErrorFingerprints.set(fingerprint, Date.now());
  if (previewInspectorSession.blockerTraceErrorFingerprints.size > 256) {
    previewInspectorSession.blockerTraceErrorFingerprints.delete(
      previewInspectorSession.blockerTraceErrorFingerprints.keys().next().value,
    );
  }
  // A target-guided JSX choice is a reversible preview transaction. If that exact render attempt
  // produces a new fatal error, restore authored semantics before the DFS evaluates another gate.
  // Runtime fallback and user-authored mutations intentionally remain outside this narrow hook.
  const rollbackEligible = active && activeAttempt.autoMode === 'target-guided-auto';
  const rolledBack = (
    rollbackEligible &&
    active &&
    !errorWasKnownAtAttemptStart &&
    typeof rollbackPreviewInspectorFailedAutoDecision === 'function'
  ) ? rollbackPreviewInspectorFailedAutoDecision(activeAttempt.traceId) : false;
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
  if (rolledBack && active) {
    completePreviewInspectorBlockerTraceAttempt(
      activeAttempt,
      createPreviewInspectorBlockerTraceAttemptResult(activeAttempt, 'rolled-back'),
      { outcome: 'rolled-back', reason: 'new fatal error' },
    );
  }
}
`;
}
