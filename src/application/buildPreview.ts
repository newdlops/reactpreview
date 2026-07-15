/**
 * Coordinates the two side effects required for a preview: compilation and artifact publication.
 * The use case depends only on ports, so orchestration remains testable without VS Code or disk IO.
 */
import type { PreparedPreview, PreviewBuildRequest, PreviewBundle } from '../domain/preview';
import type { PreviewArtifactStore } from './previewArtifactStore';
import type { PreviewCompiler } from './previewCompiler';

/** Application service that prepares one immutable preview revision. */
export class BuildPreview {
  /**
   * Creates the use case with explicit infrastructure boundaries.
   *
   * @param compiler Adapter that bundles the active React document.
   * @param artifactStore Adapter that persists browser-loadable build artifacts.
   */
  public constructor(
    private readonly compiler: PreviewCompiler,
    private readonly artifactStore: PreviewArtifactStore,
  ) {}

  /**
   * Compiles and then publishes one request; failed compilation never changes published artifacts.
   *
   * @param request Immutable active-document snapshot.
   * @returns Published locations plus compiler diagnostics and dependency paths.
   */
  public async execute(request: PreviewBuildRequest): Promise<PreparedPreview> {
    const bundle: PreviewBundle = await this.compiler.compile(request);
    const artifact = await this.artifactStore.publish(bundle);

    return {
      artifact,
      dependencies: bundle.dependencies,
      diagnostics: bundle.diagnostics,
    };
  }

  /**
   * Removes superseded artifacts only after the presentation layer commits its latest revision.
   * Keeping cleanup separate from publication prevents an older, slower build from deleting files
   * referenced by a newer webview.
   *
   * @param contentHash Digest of the artifact that is currently visible.
   */
  public async pruneArtifactsExcept(contentHash: string): Promise<void> {
    await this.artifactStore.pruneExcept(contentHash);
  }
}
