/**
 * Resolves the target project's react-redux package as an optional private esbuild bridge.
 * Projects without React Redux receive a no-op wrapper, while installed projects use their own
 * package instance so selectors and the automatic Provider share the same context identity.
 */
import path from 'node:path';
import type { OnLoadArgs, OnLoadResult, OnResolveArgs, OnResolveResult, Plugin } from 'esbuild';
import {
  PREVIEW_REDUX_BRIDGE_NAMESPACE,
  PREVIEW_REDUX_SPECIFIER,
  PREVIEW_RESOLVE_GUARD,
} from './previewPluginProtocol';
import { createPreviewReduxRuntimeSource } from './previewReduxRuntimeSource';
import type { PreviewReduxStaticState } from './previewReduxRuntimeSource';

const REACT_REDUX_SPECIFIER = 'react-redux';
const REDUX_BRIDGE_DATA_KIND = 'react-preview-redux-bridge-data';

/** Immutable project boundary used for package resolution during one preview compilation. */
export interface PreviewReduxBridgePluginOptions {
  /** Lowest-priority neutral state inferred from reachable selector property paths. */
  readonly automaticState?: PreviewReduxStaticState;
  /** Nearest package root from which the target itself resolves React Redux. */
  readonly projectRoot: string;
}

/** Serializable metadata carried from optional package resolution into virtual-module loading. */
interface ReduxBridgePluginData {
  /** Discriminant preventing unrelated plugin metadata from being interpreted as bridge state. */
  readonly kind: typeof REDUX_BRIDGE_DATA_KIND;
  /** Resolved package entry, omitted when the target project does not install React Redux. */
  readonly reactReduxModulePath?: string;
}

/**
 * Creates the optional React Redux bridge consumed before the target is rendered.
 * Package lookup failure is converted to an identity wrapper so other React projects are unchanged.
 *
 * @param options Nearest target package root used for browser-aware module resolution.
 * @returns Esbuild plugin scoped to one compilation request.
 */
export function createPreviewReduxBridgePlugin(options: PreviewReduxBridgePluginOptions): Plugin {
  return {
    name: 'react-preview-redux-bridge',
    setup(build): void {
      let resolutionPromise: Promise<string | undefined> | undefined;

      /** Resolves the private bridge and memoizes optional React Redux discovery. */
      async function resolveReduxBridge(
        arguments_: OnResolveArgs,
      ): Promise<OnResolveResult | undefined> {
        if (arguments_.path !== PREVIEW_REDUX_SPECIFIER) {
          return undefined;
        }

        resolutionPromise ??= resolveOptionalReactRedux(build, options.projectRoot);
        const reactReduxModulePath = await resolutionPromise;
        return {
          namespace: PREVIEW_REDUX_BRIDGE_NAMESPACE,
          path: reactReduxModulePath ?? path.join(options.projectRoot, 'empty-redux-preview.js'),
          pluginData: {
            kind: REDUX_BRIDGE_DATA_KIND,
            ...(reactReduxModulePath === undefined ? {} : { reactReduxModulePath }),
          } satisfies ReduxBridgePluginData,
        };
      }

      /** Loads a memory-only Redux runtime or the capability's identity wrapper. */
      function loadReduxBridge(arguments_: OnLoadArgs): OnLoadResult {
        const pluginData = readReduxBridgePluginData(arguments_.pluginData);
        if (pluginData?.reactReduxModulePath === undefined) {
          return {
            contents: [
              '/** Leaves projects without React Redux unchanged. */',
              'export function createReduxPreviewElement(children) { return children; }',
              '/** Accepts generated selector evidence as a no-op when React Redux is absent. */',
              'export function registerPreviewReduxStateContainerPaths(_paths) {}',
              '/** Describes why the automatic Redux boundary is unavailable. */',
              "export function readPreviewRuntimeStatus() { return 'unavailable: react-redux was not resolved from the target project'; }",
            ].join('\n'),
            loader: 'js',
          };
        }

        return {
          contents: createPreviewReduxRuntimeSource({
            ...(options.automaticState === undefined
              ? {}
              : { automaticState: options.automaticState }),
            reactReduxModulePath: pluginData.reactReduxModulePath,
          }),
          loader: 'js',
          resolveDir: path.dirname(pluginData.reactReduxModulePath),
          watchFiles: [pluginData.reactReduxModulePath],
        };
      }

      build.onResolve({ filter: /^react-preview:redux$/ }, resolveReduxBridge);
      build.onLoad({ filter: /.*/, namespace: PREVIEW_REDUX_BRIDGE_NAMESPACE }, loadReduxBridge);
    },
  };
}

/** Resolves a local browser-aware React Redux entry without making absence an error. */
async function resolveOptionalReactRedux(
  build: Parameters<Plugin['setup']>[0],
  projectRoot: string,
): Promise<string | undefined> {
  const resolution = await build.resolve(REACT_REDUX_SPECIFIER, {
    kind: 'import-statement',
    pluginData: PREVIEW_RESOLVE_GUARD,
    resolveDir: projectRoot,
  });
  return resolution.errors.length === 0 && !resolution.external && resolution.namespace === 'file'
    ? resolution.path
    : undefined;
}

/** Narrows untrusted esbuild plugin metadata to this bridge's serializable contract. */
function readReduxBridgePluginData(pluginData: unknown): ReduxBridgePluginData | undefined {
  if (typeof pluginData !== 'object' || pluginData === null || !('kind' in pluginData)) {
    return undefined;
  }
  return pluginData.kind === REDUX_BRIDGE_DATA_KIND
    ? (pluginData as ReduxBridgePluginData)
    : undefined;
}
