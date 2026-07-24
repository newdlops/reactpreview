/**
 * Generates the static-path evidence layer used by target reachability traversal.
 *
 * This module deliberately owns only candidate paths, component identities, and branch scoring.
 * Traversal state and remount scheduling remain in the reachability runtime, keeping static
 * compiler evidence separate from mutable browser convergence behavior.
 */

/**
 * Creates browser helpers that decide whether a condition belongs to the selected page corridor.
 *
 * Expected lexical bindings include the Inspector session, selected-candidate helpers, render-path
 * lookup, and ambiguous-owner classifier supplied by the composed Page Inspector runtime.
 *
 * @returns Plain JavaScript source concatenated before reachability traversal functions.
 */
export function createPreviewInspectorTargetPathEvidenceRuntimeSource(): string {
  return String.raw`
/** Normalizes browser/source path spellings for conservative application-path matching. */
function normalizePreviewInspectorReachabilityPath(value) {
  return typeof value === 'string' ? value.replaceAll('\\', '/') : '';
}
/** Collects source and component identities proven to lie between the root and selected target. */
function readPreviewInspectorTargetPathEvidence(descriptor, candidate, state) {
  const renderPath = readPreviewInspectorTargetRenderPath(
    descriptor,
    candidate,
    state.targetExportName,
  );
  const paths = new Set();
  const exactTargetNames = new Set([state.targetExportName]);
  const exactFacadeNames =
    previewInspectorSession.targetFacadeRuntimeOwnerNamesByExport?.get?.(state.targetExportName);
  if (exactFacadeNames instanceof Set) {
    for (const name of exactFacadeNames) exactTargetNames.add(name);
  }
  const staticNames = new Set([
    state.rootName,
    state.targetExportName,
    ...(state.applicationPath ?? []),
  ]);
  const runtimeOwnerNames = new Set(state.runtimeOwnerNames ?? []);
  const names = new Set([...staticNames, ...runtimeOwnerNames]);
  const retainedConditionIds = previewInspectorSession.directTargetConditionIdsByExport?.get(
    state.targetExportName,
  );
  const exactConditionIds =
    retainedConditionIds instanceof Set ? new Set(retainedConditionIds) : new Set();
  const nameScores = new Map();
  const pathScores = new Map();
  (state.applicationPath ?? []).forEach((name, index) => nameScores.set(name, index + 1));
  nameScores.set(state.targetExportName, 1_000);
  /* Runtime-only Fiber leaves locate wrapper conditions but cannot prove which branch reaches JSX. */
  /* Module-page HOCs/hooks remain exact authored corridor evidence despite having no DOM node. */
  const moduleContext =
    typeof readSelectedPreviewInspectorModuleContext === 'function'
      ? readSelectedPreviewInspectorModuleContext(descriptor)
      : descriptor?.inspector?.contextModule;
  const contextSourcePath = normalizePreviewInspectorReachabilityPath(moduleContext?.sourcePath);
  const candidateTargetPath = normalizePreviewInspectorReachabilityPath(
    candidate?.target?.sourcePath ?? descriptor?.inspector?.target?.sourcePath,
  );
  if (candidateTargetPath.length > 0) {
    paths.add(candidateTargetPath);
    pathScores.set(candidateTargetPath, 1_000);
  }
  for (const rawContextPath of moduleContext?.importPath ?? []) {
    const contextPath = normalizePreviewInspectorReachabilityPath(rawContextPath);
    paths.add(contextPath);
    if (contextPath.length > 0) {
      pathScores.set(
        contextPath,
        Math.max(
          pathScores.get(contextPath) ?? 0,
          contextPath === contextSourcePath ? 800 : 100,
        ),
      );
    }
  }
  for (const [index, step] of (renderPath?.steps ?? []).entries()) {
    const stepPath = normalizePreviewInspectorReachabilityPath(step?.sourcePath);
    paths.add(stepPath);
    if (stepPath.length > 0) {
      pathScores.set(stepPath, Math.max(pathScores.get(stepPath) ?? 0, 100, 800 - index));
    }
    for (const rawEvidencePath of step?.evidenceSourcePaths ?? []) {
      const evidencePath = normalizePreviewInspectorReachabilityPath(rawEvidencePath);
      paths.add(evidencePath);
      if (evidencePath.length > 0) {
        pathScores.set(
          evidencePath,
          Math.max(pathScores.get(evidencePath) ?? 0, 100, 800 - index),
        );
      }
    }
    if (typeof step?.label === 'string') {
      names.add(step.label);
      if (!nameScores.has(step.label)) nameScores.set(step.label, 1);
    }
    for (const wrapperName of step?.wrapperNames ?? []) {
      names.add(wrapperName);
      if (!nameScores.has(wrapperName)) nameScores.set(wrapperName, 1);
    }
  }
  for (const edge of candidate?.edges ?? []) {
    paths.add(normalizePreviewInspectorReachabilityPath(edge?.child?.sourcePath));
    paths.add(normalizePreviewInspectorReachabilityPath(edge?.owner?.sourcePath));
    if (typeof edge?.child?.exportName === 'string') staticNames.add(edge.child.exportName);
    if (typeof edge?.owner?.exportName === 'string') staticNames.add(edge.owner.exportName);
    for (const ownerName of edge?.localOwnerNames ?? []) staticNames.add(ownerName);
  }
  for (const name of staticNames) names.add(name);
  paths.delete('');
  names.delete(undefined);
  exactTargetNames.delete(undefined);
  const ambiguousNames = readPreviewInspectorAmbiguousTargetOwnerNames(names);
  return {
    ambiguousNames,
    exactConditionIds,
    exactTargetNames,
    nameScores,
    names,
    pathScores,
    paths,
    runtimeOwnerNames,
    staticNames,
  };
}
/** Scores component names embedded in one branch label against the proven root-to-target corridor. */
function scorePreviewInspectorTargetConditionLabel(label, evidence) {
  const normalized = String(label ?? '').replace(/[<>]/gu, '');
  const tokens = normalized.split(/[^A-Za-z0-9_$]+/u).filter(Boolean);
  let score = 0;
  for (const [name, nameScore] of evidence.nameScores) {
    if (evidence.ambiguousNames?.has(name) && !evidence.exactTargetNames?.has(name)) {
      continue;
    }
    if (normalized === String(name) || tokens.includes(String(name))) {
      score = Math.max(score, nameScore);
    }
  }
  return score;
}
/** Requires a gate to belong to a statically proven path source or named path component. */
function isPreviewInspectorConditionOnTargetPath(condition, evidence) {
  if (evidence.exactConditionIds?.has(condition?.id)) return true;
  const ownerName = typeof condition?.ownerName === 'string' ? condition.ownerName : '';
  const runtimeOnlyOwner =
    evidence.runtimeOwnerNames?.has(ownerName) && !evidence.staticNames?.has(ownerName);
  if (
    ownerName.length > 0 &&
    evidence.names.has(ownerName) &&
    (!runtimeOnlyOwner || evidence.exactTargetNames?.has(ownerName)) &&
    (!evidence.ambiguousNames?.has(ownerName) || evidence.exactTargetNames?.has(ownerName))
  ) {
    return true;
  }
  const sourcePath = normalizePreviewInspectorReachabilityPath(condition?.sourcePath);
  if (sourcePath.length === 0) return false;
  for (const path of evidence.paths) {
    if (path === sourcePath || path.endsWith('/' + sourcePath) || sourcePath.endsWith('/' + path)) {
      return true;
    }
  }
  /* A target-named overlay may be declared in a factory/helper file absent from import edges. */
  return (
    condition?.role === 'overlay' &&
    Math.max(
      scorePreviewInspectorTargetConditionLabel(condition?.truthyLabel, evidence),
      scorePreviewInspectorTargetConditionLabel(condition?.falsyLabel, evidence),
    ) > 0
  );
}
/** Selects the branch that continues toward the target using compiler-issued gate evidence only. */
function readPreviewInspectorTargetConditionValue(condition, evidence) {
  const truthyScore = scorePreviewInspectorTargetConditionLabel(condition?.truthyLabel, evidence);
  const falsyScore = scorePreviewInspectorTargetConditionLabel(condition?.falsyLabel, evidence);
  if (truthyScore !== falsyScore && Math.max(truthyScore, falsyScore) > 0) {
    return truthyScore > falsyScore;
  }
  /* Visibility metadata defines truthy as visible even though both labels repeat the Modal name. */
  if (
    condition?.kind === 'overlay-visibility' &&
    condition?.role === 'overlay' &&
    Math.max(truthyScore, falsyScore) > 0
  ) {
    return true;
  }
  if (condition?.targetBranch === 'truthy') return true;
  if (condition?.targetBranch === 'falsy') return false;
  if (condition?.fallbackBranch === 'truthy') return false;
  if (condition?.fallbackBranch === 'falsy') return true;
  return undefined;
}
`;
}
