/** Creates inert corridor projections and validates private plugin-data envelopes. */
import type { OnResolveResult } from 'esbuild';
import path from 'node:path';
import {
  INSPECTOR_CORRIDOR_NAMESPACE,
  INSPECTOR_CORRIDOR_PLACEHOLDER_PATH,
  INSPECTOR_SHALLOW_CORRIDOR_NAMESPACE,
  INSPECTOR_STATIC_CORRIDOR_NAMESPACE,
  INSPECTOR_VIRTUAL_PAGE_COMPONENT_NAMESPACE,
} from './previewInspectorCorridorModel';
import { createPreviewDeferredCorridorBranch } from './previewInspectorDeferredDynamicSurface';
import { type PreviewInspectorShallowProjection } from './previewInspectorShallowProjection';
import { type PreviewStaticRouteProjection } from './previewInspectorStaticRouteProjection';
import { type PreviewInspectorVirtualPageComponent } from './previewInspectorVirtualPageComponentSource';

/**
 * Selects a statically rendered component boundary for authentic VirtualPage traversal.
 *
 * Hook-only imports remain demand-shaped stubs and wildcard surfaces fail open because neither is
 * a component identity. All ordinary named/default component projections are admitted regardless
 * of semantic filename, allowing headers, sidebars, feature content, overlays, and the selected
 * file to be represented by their authored code at any graph depth.
 */
export function shouldExpandVirtualPageComponent(
  projection: PreviewInspectorShallowProjection,
): boolean {
  const runtimeHookExportNames = new Set(projection.runtimeHookExportNames);
  return (
    !projection.exportNames.includes('*') &&
    projection.exportNames.some((exportName) => !runtimeHookExportNames.has(exportName))
  );
}

/** Returns one stable virtual identity so thousands of discarded registry edges share output. */
export function createOmittedDeferredBranch(targetPath?: string): OnResolveResult {
  return createPreviewDeferredCorridorBranch(
    INSPECTOR_CORRIDOR_NAMESPACE,
    INSPECTOR_CORRIDOR_PLACEHOLDER_PATH,
    targetPath,
  );
}

/** Returns an importer-scoped virtual identity so different named ESM demands cannot collide. */
export function createOmittedStaticRouteBranch(
  importerPath: string,
  projection: PreviewStaticRouteProjection,
): OnResolveResult {
  return {
    namespace: INSPECTOR_STATIC_CORRIDOR_NAMESPACE,
    path: `${importerPath}\0${projection.moduleSpecifier}`,
    pluginData: projection,
    sideEffects: false,
  };
}

/** Creates an importer-scoped virtual identity for one shallow child component surface. */
export function createShallowVisualProjection(
  importerPath: string,
  projection: PreviewInspectorShallowProjection,
): OnResolveResult {
  return {
    namespace: INSPECTOR_SHALLOW_CORRIDOR_NAMESPACE,
    path: `${importerPath}\0${projection.moduleSpecifier}`,
    pluginData: projection,
    sideEffects: false,
  };
}

/**
 * Creates one stable module/export identity for an authentic transitive VirtualPage component.
 *
 * The identity deliberately excludes the importer. If authored modules form a render cycle,
 * esbuild reaches the same virtual module again and closes the graph instead of generating another
 * hop. Different demanded export sets remain distinct so named ESM surfaces stay exact.
 */
export function createVirtualPageComponentFacade(
  sourcePath: string,
  projection: PreviewInspectorShallowProjection,
): OnResolveResult {
  const exportIdentity = [...projection.exportNames].sort().join(',');
  return {
    namespace: INSPECTOR_VIRTUAL_PAGE_COMPONENT_NAMESPACE,
    path: JSON.stringify([sourcePath, exportIdentity]),
    pluginData: {
      projection,
      sourcePath,
    } satisfies PreviewInspectorVirtualPageComponent,
    sideEffects: false,
  };
}

/** Validates private projection data before generating executable ESM source. */
export function readStaticProjectionPluginData(
  value: unknown,
): PreviewStaticRouteProjection | undefined {
  if (
    typeof value !== 'object' ||
    value === null ||
    !('moduleSpecifier' in value) ||
    typeof value.moduleSpecifier !== 'string' ||
    !('exportNames' in value) ||
    !Array.isArray(value.exportNames) ||
    !value.exportNames.every((name) => typeof name === 'string')
  ) {
    return undefined;
  }
  let neutralRouteBasePath: string | undefined;
  if ('neutralRouteBasePath' in value) {
    if (typeof value.neutralRouteBasePath !== 'string') return undefined;
    neutralRouteBasePath = value.neutralRouteBasePath;
  }
  return {
    exportNames: value.exportNames,
    moduleSpecifier: value.moduleSpecifier,
    ...(neutralRouteBasePath === undefined ? {} : { neutralRouteBasePath }),
  };
}

/** Validates shallow projection metadata before generating a browser module. */
export function readShallowProjectionPluginData(
  value: unknown,
): PreviewInspectorShallowProjection | undefined {
  if (
    typeof value !== 'object' ||
    value === null ||
    !('moduleSpecifier' in value) ||
    typeof value.moduleSpecifier !== 'string' ||
    !('exportNames' in value) ||
    !Array.isArray(value.exportNames) ||
    !value.exportNames.every((name) => typeof name === 'string') ||
    !('runtimeHookExportNames' in value) ||
    !Array.isArray(value.runtimeHookExportNames) ||
    !value.runtimeHookExportNames.every((name) => typeof name === 'string') ||
    ('neutralRouteBasePath' in value && typeof value.neutralRouteBasePath !== 'string')
  ) {
    return undefined;
  }
  return {
    exportNames: Object.freeze([...value.exportNames]),
    moduleSpecifier: value.moduleSpecifier,
    ...('neutralRouteBasePath' in value && typeof value.neutralRouteBasePath === 'string'
      ? { neutralRouteBasePath: value.neutralRouteBasePath }
      : {}),
    runtimeHookExportNames: Object.freeze([...value.runtimeHookExportNames]),
  };
}

/** Validates private authentic-component data before importing a project source into a facade. */
export function readVirtualPageComponentPluginData(
  value: unknown,
): PreviewInspectorVirtualPageComponent | undefined {
  if (
    typeof value !== 'object' ||
    value === null ||
    !('sourcePath' in value) ||
    typeof value.sourcePath !== 'string' ||
    !path.isAbsolute(value.sourcePath) ||
    !('projection' in value)
  ) {
    return undefined;
  }
  const projection = readShallowProjectionPluginData(value.projection);
  if (projection === undefined) return undefined;
  return {
    projection,
    sourcePath: value.sourcePath,
  };
}
