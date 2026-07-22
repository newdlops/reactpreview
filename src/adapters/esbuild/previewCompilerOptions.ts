/**
 * Defines construction-time policies for the esbuild preview compiler.
 * Runtime callers normally use defaults; explicit boundaries keep deterministic tests independent
 * from network transport and let the extension place immutable artifacts in VS Code global storage.
 */
import type { PreviewManagedDependencyStoreOptions } from '../node/previewManagedDependencyStore';

/** Optional compiler policy overrides used by production bootstrap and deterministic tests. */
export interface EsbuildPreviewCompilerOptions {
  /** Extension-packaged node_modules containing the compatible baseline React runtime. */
  readonly bundledNodeModulesPath?: string;
  /** Persistent global-storage directory used for immutable cross-workspace package environments. */
  readonly managedDependencyStoreRoot?: string;
  /** Injectable lockfile acquisition boundary used only by deterministic compiler tests. */
  readonly lockedDependencyAcquirer?: PreviewManagedDependencyStoreOptions['lockedDependencyAcquirer'];
  /** Split-output threshold before retrying with lazy initializers in a coalesced local artifact. */
  readonly maximumSplitOutputFiles?: number;
}
