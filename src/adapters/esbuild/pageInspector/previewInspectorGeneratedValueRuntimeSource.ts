/**
 * Generates bounded runtime completion for partially populated render-only values.
 *
 * A hook frequently returns a real object whose deeper backend-owned fields are still missing.
 * Replacing that object would discard useful application state, while returning it unchanged lets
 * a later `.value`, destructure, or collection read abort the whole component. This runtime copies
 * only safe plain containers and fills nullish data-property leaves from compiler-generated shape
 * evidence. It never invokes getters, mutates project objects, or traverses class instances.
 */

/** Maximum nested object/array depth completed during one hook read. */
export const PREVIEW_INSPECTOR_GENERATED_VALUE_DEPTH_LIMIT = 12;

/** Maximum own data-property nodes inspected during one hook read. */
export const PREVIEW_INSPECTOR_GENERATED_VALUE_NODE_LIMIT = 256;

/** Maximum generated paths retained for one visible Inspector diagnostic. */
export const PREVIEW_INSPECTOR_GENERATED_VALUE_PATH_LIMIT = 32;

/**
 * Creates browser source for safe, demand-shaped completion of partial hook results.
 *
 * The returned source has no project imports. It expects only standard browser primitives and is
 * concatenated into the Page Inspector runtime before project modules are evaluated.
 *
 * @returns Plain JavaScript source defining `completePreviewInspectorGeneratedValue`.
 */
export function createPreviewInspectorGeneratedValueRuntimeSource(): string {
  return String.raw`
const PREVIEW_INSPECTOR_GENERATED_VALUE_DEPTH_LIMIT = ${PREVIEW_INSPECTOR_GENERATED_VALUE_DEPTH_LIMIT};
const PREVIEW_INSPECTOR_GENERATED_VALUE_NODE_LIMIT = ${PREVIEW_INSPECTOR_GENERATED_VALUE_NODE_LIMIT};
const PREVIEW_INSPECTOR_GENERATED_VALUE_PATH_LIMIT = ${PREVIEW_INSPECTOR_GENERATED_VALUE_PATH_LIMIT};
const previewInspectorGeneratedValueBlockedKeys = new Set([
  '__proto__',
  'constructor',
  'prototype',
]);

/** Reports whether a property can be copied without prototype mutation or unbounded UI text. */
function isPreviewInspectorGeneratedValueKey(propertyName) {
  return typeof propertyName === 'string' &&
    propertyName.length > 0 &&
    propertyName.length <= 128 &&
    !previewInspectorGeneratedValueBlockedKeys.has(propertyName);
}

/** Reads all own descriptors without invoking a project-defined getter or Proxy trap twice. */
function readPreviewInspectorGeneratedValueDescriptors(value) {
  try {
    return Object.getOwnPropertyDescriptors(value);
  } catch {
    return undefined;
  }
}

/**
 * Admits same-realm and cross-realm object literals while rejecting React elements and classes.
 * Cross-realm support matters in tests and in webviews whose values can cross isolated worlds.
 */
function isPreviewInspectorGeneratedPlainRecord(value) {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return false;
  let prototype;
  try {
    prototype = Object.getPrototypeOf(value);
    if (prototype === null) return true;
    if (Object.getPrototypeOf(prototype) !== null) return false;
    const constructorDescriptor = Object.getOwnPropertyDescriptor(prototype, 'constructor');
    const elementTypeDescriptor = Object.getOwnPropertyDescriptor(value, '$$typeof');
    return constructorDescriptor?.value?.name === 'Object' && elementTypeDescriptor === undefined;
  } catch {
    return false;
  }
}

/** Records one bounded generated path while still counting omitted paths for diagnostics. */
function recordPreviewInspectorGeneratedPath(state, path) {
  state.additions += 1;
  if (state.paths.length >= PREVIEW_INSPECTOR_GENERATED_VALUE_PATH_LIMIT) return;
  state.paths.push(path.length === 0 ? '<root>' : path.join('.'));
}

/** Creates an ordinary descriptor for one extension-owned generated data property. */
function createPreviewInspectorGeneratedDescriptor(value, authoredDescriptor) {
  return {
    configurable: authoredDescriptor?.configurable ?? true,
    enumerable: authoredDescriptor?.enumerable ?? true,
    value,
    writable: authoredDescriptor?.writable ?? true,
  };
}

/** Clones one plain record from descriptors so authored accessors are copied but never executed. */
function clonePreviewInspectorGeneratedRecord(value, descriptors, replacements) {
  let prototype;
  try {
    prototype = Object.getPrototypeOf(value);
    const finalDescriptors = Object.create(null);
    for (const propertyName of Reflect.ownKeys(descriptors)) {
      finalDescriptors[propertyName] = descriptors[propertyName];
    }
    for (const [propertyName, descriptor] of replacements) {
      finalDescriptors[propertyName] = descriptor;
    }
    const clone = Object.create(prototype);
    Object.defineProperties(clone, finalDescriptors);
    return clone;
  } catch {
    return undefined;
  }
}

/** Clones one array without reading indexed getters or redefining its non-configurable length. */
function clonePreviewInspectorGeneratedArray(value, descriptors, replacements) {
  try {
    const lengthDescriptor = descriptors.length;
    const authoredLength = Number.isSafeInteger(lengthDescriptor?.value)
      ? Math.max(0, lengthDescriptor.value)
      : 0;
    let generatedLength = authoredLength;
    for (const [propertyName] of replacements) {
      if (/^(?:0|[1-9][0-9]*)$/u.test(propertyName)) {
        generatedLength = Math.max(generatedLength, Number(propertyName) + 1);
      }
    }
    const clone = new Array(generatedLength);
    const finalDescriptors = Object.create(null);
    for (const propertyName of Reflect.ownKeys(descriptors)) {
      if (propertyName !== 'length') finalDescriptors[propertyName] = descriptors[propertyName];
    }
    for (const [propertyName, descriptor] of replacements) {
      finalDescriptors[propertyName] = descriptor;
    }
    Object.defineProperties(clone, finalDescriptors);
    return clone;
  } catch {
    return undefined;
  }
}

/**
 * Recursively overlays generated data-property leaves onto one safe authored container.
 * Non-nullish primitives, functions, accessors, unsafe keys, and incompatible container kinds win.
 */
function mergePreviewInspectorGeneratedValue(authored, generated, state, path, depth) {
  if (
    depth > PREVIEW_INSPECTOR_GENERATED_VALUE_DEPTH_LIMIT ||
    state.nodes >= PREVIEW_INSPECTOR_GENERATED_VALUE_NODE_LIMIT
  ) {
    return { changed: false, value: authored };
  }
  state.nodes += 1;
  if (authored === null || authored === undefined) {
    recordPreviewInspectorGeneratedPath(state, path);
    return { changed: true, value: generated };
  }

  const authoredIsArray = Array.isArray(authored);
  const generatedIsArray = Array.isArray(generated);
  const recordsAreMergeable =
    isPreviewInspectorGeneratedPlainRecord(authored) &&
    isPreviewInspectorGeneratedPlainRecord(generated);
  if ((!authoredIsArray || !generatedIsArray) && !recordsAreMergeable) {
    return { changed: false, value: authored };
  }

  const authoredDescriptors = readPreviewInspectorGeneratedValueDescriptors(authored);
  const generatedDescriptors = readPreviewInspectorGeneratedValueDescriptors(generated);
  if (authoredDescriptors === undefined || generatedDescriptors === undefined) {
    return { changed: false, value: authored };
  }

  const replacements = new Map();
  for (const propertyName of Reflect.ownKeys(generatedDescriptors)) {
    if (!isPreviewInspectorGeneratedValueKey(propertyName)) continue;
    const generatedDescriptor = generatedDescriptors[propertyName];
    if (
      generatedDescriptor === undefined ||
      !Object.prototype.hasOwnProperty.call(generatedDescriptor, 'value')
    ) {
      continue;
    }
    const authoredDescriptor = authoredDescriptors[propertyName];
    if (
      authoredDescriptor !== undefined &&
      !Object.prototype.hasOwnProperty.call(authoredDescriptor, 'value')
    ) {
      continue;
    }
    const childPath = [...path, propertyName];
    const child = mergePreviewInspectorGeneratedValue(
      authoredDescriptor?.value,
      generatedDescriptor.value,
      state,
      childPath,
      depth + 1,
    );
    if (child.changed) {
      replacements.set(
        propertyName,
        createPreviewInspectorGeneratedDescriptor(child.value, authoredDescriptor),
      );
    }
  }
  if (replacements.size === 0) return { changed: false, value: authored };
  const clone = authoredIsArray
    ? clonePreviewInspectorGeneratedArray(authored, authoredDescriptors, replacements)
    : clonePreviewInspectorGeneratedRecord(authored, authoredDescriptors, replacements);
  return clone === undefined
    ? { changed: false, value: authored }
    : { changed: true, value: clone };
}

/**
 * Completes one partial runtime value and returns both the stable-value candidate and evidence.
 * Callers own per-hook identity caching because that cache lives with the pinned Inspector session.
 */
function completePreviewInspectorGeneratedValue(authored, generated) {
  const state = { additions: 0, nodes: 0, paths: [] };
  const result = mergePreviewInspectorGeneratedValue(authored, generated, state, [], 0);
  return {
    additions: state.additions,
    changed: result.changed,
    paths: Object.freeze([...state.paths]),
    value: result.value,
  };
}
`;
}
