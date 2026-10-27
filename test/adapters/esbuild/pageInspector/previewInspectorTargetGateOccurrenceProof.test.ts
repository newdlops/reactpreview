/** Shared wrapper names cannot prove that a sibling branch contains the selected target. */
import vm from 'node:vm';
import { describe, expect, it } from 'vitest';
import { createPreviewInspectorTargetPathIdentityRuntimeSource } from '../../../../src/adapters/esbuild/pageInspector/previewInspectorTargetPathIdentityRuntimeSource';
import { createPreviewInspectorTargetReachabilityRuntimeSource } from '../../../../src/adapters/esbuild/pageInspector/previewInspectorTargetReachabilityRuntimeSource';

/** Runs the actual generated selection and neural-admission policy with compiler-issued facts. */
function scenario(body: string): unknown {
  return vm.runInNewContext(
    `
    const previewEntryRevision = 1;
    const previewInspectorSession = {
      renderConditions: new Map(), renderConditionOverrides: new Map(),
      targetReachabilityByKey: new Map(),
    };
    const initializePreviewInspectorConditionState = () => undefined;
    const canPreviewInspectorTargetGuideCondition = condition => !condition.requiresAuthoredState && !condition.unsafe;
    ${createPreviewInspectorTargetPathIdentityRuntimeSource()}
    ${createPreviewInspectorTargetReachabilityRuntimeSource()}
    const descriptor = { inspector: { target: { sourcePath: '/app/Target.tsx', exportName: 'Target' } } };
    const candidate = { root: { sourcePath: '/app/Summary.tsx', exportName: 'Summary' },
      selectedJsxOccurrenceIds: [],
      renderPath: { steps: [
        { label: 'Target', sourcePath: '/app/Target.tsx',
          invocation: { mode: 'jsx', sourcePath: '/app/Summary.tsx' } },
        { label: 'Summary', sourcePath: '/app/Summary.tsx', wrapperNames: ['FlexBox'] },
      ] } };
    const state = { key: 'summary:Target', rootName: 'Summary', targetExportName: 'Target',
      targetSourcePath: '/app/Target.tsx', applicationPath: ['Summary', 'FlexBox', 'Target'] };
    previewInspectorSession.targetReachabilityByKey.set(state.key, state);
    function gate(id, overrides = {}) {
      const condition = { id, kind: 'logical-and', expression: 'relations != null',
        sourcePath: '/app/Summary.tsx', ownerName: 'Summary',
        truthyLabel: '<FlexBox: img>', falsyLabel: 'hidden',
        reachabilityKey: state.key, authoredEnabled: false, effectiveEnabled: false, ...overrides };
      previewInspectorSession.renderConditions.set(id, condition); return condition;
    }
    globalThis.findSelectedPreviewInspectorDescriptor = () => descriptor;
    globalThis.readSelectedPreviewInspectorPageCandidate = () => candidate;
    const select = () => selectPreviewInspectorNextTargetGate(descriptor, candidate, state);
    ${body}
  `,
    {},
    { timeout: 2_000 },
  );
}

describe('target-gate wrapper and component proof', () => {
  it('keeps an unrelated nullable diagram closed even when it repeats a corridor container', () => {
    expect(
      scenario(`
      const diagram = gate('diagram');
      const filter = createPreviewInspectorConditionProofFilter();
      ({ selected: select()?.condition.id, neural: filter(diagram) });
    `),
    ).toEqual({ selected: undefined, neural: false });
  });

  it.each(['logical-and', 'ternary'] as const)(
    'does not treat a shared wrapper as the target branch in a %s condition',
    (kind) => {
      expect(
        scenario(`
        gate('sibling', { kind: ${JSON.stringify(kind)} });
        select()?.condition.id;
      `),
      ).toBeUndefined();
    },
  );

  it('opens a branch containing the compiler-marked target and preserves its chosen direction', () => {
    expect(
      scenario(`
      gate('diagram');
      gate('selected', { targetBranchEvidence: 'selected-target', targetBranch: 'falsy',
        effectiveEnabled: true, truthyLabel: '<Fallback>', falsyLabel: '<FlexBox: Target>' });
      const result = select();
      ({ selected: result?.condition.id, enabled: result?.desiredValue });
    `),
    ).toEqual({ selected: 'selected', enabled: false });
  });

  it('does not wait for an authored-state sibling merely because its container is on the path', () => {
    expect(
      scenario(`
      gate('diagram', { unsafe: true });
      readPreviewInspectorPendingAuthoredStateGate(descriptor, candidate, state)?.id;
    `),
    ).toBeUndefined();
  });

  it('preserves exact target label proof when no selected JSX identities exist', () => {
    expect(
      scenario(`
      candidate.selectedJsxOccurrenceIds = [];
      gate('legacy', { truthyLabel: '<FlexBox: Target>' });
      select()?.condition.id;
    `),
    ).toBe('legacy');
  });

  it('preserves label proof for helper-call modules without a selected JSX invocation', () => {
    expect(
      scenario(`
      candidate.renderPath.steps[0].invocation = { mode: 'call', sourcePath: '/app/Summary.tsx' };
      gate('helper', { truthyLabel: '<FlexBox: Target>' });
      select()?.condition.id;
    `),
    ).toBe('helper');
  });

  it('keeps the target own UI-state branch and explicit user overrides unchanged', () => {
    expect(
      scenario(`
      gate('own-tab', { ownerName: 'Target', sourcePath: '/app/Target.tsx', stateBound: true });
      const manual = gate('manual');
      previewInspectorSession.renderConditionOverrides.set(manual.id, true);
      const filter = createPreviewInspectorConditionProofFilter();
      ({ selected: select()?.condition.id, manual: previewInspectorSession.renderConditionOverrides.get('manual'),
        own: filter(previewInspectorSession.renderConditions.get('own-tab')) });
    `),
    ).toEqual({ selected: 'own-tab', manual: true, own: true });
  });

  it('refreshes evidence when a wrapper becomes a real component step on another path', () => {
    expect(
      scenario(`
      gate('diagram');
      const before = select()?.condition.id;
      candidate.renderPath.steps.splice(1, 0, { label: 'FlexBox', sourcePath: '/ui/FlexBox.tsx' });
      ({ before, after: select()?.condition.id });
    `),
    ).toEqual({ before: undefined, after: 'diagram' });
  });
});
