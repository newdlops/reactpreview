/**
 * Declares the application port for converting an editor snapshot into browser-ready artifacts.
 * Infrastructure implementations may use esbuild or another compiler without changing callers.
 */
import type { PreviewBuildRequest, PreviewBundle } from '../domain/preview';
import type { PreviewBuildExecutionContext } from '../domain/previewBuildExecution';

/** Compiler boundary used by the build-preview use case. */
export interface PreviewCompiler {
  /**
   * Compiles exactly one immutable editor snapshot and its imported module graph.
   *
   * @param request Active React document snapshot and module-resolution context.
   * @param context Optional progress and cancellation controls owned by the requesting revision.
   * @returns Browser JavaScript, optional CSS, dependencies, and non-fatal diagnostics.
   * @throws PreviewCompilationError when parsing, resolution, or bundling fails.
   */
  compile(
    request: PreviewBuildRequest,
    context?: PreviewBuildExecutionContext,
  ): Promise<PreviewBundle>;
}
