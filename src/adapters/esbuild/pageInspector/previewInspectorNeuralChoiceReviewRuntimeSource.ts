import { createPreviewInspectorChoiceFocusScript } from '../../../presentation/webview/previewInspectorChoiceFocusScript';

/** Generates bounded choice summaries and navigation, never new candidates or neural inference. */
export function createPreviewInspectorNeuralChoiceReviewRuntimeSource(): string {
  return String.raw`
${createPreviewInspectorChoiceFocusScript()}
/** Formats source metadata without JSON serialization or coercing arbitrary project objects. */
function formatPreviewInspectorNeuralChoiceReviewValue(value, limit = 64) {
  if (value === null) return 'null';
  if (typeof value === 'boolean' || typeof value === 'number' && Number.isFinite(value)) return String(value);
  let label;
  try { label = typeof value === 'string' ? value : Object.getOwnPropertyDescriptor(value, 'label')?.value; }
  catch { return 'Unlabeled option'; }
  if (typeof label !== 'string') return 'Unlabeled option';
  if (label.length === 0) return 'Empty string';
  const text = label.slice(0, limit).replace(/[\uD800-\uDBFF]$/u, '').replace(/\s+/gu, ' ');
  return text + (label.length > limit ? '…' : '');
}

/** Shows actual decision names and bounded option previews from the already-read handoff list. */
function readPreviewInspectorNeuralChoiceReview(userChoices, userChoice) {
  const choices = Array.isArray(userChoices) && userChoices.length > 0 ? userChoices : [userChoice].filter(Boolean);
  const first = choices[0];
  if (first?.surface === 'page-context') return {
    hasOptions: false, label: 'Compare page paths',
    lines: ['Choose which consuming page should render the selected file.'],
  };
  const decisions = choices.flatMap(choice => choice?.surface === 'page-context' ? [] :
    (Array.isArray(choice?.choiceRecords) ? choice.choiceRecords : [])
      .filter(record => typeof record?.path === 'string' && record.path.length > 0 && Array.isArray(record.candidates) && record.candidates.length > 0)
      .map(record => ({ choice, record })));
  if (decisions.length === 0) return {
    hasOptions: false, label: 'Inspect blocked step',
    lines: ['No selectable option is available. Open the condition or blocker details.'],
  };
  const { choice, record } = decisions[0];
  const format = formatPreviewInspectorNeuralChoiceReviewValue;
  const label = decisions.length > 1 ? 'Show ' + String(decisions.length) + ' decisions'
    : record.kind === 'page-control' ? 'Choose a page action'
    : choice.choiceKind === 'render-condition' ? 'Choose branch: ' + format(record.path)
    : 'Choose ' + format(record.path);
  const lines = decisions.slice(0, 3).map(({ record }) => {
    const options = record.candidates.slice(0, 3).map(candidate => format(candidate) +
      (candidate?.disabled === true ? ' (unavailable)' : '')).join(' / ');
    return (decisions.length > 1 ? format(record.path) + ': ' : '') + options +
      (record.candidates.length > 3 ? ' · +' + String(record.candidates.length - 3) + ' more options' : '');
  });
  if (decisions.length > 3) lines.push('+' + String(decisions.length - 3) +
    (decisions.length === 4 ? ' more decision in the list' : ' more decisions in the list'));
  return { hasOptions: true, label, lines };
}

/** Opens the inline editor in both surfaces; the details button keeps its existing separate action. */
function revealPreviewInspectorNeuralChoiceControls() {
  const shell = typeof previewInspectorCompanionState === 'object' ? previewInspectorCompanionState?.shell : undefined;
  const root = shell ?? (typeof document === 'object' ? document.querySelector?.('.rpi-shell') : undefined);
  if (!focusPreviewInspectorChoiceControls(root)) return false;
  if (typeof requestPreviewInspectorCompanionContextReveal === 'function') {
    requestPreviewInspectorCompanionContextReveal('neural-choices');
  }
  return true;
}
`;
}
