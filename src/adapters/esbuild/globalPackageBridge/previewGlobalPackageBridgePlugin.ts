/**
 * Exposes package-backed implicit globals through esbuild's lexical `inject` facility.
 * Unlike a browser prelude, injected imports are guaranteed to evaluate before a target module and
 * are understood by esbuild's scope analysis, so local declarations are never overwritten.
 */
import type { OnLoadArgs, OnLoadResult, OnResolveArgs, OnResolveResult, Plugin } from 'esbuild';
import type {
  PreviewGlobalPackageBridge,
  PreviewGlobalPackageBridgePlan,
} from './previewGlobalPackageBridge';
import { createPreviewGlobalPackageBridgeSource } from './previewGlobalPackageBridgeSource';
import { PREVIEW_GLOBAL_PACKAGE_BRIDGE_NAMESPACE } from '../previewPluginProtocol';

const BRIDGE_SPECIFIER_PREFIX = 'react-preview:global-package-bridge/';
const BRIDGE_PATH_PREFIX = 'candidate-';

/** Immutable package resolution context and discovered compatibility plan. */
export interface PreviewGlobalPackageBridgePluginOptions {
  /** Discovery plan whose manifests should also remain visible to HMR clients. */
  readonly plan: PreviewGlobalPackageBridgePlan;
  /** Fallback resolver root retained for empty plans and older discovery callers. */
  readonly projectRoot?: string;
}

/**
 * Creates independently tree-shakable inject modules for discovered package globals.
 *
 * The plugin appends to any existing esbuild `inject` configuration. Each virtual module has one
 * export, letting esbuild's parser decide whether a source identifier is truly free. `sideEffects:
 * false` means candidates that are not referenced do not load or bundle their package at all.
 *
 * @param options Frozen discovery plan and project package root.
 * @returns Stateless esbuild plugin safe to recreate for every hot rebuild.
 */
export function createPreviewGlobalPackageBridgePlugin(
  options: PreviewGlobalPackageBridgePluginOptions,
): Plugin {
  const bridges = Object.freeze([...options.plan.bridges]);
  const bridgeByPath = new Map<string, PreviewGlobalPackageBridge>(
    bridges.map((bridge, index) => [`${BRIDGE_PATH_PREFIX}${String(index)}`, bridge] as const),
  );
  const injectSpecifiers = bridges.map((_, index) => `${BRIDGE_SPECIFIER_PREFIX}${String(index)}`);

  /** Resolves only private inject specifiers emitted by this plugin instance. */
  function resolveBridge(arguments_: OnResolveArgs): OnResolveResult | undefined {
    if (!arguments_.path.startsWith(BRIDGE_SPECIFIER_PREFIX)) {
      return undefined;
    }
    const index = arguments_.path.slice(BRIDGE_SPECIFIER_PREFIX.length);
    const virtualPath = `${BRIDGE_PATH_PREFIX}${index}`;
    return bridgeByPath.has(virtualPath)
      ? {
          namespace: PREVIEW_GLOBAL_PACKAGE_BRIDGE_NAMESPACE,
          path: virtualPath,
          sideEffects: false,
        }
      : undefined;
  }

  /** Loads one candidate and gives its package imports the inspected project's resolution root. */
  function loadBridge(arguments_: OnLoadArgs): OnLoadResult | undefined {
    const bridge = bridgeByPath.get(arguments_.path);
    if (bridge === undefined) {
      return undefined;
    }
    return {
      contents: createPreviewGlobalPackageBridgeSource(bridge),
      loader: 'js',
      resolveDir: bridge.resolveDir,
      watchFiles: [bridge.watchPath],
    };
  }

  return {
    name: 'react-preview-global-package-bridge',
    setup(build): void {
      if (injectSpecifiers.length === 0) {
        return;
      }
      build.initialOptions.inject = [...(build.initialOptions.inject ?? []), ...injectSpecifiers];
      build.onResolve({ filter: /^react-preview:global-package-bridge\// }, resolveBridge);
      build.onLoad(
        { filter: /^candidate-\d+$/, namespace: PREVIEW_GLOBAL_PACKAGE_BRIDGE_NAMESPACE },
        loadBridge,
      );
    },
  };
}

/** Narrows map values for readers and generated-source helpers. */
export type { PreviewGlobalPackageBridge };
