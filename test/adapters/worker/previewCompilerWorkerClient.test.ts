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
import { PreviewBuildCancelledError } from '../../../src/domain/previewBuildExecution';

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
});
