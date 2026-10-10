/** Validates the one browser-to-host retry request for a compiler-owned Page Execution candidate. */
import { isPreviewInspectorPageCandidateId } from './previewInspectorPageCandidateSelectionProtocol';

const ID_PATTERN = /^[A-Za-z0-9._:/@\-]+$/u;

export interface PreviewInspectorPageExecutionRetryRequest {
  readonly candidateId: string;
  readonly executionCandidateId: string;
  readonly interactionId: string;
  /** Returns to an execution this session already committed (a failed full-page replay's fallback). */
  readonly restore?: true;
  readonly runtimeRevision: number;
  readonly type: 'react-preview-inspector-page-execution-retry';
}

/** Parses only bounded opaque ids; compiler revalidates them against current static candidates. */
export function readPreviewInspectorPageExecutionRetryRequest(
  value: unknown,
): PreviewInspectorPageExecutionRetryRequest | undefined {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return undefined;
  const message = value as Record<string, unknown>;
  const candidateId = message.candidateId;
  const executionCandidateId = message.executionCandidateId;
  const interactionId = message.interactionId;
  const runtimeRevision = message.runtimeRevision;
  const restore = message.restore;
  if (
    message.type !== 'react-preview-inspector-page-execution-retry' ||
    !isPreviewInspectorPageCandidateId(candidateId) ||
    typeof executionCandidateId !== 'string' ||
    executionCandidateId.length === 0 ||
    executionCandidateId.length > 512 ||
    !ID_PATTERN.test(executionCandidateId) ||
    typeof interactionId !== 'string' ||
    interactionId.length === 0 ||
    interactionId.length > 128 ||
    !ID_PATTERN.test(interactionId) ||
    !interactionId.startsWith('execution:') ||
    typeof runtimeRevision !== 'number' ||
    !Number.isSafeInteger(runtimeRevision) ||
    runtimeRevision < 0 ||
    (restore !== undefined && restore !== true)
  )
    return undefined;
  return Object.freeze({
    candidateId,
    executionCandidateId,
    interactionId,
    ...(restore === true ? { restore } : {}),
    runtimeRevision,
    type: 'react-preview-inspector-page-execution-retry',
  });
}
