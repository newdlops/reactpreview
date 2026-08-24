/**
 * Generates the GraphQL-aware adapter used by render-blocking hook recovery.
 *
 * Apollo's memory client already produces selection-shaped responses, but a project wrapper often
 * converts the first loading/error render into `{ data: undefined, fallback: <Error /> }` before
 * that response arrives. The hook circuit breaker can retain the authored GraphQL `DocumentNode`,
 * so this adapter deterministically supplies the same selected fields immediately. It never sends
 * a request, imports a project module, or guesses fields that are absent from the document.
 */
import { createPreviewInspectorRenderedCollectionNeuralRuntimeSource } from './previewInspectorRenderedCollectionNeuralRuntimeSource';

/** Creates browser source that turns an authored GraphQL document into one settled hook result. */
export function createPreviewInspectorHookGraphqlRuntimeSource(): string {
  const renderedCollectionNeuralRuntimeSource =
    createPreviewInspectorRenderedCollectionNeuralRuntimeSource();
  return String.raw`
const PREVIEW_INSPECTOR_HOOK_GRAPHQL_SOURCE_LIMIT = 1_000_000;
const previewInspectorHookGraphqlDocumentIdentities = new WeakMap();
const previewInspectorHookGraphqlRenderPropUsages = new WeakMap();
const previewInspectorHookGraphqlRenderPropLiteralDemands = new WeakMap();
const previewInspectorHookGraphqlFixedRendererDocuments = new WeakMap();
${renderedCollectionNeuralRuntimeSource}

/** Registers compiler-proven render-prop demand and returns the same DocumentNode identity. */
function registerPreviewInspectorGraphqlRenderPropUsage(document, rawPaths, rawLiteralDemands) {
  if ((typeof document !== 'object' && typeof document !== 'function') || document === null ||
    !Array.isArray(rawPaths)) return document;
  const paths = [...new Set(rawPaths.flatMap((path) => {
    const expanded = typeof path === 'string'
      ? expandPreviewInspectorGraphqlConnectionRelativePath(document, path)
      : undefined;
    return expanded === undefined ? [] : [expanded];
  }))].sort().slice(0, 32);
  if (paths.length === 0) return document;
  const previous = previewInspectorHookGraphqlRenderPropUsages.get(document);
  const merged = [...new Set([...(previous ?? []), ...paths])].sort().slice(0, 32);
  previewInspectorHookGraphqlRenderPropUsages.set(document, Object.freeze(merged));
  const previousLiteralDemands = previewInspectorHookGraphqlRenderPropLiteralDemands.get(document) ?? [];
  const literalDemands = new Map(previousLiteralDemands.map((demand) => [
    demand.path + '\0' + typeof demand.value + ':' + String(demand.value),
    demand,
  ]));
  if (Array.isArray(rawLiteralDemands)) {
    for (const rawDemand of rawLiteralDemands.slice(0, 32)) {
      const demand = normalizePreviewInspectorGraphqlRenderPropLiteralDemand(
        expandPreviewInspectorGraphqlLiteralDemand(document, rawDemand),
      );
      if (
        demand !== undefined &&
        !literalDemands.has(
          demand.path + '\0' + typeof demand.value + ':' + String(demand.value),
        ) &&
        merged.includes(readPreviewInspectorGraphqlLiteralCollectionPath(demand.path)) &&
        literalDemands.size < 32
      ) {
        literalDemands.set(
          demand.path + '\0' + typeof demand.value + ':' + String(demand.value),
          demand,
        );
      }
    }
  }
  const mergedLiteralDemands = Object.freeze(
    [...literalDemands.values()].sort((left, right) => left.path.localeCompare(right.path)),
  );
  previewInspectorHookGraphqlRenderPropLiteralDemands.set(document, mergedLiteralDemands);
  registerPreviewInspectorHookGraphqlOperationDemand(
    document,
    Object.freeze(merged),
    mergedLiteralDemands,
  );
  return document;
}

/** Associates one fixed-query renderer tuple with the exact DocumentNode captured by its factory. */
function registerPreviewInspectorGraphqlFixedRenderer(factoryResult, document) {
  if (!Array.isArray(factoryResult)) return factoryResult;
  const renderer = readPreviewInspectorHookGraphqlOwnValue(factoryResult, '0');
  if (
    (typeof renderer !== 'object' && typeof renderer !== 'function') ||
    renderer === null ||
    (typeof document !== 'object' && typeof document !== 'function') ||
    document === null
  ) {
    return factoryResult;
  }
  previewInspectorHookGraphqlFixedRendererDocuments.set(renderer, document);
  return factoryResult;
}

/** Registers one consumer callback's static collection demand without replacing that callback. */
function registerPreviewInspectorGraphqlFixedRendererUsage(renderer, rawPaths, rawLiteralDemands) {
  if ((typeof renderer !== 'object' && typeof renderer !== 'function') || renderer === null) {
    return renderer;
  }
  const document = previewInspectorHookGraphqlFixedRendererDocuments.get(renderer);
  if (document !== undefined) {
    registerPreviewInspectorGraphqlRenderPropUsage(document, rawPaths, rawLiteralDemands);
  }
  return renderer;
}

/** Expands a compiler-tagged connection path only for one unambiguous selected response root. */
function expandPreviewInspectorGraphqlConnectionRelativePath(document, path) {
  if (/^data(?:\.[A-Za-z_$][A-Za-z0-9_$]*|\.\[\]){1,12}$/u.test(path)) return path;
  if (!/^@connection\.objectList\.\[\](?:\.[A-Za-z_$][A-Za-z0-9_$]*){0,10}$/u.test(path)) {
    return undefined;
  }
  try {
    const operations = Array.isArray(document?.definitions)
      ? document.definitions.filter((definition) => definition?.kind === 'OperationDefinition')
      : [];
    if (operations.length !== 1) return undefined;
    const selections = operations[0]?.selectionSet?.selections;
    if (!Array.isArray(selections) || selections.length !== 1 || selections[0]?.kind !== 'Field') {
      return undefined;
    }
    const root = selections[0];
    const childSelections = root?.selectionSet?.selections;
    if (!Array.isArray(childSelections) || !childSelections.some(
      (selection) => selection?.kind === 'Field' && selection?.name?.value === 'objectList',
    )) return undefined;
    const responseName = typeof root?.alias?.value === 'string'
      ? root.alias.value
      : typeof root?.name?.value === 'string' ? root.name.value : undefined;
    return responseName === undefined ? undefined : 'data.' + responseName + '.' + path.slice('@connection.'.length);
  } catch {
    return undefined;
  }
}

/** Expands the path of one literal demand before its ordinary strict validation. */
function expandPreviewInspectorGraphqlLiteralDemand(document, rawDemand) {
  if (rawDemand === null || typeof rawDemand !== 'object') return rawDemand;
  const path = expandPreviewInspectorGraphqlConnectionRelativePath(document, rawDemand.path);
  return path === undefined ? rawDemand : { ...rawDemand, path };
}

/** Validates one compiler literal demand without admitting project expressions or unsafe paths. */
function normalizePreviewInspectorGraphqlRenderPropLiteralDemand(rawDemand) {
  if (rawDemand === null || typeof rawDemand !== 'object') return undefined;
  const path = rawDemand.path;
  const value = rawDemand.value;
  if (
    typeof path !== 'string' ||
    !/^data(?:\.[A-Za-z_$][A-Za-z0-9_$]*|\.\[\]){2,12}$/u.test(path) ||
    !path.includes('.[]') ||
    !(
      typeof value === 'string' ||
      typeof value === 'boolean' ||
      (typeof value === 'number' && Number.isFinite(value))
    )
  ) {
    return undefined;
  }
  return Object.freeze({ path, value });
}

/** Returns the structural collection path that owns one item-relative literal leaf. */
function readPreviewInspectorGraphqlLiteralCollectionPath(path) {
  const segments = path.split('.');
  const itemIndex = segments.lastIndexOf('[]');
  return itemIndex < 1 ? '' : segments.slice(0, itemIndex + 1).join('.');
}

function readPreviewInspectorGraphqlRenderPropUsagePaths(readDocument) {
  if (typeof readDocument !== 'function') return [];
  try {
    const document = readDocument();
    return previewInspectorHookGraphqlRenderPropUsages.get(document) ?? [];
  } catch { return []; }
}

function readPreviewInspectorGraphqlRenderPropLiteralDemands(readDocument) {
  if (typeof readDocument !== 'function') return [];
  try {
    const document = readDocument();
    return previewInspectorHookGraphqlRenderPropLiteralDemands.get(document) ?? [];
  } catch { return []; }
}

/** Reads bounded operation evidence without executing getters outside one guarded access chain. */
function readPreviewInspectorHookGraphqlDocumentEvidence(readDocument) {
  if (typeof readDocument !== 'function') return undefined;
  try {
    const document = readDocument();
    const source = document?.loc?.source?.body;
    if (
      typeof source !== 'string' ||
      source.length === 0 ||
      source.length > PREVIEW_INSPECTOR_HOOK_GRAPHQL_SOURCE_LIMIT
    ) {
      return undefined;
    }
    const operation = Array.isArray(document?.definitions)
      ? document.definitions.find((definition) => definition?.kind === 'OperationDefinition')
      : undefined;
    const operationName = typeof operation?.name?.value === 'string' ? operation.name.value : '';
    return { operationName, source };
  } catch {
    return undefined;
  }
}

/** Reads one own data property without invoking application-owned getters. */
function readPreviewInspectorHookGraphqlOwnValue(owner, propertyName) {
  if (owner === null || (typeof owner !== 'object' && typeof owner !== 'function')) return undefined;
  try {
    const descriptor = Object.getOwnPropertyDescriptor(owner, propertyName);
    return descriptor !== undefined && Object.hasOwn(descriptor, 'value')
      ? descriptor.value
      : undefined;
  } catch {
    return undefined;
  }
}

/** Collects scalar ID variables from a stable query-options reference under a strict own-data policy. */
function readPreviewInspectorHookGraphqlIdentityVariables(readOptions) {
  if (typeof readOptions !== 'function') return [];
  try {
    const options = readOptions();
    const variables = readPreviewInspectorHookGraphqlOwnValue(options, 'variables');
    if (variables === null || typeof variables !== 'object') return [];
    const descriptors = Object.getOwnPropertyDescriptors(variables);
    return Object.keys(descriptors).sort().flatMap((name) => {
      const descriptor = descriptors[name];
      const value = descriptor !== undefined && Object.hasOwn(descriptor, 'value')
        ? descriptor.value
        : undefined;
      return /id$/iu.test(name) && (typeof value === 'string' || typeof value === 'number')
        ? [{ baseName: name.replace(/id$/iu, '').toLowerCase(), name, value }]
        : [];
    }).slice(0, 16);
  } catch {
    return [];
  }
}

/** Hashes bounded request evidence without retaining or exposing authored query variables. */
function hashPreviewInspectorHookGraphqlRequestIdentity(value) {
  let first = 0x811c9dc5;
  let second = 0x9e3779b9;
  for (let index = 0; index < value.length; index += 1) {
    const code = value.charCodeAt(index);
    first = Math.imul(first ^ code, 0x01000193) >>> 0;
    second = Math.imul(second ^ code, 0x85ebca6b) >>> 0;
  }
  return first.toString(16).padStart(8, '0') + second.toString(16).padStart(8, '0');
}

/** Creates one stable operation-and-ID scope for wrappers shared by many GraphQL documents. */
function createPreviewInspectorHookGraphqlRequestIdentity(readDocument, readOptions) {
  if (typeof readDocument !== 'function') return '';
  try {
    const document = readDocument();
    if ((typeof document !== 'object' && typeof document !== 'function') || document === null) {
      return '';
    }
    let documentIdentity = previewInspectorHookGraphqlDocumentIdentities.get(document);
    if (documentIdentity === undefined) {
      const source = document?.loc?.source?.body;
      if (
        typeof source !== 'string' ||
        source.length === 0 ||
        source.length > PREVIEW_INSPECTOR_HOOK_GRAPHQL_SOURCE_LIMIT
      ) return '';
      const operation = Array.isArray(document?.definitions)
        ? document.definitions.find((definition) => definition?.kind === 'OperationDefinition')
        : undefined;
      const operationName = typeof operation?.name?.value === 'string' ? operation.name.value : '';
      documentIdentity = hashPreviewInspectorHookGraphqlRequestIdentity(operationName + '\0' + source);
      previewInspectorHookGraphqlDocumentIdentities.set(document, documentIdentity);
    }
    const variables = readPreviewInspectorHookGraphqlIdentityVariables(readOptions)
      .map((identity) => identity.name + ':' + typeof identity.value + ':' + String(identity.value))
      .join('\0');
    const demand = previewInspectorHookGraphqlRenderPropUsages.get(document) ?? [];
    const literalDemands = previewInspectorHookGraphqlRenderPropLiteralDemands.get(document) ?? [];
    const demandEvidence = [
      ...demand,
      ...literalDemands.map(
        (literalDemand) =>
          literalDemand.path + ':' + typeof literalDemand.value + ':' + String(literalDemand.value),
      ),
    ];
    const demandSignature = demandEvidence.length === 0
      ? ''
      : hashPreviewInspectorHookGraphqlRequestIdentity(demandEvidence.join('\0'));
    const scopedIdentity = demandSignature.length === 0 ? documentIdentity :
      hashPreviewInspectorHookGraphqlRequestIdentity(documentIdentity + '\0' + demandSignature);
    return variables.length === 0
      ? scopedIdentity
      : hashPreviewInspectorHookGraphqlRequestIdentity(scopedIdentity + '\0' + variables);
  } catch {
    return '';
  }
}

/** Selects the request identity proven to describe one direct GraphQL response field. */
function selectPreviewInspectorHookGraphqlIdentity(fieldName, identities) {
  const normalizedField = String(fieldName).replace(/[^A-Za-z0-9]/gu, '').toLowerCase();
  const matched = identities.filter(
    (identity) => identity.baseName.length > 0 && normalizedField.includes(identity.baseName),
  );
  if (matched.length === 1) return matched[0].value;
  return identities.length === 1 ? identities[0].value : undefined;
}

/**
 * Aligns a direct selected entity ID with the variable that requested it.
 * This deterministic equality is required by common route guards and therefore needs no user input.
 */
function alignPreviewInspectorHookGraphqlResponseIdentities(data, readOptions) {
  const identities = readPreviewInspectorHookGraphqlIdentityVariables(readOptions);
  if (identities.length === 0 || data === null || typeof data !== 'object') return data;
  let changed = false;
  const aligned = { ...data };
  for (const fieldName of Object.keys(aligned)) {
    const entity = aligned[fieldName];
    if (entity === null || typeof entity !== 'object' || Array.isArray(entity)) continue;
    if (readPreviewInspectorHookGraphqlOwnValue(entity, 'id') === undefined) continue;
    const identity = selectPreviewInspectorHookGraphqlIdentity(fieldName, identities);
    if (identity === undefined || entity.id === identity) continue;
    aligned[fieldName] = Object.freeze({ ...entity, id: identity });
    changed = true;
  }
  return changed ? Object.freeze(aligned) : data;
}

/** Materializes only fields selected by the reached query and rejects empty/unknown roots. */
function createPreviewInspectorHookGraphqlData(readDocument, readOptions) {
  const evidence = readPreviewInspectorHookGraphqlDocumentEvidence(readDocument);
  if (
    evidence === undefined ||
    typeof inferPreviewInspectorGraphqlQueryShape !== 'function' ||
    typeof generatePreviewInspectorDataValue !== 'function'
  ) {
    return undefined;
  }
  try {
    const shape = inferPreviewInspectorGraphqlQueryShape(
      evidence.source,
      evidence.operationName,
    );
    if (
      shape?.kind !== 'object' ||
      shape.fields === null ||
      typeof shape.fields !== 'object' ||
      Object.keys(shape.fields).length === 0
    ) {
      return undefined;
    }
    const generatedData = generatePreviewInspectorDataValue(shape, '', 'smart');
    if (generatedData === null || typeof generatedData !== 'object') return undefined;
    const demand = readPreviewInspectorHookGraphqlDocumentDemand(readDocument);
    const recommendation = createPreviewInspectorHookGraphqlRenderedCollectionRecommendation(
      shape,
      generatedData,
      demand,
    );
    if (recommendation !== undefined) {
      try {
        const document = readDocument();
        previewInspectorHookGraphqlPendingRenderedCollectionRecommendations.set(
          document,
          recommendation,
        );
      } catch { /* The generated data remains valid without trace correlation. */ }
    }
    const data = recommendation?.payload ?? generatedData;
    return data !== null && typeof data === 'object'
      ? alignPreviewInspectorHookGraphqlResponseIdentities(data, readOptions)
      : undefined;
  } catch {
    return undefined;
  }
}

/** Materializes the selected fields of a generated fragment-masking DocumentNode. */
function createPreviewInspectorHookGraphqlFragmentData(readDocument) {
  const evidence = readPreviewInspectorHookGraphqlDocumentEvidence(readDocument);
  if (
    evidence === undefined ||
    typeof inferPreviewInspectorGraphqlFragmentShape !== 'function' ||
    typeof generatePreviewInspectorDataValue !== 'function'
  ) {
    return undefined;
  }
  try {
    const document = readDocument();
    const fragment = Array.isArray(document?.definitions)
      ? document.definitions.find((definition) => definition?.kind === 'FragmentDefinition')
      : undefined;
    const fragmentName = typeof fragment?.name?.value === 'string' ? fragment.name.value : '';
    const shape = inferPreviewInspectorGraphqlFragmentShape(evidence.source, fragmentName);
    if (
      shape?.kind !== 'object' ||
      shape.fields === null ||
      typeof shape.fields !== 'object' ||
      Object.keys(shape.fields).length === 0
    ) {
      return undefined;
    }
    const data = generatePreviewInspectorDataValue(shape, '', 'smart');
    return data !== null && typeof data === 'object' ? data : undefined;
  } catch {
    return undefined;
  }
}

/**
 * Reconciles schema-less GraphQL object guesses with collection structure proven by authored use.
 * A response field can return a list even when its name is singular (for example a domain noun),
 * while the selected child fields still describe the list item exactly. In that case retain the
 * selection-shaped object as one bounded item instead of replacing it with an empty array item.
 */
function alignPreviewInspectorHookGraphqlStructure(value, fallback, depth = 0) {
  if (depth > 12) return value;
  if (Array.isArray(fallback)) {
    const itemFallback = readPreviewInspectorHookGraphqlOwnValue(fallback, '0');
    if (Array.isArray(value)) {
      if (itemFallback === undefined || value.length === 0) return value;
      let changed = false;
      const aligned = Array.prototype.map.call(value, (item) => {
        const next = alignPreviewInspectorHookGraphqlStructure(item, itemFallback, depth + 1);
        if (next !== item) changed = true;
        return next;
      });
      return changed ? Object.freeze(aligned) : value;
    }
    if (value !== null && typeof value === 'object') {
      return Object.freeze([
        alignPreviewInspectorHookGraphqlStructure(value, itemFallback, depth + 1),
      ]);
    }
    return fallback;
  }
  if (
    fallback === null ||
    typeof fallback !== 'object' ||
    value === null ||
    typeof value !== 'object' ||
    Array.isArray(value)
  ) {
    return value;
  }
  let valueDescriptors;
  let fallbackDescriptors;
  try {
    valueDescriptors = Object.getOwnPropertyDescriptors(value);
    fallbackDescriptors = Object.getOwnPropertyDescriptors(fallback);
  } catch {
    return value;
  }
  const replacements = new Map();
  for (const [propertyName, fallbackDescriptor] of Object.entries(fallbackDescriptors)) {
    if (blockedInspectorPropNames.has(propertyName) || !Object.hasOwn(fallbackDescriptor, 'value')) {
      continue;
    }
    const valueDescriptor = valueDescriptors[propertyName];
    if (valueDescriptor === undefined || !Object.hasOwn(valueDescriptor, 'value')) continue;
    const aligned = alignPreviewInspectorHookGraphqlStructure(
      valueDescriptor.value,
      fallbackDescriptor.value,
      depth + 1,
    );
    if (aligned !== valueDescriptor.value) replacements.set(propertyName, aligned);
  }
  if (replacements.size === 0) return value;
  for (const [propertyName, replacement] of replacements) {
    valueDescriptors[propertyName] = { ...valueDescriptors[propertyName], value: replacement };
  }
  try {
    return Object.freeze(Object.defineProperties({}, valueDescriptors));
  } catch {
    return value;
  }
}

/** Builds the minimum data-root collection skeleton proven by one inline query render callback. */
function createPreviewInspectorHookGraphqlRenderPropDataFallback(fallbackData, readDocument) {
  if (typeof createPreviewInspectorRuntimeFallbackRequirementTemplate !== 'function') {
    return fallbackData;
  }
  const dataPaths = readPreviewInspectorGraphqlRenderPropUsagePaths(readDocument)
    .flatMap((path) => path.startsWith('data.') ? [path.slice('data.'.length)] : [])
    .slice(0, 32);
  if (dataPaths.length === 0) return fallbackData;
  const seed = fallbackData !== null && typeof fallbackData === 'object' ? fallbackData : {};
  try {
    const materialized = createPreviewInspectorRuntimeFallbackRequirementTemplate(seed, dataPaths);
    return materialized !== null && typeof materialized === 'object' ? materialized : fallbackData;
  } catch {
    return fallbackData;
  }
}

/**
 * Overlays transport-state sentinels whose successful static-preview values have one answer.
 * Other inferred fields and callbacks retain the compiler fallback selected from local use.
 */
function createPreviewInspectorHookGraphqlFallback(fallback, readDocument, readOptions) {
  const data = createPreviewInspectorHookGraphqlData(readDocument, readOptions);
  if (data === undefined) return fallback;
  const hasObjectFallback =
    fallback !== null && typeof fallback === 'object' && !Array.isArray(fallback);
  const fallbackData = hasObjectFallback
    ? readPreviewInspectorHookGraphqlOwnValue(fallback, 'data')
    : undefined;
  const structuralFallbackData = createPreviewInspectorHookGraphqlRenderPropDataFallback(
    fallbackData,
    readDocument,
  );
  const alignedData = structuralFallbackData === undefined
    ? data
    : alignPreviewInspectorHookGraphqlStructure(data, structuralFallbackData);
  const settled = hasObjectFallback ? { ...fallback, data: alignedData } : { data: alignedData };
  settled.loading = false;
  settled.fallback = null;
  settled.error = null;
  settled.networkStatus = 7;
  if (typeof settled.refetch !== 'function') {
    settled.refetch = Object.freeze(() => Promise.resolve({ data: alignedData }));
  }
  try {
    const document = readDocument();
    const recommendation = previewInspectorHookGraphqlPendingRenderedCollectionRecommendations.get(
      document,
    );
    if (
      recommendation !== undefined &&
      !previewInspectorHookGraphqlRecordedRenderedCollectionRecommendations.has(document)
    ) {
      const requestIdentity = createPreviewInspectorHookGraphqlRequestIdentity(
        readDocument,
        readOptions,
      );
      const traceId = recordPreviewInspectorHookGraphqlRenderedCollectionRecommendation(
        recommendation,
        {
          label: recommendation.operationName,
          operationName: recommendation.operationName,
          reachabilityKey:
            typeof previewInspectorSession === 'object'
              ? previewInspectorSession.activeTargetReachabilityKey
              : undefined,
        },
        'graphql-rendered-collection:' +
          (requestIdentity || recommendation.operationName || 'anonymous'),
      );
      if (traceId !== undefined) {
        previewInspectorHookGraphqlRecordedRenderedCollectionRecommendations.add(document);
      }
    }
  } catch { /* The fallback itself must not depend on diagnostics. */ }
  return Object.freeze(settled);
}

/** Applies one literal through the existing guarded generated-value merge, never mutating authored data. */
function overlayPreviewInspectorHookGraphqlLiteralDemands(fallback, readDocument) {
  const literalDemands = readPreviewInspectorGraphqlRenderPropLiteralDemands(readDocument);
  return overlayPreviewInspectorGraphqlLiteralDemands(fallback, literalDemands);
}

/** Applies already-normalized literals to any selection-shaped GraphQL fallback. */
function overlayPreviewInspectorGraphqlLiteralDemands(fallback, literalDemands) {
  if (literalDemands.length === 0 || fallback === null || typeof fallback !== 'object') return fallback;
  let result = fallback;
  if (typeof createPreviewInspectorRuntimeFallbackRequirementTemplate === 'function') {
    try {
      const structured = createPreviewInspectorRuntimeFallbackRequirementTemplate(
        fallback,
        literalDemands.map((literalDemand) => literalDemand.path),
      );
      if (structured !== null && typeof structured === 'object') result = structured;
    } catch {
      result = fallback;
    }
  }
  const literalIndexesByPath = new Map();
  for (const literalDemand of literalDemands) {
    const itemIndex = literalIndexesByPath.get(literalDemand.path) ?? 0;
    literalIndexesByPath.set(literalDemand.path, itemIndex + 1);
    const overlay = createPreviewInspectorHookGraphqlLiteralOverlay(
      result,
      literalDemand,
      itemIndex,
    );
    if (overlay === undefined) continue;
    const completion = completePreviewInspectorGeneratedValue(result, overlay.value, {
      renderGuardPaths: [overlay.renderGuardPath],
    });
    result = completion.changed ? completion.value : result;
  }
  return result;
}

/** Creates a selected-field-only generated overlay for the first structurally completed collection item. */
function createPreviewInspectorHookGraphqlLiteralOverlay(fallback, literalDemand, itemIndex = 0) {
  const segments = literalDemand.path.split('.');
  let current = fallback;
  const generatedSegments = [];
  const renderGuardSegments = [];
  for (const segment of segments) {
    if (segment === '[]') {
      if (!Array.isArray(current)) return undefined;
      const selectedIndex = Math.min(Math.max(0, itemIndex), Math.max(0, current.length - 1));
      const item = readPreviewInspectorHookGraphqlOwnValue(current, String(selectedIndex));
      if (item === undefined) return undefined;
      current = item;
      generatedSegments.push({ itemIndex: selectedIndex, segment });
      renderGuardSegments.push(String(selectedIndex));
      continue;
    }
    const descriptor = current !== null && (typeof current === 'object' || typeof current === 'function')
      ? Object.getOwnPropertyDescriptor(current, segment)
      : undefined;
    if (descriptor === undefined || !Object.hasOwn(descriptor, 'value')) return undefined;
    current = descriptor.value;
    generatedSegments.push({ segment });
    renderGuardSegments.push(segment);
  }
  let generated = literalDemand.value;
  for (let index = generatedSegments.length - 1; index >= 0; index -= 1) {
    const generatedSegment = generatedSegments[index];
    if (generatedSegment?.segment === '[]') {
      generated = Array.from(
        { length: (generatedSegment.itemIndex ?? 0) + 1 },
        (_, itemIndex) => itemIndex === generatedSegment.itemIndex ? generated : {},
      );
    } else if (typeof generatedSegment?.segment === 'string') {
      generated = { [generatedSegment.segment]: generated };
    }
  }
  return {
    renderGuardPath: renderGuardSegments.join('.'),
    value: generated,
  };
}

/** Detects the loading/error wrapper result that must yield to selection-shaped static data. */
function shouldUsePreviewInspectorHookGraphqlFallback(value, readDocument) {
  if (
    typeof readDocument !== 'function' ||
    value === null ||
    typeof value !== 'object' ||
    Array.isArray(value)
  ) {
    return false;
  }
  try {
    const data = Object.getOwnPropertyDescriptor(value, 'data');
    return data === undefined || (Object.hasOwn(data, 'value') && data.value == null);
  } catch {
    return false;
  }
}
`;
}
