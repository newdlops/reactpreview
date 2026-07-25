/** Generates full-width section navigation for React Page Inspector. */

/**
 * Creates browser source for a stable four-tab workbench boundary.
 *
 * The current-file JSX scenario table remains first, followed by the component tree, selected-node
 * Inspector, and Console. Only one section is mounted at a time so every section receives the full
 * workbench width. Expected lexical bindings include React, all pane components, selection helpers,
 * the session state, and the ordinary persistence/notification helpers.
 *
 * @returns Plain JavaScript concatenated into the isolated Inspector Shadow DOM runtime.
 */
export function createPreviewInspectorNavigationUiRuntimeSource(): string {
  return String.raw`
const previewInspectorWorkbenchTabs = new Set(['scenarios', 'tree', 'details', 'console']);

/** Maps retired navigation identities to their equivalent full-width workbench section. */
function normalizePreviewInspectorWorkbenchTab(value) {
  if (previewInspectorWorkbenchTabs.has(value)) return value;
  if (value === 'components') return 'tree';
  if (value === 'blockers') return 'details';
  return 'scenarios';
}

/**
 * Requests a section from picker, tree, wireframe, or blocker actions outside this React component.
 * A revision separates a repeated request from an ordinary parent render without retaining a DOM ref.
 */
function requestPreviewInspectorWorkbenchTab(nextTab) {
  const normalized = normalizePreviewInspectorWorkbenchTab(nextTab);
  previewInspectorDevtoolsSessionState.navigationTab = normalized;
  previewInspectorDevtoolsSessionState.workbenchTabRevision =
    (previewInspectorDevtoolsSessionState.workbenchTabRevision ?? 0) + 1;
  if (typeof notifyPreviewInspector === 'function') notifyPreviewInspector();
  return normalized;
}

/** Applies standard horizontal tab-key navigation without moving the preview document scroll. */
function handlePreviewInspectorWorkbenchTabKeyDown(event) {
  if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return;
  const tabs = [...event.currentTarget.querySelectorAll('[role="tab"]')];
  const currentIndex = tabs.indexOf(event.target);
  if (currentIndex < 0 || tabs.length === 0) return;
  event.preventDefault();
  const nextIndex = event.key === 'Home'
    ? 0
    : event.key === 'End'
      ? tabs.length - 1
      : (currentIndex + (event.key === 'ArrowRight' ? 1 : -1) + tabs.length) % tabs.length;
  tabs[nextIndex]?.click();
  tabs[nextIndex]?.focus({ preventScroll: true });
}

/** Keeps one full-width Inspector section active across remounts and external reveal requests. */
function PreviewInspectorNavigationPane({ node, roots, selectedId, status, truncated }) {
  const [navigationTab, setNavigationTab] = React.useState(() =>
    normalizePreviewInspectorWorkbenchTab(previewInspectorDevtoolsSessionState.navigationTab));
  const requestedNavigationTab = normalizePreviewInspectorWorkbenchTab(
    previewInspectorDevtoolsSessionState.navigationTab,
  );
  const workbenchTabRevision = previewInspectorDevtoolsSessionState.workbenchTabRevision ?? 0;
  React.useEffect(() => {
    setNavigationTab(requestedNavigationTab);
  }, [requestedNavigationTab, workbenchTabRevision]);
  const selectNavigationTab = (nextTab) => {
    const normalized = normalizePreviewInspectorWorkbenchTab(nextTab);
    if (normalized === navigationTab) return;
    previewInspectorDevtoolsSessionState.navigationTab = normalized;
    setNavigationTab(normalized);
    persistPreviewInspectorState();
  };
  const renderControlSelected = isPreviewInspectorBlockerNode(node) ||
    isPreviewInspectorDeferredUiTriggerNode(node) ||
    isPreviewInspectorRenderChoiceNode(node);
  const tabs = [
    ['scenarios', 'JSX scenarios'],
    ['tree', 'Components'],
    ['details', renderControlSelected ? 'Selected blocker' : 'Inspect selection'],
    ['console', 'Console (' + String(readPreviewInspectorConsoleEntries().length) + ')'],
  ];
  return React.createElement(
    'section',
    { 'aria-label': 'Inspector sections', className: 'rpi-pane rpi-navigation-pane' },
    React.createElement(
      'div',
      { className: 'rpi-pane-heading rpi-navigation-heading' },
      React.createElement(
        'div',
        {
          'aria-label': 'React Page Inspector sections',
          className: 'rpi-tabs rpi-navigation-tabs',
          onKeyDown: handlePreviewInspectorWorkbenchTabKeyDown,
          role: 'tablist',
        },
        tabs.map(([id, label]) => React.createElement(
          'button',
          {
            'aria-controls': 'rpi-navigation-panel-' + id,
            'aria-selected': navigationTab === id,
            className: 'rpi-tab',
            id: 'rpi-navigation-tab-' + id,
            key: id,
            onClick: () => selectNavigationTab(id),
            role: 'tab',
            tabIndex: navigationTab === id ? 0 : -1,
            type: 'button',
          },
          label,
        )),
      ),
    ),
    navigationTab === 'tree'
      ? React.createElement(PreviewInspectorComponentsPane, {
          node,
          roots,
          selectedId,
          status,
          truncated,
        })
      : navigationTab === 'details'
        ? React.createElement(PreviewInspectorDetailsPane, { node, view: 'details' })
        : navigationTab === 'console'
          ? React.createElement(PreviewInspectorDetailsPane, { node, view: 'console' })
          : React.createElement(PreviewInspectorJsxScenarioPane, { roots }),
  );
}
`;
}
