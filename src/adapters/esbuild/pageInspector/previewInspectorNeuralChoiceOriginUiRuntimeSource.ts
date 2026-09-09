/** Presents option provenance separately from Inspector selection, ranking and runtime state. */

/** Creates read-only labels from existing choice contracts; it never discovers or applies values. */
export function createPreviewInspectorNeuralChoiceOriginUiRuntimeSource(): string {
  return String.raw`
/** Classifies what an option does without treating a source value as a mounted page control. */
function readPreviewInspectorNeuralChoiceOrigin(choice, record, candidate) {
  const action = candidate !== null && typeof candidate === 'object' ? candidate.actionKind : undefined;
  if (choice?.choiceKind === 'render-condition' && record?.kind === 'page-control' && action === 'page-control') {
    return { label: 'Original page option',
      detail: 'An existing control on the rendered page, mirrored here by Inspector.' };
  }
  if (choice?.choiceKind === 'render-condition' && action === 'condition-override') {
    return { label: 'Code-defined branch',
      detail: 'A branch found in JSX. Inspector pins it for this preview; it is not a page button.' };
  }
  if (choice?.choiceKind === 'render-condition' && action === 'condition-authored') {
    return { label: 'Inspector reset',
      detail: 'Removes the preview override. This reset action is not an original page option.' };
  }
  if (choice?.choiceKind === 'source-proven-prop' &&
      (candidate === null || ['string', 'boolean'].includes(typeof candidate) ||
        typeof candidate === 'number' && Number.isFinite(candidate))) {
    return { label: 'Code-defined value',
      detail: 'A value found in source code, offered as a preview override; no page control is implied.' };
  }
  if (choice?.choiceKind === 'runtime-fallback' && ['runtime-smart', 'runtime-auto'].includes(action) ||
      choice?.choiceKind === 'data-request' && ['data-smart', 'data-auto', 'data-lorem'].includes(action)) {
    return { label: 'Inspector recovery',
      detail: 'A preview-only generation strategy supplied by Inspector, not an original page option.' };
  }
  return { label: 'Source unverified',
    detail: 'Inspector has not verified whether this value represents an original page option.' };
}

/** Identifies observed current values independently from a staged Inspector selection. */
function readPreviewInspectorNeuralChoiceCurrentLabel(choice, record, candidate) {
  if (choice?.choiceKind === 'render-condition' && record?.kind === 'page-control') {
    return candidate?.actionKind === 'page-control' && candidate.selected === true ? 'On page now' : '';
  }
  if (choice?.choiceKind === 'render-condition' && candidate?.actionKind === 'condition-override') {
    const condition = choice?.node?.condition ?? choice?.node?.blocker;
    return condition?.reached !== false && typeof condition?.effectiveEnabled === 'boolean' &&
      condition.effectiveEnabled === candidate.value ? 'In preview now' : '';
  }
  if (choice?.choiceKind === 'source-proven-prop' && record?.currentValue !== undefined &&
      Object.is(record.currentValue, candidate)) return 'In preview now';
  return '';
}
`;
}
