/**
 * Generates the stateful, browser-only backend used by React Page Inspector.
 *
 * The virtual backend sits behind the existing request adapters. It never opens a socket or owns a
 * port. Instead, it assigns requests to deterministic resources, retains successful REST state,
 * applies simple CRUD mutations, and exposes per-request response scenarios to the Inspector UI.
 */
import { createPreviewInspectorBackendIdentityRuntimeSource } from './previewInspectorBackendIdentityRuntimeSource';

/**
 * Creates browser source for the Page Inspector virtual backend broker.
 *
 * Expected lexical bindings include `previewInspectorSession`, persisted-state helpers, the common
 * payload shape helpers, and `commitPreviewInspectorDataChange` from the surrounding data runtime.
 * Function declarations are intentionally used throughout so the generated modules can be composed
 * without depending on textual declaration order.
 *
 * @returns Plain JavaScript source concatenated into the no-network data runtime.
 */
export function createPreviewInspectorVirtualBackendRuntimeSource(): string {
  const identityRuntimeSource = createPreviewInspectorBackendIdentityRuntimeSource();
  return String.raw`
const PREVIEW_INSPECTOR_BACKEND_RESOURCE_LIMIT = 192;
const PREVIEW_INSPECTOR_BACKEND_VALUE_DEPTH_LIMIT = 10;
const PREVIEW_INSPECTOR_BACKEND_VALUE_FIELD_LIMIT = 512;
const PREVIEW_INSPECTOR_BACKEND_MAX_LATENCY_MS = 10_000;
const previewInspectorBackendSensitiveNamePattern =
  /(?:authorization|cookie|credential|password|passwd|secret|session|token|api[-_]?key)/iu;
const previewInspectorBackendSetTimeout = typeof globalThis.setTimeout === 'function'
  ? globalThis.setTimeout.bind(globalThis)
  : undefined;

${identityRuntimeSource}

/** Restores bounded response scenarios and creates an ephemeral resource store for this webview. */
function initializePreviewInspectorVirtualBackendState() {
  if (!(previewInspectorSession.virtualBackendResources instanceof Map)) {
    previewInspectorSession.virtualBackendResources = new Map();
  }
  if (!(previewInspectorSession.virtualBackendFixtureFingerprints instanceof Map)) {
    previewInspectorSession.virtualBackendFixtureFingerprints = new Map();
  }
  if (!(previewInspectorSession.virtualBackendScenarios instanceof Map)) {
    const persisted = readPersistedPreviewInspectorState();
    const rawScenarios = persisted.virtualBackendScenarios;
    const entries = rawScenarios !== null && typeof rawScenarios === 'object'
      ? Object.entries(rawScenarios)
          .filter(([requestId]) => typeof requestId === 'string' && requestId.length > 0)
          .slice(0, PREVIEW_INSPECTOR_DATA_REQUEST_LIMIT)
          .map(([requestId, scenario]) => [
            requestId.slice(0, 160),
            normalizePreviewInspectorVirtualBackendScenario(scenario),
          ])
      : [];
    previewInspectorSession.virtualBackendScenarios = new Map(entries);
  }
}

/** Converts untrusted persisted/UI scenario input into finite transport-compatible values. */
function normalizePreviewInspectorVirtualBackendScenario(value) {
  const source = value !== null && typeof value === 'object' ? value : {};
  const mode = ['empty', 'error', 'success'].includes(source.mode) ? source.mode : 'success';
  const fallbackStatus = mode === 'error' ? 500 : 200;
  const numericStatus = Number(source.status);
  const numericLatency = Number(source.latencyMs);
  const minimumStatus = mode === 'error' ? 400 : 200;
  const maximumStatus = mode === 'error' ? 599 : 299;
  return {
    latencyMs: Number.isFinite(numericLatency)
      ? Math.max(0, Math.min(PREVIEW_INSPECTOR_BACKEND_MAX_LATENCY_MS, Math.round(numericLatency)))
      : 0,
    mode,
    status: Number.isFinite(numericStatus)
      ? Math.max(minimumStatus, Math.min(maximumStatus, Math.round(numericStatus)))
      : fallbackStatus,
  };
}

/** Serializes only request scenario controls; generated resource data deliberately resets on reload. */
function serializePreviewInspectorVirtualBackendScenarios() {
  initializePreviewInspectorVirtualBackendState();
  return Object.fromEntries(
    [...previewInspectorSession.virtualBackendScenarios]
      .slice(0, PREVIEW_INSPECTOR_DATA_REQUEST_LIMIT)
      .map(([requestId, scenario]) => [requestId, { ...scenario }]),
  );
}

/** Reads one request's scenario, returning the default immediate-success policy when absent. */
function readPreviewInspectorVirtualBackendScenario(requestId) {
  initializePreviewInspectorVirtualBackendState();
  return previewInspectorSession.virtualBackendScenarios.get(requestId) ?? {
    latencyMs: 0,
    mode: 'success',
    status: 200,
  };
}

/** Updates success/empty/error and latency controls, then remounts consumers of this request. */
function setPreviewInspectorVirtualBackendScenario(requestId, scenario) {
  initializePreviewInspectorVirtualBackendState();
  if (!previewInspectorSession.dataRequests.has(requestId)) return;
  const normalized = normalizePreviewInspectorVirtualBackendScenario(scenario);
  const previous = readPreviewInspectorVirtualBackendScenario(requestId);
  if (stringifyPreviewInspectorProps(previous) === stringifyPreviewInspectorProps(normalized)) return;
  if (normalized.mode === 'success' && normalized.status === 200 && normalized.latencyMs === 0) {
    previewInspectorSession.virtualBackendScenarios.delete(requestId);
  } else {
    previewInspectorSession.virtualBackendScenarios.set(requestId, normalized);
  }
  commitPreviewInspectorDataChange();
}

/** Removes a request-specific transport scenario and restores an immediate 200 response. */
function resetPreviewInspectorVirtualBackendScenario(requestId) {
  initializePreviewInspectorVirtualBackendState();
  if (!previewInspectorSession.virtualBackendScenarios.delete(requestId)) return;
  commitPreviewInspectorDataChange();
}

/** Copies request data into a JSON-safe bounded value while redacting credentials and prototypes. */
function sanitizePreviewInspectorVirtualBackendValue(
  value,
  propertyName = '',
  depth = 0,
  budget = { fields: 0 },
  seen = new WeakSet(),
) {
  if (previewInspectorBackendSensitiveNamePattern.test(String(propertyName))) return '[redacted]';
  if (depth > PREVIEW_INSPECTOR_BACKEND_VALUE_DEPTH_LIMIT) return undefined;
  if (value === null || typeof value === 'boolean' || typeof value === 'number') return value;
  if (typeof value === 'bigint') return value.toString();
  if (typeof value === 'string') return value.slice(0, 2_048);
  if (value === undefined || typeof value === 'function' || typeof value === 'symbol') return undefined;
  if (typeof value !== 'object' || seen.has(value)) return undefined;
  seen.add(value);
  if (Array.isArray(value)) {
    return value.slice(0, 64).map((item) =>
      sanitizePreviewInspectorVirtualBackendValue(item, propertyName, depth + 1, budget, seen),
    );
  }
  if (typeof URLSearchParams === 'function' && value instanceof URLSearchParams) {
    return Object.fromEntries(
      [...value.entries()].slice(0, 128).map(([name, item]) => [
        name,
        sanitizePreviewInspectorVirtualBackendValue(item, name, depth + 1, budget, seen),
      ]),
    );
  }
  if (typeof FormData === 'function' && value instanceof FormData) {
    const fields = {};
    for (const [name, item] of [...value.entries()].slice(0, 128)) {
      fields[name] = typeof item === 'string'
        ? sanitizePreviewInspectorVirtualBackendValue(item, name, depth + 1, budget, seen)
        : '[binary]';
    }
    return fields;
  }
  const result = {};
  for (const [name, item] of Object.entries(value)) {
    if (
      blockedInspectorPropNames.has(name) ||
      budget.fields >= PREVIEW_INSPECTOR_BACKEND_VALUE_FIELD_LIMIT
    ) {
      continue;
    }
    budget.fields += 1;
    const safeItem = sanitizePreviewInspectorVirtualBackendValue(
      item,
      name,
      depth + 1,
      budget,
      seen,
    );
    if (safeItem !== undefined) result[name] = safeItem;
  }
  return result;
}

/** Parses common browser request bodies without retaining raw text or multipart binary values. */
function readPreviewInspectorVirtualBackendRequestPayload(rawBody) {
  if (typeof rawBody === 'string') {
    if (rawBody.length > 1_000_000) return {};
    try {
      const parsed = JSON.parse(rawBody);
      const body = parsed !== null && typeof parsed === 'object' &&
        typeof parsed.query === 'string'
        ? parsed.variables ?? {}
        : parsed;
      return sanitizePreviewInspectorVirtualBackendValue(body) ?? {};
    } catch {
      try {
        return sanitizePreviewInspectorVirtualBackendValue(new URLSearchParams(rawBody)) ?? {};
      } catch {
        return {};
      }
    }
  }
  return sanitizePreviewInspectorVirtualBackendValue(rawBody) ?? {};
}

/** Produces deterministic JSON by sorting object keys before a request fingerprint is hashed. */
function stableStringifyPreviewInspectorVirtualBackendValue(value) {
  if (Array.isArray(value)) {
    return '[' + value.map(stableStringifyPreviewInspectorVirtualBackendValue).join(',') + ']';
  }
  if (value !== null && typeof value === 'object') {
    return '{' + Object.keys(value).sort().map((name) =>
      JSON.stringify(name) + ':' + stableStringifyPreviewInspectorVirtualBackendValue(value[name]),
    ).join(',') + '}';
  }
  return JSON.stringify(value) ?? 'null';
}

/** Extracts non-sensitive query values for identity only; the descriptor itself is never displayed. */
function readPreviewInspectorVirtualBackendQueryIdentity(rawUrl) {
  if (typeof rawUrl !== 'string' || !rawUrl.includes('?')) return {};
  try {
    const parsed = new URL(rawUrl, globalThis.location?.href ?? 'https://preview.invalid/');
    return Object.fromEntries(
      [...parsed.searchParams.entries()]
        .slice(0, 128)
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([name, value]) => [
          name,
          previewInspectorBackendSensitiveNamePattern.test(name) ? '[redacted]' : value.slice(0, 512),
        ]),
    );
  } catch {
    return {};
  }
}

/** Returns a normalized URL pathname suitable for sharing state across HTTP methods. */
function createPreviewInspectorVirtualBackendRestResourceKey(url) {
  const safeUrl = sanitizePreviewInspectorRequestUrl(url);
  try {
    const parsed = new URL(safeUrl || '/', globalThis.location?.href ?? 'https://preview.invalid/');
    const pathname = parsed.pathname.replace(/\/+$/u, '') || '/';
    const origin = parsed.origin === 'https://preview.invalid' ? '' : parsed.origin;
    return 'rest:' + origin + pathname;
  } catch {
    return 'rest:' + (safeUrl.split('?')[0] || '/');
  }
}

/** Describes one resource, mutation collection, and private variant key for the shared broker. */
function createPreviewInspectorVirtualBackendDescriptor(record, requestContext) {
  const rawUrl = String(requestContext?.rawUrl ?? record.url ?? '');
  const requestPayload = readPreviewInspectorVirtualBackendRequestPayload(requestContext?.body);
  const queryIdentity = readPreviewInspectorVirtualBackendQueryIdentity(rawUrl);
  const method = String(record.method ?? 'GET').toUpperCase();
  const operationName = String(record.operationName ?? 'Anonymous operation');
  const resourceKey = record.kind === 'graphql'
    ? 'graphql:' + operationName
    : createPreviewInspectorVirtualBackendRestResourceKey(rawUrl || record.url || '');
  const identityPayload = stableStringifyPreviewInspectorVirtualBackendValue({
    body: requestPayload,
    query: queryIdentity,
  });
  const variantKey = createPreviewInspectorRuntimeRequestId(
    record.kind,
    method,
    resourceKey + ':' + identityPayload,
  );
  const mutationKey = resourceKey + ':mutation:' + method + ':' + variantKey;
  const pathSegments = resourceKey.split('/').filter(Boolean);
  const mutationTargetsItem = record.kind === 'rest' &&
    ['DELETE', 'PATCH', 'PUT'].includes(method) && pathSegments.length > 1;
  const collectionKey = mutationTargetsItem
    ? resourceKey.slice(0, resourceKey.lastIndexOf('/'))
    : resourceKey;
  const pathIdentifier = mutationTargetsItem ? pathSegments.at(-1) : undefined;
  const bodyIdentifier = requestPayload !== null && typeof requestPayload === 'object' &&
    !Array.isArray(requestPayload)
    ? requestPayload.id ?? requestPayload.identifier
    : undefined;
  return {
    collectionKey,
    entityId: bodyIdentifier ?? pathIdentifier,
    mutationKey,
    requestFields: readPreviewInspectorDataShapePaths(
      inferPreviewInspectorDataShape(requestPayload),
    ),
    requestPayload,
    resourceKey,
    variantKey,
  };
}

/** Clones local fixture state so application code cannot mutate the backend store by reference. */
function clonePreviewInspectorVirtualBackendPayload(payload) {
  try {
    return JSON.parse(stringifyPreviewInspectorProps(payload));
  } catch {
    return payload;
  }
}

/** Adds inferred defaults recursively while preserving existing state and user-authored leaves. */
function mergePreviewInspectorVirtualBackendDefaults(generated, existing, depth = 0) {
  if (depth > PREVIEW_INSPECTOR_BACKEND_VALUE_DEPTH_LIMIT || existing === undefined) {
    return clonePreviewInspectorVirtualBackendPayload(generated);
  }
  if (Array.isArray(generated) && Array.isArray(existing)) {
    return existing.map((item, index) =>
      mergePreviewInspectorVirtualBackendDefaults(generated[index] ?? generated[0], item, depth + 1),
    );
  }
  if (
    generated !== null && existing !== null &&
    typeof generated === 'object' && typeof existing === 'object' &&
    !Array.isArray(generated) && !Array.isArray(existing)
  ) {
    const result = { ...generated };
    for (const [name, value] of Object.entries(existing)) {
      if (!blockedInspectorPropNames.has(name)) {
        result[name] = Object.hasOwn(generated, name)
          ? mergePreviewInspectorVirtualBackendDefaults(generated[name], value, depth + 1)
          : clonePreviewInspectorVirtualBackendPayload(value);
      }
    }
    return result;
  }
  return clonePreviewInspectorVirtualBackendPayload(existing);
}

/** Merges a mutation body into a compatible response, including common one-object envelopes. */
function mergePreviewInspectorVirtualBackendMutationPayload(generated, requestPayload) {
  if (requestPayload === null || typeof requestPayload !== 'object') return generated;
  if (Array.isArray(generated)) {
    return Array.isArray(requestPayload)
      ? mergePreviewInspectorVirtualBackendDefaults(generated, requestPayload)
      : generated;
  }
  if (generated === null || typeof generated !== 'object') return requestPayload;
  if (Array.isArray(requestPayload)) return generated;
  const generatedNames = Object.keys(generated);
  const sharesRootField = Object.keys(requestPayload).some((name) => Object.hasOwn(generated, name));
  if (!sharesRootField && generatedNames.length === 1) {
    const envelopeName = generatedNames[0];
    const envelope = generated[envelopeName];
    if (envelope !== null && typeof envelope === 'object' && !Array.isArray(envelope)) {
      return {
        ...generated,
        [envelopeName]: mergePreviewInspectorVirtualBackendDefaults(envelope, requestPayload),
      };
    }
  }
  return mergePreviewInspectorVirtualBackendDefaults(generated, requestPayload);
}

/** Stores one canonical resource with FIFO eviction to bound long-running Inspector sessions. */
function writePreviewInspectorVirtualBackendResource(resourceKey, payload) {
  initializePreviewInspectorVirtualBackendState();
  if (
    !previewInspectorSession.virtualBackendResources.has(resourceKey) &&
    previewInspectorSession.virtualBackendResources.size >= PREVIEW_INSPECTOR_BACKEND_RESOURCE_LIMIT
  ) {
    const oldestKey = previewInspectorSession.virtualBackendResources.keys().next().value;
    if (oldestKey !== undefined) previewInspectorSession.virtualBackendResources.delete(oldestKey);
  }
  previewInspectorSession.virtualBackendResources.set(
    resourceKey,
    clonePreviewInspectorVirtualBackendPayload(payload),
  );
}

/** Finds an entity identifier in either a flat object or a conventional one-object envelope. */
function readPreviewInspectorVirtualBackendEntity(payload) {
  if (payload === null || typeof payload !== 'object' || Array.isArray(payload)) return payload;
  if (payload.id !== undefined || payload.identifier !== undefined) return payload;
  const values = Object.values(payload);
  return values.length === 1 && values[0] !== null && typeof values[0] === 'object' &&
    !Array.isArray(values[0])
    ? values[0]
    : payload;
}

/** Writes an identifier into a flat mutation result or its conventional one-object envelope. */
function writePreviewInspectorVirtualBackendEntityId(payload, entityId) {
  if (payload === null || typeof payload !== 'object' || Array.isArray(payload)) return payload;
  if (payload.id !== undefined || payload.identifier !== undefined) {
    return Object.hasOwn(payload, 'identifier') && !Object.hasOwn(payload, 'id')
      ? { ...payload, identifier: entityId }
      : { ...payload, id: entityId };
  }
  const names = Object.keys(payload);
  if (names.length === 1) {
    const envelopeName = names[0];
    const envelope = payload[envelopeName];
    if (envelope !== null && typeof envelope === 'object' && !Array.isArray(envelope)) {
      return { ...payload, [envelopeName]: writePreviewInspectorVirtualBackendEntityId(envelope, entityId) };
    }
  }
  return { ...payload, id: entityId };
}

/** Allocates a stable preview identifier that cannot overwrite an existing generated collection row. */
function createPreviewInspectorVirtualBackendEntityId(collectionKey) {
  const collection = previewInspectorSession.virtualBackendResources.get(collectionKey);
  const existingIds = new Set(
    Array.isArray(collection)
      ? collection.map((item) => String(item?.id ?? item?.identifier ?? ''))
      : [],
  );
  let index = existingIds.size + 1;
  while (existingIds.has('preview-' + String(index))) index += 1;
  return 'preview-' + String(index);
}

/** Applies a created or edited entity to any canonical collection already observed for its route. */
function upsertPreviewInspectorVirtualBackendCollection(collectionKey, payload, entityId, append) {
  const existing = previewInspectorSession.virtualBackendResources.get(collectionKey);
  const entity = readPreviewInspectorVirtualBackendEntity(payload);
  if (!Array.isArray(existing)) {
    if (append) writePreviewInspectorVirtualBackendResource(collectionKey, [entity]);
    return;
  }
  const identity = entityId ?? entity?.id ?? entity?.identifier;
  const index = identity === undefined
    ? -1
    : existing.findIndex((item) => String(item?.id ?? item?.identifier) === String(identity));
  const next = [...existing];
  if (index >= 0) next[index] = mergePreviewInspectorVirtualBackendDefaults(next[index], entity);
  else if (append) next.push(entity);
  writePreviewInspectorVirtualBackendResource(collectionKey, next);
}

/** Removes one entity from canonical collection and item resources after a DELETE request. */
function deletePreviewInspectorVirtualBackendEntity(descriptor) {
  const existing = previewInspectorSession.virtualBackendResources.get(descriptor.collectionKey);
  if (Array.isArray(existing) && descriptor.entityId !== undefined) {
    writePreviewInspectorVirtualBackendResource(
      descriptor.collectionKey,
      existing.filter((item) =>
        String(item?.id ?? item?.identifier) !== String(descriptor.entityId),
      ),
    );
  }
  previewInspectorSession.virtualBackendResources.delete(descriptor.resourceKey);
}

/** Converts one inferred shape into a safe empty-result scenario without dropping object envelopes. */
function createPreviewInspectorVirtualBackendEmptyPayload(shape, depth = 0) {
  if (depth > PREVIEW_INSPECTOR_BACKEND_VALUE_DEPTH_LIMIT || shape === null || typeof shape !== 'object') {
    return null;
  }
  if (shape.kind === 'array') return [];
  if (shape.kind === 'object') {
    return Object.fromEntries(Object.entries(shape.fields ?? {}).map(([name, child]) => [
      name,
      createPreviewInspectorVirtualBackendEmptyPayload(child, depth + 1),
    ]));
  }
  if (shape.kind === 'boolean') return false;
  if (shape.kind === 'number') return 0;
  if (shape.kind === 'string') return '';
  return null;
}

/** Reports whether an authored fixture changed since this exact request variant was last applied. */
function shouldApplyPreviewInspectorVirtualBackendFixture(record, descriptor, payload, payloadMode) {
  if (!['custom', 'lorem', 'smart', 'smart-custom'].includes(payloadMode)) return false;
  const fixtureKey = record.id + ':' + descriptor.variantKey;
  const fingerprint = payloadMode + ':' + stringifyPreviewInspectorProps(payload);
  const changed = previewInspectorSession.virtualBackendFixtureFingerprints.get(fixtureKey) !== fingerprint;
  previewInspectorSession.virtualBackendFixtureFingerprints.set(fixtureKey, fingerprint);
  return changed;
}

/** Resolves one successful REST request against canonical state and applies basic CRUD semantics. */
function resolvePreviewInspectorVirtualBackendRestPayload(record, generated, descriptor, payloadMode) {
  const method = String(record.method ?? 'GET').toUpperCase();
  const existing = previewInspectorSession.virtualBackendResources.get(descriptor.resourceKey);
  const authoredFixture = ['custom', 'lorem', 'smart', 'smart-custom'].includes(payloadMode);
  if (method === 'GET' || method === 'HEAD') {
    if (payloadMode === 'seed') return clonePreviewInspectorVirtualBackendPayload(generated);
    const fixtureChanged = shouldApplyPreviewInspectorVirtualBackendFixture(
      record,
      descriptor,
      generated,
      payloadMode,
    );
    const payload = fixtureChanged || existing === undefined
      ? clonePreviewInspectorVirtualBackendPayload(generated)
      : mergePreviewInspectorVirtualBackendDefaults(generated, existing);
    writePreviewInspectorVirtualBackendResource(descriptor.resourceKey, payload);
    return payload;
  }
  if (method === 'POST') {
    const previousMutation = previewInspectorSession.virtualBackendResources.get(
      descriptor.mutationKey,
    );
    if (previousMutation !== undefined && !authoredFixture) {
      return clonePreviewInspectorVirtualBackendPayload(previousMutation);
    }
    let payload = mergePreviewInspectorVirtualBackendMutationPayload(
      generated,
      descriptor.requestPayload,
    );
    const previousEntity = readPreviewInspectorVirtualBackendEntity(previousMutation);
    const entityId = descriptor.entityId ?? previousEntity?.id ?? previousEntity?.identifier ??
      createPreviewInspectorVirtualBackendEntityId(descriptor.collectionKey);
    payload = writePreviewInspectorVirtualBackendEntityId(payload, entityId);
    upsertPreviewInspectorVirtualBackendCollection(
      descriptor.collectionKey,
      payload,
      entityId,
      previousMutation === undefined,
    );
    writePreviewInspectorVirtualBackendResource(descriptor.mutationKey, payload);
    return payload;
  }
  if (method === 'PATCH' || method === 'PUT') {
    let payload = mergePreviewInspectorVirtualBackendMutationPayload(
      generated,
      descriptor.requestPayload,
    );
    if (descriptor.entityId !== undefined) {
      payload = writePreviewInspectorVirtualBackendEntityId(payload, descriptor.entityId);
    }
    writePreviewInspectorVirtualBackendResource(descriptor.resourceKey, payload);
    upsertPreviewInspectorVirtualBackendCollection(
      descriptor.collectionKey,
      payload,
      descriptor.entityId,
      false,
    );
    return payload;
  }
  if (method === 'DELETE') {
    deletePreviewInspectorVirtualBackendEntity(descriptor);
    return clonePreviewInspectorVirtualBackendPayload(generated);
  }
  const payload = existing === undefined
    ? clonePreviewInspectorVirtualBackendPayload(generated)
    : mergePreviewInspectorVirtualBackendDefaults(generated, existing);
  writePreviewInspectorVirtualBackendResource(descriptor.resourceKey, payload);
  return payload;
}

/** Resolves GraphQL operations by operation and variables while leaving schema-specific mutations isolated. */
function resolvePreviewInspectorVirtualBackendGraphqlPayload(record, generated, descriptor, payloadMode) {
  if (payloadMode === 'seed') return clonePreviewInspectorVirtualBackendPayload(generated);
  const stateKey = descriptor.resourceKey + ':' + descriptor.variantKey;
  const existing = previewInspectorSession.virtualBackendResources.get(stateKey);
  const fixtureChanged = shouldApplyPreviewInspectorVirtualBackendFixture(
    record,
    descriptor,
    generated,
    payloadMode,
  );
  const payload = fixtureChanged || existing === undefined
    ? clonePreviewInspectorVirtualBackendPayload(generated)
    : mergePreviewInspectorVirtualBackendDefaults(generated, existing);
  writePreviewInspectorVirtualBackendResource(stateKey, payload);
  return payload;
}

/**
 * Routes one normalized request through scenario policy and the appropriate in-memory state model.
 * The returned descriptor is JSON-safe and can be passed through the global Inspector facade.
 */
function resolvePreviewInspectorVirtualBackendRequest(
  record,
  generatedPayload,
  requestContext = {},
  payloadMode = 'auto',
) {
  initializePreviewInspectorVirtualBackendState();
  const descriptor = createPreviewInspectorVirtualBackendDescriptor(record, requestContext);
  const scenario = readPreviewInspectorVirtualBackendScenario(record.id);
  let payload;
  if (scenario.mode === 'empty') {
    payload = createPreviewInspectorVirtualBackendEmptyPayload(record.shape);
  } else if (scenario.mode === 'error') {
    payload = null;
  } else {
    payload = record.kind === 'graphql'
      ? resolvePreviewInspectorVirtualBackendGraphqlPayload(
          record,
          generatedPayload,
          descriptor,
          payloadMode,
        )
      : resolvePreviewInspectorVirtualBackendRestPayload(
          record,
          generatedPayload,
          descriptor,
          payloadMode,
        );
  }
  const identityAlignment = record.kind === 'graphql' && scenario.mode === 'success'
    ? alignPreviewInspectorBackendGraphqlIdentities(
        payload,
        descriptor.requestPayload,
        payloadMode,
      )
    : { paths: [], payload };
  payload = identityAlignment.payload;
  return {
    collectionKey: descriptor.collectionKey,
    deterministicIdentityPaths: identityAlignment.paths,
    latencyMs: scenario.latencyMs,
    payload: clonePreviewInspectorVirtualBackendPayload(payload),
    requestFields: descriptor.requestFields,
    resourceKey: descriptor.resourceKey,
    mutationKey: descriptor.mutationKey,
    payloadMode,
    scenario: scenario.mode,
    stateful: record.kind === 'rest',
    status: scenario.status,
    variantKey: descriptor.variantKey,
  };
}

/** Clears canonical data for one observed request without committing a page remount. */
function clearPreviewInspectorVirtualBackendResource(requestId) {
  initializePreviewInspectorVirtualBackendState();
  const record = previewInspectorSession.dataRequests.get(requestId);
  const resourceKey = record?.virtualBackend?.resourceKey;
  const collectionKey = record?.virtualBackend?.collectionKey;
  if (typeof resourceKey !== 'string') return false;
  let changed = previewInspectorSession.virtualBackendResources.delete(resourceKey);
  if (typeof collectionKey === 'string') {
    changed = previewInspectorSession.virtualBackendResources.delete(collectionKey) || changed;
  }
  for (const key of [...previewInspectorSession.virtualBackendResources.keys()]) {
    if (key.startsWith(resourceKey + ':')) {
      changed = previewInspectorSession.virtualBackendResources.delete(key) || changed;
    }
  }
  for (const key of [...previewInspectorSession.virtualBackendFixtureFingerprints.keys()]) {
    if (key.startsWith(requestId + ':')) {
      previewInspectorSession.virtualBackendFixtureFingerprints.delete(key);
    }
  }
  return changed;
}

/** Clears canonical data for one observed request while preserving its response scenario and fixture. */
function resetPreviewInspectorVirtualBackendResource(requestId) {
  const changed = clearPreviewInspectorVirtualBackendResource(requestId);
  if (changed) commitPreviewInspectorDataChange();
}

/** Waits for a configured preview latency without using a project-supplied timer implementation. */
async function waitForPreviewInspectorVirtualBackendLatency(latencyMs) {
  if (!(latencyMs > 0) || typeof previewInspectorBackendSetTimeout !== 'function') return;
  await new Promise((resolve) => previewInspectorBackendSetTimeout(resolve, latencyMs));
}

/** Creates an Axios-compatible rejection object without importing or executing Axios constructors. */
function createPreviewInspectorVirtualBackendAxiosError(result, responsePayload) {
  const error = new Error('Virtual backend returned HTTP ' + String(result.status));
  error.code = 'ERR_BAD_RESPONSE';
  error.isAxiosError = true;
  error.response = {
    data: responsePayload,
    headers: { 'content-type': 'application/json', 'x-react-preview': 'virtual-backend' },
    status: result.status,
    statusText: 'Virtual Backend Error',
  };
  return error;
}
`;
}
