/**
 * Declares the application port for converting an editor snapshot into browser-ready artifacts.
 * Infrastructure implementations may use esbuild or another compiler without changing callers.
 */
import type { PreviewBuildRequest, PreviewBundle } from '../domain/preview';

/** Compiler boundary used by the build-preview use case. */
export interface PreviewCompiler {
  /**
   * Compiles exactly one immutable editor snapshot and its imported module graph.
   *
   * @param request Active React document snapshot and module-resolution context.
   * @returns Browser JavaScript, optional CSS, dependencies, and non-fatal diagnostics.
   * @throws PreviewCompilationError when parsing, resolution, or bundling fails.
   */
  compile(request: PreviewBuildRequest): Promise<PreviewBundle>;
}
