/** Exercises the generated local clock, duration validation and timer ownership with real source. */
import vm from 'node:vm';
import { describe, expect, it } from 'vitest';
import type { PreviewProgressStage, PreviewProgressTiming } from '../../src/domain/previewProgress';
import { PREVIEW_PROGRESS_STEPS } from '../../src/presentation/previewProgress';
import { createPreviewProgressTimingRuntimeSource } from '../../src/presentation/webview/previewProgressTiming';

interface TimingNode {
  textContent: string;
  readonly attributes: Map<string, string>;
  getAttribute(name: string): string | null;
  setAttribute(name: string, value: string): void;
  removeAttribute(name: string): void;
  querySelector(selector: string): TimingNode | null;
}

/** Provides only the text and attribute APIs actually used by the existing timing rows. */
function node(querySelector: TimingNode['querySelector'] = () => null): TimingNode {
  const attributes = new Map<string, string>();
  return {
    attributes,
    textContent: '',
    getAttribute: (name) => attributes.get(name) ?? null,
    setAttribute: (name, value) => {
      attributes.set(name, value);
    },
    removeAttribute: (name) => {
      attributes.delete(name);
    },
    querySelector,
  };
}

/** Supplies a monotonic clock and real interval ownership without sleeping in unit tests. */
function fixture(): {
  readonly apply: (
    revision: number,
    stage: PreviewProgressStage,
    timing?: PreviewProgressTiming,
  ) => void;
  readonly advance: (ms: number) => void;
  readonly duration: (stage: string) => string | undefined;
  readonly state: (stage: string) => string | null | undefined;
  readonly total: () => string;
  readonly timers: () => number;
  readonly stop: () => void;
  readonly hide: () => void;
  readonly pagehide: () => void;
  readonly reinstall: () => void;
} {
  let now = 0;
  const total = node();
  const rows = new Map(
    PREVIEW_PROGRESS_STEPS.map(({ stage }) => {
      const duration = node();
      return [stage, { duration, row: node(() => duration) }] as const;
    }),
  );
  const container = node((selector) => {
    if (selector === '[data-react-preview-total-time]') return total;
    return [...rows].find(([stage]) => selector.includes('"' + stage + '"'))?.[1].row ?? null;
  });
  const host = { hidden: false };
  const root = { isConnected: true, host, querySelector: () => container };
  const timers = new Set<() => void>();
  const listeners = new Map<string, () => void>();
  const sandbox = {
    performance: { now: () => now },
    document: {
      createElement: () => {
        throw new Error('Existing rows must be reused');
      },
    },
    setInterval: (callback: () => void, ms: number) => {
      expect(ms).toBe(250);
      timers.add(callback);
      return callback;
    },
    clearInterval: (callback: () => void) => {
      timers.delete(callback);
    },
    addEventListener: (event: string, listener: () => void) => {
      listeners.set(event, listener);
    },
  };
  const context = vm.createContext(sandbox);
  const source = createPreviewProgressTimingRuntimeSource();
  vm.runInContext(source, context);
  const clock = Reflect.get(sandbox, '__reactPreviewProgressClock') as {
    apply: (root: unknown, message: unknown) => void;
    stop: () => void;
  };
  return {
    apply: (revision, stage, timing) => {
      clock.apply(root, { revision, stage, timing });
    },
    advance: (ms) => {
      now += ms;
      for (const callback of [...timers]) callback();
    },
    duration: (stage) => [...rows].find(([key]) => key === stage)?.[1].duration.textContent,
    state: (stage) => [...rows].find(([key]) => key === stage)?.[1].row.getAttribute('data-state'),
    total: () => total.textContent,
    timers: () => timers.size,
    stop: () => {
      clock.stop();
    },
    hide: () => {
      host.hidden = true;
    },
    pagehide: () => {
      listeners.get('pagehide')?.();
    },
    reinstall: () => {
      vm.runInContext(source, context);
    },
  };
}

const TIMING: PreviewProgressTiming = {
  elapsedMs: 15200,
  stages: [
    { stage: 'resolving-target', elapsedMs: 1200 },
    { stage: 'discovering-components', elapsedMs: 1600 },
    { stage: 'preparing-runtime', elapsedMs: 12400 },
  ],
};

describe('preview elapsed-time runtime', () => {
  it('advances total and current stage only and distinguishes skipped from waiting stages', () => {
    const clock = fixture();
    clock.apply(3, 'preparing-runtime', TIMING);
    clock.advance(600);
    expect(clock.total()).toBe('15.8s');
    expect(clock.duration('preparing-runtime')).toBe('13.0s');
    expect(clock.duration('resolving-target')).toBe('1.2s');
    expect(clock.duration('analyzing-project')).toBe('Skipped');
    expect(clock.duration('bundling-modules')).toBe('Waiting');
    expect(clock.state('preparing-runtime')).toBe('active');
    expect(clock.timers()).toBe(1);
  });

  it('does not rewind on duplicate snapshots or install extra intervals after module replacement', () => {
    const clock = fixture();
    clock.apply(3, 'preparing-runtime', TIMING);
    clock.advance(600);
    clock.reinstall();
    clock.apply(3, 'preparing-runtime', TIMING);
    expect(clock.total()).toBe('15.8s');
    clock.advance(200);
    expect(clock.total()).toBe('16.0s');
    expect(clock.timers()).toBe(1);
  });

  it('retains legacy elapsed time, rejects stale stages and resets on a newer revision', () => {
    const clock = fixture();
    clock.apply(3, 'resolving-target');
    clock.advance(1000);
    clock.apply(3, 'bundling-modules');
    clock.apply(3, 'resolving-target');
    clock.apply(2, 'loading-preview');
    clock.advance(500);
    expect(clock.total()).toBe('1.5s');
    expect(clock.duration('resolving-target')).toBe('1.0s');
    expect(clock.duration('bundling-modules')).toBe('0.5s');
    clock.apply(4, 'resolving-target');
    expect(clock.total()).toBe('0.0s');
    expect(clock.duration('bundling-modules')).toBe('Waiting');
  });

  it.each(['completion', 'pagehide', 'hidden'] as const)('clears its interval on %s', (reason) => {
    const clock = fixture();
    clock.apply(1, 'preparing-runtime', TIMING);
    if (reason === 'completion') clock.stop();
    else if (reason === 'pagehide') clock.pagehide();
    else {
      clock.hide();
      clock.advance(250);
    }
    const frozen = clock.total();
    clock.advance(2000);
    expect(clock.timers()).toBe(0);
    expect(clock.total()).toBe(frozen);
    if (reason === 'hidden') {
      clock.apply(2, 'preparing-runtime', TIMING);
      expect(clock.timers()).toBe(0);
    }
  });

  it.each([
    { elapsedMs: -1, stages: [] },
    { elapsedMs: Infinity, stages: [] },
    { elapsedMs: 20, stages: [{ stage: 'unknown', elapsedMs: 20 }] },
    { elapsedMs: 20, stages: [{ stage: 'loading-preview', elapsedMs: 20 }] },
    { elapsedMs: 20, stages: [{ stage: 'preparing-runtime', elapsedMs: NaN }] },
    {
      elapsedMs: 20,
      stages: [
        { stage: 'resolving-target', elapsedMs: 15 },
        { stage: 'preparing-runtime', elapsedMs: 15 },
      ],
    },
    {
      elapsedMs: 20,
      stages: [
        { stage: 'preparing-runtime', elapsedMs: 10 },
        { stage: 'preparing-runtime', elapsedMs: 10 },
      ],
    },
  ])('ignores malformed timing without replacing the current display: %j', (timing) => {
    const clock = fixture();
    clock.apply(1, 'preparing-runtime', TIMING);
    clock.apply(2, 'preparing-runtime', timing as PreviewProgressTiming);
    expect(clock.total()).toBe('15.2s');
    expect(clock.timers()).toBe(1);
  });
});
