/**
 * Resolves the target project's react-router-dom package as an optional private esbuild bridge.
 * Disabled and non-router previews receive a no-op wrapper, while enabled projects use their own
 * package instance so route hooks and the generated MemoryRouter share one context identity.
 */
import path from 'node:path';
import type { OnLoadArgs, OnLoadResult, OnResolveArgs, OnResolveResult, Plugin } from 'esbuild';
import {
  PREVIEW_RESOLVE_GUARD,
  PREVIEW_ROUTER_BRIDGE_NAMESPACE,
  PREVIEW_ROUTER_SPECIFIER,
} from './previewPluginProtocol';
import { createPreviewRouterRuntimeSource } from './previewRouterRuntimeSource';

const REACT_ROUTER_DOM_SPECIFIER = 'react-router-dom';
const ROUTER_BRIDGE_DATA_KIND = 'react-preview-router-bridge-data';

/** Immutable project and capability boundary used for one preview compilation. */
export interface PreviewRouterBridgePluginOptions {
  /** Whether graph evidence permits an automatic outer router when setup is silent. */
  readonly automaticallyWrap?: boolean;
  /** Whether static analysis found a reason to provide a router context for this preview. */
  readonly enabled: boolean;
  /** Nearest package root from which the target itself resolves react-router-dom. */
  readonly projectRoot: string;
}

/** Serializable metadata carried from optional package resolution into virtual-module loading. */
interface RouterBridgePluginData {
  /** Discriminant preventing unrelated plugin metadata from being interpreted as bridge state. */
  readonly kind: typeof ROUTER_BRIDGE_DATA_KIND;
  /** Resolved package entry, omitted when the capability is disabled or unavailable. */
  readonly reactRouterDomModulePath?: string;
}

/**
 * Creates the optional static router bridge consumed before the target is rendered.
 * Package discovery runs only when enabled. Absence is a supported no-op state, ensuring the
 * extension neither injects its own router version nor requires every React project to install one.
 *
 * @param options Target package boundary and statically selected capability state.
 * @returns Esbuild plugin scoped to one compilation request.
 */
export function createPreviewRouterBridgePlugin(options: PreviewRouterBridgePluginOptions): Plugin {
  return {
    name: 'react-preview-router-bridge',
    setup(build): void {
      let resolutionPromise: Promise<string | undefined> | undefined;

      /** Resolves the private bridge and memoizes optional project package discovery. */
      async function resolveRouterBridge(
        arguments_: OnResolveArgs,
      ): Promise<OnResolveResult | undefined> {
        if (arguments_.path !== PREVIEW_ROUTER_SPECIFIER) {
          return undefined;
        }

        if (options.enabled) {
          resolutionPromise ??= resolveOptionalReactRouterDom(build, options.projectRoot);
        }
        const reactRouterDomModulePath = await resolutionPromise;
        return {
          namespace: PREVIEW_ROUTER_BRIDGE_NAMESPACE,
          path:
            reactRouterDomModulePath ?? path.join(options.projectRoot, 'empty-router-preview.js'),
          pluginData: {
            kind: ROUTER_BRIDGE_DATA_KIND,
            ...(reactRouterDomModulePath === undefined ? {} : { reactRouterDomModulePath }),
          } satisfies RouterBridgePluginData,
        };
      }

      /** Loads the bounded MemoryRouter runtime or the capability's identity wrapper. */
      function loadRouterBridge(arguments_: OnLoadArgs): OnLoadResult {
        const pluginData = readRouterBridgePluginData(arguments_.pluginData);
        if (pluginData?.reactRouterDomModulePath === undefined) {
          const identityStatus = options.enabled
            ? 'requested by target graph, but react-router-dom was not resolved from the target project'
            : 'not requested: no unowned target-reachable React Router consumer was detected';
          return {
            contents: [
              '/** Leaves previews without an enabled project router unchanged. */',
              'export function createRouterPreviewElement(children) { return children; }',
              '/** Describes the graph-level automatic router decision. */',
              `export function readPreviewRuntimeStatus() { return ${JSON.stringify(identityStatus)}; }`,
            ].join('\n'),
            loader: 'js',
          };
        }

        return {
          contents: createPreviewRouterRuntimeSource({
            automaticallyWrap: options.automaticallyWrap ?? true,
            reactRouterDomModulePath: pluginData.reactRouterDomModulePath,
          }),
          loader: 'js',
          resolveDir: path.dirname(pluginData.reactRouterDomModulePath),
          watchFiles: [pluginData.reactRouterDomModulePath],
        };
      }

      build.onResolve({ filter: /^react-preview:router$/ }, resolveRouterBridge);
      build.onLoad({ filter: /.*/, namespace: PREVIEW_ROUTER_BRIDGE_NAMESPACE }, loadRouterBridge);
    },
  };
}

/** Resolves a local browser-aware react-router-dom entry without making absence an error. */
async function resolveOptionalReactRouterDom(
  build: Parameters<Plugin['setup']>[0],
  projectRoot: string,
): Promise<string | undefined> {
  const resolution = await build.resolve(REACT_ROUTER_DOM_SPECIFIER, {
    kind: 'import-statement',
    pluginData: PREVIEW_RESOLVE_GUARD,
    resolveDir: projectRoot,
  });
  return resolution.errors.length === 0 && !resolution.external && resolution.namespace === 'file'
    ? resolution.path
    : undefined;
}

/** Narrows untrusted esbuild plugin metadata to this bridge's serializable contract. */
function readRouterBridgePluginData(pluginData: unknown): RouterBridgePluginData | undefined {
  if (typeof pluginData !== 'object' || pluginData === null || !('kind' in pluginData)) {
    return undefined;
  }
  return pluginData.kind === ROUTER_BRIDGE_DATA_KIND
    ? (pluginData as RouterBridgePluginData)
    : undefined;
}
