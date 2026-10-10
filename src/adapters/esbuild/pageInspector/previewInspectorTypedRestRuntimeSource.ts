/**
 * Browser lookup of declared REST response shapes registered by instrumented API modules.
 *
 * Requests made through an imported HTTP client instance reach the Page Inspector at the
 * XMLHttpRequest boundary without a shape. Modules queue `[method, path pattern, shape]` for their
 * typed calls (see `previewTypedRestEndpointRegistrations`); a request matches when the pattern's
 * segments equal the tail of its path, so a client base URL prefix does not matter and a `*`
 * segment matches one path segment. The longest matching pattern wins, newest first on ties.
 */

/** Creates the plain JavaScript lookup embedded into the Page Inspector data runtime. */
export function createPreviewInspectorTypedRestRuntimeSource(): string {
  return String.raw`
const PREVIEW_INSPECTOR_TYPED_REST_ENDPOINTS_KEY = Symbol.for('newdlops.react-file-preview.typed-rest-endpoints');
const PREVIEW_INSPECTOR_TYPED_REST_ENDPOINT_LIMIT = 1024;

/** Splits and decodes a URL path into comparable segments. */
function readPreviewInspectorTypedRestSegments(pathname) {
  return pathname.split('/').filter((segment) => segment !== '').map((segment) => {
    try {
      return decodeURIComponent(segment);
    } catch {
      return segment;
    }
  });
}

/** Returns the declared response body shape registered for one request, when a pattern matches. */
function readPreviewInspectorTypedRestShape(method, url) {
  const registry = globalThis[PREVIEW_INSPECTOR_TYPED_REST_ENDPOINTS_KEY];
  if (!Array.isArray(registry) || typeof url !== 'string' || url === '') return undefined;
  if (registry.length > PREVIEW_INSPECTOR_TYPED_REST_ENDPOINT_LIMIT) {
    registry.splice(0, registry.length - PREVIEW_INSPECTOR_TYPED_REST_ENDPOINT_LIMIT);
  }
  let pathname;
  try {
    pathname = new URL(url, 'http://preview.invalid').pathname;
  } catch {
    return undefined;
  }
  const requestSegments = readPreviewInspectorTypedRestSegments(pathname);
  let bestShape;
  let bestLength = 0;
  for (let index = registry.length - 1; index >= 0; index -= 1) {
    const entry = registry[index];
    if (!Array.isArray(entry) || entry[0] !== method || typeof entry[1] !== 'string') continue;
    const patternSegments = entry[1].split('/').filter((segment) => segment !== '');
    if (patternSegments.length <= bestLength || patternSegments.length > requestSegments.length) {
      continue;
    }
    const offset = requestSegments.length - patternSegments.length;
    const matches = patternSegments.every((segment, position) =>
      segment === '*' || segment === requestSegments[offset + position]);
    if (matches && entry[2] !== null && typeof entry[2] === 'object') {
      bestShape = entry[2];
      bestLength = patternSegments.length;
    }
  }
  return bestShape;
}
`;
}
