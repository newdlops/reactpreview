/** Separates real Boolean visibility choices from authored data receivers and lazy guard errors. */
import { describe, expect, it, vi } from 'vitest';
import { createConditionRuntimeHarness } from './support/previewInspectorConditionRuntimeFixture';

describe('Preview Inspector condition value semantics', () => {
  /** Presents logical JSX guards as switches without coercing their authored JavaScript values. */
  it('preserves object identity and exact falsy values behind logical-and switches', () => {
    const harness = createConditionRuntimeHarness({}, vi.fn());
    const authoredObject = { permission: 'granted' };
    const metadata = {
      expression: 'permission',
      falsyLabel: 'hidden',
      kind: 'logical-and',
      sourcePath: '/workspace/Page.tsx',
      truthyLabel: '<PrivatePanel>',
    };

    expect(harness.resolveCondition('logical-object', authoredObject, metadata)).toBe(
      authoredObject,
    );
    expect(harness.resolveCondition('logical-zero', 0, metadata)).toBe(0);

    harness.setCondition('logical-object', false);
    expect(harness.resolveCondition('logical-object', authoredObject, metadata)).toBe(false);

    harness.setCondition('logical-zero', true);
    expect(harness.resolveCondition('logical-zero', 0, metadata)).toBe(0);
    expect(
      harness.readConditions().find((record) => record.id === 'logical-zero')?.override,
    ).toBeUndefined();
    harness.resetCondition('logical-zero');
    expect(harness.resolveCondition('logical-zero', 0, metadata)).toBe(0);
  });

  /** Keeps hidden-state source guards exact while presenting their control as true=visible. */
  it('preserves negated overlay guards and applies visible-state overrides', async () => {
    const harness = createConditionRuntimeHarness({}, vi.fn());
    const metadata = {
      authoredExpression: 'file == null',
      authoredExpressionNegated: true,
      expression: '<DocumentInfoModal> visibility: file == null',
      falsyLabel: 'hidden <DocumentInfoModal> overlay',
      kind: 'overlay-visibility',
      role: 'overlay',
      sourcePath: '/workspace/DocumentInfoModal.tsx',
      truthyLabel: 'visible <DocumentInfoModal> overlay',
    };

    const hiddenGuard = harness.resolveCondition('modal-hidden', true, metadata);
    const visibleGuard = harness.resolveCondition('modal-visible', false, metadata);

    expect(hiddenGuard).toBe(false);
    expect(!hiddenGuard).toBe(true);
    expect(visibleGuard).toBe(true);
    expect(!visibleGuard).toBe(false);
    await Promise.resolve();
    expect(harness.readConditions()).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          authoredEnabled: false,
          effectiveEnabled: false,
          id: 'modal-hidden',
        }),
        expect.objectContaining({
          authoredEnabled: true,
          effectiveEnabled: true,
          id: 'modal-visible',
        }),
      ]),
    );

    harness.setCondition('modal-hidden', true);
    expect(harness.resolveCondition('modal-hidden', true, metadata)).toBe(true);
    harness.setCondition('modal-visible', false);
    expect(harness.resolveCondition('modal-visible', false, metadata)).toBe(false);
  });

  /** Explicit Boolean switches can reveal a dependent guard, whose error stays inside the lazy boundary. */
  it('lazily catches dependent guard errors behind explicit Boolean switches', () => {
    const harness = createConditionRuntimeHarness({}, vi.fn());
    const metadata = {
      authoredExpression: 'session',
      column: 10,
      expression: 'session',
      falsyLabel: 'hidden',
      kind: 'logical-and',
      line: 4,
      sourcePath: '/workspace/Page.tsx',
      truthyLabel: '<Panel>',
    };
    const authoredObject = { user: { id: 1 } };

    expect(
      harness.resolveConditionLazy('logical-object-lazy', () => authoredObject, metadata),
    ).toBe(authoredObject);
    expect(harness.resolveConditionLazy('logical-zero-lazy', () => 0, metadata)).toBe(0);

    const session: { user: unknown } | null = null;
    let dependentEvaluations = 0;
    const renderDependentChain = (): unknown =>
      harness.resolveConditionLazy('session-gate', () => Boolean(session), {
        ...metadata,
        authoredExpression: 'Boolean(session)',
        expression: 'Boolean(session)',
      }) &&
      harness.resolveConditionLazy(
        'user-gate',
        () => {
          dependentEvaluations += 1;
          return (session as unknown as { user: unknown }).user;
        },
        { ...metadata, authoredExpression: 'session.user', column: 21, expression: 'session.user' },
      ) &&
      'panel-rendered';

    expect(renderDependentChain()).toBe(false);
    expect(dependentEvaluations).toBe(0);

    harness.setCondition('session-gate', true);
    expect(renderDependentChain()).toBe(false);
    expect(dependentEvaluations).toBe(1);
    expect(harness.readConditions()).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ authoredEnabled: false, id: 'user-gate' }),
      ]),
    );
    expect(harness.readConsoleEntries()).toEqual([
      expect.objectContaining({
        level: 'warn',
        location: '/workspace/Page.tsx:4:21',
        phase: 'evaluate-render-condition',
        source: 'render-condition',
      }),
    ]);

    harness.setCondition('user-gate', true);
    expect(renderDependentChain()).toBe('panel-rendered');
    expect(dependentEvaluations).toBe(2);
  });

  /** Missing data must not become a fictional receiver merely because a visibility switch was toggled. */
  it.each([null, undefined, 0, ''])(
    'preserves missing data %s and short-circuits dependent reads',
    (value) => {
      const harness = createConditionRuntimeHarness({}, vi.fn());
      const metadata = {
        kind: 'logical-and',
        expression: 'session',
        sourcePath: '/workspace/Page.tsx',
      };
      let reads = 0;
      const render = (): unknown =>
        harness.resolveConditionLazy('data', () => value, metadata) &&
        (() => {
          reads += 1;
          return 'dependent';
        })();
      expect(render()).toBe(value);
      harness.setCondition('data', true);
      expect(render()).toBe(value);
      expect(harness.setAutoCondition('data', true)).toBe(false);
      expect(render()).toBe(value);
      expect(reads).toBe(0);
      expect(harness.readConsoleEntries()).toEqual([]);
      expect(
        harness.readConditions().find((record) => record.id === 'data')?.override,
      ).toBeUndefined();
    },
  );
});
