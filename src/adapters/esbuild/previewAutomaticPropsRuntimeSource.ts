/**
 * Generates the browser-side materializer for bounded, statically inferred component props.
 * Build-time analysis emits data-only shape nodes; this runtime turns them into neutral values and
 * overlays real usage, setup, and Inspector values without evaluating project factories or types.
 */

/** Global symbol key carried by generated React component props through editable Inspector JSON. */
export const PREVIEW_AUTOMATIC_COMPONENT_MARKER_KEY = 'react-file-preview.automatic-component-prop';

/** Global WeakSet identity shared by generated hook data and exact-target prop repair. */
export const PREVIEW_AUTOMATIC_GENERATED_VALUE_REGISTRY_KEY =
  'react-file-preview.automatic-generated-value-registry';

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
const PREVIEW_AUTOMATIC_GENERATED_VALUE_REGISTRY = (() => {
  const key = Symbol.for(${JSON.stringify(PREVIEW_AUTOMATIC_GENERATED_VALUE_REGISTRY_KEY)});
  try {
    const existing = globalThis[key];
    if (existing !== null && typeof existing === 'object' &&
      typeof existing.add === 'function' && typeof existing.has === 'function') return existing;
    const registry = new WeakSet();
    globalThis[key] = registry;
    return registry;
  } catch {
    return undefined;
  }
})();
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

/** Recognizes only identities registered by the Inspector's generated-value boundary. */
function isPreviewAutomaticGeneratedValue(value) {
  if ((typeof value !== 'object' && typeof value !== 'function') || value === null) return false;
  try {
    return PREVIEW_AUTOMATIC_GENERATED_VALUE_REGISTRY?.has(value) === true;
  } catch {
    return false;
  }
}

/** Registers every compiler-materialized container identity without mutating frozen values. */
function markPreviewAutomaticGeneratedValue(value, budget = { nodes: 0 }, depth = 0) {
  if (
    (typeof value !== 'object' && typeof value !== 'function') || value === null ||
    depth > PREVIEW_AUTOMATIC_PROP_MAX_DEPTH || budget.nodes >= PREVIEW_AUTOMATIC_PROP_MAX_NODES
  ) return value;
  budget.nodes += 1;
  try { PREVIEW_AUTOMATIC_GENERATED_VALUE_REGISTRY?.add(value); } catch {}
  if (!Array.isArray(value) && !isPreviewAutomaticPropRecord(value)) return value;
  for (const [, child] of readPreviewAutomaticPropEntries(value)) {
    markPreviewAutomaticGeneratedValue(child, budget, depth + 1);
  }
  return value;
}

/** Reports a container/scalar contradiction without reading project-owned child properties. */
function doPreviewAutomaticValueKindsConflict(inferredValue, authoredValue) {
  if (Array.isArray(inferredValue)) return !Array.isArray(authoredValue);
  if (isPreviewAutomaticPropRecord(inferredValue)) {
    return !isPreviewAutomaticPropRecord(authoredValue);
  }
  if (inferredValue === null) return authoredValue !== null;
  return typeof inferredValue !== typeof authoredValue;
}

/** Materializes one validated shape node under fixed depth and aggregate node budgets. */
function materializePreviewAutomaticPropNode(node, budget, depth) {
  if (
    node === null || typeof node !== 'object' || Array.isArray(node) ||
    depth > PREVIEW_AUTOMATIC_PROP_MAX_DEPTH || budget.nodes >= PREVIEW_AUTOMATIC_PROP_MAX_NODES
  ) return undefined;
  budget.nodes += 1;
  switch (node.kind) {
    case 'array': {
      // A one-item list is admitted only when static type evidence supplied an element contract.
      // Unknown arrays stay empty so automatic props cannot invent application collection semantics.
      if (node.items === undefined) return [];
      const item = materializePreviewAutomaticPropNode(node.items, budget, depth + 1);
      return item === undefined ? [] : [item];
    }
    case 'boolean': return typeof node.value === 'boolean' ? node.value : false;
    case 'component': {
      const component = function PreviewAutomaticComponent() { return null; };
      Object.defineProperty(component, PREVIEW_AUTOMATIC_COMPONENT_MARKER, { value: true });
      return Object.freeze(component);
    }
    case 'function': return function previewAutomaticNoop() { return undefined; };
    case 'graphql-document': return createPreviewAutomaticGraphqlDocument(node, budget, depth + 1);
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

/** Builds an inert DocumentNode AST from compiler-owned selection evidence without parsing source. */
function createPreviewAutomaticGraphqlDocument(node, budget, depth) {
  const operation = node.value === 'mutation' ? 'mutation' : node.value === 'query' ? 'query' : undefined;
  if (operation === undefined) return undefined;
  const properties = isPreviewAutomaticPropRecord(node.properties) ? node.properties : {};
  const selectionSet = createPreviewAutomaticGraphqlSelectionSet(properties, budget, depth);
  if (selectionSet === undefined) return undefined;
  return Object.freeze({
    definitions: Object.freeze([Object.freeze({
      directives: Object.freeze([]),
      kind: 'OperationDefinition',
      operation,
      selectionSet,
      variableDefinitions: Object.freeze([]),
    })]),
    kind: 'Document',
  });
}

/** Serializes bounded inferred object/array paths into valid field selections with __typename leaves. */
function createPreviewAutomaticGraphqlSelectionSet(properties, budget, depth) {
  if (depth > PREVIEW_AUTOMATIC_PROP_MAX_DEPTH || budget.nodes >= PREVIEW_AUTOMATIC_PROP_MAX_NODES) return undefined;
  const selections = [];
  for (const [name, child] of readPreviewAutomaticPropEntries(properties)) {
    if (blockedPreviewAutomaticPropNames.has(name) || typeof name !== 'string') continue;
    const childProperties = child?.kind === 'array' ? child.items?.properties : child?.properties;
    const nested = isPreviewAutomaticPropRecord(childProperties)
      ? createPreviewAutomaticGraphqlSelectionSet(childProperties, budget, depth + 1)
      : undefined;
    selections.push(Object.freeze({
      ...(nested === undefined ? {} : { selectionSet: nested }),
      kind: 'Field',
      name: Object.freeze({ kind: 'Name', value: name }),
    }));
  }
  if (!selections.some((selection) => selection.name?.value === '__typename')) {
    selections.push(Object.freeze({ kind: 'Field', name: Object.freeze({ kind: 'Name', value: '__typename' }) }));
  }
  return Object.freeze({ kind: 'SelectionSet', selections: Object.freeze(selections) });
}

/** Returns a plain root prop record or an empty record for absent/invalid generated evidence. */
function materializePreviewAutomaticProps(shape) {
  const value = materializePreviewAutomaticPropNode(shape, { nodes: 0 }, 0);
  markPreviewAutomaticGeneratedValue(value);
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
    isPreviewAutomaticGeneratedValue(authoredValue) &&
    doPreviewAutomaticValueKindsConflict(inferredValue, authoredValue)
  ) return inferredValue;
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
