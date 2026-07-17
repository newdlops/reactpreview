/**
 * Implements the preview compiler port through a dedicated Node worker thread.
 * CPU-heavy TypeScript parsing, reverse component discovery, source transforms, and esbuild plugin
 * callbacks therefore cannot stall VS Code's extension-host event loop or editor interactions.
 */
import path from 'node:path';
import { Worker } from 'node:worker_threads';
import type { PreviewCompiler } from '../../application/previewCompiler';
import {
  PreviewCompilationError,
  type PreviewBuildRequest,
  type PreviewBundle,
} from '../../domain/preview';
import {
  PreviewBuildCancelledError,
  throwIfPreviewBuildCancelled,
  type PreviewBuildExecutionContext,
} from '../../domain/previewBuildExecution';
import {
  deserializePreviewCompilerWorkerError,
  isPreviewCompilerWorkerResponse,
  type PreviewCompilerWorkerRequest,
} from './previewCompilerWorkerProtocol';

/** Minimal event boundary implemented by both Node Worker and deterministic test transports. */
export interface PreviewCompilerWorkerTransport {
  /** Registers a callback for an unrecoverable worker error. */
  readonly onError: (listener: (error: Error) => void) => void;
  /** Registers a callback for worker process exit. */
  readonly onExit: (listener: (exitCode: number) => void) => void;
  /** Registers a callback for a structured response. */
  readonly onMessage: (listener: (message: unknown) => void) => void;
  /** Sends a structured request to the background worker. */
  readonly postMessage: (message: PreviewCompilerWorkerRequest) => void;
  /** Force-terminates the worker after graceful compiler shutdown or transport failure. */
  readonly terminate: () => Promise<number>;
}

/** Optional transport factory used to isolate Node worker construction in unit tests. */
export interface PreviewCompilerWorkerClientOptions {
  /** Creates one transport; omitted in production to use `node:worker_threads`. */
  readonly createTransport?: () => PreviewCompilerWorkerTransport;
}

/** One unresolved compile request and its thread-local callback/cancellation ownership. */
interface PendingWorkerCompilation {
  /** Removes the caller signal listener after every settlement path. */
  readonly detachAbort: () => void;
  /** Optional progress callback retained only on the extension-host side. */
  readonly reportProgress?: PreviewBuildExecutionContext['reportProgress'];
  /** Rejects the caller promise. */
  readonly reject: (error: Error) => void;
  /** Resolves the caller promise with transferred bytes. */
  readonly resolve: (bundle: PreviewBundle) => void;
}

/** Wraps Node's EventEmitter-style Worker API in the narrow transport boundary. */
class NodePreviewCompilerWorkerTransport implements PreviewCompilerWorkerTransport {
  private readonly worker: Worker;

  /** Creates one worker from the packaged compiler entry path. */
  public constructor(workerPath: string) {
    this.worker = new Worker(workerPath);
  }

  /** Registers one error listener. */
  public onError(listener: (error: Error) => void): void {
    this.worker.on('error', listener);
  }

  /** Registers one exit listener. */
  public onExit(listener: (exitCode: number) => void): void {
    this.worker.on('exit', listener);
  }

  /** Registers one message listener. */
  public onMessage(listener: (message: unknown) => void): void {
    this.worker.on('message', listener);
  }

  /** Sends one request without transferring editor-owned source buffers. */
  public postMessage(message: PreviewCompilerWorkerRequest): void {
    this.worker.postMessage(message);
  }

  /** Terminates the underlying worker and returns its exit code. */
  public terminate(): Promise<number> {
    return this.worker.terminate();
  }
}

/** Background-thread implementation of the application PreviewCompiler port. */
export class PreviewCompilerWorkerClient implements PreviewCompiler {
  private disposed = false;
  private nextRequestId = 1;
  private readonly pending = new Map<number, PendingWorkerCompilation>();
  private shutdownPromise: Promise<void> | undefined;
  private shutdownResolver: (() => void) | undefined;
  private transport: PreviewCompilerWorkerTransport | undefined;

  /**
   * Creates a lazy worker client so extension activation itself performs no background allocation.
   *
   * @param workerPath Packaged absolute path to the standalone compiler worker script.
   * @param options Optional deterministic transport factory for tests.
   */
  public constructor(
    private readonly workerPath: string,
    private readonly options: PreviewCompilerWorkerClientOptions = {},
  ) {}

  /**
   * Sends one immutable request to the worker and mirrors progress/cancellation on the host side.
   *
   * @param request Serializable source snapshot and build policy.
   * @param context Optional host-owned progress callback and AbortSignal.
   * @returns Bundle whose large byte arrays were transferred from the worker without copying.
   */
  public compile(
    request: PreviewBuildRequest,
    context?: PreviewBuildExecutionContext,
  ): Promise<PreviewBundle> {
    if (this.disposed) {
      return Promise.reject(
        new PreviewCompilationError('The background React preview compiler is already closed.', []),
      );
    }
    try {
      throwIfPreviewBuildCancelled(context?.signal);
    } catch (error) {
      return Promise.reject(error instanceof Error ? error : new PreviewBuildCancelledError());
    }

    const id = this.nextRequestId++;
    return new Promise<PreviewBundle>((resolve, reject) => {
      const abort = (): void => {
        const pending = this.pending.get(id);
        if (pending === undefined) {
          return;
        }
        this.pending.delete(id);
        pending.detachAbort();
        try {
          this.transport?.postMessage({ id, type: 'cancel' });
        } catch {
          // Worker failure is handled by its error/exit event; cancellation still settles now.
        }
        reject(new PreviewBuildCancelledError());
      };
      const detachAbort = attachAbortListener(context?.signal, abort);
      const pending: PendingWorkerCompilation = {
        detachAbort,
        reject,
        resolve,
        ...(context?.reportProgress === undefined
          ? {}
          : { reportProgress: context.reportProgress }),
      };
      this.pending.set(id, pending);
      try {
        this.getTransport().postMessage({ id, request, type: 'compile' });
      } catch (error) {
        this.pending.delete(id);
        detachAbort();
        reject(createWorkerTransportError(error));
      }
    });
  }

  /** Starts idempotent ordered shutdown and rejects work that can no longer be committed. */
  public shutdown(): Promise<void> {
    if (this.shutdownPromise !== undefined) {
      return this.shutdownPromise;
    }
    this.disposed = true;
    this.rejectAllPending(new PreviewBuildCancelledError());
    const activeTransport = this.transport;
    if (activeTransport === undefined) {
      this.shutdownPromise = Promise.resolve();
      return this.shutdownPromise;
    }

    this.shutdownPromise = new Promise<void>((resolve) => {
      this.shutdownResolver = resolve;
      try {
        activeTransport.postMessage({ type: 'shutdown' });
      } catch {
        this.finishShutdown(activeTransport);
      }
    });
    return this.shutdownPromise;
  }

  /** Allows VS Code subscription disposal while deactivation awaits the same shutdown promise. */
  public dispose(): void {
    void this.shutdown();
  }

  /** Lazily creates and wires one restartable worker transport. */
  private getTransport(): PreviewCompilerWorkerTransport {
    if (this.transport !== undefined) {
      return this.transport;
    }
    const transport =
      this.options.createTransport?.() ??
      new NodePreviewCompilerWorkerTransport(path.resolve(this.workerPath));
    this.transport = transport;
    transport.onMessage((message) => {
      if (this.transport === transport) {
        this.handleMessage(message, transport);
      }
    });
    transport.onError((error) => {
      if (this.transport === transport) {
        this.handleTransportFailure(error, transport);
      }
    });
    transport.onExit((exitCode) => {
      if (this.transport === transport) {
        this.handleTransportFailure(
          new Error(`Background preview compiler exited with code ${exitCode.toString()}.`),
          transport,
        );
      }
    });
    return transport;
  }

  /** Routes one validated worker response to its owning host-side promise or progress callback. */
  private handleMessage(message: unknown, transport: PreviewCompilerWorkerTransport): void {
    if (!isPreviewCompilerWorkerResponse(message)) {
      this.handleTransportFailure(
        new Error('Background compiler sent an invalid response.'),
        transport,
      );
      return;
    }
    if (message.type === 'shutdown-complete') {
      this.finishShutdown(transport);
      return;
    }
    const pending = this.pending.get(message.id);
    if (pending === undefined) {
      return;
    }
    if (message.type === 'progress') {
      pending.reportProgress?.(message.stage);
      return;
    }
    this.pending.delete(message.id);
    pending.detachAbort();
    if (message.type === 'success') {
      pending.resolve(message.bundle);
    } else {
      pending.reject(deserializePreviewCompilerWorkerError(message.error));
    }
  }

  /** Rejects live work after a worker crash and leaves a future compile free to start a new worker. */
  private handleTransportFailure(error: Error, transport: PreviewCompilerWorkerTransport): void {
    this.transport = undefined;
    if (this.disposed) {
      this.finishShutdown(transport);
      return;
    }
    this.rejectAllPending(createWorkerTransportError(error));
    void transport.terminate().catch(() => undefined);
  }

  /** Detaches listeners logically, terminates the acknowledged worker, and resolves deactivation. */
  private finishShutdown(transport: PreviewCompilerWorkerTransport): void {
    if (this.transport === transport) {
      this.transport = undefined;
    }
    const resolve = this.shutdownResolver;
    this.shutdownResolver = undefined;
    void transport.terminate().then(
      () => resolve?.(),
      () => resolve?.(),
    );
  }

  /** Rejects and detaches every pending request without retaining panel-owned AbortSignals. */
  private rejectAllPending(error: Error): void {
    const pendingRequests = [...this.pending.values()];
    this.pending.clear();
    for (const pending of pendingRequests) {
      pending.detachAbort();
      pending.reject(error);
    }
  }
}

/** Registers one cancellation callback and returns an idempotent listener cleanup. */
function attachAbortListener(signal: AbortSignal | undefined, abort: () => void): () => void {
  if (signal === undefined) {
    return () => undefined;
  }
  signal.addEventListener('abort', abort, { once: true });
  return () => {
    signal.removeEventListener('abort', abort);
  };
}

/** Converts worker construction, protocol, and crash failures into an actionable domain error. */
function createWorkerTransportError(error: unknown): PreviewCompilationError {
  const message = error instanceof Error ? error.message : String(error);
  return new PreviewCompilationError(
    `Background preview compiler unavailable: ${message}`,
    [{ message, severity: 'error' }],
    error,
  );
}
