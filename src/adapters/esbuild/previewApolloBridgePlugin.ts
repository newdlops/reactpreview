/**
 * Resolves the target project's Apollo Client as an optional, private esbuild bridge.
 * Projects without Apollo receive a no-op wrapper, while installed projects use their own package
 * instance so hooks and Provider context identities remain aligned inside the browser bundle.
 */
import path from 'node:path';
import type { OnLoadArgs, OnLoadResult, OnResolveArgs, OnResolveResult, Plugin } from 'esbuild';
import { createPreviewApolloRuntimeSource } from './previewApolloRuntimeSource';
import {
  PREVIEW_APOLLO_BRIDGE_NAMESPACE,
  PREVIEW_APOLLO_SPECIFIER,
  PREVIEW_RESOLVE_GUARD,
} from './previewPluginProtocol';

const APOLLO_CORE_SPECIFIER = '@apollo/client';
const APOLLO_REACT_SPECIFIER = '@apollo/client/react';
const APOLLO_BRIDGE_DATA_KIND = 'react-preview-apollo-bridge-data';

/** Immutable project boundary used for package resolution during one preview compilation. */
export interface PreviewApolloBridgePluginOptions {
  /** Nearest package root from which the target itself resolves Apollo Client. */
  readonly projectRoot: string;
}

/** Serializable metadata carried from optional package resolution into virtual-module loading. */
interface ApolloBridgePluginData {
  /** Resolved Apollo core entry, omitted when the target project does not install Apollo Client. */
  readonly coreModulePath?: string;
  /** Discriminant preventing unrelated plugin metadata from being interpreted as bridge state. */
  readonly kind: typeof APOLLO_BRIDGE_DATA_KIND;
  /** Optional split React entry used by newer Apollo Client package layouts. */
  readonly reactModulePath?: string;
}

/** Result of one best-effort project package resolution. */
interface OptionalApolloResolution {
  /** Resolved Apollo core entry, omitted when unavailable or non-local. */
  readonly coreModulePath?: string;
  /** Resolved React integration entry when the package exposes one. */
  readonly reactModulePath?: string;
}

/**
 * Creates the optional Apollo bridge consumed after project preview initialization.
 * Package lookup failures are intentionally converted to a no-op module: ordinary React projects
 * must not gain an Apollo dependency merely because the generated entry supports the capability.
 *
 * @param options Nearest target package root used for browser-aware module resolution.
 * @returns Esbuild plugin scoped to one compilation request.
 */
export function createPreviewApolloBridgePlugin(options: PreviewApolloBridgePluginOptions): Plugin {
  return {
    name: 'react-preview-apollo-bridge',
    setup(build): void {
      let resolutionPromise: Promise<OptionalApolloResolution> | undefined;

      /** Resolves the private bridge and memoizes optional Apollo package discovery. */
      async function resolveApolloBridge(
        arguments_: OnResolveArgs,
      ): Promise<OnResolveResult | undefined> {
        if (arguments_.path !== PREVIEW_APOLLO_SPECIFIER) {
          return undefined;
        }

        resolutionPromise ??= resolveOptionalApolloModules(build, options.projectRoot);
        const resolution = await resolutionPromise;
        const bridgePath =
          resolution.coreModulePath ?? path.join(options.projectRoot, 'empty-apollo-preview.js');
        return {
          namespace: PREVIEW_APOLLO_BRIDGE_NAMESPACE,
          path: bridgePath,
          pluginData: {
            kind: APOLLO_BRIDGE_DATA_KIND,
            ...(resolution.coreModulePath === undefined
              ? {}
              : { coreModulePath: resolution.coreModulePath }),
            ...(resolution.reactModulePath === undefined
              ? {}
              : { reactModulePath: resolution.reactModulePath }),
          } satisfies ApolloBridgePluginData,
        };
      }

      /** Loads a memory-only Apollo runtime or the capability's identity wrapper. */
      function loadApolloBridge(arguments_: OnLoadArgs): OnLoadResult {
        const pluginData = readApolloBridgePluginData(arguments_.pluginData);
        if (pluginData?.coreModulePath === undefined) {
          return {
            contents: [
              '/** Leaves non-Apollo projects unchanged without importing React or a client. */',
              'export function createApolloPreviewElement(children) { return children; }',
              '/** Describes why the automatic Apollo boundary is unavailable. */',
              "export function readPreviewRuntimeStatus() { return 'unavailable: @apollo/client was not resolved from the target project'; }",
            ].join('\n'),
            loader: 'js',
          };
        }

        return {
          contents: createPreviewApolloRuntimeSource({
            coreModulePath: pluginData.coreModulePath,
            ...(pluginData.reactModulePath === undefined
              ? {}
              : { reactModulePath: pluginData.reactModulePath }),
          }),
          loader: 'js',
          resolveDir: path.dirname(pluginData.coreModulePath),
          watchFiles: [
            pluginData.coreModulePath,
            ...(pluginData.reactModulePath === undefined ? [] : [pluginData.reactModulePath]),
          ],
        };
      }

      build.onResolve({ filter: /^react-preview:apollo$/ }, resolveApolloBridge);
      build.onLoad({ filter: /.*/, namespace: PREVIEW_APOLLO_BRIDGE_NAMESPACE }, loadApolloBridge);
    },
  };
}

/**
 * Resolves Apollo core and React entries with the same esbuild conditions as the target graph.
 * Errors are deliberately not forwarded because absence is a supported capability state.
 *
 * @param build Active esbuild plugin build interface.
 * @param projectRoot Nearest package root used as a bare-import resolution directory.
 * @returns Local module paths available to the generated bridge.
 */
async function resolveOptionalApolloModules(
  build: Parameters<Plugin['setup']>[0],
  projectRoot: string,
): Promise<OptionalApolloResolution> {
  const [coreResolution, reactResolution] = await Promise.all([
    build.resolve(APOLLO_CORE_SPECIFIER, {
      kind: 'import-statement',
      pluginData: PREVIEW_RESOLVE_GUARD,
      resolveDir: projectRoot,
    }),
    build.resolve(APOLLO_REACT_SPECIFIER, {
      kind: 'import-statement',
      pluginData: PREVIEW_RESOLVE_GUARD,
      resolveDir: projectRoot,
    }),
  ]);
  const coreModulePath = readLocalResolutionPath(coreResolution);
  if (coreModulePath === undefined) {
    return {};
  }
  const reactModulePath = readLocalResolutionPath(reactResolution);
  return {
    coreModulePath,
    ...(reactModulePath === undefined ? {} : { reactModulePath }),
  };
}

/** Returns a resolved local file while rejecting errors, externals, and custom namespaces. */
function readLocalResolutionPath(
  resolution: Awaited<ReturnType<Parameters<Plugin['setup']>[0]['resolve']>>,
): string | undefined {
  return resolution.errors.length === 0 && !resolution.external && resolution.namespace === 'file'
    ? resolution.path
    : undefined;
}

/** Narrows untrusted esbuild plugin metadata to this bridge's serializable contract. */
function readApolloBridgePluginData(pluginData: unknown): ApolloBridgePluginData | undefined {
  if (typeof pluginData !== 'object' || pluginData === null || !('kind' in pluginData)) {
    return undefined;
  }
  return pluginData.kind === APOLLO_BRIDGE_DATA_KIND
    ? (pluginData as ApolloBridgePluginData)
    : undefined;
}
