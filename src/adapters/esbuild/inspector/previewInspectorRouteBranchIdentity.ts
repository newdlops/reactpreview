import { createHash } from 'node:crypto';
import type { PreviewInspectorRouteSelectionStep } from '../../../domain/preview';

/** Produces the stable opaque browser identity for one complete route selection path. */
export function createPreviewInspectorRouteBranchId(
  selectionPath: readonly PreviewInspectorRouteSelectionStep[],
): string {
  const hash = createHash('sha256');
  for (const step of selectionPath) {
    hash.update(step.componentName);
    hash.update('\0');
    hash.update(step.pattern);
    hash.update('\0');
  }
  return `route-${hash.digest('hex').slice(0, 20)}`;
}
