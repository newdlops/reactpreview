/** Verifies the semantic debugger-flow UI source without mounting React or project components. */
import vm from 'node:vm';
import { describe, expect, it } from 'vitest';
import { createPreviewInspectorFlowchartCssRuntimeSource } from '../../../../src/adapters/esbuild/pageInspector/previewInspectorFlowchartCssRuntimeSource';
import { createPreviewInspectorFlowchartUiRuntimeSource } from '../../../../src/adapters/esbuild/pageInspector/previewInspectorFlowchartUiRuntimeSource';

describe('Preview Inspector flowchart UI runtime source', () => {
  /** Emits a parser-safe semantic graph with explicit rank, connector, node, and edge components. */
  it('renders a debugger-style flowchart from ordinary companion-safe DOM elements', () => {
    const source = createPreviewInspectorFlowchartUiRuntimeSource();

    expect(() => new vm.Script(source)).not.toThrow();
    expect(source).toContain('function PreviewInspectorFlowchart({ flow, onSelect');
    expect(source).toContain('function PreviewInspectorFlowchartRank');
    expect(source).toContain('function PreviewInspectorFlowchartConnector');
    expect(source).toContain('function PreviewInspectorFlowchartEdgeTrack');
    expect(source).toContain("'aria-label': 'JSX render debugger flowchart'");
    expect(source).toContain("'data-rpi-flowchart-node': step.id");
    expect(source).toContain("'data-rpi-flowchart-edge': segment.id");
    expect(source).toContain("'data-rpi-scroll-key': 'render-flowchart'");
    expect(source).toContain("'data-rpi-path': cell.path");
    expect(source).not.toContain("'data-path': cell.path");
    expect(source).not.toContain("React.createElement('svg'");
    expect(source).not.toContain('style:');
  });

  /** Provides graph traversal while keeping mutation controls in the independent right Resolver. */
  it('supports graph-aware keyboard traversal without mounting an editor inside the canvas', () => {
    const source = createPreviewInspectorFlowchartUiRuntimeSource();

    for (const key of ['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown', 'Home', 'End']) {
      expect(source).toContain(`'${key}'`);
    }
    expect(source).toContain('layout.predecessorIdsByNode.get(step.id)');
    expect(source).toContain('layout.edges.filter((candidate) => candidate.fromId === current.id)');
    expect(source).toContain('React.createElement(PreviewInspectorFlowchartToolbar');
    expect(source).toContain("'data-rpi-current-file': String(currentFile)");
    expect(source).toContain(
      "'data-rpi-current-file-context': String(currentFileContext || staticCurrentFile)",
    );
    expect(source).toContain("'CURRENT FILE FLOW'");
    expect(source).not.toContain('function PreviewInspectorFlowchartSelection');
    expect(source).not.toContain('React.createElement(PreviewInspectorRenderFlowNodeEditor');
  });

  /** Distinguishes decisions, joins, HOCs, component slots, inactive branches, and direct blockers. */
  it('uses shape and text semantics instead of depending on color alone', () => {
    const source = createPreviewInspectorFlowchartUiRuntimeSource();
    const css = createPreviewInspectorFlowchartCssRuntimeSource();

    expect(source).toContain("if (graphKind === 'decision') return 'Decision'");
    expect(source).toContain("if (graphKind === 'join') return 'Branch join'");
    expect(source).toContain("if (graphKind === 'hoc') return 'Higher-order component'");
    expect(source).toContain("if (graphKind === 'component-slot') return 'Component prop / slot'");
    expect(source).toContain("'CURRENT FILE BLOCKER'");
    expect(source).toContain("'Dormant branch'");
    expect(css).toContain('.rpi-flowchart-node[data-rpi-graph-kind="decision"]');
    expect(css).toContain('.rpi-flowchart-node[data-rpi-graph-kind="join"]');
    expect(css).toContain('.rpi-flowchart-node[data-rpi-graph-kind="hoc"]');
    expect(css).toContain('.rpi-flowchart-node[data-rpi-graph-kind="component-slot"]');
    expect(css).toContain('.rpi-flowchart-node[data-rpi-current-file-blocker="true"]');
    expect(css).toContain('.rpi-flowchart-node[data-rpi-branch-state="inactive"]');
  });
});
