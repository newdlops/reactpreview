/** Generates the Inspector pane that makes every automatically bypassed hook edge explicit. */

/**
 * Creates browser presentation source for render-only runtime fallback records.
 *
 * Expected lexical bindings include React, Auto values controls, fallback inventory reads, and the
 * shared Inspector button/source-navigation helpers. The pane does not mutate project state.
 *
 * @returns Plain JavaScript source concatenated into the isolated DevTools Shadow DOM runtime.
 */
export function createPreviewInspectorRuntimeFallbackUiRuntimeSource(): string {
  return String.raw`
/** Renders all hook failures/nullish edges currently replaced by compiler-generated static values. */
function PreviewInspectorRuntimeFallbackDetail() {
  const fallbacks = readPreviewInspectorRuntimeFallbacks();
  const enabled = readPreviewInspectorFallbackValuesEnabled();
  return React.createElement(
    'div',
    { className: 'rpi-detail-content' },
    React.createElement(
      'div',
      { className: 'rpi-actions' },
      React.createElement(
        PreviewInspectorDevtoolsButton,
        {
          onClick: () => setPreviewInspectorFallbackValuesEnabled(!enabled),
          pressed: enabled,
          title: 'Use generated values only when a render-critical hook fails or is nullish',
        },
        'Render-only fallbacks',
      ),
      React.createElement(
        'span',
        { className: 'rpi-meta' },
        String(fallbacks.length) + ' bypassed hook edge(s)',
      ),
    ),
    fallbacks.length === 0
      ? React.createElement(
          'div',
          { className: 'rpi-empty' },
          enabled
            ? 'No render-blocking hook has required a generated value.'
            : 'Render-only fallbacks are off; authored runtime failures are preserved.',
        )
      : fallbacks.map((fallback) => React.createElement(
          'div',
          { className: 'rpi-source-card', key: fallback.id },
          React.createElement(
            'strong',
            undefined,
            fallback.hookName + ' · GENERATED RENDER VALUE',
          ),
          React.createElement(
            'div',
            { className: 'rpi-meta' },
            fallback.reason === 'threw' ? 'Runtime exception bypassed' : 'Required nullish value replaced',
          ),
          fallback.error
            ? React.createElement('div', { className: 'rpi-error' }, fallback.error)
            : undefined,
          React.createElement('div', { className: 'rpi-note' }, 'Generated: ' + fallback.fallbackPreview),
          React.createElement('div', { className: 'rpi-note' }, 'Evidence: ' + fallback.evidence),
          React.createElement(
            'div',
            { className: 'rpi-note' },
            fallback.sourcePath + (fallback.line ? ':' + String(fallback.line) : ''),
          ),
        )),
    React.createElement(
      'div',
      { className: 'rpi-note' },
      'These values exist only to keep visual React output mounted. They are never backend, user, or application truth. Turn the boundary off to reproduce the authored runtime failure.',
    ),
  );
}
`;
}
