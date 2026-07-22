/**
 * Owns serialized background compilation independently from the worker entry point.
 * Keeping scheduling here makes priority, cancellation, transfer, and shutdown behavior testable
 * without importing VS Code or creating a real thread.
 */
import type { PreviewCompiler } from '../../application/previewCompiler';
import type { PreviewBuildIntent, PreviewBuildRequest } from '../../domain/preview';
import {
  PreviewBuildCancelledError,
  PreviewBuildStalledError,
} from '../../domain/previewBuildExecution';
import { EsbuildPreviewCompiler } from '../esbuild/esbuildPreviewCompiler';
import { attachPreviewArtifactMetadata } from '../vscode/previewArtifactLayout';
import {
  collectPreviewBundleTransferList,
  serializePreviewCompilerWorkerError,
  type PreviewCompilerWorkerCompileRequest,
  type PreviewCompilerWorkerRequest,
  type PreviewCompilerWorkerResponse,
} from './previewCompilerWorkerProtocol';

/** Minimal parent-port boundary used by the worker scheduler. */
export interface PreviewCompilerWorkerPort {
  /** Stops accepting messages once compiler shutdown is complete. */
  readonly close: () => void;
  /** Subscribes to structured requests from the extension host. */
  readonly onMessage: (listener: (message: PreviewCompilerWorkerRequest) => void) => void;
  /** Returns a response and optionally transfers bundle buffers without copying. */
  readonly postMessage: (
    message: PreviewCompilerWorkerResponse,
    transferList?: readonly ArrayBuffer[],
  ) => void;
}

/** Compiler operations required by the worker scheduler. */
export interface PreviewCompilerWorkerBackend extends PreviewCompiler {
  /** Stops native compiler state after active work has observed cancellation. */
  readonly shutdown: () => Promise<void>;
}

/** One queued compilation that has not yet allocated a compiler AbortController. */
interface QueuedPreviewCompilation {
  /** Immutable request received from the host. */
  readonly message: PreviewCompilerWorkerCompileRequest;
  /** Lower values run first: cold foreground, complete foreground, then optional enrichment. */
  readonly priority: PreviewCompilationPriority;
}

/** Stable scheduler tiers that preserve fast first paint without making required full work optional. */
type PreviewCompilationPriority = 0 | 1 | 2;

const MAX_QUEUED_COMPILATIONS = 8;

/** Serial worker scheduler that owns all compiler caches and native esbuild lifecycle. */
export class PreviewCompilerWorkerServer {
  private activeBuildIntent: PreviewBuildIntent | undefined;
  private activeController: AbortController | undefined;
  private activeRequestId: number | undefined;
  private finalizing = false;
  private readonly queue: QueuedPreviewCompilation[] = [];
  private running = false;
  private shuttingDown = false;

  /**
   * Creates a worker server around one trusted parent transport and compiler backend.
   *
   * @param port Parent worker-thread port or deterministic test transport.
   * @param compiler Background compiler owning native graph caches.
   */
  public constructor(
    private readonly port: PreviewCompilerWorkerPort,
    private readonly compiler: PreviewCompilerWorkerBackend = new EsbuildPreviewCompiler(),
  ) {}

  /** Starts request routing; the compiler itself remains lazy until the first compile message. */
  public start(): void {
    this.port.onMessage((message) => {
      this.handleRequest(message);
    });
  }

  /** Routes compile, cancellation, and ordered shutdown requests. */
  private handleRequest(message: PreviewCompilerWorkerRequest): void {
    if (message.type === 'cancel') {
      this.cancel(message.id);
      return;
    }
    if (message.type === 'shutdown') {
      this.requestShutdown();
      return;
    }
    if (this.shuttingDown) {
      this.postFailure(
        message.id,
        new PreviewBuildCancelledError(),
        undefined,
        message.request.documentPath,
      );
      return;
    }
    this.enqueue(message);
  }

  /** Inserts foreground work ahead of queued enrichment while preserving FIFO order per intent. */
  private enqueue(message: PreviewCompilerWorkerCompileRequest): void {
    const queued = {
      message,
      priority: selectCompilationPriority(message.request),
    };
    if (!this.reserveQueueCapacity(queued)) return;
    const laterIndex = this.queue.findIndex((candidate) => candidate.priority > queued.priority);
    if (laterIndex < 0) {
      this.queue.push(queued);
    } else {
      this.queue.splice(laterIndex, 0, queued);
    }
    this.preemptActiveContextEnrichment(queued);
    void this.drain();
  }

  /**
   * Gives first paint ownership of the serialized compiler ahead of optional full enrichment.
   * The host also watches the cancellation acknowledgement and recycles a native build that does
   * not observe AbortSignal, so this cooperative abort cannot leave the foreground request stuck.
   */
  private preemptActiveContextEnrichment(queued: QueuedPreviewCompilation): void {
    if (
      queued.message.request.buildIntent === 'context-enrichment' ||
      this.activeBuildIntent !== 'context-enrichment' ||
      this.activeController?.signal.aborted === true
    ) {
      return;
    }
    this.activeController?.abort();
  }

  /** Keeps cloned editor snapshots bounded and lets a first-paint request displace enrichment. */
  private reserveQueueCapacity(queued: QueuedPreviewCompilation): boolean {
    if (this.queue.length < MAX_QUEUED_COMPILATIONS) return true;
    let replaceableIndex = -1;
    if (queued.message.request.buildIntent !== 'context-enrichment') {
      for (let index = this.queue.length - 1; index >= 0; index -= 1) {
        if (this.queue[index]?.message.request.buildIntent === 'context-enrichment') {
          replaceableIndex = index;
          break;
        }
      }
    }
    if (replaceableIndex >= 0) {
      const [replaced] = this.queue.splice(replaceableIndex, 1);
      if (replaced !== undefined) {
        this.postFailure(
          replaced.message.id,
          new PreviewBuildStalledError(
            replaced.message.request.documentPath,
            undefined,
            0,
            'queue-capacity',
          ),
          undefined,
          replaced.message.request.documentPath,
        );
      }
      return true;
    }
    this.postFailure(
      queued.message.id,
      new PreviewBuildStalledError(
        queued.message.request.documentPath,
        undefined,
        0,
        'queue-capacity',
      ),
      undefined,
      queued.message.request.documentPath,
    );
    return false;
  }

  /** Aborts active work or removes a queued revision before it consumes analysis resources. */
  private cancel(requestId: number): void {
    if (this.activeRequestId === requestId) {
      this.activeController?.abort();
      return;
    }
    const queuedIndex = this.queue.findIndex((entry) => entry.message.id === requestId);
    if (queuedIndex < 0) {
      return;
    }
    const [queued] = this.queue.splice(queuedIndex, 1);
    this.postFailure(
      requestId,
      new PreviewBuildCancelledError(),
      undefined,
      queued?.message.request.documentPath,
    );
  }

  /** Cancels all work and waits for active compiler cleanup before acknowledging shutdown. */
  private requestShutdown(): void {
    if (this.shuttingDown) {
      return;
    }
    this.shuttingDown = true;
    this.activeController?.abort();
    const queued = this.queue.splice(0);
    for (const entry of queued) {
      this.postFailure(
        entry.message.id,
        new PreviewBuildCancelledError(),
        undefined,
        entry.message.request.documentPath,
      );
    }
    if (!this.running) {
      void this.finalize();
    }
  }

  /** Executes at most one compile so large tabs cannot multiply peak graph memory. */
  private async drain(): Promise<void> {
    if (this.running || this.shuttingDown) {
      return;
    }
    const queued = this.queue.shift();
    if (queued === undefined) {
      return;
    }
    this.running = true;
    const controller = new AbortController();
    this.activeController = controller;
    this.activeBuildIntent = queued.message.request.buildIntent ?? 'foreground';
    this.activeRequestId = queued.message.id;
    try {
      this.port.postMessage({ id: queued.message.id, type: 'started' });
      const compiledBundle = await this.compiler.compile(queued.message.request, {
        reportProgress: (stage) => {
          this.port.postMessage({ id: queued.message.id, stage, type: 'progress' });
        },
        signal: controller.signal,
      });
      if (controller.signal.aborted) {
        throw new PreviewBuildCancelledError();
      }
      const bundle = attachPreviewArtifactMetadata(compiledBundle);
      this.port.postMessage(
        { bundle, id: queued.message.id, type: 'success' },
        collectPreviewBundleTransferList(bundle),
      );
    } catch (error) {
      this.postFailure(
        queued.message.id,
        error,
        controller.signal,
        queued.message.request.documentPath,
      );
    } finally {
      this.activeController = undefined;
      this.activeBuildIntent = undefined;
      this.activeRequestId = undefined;
      this.running = false;
      if (this.shouldFinalizeAfterRun()) {
        await this.finalize();
      } else {
        void this.drain();
      }
    }
  }

  /** Reads mutable shutdown state after an awaited compiler operation. */
  private shouldFinalizeAfterRun(): boolean {
    return this.shuttingDown;
  }

  /** Serializes one request failure without allowing port errors to corrupt queue state. */
  private postFailure(
    requestId: number,
    error: unknown,
    signal?: AbortSignal,
    target?: string,
  ): void {
    this.port.postMessage({
      error: serializePreviewCompilerWorkerError(error, signal, target),
      id: requestId,
      type: 'failure',
    });
  }

  /** Stops native esbuild exactly once, acknowledges the host, and closes the parent port. */
  private async finalize(): Promise<void> {
    if (this.finalizing) {
      return;
    }
    this.finalizing = true;
    await this.compiler.shutdown();
    this.port.postMessage({ type: 'shutdown-complete' });
    this.port.close();
  }
}

/** Maps scheduling intent and completeness to a stable FIFO-preserving worker priority. */
function selectCompilationPriority(request: PreviewBuildRequest): PreviewCompilationPriority {
  if (request.buildIntent === 'context-enrichment') return 2;
  return request.preparationMode === 'fast' ? 0 : 1;
}
