/** Clears compiler-owned caches before stopping esbuild's shared native service. */
import { stop } from 'esbuild';

interface ClearablePreviewCompilerCache {
  clear(): void;
}

interface PreviewIncrementalBuildShutdown {
  shutdown(): Promise<void>;
}

interface PreviewManagedDependencyShutdown {
  shutdown(): Promise<void>;
}

/** Performs idempotence-independent shutdown work after the compiler records its promise. */
export async function shutdownPreviewCompiler(options: {
  readonly activeBuildControllers: ReadonlySet<AbortController>;
  readonly caches: readonly ClearablePreviewCompilerCache[];
  readonly incrementalBuildCache: PreviewIncrementalBuildShutdown;
  readonly managedDependencyStore: PreviewManagedDependencyShutdown | undefined;
}): Promise<void> {
  for (const controller of options.activeBuildControllers) controller.abort();
  for (const cache of options.caches) cache.clear();
  await options.incrementalBuildCache.shutdown();
  await options.managedDependencyStore?.shutdown();
  await stop();
}
