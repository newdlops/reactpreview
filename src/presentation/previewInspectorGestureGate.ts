/**
 * Verifies one-shot source-navigation proofs emitted by the private Page Inspector UI bridge.
 * The browser signs the exact source payload with an entry-scoped HMAC key, while this host gate
 * rejects tampering and replay before any filesystem or editor API is reached.
 */
import { createHmac, timingSafeEqual } from 'node:crypto';
import type { PreviewInspectorOpenSourceRequest } from './previewInspectorProtocol';

const SOURCE_GESTURE_SECRET_PATTERN = /^[A-Za-z0-9_-]{43}$/u;

/** Mutable, panel-owned verifier retaining every accepted nonce for the lifetime of one entry key. */
export class PreviewInspectorGestureGate {
  private readonly consumedNonces = new Set<string>();
  private encodedSecret: string | undefined;

  /**
   * Installs the HMAC key carried by the latest Page Inspector bundle.
   * Reusing the same incremental entry preserves replay history; a genuinely different entry key
   * clears obsolete nonces because signatures from the previous key can no longer validate.
   *
   * @param encodedSecret Base64url-encoded 256-bit key, or `undefined` outside Inspector mode.
   */
  public configure(encodedSecret: string | undefined): void {
    const acceptedSecret =
      encodedSecret !== undefined && SOURCE_GESTURE_SECRET_PATTERN.test(encodedSecret)
        ? encodedSecret
        : undefined;
    if (acceptedSecret === this.encodedSecret) {
      return;
    }
    this.encodedSecret = acceptedSecret;
    this.consumedNonces.clear();
  }

  /**
   * Authenticates the complete source request and consumes its nonce exactly once.
   *
   * @param request Syntactically validated but still untrusted webview request.
   * @returns `true` only for an untampered proof that has never been accepted by this panel.
   */
  public consume(request: PreviewInspectorOpenSourceRequest): boolean {
    if (this.encodedSecret === undefined) {
      return false;
    }
    const expectedToken = createPreviewInspectorGestureToken(this.encodedSecret, request);
    const suppliedToken = Buffer.from(request.gestureToken, 'base64url');
    const expectedBytes = Buffer.from(expectedToken, 'base64url');
    if (
      suppliedToken.byteLength !== expectedBytes.byteLength ||
      !timingSafeEqual(suppliedToken, expectedBytes) ||
      this.consumedNonces.has(request.gestureNonce)
    ) {
      return false;
    }

    // Valid nonces can originate only from trusted clicks carrying the private entry HMAC key. Keeping
    // the complete set until that key changes guarantees "one shot" rather than reopening a replay
    // window after an arbitrary cache-size threshold.
    this.consumedNonces.add(request.gestureNonce);
    return true;
  }
}

/**
 * Creates the host representation of the browser HMAC for tests and verifier comparison.
 * The stable JSON array intentionally distinguishes omitted coordinates with explicit `null` values.
 *
 * @param encodedSecret Base64url-encoded 256-bit HMAC key.
 * @param request Source path, coordinates, nonce, and discriminator bound by the proof.
 * @returns Base64url SHA-256 HMAC without padding.
 */
export function createPreviewInspectorGestureToken(
  encodedSecret: string,
  request: Omit<PreviewInspectorOpenSourceRequest, 'gestureToken'>,
): string {
  return createHmac('sha256', Buffer.from(encodedSecret, 'base64url'))
    .update(serializePreviewInspectorGesturePayload(request))
    .digest('base64url');
}

/** Serializes source fields in the exact order used by the generated browser signing bridge. */
function serializePreviewInspectorGesturePayload(
  request: Omit<PreviewInspectorOpenSourceRequest, 'gestureToken'>,
): string {
  return JSON.stringify([
    request.type,
    request.sourcePath,
    request.line ?? null,
    request.column ?? null,
    request.occurrenceStart ?? null,
    request.gestureNonce,
  ]);
}
