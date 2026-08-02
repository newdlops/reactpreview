/** Owns the exact compiler-private namespace set admitted by confined esbuild invocations. */
import { createHash } from 'node:crypto';
import type { Plugin } from 'esbuild';
import { PreviewCompilationError } from '../../domain/preview';
import {
  PREVIEW_APOLLO_BRIDGE_NAMESPACE,
  PREVIEW_ASSET_NAMESPACE,
  PREVIEW_CONTEXT_BRIDGE_NAMESPACE,
  PREVIEW_DATA_URL_NAMESPACE,
  PREVIEW_FORMIK_BRIDGE_NAMESPACE,
  PREVIEW_GLOBAL_PACKAGE_BRIDGE_NAMESPACE,
  PREVIEW_INSPECTOR_PAGE_EXECUTION_NAMESPACE,
  PREVIEW_INSPECTOR_PAGE_SURFACE_NAMESPACE,
  PREVIEW_INSPECTOR_ROOT_NAMESPACE,
  PREVIEW_INSPECTOR_RUNTIME_NAMESPACE,
  PREVIEW_INSPECTOR_TARGET_NAMESPACE,
  PREVIEW_NODE_BUILTIN_NAMESPACE,
  PREVIEW_REDUX_BRIDGE_NAMESPACE,
  PREVIEW_ROUTER_BRIDGE_NAMESPACE,
  PREVIEW_SETUP_BRIDGE_NAMESPACE,
  PREVIEW_STYLE_SHEET_MANAGER_NAMESPACE,
  PREVIEW_TARGET_BRIDGE_NAMESPACE,
  PREVIEW_THEME_BRIDGE_NAMESPACE,
  PREVIEW_THEME_CANDIDATE_NAMESPACE,
} from './previewPluginProtocol';
import {
  PREVIEW_MAIN_ENTRY_NAMESPACE,
  PREVIEW_RUNTIME_ANCHOR_NAMESPACE,
} from './previewBuildEntryPlugin';

/** Namespace-aware confinement policy identity. Bump whenever registry admission semantics change. */
export const PREVIEW_OWNED_NAMESPACE_POLICY_VERSION = 2;

/** Compiler-private namespace values that are intentionally unavailable to build requests. */
export const PREVIEW_COMPILER_PRIVATE_NAMESPACES = Object.freeze({
  generatedModuleFallback: 'react-preview-generated-module-fallback',
  generatedUiFallback: 'react-preview-generated-ui-fallback',
  inspectorCorridor: 'react-preview-inspector-corridor',
  inspectorJsxRuntime: 'react-preview-inspector-jsx-runtime',
  inspectorPortalRuntime: 'react-preview-inspector-portal-runtime',
  inspectorRenderBootstrap: 'react-preview-inspector-render-bootstrap',
  inspectorShallowCorridor: 'react-preview-inspector-shallow-corridor',
  inspectorStaticCorridor: 'react-preview-inspector-static-corridor',
  inspectorVirtualPageComponent: 'react-preview-inspector-virtual-page-component',
  inspectorVirtualPageComponentRuntime: 'react-preview-inspector-virtual-page-component-runtime',
  largePackageBarrel: 'react-preview-large-package-barrel',
  nextAppNavigation: 'react-preview-next-app-navigation',
  nextPagesRouter: 'react-preview-next-pages-router',
  nextPagesRouterContext: 'react-preview-next-pages-router-context',
  nextRenderFallback: 'react-preview-next-render-fallback',
  parentSlice: 'react-preview-parent-slice',
} as const);

/** One exact namespace-to-owner declaration established by compiler assembly. */
export interface PreviewOwnedNamespaceRegistration {
  readonly namespace: string;
  readonly ownerPluginName: string;
}

/** Conditional registrations controlled by the exact build plan rather than caller input. */
export interface PreviewCompilerNamespaceRegistryOptions {
  readonly inspectorPageExecutionEntry: boolean;
  readonly largePackageBarrelOwner?: 'inspector-corridor' | 'missing-source-fallbacks';
}

/** Immutable build-scoped lookup. Its internal map is never exposed or caller-extensible. */
export interface PreviewOwnedNamespaceRegistry {
  readonly policyDigest: string;
  readonly policyVersion: typeof PREVIEW_OWNED_NAMESPACE_POLICY_VERSION;
  readonly registrations: readonly PreviewOwnedNamespaceRegistration[];
  ownerOf(namespace: string): string | undefined;
}

const BASE_COMPILER_REGISTRATIONS = Object.freeze([
  registration(PREVIEW_MAIN_ENTRY_NAMESPACE, 'react-preview-build-entry'),
  registration(PREVIEW_RUNTIME_ANCHOR_NAMESPACE, 'react-preview-build-entry'),
  registration(PREVIEW_INSPECTOR_RUNTIME_NAMESPACE, 'react-preview-page-inspector-runtime'),
  registration(
    PREVIEW_COMPILER_PRIVATE_NAMESPACES.inspectorJsxRuntime,
    'react-preview-page-inspector-runtime',
  ),
  registration(
    PREVIEW_COMPILER_PRIVATE_NAMESPACES.inspectorPortalRuntime,
    'react-preview-page-inspector-runtime',
  ),
  registration(PREVIEW_NODE_BUILTIN_NAMESPACE, 'react-preview-node-builtins'),
  registration(PREVIEW_INSPECTOR_TARGET_NAMESPACE, 'react-preview-inspector-target'),
  registration(PREVIEW_INSPECTOR_PAGE_SURFACE_NAMESPACE, 'react-preview-page-execution-surface'),
  registration(
    PREVIEW_COMPILER_PRIVATE_NAMESPACES.inspectorCorridor,
    'react-preview-inspector-corridor',
  ),
  registration(
    PREVIEW_COMPILER_PRIVATE_NAMESPACES.inspectorStaticCorridor,
    'react-preview-inspector-corridor',
  ),
  registration(
    PREVIEW_COMPILER_PRIVATE_NAMESPACES.inspectorShallowCorridor,
    'react-preview-inspector-corridor',
  ),
  registration(
    PREVIEW_COMPILER_PRIVATE_NAMESPACES.inspectorVirtualPageComponent,
    'react-preview-inspector-corridor',
  ),
  registration(
    PREVIEW_COMPILER_PRIVATE_NAMESPACES.inspectorVirtualPageComponentRuntime,
    'react-preview-inspector-corridor',
  ),
  registration(
    PREVIEW_COMPILER_PRIVATE_NAMESPACES.nextRenderFallback,
    'react-preview-missing-source-fallbacks',
  ),
  registration(
    PREVIEW_COMPILER_PRIVATE_NAMESPACES.generatedModuleFallback,
    'react-preview-missing-source-fallbacks',
  ),
  registration(
    PREVIEW_COMPILER_PRIVATE_NAMESPACES.generatedUiFallback,
    'react-preview-missing-source-fallbacks',
  ),
  registration(PREVIEW_GLOBAL_PACKAGE_BRIDGE_NAMESPACE, 'react-preview-global-package-bridge'),
  registration(PREVIEW_APOLLO_BRIDGE_NAMESPACE, 'react-preview-apollo-bridge'),
  registration(PREVIEW_CONTEXT_BRIDGE_NAMESPACE, 'react-preview-context-bridge'),
  registration(PREVIEW_FORMIK_BRIDGE_NAMESPACE, 'react-preview-formik-bridge'),
  registration(PREVIEW_REDUX_BRIDGE_NAMESPACE, 'react-preview-redux-bridge'),
  registration(PREVIEW_ROUTER_BRIDGE_NAMESPACE, 'react-preview-router-bridge'),
  registration(
    PREVIEW_COMPILER_PRIVATE_NAMESPACES.nextAppNavigation,
    'react-preview-router-bridge',
  ),
  registration(PREVIEW_COMPILER_PRIVATE_NAMESPACES.nextPagesRouter, 'react-preview-router-bridge'),
  registration(
    PREVIEW_COMPILER_PRIVATE_NAMESPACES.nextPagesRouterContext,
    'react-preview-router-bridge',
  ),
  registration(PREVIEW_THEME_BRIDGE_NAMESPACE, 'react-preview-theme-bridge'),
  registration(PREVIEW_STYLE_SHEET_MANAGER_NAMESPACE, 'react-preview-style-sheet-manager'),
  registration(PREVIEW_THEME_CANDIDATE_NAMESPACE, 'react-preview-theme-candidate'),
  registration(PREVIEW_SETUP_BRIDGE_NAMESPACE, 'react-preview-setup-bridge'),
  registration(PREVIEW_COMPILER_PRIVATE_NAMESPACES.parentSlice, 'react-preview-parent-slice'),
  registration(PREVIEW_TARGET_BRIDGE_NAMESPACE, 'react-preview-target-bridge'),
  registration(PREVIEW_INSPECTOR_ROOT_NAMESPACE, 'react-preview-inspector-root'),
  registration(
    PREVIEW_COMPILER_PRIVATE_NAMESPACES.inspectorRenderBootstrap,
    'react-preview-inspector-root',
  ),
  registration(PREVIEW_ASSET_NAMESPACE, 'react-preview-assets'),
  registration(PREVIEW_DATA_URL_NAMESPACE, 'react-preview-assets'),
] as const);

/** Stable campaign-facing digest of the closed namespace policy, independent of active build shape. */
export const PREVIEW_OWNED_NAMESPACE_POLICY_DIGEST = createHash('sha256')
  .update(
    JSON.stringify({
      namespaces: [
        ...new Set([
          ...BASE_COMPILER_REGISTRATIONS.map(({ namespace }) => namespace),
          PREVIEW_INSPECTOR_PAGE_EXECUTION_NAMESPACE,
          ...Object.values(PREVIEW_COMPILER_PRIVATE_NAMESPACES),
        ]),
      ].sort(),
      policyVersion: PREVIEW_OWNED_NAMESPACE_POLICY_VERSION,
    }),
  )
  .digest('hex');

/**
 * Creates the registry for one concrete compiler plugin list. Only installed compiler plugins can
 * own a namespace, and duplicate plugin or namespace ownership fails before esbuild starts.
 */
export function createPreviewCompilerOwnedNamespaceRegistry(
  plugins: readonly Plugin[],
  options: PreviewCompilerNamespaceRegistryOptions,
): PreviewOwnedNamespaceRegistry {
  const pluginNames = new Set(plugins.map((plugin) => plugin.name));
  const registrations = BASE_COMPILER_REGISTRATIONS.filter((item) =>
    pluginNames.has(item.ownerPluginName),
  );
  if (options.inspectorPageExecutionEntry) {
    registrations.push(
      registration(PREVIEW_INSPECTOR_PAGE_EXECUTION_NAMESPACE, 'react-preview-inspector-root'),
    );
  }
  if (options.largePackageBarrelOwner !== undefined) {
    registrations.push(
      registration(
        PREVIEW_COMPILER_PRIVATE_NAMESPACES.largePackageBarrel,
        options.largePackageBarrelOwner === 'inspector-corridor'
          ? 'react-preview-inspector-corridor'
          : 'react-preview-missing-source-fallbacks',
      ),
    );
  }
  return createPreviewOwnedNamespaceRegistry(plugins, registrations);
}

/** Creates a validated registry for focused adapters and real-esbuild integration tests. */
export function createPreviewOwnedNamespaceRegistry(
  plugins: readonly Plugin[],
  registrations: readonly PreviewOwnedNamespaceRegistration[],
): PreviewOwnedNamespaceRegistry {
  const pluginNames = new Set<string>();
  for (const plugin of plugins) {
    if (plugin.name.trim().length === 0 || pluginNames.has(plugin.name)) {
      throw createRegistryError(
        `Compiler plugin ownership is missing or duplicated: ${plugin.name}`,
      );
    }
    pluginNames.add(plugin.name);
  }
  const owners = new Map<string, string>();
  const normalized = registrations.map((item) => {
    if (
      item.namespace === 'file' ||
      !/^[A-Za-z0-9_.-]+$/u.test(item.namespace) ||
      item.ownerPluginName.trim().length === 0
    ) {
      throw createRegistryError(`Malformed compiler namespace ownership: ${item.namespace}`);
    }
    if (!pluginNames.has(item.ownerPluginName)) {
      throw createRegistryError(
        `Compiler namespace ${item.namespace} has no installed owner plugin ${item.ownerPluginName}.`,
      );
    }
    const priorOwner = owners.get(item.namespace);
    if (priorOwner !== undefined) {
      throw createRegistryError(
        `Compiler namespace ${item.namespace} has duplicate owners ${priorOwner} and ${item.ownerPluginName}.`,
      );
    }
    owners.set(item.namespace, item.ownerPluginName);
    return Object.freeze({
      namespace: item.namespace,
      ownerPluginName: item.ownerPluginName,
    });
  });
  normalized.sort((left, right) => left.namespace.localeCompare(right.namespace));
  const frozenRegistrations = Object.freeze(normalized);
  return Object.freeze({
    ownerOf(namespace: string): string | undefined {
      return owners.get(namespace);
    },
    policyDigest: PREVIEW_OWNED_NAMESPACE_POLICY_DIGEST,
    policyVersion: PREVIEW_OWNED_NAMESPACE_POLICY_VERSION,
    registrations: frozenRegistrations,
  });
}

/** Whether a metafile identity uses any compiler-owned namespace from the closed policy catalog. */
export function isKnownPreviewCompilerVirtualInput(inputIdentity: string): boolean {
  return (
    BASE_COMPILER_REGISTRATIONS.some(({ namespace }) =>
      inputIdentity.startsWith(`${namespace}:`),
    ) ||
    Object.values(PREVIEW_COMPILER_PRIVATE_NAMESPACES).some((namespace) =>
      inputIdentity.startsWith(`${namespace}:`),
    )
  );
}

function registration(
  namespace: string,
  ownerPluginName: string,
): PreviewOwnedNamespaceRegistration {
  return Object.freeze({ namespace, ownerPluginName });
}

function createRegistryError(message: string): PreviewCompilationError {
  return new PreviewCompilationError(
    `React Preview namespace confinement registry rejected the build. ${message}`,
    [{ message, severity: 'error' }],
  );
}
