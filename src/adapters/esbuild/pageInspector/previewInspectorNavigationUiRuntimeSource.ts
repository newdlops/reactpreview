/**
 * Generates the primary Components/Blockers navigation surface for React Page Inspector.
 *
 * Both panels stay mounted while CSS hides the inactive panel. This is intentional: the component
 * tree owns local expansion state and a restored two-axis scroll viewport, so a navigation switch
 * must not recreate it. The blocker panel joins its DAG with the root-to-current-file Render flow.
 */

/**
 * Creates browser source for the persistent primary-navigation tabs.
 *
 * Expected lexical bindings include React, the DevTools session/persistence helpers,
 * `PreviewInspectorComponentsPane`, and `PreviewInspectorRenderFlowDetail`.
 *
 * @returns Plain JavaScript concatenated into the isolated Inspector Shadow DOM runtime.
 */
export function createPreviewInspectorNavigationUiRuntimeSource(): string {
  return String.raw`
const previewInspectorNavigationTabIds = new Set(['components', 'blockers']);

/** Reads a bounded persisted tab identity and repairs values from older Inspector revisions. */
function readPreviewInspectorNavigationTab() {
  const value = previewInspectorDevtoolsSessionState.navigationTab;
  return previewInspectorNavigationTabIds.has(value) ? value : 'components';
}

/** Selects one primary view without unmounting either panel or disturbing the tree viewport. */
function selectPreviewInspectorNavigationTab(tabId) {
  if (!previewInspectorNavigationTabIds.has(tabId)) return;
  previewInspectorDevtoolsSessionState.navigationTab = tabId;
  persistPreviewInspectorState();
  notifyPreviewInspector();
}

/**
 * Keeps component discovery and the ordered Render flow at the same navigation level. Hidden panels
 * remain mounted, preserving tree expansion/scroll while blocker cards can expose their safe editor.
 */
function PreviewInspectorNavigationPane({ flow, roots, selectedId, status, truncated }) {
  const activeTab = readPreviewInspectorNavigationTab();
  const tabs = [
    ['components', 'Components'],
    ['blockers', 'Blockers (' + String(flow.unresolvedCount) + ')'],
  ];
  return React.createElement(
    'section',
    { 'aria-label': 'Inspector navigation', className: 'rpi-pane rpi-navigation-pane' },
    React.createElement(
      'div',
      { className: 'rpi-pane-heading' },
      React.createElement('span', { className: 'rpi-pane-title' }, 'Render inspection'),
      React.createElement(
        'div',
        { 'aria-label': 'Inspector primary views', className: 'rpi-navigation-tabs', role: 'tablist' },
        tabs.map(([id, label]) => React.createElement(
          'button',
          {
            'aria-controls': 'react-preview-navigation-' + id,
            'aria-selected': activeTab === id,
            className: 'rpi-navigation-tab',
            id: 'react-preview-navigation-' + id + '-tab',
            key: id,
            onClick: () => selectPreviewInspectorNavigationTab(id),
            role: 'tab',
            type: 'button',
          },
          label,
        )),
      ),
    ),
    React.createElement(
      'div',
      { className: 'rpi-navigation-panels' },
      React.createElement(
        'div',
        {
          'aria-labelledby': 'react-preview-navigation-components-tab',
          className: 'rpi-navigation-panel rpi-components-navigation-panel',
          'data-rpi-active': String(activeTab === 'components'),
          id: 'react-preview-navigation-components',
          role: 'tabpanel',
        },
        React.createElement(PreviewInspectorComponentsPane, {
          roots,
          selectedId,
          status,
          truncated,
        }),
      ),
      React.createElement(
        'div',
        {
          'aria-labelledby': 'react-preview-navigation-blockers-tab',
          className: 'rpi-navigation-panel rpi-blocker-navigation-scroll',
          'data-rpi-active': String(activeTab === 'blockers'),
          'data-rpi-scroll-key': 'blocker-flow',
          id: 'react-preview-navigation-blockers',
          role: 'tabpanel',
        },
        React.createElement(PreviewInspectorRenderFlowDetail, { flow }),
      ),
    ),
  );
}
`;
}
