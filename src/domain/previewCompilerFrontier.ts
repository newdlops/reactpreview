/** Describes automatic Page Inspector frontier preparation without imposing graph-size limits. */
import type { PreviewPreparationMode } from './preview';

/** Why a source could not enter the structurally verified executable bundle frontier. */
export type PreviewCompilerFrontierReason =
  'exact-source-unreadable' | 'source-parse-failure' | 'slice-unavailable' | 'frontier-mismatch';

/** Automatic mode identity retained by the frozen-frontier pipeline. */
export interface PreviewCompilerFrontierPolicy {
  readonly mode: Extract<PreviewPreparationMode, 'fast' | 'corridor'>;
}

const FAST_FRONTIER: PreviewCompilerFrontierPolicy = Object.freeze({
  mode: 'fast',
});

const CORRIDOR_FRONTIER: PreviewCompilerFrontierPolicy = Object.freeze({
  mode: 'corridor',
});

/** Returns no automatic frontier for the deliberate full compatibility mode. */
export function createPreviewCompilerFrontierPolicy(
  mode: PreviewPreparationMode,
): PreviewCompilerFrontierPolicy | undefined {
  return mode === 'fast' ? FAST_FRONTIER : mode === 'corridor' ? CORRIDOR_FRONTIER : undefined;
}
