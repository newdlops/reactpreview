/** Verifies generated advanced render diagnostics without mounting project React components. */
import vm from 'node:vm';
import { describe, expect, it } from 'vitest';
import { createPreviewInspectorFlowchartInspectorUiRuntimeSource } from '../../../../src/adapters/esbuild/pageInspector/previewInspectorFlowchartInspectorUiRuntimeSource';

/** Minimum graph step consumed by locator and relationship behavior fixtures. */
interface InspectorGraphStep {
  readonly branchState?: 'active' | 'inactive';
  readonly currentFileTarget?: boolean;
  readonly directCurrentFileBlocker?: boolean;
  readonly graphKind?: string;
  readonly id: string;
  readonly label: string;
  readonly node?: {
    readonly blockerKind?: string;
    readonly contextOnly?: boolean;
    readonly currentFileExport?: boolean;
    readonly mounted?: boolean;
  };
}

/** Minimum explicit edge used to verify adjacent-step navigation order. */
interface InspectorGraphEdge {
  readonly active: boolean;
  readonly certainty: 'conditional' | 'confirmed';
  readonly fromId: string;
  readonly id: string;
  readonly kind: string;
  readonly label: string;
  readonly toId: string;
}

/** Normalized current-file location returned by the generated pure helper. */
interface InspectorLocatorResult {
  readonly currentFileStep?: InspectorGraphStep;
  readonly detail?: string;
  readonly nearestBlockerStep?: InspectorGraphStep;
  readonly status: 'absent' | 'blocked' | 'estimated' | 'located';
}

/** Bounded adjacent relationship returned by the generated pure helper. */
interface InspectorRelation {
  readonly edge: InspectorGraphEdge;
  readonly step: InspectorGraphStep;
}

/** Pure generated functions exposed only inside this test VM. */
interface InspectorRuntime {
  readonly isCurrentFile: (step: InspectorGraphStep) => boolean;
  readonly normalizeLocator: (
    locator: Record<string, unknown> | undefined,
    layout: InspectorLayout,
  ) => InspectorLocatorResult;
  readonly readRelations: (
    layout: InspectorLayout,
    step: InspectorGraphStep,
    direction: 'predecessor' | 'successor',
  ) => readonly InspectorRelation[];
}

/** Data-only layout surface shared with the generated flowchart UI. */
interface InspectorLayout {
  readonly edges: readonly InspectorGraphEdge[];
  readonly nodeById: Map<string, InspectorGraphStep>;
  readonly orderedNodes: readonly InspectorGraphStep[];
}

describe('Preview Inspector flowchart Inspector UI runtime source', () => {
  /** Leads with simple choices while retaining selected identity, source, and relations as diagnostics. */
  it('renders simple setup before disclosed graph diagnostics without raw editors', () => {
    const source = createPreviewInspectorFlowchartInspectorUiRuntimeSource();

    expect(() => new vm.Script(source)).not.toThrow();
    expect(source).toContain('function PreviewInspectorFlowchartInspector({');
    expect(source).toContain("'aria-label': 'Advanced render diagnostics'");
    expect(source).toContain("'ADVANCED RENDER DIAGNOSTICS'");
    expect(source).toContain("collapsed === true ? 'Diagnostics' : '×'");
    expect(source).toContain('React.createElement(PreviewInspectorSimpleResolver');
    expect(source).toContain('function PreviewInspectorFlowchartDiagnostics');
    expect(source).toContain(
      "React.createElement('summary', undefined, 'Selected graph diagnostics')",
    );
    expect(source).toContain('function PreviewInspectorFlowchartSelectedSummary');
    expect(source).toContain('formatPreviewInspectorFlowchartGraphKind(selectedStep.graphKind)');
    expect(source).toContain('formatPreviewInspectorFlowchartInspectorStatus(selectedStep)');
    expect(source).toContain("return 'ACTIVE PATH'");
    expect(source).toContain("return 'DORMANT PATH'");
    expect(source).toContain("'CURRENT FILE'");
    expect(source).toContain("'CURRENT FILE BLOCKER'");
    expect(source).toContain(
      'React.createElement(PreviewInspectorSourceDetail, { node: sourceNode })',
    );
    expect(source).not.toContain('React.createElement(PreviewInspectorRenderFlowConditionSwitch');
    expect(source).not.toContain('React.createElement(PreviewInspectorRenderFlowNodeEditor');
    expect(source).toContain("direction: 'predecessor'");
    expect(source).toContain("direction: 'successor'");
  });

  /** Teaches one stable locate workflow and gives distinct advice for located, blocked, and absent targets. */
  it('provides a four-pass current-file guide with honest target-absence recovery', () => {
    const source = createPreviewInspectorFlowchartInspectorUiRuntimeSource();

    expect(source).toContain("'CURRENT FILE PATH'");
    for (const title of ['Locate', 'Trace', 'Resolve', 'Verify']) {
      expect(source).toContain(`['${title}',`);
    }
    expect(source).toContain('Current file has not mounted yet. The closest proven blocker is ');
    expect(source).toContain('Resolve the highlighted blocker, then press Current file again.');
    expect(source).toContain(
      'Try another Page path or use the File components view; this authored outcome may not contain the file.',
    );
    expect(source).toContain(
      "locator.status === 'located' ? 'Select current file' : 'Select nearest blocker'",
    );
    expect(source).not.toContain('selectPreviewInspectorUiNode(');
  });

  /** Keeps the path tutorial and graph relationships inside the diagnostics disclosure. */
  it('uses native progressive disclosure for selected graph details', () => {
    const source = createPreviewInspectorFlowchartInspectorUiRuntimeSource();

    expect(source).toContain("React.createElement('summary', undefined, 'How path tracing works')");
    expect(source).toContain('function PreviewInspectorFlowchartAdvancedRelations');
    expect(source).toContain("React.createElement('strong', undefined, 'Path relationships')");
    expect(source).not.toContain("'CURRENT BLOCKER'");
    expect(source).not.toContain("'NEXT ACTION'");
  });

  /** Distinguishes mounted and static current-file evidence from a path blocker or absent target. */
  it('normalizes mounted, estimated, blocked, and absent current-file results honestly', () => {
    const runtime = evaluateInspectorRuntime();
    const entry = step('entry', 'ApplicationEntry');
    const unmountedTarget = {
      ...step('unmounted-target', 'CurrentPage', {
        contextOnly: false,
        currentFileExport: true,
        mounted: false,
      }),
      graphKind: 'entry',
    };
    const blocker = step('blocker', 'Target not reached', {
      blockerKind: 'target-reachability',
    });
    const target = {
      ...step('target', 'CurrentPage', {
        contextOnly: false,
        currentFileExport: true,
        mounted: true,
      }),
      currentFileTarget: true,
    };

    expect(runtime.isCurrentFile(unmountedTarget)).toBe(true);
    expect(runtime.isCurrentFile(target)).toBe(true);

    const estimatedLayout = layout([entry, unmountedTarget, blocker]);
    const estimated = runtime.normalizeLocator(undefined, estimatedLayout);
    expect(estimated.status).toBe('estimated');
    expect(estimated.currentFileStep?.id).toBe('unmounted-target');
    expect(estimated.nearestBlockerStep?.id).toBe('blocker');

    const located = runtime.normalizeLocator(undefined, layout([entry, target, blocker]));
    expect(located.status).toBe('located');
    expect(located.currentFileStep?.id).toBe('target');

    const blocked = runtime.normalizeLocator(undefined, layout([entry, blocker]));
    expect(blocked.status).toBe('blocked');
    expect(blocked.currentFileStep).toBeUndefined();
    expect(blocked.nearestBlockerStep?.id).toBe('blocker');

    const absent = runtime.normalizeLocator(undefined, layout([entry]));
    expect(absent.status).toBe('absent');
    expect(absent.currentFileStep).toBeUndefined();
    expect(absent.nearestBlockerStep).toBeUndefined();
  });

  /** Resolves ID-based locator results and preserves an adapter-provided bounded explanation. */
  it('accepts locator identities without trusting detached step objects', () => {
    const runtime = evaluateInspectorRuntime();
    const target = { ...step('target', 'CurrentPage'), currentFileTarget: true };
    const graphLayout = layout([target]);
    const detached = { ...target, label: 'Detached and stale' };

    const result = runtime.normalizeLocator(
      {
        currentFileStep: detached,
        currentFileStepId: 'target',
        detail: 'Source-backed route target.',
        status: 'located',
      },
      graphLayout,
    );

    expect(result.currentFileStep).toBe(target);
    expect(result.currentFileStep?.label).toBe('CurrentPage');
    expect(result.detail).toBe('Source-backed route target.');
  });

  /** Orders active graph neighbors first and applies the same resource bound in both directions. */
  it('returns deterministic bounded predecessor and successor navigation', () => {
    const runtime = evaluateInspectorRuntime();
    const selected = step('selected', 'Selected');
    const neighbors = Array.from({ length: 14 }, (_, index) =>
      step(`neighbor-${index.toString()}`, `Neighbor ${index.toString()}`),
    );
    const graphLayout = layout(
      [selected, ...neighbors],
      neighbors.map((neighbor, index) => ({
        active: index === 13,
        certainty: 'confirmed',
        fromId: selected.id,
        id: `edge-${index.toString().padStart(2, '0')}`,
        kind: 'renders',
        label: '',
        toId: neighbor.id,
      })),
    );

    const successors = runtime.readRelations(graphLayout, selected, 'successor');

    expect(successors).toHaveLength(12);
    expect(successors[0]?.step.id).toBe('neighbor-13');
    expect(successors.every((relation) => relation.edge.fromId === selected.id)).toBe(true);
  });
});

/** Evaluates data-only generated helpers while leaving React presentation functions uncalled. */
function evaluateInspectorRuntime(): InspectorRuntime {
  const context: { __inspectorRuntime?: InspectorRuntime } = {};
  vm.runInNewContext(
    createPreviewInspectorFlowchartInspectorUiRuntimeSource() +
      '\nglobalThis.__inspectorRuntime = {' +
      ' isCurrentFile: isPreviewInspectorFlowchartCurrentFileStep,' +
      ' normalizeLocator: normalizePreviewInspectorFlowchartLocator,' +
      ' readRelations: readPreviewInspectorFlowchartInspectorRelations' +
      '};',
    context,
  );
  if (context.__inspectorRuntime === undefined) {
    throw new Error('Flowchart Inspector runtime fixture did not initialize.');
  }
  return context.__inspectorRuntime;
}

/** Creates one graph step with optional underlying component/blocker evidence. */
function step(id: string, label: string, node?: InspectorGraphStep['node']): InspectorGraphStep {
  return { id, label, ...(node === undefined ? {} : { node }) };
}

/** Creates the exact data-only layout surface used by the generated Inspector helpers. */
function layout(
  orderedNodes: readonly InspectorGraphStep[],
  edges: readonly InspectorGraphEdge[] = [],
): InspectorLayout {
  return {
    edges,
    nodeById: new Map(orderedNodes.map((node) => [node.id, node])),
    orderedNodes,
  };
}
