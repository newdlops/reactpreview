/**
 * Public input contracts for bounded static render-chain planning.
 *
 * Keeping configuration shapes outside the graph implementation leaves traversal, indexing, and
 * path ranking readable while preserving one stable type boundary for compiler and Inspector
 * callers.
 */
import type { ResolvePreviewRenderGraphModule } from './previewRenderGraphTypes';
import type {
  AnalyzePreviewRenderSource,
  CollectPreviewRenderModuleSpecifiers,
} from './previewRenderSourceAnalysis';

/** Inputs for one target export's bounded application-entry search. */
export interface CreatePreviewRenderChainPlanOptions {
  /** Optional file-granular AST analyzer retained across compiler rebuilds. */
  readonly analyzeSource?: AnalyzePreviewRenderSource;
  /** Optional file-granular literal import collector retained across compiler rebuilds. */
  readonly collectModuleSpecifiers?: CollectPreviewRenderModuleSpecifiers;
  /** Current source path selected in the editor. */
  readonly documentPath: string;
  /** Exact runtime export to connect to one or more application entries. */
  readonly exportName: string;
  /** Snapshot-aware source reader shared with other preview discovery passes. */
  readonly readSource: (sourcePath: string) => Promise<string | undefined>;
  /** Alias/package-aware module resolver that never executes project configuration JavaScript. */
  readonly resolveModule: ResolvePreviewRenderGraphModule;
  /** Cancels stale entry and reverse-graph work between bounded file batches. */
  readonly signal?: AbortSignal;
  /** Bounded workspace or monorepo source inventory. */
  readonly sourcePaths: readonly string[];
}

/** Inputs for discovering every explicit current-file export against one shared render graph. */
export interface CreatePreviewRenderChainPlansOptions extends Omit<
  CreatePreviewRenderChainPlanOptions,
  'exportName'
> {
  /** Exact runtime export names admitted by the target export selector. */
  readonly exportNames: readonly string[];
  /**
   * Export whose first visible page must retain exhaustive package/workspace fallback.
   * Other exports still share every already-proven entry slice, but an unrelated orphan export
   * cannot force a full inventory parse before the selected Inspector page is ready.
   */
  readonly primaryExportName?: string;
  /**
   * Keeps entry-unreachable caller paths beside the fastest proven entry slice.
   *
   * Hook/HOC/factory modules need this because one connected page must not erase other consumers
   * whose outer route owners were intentionally omitted from the fast corridor.
   */
  readonly preservePartialConsumers?: boolean;
}
