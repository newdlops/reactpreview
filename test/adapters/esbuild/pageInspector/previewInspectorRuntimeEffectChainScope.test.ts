/** Real effect traces must belong to the synchronous callback that actually emitted them. */
import { describe, expect, it } from 'vitest';
import { PREVIEW_INSPECTOR_RUNTIME_EFFECT_EXECUTION_LIMIT } from '../../../../src/adapters/esbuild/pageInspector/previewInspectorRuntimeFallbackRuntimeSource';
import {
  createMetadata,
  createRuntimeFallbackFixture,
  type RuntimeFallbackFixture,
} from './support/previewInspectorRuntimeFallbackFixture';

/** Records a real production chain event after an effect or nested effect returns. */
function readMarkedEffect(fixture: RuntimeFallbackFixture): unknown {
  return fixture.evaluate(`(() => {
    const token = {};
    recordPreviewInspectorTargetRenderChain({
      kind: 'marked-call', ownershipToken: token, propertyPath: 'isReady()', result: true,
    });
    return previewInspectorSession.targetRenderCommitChainsByToken.get(token).markedCalls.at(-1).effectId;
  })()`);
}

describe('runtime effect trace ownership', () => {
  it('does not attribute unrelated work to an effect skipped by the burst guard', () => {
    const fixture = createRuntimeFallbackFixture(true);
    const metadata = { ...createMetadata(), id: 'limited-effect', hookName: 'useEffect' };
    let executions = 0;
    for (let index = 0; index <= PREVIEW_INSPECTOR_RUNTIME_EFFECT_EXECUTION_LIMIT; index += 1) {
      fixture.api.effect(() => {
        executions += 1;
      }, metadata);
    }
    expect(executions).toBe(PREVIEW_INSPECTOR_RUNTIME_EFFECT_EXECUTION_LIMIT);
    expect(fixture.warnings).toHaveLength(1);
    expect(readMarkedEffect(fixture)).toBe('');
  });

  it.each(['success', 'throw', 'limited'] as const)(
    'restores an outer effect after a nested effect returns through %s',
    (outcome) => {
      const fixture = createRuntimeFallbackFixture(true);
      const outer = { ...createMetadata(), id: 'outer-effect', hookName: 'useEffect' };
      const inner = { ...outer, id: 'inner-effect' };
      let observed: unknown;
      fixture.api.effect(() => {
        const attempts =
          outcome === 'limited' ? PREVIEW_INSPECTOR_RUNTIME_EFFECT_EXECUTION_LIMIT + 1 : 1;
        for (let index = 0; index < attempts; index += 1) {
          fixture.api.effect(() => {
            if (outcome === 'throw') throw new Error('nested failure');
          }, inner);
        }
        observed = readMarkedEffect(fixture);
      }, outer);
      expect(observed).toBe('outer-effect');
    },
  );

  it('keeps inner, outer and unrelated marked work in their actual synchronous scopes', () => {
    const fixture = createRuntimeFallbackFixture(true);
    const outer = { ...createMetadata(), id: 'outer-effect', hookName: 'useEffect' };
    let innerObserved: unknown;
    let outerObserved: unknown;
    fixture.api.effect(() => {
      fixture.api.effect(
        () => {
          innerObserved = readMarkedEffect(fixture);
        },
        { ...outer, id: 'inner-effect' },
      );
      outerObserved = readMarkedEffect(fixture);
    }, outer);
    expect(innerObserved).toBe('inner-effect');
    expect(outerObserved).toBe('outer-effect');
    expect(readMarkedEffect(fixture)).toBe('');
  });

  it('restores the outer scope when Auto is off and the authored caller catches a nested failure', () => {
    const fixture = createRuntimeFallbackFixture(false);
    const outer = { ...createMetadata(), id: 'outer-effect', hookName: 'useEffect' };
    let observed: unknown;
    fixture.api.effect(() => {
      expect(() =>
        fixture.api.effect(
          () => {
            throw new Error('authored failure');
          },
          { ...outer, id: 'inner-effect' },
        ),
      ).toThrow('authored failure');
      observed = readMarkedEffect(fixture);
    }, outer);
    expect(observed).toBe('outer-effect');
    expect(readMarkedEffect(fixture)).toBe('');
    expect(fixture.warnings).toEqual([]);
  });

  it.each([
    'same-candidate',
    'new-candidate',
    'candidate-return',
    'new-revision',
    'revision-before-inner',
  ] as const)('keeps attribution in the current activation across %s', (transition) => {
    const fixture = createRuntimeFallbackFixture(true);
    fixture.api.activateScope('candidate-a', false);
    const outer = { ...createMetadata(), id: 'outer-effect', hookName: 'useEffect' };
    let observed: unknown;
    fixture.api.effect(() => {
      if (transition === 'revision-before-inner') fixture.api.setRevision(1);
      fixture.api.effect(
        () => {
          if (transition === 'same-candidate') fixture.api.activateScope('candidate-a', false);
          if (transition === 'new-revision') fixture.api.setRevision(1);
          if (transition === 'new-candidate' || transition === 'candidate-return') {
            fixture.api.activateScope('candidate-b', false);
            if (transition === 'candidate-return') fixture.api.activateScope('candidate-a', false);
          }
        },
        { ...outer, id: 'inner-effect' },
      );
      observed = readMarkedEffect(fixture);
    }, outer);
    expect(observed).toBe(transition === 'same-candidate' ? 'outer-effect' : '');
    expect(readMarkedEffect(fixture)).toBe('');
  });
});
