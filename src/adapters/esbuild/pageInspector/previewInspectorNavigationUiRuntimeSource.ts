/** Generates the single primary Components surface for React Page Inspector. */

/**
 * Creates browser source for the stable component-tree boundary.
 *
 * The tree now owns authored boolean choices and blocker rows directly, so a separate graph/setup
 * navigation level would duplicate the same controls and hide their component ownership. Keeping a
 * named boundary still isolates workbench composition from the searchable tree implementation.
 * Expected lexical bindings include React and `PreviewInspectorComponentsPane`.
 *
 * @returns Plain JavaScript concatenated into the isolated Inspector Shadow DOM runtime.
 */
export function createPreviewInspectorNavigationUiRuntimeSource(): string {
  return String.raw`
/**
 * Keeps the component tree mounted as the only primary Inspector surface. Blockers, generated data,
 * and authored render switches remain children of their owning components and open in the adjacent
 * detail pane when selected.
 */
function PreviewInspectorNavigationPane({ roots, selectedId, status, truncated }) {
  return React.createElement(PreviewInspectorComponentsPane, {
    roots,
    selectedId,
    status,
    truncated,
  });
}
`;
}
