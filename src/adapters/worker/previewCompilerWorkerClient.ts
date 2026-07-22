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
  PreviewBuildStalledError,
  throwIfPreviewBuildCancelled,
  type PreviewBuildExecutionContext,
} from '../../domain/previewBuildExecution';
import type { PreviewProgressStage } from '../../domain/previewProgress';
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
  /** Extension-packaged production node_modules used to seed a compatible React runtime. */
  readonly bundledNodeModulesPath?: string;
  /** Creates one transport; omitted in production to use `node:worker_threads`. */
  readonly createTransport?: () => PreviewCompilerWorkerTransport;
  /** Persistent global-storage root for cross-workspace dependency environments. */
  readonly managedDependencyStoreRoot?: string;
  /** Test/host override for the hard per-request watchdog; production selects a bounded mode limit. */
  readonly compilationTimeoutMs?: number;
  /** Grace period after cancellation before a non-responsive worker is recycled. */
  readonly cancellationGraceMs?: number;
  /** Grace period for native compiler shutdown before the thread is force-terminated. */
  readonly shutdownGraceMs?: number;
  /** Quiet period after which completed compiler caches are released to return memory to the OS. */
  readonly idleWorkerTimeoutMs?: number;
  /** V8 heap ceiling for analysis running inside the isolated compiler thread. */
  readonly workerMemoryLimitMb?: number;
}

/** Serializable immutable bootstrap data delivered before the worker constructs its compiler. */
export interface PreviewCompilerWorkerBootstrap {
  readonly bundledNodeModulesPath?: string;
  readonly managedDependencyStoreRoot?: string;
}

/** One unresolved compile request and its thread-local callback/cancellation ownership. */
interface PendingWorkerCompilation {
  /** Clears the hard build watchdog after any terminal settlement. */
  readonly clearDeadline: () => void;
  /** Removes the caller signal listener after every settlement path. */
  readonly detachAbort: () => void;
  /** Last compiler milestone retained for actionable watchdog diagnostics. */
  lastStage?: PreviewProgressStage;
  /** Optional progress callback retained only on the extension-host side. */
  readonly reportProgress?: PreviewBuildExecutionContext['reportProgress'];
  /** Rejects the caller promise. */
  readonly reject: (error: Error) => void;
  /** Resolves the caller promise with transferred bytes. */
  readonly resolve: (bundle: PreviewBundle) => void;
  /** Starts the hard deadline only after this request leaves the serialized worker queue. */
  readonly startDeadline: () => void;
  /** Exact worker owning this request; old responses cannot affect a replacement worker. */
  readonly transport: PreviewCompilerWorkerTransport;
  /** Absolute target identity included in watchdog and memory-limit diagnostics. */
  readonly target: string;
  /** Host clock captured when the worker confirms this request became active. */
  startedAt?: number;
}

/** One cancelled request waiting briefly for a terminal acknowledgement from its worker. */
interface PendingCancellationAcknowledgement {
  /** Stops the grace timer after an acknowledgement or worker failure. */
  readonly clearTimer: () => void;
  /** Worker that must be recycled if it cannot acknowledge cancellation. */
  readonly transport: PreviewCompilerWorkerTransport;
}

const DEFAULT_FAST_COMPILATION_TIMEOUT_MS = 45_000;
const DEFAULT_FULL_COMPILATION_TIMEOUT_MS = 120_000;
const DEFAULT_QUEUE_ACQUISITION_TIMEOUT_MS = 120_000;
const DEFAULT_CANCELLATION_GRACE_MS = 3_000;
const DEFAULT_SHUTDOWN_GRACE_MS = 5_000;
const DEFAULT_IDLE_WORKER_TIMEOUT_MS = 30_000;
const DEFAULT_WORKER_MEMORY_LIMIT_MB = 512;
const DEFAULT_ESBUILD_PARALLELISM = '4';
const DEFAULT_ESBUILD_MEMORY_LIMIT = '384MiB';

/** Wraps Node's EventEmitter-style Worker API in the narrow transport boundary. */
class NodePreviewCompilerWorkerTransport implements PreviewCompilerWorkerTransport {
  private readonly worker: Worker;

  /** Creates one worker from the packaged compiler entry path. */
  public constructor(
    workerPath: string,
    bootstrap: PreviewCompilerWorkerBootstrap,
    memoryLimitMb = DEFAULT_WORKER_MEMORY_LIMIT_MB,
  ) {
    this.worker = new Worker(workerPath, {
      env: {
        ...process.env,
        // Esbuild's native Go service inherits the worker environment. GOMEMLIMIT is a soft heap
        // ceiling that forces earlier collection instead of allowing a fragmented route graph to
        // consume all system memory before the host-side watchdog can recycle the worker.
        GOMEMLIMIT: selectBoundedGoMemoryLimit(process.env.GOMEMLIMIT),
        GOMAXPROCS: selectBoundedGoParallelism(process.env.GOMAXPROCS),
      },
      resourceLimits: {
        maxOldGenerationSizeMb: normalizeWorkerMemoryLimit(memoryLimitMb),
      },
      workerData: bootstrap,
    });
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
  private readonly cancellationAcknowledgements = new Map<
    number,
    PendingCancellationAcknowledgement
  >();
  private disposed = false;
  private idleTimer: ReturnType<typeof setTimeout> | undefined;
  private nextRequestId = 1;
  private readonly pending = new Map<number, PendingWorkerCompilation>();
  private shutdownPromise: Promise<void> | undefined;
  private shutdownResolver: (() => void) | undefined;
  private shutdownTimer: ReturnType<typeof setTimeout> | undefined;
  private transport: PreviewCompilerWorkerTransport | undefined;
  private transportRetirement: Promise<void> | undefined;

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
    this.clearIdleRetirement();
    try {
      throwIfPreviewBuildCancelled(context?.signal);
    } catch (error) {
      return Promise.reject(error instanceof Error ? error : new PreviewBuildCancelledError());
    }
    const retirement = this.transportRetirement;
    if (retirement !== undefined) {
      return retirement.then(() => this.compile(request, context));
    }

    const id = this.nextRequestId++;
    return new Promise<PreviewBundle>((resolve, reject) => {
      const transport = this.getTransport();
      const abort = (): void => {
        const pending = this.pending.get(id);
        if (pending === undefined) {
          return;
        }
        this.pending.delete(id);
        pending.detachAbort();
        pending.clearDeadline();
        try {
          pending.transport.postMessage({ id, type: 'cancel' });
          this.expectCancellationAcknowledgement(id, pending.transport);
        } catch {
          // Worker failure is handled by its error/exit event; cancellation still settles now.
        }
        reject(new PreviewBuildCancelledError());
      };
      const detachAbort = attachAbortListener(context?.signal, abort);
      const timeoutMs = selectCompilationTimeoutMs(request, this.options.compilationTimeoutMs);
      const activationTimeoutMs = Math.max(timeoutMs, DEFAULT_QUEUE_ACQUISITION_TIMEOUT_MS);
      const activationDeadline = setTimeout(() => {
        this.handleCompilationTimeout(id, request.documentPath, activationTimeoutMs, transport);
      }, activationTimeoutMs);
      activationDeadline.unref();
      let deadline: ReturnType<typeof setTimeout> | undefined;
      const pending: PendingWorkerCompilation = {
        clearDeadline: () => {
          clearTimeout(activationDeadline);
          if (deadline !== undefined) clearTimeout(deadline);
        },
        detachAbort,
        reject,
        resolve,
        startDeadline: () => {
          if (deadline !== undefined) return;
          clearTimeout(activationDeadline);
          pending.startedAt = Date.now();
          deadline = setTimeout(() => {
            this.handleCompilationTimeout(id, request.documentPath, timeoutMs, transport);
          }, timeoutMs);
          deadline.unref();
        },
        target: request.documentPath,
        transport,
        ...(context?.reportProgress === undefined
          ? {}
          : { reportProgress: context.reportProgress }),
      };
      this.pending.set(id, pending);
      try {
        transport.postMessage({ id, request, type: 'compile' });
      } catch (error) {
        this.pending.delete(id);
        detachAbort();
        pending.clearDeadline();
        reject(createWorkerTransportError(error));
      }
    });
  }

  /** Starts idempotent ordered shutdown and rejects work that can no longer be committed. */
  public shutdown(): Promise<void> {
    if (this.shutdownPromise !== undefined) {
      return this.shutdownPromise;
    }
    this.clearIdleRetirement();
    this.disposed = true;
    this.rejectAllPending(new PreviewBuildCancelledError());
    const activeTransport = this.transport;
    if (activeTransport === undefined) {
      this.shutdownPromise = this.transportRetirement ?? Promise.resolve();
      return this.shutdownPromise;
    }

    this.shutdownPromise = new Promise<void>((resolve) => {
      this.shutdownResolver = resolve;
      this.startShutdownDeadline(activeTransport);
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
      new NodePreviewCompilerWorkerTransport(
        path.resolve(this.workerPath),
        {
          ...(this.options.bundledNodeModulesPath === undefined
            ? {}
            : { bundledNodeModulesPath: path.resolve(this.options.bundledNodeModulesPath) }),
          ...(this.options.managedDependencyStoreRoot === undefined
            ? {}
            : {
                managedDependencyStoreRoot: path.resolve(this.options.managedDependencyStoreRoot),
              }),
        },
        this.options.workerMemoryLimitMb ?? DEFAULT_WORKER_MEMORY_LIMIT_MB,
      );
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
    if (message.type === 'success' || message.type === 'failure') {
      this.acknowledgeCancellation(message.id, transport);
    }
    const pending = this.pending.get(message.id);
    if (pending === undefined) {
      if (message.type === 'success' || message.type === 'failure') {
        this.scheduleIdleRetirement(transport);
      }
      return;
    }
    if (message.type === 'started') {
      pending.startDeadline();
      return;
    }
    if (message.type === 'progress') {
      pending.startDeadline();
      pending.lastStage = message.stage;
      pending.reportProgress?.(message.stage);
      return;
    }
    this.pending.delete(message.id);
    pending.detachAbort();
    pending.clearDeadline();
    if (message.type === 'success') {
      pending.resolve(message.bundle);
    } else {
      pending.reject(deserializePreviewCompilerWorkerError(message.error));
    }
    this.scheduleIdleRetirement(transport);
  }

  /** Rejects live work after a worker crash and leaves a future compile free to start a new worker. */
  private handleTransportFailure(error: Error, transport: PreviewCompilerWorkerTransport): void {
    this.transport = undefined;
    this.clearIdleRetirement();
    this.clearCancellationAcknowledgements(transport);
    if (this.disposed) {
      this.finishShutdown(transport);
      return;
    }
    const active = [...this.pending.values()].find((pending) => pending.transport === transport);
    const failure =
      active !== undefined && isWorkerMemoryFailure(error)
        ? new PreviewBuildStalledError(
            active.target,
            active.lastStage,
            Math.max(0, Date.now() - (active.startedAt ?? Date.now())),
            'memory',
          )
        : createWorkerTransportError(error);
    this.rejectAllPending(failure);
    void this.beginTransportRetirement(transport);
  }

  /** Detaches listeners logically, terminates the acknowledged worker, and resolves deactivation. */
  private finishShutdown(transport: PreviewCompilerWorkerTransport): void {
    if (this.transport === transport) {
      this.transport = undefined;
    }
    this.clearIdleRetirement();
    this.clearCancellationAcknowledgements(transport);
    if (this.shutdownTimer !== undefined) {
      clearTimeout(this.shutdownTimer);
      this.shutdownTimer = undefined;
    }
    const resolve = this.shutdownResolver;
    this.shutdownResolver = undefined;
    void this.beginTransportRetirement(transport).then(
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
      pending.clearDeadline();
      pending.reject(error);
    }
  }

  /** Recycles a worker whose hard deadline expired and rejects every request queued behind it. */
  private handleCompilationTimeout(
    requestId: number,
    target: string,
    elapsedMs: number,
    transport: PreviewCompilerWorkerTransport,
  ): void {
    const pending = this.pending.get(requestId);
    if (pending?.transport !== transport || this.transport !== transport) {
      return;
    }
    try {
      transport.postMessage({ id: requestId, type: 'cancel' });
    } catch {
      // Forced termination below is the authoritative recovery boundary.
    }
    this.recycleUnresponsiveTransport(
      new PreviewBuildStalledError(target, pending.lastStage, elapsedMs),
      transport,
    );
  }

  /** Starts a short acknowledgement window so a cancelled native build cannot poison the queue. */
  private expectCancellationAcknowledgement(
    requestId: number,
    transport: PreviewCompilerWorkerTransport,
  ): void {
    this.acknowledgeCancellation(requestId, transport);
    const graceMs = normalizePositiveTimeout(
      this.options.cancellationGraceMs,
      DEFAULT_CANCELLATION_GRACE_MS,
    );
    const timer = setTimeout(() => {
      const acknowledgement = this.cancellationAcknowledgements.get(requestId);
      if (acknowledgement?.transport !== transport || this.transport !== transport) return;
      this.cancellationAcknowledgements.delete(requestId);
      this.recycleUnresponsiveTransport(
        new PreviewBuildStalledError(
          'cancelled preview revision',
          undefined,
          graceMs,
          'cancel-timeout',
        ),
        transport,
      );
    }, graceMs);
    timer.unref();
    this.cancellationAcknowledgements.set(requestId, {
      clearTimer: () => {
        clearTimeout(timer);
      },
      transport,
    });
  }

  /** Clears one cancellation grace timer only for the worker that received that cancellation. */
  private acknowledgeCancellation(
    requestId: number,
    transport: PreviewCompilerWorkerTransport,
  ): void {
    const acknowledgement = this.cancellationAcknowledgements.get(requestId);
    if (acknowledgement?.transport !== transport) return;
    this.cancellationAcknowledgements.delete(requestId);
    acknowledgement.clearTimer();
  }

  /** Clears every grace timer owned by a worker that is already terminating. */
  private clearCancellationAcknowledgements(transport: PreviewCompilerWorkerTransport): void {
    for (const [requestId, acknowledgement] of this.cancellationAcknowledgements) {
      if (acknowledgement.transport !== transport) continue;
      this.cancellationAcknowledgements.delete(requestId);
      acknowledgement.clearTimer();
    }
  }

  /** Quarantines one worker before termination so late messages cannot settle replacement work. */
  private recycleUnresponsiveTransport(
    error: PreviewBuildStalledError,
    transport: PreviewCompilerWorkerTransport,
  ): void {
    if (this.transport !== transport) return;
    this.transport = undefined;
    this.clearIdleRetirement();
    this.clearCancellationAcknowledgements(transport);
    this.rejectAllPending(error);
    void this.beginTransportRetirement(transport);
  }

  /** Forces deactivation to finish when a cancelled native build never acknowledges shutdown. */
  private startShutdownDeadline(transport: PreviewCompilerWorkerTransport): void {
    const graceMs = normalizePositiveTimeout(
      this.options.shutdownGraceMs,
      DEFAULT_SHUTDOWN_GRACE_MS,
    );
    this.shutdownTimer = setTimeout(() => {
      this.finishShutdown(transport);
    }, graceMs);
    this.shutdownTimer.unref();
  }

  /** Retires warm native graph caches after a short HMR window instead of retaining idle RSS. */
  private scheduleIdleRetirement(transport: PreviewCompilerWorkerTransport): void {
    this.clearIdleRetirement();
    if (this.disposed || this.transport !== transport || this.pending.size > 0) return;
    const timeoutMs = normalizePositiveTimeout(
      this.options.idleWorkerTimeoutMs,
      DEFAULT_IDLE_WORKER_TIMEOUT_MS,
    );
    this.idleTimer = setTimeout(() => {
      this.idleTimer = undefined;
      if (this.disposed || this.transport !== transport || this.pending.size > 0) return;
      // There is no active compile at this boundary. Direct termination closes esbuild's service
      // pipe immediately, while a future request lazily receives an independent fresh worker.
      this.transport = undefined;
      void this.beginTransportRetirement(transport);
    }, timeoutMs);
    this.idleTimer.unref();
  }

  /** Cancels pending cache retirement whenever hot work arrives or the worker is already leaving. */
  private clearIdleRetirement(): void {
    if (this.idleTimer === undefined) return;
    clearTimeout(this.idleTimer);
    this.idleTimer = undefined;
  }

  /** Serializes worker replacement so two native esbuild services cannot overlap their peak RSS. */
  private beginTransportRetirement(transport: PreviewCompilerWorkerTransport): Promise<void> {
    const existing = this.transportRetirement;
    if (existing !== undefined) return existing;
    const retirement = transport.terminate().then(
      () => undefined,
      () => undefined,
    );
    this.transportRetirement = retirement;
    void retirement.finally(() => {
      if (this.transportRetirement === retirement) this.transportRetirement = undefined;
    });
    return retirement;
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

/** Chooses a hard watchdog that protects memory while allowing complete monorepo analysis. */
function selectCompilationTimeoutMs(
  request: PreviewBuildRequest,
  configuredTimeoutMs: number | undefined,
): number {
  return normalizePositiveTimeout(
    configuredTimeoutMs,
    request.preparationMode === 'fast'
      ? DEFAULT_FAST_COMPILATION_TIMEOUT_MS
      : DEFAULT_FULL_COMPILATION_TIMEOUT_MS,
  );
}

/** Rejects non-finite or non-positive configuration values before scheduling host timers. */
function normalizePositiveTimeout(value: number | undefined, fallback: number): number {
  return value !== undefined && Number.isFinite(value) && value > 0 ? Math.floor(value) : fallback;
}

/** Keeps configured worker heaps within a useful range instead of disabling isolation accidentally. */
function normalizeWorkerMemoryLimit(value: number): number {
  return Number.isFinite(value) && value >= 128
    ? Math.min(Math.floor(value), DEFAULT_WORKER_MEMORY_LIMIT_MB)
    : DEFAULT_WORKER_MEMORY_LIMIT_MB;
}

/** Preserves a stricter inherited Go heap limit while clamping `off` and oversized host values. */
function selectBoundedGoMemoryLimit(configuredValue: string | undefined): string {
  if (configuredValue === undefined) return DEFAULT_ESBUILD_MEMORY_LIMIT;
  const match = /^([0-9]+(?:\.[0-9]+)?)([KMGT]i?B|B)?$/iu.exec(configuredValue.trim());
  if (match === null) return DEFAULT_ESBUILD_MEMORY_LIMIT;
  const numericValue = Number(match[1]);
  const unit = (match[2] ?? 'B').toUpperCase();
  const multipliers: Readonly<Record<string, number>> = {
    B: 1,
    GB: 1_000_000_000,
    GIB: 1024 ** 3,
    KB: 1_000,
    KIB: 1024,
    MB: 1_000_000,
    MIB: 1024 ** 2,
    TB: 1_000_000_000_000,
    TIB: 1024 ** 4,
  };
  const configuredBytes = numericValue * (multipliers[unit] ?? Number.POSITIVE_INFINITY);
  const maximumBytes = 384 * 1024 ** 2;
  return Number.isFinite(configuredBytes) && configuredBytes > 0 && configuredBytes <= maximumBytes
    ? configuredValue
    : DEFAULT_ESBUILD_MEMORY_LIMIT;
}

/** Limits inherited Go scheduler width so a host setting cannot multiply graph allocations. */
function selectBoundedGoParallelism(configuredValue: string | undefined): string {
  const parsed = Number.parseInt(configuredValue ?? '', 10);
  return Number.isSafeInteger(parsed) && parsed > 0
    ? Math.min(parsed, Number(DEFAULT_ESBUILD_PARALLELISM)).toString()
    : DEFAULT_ESBUILD_PARALLELISM;
}

/** Recognizes Node worker heap-limit failures so orchestration does not replay the same graph. */
function isWorkerMemoryFailure(error: Error): boolean {
  return /(?:ERR_WORKER_OUT_OF_MEMORY|heap limit|out of memory)/iu.test(
    `${error.name}: ${error.message}`,
  );
}
