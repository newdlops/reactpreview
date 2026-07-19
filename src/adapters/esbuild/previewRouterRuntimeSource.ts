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

/** Reads only the compiler-owned marker used for an inferred Page Inspector route. */
function readInferredPreviewRoute(configuration) {
  if (
    !isConfigurationRecord(configuration) ||
    configuration.previewRouteSource !== 'static-page-graph'
  ) {
    return undefined;
  }
  const entries = readInitialEntries(configuration);
  return entries.length === 1 ? entries[0] : undefined;
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

/** Selects the modern context-presence hook without assuming one module interop shape. */
function readUseInRouterContext() {
  return ReactRouterDOM.useInRouterContext ?? ReactRouterDOM.default?.useInRouterContext;
}

/** Selects the legacy v5 context export when the modern presence hook is unavailable. */
function readLegacyRouterContext() {
  return ReactRouterDOM.__RouterContext ?? ReactRouterDOM.default?.__RouterContext;
}

/** Builds an isolated, bounded history property object shared by both wrapper entry points. */
function createMemoryRouterProperties(configuration) {
  const initialEntries = readInitialEntries(configuration);
  const initialIndex = readInitialIndex(configuration, initialEntries.length);
  const routerProperties = { initialEntries };
  if (initialIndex !== undefined) {
    routerProperties.initialIndex = initialIndex;
  }
  return routerProperties;
}

/** Recognizes only React Router's explicit nested-provider invariant for a safe retry. */
function isNestedPreviewRouterError(error) {
  const message = error instanceof Error ? error.message : String(error ?? '');
  return /cannot render a <Router> inside another <Router>|should never have more than one in your app/iu.test(
    message,
  );
}

/**
 * Retries a candidate without the inferred MemoryRouter when an unrecognized project wrapper owns
 * one itself. All unrelated render errors are rethrown to the normal preview error boundary.
 */
class PreviewCandidateRouterErrorBoundary extends React.Component {
  constructor(properties) {
    super(properties);
    this.state = {
      hasUnrelatedError: false,
      nestedRouterDetected: false,
      unrelatedError: undefined,
    };
  }

  /** Stores only the one recoverable Router invariant and preserves every other thrown value. */
  static getDerivedStateFromError(error) {
    return isNestedPreviewRouterError(error)
      ? { hasUnrelatedError: false, nestedRouterDetected: true, unrelatedError: undefined }
      : { hasUnrelatedError: true, nestedRouterDetected: false, unrelatedError: error };
  }

  /** Reports why the automatic boundary was removed without classifying application behavior. */
  componentDidCatch(error) {
    if (isNestedPreviewRouterError(error)) {
      previewRuntimeStatus =
        'active: candidate-owned Router detected at runtime; inferred MemoryRouter removed';
    }
  }

  render() {
    if (this.state.hasUnrelatedError) throw this.state.unrelatedError;
    if (this.state.nestedRouterDetected) return this.props.children;
    const MemoryRouter = readMemoryRouter();
    return typeof MemoryRouter === 'function'
      ? React.createElement(
          MemoryRouter,
          createMemoryRouterProperties(this.props.configuration),
          this.props.children,
        )
      : this.props.children;
  }
}

/**
 * Adds context only when the selected Page Inspector root is not already beneath a Router.
 * This component must perform the context check during render, after setup and graph-level
 * providers have composed around it; checking while the entry element is constructed is too early.
 */
function PreviewCandidateRouterBoundary({ children, configuration }) {
  const useInRouterContext = readUseInRouterContext();
  const legacyRouterContext = readLegacyRouterContext();
  const inheritsRouter = typeof useInRouterContext === 'function'
    ? useInRouterContext()
    : legacyRouterContext !== undefined && typeof React.useContext === 'function'
      ? React.useContext(legacyRouterContext) !== null
      : false;
  if (inheritsRouter) {
    previewRuntimeStatus = 'active: selected page candidate inherited an existing Router context';
    return children;
  }
  const MemoryRouter = readMemoryRouter();
  if (typeof MemoryRouter !== 'function') {
    previewRuntimeStatus = 'unavailable: installed react-router-dom has no MemoryRouter export';
    return children;
  }
  const inferredRoute = readInferredPreviewRoute(configuration);
  previewRuntimeStatus = inferredRoute !== undefined
    ? 'active: candidate-local MemoryRouter at the statically inferred target route ' + inferredRoute
    : configuration === undefined
      ? 'active: candidate-local MemoryRouter at the root location /'
      : 'active: candidate-local MemoryRouter with setup-owned static history';
  return React.createElement(
    PreviewCandidateRouterErrorBoundary,
    { configuration },
    children,
  );
}

/**
 * Wraps one independently mounted authored page candidate without creating nested Routers.
 * Candidate-specific ownership is derived from only the target-facing branch below that root;
 * graph-wide providers above a detached candidate therefore cannot suppress its required context.
 */
export function createNestedRouterPreviewElement(children, options) {
  const configuration = options?.configuration;
  if (configuration === false) {
    previewRuntimeStatus = 'disabled by setup (routerPreview=false)';
    return children;
  }
  if (options?.ownsRouter === true) {
    previewRuntimeStatus = 'not applied: selected page candidate owns a Router boundary';
    return children;
  }
  if (typeof readMemoryRouter() !== 'function') {
    previewRuntimeStatus = 'unavailable: installed react-router-dom has no MemoryRouter export';
    return children;
  }
  return React.createElement(PreviewCandidateRouterBoundary, { configuration }, children);
}

/**
 * Wraps a composed preview tree in the target project's MemoryRouter when that API is available.
 * An application-owned inner router keeps normal nearest-context precedence. Setup can export
 * routerPreview=false to opt out or provide bounded initialEntries and initialIndex values.
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
  if (options?.renderMode === 'page-inspector') {
    previewRuntimeStatus =
      'available: Page Inspector delegates Router ownership to each selected page candidate';
    return children;
  }
  if (configuration === undefined && !AUTOMATIC_ROUTER_BOUNDARY_ENABLED) {
    previewRuntimeStatus =
      'not applied: an existing target-reachable Router provider was detected';
    return children;
  }

  previewRuntimeStatus = configuration === undefined
    ? 'active: graph-required MemoryRouter at the root location /'
    : 'active: explicitly configured MemoryRouter with setup-owned static history';
  return React.createElement(MemoryRouter, createMemoryRouterProperties(configuration), children);
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
