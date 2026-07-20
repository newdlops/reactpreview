/**
 * Generates the compact toolbar controls for exact DOM hosts hidden through Pick on page.
 *
 * The presentation module consumes only DOM-free summaries from the visibility runtime. It neither
 * owns host references nor edits project elements, keeping UI remounts independent from page state.
 */

/**
 * Creates browser source for hide, last-restore, and all-restore Inspector actions.
 *
 * Expected lexical bindings include React, `PreviewInspectorDevtoolsButton`, and the visibility
 * registry helpers declared by the composed Inspector runtime.
 *
 * @returns Plain JavaScript source concatenated before the main Inspector toolbar renders.
 */
export function createPreviewInspectorHiddenElementsUiRuntimeSource(): string {
  return String.raw`
/** Renders explicit visibility actions next to Pick without turning ordinary picking destructive. */
function PreviewInspectorHiddenElementControls() {
  const summaries = readPreviewInspectorHiddenElementSummaries();
  const canHide = canHidePreviewInspectorPickedElement();
  const hiddenCount = summaries.length;
  const latestLabel = summaries.at(-1)?.label;
  return React.createElement(
    React.Fragment,
    undefined,
    React.createElement(
      PreviewInspectorDevtoolsButton,
      {
        disabled: !canHide,
        onClick: hidePreviewInspectorPickedElement,
        title: canHide
          ? 'Remove the exact picked host from layout while keeping its React component mounted'
          : 'Use Pick on page and click one rendered element first',
      },
      'Hide picked',
    ),
    React.createElement(
      PreviewInspectorDevtoolsButton,
      {
        disabled: hiddenCount === 0,
        onClick: restoreLastPreviewInspectorHiddenElement,
        title: latestLabel === undefined ? 'No hidden page element' : 'Restore ' + latestLabel,
      },
      'Undo hide',
    ),
    hiddenCount > 1
      ? React.createElement(
          PreviewInspectorDevtoolsButton,
          {
            onClick: restoreAllPreviewInspectorHiddenElements,
            title: 'Restore every element hidden in this preview tab',
          },
          'Show all',
        )
      : undefined,
    hiddenCount > 0
      ? React.createElement(
          'span',
          {
            className: 'rpi-meta',
            title: summaries.map((summary) => summary.label).join('\n'),
          },
          'Hidden: ' + String(hiddenCount),
        )
      : undefined,
  );
}
`;
}
