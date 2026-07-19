/**
 * Generates the GraphQL-aware adapter used by render-blocking hook recovery.
 *
 * Apollo's memory client already produces selection-shaped responses, but a project wrapper often
 * converts the first loading/error render into `{ data: undefined, fallback: <Error /> }` before
 * that response arrives. The hook circuit breaker can retain the authored GraphQL `DocumentNode`,
 * so this adapter deterministically supplies the same selected fields immediately. It never sends
 * a request, imports a project module, or guesses fields that are absent from the document.
 */

/** Creates browser source that turns an authored GraphQL document into one settled hook result. */
export function createPreviewInspectorHookGraphqlRuntimeSource(): string {
  return String.raw`
const PREVIEW_INSPECTOR_HOOK_GRAPHQL_SOURCE_LIMIT = 1_000_000;

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
    const data = generatePreviewInspectorDataValue(shape, '', 'smart');
    return data !== null && typeof data === 'object'
      ? alignPreviewInspectorHookGraphqlResponseIdentities(data, readOptions)
      : undefined;
  } catch {
    return undefined;
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
  const settled = hasObjectFallback ? { ...fallback, data } : { data };
  settled.loading = false;
  settled.fallback = null;
  settled.error = null;
  settled.networkStatus = 7;
  if (typeof settled.refetch !== 'function') {
    settled.refetch = Object.freeze(() => Promise.resolve({ data }));
  }
  return Object.freeze(settled);
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
