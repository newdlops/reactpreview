/** Generates input-scoped exploration history shared through ordinary VS Code webview state. */

/**
 * Preserves finite verdicts and renderer-safe recipes across complete document replacement.
 * Host input identities invalidate history after source/configuration/manual refresh; restored
 * history never supplies the current document's mount verdict or bypasses compiler admission.
 */
export function createPreviewInspectorPageContextContinuityRuntimeSource(): string {
  return String.raw`
/** Reads an opaque identity supplied by the host, never a route-name or artifact heuristic. */
function readPreviewInspectorPageContextFrontierId() {
  const value = typeof previewHotRuntime === 'object' ? previewHotRuntime.pageContextFrontierId : undefined;
  return typeof value === 'string' && /^[A-Za-z0-9_-]{1,128}$/.test(value) ? value : undefined;
}

/** Starts fresh in-memory history only when the host starts a different immutable input frontier. */
function reconcilePreviewInspectorPageContextFrontier() {
  const id = readPreviewInspectorPageContextFrontierId();
  if (id === undefined) return;
  if (previewInspectorSession.pageContextContinuityFrontierId !== id) {
    previewInspectorSession.pageContextContinuityFrontierId = id;
    previewInspectorSession.neuralPageContextByKey = new Map();
    previewInspectorSession.pageContextContinuityEnvelope = undefined;
  }
}

/** Copies only renderer-safe JSON; unsupported live values cannot become persisted recipes. */
function copyPreviewInspectorPageContextContinuityValue(value) {
  try {
    const copied = typeof copyPreviewInspectorNeuralSuccessValue === 'function'
      ? copyPreviewInspectorNeuralSuccessValue(value) : value;
    let valid = true;
    const serialized = JSON.stringify(copied, (name, item) => {
      if (['__proto__', 'constructor', 'prototype'].includes(name)) { valid = false; return undefined; }
      if (typeof item === 'function' || typeof item === 'symbol' || typeof item === 'bigint') {
        valid = false; return undefined;
      }
      return item;
    });
    if (!valid || typeof serialized !== 'string' || serialized.length > 1024 * 1024) return undefined;
    return JSON.parse(serialized);
  } catch { return undefined; }
}

/** Accepts bounded scalar identities without resolving or importing project modules. */
function isPreviewInspectorPageContextContinuityId(value) {
  return typeof value === 'string' && value.length > 0 && value.length <= 4096;
}

/** Restores only well-formed viewer snapshots bound to the exact selected export and candidate. */
function readPreviewInspectorPageContextContinuitySnapshot(value, exportName, candidateId) {
  if (
    value === null || typeof value !== 'object' || Array.isArray(value) ||
    value.exportName !== exportName || value.pageCandidateId !== candidateId ||
    typeof value.fingerprint !== 'string' || value.fingerprint.length > 1024 * 1024 ||
    !Number.isFinite(value.score) || !Array.isArray(value.conditionEntries) ||
    !value.conditionEntries.every((entry) => Array.isArray(entry) && entry.length === 2 &&
      isPreviewInspectorPageContextContinuityId(entry[0]) && typeof entry[1] === 'boolean')
  ) return undefined;
  return copyPreviewInspectorPageContextContinuityValue(value);
}

/** Lazily validates the envelope; missing/old hosts retain the existing in-memory behavior. */
function readPreviewInspectorPageContextContinuityEnvelope() {
  const frontierId = readPreviewInspectorPageContextFrontierId();
  if (frontierId === undefined) return undefined;
  if (previewInspectorSession.pageContextContinuityEnvelope !== undefined) {
    return previewInspectorSession.pageContextContinuityEnvelope;
  }
  const stored = typeof readPersistedPreviewInspectorState === 'function'
    ? readPersistedPreviewInspectorState().pageContextContinuity : undefined;
  const valid = stored?.version === 1 && stored.frontierId === frontierId &&
    Array.isArray(stored.records) && stored.records.length <= 24;
  const envelope = { version: 1, frontierId, records: valid ? stored.records : [] };
  if (valid && Number.isSafeInteger(stored.controlRevision) && stored.controlRevision >= 0) {
    previewInspectorSession.neuralHumanControlRevision = stored.controlRevision;
  }
  previewInspectorSession.pageContextContinuityEnvelope = envelope;
  return envelope;
}

/** Converts a verified/failed verdict into a compact row without persisting live React state. */
function createPreviewInspectorPageContextContinuityRow(record, candidateId) {
  if (!isPreviewInspectorPageContextContinuityId(candidateId)) return undefined;
  const success = record.successfulCandidateIds.has(candidateId);
  const failed = record.failedCandidateIds.has(candidateId);
  const authoredState = record.authoredStateCandidateIds?.has(candidateId) === true;
  if (!success && !failed && !authoredState) return undefined;
  const stability = record.stabilityByCandidateId.get(candidateId) ?? {};
  const contract = record.executionContractByCandidateId.get(candidateId);
  return {
    id: candidateId, outcome: authoredState ? 'awaiting-authored-state' : success ? 'verified' : 'failed',
    stableCount: Math.max(0, Math.trunc(Number(stability.stableCount) || 0)),
    regressionCount: Math.max(0, Math.trunc(Number(stability.regressionCount) || 0)),
    ...(contract === undefined ? {} : { contract: copyPreviewInspectorPageContextContinuityValue(contract) }),
  };
}

/** Retains past admitted rows even when a narrower replacement temporarily omits their metadata. */
function serializePreviewInspectorPageContextContinuity() {
  const envelope = readPreviewInspectorPageContextContinuityEnvelope();
  if (envelope === undefined) return undefined;
  const retained = new Map(envelope.records.filter((item) =>
    typeof item?.key === 'string' && item.key.length <= 1200 && Array.isArray(item.rows),
  ).map((item) => [item.key, item]));
  const records = previewInspectorSession.neuralPageContextByKey;
  if (records instanceof Map) for (const [key, record] of records) {
    const previous = retained.get(key);
    const rows = new Map((previous?.rows ?? []).filter((row) =>
      isPreviewInspectorPageContextContinuityId(row?.id),
    ).map((row) => [row.id, row]));
    for (const candidateId of record.evaluatedCandidateIds ?? []) {
      const row = createPreviewInspectorPageContextContinuityRow(record, candidateId);
      if (row !== undefined) rows.set(candidateId, row);
    }
    retained.delete(key);
    retained.set(key, {
      key, rows: [...rows.values()],
      baseline: copyPreviewInspectorPageContextContinuityValue(record.coverageBaseline),
      recoveryRecipe: copyPreviewInspectorPageContextContinuityValue(record.pageContextRecoveryRecipe),
      pendingCandidate: record.pendingExecutionContractCandidateId,
      pendingOrigin: record.pendingExecutionContractOrigin,
      pendingControlRevision: record.pendingExecutionContractControlRevision,
    });
  }
  const result = { version: 1, frontierId: envelope.frontierId, records: [...retained.values()].slice(-24),
    controlRevision: Math.max(0, Math.trunc(Number(previewInspectorSession.neuralHumanControlRevision) || 0)) };
  previewInspectorSession.pageContextContinuityEnvelope = result;
  return result;
}

/** Loads only currently compiler-admitted identities and keeps the active document unverified. */
function restorePreviewInspectorPageContextContinuity(descriptor, record, candidates, options = {}) {
  const envelope = readPreviewInspectorPageContextContinuityEnvelope();
  const previous = envelope?.records.find((entry) => entry?.key === record.key);
  if (previous === undefined || !Array.isArray(previous.rows)) return;
  const byId = new Map(candidates.filter((candidate) =>
    isPreviewInspectorPageContextContinuityId(candidate?.id),
  ).map((candidate) => [candidate.id, candidate]));
  const exportName = descriptor?.inspector?.target?.exportName ?? previewInspectorSession.selectedExportName;
  for (const row of previous.rows) {
    if (!byId.has(row?.id) || !['verified', 'failed', 'awaiting-authored-state'].includes(row.outcome) ||
      !Number.isSafeInteger(row.stableCount) || row.stableCount < 0 ||
      !Number.isSafeInteger(row.regressionCount) || row.regressionCount < 0) continue;
    record.evaluatedCandidateIds.add(row.id);
    (row.outcome === 'verified' ? record.successfulCandidateIds : row.outcome === 'awaiting-authored-state'
      ? record.authoredStateCandidateIds : record.failedCandidateIds).add(row.id);
    if (row.outcome === 'failed') record.unstableCandidateIds.add(row.id);
    record.stabilityByCandidateId.set(row.id, { stableCount: row.stableCount, regressionCount: row.regressionCount });
    const contract = row.contract;
    const snapshot = readPreviewInspectorPageContextContinuitySnapshot(contract?.snapshot, exportName, row.id);
    if (snapshot !== undefined && contract?.candidateId === row.id &&
      isPreviewInspectorPageContextContinuityId(contract.pathIdentity) && Array.isArray(contract.applicationPath) &&
      contract.applicationPath.length <= 24 &&
      contract.applicationPath.every((name) => typeof name === 'string' && name.length <= 4096)) {
      record.executionContractByCandidateId.set(row.id, Object.freeze({ ...contract, snapshot }));
    }
  }
  // A retained document can temporarily narrow its compiler metadata, then admit the old path again.
  // Restore only historical rows here; the active document still needs fresh target verification.
  if (options.historicalAdmissionOnly === true) return;
  record.coverageBaseline = readPreviewInspectorPageContextContinuitySnapshot(previous.baseline, exportName, '');
  const recipeId = previous.recoveryRecipe?.sourceCandidateId;
  const recipeSnapshot = byId.has(recipeId)
    ? readPreviewInspectorPageContextContinuitySnapshot(previous.recoveryRecipe?.snapshot, exportName, recipeId)
    : undefined;
  if (recipeSnapshot !== undefined) record.pageContextRecoveryRecipe = { ...previous.recoveryRecipe, snapshot: recipeSnapshot };
  if (byId.has(previous.pendingCandidate) && ['neural', 'user'].includes(previous.pendingOrigin) &&
    Number.isSafeInteger(previous.pendingControlRevision) && previous.pendingControlRevision >= 0) {
    record.pendingExecutionContractCandidateId = previous.pendingCandidate;
    record.pendingExecutionContractOrigin = previous.pendingOrigin;
    record.pendingExecutionContractControlRevision = previous.pendingControlRevision;
  }
  const currentId = descriptor?.inspector?.executablePageCandidateId;
  if (record.pendingExecutionContractCandidateId === currentId) record.awaitingCurrentCandidateId = currentId;
  if (record.evaluatedCandidateIds.has(currentId)) {
    record.evaluatedCandidateIds.delete(currentId);
    if (record.successfulCandidateIds.delete(currentId)) record.provisionalCandidateIds.add(currentId);
    record.failedCandidateIds.delete(currentId);
    record.authoredStateCandidateIds?.delete(currentId);
  }
  record.authoredStateControlRevision = Number(previewInspectorSession.neuralHumanControlRevision) || 0;
}
`;
}
