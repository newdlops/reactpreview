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
  private committedSteps: readonly PreviewInspectorRouteSelectionStep[] | undefined;
  private hasPendingSelection = false;
  private pendingSteps: readonly PreviewInspectorRouteSelectionStep[] | undefined;

  /**
   * Adds the current selection to a freshly resolved immutable target.
   *
   * @param target Latest snapshot of the panel's pinned document.
   * @returns The original target when no route was chosen, otherwise a request copy with the route.
   */
  public applyTo(target: ResolvedPreviewTarget): ResolvedPreviewTarget {
    const steps = this.hasPendingSelection ? this.pendingSteps : this.committedSteps;
    if (steps === undefined) return target;
    return {
      ...target,
      request: {
        ...target.request,
        inspectorRouteSelection: steps,
      },
    };
  }

  /**
   * Replaces the selected branch after copying every untrusted webview-provided step.
   *
   * @param selectionPath Protocol-validated public component/path identities.
   * @returns `true` only when a rebuild must select a different route branch.
   */
  public begin(selectionPath: readonly PreviewInspectorRouteSelectionStep[]): boolean {
    const normalized = Object.freeze(
      selectionPath.map((step) =>
        Object.freeze({ componentName: step.componentName, pattern: step.pattern }),
      ),
    );
    const next = normalized.length === 0 ? undefined : normalized;
    if (
      routeSelectionsAreEqual(
        this.hasPendingSelection ? this.pendingSteps : this.committedSteps,
        next,
      )
    )
      return false;
    this.pendingSteps = next;
    this.hasPendingSelection = true;
    return true;
  }

  /** Promotes the route used by a successful prepared preview to the durable panel selection. */
  public commit(): void {
    if (!this.hasPendingSelection) return;
    this.committedSteps = this.pendingSteps;
    this.pendingSteps = undefined;
    this.hasPendingSelection = false;
  }

  /** Discards a failed or cancelled request so the last visible route remains retryable. */
  public rollback(): void {
    this.pendingSteps = undefined;
    this.hasPendingSelection = false;
  }

  /** Whether a browser interaction is still building or applying an uncommitted route. */
  public get isPendingSelection(): boolean {
    return this.hasPendingSelection;
  }
}

/** Compares two bounded public route chains without relying on mutable array identity. */
function routeSelectionsAreEqual(
  left: readonly PreviewInspectorRouteSelectionStep[] | undefined,
  right: readonly PreviewInspectorRouteSelectionStep[] | undefined,
): boolean {
  if (left === undefined || right === undefined) return left === right;
  if (left.length !== right.length) return false;
  return right.every((step, index) => {
    const leftStep = left[index];
    return leftStep === undefined
      ? false
      : step.componentName === leftStep.componentName && step.pattern === leftStep.pattern;
  });
}
