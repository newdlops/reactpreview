/** Generates bounded, coherent enum-array completion without changing authored selection counts. */

/** Reuses the ordinary merger's path, descriptor and node-budget helpers in its lexical scope. */
export function createPreviewInspectorGeneratedLiteralArrayRuntimeSource(): string {
  return String.raw`
const previewInspectorGeneratedLiteralArrayRepairs = new WeakMap();

/** Reads compiler-issued literal members without invoking metadata accessors or array methods. */
function readPreviewInspectorGeneratedArrayLiterals(state, path) {
  const key = normalizePreviewInspectorGeneratedRequirementPath([...path, '0'].join('.'))
    .replace(/\.\[\]/gu, '[]');
  let entry;
  try {
    if (state.typedLiterals === undefined || state.typedLiterals === null) return undefined;
    entry = Object.getOwnPropertyDescriptor(state.typedLiterals, key);
  } catch { return false; }
  if (entry === undefined) return undefined;
  if (!Object.hasOwn(entry, 'value') || !Array.isArray(entry.value)) return false;
  const length = readPreviewInspectorGeneratedOwnValue(entry.value, 'length');
  if (!Number.isSafeInteger(length) || length < 1 || length > 16) return false;
  const members = [];
  for (let index = 0; index < length; index += 1) {
    const value = readPreviewInspectorGeneratedOwnValue(entry.value, String(index));
    if (!(typeof value === 'string' || typeof value === 'boolean' ||
      typeof value === 'number' && Number.isFinite(value))) return false;
    members.push(value);
  }
  return members;
}

/** A concrete indexed read still requires enough items; wildcard item evidence alone does not. */
function hasPreviewInspectorGeneratedMissingArrayIndex(state, path, length) {
  return state.requiredPaths.some((raw) => {
    if (typeof raw !== 'string') return false;
    const parts = raw.replace(/\.?\[(\d*)\]/gu, (_match, index) => '.' + (index || '[]'))
      .replace(/^\./u, '').split('.');
    if (parts.length <= path.length) return false;
    if (!path.every((part, index) => parts[index] === String(part) ||
      /^(?:0|[1-9][0-9]*)$/u.test(String(part)) && parts[index] === '[]')) return false;
    const index = parts[path.length];
    return /^(?:0|[1-9][0-9]*)$/u.test(String(index)) && Number(index) >= length;
  });
}

/** Reads only short ordinary primitive arrays, leaving custom properties/accessors to the merger. */
function readPreviewInspectorGeneratedLiteralArraySnapshot(value, state) {
  const length = readPreviewInspectorGeneratedOwnValue(value, 'length');
  if (!Number.isSafeInteger(length) || length < 1 ||
    length > PREVIEW_INSPECTOR_GENERATED_VALUE_NODE_LIMIT - state.nodes) return undefined;
  const descriptors = Object.create(null);
  try {
    if (Reflect.ownKeys(value).length !== length + 1) return undefined;
    descriptors.length = Object.getOwnPropertyDescriptor(value, 'length');
    for (let index = 0; index < length; index += 1) {
      descriptors[String(index)] = Object.getOwnPropertyDescriptor(value, String(index));
    }
  } catch { return undefined; }
  const values = [];
  for (let index = 0; index < length; index += 1) {
    const descriptor = descriptors[String(index)];
    if (descriptor === undefined || !Object.hasOwn(descriptor, 'value')) return undefined;
    const item = descriptor.value;
    if (!(typeof item === 'string' || typeof item === 'boolean' ||
      typeof item === 'number' && Number.isFinite(item))) return undefined;
    values.push(item);
  }
  state.nodes += length;
  return { descriptors, values };
}

/** Shares one schema-proven repair only across the exact unchanged source array identity. */
function completePreviewInspectorGeneratedLiteralArray(authored, generated, state, path) {
  if (state.repairLiteralArrays !== true || path.length === 0 ||
    !hasPreviewInspectorGeneratedExactRequirement(state, [...path, '0'])) return undefined;
  const retained = previewInspectorGeneratedLiteralArrayRepairs.get(authored);
  const allowed = readPreviewInspectorGeneratedArrayLiterals(state, path);
  if (allowed === false || allowed === undefined && retained === undefined) return undefined;
  const name = [...path].reverse().find((part) => !/^(?:0|[1-9][0-9]*)$/u.test(String(part)));
  if (name === undefined) return undefined;
  const snapshot = readPreviewInspectorGeneratedLiteralArraySnapshot(authored, state);
  if (snapshot === undefined || hasPreviewInspectorGeneratedMissingArrayIndex(state, path, snapshot.values.length)) return undefined;
  if (retained !== undefined) {
    const unchanged = snapshot.values.length === retained.source.length &&
      snapshot.values.every((value, index) => Object.is(value, retained.source[index]));
    if (unchanged) {
      const compatible = name === retained.name && (allowed === undefined ||
        allowed.length === retained.allowed.length && allowed.every((member) =>
          retained.allowed.some((other) => Object.is(member, other))));
      if (!compatible) return undefined;
      for (const index of retained.changedIndices) recordPreviewInspectorGeneratedPath(state, [...path, String(index)]);
      return { changed: retained.value !== authored, value: retained.value };
    }
    previewInspectorGeneratedLiteralArrayRepairs.delete(authored);
  }
  if (allowed === undefined) return undefined;
  const replacements = new Map();
  const changedIndices = [];
  for (let index = 0; index < snapshot.values.length; index += 1) {
    const value = snapshot.values[index];
    if (!isPreviewInspectorGeneratedKeyText(value, name) || allowed.some((member) => Object.is(member, value))) continue;
    const proposed = readPreviewInspectorGeneratedOwnValue(generated, String(index)) ??
      readPreviewInspectorGeneratedOwnValue(generated, '0');
    if (!allowed.some((member) => Object.is(member, proposed))) return undefined;
    replacements.set(String(index), createPreviewInspectorGeneratedDescriptor(proposed, snapshot.descriptors[String(index)]));
    changedIndices.push(index);
  }
  let value = authored;
  if (replacements.size > 0) {
    value = clonePreviewInspectorGeneratedArray(authored, snapshot.descriptors, replacements);
    if (value === undefined) return undefined;
    if (Object.isFrozen(authored)) Object.freeze(value);
  }
  previewInspectorGeneratedLiteralArrayRepairs.set(authored, {
    allowed, changedIndices, name, source: snapshot.values, value,
  });
  if (value !== authored) {
    previewInspectorGeneratedLiteralArrayRepairs.set(value, {
      allowed, changedIndices: [], name, value,
      source: snapshot.values.map((_item, index) => readPreviewInspectorGeneratedOwnValue(value, String(index))),
    });
  }
  for (const index of changedIndices) recordPreviewInspectorGeneratedPath(state, [...path, String(index)]);
  return { changed: replacements.size > 0, value };
}
`;
}
