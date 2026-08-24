/**
 * Generates the bounded neural row strategy for compiler-proven GraphQL collection consumers.
 *
 * The model chooses only between admitted row counts. Query selection shapes still own fields,
 * compiler literals own filter exemplars, and non-demanded corridor collections remain empty.
 */

/** Creates browser source for rendered-collection admission, materialization, and verification. */
export function createPreviewInspectorRenderedCollectionNeuralRuntimeSource(): string {
  return String.raw`
const PREVIEW_INSPECTOR_HOOK_GRAPHQL_RENDERED_COLLECTION_LIMIT = 8;
const PREVIEW_INSPECTOR_HOOK_GRAPHQL_OPERATION_DEMAND_LIMIT = 64;
const previewInspectorHookGraphqlOperationDemands = new Map();
const previewInspectorHookGraphqlPendingRenderedCollectionRecommendations = new WeakMap();
const previewInspectorHookGraphqlRecordedRenderedCollectionRecommendations = new WeakSet();

/** Reads the stable operation identity used to bridge DocumentNode demand into virtual requests. */
function readPreviewInspectorHookGraphqlOperationDescriptor(document) {
  try {
    const operation = Array.isArray(document?.definitions)
      ? document.definitions.find((definition) => definition?.kind === 'OperationDefinition')
      : undefined;
    const source = document?.loc?.source?.body;
    if (
      operation === undefined ||
      typeof source !== 'string' ||
      source.length === 0 ||
      source.length > PREVIEW_INSPECTOR_HOOK_GRAPHQL_SOURCE_LIMIT
    ) return undefined;
    const operationName = typeof operation?.name?.value === 'string' ? operation.name.value : '';
    return Object.freeze({
      operationName,
      sourceIdentity: hashPreviewInspectorHookGraphqlRequestIdentity(operationName + '\0' + source),
    });
  } catch {
    return undefined;
  }
}

/** Retains bounded compiler demand by operation so a corridor-mode transport can honor it. */
function registerPreviewInspectorHookGraphqlOperationDemand(document, paths, literalDemands) {
  const descriptor = readPreviewInspectorHookGraphqlOperationDescriptor(document);
  if (descriptor === undefined) return;
  if (
    !previewInspectorHookGraphqlOperationDemands.has(descriptor.sourceIdentity) &&
    previewInspectorHookGraphqlOperationDemands.size >=
      PREVIEW_INSPECTOR_HOOK_GRAPHQL_OPERATION_DEMAND_LIMIT
  ) return;
  previewInspectorHookGraphqlOperationDemands.set(
    descriptor.sourceIdentity,
    Object.freeze({
      literalDemands: Object.freeze([...literalDemands].slice(0, 32)),
      operationName: descriptor.operationName,
      paths: Object.freeze([...paths].slice(0, 32)),
      sourceIdentity: descriptor.sourceIdentity,
    }),
  );
}

/** Reads one compiler demand directly from its exact DocumentNode. */
function readPreviewInspectorHookGraphqlDocumentDemand(readDocument) {
  if (typeof readDocument !== 'function') return undefined;
  try {
    const document = readDocument();
    const paths = previewInspectorHookGraphqlRenderPropUsages.get(document) ?? [];
    if (paths.length === 0) return undefined;
    const descriptor = readPreviewInspectorHookGraphqlOperationDescriptor(document);
    return Object.freeze({
      literalDemands: previewInspectorHookGraphqlRenderPropLiteralDemands.get(document) ?? [],
      operationName: descriptor?.operationName ?? '',
      paths,
      sourceIdentity: descriptor?.sourceIdentity ?? '',
    });
  } catch {
    return undefined;
  }
}

/** Walks a normalized response shape through property and item segments without invoking getters. */
function readPreviewInspectorHookGraphqlShapeAtPath(shape, segments) {
  let current = shape;
  for (const segment of segments) {
    if (segment === '[]') {
      if (current?.kind !== 'array') return undefined;
      current = readPreviewInspectorHookGraphqlOwnValue(current, 'items');
      continue;
    }
    if (blockedInspectorPropNames.has(segment) || current?.kind !== 'object') return undefined;
    const fields = readPreviewInspectorHookGraphqlOwnValue(current, 'fields');
    current = readPreviewInspectorHookGraphqlOwnValue(fields, segment);
    if (current === undefined) return undefined;
  }
  return current;
}

/** Admits only compiler-rendered paths that resolve to actual arrays in the inferred query shape. */
function readPreviewInspectorHookGraphqlRenderedCollectionPaths(shape, paths) {
  return [...new Set((Array.isArray(paths) ? paths : []).flatMap((path) => {
    if (
      typeof path !== 'string' ||
      !/^data(?:\.[A-Za-z_$][A-Za-z0-9_$]*|\.\[\]){1,11}\.\[\]$/u.test(path)
    ) return [];
    const segments = path.slice('data.'.length).split('.');
    const collectionShape = readPreviewInspectorHookGraphqlShapeAtPath(shape, segments.slice(0, -1));
    return collectionShape?.kind === 'array' ? [path] : [];
  }))].sort((left, right) =>
    left.split('.').length - right.split('.').length || left.localeCompare(right),
  ).slice(0, PREVIEW_INSPECTOR_HOOK_GRAPHQL_RENDERED_COLLECTION_LIMIT);
}

/** Matches one virtual GraphQL request to exactly one compatible compiler demand. */
function readPreviewInspectorHookGraphqlRequestDemand(metadata) {
  const operationName = typeof metadata?.operationName === 'string' ? metadata.operationName : '';
  const sourceIdentity = typeof metadata?.graphqlSourceIdentity === 'string'
    ? metadata.graphqlSourceIdentity
    : '';
  const allCandidates = [...previewInspectorHookGraphqlOperationDemands.values()];
  const exactCandidates = sourceIdentity.length === 0
    ? []
    : allCandidates.filter((candidate) => candidate.sourceIdentity === sourceIdentity);
  const operationCandidates = operationName.length === 0
    ? []
    : allCandidates.filter((candidate) => candidate.operationName === operationName);
  const candidates = exactCandidates.length === 1
    ? exactCandidates
    : operationCandidates.length === 1 ? operationCandidates : [];
  if (candidates.length !== 1) return undefined;
  const renderedCollectionPaths = readPreviewInspectorHookGraphqlRenderedCollectionPaths(
    metadata?.shape,
    candidates[0].paths,
  );
  return renderedCollectionPaths.length === 0
    ? undefined
    : Object.freeze({ ...candidates[0], renderedCollectionPaths });
}

/** Replaces one own-data path, traversing only arrays proven by explicit item segments. */
function replacePreviewInspectorHookGraphqlOwnPath(value, segments, createReplacement, depth = 0) {
  if (depth > 12) return value;
  if (segments.length === 0) return createReplacement();
  const [segment, ...remaining] = segments;
  if (segment === '[]') {
    if (!Array.isArray(value)) return value;
    let changed = false;
    const next = Array.prototype.map.call(value, (item) => {
      const replacement = replacePreviewInspectorHookGraphqlOwnPath(
        item,
        remaining,
        createReplacement,
        depth + 1,
      );
      if (replacement !== item) changed = true;
      return replacement;
    });
    return changed ? Object.freeze(next) : value;
  }
  if (
    blockedInspectorPropNames.has(segment) ||
    value === null ||
    (typeof value !== 'object' && typeof value !== 'function')
  ) return value;
  let descriptors;
  try { descriptors = Object.getOwnPropertyDescriptors(value); } catch { return value; }
  const descriptor = descriptors[segment];
  if (descriptor === undefined || !Object.hasOwn(descriptor, 'value')) return value;
  const replacement = replacePreviewInspectorHookGraphqlOwnPath(
    descriptor.value,
    remaining,
    createReplacement,
    depth + 1,
  );
  if (replacement === descriptor.value) return value;
  descriptors[segment] = { ...descriptor, value: replacement };
  try { return Object.freeze(Object.defineProperties({}, descriptors)); } catch { return value; }
}

/** Creates typed rows while keeping every non-demanded nested collection in corridor mode. */
function createPreviewInspectorHookGraphqlRenderedCollectionRows(collectionShape, fieldName, rowCount) {
  const itemShape = readPreviewInspectorHookGraphqlOwnValue(collectionShape, 'items');
  return Object.freeze(Array.from({ length: rowCount }, (_, itemIndex) => {
    if (itemShape?.kind === 'unknown') return Object.freeze({});
    try {
      return materializePreviewInspectorDataValue(
        itemShape,
        fieldName,
        'corridor-auto',
        itemIndex,
        0,
      );
    } catch {
      return Object.freeze({});
    }
  }));
}

/** Applies each exact compiler literal to one exemplar without collapsing sibling filter diversity. */
function overlayPreviewInspectorHookGraphqlLiteralDemandExemplar(
  value,
  segments,
  literalValue,
  itemIndex = 0,
  depth = 0,
) {
  if (depth > 12) return value;
  if (segments.length === 0) return literalValue;
  const [segment, ...remaining] = segments;
  if (segment === '[]') {
    if (!Array.isArray(value)) return value;
    const selectedIndex = Math.min(Math.max(0, itemIndex), Math.max(0, value.length - 1));
    const item = readPreviewInspectorHookGraphqlOwnValue(value, String(selectedIndex));
    if (item === undefined) return value;
    const replacement = overlayPreviewInspectorHookGraphqlLiteralDemandExemplar(
      item,
      remaining,
      literalValue,
      itemIndex,
      depth + 1,
    );
    if (replacement === item) return value;
    const next = Array.prototype.slice.call(value);
    next[selectedIndex] = replacement;
    return Object.freeze(next);
  }
  if (
    blockedInspectorPropNames.has(segment) ||
    value === null ||
    (typeof value !== 'object' && typeof value !== 'function')
  ) return value;
  let descriptors;
  try { descriptors = Object.getOwnPropertyDescriptors(value); } catch { return value; }
  const descriptor = descriptors[segment];
  if (descriptor === undefined || !Object.hasOwn(descriptor, 'value')) return value;
  const replacement = overlayPreviewInspectorHookGraphqlLiteralDemandExemplar(
    descriptor.value,
    remaining,
    literalValue,
    itemIndex,
    depth + 1,
  );
  if (Object.is(replacement, descriptor.value)) return value;
  descriptors[segment] = { ...descriptor, value: replacement };
  try { return Object.freeze(Object.defineProperties({}, descriptors)); } catch { return value; }
}

/** Materializes only the admitted collection paths and returns the neural cardinality decision. */
function createPreviewInspectorHookGraphqlRenderedCollectionRecommendation(
  shape,
  payload,
  demand,
) {
  if (demand === undefined || payload === null || typeof payload !== 'object') return undefined;
  const renderedCollectionPaths = demand.renderedCollectionPaths ??
    readPreviewInspectorHookGraphqlRenderedCollectionPaths(shape, demand.paths);
  if (renderedCollectionPaths.length === 0) return undefined;
  const configuredRowCount = Math.max(
    1,
    Math.min(
      10,
      typeof readPreviewInspectorDataListSampleCount === 'function'
        ? readPreviewInspectorDataListSampleCount()
        : typeof readPreviewGeneratedListSampleCount === 'function'
          ? readPreviewGeneratedListSampleCount()
      : 3,
    ),
  );
  const literalVariantsByPath = new Map();
  for (const literalDemand of demand.literalDemands) {
    const values = literalVariantsByPath.get(literalDemand.path) ?? new Set();
    values.add(typeof literalDemand.value + ':' + String(literalDemand.value));
    literalVariantsByPath.set(literalDemand.path, values);
  }
  const literalVariantCount = Math.max(
    0,
    ...[...literalVariantsByPath.values()].map((values) => values.size),
  );
  const coverageRowCount = Math.min(10, Math.max(configuredRowCount, literalVariantCount));
  const fieldPaths = demand.paths.filter((path) =>
    renderedCollectionPaths.some((collectionPath) => path.startsWith(collectionPath + '.')),
  );
  const minimumSafeRowCount = Math.min(
    10,
    Math.max(
      literalVariantCount,
      demand.literalDemands.length > 0 && coverageRowCount > 1 ? 2 : 1,
    ),
  );
  const fallbackCandidateId = minimumSafeRowCount > 1 ? 'diverse-pair' : 'minimum-row';
  const candidates = [
    {
      deterministicRank: 0,
      id: 'configured-samples',
      numbers: { rowCount: coverageRowCount },
      texts: ['configured generated row samples with rendered branch coverage'],
      tokens: ['row-strategy:configured-samples'],
    },
    ...(coverageRowCount === minimumSafeRowCount ? [] : [{
      deterministicRank: 1,
      id: fallbackCandidateId,
      numbers: { rowCount: minimumSafeRowCount },
      texts: [minimumSafeRowCount > 1 ? 'minimum diverse row pair' : 'minimum rendered row'],
      tokens: ['row-strategy:' + fallbackCandidateId],
    }]),
  ];
  const selection = typeof selectPreviewInspectorNeuralResidualCandidate === 'function'
    ? selectPreviewInspectorNeuralResidualCandidate(
        {
          blockerKind: 'data-request',
          holeKind: 'rendered-empty-collection-data',
          numbers: {
            configuredRowCount,
            fieldCount: fieldPaths.length,
            literalCount: demand.literalDemands.length,
            literalVariantCount,
            renderedCollectionCount: renderedCollectionPaths.length,
          },
          texts: [demand.operationName, ...renderedCollectionPaths],
          tokens: [
            'compiler-rendered-collection',
            'graphql-selection',
            ...fieldPaths.map((path) => 'field:' + (path.split('.').at(-1) ?? 'unknown')),
          ],
        },
        candidates,
      )
    : undefined;
  const candidateId = candidates.some((candidate) => candidate.id === selection?.candidateId)
    ? selection.candidateId
    : 'configured-samples';
  const rowCount = candidateId === 'configured-samples'
    ? coverageRowCount
    : minimumSafeRowCount;
  let nextPayload = payload;
  for (const path of renderedCollectionPaths) {
    const pathSegments = path.slice('data.'.length).split('.').slice(0, -1);
    const collectionShape = readPreviewInspectorHookGraphqlShapeAtPath(shape, pathSegments);
    if (collectionShape?.kind !== 'array') continue;
    const fieldName = [...pathSegments].reverse().find((segment) => segment !== '[]') ?? 'items';
    nextPayload = replacePreviewInspectorHookGraphqlOwnPath(
      nextPayload,
      pathSegments,
      () => createPreviewInspectorHookGraphqlRenderedCollectionRows(
        collectionShape,
        fieldName,
        rowCount,
      ),
    );
  }
  const renderedCollectionPathSet = new Set(renderedCollectionPaths);
  const literalIndexesByPath = new Map();
  for (const literalDemand of demand.literalDemands) {
    if (!renderedCollectionPathSet.has(readPreviewInspectorGraphqlLiteralCollectionPath(literalDemand.path))) {
      continue;
    }
    const itemIndex = literalIndexesByPath.get(literalDemand.path) ?? 0;
    literalIndexesByPath.set(literalDemand.path, itemIndex + 1);
    nextPayload = overlayPreviewInspectorHookGraphqlLiteralDemandExemplar(
      nextPayload,
      literalDemand.path.slice('data.'.length).split('.'),
      literalDemand.value,
      itemIndex,
    );
  }
  return Object.freeze({
    candidateId,
    collectionPaths: Object.freeze([...renderedCollectionPaths]),
    decision: selection?.decision,
    operationName: demand.operationName,
    payload: nextPayload,
    rowCount,
  });
}

/** Resolves a corridor-mode virtual request through one exact operation demand. */
function resolvePreviewInspectorHookGraphqlRenderedCollectionData(metadata, payload) {
  const demand = readPreviewInspectorHookGraphqlRequestDemand(metadata);
  return demand === undefined
    ? undefined
    : createPreviewInspectorHookGraphqlRenderedCollectionRecommendation(
        metadata.shape,
        payload,
        demand,
      );
}

/** Emits one causal, verifier-observed table-fill attempt without retaining application values. */
function recordPreviewInspectorHookGraphqlRenderedCollectionRecommendation(
  recommendation,
  metadata,
  blockerId,
) {
  if (
    recommendation === undefined ||
    typeof recordPreviewInspectorBlockerAutoDecision !== 'function'
  ) return undefined;
  const neuralSummary = typeof summarizePreviewInspectorNeuralResidualDecision === 'function'
    ? summarizePreviewInspectorNeuralResidualDecision(recommendation.decision)
    : undefined;
  return recordPreviewInspectorBlockerAutoDecision({
    action: 'Fill compiler-rendered collection rows',
    blockerId,
    blockerKind: 'data-request',
    blockerName: 'Rendered collection data · ' +
      (recommendation.operationName || metadata?.label || 'GraphQL operation'),
    column: metadata?.column,
    generatedPaths: recommendation.collectionPaths,
    line: metadata?.line,
    mode: 'neural-rendered-collection-auto',
    neuralResidualDecision: recommendation.decision,
    ownerName: metadata?.ownerName,
    reason: 'Compiler-proven render demand selected ' + String(recommendation.rowCount) +
      ' local row(s)' + (neuralSummary === undefined
        ? ''
        : ' · neural residual ' + String(Math.round(neuralSummary.score * 100)) + '%'),
    selectedValue: {
      candidateId: recommendation.candidateId,
      collectionPaths: recommendation.collectionPaths,
      rowCount: recommendation.rowCount,
    },
    sourcePath: metadata?.sourcePath,
    startsRenderAttempt: true,
    summary: {
      candidateId: recommendation.candidateId,
      collectionCount: recommendation.collectionPaths.length,
      neuralResidual: neuralSummary,
      rowCount: recommendation.rowCount,
    },
    targetReachabilityKey: metadata?.reachabilityKey,
  });
}
`;
}
