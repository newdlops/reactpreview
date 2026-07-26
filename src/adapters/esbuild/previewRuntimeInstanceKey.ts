/**
 * Produces an opaque per-compilation key for generated preview runtimes.
 *
 * The random prefix makes keys private to this extension-host process while the monotonic suffix
 * guarantees that consecutive incremental rebuilds cannot share generated runtime module state.
 */
import { randomBytes } from 'node:crypto';

let prefix = createPrefix();
let sequence = 0;

/** Returns an opaque, URL-safe key with no project or source-derived data. */
export function createPreviewRuntimeInstanceKey(): string {
  if (sequence >= Number.MAX_SAFE_INTEGER) {
    prefix = createPrefix();
    sequence = 0;
  }
  sequence += 1;
  return `${prefix}-${sequence.toString(36)}`;
}

/** Creates the fixed 24-hex-character process-local prefix. */
function createPrefix(): string {
  return randomBytes(12).toString('hex');
}
