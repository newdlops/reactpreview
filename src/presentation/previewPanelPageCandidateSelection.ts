/**
 * Owns the Page Inspector caller-path choice for one pinned preview session.
 *
 * The selected id is deliberately kept in the extension host rather than only in webview state:
 * changing it must cause a new narrow esbuild graph, while a failed rebuild leaves the previous
 * rendered page available.
 */
import type { ResolvedPreviewTarget } from './activePreviewTarget';

/** Session-local value object for the one executable Page Inspector candidate. */
export class PreviewPanelPageCandidateSelection {
  private candidateId: string | undefined;
  private executionCandidateId: string | undefined;
  private pendingCandidateId: string | undefined;
  private pendingExecutionCandidateId: string | undefined;
  private hasPendingSelection = false;

  /** Adds the current caller-path selection to a newly resolved build request. */
  public applyTo(target: ResolvedPreviewTarget): ResolvedPreviewTarget {
    const candidateId = this.hasPendingSelection ? this.pendingCandidateId : this.candidateId;
    const executionCandidateId = this.hasPendingSelection
      ? this.pendingExecutionCandidateId
      : this.executionCandidateId;
    if (candidateId === undefined && executionCandidateId === undefined) return target;
    return {
      ...target,
      request: {
        ...target.request,
        ...(candidateId === undefined ? {} : { inspectorPageCandidateId: candidateId }),
        ...(executionCandidateId === undefined
          ? {}
          : { inspectorPageExecutionCandidateId: executionCandidateId }),
      },
    };
  }

  /** Replaces the selected public candidate identity after protocol validation. */
  public begin(candidateId: string): boolean {
    if ((this.hasPendingSelection ? this.pendingCandidateId : this.candidateId) === candidateId)
      return false;
    this.pendingCandidateId = candidateId;
    this.pendingExecutionCandidateId = undefined;
    this.hasPendingSelection = true;
    return true;
  }

  /** Starts one host-owned inner-fidelity retry without changing the visible browser candidate. */
  public beginExecutionCandidate(
    executionCandidateId: string,
    candidateId = this.candidateId,
  ): boolean {
    const selectedCandidateId = this.hasPendingSelection
      ? this.pendingCandidateId
      : this.candidateId;
    const selectedExecutionCandidateId = this.hasPendingSelection
      ? this.pendingExecutionCandidateId
      : this.executionCandidateId;
    if (
      candidateId === undefined ||
      (selectedCandidateId !== undefined && selectedCandidateId !== candidateId) ||
      (selectedCandidateId === candidateId && selectedExecutionCandidateId === executionCandidateId)
    ) {
      return false;
    }
    this.pendingCandidateId = selectedCandidateId ?? candidateId;
    this.pendingExecutionCandidateId = executionCandidateId;
    this.hasPendingSelection = true;
    return true;
  }

  /** Commits the browser-applied candidate only after the replacement runtime has mounted. */
  public commit(): void {
    if (!this.hasPendingSelection) return;
    this.candidateId = this.pendingCandidateId;
    this.executionCandidateId = this.pendingExecutionCandidateId;
    this.pendingCandidateId = undefined;
    this.pendingExecutionCandidateId = undefined;
    this.hasPendingSelection = false;
  }

  /** Keeps the existing candidate when the requested replacement cannot be applied. */
  public rollback(): void {
    this.pendingCandidateId = undefined;
    this.pendingExecutionCandidateId = undefined;
    this.hasPendingSelection = false;
  }

  /** Returns the durable browser-applied candidate identity. */
  public current(): string | undefined {
    return this.candidateId;
  }

  /** Returns the durable host-selected Page Execution Slice identity. */
  public currentExecutionCandidate(): string | undefined {
    return this.executionCandidateId;
  }

  /** Removes the durable and in-flight page-candidate choice after a route commit. */
  public clear(): void {
    this.candidateId = undefined;
    this.executionCandidateId = undefined;
    this.pendingCandidateId = undefined;
    this.pendingExecutionCandidateId = undefined;
    this.hasPendingSelection = false;
  }
}
