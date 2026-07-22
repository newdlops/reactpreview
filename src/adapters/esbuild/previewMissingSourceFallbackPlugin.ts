/**
 * Composes bounded dependency-graph optimization with evidence-backed recovery for absent source.
 * Keeping the adapters behind one compiler boundary preserves plugin ordering and leaves ordinary
 * unresolved imports as hard build errors instead of turning every missing module into a stub.
 */
import type { Plugin } from 'esbuild';
import { createPreviewGeneratedModuleFallbackPlugin } from './previewGeneratedModuleFallback';
import { createPreviewGeneratedUiFallbackPlugin } from './previewGeneratedUiFallbackPlugin';
import { createPreviewLargePackageBarrelPlugin } from './previewLargePackageBarrelPlugin';
import { createPreviewNextFrameworkFallbackPlugin } from './previewNextFrameworkFallbackPlugin';
import type { PreviewStaticModuleResolver } from './previewStaticModuleResolver';
import { createPreviewWorkspacePackageSourceFallbackPlugin } from './previewWorkspacePackageSourceFallback';

/** Trusted services shared by the narrowly scoped missing-source adapters. */
export interface PreviewMissingSourceFallbackOptions {
  /** Reads unsaved editor snapshots before falling back to the importing file on disk. */
  readonly readSource?: (sourcePath: string) => string | undefined;
  /** Registers existing parents so generated output appearing later triggers hot reload. */
  readonly registerWatchDirectory?: (directoryPath: string) => void;
  /** Provides inert tsconfig path evidence without evaluating project configuration code. */
  readonly staticModuleResolver: Pick<
    PreviewStaticModuleResolver,
    'resolve' | 'resolveMissingPathAliasCandidate'
  >;
  /** Canonical workspace boundary containing every accepted replacement source. */
  readonly workspaceRoot: string;
}

/**
 * Creates one ordered esbuild plugin for safe package-barrel projection, framework facades,
 * unbuilt packages, generated contracts, and generated UI. Each child adapter independently
 * requires bounded evidence and fails closed when proof is missing.
 */
export function createPreviewMissingSourceFallbackPlugin(
  options: PreviewMissingSourceFallbackOptions,
): Plugin {
  return {
    name: 'react-preview-missing-source-fallbacks',
    setup(build): void {
      const sharedOptions = {
        ...(options.registerWatchDirectory === undefined
          ? {}
          : { registerWatchDirectory: options.registerWatchDirectory }),
        workspaceRoot: options.workspaceRoot,
      };
      void createPreviewLargePackageBarrelPlugin({
        ...(options.readSource === undefined ? {} : { readSource: options.readSource }),
        workspaceRoot: options.workspaceRoot,
      }).setup(build);
      void createPreviewWorkspacePackageSourceFallbackPlugin(sharedOptions).setup(build);
      void createPreviewNextFrameworkFallbackPlugin({
        ...(options.readSource === undefined ? {} : { readSource: options.readSource }),
        workspaceRoot: options.workspaceRoot,
      }).setup(build);
      void createPreviewGeneratedModuleFallbackPlugin(sharedOptions).setup(build);
      void createPreviewGeneratedUiFallbackPlugin({
        ...sharedOptions,
        ...(options.readSource === undefined ? {} : { readSource: options.readSource }),
        staticModuleResolver: options.staticModuleResolver,
      }).setup(build);
    },
  };
}
