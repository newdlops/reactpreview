/** Verifies bounded debugger-flow rank, lane, and orthogonal connector layout without a browser. */
import vm from 'node:vm';
import { describe, expect, it } from 'vitest';
import {
  createPreviewInspectorFlowchartLayoutRuntimeSource,
  PREVIEW_INSPECTOR_FLOWCHART_EDGE_LIMIT,
  PREVIEW_INSPECTOR_FLOWCHART_FOCUS_NODE_LIMIT,
  PREVIEW_INSPECTOR_FLOWCHART_LANE_LIMIT,
  PREVIEW_INSPECTOR_FLOWCHART_MAIN_NODE_LIMIT,
  PREVIEW_INSPECTOR_FLOWCHART_NODE_LIMIT,
  PREVIEW_INSPECTOR_FLOWCHART_TRACK_LIMIT,
} from '../../../../src/adapters/esbuild/pageInspector/previewInspectorFlowchartLayoutRuntimeSource';

/** Minimum explicit graph node accepted by the generated browser layout. */
interface GraphNode {
  readonly branchLabel?: string;
  readonly branchState?: 'active' | 'inactive';
  readonly currentFileContext?: boolean;
  readonly directCurrentFileBlocker?: boolean;
  readonly currentFileTarget?: boolean;
  readonly graphKind: string;
  readonly id: string;
  readonly label: string;
  readonly rank: number;
  readonly status?: string;
}

/** Minimum explicit graph edge accepted by the generated browser layout. */
interface GraphEdge {
  readonly active: boolean;
  readonly certainty: 'conditional' | 'confirmed';
  readonly fromId: string;
  readonly id: string;
  readonly kind: string;
  readonly label: string;
  readonly toId: string;
}

/** Browser-layout result fields asserted by these pure fixtures. */
interface FlowchartLayout {
  readonly edges: readonly GraphEdge[];
  readonly laneCount: number;
  readonly nodeById: Map<string, GraphNode & { readonly lane: number }>;
  readonly omittedNodeCount: number;
  readonly orderedNodes: readonly (GraphNode & { readonly lane: number })[];
  readonly rankCount: number;
  readonly transitions: readonly {
    readonly omittedCount: number;
    readonly segments: readonly {
      readonly cells: readonly { readonly lane: number; readonly path: string }[];
      readonly label: string;
      readonly sourceLane: number;
      readonly targetLane: number;
      readonly terminal: boolean;
    }[];
  }[];
  readonly truncated: boolean;
}

/** Pure Focus/Main helpers exported only from the evaluated generated browser source. */
interface FlowchartFocusRuntime {
  readonly createFocus: (
    flow: Record<string, unknown>,
    layout: FlowchartLayout,
    preferredIds: Set<string>,
    anchorIds: readonly string[],
    nodeLimit: number,
    includeIntrinsicAnchors?: boolean,
  ) => {
    readonly focusOmittedNodeCount: number;
    readonly graphEdges: readonly GraphEdge[];
    readonly graphNodes: readonly GraphNode[];
  };
  readonly createLayout: (flow: {
    readonly graphEdges: readonly GraphEdge[];
    readonly graphNodes: readonly GraphNode[];
  }) => FlowchartLayout;
  readonly neighborhood: (
    layout: FlowchartLayout,
    seedIds: readonly string[],
    radius?: number,
  ) => Set<string>;
}

/** Evaluates the generated data-only layout with no React, DOM, or project module dependency. */
function evaluateFlowchartLayout(): (flow: {
  readonly graphEdges: readonly GraphEdge[];
  readonly graphNodes: readonly GraphNode[];
}) => FlowchartLayout {
  const context: { __createLayout?: (flow: unknown) => FlowchartLayout } = {};
  vm.runInNewContext(
    `
      const isPreviewInspectorBlockerNode = (node) => node?.kind === 'blocker';
      ${createPreviewInspectorFlowchartLayoutRuntimeSource()}
      globalThis.__createLayout = createPreviewInspectorFlowchartLayout;
    `,
    context,
  );
  if (context.__createLayout === undefined) {
    throw new Error('Flowchart layout runtime fixture did not initialize.');
  }
  return context.__createLayout;
}

/** Evaluates the focus reducer alongside layout so tests exercise exact generated identities. */
function evaluateFlowchartFocusRuntime(): FlowchartFocusRuntime {
  const context: { __runtime?: FlowchartFocusRuntime } = {};
  vm.runInNewContext(
    `
      const isPreviewInspectorBlockerNode = (node) => node?.kind === 'blocker';
      ${createPreviewInspectorFlowchartLayoutRuntimeSource()}
      globalThis.__runtime = {
        createFocus: createPreviewInspectorFocusedFlowchartFlow,
        createLayout: createPreviewInspectorFlowchartLayout,
        neighborhood: createPreviewInspectorFlowchartNeighborhood,
      };
    `,
    context,
  );
  if (context.__runtime === undefined) {
    throw new Error('Flowchart focus runtime fixture did not initialize.');
  }
  return context.__runtime;
}

describe('Preview Inspector flowchart layout runtime source', () => {
  /** Keeps the selected execution branch on one lane and routes the dormant case to a side lane. */
  it('lays out true/false branches and their join as explicit orthogonal paths', () => {
    const createLayout = evaluateFlowchartLayout();
    const graphNodes: GraphNode[] = [
      { graphKind: 'entry', id: 'entry', label: 'Page()', rank: 0 },
      { graphKind: 'decision', id: 'decision', label: 'isReady', rank: 1 },
      {
        branchLabel: 'TRUE',
        branchState: 'active',
        graphKind: 'branch',
        id: 'truthy',
        label: '<Dashboard>',
        rank: 2,
      },
      {
        branchLabel: 'FALSE',
        branchState: 'inactive',
        graphKind: 'branch',
        id: 'falsy',
        label: '<Loading>',
        rank: 2,
      },
      { graphKind: 'join', id: 'join', label: 'continue', rank: 3 },
      { graphKind: 'return', id: 'return', label: 'return JSX', rank: 4 },
    ];
    const graphEdges: GraphEdge[] = [
      edge('entry-decision', 'entry', 'decision', '', true),
      edge('decision-true', 'decision', 'truthy', 'TRUE', true),
      edge('decision-false', 'decision', 'falsy', 'FALSE', false),
      edge('true-join', 'truthy', 'join', 'join', true),
      edge('false-join', 'falsy', 'join', 'join', false),
      edge('join-return', 'join', 'return', '', true),
    ];

    const layout = createLayout({ graphEdges, graphNodes });

    expect(layout.rankCount).toBe(5);
    expect(layout.laneCount).toBe(2);
    expect(layout.nodeById.get('entry')?.lane).toBe(0);
    expect(layout.nodeById.get('decision')?.lane).toBe(0);
    expect(layout.nodeById.get('truthy')?.lane).toBe(0);
    expect(layout.nodeById.get('falsy')?.lane).toBe(1);
    expect(layout.nodeById.get('join')?.lane).toBe(0);
    const decisionTransition = layout.transitions[1];
    expect(decisionTransition?.segments.map((segment) => segment.label)).toEqual(['TRUE', 'FALSE']);
    expect(decisionTransition?.segments[1]?.cells.map((cell) => cell.path)).toEqual([
      'start-down',
      'end-down',
    ]);
    expect(decisionTransition?.segments[1]).toMatchObject({
      sourceLane: 0,
      targetLane: 1,
      terminal: true,
    });
  });

  /** Retains HOC and component-slot shapes while protecting the companion from unbounded lanes. */
  it('preserves semantic node kinds and truncates an oversized parallel rank deterministically', () => {
    const createLayout = evaluateFlowchartLayout();
    const graphNodes: GraphNode[] = [
      { graphKind: 'hoc', id: 'hoc', label: 'withAuth(Page)', rank: 0 },
      { graphKind: 'component-slot', id: 'slot', label: 'Layout.content', rank: 1 },
      ...Array.from({ length: PREVIEW_INSPECTOR_FLOWCHART_LANE_LIMIT + 3 }, (_, index) => ({
        branchState: index === 0 ? ('active' as const) : ('inactive' as const),
        graphKind: 'branch',
        id: `case:${index.toString()}`,
        label: `case ${index.toString()}`,
        rank: 2,
      })),
    ];

    const layout = createLayout({
      graphEdges: [edge('hoc-slot', 'hoc', 'slot', 'component prop', true)],
      graphNodes,
    });

    expect(layout.nodeById.get('hoc')?.graphKind).toBe('hoc');
    expect(layout.nodeById.get('slot')?.graphKind).toBe('component-slot');
    expect(layout.nodeById.has('case:0')).toBe(true);
    expect(layout.laneCount).toBe(PREVIEW_INSPECTOR_FLOWCHART_LANE_LIMIT);
    expect(layout.omittedNodeCount).toBe(3);
    expect(layout.truncated).toBe(true);
  });

  /** Keeps late target and actionable blocker identities when the global node ceiling is exceeded. */
  it('retains late current-file and active blocker nodes across the global node cap', () => {
    const createLayout = evaluateFlowchartLayout();
    const ordinaryNodes = Array.from(
      { length: PREVIEW_INSPECTOR_FLOWCHART_NODE_LIMIT + 12 },
      (_, index) => ({
        graphKind: 'component',
        id: 'ordinary:' + String(index),
        label: 'Ordinary ' + String(index),
        rank: index,
      }),
    );
    const graphNodes: GraphNode[] = [
      ...ordinaryNodes,
      {
        currentFileContext: true,
        graphKind: 'return',
        id: 'current-return',
        label: 'Current return',
        rank: ordinaryNodes.length,
      },
      {
        directCurrentFileBlocker: true,
        graphKind: 'blocker',
        id: 'direct-blocker',
        label: 'Direct blocker',
        rank: ordinaryNodes.length + 1,
        status: 'ready',
      },
      {
        graphKind: 'blocker',
        id: 'active-blocker',
        label: 'Active blocker',
        rank: ordinaryNodes.length + 2,
        status: 'active',
      },
      {
        currentFileContext: true,
        currentFileTarget: true,
        graphKind: 'component',
        id: 'exact-target',
        label: 'Current file',
        rank: ordinaryNodes.length + 3,
      },
    ];

    const layout = createLayout({ graphEdges: [], graphNodes });

    expect(layout.orderedNodes).toHaveLength(PREVIEW_INSPECTOR_FLOWCHART_NODE_LIMIT);
    expect(layout.nodeById.has('exact-target')).toBe(true);
    expect(layout.nodeById.has('direct-blocker')).toBe(true);
    expect(layout.nodeById.has('active-blocker')).toBe(true);
    expect(layout.nodeById.has('current-return')).toBe(true);
    expect(layout.nodeById.has('ordinary:139')).toBe(false);
    expect(layout.truncated).toBe(true);
  });

  /** Applies the same priority inside one oversized parallel rank before allocating bounded lanes. */
  it('retains current-file and actionable nodes when one rank exceeds the lane cap', () => {
    const createLayout = evaluateFlowchartLayout();
    const ordinaryNodes: GraphNode[] = Array.from(
      { length: PREVIEW_INSPECTOR_FLOWCHART_LANE_LIMIT + 8 },
      (_, index) => ({
        branchState: 'inactive',
        graphKind: 'branch',
        id: 'parallel:' + String(index),
        label: 'Parallel ' + String(index),
        rank: 0,
      }),
    );
    const graphNodes: GraphNode[] = [
      ...ordinaryNodes,
      {
        currentFileContext: true,
        currentFileTarget: true,
        graphKind: 'component',
        id: 'parallel-target',
        label: 'Current file',
        rank: 0,
      },
      {
        directCurrentFileBlocker: true,
        graphKind: 'blocker',
        id: 'parallel-direct',
        label: 'Direct blocker',
        rank: 0,
      },
      {
        graphKind: 'blocker',
        id: 'parallel-active',
        label: 'Active blocker',
        rank: 0,
        status: 'active',
      },
    ];

    const layout = createLayout({ graphEdges: [], graphNodes });

    expect(layout.laneCount).toBe(PREVIEW_INSPECTOR_FLOWCHART_LANE_LIMIT);
    expect(layout.nodeById.has('parallel-target')).toBe(true);
    expect(layout.nodeById.has('parallel-direct')).toBe(true);
    expect(layout.nodeById.has('parallel-active')).toBe(true);
    expect(layout.nodeById.has('parallel:39')).toBe(false);
  });

  /** Reduces a 121-node route to exact 2-hop Focus and bridged 24-node Main views. */
  it('builds bounded Focus/Main views without replacing real step identities', () => {
    const runtime = evaluateFlowchartFocusRuntime();
    const graphNodes: GraphNode[] = Array.from({ length: 121 }, (_, index) => ({
      currentFileTarget: index === 120,
      graphKind: index === 0 ? 'entry' : 'component',
      id: 'step:' + String(index),
      label: 'Step ' + String(index),
      rank: index,
    }));
    const graphEdges = graphNodes
      .slice(1)
      .map((node, index) =>
        edge('edge:' + String(index), 'step:' + String(index), node.id, '', true),
      );
    const flow = { fingerprint: 'large-flow', graphEdges, graphNodes };
    const completeLayout = runtime.createLayout(flow);
    const neighborhood = runtime.neighborhood(completeLayout, ['step:60'], 2);
    const focus = runtime.createFocus(
      flow,
      completeLayout,
      neighborhood,
      ['step:60'],
      PREVIEW_INSPECTOR_FLOWCHART_FOCUS_NODE_LIMIT,
      false,
    );

    expect(focus.graphNodes.map((node) => node.id)).toEqual([
      'step:58',
      'step:59',
      'step:60',
      'step:61',
      'step:62',
    ]);
    expect(focus.focusOmittedNodeCount).toBe(116);
    expect(focus.graphNodes.every((node) => completeLayout.nodeById.get(node.id) === node)).toBe(
      true,
    );

    const main = runtime.createFocus(
      flow,
      completeLayout,
      new Set(graphNodes.map((node) => node.id)),
      ['step:120'],
      PREVIEW_INSPECTOR_FLOWCHART_MAIN_NODE_LIMIT,
    );
    expect(main.graphNodes).toHaveLength(PREVIEW_INSPECTOR_FLOWCHART_MAIN_NODE_LIMIT);
    expect(main.graphNodes.some((node) => node.id === 'step:0')).toBe(true);
    expect(main.graphNodes.some((node) => node.id === 'step:120')).toBe(true);
    expect(main.graphEdges.some((candidate) => candidate.kind === 'focus-bridge')).toBe(true);
    expect(main.focusOmittedNodeCount).toBe(97);
  });

  /** Documents the explicit resource ceilings used by large switch/case and wrapper graphs. */
  it('emits stable graph resource limits', () => {
    expect(PREVIEW_INSPECTOR_FLOWCHART_NODE_LIMIT).toBe(128);
    expect(PREVIEW_INSPECTOR_FLOWCHART_EDGE_LIMIT).toBe(256);
    expect(PREVIEW_INSPECTOR_FLOWCHART_FOCUS_NODE_LIMIT).toBe(10);
    expect(PREVIEW_INSPECTOR_FLOWCHART_LANE_LIMIT).toBe(32);
    expect(PREVIEW_INSPECTOR_FLOWCHART_MAIN_NODE_LIMIT).toBe(24);
    expect(PREVIEW_INSPECTOR_FLOWCHART_TRACK_LIMIT).toBe(8);
  });
});

/** Creates one explicit forward graph edge with a readable branch label. */
function edge(id: string, fromId: string, toId: string, label: string, active: boolean): GraphEdge {
  return {
    active,
    certainty: 'confirmed',
    fromId,
    id,
    kind: label.toLowerCase() || 'next',
    label,
    toId,
  };
}
