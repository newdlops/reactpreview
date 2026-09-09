/**
 * Validates compiler-issued hook metadata and bounded runtime path demands.
 * This adapter emits a lexical fragment composed by previewInspectorRuntimeFallbackRuntimeSource.
 * Session state and helper ownership remain in the same generated browser module.
 */

/** Returns the ordered browser fragment; no project code runs during source generation. */
export function createPreviewInspectorRuntimeFallbackMetadataRuntimeSource(): string {
  return String.raw`
/** Reports whether a thrown value is a Suspense thenable that React must continue to own. */
function isPreviewInspectorRuntimeThenable(value) {
  if ((typeof value !== 'object' && typeof value !== 'function') || value === null) return false;
  try {
    return typeof value.then === 'function';
  } catch {
    return false;
  }
}

/** Bounds compiler-proven fragment literals before they can affect generated browser data. */
function normalizePreviewInspectorRuntimeLiteralDemands(rawDemands) {
  const demands = [];
  const seen = new Set();
  for (const rawDemand of Array.isArray(rawDemands) ? rawDemands.slice(0, 32) : []) {
    if (rawDemand === null || typeof rawDemand !== 'object') continue;
    const path = rawDemand.path;
    const value = rawDemand.value;
    if (
      typeof path !== 'string' ||
      path.length === 0 ||
      path.length > 240 ||
      seen.has(path) ||
      !path.split('.').every(
        (segment) =>
          segment === '[]' ||
          (/^[A-Za-z_$][A-Za-z0-9_$]*$/u.test(segment) && !blockedInspectorPropNames.has(segment)),
      ) ||
      !(
        typeof value === 'string' ||
        typeof value === 'boolean' ||
        (typeof value === 'number' && Number.isFinite(value))
      )
    ) {
      continue;
    }
    seen.add(path);
    demands.push(Object.freeze({ path, value }));
  }
  return Object.freeze(demands);
}

/** Retains and ranks bounded scalar values statically proven for target-only Smart Fill. */
function normalizePreviewInspectorRuntimeSmartPathValues(rawValues, metadata) {
  const values = [];
  const seen = new Set();
  for (const rawValue of Array.isArray(rawValues) ? rawValues.slice(0, 32) : []) {
    if (rawValue === null || typeof rawValue !== 'object') continue;
    const path = normalizePreviewInspectorRequiredPropertyPaths([rawValue.path])[0];
    const value = rawValue.value;
    if (
      typeof path !== 'string' || path.length === 0 ||
      !(
        typeof value === 'string' || typeof value === 'boolean' ||
        (typeof value === 'number' && Number.isFinite(value))
      )
    ) continue;
    const role = ['collection-filter-predicate', 'render-state'].includes(rawValue.role)
      ? rawValue.role
      : undefined;
    const identity = role === 'render-state'
      ? path + '\0' + typeof value + '\0' + String(value)
      : path;
    if (seen.has(identity)) continue;
    seen.add(identity);
    values.push(Object.freeze({
      deterministicRank: Number.isFinite(rawValue.deterministicRank)
        ? Math.max(0, Number(rawValue.deterministicRank))
        : values.length,
      path,
      value,
      ...(role === undefined ? {} : { role }),
    }));
  }
  const selectedValues = values.filter((item) => item.role !== 'render-state');
  const renderStateGroups = new Map();
  for (const item of values.filter((candidate) => candidate.role === 'render-state')) {
    const group = renderStateGroups.get(item.path) ?? [];
    group.push(item);
    renderStateGroups.set(item.path, group);
  }
  let retainedSelection;
  for (const [path, group] of renderStateGroups) {
    const candidates = group.map((item, index) => {
      const semanticValue = String(item.value).toLowerCase().replace(/[^a-z0-9_-]+/gu, '-').slice(0, 48);
      return {
        deterministicRank: item.deterministicRank,
        id: 'render-state:' + typeof item.value + ':' + (semanticValue || String(index)),
        numbers: {
          authoredCandidateCount: group.length,
          authoredRank: item.deterministicRank,
        },
        texts: ['Select authored render state ' + String(item.value), path],
        tokens: [
          'role:render-state',
          'path:' + path,
          'semantic:' + semanticValue,
          'value-type:' + typeof item.value,
        ],
        value: item,
      };
    });
    const selection = typeof selectPreviewInspectorNeuralResidualCandidate === 'function'
      ? selectPreviewInspectorNeuralResidualCandidate(
          {
            blockerKind: 'runtime-fallback',
            holeKind: 'render-state-scalar',
            numbers: { authoredCandidateCount: candidates.length },
            texts: [
              metadata?.evidence,
              metadata?.hookName,
              metadata?.ownerName,
              metadata?.sourcePath,
              path,
            ],
            tokens: ['compiler-render-state-candidates', 'path:' + path],
          },
          candidates,
        )
      : undefined;
    const chosen = candidates.find((candidate) => candidate.id === selection?.candidateId) ??
      candidates.sort((left, right) =>
        left.deterministicRank - right.deterministicRank || left.id.localeCompare(right.id),
      )[0];
    if (chosen !== undefined) selectedValues.push(chosen.value);
    if (retainedSelection === undefined && selection !== undefined) retainedSelection = selection;
  }
  return Object.freeze({
    candidateId: retainedSelection?.candidateId,
    decision: retainedSelection?.decision,
    values: Object.freeze(selectedValues),
  });
}

/** Bounds compiler metadata before retaining it in the local webview session. */
function normalizePreviewInspectorRuntimeFallbackMetadata(metadata) {
  const source = metadata !== null && typeof metadata === 'object' ? metadata : {};
  const readText = (name, fallback = '') =>
    typeof source[name] === 'string'
      ? source[name].slice(0, PREVIEW_INSPECTOR_RUNTIME_FALLBACK_TEXT_LIMIT)
      : fallback;
  const smartPathSelection = normalizePreviewInspectorRuntimeSmartPathValues(
    source.smartPathValues,
    source,
  );
  const semanticValueDemand = normalizePreviewInspectorRuntimeSemanticValueDemand(
    source.semanticValueDemand,
  );
  return {
    column: Number.isSafeInteger(source.column) && source.column > 0 ? source.column : undefined,
    evidence: readText('evidence', 'bounded static hook usage inference'),
    failurePaths: normalizePreviewInspectorRequiredPropertyPaths(source.failurePaths),
    fallbackLabel: readText('fallbackLabel', 'generated static value'),
    hookName: readText('hookName', 'custom hook'),
    id: readText('id'),
    line: Number.isSafeInteger(source.line) && source.line > 0 ? source.line : undefined,
    literalDemands: normalizePreviewInspectorRuntimeLiteralDemands(source.literalDemands),
    moduleSpecifier: readText('moduleSpecifier'),
    nonNegativeNumberPaths: normalizePreviewInspectorRequiredPropertyPaths(
      source.nonNegativeNumberPaths,
    ),
    ownerName: readText('ownerName'),
    passive: source.passive === true,
    preserveNullish: source.preserveNullish === true,
    preserveSmartValue: source.preserveSmartValue === true,
    renderGuardPaths: normalizePreviewInspectorRequiredPropertyPaths(source.renderGuardPaths),
    requiredPaths: normalizePreviewInspectorRequiredPropertyPaths(source.requiredPaths),
    semanticValueDemand,
    neuralSmartPathDecision: smartPathSelection.decision,
    smartPathCandidateId: smartPathSelection.candidateId,
    smartPathValues: smartPathSelection.values,
    sourcePath: readText('sourcePath'),
  };
}

/** Accepts only compiler-issued scalar identity evidence at one normalized result path. */
function normalizePreviewInspectorRuntimeSemanticValueDemand(value) {
  if (value?.kind !== 'identity' || typeof value?.path !== 'string') return undefined;
  const path = normalizePreviewInspectorRequiredPropertyPaths([value.path])[0];
  const parsed = parsePreviewInspectorRequiredPath(path);
  if (
    typeof path !== 'string' || parsed === undefined || parsed.callable || parsed.collection ||
    parsed.stringReceiver || parsed.path.length === 0
  ) return undefined;
  return Object.freeze({ kind: 'identity', path });
}

/** Creates the exact compiler/runtime requirement coverage owned by one applied Smart value. */
function createPreviewInspectorRuntimeFallbackPathSignature(requiredPaths) {
  // Property access order can vary across equivalent React branches. Treat the evidence as a set so
  // an order-only change cannot reopen a settled Smart fallback and restart automatic resolution.
  return JSON.stringify([...normalizePreviewInspectorRequiredPropertyPaths(requiredPaths)].sort());
}

/** Separates a shared query-wrapper callsite into one fallback record per authored request. */
function scopePreviewInspectorRuntimeFallbackMetadata(metadata, readDocument, readOptions) {
  const renderPropPaths = readPreviewInspectorGraphqlRenderPropUsagePaths(readDocument);
  const renderPropLiteralDemands =
    readPreviewInspectorGraphqlRenderPropLiteralDemands(readDocument);
  const renderGuardPaths = renderPropLiteralDemands.map((demand) => demand.path);
  const mergedMetadata = renderPropPaths.length === 0 && renderGuardPaths.length === 0
    ? metadata
    : {
        ...metadata,
        requiredPaths: normalizePreviewInspectorRequiredPropertyPaths([
          ...metadata.requiredPaths,
          ...renderPropPaths,
        ]),
        renderGuardPaths: normalizePreviewInspectorRequiredPropertyPaths([
          ...metadata.renderGuardPaths,
          ...renderGuardPaths,
        ]),
      };
  if (mergedMetadata.id.length === 0) return mergedMetadata;
  const requestIdentity = createPreviewInspectorHookGraphqlRequestIdentity(
    readDocument,
    readOptions,
  );
  if (requestIdentity.length === 0) return mergedMetadata;
  const graphqlRequiredPaths = normalizePreviewInspectorRequiredPropertyPaths([
    ...mergedMetadata.requiredPaths,
    ...mergedMetadata.failurePaths,
  ]);
  const suffix = ':graphql:' + requestIdentity;
  return {
    ...mergedMetadata,
    graphqlSelectionBacked: true,
    id: mergedMetadata.id.slice(0, PREVIEW_INSPECTOR_RUNTIME_FALLBACK_TEXT_LIMIT - suffix.length) + suffix,
    /*
     * Optional access may keep an unknown hook root absent, but the reached DocumentNode already
     * proves which response fields exist. Once selection-shaped preview data is present, an Array
     * operation recorded as a failure path is authoritative type evidence and must repair a
     * schema-less object/list guess before application code invokes map/filter/find.
     */
    requiredPaths: graphqlRequiredPaths,
  };
}
`;
}
