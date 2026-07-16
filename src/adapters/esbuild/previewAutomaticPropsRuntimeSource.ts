/**
 * Generates the browser-side materializer for bounded, statically inferred component props.
 * Build-time analysis emits data-only shape nodes; this runtime turns them into neutral values and
 * overlays real usage, setup, and Inspector values without evaluating project factories or types.
 */

/**
 * Creates helpers embedded once in every preview entry before gallery and Inspector runtimes.
 *
 * The generated implementation accepts only small prototype-safe records. Authored non-null values
 * always win, while an authored `undefined` leaves the inferred value in place. This distinction
 * makes an inferred container useful for missing data without hiding an intentional `null` test.
 *
 * @returns Plain JavaScript source that declares automatic-prop materialization and merge helpers.
 */
export function createPreviewAutomaticPropsRuntimeSource(): string {
  return String.raw`
const PREVIEW_AUTOMATIC_PROP_MAX_DEPTH = 12;
const PREVIEW_AUTOMATIC_PROP_MAX_NODES = 256;
const blockedPreviewAutomaticPropNames = new Set(['__proto__', 'constructor', 'prototype']);

/** Reports whether a value is a plain record that can be copied without invoking accessors. */
function isPreviewAutomaticPropRecord(value) {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return false;
  try {
    const prototype = Object.getPrototypeOf(value);
    return prototype === Object.prototype || prototype === null;
  } catch {
    return false;
  }
}

/** Reads enumerable own data properties without invoking project or Proxy accessor getters. */
function readPreviewAutomaticPropEntries(value) {
  try {
    return Object.entries(Object.getOwnPropertyDescriptors(value))
      .filter(([, descriptor]) => descriptor.enumerable === true && 'value' in descriptor)
      .map(([name, descriptor]) => [name, descriptor.value]);
  } catch {
    return [];
  }
}

/** Materializes one validated shape node under fixed depth and aggregate node budgets. */
function materializePreviewAutomaticPropNode(node, budget, depth) {
  if (
    node === null || typeof node !== 'object' || Array.isArray(node) ||
    depth > PREVIEW_AUTOMATIC_PROP_MAX_DEPTH || budget.nodes >= PREVIEW_AUTOMATIC_PROP_MAX_NODES
  ) return undefined;
  budget.nodes += 1;
  switch (node.kind) {
    case 'array': return [];
    case 'boolean': return typeof node.value === 'boolean' ? node.value : false;
    case 'function': return function previewAutomaticNoop() { return undefined; };
    case 'number': return typeof node.value === 'number' && Number.isFinite(node.value) ? node.value : 0;
    case 'string': return typeof node.value === 'string' ? node.value : '';
    case 'object': {
      const result = {};
      const properties = isPreviewAutomaticPropRecord(node.properties) ? node.properties : {};
      for (const [name, childNode] of readPreviewAutomaticPropEntries(properties)) {
        if (blockedPreviewAutomaticPropNames.has(name)) continue;
        const child = materializePreviewAutomaticPropNode(childNode, budget, depth + 1);
        if (child !== undefined) result[name] = child;
      }
      return result;
    }
    default: return undefined;
  }
}

/** Returns a plain root prop record or an empty record for absent/invalid generated evidence. */
function materializePreviewAutomaticProps(shape) {
  const value = materializePreviewAutomaticPropNode(shape, { nodes: 0 }, 0);
  return isPreviewAutomaticPropRecord(value) ? value : {};
}

/** Recursively overlays one authored layer while retaining only its missing inferred branches. */
function overlayPreviewAutomaticPropValue(inferredValue, authoredValue, budget, depth) {
  if (authoredValue === undefined) return inferredValue;
  if (
    !isPreviewAutomaticPropRecord(inferredValue) ||
    !isPreviewAutomaticPropRecord(authoredValue) ||
    depth > PREVIEW_AUTOMATIC_PROP_MAX_DEPTH || budget.nodes >= PREVIEW_AUTOMATIC_PROP_MAX_NODES
  ) return authoredValue;
  budget.nodes += 1;
  const result = { ...inferredValue };
  for (const [name, value] of readPreviewAutomaticPropEntries(authoredValue)) {
    if (blockedPreviewAutomaticPropNames.has(name)) continue;
    result[name] = overlayPreviewAutomaticPropValue(result[name], value, budget, depth + 1);
  }
  return result;
}

/** Materializes inferred props and overlays each lower-to-higher-priority authored prop record. */
function createPreviewPropsFromLayers(shape, ...layers) {
  let result = materializePreviewAutomaticProps(shape);
  for (const layer of layers) {
    if (isPreviewAutomaticPropRecord(layer)) {
      result = overlayPreviewAutomaticPropValue(result, layer, { nodes: 0 }, 0);
    }
  }
  return result;
}
`;
}
