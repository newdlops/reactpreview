/** Creates presentation-only guidance from existing, source-proven decisions. */
export function createPreviewInspectorNeuralChoiceGuidanceUiRuntimeSource(): string {
  return String.raw`
/** Names the field or branch being chosen, instead of exposing the resolver's generic title. */
function describePreviewInspectorNeuralChoiceHeading(choice) {
  const records = (choice?.choiceRecords ?? []).filter((record) =>
    typeof record?.path === 'string' && record.path.length > 0 && Array.isArray(record.candidates) && record.candidates.length > 0);
  const owner = choice?.exportName ?? choice?.node?.name;
  const ownerLabel = typeof owner === 'string' && owner.length > 0 ? ' for ' + owner : '';
  if (records.length === 0) return 'Review the blocked step' + ownerLabel;
  if (records[0].kind === 'page-control') return 'Choose a page action' + ownerLabel;
  if (choice?.choiceKind === 'render-condition') return 'Choose a branch for ' + records[0].path;
  return (records.length === 1 ? 'Choose ' + records[0].path : 'Choose preview values') + ownerLabel;
}

/** Explains the scope of one real decision without promising that it will fix the page. */
function describePreviewInspectorNeuralChoiceEffect(choice, record) {
  if (record?.kind === 'page-control') {
    return 'Activates the selected control on the rendered page. Pick an action, then Continue on page.';
  }
  if (choice?.choiceKind === 'render-condition') {
    return 'Changes which authored JSX branch renders in this preview. Pick a branch, then Apply branch.';
  }
  if (choice?.choiceKind === 'source-proven-prop') {
    return 'Sets ' + record.path + ' in this preview only. Pick a value, then apply it; rendering will be checked again.';
  }
  return 'Changes the preview fallback for ' + record.path + '. Pick a strategy, then Apply strategy.';
}

/** Keeps a real navigation action visible when the decision lives outside the inline value editor. */
function PreviewInspectorNeuralChoiceHandoff({ choices, targetRendered }) {
  const choice = choices.find((item) => item?.surface === 'page-context') ??
    choices.find((item) => item?.node !== undefined);
  const status = typeof readPreviewInspectorNeuralLearningStatus === 'function'
    ? readPreviewInspectorNeuralLearningStatus() : undefined;
  if (choice === undefined && (status?.phase !== 'needs-choice' || targetRendered)) return null;
  const pageChoice = choice?.surface === 'page-context';
  const diagnosis = pageChoice && typeof readPreviewInspectorCurrentVisibilityDiagnosis === 'function'
    ? readPreviewInspectorCurrentVisibilityDiagnosis() : undefined;
  const unmountedTarget = diagnosis?.kind === 'unmounted-target';
  const action = unmountedTarget ? diagnosis.actionLabel
    : pageChoice ? 'Open page paths' : choice !== undefined ? 'Open blocker details' : 'Inspect conditions';
  return React.createElement(
    'fieldset',
    { className: 'rpi-neural-choice-list', 'aria-label': 'Next action for the blocked preview' },
    React.createElement('legend', undefined, unmountedTarget ? 'Review target evidence'
      : pageChoice ? 'Choose a page path' : 'Review the blocked step'),
    React.createElement('div', { className: 'rpi-neural-choice-scroll', role: 'region', tabIndex: 0,
      'aria-label': 'Blocked preview guidance' },
      React.createElement('div', { className: 'rpi-neural-choice-origin-note' },
        'Inspector navigation · these controls are not part of the original page.'),
      React.createElement('div', { className: 'rpi-neural-choice-intro' },
        unmountedTarget ? diagnosis.description : pageChoice
          ? 'Choose which source-proven page should render the selected component. Open page paths to compare them and apply one.'
          : 'No selectable value is available here. Inspect the blocked condition or page control; waiting alone does not select a value.'),
      !unmountedTarget && typeof choice?.title === 'string'
        ? React.createElement('div', { className: 'rpi-neural-choice-empty' }, choice.title) : null,
      React.createElement(PreviewInspectorDevtoolsButton, {
        onClick: () => {
          if (unmountedTarget) {
            activatePreviewInspectorVisibilityDiagnosis(diagnosis);
            return;
          }
          if (choice !== undefined && revealPreviewInspectorNeuralUserChoice(choice)) return;
          if (typeof requestPreviewInspectorWorkbenchTab === 'function') requestPreviewInspectorWorkbenchTab('scenarios');
        },
        title: action,
      }, action),
    ),
  );
}
`;
}
