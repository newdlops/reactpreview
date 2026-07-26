/** Registers the one build-scoped virtual module that loads a frozen Page Execution candidate. */
import path from 'node:path';
import type { PluginBuild } from 'esbuild';
import { PREVIEW_INSPECTOR_PAGE_EXECUTION_NAMESPACE } from '../previewPluginProtocol';
import { createPreviewInspectorPageExecutionSource } from './previewInspectorPageExecutionSource';
import type { PreviewInspectorPageExecutionCandidate } from './previewInspectorPageExecutionTypes';

export const PREVIEW_INSPECTOR_PAGE_EXECUTION_SPECIFIER = 'react-preview:inspector-page-execution';

export interface PreviewInspectorPageExecutionEntryPluginOptions {
  readonly candidate?: PreviewInspectorPageExecutionCandidate;
  readonly target: { readonly exportName: string; readonly sourcePath: string };
}

/** Does nothing without a frozen candidate, preserving legacy Inspector root behavior. */
export function registerPreviewInspectorPageExecutionEntryPlugin(
  build: PluginBuild,
  options: PreviewInspectorPageExecutionEntryPluginOptions,
): void {
  const candidate = options.candidate;
  if (candidate === undefined) return;
  build.onResolve({ filter: /^react-preview:inspector-page-execution$/ }, (arguments_) =>
    arguments_.path === PREVIEW_INSPECTOR_PAGE_EXECUTION_SPECIFIER
      ? { namespace: PREVIEW_INSPECTOR_PAGE_EXECUTION_NAMESPACE, path: 'selected-page-execution' }
      : undefined,
  );
  build.onLoad(
    { filter: /^selected-page-execution$/, namespace: PREVIEW_INSPECTOR_PAGE_EXECUTION_NAMESPACE },
    () => ({
      contents: createPreviewInspectorPageExecutionSource({
        candidate,
        target: options.target,
      }),
      loader: 'js',
      resolveDir: path.dirname(options.target.sourcePath),
      watchFiles: [...candidate.watchSourcePaths],
    }),
  );
}
