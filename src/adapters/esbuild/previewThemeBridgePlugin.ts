/**
 * Resolves the target project's styled-components package as an optional private esbuild bridge.
 * Projects without the library receive a no-op wrapper, while installed projects use their own
 * package instance so styled components and the automatic ThemeProvider share context identity.
 */
import path from 'node:path';
import type { OnLoadArgs, OnLoadResult, OnResolveArgs, OnResolveResult, Plugin } from 'esbuild';
import { createPreviewThemeRuntimeSource } from './previewThemeRuntimeSource';
import {
  PREVIEW_RESOLVE_GUARD,
  PREVIEW_THEME_BRIDGE_NAMESPACE,
  PREVIEW_THEME_SPECIFIER,
} from './previewPluginProtocol';

const STYLED_COMPONENTS_SPECIFIER = 'styled-components';
const THEME_BRIDGE_DATA_KIND = 'react-preview-theme-bridge-data';

/** Immutable project boundary used for package resolution during one preview compilation. */
export interface PreviewThemeBridgePluginOptions {
  /** Nearest package root from which the target itself resolves styled-components. */
  readonly projectRoot: string;
}

/** Serializable metadata carried from optional package resolution into virtual-module loading. */
interface ThemeBridgePluginData {
  /** Discriminant preventing unrelated plugin metadata from being interpreted as bridge state. */
  readonly kind: typeof THEME_BRIDGE_DATA_KIND;
  /** Resolved package entry, omitted when the target project does not install the library. */
  readonly styledComponentsModulePath?: string;
}

/**
 * Creates the optional styled-components theme bridge consumed before the target is rendered.
 * Package lookup failure is a supported no-op state so ordinary React projects gain no dependency.
 *
 * @param options Nearest target package root used for browser-aware module resolution.
 * @returns Esbuild plugin scoped to one compilation request.
 */
export function createPreviewThemeBridgePlugin(options: PreviewThemeBridgePluginOptions): Plugin {
  return {
    name: 'react-preview-theme-bridge',
    setup(build): void {
      let resolutionPromise: Promise<string | undefined> | undefined;

      /** Re-probes restored or newly installed styled-components on every persistent rebuild. */
      build.onStart(() => {
        resolutionPromise = undefined;
      });

      /** Resolves the private bridge and memoizes optional styled-components discovery. */
      async function resolveThemeBridge(
        arguments_: OnResolveArgs,
      ): Promise<OnResolveResult | undefined> {
        if (arguments_.path !== PREVIEW_THEME_SPECIFIER) {
          return undefined;
        }

        resolutionPromise ??= resolveOptionalStyledComponents(build, options.projectRoot);
        const styledComponentsModulePath = await resolutionPromise;
        return {
          namespace: PREVIEW_THEME_BRIDGE_NAMESPACE,
          path:
            styledComponentsModulePath ?? path.join(options.projectRoot, 'empty-theme-preview.js'),
          pluginData: {
            kind: THEME_BRIDGE_DATA_KIND,
            ...(styledComponentsModulePath === undefined ? {} : { styledComponentsModulePath }),
          } satisfies ThemeBridgePluginData,
        };
      }

      /** Loads a memory-only theme runtime or the capability's identity wrapper. */
      function loadThemeBridge(arguments_: OnLoadArgs): OnLoadResult {
        const pluginData = readThemeBridgePluginData(arguments_.pluginData);
        if (pluginData?.styledComponentsModulePath === undefined) {
          return {
            contents: [
              '/** Leaves projects without styled-components unchanged. */',
              'export function registerPreviewThemeCandidate() {}',
              'export async function resolvePreviewTheme(options) { return options?.discoveredTheme; }',
              'export function createThemePreviewElement(children) { return children; }',
              '/** Describes why the automatic theme boundary is unavailable. */',
              "export function readPreviewRuntimeStatus() { return 'unavailable: styled-components was not resolved from the target project'; }",
            ].join('\n'),
            loader: 'js',
          };
        }

        return {
          contents: createPreviewThemeRuntimeSource({
            styledComponentsModulePath: pluginData.styledComponentsModulePath,
          }),
          loader: 'js',
          resolveDir: path.dirname(pluginData.styledComponentsModulePath),
          watchFiles: [pluginData.styledComponentsModulePath],
        };
      }

      build.onResolve({ filter: /^react-preview:theme$/ }, resolveThemeBridge);
      build.onLoad({ filter: /.*/, namespace: PREVIEW_THEME_BRIDGE_NAMESPACE }, loadThemeBridge);
    },
  };
}

/** Resolves a local browser-aware styled-components entry without making absence an error. */
async function resolveOptionalStyledComponents(
  build: Parameters<Plugin['setup']>[0],
  projectRoot: string,
): Promise<string | undefined> {
  const resolution = await build.resolve(STYLED_COMPONENTS_SPECIFIER, {
    kind: 'import-statement',
    pluginData: PREVIEW_RESOLVE_GUARD,
    resolveDir: projectRoot,
  });
  return resolution.errors.length === 0 && !resolution.external && resolution.namespace === 'file'
    ? resolution.path
    : undefined;
}

/** Narrows untrusted esbuild plugin metadata to this bridge's serializable contract. */
function readThemeBridgePluginData(pluginData: unknown): ThemeBridgePluginData | undefined {
  if (typeof pluginData !== 'object' || pluginData === null || !('kind' in pluginData)) {
    return undefined;
  }
  return pluginData.kind === THEME_BRIDGE_DATA_KIND
    ? (pluginData as ThemeBridgePluginData)
    : undefined;
}
