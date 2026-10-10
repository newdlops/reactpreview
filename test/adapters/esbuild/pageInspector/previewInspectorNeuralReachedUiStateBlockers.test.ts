/** Verifies that reaching the target mid-request does not drop its own UI-state branches. */
import vm from 'node:vm';
import { describe, expect, it } from 'vitest';
import { createPreviewInspectorNeuralRequestGuardRuntimeSource } from '../../../../src/adapters/esbuild/pageInspector/previewInspectorNeuralRequestGuardRuntimeSource';

/** Runs the generated retention helper against one TeamTabs-like target state. */
function retain(status: string): { readonly probing: number; readonly reached: unknown } {
  return vm.runInNewContext(
    `
    const state = { key: 'team', status: 'probing', targetHasOutput: false,
      targetSourcePath: '/app/TeamTabsPage.tsx' };
    const previewInspectorSession = { renderConditions: new Map(),
      renderConditionAutoOverrides: new Map(), renderConditionOverrides: new Map() };
    const readPreviewInspectorNeuralAssistanceReachability = () => state;
    const readPreviewInspectorNeuralAssistanceBlockerIdentity = (node) => node.condition.id;
    const readPreviewInspectorScalarCoherentOverride = (record) => record.implied;
    const matchesPreviewInspectorConditionDefinitionPath = (left, right) => left === right;
    ${createPreviewInspectorNeuralRequestGuardRuntimeSource()}
    const condition = (id, overrides = {}) => {
      const record = { id, effectiveEnabled: false, sourcePath: '/app/TeamTabsPage.tsx',
        stateBound: true, ...overrides };
      previewInspectorSession.renderConditions.set(id, record);
      return { blockerKind: 'render-condition', condition: { ...record } };
    };
    const initial = { active: [
      condition('members'),
      condition('delta', { stateBound: undefined }),
      condition('billing', { implied: false }),
      condition('corridor', { sourcePath: '/app/Layout.tsx' }),
    ], count: 4 };
    const empty = { active: [], count: 0 };
    const probing = keepPreviewInspectorReachedTargetUiStateBlockers(empty, initial).count;
    Object.assign(state, { status: ${JSON.stringify(status)}, targetHasOutput: true });
    const reached = keepPreviewInspectorReachedTargetUiStateBlockers(empty, initial);
    ({ probing, reached: reached.active.map((node) => node.condition.id) });
  `,
    {},
  ) as { readonly probing: number; readonly reached: unknown };
}

describe('reached target UI-state blockers', () => {
  /** TeamTabs showed the members tab in most runs and only the overview when the race was lost. */
  it('keeps only the target own unforced UI-state branches once it is reached', () => {
    expect(retain('reached')).toEqual({ probing: 0, reached: ['members'] });
    expect(retain('probing')).toEqual({ probing: 0, reached: [] });
  });
});
