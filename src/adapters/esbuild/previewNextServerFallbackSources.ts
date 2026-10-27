/**
 * Browser facades for Next.js modules that only work inside Next's server or bundler runtime.
 *
 * `next/headers` and `next/cache` read request-scoped async storage that does not exist in a
 * browser, `next/dynamic` relies on Next's loadable bootstrap, and `next/server` is the middleware
 * and route-handler surface. When a previewed page reaches them, these facades let rendering
 * continue: request data is empty, caching is a pass-through, dynamic imports become `React.lazy`,
 * and responses are plain web `Response` objects. Nothing contacts a server.
 */

/**
 * `cookies()`, `headers()`, and `draftMode()` return values usable both synchronously (Next 13/14)
 * and with `await` (Next 15+): each is an object whose `then` resolves to a plain copy.
 */
export function createNextHeadersFallbackSource(): string {
  return `
function awaitable(value) {
  const view = Object.create(value);
  Object.defineProperty(view, 'then', { value: (resolve) => resolve(value) });
  return view;
}
function* empty() {}
function createCookieStore() {
  const store = {
    delete() { return store; },
    get() { return undefined; },
    getAll() { return []; },
    has() { return false; },
    set() { return store; },
    size: 0,
    toString() { return ''; },
    [Symbol.iterator]: empty,
  };
  return store;
}
const headerStore = {
  entries: empty,
  forEach() {},
  get() { return null; },
  getSetCookie() { return []; },
  has() { return false; },
  keys: empty,
  values: empty,
  [Symbol.iterator]: empty,
};
export function cookies() { return awaitable(createCookieStore()); }
export function headers() { return awaitable(headerStore); }
export function draftMode() {
  return awaitable({ disable() {}, enable() {}, isEnabled: false });
}
`;
}

/** Revalidation is a no-op and cached functions run directly. */
export function createNextCacheFallbackSource(): string {
  return `
export function revalidatePath() {}
export function revalidateTag() {}
export function unstable_cache(callback) {
  return (...args) => callback(...args);
}
export function unstable_noStore() {}
export function unstable_cacheLife() {}
export function unstable_cacheTag() {}
export { unstable_cacheLife as cacheLife, unstable_cacheTag as cacheTag };
`;
}

/** `dynamic(loader, { loading })` becomes a Suspense-wrapped `React.lazy`. */
export function createNextDynamicFallbackSource(): string {
  return `
import * as React from 'react';

export default function dynamic(loader, options) {
  const settings = loader !== null && typeof loader === 'object' && !('then' in loader)
    ? loader
    : options ?? {};
  const load = typeof loader === 'function' ? loader : settings.loader;
  const Lazy = React.lazy(async () => {
    const loaded = await (typeof load === 'function' ? load() : load);
    const component = loaded !== null && typeof loaded === 'object' && 'default' in loaded
      ? loaded.default
      : loaded;
    return { default: typeof component === 'function' || typeof component === 'object' ? component : () => null };
  });
  const Loading = settings.loading;
  function PreviewNextDynamic(properties) {
    const fallback = typeof Loading === 'function'
      ? React.createElement(Loading, { error: null, isLoading: true, pastDelay: true })
      : null;
    return React.createElement(React.Suspense, { fallback }, React.createElement(Lazy, properties));
  }
  return PreviewNextDynamic;
}
`;
}

/**
 * Request-scoped `next/server` functions. A preview has no response to run `after()` work after,
 * and that work is server side effects (for example audit writes), so callbacks are not run.
 */
const NEXT_SERVER_REQUEST_SCOPE_EXPORTS = `export function after() {}
export function connection() { return Promise.resolve(); }`;

/** Plain web `Request`/`Response` stand-ins for the middleware and route-handler surface. */
export function createNextServerFallbackSource(): string {
  return `
const BaseRequest = typeof Request === 'function' ? Request : class {};
const BaseResponse = typeof Response === 'function' ? Response : class {};
export class NextRequest extends BaseRequest {
  constructor(input, init) {
    super(input, init);
    this.nextUrl = new URL(typeof input === 'string' ? input : input.url, 'http://localhost');
  }
}
function json(body, init) {
  return new BaseResponse(JSON.stringify(body), {
    ...(typeof init === 'object' ? init : {}),
    headers: { 'content-type': 'application/json' },
  });
}
export class NextResponse extends BaseResponse {
  static json(body, init) { return json(body, init); }
  static redirect(url, status) {
    return new BaseResponse(null, { headers: { location: String(url) }, status: typeof status === 'number' ? status : 307 });
  }
  static next() { return new BaseResponse(null); }
  static rewrite() { return new BaseResponse(null); }
}
export function userAgent() {
  return { browser: {}, cpu: {}, device: {}, engine: {}, isBot: false, os: {}, ua: '' };
}
${NEXT_SERVER_REQUEST_SCOPE_EXPORTS}
`;
}

/**
 * Wraps an installed `next/server`. Its `after()` and `connection()` throw without Next's request
 * async storage, which a preview never has, so those two use the inert forms above while every
 * other export stays the installed implementation.
 *
 * @param installedPath Absolute path of the resolved installed module.
 */
export function createNextServerInstalledScopeSource(installedPath: string): string {
  const specifier = JSON.stringify(installedPath);
  return `
import installed from ${specifier};
export * from ${specifier};
${NEXT_SERVER_REQUEST_SCOPE_EXPORTS}
export default { ...installed, after, connection };
`;
}
