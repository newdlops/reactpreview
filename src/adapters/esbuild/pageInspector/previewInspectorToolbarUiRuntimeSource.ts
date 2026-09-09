/** Generates task-focused Inspector controls without owning page, recovery, or layout state. */

/** Returns presentation-only JavaScript; callbacks retain the existing validated runtime paths. */
export function createPreviewInspectorToolbarUiRuntimeSource(): string {
  return String.raw`
/** Groups the frequent selection actions ahead of optional display and component tools. */
function PreviewInspectorToolbarActions({
  collapsed, editable, layout, mainComponentName, persistLayout, selectedNode,
  setCollapsed, setWireframeVisible, updateLayout, wireframeVisible,
}) {
  return React.createElement(
    React.Fragment,
    undefined,
    React.createElement(
      'header',
      { className: 'rpi-toolbar-primary' },
      React.createElement(PreviewInspectorMoveHandle, { layout, persistLayout, updateLayout }),
      React.createElement('span', { className: 'rpi-title' }, 'React Page Inspector'),
      React.createElement(
        'div',
        { 'aria-label': 'Select a component', className: 'rpi-toolbar-actions', role: 'group' },
        React.createElement(
          PreviewInspectorDevtoolsButton,
          {
            onClick: () => setPreviewInspectorPickerEnabled(!previewInspectorSession.pickerEnabled),
            pressed: previewInspectorSession.pickerEnabled,
            title: 'Pick a rendered element',
            variant: 'primary',
          },
          previewInspectorSession.pickerEnabled ? 'Cancel pick' : 'Pick on page',
        ),
        React.createElement(
          PreviewInspectorDevtoolsButton,
          {
            disabled: mainComponentName === undefined,
            onClick: selectPreviewInspectorMainComponent,
            title: "Go to the current file's main component",
          },
          'Current file',
        ),
        React.createElement(
          PreviewInspectorDevtoolsButton,
          {
            onClick: () => setCollapsed((current) => {
              const next = !current;
              previewInspectorDevtoolsSessionState.collapsed = next;
              persistPreviewInspectorState();
              return next;
            }),
            title: collapsed ? 'Expand inspector' : 'Collapse inspector',
          },
          collapsed ? 'Expand' : 'Collapse',
        ),
      ),
    ),
    React.createElement(
      'details',
      { className: 'rpi-toolbar-options rpi-disclosure' },
      React.createElement('summary', undefined, 'View & tools'),
      React.createElement(
        'div',
        { className: 'rpi-toolbar-options-body' },
        React.createElement(
          'div',
          { 'aria-label': 'Page overlays', className: 'rpi-toolbar-tool-group', role: 'group' },
          React.createElement('span', { className: 'rpi-tool-label' }, 'Page overlays'),
          React.createElement(
            'div',
            { className: 'rpi-toolbar-actions' },
            React.createElement(PreviewInspectorDevtoolsButton, {
              onClick: () => setPreviewInspectorHighlightEnabled(!previewInspectorSession.highlightEnabled),
              pressed: previewInspectorSession.highlightEnabled,
              title: 'Toggle selected target highlight',
            }, 'Highlight'),
            React.createElement(PreviewInspectorDevtoolsButton, {
              onClick: () => {
                const next = !wireframeVisible;
                previewInspectorDevtoolsSessionState.wireframeVisible = next;
                setWireframeVisible(next);
                persistPreviewInspectorState();
              },
              pressed: wireframeVisible,
              title: 'Toggle the full-page React component placement wireframe',
            }, 'Wireframe'),
            React.createElement(PreviewInspectorHiddenElementControls),
          ),
          React.createElement('span', { className: 'rpi-meta' }, previewInspectorSession.highlightStatus),
        ),
        React.createElement(
          'div',
          { className: 'rpi-toolbar-tool-group' },
          React.createElement(
            'label',
            { className: 'rpi-toolbar-field' },
            React.createElement('span', { className: 'rpi-tool-label' }, 'Component export'),
            React.createElement('select', {
              'aria-label': 'Instrumented target export',
              className: 'rpi-select',
              onChange: (event) => selectPreviewInspectorExport(event.target.value),
              value: previewInspectorSession.selectedExportName,
            }, previewInspectorSession.descriptorNames.map((name) => React.createElement(
              'option', { key: name, value: name }, formatPreviewInspectorEntryName(name),
            ))),
          ),
          React.createElement(PreviewInspectorDevtoolsButton, {
            disabled: !editable,
            onClick: () => remountPreviewInspectorExport(selectedNode.exportName),
            title: editable ? 'Remount the instrumented component' : 'Only instrumented targets can remount',
          }, 'Remount'),
        ),
        React.createElement(
          'label',
          { className: 'rpi-toolbar-field rpi-toolbar-placement' },
          React.createElement('span', { className: 'rpi-tool-label' }, 'Inspector position'),
          React.createElement(PreviewInspectorLayoutSelect, { layout, persistLayout, updateLayout }),
        ),
      ),
    ),
  );
}
`;
}
