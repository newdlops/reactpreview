/** Verifies blocker precedence and progress history without mounting project React code. */
import vm from 'node:vm';
import { describe, expect, it } from 'vitest';
import {
  createPreviewInspectorBlockerFlowUiRuntimeSource,
  PREVIEW_INSPECTOR_BLOCKER_FLOW_SCOPE_LIMIT,
  PREVIEW_INSPECTOR_BLOCKER_FLOW_STEP_LIMIT,
} from '../../../../src/adapters/esbuild/pageInspector/previewInspectorBlockerFlowUiRuntimeSource';

/** Minimal enriched component/blocker record used by the generated flow collector. */
interface FlowNode {
  readonly blocker?: Record<string, unknown>;
  readonly blockerKind?: string;
  readonly children: readonly FlowNode[];
  readonly condition?: Record<string, unknown>;
  readonly id: string;
  readonly kind: string;
  readonly name: string;
}

/** One topologically staged step returned by the generated flow model. */
interface FlowStep {
  readonly current: boolean;
  readonly id: string;
  readonly level: number;
  readonly node: FlowNode;
  readonly predecessorIds: readonly string[];
  readonly resolution: 'pending' | 'resolved' | 'running';
  readonly status: 'active' | 'ready' | 'resolved' | 'waiting';
}

/** Generated blocker DAG surface exposed from an isolated VM fixture. */
interface FlowModel {
  readonly activeStepId?: string;
  readonly completed: boolean;
  readonly resolvedCount: number;
  readonly stages: number;
  readonly steps: readonly FlowStep[];
  readonly unresolvedCount: number;
}

/** Pure fixture API that retains the same hot-session history between model refreshes. */
interface FlowRuntime {
  readonly createFlow: (snapshot: { readonly roots: readonly FlowNode[] }) => FlowModel;
}

/** Creates one ordinary component owner with a deterministic tree identity. */
function component(id: string, name: string, children: readonly FlowNode[]): FlowNode {
  return { children, id, kind: 'function', name };
}

/** Creates one condition node that either selects or exits through its fallback branch. */
function condition(enabled: boolean, override?: boolean): FlowNode {
  return {
    children: [],
    condition: {
      effectiveEnabled: enabled,
      expression: 'authenticated && Dashboard',
      fallbackBranch: 'falsy',
      ...(override === undefined ? {} : { override }),
    },
    id: 'condition:authenticated',
    kind: 'condition',
    name: 'authenticated && Dashboard',
  };
}

/** Creates a selectable blocker pseudo node with runtime-specific metadata. */
function blocker(
  id: string,
  blockerKind: string,
  name: string,
  metadata: Record<string, unknown> = {},
): FlowNode {
  return {
    blocker: metadata,
    blockerKind,
    children: [],
    id,
    kind: 'blocker',
    name,
  };
}

describe('Preview Inspector blocker flow UI runtime source', () => {
  /** Orders outer gates before descendant hook/data/error phases and preserves transitive waiting. */
  it('builds a root-to-target blocker DAG and activates only a predecessor-ready step', () => {
    const runtime = evaluateFlowRuntime();
    const createSnapshot = (authenticated: boolean): { readonly roots: readonly FlowNode[] } => ({
      roots: [
        component('app', 'Application', [
          component('page', 'DashboardPage', [
            blocker('hook', 'runtime-fallback', 'Blocker · useSession'),
            blocker('data', 'data-request', 'Data · Dashboard query', {
              mode: 'auto',
              payload: { dashboard: [] },
            }),
            blocker('error', 'target-error', 'Blocker · DashboardTable'),
          ]),
          condition(authenticated, authenticated ? true : undefined),
        ]),
      ],
    });

    const blockedFlow = runtime.createFlow(createSnapshot(false));

    expect(blockedFlow.steps.map((step) => step.id)).toEqual([
      'condition:authenticated',
      'hook',
      'data',
      'error',
    ]);
    expect(blockedFlow.steps.map((step) => step.predecessorIds)).toEqual([
      [],
      ['condition:authenticated'],
      ['hook'],
      ['data'],
    ]);
    expect(blockedFlow.steps.map((step) => step.level)).toEqual([0, 1, 2, 3]);
    expect(blockedFlow.steps.map((step) => step.status)).toEqual([
      'active',
      'resolved',
      'resolved',
      'waiting',
    ]);
    expect(blockedFlow.activeStepId).toBe('condition:authenticated');

    const passedFlow = runtime.createFlow(createSnapshot(true));
    expect(passedFlow.steps.find((step) => step.id === 'condition:authenticated')?.status).toBe(
      'resolved',
    );
    expect(passedFlow.activeStepId).toBe('error');
  });

  /** Keeps sibling blockers dependency-free and exposes both as one parallel chart stage. */
  it('groups independent sibling blockers as parallel ready work', () => {
    const runtime = evaluateFlowRuntime();
    const flow = runtime.createFlow({
      roots: [
        component('app', 'Application', [
          component('left', 'LeftPanel', [
            blocker('left-data', 'data-request', 'Data · Left panel', {
              mode: 'seed',
              payload: {},
            }),
          ]),
          component('right', 'RightPanel', [
            blocker('right-data', 'data-request', 'Data · Right panel', {
              mode: 'seed',
              payload: {},
            }),
          ]),
        ]),
      ],
    });

    expect(flow.stages).toBe(1);
    expect(flow.steps.map((step) => step.predecessorIds)).toEqual([[], []]);
    expect(flow.steps.map((step) => step.status)).toEqual(['active', 'ready']);
  });

  /** Retains a disappeared current blocker as solved history instead of deleting completed work. */
  it('keeps resolved history and completes the flow after a blocker disappears', () => {
    const runtime = evaluateFlowRuntime();
    runtime.createFlow({
      roots: [component('page', 'Page', [blocker('error', 'target-error', 'Blocker · Card')])],
    });

    const completed = runtime.createFlow({ roots: [component('page', 'Page', [])] });

    expect(completed.completed).toBe(true);
    expect(completed.unresolvedCount).toBe(0);
    expect(completed.resolvedCount).toBe(1);
    expect(completed.steps[0]).toMatchObject({ current: false, id: 'error', status: 'resolved' });
  });

  /** Locks the bounded chart and one-at-a-time editor into the generated browser source. */
  it('emits a staged flow chart with automatic next-step advancement', () => {
    const source = createPreviewInspectorBlockerFlowUiRuntimeSource();

    expect(PREVIEW_INSPECTOR_BLOCKER_FLOW_STEP_LIMIT).toBe(96);
    expect(PREVIEW_INSPECTOR_BLOCKER_FLOW_SCOPE_LIMIT).toBe(8);
    expect(source).toContain('function createPreviewInspectorBlockerFlow(snapshot)');
    expect(source).toContain("'aria-label': 'Blocker dependency flow chart'");
    expect(source).toContain("'Go to next blocker'");
    expect(source).toContain('becameResolved');
    expect(source).toContain('PreviewInspectorBlockerDetail');
  });
});

/** Evaluates data helpers with a stable in-memory session and inert UI dependencies. */
function evaluateFlowRuntime(): FlowRuntime {
  const context: { __flow?: FlowRuntime } = {};
  vm.runInNewContext(
    `
      const previewInspectorSession = {
        blockerFlowHistoryByKey: new Map(),
        selectedExportName: 'Dashboard',
      };
      const findSelectedPreviewInspectorDescriptor = () => ({ exportName: 'Dashboard' });
      const readSelectedPreviewInspectorPageCandidate = () => ({ id: 'dashboard-page' });
      const isPreviewInspectorConditionNode = (node) => node?.kind === 'condition';
      const isPreviewInspectorBlockerNode = (node) =>
        node?.kind === 'condition' || typeof node?.blockerKind === 'string';
      const readPreviewInspectorFallbackValuesEnabled = () => true;
      ${createPreviewInspectorBlockerFlowUiRuntimeSource()}
      globalThis.__flow = { createFlow: createPreviewInspectorBlockerFlow };
    `,
    context,
  );
  if (context.__flow === undefined)
    throw new Error('Blocker flow runtime fixture did not initialize.');
  return context.__flow;
}
