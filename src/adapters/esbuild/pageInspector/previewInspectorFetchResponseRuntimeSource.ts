/**
 * Generates the no-network Fetch `Response` implementation used by React Page Inspector.
 *
 * Keeping response serialization separate from the request registry makes JSON APIs and authored
 * text/HTML consumers independently testable. The browser code never fetches remote content and
 * escapes generated payload text before inserting it into an HTML document.
 */

/**
 * Returns browser JavaScript that declares `createPreviewInspectorFetchResponse`.
 *
 * A compiler-proven `response.text()` consumer receives text instead of JSON serialization. HTML
 * consumers get a small valid document so iframe `srcDoc`, rich-text editors, and DOM parsers can
 * render useful generated content; explicit `.txt`/`.csv` URLs remain plain text.
 */
export function createPreviewInspectorFetchResponseRuntimeSource(): string {
  return String.raw`
/** Escapes generated payload text before placing it inside the virtual HTML document. */
function escapePreviewInspectorFetchHtml(value) {
  return String(value)
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
}

/** Keeps explicit plain-text resources out of the HTML fallback used by visual document viewers. */
function isPreviewInspectorPlainTextResponseUrl(url) {
  const pathname = String(url ?? '').split(/[?#]/u, 1)[0] ?? '';
  return /\.(?:csv|log|md|text|txt|xml)$/iu.test(pathname);
}

/** Converts one generated payload into the exact body family consumed by project source. */
function createPreviewInspectorFetchBody(payload, responseBodyKind, url) {
  if (responseBodyKind !== 'text') {
    return {
      body: JSON.stringify(payload),
      contentType: 'application/json; charset=utf-8',
    };
  }
  const text = typeof payload === 'string' ? payload : JSON.stringify(payload, null, 2);
  if (isPreviewInspectorPlainTextResponseUrl(url)) {
    return { body: text, contentType: 'text/plain; charset=utf-8' };
  }
  if (/<(?:!doctype|html|head|body)\b/iu.test(text)) {
    return { body: text, contentType: 'text/html; charset=utf-8' };
  }
  const escaped = escapePreviewInspectorFetchHtml(text);
  return {
    body: '<!doctype html><html><head><meta charset="utf-8">' +
      '<style>body{box-sizing:border-box;margin:0;padding:32px;font:16px/1.6 system-ui,sans-serif;' +
      'color:#20242b;background:#fff}main{max-width:900px;margin:auto}pre{white-space:pre-wrap;' +
      'overflow-wrap:anywhere}</style></head><body><main><p>Generated preview document</p><pre>' +
      escaped + '</pre></main></body></html>',
    contentType: 'text/html; charset=utf-8',
  };
}

/** Creates a standards-shaped in-memory fetch response with no transport side effects. */
function createPreviewInspectorFetchResponse(
  payload,
  method,
  status = 200,
  responseBodyKind = 'json',
  url = '',
) {
  const bodyForbidden = method === 'HEAD' || [204, 205, 304].includes(status);
  const encoded = createPreviewInspectorFetchBody(payload, responseBodyKind, url);
  const body = bodyForbidden ? null : encoded.body;
  const successful = status >= 200 && status < 300;
  const statusText = successful ? 'OK' : 'Virtual Backend Error';
  if (typeof globalThis.Response === 'function') {
    return new globalThis.Response(body, {
      headers: {
        'content-type': encoded.contentType,
        'x-react-preview': 'virtual-backend',
      },
      status,
      statusText,
    });
  }
  return {
    clone() {
      return createPreviewInspectorFetchResponse(
        payload,
        method,
        status,
        responseBodyKind,
        url,
      );
    },
    headers: {
      get: (name) => name.toLowerCase() === 'content-type' ? encoded.contentType : null,
    },
    json: async () => payload,
    ok: successful,
    status,
    statusText,
    text: async () => body ?? '',
  };
}
`;
}
