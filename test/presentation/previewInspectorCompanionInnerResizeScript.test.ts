/**
 * Verifies local card and tree/detail resizing in the inert Inspector companion document.
 */
import vm from 'node:vm';
import { describe, expect, it } from 'vitest';
import { createPreviewInspectorCompanionInnerResizeScript } from '../../src/presentation/webview/previewInspectorCompanionInnerResizeScript';

/** Generated pure helpers exposed only to this VM fixture. */
interface InnerResizeRuntime {
  readonly applyCard: (
    card: FakeResizableElement,
    resizeId: string,
    value: unknown,
  ) => number | undefined;
  readonly applySection: (
    container: FakeResizableElement,
    handle: FakeResizableElement,
    resizeId: string,
    value: unknown,
  ) => number;
  readonly normalizeCard: (value: unknown, maximum?: number) => number | undefined;
  readonly normalizeRatio: (value: unknown) => number;
  readonly readState: () => {
    readonly cardHeights: Record<string, number>;
    readonly collapsedSections: Record<string, boolean>;
    readonly sectionRatios: Record<string, number>;
    readonly shellRegionHeights: Record<string, number>;
  };
}

/** Minimal DOM surface used by the generated layout-only helpers. */
interface FakeResizableElement {
  readonly attributes: Map<string, string>;
  clientHeight: number;
  readonly style: {
    height: string;
    readonly values: Map<string, string>;
    removeProperty(name: string): void;
    setProperty(name: string, value: string): void;
  };
  closest(): { readonly clientHeight: number } | null;
  setAttribute(name: string, value: string): void;
}

describe('Preview Inspector companion inner resize script', () => {
  /** Ensures the nonce-embedded source remains valid standalone JavaScript. */
  it('emits syntactically valid companion browser source', () => {
    expect(() => new vm.Script(createPreviewInspectorCompanionInnerResizeScript())).not.toThrow();
  });

  /** Restores only finite bounded values and applies them to inert mirrored elements. */
  it('normalizes, applies, and retains card and section dimensions', () => {
    const { runtime } = evaluateInnerResizeRuntime({
      cardHeights: { invalid: 'large', source: 220 },
      collapsedSections: { context: true, invalid: 'yes' },
      sectionRatios: { invalid: 'half', tree: 0.72 },
      shellRegionHeights: { context: 340, invalid: 'tall' },
    });
    const card = createFakeResizableElement(300, 520);
    const section = createFakeResizableElement(500, 0);
    const handle = createFakeResizableElement(0, 0);

    expect(runtime.normalizeCard(10)).toBe(56);
    expect(runtime.normalizeCard(900, 300)).toBe(300);
    expect(runtime.normalizeRatio(-1)).toBe(0.15);
    expect(runtime.normalizeRatio(2)).toBe(0.85);
    expect(runtime.readState().cardHeights).toMatchObject({ source: 220 });
    expect(runtime.readState().cardHeights).not.toHaveProperty('invalid');
    expect(runtime.readState().collapsedSections).toMatchObject({ context: true });
    expect(runtime.readState().collapsedSections).not.toHaveProperty('invalid');
    expect(runtime.readState().sectionRatios).toMatchObject({ tree: 0.72 });
    expect(runtime.readState().shellRegionHeights).toMatchObject({ context: 340 });
    expect(runtime.readState().shellRegionHeights).not.toHaveProperty('invalid');
    expect(runtime.applyCard(card, 'source', 260)).toBe(260);
    expect(card.style.values.get('height')).toBe('260px');
    expect(card.attributes.get('data-rpi-resized')).toBe('true');
    expect(runtime.applySection(section, handle, 'tree', 0.6)).toBe(0.6);
    expect(section.style.values.get('--rpi-primary-section-height')).toBe('278px');
    expect(handle.attributes.get('aria-valuenow')).toBe('60');
  });

  /** Keeps all interaction local rather than forwarding pointer movement to project React. */
  it('installs snapshot-local drag, keyboard, reset, resize observer, and persistence behavior', () => {
    const source = createPreviewInspectorCompanionInnerResizeScript();

    expect(source).toContain("mirror.querySelectorAll('.rpi-card-height-handle')");
    expect(source).toContain("mirror.querySelectorAll('.rpi-section-height-handle')");
    expect(source).toContain("mirror.querySelectorAll('.rpi-shell-section-height-handle')");
    expect(source).toContain('function installPreviewInspectorCompanionShellRegionHandle');
    expect(source).toContain('function installPreviewInspectorCompanionAccordionToggle');
    expect(source).toContain('applyPreviewInspectorCompanionSectionCollapsed');
    expect(source).toContain('applyPreviewInspectorCompanionShellRegionCollapsed');
    expect(source).toContain('PREVIEW_INSPECTOR_COMPANION_INNER_BOUNDARY_SIZE = 37');
    expect(source).toContain("'[data-rpi-accordion-toggle=\"' + resizeId + '\"]'");
    expect(source).not.toContain('const otherHeight = Number');
    expect(source).toContain("variable: '--rpi-toolbar-section-height'");
    expect(source).toContain("variable: '--rpi-context-section-height'");
    expect(source).toContain("handle.addEventListener('pointerdown', pointerDown)");
    expect(source).toContain("handle.addEventListener('keydown', keyDown)");
    expect(source).toContain("handle.addEventListener('dblclick', reset)");
    expect(source).toContain('new ResizeObserver(refresh)');
    expect(source).toContain('vscode.setState?.({');
    expect(source).toContain('event.stopPropagation()');
    expect(source).toContain('event.stopImmediatePropagation?.()');
    expect(source).not.toContain('vscode.postMessage');
  });
});

/** Evaluates generated helpers against deterministic persisted webview state. */
function evaluateInnerResizeRuntime(initialState: {
  readonly cardHeights?: Readonly<Record<string, unknown>>;
  readonly collapsedSections?: Readonly<Record<string, unknown>>;
  readonly sectionRatios?: Readonly<Record<string, unknown>>;
  readonly shellRegionHeights?: Readonly<Record<string, unknown>>;
}): { readonly runtime: InnerResizeRuntime } {
  const persisted = { reactPreviewInspectorInnerLayout: initialState };
  const context: {
    __innerRuntime?: InnerResizeRuntime;
    globalThis: Record<string, unknown>;
    mirror: {
      readonly clientHeight: number;
      querySelectorAll(): readonly FakeResizableElement[];
    };
    ResizeObserver: undefined;
    vscode: {
      getState(): typeof persisted;
      setState(value: typeof persisted): void;
    };
  } = {
    globalThis: {},
    mirror: { clientHeight: 800, querySelectorAll: () => [] },
    ResizeObserver: undefined,
    vscode: {
      getState: () => persisted,
      setState: (value) => Object.assign(persisted, value),
    },
  };
  context.globalThis = context;
  vm.runInNewContext(
    createPreviewInspectorCompanionInnerResizeScript() +
      '\nglobalThis.__innerRuntime = {' +
      ' applyCard: applyPreviewInspectorCompanionCardHeight,' +
      ' applySection: applyPreviewInspectorCompanionSectionRatio,' +
      ' normalizeCard: normalizePreviewInspectorCompanionCardHeight,' +
      ' normalizeRatio: normalizePreviewInspectorCompanionSectionRatio,' +
      ' readState: () => previewInspectorCompanionInnerState' +
      '};',
    context,
  );
  if (context.__innerRuntime === undefined) {
    throw new Error('Companion inner resize fixture did not initialize.');
  }
  return { runtime: context.__innerRuntime };
}

/** Creates one style-bearing card or section element for pure helper tests. */
function createFakeResizableElement(
  clientHeight: number,
  viewportHeight: number,
): FakeResizableElement {
  const attributes = new Map<string, string>();
  const values = new Map<string, string>();
  const style = {
    get height(): string {
      return values.get('height') ?? '';
    },
    set height(value: string) {
      values.set('height', value);
    },
    removeProperty: (name: string) => {
      values.delete(name);
    },
    setProperty: (name: string, value: string) => values.set(name, value),
    values,
  };
  return {
    attributes,
    clientHeight,
    closest: () => (viewportHeight > 0 ? { clientHeight: viewportHeight } : null),
    setAttribute: (name, value) => attributes.set(name, value),
    style,
  };
}
