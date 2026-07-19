/**
 * Generates semantic boolean values for static API and GraphQL payloads.
 *
 * Returning `true` for every boolean activates deletion, suspension, loading, authentication, and
 * error branches, which hides an otherwise renderable page. Returning `false` for every boolean
 * also blocks owner/access corridors. This policy therefore recognizes high-confidence positive
 * capabilities separately and keeps disruptive lifecycle/guard states inactive. Unknown flags
 * remain false so the preview does not invent optional application behavior.
 */

/** Creates the browser helper used by the shared deterministic payload materializer. */
export function createPreviewInspectorDataBooleanRuntimeSource(): string {
  return String.raw`
/** Chooses the least disruptive boolean consistent with common API field semantics. */
function createPreviewInspectorBooleanValue(fieldName) {
  const name = String(fieldName).replaceAll('_', '').toLowerCase();
  if (
    /(?:isowner|owneraccess|canaccess|hasaccess|isallowed|haspermission|authorized|completed|finished|paid|filled|ready|success|valid|available|visible|active|selected|checked|enabled)$/u.test(name)
  ) {
    return true;
  }
  if (
    /(?:delet|remov|suspend|block|forbid|denied|unauthor|error|fail|invalid|loading|pending|creating|requesting|paymentrequired|authenticate|expired|hidden|disabled|locked)/u.test(name)
  ) {
    return false;
  }
  if (/^(?:can|allow)/u.test(name)) return true;
  return false;
}
`;
}
