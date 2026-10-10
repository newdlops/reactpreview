/**
 * Merges compiler-declared type values into render-only hook fallbacks.
 *
 * Syntax evidence remains authoritative for concrete leaves (compared literals, guard values),
 * while the declared type repairs what syntax could not know: placeholder `{}` leaves become the
 * declared scalar, missing required fields are added, and string/number leaves that violate a
 * finite literal union are replaced by an allowed member. The fragment is composed into the same
 * generated module as the runtime fallback helpers and never executes project code.
 */

import { createPreviewSampleDateApiExpression } from '../previewSampleDateRuntimeSource';

/** Returns the ordered browser fragment; no project code runs during source generation. */
export function createPreviewInspectorRuntimeFallbackTypedValueRuntimeSource(): string {
  return String.raw`
const previewInspectorTypedSampleDates = ${createPreviewSampleDateApiExpression()};
const PREVIEW_INSPECTOR_TYPED_VALUE_TAG = '$previewTyped';
const PREVIEW_INSPECTOR_TYPED_VALUE_DEPTH_LIMIT = 12;

/** Converts a JSON descriptor into runtime values: functions, dates, collections, promises. */
function materializePreviewInspectorTypedValue(descriptor, depth = 0) {
  if (depth > PREVIEW_INSPECTOR_TYPED_VALUE_DEPTH_LIMIT) return undefined;
  if (Array.isArray(descriptor)) {
    return Object.freeze(descriptor.map((item) => materializePreviewInspectorTypedValue(item, depth + 1)));
  }
  // Declared date fields carry the canonical compile-time day; place it on the current day.
  if (typeof descriptor === 'string') return previewInspectorTypedSampleDates.rebase(descriptor);
  if (descriptor === null || typeof descriptor !== 'object') return descriptor;
  const tag = descriptor[PREVIEW_INSPECTOR_TYPED_VALUE_TAG];
  if (tag === 'function') {
    const returns = Object.hasOwn(descriptor, 'returns')
      ? materializePreviewInspectorTypedValue(descriptor.returns, depth + 1)
      : undefined;
    return Object.freeze(() => returns);
  }
  if (tag === 'date') {
    return new Date(typeof descriptor.iso === 'string'
      ? previewInspectorTypedSampleDates.rebase(descriptor.iso) : 0);
  }
  if (tag === 'map') return new Map();
  if (tag === 'set') return new Set();
  if (tag === 'promise') {
    return Promise.resolve(materializePreviewInspectorTypedValue(descriptor.value, depth + 1));
  }
  const output = {};
  for (const [key, value] of Object.entries(descriptor)) {
    if (key === '__proto__' || key === 'constructor' || key === 'prototype') continue;
    output[key] = materializePreviewInspectorTypedValue(value, depth + 1);
  }
  return Object.freeze(output);
}

/**
 * Merges one fallback leaf with its declared-type counterpart; see the file header for policy.
 * itemIndex is the position inside the nearest generated list, used to vary literal members.
 */
function mergePreviewInspectorTypedLeaf(syntax, typed, literals, path, depth, itemIndex = 0) {
  if (typed === undefined || depth > PREVIEW_INSPECTOR_TYPED_VALUE_DEPTH_LIMIT) return syntax;
  if (syntax === undefined) return typed;
  if (isPreviewInspectorGeneratedPlainRecord(syntax) && isPreviewInspectorGeneratedPlainRecord(typed)) {
    const output = {};
    for (const key of new Set([...Object.keys(typed), ...Object.keys(syntax)])) {
      output[key] = mergePreviewInspectorTypedLeaf(
        syntax[key],
        typed[key],
        literals,
        path.length === 0 ? key : path + '.' + key,
        depth + 1,
        itemIndex,
      );
    }
    return Object.freeze(output);
  }
  if (Array.isArray(syntax) && Array.isArray(typed)) {
    if (syntax.length === 0) return typed;
    return Object.freeze(syntax.map((item, index) =>
      mergePreviewInspectorTypedLeaf(item, typed[0], literals, path + '[]', depth + 1, index)));
  }
  // A shape-blind neutral object is the placeholder that crashed scalar renders.
  if (isPreviewInspectorGeneratedPlainRecord(syntax) && Object.keys(syntax).length === 0) return typed;
  if (typeof syntax === 'function') return syntax;
  if (typeof syntax !== typeof typed || (syntax === null) !== (typed === null)) return typed;
  const allowed = literals !== null && typeof literals === 'object' ? literals[path] : undefined;
  if (Array.isArray(allowed) && allowed.length > 0 && !allowed.includes(syntax)) {
    // Sample rows show the declared kinds in turn (info, warn, error) after the typed default.
    const members = [typed, ...allowed.filter((member) => member !== typed)];
    return members[itemIndex % members.length];
  }
  return syntax;
}

/**
 * Applies a compiler-declared type value to one computed fallback.
 *
 * @param fallback Syntax-derived fallback after automatic required-path completion.
 * @param metadata Normalized hook metadata that may carry typedValue/typedLiterals.
 * @returns The merged fallback, or the original when no declared type was attached.
 */
function mergePreviewInspectorTypedRuntimeFallback(fallback, metadata) {
  if (metadata?.typedValue === undefined) return fallback;
  let typed;
  try {
    typed = materializePreviewInspectorTypedValue(metadata.typedValue);
  } catch {
    return fallback;
  }
  return mergePreviewInspectorTypedLeaf(fallback, typed, metadata.typedLiterals, '', 0);
}
`;
}
