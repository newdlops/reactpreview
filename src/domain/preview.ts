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
export type PreviewPreparationMode = 'fast' | 'full';

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
  /** Component gallery by default, or an opt-in actual-parent page inspector. */
  readonly renderMode?: PreviewRenderMode;
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
  /** Absolute graph inputs and bounded convention candidates used for future targeted rebuilds. */
  readonly dependencies: readonly string[];
  /** Non-fatal diagnostics returned by a successful build. */
  readonly diagnostics: readonly PreviewDiagnostic[];
  /** Optional private HMAC key embedded only in a Page Inspector entry and returned to its host. */
  readonly inspectorSourceGestureSecret?: string;
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
  /** Serialized location of the browser JavaScript bundle. */
  readonly scriptLocation: string;
  /** Serialized location of the optional generated stylesheet. */
  readonly stylesheetLocation?: string;
}

/** Result exposed by the build use case after compilation and publication both succeed. */
export interface PreparedPreview {
  /** Published locations that the presentation layer can convert to webview URIs. */
  readonly artifact: StoredPreviewArtifact;
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
