/**
 * Generates the referential-identity boundary for virtual backend response records.
 *
 * React query consumers frequently place returned data in effect or memo dependency arrays. A
 * fixture backend that clones an unchanged payload on every read therefore creates update loops
 * that the production client would not produce. This isolated runtime fragment keeps identity
 * policy separate from payload inference and transport emulation.
 */

/**
 * Creates browser source that reuses one prior payload when its response variant is unchanged.
 *
 * Expected lexical bindings include `stringifyPreviewInspectorProps`, which is supplied by the
 * parent Page Inspector runtime before this fragment is evaluated.
 *
 * @returns Plain JavaScript defining `createPreviewInspectorStableBackendRecord`.
 */
export function createPreviewInspectorDataIdentityRuntimeSource(): string {
  return String.raw`
/** Builds one request record while retaining stable query-data identity for equal responses. */
function createPreviewInspectorStableBackendRecord(previous, resolvedPayload, virtualBackend, next) {
  const payloadFingerprint = stringifyPreviewInspectorProps(resolvedPayload);
  const responseVariantIsUnchanged =
    previous?.lastPayloadFingerprint === payloadFingerprint &&
    previous.virtualBackend?.payloadMode === virtualBackend.payloadMode &&
    previous.virtualBackend?.scenario === virtualBackend.scenario &&
    previous.virtualBackend?.status === virtualBackend.status &&
    previous.virtualBackend?.variantKey === virtualBackend.variantKey;
  return {
    ...next,
    lastPayload: responseVariantIsUnchanged ? previous.lastPayload : resolvedPayload,
    lastPayloadFingerprint: payloadFingerprint,
    virtualBackend,
  };
}
`;
}
