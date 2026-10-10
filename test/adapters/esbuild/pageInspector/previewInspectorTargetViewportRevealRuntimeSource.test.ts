/** Verifies the one-time scroll to a reached target that application chrome left off screen. */
import vm from 'node:vm';
import { describe, expect, it } from 'vitest';
import { createPreviewInspectorTargetViewportRevealRuntimeSource } from '../../../../src/adapters/esbuild/pageInspector/previewInspectorTargetViewportRevealRuntimeSource';

/** Rectangle of one fixture element in window coordinates. */
interface FixtureRectangle {
  readonly bottom: number;
  readonly left: number;
  readonly right: number;
  readonly top: number;
}

/** Scroll calls observed for one fixture run. */
interface RevealResult {
  readonly first: boolean;
  readonly options: readonly unknown[];
  readonly second: boolean;
}

describe('revealPreviewInspectorReachedTargetViewport', () => {
  /** A login page mounted after a full-height authenticated shell starts below the window. */
  it('scrolls a target below a full-height shell into view once', () => {
    expect(runReveal([{ bottom: 1300, left: 0, right: 800, top: 600 }])).toEqual({
      first: true,
      options: [{ behavior: 'auto', block: 'start', inline: 'nearest' }],
      second: false,
    });
    expect(runReveal([{ bottom: 760, left: 0, right: 200, top: 700 }]).options).toEqual([
      { behavior: 'auto', block: 'center', inline: 'nearest' },
    ]);
  });

  /** Leaves the page alone when any target element is visible, scrolled, or diagnostic-only. */
  it('does not scroll visible, user-scrolled, or direct targets', () => {
    const below = { bottom: 1002, left: 0, right: 800, top: 600 };

    expect(runReveal([below, { bottom: 620, left: 0, right: 800, top: 580 }])).toEqual({
      first: false,
      options: [],
      second: false,
    });
    expect(runReveal([below], { scrollY: 40 }).options).toEqual([]);
    expect(runReveal([below], { directTarget: true }).options).toEqual([]);
    expect(runReveal([{ bottom: 300, left: 900, right: 1200, top: 100 }]).options).toEqual([]);
  });

  /** A fixed modal's content is not "outside" the overflow-clip page section it is nested in. */
  it('ignores clipping ancestors that do not contain a fixed overlay', () => {
    const find = (sectionTransform: string): boolean => {
      const context: { __found?: boolean } = {};
      vm.runInNewContext(
        `
          const section = {
            getBoundingClientRect: () => ({ bottom: 1340, left: 30, right: 721, top: 614 }),
            parentElement: null,
            style: { overflowX: 'clip', overflowY: 'clip', position: 'static', transform: ${JSON.stringify(sectionTransform)} },
          };
          const overlay = {
            getBoundingClientRect: () => ({ bottom: 469, left: 0, right: 756, top: 0 }),
            parentElement: section,
            style: { position: 'fixed' },
          };
          const element = {
            getBoundingClientRect: () => ({ bottom: 441, left: 127, right: 620, top: 127 }),
            isConnected: true,
            nodeType: 1,
            parentElement: overlay,
            scrollIntoView: () => undefined,
            style: {},
          };
          const mountNode = null;
          globalThis.getComputedStyle = (node) => node.style;
          const readPreviewInspectorTargetBoundaries = () => new Set([{ id: 'target' }]);
          const collectPreviewInspectorFiberElements = () => [element];
          const isPreviewInspectorUiElement = () => false;
          globalThis.innerHeight = 469;
          globalThis.innerWidth = 756;
          ${createPreviewInspectorTargetViewportRevealRuntimeSource()}
          globalThis.__found = readPreviewInspectorTargetViewportRevealElement({}) === element;
        `,
        context,
      );
      return context.__found === true;
    };

    expect(find('none')).toBe(false);
    // A transformed section contains the overlay, so the modal content is outside its clip.
    expect(find('translateZ(0px)')).toBe(true);
  });

  /** Keeps checking a visible target so a shell that grows after loading is still handled. */
  it('scrolls on a later commit once the target leaves the window', () => {
    const context: { __result?: readonly unknown[] } = {};
    vm.runInNewContext(
      `
        const scrolls = [];
        let rectangle = { bottom: 400, left: 0, right: 800, top: 100 };
        const element = {
          getBoundingClientRect: () => rectangle,
          isConnected: true,
          nodeType: 1,
          scrollIntoView: (value) => { scrolls.push(value); },
        };
        const readPreviewInspectorTargetBoundaries = () => new Set([{ id: 'target' }]);
        const collectPreviewInspectorFiberElements = () => [element];
        const isPreviewInspectorUiElement = () => false;
        globalThis.innerHeight = 600;
        globalThis.innerWidth = 800;
        ${createPreviewInspectorTargetViewportRevealRuntimeSource()}
        const state = { directTarget: false };
        const results = [revealPreviewInspectorReachedTargetViewport(state)];
        rectangle = { bottom: 1000, left: 0, right: 800, top: 700 };
        results.push(revealPreviewInspectorReachedTargetViewport(state));
        results.push(revealPreviewInspectorReachedTargetViewport(state));
        globalThis.__result = [...results, scrolls.length];
      `,
      context,
    );

    expect(context.__result).toEqual([false, true, false, 1]);
  });
});

/** Evaluates the generated runtime against fixture target elements in a 800×600 window. */
function runReveal(
  rectangles: readonly FixtureRectangle[],
  options: { readonly directTarget?: boolean; readonly scrollY?: number } = {},
): RevealResult {
  const context: { __result?: RevealResult } = {};
  vm.runInNewContext(
    `
      const scrolls = [];
      const elements = ${JSON.stringify(rectangles)}.map((rectangle) => ({
        getBoundingClientRect: () => rectangle,
        isConnected: true,
        nodeType: 1,
        scrollIntoView: (value) => { scrolls.push(value); },
      }));
      const readPreviewInspectorTargetBoundaries = () => new Set([{ id: 'target' }]);
      const collectPreviewInspectorFiberElements = () => elements;
      const isPreviewInspectorUiElement = () => false;
      globalThis.innerHeight = 600;
      globalThis.innerWidth = 800;
      globalThis.scrollX = 0;
      globalThis.scrollY = ${String(options.scrollY ?? 0)};
      ${createPreviewInspectorTargetViewportRevealRuntimeSource()}
      const state = { directTarget: ${String(options.directTarget === true)} };
      const first = revealPreviewInspectorReachedTargetViewport(state);
      const second = revealPreviewInspectorReachedTargetViewport(state);
      globalThis.__result = { first, options: scrolls, second };
    `,
    context,
  );
  if (context.__result === undefined) throw new Error('The reveal fixture did not run.');
  return context.__result;
}
