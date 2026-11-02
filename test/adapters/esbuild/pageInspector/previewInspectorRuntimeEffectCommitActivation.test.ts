/** Private commit ownership must survive hot-entry retirement without changing the authored tree. */
import { describe, expect, it } from 'vitest';
import { createRuntimeFallbackFixture } from './support/previewInspectorRuntimeFallbackFixture';

/** Provides inert element records and deferred layout effects; no authored component executes. */
const REACT_FIXTURE = String.raw`
globalThis.React = {
  Profiler: Symbol('profiler'),
  createContext: () => ({ Provider: {} }),
  createElement: (type, props, children) => ({ type, props: {...props, children} }),
  useContext: () => globalThis.currentToken,
  useLayoutEffect: (callback) => { globalThis.layout = callback; },
};
function readPreviewInspectorOwnData(value, name) {
  return value == null ? undefined : Object.getOwnPropertyDescriptor(value, name)?.value;
}
`;

describe('effect commit root activation', () => {
  it('ignores retired root callbacks and hot revisions, including switching back to a prior revision', () => {
    const fixture = createRuntimeFallbackFixture(true);
    fixture.evaluate(REACT_FIXTURE);
    expect(
      fixture.evaluate(`(() => {
      const first = createPreviewInspectorRuntimeEffectCommitElement('first');
      const second = createPreviewInspectorRuntimeEffectCommitElement('second');
      const clock = previewInspectorSession.runtimeEffectCommitClock;
      first.props.onRender();
      if (clock.serial !== 0) return false;
      second.props.onRender();
      if (clock.serial !== 1) return false;
      previewEntryRevision = 1;
      second.props.onRender();
      if (clock.serial !== 1) return false;
      createPreviewInspectorRuntimeEffectCommitElement('third');
      previewEntryRevision = 0;
      second.props.onRender();
      return clock.serial === 1;
    })()`),
    ).toBe(true);
  });

  it('hides only its exact internal scope, provider and Profiler callback identities', () => {
    const fixture = createRuntimeFallbackFixture(true);
    fixture.evaluate(REACT_FIXTURE);
    expect(
      fixture.evaluate(`(() => {
      const element = createPreviewInspectorRuntimeEffectCommitElement('authored');
      const scope = element.props.children;
      const provider = scope.type(scope.props);
      const authored = function PreviewInspectorRuntimeEffectCommitScope() {};
      return isPreviewInspectorRuntimeEffectCommitFiber({type: scope.type}) &&
        isPreviewInspectorRuntimeEffectCommitFiber({type: provider.type}) &&
        isPreviewInspectorRuntimeEffectCommitFiber({type: element.type, memoizedProps: element.props}) &&
        !isPreviewInspectorRuntimeEffectCommitFiber({type: authored}) &&
        !isPreviewInspectorRuntimeEffectCommitFiber({type: React.Profiler, memoizedProps: {onRender(){}}});
    })()`),
    ).toBe(true);
  });

  it('keeps unconfirmed Profiler callbacks protected after the first layout and rejects a retired sentinel', () => {
    const fixture = createRuntimeFallbackFixture(true);
    fixture.evaluate(REACT_FIXTURE);
    expect(
      fixture.evaluate(`(() => {
      React.Profiler = undefined;
      const first = createPreviewInspectorRuntimeEffectCommitElement('first');
      const firstClock = previewInspectorSession.runtimeEffectCommitClock;
      first.type(first.props);
      const oldLayout = globalThis.layout;
      if (readPreviewInspectorRuntimeEffectCommitClock(firstClock.token) !== firstClock) return false;
      oldLayout();
      if (readPreviewInspectorRuntimeEffectCommitClock(firstClock.token) !== undefined) return false;
      const next = createPreviewInspectorRuntimeEffectCommitElement('next');
      const nextClock = previewInspectorSession.runtimeEffectCommitClock;
      next.type(next.props);
      oldLayout();
      if (nextClock.initialCommitCompleted !== false) return false;
      globalThis.layout();
      return readPreviewInspectorRuntimeEffectCommitClock(nextClock.token) === undefined;
    })()`),
    ).toBe(true);
  });
});
