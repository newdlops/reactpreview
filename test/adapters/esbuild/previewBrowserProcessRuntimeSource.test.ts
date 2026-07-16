/**
 * Executes the generated browser-process boundary in a clean JavaScript realm. These tests prove
 * the compatibility value works without inheriting Node's real global `process` from the test host.
 */
import { createContext, runInContext } from 'node:vm';
import { describe, expect, it } from 'vitest';
import { createPreviewBrowserProcessRuntimeSource } from '../../../src/adapters/esbuild/previewBrowserProcessRuntimeSource';

/** Browser-facing subset exercised by legacy browser packages and the preview runtime tests. */
interface TestBrowserProcess {
  readonly argv: unknown[];
  readonly binding?: unknown;
  readonly browser: boolean;
  readonly cwd: () => string;
  readonly env: Record<string, string>;
  readonly on: () => TestBrowserProcess;
  readonly platform: string;
  readonly nextTick: (
    callback: (...arguments_: unknown[]) => void,
    ...arguments_: unknown[]
  ) => void;
  readonly version: string;
}

/** Evaluates one cache-busted entry scope while retaining symbol state on the shared global. */
function initializeProcessInContext(context: ReturnType<typeof createContext>): string {
  return runInContext(
    `(() => {${createPreviewBrowserProcessRuntimeSource()}\n` +
      'return initializePreviewBrowserProcess();})()',
    context,
  ) as string;
}

describe('preview browser process runtime source', () => {
  /** Installs only neutral browser metadata, scheduling, and inert event methods. */
  it('installs a bounded process object before project modules evaluate', () => {
    const queuedCallbacks: (() => void)[] = [];
    const sandbox: Record<string, unknown> = {
      queueMicrotask: (callback: () => void) => queuedCallbacks.push(callback),
    };
    const context = createContext(sandbox);

    const status = initializeProcessInContext(context);
    const previewProcess = sandbox.process as TestBrowserProcess;
    const callbackArguments: unknown[] = [];
    previewProcess.nextTick((...arguments_) => callbackArguments.push(...arguments_), 'ready', 7);

    expect(status).toContain('bounded browser metadata');
    expect(previewProcess.browser).toBe(true);
    expect(previewProcess.platform).toBe('browser');
    expect(previewProcess.cwd()).toBe('/');
    expect(previewProcess.env.NODE_ENV).toBe('development');
    expect(previewProcess.argv).toEqual([]);
    expect(previewProcess.version).toBe('');
    expect(previewProcess.binding).toBeUndefined();
    expect(previewProcess.on()).toBe(previewProcess);
    expect(callbackArguments).toEqual([]);

    queuedCallbacks[0]?.();
    expect(callbackArguments).toEqual(['ready', 7]);
  });

  /** Preserves a project-owned object and never fills or rewrites its semantic fields. */
  it('preserves an existing process value', () => {
    const existingProcess = { env: { PROJECT_MODE: 'authored' }, platform: 'project-browser' };
    const sandbox: Record<string, unknown> = { process: existingProcess };
    const context = createContext(sandbox);

    const status = initializeProcessInContext(context);

    expect(status).toContain('preserved an existing host or project process object');
    expect(sandbox.process).toBe(existingProcess);
    expect(existingProcess).toEqual({
      env: { PROJECT_MODE: 'authored' },
      platform: 'project-browser',
    });
  });

  /** Reuses the same fallback across hot entry imports instead of resetting package mutations. */
  it('is idempotent across cache-busted entry execution', () => {
    const sandbox: Record<string, unknown> = { queueMicrotask };
    const context = createContext(sandbox);

    initializeProcessInContext(context);
    const firstProcess = sandbox.process as TestBrowserProcess;
    firstProcess.env.PREVIEW_HOT_MARKER = 'retained';
    const secondStatus = initializeProcessInContext(context);

    expect(sandbox.process).toBe(firstProcess);
    expect((sandbox.process as TestBrowserProcess).env.PREVIEW_HOT_MARKER).toBe('retained');
    expect(secondStatus).toContain('reused the bounded browser compatibility object');
  });

  /** Reports a hardened host descriptor instead of throwing before the preview diagnostic mounts. */
  it('returns an unavailable status when the host rejects installation', () => {
    const sandbox: Record<string, unknown> = {};
    Object.defineProperty(sandbox, 'process', {
      configurable: false,
      enumerable: false,
      value: undefined,
      writable: false,
    });
    const context = createContext(sandbox);

    expect(initializeProcessInContext(context)).toContain('host rejected');
    expect(sandbox.process).toBeUndefined();
  });
});
