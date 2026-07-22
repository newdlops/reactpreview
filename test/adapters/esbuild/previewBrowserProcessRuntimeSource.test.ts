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
function initializeProcessInContext(
  context: ReturnType<typeof createContext>,
  publicEnvironment: Readonly<Record<string, string>> = {},
): string {
  return runInContext(
    `(() => {${createPreviewBrowserProcessRuntimeSource(publicEnvironment)}\n` +
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

  /** Uses admitted dotenv values and synthesizes only missing public URL-shaped names. */
  it('provides explicit public values and a narrow non-routable URL fallback', () => {
    const sandbox: Record<string, unknown> = { URL };
    const context = createContext(sandbox);

    initializeProcessInContext(context, {
      NEXT_PUBLIC_APP_NAME: 'Preview App',
      VITE_API_URL: 'https://configured.example/api',
    });
    const previewProcess = sandbox.process as TestBrowserProcess;

    expect(previewProcess.env.NEXT_PUBLIC_APP_NAME).toBe('Preview App');
    expect(previewProcess.env.VITE_API_URL).toBe('https://configured.example/api');
    expect(previewProcess.env.NEXT_PUBLIC_APP_URL).toBe('https://react-preview.invalid/');
    expect(previewProcess.env.REACT_APP_API_ORIGIN).toBe('https://react-preview.invalid/');
    expect(previewProcess.env.NEXT_PUBLIC_FEATURE_ENABLED).toBeUndefined();
    expect(previewProcess.env.DATABASE_URL).toBeUndefined();
    expect('NEXT_PUBLIC_APP_URL' in previewProcess.env).toBe(false);
    expect(Object.hasOwn(previewProcess.env, 'NEXT_PUBLIC_APP_URL')).toBe(false);
    expect(Object.keys(previewProcess.env)).not.toContain('NEXT_PUBLIC_APP_URL');
    expect(runInContext('new URL(process.env.NEXT_PUBLIC_APP_URL).href', context)).toBe(
      'https://react-preview.invalid/',
    );
  });

  /** Preserves a project-owned object and never fills or rewrites its semantic fields. */
  it('preserves an existing process value', () => {
    const existingProcess = { env: { PROJECT_MODE: 'authored' }, platform: 'project-browser' };
    const sandbox: Record<string, unknown> = { process: existingProcess };
    const context = createContext(sandbox);

    const status = initializeProcessInContext(context, {
      NEXT_PUBLIC_APP_URL: 'https://must-not-mutate.example/',
    });

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

  /** Refreshes compiler-owned public keys while retaining the process object and package values. */
  it('updates public dotenv values across hot entries without resetting unrelated mutations', () => {
    const sandbox: Record<string, unknown> = { queueMicrotask };
    const context = createContext(sandbox);

    initializeProcessInContext(context, {
      NEXT_PUBLIC_OLD_URL: 'https://old.example/',
      VITE_LABEL: 'before',
    });
    const firstProcess = sandbox.process as TestBrowserProcess;
    firstProcess.env.PACKAGE_MARKER = 'retained';
    initializeProcessInContext(context, {
      NEXT_PUBLIC_NEW_URL: 'https://new.example/',
      VITE_LABEL: 'after',
    });
    const currentProcess = sandbox.process as TestBrowserProcess;

    expect(currentProcess).toBe(firstProcess);
    expect(currentProcess.env.PACKAGE_MARKER).toBe('retained');
    expect(currentProcess.env.VITE_LABEL).toBe('after');
    expect(currentProcess.env.NEXT_PUBLIC_NEW_URL).toBe('https://new.example/');
    // A removed URL-shaped key falls back rather than retaining the stale authored value.
    expect(currentProcess.env.NEXT_PUBLIC_OLD_URL).toBe('https://react-preview.invalid/');
  });

  /** Replaces a frozen or sealed owned env while preserving process identity and package values. */
  it('recovers hot public values from frozen and sealed environment targets', () => {
    for (const lockEnvironment of [Object.freeze, Object.seal]) {
      const sandbox: Record<string, unknown> = { queueMicrotask };
      const context = createContext(sandbox);
      initializeProcessInContext(context, {
        NEXT_PUBLIC_OLD_URL: 'https://old.example/',
      });
      const previewProcess = sandbox.process as TestBrowserProcess;
      previewProcess.env.PACKAGE_MARKER = 'retained';
      const lockedEnvironment = previewProcess.env;
      lockEnvironment(lockedEnvironment);

      const status = initializeProcessInContext(context, {
        NEXT_PUBLIC_NEW_URL: 'https://new.example/',
      });
      const currentProcess = sandbox.process as TestBrowserProcess;

      expect(status).toContain('replaced a locked public environment fallback');
      expect(currentProcess).toBe(previewProcess);
      expect(currentProcess.env).not.toBe(lockedEnvironment);
      expect(currentProcess.env.PACKAGE_MARKER).toBe('retained');
      expect(currentProcess.env.NEXT_PUBLIC_NEW_URL).toBe('https://new.example/');
      expect(currentProcess.env.NEXT_PUBLIC_OLD_URL).toBe('https://react-preview.invalid/');
    }
  });

  /** Leaves a fully hardened fallback untouched and reports that a hot refresh was skipped. */
  it('does not throw when both the owned process and environment are frozen', () => {
    const sandbox: Record<string, unknown> = { queueMicrotask };
    const context = createContext(sandbox);
    initializeProcessInContext(context, {
      NEXT_PUBLIC_APP_URL: 'https://before.example/',
    });
    const previewProcess = sandbox.process as TestBrowserProcess;
    const lockedEnvironment = previewProcess.env;
    Object.freeze(lockedEnvironment);
    Object.freeze(previewProcess);

    let status = '';
    expect(() => {
      status = initializeProcessInContext(context, {
        NEXT_PUBLIC_APP_URL: 'https://after.example/',
      });
    }).not.toThrow();

    expect(status).toContain('refresh was skipped because process.env is locked');
    expect(sandbox.process).toBe(previewProcess);
    expect((sandbox.process as TestBrowserProcess).env).toBe(lockedEnvironment);
    expect(lockedEnvironment.NEXT_PUBLIC_APP_URL).toBe('https://before.example/');
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
