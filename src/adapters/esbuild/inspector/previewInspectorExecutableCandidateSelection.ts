/**
 * Selects the sole Page Inspector candidate that may become executable browser code.
 *
 * The analyzer deliberately retains all candidates as inert metadata so users can compare caller
 * paths. esbuild, however, follows every statically written dynamic import even when a runtime
 * branch never invokes it. Keeping this policy in one pure module prevents alternate page roots
 * from accidentally becoming part of the initial graph again.
 */
import type { PreviewInspectorVirtualPageCandidate } from './previewInspectorVirtualPagePlan';

/** Result of resolving a requested candidate against the current static candidate inventory. */
export interface PreviewInspectorExecutableCandidateSelection {
  /** Candidate allowed to emit a real dynamic import in this artifact. */
  readonly active: PreviewInspectorVirtualPageCandidate;
  /** True when the request named a candidate that no longer exists after source changes. */
  readonly requestedCandidateWasUnavailable: boolean;
}

/**
 * Chooses one executable VirtualPage while treating all other candidates as descriptor-only data.
 *
 * @param candidates Ranked VirtualPage candidates produced by static analysis.
 * @param requestedCandidateId Optional persisted user selection.
 * @returns The exact candidate to bundle, or `undefined` when no page context exists.
 */
export function selectPreviewInspectorExecutableCandidate(
  candidates: readonly PreviewInspectorVirtualPageCandidate[],
  requestedCandidateId: string | undefined,
): PreviewInspectorExecutableCandidateSelection | undefined {
  const requested =
    requestedCandidateId === undefined
      ? undefined
      : candidates.find((candidate) => candidate.browserCandidate.id === requestedCandidateId);
  const active = requested ?? candidates[0];
  if (active === undefined) return undefined;
  return Object.freeze({
    active,
    requestedCandidateWasUnavailable: requestedCandidateId !== undefined && requested === undefined,
  });
}
