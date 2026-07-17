/**
 * Defines the extension-host side of the retained-document hot-reload protocol. Keeping parsing and
 * cache-busting outside the panel session makes the security boundary independently testable and
 * prevents browser acknowledgements from mutating artifact leases before all fields are validated.
 */

/** Exact browser outcome accepted for one pending hot-reload revision. */
export interface PreviewHotReloadAcknowledgement {
  /** Whether the newly imported revision replaced the mounted React tree. */
  readonly applied: boolean;
  /** Session-local revision copied from the extension request. */
  readonly revision: number;
  /** Whether a failed preparation deliberately kept the preceding tree mounted. */
  readonly retainedPrevious: boolean;
  /** Opaque request token that owns the pending artifact transfer. */
  readonly token: string;
  /** Validated browser message discriminator. */
  readonly type: 'react-preview-hot-reload-failed' | 'react-preview-hot-reload-ready';
}

/** Artifact leases and fallback metadata retained while one browser replacement is pending. */
export interface PendingPreviewHotReload {
  /** Complete latest document used when replacement already disturbed the preceding React root. */
  readonly fallbackHtml: string;
  /** New artifact whose complete HTML may replace the document after a delivery failure. */
  readonly nextArtifactHash: string;
  /** Previous lease; mutable only when a failed intermediate revision is removed from the chain. */
  previousArtifactHash: string;
  /** Complete-document startup token used by the navigation fallback. */
  readonly runtimeToken: string;
  /** Exact session revision expected in the browser acknowledgement. */
  readonly runtimeRevision: number;
  /** Bounded safety timer for a browser that never acknowledges the request. */
  readonly timeout: ReturnType<typeof setTimeout>;
}

/**
 * Reads a structured-clone value only when it describes an internally consistent hot-reload
 * acknowledgement. Ready messages must report an applied tree, while failures may explicitly say
 * that preparation stopped before the previous tree was touched.
 *
 * @param value Untrusted message received from the preview webview.
 * @returns Frozen acknowledgement or `undefined` when any protocol field is invalid.
 */
export function readPreviewHotReloadAcknowledgement(
  value: unknown,
): PreviewHotReloadAcknowledgement | undefined {
  if (typeof value !== 'object' || value === null) {
    return undefined;
  }
  const message = value as Record<string, unknown>;
  const type = message.type;
  const token = message.token;
  const revision = message.revision;
  if (
    (type !== 'react-preview-hot-reload-ready' && type !== 'react-preview-hot-reload-failed') ||
    typeof token !== 'string' ||
    token.length === 0 ||
    token.length > 256 ||
    !Number.isSafeInteger(revision) ||
    (revision as number) < 0
  ) {
    return undefined;
  }

  if (type === 'react-preview-hot-reload-ready') {
    if (message.applied !== true || message.retainedPrevious !== false) {
      return undefined;
    }
    return Object.freeze({
      applied: true,
      retainedPrevious: false,
      revision: revision as number,
      token,
      type,
    });
  }

  const retainedPrevious = message.retainedPrevious === true;
  if (message.applied !== false || (message.retainedPrevious !== false && !retainedPrevious)) {
    return undefined;
  }
  return Object.freeze({
    applied: false,
    retainedPrevious,
    revision: revision as number,
    token,
    type,
  });
}

/**
 * Adds a revision-specific query to an immutable entry URL. A CSS-only build can legitimately reuse
 * the same content-addressed JavaScript path, so the query forces Chromium to evaluate the module
 * again while relative chunk imports continue to use their stable shared URLs.
 *
 * @param scriptUri Webview URI for the content-addressed entry module.
 * @param revision Session-local revision being posted to the browser.
 * @param artifactHash Complete JavaScript-and-CSS artifact identity.
 * @returns Same-origin entry URI with bounded cache-buster fields.
 */
export function createHotReloadScriptUri(
  scriptUri: string,
  revision: number,
  artifactHash: string,
): string {
  if (!Number.isSafeInteger(revision) || revision < 0) {
    throw new TypeError('Hot-reload revision must be a non-negative safe integer.');
  }
  if (artifactHash.length === 0 || artifactHash.length > 128) {
    throw new TypeError('Hot-reload artifact identity must be a bounded non-empty string.');
  }
  const parsedUri = new URL(scriptUri);
  parsedUri.search = '';
  parsedUri.hash = '';
  parsedUri.searchParams.set('reactPreviewRevision', revision.toString());
  parsedUri.searchParams.set('reactPreviewArtifact', artifactHash);
  return parsedUri.toString();
}
