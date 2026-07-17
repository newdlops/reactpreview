/**
 * Generates the small caller-path selector embedded in the Page Inspector context strip.
 * Keeping this presentation fragment separate lets the main DevTools source stay below the
 * project's 1000-line file limit while candidate discovery and loading remain runtime concerns.
 */

/**
 * Creates a native, keyboard-accessible selector for authored page-root candidates.
 *
 * Expected lexical bindings are `React` and the candidate runtime helpers composed into the same
 * browser entry.
 *
 * @returns Plain JavaScript source consumed by the Inspector DevTools source generator.
 */
export function createPreviewInspectorPageCandidateUiRuntimeSource(): string {
  return String.raw`
/** Renders all proven caller paths and switches the mounted authored page without rebuilding it. */
function PreviewInspectorPageCandidateSelect({ descriptor }) {
  const candidates = readPreviewInspectorPageCandidates(descriptor);
  const selected = readSelectedPreviewInspectorPageCandidate(descriptor);
  if (candidates.length === 0) return undefined;
  return React.createElement(
    'label',
    {
      className: 'rpi-candidate-select',
      title: candidates.length > 1
        ? 'Choose which authored caller path should construct the visible page.'
        : 'Only one mountable authored caller path was proven.',
    },
    React.createElement('span', { className: 'rpi-context-badge' }, 'PAGE PATH'),
    React.createElement(
      'select',
      {
        'aria-label': 'Authored page caller path',
        className: 'rpi-select',
        disabled: candidates.length < 2,
        onChange: (event) => selectPreviewInspectorPageCandidate(event.target.value),
        value: selected?.id ?? candidates[0]?.id ?? '',
      },
      candidates.map((candidate, index) => React.createElement(
        'option',
        { key: candidate.id, value: candidate.id },
        formatPreviewInspectorPageCandidate(candidate, index),
      )),
    ),
  );
}
`;
}
