/** Owns browser shutdown, deadlines, bounded captures, and explicit ownership reporting. */
import { type ChildProcess } from 'node:child_process';
import type { Readable } from 'node:stream';
import { StringDecoder } from 'node:string_decoder';
import {
  CDP_STARTUP_REQUEST_TIMEOUT_MS,
  MAX_CAPTURE_BYTES,
  MAX_EVIDENCE_ITEMS,
  type PreviewHeadlessOwnershipEvent,
  type PreviewHeadlessRendererOptions,
} from './previewHeadlessModel';

/** Preserves UTF-8 across chunks while capturing a bounded prefix for snapshot readers. */
export function captureBoundedStream(stream: Readable | null): () => string {
  let captured = '';
  const decoder = new StringDecoder('utf8');
  stream?.on('data', (chunk: Buffer) => {
    captured = appendBounded(captured, decoder.write(chunk));
  });
  stream?.once('end', () => {
    captured = appendBounded(captured, decoder.end());
  });
  return () => captured;
}

/** Waits no longer than the supplied close grace period. */
export function waitForBrowserClose(browser: ChildProcess, timeoutMs: number): Promise<void> {
  if (isBrowserTerminated(browser)) return Promise.resolve();
  const deadline = createCancellableDeadline(timeoutMs);
  return Promise.race([
    new Promise<void>((resolve) =>
      browser.once('close', () => {
        resolve();
      }),
    ),
    deadline.promise,
  ]).finally(() => {
    deadline.cancel();
  });
}

/** Stops only the browser process group spawned by this invocation. */
export async function terminateOwnedBrowser(browser: ChildProcess): Promise<void> {
  signalOwnedBrowser(browser, 'SIGTERM');
  await waitForBrowserClose(browser, 500);
  if (!isBrowserTerminated(browser)) {
    signalOwnedBrowser(browser, 'SIGKILL');
    await waitForBrowserClose(browser, 1_000);
  }
  if (!isBrowserTerminated(browser)) throw new Error('Owned Chromium process did not terminate.');
}

/** Recognizes normal and signal-driven process termination. */
export function isBrowserTerminated(browser: ChildProcess): boolean {
  return browser.exitCode !== null || browser.signalCode !== null;
}

/** Signals the exact spawned process group so helper children cannot survive cleanup. */
export function signalOwnedBrowser(browser: ChildProcess, signal: NodeJS.Signals): void {
  try {
    if (process.platform !== 'win32' && browser.pid !== undefined)
      process.kill(-browser.pid, signal);
    else browser.kill(signal);
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code;
    if (code === 'EPERM') {
      browser.kill(signal);
    } else if (code !== 'ESRCH') {
      throw error;
    }
  }
}

/** Validates the wall-clock ceiling before allocating owned resources. */
export function validateRunTimeout(timeoutMs: number): number {
  if (!Number.isSafeInteger(timeoutMs) || timeoutMs < 100 || timeoutMs > 120_000) {
    throw new RangeError('Headless preview timeout must be an integer from 100 to 120000 ms.');
  }
  return timeoutMs;
}

/** Keeps an individual CDP request positive and within the bounded startup allowance. */
export function validateCdpRequestTimeout(timeoutMs: number): number {
  if (
    !Number.isSafeInteger(timeoutMs) ||
    timeoutMs < 1 ||
    timeoutMs > CDP_STARTUP_REQUEST_TIMEOUT_MS
  ) {
    throw new RangeError('CDP request timeout must be an integer from 1 to 12000 ms.');
  }
  return timeoutMs;
}

/** Keeps Chromium virtual time positive and no longer than the run wall-clock ceiling. */
export function validateVirtualTimeBudget(virtualTimeMs: number, timeoutMs: number): number {
  if (!Number.isSafeInteger(virtualTimeMs) || virtualTimeMs < 1 || virtualTimeMs > timeoutMs) {
    throw new RangeError(
      'Chromium virtual-time budget must be positive and no greater than timeout.',
    );
  }
  return virtualTimeMs;
}

/** Retains one bounded evidence item. */
export function retainEvidence(target: string[], value: string): void {
  if (target.length < MAX_EVIDENCE_ITEMS) target.push(value.slice(0, 4096));
}

/** Keeps navigation guards by replacing only ordinary evidence after the shared cap is full. */
export function retainPriorityLoopbackEvidence(target: string[], value: string): void {
  const bounded = value.slice(0, 4096);
  if (target.length < MAX_EVIDENCE_ITEMS) {
    target.push(bounded);
    return;
  }
  const ordinaryIndex = target.findIndex((entry) => !entry.includes('204-navigation-blocked'));
  if (ordinaryIndex < 0) return;
  target.splice(ordinaryIndex, 1);
  target.push(bounded);
}

/** Retains a bounded prefix of process output. */
export function appendBounded(current: string, next: string): string {
  return (current + next).slice(0, MAX_CAPTURE_BYTES);
}

/** Observational telemetry must never influence the production rendering path. */
export function reportPreviewHeadlessOwnership(
  options: PreviewHeadlessRendererOptions,
  event: PreviewHeadlessOwnershipEvent,
): void {
  try {
    options.reportOwnership?.(event);
  } catch {
    /* observer isolation */
  }
}

/** A deadline whose timer cannot retain the process after another race branch wins. */
export function createCancellableDeadline(timeoutMs: number): {
  readonly cancel: () => void;
  readonly promise: Promise<void>;
} {
  let timer: NodeJS.Timeout | undefined;
  const promise = new Promise<void>((resolve) => {
    timer = setTimeout(() => {
      timer = undefined;
      resolve();
    }, timeoutMs);
    timer.unref();
  });
  return {
    cancel: () => {
      if (timer !== undefined) {
        clearTimeout(timer);
        timer = undefined;
      }
    },
    promise,
  };
}
