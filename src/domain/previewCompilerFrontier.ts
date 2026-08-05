/** Describes automatic Page Inspector frontier preparation and its safe projection envelope. */
import type { PreviewPreparationMode } from './preview';

/** Why a source could not enter the structurally verified executable bundle frontier. */
export type PreviewCompilerFrontierReason =
  'exact-source-unreadable' | 'source-parse-failure' | 'slice-unavailable' | 'frontier-mismatch';

/** Automatic mode identity retained by the frozen-frontier pipeline. */
export interface PreviewCompilerFrontierPolicy {
  /** Soft cap: syntax-proven optional branches become projections before this count is exceeded. */
  readonly maximumAuthoredModules: number;
  /** Soft cap paired with module count so a few generated sources cannot exhaust the compiler. */
  readonly maximumSourceBytes: number;
  readonly mode: Extract<PreviewPreparationMode, 'fast' | 'corridor'>;
}

const FAST_FRONTIER: PreviewCompilerFrontierPolicy = Object.freeze({
  maximumAuthoredModules: 256,
  maximumSourceBytes: 1024 * 1024,
  mode: 'fast',
});

const CORRIDOR_FRONTIER: PreviewCompilerFrontierPolicy = Object.freeze({
  maximumAuthoredModules: 512,
  maximumSourceBytes: 2 * 1024 * 1024,
  mode: 'corridor',
});

/** Returns no automatic frontier for the deliberate full compatibility mode. */
export function createPreviewCompilerFrontierPolicy(
  mode: PreviewPreparationMode,
): PreviewCompilerFrontierPolicy | undefined {
  return mode === 'fast' ? FAST_FRONTIER : mode === 'corridor' ? CORRIDOR_FRONTIER : undefined;
}
