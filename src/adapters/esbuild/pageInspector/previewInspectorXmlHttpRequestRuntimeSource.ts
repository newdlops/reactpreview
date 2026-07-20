/**
 * Generates the browser-only XMLHttpRequest compatibility layer for React Page Inspector.
 *
 * The layer shares the enclosing data runtime's virtual-backend registry and never opens a native
 * transport. Keeping this protocol adapter separate prevents payload inference and browser API
 * emulation from growing into one indistinct runtime-source module.
 */

/**
 * Creates source for the minimal XMLHttpRequest surface commonly consumed by Axios adapters.
 *
 * The returned source intentionally references helpers declared by the surrounding composed data
 * runtime. It is interpolated into that same lexical scope before project modules are evaluated.
 *
 * @returns Plain JavaScript source implementing a no-network XMLHttpRequest boundary.
 */
export function createPreviewInspectorXmlHttpRequestRuntimeSource(): string {
  return String.raw`
/** Minimal event dispatch shared by the local XMLHttpRequest compatibility boundary. */
function dispatchPreviewInspectorXmlHttpRequestEvent(request, eventName) {
  const event = { currentTarget: request, target: request, type: eventName };
  const handler = request['on' + eventName];
  if (typeof handler === 'function') handler.call(request, event);
  for (const listener of request.eventListeners.get(eventName) ?? []) listener.call(request, event);
}

/** Implements the browser XHR surface used by Axios instances without opening a transport. */
class PreviewInspectorXmlHttpRequest {
  /** Initializes public response fields before a client configures the request. */
  constructor() {
    this.DONE = 4;
    this.HEADERS_RECEIVED = 2;
    this.LOADING = 3;
    this.OPENED = 1;
    this.UNSENT = 0;
    this.eventListeners = new Map();
    this.onload = null;
    this.onloadend = null;
    this.onerror = null;
    this.onabort = null;
    this.onreadystatechange = null;
    this.ontimeout = null;
    this.readyState = 0;
    this.requestHeaders = Object.create(null);
    this.response = null;
    this.responseText = '';
    this.responseType = '';
    this.responseURL = '';
    this.status = 0;
    this.statusText = '';
    this.timeout = 0;
    /** Accepts Axios upload-progress registration without fabricating progress events. */
    this.upload = {
      addEventListener() {},
      removeEventListener() {},
    };
    this.withCredentials = false;
  }

  /** Registers one client event callback without exposing a native network object. */
  addEventListener(eventName, listener) {
    if (typeof listener !== 'function') return;
    const listeners = this.eventListeners.get(eventName) ?? new Set();
    listeners.add(listener);
    this.eventListeners.set(eventName, listeners);
  }

  /** Removes a previously registered callback using normal EventTarget identity semantics. */
  removeEventListener(eventName, listener) {
    this.eventListeners.get(eventName)?.delete(listener);
  }

  /** Stores method/URL metadata and announces the OPENED state synchronously. */
  open(method, url, async = true) {
    this.async = async !== false;
    this.method = String(method || 'GET').toUpperCase();
    this.url = readPreviewInspectorFetchUrl(url);
    this.responseURL = sanitizePreviewInspectorRequestUrl(this.url);
    this.readyState = 1;
    dispatchPreviewInspectorXmlHttpRequestEvent(this, 'readystatechange');
  }

  /** Retains inert request headers only for client compatibility; values are never transmitted. */
  setRequestHeader(name, value) {
    this.requestHeaders[String(name).toLowerCase()] = String(value);
  }

  /** Returns the generated JSON response headers expected by Axios header parsing. */
  getAllResponseHeaders() {
    return 'content-type: application/json; charset=utf-8\r\nx-react-preview: generated\r\n';
  }

  /** Reads one generated response header case-insensitively. */
  getResponseHeader(name) {
    const normalized = String(name).toLowerCase();
    if (normalized === 'content-type') return 'application/json; charset=utf-8';
    if (normalized === 'x-react-preview') return 'generated';
    return null;
  }

  /** Accepts the browser API without changing the fixed JSON response representation. */
  overrideMimeType() {}

  /** Completes one request from the shared payload registry on the next microtask. */
  send(body) {
    const graphqlMetadata = readPreviewInspectorGraphqlFetchMetadata({ body });
    const metadata = {
      ...(graphqlMetadata ?? {}),
      ...(graphqlMetadata === undefined
        ? {}
        : {
            id: createPreviewInspectorRuntimeRequestId(
              'graphql',
              this.method ?? 'POST',
              (this.url ?? '') + ':' + graphqlMetadata.requestIdentity,
            ),
          }),
      method: this.method ?? 'GET',
      url: this.url ?? '',
    };
    const result = resolvePreviewInspectorBackendRequest(metadata, {}, {
      body,
      rawUrl: this.url ?? '',
    });
    const wirePayload = result.scenario === 'error'
      ? createPreviewInspectorVirtualBackendErrorPayload(result, metadata.kind)
      : metadata.kind === 'graphql'
        ? { data: result.payload }
        : result.payload;
    const complete = () => {
      if (this.readyState === 0) return;
      this.status = result.status;
      this.statusText = result.scenario === 'error' ? 'Virtual Backend Error' : 'OK';
      this.responseText = JSON.stringify(wirePayload);
      this.response = this.responseType === 'json' ? wirePayload : this.responseText;
      this.readyState = 2;
      dispatchPreviewInspectorXmlHttpRequestEvent(this, 'readystatechange');
      this.readyState = 4;
      dispatchPreviewInspectorXmlHttpRequestEvent(this, 'readystatechange');
      dispatchPreviewInspectorXmlHttpRequestEvent(this, 'load');
      dispatchPreviewInspectorXmlHttpRequestEvent(this, 'loadend');
    };
    if (this.async && result.latencyMs > 0 && typeof previewInspectorBackendSetTimeout === 'function') {
      previewInspectorBackendSetTimeout(complete, result.latencyMs);
    } else if (this.async) previewInspectorDataScheduleMicrotask(complete);
    else complete();
  }

  /** Cancels only this local fixture response and emits the standard terminal events. */
  abort() {
    this.readyState = 0;
    dispatchPreviewInspectorXmlHttpRequestEvent(this, 'abort');
    dispatchPreviewInspectorXmlHttpRequestEvent(this, 'loadend');
  }
}
Object.assign(PreviewInspectorXmlHttpRequest, {
  DONE: 4,
  HEADERS_RECEIVED: 2,
  LOADING: 3,
  OPENED: 1,
  UNSENT: 0,
});
`;
}
