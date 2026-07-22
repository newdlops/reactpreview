/** Verifies host-side worker progress, settlement, cancellation, and graceful shutdown. */
import { describe, expect, it, vi } from 'vitest';
import {
  PreviewCompilerWorkerClient,
  type PreviewCompilerWorkerTransport,
} from '../../../src/adapters/worker/previewCompilerWorkerClient';
import type {
  PreviewCompilerWorkerRequest,
  PreviewCompilerWorkerResponse,
} from '../../../src/adapters/worker/previewCompilerWorkerProtocol';
import {
  PreviewBuildCancelledError,
  PreviewBuildStalledError,
} from '../../../src/domain/previewBuildExecution';

/** In-memory transport that exposes worker events deterministically to tests. */
class FakeWorkerTransport implements PreviewCompilerWorkerTransport {
  private errorListener: ((error: Error) => void) | undefined;
  private exitListener: ((exitCode: number) => void) | undefined;
  private messageListener: ((message: unknown) => void) | undefined;
  public readonly requests: PreviewCompilerWorkerRequest[] = [];
  public readonly terminate = vi.fn(() => Promise.resolve(0));

  /** Registers the simulated error callback. */
  public onError(listener: (error: Error) => void): void {
    this.errorListener = listener;
  }

  /** Registers the simulated exit callback. */
  public onExit(listener: (exitCode: number) => void): void {
    this.exitListener = listener;
  }

  /** Registers the simulated response callback. */
  public onMessage(listener: (message: unknown) => void): void {
    this.messageListener = listener;
  }

  /** Records one client request. */
  public postMessage(message: PreviewCompilerWorkerRequest): void {
    this.requests.push(message);
  }

  /** Emits one structured worker response. */
  public respond(message: PreviewCompilerWorkerResponse): void {
    this.messageListener?.(message);
  }

  /** Emits an unrecoverable worker error. */
  public fail(error: Error): void {
    this.errorListener?.(error);
  }

  /** Emits a worker exit code. */
  public exit(exitCode: number): void {
    this.exitListener?.(exitCode);
  }
}

const REQUEST = {
  dependencySnapshots: [],
  documentPath: '/workspace/Target.tsx',
  language: 'tsx' as const,
  preparationMode: 'fast' as const,
  sourceText: 'export default function Target() { return null; }',
  workspaceRoot: '/workspace',
};

describe('PreviewCompilerWorkerClient', () => {
  /** Forwards progress and resolves a transferred bundle before ordered shutdown. */
  it('settles one background compile and shuts down gracefully', async () => {
    const transport = new FakeWorkerTransport();
    const client = new PreviewCompilerWorkerClient('/extension/worker.js', {
      createTransport: () => transport,
    });
    const reportProgress = vi.fn();
    const compilation = client.compile(REQUEST, { reportProgress });
    const compileRequest = transport.requests[0];
    expect(compileRequest?.type).toBe('compile');
    const requestId = compileRequest?.type === 'compile' ? compileRequest.id : -1;

    transport.respond({ id: requestId, stage: 'bundling-modules', type: 'progress' });
    transport.respond({
      bundle: {
        chunks: [],
        dependencies: [],
        diagnostics: [],
        javascript: new Uint8Array([1]),
        watchDirectories: [],
      },
      id: requestId,
      type: 'success',
    });
    await expect(compilation).resolves.toMatchObject({ javascript: new Uint8Array([1]) });
    expect(reportProgress).toHaveBeenCalledWith('bundling-modules');

    const shutdown = client.shutdown();
    expect(transport.requests.at(-1)).toEqual({ type: 'shutdown' });
    transport.respond({ type: 'shutdown-complete' });
    await shutdown;
    expect(transport.terminate).toHaveBeenCalledOnce();
  });

  /** Rejects immediately and tells the worker to remove a superseded queued revision. */
  it('forwards AbortSignal cancellation', async () => {
    const transport = new FakeWorkerTransport();
    const client = new PreviewCompilerWorkerClient('/extension/worker.js', {
      createTransport: () => transport,
    });
    const controller = new AbortController();
    const compilation = client.compile(REQUEST, { signal: controller.signal });
    controller.abort();

    await expect(compilation).rejects.toBeInstanceOf(PreviewBuildCancelledError);
    expect(transport.requests.map((request) => request.type)).toEqual(['compile', 'cancel']);
  });

  /** A first-paint request cancels active optional enrichment before joining the worker queue. */
  it('preempts active full enrichment when fast first paint arrives', async () => {
    const transport = new FakeWorkerTransport();
    const client = new PreviewCompilerWorkerClient('/extension/worker.js', {
      createTransport: () => transport,
    });
    const fullCompilation = client.compile({
      ...REQUEST,
      buildIntent: 'context-enrichment',
      documentPath: '/workspace/Enrichment.tsx',
      preparationMode: 'full',
    });
    const fullRequest = transport.requests[0];
    const fullId = fullRequest?.type === 'compile' ? fullRequest.id : -1;
    transport.respond({ id: fullId, type: 'started' });

    const fastCompilation = client.compile({
      ...REQUEST,
      documentPath: '/workspace/Foreground.tsx',
    });
    await expect(fullCompilation).rejects.toBeInstanceOf(PreviewBuildCancelledError);
    expect(transport.requests.map((request) => request.type)).toEqual([
      'compile',
      'cancel',
      'compile',
    ]);

    transport.respond({
      error: {
        diagnostics: [],
        kind: 'cancelled',
        message: 'cancelled by fast first paint',
        name: 'PreviewBuildCancelledError',
      },
      id: fullId,
      type: 'failure',
    });
    const fastRequest = transport.requests.at(-1);
    const fastId = fastRequest?.type === 'compile' ? fastRequest.id : -1;
    transport.respond({
      bundle: {
        chunks: [],
        dependencies: [],
        diagnostics: [],
        javascript: new Uint8Array([7]),
        watchDirectories: [],
      },
      id: fastId,
      type: 'success',
    });
    await expect(fastCompilation).resolves.toMatchObject({ javascript: new Uint8Array([7]) });
  });

  /** Full graph completeness alone never makes a required foreground fallback preemptible. */
  it('does not preempt a foreground full build', async () => {
    const transport = new FakeWorkerTransport();
    const client = new PreviewCompilerWorkerClient('/extension/worker.js', {
      createTransport: () => transport,
    });
    const fullCompilation = client.compile({
      ...REQUEST,
      documentPath: '/workspace/RequiredFallback.tsx',
      preparationMode: 'full',
    });
    const fullRequest = transport.requests[0];
    const fullId = fullRequest?.type === 'compile' ? fullRequest.id : -1;
    transport.respond({ id: fullId, type: 'started' });

    const fastCompilation = client.compile({
      ...REQUEST,
      documentPath: '/workspace/OtherTab.tsx',
    });
    expect(transport.requests.map((request) => request.type)).toEqual(['compile', 'compile']);

    transport.respond({
      bundle: {
        chunks: [],
        dependencies: [],
        diagnostics: [],
        javascript: new Uint8Array([5]),
        watchDirectories: [],
      },
      id: fullId,
      type: 'success',
    });
    await expect(fullCompilation).resolves.toMatchObject({ javascript: new Uint8Array([5]) });
    const fastRequest = transport.requests[1];
    const fastId = fastRequest?.type === 'compile' ? fastRequest.id : -1;
    transport.respond({
      bundle: {
        chunks: [],
        dependencies: [],
        diagnostics: [],
        javascript: new Uint8Array([6]),
        watchDirectories: [],
      },
      id: fastId,
      type: 'success',
    });
    await expect(fastCompilation).resolves.toMatchObject({ javascript: new Uint8Array([6]) });
  });

  /** A native enrichment graph that ignores abort cannot keep a queued fast pass hostage. */
  it('replays queued fast first paint once after unresponsive enrichment is recycled', async () => {
    vi.useFakeTimers();
    try {
      const transports = [new FakeWorkerTransport(), new FakeWorkerTransport()];
      let transportIndex = 0;
      const client = new PreviewCompilerWorkerClient('/extension/worker.js', {
        cancellationGraceMs: 20,
        compilationTimeoutMs: 1_000,
        createTransport: () => {
          const transport = transports[transportIndex++];
          if (transport === undefined) throw new Error('Unexpected third worker allocation.');
          return transport;
        },
      });
      const fullCompilation = client.compile({
        ...REQUEST,
        buildIntent: 'context-enrichment',
        documentPath: '/workspace/Enrichment.tsx',
        preparationMode: 'full',
      });
      const fullRequest = transports[0]?.requests[0];
      const fullId = fullRequest?.type === 'compile' ? fullRequest.id : -1;
      transports[0]?.respond({ id: fullId, type: 'started' });

      const fastCompilation = client.compile({
        ...REQUEST,
        documentPath: '/workspace/Foreground.tsx',
      });
      await expect(fullCompilation).rejects.toBeInstanceOf(PreviewBuildCancelledError);
      await vi.advanceTimersByTimeAsync(20);
      await Promise.resolve();
      expect(transports[0]?.terminate).toHaveBeenCalledOnce();
      expect(transports[1]?.requests[0]).toMatchObject({
        request: { documentPath: '/workspace/Foreground.tsx', preparationMode: 'fast' },
        type: 'compile',
      });

      const replayRequest = transports[1]?.requests[0];
      const replayId = replayRequest?.type === 'compile' ? replayRequest.id : -1;
      transports[1]?.respond({
        bundle: {
          chunks: [],
          dependencies: [],
          diagnostics: [],
          javascript: new Uint8Array([8]),
          watchDirectories: [],
        },
        id: replayId,
        type: 'success',
      });
      await expect(fastCompilation).resolves.toMatchObject({ javascript: new Uint8Array([8]) });
    } finally {
      vi.useRealTimers();
    }
  });

  /** A normal revision abort followed by new first paint also preserves the untouched successor. */
  it('replays new foreground work after superseded enrichment ignores cancellation', async () => {
    vi.useFakeTimers();
    try {
      const transports = [new FakeWorkerTransport(), new FakeWorkerTransport()];
      let transportIndex = 0;
      const client = new PreviewCompilerWorkerClient('/extension/worker.js', {
        cancellationGraceMs: 20,
        compilationTimeoutMs: 1_000,
        createTransport: () => {
          const transport = transports[transportIndex++];
          if (transport === undefined) throw new Error('Unexpected third worker allocation.');
          return transport;
        },
      });
      const controller = new AbortController();
      const enrichment = client.compile(
        {
          ...REQUEST,
          buildIntent: 'context-enrichment',
          documentPath: '/workspace/OldRevision.tsx',
          preparationMode: 'full',
        },
        { signal: controller.signal },
      );
      const oldRequest = transports[0]?.requests[0];
      const oldId = oldRequest?.type === 'compile' ? oldRequest.id : -1;
      transports[0]?.respond({ id: oldId, type: 'started' });
      controller.abort();
      await expect(enrichment).rejects.toBeInstanceOf(PreviewBuildCancelledError);

      const foreground = client.compile({
        ...REQUEST,
        documentPath: '/workspace/NewRevision.tsx',
      });
      await vi.advanceTimersByTimeAsync(20);
      await Promise.resolve();
      const replay = transports[1]?.requests[0];
      const replayId = replay?.type === 'compile' ? replay.id : -1;
      expect(replay).toMatchObject({
        request: { documentPath: '/workspace/NewRevision.tsx' },
        type: 'compile',
      });
      transports[1]?.respond({
        bundle: {
          chunks: [],
          dependencies: [],
          diagnostics: [],
          javascript: new Uint8Array([10]),
          watchDirectories: [],
        },
        id: replayId,
        type: 'success',
      });
      await expect(foreground).resolves.toMatchObject({ javascript: new Uint8Array([10]) });
    } finally {
      vi.useRealTimers();
    }
  });

  /** An OOM from preempted enrichment also moves its untouched fast successor to a clean worker. */
  it('replays queued fast first paint when preempted enrichment exhausts worker memory', async () => {
    const transports = [new FakeWorkerTransport(), new FakeWorkerTransport()];
    let transportIndex = 0;
    const client = new PreviewCompilerWorkerClient('/extension/worker.js', {
      createTransport: () => {
        const transport = transports[transportIndex++];
        if (transport === undefined) throw new Error('Unexpected third worker allocation.');
        return transport;
      },
    });
    const fullCompilation = client.compile({
      ...REQUEST,
      buildIntent: 'context-enrichment',
      documentPath: '/workspace/Enrichment.tsx',
      preparationMode: 'full',
    });
    const fullRequest = transports[0]?.requests[0];
    const fullId = fullRequest?.type === 'compile' ? fullRequest.id : -1;
    transports[0]?.respond({ id: fullId, stage: 'bundling-modules', type: 'progress' });
    const fastCompilation = client.compile({
      ...REQUEST,
      documentPath: '/workspace/Foreground.tsx',
    });
    await expect(fullCompilation).rejects.toBeInstanceOf(PreviewBuildCancelledError);

    transports[0]?.fail(new Error('Worker terminated due to ERR_WORKER_OUT_OF_MEMORY'));
    await Promise.resolve();
    await Promise.resolve();
    expect(transports[0]?.terminate).toHaveBeenCalledOnce();
    expect(transports[1]?.requests[0]).toMatchObject({
      request: { documentPath: '/workspace/Foreground.tsx', preparationMode: 'fast' },
      type: 'compile',
    });

    const replayRequest = transports[1]?.requests[0];
    const replayId = replayRequest?.type === 'compile' ? replayRequest.id : -1;
    transports[1]?.respond({
      bundle: {
        chunks: [],
        dependencies: [],
        diagnostics: [],
        javascript: new Uint8Array([9]),
        watchDirectories: [],
      },
      id: replayId,
      type: 'success',
    });
    await expect(fastCompilation).resolves.toMatchObject({ javascript: new Uint8Array([9]) });
  });

  /** Terminates a graph that never settles and starts the next request in a clean worker. */
  it('recycles the worker after the hard compilation deadline', async () => {
    vi.useFakeTimers();
    try {
      const transports = [new FakeWorkerTransport(), new FakeWorkerTransport()];
      let transportIndex = 0;
      const client = new PreviewCompilerWorkerClient('/extension/worker.js', {
        compilationTimeoutMs: 25,
        createTransport: () => {
          const transport = transports[transportIndex++];
          if (transport === undefined) throw new Error('Unexpected third worker allocation.');
          return transport;
        },
      });
      const compilation = client.compile(REQUEST);
      const capturedTimeout = compilation.catch((error: unknown) => error);
      const firstRequest = transports[0]?.requests[0];
      const firstId = firstRequest?.type === 'compile' ? firstRequest.id : -1;
      transports[0]?.respond({ id: firstId, stage: 'bundling-modules', type: 'progress' });

      await vi.advanceTimersByTimeAsync(25);
      const timeoutError = await capturedTimeout;
      expect(timeoutError).toBeInstanceOf(PreviewBuildStalledError);
      expect(timeoutError).toMatchObject({
        lastStage: 'bundling-modules',
        name: 'PreviewBuildStalledError',
      });
      expect(transports[0]?.requests.at(-1)).toEqual({ id: firstId, type: 'cancel' });
      expect(transports[0]?.terminate).toHaveBeenCalledOnce();

      const nextCompilation = client.compile(REQUEST);
      const nextRequest = transports[1]?.requests[0];
      const nextId = nextRequest?.type === 'compile' ? nextRequest.id : -1;
      transports[1]?.respond({
        bundle: {
          chunks: [],
          dependencies: [],
          diagnostics: [],
          javascript: new Uint8Array([2]),
          watchDirectories: [],
        },
        id: nextId,
        type: 'success',
      });
      await expect(nextCompilation).resolves.toMatchObject({ javascript: new Uint8Array([2]) });
    } finally {
      vi.useRealTimers();
    }
  });

  /** A watchdog rejects only active work and replays an untouched queued tab once. */
  it('replays queued work after another request trips the watchdog', async () => {
    vi.useFakeTimers();
    try {
      const transports = [new FakeWorkerTransport(), new FakeWorkerTransport()];
      let transportIndex = 0;
      const client = new PreviewCompilerWorkerClient('/extension/worker.js', {
        compilationTimeoutMs: 25,
        createTransport: () => {
          const transport = transports[transportIndex++];
          if (transport === undefined) throw new Error('Unexpected third worker allocation.');
          return transport;
        },
      });
      const first = client.compile({
        ...REQUEST,
        documentPath: '/workspace/First.tsx',
        preparationMode: 'full',
      });
      const second = client.compile({
        ...REQUEST,
        documentPath: '/workspace/Second.tsx',
        preparationMode: 'full',
      });
      const capturedFirst = first.catch((error: unknown) => error);
      const firstRequest = transports[0]?.requests[0];
      const firstId = firstRequest?.type === 'compile' ? firstRequest.id : -1;
      transports[0]?.respond({ id: firstId, stage: 'bundling-modules', type: 'progress' });

      await vi.advanceTimersByTimeAsync(25);
      await Promise.resolve();

      await expect(capturedFirst).resolves.toMatchObject({
        lastStage: 'bundling-modules',
        preparationMode: 'full',
        target: '/workspace/First.tsx',
      });
      const replay = transports[1]?.requests[0];
      const replayId = replay?.type === 'compile' ? replay.id : -1;
      expect(replay).toMatchObject({
        request: { documentPath: '/workspace/Second.tsx' },
        type: 'compile',
      });
      transports[1]?.respond({
        bundle: {
          chunks: [],
          dependencies: [],
          diagnostics: [],
          javascript: new Uint8Array([2]),
          watchDirectories: [],
        },
        id: replayId,
        type: 'success',
      });
      await expect(second).resolves.toMatchObject({ javascript: new Uint8Array([2]) });
      expect(transports[0]?.terminate).toHaveBeenCalledOnce();
    } finally {
      vi.useRealTimers();
    }
  });

  /** Queued tabs receive their complete build budget only after the worker starts that revision. */
  it('does not spend the hard compilation deadline while a request is queued', async () => {
    vi.useFakeTimers();
    try {
      const transport = new FakeWorkerTransport();
      const client = new PreviewCompilerWorkerClient('/extension/worker.js', {
        compilationTimeoutMs: 25,
        createTransport: () => transport,
      });
      const compilation = client.compile(REQUEST);
      const settled = vi.fn();
      void compilation.then(settled, settled);
      const request = transport.requests[0];
      const requestId = request?.type === 'compile' ? request.id : -1;

      await vi.advanceTimersByTimeAsync(25);
      expect(settled).not.toHaveBeenCalled();

      transport.respond({ id: requestId, type: 'started' });
      await vi.advanceTimersByTimeAsync(25);
      await expect(compilation).rejects.toBeInstanceOf(PreviewBuildStalledError);
      expect(transport.terminate).toHaveBeenCalledOnce();
    } finally {
      vi.useRealTimers();
    }
  });

  /** A replacement cannot start until the old worker and its native esbuild child have exited. */
  it('serializes worker retirement before allocating a replacement', async () => {
    vi.useFakeTimers();
    try {
      const transports = [new FakeWorkerTransport(), new FakeWorkerTransport()];
      let finishRetirement!: (exitCode: number) => void;
      transports[0]?.terminate.mockImplementation(
        () =>
          new Promise<number>((resolve) => {
            finishRetirement = resolve;
          }),
      );
      let transportIndex = 0;
      const client = new PreviewCompilerWorkerClient('/extension/worker.js', {
        compilationTimeoutMs: 25,
        createTransport: () => {
          const transport = transports[transportIndex++];
          if (transport === undefined) throw new Error('Unexpected third worker allocation.');
          return transport;
        },
      });
      const stalledCompilation = client.compile(REQUEST);
      const capturedStall = stalledCompilation.catch((error: unknown) => error);
      const firstRequest = transports[0]?.requests[0];
      const firstId = firstRequest?.type === 'compile' ? firstRequest.id : -1;
      transports[0]?.respond({ id: firstId, type: 'started' });
      await vi.advanceTimersByTimeAsync(25);
      expect(await capturedStall).toBeInstanceOf(PreviewBuildStalledError);

      const nextCompilation = client.compile(REQUEST);
      expect(transportIndex).toBe(1);
      expect(transports[1]?.requests).toHaveLength(0);

      finishRetirement(0);
      await Promise.resolve();
      await Promise.resolve();
      expect(transportIndex).toBe(2);
      const nextRequest = transports[1]?.requests[0];
      const nextId = nextRequest?.type === 'compile' ? nextRequest.id : -1;
      transports[1]?.respond({
        bundle: {
          chunks: [],
          dependencies: [],
          diagnostics: [],
          javascript: new Uint8Array([2]),
          watchDirectories: [],
        },
        id: nextId,
        type: 'success',
      });
      await expect(nextCompilation).resolves.toMatchObject({ javascript: new Uint8Array([2]) });
    } finally {
      vi.useRealTimers();
    }
  });

  /** A native build that ignores cancellation cannot retain and block the serialized worker queue. */
  it('recycles a worker that does not acknowledge cancellation', async () => {
    vi.useFakeTimers();
    try {
      const transport = new FakeWorkerTransport();
      const client = new PreviewCompilerWorkerClient('/extension/worker.js', {
        cancellationGraceMs: 20,
        compilationTimeoutMs: 1_000,
        createTransport: () => transport,
      });
      const controller = new AbortController();
      const compilation = client.compile(REQUEST, { signal: controller.signal });
      controller.abort();
      await expect(compilation).rejects.toBeInstanceOf(PreviewBuildCancelledError);

      await vi.advanceTimersByTimeAsync(20);
      expect(transport.terminate).toHaveBeenCalledOnce();
    } finally {
      vi.useRealTimers();
    }
  });

  /** A timely terminal cancellation response preserves reusable compiler caches. */
  it('keeps the worker after cancellation is acknowledged', async () => {
    vi.useFakeTimers();
    try {
      const transport = new FakeWorkerTransport();
      const client = new PreviewCompilerWorkerClient('/extension/worker.js', {
        cancellationGraceMs: 20,
        compilationTimeoutMs: 1_000,
        createTransport: () => transport,
      });
      const controller = new AbortController();
      const compilation = client.compile(REQUEST, { signal: controller.signal });
      const compileRequest = transport.requests[0];
      const requestId = compileRequest?.type === 'compile' ? compileRequest.id : -1;
      controller.abort();
      await expect(compilation).rejects.toBeInstanceOf(PreviewBuildCancelledError);
      transport.respond({
        error: {
          diagnostics: [],
          kind: 'cancelled',
          message: 'cancelled',
          name: 'PreviewBuildCancelledError',
        },
        id: requestId,
        type: 'failure',
      });

      await vi.advanceTimersByTimeAsync(20);
      expect(transport.terminate).not.toHaveBeenCalled();
    } finally {
      vi.useRealTimers();
    }
  });

  /** Heap-limit exits are resource stalls, not source errors eligible for an immediate retry. */
  it('classifies worker memory-limit failure as a build stall', async () => {
    const transport = new FakeWorkerTransport();
    const client = new PreviewCompilerWorkerClient('/extension/worker.js', {
      createTransport: () => transport,
    });
    const compilation = client.compile(REQUEST);
    const capturedFailure = compilation.catch((error: unknown) => error);
    const request = transport.requests[0];
    const requestId = request?.type === 'compile' ? request.id : -1;
    transport.respond({ id: requestId, stage: 'bundling-modules', type: 'progress' });

    transport.fail(new Error('Worker terminated due to ERR_WORKER_OUT_OF_MEMORY'));

    const error = await capturedFailure;
    expect(error).toBeInstanceOf(PreviewBuildStalledError);
    expect(error).toMatchObject({ lastStage: 'bundling-modules' });
    expect(transport.terminate).toHaveBeenCalledOnce();
  });

  /** A worker OOM cannot poison a queued request whose graph never started. */
  it('replays queued work after active request memory failure', async () => {
    const transports = [new FakeWorkerTransport(), new FakeWorkerTransport()];
    let transportIndex = 0;
    const client = new PreviewCompilerWorkerClient('/extension/worker.js', {
      createTransport: () => {
        const transport = transports[transportIndex++];
        if (transport === undefined) throw new Error('Unexpected third worker allocation.');
        return transport;
      },
    });
    const first = client.compile({
      ...REQUEST,
      documentPath: '/workspace/First.tsx',
      preparationMode: 'full',
    });
    const second = client.compile({
      ...REQUEST,
      documentPath: '/workspace/Second.tsx',
      preparationMode: 'full',
    });
    const capturedFirst = first.catch((error: unknown) => error);
    const firstRequest = transports[0]?.requests[0];
    const firstId = firstRequest?.type === 'compile' ? firstRequest.id : -1;
    transports[0]?.respond({ id: firstId, stage: 'bundling-modules', type: 'progress' });

    transports[0]?.fail(new Error('Worker terminated due to ERR_WORKER_OUT_OF_MEMORY'));

    await expect(capturedFirst).resolves.toMatchObject({
      lastStage: 'bundling-modules',
      preparationMode: 'full',
      target: '/workspace/First.tsx',
    });
    await Promise.resolve();
    await Promise.resolve();
    const replay = transports[1]?.requests[0];
    const replayId = replay?.type === 'compile' ? replay.id : -1;
    expect(replay).toMatchObject({
      request: { documentPath: '/workspace/Second.tsx' },
      type: 'compile',
    });
    transports[1]?.respond({
      bundle: {
        chunks: [],
        dependencies: [],
        diagnostics: [],
        javascript: new Uint8Array([3]),
        watchDirectories: [],
      },
      id: replayId,
      type: 'success',
    });
    await expect(second).resolves.toMatchObject({ javascript: new Uint8Array([3]) });
  });

  /** A generic crash retains active diagnostics while replaying untouched queued work. */
  it('scopes transport failure to active work and replays queued work', async () => {
    const transports = [new FakeWorkerTransport(), new FakeWorkerTransport()];
    let transportIndex = 0;
    const client = new PreviewCompilerWorkerClient('/extension/worker.js', {
      createTransport: () => {
        const transport = transports[transportIndex++];
        if (transport === undefined) throw new Error('Unexpected third worker allocation.');
        return transport;
      },
    });
    const first = client.compile({
      ...REQUEST,
      documentPath: '/workspace/First.tsx',
      preparationMode: 'full',
    });
    const second = client.compile({
      ...REQUEST,
      documentPath: '/workspace/Second.tsx',
      preparationMode: 'full',
    });
    const capturedFirst = first.catch((error: unknown) => error);
    const firstRequest = transports[0]?.requests[0];
    const firstId = firstRequest?.type === 'compile' ? firstRequest.id : -1;
    transports[0]?.respond({ id: firstId, type: 'started' });

    transports[0]?.fail(new Error('EPIPE'));

    const firstError = await capturedFirst;
    expect(firstError).toBeInstanceOf(Error);
    expect((firstError as Error).message).toContain('/workspace/First.tsx during full preparation');
    expect(firstError).toMatchObject({
      buildIntent: 'foreground',
      preparationMode: 'full',
      target: '/workspace/First.tsx',
    });
    await Promise.resolve();
    await Promise.resolve();
    const replay = transports[1]?.requests[0];
    const replayId = replay?.type === 'compile' ? replay.id : -1;
    expect(replay).toMatchObject({
      request: { documentPath: '/workspace/Second.tsx' },
      type: 'compile',
    });
    transports[1]?.respond({
      bundle: {
        chunks: [],
        dependencies: [],
        diagnostics: [],
        javascript: new Uint8Array([4]),
        watchDirectories: [],
      },
      id: replayId,
      type: 'success',
    });
    await expect(second).resolves.toMatchObject({ javascript: new Uint8Array([4]) });
  });

  /** Extension deactivation cannot wait forever for a poisoned native compiler queue. */
  it('force-terminates a worker that does not acknowledge shutdown', async () => {
    vi.useFakeTimers();
    try {
      const transport = new FakeWorkerTransport();
      const client = new PreviewCompilerWorkerClient('/extension/worker.js', {
        createTransport: () => transport,
        shutdownGraceMs: 20,
      });
      const compilation = client.compile(REQUEST);
      const request = transport.requests[0];
      const requestId = request?.type === 'compile' ? request.id : -1;
      transport.respond({
        bundle: {
          chunks: [],
          dependencies: [],
          diagnostics: [],
          javascript: new Uint8Array([1]),
          watchDirectories: [],
        },
        id: requestId,
        type: 'success',
      });
      await compilation;

      const shutdown = client.shutdown();
      await vi.advanceTimersByTimeAsync(20);

      await expect(shutdown).resolves.toBeUndefined();
      expect(transport.terminate).toHaveBeenCalledOnce();
    } finally {
      vi.useRealTimers();
    }
  });

  /** Completed native graphs stay warm briefly for HMR, then release their idle resident memory. */
  it('retires an idle worker and lazily creates a clean replacement', async () => {
    vi.useFakeTimers();
    try {
      const transports = [new FakeWorkerTransport(), new FakeWorkerTransport()];
      let transportIndex = 0;
      const client = new PreviewCompilerWorkerClient('/extension/worker.js', {
        createTransport: () => {
          const transport = transports[transportIndex++];
          if (transport === undefined) throw new Error('Unexpected third worker allocation.');
          return transport;
        },
        idleWorkerTimeoutMs: 20,
      });
      const compilation = client.compile(REQUEST);
      const firstRequest = transports[0]?.requests[0];
      const firstId = firstRequest?.type === 'compile' ? firstRequest.id : -1;
      transports[0]?.respond({
        bundle: {
          chunks: [],
          dependencies: [],
          diagnostics: [],
          javascript: new Uint8Array([1]),
          watchDirectories: [],
        },
        id: firstId,
        type: 'success',
      });
      await compilation;

      await vi.advanceTimersByTimeAsync(20);
      expect(transports[0]?.terminate).toHaveBeenCalledOnce();

      const nextCompilation = client.compile(REQUEST);
      const nextRequest = transports[1]?.requests[0];
      const nextId = nextRequest?.type === 'compile' ? nextRequest.id : -1;
      transports[1]?.respond({
        bundle: {
          chunks: [],
          dependencies: [],
          diagnostics: [],
          javascript: new Uint8Array([2]),
          watchDirectories: [],
        },
        id: nextId,
        type: 'success',
      });
      await expect(nextCompilation).resolves.toMatchObject({ javascript: new Uint8Array([2]) });
    } finally {
      vi.useRealTimers();
    }
  });
});
