/**
 * Generates a browser-only compatibility surface for the legacy Next.js Pages Router.
 *
 * A selected page normally receives `next/router` from Next's server/client bootstrap. The preview
 * deliberately does not start that bootstrap, so the package's real `useRouter()` throws before any
 * visual output is committed. This runtime exposes the public read/navigation surface against the
 * already-selected webview location and never starts a server, performs a fetch, or leaves the
 * current preview origin.
 */

/**
 * Creates the self-contained `next/router` replacement bundled into a preview artifact.
 *
 * The returned router is stable by identity, while pathname/query getters read the current page
 * candidate location lazily. Navigation methods accept only local paths and update in-memory
 * browser history so ordinary click handlers remain inspectable without reaching a backend.
 *
 * @returns JavaScript module source with the common Pages Router public exports.
 */
export function createPreviewNextPagesRouterRuntimeSource(): string {
  return `
import * as React from 'react';
import { RouterContext } from 'next/dist/shared/lib/router-context.shared-runtime';

const MAX_LOCAL_URL_LENGTH = 2048;
const listenersByEvent = new Map();
const routeStateSymbol = Symbol.for('newdlops.react-file-preview.next-pages-router-state');
const routeSubscribers = new Set();
let routeRevision = 0;

/** Returns a safe location record even in non-DOM execution tests. */
function readLocation() {
  const location = globalThis.location;
  return location !== undefined
    ? location
    : { hash: '', pathname: '/', search: '' };
}

/** Reads only the route pattern published by the selected Page Inspector candidate. */
function readRouteState() {
  const state = globalThis[routeStateSymbol];
  return state !== null && typeof state === 'object' &&
    typeof state.pathname === 'string' && typeof state.pattern === 'string'
    ? state
    : undefined;
}

/** Adds dynamic filesystem segments to the query object using Next Pages semantics. */
function addRouteParameters(query) {
  const state = readRouteState();
  if (state === undefined) return query;
  const patternSegments = state.pattern.split('/').filter(Boolean);
  const pathnameSegments = state.pathname.split('/').filter(Boolean);
  for (let index = 0; index < patternSegments.length; index += 1) {
    const patternSegment = patternSegments[index];
    const optionalCatchAll = /^\\[\\[\\.\\.\\.([^\\]]+)\\]\\]$/u.exec(patternSegment);
    const catchAll = /^\\[\\.\\.\\.([^\\]]+)\\]$/u.exec(patternSegment);
    const dynamic = /^\\[([^\\]]+)\\]$/u.exec(patternSegment);
    const match = optionalCatchAll ?? catchAll ?? dynamic;
    if (match === null) continue;
    const parameterName = match[1];
    if (typeof parameterName !== 'string' || parameterName.length === 0) continue;
    if (optionalCatchAll !== null || catchAll !== null) {
      const values = pathnameSegments.slice(index).map(decodeRouteSegment);
      if (values.length > 0 || optionalCatchAll === null) query[parameterName] = values;
      break;
    }
    const value = pathnameSegments[index];
    if (value !== undefined) query[parameterName] = decodeRouteSegment(value);
  }
  return query;
}

/** Decodes one bounded path segment while preserving malformed authored escape sequences. */
function decodeRouteSegment(value) {
  try { return decodeURIComponent(value); } catch { return value; }
}

/** Converts URLSearchParams into Next-compatible string or string-array query values. */
function readQuery() {
  const query = {};
  const parameters = new URLSearchParams(readLocation().search || '');
  for (const [key, value] of parameters) {
    const previous = query[key];
    query[key] = previous === undefined
      ? value
      : Array.isArray(previous)
        ? [...previous, value]
        : [previous, value];
  }
  return addRouteParameters(query);
}

/** Serializes a bounded plain query object using the same repeated-key convention as URLs. */
function serializeUrlObjectQuery(value) {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return '';
  const parameters = new URLSearchParams();
  for (const [key, rawValue] of Object.entries(value).slice(0, 64)) {
    const values = Array.isArray(rawValue) ? rawValue.slice(0, 16) : [rawValue];
    for (const item of values) {
      if (typeof item === 'string' || typeof item === 'number' || typeof item === 'boolean') {
        parameters.append(key, String(item));
      }
    }
  }
  const serialized = parameters.toString();
  return serialized.length === 0 ? '' : '?' + serialized;
}

/** Reads a string or Next-style URL object without evaluating application callbacks. */
function readLocalUrl(value) {
  const candidate = typeof value === 'string'
    ? value
    : value !== null && typeof value === 'object' && typeof value.pathname === 'string'
      ? value.pathname +
        (typeof value.search === 'string' ? value.search : serializeUrlObjectQuery(value.query)) +
        (typeof value.hash === 'string' ? value.hash : '')
      : undefined;
  if (
    typeof candidate !== 'string' ||
    candidate.length === 0 ||
    candidate.length > MAX_LOCAL_URL_LENGTH ||
    !candidate.startsWith('/') ||
    candidate.startsWith('//') ||
    /[\\\\\u0000-\u001f\u007f]/u.test(candidate)
  ) {
    return undefined;
  }
  return candidate;
}

/** Notifies only listeners registered inside this isolated preview document. */
function emit(eventName, ...arguments_) {
  for (const listener of listenersByEvent.get(eventName) ?? []) {
    try {
      listener(...arguments_);
    } catch (error) {
      console.warn('[React Preview] A Next Router event listener failed.', error);
    }
  }
}

/** Notifies mounted hook/withRouter consumers after one local history transition. */
function notifyRouteSubscribers() {
  routeRevision += 1;
  for (const subscriber of [...routeSubscribers]) {
    try { subscriber(); } catch { /* one stale React subscriber must not block navigation */ }
  }
}

/** Subscribes a React hook without exposing the listener registry to project code. */
function subscribeRoute(subscriber) {
  routeSubscribers.add(subscriber);
  return () => routeSubscribers.delete(subscriber);
}

/** Applies a bounded same-document location and mirrors the Pages Router event sequence. */
async function navigate(method, value, options) {
  const url = readLocalUrl(value);
  if (url === undefined) return false;
  const eventOptions = { shallow: options?.shallow === true };
  emit('routeChangeStart', url, eventOptions);
  try {
    globalThis.history?.[method]?.(globalThis.history.state, '', url);
    emit('beforeHistoryChange', url, eventOptions);
    emit('routeChangeComplete', url, eventOptions);
    notifyRouteSubscribers();
    return true;
  } catch (error) {
    emit('routeChangeError', error, url, eventOptions);
    return false;
  }
}

/** Small event emitter matching the Router.events methods used by Pages applications. */
const events = Object.freeze({
  emit,
  off(eventName, listener) {
    listenersByEvent.get(eventName)?.delete(listener);
  },
  on(eventName, listener) {
    if (typeof listener !== 'function') return;
    let listeners = listenersByEvent.get(eventName);
    if (listeners === undefined) {
      listeners = new Set();
      listenersByEvent.set(eventName, listeners);
    }
    listeners.add(listener);
  },
});

/** Stable public router used by both the hook and singleton default export. */
const previewRouter = {
  basePath: '',
  beforePopState() {},
  back() { globalThis.history?.back?.(); },
  defaultLocale: undefined,
  domainLocales: undefined,
  events,
  forward() { globalThis.history?.forward?.(); },
  isFallback: false,
  isLocaleDomain: false,
  isPreview: false,
  isReady: true,
  locale: undefined,
  locales: undefined,
  prefetch: async () => undefined,
  push(value, as, options) { return navigate('pushState', as ?? value, options); },
  ready(callback) { if (typeof callback === 'function') callback(); },
  reload() {},
  replace(value, as, options) { return navigate('replaceState', as ?? value, options); },
};

Object.defineProperties(previewRouter, {
  asPath: { enumerable: true, get() {
    const location = readLocation();
    return (location.pathname || '/') + (location.search || '') + (location.hash || '');
  } },
  pathname: { enumerable: true, get() {
    return readRouteState()?.pattern ?? readLocation().pathname ?? '/';
  } },
  query: { enumerable: true, get: readQuery },
  route: { enumerable: true, get() {
    return readRouteState()?.pattern ?? readLocation().pathname ?? '/';
  } },
  router: { enumerable: false, get() { return previewRouter; } },
});

/** Returns the preview-owned singleton instead of requiring Next's mounted RouterContext. */
export function useRouter() {
  if (typeof React.useSyncExternalStore === 'function') {
    React.useSyncExternalStore(subscribeRoute, () => routeRevision, () => routeRevision);
  } else {
    const [, setRevision] = React.useState(0);
    React.useEffect(() => subscribeRoute(() => setRevision((value) => value + 1)), []);
  }
  return previewRouter;
}

/** Supplies the same router to legacy class/function components through a normal React wrapper. */
export function withRouter(Component) {
  function PreviewWithRouter(properties) {
    return React.createElement(Component, { ...properties, router: useRouter() });
  }
  PreviewWithRouter.displayName = 'PreviewWithRouter(' + (Component.displayName || Component.name || 'Component') + ')';
  return PreviewWithRouter;
}

/** Compatibility exports retained for packages that consume Next's public singleton helpers. */
export const Router = previewRouter;
export { RouterContext };
export function createRouter() { return previewRouter; }
export function makePublicRouterInstance(router) { return router ?? previewRouter; }
export default previewRouter;
`;
}
