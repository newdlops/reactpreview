/**
 * Verifies the two list-page reachability rules: the target's own collection-emptiness guard is not
 * forced onto its non-empty branch while the target shows output, and a target without output may
 * get its minimum rows through declared REST response types as it does through GraphQL selections.
 */
import vm from 'node:vm';
import { describe, expect, it } from 'vitest';
import { createPreviewInspectorConditionDefinitionRuntimeSource } from '../../../../src/adapters/esbuild/pageInspector/previewInspectorConditionDefinitionRuntimeSource';
import { createPreviewInspectorTargetRequirementTraversalRuntimeSource } from '../../../../src/adapters/esbuild/pageInspector/previewInspectorTargetRequirementTraversalRuntimeSource';

const TARGET = '/workspace/src/pages/OrderListPage.tsx';

describe('collection-emptiness guards', () => {
  /** Whole-condition polarity: true when the condition holds for an empty collection. */
  it.each([
    ['orders.length === 0', true],
    ['!orders.length', true],
    ['data?.items?.length === 0', true],
    ['(rows.length < 1)', true],
    ['0 === list.length', true],
    ['rows[0].length === 0', true],
    ['items.length > 0', false],
    ['items.length', false],
    ['!!items.length', false],
    ['items?.length !== 0', false],
    ['a.b.c.length >= 1', false],
    ['isLoading', undefined],
    ['orders.length === 1', undefined],
    ['x.length === 0 || y', undefined],
  ])('reads %s as %s', (expression, expected) => {
    expect(createDefinitionRuntime().polarity(expression)).toBe(expected);
  });

  /** Only the target's own guard, forced to non-empty while the target has output, is refused. */
  it('refuses only the output-hiding continuation of the target guard', () => {
    const runtime = createDefinitionRuntime();
    const guard = {
      authoredExpression: 'orders.length === 0',
      reachabilityKey: 'candidate:default',
      sourcePath: TARGET,
    };

    expect(runtime.canGuide(guard, false)).toBe(false);
    expect(runtime.canGuide(guard, true)).toBe(true);
    expect(runtime.canGuide({ ...guard, sourcePath: '/workspace/src/Sibling.tsx' }, false)).toBe(
      true,
    );
    expect(runtime.canGuide({ ...guard, authoredExpression: 'isLoading' }, false)).toBe(true);
    expect(runtime.canGuide({ ...guard, authoredExpressionNegated: true }, true)).toBe(false);
    expect(runtime.canGuide({ ...guard, authoredExpression: 'orders.length > 0' }, true)).toBe(
      false,
    );

    runtime.state.targetHasOutput = false;
    expect(runtime.canGuide(guard, false)).toBe(true);
  });
});

describe('deterministic requirement evidence', () => {
  /** Declared REST response types join GraphQL selections; name guesses and other corridors do not. */
  it('admits declared REST requests of the corridor', () => {
    const evidence = readEvidence([
      { id: 'graphql', kind: 'graphql' },
      { id: 'declared', kind: 'rest' },
      { id: 'guessed', kind: 'rest', label: 'GET /api/guessed' },
      { id: 'elsewhere', kind: 'rest', reachabilityKey: 'other:default' },
    ]);

    expect(evidence.requestIds).toEqual(['graphql', 'declared']);
  });
});

interface DefinitionRuntime {
  canGuide(record: Record<string, unknown>, enabled: boolean): boolean;
  polarity(expression: string): boolean | undefined;
  readonly state: { targetHasOutput: boolean; readonly targetSourcePath: string };
}

/** Evaluates the condition-definition fragment against one reachability state. */
function createDefinitionRuntime(): DefinitionRuntime {
  const state = { targetHasOutput: true, targetSourcePath: TARGET };
  const context = vm.createContext({
    previewInspectorSession: {
      activeTargetReachabilityKey: 'candidate:default',
      targetReachabilityByKey: new Map([['candidate:default', state]]),
    },
  });
  vm.runInContext(createPreviewInspectorConditionDefinitionRuntimeSource(), context);
  const call = (name: string, ...args: unknown[]): unknown =>
    (context[name] as (...values: unknown[]) => unknown)(...args);
  return {
    canGuide: (record, enabled) =>
      call('canPreviewInspectorTargetGuideCondition', record, enabled) === true,
    polarity: (expression) =>
      call('readPreviewInspectorEmptinessGuardPolarity', expression) as boolean | undefined,
    state,
  };
}

/** Evaluates the traversal fragment's deterministic evidence over the given request records. */
function readEvidence(records: readonly Record<string, unknown>[]): {
  readonly requestIds: readonly string[];
} {
  const requests = records.map((record) => ({
    id: String(record.id),
    label: 'GET /api/' + String(record.id),
    mode: 'auto',
    reachabilityKey: 'candidate:default',
    shape: { fields: { items: { kind: 'array' } }, kind: 'object' },
    ...record,
  }));
  const context = vm.createContext({
    isPreviewInspectorDeclaredRestRequest: (record: { readonly label?: string }) =>
      record.label !== 'GET /api/guessed',
    readPreviewInspectorDataRequests: () => requests,
    readPreviewInspectorDataShapePaths: () => ['items[]'],
    readPreviewInspectorRequirementBatch: () => ({
      hookIds: [],
      requestIds: requests.map((request) => request.id),
    }),
    readPreviewInspectorRuntimeFallbacks: () => [],
  });
  vm.runInContext(createPreviewInspectorTargetRequirementTraversalRuntimeSource(), context);
  return (
    context.readPreviewInspectorDeterministicRequirementEvidence as (...values: unknown[]) => {
      readonly requestIds: readonly string[];
    }
  )(undefined, undefined, { key: 'candidate:default' });
}
