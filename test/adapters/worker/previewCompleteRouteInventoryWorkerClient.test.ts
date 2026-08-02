import { afterEach, describe, expect, it, vi } from 'vitest';
import type { PreviewBuildRequest } from '../../../src/domain/preview';
import type {
  PreviewCompleteRouteInventoryTelemetryEvent,
  PreviewInspectorCompleteRouteInventory,
} from '../../../src/adapters/esbuild/inspector/previewInspectorCompleteRouteInventory';
import {
  PreviewCompleteRouteInventoryWorkerClient,
  PreviewCompleteRouteInventoryWorkerError,
  type PreviewCompleteRouteInventoryWorkerConfiguration,
  type PreviewCompleteRouteInventoryWorkerTransport,
} from '../../../src/adapters/worker/previewCompleteRouteInventoryWorkerClient';
import {
  PREVIEW_COMPILER_WORKER_SHUTDOWN_GRACE_MS,
  PREVIEW_INVENTORY_WORKER_TIMEOUT_MS,
} from '../../../src/adapters/worker/previewCompilerWorkerIsolation';
import type {
  PreviewCompilerWorkerRequest,
  PreviewCompilerWorkerResponse,
} from '../../../src/adapters/worker/previewCompilerWorkerProtocol';

afterEach(() => {
  vi.useRealTimers();
});

/** Deterministic in-memory transport exposing every terminal worker event. */
class FakeInventoryTransport implements PreviewCompleteRouteInventoryWorkerTransport {
  private errorListener: ((error: Error) => void) | undefined;
  private exitListener: ((exitCode: number) => void) | undefined;
  private messageListener: ((message: unknown) => void) | undefined;
  public readonly postMessage = vi.fn((message: PreviewCompilerWorkerRequest) => {
    void message;
  });
  public readonly terminate = vi.fn(() => Promise.resolve(1));

  /** Retains the worker error listener. */
  public onError(listener: (error: Error) => void): void {
    this.errorListener = listener;
  }

  /** Retains the worker exit listener. */
  public onExit(listener: (exitCode: number) => void): void {
    this.exitListener = listener;
  }

  /** Retains the worker response listener. */
  public onMessage(listener: (message: unknown) => void): void {
    this.messageListener = listener;
  }

  /** Emits one synthetic worker error. */
  public emitError(error: Error): void {
    this.errorListener?.(error);
  }

  /** Emits one synthetic worker exit. */
  public emitExit(exitCode: number): void {
    this.exitListener?.(exitCode);
  }

  /** Emits one synthetic worker protocol response. */
  public emitMessage(message: PreviewCompilerWorkerResponse): void {
    this.messageListener?.(message);
  }
}

describe('PreviewCompleteRouteInventoryWorkerClient', () => {
  it('uses exact one-shot isolation and resolves only after worker termination', async () => {
    const transport = new FakeInventoryTransport();
    let configuration: PreviewCompleteRouteInventoryWorkerConfiguration | undefined;
    let releaseTermination!: (exitCode: number) => void;
    transport.terminate.mockReturnValueOnce(
      new Promise<number>((resolve) => {
        releaseTermination = resolve;
      }),
    );
    const client = new PreviewCompleteRouteInventoryWorkerClient('/worker/entry.cjs', {
      createTransport: (candidate) => {
        configuration = candidate;
        return transport;
      },
      parentEnvironment: {
        GOMAXPROCS: '8',
        GOMEMLIMIT: '2GiB',
        NODE_OPTIONS: '--max-old-space-size=8192',
        SAFE_SENTINEL: 'preserved',
      },
    });

    const result = client.collectCompleteRouteInventory(createRequest());
    let settled = false;
    void result.finally(() => {
      settled = true;
    });
    const inventory = createInventory();
    transport.emitMessage({
      inventory,
      type: 'complete-route-inventory-success',
    });
    await Promise.resolve();

    expect(settled).toBe(false);
    expect(configuration).toMatchObject({
      env: {
        GOMAXPROCS: '2',
        GOMEMLIMIT: '256MiB',
        SAFE_SENTINEL: 'preserved',
      },
      execArgv: [],
      resourceLimits: { maxOldGenerationSizeMb: 2_048 },
      workerPath: '/worker/entry.cjs',
    });
    expect(configuration?.env).not.toHaveProperty('NODE_OPTIONS');
    expect(transport.terminate).toHaveBeenCalledOnce();
    releaseTermination(1);
    await expect(result).resolves.toBe(inventory);
  });

  it('maps OOM and process exit to stable terminals without retry', async () => {
    const oomTransport = new FakeInventoryTransport();
    const createOomTransport = vi.fn(() => oomTransport);
    const oomClient = new PreviewCompleteRouteInventoryWorkerClient('/worker/entry.cjs', {
      createTransport: createOomTransport,
    });
    const oomResult = oomClient.collectCompleteRouteInventory(createRequest());
    const oom = Object.assign(new Error('Worker terminated due to reaching memory limit'), {
      code: 'ERR_WORKER_OUT_OF_MEMORY',
    });
    oomTransport.emitError(oom);

    await expect(oomResult).rejects.toMatchObject({
      code: 'preview-inventory-memory-limit',
    });
    expect(createOomTransport).toHaveBeenCalledOnce();
    expect(oomTransport.terminate).toHaveBeenCalledOnce();

    const exitTransport = new FakeInventoryTransport();
    const createExitTransport = vi.fn(() => exitTransport);
    const exitClient = new PreviewCompleteRouteInventoryWorkerClient('/worker/entry.cjs', {
      createTransport: createExitTransport,
    });
    const exitResult = exitClient.collectCompleteRouteInventory(createRequest());
    exitTransport.emitExit(137);

    await expect(exitResult).rejects.toMatchObject({
      code: 'preview-inventory-worker-exit',
    });
    await expect(exitResult).rejects.toThrow('code 137');
    expect(createExitTransport).toHaveBeenCalledOnce();
    expect(exitTransport.terminate).toHaveBeenCalledOnce();
  });

  it('uses the exact 1800000 ms watchdog once before bounded timeout cleanup', async () => {
    vi.useFakeTimers();
    const transport = new FakeInventoryTransport();
    const createTransport = vi.fn(() => transport);
    const onProgress = vi.fn();
    const client = new PreviewCompleteRouteInventoryWorkerClient('/worker/entry.cjs', {
      createTransport,
      onProgress,
    });
    const result = client.collectCompleteRouteInventory(createRequest());
    const checkpoint = createTelemetryEvent({
      analysisPasses: 1,
      discoveredBranches: 1,
      elapsedMs: PREVIEW_INVENTORY_WORKER_TIMEOUT_MS - 1,
      phase: 'enumerate-branches',
      queuedSelections: 1,
      transition: 'checkpoint',
    });
    const rejection = expect(result).rejects.toMatchObject({
      code: 'preview-inventory-timeout',
      lastProgress: checkpoint,
      message: 'Complete route inventory exceeded 1800000 ms.',
    });

    await vi.advanceTimersByTimeAsync(PREVIEW_INVENTORY_WORKER_TIMEOUT_MS - 1);
    transport.emitMessage({
      event: checkpoint,
      type: 'complete-route-inventory-progress',
    });
    expect(onProgress).toHaveBeenCalledOnce();
    expect(transport.postMessage).not.toHaveBeenCalledWith({ type: 'shutdown' });
    expect(transport.terminate).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1);
    expect(transport.postMessage).toHaveBeenCalledTimes(2);
    expect(transport.postMessage).toHaveBeenLastCalledWith({ type: 'shutdown' });
    expect(transport.terminate).not.toHaveBeenCalled();
    transport.emitMessage({
      event: createTelemetryEvent({
        analysisPasses: 2,
        discoveredBranches: 2,
        elapsedMs: PREVIEW_INVENTORY_WORKER_TIMEOUT_MS,
        phase: 'enumerate-branches',
        queuedSelections: 2,
        sequence: 2,
        transition: 'checkpoint',
      }),
      type: 'complete-route-inventory-progress',
    });
    expect(onProgress).toHaveBeenCalledOnce();
    await vi.advanceTimersByTimeAsync(PREVIEW_COMPILER_WORKER_SHUTDOWN_GRACE_MS);

    await rejection;
    expect(createTransport).toHaveBeenCalledOnce();
    expect(transport.terminate).toHaveBeenCalledOnce();
  });

  it('isolates progress observers and ignores progress after terminal settlement begins', async () => {
    const transport = new FakeInventoryTransport();
    let releaseTermination!: (exitCode: number) => void;
    transport.terminate.mockReturnValueOnce(
      new Promise<number>((resolve) => {
        releaseTermination = resolve;
      }),
    );
    const onProgress = vi.fn(() => {
      throw new Error('synthetic observer failure');
    });
    const client = new PreviewCompleteRouteInventoryWorkerClient('/worker/entry.cjs', {
      createTransport: () => transport,
      onProgress,
    });
    const result = client.collectCompleteRouteInventory(createRequest());
    transport.emitMessage({
      event: createTelemetryEvent(),
      type: 'complete-route-inventory-progress',
    });
    transport.emitMessage({
      inventory: createInventory(),
      type: 'complete-route-inventory-success',
    });
    transport.emitMessage({
      event: createTelemetryEvent({ sequence: 2, transition: 'complete' }),
      type: 'complete-route-inventory-progress',
    });

    expect(onProgress).toHaveBeenCalledOnce();
    releaseTermination(1);
    await expect(result).resolves.toEqual(createInventory());
    expect(transport.terminate).toHaveBeenCalledOnce();
  });

  it('cancels with bounded cleanup and preserves the cancellation terminal', async () => {
    const transport = new FakeInventoryTransport();
    const controller = new AbortController();
    const client = new PreviewCompleteRouteInventoryWorkerClient('/worker/entry.cjs', {
      createTransport: () => transport,
    });
    const result = client.collectCompleteRouteInventory(
      createRequest(),
      undefined,
      controller.signal,
    );

    controller.abort();
    expect(transport.postMessage).toHaveBeenLastCalledWith({ type: 'shutdown' });
    transport.emitMessage({
      error: {
        code: 'preview-inventory-cancelled',
        message: 'worker observed cancellation',
      },
      type: 'complete-route-inventory-failure',
    });

    await expect(result).rejects.toMatchObject({ code: 'preview-inventory-cancelled' });
    expect(transport.terminate).toHaveBeenCalledOnce();
  });

  it('maps termination rejection after success to worker-exit with success evidence', async () => {
    const transport = new FakeInventoryTransport();
    const terminationError = new Error('synthetic terminate rejection');
    transport.terminate.mockRejectedValueOnce(terminationError);
    const createTransport = vi.fn(() => transport);
    const client = new PreviewCompleteRouteInventoryWorkerClient('/worker/entry.cjs', {
      createTransport,
    });
    const result = client.collectCompleteRouteInventory(createRequest());
    transport.emitMessage({
      inventory: createInventory(),
      type: 'complete-route-inventory-success',
    });

    const failure = await captureInventoryFailure(result);
    expect(failure).toMatchObject({
      cause: { type: 'complete-route-inventory-success' },
      code: 'preview-inventory-worker-exit',
    });
    expect(readTerminationError(failure)).toBe(terminationError);
    expect(createTransport).toHaveBeenCalledOnce();
    expect(transport.terminate).toHaveBeenCalledOnce();
  });

  it('maps termination rejection after failure to worker-exit with the prior terminal cause', async () => {
    const transport = new FakeInventoryTransport();
    const terminationError = new Error('synthetic terminate rejection');
    transport.terminate.mockRejectedValueOnce(terminationError);
    const createTransport = vi.fn(() => transport);
    const client = new PreviewCompleteRouteInventoryWorkerClient('/worker/entry.cjs', {
      createTransport,
    });
    const result = client.collectCompleteRouteInventory(createRequest());
    transport.emitMessage({
      error: {
        code: 'preview-inventory-failed',
        message: 'synthetic inventory failure',
      },
      type: 'complete-route-inventory-failure',
    });

    const failure = await captureInventoryFailure(result);
    expect(failure.code).toBe('preview-inventory-worker-exit');
    expect(failure.cause).toBeInstanceOf(PreviewCompleteRouteInventoryWorkerError);
    expect(failure.cause).toMatchObject({
      code: 'preview-inventory-failed',
      message: 'synthetic inventory failure',
    });
    expect(readTerminationError(failure)).toBe(terminationError);
    expect(createTransport).toHaveBeenCalledOnce();
    expect(transport.terminate).toHaveBeenCalledOnce();
  });
});

/** Creates one immutable worker inventory request. */
function createRequest(): PreviewBuildRequest {
  return Object.freeze({
    dependencySnapshots: Object.freeze([]),
    documentPath: '/workspace/App.tsx',
    language: 'tsx' as const,
    sourceText: 'export default function App() { return null; }',
    workspaceRoot: '/workspace',
  });
}

/** Creates a complete inventory with every top-level field populated. */
function createInventory(): PreviewInspectorCompleteRouteInventory {
  return {
    analysisPasses: 1,
    complete: true,
    counts: { duplicate: 0, runnable: 0, total: 1, unresolved: 1 },
    dependencyPaths: ['/workspace/Dependency.tsx'],
    entries: [
      {
        componentName: 'DeferredRoute',
        disposition: 'unresolved',
        exportName: 'default',
        id: 'route:deferred',
        owner: { exportName: 'default', sourcePath: '/workspace/App.tsx' },
        parameters: {},
        pathname: '/deferred',
        pattern: '/deferred',
        reason: 'execution-plan-unavailable',
        selection: [{ componentName: 'DeferredRoute', pattern: '/deferred' }],
        sourcePath: '/workspace/Dependency.tsx',
      },
    ],
    limits: { maximumAnalysisPasses: 1, maximumBranches: 2, maximumDepth: 3 },
    owner: { exportName: 'default', sourcePath: '/workspace/App.tsx' },
    predecessorVersion: 3,
    replayPasses: 0,
    replayPolicy: { digest: 'a'.repeat(64), predecessorVersion: 3, version: 4 },
    truncated: false,
    version: 4,
  };
}

/** Creates one exact bounded worker progress event with optional applicable counters. */
function createTelemetryEvent(
  overrides: Partial<PreviewCompleteRouteInventoryTelemetryEvent> = {},
): PreviewCompleteRouteInventoryTelemetryEvent {
  return {
    cpuSystemMicros: 2,
    cpuUserMicros: 1,
    elapsedMs: 0,
    heapUsedBytes: 3,
    phase: 'prepare-source-index',
    rssBytes: 4,
    sequence: 1,
    transition: 'start',
    version: 1,
    ...overrides,
  };
}

/** Captures one expected inventory-client rejection without weakening its error type. */
async function captureInventoryFailure(
  result: Promise<PreviewInspectorCompleteRouteInventory>,
): Promise<PreviewCompleteRouteInventoryWorkerError> {
  try {
    await result;
  } catch (error) {
    expect(error).toBeInstanceOf(PreviewCompleteRouteInventoryWorkerError);
    return error as PreviewCompleteRouteInventoryWorkerError;
  }
  throw new Error('Expected inventory worker failure.');
}

/** Reads the retained low-level termination error from a stable worker-exit terminal. */
function readTerminationError(error: PreviewCompleteRouteInventoryWorkerError): unknown {
  return (error as PreviewCompleteRouteInventoryWorkerError & { terminationError?: unknown })
    .terminationError;
}
