/**
 * Generates the browser-only React Redux compatibility boundary used by previews.
 * The boundary supplies stable plain state and inert dispatch semantics. It never imports reducers
 * or executes store bootstrap; optional nested values come only from bounded selector syntax and
 * use falsey neutral leaves so the preview does not opt into privileged application branches.
 * Date-named leaves are the exception: they hold the canonical sample date, placed here on the
 * preview's current day like every other generated date.
 */
import {
  createPreviewSampleDateApiExpression,
  PREVIEW_CANONICAL_SAMPLE_EPOCH_MILLIS,
  PREVIEW_CANONICAL_SAMPLE_MONTH,
  PREVIEW_CANONICAL_SAMPLE_YEAR,
  PREVIEW_SAMPLE_MONTH_NAME_PATTERN,
  PREVIEW_SAMPLE_YEAR_NAME_PATTERN,
} from './previewSampleDateRuntimeSource';

/** Global through which generated page-execution modules reach the Redux overlay boundary. */
export const PREVIEW_REDUX_OVERLAY_ELEMENT_KEY =
  'newdlops.react-file-preview.redux-overlay-element';

/** Resolved project module required to build the optional Redux preview boundary. */
export interface PreviewReduxRuntimeSourceOptions {
  /** Syntax-derived neutral state for selector paths reached from the active target graph. */
  readonly automaticState?: PreviewReduxStaticState;
  /** Absent-receiver fields shown over an application's own store where it has no value. */
  readonly absentReceiverOverlay?: PreviewReduxStaticState;
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
  const encodedOverlay = JSON.stringify(options.absentReceiverOverlay ?? {});
  return `
import * as React from 'react';
import * as ReactRedux from ${encodedModulePath};

const BLOCKED_STATE_KEYS = new Set(['__proto__', 'constructor', 'prototype']);
const EMPTY_STATIC_STATE = Object.freeze({});
const previewReduxSampleDates = ${createPreviewSampleDateApiExpression()};
const HOST_AUTOMATIC_STATE = freezeStaticValue(
  rebaseStaticSampleDates(${encodedAutomaticState}, 0),
);
const MAX_REGISTERED_PATHS = 256;
const MAX_STATE_PATH_DEPTH = 16;
const MAX_STATE_KEY_LENGTH = 128;
const registeredStatePaths = new Map();
let cachedAutomaticState = HOST_AUTOMATIC_STATE;
let previewRuntimeStatus = 'available: static Redux provider has not been composed yet';
const ABSENT_RECEIVER_OVERLAY = freezeStaticValue(rebaseStaticSampleDates(${encodedOverlay}, 0));
const HAS_ABSENT_RECEIVER_OVERLAY = Object.keys(ABSENT_RECEIVER_OVERLAY).length > 0;
const STATIC_STORE_MARK = Symbol('react-preview static Redux store');
const OVERLAY_STORE_MARK = Symbol('react-preview Redux overlay store');
const ReduxContext = ReactRedux.ReactReduxContext ?? ReactRedux.default?.ReactReduxContext;
let previewOverlayStatus = HAS_ABSENT_RECEIVER_OVERLAY
  ? 'available: no page has been mounted yet'
  : 'inactive: no absent receiver fields';

/**
 * Moves canonical sample dates (ISO text or epoch milliseconds) onto the current day. Numbers are
 * otherwise matched by value alone; a year or month leaf is the one place a number is rebased by its
 * key, because only the key tells the canonical year or month apart from an ordinary count.
 */
function rebaseStaticSampleDates(value, depth) {
  if (typeof value === 'string') return previewReduxSampleDates.rebase(value);
  if (value === ${String(PREVIEW_CANONICAL_SAMPLE_EPOCH_MILLIS)}) {
    return Date.parse(previewReduxSampleDates.dateTime(0));
  }
  if (value === null || typeof value !== 'object' || depth > 16) return value;
  if (Array.isArray(value)) return value.map((item) => rebaseStaticSampleDates(item, depth + 1));
  const result = {};
  for (const [key, nestedValue] of Object.entries(value)) {
    if (BLOCKED_STATE_KEYS.has(key)) continue;
    result[key] = rebaseStaticSampleDatePart(key, nestedValue) ?? rebaseStaticSampleDates(nestedValue, depth + 1);
  }
  return result;
}

/** Moves the canonical day's year or month to the sample-date API's current calendar. */
function rebaseStaticSampleDatePart(key, value) {
  if (value === ${String(PREVIEW_CANONICAL_SAMPLE_YEAR)} && ${String(PREVIEW_SAMPLE_YEAR_NAME_PATTERN)}.test(key)) {
    return previewReduxSampleDates.base().getFullYear();
  }
  if (value === ${String(PREVIEW_CANONICAL_SAMPLE_MONTH)} && ${String(PREVIEW_SAMPLE_MONTH_NAME_PATTERN)}.test(key)) {
    return previewReduxSampleDates.base().getMonth() + 1;
  }
  return undefined;
}

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
    [STATIC_STORE_MARK]: true,
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

/** Recognizes a plain state object; class instances and immutable collections are left alone. */
function isPlainStateObject(value) {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

/** Fills only paths the application state leaves undefined; untouched subtrees keep identity. */
function fillAbsentStatePaths(value, overlay, depth) {
  if (!isPlainStateObject(value) || !isPlainStateObject(overlay) || depth > MAX_STATE_PATH_DEPTH) {
    return value;
  }
  let result = value;
  for (const [key, overlayValue] of Object.entries(overlay)) {
    if (BLOCKED_STATE_KEYS.has(key)) continue;
    const current = value[key];
    const next =
      current === undefined ? overlayValue : fillAbsentStatePaths(current, overlayValue, depth + 1);
    if (next !== current) {
      if (result === value) result = { ...value };
      result[key] = next;
    }
  }
  return result;
}

/**
 * Wraps an application store so reads see absent-receiver fields where the real state has none.
 * One filled object is kept per real state object, so useSelector snapshots and Reselect inputs stay
 * stable; dispatch, subscription, and reducer replacement go to the real store unchanged.
 */
function createOverlayStore(store) {
  const filled = new WeakMap();
  const overlayStore = {
    [OVERLAY_STORE_MARK]: true,
    dispatch: (action) => store.dispatch(action),
    getState() {
      const state = store.getState();
      if (state === null || typeof state !== 'object') return state;
      let result = filled.get(state);
      if (result === undefined) {
        result = fillAbsentStatePaths(state, ABSENT_RECEIVER_OVERLAY, 0);
        filled.set(state, result);
      }
      return result;
    },
    replaceReducer: (nextReducer) => store.replaceReducer?.(nextReducer),
    subscribe: (listener) => store.subscribe(listener),
  };
  const observableKey = typeof Symbol.observable === 'symbol' ? Symbol.observable : '@@observable';
  if (typeof store[observableKey] === 'function') {
    overlayStore[observableKey] = () => store[observableKey]();
  }
  return overlayStore;
}

/**
 * Re-provides the nearest application store with absent-receiver fields filled for reads. The
 * preview's own static store already holds those fields, and an outer boundary's overlay store is
 * passed through, so only the boundary right below an application Provider takes effect.
 */
function PreviewReduxOverlayBoundary({ children }) {
  const Provider = ReactRedux.Provider ?? ReactRedux.default?.Provider;
  const context = ReduxContext === undefined ? undefined : React.useContext(ReduxContext);
  const store = context?.store;
  const isApplicationStore =
    store !== null &&
    typeof store?.getState === 'function' &&
    store[STATIC_STORE_MARK] !== true &&
    store[OVERLAY_STORE_MARK] !== true;
  const overlayStore = React.useMemo(
    () => (isApplicationStore ? createOverlayStore(store) : undefined),
    [isApplicationStore, store],
  );
  if (overlayStore !== undefined) {
    previewOverlayStatus = 'active: absent receiver fields shown over the application store';
  } else if (store?.[OVERLAY_STORE_MARK] !== true) {
    previewOverlayStatus =
      store?.[STATIC_STORE_MARK] === true
        ? 'inactive: the page reads the preview static store'
        : 'inactive: no application Provider above the page';
  }
  return overlayStore === undefined || typeof Provider !== 'function'
    ? children
    : React.createElement(Provider, { store: overlayStore }, children);
}

/**
 * Places one page-execution child below an overlay boundary when absent-receiver fields exist;
 * otherwise returns the element itself, so pages without such fields keep their exact tree.
 */
export function wrapPreviewReduxOverlayElement(element) {
  return HAS_ABSENT_RECEIVER_OVERLAY
    ? React.createElement(PreviewReduxOverlayBoundary, null, element)
    : element;
}
// Page-execution modules are built without importing this bridge, so they read it from here.
globalThis[Symbol.for(${JSON.stringify(PREVIEW_REDUX_OVERLAY_ELEMENT_KEY)})] = wrapPreviewReduxOverlayElement;

/** Describes whether the latest page read its application store through the overlay. */
export function readPreviewReduxOverlayStatus() {
  return previewOverlayStatus;
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
