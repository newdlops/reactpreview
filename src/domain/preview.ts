/**
 * Defines the framework-neutral data exchanged by preview use cases and adapters.
 * This module contains no VS Code or esbuild imports, which keeps the core model reusable and
 * prevents infrastructure details from leaking into application decisions.
 */

/** Source loaders supported by the first preview compiler implementation. */
export type PreviewSourceLanguage = 'js' | 'jsx' | 'ts' | 'tsx';

/** Immutable editor contents for a file-backed source module that may be imported by the target. */
export interface PreviewSourceSnapshot {
  /** Absolute filesystem path used to match esbuild's resolved module identity. */
  readonly documentPath: string;
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
  /** Dirty file-backed editor snapshots that should override saved dependency modules when reached. */
  readonly dependencySnapshots: readonly PreviewSourceSnapshot[];
  /** Absolute filesystem path used as the module identity and import resolution base. */
  readonly documentPath: string;
  /** esbuild loader selected from the document filename. */
  readonly language: PreviewSourceLanguage;
  /** Complete current editor contents, including unsaved changes. */
  readonly sourceText: string;
  /** Optional explicit tsconfig/jsconfig path for non-standard project layouts and aliases. */
  readonly tsconfigPath?: string;
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

/** In-memory browser artifacts produced by a preview compiler. */
export interface PreviewBundle {
  /** Absolute input paths from the module graph, used for future targeted rebuilds. */
  readonly dependencies: readonly string[];
  /** Non-fatal diagnostics returned by a successful build. */
  readonly diagnostics: readonly PreviewDiagnostic[];
  /** Complete browser JavaScript entry bundle. */
  readonly javascript: Uint8Array;
  /** Optional stylesheet emitted when the component imports CSS. */
  readonly stylesheet?: Uint8Array;
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
