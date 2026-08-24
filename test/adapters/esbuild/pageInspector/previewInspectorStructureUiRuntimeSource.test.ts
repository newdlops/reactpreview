/** Verifies unresolved tree rows communicate viewer work, user choices, and real errors separately. */
import vm from 'node:vm';
import { describe, expect, it } from 'vitest';
import { createPreviewInspectorStructureUiRuntimeSource } from '../../../../src/adapters/esbuild/pageInspector/previewInspectorStructureUiRuntimeSource';

interface StructureRuntime {
  readonly classify: (node: Record<string, unknown>) => string;
  readonly icon: (node: Record<string, unknown>) => string;
  readonly rejectCondition: (conditionId: string) => void;
  readonly setAttempts: (identity: string, attempts: number) => void;
  readonly sortKinds: (nodes: Record<string, unknown>[]) => string[];
}

/** Evaluates the generated presentation helpers against a small, data-only resolver fixture. */
function createStructureRuntime(): StructureRuntime {
  const context: { __runtime?: StructureRuntime } = {};
  vm.runInNewContext(
    `
      const reachability = { key: 'page:Target', status: 'probing' };
      const attemptsByBlocker = new Map();
      const rejectedConditions = new Set();
      const previewInspectorSession = {
        activeTargetReachabilityKey: reachability.key,
        automaticNeuralAssistanceByKey: new Map([[
          'revision:page:Target',
          { attemptsByBlocker, manualPasses: 0 },
        ]]),
        renderConditionRejectedAutoOverridesByKey: new Map([[
          reachability.key,
          rejectedConditions,
        ]]),
        targetReachabilityByKey: new Map([[reachability.key, reachability]]),
      };
      function isPreviewInspectorConditionNode(node) { return node?.kind === 'condition'; }
      function isPreviewInspectorTargetReachabilityResolving(blocker) {
        return ['awaiting-authored-state', 'probing', 'searching'].includes(blocker?.status);
      }
      function readPreviewInspectorTargetFailurePropChoices(failure) {
        return failure?.choices ?? [];
      }
      function createPreviewInspectorFinitePropChoiceMutation(failure) {
        return failure?.automaticRepair === true ? {} : undefined;
      }
      function createPreviewInspectorTargetFailurePropMutation(failure) {
        return failure?.automaticRepair === true ? {} : undefined;
      }
      function readPreviewInspectorNeuralAssistanceReachability() { return reachability; }
      function createPreviewInspectorAutomaticNeuralAssistanceKey() {
        return 'revision:page:Target';
      }
      function createPreviewInspectorNeuralAssistanceAttemptIdentity(node) {
        const id = node?.blocker?.id ?? node?.condition?.id;
        return typeof id === 'string' ? node.blockerKind + ':' + id : undefined;
      }
      function readPreviewInspectorNeuralAssistanceAttemptLimit() { return 2; }
      ${createPreviewInspectorStructureUiRuntimeSource()}
      globalThis.__runtime = {
        classify: readPreviewInspectorResolutionKind,
        icon: readPreviewInspectorResolutionSymbol,
        rejectCondition: (conditionId) => rejectedConditions.add(conditionId),
        setAttempts: (identity, attempts) => attemptsByBlocker.set(identity, attempts),
        sortKinds: (nodes) => nodes.sort(comparePreviewInspectorResolutionNodes)
          .map((node) => node.blockerKind),
      };
    `,
    context,
  );
  if (context.__runtime === undefined) throw new Error('Structure fixture did not initialize.');
  return context.__runtime;
}

describe('Preview Inspector structure UI runtime source', () => {
  it('uses distinct symbols for automatic work, user choice, and an actual runtime error', () => {
    const runtime = createStructureRuntime();
    const automatic = { blocker: { id: 'data' }, blockerKind: 'data-request' };
    const choice = {
      blocker: { id: 'path', status: 'awaiting-authored-state' },
      blockerKind: 'target-reachability',
    };
    const error = { blocker: { id: 'global' }, blockerKind: 'runtime-global' };

    expect(runtime.classify(automatic)).toBe('automatic');
    expect(runtime.icon(automatic)).toBe('↻');
    expect(runtime.classify(choice)).toBe('choice');
    expect(runtime.icon(choice)).toBe('?');
    expect(runtime.classify(error)).toBe('error');
    expect(runtime.icon(error)).toBe('×');
    expect([runtime.icon(automatic), runtime.icon(choice), runtime.icon(error)]).not.toContain('!');
  });

  it('lets the viewer cross a proven condition until user intent or a rejected attempt takes over', () => {
    const runtime = createStructureRuntime();
    const automaticCondition = {
      blockerKind: 'render-condition',
      condition: { id: 'gate', reachabilityKey: 'page:Target' },
      kind: 'condition',
    };

    expect(runtime.classify(automaticCondition)).toBe('automatic');
    expect(
      runtime.classify({
        ...automaticCondition,
        condition: { ...automaticCondition.condition, override: false },
      }),
    ).toBe('choice');
    expect(
      runtime.classify({
        ...automaticCondition,
        condition: { ...automaticCondition.condition, requiresAuthoredState: true },
      }),
    ).toBe('choice');

    runtime.rejectCondition('gate');
    expect(runtime.classify(automaticCondition)).toBe('choice');
  });

  it('repairs source-proven exceptions automatically and exposes unresolved finite options', () => {
    const runtime = createStructureRuntime();
    const repairable = {
      blocker: { automaticRepair: true, id: 'repairable' },
      blockerKind: 'target-error',
    };
    const selectable = {
      blocker: { choices: [{ path: 'taxType' }], id: 'selectable' },
      blockerKind: 'target-error',
    };

    expect(runtime.classify(repairable)).toBe('automatic');
    expect(runtime.classify(selectable)).toBe('choice');

    runtime.setAttempts('target-error:crash', 2);
    const exhausted = { blocker: { id: 'crash' }, blockerKind: 'target-error' };
    expect(runtime.classify(exhausted)).toBe('error');
    expect(runtime.icon(exhausted)).toBe('×');
  });

  it('hands an exhausted generated-value blocker to the user and orders exact errors first', () => {
    const runtime = createStructureRuntime();
    runtime.setAttempts('runtime-fallback:hook', 2);
    expect(
      runtime.classify({
        blocker: { id: 'hook' },
        blockerKind: 'runtime-fallback',
      }),
    ).toBe('choice');
    expect(
      runtime.sortKinds([
        { blocker: { key: 'path' }, blockerKind: 'target-reachability' },
        { blocker: { id: 'data' }, blockerKind: 'data-request' },
        { blocker: { id: 'crash' }, blockerKind: 'target-error' },
      ]),
    ).toEqual(['target-error', 'data-request', 'target-reachability']);
  });
});
