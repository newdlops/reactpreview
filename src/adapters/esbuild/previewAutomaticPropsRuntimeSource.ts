/**
 * Generates the browser-side materializer for bounded, statically inferred component props.
 * Build-time analysis emits data-only shape nodes; this runtime turns them into neutral values and
 * overlays real usage, setup, and Inspector values without evaluating project factories or types.
 */

/** Global symbol key carried by generated React component props through editable Inspector JSON. */
export const PREVIEW_AUTOMATIC_COMPONENT_MARKER_KEY = 'react-file-preview.automatic-component-prop';

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
const PREVIEW_AUTOMATIC_COMPONENT_MARKER = Symbol.for(${JSON.stringify(PREVIEW_AUTOMATIC_COMPONENT_MARKER_KEY)});
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

/** Detects the empty plain record emitted by a missing parent hook, Context, or request payload. */
function isPreviewAutomaticNeutralEmptyRecord(value) {
  if (!isPreviewAutomaticPropRecord(value)) return false;
  try {
    return Reflect.ownKeys(Object.getOwnPropertyDescriptors(value)).length === 0;
  } catch {
    return false;
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
    case 'component': {
      const component = function PreviewAutomaticComponent() { return null; };
      Object.defineProperty(component, PREVIEW_AUTOMATIC_COMPONENT_MARKER, { value: true });
      return Object.freeze(component);
    }
    case 'function': return function previewAutomaticNoop() { return undefined; };
    case 'null': return null;
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

/**
 * Recursively overlays one authored layer while retaining only its missing inferred branches.
 *
 * The first automatic layer can be parent props produced by another preview fallback. When local
 * component syntax proves an Array/scalar/function contract, a neutral empty record from that layer
 * is not meaningful authored data and must not replace the type-correct inferred value. Later setup,
 * resolver, and user layers remain authoritative so explicit Inspector edits are still observable.
 */
function overlayPreviewAutomaticPropValue(
  inferredValue,
  authoredValue,
  budget,
  depth,
  repairNeutralPlaceholder,
  repairNullishPlaceholder,
) {
  if (authoredValue === undefined) return inferredValue;
  if (
    repairNullishPlaceholder === true &&
    authoredValue === null &&
    inferredValue !== undefined &&
    inferredValue !== null
  ) return inferredValue;
  const inferredType = typeof inferredValue;
  if (
    repairNeutralPlaceholder === true &&
    isPreviewAutomaticNeutralEmptyRecord(authoredValue) &&
    (
      Array.isArray(inferredValue) ||
      inferredType === 'boolean' ||
      inferredType === 'function' ||
      inferredType === 'number' ||
      inferredType === 'string'
    )
  ) return inferredValue;
  if (
    !isPreviewAutomaticPropRecord(inferredValue) ||
    !isPreviewAutomaticPropRecord(authoredValue) ||
    depth > PREVIEW_AUTOMATIC_PROP_MAX_DEPTH || budget.nodes >= PREVIEW_AUTOMATIC_PROP_MAX_NODES
  ) return authoredValue;
  budget.nodes += 1;
  const result = { ...inferredValue };
  for (const [name, value] of readPreviewAutomaticPropEntries(authoredValue)) {
    if (blockedPreviewAutomaticPropNames.has(name)) continue;
    result[name] = overlayPreviewAutomaticPropValue(
      result[name],
      value,
      budget,
      depth + 1,
      repairNeutralPlaceholder,
      repairNullishPlaceholder,
    );
  }
  return result;
}

/**
 * Materializes inferred props and overlays each lower-to-higher-priority authored prop record.
 *
 * Only the first layer can be an automatically observed parent-prop snapshot. Subsequent layers are
 * explicit setup/export/Inspector values and therefore keep normal JavaScript overwrite semantics.
 */
function createPreviewPropsFromLayersWithPolicy(shape, repairFirstNullishPlaceholder, layers) {
  let result = materializePreviewAutomaticProps(shape);
  for (const [layerIndex, layer] of layers.entries()) {
    if (isPreviewAutomaticPropRecord(layer)) {
      result = overlayPreviewAutomaticPropValue(
        result,
        layer,
        { nodes: 0 },
        0,
        shape !== undefined && shape !== null && layerIndex === 0,
        repairFirstNullishPlaceholder === true && layerIndex === 0,
      );
    }
  }
  return result;
}

/** Preserves authored null sentinels for ordinary roots, setup values, and user-edited props. */
function createPreviewPropsFromLayers(shape, ...layers) {
  return createPreviewPropsFromLayersWithPolicy(shape, false, layers);
}

/**
 * Repairs an automatic parent's null sentinel only for the exact selected component boundary.
 *
 * Page Inspector may force that component's local non-null prop gate so the selected file becomes
 * visible. In that narrow case retaining the parent's dormant null while forcing the branch creates
 * an impossible authored state. Local prop-shape evidence supplies the smallest coherent value;
 * later resolver and user layers remain authoritative and may explicitly restore null.
 */
function createPreviewTargetPropsFromLayers(shape, ...layers) {
  return createPreviewPropsFromLayersWithPolicy(shape, true, layers);
}
`;
}
