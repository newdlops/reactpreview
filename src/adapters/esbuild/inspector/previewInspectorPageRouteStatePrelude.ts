/** Emits route state before any selected authored surface is evaluated. */
import { PREVIEW_NEXT_APP_ROUTE_STATE_SYMBOL_KEY } from '../previewNextAppNavigationRuntimeSource';
import type { PreviewInspectorRouteExecutionRecipe } from './previewInspectorPageExecutionTypes';
import { createPreviewInspectorRouteHref } from './previewInspectorRouteHref';

export const PREVIEW_NEXT_PAGES_ROUTE_STATE_SYMBOL_KEY =
  'newdlops.react-file-preview.next-pages-router-state';
export const PREVIEW_INSPECTOR_PAGE_ROUTE_STATE_SPECIFIER =
  'react-preview:inspector-page-route-state';

/** Reports whether browser route state must be installed before authored surfaces are evaluated. */
export function shouldInstallPreviewInspectorPageRouteStatePrelude(
  recipe: PreviewInspectorRouteExecutionRecipe | undefined,
): boolean {
  return (
    recipe !== undefined &&
    (recipe.rootOwnsRouter ||
      (recipe.kind !== 'react-router-v5' && recipe.kind !== 'react-router-v6'))
  );
}

/** Returns no prelude only when the generated MemoryRouter owns selected route state. */
export function createPreviewInspectorPageRouteStatePreludeSource(
  recipe: PreviewInspectorRouteExecutionRecipe | undefined,
): string | undefined {
  if (!shouldInstallPreviewInspectorPageRouteStatePrelude(recipe) || recipe === undefined)
    return undefined;
  const routeHref = createPreviewInspectorRouteHref(recipe.pathname, recipe.searchParams);
  if (
    recipe.kind === 'generic-memory-location' ||
    recipe.kind === 'react-router-v5' ||
    recipe.kind === 'react-router-v6'
  ) {
    return [
      `const previewInspectorRoutePath = ${JSON.stringify(routeHref)};`,
      'if (globalThis.location?.pathname + globalThis.location?.search !== previewInspectorRoutePath) {',
      '  globalThis.history?.replaceState?.(globalThis.history.state, "", previewInspectorRoutePath);',
      '  if (typeof globalThis.dispatchEvent === "function" && typeof PopStateEvent === "function") {',
      '    globalThis.dispatchEvent(new PopStateEvent("popstate"));',
      '  }',
      '}',
    ].join('\n');
  }
  if (recipe.kind === 'next-app') {
    return [
      `const previewNextAppRouteStateSymbol = Symbol.for(${JSON.stringify(PREVIEW_NEXT_APP_ROUTE_STATE_SYMBOL_KEY)});`,
      `globalThis[previewNextAppRouteStateSymbol] = Object.freeze({ initialSignature: JSON.stringify([${JSON.stringify(recipe.pathname)}, ${JSON.stringify(recipe.params)}, ${JSON.stringify(recipe.searchParams)}]), params: Object.freeze(${JSON.stringify(recipe.params)}), pathname: ${JSON.stringify(recipe.pathname)}, revision: 0, searchParams: Object.freeze(${JSON.stringify(recipe.searchParams)}) });`,
    ].join('\n');
  }
  return [
    `const previewNextPagesRouteStateSymbol = Symbol.for(${JSON.stringify(PREVIEW_NEXT_PAGES_ROUTE_STATE_SYMBOL_KEY)});`,
    `globalThis[previewNextPagesRouteStateSymbol] = Object.freeze({ asPath: ${JSON.stringify(routeHref)}, pathname: ${JSON.stringify(recipe.pathname)}, pattern: ${JSON.stringify(recipe.pattern)}, query: Object.freeze(${JSON.stringify(recipe.params)}) });`,
  ].join('\n');
}
