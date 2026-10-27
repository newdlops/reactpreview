/** Frontier planning contracts, queue items, and authored source categories. */
import type { PreviewCompilerFrontierPolicy } from '../../../domain/previewCompilerFrontier';
import type { PreviewInspectorAncestorPlan } from './previewInspectorAncestorPlan';
import type { PreviewInspectorBundleDiagnosticsCollector } from './previewInspectorBundleDiagnostics';
import type {
  PreviewInspectorBundleFrontier,
  PreviewInspectorProjectedEdge,
} from './previewInspectorBundleFrontierTypes';
import { type PreviewInspectorBundleSourceInventoryMemo } from './previewInspectorBundleSourceInventoryMemo';
import type { PreviewInspectorPageExecutionCandidate } from './previewInspectorPageExecutionTypes';

export const SOURCE_MODULE_PATTERN = /(?:\.d)?\.[cm]?[jt]sx?$/iu;

export const STYLE_OR_ASSET_PATTERN =
  /\.(?:css|less|sass|scss|svg|png|jpe?g|gif|webp|avif|woff2?|ttf|eot)$/iu;

/** Keeps a small lazy shell intact while preventing route catalogs from becoming page chrome. */
export const MAXIMUM_SMALL_PAGE_SHELL_DYNAMIC_IMPORTS = 8;

export interface PreparePreviewInspectorBundleFrontierOptions {
  readonly bundleDiagnostics?: PreviewInspectorBundleDiagnosticsCollector;
  /** Runtime bridge modules that the generated execution entry evaluates beside selected surfaces. */
  readonly runtimeCompanionSourcePaths?: readonly string[];
  /** A frozen Page Execution candidate switches exact admission from broad evidence to surfaces. */
  readonly executionCandidate?: PreviewInspectorPageExecutionCandidate;
  readonly plan: PreviewInspectorAncestorPlan;
  readonly policy: PreviewCompilerFrontierPolicy;
  /** Vite-root-relative glob base; defaults to the workspace for direct/test callers. */
  readonly projectRoot?: string;
  readonly readSource: (sourcePath: string) => Promise<string | undefined>;
  /** Page selection accounts only shared-cache misses upstream to avoid duplicate raw-read counts. */
  readonly rawSourceReadAccounting?: 'upstream-page-cache';
  readonly resolveModule: (specifier: string, importer: string) => string | undefined;
  /** Request-owned reuse of only exact source-inventory analysis. */
  readonly sourceInventoryMemo?: PreviewInspectorBundleSourceInventoryMemo;
  readonly workspaceRoot: string;
}

export interface PreparedPreviewInspectorBundleFrontier {
  readonly frontier: PreviewInspectorBundleFrontier;
  readonly rejected: boolean;
}

export interface FrontierSourceQueueItem {
  readonly depth: number;
  readonly kind:
    | 'exact'
    | 'optional-component'
    | 'optional-support'
    | 'page-shell-component'
    | 'support'
    | 'target-component';
  readonly optionalEdge?: Omit<PreviewInspectorProjectedEdge, 'reason'>;
  readonly sourcePath: string;
}

export type AdmittedKind = FrontierSourceQueueItem['kind'];
