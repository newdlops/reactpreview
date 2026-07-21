/**
 * Generates the incremental hook/backend frontier used by target reachability traversal.
 * Keeping this policy separate prevents the reachability state machine from growing into another
 * data-runtime implementation and makes the per-pass performance limit independently testable.
 */

/** Creates browser source that prioritizes a bounded root-to-target requirement batch. */
export function createPreviewInspectorRequirementFrontierRuntimeSource(): string {
  return String.raw`
const PREVIEW_INSPECTOR_REQUIREMENT_HOOK_BATCH_LIMIT = 8;
const PREVIEW_INSPECTOR_REQUIREMENT_DATA_BATCH_LIMIT = 4;

/** Reports whether compiler evidence names a property that Smart fill can actually materialize. */
function hasPreviewInspectorMaterializableHookRequirement(record) {
  return (record?.requiredPaths ?? []).some((path) =>
    typeof path === 'string' && path.length > 0 && path !== '<root>' && path !== '<root>()',
  );
}

/** Returns whether a formerly Smart record has discovered a shape not covered by its last fill. */
function hasPreviewInspectorStaleSmartRequirement(record) {
  if (record?.mode !== 'smart' && record?.mode !== 'smart-manual') return false;
  const signatures = previewInspectorSession.runtimeFallbackSmartPathSignatures;
  if (!(signatures instanceof Map)) return true;
  const current = createPreviewInspectorRuntimeFallbackPathSignature(record.requiredPaths);
  return signatures.get(record.id) !== current;
}

/** Excludes settled generated values while admitting newly expanded Smart requirements exactly once. */
function hasPreviewInspectorPendingHookRequirement(record, preserveUserValues) {
  if (record?.passive === true || !hasPreviewInspectorMaterializableHookRequirement(record)) {
    return false;
  }
  if (preserveUserValues && (record.mode === 'manual' || record.mode === 'smart-manual')) {
    return false;
  }
  return record.mode !== 'smart' && record.mode !== 'smart-manual' ||
    hasPreviewInspectorStaleSmartRequirement(record);
}

/** Scores one runtime requirement by exact ownership inside the proven root-to-target corridor. */
function scorePreviewInspectorRequirementRecord(record, evidence) {
  const ownerName = record?.ownerName;
  const ambiguousOwner = evidence.ambiguousNames?.has(ownerName) &&
    !evidence.runtimeOwnerNames?.has(ownerName);
  let score = ambiguousOwner ? 0 : evidence.nameScores.get(ownerName) ?? 0;
  const sourcePath = normalizePreviewInspectorReachabilityPath(record?.sourcePath);
  if (sourcePath.length === 0) return score;
  for (const path of evidence.paths) {
    if (path === sourcePath || path.endsWith('/' + sourcePath) || sourcePath.endsWith('/' + path)) {
      /* Target-to-root path scores preserve distance; a shell source must not tie the target. */
      score = Math.max(score, evidence.pathScores?.get(path) ?? 1);
    }
  }
  return score;
}

/**
 * Chooses records proven to belong to the root-to-target path before considering a blind fallback.
 * A bounded fallback remains necessary for anonymous wrapper hooks whose compiler metadata cannot
 * name an owner, but zero-score siblings must never consume slots once any path evidence matches.
 */
function selectPreviewInspectorRequirementIds(records, evidence, limit) {
  const ranked = records
    .map((record) => ({ record, score: scorePreviewInspectorRequirementRecord(record, evidence) }))
    .sort((left, right) => right.score - left.score);
  const pathLocal = ranked.filter((candidate) => candidate.score > 0);
  return (pathLocal.length > 0 ? pathLocal : ranked)
    .slice(0, limit)
    .map((candidate) => candidate.record.id);
}

/**
 * Selects a small incremental frontier instead of filling every hook and request seen on the page.
 * Path-local records exclusively occupy a proven batch; unresolved anonymous hooks are used only
 * when the current observations provide no owner/source correlation at all.
 */
function readPreviewInspectorRequirementBatch(
  descriptor,
  candidate,
  state,
  preserveUserValues,
) {
  const evidence = readPreviewInspectorTargetPathEvidence(descriptor, candidate, state);
  const hooks = readPreviewInspectorRuntimeFallbacks()
    .filter((record) =>
      record.reachabilityKey === state.key &&
      hasPreviewInspectorPendingHookRequirement(record, preserveUserValues),
    );
  const requests = readPreviewInspectorDataRequests()
    .filter((record) =>
      record.reachabilityKey === state.key &&
      record.mode !== 'smart' &&
      record.mode !== 'smart-custom' &&
      !(preserveUserValues && record.mode === 'custom'),
    );
  const hookIds = selectPreviewInspectorRequirementIds(
    hooks,
    evidence,
    PREVIEW_INSPECTOR_REQUIREMENT_HOOK_BATCH_LIMIT,
  );
  const requestIds = selectPreviewInspectorRequirementIds(
    requests,
    evidence,
    PREVIEW_INSPECTOR_REQUIREMENT_DATA_BATCH_LIMIT,
  );
  return { hookIds, requestIds };
}

/** Returns only paths changed by the current incremental requirement batch. */
function readPreviewInspectorRequirementBatchPaths(batch) {
  const hookIds = new Set(batch.hookIds);
  const requestIds = new Set(batch.requestIds);
  const paths = [];
  const append = (value) => {
    if (typeof value === 'string' && value.length > 0 && !paths.includes(value) && paths.length < 64) {
      paths.push(value);
    }
  };
  for (const record of readPreviewInspectorRuntimeFallbacks()) {
    if (!hookIds.has(record.id)) continue;
    for (const path of record.requiredPaths ?? []) append(record.hookName + '.' + path);
  }
  for (const record of readPreviewInspectorDataRequests()) {
    if (!requestIds.has(record.id)) continue;
    for (const path of readPreviewInspectorDataShapePaths(record.shape)) {
      append(record.label + '.' + path);
    }
  }
  return paths;
}
`;
}
