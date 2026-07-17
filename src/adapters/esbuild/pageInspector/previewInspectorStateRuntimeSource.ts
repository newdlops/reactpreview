/**
 * Generates serializable Page Inspector state normalization and VS Code webview persistence helpers.
 *
 * Session creation and React subscriptions remain in the main runtime; this module isolates JSON,
 * prototype-safety, and host-state transport so feature-specific registries can share one policy.
 */

/**
 * Creates persistence helpers concatenated before the pinned Inspector session is initialized.
 *
 * Expected lexical bindings include `previewHotRuntime`, `PREVIEW_INSPECTOR_STATE_KEY`, the blocked
 * property-name set, and condition serialization helpers declared by the composed browser runtime.
 *
 * @returns Plain JavaScript source with no project imports or host capabilities beyond webview state.
 */
export function createPreviewInspectorStateRuntimeSource(): string {
  return String.raw`
/** Reads the serializable inspector subset retained by VS Code across full webview reloads. */
function readPersistedPreviewInspectorState() {
  try {
    const webviewState = previewHotRuntime.vscodeApi?.getState?.();
    const inspectorState = webviewState?.[PREVIEW_INSPECTOR_STATE_KEY];
    return inspectorState !== null && typeof inspectorState === 'object'
      ? inspectorState
      : {};
  } catch {
    return {};
  }
}

/** Copies only safe own properties so JSON input cannot mutate an object's prototype. */
function normalizePreviewInspectorProps(value) {
  const normalized = Object.create(null);
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    return normalized;
  }
  for (const [name, propertyValue] of Object.entries(value)) {
    if (!blockedInspectorPropNames.has(name)) {
      normalized[name] = propertyValue;
    }
  }
  return normalized;
}

/** Produces bounded JSON for the editor while skipping functions, symbols, cycles, and prototypes. */
function stringifyPreviewInspectorProps(value) {
  const seen = new WeakSet();
  try {
    return JSON.stringify(
      value,
      (name, propertyValue) => {
        if (blockedInspectorPropNames.has(name)) {
          return undefined;
        }
        if (typeof propertyValue === 'bigint') {
          return propertyValue.toString();
        }
        if (
          propertyValue === undefined ||
          typeof propertyValue === 'function' ||
          typeof propertyValue === 'symbol'
        ) {
          return undefined;
        }
        if (propertyValue !== null && typeof propertyValue === 'object') {
          if (seen.has(propertyValue)) {
            return '[Circular]';
          }
          seen.add(propertyValue);
        }
        return propertyValue;
      },
      2,
    ) ?? '{}';
  } catch {
    return '{}';
  }
}

/** Persists user-authored controls without retaining DOM nodes or project function values. */
function persistPreviewInspectorState() {
  const vscodeApi = previewHotRuntime.vscodeApi;
  if (typeof vscodeApi?.setState !== 'function') {
    return;
  }
  const overrides = Object.fromEntries(
    [...previewInspectorSession.overridesByExport].map(([name, value]) => [
      name,
      JSON.parse(stringifyPreviewInspectorProps(value)),
    ]),
  );
  try {
    const currentState = vscodeApi.getState?.();
    vscodeApi.setState({
      ...(currentState !== null && typeof currentState === 'object' ? currentState : {}),
      [PREVIEW_INSPECTOR_STATE_KEY]: {
        dataAutoEnabled: readPreviewInspectorDataAutoEnabled(),
        dataPayloadOverrides: serializePreviewInspectorDataOverrides(),
        fallbackValuesEnabled: readPreviewInspectorFallbackValuesEnabled(),
        renderConditionOverrides: serializePreviewInspectorRenderConditionOverrides(),
        devtoolsState: JSON.parse(
          stringifyPreviewInspectorProps(previewInspectorSession.devtoolsState ?? {}),
        ),
        highlightEnabled: previewInspectorSession.highlightEnabled,
        overrides,
        selectedExportName: previewInspectorSession.selectedExportName,
        selectedPageCandidateId: previewInspectorSession.selectedPageCandidateId,
        selectedTreeNodeId: previewInspectorSession.selectedTreeNodeId,
      },
    });
  } catch {
    // A host may reject values that became non-cloneable between normalization and persistence.
  }
}
`;
}
