/* eslint-disable jsdoc/require-jsdoc */
/** Generates an exact-edge Page Execution Slice React root. */
import { createPreviewInspectorPageSurfaceSpecifier } from './previewInspectorPageExecutionPlugin';
import { PREVIEW_INSPECTOR_TARGET_FACADE_SPECIFIER } from './previewInspectorTargetPlugin';
import {
  PREVIEW_INSPECTOR_PAGE_ROUTE_STATE_SPECIFIER,
  shouldInstallPreviewInspectorPageRouteStatePrelude,
} from './previewInspectorPageRouteStatePrelude';
import { createPreviewInspectorRouteExecutionRuntimeSource } from './previewInspectorRouteExecutionRuntimeSource';
import type {
  PreviewInspectorMountSurface,
  PreviewInspectorPageCompositionEdge,
  PreviewInspectorPageExecutionCandidate,
} from './previewInspectorPageExecutionTypes';

export interface CreatePreviewInspectorPageExecutionSourceOptions {
  readonly candidate: PreviewInspectorPageExecutionCandidate;
  readonly target: { readonly exportName: string; readonly sourcePath: string };
}

/**
 * Emits a source-only React root. Surface imports are virtual only for selected/local slices;
 * authentic surfaces preserve their authored module export. Composition fails closed to a single
 * surface when an edge is incomplete, rather than injecting guessed children into a wrapper.
 */
export function createPreviewInspectorPageExecutionSource(
  options: CreatePreviewInspectorPageExecutionSourceOptions,
): string {
  const surfaces = options.candidate.criticalSurfaces;
  const imports = surfaces.map((surface, index) =>
    createSurfaceImport(surface, index, options.target),
  );
  const localById = new Map(
    surfaces.map((surface, index) => [surface.id, `Surface${index.toString()}`]),
  );
  const childrenByParent = new Map<string, PreviewInspectorPageCompositionEdge[]>();
  const childIds = new Set<string>();
  for (const edge of options.candidate.compositionEdges) {
    if (!localById.has(edge.parentSurfaceId) || !localById.has(edge.childSurfaceId)) continue;
    const list = childrenByParent.get(edge.parentSurfaceId) ?? [];
    list.push(edge);
    childrenByParent.set(edge.parentSurfaceId, list);
    if (edge.mode !== 'contains-authored-child') childIds.add(edge.childSurfaceId);
  }
  const root = surfaces.find((surface) => !childIds.has(surface.id)) ?? surfaces[0];
  if (root === undefined)
    return 'export default function PreviewInspectorPageExecution() { return null; }';
  const render = (surfaceId: string, active: Set<string>): string => {
    const local = localById.get(surfaceId);
    if (local === undefined || active.has(surfaceId)) return 'null';
    active.add(surfaceId);
    const edges = [...(childrenByParent.get(surfaceId) ?? [])].sort(
      (left, right) =>
        left.placementIndex - right.placementIndex ||
        left.childSurfaceId.localeCompare(right.childSurfaceId),
    );
    const authoredChild = edges.some((edge) => edge.mode === 'contains-authored-child');
    const before = edges
      .filter((edge) => edge.mode === 'sibling-before')
      .map((edge) => render(edge.childSurfaceId, new Set(active)));
    const after = edges
      .filter((edge) => edge.mode === 'sibling-after')
      .map((edge) => render(edge.childSurfaceId, new Set(active)));
    const slot = edges.find(
      (edge) =>
        edge.mode !== 'contains-authored-child' &&
        edge.mode !== 'sibling-before' &&
        edge.mode !== 'sibling-after',
    );
    let current = `React.createElement(${local}, null)`;
    if (!authoredChild && slot !== undefined) {
      const child = render(slot.childSurfaceId, new Set(active));
      current = composeEdge(local, slot, child, current, options.candidate.routeRecipe);
    }
    active.delete(surfaceId);
    return before.length === 0 && after.length === 0
      ? current
      : `React.createElement(React.Fragment, null, ${[...before, current, ...after].join(', ')})`;
  };
  const renderedRoot = render(root.id, new Set());
  const routeRecipe = options.candidate.routeRecipe;
  const routerSurfaceIds = new Set(
    routeRecipe?.mounts
      .map((mount) => mount.parentSurfaceId)
      .filter((surfaceId): surfaceId is string => surfaceId !== undefined) ?? [],
  );
  const routerPageSurfaceId = routeRecipe?.mounts.at(-1)?.childSurfaceId;
  const routerRenderedPage =
    routerPageSurfaceId === undefined ? renderedRoot : render(routerPageSurfaceId, new Set());
  const routerRuntime =
    routeRecipe === undefined
      ? undefined
      : createPreviewInspectorRouteExecutionRuntimeSource({
          recipe: routeRecipe,
          renderedPage: routerRenderedPage,
          routeSurfaceLocals: [...routerSurfaceIds]
            .map((surfaceId) => localById.get(surfaceId))
            .filter((local): local is string => local !== undefined),
        });
  const routeStatePrelude = shouldInstallPreviewInspectorPageRouteStatePrelude(routeRecipe);
  const routeElement = routerRuntime !== undefined ? routerRuntime.routeElement : renderedRoot;
  return [
    "import React from 'react';",
    ...(routeStatePrelude
      ? [`import ${JSON.stringify(PREVIEW_INSPECTOR_PAGE_ROUTE_STATE_SPECIFIER)};`]
      : []),
    ...imports,
    ...(routerRuntime?.imports ?? []),
    'export default function PreviewInspectorPageExecution() {',
    `  return ${routeElement};`,
    '}',
  ].join('\n');
}

function createSurfaceImport(
  surface: PreviewInspectorMountSurface,
  index: number,
  target: { readonly exportName: string; readonly sourcePath: string },
): string {
  const local = `Surface${index.toString()}`;
  const specifier =
    surface.strategy === 'authentic-module-export' &&
    surface.sourcePath === target.sourcePath &&
    surface.exportName === target.exportName
      ? PREVIEW_INSPECTOR_TARGET_FACADE_SPECIFIER
      : surface.strategy === 'authentic-module-export' ||
          surface.strategy === 'framework-page-surface' ||
          surface.strategy === 'selected-route-surface'
        ? surface.sourcePath
        : createPreviewInspectorPageSurfaceSpecifier(surface.id);
  if (surface.strategy === 'selected-route-surface') {
    const namespace = `${local}Module`;
    return [
      `import * as ${namespace} from ${JSON.stringify(specifier)};`,
      `const ${local} = ${namespace}[${JSON.stringify(surface.exportName)}] ?? ${namespace}.default;`,
    ].join('\n');
  }
  return surface.exportName === 'default'
    ? `import ${local} from ${JSON.stringify(specifier)};`
    : `import { ${surface.exportName} as ${local} } from ${JSON.stringify(specifier)};`;
}

function composeEdge(
  parent: string,
  edge: PreviewInspectorPageCompositionEdge,
  child: string,
  fallback: string,
  routeRecipe: PreviewInspectorPageExecutionCandidate['routeRecipe'],
): string {
  if (
    edge.mode === 'children-slot' ||
    edge.mode === 'route-outlet' ||
    edge.mode === 'next-layout-slot'
  ) {
    const properties =
      edge.mode === 'next-layout-slot' && routeRecipe?.kind === 'next-app'
        ? `{ params: ${JSON.stringify(routeRecipe.params)}, searchParams: ${JSON.stringify(routeRecipe.searchParams)} }`
        : 'null';
    return `React.createElement(${parent}, ${properties}, ${child})`;
  }
  if (edge.mode === 'component-prop-slot' && edge.slotName === 'Component')
    return `React.createElement(${parent}, { "Component": () => ${child}, "pageProps": {} })`;
  if (edge.mode === 'component-prop-slot' && edge.slotName !== undefined)
    return `React.createElement(${parent}, { ${JSON.stringify(edge.slotName)}: ${child} })`;
  if (edge.mode === 'render-prop-slot' && edge.slotName !== undefined)
    return `React.createElement(${parent}, { ${JSON.stringify(edge.slotName)}: () => ${child} })`;
  return fallback;
}
