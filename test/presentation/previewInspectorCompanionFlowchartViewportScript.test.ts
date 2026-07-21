/** Verifies the companion-only flowchart camera without project React or a browser process. */
import vm from 'node:vm';
import { describe, expect, it } from 'vitest';
import {
  createPreviewInspectorCompanionFlowchartViewportScript,
  PREVIEW_INSPECTOR_COMPANION_FLOWCHART_FIT_MIN_ZOOM,
  PREVIEW_INSPECTOR_COMPANION_FLOWCHART_MAX_ZOOM,
  PREVIEW_INSPECTOR_COMPANION_FLOWCHART_MIN_ZOOM,
} from '../../src/presentation/webview/previewInspectorCompanionFlowchartViewportScript';

/** Minimal DOM rectangle used by the generated viewport centering helpers. */
interface FakeRectangle {
  readonly height: number;
  readonly left: number;
  readonly top: number;
  readonly width: number;
}

/** DOM-like element surface used by the isolated camera behavior fixture. */
interface FakeElement {
  readonly attributes: Map<string, string>;
  clientHeight: number;
  clientWidth: number;
  getBoundingClientRect(): FakeRectangle;
  getAttribute(name: string): string | null;
  readonly listeners: Map<string, (event?: FakePointerEvent) => void>;
  querySelector(selector: string): FakeElement | null;
  readonly scrollHeight: number;
  scrollLeft: number;
  readonly scrollWidth: number;
  scrollTop: number;
  setAttribute(name: string, value: string): void;
  removeAttribute(name: string): void;
  releasePointerCapture(pointerId: number): void;
  setPointerCapture(pointerId: number): void;
  textContent: string;
  addEventListener(name: string, listener: (event?: FakePointerEvent) => void): void;
  removeEventListener(name: string, listener: (event?: FakePointerEvent) => void): void;
}

/** Minimal pointer/click event used to exercise companion-local blank-canvas panning. */
interface FakePointerEvent {
  readonly button?: number;
  readonly clientX?: number;
  readonly clientY?: number;
  defaultPrevented?: boolean;
  readonly isPrimary?: boolean;
  readonly pointerId?: number;
  propagationStopped?: boolean;
  readonly target?: { closest(selector: string): unknown };
  preventDefault?(): void;
  stopPropagation?(): void;
}

/** Camera helpers exposed from the generated script only for deterministic VM assertions. */
interface FlowchartCameraRuntime {
  readonly capture: () => FlowchartCameraState;
  readonly command: (control: FakeElement) => 'local-and-remote' | 'local-only' | undefined;
  readonly install: () => void;
  readonly readState: () => FlowchartCameraState;
  readonly restore: (snapshot?: Partial<FlowchartCameraState>) => void;
}

/** Persisted bounded camera dimensions shared across sanitized graph replacements. */
interface FlowchartCameraState {
  readonly centerX: number;
  readonly centerY: number;
  readonly graphKey?: string;
  readonly viewMode?: 'all' | 'focus' | 'main';
  readonly zoomPercent: number;
}

/** Exact toolbar controls understood by the local flowchart command allowlist. */
interface FlowchartCameraCommands {
  readonly 'center-selected': FakeElement;
  readonly fit: FakeElement;
  readonly 'locate-current': FakeElement;
  readonly 'zoom-in': FakeElement;
  readonly 'zoom-out': FakeElement;
  readonly 'zoom-reset': FakeElement;
}

/** Complete mutable graph fixture used to simulate zoom and changing snapshot dimensions. */
interface FlowchartCameraFixture {
  blockerAvailable: boolean;
  currentAvailable: boolean;
  naturalHeight: number;
  naturalWidth: number;
  readonly commands: FlowchartCameraCommands;
  readonly flushAnimationFrames: () => void;
  graphKey?: string;
  readonly label: FakeElement;
  readonly mirrorStyle: Map<string, string>;
  readonly persisted: Record<string, unknown>;
  readonly runtime: FlowchartCameraRuntime;
  setStateCalls: number;
  readonly status: FakeElement;
  readonly viewport: FakeElement;
  viewMode: 'all' | 'focus' | 'main';
}

describe('Preview Inspector companion flowchart viewport script', () => {
  /** Keeps zoom finite, preserves visual center, and merges state with unrelated companion data. */
  it('persists bounded zoom, reset, and fit commands in the visible companion only', () => {
    const fixture = evaluateFlowchartCameraRuntime({
      centerX: 0.25,
      centerY: 0.75,
      zoomPercent: 130,
    });

    fixture.runtime.install();
    fixture.runtime.restore();

    expect(fixture.mirrorStyle.get('--rpi-companion-flowchart-zoom')).toBe('1.3');
    expect(fixture.label.textContent).toBe('130%');
    expect(fixture.viewport.scrollLeft).toBeCloseTo(75);
    expect(fixture.viewport.scrollTop).toBeCloseTo(580);

    expect(fixture.runtime.command(fixture.commands['zoom-in'])).toBe('local-only');
    expect(fixture.runtime.readState()).toMatchObject({
      centerX: 0.25,
      centerY: 0.75,
      zoomPercent: 140,
    });
    for (let index = 0; index < 20; index += 1) {
      fixture.runtime.command(fixture.commands['zoom-in']);
    }
    expect(fixture.runtime.readState().zoomPercent).toBe(
      PREVIEW_INSPECTOR_COMPANION_FLOWCHART_MAX_ZOOM,
    );
    expect(fixture.commands['zoom-in'].attributes.has('disabled')).toBe(true);

    for (let index = 0; index < 30; index += 1) {
      fixture.runtime.command(fixture.commands['zoom-out']);
    }
    expect(fixture.runtime.readState().zoomPercent).toBe(
      PREVIEW_INSPECTOR_COMPANION_FLOWCHART_MIN_ZOOM,
    );
    expect(fixture.commands['zoom-out'].attributes.has('disabled')).toBe(true);

    fixture.runtime.command(fixture.commands['zoom-reset']);
    expect(fixture.runtime.readState().zoomPercent).toBe(100);
    expect(fixture.label.textContent).toBe('100%');

    fixture.runtime.command(fixture.commands.fit);
    expect(fixture.runtime.readState()).toEqual({
      centerX: 0.5,
      centerY: 0.5,
      viewMode: 'focus',
      zoomPercent: 47,
    });
    expect(fixture.label.textContent).toBe('47%');
    expect(fixture.persisted).toMatchObject({
      preservedPaneState: { columnsRatio: 0.4 },
      reactPreviewInspectorFlowchartCamera: {
        centerX: 0.5,
        centerY: 0.5,
        zoomPercent: 47,
      },
    });
  });

  /** Lets Fit all go below the manual zoom floor for the bounded 128-node/32-lane graph. */
  it('fits an oversized bounded graph while preserving ordinary zoom and 100 percent reset', () => {
    const fixture = evaluateFlowchartCameraRuntime();
    fixture.naturalWidth = 40_000;
    fixture.naturalHeight = 2_200;
    fixture.runtime.install();

    fixture.runtime.command(fixture.commands.fit);
    expect(fixture.runtime.readState().zoomPercent).toBe(
      PREVIEW_INSPECTOR_COMPANION_FLOWCHART_FIT_MIN_ZOOM,
    );
    expect(fixture.label.textContent).toBe('1%');

    fixture.runtime.command(fixture.commands['zoom-in']);
    expect(fixture.runtime.readState().zoomPercent).toBe(
      PREVIEW_INSPECTOR_COMPANION_FLOWCHART_MIN_ZOOM,
    );
    fixture.runtime.command(fixture.commands['zoom-reset']);
    expect(fixture.runtime.readState().zoomPercent).toBe(100);
    expect(fixture.label.textContent).toBe('100%');
  });

  /** Auto-fits a replacement only when Focus/Main/All scope changes. */
  it('keeps camera state within one scope and auto-fits each newly selected graph scope', () => {
    const fixture = evaluateFlowchartCameraRuntime({
      centerX: 0.25,
      centerY: 0.25,
      viewMode: 'focus',
      zoomPercent: 90,
    });
    fixture.naturalWidth = 12_000;
    fixture.naturalHeight = 2_000;
    fixture.runtime.install();
    fixture.runtime.restore();
    expect(fixture.runtime.readState().zoomPercent).toBe(90);

    const focusCamera = fixture.runtime.capture();
    fixture.viewMode = 'all';
    fixture.runtime.install();
    fixture.runtime.restore(focusCamera);

    expect(fixture.runtime.readState()).toMatchObject({
      centerX: 0.5,
      centerY: 0.5,
      viewMode: 'all',
      zoomPercent: 3,
    });
    expect(fixture.status.textContent).toBe('Fit render flow at 3%.');
  });

  /** Refits a compact scope when selection replaces its visible neighborhood inside one mode. */
  it('auto-fits changed Focus geometry so Locate current file reveals the replacement graph', () => {
    const fixture = evaluateFlowchartCameraRuntime({
      centerX: 0.25,
      centerY: 0.25,
      graphKey: 'focus:5:before',
      viewMode: 'focus',
      zoomPercent: 90,
    });
    fixture.naturalWidth = 4_000;
    fixture.naturalHeight = 1_000;
    fixture.runtime.install();
    fixture.runtime.restore();
    expect(fixture.runtime.readState().zoomPercent).toBe(90);

    const previousFocusCamera = fixture.runtime.capture();
    fixture.graphKey = 'focus:5:current';
    fixture.runtime.install();
    fixture.runtime.restore(previousFocusCamera);

    expect(fixture.runtime.readState()).toMatchObject({
      centerX: 0.5,
      centerY: 0.5,
      graphKey: 'focus:5:current',
      viewMode: 'focus',
      zoomPercent: 11,
    });
  });

  /** Keeps Main camera state for an in-graph selection and refits only a changed visible set. */
  it('preserves Main pan and zoom until its compact graph identity changes', () => {
    const fixture = evaluateFlowchartCameraRuntime({
      centerX: 0.25,
      centerY: 0.25,
      graphKey: 'main:24:same',
      viewMode: 'main',
      zoomPercent: 90,
    });
    fixture.naturalWidth = 4_000;
    fixture.naturalHeight = 1_000;
    fixture.runtime.install();
    fixture.runtime.restore();
    const previousMainCamera = fixture.runtime.capture();

    fixture.runtime.install();
    fixture.runtime.restore(previousMainCamera);
    expect(fixture.runtime.readState()).toMatchObject({
      centerX: 0.25,
      centerY: 0.25,
      graphKey: 'main:24:same',
      zoomPercent: 90,
    });

    fixture.graphKey = 'main:24:changed';
    fixture.runtime.install();
    fixture.runtime.restore(previousMainCamera);
    expect(fixture.runtime.readState()).toMatchObject({
      centerX: 0.5,
      centerY: 0.5,
      graphKey: 'main:24:changed',
      zoomPercent: 11,
    });
  });

  /** Centers selected/current nodes locally and restores their relative camera after replacement. */
  it('locates graph nodes without moving a document and restores the camera after a snapshot', () => {
    const fixture = evaluateFlowchartCameraRuntime();
    fixture.runtime.install();
    fixture.runtime.restore();

    expect(fixture.runtime.command(fixture.commands['center-selected'])).toBe('local-only');
    expect(fixture.viewport.scrollLeft).toBeCloseTo(500);
    expect(fixture.viewport.scrollTop).toBeCloseTo(400);
    expect(fixture.status.textContent).toBe('Centered selected block.');

    expect(fixture.runtime.command(fixture.commands['locate-current'])).toBe('local-and-remote');
    expect(fixture.viewport.scrollLeft).toBe(0);
    expect(fixture.viewport.scrollTop).toBe(0);
    expect(fixture.status.textContent).toContain('Located current file');

    const beforeReplacement = fixture.runtime.capture();
    fixture.naturalWidth = 1_600;
    fixture.naturalHeight = 1_200;
    fixture.runtime.install();
    fixture.runtime.restore(beforeReplacement);

    expect(fixture.viewport.scrollLeft).toBeCloseTo(150);
    expect(fixture.viewport.scrollTop).toBeCloseTo(100);
    expect(fixture.runtime.capture()).toMatchObject({
      centerX: 0.25,
      centerY: 0.25,
      zoomPercent: 100,
    });

    fixture.currentAvailable = false;
    fixture.blockerAvailable = true;
    expect(fixture.runtime.command(fixture.commands['locate-current'])).toBe('local-and-remote');
    expect(fixture.status.textContent).toContain('nearest blocker');

    fixture.blockerAvailable = false;
    expect(fixture.runtime.command(fixture.commands['locate-current'])).toBe('local-and-remote');
    expect(fixture.status.textContent).toContain('unavailable');
  });

  /** Drags graph whitespace while preserving node clicks for resolver selection. */
  it('pans freely from blank canvas without turning graph nodes into drag handles', () => {
    const fixture = evaluateFlowchartCameraRuntime();
    fixture.runtime.install();
    fixture.viewport.scrollLeft = 300;
    fixture.viewport.scrollTop = 220;
    const blankTarget = { closest: () => null };
    const down = createFakePointerEvent({
      button: 0,
      clientX: 160,
      clientY: 140,
      isPrimary: true,
      pointerId: 7,
      target: blankTarget,
    });
    fixture.viewport.listeners.get('pointerdown')?.(down);
    expect(down.defaultPrevented).toBe(true);
    expect(fixture.viewport.attributes.get('data-rpi-panning')).toBe('true');

    const move = createFakePointerEvent({
      clientX: 100,
      clientY: 90,
      pointerId: 7,
      target: blankTarget,
    });
    fixture.viewport.listeners.get('pointermove')?.(move);
    fixture.viewport.listeners.get('scroll')?.();
    fixture.viewport.listeners.get('scroll')?.();
    expect(fixture.viewport.scrollLeft).toBe(360);
    expect(fixture.viewport.scrollTop).toBe(270);
    expect(fixture.setStateCalls).toBe(0);
    fixture.viewport.listeners.get('pointerup')?.(createFakePointerEvent({ pointerId: 7 }));
    expect(fixture.viewport.attributes.has('data-rpi-panning')).toBe(false);
    expect(fixture.status.textContent).toBe('Panned render flow.');
    expect(fixture.setStateCalls).toBe(1);

    const click = createFakePointerEvent();
    fixture.viewport.listeners.get('click')?.(click);
    expect(click.defaultPrevented).toBe(true);
    expect(click.propagationStopped).toBe(true);

    const beforeNodeGesture = fixture.viewport.scrollLeft;
    const nodeTarget = { closest: () => ({ node: true }) };
    fixture.viewport.listeners.get('pointerdown')?.(
      createFakePointerEvent({
        button: 0,
        clientX: 100,
        clientY: 100,
        isPrimary: true,
        pointerId: 8,
        target: nodeTarget,
      }),
    );
    fixture.viewport.listeners.get('pointermove')?.(
      createFakePointerEvent({
        clientX: 20,
        clientY: 20,
        pointerId: 8,
        target: nodeTarget,
      }),
    );
    expect(fixture.viewport.scrollLeft).toBe(beforeNodeGesture);

    fixture.viewport.listeners.get('scroll')?.();
    fixture.viewport.listeners.get('scroll')?.();
    expect(fixture.setStateCalls).toBe(1);
    fixture.flushAnimationFrames();
    expect(fixture.setStateCalls).toBe(2);

    const installedPointerMove = fixture.viewport.listeners.get('pointermove');
    fixture.viewport.listeners.get('pointerdown')?.(
      createFakePointerEvent({
        button: 0,
        clientX: 90,
        clientY: 90,
        isPrimary: true,
        pointerId: 9,
        target: blankTarget,
      }),
    );
    fixture.viewport.listeners.get('pointermove')?.(
      createFakePointerEvent({ clientX: 30, clientY: 30, pointerId: 9, target: blankTarget }),
    );
    fixture.viewport.listeners.get('pointercancel')?.(createFakePointerEvent({ pointerId: 9 }));
    expect(fixture.setStateCalls).toBe(3);
    expect(fixture.viewport.attributes.has('data-rpi-panning')).toBe(false);

    fixture.viewport.listeners.get('scroll')?.();
    fixture.viewport.listeners.get('pointerdown')?.(
      createFakePointerEvent({
        button: 0,
        clientX: 80,
        clientY: 80,
        isPrimary: true,
        pointerId: 10,
        target: blankTarget,
      }),
    );
    fixture.runtime.install();
    expect(fixture.viewport.attributes.has('data-rpi-panning')).toBe(false);
    expect(fixture.viewport.listeners.get('pointermove')).not.toBe(installedPointerMove);
    fixture.flushAnimationFrames();
    expect(fixture.setStateCalls).toBe(3);
  });
});

/** Creates one observable pointer-like event without requiring a DOM implementation. */
function createFakePointerEvent(values: Partial<FakePointerEvent> = {}): FakePointerEvent {
  const event: FakePointerEvent = {
    ...values,
    preventDefault: () => {
      event.defaultPrevented = true;
    },
    stopPropagation: () => {
      event.propagationStopped = true;
    },
  };
  return event;
}

/** Evaluates generated companion code against a deterministic scrollable graph and toolbar. */
function evaluateFlowchartCameraRuntime(
  restoredCamera: Partial<FlowchartCameraState> = {},
): FlowchartCameraFixture {
  let zoom = 1;
  const fixture = {
    blockerAvailable: false,
    currentAvailable: true,
    naturalHeight: 800,
    naturalWidth: 1_000,
    graphKey: restoredCamera.graphKey,
    viewMode: restoredCamera.viewMode ?? 'focus',
  } as FlowchartCameraFixture;
  const viewport = createFakeElement({
    clientHeight: 400,
    clientWidth: 500,
    rectangle: () => ({ height: 400, left: 0, top: 0, width: 500 }),
    scrollHeight: () => fixture.naturalHeight * zoom,
    scrollWidth: () => fixture.naturalWidth * zoom,
  });
  const canvas = createFakeElement({
    rectangle: () => ({
      height: fixture.naturalHeight * zoom,
      left: -viewport.scrollLeft,
      top: -viewport.scrollTop,
      width: fixture.naturalWidth * zoom,
    }),
    scrollHeight: () => fixture.naturalHeight,
    scrollWidth: () => fixture.naturalWidth,
  });
  const selected = createFakeElement({
    attributes: {
      'aria-pressed': 'true',
      'data-rpi-flowchart-node': 'selected',
    },
    rectangle: () => ({
      height: 60 * zoom,
      left: 800 * zoom - viewport.scrollLeft,
      top: 600 * zoom - viewport.scrollTop,
      width: 80 * zoom,
    }),
  });
  const current = createFakeElement({
    attributes: {
      'data-rpi-current-file': 'true',
      'data-rpi-flowchart-node': 'current',
    },
    rectangle: () => ({
      height: 60 * zoom,
      left: 80 * zoom - viewport.scrollLeft,
      top: 70 * zoom - viewport.scrollTop,
      width: 80 * zoom,
    }),
  });
  const blocker = createFakeElement({
    attributes: {
      'data-rpi-current-file-path-blocker': 'true',
      'data-rpi-flowchart-node': 'blocker',
    },
    rectangle: () => ({
      height: 60 * zoom,
      left: 300 * zoom - viewport.scrollLeft,
      top: 250 * zoom - viewport.scrollTop,
      width: 80 * zoom,
    }),
  });
  const label = createFakeElement({ attributes: { 'data-rpi-flowchart-zoom-label': '' } });
  const status = createFakeElement({ attributes: { 'data-rpi-flowchart-camera-status': '' } });
  const flowchart = createFakeElement({
    attributes: { 'data-rpi-flowchart-view': fixture.viewMode },
  });
  flowchart.getAttribute = (name) => {
    if (name === 'data-rpi-flowchart-view') return fixture.viewMode;
    if (name === 'data-rpi-flowchart-camera-key') return fixture.graphKey ?? null;
    return flowchart.attributes.get(name) ?? null;
  };
  const command = (name: string): FakeElement =>
    createFakeElement({ attributes: { 'data-rpi-flowchart-command': name } });
  const commands: FlowchartCameraCommands = {
    'center-selected': command('center-selected'),
    fit: command('fit'),
    'locate-current': command('locate-current'),
    'zoom-in': command('zoom-in'),
    'zoom-out': command('zoom-out'),
    'zoom-reset': command('zoom-reset'),
  };
  const commandList: FakeElement[] = [
    commands['zoom-out'],
    commands['zoom-reset'],
    commands['zoom-in'],
    commands['center-selected'],
    commands.fit,
    commands['locate-current'],
  ];
  const mirrorStyle = new Map<string, string>();
  const mirror = {
    querySelector: (selector: string): FakeElement | null => {
      if (selector === '.rpi-flowchart-viewport') return viewport;
      if (selector === '.rpi-flowchart-canvas') return canvas;
      if (selector === '.rpi-flowchart') return flowchart;
      if (selector.includes('[aria-pressed="true"]')) return selected;
      if (selector.includes('[data-rpi-current-file="true"]')) {
        return fixture.currentAvailable ? current : null;
      }
      if (selector.includes('[data-rpi-current-file-path-blocker="true"]')) {
        return fixture.blockerAvailable ? blocker : null;
      }
      return null;
    },
    querySelectorAll: (selector: string): FakeElement[] => {
      if (selector === '[data-rpi-flowchart-zoom-label]') return [label];
      if (selector === '[data-rpi-flowchart-camera-status]') return [status];
      if (selector === '[data-rpi-flowchart-command]') return commandList;
      return [];
    },
    style: {
      setProperty: (name: string, value: string) => {
        mirrorStyle.set(name, value);
        if (name === '--rpi-companion-flowchart-zoom') zoom = Number(value);
      },
    },
  };
  viewport.querySelector = (selector) => (selector === '.rpi-flowchart-canvas' ? canvas : null);
  const persisted: Record<string, unknown> = {
    preservedPaneState: { columnsRatio: 0.4 },
    reactPreviewInspectorFlowchartCamera: { viewMode: 'focus', ...restoredCamera },
  };
  let nextAnimationFrameId = 1;
  const animationFrames = new Map<number, () => void>();
  fixture.setStateCalls = 0;
  const context: {
    __camera?: FlowchartCameraRuntime;
    cancelAnimationFrame(handle: number): void;
    globalThis: Record<string, unknown>;
    mirror: typeof mirror;
    requestAnimationFrame(callback: () => void): number;
    ResizeObserver: undefined;
    vscode: {
      getState(): Record<string, unknown>;
      setState(value: Record<string, unknown>): void;
    };
  } = {
    cancelAnimationFrame: (handle) => {
      animationFrames.delete(handle);
    },
    globalThis: {},
    mirror,
    requestAnimationFrame: (callback) => {
      const handle = nextAnimationFrameId;
      nextAnimationFrameId += 1;
      animationFrames.set(handle, callback);
      return handle;
    },
    ResizeObserver: undefined,
    vscode: {
      getState: () => persisted,
      setState: (value) => {
        fixture.setStateCalls += 1;
        Object.assign(persisted, value);
      },
    },
  };
  context.globalThis = context;
  vm.runInNewContext(
    createPreviewInspectorCompanionFlowchartViewportScript() +
      '\nglobalThis.__camera = {' +
      ' capture: capturePreviewInspectorCompanionFlowchartCamera,' +
      ' command: handlePreviewInspectorCompanionFlowchartCommand,' +
      ' install: installPreviewInspectorCompanionFlowchartViewport,' +
      ' readState: () => ({ ...previewInspectorCompanionFlowchartState }),' +
      ' restore: restorePreviewInspectorCompanionFlowchartCamera' +
      '};',
    context,
  );
  if (context.__camera === undefined) {
    throw new Error('Companion flowchart camera runtime did not initialize.');
  }
  Object.assign(fixture, {
    commands,
    flushAnimationFrames: () => {
      const pending = [...animationFrames.values()];
      animationFrames.clear();
      for (const callback of pending) callback();
    },
    label,
    mirrorStyle,
    persisted,
    runtime: context.__camera,
    status,
    viewport,
  });
  return fixture;
}

/** Creates one DOM-like element whose dimensions may follow the current simulated zoom. */
function createFakeElement(
  options: {
    readonly attributes?: Readonly<Record<string, string>>;
    readonly clientHeight?: number;
    readonly clientWidth?: number;
    readonly rectangle?: () => FakeRectangle;
    readonly scrollHeight?: () => number;
    readonly scrollWidth?: () => number;
  } = {},
): FakeElement {
  const attributes = new Map(Object.entries(options.attributes ?? {}));
  const listeners = new Map<string, (event?: FakePointerEvent) => void>();
  const element: FakeElement = {
    attributes,
    addEventListener: (name, listener) => listeners.set(name, listener),
    clientHeight: options.clientHeight ?? 0,
    clientWidth: options.clientWidth ?? 0,
    getAttribute: (name) => attributes.get(name) ?? null,
    getBoundingClientRect: () => options.rectangle?.() ?? { height: 0, left: 0, top: 0, width: 0 },
    listeners,
    querySelector: () => null,
    removeAttribute: (name) => attributes.delete(name),
    releasePointerCapture: () => undefined,
    removeEventListener: (name, listener) => {
      if (listeners.get(name) === listener) listeners.delete(name);
    },
    get scrollHeight() {
      return options.scrollHeight?.() ?? element.clientHeight;
    },
    scrollLeft: 0,
    get scrollWidth() {
      return options.scrollWidth?.() ?? element.clientWidth;
    },
    scrollTop: 0,
    setAttribute: (name, value) => attributes.set(name, value),
    setPointerCapture: () => undefined,
    textContent: '',
  };
  return element;
}
