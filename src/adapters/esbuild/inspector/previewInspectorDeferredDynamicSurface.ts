/**
 * Builds the inert module that replaces one omitted off-corridor dynamic import.
 *
 * A pinned Page Inspector corridor omits dynamic imports of modules it will not render. The shared
 * placeholder only exports `default`, which suits route registries, but authored code often picks a
 * named export from the promise: `dynamic(import('./Picker').then((mod) => mod.Picker))`. That read
 * produced `undefined`, and Next's `dynamic` then threw while the page module evaluated, so the
 * whole page failed although the picker would never render. When the omitted target is known, the
 * replacement mirrors the target's explicit export names, each bound to the same inert component.
 */
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import type { OnLoadArgs, OnLoadResult, OnResolveResult } from 'esbuild';
import { collectPreviewRenderModuleFacts } from '../renderGraph/previewRenderModuleFacts';

const MAX_TARGET_SOURCE_BYTES = 2 * 1024 * 1024;
const IDENTIFIER_PATTERN = /^[$A-Z_a-z][$\w]*$/u;

/** Shared body of every omitted corridor route module. */
export const PREVIEW_DEFERRED_CORRIDOR_ROUTE_SOURCE = [
  '/** Unselected project route omitted from this pinned static Page Inspector corridor. */',
  'function ReactPreviewDeferredCorridorRoute() { return null; }',
  'export default ReactPreviewDeferredCorridorRoute;',
  'export const __reactPreviewDeferredCorridorRoute = ReactPreviewDeferredCorridorRoute;',
].join('\n');

/**
 * Names the virtual module of one omitted target without embedding its path, so bundle inputs never
 * look like the real file was loaded.
 *
 * @param targetPath Resolved authored module that is not bundled.
 * @returns Stable short identity.
 */
export function createPreviewDeferredDynamicSurfaceKey(targetPath: string): string {
  return createHash('sha256').update(targetPath).digest('hex').slice(0, 16);
}

/**
 * Creates the omitted module for one known dynamic import target.
 *
 * @param targetPath Resolved authored module that is not bundled.
 * @returns Module source exporting the target's explicit names as inert components.
 */
export async function createPreviewDeferredDynamicSurfaceSource(
  targetPath: string,
): Promise<string> {
  let exportNames: readonly string[] = [];
  try {
    const sourceText = await readFile(targetPath, 'utf8');
    if (sourceText.length <= MAX_TARGET_SOURCE_BYTES) {
      exportNames = collectPreviewRenderModuleFacts(targetPath, sourceText).exports.flatMap(
        (fact) =>
          !fact.wildcard &&
          fact.exportName !== 'default' &&
          fact.exportName !== '__reactPreviewDeferredCorridorRoute' &&
          IDENTIFIER_PATTERN.test(fact.exportName)
            ? [fact.exportName]
            : [],
      );
    }
  } catch {
    exportNames = [];
  }
  return [
    PREVIEW_DEFERRED_CORRIDOR_ROUTE_SOURCE,
    ...[...new Set(exportNames)]
      .sort()
      .map((exportName) => `export const ${exportName} = ReactPreviewDeferredCorridorRoute;`),
  ].join('\n');
}

/**
 * Resolves an omitted dynamic import to the shared route module, or to one mirroring a known
 * target. The virtual path carries a hash, never the target path, so bundle inputs never look like
 * the real file was loaded.
 *
 * @param namespace Corridor namespace that owns the virtual modules.
 * @param placeholderPath Path of the shared route module.
 * @param targetPath Resolved authored target, when it is a single known module.
 * @returns Resolution into the corridor namespace.
 */
export function createPreviewDeferredCorridorBranch(
  namespace: string,
  placeholderPath: string,
  targetPath?: string,
): OnResolveResult {
  return targetPath === undefined
    ? { namespace, path: placeholderPath }
    : {
        namespace,
        path: `${placeholderPath}-${createPreviewDeferredDynamicSurfaceKey(targetPath)}`,
        pluginData: { deferredTargetPath: targetPath },
      };
}

/**
 * Loads one omitted corridor module.
 *
 * @param arguments_ Load request in the corridor namespace.
 * @param placeholderPath Path of the shared route module.
 * @returns The inert module source.
 */
export async function loadPreviewDeferredCorridorBranch(
  arguments_: OnLoadArgs,
  placeholderPath: string,
): Promise<OnLoadResult> {
  if (arguments_.path === placeholderPath) {
    return { contents: PREVIEW_DEFERRED_CORRIDOR_ROUTE_SOURCE, loader: 'js' };
  }
  const targetPath = (
    arguments_.pluginData as { readonly deferredTargetPath?: unknown } | undefined
  )?.deferredTargetPath;
  if (typeof targetPath !== 'string') {
    throw new TypeError('Unknown React Preview deferred corridor module.');
  }
  return {
    contents: await createPreviewDeferredDynamicSurfaceSource(targetPath),
    loader: 'js',
    watchFiles: [targetPath],
  };
}
