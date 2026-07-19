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
/** Reports whether activating a generated flag is likely to select an error or exit branch. */
function isPreviewInspectorDisruptiveBooleanField(fieldName) {
  const name = String(fieldName).replaceAll('_', '').toLowerCase();
  return /(?:delet|remov|suspend|block|forbid|denied|unauthor|error|fail|invalid|loading|pending|creating|requesting|paymentrequired|authenticate|expired|ended|inactive|hidden|disabled|locked)/u.test(name);
}

/** Chooses the least disruptive boolean consistent with common API field semantics. */
function createPreviewInspectorBooleanValue(fieldName) {
  const name = String(fieldName).replaceAll('_', '').toLowerCase();
  if (
    /(?:isowner|owneraccess|canaccess|hasaccess|isallowed|haspermission|authorized|completed|finished|paid|filled|ready|success|valid|available|visible|active|selected|checked|enabled)$/u.test(name)
  ) {
    return true;
  }
  if (isPreviewInspectorDisruptiveBooleanField(fieldName)) {
    return false;
  }
  if (/^(?:can|allow)/u.test(name)) return true;
  return false;
}

/** Extracts a stable final noun from camelCase/snake_case response container names. */
function readPreviewInspectorDataContainerNoun(fieldName) {
  const tokens = String(fieldName)
    .replace(/([a-z\d])([A-Z])/gu, '$1 $2')
    .split(/[^A-Za-z\d]+/u)
    .filter(Boolean);
  const noun = String(tokens.at(-1) ?? '').toLowerCase();
  if (noun.endsWith('ies')) return noun.slice(0, -3) + 'y';
  return noun.length > 4 && noun.endsWith('s') ? noun.slice(0, -1) : noun;
}

/**
 * Materializes an object and opens one mutually exclusive positive branch when static shape proves
 * multiple sibling role flags tied to the container noun. This prevents all-false exhaustive
 * dispatches without enabling unrelated authentication, error, or lifecycle booleans.
 */
function createPreviewInspectorObjectValue(fields, fieldName, mode, itemIndex, depth) {
  const entries = Object.entries(fields);
  const result = Object.fromEntries(entries.map(([name, child]) => [
    name,
    materializePreviewInspectorDataValue(child, name, mode, itemIndex, depth + 1),
  ]));
  const noun = readPreviewInspectorDataContainerNoun(fieldName);
  if (noun.length < 3) return result;
  const branchNames = entries
    .filter(([name, child]) =>
      child?.kind === 'boolean' &&
      /^(?:is|has|can)[A-Z_]/u.test(name) &&
      String(name).replaceAll('_', '').toLowerCase().includes(noun) &&
      !isPreviewInspectorDisruptiveBooleanField(name),
    )
    .map(([name]) => name);
  if (branchNames.length >= 2) result[branchNames[0]] = true;
  return result;
}
`;
}
