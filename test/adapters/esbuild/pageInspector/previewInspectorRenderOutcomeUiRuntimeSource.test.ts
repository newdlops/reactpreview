/**
 * Verifies the generated graph projection for statically discovered JSX return outcomes.
 *
 * The fixture intentionally supplies only the tiny data factories required by the generated
 * source. This keeps the tests focused on graph shape and avoids coupling static outcomes to a DOM,
 * React renderer, or the much larger mounted-Fiber/blocker model.
 */
import vm from 'node:vm';
import { describe, expect, it } from 'vitest';
import { createPreviewInspectorRenderOutcomeUiRuntimeSource } from '../../../../src/adapters/esbuild/pageInspector/previewInspectorRenderOutcomeUiRuntimeSource';

/** Serializable subset of one graph step returned by the generated helper. */
interface OutcomeGraphStep {
  readonly branchState?: 'active' | 'inactive';
  readonly currentFileContext?: boolean;
  readonly currentFileOutcome?: boolean;
  readonly flowKind: string;
  readonly id: string;
  readonly incomingEdges?: readonly {
    readonly active: boolean;
    readonly fromId: string;
    readonly kind: string;
    readonly label?: string;
  }[];
  readonly label: string;
  readonly level: number;
  readonly predecessorIds: readonly string[];
}

/** Result exposed after one generated append operation. */
interface OutcomeGraphResult {
  readonly choiceNodeIds: readonly string[];
  readonly nodeIds: readonly string[];
  readonly registryReads: {
    readonly choices: number;
    readonly conditions: number;
  };
  readonly steps: readonly OutcomeGraphStep[];
  readonly truncated: boolean;
}

/** Source-qualified boolean condition observed by the runtime condition registry. */
interface RuntimeCondition {
  readonly column: number;
  readonly effectiveEnabled: boolean;
  readonly expression: string;
  readonly line: number;
  readonly sourcePath: string;
}

/** Options accepted by the host-inert generated-source harness. */
interface OutcomeGraphFixture {
  readonly choices?: readonly Record<string, unknown>[];
  readonly conditions?: readonly RuntimeCondition[];
  readonly outcomes: readonly Record<string, unknown>[];
  readonly selectedOutcomeId?: string;
}

describe('Preview Inspector render outcome UI runtime source', () => {
  /**
   * Projects both dormant and active return candidates and recursively retains the JSX ownership
   * chain needed to explain how an outer layout reaches a nested visual component.
   */
  it('appends condition-labelled outcome edges and nested component DFS nodes', () => {
    const result = appendSyntheticOutcomes({
      conditions: [
        {
          column: 7,
          effectiveEnabled: true,
          expression: 'isReady',
          line: 12,
          sourcePath: '/workspace/src/Dashboard.tsx',
        },
      ],
      outcomes: [
        {
          componentTree: [
            {
              children: [
                {
                  children: [{ children: [], name: 'StatusBadge' }],
                  name: 'ContentPanel',
                },
              ],
              name: 'PageLayout',
            },
          ],
          conditions: [
            {
              branch: 'truthy',
              column: 7,
              expression: 'isReady',
              line: 12,
              sourcePath: '/workspace/src/Dashboard.tsx',
            },
          ],
          id: 'ready-view',
          label: 'Ready view',
        },
        {
          componentTree: [{ children: [], name: 'LoadingPanel' }],
          conditions: [
            {
              branch: 'falsy',
              column: 7,
              expression: 'isReady',
              line: 12,
              sourcePath: '/workspace/src/Dashboard.tsx',
            },
          ],
          id: 'loading-view',
          label: 'Loading view',
        },
      ],
    });

    expect(result.steps.map((step) => step.id)).toEqual([
      'render-outcome:ready-view',
      'render-outcome:ready-view:component:0',
      'render-outcome:ready-view:component:0.0',
      'render-outcome:ready-view:component:0.0.0',
      'render-outcome:loading-view',
      'render-outcome:loading-view:component:0',
    ]);
    expect(result.steps.map((step) => step.label)).toEqual([
      'Ready view',
      'PageLayout',
      'ContentPanel',
      'StatusBadge',
      'Loading view',
      'LoadingPanel',
    ]);
    expect(result.choiceNodeIds).toEqual([
      'render-outcome:ready-view',
      'render-outcome:loading-view',
    ]);

    const ready = result.steps[0];
    const loading = result.steps[4];
    expect(ready).toMatchObject({
      branchState: 'active',
      currentFileContext: true,
      currentFileOutcome: true,
      flowKind: 'static-render-outcome',
      predecessorIds: ['current-file-entry'],
    });
    expect(ready?.incomingEdges).toEqual([
      {
        active: true,
        fromId: 'current-file-entry',
        kind: 'outcome-condition',
        label: 'isReady → truthy',
      },
    ]);
    expect(loading).toMatchObject({ branchState: 'inactive' });
    expect(loading?.incomingEdges).toEqual([
      {
        active: false,
        fromId: 'current-file-entry',
        kind: 'outcome-condition',
        label: 'isReady → falsy',
      },
    ]);
    expect(result.steps[3]).toMatchObject({
      branchState: 'active',
      level: 6,
      predecessorIds: ['render-outcome:ready-view:component:0.0'],
    });
    expect(result.truncated).toBe(false);
  });

  /** A selected whole-return scenario takes precedence over the currently observed boolean arm. */
  it('marks only the selected scenario and its component subtree active', () => {
    const result = appendSyntheticOutcomes({
      conditions: [
        {
          column: 7,
          effectiveEnabled: true,
          expression: 'isReady',
          line: 12,
          sourcePath: '/workspace/src/Dashboard.tsx',
        },
      ],
      outcomes: [
        {
          componentTree: [{ children: [], name: 'ReadyPanel' }],
          conditions: [{ branch: 'truthy', expression: 'isReady' }],
          id: 'ready-view',
          label: 'Ready view',
        },
        {
          componentTree: [{ children: [{ children: [], name: 'Spinner' }], name: 'LoadingPanel' }],
          conditions: [{ branch: 'falsy', expression: 'isReady' }],
          id: 'loading-view',
          label: 'Loading view',
        },
      ],
      selectedOutcomeId: 'loading-view',
    });

    expect(readBranchState(result, 'render-outcome:ready-view')).toBe('inactive');
    expect(readBranchState(result, 'render-outcome:ready-view:component:0')).toBe('inactive');
    expect(readBranchState(result, 'render-outcome:loading-view')).toBe('active');
    expect(readBranchState(result, 'render-outcome:loading-view:component:0')).toBe('active');
    expect(readBranchState(result, 'render-outcome:loading-view:component:0.0')).toBe('active');
  });

  /**
   * Enforces independent depth and count budgets so generated or recursively composed JSX cannot
   * turn the compact current-file choice graph into another whole-project component dump.
   */
  it('bounds deep and wide component trees and records truncation', () => {
    const deepResult = appendSyntheticOutcomes({
      outcomes: [
        {
          componentTree: [createComponentChain(12)],
          conditions: [],
          id: 'deep-view',
          label: 'Deep view',
        },
      ],
    });
    expect(deepResult.truncated).toBe(true);
    expect(deepResult.nodeIds).toHaveLength(10);
    expect(deepResult.steps.at(-1)?.id).toBe(
      'render-outcome:deep-view:component:0.0.0.0.0.0.0.0.0',
    );

    const wideResult = appendSyntheticOutcomes({
      outcomes: [
        {
          componentTree: Array.from({ length: 80 }, (_, index) => ({
            children: [],
            name: `Sibling${String(index)}`,
          })),
          conditions: [],
          id: 'wide-view',
          label: 'Wide view',
        },
      ],
    });
    expect(wideResult.truncated).toBe(true);
    expect(wideResult.nodeIds).toHaveLength(64);
    expect(wideResult.steps).toHaveLength(64);
  });

  /**
   * Protects the graph append hot path from rebuilding sorted runtime registries for every static
   * outcome. A switch arm exercises both indexes and would invoke both old readers once per row.
   */
  it('reads and indexes runtime control registries once for every bounded outcome', () => {
    const outcomes = Array.from({ length: 24 }, (_, index) => ({
      componentTree: [],
      conditions: [
        {
          branch: 'case',
          column: 9,
          expression: 'status',
          line: 21,
          sourcePath: '/workspace/src/Dashboard.tsx',
          value: 'ready',
        },
      ],
      id: `status-view-${String(index)}`,
      label: `Status view ${String(index)}`,
    }));
    const result = appendSyntheticOutcomes({
      choices: [
        {
          branches: [{ id: 'ready-branch', value: 'ready' }],
          column: 9,
          effectiveBranchId: 'ready-branch',
          expression: 'status',
          line: 21,
          sourcePath: '/workspace/src/Dashboard.tsx',
        },
      ],
      outcomes,
    });

    expect(result.steps).toHaveLength(24);
    expect(result.registryReads).toEqual({ choices: 1, conditions: 1 });
    expect(result.steps.every((step) => step.branchState === 'active')).toBe(true);
  });
});

/** Reads one step's active/inactive state while producing a useful error for a missing identity. */
function readBranchState(result: OutcomeGraphResult, id: string): OutcomeGraphStep['branchState'] {
  const step = result.steps.find((candidate) => candidate.id === id);
  if (step === undefined) throw new Error(`Missing synthetic outcome graph step: ${id}`);
  return step.branchState;
}

/** Builds a single-child chain long enough to cross the generated source's recursion bound. */
function createComponentChain(depth: number, index = 0): Record<string, unknown> {
  return {
    children: index + 1 < depth ? [createComponentChain(depth, index + 1)] : [],
    name: `Depth${String(index)}`,
  };
}

/**
 * Evaluates the generated append helper with data-only graph factories and condition registries.
 * The JSON round trip intentionally returns host-realm values so assertions never depend on VM
 * object prototypes.
 */
function appendSyntheticOutcomes(fixture: OutcomeGraphFixture): OutcomeGraphResult {
  const context: {
    __result?: OutcomeGraphResult;
    fixture: OutcomeGraphFixture;
  } = { fixture };
  vm.runInNewContext(
    `
      const PREVIEW_INSPECTOR_RENDER_OUTCOME_CONDITION_LIMIT = 12;
      const readPreviewInspectorSelectedRenderOutcomePlan = () => ({
        exportName: 'Dashboard',
        outcomes: fixture.outcomes,
        sourcePath: '/workspace/src/Dashboard.tsx',
      });
      const readPreviewInspectorStaticRenderOutcomes = () => fixture.outcomes.slice(0, 32);
      const readPreviewInspectorSelectedRenderOutcomeId = () => fixture.selectedOutcomeId;
      let conditionRegistryReadCount = 0;
      let choiceRegistryReadCount = 0;
      const readPreviewInspectorRenderConditions = () => {
        conditionRegistryReadCount += 1;
        return fixture.conditions ?? [];
      };
      const readPreviewInspectorRenderChoices = () => {
        choiceRegistryReadCount += 1;
        return fixture.choices ?? [];
      };
      const readPreviewInspectorRenderOutcomeConditionSource = (condition) => ({
        column: Number.isSafeInteger(condition?.column)
          ? condition.column
          : condition?.source?.column,
        expression: condition?.expression,
        line: Number.isSafeInteger(condition?.line) ? condition.line : condition?.source?.line,
        sourcePath: typeof condition?.sourcePath === 'string'
          ? condition.sourcePath
          : condition?.source?.sourcePath,
      });
      const normalizePreviewInspectorConditionSourcePath = (value) =>
        typeof value === 'string' ? value.replaceAll('\\\\', '/') : '';
      const matchesPreviewInspectorConditionSourcePath = (left, right) => left === right;
      const matchesPreviewInspectorRenderOutcomeCondition = (condition, record) => {
        const conditionSource = condition?.source ?? condition;
        return conditionSource?.expression === record?.expression &&
          (conditionSource?.line === undefined || conditionSource.line === record?.line) &&
          (conditionSource?.column === undefined || conditionSource.column === record?.column) &&
          (conditionSource?.sourcePath === undefined ||
            conditionSource.sourcePath === record?.sourcePath);
      };
      const createPreviewInspectorRenderFlowContextStep = (step) => ({
        editable: false,
        ...step,
      });
      const appendPreviewInspectorRenderFlowStep = (state, step) => {
        if (state.stepById.has(step.id)) return false;
        state.stepById.set(step.id, step);
        state.steps.push(step);
        return true;
      };
      const React = { createElement: () => undefined };
      const PreviewInspectorDevtoolsButton = () => undefined;
      const selectPreviewInspectorRenderOutcome = () => false;
      const clearPreviewInspectorRenderOutcome = () => false;
      ${createPreviewInspectorRenderOutcomeUiRuntimeSource()}
      const entryId = 'current-file-entry';
      const entryStep = { id: entryId, level: 2 };
      const state = {
        currentFileOutcomeChoiceNodeIds: new Set(),
        currentFileOutcomeNodeIds: new Set(),
        stepById: new Map([[entryId, entryStep]]),
        steps: [],
        truncated: false,
      };
      appendPreviewInspectorStaticRenderOutcomes({
        entryId,
        node: { source: { path: '/workspace/src/Dashboard.tsx' } },
        ownerIds: ['app', entryId],
        ownerNames: ['App', 'Dashboard'],
        state,
      });
      globalThis.__result = JSON.parse(JSON.stringify({
        choiceNodeIds: Array.from(state.currentFileOutcomeChoiceNodeIds),
        nodeIds: Array.from(state.currentFileOutcomeNodeIds),
        registryReads: {
          choices: choiceRegistryReadCount,
          conditions: conditionRegistryReadCount,
        },
        steps: state.steps,
        truncated: state.truncated,
      }));
    `,
    context,
  );
  if (context.__result === undefined) {
    throw new Error('Render outcome UI runtime fixture did not initialize.');
  }
  return context.__result;
}
