/**
 * Generates the editable backend-payload panel for React Page Inspector.
 *
 * The panel is presentation-only. Request interception, type inference, persistence, and remounting
 * remain in the data runtime so future transports can register payloads without changing the UI.
 */

/**
 * Creates browser source for the Inspector's Payloads tab.
 *
 * Expected lexical bindings include React, the shared Inspector store, JSON helpers, data-registry
 * operations, and `PreviewInspectorDevtoolsButton` from the surrounding DevTools runtime.
 *
 * @returns Plain JavaScript source concatenated before the details pane is declared.
 */
export function createPreviewInspectorDataUiRuntimeSource(): string {
  return String.raw`
/** Returns the persisted request selection, falling back to the first currently observed request. */
function readSelectedPreviewInspectorDataRequest(requests) {
  const selectedId = previewInspectorDevtoolsSessionState.selectedDataRequestId;
  return requests.find((request) => request.id === selectedId) ?? requests[0];
}

/** Labels generated data provenance so a preview value cannot be mistaken for backend truth. */
function formatPreviewInspectorDataMode(mode) {
  if (mode === 'custom') return 'USER PAYLOAD';
  if (mode === 'lorem') return 'GENERATED · LOREM';
  if (mode === 'auto') return 'GENERATED · AUTO';
  return 'STATIC SEED';
}

/** Renders request selection, inferred evidence, JSON editing, and generation actions. */
function PreviewInspectorDataDetail() {
  const requests = readPreviewInspectorDataRequests();
  const selectedRequest = readSelectedPreviewInspectorDataRequest(requests);
  const selectedId = selectedRequest?.id ?? '';
  const draftKey = selectedId + ':' + String(selectedRequest?.mode ?? '') + ':' +
    stringifyPreviewInspectorProps(selectedRequest?.payload ?? {});
  const [draftText, setDraftText] = React.useState(
    () => stringifyPreviewInspectorProps(selectedRequest?.payload ?? {}),
  );
  const [draftError, setDraftError] = React.useState('');
  React.useEffect(() => {
    setDraftText(stringifyPreviewInspectorProps(selectedRequest?.payload ?? {}));
    setDraftError('');
  }, [draftKey]);

  /** Selects a request without changing the rendered application or its current payload. */
  const selectRequest = (requestId) => {
    previewInspectorDevtoolsSessionState.selectedDataRequestId = requestId;
    persistPreviewInspectorState();
    notifyPreviewInspector();
  };

  /** Parses arbitrary JSON because API roots may legitimately be objects, arrays, or scalars. */
  const applyDraft = () => {
    if (selectedRequest === undefined) return;
    try {
      setPreviewInspectorDataPayload(selectedRequest.id, JSON.parse(draftText), 'custom');
      setDraftError('');
    } catch (error) {
      setDraftError(error instanceof Error ? error.message : String(error));
    }
  };

  /** Restores inferred generation for this request and turns on the global Auto boundary. */
  const useAutoPayload = () => {
    if (selectedRequest !== undefined) resetPreviewInspectorDataPayload(selectedRequest.id);
    setPreviewInspectorDataAutoEnabled(true);
  };

  return React.createElement(
    'div',
    { className: 'rpi-detail-content' },
    React.createElement(
      'div',
      { className: 'rpi-actions' },
      React.createElement(
        PreviewInspectorDevtoolsButton,
        {
          onClick: () => setPreviewInspectorDataAutoEnabled(!readPreviewInspectorDataAutoEnabled()),
          pressed: readPreviewInspectorDataAutoEnabled(),
          title: 'Infer backend payload types and generate local values automatically',
        },
        'Auto payloads',
      ),
      requests.length > 0
        ? React.createElement(
            'select',
            {
              'aria-label': 'Observed backend request',
              className: 'rpi-select',
              onChange: (event) => selectRequest(event.target.value),
              value: selectedId,
            },
            requests.map((request) => React.createElement(
              'option',
              { key: request.id, value: request.id },
              request.label,
            )),
          )
        : undefined,
    ),
    selectedRequest === undefined
      ? React.createElement(
          'div',
          { className: 'rpi-empty' },
          'No API or GraphQL payload has been observed yet. Auto payloads will appear here when the page requests backend data.',
        )
      : React.createElement(
          React.Fragment,
          undefined,
          React.createElement(
            'div',
            { className: 'rpi-source-card' },
            React.createElement(
              'strong',
              undefined,
              formatPreviewInspectorDataMode(selectedRequest.mode),
            ),
            React.createElement('div', { className: 'rpi-meta' }, selectedRequest.label),
            React.createElement(
              'div',
              { className: 'rpi-note' },
              'Type evidence: ' + selectedRequest.evidence,
            ),
            selectedRequest.sourcePath
              ? React.createElement(
                  'div',
                  { className: 'rpi-note' },
                  selectedRequest.sourcePath +
                    (selectedRequest.line ? ':' + String(selectedRequest.line) : ''),
                )
              : undefined,
          ),
          React.createElement('textarea', {
            'aria-label': 'Preview backend payload JSON',
            className: 'rpi-json',
            onChange: (event) => setDraftText(event.target.value),
            spellCheck: false,
            value: draftText,
          }),
          draftError.length > 0
            ? React.createElement('div', { className: 'rpi-error', role: 'alert' }, draftError)
            : undefined,
          React.createElement(
            'div',
            { className: 'rpi-actions' },
            React.createElement(
              PreviewInspectorDevtoolsButton,
              { onClick: applyDraft },
              'Apply JSON',
            ),
            React.createElement(
              PreviewInspectorDevtoolsButton,
              {
                onClick: () => generatePreviewInspectorLoremPayload(selectedRequest.id),
                title: 'Generate deterministic lorem values while retaining inferred field types',
              },
              'Generate Lorem',
            ),
            React.createElement(
              PreviewInspectorDevtoolsButton,
              { onClick: useAutoPayload, pressed: selectedRequest.mode === 'auto' },
              'Use Auto',
            ),
            React.createElement(
              PreviewInspectorDevtoolsButton,
              {
                disabled: selectedRequest.mode === 'auto' || selectedRequest.mode === 'seed',
                onClick: () => resetPreviewInspectorDataPayload(selectedRequest.id),
              },
              'Reset override',
            ),
          ),
          React.createElement(
            'div',
            { className: 'rpi-note' },
            'Generated values are local preview fixtures. No API, GraphQL server, credentials, or backend transport was used.',
          ),
        ),
  );
}
`;
}
