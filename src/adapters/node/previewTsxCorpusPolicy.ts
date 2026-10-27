/** Validates persisted corpus policy records before dispatch or aggregate verification can use them. */
import {
  PREVIEW_TSX_CORPUS_ARCHITECTURE_ID,
  PREVIEW_TSX_CORPUS_CAMPAIGN_SCHEMA_VERSION,
  type PreviewTsxCorpusFrozenPolicy,
} from './previewHeadlessTsxCorpusCampaignTypes';

/** Proves the complete frozen policy shape, including literal protocol tags and sentinel identities. */
export function isPreviewTsxCorpusFrozenPolicy(
  value: unknown,
): value is PreviewTsxCorpusFrozenPolicy {
  if (!isPolicyRecord(value)) return false;
  if (
    value.architectureId !== PREVIEW_TSX_CORPUS_ARCHITECTURE_ID ||
    value.version !== PREVIEW_TSX_CORPUS_CAMPAIGN_SCHEMA_VERSION ||
    value.protocolVersion !== 3 ||
    value.pipelineDepth !== 1 ||
    value.reuseMode !== 'persistent-compiler-fresh-browser' ||
    typeof value.laneCount !== 'number' ||
    ![12, 14, 16].includes(value.laneCount) ||
    typeof value.classifierVersion !== 'number' ||
    !Number.isSafeInteger(value.classifierVersion) ||
    typeof value.engineDigest !== 'string' ||
    typeof value.manifestSha256 !== 'string' ||
    typeof value.policyDigest !== 'string' ||
    typeof value.selectedAt !== 'string' ||
    !Array.isArray(value.sentinels)
  )
    return false;
  const sentinels: readonly unknown[] = value.sentinels;
  return sentinels.every(
    (sentinel) =>
      isPolicyRecord(sentinel) &&
      typeof sentinel.digest === 'string' &&
      typeof sentinel.fidelity === 'string' &&
      typeof sentinel.index === 'number' &&
      Number.isSafeInteger(sentinel.index) &&
      sentinel.index >= 0,
  );
}

/** Rejects nulls, arrays, and primitive JSON before inspecting policy fields. */
function isPolicyRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
