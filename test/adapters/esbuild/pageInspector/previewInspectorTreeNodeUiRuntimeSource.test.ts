/** Verifies compact condition controls independently from Fiber collection and project React. */
import vm from 'node:vm';
import { describe, expect, it } from 'vitest';
import { createPreviewInspectorTreeNodeUiRuntimeSource } from '../../../../src/adapters/esbuild/pageInspector/previewInspectorTreeNodeUiRuntimeSource';

/** Minimal React-element shape returned by the generated test adapter. */
interface TestElement {
  readonly children: readonly unknown[];
  readonly props: Record<string, unknown>;
  readonly type: unknown;
}

/** Generated switch contract exposed only inside the VM fixture. */
interface TreeSwitchRuntime {
  readonly contextBadge: (node: Record<string, unknown>) => string | undefined;
  readonly expectedOutputBadge: (node: Record<string, unknown>) => string | undefined;
  readonly expectedTitle: (node: Record<string, unknown>) => string;
  readonly presenceBadge: (node: Record<string, unknown>) => string | undefined;
  readonly readResets: () => readonly string[];
  readonly readToggles: () => readonly string[];
  readonly render: (node: Record<string, unknown>) => TestElement;
  readonly sourceAttributes: (source: Record<string, unknown>) => Record<string, unknown>;
}

describe('Preview Inspector component-tree condition switch', () => {
  /** Gives the visible twisty its own companion identity instead of replaying parent selection. */
  it('marks expandable twisties as dedicated remote controls', () => {
    const source = createPreviewInspectorTreeNodeUiRuntimeSource();

    expect(source).toContain(
      "'data-react-preview-tree-toggle-control': hasChildren ? node.id : undefined",
    );
    expect(source).toContain("hasChildren ? (expanded ? '▼' : '▶') : ''");
  });

  /** Labels statically known callback output as pending rather than as a mounted component. */
  it('exposes a dedicated badge for a deferred render callback placeholder', () => {
    const runtime = evaluateTreeSwitchRuntime();

    expect(runtime.contextBadge({ edgeKind: 'deferred-render-callback' })).toBe(
      'awaiting callback',
    );
    expect(
      runtime.contextBadge({ edgeKind: 'deferred-render-callback', expectedFrontier: true }),
    ).toBe('callback output not observed');
  });

  /** Static source evidence must not repeat a false `not mounted` assertion down every JSX row. */
  it('separates authored JSX evidence from proven active-page absence', () => {
    const runtime = evaluateTreeSwitchRuntime();

    expect(runtime.presenceBadge({ expectedOutput: true, mounted: false })).toBeUndefined();
    expect(runtime.presenceBadge({ currentFileExport: true, mounted: false })).toBe(
      'not on active page path',
    );
    expect(runtime.presenceBadge({ mounted: false })).toBe('not mounted');
    expect(runtime.contextBadge({ edgeKind: 'expected-jsx-component' })).toBe('authored child');
    expect(
      runtime.contextBadge({ edgeKind: 'expected-jsx-component', expectedFrontier: true }),
    ).toBe('output not observed');
    expect(
      runtime.contextBadge({ edgeKind: 'expected-render-outcome', expectedOutcomeActive: false }),
    ).toBe('inactive return');
  });

  /** Reports one group-level output cause while the nearest static frontier remains explanatory. */
  it('summarizes missing authored output without assigning descendant mount states', () => {
    const runtime = evaluateTreeSwitchRuntime();

    expect(
      runtime.expectedOutputBadge({
        authoredOutputMissing: true,
        edgeKind: 'expected-output-group',
        props: { deferredCallbackPending: true },
      }),
    ).toBe('CALLBACK OUTPUT NOT OBSERVED');
    expect(
      runtime.expectedOutputBadge({
        authoredOutputMissing: true,
        edgeKind: 'expected-output-group',
        props: { wrapperOrFallbackHost: true },
      }),
    ).toBe('FALLBACK VISIBLE');
    expect(runtime.expectedTitle({ edgeKind: 'expected-jsx-component' })).toContain(
      'individual runtime presence is not asserted',
    );
  });

  /** Mirrors exact and approximate source coordinates through inert companion snapshot attributes. */
  it('serializes source-select attributes directly onto a component-tree row', () => {
    const runtime = evaluateTreeSwitchRuntime();

    expect(
      runtime.sourceAttributes({
        approximate: true,
        column: 11,
        line: 23,
        occurrenceStart: 91,
        origin: 'ancestry',
        path: '/workspace/src/Panel.tsx',
      }),
    ).toMatchObject({
      'data-react-preview-source-select': 'true',
      'data-rpi-source-approximate': 'true',
      'data-rpi-source-column': 11,
      'data-rpi-source-line': 23,
      'data-rpi-source-offset': 91,
      'data-rpi-source-origin': 'ancestry',
      'data-rpi-source-path': '/workspace/src/Panel.tsx',
    });
    expect(runtime.sourceAttributes({ line: 23 })).toEqual({});
  });

  /** Keeps short-circuited guards visible but inert until a compiler-issued live ID exists. */
  it('renders a disabled not-reached switch without invoking a condition override', () => {
    const runtime = evaluateTreeSwitchRuntime();
    const element = runtime.render(
      conditionNode({
        conditionTreeId: 'logical-and:chain:1',
        effectiveEnabled: false,
        expression: 'session.user',
        kind: 'logical-and',
        reached: false,
      }),
    );
    const switchButton = element.children[0] as TestElement;

    expect(switchButton.props).toMatchObject({
      'aria-checked': false,
      'aria-disabled': true,
      disabled: true,
      role: 'switch',
    });
    expect(switchButton.children).toEqual(['Wait']);
    invokeClick(switchButton);
    expect(runtime.readToggles()).toEqual([]);
  });

  /** Toggles from the row without selecting it and exposes an authored reset for forced state. */
  it('stops row clicks while toggling and resetting one reached guard', () => {
    const runtime = evaluateTreeSwitchRuntime();
    const element = runtime.render(
      conditionNode(
        {
          effectiveEnabled: true,
          expression: 'showPanel',
          id: 'runtime-panel',
          kind: 'logical-and',
          override: true,
          reached: true,
        },
        'runtime-panel',
      ),
    );
    const switchButton = element.children[0] as TestElement;
    const resetButton = element.children[1] as TestElement;

    expect(switchButton.props).toMatchObject({ 'aria-checked': true, role: 'switch' });
    expect(invokeClick(switchButton)).toEqual({ prevented: true, stopped: true });
    expect(runtime.readToggles()).toEqual(['runtime-panel']);
    expect(invokeClick(resetButton)).toEqual({ prevented: true, stopped: true });
    expect(runtime.readResets()).toEqual(['runtime-panel']);
  });
});

/** Creates the tree pseudo-node shape consumed by the compact row control. */
function conditionNode(
  condition: Record<string, unknown>,
  conditionId?: string,
): Record<string, unknown> {
  return {
    children: [],
    condition,
    conditionId,
    id: 'render-condition:' + String(condition.conditionTreeId ?? condition.id),
    kind: 'condition',
    name: 'JSX switch',
  };
}

/** Invokes one generated button handler and reports whether row-selection propagation was stopped. */
function invokeClick(element: TestElement): {
  readonly prevented: boolean;
  readonly stopped: boolean;
} {
  let prevented = false;
  let stopped = false;
  const onClick = element.props.onClick as
    ((event: Record<string, () => void>) => void) | undefined;
  onClick?.({
    preventDefault: () => {
      prevented = true;
    },
    stopPropagation: () => {
      stopped = true;
    },
  });
  return { prevented, stopped };
}

/** Evaluates only the generated compact switch with inert helpers for the surrounding tree row. */
function evaluateTreeSwitchRuntime(): TreeSwitchRuntime {
  const context: { __runtime?: TreeSwitchRuntime } = {};
  vm.runInNewContext(
    `
      const React = {
        createElement: (type, props, ...children) => ({ type, props: props ?? {}, children }),
      };
      const toggles = [];
      const resets = [];
      const isPreviewInspectorConditionNode = (node) => node?.kind === 'condition';
      const togglePreviewInspectorRenderCondition = (id) => toggles.push(id);
      const resetPreviewInspectorRenderConditionOverride = (id) => resets.push(id);
      ${createPreviewInspectorTreeNodeUiRuntimeSource()}
      globalThis.__runtime = {
        contextBadge: formatPreviewInspectorRenderContextBadge,
        expectedOutputBadge: formatPreviewInspectorExpectedOutputBadge,
        expectedTitle: formatPreviewInspectorExpectedEvidenceTitle,
        presenceBadge: readPreviewInspectorTreePresenceBadge,
        readResets: () => [...resets],
        readToggles: () => [...toggles],
        render: (node) => PreviewInspectorComponentTreeConditionSwitch({ node }),
        sourceAttributes: createPreviewInspectorTreeRowSourceAttributes,
      };
    `,
    context,
  );
  if (context.__runtime === undefined) throw new Error('Tree switch runtime did not initialize.');
  return context.__runtime;
}
