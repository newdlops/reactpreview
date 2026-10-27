/** Rejects false 45-second Page Inspector failures while retaining finite recovery and cancellation. */
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  PreviewCompilerWorkerClient,
  type PreviewCompilerWorkerTransport,
} from '../../../src/adapters/worker/previewCompilerWorkerClient';
import type {
  PreviewCompilerWorkerRequest,
  PreviewCompilerWorkerResponse,
} from '../../../src/adapters/worker/previewCompilerWorkerProtocol';
import type { PreviewBuildRequest } from '../../../src/domain/preview';
import {
  PreviewBuildCancelledError,
  PreviewBuildStalledError,
} from '../../../src/domain/previewBuildExecution';

/** In-memory transport with explicit milestones and synchronous shutdown acknowledgement. */
class DeadlineTransport implements PreviewCompilerWorkerTransport {
  private listener: ((message: unknown) => void) | undefined;
  public readonly requests: PreviewCompilerWorkerRequest[] = [];
  public readonly terminate = vi.fn(() => Promise.resolve(0));

  /** The deterministic fixture has no native worker errors. */
  public onError(): void {
    /* Errors are covered by the real client transport tests. */
  }
  /** The deterministic fixture has no native worker exit event. */
  public onExit(): void {
    /* Termination is observable through the spy above. */
  }
  /** Retains the single client-owned response listener. */
  public onMessage(listener: (message: unknown) => void): void {
    this.listener = listener;
  }
  /** Records control messages and acknowledges shutdown so tests leave no live timers. */
  public postMessage(message: PreviewCompilerWorkerRequest): void {
    this.requests.push(message);
    if (message.type === 'shutdown') this.respond({ type: 'shutdown-complete' });
  }
  /** Delivers only well-typed worker messages. */
  public respond(message: PreviewCompilerWorkerResponse): void {
    this.listener?.(message);
  }
}

const REQUEST: PreviewBuildRequest = {
  dependencySnapshots: [],
  documentPath: '/workspace/Target.tsx',
  language: 'tsx',
  preparationMode: 'fast',
  renderMode: 'page-inspector',
  sourceText: 'export default function Target() { return null; }',
  workspaceRoot: '/workspace',
};
const BUNDLE = {
  chunks: [],
  dependencies: [],
  diagnostics: [],
  javascript: new Uint8Array([1]),
  watchDirectories: [],
};
const clients: PreviewCompilerWorkerClient[] = [];

/** Starts one active request using production budgets rather than a short test override. */
function active(
  options: {
    signal?: AbortSignal;
    fixed?: number;
    intent?: 'foreground' | 'context-enrichment';
  } = {},
): {
  client: PreviewCompilerWorkerClient;
  transport: DeadlineTransport;
  id: number;
  compilation: ReturnType<PreviewCompilerWorkerClient['compile']>;
  settled: ReturnType<typeof vi.fn>;
} {
  vi.useFakeTimers();
  const transport = new DeadlineTransport();
  const client = new PreviewCompilerWorkerClient('/extension/worker.js', {
    createTransport: () => transport,
    ...(options.fixed === undefined ? {} : { compilationTimeoutMs: options.fixed }),
  });
  clients.push(client);
  const compilation = client.compile(
    { ...REQUEST, buildIntent: options.intent ?? 'foreground' },
    options.signal === undefined ? undefined : { signal: options.signal },
  );
  const first = transport.requests[0];
  if (first?.type !== 'compile') throw new Error('Expected one compile request.');
  const settled = vi.fn();
  void compilation.then(settled, settled);
  transport.respond({ id: first.id, type: 'started' });
  return { client, transport, id: first.id, compilation, settled };
}

afterEach(async () => {
  for (const client of clients.splice(0)) await client.shutdown();
  vi.useRealTimers();
});

describe('Page Inspector analysis deadlines', () => {
  it.each([
    ['discovering-components', 'foreground'],
    ['preparing-runtime', 'foreground'],
    ['analyzing-project', 'foreground'],
    ['discovering-components', 'context-enrichment'],
    ['preparing-runtime', 'context-enrichment'],
    ['analyzing-project', 'context-enrichment'],
  ] as const)('lets %s finish after 45 seconds for %s work', async (stage, intent) => {
    const test = active({ intent });
    test.transport.respond({ id: test.id, stage, type: 'progress' });
    await vi.advanceTimersByTimeAsync(61_000);
    expect(test.settled).not.toHaveBeenCalled();
    expect(test.transport.terminate).not.toHaveBeenCalled();
    test.transport.respond({ id: test.id, type: 'success', bundle: BUNDLE });
    await expect(test.compilation).resolves.toEqual(BUNDLE);
  });

  it('still recycles stalled analysis at 120 seconds despite repeated identical progress', async () => {
    const test = active();
    const failure = test.compilation.catch((error: unknown) => error);
    test.transport.respond({ id: test.id, stage: 'discovering-components', type: 'progress' });
    await vi.advanceTimersByTimeAsync(60_000);
    test.transport.respond({ id: test.id, stage: 'discovering-components', type: 'progress' });
    await vi.advanceTimersByTimeAsync(59_999);
    expect(test.settled).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1);
    await expect(failure).resolves.toBeInstanceOf(PreviewBuildStalledError);
    expect(test.transport.terminate).toHaveBeenCalledOnce();
    expect(test.transport.requests.at(-1)).toEqual({ id: test.id, type: 'cancel' });
  });

  it('gives distinct stages their own allowance rather than one whole-build 120-second cap', async () => {
    const test = active();
    test.transport.respond({ id: test.id, stage: 'discovering-components', type: 'progress' });
    await vi.advanceTimersByTimeAsync(61_000);
    test.transport.respond({ id: test.id, stage: 'preparing-runtime', type: 'progress' });
    await vi.advanceTimersByTimeAsync(61_000);
    expect(test.settled).not.toHaveBeenCalled();
    test.transport.respond({ id: test.id, type: 'success', bundle: BUNDLE });
    await expect(test.compilation).resolves.toEqual(BUNDLE);
  });

  it('preserves an explicitly configured fixed deadline', async () => {
    const test = active({ fixed: 45_000 });
    const failure = test.compilation.catch((error: unknown) => error);
    await vi.advanceTimersByTimeAsync(45_000);
    await expect(failure).resolves.toBeInstanceOf(PreviewBuildStalledError);
    expect(test.transport.terminate).toHaveBeenCalledOnce();
  });

  it('cancels immediately after 45 seconds and retains the short unresponsive-worker grace', async () => {
    const controller = new AbortController();
    const test = active({ signal: controller.signal });
    const failure = test.compilation.catch((error: unknown) => error);
    test.transport.respond({ id: test.id, stage: 'discovering-components', type: 'progress' });
    await vi.advanceTimersByTimeAsync(46_000);
    controller.abort();
    await expect(failure).resolves.toBeInstanceOf(PreviewBuildCancelledError);
    expect(test.transport.requests.at(-1)).toEqual({ id: test.id, type: 'cancel' });
    await vi.advanceTimersByTimeAsync(2_999);
    expect(test.transport.terminate).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1);
    expect(test.transport.terminate).toHaveBeenCalledOnce();
  });
});
