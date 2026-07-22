/**
 * Generates JSON-visible templates for render-blocker pass values.
 *
 * Compiler fallbacks legitimately contain functions and `undefined`, but ordinary JSON drops both
 * and can reduce a useful inferred object to `{}`. This adapter keeps callable leaves visible as an
 * explicit sentinel, materializes statically required paths, and converts that sentinel back to an
 * inert function only when the value enters project code.
 */
import { PREVIEW_AUTOMATIC_COMPONENT_MARKER_KEY } from '../previewAutomaticPropsRuntimeSource';
import { PREVIEW_COLLECTION_METHOD_NAMES } from '../previewCollectionMethodNames';
import { PREVIEW_STRING_ONLY_METHOD_NAMES } from '../previewStringMethodNames';

/** Text stored in editable JSON wherever the preview runtime inferred a no-op callback. */
export const PREVIEW_INSPECTOR_NOOP_VALUE_SENTINEL = '[Preview no-op function]';

/** Text stored in editable JSON for a missing React component constructor prop. */
export const PREVIEW_INSPECTOR_COMPONENT_VALUE_SENTINEL = '[Preview component placeholder]';

/** Creates browser helpers for editable fallback templates and safe runtime materialization. */
export function createPreviewInspectorBlockerValueRuntimeSource(): string {
  return String.raw`
const PREVIEW_INSPECTOR_NOOP_VALUE_SENTINEL = ${JSON.stringify(PREVIEW_INSPECTOR_NOOP_VALUE_SENTINEL)};
const PREVIEW_INSPECTOR_COMPONENT_VALUE_SENTINEL = ${JSON.stringify(PREVIEW_INSPECTOR_COMPONENT_VALUE_SENTINEL)};
const PREVIEW_INSPECTOR_COMPONENT_MARKER = Symbol.for(${JSON.stringify(PREVIEW_AUTOMATIC_COMPONENT_MARKER_KEY)});
const PREVIEW_INSPECTOR_BLOCKER_VALUE_DEPTH_LIMIT = 12;
const PREVIEW_INSPECTOR_BLOCKER_VALUE_NODE_LIMIT = 256;
const PREVIEW_INSPECTOR_COLLECTION_METHOD_NAMES = new Set(
  ${JSON.stringify(PREVIEW_COLLECTION_METHOD_NAMES)},
);
const PREVIEW_INSPECTOR_STRING_METHOD_NAMES = new Set(
  ${JSON.stringify(PREVIEW_STRING_ONLY_METHOD_NAMES)},
);

/** Copies one generated value into bounded JSON without invoking accessors or retaining prototypes. */
function copyPreviewInspectorBlockerValueForJson(value, state, depth = 0) {
  if (depth > PREVIEW_INSPECTOR_BLOCKER_VALUE_DEPTH_LIMIT || state.nodes >= PREVIEW_INSPECTOR_BLOCKER_VALUE_NODE_LIMIT) {
    return null;
  }
  state.nodes += 1;
  if (typeof value === 'function') {
    const marker = Object.getOwnPropertyDescriptor(value, PREVIEW_INSPECTOR_COMPONENT_MARKER);
    return marker?.value === true
      ? PREVIEW_INSPECTOR_COMPONENT_VALUE_SENTINEL
      : PREVIEW_INSPECTOR_NOOP_VALUE_SENTINEL;
  }
  if (value === undefined || typeof value === 'symbol') return null;
  if (typeof value === 'bigint') return Number(value);
  if (value === null || typeof value !== 'object') return value;
  let descriptors;
  try { descriptors = Object.getOwnPropertyDescriptors(value); } catch { return null; }
  const result = Array.isArray(value) ? [] : {};
  for (const [propertyName, descriptor] of Object.entries(descriptors)) {
    if (
      propertyName === 'length' ||
      blockedInspectorPropNames.has(propertyName) ||
      !Object.hasOwn(descriptor, 'value')
    ) {
      continue;
    }
    result[propertyName] = copyPreviewInspectorBlockerValueForJson(
      descriptor.value,
      state,
      depth + 1,
    );
  }
  return result;
}

/** Creates a deterministic preview record for a collection whose item fields remain unknown. */
function createPreviewInspectorRequiredPathCollectionItem() {
  return { id: 'preview-1', name: 'name' };
}

/** Keeps a generated text leaf visibly tied to its key without expanding application layout. */
function createPreviewInspectorRequiredPathKeyText(propertyName) {
  const key = String(propertyName).trim() || 'value';
  return key.length <= 32 ? key : key.slice(0, 31) + '…';
}

/** Infers a type-compatible, visibly synthetic leaf from property-name and call evidence. */
function createPreviewInspectorRequiredPathLeaf(propertyName, callable) {
  if (callable) return PREVIEW_INSPECTOR_NOOP_VALUE_SENTINEL;
  const rawName = String(propertyName);
  const name = rawName.replaceAll('_', '').toLowerCase();
  const keyText = createPreviewInspectorRequiredPathKeyText(rawName);
  if (/^\d+$/u.test(name)) return createPreviewInspectorRequiredPathCollectionItem();
  /*
   * Require an actual camelCase/snake_case boundary after an action verb. Prefix-only matching
   * misclassified ordinary data such as "address" as an "add..." callback. Explicit callable
   * evidence still wins above, so lower-case project functions remain safe when they are invoked.
   */
  const hasActionFunctionName = /^(?:set|on|handle|toggle|submit|refetch|refresh|mutate|dispatch|navigate|reset|update|remove|add)(?:[A-Z0-9_]|$)/u.test(rawName);
  if (hasActionFunctionName || /(?:handler|callback)$/u.test(name)) {
    return PREVIEW_INSPECTOR_NOOP_VALUE_SENTINEL;
  }
  if (/(?:disabled|hidden|loading|pending|suspended|denied|forbidden|locked|error|invalid|touched|dirty)$/u.test(name)) {
    return false;
  }
  if (/^(?:is|has|can|should|will|did|does|was|were|allow|enable)/u.test(name) || /(?:enabled|visible|active|selected|checked|ready|success|valid)$/u.test(name)) {
    return !/(?:disabled|hidden|loading|pending|suspended|denied|forbidden|locked|error|invalid)$/u.test(name);
  }
  /* Timer APIs require a finite number; an object placeholder makes arithmetic and schedulers fail. */
  if (/(?:duration|timeout|delay|interval|milliseconds|millis|seconds)$/u.test(name)) return 1;
  if (/(?:count|total|index|length|size|page|amount|rate|number|price|cost|limit|offset)$/u.test(name)) return 1;
  if (/(?:items|rows|list|options|results|nodes|edges|records|entries|users|companies)$/u.test(name)) {
    return [createPreviewInspectorRequiredPathCollectionItem()];
  }
  if (name === 'id' || name.endsWith('id') || name === 'uuid') return 'preview-1';
  if (name.includes('email')) return 'preview@example.invalid';
  if (/(?:date|time|timestamp|createdat|updatedat)$/u.test(name)) return '2026-01-15T09:00:00.000Z';
  if (/(?:url|uri|href|link)$/u.test(name)) return 'https://example.invalid/preview/1';
  /* Image/data adapters commonly call String methods on src without requiring a valid URL. */
  if (name === 'src' || name.endsWith('src')) return keyText;
  if (/(?:status|state)$/u.test(name)) return 'ACTIVE';
  if (/(?:props|context|form|data|filter|params|values|config|settings|user|company|session)$/u.test(name)) {
    return createPreviewInspectorRequiredPathCollectionItem();
  }
  return keyText;
}

/** Reports whether a demanded property name proves that its value is a render-safe scalar leaf. */
function isPreviewInspectorRequiredPathScalarLeaf(propertyName) {
  const name = String(propertyName).replaceAll('_', '').toLowerCase();
  return /(?:label|caption|name|owner|author|assignee|title|subject|headline|description|message|content|summary|text|body|email|date|time|timestamp|createdat|updatedat|url|uri|href|link|src|path|route|status|state)$/u.test(name) ||
    name === 'id' || name.endsWith('id') || name === 'uuid' ||
    /(?:duration|timeout|delay|interval|milliseconds|millis|seconds)$/u.test(name) ||
    /(?:count|total|index|length|size|page|amount|rate|number|price|cost|limit|offset)$/u.test(name) ||
    /^(?:is|has|can|should|will|did|does|was|were|allow|enable)/u.test(name) ||
    /(?:enabled|visible|active|selected|checked|ready|success|valid|disabled|hidden|loading|pending|suspended|denied|forbidden|locked|error|invalid|touched|dirty)$/u.test(name);
}

/** Reads one compiler fallback leaf through data descriptors only, never through project getters. */
function readPreviewInspectorRequiredPathSeed(value, path) {
  let current = value;
  for (const propertyName of path) {
    if ((typeof current !== 'object' && typeof current !== 'function') || current === null) {
      return undefined;
    }
    let descriptor;
    try { descriptor = Object.getOwnPropertyDescriptor(current, propertyName); } catch { return undefined; }
    if (descriptor === undefined || !Object.hasOwn(descriptor, 'value')) return undefined;
    current = descriptor.value;
  }
  return current;
}

/**
 * Retains bounded compiler-shaped data carried across a render-prop or hook boundary. The wrapper
 * can prove only the carrier key (data, payload, and similar), while the reached GraphQL or API
 * document owns the child selection. Empty Context/Redux placeholders remain eligible for normal
 * semantic generation instead of being mistaken for useful backend evidence.
 */
function copyPreviewInspectorStructuredCarrierSeed(propertyName, seed) {
  if (!/^(?:data|payload|response|result)$/iu.test(String(propertyName))) return undefined;
  if (seed === null || typeof seed !== 'object') return undefined;
  const copied = copyPreviewInspectorBlockerValueForJson(seed, { nodes: 0 });
  if (Array.isArray(copied)) return copied.length > 0 ? copied.slice(0, 1) : undefined;
  return copied !== null && typeof copied === 'object' && Object.keys(copied).length > 0
    ? copied
    : undefined;
}

/** Retains an inferred scalar type but strips unproven object siblings and extra list items. */
function createPreviewInspectorRequiredPathSmartLeaf(propertyName, callable, seed) {
  if (typeof seed === 'function') {
    const marker = Object.getOwnPropertyDescriptor(seed, PREVIEW_INSPECTOR_COMPONENT_MARKER);
    return marker?.value === true
      ? PREVIEW_INSPECTOR_COMPONENT_VALUE_SENTINEL
      : PREVIEW_INSPECTOR_NOOP_VALUE_SENTINEL;
  }
  if (callable) return PREVIEW_INSPECTOR_NOOP_VALUE_SENTINEL;
  if (seed === null) return null;
  if (typeof seed === 'boolean') return seed;
  if (typeof seed === 'number') return Number.isFinite(seed) ? seed : 1;
  if (typeof seed === 'bigint') return Number(seed);
  if (typeof seed === 'string' && seed.length > 0) return seed;
  const structuredCarrier = copyPreviewInspectorStructuredCarrierSeed(propertyName, seed);
  if (structuredCarrier !== undefined) return structuredCarrier;
  if (Array.isArray(seed)) {
    const item = seed[0];
    if (typeof item === 'boolean' || typeof item === 'number' || typeof item === 'string') {
      return [item];
    }
    return [{}];
  }
  /*
   * A neutral Context/Redux proxy often exposes every missing descendant as an empty object. Once
   * compiler evidence names a textual or scalar leaf such as label, link, or isEnabled, that
   * semantic evidence is stronger than the proxy's placeholder kind. Retaining an empty object here makes
   * React throw "Objects are not valid as a React child" before the real page can commit.
   */
  if (seed !== null && typeof seed === 'object' && isPreviewInspectorRequiredPathScalarLeaf(propertyName)) {
    return createPreviewInspectorRequiredPathLeaf(propertyName, callable);
  }
  if (seed !== null && typeof seed === 'object') return {};
  const semantic = createPreviewInspectorRequiredPathLeaf(propertyName, callable);
  if (Array.isArray(semantic)) return semantic.slice(0, 1).map(() => ({}));
  if (semantic !== null && typeof semantic === 'object') return {};
  return semantic;
}

/** Converts dotted, numeric, and array-item evidence into one bounded materialization path. */
function parsePreviewInspectorRequiredPath(rawPath) {
  if (typeof rawPath !== 'string' || rawPath === '<root>') return undefined;
  const callable = rawPath.endsWith('()');
  const source = callable ? rawPath.slice(0, -2) : rawPath;
  const parsedPath = source
    .replace(/\[(\d*)\]/gu, (_match, index) => '.' + (index.length === 0 ? '0' : index))
    .split('.')
    .map((part) => part.replace(/\?$/u, ''))
    .filter((part) => part.length > 0 && part !== '<root>')
    .slice(0, PREVIEW_INSPECTOR_BLOCKER_VALUE_DEPTH_LIMIT);
  const methodName = parsedPath.at(-1);
  const stringReceiver = callable && PREVIEW_INSPECTOR_STRING_METHOD_NAMES.has(methodName);
  const collection = callable && !stringReceiver && PREVIEW_INSPECTOR_COLLECTION_METHOD_NAMES.has(methodName);
  const receiverConstrained = collection || stringReceiver;
  const path = receiverConstrained ? parsedPath.slice(0, -1) : parsedPath;
  return path.length === 0 && !receiverConstrained
    ? undefined
    : { callable: callable && !receiverConstrained, collection, methodName, path, stringReceiver };
}

/** Detects a generated object API without invoking getters or treating its method as String data. */
function hasPreviewInspectorRequiredPathCallableMember(value, propertyName) {
  if (value === null || typeof value !== 'object' || typeof propertyName !== 'string') return false;
  try {
    const descriptor = Object.getOwnPropertyDescriptor(value, propertyName);
    return typeof descriptor?.value === 'function' ||
      descriptor?.value === PREVIEW_INSPECTOR_NOOP_VALUE_SENTINEL;
  } catch {
    return false;
  }
}

/** Adds one compiler-proven path when serialization alone could not expose its missing property. */
function materializePreviewInspectorRequiredPath(template, rawPath, seedValue) {
  const parsed = parsePreviewInspectorRequiredPath(rawPath);
  if (parsed === undefined) return template;
  const { callable, collection, methodName, path, stringReceiver } = parsed;
  /*
   * Calls such as value.trim() and value.endsWith() prove that the receiver itself is text. The
   * method lives on String.prototype and must not be represented as an own no-op child property.
   * In particular, a later template.endsWith() requirement must preserve an already generated
   * template string rather than widening it to an object with an own endsWith callback.
   */
  if (stringReceiver && path.length === 0) {
    if (
      hasPreviewInspectorRequiredPathCallableMember(template, methodName) ||
      hasPreviewInspectorRequiredPathCallableMember(seedValue, methodName)
    ) return template;
    if (typeof template === 'string') return template;
    return typeof seedValue === 'string' && seedValue.length > 0 ? seedValue : 'value';
  }
  /*
   * A direct result.filter()/map()/find() observation proves the root itself is an array. The
   * method belongs to Array.prototype and must never become an own no-op property on an object.
   */
  if (collection && path.length === 0) {
    return Array.isArray(template)
      ? template
      : [createPreviewInspectorRequiredPathCollectionItem()];
  }
  const smartSeed = arguments.length >= 3
    ? readPreviewInspectorRequiredPathSeed(seedValue, path)
    : undefined;
  const smartMinimum = arguments.length >= 3;
  let root = template;
  const indexedRoot = /^\d+$/u.test(path[0]);
  if (root === null || typeof root !== 'object') root = indexedRoot ? [] : {};
  if (Array.isArray(root) !== indexedRoot) return root;
  let current = root;
  for (const [index, propertyName] of path.entries()) {
    if (blockedInspectorPropNames.has(propertyName)) return root;
    const atLeaf = index === path.length - 1;
    if (atLeaf) {
      if (stringReceiver) {
        if (typeof current[propertyName] !== 'string') {
          current[propertyName] = typeof smartSeed === 'string' && smartSeed.length > 0
            ? smartSeed
            : createPreviewInspectorRequiredPathKeyText(propertyName);
        }
        break;
      }
      if (collection) {
        /*
         * Exact method-call evidence is stronger than a neutral object emitted by a Context,
         * Redux, or GraphQL fallback. One small row keeps list UI visible while every intrinsic
         * collection method remains available through the real Array prototype.
         */
        if (!Array.isArray(current[propertyName])) {
          current[propertyName] = [createPreviewInspectorRequiredPathCollectionItem()];
        }
        break;
      }
      /*
       * A direct null leaf is commonly an authored neutral sentinel such as fallback: null,
       * error: null, or selectedItem: null. Turning it into a truthy lorem value can activate
       * the very fallback/guard branch the preview is trying to avoid. Missing and undefined
       * leaves remain eligible for generation; a null intermediate container is still replaced
       * above when a deeper demanded path proves that an object or array is required.
       */
      if (!Object.hasOwn(current, propertyName) || current[propertyName] === undefined) {
        current[propertyName] = smartMinimum
          ? createPreviewInspectorRequiredPathSmartLeaf(propertyName, callable, smartSeed)
          : createPreviewInspectorRequiredPathLeaf(propertyName, callable);
      }
      break;
    }
    const nextName = path[index + 1] ?? '';
    const expectsArray = /^\d+$/u.test(nextName);
    if (
      current[propertyName] === null ||
      typeof current[propertyName] !== 'object' ||
      (expectsArray && !Array.isArray(current[propertyName]))
    ) {
      /*
       * An array-item marker is structural evidence, not an ordinary numeric object key. Repair
       * copied object placeholders here so later completion receives a real Array shape rather
       * than an object such as { "0": { id: ... } } whose filter/map methods are absent. An
       * existing Array remains valid for non-index descendants such as items.length and must not
       * be narrowed back to an object merely because the next segment is a named property.
       */
      current[propertyName] = expectsArray ? [] : {};
    }
    current = current[propertyName];
  }
  return root;
}

/** Creates the smallest JSON root compatible with the inferred hook result's observable type. */
function createPreviewInspectorRuntimeFallbackSmartRoot(value, requiredPaths) {
  const firstPath = normalizePreviewInspectorRequiredPropertyPaths(requiredPaths)
    .map(parsePreviewInspectorRequiredPath)
    .find((path) => path !== undefined);
  if (firstPath !== undefined) {
    if (firstPath.stringReceiver && firstPath.path.length === 0) {
      if (hasPreviewInspectorRequiredPathCallableMember(value, firstPath.methodName)) {
        return copyPreviewInspectorBlockerValueForJson(value, { nodes: 0 }) ?? {};
      }
      return typeof value === 'string' && value.length > 0 ? value : 'value';
    }
    return (firstPath.collection && firstPath.path.length === 0) || /^\d+$/u.test(firstPath.path[0])
      ? []
      : {};
  }
  const copied = copyPreviewInspectorBlockerValueForJson(value, { nodes: 0 });
  return copied === null || copied === undefined ? {} : copied;
}

/** Builds JSON containing only compiler-observed demanded paths and one semantic value per leaf. */
function createPreviewInspectorRuntimeFallbackSmartDraftTemplate(value, requiredPaths) {
  const paths = normalizePreviewInspectorRequiredPropertyPaths(requiredPaths)
    .filter((path) => path !== '<root>');
  let template = createPreviewInspectorRuntimeFallbackSmartRoot(value, paths);
  for (const path of paths) template = materializePreviewInspectorRequiredPath(template, path, value);
  return copyPreviewInspectorBlockerValueForJson(template, { nodes: 0 });
}

/** Converts a minimum Smart-fill JSON template into the inert runtime value consumed by project code. */
function createPreviewInspectorRuntimeFallbackSmartValue(value, requiredPaths) {
  return materializePreviewInspectorRuntimeFallbackOverride(
    createPreviewInspectorRuntimeFallbackSmartDraftTemplate(value, requiredPaths),
  );
}

/** Builds a required-path overlay while retaining compiler values already present at a demanded leaf. */
function createPreviewInspectorRuntimeFallbackRequirementTemplate(value, requiredPaths) {
  let template = copyPreviewInspectorBlockerValueForJson(value, { nodes: 0 });
  for (const path of normalizePreviewInspectorRequiredPropertyPaths(requiredPaths)) {
    template = materializePreviewInspectorRequiredPath(template, path);
  }
  return materializePreviewInspectorRuntimeFallbackOverride(template);
}

/** Adds missing required leaves to a compiler value without replacing authored non-nullish data. */
function createPreviewInspectorRuntimeFallbackAutoValue(value, requiredPaths) {
  const materializedPaths = normalizePreviewInspectorRequiredPropertyPaths(requiredPaths)
    .filter((path) => path !== '<root>');
  if (materializedPaths.length === 0) return value;
  const requirement = createPreviewInspectorRuntimeFallbackRequirementTemplate(value, materializedPaths);
  if (requirement === undefined) return value;
  /*
   * A compiler fallback's scalar kind remains authoritative: numeric reads can be valid on text,
   * and inconsistent test/user metadata must not coerce that scalar into a collection. Plain
   * records are the Context/Redux placeholder case where item/method evidence safely proves that
   * the copied template must repair an incompatible container.
   */
  const completion = completePreviewInspectorGeneratedValue(
    value,
    requirement,
    isPreviewInspectorGeneratedPlainRecord(value)
      ? { requiredPaths: materializedPaths }
      : undefined,
  );
  return completion.changed ? completion.value : value;
}

/** Produces the non-empty, editable JSON template displayed for one isolated hook edge. */
function createPreviewInspectorRuntimeFallbackDraftTemplate(value, requiredPaths) {
  const autoValue = createPreviewInspectorRuntimeFallbackAutoValue(value, requiredPaths);
  return copyPreviewInspectorBlockerValueForJson(autoValue, { nodes: 0 });
}

/** Restores synthetic callbacks/components only where editable JSON enters project code. */
function materializePreviewInspectorRuntimeFallbackOverride(value, depth = 0) {
  if (value === PREVIEW_INSPECTOR_NOOP_VALUE_SENTINEL) return Object.freeze(() => undefined);
  if (value === PREVIEW_INSPECTOR_COMPONENT_VALUE_SENTINEL) {
    const component = function PreviewInspectorComponentPlaceholder() { return null; };
    Object.defineProperty(component, PREVIEW_INSPECTOR_COMPONENT_MARKER, { value: true });
    return Object.freeze(component);
  }
  if (depth > PREVIEW_INSPECTOR_BLOCKER_VALUE_DEPTH_LIMIT || value === null || typeof value !== 'object') {
    return value;
  }
  if (Array.isArray(value)) {
    /*
     * Generated completion proxies can legally shadow a property named map. Calling the value's
     * method would then fail even though Array.isArray correctly identified the container. Invoke
     * the intrinsic without consulting project- or proxy-owned properties.
     */
    return Array.prototype.map.call(
      value,
      (child) => materializePreviewInspectorRuntimeFallbackOverride(child, depth + 1),
    );
  }
  const result = {};
  for (const [propertyName, child] of Object.entries(value)) {
    if (blockedInspectorPropNames.has(propertyName)) continue;
    result[propertyName] = materializePreviewInspectorRuntimeFallbackOverride(child, depth + 1);
  }
  return result;
}
`;
}
