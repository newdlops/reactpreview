/** Generates automatic rollback and manual condition editing in the surrounding Inspector scope. */

/** Returns source concatenated at its original lexical position; declarations share the session scope. */
export function createPreviewInspectorConditionEditingRuntimeSource(): string {
  return String.raw`/**
 * Forces one statically proven continuation branch for the current target-search pass.
 * Automatic decisions are deliberately ephemeral and always lose to an explicit user override.
 */
function setPreviewInspectorTargetGuidedConditionOverride(
  conditionId,
  enabled,
  neuralResidualDecision,
) {
  initializePreviewInspectorConditionState();
  if (
    typeof isPreviewInspectorNeuralSuccessfulPathRestorationActive === 'function' &&
    isPreviewInspectorNeuralSuccessfulPathRestorationActive()
  ) return false;
  const record = previewInspectorSession.renderConditions.get(conditionId);
  if (record === undefined || typeof enabled !== 'boolean') {
    return false;
  }
  if (isPreviewInspectorConditionControlledBySourceProvenPropChoice(record)) return false;
  if (!canPreviewInspectorTargetGuideCondition(record, enabled)) return false;
  /* A complete current-file return choice is user intent; DFS must not fight that scenario. */
  if (
    typeof isPreviewInspectorRenderConditionControlledByOutcome === 'function' &&
    isPreviewInspectorRenderConditionControlledByOutcome(record)
  ) return false;
  if (previewInspectorSession.renderConditionAutoOverrides.get(conditionId) === enabled) {
    return false;
  }
  previewInspectorSession.renderConditionAutoOverrides.set(conditionId, enabled);
  if (!previewInspectorSession.renderConditionOverrides.has(conditionId)) {
    previewInspectorSession.renderConditions.set(conditionId, {
      ...record,
      effectiveEnabled: enabled,
    });
  }
  if (typeof recordPreviewInspectorBlockerAutoDecision === 'function' && record !== undefined) {
    const traceId = recordPreviewInspectorBlockerAutoDecision({
      action: 'Advance target-guided JSX branch',
      blockerId: conditionId,
      blockerKind: 'render-condition',
      blockerName: 'Render condition · ' + record.expression,
      column: record.column,
      generatedPaths: [],
      line: record.line,
      mode: 'target-guided-auto',
      neuralResidualDecision,
      ownerName: record.ownerName,
      reason: 'Static path analysis selected the branch leading toward the current-file export',
      selectedValue: enabled,
      sourcePath: record.sourcePath,
      startsRenderAttempt: true,
      summary: {
        authoredEnabled: record.authoredEnabled,
        neuralResidual:
          typeof summarizePreviewInspectorNeuralResidualDecision === 'function'
            ? summarizePreviewInspectorNeuralResidualDecision(neuralResidualDecision)
            : undefined,
        role: record.role,
        targetBranch: record.targetBranch,
      },
    });
    if (typeof traceId === 'string' && traceId.length > 0) {
      previewInspectorSession.renderConditionAutoAttempts.set(traceId, {
        conditionId,
        enabled,
        reachabilityKey: record.reachabilityKey,
      });
      while (previewInspectorSession.renderConditionAutoAttempts.size > 64) {
        previewInspectorSession.renderConditionAutoAttempts.delete(
          previewInspectorSession.renderConditionAutoAttempts.keys().next().value,
        );
      }
    }
  }
  previewInspectorSession.renderConditionRevision += 1;
  notifyPreviewInspector();
  schedulePreviewInspectorCommitRefresh();
  return true;
}

/**
 * Reports whether a failed automatic branch has already been rejected for this exact page search.
 * The rejection is session-only: an explicit retry, candidate change, or hot graph reset clears it.
 */
function isPreviewInspectorTargetGuidedConditionRejected(conditionId, reachabilityKey) {
  initializePreviewInspectorConditionState();
  if (typeof conditionId !== 'string' || typeof reachabilityKey !== 'string') return false;
  const rejected = previewInspectorSession.renderConditionRejectedAutoOverridesByKey.get(
    reachabilityKey,
  );
  return rejected instanceof Set && rejected.has(conditionId);
}

/**
 * Rolls back one automatic JSX mutation after a fatal error or an evidence-free committed render.
 * Explicit user choices are never touched, and the reason-tagged session rejection prevents the
 * bounded DFS from recreating that exact failed branch during the current candidate traversal.
 */
function rollbackPreviewInspectorFailedAutoDecision(traceId, rejectionReason = 'runtime-error') {
  initializePreviewInspectorConditionState();
  if (typeof traceId !== 'string') return false;
  const attempt = previewInspectorSession.renderConditionAutoAttempts.get(traceId);
  previewInspectorSession.renderConditionAutoAttempts.delete(traceId);
  if (attempt === undefined) return false;
  if (previewInspectorSession.renderConditionOverrides.has(attempt.conditionId)) return false;
  if (
    previewInspectorSession.renderConditionAutoOverrides.get(attempt.conditionId) !== attempt.enabled
  ) {
    return false;
  }
  const currentKey = previewInspectorSession.activeTargetReachabilityKey;
  if (
    typeof attempt.reachabilityKey === 'string' &&
    typeof currentKey === 'string' &&
    attempt.reachabilityKey !== currentKey
  ) {
    return false;
  }
  const record = previewInspectorSession.renderConditions.get(attempt.conditionId);
  /* Keep overlays visible only for child errors; a no-progress reveal must remain DFS-reversible. */
  if (record?.role === 'overlay' && rejectionReason === 'runtime-error') return false;
  previewInspectorSession.renderConditionAutoOverrides.delete(attempt.conditionId);
  if (record !== undefined) {
    previewInspectorSession.renderConditions.set(attempt.conditionId, {
      ...record,
      effectiveEnabled: record.authoredEnabled,
    });
  }
  if (typeof attempt.reachabilityKey === 'string' && attempt.reachabilityKey.length > 0) {
    let rejected = previewInspectorSession.renderConditionRejectedAutoOverridesByKey.get(
      attempt.reachabilityKey,
    );
    if (!(rejected instanceof Set)) {
      rejected = new Set();
      previewInspectorSession.renderConditionRejectedAutoOverridesByKey.set(
        attempt.reachabilityKey,
        rejected,
      );
    }
    if (rejected.size < PREVIEW_INSPECTOR_RENDER_CONDITION_LIMIT) {
      rejected.add(attempt.conditionId);
    }
    const reachability = previewInspectorSession.targetReachabilityByKey?.get(
      attempt.reachabilityKey,
    );
    if (reachability !== undefined && Array.isArray(reachability.appliedConditions)) {
      const rejectedGate = reachability.appliedConditions.find(
        (gate) => gate?.id === attempt.conditionId,
      );
      reachability.appliedConditions = reachability.appliedConditions.filter(
        (gate) => gate?.id !== attempt.conditionId,
      );
      reachability.rejectedConditions ??= [];
      if (rejectedGate !== undefined && reachability.rejectedConditions.length < 64) {
        reachability.rejectedConditions.push({ ...rejectedGate, reason: rejectionReason, traceId });
      }
      reachability.status = 'recovering-after-rejected-gate';
    }
  }
  previewInspectorSession.renderConditionRevision += 1;
  if (typeof recordPreviewInspectorRuntimeHealth === 'function') {
    recordPreviewInspectorRuntimeHealth({
      category: 'render-attempt',
      detail: {
        conditionId: attempt.conditionId,
        reason: rejectionReason,
        reachabilityKey: attempt.reachabilityKey,
        traceId,
      },
      event: 'automatic-condition-rolled-back',
    });
  }
  notifyPreviewInspector();
  schedulePreviewInspectorCommitRefresh();
  return true;
}

/** Rejects a committed JSX choice that changed neither blockers nor current-target reachability. */
function rollbackPreviewInspectorNoProgressAutoDecision(traceId) {
  return rollbackPreviewInspectorFailedAutoDecision(traceId, 'no-target-progress');
}

/** Clears target-guided branches for one candidate/export search without touching user choices. */
function clearPreviewInspectorTargetGuidedConditionOverrides(reachabilityKey) {
  initializePreviewInspectorConditionState();
  let changed = false;
  for (const conditionId of [...previewInspectorSession.renderConditionAutoOverrides.keys()]) {
    const record = previewInspectorSession.renderConditions.get(conditionId);
    if (
      typeof reachabilityKey === 'string' &&
      reachabilityKey.length > 0 &&
      record?.reachabilityKey !== reachabilityKey
    ) {
      continue;
    }
    changed = previewInspectorSession.renderConditionAutoOverrides.delete(conditionId) || changed;
    if (record !== undefined && !previewInspectorSession.renderConditionOverrides.has(conditionId)) {
      previewInspectorSession.renderConditions.set(conditionId, {
        ...record,
        effectiveEnabled: record.authoredEnabled,
      });
    }
  }
  if (typeof reachabilityKey === 'string' && reachabilityKey.length > 0) {
    previewInspectorSession.renderConditionRejectedAutoOverridesByKey.delete(reachabilityKey);
  } else {
    previewInspectorSession.renderConditionRejectedAutoOverridesByKey.clear();
  }
  previewInspectorSession.renderConditionAutoAttempts.clear();
  if (changed) previewInspectorSession.renderConditionRevision += 1;
  return changed;
}

/** Forces one branch, remounting the authored page so memoized owners also observe the decision. */
function setPreviewInspectorRenderConditionOverride(conditionId, enabled) {
  initializePreviewInspectorConditionState();
  if (!isPreviewInspectorKnownRenderCondition(conditionId) || typeof enabled !== 'boolean') {
    return;
  }
  const condition = previewInspectorSession.renderConditions.get(conditionId) ??
    previewInspectorSession.renderConditionDefinitions?.get?.(conditionId);
  if (condition?.requiresAuthoredState === true) return;
  const previous = previewInspectorSession.renderConditionOverrides.get(conditionId);
  if (previous === enabled) return;
  previewInspectorSession.renderConditionOverrides.set(conditionId, enabled);
  const record = previewInspectorSession.renderConditions.get(conditionId);
  if (record !== undefined) {
    previewInspectorSession.renderConditions.set(conditionId, {
      ...record,
      effectiveEnabled: enabled,
    });
  }
  if (typeof resumePreviewInspectorTargetReachabilityAfterManualCondition === 'function') resumePreviewInspectorTargetReachabilityAfterManualCondition(conditionId);
  previewInspectorSession.renderConditionRevision += 1;
  persistPreviewInspectorState();
  notifyPreviewInspector();
  schedulePreviewInspectorCommitRefresh();
}

/** Flips the currently effective branch directly from its component-tree row. */
function togglePreviewInspectorRenderCondition(conditionId) {
  const record = readPreviewInspectorRenderConditions().find((item) => item.id === conditionId);
  if (record === undefined) return;
  setPreviewInspectorRenderConditionOverride(conditionId, !record.effectiveEnabled);
}

/** Restores one condition to its authored runtime value and remounts the page once. */
function resetPreviewInspectorRenderConditionOverride(conditionId) {
  initializePreviewInspectorConditionState();
  const manualChanged = previewInspectorSession.renderConditionOverrides.delete(conditionId);
  const automaticChanged = previewInspectorSession.renderConditionAutoOverrides.delete(conditionId);
  if (!manualChanged && !automaticChanged) return;
  const record = previewInspectorSession.renderConditions.get(conditionId);
  if (record !== undefined) {
    previewInspectorSession.renderConditions.set(conditionId, {
      ...record,
      effectiveEnabled: record.authoredEnabled,
    });
  }
  if (typeof resumePreviewInspectorTargetReachabilityAfterManualCondition === 'function') resumePreviewInspectorTargetReachabilityAfterManualCondition(conditionId);
  previewInspectorSession.renderConditionRevision += 1;
  persistPreviewInspectorState();
  notifyPreviewInspector();
  schedulePreviewInspectorCommitRefresh();
}

/** Forces one compiler-proven literal/default switch branch and remounts the page once. */
function setPreviewInspectorRenderChoiceOverride(choiceId, branchId) {
  initializePreviewInspectorConditionState();
  const record = previewInspectorSession.renderChoices.get(choiceId);
  const branch = record?.branches?.find(
    (candidate) => candidate.id === branchId && candidate.selectable === true,
  );
  if (branch === undefined) return false;
  if (previewInspectorSession.renderChoiceOverrides.get(choiceId) === branchId) return false;
  previewInspectorSession.renderChoiceOverrides.set(choiceId, branchId);
  previewInspectorSession.renderChoices.set(choiceId, {
    ...record,
    effectiveBranchId: branchId,
  });
  previewInspectorSession.renderConditionRevision += 1;
  persistPreviewInspectorState();
  notifyPreviewInspector();
  schedulePreviewInspectorCommitRefresh();
  return true;
}

/** Restores one switch to its authored discriminant without touching boolean branch overrides. */
function resetPreviewInspectorRenderChoiceOverride(choiceId) {
  initializePreviewInspectorConditionState();
  if (!previewInspectorSession.renderChoiceOverrides.delete(choiceId)) return false;
  const record = previewInspectorSession.renderChoices.get(choiceId);
  if (record !== undefined) {
    previewInspectorSession.renderChoices.set(choiceId, {
      ...record,
      effectiveBranchId: record.authoredBranchId,
    });
  }
  previewInspectorSession.renderConditionRevision += 1;
  persistPreviewInspectorState();
  notifyPreviewInspector();
  schedulePreviewInspectorCommitRefresh();
  return true;
}

/** Reports whether inferred props and usage-derived automatic values are currently admitted. */
function readPreviewInspectorFallbackValuesEnabled() {
  initializePreviewInspectorConditionState();
  return previewInspectorSession.fallbackValuesEnabled;
}

/**
 * Toggles preview-generated prop values and optionally leaves persistence/render notification to a
 * larger transaction. The revision always advances before returning a successful mutation.
 */
function setPreviewInspectorFallbackValuesEnabled(enabled, commit = true) {
  initializePreviewInspectorConditionState();
  const normalized = enabled === true;
  if (previewInspectorSession.fallbackValuesEnabled === normalized) return false;
  previewInspectorSession.fallbackValuesEnabled = normalized;
  previewInspectorSession.renderConditionRevision += 1;
  if (commit) {
    persistPreviewInspectorState();
    notifyPreviewInspector();
    schedulePreviewInspectorHighlight();
  }
  return true;
}

/** Returns the remount key shared by branch and automatic-value controls. */
function readPreviewInspectorRenderConditionRevision() {
  initializePreviewInspectorConditionState();
  return previewInspectorSession.renderConditionRevision;
}

/** Serializes only bounded boolean condition overrides for VS Code webview persistence. */
function serializePreviewInspectorRenderConditionOverrides() {
  initializePreviewInspectorConditionState();
  return Object.fromEntries(
    [...previewInspectorSession.renderConditionOverrides]
      .filter(
        ([conditionId, value]) =>
          typeof conditionId === 'string' && conditionId.length <= 128 && typeof value === 'boolean',
      )
      .slice(0, PREVIEW_INSPECTOR_RENDER_CONDITION_LIMIT),
  );
}

/** Serializes bounded switch branch identities separately from boolean condition overrides. */
function serializePreviewInspectorRenderChoiceOverrides() {
  initializePreviewInspectorConditionState();
  return Object.fromEntries(
    [...previewInspectorSession.renderChoiceOverrides]
      .filter(
        ([choiceId, branchId]) =>
          typeof choiceId === 'string' &&
          choiceId.length <= 128 &&
          typeof branchId === 'string' &&
          branchId.length <= 160,
      )
      .slice(0, PREVIEW_INSPECTOR_RENDER_CONDITION_LIMIT),
  );
}`;
}
