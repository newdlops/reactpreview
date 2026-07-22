/**
 * Bounds allocation-heavy asynchronous work without serializing the surrounding esbuild graph.
 * Esbuild may invoke many plugin callbacks at once; this gate keeps only a fixed number inside a
 * memory-intensive source transformation while remaining independent from any project runtime.
 */

/** Minimal immutable boundary exposed to compiler plugins that need bounded local concurrency. */
export interface PreviewBoundedWorkGate {
  /** Runs one operation after a slot is acquired and always releases that slot after settlement. */
  readonly run: <Result>(operation: () => Promise<Result>) => Promise<Result>;
}

/**
 * Creates a FIFO concurrency gate with direct slot handoff between consecutive waiters.
 *
 * Direct handoff deliberately keeps the active count unchanged while a queued operation wakes. A
 * newly arriving callback therefore cannot steal the released slot and exceed the configured cap
 * before the queued promise resumes on the next microtask.
 *
 * @param maximumConcurrency Positive integer number of operations allowed to allocate at once.
 * @returns Reusable gate whose queue contains promises only while all slots are occupied.
 */
export function createPreviewBoundedWorkGate(maximumConcurrency: number): PreviewBoundedWorkGate {
  if (!Number.isSafeInteger(maximumConcurrency) || maximumConcurrency <= 0) {
    throw new RangeError('Preview work concurrency must be a positive safe integer.');
  }
  let activeOperations = 0;
  const waiters: (() => void)[] = [];

  /** Acquires an available slot or waits until the oldest queued callback receives one. */
  async function acquire(): Promise<void> {
    if (activeOperations < maximumConcurrency) {
      activeOperations += 1;
      return;
    }
    await new Promise<void>((resolve) => {
      waiters.push(resolve);
    });
  }

  /** Releases one slot, handing it directly to the next waiter before reducing active capacity. */
  function release(): void {
    const next = waiters.shift();
    if (next !== undefined) {
      next();
      return;
    }
    activeOperations = Math.max(0, activeOperations - 1);
  }

  /** Executes one operation under the fixed-capacity FIFO discipline. */
  async function run<Result>(operation: () => Promise<Result>): Promise<Result> {
    await acquire();
    try {
      return await operation();
    } finally {
      release();
    }
  }

  return Object.freeze({ run });
}
