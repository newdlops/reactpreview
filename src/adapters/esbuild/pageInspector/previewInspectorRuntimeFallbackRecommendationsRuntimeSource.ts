/**
 * Materializes compiler-admitted data-flow and nested-value candidates without inventing training labels.
 * This adapter emits a lexical fragment composed by previewInspectorRuntimeFallbackRuntimeSource.
 * Session state and helper ownership remain in the same generated browser module.
 */

/** Returns the ordered browser fragment; no project code runs during source generation. */
export function createPreviewInspectorRuntimeFallbackRecommendationsRuntimeSource(): string {
  return String.raw`
/** Reads only compiler-tagged callable candidates that can retain a rendered collection. */
function readPreviewInspectorRuntimeFallbackDataFlowSmartValues(metadata) {
  return (Array.isArray(metadata?.smartPathValues) ? metadata.smartPathValues : [])
    .filter((item) =>
      item?.role === 'collection-filter-predicate' &&
      typeof item?.path === 'string' && item.path.endsWith('()') &&
      typeof item?.value === 'boolean',
    )
    .slice(0, 8);
}

/**
 * Lets the residual choose a callable data valve and keeps its cold compiler fallback unchanged.
 * The first unseen site explores the data-retaining candidate; the owning render attempt combines
 * its live call counters with target output before training the isolated data-collection head.
 */
function createPreviewInspectorRuntimeFallbackDataFlowRecommendation(metadata, compilerFallback) {
  const smartValues = readPreviewInspectorRuntimeFallbackDataFlowSmartValues(metadata);
  if (smartValues.length === 0) return undefined;
  const signature = JSON.stringify([
    typeof readPreviewInspectorNeuralLearningModelUpdates === 'function'
      ? readPreviewInspectorNeuralLearningModelUpdates()
      : 0,
    smartValues.map((item) => [item.path, item.value, item.role]),
  ]);
  const cached = previewInspectorSession.runtimeFallbackDataFlowRecommendations.get(metadata.id);
  if (cached?.signature === signature) return cached;
  const requiredPaths = normalizePreviewInspectorRequiredPropertyPaths(metadata.requiredPaths);
  const candidates = [
    {
      deterministicRank: 0,
      id: 'retain-generated-collection',
      numbers: { callableCandidateCount: smartValues.length, retainsData: 1 },
      texts: ['Return the compiler-admitted predicate candidate and retain generated rows'],
      tokens: ['strategy:data-retaining-call-result', 'role:collection-filter-predicate'],
    },
    {
      deterministicRank: 1,
      id: 'neutral-callable',
      numbers: { callableCandidateCount: smartValues.length, retainsData: 0 },
      texts: ['Keep the generated callable inert'],
      tokens: ['strategy:neutral-call-result', 'role:collection-filter-predicate'],
    },
  ];
  const selection = typeof selectPreviewInspectorNeuralResidualCandidate === 'function'
    ? selectPreviewInspectorNeuralResidualCandidate(
        {
          blockerKind: 'runtime-fallback',
          holeKind: 'rendered-collection-consumer-data',
          numbers: {
            callableCandidateCount: smartValues.length,
            requiredPathCount: requiredPaths.length,
          },
          texts: [
            metadata.evidence,
            metadata.hookName,
            metadata.ownerName,
            metadata.sourcePath,
            ...smartValues.map((item) => item.path),
          ],
          tokens: [
            'compiler-call-result-candidate',
            ...smartValues.map((item) => 'role:' + item.role),
          ],
        },
        candidates,
      )
    : undefined;
  const candidateId = selection?.candidateId === 'neutral-callable'
    ? 'neutral-callable'
    : 'retain-generated-collection';
  const selectedSmartValues = candidateId === 'retain-generated-collection'
    ? smartValues
    : [];
  const draft = createPreviewInspectorRuntimeFallbackSmartDraftTemplate(
    compilerFallback,
    requiredPaths,
    selectedSmartValues,
  );
  const signal = {
    calls: 0,
    candidateId,
    paths: new Set(smartValues.map((item) => item.path.slice(0, -2))),
    truthyReturns: 0,
  };
  const value = materializePreviewInspectorRuntimeFallbackOverride(draft, 0, signal);
  markPreviewInspectorGeneratedValue(value);
  const recommendation = Object.freeze({
    candidateId,
    decision: selection?.decision,
    signal,
    signature,
    summary: Object.freeze({
      candidateId,
      label: candidateId === 'retain-generated-collection'
        ? 'Learned data-retaining callable'
        : 'Learned neutral callable',
      paths: Object.freeze(smartValues.map((item) => item.path)),
      residual: typeof summarizePreviewInspectorNeuralResidualDecision === 'function'
        ? summarizePreviewInspectorNeuralResidualDecision(selection?.decision)
        : undefined,
      strategy: candidateId,
    }),
    value,
  });
  previewInspectorSession.runtimeFallbackDataFlowRecommendations.set(metadata.id, recommendation);
  previewInspectorSession.runtimeFallbackDataFlowSignals.set(metadata.id, signal);
  if (selection?.decision !== undefined) {
    previewInspectorSession.runtimeFallbackNeuralDecisions.set(metadata.id, selection.decision);
  }
  return recommendation;
}

/**
 * Creates a typed recommendation when a nested generated primitive contradicts its caller's shape.
 * The neural residual sees semantic candidate descriptions only; materialization remains in the
 * existing bounded blocker-value runtime and defaults to the non-branch-opening shape on a tie.
 */
function createPreviewInspectorNestedRuntimeFallbackRecommendation(
  metadata,
  authoredValue,
  compilerFallback,
  resolutionFrame,
  hookIdentity,
) {
  const authoredKind = readPreviewInspectorRuntimeFallbackValueKind(authoredValue);
  const fallbackKind = readPreviewInspectorRuntimeFallbackValueKind(compilerFallback);
  const requiredPaths = normalizePreviewInspectorRequiredPropertyPaths(metadata.requiredPaths);
  const sharedMatch = readPreviewInspectorRuntimeSharedNeuralRecommendation(
    metadata,
    hookIdentity,
  );
  const sharedRecommendation = sharedMatch?.recommendation;
  if (sharedRecommendation !== undefined) {
    const sharedValue = materializePreviewInspectorRuntimeFallbackOverride(
      copyPreviewInspectorBlockerValueForJson(sharedRecommendation.value, { nodes: 0 }),
    );
    const localDraft = createPreviewInspectorRuntimeFallbackSmartDraftTemplate(
      compilerFallback,
      requiredPaths,
      [],
    );
    const localValue = materializePreviewInspectorRuntimeFallbackOverride(localDraft);
    const localCompletion = completePreviewInspectorGeneratedValue(sharedValue, localValue, {
      requiredPaths,
    });
    const compatibleSharedValue = localCompletion.changed
      ? localCompletion.value
      : sharedValue;
    const sharedGuardPaths = normalizePreviewInspectorRequiredPropertyPaths(
      sharedRecommendation.sharedGuardPaths,
    );
    const authoredCompletion = isPreviewInspectorRuntimeFallbackSharedIdentity(authoredValue)
      ? completePreviewInspectorGeneratedValue(authoredValue, compatibleSharedValue, {
          renderGuardPaths: sharedGuardPaths,
          requiredPaths: normalizePreviewInspectorRequiredPropertyPaths([
            ...requiredPaths,
            ...sharedGuardPaths,
          ]),
        })
      : { changed: false, value: authoredValue };
    const value = authoredCompletion.changed
      ? authoredCompletion.value
      : isPreviewInspectorRuntimeFallbackSharedIdentity(authoredValue)
        ? authoredValue
        : compatibleSharedValue;
    markPreviewInspectorGeneratedValue(value);
    if (typeof recordPreviewInspectorRuntimeHealth === 'function') {
      recordPreviewInspectorRuntimeHealth({
        category: 'neural-residual',
        detail: {
          authoredKind,
          changed: authoredCompletion.changed === true,
          hookName: metadata.hookName,
          match: sharedMatch.match,
          ownerName: metadata.ownerName,
          phase: 'applied',
          sharedGuardValuePreview: sharedGuardPaths.map((rawPath) => {
            const parsed = parsePreviewInspectorRequiredPath(rawPath);
            const pathValue = parsed === undefined
              ? undefined
              : readPreviewInspectorRequiredPathSeed(value, parsed.path);
            return rawPath + '=' + describePreviewInspectorRuntimeFallbackValue(pathValue);
          }).join(', '),
          sharedGuardPaths,
          strategy: sharedRecommendation.strategy,
        },
        event: 'neural-residual-shared',
      });
    }
    return {
      decision: undefined,
      generatedPaths: normalizePreviewInspectorRequiredPropertyPaths([
        ...requiredPaths,
        ...sharedGuardPaths,
      ]),
      shared: true,
      strategy: sharedRecommendation.strategy,
      summary: {
        ...sharedRecommendation,
        nestedFallbacks: (resolutionFrame?.children ?? []).map((child) => ({
          hookName: child.hookName,
          reason: child.reason,
        })),
        requiredPaths,
        shared: true,
        value: copyPreviewInspectorBlockerValueForJson(value, { nodes: 0 }),
      },
      value,
    };
  }
  if (
    !Array.isArray(resolutionFrame?.children) || resolutionFrame.children.length === 0 ||
    authoredValue === null || authoredValue === undefined ||
    (typeof authoredValue === 'object' || typeof authoredValue === 'function') ||
    (typeof compilerFallback !== 'object' && typeof compilerFallback !== 'function') ||
    compilerFallback === null ||
    !hasPreviewInspectorRuntimeFallbackDescendantRequirement(metadata)
  ) return undefined;
  const shapeDraft = createPreviewInspectorRuntimeFallbackSmartDraftTemplate(
    compilerFallback,
    requiredPaths,
    [],
  );
  const branchDraft = createPreviewInspectorRuntimeFallbackSmartDraftTemplate(
    compilerFallback,
    requiredPaths,
    metadata.smartPathValues,
  );
  let distinctBranchDraft = false;
  try { distinctBranchDraft = JSON.stringify(branchDraft) !== JSON.stringify(shapeDraft); } catch {}
  const requiredPathSet = new Set(requiredPaths);
  const exactSmartPathCount = (Array.isArray(metadata?.smartPathValues)
    ? metadata.smartPathValues
    : []).filter((item) => requiredPathSet.has(item?.path)).length;
  const compilerBranchPreferred = distinctBranchDraft && exactSmartPathCount > 0;
  const candidates = [
    {
      deterministicRank: compilerBranchPreferred ? 1 : 0,
      id: 'shape-only',
      numbers: {
        branchOpening: 0,
        exactSmartPathCount: 0,
        requiredPathCount: requiredPaths.length,
      },
      texts: ['Preserve the compiler fallback scalars and repair only its required shape'],
      tokens: [
        'strategy:shape-only',
        'value-kind:' + fallbackKind,
        'compiler-branch-proof:false',
      ],
    },
    ...(distinctBranchDraft
      ? [{
          deterministicRank: compilerBranchPreferred ? 0 : 1,
          id: 'branch-opening',
          numbers: {
            branchOpening: 1,
            exactSmartPathCount,
            requiredPathCount: requiredPaths.length,
          },
          texts: [
            'Use compiler-proven branch scalars while repairing the required shape',
            (metadata.smartPathValues ?? []).map((item) => item?.path).join(' '),
          ],
          tokens: [
            'strategy:branch-opening',
            'value-kind:' + fallbackKind,
            'compiler-branch-proof:' + String(compilerBranchPreferred),
          ],
        }]
      : []),
  ];
  const demands = requiredPaths.slice(0, 64).map(parsePreviewInspectorRequiredPath).filter(Boolean);
  const specification = {
    blockerKind: 'runtime-fallback',
    holeKind: 'blocker-exception-runtime-value',
    recoveryContext: {
      collectionDemandCount: demands.filter((path) => path.collection).length,
      callableDemandCount: demands.filter((path) => path.callable).length,
      stringDemandCount: demands.filter((path) => path.stringReceiver).length,
      numericDemandCount: demands.filter((path) => ['toFixed', 'toPrecision', 'toExponential'].includes(path.methodName)).length,
      scalarGuardCount: exactSmartPathCount,
      nestedThrowCount: resolutionFrame.children.filter((child) => child.reason === 'threw').length,
      remainingCandidateCount: candidates.length,
    },
    numbers: {
      nestedFallbackCount: resolutionFrame.children.length,
      requiredPathCount: requiredPaths.length,
    },
    texts: [
      metadata.evidence,
      metadata.hookName,
      metadata.ownerName,
      metadata.sourcePath,
      requiredPaths.join(' '),
    ],
    tokens: [
      'authored-kind:' + authoredKind,
      'fallback-kind:' + fallbackKind,
      ...requiredPaths.slice(0, 16).map((path) => 'required:' + path),
      ...resolutionFrame.children.slice(0, 8).map(
        (child) => 'nested:' + child.hookName + ':' + child.reason,
      ),
    ],
  };
  const selection = typeof selectPreviewInspectorNeuralResidualCandidate === 'function'
    ? selectPreviewInspectorNeuralResidualCandidate(specification, candidates)
    : undefined;
  const strategy = selection?.candidateId === 'branch-opening'
    ? 'branch-opening'
    : 'shape-only';
  const decision = strategy === 'branch-opening'
    ? previewInspectorSession.runtimeFallbackNeuralDecisions.get(metadata.id) ?? selection?.decision
    : selection?.decision;
  const draft = strategy === 'branch-opening' ? branchDraft : shapeDraft;
  const value = materializePreviewInspectorRuntimeFallbackOverride(draft);
  const safeValue = strategy === 'shape-only'
    ? value
    : materializePreviewInspectorRuntimeFallbackOverride(shapeDraft);
  const sharedGuardPaths = requiredPaths.filter((rawPath) => {
    const parsed = parsePreviewInspectorRequiredPath(rawPath);
    if (parsed === undefined || parsed.callable || parsed.collection || parsed.stringReceiver) {
      return false;
    }
    const leaf = readPreviewInspectorRequiredPathSeed(value, parsed.path);
    return leaf === null || ['boolean', 'number', 'string'].includes(typeof leaf);
  });
  markPreviewInspectorGeneratedValue(value);
  markPreviewInspectorGeneratedValue(safeValue);
  return {
    decision,
    generatedPaths: requiredPaths,
    safeValue,
    sharedGuardPaths,
    strategy,
    summary: {
      label: strategy === 'branch-opening'
        ? 'Compiler branch value'
        : 'Minimum compatible hook value',
      nestedFallbacks: resolutionFrame.children.map((child) => ({
        hookName: child.hookName,
        reason: child.reason,
      })),
      requiredPaths,
      residual: typeof summarizePreviewInspectorNeuralResidualDecision === 'function'
        ? summarizePreviewInspectorNeuralResidualDecision(decision)
        : undefined,
      sharedGuardPaths,
      strategy,
      value: copyPreviewInspectorBlockerValueForJson(value, { nodes: 0 }),
    },
    value,
  };
}
`;
}
