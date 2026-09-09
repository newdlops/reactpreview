/**
 * Records Auto choices and captures the unique owner of each render-producing attempt.
 * This adapter emits a lexical fragment composed by previewInspectorBlockerTraceRuntimeSource.
 * Session state and helper ownership remain in the same generated browser module.
 */

/** Returns the ordered browser fragment; no project code runs during source generation. */
export function createPreviewInspectorBlockerTraceDecisionRuntimeSource(): string {
  return String.raw`
/** Builds a blocker record for an Auto decision that occurred before the next tree snapshot. */
function createPreviewInspectorBlockerTraceDecisionRecord(candidate) {
  initializePreviewInspectorBlockerTraceState();
  const blockerId = String(candidate?.blockerId ?? 'automatic-resolver').slice(0, 160);
  const existing = previewInspectorSession.blockerTraceRecords.get(blockerId);
  if (existing !== undefined) return existing;
  const source = createPreviewInspectorBlockerTraceSource(candidate);
  return {
    category: normalizePreviewInspectorBlockerTraceCategory(
      String(candidate?.blockerKind ?? 'automatic-resolver'),
    ),
    id: blockerId,
    kind: String(candidate?.blockerKind ?? 'automatic-resolver').slice(0, 120),
    name: String(candidate?.blockerName ?? candidate?.action ?? 'Automatic blocker decision')
      .slice(0, PREVIEW_INSPECTOR_BLOCKER_TRACE_TEXT_LIMIT),
    outcome: candidate?.startsRenderAttempt === true ? 'prevented' : 'report-only',
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
  const neuralResidualDecision =
    typeof copyPreviewInspectorNeuralResidualDecision === 'function'
      ? copyPreviewInspectorNeuralResidualDecision(candidate?.neuralResidualDecision)
      : undefined;
  const neuralDataFlowSignal =
    candidate?.neuralDataFlowSignal !== null &&
    typeof candidate?.neuralDataFlowSignal === 'object' &&
    candidate.neuralDataFlowSignal.paths instanceof Set
      ? candidate.neuralDataFlowSignal
      : undefined;
  const startsRenderAttempt = candidate?.startsRenderAttempt === true;
  const generatedPaths = Array.isArray(candidate?.generatedPaths)
    ? candidate.generatedPaths.filter((value) => typeof value === 'string').slice(0, 128)
    : [];
  const auto = {
    action: String(candidate?.action ?? 'automatic blocker resolution')
      .slice(0, PREVIEW_INSPECTOR_BLOCKER_TRACE_TEXT_LIMIT),
    generatedPaths,
    mode: String(candidate?.mode ?? 'auto').slice(0, 120),
    ...(neuralResidualDecision === undefined ||
      typeof summarizePreviewInspectorNeuralResidualDecision !== 'function'
      ? {}
      : { neuralResidual: summarizePreviewInspectorNeuralResidualDecision(neuralResidualDecision) }),
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
    const traceId = queuePreviewInspectorBlockerTraceAutoDecision(auto, blocker);
    if (typeof recordPreviewInspectorNeuralResidualSelection === 'function') {
      recordPreviewInspectorNeuralResidualSelection(neuralResidualDecision, auto, traceId);
    }
    return traceId;
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
  if (typeof recordPreviewInspectorNeuralResidualSelection === 'function') {
    recordPreviewInspectorNeuralResidualSelection(neuralResidualDecision, auto, traceId);
  }
  if (auto.startsRenderAttempt) {
    const recentErrorCutoff = now - PREVIEW_INSPECTOR_BLOCKER_TRACE_ACTIVE_WINDOW_MS;
    const knownFatalErrors = new Set();
    const knownFatalErrorMessages = [];
    for (const [errorFingerprint, fatalError] of previewInspectorSession.blockerTraceRecentFatalErrors) {
      const observedAt = fatalError?.observedAt;
      if (typeof observedAt === 'number' && observedAt >= recentErrorCutoff) {
        knownFatalErrors.add(errorFingerprint);
        const message = String(fatalError?.message ?? '');
        if (message.length > 0 && !knownFatalErrorMessages.includes(message)) {
          knownFatalErrorMessages.push(message);
        }
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
      generatedPaths: auto.generatedPaths,
      knownFatalErrors,
      knownFatalErrorMessages,
      ...(neuralResidualDecision === undefined ? {} : { neuralResidualDecision }),
      ...(neuralDataFlowSignal === undefined ? {} : { neuralDataFlowSignal }),
      observedSnapshotCount: 0,
      startedAt: now,
      ...(targetReachabilityKey === undefined ? {} : { targetReachabilityKey }),
      traceId,
    };
    if (
      neuralResidualDecision !== undefined &&
      typeof createPreviewInspectorNeuralResidualObservationScope === 'function'
    ) {
      attempt.neuralResidualObservationScope = createPreviewInspectorNeuralResidualObservationScope(attempt);
    }
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
`;
}
