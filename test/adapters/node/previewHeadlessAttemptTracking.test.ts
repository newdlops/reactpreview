/**
 * Verifies that the headless host bridge follows render attempts by their own lifecycle events
 * instead of the attempt copy inside the last deduplicated composition snapshot.
 */
import vm from 'node:vm';
import { describe, expect, it } from 'vitest';
import {
  PREVIEW_HEADLESS_STABILIZATION_QUIET_MS,
  createPreviewHeadlessBridgeSource,
} from '../../../src/adapters/node/previewHeadlessRenderer';

const BINDING_NAME = '__reactPreviewHeadless_attempts';

/** A target that rendered while a neural attempt was still open when the snapshot was taken. */
const SNAPSHOT_DETAIL = {
  blockerSummary: { active: 0, items: [] },
  requirementSearch: { exhausted: false, searchStatus: 'settled', settled: true },
  statusCounts: { currentFileMounted: 1, hostOutput: 4 },
  targetState: {
    activeAutoAttemptMode: 'neural-rendered-collection-auto',
    activeAutoAttemptResumeHandled: false,
    activeAutoAttemptResumeScheduled: false,
    activeAutoAttemptSettled: false,
    hasOutput: true,
    mounted: true,
    outputKind: 'target-output',
    pageRootCommitted: true,
    stage: 'target-output',
    status: 'recovering-page-context',
  },
};

describe('headless bridge render-attempt tracking', () => {
  /** A settled non-corridor attempt never sets resume flags, so the snapshot copy cannot decide. */
  it('waits for an open attempt, then captures once its settle event arrives', () => {
    const bridge = createBridge();
    bridge.post({ revision: 1, token: '1:test', type: 'react-preview-runtime-ready' });
    bridge.health('render-attempt-started', {
      mode: 'neural-rendered-collection-auto',
      traceId: 'trace-a',
    });
    bridge.health('page-composition-snapshot', SNAPSHOT_DETAIL);

    bridge.advance(PREVIEW_HEADLESS_STABILIZATION_QUIET_MS + 100);
    expect(bridge.payloads).toHaveLength(0);

    bridge.health('render-attempt-settled', { outcome: 'committed', traceId: 'trace-a' });
    bridge.advance(PREVIEW_HEADLESS_STABILIZATION_QUIET_MS + 100);

    expect(bridge.payloads).toHaveLength(1);
    expect(bridge.payloads[0]?.stabilization).toMatchObject({ capReached: false, quiet: true });
  });

  /** Superseding settles the older trace first; only the newest trace keeps the page pending. */
  it('keeps waiting while a newer attempt replaced a settled one', () => {
    const bridge = createBridge();
    bridge.post({ revision: 1, token: '1:test', type: 'react-preview-runtime-ready' });
    bridge.health('page-composition-snapshot', SNAPSHOT_DETAIL);
    bridge.health('render-attempt-started', {
      mode: 'minimum-requirement-dfs',
      traceId: 'trace-a',
    });
    bridge.health('render-attempt-settled', { outcome: 'superseded', traceId: 'trace-a' });
    bridge.health('render-attempt-started', {
      mode: 'neural-rendered-collection-auto',
      traceId: 'trace-b',
    });

    bridge.advance(PREVIEW_HEADLESS_STABILIZATION_QUIET_MS + 100);

    expect(bridge.payloads).toHaveLength(0);
  });
});

interface BridgeHarness {
  readonly payloads: readonly { readonly stabilization?: Record<string, unknown> }[];
  advance(milliseconds: number): void;
  health(event: string, detail: Record<string, unknown>): void;
  post(message: Record<string, unknown>): void;
}

/** Mount observer stand-in; this harness drives activity through health messages only. */
class InertMutationObserver {
  /** Accepts the bridge's mount subscription without observing anything. */
  public observe(): void {
    return undefined;
  }
}

/** Evaluates the generated bridge with a manual clock and timer queue. */
function createBridge(): BridgeHarness {
  const clock = { now: 10_000 };
  const timers: { callback: () => void; due: number }[] = [];
  const payloads: { stabilization?: Record<string, unknown> }[] = [];
  const root = { innerHTML: '<main>target</main>', querySelector: () => null };
  const context: Record<string, unknown> = {
    Date: { now: () => clock.now },
    MutationObserver: InertMutationObserver,
    [BINDING_NAME]: (payload: string) => {
      payloads.push(JSON.parse(payload) as { stabilization?: Record<string, unknown> });
    },
    addEventListener: () => undefined,
    console: { error: () => undefined, warn: () => undefined },
    document: { body: { children: [] }, getElementById: () => null, querySelector: () => root },
    setTimeout: (callback: () => void, delay?: number) => {
      timers.push({ callback, due: clock.now + Math.max(0, Number(delay) || 0) });
      return timers.length;
    },
  };
  vm.runInNewContext(
    `${createPreviewHeadlessBridgeSource('1:test', 1, BINDING_NAME, true)}
globalThis.__api = globalThis.acquireVsCodeApi();`,
    context,
  );
  const api = context.__api as { postMessage(message: unknown): Promise<boolean> };
  return {
    payloads,
    advance(milliseconds) {
      const end = clock.now + milliseconds;
      for (;;) {
        timers.sort((left, right) => left.due - right.due);
        const next = timers[0];
        if (next === undefined || next.due > end) break;
        timers.shift();
        clock.now = Math.max(clock.now, next.due);
        next.callback();
      }
      clock.now = end;
    },
    health(event, detail) {
      void api.postMessage({
        event: { category: 'render-attempt', detail, event },
        runtimeRevision: 1,
        type: 'react-preview-runtime-health',
      });
    },
    post(message) {
      void api.postMessage(message);
    },
  };
}
