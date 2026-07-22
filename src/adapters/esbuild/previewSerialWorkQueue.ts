/**
 * Serializes allocation-heavy compiler work by an explicit resource key.
 *
 * Esbuild invokes unrelated plugin callbacks concurrently. Some third-party processors retain
 * mutable package-scoped caches or allocate a full graph per call, so this tiny boundary allows
 * concurrency across packages while preventing same-package peak memory multiplication.
 */

/**
 * Runs one asynchronous operation after the previous operation for the same key has settled.
 * Rejections never poison the queue, and the final owner removes its entry to keep state bounded.
 */
export async function runPreviewSerialWork<T>(
  queues: Map<string, Promise<void>>,
  resourceKey: string,
  operation: () => Promise<T>,
): Promise<T> {
  const previous = queues.get(resourceKey) ?? Promise.resolve();
  const current = previous.then(operation);
  const tail = current.then(
    () => undefined,
    () => undefined,
  );
  queues.set(resourceKey, tail);
  try {
    return await current;
  } finally {
    if (queues.get(resourceKey) === tail) queues.delete(resourceKey);
  }
}
