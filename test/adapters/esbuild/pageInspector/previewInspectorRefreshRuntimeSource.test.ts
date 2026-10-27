/** Verifies that Page Inspector refresh work cannot form a renderer-saturating feedback loop. */
import vm from 'node:vm';
import { describe, expect, it, vi } from 'vitest';
import {
  createPreviewInspectorRefreshRuntimeSource,
  PREVIEW_INSPECTOR_TREE_REFRESH_INTERVAL_MS,
} from '../../../../src/adapters/esbuild/pageInspector/previewInspectorRefreshRuntimeSource';

/** Browser scheduler methods exported only by the isolated VM fixture. */
interface RefreshRuntimeHarness {
  readonly cancel: () => void;
  readonly commit: () => void;
  readonly session: Record<string, unknown>;
  readonly tree: () => void;
}

describe('Preview Inspector refresh runtime source', () => {
  /** Coalesces a burst into one cheap frame and one bounded component-tree notification. */
  it('separates animation-frame highlighting from rate-limited Fiber refreshes', () => {
    const frameCallbacks: (() => void)[] = [];
    const timerCallbacks: { readonly callback: () => void; readonly delay: number }[] = [];
    const highlight = vi.fn();
    const notifyTree = vi.fn();
    const reconcileHiddenElements = vi.fn();
    let now = 1_000;
    const context: Record<string, unknown> & { __runtime?: RefreshRuntimeHarness } = {
      Date,
      MutationObserver: undefined,
      clearTimeout: vi.fn(),
      document: createTestDocument(),
      mountNode: {},
      notifyPreviewInspectorTreeSubscribers: notifyTree,
      performance: { now: () => now },
      previewInspectorSession: {
        boundariesByExport: new Map(),
        manualElementsByExport: new Map(),
        treeDirty: false,
        treeListeners: new Set([vi.fn()]),
      },
      reconcilePreviewInspectorHiddenElements: reconcileHiddenElements,
      refreshPreviewInspectorHighlight: highlight,
      requestAnimationFrame: (callback: () => void) => {
        frameCallbacks.push(callback);
        return frameCallbacks.length;
      },
      cancelAnimationFrame: vi.fn(),
      restorePreviewInspectorOutline: vi.fn(),
      setTimeout: (callback: () => void, delay: number) => {
        timerCallbacks.push({ callback, delay });
        return timerCallbacks.length;
      },
      window: createTestWindow(),
    };
    vm.runInNewContext(
      `${createPreviewInspectorRefreshRuntimeSource()}
       globalThis.__runtime = {
         cancel: cancelPreviewInspectorRefreshScheduling,
         commit: schedulePreviewInspectorCommitRefresh,
         session: previewInspectorSession,
         tree: schedulePreviewInspectorTreeRefresh,
       };`,
      context,
    );
    const runtime = context.__runtime;
    if (runtime === undefined) throw new Error('Refresh runtime fixture did not initialize.');

    for (let index = 0; index < 100; index += 1) runtime.commit();

    expect(frameCallbacks).toHaveLength(1);
    expect(timerCallbacks).toHaveLength(1);
    expect(timerCallbacks[0]?.delay).toBe(0);
    expect(runtime.session.treeDirty).toBe(true);
    expect(highlight).not.toHaveBeenCalled();
    expect(notifyTree).not.toHaveBeenCalled();

    frameCallbacks.shift()?.();
    expect(highlight).toHaveBeenCalledTimes(1);
    expect(notifyTree).not.toHaveBeenCalled();

    timerCallbacks.shift()?.callback();
    expect(reconcileHiddenElements).toHaveBeenCalledTimes(1);
    expect(notifyTree).toHaveBeenCalledTimes(1);
    now += 1;
    runtime.tree();
    expect(timerCallbacks.at(-1)?.delay).toBe(PREVIEW_INSPECTOR_TREE_REFRESH_INTERVAL_MS - 1);
  });

  /** Equal animation/timer IDs must never let Inspector disposal cancel another owner's work. */
  it.each([true, false])(
    'cancels only its own highlight handle (animation frame: %s)',
    (useFrame) => {
      const frames = new Map<number, () => void>();
      const timers = new Map<number, () => void>();
      const unrelated = vi.fn();
      const cancelTimer = vi.fn((handle: number) => timers.delete(handle));
      timers.set(1, unrelated);
      let nextTimer = 2;
      const highlight = vi.fn();
      const context: Record<string, unknown> & { __runtime?: RefreshRuntimeHarness } = {
        Date,
        clearTimeout: cancelTimer,
        document: createTestDocument(),
        notifyPreviewInspectorTreeSubscribers: vi.fn(),
        performance: { now: () => 1_000 },
        previewInspectorSession: { treeListeners: new Set(), treeDirty: false },
        reconcilePreviewInspectorHiddenElements: vi.fn(),
        refreshPreviewInspectorHighlight: highlight,
        ...(useFrame
          ? {
              requestAnimationFrame: (callback: () => void) => {
                frames.set(1, callback);
                return 1;
              },
              cancelAnimationFrame: (handle: number) => frames.delete(handle),
            }
          : {}),
        setTimeout: (callback: () => void) => {
          const handle = nextTimer++;
          timers.set(handle, callback);
          return handle;
        },
      };
      vm.runInNewContext(
        `${createPreviewInspectorRefreshRuntimeSource()}
       globalThis.__runtime = {
         cancel: cancelPreviewInspectorRefreshScheduling,
         commit: schedulePreviewInspectorCommitRefresh,
         session: previewInspectorSession,
         tree: schedulePreviewInspectorTreeRefresh,
       };`,
        context,
      );
      const runtime = context.__runtime;
      if (runtime === undefined) throw new Error('Refresh runtime fixture did not initialize.');

      runtime.commit();
      expect(runtime.session.highlightFrame).toBe(useFrame ? 1 : 2);
      runtime.cancel();
      runtime.cancel();

      expect(frames.size).toBe(0);
      expect(timers.size).toBe(1);
      expect(timers.get(1)).toBe(unrelated);
      timers.get(1)?.();
      expect(unrelated).toHaveBeenCalledOnce();
      expect(highlight).not.toHaveBeenCalled();
      expect(runtime.session.highlightFrame).toBeUndefined();
      expect(runtime.session.cancelHighlightFrame).toBeUndefined();
      if (!useFrame)
        expect(cancelTimer.mock.contexts[0]).toHaveProperty('setTimeout', context.setTimeout);
    },
  );

  /** Watches only structural DOM changes and removes legacy polling, scroll, and resize work. */
  it('does not observe attribute/text churn or install recurring polling', () => {
    const source = createPreviewInspectorRefreshRuntimeSource();

    expect(source).toContain("record.type === 'childList'");
    expect(source).toContain('{ childList: true, subtree: true }');
    expect(source).toContain("document.visibilityState === 'hidden'");
    expect(source).not.toContain('attributes: true');
    expect(source).not.toContain('characterData: true');
    expect(source).not.toContain("addEventListener('scroll'");
    expect(source).not.toContain("addEventListener('resize'");
    expect(source).not.toContain('setInterval(');
  });
});

/** Creates the event subset used by the generated visibility and observer lifecycle. */
function createTestDocument(): Record<string, unknown> {
  return {
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
    visibilityState: 'visible',
  };
}

/** Creates the capture-listener subset used by picker installation. */
function createTestWindow(): Record<string, unknown> {
  return {
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
  };
}
