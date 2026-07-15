/**
 * Creates the default-only virtual bridge between the runtime entry and the selected component.
 * Dynamic-importing the target directly preserves its complete observable namespace; this bridge
 * exposes only `default`, allowing esbuild to remove unused named exports and their private graph.
 */
import path from 'node:path';
import type { OnLoadArgs, OnLoadResult, OnResolveArgs, OnResolveResult, Plugin } from 'esbuild';
import { PREVIEW_TARGET_BRIDGE_NAMESPACE, PREVIEW_TARGET_SPECIFIER } from './previewPluginProtocol';

/** Immutable path required to create a target bridge for one compilation request. */
export interface PreviewTargetBridgePluginOptions {
  /** Absolute active-document path whose default export is rendered. */
  readonly documentPath: string;
}

/**
 * Creates a virtual module that re-exports only the active document's default export.
 *
 * @param options Active document represented by the bridge.
 * @returns Stateless esbuild plugin scoped to one compilation request.
 */
export function createPreviewTargetBridgePlugin(options: PreviewTargetBridgePluginOptions): Plugin {
  /**
   * Captures the one private specifier emitted by the generated runtime entry.
   *
   * @param arguments_ Module-resolution request emitted by esbuild.
   * @returns Virtual bridge identity, or `undefined` for every project import.
   */
  function resolveTargetBridge(arguments_: OnResolveArgs): OnResolveResult | undefined {
    if (arguments_.path !== PREVIEW_TARGET_SPECIFIER) {
      return undefined;
    }

    return {
      namespace: PREVIEW_TARGET_BRIDGE_NAMESPACE,
      path: options.documentPath,
    };
  }

  /**
   * Generates the minimal bridge while encoding the path as a JavaScript string literal.
   *
   * @param arguments_ Load request for the private bridge namespace.
   * @returns JavaScript that exposes only the target module's default export.
   */
  function loadTargetBridge(arguments_: OnLoadArgs): OnLoadResult {
    const encodedDocumentPath = JSON.stringify(arguments_.path.replaceAll('\\', '/'));
    return {
      contents: `export { default } from ${encodedDocumentPath};`,
      loader: 'js',
      resolveDir: path.dirname(options.documentPath),
    };
  }

  return {
    name: 'react-preview-target-bridge',
    setup(build): void {
      build.onResolve({ filter: /^react-preview:target$/ }, resolveTargetBridge);
      build.onLoad({ filter: /.*/, namespace: PREVIEW_TARGET_BRIDGE_NAMESPACE }, loadTargetBridge);
    },
  };
}
