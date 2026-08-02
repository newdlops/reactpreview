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

/** Produces a distinct internal branch identity for one non-selectable authored occurrence. */
export function createPreviewInspectorRouteOccurrenceBranchId(
  selectionPath: readonly PreviewInspectorRouteSelectionStep[],
  occurrenceIdentity: string,
): string {
  const hash = createHash('sha256');
  hash.update(createPreviewInspectorRouteBranchId(selectionPath));
  hash.update('\0');
  hash.update(occurrenceIdentity);
  return `route-${hash.digest('hex').slice(0, 20)}`;
}
