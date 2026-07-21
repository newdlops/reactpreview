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
    expect(source).toContain("'Current-file control and value flow'");
    expect(source).toContain("'data-rpi-major-flow': String(majorFlow)");
    expect(source).toContain('createPreviewInspectorFlowchartNeighborhood(');
    expect(source).toContain("? storedViewMode\n    : 'main'");
    expect(source).toContain("nextMode !== 'focus' && nextMode !== 'main'");
    expect(source).toContain('completeLayout.nodeById.has(selectedStepId)');
    expect(source).toContain('function createPreviewInspectorFlowchartMainFlow');
    expect(source).toContain('function readPreviewInspectorFlowchartVisibleSelectionId(');
    expect(source).toContain('selectedStepId: visibleSelectedStepId');
    expect(source).toContain("'data-rpi-flowchart-camera-key': cameraKey");
    expect(source).not.toContain('function PreviewInspectorFlowchartSelection');
    expect(source).not.toContain('React.createElement(PreviewInspectorRenderFlowNodeEditor');
  });

  /** Keeps graph nodes minimal while retaining every detailed meaning for accessibility/Inspector. */
  it('emphasizes the main flow with compact labels and non-color semantics', () => {
    const source = createPreviewInspectorFlowchartUiRuntimeSource();
    const css = createPreviewInspectorFlowchartCssRuntimeSource();

    expect(source).toContain("if (graphKind === 'decision') return 'Decision'");
    expect(source).toContain("if (graphKind === 'join') return 'Branch join'");
    expect(source).toContain("if (graphKind === 'hoc') return 'Higher-order component'");
    expect(source).toContain("if (graphKind === 'component-slot') return 'Component prop / slot'");
    expect(source).toContain("'CURRENT FILE BLOCKER'");
    expect(source).toContain("'Dormant branch'");
    expect(source).toContain("className: 'rpi-flowchart-node-label'");
    expect(css).toContain('.rpi-flowchart-node[data-rpi-graph-kind="decision"]');
    expect(css).toContain('.rpi-flowchart-node[data-rpi-graph-kind="join"]');
    expect(css).toContain('.rpi-flowchart-node[data-rpi-current-file-blocker="true"]');
    expect(css).toContain('.rpi-flowchart-node[data-rpi-branch-state="inactive"]');
    expect(css).toContain('.rpi-flowchart-node[data-rpi-major-flow="false"]');
    expect(css).toContain('.rpi-flowchart-edge-track[data-rpi-major-flow="false"]');
    expect(css).toContain('height:52px;max-width:166px;min-width:166px');
    const waitingRule = css.indexOf(
      '.rpi-flowchart-node[data-rpi-flow-status="waiting"]{opacity:.3}',
    );
    const visibilityOverride = css.indexOf(
      '.rpi-flowchart-node[data-rpi-major-flow="false"]:hover,' +
        '.rpi-flowchart-node[data-rpi-major-flow="false"][aria-pressed="true"],',
    );
    expect(visibilityOverride).toBeGreaterThan(waitingRule);
    expect(css).toContain(
      '.rpi-flowchart-node[data-rpi-current-file="true"],' +
        '.rpi-flowchart-node[data-rpi-current-file-blocker="true"]{opacity:1}',
    );
    expect(css).not.toContain('.rpi-flowchart-node-kind');
    expect(css).not.toContain('.rpi-flowchart-node-owner');
    expect(css).not.toContain('.rpi-flowchart-legend');
    expect(css).toContain('.rpi-flowchart-camera-status:empty{display:none}');
  });

  /** Uses compiler path metadata plus exact-owner JSX context without leaking rendered children. */
  it('filters Main to one entry path and the current file JSX flow while preserving edge kinds', () => {
    const source = createPreviewInspectorFlowchartUiRuntimeSource();
    const context: Record<string, unknown> = {};
    new vm.Script(
      `${source}
       globalThis.__createMajorPath = createPreviewInspectorFlowchartMajorPath;
       globalThis.__createMainFlow = createPreviewInspectorFlowchartMainFlow;
       globalThis.__readVisibleSelection = readPreviewInspectorFlowchartVisibleSelectionId;`,
    ).runInNewContext(context);
    const createMajorPath = context.__createMajorPath as (
      flow: Record<string, unknown>,
      layout: Record<string, unknown>,
      locator: Record<string, unknown>,
    ) => { edgeIds: Set<string>; nodeIds: Set<string> };
    const createMainFlow = context.__createMainFlow as (
      flow: Record<string, unknown>,
      layout: Record<string, unknown>,
      majorPath: { edgeIds: Set<string>; nodeIds: Set<string> },
    ) => { graphEdges: { id: string; kind: string }[]; graphNodes: { id: string }[] };
    const readVisibleSelection = context.__readVisibleSelection as (
      layout: Record<string, unknown>,
      selectedGraphStepId: string,
      locator: Record<string, unknown>,
      flow: Record<string, unknown>,
    ) => string | undefined;
    const nodes = [
      { graphKind: 'entry', id: 'root', node: {}, rank: 0, sourceIndex: 0 },
      { graphKind: 'component', id: 'shell', node: {}, rank: 1, sourceIndex: 1 },
      {
        currentFileContext: true,
        currentFileTarget: true,
        graphKind: 'component',
        id: 'target',
        node: {},
        rank: 2,
        sourceIndex: 2,
      },
      {
        currentFileContext: true,
        graphKind: 'decision',
        id: 'target-decision',
        node: {},
        rank: 3,
        sourceIndex: 3,
      },
      {
        currentFileContext: true,
        graphKind: 'return',
        id: 'target-return',
        node: {},
        rank: 4,
        sourceIndex: 4,
      },
      { graphKind: 'entry', id: 'rendered-child', node: {}, rank: 5, sourceIndex: 5 },
      { graphKind: 'component', id: 'active-sibling', node: {}, rank: 1, sourceIndex: 6 },
      { graphKind: 'blocker', id: 'selected-unrelated', node: {}, rank: 2, sourceIndex: 7 },
    ];
    const edges = [
      {
        active: true,
        certainty: 'confirmed',
        fromId: 'root',
        id: 'root-shell',
        kind: 'renders',
        toId: 'shell',
      },
      {
        active: true,
        certainty: 'confirmed',
        fromId: 'shell',
        id: 'shell-target',
        kind: 'component-prop',
        toId: 'target',
      },
      {
        active: true,
        certainty: 'confirmed',
        fromId: 'target',
        id: 'target-decision-edge',
        kind: 'next',
        toId: 'target-decision',
      },
      {
        active: true,
        certainty: 'confirmed',
        fromId: 'target-decision',
        id: 'target-return-edge',
        kind: 'truthy',
        toId: 'target-return',
      },
      { fromId: 'target-return', id: 'child-edge', kind: 'renders', toId: 'rendered-child' },
      { fromId: 'root', id: 'sibling-edge', kind: 'renders', toId: 'active-sibling' },
      { fromId: 'root', id: 'unrelated-edge', kind: 'next', toId: 'selected-unrelated' },
    ];
    const flow = {
      fingerprint: 'flow',
      mainPathEdgeIds: ['root-shell', 'shell-target'],
      mainPathNodeIds: ['root', 'shell', 'target'],
    };
    const layout = {
      edges,
      nodeById: new Map(nodes.map((node) => [node.id, node])),
      orderedNodes: nodes,
    };
    const majorPath = createMajorPath(flow, layout, { currentFileStep: nodes[2], step: nodes[2] });
    const mainFlow = createMainFlow(flow, layout, majorPath);

    expect(majorPath.nodeIds.size).toBe(5);
    for (const nodeId of ['root', 'shell', 'target', 'target-decision', 'target-return']) {
      expect(majorPath.nodeIds.has(nodeId)).toBe(true);
    }
    expect(majorPath.nodeIds.has('rendered-child')).toBe(false);
    expect(majorPath.nodeIds.has('active-sibling')).toBe(false);
    expect(majorPath.nodeIds.has('selected-unrelated')).toBe(false);
    expect(mainFlow.graphNodes.map((node) => node.id)).toEqual([
      'root',
      'shell',
      'target',
      'target-decision',
      'target-return',
    ]);
    expect(mainFlow.graphEdges.map((edge) => [edge.id, edge.kind])).toEqual([
      ['root-shell', 'renders'],
      ['shell-target', 'component-prop'],
      ['target-decision-edge', 'next'],
      ['target-return-edge', 'truthy'],
    ]);
    const mainNodes = mainFlow.graphNodes;
    expect(
      readVisibleSelection(
        {
          nodeById: new Map(mainNodes.map((node) => [node.id, node])),
          orderedNodes: mainNodes,
        },
        'selected-unrelated',
        { currentFileStepId: 'target' },
        flow,
      ),
    ).toBe('target');

    const outcome = {
      currentFileContext: true,
      graphKind: 'return',
      id: 'outcome-ready',
      node: {},
      rank: 3,
      sourceIndex: 8,
    };
    const collectedComponent = {
      currentFileContext: true,
      graphKind: 'component',
      id: 'outcome-ready-layout',
      node: {},
      rank: 4,
      sourceIndex: 9,
    };
    const outcomeEdges = [
      ...edges,
      {
        active: true,
        certainty: 'confirmed',
        fromId: 'target',
        id: 'target-outcome-ready',
        kind: 'outcome-condition',
        toId: 'outcome-ready',
      },
      {
        active: true,
        certainty: 'confirmed',
        fromId: 'outcome-ready',
        id: 'outcome-layout',
        kind: 'renders',
        toId: 'outcome-ready-layout',
      },
    ];
    const outcomeLayout = {
      edges: outcomeEdges,
      nodeById: new Map([...nodes, outcome, collectedComponent].map((node) => [node.id, node])),
      orderedNodes: [...nodes, outcome, collectedComponent],
    };
    const outcomeFlow = {
      ...flow,
      currentFileOutcomeChoiceEdgeIds: ['target-outcome-ready'],
      currentFileOutcomeChoiceNodeIds: ['outcome-ready'],
      currentFileOutcomeEdgeIds: ['target-outcome-ready', 'outcome-layout'],
      currentFileOutcomeNodeIds: ['outcome-ready', 'outcome-ready-layout'],
    };
    const outcomeMajorPath = createMajorPath(outcomeFlow, outcomeLayout, {
      currentFileStep: nodes[2],
      step: nodes[2],
    });
    const outcomeMainFlow = createMainFlow(outcomeFlow, outcomeLayout, outcomeMajorPath);

    expect(outcomeMainFlow.graphNodes.map((node) => node.id)).toEqual([
      'root',
      'shell',
      'target',
      'outcome-ready',
    ]);
    expect(outcomeMainFlow.graphNodes.map((node) => node.id)).not.toContain('outcome-ready-layout');
  });
});
