/** Resolves react-beautiful-dnd from the target project and exposes a private optional bridge. */
import path from 'node:path';
import type { OnLoadArgs, OnLoadResult, OnResolveArgs, OnResolveResult, Plugin } from 'esbuild';
import { createPreviewDragDropRuntimeSource } from './previewDragDropRuntimeSource';
import type { PreviewDragDropRequirement } from './previewDragDropRequirement';
import {
  PREVIEW_DRAG_DROP_BRIDGE_NAMESPACE,
  PREVIEW_DRAG_DROP_SPECIFIER,
  PREVIEW_RESOLVE_GUARD,
} from './previewPluginProtocol';

const PACKAGE_SPECIFIER = 'react-beautiful-dnd';
const DATA_KIND = 'react-preview-drag-drop-bridge-data';

export interface PreviewDragDropBridgePluginOptions {
  /** Compiler-proven selected-target evidence available before lazy Page Inspector imports run. */
  readonly initialRequirement?: PreviewDragDropRequirement;
  readonly projectRoot: string;
}

interface DragDropBridgePluginData {
  readonly kind: typeof DATA_KIND;
  readonly modulePath?: string;
}

/** Creates the optional exact-project react-beautiful-dnd runtime bridge. */
export function createPreviewDragDropBridgePlugin(
  options: PreviewDragDropBridgePluginOptions,
): Plugin {
  return {
    name: 'react-preview-drag-drop-bridge',
    setup(build): void {
      let resolutionPromise: Promise<string | undefined> | undefined;
      build.onStart(() => {
        resolutionPromise = undefined;
      });

      /** Resolves only the private bridge specifier and preserves project package identity. */
      async function resolveBridge(
        arguments_: OnResolveArgs,
      ): Promise<OnResolveResult | undefined> {
        if (arguments_.path !== PREVIEW_DRAG_DROP_SPECIFIER) return undefined;
        resolutionPromise ??= resolveOptionalPackage(build, options.projectRoot);
        const modulePath = await resolutionPromise;
        return {
          namespace: PREVIEW_DRAG_DROP_BRIDGE_NAMESPACE,
          path: modulePath ?? path.join(options.projectRoot, 'empty-drag-drop-preview.js'),
          pluginData: {
            kind: DATA_KIND,
            ...(modulePath === undefined ? {} : { modulePath }),
          } satisfies DragDropBridgePluginData,
        };
      }

      /** Emits either the exact-package bridge or a side-effect-free unavailable facade. */
      function loadBridge(arguments_: OnLoadArgs): OnLoadResult {
        const data = readPluginData(arguments_.pluginData);
        if (data?.modulePath === undefined) {
          return {
            contents: [
              'export function createDragDropPreviewElement(children) { return children; }',
              'export function registerPreviewDragDropRequirement(_requirement) {}',
              "export function readPreviewRuntimeStatus() { return 'unavailable: react-beautiful-dnd was not resolved from the target project'; }",
            ].join('\n'),
            loader: 'js',
          };
        }
        return {
          contents: createPreviewDragDropRuntimeSource(data.modulePath, options.initialRequirement),
          loader: 'js',
          resolveDir: path.dirname(data.modulePath),
          watchFiles: [data.modulePath],
        };
      }

      build.onResolve({ filter: /^react-preview:drag-drop$/ }, resolveBridge);
      build.onLoad({ filter: /.*/, namespace: PREVIEW_DRAG_DROP_BRIDGE_NAMESPACE }, loadBridge);
    },
  };
}

/** Attempts an exact project-root package resolution without falling back to extension packages. */
async function resolveOptionalPackage(
  build: Parameters<Plugin['setup']>[0],
  projectRoot: string,
): Promise<string | undefined> {
  const resolution = await build.resolve(PACKAGE_SPECIFIER, {
    kind: 'import-statement',
    pluginData: PREVIEW_RESOLVE_GUARD,
    resolveDir: projectRoot,
  });
  return resolution.errors.length === 0 && !resolution.external && resolution.namespace === 'file'
    ? resolution.path
    : undefined;
}

/** Narrows opaque esbuild plugin data to this bridge's private record. */
function readPluginData(value: unknown): DragDropBridgePluginData | undefined {
  if (typeof value !== 'object' || value === null || !('kind' in value)) return undefined;
  return value.kind === DATA_KIND ? (value as DragDropBridgePluginData) : undefined;
}
