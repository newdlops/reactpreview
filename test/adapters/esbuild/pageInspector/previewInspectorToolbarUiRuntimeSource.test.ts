/** Verifies task grouping and existing control callbacks without mounting authored React. */
import vm from 'node:vm';
import { describe, expect, it } from 'vitest';
import { createPreviewInspectorToolbarUiRuntimeSource } from '../../../../src/adapters/esbuild/pageInspector/previewInspectorToolbarUiRuntimeSource';

/** Minimal host element produced by the presentation-only VM fixture. */
interface Element {
  readonly type: string;
  readonly props: Record<string, unknown>;
  readonly children: readonly (Element | string)[];
}

/** Observable toolbar fixture; callbacks only write to its local records. */
interface ToolbarFixture {
  readonly calls: unknown[];
  readonly element: Element;
  readonly state: Record<string, unknown>;
  readonly button: (label: string) => Element;
}

/** Finds a real element in the generated tree, retaining callbacks for explicit user actions. */
function find(root: Element, predicate: (element: Element) => boolean): Element | undefined {
  if (predicate(root)) return root;
  for (const child of root.children) {
    if (typeof child === 'string') continue;
    const match = find(child, predicate);
    if (match !== undefined) return match;
  }
  return undefined;
}

/** Fails explicitly when a required semantic control is missing from the generated tree. */
function requireElement(root: Element, predicate: (element: Element) => boolean): Element {
  const element = find(root, predicate);
  if (element === undefined) throw new Error('Expected toolbar element was not generated.');
  return element;
}

/** Renders the toolbar composition with inert child components and observable state callbacks. */
function fixture(editable = true, pickerEnabled = false): ToolbarFixture {
  const calls: unknown[] = [];
  const state: Record<string, unknown> = {};
  const context: Record<string, unknown> = {
    React: {
      Fragment: 'fragment',
      createElement: (type: string, props: unknown, ...children: unknown[]) => ({
        type,
        props: props ?? {},
        children: children.flat(Infinity),
      }),
    },
    PreviewInspectorDevtoolsButton: 'button',
    PreviewInspectorMoveHandle: 'move-handle',
    PreviewInspectorLayoutSelect: 'layout-select',
    PreviewInspectorHiddenElementControls: 'hidden-controls',
    previewInspectorSession: {
      pickerEnabled,
      highlightEnabled: true,
      highlightStatus: 'Highlighting 1 selected component',
      descriptorNames: ['PaymentPanel'],
      selectedExportName: 'PaymentPanel',
    },
    previewInspectorDevtoolsSessionState: state,
    persistPreviewInspectorState: () => calls.push('persist'),
    setPreviewInspectorPickerEnabled: (value: boolean) => calls.push(['picker', value]),
    selectPreviewInspectorMainComponent: () => calls.push('current-file'),
    setPreviewInspectorHighlightEnabled: (value: boolean) => calls.push(['highlight', value]),
    selectPreviewInspectorExport: (value: string) => calls.push(['export', value]),
    remountPreviewInspectorExport: (value: string) => calls.push(['remount', value]),
    formatPreviewInspectorEntryName: (value: string) => 'Target · ' + value,
    args: {
      collapsed: false,
      editable,
      mainComponentName: editable ? 'PaymentPanel' : undefined,
      layout: { dock: 'bottom' },
      selectedNode: { exportName: 'PaymentPanel' },
      wireframeVisible: true,
      setCollapsed: (update: (value: boolean) => boolean) =>
        calls.push(['collapse', update(false)]),
      setWireframeVisible: (value: boolean) => calls.push(['wireframe', value]),
    },
  };
  vm.runInNewContext(
    `${createPreviewInspectorToolbarUiRuntimeSource()}
     globalThis.element = PreviewInspectorToolbarActions(args);`,
    context,
  );
  const element = context.element as Element;
  return {
    calls,
    element,
    state,
    button: (label: string) => requireElement(element, (entry) => entry.children.includes(label)),
  };
}

describe('Inspector task-focused toolbar', () => {
  it('keeps selection first and all optional tools under a closed native disclosure', () => {
    const { element, calls } = fixture();
    const header = requireElement(element, (entry) => entry.type === 'header');
    const options = requireElement(element, (entry) => entry.type === 'details');
    expect(find(header, (entry) => entry.children.includes('Pick on page'))?.props.variant).toBe(
      'primary',
    );
    expect(find(header, (entry) => entry.children.includes('Current file'))).toBeDefined();
    expect(find(header, (entry) => entry.children.includes('Highlight'))).toBeUndefined();
    expect(options.props.open).toBeUndefined();
    expect(find(options, (entry) => entry.type === 'summary')?.children).toEqual(['View & tools']);
    for (const label of [
      'Highlight',
      'Wireframe',
      'Remount',
      'Component export',
      'Inspector position',
    ]) {
      expect(
        find(options, (entry) => entry.children.includes(label)),
        label,
      ).toBeDefined();
    }
    expect(find(options, (entry) => entry.type === 'hidden-controls')).toBeDefined();
    expect(calls).toEqual([]);
  });

  it('preserves picker cancellation, current-file selection and explicit overlay changes', () => {
    const controls = fixture(true, true);
    (controls.button('Cancel pick').props.onClick as () => void)();
    (controls.button('Current file').props.onClick as () => void)();
    (controls.button('Highlight').props.onClick as () => void)();
    (controls.button('Wireframe').props.onClick as () => void)();
    expect(controls.calls).toEqual([
      ['picker', false],
      'current-file',
      ['highlight', false],
      ['wireframe', false],
      'persist',
    ]);
    expect(controls.state.wireframeVisible).toBe(false);
  });

  it('retains native disabled controls and labeled export selection', () => {
    const controls = fixture(false);
    expect(controls.button('Current file').props.disabled).toBe(true);
    expect(controls.button('Remount').props.disabled).toBe(true);
    const label = requireElement(controls.element, (entry) => entry.type === 'label');
    const select = requireElement(label, (entry) => entry.type === 'select');
    expect(select.props['aria-label']).toBe('Instrumented target export');
    (select.props.onChange as (event: unknown) => void)({ target: { value: 'PaymentPanel' } });
    expect(controls.calls).toEqual([['export', 'PaymentPanel']]);
  });

  it('only remounts and persists collapse after the corresponding explicit click', () => {
    const controls = fixture();
    (controls.button('Remount').props.onClick as () => void)();
    (controls.button('Collapse').props.onClick as () => void)();
    expect(controls.calls).toEqual([['remount', 'PaymentPanel'], 'persist', ['collapse', true]]);
    expect(controls.state.collapsed).toBe(true);
  });
});
