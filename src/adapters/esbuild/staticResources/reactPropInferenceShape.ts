/** Merges and freezes bounded mutable prop shapes while preserving provenance. */
import { readPreviewBoundedIndexLiteral } from './reactPropIndexBounds';
import {
  ARRAY_INDEX_PATTERN,
  BLOCKED_PROPERTY_NAMES,
  isPreviewInferredCandidateValue,
  MAX_INFERRED_DEPTH,
  type InferenceState,
  type MutableShapeNode,
  type PreviewInferredExportProps,
  type PreviewInferredPropKind,
  type PreviewInferredPropProvenance,
  type PreviewInferredPropShape,
} from './reactPropInferenceModel';

/** Lengthens an Array sample to reach `index`; every generated list already holds one item. */
export function recordArrayMinItems(node: MutableShapeNode, index: number): void {
  if (index >= 1) node.minItems = Math.max(node.minItems ?? 0, index + 1);
}

/** Reads one previously materialized node without widening paths or bypassing safe-name checks. */
export function readMutablePathNode(
  state: InferenceState,
  path_: readonly string[],
): MutableShapeNode | undefined {
  let node = state.root;
  for (const name of path_) {
    const child = node.children.get(name);
    if (child === undefined) return undefined;
    node = child;
  }
  return node;
}

/** Merges independently proven callback-item branches without replacing incompatible evidence. */
export function mergeMutableShapeRequirement(
  target: MutableShapeNode,
  source: MutableShapeNode,
): void {
  mergeNodeKind(target, source.kind, source.source, source.value, source.exactValue);
  if (target.kind !== source.kind) return;
  for (const candidateValue of source.candidateValues ?? []) {
    const candidateValues = (target.candidateValues ??= []);
    if (
      candidateValues.length < 8 &&
      !candidateValues.some(
        (candidate) =>
          typeof candidate === typeof candidateValue && Object.is(candidate, candidateValue),
      )
    ) {
      candidateValues.push(candidateValue);
    }
  }
  if (source.itemConsumed === true) target.itemConsumed = true;
  if (source.minItems !== undefined) {
    target.minItems = Math.max(target.minItems ?? 0, source.minItems);
  }
  if (source.renderedCollection === true) target.renderedCollection = true;
  if (source.renderedValue === true) target.renderedValue = true;
  if (source.source === 'type') target.source = 'type';
  if (source.value !== undefined && target.exactValueSource !== 'usage') {
    target.value = source.value;
  }
  if (
    source.exactValue === true &&
    (target.exactValueSource !== 'usage' || source.source === 'usage')
  ) {
    target.exactValue = true;
    target.exactValueSource = source.source;
  }
  for (const [name, child] of source.children) {
    const existing = target.children.get(name);
    if (existing === undefined) target.children.set(name, child);
    else mergeMutableShapeRequirement(existing, child);
  }
  if (source.items !== undefined) {
    if (target.items === undefined) target.items = source.items;
    else mergeMutableShapeRequirement(target.items, source.items);
  }
}

/** Merges an already-inferred mutable requirement beneath one prop-rooted alias path. */
export function mergeMutableShapeAtPath(
  root: MutableShapeNode,
  path_: readonly string[],
  requirement: MutableShapeNode,
  state: InferenceState,
): void {
  let current = root;
  for (const propertyName of path_) {
    if (BLOCKED_PROPERTY_NAMES.has(propertyName)) return;
    let child = current.children.get(propertyName);
    if (child === undefined) {
      if (state.nodeCount >= state.nodeLimit) return;
      state.nodeCount += 1;
      child = createMutableNode('object', 'usage');
      current.children.set(propertyName, child);
    }
    current = child;
  }
  mergeMutableShapeRequirement(current, requirement);
}

/** Reads only a literal already proven exact by type or direct control-flow evidence. */
export function readPreviewInferredExactValue(
  state: InferenceState,
  path_: readonly string[],
): boolean | number | string | null | undefined {
  let current = state.root;
  for (const propertyName of path_) {
    const child = current.children.get(propertyName);
    if (child === undefined) return undefined;
    current = child;
  }
  return current.exactValue === true ? current.value : undefined;
}

/** Merges one frozen child-prop shape under the callback item's relative source path. */
export function mergeFrozenShapeAtPath(
  root: MutableShapeNode,
  path_: readonly string[],
  shape: PreviewInferredPropShape,
  state: InferenceState,
): void {
  const incoming = thawPreviewInferredShape(shape, state);
  if (incoming === undefined) return;
  if (path_.length === 0) {
    mergeMutableShapeRequirement(root, incoming);
    return;
  }
  let current = root;
  for (const propertyName of path_) {
    if (BLOCKED_PROPERTY_NAMES.has(propertyName)) return;
    if (current.kind === 'array' && /^(?:0|[1-9]\d*)$/u.test(propertyName)) {
      if (current.items === undefined) {
        if (state.nodeCount >= state.nodeLimit) return;
        state.nodeCount += 1;
        current.items = createMutableNode('object', 'usage');
      }
      current = current.items;
      continue;
    }
    if (current.kind !== 'object') return;
    let child = current.children.get(propertyName);
    if (child === undefined) {
      if (state.nodeCount >= state.nodeLimit) return;
      state.nodeCount += 1;
      child = createMutableNode('object', 'usage');
      current.children.set(propertyName, child);
    }
    current = child;
  }
  mergeMutableShapeRequirement(current, incoming);
}

/** Converts a bounded immutable inference shape back into the local merge representation. */
export function thawPreviewInferredShape(
  shape: PreviewInferredPropShape,
  state: InferenceState,
): MutableShapeNode | undefined {
  if (state.nodeCount >= state.nodeLimit) return undefined;
  state.nodeCount += 1;
  const node = createMutableNode(shape.kind, 'usage');
  if (Array.isArray(shape.candidateValues)) {
    const values: readonly unknown[] = shape.candidateValues;
    node.candidateValues = values.filter(isPreviewInferredCandidateValue).slice(0, 8);
  }
  if (shape.value !== undefined) node.value = shape.value;
  if (shape.minItems !== undefined) node.minItems = shape.minItems;
  if (shape.renderedCollection === true) node.renderedCollection = true;
  if (shape.renderedText === true) node.renderedValue = true;
  if (shape.exactValue === true) {
    node.exactValue = true;
    node.exactValueSource = 'usage';
  }
  if (shape.items !== undefined) {
    const items = thawPreviewInferredShape(shape.items, state);
    if (items !== undefined) node.items = items;
  }
  for (const [propertyName, childShape] of Object.entries(shape.properties ?? {})) {
    if (BLOCKED_PROPERTY_NAMES.has(propertyName)) continue;
    const child = thawPreviewInferredShape(childShape, state);
    if (child !== undefined) node.children.set(propertyName, child);
  }
  return node;
}

/** Reports whether type or prior operation evidence already owns the final prop-path value kind. */
export function hasPreviewInferredPropTerminal(
  state: InferenceState,
  path_: readonly string[],
): boolean {
  let current = state.root;
  for (const propertyName of path_) {
    const child = current.children.get(propertyName);
    if (child === undefined) return false;
    current = child;
  }
  return current.kind !== 'object' || current.children.size > 0;
}

/** Reports whether prior type or usage evidence already selected an exact scalar value. */
export function hasPreviewInferredPropExplicitValue(
  state: InferenceState,
  path_: readonly string[],
): boolean {
  let current = state.root;
  for (const propertyName of path_) {
    const child = current.children.get(propertyName);
    if (child === undefined) return false;
    current = child;
  }
  return current.value !== undefined;
}

/** Reports an authored operation literal already selected for this detached collection item. */
export function hasPreviewInferredPropUsageExactValue(
  state: InferenceState,
  path_: readonly string[],
): boolean {
  let current = state.root;
  for (const propertyName of path_) {
    const child = current.children.get(propertyName);
    if (child === undefined) return false;
    current = child;
  }
  return current.exactValue === true && current.exactValueSource === 'usage';
}

/** Merges one materialized path under depth/node budgets and safe-property constraints. */
export function requirePath(
  state: InferenceState,
  path_: readonly string[],
  kind: PreviewInferredPropKind,
  source: PreviewInferredPropProvenance['source'],
  value?: boolean | number | string | null,
  exactValue?: true,
): void {
  if (path_.length === 0 || path_.length > MAX_INFERRED_DEPTH) return;
  let current = state.root;
  for (const [index, propertyName] of path_.entries()) {
    if (BLOCKED_PROPERTY_NAMES.has(propertyName)) return;
    let child = current.children.get(propertyName);
    if (child === undefined) {
      if (state.nodeCount >= state.nodeLimit) return;
      child = createMutableNode(index === path_.length - 1 ? kind : 'object', source);
      current.children.set(propertyName, child);
      state.nodeCount += 1;
    }
    if (index === path_.length - 1) {
      mergeNodeKind(child, kind, source, value, exactValue);
    } else if (child.kind !== 'object') {
      return;
    }
    current = child;
  }
}

/** Refines an empty object receiver to an operation-proven kind and otherwise fails conservatively. */
export function mergeNodeKind(
  node: MutableShapeNode,
  kind: PreviewInferredPropKind,
  source: PreviewInferredPropProvenance['source'],
  value?: boolean | number | string | null,
  exactValue?: true,
): void {
  if (node.kind === kind) {
    if (source === 'type') node.source = 'type';
    if (exactValue === true) {
      if (node.exactValueSource !== 'usage' || source === 'usage') {
        if (value !== undefined) node.value = value;
        node.exactValue = true;
        node.exactValueSource = source;
      }
    } else if (value !== undefined && node.exactValue !== true) {
      node.value = value;
    }
    return;
  }
  if (node.kind === 'object' && node.children.size === 0) {
    node.kind = kind;
    node.source = source;
    if (value === undefined) delete node.value;
    else node.value = value;
    if (exactValue === true) {
      node.exactValue = true;
      node.exactValueSource = source;
    }
    return;
  }
  if (kind === 'array' && node.kind === 'object' && hasOnlyArrayMemberChildren(node)) {
    convertArrayMemberObjectToArray(node, source);
  }
}

/**
 * Recognizes an object receiver whose only reads are `length` or index members (`past.length`,
 * `past[0]`), which an Array also answers. The typed-props layer treats the same `{ length }`
 * receiver as an evidence-free placeholder (`isPreviewEvidenceFreeShape`).
 */
export function hasOnlyArrayMemberChildren(node: MutableShapeNode): boolean {
  return (
    node.collection === undefined &&
    node.value === undefined &&
    node.exactValue !== true &&
    [...node.children.keys()].every((name) => name === 'length' || ARRAY_INDEX_PATTERN.test(name))
  );
}

/**
 * Turns an index-and-length-only object into the Array that later evidence proves. Without this,
 * SimSheet's `r.past[r.past.length - 1]` left `past` a `{ length }` object, the declared
 * `number[]` from the child-type demand was skipped as a kind conflict, and the empty sample
 * list rendered `fmtInt(undefined)` as NaN. Index reads become the element contract.
 */
export function convertArrayMemberObjectToArray(
  node: MutableShapeNode,
  source: PreviewInferredPropProvenance['source'],
): void {
  const indexReads = [...node.children].filter(([name]) => name !== 'length');
  node.children.clear();
  node.kind = 'array';
  node.source = source;
  for (const [name, item] of indexReads) {
    if (node.items === undefined) node.items = item;
    else mergeMutableShapeRequirement(node.items, item);
    const reached = readPreviewBoundedIndexLiteral(name);
    if (reached !== undefined) recordArrayMinItems(node, reached);
  }
}

/** Freezes one deterministic JSON-safe shape and its flattened provenance inventory. */
export function freezeInference(root: MutableShapeNode): PreviewInferredExportProps {
  const provenance: PreviewInferredPropProvenance[] = [];
  const freezeNode = (
    node: MutableShapeNode,
    path_: readonly string[],
  ): PreviewInferredPropShape => {
    const properties = Object.fromEntries(
      [...node.children.entries()]
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([name, child]) => [name, freezeNode(child, [...path_, name])]),
    );
    if (path_.length > 0) {
      provenance.push({ kind: node.kind, path: path_.join('.'), source: node.source });
    }
    return Object.freeze({
      kind: node.kind,
      ...(node.candidateValues === undefined || node.candidateValues.length === 0
        ? {}
        : { candidateValues: Object.freeze([...node.candidateValues]) }),
      ...(node.kind === 'array' && node.items !== undefined
        ? { items: freezeNode(node.items, [...path_, '[]']) }
        : {}),
      ...(node.kind === 'array' && node.minItems !== undefined ? { minItems: node.minItems } : {}),
      ...(node.kind === 'object' || node.kind === 'graphql-document'
        ? { properties: Object.freeze(properties) }
        : {}),
      ...(node.value === undefined ? {} : { value: node.value }),
      ...(node.exactValue === true ? { exactValue: true as const } : {}),
      ...(node.renderedCollection === true ? { renderedCollection: true as const } : {}),
      ...(node.kind === 'string' && node.renderedValue === true
        ? { renderedText: true as const }
        : {}),
      ...(node.kind === 'object' && node.collection !== undefined
        ? { collection: node.collection }
        : {}),
    });
  };
  const shape = freezeNode(root, []);
  return Object.freeze({
    provenance: Object.freeze(
      provenance.sort((left, right) => left.path.localeCompare(right.path)),
    ),
    shape,
  });
}

/** Creates one mutable node with a child map unavailable to project-controlled prototypes. */
export function createMutableNode(
  kind: PreviewInferredPropKind,
  source: PreviewInferredPropProvenance['source'],
): MutableShapeNode {
  return { children: new Map(), kind, source };
}
