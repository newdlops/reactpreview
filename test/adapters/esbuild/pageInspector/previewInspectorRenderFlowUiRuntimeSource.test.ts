/** Verifies the data-only JSX function/condition/return flow without mounting project React code. */
import vm from 'node:vm';
import { describe, expect, it } from 'vitest';
import {
  createPreviewInspectorRenderFlowUiRuntimeSource,
  PREVIEW_INSPECTOR_RENDER_FLOW_OUTPUT_DEPTH_LIMIT,
  PREVIEW_INSPECTOR_RENDER_FLOW_STEP_LIMIT,
} from '../../../../src/adapters/esbuild/pageInspector/previewInspectorRenderFlowUiRuntimeSource';

/** Minimal enriched tree record accepted by the generated render-flow model. */
interface RenderNode {
  readonly blocker?: Record<string, unknown>;
  readonly blockerKind?: string;
  readonly children: readonly RenderNode[];
  readonly choice?: Record<string, unknown>;
  readonly condition?: Record<string, unknown>;
  readonly contextOnly?: boolean;
  readonly currentFileExport?: boolean;
  readonly exportName?: string;
  readonly id: string;
  readonly invocation?: {
    readonly calleeName?: string;
    readonly factoryNames?: readonly string[];
    readonly mode?: string;
    readonly slotName?: string;
    readonly sourcePath?: string;
  };
  readonly kind: string;
  readonly mounted?: boolean;
  readonly name: string;
  readonly source?: { readonly line?: number; readonly path?: string };
}

/** One explanatory or actionable node returned by the generated flow model. */
interface RenderStep {
  readonly branchState?: 'active' | 'inactive';
  readonly currentFileContext?: boolean;
  readonly directCurrentFileBlocker?: boolean;
  readonly editable: boolean;
  readonly flowKind:
    | 'branch-outcome'
    | 'component-call'
    | 'component-context'
    | 'flow-join'
    | 'render-logic'
    | 'render-return';
  readonly graphKind:
    | 'blocker'
    | 'branch'
    | 'component'
    | 'component-slot'
    | 'decision'
    | 'entry'
    | 'hoc'
    | 'join'
    | 'return';
  readonly id: string;
  readonly currentFileTarget?: boolean;
  readonly kind: 'blocker' | 'branch' | 'component' | 'condition' | 'join' | 'return';
  readonly label: string;
  readonly level: number;
  readonly node: RenderNode;
  readonly ownerIds: readonly string[];
  readonly ownerNames: readonly string[];
  readonly predecessorIds: readonly string[];
}

/** Render-flow surface retaining the underlying blocker progress model unchanged. */
interface RenderFlow {
  readonly activeStepId?: string;
  readonly currentFileTargetNodeId?: string;
  readonly currentFileTargetStepId?: string;
  readonly directCurrentFileBlockerCount: number;
  readonly fingerprint: string;
  readonly graphEdges: readonly {
    readonly active: boolean;
    readonly fromId: string;
    readonly kind: string;
    readonly label?: string;
    readonly toId: string;
  }[];
  readonly graphNodes: readonly RenderStep[];
  readonly renderStages: number;
  readonly renderStepById: Map<string, RenderStep>;
  readonly renderSteps: readonly RenderStep[];
  readonly renderTruncated: boolean;
  readonly resolvedCount: number;
  readonly steps: readonly unknown[];
  readonly targetPathIds: readonly string[];
  readonly unresolvedCount: number;
}

/** Pure generated fixture API. */
interface RenderFlowRuntime {
  readonly createFlow: (snapshot: { readonly roots: readonly RenderNode[] }) => RenderFlow;
}

/** Creates one component node with deterministic render/source identities. */
function component(
  id: string,
  name: string,
  children: readonly RenderNode[],
  metadata: Partial<RenderNode> = {},
): RenderNode {
  return {
    children,
    id,
    kind: 'function',
    name,
    source: { line: 1, path: `/src/${name}.tsx` },
    ...metadata,
  };
}

/** Creates one compiler-instrumented JSX decision whose pseudo-node ID is graph-stable. */
function condition(id: string, expression: string, enabled: boolean, line: number): RenderNode {
  return {
    children: [],
    condition: {
      authoredEnabled: enabled,
      effectiveEnabled: enabled,
      expression,
      falsyLabel: '<LoginPage>',
      kind: 'ternary',
      line,
      truthyLabel: '<Dashboard>',
    },
    id,
    kind: 'condition',
    name: expression,
    source: { line, path: '/src/Application.tsx' },
  };
}

/** Creates one runtime blocker with explicit source evidence for ownership-boundary tests. */
function runtimeBlocker(id: string, name: string, sourcePath: string): RenderNode {
  return {
    blocker: { sourcePath },
    blockerKind: 'runtime-fallback',
    children: [],
    id,
    kind: 'blocker',
    name,
    source: { line: 1, path: sourcePath },
  };
}

describe('Preview Inspector JSX render-flow model', () => {
  /** Models the exact user-facing function → logic → return → child sequence. */
  it('joins the root-to-current-file corridor with selected return output and child calls', () => {
    const runtime = evaluateRenderFlowRuntime();
    const auth = condition('condition:auth', 'authenticated ? Dashboard : LoginPage', true, 8);
    const chart = component('chart', 'Chart', []);
    const toolbar = component('toolbar', 'Toolbar', []);
    const target = component('target', 'Dashboard', [chart, toolbar], {
      currentFileExport: true,
      exportName: 'Dashboard',
      mounted: true,
    });
    const app = component('app', 'Application', [target, auth]);

    const flow = runtime.createFlow({ roots: [app] });

    expect(flow.targetPathIds).toEqual(['app', 'target']);
    expect(flow.renderSteps.map((step) => step.id)).toEqual([
      'render-entry:app',
      'condition:auth',
      'render-branch:condition:auth:truthy',
      'render-branch:condition:auth:truthy:call:0',
      'render-branch:condition:auth:falsy',
      'render-branch:condition:auth:falsy:call:0',
      'render-join:condition:auth',
      'render-return:app',
      'render-entry:target',
      'render-return:target',
      'render-entry:chart',
      'render-return:chart',
      'render-entry:toolbar',
      'render-return:toolbar',
    ]);
    expect(flow.renderStepById.get('condition:auth')).toMatchObject({
      editable: true,
      flowKind: 'render-logic',
      kind: 'condition',
      predecessorIds: ['render-entry:app'],
    });
    expect(flow.renderStepById.get('render-return:app')).toMatchObject({
      editable: false,
      flowKind: 'render-return',
      graphKind: 'return',
      kind: 'return',
      label: 'return · <Dashboard>',
      predecessorIds: ['render-join:condition:auth'],
      status: 'context',
    });
    expect(flow.graphEdges).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          active: true,
          fromId: 'condition:auth',
          kind: 'truthy',
          label: 'TRUE',
          toId: 'render-branch:condition:auth:truthy',
        }),
        expect.objectContaining({
          active: false,
          fromId: 'condition:auth',
          kind: 'falsy',
          label: 'FALSE',
          toId: 'render-branch:condition:auth:falsy',
        }),
      ]),
    );
    expect(flow.graphNodes).toBe(flow.renderSteps);
    expect(flow.renderStepById.get('render-entry:chart')?.predecessorIds).toEqual([
      'render-return:target',
    ]);
    expect(flow.renderStepById.get('render-entry:toolbar')?.predecessorIds).toEqual([
      'render-return:target',
    ]);
    expect(flow.renderStepById.get('render-entry:chart')?.level).toBe(
      flow.renderStepById.get('render-entry:toolbar')?.level,
    );
  });

  /** Marks only the exact selected function entry while retaining its internal steps as context. */
  it('distinguishes the exact mounted current-file entry from its decision and return context', () => {
    const runtime = evaluateRenderFlowRuntime();
    const targetDecision: RenderNode = {
      ...condition('condition:mode', 'mode ? Primary : Secondary', true, 14),
      source: { line: 14, path: '/src/Dashboard.tsx' },
    };
    const target = component('target', 'Dashboard', [targetDecision], {
      currentFileExport: true,
      exportName: 'Dashboard',
      mounted: true,
    });

    const flow = runtime.createFlow({ roots: [target] });

    expect(flow.currentFileTargetNodeId).toBe('target');
    expect(flow.currentFileTargetStepId).toBe('render-entry:target');
    expect(flow.renderStepById.get('render-entry:target')).toMatchObject({
      currentFileContext: true,
      currentFileTarget: true,
    });
    expect(flow.renderStepById.get('condition:mode')).toMatchObject({
      currentFileContext: true,
    });
    expect(flow.renderStepById.get('condition:mode')?.currentFileTarget).toBeUndefined();
    expect(flow.renderStepById.get('render-return:target')).toMatchObject({
      currentFileContext: true,
    });
    expect(flow.renderStepById.get('render-return:target')?.currentFileTarget).toBeUndefined();

    const wrongSource = runtime.createFlow({
      roots: [
        component('wrong-source', 'Dashboard', [], {
          currentFileExport: true,
          exportName: 'Dashboard',
          mounted: true,
          source: { path: '/src/ImportedDashboard.tsx' },
        }),
      ],
    });
    const unmounted = runtime.createFlow({
      roots: [
        component('unmounted', 'Dashboard', [], {
          currentFileExport: true,
          exportName: 'Dashboard',
          mounted: false,
        }),
      ],
    });
    expect(wrongSource.currentFileTargetStepId).toBeUndefined();
    expect(unmounted.currentFileTargetStepId).toBeUndefined();
  });

  /** Leaves actionable progress owned by the blocker model while adding read-only path context. */
  it('does not count component and return context as resolved blockers', () => {
    const sessionBlocker = {
      children: [],
      id: 'blocker:session',
      kind: 'blocker',
      name: 'Session value required',
    };
    const blockerStep = {
      current: true,
      id: sessionBlocker.id,
      level: 0,
      node: sessionBlocker,
      ownerIds: [],
      ownerNames: [],
      predecessorIds: [],
      resolution: 'pending',
      status: 'active',
    };
    const runtime = evaluateRenderFlowRuntime({
      activeStepId: 'blocker:session',
      resolvedCount: 1,
      stepById: new Map([[sessionBlocker.id, blockerStep]]),
      steps: [blockerStep, { id: 'blocker:data' }],
      unresolvedCount: 1,
    });
    const target = component('target', 'Dashboard', [], {
      currentFileExport: true,
      exportName: 'Dashboard',
      mounted: true,
    });

    const flow = runtime.createFlow({ roots: [target] });

    expect(flow.steps).toHaveLength(2);
    expect(flow.resolvedCount).toBe(1);
    expect(flow.unresolvedCount).toBe(1);
    expect(flow.activeStepId).toBe('blocker:session');
    expect(flow.renderSteps.map((step) => step.kind)).toEqual(['component', 'return', 'blocker']);
    expect(flow.renderStepById.get('blocker:session')).toMatchObject({
      editable: true,
      predecessorIds: [],
      status: 'active',
    });
  });

  /** Highlights only a live unresolved blocker owned by the selected file, not adjacent records. */
  it('identifies direct current-file blockers without leaking across owner or source boundaries', () => {
    const ancestor = runtimeBlocker('blocker:ancestor', 'Ancestor session', '/src/Application.tsx');
    const direct = runtimeBlocker('blocker:direct', 'Dashboard data', '/src/Dashboard.tsx');
    const imported = runtimeBlocker('blocker:imported', 'Imported child data', '/src/Chart.tsx');
    const resolved = runtimeBlocker(
      'blocker:resolved',
      'Resolved dashboard data',
      '/src/Dashboard.tsx',
    );
    const sourceUnknown = runtimeBlocker('blocker:source-unknown', 'Unknown owner value', '');
    const reachability: RenderNode = {
      ...runtimeBlocker('blocker:reachability', 'Target path not reached', '/src/Dashboard.tsx'),
      blockerKind: 'target-reachability',
    };
    const steps = [
      blockerFlowStep(ancestor, ['app'], ['Application'], 'pending'),
      blockerFlowStep(direct, ['app', 'target'], ['Application', 'Dashboard'], 'pending'),
      blockerFlowStep(imported, ['app', 'target'], ['Application', 'Dashboard'], 'pending'),
      blockerFlowStep(resolved, ['app', 'target'], ['Application', 'Dashboard'], 'resolved'),
      blockerFlowStep(sourceUnknown, ['app', 'target'], ['Application', 'Dashboard'], 'pending'),
      blockerFlowStep(reachability, ['app', 'target'], ['Application', 'Dashboard'], 'pending'),
    ];
    const runtime = evaluateRenderFlowRuntime({
      stepById: new Map(steps.map((step) => [step.id, step])),
      steps,
      unresolvedCount: 5,
    });
    const target = component(
      'target',
      'Dashboard',
      [direct, imported, resolved, sourceUnknown, reachability],
      {
        currentFileExport: true,
        exportName: 'Dashboard',
        mounted: true,
      },
    );
    const app = component('app', 'Application', [ancestor, target]);

    const flow = runtime.createFlow({ roots: [app] });

    expect(flow.targetPathIds).toEqual(['app', 'target']);
    expect(flow.directCurrentFileBlockerCount).toBe(1);
    expect(flow.renderStepById.get(direct.id)).toMatchObject({
      directCurrentFileBlocker: true,
      ownerIds: ['app', 'target'],
    });
    expect(flow.renderStepById.get(ancestor.id)?.directCurrentFileBlocker).toBeUndefined();
    expect(flow.renderStepById.get(imported.id)?.directCurrentFileBlocker).toBeUndefined();
    expect(flow.renderStepById.get(resolved.id)?.directCurrentFileBlocker).toBeUndefined();
    expect(flow.renderStepById.get(sourceUnknown.id)?.directCurrentFileBlocker).toBeUndefined();
    expect(flow.renderStepById.get(reachability.id)?.directCurrentFileBlocker).toBeUndefined();
  });

  /** Never promotes blocker cards below an inert current-file export inventory entry. */
  it('does not highlight blockers on an unmounted current-file export', () => {
    const blocker = runtimeBlocker('blocker:unmounted', 'Unmounted data', '/src/Dashboard.tsx');
    const step = blockerFlowStep(blocker, ['target'], ['Dashboard'], 'pending');
    const runtime = evaluateRenderFlowRuntime({
      stepById: new Map([[step.id, step]]),
      steps: [step],
      unresolvedCount: 1,
    });
    const target = component('target', 'Dashboard', [blocker], {
      currentFileExport: true,
      exportName: 'Dashboard',
      mounted: false,
    });

    const flow = runtime.createFlow({ roots: [target] });

    expect(flow.targetPathIds).toEqual(['target']);
    expect(flow.directCurrentFileBlockerCount).toBe(0);
    expect(flow.renderStepById.get(blocker.id)?.directCurrentFileBlocker).toBeUndefined();
  });

  /** Keeps inert entry/route evidence in the corridor without fabricating an executed return. */
  it('does not claim a JSX return for static context-only path evidence', () => {
    const runtime = evaluateRenderFlowRuntime();
    const target = component('target', 'Dashboard', [], {
      currentFileExport: true,
      exportName: 'Dashboard',
      mounted: false,
    });
    const inventory = component('inventory', 'Unmounted current-file exports', [target], {
      contextOnly: true,
    });

    const flow = runtime.createFlow({ roots: [inventory] });

    expect(flow.renderSteps.map((step) => step.id)).toEqual([
      'render-entry:inventory',
      'render-entry:target',
      'render-return:target',
    ]);
    expect(flow.renderStepById.has('render-return:inventory')).toBe(false);
    expect(flow.renderStepById.get('render-entry:target')?.predecessorIds).toEqual([
      'render-entry:inventory',
    ]);
  });

  /** Represents switch cases, default, their component calls, and convergence without flattening. */
  it('keeps switch case branches and the selected path as labeled graph edges', () => {
    const runtime = evaluateRenderFlowRuntime();
    const selectedCase: RenderNode = {
      children: [],
      choice: {
        branches: [
          { calls: ['AlphaPanel'], id: 'case-alpha', label: 'case alpha' },
          { calls: ['BetaBoundary'], id: 'case-beta', label: 'case beta' },
          { calls: [], default: true, id: 'default', label: 'default' },
        ],
        effectiveBranchId: 'case-beta',
        expression: 'variant',
        kind: 'switch',
      },
      id: 'condition:variant',
      kind: 'render-choice',
      name: 'switch (variant)',
      source: { line: 4, path: '/src/Dashboard.tsx' },
    };
    const target = component('target', 'Dashboard', [selectedCase], {
      currentFileExport: true,
      exportName: 'Dashboard',
      mounted: true,
    });

    const flow = runtime.createFlow({ roots: [target] });

    const caseEdges = flow.graphEdges.filter((edge) => edge.fromId === 'condition:variant');
    expect(caseEdges).toEqual([
      expect.objectContaining({ active: false, kind: 'case', label: 'case alpha' }),
      expect.objectContaining({ active: true, kind: 'case', label: 'case beta' }),
      expect.objectContaining({ active: false, kind: 'default', label: 'default' }),
    ]);
    expect(
      flow.renderStepById.get('render-branch:condition:variant:case-beta:call:0'),
    ).toMatchObject({
      branchState: 'active',
      graphKind: 'component',
      label: 'BetaBoundary',
    });
    expect(flow.renderStepById.get('render-join:condition:variant')).toMatchObject({
      graphKind: 'join',
      predecessorIds: [
        'render-branch:condition:variant:case-alpha:call:0',
        'render-branch:condition:variant:case-beta:call:0',
        'render-branch:condition:variant:default',
      ],
    });
  });

  /** Reserves the late selected entry and its direct blocker before branch detail fills the cap. */
  it('retains a late exact target and direct blocker in an oversized ancestor render graph', () => {
    const direct = runtimeBlocker('blocker:direct-late', 'Dashboard data', '/src/Dashboard.tsx');
    const directStep = blockerFlowStep(
      direct,
      ['app', 'target'],
      ['Application', 'Dashboard'],
      'pending',
    );
    const runtime = evaluateRenderFlowRuntime({
      activeStepId: direct.id,
      stepById: new Map([[direct.id, directStep]]),
      steps: [directStep],
      unresolvedCount: 1,
    });
    const ancestorConditions = Array.from({ length: 48 }, (_, index) =>
      condition(
        'condition:ancestor-' + String(index),
        'gate' + String(index),
        index % 2 === 0,
        index + 2,
      ),
    );
    const target = component('target', 'Dashboard', [direct], {
      currentFileExport: true,
      exportName: 'Dashboard',
      mounted: true,
    });
    const app = component('app', 'Application', [...ancestorConditions, target]);

    const flow = runtime.createFlow({ roots: [app] });

    expect(flow.renderSteps).toHaveLength(PREVIEW_INSPECTOR_RENDER_FLOW_STEP_LIMIT);
    expect(flow.renderTruncated).toBe(true);
    expect(flow.renderStepById.get('render-entry:target')).toMatchObject({
      currentFileTarget: true,
    });
    expect(flow.renderStepById.get(direct.id)).toMatchObject({
      directCurrentFileBlocker: true,
      status: 'active',
    });
  });

  /** Invalidates layout memoization when presentation or structural graph evidence changes. */
  it('fingerprints labels, ranks, source evidence, invocations, and explicit edges', () => {
    const runtime = evaluateRenderFlowRuntime();
    const createSnapshot = (
      name: string,
      sourcePath: string,
      slotName: string,
      conditions: readonly RenderNode[] = [],
    ): { readonly roots: readonly RenderNode[] } => ({
      roots: [
        component('app', 'Application', [
          ...conditions,
          component('target', name, [], {
            currentFileExport: true,
            exportName: 'Dashboard',
            invocation: {
              calleeName: 'Layout',
              mode: 'component-prop',
              slotName,
              sourcePath: '/src/Layout.tsx',
            },
            mounted: true,
            source: { line: 5, path: sourcePath },
          }),
        ]),
      ],
    });
    const fingerprints = [
      runtime.createFlow(createSnapshot('Dashboard', '/src/Dashboard.tsx', 'content')).fingerprint,
      runtime.createFlow(createSnapshot('DashboardView', '/src/Dashboard.tsx', 'content'))
        .fingerprint,
      runtime.createFlow(createSnapshot('Dashboard', '/src/Alternate.tsx', 'content')).fingerprint,
      runtime.createFlow(createSnapshot('Dashboard', '/src/Dashboard.tsx', 'sidebar')).fingerprint,
      runtime.createFlow(
        createSnapshot('Dashboard', '/src/Dashboard.tsx', 'content', [
          condition('condition:rank', 'ready', true, 2),
        ]),
      ).fingerprint,
    ];

    expect(new Set(fingerprints).size).toBe(fingerprints.length);
    const source = createPreviewInspectorRenderFlowUiRuntimeSource();
    expect(source).toContain(
      'createPreviewInspectorRenderFlowFingerprint(state.steps, graphEdges)',
    );
    expect(source).toContain('step.rank ?? step.level');
    expect(source).toContain('invocation?.sourcePath');
    expect(source).toContain('edge.fromId');
  });

  /** Documents the bounded expansion contract used for large mounted component subtrees. */
  it('emits explicit graph limits and function-to-JSX metadata', () => {
    const source = createPreviewInspectorRenderFlowUiRuntimeSource();

    expect(PREVIEW_INSPECTOR_RENDER_FLOW_STEP_LIMIT).toBe(128);
    expect(PREVIEW_INSPECTOR_RENDER_FLOW_OUTPUT_DEPTH_LIMIT).toBe(4);
    expect(source).toContain('function createPreviewInspectorRenderFlow(snapshot)');
    expect(source).toContain("flowKind: flowKind ?? 'component-context'");
    expect(source).toContain("flowKind: 'render-logic'");
    expect(source).toContain("graphKind: 'join'");
    expect(source).toContain('graphEdges');
    expect(source).toContain("kind: 'return'");
    expect(source).toContain('condition.effectiveEnabled === true');
  });
});

/** Evaluates the source with deterministic blocker/path adapters and no DOM or React dependency. */
function evaluateRenderFlowRuntime(
  blockerOverrides: Record<string, unknown> = {},
): RenderFlowRuntime {
  const context: { __runtime?: RenderFlowRuntime } = {};
  const blockerFlow = {
    activeStepId: undefined,
    completed: true,
    fingerprint: 'blockers',
    resolvedCount: 0,
    stages: 0,
    stepById: new Map(),
    steps: [],
    supportingCount: 0,
    unresolvedCount: 0,
    ...blockerOverrides,
  };
  vm.runInNewContext(
    `
      const previewInspectorSession = { selectedExportName: 'Dashboard' };
      const isPreviewInspectorConditionNode = (node) => node?.kind === 'condition';
      const isPreviewInspectorRenderChoiceNode = (node) => node?.kind === 'render-choice';
      const isPreviewInspectorBlockerNode = (node) =>
        node?.kind === 'condition' || typeof node?.blockerKind === 'string';
      const isPreviewInspectorComponentNode = (node) =>
        node !== undefined && node.isHost !== true && node.kind !== 'condition-group';
      const findSelectedPreviewInspectorDescriptor = () => ({
        inspector: {
          renderChainsByExport: {
            Dashboard: {
              target: { exportName: 'Dashboard', sourcePath: '/src/Dashboard.tsx' },
            },
          },
          target: { exportName: 'Dashboard', sourcePath: '/src/Dashboard.tsx' },
        },
      });
      const normalizePreviewInspectorConditionSourcePath = (value) =>
        typeof value === 'string' ? value.replaceAll('\\\\', '/') : '';
      const matchesPreviewInspectorConditionSourcePath = (left, right) => {
        if (left === right) return true;
        const leftAbsolute = left.startsWith('/') || /^[A-Za-z]:\\//u.test(left);
        const rightAbsolute = right.startsWith('/') || /^[A-Za-z]:\\//u.test(right);
        if (leftAbsolute === rightAbsolute) return false;
        const absolute = leftAbsolute ? left : right;
        const relative = leftAbsolute ? right : left;
        return relative.length > 0 && absolute.endsWith('/' + relative.replace(/^\\.\\//u, ''));
      };
      const readPreviewInspectorBlockerFlowTargetOwnerIds = (nodes, path = []) => {
        let fallback;
        for (const node of nodes ?? []) {
          if (isPreviewInspectorBlockerNode(node)) continue;
          const next = [...path, node.id];
          if (node.currentFileExport === true && node.mounted !== false) return next;
          const child = readPreviewInspectorBlockerFlowTargetOwnerIds(node.children, next);
          if (child !== undefined) return child;
          if (node.currentFileExport === true && fallback === undefined) fallback = next;
        }
        return fallback;
      };
      const createPreviewInspectorBlockerFlow = () => globalThis.__blockerFlow;
      ${createPreviewInspectorRenderFlowUiRuntimeSource()}
      globalThis.__runtime = { createFlow: createPreviewInspectorRenderFlow };
    `,
    Object.assign(context, { __blockerFlow: blockerFlow }),
  );
  if (context.__runtime === undefined) {
    throw new Error('Render-flow runtime fixture did not initialize.');
  }
  return context.__runtime;
}

/** Creates one actionable blocker-flow record while keeping resolution explicit at the call site. */
function blockerFlowStep(
  node: RenderNode,
  ownerIds: readonly string[],
  ownerNames: readonly string[],
  resolution: 'pending' | 'resolved',
): Record<string, unknown> & { readonly id: string; readonly node: RenderNode } {
  return {
    current: true,
    id: node.id,
    level: 0,
    node,
    ownerIds,
    ownerNames,
    predecessorIds: [],
    resolution,
    status: resolution === 'resolved' ? 'resolved' : 'active',
  };
}
