/** Generates private props-identity evidence for the selected authored JSX corridor. */
import { PREVIEW_JSX_OCCURRENCE_PROP } from '../previewJsxOccurrenceIdentity';

/** Keeps application props, element types, refs, keys, and memo comparisons unchanged. */
export function createPreviewInspectorJsxOccurrenceRuntimeSource(): string {
  return String.raw`
const previewInspectorJsxOccurrenceProps = new WeakMap();
const previewInspectorJsxOccurrenceProp = ${JSON.stringify(PREVIEW_JSX_OCCURRENCE_PROP)};

/** Removes only a compiler-admitted marker before the original React factory reads props. */
function preparePreviewInspectorJsxOccurrenceProps(props) {
  if (props === null || typeof props !== 'object') return undefined;
  const marker = readPreviewInspectorOwnData(props, previewInspectorJsxOccurrenceProp);
  if (typeof marker !== 'string') return undefined;
  const descriptor = findSelectedPreviewInspectorDescriptor();
  const candidate = readSelectedPreviewInspectorPageCandidate(descriptor);
  const admitted = candidate?.selectedJsxOccurrenceIds ?? (candidate?.edges ?? [])
    .map((edge) => edge?.occurrenceId);
  if (!admitted.includes(marker)) return undefined;
  const clean = { ...props };
  delete clean[previewInspectorJsxOccurrenceProp];
  return { id: marker, props: clean };
}

/** Associates only the original factory's final props object, without wrapping the component. */
function registerPreviewInspectorJsxOccurrenceProps(props, id) {
  if (props !== null && typeof props === 'object' && typeof id === 'string') {
    previewInspectorJsxOccurrenceProps.set(props, id);
  }
}

/** Requires every selected call site in order above one exact committed target, never siblings. */
function readPreviewInspectorSelectedJsxPathObservation(candidate, state) {
  const expected = [...new Set((candidate?.selectedJsxOccurrenceIds ?? (candidate?.edges ?? [])
    .map((edge) => edge?.occurrenceId)).filter((id) => typeof id === 'string'))];
  const detached = readPreviewInspectorDetachedTargetPlacement(candidate) !== undefined;
  if (expected.length === 0 || detached) {
    return { selectedPathObserved: true, missingOccurrenceIds: [], detachedOccurrenceProof: detached };
  }
  let best = 0;
  const boundaries = readPreviewInspectorTargetBoundaries(state);
  if (boundaries instanceof Set) for (const boundary of boundaries) {
    let fiber = readPreviewInspectorBoundaryFiber(boundary);
    const visited = new Set();
    let matched = 0;
    for (let depth = 0; fiber !== undefined && depth < 64 && !visited.has(fiber); depth += 1) {
      visited.add(fiber);
      const props = readPreviewInspectorOwnData(fiber, 'memoizedProps');
      const id = props !== null && typeof props === 'object'
        ? previewInspectorJsxOccurrenceProps.get(props) : undefined;
      if (matched < expected.length && id === expected[matched]) matched += 1;
      if (matched === expected.length) break;
      fiber = readPreviewInspectorFiberLink(fiber, 'return');
    }
    best = Math.max(best, matched);
    if (best === expected.length) break;
  }
  return {
    selectedPathObserved: best === expected.length,
    missingOccurrenceIds: expected.slice(best),
    detachedOccurrenceProof: false,
  };
}
`;
}
