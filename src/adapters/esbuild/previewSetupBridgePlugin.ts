/**
 * Creates a virtual boundary around an optional project-owned preview setup module.
 * The generated browser entry imports one stable private specifier, while this adapter keeps the
 * absolute workspace path out of generated orchestration source and preserves normal resolution.
 */
import path from 'node:path';
import type { OnLoadArgs, OnLoadResult, OnResolveArgs, OnResolveResult, Plugin } from 'esbuild';
import { PREVIEW_SETUP_BRIDGE_NAMESPACE, PREVIEW_SETUP_SPECIFIER } from './previewPluginProtocol';

/** Immutable setup path selected for one compilation request. */
export interface PreviewSetupBridgePluginOptions {
  /** Optional absolute custom-setup or Storybook-preview module path. */
  readonly setupModulePath?: string;
}

/**
 * Creates a virtual module whose default value is the complete setup module namespace.
 * Namespace preservation lets the runtime support optional hooks without requiring every project
 * to export the same symbols, while setup code remains an explicit and intentionally observable
 * extension boundary.
 *
 * @param options Optional project setup selected by bounded environment discovery.
 * @returns Stateless esbuild plugin scoped to one compilation request.
 */
export function createPreviewSetupBridgePlugin(options: PreviewSetupBridgePluginOptions): Plugin {
  /**
   * Captures only the private setup specifier emitted by the generated runtime entry.
   *
   * @param arguments_ Module-resolution request emitted by esbuild.
   * @returns Virtual setup identity, or `undefined` for ordinary project imports.
   */
  function resolveSetupBridge(arguments_: OnResolveArgs): OnResolveResult | undefined {
    if (arguments_.path !== PREVIEW_SETUP_SPECIFIER) {
      return undefined;
    }

    return {
      namespace: PREVIEW_SETUP_BRIDGE_NAMESPACE,
      path: options.setupModulePath ?? 'empty-preview-setup',
    };
  }

  /**
   * Generates either an empty setup namespace or a namespace import for the selected module.
   *
   * @param arguments_ Load request for the private bridge namespace.
   * @returns Browser JavaScript exposing a setup namespace through one stable default export.
   */
  function loadSetupBridge(arguments_: OnLoadArgs): OnLoadResult {
    if (options.setupModulePath === undefined) {
      return { contents: 'export default {};', loader: 'js' };
    }

    const encodedSetupPath = JSON.stringify(arguments_.path.replaceAll('\\', '/'));
    return {
      contents: [
        `import * as previewSetup from ${encodedSetupPath};`,
        'export default previewSetup;',
      ].join('\n'),
      loader: 'js',
      resolveDir: path.dirname(options.setupModulePath),
    };
  }

  return {
    name: 'react-preview-setup-bridge',
    setup(build): void {
      build.onResolve({ filter: /^react-preview:setup$/ }, resolveSetupBridge);
      build.onLoad({ filter: /.*/, namespace: PREVIEW_SETUP_BRIDGE_NAMESPACE }, loadSetupBridge);
    },
  };
}
