/**
 * Generates JSON-visible templates for render-blocker pass values.
 *
 * Compiler fallbacks legitimately contain functions and `undefined`, but ordinary JSON drops both
 * and can reduce a useful inferred object to `{}`. This adapter keeps callable leaves visible as an
 * explicit sentinel, materializes statically required paths, and converts that sentinel back to an
 * inert function only when the value enters project code.
 */

/** Text stored in editable JSON wherever the preview runtime inferred a no-op callback. */
export const PREVIEW_INSPECTOR_NOOP_VALUE_SENTINEL = '[Preview no-op function]';

/** Creates browser helpers for editable fallback templates and safe runtime materialization. */
export function createPreviewInspectorBlockerValueRuntimeSource(): string {
  return String.raw`
const PREVIEW_INSPECTOR_NOOP_VALUE_SENTINEL = ${JSON.stringify(PREVIEW_INSPECTOR_NOOP_VALUE_SENTINEL)};
const PREVIEW_INSPECTOR_BLOCKER_VALUE_DEPTH_LIMIT = 12;
const PREVIEW_INSPECTOR_BLOCKER_VALUE_NODE_LIMIT = 256;

/** Copies one generated value into bounded JSON without invoking accessors or retaining prototypes. */
function copyPreviewInspectorBlockerValueForJson(value, state, depth = 0) {
  if (depth > PREVIEW_INSPECTOR_BLOCKER_VALUE_DEPTH_LIMIT || state.nodes >= PREVIEW_INSPECTOR_BLOCKER_VALUE_NODE_LIMIT) {
    return null;
  }
  state.nodes += 1;
  if (typeof value === 'function') return PREVIEW_INSPECTOR_NOOP_VALUE_SENTINEL;
  if (value === undefined || typeof value === 'symbol') return null;
  if (typeof value === 'bigint') return Number(value);
  if (value === null || typeof value !== 'object') return value;
  let descriptors;
  try { descriptors = Object.getOwnPropertyDescriptors(value); } catch { return null; }
  const result = Array.isArray(value) ? [] : {};
  for (const [propertyName, descriptor] of Object.entries(descriptors)) {
    if (
      propertyName === 'length' ||
      blockedInspectorPropNames.has(propertyName) ||
      !Object.hasOwn(descriptor, 'value')
    ) {
      continue;
    }
    result[propertyName] = copyPreviewInspectorBlockerValueForJson(
      descriptor.value,
      state,
      depth + 1,
    );
  }
  return result;
}

/** Infers a recognizable JSON leaf from the final required property name. */
function createPreviewInspectorRequiredPathLeaf(propertyName, callable) {
  if (callable) return PREVIEW_INSPECTOR_NOOP_VALUE_SENTINEL;
  const name = String(propertyName).toLowerCase();
  if (/^(?:is|has|can|should|will|did|does|was|were)/u.test(name) || /(?:enabled|visible|active|selected|checked|loading|valid|touched)$/u.test(name)) {
    return false;
  }
  if (/(?:count|total|index|length|size|page|amount|rate|number)$/u.test(name)) return 0;
  if (/(?:items|rows|list|options|results|nodes|edges|records)$/u.test(name)) return [];
  return 'Preview value';
}

/** Adds one compiler-proven path when serialization alone could not expose its missing property. */
function materializePreviewInspectorRequiredPath(template, rawPath) {
  if (typeof rawPath !== 'string' || rawPath === '<root>') return template;
  const callable = rawPath.endsWith('()');
  const path = (callable ? rawPath.slice(0, -2) : rawPath)
    .split('.')
    .filter((part) => part.length > 0 && part !== '<root>')
    .slice(0, PREVIEW_INSPECTOR_BLOCKER_VALUE_DEPTH_LIMIT);
  if (path.length === 0) return template;
  let root = template;
  if (root === null || typeof root !== 'object') root = /^\d+$/u.test(path[0]) ? [] : {};
  let current = root;
  for (const [index, propertyName] of path.entries()) {
    if (blockedInspectorPropNames.has(propertyName)) return root;
    const atLeaf = index === path.length - 1;
    if (atLeaf) {
      if (current[propertyName] === undefined || current[propertyName] === null) {
        current[propertyName] = createPreviewInspectorRequiredPathLeaf(propertyName, callable);
      }
      break;
    }
    const nextName = path[index + 1] ?? '';
    if (current[propertyName] === null || typeof current[propertyName] !== 'object') {
      current[propertyName] = /^\d+$/u.test(nextName) ? [] : {};
    }
    current = current[propertyName];
  }
  return root;
}

/** Produces the non-empty, editable JSON template displayed for one isolated hook edge. */
function createPreviewInspectorRuntimeFallbackDraftTemplate(value, requiredPaths) {
  let template = copyPreviewInspectorBlockerValueForJson(value, { nodes: 0 });
  for (const path of normalizePreviewInspectorRequiredPropertyPaths(requiredPaths)) {
    template = materializePreviewInspectorRequiredPath(template, path);
  }
  return template;
}

/** Restores no-op callbacks only at the boundary where editable JSON enters project hook code. */
function materializePreviewInspectorRuntimeFallbackOverride(value, depth = 0) {
  if (value === PREVIEW_INSPECTOR_NOOP_VALUE_SENTINEL) return Object.freeze(() => undefined);
  if (depth > PREVIEW_INSPECTOR_BLOCKER_VALUE_DEPTH_LIMIT || value === null || typeof value !== 'object') {
    return value;
  }
  if (Array.isArray(value)) {
    return value.map((child) => materializePreviewInspectorRuntimeFallbackOverride(child, depth + 1));
  }
  const result = {};
  for (const [propertyName, child] of Object.entries(value)) {
    if (blockedInspectorPropNames.has(propertyName)) continue;
    result[propertyName] = materializePreviewInspectorRuntimeFallbackOverride(child, depth + 1);
  }
  return result;
}
`;
}
