/**
 * Generates the Page Inspector props editor shared by ordinary components and blocker repair.
 *
 * Keeping this UI separate from the component-tree shell leaves the Smart props policy testable and
 * prevents the already dense DevTools layout module from owning inference, persistence, and JSON
 * materialization details.
 */

/**
 * Creates the browser component that edits observed or compiler-generated component props.
 *
 * Expected lexical bindings include React, the Smart props runtime, blocker-value sentinels,
 * Inspector session/state functions, and the shared DevTools button component.
 *
 * @returns Plain JavaScript source concatenated before the Page Inspector DevTools shell.
 */
export function createPreviewInspectorPropsUiRuntimeSource(): string {
  return String.raw`
/** Formats a bounded generated-path inventory without allowing long component types to flood UI. */
function formatPreviewInspectorSmartPropPaths(paths) {
  const normalized = Array.isArray(paths) ? paths : [];
  const visible = normalized.slice(0, 16);
  return visible.join(', ') + (
    normalized.length > visible.length
      ? ' +' + String(normalized.length - visible.length) + ' more'
      : ''
  );
}

/** Formats a compiler-proven scalar option without losing its primitive type. */
function formatPreviewInspectorSmartPropChoiceValue(value) {
  if (typeof value === 'string') return value;
  try { return JSON.stringify(value); } catch { return String(value); }
}

/** Renders editable target/root Smart props or a clearly read-only arbitrary Fiber snapshot. */
function PreviewInspectorPropsDetail({ node, requiredPaths = [] }) {
  const editable = isPreviewInspectorUiNodeEditable(node);
  const exportName = editable ? node.exportName : undefined;
  const smartDraft = exportName === undefined
    ? undefined
    : createPreviewInspectorSmartPropsDraft(exportName, requiredPaths);
  const readOnlyValue = copyPreviewInspectorBlockerValueForJson(
    normalizePreviewInspectorProps(node?.props ?? {}),
    { nodes: 0 },
  );
  const editorValue = editable ? smartDraft?.value ?? {} : readOnlyValue ?? {};
  const choiceRecords = editable && exportName !== undefined
    ? readPreviewInspectorSmartPropChoiceRecords(exportName, editorValue)
    : [];
  const draftKey = (node?.id ?? '') + ':' +
    stringifyPreviewInspectorProps(requiredPaths) + ':' +
    stringifyPreviewInspectorProps(editorValue);
  const [draftText, setDraftText] = React.useState(
    () => stringifyPreviewInspectorProps(editorValue),
  );
  const [draftError, setDraftError] = React.useState('');
  React.useEffect(() => {
    setDraftText(stringifyPreviewInspectorProps(editorValue));
    setDraftError('');
  }, [draftKey]);

  /** Validates the JSON object while leaving function sentinels serializable in session state. */
  const applyDraft = () => {
    if (!editable || exportName === undefined) return;
    try {
      const value = JSON.parse(draftText);
      if (value === null || typeof value !== 'object' || Array.isArray(value)) {
        throw new TypeError('Props JSON must be an object.');
      }
      setPreviewInspectorFallbackValuesEnabled(true);
      setPreviewInspectorPropsOverride(exportName, value);
      setDraftError('');
    } catch (error) {
      setDraftError(error instanceof Error ? error.message : String(error));
    }
  };

  /** Regenerates and immediately applies the descriptor/error-backed minimum prop object. */
  const applySmartDraft = () => {
    if (!editable || exportName === undefined) return;
    const nextDraft = applyPreviewInspectorSmartProps(exportName, requiredPaths);
    setDraftText(stringifyPreviewInspectorProps(nextDraft.value));
    setDraftError('');
  };

  /** Applies one finite authored value while preserving every unrelated manual JSON override. */
  const applyChoice = (choice, rawIndex) => {
    if (!editable || exportName === undefined) return;
    const index = Number.parseInt(rawIndex, 10);
    if (!Number.isInteger(index) || index < 0 || index >= choice.candidates.length) return;
    const selectedValue = choice.candidates[index];
    const nextEditorValue = setPreviewInspectorSmartPropPathValue(
      editorValue,
      choice.path,
      selectedValue,
    );
    if (nextEditorValue === undefined) return;
    const applied = applyPreviewInspectorSmartPropChoice(
      exportName,
      choice,
      selectedValue,
    );
    if (applied === undefined) return;
    setDraftText(stringifyPreviewInspectorProps(nextEditorValue));
    setDraftError('');
  };

  const smartAvailable = smartDraft !== undefined && hasPreviewInspectorSmartPropsDraft(smartDraft);
  const generatedPathText = smartDraft === undefined
    ? ''
    : formatPreviewInspectorSmartPropPaths(smartDraft.generatedPaths);
  return React.createElement(
    'div',
    { className: 'rpi-detail-content' },
    React.createElement('div', { className: 'rpi-meta' }, editable
      ? smartAvailable
        ? 'Editable props · SMART DRAFT · ' + String(smartDraft.generatedPaths.length) + ' inferred/missing path(s)'
        : 'Editable instrumented target/root props'
      : 'Read-only Fiber props snapshot'),
    choiceRecords.length > 0
      ? React.createElement(
          'fieldset',
          { className: 'rpi-prop-choices' },
          React.createElement(
            'legend',
            null,
            'Source-proven choices · ' + String(choiceRecords.length),
          ),
          choiceRecords.map((choice) => {
            const selectedIndex = choice.candidates.findIndex((candidate) =>
              typeof candidate === typeof choice.currentValue &&
              Object.is(candidate, choice.currentValue),
            );
            return React.createElement(
              'label',
              { className: 'rpi-prop-choice', key: choice.path },
              React.createElement(
                'span',
                { className: 'rpi-prop-choice-copy' },
                React.createElement('strong', null, choice.path),
                React.createElement(
                  'span',
                  null,
                  selectedIndex < 0
                    ? 'Choose a valid value to continue'
                    : choice.selectionOrigin === 'automatic-repair'
                      ? 'Recovered automatically · choose another if needed'
                    : choice.userControlled === true
                      ? 'Selected by you'
                      : 'Automatic preview default',
                ),
              ),
              React.createElement(
                'select',
                {
                  'aria-label': 'Preview value for ' + choice.path,
                  className: 'rpi-select',
                  onChange: (event) => applyChoice(choice, event.target.value),
                  value: selectedIndex < 0 ? '' : String(selectedIndex),
                },
                selectedIndex < 0
                  ? React.createElement('option', { disabled: true, value: '' }, 'Choose a value')
                  : null,
                choice.candidates.map((candidate, index) => React.createElement(
                  'option',
                  { key: String(index), value: String(index) },
                  formatPreviewInspectorSmartPropChoiceValue(candidate),
                )),
              ),
            );
          }),
          React.createElement(
            'div',
            { className: 'rpi-note' },
            'The viewer inferred these options from authored branches. Choosing one remounts only this export.',
          ),
        )
      : null,
    React.createElement('textarea', {
      'aria-label': editable ? 'Editable component props JSON' : 'Read-only component props JSON',
      className: 'rpi-json',
      onChange: editable ? (event) => setDraftText(event.target.value) : undefined,
      readOnly: !editable,
      spellCheck: false,
      value: draftText,
    }),
    draftError.length > 0
      ? React.createElement('div', { className: 'rpi-error', role: 'alert' }, draftError)
      : null,
    editable
      ? React.createElement(
          'div',
          { className: 'rpi-actions' },
          React.createElement(
            PreviewInspectorDevtoolsButton,
            {
              disabled: !smartAvailable,
              onClick: applySmartDraft,
              title: 'Combine inferred types, JSX usage, observed props, and blocker paths',
            },
            'Smart fill props',
          ),
          React.createElement(PreviewInspectorDevtoolsButton, { onClick: applyDraft }, 'Apply props'),
          React.createElement(
            PreviewInspectorDevtoolsButton,
            { onClick: () => resetPreviewInspectorPropsOverride(exportName) },
            'Reset props',
          ),
        )
      : null,
    editable && generatedPathText.length > 0
      ? React.createElement(
          'div',
          { className: 'rpi-note' },
          'Smart-generated preview paths: ' + generatedPathText,
        )
      : null,
    editable && requiredPaths.length > 0
      ? React.createElement(
          'div',
          { className: 'rpi-note' },
          'Blocker fields were matched to full component prop paths where static usage proved them.',
        )
      : null,
    editable && !smartAvailable
      ? React.createElement(
          'div',
          { className: 'rpi-note' },
          'No safe prop shape is proven yet. Enter JSON manually; a later runtime failure can add exact missing-field evidence.',
        )
      : null,
    React.createElement('div', { className: 'rpi-note' }, editable
      ? 'Synthetic callbacks appear as ' + PREVIEW_INSPECTOR_NOOP_VALUE_SENTINEL +
        ', while component props appear as ' + PREVIEW_INSPECTOR_COMPONENT_VALUE_SENTINEL +
        ' and become inert functions only while rendering. Changes remount only this export.'
      : 'Arbitrary Fiber props are observational and cannot be safely rewritten.'),
  );
}
`;
}
