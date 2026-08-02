/** One-shot worker client for complete route inventory collection. */
import path from 'node:path';
import { Worker } from 'node:worker_threads';
import type { PreviewBuildRequest } from '../../domain/preview';
import type {
  PreviewCompleteRouteInventoryTelemetryEvent,
  PreviewInspectorCompleteRouteInventory,
  PreviewInspectorCompleteRouteInventoryLimits,
} from '../esbuild/inspector/previewInspectorCompleteRouteInventory';
import type { PreviewCompilerWorkerBootstrap } from './previewCompilerWorkerClient';
import {
  isPreviewCompleteRouteInventoryWorkerResponse,
  type PreviewCompilerWorkerRequest,
} from './previewCompilerWorkerProtocol';
import {
  createPreviewCompilerWorkerOptions,
  PREVIEW_COMPILER_WORKER_SHUTDOWN_GRACE_MS,
  PREVIEW_INVENTORY_WORKER_OLD_GENERATION_LIMIT_MB,
  PREVIEW_INVENTORY_WORKER_TIMEOUT_MS,
} from './previewCompilerWorkerIsolation';

/** Stable terminal classifications used by campaign automation and failure triage. */
export type PreviewCompleteRouteInventoryWorkerErrorCode =
  | 'preview-inventory-cancelled'
  | 'preview-inventory-failed'
  | 'preview-inventory-memory-limit'
  | 'preview-inventory-timeout'
  | 'preview-inventory-worker-exit';

/** One terminal one-shot inventory failure. Inventory work is never retried implicitly. */
export class PreviewCompleteRouteInventoryWorkerError extends Error {
  public override readonly name = 'PreviewCompleteRouteInventoryWorkerError';
  public readonly lastProgress: PreviewCompleteRouteInventoryTelemetryEvent | undefined;

  /** Creates one stable failure code with its bounded diagnostic message. */
  public constructor(
    public readonly code: PreviewCompleteRouteInventoryWorkerErrorCode,
    message: string,
    options?: ErrorOptions & {
      readonly lastProgress?: PreviewCompleteRouteInventoryTelemetryEvent;
    },
  ) {
    super(message, options);
    this.lastProgress = options?.lastProgress;
  }
}

/** Minimal one-shot worker event boundary used by production and deterministic tests. */
export interface PreviewCompleteRouteInventoryWorkerTransport {
  readonly onError: (listener: (error: Error) => void) => void;
  readonly onExit: (listener: (exitCode: number) => void) => void;
  readonly onMessage: (listener: (message: unknown) => void) => void;
  readonly postMessage: (message: PreviewCompilerWorkerRequest) => void;
  readonly terminate: () => Promise<number>;
}

/** Exact worker construction identity exposed to transport tests. */
export interface PreviewCompleteRouteInventoryWorkerConfiguration {
  readonly env: NodeJS.ProcessEnv;
  readonly execArgv: readonly string[];
  readonly resourceLimits: Readonly<{ maxOldGenerationSizeMb: number }>;
  readonly workerData: PreviewCompilerWorkerBootstrap;
  readonly workerPath: string;
}

/** Optional bootstrap, environment, and deterministic transport seams. */
export interface PreviewCompleteRouteInventoryWorkerClientOptions {
  readonly bundledNodeModulesPath?: string;
  readonly createTransport?: (
    configuration: PreviewCompleteRouteInventoryWorkerConfiguration,
  ) => PreviewCompleteRouteInventoryWorkerTransport;
  readonly managedDependencyStoreRoot?: string;
  readonly onProgress?: (event: PreviewCompleteRouteInventoryTelemetryEvent) => void;
  readonly parentEnvironment?: Readonly<NodeJS.ProcessEnv>;
  /** Test seam only; production always uses the versioned five-second grace period. */
  readonly shutdownGraceMs?: number;
}

/** Thin wrapper around Node's worker-thread API. */
class NodePreviewCompleteRouteInventoryWorkerTransport implements PreviewCompleteRouteInventoryWorkerTransport {
  private readonly worker: Worker;

  /** Starts one Node worker with the already normalized construction policy. */
  public constructor(configuration: PreviewCompleteRouteInventoryWorkerConfiguration) {
    this.worker = new Worker(configuration.workerPath, {
      env: configuration.env,
      execArgv: [...configuration.execArgv],
      resourceLimits: configuration.resourceLimits,
      workerData: configuration.workerData,
    });
  }

  /** Registers the worker's unrecoverable error listener. */
  public onError(listener: (error: Error) => void): void {
    this.worker.on('error', listener);
  }

  /** Registers the worker exit listener. */
  public onExit(listener: (exitCode: number) => void): void {
    this.worker.on('exit', listener);
  }

  /** Registers the structured response listener. */
  public onMessage(listener: (message: unknown) => void): void {
    this.worker.on('message', listener);
  }

  /** Sends one immutable request to the worker thread. */
  public postMessage(message: PreviewCompilerWorkerRequest): void {
    this.worker.postMessage(message);
  }

  /** Force-terminates the worker after graceful compiler release or failure. */
  public terminate(): Promise<number> {
    return this.worker.terminate();
  }
}

/**
 * Starts a fresh compiler worker for exactly one inventory and releases the thread before resolve.
 *
 * No failure path retries the request, so memory pressure and process death remain stable terminals.
 */
export class PreviewCompleteRouteInventoryWorkerClient {
  /** Retains worker bootstrap inputs without allocating a worker until collection starts. */
  public constructor(
    private readonly workerPath: string,
    private readonly options: PreviewCompleteRouteInventoryWorkerClientOptions = {},
  ) {}

  /** Runs exactly one inventory request and never resolves before the worker is terminated. */
  public collectCompleteRouteInventory(
    request: PreviewBuildRequest,
    limits?: Partial<PreviewInspectorCompleteRouteInventoryLimits>,
    signal?: AbortSignal,
  ): Promise<PreviewInspectorCompleteRouteInventory> {
    if (signal?.aborted === true) {
      return Promise.reject(
        new PreviewCompleteRouteInventoryWorkerError(
          'preview-inventory-cancelled',
          'Complete route inventory was cancelled before its worker started.',
        ),
      );
    }

    return new Promise<PreviewInspectorCompleteRouteInventory>((resolve, reject) => {
      const configuration = this.createConfiguration();
      let transport: PreviewCompleteRouteInventoryWorkerTransport;
      try {
        transport =
          this.options.createTransport?.(configuration) ??
          new NodePreviewCompleteRouteInventoryWorkerTransport(configuration);
      } catch (error) {
        reject(classifyInventoryTransportError(error));
        return;
      }

      let finishing = false;
      let forcedFailure: PreviewCompleteRouteInventoryWorkerError | undefined;
      let latestProgress: PreviewCompleteRouteInventoryTelemetryEvent | undefined;
      let shutdownTimer: ReturnType<typeof setTimeout> | undefined;
      const timeoutTimer = setTimeout(() => {
        requestForcedShutdown(
          new PreviewCompleteRouteInventoryWorkerError(
            'preview-inventory-timeout',
            `Complete route inventory exceeded ${PREVIEW_INVENTORY_WORKER_TIMEOUT_MS.toString()} ms.`,
            latestProgress === undefined ? undefined : { lastProgress: latestProgress },
          ),
        );
      }, PREVIEW_INVENTORY_WORKER_TIMEOUT_MS);
      timeoutTimer.unref();

      const detachAbort = (): void => {
        signal?.removeEventListener('abort', abort);
      };
      const finish = (
        error: PreviewCompleteRouteInventoryWorkerError | undefined,
        inventory?: PreviewInspectorCompleteRouteInventory,
      ): void => {
        if (finishing) return;
        finishing = true;
        clearTimeout(timeoutTimer);
        if (shutdownTimer !== undefined) clearTimeout(shutdownTimer);
        detachAbort();
        void transport.terminate().then(
          () => {
            if (error !== undefined) reject(error);
            else if (inventory !== undefined) resolve(inventory);
            else {
              reject(
                new PreviewCompleteRouteInventoryWorkerError(
                  'preview-inventory-failed',
                  'Complete route inventory worker completed without an inventory.',
                ),
              );
            }
          },
          (terminationError: unknown) => {
            const earlierTerminal =
              error ??
              Object.freeze({
                type: 'complete-route-inventory-success' as const,
              });
            const terminationMessage =
              terminationError instanceof Error
                ? terminationError.message
                : String(terminationError);
            const failure = new PreviewCompleteRouteInventoryWorkerError(
              'preview-inventory-worker-exit',
              `Complete route inventory worker could not be terminated: ${terminationMessage}`,
              { cause: earlierTerminal },
            );
            Object.defineProperty(failure, 'terminationError', {
              enumerable: false,
              value: terminationError,
            });
            reject(failure);
          },
        );
      };
      const requestForcedShutdown = (error: PreviewCompleteRouteInventoryWorkerError): void => {
        if (finishing || forcedFailure !== undefined) return;
        forcedFailure = error;
        clearTimeout(timeoutTimer);
        detachAbort();
        try {
          transport.postMessage({ type: 'shutdown' });
        } catch {
          finish(error);
          return;
        }
        const graceMs = normalizeGraceMs(this.options.shutdownGraceMs);
        shutdownTimer = setTimeout(() => {
          finish(error);
        }, graceMs);
        shutdownTimer.unref();
      };
      const abort = (): void => {
        requestForcedShutdown(
          new PreviewCompleteRouteInventoryWorkerError(
            'preview-inventory-cancelled',
            'Complete route inventory was cancelled.',
            latestProgress === undefined ? undefined : { lastProgress: latestProgress },
          ),
        );
      };

      transport.onMessage((message) => {
        if (finishing) return;
        if (
          forcedFailure !== undefined &&
          typeof message === 'object' &&
          message !== null &&
          'type' in message &&
          message.type === 'complete-route-inventory-progress'
        ) {
          return;
        }
        if (!isPreviewCompleteRouteInventoryWorkerResponse(message, latestProgress)) {
          finish(
            forcedFailure ??
              new PreviewCompleteRouteInventoryWorkerError(
                'preview-inventory-failed',
                'Complete route inventory worker returned an invalid response.',
                latestProgress === undefined ? undefined : { lastProgress: latestProgress },
              ),
          );
          return;
        }
        if (message.type === 'complete-route-inventory-progress') {
          if (forcedFailure !== undefined) return;
          latestProgress = message.event;
          try {
            this.options.onProgress?.(message.event);
          } catch {
            // Observers cannot settle work, extend the watchdog, or affect cleanup.
          }
          return;
        }
        if (forcedFailure !== undefined) {
          finish(forcedFailure);
          return;
        }
        if (message.type === 'complete-route-inventory-success') {
          finish(undefined, message.inventory);
          return;
        }
        finish(
          new PreviewCompleteRouteInventoryWorkerError(
            message.error.code,
            message.error.message,
            latestProgress === undefined ? undefined : { lastProgress: latestProgress },
          ),
        );
      });
      transport.onError((error) => {
        finish(forcedFailure ?? classifyInventoryTransportError(error));
      });
      transport.onExit((exitCode) => {
        finish(
          forcedFailure ??
            new PreviewCompleteRouteInventoryWorkerError(
              'preview-inventory-worker-exit',
              `Complete route inventory worker exited before responding (code ${exitCode.toString()}).`,
            ),
        );
      });
      signal?.addEventListener('abort', abort, { once: true });

      try {
        transport.postMessage({
          ...(limits === undefined ? {} : { limits }),
          request,
          type: 'collect-complete-route-inventory',
        });
      } catch (error) {
        finish(classifyInventoryTransportError(error));
      }
    });
  }

  /** Freezes the exact bounded worker-thread configuration for this one request. */
  private createConfiguration(): PreviewCompleteRouteInventoryWorkerConfiguration {
    const workerOptions = createPreviewCompilerWorkerOptions(
      this.options.parentEnvironment ?? process.env,
      PREVIEW_INVENTORY_WORKER_OLD_GENERATION_LIMIT_MB,
    );
    return Object.freeze({
      ...workerOptions,
      workerData: Object.freeze({
        ...(this.options.bundledNodeModulesPath === undefined
          ? {}
          : { bundledNodeModulesPath: path.resolve(this.options.bundledNodeModulesPath) }),
        ...(this.options.managedDependencyStoreRoot === undefined
          ? {}
          : { managedDependencyStoreRoot: path.resolve(this.options.managedDependencyStoreRoot) }),
      }),
      workerPath: path.resolve(this.workerPath),
    });
  }
}

/** Maps OOM separately from all other worker transport failures without retrying either. */
function classifyInventoryTransportError(error: unknown): PreviewCompleteRouteInventoryWorkerError {
  const message = error instanceof Error ? error.message : String(error);
  const code =
    typeof error === 'object' && error !== null && 'code' in error ? String(error.code) : '';
  if (/(?:ERR_WORKER_OUT_OF_MEMORY|heap limit|out of memory)/iu.test(`${code} ${message}`)) {
    return new PreviewCompleteRouteInventoryWorkerError(
      'preview-inventory-memory-limit',
      `Complete route inventory worker exceeded its memory limit: ${message}`,
      { cause: error },
    );
  }
  return new PreviewCompleteRouteInventoryWorkerError(
    'preview-inventory-worker-exit',
    `Complete route inventory worker failed: ${message}`,
    { cause: error },
  );
}

/** Keeps test overrides positive while production retains the versioned grace constant. */
function normalizeGraceMs(value: number | undefined): number {
  return value !== undefined && Number.isFinite(value) && value >= 0
    ? Math.floor(value)
    : PREVIEW_COMPILER_WORKER_SHUTDOWN_GRACE_MS;
}
