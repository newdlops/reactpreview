/** Emits selected-branch React Router runtimes without importing an application route registry. */
import type { PreviewInspectorRouteExecutionRecipe } from './previewInspectorPageExecutionTypes';

export interface CreatePreviewInspectorRouteExecutionRuntimeSourceOptions {
  readonly recipe: PreviewInspectorRouteExecutionRecipe;
  readonly renderedPage: string;
  readonly routeSurfaceLocals: readonly string[];
}

/**
 * Uses only MemoryRouter plus the mounted surfaces already admitted into the execution plan.
 * The generated route tree deliberately has no loader, action, error-element, or sibling branch.
 */
export function createPreviewInspectorRouteExecutionRuntimeSource(
  options: CreatePreviewInspectorRouteExecutionRuntimeSourceOptions,
): { readonly imports: readonly string[]; readonly routeElement: string } | undefined {
  if (options.recipe.kind === 'react-router-v6') return createV6Runtime(options);
  if (options.recipe.kind === 'react-router-v5') return createV5Runtime(options);
  return undefined;
}

/** Emits a nested v6 Route tree so authored Outlet layouts receive their selected child. */
function createV6Runtime(
  options: CreatePreviewInspectorRouteExecutionRuntimeSourceOptions,
): { readonly imports: readonly string[]; readonly routeElement: string } {
  const { recipe } = options;
  const nested = options.routeSurfaceLocals
    .slice()
    .reverse()
    .reduce(
      (child, local, reverseIndex) =>
        `React.createElement(Route, { ${
          reverseIndex === options.routeSurfaceLocals.length - 1
            ? `path: ${JSON.stringify(recipe.mounts[0]?.pattern ?? recipe.pathname)}`
            : 'path: ""'
        }, element: React.createElement(${local}, null) }, ${child})`,
      `React.createElement(Route, { index: true, element: ${options.renderedPage} })`,
    );
  return Object.freeze({
    imports: Object.freeze([`import { MemoryRouter, Route, Routes } from '${options.recipe.routerModuleSpecifier ?? 'react-router-dom'}';`]),
    routeElement: `React.createElement(MemoryRouter, { initialEntries: [${JSON.stringify(recipe.pathname)}] }, React.createElement(Routes, null, ${nested}))`,
  });
}

/** Emits the selected v5 Route only, preserving route props without loading a Switch registry. */
function createV5Runtime(
  options: CreatePreviewInspectorRouteExecutionRuntimeSourceOptions,
): { readonly imports: readonly string[]; readonly routeElement: string } {
  const pattern = options.recipe.mounts[0]?.pattern ?? options.recipe.pathname;
  return Object.freeze({
    imports: Object.freeze([`import { MemoryRouter, Route } from '${options.recipe.routerModuleSpecifier ?? 'react-router-dom'}';`]),
    routeElement: `React.createElement(MemoryRouter, { initialEntries: [${JSON.stringify(options.recipe.pathname)}] }, React.createElement(Route, { path: ${JSON.stringify(pattern)}, render: () => ${options.renderedPage} }))`,
  });
}
