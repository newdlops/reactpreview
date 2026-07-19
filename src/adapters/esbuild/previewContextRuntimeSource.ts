/**
 * Generates the browser-only runtime for automatic application-defined React Context boundaries.
 * Reached project modules register exact hook/Context identities and frozen demand-shaped fallback
 * objects; this runtime merges only structural containers and inert callable leaves. It never imports
 * or executes an authored Provider component, store, application bootstrap, or backend client.
 */

/** Exact project-owned React entry required by one generated Context runtime module. */
export interface PreviewContextRuntimeSourceOptions {
  /** Absolute browser-resolved React entry used by the target project's own module graph. */
  readonly reactModulePath: string;
}

/**
 * Creates a virtual module that composes raw React Context providers around the preview tree.
 *
 * Registrations are intentionally evaluated before React mounts the target. A small
 * `useSyncExternalStore` boundary also subscribes to later registrations from lazy chunks, so a
 * newly evaluated component graph can gain its statically inferred Context without remounting the
 * surrounding webview document. Provider values contain no invented primitive state: they consist
 * only of proven plain object containers and extension-owned no-op callable leaves.
 *
 * @param options Project-owned React module selected through esbuild's browser resolver.
 * @returns JavaScript source loaded in the private Context bridge namespace.
 */
export function createPreviewContextRuntimeSource(
  options: PreviewContextRuntimeSourceOptions,
): string {
  const encodedReactModulePath = JSON.stringify(normalizeImportPath(options.reactModulePath));
  return `
import * as ReactModule from ${encodedReactModulePath};

const BLOCKED_PROPERTY_NAMES = new Set(['__proto__', 'constructor', 'prototype']);
const MAX_CONTEXT_IDENTITIES = 128;
const MAX_FALLBACK_DEPTH = 16;
const MAX_FALLBACK_NODES = 512;
const MAX_HOOK_REQUIREMENTS = 512;
const MAX_PROPERTY_NAME_LENGTH = 128;
const MAX_SUBSCRIBERS = 128;
const REACT_CONTEXT_TYPE = Symbol.for('react.context');
const REACT_PROVIDER_TYPE = Symbol.for('react.provider');
const STATIC_NOOP = Object.freeze(() => undefined);
const ARRAY_METHOD_NAMES = new Set([
  'at', 'concat', 'every', 'filter', 'find', 'findIndex', 'flat', 'flatMap', 'forEach',
  'includes', 'indexOf', 'join', 'lastIndexOf', 'map', 'reduce', 'reduceRight', 'slice',
  'some', 'sort',
]);
const ambiguousHooks = new Set();
const identityByHook = new Map();
const requirementsByHook = new Map();
const subscribers = new Set();
let cachedInventory;
let cachedInventoryRevision = -1;
let registrationRevision = 0;
let requirementCount = 0;
let previewRuntimeStatus =
  'available: static project Context subscription boundary has not rendered yet';

const createElement = ReactModule.createElement ?? ReactModule.default?.createElement;
const useSyncExternalStore =
  ReactModule.useSyncExternalStore ?? ReactModule.default?.useSyncExternalStore;

/** Reads an own data property without invoking a project-defined getter. */
function readOwnDataProperty(value, propertyName) {
  if ((typeof value !== 'object' && typeof value !== 'function') || value === null) {
    return undefined;
  }
  try {
    const descriptor = Object.getOwnPropertyDescriptor(value, propertyName);
    return descriptor !== undefined && Object.prototype.hasOwnProperty.call(descriptor, 'value')
      ? descriptor.value
      : undefined;
  } catch {
    return undefined;
  }
}

/**
 * Returns the raw React-owned Provider token for an exact Context object.
 *
 * React 18 exposes a react.provider object whose _context points back to the Context. React 19
 * exposes the Context itself as its Provider. Functions are deliberately rejected: accepting a
 * conventionally named application component here would execute authored provider logic.
 */
function readRawContextProvider(context) {
  if (readOwnDataProperty(context, '$$typeof') !== REACT_CONTEXT_TYPE) {
    return undefined;
  }
  const provider = readOwnDataProperty(context, 'Provider');
  if (provider === context) {
    return context;
  }
  return provider !== null && typeof provider === 'object' &&
    readOwnDataProperty(provider, '$$typeof') === REACT_PROVIDER_TYPE &&
    readOwnDataProperty(provider, '_context') === context
    ? provider
    : undefined;
}

/**
 * Preserves an authored or type-guided non-nullish Context default instead of shadowing it with an
 * outer structural value. React 18 and 19 retain the primary/secondary renderer defaults as own
 * data properties; an unknown future shape fails open to the normal registration validation.
 */
function hasNonNullishContextDefault(context) {
  const primaryValue = readOwnDataProperty(context, '_currentValue');
  const secondaryValue = readOwnDataProperty(context, '_currentValue2');
  return primaryValue !== null && primaryValue !== undefined ||
    secondaryValue !== null && secondaryValue !== undefined;
}

/** Publishes one monotonic registry revision while isolating subscriber failures. */
function publishRegistrationChange() {
  registrationRevision += 1;
  cachedInventory = undefined;
  for (const subscriber of [...subscribers]) {
    try {
      subscriber();
    } catch {
      // A project renderer subscriber cannot prevent later Context registrations from completing.
    }
  }
}

/** Returns the scalar snapshot consumed by React's external-store consistency checks. */
function readRegistrationRevision() {
  return registrationRevision;
}

/** Subscribes one React boundary to later lazy-module registrations. */
function subscribeToContextRegistrations(subscriber) {
  if (typeof subscriber !== 'function' || subscribers.size >= MAX_SUBSCRIBERS) {
    return () => undefined;
  }
  subscribers.add(subscriber);
  return () => subscribers.delete(subscriber);
}

/** Reports whether a property name is bounded and immune to prototype mutation. */
function isSafePropertyName(propertyName) {
  return typeof propertyName === 'string' &&
    propertyName.length > 0 &&
    propertyName.length <= MAX_PROPERTY_NAME_LENGTH &&
    !BLOCKED_PROPERTY_NAMES.has(propertyName);
}

/**
 * Converts a deeply frozen fallback into a non-executable structural shape.
 * Input functions are represented only as a callable marker and are never retained or invoked; the
 * materialized provider value uses the extension-owned STATIC_NOOP instead.
 */
function readFallbackShape(value, budget, activeValues, depth) {
  if (depth > MAX_FALLBACK_DEPTH || budget.nodes >= MAX_FALLBACK_NODES) {
    return undefined;
  }
  budget.nodes += 1;

  if (typeof value === 'function') {
    try {
      return Object.isFrozen(value) && Object.keys(value).length === 0
        ? { children: undefined, kind: 'callable' }
        : undefined;
    } catch {
      return undefined;
    }
  }
  if (value === null || typeof value !== 'object' || activeValues.has(value)) {
    return undefined;
  }

  let descriptors;
  try {
    const prototype = Object.getPrototypeOf(value);
    if (
      (prototype !== Object.prototype && prototype !== null) ||
      !Object.isFrozen(value)
    ) {
      return undefined;
    }
    descriptors = Object.getOwnPropertyDescriptors(value);
  } catch {
    return undefined;
  }

  activeValues.add(value);
  const children = new Map();
  const descriptorKeys = Reflect.ownKeys(descriptors);
  for (const propertyName of descriptorKeys) {
    if (typeof propertyName !== 'string' || !isSafePropertyName(propertyName)) {
      activeValues.delete(value);
      return undefined;
    }
    const descriptor = descriptors[propertyName];
    if (
      descriptor === undefined ||
      descriptor.enumerable !== true ||
      !Object.prototype.hasOwnProperty.call(descriptor, 'value')
    ) {
      activeValues.delete(value);
      return undefined;
    }
    const child = readFallbackShape(descriptor.value, budget, activeValues, depth + 1);
    if (child === undefined) {
      activeValues.delete(value);
      return undefined;
    }
    children.set(propertyName, child);
  }
  activeValues.delete(value);
  return { children, kind: 'object' };
}

/** Creates a deterministic structural identity used to ignore duplicate module registrations. */
function serializeFallbackShape(shape) {
  if (shape.kind === 'callable') {
    return 'callable';
  }
  const entries = [...shape.children.entries()].sort(([left], [right]) =>
    left.localeCompare(right),
  );
  return 'object{' + entries
    .map(([propertyName, child]) => JSON.stringify(propertyName) + ':' + serializeFallbackShape(child))
    .join(',') + '}';
}

/** Clones one internal shape before it becomes the mutable destination of a merge. */
function cloneFallbackShape(shape) {
  if (shape.kind === 'callable') {
    return { children: undefined, kind: 'callable' };
  }
  const children = new Map();
  for (const [propertyName, child] of shape.children) {
    children.set(propertyName, cloneFallbackShape(child));
  }
  return { children, kind: 'object' };
}

/** Merges object containers and callable leaves, rejecting any kind conflict at an exact path. */
function mergeFallbackShape(destination, source) {
  if (destination.kind !== source.kind) {
    return false;
  }
  if (destination.kind === 'callable') {
    return true;
  }
  for (const [propertyName, sourceChild] of source.children) {
    const destinationChild = destination.children.get(propertyName);
    if (destinationChild === undefined) {
      destination.children.set(propertyName, cloneFallbackShape(sourceChild));
    } else if (!mergeFallbackShape(destinationChild, sourceChild)) {
      return false;
    }
  }
  return true;
}

/**
 * Detects structural array evidence emitted when project code calls a built-in array method.
 *
 * The source analyzer deliberately records only receiver shape, so a requirement initially looks
 * like an object containing a companies.map member. Returning that object makes a later reached
 * companies.filter call fail even though both sites prove the same unique container kind. An empty
 * frozen array implements every non-mutating method while retaining the render-only neutral value.
 */
function isArrayMethodShape(shape) {
  if (shape.kind !== 'object' || shape.children.size === 0) return false;
  for (const [propertyName, child] of shape.children) {
    if (ARRAY_METHOD_NAMES.has(propertyName) && child.kind === 'callable') return true;
  }
  return false;
}

/** Materializes a stable, deeply frozen structural value without preserving project callbacks. */
function materializeFallbackShape(shape) {
  if (shape.kind === 'callable') {
    return STATIC_NOOP;
  }
  if (isArrayMethodShape(shape)) {
    return Object.freeze([]);
  }
  const value = {};
  const children = [...shape.children.entries()].sort(([left], [right]) =>
    left.localeCompare(right),
  );
  for (const [propertyName, child] of children) {
    value[propertyName] = materializeFallbackShape(child);
  }
  return Object.freeze(value);
}

/**
 * Associates one exact imported hook function with the raw Context it returns.
 * Re-registering the same pair is idempotent; a hook mapped to two Context identities becomes
 * permanently ambiguous and contributes no automatic provider.
 */
export function registerPreviewContextIdentity(hook, context) {
  if (typeof hook !== 'function' || readRawContextProvider(context) === undefined) {
    return;
  }
  if (ambiguousHooks.has(hook)) {
    return;
  }
  const currentContext = identityByHook.get(hook);
  if (currentContext === context) {
    return;
  }
  if (currentContext !== undefined) {
    identityByHook.delete(hook);
    ambiguousHooks.add(hook);
    publishRegistrationChange();
    return;
  }
  if (identityByHook.size + ambiguousHooks.size >= MAX_CONTEXT_IDENTITIES) {
    return;
  }
  identityByHook.set(hook, context);
  publishRegistrationChange();
}

/**
 * Records one frozen demand-shaped fallback for an imported custom Context hook.
 * Primitive leaves, arrays, class instances, accessors, unfrozen containers, cycles, unsafe keys,
 * and excessive shapes are ignored. The accepted structure is copied before later composition.
 */
export function registerPreviewContextRequirement(hook, fallback) {
  if (typeof hook !== 'function' || requirementCount >= MAX_HOOK_REQUIREMENTS) {
    return;
  }
  const shape = readFallbackShape(fallback, { nodes: 0 }, new Set(), 0);
  if (shape === undefined || shape.kind !== 'object') {
    return;
  }
  const signature = serializeFallbackShape(shape);
  let hookRequirements = requirementsByHook.get(hook);
  if (hookRequirements === undefined) {
    hookRequirements = new Map();
    requirementsByHook.set(hook, hookRequirements);
  }
  if (hookRequirements.has(signature)) {
    return;
  }
  hookRequirements.set(signature, shape);
  requirementCount += 1;
  publishRegistrationChange();
}

/** Builds stable provider values once for each registration revision. */
function readProviderInventory() {
  if (cachedInventory !== undefined && cachedInventoryRevision === registrationRevision) {
    return cachedInventory;
  }

  const shapeByContext = new Map();
  const conflictingContexts = new Set();
  const defaultedContexts = new Set();
  let pendingHookCount = 0;
  for (const [hook, hookRequirements] of requirementsByHook) {
    if (ambiguousHooks.has(hook)) {
      continue;
    }
    const context = identityByHook.get(hook);
    if (context === undefined) {
      pendingHookCount += 1;
      continue;
    }
    if (hasNonNullishContextDefault(context)) {
      defaultedContexts.add(context);
      continue;
    }
    if (conflictingContexts.has(context)) {
      continue;
    }
    let mergedShape = shapeByContext.get(context);
    for (const shape of hookRequirements.values()) {
      if (mergedShape === undefined) {
        mergedShape = cloneFallbackShape(shape);
        shapeByContext.set(context, mergedShape);
      } else if (!mergeFallbackShape(mergedShape, shape)) {
        shapeByContext.delete(context);
        conflictingContexts.add(context);
        break;
      }
    }
  }

  const providers = [];
  for (const [context, shape] of shapeByContext) {
    const Provider = readRawContextProvider(context);
    if (Provider !== undefined && shape.kind === 'object') {
      providers.push({ Provider, value: materializeFallbackShape(shape) });
    }
  }
  cachedInventory = Object.freeze({
    ambiguousHookCount: ambiguousHooks.size,
    conflictCount: conflictingContexts.size,
    defaultedContextCount: defaultedContexts.size,
    pendingHookCount,
    providers: Object.freeze(providers),
  });
  cachedInventoryRevision = registrationRevision;
  return cachedInventory;
}

/** Updates the diagnostic string after each subscription-boundary render. */
function updatePreviewRuntimeStatus(inventory) {
  const providerCount = inventory.providers.length;
  const omissions = [];
  if (inventory.conflictCount > 0) {
    omissions.push(String(inventory.conflictCount) + ' conflicting Context shape(s) omitted');
  }
  if (inventory.ambiguousHookCount > 0) {
    omissions.push(String(inventory.ambiguousHookCount) + ' ambiguous hook identity(s) omitted');
  }
  if (inventory.pendingHookCount > 0) {
    omissions.push(String(inventory.pendingHookCount) + ' hook requirement(s) awaiting Context identity');
  }
  if (inventory.defaultedContextCount > 0) {
    omissions.push(
      String(inventory.defaultedContextCount) +
      ' Context requirement(s) preserved an existing non-nullish default',
    );
  }
  if (providerCount === 0) {
    previewRuntimeStatus = omissions.length === 0
      ? 'inactive: no valid project Context requirements were registered'
      : 'inactive: ' + omissions.join('; ');
    return;
  }
  previewRuntimeStatus =
    'active: ' + String(providerCount) +
    ' static project Context provider(s) with demand-shaped neutral values' +
    (omissions.length === 0 ? '' : '; ' + omissions.join('; '));
}

/**
 * React component that subscribes before reading and composing the current provider inventory.
 * Provider order is deterministic by first reached Context identity; Contexts do not depend on one
 * another because this boundary supplies raw values rather than executing authored components.
 */
function PreviewContextSubscriptionBoundary({ children }) {
  useSyncExternalStore(
    subscribeToContextRegistrations,
    readRegistrationRevision,
    readRegistrationRevision,
  );
  const inventory = readProviderInventory();
  updatePreviewRuntimeStatus(inventory);
  let previewElement = children;
  for (let index = inventory.providers.length - 1; index >= 0; index -= 1) {
    const provider = inventory.providers[index];
    previewElement = createElement(provider.Provider, { value: provider.value }, previewElement);
  }
  return previewElement;
}

/**
 * Adds the lazy-registration-aware Context boundary around one already composed preview tree.
 * The boundary is retained even before requirements exist because a later React.lazy chunk may
 * register the first Context after the initial root has committed.
 */
export function createContextPreviewElement(children) {
  if (typeof createElement !== 'function' || typeof useSyncExternalStore !== 'function') {
    previewRuntimeStatus =
      'unavailable: project React does not expose createElement and useSyncExternalStore';
    return children;
  }
  return createElement(PreviewContextSubscriptionBoundary, null, children);
}

/** Returns the latest automatic Context decision for the preview runtime error report. */
export function readPreviewRuntimeStatus() {
  return previewRuntimeStatus;
}
`;
}

/** Normalizes Windows separators before embedding an absolute ESM import specifier. */
function normalizeImportPath(modulePath: string): string {
  return modulePath.replaceAll('\\', '/');
}
