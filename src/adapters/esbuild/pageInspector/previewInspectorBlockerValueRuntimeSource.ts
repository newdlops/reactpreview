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

/** Creates a deterministic preview record for a collection whose item fields remain unknown. */
function createPreviewInspectorRequiredPathCollectionItem() {
  return { id: 'preview-1', name: 'Preview item 1' };
}

/** Infers a type-compatible, visibly synthetic leaf from property-name and call evidence. */
function createPreviewInspectorRequiredPathLeaf(propertyName, callable) {
  if (callable) return PREVIEW_INSPECTOR_NOOP_VALUE_SENTINEL;
  const name = String(propertyName).replaceAll('_', '').toLowerCase();
  if (/^\d+$/u.test(name)) return createPreviewInspectorRequiredPathCollectionItem();
  if (/^(?:set|on|handle|toggle|submit|refetch|refresh|mutate|dispatch|navigate|reset|update|remove|add)/u.test(name) || /(?:handler|callback)$/u.test(name)) {
    return PREVIEW_INSPECTOR_NOOP_VALUE_SENTINEL;
  }
  if (/(?:disabled|hidden|loading|pending|suspended|denied|forbidden|locked|error|invalid|touched|dirty)$/u.test(name)) {
    return false;
  }
  if (/^(?:is|has|can|should|will|did|does|was|were|allow|enable)/u.test(name) || /(?:enabled|visible|active|selected|checked|ready|success|valid)$/u.test(name)) {
    return !/(?:disabled|hidden|loading|pending|suspended|denied|forbidden|locked|error|invalid)$/u.test(name);
  }
  if (/(?:count|total|index|length|size|page|amount|rate|number|price|cost|limit|offset)$/u.test(name)) return 1;
  if (/(?:items|rows|list|options|results|nodes|edges|records|entries|users|companies)$/u.test(name)) {
    return [createPreviewInspectorRequiredPathCollectionItem()];
  }
  if (name === 'id' || name.endsWith('id') || name === 'uuid') return 'preview-1';
  if (name.includes('email')) return 'preview@example.invalid';
  if (/(?:date|time|timestamp|createdat|updatedat)$/u.test(name)) return '2026-01-15T09:00:00.000Z';
  if (/(?:url|uri|href|link)$/u.test(name)) return 'https://example.invalid/preview/1';
  if (/(?:status|state)$/u.test(name)) return 'ACTIVE';
  if (/(?:name|owner|author|assignee)$/u.test(name)) return 'Preview User 1';
  if (/(?:title|subject|headline)$/u.test(name)) return 'Preview title';
  if (/(?:description|message|content|summary|text|body)$/u.test(name)) return 'Preview generated content';
  if (/(?:props|context|form|data|filter|params|values|config|settings|user|company|session)$/u.test(name)) {
    return createPreviewInspectorRequiredPathCollectionItem();
  }
  return 'Preview generated value';
}

/** Converts dotted, numeric, and array-item evidence into one bounded materialization path. */
function parsePreviewInspectorRequiredPath(rawPath) {
  if (typeof rawPath !== 'string' || rawPath === '<root>') return undefined;
  const callable = rawPath.endsWith('()');
  const source = callable ? rawPath.slice(0, -2) : rawPath;
  const path = source
    .replace(/\[(\d*)\]/gu, (_match, index) => '.' + (index.length === 0 ? '0' : index))
    .split('.')
    .map((part) => part.replace(/\?$/u, ''))
    .filter((part) => part.length > 0 && part !== '<root>')
    .slice(0, PREVIEW_INSPECTOR_BLOCKER_VALUE_DEPTH_LIMIT);
  return path.length === 0 ? undefined : { callable, path };
}

/** Adds one compiler-proven path when serialization alone could not expose its missing property. */
function materializePreviewInspectorRequiredPath(template, rawPath) {
  const parsed = parsePreviewInspectorRequiredPath(rawPath);
  if (parsed === undefined) return template;
  const { callable, path } = parsed;
  let root = template;
  const indexedRoot = /^\d+$/u.test(path[0]);
  if (root === null || typeof root !== 'object') root = indexedRoot ? [] : {};
  if (Array.isArray(root) !== indexedRoot) return root;
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

/** Builds a required-path overlay while retaining compiler values already present at a demanded leaf. */
function createPreviewInspectorRuntimeFallbackRequirementTemplate(value, requiredPaths) {
  let template = copyPreviewInspectorBlockerValueForJson(value, { nodes: 0 });
  for (const path of normalizePreviewInspectorRequiredPropertyPaths(requiredPaths)) {
    template = materializePreviewInspectorRequiredPath(template, path);
  }
  return materializePreviewInspectorRuntimeFallbackOverride(template);
}

/** Adds missing required leaves to a compiler value without replacing authored non-nullish data. */
function createPreviewInspectorRuntimeFallbackAutoValue(value, requiredPaths) {
  const materializedPaths = normalizePreviewInspectorRequiredPropertyPaths(requiredPaths)
    .filter((path) => path !== '<root>');
  if (materializedPaths.length === 0) return value;
  const requirement = createPreviewInspectorRuntimeFallbackRequirementTemplate(value, materializedPaths);
  if (requirement === undefined) return value;
  const completion = completePreviewInspectorGeneratedValue(value, requirement);
  return completion.changed ? completion.value : value;
}

/** Produces the non-empty, editable JSON template displayed for one isolated hook edge. */
function createPreviewInspectorRuntimeFallbackDraftTemplate(value, requiredPaths) {
  const autoValue = createPreviewInspectorRuntimeFallbackAutoValue(value, requiredPaths);
  return copyPreviewInspectorBlockerValueForJson(autoValue, { nodes: 0 });
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
