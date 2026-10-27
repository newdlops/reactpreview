/**
 * Browser helpers that overlay declared GraphQL result shapes on selection-derived shapes.
 *
 * Instrumented modules queue `[document, shape]` pairs (see `previewTypedDocumentRegistrations`).
 * Two runtimes generate GraphQL data: the Apollo bridge describes each operation of its
 * terminating link to the Virtual Backend, and the Inspector's hook recovery fills the first
 * loading render of a wrapped `useQuery` immediately. Both embed these helpers, so the declared
 * result type decides list-ness, scalar kinds, and closed literal values wherever data is made.
 * Selections still decide which response keys exist, aliases included.
 */

import { createPreviewSampleDateApiExpression } from './previewSampleDateRuntimeSource';

/** Plain JavaScript declarations embedded into each runtime that generates GraphQL data. */
export const PREVIEW_TYPED_GRAPHQL_SHAPE_RUNTIME_SOURCE = String.raw`
// A declared date literal is the canonical sample date; it lands on the preview's current day.
const previewTypedGraphqlSampleDates = ${createPreviewSampleDateApiExpression()};
const PREVIEW_TYPED_GRAPHQL_DOCUMENTS_KEY = Symbol.for('newdlops.react-file-preview.typed-graphql-documents');
const PREVIEW_TYPED_GRAPHQL_DOCUMENT_LIMIT = 512;
const PREVIEW_TYPED_GRAPHQL_DEPTH_LIMIT = 24;
// A declared string only says "text"; name inference (numeric Decimal text, dates) wins.
const PREVIEW_TYPED_GRAPHQL_LEAF_KINDS = new Set(['boolean', 'literal', 'null', 'number']);

/** Reports a plain record that can own shape fields or generated response fields. */
function isPreviewTypedGraphqlRecord(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

/** Returns the declared result shape an instrumented module registered for one operation name. */
function readPreviewTypedGraphqlShape(operationName) {
  const registry = globalThis[PREVIEW_TYPED_GRAPHQL_DOCUMENTS_KEY];
  if (!Array.isArray(registry) || typeof operationName !== 'string' || operationName === '') {
    return undefined;
  }
  if (registry.length > PREVIEW_TYPED_GRAPHQL_DOCUMENT_LIMIT) {
    registry.splice(0, registry.length - PREVIEW_TYPED_GRAPHQL_DOCUMENT_LIMIT);
  }
  // Newest first: a hot-reloaded module re-registers its document with the current type.
  for (let index = registry.length - 1; index >= 0; index -= 1) {
    const entry = registry[index];
    const definitions = Array.isArray(entry?.[0]?.definitions) ? entry[0].definitions : [];
    if (definitions.some((definition) =>
      definition?.kind === 'OperationDefinition' && definition.name?.value === operationName)) {
      return isPreviewTypedGraphqlRecord(entry[1]) ? entry[1] : undefined;
    }
  }
  return undefined;
}

/**
 * Overlays a declared result shape on a selection-derived shape. Selection keys are kept; the
 * declared type replaces name-based list guesses, scalar kinds, and open text with literals.
 */
function mergePreviewTypedGraphqlShape(selectionShape, typedShape, depth) {
  if (!isPreviewTypedGraphqlRecord(typedShape) || depth > PREVIEW_TYPED_GRAPHQL_DEPTH_LIMIT) {
    return selectionShape;
  }
  const selectionFields = selectionShape?.kind === 'object'
    ? selectionShape.fields
    : selectionShape?.kind === 'array' && selectionShape.items?.kind === 'object'
      ? selectionShape.items.fields
      : undefined;
  if (isPreviewTypedGraphqlRecord(selectionFields)) {
    const typedObject = typedShape.kind === 'array' ? typedShape.items : typedShape;
    const typedFields = isPreviewTypedGraphqlRecord(typedObject) && typedObject.kind === 'object' &&
      isPreviewTypedGraphqlRecord(typedObject.fields)
      ? typedObject.fields
      : undefined;
    const fields = {};
    for (const [name, child] of Object.entries(selectionFields)) {
      fields[name] = mergePreviewTypedGraphqlShape(
        child,
        typedFields !== undefined && Object.prototype.hasOwnProperty.call(typedFields, name)
          ? typedFields[name]
          : undefined,
        depth + 1,
      );
    }
    const merged = { fields, kind: 'object' };
    if (typedShape.kind === 'array') return { items: merged, kind: 'array' };
    if (typedShape.kind === 'object') return merged;
    return selectionShape.kind === 'array' ? { items: merged, kind: 'array' } : merged;
  }
  if (PREVIEW_TYPED_GRAPHQL_LEAF_KINDS.has(typedShape.kind)) return typedShape;
  if (typedShape.kind === 'string') {
    if (typedShape.numeric === true) return typedShape;
    return selectionShape === undefined || selectionShape?.kind === 'unknown'
      ? typedShape
      : selectionShape;
  }
  if (typedShape.kind === 'array' && isPreviewTypedGraphqlRecord(typedShape.items) &&
    (PREVIEW_TYPED_GRAPHQL_LEAF_KINDS.has(typedShape.items.kind) || typedShape.items.kind === 'string')) {
    return {
      items: mergePreviewTypedGraphqlShape(
        selectionShape?.kind === 'array' ? selectionShape.items : undefined,
        typedShape.items,
        depth + 1,
      ),
      kind: 'array',
    };
  }
  return selectionShape;
}

/** Applies declared literals, scalar kinds, and list-ness to an already generated value. */
function applyPreviewTypedGraphqlSeed(seed, shape, depth, itemIndex = 0) {
  if (!isPreviewTypedGraphqlRecord(shape) || depth > PREVIEW_TYPED_GRAPHQL_DEPTH_LIMIT) return seed;
  if (shape.kind === 'literal') return previewTypedGraphqlSampleDates.rebase(shape.value);
  if (shape.kind === 'string' && shape.numeric === true) {
    if (typeof seed === 'string' && seed.trim() !== '' && Number.isFinite(Number(seed))) return seed;
    if (typeof seed === 'number' && Number.isFinite(seed)) return String(seed);
    return String(itemIndex + 1);
  }
  if (shape.kind === 'array') {
    if (Array.isArray(seed)) {
      return seed.map((item, index) => applyPreviewTypedGraphqlSeed(item, shape.items, depth + 1, index));
    }
    return seed === undefined || seed === null
      ? []
      : [applyPreviewTypedGraphqlSeed(seed, shape.items, depth + 1, itemIndex)];
  }
  if (shape.kind === 'object') {
    const record = Array.isArray(seed) ? seed[0] : seed;
    if (!isPreviewTypedGraphqlRecord(record) || !isPreviewTypedGraphqlRecord(shape.fields)) {
      return seed;
    }
    const output = { ...record };
    for (const [name, child] of Object.entries(shape.fields)) {
      if (Object.prototype.hasOwnProperty.call(output, name)) {
        output[name] = applyPreviewTypedGraphqlSeed(output[name], child, depth + 1, itemIndex);
      }
    }
    return output;
  }
  if (shape.kind === 'number' && typeof seed !== 'number') return 0;
  if (shape.kind === 'boolean' && typeof seed !== 'boolean') return false;
  return seed;
}
`;
