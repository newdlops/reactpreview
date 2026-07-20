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
function readSelectedPreviewInspectorDataRequest(requests, preferredRequestId) {
  if (typeof preferredRequestId === 'string' && preferredRequestId.length > 0) {
    const preferred = requests.find((request) => request.id === preferredRequestId);
    if (preferred !== undefined) return preferred;
  }
  const selectedId = previewInspectorDevtoolsSessionState.selectedDataRequestId;
  return requests.find((request) => request.id === selectedId) ?? requests[0];
}

/** Restricts one embedded payload editor to compiler/tree-proven component request identities. */
function filterPreviewInspectorDataRequests(requests, requestIds) {
  if (!Array.isArray(requestIds)) return requests;
  const admittedRequestIds = new Set(requestIds);
  return requests.filter((request) => admittedRequestIds.has(request.id));
}

/** Uses the inferred payload as an editable starting point when the authored seed is empty. */
function readPreviewInspectorEditableDataPayload(request) {
  const payload = request?.payload;
  const emptyObject = payload !== null && typeof payload === 'object' &&
    !Array.isArray(payload) && Object.keys(payload).length === 0;
  return request?.mode === 'seed' && emptyObject ? request.suggestedPayload : payload;
}

/** Labels generated data provenance so a preview value cannot be mistaken for backend truth. */
function formatPreviewInspectorDataMode(mode) {
  if (mode === 'custom') return 'USER PAYLOAD';
  if (mode === 'smart-custom') return 'USER + SMART MINIMUM';
  if (mode === 'lorem') return 'GENERATED · LOREM';
  if (mode === 'smart') return 'GENERATED · SMART MINIMUM';
  if (mode === 'auto') return 'GENERATED · AUTO';
  return 'STATIC SEED';
}

/** Labels the selected virtual transport scenario independently from payload provenance. */
function formatPreviewInspectorVirtualBackendScenario(mode) {
  if (mode === 'empty') return 'EMPTY RESPONSE';
  if (mode === 'error') return 'ERROR RESPONSE';
  return 'SUCCESS RESPONSE';
}

/** Renders request selection, inferred evidence, JSON editing, and generation actions. */
function PreviewInspectorDataDetail({ requestId, requestIds } = {}) {
  const requests = filterPreviewInspectorDataRequests(
    readPreviewInspectorDataRequests(),
    requestIds,
  );
  const selectedRequest = readSelectedPreviewInspectorDataRequest(requests, requestId);
  const selectedId = selectedRequest?.id ?? '';
  const backend = selectedRequest?.virtualBackend ?? {
    latencyMs: 0,
    mode: 'success',
    scenario: 'success',
    status: 200,
  };
  const editablePayload = readPreviewInspectorEditableDataPayload(selectedRequest) ?? {};
  const servedPayload = selectedRequest?.servedPayload;
  const resourceStateDiffers = servedPayload !== undefined &&
    stringifyPreviewInspectorProps(servedPayload) !== stringifyPreviewInspectorProps(editablePayload);
  const draftKey = selectedId + ':' + String(selectedRequest?.mode ?? '') + ':' +
    stringifyPreviewInspectorProps(editablePayload);
  const [draftText, setDraftText] = React.useState(
    () => stringifyPreviewInspectorProps(editablePayload),
  );
  const [draftError, setDraftError] = React.useState('');
  React.useEffect(() => {
    setDraftText(stringifyPreviewInspectorProps(editablePayload));
    setDraftError('');
  }, [draftKey]);

  /** Selects a request without changing the rendered application or its current payload. */
  const selectRequest = (requestId) => {
    previewInspectorDevtoolsSessionState.selectedDataRequestId = requestId;
    persistPreviewInspectorState();
    schedulePreviewInspectorTreeRefresh();
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

  /** Switches transport outcome while retaining the user's latency choice. */
  const setBackendScenarioMode = (mode) => {
    if (selectedRequest === undefined) return;
    setPreviewInspectorVirtualBackendScenario(selectedRequest.id, {
      latencyMs: backend.latencyMs,
      mode,
      status: mode === 'error' ? 500 : 200,
    });
  };

  /** Applies a bounded latency preset without retaining an in-flight native request. */
  const setBackendLatency = (latencyMs) => {
    if (selectedRequest === undefined) return;
    setPreviewInspectorVirtualBackendScenario(selectedRequest.id, {
      latencyMs,
      mode: backend.mode ?? backend.scenario,
      status: backend.status,
    });
  };

  /** Selects a conventional HTTP failure while keeping the error scenario active. */
  const setBackendErrorStatus = (status) => {
    if (selectedRequest === undefined) return;
    setPreviewInspectorVirtualBackendScenario(selectedRequest.id, {
      latencyMs: backend.latencyMs,
      mode: 'error',
      status,
    });
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
              formatPreviewInspectorDataMode(selectedRequest.mode) + ' · ' +
                formatPreviewInspectorVirtualBackendScenario(backend.mode ?? backend.scenario),
            ),
            React.createElement('div', { className: 'rpi-meta' }, selectedRequest.label),
            React.createElement(
              'div',
              { className: 'rpi-note' },
              'Type evidence: ' + selectedRequest.evidence,
            ),
            React.createElement(
              'div',
              { className: 'rpi-note' },
              'Inferred properties: ' +
                (readPreviewInspectorDataShapePaths(selectedRequest.shape).join(', ') || '<response>'),
            ),
            React.createElement(
              'div',
              { className: 'rpi-note' },
              'Virtual resource: ' + String(backend.resourceKey ?? 'dynamic request') +
                (backend.stateful ? ' · stateful REST CRUD' : ' · operation fixture'),
            ),
            Array.isArray(backend.requestFields) && backend.requestFields.length > 0
              ? React.createElement(
                  'div',
                  { className: 'rpi-note' },
                  'Observed request fields: ' + backend.requestFields.join(', '),
                )
              : undefined,
            selectedRequest.sourcePath
              ? React.createElement(
                  'div',
                  { className: 'rpi-note' },
                  selectedRequest.sourcePath +
                    (selectedRequest.line ? ':' + String(selectedRequest.line) : ''),
                )
              : undefined,
          ),
          React.createElement(
            'div',
            { className: 'rpi-actions' },
            React.createElement(
              'label',
              { className: 'rpi-note' },
              'Response ',
              React.createElement(
                'select',
                {
                  'aria-label': 'Virtual backend response scenario',
                  className: 'rpi-select',
                  onChange: (event) => setBackendScenarioMode(event.target.value),
                  value: backend.mode ?? backend.scenario,
                },
                React.createElement('option', { value: 'success' }, 'Success'),
                React.createElement('option', { value: 'empty' }, 'Empty data'),
                React.createElement('option', { value: 'error' }, 'HTTP error'),
              ),
            ),
            React.createElement(
              'label',
              { className: 'rpi-note' },
              'Latency ',
              React.createElement(
                'select',
                {
                  'aria-label': 'Virtual backend latency',
                  className: 'rpi-select',
                  onChange: (event) => setBackendLatency(Number(event.target.value)),
                  value: String(backend.latencyMs ?? 0),
                },
                [0, 100, 500, 1000, 3000].map((latencyMs) => React.createElement(
                  'option',
                  { key: latencyMs, value: String(latencyMs) },
                  latencyMs === 0 ? 'Immediate' : String(latencyMs) + ' ms',
                )),
              ),
            ),
            (backend.mode ?? backend.scenario) === 'error'
              ? React.createElement(
                  'label',
                  { className: 'rpi-note' },
                  'Status ',
                  React.createElement(
                    'select',
                    {
                      'aria-label': 'Virtual backend error status',
                      className: 'rpi-select',
                      onChange: (event) => setBackendErrorStatus(Number(event.target.value)),
                      value: String(backend.status ?? 500),
                    },
                    [400, 401, 403, 404, 409, 422, 500, 503].map((status) =>
                      React.createElement('option', { key: status, value: String(status) }, String(status)),
                    ),
                  ),
                )
              : undefined,
          ),
          resourceStateDiffers
            ? React.createElement(
                'details',
                { className: 'rpi-source-card', open: true },
                React.createElement('summary', undefined, 'Current virtual resource response'),
                React.createElement(
                  'pre',
                  { className: 'rpi-json' },
                  stringifyPreviewInspectorProps(servedPayload),
                ),
              )
            : undefined,
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
              {
                onClick: () => smartFillPreviewInspectorDataPayload(selectedRequest.id),
                pressed: selectedRequest.mode === 'smart' || selectedRequest.mode === 'smart-custom',
                title: 'Generate only inferred response fields and one item per required list',
              },
              'Smart fill minimum',
            ),
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
            React.createElement(
              PreviewInspectorDevtoolsButton,
              {
                onClick: () => resetPreviewInspectorVirtualBackendResource(selectedRequest.id),
                title: 'Clear state created by GET/POST/PATCH/PUT/DELETE and regenerate this resource',
              },
              'Reset resource state',
            ),
            React.createElement(
              PreviewInspectorDevtoolsButton,
              {
                disabled: (backend.mode ?? backend.scenario) === 'success' &&
                  backend.status === 200 && backend.latencyMs === 0,
                onClick: () => resetPreviewInspectorVirtualBackendScenario(selectedRequest.id),
              },
              'Reset response scenario',
            ),
          ),
          React.createElement(
            'div',
            { className: 'rpi-note' },
            'Smart fill preserves user JSON, then adds one deterministic item per inferred list and only fields requested by the component. Successful REST mutations update the local resource store. Generated values never leave this preview.',
          ),
        ),
  );
}
`;
}
