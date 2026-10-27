/** Verifies bounded mirror delivery when hidden editor groups stop animation frames. */
import vm from 'node:vm';
import { describe, expect, it } from 'vitest';
import { createPreviewInspectorCompanionRuntimeSource } from '../../../../src/adapters/esbuild/pageInspector/previewInspectorCompanionRuntimeSource';

interface BridgeRuntime {
  /** Registers only the extension-owned shell in this deterministic DOM fixture. */
  readonly mount: (shell: unknown) => void;
  /** Coalesces an explicit UI mutation without starting recurring work. */
  readonly schedule: () => void;
  /** Releases every callback owned by the bridge. */
  readonly dispose: () => void;
}

/** Runs the full production bridge with deterministic frame and timer queues, never project React. */
function createBridgeFixture(): {
  readonly delays: readonly number[];
  readonly messages: readonly { html: string; sequence: number }[];
  readonly mount: () => void;
  readonly schedule: () => void;
  readonly dispose: () => void;
  readonly pendingFrames: () => number;
  readonly pendingTimers: () => number;
  readonly runFrame: () => void;
  readonly runTimer: () => void;
  readonly updateHtml: (value: string) => void;
} {
  let nextHandle = 1;
  let html = '<aside class="rpi-shell">initial</aside>';
  const frames = new Map<number, () => void>();
  const timers = new Map<number, () => void>();
  const delays: number[] = [];
  const messages: { html: string; sequence: number }[] = [];
  const sandbox: { runtime?: BridgeRuntime } = {};
  vm.runInNewContext(
    `${createPreviewInspectorCompanionRuntimeSource()}
     globalThis.runtime = {
       mount: setPreviewInspectorCompanionShell,
       schedule: schedulePreviewInspectorCompanionSnapshot,
       dispose: () => previewInspectorCompanionState.dispose(),
     };`,
    Object.assign(sandbox, {
      previewHotRuntime: {},
      previewInspectorPostHostMessage: (message: (typeof messages)[number]) =>
        messages.push(message),
      requestAnimationFrame: (callback: () => void) => {
        const handle = nextHandle++;
        frames.set(handle, callback);
        return handle;
      },
      cancelAnimationFrame: (handle: number) => frames.delete(handle),
      setTimeout: (callback: () => void, delay: number) => {
        const handle = nextHandle++;
        delays.push(delay);
        timers.set(handle, callback);
        return handle;
      },
      clearTimeout: (handle: number) => timers.delete(handle),
    }),
  );
  const runtime = sandbox.runtime;
  if (runtime === undefined) throw new Error('Companion bridge did not initialize.');
  const shell = {
    isConnected: true,
    querySelectorAll: () => [],
    setAttribute: () => undefined,
    cloneNode: () => ({ outerHTML: html, querySelector: () => null, querySelectorAll: () => [] }),
  };
  return {
    delays,
    messages,
    mount: () => {
      runtime.mount(shell);
    },
    schedule: runtime.schedule,
    dispose: runtime.dispose,
    pendingFrames: () => frames.size,
    pendingTimers: () => timers.size,
    runFrame: () => {
      runPendingCallback(frames);
    },
    runTimer: () => {
      runPendingCallback(timers);
    },
    updateHtml: (value: string) => {
      html = value;
    },
  };
}

/** Removes a queued browser callback before invoking it, matching one-shot scheduler behavior. */
function runPendingCallback(callbacks: Map<number, () => void>): void {
  const pending = callbacks.entries().next().value;
  if (pending === undefined) throw new Error('Expected a queued browser callback.');
  callbacks.delete(pending[0]);
  pending[1]();
}

describe('Preview Inspector companion snapshot scheduling', () => {
  it('delivers one coalesced snapshot even when no animation frame runs', () => {
    const fixture = createBridgeFixture();
    fixture.mount();
    fixture.schedule();
    fixture.schedule();
    expect(fixture.pendingFrames()).toBe(1);
    expect(fixture.pendingTimers()).toBe(1);
    expect(fixture.delays.every((delay) => delay > 0 && delay <= 250)).toBe(true);
    fixture.runTimer();
    expect(fixture.messages).toHaveLength(1);
    expect(fixture.pendingFrames()).toBe(0);
    expect(fixture.pendingTimers()).toBe(0);
  });

  it('cancels the timer when a visible frame publishes first', () => {
    const fixture = createBridgeFixture();
    fixture.mount();
    expect(fixture.pendingTimers()).toBe(1);
    fixture.runFrame();
    expect(fixture.messages).toHaveLength(1);
    expect(fixture.pendingFrames()).toBe(0);
    expect(fixture.pendingTimers()).toBe(0);
  });

  it('releases pending delivery on disposal without scheduling more work', () => {
    const fixture = createBridgeFixture();
    fixture.mount();
    expect(fixture.pendingTimers()).toBe(1);
    fixture.dispose();
    fixture.schedule();
    expect(fixture.pendingFrames()).toBe(0);
    expect(fixture.pendingTimers()).toBe(0);
    expect(fixture.messages).toHaveLength(0);
  });

  it('delivers subsequent UI changes after a frame-stalled publication', () => {
    const fixture = createBridgeFixture();
    fixture.mount();
    fixture.runTimer();
    fixture.updateHtml('<aside class="rpi-shell">current target details</aside>');
    fixture.schedule();
    fixture.runTimer();
    expect(fixture.messages.map((message) => message.sequence)).toEqual([1, 2]);
    expect(fixture.messages[1]?.html).toContain('current target details');
    expect(fixture.pendingFrames()).toBe(0);
    expect(fixture.pendingTimers()).toBe(0);
  });

  it('retains unchanged-content deduplication after timer delivery', () => {
    const fixture = createBridgeFixture();
    fixture.mount();
    fixture.runTimer();
    fixture.schedule();
    fixture.runTimer();
    expect(fixture.messages).toHaveLength(1);
    expect(fixture.pendingFrames()).toBe(0);
    expect(fixture.pendingTimers()).toBe(0);
  });
});
