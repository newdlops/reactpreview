/**
 * Generates the browser-only React Redux compatibility boundary used by previews.
 * The boundary supplies a stable plain state object and inert dispatch semantics; it never imports
 * application reducers, executes store bootstrap, or invents nested state values that could select
 * an unsafe application branch.
 */

/** Resolved project module required to build the optional Redux preview boundary. */
export interface PreviewReduxRuntimeSourceOptions {
  /** Absolute browser-resolved entry for the target project's react-redux package. */
  readonly reactReduxModulePath: string;
}

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
  return `
import * as React from 'react';
import * as ReactRedux from ${encodedModulePath};

const EMPTY_STATIC_STATE = Object.freeze({});

/** Reads an exact setup-owned state value or returns the neutral plain-object root. */
function readStaticState(configuration) {
  if (
    configuration !== null &&
    typeof configuration === 'object' &&
    Object.prototype.hasOwnProperty.call(configuration, 'state')
  ) {
    return configuration.state;
  }
  return EMPTY_STATIC_STATE;
}

/**
 * Creates the small synchronous store surface required by Provider, hooks, and connected views.
 * Dispatch returns the original action but deliberately does not mutate state or notify listeners.
 */
function createStaticStore(state) {
  const listeners = new Set();
  return {
    dispatch(action) {
      return action;
    },
    getState() {
      return state;
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
  if (configuration === false || typeof Provider !== 'function') {
    return children;
  }
  return React.createElement(
    Provider,
    { store: createStaticStore(readStaticState(configuration)) },
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
