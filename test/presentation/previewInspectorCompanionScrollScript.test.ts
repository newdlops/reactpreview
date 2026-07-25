/** Verifies companion scroll ownership without requiring project React or a browser process. */
import vm from 'node:vm';
import { describe, expect, it } from 'vitest';
import { createPreviewInspectorCompanionScrollScript } from '../../src/presentation/webview/previewInspectorCompanionScrollScript';

/** Minimal independently scrollable element accepted by the generated companion helper. */
interface ScrollRegion {
  readonly attributes: Map<string, string>;
  readonly selectors: readonly string[];
  scrollLeft: number;
  scrollTop: number;
  getAttribute(name: string): string | null;
  setAttribute(name: string, value: string): void;
}

/** Test-only API exposed from the generated companion script. */
interface CompanionScrollRuntime {
  capture(): { readonly regions: readonly { key: string; left: number; top: number }[] };
  readState(): { readonly holding: boolean; readonly interactionKey?: string };
  rememberInteraction(control?: ScrollRegion): void;
  runFrames(): void;
  runTimers(): void;
  schedule(snapshot: unknown): void;
}

describe('Preview Inspector companion scroll script', () => {
  /** Keeps shell, scenarios, tree, detail, console, and JSON through replacement snapshots. */
  it('retains named regions until consecutive replacement snapshots settle', () => {
    const shell = createScrollRegion(['.rpi-shell'], 0, 110);
    const scenarios = createScrollRegion(['.rpi-scenario-scroll'], 75, 330);
    const tree = createScrollRegion(['.rpi-tree-scroll'], 30, 420);
    const details = createScrollRegion(['.rpi-detail-scroll'], 0, 260);
    const consoleList = createScrollRegion(['.rpi-console-list'], 5, 180);
    const jsonEditor = createScrollRegion(['textarea.rpi-json'], 12, 90);
    const fixture = evaluateCompanionScrollRuntime([
      shell,
      scenarios,
      tree,
      details,
      consoleList,
      jsonEditor,
    ]);

    fixture.runtime.rememberInteraction();
    expect(readRegion(fixture.runtime.capture(), 'inspector-shell')?.top).toBe(110);
    expect(readRegion(fixture.runtime.capture(), 'jsx-scenarios')).toMatchObject({
      left: 75,
      top: 330,
    });
    expect(readRegion(fixture.runtime.capture(), 'components-tree')).toEqual({
      key: 'components-tree',
      left: 30,
      top: 420,
    });
    expect(readRegion(fixture.runtime.capture(), 'component-details')?.top).toBe(260);
    expect(readRegion(fixture.runtime.capture(), 'component-console')?.top).toBe(180);
    expect(readRegion(fixture.runtime.capture(), 'component-json-editor')?.top).toBe(90);

    const shortTree = createScrollRegion(['.rpi-tree-scroll'], 0, 0);
    const shortDetails = createScrollRegion(['.rpi-detail-scroll'], 0, 0);
    fixture.setRegions([shortTree, shortDetails]);
    const retained = fixture.runtime.capture();
    fixture.runtime.schedule(retained);

    expect(shortTree.scrollTop).toBe(420);
    expect(shortDetails.scrollTop).toBe(260);
    shortTree.scrollTop = 0;
    shortDetails.scrollTop = 0;
    fixture.runtime.runFrames();
    expect(shortTree.scrollTop).toBe(420);
    expect(shortDetails.scrollTop).toBe(260);

    const finalScenarios = createScrollRegion(['.rpi-scenario-scroll'], 0, 0);
    const finalTree = createScrollRegion(['.rpi-tree-scroll'], 0, 0);
    const finalDetails = createScrollRegion(['.rpi-detail-scroll'], 0, 0);
    fixture.setRegions([finalScenarios, finalTree, finalDetails]);
    fixture.runtime.schedule(fixture.runtime.capture());
    fixture.runtime.runFrames();
    fixture.runtime.runTimers();

    expect(finalScenarios.scrollLeft).toBe(75);
    expect(finalScenarios.scrollTop).toBe(330);
    expect(finalTree.scrollTop).toBe(420);
    expect(finalDetails.scrollTop).toBe(260);
    expect(fixture.runtime.readState().holding).toBe(false);
  });

  /** Uses deterministic suffixes when one visible detail contains multiple independently scrolled JSON blocks. */
  it('names repeated nested JSON regions without key collisions', () => {
    const first = createScrollRegion(['pre.rpi-json'], 1, 20);
    const second = createScrollRegion(['pre.rpi-json'], 2, 40);
    const fixture = evaluateCompanionScrollRuntime([first, second]);

    fixture.runtime.rememberInteraction();
    const snapshot = fixture.runtime.capture();

    expect(readRegion(snapshot, 'component-json-view-1')?.top).toBe(20);
    expect(readRegion(snapshot, 'component-json-view-2')?.top).toBe(40);
  });

  /**
   * Keeps the route browser and its page-context parent at their exact coordinates while a selected
   * branch compiles through any number of intermediate snapshots.
   */
  it('holds named route scroll regions until the selected route transaction completes', () => {
    const pageContext = createScrollRegion(['.rpi-page-context'], 4, 310);
    const routeBrowser = createScrollRegion(['.rpi-route-browser'], 65, 520);
    const routeControl = createScrollRegion(['[data-rpi-scroll-transaction]'], 0, 0);
    routeControl.setAttribute('data-rpi-scroll-transaction', 'route-selection:reports');
    routeControl.setAttribute('data-rpi-scroll-transaction-state', 'available');
    const fixture = evaluateCompanionScrollRuntime([pageContext, routeBrowser, routeControl]);

    fixture.runtime.rememberInteraction(routeControl);
    expect(fixture.runtime.readState()).toMatchObject({
      holding: true,
      interactionKey: 'route-selection:reports',
    });
    expect(readRegion(fixture.runtime.capture(), 'page-context')?.top).toBe(310);
    expect(readRegion(fixture.runtime.capture(), 'route-browser')).toMatchObject({
      left: 65,
      top: 520,
    });

    const pendingContext = createScrollRegion(['.rpi-page-context'], 0, 0);
    const pendingBrowser = createScrollRegion(['.rpi-route-browser'], 0, 0);
    const pendingControl = createScrollRegion(['[data-rpi-scroll-transaction]'], 0, 0);
    pendingControl.setAttribute('data-rpi-scroll-transaction', 'route-selection:reports');
    pendingControl.setAttribute('data-rpi-scroll-transaction-state', 'pending');
    fixture.setRegions([pendingContext, pendingBrowser, pendingControl]);
    fixture.runtime.schedule(fixture.runtime.capture());
    fixture.runtime.runFrames();
    fixture.runtime.runTimers();

    expect(pendingContext.scrollTop).toBe(310);
    expect(pendingBrowser).toMatchObject({ scrollLeft: 65, scrollTop: 520 });
    expect(fixture.runtime.readState().holding).toBe(true);

    const finalContext = createScrollRegion(['.rpi-page-context'], 0, 0);
    const finalBrowser = createScrollRegion(['.rpi-route-browser'], 0, 0);
    const finalControl = createScrollRegion(['[data-rpi-scroll-transaction]'], 0, 0);
    finalControl.setAttribute('data-rpi-scroll-transaction', 'route-selection:reports');
    finalControl.setAttribute('data-rpi-scroll-transaction-state', 'complete');
    fixture.setRegions([finalContext, finalBrowser, finalControl]);
    fixture.runtime.schedule(fixture.runtime.capture());
    fixture.runtime.runFrames();
    fixture.runtime.runTimers();

    expect(finalContext.scrollTop).toBe(310);
    expect(finalBrowser).toMatchObject({ scrollLeft: 65, scrollTop: 520 });
    expect(fixture.runtime.readState()).toMatchObject({
      holding: false,
      interactionKey: undefined,
    });
  });
});

/** Finds one serializable named region without depending on cross-realm object prototypes. */
function readRegion(
  snapshot: { readonly regions: readonly { key: string; left: number; top: number }[] },
  key: string,
): { key: string; left: number; top: number } | undefined {
  return snapshot.regions.find((region) => region.key === key);
}

/** Creates one selector-aware fake scroll viewport with ordinary DOM attribute methods. */
function createScrollRegion(
  selectors: readonly string[],
  scrollLeft: number,
  scrollTop: number,
): ScrollRegion {
  const attributes = new Map<string, string>();
  return {
    attributes,
    selectors,
    scrollLeft,
    scrollTop,
    getAttribute(name): string | null {
      return attributes.get(name) ?? null;
    },
    setAttribute(name, value): void {
      attributes.set(name, value);
    },
  };
}

/** Evaluates the generated source with deterministic animation-frame and settle-timer queues. */
function evaluateCompanionScrollRuntime(initialRegions: ScrollRegion[]): {
  readonly runtime: CompanionScrollRuntime;
  readonly setRegions: (regions: ScrollRegion[]) => void;
} {
  let regions = initialRegions;
  let nextHandle = 1;
  const frames = new Map<number, () => void>();
  const timers = new Map<number, () => void>();
  const mirror = {
    querySelectorAll(selector: string): ScrollRegion[] {
      if (selector === '[data-rpi-scroll-key]') {
        return regions.filter((region) => region.getAttribute('data-rpi-scroll-key') !== null);
      }
      if (selector === '[data-rpi-scroll-transaction]') {
        return regions.filter(
          (region) => region.getAttribute('data-rpi-scroll-transaction') !== null,
        );
      }
      return regions.filter((region) => region.selectors.includes(selector));
    },
  };
  const sandbox: {
    __runtime?: CompanionScrollRuntime;
    document: { scrollingElement: { scrollLeft: number; scrollTop: number } };
    mirror: typeof mirror;
    requestAnimationFrame: (callback: () => void) => number;
    cancelAnimationFrame: (handle: number) => void;
    setTimeout: (callback: () => void) => number;
    clearTimeout: (handle: number) => void;
    frames: Map<number, () => void>;
    timers: Map<number, () => void>;
  } = {
    cancelAnimationFrame: (handle) => frames.delete(handle),
    clearTimeout: (handle) => timers.delete(handle),
    document: { scrollingElement: { scrollLeft: 0, scrollTop: 70 } },
    frames,
    mirror,
    requestAnimationFrame: (callback) => {
      const handle = nextHandle++;
      frames.set(handle, callback);
      return handle;
    },
    setTimeout: (callback) => {
      const handle = nextHandle++;
      timers.set(handle, callback);
      return handle;
    },
    timers,
  };
  vm.runInNewContext(
    `
      ${createPreviewInspectorCompanionScrollScript()}
      globalThis.__runtime = {
        capture: captureCompanionScrollSnapshot,
        readState: () => ({
          holding: previewInspectorCompanionScrollState.holding,
          interactionKey: previewInspectorCompanionScrollState.interactionKey,
        }),
        rememberInteraction: rememberCompanionScrollBeforeInteraction,
        runFrames: () => {
          while (frames.size > 0) {
            const callbacks = [...frames.values()];
            frames.clear();
            callbacks.forEach((callback) => callback());
          }
        },
        runTimers: () => {
          const callbacks = [...timers.values()];
          timers.clear();
          callbacks.forEach((callback) => callback());
        },
        schedule: (snapshot) => scheduleCompanionScrollRestoration(snapshot),
      };
    `,
    sandbox,
  );
  if (sandbox.__runtime === undefined)
    throw new Error('Companion scroll runtime did not initialize.');
  return {
    runtime: sandbox.__runtime,
    setRegions: (nextRegions) => {
      regions = nextRegions;
    },
  };
}
