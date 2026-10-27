/** Bounded fast-corridor discovery contracts and source scan limits. */
import type { ResolvePreviewRenderGraphModule } from '../renderGraph/previewRenderGraphTypes';
import type { ReadPreviewInspectorSource } from './previewInspectorAncestorTypes';
import type { PreviewInspectorOneHopVisualPath } from './previewInspectorShallowVisualTypes';

export const MAXIMUM_ENTRY_DIRECTORIES = 96;

export const MAXIMUM_ENTRY_FILES = 96;

export const MAXIMUM_REVERSE_DIRECTORIES = 48;

export const MAXIMUM_FILES_PER_REVERSE_DIRECTORY = 192;

export const MAXIMUM_REVERSE_FILES = 640;

export const MINIMUM_TARGETED_REVERSE_FILES = 96;

export const MAXIMUM_TARGETED_REVERSE_FILES = 2_048;

export const TARGETED_REVERSE_READ_BATCH_SIZE = 32;

export const MAXIMUM_DYNAMIC_REVERSE_PIVOTS = 6;

export const MAXIMUM_DYNAMIC_REVERSE_PATHS_PER_PIVOT = 64;

export const MAXIMUM_FORWARD_FILES = 768;

export const MAXIMUM_FORWARD_AFFINITY_PATHS = 16;

export const MAXIMUM_IMPORTS_PER_FILE = 256;

export const MAXIMUM_PAGE_SUBTREE_FILES = 128;

export const MAXIMUM_ONE_HOP_CONTEXT_FILES = 64;

export const MAXIMUM_FAST_DYNAMIC_IMPORTS = 8;

export const MAXIMUM_FAST_ROUTE_IMPORTS = 48;

export const SOURCE_FILE_PATTERN = /\.[cm]?[jt]sx?$/iu;

export const ENTRY_FILE_PATTERN =
  /^(?:app|bootstrap|client|entry|index|init|main|mount|render|renderer|root|start)(?:[-_.].*)?\.[cm]?[jt]sx?$/iu;

export const PAGE_SHELL_FILE_PATTERN =
  /(?:^|[-_.])(?:apps?|layouts?|pages?|routes?|routers?|screens?|shells?|templates?|views?)(?:[-_.]|$)/iu;

/** Inputs for one bounded entry-to-target corridor discovery pass. */
export interface CollectPreviewInspectorFastPageCorridorOptions {
  /** Dirty editor files that may not yet exist in a directory listing. */
  readonly additionalSourcePaths?: Iterable<string>;
  /** Absolute component source selected by the editor command. */
  readonly documentPath: string;
  /** Nearest package root used for cheap conventional-entry enumeration. */
  readonly projectRoot: string;
  /** Snapshot-aware and byte-bounded source reader owned by the compiler cache. */
  readonly readSource: ReadPreviewInspectorSource;
  /** Exact alias-aware resolver shared with the eventual esbuild invocation. */
  readonly resolveModule: ResolvePreviewRenderGraphModule;
  /** Cancels stale traversal work before another editor revision can reuse it. */
  readonly signal?: AbortSignal;
  /** Exact selected export required from the target module; omitted for module-wide consumers. */
  readonly targetExportName?: string;
  /** Trusted workspace boundary; resolved project modules may cross package roots inside it. */
  readonly workspaceRoot: string;
}

/** A small proven or provisional path passed to the existing Page Inspector ancestor planner. */
export interface PreviewInspectorFastPageCorridor {
  /** True only when a semantic ReactDOM entry reaches the target-side reverse closure. */
  readonly entryConnected: boolean;
  /** Entry/root-to-target import corridor in authored order. */
  readonly importPath: readonly string[];
  /** Proven auxiliary App Router page; absent for ordinary generic React corridors. */
  readonly nextAppPagePath?: string;
  /** Shallow visual import/value-flow evidence retained for later bounded bundler projection. */
  readonly shallowVisualPaths: readonly PreviewInspectorOneHopVisualPath[];
  /** Corridor plus bounded JSX-oriented page subtree evidence. */
  readonly sourcePaths: readonly string[];
  /** Honest budget marker used by tests and future diagnostics. */
  readonly truncated: boolean;
}

/** One target-side reverse frontier with the child it directly imports. */
export interface ReverseFrontier {
  readonly depth: number;
  readonly sourcePath: string;
}

/** Result of removing an application-wide router that would defeat a target-first first paint. */
export interface PreviewBoundedFastImportPath {
  /** Remaining page-local owner-to-target path. */
  readonly importPath: readonly string[];
  /** True when one or more application registry ancestors were deliberately deferred. */
  readonly trimmed: boolean;
}
