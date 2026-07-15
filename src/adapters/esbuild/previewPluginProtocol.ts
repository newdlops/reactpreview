/**
 * Defines private esbuild plugin namespaces and recursion metadata shared by preview adapters.
 * Centralizing these identifiers lets resolver, snapshot, asset, and bridge plugins cooperate
 * without importing one another or accidentally re-entering the complete resolver chain.
 */

/** Namespace used for editor snapshots that must override their saved filesystem modules. */
export const PREVIEW_SNAPSHOT_NAMESPACE = 'react-preview-snapshot';

/** Namespace used for generated asset modules such as raw text and SVG React adapters. */
export const PREVIEW_ASSET_NAMESPACE = 'react-preview-asset';

/** Namespace used for bounded binary assets emitted through esbuild's data-URL loader. */
export const PREVIEW_DATA_URL_NAMESPACE = 'react-preview-data-url';

/** Namespace used by the default-only target bridge consumed by the runtime entry. */
export const PREVIEW_TARGET_BRIDGE_NAMESPACE = 'react-preview-target-bridge';

/** Stable virtual import specifier emitted by the runtime entry for the target bridge. */
export const PREVIEW_TARGET_SPECIFIER = 'react-preview:target';

/** Namespace used by the optional project setup bridge consumed before the target module. */
export const PREVIEW_SETUP_BRIDGE_NAMESPACE = 'react-preview-setup-bridge';

/** Stable virtual import specifier emitted by the runtime entry for the project setup bridge. */
export const PREVIEW_SETUP_SPECIFIER = 'react-preview:setup';

/** Namespace used by the optional, project-owned Apollo runtime bridge. */
export const PREVIEW_APOLLO_BRIDGE_NAMESPACE = 'react-preview-apollo-bridge';

/** Stable virtual import specifier used to load the no-network Apollo boundary. */
export const PREVIEW_APOLLO_SPECIFIER = 'react-preview:apollo';

/** Shared metadata marker that prevents nested `build.resolve()` calls from recursing. */
export const PREVIEW_RESOLVE_GUARD = Symbol('react-preview-resolve-guard');

/**
 * Reports whether a namespace represents a virtual module backed by a real source path.
 * Imports from these namespaces must be delegated to esbuild with normal `file` semantics.
 *
 * @param namespace Namespace supplied to an esbuild resolution callback.
 * @returns `true` when the virtual module path can safely act as a filesystem importer.
 */
export function isFileBackedPreviewNamespace(namespace: string): boolean {
  return (
    namespace === PREVIEW_ASSET_NAMESPACE ||
    namespace === PREVIEW_DATA_URL_NAMESPACE ||
    namespace === PREVIEW_SNAPSHOT_NAMESPACE ||
    namespace === PREVIEW_APOLLO_BRIDGE_NAMESPACE ||
    namespace === PREVIEW_SETUP_BRIDGE_NAMESPACE ||
    namespace === PREVIEW_TARGET_BRIDGE_NAMESPACE
  );
}
