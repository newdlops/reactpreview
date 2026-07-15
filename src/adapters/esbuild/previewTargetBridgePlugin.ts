/**
 * Creates the single-export virtual bridge between the runtime entry and the selected component.
 * Dynamic-importing the target directly preserves its complete observable namespace; this bridge
 * exposes only `default`, allowing esbuild to remove unused named exports and their private graph.
 */
import path from 'node:path';
import type { OnLoadArgs, OnLoadResult, OnResolveArgs, OnResolveResult, Plugin } from 'esbuild';
import { PREVIEW_TARGET_BRIDGE_NAMESPACE, PREVIEW_TARGET_SPECIFIER } from './previewPluginProtocol';

/** Immutable path required to create a target bridge for one compilation request. */
export interface PreviewTargetBridgePluginOptions {
  /** Absolute active-document path whose selected runtime export is rendered. */
  readonly documentPath: string;
  /** Runtime target export exposed as the bridge default; omitted values retain legacy behavior. */
  readonly exportName?: string;
}

/**
 * Creates a virtual module that exposes one selected active-document export as its default.
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
   * @returns JavaScript that exposes only the selected target-module export.
   */
  function loadTargetBridge(arguments_: OnLoadArgs): OnLoadResult {
    const encodedDocumentPath = JSON.stringify(arguments_.path.replaceAll('\\', '/'));
    const exportName = options.exportName ?? 'default';
    assertValidExportName(exportName);
    return {
      contents:
        exportName === 'default'
          ? `export { default } from ${encodedDocumentPath};`
          : `export { ${exportName} as default } from ${encodedDocumentPath};`,
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

/**
 * Rejects bridge options that did not originate from the parser's identifier-only selection.
 * This validation also prevents malformed generated JavaScript if another compiler calls the plugin.
 *
 * @param exportName Default or named runtime export requested by the compiler.
 * @throws TypeError when the name cannot appear in an ECMAScript export specifier.
 */
function assertValidExportName(exportName: string): void {
  if (
    exportName !== 'default' &&
    !/^[$_\p{ID_Start}][$\u200C\u200D\p{ID_Continue}]*$/u.test(exportName)
  ) {
    throw new TypeError(`Invalid React preview target export name: ${exportName}`);
  }
}
