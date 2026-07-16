/**
 * Serves the small React-aware facade runtime used only by Page Inspector compilations.
 * The browser entry owns the persistent store and toolbar; this virtual module merely delegates
 * selected target exports to that already-installed global API.
 */
import type { OnLoadResult, OnResolveArgs, OnResolveResult, Plugin } from 'esbuild';
import { PREVIEW_INSPECTOR_RUNTIME_SPECIFIER } from '../inspector';
import { PREVIEW_INSPECTOR_RUNTIME_NAMESPACE } from '../previewPluginProtocol';
import { createPreviewInspectorFacadeRuntimeSource } from './previewInspectorFacadeRuntimeSource';

const PREVIEW_INSPECTOR_RUNTIME_PATH = 'facade-runtime';

/** Filesystem context required to resolve the inspected project's React package instance. */
export interface PreviewInspectorRuntimePluginOptions {
  /** Nearest package root selected by monorepo-aware compiler discovery. */
  readonly projectRoot: string;
}

/** Creates one stateless virtual runtime module for an opt-in Page Inspector build. */
export function createPreviewInspectorRuntimePlugin(
  options: PreviewInspectorRuntimePluginOptions,
): Plugin {
  /** Captures only the private specifier emitted by selected-target facades. */
  function resolveRuntime(arguments_: OnResolveArgs): OnResolveResult | undefined {
    return arguments_.path === PREVIEW_INSPECTOR_RUNTIME_SPECIFIER
      ? {
          namespace: PREVIEW_INSPECTOR_RUNTIME_NAMESPACE,
          path: PREVIEW_INSPECTOR_RUNTIME_PATH,
        }
      : undefined;
  }

  /** Loads fixed ESM source without resolving any application configuration or source file. */
  function loadRuntime(): OnLoadResult {
    return {
      contents: createPreviewInspectorFacadeRuntimeSource(),
      loader: 'js',
      resolveDir: options.projectRoot,
    };
  }

  return {
    name: 'react-preview-page-inspector-runtime',
    setup(build): void {
      build.onResolve({ filter: /^react-preview:inspector-runtime$/ }, resolveRuntime);
      build.onLoad(
        { filter: /^facade-runtime$/, namespace: PREVIEW_INSPECTOR_RUNTIME_NAMESPACE },
        loadRuntime,
      );
    },
  };
}
