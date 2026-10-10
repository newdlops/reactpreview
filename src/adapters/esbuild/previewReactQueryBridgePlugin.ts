/**
 * Resolves the target project's TanStack/React Query package as an optional private esbuild bridge.
 * Projects without a Query package receive an identity wrapper, while installed projects use their
 * own package instance so `useQuery`, `useMutation`, and `useQueryClient` read the same Context
 * that the automatic Provider writes. Absence or resolution failure is a supported state, never a
 * build error, because ordinary React projects must not gain a Query dependency.
 */
import path from 'node:path';
import type { OnLoadArgs, OnLoadResult, OnResolveArgs, OnResolveResult, Plugin } from 'esbuild';
import {
  PREVIEW_REACT_QUERY_BRIDGE_NAMESPACE,
  PREVIEW_REACT_QUERY_SPECIFIER,
  PREVIEW_RESOLVE_GUARD,
} from './previewPluginProtocol';
import {
  createPreviewReactQueryRuntimeSource,
  type PreviewReactQueryPackageName,
  type PreviewReactQueryRuntimeModule,
} from './previewReactQueryRuntimeSource';

/** Candidate packages in wrapping order; TanStack v4/v5 first, then the legacy v3 name. */
const QUERY_PACKAGE_NAMES: readonly PreviewReactQueryPackageName[] = Object.freeze([
  '@tanstack/react-query',
  'react-query',
]);
const REACT_QUERY_BRIDGE_DATA_KIND = 'react-preview-react-query-bridge-data';

/** Immutable project boundary used for package resolution during one preview compilation. */
export interface PreviewReactQueryBridgePluginOptions {
  /** Nearest package root from which the target itself resolves its Query package. */
  readonly projectRoot: string;
}

/** Serializable metadata carried from optional package resolution into virtual-module loading. */
interface ReactQueryBridgePluginData {
  /** Discriminant preventing unrelated plugin metadata from being interpreted as bridge state. */
  readonly kind: typeof REACT_QUERY_BRIDGE_DATA_KIND;
  /** Resolved project packages; empty when the project installs no Query package. */
  readonly modules: readonly PreviewReactQueryRuntimeModule[];
}

/**
 * Creates the optional Query bridge consumed by the generated preview entry.
 *
 * @param options Nearest target package root used for browser-aware module resolution.
 * @returns Esbuild plugin scoped to one compilation request.
 */
export function createPreviewReactQueryBridgePlugin(
  options: PreviewReactQueryBridgePluginOptions,
): Plugin {
  return {
    name: 'react-preview-react-query-bridge',
    setup(build): void {
      let resolutionPromise: Promise<readonly PreviewReactQueryRuntimeModule[]> | undefined;

      /** Re-probes restored or newly installed project packages on every persistent rebuild. */
      build.onStart(() => {
        resolutionPromise = undefined;
      });

      /** Resolves the private bridge and memoizes optional Query package discovery. */
      async function resolveReactQueryBridge(
        arguments_: OnResolveArgs,
      ): Promise<OnResolveResult | undefined> {
        if (arguments_.path !== PREVIEW_REACT_QUERY_SPECIFIER) {
          return undefined;
        }
        resolutionPromise ??= resolveOptionalQueryModules(build, options.projectRoot);
        const modules = await resolutionPromise;
        return {
          namespace: PREVIEW_REACT_QUERY_BRIDGE_NAMESPACE,
          path:
            modules[0]?.modulePath ??
            path.join(options.projectRoot, 'empty-react-query-preview.js'),
          pluginData: {
            kind: REACT_QUERY_BRIDGE_DATA_KIND,
            modules,
          } satisfies ReactQueryBridgePluginData,
        };
      }

      /** Loads the memory-only Query runtime or the capability's identity wrapper. */
      function loadReactQueryBridge(arguments_: OnLoadArgs): OnLoadResult {
        const pluginData = readReactQueryBridgePluginData(arguments_.pluginData);
        const firstModule = pluginData?.modules[0];
        if (pluginData === undefined || firstModule === undefined) {
          return {
            contents: [
              '/** Leaves projects without a Query package unchanged. */',
              'export function createReactQueryPreviewElement(children) { return children; }',
              '/** Describes why the automatic Query boundary is unavailable. */',
              "export function readPreviewRuntimeStatus() { return 'unavailable: neither @tanstack/react-query nor react-query was resolved from the target project'; }",
            ].join('\n'),
            loader: 'js',
          };
        }
        return {
          contents: createPreviewReactQueryRuntimeSource({ modules: pluginData.modules }),
          loader: 'js',
          resolveDir: path.dirname(firstModule.modulePath),
          watchFiles: pluginData.modules.map(({ modulePath }) => modulePath),
        };
      }

      build.onResolve({ filter: /^react-preview:react-query$/ }, resolveReactQueryBridge);
      build.onLoad(
        { filter: /.*/, namespace: PREVIEW_REACT_QUERY_BRIDGE_NAMESPACE },
        loadReactQueryBridge,
      );
    },
  };
}

/**
 * Resolves every supported Query package with the same esbuild conditions as the target graph.
 * Resolution errors are deliberately swallowed because absence is a supported capability state.
 *
 * @param build Active esbuild plugin build interface.
 * @param projectRoot Nearest package root used as a bare-import resolution directory.
 * @returns Distinct local module entries in wrapping order.
 */
async function resolveOptionalQueryModules(
  build: Parameters<Plugin['setup']>[0],
  projectRoot: string,
): Promise<readonly PreviewReactQueryRuntimeModule[]> {
  const resolutions = await Promise.all(
    QUERY_PACKAGE_NAMES.map(async (packageName) => {
      const resolution = await build.resolve(packageName, {
        kind: 'import-statement',
        pluginData: PREVIEW_RESOLVE_GUARD,
        resolveDir: projectRoot,
      });
      return resolution.errors.length === 0 &&
        !resolution.external &&
        resolution.namespace === 'file'
        ? { modulePath: resolution.path, packageName }
        : undefined;
    }),
  );
  const seenPaths = new Set<string>();
  return Object.freeze(
    resolutions.filter((module): module is PreviewReactQueryRuntimeModule => {
      if (module === undefined || seenPaths.has(module.modulePath)) return false;
      seenPaths.add(module.modulePath);
      return true;
    }),
  );
}

/** Narrows untrusted esbuild plugin metadata to this bridge's serializable contract. */
function readReactQueryBridgePluginData(
  pluginData: unknown,
): ReactQueryBridgePluginData | undefined {
  if (typeof pluginData !== 'object' || pluginData === null || !('kind' in pluginData)) {
    return undefined;
  }
  return pluginData.kind === REACT_QUERY_BRIDGE_DATA_KIND
    ? (pluginData as ReactQueryBridgePluginData)
    : undefined;
}
