/** Defines the narrow webview-to-host retry envelope for recoverable preview bootstrap failures. */

/** Protocol discriminator accepted only by the panel that rendered the matching error document. */
export const PREVIEW_RETRY_MESSAGE_TYPE = 'react-preview-retry';

/** One opaque retry action created by the extension host for a single panel revision. */
export interface PreviewRetryRequest {
  /** Current session revision embedded in the rendered recovery action. */
  readonly revision: number;
  /** Opaque host-generated token; the browser never chooses build settings. */
  readonly token: string;
  /** Exact protocol discriminator. */
  readonly type: typeof PREVIEW_RETRY_MESSAGE_TYPE;
}

/** Checks whether an untrusted message claims the retry discriminator. */
export function isPreviewRetryMessage(value: unknown): boolean {
  return (
    typeof value === 'object' &&
    value !== null &&
    !Array.isArray(value) &&
    (value as Record<string, unknown>).type === PREVIEW_RETRY_MESSAGE_TYPE
  );
}

/** Parses a small opaque retry request without accepting options or source data from the browser. */
export function readPreviewRetryRequest(value: unknown): PreviewRetryRequest | undefined {
  if (!isPreviewRetryMessage(value)) return undefined;
  const message = value as Record<string, unknown>;
  if (
    typeof message.token !== 'string' ||
    message.token.length < 8 ||
    message.token.length > 256 ||
    !/^[A-Za-z0-9._:-]+$/u.test(message.token) ||
    typeof message.revision !== 'number' ||
    !Number.isSafeInteger(message.revision) ||
    message.revision < 0
  ) {
    return undefined;
  }
  return Object.freeze({
    revision: message.revision,
    token: message.token,
    type: PREVIEW_RETRY_MESSAGE_TYPE,
  });
}
