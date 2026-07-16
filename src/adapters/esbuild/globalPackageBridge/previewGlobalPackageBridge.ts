/**
 * Declares immutable metadata shared by implicit-global evidence collectors and esbuild injection.
 * A bridge never writes to `globalThis`; it replaces a genuinely free identifier with one exact,
 * statically selected project module export.
 */

/** Supported ways to expose one module through a free JavaScript identifier. */
export type PreviewGlobalPackageExportKind = 'auto' | 'default' | 'named' | 'namespace';

/**
 * Static evidence ordered from explicit project behavior to conservative package-name fallback.
 * An explicit preview hint is user authority and therefore outranks inferred application evidence.
 */
export type PreviewGlobalPackageEvidence =
  | 'explicit-hint'
  | 'runtime-assignment'
  | 'ambient-declaration'
  | 'free-identifier'
  | 'dependency-name';

/** User- or analyzer-supplied evidence for one implicit runtime binding. */
export interface PreviewGlobalPackageBridgeCandidate {
  /** Evidence category used for deterministic conflict resolution and diagnostics. */
  readonly evidence: PreviewGlobalPackageEvidence;
  /** Module export selection; `auto` unwraps ESM/CommonJS defaults or keeps a namespace. */
  readonly exportKind?: PreviewGlobalPackageExportKind;
  /** Named module export selected only when `exportKind` is `named`. */
  readonly exportName?: string;
  /** JavaScript identifier expected by application source without a lexical declaration. */
  readonly globalName: string;
  /** Bare package, project alias, relative path, or canonical absolute module specifier. */
  readonly moduleSpecifier: string;
  /** Consumer directory from which esbuild must resolve an authored non-absolute specifier. */
  readonly resolveDir: string;
  /** Canonical manifest/module evidence path watched for cache and HMR invalidation. */
  readonly watchPath: string;
}

/** Backward-compatible exact hint shape used by manifest-only discovery callers. */
export interface PreviewGlobalPackageBridgeHint {
  /** Module evidence category; explicit hints are selected when omitted. */
  readonly evidence?: Exclude<PreviewGlobalPackageEvidence, 'dependency-name'>;
  /** Module export selection; `auto` is selected when omitted. */
  readonly exportKind?: PreviewGlobalPackageExportKind;
  /** Named module export selected only when `exportKind` is `named`. */
  readonly exportName?: string;
  /** Free runtime identifier established by project metadata. */
  readonly globalName: string;
  /** Authored module identity, including workspace aliases and absolute paths. */
  readonly moduleSpecifier?: string;
  /** Legacy bare package field retained for callers that have not adopted generic module evidence. */
  readonly packageSpecifier?: string;
  /** Optional consumer directory for aliases; nearest project root is used when omitted. */
  readonly resolveDir?: string;
  /** Optional canonical module evidence; installed package manifest is used when omitted. */
  readonly watchPath?: string;
}

/** Validated active bridge consumed by one generated esbuild inject module. */
export interface PreviewGlobalPackageBridge {
  /** Winning static evidence retained for actionable runtime diagnostics. */
  readonly evidence: PreviewGlobalPackageEvidence;
  /** Validated module export selection. */
  readonly exportKind: PreviewGlobalPackageExportKind;
  /** Named module export when `exportKind` is `named`. */
  readonly exportName?: string;
  /** Free identifier replaced only when esbuild finds no closer lexical declaration. */
  readonly globalName: string;
  /** Exact module specifier imported before evaluating its target consumer graph. */
  readonly moduleSpecifier: string;
  /** Consumer directory preserving monorepo, alias, and hoisted package resolution identity. */
  readonly resolveDir: string;
  /** Static evidence path observed by preview cache and hot reload. */
  readonly watchPath: string;
}

/** Per-candidate outcome suitable for a detailed preview runtime diagnostic. */
export interface PreviewGlobalPackageBridgeInventoryItem {
  /** Evidence associated with this candidate. */
  readonly evidence: PreviewGlobalPackageEvidence;
  /** Free identifier considered by the compatibility planner. */
  readonly globalName: string;
  /** Module identity considered for injection. */
  readonly moduleSpecifier: string;
  /** Whether this candidate won, was lower priority, was ambiguous, or failed validation. */
  readonly status: 'active' | 'ambiguous' | 'invalid' | 'shadowed';
}

/** Complete bounded bridge plan suitable for one build and its diagnostics/HMR graph. */
export interface PreviewGlobalPackageBridgePlan {
  /** Deterministic, collision-free active module bridges. */
  readonly bridges: readonly PreviewGlobalPackageBridge[];
  /** Static evidence files whose edits must invalidate a cached preview plan. */
  readonly dependencyPaths: readonly string[];
  /** Exact dependency names worth checking in reached source before an adaptive fallback build. */
  readonly fallbackCandidateNames: readonly string[];
  /** Candidate-level explanation of every selection decision. */
  readonly inventory: readonly PreviewGlobalPackageBridgeInventoryItem[];
  /** Whether an upstream analyzer omitted candidates due to a safety budget. */
  readonly truncated: boolean;
}
