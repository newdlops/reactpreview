/**
 * Owns split-output thresholds and the diagnostic emitted when a large local graph is coalesced.
 * Keeping this policy outside the compiler separates build orchestration from output-limit wording
 * and makes the hard production cap impossible to weaken through a test-only constructor option.
 */
import type { PreviewDiagnostic } from '../../domain/preview';
import { MAX_PREVIEW_OUTPUT_FILES } from './previewBuildOutputPlanner';

/** Clamps a configurable split threshold beneath the immutable artifact file-count guard. */
export function normalizeMaximumSplitOutputFiles(configuredMaximum: number | undefined): number {
  if (!Number.isSafeInteger(configuredMaximum) || configuredMaximum === undefined) {
    return MAX_PREVIEW_OUTPUT_FILES;
  }
  return Math.min(MAX_PREVIEW_OUTPUT_FILES, Math.max(1, configuredMaximum));
}

/** Explains why lazy module initializers were packed into fewer physical local output files. */
export function createCoalescedOutputDiagnostic(
  splitOutputCount: number,
  coalescedOutputCount: number,
  targetName: string,
): PreviewDiagnostic {
  return {
    message: `The split preview graph for ${targetName} produced ${splitOutputCount.toString()} local output files, so React Preview automatically coalesced it into ${coalescedOutputCount.toString()} output file(s). Dynamic-import modules still initialize only when their loader is invoked, while per-module file splitting is disabled for this oversized local graph.`,
    severity: 'warning',
  };
}
