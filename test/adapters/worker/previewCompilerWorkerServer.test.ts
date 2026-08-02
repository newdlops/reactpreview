/** Verifies serialized resource bounds, fast-pass priority, and worker shutdown ordering. */
import { describe, expect, it, vi } from 'vitest';
import type { PreviewBuildRequest, PreviewBundle } from '../../../src/domain/preview';
import type { PreviewBuildExecutionContext } from '../../../src/domain/previewBuildExecution';
import type {
  PreviewCompleteRouteInventoryTelemetryEvent,
  PreviewCompleteRouteInventoryTelemetryObserver,
  PreviewInspectorCompleteRouteInventory,
  PreviewInspectorCompleteRouteInventoryLimits,
} from '../../../src/adapters/esbuild/inspector/previewInspectorCompleteRouteInventory';
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

  /** Inventory is configured per inventory-specific test and unused by route scheduling tests. */
  public readonly collectCompleteRouteInventory = vi.fn(
    (
      _request: PreviewBuildRequest,
      _limits?: Partial<PreviewInspectorCompleteRouteInventoryLimits>,
      _signal?: AbortSignal,
      _observer?: PreviewCompleteRouteInventoryTelemetryObserver,
    ): Promise<PreviewInspectorCompleteRouteInventory> => {
      void _request;
      void _limits;
      void _signal;
      void _observer;
      return Promise.reject(new Error('Inventory response was not configured for this test.'));
    },
  );

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
  /** Cancels active enrichment and moves a cold fast pass ahead of queued full analysis. */
  it('preempts optional full enrichment for fast first paint', async () => {
    const port = new FakeWorkerPort();
    const compiler = new DeferredCompiler();
    const server = new PreviewCompilerWorkerServer(port, compiler);
    server.start();

    port.request(createCompileRequest(1, 'full', 'context-enrichment'));
    port.request(createCompileRequest(2, 'full', 'context-enrichment'));
    port.request(createCompileRequest(3, 'fast'));
    expect(compiler.calls.map((call) => call.request.documentPath)).toEqual(['/Target1.tsx']);
    expect(compiler.calls[0]?.context?.signal?.aborted).toBe(true);
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
    expect(port.responses.filter((response) => response.type === 'success')).toHaveLength(2);
    expect(
      port.responses.find((response) => response.type === 'failure' && response.id === 1),
    ).toMatchObject({ error: { kind: 'cancelled' }, id: 1, type: 'failure' });
  });

  /** A required complete fallback remains foreground work and cannot be preempted by another tab. */
  it('does not preempt a foreground full build', async () => {
    const port = new FakeWorkerPort();
    const compiler = new DeferredCompiler();
    const server = new PreviewCompilerWorkerServer(port, compiler);
    server.start();

    port.request(createCompileRequest(1, 'full'));
    port.request(createCompileRequest(2, 'fast'));
    expect(compiler.calls[0]?.context?.signal?.aborted).toBe(false);

    compiler.calls[0]?.deferred.resolve(createBundle(1));
    await waitForMicrotasks();
    expect(compiler.calls.map((call) => call.request.documentPath)).toEqual([
      '/Target1.tsx',
      '/Target2.tsx',
    ]);
  });

  /** Queued first paint overtakes complete foreground work without cancelling or dropping it. */
  it('orders fast foreground before queued full foreground and enrichment', async () => {
    const port = new FakeWorkerPort();
    const compiler = new DeferredCompiler();
    const server = new PreviewCompilerWorkerServer(port, compiler);
    server.start();

    port.request(createCompileRequest(1, 'full'));
    port.request(createCompileRequest(2, 'full'));
    port.request(createCompileRequest(3, 'full', 'context-enrichment'));
    port.request(createCompileRequest(4, 'fast'));

    compiler.calls[0]?.deferred.resolve(createBundle(1));
    await waitForMicrotasks();
    expect(compiler.calls.map((call) => call.request.documentPath)).toEqual([
      '/Target1.tsx',
      '/Target4.tsx',
    ]);
    compiler.calls[1]?.deferred.resolve(createBundle(4));
    await waitForMicrotasks();
    expect(compiler.calls.map((call) => call.request.documentPath)).toEqual([
      '/Target1.tsx',
      '/Target4.tsx',
      '/Target2.tsx',
    ]);
    compiler.calls[2]?.deferred.resolve(createBundle(2));
    await waitForMicrotasks();
    expect(compiler.calls.map((call) => call.request.documentPath)).toEqual([
      '/Target1.tsx',
      '/Target4.tsx',
      '/Target2.tsx',
      '/Target3.tsx',
    ]);
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

  it('releases the inventory compiler before posting the one-shot success', async () => {
    const port = new FakeWorkerPort();
    const compiler = new DeferredCompiler();
    const inventory: PreviewInspectorCompleteRouteInventory = {
      analysisPasses: 1,
      complete: true,
      counts: { duplicate: 0, runnable: 0, total: 0, unresolved: 0 },
      dependencyPaths: [],
      entries: [],
      limits: { maximumAnalysisPasses: 1, maximumBranches: 1, maximumDepth: 1 },
      owner: { exportName: 'default', sourcePath: '/workspace/App.tsx' },
      predecessorVersion: 3,
      replayPasses: 0,
      replayPolicy: { digest: 'a'.repeat(64), predecessorVersion: 3, version: 4 },
      truncated: false,
      version: 4,
    };
    let releaseShutdown!: () => void;
    compiler.collectCompleteRouteInventory.mockResolvedValueOnce(inventory);
    compiler.shutdown.mockReturnValueOnce(
      new Promise<void>((resolve) => {
        releaseShutdown = resolve;
      }),
    );
    const server = new PreviewCompilerWorkerServer(port, compiler);
    server.start();

    port.request({
      request: {
        dependencySnapshots: [],
        documentPath: '/workspace/App.tsx',
        language: 'tsx',
        sourceText: 'export default function App() { return null; }',
        workspaceRoot: '/workspace',
      },
      type: 'collect-complete-route-inventory',
    });
    await waitForMicrotasks();

    expect(compiler.collectCompleteRouteInventory).toHaveBeenCalledOnce();
    const progressEvent: PreviewCompleteRouteInventoryTelemetryEvent = {
      cpuSystemMicros: 2,
      cpuUserMicros: 1,
      elapsedMs: 3,
      heapUsedBytes: 4,
      phase: 'prepare-source-index',
      rssBytes: 5,
      sequence: 1,
      transition: 'start',
      version: 1,
    };
    compiler.collectCompleteRouteInventory.mock.calls[0]?.[3]?.(progressEvent);
    expect(port.responses).toEqual([
      {
        event: progressEvent,
        type: 'complete-route-inventory-progress',
      },
    ]);
    expect(compiler.shutdown).toHaveBeenCalledOnce();
    releaseShutdown();
    await waitForMicrotasks();
    expect(port.responses).toEqual([
      {
        event: progressEvent,
        type: 'complete-route-inventory-progress',
      },
      { inventory, type: 'complete-route-inventory-success' },
    ]);
    expect(port.close).toHaveBeenCalledOnce();
  });

  it('returns one stable inventory failure only after compiler shutdown', async () => {
    const port = new FakeWorkerPort();
    const compiler = new DeferredCompiler();
    compiler.collectCompleteRouteInventory.mockRejectedValueOnce(
      new Error('synthetic inventory failure'),
    );
    const server = new PreviewCompilerWorkerServer(port, compiler);
    server.start();

    port.request({
      request: {
        dependencySnapshots: [],
        documentPath: '/workspace/App.tsx',
        language: 'tsx',
        sourceText: 'export default function App() { return null; }',
        workspaceRoot: '/workspace',
      },
      type: 'collect-complete-route-inventory',
    });
    await waitForMicrotasks();

    expect(compiler.shutdown).toHaveBeenCalledOnce();
    expect(port.responses).toEqual([
      {
        error: {
          code: 'preview-inventory-failed',
          message: 'synthetic inventory failure',
        },
        type: 'complete-route-inventory-failure',
      },
    ]);
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
    expect(
      port.responses.find(
        (response) => response.type === 'failure' && response.error.kind === 'stalled',
      ),
    ).toMatchObject({ id: 10 });
  });

  /** Queue pressure lets foreground replace only optional enrichment, never another foreground tab. */
  it('evicts queued enrichment to admit fast foreground', () => {
    const port = new FakeWorkerPort();
    const compiler = new DeferredCompiler();
    const server = new PreviewCompilerWorkerServer(port, compiler);
    server.start();

    port.request(createCompileRequest(1, 'full'));
    for (let id = 2; id <= 8; id += 1) {
      port.request(createCompileRequest(id, 'full'));
    }
    port.request(createCompileRequest(9, 'full', 'context-enrichment'));
    port.request(createCompileRequest(10, 'fast'));

    const capacityFailures = port.responses.filter(
      (response) => response.type === 'failure' && response.error.kind === 'stalled',
    );
    expect(capacityFailures).toHaveLength(1);
    expect(capacityFailures[0]).toMatchObject({ id: 9 });
  });

  it('relays a broad graph-plan without treating descriptor paths as emitted modules', async () => {
    const port = new FakeWorkerPort();
    const compiler = new DeferredCompiler();
    const server = new PreviewCompilerWorkerServer(port, compiler);
    server.start();
    port.request(createCompileRequest(1, 'fast'));

    expect(() =>
      compiler.calls[0]?.context?.reportProgress?.('analyzing-project', {
        analysisCandidateCount: 1,
        corridorSourceCount: 513,
        dependencySnapshotCount: 0,
        discoveryScope: 'selected-corridor',
        discoveryTruncated: false,
        executableCandidateCount: 1,
        kind: 'graph-plan',
        preparationMode: 'fast',
        styleSnapshotCount: 0,
      }),
    ).not.toThrow();
    expect(port.responses).toContainEqual({
      activity: {
        analysisCandidateCount: 1,
        corridorSourceCount: 513,
        dependencySnapshotCount: 0,
        discoveryScope: 'selected-corridor',
        discoveryTruncated: false,
        executableCandidateCount: 1,
        kind: 'graph-plan',
        preparationMode: 'fast',
        styleSnapshotCount: 0,
      },
      id: 1,
      stage: 'analyzing-project',
      type: 'progress',
    });

    compiler.calls[0]?.deferred.resolve(createBundle(1));
    await waitForMicrotasks();
  });

  it('relays a rejected frozen frontier for the compiler to terminate with its typed error', async () => {
    const port = new FakeWorkerPort();
    const compiler = new DeferredCompiler();
    const server = new PreviewCompilerWorkerServer(port, compiler);
    server.start();
    port.request(createCompileRequest(1, 'fast'));

    expect(() =>
      compiler.calls[0]?.context?.reportProgress?.('analyzing-project', {
        analysisCandidateCount: 1,
        authoredEdgeCount: 257,
        corridorSourceCount: 2,
        dependencySnapshotCount: 0,
        discoveryScope: 'selected-corridor',
        discoveryTruncated: false,
        exactModuleCount: 2,
        executableCandidateCount: 1,
        frontierSourceBytes: 1024,
        graphAdmission: 'unbounded',
        kind: 'bundle-frontier',
        maximumDepth: 1,
        optionalComponentCount: 0,
        packageDemandSourceCount: 1,
        phase: 'rejected',
        preparationMode: 'fast',
        projectedEdgeCount: 0,
        styleSnapshotCount: 0,
        supportModuleCount: 0,
        totalAuthoredModuleCount: 2,
        truncated: true,
        truncationReasons: ['source-parse-failure'],
      }),
    ).not.toThrow();
    const progress = port.responses.find(
      (response) => response.type === 'progress' && response.id === 1,
    );
    expect(progress).toMatchObject({
      activity: { kind: 'bundle-frontier', phase: 'rejected' },
      id: 1,
      stage: 'analyzing-project',
      type: 'progress',
    });

    compiler.calls[0]?.deferred.resolve(createBundle(1));
    await waitForMicrotasks();
    expect(compiler.shutdown).not.toHaveBeenCalled();
  });
});

/** Creates one immutable worker compile request. */
function createCompileRequest(
  id: number,
  preparationMode: 'fast' | 'full',
  buildIntent: 'context-enrichment' | 'foreground' = 'foreground',
): Extract<PreviewCompilerWorkerRequest, { readonly type: 'compile' }> {
  return {
    id,
    request: {
      dependencySnapshots: [],
      buildIntent,
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
