/**
 * Generates the shared selected-node detail body used by React Page Inspector surfaces.
 *
 * Keeping the dispatch in one generated module lets the Components tab show a selected row without
 * navigating away from its tree, while the dedicated detail tab can reuse the exact same blocker,
 * deferred-UI, render-choice, and component debugger editors.
 */

/**
 * Creates browser source for selected-node classification, heading text, and detail rendering.
 *
 * Expected lexical bindings include React, the three render-control classifiers, and the existing
 * blocker, condition, deferred-UI, and component debugger detail components.
 *
 * @returns Plain JavaScript concatenated into the isolated Inspector Shadow DOM runtime.
 */
export function createPreviewInspectorSelectionDetailUiRuntimeSource(): string {
  return String.raw`
/** Returns true when a selected tree node controls whether authored output can render. */
function isPreviewInspectorSelectionRenderControl(node) {
  return isPreviewInspectorBlockerNode(node) ||
    isPreviewInspectorDeferredUiTriggerNode(node) ||
    isPreviewInspectorRenderChoiceNode(node);
}

/** Builds one concise identity shared by the tree-local and dedicated detail headings. */
function formatPreviewInspectorSelectionHeading(node) {
  if (isPreviewInspectorRenderChoiceNode(node)) {
    return 'Render choice · ' + String(node?.name ?? '');
  }
  if (isPreviewInspectorDeferredUiTriggerNode(node)) {
    return 'Deferred UI · ' + String(node?.name ?? '');
  }
  if (isPreviewInspectorBlockerNode(node)) {
    return 'Blocker · ' + String(node?.name ?? '');
  }
  return node?.name ?? 'Inspect selection';
}

/**
 * Renders only the selected-node body so its parent decides whether it belongs beside the tree or
 * inside the full-width Inspect selection tab.
 */
function PreviewInspectorSelectedNodeDetail({ node }) {
  if (isPreviewInspectorDeferredUiTriggerNode(node)) {
    return React.createElement(PreviewInspectorDeferredUiTriggerDetail, { node });
  }
  if (isPreviewInspectorRenderChoiceNode(node)) {
    return React.createElement(PreviewInspectorConditionDetail, { node });
  }
  if (isPreviewInspectorBlockerNode(node)) {
    return React.createElement(PreviewInspectorBlockerDetail, { node });
  }
  if (node === undefined) {
    return React.createElement(
      'div',
      { className: 'rpi-empty' },
      'Select a React component to inspect it.',
    );
  }
  return React.createElement(PreviewInspectorComponentDebuggerDetail, { node });
}
`;
}
