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
  const componentCorridorNames = new Set([state.rootName, state.targetExportName]);
  const localComponentOwnerNames = new Set();
  const runtimeOwnerNames = new Set(state.runtimeOwnerNames ?? []);
  const names = new Set([...staticNames, ...runtimeOwnerNames]);
  /*
   * These names come from the selected root-to-target render path itself. They are stronger than
   * page-local source membership and can therefore identify an ancestor overlay without admitting
   * an unrelated sibling dialog declared in the same file.
   */
  const corridorOwnerNames = new Set(state.applicationPath ?? []);
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
      componentCorridorNames.add(step.label);
      corridorOwnerNames.add(step.label);
      if (!nameScores.has(step.label)) nameScores.set(step.label, 1);
    }
    for (const wrapperName of step?.wrapperNames ?? []) {
      names.add(wrapperName);
      corridorOwnerNames.add(wrapperName);
      if (!nameScores.has(wrapperName)) nameScores.set(wrapperName, 1);
    }
    for (const ownerName of step?.invocation?.localOwnerNames ?? []) {
      if (typeof ownerName !== 'string' || ownerName.length === 0) continue;
      localComponentOwnerNames.add(ownerName);
      names.add(ownerName);
      corridorOwnerNames.add(ownerName);
      staticNames.add(ownerName);
      if (!nameScores.has(ownerName)) nameScores.set(ownerName, 1);
    }
  }
  for (const edge of candidate?.edges ?? []) {
    paths.add(normalizePreviewInspectorReachabilityPath(edge?.child?.sourcePath));
    paths.add(normalizePreviewInspectorReachabilityPath(edge?.owner?.sourcePath));
    if (typeof edge?.child?.exportName === 'string') {
      staticNames.add(edge.child.exportName);
      componentCorridorNames.add(edge.child.exportName);
      corridorOwnerNames.add(edge.child.exportName);
    }
    if (typeof edge?.owner?.exportName === 'string') {
      staticNames.add(edge.owner.exportName);
      componentCorridorNames.add(edge.owner.exportName);
      corridorOwnerNames.add(edge.owner.exportName);
    }
    for (const ownerName of edge?.localOwnerNames ?? []) {
      staticNames.add(ownerName);
      corridorOwnerNames.add(ownerName);
    }
  }
  for (const name of staticNames) names.add(name);
  paths.delete('');
  names.delete(undefined);
  exactTargetNames.delete(undefined);
  const ambiguousNames = readPreviewInspectorAmbiguousTargetOwnerNames(names);
  const repeatedOwnerNames = readPreviewInspectorRepeatedTargetOwnerNames(names);
  return {
    ambiguousNames,
    componentCorridorNames,
    corridorOwnerNames,
    exactConditionIds,
    exactTargetNames,
    localComponentOwnerNames,
    nameScores,
    names,
    pathScores,
    paths,
    repeatedOwnerNames,
    runtimeOwnerNames,
    staticNames,
  };
}

/**
 * Proves that one overlay is either the exact target or an unambiguous owner on its render corridor.
 *
 * Same-file evidence alone is intentionally insufficient because a page commonly declares several
 * sibling dialogs. A corridor owner, however, is one of the component names retained by the chosen
 * root-to-target render path, so making its visible branch active advances that selected path.
 */
function isPreviewInspectorExactTargetOverlayCondition(condition, evidence) {
  if (condition?.role !== 'overlay') return false;
  if (evidence.exactConditionIds?.has(condition?.id)) return true;
  const ownerName = typeof condition?.ownerName === 'string' ? condition.ownerName : '';
  if (ownerName.length === 0) return false;
  if (evidence.exactTargetNames?.has(ownerName)) return true;
  if (evidence.localComponentOwnerNames?.has(ownerName)) {
    return !evidence.repeatedOwnerNames?.has(ownerName);
  }
  return evidence.corridorOwnerNames?.has(ownerName) &&
    !evidence.repeatedOwnerNames?.has(ownerName);
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
/** Reports whether one branch label names the selected export itself, not only a shared ancestor. */
function labelsPreviewInspectorExactTargetCondition(label, evidence) {
  const normalized = String(label ?? '').replace(/[<>]/gu, '');
  const tokens = normalized.split(/[^A-Za-z0-9_$]+/u).filter(Boolean);
  for (const name of evidence.exactTargetNames ?? []) {
    if (normalized === String(name) || tokens.includes(String(name))) return true;
  }
  return false;
}

/** Scores only authored component steps, excluding JSX wrappers that may occur on both branches. */
function scorePreviewInspectorTargetComponentConditionLabel(label, evidence) {
  const normalized = String(label ?? '').replace(/[<>]/gu, '');
  const tokens = normalized.split(/[^A-Za-z0-9_$]+/u).filter(Boolean);
  let score = 0;
  for (const name of evidence.componentCorridorNames ?? []) {
    if (evidence.ambiguousNames?.has(name) && !evidence.exactTargetNames?.has(name)) {
      continue;
    }
    if (normalized === String(name) || tokens.includes(String(name))) {
      score = Math.max(score, evidence.nameScores?.get?.(name) ?? 1);
    }
  }
  return score;
}

/** Reads one exact plain-property path from a selected neural state fixture without invoking getters. */
function readPreviewInspectorNeuralRenderStatePath(value, path) {
  const segments = typeof path === 'string' ? path.split('.') : [];
  if (
    segments.length === 0 || segments.length > 8 ||
    segments.some((segment) =>
      segment.length === 0 || ['__proto__', 'constructor', 'prototype'].includes(segment)
    )
  ) return { found: false, value: undefined };
  let current = value;
  for (const segment of segments) {
    if (
      current === null || (typeof current !== 'object' && typeof current !== 'function') ||
      !Object.prototype.hasOwnProperty.call(current, segment)
    ) return { found: false, value: undefined };
    current = current[segment];
  }
  return { found: true, value: current };
}

/** Finds one unambiguous selected render-state scalar for the condition's exact source module. */
function readPreviewInspectorNeuralRenderStateScalar(condition, path) {
  const sourcePath = normalizePreviewInspectorReachabilityPath(condition?.sourcePath);
  const recommendations = previewInspectorSession
    .runtimeFallbackSharedNeuralRecommendationsByContract;
  if (sourcePath.length === 0 || !(recommendations instanceof Map)) {
    return { found: false, value: undefined };
  }
  let selected;
  let found = false;
  for (const recommendation of recommendations.values()) {
    if (
      typeof recommendation?.smartPathCandidateId !== 'string' ||
      !recommendation.smartPathCandidateId.startsWith('render-state:') ||
      normalizePreviewInspectorReachabilityPath(recommendation.sourcePath) !== sourcePath ||
      !(recommendation.sharedGuardPaths ?? []).includes(path)
    ) continue;
    const candidate = readPreviewInspectorNeuralRenderStatePath(recommendation.value, path);
    if (!candidate.found) continue;
    if (found && !Object.is(selected, candidate.value)) {
      return { found: false, value: undefined };
    }
    found = true;
    selected = candidate.value;
  }
  return { found, value: selected };
}

/** Reports whether one selected render-state recommendation belongs to the exact target source. */
function hasPreviewInspectorNeuralRenderStateForSource(rawSourcePath) {
  const sourcePath = normalizePreviewInspectorReachabilityPath(rawSourcePath);
  const recommendations = previewInspectorSession
    .runtimeFallbackSharedNeuralRecommendationsByContract;
  if (sourcePath.length === 0 || !(recommendations instanceof Map)) return false;
  return [...recommendations.values()].some((recommendation) =>
    typeof recommendation?.smartPathCandidateId === 'string' &&
    recommendation.smartPathCandidateId.startsWith('render-state:') &&
    normalizePreviewInspectorReachabilityPath(recommendation.sourcePath) === sourcePath
  );
}

/** Evaluates compiler-proven scalar logic only when every required neural state leaf is known. */
function evaluatePreviewInspectorNeuralRenderStateExpression(condition, expression, depth = 0) {
  if (expression === null || typeof expression !== 'object' || depth > 6) return undefined;
  if (expression.kind === 'comparison') {
    const selected = readPreviewInspectorNeuralRenderStateScalar(condition, expression.path);
    if (!selected.found) return undefined;
    if (expression.operator === '===') return selected.value === expression.value;
    if (expression.operator === '!==') return selected.value !== expression.value;
    if (expression.operator === '==') {
      // Compiler metadata admits only primitive literals; reproduce the useful nullish coercion.
      return selected.value === expression.value ||
        selected.value == null && expression.value == null;
    }
    if (expression.operator === '!=') {
      return !(selected.value === expression.value ||
        selected.value == null && expression.value == null);
    }
    return undefined;
  }
  if (expression.kind === 'not') {
    const operand = evaluatePreviewInspectorNeuralRenderStateExpression(
      condition,
      expression.operand,
      depth + 1,
    );
    return typeof operand === 'boolean' ? !operand : undefined;
  }
  if (expression.kind !== 'and' && expression.kind !== 'or') return undefined;
  const left = evaluatePreviewInspectorNeuralRenderStateExpression(
    condition,
    expression.left,
    depth + 1,
  );
  const right = evaluatePreviewInspectorNeuralRenderStateExpression(
    condition,
    expression.right,
    depth + 1,
  );
  if (expression.kind === 'and') {
    if (left === false || right === false) return false;
    return left === true && right === true ? true : undefined;
  }
  if (left === true || right === true) return true;
  return left === false && right === false ? false : undefined;
}

/** Requires a gate to belong to a statically proven path source or named path component. */
function isPreviewInspectorConditionOnTargetPath(condition, evidence) {
  if (evidence.exactConditionIds?.has(condition?.id)) return true;
  const ownerName = typeof condition?.ownerName === 'string' ? condition.ownerName : '';
  if (
    evidence.localComponentOwnerNames?.has(ownerName) &&
    !evidence.repeatedOwnerNames?.has(ownerName)
  ) return true;
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
  const coherentNeuralValue = evaluatePreviewInspectorNeuralRenderStateExpression(
    condition,
    condition?.scalarExpression,
  );
  if (typeof coherentNeuralValue === 'boolean') return coherentNeuralValue;
  const truthyScore = scorePreviewInspectorTargetConditionLabel(condition?.truthyLabel, evidence);
  const falsyScore = scorePreviewInspectorTargetConditionLabel(condition?.falsyLabel, evidence);
  const truthyNamesExactTarget = labelsPreviewInspectorExactTargetCondition(
    condition?.truthyLabel,
    evidence,
  );
  const falsyNamesExactTarget = labelsPreviewInspectorExactTargetCondition(
    condition?.falsyLabel,
    evidence,
  );
  /* An exact target label can correct conservative continuation metadata. Shared wrapper labels cannot. */
  if (truthyNamesExactTarget !== falsyNamesExactTarget) return truthyNamesExactTarget;
  const truthyComponentScore = scorePreviewInspectorTargetComponentConditionLabel(
    condition?.truthyLabel,
    evidence,
  );
  const falsyComponentScore = scorePreviewInspectorTargetComponentConditionLabel(
    condition?.falsyLabel,
    evidence,
  );
  /*
   * Early-return metadata describes the generic continuation, not the selected render path. When
   * that path explicitly descends through one returned component, its deeper authored component
   * step is stronger evidence. Wrapper-only names stay excluded because they may surround both arms.
   */
  if (
    truthyComponentScore !== falsyComponentScore &&
    Math.max(truthyComponentScore, falsyComponentScore) > 0
  ) return truthyComponentScore > falsyComponentScore;
  if (condition?.targetBranch === 'truthy') return true;
  if (condition?.targetBranch === 'falsy') return false;
  /* Every compiler-issued logical-and guard exposes its JSX terminal only on the truthy side. */
  if (condition?.kind === 'logical-and') return true;
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
  if (condition?.fallbackBranch === 'truthy') return false;
  if (condition?.fallbackBranch === 'falsy') return true;
  return undefined;
}
`;
}
