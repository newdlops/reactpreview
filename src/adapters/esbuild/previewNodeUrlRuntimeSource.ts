/**
 * Generates a browser-only subset of Node's `url` module.
 *
 * ES modules derive their directory with `path.dirname(fileURLToPath(import.meta.url))`, often in
 * generated server clients that a page graph reaches through shared modules. The generic callable
 * builtin fallback returns `undefined` there and the path facade then rejects it, so the module
 * fails while evaluating. These helpers map URLs to POSIX paths inside the isolated preview root
 * and delegate everything else to the browser's own WHATWG URL implementation.
 */

/** Returns CommonJS source implementing the URL helpers used while modules evaluate. */
export function createPreviewNodeUrlRuntimeSource(): string {
  return [
    '/** Reads a URL string from a string or URL-like value. */',
    'function readHref(value) {',
    "  return typeof value === 'string' ? value : String(value?.href ?? value ?? '');",
    '}',
    '/** Maps any URL to its decoded path; non-file schemes resolve inside the preview root. */',
    'function fileURLToPath(value) {',
    '  try {',
    "    return decodeURIComponent(new URL(readHref(value)).pathname) || '/';",
    '  } catch {',
    "    return '/';",
    '  }',
    '}',
    'function pathToFileURL(value) {',
    "  const text = String(value ?? '');",
    "  return new URL('file://' + (text.startsWith('/') ? '' : '/') + encodeURI(text));",
    '}',
    'function resolve(from, to) {',
    '  try {',
    "    return new URL(String(to ?? ''), new URL(String(from ?? ''), 'resolve://preview/')).href",
    "      .replace(/^resolve:\\/\\/preview/u, '');",
    '  } catch {',
    "    return String(to ?? '');",
    '  }',
    '}',
    'function parse(value) {',
    '  try {',
    "    const url = new URL(readHref(value), 'http://localhost');",
    '    return {',
    '      auth: null, hash: url.hash || null, host: url.host, hostname: url.hostname, href: url.href,',
    '      path: url.pathname + url.search, pathname: url.pathname, port: url.port || null,',
    '      protocol: url.protocol, query: url.search.slice(1) || null, search: url.search || null,',
    '      slashes: true,',
    '    };',
    '  } catch {',
    '    return { href: readHref(value) };',
    '  }',
    '}',
    'function format(value) {',
    "  if (typeof value === 'string' || value instanceof URL) return readHref(value);",
    "  const protocol = value?.protocol ? String(value.protocol).replace(/:?$/u, ':') + '//' : '';",
    "  const host = value?.host ?? (value?.hostname ? value.hostname + (value.port ? ':' + value.port : '') : '');",
    "  const search = value?.search ?? (value?.query ? '?' + value.query : '');",
    "  return protocol + host + (value?.pathname ?? '') + search + (value?.hash ?? '');",
    '}',
    'module.exports = {',
    '  URL: globalThis.URL, URLSearchParams: globalThis.URLSearchParams,',
    '  domainToASCII: (value) => String(value), domainToUnicode: (value) => String(value),',
    '  fileURLToPath, format, parse, pathToFileURL, resolve,',
    '};',
    "console.warn('[React Preview] Node built-in url uses the browser URL implementation.');",
  ].join('\n');
}
