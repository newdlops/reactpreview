/**
 * Generates the browser-side chronological trace recorder for deterministic blocker resolution.
 *
 * The recorder observes enriched blocker-tree snapshots, explicit Auto/Smart decisions, and the
 * next warning or error without retaining project objects. It posts bounded plain data to the
 * extension host, where committed-graph authorization and source excerpt reads are performed.
 */
import { createPreviewInspectorBlockerTraceRecordRuntimeSource } from './previewInspectorBlockerTraceRecordRuntimeSource';
import { createPreviewInspectorBlockerTraceDecisionRuntimeSource } from './previewInspectorBlockerTraceDecisionRuntimeSource';
import { createPreviewInspectorBlockerTraceErrorRuntimeSource } from './previewInspectorBlockerTraceErrorRuntimeSource';
import { PREVIEW_BLOCKER_KIND_CATEGORIES } from '../../../domain/previewBlocker';

/**
 * Creates browser source for blocker discovery, Auto decision, render-diff, and error correlation.
 *
 * Expected lexical bindings include `previewInspectorSession`, `previewInspectorPostHostMessage`,
 * and the selected descriptor helpers declared by the composed Page Inspector runtime.
 *
 * @returns Plain JavaScript source concatenated before project modules are imported.
 */
export function createPreviewInspectorBlockerTraceRuntimeSource(): string {
  return (
    String.raw`
const PREVIEW_INSPECTOR_BLOCKER_CATEGORY_BY_KIND = ${JSON.stringify(PREVIEW_BLOCKER_KIND_CATEGORIES)};
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
      /*
       * A selected-target exception is first owned by the Router error boundary and is later
       * re-attributed to the selected export. Its stable identity is the target-scoped message;
       * requiring the transient boundary owner here deletes the baseline immediately before Auto
       * starts and makes the byte-identical exception look new again.
       */
      const sameOwner = record?.kind === 'target-error' ||
        typeof fatalError?.exportName !== 'string' ||
        record?.ownerName === fatalError.exportName;
      return sameOwner && typeof headline === 'string' &&
        headline.includes(String(fatalError?.message ?? ''));
    });
    if (!stillActive) previewInspectorSession.blockerTraceRecentFatalErrors.delete(fingerprint);
  }
}

/**
 * Canonicalizes one mounted failure independently of the browser transport that reported it.
 *
 * React can forward the same exception through a target boundary and then through window.onerror.
 * Source, phase, and generated chunk location differ between those reports even though the render
 * hole did not change. Treating those transport fields as causal identity rolls back every
 * incremental requirement value and prevents the resolver from ever composing a multi-value fix.
 */
function createPreviewInspectorBlockerTraceFatalErrorFingerprint(target, entry) {
  const exportName = typeof entry?.exportName === 'string' && entry.exportName.length > 0
    ? entry.exportName
    : target?.exportName;
  return [
    target?.pageCandidateId,
    target?.renderScenario,
    target?.revision,
    entry?.level,
    exportName,
    String(entry?.message ?? '[' + String(entry?.level ?? 'error') + ']'),
  ].join('\0');
}

/** Extracts bounded property names from common missing-shape TypeErrors without retaining stacks. */
function readPreviewInspectorBlockerTraceErrorProperties(message) {
  const text = String(message ?? '');
  const properties = [];
  const append = (value) => {
    if (
      typeof value === 'string' &&
      value.length > 0 &&
      value.length <= 120 &&
      !properties.includes(value) &&
      properties.length < 8
    ) properties.push(value);
  };
  for (const match of text.matchAll(/(?:reading|property)\s+['"]([^'"]+)['"]/gu)) {
    append(match[1]);
  }
  for (const match of text.matchAll(/\b([A-Za-z_$][\w$]*)\s+is not (?:a function|iterable)\b/gu)) {
    append(match[1]);
  }
  return properties;
}

/** Reports whether one generated path contains the exact property segment named by an exception. */
function hasPreviewInspectorBlockerTraceGeneratedProperty(generatedPaths, property) {
  return (Array.isArray(generatedPaths) ? generatedPaths : []).some((path) =>
    String(path)
      .replaceAll('()', '')
      .split(/[^A-Za-z0-9_$]+/u)
      .includes(property),
  );
}

/**
 * Recognizes forward exception progress made by a compiler-admitted minimum-shape transaction.
 *
 * A value that repairs warnings.some can legitimately expose the next missing field deeper in the
 * same render. Keep that value only when its generated path addressed the old exception and the new
 * exception names a different missing property. Unrelated failures still use the ordinary rollback.
 */
function isPreviewInspectorComposableRequirementSuccessorError(activeAttempt, entry) {
  if (
    !['deterministic-minimum-auto', 'minimum-requirement-dfs'].includes(activeAttempt?.autoMode) ||
    !Array.isArray(activeAttempt?.knownFatalErrorMessages) ||
    activeAttempt.knownFatalErrorMessages.length === 0
  ) return false;
  const message = String(entry?.message ?? '');
  if (
    !/Cannot read propert(?:y|ies) of (?:undefined|null)|\bis not (?:a function|iterable)\b/u.test(
      message,
    )
  ) return false;
  const baselineProperties = activeAttempt.knownFatalErrorMessages
    .flatMap((knownMessage) => readPreviewInspectorBlockerTraceErrorProperties(knownMessage));
  if (
    baselineProperties.length === 0 ||
    !baselineProperties.some((property) =>
      hasPreviewInspectorBlockerTraceGeneratedProperty(activeAttempt.generatedPaths, property),
    )
  ) return false;
  const baselinePropertySet = new Set(baselineProperties);
  const successorProperties = readPreviewInspectorBlockerTraceErrorProperties(message);
  return successorProperties.some((property) => !baselinePropertySet.has(property));
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
  if (detail?.outcome === 'superseded') {
    // React never verified this coalesced attempt; a newer mutation owns the next render.
    attempt.targetReachabilityResumeHandled = true;
  } else if (typeof schedulePreviewInspectorTargetReachabilityResumeAfterAutoAttempt === 'function') {
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
  if (typeof recordPreviewInspectorRuntimeHealth === 'function') {
    recordPreviewInspectorRuntimeHealth({
      category: 'render-attempt',
      detail: {
        ...detail,
        ...(attempt.targetAutoAttemptRolledBack === true ? { outcome: 'rolled-back' } : {}),
        traceId: attempt.traceId,
      },
      event: 'render-attempt-settled',
    });
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
  const completedResult = attempt.targetAutoAttemptRolledBack === true
    ? { ...result, outcome: 'rolled-back' } : result;
  if (typeof observePreviewInspectorNeuralResidualAttempt === 'function') {
    observePreviewInspectorNeuralResidualAttempt(attempt, completedResult);
  }
  const outcome = completedResult?.outcome === 'rolled-back'
    ? 'rolled-back'
    : completedResult?.outcome === 'committed'
      ? 'auto-resolved'
      : 'report-only';
  postPreviewInspectorBlockerTraceEvent('render-result', attempt.traceId, {
    ...(attempt.blocker === undefined ? {} : { blocker: { ...attempt.blocker, outcome } }),
    result: completedResult,
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
` +
    createPreviewInspectorBlockerTraceRecordRuntimeSource() +
    String.raw`
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
  try {
    if (
      discoveredBlockerIds.length > 0 &&
      typeof schedulePreviewInspectorAutomaticNeuralAssistanceFromHealth === 'function'
    ) {
      schedulePreviewInspectorAutomaticNeuralAssistanceFromHealth('blocker-discovered', {
        blockerCount: discoveredBlockerIds.length,
        blockerIds: discoveredBlockerIds.slice(0, 16),
      });
    }
  } catch {
    /* Blocker tracing remains observational when automatic assistance is unavailable. */
  }
}
` +
    createPreviewInspectorBlockerTraceDecisionRuntimeSource() +
    createPreviewInspectorBlockerTraceErrorRuntimeSource() +
    String.raw`
`
  );
}
