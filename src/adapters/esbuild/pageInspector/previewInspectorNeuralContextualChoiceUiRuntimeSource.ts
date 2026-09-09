/** Generates a focused next-step view with source evidence and explicit uncertainty. */
export function createPreviewInspectorNeuralContextualChoiceUiRuntimeSource(): string {
  return String.raw`
/** Keeps source-backed possibilities distinct from learned or output-verified recommendations. */
function PreviewInspectorNeuralContextualChoiceSummary({ applyError, canApply, derivation, onApply }) {
  const paths = Array.isArray(derivation.paths) ? derivation.paths : [];
  const context = derivation.context ?? {};
  const target = context.targetName || 'the selected component';
  const recommendation = readPreviewInspectorNeuralRecommendedChoicePath(derivation);
  const renderPath = (path) => React.createElement(
    'li',
    { key: path.id, 'data-recommended': path.id === recommendation?.id ? 'true' : 'false' },
    React.createElement(
      'div',
      { className: 'rpi-neural-choice-path-copy' },
      path.id === recommendation?.id ? createPreviewInspectorNeuralChoiceBadge() : null,
      React.createElement('strong', undefined, path.label),
      React.createElement('span', { className: 'rpi-neural-choice-origin' }, 'Inspector proposal · built from available choices'),
      React.createElement('span', undefined, path.reason || 'Review the source before applying this step.'),
      React.createElement('span', undefined,
        path.verified === true ? 'Stable output verified on this path.'
          : path.id === recommendation?.id ? 'Suggested by repeated local outcomes; this output is not yet verified.'
          : path.failureCount > 0 ? 'Previously failed in this context; review before retrying.'
          : 'Source-backed possibility · output not yet verified.'),
    ),
    React.createElement(
      'button',
      {
        className: 'rpi-button', disabled: !canApply(path), type: 'button',
        'aria-label': 'Apply next step: ' + path.label +
          (path.id === recommendation?.id ? ' · Neural choice recommendation' : ''),
        onClick: () => onApply(path),
        title: 'Apply only this change and pause automatic work. Other page values stay unchanged.',
      },
      path.id === recommendation?.id ? 'Apply suggestion' : 'Try step',
    ),
  );
  return React.createElement(
    'section',
    {
      'aria-label': 'Page-aware next steps', className: 'rpi-neural-choice-paths rpi-neural-context',
      'data-path-count': String(paths.length),
    },
    React.createElement('strong', undefined, 'Page-aware next steps'),
    typeof applyError === 'string' && applyError.length > 0
      ? React.createElement('div', { className: 'rpi-error', role: 'alert' }, applyError) : null,
    React.createElement('div', { className: 'rpi-neural-choice-intro' },
      [context.rootName, context.route].filter(Boolean).join(' · ') || 'Page route not available'),
    React.createElement('div', { className: 'rpi-neural-choice-intro' },
      context.goal === 'preserve-output' ? 'Goal: keep ' + target + ' visible while testing a variant.'
        : 'Goal: reach rendered output for ' + target + '.'),
    React.createElement('div', { className: 'rpi-neural-choice-intro' },
      paths.length === 0
        ? derivation.truncated === true
          ? 'Too many source decisions to compare safely. Narrow the target or use the manual controls above.'
          : 'No next step has enough page-context evidence. Review the source or use the manual controls above.'
        : recommendation === undefined
          ? 'These changes match the blocked page path. No learned recommendation yet; try one and verify its output.'
          : 'The suggested step combines this page’s source context with local outcome evidence.'),
    paths.length === 0 ? null : React.createElement(
      'ol', { className: 'rpi-neural-context-steps' }, paths.slice(0, 3).map(renderPath),
    ),
    paths.length <= 3 ? null : React.createElement(
      'details', { className: 'rpi-neural-choice-path-alternatives' },
      React.createElement('summary', undefined, 'More context-linked steps · ' + String(paths.length - 3)),
      React.createElement('ol', undefined, paths.slice(3).map(renderPath)),
    ),
  );
}
`;
}
