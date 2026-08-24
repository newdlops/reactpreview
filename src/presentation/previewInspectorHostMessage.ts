/**
 * Routes Page Inspector webview messages that may touch extension-host resources.
 *
 * Keeping blocker trace logging and source navigation behind one adapter prevents the panel session
 * from accumulating protocol details as Inspector features expand. Each child handler still owns
 * its own parser and least-privilege filesystem boundary.
 */
import type * as vscode from 'vscode';
import { handlePreviewBlockerTraceMessage } from './previewBlockerTraceLogger';
import { handlePreviewRuntimeHealthMessage } from './previewRuntimeHealthLogger';
import {
  handlePreviewInspectorSourceNavigationMessage,
  type PreviewInspectorSourceNavigationContext,
} from './previewInspectorSourceNavigation';
import {
  isPreviewInspectorBranchSourceDecorationMessage,
  isPreviewInspectorSourceSelectionMessage,
  readPreviewInspectorBranchSourceDecorationRequest,
  readPreviewInspectorSourceSelectionRequest,
} from './previewInspectorProtocol';
import {
  isPreviewInspectorRouteSelectionMessage,
  readPreviewInspectorRouteSelectionRequest,
  type PreviewInspectorRouteSelectionRequest,
} from './previewInspectorRouteSelectionProtocol';
import {
  isPreviewInspectorPageCandidateSelectionMessage,
  readPreviewInspectorPageCandidateSelectionRequest,
  type PreviewInspectorPageCandidateSelectionRequest,
} from './previewInspectorPageCandidateSelectionProtocol';
import type { PreviewInspectorSourceDecoration } from './previewInspectorSourceDecoration';
import {
  readPreviewInspectorPageExecutionRetryRequest,
  type PreviewInspectorPageExecutionRetryRequest,
} from './previewInspectorPageExecutionRetryProtocol';
import {
  isPreviewInspectorNeuralModelSyncMessage,
  readPreviewInspectorNeuralModelSyncRequest,
  type PreviewInspectorNeuralModel,
} from './previewInspectorNeuralModelProtocol';
import {
  readPreviewRuntimeHealthMessage,
  type PreviewRuntimeHealthJson,
  type PreviewRuntimeHealthMessage,
} from './previewRuntimeHealthProtocol';

/** Combined panel state required by blocker tracing and signed source navigation. */
export interface PreviewInspectorHostMessageContext extends PreviewInspectorSourceNavigationContext {
  /** Revision currently committed by the panel; in-flight builds must not decorate old sources. */
  readonly currentRuntimeRevision: number;
  /** Latest revision allowed to publish learning before its ordinary ready acknowledgement settles. */
  readonly expectedNeuralRuntimeRevision?: number;
  /** Panel-owned command that must exactly match the browser trace producer identity. */
  readonly expectedPreviewCommand: 'direct-preview' | 'page-inspector';
  /** Panel-owned source marker retaining one pending selection for later-visible editors. */
  readonly sourceDecoration: PreviewInspectorSourceDecoration;
  /** Immutable source target used to label events from simultaneous pinned previews. */
  readonly targetPath: string;
  /** Full log surface narrows independently inside each protocol handler. */
  readonly log: vscode.LogOutputChannel;
  /** Schedules a branch-scoped rebuild after current-revision protocol validation. */
  readonly selectRoute?: (request: PreviewInspectorRouteSelectionRequest) => void;
  /** Schedules a build containing only the browser-selected page candidate. */
  readonly selectPageCandidate?: (request: PreviewInspectorPageCandidateSelectionRequest) => void;
  /** Schedules one compiler-owned inner Page Execution retry. */
  readonly selectPageExecutionRetry?: (request: PreviewInspectorPageExecutionRetryRequest) => void;
  /** Prevents optional enrichment only after the browser proves detail-complete target output. */
  readonly settleVerifiedTargetOutput?: (message: PreviewRuntimeHealthMessage) => void;
  /** Merges verified anonymous learning into the profile-local model shared by preview panels. */
  readonly synchronizeNeuralResidualModel?: (
    model: PreviewInspectorNeuralModel,
    runtimeRevision: number,
  ) => void;
}

/**
 * Routes renderer health and blocker traces before delegating signed editor navigation.
 *
 * @param value Untrusted structured-clone value emitted by the project preview webview.
 * @param context Current panel graph, gesture proof, source URI, and diagnostic channel.
 * @returns `true` only when one Page Inspector host protocol claimed the message.
 */
export function handlePreviewInspectorHostMessage(
  value: unknown,
  context: PreviewInspectorHostMessageContext,
): boolean {
  if (isPreviewInspectorNeuralModelSyncMessage(value)) {
    const request = readPreviewInspectorNeuralModelSyncRequest(value);
    if (
      !context.enabled ||
      request?.runtimeRevision !==
        (context.expectedNeuralRuntimeRevision ?? context.currentRuntimeRevision)
    ) {
      context.log.debug('Ignored a malformed, disabled, or stale React Inspector neural model.');
    } else {
      context.synchronizeNeuralResidualModel?.(request.model, request.runtimeRevision);
    }
    return true;
  }
  const executionRetry = readPreviewInspectorPageExecutionRetryRequest(value);
  if (executionRetry !== undefined) {
    if (executionRetry.runtimeRevision !== context.currentRuntimeRevision) {
      context.log.debug('Ignored a stale React Inspector Page Execution retry request.');
    } else {
      context.selectPageExecutionRetry?.(executionRetry);
    }
    return true;
  }
  if (isPreviewInspectorPageCandidateSelectionMessage(value)) {
    const request = readPreviewInspectorPageCandidateSelectionRequest(value);
    if (request?.runtimeRevision !== context.currentRuntimeRevision) {
      context.log.debug('Ignored a malformed or stale React Inspector page candidate selection.');
    } else {
      context.selectPageCandidate?.(request);
    }
    return true;
  }
  if (isPreviewInspectorRouteSelectionMessage(value)) {
    const request = readPreviewInspectorRouteSelectionRequest(value);
    if (request?.runtimeRevision !== context.currentRuntimeRevision) {
      context.log.debug('Ignored a malformed or stale React Inspector route selection message.');
    } else {
      context.selectRoute?.(request);
    }
    return true;
  }
  if (isPreviewInspectorBranchSourceDecorationMessage(value)) {
    const request = readPreviewInspectorBranchSourceDecorationRequest(value);
    if (request === undefined) {
      context.log.debug('Ignored a malformed React Inspector branch decoration message.');
    } else {
      context.sourceDecoration.decorateBranches(request, context);
    }
    return true;
  }
  if (isPreviewInspectorSourceSelectionMessage(value)) {
    const request = readPreviewInspectorSourceSelectionRequest(value);
    if (request === undefined) {
      context.log.debug('Ignored a malformed React Inspector source selection message.');
    } else {
      context.sourceDecoration.select(request, context);
    }
    return true;
  }
  const runtimeHealth = readPreviewRuntimeHealthMessage(value);
  if (runtimeHealth !== undefined && isVerifiedTargetOutput(runtimeHealth)) {
    context.settleVerifiedTargetOutput?.(runtimeHealth);
  }
  if (
    handlePreviewRuntimeHealthMessage(value, {
      enabled: context.enabled,
      log: context.log,
      targetPath: context.targetPath,
    })
  ) {
    return true;
  }
  if (
    handlePreviewBlockerTraceMessage(value, {
      dependencyPaths: context.dependencyPaths,
      enabled: context.enabled,
      expectedPreviewCommand: context.expectedPreviewCommand,
      log: context.log,
      pinnedDocumentUri: context.pinnedDocumentUri,
      targetPath: context.targetPath,
    })
  ) {
    return true;
  }
  return handlePreviewInspectorSourceNavigationMessage(value, context);
}

/** Accepts only exact, blocker-free output with complete context and no shallow visual debt. */
function isVerifiedTargetOutput(message: PreviewRuntimeHealthMessage): boolean {
  if (
    message.event.event !== 'page-composition-snapshot' ||
    message.event.category !== 'page-composition'
  ) {
    return false;
  }
  const detail = readHealthRecord(message.event.detail);
  const target = readHealthRecord(detail?.targetState);
  const blockers = readHealthRecord(detail?.blockerSummary);
  const candidate = readHealthRecord(detail?.candidate);
  const projection = readHealthRecord(detail?.projectionSummary);
  const provenance = detail?.activeBlockerProvenance;
  return (
    target?.stage === 'target-output' &&
    target.status === 'reached' &&
    target.outputKind === 'target-output' &&
    target.mounted === true &&
    target.hasOutput === true &&
    target.pageRootCommitted === true &&
    target.projectedCompatibilityOutput !== true &&
    candidate?.complete === true &&
    projection?.observed === true &&
    projection?.count === 0 &&
    blockers?.active === 0 &&
    Array.isArray(provenance) &&
    provenance.length === 0
  );
}

/** Narrows one already-budgeted health JSON node without evaluating project accessors. */
function readHealthRecord(
  value: PreviewRuntimeHealthJson | undefined,
): Readonly<Record<string, PreviewRuntimeHealthJson>> | undefined {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return undefined;
  return value as Readonly<Record<string, PreviewRuntimeHealthJson>>;
}
