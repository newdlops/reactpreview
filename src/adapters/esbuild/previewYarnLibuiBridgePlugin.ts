/** Resolves the target project's exact @yarnpkg/libui Application provider. */
import path from 'node:path';
import type { OnLoadArgs, OnLoadResult, OnResolveArgs, OnResolveResult, Plugin } from 'esbuild';
import {
  PREVIEW_RESOLVE_GUARD,
  PREVIEW_YARN_LIBUI_BRIDGE_NAMESPACE,
  PREVIEW_YARN_LIBUI_SPECIFIER,
} from './previewPluginProtocol';
import { createPreviewYarnLibuiRuntimeSource } from './previewYarnLibuiRuntimeSource';

const APPLICATION_SPECIFIER = '@yarnpkg/libui/sources/components/Application';
const DATA_KIND = 'react-preview-yarn-libui-bridge-data';

export interface PreviewYarnLibuiBridgePluginOptions {
  readonly projectRoot: string;
}

interface YarnLibuiBridgeData {
  readonly applicationModulePath?: string;
  readonly kind: typeof DATA_KIND;
}

/** Creates an optional bridge; projects without libui receive a side-effect-free identity module. */
export function createPreviewYarnLibuiBridgePlugin(
  options: PreviewYarnLibuiBridgePluginOptions,
): Plugin {
  return {
    name: 'react-preview-yarn-libui-bridge',
    setup(build): void {
      let resolutionPromise: Promise<string | undefined> | undefined;
      build.onStart(() => {
        resolutionPromise = undefined;
      });
      /** Resolves only the private bridge specifier and caches one optional package lookup. */
      async function resolveBridge(
        arguments_: OnResolveArgs,
      ): Promise<OnResolveResult | undefined> {
        if (arguments_.path !== PREVIEW_YARN_LIBUI_SPECIFIER) return undefined;
        resolutionPromise ??= resolveOptionalApplication(build, options.projectRoot);
        const applicationModulePath = await resolutionPromise;
        return {
          namespace: PREVIEW_YARN_LIBUI_BRIDGE_NAMESPACE,
          path:
            applicationModulePath ?? path.join(options.projectRoot, 'empty-yarn-libui-preview.js'),
          pluginData: {
            kind: DATA_KIND,
            ...(applicationModulePath === undefined ? {} : { applicationModulePath }),
          } satisfies YarnLibuiBridgeData,
        };
      }
      /** Emits either the exact provider runtime or the unavailable identity surface. */
      function loadBridge(arguments_: OnLoadArgs): OnLoadResult {
        const data = readBridgeData(arguments_.pluginData);
        if (data?.applicationModulePath === undefined) {
          return {
            contents: [
              'export function createYarnLibuiPreviewElement(children) { return children; }',
              'export function registerPreviewYarnLibuiRequirement(_requirement) {}',
              "export function readPreviewRuntimeStatus() { return 'unavailable: @yarnpkg/libui Application was not resolved from the target project'; }",
            ].join('\n'),
            loader: 'js',
          };
        }
        return {
          contents: createPreviewYarnLibuiRuntimeSource({
            applicationModulePath: data.applicationModulePath,
          }),
          loader: 'js',
          resolveDir: path.dirname(data.applicationModulePath),
        };
      }
      build.onResolve({ filter: /^react-preview:yarn-libui$/ }, resolveBridge);
      build.onLoad({ filter: /.*/, namespace: PREVIEW_YARN_LIBUI_BRIDGE_NAMESPACE }, loadBridge);
    },
  };
}

/** Resolves the provider from the same package root and PnP graph as the selected target. */
async function resolveOptionalApplication(
  build: Parameters<Plugin['setup']>[0],
  projectRoot: string,
): Promise<string | undefined> {
  const resolution = await build.resolve(APPLICATION_SPECIFIER, {
    kind: 'import-statement',
    pluginData: PREVIEW_RESOLVE_GUARD,
    resolveDir: projectRoot,
  });
  return resolution.errors.length === 0 && !resolution.external && resolution.namespace === 'file'
    ? resolution.path
    : undefined;
}

/** Narrows opaque esbuild metadata to this bridge's private record. */
function readBridgeData(value: unknown): YarnLibuiBridgeData | undefined {
  if (typeof value !== 'object' || value === null || !('kind' in value)) return undefined;
  return value.kind === DATA_KIND ? (value as YarnLibuiBridgeData) : undefined;
}
