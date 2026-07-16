/**
 * Resolves the target project's exact React package into an optional automatic Context bridge.
 * The generated bridge uses raw React Context provider tokens registered by reached application
 * modules; it never locates or executes conventionally named authored Provider components.
 */
import path from 'node:path';
import type { OnLoadArgs, OnLoadResult, OnResolveArgs, OnResolveResult, Plugin } from 'esbuild';
import { createPreviewContextRuntimeSource } from './previewContextRuntimeSource';
import {
  PREVIEW_CONTEXT_BRIDGE_NAMESPACE,
  PREVIEW_CONTEXT_SPECIFIER,
  PREVIEW_RESOLVE_GUARD,
} from './previewPluginProtocol';

const CONTEXT_BRIDGE_DATA_KIND = 'react-preview-context-bridge-data';
const REACT_SPECIFIER = 'react';

/** Trusted project package boundary used to resolve the same React instance as the target graph. */
export interface PreviewContextBridgePluginOptions {
  /** Nearest package root from which the target itself resolves React. */
  readonly projectRoot: string;
}

/** Serializable result carried from optional React resolution into virtual-module loading. */
interface ContextBridgePluginData {
  /** Discriminant preventing unrelated resolver metadata from becoming runtime source input. */
  readonly kind: typeof CONTEXT_BRIDGE_DATA_KIND;
  /** Exact browser-aware React entry, omitted when the project does not resolve React. */
  readonly reactModulePath?: string;
}

/**
 * Creates the optional application Context bridge imported by the generated browser entry and
 * reached source registration statements.
 *
 * React lookup is performed through esbuild from `projectRoot`, matching aliases, exports conditions,
 * symlinks, and monorepo dependency placement used by the target itself. Absence is a supported
 * state and produces a no-op compatibility surface so the bridge never falls back to an
 * extension-owned React copy.
 *
 * @param options Nearest target package root used for project-owned React resolution.
 * @returns Esbuild plugin scoped to one compilation request.
 */
export function createPreviewContextBridgePlugin(
  options: PreviewContextBridgePluginOptions,
): Plugin {
  return {
    name: 'react-preview-context-bridge',
    setup(build): void {
      let resolutionPromise: Promise<string | undefined> | undefined;

      /** Resolves only the private bridge specifier and memoizes optional project React discovery. */
      async function resolveContextBridge(
        arguments_: OnResolveArgs,
      ): Promise<OnResolveResult | undefined> {
        if (arguments_.path !== PREVIEW_CONTEXT_SPECIFIER) {
          return undefined;
        }
        resolutionPromise ??= resolveOptionalProjectReact(build, options.projectRoot);
        const reactModulePath = await resolutionPromise;
        return {
          namespace: PREVIEW_CONTEXT_BRIDGE_NAMESPACE,
          path: reactModulePath ?? path.join(options.projectRoot, 'empty-context-preview.js'),
          pluginData: {
            kind: CONTEXT_BRIDGE_DATA_KIND,
            ...(reactModulePath === undefined ? {} : { reactModulePath }),
          } satisfies ContextBridgePluginData,
        };
      }

      /** Loads the complete Context runtime or an identity surface when project React is absent. */
      function loadContextBridge(arguments_: OnLoadArgs): OnLoadResult {
        const pluginData = readContextBridgePluginData(arguments_.pluginData);
        if (pluginData?.reactModulePath === undefined) {
          return {
            contents: createUnavailableContextRuntimeSource(),
            loader: 'js',
          };
        }
        return {
          contents: createPreviewContextRuntimeSource({
            reactModulePath: pluginData.reactModulePath,
          }),
          loader: 'js',
          resolveDir: path.dirname(pluginData.reactModulePath),
          watchFiles: [pluginData.reactModulePath],
        };
      }

      build.onResolve({ filter: /^react-preview:context$/ }, resolveContextBridge);
      build.onLoad(
        { filter: /.*/, namespace: PREVIEW_CONTEXT_BRIDGE_NAMESPACE },
        loadContextBridge,
      );
    },
  };
}

/** Resolves React from the target package without consulting the extension's dependency graph. */
async function resolveOptionalProjectReact(
  build: Parameters<Plugin['setup']>[0],
  projectRoot: string,
): Promise<string | undefined> {
  const resolution = await build.resolve(REACT_SPECIFIER, {
    kind: 'import-statement',
    pluginData: PREVIEW_RESOLVE_GUARD,
    resolveDir: projectRoot,
  });
  return resolution.errors.length === 0 && !resolution.external && resolution.namespace === 'file'
    ? resolution.path
    : undefined;
}

/** Narrows untrusted esbuild plugin metadata to this bridge's immutable contract. */
function readContextBridgePluginData(pluginData: unknown): ContextBridgePluginData | undefined {
  if (typeof pluginData !== 'object' || pluginData === null || !('kind' in pluginData)) {
    return undefined;
  }
  return pluginData.kind === CONTEXT_BRIDGE_DATA_KIND
    ? (pluginData as ContextBridgePluginData)
    : undefined;
}

/**
 * Produces the same named exports as the full runtime while leaving projects without React intact.
 * Registration functions intentionally do nothing because no compatible Context identity can exist
 * without the project's own React package.
 */
function createUnavailableContextRuntimeSource(): string {
  return [
    '/** Ignores hook/Context identity evidence when project React is unavailable. */',
    'export function registerPreviewContextIdentity(_hook, _context) {}',
    '/** Ignores demand-shaped fallback evidence when project React is unavailable. */',
    'export function registerPreviewContextRequirement(_hook, _fallback) {}',
    '/** Leaves the composed preview tree unchanged when project React is unavailable. */',
    'export function createContextPreviewElement(children) { return children; }',
    '/** Explains why no automatic application Context boundary can be created. */',
    "export function readPreviewRuntimeStatus() { return 'unavailable: react was not resolved from the target project'; }",
  ].join('\n');
}
