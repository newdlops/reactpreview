/**
 * Verifies the isolated Inspector card/section resize runtime without mounting project React.
 */
import vm from 'node:vm';
import { describe, expect, it } from 'vitest';
import { createPreviewInspectorSectionResizeUiRuntimeSource } from '../../../../src/adapters/esbuild/pageInspector/previewInspectorSectionResizeUiRuntimeSource';

/**
 * Evaluates only the pure normalization/geometry helpers exported from the generated browser
 * source. React is not required because component function bodies are not invoked by these tests.
 */
function evaluateSectionResizeHelpers(): {
  applyShellCollapsed: (
    shell: unknown,
    regionName: string,
    resizeId: string,
    button: unknown,
    collapsed: boolean,
  ) => boolean;
  applyShellHeight: (
    shell: unknown,
    regionName: string,
    resizeId: string,
    value: unknown,
  ) => number | undefined;
  calculateRatio: (
    pointerY: number,
    containerTop: number,
    containerHeight: number,
    minimumSize?: number,
  ) => number;
  normalizeCardHeight: (value: unknown, maximum?: number) => number | undefined;
  normalizeRatio: (value: unknown, fallback?: number) => number;
  normalizeShellHeight: (value: unknown, minimum: number, maximum?: number) => number | undefined;
  state: {
    cardHeights: Record<string, number>;
    collapsedSections: Record<string, boolean>;
    sectionRatios: Record<string, number>;
    shellRegionHeights: Record<string, number>;
  };
} {
  const context = {
    __state: {
      cardHeights: {
        __proto__: 200,
        huge: 50_000,
        invalid: 'wide',
        valid: 180,
      },
      collapsedSections: {
        context: true,
        invalid: 'yes',
      },
      sectionRatios: {
        constructor: 0.5,
        invalid: 'half',
        valid: 0.7,
      },
      shellRegionHeights: {
        context: 320,
        invalid: 'tall',
      },
    },
    getComputedStyle: () => ({ minHeight: '180px' }),
  };
  const source = `
const previewInspectorDevtoolsSessionState = globalThis.__state;
function persistPreviewInspectorState() {}
${createPreviewInspectorSectionResizeUiRuntimeSource()}
globalThis.__helpers = {
  applyShellCollapsed: applyPreviewInspectorShellRegionCollapsed,
  applyShellHeight: applyPreviewInspectorShellRegionHeight,
  calculateRatio: calculatePreviewInspectorSectionRatio,
  normalizeCardHeight: normalizePreviewInspectorCardHeight,
  normalizeRatio: normalizePreviewInspectorSectionRatio,
  normalizeShellHeight: normalizePreviewInspectorShellRegionHeight,
  state: previewInspectorDevtoolsSessionState,
};
`;
  vm.runInNewContext(source, context);
  return (
    context as typeof context & { __helpers: ReturnType<typeof evaluateSectionResizeHelpers> }
  ).__helpers;
}

describe('Page Inspector inner section resize runtime source', () => {
  /** Prevents a malformed template edit from breaking the entire generated Inspector bundle. */
  it('emits syntactically valid browser runtime source', () => {
    expect(() => new vm.Script(createPreviewInspectorSectionResizeUiRuntimeSource())).not.toThrow();
  });

  /** Reserves the other header and workbench when a top-level shell row grows. */
  it('clamps toolbar and page-context heights against the remaining workbench', () => {
    const runtime = evaluateSectionResizeHelpers();
    const styleValues = new Map<string, string>();
    const toolbar = {
      getBoundingClientRect: () => ({ height: 80 }),
      setAttribute: () => undefined,
    };
    const context = {
      getBoundingClientRect: () => ({ height: 300 }),
      setAttribute: () => undefined,
    };
    const workbench = {};
    const shell = {
      clientHeight: 1_000,
      querySelector: (selector: string) =>
        selector.includes('rpi-toolbar')
          ? toolbar
          : selector.includes('rpi-page-context')
            ? context
            : selector.includes('rpi-workbench')
              ? workbench
              : null,
      style: {
        removeProperty: (name: string) => styleValues.delete(name),
        setProperty: (name: string, value: string) => styleValues.set(name, value),
      },
    };

    expect(runtime.applyShellHeight(shell, 'context', 'shell-context', 900)).toBe(710);
    expect(styleValues.get('--rpi-context-section-height')).toBe('710px');
    expect(runtime.applyShellHeight(shell, 'toolbar', 'shell-toolbar', 900)).toBe(674);
    expect(styleValues.get('--rpi-toolbar-section-height')).toBe('674px');
    shell.clientHeight = 500;
    expect(runtime.applyShellHeight(shell, 'toolbar', 'shell-toolbar', 50)).toBe(50);
    expect(runtime.applyShellHeight(shell, 'toolbar', 'shell-toolbar', 900)).toBe(174);
    expect(styleValues.get('--rpi-toolbar-section-height')).toBe('174px');
  });

  /** Keeps accordion disclosure state independent from the last expanded region height. */
  it('collapses and restores a shell region without discarding its saved height', () => {
    const runtime = evaluateSectionResizeHelpers();
    const shellAttributes = new Map<string, string>();
    const contextAttributes = new Map<string, string>();
    const buttonAttributes = new Map<string, string>();
    const styleValues = new Map<string, string>();
    const chevron = { textContent: '' };
    const toolbar = {
      getBoundingClientRect: () => ({ height: 80 }),
      setAttribute: () => undefined,
    };
    const context = {
      getBoundingClientRect: () => ({ height: 320 }),
      hidden: false,
      setAttribute: (name: string, value: string) => contextAttributes.set(name, value),
    };
    const shell = {
      clientHeight: 800,
      querySelector: (selector: string) =>
        selector.includes('rpi-toolbar')
          ? toolbar
          : selector.includes('rpi-page-context')
            ? context
            : selector.includes('rpi-workbench')
              ? {}
              : null,
      getAttribute: (name: string) => shellAttributes.get(name) ?? null,
      setAttribute: (name: string, value: string) => shellAttributes.set(name, value),
      style: {
        removeProperty: (name: string) => styleValues.delete(name),
        setProperty: (name: string, value: string) => styleValues.set(name, value),
      },
    };
    const button = {
      querySelector: () => chevron,
      setAttribute: (name: string, value: string) => buttonAttributes.set(name, value),
    };

    expect(runtime.applyShellCollapsed(shell, 'context', 'context', button, true)).toBe(true);
    expect(context.hidden).toBe(true);
    expect(styleValues.get('--rpi-context-section-height')).toBe('0px');
    expect(buttonAttributes.get('aria-expanded')).toBe('false');
    expect(chevron.textContent).toBe('▸');
    expect(runtime.applyShellHeight(shell, 'toolbar', 'toolbar-free', 900)).toBe(546);

    expect(runtime.applyShellCollapsed(shell, 'context', 'context', button, false)).toBe(false);
    expect(context.hidden).toBe(false);
    expect(styleValues.get('--rpi-context-section-height')).toBe('320px');
    expect(buttonAttributes.get('aria-expanded')).toBe('true');
    expect(runtime.state.collapsedSections.context).toBe(false);
  });

  /** Keeps restored card values finite and prevents polluted or unbounded persisted state. */
  it('normalizes persisted card heights and split ratios', () => {
    const runtime = evaluateSectionResizeHelpers();

    expect(runtime.normalizeCardHeight(undefined)).toBeUndefined();
    expect(runtime.normalizeCardHeight(12)).toBe(56);
    expect(runtime.normalizeCardHeight(900, 320)).toBe(320);
    expect(runtime.normalizeCardHeight(50_000)).toBe(4096);
    expect(runtime.normalizeRatio(-1)).toBe(0.15);
    expect(runtime.normalizeRatio(2)).toBe(0.85);
    expect(runtime.normalizeShellHeight(12, 36)).toBe(36);
    expect(runtime.normalizeShellHeight(900, 72, 420)).toBe(420);
    expect(runtime.state.cardHeights).toMatchObject({ huge: 4096, valid: 180 });
    expect(runtime.state.cardHeights).not.toHaveProperty('invalid');
    expect(runtime.state.collapsedSections).toMatchObject({ context: true });
    expect(runtime.state.collapsedSections).not.toHaveProperty('invalid');
    expect(runtime.state.sectionRatios).toMatchObject({ valid: 0.7 });
    expect(runtime.state.sectionRatios).not.toHaveProperty('invalid');
    expect(runtime.state.shellRegionHeights).toMatchObject({ context: 320 });
    expect(runtime.state.shellRegionHeights).not.toHaveProperty('invalid');
  });

  /** Preserves usable space for both regions when the pointer reaches either panel edge. */
  it('derives a bounded tree/detail split from pointer geometry', () => {
    const runtime = evaluateSectionResizeHelpers();

    expect(runtime.calculateRatio(100, 100, 400, 72)).toBeCloseTo(72 / 363);
    expect(runtime.calculateRatio(281.5, 100, 400, 72)).toBeCloseTo(0.5);
    expect(runtime.calculateRatio(500, 100, 400, 72)).toBeCloseTo(291 / 363);
    expect(runtime.calculateRatio(Number.NaN, 100, 400, 72)).toBe(0.6);
  });

  /** Uses DOM-only pointer updates, keyboard access, persistence, and responsive re-clamping. */
  it('emits accessible handles without React state churn during drag', () => {
    const source = createPreviewInspectorSectionResizeUiRuntimeSource();
    const shellRegionSource = source.slice(
      source.indexOf('function PreviewInspectorShellRegionHeightHandle'),
      source.indexOf('function PreviewInspectorSectionHeightHandle'),
    );
    const treeSectionSource = source.slice(
      source.indexOf('function PreviewInspectorSectionHeightHandle'),
    );

    expect(source).toContain('function PreviewInspectorCardHeightHandle');
    expect(source).toContain('function PreviewInspectorSectionHeightHandle');
    expect(source).toContain('function PreviewInspectorShellRegionHeightHandle');
    expect(source).toContain('function PreviewInspectorAccordionBoundary');
    expect(source).toContain('function PreviewInspectorResizableCard');
    expect(source).toContain("role: 'separator'");
    expect(source).toContain("'aria-orientation': 'horizontal'");
    expect(source).toContain("event.key === 'ArrowUp'");
    expect(source).toContain("event.key === 'ArrowDown'");
    expect(source).toContain('event.currentTarget.setPointerCapture?.(event.pointerId)');
    expect(source).toContain("card.style.height = String(height) + 'px'");
    expect(source).toContain("container.style.setProperty('--rpi-primary-section-height'");
    expect(source).toContain("variable: '--rpi-toolbar-section-height'");
    expect(source).toContain("variable: '--rpi-context-section-height'");
    expect(source).toContain('previewInspectorDevtoolsSessionState.collapsedSections');
    expect(source).toContain("className: 'rpi-section-accordion-toggle'");
    expect(source).toContain("'data-rpi-accordion-id': toggleId");
    expect(source).toContain("'data-rpi-accordion-toggle': toggleId");
    expect(source).toContain('const PREVIEW_INSPECTOR_INNER_BOUNDARY_SIZE = 37');
    expect(source).toContain("'aria-expanded': !collapsed");
    expect(source).toContain('applyPreviewInspectorSectionCollapsed');
    expect(source).toContain('applyPreviewInspectorShellRegionCollapsed');
    expect(source).toContain('new ResizeObserver');
    expect(source).toContain('persistPreviewInspectorState()');
    expect(
      shellRegionSource.indexOf('React.createElement(PreviewInspectorAccordionBoundary'),
    ).toBeLessThan(shellRegionSource.indexOf('\n    children,\n'));
    expect(shellRegionSource.indexOf('\n    children,\n')).toBeLessThan(
      shellRegionSource.indexOf("className: 'rpi-shell-section-height-handle'"),
    );
    expect(treeSectionSource.indexOf("className: 'rpi-section-height-handle'")).toBeLessThan(
      treeSectionSource.indexOf('React.createElement(PreviewInspectorAccordionBoundary'),
    );
    expect(source).not.toContain('React.useState');
    expect(source).not.toContain('scrollTop =');
  });
});
