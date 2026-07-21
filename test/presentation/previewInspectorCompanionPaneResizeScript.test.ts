/** Verifies companion-local pane resizing without requiring a project React or browser runtime. */
import vm from 'node:vm';
import { describe, expect, it } from 'vitest';
import { createPreviewInspectorCompanionPaneResizeScript } from '../../src/presentation/webview/previewInspectorCompanionPaneResizeScript';

/** Minimal event callback accepted by the generated companion separator. */
type FakeListener = (event: Record<string, unknown>) => void;

/** DOM-like element surface needed by the isolated generated layout controller. */
interface FakeElement {
  readonly attributes: Map<string, string>;
  readonly children: FakeElement[];
  readonly classList: { contains(name: string): boolean };
  className: string;
  clientHeight: number;
  clientWidth: number;
  readonly dataset: Record<string, string>;
  readonly listeners: Map<string, FakeListener>;
  readonly style: {
    readonly values: Map<string, string>;
    setProperty(name: string, value: string): void;
  };
  addEventListener(name: string, listener: FakeListener): void;
  getBoundingClientRect(): { height: number; left: number; top: number; width: number };
  insertBefore(child: FakeElement, before: FakeElement): void;
  removeAttribute(name: string): void;
  removeEventListener(name: string, listener: FakeListener): void;
  setAttribute(name: string, value: string): void;
}

/** Generated functions exposed only to this VM behavior fixture. */
interface PaneResizeRuntime {
  readonly install: () => void;
  readonly readState: () => { readonly columnsRatio: number; readonly rowsRatio: number };
  readonly refresh: (workbench: FakeElement, handle: FakeElement) => void;
}

/** Persisted splitter payload, including the schema marker used for default migrations. */
interface PersistedPaneState {
  readonly columnsRatio: number;
  readonly rowsRatio: number;
  readonly version?: number;
}

describe('Preview Inspector companion pane resize script', () => {
  /** Resizes left/right and upper/lower layouts independently while persisting bounded ratios. */
  it('installs one accessible responsive separator and remembers both orientations', () => {
    const fixture = evaluatePaneResizeRuntime();

    fixture.runtime.install();
    const handle = fixture.workbench.children[1];
    expect(handle?.className).toBe('rpi-pane-resize-handle');
    expect(handle?.attributes.get('role')).toBe('separator');
    expect(handle?.attributes.get('aria-orientation')).toBe('vertical');
    expect(fixture.workbench.style.values.get('--rpi-pane-first-size')).toBe('52%');

    handle?.listeners.get('keydown')?.(createKeyboardEvent('ArrowRight'));
    expect(fixture.runtime.readState().columnsRatio).toBeCloseTo(0.545);
    expect(fixture.persisted.reactPreviewInspectorPaneLayout?.columnsRatio).toBeCloseTo(0.545);

    fixture.workbench.clientWidth = 620;
    fixture.workbench.clientHeight = 700;
    if (handle !== undefined) fixture.runtime.refresh(fixture.workbench, handle);
    expect(handle?.attributes.get('aria-orientation')).toBe('horizontal');
    expect(fixture.workbench.style.values.get('--rpi-pane-first-size')).toBe('46%');

    handle?.listeners.get('keydown')?.(createKeyboardEvent('ArrowDown', true));
    expect(fixture.runtime.readState().rowsRatio).toBeCloseTo(0.54);
    expect(fixture.runtime.readState().columnsRatio).toBeCloseTo(0.545);
    expect(fixture.persisted.reactPreviewInspectorPaneLayout?.version).toBe(2);
  });

  /** Moves only untouched legacy defaults so deliberate user-resized panes remain stable. */
  it('migrates legacy defaults while preserving customized ratios', () => {
    const legacyDefault = evaluatePaneResizeRuntime({
      columnsRatio: 0.38,
      rowsRatio: 0.34,
    });
    expect(legacyDefault.runtime.readState()).toEqual({
      columnsRatio: 0.52,
      rowsRatio: 0.46,
    });

    const customized = evaluatePaneResizeRuntime({
      columnsRatio: 0.44,
      rowsRatio: 0.57,
    });
    expect(customized.runtime.readState()).toEqual({
      columnsRatio: 0.44,
      rowsRatio: 0.57,
    });
  });
});

/** Evaluates the generated browser helpers against a deterministic two-pane workbench. */
function evaluatePaneResizeRuntime(initialPaneState?: PersistedPaneState): {
  readonly persisted: Record<string, PersistedPaneState | undefined>;
  readonly runtime: PaneResizeRuntime;
  readonly workbench: FakeElement;
} {
  const firstPane = createFakeElement('rpi-pane');
  const secondPane = createFakeElement('rpi-pane');
  const workbench = createFakeElement('rpi-workbench', [firstPane, secondPane]);
  workbench.clientHeight = 600;
  workbench.clientWidth = 1_000;
  const persisted: Record<string, PersistedPaneState | undefined> =
    initialPaneState === undefined ? {} : { reactPreviewInspectorPaneLayout: initialPaneState };
  const context: {
    __paneRuntime?: PaneResizeRuntime;
    document: { createElement(): FakeElement };
    globalThis: Record<string, unknown>;
    mirror: { querySelector(selector: string): FakeElement | null };
    ResizeObserver: undefined;
    vscode: { getState(): typeof persisted; setState(value: typeof persisted): void };
  } = {
    document: { createElement: () => createFakeElement('') },
    globalThis: {},
    mirror: { querySelector: (selector) => (selector === '.rpi-workbench' ? workbench : null) },
    ResizeObserver: undefined,
    vscode: {
      getState: () => persisted,
      setState: (value) => Object.assign(persisted, value),
    },
  };
  context.globalThis = context;
  vm.runInNewContext(
    createPreviewInspectorCompanionPaneResizeScript() +
      '\nglobalThis.__paneRuntime = {' +
      ' install: installPreviewInspectorCompanionPaneResize,' +
      ' readState: () => ({ ...previewInspectorCompanionPaneState }),' +
      ' refresh: refreshPreviewInspectorCompanionPaneLayout' +
      '};',
    context,
  );
  if (context.__paneRuntime === undefined) {
    throw new Error('Companion pane resize fixture did not initialize.');
  }
  return { persisted, runtime: context.__paneRuntime, workbench };
}

/** Creates the bounded element API used by the generated separator implementation. */
function createFakeElement(className: string, children: FakeElement[] = []): FakeElement {
  const attributes = new Map<string, string>();
  const dataset: Record<string, string> = {};
  const listeners = new Map<string, FakeListener>();
  const styleValues = new Map<string, string>();
  const element: FakeElement = {
    attributes,
    children,
    classList: { contains: (name) => element.className.split(/\s+/u).includes(name) },
    className,
    clientHeight: 0,
    clientWidth: 0,
    dataset,
    listeners,
    style: { setProperty: (name, value) => styleValues.set(name, value), values: styleValues },
    addEventListener: (name, listener) => listeners.set(name, listener),
    getBoundingClientRect: () => ({
      height: element.clientHeight,
      left: 0,
      top: 0,
      width: element.clientWidth,
    }),
    insertBefore: (child, before) => {
      const index = children.indexOf(before);
      children.splice(index < 0 ? children.length : index, 0, child);
    },
    removeAttribute: (name) => {
      attributes.delete(name);
      if (name === 'data-dragging') delete dataset.dragging;
    },
    removeEventListener: (name, listener) => {
      if (listeners.get(name) === listener) listeners.delete(name);
    },
    setAttribute: (name, value) => {
      attributes.set(name, value);
      if (name === 'data-rpi-pane-axis') dataset.rpiPaneAxis = value;
      if (name === 'data-dragging') dataset.dragging = value;
    },
  };
  return element;
}

/** Creates an inert keyboard event record and lets the test assert resulting state only. */
function createKeyboardEvent(key: string, shiftKey = false): Record<string, unknown> {
  return {
    key,
    preventDefault: () => undefined,
    shiftKey,
    stopPropagation: () => undefined,
  };
}
