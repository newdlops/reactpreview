/** Verifies tree-scroll preservation independently from React and the project component graph. */
import vm from 'node:vm';
import { describe, expect, it } from 'vitest';
import { createPreviewInspectorTreeScrollRuntimeSource } from '../../../../src/adapters/esbuild/pageInspector/previewInspectorTreeScrollRuntimeSource';

/** Mutable scroll surface sufficient for both tree and document-coordinate assertions. */
interface ScrollSurface {
  scrollLeft: number;
  scrollTop: number;
}

/** Generated helper contract exposed only inside the isolated test realm. */
interface TreeScrollRuntime {
  readonly capture: (viewport: ScrollSurface) => unknown;
  readonly readSession: () => Record<string, unknown>;
  readonly remember: (viewport: ScrollSurface) => void;
  readonly runFrame: () => void;
  readonly scheduleRestore: (viewport: ScrollSurface) => number;
}

describe('Preview Inspector tree scroll runtime source', () => {
  /** Keeps generated browser source syntactically valid as the lifecycle policy evolves. */
  it('emits valid standalone runtime source', () => {
    expect(
      () =>
        new vm.Script(`
          const previewInspectorDevtoolsSessionState = {};
          ${createPreviewInspectorTreeScrollRuntimeSource()}
        `),
    ).not.toThrow();
  });

  /** Restores a deep row and the preview canvas after focus and export remount reset both to zero. */
  it('restores captured tree and document coordinates through the next animation frame', () => {
    const documentScroll: ScrollSurface = { scrollLeft: 12, scrollTop: 420 };
    const viewport: ScrollSurface = { scrollLeft: 70, scrollTop: 180 };
    const runtime = evaluateTreeScrollRuntime(documentScroll);

    runtime.capture(viewport);
    viewport.scrollLeft = 0;
    viewport.scrollTop = 0;
    documentScroll.scrollLeft = 0;
    documentScroll.scrollTop = 0;
    runtime.scheduleRestore(viewport);

    expect(viewport).toEqual({ scrollLeft: 70, scrollTop: 180 });
    expect(documentScroll).toEqual({ scrollLeft: 12, scrollTop: 420 });

    viewport.scrollTop = 0;
    documentScroll.scrollTop = 0;
    runtime.runFrame();

    expect(viewport.scrollTop).toBe(180);
    expect(documentScroll.scrollTop).toBe(420);
    expect(runtime.readSession()).toMatchObject({
      pendingTreeScrollSnapshot: undefined,
      treeScrollLeft: 70,
      treeScrollTop: 180,
    });
  });

  /** Retains ordinary user scrolling as the baseline for a later shell-only remount. */
  it('remembers the latest settled tree viewport without a click snapshot', () => {
    const viewport: ScrollSurface = { scrollLeft: 95, scrollTop: 275 };
    const runtime = evaluateTreeScrollRuntime({ scrollLeft: 0, scrollTop: 0 });

    runtime.remember(viewport);
    viewport.scrollLeft = 0;
    viewport.scrollTop = 0;
    runtime.scheduleRestore(viewport);

    expect(viewport).toEqual({ scrollLeft: 95, scrollTop: 275 });
  });
});

/** Evaluates the generated functions with a deterministic animation-frame queue. */
function evaluateTreeScrollRuntime(documentScroll: ScrollSurface): TreeScrollRuntime {
  const context: {
    __runtime?: TreeScrollRuntime;
    document: { scrollingElement: ScrollSurface };
  } = { document: { scrollingElement: documentScroll } };
  vm.runInNewContext(
    `
      const previewInspectorDevtoolsSessionState = {};
      let pendingFrame;
      const requestAnimationFrame = (callback) => { pendingFrame = callback; return 1; };
      ${createPreviewInspectorTreeScrollRuntimeSource()}
      globalThis.__runtime = {
        capture: capturePreviewInspectorTreeSelectionScroll,
        readSession: () => ({ ...previewInspectorDevtoolsSessionState }),
        remember: rememberPreviewInspectorTreeScrollPosition,
        runFrame: () => { const callback = pendingFrame; pendingFrame = undefined; callback?.(); },
        scheduleRestore: schedulePreviewInspectorTreeScrollRestoration,
      };
    `,
    context,
  );
  if (context.__runtime === undefined) throw new Error('Tree scroll runtime did not initialize.');
  return context.__runtime;
}
