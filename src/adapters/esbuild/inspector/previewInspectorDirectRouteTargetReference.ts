/** Exact compiler-owned target authority for contextual direct route occurrences. */
import path from 'node:path';
import type { PreviewInspectorDirectRouteChoice } from './previewInspectorDirectRouteChoiceTypes';

export interface PreviewInspectorDirectRouteTargetReference {
  readonly exportName: string;
  readonly sourcePath: string;
}

/** Requires an exact terminal or element-path source/export reference before contextual ranking. */
export function referencesPreviewInspectorDirectRouteTarget(
  choice: PreviewInspectorDirectRouteChoice,
  target: PreviewInspectorDirectRouteTargetReference,
): boolean {
  const targetSourcePath = path.normalize(target.sourcePath);
  return [
    choice.reference,
    ...(choice.elementPath ?? []).map((component) => component.reference),
  ].some(
    (reference) =>
      reference !== undefined &&
      path.normalize(reference.sourcePath) === targetSourcePath &&
      reference.exportName === target.exportName,
  );
}
