/** Verifies the worker entry forwards compiler ports and owns one ordered native-engine stop. */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { PreviewBuildRequest } from '../../../src/domain/preview';
import type { PreviewCompilerWorkerBackend } from '../../../src/adapters/worker/previewCompilerWorkerServer';

const fixture = vi.hoisted(() => ({
  backend: undefined as PreviewCompilerWorkerBackend | undefined,
  compile: vi.fn<PreviewCompilerWorkerBackend['compile']>(),
  collect: vi.fn<PreviewCompilerWorkerBackend['collectCompleteRouteInventory']>(),
  shutdown: vi.fn<() => Promise<void>>(),
  stop: vi.fn<() => Promise<void>>(),
}));

vi.mock('esbuild', () => ({ stop: fixture.stop }));
vi.mock('node:worker_threads', () => ({
  parentPort: { close: vi.fn(), on: vi.fn(), postMessage: vi.fn() },
  workerData: { trustSystemCertificates: false },
}));
vi.mock('../../../src/adapters/esbuild/esbuildPreviewCompiler', () => {
  /** Exposes inert compiler ports so importing the entry cannot start a real compiler. */
  class InertCompiler {
    public readonly compile = fixture.compile;
    public readonly collectCompleteRouteInventory = fixture.collect;
    public readonly shutdown = fixture.shutdown;
  }
  return { EsbuildPreviewCompiler: InertCompiler };
});
vi.mock('../../../src/adapters/worker/previewCompilerWorkerServer', () => {
  /** Captures the actual composed backend while existing scheduler tests cover message ordering. */
  class CapturingServer {
    /** Retains the worker-owned compiler and service ports for explicit invocation. */
    public constructor(_port: unknown, backend: PreviewCompilerWorkerBackend) {
      fixture.backend = backend;
    }
    /** Leaves the fake OS port inert; each test drives the captured backend directly. */
    public start(): void {
      // Scheduling is intentionally exercised by the dedicated real server unit suite.
    }
  }
  return { PreviewCompilerWorkerServer: CapturingServer };
});

beforeEach(() => {
  vi.resetModules();
  fixture.backend = undefined;
});

/** Provides one manually released boundary without timers or external worker processes. */
function deferred(): { readonly promise: Promise<void>; readonly resolve: () => void } {
  let complete: (() => void) | undefined;
  const promise = new Promise<void>((resolve) => {
    complete = resolve;
  });
  return {
    promise,
    resolve: () => {
      complete?.();
    },
  };
}

/** Loads the actual composition root while its OS and compiler adapters remain inert. */
async function loadBackend(): Promise<PreviewCompilerWorkerBackend> {
  await import('../../../src/previewCompilerWorker');
  if (fixture.backend === undefined) throw new Error('Worker backend was not composed.');
  return fixture.backend;
}

describe('compiler worker native-engine ownership', () => {
  it('drains instance resources before stopping the owned engine once across repeated shutdowns', async () => {
    const compiler = deferred();
    const native = deferred();
    fixture.shutdown.mockReturnValue(compiler.promise);
    fixture.stop.mockReturnValue(native.promise);
    const backend = await loadBackend();
    try {
      const first = backend.shutdown();
      expect(backend.shutdown()).toBe(first);
      expect(fixture.shutdown).toHaveBeenCalledOnce();
      expect(fixture.stop).not.toHaveBeenCalled();
      compiler.resolve();
      await vi.waitFor(() => {
        expect(fixture.stop).toHaveBeenCalledOnce();
      });
      let ended = false;
      void first.then(() => {
        ended = true;
      });
      await Promise.resolve();
      expect(ended).toBe(false);
      native.resolve();
      await first;
      expect(ended).toBe(true);
      expect(backend.shutdown()).toBe(first);
      expect(fixture.stop).toHaveBeenCalledOnce();
    } finally {
      compiler.resolve();
      native.resolve();
    }
  });

  it('forwards compile and inventory arguments and failures through their original ports', async () => {
    const backend = await loadBackend();
    const request: PreviewBuildRequest = {
      dependencySnapshots: [],
      documentPath: '/workspace/Root.tsx',
      language: 'tsx',
      sourceText: 'export default function Root() { return null; }',
      workspaceRoot: '/workspace',
    };
    const signal = new AbortController().signal;
    const context = { signal };
    const compileFailure = new Error('owned compile rejection');
    fixture.compile.mockRejectedValue(compileFailure);
    await expect(backend.compile(request, context)).rejects.toBe(compileFailure);
    expect(fixture.compile).toHaveBeenCalledExactlyOnceWith(request, context);
    const limits = { maximumBranches: 3 };
    const observer = vi.fn();
    const inventoryFailure = new Error('owned inventory rejection');
    fixture.collect.mockRejectedValue(inventoryFailure);
    await expect(
      backend.collectCompleteRouteInventory(request, limits, signal, observer),
    ).rejects.toBe(inventoryFailure);
    expect(fixture.collect).toHaveBeenCalledExactlyOnceWith(request, limits, signal, observer);
  });
});
