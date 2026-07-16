/**
 * Generates the browser-only React Redux compatibility boundary used by previews.
 * The boundary supplies stable plain state and inert dispatch semantics. It never imports reducers
 * or executes store bootstrap; optional nested values come only from bounded selector syntax and
 * use falsey neutral leaves so the preview does not opt into privileged application branches.
 */

/** Resolved project module required to build the optional Redux preview boundary. */
export interface PreviewReduxRuntimeSourceOptions {
  /** Syntax-derived neutral state for selector paths reached from the active target graph. */
  readonly automaticState?: PreviewReduxStaticState;
  /** Absolute browser-resolved entry for the target project's react-redux package. */
  readonly reactReduxModulePath: string;
}

/** JSON-compatible primitive admitted into host-generated read-only Redux preview state. */
export type PreviewReduxStaticPrimitive = boolean | number | string | null;

/** Recursive JSON-compatible object accepted from bounded, non-evaluating state analysis. */
export interface PreviewReduxStaticObject {
  /** JSON-compatible child keyed by one statically proven state property. */
  readonly [key: string]: PreviewReduxStaticValue;
}

/** Recursive JSON-compatible value accepted from bounded, non-evaluating state analysis. */
export type PreviewReduxStaticValue =
  PreviewReduxStaticPrimitive | readonly PreviewReduxStaticValue[] | PreviewReduxStaticObject;

/** Plain root object supplied only when reachable selector syntax proves required state paths. */
export type PreviewReduxStaticState = Readonly<PreviewReduxStaticObject>;

/**
 * Creates the source for a project-owned Provider and minimal read-only-compatible store.
 * The store implements the public methods React Redux consumes while leaving state unchanged when
 * a component dispatches. Setup may provide exact static state without supplying a reducer.
 *
 * @param options Project-owned react-redux module selected through esbuild resolution.
 * @returns JavaScript source loaded inside the private Redux bridge namespace.
 */
export function createPreviewReduxRuntimeSource(options: PreviewReduxRuntimeSourceOptions): string {
  const encodedModulePath = JSON.stringify(normalizeImportPath(options.reactReduxModulePath));
  const encodedAutomaticState = JSON.stringify(options.automaticState ?? {});
  return `
import * as React from 'react';
import * as ReactRedux from ${encodedModulePath};

const BLOCKED_STATE_KEYS = new Set(['__proto__', 'constructor', 'prototype']);
const EMPTY_STATIC_STATE = Object.freeze({});
const HOST_AUTOMATIC_STATE = freezeStaticValue(${encodedAutomaticState});
const MAX_REGISTERED_PATHS = 256;
const MAX_STATE_PATH_DEPTH = 16;
const MAX_STATE_KEY_LENGTH = 128;
const registeredStatePaths = new Map();
let cachedAutomaticState = HOST_AUTOMATIC_STATE;
let previewRuntimeStatus = 'available: static Redux provider has not been composed yet';

/** Recursively freezes host-generated JSON so target dispatch and mutation cannot change it. */
function freezeStaticValue(value) {
  if (value === null || typeof value !== 'object' || Object.isFrozen(value)) {
    return value;
  }
  for (const nestedValue of Object.values(value)) {
    freezeStaticValue(nestedValue);
  }
  return Object.freeze(value);
}

/** Clones trusted host state before target-reachable container paths are overlaid. */
function cloneStaticValue(value) {
  if (Array.isArray(value)) {
    return value.map(cloneStaticValue);
  }
  if (value === null || typeof value !== 'object') {
    return value;
  }
  const clone = {};
  for (const [key, nestedValue] of Object.entries(value)) {
    if (!BLOCKED_STATE_KEYS.has(key)) {
      clone[key] = cloneStaticValue(nestedValue);
    }
  }
  return clone;
}

/** Narrows untrusted generated registration data to a bounded prototype-safe property path. */
function readStaticStatePath(value) {
  if (!Array.isArray(value) || value.length === 0 || value.length > MAX_STATE_PATH_DEPTH) {
    return undefined;
  }
  const path = [];
  for (const key of value) {
    if (
      typeof key !== 'string' ||
      key.length === 0 ||
      key.length > MAX_STATE_KEY_LENGTH ||
      BLOCKED_STATE_KEYS.has(key)
    ) {
      return undefined;
    }
    path.push(key);
  }
  return path;
}

/**
 * Records object containers proven necessary by selector syntax in one reached target module.
 * Registrations contain no application values or executable reducers and are idempotent across
 * duplicate imports. Invalid or excessive evidence is ignored instead of weakening the boundary.
 */
export function registerPreviewReduxStateContainerPaths(paths) {
  if (!Array.isArray(paths)) {
    return;
  }
  let changed = false;
  for (const candidate of paths) {
    if (registeredStatePaths.size >= MAX_REGISTERED_PATHS) {
      break;
    }
    const path = readStaticStatePath(candidate);
    if (path === undefined) {
      continue;
    }
    const key = JSON.stringify(path);
    if (!registeredStatePaths.has(key)) {
      registeredStatePaths.set(key, path);
      changed = true;
    }
  }
  if (changed) {
    cachedAutomaticState = undefined;
  }
}

/** Builds and freezes the merged automatic state only after reached modules have registered. */
function readAutomaticStaticState() {
  if (cachedAutomaticState !== undefined) {
    return cachedAutomaticState;
  }
  const state = cloneStaticValue(HOST_AUTOMATIC_STATE);
  const orderedPaths = [...registeredStatePaths.values()].sort((left, right) =>
    left.length - right.length || JSON.stringify(left).localeCompare(JSON.stringify(right)),
  );
  for (const path of orderedPaths) {
    let container = state;
    for (const key of path) {
      const existing = container[key];
      if (
        existing === null ||
        typeof existing !== 'object' ||
        Array.isArray(existing)
      ) {
        container[key] = {};
      }
      container = container[key];
    }
  }
  cachedAutomaticState = freezeStaticValue(state);
  return cachedAutomaticState;
}

/** Returns the last automatic Redux decision for detailed preview runtime diagnostics. */
export function readPreviewRuntimeStatus() {
  return previewRuntimeStatus;
}

/** Reads exact setup state, then syntax-derived neutral state, then the empty root. */
function readStaticState(configuration) {
  if (
    configuration !== null &&
    typeof configuration === 'object' &&
    Object.prototype.hasOwnProperty.call(configuration, 'state')
  ) {
    return configuration.state;
  }
  const automaticState = readAutomaticStaticState();
  return Object.keys(automaticState).length > 0 ? automaticState : EMPTY_STATIC_STATE;
}

/**
 * Creates the small synchronous store surface required by Provider, hooks, and connected views.
 * Dispatch returns the original action but deliberately does not mutate state or notify listeners.
 */
function createStaticStore(configuration) {
  const listeners = new Set();
  return {
    dispatch(action) {
      return action;
    },
    getState() {
      return readStaticState(configuration);
    },
    replaceReducer(_nextReducer) {},
    subscribe(listener) {
      if (typeof listener !== 'function') {
        return () => {};
      }
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
  };
}

/**
 * Wraps a composed preview tree with the target project's React Redux Provider.
 * An inner application Provider retains normal nearest-context precedence. Exporting
 * reduxPreview=false disables the bridge; reduxPreview={ state } supplies exact static state.
 */
export function createReduxPreviewElement(children, options) {
  const configuration = options?.configuration;
  const Provider = ReactRedux.Provider ?? ReactRedux.default?.Provider;
  if (configuration === false) {
    previewRuntimeStatus = 'disabled by setup (reduxPreview=false)';
    return children;
  }
  if (typeof Provider !== 'function') {
    previewRuntimeStatus = 'unavailable: installed react-redux package has no Provider export';
    return children;
  }
  const hasConfiguredState =
    configuration !== null &&
    typeof configuration === 'object' &&
    Object.prototype.hasOwnProperty.call(configuration, 'state');
  const automaticState = readAutomaticStaticState();
  const hasAutomaticState = Object.keys(automaticState).length > 0;
  previewRuntimeStatus = hasConfiguredState
    ? 'active: read-only static store with setup-owned state'
    : hasAutomaticState
      ? 'active: read-only static store with target-inferred neutral state'
      : 'active: read-only static store with an empty object state root';
  return React.createElement(
    Provider,
    { store: createStaticStore(configuration) },
    children,
  );
}
`;
}

/**
 * Normalizes Windows separators before embedding an absolute path as an ESM import specifier.
 *
 * @param modulePath Absolute file path selected by esbuild's browser-aware resolver.
 * @returns Slash-separated import path safe to JSON-encode into generated JavaScript.
 */
function normalizeImportPath(modulePath: string): string {
  return modulePath.replaceAll('\\', '/');
}
