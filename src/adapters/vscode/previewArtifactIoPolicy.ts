/** Chooses a low-memory filesystem concurrency limit from the complete artifact byte volume. */
import type { PlannedPreviewArtifactFile } from './previewArtifactLayout';

const MEBIBYTE = 1024 * 1024;

/**
 * Limits simultaneous VS Code filesystem writes so large byte arrays do not remain queued in many
 * provider promises at once. Empty input still returns one for callers that share the policy.
 */
export function selectPreviewArtifactIoConcurrency(
  files: readonly PlannedPreviewArtifactFile[],
): number {
  const totalBytes = files.reduce((total, file) => total + file.contents.byteLength, 0);
  if (totalBytes <= 16 * MEBIBYTE) return 8;
  if (totalBytes <= 64 * MEBIBYTE) return 4;
  return 2;
}
