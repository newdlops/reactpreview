/** Proves an exact ordered committed corridor independently from names or sibling target output. */
import vm from 'node:vm';
import { describe, expect, it } from 'vitest';
import { createPreviewInspectorJsxOccurrenceRuntimeSource } from '../../../../src/adapters/esbuild/pageInspector/previewInspectorJsxOccurrenceRuntimeSource';

/** Runs private runtime code against committed synthetic Fiber identities, without project code. */
function observe(body: string): unknown {
  return vm.runInNewContext(`
    const candidate = { selectedJsxOccurrenceIds: ['target-site', 'finish-site', 'page-site'] };
    const state = {};
    let boundaries = new Set();
    const readPreviewInspectorOwnData = (value, key) => value && Object.getOwnPropertyDescriptor(value, key)?.value;
    const findSelectedPreviewInspectorDescriptor = () => ({});
    const readSelectedPreviewInspectorPageCandidate = () => candidate;
    const readPreviewInspectorDetachedTargetPlacement = () => undefined;
    const readPreviewInspectorTargetBoundaries = () => boundaries;
    const readPreviewInspectorBoundaryFiber = (boundary) => boundary;
    const readPreviewInspectorFiberLink = (fiber, key) => fiber?.[key];
    ${createPreviewInspectorJsxOccurrenceRuntimeSource()}
    function fiber(id, parent) {
      const props = {};
      registerPreviewInspectorJsxOccurrenceProps(props, id);
      return { memoizedProps: props, return: parent };
    }
    ${body}
  `);
}

describe('selected JSX committed path proof', () => {
  it('does not accept a truncated prefix of a longer selected path', () => {
    expect(
      observe(`candidate.selectedJsxOccurrenceIds = Array.from({ length: 49 }, (_, i) => 'site-' + i);
      let parent;
      for (let index = 47; index >= 0; index -= 1) parent = fiber('site-' + index, parent);
      boundaries.add(parent);
      readPreviewInspectorSelectedJsxPathObservation(candidate, state);`),
    ).toMatchObject({
      selectedPathObserved: false,
      missingOccurrenceIds: ['site-48'],
    });
  });
  it('rejects a target under the wrong branch of the correct page', () => {
    expect(
      observe(`boundaries.add(fiber('target-site', fiber('start-site', fiber('page-site'))));
      readPreviewInspectorSelectedJsxPathObservation(candidate, state);`),
    ).toMatchObject({
      selectedPathObserved: false,
      missingOccurrenceIds: ['finish-site', 'page-site'],
    });
  });

  it('accepts the complete selected path in the same committed target corridor', () => {
    expect(
      observe(`boundaries.add(fiber('target-site', fiber('finish-site', fiber('page-site', fiber(undefined, fiber(undefined))))));
      readPreviewInspectorSelectedJsxPathObservation(candidate, state);`),
    ).toMatchObject({
      selectedPathObserved: true,
      missingOccurrenceIds: [],
    });
  });

  it('never joins sibling target corridors to manufacture a complete path', () => {
    expect(
      observe(`boundaries.add(fiber('target-site', fiber('finish-site')));
      boundaries.add(fiber('target-site', fiber('page-site')));
      readPreviewInspectorSelectedJsxPathObservation(candidate, state);`),
    ).toMatchObject({
      selectedPathObserved: false,
      missingOccurrenceIds: ['page-site'],
    });
  });

  it('ignores pending props and terminates cyclic ancestry', () => {
    expect(
      observe(`const node = fiber('target-site');
      node.return = node; node.pendingProps = fiber('finish-site').memoizedProps;
      boundaries.add(node);
      readPreviewInspectorSelectedJsxPathObservation(candidate, state);`),
    ).toMatchObject({
      selectedPathObserved: false,
    });
  });

  it('strips only admitted private metadata and preserves authored props and ref values', () => {
    expect(
      observe(`const ref = () => {}; const props = Object.freeze({
      __reactPreviewInspectorOccurrence: 'finish-site', key: 'same', ref, message: 'original' });
      const prepared = preparePreviewInspectorJsxOccurrenceProps(props);
      ({ id: prepared.id, keys: Object.keys(prepared.props),
        refPreserved: prepared.props.ref === ref, originalIntact: Object.keys(props).length === 4,
        unknown: preparePreviewInspectorJsxOccurrenceProps({ __reactPreviewInspectorOccurrence: 'authored' }) });`),
    ).toEqual({
      id: 'finish-site',
      keys: ['key', 'ref', 'message'],
      refPreserved: true,
      originalIntact: true,
      unknown: undefined,
    });
  });
});
