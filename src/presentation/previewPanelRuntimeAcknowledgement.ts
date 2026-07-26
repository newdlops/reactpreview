/** Settles browser runtime and hot-reload acknowledgements without owning panel state. */
import type { PreviewPreparedApplicationOrigin } from './previewPreparedApplication';
import {
  readPreviewHotReloadAcknowledgement,
  type PendingPreviewHotReload,
} from './previewHotReloadProtocol';
import type {
  PendingPreviewInitialRuntime,
  PendingSamePreviewArtifactRevision,
} from './previewPanelSessionState';

/** Session operations needed to apply one browser-correlated terminal outcome. */
export interface PreviewPanelRuntimeAcknowledgementContext {
  readonly cancelContextEnrichment: () => void;
  readonly clearInitialRuntimeWatchdog: () => void;
  readonly documentName: string;
  readonly failPreparedApplication: (
    applicationId: string,
    origin: PreviewPreparedApplicationOrigin,
    reason: 'hot-reload-retained' | 'runtime-failed',
    displayedRevision: number,
  ) => void;
  readonly finishHotReload: (
    token: string,
    fallbackHtml: string | undefined,
    outcome: 'applied' | 'navigate' | 'retained',
  ) => void;
  readonly finishTrace: (outcome: 'completed' | 'failed', revision: number) => void;
  readonly getInitialRuntime: () => PendingPreviewInitialRuntime | undefined;
  readonly getPendingHotReload: (token: string) => PendingPreviewHotReload | undefined;
  readonly getSameArtifactRevision: () => PendingSamePreviewArtifactRevision | undefined;
  readonly releaseCurrentArtifact: () => void;
  readonly renderReady: (revision: number, documentName: string) => void;
  readonly renderRetryableRuntimeFailure: (revision: number) => void;
  readonly resolveSettlementRevision: (
    artifactHash: string,
    fallbackRevision: number,
    ready: boolean,
  ) => number;
  readonly setDisplayedRuntimeRevision: (revision: number) => void;
  readonly settlePreparedApplication: (
    applicationId: string,
    origin: PreviewPreparedApplicationOrigin,
    displayedRevision: number,
  ) => void;
}

/** Claims and settles one validated browser acknowledgement. */
export function handlePreviewPanelRuntimeAcknowledgement(
  message: unknown,
  context: PreviewPanelRuntimeAcknowledgementContext,
): boolean {
  const initial = context.getInitialRuntime();
  if (initial !== undefined && isInitialRuntimeSettlement(message, initial)) {
    const shared = readSharedApplication(context.getSameArtifactRevision(), initial.artifactHash);
    const ready = message.type === 'react-preview-runtime-ready';
    const revision = context.resolveSettlementRevision(
      initial.artifactHash,
      initial.revision,
      ready,
    );
    context.finishTrace(ready ? 'completed' : 'failed', revision);
    context.clearInitialRuntimeWatchdog();
    const applicationId = shared?.applicationId ?? initial.applicationId;
    const origin = shared?.origin ?? initial.origin;
    if (!ready) {
      context.cancelContextEnrichment();
      context.failPreparedApplication(applicationId, origin, 'runtime-failed', revision);
      context.releaseCurrentArtifact();
      context.renderRetryableRuntimeFailure(revision);
      return true;
    }
    context.settlePreparedApplication(applicationId, origin, revision);
    return true;
  }
  const acknowledgement = readPreviewHotReloadAcknowledgement(message);
  if (acknowledgement === undefined) return false;
  const pending = context.getPendingHotReload(acknowledgement.token);
  if (pending?.runtimeRevision !== acknowledgement.revision) return true;
  const shared = readSharedApplication(context.getSameArtifactRevision(), pending.nextArtifactHash);
  if (acknowledgement.applied) context.setDisplayedRuntimeRevision(pending.runtimeRevision);
  const revision =
    acknowledgement.applied || acknowledgement.retainedPrevious
      ? context.resolveSettlementRevision(
          pending.nextArtifactHash,
          pending.runtimeRevision,
          acknowledgement.applied,
        )
      : pending.runtimeRevision;
  context.finishTrace(acknowledgement.applied ? 'completed' : 'failed', revision);
  context.finishHotReload(
    acknowledgement.token,
    acknowledgement.applied ? undefined : pending.fallbackHtml,
    acknowledgement.retainedPrevious
      ? 'retained'
      : acknowledgement.applied
        ? 'applied'
        : 'navigate',
  );
  const applicationId = shared?.applicationId ?? pending.applicationId;
  const origin = shared?.origin ?? pending.origin;
  if (acknowledgement.applied) {
    context.settlePreparedApplication(applicationId, origin, revision);
  } else if (acknowledgement.retainedPrevious) {
    context.cancelContextEnrichment();
    context.failPreparedApplication(applicationId, origin, 'hot-reload-retained', revision);
    context.renderReady(revision, context.documentName);
  }
  return true;
}
/** Internal helper. */
function isInitialRuntimeSettlement(
  value: unknown,
  initial: PendingPreviewInitialRuntime | undefined,
): value is {
  readonly revision: number;
  readonly token: string;
  readonly type: 'react-preview-runtime-failed' | 'react-preview-runtime-ready';
} {
  return (
    initial !== undefined &&
    typeof value === 'object' &&
    value !== null &&
    'type' in value &&
    ((value as { readonly type?: unknown }).type === 'react-preview-runtime-ready' ||
      (value as { readonly type?: unknown }).type === 'react-preview-runtime-failed') &&
    'token' in value &&
    (value as { readonly token?: unknown }).token === initial.runtimeToken &&
    'revision' in value &&
    (value as { readonly revision?: unknown }).revision === initial.revision &&
    (!('pageApplicationPhase' in value) ||
      (value as { readonly pageApplicationPhase?: unknown }).pageApplicationPhase ===
        'page-applied' ||
      (value as { readonly pageApplicationPhase?: unknown }).pageApplicationPhase === 'page-failed')
  );
}
/** Internal helper. */
function readSharedApplication(
  pending: PendingSamePreviewArtifactRevision | undefined,
  artifactHash: string,
): PendingSamePreviewArtifactRevision | undefined {
  return pending?.artifactHash === artifactHash ? pending : undefined;
}
