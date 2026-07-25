/** Verifies current-file scenario-first navigation without mounting project React. */
import vm from 'node:vm';
import { describe, expect, it } from 'vitest';
import { createPreviewInspectorNavigationUiRuntimeSource } from '../../../../src/adapters/esbuild/pageInspector/previewInspectorNavigationUiRuntimeSource';

/** Small serializable view of the generated navigation element used by the VM fixture. */
interface NavigationRenderResult {
  readonly activePanel: string;
  readonly firstTabLabel: string;
  readonly firstTabSelected: boolean;
  readonly fourthTabLabel: string;
  readonly rootCount: number;
  readonly secondTabLabel: string;
  readonly thirdTabLabel: string;
}

describe('Preview Inspector navigation UI runtime source', () => {
  /** Gives each dense Inspector section one full-width, scenario-first top-level tab. */
  it('emits four accessible primary tabs in section order', () => {
    const source = createPreviewInspectorNavigationUiRuntimeSource();

    expect(() => new vm.Script(source)).not.toThrow();
    expect(source).toContain(
      'function PreviewInspectorNavigationPane({ node, roots, selectedId, status, truncated })',
    );
    expect(source).toContain("role: 'tablist'");
    expect(source).toContain("'data-rpi-scroll-key': 'workbench-tabs'");
    expect(source).toContain("'JSX scenarios'");
    expect(source).toContain("'Components'");
    expect(source).toContain("'Inspect selection'");
    expect(source).toContain("'Console ('");
    expect(source.indexOf("'JSX scenarios'")).toBeLessThan(source.indexOf("'Components'"));
    expect(source).toContain('React.createElement(PreviewInspectorJsxScenarioPane');
    expect(source).toContain('React.createElement(PreviewInspectorComponentsPane');
    expect(source).toContain(
      'React.createElement(PreviewInspectorComponentsPane, {\n          node,\n          roots,',
    );
    expect(source).toContain(
      "React.createElement(PreviewInspectorDetailsPane, { node, view: 'details' })",
    );
    expect(source).toContain(
      "React.createElement(PreviewInspectorDetailsPane, { node, view: 'console' })",
    );
    expect(source).not.toContain('PreviewInspectorRenderFlowDetail');
  });

  /** Defaults to scenarios while forwarding the full snapshot to the selected primary pane. */
  it('opens the JSX scenario table first', () => {
    expect(evaluateNavigationRender()).toEqual({
      activePanel: 'scenario-pane',
      firstTabLabel: 'JSX scenarios',
      firstTabSelected: true,
      fourthTabLabel: 'Console (3)',
      rootCount: 2,
      secondTabLabel: 'Components',
      thirdTabLabel: 'Inspect selection',
    });
  });

  /** Restores the existing component-tree tab after a persisted user selection. */
  it('restores the component tree as the second tab', () => {
    expect(evaluateNavigationRender('tree')).toEqual({
      activePanel: 'components-pane',
      firstTabLabel: 'JSX scenarios',
      firstTabSelected: false,
      fourthTabLabel: 'Console (3)',
      rootCount: 2,
      secondTabLabel: 'Components',
      thirdTabLabel: 'Inspect selection',
    });
  });
});

/** Evaluates only the generated composition function with an inert React element factory. */
function evaluateNavigationRender(navigationTab?: 'tree'): NavigationRenderResult {
  const context: { __navigation?: NavigationRenderResult } = {};
  vm.runInNewContext(
    `
      const React = {
        createElement: (type, props, ...children) => ({
          props: { ...(props ?? {}), children: children.flat(Infinity) },
          type,
        }),
        useEffect: () => undefined,
        useState: (initializer) => [
          typeof initializer === 'function' ? initializer() : initializer,
          () => undefined,
        ],
      };
      const previewInspectorDevtoolsSessionState = {
        navigationTab: ${navigationTab === 'tree' ? "'tree'" : 'undefined'},
      };
      const isPreviewInspectorBlockerNode = () => false;
      const isPreviewInspectorDeferredUiTriggerNode = () => false;
      const isPreviewInspectorRenderChoiceNode = () => false;
      const notifyPreviewInspector = () => undefined;
      const persistPreviewInspectorState = () => undefined;
      const readPreviewInspectorConsoleEntries = () => [{}, {}, {}];
      const PreviewInspectorComponentsPane = 'components-pane';
      const PreviewInspectorDetailsPane = 'details-pane';
      const PreviewInspectorJsxScenarioPane = 'scenario-pane';
      ${createPreviewInspectorNavigationUiRuntimeSource()}
      const result = PreviewInspectorNavigationPane({
        roots: [{ id: 'root' }, { id: 'target' }],
        selectedId: 'target',
        status: 'live tree',
        truncated: true,
        node: { id: 'target' },
      });
      const heading = result.props.children[0];
      const tablist = heading.props.children[0];
      const firstTab = tablist.props.children[0];
      const secondTab = tablist.props.children[1];
      const thirdTab = tablist.props.children[2];
      const fourthTab = tablist.props.children[3];
      const activePanel = result.props.children[1];
      globalThis.__navigation = {
        activePanel: activePanel.type,
        firstTabLabel: firstTab.props.children[0],
        firstTabSelected: firstTab.props['aria-selected'],
        fourthTabLabel: fourthTab.props.children[0],
        rootCount: activePanel.props.roots.length,
        secondTabLabel: secondTab.props.children[0],
        thirdTabLabel: thirdTab.props.children[0],
      };
    `,
    context,
  );
  if (context.__navigation === undefined) {
    throw new Error('Generated navigation runtime did not initialize.');
  }
  return context.__navigation;
}
