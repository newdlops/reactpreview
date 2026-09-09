/** Reuses bounded automatic props for detached page chrome without claiming target ownership. */
export const PREVIEW_INSPECTOR_PAGE_SURFACE_PROPS_KEY = 'react-file-preview.page-surface-props';

/**
 * Returns a small Inspector bridge using the existing materializer and fallback-value policy.
 * Generated shapes stay module-stable; no error is swallowed and no success signal is fabricated.
 */
export function createPreviewInspectorPageSurfacePropsRuntimeSource(): string {
  return `
function PreviewInspectorPageSurfaceRenderer({ Component, shape, surfaceProps }) {
  usePreviewInspectorStore();
  const enabled = readPreviewInspectorFallbackValuesEnabled();
  const sampleCount = readPreviewGeneratedListSampleCount();
  const props = React.useMemo(
    () => createPreviewPropsFromLayers(enabled ? shape : undefined, surfaceProps),
    [enabled, sampleCount, shape, surfaceProps],
  );
  return React.isValidElement(Component)
    ? React.cloneElement(Component, props)
    : React.createElement(Component, props);
}
globalThis[Symbol.for(${JSON.stringify(PREVIEW_INSPECTOR_PAGE_SURFACE_PROPS_KEY)})] =
  function createPreviewInspectorPageSurfaceElement(Component, shape, surfaceProps) {
    return React.createElement(PreviewInspectorPageSurfaceRenderer, { Component, shape, surfaceProps });
  };
`;
}
