/** Copies in-memory preview checkpoints without sending executable values through editable JSON. */
export function createPreviewInspectorNeuralRuntimeSnapshotValueSource(): string {
  return String.raw`
const previewInspectorSnapshotComponentTypeIds = new WeakMap();
let previewInspectorSnapshotComponentTypeSequence = 0;
/** Describes render semantics without walking private React owners, stacks or validation getters. */
function readPreviewInspectorNeuralSnapshotElement(value) {
  if (value === null || typeof value !== 'object') return undefined;
  try {
    const own = (name) => Object.getOwnPropertyDescriptor(value, name)?.value;
    const marker = own('$$typeof');
    if (marker !== Symbol.for('react.element') &&
      marker !== Symbol.for('react.transitional.element')) return undefined;
    const type = own('type');
    let typeIdentity = typeof type === 'symbol' ? String(type) : type;
    if (type !== null && (typeof type === 'function' || typeof type === 'object')) {
      typeIdentity = previewInspectorSnapshotComponentTypeIds.get(type);
      if (typeIdentity === undefined) {
        typeIdentity = 'component:' + String(++previewInspectorSnapshotComponentTypeSequence);
        previewInspectorSnapshotComponentTypeIds.set(type, typeIdentity);
      }
    }
    return { $previewReactElement: String(marker), type: typeIdentity,
      key: own('key') ?? null, props: own('props') };
  } catch { return undefined; }
}
/** Reads a genuine native pattern through internal-slot getters rather than authored properties. */
function readPreviewInspectorNeuralSnapshotRegExp(value) {
  const source = Object.getOwnPropertyDescriptor(RegExp.prototype, 'source').get.call(value);
  let flags = '';
  for (const [name, flag] of [
    ['hasIndices', 'd'], ['global', 'g'], ['ignoreCase', 'i'], ['multiline', 'm'],
    ['dotAll', 's'], ['unicode', 'u'], ['unicodeSets', 'v'], ['sticky', 'y'],
  ]) {
    if (Object.getOwnPropertyDescriptor(RegExp.prototype, name)?.get?.call(value)) flags += flag;
  }
  return [source, flags, Object.getOwnPropertyDescriptor(value, 'lastIndex')?.value ?? 0];
}
/** Copies a bounded runtime graph; an unsupported or oversized graph rejects the checkpoint. */
function copyPreviewInspectorNeuralRuntimeSnapshotValue(value) {
  const seen = new WeakMap();
  let nodes = 0;
  const copy = (current, depth) => {
    if (depth > 16 || ++nodes > 4096) throw new RangeError('Runtime checkpoint value limit');
    if (current === null || typeof current !== 'object') return current;
    if (seen.has(current)) return seen.get(current);
    const elementMarker = Object.getOwnPropertyDescriptor(current, '$$typeof')?.value;
    if (elementMarker === Symbol.for('react.element') ||
      elementMarker === Symbol.for('react.transitional.element')) return current;
    const prototype = Object.getPrototypeOf(current);
    const array = Array.isArray(current);
    const plain = prototype === null ||
      (Object.getPrototypeOf(prototype) === null &&
        Object.getOwnPropertyDescriptor(prototype, 'constructor')?.value?.name === 'Object');
    // Read native internal slots through intrinsic getters, never application accessors.
    if (!array && !plain) try {
      const [source, flags, lastIndex] = readPreviewInspectorNeuralSnapshotRegExp(current);
      const result = new RegExp(source, flags);
      result.lastIndex = lastIndex;
      seen.set(current, result);
      return result;
    } catch (error) {
      if (!(error instanceof TypeError)) throw error;
    }
    if (!array && !plain) {
      try {
        const result = new Date(Date.prototype.getTime.call(current));
        seen.set(current, result);
        return result;
      } catch {}
      // Opaque class instances cannot be reconstructed by copying their own fields.
      throw new TypeError('Unsupported runtime checkpoint value');
    }
    const descriptors = Object.getOwnPropertyDescriptors(current);
    if (array && descriptors.length.value > 4096) throw new RangeError('Runtime checkpoint list limit');
    const result = array ? [] : Object.create(prototype);
    seen.set(current, result);
    for (const name of Reflect.ownKeys(descriptors)) {
      if (name === 'length' || ['__proto__', 'constructor', 'prototype'].includes(name)) continue;
      const descriptor = descriptors[name];
      if (!Object.hasOwn(descriptor, 'value')) throw new TypeError('Runtime checkpoint accessor');
      Object.defineProperty(result, name, { ...descriptor, value: copy(descriptor.value, depth + 1) });
    }
    if (array) result.length = descriptors.length.value;
    return Object.isFrozen(current) ? Object.freeze(result) : result;
  };
  try { return copy(value, 0); } catch { return undefined; }
}
`;
}
