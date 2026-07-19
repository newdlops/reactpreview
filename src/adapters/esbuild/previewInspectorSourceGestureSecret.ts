/**
 * Derives entry-private Page Inspector source-navigation credentials.
 * Keeping this cryptographic identity outside the compiler prevents build orchestration from
 * owning presentation-protocol details while retaining host-only entropy and normalized paths.
 */
import { createHmac } from 'node:crypto';
import { normalizeLexicalPath } from '../../shared/pathIdentity';

/**
 * Creates one stable target-scoped browser HMAC key from compiler-private process entropy.
 *
 * @param seed Random host-lifetime secret never published outside generated inspector artifacts.
 * @param documentPath Trusted active source path normalized before identity derivation.
 * @returns URL-safe key embedded only in the corresponding Inspector entry.
 */
export function createInspectorSourceGestureSecret(seed: Buffer, documentPath: string): string {
  return createHmac('sha256', seed)
    .update('react-preview-inspector-source\0')
    .update(normalizeLexicalPath(documentPath))
    .digest('base64url');
}
