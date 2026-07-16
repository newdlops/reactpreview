/**
 * Generates the browser-only React Router boundary used by route-aware previews.
 * The generated module creates only a MemoryRouter with validated static locations; it never
 * imports application routes, touches browser history, starts a server, or performs network work.
 */

/** Resolved project module required to build the optional router preview boundary. */
export interface PreviewRouterRuntimeSourceOptions {
  /** Whether no target-reachable provider was found, allowing a default automatic wrapper. */
  readonly automaticallyWrap?: boolean;
  /** Absolute browser-resolved entry for the target project's react-router-dom package. */
  readonly reactRouterDomModulePath: string;
}

/**
 * Creates source for a project-owned MemoryRouter with a deliberately narrow setup contract.
 * Only short string entries and an in-range integer index cross the setup boundary, preventing
 * callbacks, mutable location state, or unexpectedly large histories from entering the preview.
 *
 * @param options Project-owned react-router-dom entry selected through esbuild resolution.
 * @returns JavaScript source loaded inside the private router bridge namespace.
 */
export function createPreviewRouterRuntimeSource(
  options: PreviewRouterRuntimeSourceOptions,
): string {
  const encodedModulePath = JSON.stringify(normalizeImportPath(options.reactRouterDomModulePath));
  const encodedAutomaticallyWrap = JSON.stringify(options.automaticallyWrap ?? true);
  return `
import * as React from 'react';
import * as ReactRouterDOM from ${encodedModulePath};

const DEFAULT_INITIAL_ENTRIES = Object.freeze(['/']);
const MAX_INITIAL_ENTRIES = 32;
const MAX_INITIAL_ENTRY_LENGTH = 2048;
const AUTOMATIC_ROUTER_BOUNDARY_ENABLED = ${encodedAutomaticallyWrap};
let previewRuntimeStatus = AUTOMATIC_ROUTER_BOUNDARY_ENABLED
  ? 'available: target graph requested a MemoryRouter boundary'
  : 'available: an existing target-reachable Router provider was detected';

/** Returns the last automatic Router decision for detailed preview runtime diagnostics. */
export function readPreviewRuntimeStatus() {
  return previewRuntimeStatus;
}

/** Reports whether setup supplied a plain configuration object. */
function isConfigurationRecord(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

/**
 * Copies a bounded string-only memory history or returns the immutable root-location fallback.
 * React Router also accepts location objects, but those can carry arbitrary state and are outside
 * this generic static preview contract.
 */
function readInitialEntries(configuration) {
  if (!isConfigurationRecord(configuration) || configuration.initialEntries === undefined) {
    return DEFAULT_INITIAL_ENTRIES;
  }
  const entries = configuration.initialEntries;
  if (!Array.isArray(entries) || entries.length === 0 || entries.length > MAX_INITIAL_ENTRIES) {
    return DEFAULT_INITIAL_ENTRIES;
  }
  if (
    entries.some(
      (entry) =>
        typeof entry !== 'string' ||
        entry.length === 0 ||
        entry.length > MAX_INITIAL_ENTRY_LENGTH,
    )
  ) {
    return DEFAULT_INITIAL_ENTRIES;
  }
  return entries.slice();
}

/** Returns an in-range static history index, omitting invalid or absent setup values. */
function readInitialIndex(configuration, entryCount) {
  if (!isConfigurationRecord(configuration)) {
    return undefined;
  }
  const initialIndex = configuration.initialIndex;
  return Number.isSafeInteger(initialIndex) && initialIndex >= 0 && initialIndex < entryCount
    ? initialIndex
    : undefined;
}

/** Selects the MemoryRouter component from ESM and CommonJS-compatible package namespaces. */
function readMemoryRouter() {
  return ReactRouterDOM.MemoryRouter ?? ReactRouterDOM.default?.MemoryRouter;
}

/**
 * Wraps a composed preview tree in the target project's MemoryRouter when that API is available.
 * An application-owned inner router keeps normal nearest-context precedence. Setup can export
 * routerPreview=false to opt out or provide bounded initialEntries and initialIndex values. An
 * Setup-owned router providers are detected across the actual source graph before this runtime is
 * enabled, so an unrelated custom or Storybook setup does not suppress a child component's hook.
 */
export function createRouterPreviewElement(children, options) {
  const configuration = options?.configuration;
  const MemoryRouter = readMemoryRouter();
  if (configuration === false) {
    previewRuntimeStatus = 'disabled by setup (routerPreview=false)';
    return children;
  }
  if (typeof MemoryRouter !== 'function') {
    previewRuntimeStatus = 'unavailable: installed react-router-dom has no MemoryRouter export';
    return children;
  }
  if (configuration === undefined && !AUTOMATIC_ROUTER_BOUNDARY_ENABLED) {
    previewRuntimeStatus =
      'not applied: an existing target-reachable Router provider was detected';
    return children;
  }

  const initialEntries = readInitialEntries(configuration);
  const initialIndex = readInitialIndex(configuration, initialEntries.length);
  const routerProperties = { initialEntries };
  if (initialIndex !== undefined) {
    routerProperties.initialIndex = initialIndex;
  }
  previewRuntimeStatus = configuration === undefined
    ? 'active: graph-required MemoryRouter at the root location /'
    : 'active: explicitly configured MemoryRouter with setup-owned static history';
  return React.createElement(MemoryRouter, routerProperties, children);
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
