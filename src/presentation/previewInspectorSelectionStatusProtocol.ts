/**
 * Defines the bounded host-to-webview terminal state for one Inspector selection interaction.
 *
 * The browser owns presentation, while the extension owns the compiler and browser-application
 * lifecycle. These messages deliberately contain only public ids and closed reasons so a failed
 * build never leaks paths, imports, or compiler diagnostics into the webview.
 */
import type { PreviewProgressStage } from '../domain/previewProgress';

/** States emitted for an accepted Inspector interaction. */
export type PreviewInspectorSelectionStatus =
  'accepted' | 'progress' | 'committed' | 'rejected' | 'failed' | 'cancelled';

/** Closed, presentation-safe reason for a non-committed selection. */
export type PreviewInspectorSelectionFailureReason =
  | 'already-active'
  | 'busy'
  | 'stale-runtime'
  | 'selection-unavailable'
  | 'build-failed'
  | 'publish-failed'
  | 'artifact-unchanged'
  | 'message-undelivered'
  | 'hot-reload-retained'
  | 'hot-reload-timeout'
  | 'runtime-failed'
  | 'runtime-timeout'
  | 'cancelled-by-refresh'
  | 'disposed'
  | 'invariant-mismatch';

/** Terminal or progress state for an authored route branch. */
export interface PreviewInspectorRouteSelectionStatusMessage {
  readonly branchId: string;
  readonly buildRevision?: number;
  readonly displayedRuntimeRevision: number;
  readonly interactionId: string;
  readonly reason?: PreviewInspectorSelectionFailureReason;
  readonly selectedBranchId?: string;
  readonly stage?: PreviewProgressStage;
  readonly status: PreviewInspectorSelectionStatus;
  readonly type: 'react-preview-inspector-route-selection-status';
}

/** Terminal or progress state for an authored page candidate. */
export interface PreviewInspectorPageCandidateSelectionStatusMessage {
  readonly buildRevision?: number;
  readonly candidateId: string;
  readonly displayedRuntimeRevision: number;
  readonly interactionId: string;
  readonly reason?: PreviewInspectorSelectionFailureReason;
  readonly stage?: PreviewProgressStage;
  readonly status: PreviewInspectorSelectionStatus;
  readonly type: 'react-preview-inspector-page-candidate-selection-status';
}

/** One unambiguous selection-status message accepted by the generated Inspector runtime. */
export type PreviewInspectorSelectionStatusMessage =
  PreviewInspectorRouteSelectionStatusMessage | PreviewInspectorPageCandidateSelectionStatusMessage;
