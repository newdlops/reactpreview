/** Virtual entry modules used when a preview shares the project styled-components runtime chunk. */
import type { OnLoadArgs, OnResolveArgs, OnResolveResult, Plugin } from 'esbuild';

/** Namespace for the generated preview application's actual entry module. */
export const PREVIEW_MAIN_ENTRY_NAMESPACE = 'react-preview-main-entry';
/** Stable specifier for the generated preview application's actual entry module. */
export const PREVIEW_MAIN_ENTRY_SPECIFIER = 'react-preview:entry';
/** Namespace for the package-only entry which pins shared runtime dependencies. */
export const PREVIEW_RUNTIME_ANCHOR_NAMESPACE = 'react-preview-runtime-anchor';
/** Stable specifier for the package-only shared-runtime anchor. */
export const PREVIEW_RUNTIME_ANCHOR_SPECIFIER = 'react-preview:runtime-anchor';

/** Immutable virtual sources supplied by one build-entry strategy. */
export interface PreviewBuildEntryPluginOptions {
  readonly entrySource: string;
  readonly resolveDir: string;
  readonly runtimeAnchorSource: string;
}

/** Resolves and loads only the two generated entries; their child imports use normal plugins. */
export function createPreviewBuildEntryPlugin(options: PreviewBuildEntryPluginOptions): Plugin {
  return {
    name: 'react-preview-build-entry',
    setup(build): void {
      const resolve = (arguments_: OnResolveArgs): OnResolveResult | undefined => {
        if (arguments_.path === PREVIEW_MAIN_ENTRY_SPECIFIER) {
          return { namespace: PREVIEW_MAIN_ENTRY_NAMESPACE, path: PREVIEW_MAIN_ENTRY_SPECIFIER };
        }
        if (arguments_.path === PREVIEW_RUNTIME_ANCHOR_SPECIFIER) {
          return {
            namespace: PREVIEW_RUNTIME_ANCHOR_NAMESPACE,
            path: PREVIEW_RUNTIME_ANCHOR_SPECIFIER,
          };
        }
        return undefined;
      };
      build.onResolve({ filter: /^react-preview:(?:entry|runtime-anchor)$/ }, resolve);
      build.onLoad(
        { filter: /.*/, namespace: PREVIEW_MAIN_ENTRY_NAMESPACE },
        (arguments_: OnLoadArgs) =>
          arguments_.path === PREVIEW_MAIN_ENTRY_SPECIFIER
            ? { contents: options.entrySource, loader: 'tsx', resolveDir: options.resolveDir }
            : undefined,
      );
      build.onLoad(
        { filter: /.*/, namespace: PREVIEW_RUNTIME_ANCHOR_NAMESPACE },
        (arguments_: OnLoadArgs) =>
          arguments_.path === PREVIEW_RUNTIME_ANCHOR_SPECIFIER
            ? {
                contents: options.runtimeAnchorSource,
                loader: 'js',
                resolveDir: options.resolveDir,
              }
            : undefined,
      );
    },
  };
}
