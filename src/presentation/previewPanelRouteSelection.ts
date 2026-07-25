/**
 * Owns the immutable nested application-route choice for one pinned preview panel.
 *
 * Route exploration is panel state rather than editor state: two preview tabs may inspect different
 * branches of the same App without changing each other. Keeping normalization and request shaping
 * here also prevents the already large panel lifecycle controller from knowing protocol details.
 */
import type { PreviewInspectorRouteSelectionStep } from '../domain/preview';
import type { ResolvedPreviewTarget } from './activePreviewTarget';

/** Session-local value object for a root-to-leaf route selection. */
export class PreviewPanelRouteSelection {
  private steps: readonly PreviewInspectorRouteSelectionStep[] | undefined;

  /**
   * Adds the current selection to a freshly resolved immutable target.
   *
   * @param target Latest snapshot of the panel's pinned document.
   * @returns The original target when no route was chosen, otherwise a request copy with the route.
   */
  public applyTo(target: ResolvedPreviewTarget): ResolvedPreviewTarget {
    if (this.steps === undefined) return target;
    return {
      ...target,
      request: {
        ...target.request,
        inspectorRouteSelection: this.steps,
      },
    };
  }

  /**
   * Replaces the selected branch after copying every untrusted webview-provided step.
   *
   * @param selectionPath Protocol-validated public component/path identities.
   * @returns `true` only when a rebuild must select a different route branch.
   */
  public replace(selectionPath: readonly PreviewInspectorRouteSelectionStep[]): boolean {
    const normalized = Object.freeze(
      selectionPath.map((step) =>
        Object.freeze({ componentName: step.componentName, pattern: step.pattern }),
      ),
    );
    if (routeSelectionsAreEqual(this.steps, normalized)) return false;
    this.steps = normalized.length === 0 ? undefined : normalized;
    return true;
  }
}

/** Compares two bounded public route chains without relying on mutable array identity. */
function routeSelectionsAreEqual(
  left: readonly PreviewInspectorRouteSelectionStep[] | undefined,
  right: readonly PreviewInspectorRouteSelectionStep[],
): boolean {
  if (left === undefined) return right.length === 0;
  if (left.length !== right.length) return false;
  return right.every((step, index) => {
    const leftStep = left[index];
    return leftStep === undefined
      ? false
      : step.componentName === leftStep.componentName && step.pattern === leftStep.pattern;
  });
}
