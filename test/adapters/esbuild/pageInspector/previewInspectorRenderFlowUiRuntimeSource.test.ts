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
  readonly condition?: Record<string, unknown>;
  readonly contextOnly?: boolean;
  readonly currentFileExport?: boolean;
  readonly exportName?: string;
  readonly id: string;
  readonly kind: string;
  readonly mounted?: boolean;
  readonly name: string;
  readonly source?: { readonly line?: number; readonly path?: string };
}

/** One explanatory or actionable node returned by the generated flow model. */
interface RenderStep {
  readonly directCurrentFileBlocker?: boolean;
  readonly editable: boolean;
  readonly flowKind: 'component-context' | 'render-logic';
  readonly id: string;
  readonly kind: 'blocker' | 'component' | 'condition' | 'return';
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
  readonly directCurrentFileBlockerCount: number;
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
      flowKind: 'component-context',
      kind: 'return',
      label: 'return · <Dashboard>',
      predecessorIds: ['condition:auth'],
      status: 'context',
    });
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

  /** Documents the bounded expansion contract used for large mounted component subtrees. */
  it('emits explicit graph limits and function-to-JSX metadata', () => {
    const source = createPreviewInspectorRenderFlowUiRuntimeSource();

    expect(PREVIEW_INSPECTOR_RENDER_FLOW_STEP_LIMIT).toBe(128);
    expect(PREVIEW_INSPECTOR_RENDER_FLOW_OUTPUT_DEPTH_LIMIT).toBe(4);
    expect(source).toContain('function createPreviewInspectorRenderFlow(snapshot)');
    expect(source).toContain("flowKind: 'component-context'");
    expect(source).toContain("flowKind: 'render-logic'");
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
      const isPreviewInspectorBlockerNode = (node) =>
        node?.kind === 'condition' || typeof node?.blockerKind === 'string';
      const isPreviewInspectorComponentNode = (node) =>
        node !== undefined && node.isHost !== true && node.kind !== 'condition-group';
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
