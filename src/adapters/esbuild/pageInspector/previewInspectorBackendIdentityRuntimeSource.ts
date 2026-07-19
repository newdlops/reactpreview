/**
 * Generates deterministic GraphQL request/response identity alignment for the virtual backend.
 *
 * Static payload generation cannot know schema resolver semantics, but a scalar `companyId`
 * variable and a directly returned `company... { id }` entity prove one equality commonly used by
 * route guards. This adapter repairs only that exact relationship and leaves ambiguous, nested,
 * collection, and explicitly user-authored payloads unchanged.
 */

/** Creates browser source that aligns direct generated entities with unique GraphQL ID variables. */
export function createPreviewInspectorBackendIdentityRuntimeSource(): string {
  return String.raw`
/** Reads scalar request identities from the already-sanitized GraphQL variables object. */
function readPreviewInspectorBackendIdentityCandidates(requestPayload) {
  if (requestPayload === null || typeof requestPayload !== 'object' || Array.isArray(requestPayload)) {
    return [];
  }
  return Object.entries(requestPayload).flatMap(([name, value]) => {
    if (!/id$/iu.test(name) || !['number', 'string'].includes(typeof value)) return [];
    if (typeof value === 'string' && (value.length === 0 || value === '[redacted]')) return [];
    return [{
      baseName: name.replace(/id$/iu, '').replace(/[^A-Za-z0-9]/gu, '').toLowerCase(),
      name,
      value,
    }];
  }).slice(0, 16);
}

/** Selects an identity only when the root field match or the whole request is unambiguous. */
function selectPreviewInspectorBackendIdentity(rootFieldName, candidates) {
  const normalizedRoot = String(rootFieldName).replace(/[^A-Za-z0-9]/gu, '').toLowerCase();
  const matches = candidates.filter(
    (candidate) => candidate.baseName.length > 0 && normalizedRoot.includes(candidate.baseName),
  );
  if (matches.length === 1) return matches[0];
  return candidates.length === 1 ? candidates[0] : undefined;
}

/**
 * Repairs only generated payloads. Custom and Smart-custom fixtures remain exact user scenarios,
 * including intentional route mismatches used to inspect authored error pages.
 */
function alignPreviewInspectorBackendGraphqlIdentities(payload, requestPayload, payloadMode) {
  if (
    ['custom', 'smart-custom'].includes(payloadMode) ||
    payload === null ||
    typeof payload !== 'object' ||
    Array.isArray(payload)
  ) {
    return { paths: [], payload };
  }
  const candidates = readPreviewInspectorBackendIdentityCandidates(requestPayload);
  if (candidates.length === 0) return { paths: [], payload };
  const aligned = { ...payload };
  const paths = [];
  for (const [rootFieldName, entity] of Object.entries(payload)) {
    if (entity === null || typeof entity !== 'object' || Array.isArray(entity)) continue;
    if (!Object.hasOwn(entity, 'id')) continue;
    const identity = selectPreviewInspectorBackendIdentity(rootFieldName, candidates);
    if (identity === undefined || entity.id === identity.value) continue;
    aligned[rootFieldName] = { ...entity, id: identity.value };
    paths.push(rootFieldName + '.id <- ' + identity.name);
  }
  return paths.length === 0 ? { paths, payload } : { paths, payload: aligned };
}
`;
}
