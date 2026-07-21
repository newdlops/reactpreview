/** Verifies the single Components navigation boundary without mounting project React. */
import vm from 'node:vm';
import { describe, expect, it } from 'vitest';
import { createPreviewInspectorNavigationUiRuntimeSource } from '../../../../src/adapters/esbuild/pageInspector/previewInspectorNavigationUiRuntimeSource';

/** Small serializable view of the generated React element used by the VM fixture. */
interface NavigationRenderResult {
  readonly rootCount: number;
  readonly selectedId: string;
  readonly status: string;
  readonly truncated: boolean;
  readonly type: string;
}

describe('Preview Inspector navigation UI runtime source', () => {
  /** Keeps the component tree as the only primary pane and omits graph/setup navigation state. */
  it('renders one stable Components pane without tabs or blocker graph UI', () => {
    const source = createPreviewInspectorNavigationUiRuntimeSource();

    expect(() => new vm.Script(source)).not.toThrow();
    expect(source).toContain(
      'function PreviewInspectorNavigationPane({ roots, selectedId, status, truncated })',
    );
    expect(source).toContain('React.createElement(PreviewInspectorComponentsPane');
    expect(source).not.toContain("['blockers', 'Preview setup']");
    expect(source).not.toContain('PreviewInspectorRenderFlowDetail');
    expect(source).not.toContain('navigationTab');
    expect(source).not.toContain("role: 'tablist'");
  });

  /** Forwards tree inputs unchanged so the searchable pane retains expansion and scroll state. */
  it('forwards the component snapshot through the named workbench boundary', () => {
    expect(evaluateNavigationRender()).toEqual({
      rootCount: 2,
      selectedId: 'target',
      status: 'live tree',
      truncated: true,
      type: 'components-pane',
    });
  });
});

/** Evaluates only the generated composition function with an inert React element factory. */
function evaluateNavigationRender(): NavigationRenderResult {
  const context: { __navigation?: NavigationRenderResult } = {};
  vm.runInNewContext(
    `
      const React = {
        createElement: (type, props) => ({ props, type }),
      };
      const PreviewInspectorComponentsPane = 'components-pane';
      ${createPreviewInspectorNavigationUiRuntimeSource()}
      const result = PreviewInspectorNavigationPane({
        roots: [{ id: 'root' }, { id: 'target' }],
        selectedId: 'target',
        status: 'live tree',
        truncated: true,
      });
      globalThis.__navigation = {
        rootCount: result.props.roots.length,
        selectedId: result.props.selectedId,
        status: result.props.status,
        truncated: result.props.truncated,
        type: result.type,
      };
    `,
    context,
  );
  if (context.__navigation === undefined) {
    throw new Error('Generated navigation runtime did not initialize.');
  }
  return context.__navigation;
}
