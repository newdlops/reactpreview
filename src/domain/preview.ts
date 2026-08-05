/**
 * Defines the framework-neutral data exchanged by preview use cases and adapters.
 * This module contains no VS Code or esbuild imports, which keeps the core model reusable and
 * prevents infrastructure details from leaking into application decisions.
 */

/** Source loaders supported by the first preview compiler implementation. */
export type PreviewSourceLanguage = 'js' | 'jsx' | 'ts' | 'tsx';

/** Immutable composition policy selected when a preview panel is opened. */
export type PreviewRenderMode = 'component' | 'page-inspector';

/** Two-phase preparation policy used to minimize time to the first rendered component. */
export type PreviewPreparationMode = 'fast' | 'corridor' | 'full';

/** Optional runtime ownership policy for one compiler-validated Page Inspector route selection. */
export type PreviewInspectorTargetMode = 'selected-route-leaf';

/**
 * Compiler-owned statement about whether one artifact contains the selected file's authored page
 * context. `partial` is deliberately the safe default: a successful direct-file bundle proves
 * that bytes can render, but it does not prove the App-to-page route and layout corridor.
 */
export type PreviewContextCoverage = 'complete' | 'partial';

/**
 * Scheduling intent kept separate from graph completeness.
 * A complete foreground fallback or warm rebuild must never be mistaken for optional background
 * context discovery merely because both use `preparationMode: 'full'`.
 */
export type PreviewBuildIntent = 'context-enrichment' | 'foreground';

/** Immutable editor contents for a file-backed source module that may be imported by the target. */
export interface PreviewSourceSnapshot {
  /** Absolute filesystem path used to match esbuild's resolved module identity. */
  readonly documentPath: string;
  /**
   * Monotonic editor revision used for exact, constant-size snapshot identity when available.
   * Programmatic callers may omit it; consumers must then compare the complete source text.
   */
  readonly documentVersion?: number;
  /** esbuild loader selected from the document filename. */
  readonly language: PreviewSourceLanguage;
  /** Complete current editor contents, including unsaved changes. */
  readonly sourceText: string;
}

/**
 * One statically proven router branch selected in the Page Inspector route explorer.
 *
 * A complete selection is an ordered path because a route can mount another router owner. Keeping
 * only public component and route identities prevents browser messages from choosing filesystem
 * modules directly; the compiler resolves every step again against current authored evidence.
 */
export interface PreviewInspectorRouteSelectionStep {
  /** Component/page identity exposed by JSX, a page map, or an inert route catalog. */
  readonly componentName: string;
  /** Absolute authored route pattern before neutral dynamic values are materialized. */
  readonly pattern: string;
}

/** Canonical source/export/surface identity retained by a campaign route execution plan. */
export interface PreviewRouteExecutionPlanRoleIdentity {
  readonly exportName: string;
  readonly sourcePath: string;
  readonly surfaceId: string;
}

/** Canonical route mount identity retained without source text or executable configuration. */
export interface PreviewRouteExecutionPlanMountIdentity {
  readonly basePath: string;
  readonly childSurfaceId: string;
  readonly contextPattern?: string;
  readonly hasWildcardFallback: boolean;
  readonly parentSurfaceId?: string;
  readonly pattern: string;
}

/** Canonical selected-route recipe used by the compiler-owned Page Execution candidate. */
export interface PreviewRouteExecutionPlanRecipeIdentity {
  readonly kind: string;
  readonly mounts: readonly PreviewRouteExecutionPlanMountIdentity[];
  readonly params: Readonly<Record<string, string | readonly string[]>>;
  readonly pathname: string;
  readonly pattern: string;
  readonly rootOwnsRouter: boolean;
  readonly routerModuleSpecifier?: string;
  readonly searchParams: Readonly<Record<string, string | readonly string[]>>;
}

/** Compact compiler context whose canonical digest prevents cross-snapshot plan reuse. */
export interface PreviewRouteExecutionPlanningContextIdentity {
  readonly compilerPolicyDigest: string;
  readonly preparationPolicyDigest: string;
  readonly requestDigest: string;
  readonly resolutionConfinementDigest: string;
  readonly resolverDigest: string;
  readonly sourceSnapshotDigest: string;
}

/**
 * Immutable campaign-only proof produced by the real fast compiler planning path.
 *
 * Ordinary editor requests omit this artifact and retain their existing automatic selection
 * behavior. Campaign compilation accepts it only after recreating and comparing every field.
 */
export interface PreviewRouteExecutionPlanArtifact {
  readonly browserCandidateId: string;
  readonly digest: string;
  readonly executionCandidateId: string;
  readonly executionIdentity: string;
  readonly executionRoot: PreviewRouteExecutionPlanRoleIdentity;
  readonly frontierIdentity: string;
  readonly ownerChain: readonly {
    readonly basePattern: string;
    readonly exportName: string;
    readonly sourcePath: string;
  }[];
  readonly pageCandidateId: string;
  readonly planningContext: PreviewRouteExecutionPlanningContextIdentity;
  readonly planningContextDigest: string;
  readonly policyDigest: string;
  readonly recipe?: PreviewRouteExecutionPlanRecipeIdentity;
  readonly rootRoleContract: PreviewRouteExecutionPlanRoleIdentity & {
    readonly preparedSourceDigest: string;
  };
  readonly routeId: string;
  readonly runtimeTarget: PreviewRouteExecutionPlanRoleIdentity;
  readonly selectedBranch: {
    readonly componentName: string;
    readonly exportName: string;
    readonly id: string;
    readonly pathname: string;
    readonly pattern: string;
    readonly sourcePath: string;
  };
  readonly selection: readonly PreviewInspectorRouteSelectionStep[];
  readonly targetRoleContract: PreviewRouteExecutionPlanRoleIdentity & {
    readonly preparedSourceDigest: string;
  };
  readonly version: number;
}

/** Bounded, structured evidence for one fail-closed campaign plan mismatch. */
export interface PreviewRouteExecutionPlanInvariantEvidence {
  readonly expectedContextDigest?: string;
  readonly expectedPlanDigest?: string;
  readonly expectedPolicyDigest?: string;
  readonly mismatchField: string;
  readonly observedCandidateId?: string;
  readonly observedContextDigest?: string;
  readonly observedPlanDigest?: string;
  readonly observedPolicyDigest?: string;
  readonly observedResolution?: 'automatic' | 'exact' | 'fallback' | 'missing';
  readonly observedRootIdentity?: string;
  readonly observedTargetIdentity?: string;
  readonly reason: string;
  readonly requestedResolution: 'exact';
  readonly routeId: string;
}

/**
 * Opt-in immutable-source boundary for non-editor compiler integrations.
 *
 * Digests are prepared by trusted Node tooling; the compiler still canonicalizes every path and
 * validates every resolved input. Ordinary editor requests omit this contract.
 */
export interface PreviewResolutionConfinement {
  readonly approvedDependencyRoots: readonly string[];
  readonly dependencyViewDigest: string;
  readonly policyDigest: string;
  readonly sourceManifestDigest: string;
  readonly sourceRoot: string;
}

/**
 * Immutable snapshot of the active editor at the moment a preview build starts.
 * `sourceText` deliberately comes from the editor rather than disk so unsaved changes are visible.
 */
export interface PreviewBuildRequest {
  /** Foreground work by default, or optional page-context enrichment that may be preempted. */
  readonly buildIntent?: PreviewBuildIntent;
  /** Dirty file-backed editor snapshots that should override saved dependency modules when reached. */
  readonly dependencySnapshots: readonly PreviewSourceSnapshot[];
  /** Absolute filesystem path used as the module identity and import resolution base. */
  readonly documentPath: string;
  /**
   * Monotonic active-editor revision paired with `sourceText` when VS Code supplied the request.
   * Keeping this optional preserves exact text-based invalidation for non-editor integrations.
   */
  readonly documentVersion?: number;
  /** esbuild loader selected from the document filename. */
  readonly language: PreviewSourceLanguage;
  /** Resource-scoped maximum combined generated output, expressed in whole mebibytes. */
  readonly maxOutputMebibytes?: number;
  /** Direct reachable graph for first paint, or complete application-context discovery. */
  readonly preparationMode?: PreviewPreparationMode;
  /**
   * Ordered router branches selected in Page Inspector.
   *
   * The extension host accepts this only from its bounded route-selection protocol. Compiler-side
   * analysis must still match every step to static source evidence before importing a module.
   */
  readonly inspectorRouteSelection?: readonly PreviewInspectorRouteSelectionStep[];
  /**
   * Attributes current-file runtime evidence to the exact compiler-recreated selected route leaf.
   *
   * The request intentionally carries no source path or export identity. The compiler derives both
   * from its validated Page Execution candidate and fails when that evidence is absent or conflicts.
   */
  readonly inspectorTargetMode?: PreviewInspectorTargetMode;
  /**
   * Stable Page Inspector candidate identity selected by the user.
   *
   * Candidate metadata is intentionally collected for every proven caller path, but the compiler
   * executes and bundles only this one page root. Omitting the value selects the highest-ranked
   * current candidate without making every alternative `import()` part of the esbuild graph.
   */
  readonly inspectorPageCandidateId?: string;
  /**
   * Compiler-owned Page Execution Slice identity selected for one bounded retry.
   *
   * This is never a browser-provided path: the compiler resolves it only against candidates it
   * recreated from current static evidence for the already-selected page candidate.
   */
  readonly inspectorPageExecutionCandidateId?: string;
  /**
   * Trusted campaign-only execution proof. The compiler always recreates this artifact before use;
   * callers cannot select filesystem modules or candidates merely by serializing their identities.
   */
  readonly routeExecutionPlan?: PreviewRouteExecutionPlanArtifact;
  /** Component gallery by default, or an opt-in actual-parent page inspector. */
  readonly renderMode?: PreviewRenderMode;
  /** Optional immutable-source and installed-dependency resolution boundary. */
  readonly resolutionConfinement?: PreviewResolutionConfinement;
  /** Complete current editor contents, including unsaved changes. */
  readonly sourceText: string;
  /** Optional project module that initializes globals and supplies preview providers or props. */
  readonly setupModulePath?: string;
  /** Optional explicit tsconfig/jsconfig path for non-standard project layouts and aliases. */
  readonly tsconfigPath?: string;
  /** Whether the compiler may reuse the nearest Storybook preview configuration when no setup exists. */
  readonly useStorybookPreview?: boolean;
  /** Absolute project directory from which package and tsconfig resolution begins. */
  readonly workspaceRoot: string;
}

/** Optional source location attached to a compiler diagnostic. */
export interface PreviewDiagnosticLocation {
  /** Zero-based source column when supplied by the compiler. */
  readonly column?: number;
  /** Source path associated with the diagnostic. */
  readonly file?: string;
  /** One-based source line when supplied by the compiler. */
  readonly line?: number;
}

/** Warning or error that can be logged or rendered without exposing compiler-specific types. */
export interface PreviewDiagnostic {
  /** Human-readable compiler message. */
  readonly message: string;
  /** Optional file, line, and column associated with the message. */
  readonly location?: PreviewDiagnosticLocation;
  /** Resolver hints and import context supplied by the compiler. */
  readonly notes?: readonly string[];
  /** Severity used by the output channel and error view. */
  readonly severity: 'error' | 'warning';
}

/** One auxiliary browser artifact emitted for a preserved JavaScript or stylesheet boundary. */
export interface PreviewBundleChunk {
  /** Complete JavaScript or CSS bytes referenced by another generated browser artifact. */
  readonly contents: Uint8Array;
  /** Stable content-hash POSIX path below the artifact session's shared `chunks/` directory. */
  readonly relativePath: string;
}

/** One browser import-map binding backed by a generated shared module artifact. */
export interface PreviewBundleModuleImport {
  /** Bare package specifier retained in the externalized preview entry. */
  readonly specifier: string;
  /** Stable POSIX path of the browser-loadable vendor entry below the artifact root. */
  readonly relativePath: string;
}

/** Worker-computed byte identities that let publication avoid hashing large output on the host. */
export interface PreviewBundleArtifactMetadata {
  /** Stable digest over entry, stylesheet presence/bytes, and ordered chunk paths/bytes. */
  readonly contentHash: string;
  /** Full entry JavaScript byte digest used in its content-addressed filename. */
  readonly entryDigest: string;
  /** Full byte digest paired with each exact auxiliary chunk path. */
  readonly chunkDigests: readonly {
    /** Full JavaScript or CSS byte digest. */
    readonly contentDigest: string;
    /** Exact safe relative chunk path emitted by the compiler. */
    readonly relativePath: string;
  }[];
  /** Full aggregate stylesheet byte digest when CSS output exists. */
  readonly stylesheetDigest?: string;
}

/** In-memory browser artifacts produced by a preview compiler. */
export interface PreviewBundle {
  /** Optional trusted worker-computed identities used to keep large hashing off the host thread. */
  readonly artifactMetadata?: PreviewBundleArtifactMetadata;
  /** Auxiliary ESM/CSS files retained separately so browser module and style loading stays lazy. */
  readonly chunks: readonly PreviewBundleChunk[];
  /**
   * Static page-context proof produced by the compiler. Older/custom adapters may omit the field;
   * application and presentation boundaries must then treat the result as `partial`.
   */
  readonly contextCoverage?: PreviewContextCoverage;
  /** Absolute graph inputs and bounded convention candidates used for future targeted rebuilds. */
  readonly dependencies: readonly string[];
  /** Non-fatal diagnostics returned by a successful build. */
  readonly diagnostics: readonly PreviewDiagnostic[];
  /** Optional private HMAC key embedded only in a Page Inspector entry and returned to its host. */
  readonly inspectorSourceGestureSecret?: string;
  /** Browser mappings for package imports intentionally shared outside the per-preview graph. */
  readonly moduleImports?: readonly PreviewBundleModuleImport[];
  /** Complete browser JavaScript entry bundle. */
  readonly javascript: Uint8Array;
  /** Optional stylesheet emitted when the component imports CSS. */
  readonly stylesheet?: Uint8Array;
  /** Glob roots whose future file additions can change the statically discovered graph. */
  readonly watchDirectories: readonly string[];
}

/** Stable opaque locations returned after an artifact store publishes a preview bundle. */
export interface StoredPreviewArtifact {
  /** Content digest used for cache busting and artifact identity. */
  readonly contentHash: string;
  /** Published browser locations paired with the externalized bare package specifiers. */
  readonly moduleImports?: readonly {
    readonly scriptLocation: string;
    readonly specifier: string;
  }[];
  /** Serialized location of the browser JavaScript bundle. */
  readonly scriptLocation: string;
  /** Serialized location of the optional generated stylesheet. */
  readonly stylesheetLocation?: string;
}

/** Result exposed by the build use case after compilation and publication both succeed. */
export interface PreparedPreview {
  /** Published locations that the presentation layer can convert to webview URIs. */
  readonly artifact: StoredPreviewArtifact;
  /**
   * Compiler-owned page-context proof forwarded without presentation-layer reinterpretation.
   * Absence remains equivalent to `partial` for compatibility with older compiler adapters.
   */
  readonly contextCoverage?: PreviewContextCoverage;
  /** Input module paths involved in the successful build. */
  readonly dependencies: readonly string[];
  /** Non-fatal diagnostics produced by the compiler. */
  readonly diagnostics: readonly PreviewDiagnostic[];
  /** Optional HMAC key used by the panel to authenticate Inspector source-button gestures. */
  readonly inspectorSourceGestureSecret?: string;
  /** Glob roots used to route newly created matching files to the owning panel. */
  readonly watchDirectories: readonly string[];
}

/**
 * Error raised when workspace source cannot be converted into a browser preview.
 * It retains structured diagnostics so the controller can show a concise message while logging
 * precise file locations for developers.
 */
export class PreviewCompilationError extends Error {
  /** Structured compiler errors associated with this failure. */
  public readonly diagnostics: readonly PreviewDiagnostic[];

  /**
   * Creates a domain-level compilation failure without exposing esbuild implementation types.
   *
   * @param message Concise, user-facing failure summary.
   * @param diagnostics Structured errors reported by the compiler.
   * @param cause Original unknown error retained for diagnostic logging.
   */
  public constructor(message: string, diagnostics: readonly PreviewDiagnostic[], cause?: unknown) {
    super(message, { cause });
    this.name = 'PreviewCompilationError';
    this.diagnostics = diagnostics;
  }
}

/** Campaign-only invariant failure carrying bounded evidence through worker serialization. */
export class PreviewRouteExecutionPlanInvariantError extends PreviewCompilationError {
  public readonly evidence: PreviewRouteExecutionPlanInvariantEvidence;

  /** Creates one fail-closed campaign invariant with structured diagnostics. */
  public constructor(evidence: PreviewRouteExecutionPlanInvariantEvidence) {
    super(
      `React Preview rejected the frozen route execution plan at "${evidence.mismatchField}": ${evidence.reason}.`,
      [
        {
          message: `Route execution-plan invariant failed at "${evidence.mismatchField}".`,
          notes: [
            `route=${evidence.routeId}`,
            `reason=${evidence.reason}`,
            `requested-resolution=${evidence.requestedResolution}`,
            `observed-resolution=${evidence.observedResolution ?? 'missing'}`,
          ],
          severity: 'error',
        },
      ],
    );
    this.name = 'PreviewRouteExecutionPlanInvariantError';
    this.evidence = Object.freeze({ ...evidence });
  }
}
