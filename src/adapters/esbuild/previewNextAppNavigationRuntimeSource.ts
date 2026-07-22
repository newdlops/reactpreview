/**
 * Generates the browser-only navigation surface normally installed by the Next App Router.
 *
 * Page Inspector composes App Router pages and layouts directly, without starting Next's server
 * or client bootstrap. Public `next/navigation` hooks would therefore read an absent framework
 * context and throw before authored UI can render. This module provides a bounded, no-network
 * location store shared with the generated page root through a global symbol.
 */

/** Stable global symbol description shared by the generated page root and navigation facade. */
export const PREVIEW_NEXT_APP_ROUTE_STATE_SYMBOL_KEY = 'newdlops.react-file-preview.next-app-route';

/** Stable signal key used by the generated route boundary to stop Next's never-returning helpers. */
export const PREVIEW_NEXT_APP_CONTROL_SIGNAL_SYMBOL_KEY =
  'newdlops.react-file-preview.next-app-control-signal';

/**
 * Creates a self-contained replacement for `next/navigation` and `next/navigation.js`.
 *
 * Navigation is intentionally in-memory. It keeps ordinary controls interactive without changing
 * the VS Code webview URL, contacting a backend, or requiring private Next.js context packages.
 * Control-flow helpers retain their never-returning contract through a preview-owned signal. The
 * generated App route boundary turns that signal into a local placeholder, so source following a
 * redirect/not-found guard cannot continue with undefined data.
 *
 * @returns JavaScript module source implementing the stable public App Router hook surface.
 */
export function createPreviewNextAppNavigationRuntimeSource(): string {
  return `
import * as React from 'react';

const routeStateSymbol = Symbol.for(${JSON.stringify(PREVIEW_NEXT_APP_ROUTE_STATE_SYMBOL_KEY)});
const controlSignalSymbol = Symbol.for(${JSON.stringify(PREVIEW_NEXT_APP_CONTROL_SIGNAL_SYMBOL_KEY)});
const subscribers = new Set();
let fallbackRevision = 0;
let cachedParamsSource;
let cachedParamsValue = Object.freeze({});
let cachedSearchSignature = '';
let cachedSearchValue;
const emptySegments = Object.freeze([]);

/** Context-compatible export used by libraries that register server-inserted style callbacks. */
export const ServerInsertedHTMLContext = React.createContext(null);

/** Preview-private layout depth installed by the generated App Router page composer. */
export const PreviewLayoutSegmentsContext = React.createContext(null);

/** Converts one unknown record into a shallow, mutation-safe object. */
function readPlainRecord(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? { ...value }
    : {};
}

/** Reads the page-root-owned route or a deterministic root fallback outside a browser. */
function readRouteState() {
  const state = globalThis[routeStateSymbol];
  if (state !== null && typeof state === 'object' && typeof state.pathname === 'string') {
    return state;
  }
  return {
    initialSignature: '',
    params: {},
    pathname: '/',
    revision: fallbackRevision,
    searchParams: {},
  };
}

/** Serializes inferred page search properties using repeated keys for array values. */
function serializeSearchParameters(value) {
  if (typeof value === 'string') return value.startsWith('?') ? value.slice(1) : value;
  if (value instanceof URLSearchParams) return value.toString();
  const parameters = new URLSearchParams();
  for (const [key, item] of Object.entries(readPlainRecord(value)).slice(0, 64)) {
    const values = Array.isArray(item) ? item.slice(0, 16) : [item];
    for (const entry of values) {
      if (typeof entry === 'string' || typeof entry === 'number' || typeof entry === 'boolean') {
        parameters.append(key, String(entry));
      }
    }
  }
  return parameters.toString();
}

/** Notifies mounted hooks after a local navigation or refresh request. */
function notifySubscribers() {
  for (const subscriber of [...subscribers]) {
    try { subscriber(); } catch { /* one stale hook must not block the static preview */ }
  }
}

/** Registers one React external-store listener against the isolated preview document. */
function subscribe(subscriber) {
  subscribers.add(subscriber);
  return () => subscribers.delete(subscriber);
}

/** Reads a monotonic primitive snapshot accepted by React's external-store hook. */
function readRevision() {
  const revision = readRouteState().revision;
  return Number.isSafeInteger(revision) ? revision : 0;
}

/** Subscribes the current component to in-memory route transitions. */
function useRouteRevision() {
  if (typeof React.useSyncExternalStore === 'function') {
    React.useSyncExternalStore(subscribe, readRevision, readRevision);
    return;
  }
  const [, setRevision] = React.useState(0);
  React.useEffect(() => subscribe(() => setRevision((value) => value + 1)), []);
}

/** Narrows a requested destination to a local pathname and search string. */
function readLocalDestination(value) {
  if (typeof value !== 'string' || value.length === 0 || value.length > 2048) return undefined;
  try {
    const url = new URL(value, 'https://react-preview.invalid');
    if (url.origin !== 'https://react-preview.invalid') return undefined;
    return { pathname: url.pathname || '/', search: url.search.slice(1) };
  } catch {
    return undefined;
  }
}

/** Applies one local route without mutating the VS Code resource URL. */
function navigate(value) {
  const destination = readLocalDestination(value);
  if (destination === undefined) return;
  const previous = readRouteState();
  globalThis[routeStateSymbol] = {
    ...previous,
    pathname: destination.pathname,
    revision: readRevision() + 1,
    searchParams: destination.search,
  };
  notifySubscribers();
}

/** Throws one recognizable control signal while preserving Next's never-returning API contract. */
function throwNavigationControl(kind, destination) {
  const detail = typeof destination === 'string' ? destination.slice(0, 2048) : undefined;
  const error = new Error(
    detail === undefined
      ? ('React Preview intercepted Next ' + kind + '().')
      : ('React Preview intercepted Next ' + kind + '() to ' + detail + '.'),
  );
  error.name = 'ReactPreviewNextNavigationSignal';
  Object.defineProperty(error, controlSignalSymbol, {
    configurable: false,
    enumerable: false,
    value: Object.freeze({ ...(detail === undefined ? {} : { destination: detail }), kind }),
    writable: false,
  });
  throw error;
}

/** Read-only URLSearchParams class matching the mutation policy of Next's public hook. */
export class ReadonlyURLSearchParams extends URLSearchParams {
  append() { throw new Error('ReadonlyURLSearchParams cannot be modified in React Preview.'); }
  delete() { throw new Error('ReadonlyURLSearchParams cannot be modified in React Preview.'); }
  set() { throw new Error('ReadonlyURLSearchParams cannot be modified in React Preview.'); }
  sort() { throw new Error('ReadonlyURLSearchParams cannot be modified in React Preview.'); }
}

/** Reuses one immutable parameter object until the route store installs different evidence. */
function readStableParams() {
  const source = readRouteState().params;
  if (source === cachedParamsSource) return cachedParamsValue;
  cachedParamsSource = source;
  cachedParamsValue = Object.freeze(readPlainRecord(source));
  return cachedParamsValue;
}

/** Reuses one read-only search object so React dependency arrays remain stable between navigation. */
function readStableSearchParams() {
  const signature = serializeSearchParameters(readRouteState().searchParams);
  if (cachedSearchValue !== undefined && signature === cachedSearchSignature) {
    return cachedSearchValue;
  }
  cachedSearchSignature = signature;
  cachedSearchValue = new ReadonlyURLSearchParams(signature);
  return cachedSearchValue;
}

/** Stable App Router object used by every public router-hook consumer in this artifact. */
const previewRouter = Object.freeze({
  back() {},
  forward() {},
  prefetch() { return Promise.resolve(); },
  push(href) { navigate(href); },
  refresh() {
    const previous = readRouteState();
    globalThis[routeStateSymbol] = { ...previous, revision: readRevision() + 1 };
    notifySubscribers();
  },
  replace(href) { navigate(href); },
});

/** Returns the preview-owned router instead of reading Next's absent AppRouterContext. */
export function useRouter() {
  useRouteRevision();
  return previewRouter;
}

/** Returns the concrete pathname selected by Page Inspector. */
export function usePathname() {
  useRouteRevision();
  return readRouteState().pathname || '/';
}

/** Returns the static filesystem parameters inferred for the selected page candidate. */
export function useParams() {
  useRouteRevision();
  return readStableParams();
}

/** Returns an immutable URLSearchParams view over inferred or locally navigated values. */
export function useSearchParams() {
  useRouteRevision();
  return readStableSearchParams();
}

/** Returns root parameters through the Promise contract used by newer Next App releases. */
export function unstable_rootParams() {
  return Promise.resolve(readStableParams());
}

/** Accepts Next's server-style registration hook without requiring a server render pass. */
export function useServerInsertedHTML(callback) {
  const register = React.useContext(ServerInsertedHTMLContext);
  if (typeof register === 'function' && typeof callback === 'function') register(callback);
}

/** Returns concrete visible path segments for packages using layout selection hooks. */
export function useSelectedLayoutSegments(parallelRoutesKey) {
  useRouteRevision();
  const context = React.useContext(PreviewLayoutSegmentsContext);
  if (context !== null && typeof context === 'object') {
    if (typeof parallelRoutesKey === 'string') {
      const slotSegments = context.slots?.[parallelRoutesKey];
      return Array.isArray(slotSegments) ? slotSegments : emptySegments;
    }
    return Array.isArray(context.segments) ? context.segments : emptySegments;
  }
  return (readRouteState().pathname || '/').split('/').filter(Boolean);
}

/** Returns the first active child segment below the calling layout. */
export function useSelectedLayoutSegment(parallelRoutesKey) {
  const segments = useSelectedLayoutSegments(parallelRoutesKey);
  return segments.length === 0 ? null : segments[0];
}

/** Next-compatible redirect kind retained for packages comparing exported constants. */
export const RedirectType = Object.freeze({ push: 'push', replace: 'replace' });

/** Stops the guarded render before source can use data that the redirect proved unavailable. */
export function redirect(href) { return throwNavigationControl('redirect', href); }

/** Permanent redirects share the same bounded, route-local preview control signal. */
export function permanentRedirect(href) { return throwNavigationControl('permanentRedirect', href); }

/** Stops a missing-data path before later property reads can throw an unrelated TypeError. */
export function notFound() { return throwNavigationControl('notFound'); }

/** Converts an absent authorization bootstrap into an inspectable local control result. */
export function forbidden() { return throwNavigationControl('forbidden'); }

/** Converts an absent authentication bootstrap into an inspectable local control result. */
export function unauthorized() { return throwNavigationControl('unauthorized'); }

/** Keeps action-error checks deterministic without importing Next's private server decoder. */
export function unstable_isUnrecognizedActionError() { return false; }

/** Preserves rethrow control flow so source after the guard is never evaluated incorrectly. */
export function unstable_rethrow(error) { throw error; }
`;
}
