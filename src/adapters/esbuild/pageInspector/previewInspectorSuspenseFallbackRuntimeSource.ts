/** Generates bounded, resumable checkpoints for an exact selected authored Suspense fallback. */

/** Holds only viewer-owned promises; original children and fallback elements remain unchanged. */
export function createPreviewInspectorSuspenseFallbackRuntimeSource(): string {
  return String.raw`
const previewInspectorSelectedSuspenseCheckpoints = new Map();
const PREVIEW_INSPECTOR_SELECTED_SUSPENSE_CHECKPOINT_LIMIT = 24;

/** This private child suspends the real authored Suspense; it never calls project handlers. */
function PreviewInspectorSelectedSuspenseCheckpoint({ checkpoint, children }) {
  if (checkpoint.released !== true) throw checkpoint.promise;
  return children;
}

/** Selects only React's actual Suspense type and the compiler-proven exact fallback JSX site. */
function preparePreviewInspectorSelectedSuspenseProps(type, props) {
  if (type !== React.Suspense || props === null || typeof props !== 'object' ||
    previewInspectorSession.fallbackValuesEnabled !== true) return props;
  const fallback = readPreviewInspectorOwnData(props, 'fallback');
  const fallbackProps = readPreviewInspectorOwnData(fallback, 'props');
  const id = fallbackProps !== null && typeof fallbackProps === 'object'
    ? previewInspectorJsxOccurrenceProps.get(fallbackProps) : undefined;
  const candidate = readSelectedPreviewInspectorPageCandidate(findSelectedPreviewInspectorDescriptor());
  if (typeof id !== 'string' || !(candidate?.selectedSuspenseFallbackOccurrenceIds ?? []).includes(id) ||
    typeof candidate?.id !== 'string') return props;
  if (typeof readPreviewInspectorReleasedNeuralTemporalStateContract === 'function' &&
    readPreviewInspectorReleasedNeuralTemporalStateContract(candidate.id) !== undefined) return props;
  const key = String(previewEntryRevision) + '\0' + candidate.id + '\0' + id;
  let checkpoint = previewInspectorSelectedSuspenseCheckpoints.get(key);
  if (checkpoint?.released === true) return props;
  if (checkpoint === undefined) {
    while (previewInspectorSelectedSuspenseCheckpoints.size >= PREVIEW_INSPECTOR_SELECTED_SUSPENSE_CHECKPOINT_LIMIT) {
      const oldestKey = previewInspectorSelectedSuspenseCheckpoints.keys().next().value;
      const oldest = previewInspectorSelectedSuspenseCheckpoints.get(oldestKey);
      if (oldest !== undefined) { oldest.released = true; oldest.resolve(); }
      previewInspectorSelectedSuspenseCheckpoints.delete(oldestKey);
    }
    let resolve;
    const promise = new Promise((release) => { resolve = release; });
    checkpoint = { candidateId: candidate.id, entryRevision: previewEntryRevision, promise, resolve, released: false };
    previewInspectorSelectedSuspenseCheckpoints.set(key, checkpoint);
  }
  return { ...props, children: React.createElement(PreviewInspectorSelectedSuspenseCheckpoint, {
    checkpoint, children: props.children,
  }) };
}

/** Adds a temporal success signal only for a checkpoint belonging to this active revision/path. */
function hasPreviewInspectorSelectedSuspenseCheckpoint(state) {
  const candidateId = state?.candidateId ?? previewInspectorSession.selectedPageCandidateId;
  return [...previewInspectorSelectedSuspenseCheckpoints.values()].some((checkpoint) =>
    checkpoint.released !== true && checkpoint.entryRevision === previewEntryRevision &&
    checkpoint.candidateId === candidateId);
}

/** The existing Resume action resolves the private promise and exposes untouched authored children. */
function releasePreviewInspectorSelectedSuspenseCheckpoints(candidateId) {
  let released = 0;
  for (const checkpoint of previewInspectorSelectedSuspenseCheckpoints.values()) {
    if (checkpoint.candidateId !== candidateId || checkpoint.released === true) continue;
    checkpoint.released = true;
    checkpoint.resolve();
    released += 1;
  }
  return released;
}
`;
}
