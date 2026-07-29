import { createPreviewRuntimeCorrelationSource } from '../staticResources/previewRuntimeCorrelationSource';

/** Legacy Page Inspector alias retained for existing generated-runtime consumers. */
export function createPreviewInspectorRuntimeCorrelationSource(): string {
  return createPreviewRuntimeCorrelationSource()
    .replaceAll('PREVIEW_RUNTIME', 'PREVIEW_INSPECTOR_RUNTIME')
    .replaceAll('PreviewRuntime', 'PreviewInspectorRuntime')
    .replaceAll('previewRuntimeCorrelation', 'previewInspectorRuntimeCorrelation');
}
