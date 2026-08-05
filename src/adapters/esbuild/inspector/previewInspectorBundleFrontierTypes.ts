import type { PreviewCompilerFrontierReason } from '../../../domain/previewCompilerFrontier';
import type { PreviewInspectorFrontierSourceKind } from './previewInspectorPageFrontier';

/** One literal runtime import edge collected before native esbuild resolution. */
export interface PreviewInspectorRuntimeImportEdge {
  readonly importedNames: readonly string[];
  readonly kind: 'dynamic-import' | 'export' | 'import' | 'import-equals' | 'require';
  readonly moduleSpecifier: string;
  readonly occurrenceStart: number;
  readonly typeOnly: false;
}

/** Structural failures that may safely replace an optional edge with an existing projection. */
export type PreviewInspectorFrontierProjectionReason =
  | Extract<
      PreviewCompilerFrontierReason,
      'exact-source-unreadable' | 'source-parse-failure' | 'slice-unavailable'
    >
  | 'budget-projection';

/** Immutable representation consumed by the frozen-frontier corridor plugin. */
export interface PreviewInspectorBundleFrontier {
  readonly authenticComponentExports: readonly PreviewInspectorFrontierComponentExports[];
  readonly authenticSourcePaths: readonly string[];
  readonly exactSourcePaths: readonly string[];
  readonly identity: string;
  readonly packageDemandSourcePaths: readonly string[];
  readonly projectedEdges: readonly PreviewInspectorProjectedEdge[];
  readonly summary: PreviewInspectorBundleFrontierSummary;
  readonly version: 1 | 2;
  /** Present only for the Page Execution Slice frontier format. */
  readonly executionCandidateId?: string;
  /** Admission class for each v2 authored source. */
  readonly sourceKinds?: Readonly<Record<string, PreviewInspectorFrontierSourceKind>>;
}

export interface PreviewInspectorFrontierComponentExports {
  readonly exportNames: readonly string[];
  readonly runtimeHookExportNames: readonly string[];
  readonly sourcePath: string;
}

export interface PreviewInspectorProjectedEdge {
  readonly exportNames: readonly string[];
  readonly importerPath: string;
  readonly moduleSpecifier: string;
  /** Syntax-proven route-module identity retained by an otherwise shallow component projection. */
  readonly neutralRouteBasePath?: string;
  readonly occurrenceStart: number;
  readonly reason: PreviewInspectorFrontierProjectionReason;
  readonly runtimeHookExportNames: readonly string[];
  readonly targetPath?: string;
}

export interface PreviewInspectorBundleFrontierSummary {
  readonly authoredEdgeCount: number;
  /** Syntax-proven authored edges projected to keep native compilation inside the policy envelope. */
  readonly boundedProjectionCount?: number;
  readonly exactModuleCount: number;
  readonly maximumDepth: number;
  readonly optionalComponentCount: number;
  readonly packageDemandSourceCount: number;
  readonly projectedEdgeCount: number;
  readonly sourceBytes: number;
  readonly supportModuleCount: number;
  readonly totalAuthoredModuleCount: number;
  readonly truncationReasons: readonly PreviewCompilerFrontierReason[];
}
