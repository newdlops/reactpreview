/**
 * Attributes fatal errors and neural corrections within existing mode-specific rollback permissions.
 * This adapter emits a lexical fragment composed by previewInspectorBlockerTraceRuntimeSource.
 * Session state and helper ownership remain in the same generated browser module.
 */

/** Returns the ordered browser fragment; no project code runs during source generation. */
export function createPreviewInspectorBlockerTraceErrorRuntimeSource(): string {
  return String.raw`
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
  const settledErrorGrace = ['target-guided-auto', 'target-overlay-auto', 'deterministic-minimum-auto', 'minimum-requirement-dfs'].includes(
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
  const attemptWasSettledBeforeError = activeAttempt?.settledAt !== undefined;
  const target = readPreviewInspectorBlockerTraceTarget();
  const fatalErrorFingerprint = createPreviewInspectorBlockerTraceFatalErrorFingerprint(
    target,
    entry,
  );
  const errorWasKnownAtAttemptStart =
    active && activeAttempt.knownFatalErrors instanceof Set &&
    activeAttempt.knownFatalErrors.has(fatalErrorFingerprint);
  const errorAdvancesRequirementComposition =
    active &&
    !errorWasKnownAtAttemptStart &&
    isPreviewInspectorComposableRequirementSuccessorError(activeAttempt, entry);
  if (
    (errorWasKnownAtAttemptStart || errorAdvancesRequirementComposition) &&
    ['deterministic-minimum-auto', 'minimum-requirement-dfs'].includes(
      activeAttempt?.autoMode,
    )
  ) {
    activeAttempt.retainedBaselineFatalError = {
      fingerprint: fatalErrorFingerprint,
      message: String(entry?.message ?? ''),
      observedAt: now,
    };
  }
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
  // Reversible automatic decisions are deliberately mode-specific. User-authored and broad
  // gallery generation modes remain diagnostic-only even when they share this trace machinery.
  let conditionRolledBack = false;
  let requirementRolledBack = false;
  if (active && !errorWasKnownAtAttemptStart && !errorAdvancesRequirementComposition) {
    if (
      activeAttempt.autoMode === 'target-guided-auto' &&
      typeof rollbackPreviewInspectorFailedAutoDecision === 'function'
    ) {
      conditionRolledBack = rollbackPreviewInspectorFailedAutoDecision(activeAttempt.traceId);
    } else if (
      ['deterministic-minimum-auto', 'minimum-requirement-dfs'].includes(activeAttempt.autoMode) &&
      typeof rollbackPreviewInspectorRequirementAutoDecision === 'function'
    ) {
      requirementRolledBack = rollbackPreviewInspectorRequirementAutoDecision(activeAttempt.traceId);
    }
  }
  postPreviewInspectorBlockerTraceEvent(
    'subsequent-error',
    active ? activeAttempt.traceId : createPreviewInspectorBlockerTraceId(),
    {
      ...(!active || activeAttempt.blocker === undefined ? {} : {
        blocker: {
          ...activeAttempt.blocker,
          outcome: conditionRolledBack || requirementRolledBack ? 'rolled-back' : 'report-only',
        },
      }),
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
  if (requirementRolledBack && active && activeAttempt.settledAt === undefined) {
    activeAttempt.targetReachabilityResumeHandled = true;
  }
  if ((conditionRolledBack || requirementRolledBack) && active && activeAttempt.settledAt === undefined) {
    completePreviewInspectorBlockerTraceAttempt(
      activeAttempt,
      createPreviewInspectorBlockerTraceAttemptResult(activeAttempt, 'rolled-back'),
      { outcome: 'rolled-back', reason: 'new fatal error' },
    );
  } else if (requirementRolledBack && active) {
    // A fatal observed during the bounded post-settlement grace must supersede the optimistic
    // commit record; emit the causal correction with the same trace identity and no new retry.
    postPreviewInspectorBlockerTraceEvent('render-result', activeAttempt.traceId, {
      ...(activeAttempt.blocker === undefined ? {} : {
        blocker: { ...activeAttempt.blocker, outcome: 'rolled-back' },
      }),
      result: createPreviewInspectorBlockerTraceAttemptResult(activeAttempt, 'rolled-back'),
    });
  }
  // Generated fallback failures invalidate neural credit even in diagnostic-only rollback modes.
  // This changes learning attribution only; it never grants Auto permission to revert user values.
  const failedNeuralFallback = active && !errorWasKnownAtAttemptStart &&
    !errorAdvancesRequirementComposition &&
    ['auto', 'smart'].includes(activeAttempt.autoMode) &&
    (activeAttempt.neuralDataFlowSignal !== undefined ||
      activeAttempt.neuralResidualDecision?.holeKind === 'render-state-reference-value') &&
    (typeof entry.exportName !== 'string' || entry.exportName === target.exportName);
  if (
    ((conditionRolledBack || requirementRolledBack) && attemptWasSettledBeforeError || failedNeuralFallback) &&
    active &&
    typeof rejectPreviewInspectorNeuralResidualAttempt === 'function'
  ) {
    rejectPreviewInspectorNeuralResidualAttempt(activeAttempt);
  }
}`;
}
