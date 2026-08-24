/**
 * Generates the browser-side materializer for bounded, statically inferred component props.
 * Build-time analysis emits data-only shape nodes; this runtime turns them into neutral values and
 * overlays real usage, setup, and Inspector values without evaluating project factories or types.
 */
import { createPreviewGeneratedListRuntimeSource } from './previewGeneratedListRuntimeSource';

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
  const generatedListRuntimeSource = createPreviewGeneratedListRuntimeSource();
  return String.raw`
${generatedListRuntimeSource}

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
const PREVIEW_AUTOMATIC_EXACT_CHILD_REGISTRY = new WeakMap();
const PREVIEW_AUTOMATIC_RENDERED_COLLECTION_DECISIONS = new WeakSet();
const blockedPreviewAutomaticPropNames = new Set(['__proto__', 'constructor', 'prototype']);

/** Remembers direct primitive children whose authored syntax proved one exact accepted value. */
function registerPreviewAutomaticExactChildren(value, names) {
  if (!isPreviewAutomaticPropRecord(value) || names.length === 0) return;
  try { PREVIEW_AUTOMATIC_EXACT_CHILD_REGISTRY.set(value, new Set(names)); } catch {}
}

/** Checks exact-value metadata without exposing compiler bookkeeping on project-visible objects. */
function isPreviewAutomaticExactChild(value, name) {
  try { return PREVIEW_AUTOMATIC_EXACT_CHILD_REGISTRY.get(value)?.has(name) === true; }
  catch { return false; }
}

/** Reattaches exact-child metadata after generated-list cloning creates new frozen identities. */
function registerPreviewAutomaticExactShape(value, node, budget = { nodes: 0 }, depth = 0) {
  if (
    node === null || typeof node !== 'object' ||
    depth > PREVIEW_AUTOMATIC_PROP_MAX_DEPTH || budget.nodes >= PREVIEW_AUTOMATIC_PROP_MAX_NODES
  ) return;
  budget.nodes += 1;
  if (node.kind === 'array' && Array.isArray(value) && node.items !== undefined) {
    for (const item of value) {
      registerPreviewAutomaticExactShape(item, node.items, budget, depth + 1);
    }
    return;
  }
  if (node.kind !== 'object' || !isPreviewAutomaticPropRecord(value)) return;
  const properties = isPreviewAutomaticPropRecord(node.properties) ? node.properties : {};
  const exactChildren = [];
  for (const [name, childNode] of readPreviewAutomaticPropEntries(properties)) {
    if (blockedPreviewAutomaticPropNames.has(name)) continue;
    if (childNode?.exactValue === true) exactChildren.push(name);
    registerPreviewAutomaticExactShape(value[name], childNode, budget, depth + 1);
  }
  registerPreviewAutomaticExactChildren(value, exactChildren);
}

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

/** Produces one concise display label from a statically named primitive collection. */
function createPreviewAutomaticCollectionItemLabel(fieldName) {
  let value = typeof fieldName === 'string' ? fieldName.trim() : '';
  if (value.length === 0) return '';
  if (/ies$/iu.test(value)) value = value.slice(0, -3) + 'y';
  else if (/(?:ches|shes|xes|zes|ses)$/iu.test(value)) value = value.slice(0, -2);
  else if (/s$/iu.test(value) && !/(?:ss|us)$/iu.test(value)) value = value.slice(0, -1);
  return value.length <= 32 ? value : value.slice(0, 31) + '…';
}

/** Gives non-enum primitive string rows stable, visible, and unique list identities. */
function materializePreviewAutomaticStringListItem(node, value, fieldName, itemIndex) {
  if (
    node?.kind !== 'string' || node.exactValue === true ||
    typeof value !== 'string' || typeof itemIndex !== 'number'
  ) return value;
  const base = value.length > 0 ? value : createPreviewAutomaticCollectionItemLabel(fieldName);
  if (base.length === 0 || itemIndex === 0) return base;
  return base + ' ' + String(itemIndex + 1);
}

/** Reads only finite compiler-authored candidates matching the scalar node's declared kind. */
function readPreviewAutomaticScalarCandidates(node) {
  const expectedType = node?.kind === 'boolean'
    ? 'boolean'
    : node?.kind === 'number' ? 'number' : node?.kind === 'string' ? 'string' : '';
  if (expectedType.length === 0 || !Array.isArray(node?.candidateValues)) return [];
  return [...new Set(node.candidateValues.filter((candidate) =>
    typeof candidate === expectedType &&
    (expectedType !== 'number' || Number.isFinite(candidate)),
  ))].slice(0, 8);
}

/** Finds the largest finite branch domain within one rendered row contract. */
function readPreviewAutomaticRenderedCollectionVariantCount(node, depth = 0) {
  if (node === null || typeof node !== 'object' || depth > 8) return 0;
  let count = readPreviewAutomaticScalarCandidates(node).length;
  if (node.kind === 'array' && node.items !== undefined) {
    count = Math.max(
      count,
      readPreviewAutomaticRenderedCollectionVariantCount(node.items, depth + 1),
    );
  }
  if (node.kind === 'object') {
    for (const child of Object.values(node.properties ?? {})) {
      count = Math.max(
        count,
        readPreviewAutomaticRenderedCollectionVariantCount(child, depth + 1),
      );
    }
  }
  return count;
}

/** Lists bounded candidate-bearing row paths for transparent blocker telemetry. */
function readPreviewAutomaticRenderedCollectionCandidatePaths(node, prefix = '', paths = [], depth = 0) {
  if (
    node === null || typeof node !== 'object' || depth > 8 || paths.length >= 24
  ) return paths;
  if (readPreviewAutomaticScalarCandidates(node).length > 0 && prefix.length > 0) {
    paths.push(prefix);
  }
  if (node.kind === 'array' && node.items !== undefined) {
    readPreviewAutomaticRenderedCollectionCandidatePaths(
      node.items,
      prefix.length === 0 ? '[]' : prefix + '.[]',
      paths,
      depth + 1,
    );
  }
  if (node.kind === 'object') {
    for (const [name, child] of readPreviewAutomaticPropEntries(node.properties ?? {})) {
      if (blockedPreviewAutomaticPropNames.has(name)) continue;
      readPreviewAutomaticRenderedCollectionCandidatePaths(
        child,
        prefix.length === 0 ? name : prefix + '.' + name,
        paths,
        depth + 1,
      );
    }
  }
  return paths;
}

/** Lets the isolated data head choose only between compiler-admitted row coverage strategies. */
function createPreviewAutomaticRenderedCollectionPlan(node, fieldName) {
  const configuredRowCount = typeof readPreviewGeneratedListSampleCount === 'function'
    ? readPreviewGeneratedListSampleCount()
    : 3;
  const variantCount = readPreviewAutomaticRenderedCollectionVariantCount(node?.items);
  const coverageRowCount = Math.max(configuredRowCount, Math.min(10, variantCount));
  const candidates = [
    {
      deterministicRank: 0,
      id: 'branch-coverage',
      numbers: { rowCount: coverageRowCount },
      texts: ['Cover compiler-proven rendered row branches'],
      tokens: ['row-strategy:branch-coverage'],
    },
    ...(coverageRowCount === 1 ? [] : [{
      deterministicRank: 1,
      id: 'minimum-row',
      numbers: { rowCount: 1 },
      texts: ['Use one minimum rendered row'],
      tokens: ['row-strategy:minimum-row'],
    }]),
  ];
  const selection = typeof selectPreviewInspectorNeuralResidualCandidate === 'function'
    ? selectPreviewInspectorNeuralResidualCandidate(
        {
          blockerKind: 'automatic-props',
          holeKind: 'rendered-collection-prop-data',
          numbers: { configuredRowCount, variantCount },
          texts: [fieldName],
          tokens: ['compiler-rendered-collection', 'component-prop-data'],
        },
        candidates,
      )
    : undefined;
  const candidateId = selection?.candidateId === 'minimum-row'
    ? 'minimum-row'
    : 'branch-coverage';
  const rowCount = candidateId === 'minimum-row' ? 1 : coverageRowCount;
  if (
    !PREVIEW_AUTOMATIC_RENDERED_COLLECTION_DECISIONS.has(node) &&
    typeof recordPreviewInspectorBlockerAutoDecision === 'function'
  ) {
    PREVIEW_AUTOMATIC_RENDERED_COLLECTION_DECISIONS.add(node);
    const exportName = typeof previewInspectorSession === 'object'
      ? previewInspectorSession.selectedExportName
      : undefined;
    recordPreviewInspectorBlockerAutoDecision({
      action: 'Fill compiler-rendered component rows',
      blockerId: 'automatic-rendered-collection:' + String(exportName ?? 'target') + ':' + fieldName,
      blockerKind: 'automatic-props',
      blockerName: 'Rendered component data · ' + fieldName,
      generatedPaths: readPreviewAutomaticRenderedCollectionCandidatePaths(node?.items),
      mode: 'neural-rendered-collection-auto',
      neuralResidualDecision: selection?.decision,
      ownerName: exportName,
      reason: 'JSX collection and row callback contracts selected ' + String(rowCount) + ' row(s)',
      selectedValue: { candidateId, rowCount, variantCount },
      startsRenderAttempt: true,
      summary: { candidateId, rowCount, variantCount },
    });
  }
  return { candidateId, rowCount, variantCount };
}

/** Produces visible but inert text only inside a compiler-proven rendered collection row. */
function createPreviewAutomaticRenderedCollectionString(fieldName, itemIndex) {
  const name = String(fieldName).replaceAll('_', '').toLowerCase();
  if (/(?:at|on|date|datetime|time)$/u.test(name)) {
    return new Date(Date.UTC(2026, 0, 15 + Math.min(10, itemIndex), 9)).toISOString();
  }
  if (name.endsWith('id') || name === 'uuid') return 'preview-id';
  if (name.includes('email')) return 'preview@example.invalid';
  if (name.endsWith('url') || name.endsWith('uri')) return 'https://example.invalid/';
  if (name.endsWith('status')) return 'PREVIEW';
  const value = String(fieldName || 'Preview');
  return value.length <= 32 ? value : value.slice(0, 31) + '…';
}

/** Materializes one validated shape node under fixed depth and aggregate node budgets. */
function materializePreviewAutomaticPropNode(
  node,
  budget,
  depth,
  fieldName = '',
  itemIndex = 0,
  renderedCollectionItem = false,
) {
  if (
    node === null || typeof node !== 'object' || Array.isArray(node) ||
    depth > PREVIEW_AUTOMATIC_PROP_MAX_DEPTH || budget.nodes >= PREVIEW_AUTOMATIC_PROP_MAX_NODES
  ) return undefined;
  budget.nodes += 1;
  switch (node.kind) {
    case 'array': {
      // A sample list is admitted only when static type evidence supplied an element contract.
      // Unknown arrays stay empty so automatic props cannot invent application collection semantics.
      if (node.items === undefined) return [];
      const renderedCollection = node.renderedCollection === true;
      const plan = renderedCollection
        ? createPreviewAutomaticRenderedCollectionPlan(node, fieldName || 'rows')
        : undefined;
      const items = createPreviewGeneratedList((itemIndex) =>
        materializePreviewAutomaticStringListItem(
          node.items,
          materializePreviewAutomaticPropNode(
            node.items,
            budget,
            depth + 1,
            fieldName,
            itemIndex,
            renderedCollectionItem || renderedCollection,
          ),
          fieldName,
          itemIndex,
        ),
        plan?.rowCount,
      );
      return items.filter((item) => item !== undefined);
    }
    case 'boolean': {
      const candidates = readPreviewAutomaticScalarCandidates(node);
      return candidates[itemIndex % candidates.length] ??
        (typeof node.value === 'boolean' ? node.value : false);
    }
    case 'component': {
      const component = function PreviewAutomaticComponent() { return null; };
      Object.defineProperty(component, PREVIEW_AUTOMATIC_COMPONENT_MARKER, { value: true });
      return Object.freeze(component);
    }
    case 'element': return React.createElement('div', { 'data-react-preview-generated-child': '' });
    case 'function': return function previewAutomaticNoop() { return undefined; };
    case 'graphql-document': return createPreviewAutomaticGraphqlDocument(node, budget, depth + 1);
    case 'null': return null;
    case 'number': {
      const candidates = readPreviewAutomaticScalarCandidates(node);
      return candidates[itemIndex % candidates.length] ??
        (typeof node.value === 'number' && Number.isFinite(node.value)
          ? node.value
          : renderedCollectionItem ? itemIndex + 1 : 0);
    }
    case 'string': {
      const candidates = readPreviewAutomaticScalarCandidates(node);
      return candidates[itemIndex % candidates.length] ??
        (typeof node.value === 'string'
          ? node.value
          : renderedCollectionItem
            ? createPreviewAutomaticRenderedCollectionString(fieldName, itemIndex)
            : '');
    }
    case 'object': {
      const result = {};
      const properties = isPreviewAutomaticPropRecord(node.properties) ? node.properties : {};
      for (const [name, childNode] of readPreviewAutomaticPropEntries(properties)) {
        if (blockedPreviewAutomaticPropNames.has(name)) continue;
        const child = materializePreviewAutomaticPropNode(
          childNode,
          budget,
          depth + 1,
          name,
          itemIndex,
          renderedCollectionItem,
        );
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
  registerPreviewAutomaticExactShape(value, shape);
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
  if (inferredValue === undefined) return authoredValue;
  const authoredIsGenerated = isPreviewAutomaticGeneratedValue(authoredValue);
  const repairGeneratedPlaceholder = repairNeutralPlaceholder === true || authoredIsGenerated;
  if (
    repairNullishPlaceholder === true &&
    authoredValue === null &&
    inferredValue !== undefined &&
    inferredValue !== null
  ) return inferredValue;
  const inferredType = typeof inferredValue;
  if (
    repairGeneratedPlaceholder &&
    authoredIsGenerated &&
    doPreviewAutomaticValueKindsConflict(inferredValue, authoredValue)
  ) return inferredValue;
  if (
    repairGeneratedPlaceholder &&
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
    Array.isArray(inferredValue) &&
    Array.isArray(authoredValue) &&
    authoredIsGenerated
  ) {
    if (authoredValue.length === 0) return inferredValue;
    if (
      inferredValue.length === 0 ||
      depth > PREVIEW_AUTOMATIC_PROP_MAX_DEPTH ||
      budget.nodes >= PREVIEW_AUTOMATIC_PROP_MAX_NODES
    ) return authoredValue;
    budget.nodes += 1;
    let changed = false;
    const merged = authoredValue.map((item, index) => {
      const inferredItem = inferredValue[index] ?? inferredValue[0];
      const completedItem = overlayPreviewAutomaticPropValue(
        inferredItem,
        item,
        budget,
        depth + 1,
        true,
        repairNullishPlaceholder,
      );
      if (completedItem !== item) changed = true;
      return completedItem;
    });
    return changed ? markPreviewAutomaticGeneratedValue(merged) : authoredValue;
  }
  if (
    !isPreviewAutomaticPropRecord(inferredValue) ||
    !isPreviewAutomaticPropRecord(authoredValue) ||
    depth > PREVIEW_AUTOMATIC_PROP_MAX_DEPTH || budget.nodes >= PREVIEW_AUTOMATIC_PROP_MAX_NODES
  ) return authoredValue;
  budget.nodes += 1;
  const result = { ...inferredValue };
  for (const [name, value] of readPreviewAutomaticPropEntries(authoredValue)) {
    if (blockedPreviewAutomaticPropNames.has(name)) continue;
    if (authoredIsGenerated && isPreviewAutomaticExactChild(inferredValue, name)) continue;
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
