import { createPreviewInspectorDataMaterializationRuntimeSource } from './previewInspectorDataMaterializationRuntimeSource';
/**
 * Generates the no-network data registry used by React Page Inspector.
 *
 * GraphQL bridges and compiler-instrumented REST calls share this runtime so payload generation,
 * provenance, persistence, and remount behavior have one policy. The browser never forwards a
 * registered backend request; local static-resource fetches may still use the captured native API.
 */
import { createPreviewSampleLabelRuntimeSource } from '../previewSampleLabel';
import { createPreviewInspectorDataBooleanRuntimeSource } from './previewInspectorDataBooleanRuntimeSource';
import { createPreviewInspectorDataIdentityRuntimeSource } from './previewInspectorDataIdentityRuntimeSource';
import { createPreviewInspectorDataReachabilityRuntimeSource } from './previewInspectorDataReachabilityRuntimeSource';
import { createPreviewInspectorDataSampleDateRuntimeSource } from './previewInspectorDataSampleDateRuntimeSource';
import { createPreviewInspectorFetchResponseRuntimeSource } from './previewInspectorFetchResponseRuntimeSource';
import { createPreviewInspectorGraphqlShapeRuntimeSource } from './previewInspectorGraphqlShapeRuntimeSource';
import { createPreviewInspectorRestCollectionFillRuntimeSource } from './previewInspectorRestCollectionFillRuntimeSource';
import { createPreviewInspectorTypedRestRuntimeSource } from './previewInspectorTypedRestRuntimeSource';
import { createPreviewInspectorVirtualBackendRuntimeSource } from './previewInspectorVirtualBackendRuntimeSource';
import { createPreviewInspectorXmlHttpRequestRuntimeSource } from './previewInspectorXmlHttpRequestRuntimeSource';

/**
 * Creates browser source for inferred, lorem, and user-authored preview payloads.
 *
 * Expected lexical bindings include `previewHotRuntime`, `previewInspectorSession`, state helpers,
 * and the Inspector notification functions declared by the composed Page Inspector runtime.
 *
 * @returns Plain JavaScript source evaluated before project setup and target modules are imported.
 */
export function createPreviewInspectorDataRuntimeSource(): string {
  const graphqlShapeRuntimeSource = createPreviewInspectorGraphqlShapeRuntimeSource();
  const booleanRuntimeSource = createPreviewInspectorDataBooleanRuntimeSource();
  const identityRuntimeSource = createPreviewInspectorDataIdentityRuntimeSource();
  const reachabilityRuntimeSource = createPreviewInspectorDataReachabilityRuntimeSource();
  const fetchResponseRuntimeSource = createPreviewInspectorFetchResponseRuntimeSource();
  const virtualBackendRuntimeSource = createPreviewInspectorVirtualBackendRuntimeSource();
  const xmlHttpRequestRuntimeSource = createPreviewInspectorXmlHttpRequestRuntimeSource();
  const typedRestRuntimeSource = createPreviewInspectorTypedRestRuntimeSource();
  return String.raw`
${graphqlShapeRuntimeSource}

${typedRestRuntimeSource}
${createPreviewInspectorRestCollectionFillRuntimeSource()}

${booleanRuntimeSource}
${createPreviewInspectorDataSampleDateRuntimeSource()}
${createPreviewSampleLabelRuntimeSource('previewInspectorDataSampleLabel')}

${identityRuntimeSource}

const PREVIEW_INSPECTOR_DATA_REQUEST_LIMIT = 256;
const PREVIEW_INSPECTOR_DATA_DEPTH_LIMIT = 10;
const PREVIEW_INSPECTOR_DATA_FIELD_LIMIT = 512;
const PREVIEW_INSPECTOR_LIST_SAMPLE_COUNT_OPTIONS = Object.freeze([1, 2, 3, 5, 10]);
setPreviewGeneratedListSampleCount(readPersistedPreviewInspectorState().dataListSampleCount);
${virtualBackendRuntimeSource}
const previewInspectorDataScheduleMicrotask = typeof globalThis.queueMicrotask === 'function'
  ? globalThis.queueMicrotask.bind(globalThis)
  : (callback) => Promise.resolve().then(callback);

/** Captures the original fetch once so hot replacements never wrap an older preview boundary. */
const previewInspectorNativeFetch = previewHotRuntime.inspectorNativeFetch ??
  (typeof globalThis.fetch === 'function' ? globalThis.fetch.bind(globalThis) : undefined);
previewHotRuntime.inspectorNativeFetch ??= previewInspectorNativeFetch;

/** Lazily restores editable payload state while retaining observed requests across hot reloads. */
function initializePreviewInspectorDataState() {
  if (!(previewInspectorSession.dataRequests instanceof Map)) {
    previewInspectorSession.dataRequests = new Map();
  }
  if (!(previewInspectorSession.dataPayloadOverrides instanceof Map)) {
    const persisted = readPersistedPreviewInspectorState();
    const rawOverrides = persisted.dataPayloadOverrides;
    const entries = rawOverrides !== null && typeof rawOverrides === 'object'
      ? Object.entries(rawOverrides)
          .filter(([id, value]) =>
            typeof id === 'string' &&
            id.length > 0 &&
            id.length <= 160 &&
            value !== null &&
            typeof value === 'object' &&
            ['custom', 'lorem', 'smart', 'smart-custom'].includes(value.mode) &&
            Object.hasOwn(value, 'payload'),
          )
          .slice(0, PREVIEW_INSPECTOR_DATA_REQUEST_LIMIT)
      : [];
    previewInspectorSession.dataPayloadOverrides = new Map(entries);
  }
  if (typeof previewInspectorSession.dataAutoEnabled !== 'boolean') {
    previewInspectorSession.dataAutoEnabled =
      readPersistedPreviewInspectorState().dataAutoEnabled !== false;
  }
  if (!Number.isSafeInteger(previewInspectorSession.dataListSampleCount)) {
    previewInspectorSession.dataListSampleCount = readPreviewGeneratedListSampleCount();
  } else {
    previewInspectorSession.dataListSampleCount = setPreviewGeneratedListSampleCount(
      previewInspectorSession.dataListSampleCount,
    );
  }
  if (!Number.isSafeInteger(previewInspectorSession.dataRevision)) {
    previewInspectorSession.dataRevision = 0;
  }
  initializePreviewInspectorVirtualBackendState();
}

/** Serializes bounded user overrides for the shared VS Code webview-state writer. */
function serializePreviewInspectorDataOverrides() {
  initializePreviewInspectorDataState();
  return Object.fromEntries(
    [...previewInspectorSession.dataPayloadOverrides]
      .slice(0, PREVIEW_INSPECTOR_DATA_REQUEST_LIMIT)
      .map(([id, value]) => [id, JSON.parse(stringifyPreviewInspectorProps(value))]),
  );
}

/** Reads whether newly observed requests receive inferred data automatically. */
function readPreviewInspectorDataAutoEnabled() {
  initializePreviewInspectorDataState();
  return previewInspectorSession.dataAutoEnabled;
}

/** Returns the persisted number of rows used by non-minimum generated collection fixtures. */
function readPreviewInspectorDataListSampleCount() {
  initializePreviewInspectorDataState();
  return previewInspectorSession.dataListSampleCount;
}

/** Summarizes local request generation for detailed render-error diagnostics. */
function readPreviewInspectorDataRuntimeStatus() {
  initializePreviewInspectorDataState();
  const requestCount = previewInspectorSession.dataRequests.size;
  const overrideCount = previewInspectorSession.dataPayloadOverrides.size;
  const resourceCount = previewInspectorSession.virtualBackendResources.size;
  const scenarioCount = previewInspectorSession.virtualBackendScenarios.size;
  return (previewInspectorSession.dataAutoEnabled ? 'active' : 'inactive') +
    ': no-network API/GraphQL payload registry; ' + String(requestCount) +
    ' observed request(s), ' + String(overrideCount) + ' user/generated override(s), ' +
    String(resourceCount) + ' virtual resource(s), ' + String(scenarioCount) +
    ' response scenario(s)';
}

${createPreviewInspectorDataMaterializationRuntimeSource()}/** Creates a useful root shape when an untyped REST endpoint is the only available evidence. */
function inferPreviewInspectorEndpointShape(metadata) {
  const endpoint = String(metadata?.url ?? metadata?.label ?? '').split('?')[0] ?? '';
  const lastSegment = endpoint.split('/').filter(Boolean).at(-1) ?? 'response';
  const itemShape = {
    fields: {
      active: { kind: 'boolean' },
      description: { kind: 'string' },
      id: { kind: 'string' },
      name: { kind: 'string' },
    },
    kind: 'object',
  };
  return looksLikePreviewInspectorCollection(lastSegment)
    ? { items: itemShape, kind: 'array' }
    : itemShape;
}

/** Normalizes request identity and source metadata while stripping URL query values. */
function normalizePreviewInspectorDataRequest(metadata, seedPayload) {
  const source = metadata !== null && typeof metadata === 'object' ? metadata : {};
  const kind = source.kind === 'graphql' ? 'graphql' : 'rest';
  const method = typeof source.method === 'string' ? source.method.toUpperCase().slice(0, 16) : 'GET';
  const safeUrl = sanitizePreviewInspectorRequestUrl(source.url);
  const label = typeof source.label === 'string'
    ? source.label.slice(0, 240)
    : kind === 'graphql'
      ? String(source.operationName || 'Anonymous operation').slice(0, 240)
      : method + ' ' + (safeUrl || 'dynamic endpoint');
  const id = typeof source.id === 'string' && source.id.length > 0
    ? source.id.slice(0, 160)
    : createPreviewInspectorRuntimeRequestId(kind, method, safeUrl || label);
  // An imported client instance or a generic helper (\`fetchJson<T>(url)\`) registered the declared
  // body at its call site; a compiler shape of \`unknown\` (\`as T\` inside the helper) carries no
  // evidence and must not hide that registration.
  const compilerShapeKnown = source.shape !== undefined && source.shape?.kind !== 'unknown';
  const typedRestShape = kind === 'rest' && !compilerShapeKnown
    ? readPreviewInspectorTypedRestShape(method, safeUrl)
    : undefined;
  const suppliedShape = typedRestShape !== undefined
    ? normalizePreviewInspectorDataShape(typedRestShape)
    : source.shape !== undefined
      ? normalizePreviewInspectorDataShape(source.shape)
      : inferPreviewInspectorDataShape(seedPayload);
  const emptySeedObject = seedPayload !== null && typeof seedPayload === 'object' &&
    !Array.isArray(seedPayload) && Object.keys(seedPayload).length === 0;
  const shape = suppliedShape.kind === 'unknown' ||
    (kind === 'rest' && !compilerShapeKnown && typedRestShape === undefined && emptySeedObject)
    ? inferPreviewInspectorEndpointShape({ label, url: safeUrl })
    : suppliedShape;
  return {
    column: Number.isSafeInteger(source.column) && source.column > 0 ? source.column : undefined,
    evidence: typedRestShape !== undefined
      ? 'Declared TypeScript response type of the request call'
      : typeof source.evidence === 'string'
        ? source.evidence.slice(0, 240)
        : kind === 'graphql'
        ? 'GraphQL selection and field-name inference'
        : 'endpoint and field-name inference',
    graphqlSourceIdentity: typeof source.graphqlSourceIdentity === 'string'
      ? source.graphqlSourceIdentity.slice(0, 32)
      : undefined,
    id,
    kind,
    label,
    line: Number.isSafeInteger(source.line) && source.line > 0 ? source.line : undefined,
    method,
    operationName: typeof source.operationName === 'string' ? source.operationName.slice(0, 160) : undefined,
    ownerName: typeof source.ownerName === 'string' ? source.ownerName.slice(0, 180) : undefined,
    shape,
    sourcePath: typeof source.sourcePath === 'string' ? source.sourcePath.slice(0, 1024) : undefined,
    url: safeUrl || undefined,
  };
}

/** Removes credentials and query values before an endpoint is retained or displayed. */
function sanitizePreviewInspectorRequestUrl(value) {
  if (typeof value !== 'string' || value.length === 0) return '';
  const bounded = value.slice(0, 2048);
  const [rawPath = '', rawQuery = ''] = bounded.split('?', 2);
  const queryNames = [...new Set(new URLSearchParams(rawQuery).keys())].sort();
  const safeQuery = queryNames.length === 0 ? '' : '?' + queryNames.map(encodeURIComponent).join('&');
  if (rawPath.startsWith('/') || rawPath.startsWith('./') || rawPath.startsWith('../')) {
    return rawPath + safeQuery;
  }
  try {
    const parsed = new URL(bounded, globalThis.location?.href ?? 'https://preview.invalid/');
    const parsedQueryNames = [...new Set([...parsed.searchParams.keys()])].sort();
    const parsedQuery = parsedQueryNames.length === 0
      ? ''
      : '?' + parsedQueryNames.map(encodeURIComponent).join('&');
    return (parsed.origin === 'https://preview.invalid' ? '' : parsed.origin) + parsed.pathname + parsedQuery;
  } catch {
    return bounded.split('?')[0] ?? '';
  }
}

/** Creates a compact deterministic runtime identity without relying on asynchronous crypto. */
function createPreviewInspectorRuntimeRequestId(kind, method, identity) {
  const input = kind + ':' + method + ':' + identity;
  let hash = 2166136261;
  for (let index = 0; index < input.length; index += 1) {
    hash ^= input.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return 'request:' + (hash >>> 0).toString(16).padStart(8, '0');
}

/** Coalesces request discovery into the Inspector lane without rerendering project components. */
function schedulePreviewInspectorDataRegistryRefresh(reachabilityKey) {
  const pendingKeys = previewInspectorSession.dataRefreshReachabilityKeys ??= new Set();
  if (typeof reachabilityKey === 'string' && reachabilityKey.length > 0) {
    pendingKeys.add(reachabilityKey);
  }
  if (previewInspectorSession.dataRefreshScheduled === true) return;
  previewInspectorSession.dataRefreshScheduled = true;
  previewInspectorDataScheduleMicrotask(() => {
    previewInspectorSession.dataRefreshScheduled = false;
    schedulePreviewInspectorTreeRefresh();
    if (typeof schedulePreviewInspectorTargetRequirementContinuation === 'function') {
      for (const key of pendingKeys) schedulePreviewInspectorTargetRequirementContinuation(key);
    }
    pendingKeys.clear();
  });
}

/** Registers one request and resolves its editable fixture through the stateful virtual backend. */
function resolvePreviewInspectorBackendRequest(metadata, seedPayload, requestContext = {}) {
  initializePreviewInspectorDataState();
  const normalized = normalizePreviewInspectorDataRequest(metadata, seedPayload);
  const previous = previewInspectorSession.dataRequests.get(normalized.id);
  const shapeFingerprint = stringifyPreviewInspectorProps(normalized.shape);
  const renderScenario = typeof readPreviewInspectorRenderScenario === 'function'
    ? readPreviewInspectorRenderScenario()
    : 'file-components';
  const autoPayloadProfile = readPreviewInspectorAutoPayloadProfile(normalized.id, renderScenario);
  // Auto and Corridor Auto intentionally materialize arrays differently. Include the profile in
  // the cache identity so opening/closing target traversal cannot reuse a broad gallery payload in
  // a guarded page corridor (or keep a corridor payload empty after returning to the gallery).
  const inferredAutoPayload =
    previous?.shapeFingerprint === shapeFingerprint &&
    previous?.autoPayloadProfile === autoPayloadProfile
    ? previous.autoPayload
    : generatePreviewInspectorDataValue(normalized.shape, '', autoPayloadProfile);
  const renderedCollectionResolution = resolvePreviewInspectorRenderedCollectionAutoPayload(
    normalized,
    inferredAutoPayload,
    autoPayloadProfile,
  );
  const autoPayload = renderedCollectionResolution?.payload ?? inferredAutoPayload;
  const renderedCollectionRecommendation =
    summarizePreviewInspectorRenderedCollectionRecommendation(renderedCollectionResolution);
  const next = {
    ...normalized,
    autoPayload,
    autoPayloadProfile,
    observedCount: (previous?.observedCount ?? 0) + 1,
    reachabilityKey:
      typeof previewInspectorSession.activeTargetReachabilityKey === 'string'
        ? previewInspectorSession.activeTargetReachabilityKey
        : undefined,
    seedPayload,
    shapeFingerprint,
    renderedCollectionRecommendation,
  };
  const override = previewInspectorSession.dataPayloadOverrides.get(normalized.id);
  if (
    previous !== undefined &&
    (
      previous.autoPayloadProfile !== autoPayloadProfile ||
      previous.shapeFingerprint !== shapeFingerprint ||
      stringifyPreviewInspectorProps(previous.renderedCollectionRecommendation) !==
        stringifyPreviewInspectorProps(renderedCollectionRecommendation)
    ) &&
    override === undefined &&
    previewInspectorSession.dataAutoEnabled
  ) {
    // The virtual backend retains canonical GET/GraphQL state across reads. Reset only its inferred
    // resource when the Auto profile changes, otherwise that lower cache could mask the correctly
    // regenerated corridor payload. Authored Smart/Lorem/custom fixtures remain untouched.
    clearPreviewInspectorVirtualBackendResource(normalized.id);
  }
  const payloadMode = override?.mode ?? (previewInspectorSession.dataAutoEnabled ? 'auto' : 'seed');
  const selectedPayload = readPreviewInspectorRestCollectionFillPayload(normalized.id) ??
    override?.payload ?? (previewInspectorSession.dataAutoEnabled ? autoPayload : seedPayload ?? {});
  const backendResult = resolvePreviewInspectorVirtualBackendRequest(
    next,
    selectedPayload,
    requestContext,
    payloadMode,
  );
  const { payload: resolvedPayload, ...virtualBackend } = backendResult;
  const registered = createPreviewInspectorStableBackendRecord(
    previous, resolvedPayload, virtualBackend, next,
  );
  const payload = registered.lastPayload;
  if (
    previous === undefined ||
    previous.label !== registered.label ||
    previous.evidence !== registered.evidence ||
    previous.shapeFingerprint !== shapeFingerprint ||
    previous.autoPayloadProfile !== autoPayloadProfile ||
    previous.virtualBackend?.resourceKey !== virtualBackend.resourceKey ||
    previous.virtualBackend?.variantKey !== virtualBackend.variantKey
  ) {
    if (
      previewInspectorSession.dataRequests.has(normalized.id) ||
      previewInspectorSession.dataRequests.size < PREVIEW_INSPECTOR_DATA_REQUEST_LIMIT
    ) {
      previewInspectorSession.dataRequests.set(normalized.id, registered);
      schedulePreviewInspectorDataRegistryRefresh(registered.reachabilityKey);
    }
  } else {
    previewInspectorSession.dataRequests.set(normalized.id, registered);
  }
  if (
    previous === undefined &&
    payloadMode === 'auto' &&
    typeof recordPreviewInspectorBlockerAutoDecision === 'function'
  ) {
    recordPreviewInspectorBlockerAutoDecision({
      action: 'Generate virtual backend response',
      blockerId: normalized.id,
      blockerKind: 'data-request',
      blockerName: 'Backend data · ' + normalized.label,
      column: normalized.column,
      generatedPaths: readPreviewInspectorDataShapePaths(normalized.shape),
      line: normalized.line,
      mode: virtualBackend.deterministicIdentityPaths?.length > 0
        ? 'deterministic-identity-auto'
        : 'auto',
      ownerName: normalized.ownerName,
      reason: virtualBackend.deterministicIdentityPaths?.length > 0
        ? normalized.evidence + '; direct response identity equals its unique request ID variable'
        : normalized.evidence,
      selectedValue: payload,
      sourcePath: normalized.sourcePath,
      summary: { kind: normalized.kind, method: normalized.method, url: normalized.url },
    });
  }
  if (
    previous === undefined &&
    payloadMode === 'auto' &&
    renderedCollectionResolution !== undefined &&
    backendResult.scenario === 'success'
  ) {
    recordPreviewInspectorHookGraphqlRenderedCollectionRecommendation(
      renderedCollectionResolution,
      { ...normalized, reachabilityKey: next.reachabilityKey },
      normalized.id + ':rendered-collection',
    );
  }
  return { ...backendResult, payload };
}

/** Preserves the original payload-only facade for bridges that do not need transport metadata. */
function resolvePreviewInspectorDataPayload(metadata, seedPayload, requestContext) {
  return resolvePreviewInspectorBackendRequest(metadata, seedPayload, requestContext).payload;
}

/** Returns serializable request rows with their current payload and generation provenance. */
function readPreviewInspectorDataRequests() {
  initializePreviewInspectorDataState();
  return [...previewInspectorSession.dataRequests.values()]
    .map((record) => {
      const override = previewInspectorSession.dataPayloadOverrides.get(record.id);
      const mode = override?.mode ?? (previewInspectorSession.dataAutoEnabled ? 'auto' : 'seed');
      const payload = override?.payload ?? (previewInspectorSession.dataAutoEnabled
        ? record.autoPayload
        : record.seedPayload ?? {});
      const scenario = readPreviewInspectorVirtualBackendScenario(record.id);
      return {
        ...record,
        mode,
        payload,
        servedPayload: record.lastPayload,
        suggestedPayload: record.autoPayload,
        virtualBackend: { ...record.virtualBackend, ...scenario },
      };
    })
    .sort((left, right) => left.label.localeCompare(right.label) || left.id.localeCompare(right.id));
}

/** Flattens inferred response fields into bounded property paths for blocker/tree diagnostics. */
function readPreviewInspectorDataShapePaths(shape, prefix = '', paths = []) {
  if (paths.length >= 64 || shape === null || typeof shape !== 'object') return paths;
  if (shape.kind === 'array') {
    const arrayPath = prefix.length > 0 ? prefix + '[]' : '<response>[]';
    return readPreviewInspectorDataShapePaths(shape.items, arrayPath, paths);
  }
  if (shape.kind === 'object') {
    const fields = shape.fields !== null && typeof shape.fields === 'object' ? shape.fields : {};
    for (const [fieldName, child] of Object.entries(fields)) {
      if (paths.length >= 64) break;
      const childPath = prefix.length > 0 ? prefix + '.' + fieldName : fieldName;
      readPreviewInspectorDataShapePaths(child, childPath, paths);
    }
    if (Object.keys(fields).length === 0 && prefix.length > 0) paths.push(prefix);
    return paths;
  }
  paths.push(prefix.length > 0 ? prefix : '<response>');
  return paths;
}

/** Remounts every export so cached hooks consume a newly selected payload. */
function commitPreviewInspectorDataChange() {
  previewInspectorSession.dataRevision += 1;
  persistPreviewInspectorState();
  notifyPreviewInspector();
  schedulePreviewInspectorTreeRefresh();
}

/**
 * Regenerates only inferred Auto/Lorem resources after the user changes the shared list size.
 * Custom JSON and Smart-custom values remain byte-for-byte user owned; Smart stays a one-row
 * reachability minimum independently of this presentation-oriented sample setting.
 */
function setPreviewInspectorDataListSampleCount(value) {
  initializePreviewInspectorDataState();
  const next = setPreviewGeneratedListSampleCount(value);
  if (next === previewInspectorSession.dataListSampleCount) return false;
  previewInspectorSession.dataListSampleCount = next;
  // Resolver props and hook results are generated Auto state, never persisted user JSON. Rebuild
  // those caches at the new cardinality while preserving explicit prop/payload/hook overrides.
  if (previewInspectorSession.resolverPropsByExport instanceof Map) {
    previewInspectorSession.resolverPropsByExport.clear();
  }
  if (typeof resetPreviewInspectorGeneratedRuntimeFallbackValues === 'function') {
    resetPreviewInspectorGeneratedRuntimeFallbackValues();
  }
  for (const [requestId, record] of previewInspectorSession.dataRequests) {
    const inferredAutoPayload = generatePreviewInspectorDataValue(
      record.shape,
      '',
      record.autoPayloadProfile ?? 'auto',
    );
    const renderedCollectionResolution = resolvePreviewInspectorRenderedCollectionAutoPayload(
      record,
      inferredAutoPayload,
      record.autoPayloadProfile ?? 'auto',
    );
    const autoPayload = renderedCollectionResolution?.payload ?? inferredAutoPayload;
    previewInspectorSession.dataRequests.set(requestId, {
      ...record,
      autoPayload,
      renderedCollectionRecommendation:
        summarizePreviewInspectorRenderedCollectionRecommendation(renderedCollectionResolution),
    });
    const override = previewInspectorSession.dataPayloadOverrides.get(requestId);
    if (override?.mode === 'lorem') {
      previewInspectorSession.dataPayloadOverrides.set(requestId, {
        mode: 'lorem',
        payload: generatePreviewInspectorDataValue(record.shape, '', 'lorem'),
      });
    }
    if (
      override?.mode === 'lorem' ||
      (override === undefined && previewInspectorSession.dataAutoEnabled)
    ) {
      clearPreviewInspectorVirtualBackendResource(requestId);
    }
  }
  commitPreviewInspectorDataChange();
  return true;
}

/**
 * Enables or disables automatic payload generation and optionally participates in a larger batch.
 * Batch callers still advance the data revision but own the single persistence/render notification.
 */
function setPreviewInspectorDataAutoEnabled(enabled, commit = true) {
  initializePreviewInspectorDataState();
  if (typeof enabled !== 'boolean' || enabled === previewInspectorSession.dataAutoEnabled) return false;
  previewInspectorSession.dataAutoEnabled = enabled;
  if (enabled && typeof recordPreviewInspectorBlockerAutoDecision === 'function') {
    const requests = [...previewInspectorSession.dataRequests.values()].slice(0, 24);
    recordPreviewInspectorBlockerAutoDecision({
      action: 'Enable Auto payload generation',
      blockerId: 'data-auto-boundary',
      blockerKind: 'data-request-policy',
      blockerName: 'Virtual backend Auto payloads',
      generatedPaths: requests.flatMap((record) =>
        readPreviewInspectorDataShapePaths(record.shape).map((path) => record.label + '.' + path),
      ).slice(0, 128),
      mode: 'auto',
      reason: 'Infer local response values without backend transport',
      selectedValue: Object.fromEntries(requests.map((record) => [record.id, record.autoPayload])),
      startsRenderAttempt: true,
    });
  }
  if (commit) {
    commitPreviewInspectorDataChange();
  } else {
    previewInspectorSession.dataRevision += 1;
  }
  return true;
}

/** Adds missing Smart fields recursively while retaining every non-null user-authored payload value. */
function completePreviewInspectorDataSmartPayload(authored, generated, depth = 0) {
  if (depth > PREVIEW_INSPECTOR_DATA_DEPTH_LIMIT || authored === null || authored === undefined) {
    return generated;
  }
  if (Array.isArray(authored) && Array.isArray(generated)) {
    if (authored.length === 0) return generated;
    const result = [...authored];
    for (let index = 0; index < generated.length; index += 1) {
      result[index] = index < authored.length
        ? completePreviewInspectorDataSmartPayload(authored[index], generated[index], depth + 1)
        : generated[index];
    }
    return result;
  }
  if (
    authored !== null &&
    generated !== null &&
    typeof authored === 'object' &&
    typeof generated === 'object' &&
    !Array.isArray(authored) &&
    !Array.isArray(generated)
  ) {
    const result = { ...authored };
    for (const [propertyName, generatedValue] of Object.entries(generated)) {
      if (blockedInspectorPropNames.has(propertyName)) continue;
      result[propertyName] = Object.hasOwn(authored, propertyName)
        ? completePreviewInspectorDataSmartPayload(
            authored[propertyName],
            generatedValue,
            depth + 1,
          )
        : generatedValue;
    }
    return result;
  }
  return authored;
}

/** Stores one bounded payload override without scheduling a page remount for batch callers. */
function applyPreviewInspectorDataPayloadOverride(requestId, payload, mode, automatic = false) {
  initializePreviewInspectorDataState();
  if (!previewInspectorSession.dataRequests.has(requestId)) return false;
  if (!['custom', 'lorem', 'smart', 'smart-custom'].includes(mode)) return false;
  previewInspectorSession.dataPayloadOverrides.set(requestId, {
    mode, ...(automatic === true && mode === 'smart' ? { automatic: true } : {}),
    payload: JSON.parse(stringifyPreviewInspectorProps(payload)),
  });
  return true;
}

/** Stores a generated or user-authored payload; Auto writers mark minimum Smart rows as automatic. */
function setPreviewInspectorDataPayload(requestId, payload, mode = 'custom', automatic = false) {
  if (!applyPreviewInspectorDataPayloadOverride(requestId, payload, mode, automatic)) return;
  commitPreviewInspectorDataChange();
}

/** Applies inferred fields and one item per list to cross a backend-data blocker (Auto or user). */
function smartFillPreviewInspectorDataPayload(requestId, automatic = false) {
  initializePreviewInspectorDataState();
  const record = previewInspectorSession.dataRequests.get(requestId);
  if (record === undefined) return false;
  const current = previewInspectorSession.dataPayloadOverrides.get(requestId);
  const minimum = generatePreviewInspectorDataValue(record.shape, '', 'smart');
  const retainUserPayload = current?.mode === 'custom' || current?.mode === 'smart-custom';
  const selectedPayload = retainUserPayload
    ? completePreviewInspectorDataSmartPayload(current.payload, minimum)
    : minimum;
  if (typeof recordPreviewInspectorBlockerAutoDecision === 'function') {
    recordPreviewInspectorBlockerAutoDecision({
      action: 'Smart fill minimum backend payload',
      blockerId: requestId,
      blockerKind: 'data-request',
      blockerName: 'Backend data · ' + record.label,
      column: record.column,
      generatedPaths: readPreviewInspectorDataShapePaths(record.shape),
      line: record.line,
      mode: retainUserPayload ? 'smart-custom' : 'smart',
      ownerName: record.ownerName,
      reason: record.evidence,
      selectedValue: minimum,
      sourcePath: record.sourcePath,
      startsRenderAttempt: true,
      summary: {
        kind: record.kind,
        method: record.method,
        preservedUserPayload: retainUserPayload,
        url: record.url,
      },
    });
  }
  setPreviewInspectorDataPayload(
    requestId,
    selectedPayload,
    retainUserPayload ? 'smart-custom' : 'smart', automatic,
  );
  return true;
}

${reachabilityRuntimeSource}

/** Generates and applies a lorem payload using the same inferred type tree as Auto mode. */
function generatePreviewInspectorLoremPayload(requestId) {
  initializePreviewInspectorDataState();
  const record = previewInspectorSession.dataRequests.get(requestId);
  if (record === undefined) return;
  const payload = generatePreviewInspectorDataValue(record.shape, '', 'lorem');
  if (typeof recordPreviewInspectorBlockerAutoDecision === 'function') {
    recordPreviewInspectorBlockerAutoDecision({
      action: 'Generate typed Lorem backend payload',
      blockerId: requestId,
      blockerKind: 'data-request',
      blockerName: 'Backend data · ' + record.label,
      column: record.column,
      generatedPaths: readPreviewInspectorDataShapePaths(record.shape),
      line: record.line,
      mode: 'lorem',
      ownerName: record.ownerName,
      reason: record.evidence,
      selectedValue: payload,
      sourcePath: record.sourcePath,
      startsRenderAttempt: true,
      summary: { kind: record.kind, method: record.method, url: record.url },
    });
  }
  setPreviewInspectorDataPayload(requestId, payload, 'lorem');
}

/** Removes one manual override so the global Auto/seed policy becomes effective again. */
function resetPreviewInspectorDataPayload(requestId) {
  initializePreviewInspectorDataState();
  const record = previewInspectorSession.dataRequests.get(requestId);
  const overrideRemoved = previewInspectorSession.dataPayloadOverrides.delete(requestId);
  const resourceRemoved = clearPreviewInspectorVirtualBackendResource(requestId);
  if (!overrideRemoved && !resourceRemoved) return;
  if (
    record !== undefined &&
    previewInspectorSession.dataAutoEnabled &&
    typeof recordPreviewInspectorBlockerAutoDecision === 'function'
  ) {
    recordPreviewInspectorBlockerAutoDecision({
      action: 'Restore inferred backend payload',
      blockerId: requestId,
      blockerKind: 'data-request',
      blockerName: 'Backend data · ' + record.label,
      column: record.column,
      generatedPaths: readPreviewInspectorDataShapePaths(record.shape),
      line: record.line,
      mode: 'auto',
      ownerName: record.ownerName,
      reason: record.evidence,
      selectedValue: record.autoPayload,
      sourcePath: record.sourcePath,
      startsRenderAttempt: true,
      summary: { kind: record.kind, method: record.method, url: record.url },
    });
  }
  commitPreviewInspectorDataChange();
}

/** Reads a fetch/Request URL without invoking user-defined coercion more than once. */
function readPreviewInspectorFetchUrl(input) {
  if (typeof input === 'string') return input;
  if (input instanceof URL) return input.href;
  return typeof input?.url === 'string' ? input.url : String(input ?? '');
}

/** Reports whether a request is a backend candidate rather than a bundled local static asset. */
function shouldInterceptPreviewInspectorFetch(url, hasCompilerMetadata) {
  const pathWithoutQuery = url.split('?')[0] ?? '';
  const capturedLocalFixture = /^\.\.?\/.+\.(?:json|txt|csv)$/iu.test(pathWithoutQuery);
  if (hasCompilerMetadata) {
    return !capturedLocalFixture;
  }
  if (capturedLocalFixture || /^(?:blob|data|vscode-webview-resource):/iu.test(url)) return false;
  if (/^[a-z][a-z\d+.-]*:/iu.test(url)) return /^https?:\/\//iu.test(url);
  return url.length > 0;
}

/** Extracts GraphQL-over-HTTP metadata without retaining variables or authorization values. */
function readPreviewInspectorGraphqlFetchMetadata(init) {
  if (typeof init?.body !== 'string' || init.body.length > 1_000_000) return undefined;
  try {
    const body = JSON.parse(init.body);
    if (body === null || typeof body !== 'object' || typeof body.query !== 'string') return undefined;
    const operationName = typeof body.operationName === 'string' ? body.operationName : '';
    const anonymousIdentity = body.query.slice(0, 256) + ':' + body.query.slice(-256);
    return {
      graphqlSourceIdentity: typeof hashPreviewInspectorHookGraphqlRequestIdentity === 'function'
        ? hashPreviewInspectorHookGraphqlRequestIdentity(operationName + '\0' + body.query)
        : undefined,
      kind: 'graphql',
      label: operationName || 'GraphQL request',
      operationName: operationName || undefined,
      requestIdentity: operationName || anonymousIdentity,
      shape: inferPreviewInspectorGraphqlQueryShape(body.query, operationName),
    };
  } catch {
    return undefined;
  }
}

/** Creates the error envelope expected by REST or GraphQL consumers for an explicit error scenario. */
function createPreviewInspectorVirtualBackendErrorPayload(result, kind) {
  const message = 'Virtual backend returned HTTP ' + String(result.status);
  return kind === 'graphql'
    ? { data: null, errors: [{ message }] }
    : { error: message, preview: true, status: result.status };
}

${fetchResponseRuntimeSource}

/** Handles compiler-instrumented and third-party fetch calls through the editable data registry. */
async function previewInspectorFetch(input, init, compilerMetadata) {
  const url = readPreviewInspectorFetchUrl(input);
  if (!shouldInterceptPreviewInspectorFetch(url, compilerMetadata !== undefined)) {
    if (typeof previewInspectorNativeFetch === 'function') return previewInspectorNativeFetch(input, init);
  }
  const method = String(init?.method ?? input?.method ?? compilerMetadata?.method ?? 'GET').toUpperCase();
  const graphqlMetadata = readPreviewInspectorGraphqlFetchMetadata(init);
  const metadata = {
    ...(compilerMetadata !== null && typeof compilerMetadata === 'object' ? compilerMetadata : {}),
    ...(graphqlMetadata ?? {}),
    ...(graphqlMetadata === undefined
      ? {}
      : {
          id: createPreviewInspectorRuntimeRequestId(
            'graphql',
            method,
            url + ':' + graphqlMetadata.requestIdentity,
          ),
        }),
    method,
    url,
  };
  const result = resolvePreviewInspectorBackendRequest(metadata, {}, {
    body: init?.body,
    rawUrl: url,
  });
  await waitForPreviewInspectorVirtualBackendLatency(
    result.latencyMs,
    result.scenario === 'pending',
    result.requestId,
  );
  const wirePayload = result.scenario === 'error'
    ? createPreviewInspectorVirtualBackendErrorPayload(result, metadata.kind)
    : metadata.kind === 'graphql'
      ? { data: result.payload }
      : result.payload;
  return createPreviewInspectorFetchResponse(
    wirePayload,
    method,
    result.status,
    metadata.responseBodyKind,
    url,
  );
}

/** Returns the subset of AxiosResponse commonly consumed by React application code. */
async function previewInspectorAxiosRequest(method, url, extraArguments, compilerMetadata) {
  const normalizedMethod = String(method ?? 'GET').toUpperCase();
  const metadata = {
    ...(compilerMetadata !== null && typeof compilerMetadata === 'object' ? compilerMetadata : {}),
    method: normalizedMethod,
    url: readPreviewInspectorFetchUrl(url),
  };
  const requestBody = ['PATCH', 'POST', 'PUT'].includes(normalizedMethod)
    ? extraArguments?.[0]
    : undefined;
  const result = resolvePreviewInspectorBackendRequest(metadata, {}, {
    body: requestBody,
    rawUrl: metadata.url,
  });
  await waitForPreviewInspectorVirtualBackendLatency(
    result.latencyMs,
    result.scenario === 'pending',
    result.requestId,
  );
  const response = {
    config: Array.isArray(extraArguments) ? extraArguments.at(-1) ?? {} : {},
    data: result.scenario === 'error'
      ? createPreviewInspectorVirtualBackendErrorPayload(result, metadata.kind)
      : result.payload,
    headers: { 'content-type': 'application/json', 'x-react-preview': 'virtual-backend' },
    request: { preview: true },
    status: result.status,
    statusText: result.scenario === 'error' ? 'Virtual Backend Error' : 'OK',
  };
  if (result.scenario === 'error') {
    throw createPreviewInspectorVirtualBackendAxiosError(result, response.data);
  }
  return response;
}

${xmlHttpRequestRuntimeSource}

/** Replaces ambient fetch for uninstrumented fetch-based clients while preserving local assets. */
function installPreviewInspectorNetworkBoundary() {
  initializePreviewInspectorDataState();
  const boundary = (input, init) => previewInspectorFetch(input, init, undefined);
  try {
    globalThis.fetch = boundary;
  } catch {
    // A hardened host can expose a non-writable fetch; compiler-instrumented calls still work.
  }
  try {
    globalThis.XMLHttpRequest = PreviewInspectorXmlHttpRequest;
  } catch {
    // Direct fetch/Axios instrumentation remains active when a host reserves XMLHttpRequest.
  }
}
`;
}
