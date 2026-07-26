/**
 * Owns one browser-correlated Inspector selection transaction for a pinned preview panel.
 *
 * This class is intentionally pure: the panel session supplies revisions and publishes returned
 * messages, while this controller makes duplicate, busy, and terminal transitions deterministic.
 */
import type { PreviewProgressStage } from '../domain/previewProgress';
import type { PreviewInspectorPageCandidateSelectionRequest } from './previewInspectorPageCandidateSelectionProtocol';
import type { PreviewInspectorRouteSelectionRequest } from './previewInspectorRouteSelectionProtocol';
import type {
  PreviewInspectorSelectionFailureReason,
  PreviewInspectorSelectionStatusMessage,
} from './previewInspectorSelectionStatusProtocol';

type PendingInspectorSelection = PendingRouteSelection | PendingPageCandidateSelection;
type PendingSelectionPhase = 'accepted' | 'building' | 'applying' | 'fallback-runtime';

interface PendingSelectionBase {
  readonly buildRevision: number;
  readonly interactionId: string;
  readonly offeredByRuntimeRevision: number;
  phase: PendingSelectionPhase;
  readonly startedAt: number;
}

interface PendingRouteSelection extends PendingSelectionBase {
  readonly branchId: string;
  readonly kind: 'route';
}

interface PendingPageCandidateSelection extends PendingSelectionBase {
  readonly candidateId: string;
  readonly kind: 'page-candidate';
}

/** Result of a browser request admission attempt. */
export interface BeginInspectorSelectionResult {
  readonly accepted: boolean;
  readonly shouldBuild: boolean;
  readonly statuses: readonly PreviewInspectorSelectionStatusMessage[];
}

/** Result of binding a prepared artifact to the active browser interaction. */
export interface BindInspectorSelectionResult {
  readonly accepted: boolean;
  readonly status?: PreviewInspectorSelectionStatusMessage;
}

/** Result of one terminal transition. */
export interface TerminalInspectorSelectionResult {
  readonly committed: boolean;
  readonly status?: PreviewInspectorSelectionStatusMessage;
}

/** Pure transaction controller with a bounded terminal replay cache. */
export class PreviewPanelInspectorSelectionController {
  private readonly completed = new Map<string, PreviewInspectorSelectionStatusMessage>();
  private pending: PendingInspectorSelection | undefined;
  private applicationId: string | undefined;

  /** Begins a route transaction, rejects a conflicting interaction, or replays a duplicate. */
  public beginRoute(
    request: PreviewInspectorRouteSelectionRequest,
    nextBuildRevision: number,
  ): BeginInspectorSelectionResult {
    return this.begin(
      {
        branchId: request.branchId,
        buildRevision: nextBuildRevision,
        interactionId: request.interactionId,
        kind: 'route',
        offeredByRuntimeRevision: request.runtimeRevision,
        phase: 'accepted',
        startedAt: Date.now(),
      },
      request.runtimeRevision,
    );
  }

  /** Begins a page-candidate transaction, rejects a conflicting interaction, or replays a duplicate. */
  public beginPageCandidate(
    request: PreviewInspectorPageCandidateSelectionRequest,
    nextBuildRevision: number,
  ): BeginInspectorSelectionResult {
    return this.begin(
      {
        buildRevision: nextBuildRevision,
        candidateId: request.candidateId,
        interactionId: request.interactionId,
        kind: 'page-candidate',
        offeredByRuntimeRevision: request.runtimeRevision,
        phase: 'accepted',
        startedAt: Date.now(),
      },
      request.runtimeRevision,
    );
  }

  /** Emits a status only when this exact pending build still owns the interaction. */
  public reportProgress(
    buildRevision: number,
    stage: PreviewProgressStage,
    displayedRuntimeRevision: number,
  ): readonly PreviewInspectorSelectionStatusMessage[] {
    const pending = this.pending;
    if (pending?.buildRevision !== buildRevision) return [];
    pending.phase = 'building';
    return [this.createStatus(pending, displayedRuntimeRevision, 'progress', { stage })];
  }

  /** Correlates a prepared browser application with the one active build. */
  public bindPreparedApplication(
    buildRevision: number,
    applicationId: string,
    displayedRuntimeRevision: number,
  ): BindInspectorSelectionResult {
    const pending = this.pending;
    if (pending?.buildRevision !== buildRevision || this.applicationId !== undefined) {
      return { accepted: false };
    }
    pending.phase = 'applying';
    this.applicationId = applicationId;
    return {
      accepted: true,
      status: this.createStatus(pending, displayedRuntimeRevision, 'progress', {
        stage: 'loading-preview',
      }),
    };
  }

  /** Commits only the transaction bound to the browser application that actually mounted. */
  public commitApplication(
    applicationId: string,
    displayedRuntimeRevision: number,
  ): TerminalInspectorSelectionResult {
    if (applicationId !== this.applicationId) return { committed: false };
    return this.complete('committed', displayedRuntimeRevision);
  }

  /** Fails only the transaction bound to the browser application that did not mount. */
  public failApplication(
    applicationId: string,
    reason: PreviewInspectorSelectionFailureReason,
    displayedRuntimeRevision: number,
  ): TerminalInspectorSelectionResult {
    if (applicationId !== this.applicationId) return { committed: false };
    return this.complete('failed', displayedRuntimeRevision, reason);
  }

  /** Fails the still-pending build before any browser application was bound. */
  public failBuild(
    buildRevision: number,
    reason: PreviewInspectorSelectionFailureReason,
    displayedRuntimeRevision: number,
  ): TerminalInspectorSelectionResult {
    if (this.pending?.buildRevision !== buildRevision) return { committed: false };
    return this.complete('failed', displayedRuntimeRevision, reason);
  }

  /** Cancels pending work while preserving a bounded terminal response for duplicate traffic. */
  public cancelForRefresh(
    reason: PreviewInspectorSelectionFailureReason,
    displayedRuntimeRevision: number,
  ): TerminalInspectorSelectionResult | undefined {
    if (this.pending === undefined) return undefined;
    return this.complete('cancelled', displayedRuntimeRevision, reason);
  }

  /** Clears live state when the owning panel is disposed. */
  public dispose(displayedRuntimeRevision: number): TerminalInspectorSelectionResult | undefined {
    const result =
      this.pending === undefined
        ? undefined
        : this.complete('cancelled', displayedRuntimeRevision, 'disposed');
    this.applicationId = undefined;
    return result;
  }

  /** Current foreground build revision, if a browser interaction owns one. */
  public currentBuildRevision(): number | undefined {
    return this.pending?.buildRevision;
  }

  /** Current correlation id, if a browser interaction owns one. */
  public currentInteractionId(): string | undefined {
    return this.pending?.interactionId;
  }
  /** Internal helper. */
  private begin(
    next: PendingInspectorSelection,
    displayedRuntimeRevision: number,
  ): BeginInspectorSelectionResult {
    const completed = this.completed.get(next.interactionId);
    if (completed !== undefined)
      return { accepted: false, shouldBuild: false, statuses: [completed] };
    const current = this.pending;
    if (current?.interactionId === next.interactionId) {
      return {
        accepted: true,
        shouldBuild: false,
        statuses: [
          this.createStatus(
            current,
            displayedRuntimeRevision,
            current.phase === 'accepted' ? 'accepted' : 'progress',
          ),
        ],
      };
    }
    if (current !== undefined) {
      return {
        accepted: false,
        shouldBuild: false,
        statuses: [
          this.createStatus(next, displayedRuntimeRevision, 'rejected', { reason: 'busy' }),
        ],
      };
    }
    this.pending = next;
    return {
      accepted: true,
      shouldBuild: true,
      statuses: [this.createStatus(next, displayedRuntimeRevision, 'accepted')],
    };
  }
  /** Internal helper. */
  private complete(
    status: 'committed' | 'failed' | 'cancelled',
    displayedRuntimeRevision: number,
    reason?: PreviewInspectorSelectionFailureReason,
  ): TerminalInspectorSelectionResult {
    const pending = this.pending;
    if (pending === undefined) return { committed: false };
    const message = this.createStatus(
      pending,
      displayedRuntimeRevision,
      status,
      reason === undefined ? {} : { reason },
    );
    this.pending = undefined;
    this.applicationId = undefined;
    this.completed.set(message.interactionId, message);
    if (this.completed.size > 32) {
      const oldest = this.completed.keys().next().value;
      if (oldest !== undefined) this.completed.delete(oldest);
    }
    return { committed: status === 'committed', status: message };
  }
  /** Internal helper. */
  private createStatus(
    pending: PendingInspectorSelection,
    displayedRuntimeRevision: number,
    status: PreviewInspectorSelectionStatusMessage['status'],
    extra: {
      readonly reason?: PreviewInspectorSelectionFailureReason;
      readonly stage?: PreviewProgressStage;
    } = {},
  ): PreviewInspectorSelectionStatusMessage {
    const common = {
      ...(pending.buildRevision === 0 ? {} : { buildRevision: pending.buildRevision }),
      displayedRuntimeRevision,
      interactionId: pending.interactionId,
      ...(extra.reason === undefined ? {} : { reason: extra.reason }),
      ...(extra.stage === undefined ? {} : { stage: extra.stage }),
      status,
    };
    return pending.kind === 'route'
      ? {
          ...common,
          branchId: pending.branchId,
          type: 'react-preview-inspector-route-selection-status',
        }
      : {
          ...common,
          candidateId: pending.candidateId,
          type: 'react-preview-inspector-page-candidate-selection-status',
        };
  }
}
