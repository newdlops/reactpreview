/** Verifies serialized resource bounds, fast-pass priority, and worker shutdown ordering. */
import { describe, expect, it, vi } from 'vitest';
import type { PreviewBuildRequest, PreviewBundle } from '../../../src/domain/preview';
import type { PreviewBuildExecutionContext } from '../../../src/domain/previewBuildExecution';
import {
  PreviewCompilerWorkerServer,
  type PreviewCompilerWorkerBackend,
  type PreviewCompilerWorkerPort,
} from '../../../src/adapters/worker/previewCompilerWorkerServer';
import type {
  PreviewCompilerWorkerRequest,
  PreviewCompilerWorkerResponse,
} from '../../../src/adapters/worker/previewCompilerWorkerProtocol';

/** Manually settled promise used to hold one worker compile active. */
interface DeferredBundle {
  /** Pending compiler operation. */
  readonly promise: Promise<PreviewBundle>;
  /** Completes the compiler operation. */
  readonly resolve: (bundle: PreviewBundle) => void;
}

/** Inert worker port that records responses and exposes the registered request listener. */
class FakeWorkerPort implements PreviewCompilerWorkerPort {
  public readonly close = vi.fn();
  private listener: ((message: PreviewCompilerWorkerRequest) => void) | undefined;
  public readonly responses: PreviewCompilerWorkerResponse[] = [];

  /** Registers the server request callback. */
  public onMessage(listener: (message: PreviewCompilerWorkerRequest) => void): void {
    this.listener = listener;
  }

  /** Records one server response; transfer-list contents are asserted by protocol tests. */
  public postMessage(message: PreviewCompilerWorkerResponse): void {
    this.responses.push(message);
  }

  /** Sends one deterministic host request into the server. */
  public request(message: PreviewCompilerWorkerRequest): void {
    this.listener?.(message);
  }
}

/** Compiler backend that exposes each serialized invocation for manual settlement. */
class DeferredCompiler implements PreviewCompilerWorkerBackend {
  public readonly calls: {
    readonly context?: PreviewBuildExecutionContext;
    readonly deferred: DeferredBundle;
    readonly request: PreviewBuildRequest;
  }[] = [];
  public readonly shutdown = vi.fn(() => Promise.resolve());

  /** Records one compile and returns its manually controlled promise. */
  public compile(
    request: PreviewBuildRequest,
    context?: PreviewBuildExecutionContext,
  ): Promise<PreviewBundle> {
    const deferred = createDeferredBundle();
    this.calls.push({
      deferred,
      request,
      ...(context === undefined ? {} : { context }),
    });
    return deferred.promise;
  }
}

describe('PreviewCompilerWorkerServer', () => {
  /** Runs one graph at a time and moves a cold fast pass ahead of queued full enrichment. */
  it('bounds concurrency and prioritizes fast first paint', async () => {
    const port = new FakeWorkerPort();
    const compiler = new DeferredCompiler();
    const server = new PreviewCompilerWorkerServer(port, compiler);
    server.start();

    port.request(createCompileRequest(1, 'full'));
    port.request(createCompileRequest(2, 'full'));
    port.request(createCompileRequest(3, 'fast'));
    expect(compiler.calls.map((call) => call.request.documentPath)).toEqual(['/Target1.tsx']);
    expect(port.responses.filter((response) => response.type === 'started')).toEqual([
      { id: 1, type: 'started' },
    ]);

    compiler.calls[0]?.deferred.resolve(createBundle(1));
    await waitForMicrotasks();
    expect(compiler.calls.map((call) => call.request.documentPath)).toEqual([
      '/Target1.tsx',
      '/Target3.tsx',
    ]);
    expect(port.responses.filter((response) => response.type === 'started')).toEqual([
      { id: 1, type: 'started' },
      { id: 3, type: 'started' },
    ]);
    compiler.calls[1]?.deferred.resolve(createBundle(3));
    await waitForMicrotasks();
    expect(compiler.calls.map((call) => call.request.documentPath)).toEqual([
      '/Target1.tsx',
      '/Target3.tsx',
      '/Target2.tsx',
    ]);
    expect(port.responses.filter((response) => response.type === 'started')).toEqual([
      { id: 1, type: 'started' },
      { id: 3, type: 'started' },
      { id: 2, type: 'started' },
    ]);
    compiler.calls[2]?.deferred.resolve(createBundle(2));
    await waitForMicrotasks();
    expect(port.responses.filter((response) => response.type === 'success')).toHaveLength(3);
  });

  /** Aborts active work before stopping native compiler state and closing the worker port. */
  it('shuts down after the active compile settles', async () => {
    const port = new FakeWorkerPort();
    const compiler = new DeferredCompiler();
    const server = new PreviewCompilerWorkerServer(port, compiler);
    server.start();
    port.request(createCompileRequest(1, 'full'));
    port.request({ type: 'shutdown' });

    expect(compiler.calls[0]?.context?.signal?.aborted).toBe(true);
    compiler.calls[0]?.deferred.resolve(createBundle(1));
    await waitForMicrotasks();
    expect(compiler.shutdown).toHaveBeenCalledOnce();
    expect(port.responses.at(-1)).toEqual({ type: 'shutdown-complete' });
    expect(port.close).toHaveBeenCalledOnce();
  });

  /** Large cloned snapshots cannot accumulate without bound behind one native graph build. */
  it('rejects work beyond the bounded serialized queue', () => {
    const port = new FakeWorkerPort();
    const compiler = new DeferredCompiler();
    const server = new PreviewCompilerWorkerServer(port, compiler);
    server.start();

    for (let id = 1; id <= 10; id += 1) {
      port.request(createCompileRequest(id, 'full'));
    }

    expect(compiler.calls).toHaveLength(1);
    expect(
      port.responses.filter(
        (response) => response.type === 'failure' && response.error.kind === 'stalled',
      ),
    ).toHaveLength(1);
  });
});

/** Creates one immutable worker compile request. */
function createCompileRequest(
  id: number,
  preparationMode: 'fast' | 'full',
): Extract<PreviewCompilerWorkerRequest, { readonly type: 'compile' }> {
  return {
    id,
    request: {
      dependencySnapshots: [],
      documentPath: `/Target${id.toString()}.tsx`,
      language: 'tsx',
      preparationMode,
      sourceText: 'export default function Target() { return null; }',
      workspaceRoot: '/',
    },
    type: 'compile',
  };
}

/** Creates a tiny transferable bundle tagged by request identity. */
function createBundle(id: number): PreviewBundle {
  return {
    chunks: [],
    dependencies: [],
    diagnostics: [],
    javascript: new Uint8Array([id]),
    watchDirectories: [],
  };
}

/** Creates one promise and externally accessible resolver. */
function createDeferredBundle(): DeferredBundle {
  let resolve!: (bundle: PreviewBundle) => void;
  const promise = new Promise<PreviewBundle>((accept) => {
    resolve = accept;
  });
  return { promise, resolve };
}

/** Allows async `finally` scheduling and the next queue drain to complete. */
async function waitForMicrotasks(): Promise<void> {
  await Promise.resolve();
  await Promise.resolve();
}
