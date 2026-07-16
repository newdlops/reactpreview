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

/** Namespace used by the source-ordered target gallery bridge consumed by the runtime entry. */
export const PREVIEW_TARGET_BRIDGE_NAMESPACE = 'react-preview-target-bridge';

/** Namespace used by the opt-in Inspector descriptor that imports one real ancestor root. */
export const PREVIEW_INSPECTOR_ROOT_NAMESPACE = 'react-preview-inspector-root';

/** Namespace used by the facade that instruments selected exports of the original target. */
export const PREVIEW_INSPECTOR_TARGET_NAMESPACE = 'react-preview-inspector-target';

/** Namespace used by the small browser runtime imported only from Inspector target facades. */
export const PREVIEW_INSPECTOR_RUNTIME_NAMESPACE = 'react-preview-page-inspector-runtime';

/** Namespace used by lexical inject modules that expose statically proven project globals. */
export const PREVIEW_GLOBAL_PACKAGE_BRIDGE_NAMESPACE = 'react-preview-global-package-bridge';

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

/** Namespace used by the optional, project-owned React Redux runtime bridge. */
export const PREVIEW_REDUX_BRIDGE_NAMESPACE = 'react-preview-redux-bridge';

/** Stable virtual import specifier used to load the inert static Redux boundary. */
export const PREVIEW_REDUX_SPECIFIER = 'react-preview:redux';

/** Namespace used by the optional, project-owned Formik runtime bridge. */
export const PREVIEW_FORMIK_BRIDGE_NAMESPACE = 'react-preview-formik-bridge';

/** Stable virtual import specifier used to load the inert static Formik boundary. */
export const PREVIEW_FORMIK_SPECIFIER = 'react-preview:formik';

/** Namespace used by the exact-identity application React Context runtime bridge. */
export const PREVIEW_CONTEXT_BRIDGE_NAMESPACE = 'react-preview-context-bridge';

/** Stable virtual specifier used by reached Context identity and requirement registrations. */
export const PREVIEW_CONTEXT_SPECIFIER = 'react-preview:context';

/** Namespace used by the optional, project-owned styled-components theme bridge. */
export const PREVIEW_THEME_BRIDGE_NAMESPACE = 'react-preview-theme-bridge';

/** Stable virtual import specifier used to load the structural fallback theme boundary. */
export const PREVIEW_THEME_SPECIFIER = 'react-preview:theme';

/** Namespace used to canonicalize a reached theme request without evaluating the theme module. */
export const PREVIEW_THEME_CANDIDATE_NAMESPACE = 'react-preview-theme-candidate';

/** Prefix for generated imports whose payload carries one syntax-level theme request. */
export const PREVIEW_THEME_CANDIDATE_SPECIFIER_PREFIX = 'react-preview:theme-candidate/';

/** Namespace used by the optional, project-owned React Router runtime bridge. */
export const PREVIEW_ROUTER_BRIDGE_NAMESPACE = 'react-preview-router-bridge';

/** Stable virtual import specifier used to load the static in-memory router boundary. */
export const PREVIEW_ROUTER_SPECIFIER = 'react-preview:router';

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
    namespace === PREVIEW_REDUX_BRIDGE_NAMESPACE ||
    namespace === PREVIEW_FORMIK_BRIDGE_NAMESPACE ||
    namespace === PREVIEW_CONTEXT_BRIDGE_NAMESPACE ||
    namespace === PREVIEW_ROUTER_BRIDGE_NAMESPACE ||
    namespace === PREVIEW_THEME_BRIDGE_NAMESPACE ||
    namespace === PREVIEW_THEME_CANDIDATE_NAMESPACE ||
    namespace === PREVIEW_SETUP_BRIDGE_NAMESPACE ||
    namespace === PREVIEW_TARGET_BRIDGE_NAMESPACE
  );
}
