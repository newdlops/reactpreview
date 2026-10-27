/** Owns one bounded Sass initialization task; every terminal path terminates its Node thread. */
import { Worker } from 'node:worker_threads';
import {
  type PreviewSassCompileInput,
  type PreviewSassCompileResult,
  type PreviewSassTask,
  type PreviewSassTaskFactory,
} from '../esbuild/previewSassCompiler';
import { createPreviewCompilerWorkerOptions } from './previewCompilerWorkerIsolation';

const MAXIMUM_TASK_MS = 30_000;
const MAXIMUM_CSS_BYTES = 128 * 1024 * 1024;
const MAXIMUM_LOADED_URLS = 50_000;
const SASS_TASK_HEAP_MB = 512;

/** Composes finite tasks without loading project Sass in VS Code's host or the main compiler. */
export function createPreviewSassWorkerTaskFactory(workerPath: string): PreviewSassTaskFactory {
  return (input, signal) => new PreviewSassWorkerTask(workerPath, input, signal);
}

/** Single-use task that preloads only the compiler, leaving style reads until compile(). */
class PreviewSassWorkerTask implements PreviewSassTask {
  private requested = false;
  private settled = false;
  private disposal: Promise<void> | undefined;
  private readonly result: Promise<PreviewSassCompileResult | undefined>;
  private readonly settle: (result: PreviewSassCompileResult | undefined) => void;
  private readonly worker: Worker;
  private readonly timer: ReturnType<typeof setTimeout>;
  private readonly abort = (): void => void this.dispose();

  /** Starts one resource-limited initialization; no Sass source file is read at this boundary. */
  public constructor(
    workerPath: string,
    input: PreviewSassCompileInput,
    private readonly signal?: AbortSignal,
  ) {
    const options = createPreviewCompilerWorkerOptions(process.env, SASS_TASK_HEAP_MB);
    this.worker = new Worker(workerPath, {
      ...options,
      execArgv: [...options.execArgv],
      workerData: input,
    });
    let complete: ((result: PreviewSassCompileResult | undefined) => void) | undefined;
    this.result = new Promise((resolve) => {
      complete = resolve;
    });
    this.settle = (result) => {
      complete?.(result);
    };
    this.timer = setTimeout(() => void this.dispose(), MAXIMUM_TASK_MS);
    this.timer.unref();
    this.worker.once('message', (message: unknown) => {
      this.finish(readSassResult(message));
      void this.dispose();
    });
    this.worker.once('error', () => {
      this.finish(undefined);
      void this.dispose();
    });
    this.worker.once('exit', () => {
      this.finish(undefined);
      void this.dispose();
    });
    signal?.addEventListener('abort', this.abort, { once: true });
    if (signal?.aborted === true) void this.dispose();
  }

  /** Starts the only compile request; repeated callers share its exact result. */
  public compile(): Promise<PreviewSassCompileResult | undefined> {
    if (!this.requested && !this.settled) {
      this.requested = true;
      try {
        this.worker.postMessage({ type: 'compile' });
      } catch {
        this.finish(undefined);
        void this.dispose();
      }
    }
    return this.result;
  }

  /** Resolves unused/cancelled work as a miss and waits for physical thread termination once. */
  public dispose(): Promise<void> {
    if (this.disposal !== undefined) return this.disposal;
    this.finish(undefined);
    this.disposal = this.worker.terminate().then(
      () => undefined,
      () => undefined,
    );
    return this.disposal;
  }

  /** Settles once and removes every request-owned timer/listener before exposing a result. */
  private finish(result: PreviewSassCompileResult | undefined): void {
    if (this.settled) return;
    this.settled = true;
    clearTimeout(this.timer);
    this.signal?.removeEventListener('abort', this.abort);
    this.settle(result);
  }
}

/** Rejects malformed or excessive transport data so the ordinary Sass path remains available. */
function readSassResult(value: unknown): PreviewSassCompileResult | undefined {
  if (typeof value !== 'object' || value === null) return undefined;
  const record = value as Readonly<Record<string, unknown>>;
  if (
    typeof record.css !== 'string' ||
    Buffer.byteLength(record.css) > MAXIMUM_CSS_BYTES ||
    !Array.isArray(record.loadedUrls) ||
    record.loadedUrls.length > MAXIMUM_LOADED_URLS
  )
    return undefined;
  try {
    const loadedUrls: URL[] = [];
    for (const value of record.loadedUrls as readonly unknown[]) {
      if (typeof value !== 'string') return undefined;
      loadedUrls.push(new URL(value));
    }
    return { css: record.css, loadedUrls };
  } catch {
    return undefined;
  }
}
