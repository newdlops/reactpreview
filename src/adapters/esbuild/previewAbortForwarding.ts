/** Bridges caller-owned preview cancellation into one compiler-owned build controller. */

/**
 * Forwards one caller-owned revision signal into a compiler-owned controller.
 * The returned cleanup prevents completed compiles from retaining session signals indefinitely.
 *
 * @param source Optional caller signal tied to one preview revision.
 * @param target Compiler-owned controller cancelled without mutating the caller.
 * @returns Idempotent listener cleanup for the compiler's `finally` boundary.
 */
export function forwardPreviewAbort(
  source: AbortSignal | undefined,
  target: AbortController,
): () => void {
  if (source === undefined) {
    return () => {
      // No caller listener was registered.
    };
  }
  const abortTarget = (): void => {
    target.abort(source.reason);
  };
  if (source.aborted) {
    abortTarget();
    return () => {
      // The already-aborted caller did not require a listener.
    };
  }
  source.addEventListener('abort', abortTarget, { once: true });
  return () => {
    source.removeEventListener('abort', abortTarget);
  };
}
