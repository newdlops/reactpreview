/** Validates browser candidate-selection messages before they can trigger a narrow rebuild. */

const MAXIMUM_CANDIDATE_ID_LENGTH = 512;
const MAXIMUM_INTERACTION_ID_LENGTH = 128;
const CANDIDATE_ID_PATTERN = /^[A-Za-z0-9._:/@\-]+$/u;
const INTERACTION_ID_PATTERN = /^page:[A-Za-z0-9._-]+:[A-Za-z0-9._-]+$/u;

/** One bounded Page Inspector candidate selection request from the current webview revision. */
export interface PreviewInspectorPageCandidateSelectionRequest {
  /** Public static candidate identity, never a filesystem path supplied by the browser. */
  readonly candidateId: string;
  /** Browser-generated id correlating this request with later terminal host status. */
  readonly interactionId: string;
  /** Runtime revision that displayed this candidate inventory. */
  readonly runtimeRevision: number;
  /** Exact protocol discriminator. */
  readonly type: 'react-preview-inspector-page-candidate-selected';
}

/** Returns true only when an untrusted value claims this protocol discriminator. */
export function isPreviewInspectorPageCandidateSelectionMessage(value: unknown): boolean {
  return (
    typeof value === 'object' &&
    value !== null &&
    !Array.isArray(value) &&
    (value as Record<string, unknown>).type === 'react-preview-inspector-page-candidate-selected'
  );
}

/** Parses one bounded candidate request without accepting paths, URLs, or arbitrary payloads. */
export function readPreviewInspectorPageCandidateSelectionRequest(
  value: unknown,
): PreviewInspectorPageCandidateSelectionRequest | undefined {
  if (!isPreviewInspectorPageCandidateSelectionMessage(value)) return undefined;
  const message = value as Record<string, unknown>;
  const candidateId = message.candidateId;
  const interactionId = message.interactionId;
  const runtimeRevision = message.runtimeRevision;
  if (
    typeof candidateId !== 'string' ||
    candidateId.length === 0 ||
    candidateId.length > MAXIMUM_CANDIDATE_ID_LENGTH ||
    !CANDIDATE_ID_PATTERN.test(candidateId) ||
    typeof interactionId !== 'string' ||
    interactionId.length === 0 ||
    interactionId.length > MAXIMUM_INTERACTION_ID_LENGTH ||
    !INTERACTION_ID_PATTERN.test(interactionId) ||
    typeof runtimeRevision !== 'number' ||
    !Number.isSafeInteger(runtimeRevision) ||
    runtimeRevision < 0
  ) {
    return undefined;
  }
  return Object.freeze({
    candidateId,
    interactionId,
    runtimeRevision,
    type: 'react-preview-inspector-page-candidate-selected',
  });
}
