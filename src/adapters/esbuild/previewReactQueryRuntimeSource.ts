/**
 * Generates the browser-only TanStack/React Query runtime used by the optional preview bridge.
 *
 * Applications normally create their `QueryClientProvider` in an entry module that the preview
 * deliberately never executes, so every `useQuery` would otherwise throw "No QueryClient set" and
 * fall back to syntax-guessed values. This boundary supplies the project's own `QueryClient`
 * class and Provider (same package instance, therefore the same Context identity) while authored
 * query functions keep running unchanged; their requests still reach the Inspector's no-network
 * data boundary. Invariants: every boundary mount owns fresh clients (a Page Inspector scope change
 * remounts it); an Inspector data revision invalidates their queries so edited payloads are never
 * shadowed by a cached result; and there are no retries, polling, or focus/reconnect refetches.
 */

/** Package identities whose v3+ API exposes the QueryClient/QueryClientProvider pair. */
export type PreviewReactQueryPackageName = '@tanstack/react-query' | 'react-query';

/** One project-owned Query package entry resolved by the compiler's esbuild resolver. */
export interface PreviewReactQueryRuntimeModule {
  /** Absolute browser-resolved package entry embedded as an ESM import specifier. */
  readonly modulePath: string;
  /** Package identity used for diagnostics and wrapping order. */
  readonly packageName: PreviewReactQueryPackageName;
}

/** Resolved project modules required to build the automatic Query boundary. */
export interface PreviewReactQueryRuntimeSourceOptions {
  /** Distinct installed Query packages, wrapped innermost first. */
  readonly modules: readonly PreviewReactQueryRuntimeModule[];
}

/**
 * Creates the Query bridge module as plain browser JavaScript.
 * Export names are feature-detected at runtime because v3, v4, and v5 share the Provider/client
 * pair but differ in option names; React Query v2 has neither and is left unwrapped.
 *
 * @param options Project-owned Query module entries selected through esbuild resolution.
 * @returns JavaScript source loaded inside the private Query bridge namespace.
 */
export function createPreviewReactQueryRuntimeSource(
  options: PreviewReactQueryRuntimeSourceOptions,
): string {
  const imports = options.modules.map(
    (module, index) =>
      `import * as PreviewQueryPackage${index.toString()} from ${JSON.stringify(normalizeImportPath(module.modulePath))};`,
  );
  const descriptors = options.modules.map(
    (module, index) =>
      `Object.freeze({ namespace: PreviewQueryPackage${index.toString()}, packageName: ${JSON.stringify(module.packageName)} })`,
  );

  return `
import * as React from 'react';
${imports.join('\n')}

const PREVIEW_QUERY_PACKAGES = Object.freeze([${descriptors.join(', ')}]);
/* Applied after package defaults and per-query options so authored retry/polling cannot delay. */
const PREVIEW_QUERY_OPTION_OVERRIDES = Object.freeze({
  networkMode: 'always',
  refetchInterval: false,
  refetchIntervalInBackground: false,
  refetchOnReconnect: false,
  refetchOnWindowFocus: false,
  retry: false,
});
const PREVIEW_MUTATION_OPTION_OVERRIDES = Object.freeze({ networkMode: 'always', retry: false });
let previewRuntimeStatus = 'available: automatic QueryClient boundary has not been composed yet';

/** Returns the last automatic Query decision for detailed preview runtime diagnostics. */
export function readPreviewRuntimeStatus() {
  return previewRuntimeStatus;
}

/** Counts project clients that an authored Provider mounted, for runtime diagnostics. */
export function readPreviewTrackedProjectQueryClientCount() {
  return previewProjectQueryClients.size;
}

/** Keeps only packages that expose a constructible client and a renderable Provider. */
function readSupportedPreviewQueryPackages() {
  return PREVIEW_QUERY_PACKAGES.filter(({ namespace }) => {
    const provider = namespace?.QueryClientProvider;
    return typeof namespace?.QueryClient === 'function' &&
      (typeof provider === 'function' || (provider !== null && typeof provider === 'object'));
  });
}

/**
 * Re-applies preview precedence after the package merges defaults with per-query options.
 * Copies are returned because callers such as v5 useBaseQuery annotate the defaulted object.
 */
function enforcePreviewQueryClientOptions(client) {
  const enforce = (methodName, overrides) => {
    const original = client[methodName];
    if (typeof original !== 'function') return;
    Object.defineProperty(client, methodName, {
      configurable: true,
      value: function previewDefaultedOptions(options) {
        const defaulted = original.call(this, options);
        return defaulted !== null && typeof defaulted === 'object'
          ? { ...defaulted, ...overrides }
          : defaulted;
      },
      writable: true,
    });
  };
  enforce('defaultQueryOptions', PREVIEW_QUERY_OPTION_OVERRIDES);
  enforce('defaultQueryObserverOptions', PREVIEW_QUERY_OPTION_OVERRIDES);
  enforce('defaultMutationOptions', PREVIEW_MUTATION_OPTION_OVERRIDES);
  return client;
}

/** Clients created by this boundary; they are invalidated and disposed with their mount. */
const previewOwnedQueryClients = new WeakSet();
/** Project clients mounted by an authored QueryClientProvider inside the preview tree. */
const previewProjectQueryClients = new Set();
const PREVIEW_PROJECT_QUERY_CLIENT_LIMIT = 16;

/**
 * Records project-owned clients when their Provider mounts them. An application that renders its
 * own QueryClientProvider (often a module-level singleton with a long staleTime) binds every query
 * to that client, so invalidating only the boundary's clients would leave edited or filled
 * payloads shadowed by a still-fresh cached result.
 */
function trackPreviewProjectQueryClients(namespace) {
  const prototype = namespace?.QueryClient?.prototype;
  if (prototype === undefined || prototype === null || typeof prototype.mount !== 'function') return;
  if (Object.prototype.hasOwnProperty.call(prototype, '__reactPreviewTrackedMount')) return;
  const mount = prototype.mount;
  try {
    Object.defineProperty(prototype, '__reactPreviewTrackedMount', { value: true });
    Object.defineProperty(prototype, 'mount', {
      configurable: true,
      value: function previewTrackedMount() {
        if (!previewOwnedQueryClients.has(this)) {
          previewProjectQueryClients.delete(this);
          previewProjectQueryClients.add(this);
          while (previewProjectQueryClients.size > PREVIEW_PROJECT_QUERY_CLIENT_LIMIT) {
            previewProjectQueryClients.delete(previewProjectQueryClients.values().next().value);
          }
        }
        return mount.apply(this, arguments);
      },
      writable: true,
    });
  } catch {
    // A frozen package keeps its original behavior; only boundary clients are refreshed then.
  }
}
for (const { namespace } of PREVIEW_QUERY_PACKAGES) trackPreviewProjectQueryClients(namespace);

/** Creates one memory-only client from the project's own package class. */
function createPreviewQueryClient(namespace) {
  const client = enforcePreviewQueryClientOptions(new namespace.QueryClient({
    defaultOptions: {
      mutations: { ...PREVIEW_MUTATION_OPTION_OVERRIDES },
      queries: { ...PREVIEW_QUERY_OPTION_OVERRIDES },
    },
  }));
  previewOwnedQueryClients.add(client);
  return client;
}

/** Releases cached queries and timers of a client that no longer backs any mounted tree. */
function disposePreviewQueryClient(client) {
  try {
    client?.clear?.();
  } catch {
    // A replaced preview client has no observable consumers left; cleanup is best effort.
  }
}

/**
 * Marks every cached query stale and refetches the active ones so they read the newly selected
 * Inspector payload. Existing data stays visible until the refetch settles, avoiding a loading
 * flash; inactive queries refetch on their next mount instead of serving a still-fresh result.
 */
function invalidatePreviewQueryClient(client) {
  try {
    const pending = client?.invalidateQueries?.();
    if (typeof pending?.catch === 'function') pending.catch(() => undefined);
  } catch {
    // Invalidation only refreshes preview data; a failed refetch is reported by the query itself.
  }
}

/** Creates one client per installed package for a single boundary mount. */
function createPreviewQueryClients(packages) {
  return Object.freeze(packages.map(({ namespace }) => Object.freeze({
    client: createPreviewQueryClient(namespace),
    namespace,
  })));
}

const subscribeNever = () => () => undefined;
const readInitialDataRevision = () => 0;

/** Normalizes optional host callbacks into stable subscribe/read functions. */
function readPreviewQueryFreshness(options) {
  const subscribe = typeof options?.subscribeDataRevision === 'function'
    ? options.subscribeDataRevision
    : subscribeNever;
  const readSource = typeof options?.readDataRevision === 'function'
    ? options.readDataRevision
    : readInitialDataRevision;
  const readDataRevision = () => {
    try {
      const revision = readSource();
      return Number.isSafeInteger(revision) ? revision : 0;
    } catch {
      return 0;
    }
  };
  return Object.freeze({ readDataRevision, subscribe });
}

/** Observes the Inspector data revision with the renderer's external-store contract when present. */
function usePreviewQueryDataRevision(freshness) {
  if (typeof React.useSyncExternalStore === 'function') {
    return React.useSyncExternalStore(
      freshness.subscribe,
      freshness.readDataRevision,
      freshness.readDataRevision,
    );
  }
  const [revision, setRevision] = React.useState(freshness.readDataRevision);
  React.useEffect(() => {
    setRevision(freshness.readDataRevision());
    return freshness.subscribe(() => setRevision(freshness.readDataRevision()));
  }, [freshness]);
  return revision;
}

/**
 * Provides mount-scoped clients around the prepared preview tree.
 * Query observers bind to the client present when they mount and the Inspector does not remount
 * authored components for a data revision, so the client identity stays stable and its queries
 * are invalidated instead of being replaced by a new, unobserved client.
 */
function PreviewReactQueryBoundary({ children, createClients, freshness }) {
  const [clients] = React.useState(createClients);
  const revision = usePreviewQueryDataRevision(freshness);
  const appliedRevision = React.useRef(revision);
  React.useEffect(() => {
    if (Object.is(appliedRevision.current, revision)) return;
    appliedRevision.current = revision;
    for (const { client } of clients) invalidatePreviewQueryClient(client);
    for (const client of previewProjectQueryClients) invalidatePreviewQueryClient(client);
  }, [clients, revision]);
  React.useEffect(() => () => {
    for (const { client } of clients) disposePreviewQueryClient(client);
  }, [clients]);
  return clients.reduce(
    (element, { client, namespace }) =>
      React.createElement(namespace.QueryClientProvider, { client }, element),
    children,
  );
}

/**
 * Wraps the prepared preview in the project's QueryClientProvider.
 *
 * @param children Prepared preview element composed by earlier bridges.
 * @param options Setup configuration (\`false\` disables) and optional Inspector data-revision hooks.
 * @returns The unchanged children when disabled/unsupported, otherwise the Query boundary element.
 */
export function createReactQueryPreviewElement(children, options) {
  if (options?.configuration === false) {
    previewRuntimeStatus = 'disabled by setup (reactQueryPreview=false)';
    return children;
  }
  const packages = readSupportedPreviewQueryPackages();
  if (packages.length === 0) {
    previewRuntimeStatus =
      'unavailable: installed Query package lacks QueryClient and QueryClientProvider (React Query v2 needs no provider)';
    return children;
  }
  previewRuntimeStatus = 'active: memory-only QueryClient per preview mount (' +
    packages.map(({ packageName }) => packageName).join(', ') +
    '); data edits invalidate queries; retries, polling, and focus/reconnect refetches disabled; ' +
    'requests use the preview data boundary';
  return React.createElement(
    PreviewReactQueryBoundary,
    {
      createClients: () => createPreviewQueryClients(packages),
      freshness: readPreviewQueryFreshness(options),
      packageNames: Object.freeze(packages.map(({ packageName }) => packageName)),
    },
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
