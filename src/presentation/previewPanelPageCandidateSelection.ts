/**
 * Owns the Page Inspector caller-path choice for one pinned preview session.
 *
 * The selected id is deliberately kept in the extension host rather than only in webview state:
 * changing it must cause a new narrow esbuild graph, while a failed rebuild leaves the previous
 * rendered page available. Automatic execution attempts also belong here: an import-map change
 * replaces the entire webview, losing its finite-search history but not advancing the source input.
 */
import { randomUUID } from 'node:crypto';
import type { ResolvedPreviewTarget } from './activePreviewTarget';

/** Caps automatic compiler work and retained identities even if a runtime keeps proposing new ids. */
const MAXIMUM_AUTOMATIC_EXECUTION_ATTEMPTS = 12;

/** Session-local candidate transaction and non-evicting automatic execution frontier. */
export class PreviewPanelPageCandidateSelection {
  private frontierId = randomUUID();
  private candidateId: string | undefined;
  private executionCandidateId: string | undefined;
  private pendingCandidateId: string | undefined;
  private pendingExecutionCandidateId: string | undefined;
  private hasPendingSelection = false;
  private readonly attemptedExecutionCandidates = new Set<string>();
  /** Executions that mounted in this frontier; each may be restored once after a failed replay. */
  private readonly committedExecutionCandidates = new Set<string>();
  private readonly restoredExecutionCandidates = new Set<string>();

  /**
   * Prepares a newly resolved foreground build with its current caller-path selection.
   * With no pending Inspector transaction, this is a source/configuration/manual refresh and starts
   * a fresh recovery frontier. Selection rebuilds keep their attempts across requests, artifacts,
   * runtime revisions and commits. Call only to prepare a build; use current() to inspect state.
   */
  public applyTo(target: ResolvedPreviewTarget): ResolvedPreviewTarget {
    if (!this.hasPendingSelection) this.clearExecutionFrontier();
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

  /**
   * Admits one untried inner-fidelity execution without changing the visible browser candidate.
   * Records admission before compilation: failed or unapplied builds consume the same finite
   * frontier as committed builds. Rejection leaves the selected and pending requests unchanged.
   * A restore re-admits, once, an execution this frontier already committed: the verified
   * component output a failed full-page replay returns to.
   */
  public beginExecutionCandidate(
    executionCandidateId: string,
    candidateId = this.candidateId,
    restore = false,
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
    const attemptKey = `${candidateId}\0${executionCandidateId}`;
    if (restore) {
      if (
        !this.committedExecutionCandidates.has(attemptKey) ||
        this.restoredExecutionCandidates.has(attemptKey)
      ) {
        return false;
      }
      this.restoredExecutionCandidates.add(attemptKey);
    } else if (
      this.attemptedExecutionCandidates.has(attemptKey) ||
      this.attemptedExecutionCandidates.size >= MAXIMUM_AUTOMATIC_EXECUTION_ATTEMPTS
    ) {
      return false;
    }
    this.attemptedExecutionCandidates.add(attemptKey);
    this.pendingCandidateId = selectedCandidateId ?? candidateId;
    this.pendingExecutionCandidateId = executionCandidateId;
    this.hasPendingSelection = true;
    return true;
  }

  /** Commits the browser-applied candidate only after the replacement runtime has mounted. */
  public commit(): void {
    if (!this.hasPendingSelection) return;
    if (this.pendingCandidateId !== undefined && this.pendingExecutionCandidateId !== undefined) {
      this.committedExecutionCandidates.add(
        `${this.pendingCandidateId}\0${this.pendingExecutionCandidateId}`,
      );
    }
    this.candidateId = this.pendingCandidateId;
    this.executionCandidateId = this.pendingExecutionCandidateId;
    this.pendingCandidateId = undefined;
    this.pendingExecutionCandidateId = undefined;
    this.hasPendingSelection = false;
  }

  /** Keeps the existing candidate and spent attempts when a replacement cannot be applied. */
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

  /** Identifies this panel's immutable input frontier across selection-driven document replacement. */
  public currentFrontierId(): string {
    return this.frontierId;
  }

  /** Removes page choices and old execution attempts after a different route is committed. */
  public clear(): void {
    this.clearExecutionFrontier();
    this.candidateId = undefined;
    this.executionCandidateId = undefined;
    this.pendingCandidateId = undefined;
    this.pendingExecutionCandidateId = undefined;
    this.hasPendingSelection = false;
  }

  /** Starts a fresh automatic execution frontier: attempts, committed artifacts, and restores. */
  private clearExecutionFrontier(): void {
    this.frontierId = randomUUID();
    this.attemptedExecutionCandidates.clear();
    this.committedExecutionCandidates.clear();
    this.restoredExecutionCandidates.clear();
  }
}
