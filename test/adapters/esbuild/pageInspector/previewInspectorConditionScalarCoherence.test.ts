/** Verifies that sibling comparisons follow the value one automatic branch choice fixes. */
import { describe, expect, it } from 'vitest';
import { createConditionRuntimeHarness } from './support/previewInspectorConditionRuntimeFixture';

/** Compiler metadata of `{tab <operator> '<value>' && …}` in TeamTabsPage. */
function tabCondition(
  operator: '===' | '!==' | '==',
  value: string | null,
  overrides: Record<string, unknown> = {},
): Record<string, unknown> {
  const expression = `tab ${operator} ${JSON.stringify(value)}`;
  return {
    authoredExpression: expression,
    expression,
    expressionFingerprint: expression.padEnd(64, '0').slice(0, 64),
    falsyLabel: 'hidden',
    kind: 'logical-and',
    ownerName: 'TeamTabsPage',
    scalarExpression: { kind: 'comparison', operator, path: 'tab', value },
    sourcePath: '/workspace/src/pages/TeamTabsPage.tsx',
    stateBound: true,
    truthyLabel: '<p>',
    ...overrides,
  };
}

/** Resolves the overview panel guard after forcing the given conditions automatically. */
function resolveOverview(
  forced: readonly (readonly [string, Record<string, unknown>, boolean])[],
  overview: Record<string, unknown> = tabCondition('===', 'overview'),
): unknown {
  const harness = createConditionRuntimeHarness({}, () => undefined);
  for (const [id, metadata] of forced) harness.resolveCondition(id, false, metadata);
  const overrides = harness.session.renderConditionAutoOverrides as Map<string, boolean>;
  for (const [id, , enabled] of forced) overrides.set(id, enabled);
  return harness.resolveCondition('overview', true, overview);
}

describe('Preview Inspector scalar coherence', () => {
  /** Forcing the members panel used to leave the authored overview panel beside it. */
  it('evaluates sibling comparisons against the value a forced branch fixes', () => {
    const members = ['members', tabCondition('===', 'members'), true] as const;

    expect(resolveOverview([members])).toBe(false);
    expect(resolveOverview([members], tabCondition('!==', 'members'))).toBe(false);
    expect(resolveOverview([], tabCondition('===', 'overview'))).toBe(true);
  });

  /** Two forced branches that disagree fix nothing, so authored values stay. */
  it('ignores contradictory, manual, nullish, and foreign-owner choices', () => {
    const members = ['members', tabCondition('===', 'members'), true] as const;
    const billing = ['billing', tabCondition('===', 'billing'), true] as const;
    const nullish = ['nullish', tabCondition('==', null), true] as const;
    const foreign = [
      'foreign',
      tabCondition('===', 'members', { ownerName: 'BillingPanel' }),
      true,
    ] as const;

    expect(resolveOverview([members, billing])).toBe(true);
    expect(resolveOverview([nullish])).toBe(true);
    expect(resolveOverview([foreign])).toBe(true);

    const harness = createConditionRuntimeHarness({}, () => undefined);
    harness.resolveCondition('members', false, members[1]);
    (harness.session.renderConditionAutoOverrides as Map<string, boolean>).set('members', true);
    harness.setCondition('members', false);
    expect(harness.resolveCondition('overview', true, tabCondition('===', 'overview'))).toBe(true);
  });

  /** The Inspector names the forced branch an otherwise authored condition now follows. */
  it('lists the automatic branches that fix a condition value', () => {
    const harness = createConditionRuntimeHarness({}, () => undefined);
    harness.resolveCondition('members', false, tabCondition('===', 'members'));
    harness.resolveCondition('overview', true, tabCondition('===', 'overview'));
    (harness.session.renderConditionAutoOverrides as Map<string, boolean>).set('members', true);

    expect(harness.readCoherenceSources({ id: 'overview' })).toEqual(['tab === "members" ON']);
    expect(harness.readCoherenceSources({ id: 'members' })).toEqual([]);
    harness.setCondition('overview', true);
    expect(harness.readCoherenceSources({ id: 'overview' })).toEqual([]);
  });

  /** Choosing billing by hand left the automatically opened members panel beside it. */
  it('lets a manual choice decide siblings, including automatically forced ones', () => {
    const harness = createConditionRuntimeHarness({}, () => undefined);
    for (const tab of ['overview', 'members', 'billing']) {
      harness.resolveCondition(tab, tab === 'overview', tabCondition('===', tab));
    }
    (harness.session.renderConditionAutoOverrides as Map<string, boolean>).set('members', true);
    harness.setCondition('billing', true);

    expect(harness.resolveCondition('members', false, tabCondition('===', 'members'))).toBe(false);
    expect(harness.resolveCondition('overview', true, tabCondition('===', 'overview'))).toBe(false);
    expect(harness.resolveCondition('billing', false, tabCondition('===', 'billing'))).toBe(true);
    expect(harness.readCoherenceSources({ id: 'members' })).toEqual([
      'tab === "billing" ON (manual)',
    ]);
    expect(harness.readCoherenceSources({ id: 'overview' })).toEqual([
      'tab === "billing" ON (manual)',
    ]);

    // Turning billing off fixes no single value, so the automatic members choice applies again.
    harness.setCondition('billing', false);
    expect(harness.resolveCondition('members', false, tabCondition('===', 'members'))).toBe(true);
    expect(harness.resolveCondition('overview', true, tabCondition('===', 'overview'))).toBe(false);
  });

  /** An early return hiding its content when false keeps the visible-state mapping. */
  it('reads the fixed value through negated runtime metadata', () => {
    const negated = [
      'members',
      tabCondition('===', 'members', { authoredExpressionNegated: true, kind: 'early-return' }),
      false,
    ] as const;

    expect(resolveOverview([negated])).toBe(false);
  });
});
