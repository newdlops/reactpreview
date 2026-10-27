/** Keeps unrelated authored dialogs from obscuring a compiler-detached exact overlay target. */
import { describe, expect, it } from 'vitest';
import { createConditionRuntimeHarness } from './support/previewInspectorConditionRuntimeFixture';

const metadata = {
  authoredExpression: 'open',
  expression: '<Sheet>.open: open',
  falsyLabel: 'hidden <Sheet> overlay',
  kind: 'overlay-visibility',
  ownerName: 'Sheet',
  role: 'overlay',
  sourcePath: '/workspace/Parent.tsx',
  truthyLabel: 'visible <Sheet> overlay',
};

/** Creates one source-proven active target without admitting unrelated direct-target exceptions. */
function fixture(
  placement = 'overlay-sibling',
  targetSourcePath = '/workspace/Detail.tsx',
): ReturnType<typeof createConditionRuntimeHarness> {
  return createConditionRuntimeHarness({}, () => undefined, {
    activeTargetReachabilityKey: 'detail',
    targetReachabilityByKey: new Map([
      ['detail', { candidateId: 'page', detachedTargetPlacement: placement, targetSourcePath }],
    ]),
  });
}

describe('detached overlay automatic visibility', () => {
  it('rejects an unrelated automatic open and retains manual and authored visibility', () => {
    const harness = fixture();
    expect(harness.resolveCondition('sheet', false, metadata)).toBe(false);
    expect(harness.setAutoCondition('sheet', true)).toBe(false);
    harness.setCondition('sheet', true);
    expect(harness.resolveCondition('sheet', false, metadata)).toBe(true);
    harness.resetCondition('sheet');
    expect(harness.resolveCondition('sheet', true, metadata)).toBe(true);
  });

  it('removes an old automatic open during candidate replay without touching manual values', () => {
    const harness = fixture();
    harness.resolveCondition('sheet', false, metadata);
    (harness.session.renderConditionAutoOverrides as Map<string, boolean>).set('sheet', true);
    expect(harness.resolveCondition('sheet', false, metadata)).toBe(false);
    expect(harness.readConditions()[0]).toMatchObject({
      authoredEnabled: false,
      effectiveEnabled: false,
      autoOverride: undefined,
    });
  });

  it.each([
    ['same-source target', 'overlay-sibling', '/workspace/Parent.tsx'],
    ['ordinary authored corridor', '', '/workspace/Detail.tsx'],
    ['deferred content', 'deferred-sibling', '/workspace/Detail.tsx'],
  ])('preserves automatic reveal for %s', (_label, placement, sourcePath) => {
    const harness = fixture(placement, sourcePath);
    harness.resolveCondition('sheet', false, metadata);
    expect(harness.setAutoCondition('sheet', true)).toBe(true);
    expect(harness.resolveCondition('sheet', false, metadata)).toBe(true);
  });
});
