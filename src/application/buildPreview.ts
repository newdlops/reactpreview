/**
 * Coordinates the two side effects required for a preview: compilation and artifact publication.
 * The use case depends only on ports, so orchestration remains testable without VS Code or disk IO.
 */
import type { PreparedPreview, PreviewBuildRequest, PreviewBundle } from '../domain/preview';
import {
  throwIfPreviewBuildCancelled,
  type PreviewBuildExecutionContext,
} from '../domain/previewBuildExecution';
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
   * @param context Optional lifecycle observer and cancellation signal owned by the session.
   * @returns Published locations plus compiler diagnostics and dependency paths.
   */
  public async execute(
    request: PreviewBuildRequest,
    context?: PreviewBuildExecutionContext,
  ): Promise<PreparedPreview> {
    throwIfPreviewBuildCancelled(context?.signal);
    context?.reportProgress?.('analyzing-project');
    const bundle: PreviewBundle = await this.compiler.compile(request, context);
    throwIfPreviewBuildCancelled(context?.signal);
    context?.reportProgress?.('publishing-artifacts');
    throwIfPreviewBuildCancelled(context?.signal);
    const artifact = await this.artifactStore.publish(bundle);

    try {
      throwIfPreviewBuildCancelled(context?.signal);
    } catch (error) {
      await this.artifactStore.release(artifact.contentHash);
      throw error;
    }

    const preparedPreview = {
      artifact,
      dependencies: bundle.dependencies,
      diagnostics: bundle.diagnostics,
      watchDirectories: bundle.watchDirectories,
    };
    return bundle.inspectorSourceGestureSecret === undefined
      ? preparedPreview
      : {
          ...preparedPreview,
          inspectorSourceGestureSecret: bundle.inspectorSourceGestureSecret,
        };
  }

  /**
   * Returns one artifact lease after a result becomes stale, is replaced, or its panel closes.
   *
   * @param contentHash Digest previously acquired through a successful `execute` call.
   */
  public async releaseArtifact(contentHash: string): Promise<void> {
    await this.artifactStore.release(contentHash);
  }
}
