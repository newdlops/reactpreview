/** Exact fallback slots suspend only viewer-owned work and release through the existing Resume lane. */
import vm from 'node:vm';
import { describe, expect, it } from 'vitest';
import { createPreviewInspectorSuspenseFallbackRuntimeSource } from '../../../../src/adapters/esbuild/pageInspector/previewInspectorSuspenseFallbackRuntimeSource';

/** Executes a private checkpoint without importing or invoking authored components. */
function evaluate(body: string): unknown {
  return vm.runInNewContext(`
    const React = { Suspense: Symbol.for('react.suspense'), createElement: (type, props) => ({ type, props }) };
    const previewInspectorSession = { selectedPageCandidateId: 'selected', fallbackValuesEnabled: true };
    let previewEntryRevision = 1;
    let candidate = { id: 'selected', selectedSuspenseFallbackOccurrenceIds: ['fallback-site'] };
    const previewInspectorJsxOccurrenceProps = new WeakMap();
    const readPreviewInspectorOwnData = (value, key) => value && Object.getOwnPropertyDescriptor(value, key)?.value;
    const findSelectedPreviewInspectorDescriptor = () => ({});
    const readSelectedPreviewInspectorPageCandidate = () => candidate;
    const readPreviewInspectorReleasedNeuralTemporalStateContract = () => undefined;
    const fallback = { props: {} };
    previewInspectorJsxOccurrenceProps.set(fallback.props, 'fallback-site');
    const children = { authored: true };
    const props = Object.freeze({ fallback, children });
    ${createPreviewInspectorSuspenseFallbackRuntimeSource()}
    ${body}
  `);
}

describe('selected authored Suspense fallback checkpoint', () => {
  it('throws one stable viewer promise and preserves the real fallback and children', () => {
    expect(
      evaluate(`const first = preparePreviewInspectorSelectedSuspenseProps(React.Suspense, props);
      const second = preparePreviewInspectorSelectedSuspenseProps(React.Suspense, props);
      let thrown; try { first.children.type(first.children.props); } catch (error) { thrown = error; }
      ({ fallbackPreserved: first.fallback === fallback, childrenPreserved: first.children.props.children === children,
        sameCheckpoint: first.children.props.checkpoint === second.children.props.checkpoint,
        promise: thrown === first.children.props.checkpoint.promise,
        active: hasPreviewInspectorSelectedSuspenseCheckpoint({ candidateId: 'selected' }) });`),
    ).toEqual({
      fallbackPreserved: true,
      childrenPreserved: true,
      sameCheckpoint: true,
      promise: true,
      active: true,
    });
  });

  it('releases to untouched authored children and never rearms the same revision and candidate', () => {
    expect(
      evaluate(`const prepared = preparePreviewInspectorSelectedSuspenseProps(React.Suspense, props);
      const released = releasePreviewInspectorSelectedSuspenseCheckpoints('selected');
      ({ released, childrenPreserved: prepared.children.type(prepared.children.props) === children,
        secondRelease: releasePreviewInspectorSelectedSuspenseCheckpoints('selected'),
        originalProps: preparePreviewInspectorSelectedSuspenseProps(React.Suspense, props) === props,
        active: hasPreviewInspectorSelectedSuspenseCheckpoint({ candidateId: 'selected' }) });`),
    ).toEqual({
      released: 1,
      childrenPreserved: true,
      secondRelease: 0,
      originalProps: true,
      active: false,
    });
  });

  it('does not suspend unrelated JSX, a similarly named type, or disabled fallback assistance', () => {
    expect(
      evaluate(`const sameName = preparePreviewInspectorSelectedSuspenseProps(function Suspense(){}, props) === props;
      candidate.selectedSuspenseFallbackOccurrenceIds = ['different-site'];
      const wrongSite = preparePreviewInspectorSelectedSuspenseProps(React.Suspense, props) === props;
      candidate.selectedSuspenseFallbackOccurrenceIds = ['fallback-site'];
      previewInspectorSession.fallbackValuesEnabled = false;
      ({ sameName, wrongSite, disabled: preparePreviewInspectorSelectedSuspenseProps(React.Suspense, props) === props,
        retained: previewInspectorSelectedSuspenseCheckpoints.size });`),
    ).toEqual({
      sameName: true,
      wrongSite: true,
      disabled: true,
      retained: 0,
    });
  });

  it('keeps revisions and candidates separate and bounds retained viewer promises', () => {
    expect(
      evaluate(`const first = preparePreviewInspectorSelectedSuspenseProps(React.Suspense, props);
      for(let index = 0; index < 30; index += 1) {
        candidate = { id: 'candidate-' + index, selectedSuspenseFallbackOccurrenceIds: ['fallback-site'] };
        previewEntryRevision += 1; preparePreviewInspectorSelectedSuspenseProps(React.Suspense, props);
      }
      ({ retained: previewInspectorSelectedSuspenseCheckpoints.size,
        evictedReleased: first.children.props.checkpoint.released,
        foreignActive: hasPreviewInspectorSelectedSuspenseCheckpoint({ candidateId: 'selected' }) });`),
    ).toEqual({
      retained: 24,
      evictedReleased: true,
      foreignActive: false,
    });
  });
});
