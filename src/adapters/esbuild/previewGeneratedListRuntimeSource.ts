/** Global browser runtime used by every compiler-generated preview collection. */
export const PREVIEW_GENERATED_LIST_RUNTIME_KEY = 'react-file-preview.generated-list-runtime';

/** Emits the bounded shared list factory before project and Inspector modules are evaluated. */
export function createPreviewGeneratedListRuntimeSource(): string {
  return String.raw`
const PREVIEW_GENERATED_LIST_DEFAULT_SAMPLE_COUNT = 3;
const PREVIEW_GENERATED_LIST_MAX_SAMPLE_COUNT = 10;
const PREVIEW_GENERATED_LIST_RUNTIME_SYMBOL = Symbol.for(${JSON.stringify(PREVIEW_GENERATED_LIST_RUNTIME_KEY)});
const blockedPreviewGeneratedListPropertyNames = new Set(['__proto__', 'constructor', 'prototype']);

/** Keeps generated collection sizes useful for UI states without allowing runaway nested fixtures. */
function normalizePreviewGeneratedListSampleCount(value) {
  const numeric = Number(value);
  if (!Number.isSafeInteger(numeric)) return PREVIEW_GENERATED_LIST_DEFAULT_SAMPLE_COUNT;
  return Math.min(PREVIEW_GENERATED_LIST_MAX_SAMPLE_COUNT, Math.max(1, numeric));
}

/** Adds deterministic variation only to familiar generated display/identity strings. */
function diversifyPreviewGeneratedListString(value, fieldName, itemIndex) {
  if (itemIndex === 0 || value.length === 0) return value;
  // GraphQL discriminators select authored union branches and must remain identical for every row.
  if (fieldName === '__typename') return value;
  const name = String(fieldName).replaceAll('_', '').toLowerCase();
  const suffix = String(itemIndex + 1);
  if (name === 'id' || name.endsWith('id') || name === 'uuid') return value + '-' + suffix;
  if (name.includes('email')) {
    const separator = value.indexOf('@');
    return separator > 0
      ? value.slice(0, separator) + '+' + suffix + value.slice(separator)
      : value + '-' + suffix;
  }
  if (/(name|label|title|subject|headline)$/u.test(name)) return value + ' ' + suffix;
  return value;
}

/** Copies compiler-owned plain values so repeated rows have independent, frozen item identity. */
function clonePreviewGeneratedListItem(
  value,
  itemIndex,
  fieldName = '',
  budget = { nodes: 0 },
  depth = 0,
) {
  if (typeof value === 'string') {
    return diversifyPreviewGeneratedListString(value, fieldName, itemIndex);
  }
  if (
    value === null ||
    (typeof value !== 'object' && typeof value !== 'function') ||
    typeof value === 'function' ||
    depth > 12 ||
    budget.nodes >= 256
  ) return value;
  budget.nodes += 1;
  if (Array.isArray(value)) {
    return Object.freeze(value.map((child) =>
      clonePreviewGeneratedListItem(child, itemIndex, fieldName, budget, depth + 1),
    ));
  }
  let prototype;
  try {
    prototype = Object.getPrototypeOf(value);
  } catch {
    return value;
  }
  if (
    (prototype !== Object.prototype && prototype !== null) ||
    Object.hasOwn(value, '$$typeof')
  ) return value;
  const result = {};
  let descriptors;
  try {
    descriptors = Object.getOwnPropertyDescriptors(value);
  } catch {
    return value;
  }
  for (const [name, descriptor] of Object.entries(descriptors)) {
    if (
      blockedPreviewGeneratedListPropertyNames.has(name) ||
      descriptor.enumerable !== true ||
      !('value' in descriptor)
    ) continue;
    result[name] = clonePreviewGeneratedListItem(
      descriptor.value,
      itemIndex,
      name,
      budget,
      depth + 1,
    );
  }
  return Object.freeze(result);
}

/** Installs one hot-reload-stable API that transformed project modules can reach by Symbol key. */
const previewGeneratedListRuntime = (() => {
  const previous = globalThis[PREVIEW_GENERATED_LIST_RUNTIME_SYMBOL];
  let sampleCount = normalizePreviewGeneratedListSampleCount(previous?.getSampleCount?.());
  const runtime = {
    create(itemFactory) {
      if (typeof itemFactory !== 'function') return [];
      const result = [];
      for (let itemIndex = 0; itemIndex < sampleCount; itemIndex += 1) {
        result.push(clonePreviewGeneratedListItem(itemFactory(itemIndex), itemIndex));
      }
      // Application helpers commonly call Array#sort in place. Keep the list itself mutable while
      // retaining independently frozen generated item records.
      return result;
    },
    getSampleCount() {
      return sampleCount;
    },
    setSampleCount(value) {
      sampleCount = normalizePreviewGeneratedListSampleCount(value);
      return sampleCount;
    },
  };
  try {
    globalThis[PREVIEW_GENERATED_LIST_RUNTIME_SYMBOL] = runtime;
  } catch {
    // A locked-down host still receives the lexical default through the helpers below.
  }
  return runtime;
})();

/** Returns the active generated-list size shared by props, hooks, and backend fixtures. */
function readPreviewGeneratedListSampleCount() {
  return previewGeneratedListRuntime.getSampleCount();
}

/** Updates the shared generated-list size and returns its normalized value. */
function setPreviewGeneratedListSampleCount(value) {
  return previewGeneratedListRuntime.setSampleCount(value);
}

/** Materializes one independently frozen item per configured, reorderable list sample. */
function createPreviewGeneratedList(itemFactory) {
  return previewGeneratedListRuntime.create(itemFactory);
}
`;
}
