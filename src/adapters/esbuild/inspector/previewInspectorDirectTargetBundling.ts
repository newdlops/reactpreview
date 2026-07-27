import path from 'node:path';
import type { PreviewInspectorPageExecutionCandidate } from './previewInspectorPageExecutionTypes';

interface PreviewInspectorDirectTarget {
  readonly exportName: string;
  readonly sourcePath: string;
}

/**
 * Keeps frozen Page Execution slices isolated from the full selected module.
 *
 * A detached route page can reuse one local layout exported by the selected app file as an exact
 * slice. Emitting the file-overview dynamic imports beside that slice would also materialize the
 * complete app/router registry in dormant chunks, escaping the verified frontier and defeating the
 * selected leaf. Direct target loaders remain available when no frozen slice exists or when that
 * slice already admits the target module authentically.
 */
export function canBundlePreviewInspectorDirectTargetDefinitions(
  candidate: PreviewInspectorPageExecutionCandidate | undefined,
  target: PreviewInspectorDirectTarget,
): boolean {
  if (candidate === undefined) return true;
  const targetSurfaces = candidate.criticalSurfaces.filter(
    (surface) =>
      path.normalize(surface.sourcePath) === path.normalize(target.sourcePath) &&
      surface.exportName === target.exportName,
  );
  return (
    targetSurfaces.length > 0 &&
    targetSurfaces.every((surface) => surface.strategy === 'authentic-module-export')
  );
}
