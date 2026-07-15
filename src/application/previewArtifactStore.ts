/**
 * Declares the application port that publishes compiled bytes to opaque local locations.
 * Returning serialized locations avoids coupling core code to VS Code's URI implementation.
 */
import type { PreviewBundle, StoredPreviewArtifact } from '../domain/preview';

/** Artifact publication boundary used after a successful compilation. */
export interface PreviewArtifactStore {
  /**
   * Atomically publishes a bundle and returns cache-busted locations for the presentation layer.
   *
   * @param bundle In-memory JavaScript and optional stylesheet to persist.
   * @returns Opaque locations for the newly published artifact set.
   */
  publish(bundle: PreviewBundle): Promise<StoredPreviewArtifact>;

  /**
   * Releases one ownership reference acquired by `publish` and removes the files at zero owners.
   *
   * @param contentHash Content digest that a stale, replaced, or closed preview no longer needs.
   */
  release(contentHash: string): Promise<void>;
}
