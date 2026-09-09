/** Generates bounded, source-owned page context and next-step evidence for neural choices. */
export function createPreviewInspectorNeuralChoiceContextRuntimeSource(): string {
  return String.raw`
/** Reads metadata without invoking an authored accessor, coercion, or recursive value walk. */
function readPreviewInspectorNeuralChoiceContextData(value, key) {
  try { return Object.getOwnPropertyDescriptor(value, key)?.value; } catch { return undefined; }
}

/** Bounds text before it becomes transient context; full data and URL queries are never collected. */
function readPreviewInspectorNeuralChoiceContextText(value, limit = 240) {
  return typeof value === 'string' ? value.slice(0, limit).replace(/\s+/gu, ' ').trim() : '';
}

/** Reads the authored route and exact selected source instead of the generated webview address. */
function readPreviewInspectorNeuralChoicePageContext() {
  let descriptor, candidate, reachability;
  try {
    descriptor = typeof findSelectedPreviewInspectorDescriptor === 'function'
      ? findSelectedPreviewInspectorDescriptor() : undefined;
    candidate = typeof readSelectedPreviewInspectorPageCandidate === 'function'
      ? readSelectedPreviewInspectorPageCandidate(descriptor) : undefined;
    reachability = typeof readPreviewInspectorNeuralAssistanceReachability === 'function'
      ? readPreviewInspectorNeuralAssistanceReachability() : undefined;
  } catch { /* Missing page metadata does not authorize a guessed context. */ }
  const read = readPreviewInspectorNeuralChoiceContextData;
  const text = readPreviewInspectorNeuralChoiceContextText;
  const inspector = read(descriptor, 'inspector');
  const target = read(inspector, 'target');
  const root = read(candidate, 'root') ?? read(inspector, 'root');
  const location = read(candidate, 'routeLocation');
  const route = text(read(location, 'pattern') || read(location, 'pathname')).split(/[?#]/u)[0];
  const targetName = text(read(target, 'exportName') ?? previewInspectorSession.selectedExportName);
  const targetSource = text(read(target, 'sourcePath') ?? read(descriptor, 'sourcePath'), 1_024)
    .replaceAll('\\', '/');
  const rootName = text(read(root, 'exportName'));
  const rootSource = text(read(root, 'sourcePath'), 1_024).replaceAll('\\', '/');
  const goal = read(reachability, 'targetHasOutput') === true ? 'preserve-output' : 'render-target';
  const scopeKey = hashPreviewInspectorNeuralFiniteChoiceSignature(JSON.stringify([
    targetName, targetSource, rootName, rootSource, route,
  ]));
  return Object.freeze({
    goal, rootName, rootSource, route, scopeKey, targetName, targetSource,
    reachabilityKey: text(read(reachability, 'key'), 1_024),
    status: text(read(reachability, 'status'), 80),
  });
}

/** Keeps only explicit required field paths, never a match against generic page words. */
function readPreviewInspectorNeuralChoiceContextPaths(value) {
  if (!Array.isArray(value)) return [];
  const paths = [];
  for (let index = 0; index < Math.min(value.length, 32); index += 1) {
    const path = readPreviewInspectorNeuralChoiceContextData(value, String(index));
    if (typeof path !== 'string' || path.length > 240) continue;
    const normalized = path.replace(/^(?:this\.)?props\./u, '').replace(/\(\)$/u, '');
    if (/^[\w$]+(?:\.[\w$]+)*$/u.test(normalized) && !paths.includes(normalized)) paths.push(normalized);
  }
  return paths;
}

/** Proves why one decision belongs to this page and what the source says it can change. */
function readPreviewInspectorNeuralChoiceUnitContext(unit, page) {
  const read = readPreviewInspectorNeuralChoiceContextData;
  const text = readPreviewInspectorNeuralChoiceContextText;
  const choice = unit.choice;
  const node = read(choice, 'node');
  const blocker = read(node, 'condition') ?? read(node, 'blocker');
  const source = text(read(blocker, 'sourcePath') ?? read(read(node, 'source'), 'path'), 1_024)
    .replaceAll('\\', '/');
  const owner = text(read(blocker, 'runtimeOwnerName') || read(blocker, 'ownerName') ||
    read(blocker, 'blockedComponentName'));
  const expression = text(read(blocker, 'authoredExpression') ?? read(blocker, 'expression'), 512);
  const requiredPaths = readPreviewInspectorNeuralChoiceContextPaths(
    read(blocker, 'targetPropRequiredPaths') ?? read(blocker, 'requiredPaths') ??
      read(read(node, 'props'), 'requiredPaths'),
  );
  const sameSource = source.length > 0 && [page.targetSource, page.rootSource].includes(source);
  const sameCorridor = source.length > 0 && page.reachabilityKey.length > 0 &&
    read(blocker, 'reachabilityKey') === page.reachabilityKey;
  const base = {
    expression, owner, requiredPaths, source,
    currentValue: read(blocker, 'effectiveEnabled'),
    failure: text(read(blocker, 'headline'), 240),
    relation: 'unproven', reason: '',
  };
  if (!sameSource && !sameCorridor) return base;
  if (choice.choiceKind === 'render-condition' && owner.length > 0) {
    if (read(blocker, 'requiresAuthoredState') === true) return {
      ...base, relation: 'authored-state',
      reason: 'Changes the local state read by ' + expression + ' in ' + owner +
        '. Output for ' + page.targetName + ' still needs verification.',
    };
    const branch = read(blocker, 'targetBranch');
    if (branch === 'truthy' || branch === 'falsy') return {
      ...base, relation: 'target-branch', targetValue: branch === 'truthy',
      reason: 'The source places ' + page.targetName + ' on the ' + branch +
        ' continuation of ' + expression + '.',
    };
  }
  if (choice.choiceKind === 'source-proven-prop' && source === page.targetSource &&
      read(choice, 'exportName') === page.targetName) {
    const ownsTarget = owner === page.targetName ||
      typeof isPreviewInspectorSelectedTargetOwnerName === 'function' &&
        isPreviewInspectorSelectedTargetOwnerName(page.targetName, owner);
    const exactDemand = requiredPaths.some((path) => path === unit.path || path.startsWith(unit.path + '.'));
    const soleExhaustiveChoice = choice.choiceRecords?.length === 1 &&
      /(?:^|\b)(?:Unreachable|Unexpected value)(?::|\b)/iu.test(base.failure);
    if (ownsTarget && (exactDemand || soleExhaustiveChoice)) return {
      ...base, relation: 'target-prop',
      reason: 'The current ' + page.targetName + ' failure identifies ' + unit.path +
        '. Change only this authored option; keep other page values.',
    };
  }
  if (['data-request', 'runtime-fallback'].includes(choice.choiceKind) && requiredPaths.length > 0) {
    return { ...base, relation: 'required-value',
      reason: 'Complete ' + requiredPaths.slice(0, 3).join(', ') + ' read on the selected page path.' };
  }
  return base;
}

/** Rejects unchanged or context-unproven actions before any neural ranking takes place. */
function isPreviewInspectorNeuralContextualCandidate(unit, candidate) {
  if (candidate.disabled || candidate.current || candidate.selected) return false;
  const evidence = unit.context;
  if (evidence?.relation === 'target-branch') return candidate.actionKind === 'condition-override' &&
    candidate.value === evidence.targetValue;
  if (evidence?.relation === 'authored-state') return candidate.actionKind === 'page-control';
  if (evidence?.relation === 'target-prop') return candidate.actionKind === undefined;
  if (evidence?.relation === 'required-value') return ['runtime-smart', 'data-smart'].includes(candidate.actionKind);
  return false;
}

/** Builds independent next changes, not the Cartesian product of unrelated page decisions. */
function enumeratePreviewInspectorNeuralContextualCombinations(pathUnits, current) {
  const combinations = [];
  for (const unit of pathUnits) {
    for (const candidate of unit.candidates) {
      if (!isPreviewInspectorNeuralContextualCandidate(unit, candidate)) continue;
      if (combinations.length >= PREVIEW_INSPECTOR_NEURAL_CHOICE_PATH_LIMIT) {
        return { combinations: [], truncated: true };
      }
      combinations.push([{
        candidateId: candidate.candidateId, candidateIndex: candidate.candidateIndex,
        choiceId: unit.choiceId, choiceIndex: unit.choiceIndex, current,
        contextEvidence: unit.context, label: unit.path + ': ' + candidate.label, path: unit.path,
      }]);
    }
  }
  return { combinations, truncated: false };
}

/** Uses the same verified ranking policy after source context has generated the admissible steps. */
function readPreviewInspectorNeuralContextualChoicePaths(choices) {
  return readPreviewInspectorNeuralDerivedChoicePaths(choices, { contextual: true }) ?? {
    context: readPreviewInspectorNeuralChoicePageContext(), contextual: true,
    pathCount: 0, paths: [], recommendationReason: 'insufficient-page-context', truncated: false,
  };
}

/** Rechecks the exact route, state, and current values before a displayed proposal may execute. */
function isPreviewInspectorNeuralContextualChoicePathCurrent(path, choices) {
  if (path?.contextual !== true) return true;
  const state = createPreviewInspectorNeuralChoicePathState(choices);
  return state !== undefined && state.id === path.contextStateId;
}
`;
}
