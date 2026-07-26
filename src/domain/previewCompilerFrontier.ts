/**
 * Deterministic graph-admission limits for automatic Page Inspector preparation.
 *
 * Limits are mode contracts rather than adaptive timeouts: an omitted source is represented by a
 * generated projection, while `full` remains the explicit compatibility escape hatch.
 */
import type { PreviewPreparationMode } from './preview';
import type { PreviewCompilerGraphSummary } from './previewCompilerActivity';

/** Why a source or edge could not enter the bounded executable bundle frontier. */
export type PreviewCompilerFrontierReason =
  | 'optional-component-count'
  | 'optional-support-count'
  | 'authored-edge-count'
  | 'component-depth'
  | 'total-module-count'
  | 'source-byte-count'
  | 'single-source-bytes'
  | 'package-demand-count'
  | 'bare-package-count'
  | 'style-asset-count'
  | 'exact-module-count'
  | 'exact-source-bytes'
  | 'exact-source-unreadable'
  | 'source-parse-failure'
  | 'frontier-mismatch';

/** Fixed admission budgets for one automatic preparation mode. */
export interface PreviewCompilerFrontierPolicy {
  readonly maximumAuthoredImportEdgeCount: number;
  readonly maximumComponentDepth: number;
  readonly maximumDistinctBarePackageSpecifiers: number;
  readonly maximumExactModuleCount: number;
  readonly maximumOptionalComponentIdentityCount: number;
  readonly maximumOptionalSupportModuleCount: number;
  readonly maximumPackageDemandSourceCount: number;
  readonly maximumStyleAndAssetEdgeCount: number;
  readonly maximumTotalAuthoredModuleCount: number;
  readonly maximumTotalSourceBytes: number;
  readonly mode: Extract<PreviewPreparationMode, 'fast' | 'corridor'>;
  /** Preferred page-slice envelope used for fidelity selection and optional admission. */
  readonly softMaximumAuthoredImportEdgeCount: number;
  readonly softMaximumComponentDepth: number;
  readonly softMaximumDistinctBarePackageSpecifiers: number;
  readonly softMaximumExactModuleCount: number;
  readonly softMaximumOptionalComponentIdentityCount: number;
  readonly softMaximumOptionalSupportModuleCount: number;
  readonly softMaximumPackageDemandSourceCount: number;
  readonly softMaximumStyleAndAssetEdgeCount: number;
  readonly softMaximumTotalAuthoredModuleCount: number;
  readonly softMaximumTotalSourceBytes: number;
}

const FAST_FRONTIER: PreviewCompilerFrontierPolicy = Object.freeze({
  maximumAuthoredImportEdgeCount: 1_536,
  maximumComponentDepth: 40,
  maximumDistinctBarePackageSpecifiers: 128,
  maximumExactModuleCount: 320,
  maximumOptionalComponentIdentityCount: 192,
  maximumOptionalSupportModuleCount: 384,
  maximumPackageDemandSourceCount: 256,
  maximumStyleAndAssetEdgeCount: 384,
  maximumTotalAuthoredModuleCount: 512,
  maximumTotalSourceBytes: 24 * 1024 * 1024,
  mode: 'fast',
  softMaximumAuthoredImportEdgeCount: 1_024,
  softMaximumComponentDepth: 32,
  softMaximumDistinctBarePackageSpecifiers: 96,
  softMaximumExactModuleCount: 256,
  softMaximumOptionalComponentIdentityCount: 128,
  softMaximumOptionalSupportModuleCount: 256,
  softMaximumPackageDemandSourceCount: 192,
  softMaximumStyleAndAssetEdgeCount: 256,
  softMaximumTotalAuthoredModuleCount: 384,
  softMaximumTotalSourceBytes: 16 * 1024 * 1024,
});

const CORRIDOR_FRONTIER: PreviewCompilerFrontierPolicy = Object.freeze({
  maximumAuthoredImportEdgeCount: 4_096,
  maximumComponentDepth: 64,
  maximumDistinctBarePackageSpecifiers: 192,
  maximumExactModuleCount: 640,
  maximumOptionalComponentIdentityCount: 384,
  maximumOptionalSupportModuleCount: 768,
  maximumPackageDemandSourceCount: 512,
  maximumStyleAndAssetEdgeCount: 768,
  maximumTotalAuthoredModuleCount: 1_024,
  maximumTotalSourceBytes: 48 * 1024 * 1024,
  mode: 'corridor',
  softMaximumAuthoredImportEdgeCount: 3_072,
  softMaximumComponentDepth: 48,
  softMaximumDistinctBarePackageSpecifiers: 144,
  softMaximumExactModuleCount: 512,
  softMaximumOptionalComponentIdentityCount: 256,
  softMaximumOptionalSupportModuleCount: 512,
  softMaximumPackageDemandSourceCount: 384,
  softMaximumStyleAndAssetEdgeCount: 512,
  softMaximumTotalAuthoredModuleCount: 768,
  softMaximumTotalSourceBytes: 32 * 1024 * 1024,
});

/** Returns no automatic frontier for the deliberate unbounded full compatibility mode. */
export function createPreviewCompilerFrontierPolicy(
  mode: PreviewPreparationMode,
): PreviewCompilerFrontierPolicy | undefined {
  return mode === 'fast' ? FAST_FRONTIER : mode === 'corridor' ? CORRIDOR_FRONTIER : undefined;
}

/** Rejects only a preflight graph that is already larger than its automatic bundle contract. */
export function exceedsPreviewCompilerFrontier(
  summary: Pick<PreviewCompilerGraphSummary, 'corridorSourceCount'>,
  policy: PreviewCompilerFrontierPolicy | undefined,
): boolean {
  return (
    policy !== undefined && summary.corridorSourceCount > policy.maximumTotalAuthoredModuleCount
  );
}
