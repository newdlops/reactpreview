/* eslint-disable jsdoc/require-jsdoc */
/** Generates an exact-edge Page Execution Slice React root. */
import { createPreviewInspectorPageSurfaceSpecifier } from './previewInspectorPageExecutionPlugin';
import { PREVIEW_INSPECTOR_TARGET_FACADE_SPECIFIER } from './previewInspectorTargetPlugin';
import { PREVIEW_NEXT_APP_ROUTE_STATE_SYMBOL_KEY } from '../previewNextAppNavigationRuntimeSource';
import { createPreviewInspectorRouteExecutionRuntimeSource } from './previewInspectorRouteExecutionRuntimeSource';
import type {
  PreviewInspectorMountSurface,
  PreviewInspectorPageCompositionEdge,
  PreviewInspectorPageExecutionCandidate,
  PreviewInspectorRouteExecutionRecipe,
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
  const genericRoute = routeRecipe?.kind === 'generic-memory-location' ? routeRecipe : undefined;
  const nextRoute =
    routeRecipe?.kind === 'next-app' || routeRecipe?.kind === 'next-pages'
      ? routeRecipe
      : undefined;
  const routeElement =
    routerRuntime !== undefined
      ? routerRuntime.routeElement
      : genericRoute !== undefined
      ? `React.createElement(PreviewInspectorRouteLocation, { pathname: ${JSON.stringify(genericRoute.pathname)}, search: ${JSON.stringify(createSearch(genericRoute.searchParams))} }, ${renderedRoot})`
      : nextRoute?.kind === 'next-app'
        ? `React.createElement(PreviewInspectorNextAppRoute, null, ${renderedRoot})`
        : nextRoute?.kind === 'next-pages'
          ? `React.createElement(PreviewInspectorNextPagesRoute, null, ${renderedRoot})`
          : renderedRoot;
  return [
    "import React from 'react';",
    ...imports,
    ...(routerRuntime?.imports ?? []),
    ...(genericRoute === undefined
      ? []
      : [
          'function PreviewInspectorRouteLocation({ children, pathname, search }) {',
          '  React.useLayoutEffect(() => {',
          '    const next = pathname + search;',
          '    if (globalThis.location?.pathname + globalThis.location?.search !== next) {',
          '      globalThis.history?.replaceState?.(globalThis.history.state, "", next);',
          '      globalThis.dispatchEvent?.(new PopStateEvent("popstate"));',
          '    }',
          '  }, [pathname, search]);',
          '  return children;',
          '}',
        ]),
    ...(nextRoute === undefined ? [] : createNextRouteRuntime(nextRoute)),
    'export default function PreviewInspectorPageExecution() {',
    `  return ${routeElement};`,
    '}',
  ].join('\n');
}

/** Installs exactly the selected framework route state; it never evaluates a Next registry. */
function createNextRouteRuntime(recipe: PreviewInspectorRouteExecutionRecipe): readonly string[] {
  if (recipe.kind === 'next-app') {
    return [
      `const previewNextAppRouteStateSymbol = Symbol.for(${JSON.stringify(PREVIEW_NEXT_APP_ROUTE_STATE_SYMBOL_KEY)});`,
      'function PreviewInspectorNextAppRoute({ children }) {',
      `  globalThis[previewNextAppRouteStateSymbol] = Object.freeze({ initialSignature: JSON.stringify([${JSON.stringify(recipe.pathname)}, ${JSON.stringify(recipe.params)}, ${JSON.stringify(recipe.searchParams)}]), params: Object.freeze(${JSON.stringify(recipe.params)}), pathname: ${JSON.stringify(recipe.pathname)}, revision: 0, searchParams: Object.freeze(${JSON.stringify(recipe.searchParams)}) });`,
      '  return children;',
      '}',
    ];
  }
  return [
    "const previewNextPagesRouteStateSymbol = Symbol.for('newdlops.react-file-preview.next-pages-router-state');",
    'function PreviewInspectorNextPagesRoute({ children }) {',
    `  globalThis[previewNextPagesRouteStateSymbol] = Object.freeze({ pathname: ${JSON.stringify(recipe.pathname)}, pattern: ${JSON.stringify(recipe.mounts[0]?.pattern ?? recipe.pathname)} });`,
    '  return children;',
    '}',
  ];
}

/** Serializes only static route query values; loader and action data are never materialized. */
function createSearch(searchParams: Readonly<Record<string, string | readonly string[]>>): string {
  const query = new URLSearchParams();
  for (const key of Object.keys(searchParams).sort((left, right) => left.localeCompare(right))) {
    const value: string | readonly string[] | undefined = searchParams[key];
    if (value === undefined) continue;
    if (typeof value === 'string') {
      query.append(key, value);
      continue;
    }
    for (const item of value) query.append(key, item);
  }
  const serialized = query.toString();
  return serialized.length === 0 ? '' : `?${serialized}`;
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
